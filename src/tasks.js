/* ---------- Aufgaben: eigene Rubrik für To-dos mit Zuständigen, Termin und Priorität ---------- */
// Aufgaben gehören zum Projekt (state.tasks) und werden mit dem Plan gespeichert und abgeglichen.
// Zuständige nutzen dasselbe Modell wie die Verantwortlichen der Vorgänge (assignees mit Benutzer-ID).
const PRIOS = { hoch: 'Hoch', normal: 'Normal', niedrig: 'Niedrig' };
let tkSt = 'open', tkWho = '', tkQ = '', tkDlg = null;

function tasks() { if (!Array.isArray(state.tasks)) state.tasks = []; return state.tasks; }
function taskById(id) { return tasks().find(t => t.id === id) || null; }
function meUser() { return typeof window.TP_ME === 'function' ? window.TP_ME() : null; }
function taskMine(t, me = meUser()) {
  if (!me) return false;
  return assigneeEntries(t).some(e => (e.id && String(e.id) === String(me.id)) || (!e.id && e.name.toLowerCase() === String(me.name || '').toLowerCase()));
}
function taskDue(t) { return t.due ? parseISO(t.due) : null; }
function taskLate(t) { const d = taskDue(t); return !t.done && d != null && d < todayDn(); }
function taskRowIdx(t) { return t.row === '' || t.row == null ? -1 : state.rows.findIndex(r => r.id === t.row); }
function dueTxt(t) {
  const d = taskDue(t); if (d == null) return '';
  const n = d - todayDn();
  return fmt(d) + (t.done ? '' : n === 0 ? ' · heute' : n === 1 ? ' · morgen' : n < 0 ? ' · ' + (-n) + ' T überfällig' : n <= 7 ? ' · in ' + n + ' T' : '');
}
function setTaskAssignees(t, entries) {
  if (readOnly) return;
  if (hasUserDirectory()) { t.assignees = sanitizeAssignees(entries); t.who = t.assignees.map(e => e.name).join(', '); }
  else { t.who = sanitizeAssignees(entries).map(e => e.name).join(', '); delete t.assignees; }
}
function newTask(preset) {
  if (readOnly) return null;
  if (!state.nextTaskId || state.nextTaskId < 1) state.nextTaskId = 1;
  // Zufällige Nummer: zwei Teammitglieder, die gleichzeitig eine Aufgabe anlegen, bekommen keine gleiche Nummer
  const used = new Set(tasks().map(t => t.id)); let id;
  do { id = 100000 + Math.floor(Math.random() * 900000); } while (used.has(id));
  const me = meUser();
  const t = { id, title: '', desc: '', who: '', due: '', prio: 'normal', done: false, row: '', by: me ? me.name : '', created: new Date().toISOString().slice(0, 10), ...(preset || {}) };
  tasks().push(t);
  return t;
}
function taskChanged(force) { changed(force); renderView(); paintTaskBadge(); if (tkDlg && tkDlg.paint) tkDlg.paint(); }

// Zähler am Reiter: offene Aufgaben (eigene, sonst alle)
function paintTaskBadge() {
  const b = document.querySelector('#segView button[data-v="tasks"]'); if (!b) return;
  const me = meUser(), open = tasks().filter(t => !t.done && (!me || taskMine(t, me)));
  const late = open.some(taskLate);
  const lbl = b.querySelector('.vlbl') || b; lbl.innerHTML = 'Aufgaben' + (open.length ? '<span class="tkbadge' + (late ? ' late' : '') + '" title="' + (me ? 'Meine offenen Aufgaben' : 'Offene Aufgaben') + (late ? ', davon überfällige' : '') + '">' + open.length + '</span>' : '');
}

