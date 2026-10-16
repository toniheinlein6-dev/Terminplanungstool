// ===== UI =====
const LS_PLAN = 'gantt-plan-v1', LS_UI = 'gantt-ui-v1';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TYPES = { vorgang: 'Vorgang', untervorgang: 'Untervorgang', meilenstein: 'Meilenstein' };
const RELS = ['EA', 'AA', 'EE', 'AE'];
const RH = 34, HH = 72;
const PCTS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
// Eigene Farben für Vorgänge (Detailmaske); leer = Standardfarbe nach Typ
const ROW_COLORS = [['#3b78c4', 'Blau'], ['#2a9d8f', 'Türkis'], ['#4c9a52', 'Grün'], ['#8a9a2b', 'Oliv'], ['#d9a520', 'Gelb'], ['#e07b39', 'Orange'], ['#c8463d', 'Rot'], ['#c2508a', 'Pink'], ['#7d5bb5', 'Lila'], ['#7b8794', 'Grau']];
const okColor = c => /^#[0-9a-f]{6}$/.test(String(c || '').toLowerCase()) ? String(c).toLowerCase() : '';
const fillOf = r => r && r.color ? ' style="fill:' + r.color + '"' : '';
const ZOOMS = [0.4, 0.6, 0.8, 1, 1.3, 1.7, 2.2, 3, 4];   // Zeitachse: 40 % bis 400 %
const ZMAX = ZOOMS.length - 1;

function demoPlan() {
  const r = (id, type, name, who, pred, rel, lag, dur) => ({ id, type, name, who: who || '', pred: pred || '', rel: rel || 'EA', lag: lag == null ? '' : String(lag), fixed: '', dur: dur == null ? '' : String(dur), st: '', pct: 0, desc: '', color: '' });
  return {
    v: 1, example: true, name: 'Beispielprojekt', start: '2026-10-12', raster: 'weeks', mode: 'work', lines: true,
    people: ['Person A', 'Person B', 'Person C'], lanes: defaultLanes(),
    region: 'BW', holidays: [{ d: '2026-12-28', to: '2026-12-31', n: 'Betriebsurlaub' }],
    nextId: 14,
    rows: [
      r(1, 'vorgang', 'Planung'), r(2, 'untervorgang', 'Bestandsaufnahme', 'Person A', '', 'EA', '', 3),
      r(3, 'untervorgang', 'Konzept erstellen', 'Person B', 2, 'EA', '', 5), r(4, 'meilenstein', 'Konzept freigegeben', 'Person A', 3),
      r(5, 'vorgang', 'Umsetzung'), r(6, 'untervorgang', 'Arbeitspaket 1', 'Person B', 4, 'EA', '', 8),
      r(7, 'untervorgang', 'Arbeitspaket 2', 'Person C', 6, 'EA', '', 7), r(8, 'untervorgang', 'Abstimmung', 'Person A', 6, 'AA', 2, 3),
      r(9, 'meilenstein', 'Zwischenabnahme', 'Person A', 7), r(10, 'vorgang', 'Abschluss'),
      r(11, 'untervorgang', 'Dokumentation', 'Person C', 9, 'EA', '', 5), r(12, 'untervorgang', 'Übergabe', 'Person B', 11, 'EE', '', 2),
      r(13, 'meilenstein', 'Projektabschluss', 'Person A', 12)
    ],
    nextTaskId: 3,
    tasks: [
      { id: 1, title: 'Bestandspläne beim Bauamt anfragen', desc: '', who: 'Person A', due: '2026-10-16', prio: 'hoch', done: false, row: 2, by: '', created: '2026-10-12' },
      { id: 2, title: 'Termin für Konzeptbesprechung finden', desc: '', who: 'Person B, Person C', due: '', prio: 'normal', done: false, row: 3, by: '', created: '2026-10-12' }
    ],
    org: [
      { id: 1, kind: 'person', name: 'Person A', role: 'Projektleitung', uid: '', photo: '', pl: true, teams: [] },
      { id: 2, kind: 'team', name: 'Planung', role: 'Entwurf und Tragwerk', color: '#2f6fb2', parent: '' },
      { id: 3, kind: 'team', name: 'Ausführung', role: 'Arbeitsvorbereitung und Montage', color: '#b0612a', parent: '' },
      { id: 4, kind: 'person', name: 'Person B', role: 'Tragwerksplanung', uid: '', photo: '', pl: false, teams: [{ team: 2, lead: true, role: '' }, { team: 3, lead: false, role: 'Statische Beratung' }] },
      { id: 5, kind: 'person', name: 'Person C', role: 'Arbeitsvorbereitung', uid: '', photo: '', pl: false, teams: [{ team: 3, lead: true, role: '' }] }
    ]
  };
}
function defaultLanes() { return [{ id: '', name: 'Offen', c: 0, done: false }, { id: 'arbeit', name: 'In Arbeit', c: 1, done: false }, { id: 'fertig', name: 'Erledigt', c: 2, done: true }]; }
function cleanLanes(L) {
  if (!Array.isArray(L) || !L.length) return defaultLanes();
  const seen = new Set(), out = [];
  L.slice(0, 20).forEach(l => {
    if (!l || typeof l !== 'object') return;
    let id = String(l.id ?? ''); if (!/^[A-Za-z0-9_-]{0,40}$/.test(id) || seen.has(id)) id = 'l' + Math.random().toString(36).slice(2, 8);
    seen.add(id); out.push({ id, name: String(l.name || 'Bahn').slice(0, 60), c: Math.max(0, Math.min(6, parseInt(l.c, 10) || 0)), done: !!l.done });
  });
  return out.length ? out : defaultLanes();
}
function blankPlan(keep) {
  return { v: 1, name: keep ? keep.name : '', start: keep ? keep.start : toISO(mondayOf(todayDn())), raster: keep ? keep.raster : 'weeks', mode: keep ? keep.mode : 'work',
    lines: true, people: keep ? keep.people : [], holidays: keep ? keep.holidays : [], region: keep ? keep.region || '' : 'BW', lanes: keep && keep.lanes ? JSON.parse(JSON.stringify(keep.lanes)) : defaultLanes(), nextId: 1, rows: [], nextTaskId: 1, tasks: [], org: keep && Array.isArray(keep.org) ? JSON.parse(JSON.stringify(keep.org)) : [] };
}
function sanitize(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.rows)) return null;
  const s = blankPlan();
  s.name = String(p.name || ''); s.start = parseISO(p.start) != null ? p.start : s.start;
  s.raster = p.raster === 'days' ? 'days' : 'weeks'; s.mode = p.mode === 'cal' ? 'cal' : 'work'; s.lines = p.lines !== false;
  s.people = Array.isArray(p.people) ? p.people.map(String).filter(Boolean).slice(0, 200) : [];
  s.holidays = Array.isArray(p.holidays) ? p.holidays.filter(h => h && parseISO(h.d) != null).map(h => {
    const a = parseISO(h.d), b = parseISO(h.to);
    return Object.assign({ d: h.d, n: String(h.n || '') }, b != null && b > a && b - a <= 366 ? { to: h.to } : {});
  }).slice(0, 400) : [];
  s.region = regionName(p.region) ? p.region : '';
  s.lanes = cleanLanes(p.lanes);
  let max = 0; const seen = new Set();
  p.rows.slice(0, 500).forEach(r => {
    if (!r || typeof r !== 'object') return;
    let id = Number(r.id); if (!Number.isFinite(id) || id < 1 || seen.has(id)) id = ++max; seen.add(id); max = Math.max(max, id);
    s.rows.push({ id, type: TYPES[r.type] ? r.type : 'vorgang', name: String(r.name || ''), who: String(r.who || ''),
      pred: (r.pred === '' || r.pred == null || !Number.isFinite(Number(r.pred))) ? '' : Number(r.pred), rel: RELS.includes(r.rel) ? r.rel : 'EA',
      lag: r.lag === '' || r.lag == null ? '' : String(parseInt(r.lag, 10) || 0), fixed: parseISO(r.fixed) != null ? r.fixed : '',
      dur: r.dur === '' || r.dur == null ? '' : String(Math.max(0, parseInt(r.dur, 10) || 0)), st: typeof r.st === 'string' && /^[A-Za-z0-9_-]{0,40}$/.test(r.st) ? r.st : '',
      pct: Math.max(0, Math.min(100, Math.round((parseInt(r.pct, 10) || 0) / 10) * 10)), desc: String(r.desc || '').slice(0, 4000), color: okColor(r.color),
      ...(Array.isArray(r.assignees) ? { assignees: sanitizeAssignees(r.assignees) } : {}) });
    // Weitere Vorgänger (höchstens 20); nur vorhanden, wenn es mehr als einen gibt
    if (Array.isArray(r.deps) && r.deps.length) setRowLinks(s.rows[s.rows.length - 1], rowLinks(r).slice(0, 20));
  });
  s.nextId = max + 1;
  let tmax = 0; const tseen = new Set();
  (Array.isArray(p.tasks) ? p.tasks : []).slice(0, 1000).forEach(t => {
    if (!t || typeof t !== 'object') return;
    let id = Number(t.id); if (!Number.isInteger(id) || id < 1 || tseen.has(id)) id = tmax + 1; tseen.add(id); tmax = Math.max(tmax, id);
    const row = Number(t.row);
    s.tasks.push({ id, title: String(t.title || '').slice(0, 200), desc: String(t.desc || '').slice(0, 4000), who: String(t.who || ''),
      due: parseISO(t.due) != null ? t.due : '', prio: t.prio === 'hoch' || t.prio === 'niedrig' ? t.prio : 'normal', done: !!t.done,
      row: t.row !== '' && Number.isInteger(row) && row > 0 ? row : '', by: String(t.by || '').slice(0, 100), created: parseISO(t.created) != null ? t.created : '',
      ...(Array.isArray(t.assignees) ? { assignees: sanitizeAssignees(t.assignees) } : {}) });
  });
  s.nextTaskId = Math.max(tmax + 1, Number.isInteger(Number(p.nextTaskId)) ? Number(p.nextTaskId) : 1);
  // Organigramm: Teams (optional mit übergeordnetem Team) und Personen (Projektleitung, Mitgliedschaften in Teams)
  // Ältere Stände (Personen unter Personen, „parent“/„also“) werden in Team-Mitgliedschaften umgewandelt.
  const okPhoto = v => typeof v === 'string' && v.length <= 90000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : '';
  const str80 = v => String(v || '').slice(0, 80);
  const rawOrg = (Array.isArray(p.org) ? p.org : []).slice(0, 300).filter(n => n && typeof n === 'object');
  const kindOf = new Map(), parentOf = new Map();
  rawOrg.forEach(n => { const k = Number(n.id); if (!kindOf.has(k)) { kindOf.set(k, n.kind === 'team' ? 'team' : 'person'); parentOf.set(k, n.parent); } });
  const isTeam = v => v !== '' && v != null && kindOf.get(Number(v)) === 'team';
  const legacyTeam = (v, d) => v === '' || v == null || d > 50 ? null : isTeam(v) ? Number(v) : legacyTeam(parentOf.get(Number(v)), d + 1);
  let omax = 0; const oseen = new Set();
  rawOrg.forEach(n => {
    let id = Number(n.id); if (!Number.isInteger(id) || id < 1 || oseen.has(id)) id = omax + 1; oseen.add(id); omax = Math.max(omax, id);
    if (n.kind === 'team') {
      s.org.push({ id, kind: 'team', name: str80(n.name), role: str80(n.role), color: okColor(n.color), parent: isTeam(n.parent) && Number(n.parent) !== id ? Number(n.parent) : '' });
      return;
    }
    let teams;
    if (Array.isArray(n.teams)) teams = n.teams.map(t => ({ team: Number(t && t.team), lead: !!(t && t.lead), role: str80(t && t.role) }));
    else {
      teams = []; const lt = legacyTeam(n.parent, 0); if (lt) teams.push({ team: lt, lead: false, role: '' });
      (Array.isArray(n.also) ? n.also : []).forEach(a => { if (a && isTeam(a.team)) teams.push({ team: Number(a.team), lead: false, role: str80(a.role) }); });
    }
    teams = teams.filter((t, k, arr) => isTeam(t.team) && arr.findIndex(x => x.team === t.team) === k).slice(0, 20);
    const pl = 'pl' in n ? !!n.pl : (n.parent === '' || n.parent == null) && !teams.length;
    s.org.push({ id, kind: 'person', name: str80(n.name), role: str80(n.role), uid: /^[1-9]\d{0,9}$/.test(String(n.uid || '')) ? String(n.uid) : '', photo: okPhoto(n.photo), pl, teams });
  });
  if (p.example) s.example = true;
  return s;
}

