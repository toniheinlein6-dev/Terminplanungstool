// Schnittstelle des Terminplaners: alle Aktionen über /api/tp?a=<aktion>
import crypto from 'node:crypto';
import { q, client, ensureSchema } from './db.js';
import { hashPw, verifyPw, needsRehash, dummyVerify, createSession, destroySession, destroyUserSessions, currentUser, csrfToken, csrfOk } from './auth.js';
import { HttpError, fail, now, sha256, limit, hits, hit, secLog, sameOrigin, checkNewPassword, cleanImage, clientIp, hmac } from './security.js';
import { sendMail, mailInfo, appUrl } from './mail.js';
import { runReminders, dueReminders, berlinToday } from './reminders.js';
import { runWeekly } from './weekly.js';
import { recordChanges, changeText } from './changes.js';
import { normalizeProjectAssignees } from './assignees.js';
import { postTeams, teamsConfigured } from './teams.js';

const HISTORY = 40, MAX_JSON = 4_000_000;
// gantt: sieht nur den Terminplan (Gantt), ohne Aufgaben, Organigramm, Beschreibungen und Kommentare
const RANK = { gantt: 1, viewer: 2, editor: 3, admin: 4 };
const okId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const iso = s => new Date(Number(s) * 1000).toISOString();


function send(res, code, data, headers) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
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
// Zustandsändernde Anfragen: nur POST, nur aus der eigenen Seite (X-TP-Kopfzeile, Origin/Fetch-Metadata)
// und bei angemeldeten Benutzern mit gültigem, an die Sitzung gebundenem CSRF-Token (X-CSRF)
async function needPost(req, u) {
  if (req.method !== 'POST') fail(405, 'Methode nicht erlaubt');
  if (req.headers['x-tp'] !== '1' || !sameOrigin(req)) { await secLog(req, 'csrf_fail', u ? u.id : null, 'Herkunft'); fail(403, 'csrf'); }
  if (u && !csrfOk(u.sid, req.headers['x-csrf'])) { await secLog(req, 'csrf_fail', u.id, 'Token'); fail(403, 'csrf'); }
  let j; try { j = await readBody(req); } catch (e) { if (e instanceof HttpError) throw e; fail(400, 'Ungültige Anfrage'); }
  return j && typeof j === 'object' ? j : {};
}
async function needUser(req, min = 'viewer') {
  const u = await currentUser(req, req.__res);
  if (!u) fail(401, 'login');
  if ((RANK[u.role] || 0) < RANK[min]) { await secLog(req, 'forbidden', u.id, (req.__action || '') + ' (Rolle ' + u.role + ')'); fail(403, 'forbidden'); }
  return u;
}
const userOut = u => ({ id: String(u.id), name: u.name, role: u.role });
const MAX_AVATAR = 150_000, MAX_ORG_PHOTO = 300_000;
const okEmail = e => e === '' || (e.length <= 200 && /^[^\s@<>"'(),;:\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(e));
async function cleanAvatar(req, u, a) {
  if (a == null || a === '') return null;
  const c = cleanImage(a, MAX_AVATAR);
  if (!c) { await secLog(req, 'upload_reject', u.id, 'Profilbild'); fail(400, 'Profilbild ungültig oder zu groß (JPEG, PNG oder WebP, höchstens 1024 × 1024 Pixel).'); }
  return c;
}
const TICKET_KINDS = { idee: 'Idee', problem: 'Problem', frage: 'Frage' };
const TICKET_STATES = { neu: 'Neu', arbeit: 'In Bearbeitung', erledigt: 'Erledigt', abgelehnt: 'Abgelehnt' };
async function mailQuiet(to, subject, text) { if (!to || !mailInfo().configured) return; try { await sendMail({ to, subject, text }); } catch (e) { console.error('Mail:', e.message); } }

async function projRow(id, db = { query: q }) {
  const r = await db.query('SELECT p.id, p.name, p.json, p.version, p.updated_at, p.updated_by, u.name AS by_name FROM tp_projects p LEFT JOIN tp_users u ON u.id = p.updated_by WHERE p.id = $1', [id]);
  return r.rows[0] || null;
}
const projectUsers = async () => (await q('SELECT id, name FROM tp_users')).rows;
async function resolvedProjectJson(json, users) {
  let plan; try { plan = JSON.parse(json); } catch { return json; }
  return JSON.stringify(normalizeProjectAssignees(plan, users || await projectUsers()));
}
// Für „Nur Gantt“: nur, was der Terminplan zeigt
function ganttOnlyJson(json) {
  let d; try { d = JSON.parse(json); } catch (e) { return json; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.rows)) return json;
  d.tasks = []; d.org = []; d.nextTaskId = 1;
  d.rows = d.rows.map(r => (r && typeof r === 'object' ? { ...r, desc: '' } : r));
  return JSON.stringify(d);
}
async function projOut(r, u) {
  const json = await resolvedProjectJson(r.json);
  return { id: r.id, json: u && u.role === 'gantt' ? ganttOnlyJson(json) : json, version: Number(r.version), savedAt: iso(r.updated_at), by: r.updated_by == null ? null : String(r.updated_by), byName: r.by_name || null };
}

// Speichert mit Versionsprüfung: base = Version, auf der die Änderung beruht (0 = neu)
async function saveProject(id, json, base, uid) {
  let d; try { d = JSON.parse(json); } catch (e) { d = null; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.rows)) fail(400, 'Kein gültiger Terminplan');
  d = normalizeProjectAssignees(d, await projectUsers());
  // Fotos im Organigramm: nur geprüfte, bereinigte Bilder (sonst entfällt das Foto)
  if (Array.isArray(d.org)) d.org = d.org.map(n => n && typeof n === 'object' && n.photo ? { ...n, photo: cleanImage(n.photo, MAX_ORG_PHOTO) || '' } : n);
  json = JSON.stringify(d);
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
    return [true, ver, json];
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (x) { }
    const cur = await projRow(id); if (cur) return [false, cur];   // gleichzeitig angelegt
    throw e;
  } finally { c.release(); }
}

