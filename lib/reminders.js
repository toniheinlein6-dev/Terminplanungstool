// E-Mail-Erinnerung zwei Tage vor dem Ende eines Vorgangs.
// Zugeordnet wird über die Spalte „Verantwortlich“: steht dort der Benutzername (auch mehrere, durch Komma getrennt),
// bekommt diese Person die Erinnerung, sofern sie eine E-Mail-Adresse hinterlegt und Erinnerungen eingeschaltet hat.
import { createRequire } from 'node:module';
import { q } from './db.js';
import { sendMail, mailInfo, appUrl } from './mail.js';
const require = createRequire(import.meta.url);
const logic = require('./logic.cjs');

const DAYS_AHEAD = 2;
const DEFAULT_LANES = [{ id: '', done: false }, { id: 'arbeit', done: false }, { id: 'fertig', done: true }];

export function berlinToday() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return logic.parseISO(p);
}
const splitWho = s => String(s || '').split(/\s*(?:,|;|\/|&|\+|\bund\b)\s*/i).map(x => x.trim().toLowerCase()).filter(Boolean);

// Ermittelt fällige Erinnerungen (ohne zu senden)
export async function dueReminders(today) {
  const users = (await q("SELECT id, name, email FROM tp_users WHERE remind = TRUE AND email IS NOT NULL AND email <> ''")).rows;
  const byName = new Map(users.map(u => [u.name.trim().toLowerCase(), u]));
  const projects = (await q('SELECT id, name, json FROM tp_projects')).rows;
  const due = [];
  for (const p of projects) {
    let plan; try { plan = JSON.parse(p.json); } catch (e) { continue; }
    if (!plan || !Array.isArray(plan.rows)) continue;
    const s = logic.schedule(plan);
    const lanes = Array.isArray(plan.lanes) && plan.lanes.length ? plan.lanes : DEFAULT_LANES;
    plan.rows.forEach((r, i) => {
      const o = s.out[i]; if (!o || o.summary || o.err) return;
      const lane = lanes.find(l => (l.id ?? '') === (r.st || '')) || lanes[0];
      if (lane && lane.done) return;
      if (o.E < today || o.E > today + DAYS_AHEAD) return;
      for (const n of splitWho(r.who)) {
        const u = byName.get(n); if (!u) continue;
        due.push({ user: u, projectId: p.id, projectName: p.name, rowId: Number(r.id), name: r.name || 'ohne Namen', end: o.E, milestone: r.type === 'meilenstein', psp: s.psp[i] });
      }
    });
  }
  return due;
}

export async function runReminders({ today = berlinToday() } = {}) {
  if (!mailInfo().configured) return { ok: false, reason: 'E-Mail-Versand ist nicht eingerichtet', sent: 0, items: 0 };
  const due = await dueReminders(today);
  const fresh = [];
  for (const d of due) {
    const r = await q('SELECT 1 FROM tp_reminders WHERE project_id=$1 AND row_id=$2 AND end_dn=$3 AND user_id=$4', [d.projectId, d.rowId, d.end, d.user.id]);
    if (!r.rows.length) fresh.push(d);
  }
  const byUser = new Map();
  fresh.forEach(d => { const k = d.user.id; if (!byUser.has(k)) byUser.set(k, []); byUser.get(k).push(d); });
  let sent = 0; const errors = [];
  for (const [, list] of byUser) {
    const u = list[0].user;
    list.sort((a, b) => a.end - b.end);
    const left = e => e - today === 0 ? 'heute' : e - today === 1 ? 'morgen' : 'in ' + (e - today) + ' Tagen';
    const lines = list.map(d => '• ' + d.projectName + ' – ' + d.psp + ' ' + d.name + (d.milestone ? ' (Meilenstein)' : '') + ': ' + (d.milestone ? 'am ' : 'Ende ') + logic.fmt(d.end) + ' (' + left(d.end) + ')');
    const url = appUrl();
    const text = 'Hallo ' + u.name + ',\n\n' + (list.length === 1 ? 'dieser Vorgang endet bald:' : 'diese Vorgänge enden bald:') + '\n\n' + lines.join('\n') +
      '\n\nWenn ein Vorgang schon erledigt ist, setze ihn im Terminplaner auf eine erledigte Bahn, dann kommen keine weiteren Erinnerungen.' +
      (url ? '\n\n' + url : '') + '\n\nDiese Nachricht wurde automatisch vom Terminplaner verschickt. Erinnerungen abschalten kannst du unter „Mein Profil“.';
    try {
      await sendMail({ to: u.email, subject: list.length === 1 ? 'Erinnerung: „' + list[0].name + '“ endet ' + left(list[0].end) : 'Erinnerung: ' + list.length + ' Vorgänge enden bald', text });
      for (const d of list) await q('INSERT INTO tp_reminders (project_id, row_id, end_dn, user_id, sent_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [d.projectId, d.rowId, d.end, u.id, Math.floor(Date.now() / 1000)]);
      sent++;
    } catch (e) { errors.push(u.name + ': ' + e.message); }
  }
  await q('DELETE FROM tp_reminders WHERE end_dn < $1', [today - 60]);   // alte Einträge aufräumen
  return { ok: !errors.length, sent, items: fresh.length, errors };
}