let state = demoPlan();
let sched = null, sel = -1, zoom = 3, readOnly = false, filterEditId = null;
let hist = [], lastJson = JSON.stringify(state), lastPushT = 0;
let saving = false, pending = false, saveTimer = 0, edited = false;
let dl = null, uid = null, userNs = null, roomNs = null;
const base = new Map(), srv = new Map();

function icon(n) {
  const p = { up: 'M4 10l4-4 4 4', down: 'M4 6l4 4 4-4', sub: 'M4 3v6a2 2 0 0 0 2 2h6M9 8l3 3-3 3', del: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8', det: 'M3 3.5h10v7H7.5L4.5 13v-2.5H3z', drag: 'M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01', cols: 'M2.5 3.5h11v9h-11zM6.3 3.5v9M9.8 3.5v9', fold: 'M5 6.5l3 3 3-3', foldin: 'M4.5 2.5l3.5 3 3.5-3M4.5 13.5l3.5-3 3.5 3', foldout: 'M4.5 5.5l3.5-3 3.5 3M4.5 10.5l3.5 3 3.5-3' }[n];
  const sw = n === 'drag' ? '2.6' : '1.6';
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + p + '"/></svg>';
}

/* ---------- Tabelle links ---------- */
function rowHTML(r, i) {
  const opt = (v, t, cur) => '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>';
  return '<div class="grid row" data-i="' + i + '">' +
    '<div class="acts"><button class="ib grip" data-a="drag" type="button" title="Ziehen zum Verschieben (Tastatur: Pfeil hoch/runter)" aria-label="' + esc((r.name || 'Zeile') + ' verschieben') + '">' + icon('drag') + '</button>' +
    '<button class="ib" data-a="sub" title="Untervorgang darunter einfügen" aria-label="Untervorgang einfügen">' + icon('sub') + '</button></div>' +
    '<div class="num">' + r.id + '</div><div class="num" data-c="psp"></div>' +
    '<div><select data-f="type" aria-label="Typ">' + Object.keys(TYPES).map(k => opt(k, TYPES[k], r.type)).join('') + '</select></div>' +
    '<div class="nm"><button class="ib fold" data-a="fold" type="button" hidden aria-label="Untervorgänge ein- oder ausklappen">' + icon('fold') + '</button><input data-f="name" type="text" value="' + esc(r.name) + '" aria-label="Bezeichnung" autocomplete="off"><button class="ib det" data-a="det" type="button" title="Details, Beschreibung und Kommentare" aria-label="Details öffnen">' + icon('det') + '<span class="cnt" data-c="cnt"></span></button></div>' +
    '<div class="who-cell">' + assigneeCell(r, i) + '</div>' +
    '<div><select data-f="pct" aria-label="Fortschritt in Prozent">' + PCTS.map(p => '<option value="' + p + '"' + (p === (r.pct || 0) ? ' selected' : '') + '>' + p + ' %</option>').join('') + '</select></div>' +
    '<div class="predc"><select data-f="pred" aria-label="Vorgänger"></select><button type="button" class="predm" data-a="preds" hidden></button></div>' +
    '<div><select data-f="rel" aria-label="Beziehung">' + RELS.map(k => opt(k, k, r.rel)).join('') + '</select></div>' +
    '<div><input data-f="lag" type="number" step="1" value="' + esc(r.lag) + '" aria-label="Versatz in Tagen"></div>' +
    '<div><input data-f="fixed" type="date" value="' + esc(r.fixed) + '" aria-label="Fester Start"></div>' +
    '<div><input data-f="dur" type="number" min="0" step="1" value="' + esc(r.dur) + '" aria-label="Dauer" placeholder="1"></div>' +
    '<div class="calc" data-c="start"></div><div class="calc" data-c="end"></div></div>';
}
function predOptions(i) {
  const cur = state.rows[i].pred, dep = sched ? dependentsOf(state.rows, sched, i) : new Set([i]);
  let h = '<option value="">–</option>';
  state.rows.forEach((r, k) => { if (!dep.has(k) || String(cur) === String(r.id)) h += '<option value="' + r.id + '"' + (String(cur) === String(r.id) ? ' selected' : '') + '>' + r.id + ' · ' + esc(r.name || 'ohne Namen') + '</option>'; });
  return h;
}
// Eine gerade bearbeitete Zeile bleibt bis zum Verlassen der Tabelle sichtbar,
// auch wenn der neue Name oder die Zuordnung nicht mehr zum Filter passt.
function ganttRowIndices() {
  const indices = typeof foldFilter === 'function' ? foldFilter(visibleRowIndices()) : visibleRowIndices();
  const i = filterEditId == null ? -1 : state.rows.findIndex(r => r.id === filterEditId);
  if (i >= 0 && state.rows[i] && !indices.includes(i)) {
    indices.push(i);
    for (let p = sched.parent[i]; p >= 0 && !indices.includes(p); p = sched.parent[p]) indices.push(p);
    indices.sort((a, b) => a - b);
  }
  return indices;
}
function renderLeft(force = false, indices = ganttRowIndices()) {
  const box = $('rowsL');
  if (!indices.length) {
    box.innerHTML = state.rows.length ? '<div class="empty">Kein Vorgang passt zum Filter.</div>' : '<div class="empty"><b>Noch keine Vorgänge.</b><br>Lege oben mit „+ Vorgang“ los. Untervorgänge fügst du mit „+ Untervorgang“ oder dem Pfeil-Symbol in der Zeile ein.</div>';
    return;
  }
  const shown = [...box.querySelectorAll('.row')];
  if (!force && shown.length === indices.length && shown.every((el, k) => +el.dataset.i === indices[k])) return;
  const active = !force && box.contains(document.activeElement) ? document.activeElement : null;
  const focusRow = active ? rowIdx(active) : -1, field = active && active.dataset.f;
  let start = null, end = null;
  if (active) { try { start = active.selectionStart; end = active.selectionEnd; } catch (e) { } }
  box.innerHTML = indices.map(i => rowHTML(state.rows[i], i)).join('');
  box.querySelectorAll('.row').forEach(el => { el.querySelector('[data-f="pred"]').innerHTML = predOptions(+el.dataset.i); });
  const target = field && box.querySelector('.row[data-i="' + focusRow + '"] [data-f="' + field + '"]');
  if (target) { target.focus({ preventScroll: true }); if (start != null) { try { target.setSelectionRange(start, end); } catch (e) { } } }
}
function refreshPredOptions() {
  $('rowsL').querySelectorAll('.row').forEach(el => { const s = el.querySelector('[data-f="pred"]'); if (s) s.innerHTML = predOptions(+el.dataset.i); });
}
function updateComputed() {
  const rows = $('rowsL').querySelectorAll('.row');
  rows.forEach(el => {
    const i = +el.dataset.i, r = state.rows[i], o = sched.out[i];
    if (!r || !o) return;
    el.classList.toggle('sum', o.summary);
    el.classList.toggle('sub', r.type === 'untervorgang' && sched.parent[i] >= 0);
    el.classList.toggle('err', !!o.err);
    el.classList.toggle('sel', i === sel);
    const whoCell = el.querySelector('.who-cell');
    if (whoCell && hasUserDirectory()) { const html = assigneeCell(r, i); if (whoCell.innerHTML !== html) whoCell.innerHTML = html; }
    el.querySelectorAll('input, select').forEach(control => { control.disabled = readOnly; });
    el.querySelector('[data-c="psp"]').textContent = sched.psp[i];
    const st = el.querySelector('[data-c="start"]'), en = el.querySelector('[data-c="end"]'), act = document.activeElement;
    st.textContent = fmt(o.S); en.textContent = fmt(o.E);
    st.title = en.title = o.err ? 'Zirkelbezug: der Vorgänger hängt selbst von dieser Zeile ab' : '';
    // Werte aus dem Detailfenster übernehmen
    const di = el.querySelector('[data-f="dur"]'), fi = el.querySelector('[data-f="fixed"]');
    if (di !== act && di.value !== String(r.dur ?? '')) di.value = r.dur ?? '';
    if (fi !== act && fi.value !== String(r.fixed || '')) fi.value = r.fixed || '';
    const fb = el.querySelector('[data-a="fold"]');
    if (fb) { fb.hidden = !o.summary; if (o.summary) { const f = isFolded(r.id); fb.classList.toggle('closed', f); fb.setAttribute('aria-expanded', String(!f)); fb.title = (f ? 'Ausklappen: ' : 'Einklappen: ') + sched.kids[i].length + ' Untervorgänge'; } }
    ['pred', 'rel', 'lag', 'fixed', 'dur'].forEach(f => { const c = el.querySelector('[data-f="' + f + '"]'); c.disabled = readOnly || o.summary || (f === 'dur' && r.type === 'meilenstein'); });
    // Vorgänger: Werte aus dem Detailfenster übernehmen; bei mehreren Vorgängern Kurzform, bearbeitet wird im Detailfenster
    const links = rowLinks(r), multi = links.length > 1, pSel = el.querySelector('[data-f="pred"]'), pBtn = el.querySelector('.predm');
    const rSel = el.querySelector('[data-f="rel"]'), lIn = el.querySelector('[data-f="lag"]');
    if (pSel !== act && pSel.value !== String(r.pred ?? '')) { if (!pSel.querySelector('option[value="' + r.pred + '"]')) pSel.innerHTML = predOptions(i); pSel.value = String(r.pred ?? ''); }
    if (rSel !== act && rSel.value !== (r.rel || 'EA')) rSel.value = r.rel || 'EA';
    if (lIn !== act && lIn.value !== String(r.lag ?? '')) lIn.value = r.lag ?? '';
    pSel.hidden = multi; pBtn.hidden = !multi;
    if (multi) {
      pBtn.textContent = links.map(l => l.pred).join(', ');
      pBtn.title = 'Mehrere Vorgänger: ' + links.map(l => linkText(l)).join(', ') + '. Bearbeiten im Detailfenster.';
      rSel.disabled = lIn.disabled = true; rSel.title = lIn.title = 'Mehrere Vorgänger: im Detailfenster bearbeiten';
    } else rSel.title = lIn.title = '';
    el.querySelector('[data-a="sub"]').style.visibility = r.type === 'meilenstein' ? 'hidden' : '';
    const ps = el.querySelector('[data-f="pct"]');
    if (o.summary) { ps.innerHTML = '<option>' + progOf(i) + ' %</option>'; ps.disabled = true; }
    else if (ps.disabled || ps.options.length !== PCTS.length) { ps.innerHTML = PCTS.map(p => '<option value="' + p + '">' + p + ' %</option>').join(''); ps.disabled = false; ps.value = String(r.pct || 0); }
    else if (document.activeElement !== ps) ps.value = String(r.pct || 0);
    const pv = progOf(i), pc = ps.parentNode; pc.className = 'pcell' + (pv >= 100 ? ' full' : ''); pc.style.setProperty('--p', pv + '%');
    const n = commentCount(r.id), cn = el.querySelector('[data-c="cnt"]'), db = el.querySelector('[data-a="det"]');
    cn.textContent = n ? String(n) : ''; db.classList.toggle('has', !!(n || (r.desc || '').trim()));
    const un = isUnseen(r); el.classList.toggle('chg', un); db.title = un ? changeTitle(r) + ' – Details öffnen' : 'Details, Beschreibung und Kommentare';
  });
  paintProjectProgress();
}

/* ---------- Zeitachse rechts ---------- */
function renderChart(indices = ganttRowIndices()) {
  const positions = new Map(indices.map((i, k) => [i, k]));
  const N = indices.length, step = state.raster === 'weeks' ? 7 : 1;
  const colW = (step === 7 ? 38 : 26) * ZOOMS[zoom];
  const first = step === 7 ? mondayOf(sched.P) : sched.P;
  let maxE = sched.P; sched.out.forEach(o => { if (o.E > maxE) maxE = o.E; });
  const minCols = step === 7 ? 22 : 50;
  const nCols = Math.max(minCols, Math.ceil((maxE - first + 1) / step) + (step === 7 ? 4 : 12));
  const W = Math.ceil(nCols * colW), H = Math.max(N, 1) * RH;
  const X = d => (d - first) / step * colW;
  window.__chartDayW = colW / step;   // für das Ziehen der Balken
  const today = todayDn();
  const todayCol = Math.floor((today - first) / step);
  // Kopf
  let h = '<svg width="' + W + '" height="' + HH + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Zeitachse">';
  let c = 0;
  while (c < nCols) {
    const d0 = first + c * step, k = ymd(d0).y * 12 + ymd(d0).m; let e = c + 1;
    while (e < nCols) { const d = ymd(first + e * step); if (d.y * 12 + d.m !== k) break; e++; }
    const w = (e - c) * colW, t = ymd(d0);
    h += '<line class="h-line" x1="' + (c * colW) + '" x2="' + (c * colW) + '" y1="0" y2="20"/>';
    if (w >= 40) h += '<text class="hd strong" x="' + (c * colW + 6) + '" y="14">' + MON[t.m - 1] + ' ' + t.y + '</text>';
    else if (w >= 24) h += '<text class="hd strong" x="' + (c * colW + 4) + '" y="14">' + MON[t.m - 1] + '</text>';
    c = e;
  }
  h += '<line class="h-line" x1="0" x2="' + W + '" y1="20" y2="20"/>';
  if (step === 7) {
    for (let k = 0; k < nCols; k++) {
      const d = first + k * 7, x = k * colW;
      if (k === todayCol) h += '<rect class="g-todaybg" x="' + x + '" y="21" width="' + colW + '" height="' + (HH - 21) + '"/>';
      h += '<text class="hd' + (k === todayCol ? ' today' : '') + '" x="' + (x + colW / 2) + '" y="37" text-anchor="middle">' + isoWeek(d) + '</text>' +
        '<text class="hd' + (k === todayCol ? ' today' : '') + '" x="' + (x + colW / 2) + '" y="58" text-anchor="middle">' + fmtShort(d).slice(0, 5) + '</text>';
    }
  } else {
    let k = 0;
    while (k < nCols) {
      const d0 = first + k; let e = k + 1; while (e < nCols && isoWd(first + e) !== 1) e++;
      const w = (e - k) * colW;
      h += '<line class="h-line" x1="' + (k * colW) + '" x2="' + (k * colW) + '" y1="20" y2="40"/>';
      if (w >= 44) h += '<text class="hd" x="' + (k * colW + 5) + '" y="34">KW ' + isoWeek(d0) + '</text>';
      k = e;
    }
    h += '<line class="h-line" x1="0" x2="' + W + '" y1="40" y2="40"/>';
    for (let k2 = 0; k2 < nCols; k2++) {
      const d = first + k2, x = k2 * colW, wd = isoWd(d);
      if (k2 === todayCol) h += '<rect class="g-todaybg" x="' + x + '" y="41" width="' + colW + '" height="' + (HH - 41) + '"/>';
      else if (wd > 5 || sched.hol.has(d)) h += '<rect class="' + (sched.hol.has(d) && wd <= 5 ? 'g-holiday' : 'g-weekend') + '" x="' + x + '" y="41" width="' + colW + '" height="' + (HH - 41) + '">' + (sched.hol.has(d) ? '<title>' + esc(fmt(d) + ': ' + sched.holName.get(d)) + '</title>' : '') + '</rect>';
      const cl = 'hd' + (k2 === todayCol ? ' today' : '');
      h += '<text class="' + cl + '" x="' + (x + colW / 2) + '" y="55" text-anchor="middle">' + ymd(d).d + '</text>' +
        '<text class="' + cl + '" x="' + (x + colW / 2) + '" y="67" text-anchor="middle">' + 'MDMDFSS'[wd - 1] + '</text>';
    }
  }
  h += '</svg>';
  $('hdrR').innerHTML = h;
  // Körper
  if (!N) { $('chart').innerHTML = '<div class="empty">' + (state.rows.length ? 'Kein Vorgang passt zum Filter.' : 'Sobald Vorgänge vorhanden sind, erscheint hier das Gantt-Diagramm.') + '</div>'; return; }
  let s = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';
  if (step === 1) for (let k = 0; k < nCols; k++) {
    const d = first + k, wd = isoWd(d), hl = sched.hol.has(d);
    if (k === todayCol) s += '<rect class="g-todaybg" x="' + (k * colW) + '" y="0" width="' + colW + '" height="' + H + '"/>';
    else if (hl && wd <= 5) s += '<rect class="g-holiday" x="' + (k * colW) + '" y="0" width="' + colW + '" height="' + H + '"/>';
    else if (wd > 5) s += '<rect class="g-weekend" x="' + (k * colW) + '" y="0" width="' + colW + '" height="' + H + '"/>';
  } else if (todayCol >= 0 && todayCol < nCols) s += '<rect class="g-todaybg" x="' + (todayCol * colW) + '" y="0" width="' + colW + '" height="' + H + '"/>';
  if (positions.has(sel)) s += '<rect class="g-sel" x="0" y="' + (positions.get(sel) * RH) + '" width="' + W + '" height="' + RH + '"/>';
  for (let k = 0; k <= nCols; k++) s += '<line class="' + (step === 1 && isoWd(first + k) !== 1 ? 'g-v' : 'g-vw') + '" x1="' + (k * colW) + '" x2="' + (k * colW) + '" y1="0" y2="' + H + '"/>';
  for (let i = 1; i <= N; i++) s += '<line class="g-h" x1="0" x2="' + W + '" y1="' + (i * RH) + '" y2="' + (i * RH) + '"/>';
  if (todayCol >= 0 && todayCol < nCols) { const tx = X(today) + (step === 7 ? colW / 14 : colW / 2); s += '<line class="g-today" x1="' + tx + '" x2="' + tx + '" y1="0" y2="' + H + '"/>'; }
  const cy = i => positions.get(i) * RH + RH / 2;
  const isMs = i => state.rows[i].type === 'meilenstein';
  const msX = i => X(sched.out[i].S + 0.5);
  const ax = (i, end) => isMs(i) ? msX(i) + (end ? 8 : -8) : (end ? X(sched.out[i].E + 1) : X(sched.out[i].S));
  if (state.lines) {
    let ls = '';
    sched.out.forEach((o, i) => (o.preds || []).forEach(({ i: p, rel }) => {
      if (o.err || !positions.has(i) || !positions.has(p)) return;
      const x1 = ax(p, !(rel === 'AA' || rel === 'AE')), y1 = cy(p);
      const e = (rel === 'EE' || rel === 'AE') ? -1 : 1, x2 = ax(i, e === -1), y2 = cy(i);
      const g = 10, d1 = (rel === 'AA' || rel === 'AE') ? -1 : 1, vx = x1 + d1 * g, apx = x2 - e * g, dir = y2 >= y1 ? 1 : -1;
      const ok = e === 1 ? vx <= x2 - 3 : vx >= x2 + 3;
      const pts = ok ? [[x1, y1], [vx, y1], [vx, y2], [x2 - e, y2]] : [[x1, y1], [vx, y1], [vx, y1 + dir * RH / 2], [apx, y1 + dir * RH / 2], [apx, y2], [x2 - e, y2]];
      const on = (i === sel || p === sel) ? ' on' : '';
      ls += '<path class="link' + on + '" d="M' + pts.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L') + '"/>' +
        '<polygon class="arrow' + on + '" points="' + x2.toFixed(1) + ',' + y2 + ' ' + (x2 - e * 6).toFixed(1) + ',' + (y2 - 3.6) + ' ' + (x2 - e * 6).toFixed(1) + ',' + (y2 + 3.6) + '"/>';
    }));
    s += ls;
  }
  s += '<g class="bars">';
  indices.forEach(i => {
    const r = state.rows[i], o = sched.out[i], y = cy(i);
    const who = assigneeNames(r);
    const tip = '<title>' + esc((r.name || 'ohne Namen') + ': ' + fmt(o.S) + (o.E !== o.S ? ' bis ' + fmt(o.E) : '') + (r.type === 'meilenstein' ? '' : ' (' + (o.summary ? (o.E - o.S + 1) + ' Kalendertage' : o.dur + (sched.work ? ' Arbeitstage' : ' Tage')) + ')') + (who ? ' · ' + who : '') + (o.err ? ' · Zirkelbezug' : '') + (o.pred >= 0 && !positions.has(o.pred) ? ' · Vorgänger ausgeblendet' : '')) + '</title>';
    if (r.type === 'meilenstein') {
      const cx = msX(i);
      s += '<g data-i="' + i + '"' + (readOnly ? '' : ' class="mv"') + '>' + tip + '<polygon class="bar-ms"' + fillOf(r) + ' points="' + cx + ',' + (y - 8) + ' ' + (cx + 8) + ',' + y + ' ' + cx + ',' + (y + 8) + ' ' + (cx - 8) + ',' + y + '"/>' +
        '<text class="lbl ms" x="' + (cx + 14) + '" y="' + (y + 4) + '">' + esc(r.name) + '</text></g>';
      return;
    }
    const x = X(o.S), w = Math.max((o.E - o.S + 1) / step * colW, 4);
    if (o.summary) {
      s += '<g data-i="' + i + '">' + tip + '<rect class="bar-sum"' + fillOf(r) + ' x="' + x + '" y="' + (y - 7) + '" width="' + w + '" height="8" rx="1.5"/>' +
        (progOf(i) > 0 ? '<rect class="bar-sumprog" x="' + x + '" y="' + (y - 5) + '" width="' + (w * progOf(i) / 100).toFixed(1) + '" height="4" rx="1"/>' : '') +
        '<polygon class="bar-sum"' + fillOf(r) + ' points="' + x + ',' + (y + 1) + ' ' + (x + 8) + ',' + (y + 1) + ' ' + x + ',' + (y + 8) + '"/>' +
        '<polygon class="bar-sum"' + fillOf(r) + ' points="' + (x + w) + ',' + (y + 1) + ' ' + (x + w - 8) + ',' + (y + 1) + ' ' + (x + w) + ',' + (y + 8) + '"/>' +
        '<text class="lbl" x="' + (x + w + 14) + '" y="' + (y + 4) + '">' + esc(r.name) + (progOf(i) ? ' · ' + progOf(i) + ' %' : '') + '</text></g>';
    } else {
      const sub = r.type === 'untervorgang' && sched.parent[i] >= 0;
      const pg = progOf(i), lab = [assigneeShortText(r), pg ? pg + ' %' : ''].filter(Boolean).join(' · ');
      s += '<g data-i="' + i + '" class="' + (rowDone(r) ? 'done' : '') + (readOnly ? '' : ' mv') + '">' + tip + '<rect class="' + (sub ? 'bar-sub' : 'bar-task') + '"' + fillOf(r) + ' x="' + x + '" y="' + (y - 8) + '" width="' + w + '" height="16" rx="3"/>' +
        (pg > 0 && pg < 100 ? '<rect class="bar-prog" x="' + x + '" y="' + (y - 8) + '" width="' + (w * pg / 100).toFixed(1) + '" height="16" rx="3"/>' : pg >= 100 ? '<rect class="bar-prog" x="' + x + '" y="' + (y - 8) + '" width="' + w + '" height="16" rx="3"/>' : '') +
        (o.err ? '<rect class="bar-err" x="' + x + '" y="' + (y - 8) + '" width="' + w + '" height="16" rx="3"/>' : '') +
        (lab ? '<text class="lbl" x="' + (x + w + 14) + '" y="' + (y + 4) + '">' + esc(lab) + '</text>' : '') + '</g>';
    }
  });
  s += '</g>';
  s += '</svg>';
  $('chart').innerHTML = s;
}

/* ---------- Zusammenspiel ---------- */
function renderFilteredViews(force = false) {
  renderView();
  const indices = ganttRowIndices();
  renderLeft(force, indices); updateComputed(); renderChart(indices); syncHeaderScroll();
  if (typeof paintFoldAll === 'function') paintFoldAll();
  refreshAssigneePicker();
}
function refresh() { sched = schedule(state); renderFilteredViews(); }
function paintZoom() {
  const l = $('zoomLbl'); if (l) l.textContent = Math.round(ZOOMS[zoom] * 100) + ' %';
  $('zoomIn').disabled = zoom >= ZMAX; $('zoomOut').disabled = zoom <= 0;
}
// Vorschläge für „Verantwortlich“: Liste des Projekts plus die Namen der Teammitglieder (Webversion)
function refreshPeopleList() {
  const extra = typeof window.TP_TEAM_NAMES === 'function' ? window.TP_TEAM_NAMES() : [];
  $('peopleList').innerHTML = [...new Set(state.people.concat(extra))].map(p => '<option value="' + esc(p) + '">').join('');
}
function renderAll() {
  $('pname').value = state.name; $('pstart').value = state.start; refreshSelect();
  $('segRaster').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === state.raster)));
  $('segMode').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === state.mode)));
  $('lines').checked = !!state.lines;
  $('banner').hidden = !state.example;
  refreshPeopleList();
  if (typeof applyCols === 'function') applyCols(true);
  sched = schedule(state); renderFilteredViews(true);
}
function changed(force) {
  if (state.example) { delete state.example; $('banner').hidden = true; }
  const j = JSON.stringify(state); if (j === lastJson) return;
  const now = Date.now();
  if (force || now - lastPushT > 900) { hist.push(lastJson); if (hist.length > 60) hist.shift(); lastPushT = now; }
  lastJson = j; edited = true; $('undo').disabled = !hist.length; scheduleSave();
}
function structural(focusSel) {
  sched = schedule(state); renderFilteredViews(true); changed(true);
  if (focusSel) { const el = $('rowsL').querySelector(focusSel); if (el) el.focus(); }
}
function undo() {
  if (!hist.length) return;
  closeAssigneePicker(false, false);
  const j = hist.pop(); state = JSON.parse(j); lastJson = j; lastPushT = 0; sel = -1; filterEditId = null; edited = true;
  $('undo').disabled = !hist.length; renderAll(); scheduleSave();
}
function rowIdx(el) { const r = el.closest('.row'); return r ? +r.dataset.i : -1; }
function select(i) {
  if (i === sel) return; sel = i;
  $('rowsL').querySelectorAll('.row').forEach(el => el.classList.toggle('sel', +el.dataset.i === sel));
  if (sched) renderChart();
}

