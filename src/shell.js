/* ---------- Menüleiste, Projektkopf und Kennzahlen (Aufbau wie im Kapazitätsplaner) ---------- */
// Die Menüs rufen dieselben Funktionen auf wie die Knöpfe; Häkchen und gesperrte Einträge
// werden bei jedem Öffnen neu bestimmt, damit sie immer zum aktuellen Stand passen.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const MOD = IS_MAC ? '⌘' : 'Strg+', ALT = IS_MAC ? '⌥' : 'Alt+';
const VIEWS = [['gantt', 'Gantt'], ['list', 'Liste'], ['kanban', 'Kanban'], ['cal', 'Kalender'], ['tasks', 'Aufgaben'], ['org', 'Team']];
const ICON_CHECK = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.2 8.4l3 3 6.6-6.8"/></svg>';
const acct = m => document.querySelector('#userMenu [data-m="' + m + '"]');   // Konto-Funktionen der Webversion
const kpisOn = () => { try { return JSON.parse(localStorage.getItem(LS_UI) || '{}').kpis !== false; } catch (e) { return true; } };
function applyKpis() { const k = $('kpis'); if (k) k.hidden = !kpisOn(); }
function hasView(v) { return !ganttOnly && (v !== 'tasks' || !!$('vTasks')) && (v !== 'org' || !!$('vOrg')); }
function goView(v) { if (v === 'gantt' || hasView(v)) setView(v); }
function inGantt(fn) { return () => { if (view !== 'gantt') setView('gantt'); fn(); }; }
function openFilters(focus) {
  if (view === 'tasks' || view === 'org') setView('gantt');
  $('vfilters').hidden = false; updateFilterUi();
  if (focus) $('fQ').focus();
}
function scrollToToday() {
  if (view !== 'gantt') setView('gantt');
  if (isMobile()) $('tabs').querySelector('[data-tab="chart"]').click();
  const b = $('bodyR'), x = window.__chartTodayX; if (b && typeof x === 'number') b.scrollLeft = Math.max(0, x - b.clientWidth / 3);
}
function openSettingsField(id) { openPanel(); const el = $(id); if (el) setTimeout(() => el.focus(), 30); }

