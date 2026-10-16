/* ---------- Gantt-Tabelle: Spalten je Person, Einklappen, Termineingabe ---------- */
// Einstellungen gelten je Person (Benutzerkennung) und Gerät.
function prefKey(base) { return base + ':' + (typeof uid !== 'undefined' && uid ? uid : 'lokal'); }
function loadPref(base, def) { try { const v = JSON.parse(localStorage.getItem(prefKey(base)) || 'null'); return v && typeof v === 'object' ? v : def; } catch (e) { return def; } }
function savePref(base, v) { try { localStorage.setItem(prefKey(base), JSON.stringify(v)); } catch (e) { } }

/* Spalten: Reihenfolge wie in rowHTML; [Schlüssel, Bezeichnung, Standardbreite, immer sichtbar] */
const COLS = [['acts', '', 52, true], ['nr', 'Nr', 34], ['psp', 'PSP', 42], ['type', 'Typ', 134], ['name', 'Vorgang', 220, true], ['who', 'Verantwortlich', 112],
  ['pct', 'Fortschritt', 80], ['pred', 'Vorgänger', 150], ['rel', 'Beziehung', 62], ['lag', 'Versatz', 58], ['fixed', 'Fester Start', 130], ['dur', 'Dauer', 56],
  ['S', 'Start', 98], ['E', 'Ende', 98]];
let colPref = null, colKey = '';
function colPrefs() { if (!colPref || colKey !== prefKey('tp-cols-v1')) { colKey = prefKey('tp-cols-v1'); colPref = loadPref('tp-cols-v1', {}); colPref.w = colPref.w || {}; colPref.hide = Array.isArray(colPref.hide) ? colPref.hide : []; } return colPref; }
const colW = c => Math.max(28, Math.min(640, Number(colPrefs().w[c[0]]) || c[2]));
function applyCols(reload) {
  if (reload) colPref = null;
  const p = colPrefs(), hide = new Set(p.hide);
  const vis = COLS.filter(c => c[3] || !hide.has(c[0]));
  let css = '#paneL .grid{grid-template-columns:' + vis.map(c => colW(c) + 'px').join(' ') + ';width:' + vis.reduce((s, c) => s + colW(c), 0) + 'px}';
  COLS.forEach((c, k) => { if (!c[3] && hide.has(c[0])) css += '#paneL .grid>:nth-child(' + (k + 1) + '){display:none}'; });
  let st = document.getElementById('colStyle');
  if (!st) { st = document.createElement('style'); st.id = 'colStyle'; document.head.appendChild(st); }
  st.textContent = css;
  const b = $('colBtn'); if (b) b.classList.toggle('on', !!(p.hide.length || Object.keys(p.w).length));
}
function colMenuHtml() {
  const p = colPrefs(), hide = new Set(p.hide);
  return '<p class="cmh">Spalten anzeigen</p>' + COLS.filter(c => !c[3]).map(c => '<label class="chk"><input type="checkbox" data-col="' + c[0] + '"' + (hide.has(c[0]) ? '' : ' checked') + '> ' + esc(c[1]) + '</label>').join('') +
    '<div class="btns"><button type="button" class="btn sm" data-colact="all">Alle anzeigen</button><button type="button" class="btn sm" data-colact="width">Breiten zurücksetzen</button></div>' +
    '<p class="hint">Breite ändern: Spaltenrand im Kopf ziehen, Doppelklick setzt zurück. Die Einstellung gilt nur für dich.</p>';
}
function initCols() {
  const head = $('hrowL'); if (!head) return;
  const cells = [...head.children];
  cells[0].innerHTML = '<button class="ib" id="foldAll" type="button"></button><button class="ib" id="colBtn" type="button" title="Spalten ein- und ausblenden" aria-haspopup="true" aria-expanded="false">' + icon('cols') + '</button>';
  cells.forEach((cell, k) => { if (k > 0 && COLS[k]) { const h = document.createElement('span'); h.className = 'colrs'; h.dataset.col = COLS[k][0]; h.title = 'Breite ändern (Doppelklick: Standard)'; cell.appendChild(h); } });
  // Breite ziehen
  let d = null;
  head.addEventListener('pointerdown', e => {
    const h = e.target.closest('.colrs'); if (!h) return;
    e.preventDefault(); const c = COLS.find(x => x[0] === h.dataset.col);
    d = { c, x: e.clientX, w: colW(c), pid: e.pointerId }; try { h.setPointerCapture(e.pointerId); } catch (x) { }
    document.body.classList.add('colresize');
  });
  head.addEventListener('pointermove', e => { if (!d || e.pointerId !== d.pid) return; colPrefs().w[d.c[0]] = Math.round(Math.max(28, d.w + e.clientX - d.x)); applyCols(); });
  const up = e => { if (!d || e.pointerId !== d.pid) return; d = null; document.body.classList.remove('colresize'); savePref('tp-cols-v1', colPrefs()); };
  head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
  head.addEventListener('dblclick', e => { const h = e.target.closest('.colrs'); if (!h) return; delete colPrefs().w[h.dataset.col]; savePref('tp-cols-v1', colPrefs()); applyCols(); });
  // Spaltenmenü
  const menu = document.createElement('div'); menu.className = 'colmenu'; menu.id = 'colMenu'; menu.hidden = true; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Spalten');
  document.body.appendChild(menu);
  const btn = $('colBtn');
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (!menu.hidden) { close(); return; }
    menu.innerHTML = colMenuHtml(); menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect(); menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px'; menu.style.top = (r.bottom + 6) + 'px';
    const f = menu.querySelector('input'); if (f) f.focus();
  });
  menu.addEventListener('change', e => {
    const k = e.target.dataset.col; if (!k) return; const p = colPrefs();
    p.hide = p.hide.filter(x => x !== k); if (!e.target.checked) p.hide.push(k);
    savePref('tp-cols-v1', p); applyCols();
  });
  menu.addEventListener('click', e => {
    const a = e.target.dataset.colact; if (!a) return; const p = colPrefs();
    if (a === 'all') p.hide = []; else p.w = {};
    savePref('tp-cols-v1', p); applyCols(); menu.innerHTML = colMenuHtml();
  });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
  $('foldAll').addEventListener('click', () => {
    const sums = state.rows.map((r, i) => i).filter(i => sched.out[i] && sched.out[i].summary);
    const anyOpen = sums.some(i => !folds().has(state.rows[i].id));
    sums.forEach(i => { if (anyOpen) folds().add(state.rows[i].id); else folds().delete(state.rows[i].id); });
    saveFolds(); renderFilteredViews(true);
  });
  applyCols();
}