function taskMatches(t, me) {
  if (tkSt === 'open' && t.done) return false;
  if (tkSt === 'done' && !t.done) return false;
  if (tkWho === 'me') { if (!taskMine(t, me)) return false; }
  else if (tkWho === 'none') { if (assigneeEntries(t).length) return false; }
  else if (tkWho.startsWith('user:')) { if (!assigneeEntries(t).some(e => e.id === tkWho.slice(5))) return false; }
  else if (tkWho.startsWith('name:')) { if (!assigneeEntries(t).some(e => e.name.toLowerCase() === tkWho.slice(5).toLowerCase())) return false; }
  if (tkQ) {
    const k = taskRowIdx(t), hay = (t.title + ' ' + t.desc + ' ' + assigneeNames(t) + ' ' + (k >= 0 ? state.rows[k].name : '')).toLowerCase();
    if (!hay.includes(tkQ.toLowerCase())) return false;
  }
  return true;
}
function taskPeople() {
  const m = new Map();
  if (hasUserDirectory()) assigneeTeam().forEach(u => m.set('user:' + u.id, { key: 'user:' + u.id, name: u.name, id: u.id }));
  else state.people.forEach(n => m.set('name:' + n.toLowerCase(), { key: 'name:' + n, name: n }));
  tasks().forEach(t => assigneeEntries(t).forEach(e => { const k = e.id ? 'user:' + e.id : 'name:' + e.name.toLowerCase(); if (!m.has(k)) m.set(k, { key: e.id ? 'user:' + e.id : 'name:' + e.name, name: e.name, id: e.id }); }));
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function taskItem(t) {
  const k = taskRowIdx(t), ents = assigneeEntries(t), late = taskLate(t);
  return '<article class="tki' + (t.done ? ' done' : '') + (late ? ' late' : '') + ' p-' + t.prio + '" data-tid="' + t.id + '">' +
    '<label class="tkchk" title="' + (t.done ? 'Wieder öffnen' : 'Als erledigt markieren') + '"><input type="checkbox" data-tdone="' + t.id + '"' + (t.done ? ' checked' : '') + (readOnly ? ' disabled' : '') + '><span></span></label>' +
    '<div class="tkmain"><button type="button" class="tkt" data-topen="' + t.id + '">' + esc(t.title || 'Ohne Titel') + '</button>' +
    ((t.desc || '').trim() ? '<div class="tkd">' + esc(t.desc.trim().slice(0, 160)) + (t.desc.trim().length > 160 ? ' …' : '') + '</div>' : '') +
    '<div class="tkm">' + (t.prio !== 'normal' ? '<span class="tkp ' + t.prio + '">' + PRIOS[t.prio] + '</span>' : '') +
    (t.due ? '<span class="tkdue' + (late ? ' late' : '') + '">' + esc(dueTxt(t)) + '</span>' : '') +
    (k >= 0 ? '<button type="button" class="tkrow" data-trow="' + k + '" title="Vorgang öffnen">' + esc(sched.psp[k] + ' ' + (state.rows[k].name || 'ohne Namen')) + '</button>' : '') + '</div></div>' +
    '<div class="tkwho">' + (ents.length ? ents.map(e => '<span class="tkper" title="' + esc(e.name) + '">' + avs(e.name) + '<span>' + esc(e.name) + '</span></span>').join('') : '<span class="none">nicht zugewiesen</span>') + '</div></article>';
}

function renderTasks() {
  const box = $('vTasks'); if (!box || !sched) return;
  const me = meUser(), all = tasks();
  if (tkWho === 'me' && !me) tkWho = '';
  const people = taskPeople();
  const shown = all.filter(t => taskMatches(t, me));
  const today = todayDn();
  const groups = tkSt === 'done' ? [['Erledigt', shown]] : [
    ['Überfällig', shown.filter(t => !t.done && taskLate(t))],
    ['Diese Woche', shown.filter(t => !t.done && !taskLate(t) && taskDue(t) != null && taskDue(t) <= today + 7)],
    ['Später', shown.filter(t => !t.done && taskDue(t) != null && taskDue(t) > today + 7)],
    ['Ohne Termin', shown.filter(t => !t.done && taskDue(t) == null)],
    ['Erledigt', shown.filter(t => t.done)]
  ];
  const rank = { hoch: 0, normal: 1, niedrig: 2 };
  const sortT = (a, b) => (taskDue(a) ?? 1e9) - (taskDue(b) ?? 1e9) || rank[a.prio] - rank[b.prio] || a.id - b.id;
  // Auslastung: offene Aufgaben je Person
  const load = people.map(p => {
    const open = all.filter(t => !t.done && assigneeEntries(t).some(e => p.id ? e.id === p.id : e.name.toLowerCase() === p.name.toLowerCase()));
    return { ...p, n: open.length, late: open.filter(taskLate).length };
  });
  const unassigned = all.filter(t => !t.done && !assigneeEntries(t).length).length;
  const opt = (v, t) => '<option value="' + esc(v) + '"' + (tkWho === v ? ' selected' : '') + '>' + esc(t) + '</option>';
  let h = '<div class="tk"><div class="tkbar">' +
    (readOnly ? '' : '<button type="button" class="btn primary" id="tkNew">+ Aufgabe</button>') +
    '<div class="seg" id="tkSt" role="group" aria-label="Status">' + [['open', 'Offen'], ['done', 'Erledigt'], ['all', 'Alle']].map(([v, t]) => '<button type="button" data-v="' + v + '" aria-pressed="' + (tkSt === v) + '">' + t + '</button>').join('') + '</div>' +
    '<select class="in" id="tkWho" aria-label="Nach Person filtern">' + opt('', 'Alle Personen') + (me ? opt('me', 'Meine Aufgaben') : '') + people.map(p => opt(p.key, p.name)).join('') + opt('none', 'Nicht zugewiesen') + '</select>' +
    '<input class="in" type="search" id="tkQ" placeholder="Aufgaben durchsuchen" autocomplete="off" value="' + esc(tkQ) + '">' +
    '<span class="spacer"></span><span class="tksum">' + all.filter(t => !t.done).length + ' offen · ' + all.filter(t => t.done).length + ' erledigt</span></div>';
  if (load.some(p => p.n) || unassigned) {
    h += '<div class="tkload" aria-label="Offene Aufgaben je Person">' + load.filter(p => p.n).map(p =>
      '<button type="button" class="tkl' + (tkWho === p.key ? ' on' : '') + '" data-tkwho="' + esc(p.key) + '">' + avs(p.name) + '<span class="nm">' + esc(p.name) + '</span><b>' + p.n + '</b>' + (p.late ? '<span class="lt">' + p.late + ' überfällig</span>' : '') + '</button>').join('') +
      (unassigned ? '<button type="button" class="tkl' + (tkWho === 'none' ? ' on' : '') + '" data-tkwho="none"><span class="nm">Nicht zugewiesen</span><b>' + unassigned + '</b></button>' : '') + '</div>';
  }
  if (!all.length) h += '<div class="empty"><b>Noch keine Aufgaben.</b><br>Lege mit „+ Aufgabe“ To-dos an, weise sie Teammitgliedern zu und verknüpfe sie bei Bedarf mit einem Vorgang.</div>';
  else if (!shown.length) h += '<div class="empty">Keine Aufgabe passt zur Auswahl.</div>';
  groups.forEach(([title, list]) => {
    if (!list.length) return;
    h += '<section class="tkg"><h3>' + esc(title) + ' <span>' + list.length + '</span></h3>' + list.slice().sort(sortT).map(taskItem).join('') + '</section>';
  });
  box.innerHTML = h + '</div>';
}

/* ---------- Dialog ---------- */
function closeTask() {
  if (!tkDlg) return;
  const t = taskById(tkDlg.id);
  // Geänderte Zuständige: der Server benachrichtigt neu zugewiesene Personen beim nächsten Speichern
  if (t && t.title.trim() && !t.done && JSON.stringify(assigneeEntries(t).map(e => e.id || e.name)) !== tkDlg.whoAtOpen) {
    if (!(window.__tpNotify instanceof Set)) window.__tpNotify = new Set();
    window.__tpNotify.add(curId + ':' + t.id); scheduleSave();
  }
  // Leere neue Aufgabe wieder verwerfen
  if (t && tkDlg.fresh && !t.title.trim() && !t.desc.trim() && !assigneeEntries(t).length && !t.due) { state.tasks = tasks().filter(x => x !== t); taskChanged(true); }
  tkDlg.el.remove(); document.removeEventListener('keydown', tkKey); tkDlg = null;
}
function tkKey(e) { if (e.key === 'Escape' && tkDlg) closeTask(); }
function openTask(id, fresh) {
  closeTask(); if (typeof closeDetails === 'function') closeDetails();
  const t0 = taskById(id); if (!t0) return;
  const ro = readOnly, s = document.createElement('div'); s.className = 'scrim'; s.id = 'tkScrim';
  s.innerHTML = '<div class="panel det" role="dialog" aria-modal="true" aria-labelledby="tkTitle">' +
    '<div class="head"><div class="dh"><span class="psp">Aufgabe</span><h2 id="tkTitle"></h2></div><button class="btn" type="button" data-x>Schließen</button></div>' +
    '<p class="dmeta" id="tkMeta"></p>' +
    '<label class="pf">Titel<input class="in" id="tTitle" maxlength="200" placeholder="Was ist zu tun?"' + (ro ? ' disabled' : '') + '></label>' +
    '<div class="pf"><span>Zuständig</span><div class="people" id="tWho"></div>' +
    (ro ? '' : '<div class="addp">' + (hasUserDirectory() ? '<select class="in" id="tWhoAdd" aria-label="Person zuweisen"></select>' : '<input class="in" id="tWhoAdd" list="peopleList" placeholder="Person zuweisen …" autocomplete="off">') + '<button class="btn" type="button" id="tWhoBtn">Zuweisen</button></div>') + '</div>' +
    '<div class="dgrid3">' +
    '<label class="pf">Fällig am<input class="in" type="date" id="tDue"' + (ro ? ' disabled' : '') + '></label>' +
    '<label class="pf">Priorität<select class="in" id="tPrio"' + (ro ? ' disabled' : '') + '>' + Object.keys(PRIOS).map(k => '<option value="' + k + '">' + PRIOS[k] + '</option>').join('') + '</select></label>' +
    '<label class="pf">Gehört zu Vorgang<select class="in" id="tRow"' + (ro ? ' disabled' : '') + '></select></label></div>' +
    '<label class="pf">Beschreibung<textarea class="in" id="tDesc" rows="5" maxlength="4000" placeholder="Details, Hinweise, Links …"' + (ro ? ' disabled' : '') + '></textarea></label>' +
    '<label class="chk"><input type="checkbox" id="tDone"' + (ro ? ' disabled' : '') + '> Erledigt</label>' +
    '<div class="btns">' + (ro ? '' : '<button class="btn danger" type="button" id="tDel">Aufgabe löschen</button>') + '<span class="spacer"></span><button class="btn primary" type="button" data-x>Fertig</button></div>' +
    '<p class="hint">' + (hasUserDirectory() ? 'Neu zugewiesene Personen bekommen eine E-Mail, sofern sie eine Adresse hinterlegt haben. Zwei Tage vor dem Termin folgt eine Erinnerung.' : 'Änderungen werden automatisch für alle gespeichert.') + '</p></div>';
  document.body.appendChild(s);
  tkDlg = { id, el: s, fresh: !!fresh, whoAtOpen: JSON.stringify(assigneeEntries(t0).map(e => e.id || e.name)) };
  document.addEventListener('keydown', tkKey);
  const q = sel => s.querySelector(sel), cur = () => taskById(id);
  const save = (fn, force) => { const t = cur(); if (!t || readOnly) return; fn(t); taskChanged(force); };
  const paint = () => {
    const t = cur(); if (!t) { closeTask(); return; }
    q('#tkTitle').textContent = t.title || 'Neue Aufgabe';
    q('#tkMeta').textContent = [t.by ? 'angelegt von ' + t.by : '', t.created ? 'am ' + fmtLong(parseISO(t.created)) : '', taskLate(t) ? 'überfällig' : '', t.done ? 'erledigt' : ''].filter(Boolean).join(' · ');
    const ents = assigneeEntries(t);
    q('#tWho').innerHTML = ents.length ? ents.map((e, j) => '<span class="pchip">' + avs(e.name) + esc(e.name) + (ro ? '' : '<button type="button" class="ib" data-rm="' + j + '" aria-label="' + esc(e.name) + ' entfernen">×</button>') + '</span>').join('') : '<span class="hint">Noch niemand zugewiesen.</span>';
    const add = q('#tWhoAdd');
    if (add && add.tagName === 'SELECT') {
      const have = new Set(ents.filter(e => e.id).map(e => e.id)), me = meUser();
      const free = assigneeTeam().filter(u => !have.has(u.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
      add.innerHTML = '<option value="">Person auswählen …</option>' + free.map(u => '<option value="' + esc(u.id) + '">' + esc(u.name) + (me && String(me.id) === u.id ? ' (ich)' : '') + '</option>').join('');
      add.disabled = q('#tWhoBtn').disabled = !free.length;
    }
    const rs = q('#tRow'), rv = t.row === '' ? '' : String(t.row);
    rs.innerHTML = '<option value="">– keiner –</option>' + state.rows.map((r, k) => '<option value="' + r.id + '">' + esc(sched.psp[k] + ' ' + (r.name || 'ohne Namen')) + '</option>').join('');
    rs.value = rv;
  };
  tkDlg.paint = () => { if (document.activeElement && s.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox') { q('#tkTitle').textContent = (cur() || {}).title || 'Neue Aufgabe'; return; } fill(); };
  const fill = () => { const t = cur(); if (!t) return; q('#tTitle').value = t.title; q('#tDesc').value = t.desc; q('#tDue').value = t.due; q('#tPrio').value = t.prio; q('#tDone').checked = !!t.done; paint(); };
  fill();
  q('#tTitle').addEventListener('input', e => save(t => { t.title = e.target.value.slice(0, 200); }));
  q('#tDesc').addEventListener('input', e => save(t => { t.desc = e.target.value.slice(0, 4000); }));
  q('#tDue').addEventListener('change', e => save(t => { t.due = parseISO(e.target.value) != null ? e.target.value : ''; }, true));
  q('#tPrio').addEventListener('change', e => save(t => { t.prio = PRIOS[e.target.value] ? e.target.value : 'normal'; }, true));
  q('#tRow').addEventListener('change', e => save(t => { t.row = e.target.value === '' ? '' : Number(e.target.value); }, true));
  q('#tDone').addEventListener('change', e => save(t => { t.done = e.target.checked; }, true));
  const addPerson = () => {
    const f = q('#tWhoAdd'), v = (f.value || '').trim(), t = cur(); if (!v || !t || readOnly) return;
    const ents = assigneeEntries(t).map(({ id, name }) => ({ id, name }));
    if (f.tagName === 'SELECT') { const u = assigneeTeam().find(x => x.id === v); if (!u) return; ents.push({ id: u.id, name: u.name }); }
    else if (!ents.some(e => e.name.toLowerCase() === v.toLowerCase())) ents.push({ id: null, name: v });
    setTaskAssignees(t, ents); taskChanged(true); f.value = ''; f.focus();
  };
  if (q('#tWhoBtn')) { q('#tWhoBtn').addEventListener('click', addPerson); q('#tWhoAdd').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPerson(); } }); }
  q('#tWho').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]'), t = cur(); if (!b || !t || readOnly) return;
    const ents = assigneeEntries(t).map(({ id, name }) => ({ id, name })); ents.splice(+b.dataset.rm, 1);
    setTaskAssignees(t, ents); taskChanged(true);
  });
  if (q('#tDel')) q('#tDel').addEventListener('click', e => {
    const b = e.currentTarget;
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Wirklich löschen?'; return; }
    state.tasks = tasks().filter(x => x.id !== id); tkDlg.fresh = false; closeTask(); taskChanged(true);
  });
  s.addEventListener('click', e => { if (e.target === s || e.target.closest('[data-x]')) closeTask(); });
  (ro ? q('[data-x]') : fresh ? q('#tTitle') : q('#tTitle')).focus();
}