function menuDefs() {
  const ro = readOnly, go = ganttOnly, filt = !$('vfilters').hidden, mode = dispMode(), th = themeMode();
  const chg = $('chgAll'), webAcct = !!acct('logout');
  return [
    ['Datei', [
      { l: 'Neues Projekt', run: newProject, off: ro, hide: go },
      { l: 'Projekt duplizieren', run: duplicateProject, off: ro, hide: go },
      { l: 'Projekt löschen …', run: deleteProject, off: ro, hide: go },
      '-',
      { l: 'PDF exportieren …', k: MOD + 'P', run: () => openPdfDialog() },
      { l: 'Als JSON sichern', run: () => $('expJson').click() },
      { l: 'Als CSV für Excel', run: () => $('expCsv').click() },
      '-',
      { l: 'JSON laden …', run: () => $('impFile').click(), off: ro, hide: go },
      { l: 'Beispielplan laden', run: () => $('loadDemo').click(), off: ro, hide: go },
      { l: 'Leerer Plan', run: () => $('blank').click(), off: ro, hide: go },
      '-',
      { l: 'Als App installieren', run: () => acct('install').click(), hide: !acct('install') },
      { l: 'Abmelden', run: () => acct('logout').click(), hide: !webAcct }
    ]],
    ['Bearbeiten', [
      { l: 'Rückgängig', k: MOD + 'Z', run: undo, off: ro || !hist.length, hide: go },
      '-',
      { l: 'Suchen und filtern', k: MOD + 'F', run: () => openFilters(true), chk: filt },
      { l: 'Filter zurücksetzen', run: () => $('resetFilters').click(), off: $('resetFilters').disabled },
      '-',
      { l: 'Änderungen als gesehen markieren', run: () => chg.click(), off: !chg || chg.hidden, hide: go }
    ]],
    ['Vorgang', [
      { l: 'Neuer Vorgang', run: inGantt(() => addRow('vorgang')), off: ro },
      { l: 'Neuer Untervorgang', run: inGantt(() => addRow('untervorgang')), off: ro },
      { l: 'Neuer Meilenstein', run: inGantt(() => addRow('meilenstein')), off: ro },
      { l: 'Neue Aufgabe', run: () => { setView('tasks'); const n = $('tkNew'); if (n) n.click(); }, off: ro, hide: !hasView('tasks') },
      '-',
      { l: 'Details zum ausgewählten Vorgang', k: ALT + 'Eingabe', run: () => openDetails(sel), off: sel < 0 || !state.rows[sel], hide: go }
    ]],
    ['Ansicht', VIEWS.filter(([v]) => v === 'gantt' || hasView(v)).map(([v, n], k) => ({ l: n, k: ALT + (k + 1), run: () => goView(v), chk: view === v, hide: (go && v !== 'gantt') || isMobile() })).concat([
      '-',
      { l: 'Projektliste', k: MOD + 'B', run: toggleSide, chk: sideOn(), hide: isMobile() },
      { l: 'Kennzahlen', run: () => { saveUi({ kpis: !kpisOn() }); applyKpis(); }, chk: kpisOn() },
      { l: 'Filter', run: () => { if (filt) { $('vfilters').hidden = true; updateFilterUi(); } else openFilters(false); }, chk: filt, hide: view === 'tasks' || view === 'org' },
      '-',
      { l: 'Zeitraster Tage', run: inGantt(() => $('segRaster').querySelector('[data-v="days"]').click()), chk: state.raster !== 'weeks', off: ro },
      { l: 'Zeitraster Wochen', run: inGantt(() => $('segRaster').querySelector('[data-v="weeks"]').click()), chk: state.raster === 'weeks', off: ro },
      { l: 'Vergrößern', run: inGantt(() => $('zoomIn').click()), off: $('zoomIn').disabled },
      { l: 'Verkleinern', run: inGantt(() => $('zoomOut').click()), off: $('zoomOut').disabled },
      { l: 'Zum heutigen Tag', run: scrollToToday },
      { l: 'Abhängigkeitslinien', run: inGantt(() => $('lines').click()), chk: !!state.lines, off: ro },
      '-',
      { l: 'Darstellung: Automatisch', run: () => setDisp('auto'), chk: mode === 'auto' },
      { l: 'Darstellung: Desktop', run: () => setDisp('desktop'), chk: mode === 'desktop' },
      { l: 'Darstellung: Mobil', run: () => setDisp('mobile'), chk: mode === 'mobile' },
      '-',
      { l: 'Farbe: Wie System', run: () => setTheme('auto'), chk: th === 'auto' },
      { l: 'Farbe: Hell', run: () => setTheme('light'), chk: th === 'light' },
      { l: 'Farbe: Dunkel', run: () => setTheme('dark'), chk: th === 'dark' }
    ])],
    ['Extras', [
      { l: 'Listen & Daten …', k: MOD + ',', run: openPanel, hide: go },
      { l: 'Projektstart …', run: () => openSettingsField('pstart'), off: ro, hide: go },
      { l: 'Feiertage und freie Tage …', run: () => openSettingsField('region'), off: ro, hide: go },
      '-',
      { l: 'Dauer in Arbeitstagen', run: () => $('segMode').querySelector('[data-v="work"]').click(), chk: state.mode !== 'cal', off: ro, hide: go },
      { l: 'Dauer in Kalendertagen', run: () => $('segMode').querySelector('[data-v="cal"]').click(), chk: state.mode === 'cal', off: ro, hide: go },
      '-',
      { l: 'Mein Profil und Passwort', run: () => acct('profile').click(), hide: !acct('profile') },
      { l: 'Idee oder Problem melden', run: () => acct('ticket').click(), hide: !acct('ticket') },
      { l: 'Verwaltung', run: () => acct('admin').click(), hide: !acct('admin') }
    ]],
    ['Hilfe', [
      { l: 'Tastenkürzel', run: keysDialog },
      { l: 'Über den Terminplaner', run: aboutDialog },
      { l: 'Datenschutz', run: () => acct('privacy').click(), hide: !acct('privacy') }
    ]]
  ].map(([n, items]) => [n, items.filter(it => it === '-' || !it.hide).filter((it, k, a) => it !== '-' || (k > 0 && a[k - 1] !== '-' && k < a.length - 1))]).filter(([, items]) => items.some(it => it !== '-'));
}

