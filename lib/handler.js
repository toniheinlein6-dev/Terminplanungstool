// Schnittstelle des Terminplaners: alle Aktionen über /api/tp?a=<aktion>
import crypto from 'node:crypto';
import { q, client, ensureSchema } from './db.js';
import { hashPw, verifyPw, setSession, clearSession, currentUser } from './auth.js';
import { sendMail, mailInfo, appUrl } from './mail.js';
import { runReminders, dueReminders, berlinToday } from './reminders.js';

const HISTORY = 40, MAX_JSON = 4_000_000;
const RANK = { viewer: 1, editor: 2, admin: 3 };
const okId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const now = () => Math.floor(Date.now() / 1000);
const iso = s => new Date(Number(s) * 1000).toISOString();

class HttpError extends Error { constructor(code, msg, extra) { super(msg); this.code = code; this.extra = extra; } }
const fail = (code, msg, extra) => { throw new HttpError(code, msg, extra); };

function send(res, code, data, headers) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
    return req.body;
  }
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_JSON + 200_000) fail(413, 'Zu groß'); chunks.push(c); }
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}
async function needPost(req) {
  if (req.method !== 'POST') fail(405, 'Methode nicht erlaubt');
  if (req.headers['x-tp'] !== '1') fail(403, 'csrf');            // nur aus der eigenen Seite
  let j; try { j = await readBody(req); } catch (e) { if (e instanceof HttpError) throw e; fail(400, 'Ungültige Anfrage'); }
  return j && typeof j === 'object' ? j : {};
}
async function needUser(req, min = 'viewer') {
  const u = await currentUser(req);
  if (!u) fail(401, 'login');
  if ((RANK[u.role] || 0) < RANK[min]) fail(403, 'forbidden');
  return u;
}
const userOut = u => ({ id: String(u.id), name: u.name, role: u.role });
const MAX_AVATAR = 150_000;
const okEmail = e => e === '' || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);
function cleanAvatar(a) {
  if (a == null || a === '') return null;
  a = String(a);
  if (a.length > MAX_AVATAR || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a)) fail(400, 'Profilbild ungültig oder zu groß');
  return a;
}
const TICKET_KINDS = { idee: 'Idee', problem: 'Problem', frage: 'Frage' };
const TICKET_STATES = { neu: 'Neu', arbeit: 'In Bearbeitung', erledigt: 'Erledigt', abgelehnt: 'Abgelehnt' };
async function mailQuiet(to, subject, text) { if (!to || !mailInfo().configured) return; try { await sendMail({ to, subject, text }); } catch (e) { console.error('Mail:', e.message); } }

async function projRow(id, db = { query: q }) {
  const r = await db.query('SELECT p.id, p.name, p.json, p.version, p.updated_at, p.updated_by, u.name AS by_name FROM tp_projects p LEFT JOIN tp_users u ON u.id = p.updated_by WHERE p.id = $1', [id]);
  return r.rows[0] || null;
}
const projOut = r => ({ id: r.id, json: r.json, version: Number(r.version), savedAt: iso(r.updated_at), by: r.updated_by == null ? null : String(r.updated_by), byName: r.by_name || null });

