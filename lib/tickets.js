// Gemeinsame Ticketablage: alle Rollen lesen/erstellen, Administratoren bearbeiten.
import crypto from 'node:crypto';
import { q, client } from './db.js';

const CATEGORIES = { bug: 'problem', improvement: 'idee', question: 'frage' };
const STATUSES = { new: 'neu', in_progress: 'arbeit', done: 'erledigt', rejected: 'abgelehnt' };
const categoryOf = kind => ({ problem: 'bug', idee: 'improvement', frage: 'question' }[kind] || kind);
const statusOf = status => ({ neu: 'new', arbeit: 'in_progress', erledigt: 'done', abgelehnt: 'rejected' }[status] || status);
const iso = seconds => new Date(Number(seconds) * 1000).toISOString();
const now = () => Math.floor(Date.now() / 1000);
const okId = id => typeof id === 'string' && /^T-(?:[0-9]+|[A-F0-9]{12})$/.test(id) && id.length <= 64;
const okProjectId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const versionOk = version => Number.isInteger(version) && version > 0 && version < 2147483647;
const contentKeys = ['title', 'description', 'category', 'status', 'response'];
const sameContent = (a, b) => contentKeys.every(key => a[key] === b[key]);
const rowOut = r => ({
  id: r.ticket_key, title: r.title, description: r.body, category: categoryOf(r.kind),
  status: statusOf(r.status), response: r.admin_note || '', version: Number(r.version),
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  createdBy: r.created_by || '', createdByName: r.created_by_name || '(gelöscht)',
  updatedBy: r.updated_by || '', updatedByName: r.updated_by_name || '(unbekannt)',
  projectId: r.project_id || null
});
const eventOf = (ticket, kind) => ({
  version: ticket.version, at: ticket.updatedAt, by: ticket.updatedBy,
  byName: ticket.updatedByName, kind,
  ...Object.fromEntries(contentKeys.map(key => [key, ticket[key]]))
});
async function getRow(id, db = { query: q }) {
  return (await db.query('SELECT * FROM tp_tickets WHERE ticket_key=$1', [id])).rows[0] || null;
}
async function eventRows(id, db = { query: q }) {
  return (await db.query('SELECT json FROM tp_ticket_events WHERE ticket_key=$1 ORDER BY version', [id])).rows.map(r => JSON.parse(r.json));
}
async function addEvent(db, id, event) {
  await db.query('INSERT INTO tp_ticket_events (ticket_key, version, json) VALUES ($1,$2,$3)', [id, event.version, JSON.stringify(event)]);
}

// Bestands-Tickets bekommen einen stabilen Schlüssel und den letzten bekannten Stand.
// Frühere Änderungen lassen sich aus der alten Tabelle nicht nachträglich rekonstruieren.
export async function initializeTickets() {
  const rows = (await q('SELECT t.*, u.name AS author_name FROM tp_tickets t LEFT JOIN tp_users u ON u.id=t.user_id WHERE t.ticket_key IS NULL OR t.created_by_name IS NULL')).rows;
  for (const row of rows) {
    const id = row.ticket_key || 'T-' + row.id;
    const author = row.user_id == null ? '' : String(row.user_id);
    const name = row.author_name || '(gelöscht)';
    const unchanged = Number(row.created_at) === Number(row.updated_at);
    await q('UPDATE tp_tickets SET ticket_key=$1, created_by=$2, created_by_name=$3, updated_by=$4, updated_by_name=$5 WHERE id=$6 AND (ticket_key IS NULL OR created_by_name IS NULL)',
      [id, author, name, unchanged ? author : '', unchanged ? name : '(unbekannt)', row.id]);
  }
  // Separat idempotent, damit auch ein abgebrochener Backfill fortgesetzt wird.
  const missing = (await q('SELECT t.* FROM tp_tickets t LEFT JOIN tp_ticket_events e ON e.ticket_key=t.ticket_key AND e.version=t.version WHERE e.ticket_key IS NULL')).rows;
  for (const row of missing) {
    await q('INSERT INTO tp_ticket_events (ticket_key, version, json) VALUES ($1,$2,$3) ON CONFLICT (ticket_key,version) DO NOTHING',
      [row.ticket_key, Number(row.version), JSON.stringify(eventOf(rowOut(row), 'created'))]);
  }
}

