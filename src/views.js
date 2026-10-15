// ===== Ansichten: Liste, Kanban, Kalender =====
const LANE_COLORS = ['#7b8a83', '#d4861b', '#3d7e5e', '#2f6fb2', '#8a5cb8', '#b23a2b', '#2a8c8c'];
const MON_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
let view = 'gantt', fWho = '', fSt = 'all', fQ = '', sortK = 'psp', sortDir = 1, calM = null, calSum = false, laneEdit = -1, laneDel = -1;

// Bahnen (Kanban-Spalten) gehören zum Projekt; die erste Bahn nimmt alle Vorgänge ohne gültige Zuordnung auf
function lanes() { return state.lanes && state.lanes.length ? state.lanes : (state.lanes = defaultLanes()); }
function laneOfRow(r) { const L = lanes(); return L.find(l => l.id === (r.st || '')) || L[0]; }
function rowDone(r) { return !!laneOfRow(r).done; }
const laneIx = i => lanes().indexOf(laneOfRow(state.rows[i]));
function isDone(i) {
  const o = sched.out[i];
  if (!o.summary) return rowDone(state.rows[i]);
  const ks = sched.kids[i]; return ks.length > 0 && ks.every(k => rowDone(state.rows[k]));
}
// Anzeige-Status: bei Sammelvorgängen aus den Untervorgängen abgeleitet
function stInfo(i) {
  const L = lanes(), o = sched.out[i];
  const pick = l => ({ id: l.id, name: l.name, c: l.c });
  if (!o.summary) return pick(laneOfRow(state.rows[i]));
  const ks = sched.kids[i]; if (!ks.length) return pick(L[0]);
  const ls = ks.map(k => laneOfRow(state.rows[k]));
  if (ls.every(l => l === ls[0])) return pick(ls[0]);
  if (ls.every(l => l.done)) return pick(ls.find(l => l.done));
  return { id: '~', name: 'In Arbeit', c: 1 };
}
const isLate = i => !isDone(i) && sched.out[i].E < todayDn();
function durTxt(i) {
  const r = state.rows[i], o = sched.out[i];
  if (r.type === 'meilenstein') return '–';
  if (o.summary) return (o.E - o.S + 1) + ' KT';
  return o.dur + (sched.work ? ' AT' : ' T');
}
function rangeTxt(i) { const o = sched.out[i]; return o.E === o.S ? fmt(o.S) : fmt(o.S) + ' – ' + fmt(o.E); }
const splitFilterPeople = value => String(value || '').split(/\s*(?:,|;|\/|&|\+|\bund\b)\s*/i).map(name => name.trim()).filter(Boolean);
function filterPeople() {
  if (hasUserDirectory()) return assigneeTeam().map(user => user.name);
  const names = new Map();
  (state.people || []).concat(state.rows.map(assigneeNames)).forEach(value => {
    splitFilterPeople(value).forEach(name => { const key = name.toLowerCase(); if (!names.has(key)) names.set(key, name); });
  });
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'de'));
}
// Alle Kriterien müssen auf derselben Zeile passen. Eltern werden erst anschließend
// als Orientierung ergänzt und erben keine voneinander unabhängigen Kindtreffer.
function matches(i) {
  const r = state.rows[i], o = sched && sched.out[i];
  if (!r || !o) return false;
  const person = fWho.trim().toLowerCase();
  if (person.startsWith('user:')) { if (!assigneeEntries(r).some(entry => entry.id === fWho.slice(5))) return false; }
  else if (person && !splitFilterPeople(assigneeNames(r)).some(name => name.toLowerCase() === person)) return false;
  if (fSt !== 'all') {
    if (fSt === 'late') { if (!isLate(i)) return false; }
    else if (fSt === 'open') { if (isDone(i)) return false; }
    else if (fSt.startsWith('lane:') && stInfo(i).id !== fSt.slice(5)) return false;
  }
  if (fQ) {
    const q = fQ.trim().toLowerCase(), hay = (r.name + ' ' + assigneeNames(r) + ' ' + sched.psp[i]).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
function visibleRowIndices() {
  const indices = state.rows.map((_, i) => i);
  if (!sched) return indices;
  const visible = new Set();
  indices.forEach(i => {
    if (!matches(i)) return;
    visible.add(i);
    for (let parent = sched.parent[i]; parent >= 0 && !visible.has(parent); parent = sched.parent[parent]) visible.add(parent);
  });
  return indices.filter(i => visible.has(i));
}
function whoOptions(names = filterPeople()) {
  if (hasUserDirectory()) return '<option value="">Alle Personen</option>' + assigneeTeam().map(user => '<option value="user:' + esc(user.id) + '"' + (fWho === 'user:' + user.id ? ' selected' : '') + '>' + esc(user.name) + '</option>').join('');
  return '<option value="">Alle Personen</option>' + names.map(n => '<option value="' + esc(n) + '"' + (n === fWho ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
}
function updateFilterUi() {
  const names = filterPeople();
  if (hasUserDirectory()) { if (fWho && !assigneeTeam().some(user => 'user:' + user.id === fWho)) fWho = ''; }
  else if (fWho) fWho = names.find(name => name.toLowerCase() === fWho.trim().toLowerCase()) || '';
  if (fSt.startsWith('lane:') && !lanes().some(lane => 'lane:' + lane.id === fSt)) fSt = 'all';
  const fw = $('fWho'), fs = $('fSt'), fq = $('fQ');
  if (fw) {
    if (document.activeElement !== fw) fw.innerHTML = whoOptions(names);
    fw.value = fWho;
  }
  if (fs) {
    if (document.activeElement !== fs) {
      fs.innerHTML = [['all', 'Alle Status'], ['open', 'Nicht erledigt']].concat(lanes().map(lane => ['lane:' + lane.id, lane.name]), [['late', 'Überfällig']])
        .map(([value, title]) => '<option value="' + esc(value) + '"' + (value === fSt ? ' selected' : '') + '>' + esc(title) + '</option>').join('');
    }
    fs.value = fSt;
  }
  if (fq && document.activeElement !== fq) fq.value = fQ;
  const active = Number(!!fQ.trim()) + Number(!!fWho) + Number(fSt !== 'all');
  const count = $('filterCount'), summary = $('filterSummary'), reset = $('resetFilters');
  if (count) { count.hidden = !active; count.textContent = String(active); }
  if (summary) {
    summary.hidden = !active;
    const leaf = active && sched ? state.rows.map((_, i) => i).filter(i => sched.out[i] && !sched.out[i].summary) : [];
    summary.textContent = active ? leaf.filter(matches).length + ' von ' + leaf.length + ' Vorgängen' : '';
  }
  if (reset) reset.disabled = !active;
  const panel = $('vfilters'), toggle = $('toggleFilters'), arrow = $('filterArrow');
  if (toggle && panel) { toggle.setAttribute('aria-expanded', String(!panel.hidden)); toggle.classList.toggle('active', !!active); }
  if (arrow && panel) arrow.textContent = panel.hidden ? '▸' : '▾';
}
function resetViewFilters() {
  fWho = ''; fSt = 'all'; fQ = ''; filterEditId = null;
  if ($('fWho')) $('fWho').value = '';
  if ($('fSt')) $('fSt').value = 'all';
  if ($('fQ')) $('fQ').value = '';
  updateFilterUi();
}

function setView(v) {
  if (!['gantt', 'list', 'kanban', 'cal'].includes(v)) v = 'gantt';
  view = v; saveUi({ view: v });
  $('segView').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  $('board').hidden = v !== 'gantt'; $('tabs').hidden = v !== 'gantt';
  document.querySelector('.foot').hidden = v !== 'gantt';
  $('vList').hidden = v !== 'list'; $('vKanban').hidden = v !== 'kanban'; $('vCal').hidden = v !== 'cal';
  if (v === 'gantt' && sched) renderFilteredViews();
  else renderView();
}
function renderView() {
  if (!sched || typeof view === 'undefined') return;
  updateFilterUi();
  if (view === 'list') renderList(); else if (view === 'kanban') renderKanban(); else if (view === 'cal') renderCal();
}
function gotoRow(i) {
  setView('gantt'); select(i);
  const el = $('rowsL').querySelector('.row[data-i="' + i + '"]');
  if (el) { el.scrollIntoView({ block: 'center' }); const f = el.querySelector('[data-f="name"]'); if (f) f.focus({ preventScroll: true }); }
  if (window.innerWidth <= 860) { $('board').dataset.tab = 'table'; $('tabs').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.tab === 'table'))); }
}
function setSt(i, v) {
  if (readOnly) return;
  const r = state.rows[i];
  if (!r || sched.out[i].summary || (r.st || '') === v) return;
  r.st = v; refresh(); changed(true);
}
const stSelect = (i, cur) => '<select class="stsel" data-st="' + i + '" aria-label="Status" style="--lc:' + LANE_COLORS[stInfo(i).c] + '">' + lanes().map(l => '<option value="' + esc(l.id) + '"' + (l.id === cur ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select>';
const stBadge = s => '<span class="stb" style="--lc:' + LANE_COLORS[s.c] + '">' + esc(s.name) + '</span>';

/* ---------- Liste ---------- */
function renderList() {
  const N = state.rows.length;
  const idx = visibleRowIndices();
  const key = {
    psp: i => i, id: i => state.rows[i].id, name: i => (state.rows[i].name || '').toLowerCase(), who: i => (assigneeNames(state.rows[i]) || '~').toLowerCase(),
    S: i => sched.out[i].S, E: i => sched.out[i].E, dur: i => sched.out[i].E - sched.out[i].S, st: i => sched.out[i].summary ? (isDone(i) ? 99 : 50) : laneIx(i), type: i => state.rows[i].type
  }[sortK] || (i => i);
  idx.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : a - b) * sortDir; });
  const tree = sortK === 'psp' && sortDir === 1;
  const th = (k, t, cls) => '<th class="' + (cls || '') + (sortK === k ? ' on' : '') + '"><button type="button" data-sort="' + k + '">' + t + (sortK === k ? (sortDir === 1 ? ' ▲' : ' ▼') : '') + '</button></th>';
  let h = '<div class="tw"><table class="lst"><thead><tr>' + th('id', 'Nr', 'n') + th('psp', 'PSP', 'n') + th('name', 'Vorgang') + th('type', 'Typ') + th('who', 'Verantwortlich') +
    th('S', 'Start', 'd') + th('E', 'Ende', 'd') + th('dur', 'Dauer', 'n') + th('st', 'Status') + '<th>Vorgänger</th></tr></thead><tbody>';
  idx.forEach(i => {
    const r = state.rows[i], o = sched.out[i], s = stInfo(i), late = isLate(i);
    const sub = r.type === 'untervorgang' && sched.parent[i] >= 0;
    const pi = o.pred >= 0 ? o.pred : -1;
    const pred = pi >= 0 ? state.rows[pi].id + ' ' + r.rel + (parseInt(r.lag, 10) ? (parseInt(r.lag, 10) > 0 ? '+' : '') + parseInt(r.lag, 10) : '') : '';
    h += '<tr class="' + (o.summary ? 'sum' : '') + (isDone(i) ? ' done' : '') + '">' +
      '<td class="n">' + r.id + '</td><td class="n">' + sched.psp[i] + '</td>' +
      '<td class="nm' + (tree && sub ? ' ind' : '') + '"><button type="button" class="go" data-go="' + i + '" title="Im Gantt-Diagramm öffnen">' + (r.type === 'meilenstein' ? '<i class="msd"></i>' : '') + esc(r.name || 'ohne Namen') + '</button></td>' +
      '<td>' + (o.summary ? 'Sammelvorgang' : TYPES[r.type]) + '</td><td class="whoc">' + avs(assigneeNames(r)) + esc(assigneeNames(r)) + '</td>' +
      '<td class="d">' + fmt(o.S) + '</td><td class="d' + (late ? ' late' : '') + '">' + fmt(o.E) + (late ? ' <span class="lt">überfällig</span>' : '') + '</td>' +
      '<td class="n">' + durTxt(i) + '</td><td>' + (o.summary ? stBadge(s) : stSelect(i, s.id)) + '</td><td class="n">' + esc(pred) + '</td></tr>';
  });
  h += '</tbody></table></div>';
  if (!idx.length) h += '<div class="empty">' + (N ? 'Kein Vorgang passt zum Filter.' : 'Noch keine Vorgänge. Lege oben mit „+ Vorgang“ los.') + '</div>';
  const leaf = idx.filter(i => !sched.out[i].summary && matches(i));
  const lateN = leaf.filter(isLate).length;
  h += '<p class="sumline">' + leaf.length + ' Vorgänge und Meilensteine · ' + lanes().map(l => leaf.filter(i => laneOfRow(state.rows[i]) === l).length + ' ' + esc(l.name)).join(' · ') + (lateN ? ' · <b class="late">' + lateN + ' überfällig</b>' : '') + '</p>';
  $('vList').innerHTML = h;
}