// Speichert mit Versionsprüfung: base = Version, auf der die Änderung beruht (0 = neu)
async function saveProject(id, json, base, uid) {
  let d; try { d = JSON.parse(json); } catch (e) { d = null; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.rows)) fail(400, 'Kein gültiger Terminplan');
  if (json.length > MAX_JSON) fail(413, 'Projekt zu groß');
  const name = (String(d.name || '').trim() || 'Ohne Namen').slice(0, 200), t = now();
  const c = await client();
  try {
    await c.query('BEGIN');
    let ver;
    if (base <= 0) {
      const ex = await c.query('SELECT 1 FROM tp_projects WHERE id = $1', [id]);
      if (ex.rows.length) { await c.query('ROLLBACK'); return [false, await projRow(id)]; }
      await c.query('INSERT INTO tp_projects (id, name, json, version, updated_at, updated_by) VALUES ($1,$2,$3,1,$4,$5)', [id, name, json, t, uid]);
      ver = 1;
    } else {
      const r = await c.query('UPDATE tp_projects SET name=$1, json=$2, version=version+1, updated_at=$3, updated_by=$4 WHERE id=$5 AND version=$6 RETURNING version', [name, json, t, uid, id, base]);
      if (r.rows.length !== 1) { await c.query('ROLLBACK'); return [false, await projRow(id)]; }
      ver = Number(r.rows[0].version);
    }
    await c.query('INSERT INTO tp_history (project_id, version, json, saved_at, user_id) VALUES ($1,$2,$3,$4,$5)', [id, ver, json, t, uid]);
    await c.query('DELETE FROM tp_history WHERE project_id=$1 AND version<=$2', [id, ver - HISTORY]);
    await c.query('COMMIT');
    return [true, ver];
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (x) { }
    const cur = await projRow(id); if (cur) return [false, cur];   // gleichzeitig angelegt
    throw e;
  } finally { c.release(); }
}

