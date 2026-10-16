/* ---------- Organigramm: Projektleitung, Teams mit Teamleitung und Teammitgliedern ---------- */
// Teams:    { id, kind: 'team', name, role (Beschreibung), color, parent (übergeordnetes Team oder '') }
// Personen: { id, kind: 'person', name, role, uid (Benutzerkonto), photo, pl (Projektleitung), teams: [{ team, lead, role }] }
// Personen gehören nur zu Teams (nie zu Personen); die erste Mitgliedschaft ist das Hauptteam.
const ORG_COLORS = ['#3d7e5e', '#2f6fb2', '#8a5cb8', '#b0612a', '#2a8c8c', '#a33f6d', '#5f6f2a'];
let orgDlg = null, orgDrag = null, orgAddMode = false;   // orgAddMode: beim Ziehen zusätzlich zuordnen statt verschieben (Ersatz für Strg, z. B. am Handy)

function orgNodes() { if (!Array.isArray(state.org)) state.org = []; return state.org; }
function orgById(id) { return orgNodes().find(n => n.id === id) || null; }
const orgTeams = () => orgNodes().filter(n => n.kind === 'team');
const orgPeople = () => orgNodes().filter(n => n.kind === 'person');
function orgTeamParent(t) {
  if (t.parent === '' || t.parent == null) return null;
  const seen = new Set([t.id]);
  for (let q = orgById(t.parent); q; q = q.parent === '' ? null : orgById(q.parent)) { if (q.kind !== 'team' || seen.has(q.id)) return null; seen.add(q.id); }
  const p = orgById(t.parent); return p && p.kind === 'team' ? p : null;
}
function orgSubTeams(id) { return orgTeams().filter(t => { const p = orgTeamParent(t); return id == null ? !p : p && p.id === id; }); }
function orgTeamDesc(id) { const out = new Set(), walk = k => orgSubTeams(k).forEach(c => { if (!out.has(c.id)) { out.add(c.id); walk(c.id); } }); walk(id); return out; }
function orgMemberships(p) { return Array.isArray(p.teams) ? p.teams.filter(m => { const t = orgById(m.team); return t && t.kind === 'team'; }) : []; }
function orgInTeam(id, lead) { return orgPeople().filter(p => orgMemberships(p).some(m => m.team === id && !!m.lead === lead)); }
const orgInitials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const orgHue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return ORG_COLORS[h % ORG_COLORS.length]; };
function orgMember(n) { return n.uid && hasUserDirectory() ? assigneeTeam().find(u => String(u.id) === String(n.uid)) || null : null; }
function orgPhoto(n) { const m = orgMember(n); return n.photo || (m && m.avatar) || ''; }
function orgName(n) { const m = orgMember(n); return (n.name || (m && m.name) || '').trim(); }
function orgAvatar(n, cls) {
  const url = orgPhoto(n), name = orgName(n) || '?';
  return url ? '<img class="oav ' + (cls || '') + '" src="' + esc(url) + '" alt="">' : '<span class="oav ini ' + (cls || '') + '" style="background:' + orgHue(name) + '" aria-hidden="true">' + esc(orgInitials(name)) + '</span>';
}
function orgIcon(k) {
  const p = { person: 'M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3.5 13.5c.6-2.4 2.3-3.5 4.5-3.5s3.9 1.1 4.5 3.5M12.5 2v4M10.5 4h4', team: 'M5.5 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13c.4-2 1.7-3 3.5-3s3.1 1 3.5 3M8.5 11c.6-.7 1.4-1 2.5-1 1.8 0 3.1 1 3.5 3', edit: 'M10.5 3l2.5 2.5L6 12.5H3.5V10z' }[k];
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + p + '"/></svg>';
}