let mbOpen = -1, mbItems = [], mbList = null;
function initMenubar() {
  const bar = $('mbarMenus'); if (!bar) return;
  mbList = document.createElement('div'); mbList.className = 'mb-list'; mbList.setAttribute('role', 'menu'); mbList.hidden = true; document.body.appendChild(mbList);
  const paintTops = () => { bar.innerHTML = menuDefs().map(([n], k) => '<div class="mb-top"><button type="button" role="menuitem" aria-haspopup="menu" aria-expanded="false" data-m="' + k + '" tabindex="' + (k ? -1 : 0) + '">' + esc(n) + '</button></div>').join(''); };
  paintTops();
  const tops = () => [...bar.querySelectorAll('[data-m]')];
  const close = focusTop => {
    if (mbOpen < 0) return; const t = tops()[mbOpen]; mbOpen = -1; mbList.hidden = true;
    tops().forEach(b => { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); });
    if (focusTop && t) t.focus();
  };
  const open = (k, focusFirst) => {
    const defs = menuDefs(); if (tops().length !== defs.length) paintTops();
    k = (k + defs.length) % defs.length; const [name, items] = defs[k]; mbItems = items; mbOpen = k;
    tops().forEach((b, j) => { b.classList.toggle('on', j === k); b.setAttribute('aria-expanded', String(j === k)); b.tabIndex = j === k ? 0 : -1; });
    mbList.setAttribute('aria-label', name);
    mbList.innerHTML = items.map((it, j) => it === '-' ? '<hr>' :
      '<button type="button" role="' + ('chk' in it ? 'menuitemcheckbox' : 'menuitem') + '" data-j="' + j + '"' + ('chk' in it ? ' aria-checked="' + !!it.chk + '"' : '') + (it.off ? ' class="off" aria-disabled="true"' : '') + ' tabindex="-1">' +
      '<span class="mb-chk">' + (it.chk ? ICON_CHECK : '') + '</span><span class="mb-l">' + esc(it.l) + '</span>' + (it.k ? '<kbd>' + esc(it.k) + '</kbd>' : '') + '</button>').join('');
    mbList.hidden = false;
    // Fest positioniert, damit die Liste auch bei waagerecht scrollender Leiste (Handy) nicht abgeschnitten wird
    const r = tops()[k].getBoundingClientRect(), w = document.documentElement.clientWidth, top = $('mbar').getBoundingClientRect().bottom + 4;
    mbList.style.top = top + 'px'; mbList.style.maxHeight = (innerHeight - top - 8) + 'px';
    if (isMobile()) { mbList.style.left = '8px'; mbList.style.right = '8px'; }
    else { mbList.style.right = 'auto'; mbList.style.left = Math.max(8, Math.min(r.left, w - mbList.offsetWidth - 8)) + 'px'; }
    if (focusFirst) { const f = mbList.querySelector('button:not(.off)'); if (f) f.focus(); }
  };
  const run = j => { const it = mbItems[j]; if (!it || it === '-' || it.off) return; close(false); try { it.run(); } catch (e) { console.error(e); } };
  bar.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; const k = +b.dataset.m; if (mbOpen === k) close(false); else open(k, e.detail === 0); });
  bar.addEventListener('mouseover', e => { const b = e.target.closest('[data-m]'); if (b && mbOpen >= 0 && +b.dataset.m !== mbOpen) open(+b.dataset.m, false); });
  bar.addEventListener('keydown', e => {
    const b = e.target.closest('[data-m]'); if (!b) return; const k = +b.dataset.m, all = tops();
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = (k + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length; if (mbOpen >= 0) open(n, true); else { all.forEach((x, j) => x.tabIndex = j === n ? 0 : -1); all[n].focus(); } }
    else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(k, true); }
    else if (e.key === 'Escape') { close(false); b.blur(); }
  });
  mbList.addEventListener('click', e => { const b = e.target.closest('[data-j]'); if (b) run(+b.dataset.j); });
  mbList.addEventListener('keydown', e => {
    const bs = [...mbList.querySelectorAll('button:not(.off)')], i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]; if (n) n.focus(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); open(mbOpen + (e.key === 'ArrowRight' ? 1 : -1), true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close(false);
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); const n = e.key === 'Home' ? bs[0] : bs[bs.length - 1]; if (n) n.focus(); }
  });
  document.addEventListener('pointerdown', e => { if (mbOpen >= 0 && !mbList.contains(e.target) && !bar.contains(e.target)) close(false); });
  window.addEventListener('resize', () => close(false));
  window.addEventListener('blur', () => close(false));

  // Tastenkürzel (nur solche, die der Browser nicht selbst belegt)
  let altOnly = false;
  document.addEventListener('keydown', e => {
    altOnly = e.key === 'Alt' && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (e.defaultPrevented || document.querySelector('.scrim:not([hidden]) .panel') && !e.target.closest('.mbar, .mb-list')) return;
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey, key = e.key.toLowerCase();
    if (mod && key === 'f' && !$('toggleFilters').hidden) { e.preventDefault(); close(false); openFilters(true); }
    else if (mod && key === 'p') { e.preventDefault(); close(false); openPdfDialog(); }
    else if (mod && key === 'b' && !isMobile()) { e.preventDefault(); toggleSide(); }
    else if (mod && e.key === ',' && !ganttOnly) { e.preventDefault(); close(false); openPanel(); }
    else if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-6]$/.test(e.code)) {
      const vs = VIEWS.filter(([v]) => v === 'gantt' || hasView(v)), v = vs[+e.code.slice(5) - 1]; if (v) { e.preventDefault(); close(false); goView(v[0]); }
    }
    else if (e.altKey && e.key === 'Enter' && !ganttOnly && sel >= 0) { e.preventDefault(); openDetails(sel); }
  });
  // Alt allein: in die Menüleiste wechseln (wie in Windows-Programmen)
  document.addEventListener('keyup', e => {
    if (e.key !== 'Alt' || !altOnly) return; altOnly = false;
    if (mbOpen >= 0) { close(false); return; }
    if (document.querySelector('.scrim:not([hidden]) .panel')) return;
    e.preventDefault(); const t = tops()[0]; if (t) t.focus();
  });
  document.addEventListener('pointerdown', () => { altOnly = false; }, true);
}