/* Einklappen der Untervorgänge (je Person und Projekt) */
let foldSet = null, foldProj = null;
function folds() {
  const k = prefKey('tp-fold-v1') + '|' + curId;
  if (!foldSet || foldProj !== k) { foldProj = k; foldSet = new Set((loadPref('tp-fold-v1', {})[curId] || []).map(Number)); }
  return foldSet;
}
function saveFolds() { const all = loadPref('tp-fold-v1', {}); all[curId] = [...folds()]; savePref('tp-fold-v1', all); }
function isFolded(id) { return folds().has(id); }
function filtersActive() { return !!(fQ || fWho || fSt !== 'all'); }
// Untervorgänge eingeklappter Sammelvorgänge ausblenden (bei aktivem Filter bleiben Treffer sichtbar)
function foldFilter(indices) {
  if (!sched || filtersActive()) return indices;
  return indices.filter(i => { const p = sched.parent[i]; return !(p >= 0 && state.rows[p] && folds().has(state.rows[p].id)); });
}
function toggleFold(i) { const id = state.rows[i].id, s = folds(); if (s.has(id)) s.delete(id); else s.add(id); saveFolds(); renderFilteredViews(true); }
function unfoldFor(i) {
  const p = sched && sched.parent[i];
  if (p >= 0 && state.rows[p] && folds().has(state.rows[p].id)) { folds().delete(state.rows[p].id); saveFolds(); return true; }
  return false;
}
function paintFoldAll() {
  const b = $('foldAll'); if (!b || !sched) return;
  const sums = state.rows.filter((r, i) => sched.out[i] && sched.out[i].summary);
  const anyOpen = sums.some(r => !folds().has(r.id));
  b.hidden = !sums.length; b.innerHTML = icon(anyOpen ? 'foldin' : 'foldout');
  b.title = anyOpen ? 'Alle Untervorgänge einklappen' : 'Alle Untervorgänge ausklappen';
}

