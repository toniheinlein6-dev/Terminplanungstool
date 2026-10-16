// Wochenübersicht: jeden Montag bekommt jedes Teammitglied eine E-Mail mit seinen Vorgängen und
// Aufgaben der Woche (plus Überfälligem). Unabhängig von der Erinnerung zwei Tage vor Fristende.
import { createRequire } from 'node:module';
import { q } from './db.js';
import { sendMail, mailInfo, appUrl } from './mail.js';
import { resolveAssignees } from './assignees.js';
import { berlinToday } from './reminders.js';
const require = createRequire(import.meta.url);
const logic = require('./logic.cjs');

const DEFAULT_LANES = [{ id: '', done: false }, { id: 'arbeit', done: false }, { id: 'fertig', done: true }];
const PRIO = { hoch: 'Priorität hoch', niedrig: 'Priorität niedrig' };
const mondayOf = d => d - logic.isoWd(d) + 1;

// Sammelt je Benutzer, was in der Woche ab „monday“ ansteht
export async function weeklyItems(monday) {
  const sunday = monday + 6;
  const users = (await q("SELECT id, name, email, weekly FROM tp_users WHERE role <> 'gantt'")).rows;
  const byId = new Map(users.map(u => [String(u.id), u]));
  const projects = (await q('SELECT id, name, json FROM tp_projects ORDER BY name')).rows;
  const per = new Map();   // userId -> { user, projects: Map(projectName -> {late:[], rows:[], tasks:[], open:[]}) }
  const bucket = (u, p) => {
    if (!per.has(u.id)) per.set(u.id, { user: u, projects: new Map() });
    const m = per.get(u.id).projects;
    if (!m.has(p.id)) m.set(p.id, { name: p.name, late: [], rows: [], tasks: [], open: [] });
    return m.get(p.id);
  };
  for (const p of projects) {
    let plan; try { plan = JSON.parse(p.json); } catch (e) { continue; }
    if (!plan || !Array.isArray(plan.rows)) continue;
    const s = logic.schedule(plan);
    const lanes = Array.isArray(plan.lanes) && plan.lanes.length ? plan.lanes : DEFAULT_LANES;
    plan.rows.forEach((r, i) => {
      const o = s.out[i]; if (!o || o.summary || o.err) return;
      const lane = lanes.find(l => (l.id ?? '') === (r.st || '')) || lanes[0];
      if (lane && lane.done) return;
      const late = o.E < monday, inWeek = o.S <= sunday && o.E >= monday;
      if (!late && !inWeek) return;
      const ms = r.type === 'meilenstein', pct = Math.max(0, Math.min(100, parseInt(r.pct, 10) || 0));
      const txt = s.psp[i] + ' ' + (r.name || 'ohne Namen') + (ms ? ' (Meilenstein) – am ' + logic.fmt(o.S) : ' – ' + logic.fmt(o.S) + ' bis ' + logic.fmt(o.E) + (pct ? ', ' + pct + ' % fertig' : '')) +
        (!late && !ms && o.E <= sunday ? ' · endet diese Woche' : '');
      for (const a of resolveAssignees(r, users)) {
        const u = a.id && byId.get(a.id); if (!u) continue;
        const b = bucket(u, p);
        if (late) b.late.push({ sort: o.E, text: 'Vorgang ' + txt + ' (Ende war ' + logic.fmt(o.E) + ')' }); else b.rows.push({ sort: o.E, text: txt });
      }
    });
    (Array.isArray(plan.tasks) ? plan.tasks : []).forEach(t => {
      if (!t || t.done) return;
      const d = logic.parseISO(t.due), title = '„' + (String(t.title || '').trim() || 'Aufgabe ohne Titel') + '“';
      const row = t.row !== '' && t.row != null ? plan.rows.findIndex(r => r && r.id === t.row) : -1;
      const extra = [PRIO[t.prio], row >= 0 ? 'zu ' + s.psp[row] + ' ' + (plan.rows[row].name || 'ohne Namen') : ''].filter(Boolean).join(', ');
      for (const a of resolveAssignees(t, users)) {
        const u = a.id && byId.get(a.id); if (!u) continue;
        const b = bucket(u, p);
        if (d == null) b.open.push({ sort: 0, text: title + (extra ? ' (' + extra + ')' : '') });
        else if (d < monday) b.late.push({ sort: d, text: 'Aufgabe ' + title + ' – war fällig ' + logic.fmt(d) + (extra ? ' (' + extra + ')' : '') });
        else if (d <= sunday) b.tasks.push({ sort: d, text: title + ' – fällig ' + logic.fmt(d) + (extra ? ' (' + extra + ')' : '') });
      }
    });
  }
  return per;
}