/* Darstellung */
// Karte (Projektleitung, Teamleitung) bzw. Zeile (Teammitglied); from = Herkunft beim Ziehen
function orgPersonCard(p, from, teamId) {
  const m = teamId != null ? orgMemberships(p).find(x => x.team === teamId) : null, role = (m && m.role) || p.role;
  const main = orgMemberships(p)[0], second = teamId != null && main && main.team !== teamId;
  return '<div class="ocard" data-pid="' + p.id + '" data-from="' + from + '"' + (readOnly ? '' : ' draggable="true"') + '>' + orgAvatar(p) +
    '<div class="oname">' + esc(orgName(p) || 'Ohne Namen') + '</div>' + (role ? '<div class="orole">' + esc(role) + '</div>' : '') +
    (second ? '<div class="osec">Hauptteam: ' + esc(orgName(orgById(main.team)) || 'ohne Namen') + '</div>' : '') +
    (readOnly || from === 'none' ? '' : '<button type="button" class="ib orm" data-orm="' + p.id + ':' + from + '" title="' + (from === 'pl' ? 'Aus der Projektleitung nehmen' : 'Aus diesem Team nehmen') + '" aria-label="Entfernen">×</button>') + '</div>';
}
function orgMemberRow(p, teamId) {
  const m = orgMemberships(p).find(x => x.team === teamId), role = (m && m.role) || p.role;
  const main = orgMemberships(p)[0], second = main && main.team !== teamId;
  return '<li class="orow2" data-pid="' + p.id + '" data-from="tm:' + teamId + '"' + (readOnly ? '' : ' draggable="true"') + '>' + orgAvatar(p, 'sm') +
    '<span class="omt"><b>' + esc(orgName(p) || 'Ohne Namen') + '</b>' + (role ? '<span>' + esc(role) + '</span>' : '') +
    (second ? '<em>Hauptteam: ' + esc(orgName(orgById(main.team)) || 'ohne Namen') + '</em>' : '') + '</span>' +
    (readOnly ? '' : '<button type="button" class="ib orm" data-orm="' + p.id + ':tm:' + teamId + '" title="Aus diesem Team nehmen" aria-label="Entfernen">×</button>') + '</li>';
}
function orgTeamLi(t, depth) {
  const leads = orgInTeam(t.id, true), members = orgInTeam(t.id, false), subs = depth > 30 ? [] : orgSubTeams(t.id), ro = readOnly;
  const box = '<div class="obox team" data-tid="' + t.id + '" style="--tc:' + (t.color || ORG_COLORS[0]) + '">' +
    '<div class="oth"' + (ro ? '' : ' draggable="true" data-tdrag="' + t.id + '"') + '><span class="otn">' + esc(orgName(t) || 'Team ohne Namen') + '</span>' +
    (ro ? '' : '<button type="button" class="ib" data-tedit="' + t.id + '" title="Team bearbeiten" aria-label="Team bearbeiten">' + orgIcon('edit') + '</button>') + '</div>' +
    (t.role ? '<div class="otd">' + esc(t.role) + '</div>' : '') +
    '<div class="ozone tl" data-drop="tl:' + t.id + '"><div class="olabel">Teamleitung</div>' +
    (leads.length ? '<div class="ocards">' + leads.map(p => orgPersonCard(p, 'tl:' + t.id, t.id)).join('') + '</div>' : '<div class="oempty">' + (ro ? '–' : 'Person hierher ziehen') + '</div>') + '</div>' +
    '<div class="ozone tm" data-drop="tm:' + t.id + '"><div class="olabel">Teammitglieder</div>' +
    (members.length ? '<ul class="omembers">' + members.map(p => orgMemberRow(p, t.id)).join('') + '</ul>' : '<div class="oempty">' + (ro ? '–' : 'Personen hierher ziehen') + '</div>') + '</div>' +
    (ro ? '' : '<div class="oadd"><button type="button" class="btn sm" data-padd="tm:' + t.id + '">+ Person</button><button type="button" class="btn sm" data-tadd="' + t.id + '">+ Unterteam</button></div>') + '</div>';
  return '<li>' + box + (subs.length ? '<ul>' + subs.map(s => orgTeamLi(s, depth + 1)).join('') + '</ul>' : '') + '</li>';
}
function renderOrg() {
  const box = $('vOrg'); if (!box) return;
  const ro = readOnly, pls = orgPeople().filter(p => p.pl), tops = orgSubTeams(null);
  const loose = orgPeople().filter(p => !p.pl && !orgMemberships(p).length);
  const canImport = hasUserDirectory() ? assigneeTeam().some(u => !orgPeople().some(n => String(n.uid) === String(u.id))) : (state.people || []).some(p => !orgPeople().some(n => orgName(n).toLowerCase() === String(p).toLowerCase()));
  let h = '<div class="orgbar">' + (ro ? '' : '<button type="button" class="btn primary" data-padd="none">+ Person</button><button type="button" class="btn" data-tadd="">+ Team</button>' +
    (canImport ? '<button type="button" class="btn" id="orgImport" title="Alle noch fehlenden Teammitglieder anlegen">Teammitglieder übernehmen</button>' : '')) +
    (ro ? '' : '<button type="button" class="btn' + (orgAddMode ? ' on' : '') + '" id="orgAddMode" aria-pressed="' + orgAddMode + '" title="Eingeschaltet: Personen werden beim Ziehen zusätzlich zugeordnet und bleiben im bisherigen Team">' + (orgAddMode ? '✓ ' : '') + 'Zusätzlich zuordnen</button>') +
    '<span class="spacer"></span><span class="hint">' + (ro ? '' : (orgAddMode ? 'Ziehen ordnet zusätzlich zu – die Person bleibt im bisherigen Team' : 'Personen in Projektleitung, Teamleitung oder Teammitglieder ziehen') + (isTouchUI() ? ' · zum Ziehen lange drücken' : '')) + '</span></div>';
  if (!orgNodes().length) {
    h += '<div class="empty"><b>Noch kein Organigramm.</b><br>Lege Teams an und ordne die Personen als Projektleitung, Teamleitung oder Teammitglied zu.' + (canImport && !ro ? ' Mit „Teammitglieder übernehmen“ geht es am schnellsten.' : '') + '</div>';
    box.innerHTML = h; return;
  }
  h += '<div class="orgwrap"><ul class="org"><li><div class="obox plbox" data-drop="pl"><div class="olabel">Projektleitung</div>' +
    (pls.length ? '<div class="ocards">' + pls.map(p => orgPersonCard(p, 'pl')).join('') + '</div>' : '<div class="oempty">' + (ro ? '–' : 'Projektleitung hierher ziehen') + '</div>') + '</div>' +
    (tops.length ? '<ul>' + tops.map(t => orgTeamLi(t, 0)).join('') + '</ul>' : '') + '</li></ul>' +
    (loose.length || !ro ? '<div class="obox nobox" data-drop="none"><div class="olabel">Noch ohne Team</div>' +
      (loose.length ? '<div class="ocards">' + loose.map(p => orgPersonCard(p, 'none')).join('') + '</div>' : '<div class="oempty">Hierher ziehen, um eine Zuordnung zu lösen</div>') + '</div>' : '') + '</div>';
  box.innerHTML = h;
}