// Im Detailfenster eines Vorgangs: verknüpfte Aufgaben
function paintDetTasks(box, rowId) {
  if (!box) return;
  const list = tasks().filter(t => t.row === rowId);
  box.innerHTML = '<h3>Aufgaben <span class="hint">' + (list.length ? list.filter(t => !t.done).length + ' offen' : '') + '</span></h3>' +
    (list.length ? list.map(t => '<button type="button" class="dtk' + (t.done ? ' done' : '') + (taskLate(t) ? ' late' : '') + '" data-topen="' + t.id + '"><i>' + (t.done ? '✓' : '○') + '</i><span>' + esc(t.title || 'Ohne Titel') + '</span><em>' + esc(assigneeNames(t) || 'nicht zugewiesen') + (t.due ? ' · ' + fmt(taskDue(t)) : '') + '</em></button>').join('') : '') +
    (readOnly ? '' : '<button type="button" class="btn sm" data-tnewrow="' + rowId + '">+ Aufgabe zu diesem Vorgang</button>');
}

function initTasks() {
  const box = $('vTasks'); if (!box) return;
  box.addEventListener('click', e => {
    const n = e.target.closest('#tkNew'); if (n) { const t = newTask(); if (t) { taskChanged(true); openTask(t.id, true); } return; }
    const sb = e.target.closest('#tkSt button'); if (sb) { tkSt = sb.dataset.v; renderTasks(); return; }
    const w = e.target.closest('[data-tkwho]'); if (w) { tkWho = tkWho === w.dataset.tkwho ? '' : w.dataset.tkwho; renderTasks(); return; }
    const o = e.target.closest('[data-topen]'); if (o) { openTask(+o.dataset.topen); return; }
    const r = e.target.closest('[data-trow]'); if (r) { openDetails(+r.dataset.trow); return; }
  });
  box.addEventListener('change', e => {
    if (e.target.id === 'tkWho') { tkWho = e.target.value; renderTasks(); return; }
    const d = e.target.closest('[data-tdone]'); if (d && !readOnly) { const t = taskById(+d.dataset.tdone); if (t) { t.done = d.checked; taskChanged(true); } }
  });
  box.addEventListener('input', e => { if (e.target.id === 'tkQ') { tkQ = e.target.value.trim(); const pos = e.target.selectionStart; renderTasks(); const f = $('tkQ'); if (f) { f.focus(); try { f.setSelectionRange(pos, pos); } catch (x) { } } } });
  // Aus dem Detailfenster eines Vorgangs
  document.addEventListener('click', e => {
    if (!e.target.closest('#detScrim')) return;
    const o = e.target.closest('[data-topen]'); if (o) { openTask(+o.dataset.topen); return; }
    const nr = e.target.closest('[data-tnewrow]'); if (nr) { const t = newTask({ row: +nr.dataset.tnewrow }); if (t) { taskChanged(true); openTask(t.id, true); } }
  });
  // Direktlink aus E-Mails: #t=<Projekt>:<Nr>
  const prev = window.__deepLink;
  window.__deepLink = async () => {
    const m = /^#t=([A-Za-z0-9_-]{1,64}):(\d+)$/.exec(location.hash || '');
    if (!m) { if (prev) return prev(); return; }
    history.replaceState(null, '', location.pathname + location.search);
    if (m[1] !== curId && proj.has(m[1])) await switchTo(m[1]);
    setView('tasks'); if (taskById(+m[2])) openTask(+m[2]);
  };
  paintTaskBadge();
}
function tasksAfterRender() { paintTaskBadge(); if (tkDlg && tkDlg.paint) tkDlg.paint(); }
