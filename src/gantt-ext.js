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
