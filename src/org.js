/* ---------- Organigramm: Personen und Unterteams als Baum, je Projekt gespeichert ---------- */
// Knoten: { id, kind: 'person'|'team', name, role, uid (Benutzerkonto), photo (data-URL), parent (id oder ''), color }
const ORG_COLORS = ['#3d7e5e', '#2f6fb2', '#8a5cb8', '#b0612a', '#2a8c8c', '#a33f6d', '#5f6f2a'];
let orgDlg = null, orgDragId = null;

function orgNodes() { if (!Array.isArray(state.org)) state.org = []; return state.org; }
function orgById(id) { return orgNodes().find(n => n.id === id) || null; }
// Wirksamer Vorgesetzter: fehlende oder zirkuläre Verweise machen den Knoten zur obersten Ebene
function orgParent(n) {
  if (n.parent === '' || n.parent == null) return null;
  const seen = new Set([n.id]); let p = orgById(n.parent);
  for (let q = p; q; q = q.parent === '' ? null : orgById(q.parent)) { if (seen.has(q.id)) return null; seen.add(q.id); }
  return p;
}
function orgKids(id) { return orgNodes().filter(n => { const p = orgParent(n); return id == null ? !p : p && p.id === id; }); }
function orgDescendants(id) { const out = new Set(), walk = k => orgKids(k).forEach(c => { if (!out.has(c.id)) { out.add(c.id); walk(c.id); } }); walk(id); return out; }
const orgInitials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const orgHue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return ORG_COLORS[h % ORG_COLORS.length]; };
function orgMember(n) { return n.uid && hasUserDirectory() ? assigneeTeam().find(u => String(u.id) === String(n.uid)) || null : null; }
function orgPhoto(n) { const m = orgMember(n); return n.photo || (m && m.avatar) || ''; }
function orgName(n) { const m = orgMember(n); return (n.name || (m && m.name) || '').trim(); }
function orgAvatar(n, cls) {
  const url = orgPhoto(n), name = orgName(n) || (n.kind === 'team' ? 'Team' : '?');
  return url ? '<img class="oav ' + (cls || '') + '" src="' + esc(url) + '" alt="">' : '<span class="oav ini ' + (cls || '') + '" style="background:' + orgHue(name) + '" aria-hidden="true">' + esc(orgInitials(name)) + '</span>';
}
// Offene Vorgänge und Aufgaben einer Person (über Benutzerkonto, sonst über den Namen)
function orgLoad(n) {
  const name = orgName(n).toLowerCase(); if (!name && !n.uid) return { rows: 0, tasks: 0 };
  const hit = e => (n.uid && e.id && String(e.id) === String(n.uid)) || (!e.id || !n.uid) && e.name.toLowerCase() === name;
  let rows = 0, tasks = 0;
  if (sched) state.rows.forEach((r, i) => { if (!sched.out[i].summary && !isDone(i) && assigneeEntries(r).some(hit)) rows++; });
  (state.tasks || []).forEach(t => { if (!t.done && assigneeEntries(t).some(hit)) tasks++; });
  return { rows, tasks };
}
function orgCount(id) { return [...orgDescendants(id)].filter(k => { const n = orgById(k); return n && n.kind === 'person'; }).length; }