/* ---------- Kanban ---------- */
function renderKanban() {
  const N = state.rows.length, L = lanes();
  const items = []; for (let i = 0; i < N; i++) if (!sched.out[i].summary && matches(i)) items.push(i);
  items.sort((a, b) => sched.out[a].S - sched.out[b].S || a - b);
  let h = '<div class="kb" style="grid-template-columns:repeat(' + L.length + ', minmax(220px, 1fr)) 210px">';
  L.forEach((ln, ci) => {
    const list = items.filter(i => laneOfRow(state.rows[i]) === ln);
    h += '<section class="kcol" data-col="' + esc(ln.id) + '" data-li="' + ci + '"><header>' +
      '<button type="button" class="dot" data-lc="' + ci + '" style="background:' + LANE_COLORS[ln.c] + '" title="Farbe wechseln" aria-label="Farbe der Bahn wechseln"></button>' +
      '<span class="lname" data-ln="' + ci + '" title="Doppelklick zum Umbenennen">' + esc(ln.name) + '</span>' + (ln.done ? '<span class="ldone" title="Karten in dieser Bahn zählen als erledigt">✓</span>' : '') +
      '<span class="cnt">' + list.length + '</span><button type="button" class="ib lmb" data-lm="' + ci + '" title="Bahn bearbeiten" aria-label="Bahn bearbeiten" aria-expanded="' + (laneEdit === ci) + '">⋯</button></header>';
    if (laneEdit === ci) {
      const tgt = L[ci === 0 ? 1 : 0];
      h += '<div class="lmenu">' +
        '<label class="lfld">Name<input class="in" data-lname="' + ci + '" value="' + esc(ln.name) + '" maxlength="60" autocomplete="off"></label>' +
        '<label class="chk"><input type="checkbox" data-ldone="' + ci + '"' + (ln.done ? ' checked' : '') + '> Karten hier zählen als erledigt</label>' +
        '<div class="btns"><button type="button" class="btn sm" data-lmv="-1" data-li="' + ci + '"' + (ci === 0 ? ' disabled' : '') + '>← Nach links</button><button type="button" class="btn sm" data-lmv="1" data-li="' + ci + '"' + (ci === L.length - 1 ? ' disabled' : '') + '>Nach rechts →</button></div>' +
        '<div class="btns">' + (L.length > 1 ? '<button type="button" class="btn sm danger" data-ldel="' + ci + '">' + (laneDel === ci ? 'Wirklich löschen? Karten gehen nach „' + esc(tgt.name) + '“' : 'Bahn löschen') + '</button>' : '') +
        '<button type="button" class="btn sm" data-lm="' + ci + '">Fertig</button></div></div>';
    }
    h += '<div class="kcards">';
    list.forEach(i => {
      const r = state.rows[i], par = sched.parent[i], late = isLate(i);
      h += '<article class="card' + (r.type === 'meilenstein' ? ' ms' : '') + (late ? ' late' : '') + '" draggable="true" data-i="' + i + '">' +
        '<div class="ctop"><span class="psp">' + sched.psp[i] + '</span>' + (r.type === 'meilenstein' ? '<span class="tag"><i class="msd"></i>Meilenstein</span>' : '') + (late ? '<span class="tag lt">überfällig</span>' : '') + '</div>' +
        '<button type="button" class="cname" data-go="' + i + '" title="Im Gantt-Diagramm öffnen">' + esc(r.name || 'ohne Namen') + '</button>' +
        (par >= 0 ? '<div class="cpar">' + esc(state.rows[par].name || '') + '</div>' : '') +
        '<div class="cmeta"><span>' + rangeTxt(i) + '</span>' + (r.type === 'meilenstein' ? '' : '<span>' + durTxt(i) + '</span>') + '</div>' +
        '<div class="cfoot">' + (assigneeNames(r) ? '<span class="who">' + avs(assigneeNames(r)) + esc(assigneeNames(r)) + '</span>' : '<span class="who none">ohne Verantwortlichen</span>') +
        '<span class="mv"><button type="button" class="ib" data-mv="-1" data-i="' + i + '" aria-label="In die linke Bahn"' + (ci === 0 ? ' disabled' : '') + '>‹</button><button type="button" class="ib" data-mv="1" data-i="' + i + '" aria-label="In die rechte Bahn"' + (ci === L.length - 1 ? ' disabled' : '') + '>›</button></span></div></article>';
    });
    if (!list.length) h += '<div class="kempty">Keine Einträge</div>';
    h += '</div></section>';
  });
  h += '<section class="kadd"><label for="newLane">Neue Bahn</label><input id="newLane" class="in" placeholder="z. B. Abnahme" maxlength="60" autocomplete="off"><button type="button" class="btn" id="addLane">+ Bahn anlegen</button>' +
    '<p class="hint">Bahnen gelten für dieses Projekt. Über ⋯ an einer Bahn änderst du Namen, Reihenfolge und ob sie als erledigt zählt. Ein Klick auf den Farbpunkt wechselt die Farbe.</p></section>';
  h += '</div>';
  const keep = document.activeElement && document.activeElement.id === 'newLane' ? document.activeElement.value : null;
  $('vKanban').innerHTML = h;
  if (keep != null) { const n = $('newLane'); n.value = keep; n.focus(); }
}
function laneChanged() {
  if (readOnly) return;
  laneDel = -1; refresh(); changed(true); }
