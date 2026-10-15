// Integrationstests gegen den echten HTTP-Handler und eine isolierte Postgres-Testdatenbank.
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { after, test } from 'node:test';
import { newDb } from 'pg-mem';
import handler from '../lib/handler.js';
import { ensureSchema, q, setPool } from '../lib/db.js';
import { hashPw } from '../lib/auth.js';
import { prepareBackupExport } from '../lib/backup.js';
import { encodeBackupPayload } from './backup.js';

process.env.SESSION_SECRET = 'ticket-integration-tests-secret-at-least-32-characters';
process.env.SETUP_KEY = 'ticket-test-setup';
process.env.MAIL_TRANSPORT = 'log';
const PASSWORD = 'SicheresTestpasswort123!';
const server = http.createServer((req, res) => handler(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let pool;
after(async () => {
  await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
});

async function api(action, { cookie, body, headers, query = {}, method } = {}) {
  const qs = new URLSearchParams({ a: action, ...query });
  const res = await fetch(`${origin}/api/tp?${qs}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-TP': '1' }),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
async function rawExport(user) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${origin}/api/tp?a=export`, { headers: { Cookie: user.cookie, 'Accept-Encoding': 'gzip' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}
const envelope = value => ({ backupEncoding: 'gzip-base64', data: gzipSync(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).toString('base64') });
function status(result, expected) {
  assert.equal(result.status, expected, JSON.stringify(result.data));
  return result.data;
}
async function freshDatabase() {
  if (pool) await pool.end();
  // pg-mem wertet bei vorhandenem CREATE TABLE IF NOT EXISTS die Spaltendefinitionen
  // nicht erneut aus; seine AST-Vollständigkeitsprüfung würde das als Fehler melden.
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  pool = new Pool();
  setPool(pool);
}
async function fixture({ legacy = false } = {}) {
  await freshDatabase();
  if (legacy) {
    await q('CREATE TABLE tp_projects (id VARCHAR(64) PRIMARY KEY, name VARCHAR(200) NOT NULL, json TEXT NOT NULL, version INTEGER NOT NULL, updated_at BIGINT NOT NULL, updated_by INTEGER NULL)');
    await q('INSERT INTO tp_projects (id,name,json,version,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5,$6)', ['legacy-project', 'Vorhandener Terminplan', JSON.stringify({ name: 'Vorhandener Terminplan', rows: [{ name: 'Bestand' }] }), 7, 1700000000, null]);
  }
  const setup = await api('setup', { body: { key: process.env.SETUP_KEY, name: 'Administrator', password: PASSWORD } });
  const admin = { ...status(setup, 200).user, cookie: setup.cookie };
  const users = { admin };
  for (const [key, role, name] of [['editor', 'editor', 'Bearbeiter'], ['viewer', 'viewer', 'Leser'], ['otherAdmin', 'admin', 'Zweiter Admin']]) {
    status(await api('user_save', { cookie: admin.cookie, body: { name, role, password: PASSWORD } }), 200);
    const login = await api('login', { body: { name, password: PASSWORD } });
    users[key] = { ...status(login, 200).user, cookie: login.cookie };
  }
  return users;
}
const valid = (overrides = {}) => ({ title: 'Kalender zeigt falsches Datum', description: 'Beim Öffnen des Kalenders wird ein falsches Datum angezeigt.', category: 'bug', ...overrides });
async function create(user, overrides = {}) {
  return status(await api('ticket_create', { cookie: user.cookie, body: valid(overrides) }), 201).ticket;
}
async function detail(user, id) {
  return status(await api('ticket_get', { cookie: user.cookie, query: { id } }), 200);
}
async function list(user) {
  return status(await api('tickets_list', { cookie: user.cookie }), 200).tickets;
}
async function update(user, ticket, overrides = {}) {
  return api('ticket_update', { cookie: user.cookie, body: { id: ticket.id, base: ticket.version, title: ticket.title, description: ticket.description, category: ticket.category, status: ticket.status, response: ticket.response || '', ...overrides } });
}
const byVersion = events => [...events].sort((a, b) => a.version - b.version);
const byId = tickets => [...tickets].sort((a, b) => a.id.localeCompare(b.id));
function assertTicket(ticket, user) {
  assert.match(ticket.id, /^T-[a-f0-9]{12}$/i);
  assert.equal(ticket.status, 'new');
  assert.equal(ticket.version, 1);
  assert.equal(ticket.createdBy, user.id);
  assert.equal(ticket.createdByName, user.name);
  assert.equal(ticket.updatedBy, user.id);
  assert.equal(ticket.updatedByName, user.name);
  assert.equal(ticket.response, '');
  assert.equal(new Date(ticket.createdAt).toISOString(), ticket.createdAt);
  assert.equal(new Date(ticket.updatedAt).toISOString(), ticket.updatedAt);
}
function assertRestored(original, actual, restorer) {
  for (const key of ['id', 'title', 'description', 'category', 'status', 'response', 'createdAt', 'createdBy', 'createdByName', 'projectId']) {
    assert.equal(actual.ticket[key], original.ticket[key], key);
  }
  assert.equal(actual.ticket.version, original.ticket.version + 1);
  assert.equal(actual.ticket.updatedBy, restorer.id);
  assert.equal(actual.ticket.updatedByName, restorer.name);
  assert.ok(Date.parse(actual.ticket.updatedAt) >= Date.parse(original.ticket.updatedAt));
  const events = byVersion(actual.events);
  assert.deepEqual(events.slice(0, -1), byVersion(original.events));
  assert.equal(events.at(-1).kind, 'restored');
  assert.equal(events.at(-1).version, actual.ticket.version);
  assert.equal(events.at(-1).by, restorer.id);
  assert.equal(events.at(-1).byName, restorer.name);
}

test('Ticketsystem: Rollen, Validierung, Verlauf und Sicherungen', async t => {
  await t.test('Schema wird additiv angelegt und vorhandene Terminpläne bleiben unverändert', async () => {
    const { admin } = await fixture({ legacy: true });
    await ensureSchema();
    const result = status(await api('get', { cookie: admin.cookie, query: { id: 'legacy-project' } }), 200);
    assert.equal(result.version, 7);
    assert.equal(JSON.parse(result.json).rows[0].name, 'Bestand');
    await create(admin);
    assert.equal((await list(admin)).length, 1);
    assert.equal((await q('SELECT version FROM tp_projects WHERE id=$1', ['legacy-project'])).rows[0].version, 7);
  });

  await t.test('Vorhandene Tickets werden verlustfrei und bei erneutem Serverstart idempotent migriert', async () => {
    await freshDatabase();
    await q('CREATE TABLE tp_users (id SERIAL PRIMARY KEY, name VARCHAR(80) NOT NULL UNIQUE, pass_hash TEXT NOT NULL, role VARCHAR(10) NOT NULL, token_ver INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL)');
    await q('CREATE TABLE tp_tickets (id SERIAL PRIMARY KEY, user_id INTEGER NULL, kind VARCHAR(12) NOT NULL, title VARCHAR(200) NOT NULL, body TEXT NOT NULL, status VARCHAR(12) NOT NULL, admin_note TEXT NULL, project_id VARCHAR(64) NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)');
    const passwordHash = hashPw(PASSWORD);
    await q('INSERT INTO tp_users (name,pass_hash,role,created_at) VALUES ($1,$2,$3,$4)', ['Alt-Admin', passwordHash, 'admin', 1700000000]);
    const creator = (await q('INSERT INTO tp_users (name,pass_hash,role,created_at) VALUES ($1,$2,$3,$4) RETURNING id', ['Alt-Leser', passwordHash, 'viewer', 1700000000])).rows[0];
    const oldTickets = [
      { kind: 'problem', title: 'x'.repeat(200), body: '', status: 'abgelehnt', note: null, category: 'bug', apiStatus: 'rejected' },
      { kind: 'frage', title: 'Frage aus dem Altbestand', body: '', status: 'neu', note: null, category: 'question', apiStatus: 'new' },
      { kind: 'idee', title: 'Bereits umgesetzte Idee', body: 'Historischer Beschreibungstext', status: 'erledigt', note: 'Historische Rückmeldung', category: 'improvement', apiStatus: 'done' }
    ];
    for (const ticket of oldTickets) {
      const row = (await q('INSERT INTO tp_tickets (user_id,kind,title,body,status,admin_note,project_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [creator.id, ticket.kind, ticket.title, ticket.body, ticket.status, ticket.note, 'unverknuepftes-projekt', 1700000000, 1700000100])).rows[0];
      ticket.id = `T-${row.id}`;
    }
    await ensureSchema();
    const login = await api('login', { body: { name: 'Alt-Admin', password: PASSWORD } });
    const admin = { ...status(login, 200).user, cookie: login.cookie };
    const viewerLogin = await api('login', { body: { name: 'Alt-Leser', password: PASSWORD } });
    const viewer = { ...status(viewerLogin, 200).user, cookie: viewerLogin.cookie };
    assert.equal((await list(viewer)).length, oldTickets.length);
    const before = [];
    for (const old of oldTickets) {
      const result = await detail(viewer, old.id);
      assert.equal(result.ticket.title, old.title);
      assert.equal(result.ticket.description, old.body);
      assert.equal(result.ticket.category, old.category);
      assert.equal(result.ticket.status, old.apiStatus);
      assert.equal(result.ticket.response, old.note || '');
      assert.equal(result.ticket.createdBy, String(creator.id));
      assert.equal(result.ticket.createdByName, 'Alt-Leser');
      assert.equal(result.ticket.projectId, 'unverknuepftes-projekt');
      assert.equal(result.ticket.createdAt, new Date(1700000000 * 1000).toISOString());
      assert.equal(result.ticket.updatedAt, new Date(1700000100 * 1000).toISOString());
      assert.equal(result.ticket.version, 1);
      assert.equal(result.events.length, 1);
      before.push(result);
    }
    // setPool bildet den neuen Prozessstart ab, ohne Daten oder Schema zurückzusetzen.
    setPool(pool);
    await ensureSchema();
    for (const [i, old] of oldTickets.entries()) assert.deepEqual(await detail(admin, old.id), before[i]);
    const backup = status(await api('export', { cookie: admin.cookie }), 200);
    assert.equal(backup.tickets.length, 3);
    assert.equal(backup.ticketEvents.length, 3);
    assert.ok(backup.tickets.every(ticket => ticket.projectId === 'unverknuepftes-projekt'));
    const users = await fixture();
    status(await api('import', { cookie: users.admin.cookie, body: backup }), 200);
    for (const [i, old] of oldTickets.entries()) assertRestored(before[i], await detail(users.viewer, old.id), users.admin);
    // Fremde Benutzer-IDs einer Sicherung dürfen keine E-Mails an lokale Konten auslösen.
    const imported = await q('SELECT user_id FROM tp_tickets');
    assert.ok(imported.rows.every(row => row.user_id === null));
    const question = (await detail(users.admin, oldTickets[1].id)).ticket;
    const changed = status(await update(users.admin, question, { description: 'Die Frage wurde um eine ausreichende Beschreibung ergänzt.', status: 'in_progress' }), 200).ticket;
    assert.equal(changed.category, 'question');
    assert.equal(changed.version, question.version + 1);
    assert.match((await create(users.viewer)).id, /^T-[a-f0-9]{12}$/i);
  });

  await t.test('Auch die bisherige Ticketanlage behält den Projektbezug bei Sicherung und Wiederherstellung', async () => {
    let users = await fixture();
    const projectId = 'ticket-project';
    status(await api('put', { cookie: users.editor.cookie, body: { id: projectId, base: 0, json: JSON.stringify({ name: 'Verknüpfter Plan', rows: [] }) } }), 200);
    const oldApi = status(await api('ticket_new', { cookie: users.viewer.cookie, body: { kind: 'problem', title: 'Bestehende Ticketanlage', body: 'Ticket über den bisherigen API-Endpunkt.', projectId } }), 201).ticket;
    assert.equal(oldApi.projectId, projectId);
    const modernApi = await create(users.viewer, { projectId });
    assert.equal(modernApi.projectId, projectId);
    const backup = status(await api('export', { cookie: users.admin.cookie }), 200);
    assert.ok(backup.tickets.every(ticket => ticket.projectId === projectId));
    users = await fixture();
    status(await api('import', { cookie: users.admin.cookie, body: backup }), 200);
    for (const ticket of backup.tickets) assert.equal((await detail(users.viewer, ticket.id)).ticket.projectId, projectId);
    const plan = status(await api('get', { cookie: users.viewer.cookie, query: { id: projectId } }), 200);
    assert.equal(JSON.parse(plan.json).name, 'Verknüpfter Plan');
  });

  await t.test('Alle drei Rollen können Tickets anlegen und alle Tickets samt Verlauf lesen', async () => {
    const users = await fixture();
    const tickets = [];
    for (const user of [users.admin, users.editor, users.viewer]) {
      const ticket = await create(user, { title: `Ticket von ${user.name}` });
      assertTicket(ticket, user);
      tickets.push(ticket);
    }
    assert.equal(new Set(tickets.map(x => x.id)).size, 3);
    for (const user of [users.admin, users.editor, users.viewer]) {
      assert.deepEqual(byId(await list(user)), byId(tickets));
      for (const ticket of tickets) {
        const result = await detail(user, ticket.id);
        assert.deepEqual(result.ticket, ticket);
        assert.equal(result.events.length, 1);
        const event = result.events[0];
        assert.equal(event.version, 1);
        assert.equal(event.kind, 'created');
        assert.equal(event.by, ticket.createdBy);
        assert.equal(event.byName, ticket.createdByName);
        assert.equal(event.title, ticket.title);
        assert.equal(event.description, ticket.description);
      }
    }
  });

  await t.test('Ohne Anmeldung sind Ticketendpunkte und Sicherungen gesperrt', async () => {
    const { admin } = await fixture();
    const ticket = await create(admin);
    for (const [action, options] of [
      ['tickets_list', {}], ['ticket_get', { query: { id: ticket.id } }],
      ['ticket_create', { body: valid() }], ['ticket_update', { body: { id: ticket.id, base: 1 } }],
      ['export', {}], ['import', { body: { format: 'terminplaner-sicherung', v: 1, projects: [] } }]
    ]) status(await api(action, options), 401);
    assert.equal((await list(admin)).length, 1);
  });

  await t.test('Editor und Leser dürfen auch eigene Tickets nicht bearbeiten oder Sicherungen verwalten', async () => {
    const { admin, editor, viewer } = await fixture();
    for (const user of [editor, viewer]) {
      const ticket = await create(user);
      status(await update(user, ticket, { status: 'done', response: 'Eigenmächtig erledigt' }), 403);
      status(await api('export', { cookie: user.cookie }), 403);
      status(await api('import', { cookie: user.cookie, body: { format: 'terminplaner-sicherung', v: 1, projects: [] } }), 403);
      const unchanged = await detail(admin, ticket.id);
      assert.deepEqual(unchanged.ticket, ticket);
      assert.equal(unchanged.events.length, 1);
    }
  });

  await t.test('Schreibzugriffe erfordern POST und CSRF-Header', async () => {
    const { admin } = await fixture();
    const ticket = await create(admin);
    status(await api('ticket_create', { cookie: admin.cookie }), 405);
    status(await api('ticket_update', { cookie: admin.cookie }), 405);
    status(await api('ticket_create', { cookie: admin.cookie, body: valid(), headers: { 'X-TP': '' } }), 403);
    status(await api('ticket_update', { cookie: admin.cookie, body: { ...ticket, base: ticket.version, status: 'done' }, headers: { 'X-TP': '' } }), 403);
    assert.equal((await list(admin)).length, 1);
    assert.deepEqual((await detail(admin, ticket.id)).ticket, ticket);
  });

  await t.test('Ungültige Inhalte werden ohne Schreibzugriff abgewiesen; Grenzwerte funktionieren', async () => {
    const { admin } = await fixture();
    const bad = [
      { title: '' }, { title: 'ab' }, { title: 'x'.repeat(161) }, { title: null }, { title: { injected: true } },
      { description: 'zu kurz' }, { description: 'x'.repeat(10001) }, { description: null },
      { category: 'other' }, { category: null }
    ];
    for (const patch of bad) status(await api('ticket_create', { cookie: admin.cookie, body: valid(patch) }), 400);
    assert.equal((await list(admin)).length, 0);
    const ticket = await create(admin, { title: 'x'.repeat(160), description: 'x'.repeat(10000), category: 'improvement' });
    for (const patch of [{ status: 'unknown' }, { category: 'other' }, { title: 'ab' }, { description: 'short' }, { response: 'x'.repeat(5001) }, { status: 'rejected', response: '' }, { status: 'rejected', response: '   ' }, { base: 0 }, { base: '1' }]) {
      status(await update(admin, ticket, patch), 400);
    }
    const unchanged = await detail(admin, ticket.id);
    assert.deepEqual(unchanged.ticket, ticket);
    assert.equal(unchanged.events.length, 1);
    const accepted = status(await update(admin, ticket, { title: 'abc', description: '0123456789', status: 'rejected', response: 'x'.repeat(5000) }), 200).ticket;
    assert.equal(accepted.version, 2);
    assert.equal(accepted.response.length, 5000);
    status(await api('ticket_get', { cookie: admin.cookie, query: { id: 'invalid!' } }), 400);
    status(await api('ticket_get', { cookie: admin.cookie, query: { id: 'T-000000000000' } }), 404);
  });

  await t.test('Ersteller, Status und Versionsmetadaten stammen beim Einreichen vom Server', async () => {
    const { viewer, admin } = await fixture();
    const ticket = await create(viewer, {
      id: 'T-000000000001', status: 'done', response: 'Fremde Rückmeldung', version: 200,
      createdBy: admin.id, createdByName: 'Gefälscht', updatedBy: admin.id, updatedByName: 'Gefälscht',
      createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z'
    });
    assertTicket(ticket, viewer);
    assert.notEqual(ticket.id, 'T-000000000001');
    assert.notEqual(ticket.createdAt, '2000-01-01T00:00:00.000Z');
    const result = await detail(admin, ticket.id);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].by, viewer.id);
    assert.equal(result.events[0].byName, viewer.name);
  });

  await t.test('Admins können Inhalte und alle Status ändern, Tickets wieder öffnen und der Verlauf bleibt vollständig', async () => {
    const { admin, viewer } = await fixture();
    let ticket = await create(viewer);
    const expected = [ticket];
    for (const [index, next] of ['in_progress', 'rejected', 'new', 'done', 'in_progress', 'done'].entries()) {
      ticket = status(await update(admin, ticket, {
        status: next, title: `Überarbeiteter Titel ${index}`, description: `Ausführlichere Fehlerbeschreibung Nummer ${index}.`,
        category: index % 2 ? 'improvement' : 'bug', response: `Öffentliche Rückmeldung ${index}`
      }), 200).ticket;
      assert.equal(ticket.version, expected.length + 1);
      assert.equal(ticket.status, next);
      assert.equal(ticket.createdBy, viewer.id);
      assert.equal(ticket.createdByName, viewer.name);
      assert.equal(ticket.updatedBy, admin.id);
      assert.equal(ticket.updatedByName, admin.name);
      expected.push(ticket);
    }
    const result = await detail(viewer, ticket.id);
    const events = byVersion(result.events);
    assert.equal(events.length, expected.length);
    for (const [i, event] of events.entries()) {
      assert.equal(event.version, i + 1);
      assert.equal(event.kind, i ? 'updated' : 'created');
      for (const key of ['status', 'title', 'description', 'category', 'response']) assert.equal(event[key], expected[i][key]);
      assert.equal(event.by, i ? admin.id : viewer.id);
      assert.equal(new Date(event.at).toISOString(), event.at);
    }
  });

  await t.test('Administratoren können Fehler in Fragen umkategorisieren; der Verlauf behält beide Kategorien', async () => {
    const { admin, viewer } = await fixture();
    const ticket = await create(viewer);
    const question = status(await update(admin, ticket, { category: 'question' }), 200).ticket;
    assert.equal(question.category, 'question');
    const result = await detail(viewer, ticket.id);
    const events = byVersion(result.events);
    assert.deepEqual(events.map(event => event.category), ['bug', 'question']);
    assert.equal(question.version, ticket.version + 1);
    const backup = status(await api('export', { cookie: admin.cookie }), 200);
    status(await api('import', { cookie: admin.cookie, body: backup }), 200);
    assert.equal((await detail(viewer, ticket.id)).ticket.category, 'question');
  });

  await t.test('Benachrichtigungsfehler nach Commit verhindern keine erfolgreiche Anlage oder Bearbeitung', async () => {
    const { admin, viewer } = await fixture();
    const normalQuery = pool.query;
    const errors = [];
    const normalError = console.error;
    pool.query = function (sql, params) {
      if (sql.startsWith('SELECT email FROM tp_users') || sql.startsWith('SELECT u.email,u.name FROM tp_tickets')) {
        return Promise.reject(new Error('Simulierter Fehler beim Benachrichtigungsabruf'));
      }
      return normalQuery.call(this, sql, params);
    };
    console.error = (...args) => errors.push(args);
    try {
      const ticket = await create(viewer);
      const changed = status(await update(admin, ticket, { status: 'in_progress', response: 'Erfolgreich gespeichert.' }), 200).ticket;
      const result = await detail(viewer, ticket.id);
      assert.deepEqual(result.ticket, changed);
      assert.equal(result.events.length, 2);
      assert.equal(errors.length, 2);
    } finally {
      pool.query = normalQuery;
      console.error = normalError;
    }
  });

  await t.test('Veraltete Versionen liefern 409 mit aktuellem Stand und verändern weder Ticket noch Verlauf', async () => {
    const { admin, otherAdmin } = await fixture();
    const initial = await create(admin);
    const changed = status(await update(admin, initial, { status: 'in_progress' }), 200).ticket;
    const conflict = status(await update(otherAdmin, initial, { status: 'done', title: 'Veraltete Änderung' }), 409);
    assert.equal(conflict.error, 'conflict');
    assert.deepEqual(conflict.current, changed);
    const result = await detail(admin, initial.id);
    assert.deepEqual(result.ticket, changed);
    assert.equal(result.events.length, 2);
  });

  await t.test('Zwei gleichzeitige Adminänderungen können sich nicht gegenseitig überschreiben', async () => {
    const { admin, otherAdmin } = await fixture();
    const initial = await create(admin);
    const attempts = await Promise.all([
      update(admin, initial, { status: 'in_progress', response: 'Erste Änderung' }),
      update(otherAdmin, initial, { status: 'done', response: 'Zweite Änderung' })
    ]);
    assert.deepEqual(attempts.map(x => x.status).sort(), [200, 409]);
    const winner = attempts.find(x => x.status === 200).data.ticket;
    const conflict = attempts.find(x => x.status === 409).data;
    assert.equal(conflict.error, 'conflict');
    assert.deepEqual(conflict.current, winner);
    const result = await detail(admin, initial.id);
    assert.equal(result.ticket.version, 2);
    assert.deepEqual(result.ticket, winner);
    assert.equal(result.events.length, 2);
  });

  await t.test('Rollen werden bei jedem Aufruf frisch geprüft, auch für bereits angemeldete Administratoren', async () => {
    const { admin, otherAdmin } = await fixture();
    const ticket = await create(otherAdmin);
    status(await api('user_save', { cookie: admin.cookie, body: { id: otherAdmin.id, name: otherAdmin.name, role: 'viewer' } }), 200);
    status(await update(otherAdmin, ticket, { status: 'done' }), 403);
    status(await api('export', { cookie: otherAdmin.cookie }), 403);
    assert.equal((await list(otherAdmin)).length, 1);
    assertTicket(await create(otherAdmin), otherAdmin);
    assert.equal((await detail(admin, ticket.id)).events.length, 1);
  });

  await t.test('Umbenennung und Löschung von Benutzern erhalten Namen und Urheber im Ticketverlauf', async () => {
    const { admin, viewer } = await fixture();
    const ticket = await create(viewer);
    status(await api('user_save', { cookie: admin.cookie, body: { id: viewer.id, name: 'Leser umbenannt', role: 'viewer' } }), 200);
    assert.deepEqual((await detail(admin, ticket.id)).ticket, ticket);
    status(await api('user_del', { cookie: admin.cookie, body: { id: viewer.id } }), 200);
    const changed = status(await update(admin, ticket, { status: 'in_progress', response: 'Wird geprüft.' }), 200).ticket;
    status(await api('user_save', { cookie: admin.cookie, body: { id: admin.id, name: 'Admin umbenannt', role: 'admin' } }), 200);
    const result = await detail(admin, ticket.id);
    assert.deepEqual(result.ticket, changed);
    assert.equal(result.ticket.createdByName, viewer.name);
    assert.equal(byVersion(result.events)[0].byName, viewer.name);
    assert.equal(byVersion(result.events)[1].byName, admin.name);
    status(await api('tickets_list', { cookie: viewer.cookie }), 401);
    const exported = status(await api('export', { cookie: admin.cookie }), 200);
    assert.equal(exported.tickets[0].createdByName, viewer.name);
  });

  await t.test('V2-Sicherungen transportieren Tickets, Verlauf und Terminpläne in eine frische Datenbank', async () => {
    let users = await fixture();
    const first = await create(users.viewer);
    await create(users.editor, { category: 'improvement', title: 'Bessere Kalenderübersicht' });
    status(await update(users.admin, first, { status: 'done', response: 'Ist umgesetzt.' }), 200);
    const plan = { name: 'Gesicherter Terminplan', rows: [{ name: 'Geplante Aufgabe' }] };
    status(await api('put', { cookie: users.editor.cookie, body: { id: 'backup-project', base: 0, json: JSON.stringify(plan) } }), 200);
    const backup = status(await api('export', { cookie: users.admin.cookie }), 200);
    assert.equal(backup.format, 'terminplaner-sicherung');
    assert.equal(backup.v, 2);
    assert.equal(backup.tickets.length, 2);
    assert.equal(backup.ticketEvents.length, 3);
    assert.equal(backup.projects.length, 1);
    assert.equal(new Date(backup.exported).toISOString(), backup.exported);
    users = await fixture();
    status(await api('import', { cookie: users.admin.cookie, body: backup }), 200);
    const roundtrip = status(await api('export', { cookie: users.admin.cookie }), 200);
    assert.equal(roundtrip.tickets.length, backup.tickets.length);
    assert.equal(roundtrip.ticketEvents.length, backup.ticketEvents.length + backup.tickets.length);
    for (const ticket of backup.tickets) {
      const events = backup.ticketEvents.filter(event => event.ticketId === ticket.id).map(({ ticketId, ...event }) => event);
      assertRestored({ ticket, events }, await detail(users.viewer, ticket.id), users.admin);
    }
    assert.deepEqual(roundtrip.projects.map(x => x.plan), [plan]);
    const ids = new Set(roundtrip.tickets.map(x => x.id));
    const next = await create(users.viewer);
    assert.ok(!ids.has(next.id));
    assert.equal((await list(users.admin)).length, 3);
    // Derselbe Stand darf mehrfach importiert werden, ohne den Verlauf zu duplizieren.
    status(await api('import', { cookie: users.admin.cookie, body: roundtrip }), 200);
    assert.equal((await detail(users.admin, first.id)).events.length, 3);
  });

  await t.test('V1-Sicherungen bleiben importierbar und lassen vorhandene Tickets unverändert', async () => {
    const { admin, viewer } = await fixture();
    const ticket = await create(viewer);
    const before = await detail(admin, ticket.id);
    status(await api('import', { cookie: admin.cookie, body: { format: 'terminplaner-sicherung', v: 1, projects: [{ id: 'old-backup', name: 'Alte Sicherung', version: 4, plan: { name: 'Alte Sicherung', rows: [] } }] } }), 200);
    assert.deepEqual(await detail(admin, ticket.id), before);
    const restored = status(await api('get', { cookie: admin.cookie, query: { id: 'old-backup' } }), 200);
    assert.equal(JSON.parse(restored.json).name, 'Alte Sicherung');
  });

  await t.test('Wiederherstellen verlangt aktuelle Version und hängt einen Eintrag an die bestehende Historie an', async () => {
    const { admin, viewer } = await fixture();
    const first = await create(viewer);
    const backup = status(await api('export', { cookie: admin.cookie }), 200);
    const changed = status(await update(admin, first, { status: 'done', response: 'Nach der Sicherung erledigt.' }), 200).ticket;
    const before = await detail(admin, first.id);
    for (const body of [backup, { ...backup, ticketBases: { [first.id]: first.version } }]) {
      const conflict = status(await api('import', { cookie: admin.cookie, body }), 409);
      assert.equal(conflict.error, 'conflict');
      assert.deepEqual(await detail(admin, first.id), before);
    }
    status(await api('import', { cookie: admin.cookie, body: { ...backup, ticketBases: { [first.id]: changed.version } } }), 200);
    const restored = await detail(viewer, first.id);
    assert.equal(restored.ticket.version, changed.version + 1);
    assert.equal(restored.ticket.status, first.status);
    assert.equal(restored.ticket.response, first.response);
    assert.equal(restored.ticket.createdByName, viewer.name);
    const events = byVersion(restored.events);
    assert.deepEqual(events.slice(0, 2), byVersion(before.events));
    assert.equal(events.length, 3);
    assert.equal(events[2].kind, 'restored');
    assert.equal(events[2].by, admin.id);
    assert.equal(events[2].version, restored.ticket.version);
  });

  await t.test('Sicherungsimporte dürfen vorhandene Historieneinträge auch bei identischem aktuellem Ticket nicht ersetzen', async () => {
    const { admin, viewer } = await fixture();
    let ticket = await create(viewer);
    ticket = status(await update(admin, ticket, { status: 'in_progress', response: 'Aktueller Stand' }), 200).ticket;
    const before = await detail(admin, ticket.id);
    const backup = status(await api('export', { cookie: admin.cookie }), 200);
    backup.ticketEvents.find(event => event.version === 1).title = 'Manipulierter historischer Titel';
    backup.ticketBases = { [ticket.id]: ticket.version };
    backup.projects = [{ id: 'conflict-must-not-write', plan: { name: 'Bei Konflikt nicht importieren', rows: [] } }];
    status(await api('import', { cookie: admin.cookie, body: backup }), 409);
    assert.deepEqual(await detail(admin, ticket.id), before);
    status(await api('get', { cookie: admin.cookie, query: { id: 'conflict-must-not-write' } }), 404);
  });

  await t.test('Fehlerhafte V2-Sicherungen werden vollständig vor Änderungen geprüft', async () => {
    const { admin, viewer } = await fixture();
    const ticket = await create(viewer);
    const before = await detail(admin, ticket.id);
    const backup = status(await api('export', { cookie: admin.cookie }), 200);
    const project = { id: 'must-not-be-imported', plan: { name: 'Nicht schreiben', rows: [] } };
    const clone = () => structuredClone({ ...backup, projects: [project] });
    const malformed = [];
    let body = clone(); body.tickets[0].status = 'unknown'; malformed.push(body);
    body = clone(); body.tickets[0].title = ''; malformed.push(body);
    body = clone(); body.tickets.push(structuredClone(body.tickets[0])); malformed.push(body);
    body = clone(); body.ticketEvents[0].ticketId = 'T-000000000000'; malformed.push(body);
    body = clone(); body.ticketEvents.push(structuredClone(body.ticketEvents[0])); malformed.push(body);
    body = clone(); body.ticketEvents = []; malformed.push(body);
    body = clone(); body.ticketEvents[0].version = 200; malformed.push(body);
    body = clone(); body.tickets[0].createdAt = 'kein Datum'; malformed.push(body);
    for (const invalid of malformed) {
      status(await api('import', { cookie: admin.cookie, body: invalid }), 400);
      assert.deepEqual(await detail(admin, ticket.id), before);
      status(await api('get', { cookie: admin.cookie, query: { id: project.id } }), 404);
    }
    assert.equal((await list(admin)).length, 1);
    assert.notEqual((await create(viewer)).id, ticket.id);
  });

  await t.test('Der Browserhelfer zählt UTF-8-Bytes und verhindert nicht wiederherstellbare komprimierte Sicherungen', async () => {
    const atLimit = 'x'.repeat(2_999_998); // Mit JSON-Anführungszeichen genau 3.000.000 Bytes.
    assert.equal(await encodeBackupPayload(atLimit), atLimit);
    const unicode = { text: 'ä'.repeat(1_500_001) };
    const encoded = await encodeBackupPayload(unicode);
    assert.equal(encoded.backupEncoding, 'gzip-base64');
    assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(encoded.data, 'base64')).toString('utf8')), unicode);
    const incompressible = { text: randomBytes(3_100_000).toString('base64') };
    await assert.rejects(encodeBackupPayload(incompressible), /komprimiert zu groß/);
    assert.throws(() => prepareBackupExport(incompressible, (code, message) => { throw Object.assign(new Error(message), { code }); }), error => error.code === 413);
  });

  await t.test('Ticketverläufe über dem bisherigen Uploadlimit werden mit echtem gzip exportiert und per Browser-Envelope restauriert', async () => {
    const { admin } = await fixture();
    const ticket = await create(admin, { title: 'Langer aber vollständig sicherbarer Ticketverlauf', description: 'x'.repeat(10000) });
    const first = (await detail(admin, ticket.id)).events[0];
    // Reale, zusammenhängende Historie als Fixture; 420 HTTP-Änderungen wären für
    // diesen Transporttest unnötig. Alle Snapshots entsprechen dem aktuellen Ticket.
    const versions = 420;
    for (let version = 2; version <= versions; version++) {
      const event = { ...first, version, kind: 'updated' };
      await q('INSERT INTO tp_ticket_events (ticket_key,version,json) VALUES ($1,$2,$3)', [ticket.id, version, JSON.stringify(event)]);
    }
    await q('UPDATE tp_tickets SET version=$1 WHERE ticket_key=$2', [versions, ticket.id]);
    const wire = await rawExport(admin);
    assert.equal(wire.status, 200);
    assert.equal(wire.headers['content-encoding'], 'gzip');
    assert.match(wire.headers['content-disposition'], /\.json"$/);
    assert.match(wire.headers['content-type'], /application\/json/);
    assert.deepEqual([...wire.body.subarray(0, 2)], [0x1f, 0x8b]);
    const json = gunzipSync(wire.body);
    assert.ok(json.length > 4_200_000);
    const backup = JSON.parse(json.toString('utf8'));
    assert.equal(backup.ticketEvents.length, versions);
    // fetch muss dieselbe Übertragung selbstständig zur lesbaren JSON-Datei entpacken.
    const automatic = status(await api('export', { cookie: admin.cookie }), 200);
    assert.deepEqual(automatic.tickets, backup.tickets);
    assert.deepEqual(automatic.ticketEvents, backup.ticketEvents);
    status(await api('export', { cookie: admin.cookie, headers: { 'Accept-Encoding': 'identity' } }), 406);
    status(await api('export', { cookie: admin.cookie, headers: { 'Accept-Encoding': 'gzip;q=0, *;q=1' } }), 406);
    const current = (await list(admin))[0];
    const changed = status(await update(admin, current, { status: 'done', response: 'Änderung nach der Sicherung' }), 200).ticket;
    // Genau wie die Verwaltungsseite unmittelbar vor dem Upload neu lesen.
    backup.ticketBases = Object.fromEntries((await list(admin)).map(row => [row.id, row.version]));
    const payload = await encodeBackupPayload(backup);
    assert.equal(payload.backupEncoding, 'gzip-base64');
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 4_200_000);
    assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(payload.data, 'base64')).toString('utf8')), backup);
    status(await api('import', { cookie: admin.cookie, body: payload }), 200);
    const restored = await detail(admin, ticket.id);
    assert.equal(restored.ticket.version, changed.version + 1);
    assert.equal(restored.ticket.status, 'new');
    assert.equal(restored.ticket.response, '');
    assert.equal(restored.events.length, versions + 2);
    assert.equal(byVersion(restored.events).at(-1).kind, 'restored');
    assert.deepEqual(byVersion(restored.events).slice(0, versions), backup.ticketEvents.map(({ ticketId, ...event }) => event));
  });

  await t.test('Komprimierte Sicherungen prüfen Anmeldung, Administratorrolle und CSRF vor dem Entpacken', async () => {
    const { admin, editor, viewer } = await fixture();
    const payload = { backupEncoding: 'gzip-base64', data: 'defektes gzip' };
    status(await api('import', { body: payload }), 401);
    for (const user of [editor, viewer]) status(await api('import', { cookie: user.cookie, body: payload }), 403);
    status(await api('import', { cookie: admin.cookie, body: payload, headers: { 'X-TP': '' } }), 403);
    assert.equal((await list(admin)).length, 0);
  });

  await t.test('Defekte, verschachtelte und übergroße gzip-Sicherungen schreiben keine Daten', async () => {
    const { admin, viewer } = await fixture();
    const ticket = await create(viewer);
    const before = await detail(admin, ticket.id);
    const invalid = [
      { backupEncoding: 'zip-base64', data: 'AAAA' },
      { backupEncoding: 'gzip-base64', data: null },
      { backupEncoding: 'gzip-base64', data: '' },
      { backupEncoding: 'gzip-base64', data: 'AAAA!' },
      { backupEncoding: 'gzip-base64', data: 'AB==' }, // Nichtkanonische Base64-Paddingbits.
      { backupEncoding: 'gzip-base64', data: Buffer.from('Kein gzip').toString('base64') },
      { ...envelope({ format: 'terminplaner-sicherung', v: 1, projects: [] }), forbidden: true },
      envelope('kein JSON'),
      envelope(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])), // Ungültiges UTF-8.
      envelope({ backupEncoding: 'gzip-base64', data: 'AAAA' }),
      envelope([])
    ];
    for (const payload of invalid) {
      status(await api('import', { cookie: admin.cookie, body: payload }), 400);
      assert.deepEqual(await detail(admin, ticket.id), before);
    }
    const compressedLimit = { backupEncoding: 'gzip-base64', data: randomBytes(3_000_001).toString('base64') };
    status(await api('import', { cookie: admin.cookie, body: compressedLimit }), 413);
    const bomb = envelope(Buffer.alloc(64_000_001, 0x20));
    assert.ok(Buffer.from(bomb.data, 'base64').length < 3_000_000);
    status(await api('import', { cookie: admin.cookie, body: bomb }), 413);
    assert.deepEqual(await detail(admin, ticket.id), before);
    // Auch eine kleine V1-Sicherung darf gültig komprimiert transportiert werden.
    status(await api('import', { cookie: admin.cookie, body: envelope({ format: 'terminplaner-sicherung', v: 1, projects: [] }) }), 200);
    assert.deepEqual(await detail(admin, ticket.id), before);
  });
});