/* Zuordnungen */
function orgRemoveFrom(p, from) {
  if (from === 'pl') p.pl = false;
  else if (/^t[lm]:\d+$/.test(from)) { const id = Number(from.slice(3)); p.teams = (p.teams || []).filter(m => m.team !== id); }
}
// Liefert false, wenn die Person dort schon so zugeordnet ist
function orgAddTo(p, to) {
  if (to === 'pl') { if (p.pl) return false; p.pl = true; return true; }
  if (!/^t[lm]:\d+$/.test(to)) return false;
  const id = Number(to.slice(3)), lead = to[1] === 'l';
  if (!Array.isArray(p.teams)) p.teams = [];
  const m = p.teams.find(x => x.team === id);
  if (m) { if (!!m.lead === lead) return false; m.lead = lead; return true; }
  p.teams.push({ team: id, lead, role: '' }); return true;
}
function newOrgNode(kind, extra) {
  if (readOnly) return null;
  const used = new Set(orgNodes().map(n => n.id)); let id;
  do { id = 100000 + Math.floor(Math.random() * 900000); } while (used.has(id));
  const n = kind === 'team'
    ? { id, kind: 'team', name: '', role: '', color: ORG_COLORS[orgTeams().length % ORG_COLORS.length], parent: '' }
    : { id, kind: 'person', name: '', role: '', uid: '', photo: '', pl: false, teams: [] };
  Object.assign(n, extra || {}); orgNodes().push(n); return n;
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

/* Dialoge */
function closeOrg() {
  if (!orgDlg) return;
  const n = orgById(orgDlg.id);
  if (n && orgDlg.fresh && !orgName(n) && !n.role && !n.photo) { state.org = orgNodes().filter(x => x !== n); orgChanged(true); }
  orgDlg.el.remove(); document.removeEventListener('keydown', orgKey); orgDlg = null;
}
function orgKey(e) { if (e.key === 'Escape' && orgDlg) closeOrg(); }
function openOrg(id, fresh) {
  closeOrg(); const n0 = orgById(id); if (!n0) return;
  if (n0.kind === 'team') return openOrgTeam(id, fresh);
  const ro = readOnly, dir = hasUserDirectory(), s = document.createElement('div'); s.className = 'scrim'; s.id = 'orgScrim';
  s.innerHTML = '<div class="panel det orgdlg" role="dialog" aria-modal="true" aria-labelledby="oT">' +
    '<div class="head"><h2 id="oT"></h2><button class="btn" type="button" data-x>Schließen</button></div>' +
    '<div class="orow"><span id="oAv"></span><div class="btns">' + (ro ? '' : '<label class="btn" for="oFile">Bild wählen</label><input id="oFile" type="file" accept="image/*" hidden><button class="btn" type="button" id="oPicDel">Bild entfernen</button>') + '</div></div>' +
    (dir ? '<label class="pf">Benutzerkonto<select class="in" id="oUid"' + (ro ? ' disabled' : '') + '></select></label>' : '') +
    '<label class="pf">Name<input class="in" id="oName" maxlength="80" autocomplete="off"' + (ro ? ' disabled' : '') + '></label>' +
    '<label class="pf">Rolle / Funktion<input class="in" id="oRole" maxlength="80" autocomplete="off" placeholder="z. B. Tragwerk, Bauphysik, Arbeitsvorbereitung"' + (ro ? ' disabled' : '') + '></label>' +
    '<label class="chk"><input type="checkbox" id="oPl"' + (ro ? ' disabled' : '') + '> Projektleitung</label>' +
    '<div class="pf"><span>Teams</span><div id="oTeams" class="oalsolist"></div>' + (ro ? '' : '<select class="in" id="oTeamAdd" aria-label="Team hinzufügen"></select>') +
    '<p class="hint">Das erste Team ist das Hauptteam. Rolle je Team optional, leer = allgemeine Rolle.</p></div>' +
    '<div class="btns">' + (ro ? '' : '<button class="btn danger" type="button" id="oDel">Person entfernen</button>') + '<span class="spacer"></span><button class="btn primary" type="button" data-x>Fertig</button></div>' +
    '<p class="hint" id="oHint"></p></div>';
  document.body.appendChild(s);
  orgDlg = { id, el: s, fresh: !!fresh }; document.addEventListener('keydown', orgKey);
  const q = x => s.querySelector(x), cur = () => orgById(id);
  const save = (fn, force) => { const n = cur(); if (!n || readOnly) return; fn(n); orgChanged(force); paint(); };
  function paint() {
    const n = cur(); if (!n) { closeOrg(); return; }
    q('#oT').textContent = orgName(n) || 'Neue Person';
    q('#oAv').innerHTML = orgAvatar(n, 'lg');
    if (q('#oUid')) {
      const taken = new Set(orgPeople().filter(x => x.id !== n.id && x.uid).map(x => String(x.uid)));
      q('#oUid').innerHTML = '<option value="">– ohne Benutzerkonto –</option>' + assigneeTeam().filter(u => !taken.has(String(u.id)) || String(u.id) === String(n.uid)).map(u => '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>').join('');
      q('#oUid').value = n.uid || '';
    }
    if (document.activeElement !== q('#oName')) q('#oName').value = n.name || (orgMember(n) ? orgMember(n).name : '');
    if (document.activeElement !== q('#oRole')) q('#oRole').value = n.role || '';
    q('#oPl').checked = !!n.pl;
    if (!q('#oTeams').contains(document.activeElement)) {
      const ms = orgMemberships(n);
      q('#oTeams').innerHTML = ms.length ? ms.map((m, k) => '<div class="oarow t3"><span class="oat">' + esc(orgName(orgById(m.team)) || 'ohne Namen') + (k === 0 ? ' <em>(Hauptteam)</em>' : '') + '</span>' +
        '<select class="in" data-alead="' + m.team + '"' + (ro ? ' disabled' : '') + '><option value="0"' + (m.lead ? '' : ' selected') + '>Mitglied</option><option value="1"' + (m.lead ? ' selected' : '') + '>Teamleitung</option></select>' +
        '<input class="in" data-arole="' + m.team + '" maxlength="80" placeholder="Rolle in diesem Team" value="' + esc(m.role || '') + '"' + (ro ? ' disabled' : '') + '>' +
        (ro ? '' : '<button type="button" class="ib" data-arm="' + m.team + '" aria-label="Aus Team nehmen" title="Aus diesem Team nehmen">×</button>') + '</div>').join('') : '<span class="hint">Noch in keinem Team.</span>';
      if (q('#oTeamAdd')) {
        const have = new Set(ms.map(m => m.team));
        q('#oTeamAdd').innerHTML = '<option value="">+ Team hinzufügen …</option>' + orgTeams().filter(t => !have.has(t.id)).map(t => '<option value="' + t.id + '">' + esc(orgName(t) || 'ohne Namen') + '</option>').join('');
        q('#oTeamAdd').disabled = !orgTeams().some(t => !have.has(t.id));
      }
    }
    if (q('#oPicDel')) q('#oPicDel').disabled = !n.photo;
    const m = orgMember(n);
    q('#oHint').textContent = m && !n.photo ? (m.avatar ? 'Es wird das Profilbild des Benutzerkontos angezeigt.' : 'Ohne eigenes Bild erscheinen die Initialen.') : '';
  }
  paint();
  q('#oName').addEventListener('input', e => save(n => { n.name = e.target.value.slice(0, 80); }));
  q('#oRole').addEventListener('input', e => save(n => { n.role = e.target.value.slice(0, 80); }));
  q('#oPl').addEventListener('change', e => save(n => { n.pl = e.target.checked; }, true));
  if (q('#oUid')) q('#oUid').addEventListener('change', e => save(n => { n.uid = e.target.value; const m = orgMember(n); if (m && !n.name) n.name = m.name; }, true));
  if (q('#oTeamAdd')) q('#oTeamAdd').addEventListener('change', e => { const v = Number(e.target.value); if (v) save(n => { orgAddTo(n, 'tm:' + v); }, true); });
  q('#oTeams').addEventListener('click', e => { const b = e.target.closest('[data-arm]'); if (b) { const t = Number(b.dataset.arm); save(n => { n.teams = (n.teams || []).filter(m => m.team !== t); }, true); } });
  q('#oTeams').addEventListener('change', e => { const t = Number(e.target.dataset.alead); if (t) save(n => { const m = (n.teams || []).find(x => x.team === t); if (m) m.lead = e.target.value === '1'; }, true); });
  q('#oTeams').addEventListener('input', e => { const t = Number(e.target.dataset.arole); if (t) save(n => { const m = (n.teams || []).find(x => x.team === t); if (m) m.role = e.target.value.slice(0, 80); }); });
  if (q('#oFile')) q('#oFile').addEventListener('change', async e => {
    try { const url = await orgImage(e.target.files[0]); save(n => { n.photo = url; }, true); } catch (x) { toast(x.message); }
    e.target.value = '';
  });
  if (q('#oPicDel')) q('#oPicDel').addEventListener('click', () => save(n => { n.photo = ''; }, true));
  if (q('#oDel')) q('#oDel').addEventListener('click', e => {
    const b = e.currentTarget; if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Wirklich entfernen?'; return; }
    state.org = orgNodes().filter(x => x.id !== id); orgDlg.fresh = false; closeOrg(); orgChanged(true);
  });
  s.addEventListener('click', e => { if (e.target === s || e.target.closest('[data-x]')) closeOrg(); });
  (ro ? q('[data-x]') : q('#oName')).focus();
}
function openOrgTeam(id, fresh) {
  const ro = readOnly, s = document.createElement('div'); s.className = 'scrim'; s.id = 'orgScrim';
  s.innerHTML = '<div class="panel det orgdlg" role="dialog" aria-modal="true" aria-labelledby="oT">' +
    '<div class="head"><h2 id="oT"></h2><button class="btn" type="button" data-x>Schließen</button></div>' +
    '<label class="pf">Name des Teams<input class="in" id="oName" maxlength="80" autocomplete="off"' + (ro ? ' disabled' : '') + '></label>' +
    '<label class="pf">Beschreibung / Aufgabe<input class="in" id="oRole" maxlength="80" autocomplete="off" placeholder="z. B. Entwurf und Tragwerk"' + (ro ? ' disabled' : '') + '></label>' +
    '<div class="pf"><span>Farbe</span><div class="swatches" id="oColor">' + ORG_COLORS.concat(ROW_COLORS.map(c => c[0])).filter((c, k, a) => a.indexOf(c) === k).slice(0, 12).map(c => '<button type="button" class="sw" data-col="' + c + '" style="background:' + c + '" aria-label="Farbe ' + c + '"' + (ro ? ' disabled' : '') + '></button>').join('') + '</div></div>' +
    '<label class="pf">Übergeordnetes Team<select class="in" id="oPar"' + (ro ? ' disabled' : '') + '></select></label>' +
    '<div class="btns">' + (ro ? '' : '<button class="btn danger" type="button" id="oDel">Team entfernen</button>') + '<span class="spacer"></span><button class="btn primary" type="button" data-x>Fertig</button></div></div>';
  document.body.appendChild(s);
  orgDlg = { id, el: s, fresh: !!fresh }; document.addEventListener('keydown', orgKey);
  const q = x => s.querySelector(x), cur = () => orgById(id);
  const save = (fn, force) => { const n = cur(); if (!n || readOnly) return; fn(n); orgChanged(force); paint(); };
  function paint() {
    const n = cur(); if (!n) { closeOrg(); return; }
    q('#oT').textContent = orgName(n) || 'Neues Team';
    if (document.activeElement !== q('#oName')) q('#oName').value = n.name;
    if (document.activeElement !== q('#oRole')) q('#oRole').value = n.role || '';
    q('#oColor').querySelectorAll('.sw').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.col === n.color)));
    const bad = orgTeamDesc(n.id); bad.add(n.id);
    q('#oPar').innerHTML = '<option value="">– direkt unter der Projektleitung –</option>' + orgTeams().filter(t => !bad.has(t.id)).map(t => '<option value="' + t.id + '">' + esc(orgName(t) || 'ohne Namen') + '</option>').join('');
    const p = orgTeamParent(n); q('#oPar').value = p ? String(p.id) : '';
  }
  paint();
  q('#oName').addEventListener('input', e => save(n => { n.name = e.target.value.slice(0, 80); }));
  q('#oRole').addEventListener('input', e => save(n => { n.role = e.target.value.slice(0, 80); }));
  q('#oColor').addEventListener('click', e => { const b = e.target.closest('.sw'); if (b) save(n => { n.color = b.dataset.col; }, true); });
  q('#oPar').addEventListener('change', e => save(n => { n.parent = e.target.value === '' ? '' : Number(e.target.value); }, true));
  if (q('#oDel')) q('#oDel').addEventListener('click', e => {
    const b = e.currentTarget, n = cur(); if (!n) return;
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = orgSubTeams(n.id).length ? 'Wirklich entfernen? Unterteams rücken eine Ebene auf' : 'Wirklich entfernen?'; return; }
    const up = orgTeamParent(n); orgSubTeams(n.id).forEach(k => { k.parent = up ? up.id : ''; });
    orgPeople().forEach(p => { p.teams = (p.teams || []).filter(m => m.team !== n.id); });
    state.org = orgNodes().filter(x => x.id !== n.id); orgDlg.fresh = false; closeOrg(); orgChanged(true);
  });
  s.addEventListener('click', e => { if (e.target === s || e.target.closest('[data-x]')) closeOrg(); });
  (ro ? q('[data-x]') : q('#oName')).focus();
}