function orgCard(n) {
  const ro = readOnly, nm = orgName(n);
  if (n.kind === 'team') {
    const c = n.color || '#3d7e5e', cnt = orgCount(n.id);
    return '<div class="onode team" data-oid="' + n.id + '"' + (ro ? '' : ' draggable="true"') + ' style="--tc:' + c + '">' +
      '<div class="oth">' + (orgPhoto(n) ? orgAvatar(n, 'sm') : '') + '<span class="otn">' + esc(nm || 'Unterteam ohne Namen') + '</span></div>' +
      (n.role ? '<div class="orole">' + esc(n.role) + '</div>' : '') + '<div class="ometa">' + cnt + (cnt === 1 ? ' Person' : ' Personen') + '</div>' + orgActs(n) + '</div>';
  }
  const ld = orgLoad(n), bits = [ld.rows ? ld.rows + (ld.rows === 1 ? ' Vorgang' : ' Vorgänge') : '', ld.tasks ? ld.tasks + (ld.tasks === 1 ? ' Aufgabe' : ' Aufgaben') : ''].filter(Boolean);
  return '<div class="onode person" data-oid="' + n.id + '"' + (ro ? '' : ' draggable="true"') + '>' + orgAvatar(n) +
    '<div class="oname">' + esc(nm || 'Ohne Namen') + '</div>' + (n.role ? '<div class="orole">' + esc(n.role) + '</div>' : '') +
    (bits.length ? '<button type="button" class="oload" data-oshow="' + n.id + '" title="Offene Vorgänge in der Liste zeigen">' + bits.join(' · ') + ' offen</button>' : '') + orgActs(n) + '</div>';
}
function orgActs(n) {
  if (readOnly) return '';
  return '<div class="oacts"><button type="button" class="ib" data-oadd="person" data-op="' + n.id + '" title="Person darunter anlegen" aria-label="Person darunter anlegen">' + orgIcon('person') + '</button>' +
    '<button type="button" class="ib" data-oadd="team" data-op="' + n.id + '" title="Unterteam darunter anlegen" aria-label="Unterteam darunter anlegen">' + orgIcon('team') + '</button>' +
    '<button type="button" class="ib" data-oedit="' + n.id + '" title="Bearbeiten" aria-label="Bearbeiten">' + orgIcon('edit') + '</button></div>';
}
function orgIcon(k) {
  const p = { person: 'M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3.5 13.5c.6-2.4 2.3-3.5 4.5-3.5s3.9 1.1 4.5 3.5M12.5 2v4M10.5 4h4', team: 'M5.5 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13c.4-2 1.7-3 3.5-3s3.1 1 3.5 3M8.5 11c.6-.7 1.4-1 2.5-1 1.8 0 3.1 1 3.5 3', edit: 'M10.5 3l2.5 2.5L6 12.5H3.5V10z' }[k];
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + p + '"/></svg>';
}
function orgLi(n, depth) {
  const kids = depth > 40 ? [] : orgKids(n.id);
  return '<li>' + orgCard(n) + (kids.length ? '<ul>' + kids.map(k => orgLi(k, depth + 1)).join('') + '</ul>' : '') + '</li>';
}
function renderOrg() {
  const box = $('vOrg'); if (!box) return;
  const roots = orgKids(null), ro = readOnly;
  const canImport = hasUserDirectory() ? assigneeTeam().some(u => !orgNodes().some(n => String(n.uid) === String(u.id))) : (state.people || []).some(p => !orgNodes().some(n => orgName(n).toLowerCase() === String(p).toLowerCase()));
  let h = '<div class="orgbar">' + (ro ? '' : '<button type="button" class="btn primary" data-oadd="person" data-op="">+ Person</button><button type="button" class="btn" data-oadd="team" data-op="">+ Unterteam</button>' +
    (canImport ? '<button type="button" class="btn" id="orgImport" title="Alle noch fehlenden Teammitglieder als Personen anlegen">Teammitglieder übernehmen</button>' : '')) +
    '<span class="spacer"></span><span class="hint">' + (ro ? '' : 'Karten auf eine andere Karte ziehen, um die Zuordnung zu ändern.') + '</span></div>';
  if (!roots.length) h += '<div class="empty"><b>Noch kein Organigramm.</b><br>Lege Personen und Unterteams an und ordne sie einander zu. ' + (canImport && !ro ? 'Mit „Teammitglieder übernehmen“ geht es am schnellsten.' : '') + '</div>';
  else h += '<div class="orgwrap"><ul class="org">' + roots.map(n => orgLi(n, 0)).join('') + '</ul>' + (ro ? '' : '<div class="orgroot" data-oroot>Hierher ziehen: oberste Ebene</div>') + '</div>';
  box.innerHTML = h;
}

