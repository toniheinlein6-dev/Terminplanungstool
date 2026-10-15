const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');

(async () => {
  const { resolveAssignees, normalizeProjectAssignees } = await import('../lib/assignees.js');
  const { setPool, ensureSchema, q } = await import('../lib/db.js');
  const { makeToken } = await import('../lib/auth.js');
  const { default: handler } = await import('../lib/handler.js');
  const { dueReminders } = await import('../lib/reminders.js');
  const logic = require('../lib/logic.cjs');
  const users = [{ id: 1, name: 'Max Neu' }, { id: 2, name: 'Alex' }, { id: 3, name: 'alex' }, { id: 4, name: 'Solo' }];
  let passed = 0;
  const check = async (name, run) => { await run(); passed++; console.log('ok assignees: ' + name); };

  await check('IDs lösen aktuelle Namen auf und doppelte IDs werden entfernt', () => {
    assert.deepEqual(resolveAssignees({ assignees: [{ id: '1', name: 'Max Alt' }, { id: '1', name: 'anderer Snapshot' }], who: 'falsch' }, users), [{ id: '1', name: 'Max Neu' }]);
  });
  await check('leere Zuordnung ist gegenüber altem who maßgeblich', () => {
    assert.deepEqual(resolveAssignees({ assignees: [], who: 'Solo' }, users), []);
  });
  await check('gelöschte IDs und freie Einträge werden nicht an gleichnamige Benutzer gebunden', () => {
    assert.deepEqual(resolveAssignees({ assignees: [{ id: '999', name: 'Solo' }, { id: null, name: 'Max Neu' }] }, users), [{ id: '999', name: 'Solo' }, { id: null, name: 'Max Neu' }]);
  });
  await check('Legacy-Namen werden nur eindeutig und case-insensitiv aufgelöst', () => {
    assert.deepEqual(resolveAssignees({ who: 'SOLO; Alex / Unbekannt & solo + Max Neu und Noch jemand' }, users), [
      { id: '4', name: 'Solo' }, { id: null, name: 'Alex' }, { id: null, name: 'Unbekannt' }, { id: '1', name: 'Max Neu' }, { id: null, name: 'Noch jemand' }
    ]);
  });
  await check('freie Namen werden dedupliziert, verschiedene IDs bei Namenskollision erhalten', () => {
    assert.deepEqual(resolveAssignees({ assignees: [{ id: '2', name: 'x' }, { id: '3', name: 'x' }, { id: null, name: 'Gast' }, { id: null, name: ' GAST ' }] }, users), [
      { id: '2', name: 'Alex' }, { id: '3', name: 'alex' }, { id: null, name: 'Gast' }
    ]);
  });
  await check('unbekannte IDs ohne Namen bleiben sichtbar und ungültige IDs werden nicht verwendet', () => {
    assert.deepEqual(resolveAssignees({ assignees: [{ id: '888', name: '' }, { id: 'nicht-numerisch', name: 'Alter Eintrag' }] }, users), [
      { id: '888', name: 'Benutzer #888' }, { id: null, name: 'Alter Eintrag' }
    ]);
  });
  await check('Normalisierung erhält sonstige Daten und verändert den Eingabeplan nicht', () => {
    const plan = { name: 'Plan', extra: { keep: true }, rows: [{ id: 1, name: 'Arbeit', who: 'SOLO' }, { id: 2, assignees: [], who: 'Solo' }] };
    const original = JSON.stringify(plan), normalized = normalizeProjectAssignees(plan, users);
    assert.equal(JSON.stringify(plan), original);
    assert.deepEqual(normalized.rows[0].assignees, [{ id: '4', name: 'Solo' }]);
    assert.equal(normalized.rows[0].who, 'Solo'); assert.equal(normalized.rows[1].who, '');
    assert.deepEqual(normalized.extra, plan.extra);
  });

  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool(); setPool(pool);
  process.env.SESSION_SECRET = 'assignees-test-only-session-secret-at-least-32-characters';
  try {
    await ensureSchema();
    const addUser = async (name, email, remind = true, role = 'viewer') => (await q('INSERT INTO tp_users (name,pass_hash,role,created_at,email,remind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [name, 'test-only', role, 1, email, remind])).rows[0];
    const admin = await addUser('Admin', null, false, 'admin');
    const max = await addUser('Max Alt', 'max@example.test');
    await addUser('Alex', 'alex@example.test');
    await addUser('alex', null, false);
    const solo = await addUser('Solo', 'solo@example.test');
    const other = await addUser('MAX NEU', 'other@example.test');
    const request = async (action, body, params = '') => {
      const response = { statusCode: 200, setHeader() {}, end(value) { this.body = JSON.parse(value); } };
      await handler({ url: '/api/tp?a=' + action + params, method: body === undefined ? 'GET' : 'POST', headers: { host: 'localhost', 'x-tp': '1', cookie: 'tp_session=' + makeToken(admin.id, 0) }, body }, response);
      return response;
    };
    const today = logic.parseISO('2026-10-19');
    const plan = { name: 'Zuordnungstest', start: '2026-10-19', mode: 'cal', holidays: [], rows: [{ id: 1, type: 'vorgang', name: 'Test', dur: '1', who: 'falsch', assignees: [{ id: String(max.id), name: 'Alter Snapshot' }] }] };
    await check('Projekt-API normalisiert Zuordnungen und Namensstrings beim Speichern', async () => {
      const saved = await request('put', { id: 'assignments', base: 0, json: JSON.stringify(plan) });
      assert.equal(saved.statusCode, 200);
      const stored = JSON.parse((await q('SELECT json FROM tp_projects WHERE id=$1', ['assignments'])).rows[0].json);
      assert.equal(stored.rows[0].who, 'Max Alt'); assert.deepEqual(stored.rows[0].assignees, [{ id: String(max.id), name: 'Max Alt' }]);
    });
    await q('UPDATE tp_users SET name=$1 WHERE id=$2', ['Max Neu', max.id]);
    await check('GET und Versionskonflikt lösen Umbenennung ohne zusätzliche Projektversion auf', async () => {
      const read = await request('get', undefined, '&id=assignments');
      assert.equal(read.statusCode, 200); assert.equal(read.body.version, 1);
      assert.equal(JSON.parse(read.body.json).rows[0].who, 'Max Neu');
      const conflict = await request('put', { id: 'assignments', base: 0, json: JSON.stringify(plan) });
      assert.equal(conflict.statusCode, 409); assert.equal(JSON.parse(conflict.body.current.json).rows[0].who, 'Max Neu');
      const stored = JSON.parse((await q('SELECT json FROM tp_projects WHERE id=$1', ['assignments'])).rows[0].json);
      assert.equal(stored.rows[0].who, 'Max Alt');
    });
    await check('Sicherung exportiert aktuelle Namen und stabile IDs', async () => {
      const result = await request('export');
      assert.equal(result.statusCode, 200);
      const row = result.body.projects.find(project => project.id === 'assignments').plan.rows[0];
      assert.deepEqual(row.assignees, [{ id: String(max.id), name: 'Max Neu' }]); assert.equal(row.who, 'Max Neu');
    });
    await q('DELETE FROM tp_projects');
    const task = (id, extra) => ({ id, type: 'vorgang', name: 'Vorgang ' + id, dur: '1', pred: '', rel: 'EA', lag: '', fixed: '', st: '', ...extra });
    const reminderPlan = { name: 'Erinnerungen', start: '2026-10-19', mode: 'cal', holidays: [], rows: [
      task(1, { assignees: [{ id: String(max.id), name: 'Max Alt' }], who: 'MAX NEU' }),
      task(2, { assignees: [], who: 'Solo' }),
      task(3, { assignees: [{ id: '999', name: 'Solo' }], who: 'Solo' }),
      task(4, { assignees: [{ id: null, name: 'Solo' }], who: 'Solo' }),
      task(5, { who: 'Solo und SOLO' }),
      task(6, { who: 'Alex' }),
      task(7, { assignees: [{ id: String(max.id), name: 'Max Alt' }, { id: String(max.id), name: 'Max Alt' }] }),
      task(8, { assignees: [{ id: String(other.id), name: 'Max Neu' }] }),
      task(9, { who: 'Max Neu' })
    ] };
    await q('INSERT INTO tp_projects (id,name,json,version,updated_at) VALUES ($1,$2,$3,1,1)', ['reminders', reminderPlan.name, JSON.stringify(reminderPlan)]);
    await check('Erinnerungen adressieren IDs und beachten explizites Leeren, Löschung, freie Einträge und Namenskollisionen', async () => {
      const due = await dueReminders(today);
      const actual = due.map(item => [item.rowId, Number(item.user.id)]).sort((a, b) => a[0] - b[0]);
      assert.deepEqual(actual, [[1, max.id], [5, solo.id], [7, max.id], [8, other.id]]);
      assert.equal(due.find(item => item.rowId === 1).user.name, 'Max Neu');
    });
    await q('DELETE FROM tp_users WHERE id=$1', [max.id]);
    await check('gelöschte ID wird beim Erinnern nicht auf einen gleichnamigen Account umgebogen', async () => {
      const due = await dueReminders(today);
      assert.deepEqual(due.filter(item => [1, 7].includes(item.rowId)), []);
      assert.equal(due.find(item => item.rowId === 8).user.id, other.id);
    });
  } finally { await pool.end(); }
  console.log('Benutzerzuordnung: ' + passed + ' Prüfungen erfolgreich.');
})().catch(error => { console.error(error); process.exitCode = 1; });
