const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { newDb } = require('pg-mem');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function ticketForm() {
  const nodes = new Map(), calls = [], kinds = [{ disabled: false }];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', disabled: false, checked: true, events: {},
      classList: { add() {}, remove() {} }, focus() {}, addEventListener(name, handler) { this.events[name] = handler; }, querySelectorAll: () => kinds });
    return nodes.get(id);
  };
  node('tSend').textContent = 'An die Administratoren senden';
  let listFails = false;
  const source = fs.readFileSync(path.join(__dirname, 'server-api.js'), 'utf8');
  const context = vm.createContext({ crypto: { randomUUID }, window: { __cur: () => 'project' }, document: { getElementById: node }, esc: String,
    dialog: () => ({ el: { querySelector: selector => node(selector.slice(1)) } }),
    api: async () => { if (listFails) throw new Error('offline'); return { ok: true, json: async () => ({ tickets: [] }) }; },
    post: (action, body) => new Promise((resolve, reject) => calls.push({ action, body: JSON.parse(JSON.stringify(body)), resolve, reject })) });
  vm.runInContext(source.slice(source.indexOf('  const KINDS ='), source.indexOf('  function chips(')), context);
  return { node, calls, kinds, open: () => vm.runInContext('ticketDialog()', context), click: () => node('tSend').events.click(), failList: () => { listFails = true; } };
}
const response = (ok = true) => ({ ok, json: async () => ok ? { id: 1 } : { error: 'Testfehler' } });

test('Zwei schnelle Klicks senden nur einmal und sperren Button sowie Eingabefelder bis zur Antwort', async () => {
  const form = ticketForm(); await form.open(); form.node('tTitle').value = 'Verbesserung'; form.node('tBody').value = 'Beschreibung';
  const first = form.click(); await form.click();
  assert.equal(form.calls.length, 1); assert.equal(form.node('tSend').disabled, true);
  assert.equal(form.node('tTitle').disabled, true); assert.equal(form.node('tBody').disabled, true); assert.equal(form.kinds[0].disabled, true);
  assert.match(form.node('tSend').textContent, /gesendet/);
  form.calls[0].resolve(response()); await first;
  assert.equal(form.node('tSend').disabled, false); assert.equal(form.node('tTitle').disabled, false);
  assert.equal(form.node('tSend').textContent, 'An die Administratoren senden'); assert.equal(form.node('tTitle').value, '');
});

test('Nach Netzwerk- oder Serverfehlern bleibt dieselbe Anfragekennung für unveränderte Eingaben erhalten', async () => {
  const form = ticketForm(); await form.open(); form.node('tTitle').value = 'Verbesserung';
  let pending = form.click(); const key = form.calls[0].body.requestId;
  form.calls[0].reject(new Error('Antwort verloren')); await pending;
  assert.equal(form.node('tSend').disabled, false); assert.equal(form.node('tTitle').value, 'Verbesserung');
  pending = form.click(); assert.equal(form.calls[1].body.requestId, key); form.calls[1].resolve(response(false)); await pending;
  pending = form.click(); assert.equal(form.calls[2].body.requestId, key); form.calls[2].resolve(response()); await pending;
  form.node('tTitle').value = 'Verbesserung'; pending = form.click();
  assert.notEqual(form.calls[3].body.requestId, key); form.calls[3].resolve(response()); await pending;
});

test('Geänderte Inhalte erhalten eine neue Kennung; ein Listenfehler macht erfolgreichen Versand nicht rückgängig', async () => {
  const form = ticketForm(); await form.open(); form.node('tTitle').value = 'Verbesserung';
  let pending = form.click(); form.calls[0].reject(new Error('offline')); await pending;
  form.node('tBody').value = 'Neue Beschreibung'; pending = form.click();
  assert.notEqual(form.calls[1].body.requestId, form.calls[0].body.requestId);
  form.failList(); form.calls[1].resolve(response()); await pending;
  assert.equal(form.node('tMsg').textContent, 'Danke, ist angekommen.'); assert.match(form.node('tList').textContent, /Ticket gesendet/);
});

