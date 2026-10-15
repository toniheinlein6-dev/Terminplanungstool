/* Anbindung an den eigenen Server (Vercel-Funktion /api/tp, Postgres). Ersetzt die Claude-Speicherung. */
(function () {
  'use strict';
  window.NO_LOCAL = true; window.WEB_DOWNLOAD = true;
  let me = null;
  const api = (a, opt) => fetch('api/tp?a=' + a, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opt));
  const post = (a, body) => api(a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TP': '1' }, body: JSON.stringify(body || {}) });

  function loginOverlay() {
    return new Promise(resolve => {
      const o = document.createElement('div');
      o.style.cssText = 'position:fixed;inset:0;z-index:99;display:flex;align-items:center;justify-content:center;background:var(--bg,#f1f4f2);padding:16px';
      o.innerHTML = '<form style="background:var(--panel,#fff);color:var(--ink,#1c2a25);border:1px solid var(--line,#d5ddd9);border-radius:12px;padding:24px;width:min(360px,100%);display:flex;flex-direction:column;gap:10px;box-sizing:border-box">' +
        '<h2 style="margin:0 0 6px;font-size:18px">Terminplaner</h2><label style="font-size:12px">Name<input id="lgN" class="in" autocomplete="username" required style="width:100%;box-sizing:border-box;margin-top:4px"></label>' +
        '<label style="font-size:12px">Passwort<input id="lgP" class="in" type="password" autocomplete="current-password" required style="width:100%;box-sizing:border-box;margin-top:4px"></label>' +
        '<div id="lgE" style="color:#b3392b;font-size:13px;min-height:18px"></div><button class="btn" style="background:var(--accent,#2f5d50);color:#fff;border-color:transparent">Anmelden</button></form>';
      document.body.appendChild(o);
      const f = o.querySelector('form'), e = o.querySelector('#lgE'); o.querySelector('#lgN').focus();
      f.addEventListener('submit', async ev => {
        ev.preventDefault(); e.textContent = '';
        try {
          const r = await post('login', { name: o.querySelector('#lgN').value, password: o.querySelector('#lgP').value }); const j = await r.json();
          if (!r.ok) { e.textContent = j.error || 'Anmeldung fehlgeschlagen'; return; }
          me = j.user; o.remove(); resolve();
        } catch (x) { e.textContent = 'Server nicht erreichbar'; }
      });
    });
  }
  async function ensureLogin() {
    let r;
    try { r = await api('me'); } catch (e) { throw new Error('Server nicht erreichbar'); }
    if (r.ok) { me = (await r.json()).user; return; }
    if (r.status === 401) {
      try { const s = await (await api('setup_state')).json(); if (s.needsSetup) { location.href = 'setup.html'; return new Promise(() => { }); } } catch (e) { }
      await loginOverlay(); return;
    }
    let msg = 'Serverfehler'; try { msg = (await r.json()).error || msg; } catch (e) { } throw new Error(msg);
  }
  async function call(fn) {   // führt einen Aufruf aus; bei abgelaufener Sitzung erneut anmelden
    let r = await fn(); if (r.status === 401) { await loginOverlay(); r = await fn(); } return r;
  }
  /* ---------- Team, Profilbilder ---------- */
  let team = [], teamKey = '', openTickets = 0;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const COLORS = ['#3d7e5e', '#2f6fb2', '#8a5cb8', '#b0612a', '#2a8c8c', '#a33f6d', '#5f6f2a'];
  const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  const colorOf = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const findMember = n => { const k = String(n || '').trim().toLowerCase(); return team.find(m => m.name.trim().toLowerCase() === k) || null; };
  function avatarHtml(name, url, cls) {
    return url ? '<img class="av ' + (cls || '') + '" src="' + esc(url) + '" alt="">'
      : '<span class="av ini ' + (cls || '') + '" style="background:' + colorOf(name) + '" aria-hidden="true">' + esc(initials(name)) + '</span>';
  }
  // für die Ansichten: Profilbilder zu den Namen in „Verantwortlich“ (nur für Namen, die einem Benutzer entsprechen)
  window.tpAvatars = who => String(who || '').split(/\s*(?:,|;|\/|&|\+|\bund\b)\s*/i).filter(Boolean)
    .map(n => findMember(n)).filter(Boolean).map(m => avatarHtml(m.name, m.avatar)).join('');
  window.TP_TEAM_NAMES = () => team.map(m => m.name);
  async function loadTeam() {
    try {
      const r = await api('team'); if (!r.ok) return;
      const t = (await r.json()).team || []; const key = JSON.stringify(t);
      if (key !== teamKey) { teamKey = key; team = t; if (window.__teamChanged) window.__teamChanged(); paintMenuButton(); }
    } catch (e) { }
  }
  async function refreshMe() {
    try { const r = await api('me'); if (r.ok) { const j = await r.json(); me = j.user; openTickets = j.openTickets || 0; paintMenuButton(); } } catch (e) { }
  }

  /* ---------- Benutzermenü ---------- */
  function paintMenuButton() {
    const b = document.getElementById('userBtn'); if (!b || !me) return;
    const m = findMember(me.name);
    b.innerHTML = avatarHtml(me.name, (m && m.avatar) || me.avatar) + '<span class="un">' + esc(me.name) + '</span>' + (openTickets && me.role === 'admin' ? '<span class="badge" title="Offene Tickets">' + openTickets + '</span>' : '') + '<span class="caret" aria-hidden="true">▾</span>';
  }
  function chrome() {
    const anchor = document.getElementById('openPanel'); if (!anchor || document.getElementById('userBtn')) return;
    const wrap = document.createElement('div'); wrap.className = 'umenu-wrap';
    wrap.innerHTML = '<button class="btn userbtn" id="userBtn" type="button" aria-haspopup="menu" aria-expanded="false"></button>' +
      '<div class="umenu" id="userMenu" role="menu" hidden>' +
      '<button type="button" role="menuitem" data-m="profile">Mein Profil und Passwort</button>' +
      '<button type="button" role="menuitem" data-m="ticket">Idee oder Problem melden</button>' +
      (me.role === 'admin' ? '<button type="button" role="menuitem" data-m="admin">Verwaltung</button>' : '') +
      '<button type="button" role="menuitem" data-m="logout">Abmelden</button></div>';
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    const btn = wrap.querySelector('#userBtn'), menu = wrap.querySelector('#userMenu');
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    const positionMenu = () => {
      if (menu.hidden) return;
      menu.style.transform = '';
      const edge = 8, width = document.documentElement.clientWidth;
      menu.style.maxWidth = Math.max(0, width - edge * 2) + 'px';
      const rect = menu.getBoundingClientRect();
      const shift = Math.max(edge - rect.left, Math.min(0, width - edge - rect.right));
      menu.style.transform = 'translateX(' + shift + 'px)';
    };
    btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) { positionMenu(); menu.querySelector('button').focus(); } });
    window.addEventListener('resize', positionMenu);
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    menu.addEventListener('click', async e => {
      const it = e.target.closest('[data-m]'); if (!it) return; close();
      const m = it.dataset.m;
      if (m === 'profile') profileDialog();
      else if (m === 'ticket') ticketDialog();
      else if (m === 'admin') location.href = 'admin.html';
      else if (m === 'logout') { try { await post('logout'); } catch (x) { } location.reload(); }
    });
    paintMenuButton();
  }

  /* ---------- Dialoge ---------- */
  function dialog(title, html) {
    const s = document.createElement('div'); s.className = 'scrim';
    s.innerHTML = '<div class="panel" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="head"><h2>' + esc(title) + '</h2><button class="btn" type="button" data-close>Schließen</button></div>' + html + '</div>';
    document.body.appendChild(s);
    const close = () => { s.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    s.addEventListener('click', e => { if (e.target === s || e.target.closest('[data-close]')) close(); });
    return { el: s, close };
  }
  async function toAvatar(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const sz = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas'); c.width = c.height = 192;
      c.getContext('2d').drawImage(img, (img.naturalWidth - sz) / 2, (img.naturalHeight - sz) / 2, sz, sz, 0, 0, 192, 192);
      return c.toDataURL('image/jpeg', 0.85);
    } finally { URL.revokeObjectURL(url); }
  }
  async function profileDialog() {
    await refreshMe();
    let avatar = me.avatar || null, avatarChanged = false;
    const d = dialog('Mein Profil', '<div class="prof">' +
      '<div><h3>Profilbild</h3><div class="avrow"><span id="pAv"></span><div class="btns"><label class="btn" for="pFile">Bild wählen</label><input id="pFile" type="file" accept="image/*" hidden><button class="btn" type="button" id="pAvDel">Entfernen</button></div></div><p class="hint">Das Bild wird quadratisch zugeschnitten und verkleinert.</p></div>' +
      '<div><h3>E-Mail und Erinnerungen</h3><label class="pf">E-Mail-Adresse<input id="pMail" class="in" type="email" autocomplete="email" value="' + esc(me.email) + '"></label>' +
      '<label class="chk"><input type="checkbox" id="pRemind"' + (me.remind ? ' checked' : '') + '> Erinnerung per E-Mail 2 Tage vor dem Ende meiner Vorgänge</label>' +
      '<p class="hint">Erinnert wird an Vorgänge, bei denen unter „Verantwortlich“ <b>' + esc(me.name) + '</b> eingetragen ist.</p>' +
      '<div class="btns"><button class="btn primary" type="button" id="pSave">Profil speichern</button><span id="pMsg" class="msg"></span></div></div>' +
      '<div><h3>Passwort ändern</h3><label class="pf">Bisheriges Passwort<input id="pOld" class="in" type="password" autocomplete="current-password"></label>' +
      '<label class="pf">Neues Passwort (mindestens 8 Zeichen)<input id="pNew" class="in" type="password" autocomplete="new-password"></label>' +
      '<label class="pf">Neues Passwort wiederholen<input id="pNew2" class="in" type="password" autocomplete="new-password"></label>' +
      '<div class="btns"><button class="btn" type="button" id="pPw">Passwort ändern</button><span id="pwMsg" class="msg"></span></div>' +
      '<p class="hint">Nach der Änderung wirst du auf anderen Geräten abgemeldet.</p></div></div>');
    const $d = id => d.el.querySelector('#' + id);
    const paint = () => { $d('pAv').innerHTML = avatarHtml(me.name, avatar, 'big'); $d('pAvDel').disabled = !avatar; };
    const say = (id, t, bad) => { const m = $d(id); m.textContent = t; m.classList.toggle('bad', !!bad); };
    paint();
    $d('pFile').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
      try { avatar = await toAvatar(f); avatarChanged = true; paint(); say('pMsg', 'Bild übernommen, bitte speichern.'); }
      catch (x) { say('pMsg', 'Dieses Bildformat kann der Browser nicht lesen. Bitte JPG oder PNG verwenden.', true); }
    });
    $d('pAvDel').addEventListener('click', () => { avatar = null; avatarChanged = true; paint(); say('pMsg', 'Bild entfernt, bitte speichern.'); });
    $d('pSave').addEventListener('click', async () => {
      const body = { email: $d('pMail').value.trim(), remind: $d('pRemind').checked }; if (avatarChanged) body.avatar = avatar;
      const r = await post('profile_save', body); const j = await r.json().catch(() => ({}));
      if (!r.ok) { say('pMsg', j.error || 'Speichern fehlgeschlagen', true); return; }
      avatarChanged = false; say('pMsg', 'Gespeichert.'); await refreshMe(); teamKey = ''; loadTeam();
    });
    $d('pPw').addEventListener('click', async () => {
      const o = $d('pOld').value, n = $d('pNew').value, n2 = $d('pNew2').value;
      if (n.length < 8) { say('pwMsg', 'Das neue Passwort braucht mindestens 8 Zeichen.', true); return; }
      if (n !== n2) { say('pwMsg', 'Die beiden neuen Passwörter stimmen nicht überein.', true); return; }
      const r = await post('password', { old: o, password: n }); const j = await r.json().catch(() => ({}));
      if (!r.ok) { say('pwMsg', j.error || 'Ändern fehlgeschlagen', true); return; }
      $d('pOld').value = $d('pNew').value = $d('pNew2').value = ''; say('pwMsg', 'Passwort geändert.');
    });
  }
  const KINDS = { idee: 'Idee', problem: 'Problem', frage: 'Frage' };
  const STATES = { neu: 'Neu', arbeit: 'In Bearbeitung', erledigt: 'Erledigt', abgelehnt: 'Abgelehnt' };
  async function ticketDialog() {
    const cur = window.__cur ? window.__cur() : null, pname = (document.getElementById('pname') || {}).value || '';
    const d = dialog('Idee oder Problem melden', '<div class="tk">' +
      '<div class="seg" id="tKind" role="group" aria-label="Art">' + Object.entries(KINDS).map(([k, t], i) => '<button type="button" data-k="' + k + '" aria-pressed="' + (i === 0) + '">' + t + '</button>').join('') + '</div>' +
      '<label class="pf">Titel<input id="tTitle" class="in" maxlength="200" placeholder="Kurz und klar, z. B. „PDF-Schrift zu klein“"></label>' +
      '<label class="pf">Beschreibung<textarea id="tBody" class="in" rows="5" maxlength="8000" placeholder="Was ist passiert, was wünschst du dir?"></textarea></label>' +
      (cur ? '<label class="chk"><input type="checkbox" id="tProj" checked> betrifft das Projekt „' + esc(pname || 'Ohne Namen') + '“</label>' : '') +
      '<div class="btns"><button class="btn primary" type="button" id="tSend">An die Administratoren senden</button><span id="tMsg" class="msg"></span></div>' +
      '<h3>Meine Tickets</h3><div id="tList" class="tlist">Wird geladen …</div></div>');
    const $d = id => d.el.querySelector('#' + id);
    let kind = 'idee';
    $d('tKind').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; $d('tKind').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
    const list = async () => {
      const r = await api('tickets'); if (!r.ok) { $d('tList').textContent = 'Konnte nicht geladen werden.'; return; }
      const mine = (await r.json()).tickets.filter(t => t.own);
      $d('tList').innerHTML = mine.length ? mine.map(t => '<article class="tcard"><div class="tmeta"><span class="tkind k-' + t.kind + '">' + KINDS[t.kind] + '</span><span class="tst s-' + t.status + '">' + STATES[t.status] + '</span><span>' + new Date(t.createdAt).toLocaleDateString('de-DE') + '</span></div>' +
        '<b>' + esc(t.title) + '</b>' + (t.note ? '<div class="tnote"><span>Antwort:</span> ' + esc(t.note) + '</div>' : '') + '</article>').join('') : '<p class="hint">Du hast noch keine Tickets geschickt.</p>';
    };
    list();
    $d('tSend').addEventListener('click', async () => {
      const title = $d('tTitle').value.trim(), m = $d('tMsg');
      if (title.length < 3) { m.textContent = 'Bitte einen Titel angeben.'; m.classList.add('bad'); $d('tTitle').focus(); return; }
      const body = { kind, title, body: $d('tBody').value.trim(), projectId: cur && $d('tProj') && $d('tProj').checked ? cur : null };
      const r = await post('ticket_new', body); const j = await r.json().catch(() => ({}));
      if (!r.ok) { m.textContent = j.error || 'Senden fehlgeschlagen'; m.classList.add('bad'); return; }
      m.classList.remove('bad'); m.textContent = 'Danke, ist angekommen.'; $d('tTitle').value = $d('tBody').value = ''; list();
    });
    $d('tTitle').focus();
  }
  function chips(list) {
    const box = document.getElementById('online'); if (!box) return; box.innerHTML = '';
    const cur = window.__cur ? window.__cur() : null;
    list.forEach(p => {
      const m = findMember(p.name), c = document.createElement('span'); c.className = 'chip' + (p.project === cur ? ' here' : '') + (m && m.avatar ? ' pic' : '');
      c.innerHTML = m && m.avatar ? '<img src="' + esc(m.avatar) + '" alt="">' : esc(initials(p.name));
      if (!(m && m.avatar)) c.style.setProperty('--c', colorOf(p.name));
      c.title = p.name + (p.project === cur ? ' ist in diesem Projekt' : ' ist online'); box.appendChild(c);
    });
  }

  function makeCol() {
    const ver = new Map(); let cb = null, errCb = null, timer = 0, firstDone = false, stopped = false, fails = 0;
    const docOf = r => ({ id: r.id, exists: true, data: () => ({ json: r.json, savedAt: r.savedAt, by: r.by, byName: r.byName }) });
    async function poll() {
      if (stopped) return;
      try {
        const r = await call(() => api('list&p=' + encodeURIComponent(window.__cur ? window.__cur() : '')));
        if (!r.ok) throw new Error('http ' + r.status);
        const l = await r.json(), seen = new Set(), changes = []; fails = 0;
        for (const it of l.projects) {
          seen.add(it.id); if (ver.get(it.id) === it.version) continue;
          const g = await call(() => api('get&id=' + encodeURIComponent(it.id))); if (!g.ok) continue;
          const row = await g.json(); const had = ver.has(it.id); ver.set(it.id, row.version);
          changes.push({ type: had ? 'modified' : 'added', doc: docOf(row) });
        }
        for (const id of [...ver.keys()]) if (!seen.has(id)) { ver.delete(id); changes.push({ type: 'removed', doc: { id, exists: true, data: () => ({}) } }); }
        chips(l.online || []);
        if (!firstDone) { firstDone = true; cb({ docs: changes.map(c => c.doc), docChanges: () => changes }); }
        else if (changes.length) cb({ docs: [], docChanges: () => changes });
      } catch (e) { fails++; if (errCb && (!firstDone || fails === 3)) errCb(e); }
      timer = setTimeout(poll, document.hidden ? 20000 : 3000);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && firstDone) { clearTimeout(timer); poll(); } });
    return {
      uid: null,
      onSnapshot(next, error) { cb = next; errCb = error; poll(); return () => { stopped = true; clearTimeout(timer); }; },
      doc(id) {
        return {
          async set(v) {
            const r = await call(() => post('put', { id, json: v.json, base: ver.get(id) || 0 }));
            const j = await r.json().catch(() => ({}));
            if (r.status === 409) { if (j.current) { ver.set(id, j.current.version); throw { code: 'conflict', doc: { json: j.current.json, savedAt: j.current.savedAt, by: j.current.by, byName: j.current.byName } }; } throw { code: 'conflict' }; }
            if (r.status === 403) throw { code: 'forbidden' };
            if (!r.ok) throw { code: 'http', status: r.status, message: j.error };
            ver.set(id, j.version);
          },
          async delete() { const r = await call(() => post('del', { id })); ver.delete(id); if (r.status === 403) throw { code: 'forbidden' }; }
        };
      }
    };
  }

  window.SP = {
    async connect(cfg, status) {
      status('saving', 'Anmeldung …');
      await ensureLogin(); await refreshMe(); chrome(); await loadTeam();
      setInterval(() => { if (!document.hidden) { loadTeam(); if (me && me.role === 'admin') refreshMe(); } }, 60000);
      const col = makeCol(); col.uid = me.id; col.readOnly = me.role === 'viewer'; return col;
    }
  };
})();