function onInput(e) {
  if (readOnly) return;
  const t = e.target, f = t.dataset.f; if (!f) return;
  const i = rowIdx(t), r = state.rows[i]; if (!r) return;
  filterEditId = r.id;
  if (f === 'type') { r.type = t.value; changedFirst(); structural('.row[data-i="' + i + '"] [data-f="type"]'); return; }
  if (f === 'pred') r.pred = t.value === '' ? '' : Number(t.value);
  else if (f === 'lag') r.lag = t.value === '' ? '' : String(parseInt(t.value, 10) || 0);
  else if (f === 'dur') r.dur = t.value === '' ? '' : String(Math.max(0, parseInt(t.value, 10) || 0));
  else if (f === 'pct') setPct(r, t.value);
  else { r[f] = t.value; if (f === 'who') delete r.assignees; }
  refresh(); changed(false);
}
function changedFirst() { lastPushT = 0; }
function addRow(type, at) {
  if (readOnly) return;
  resetViewFilters();
  const r = { id: state.nextId++, type, name: '', who: '', pred: '', rel: 'EA', lag: '', fixed: '', dur: '', st: '', pct: 0, desc: '', color: '' };
  let idx = at;
  if (idx == null) {
    idx = state.rows.length;
    if (type === 'untervorgang') { let v = -1; state.rows.forEach((x, k) => { if (x.type === 'vorgang') v = k; }); if (v >= 0) { idx = v + 1; while (idx < state.rows.length && state.rows[idx].type === 'untervorgang') idx++; } }
  }
  state.rows.splice(idx, 0, r);
  sched = schedule(state); if (typeof unfoldFor === 'function') unfoldFor(idx);   // neuer Untervorgang in eingeklappter Gruppe
  structural('.row[data-i="' + idx + '"] [data-f="name"]');
  const el = $('rowsL').querySelector('.row[data-i="' + idx + '"]'); if (el) el.scrollIntoView({ block: 'nearest' });
  select(idx);
  // Gleich die Detailmaske für Bezeichnung, Termine, Verantwortliche und Beschreibung öffnen
  if (typeof openDetails === 'function') openDetails(idx);
}
function groupEnd(i) { let e = i; if (state.rows[i].type === 'vorgang') while (e + 1 < state.rows.length && state.rows[e + 1].type === 'untervorgang') e++; return e; }
function groupStart(i) { if (state.rows[i].type === 'untervorgang') { let k = i; while (k > 0 && state.rows[k].type === 'untervorgang') k--; return state.rows[k].type === 'vorgang' ? k : i; } return i; }
function moveRow(i, dirn) {
  const rows = state.rows; let a = i, b = i;
  if (rows[i].type !== 'untervorgang') b = groupEnd(i);
  let ns;
  if (dirn < 0) { if (a === 0) return; ns = rows[a - 1].type === 'untervorgang' && rows[i].type !== 'untervorgang' ? groupStart(a - 1) : a - 1; }
  else { if (b + 1 >= rows.length) return; const nb = rows[i].type === 'untervorgang' ? b + 1 : groupEnd(b + 1); ns = a + (nb - b); }
  const blk = rows.splice(a, b - a + 1); rows.splice(ns, 0, ...blk);
  sel = ns; structural('.row[data-i="' + ns + '"] [data-a="drag"]');
}
/* ---------- Ziehen und Ablegen: Vorgänge samt Untervorgängen, Untervorgänge, Meilensteine ---------- */
// Ein Vorgang wandert mit seinen Untervorgängen; Vorgänge und Meilensteine landen nie mitten in einer Gruppe.
// Ein Untervorgang gehört nach dem Ablegen zum Vorgang darüber.
function dropTarget(a, b, gap) {
  const rows = state.rows, isSub = rows[a].type === 'untervorgang';
  if (gap > a && gap <= b + 1) return null;                         // innerhalb des eigenen Blocks
  if (!isSub) {
    // Lücke vor einem Untervorgang einer Gruppe: hinter das Gruppenende schieben
    while (gap < rows.length && rows[gap].type === 'untervorgang' && gap > 0 && (rows[gap - 1].type === 'vorgang' || rows[gap - 1].type === 'untervorgang')) gap++;
    if (gap > a && gap <= b + 1) return null;
  }
  const to = gap > b ? gap - (b - a + 1) : gap;
  return to === a ? null : { gap, to };
}
function moveBlockTo(a, b, to) {
  const blk = state.rows.splice(a, b - a + 1); state.rows.splice(to, 0, ...blk);
  sel = to; structural('.row[data-i="' + to + '"] [data-a="drag"]');
}
function initDrag() {
  const box = $('rowsL'), scroller = $('bodyL'); let d = null, raf = 0;
  const line = document.createElement('div'); line.className = 'dropline'; line.hidden = true;
  const cleanup = () => {
    if (!d) return; cancelAnimationFrame(raf);
    box.querySelectorAll('.row.dragging').forEach(el => el.classList.remove('dragging'));
    document.body.classList.remove('dragmode'); line.hidden = true; d = null;
  };
  const gapAt = y => {
    const els = [...box.querySelectorAll('.row')];
    for (const el of els) { const rc = el.getBoundingClientRect(); if (y < rc.top + rc.height / 2) return { gap: +el.dataset.i, el, before: true }; }
    const last = els[els.length - 1]; return last ? { gap: +last.dataset.i + 1, el: last, before: false } : null;
  };
  const paint = () => {
    if (!d) return;
    const g = gapAt(d.y), t = g && dropTarget(d.a, d.b, g.gap); d.t = t;
    if (!t) { line.hidden = true; }
    else {
      const ref = box.querySelector('.row[data-i="' + t.gap + '"]') || box.querySelector('.row[data-i="' + (t.gap - 1) + '"]');
      const top = ref.offsetTop + (ref.dataset.i == t.gap ? 0 : ref.offsetHeight);
      if (!line.parentNode) box.appendChild(line);
      line.style.top = (top - 1) + 'px'; line.hidden = false;
      line.classList.toggle('sub', state.rows[d.a].type === 'untervorgang');
    }
    // Am Rand automatisch scrollen
    const rc = scroller.getBoundingClientRect(), edge = 40;
    if (d.y < rc.top + edge) scroller.scrollTop -= Math.ceil((rc.top + edge - d.y) / 4);
    else if (d.y > rc.bottom - edge) scroller.scrollTop += Math.ceil((d.y - rc.bottom + edge) / 4);
    raf = requestAnimationFrame(paint);
  };
  box.addEventListener('pointerdown', e => {
    const h = e.target.closest('[data-a="drag"]'); if (!h || readOnly || e.button > 0) return;
    const i = rowIdx(h); if (i < 0) return;
    if (visibleRowIndices().length !== state.rows.length) { toast('Zum Verschieben zuerst die Filter zurücksetzen.'); return; }
    e.preventDefault();
    d = { a: i, b: state.rows[i].type === 'vorgang' ? groupEnd(i) : i, y: e.clientY, y0: e.clientY, pid: e.pointerId, t: null, started: false };
    try { h.setPointerCapture(e.pointerId); } catch (x) { }
  });
  box.addEventListener('pointermove', e => {
    if (!d || e.pointerId !== d.pid) return;
    d.y = e.clientY;
    if (!d.started && Math.abs(d.y - d.y0) > 4) {
      d.started = true; document.body.classList.add('dragmode'); select(d.a);
      for (let k = d.a; k <= d.b; k++) { const el = box.querySelector('.row[data-i="' + k + '"]'); if (el) el.classList.add('dragging'); }
      raf = requestAnimationFrame(paint);
    }
  });
  const end = e => {
    if (!d || e.pointerId !== d.pid) return;
    const go = d.started && d.t && e.type === 'pointerup' ? { a: d.a, b: d.b, to: d.t.to } : null;
    cleanup();
    if (go) moveBlockTo(go.a, go.b, go.to);
  };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && d) cleanup(); });
  // Tastatur: Griff fokussieren, Pfeil hoch/runter
  box.addEventListener('keydown', e => {
    const h = e.target.closest && e.target.closest('[data-a="drag"]'); if (!h || readOnly) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); moveRow(rowIdx(h), e.key === 'ArrowUp' ? -1 : 1); }
  });
}
function deleteRow(i) {
  const r = state.rows[i]; let promoted = 0;
  if (r.type === 'vorgang') { let k = i + 1; while (k < state.rows.length && state.rows[k].type === 'untervorgang') { state.rows[k].type = 'vorgang'; promoted++; k++; } }
  state.rows.splice(i, 1);
  state.rows.forEach(x => { const L = rowLinks(x); if (L.some(l => l.pred === r.id)) setRowLinks(x, L.filter(l => l.pred !== r.id)); });
  sel = -1; structural();
  toast('Zeile gelöscht' + (promoted ? ', ihre Untervorgänge sind jetzt Vorgänge' : ''), 'Rückgängig', undo);
}
function onClick(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const i = rowIdx(b), a = b.dataset.a;
  if (a === 'fold') { toggleFold(i); return; }
  if (a === 'sub') addRow('untervorgang', state.rows[i].type === 'vorgang' ? groupEnd(i) + 1 : i + 1);
  else if (a === 'det' || a === 'preds') openDetails(i);
}