test('Auch der Admin-Speicherbutton verhindert parallele Updates und wird nach Fehlern wieder freigegeben', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8'), calls = [];
  const controls = [{ disabled: false, value: 'arbeit' }, { disabled: false, value: 'Antwort' }];
  const card = { dataset: { id: '7' }, querySelectorAll: () => controls, querySelector: selector => controls[selector.includes('status') ? 0 : 1] };
  const button = { dataset: { act: 'tsave' }, disabled: false, textContent: 'Speichern', closest: () => card }; controls.push(button);
  let click;
  const context = vm.createContext({ $: () => ({ addEventListener: (name, handler) => { click = handler; } }),
    post: (action, body) => new Promise((resolve, reject) => calls.push({ action, body, resolve, reject })), say() {}, tickets: async () => {} });
  vm.runInContext(source.slice(source.indexOf('const savingTickets ='), source.indexOf('/* E-Mail */')), context);
  const event = { target: { closest: () => button } };
  let pending = click(event); await click(event); assert.equal(calls.length, 1); assert.equal(button.disabled, true);
  calls[0].reject(new Error('offline')); await pending; assert.equal(button.disabled, false);
  pending = click(event); assert.equal(calls.length, 2); calls[1].resolve(response()); await pending; assert.equal(button.disabled, false);
});