const actions = {
  async setup_state(req, res) {
    const r = await q('SELECT COUNT(*)::int AS n FROM tp_users');
    send(res, 200, { needsSetup: Number(r.rows[0].n) === 0, keySet: !!process.env.SETUP_KEY });
  },
  async setup(req, res) {
    const j = await needPost(req);
    const r = await q('SELECT COUNT(*)::int AS n FROM tp_users');
    if (Number(r.rows[0].n) > 0) fail(409, 'Der Terminplaner ist bereits eingerichtet.');
    const key = process.env.SETUP_KEY || '';
    if (key.length < 8) fail(400, 'In Vercel ist kein SETUP_KEY (mind. 8 Zeichen) hinterlegt.');
    const a = Buffer.from(String(j.key || '')), b = Buffer.from(key);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail(403, 'Einrichtungsschlüssel falsch.');
    const name = String(j.name || '').trim(), pw = String(j.password || '');
    if (name.length < 2 || name.length > 60) fail(400, 'Name: 2 bis 60 Zeichen');
    if (pw.length < 8) fail(400, 'Passwort: mindestens 8 Zeichen');
    const ins = await q('INSERT INTO tp_users (name, pass_hash, role, created_at) VALUES ($1,$2,$3,$4) RETURNING id, name, role, token_ver', [name, hashPw(pw), 'admin', now()]);
    const u = ins.rows[0]; setSession(req, res, Number(u.id), Number(u.token_ver));
    send(res, 200, { user: userOut(u) });
  },
  async me(req, res) {
    const u = await currentUser(req); if (!u) fail(401, 'login');
    const r = (await q('SELECT email, avatar, remind FROM tp_users WHERE id = $1', [u.id])).rows[0] || {};
    let openTickets = 0;
    if (u.role === 'admin') openTickets = Number((await q("SELECT COUNT(*)::int AS n FROM tp_tickets WHERE status IN ('neu','arbeit')")).rows[0].n);
    send(res, 200, { user: Object.assign(userOut(u), { email: r.email || '', avatar: r.avatar || null, remind: r.remind !== false }), openTickets, mail: mailInfo().configured });
  },
  // Name und Profilbild aller Teammitglieder (für Anzeige und Vorschläge bei „Verantwortlich“)
  async team(req, res) {
    await needUser(req);
    const r = await q('SELECT id, name, avatar FROM tp_users ORDER BY name');
    send(res, 200, { team: r.rows.map(x => ({ id: String(x.id), name: x.name, avatar: x.avatar || null })) });
  },
  async profile_save(req, res) {
    const u = await needUser(req); const j = await needPost(req);
    const email = String(j.email ?? '').trim().slice(0, 200);
    if (!okEmail(email)) fail(400, 'E-Mail-Adresse ungültig');
    const sets = ['email = $1', 'remind = $2'], vals = [email || null, j.remind !== false];
    if ('avatar' in j) { vals.push(cleanAvatar(j.avatar)); sets.push('avatar = $' + vals.length); }
    vals.push(u.id);
    await q('UPDATE tp_users SET ' + sets.join(', ') + ' WHERE id = $' + vals.length, vals);
    send(res, 200, { ok: true });
  },
  async password(req, res) {
    const u = await needUser(req); const j = await needPost(req);
    const old = String(j.old || ''), pw = String(j.password || '');
    if (pw.length < 8) fail(400, 'Das neue Passwort braucht mindestens 8 Zeichen.');
    const r = (await q('SELECT pass_hash FROM tp_users WHERE id = $1', [u.id])).rows[0];
    if (!r || !verifyPw(old, r.pass_hash)) { await new Promise(x => setTimeout(x, 400)); fail(403, 'Das bisherige Passwort stimmt nicht.'); }
    const up = await q('UPDATE tp_users SET pass_hash = $1, token_ver = token_ver + 1 WHERE id = $2 RETURNING token_ver', [hashPw(pw), u.id]);
    setSession(req, res, u.id, Number(up.rows[0].token_ver));   // andere Geräte werden abgemeldet, dieses bleibt angemeldet
    send(res, 200, { ok: true });
  },

  // ---- Tickets: Ideen und Probleme an die Administratoren ----
  async tickets(req, res) {
    const u = await needUser(req);
    const admin = u.role === 'admin';
    const r = await q('SELECT t.id, t.kind, t.title, t.body, t.status, t.admin_note, t.project_id, t.created_at, t.updated_at, t.user_id, us.name AS user_name, p.name AS project_name FROM tp_tickets t LEFT JOIN tp_users us ON us.id = t.user_id LEFT JOIN tp_projects p ON p.id = t.project_id' +
      (admin ? '' : ' WHERE t.user_id = $1') + ' ORDER BY t.created_at DESC', admin ? [] : [u.id]);
    send(res, 200, { admin, tickets: r.rows.map(t => ({ id: Number(t.id), kind: t.kind, title: t.title, body: t.body, status: t.status, note: t.admin_note || '', projectId: t.project_id, projectName: t.project_name || null,
      createdAt: iso(t.created_at), updatedAt: iso(t.updated_at), user: t.user_name || '(gelöscht)', own: Number(t.user_id) === u.id })) });
  },
  async ticket_new(req, res) {
    const u = await needUser(req); const j = await needPost(req);
    const kind = TICKET_KINDS[j.kind] ? j.kind : 'idee', title = String(j.title || '').trim().slice(0, 200), body = String(j.body || '').trim().slice(0, 8000);
    if (title.length < 3) fail(400, 'Bitte einen Titel mit mindestens 3 Zeichen angeben.');
    const pid = okId(j.projectId) ? j.projectId : null, t = now();
    const r = await q("INSERT INTO tp_tickets (user_id, kind, title, body, status, project_id, created_at, updated_at) VALUES ($1,$2,$3,$4,'neu',$5,$6,$6) RETURNING id", [u.id, kind, title, body, pid, t]);
    const admins = (await q("SELECT email FROM tp_users WHERE role = 'admin' AND email IS NOT NULL AND email <> '' AND id <> $1", [u.id])).rows;
    const url = appUrl();
    for (const a of admins) await mailQuiet(a.email, 'Neues Ticket (' + TICKET_KINDS[kind] + '): ' + title,
      u.name + ' hat ein Ticket angelegt.\n\n' + TICKET_KINDS[kind] + ': ' + title + (body ? '\n\n' + body : '') + (url ? '\n\nZur Verwaltung: ' + url + '/admin.html' : ''));
    send(res, 200, { id: Number(r.rows[0].id) });
  },
  async ticket_update(req, res) {
    await needUser(req, 'admin'); const j = await needPost(req);
    const id = parseInt(j.id, 10) || 0, status = TICKET_STATES[j.status] ? j.status : null, note = String(j.note ?? '').slice(0, 8000);
    if (!status) fail(400, 'Status');
    const before = (await q('SELECT t.status, t.admin_note, t.title, u.email, u.name FROM tp_tickets t LEFT JOIN tp_users u ON u.id = t.user_id WHERE t.id = $1', [id])).rows[0];
    if (!before) fail(404, 'Ticket nicht gefunden');
    await q('UPDATE tp_tickets SET status = $1, admin_note = $2, updated_at = $3 WHERE id = $4', [status, note || null, now(), id]);
    if (before.email && (before.status !== status || (before.admin_note || '') !== note)) {
      const url = appUrl();
      await mailQuiet(before.email, 'Dein Ticket „' + before.title + '“: ' + TICKET_STATES[status],
        'Hallo ' + before.name + ',\n\ndein Ticket „' + before.title + '“ hat jetzt den Status: ' + TICKET_STATES[status] + '.' + (note ? '\n\nAntwort:\n' + note : '') + (url ? '\n\n' + url : ''));
    }
    send(res, 200, { ok: true });
  },
  async ticket_del(req, res) {
    await needUser(req, 'admin'); const j = await needPost(req);
    await q('DELETE FROM tp_tickets WHERE id = $1', [parseInt(j.id, 10) || 0]);
    send(res, 200, { ok: true });
  },

  // ---- E-Mail und Erinnerungen (Verwaltung) ----
  async mail_status(req, res) {
    await needUser(req, 'admin');
    const due = await dueReminders(berlinToday());
    send(res, 200, Object.assign(mailInfo(), { appUrl: appUrl(), cron: (process.env.CRON_SECRET || '').length >= 16,
      upcoming: due.map(d => ({ user: d.user.name, project: d.projectName, name: d.name, end: new Date(d.end * 86400000).toISOString().slice(0, 10) })) }));
  },
  async mail_test(req, res) {
    const u = await needUser(req, 'admin'); await needPost(req);
    const r = (await q('SELECT email FROM tp_users WHERE id = $1', [u.id])).rows[0];
    if (!r || !r.email) fail(400, 'Hinterlege zuerst unter „Mein Profil“ deine E-Mail-Adresse.');
    try { await sendMail({ to: r.email, subject: 'Testnachricht vom Terminplaner', text: 'Hallo ' + u.name + ',\n\nder E-Mail-Versand des Terminplaners funktioniert.' }); }
    catch (e) { fail(502, 'Versand fehlgeschlagen: ' + e.message); }
    send(res, 200, { ok: true, to: r.email });
  },
  async reminders_run(req, res) {
    await needUser(req, 'admin'); await needPost(req);
    send(res, 200, await runReminders());
  },
  async login(req, res) {
    const j = await needPost(req);
    const name = String(j.name || '').trim().slice(0, 80), pw = String(j.password || '');
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64);
    await q('DELETE FROM tp_login_attempts WHERE at < $1', [now() - 900]);
    const c = await q('SELECT COUNT(*)::int AS n FROM tp_login_attempts WHERE at >= $1 AND (ip = $2 OR uname = $3)', [now() - 900, ip, name]);
    if (Number(c.rows[0].n) >= 8) fail(429, 'Zu viele Versuche, bitte in 15 Minuten erneut versuchen.');
    const r = await q('SELECT id, name, role, pass_hash, token_ver FROM tp_users WHERE name = $1', [name]);
    const u = r.rows[0];
    if (!u || !verifyPw(pw, u.pass_hash)) {
      await q('INSERT INTO tp_login_attempts (ip, uname, at) VALUES ($1,$2,$3)', [ip, name, now()]);
      await new Promise(r2 => setTimeout(r2, 400));
      fail(401, 'Name oder Passwort falsch.');
    }
    setSession(req, res, Number(u.id), Number(u.token_ver));
    send(res, 200, { user: userOut(u) });
  },
  async logout(req, res) { await needPost(req); clearSession(req, res); send(res, 200, { ok: true }); },

  async list(req, res, qs) {
    const u = await needUser(req), t = now(), cur = qs.get('p') || '';
    await q('INSERT INTO tp_presence (user_id, project_id, seen) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET project_id = EXCLUDED.project_id, seen = EXCLUDED.seen', [u.id, okId(cur) ? cur : null, t]);
    await q('DELETE FROM tp_presence WHERE seen < $1', [t - 300]);
    const p = await q('SELECT p.id, p.version, p.updated_at, p.updated_by, u.name AS by_name FROM tp_projects p LEFT JOIN tp_users u ON u.id = p.updated_by ORDER BY p.id');
    const on = await q('SELECT u.id, u.name, pr.project_id FROM tp_presence pr JOIN tp_users u ON u.id = pr.user_id WHERE pr.seen >= $1 AND u.id <> $2', [t - 25, u.id]);
    send(res, 200, {
      projects: p.rows.map(r => ({ id: r.id, version: Number(r.version), savedAt: iso(r.updated_at), by: r.updated_by == null ? null : String(r.updated_by), byName: r.by_name || null })),
      online: on.rows.map(r => ({ id: String(r.id), name: r.name, project: r.project_id }))
    });
  },
  async get(req, res, qs) {
    await needUser(req); const id = qs.get('id') || ''; if (!okId(id)) fail(400, 'id');
    const r = await projRow(id); if (!r) fail(404, 'nicht gefunden');
    send(res, 200, projOut(r));
  },
  async put(req, res) {
    const u = await needUser(req, 'editor'); const j = await needPost(req);
    if (!okId(j.id)) fail(400, 'id');
    const [ok, r] = await saveProject(j.id, String(j.json || ''), parseInt(j.base, 10) || 0, u.id);
    if (ok) send(res, 200, { version: r }); else send(res, 409, { error: 'conflict', current: r ? projOut(r) : null });
  },
  async del(req, res) {
    await needUser(req, 'editor'); const j = await needPost(req); if (!okId(j.id)) fail(400, 'id');
    await q('DELETE FROM tp_projects WHERE id = $1', [j.id]);
    await q('DELETE FROM tp_history WHERE project_id = $1', [j.id]);
    send(res, 200, { ok: true });
  },

  // ---- Verwaltung ----
  async users(req, res) {
    await needUser(req, 'admin');
    const r = await q('SELECT id, name, role, email, avatar FROM tp_users ORDER BY name');
    send(res, 200, { users: r.rows.map(x => Object.assign(userOut(x), { email: x.email || '', avatar: x.avatar || null })) });
  },
  async user_save(req, res) {
    const me = await needUser(req, 'admin'); const j = await needPost(req);
    const name = String(j.name || '').trim(), role = String(j.role || 'editor'), pw = String(j.password || ''), id = parseInt(j.id, 10) || 0;
    const email = String(j.email ?? '').trim().slice(0, 200);
    if (!okEmail(email)) fail(400, 'E-Mail-Adresse ungültig');
    if (name.length < 2 || name.length > 60) fail(400, 'Name: 2 bis 60 Zeichen');
    if (!RANK[role]) fail(400, 'Rolle');
    if (pw && pw.length < 8) fail(400, 'Passwort: mindestens 8 Zeichen');
    try {
      if (id) {
        if (id === me.id && role !== 'admin') fail(400, 'Du kannst dir die Administratorrolle nicht selbst entziehen.');
        await q('UPDATE tp_users SET name=$1, role=$2, email=$3 WHERE id=$4', [name, role, email || null, id]);
        if (pw) await q('UPDATE tp_users SET pass_hash=$1, token_ver=token_ver+1 WHERE id=$2', [hashPw(pw), id]);   // meldet alte Sitzungen ab
        if (pw && id === me.id) { const r = await q('SELECT token_ver FROM tp_users WHERE id=$1', [id]); setSession(req, res, id, Number(r.rows[0].token_ver)); }
      } else {
        if (!pw) fail(400, 'Passwort fehlt');
        await q('INSERT INTO tp_users (name, pass_hash, role, created_at, email) VALUES ($1,$2,$3,$4,$5)', [name, hashPw(pw), role, now(), email || null]);
      }
    } catch (e) { if (e instanceof HttpError) throw e; if (/unique|duplicate/i.test(String(e.message))) fail(409, 'Name schon vergeben'); throw e; }
    send(res, 200, { ok: true });
  },
  async user_del(req, res) {
    const me = await needUser(req, 'admin'); const j = await needPost(req); const id = parseInt(j.id, 10) || 0;
    if (id === me.id) fail(400, 'Du kannst dich nicht selbst löschen.');
    await q('DELETE FROM tp_users WHERE id=$1', [id]); await q('DELETE FROM tp_presence WHERE user_id=$1', [id]);
    send(res, 200, { ok: true });
  },
  async export(req, res) {
    await needUser(req, 'admin');
    const r = await q('SELECT id, name, json, version FROM tp_projects ORDER BY id');
    const d = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    send(res, 200, { format: 'terminplaner-sicherung', v: 1, exported: new Date().toISOString(), projects: r.rows.map(x => ({ id: x.id, name: x.name, version: Number(x.version), plan: JSON.parse(x.json) })) },
      { 'Content-Disposition': 'attachment; filename="terminplaner-sicherung-' + d + '.json"' });
  },
  async import(req, res) {
    const u = await needUser(req, 'admin'); const j = await needPost(req);
    if (j.format !== 'terminplaner-sicherung' || !Array.isArray(j.projects)) fail(400, 'Das ist keine Sicherungsdatei.');
    let n = 0, skipped = 0;
    for (const p of j.projects) {
      if (!p || !okId(p.id) || !p.plan || typeof p.plan !== 'object') { skipped++; continue; }
      const cur = await projRow(p.id);
      const [ok] = await saveProject(p.id, JSON.stringify(p.plan), cur ? Number(cur.version) : 0, u.id); ok ? n++ : skipped++;
    }
    send(res, 200, { imported: n, skipped });
  },
  async history(req, res, qs) {
    await needUser(req, 'editor'); const id = qs.get('id') || ''; if (!okId(id)) fail(400, 'id');
    const r = await q('SELECT h.version, h.saved_at, u.name AS by_name FROM tp_history h LEFT JOIN tp_users u ON u.id = h.user_id WHERE h.project_id = $1 ORDER BY h.version DESC', [id]);
    send(res, 200, { versions: r.rows.map(x => ({ version: Number(x.version), savedAt: iso(x.saved_at), byName: x.by_name || null })) });
  },
  async restore(req, res) {
    const u = await needUser(req, 'editor'); const j = await needPost(req); if (!okId(j.id)) fail(400, 'id');
    const h = await q('SELECT json FROM tp_history WHERE project_id=$1 AND version=$2', [j.id, parseInt(j.version, 10) || 0]);
    if (!h.rows.length) fail(404, 'Version nicht gefunden');
    const cur = await projRow(j.id);
    const [ok, r] = await saveProject(j.id, h.rows[0].json, cur ? Number(cur.version) : 0, u.id);
    ok ? send(res, 200, { version: r }) : send(res, 409, { error: 'conflict' });
  },
  async projects_all(req, res) {
    await needUser(req, 'editor');
    const r = await q('SELECT id, name FROM tp_projects ORDER BY name');
    send(res, 200, { projects: r.rows });
  }
};

export default async function handler(req, res) {
  try {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const fn = actions[qs.get('a') || ''];
    if (!fn) fail(404, 'unbekannt');
    await ensureSchema();
    await fn(req, res, qs);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error('Terminplaner:', e);
    send(res, 500, { error: e && e.expose ? e.message : 'Serverfehler' });
  }
}