function addLane() {
  if (readOnly) return;
  const n = $('newLane'), name = (n.value || '').trim(); if (!name) { n.focus(); return; }
  const L = lanes(); if (L.length >= 20) { toast('Höchstens 20 Bahnen'); return; }
  const used = new Set(L.map(l => l.c)), c = [3, 4, 6, 5, 0, 1, 2].find(x => !used.has(x));
  L.push({ id: 'l' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4), name: name.slice(0, 60), c: c == null ? 3 : c, done: false });
  n.value = ''; laneChanged();
  const nn = $('newLane'); if (nn) nn.focus();
}
function delLane(ci) {
  if (readOnly) return;
  const L = lanes(); if (L.length < 2) return;
  if (laneDel !== ci) { laneDel = ci; renderKanban(); return; }
  const gone = L[ci]; L.splice(ci, 1); const to = L[0];
  state.rows.forEach(r => { if (!L.some(l => l.id === (r.st || ''))) r.st = to.id; });
  laneEdit = -1; laneChanged(); toast('Bahn „' + gone.name + '“ gelöscht', 'Rückgängig', undo);
}

/* ---------- Kalender ---------- */
function renderCal() {
  const today = todayDn();
  if (calM == null) { const P = sched.P; let maxE = P; sched.out.forEach(o => { if (o.E > maxE) maxE = o.E; }); const t = today >= P && today <= maxE ? today : P; const y = ymd(t); calM = dn(y.y, y.m, 1); }
  const ym = ymd(calM), first = calM, next = dn(ym.m === 12 ? ym.y + 1 : ym.y, ym.m === 12 ? 1 : ym.m + 1, 1);
  const g0 = mondayOf(first), weeks = Math.ceil((next - g0) / 7);
  const holName = new Map(state.holidays.map(x => [parseISO(x.d), x.n]));
  const N = state.rows.length, items = [];
  for (let i = 0; i < N; i++) { const o = sched.out[i]; if ((calSum || !o.summary) && matches(i)) items.push(i); }
  items.sort((a, b) => sched.out[a].S - sched.out[b].S || (sched.out[b].E - sched.out[b].S) - (sched.out[a].E - sched.out[a].S) || a - b);
  const LANES = 5, LH = 21, TOP = 26;
  let h = '<div class="calbar"><div class="seg"><button type="button" data-cal="-1" aria-label="Voriger Monat">‹</button><button type="button" data-cal="0">Heute</button><button type="button" data-cal="1" aria-label="Nächster Monat">›</button></div>' +
    '<h2>' + MON_LONG[ym.m - 1] + ' ' + ym.y + '</h2><button type="button" class="btn sm" data-cal="P">Zum Projektstart</button><span class="spacer"></span>' +
    '<label class="chk"><input type="checkbox" id="calSum"' + (calSum ? ' checked' : '') + '> Sammelvorgänge</label></div>';
  h += '<div class="cal"><div class="cwd">' + ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => '<div>' + d + '</div>').join('') + '</div>';
  for (let w = 0; w < weeks; w++) {
    const ws = g0 + w * 7, we = ws + 6;
    // Spur je Vorgang; in Arbeitstagen wird der Balken an Wochenenden und Feiertagen unterbrochen
    const lanes = [], more = new Array(7).fill(0), segs = [];
    items.forEach(i => {
      const o = sched.out[i]; if (o.S > we || o.E < ws) return;
      const s0 = Math.max(o.S, ws), e0 = Math.min(o.E, we);
      let l = 0; while (l < lanes.length && lanes[l] >= s0) l++; lanes[l] = e0;
      const pieces = [];
      if (sched.work && !o.summary && state.rows[i].type !== 'meilenstein') {
        let a = null; for (let d = s0; d <= e0 + 1; d++) { const w = d <= e0 && sched.isWork(d); if (w && a == null) a = d; if (!w && a != null) { pieces.push([a, d - 1]); a = null; } }
      } else pieces.push([s0, e0]);
      pieces.forEach(([a, b]) => { segs.push({ i, s: a, e: b, l }); if (l >= LANES) for (let d = a; d <= b; d++) more[d - ws]++; });
    });
    const shown = Math.min(Math.max(lanes.length, 1), LANES);
    const hgt = TOP + shown * LH + (more.some(Boolean) ? 18 : 6);
    h += '<div class="cwk" style="height:' + Math.max(hgt, 92) + 'px"><span class="kw">KW ' + isoWeek(ws) + '</span>';
    for (let d = 0; d < 7; d++) {
      const day = ws + d, wd = d + 1, hn = holName.get(day), out = day < first || day >= next;
      h += '<div class="cday' + (out ? ' out' : '') + (wd > 5 ? ' we' : '') + (hn ? ' hol' : '') + (day === today ? ' today' : '') + '" style="left:' + (d / 7 * 100) + '%">' +
        '<span class="dn">' + ymd(day).d + '</span>' + (hn ? '<span class="hn" title="' + esc(hn) + '">' + esc(hn) + '</span>' : '') +
        (more[d] ? '<span class="more">+' + more[d] + ' weitere</span>' : '') + '</div>';
    }
    segs.forEach(sg => {
      if (sg.l >= LANES) return;
      const i = sg.i, r = state.rows[i], o = sched.out[i], s = stInfo(i);
      const left = (sg.s - ws) / 7 * 100, width = (sg.e - sg.s + 1) / 7 * 100;
      const cls = r.type === 'meilenstein' ? 'ms' : o.summary ? 'sum' : (r.type === 'untervorgang' && sched.parent[i] >= 0 ? 'sub' : 'task');
      const tip = (r.name || 'ohne Namen') + ': ' + rangeTxt(i) + (assigneeNames(r) ? ' · ' + assigneeNames(r) : '') + ' · ' + s.name + (isLate(i) ? ' · überfällig' : '');
      h += '<button type="button" class="cb ' + cls + (isDone(i) ? ' done' : '') + (isLate(i) ? ' late' : '') + (sg.s > o.S ? ' cl' : '') + (sg.e < o.E ? ' cr' : '') + '" data-go="' + i + '" title="' + esc(tip) + '" style="left:calc(' + left + '% + 3px);width:calc(' + width + '% - 6px);top:' + (TOP + sg.l * LH) + 'px">' +
        (cls === 'ms' ? '<i class="msd"></i>' : '') + '<span>' + esc(r.name || 'ohne Namen') + (assigneeNames(r) && cls !== 'sum' ? ' · ' + esc(assigneeNames(r)) : '') + '</span></button>';
    });
    h += '</div>';
  }
  h += '</div>';
  $('vCal').innerHTML = h;
}

