// Mehrfachauswahl der Verantwortlichen aus dem Benutzerverzeichnis.
let apState = null, apInitialized = false, apPositionFrame = 0;

const apEl = id => document.getElementById(id);
const apEsc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const apKey = entry => entry.id != null ? 'user:' + String(entry.id) : 'legacy:' + String(entry.name || '');
const apIsReadOnly = () => typeof readOnly !== 'undefined' && readOnly;

function assigneeCell(row, i) {
  if (!hasUserDirectory()) return '<input data-f="who" type="text" list="peopleList" value="' + apEsc(assigneeNames(row)) + '" aria-label="Verantwortlich" autocomplete="off">';
  const entries = assigneeEntries(row), names = assigneeNames(row);
  const label = names ? 'Verantwortliche: ' + names : 'Verantwortliche auswählen';
  const initials = entries.slice(0, 2).map(entry => '<span class="who-initials" aria-hidden="true">' + apEsc(assigneeInitials(entry.name)) + '</span>').join('');
  const extra = entries.length > 2 ? '<span class="who-more" aria-hidden="true">+' + (entries.length - 2) + '</span>' : '';
  return '<button class="who-picker-btn" type="button" data-who-row="' + apEsc(row.id) + '" title="' + apEsc(names || 'Keine Verantwortlichen zugeordnet') + '" aria-label="' + apEsc(label) + '" aria-haspopup="dialog" aria-controls="peoplePicker" aria-expanded="' + String(!!apState && String(apState.rowId) === String(row.id)) + '">' +
    (entries.length ? initials + extra : '<span class="who-empty" aria-hidden="true">–</span>') + '<span class="who-caret" aria-hidden="true">▾</span></button>';
}