/* ---------- Meldungen ---------- */
window.__cur = () => curId;
let toastT = 0;
function toast(txt, btn, fn) {
  $('toastTxt').textContent = txt; const b = $('toastBtn');
  b.hidden = !btn; b.textContent = btn || ''; b.onclick = () => { $('toast').hidden = true; if (fn) fn(); };
  $('toast').hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { $('toast').hidden = true; }, 7000);
}
function setStatus(k, t) { const s = $('status'); s.dataset.k = k; $('statusTxt').textContent = t; }

/* ---------- Projekte und Speichern ---------- */
let curId = 'main', proj = new Map(), dbc = null;
const LS_IDX = 'gantt-index-v2';
const lsKey = id => LS_PLAN + ':' + id;
const nameOf = j => { try { return String(JSON.parse(j).name || '').trim() || 'Ohne Namen'; } catch (e) { return 'Ohne Namen'; } };
function localAll() {
  if (window.NO_LOCAL) return [];
  try { const idx = JSON.parse(localStorage.getItem(LS_IDX) || '[]'); return idx.map(id => { const j = localStorage.getItem(lsKey(id)); return j ? { id, json: j } : null; }).filter(Boolean); } catch (e) { return []; }
}
function localPut(id, json) {
  if (window.NO_LOCAL) return;
  try { localStorage.setItem(lsKey(id), json); const idx = JSON.parse(localStorage.getItem(LS_IDX) || '[]'); if (!idx.includes(id)) { idx.push(id); localStorage.setItem(LS_IDX, JSON.stringify(idx)); } } catch (e) { }
}
function localDel(id) {
  try { localStorage.removeItem(lsKey(id)); localStorage.setItem(LS_IDX, JSON.stringify(JSON.parse(localStorage.getItem(LS_IDX) || '[]').filter(x => x !== id))); } catch (e) { }
}
function newId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function refreshSelect() {
  const cur = proj.get(curId) || {}; cur.name = (state.name || '').trim() || 'Ohne Namen'; proj.set(curId, cur);
  const items = [...proj.entries()].sort((x, y) => x[1].name.localeCompare(y[1].name, 'de'));
  $('projSel').innerHTML = items.map(([id, e]) => '<option value="' + esc(id) + '"' + (id === curId ? ' selected' : '') + '>' + esc(e.name) + '</option>').join('');
  $('delProj').disabled = false;
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 800); }
async function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; await persist(); }
  let g = 0; while (saving && g++ < 100) await new Promise(r => setTimeout(r, 50));
}
async function persist() {
  saveTimer = 0;
  const json = JSON.stringify(state), id = curId;
  const e = proj.get(id) || {}; e.name = (state.name || '').trim() || 'Ohne Namen'; e.json = json; proj.set(id, e);
  localPut(id, json); refreshSelect();
  if (!dbc || readOnly) { setStatus('local', readOnly ? (window.NO_LOCAL ? 'Nur lesbar (keine Schreibrechte)' : 'Nur lesbar, Änderungen bleiben in diesem Browser') : 'Nur in diesem Browser gespeichert'); return; }
  if (saving) { pending = true; return; }
  saving = true; setStatus('saving', 'Speichert …');
  const prev = base.get(id);
  try { const at = new Date().toISOString(); base.set(id, norm(json)); srv.set(id, { by: uid, savedAt: at }); await dbc.doc(id).set({ json, savedAt: at, by: uid }); setStatus('saved', 'Gespeichert'); showLast(); }
  catch (err) {
    base.set(id, prev);
    if (err && err.code === 'conflict' && err.doc) { setStatus('saving', 'Gleicht ab …'); try { onRemote({ type: 'modified', doc: { id, data: () => err.doc } }); } catch (x) { } }
    else if (err && (err.code === 'invalid_argument' || err.code === 'forbidden')) { lockReadOnly(true); }
    else if (err && err.code === 'auth') setStatus('error', 'Bitte neu anmelden');
    else { setStatus('error', 'Speichern fehlgeschlagen, neuer Versuch folgt'); setTimeout(scheduleSave, 8000); }
  }
  saving = false; if (pending) { pending = false; persist(); }
}
function applyProject(id, p) {
  closeAssigneePicker(false, false);
  curId = id; state = p; lastJson = JSON.stringify(state); hist = []; lastPushT = 0; sel = -1; filterEditId = null; $('undo').disabled = true;
  resetViewFilters();
  saveUi({ active: id }); renderAll();
}
async function switchTo(id) {
  if (id === curId) return; await flush();
  const e = proj.get(id); let p = null;
  try { p = sanitize(JSON.parse(e.json)); } catch (x) { }
  if (!p) { toast('Das Projekt konnte nicht geladen werden'); refreshSelect(); return; }
  applyProject(id, p);
}
async function addProject(p, msg) {
  await flush(); delete p.example; applyProject(newId(), p); edited = true; await persist();
  if (msg) toast(msg);
}
function newProject() { const p = blankPlan(state); p.name = 'Neues Projekt'; p.start = toISO(mondayOf(todayDn())); return addProject(p).then(() => { $('pname').focus(); $('pname').select(); }); }
function duplicateProject() { const p = JSON.parse(JSON.stringify(state)); p.name = ((state.name || '').trim() || 'Projekt') + ' (Kopie)'; return addProject(p, 'Projekt dupliziert'); }
async function deleteProject() {
  const id = curId, e = { name: state.name, json: JSON.stringify(state) };
  await flush(); proj.delete(id); localDel(id); curId = null;
  if (dbc && !readOnly) { try { await dbc.doc(id).delete(); } catch (x) { } }
  const rest = [...proj.entries()].sort((x, y) => x[1].name.localeCompare(y[1].name, 'de'));
  if (rest.length) await switchTo(rest[0][0]); else { const p = blankPlan(); applyProject(newId(), p); }
  closePanel();
  toast('Projekt „' + (e.name || 'Ohne Namen') + '“ gelöscht', 'Rückgängig', async () => {
    proj.set(id, { name: nameOf(e.json), json: e.json }); localPut(id, e.json);
    if (dbc && !readOnly) { try { base.set(id, e.json); await dbc.doc(id).set({ json: e.json, savedAt: new Date().toISOString(), by: uid }); } catch (x) { } }
    await switchTo(id);
  });
}
async function initStore() {
  // Älteren Einzelplan übernehmen
  try { const old = localStorage.getItem(LS_PLAN); if (old && !localStorage.getItem(LS_IDX)) { localPut('main', old); localStorage.removeItem(LS_PLAN); } } catch (e) { }
  localAll().forEach(x => proj.set(x.id, { name: nameOf(x.json), json: x.json }));
  let want = null; try { want = (JSON.parse(localStorage.getItem(LS_UI) || '{}')).active || null; } catch (e) { }
  const pick = () => (want && proj.has(want)) ? want : ([...proj.keys()][0] || null);
  let id = pick();
  if (id) { try { const p = sanitize(JSON.parse(proj.get(id).json)); if (p) { curId = id; state = p; lastJson = JSON.stringify(state); } } catch (e) { } }
  renderAll(); setStatus('local', 'Nur in diesem Browser gespeichert');
  if (window.SP && window.SP.connect) {
    let col = null; try { col = await window.SP.connect(window.TEAMS_CFG || {}, (k, t) => setStatus(k, t)); } catch (e) { setStatus('error', 'Anmeldung fehlgeschlagen: ' + ((e && e.message) || e)); showLogin(); return; }
    uid = col.uid; prefsForUser(); if (col.readOnly) lockReadOnly(false); attach(col, pick, null); return;
  }
  let cl = null; try { cl = window.claude && window.claude.use ? window.claude : null; } catch (e) { }
  if (!cl) return;
  try { dl = await cl.use('downloads'); } catch (e) { dl = null; }
  let db = null; try { db = await cl.use('db'); } catch (e) { db = null; }
  if (!db) return;
  try { userNs = await cl.use('user'); if (userNs) uid = await userNs.id(); } catch (e) { userNs = null; }
  prefsForUser();
  try { await teamInit(); } catch (e) { }
  try { attach(db.collection('plans'), pick, cl); } catch (e) { dbc = null; setStatus('local', 'Nur in diesem Browser gespeichert'); }
}
function showLogin() {
  const b = $('banner'); b.hidden = false; b.innerHTML = 'Anmeldung bei Microsoft 365 nötig. <button class="btn" id="loginBtn" type="button">Anmelden</button>';
  $('loginBtn').onclick = () => { b.hidden = true; initStore(); };
}
function attach(col, pick, cl) {
  dbc = col; let first = true;
  col.onSnapshot(snap => {
    if (first) {
      first = false;
      snap.docs.forEach(d => { const dd = d.data(); if (dd && typeof dd.json === 'string') { proj.set(d.id, { name: nameOf(dd.json), json: dd.json }); base.set(d.id, norm(dd.json)); srv.set(d.id, { by: dd.by, savedAt: dd.savedAt, byName: dd.byName }); } });
      if (!edited && snap.docs.length) {
        for (const [id, entry] of proj) if (typeof entry.json !== 'string') proj.delete(id);
        const id = pick(), entry = id && proj.get(id);
        const p = entry && typeof entry.json === 'string' ? sanitize(JSON.parse(entry.json)) : null;
        if (p) applyProject(id, p);
      }
      refreshSelect(); showLast();
      setStatus(snap.docs.length ? 'saved' : 'local', snap.docs.length ? 'Gespeichert' : 'Noch nicht gespeichert, wird mit der ersten Änderung angelegt');
      if (cl) startRoom(cl); return;
    }
    snap.docChanges().forEach(ch => { try { onRemote(ch); } catch (x) { } });
  }, () => { setStatus('error', 'Live-Verbindung getrennt'); });
}