// E-Mail an neu zugewiesene Personen einer Aufgabe (jede Person je Aufgabe nur einmal)
const PRIO_TXT = { hoch: 'Hoch', normal: 'Normal', niedrig: 'Niedrig' };
const deDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : '';
async function notifyTasks(pid, ids, actor) {
  const row = await projRow(pid); if (!row) return 0;
  let plan; try { plan = JSON.parse(row.json); } catch (e) { return 0; }
  const want = new Set(ids.map(Number).filter(Number.isInteger));
  const list = (Array.isArray(plan.tasks) ? plan.tasks : []).filter(t => t && want.has(Number(t.id)) && !t.done && String(t.title || '').trim() && Array.isArray(t.assignees));
  if (!list.length) return 0;
  const users = new Map((await q('SELECT id, name, email FROM tp_users')).rows.map(x => [String(x.id), x]));
  const url = appUrl(); let n = 0;
  for (const t of list) {
    for (const a of t.assignees) {
      const usr = a && a.id != null && users.get(String(a.id)); if (!usr) continue;
      const seen = await q('SELECT 1 FROM tp_task_notify WHERE project_id=$1 AND task_id=$2 AND user_id=$3', [pid, Number(t.id), usr.id]);
      if (seen.rows.length) continue;
      await q('INSERT INTO tp_task_notify (project_id, task_id, user_id, sent_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [pid, Number(t.id), usr.id, Math.floor(Date.now() / 1000)]);
      if (String(usr.id) === String(actor.id) || !String(usr.email || '').trim()) continue;   // sich selbst zugewiesen: keine Mail
      const k = Array.isArray(plan.rows) ? plan.rows.find(r => r && r.id === t.row) : null;
      const text = 'Hallo ' + usr.name + ',\n\n' + actor.name + ' hat dir im Projekt „' + row.name + '“ eine Aufgabe zugewiesen:\n\n' +
        '„' + String(t.title).trim() + '“\n' + (t.due ? 'Fällig am ' + deDate(t.due) + '\n' : '') + (t.prio && t.prio !== 'normal' ? 'Priorität: ' + (PRIO_TXT[t.prio] || t.prio) + '\n' : '') +
        (k ? 'Gehört zu Vorgang: ' + (k.name || 'ohne Namen') + '\n' : '') + (String(t.desc || '').trim() ? '\n' + String(t.desc).trim().slice(0, 2000) + '\n' : '') +
        (url ? '\nZur Aufgabe: ' + url + '/#t=' + pid + ':' + t.id + '\n' : '') + '\nDiese Nachricht wurde automatisch vom Terminplaner verschickt.';
      await mailQuiet(usr.email, 'Neue Aufgabe für dich: ' + String(t.title).trim().slice(0, 120), text); n++;
    }
  }
  return n;
}

// Ersetzt einen gelöschten Benutzer in allen Plänen durch „Ehemaliges Mitglied“ (Verantwortlich, Aufgaben, Organigramm)
async function anonymizePlans(u, actorId) {
  const ANON = 'Ehemaliges Mitglied', idS = String(u.id), nm = String(u.name).trim().toLowerCase();
  const rows = (await q('SELECT id, json, version FROM tp_projects')).rows; let n = 0;
  for (const p of rows) {
    let d; try { d = JSON.parse(p.json); } catch (e) { continue; }
    let hitAny = false;
    const fixList = a => Array.isArray(a) ? a.map(x => (x && (String(x.id) === idS || String(x.name || '').trim().toLowerCase() === nm)) ? (hitAny = true, { name: ANON }) : x) : a;
    const fixWho = w => String(w || '').split(/\s*,\s*/).map(x => x.trim().toLowerCase() === nm ? (hitAny = true, ANON) : x).join(', ');
    (d.rows || []).forEach(r => { if (!r) return; if (r.assignees) r.assignees = fixList(r.assignees); if (r.who) r.who = fixWho(r.who); });
    (d.tasks || []).forEach(t => { if (!t) return; if (t.assignees) t.assignees = fixList(t.assignees); if (t.who) t.who = fixWho(t.who); });
    (d.org || []).forEach(o => { if (o && o.kind === 'person' && (String(o.uid) === idS || String(o.name || '').trim().toLowerCase() === nm)) { hitAny = true; o.name = ANON; o.uid = ''; o.photo = ''; } });
    if (Array.isArray(d.people)) d.people = d.people.map(x => String(x).trim().toLowerCase() === nm ? (hitAny = true, ANON) : x);
    if (!hitAny) continue;
    const [ok] = await saveProject(p.id, JSON.stringify(d), Number(p.version), actorId); if (ok) n++;
    await q('DELETE FROM tp_history WHERE project_id = $1 AND version < (SELECT version FROM tp_projects WHERE id = $1)', [p.id]);   // alte Fassungen mit dem Namen entfernen
  }
  return n;
}
// Aufbewahrungsfristen (täglich über den Cron-Aufruf)
export async function cleanup() {
  const t = now(), day = 86400;
  const del = [['tp_changes', 'at', 365], ['tp_seclog', 'at', 90], ['tp_rate', 'at', 2], ['tp_login_attempts', 'at', 1], ['tp_reminders', 'sent_at', 400], ['tp_task_notify', 'sent_at', 400], ['tp_weekly', 'sent_at', 400]];
  const out = {};
  for (const [tab, col, days] of del) out[tab] = (await q('DELETE FROM ' + tab + ' WHERE ' + col + ' < $1', [t - days * day])).rowCount || 0;
  out.tp_sessions = (await q('DELETE FROM tp_sessions WHERE last_seen < $1 OR created_at < $2', [t - 3 * day, t - 14 * day])).rowCount || 0;
  out.tp_resets = (await q('DELETE FROM tp_resets WHERE expires_at < $1', [t])).rowCount || 0;
  out.tp_presence = (await q('DELETE FROM tp_presence WHERE seen < $1', [t - 300])).rowCount || 0;
  return out;
}

const actions = {
  async setup_state(req, res) {
    const r = await q('SELECT COUNT(*)::int AS n FROM tp_users');
    send(res, 200, { needsSetup: Number(r.rows[0].n) === 0, keySet: !!process.env.SETUP_KEY });
  },
  async setup(req, res) {
    const j = await needPost(req);
    await limit(req, 'setup:' + hmac('ip', clientIp(req)), 10, 3600);
    const r = await q('SELECT COUNT(*)::int AS n FROM tp_users');
    if (Number(r.rows[0].n) > 0) fail(409, 'Der Terminplaner ist bereits eingerichtet.');
    const key = process.env.SETUP_KEY || '';
    if (key.length < 8) fail(400, 'In Vercel ist kein SETUP_KEY (mind. 8 Zeichen) hinterlegt.');
    const a = Buffer.from(String(j.key || '')), b = Buffer.from(key);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail(403, 'Einrichtungsschlüssel falsch.');
    const name = String(j.name || '').trim(), pw = String(j.password || '');
    if (name.length < 2 || name.length > 60) fail(400, 'Name: 2 bis 60 Zeichen');
    await checkNewPassword(pw, name);
    const ins = await q('INSERT INTO tp_users (name, pass_hash, role, created_at) VALUES ($1,$2,$3,$4) RETURNING id, name, role', [name, await hashPw(pw), 'admin', now()]);
    const u = ins.rows[0], sid = await createSession(req, res, Number(u.id));
    await secLog(req, 'setup', u.id, 'Ersteinrichtung');
    send(res, 200, { user: userOut(u), csrf: csrfToken(sid) });
  },
  async me(req, res) {
    const u = await currentUser(req, res); if (!u) fail(401, 'login');
    const r = (await q('SELECT email, avatar, remind, weekly FROM tp_users WHERE id = $1', [u.id])).rows[0] || {};
    let openTickets = 0;
    if (u.role === 'admin') openTickets = Number((await q("SELECT COUNT(*)::int AS n FROM tp_tickets WHERE status IN ('neu','arbeit')")).rows[0].n);
    send(res, 200, { user: Object.assign(userOut(u), { email: r.email || '', avatar: r.avatar || null, remind: r.remind !== false, weekly: r.weekly !== false }), openTickets, mail: mailInfo().configured, csrf: csrfToken(u.sid) });
  },
  // Name und Profilbild aller Teammitglieder (für Anzeige und Vorschläge bei „Verantwortlich“)
  async team(req, res) {
    await needUser(req, 'gantt');
    const r = await q("SELECT id, name, avatar FROM tp_users WHERE role <> 'gantt' ORDER BY name");
    send(res, 200, { team: r.rows.map(x => ({ id: String(x.id), name: x.name, avatar: x.avatar || null })) });
  },
  async profile_save(req, res) {
    const u = await needUser(req, 'gantt'); const j = await needPost(req, u);
    await limit(req, 'profile:' + u.id, 30, 3600);
    const email = String(j.email ?? '').trim();
    if (!okEmail(email)) fail(400, 'E-Mail-Adresse ungültig');
    const cur = (await q('SELECT email, pass_hash FROM tp_users WHERE id = $1', [u.id])).rows[0] || {};
    const oldMail = String(cur.email || ''), mailChanged = oldMail.toLowerCase() !== email.toLowerCase();
    // Eine bestehende E-Mail-Adresse (wichtig für „Passwort vergessen“) nur mit dem aktuellen Passwort ändern
    if (mailChanged && oldMail) {
      await limit(req, 'pwcheck:' + u.id, 10, 900, 'Zu viele Versuche, bitte in 15 Minuten erneut versuchen.');
      if (!(await verifyPw(String(j.password || ''), cur.pass_hash))) { await secLog(req, 'email_change_fail', u.id, 'Passwort falsch'); fail(403, 'Zum Ändern der E-Mail-Adresse bitte das aktuelle Passwort eingeben.'); }
    }
    const sets = ['email = $1', 'remind = $2', 'weekly = $3'], vals = [email || null, j.remind !== false, j.weekly !== false];
    if ('avatar' in j) { vals.push(await cleanAvatar(req, u, j.avatar)); sets.push('avatar = $' + vals.length); }
    vals.push(u.id);
    await q('UPDATE tp_users SET ' + sets.join(', ') + ' WHERE id = $' + vals.length, vals);
    if (mailChanged) {
      await secLog(req, 'email_change', u.id, oldMail ? 'geändert' : 'hinterlegt');
      if (oldMail) await mailQuiet(oldMail, 'Deine E-Mail-Adresse im Terminplaner wurde geändert', 'Hallo ' + u.name + ',\n\ndie E-Mail-Adresse deines Kontos im Terminplaner wurde soeben geändert. Warst du das nicht, melde dich bitte sofort bei einem Administrator.');
    }
    send(res, 200, { ok: true });
  },
  async password(req, res) {
    const u = await needUser(req, 'gantt'); const j = await needPost(req, u);
    const old = String(j.old || ''), pw = String(j.password || '');
    await limit(req, 'pwcheck:' + u.id, 10, 900, 'Zu viele Versuche, bitte in 15 Minuten erneut versuchen.');
    const r = (await q('SELECT pass_hash FROM tp_users WHERE id = $1', [u.id])).rows[0];
    if (!r || !(await verifyPw(old, r.pass_hash))) { await secLog(req, 'password_change_fail', u.id, 'bisheriges Passwort falsch'); fail(403, 'Das bisherige Passwort stimmt nicht.'); }
    await checkNewPassword(pw, u.name);
    await q('UPDATE tp_users SET pass_hash = $1, token_ver = token_ver + 1 WHERE id = $2', [await hashPw(pw), u.id]);
    // Alle Sitzungen beenden; dieses Gerät bekommt eine neue Sitzung (neue ID, neues CSRF-Token)
    await destroyUserSessions(u.id); const sid = await createSession(req, res, u.id);
    await secLog(req, 'password_change', u.id, '');
    send(res, 200, { ok: true, csrf: csrfToken(sid) });
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
    const u = await needUser(req); const j = await needPost(req, u);
    const kind = TICKET_KINDS[j.kind] ? j.kind : 'idee', title = String(j.title || '').trim().slice(0, 200), body = String(j.body || '').trim().slice(0, 8000);
    if (title.length < 3) fail(400, 'Bitte einen Titel mit mindestens 3 Zeichen angeben.');
    const requestId = String(j.requestId || '');
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) fail(400, 'Bitte lade die Seite neu und sende das Ticket erneut.');
    const pid = okId(j.projectId) ? j.projectId : null, t = now();
    const previousTicket = async () => (await q('SELECT id, kind, title, body, project_id FROM tp_tickets WHERE user_id = $1 AND request_key = $2', [u.id, requestId])).rows[0];
    const reuseTicket = previous => {
      if (previous.kind !== kind || previous.title !== title || previous.body !== body || previous.project_id !== pid) fail(409, 'Diese Anfrage wurde bereits für ein anderes Ticket verwendet. Bitte öffne das Formular erneut.');
      send(res, 200, { id: Number(previous.id) });
    };
    const previous = await previousTicket();
    if (previous) { reuseTicket(previous); return; }
    await limit(req, 'ticket:' + u.id, 10, 3600);
    const admins = (await q("SELECT email FROM tp_users WHERE role = 'admin' AND email IS NOT NULL AND email <> '' AND id <> $1", [u.id])).rows;
    // Die Datenbank entscheidet auch bei gleichzeitigen Anfragen aus mehreren
    // Serverinstanzen, welche Anfrage das Ticket einmalig anlegt.
    let r;
    try {
      r = await q("INSERT INTO tp_tickets (user_id, kind, title, body, status, project_id, created_at, updated_at, request_key) VALUES ($1,$2,$3,$4,'neu',$5,$6,$6,$7) RETURNING id", [u.id, kind, title, body, pid, t, requestId]);
    } catch (error) {
      if (error.code !== '23505') throw error;
      const previous = await previousTicket();
      if (!previous) throw error;
      reuseTicket(previous); return;
    }
    const recipients = new Map();
    for (const admin of admins) { const email = admin.email.trim(); if (email) recipients.set(email.toLowerCase(), email); }
    const url = appUrl();
    for (const email of recipients.values()) await mailQuiet(email, 'Neues Ticket (' + TICKET_KINDS[kind] + '): ' + title,
      u.name + ' hat ein Ticket angelegt.\n\n' + TICKET_KINDS[kind] + ': ' + title + (body ? '\n\n' + body : '') + (url ? '\n\nZur Verwaltung: ' + url + '/admin.html' : ''));
    send(res, 200, { id: Number(r.rows[0].id) });
  },
  async ticket_update(req, res) {
    const u = await needUser(req, 'admin'); const j = await needPost(req, u);
    const id = parseInt(j.id, 10) || 0, status = TICKET_STATES[j.status] ? j.status : null, note = String(j.note ?? '').slice(0, 8000);
    if (!status) fail(400, 'Status');
    const before = (await q('SELECT t.status, t.admin_note, t.title, u.email, u.name FROM tp_tickets t LEFT JOIN tp_users u ON u.id = t.user_id WHERE t.id = $1', [id])).rows[0];
    if (!before) fail(404, 'Ticket nicht gefunden');
    // Die Bedingung wird unter der Zeilensperre erneut geprüft: identische,
    // gleichzeitige Updates führen nur einmal zu einer Benachrichtigung.
    const updated = await q("UPDATE tp_tickets SET status = $1, admin_note = $2, updated_at = $3 WHERE id = $4 AND (status <> $1 OR COALESCE(admin_note, '') <> $5) RETURNING id", [status, note || null, now(), id, note]);
    if (before.email && updated.rows.length) {
      const url = appUrl();
      await mailQuiet(before.email, 'Dein Ticket „' + before.title + '“: ' + TICKET_STATES[status],
        'Hallo ' + before.name + ',\n\ndein Ticket „' + before.title + '“ hat jetzt den Status: ' + TICKET_STATES[status] + '.' + (note ? '\n\nAntwort:\n' + note : '') + (url ? '\n\n' + url : ''));
    }
    send(res, 200, { ok: true });
  },
  async ticket_del(req, res) {
    const u = await needUser(req, 'admin'); const j = await needPost(req, u);
    await q('DELETE FROM tp_tickets WHERE id = $1', [parseInt(j.id, 10) || 0]);
    send(res, 200, { ok: true });
  },

  // ---- E-Mail und Erinnerungen (Verwaltung) ----
  async mail_status(req, res) {
    await needUser(req, 'admin');
    const due = await dueReminders(berlinToday());
    send(res, 200, Object.assign(mailInfo(), { teams: teamsConfigured(), appUrl: appUrl(), cron: (process.env.CRON_SECRET || '').length >= 16,
      upcoming: due.map(d => ({ user: d.user.name, project: d.projectName, name: d.name, end: new Date(d.end * 86400000).toISOString().slice(0, 10) })) }));
  },
  async mail_test(req, res) {
    const u = await needUser(req, 'admin'); await needPost(req, u);
    await limit(req, 'mailtest:' + u.id, 5, 3600);
    const r = (await q('SELECT email FROM tp_users WHERE id = $1', [u.id])).rows[0];
    if (!r || !r.email) fail(400, 'Hinterlege zuerst unter „Mein Profil“ deine E-Mail-Adresse.');
    try { await sendMail({ to: r.email, subject: 'Testnachricht vom Terminplaner', text: 'Hallo ' + u.name + ',\n\nder E-Mail-Versand des Terminplaners funktioniert.' }); }
    catch (e) { fail(502, 'Versand fehlgeschlagen: ' + e.message); }
    send(res, 200, { ok: true, to: r.email });
  },
  // Wochenübersicht: preview = nur an mich (jederzeit), sonst Versand an alle (auch außerhalb des Montags)
  async weekly_run(req, res) {
    const u = await needUser(req, 'admin'); const j = await needPost(req, u);
    await limit(req, 'weekly:' + u.id, 10, 3600);
    if (j.preview) {
      const me = (await q('SELECT id, name, email FROM tp_users WHERE id = $1', [u.id])).rows[0];
      send(res, 200, await runWeekly({ force: true, onlyUser: me }));
    } else send(res, 200, await runWeekly({ force: true }));
  },
  async reminders_run(req, res) {
    const u = await needUser(req, 'admin'); await needPost(req, u);
    await limit(req, 'remind:' + u.id, 10, 3600);
    send(res, 200, await runReminders());
  },
  // Anmeldung: Begrenzung je Konto und je (pseudonymisierter) IP, gleiche Antwortzeit und -meldung
  // für unbekannte Namen und falsche Passwörter, neue Sitzung bei jeder Anmeldung (keine Session-Fixation)
  async login(req, res) {
    const j = await needPost(req);
    const name = String(j.name || '').trim().slice(0, 80), pw = String(j.password || '').slice(0, 1024);
    const ipKey = 'login-ip:' + hmac('ip', clientIp(req)), userKey = 'login-user:' + hmac('user', name.toLowerCase());
    if (await hits(ipKey, 900) >= 30 || await hits(userKey, 900) >= 10) {
      await secLog(req, 'rate_limit', null, 'Anmeldung');
      fail(429, 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.');
    }
    const u = (await q('SELECT id, name, role, pass_hash FROM tp_users WHERE name = $1', [name])).rows[0];
    const ok = u ? await verifyPw(pw, u.pass_hash) : (await dummyVerify(pw), false);
    if (!ok) {
      await hit(ipKey); await hit(userKey);
      await secLog(req, 'login_fail', u ? u.id : null, u ? 'Passwort falsch' : 'unbekannter Name');
      fail(401, 'Name oder Passwort falsch.');
    }
    if (needsRehash(u.pass_hash)) await q('UPDATE tp_users SET pass_hash = $1 WHERE id = $2', [await hashPw(pw), u.id]);   // ältere Hash-Parameter erneuern
    await destroySession(req, res);
    const sid = await createSession(req, res, Number(u.id));
    send(res, 200, { user: userOut(u), csrf: csrfToken(sid) });
  },
  async logout(req, res) {
    const u = await currentUser(req, res); await needPost(req, u);
    await destroySession(req, res); send(res, 200, { ok: true });
  },

  // ---- Passwort vergessen: Link mit einmaligem, kurzlebigem Token per E-Mail ----
  // Antwort immer gleich (keine Auskunft, ob Name oder Adresse existiert); gespeichert wird nur der Hash des Tokens
  async reset_request(req, res) {
    const j = await needPost(req);
    const who = String(j.name || '').trim().slice(0, 200);
    await limit(req, 'reset-ip:' + hmac('ip', clientIp(req)), 5, 3600);
    const generic = { ok: true, message: 'Falls zu diesem Namen oder dieser Adresse ein Konto mit E-Mail-Adresse gehört, ist eine E-Mail mit einem Link unterwegs. Der Link gilt 30 Minuten.' };
    if (!who) return send(res, 200, generic);
    const u = (await q('SELECT id, name, email FROM tp_users WHERE lower(name) = lower($1) OR lower(email) = lower($1) LIMIT 2', [who])).rows;
    const url = appUrl();
    if (u.length === 1 && u[0].email && url && mailInfo().configured && await hits('reset-user:' + u[0].id, 3600) < 3) {
      await hit('reset-user:' + u[0].id);
      const tok = crypto.randomBytes(32).toString('base64url');
      await q('DELETE FROM tp_resets WHERE user_id = $1', [u[0].id]);
      await q('INSERT INTO tp_resets (id, user_id, expires_at) VALUES ($1,$2,$3)', [sha256(tok), u[0].id, now() + 1800]);
      await mailQuiet(u[0].email, 'Passwort für den Terminplaner zurücksetzen',
        'Hallo ' + u[0].name + ',\n\nüber diesen Link kannst du ein neues Passwort festlegen. Er gilt 30 Minuten und nur einmal:\n\n' + url + '/#reset=' + tok +
        '\n\nHast du das nicht angefordert, ignoriere diese E-Mail. Dein bisheriges Passwort bleibt dann gültig.');
      await secLog(req, 'reset_request', u[0].id, '');
    } else await secLog(req, 'reset_request', null, 'ohne Versand');
    send(res, 200, generic);
  },
  async reset_confirm(req, res) {
    const j = await needPost(req);
    await limit(req, 'reset-try:' + hmac('ip', clientIp(req)), 10, 3600);
    const tok = String(j.token || ''), pw = String(j.password || '');
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(tok)) fail(400, 'Der Link ist ungültig oder abgelaufen.');
    const r = (await q('SELECT r.user_id, r.expires_at, r.used, u.name FROM tp_resets r JOIN tp_users u ON u.id = r.user_id WHERE r.id = $1', [sha256(tok)])).rows[0];
    if (!r || r.used || Number(r.expires_at) < now()) { await secLog(req, 'reset_fail', r ? r.user_id : null, 'Token ungültig'); fail(400, 'Der Link ist ungültig oder abgelaufen. Fordere bitte einen neuen an.'); }
    await checkNewPassword(pw, r.name);
    // Token sofort verbrauchen (auch bei gleichzeitigen Anfragen nur einmal gültig)
    const used = await q('UPDATE tp_resets SET used = TRUE WHERE id = $1 AND used = FALSE RETURNING user_id', [sha256(tok)]);
    if (!used.rows.length) fail(400, 'Der Link wurde bereits verwendet.');
    await q('UPDATE tp_users SET pass_hash = $1, token_ver = token_ver + 1 WHERE id = $2', [await hashPw(pw), r.user_id]);
    await q('DELETE FROM tp_resets WHERE user_id = $1', [r.user_id]);
    await destroyUserSessions(r.user_id);
    await secLog(req, 'reset_done', r.user_id, '');
    send(res, 200, { ok: true });
  },

  async list(req, res, qs) {
    const u = await needUser(req, 'gantt'), t = now(), cur = qs.get('p') || '', full = u.role !== 'gantt';
    await q('INSERT INTO tp_presence (user_id, project_id, seen) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET project_id = EXCLUDED.project_id, seen = EXCLUDED.seen', [u.id, okId(cur) ? cur : null, t]);
    await q('DELETE FROM tp_presence WHERE seen < $1', [t - 300]);
    const p = await q('SELECT p.id, p.version, p.updated_at, p.updated_by, u.name AS by_name FROM tp_projects p LEFT JOIN tp_users u ON u.id = p.updated_by ORDER BY p.id');
    const on = await q('SELECT u.id, u.name, pr.project_id FROM tp_presence pr JOIN tp_users u ON u.id = pr.user_id WHERE pr.seen >= $1 AND u.id <> $2', [t - 25, u.id]);
    let counts = {};
    if (full && okId(cur)) (await q('SELECT row_id, COUNT(*)::int AS n FROM tp_comments WHERE project_id = $1 GROUP BY row_id', [cur])).rows.forEach(x => { counts[x.row_id] = Number(x.n); });
    // Letzte Änderung je Vorgang (14 Tage), für Markierungen in der Oberfläche
    const changed = {};
    if (full && okId(cur)) (await q("SELECT c.row_id, c.at, c.user_id, us.name AS by_name FROM tp_changes c LEFT JOIN tp_users us ON us.id = c.user_id WHERE c.project_id = $1 AND c.at >= $2 AND c.action <> 'gelöscht' ORDER BY c.at, c.id", [cur, t - 14 * 86400]))
      .rows.forEach(x => { changed[x.row_id] = { at: iso(x.at), by: x.user_id == null ? null : String(x.user_id), byName: x.by_name || null }; });
    send(res, 200, {
      comments: counts, changed,
      projects: p.rows.map(r => ({ id: r.id, version: Number(r.version), savedAt: iso(r.updated_at), by: r.updated_by == null ? null : String(r.updated_by), byName: r.by_name || null })),
      online: on.rows.map(r => ({ id: String(r.id), name: r.name, project: r.project_id }))
    });
  },
  async get(req, res, qs) {
    const u = await needUser(req, 'gantt'); const id = qs.get('id') || ''; if (!okId(id)) fail(400, 'id');
    const r = await projRow(id); if (!r) fail(404, 'nicht gefunden');
    send(res, 200, await projOut(r, u));
  },
  async put(req, res) {
    const u = await needUser(req, 'editor'); const j = await needPost(req, u);
    if (!okId(j.id)) fail(400, 'id');
    const base = parseInt(j.base, 10) || 0;
    const prev = base > 0 ? await projRow(j.id) : null;
    const [ok, r, saved] = await saveProject(j.id, String(j.json || ''), base, u.id);
    // Änderungsprotokoll (Fehler hier dürfen das Speichern nicht scheitern lassen)
    if (ok && prev && Number(prev.version) === base) { try { await recordChanges(j.id, prev.json, saved, u.id); } catch (e) { console.error('Protokoll:', e.message); } }
    if (ok && Array.isArray(j.notify) && j.notify.length) await notifyTasks(j.id, j.notify.slice(0, 50), u);
    if (ok) send(res, 200, { version: r }); else send(res, 409, { error: 'conflict', current: r ? await projOut(r) : null });
  },
  async del(req, res) {
    const u = await needUser(req, 'editor'); const j = await needPost(req, u); if (!okId(j.id)) fail(400, 'id');
    await secLog(req, 'project_delete', u.id, j.id);
    await q('DELETE FROM tp_projects WHERE id = $1', [j.id]);
    await q('DELETE FROM tp_history WHERE project_id = $1', [j.id]);
    await q('DELETE FROM tp_comments WHERE project_id = $1', [j.id]);
    await q('DELETE FROM tp_task_notify WHERE project_id = $1', [j.id]);
    await q('DELETE FROM tp_changes WHERE project_id = $1', [j.id]);
    send(res, 200, { ok: true });
  },

  // ---- Kommentare zu Vorgängen, mit @-Erwähnung ----
  async comments(req, res, qs) {
    const u = await needUser(req); const pid = qs.get('p') || '', rid = parseInt(qs.get('r'), 10);
    if (!okId(pid) || !Number.isInteger(rid)) fail(400, 'Vorgang');
    const r = await q('SELECT c.id, c.body, c.created_at, c.user_id, us.name AS user_name FROM tp_comments c LEFT JOIN tp_users us ON us.id = c.user_id WHERE c.project_id = $1 AND c.row_id = $2 ORDER BY c.created_at, c.id', [pid, rid]);
    const ch = await q('SELECT c.id, c.at, c.first_at, c.action, c.meta, us.name AS user_name FROM tp_changes c LEFT JOIN tp_users us ON us.id = c.user_id WHERE c.project_id = $1 AND c.row_id = $2 ORDER BY c.at, c.id', [pid, rid]);
    send(res, 200, {
      comments: r.rows.map(c => ({ id: Number(c.id), body: c.body, createdAt: iso(c.created_at), user: c.user_name || '(gelöscht)', own: Number(c.user_id) === u.id, canDelete: Number(c.user_id) === u.id || u.role === 'admin' })),
      changes: ch.rows.map(c => { let m = {}; try { m = JSON.parse(c.meta); } catch (e) { } return { id: Number(c.id), action: c.action, at: iso(c.at), firstAt: iso(c.first_at), user: c.user_name || '(gelöscht)', text: changeText(c.action, m) }; })
    });
  },
  async comment_new(req, res) {
    const u = await needUser(req); const j = await needPost(req, u);
    await limit(req, 'comment:' + u.id, 30, 600);
    const pid = j.projectId, rid = parseInt(j.rowId, 10), body = String(j.body || '').trim().slice(0, 4000);
    if (!okId(pid) || !Number.isInteger(rid)) fail(400, 'Vorgang');
    if (!body) fail(400, 'Der Kommentar ist leer.');
    const p = await projRow(pid); if (!p) fail(404, 'Projekt nicht gefunden');
    let row = null; try { row = (JSON.parse(p.json).rows || []).find(x => Number(x.id) === rid) || null; } catch (e) { }
    if (!row) fail(404, 'Vorgang nicht gefunden');
    await q('INSERT INTO tp_comments (project_id, row_id, user_id, body, created_at) VALUES ($1,$2,$3,$4,$5)', [pid, rid, u.id, body, now()]);
    // Erwähnungen: „@Name“ für jeden Benutzer, dessen Name im Text steht
    const users = (await q("SELECT id, name, email FROM tp_users WHERE role <> 'gantt'")).rows;
    const low = body.toLowerCase();
    const mentioned = users.filter(x => Number(x.id) !== u.id && low.includes('@' + x.name.toLowerCase())).slice(0, 10);
    const url = appUrl(), link = url ? url + '/#c=' + pid + ':' + rid : '';
    const what = '„' + (row.name || 'ohne Namen') + '“ im Projekt „' + p.name + '“';
    const notified = [];
    for (const m of mentioned) {
      if (!m.email) continue;
      await mailQuiet(m.email, u.name + ' hat dich erwähnt: ' + (row.name || 'Vorgang'),
        'Hallo ' + m.name + ',\n\n' + u.name + ' hat dich in einem Kommentar zu ' + what + ' erwähnt:\n\n' + body + (link ? '\n\nZum Vorgang: ' + link : ''));
      notified.push(m.name);
    }
    let teams = false;
    if (mentioned.length && teamsConfigured()) {
      try { teams = await postTeams({ title: u.name + ' → ' + mentioned.map(m => '@' + m.name).join(', '), text: 'Kommentar zu ' + what + ':\n\n' + body, url: link }); }
      catch (e) { console.error('Teams:', e.message); }
    }
    send(res, 200, { ok: true, notified, mentioned: mentioned.map(m => m.name), teams });
  },
  async comment_del(req, res) {
    const u = await needUser(req); const j = await needPost(req, u); const id = parseInt(j.id, 10) || 0;
    const c = (await q('SELECT user_id FROM tp_comments WHERE id = $1', [id])).rows[0];
    if (!c) fail(404, 'Kommentar nicht gefunden');
    if (Number(c.user_id) !== u.id && u.role !== 'admin') fail(403, 'Nur eigene Kommentare können gelöscht werden.');
    await q('DELETE FROM tp_comments WHERE id = $1', [id]);
    send(res, 200, { ok: true });
  },

  // ---- Verwaltung ----
  async users(req, res) {
    await needUser(req, 'admin');
    const r = await q('SELECT id, name, role, email, avatar FROM tp_users ORDER BY name');
    send(res, 200, { users: r.rows.map(x => Object.assign(userOut(x), { email: x.email || '', avatar: x.avatar || null })) });
  },
  async user_save(req, res) {
    const me = await needUser(req, 'admin'); const j = await needPost(req, me);
    const name = String(j.name || '').trim(), role = String(j.role || 'editor'), pw = String(j.password || ''), id = parseInt(j.id, 10) || 0;
    const email = String(j.email ?? '').trim();
    if (!okEmail(email)) fail(400, 'E-Mail-Adresse ungültig');
    if (name.length < 2 || name.length > 60 || /[\u0000-\u001f<>]/.test(name)) fail(400, 'Name: 2 bis 60 Zeichen, ohne < und >');
    if (!RANK[role]) fail(400, 'Rolle');
    if (pw) await checkNewPassword(pw, name);
    let sid = null;
    try {
      if (id) {
        const before = (await q('SELECT role FROM tp_users WHERE id=$1', [id])).rows[0]; if (!before) fail(404, 'Benutzer nicht gefunden');
        if (id === me.id && role !== 'admin') fail(400, 'Du kannst dir die Administratorrolle nicht selbst entziehen.');
        await q('UPDATE tp_users SET name=$1, role=$2, email=$3 WHERE id=$4', [name, role, email || null, id]);
        // Rollen- oder Passwortwechsel: bestehende Sitzungen dieses Benutzers beenden
        if (pw) await q('UPDATE tp_users SET pass_hash=$1, token_ver=token_ver+1 WHERE id=$2', [await hashPw(pw), id]);
        if (pw || before.role !== role) { await destroyUserSessions(id); if (id === me.id) sid = await createSession(req, res, id); }
        await secLog(req, 'admin_user_change', me.id, 'Benutzer ' + id + (before.role !== role ? ', Rolle ' + before.role + ' → ' + role : '') + (pw ? ', Passwort neu gesetzt' : ''));
      } else {
        if (!pw) fail(400, 'Passwort fehlt');
        const ins = await q('INSERT INTO tp_users (name, pass_hash, role, created_at, email) VALUES ($1,$2,$3,$4,$5) RETURNING id', [name, await hashPw(pw), role, now(), email || null]);
        await secLog(req, 'admin_user_new', me.id, 'Benutzer ' + ins.rows[0].id + ', Rolle ' + role);
      }
    } catch (e) { if (e instanceof HttpError) throw e; if (/unique|duplicate/i.test(String(e.message))) fail(409, 'Name schon vergeben'); throw e; }
    send(res, 200, sid ? { ok: true, csrf: csrfToken(sid) } : { ok: true });
  },
  // Benutzer löschen: Konto, Sitzungen und Zuordnungen entfernen; Verweise in Kommentaren, Tickets,
  // Änderungsprotokoll und Versionen werden anonymisiert; auf Wunsch auch der Name in allen Plänen
  async user_del(req, res) {
    const me = await needUser(req, 'admin'); const j = await needPost(req, me); const id = parseInt(j.id, 10) || 0;
    if (id === me.id) fail(400, 'Du kannst dich nicht selbst löschen.');
    const u = (await q('SELECT id, name FROM tp_users WHERE id=$1', [id])).rows[0]; if (!u) fail(404, 'Benutzer nicht gefunden');
    let plans = 0;
    if (j.anonymize) plans = await anonymizePlans(u, me.id);
    await q('DELETE FROM tp_users WHERE id=$1', [id]);
    await destroyUserSessions(id);
    for (const t of ['tp_presence', 'tp_reminders', 'tp_task_notify', 'tp_weekly', 'tp_resets']) await q('DELETE FROM ' + t + ' WHERE user_id=$1', [id]);
    for (const t of ['tp_comments', 'tp_tickets', 'tp_changes', 'tp_history', 'tp_seclog']) await q('UPDATE ' + t + ' SET user_id = NULL WHERE user_id=$1', [id]);
    await q('UPDATE tp_projects SET updated_by = NULL WHERE updated_by=$1', [id]);
    await secLog(req, 'admin_user_delete', me.id, 'Benutzer ' + id + (j.anonymize ? ', in ' + plans + ' Projekten anonymisiert' : ''));
    send(res, 200, { ok: true, plans });
  },
  async export(req, res) {
    const u = await needUser(req, 'admin');
    await limit(req, 'export:' + u.id, 20, 3600);
    await secLog(req, 'admin_export', u.id, 'Sicherung heruntergeladen');
    const r = await q('SELECT id, name, json, version FROM tp_projects ORDER BY id');
    const users = await projectUsers();
    const d = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    send(res, 200, { format: 'terminplaner-sicherung', v: 1, exported: new Date().toISOString(), projects: r.rows.map(x => ({ id: x.id, name: x.name, version: Number(x.version), plan: normalizeProjectAssignees(JSON.parse(x.json), users) })) },
      { 'Content-Disposition': 'attachment; filename="terminplaner-sicherung-' + d + '.json"' });
  },
  async import(req, res) {
    const u = await needUser(req, 'admin'); const j = await needPost(req, u);
    await secLog(req, 'admin_import', u.id, (Array.isArray(j.projects) ? j.projects.length : 0) + ' Projekte');
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
    const u = await needUser(req, 'editor'); const j = await needPost(req, u); if (!okId(j.id)) fail(400, 'id');
    const h = await q('SELECT json FROM tp_history WHERE project_id=$1 AND version=$2', [j.id, parseInt(j.version, 10) || 0]);
    if (!h.rows.length) fail(404, 'Version nicht gefunden');
    const cur = await projRow(j.id);
    const [ok, r] = await saveProject(j.id, h.rows[0].json, cur ? Number(cur.version) : 0, u.id);
    ok ? send(res, 200, { version: r }) : send(res, 409, { error: 'conflict' });
  },
  // Änderungsprotokoll für Administratoren
  async changes_log(req, res, qs) {
    await needUser(req, 'admin');
    const pid = qs.get('p') || '', uid = parseInt(qs.get('u'), 10), before = parseInt(qs.get('before'), 10), lim = Math.min(200, parseInt(qs.get('n'), 10) || 100);
    const where = [], vals = [];
    if (okId(pid)) { vals.push(pid); where.push('c.project_id = $' + vals.length); }
    if (Number.isInteger(uid)) { vals.push(uid); where.push('c.user_id = $' + vals.length); }
    if (Number.isInteger(before)) { vals.push(before); where.push('c.at < $' + vals.length); }
    vals.push(lim + 1);
    const r = await q('SELECT c.id, c.project_id, c.row_id, c.at, c.first_at, c.action, c.meta, us.name AS user_name, p.name AS project_name FROM tp_changes c LEFT JOIN tp_users us ON us.id = c.user_id LEFT JOIN tp_projects p ON p.id = c.project_id' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY c.at DESC, c.id DESC LIMIT $' + vals.length, vals);
    const rows = r.rows.slice(0, lim);
    const last = await q('SELECT p.id, p.name, p.updated_at, us.name AS by_name FROM tp_projects p LEFT JOIN tp_users us ON us.id = p.updated_by ORDER BY p.updated_at DESC');
    send(res, 200, {
      entries: rows.map(c => { let m = {}; try { m = JSON.parse(c.meta); } catch (e) { } return { id: Number(c.id), project: c.project_id, projectName: c.project_name || c.project_id, rowId: Number(c.row_id), rowName: m.name || '', action: c.action, at: iso(c.at), atN: Number(c.at), firstAt: iso(c.first_at), user: c.user_name || '(gelöscht)', text: changeText(c.action, m) }; }),
      more: r.rows.length > lim,
      projects: last.rows.map(p => ({ id: p.id, name: p.name, savedAt: iso(p.updated_at), byName: p.by_name || null }))
    });
  },
  // Sicherheitsprotokoll für Administratoren (letzte 90 Tage)
  async seclog(req, res, qs) {
    await needUser(req, 'admin');
    const before = parseInt(qs.get('before'), 10), vals = [];
    let sql = 'SELECT l.id, l.at, l.kind, l.user_id, l.ip, l.detail, u.name FROM tp_seclog l LEFT JOIN tp_users u ON u.id = l.user_id';
    if (Number.isInteger(before)) { vals.push(before); sql += ' WHERE l.id < $1'; }
    const r = await q(sql + ' ORDER BY l.id DESC LIMIT 201', vals);
    send(res, 200, { entries: r.rows.slice(0, 200).map(x => ({ id: Number(x.id), at: iso(x.at), kind: x.kind, user: x.name || (x.user_id == null ? null : '(gelöscht)'), ip: x.ip || '', detail: x.detail })), more: r.rows.length > 200 });
  },
  // Auskunft über die eigenen Daten (Art. 15/20 DSGVO), als JSON zum Herunterladen
  async my_data(req, res) {
    const u = await needUser(req, 'gantt');
    await limit(req, 'mydata:' + u.id, 10, 3600);
    const prof = (await q('SELECT id, name, role, email, avatar, remind, weekly, created_at FROM tp_users WHERE id = $1', [u.id])).rows[0];
    const com = (await q('SELECT c.project_id, p.name AS project, c.row_id, c.body, c.created_at FROM tp_comments c LEFT JOIN tp_projects p ON p.id = c.project_id WHERE c.user_id = $1 ORDER BY c.created_at', [u.id])).rows;
    const tic = (await q('SELECT kind, title, body, status, admin_note, created_at FROM tp_tickets WHERE user_id = $1 ORDER BY created_at', [u.id])).rows;
    const chg = (await q('SELECT c.project_id, p.name AS project, c.row_id, c.action, c.meta, c.at FROM tp_changes c LEFT JOIN tp_projects p ON p.id = c.project_id WHERE c.user_id = $1 ORDER BY c.at', [u.id])).rows;
    const ses = (await q('SELECT created_at, last_seen FROM tp_sessions WHERE user_id = $1 ORDER BY created_at', [u.id])).rows;
    const projects = (await q('SELECT id, name, json FROM tp_projects ORDER BY name')).rows, assigned = [];
    for (const p of projects) {
      let d; try { d = JSON.parse(p.json); } catch (e) { continue; }
      const mine = a => Array.isArray(a) && a.some(x => x && String(x.id) === String(u.id));
      (d.rows || []).forEach(r => { if (r && mine(r.assignees)) assigned.push({ project: p.name, art: 'Vorgang', name: r.name || '' }); });
      (d.tasks || []).forEach(t => { if (t && mine(t.assignees)) assigned.push({ project: p.name, art: 'Aufgabe', name: t.title || '' }); });
      (d.org || []).forEach(n => { if (n && n.kind === 'person' && String(n.uid) === String(u.id)) assigned.push({ project: p.name, art: 'Organigramm', name: n.name || '', rolle: n.role || '', foto: !!n.photo }); });
    }
    await secLog(req, 'data_export', u.id, 'eigene Daten');
    send(res, 200, {
      format: 'terminplaner-auskunft', erstellt: new Date().toISOString(),
      konto: { name: prof.name, rolle: prof.role, email: prof.email || '', profilbild: prof.avatar || null, erinnerungen: prof.remind !== false, wochenuebersicht: prof.weekly !== false, angelegt: iso(prof.created_at) },
      sitzungen: ses.map(x => ({ angemeldet: iso(x.created_at), zuletztAktiv: iso(x.last_seen) })),
      zuordnungen: assigned,
      kommentare: com.map(c => ({ projekt: c.project || c.project_id, vorgang: Number(c.row_id), text: c.body, am: iso(c.created_at) })),
      tickets: tic.map(t => ({ art: t.kind, titel: t.title, text: t.body, status: t.status, antwort: t.admin_note || '', am: iso(t.created_at) })),
      aenderungen: chg.map(c => { let m = {}; try { m = JSON.parse(c.meta); } catch (e) { } return { projekt: c.project || c.project_id, vorgang: m.name || Number(c.row_id), aktion: c.action, text: changeText(c.action, m), am: iso(c.at) }; })
    }, { 'Content-Disposition': 'attachment; filename="meine-daten-terminplaner.json"' });
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
    const a = qs.get('a') || '', fn = Object.prototype.hasOwnProperty.call(actions, a) ? actions[a] : null;
    if (!fn) fail(404, 'unbekannt');
    if (req.method !== 'GET' && req.method !== 'POST') fail(405, 'Methode nicht erlaubt');
    req.__res = res; req.__action = a;
    await ensureSchema();
    await fn(req, res, qs);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error('Terminplaner:', e);
    send(res, 500, { error: e && e.expose ? e.message : 'Serverfehler' });
  }
}