function apFindRow() {
  if (!apState) return null;
  const index = state.rows.findIndex(row => String(row.id) === String(apState.rowId));
  return index < 0 ? null : { row: state.rows[index], index };
}
function apFindAnchor(rowId) {
  const box = apEl('rowsL');
  if (!box) return null;
  return [...box.querySelectorAll('[data-who-row]')].find(button => String(button.dataset.whoRow) === String(rowId)) || null;
}
function apExpanded(rowId, value) {
  const button = apFindAnchor(rowId);
  if (button) button.setAttribute('aria-expanded', String(value));
}
function apPosition() {
  apPositionFrame = 0;
  if (!apState) return;
  const panel = apEl('peoplePicker'), anchor = apFindAnchor(apState.rowId);
  if (!panel || panel.hidden) return;
  if (!anchor) { closeAssigneePicker(false, false); return; }
  const viewport = window.visualViewport;
  const viewportLeft = viewport ? viewport.offsetLeft : 0, viewportTop = viewport ? viewport.offsetTop : 0;
  const viewportWidth = viewport ? viewport.width : document.documentElement.clientWidth;
  const viewportHeight = viewport ? viewport.height : window.innerHeight;
  const margin = 8, gap = 6, rect = anchor.getBoundingClientRect();
  const bounds = anchor.closest('.body');
  if (bounds) {
    const clip = bounds.getBoundingClientRect();
    if (rect.bottom <= clip.top || rect.top >= clip.bottom || rect.right <= clip.left || rect.left >= clip.right) { closeAssigneePicker(false, true); return; }
  }
  // Eine Bildschirmtastatur verkleinert den sichtbaren Ausschnitt; die Suche bleibt dabei geöffnet.
  if (rect.bottom <= 0 || rect.top >= document.documentElement.clientHeight || rect.right <= 0 || rect.left >= document.documentElement.clientWidth) { closeAssigneePicker(false, true); return; }
  const width = Math.max(0, Math.min(340, viewportWidth - margin * 2));
  panel.style.width = width + 'px';
  panel.style.maxWidth = Math.max(0, viewportWidth - margin * 2) + 'px';
  panel.style.maxHeight = Math.max(0, Math.min(440, viewportHeight - margin * 2)) + 'px';
  const panelHeight = panel.getBoundingClientRect().height;
  const below = viewportTop + viewportHeight - margin - rect.bottom - gap;
  const above = rect.top - viewportTop - margin - gap;
  const top = below < Math.min(240, panelHeight) && above > below ? rect.top - gap - panelHeight : rect.bottom + gap;
  panel.style.left = Math.max(viewportLeft + margin, Math.min(rect.left, viewportLeft + viewportWidth - margin - width)) + 'px';
  panel.style.top = Math.max(viewportTop + margin, Math.min(top, viewportTop + viewportHeight - margin - panelHeight)) + 'px';
}
function apSchedulePosition() {
  if (apState && !apPositionFrame) apPositionFrame = requestAnimationFrame(apPosition);
}
function apText(tag, value, className) {
  const element = document.createElement(tag);
  if (value != null) element.textContent = String(value);
  if (className) element.className = className;
  return element;
}
function apRenderOptions(row) {
  const container = apEl('peoplePickerOptions'), search = apEl('peoplePickerSearch').value.trim().toLocaleLowerCase('de-DE');
  const selected = assigneeEntries(row), selectedKeys = new Set(selected.map(apKey));
  const seen = new Set();
  const team = assigneeTeam().filter(user => {
    if (user.id == null || seen.has(String(user.id))) return false;
    seen.add(String(user.id)); return true;
  }).map(user => ({ id: String(user.id), name: user.name, available: true })).sort((a, b) => a.name.localeCompare(b.name, 'de-DE') || a.id.localeCompare(b.id));
  const previous = selected.filter(entry => entry.id == null || !seen.has(String(entry.id)));
  const duplicates = new Map();
  team.forEach(user => duplicates.set(user.name, (duplicates.get(user.name) || 0) + 1));
  const active = document.activeElement;
  const focusedKey = active && container.contains(active) ? active.dataset.assigneeKey : null;
  const fragment = document.createDocumentFragment();
  let resultCount = 0, focusTarget = null;
  const group = (title, entries, historical) => {
    const matching = entries.filter(entry => !search || String(entry.name).toLocaleLowerCase('de-DE').includes(search));
    if (!matching.length) return;
    const fieldset = apText('fieldset', null, 'people-picker-group');
    fieldset.append(apText('legend', title));
    matching.forEach(entry => {
      const key = apKey(entry), label = apText('label', null, 'people-picker-option'), checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = selectedKeys.has(key); checkbox.disabled = apIsReadOnly(); checkbox.dataset.assigneeKey = key;
      const name = apText('span', entry.name, 'people-picker-name');
      if (historical || duplicates.get(entry.name) > 1) {
        const detail = historical ? (entry.id == null ? 'Bisheriger Eintrag' : 'Benutzer nicht mehr vorhanden') : 'Benutzer ' + entry.id;
        name.append(apText('small', detail));
      }
      checkbox.addEventListener('change', () => {
        const current = apFindRow();
        if (!current || apIsReadOnly()) { refreshAssigneePicker(); return; }
        let next = assigneeEntries(current.row).map(value => ({ id: value.id == null ? null : String(value.id), name: value.name }));
        if (checkbox.checked && !next.some(value => apKey(value) === key)) next.push({ id: entry.id, name: entry.name });
        else if (!checkbox.checked) next = next.filter(value => apKey(value) !== key);
        setRowAssignees(current.index, next);
        refreshAssigneePicker();
        apEl('peoplePickerStatus').textContent = next.length ? next.length + (next.length === 1 ? ' Person zugeordnet.' : ' Personen zugeordnet.') : 'Keine Person zugeordnet.';
      });
      label.append(checkbox, name); fieldset.append(label); resultCount++;
      if (focusedKey === key) focusTarget = checkbox;
    });
    fragment.append(fieldset);
  };
  group('Benutzer', team, false);
  group('Bisherige Zuordnung', previous, true);
  if (!resultCount) fragment.append(apText('p', search ? 'Keine passenden Personen gefunden.' : 'Noch keine Benutzer verfügbar.', 'people-picker-empty'));
  container.replaceChildren(fragment);
  if (focusTarget && !focusTarget.disabled) focusTarget.focus({ preventScroll: true });
}

