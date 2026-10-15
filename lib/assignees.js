// Benutzer-IDs sind maßgeblich. Namen bleiben als lesbare Snapshots für gelöschte
// Benutzer und bisherige Freitexteinträge erhalten.
const userId = value => {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return /^[1-9]\d*$/.test(id) ? id : null;
};
const nameOf = value => value == null ? '' : String(value).trim();
const nameKey = value => nameOf(value).toLowerCase();
const splitLegacy = value => nameOf(value).split(/\s*(?:,|;|\/|&|\+|\bund\b)\s*/i).map(name => name.trim()).filter(Boolean);

export function resolveAssignees(row, users = []) {
  const byId = new Map(), byName = new Map();
  for (const user of users) {
    const id = userId(user?.id), name = nameOf(user?.name);
    if (!id || !name) continue;
    byId.set(id, { id, name });
    const key = nameKey(name);
    if (!byName.has(key)) byName.set(key, new Map());
    byName.get(key).set(id, { id, name });
  }
  const explicit = Array.isArray(row?.assignees);
  const source = explicit ? row.assignees : splitLegacy(row?.who).map(name => ({ id: null, name }));
  const resolved = [], seenIds = new Set(), seenNames = new Set();
  for (const value of source) {
    const entry = value && typeof value === 'object' && !Array.isArray(value) ? value : { name: value };
    let id = userId(entry.id), name = nameOf(entry.name);
    if (id && byId.has(id)) name = byId.get(id).name;
    else if (!explicit && name) {
      const candidates = byName.get(nameKey(name));
      if (candidates?.size === 1) { const user = candidates.values().next().value; id = user.id; name = user.name; }
    }
    if (!name && id) name = 'Benutzer #' + id;
    if (!name && entry.id != null) name = nameOf(entry.id);
    if (!name) continue;
    // Verschiedene IDs bleiben auch bei identischen Namen verschiedene Personen.
    if (id ? seenIds.has(id) : seenNames.has(nameKey(name))) continue;
    if (id) seenIds.add(id); else seenNames.add(nameKey(name));
    resolved.push({ id, name });
  }
  return resolved;
}

export function normalizeProjectAssignees(plan, users = []) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.rows)) return plan;
  return { ...plan, rows: plan.rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const assignees = resolveAssignees(row, users);
    return { ...row, assignees, who: assignees.map(assignee => assignee.name).join(', ') };
  }), ...(Array.isArray(plan.tasks) ? { tasks: plan.tasks.map(task => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return task;
    const assignees = resolveAssignees(task, users);
    return { ...task, assignees, who: assignees.map(assignee => assignee.name).join(', ') };
  }) } : {}) };
}