function initOrg() {
  const box = $('vOrg'); if (!box) return;
  box.addEventListener('click', e => {
    if (readOnly && !e.target.closest('[data-pid]')) return;
    const pa = e.target.closest('[data-padd]'); if (pa) { const n = newOrgNode('person'); if (n) { orgAddTo(n, pa.dataset.padd); orgChanged(true); openOrg(n.id, true); } return; }
    const ta = e.target.closest('[data-tadd]'); if (ta) { const n = newOrgNode('team', { parent: ta.dataset.tadd === '' ? '' : Number(ta.dataset.tadd) }); if (n) { orgChanged(true); openOrg(n.id, true); } return; }
    const te = e.target.closest('[data-tedit]'); if (te) { openOrg(+te.dataset.tedit); return; }
    const rm = e.target.closest('[data-orm]'); if (rm) { const k = rm.dataset.orm.indexOf(':'), p = orgById(Number(rm.dataset.orm.slice(0, k))); if (p) { orgRemoveFrom(p, rm.dataset.orm.slice(k + 1)); orgChanged(true); } return; }
    if (e.target.closest('#orgAddMode')) { orgAddMode = !orgAddMode; renderOrg(); return; }
    if (e.target.id === 'orgImport') {
      if (hasUserDirectory()) assigneeTeam().forEach(u => { if (!orgPeople().some(n => String(n.uid) === String(u.id))) newOrgNode('person', { uid: String(u.id), name: u.name }); });
      else (state.people || []).forEach(p => { if (!orgPeople().some(n => orgName(n).toLowerCase() === String(p).toLowerCase())) newOrgNode('person', { name: String(p) }); });
      orgChanged(true); toast('Teammitglieder übernommen. Ziehe sie jetzt in die Teams.'); return;
    }
    const pc = e.target.closest('[data-pid]'); if (pc && !e.target.closest('button')) { openOrg(+pc.dataset.pid); return; }
    const th = e.target.closest('.oth'); if (th && !e.target.closest('button')) openOrg(+th.closest('[data-tid]').dataset.tid);
  });
  // Ziehen: Personen in Projektleitung, Teamleitung, Teammitglieder oder „Noch ohne Team“; Teams auf Teams (Unterteam) oder die Projektleitung
  const copyKey = e => orgAddMode || e.ctrlKey || e.altKey || e.metaKey;
  box.addEventListener('dragstart', e => {
    if (readOnly) return;
    const p = e.target.closest('[data-pid]'), t = e.target.closest('[data-tdrag]');
    if (p) orgDrag = { pid: +p.dataset.pid, from: p.dataset.from };
    else if (t) orgDrag = { tid: +t.dataset.tdrag };
    else return;
    e.stopPropagation(); e.dataTransfer.effectAllowed = 'copyMove'; try { e.dataTransfer.setData('text/plain', 'org'); } catch (x) { }
    (p || t).classList.add('drag'); box.classList.add('odragging');
  });
  const clear = () => { orgDrag = null; box.classList.remove('odragging'); box.querySelectorAll('.drag, .over').forEach(x => x.classList.remove('drag', 'over')); };
  box.addEventListener('dragend', clear);
  const target = e => {
    if (!orgDrag) return null;
    if (orgDrag.pid != null) { const z = e.target.closest('[data-drop]'); return z ? { el: z, to: z.dataset.drop } : null; }
    // Team ziehen: auf ein anderes Team (nicht in die eigenen Unterteams) oder auf die Projektleitung
    const pl = e.target.closest('.plbox'); if (pl) return { el: pl, team: '' };
    const tb = e.target.closest('[data-tid]'); if (!tb) return null;
    const id = +tb.dataset.tid; if (id === orgDrag.tid || orgTeamDesc(orgDrag.tid).has(id)) return null;
    return { el: tb, team: id };
  };
  box.addEventListener('dragover', e => {
    const t = target(e); box.querySelectorAll('.over').forEach(x => { if (!t || x !== t.el) x.classList.remove('over'); }); if (!t) return;
    e.preventDefault(); e.dataTransfer.dropEffect = copyKey(e) && orgDrag.pid != null ? 'copy' : 'move'; t.el.classList.add('over');
  });
  box.addEventListener('drop', e => {
    const t = target(e); if (!t) return; e.preventDefault();
    const d = orgDrag; clear();
    if (d.tid != null) { const tm = orgById(d.tid); if (tm) { tm.parent = t.team; orgChanged(true); } return; }
    const p = orgById(d.pid); if (!p || t.to === d.from) return;
    if (t.to === 'none') { if (!copyKey(e)) orgRemoveFrom(p, d.from); orgChanged(true); return; }
    // Verschieben innerhalb desselben Teams (Mitglied <-> Teamleitung) ändert nur die Funktion
    const sameTeam = /^t[lm]:/.test(d.from) && /^t[lm]:/.test(t.to) && d.from.slice(3) === t.to.slice(3);
    if (!copyKey(e) && !sameTeam) orgRemoveFrom(p, d.from);
    if (!orgAddTo(p, t.to) && copyKey(e)) toast('Die Person ist dort schon zugeordnet.');
    orgChanged(true);
  });
}