export function weeklyText(entry, monday) {
  const u = entry.user, kw = logic.isoWeek(monday), url = appUrl();
  const list = arr => arr.sort((a, b) => a.sort - b.sort).map(x => '  • ' + x.text).join('\n');
  let nRows = 0, nTasks = 0, nLate = 0;
  const parts = [];
  for (const [pid, b] of entry.projects) {
    if (!b.late.length && !b.rows.length && !b.tasks.length && !b.open.length) continue;
    nRows += b.rows.length; nTasks += b.tasks.length; nLate += b.late.length;
    let t = '■ ' + b.name;
    if (b.late.length) t += '\n\nÜberfällig\n' + list(b.late);
    if (b.rows.length) t += '\n\nVorgänge diese Woche\n' + list(b.rows);
    if (b.tasks.length) t += '\n\nAufgaben diese Woche\n' + list(b.tasks);
    if (b.open.length) t += '\n\nOffene Aufgaben ohne Termin\n' + list(b.open);
    if (url) t += '\n\nZum Projekt: ' + url + '/';
    parts.push(t);
  }
  const head = 'Hallo ' + u.name + ',\n\nhier ist deine Übersicht für KW ' + kw + ' (' + logic.fmt(monday) + ' bis ' + logic.fmt(monday + 6) + ').';
  const text = head + '\n\n' + (parts.length ? parts.join('\n\n\n') : 'Für diese Woche ist dir nichts zugeordnet.') +
    '\n\nDiese Übersicht kommt jeden Montag automatisch vom Terminplaner. Abschalten kannst du sie unter „Mein Profil“.';
  const bits = [nRows ? nRows + (nRows === 1 ? ' Vorgang' : ' Vorgänge') : '', nTasks ? nTasks + (nTasks === 1 ? ' Aufgabe' : ' Aufgaben') : '', nLate ? nLate + ' überfällig' : ''].filter(Boolean);
  const subject = 'Deine Woche (KW ' + kw + ')' + (bits.length ? ': ' + bits.join(', ') : '');
  return { subject, text, count: nRows + nTasks + nLate + [...entry.projects.values()].reduce((s, b) => s + b.open.length, 0) };
}

// Versand; jede Person bekommt die Übersicht einer Woche nur einmal. preview: nur an „onlyUser“, ohne Merker
export async function runWeekly({ today = berlinToday(), force = false, onlyUser = null } = {}) {
  if (!mailInfo().configured) return { ok: false, reason: 'E-Mail-Versand ist nicht eingerichtet', sent: 0 };
  if (!force && logic.isoWd(today) !== 1) return { ok: true, sent: 0, skipped: 'kein Montag' };
  const monday = mondayOf(today), per = await weeklyItems(monday);
  let sent = 0; const errors = [];
  if (onlyUser) {
    const u = onlyUser, entry = per.get(u.id) || { user: u, projects: new Map() };
    if (!String(u.email || '').trim()) return { ok: false, reason: 'Für dich ist keine E-Mail-Adresse hinterlegt', sent: 0 };
    const m = weeklyText({ ...entry, user: u }, monday);
    await sendMail({ to: u.email, subject: '[Vorschau] ' + m.subject, text: m.text });
    return { ok: true, sent: 1, items: m.count, to: u.email };
  }
  for (const [, entry] of per) {
    const u = entry.user;
    if (u.weekly === false || !String(u.email || '').trim()) continue;
    const m = weeklyText(entry, monday); if (!m.count) continue;   // nichts zu tun: keine Mail
    const seen = await q('SELECT 1 FROM tp_weekly WHERE user_id = $1 AND week_dn = $2', [u.id, monday]);
    if (seen.rows.length) continue;
    try {
      await sendMail({ to: u.email, subject: m.subject, text: m.text });
      await q('INSERT INTO tp_weekly (user_id, week_dn, sent_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [u.id, monday, Math.floor(Date.now() / 1000)]);
      sent++;
    } catch (e) { errors.push(u.name + ': ' + e.message); }
  }
  await q('DELETE FROM tp_weekly WHERE week_dn < $1', [monday - 120]);
  return { ok: !errors.length, sent, errors };
}