function newOrgNode(kind, parent) {
  if (readOnly) return null;
  const used = new Set(orgNodes().map(n => n.id)); let id;
  do { id = 100000 + Math.floor(Math.random() * 900000); } while (used.has(id));
  const n = { id, kind, name: '', role: '', uid: '', photo: '', parent: parent === '' || parent == null ? '' : Number(parent), color: kind === 'team' ? ORG_COLORS[orgNodes().filter(x => x.kind === 'team').length % ORG_COLORS.length] : '' };
  orgNodes().push(n); return n;
}
function orgChanged(force) { changed(force); if (view === 'org') renderOrg(); }
// Bild quadratisch zuschneiden und verkleinern (wenige KB im Plan)
function orgImage(file) {
  return new Promise((res, rej) => {
    if (!file || !/^image\//.test(file.type)) { rej(new Error('Bitte eine Bilddatei wählen')); return; }
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => {
      const S = 160, c = document.createElement('canvas'); c.width = c.height = S; const k = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, S, S); res(c.toDataURL('image/jpeg', 0.82));
    }; img.onerror = () => rej(new Error('Bild konnte nicht gelesen werden')); img.src = fr.result; };
    fr.onerror = () => rej(new Error('Bild konnte nicht gelesen werden')); fr.readAsDataURL(file);
  });
}
function closeOrg() {
  if (!orgDlg) return;
  const n = orgById(orgDlg.id);
  if (n && orgDlg.fresh && !orgName(n) && !n.role && !n.photo) { state.org = orgNodes().filter(x => x !== n); orgChanged(true); }
  orgDlg.el.remove(); document.removeEventListener('keydown', orgKey); orgDlg = null;
}
function orgKey(e) { if (e.key === 'Escape' && orgDlg) closeOrg(); }
function openOrg(id, fresh) {
  closeOrg(); const n0 = orgById(id); if (!n0) return;
  const ro = readOnly, dir = hasUserDirectory(), s = document.createElement('div'); s.className = 'scrim'; s.id = 'orgScrim';
  s.innerHTML = '<div class="panel det orgdlg" role="dialog" aria-modal="true" aria-labelledby="oT">' +
    '<div class="head"><h2 id="oT"></h2><button class="btn" type="button" data-x>Schließen</button></div>' +
    '<div class="orow"><span id="oAv"></span><div class="btns">' + (ro ? '' : '<label class="btn" for="oFile">Bild wählen</label><input id="oFile" type="file" accept="image/*" hidden><button class="btn" type="button" id="oPicDel">Bild entfernen</button>') + '</div></div>' +
    '<div class="pf"><span>Art</span><div class="seg" id="oKind" role="group" aria-label="Art"><button type="button" data-v="person">Person</button><button type="button" data-v="team">Unterteam</button></div></div>' +
    (dir ? '<label class="pf" id="oUidWrap">Benutzerkonto<select class="in" id="oUid"' + (ro ? ' disabled' : '') + '></select></label>' : '') +
    '<label class="pf"><span id="oNameL">Name</span><input class="in" id="oName" maxlength="80" autocomplete="off"' + (ro ? ' disabled' : '') + '></label>' +
    '<label class="pf"><span id="oRoleL">Rolle / Funktion</span><input class="in" id="oRole" maxlength="80" autocomplete="off" placeholder="z. B. Projektleitung, Tragwerk, Bauphysik"' + (ro ? ' disabled' : '') + '></label>' +
    '<div class="pf" id="oColWrap"><span>Farbe des Unterteams</span><div class="swatches" id="oColor">' + ORG_COLORS.concat(ROW_COLORS.map(c => c[0])).filter((c, k, a) => a.indexOf(c) === k).slice(0, 12).map(c => '<button type="button" class="sw" data-col="' + c + '" style="background:' + c + '" aria-label="Farbe ' + c + '"' + (ro ? ' disabled' : '') + '></button>').join('') + '</div></div>' +
    '<label class="pf">Gehört zu<select class="in" id="oPar"' + (ro ? ' disabled' : '') + '></select></label>' +
    '<div class="btns">' + (ro ? '' : '<button class="btn danger" type="button" id="oDel">Entfernen</button>') + '<span class="spacer"></span><button class="btn primary" type="button" data-x>Fertig</button></div>' +
    '<p class="hint" id="oHint"></p></div>';
  document.body.appendChild(s);
  orgDlg = { id, el: s, fresh: !!fresh }; document.addEventListener('keydown', orgKey);
  const q = x => s.querySelector(x), cur = () => orgById(id);
  const save = (fn, force) => { const n = cur(); if (!n || readOnly) return; fn(n); orgChanged(force); paint(); };
  function paint() {
    const n = cur(); if (!n) { closeOrg(); return; }
    const team = n.kind === 'team';
    q('#oT').textContent = orgName(n) || (team ? 'Neues Unterteam' : 'Neue Person');
    q('#oAv').innerHTML = orgAvatar(n, 'lg');
    q('#oKind').querySelectorAll('button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.v === n.kind)); b.disabled = ro; });
    q('#oNameL').textContent = team ? 'Name des Unterteams' : 'Name';
    q('#oRoleL').textContent = team ? 'Beschreibung / Aufgabe' : 'Rolle / Funktion';
    q('#oColWrap').hidden = !team;
    q('#oColor').querySelectorAll('.sw').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.col === n.color)));
    if (q('#oUidWrap')) {
      q('#oUidWrap').hidden = team;
      const taken = new Set(orgNodes().filter(x => x.id !== n.id && x.uid).map(x => String(x.uid)));
      q('#oUid').innerHTML = '<option value="">– ohne Benutzerkonto –</option>' + assigneeTeam().filter(u => !taken.has(String(u.id)) || String(u.id) === String(n.uid)).map(u => '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>').join('');
      q('#oUid').value = n.uid || '';
    }
    if (document.activeElement !== q('#oName')) q('#oName').value = n.name || (orgMember(n) ? orgMember(n).name : '');
    if (document.activeElement !== q('#oRole')) q('#oRole').value = n.role || '';
    const bad = orgDescendants(n.id); bad.add(n.id);
    q('#oPar').innerHTML = '<option value="">– oberste Ebene –</option>' + orgNodes().filter(x => !bad.has(x.id)).map(x => '<option value="' + x.id + '">' + esc((x.kind === 'team' ? 'Team: ' : '') + (orgName(x) || 'ohne Namen')) + '</option>').join('');
    const p = orgParent(n); q('#oPar').value = p ? String(p.id) : '';
    if (q('#oPicDel')) q('#oPicDel').disabled = !n.photo;
    const m = orgMember(n);
    q('#oHint').textContent = m && !n.photo ? (m.avatar ? 'Es wird das Profilbild des Benutzerkontos angezeigt.' : 'Ohne eigenes Bild erscheinen die Initialen.') : '';
  }
  paint();
  q('#oKind').addEventListener('click', e => { const b = e.target.closest('button'); if (b) save(n => { n.kind = b.dataset.v === 'team' ? 'team' : 'person'; if (n.kind === 'team') { n.uid = ''; if (!n.color) n.color = ORG_COLORS[0]; } }, true); });
  q('#oName').addEventListener('input', e => save(n => { n.name = e.target.value.slice(0, 80); }));
  q('#oRole').addEventListener('input', e => save(n => { n.role = e.target.value.slice(0, 80); }));
  q('#oColor').addEventListener('click', e => { const b = e.target.closest('.sw'); if (b) save(n => { n.color = b.dataset.col; }, true); });
  q('#oPar').addEventListener('change', e => save(n => { n.parent = e.target.value === '' ? '' : Number(e.target.value); }, true));
  if (q('#oUid')) q('#oUid').addEventListener('change', e => save(n => { n.uid = e.target.value; const m = orgMember(n); if (m && (!n.name || n.name === '')) n.name = m.name; }, true));
  if (q('#oFile')) q('#oFile').addEventListener('change', async e => {
    try { const url = await orgImage(e.target.files[0]); save(n => { n.photo = url; }, true); } catch (x) { toast(x.message); }
    e.target.value = '';
  });
  if (q('#oPicDel')) q('#oPicDel').addEventListener('click', () => save(n => { n.photo = ''; }, true));
  if (q('#oDel')) q('#oDel').addEventListener('click', e => {
    const b = e.currentTarget, n = cur(); if (!n) return;
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = orgKids(n.id).length ? 'Wirklich entfernen? Darunterliegende rücken eine Ebene auf' : 'Wirklich entfernen?'; return; }
    const up = orgParent(n); orgKids(n.id).forEach(k => { k.parent = up ? up.id : ''; });
    state.org = orgNodes().filter(x => x.id !== n.id); orgDlg.fresh = false; closeOrg(); orgChanged(true);
  });
  s.addEventListener('click', e => { if (e.target === s || e.target.closest('[data-x]')) closeOrg(); });
  (ro ? q('[data-x]') : q('#oName')).focus();
}