test('Ticket-API sichert Wiederholungen über die Datenbank ab und benachrichtigt jede Mailadresse einmal', async t => {
  process.env.SESSION_SECRET = 'ticket-tests-only-secret-longer-than-32-characters';
  process.env.MAIL_TRANSPORT = 'log'; process.env.MAIL_FROM = 'tickets@example.test';
  const { setPool, ensureSchema, q } = await import('../lib/db.js');
  const { csrfToken } = await import('../lib/auth.js');
  const { sha256 } = await import('../lib/security.js');
  const { sentMails } = await import('../lib/mail.js');
  const { default: handler } = await import('../lib/handler.js');
  const { Pool } = newDb().adapters.createPg(); const pool = new Pool(); setPool(pool);
  await ensureSchema();
  const addUser = async (name, role, email) => (await q('INSERT INTO tp_users (name,pass_hash,role,created_at,email) VALUES ($1,$2,$3,$4,$5) RETURNING id', [name, 'test-only', role, 1, email])).rows[0].id;
  const author = await addUser('Autor', 'editor', 'author@example.test'), other = await addUser('Anderer Autor', 'editor', 'other@example.test');
  const admin = await addUser('Admin A', 'admin', ' TEAM@example.test ');
  await addUser('Admin B', 'admin', 'team@example.test'); await addUser('Admin C', 'admin', 'second@example.test');
  const sessions = new Map();
  for (const user of [author, other, admin]) {
    const raw = randomUUID() + randomUUID(); sessions.set(user, raw);
    await q('INSERT INTO tp_sessions (id,user_id,created_at,last_seen) VALUES ($1,$2,$3,$3)', [sha256(raw), user, Math.floor(Date.now() / 1000)]);
  }
  const call = async (action, body, user = author, headers = {}) => {
    const res = { statusCode: 200, setHeader() {}, getHeader() {}, end(value) { this.body = JSON.parse(value); } };
    const raw = sessions.get(user);
    await handler({ url: '/api/tp?a=' + action, method: body === undefined ? 'GET' : 'POST', headers: { host: 'localhost', origin: 'http://localhost', 'x-tp': '1', 'x-csrf': csrfToken(sha256(raw)), cookie: 'tp_sid=' + raw, ...headers }, body }, res);
    return { status: res.statusCode, ...res.body };
  };
  const input = () => ({ kind: 'idee', title: 'Kleine Verbesserung', body: 'Details', projectId: null, requestId: randomUUID() });
  t.beforeEach(() => q('DELETE FROM tp_rate'));
  try {
    await t.test('Acht gleichzeitige identische Requests ergeben eine Ticket-ID und eine Mail pro Postfach', async () => {
      const body = input(), before = sentMails().length;
      const results = await Promise.all(Array.from({ length: 8 }, () => call('ticket_new', body)));
      assert.ok(results.every(result => result.status === 200)); assert.equal(new Set(results.map(result => result.id)).size, 1);
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM tp_tickets')).rows[0].n, 1);
      assert.deepEqual(sentMails().slice(before).map(mail => mail.to.toLowerCase()).sort(), ['second@example.test', 'team@example.test']);
      const retry = await call('ticket_new', body); assert.equal(retry.id, results[0].id); assert.equal(sentMails().length - before, 2);
      const list = await call('tickets', undefined); assert.equal(list.tickets.length, 1);
    });
    await t.test('Eine Kennung darf keine anderen Inhalte überschreiben oder weitere Mails auslösen', async () => {
      const body = input(), original = await call('ticket_new', body), before = sentMails().length;
      const conflict = await call('ticket_new', { ...body, title: 'Anderer Inhalt' });
      assert.equal(conflict.status, 409); assert.equal(sentMails().length, before);
      const stored = (await q('SELECT title FROM tp_tickets WHERE id=$1', [original.id])).rows[0]; assert.equal(stored.title, body.title);
    });
    await t.test('Absichtlich neue Übermittlungen und verschiedene Benutzer bleiben voneinander unabhängig', async () => {
      const first = input(), a = await call('ticket_new', first), b = await call('ticket_new', input()), c = await call('ticket_new', first, other);
      assert.equal(new Set([a.id, b.id, c.id]).size, 3);
    });
    await t.test('Fehlende oder ungültige Kennungen werden ohne Ticketerstellung abgewiesen', async () => {
      const before = (await q('SELECT COUNT(*)::int AS n FROM tp_tickets')).rows[0].n;
      assert.equal((await call('ticket_new', { ...input(), requestId: '' })).status, 400);
      assert.equal((await call('ticket_new', { ...input(), requestId: 'kurz' })).status, 400);
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM tp_tickets')).rows[0].n, before);
    });
    await t.test('Wiederholungen bleiben bei ausgeschöpftem Kontingent möglich, neue Tickets werden begrenzt', async () => {
      const body = input(), original = await call('ticket_new', body), before = sentMails().length;
      for (let i = 0; i < 10; i++) await q('INSERT INTO tp_rate (k,at) VALUES ($1,$2)', ['ticket:' + author, Math.floor(Date.now() / 1000)]);
      assert.equal((await call('ticket_new', body)).id, original.id);
      assert.equal((await call('ticket_new', input())).status, 429);
      assert.equal(sentMails().length, before);
    });
    await t.test('Auch Wiederholungen benötigen eine gültige Sitzung und CSRF-Kennung', async () => {
      const body = input(); await call('ticket_new', body); const before = sentMails().length;
      assert.equal((await call('ticket_new', body, author, { cookie: '' })).status, 401);
      assert.equal((await call('ticket_new', body, author, { 'x-csrf': '' })).status, 403);
      assert.equal(sentMails().length, before);
    });
    await t.test('Parallele identische Statusupdates benachrichtigen den Autor nur einmal', async () => {
      const ticket = await call('ticket_new', input()), before = sentMails().length;
      const update = { id: ticket.id, status: 'arbeit', note: 'Wird geprüft' };
      const results = await Promise.all(Array.from({ length: 5 }, () => call('ticket_update', update, admin)));
      assert.ok(results.every(result => result.status === 200)); assert.equal(sentMails().length - before, 1);
      assert.equal(sentMails().at(-1).to, 'author@example.test');
      await call('ticket_update', update, admin); assert.equal(sentMails().length - before, 1);
      await call('ticket_update', { ...update, note: 'Neue Antwort' }, admin); assert.equal(sentMails().length - before, 2);
    });
  } finally { await pool.end(); }
});