/* ---------- Teamarbeit ---------- */
const norm = j => { try { return JSON.stringify(sanitize(JSON.parse(j))); } catch (e) { return j; } };
const rowsById = r => { const m = new Map(); (r || []).forEach(x => m.set(x.id, x)); return m; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Dreiwege-Zusammenführung: base = zuletzt gemeinsamer Stand, mine = meine Änderungen, theirs = Stand der Kollegen
function mergePlans(b, m, t) {
  const out = JSON.parse(JSON.stringify(t));
  ['name', 'start', 'raster', 'mode', 'lines', 'people', 'holidays', 'region', 'lanes'].forEach(k => { if (!same(m[k], b[k])) out[k] = JSON.parse(JSON.stringify(m[k])); });
  const B = rowsById(b.rows), M = rowsById(m.rows), T = rowsById(t.rows);
  const ids = new Set([...M.keys(), ...T.keys()]); const res = new Map();
  ids.forEach(id => {
    const inB = B.has(id), inM = M.has(id), inT = T.has(id);
    if (inM && inT) res.set(id, !inB ? M.get(id) : same(M.get(id), B.get(id)) ? T.get(id) : same(T.get(id), B.get(id)) ? M.get(id) : mergeRow(B.get(id), M.get(id), T.get(id)));
    else if (inM && !inT) { if (!inB) res.set(id, M.get(id)); else if (!same(M.get(id), B.get(id))) res.set(id, M.get(id)); /* sonst von Kollegen gelöscht */ }
    else if (!inM && inT) { if (!inB) res.set(id, T.get(id)); else if (!same(T.get(id), B.get(id))) res.set(id, T.get(id)); /* sonst von mir gelöscht */ }
  });
  const bIds = (b.rows || []).map(r => r.id), mIds = (m.rows || []).map(r => r.id);
  const iMoved = !same(bIds.filter(i => M.has(i)), mIds.filter(i => B.has(i)));
  const order = []; const put = id => { if (res.has(id) && !order.includes(id)) order.push(id); };
  if (iMoved) { mIds.forEach(put); (t.rows || []).forEach(r => put(r.id)); }
  else { (t.rows || []).forEach(r => put(r.id)); mIds.forEach((id, i) => { if (!order.includes(id) && res.has(id)) { const prev = mIds.slice(0, i).reverse().find(x => order.includes(x)); order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id); } }); }
  out.rows = order.map(id => res.get(id));
  out.nextId = Math.max(m.nextId || 0, t.nextId || 0, ...out.rows.map(r => +r.id || 0), 0) + (out.rows.length ? 0 : 0);
  // Aufgaben und Organigramm: gleiche Dreiwege-Logik je Eintrag, Reihenfolge der Kollegen, eigene neue hinten
  const tasks = mergeList(b.tasks, m.tasks, t.tasks);
  out.tasks = tasks; out.org = mergeList(b.org, m.org, t.org);
  out.nextTaskId = Math.max(m.nextTaskId || 1, t.nextTaskId || 1, ...tasks.map(x => x.id + 1));
  return out;
}
function mergeList(bl, ml, tl) {
  const B = rowsById(bl), M = rowsById(ml), T = rowsById(tl), res = [];
  const ids = (tl || []).map(x => x.id).concat((ml || []).map(x => x.id).filter(id => !T.has(id)));
  ids.forEach(id => {
    const inB = B.has(id), inM = M.has(id), inT = T.has(id); let v;
    if (inM && inT) v = !inB ? M.get(id) : same(M.get(id), B.get(id)) ? T.get(id) : same(T.get(id), B.get(id)) ? M.get(id) : mergeRow(B.get(id), M.get(id), T.get(id));
    else if (inM) { if (!inB || !same(M.get(id), B.get(id))) v = M.get(id); }
    else if (inT) { if (!inB || !same(T.get(id), B.get(id))) v = T.get(id); }
    if (v) res.push(v);
  });
  return res;
}
function mergeRow(b, m, t) {
  const o = { ...t };
  Object.keys(m).forEach(k => { if (k !== 'who' && k !== 'assignees' && !same(m[k], b[k])) o[k] = m[k]; });
  if (!same(m.who, b.who) || !same(m.assignees, b.assignees)) {
    o.who = m.who;
    if (Array.isArray(m.assignees)) o.assignees = m.assignees; else delete o.assignees;
  }
  return o;
}
function applyRemote(p) {
  const a = document.activeElement; let fid = null, ff = null, ss = 0, se = 0;
  if (a && a.dataset && a.dataset.f) { const row = a.closest('.row'); const r = row && state.rows[+row.dataset.i]; if (r) { fid = r.id; ff = a.dataset.f; try { ss = a.selectionStart; se = a.selectionEnd; } catch (e) { } } }
  const selId = sel >= 0 && state.rows[sel] ? state.rows[sel].id : null;
  state = p; lastJson = JSON.stringify(state); hist = []; lastPushT = 0; $('undo').disabled = true;
  sel = selId == null ? -1 : state.rows.findIndex(r => r.id === selId);
  renderAll();
  if (fid != null) { const i = state.rows.findIndex(r => r.id === fid); const el = i >= 0 && $('rowsL').querySelector('.row[data-i="' + i + '"] [data-f="' + ff + '"]'); if (el) { el.focus(); try { el.setSelectionRange(ss, se); } catch (e) { } } }
}
function onRemote(ch) {
  const id = ch.doc.id;
  if (ch.type === 'removed') {
    proj.delete(id); base.delete(id); srv.delete(id); localDel(id);
    if (id === curId) { const rest = [...proj.entries()]; if (rest.length) { switchTo(rest[0][0]); } else { applyProject(newId(), blankPlan()); } toast('Dieses Projekt wurde von einem Kollegen gelöscht'); }
    else refreshSelect();
    return;
  }
  const d = ch.doc.data(); if (!d || typeof d.json !== 'string') return;
  srv.set(id, { by: d.by, savedAt: d.savedAt, byName: d.byName }); const nj = norm(d.json);
  if (id !== curId) { proj.set(id, { name: nameOf(d.json), json: d.json }); base.set(id, nj); localPut(id, d.json); refreshSelect(); return; }
  // Vergleich immer in normalisierter Form, sonst gilt der eigene Stand nach dem Speichern als fremde Änderung
  const mine = norm(JSON.stringify(state));
  if (nj === mine) { base.set(id, nj); showLast(); return; }
  if (nj === base.get(id)) return;
  let theirs; try { theirs = sanitize(JSON.parse(d.json)); } catch (x) { return; }
  if (!theirs) return;
  const b0 = base.get(id);
  const dirty = b0 !== undefined ? mine !== b0 : edited;
  let next = theirs;
  if (dirty) { let b = null; try { b = b0 !== undefined ? sanitize(JSON.parse(b0)) : Object.assign({}, theirs, { rows: [] }); } catch (x) { } next = b ? mergePlans(b, state, theirs) : state; }
  base.set(id, nj); proj.set(id, { name: nameOf(d.json), json: d.json });
  if (norm(JSON.stringify(next)) !== mine) applyRemote(next);
  if (dirty) { lastJson = JSON.stringify(state); scheduleSave(); }
  showLast(true);
}
let peopleNames = {};
async function showLast(remote) {
  const el = $('last'); if (!el) return;
  const s = srv.get(curId); if (!s || !s.savedAt) { el.textContent = ''; return; }
  let who = '';
  if (s.by && s.by !== uid && s.byName) who = s.byName;
  else if (s.by && userNs && s.by !== uid) { try { const ps = await userNs.profiles([s.by]); who = (ps[s.by] && ps[s.by].name) || 'Kollege'; } catch (e) { who = 'Kollege'; } }
  else if (s.by && s.by === uid) who = 'dir';
  const t = new Date(s.savedAt); const hh = isNaN(t) ? '' : t.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  el.textContent = 'Zuletzt geändert' + (who ? ' von ' + who : '') + (hh ? ', ' + hh : '');
  el.title = el.textContent;
  if (remote && who && who !== 'dir') toast('Änderungen von ' + who + ' übernommen');
}
async function startRoom(cl) {
  try { roomNs = await cl.use('room'); } catch (e) { roomNs = null; }
  if (!roomNs) return;
  const upd = () => { try { roomNs.presence({ proj: curId, uid: uid || null }); } catch (e) { } };
  upd(); setInterval(upd, 20000);
  const sel0 = $('projSel'); sel0.addEventListener('change', () => setTimeout(upd, 50));
  roomNs.onPeers(async ch => {
    const others = ch.peers.filter(p => !p.isMe && p.kind === 'viewer');
    const box = $('online'); if (!box) return;
    const ids = [...new Set(others.map(p => p.by).filter(Boolean))];
    let ps = {}; if (userNs && ids.length) { try { ps = await userNs.profiles(ids); } catch (e) { } }
    box.innerHTML = '';
    const seen = new Set();
    others.forEach(p => {
      const key = p.by || p.peer; if (seen.has(key)) return; seen.add(key);
      const pr = p.by && ps[p.by]; const name = (pr && pr.name) || 'Kollege';
      const here = p.presence && p.presence.proj === curId;
      const c = document.createElement('span'); c.className = 'chip' + (here ? ' here' : '');
      c.textContent = name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
      if (pr && pr.color) c.style.setProperty('--c', pr.color);
      const pn = p.presence && p.presence.proj && proj.get(p.presence.proj);
      c.title = name + (pn ? (here ? ' ist in diesem Projekt' : ' ist in „' + pn.name + '“') : ' ist online');
      box.appendChild(c);
    });
  });
}