/* ---------- Ereignisse ---------- */
function initViews() {
  try { const u = JSON.parse(localStorage.getItem(LS_UI) || '{}'); if (u.view) view = u.view; } catch (e) { }
  $('segView').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); });
  const applyFilters = () => { filterEditId = null; renderFilteredViews(); };
  $('fWho').addEventListener('change', e => { fWho = e.target.value; applyFilters(); });
  $('fSt').addEventListener('change', e => { fSt = e.target.value; applyFilters(); });
  $('fQ').addEventListener('input', e => { fQ = e.target.value.trim(); applyFilters(); });
  $('toggleFilters').addEventListener('click', () => { $('vfilters').hidden = !$('vfilters').hidden; updateFilterUi(); });
  $('resetFilters').addEventListener('click', () => { resetViewFilters(); renderFilteredViews(); });
  updateFilterUi();
  const go = e => { const b = e.target.closest('[data-go]'); if (b) { gotoRow(+b.dataset.go); return true; } return false; };
  $('vList').addEventListener('click', e => {
    const s = e.target.closest('[data-sort]');
    if (s) { const k = s.dataset.sort; if (sortK === k) sortDir = -sortDir; else { sortK = k; sortDir = 1; } renderList(); return; }
    go(e);
  });
  $('vList').addEventListener('change', e => { const s = e.target.closest('[data-st]'); if (s) setSt(+s.dataset.st, s.value); });
  const kb = $('vKanban');
  kb.addEventListener('click', e => {
    const m = e.target.closest('[data-mv]');
    if (m) { const i = +m.dataset.i, L = lanes(), k = laneIx(i) + +m.dataset.mv; if (k >= 0 && k < L.length) setSt(i, L[k].id); return; }
    const lm = e.target.closest('[data-lm]');
    if (lm) { const k = +lm.dataset.lm; laneEdit = laneEdit === k ? -1 : k; laneDel = -1; renderKanban(); if (laneEdit >= 0) { const f = kb.querySelector('[data-lname]'); if (f) f.focus(); } return; }
    const lc = e.target.closest('[data-lc]'); if (lc) { const l = lanes()[+lc.dataset.lc]; l.c = (l.c + 1) % LANE_COLORS.length; laneChanged(); return; }
    const mvl = e.target.closest('[data-lmv]');
    if (mvl) { const L = lanes(), a = +mvl.dataset.li, b = a + +mvl.dataset.lmv; if (b < 0 || b >= L.length) return; [L[a], L[b]] = [L[b], L[a]]; laneEdit = b; laneChanged(); return; }
    const dl2 = e.target.closest('[data-ldel]'); if (dl2) { delLane(+dl2.dataset.ldel); return; }
    if (e.target.closest('#addLane')) { addLane(); return; }
    go(e);
  });
  kb.addEventListener('dblclick', e => { const n = e.target.closest('[data-ln]'); if (n) { laneEdit = +n.dataset.ln; laneDel = -1; renderKanban(); const f = kb.querySelector('[data-lname]'); if (f) { f.focus(); f.select(); } } });
  kb.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'newLane') { e.preventDefault(); addLane(); }
    else if (e.target.dataset && e.target.dataset.lname != null) { e.preventDefault(); e.target.blur(); }
  });
  kb.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.lname != null) { const l = lanes()[+t.dataset.lname], v = t.value.trim(); if (v && l && v !== l.name) { l.name = v.slice(0, 60); laneChanged(); } return; }
    if (t.dataset.ldone != null) { lanes()[+t.dataset.ldone].done = t.checked; laneChanged(); }
  });

  kb.addEventListener('dragstart', e => { if (readOnly) { e.preventDefault(); return; } const c = e.target.closest('.card'); if (!c) return; e.dataTransfer.setData('text/plain', c.dataset.i); e.dataTransfer.effectAllowed = 'move'; c.classList.add('drag'); });
  kb.addEventListener('dragend', e => { const c = e.target.closest('.card'); if (c) c.classList.remove('drag'); kb.querySelectorAll('.over').forEach(x => x.classList.remove('over')); });
  kb.addEventListener('dragover', e => { const z = e.target.closest('.kcol'); if (!z) return; e.preventDefault(); kb.querySelectorAll('.over').forEach(x => { if (x !== z) x.classList.remove('over'); }); z.classList.add('over'); });
  kb.addEventListener('drop', e => { const z = e.target.closest('.kcol'); if (!z) return; e.preventDefault(); const i = parseInt(e.dataTransfer.getData('text/plain'), 10); z.classList.remove('over'); if (Number.isFinite(i)) setSt(i, z.dataset.col); });
  $('vCal').addEventListener('click', e => {
    const n = e.target.closest('[data-cal]');
    if (n) {
      const v = n.dataset.cal, y = ymd(calM);
      if (v === '0') { const t = ymd(todayDn()); calM = dn(t.y, t.m, 1); }
      else if (v === 'P') { const t = ymd(sched.P); calM = dn(t.y, t.m, 1); }
      else { const m = y.m + +v; calM = dn(y.y + Math.floor((m - 1) / 12), ((m - 1) % 12 + 12) % 12 + 1, 1); }
      renderCal(); return;
    }
    go(e);
  });
  $('vCal').addEventListener('change', e => { if (e.target.id === 'calSum') { calSum = e.target.checked; renderCal(); } });
  $('pdfBtn').addEventListener('click', exportPdf);
  setView(view);
}