export function createTicketService({ fail, needUser, needPost, send, notify }) {
  function content(value, { legacy = false, question = false } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Ungültiges Ticket');
    const { title, description, category, status, response = '' } = value;
    if (typeof title !== 'string' || title.trim().length < (legacy ? 0 : 3) || title.length > (legacy ? 200 : 160)) fail(400, 'Titel: 3 bis 160 Zeichen');
    if (typeof description !== 'string' || description.trim().length < (legacy ? 0 : 10) || description.length > 10000) fail(400, 'Beschreibung: 10 bis 10000 Zeichen');
    if (typeof category !== 'string' || !Object.hasOwn(CATEGORIES, category) || (category === 'question' && !legacy && !question)) fail(400, 'Kategorie');
    if (typeof status !== 'string' || !Object.hasOwn(STATUSES, status)) fail(400, 'Status');
    if (typeof response !== 'string' || response.length > (legacy ? 8000 : 5000)) fail(400, 'Rückmeldung: höchstens 5000 Zeichen');
    if (!legacy && status === 'rejected' && !response.trim()) fail(400, 'Bitte die Ablehnung begründen.');
    return { title: legacy ? title : title.trim(), description: legacy ? description : description.trim(), category, status, response: legacy ? response : response.trim() };
  }
  function checkId(id) { if (!okId(id)) fail(400, 'Ticketkennung ungültig'); }
  function conflict(ticket) { fail(409, 'conflict', { current: ticket }); }
  async function transaction(fn) {
    const db = await client();
    try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
    catch (error) { try { await db.query('ROLLBACK'); } catch {} throw error; }
    finally { db.release(); }
  }
  async function notifySafely(...args) {
    try { await notify(...args); }
    catch (error) { console.error('Ticketbenachrichtigung:', error.message); }
  }
  async function create(req, res, legacy = false) {
    const user = await needUser(req), input = await needPost(req);
    const data = content({ title: input.title, description: legacy ? input.body : input.description,
      category: legacy ? categoryOf(input.kind || 'idee') : input.category, status: 'new', response: '' }, { question: true });
    const ticket = await transaction(async db => {
      const t = now(), id = 'T-' + crypto.randomBytes(6).toString('hex').toUpperCase();
      const row = (await db.query('INSERT INTO tp_tickets (ticket_key,user_id,kind,title,body,status,admin_note,project_id,created_at,updated_at,version,created_by,created_by_name,updated_by,updated_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,1,$10,$11,$10,$11) RETURNING *',
        [id, user.id, CATEGORIES[data.category], data.title, data.description, STATUSES.new, '', okProjectId(input.projectId) ? input.projectId : null, t, String(user.id), user.name])).rows[0];
      const out = rowOut(row); await addEvent(db, id, eventOf(out, 'created')); return out;
    });
    await notifySafely('created', ticket, null, user);
    send(res, 201, { ticket });
  }
  const actions = {
    async tickets_list(req, res) {
      await needUser(req);
      send(res, 200, { tickets: (await q('SELECT * FROM tp_tickets ORDER BY updated_at DESC,id DESC')).rows.map(rowOut) });
    },
    async ticket_get(req, res, qs) {
      await needUser(req); const id = qs.get('id'); checkId(id);
      // Ein JOIN liest Ticket und Verlauf aus demselben Datenbank-Snapshot.
      const rows = (await q('SELECT t.*,e.json AS event_json FROM tp_tickets t LEFT JOIN tp_ticket_events e ON e.ticket_key=t.ticket_key WHERE t.ticket_key=$1 ORDER BY e.version', [id])).rows;
      if (!rows.length) fail(404, 'Ticket nicht gefunden');
      send(res, 200, { ticket: rowOut(rows[0]), events: rows.filter(r => r.event_json).map(r => JSON.parse(r.event_json)) });
    },
    ticket_create: (req, res) => create(req, res),
    ticket_new: (req, res) => create(req, res, true),
    async ticket_update(req, res) {
      const user = await needUser(req, 'admin'), input = await needPost(req);
      checkId(input.id); if (!versionOk(input.base)) fail(400, 'Ticketversion fehlt oder ist ungültig');
      let before;
      const ticket = await transaction(async db => {
        const row = await getRow(input.id, db); if (!row) fail(404, 'Ticket nicht gefunden');
        before = rowOut(row); if (before.version !== input.base) conflict(before);
        const data = content(input, { question: true });
        const updated = (await db.query('UPDATE tp_tickets SET kind=$1,title=$2,body=$3,status=$4,admin_note=$5,updated_at=$6,updated_by=$7,updated_by_name=$8,version=version+1 WHERE ticket_key=$9 AND version=$10 RETURNING *',
          [CATEGORIES[data.category], data.title, data.description, STATUSES[data.status], data.response, Math.max(now(), Number(row.updated_at)), String(user.id), user.name, input.id, input.base])).rows[0];
        if (!updated) { const current = await getRow(input.id, db); conflict(current ? rowOut(current) : null); }
        const out = rowOut(updated); await addEvent(db, input.id, eventOf(out, 'updated')); return out;
      });
      await notifySafely('updated', ticket, before, user);
      send(res, 200, { ticket });
    },
    async ticket_del(req, res) {
      await needUser(req, 'admin'); await needPost(req); fail(405, 'Tickets bleiben im Verlauf erhalten und können nicht gelöscht werden.');
    }
  };
  // Sicherer alter Listen-Endpunkt: ebenfalls alle Tickets, keine abweichenden Rechte.
  actions.tickets = actions.tickets_list;

  async function exportData() {
    const rows = (await q('SELECT t.*,e.json AS event_json FROM tp_tickets t LEFT JOIN tp_ticket_events e ON e.ticket_key=t.ticket_key ORDER BY t.id,e.version')).rows;
    const tickets = new Map(), ticketEvents = [];
    for (const row of rows) {
      tickets.set(row.ticket_key, rowOut(row));
      if (row.event_json) ticketEvents.push({ ticketId: row.ticket_key, ...JSON.parse(row.event_json) });
    }
    return { tickets: [...tickets.values()], ticketEvents };
  }
  function metaString(value, max) { return typeof value === 'string' && value.length <= max; }
  function validDate(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
  function validateImport(input) {
    if (input.v === 1 || input.v == null) return { tickets: [], events: new Map(), bases: {} };
    if (input.v !== 2 || !Array.isArray(input.tickets) || !Array.isArray(input.ticketEvents)) fail(400, 'Ungültige Ticketsicherung');
    const tickets = [], ids = new Set(), events = new Map();
    for (const value of input.tickets) {
      checkId(value?.id); if (ids.has(value.id)) fail(400, 'Doppelte Ticketkennung in der Sicherung');
      const legacy = /^T-[0-9]+$/.test(value.id);
      const data = content(value, { legacy, question: true });
      if (!versionOk(value.version) || !validDate(value.createdAt) || !validDate(value.updatedAt) || Date.parse(value.createdAt) > Date.parse(value.updatedAt)
        || !metaString(value.createdBy, 64) || !metaString(value.updatedBy, 64) || !metaString(value.createdByName, 80) || !value.createdByName.trim()
        || !metaString(value.updatedByName, 80) || !value.updatedByName.trim()) fail(400, 'Ungültige Ticketmetadaten');
      if (value.projectId != null && !okProjectId(value.projectId)) fail(400, 'Ungültiger Ticket-Projektbezug');
      tickets.push({ id: value.id, ...data, version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt,
        createdBy: value.createdBy, createdByName: value.createdByName, updatedBy: value.updatedBy, updatedByName: value.updatedByName, projectId: value.projectId });
      ids.add(value.id); events.set(value.id, []);
    }
    for (const value of input.ticketEvents) {
      if (!ids.has(value?.ticketId) || !versionOk(value.version) || !validDate(value.at) || !metaString(value.by, 64) || !metaString(value.byName, 80) || !value.byName.trim()
        || !['created', 'updated', 'restored'].includes(value.kind)) fail(400, 'Ungültiger Ticketverlauf');
      const data = content(value, { legacy: /^T-[0-9]+$/.test(value.ticketId), question: true });
      events.get(value.ticketId).push({ version: value.version, at: value.at, by: value.by, byName: value.byName, kind: value.kind, ...data });
    }
    for (const ticket of tickets) {
      const history = events.get(ticket.id).sort((a, b) => a.version - b.version);
      if (history.length !== ticket.version || history.some((event, index) => event.version !== index + 1)) fail(400, 'Ticketverlauf ist unvollständig oder enthält doppelte Versionen');
      const last = history.at(-1);
      if (!sameContent(last, ticket) || last.at !== ticket.updatedAt || last.by !== ticket.updatedBy || last.byName !== ticket.updatedByName) fail(400, 'Ticket und Verlauf passen nicht zusammen');
    }
    const bases = input.ticketBases || {};
    if (!bases || typeof bases !== 'object' || Array.isArray(bases) || Object.entries(bases).some(([id, version]) => !okId(id) || !Number.isInteger(version) || version < 0)) fail(400, 'Ungültige Ticketversionen für die Wiederherstellung');
    return { tickets, events, bases };
  }
  // Vor sämtlichen Schreiboperationen werden alle Konflikte geprüft.
  async function prepareRestore(db, backup) {
    const plans = [];
    for (const ticket of backup.tickets) {
      const row = await getRow(ticket.id, db), current = row ? rowOut(row) : null;
      // Optionale Metadaten aus älteren Sicherungen löschen keinen bestehenden Projektbezug.
      if (ticket.projectId === undefined) ticket.projectId = current?.projectId || null;
      const existingEvents = row ? await eventRows(ticket.id, db) : [];
      const byVersion = new Map(existingEvents.map(event => [event.version, event]));
      const incoming = backup.events.get(ticket.id);
      for (const event of incoming) {
        const existing = byVersion.get(event.version);
        if (existing && JSON.stringify(existing) !== JSON.stringify(event)) conflict(current);
      }
      const identical = current && JSON.stringify(current) === JSON.stringify(ticket);
      if (current && !identical && backup.bases[ticket.id] !== current.version) conflict(current);
      if (!current && Object.hasOwn(backup.bases, ticket.id) && backup.bases[ticket.id] !== 0) conflict(null);
      if (current && (ticket.createdAt !== current.createdAt || ticket.createdBy !== current.createdBy || ticket.createdByName !== current.createdByName)) conflict(current);
      if (!identical && !versionOk(Math.max(ticket.version, current?.version || 0) + 1)) fail(400, 'Ticketversion ist zu groß');
      plans.push({ ticket, current, incoming, missing: incoming.filter(event => !byVersion.has(event.version)), identical });
    }
    return plans;
  }
  async function applyRestore(db, plans, user) {
    let imported = 0, skipped = 0;
    for (const plan of plans) {
      if (plan.identical && !plan.missing.length) { skipped++; continue; }
      const { ticket, current } = plan;
      const version = Math.max(ticket.version, current?.version || 0) + 1;
      if (!versionOk(version)) fail(400, 'Ticketversion ist zu groß');
      const at = Math.max(now(), Date.parse(ticket.updatedAt) / 1000, current ? Date.parse(current.updatedAt) / 1000 : 0);
      let row;
      if (current) {
        row = (await db.query('UPDATE tp_tickets SET kind=$1,title=$2,body=$3,status=$4,admin_note=$5,updated_at=$6,updated_by=$7,updated_by_name=$8,version=$9,project_id=$12 WHERE ticket_key=$10 AND version=$11 RETURNING *',
          [CATEGORIES[ticket.category], ticket.title, ticket.description, STATUSES[ticket.status], ticket.response, at, String(user.id), user.name, version, ticket.id, current.version, ticket.projectId])).rows[0];
      } else {
        // user_id bleibt NULL: eine fremde Sicherung darf keine Mail an zufällig gleich nummerierte Benutzer schicken.
        row = (await db.query('INSERT INTO tp_tickets (ticket_key,user_id,kind,title,body,status,admin_note,project_id,created_at,updated_at,version,created_by,created_by_name,updated_by,updated_by_name) VALUES ($1,NULL,$2,$3,$4,$5,$6,$14,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (ticket_key) DO NOTHING RETURNING *',
          [ticket.id, CATEGORIES[ticket.category], ticket.title, ticket.description, STATUSES[ticket.status], ticket.response, Date.parse(ticket.createdAt) / 1000, at, version, ticket.createdBy, ticket.createdByName, String(user.id), user.name, ticket.projectId])).rows[0];
      }
      if (!row) { const actual = await getRow(ticket.id, db); conflict(actual ? rowOut(actual) : null); }
      for (const event of plan.missing) await addEvent(db, ticket.id, event);
      await addEvent(db, ticket.id, eventOf(rowOut(row), 'restored')); imported++;
    }
    return { ticketsImported: imported, ticketsSkipped: skipped };
  }
  return { actions, exportData, validateImport, prepareRestore, applyRestore };
}