/* ---------- Kleine Hilfe-Fenster ---------- */
function infoDialog(title, html) {
  const s = document.createElement('div'); s.className = 'scrim'; s.innerHTML = '<div class="panel info" role="dialog" aria-modal="true" aria-labelledby="infoT"><div class="head"><h2 id="infoT">' + esc(title) + '</h2><button class="btn" type="button" data-x>Schließen</button></div>' + html + '</div>';
  const prev = document.activeElement, close = () => { s.remove(); document.removeEventListener('keydown', key, true); if (prev && prev.focus) prev.focus(); };
  const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  s.addEventListener('click', e => { if (e.target === s || e.target.closest('[data-x]')) close(); });
  document.addEventListener('keydown', key, true); document.body.appendChild(s); s.querySelector('[data-x]').focus();
}
function keysDialog() {
  const k = [['Rückgängig', MOD + 'Z'], ['Suchen und filtern', MOD + 'F'], ['PDF exportieren', MOD + 'P'], ['Projektliste ein/aus', MOD + 'B'], ['Listen & Daten', MOD + ','],
    ['Details zum ausgewählten Vorgang', ALT + 'Eingabe'], ['Menüleiste', 'Alt'], ['Im Menü bewegen', 'Pfeiltasten']]
    .concat(VIEWS.filter(([v]) => v === 'gantt' || hasView(v)).map(([, n], j) => ['Ansicht ' + n, ALT + (j + 1)]));
  infoDialog('Tastenkürzel', '<dl class="keys">' + k.map(([a, b]) => '<div><dt>' + esc(a) + '</dt><dd><kbd>' + esc(b) + '</kbd></dd></div>').join('') + '</dl>' +
    '<p class="hint">In der Tabelle: Tab und Umschalt+Tab wechseln die Felder, Eingabe übernimmt den Wert.</p>');
}
function aboutDialog() {
  infoDialog('Terminplaner', '<p>Gemeinsame Termin- und Aufgabenplanung: Gantt, Liste, Kanban, Kalender, Aufgaben und Organigramm. Änderungen werden automatisch gespeichert und mit dem Team abgeglichen.</p>' +
    '<p class="hint">Schrift: Figtree (SIL Open Font License 1.1).</p>');
}