function refreshAssigneePicker() {
  if (!apState) return;
  const current = apFindRow(), anchor = apFindAnchor(apState.rowId);
  if (!current || !anchor || !hasUserDirectory()) { closeAssigneePicker(false, false); return; }
  apExpanded(apState.rowId, true);
  apEl('peoplePickerRow').textContent = current.row.name || 'Vorgang ' + current.row.id;
  apEl('peoplePickerHint').textContent = apIsReadOnly() ? 'Nur Ansicht: Du kannst die zugeordneten Personen ansehen.' : 'Häkchen ändern die Zuordnung. Der Plan wird automatisch gespeichert.';
  apRenderOptions(current.row);
  apPosition();
}
function closeAssigneePicker(restoreFocus = true, redraw = true) {
  if (!apState) return;
  const rowId = apState.rowId;
  apState = null;
  if (apPositionFrame) { cancelAnimationFrame(apPositionFrame); apPositionFrame = 0; }
  const panel = apEl('peoplePicker');
  if (panel) panel.hidden = true;
  apExpanded(rowId, false);
  filterEditId = null;
  if (redraw) renderFilteredViews();
  if (restoreFocus) {
    const anchor = apFindAnchor(rowId);
    if (anchor) anchor.focus({ preventScroll: true });
  }
}
function initAssigneePicker() {
  if (apInitialized || !apEl('rowsL') || !apEl('peoplePicker')) return;
  apInitialized = true;
  const panel = apEl('peoplePicker'), search = apEl('peoplePickerSearch');
  apEl('rowsL').addEventListener('click', event => {
    const button = event.target.closest('[data-who-row]');
    if (!button || !hasUserDirectory()) return;
    event.preventDefault();
    const row = state.rows.find(value => String(value.id) === String(button.dataset.whoRow));
    if (!row) return;
    if (apState && String(apState.rowId) === String(row.id)) { closeAssigneePicker(true, true); return; }
    if (apState) closeAssigneePicker(false, false);
    apState = { rowId: row.id }; filterEditId = row.id;
    search.value = ''; apEl('peoplePickerStatus').textContent = ''; panel.hidden = false;
    refreshAssigneePicker();
    if (apState) search.focus({ preventScroll: true });
  });
  search.addEventListener('input', () => { const current = apFindRow(); if (current) { apRenderOptions(current.row); apPosition(); } });
  apEl('peoplePickerClose').addEventListener('click', () => closeAssigneePicker(true, true));
  // Erst nach dem Zielklick neu rendern, damit gepinnte Zeilen keine Klickziele entfernen.
  document.addEventListener('click', event => {
    if (!apState || panel.contains(event.target)) return;
    const anchor = apFindAnchor(apState.rowId);
    if (!anchor || !anchor.contains(event.target)) closeAssigneePicker(false, true);
  });
  document.addEventListener('focusin', event => {
    if (!apState || panel.contains(event.target)) return;
    const anchor = apFindAnchor(apState.rowId);
    if (!anchor || !anchor.contains(event.target)) closeAssigneePicker(false, !apEl('rowsL').contains(event.target));
  });
  document.addEventListener('keydown', event => {
    if (!apState || event.key !== 'Escape') return;
    event.preventDefault(); closeAssigneePicker(true, true);
  });
  window.addEventListener('resize', apSchedulePosition);
  document.addEventListener('scroll', apSchedulePosition, true);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', apSchedulePosition);
    window.visualViewport.addEventListener('scroll', apSchedulePosition);
  }
}