/* ---------- Dialog, Export, Import ---------- */
function openPanel() {
  $('peopleEditor').hidden = hasUserDirectory();
  $('people').value = state.people.join('\n');
  $('hols').value = state.holidays.map(holLine).join('\n');
  $('region').value = state.region || ''; paintHolPreview();
  $('holsHint').classList.remove('bad'); $('outWrap').hidden = true;
  $('scrim').hidden = false; $('closePanel').focus();
}
const holLine = h => fmtLong(parseISO(h.d)) + (h.to ? ' - ' + fmtLong(parseISO(h.to)) : '') + (h.n ? ' ' + h.n : '');
// Vorschau der gesetzlichen Feiertage für die Jahre des Projekts
function paintHolPreview() {
  const box = $('holPrev'); if (!box) return;
  if (!state.region) { box.innerHTML = '<p class="hint">Ohne Bundesland werden keine Feiertage automatisch berücksichtigt.</p>'; return; }
  let maxE = sched.P; sched.out.forEach(o => { if (o.E > maxE) maxE = o.E; });
  const y0 = ymd(sched.P).y, y1 = Math.min(y0 + 4, Math.max(y0 + 1, ymd(maxE).y));
  const yrs = []; for (let y = y0; y <= y1; y++) yrs.push(y);
  const note = { BY: 'Mariä Himmelfahrt gilt in Gemeinden mit überwiegend katholischer Bevölkerung, das Augsburger Friedensfest nur in Augsburg (nicht enthalten).',
    SN: 'Fronleichnam gilt nur in einzelnen Gemeinden und ist nicht enthalten.', TH: 'Fronleichnam gilt nur in einzelnen Gemeinden und ist nicht enthalten.' }[state.region];
  box.innerHTML = '<details class="holprev"><summary>Gesetzliche Feiertage in ' + esc(regionName(state.region)) + ' ' + (y0 === y1 ? y0 : y0 + '–' + y1) + '</summary>' +
    yrs.map(y => '<div class="holyr"><b>' + y + '</b><ul>' + legalHolidays(state.region, y).map(h => '<li' + (isoWd(h.d) > 5 ? ' class="we"' : '') + '><span>' + fmt(h.d) + '</span>' + esc(h.n) + '</li>').join('') + '</ul></div>').join('') +
    '</details>' + (note ? '<p class="hint">' + esc(note) + '</p>' : '');
}
const HOLS_HINT = 'Ein Eintrag pro Zeile: ein Tag (15.05.2027 Brückentag) oder ein Zeitraum (24.12.2026 - 06.01.2027 Betriebsurlaub). Diese Tage zählen nicht als Arbeitstage.';
function closePanel() { $('scrim').hidden = true; $('openPanel').focus(); }
function slug() { return (state.name || 'terminplan').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '') || 'terminplan'; }
async function offer(name, data) {
  if (window.WEB_DOWNLOAD) {
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([/\.csv$/.test(name) ? '\ufeff' + data : data], { type: 'text/plain;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); return; } catch (e) { }
  }
  if (dl) {
    try { await dl.save({ filename: name, data }); return; }
    catch (e) { if (e && e.code === 'declined') return; if (e && e.code !== 'unavailable') { toast('Speichern nicht möglich'); } }
  }
  $('outbox').value = data; $('outWrap').hidden = false;
}
function csvText() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['Nr', 'PSP', 'Typ', 'Vorgang', 'Verantwortlich', 'Vorgänger', 'Beziehung', 'Versatz', 'Fester Start', 'Dauer', 'Start', 'Ende', 'Status'];
  const lines = [head.map(q).join(';')];
  state.rows.forEach((r, i) => {
    const o = sched.out[i];
    lines.push([r.id, sched.psp[i], TYPES[r.type], r.name, assigneeNames(r), rowLinks(r).map(l => l.pred).join(', '), o.summary ? '' : rowLinks(r).map(l => l.rel).join(', ') || r.rel, o.summary ? '' : rowLinks(r).length > 1 ? rowLinks(r).map(l => parseInt(l.lag, 10) || 0).join(', ') : r.lag, r.fixed ? fmtLong(parseISO(r.fixed)) : '',
      o.summary ? o.E - o.S + 1 : (r.type === 'meilenstein' ? '' : o.dur), fmtLong(o.S), fmtLong(o.E), stInfo(i).name].map(q).join(';'));
  });
  return '﻿' + lines.join('\r\n');
}
function loadState(p, msg) { lastPushT = 0; hist.push(lastJson); if (hist.length > 60) hist.shift(); state = p; lastJson = JSON.stringify(state); sel = -1; edited = true; $('undo').disabled = false; renderAll(); scheduleSave(); toast(msg, 'Rückgängig', undo); }

/* ---------- Scroll, Teiler, Verdrahtung ---------- */
function syncHeaderScroll() { $('hdrL').scrollLeft = $('bodyL').scrollLeft; $('hdrR').scrollLeft = $('bodyR').scrollLeft; }
let syncing = false;
function link(a, b) {
  a.addEventListener('scroll', () => {
    $(a === $('bodyL') ? 'hdrL' : 'hdrR').scrollLeft = a.scrollLeft;
    if (syncing) { syncing = false; return; }
    if (b.scrollTop !== a.scrollTop) { syncing = true; b.scrollTop = a.scrollTop; }
  });
}
/* ---------- Darstellung: automatisch, Desktop oder Mobil (je Gerät gespeichert) ---------- */
let vpDefault = null;
function dispMode() { try { const d = JSON.parse(localStorage.getItem(LS_UI) || '{}').disp; return ['desktop', 'mobile'].includes(d) ? d : 'auto'; } catch (e) { return 'auto'; } }
function applyTheme() {
  let t = 'auto'; try { t = JSON.parse(localStorage.getItem(LS_UI) || '{}').theme || 'auto'; } catch (e) { }
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-tp-theme', t); else { t = 'auto'; document.documentElement.removeAttribute('data-tp-theme'); }
  const seg = document.getElementById('segTheme');
  if (seg) seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === t)));
}
function isMobile() { return document.documentElement.classList.contains('m'); }
function applyDisplay() {
  const mode = dispMode(), html = document.documentElement, meta = document.querySelector('meta[name="viewport"]');
  if (meta && vpDefault == null) vpDefault = meta.getAttribute('content') || 'width=device-width,initial-scale=1';
  // Desktop auf dem Handy: Seite in Desktopbreite darstellen, Zoomen mit den Fingern bleibt möglich
  if (meta) meta.setAttribute('content', mode === 'desktop' && (screen.width || 9999) < 1000 ? 'width=1280' : vpDefault);
  const narrow = window.matchMedia ? window.matchMedia('(max-width: 860px)').matches : false;
  const m = mode === 'mobile' || (mode === 'auto' && narrow);
  html.classList.toggle('m', m); html.classList.toggle('mf', m && !narrow);
  // Mobil: Projekteinstellungen wandern in „Listen & Daten“, damit der Kopf schmal bleibt
  const set = document.querySelector('.settings'), slot = document.getElementById('setSlot'), home = document.querySelector('.row2');
  if (set && slot && home) {
    if (m && set.parentNode !== slot) slot.appendChild(set);
    else if (!m && set.parentNode !== home) home.insertBefore(set, home.firstChild);
    slot.parentNode.hidden = !m;
  }
  const seg = document.getElementById('segDisp');
  if (seg) seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === mode)));
}
function saveUi(extra) { try { const u = JSON.parse(localStorage.getItem(LS_UI) || '{}'); Object.assign(u, extra); localStorage.setItem(LS_UI, JSON.stringify(u)); } catch (e) { } }
function setLeftW(px) { const bw = $('board').clientWidth; px = Math.max(300, Math.min(px, bw - 240)); document.documentElement.style.setProperty('--leftw', px + 'px'); saveUi({ leftw: px }); }