function initOrg() {
  const box = $('vOrg'); if (!box) return;
  box.addEventListener('click', e => {
    const a = e.target.closest('[data-oadd]'); if (a) { const n = newOrgNode(a.dataset.oadd, a.dataset.op); if (n) { orgChanged(true); openOrg(n.id, true); } return; }
    const ed = e.target.closest('[data-oedit]'); if (ed) { openOrg(+ed.dataset.oedit); return; }
    const sh = e.target.closest('[data-oshow]'); if (sh) {
      const n = orgById(+sh.dataset.oshow); if (!n) return;
      resetViewFilters(); fWho = n.uid && hasUserDirectory() ? 'user:' + n.uid : orgName(n);
      if ($('vfilters')) $('vfilters').hidden = false; setView('list'); return;
    }
    if (e.target.id === 'orgImport') {
      if (hasUserDirectory()) assigneeTeam().forEach(u => { if (!orgNodes().some(n => String(n.uid) === String(u.id))) { const n = newOrgNode('person', ''); n.uid = String(u.id); n.name = u.name; } });
      else (state.people || []).forEach(p => { if (!orgNodes().some(n => orgName(n).toLowerCase() === String(p).toLowerCase())) { const n = newOrgNode('person', ''); n.name = String(p); } });
      orgChanged(true); toast('Teammitglieder übernommen. Ziehe die Karten jetzt an ihren Platz.'); return;
    }
    const c = e.target.closest('.onode'); if (c && !e.target.closest('button')) openOrg(+c.dataset.oid);
  });
  // Ziehen und Ablegen: Karte auf Karte = darunter einordnen, auf die Leiste = oberste Ebene
  box.addEventListener('dragstart', e => { const c = e.target.closest('.onode'); if (!c || readOnly) return; orgDragId = +c.dataset.oid; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'org:' + orgDragId); } catch (x) { } c.classList.add('drag'); box.classList.add('odragging'); });
  box.addEventListener('dragend', () => { orgDragId = null; box.classList.remove('odragging'); box.querySelectorAll('.drag, .over').forEach(x => x.classList.remove('drag', 'over')); });
  const target = e => {
    if (orgDragId == null) return null;
    const root = e.target.closest('[data-oroot]'); if (root) return { el: root, id: '' };
    const c = e.target.closest('.onode'); if (!c) return null;
    const id = +c.dataset.oid; if (id === orgDragId || orgDescendants(orgDragId).has(id)) return null;
    return { el: c, id };
  };
  box.addEventListener('dragover', e => { const t = target(e); box.querySelectorAll('.over').forEach(x => { if (!t || x !== t.el) x.classList.remove('over'); }); if (!t) return; e.preventDefault(); t.el.classList.add('over'); });
  box.addEventListener('drop', e => {
    const t = target(e); if (!t) return; e.preventDefault();
    const n = orgById(orgDragId); if (!n) return;
    n.parent = t.id; orgDragId = null; box.classList.remove('odragging'); orgChanged(true);
  });
}