/* ---------- Projektkopf und Kennzahlen ---------- */
function planEnd() { let E = sched.P; sched.out.forEach(o => { if (o.E > E) E = o.E; }); return E; }
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
function paintKpis() {
  if (!sched || !$('kpis')) return;
  const t = todayDn(), P = sched.P, E = planEnd(), p = projectProgress();
  const leaf = state.rows.map((_, i) => i).filter(i => sched.out[i] && !sched.out[i].summary);
  const late = leaf.filter(isLate), w0 = mondayOf(t), w1 = w0 + 6;
  const week = leaf.filter(i => !isDone(i) && sched.out[i].S <= w1 && sched.out[i].E >= w0);
  const set = (id, b, sm, bad) => { const el = $(id); if (!el) return; el.querySelector('b').textContent = b; el.querySelector('small').textContent = sm; el.classList.toggle('bad', !!bad); };
  // Projektzeit
  let b;
  if (!leaf.length) b = 'Noch keine Vorgänge';
  else if (p >= 100) b = 'Abgeschlossen';
  else if (t < P) b = 'Beginnt in ' + plural(P - t, 'Tag', 'Tagen');
  else if (t > E) b = plural(t - E, 'Tag', 'Tage') + ' über Ende';
  else b = 'Tag ' + (t - P + 1) + ' von ' + (E - P + 1);
  set('kpiTime', b, fmtLong(P) + ' – ' + fmtLong(E) + ' · ' + p + ' % erledigt', leaf.length && p < 100 && t > E);
  set('kpiLate', plural(late.length, 'Vorgang', 'Vorgänge'), late.length ? late.slice(0, 3).map(i => state.rows[i].name || 'ohne Namen').join(', ') : 'Nichts überfällig', late.length);
  $('kpiLate').classList.toggle('on', fSt === 'late');
  set('kpiWeek', plural(week.length, 'Vorgang', 'Vorgänge'), 'KW ' + isoWeek(t) + ', noch nicht erledigt');
  const tk = $('kpiTasks');
  if (tk) {
    tk.hidden = !hasView('tasks');
    const all = tasks(), open = all.filter(x => !x.done), tl = open.filter(taskLate).length;
    set('kpiTasks', String(open.length), all.length ? 'von ' + all.length + (tl ? ' · ' + tl + ' überfällig' : '') : 'Noch keine Aufgaben', tl);
  }
  paintHead(p, late.length, E, leaf.length);
}
function paintHead(p, nLate, E, nLeaf) {
  const pill = $('projPill'), meta = $('headMeta'); if (!pill || !meta) return;
  const t = todayDn(), P = sched.P;
  const st = !nLeaf ? null : p >= 100 ? ['Erledigt', 'done'] : t < P ? ['Geplant', 'plan'] : nLate ? ['Verzug', 'late'] : ['Läuft', 'run'];
  pill.hidden = !st; if (st) { pill.textContent = st[0]; pill.className = 'pill st-' + st[1]; }
  meta.textContent = 'Start ' + fmt(P) + ' · Ende ' + fmt(E) + ' · ' + plural(nLeaf, 'Vorgang', 'Vorgänge') + ' · Dauer in ' + (state.mode === 'cal' ? 'Kalendertagen' : 'Arbeitstagen') + (state.region ? ' · Feiertage ' + regionName(state.region) : '');
}
function initKpis() {
  applyKpis();
  $('kpiLate').addEventListener('click', () => {
    if (view !== 'gantt' && view !== 'list') setView('gantt');
    $('vfilters').hidden = false; updateFilterUi();
    const s = $('fSt'); s.value = fSt === 'late' ? 'all' : 'late'; s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  $('kpiWeek').addEventListener('click', () => { goView('cal'); });
  $('kpiTasks').addEventListener('click', () => goView('tasks'));
}