/* ---------- Teamarbeit über Claude: Rolle erkennen und erklären ---------- */
async function teamInit() {
  if (!userNs) return;
  let w = null, owner = false;
  try { w = await userNs.can('data.write'); } catch (e) { }
  try { owner = await userNs.isOwner(); } catch (e) { }
  if (w === false) lockReadOnly(false);
  $('teamInfo').innerHTML = owner
    ? '<p>Alle, mit denen du diesen Planer teilst, arbeiten in denselben Projekten. Änderungen erscheinen bei allen nach wenigen Sekunden, oben siehst du, wer gerade online ist.</p>' +
      '<ol><li>Oben auf <b>Teilen</b> (Share) klicken.</li><li>Kollegen einzeln oder die ganze Organisation hinzufügen.</li>' +
      '<li>Rolle wählen: <b>Contributor</b> bearbeitet Pläne mit, <b>Viewer</b> sieht sie nur an.</li></ol>' +
      '<p class="hint">Rolle <b>Editor</b> ist nur nötig, wenn jemand den Planer selbst über Claude ändern soll.</p>'
    : w === false
      ? '<p>Du kannst alle Projekte ansehen und als PDF oder CSV exportieren. Zum Mitbearbeiten muss der Besitzer dir im Teilen-Menü die Rolle <b>Contributor</b> geben.</p>'
      : '<p>Du bearbeitest die Projekte gemeinsam mit dem Team. Änderungen erscheinen bei allen nach wenigen Sekunden.</p>';
  $('teamBox').hidden = false;
}

