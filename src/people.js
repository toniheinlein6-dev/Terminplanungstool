// Benutzerkonten sind die Quelle neuer Zuordnungen. Namen bleiben als lesbare
// Momentaufnahme für Exporte, alte Pläne und inzwischen gelöschte Konten erhalten.
function hasUserDirectory() { return typeof window.TP_TEAM === 'function'; }
function assigneeTeam() {
  return hasUserDirectory() ? window.TP_TEAM().map(user => ({ ...user, id: String(user.id) })) : [];
}
const splitAssigneeNames = value => String(value || '').split(/\s*(?:,|;|\/|&|\+|\bund\b)\s*/i).map(name => name.trim()).filter(Boolean);
function sanitizeAssignees(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(), result = [];
  value.forEach(value => {
    const entry = value && typeof value === 'object' && !Array.isArray(value) ? value : { name: value };
    const raw = String(entry.id ?? ''), id = /^[1-9]\d*$/.test(raw) ? raw : null;
    const name = String(entry.name ?? '').trim() || (id ? 'Benutzer #' + id : raw.trim());
    if (!name) return;
    const key = id ? 'user:' + id : 'name:' + name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); result.push({ id, name }); }
  });
  return result;
}
function assigneeEntries(row) {
  const team = assigneeTeam();
  if (Array.isArray(row.assignees)) {
    return sanitizeAssignees(row.assignees).map(entry => {
      const member = entry.id && team.find(user => user.id === entry.id);
      return { id: entry.id, name: member ? member.name : entry.name, available: !!member };
    });
  }
  return sanitizeAssignees(splitAssigneeNames(row.who).map(name => {
    const candidates = team.filter(user => user.name.trim().toLowerCase() === name.toLowerCase());
    return candidates.length === 1 ? { id: candidates[0].id, name: candidates[0].name } : { id: null, name };
  })).map(entry => ({ ...entry, available: !!entry.id }));
}
function assigneeNames(row) { return assigneeEntries(row).map(entry => entry.name).join(', '); }
function assigneeInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? [...parts[0]].slice(0, 2).join('') : [...parts[0]][0] + [...parts.at(-1)][0]).toUpperCase();
}
function assigneeShortText(row) {
  const entries = assigneeEntries(row);
  return entries.slice(0, 2).map(entry => assigneeInitials(entry.name)).join(' · ') + (entries.length > 2 ? ' +' + (entries.length - 2) : '');
}
function planWithAssignees(plan) {
  return { ...plan, rows: plan.rows.map(row => {
    const assignees = assigneeEntries(row).map(({ id, name }) => ({ id, name }));
    return { ...row, assignees, who: assignees.map(entry => entry.name).join(', ') };
  }) };
}
function setRowAssignees(i, entries) {
  const row = state.rows[i]; if (!row || readOnly) return;
  const chosen = sanitizeAssignees(entries), existing = assigneeEntries(row), team = assigneeTeam();
  // Neue Einträge kommen ausschließlich aus der Benutzerliste; bisherige
  // ungebundene oder gelöschte Zuordnungen dürfen erhalten bleiben.
  row.assignees = chosen.filter(entry => entry.id ? team.some(user => user.id === entry.id) || existing.some(old => old.id === entry.id)
    : existing.some(old => old.id === null && old.name.toLowerCase() === entry.name.toLowerCase()));
  row.who = assigneeNames(row);
  filterEditId = row.id;
  refresh(); changed(true);
}