// Sobald die Person bekannt ist: ihre Spalten und eingeklappten Gruppen anwenden
function prefsForUser() { applyCols(true); if (sched) renderFilteredViews(true); }

/* ---------- Balken im Diagramm ziehen: verschieben oder Anfang/Ende ziehen ---------- */
// Verschieben setzt den festen Start (Dauer bleibt), das rechte Ende ändert die Dauer,
// das linke Ende verschiebt den Start und behält das Ende. Nachfolger rechnen sich automatisch neu.
function workAt(d) { if (!sched.work) return d; let g = 0; while (!sched.isWork(d) && g++ < 400) d++; return d; }
function endFor(S, d) { if (!sched.work) return S + d - 1; let x = workAt(S); for (let c = d - 1, g = 0; c > 0 && g++ < 40000;) { x++; if (sched.isWork(x)) c--; } return x; }
function initBarDrag() {
  const chart = $('chart'); if (!chart) return;
  let d = null;
  const tip = document.createElement('div'); tip.className = 'bartip'; tip.hidden = true; document.body.appendChild(tip);
  const EDGE = 7;
  chart.addEventListener('pointermove', e => {
    if (d) return;
    const g = e.target.closest('g.mv'); if (!g) return;
    const r = g.querySelector('.bar-task, .bar-sub'); if (!r) { g.style.cursor = 'grab'; return; }
    const b = r.getBoundingClientRect();
    g.style.cursor = e.clientX - b.left < EDGE || b.right - e.clientX < EDGE ? 'ew-resize' : 'grab';
  });
  chart.addEventListener('pointerdown', e => {
    const g = e.target.closest('g.mv'); if (!g || readOnly || e.button > 0) return;
    const i = +g.dataset.i, row = state.rows[i], o = sched.out[i]; if (!row || !o || o.summary) return;
    const r = g.querySelector('.bar-task, .bar-sub, .bar-ms'), b = r.getBoundingClientRect();
    const ms = row.type === 'meilenstein';
    const mode = ms ? 'move' : e.clientX - b.left < EDGE ? 'left' : b.right - e.clientX < EDGE ? 'right' : 'move';
    d = { i, g, mode, x0: e.clientX, sl0: $('bodyR').scrollLeft, cx: e.clientX, pid: e.pointerId, dd: 0, started: false, S: o.S, E: o.E, dur: o.dur, rect: r.tagName === 'rect' ? r : null,
      rx: r.tagName === 'rect' ? +r.getAttribute('x') : 0, rw: r.tagName === 'rect' ? +r.getAttribute('width') : 0, ms };
    try { g.setPointerCapture(e.pointerId); } catch (x) { }
  });
  const preview = () => {
    const dw = window.__chartDayW || 26, px = d.dd * dw;
    let S = d.S, E = d.E;
    if (d.mode === 'move') { S = workAt(d.S + d.dd); E = d.ms ? S : endFor(S, d.dur); d.g.setAttribute('transform', 'translate(' + px + ',0)'); }
    else if (d.mode === 'right') {
      E = Math.max(d.S, d.E + d.dd); const w = Math.max(4, d.rw + px);
      d.g.querySelectorAll('rect').forEach(x => { if (x.classList.contains('bar-prog')) return; x.setAttribute('width', Math.max(4, w)); });
    } else {
      S = Math.min(d.E, d.S + d.dd); const nx = d.rx + px, w = Math.max(4, d.rw - px);
      d.g.querySelectorAll('rect').forEach(x => { if (x.classList.contains('bar-prog')) return; x.setAttribute('x', nx); x.setAttribute('width', w); });
    }
    const dur = d.ms ? 0 : spanDays(workAt(S), E);
    tip.textContent = (d.ms ? fmt(S) : fmt(workAt(S)) + ' – ' + fmt(E) + ' · ' + dur + (sched.work ? ' AT' : ' T'));
    d.newS = S; d.newE = E;
  };
  const scroller = $('bodyR'); let raf = 0;
  const update = () => {
    const dx = d.cx - d.x0 + (scroller.scrollLeft - d.sl0);
    d.dd = Math.round(dx / (window.__chartDayW || 26)); preview();
  };
  // Am Rand des Diagramms automatisch weiterscrollen
  const edgeScroll = () => {
    raf = 0; if (!d || !d.started) return;
    const rc = scroller.getBoundingClientRect(), edge = 40;
    let v = 0; if (d.cx > rc.right - edge) v = Math.ceil((d.cx - rc.right + edge) / 3); else if (d.cx < rc.left + edge) v = -Math.ceil((rc.left + edge - d.cx) / 3);
    if (v) { const before = scroller.scrollLeft; scroller.scrollLeft += v; if (scroller.scrollLeft !== before) update(); raf = requestAnimationFrame(edgeScroll); }
  };
  chart.addEventListener('pointermove', e => {
    if (!d || e.pointerId !== d.pid) return;
    d.cx = e.clientX;
    if (!d.started && Math.abs(e.clientX - d.x0) < 4) return;
    if (!d.started) { d.started = true; document.body.classList.add('bardrag'); select(d.i); tip.hidden = false; }
    tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY - 34) + 'px';
    update(); if (!raf) raf = requestAnimationFrame(edgeScroll);
  });
  chart.addEventListener('lostpointercapture', e => { if (d && e.pointerId === d.pid) end({ type: 'pointercancel', pointerId: e.pointerId }); });
  const end = e => {
    if (!d || e.pointerId !== d.pid) return;
    const x = d; d = null; tip.hidden = true; document.body.classList.remove('bardrag'); cancelAnimationFrame(raf); raf = 0;
    if (!x.started || e.type !== 'pointerup') { if (x.started) refresh(); return; }
    x.g.dataset.dragged = '1';
    if (!x.dd) { refresh(); return; }
    const r = state.rows[x.i], before = { fixed: r.fixed, dur: r.dur };
    if (x.mode === 'move') r.fixed = toISO(workAt(x.S + x.dd));
    else if (x.mode === 'right') r.dur = String(Math.max(1, spanDays(x.S, x.newE)));
    else { const S = workAt(x.newS); r.fixed = toISO(S); r.dur = String(Math.max(1, spanDays(S, x.E))); }
    filterEditId = r.id; sched = schedule(state);
    const o = sched.out[x.i], want = x.mode === 'right' ? x.S : workAt(x.mode === 'move' ? x.S + x.dd : x.newS);
    if (o.S > want && o.pred >= 0) {
      toast('Früher geht nicht: Vorgänger ' + state.rows[o.pred].id + ' „' + (state.rows[o.pred].name || 'ohne Namen') + '“ bestimmt den frühesten Start.');
      // Wirkungslosen festen Start nicht speichern (ein geänderte Dauer beim linken Rand schon)
      if (x.mode === 'move') { r.fixed = before.fixed; r.dur = before.dur; }
      else if (x.mode === 'left') { r.fixed = before.fixed; r.dur = String(Math.max(1, spanDays(o.S, x.E))); }
    }
    refresh(); changed(true);
  };
  chart.addEventListener('pointerup', end); chart.addEventListener('pointercancel', end);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && d) { const g = d.g; d = null; tip.hidden = true; document.body.classList.remove('bardrag'); refresh(); } });
  // Ein Klick nach dem Ziehen soll nichts weiter auslösen
  chart.addEventListener('click', e => { const g = e.target.closest('[data-dragged]'); if (g) { delete g.dataset.dragged; e.stopImmediatePropagation(); } }, true);
}