function boot() {
  applyTheme(); applyDisplay();
  initViews();
  initCols(); initBarDrag(); if (typeof initOrg === 'function') initOrg(); initTouchDnD();
  initDrag();
  initTasks();
  try { const u = JSON.parse(localStorage.getItem(LS_UI) || '{}'); if (typeof u.zoom2 === 'number') zoom = Math.max(0, Math.min(ZMAX, u.zoom2)); if (u.leftw) document.documentElement.style.setProperty('--leftw', u.leftw + 'px'); } catch (e) { }
  link($('bodyL'), $('bodyR')); link($('bodyR'), $('bodyL'));
  const rl = $('rowsL');
  rl.addEventListener('input', onInput); rl.addEventListener('click', onClick);
  rl.addEventListener('change', e => { if (e.target.dataset.f === 'name') refreshPredOptions(); });
  rl.addEventListener('focusin', e => { const i = rowIdx(e.target); if (i >= 0) select(i); });
  rl.addEventListener('focusout', e => {
    if (rl.contains(e.relatedTarget) || $('peoplePicker').contains(e.relatedTarget)) return;
    queueMicrotask(() => { if (!rl.contains(document.activeElement) && !$('peoplePicker').contains(document.activeElement)) { filterEditId = null; renderFilteredViews(); } });
  });
  initAssigneePicker();
  $('chart').addEventListener('click', e => { const g = e.target.closest('[data-i]'); if (g) select(+g.dataset.i); });
  $('chart').addEventListener('dblclick', e => { const g = e.target.closest('[data-i]'); if (g) openDetails(+g.dataset.i); });
  $('pname').addEventListener('input', e => { state.name = e.target.value; refreshSelect(); changed(false); });
  $('projSel').addEventListener('change', e => switchTo(e.target.value));
  $('newProj').addEventListener('click', newProject);
  $('dupProj').addEventListener('click', () => { duplicateProject(); closePanel(); });
  $('delProj').addEventListener('click', deleteProject);
  $('pstart').addEventListener('input', e => { if (parseISO(e.target.value) != null) { state.start = e.target.value; refresh(); changed(true); } });
  $('segRaster').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.raster = b.dataset.v; renderAll(); changed(true); });
  $('segMode').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.mode = b.dataset.v; renderAll(); changed(true); });
  $('lines').addEventListener('change', e => { state.lines = e.target.checked; refresh(); changed(true); });
  const setZoom = z => { zoom = Math.max(0, Math.min(ZMAX, z)); saveUi({ zoom2: zoom }); paintZoom(); renderChart(); syncHeaderScroll(); };
  $('zoomIn').addEventListener('click', () => setZoom(zoom + 1));
  $('zoomOut').addEventListener('click', () => setZoom(zoom - 1));
  $('zoomLbl').addEventListener('click', () => setZoom(3));
  paintZoom();
  $('addV').addEventListener('click', () => addRow('vorgang'));
  $('addU').addEventListener('click', () => addRow('untervorgang'));
  $('addM').addEventListener('click', () => addRow('meilenstein'));
  $('undo').addEventListener('click', undo);
  $('segTheme').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; saveUi({ theme: b.dataset.v }); applyTheme(); });
  $('segDisp').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; saveUi({ disp: b.dataset.v }); applyDisplay(); renderAll(); });
  window.addEventListener('resize', () => { const m = isMobile(); applyDisplay(); if (m !== isMobile()) renderAll(); });
  const blank = () => loadState(blankPlan(state), 'Plan geleert');
  $('blank').addEventListener('click', blank); $('blank2').addEventListener('click', () => { blank(); closePanel(); });
  $('loadDemo').addEventListener('click', () => { addProject(demoPlan(), 'Beispielplan als neues Projekt angelegt'); closePanel(); });
  $('openPanel').addEventListener('click', openPanel); $('closePanel').addEventListener('click', closePanel);
  $('scrim').addEventListener('click', e => { if (e.target === $('scrim')) closePanel(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('scrim').hidden) closePanel();
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { e.preventDefault(); undo(); }
  });
  $('people').addEventListener('input', e => { state.people = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); refreshPeopleList(); changed(false); });
  $('hols').addEventListener('input', e => {
    const list = [], bad = []; e.target.value.split('\n').forEach((l, k) => { const p = parseHolidayLine(l); if (!p) return; if (p.bad) bad.push(k + 1); else list.push(p); });
    state.holidays = list; const hint = $('holsHint');
    hint.classList.toggle('bad', !!bad.length);
    hint.textContent = bad.length ? 'Zeile ' + bad.join(', ') + ' nicht lesbar. Erwartet wird zum Beispiel 15.05.2027 Brückentag oder 24.12.2026 - 06.01.2027 Betriebsurlaub.' : HOLS_HINT;
    refresh(); changed(false);
  });
  $('region').insertAdjacentHTML('beforeend', REGIONS.map(([c, n]) => '<option value="' + c + '">' + n + '</option>').join(''));
  $('region').addEventListener('change', e => {
    state.region = regionName(e.target.value) ? e.target.value : '';
    // Eigene Einträge, die jetzt ohnehin gesetzliche Feiertage sind, entfallen
    let gone = 0;
    if (state.region) {
      const legal = new Set(); const y0 = ymd(sched.P).y; for (let y = y0 - 1; y <= y0 + 15; y++) legalHolidays(state.region, y).forEach(h => legal.add(h.d));
      const keep = state.holidays.filter(h => h.to || !legal.has(parseISO(h.d))); gone = state.holidays.length - keep.length; state.holidays = keep;
      if (gone) $('hols').value = state.holidays.map(holLine).join('\n');
    }
    refresh(); changed(false); paintHolPreview();
    toast(state.region ? 'Feiertage für ' + regionName(state.region) + ' übernommen' + (gone ? ', ' + (gone === 1 ? 'ein doppelter eigener Eintrag' : gone + ' doppelte eigene Einträge') + ' entfernt' : '') : 'Keine automatischen Feiertage mehr');
  });
  $('expJson').addEventListener('click', () => { const o = planWithAssignees(state); delete o.example; offer('terminplan-' + slug() + '.json', JSON.stringify(o, null, 2)); });
  $('expCsv').addEventListener('click', () => offer('terminplan-' + slug() + '.csv', csvText()));
  $('copyOut').addEventListener('click', async () => { const t = $('outbox'); try { await navigator.clipboard.writeText(t.value); toast('Kopiert'); } catch (e) { t.select(); toast('Markiert, mit Strg+C kopieren'); } });
  $('impFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { try { const p = sanitize(JSON.parse(String(fr.result))); if (!p) throw 0; addProject(p, 'Plan als neues Projekt geladen'); closePanel(); } catch (x) { toast('Die Datei enthält keinen gültigen Terminplan'); } e.target.value = ''; };
    fr.readAsText(f);
  });
  $('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('board').dataset.tab = b.dataset.tab; $('tabs').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); syncHeaderScroll(); });
  const sp = $('split');
  sp.addEventListener('pointerdown', e => { sp.setPointerCapture(e.pointerId); sp.dataset.drag = '1'; });
  sp.addEventListener('pointermove', e => { if (sp.dataset.drag) setLeftW(e.clientX - $('board').getBoundingClientRect().left); });
  sp.addEventListener('pointerup', () => { delete sp.dataset.drag; });
  sp.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setLeftW($('paneL').getBoundingClientRect().width + (e.key === 'ArrowRight' ? 24 : -24)); } });
  renderAll();
  initStore();
}

