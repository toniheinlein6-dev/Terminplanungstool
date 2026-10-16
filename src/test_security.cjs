// Sicherheitstests gegen die Server-Schnittstelle (Datenbank im Arbeitsspeicher, keine echten Mails)
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { newDb } = require('pg-mem');

process.env.SESSION_SECRET = 'security-test-only-session-secret-at-least-32-chars';
process.env.MAIL_TRANSPORT = 'log';
process.env.MAIL_FROM = 'test@example.test';
process.env.APP_URL = 'https://planer.example.test';
process.env.PWNED_CHECK = 'off';
process.env.CRON_SECRET = 'cron-secret-for-tests-123';

let M;   // geladene Module
const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', f));
const dataUrl = (f, mime) => 'data:' + mime + ';base64,' + fx(f).toString('base64');

async function setup() {
  if (M) return M;
  const db = await import('../lib/db.js');
  const mem = newDb(); const { Pool } = mem.adapters.createPg(); db.setPool(new Pool());
  await db.ensureSchema();
  M = { db, q: db.q, auth: await import('../lib/auth.js'), sec: await import('../lib/security.js'), mail: await import('../lib/mail.js'),
    handler: (await import('../lib/handler.js')).default, cron: (await import('../api/cron-reminders.js')).default };
  return M;
}
// Ein „Browser“: merkt sich Cookies und CSRF-Token wie die echte Seite
function browser(extra = {}) {
  const jar = {}; let csrf = '';
  async function call(action, body, { params = '', headers = {}, method } = {}) {
    const { handler } = await setup();
    const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; }, end(v) { this.raw = v; } };
    const cookie = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
    const req = { url: '/api/tp?a=' + action + params, method: method || (body === undefined ? 'GET' : 'POST'), socket: { remoteAddress: extra.ip || '10.0.0.1' },
      headers: Object.assign({ host: 'localhost:3000', 'x-tp': '1', 'x-csrf': csrf, origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin', cookie }, headers), body };
    await handler(req, res);
    for (const c of [].concat(res.h['set-cookie'] || [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0/.test(c)) delete jar[k]; else jar[k] = v; }
    let json = null; try { json = JSON.parse(res.raw); } catch (e) { }
    if (json && json.csrf) csrf = json.csrf;
    return { status: res.statusCode, body: json, headers: res.h, setCookie: [].concat(res.h['set-cookie'] || []) };
  }
  return { call, jar, setCsrf: v => { csrf = v; }, get csrf() { return csrf; } };
}
async function addUser(name, pw, role = 'editor', email = null) {
  const { q, auth } = await setup();
  return (await q('INSERT INTO tp_users (name, pass_hash, role, created_at, email) VALUES ($1,$2,$3,$4,$5) RETURNING id', [name, await auth.hashPw(pw), role, 1, email])).rows[0].id;
}
const PW = 'ein langes sicheres Passwort 42';

test('Anmeldung: Cookie-Attribute, CSRF-Token, gleiche Meldung für unbekannte Namen', async () => {
  await addUser('Anna', PW, 'admin');
  const b = browser();
  const bad1 = await b.call('login', { name: 'Anna', password: 'falsch' }), bad2 = await b.call('login', { name: 'Niemand', password: 'falsch' });
  assert.equal(bad1.status, 401); assert.equal(bad2.status, 401); assert.equal(bad1.body.error, bad2.body.error);
  const ok = await b.call('login', { name: 'Anna', password: PW });
  assert.equal(ok.status, 200); assert.ok(ok.body.csrf && ok.body.csrf.length > 20);
  const c = ok.setCookie.find(x => x.startsWith('tp_sid='));
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.match(c, /Path=\//);
  // über HTTPS: __Host-Präfix und Secure
  const s = browser(); const r = await s.call('login', { name: 'Anna', password: PW }, { headers: { host: 'planer.example.test', origin: 'https://planer.example.test', 'x-forwarded-proto': 'https' } });
  const hc = r.setCookie.find(x => x.startsWith('__Host-tp_sid=')); assert.ok(hc); assert.match(hc, /Secure/);
  const me = await b.call('me'); assert.equal(me.status, 200); assert.equal(me.body.user.name, 'Anna');
  assert.equal(JSON.stringify(me.body).includes('pass_hash'), false);
});

test('Session-Fixation: jede Anmeldung erzeugt eine neue Sitzungs-ID', async () => {
  const b = browser(); await b.call('login', { name: 'Anna', password: PW }); const first = b.jar.tp_sid;
  await b.call('login', { name: 'Anna', password: PW }); assert.notEqual(b.jar.tp_sid, first);
  const { q, sec } = await setup();
  assert.equal((await q('SELECT 1 FROM tp_sessions WHERE id = $1', [sec.sha256(first)])).rows.length, 0, 'alte Sitzung entfernt');
});

test('CSRF: ohne Token, mit falschem Token, fremder Herkunft oder ohne X-TP abgewiesen', async () => {
  const b = browser(); await b.call('login', { name: 'Anna', password: PW });
  const good = b.csrf;
  b.setCsrf(''); assert.equal((await b.call('profile_save', { email: '' })).status, 403);
  b.setCsrf('x'.repeat(43)); assert.equal((await b.call('profile_save', { email: '' })).status, 403);
  b.setCsrf(good);
  assert.equal((await b.call('profile_save', { email: '' }, { headers: { origin: 'https://boese.example' } })).status, 403);
  assert.equal((await b.call('profile_save', { email: '' }, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await b.call('profile_save', { email: '' }, { headers: { 'x-tp': '' } })).status, 403);
  assert.equal((await b.call('profile_save', { email: '' })).status, 200);
  // Token einer anderen Sitzung gilt nicht
  const c = browser(); await c.call('login', { name: 'Anna', password: PW });
  b.setCsrf(c.csrf); assert.equal((await b.call('profile_save', { email: '' })).status, 403);
  // Zustandsändernde Aktion per GET nicht möglich
  b.setCsrf(good); assert.equal((await b.call('profile_save', undefined)).status, 405);
});

test('Brute-Force: Konto nach 10 Fehlversuchen 15 Minuten gesperrt, andere Konten nicht', async () => {
  await addUser('Bert', PW);
  const b = browser({ ip: '10.0.0.77' });
  for (let i = 0; i < 10; i++) assert.equal((await b.call('login', { name: 'Bert', password: 'RatePw-' + i })).status, 401);
  assert.equal((await b.call('login', { name: 'Bert', password: PW })).status, 429, 'auch mit richtigem Passwort gesperrt');
  const other = browser({ ip: '10.0.0.78' }); assert.equal((await other.call('login', { name: 'Anna', password: PW })).status, 200);
  const { q } = await setup();
  const logs = (await q("SELECT detail FROM tp_seclog WHERE kind IN ('login_fail','rate_limit')")).rows.map(x => x.detail).join(' ');
  assert.equal(logs.includes('RatePw'), false, 'kein Passwort im Protokoll');
});

test('SQL-Injection in Anmeldung und Filtern bleibt wirkungslos', async () => {
  const b = browser({ ip: '10.0.0.90' });
  assert.equal((await b.call('login', { name: "' OR '1'='1' --", password: "' OR '1'='1" })).status, 401);
  const a = browser(); await a.call('login', { name: 'Anna', password: PW });
  const r = await a.call('changes_log', undefined, { params: "&p=x'%20OR%201=1--&u=1;DROP%20TABLE%20tp_users&n=5" });
  assert.equal(r.status, 200);
  const { q } = await setup(); assert.ok((await q('SELECT COUNT(*)::int AS n FROM tp_users')).rows[0].n >= 2);
});

test('Passwortrichtlinie, Passwortwechsel beendet andere Sitzungen', async () => {
  await addUser('Carla', PW);
  const b1 = browser(), b2 = browser();
  await b1.call('login', { name: 'Carla', password: PW }); await b2.call('login', { name: 'Carla', password: PW });
  assert.equal((await b1.call('password', { old: PW, password: 'kurz' })).status, 400);
  assert.equal((await b1.call('password', { old: PW, password: 'aaaaaaaaaaaaaaa' })).status, 400);
  assert.equal((await b1.call('password', { old: PW, password: 'carla ist mein langes passwort' })).status, 400, 'Name im Passwort');
  assert.equal((await b1.call('password', { old: 'falsch', password: 'neues langes Passwort 2026' })).status, 403);
  const old = b1.csrf;
  const ok = await b1.call('password', { old: PW, password: 'neues langes Passwort 2026' });
  assert.equal(ok.status, 200); assert.notEqual(ok.body.csrf, old, 'neues CSRF-Token');
  assert.equal((await b1.call('me')).status, 200, 'dieses Gerät bleibt angemeldet');
  assert.equal((await b2.call('me')).status, 401, 'anderes Gerät abgemeldet');
});

test('Abmelden löscht die Sitzung serverseitig', async () => {
  const b = browser(); await b.call('login', { name: 'Anna', password: PW });
  const sid = b.jar.tp_sid;
  assert.equal((await b.call('logout', {})).status, 200);
  const replay = browser(); replay.jar.tp_sid = sid;
  assert.equal((await replay.call('me')).status, 401, 'gestohlenes Cookie nach Abmelden wertlos');
});

test('Inaktivität und absolute Laufzeit beenden die Sitzung', async () => {
  const { q, sec, auth } = await setup();
  const b = browser(); await b.call('login', { name: 'Anna', password: PW });
  await q('UPDATE tp_sessions SET last_seen = $1 WHERE id = $2', [Math.floor(Date.now() / 1000) - auth.IDLE - 10, sec.sha256(b.jar.tp_sid)]);
  assert.equal((await b.call('me')).status, 401);
  const c = browser(); await c.call('login', { name: 'Anna', password: PW });
  await q('UPDATE tp_sessions SET created_at = $1 WHERE id = $2', [Math.floor(Date.now() / 1000) - auth.ABS - 10, sec.sha256(c.jar.tp_sid)]);
  assert.equal((await c.call('me')).status, 401);
});

test('Alte Passwort-Hashes funktionieren weiter und werden beim Anmelden erneuert', async () => {
  const crypto = require('node:crypto'); const { q } = await setup();
  const salt = crypto.randomBytes(16), key = crypto.scryptSync('altes Passwort 12', salt, 64, { N: 16384, r: 8, p: 1 });
  await q('INSERT INTO tp_users (name, pass_hash, role, created_at) VALUES ($1,$2,$3,$4)', ['Dora', 'scrypt$' + salt.toString('hex') + '$' + key.toString('hex'), 'viewer', 1]);
  const b = browser(); assert.equal((await b.call('login', { name: 'Dora', password: 'altes Passwort 12' })).status, 200);
  assert.match((await q("SELECT pass_hash FROM tp_users WHERE name = 'Dora'")).rows[0].pass_hash, /^scrypt\$131072\$8\$1\$/);
  assert.equal((await browser().call('login', { name: 'Dora', password: 'altes Passwort 12' })).status, 200);
});

test('Alte Anmelde-Cookies werden einmalig in eine Sitzung überführt', async () => {
  const crypto = require('node:crypto'); const { q } = await setup();
  const u = (await q("SELECT id, token_ver FROM tp_users WHERE name = 'Anna'")).rows[0];
  const payload = u.id + '.' + u.token_ver + '.' + (Date.now() + 3600e3);
  const tok = payload + '.' + crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  const b = browser(); b.jar.tp_session = tok;
  const r = await b.call('me'); assert.equal(r.status, 200); assert.ok(b.jar.tp_sid); assert.equal(b.jar.tp_session, undefined);
  const forged = browser(); forged.jar.tp_session = payload + '.gefälscht'; assert.equal((await forged.call('me')).status, 401);
});

test('Rollen: Lesen darf nicht speichern, „Nur Gantt“ sieht keine Kommentare und bekommt gekürzte Pläne', async () => {
  const { q } = await setup();
  await addUser('Vera', PW, 'viewer'); await addUser('Gina', PW, 'gantt');
  const ed = browser(); await ed.call('login', { name: 'Anna', password: PW });
  const plan = { name: 'P', rows: [{ id: 1, type: 'vorgang', name: 'A', desc: 'intern' }], tasks: [{ id: 1, title: 'geheim' }], org: [{ id: 1, kind: 'person', name: 'X' }] };
  assert.equal((await ed.call('put', { id: 'p1', base: 0, json: JSON.stringify(plan) })).status, 200);
  const v = browser(); await v.call('login', { name: 'Vera', password: PW });
  assert.equal((await v.call('put', { id: 'p1', base: 1, json: JSON.stringify(plan) })).status, 403);
  assert.equal((await v.call('del', { id: 'p1' })).status, 403);
  assert.equal((await v.call('users')).status, 403);
  const g = browser(); await g.call('login', { name: 'Gina', password: PW });
  assert.equal((await g.call('comments', undefined, { params: '&p=p1&r=1' })).status, 403);
  const got = JSON.parse((await g.call('get', undefined, { params: '&id=p1' })).body.json);
  assert.deepEqual(got.tasks, []); assert.deepEqual(got.org, []); assert.equal(got.rows[0].desc, '');
  assert.ok((await q("SELECT COUNT(*)::int AS n FROM tp_seclog WHERE kind = 'forbidden'")).rows[0].n >= 3);
});

test('IDOR: fremde Kommentare löschen und fremde Tickets lesen nicht möglich', async () => {
  const a = browser(); await a.call('login', { name: 'Anna', password: PW });
  await a.call('comment_new', { projectId: 'p1', rowId: 1, body: 'von Anna' });
  await a.call('ticket_new', { kind: 'idee', title: 'Annas Ticket', body: 'privat', requestId: 'security-test-ticket-1' });
  const { q } = await setup(); const cid = (await q("SELECT id FROM tp_comments WHERE body = 'von Anna'")).rows[0].id;
  await addUser('Emil', PW, 'editor');
  const e = browser(); await e.call('login', { name: 'Emil', password: PW });
  assert.equal((await e.call('comment_del', { id: cid })).status, 403);
  const t = await e.call('tickets'); assert.equal(t.body.tickets.some(x => x.title === 'Annas Ticket'), false);
  const md = await e.call('my_data'); assert.equal(md.status, 200); assert.equal(JSON.stringify(md.body).includes('von Anna'), false);
  assert.equal((await e.call('profile_save', { email: '', role: 'admin', id: 1 })).status, 200);
  assert.equal((await q("SELECT role FROM tp_users WHERE name = 'Emil'")).rows[0].role, 'editor', 'kein Mass Assignment');
});

test('Profilbilder: echte Bilder, Metadaten entfernt; SVG, Fälschungen und Riesenmaße abgelehnt', async () => {
  const b = browser(); await b.call('login', { name: 'Anna', password: PW });
  const { q } = await setup();
  assert.equal((await b.call('profile_save', { email: '', avatar: dataUrl('exif.jpg', 'image/jpeg') })).status, 200);
  const stored = Buffer.from((await q("SELECT avatar FROM tp_users WHERE name = 'Anna'")).rows[0].avatar.split(',')[1], 'base64');
  assert.equal(stored.includes('Exif'), false); assert.equal(stored.includes('TestCam'), false); assert.equal(stored[0], 0xff);
  assert.equal((await b.call('profile_save', { email: '', avatar: dataUrl('text.png', 'image/png') })).status, 200);
  assert.equal(Buffer.from((await q("SELECT avatar FROM tp_users WHERE name = 'Anna'")).rows[0].avatar.split(',')[1], 'base64').includes('geheim'), false);
  assert.equal((await b.call('profile_save', { email: '', avatar: dataUrl('ok.webp', 'image/webp') })).status, 200);
  assert.equal((await b.call('profile_save', { email: '', avatar: 'data:image/svg+xml;base64,' + Buffer.from('<svg onload="alert(1)"/>').toString('base64') })).status, 400);
  assert.equal((await b.call('profile_save', { email: '', avatar: 'data:image/jpeg;base64,' + Buffer.from('<?php system($_GET[1]); ?>').toString('base64') })).status, 400);
  assert.equal((await b.call('profile_save', { email: '', avatar: dataUrl('wide.png', 'image/png') })).status, 400, 'über 1024 Pixel');
  assert.equal((await b.call('profile_save', { email: '', avatar: 'javascript:alert(1)' })).status, 400);
  assert.ok((await q("SELECT COUNT(*)::int AS n FROM tp_seclog WHERE kind = 'upload_reject'")).rows[0].n >= 4);
  // Organigramm-Fotos im Plan: ungültige werden beim Speichern verworfen, gültige bereinigt
  const plan = { name: 'Org', rows: [], org: [{ id: 1, kind: 'person', name: 'A', photo: 'data:image/svg+xml;base64,PHN2Zz4=' }, { id: 2, kind: 'person', name: 'B', photo: dataUrl('exif.jpg', 'image/jpeg') }] };
  await b.call('put', { id: 'orgtest', base: 0, json: JSON.stringify(plan) });
  const org = JSON.parse((await q("SELECT json FROM tp_projects WHERE id = 'orgtest'")).rows[0].json).org;
  assert.equal(org[0].photo, ''); assert.ok(org[1].photo.startsWith('data:image/jpeg')); assert.equal(Buffer.from(org[1].photo.split(',')[1], 'base64').includes('TestCam'), false);
});

test('E-Mail-Adresse ändern nur mit Passwort, alte Adresse wird benachrichtigt', async () => {
  await addUser('Fritz', PW, 'editor', 'fritz@example.test');
  const b = browser(); await b.call('login', { name: 'Fritz', password: PW });
  assert.equal((await b.call('profile_save', { email: 'neu@example.test' })).status, 403);
  assert.equal((await b.call('profile_save', { email: 'neu@example.test', password: 'falsch' })).status, 403);
  assert.equal((await b.call('profile_save', { email: 'a@b@c', password: PW })).status, 400);
  assert.equal((await b.call('profile_save', { email: 'neu@example.test', password: PW })).status, 200);
  assert.ok(M.mail.sentMails().some(m => m.to === 'fritz@example.test' && /geändert/.test(m.subject)));
});

test('Passwort vergessen: gleiche Antwort, Token einmalig, kurzlebig, beendet Sitzungen', async () => {
  const { q, mail } = await setup();
  const b = browser({ ip: '10.0.1.1' });
  const unknown = await b.call('reset_request', { name: 'gibt-es-nicht' }), known = await b.call('reset_request', { name: 'neu@example.test' });
  assert.equal(unknown.status, 200); assert.equal(unknown.body.message, known.body.message);
  const m = mail.sentMails().filter(x => x.to === 'neu@example.test' && /zurücksetzen/.test(x.subject)).pop(); assert.ok(m);
  const token = /#reset=([A-Za-z0-9_-]+)/.exec(m.text)[1];
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM tp_resets WHERE id = $1', [token])).rows[0].n, 0, 'nur Hash gespeichert');
  const s = browser(); await s.call('login', { name: 'Fritz', password: PW });
  assert.equal((await b.call('reset_confirm', { token, password: 'kurz' })).status, 400);
  assert.equal((await b.call('reset_confirm', { token, password: 'ganz neues Passwort fuer F. 2026!' })).status, 200);
  assert.equal((await s.call('me')).status, 401, 'Sitzungen beendet');
  assert.equal((await b.call('reset_confirm', { token, password: 'noch ein anderes Passwort 99' })).status, 400, 'nur einmal gültig');
  assert.equal((await browser().call('login', { name: 'Fritz', password: 'ganz neues Passwort fuer F. 2026!' })).status, 200);
  // abgelaufen
  await b.call('reset_request', { name: 'Fritz' });
  const t2 = /#reset=([A-Za-z0-9_-]+)/.exec(mail.sentMails().filter(x => x.to === 'neu@example.test').pop().text)[1];
  await q('UPDATE tp_resets SET expires_at = 1');
  assert.equal((await b.call('reset_confirm', { token: t2, password: 'ganz neues Passwort 2027!' })).status, 400);
});

test('Rollenwechsel beendet die Sitzungen des Benutzers', async () => {
  const a = browser(); await a.call('login', { name: 'Anna', password: PW });
  const e = browser(); await e.call('login', { name: 'Emil', password: PW });
  const { q } = await setup(); const id = (await q("SELECT id FROM tp_users WHERE name = 'Emil'")).rows[0].id;
  assert.equal((await a.call('user_save', { id, name: 'Emil', email: '', role: 'viewer', password: '' })).status, 200);
  assert.equal((await e.call('me')).status, 401);
  assert.equal((await a.call('user_save', { name: 'Neu', email: '', role: 'editor', password: 'kurz' })).status, 400, 'Richtlinie auch für Admins');
  assert.equal((await a.call('user_save', { name: '<img src=x>', email: '', role: 'editor', password: 'langes Passwort 12345' })).status, 400);
});

test('Benutzer löschen anonymisiert Verweise und auf Wunsch die Pläne', async () => {
  const { q } = await setup();
  const id = await addUser('Hanna', PW, 'editor');
  const h = browser(); await h.call('login', { name: 'Hanna', password: PW });
  await h.call('comment_new', { projectId: 'p1', rowId: 1, body: 'Hannas Kommentar' });
  const a = browser(); await a.call('login', { name: 'Anna', password: PW });
  const cur = JSON.parse((await a.call('get', undefined, { params: '&id=p1' })).body.json), ver = (await a.call('get', undefined, { params: '&id=p1' })).body.version;
  cur.rows[0].assignees = [{ id: String(id), name: 'Hanna' }]; cur.org = [{ id: 1, kind: 'person', name: 'Hanna', uid: String(id), photo: '' }];
  assert.equal((await a.call('put', { id: 'p1', base: ver, json: JSON.stringify(cur) })).status, 200);
  const r = await a.call('user_del', { id, anonymize: true }); assert.equal(r.status, 200); assert.ok(r.body.plans >= 1);
  const json = (await q("SELECT json FROM tp_projects WHERE id = 'p1'")).rows[0].json;
  assert.equal(json.includes('Hanna'), false); assert.ok(json.includes('Ehemaliges Mitglied'));
  assert.equal((await q("SELECT user_id FROM tp_comments WHERE body = 'Hannas Kommentar'")).rows[0].user_id, null);
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM tp_sessions WHERE user_id = $1', [id])).rows[0].n, 0);
  assert.equal((await q("SELECT COUNT(*)::int AS n FROM tp_history WHERE json LIKE '%Hanna%'")).rows[0].n, 0, 'alte Versionen mit dem Namen entfernt');
});

test('Datenauskunft enthält die eigenen Daten', async () => {
  const a = browser(); await a.call('login', { name: 'Anna', password: PW });
  const r = await a.call('my_data'); assert.equal(r.status, 200);
  assert.equal(r.body.konto.name, 'Anna'); assert.ok(r.body.kommentare.some(c => c.text === 'von Anna'));
  assert.match(r.headers['content-disposition'], /attachment/);
  assert.equal(JSON.stringify(r.body).includes('pass_hash'), false);
});

test('Sicherheitsprotokoll: nur Admins, ohne Passwörter, Tokens und E-Mail-Adressen; Cron nur mit Geheimnis', async () => {
  const { q, cron } = await setup();
  const all = (await q('SELECT kind, detail, ip FROM tp_seclog')).rows;
  const text = JSON.stringify(all);
  for (const bad of [PW, 'RatePw', 'neu@example.test', 'fritz@example.test', '10.0.0.']) assert.equal(text.includes(bad), false, bad);
  const v = browser(); await v.call('login', { name: 'Vera', password: PW });
  assert.equal((await v.call('seclog')).status, 403);
  const a = browser(); await a.call('login', { name: 'Anna', password: PW });
  const log = await a.call('seclog'); assert.equal(log.status, 200); assert.ok(log.body.entries.length > 5);
  const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, end(v) { this.body = v; } };
  await cron({ headers: { authorization: 'Bearer falsch' } }, res); assert.equal(res.statusCode, 401);
  const ok = { h: {}, setHeader(k, v) { this.h[k] = v; }, end(v) { this.body = v; } };
  await cron({ headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } }, ok); assert.equal(ok.statusCode, 200);
  assert.ok(JSON.parse(ok.body).cleanup);
});

test('Unbekannte Aktionen, Prototyp-Namen und falsche Methoden', async () => {
  const b = browser();
  assert.equal((await b.call('constructor')).status, 404);
  assert.equal((await b.call('__proto__')).status, 404);
  assert.equal((await b.call('me', undefined, { method: 'DELETE' })).status, 405);
  const r = await b.call('get', undefined, { params: '&id=../../etc/passwd' }); assert.ok(r.status === 400 || r.status === 401);
});