// Schreibrechte fehlen: Bearbeitung sperren, Hinweis zeigen und, falls schon lokal getippt wurde, den gespeicherten Stand wiederherstellen
function lockReadOnly(afterFailedSave) {
  readOnly = true; document.body.classList.add('ro'); $('rowsL').inert = false;
  if (sched) updateComputed();
  const b = $('roBanner'); b.hidden = false;
  if (afterFailedSave) {
    b.querySelector('span').innerHTML = '<b>Nur Ansicht.</b> Deine Änderung wurde nicht gespeichert, weil dein Zugang nur Lesen erlaubt. ' +
      'Personen außerhalb der Organisation können nur bearbeiten, wenn sie per E-Mail als <b>Editor</b> eingeladen sind und der Planer nicht zusätzlich per öffentlichem Link geteilt ist.';
    const srvJson = base.get(curId);
    if (srvJson) { try { const p = sanitize(JSON.parse(srvJson)); if (p) { state = p; lastJson = JSON.stringify(state); hist = []; $('undo').disabled = true; renderAll(); } } catch (e) { } }
  }
  setStatus('local', 'Nur Ansicht');
}

/* ---------- Profilbilder der Teammitglieder (nur Webversion mit Benutzerkonten) ---------- */
const avs = who => (typeof window.tpAvatars === 'function' && who) ? window.tpAvatars(who) : '';
window.__teamChanged = () => { if (!sched) return; refreshPeopleList(); renderFilteredViews(); };
