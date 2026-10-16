/* Anbindung an den eigenen Server (Vercel-Funktion /api/tp, Postgres). Ersetzt die Claude-Speicherung. */
(function () {
  'use strict';
  window.NO_LOCAL = true; window.WEB_DOWNLOAD = true;
  let me = null;
  const api = (a, opt) => fetch('api/tp?a=' + a, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opt));
  // CSRF-Token der Sitzung: kommt mit „me“ und der Anmeldung, geht als X-CSRF mit jeder Änderung mit
  let csrf = '';
  const takeCsrf = j => { if (j && j.csrf) csrf = j.csrf; return j; };
  async function post(a, body) {
    const go = () => api(a, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TP': '1', 'X-CSRF': csrf }, body: JSON.stringify(body || {}) });
    let r = await go();
    if (r.status === 403) {   // Token abgelaufen (z. B. neue Sitzung in anderem Tab): neu holen und einmal wiederholen
      const j = await r.clone().json().catch(() => ({}));
      if (j.error === 'csrf') { try { const m = await api('me'); if (m.ok) takeCsrf(await m.json()); } catch (e) { } r = await go(); }
    }
    return r;
  }

  // Auge neben Passwortfeldern: Eingabe sichtbar machen und wieder verbergen
  const EYE = 'M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z';
  const eyeSvg = off => '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + EYE + (off ? 'M2.5 2.5l11 11' : '') + '"/></svg>';
  function pwEyes(root) {
    root.querySelectorAll('input[type="password"]:not([data-eye])').forEach(inp => {
      inp.dataset.eye = '1';
      const w = document.createElement('span'); w.className = 'pwwrap'; inp.parentNode.insertBefore(w, inp); w.appendChild(inp);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pweye';
      const set = show => { inp.type = show ? 'text' : 'password'; b.innerHTML = eyeSvg(show); b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen'); b.title = b.getAttribute('aria-label'); };
      b.addEventListener('click', () => { set(inp.type === 'password'); inp.focus(); });
      inp.__hide = () => set(false); set(false); w.appendChild(b);
    });
  }
  const FORM = 'background:var(--panel,#fff);color:var(--ink,#1c2a25);border:1px solid var(--line,#d5ddd9);border-radius:12px;padding:24px;width:min(360px,100%);display:flex;flex-direction:column;gap:10px;box-sizing:border-box';
  const INP = 'width:100%;box-sizing:border-box;margin-top:4px';
  const BTN = 'background:var(--accent,#2f5d50);color:#fff;border-color:transparent';
  function overlay(html) {
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;z-index:99;display:flex;align-items:center;justify-content:center;background:var(--bg,#f1f4f2);padding:16px';
    o.innerHTML = html; document.body.appendChild(o); pwEyes(o); return o;
  }
  function loginOverlay() {
    return new Promise(resolve => {
      const o = overlay('<form style="' + FORM + '" id="lgF">' +
        '<h2 style="margin:0 0 6px;font-size:18px">Terminplaner</h2><label style="font-size:12px">Name<input id="lgN" class="in" autocomplete="username" required maxlength="80" style="' + INP + '"></label>' +
        '<label style="font-size:12px">Passwort<input id="lgP" class="in" type="password" autocomplete="current-password" required maxlength="256" style="' + INP + '"></label>' +
        '<div id="lgE" style="color:#b3392b;font-size:13px;min-height:18px" role="alert"></div><button class="btn" style="' + BTN + '">Anmelden</button>' +
        '<button type="button" class="linkb" id="lgForgot" style="align-self:flex-start;font-size:12.5px">Passwort vergessen?</button>' +
        '<a href="datenschutz.html" style="font-size:12px;color:var(--muted,#5f6f68)">Datenschutz</a></form>' +
        '<form style="' + FORM + '" id="fgF" hidden><h2 style="margin:0 0 6px;font-size:18px">Passwort vergessen</h2>' +
        '<p style="margin:0;font-size:13px">Gib deinen Namen oder deine E-Mail-Adresse ein. Ist im Konto eine E-Mail-Adresse hinterlegt, bekommst du einen Link zum Festlegen eines neuen Passworts.</p>' +
        '<label style="font-size:12px">Name oder E-Mail-Adresse<input id="fgN" class="in" autocomplete="username" required maxlength="200" style="' + INP + '"></label>' +
        '<div id="fgM" style="font-size:13px;min-height:18px" role="status"></div><button class="btn" style="' + BTN + '">Link anfordern</button>' +
        '<button type="button" class="linkb" id="fgBack" style="align-self:flex-start;font-size:12.5px">Zurück zur Anmeldung</button></form>');
      const f = o.querySelector('#lgF'), e = o.querySelector('#lgE'), fg = o.querySelector('#fgF'); o.querySelector('#lgN').focus();
      o.querySelector('#lgForgot').addEventListener('click', () => { f.hidden = true; fg.hidden = false; o.querySelector('#fgN').value = o.querySelector('#lgN').value; o.querySelector('#fgN').focus(); });
      o.querySelector('#fgBack').addEventListener('click', () => { fg.hidden = true; f.hidden = false; o.querySelector('#lgN').focus(); });
      fg.addEventListener('submit', async ev => {
        ev.preventDefault(); const m = o.querySelector('#fgM');
        try { const r = await post('reset_request', { name: o.querySelector('#fgN').value }); const j = await r.json(); m.textContent = r.ok ? j.message : (j.error || 'Anfrage fehlgeschlagen'); }
        catch (x) { m.textContent = 'Server nicht erreichbar'; }
      });
      f.addEventListener('submit', async ev => {
        ev.preventDefault(); e.textContent = '';
        try {
          const r = await post('login', { name: o.querySelector('#lgN').value, password: o.querySelector('#lgP').value }); const j = await r.json();
          if (!r.ok) { e.textContent = j.error || 'Anmeldung fehlgeschlagen'; return; }
          takeCsrf(j); me = j.user; o.remove(); resolve();
        } catch (x) { e.textContent = 'Server nicht erreichbar'; }
      });
    });
  }
  // Link aus der E-Mail „Passwort vergessen“: #reset=<Token>; das Token wird sofort aus Adresse und Verlauf entfernt
  function resetOverlay(token) {
    return new Promise(resolve => {
      const o = overlay('<form style="' + FORM + '"><h2 style="margin:0 0 6px;font-size:18px">Neues Passwort festlegen</h2>' +
        '<label style="font-size:12px">Neues Passwort (mindestens 12 Zeichen)<input id="rsP" class="in" type="password" autocomplete="new-password" required minlength="12" maxlength="256" style="' + INP + '"></label>' +
        '<label style="font-size:12px">Neues Passwort wiederholen<input id="rsP2" class="in" type="password" autocomplete="new-password" required minlength="12" maxlength="256" style="' + INP + '"></label>' +
        '<div id="rsE" style="font-size:13px;min-height:18px" role="alert"></div><button class="btn" style="' + BTN + '">Passwort speichern</button>' +
        '<button type="button" class="linkb" id="rsSkip" style="align-self:flex-start;font-size:12.5px">Abbrechen</button></form>');
      const e = o.querySelector('#rsE'); o.querySelector('#rsP').focus();
      o.querySelector('#rsSkip').addEventListener('click', () => { o.remove(); resolve(); });
      o.querySelector('form').addEventListener('submit', async ev => {
        ev.preventDefault(); e.style.color = '#b3392b';
        const a = o.querySelector('#rsP').value, b = o.querySelector('#rsP2').value;
        if (a !== b) { e.textContent = 'Die beiden Passwörter stimmen nicht überein.'; return; }
        try {
          const r = await post('reset_confirm', { token, password: a }); const j = await r.json();
          if (!r.ok) { e.textContent = j.error || 'Speichern fehlgeschlagen'; return; }
          o.remove(); resolve();
        } catch (x) { e.textContent = 'Server nicht erreichbar'; }
      });
    });
  }
  async function ensureLogin() {
    const rm = /^#reset=([A-Za-z0-9_-]{40,60})$/.exec(location.hash || '');
    if (rm) { history.replaceState(null, '', location.pathname + location.search); await resetOverlay(rm[1]); }
    let r;
    try { r = await api('me'); } catch (e) { throw new Error('Server nicht erreichbar'); }
    if (r.ok) { me = takeCsrf(await r.json()).user; return; }
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
  window.TP_ME = () => me ? { id: String(me.id), name: me.name } : null;
  window.TP_TEAM = () => team.map(m => ({ id: m.id, name: m.name, avatar: m.avatar }));
  async function loadTeam() {
    try {
      const r = await api('team'); if (!r.ok) return;
      const t = (await r.json()).team || []; const key = JSON.stringify(t);
      if (key !== teamKey) { teamKey = key; team = t; if (window.__teamChanged) window.__teamChanged(); paintMenuButton(); }
    } catch (e) { }
  }
  async function refreshMe() {
    try { const r = await api('me'); if (r.ok) { const j = takeCsrf(await r.json()); me = j.user; openTickets = j.openTickets || 0; paintMenuButton(); } } catch (e) { }
  }

  /* ---------- Kommentare ---------- */
  let counts = {}, countsKey = '', changed = {};
  window.TP_CHANGES = { get: rowId => changed[rowId] || null };
  const curProj = () => (window.__cur ? window.__cur() : '') || '';
  window.TP_COMMENTS = {
    available: true,
    count: rowId => counts[rowId] || 0,
    async list(rowId) {
      const r = await call(() => api('comments&p=' + encodeURIComponent(curProj()) + '&r=' + rowId));
      if (!r.ok) throw new Error('Laden fehlgeschlagen');
      const j = await r.json(), cs = j.comments; counts[rowId] = cs.length;
      // Änderungen erscheinen als automatische Einträge im Verlauf
      const ch = (j.changes || []).map(x => ({ kind: 'change', id: 'x' + x.id, user: x.user, createdAt: x.at, firstAt: x.firstAt, action: x.action, body: x.text }));
      return cs.concat(ch).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    },
    async add(rowId, body) {
      const r = await call(() => post('comment_new', { projectId: curProj(), rowId, body })); const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Senden fehlgeschlagen');
      counts[rowId] = (counts[rowId] || 0) + 1; countsKey = ''; return j;
    },
    async del(id) { const r = await call(() => post('comment_del', { id })); if (!r.ok) throw new Error('Löschen fehlgeschlagen'); }
  };
  function setCounts(c, ch) {
    const k = curProj() + JSON.stringify(c || {}) + JSON.stringify(ch || {});
    if (k === countsKey) return; countsKey = k; counts = c || {}; changed = ch || {};
    if (window.__countsChanged) window.__countsChanged();
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
      (me.role === 'gantt' ? '' : '<button type="button" role="menuitem" data-m="ticket">Idee oder Problem melden</button>') +
      (me.role === 'admin' ? '<button type="button" role="menuitem" data-m="admin">Verwaltung</button>' : '') +
      (isStandalone() ? '' : '<button type="button" role="menuitem" data-m="install">Als App installieren</button>') +
      '<button type="button" role="menuitem" data-m="privacy">Datenschutz</button>' +
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
      else if (m === 'install') installApp();
      else if (m === 'privacy') window.open('datenschutz.html', '_blank', 'noopener');
      else if (m === 'logout') {
        try { await post('logout'); } catch (x) { }
        // Zwischengespeicherte Seiten der App (Service Worker) entfernen, damit auf geteilten Geräten nichts liegen bleibt
        try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch (x) { }
        location.reload();
      }
    });
    paintMenuButton();
  }

  /* ---------- Als App installieren (PWA) ---------- */
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
  window.addEventListener('appinstalled', () => { installEvt = null; });
  function isStandalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { }); });
  async function installApp() {
    if (installEvt) { const e = installEvt; installEvt = null; e.prompt(); try { await e.userChoice; } catch (x) { } return; }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    dialog('Als App installieren', '<div class="prof"><p>Der Terminplaner lässt sich wie eine App auf den Startbildschirm legen. Er startet dann ohne Browserleiste im Vollbild, mit eigenem Symbol.</p>' +
      (ios ? '<ol><li>Diese Seite in <b>Safari</b> öffnen.</li><li>Unten auf <b>Teilen</b> tippen (Quadrat mit Pfeil nach oben).</li><li><b>Zum Home-Bildschirm</b> wählen und mit <b>Hinzufügen</b> bestätigen.</li></ol>'
        : '<ol><li>Diese Seite in <b>Chrome</b> oder <b>Edge</b> öffnen.</li><li>Das Menü öffnen (⋮ bzw. ⋯).</li><li><b>App installieren</b> bzw. <b>Zum Startbildschirm hinzufügen</b> wählen.</li></ol>' +
          '<p class="hint">Am Computer erscheint in Chrome und Edge zusätzlich ein Installieren-Symbol rechts in der Adressleiste.</p>') +
      '<p class="hint">Angemeldet bleibst du wie im Browser. Neue Versionen lädt die App automatisch.</p></div>');
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
      '<div><h3>E-Mail und Erinnerungen</h3><label class="pf">E-Mail-Adresse<input id="pMail" class="in" type="email" autocomplete="email" maxlength="200" value="' + esc(me.email) + '"></label>' +
      '<label class="pf" id="pMailPwL" hidden>Aktuelles Passwort (zur Bestätigung der neuen Adresse)<input id="pMailPw" class="in" type="password" autocomplete="current-password"></label>' +
      '<label class="chk"><input type="checkbox" id="pRemind"' + (me.remind ? ' checked' : '') + '> Erinnerung per E-Mail 2 Tage vor dem Ende meiner Vorgänge und Aufgaben</label>' +
      '<label class="chk"><input type="checkbox" id="pWeekly"' + (me.weekly !== false ? ' checked' : '') + '> Wochenübersicht jeden Montag (meine Vorgänge und Aufgaben der Woche)</label>' +
      '<p class="hint">Erinnert wird an Vorgänge, denen du als Benutzer zugeordnet bist.</p>' +
      '<div class="btns"><button class="btn primary" type="button" id="pSave">Profil speichern</button><span id="pMsg" class="msg"></span></div></div>' +
      '<div><h3>Passwort ändern</h3><label class="pf">Bisheriges Passwort<input id="pOld" class="in" type="password" autocomplete="current-password"></label>' +
      '<label class="pf">Neues Passwort (mindestens 12 Zeichen, gern ein ganzer Satz)<input id="pNew" class="in" type="password" autocomplete="new-password" minlength="12" maxlength="256"></label>' +
      '<label class="pf">Neues Passwort wiederholen<input id="pNew2" class="in" type="password" autocomplete="new-password"></label>' +
      '<div class="btns"><button class="btn" type="button" id="pPw">Passwort ändern</button><span id="pwMsg" class="msg"></span></div>' +
      '<p class="hint">Nach der Änderung wirst du auf anderen Geräten abgemeldet.</p></div>' +
      '<div><h3>Meine Daten</h3><div class="btns"><button class="btn" type="button" id="pData">Meine Daten herunterladen</button><span id="dMsg" class="msg"></span></div>' +
      '<p class="hint">Alles, was der Terminplaner zu deinem Konto speichert: Profil, Zuordnungen, Kommentare, Tickets und Änderungen (JSON-Datei). <a href="datenschutz.html" target="_blank" rel="noopener">Datenschutzhinweise</a></p></div></div>');
    const $d = id => d.el.querySelector('#' + id);
    pwEyes(d.el);
    const paint = () => { $d('pAv').innerHTML = avatarHtml(me.name, avatar, 'big'); $d('pAvDel').disabled = !avatar; };
    const mailPw = () => { $d('pMailPwL').hidden = !me.email || $d('pMail').value.trim().toLowerCase() === String(me.email).toLowerCase(); };
    $d('pMail').addEventListener('input', mailPw);
    $d('pData').addEventListener('click', async () => {
      const r = await api('my_data'); if (!r.ok) { const j = await r.json().catch(() => ({})); say('dMsg', j.error || 'Nicht möglich', true); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'meine-daten-terminplaner.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); say('dMsg', 'Heruntergeladen.');
    });
    const say = (id, t, bad) => { const m = $d(id); m.textContent = t; m.classList.toggle('bad', !!bad); };
    paint();
    $d('pFile').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
      try { avatar = await toAvatar(f); avatarChanged = true; paint(); say('pMsg', 'Bild übernommen, bitte speichern.'); }
      catch (x) { say('pMsg', 'Dieses Bildformat kann der Browser nicht lesen. Bitte JPG oder PNG verwenden.', true); }
    });
    $d('pAvDel').addEventListener('click', () => { avatar = null; avatarChanged = true; paint(); say('pMsg', 'Bild entfernt, bitte speichern.'); });
    $d('pSave').addEventListener('click', async () => {
      const body = { email: $d('pMail').value.trim(), remind: $d('pRemind').checked, weekly: $d('pWeekly').checked, password: $d('pMailPw').value }; if (avatarChanged) body.avatar = avatar;
      const r = await post('profile_save', body); const j = await r.json().catch(() => ({}));
      if (!r.ok) { say('pMsg', j.error || 'Speichern fehlgeschlagen', true); return; }
      avatarChanged = false; say('pMsg', 'Gespeichert.'); $d('pMailPw').value = ''; await refreshMe(); mailPw(); teamKey = ''; loadTeam();
    });
    $d('pPw').addEventListener('click', async () => {
      const o = $d('pOld').value, n = $d('pNew').value, n2 = $d('pNew2').value;
      if (n.length < 12) { say('pwMsg', 'Das neue Passwort braucht mindestens 12 Zeichen.', true); return; }
      if (n !== n2) { say('pwMsg', 'Die beiden neuen Passwörter stimmen nicht überein.', true); return; }
      const r = await post('password', { old: o, password: n }); const j = await r.json().catch(() => ({}));
      if (!r.ok) { say('pwMsg', j.error || 'Ändern fehlgeschlagen', true); return; }
      takeCsrf(j);
      ['pOld', 'pNew', 'pNew2'].forEach(k => { const x = $d(k); x.value = ''; if (x.__hide) x.__hide(); }); say('pwMsg', 'Passwort geändert.');
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
      '<div class="btns"><button class="btn primary" type="button" id="tSend">An die Administratoren senden</button><span id="tMsg" class="msg" role="status" aria-live="polite"></span></div>' +
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
    list().catch(() => { $d('tList').textContent = 'Konnte nicht geladen werden.'; });
    let sending = false, submission = null;
    $d('tSend').addEventListener('click', async () => {
      if (sending) return;
      const title = $d('tTitle').value.trim(), m = $d('tMsg');
      if (title.length < 3) { m.textContent = 'Bitte einen Titel angeben.'; m.classList.add('bad'); $d('tTitle').focus(); return; }
      const body = { kind, title, body: $d('tBody').value.trim(), projectId: cur && $d('tProj') && $d('tProj').checked ? cur : null };
      const fingerprint = JSON.stringify(body);
      if (!submission || submission.fingerprint !== fingerprint) submission = { fingerprint, requestId: crypto.randomUUID() };
      const button = $d('tSend'), oldText = button.textContent;
      const controls = [$d('tTitle'), $d('tBody'), $d('tProj'), ...$d('tKind').querySelectorAll('button')].filter(Boolean);
      const disabled = controls.map(control => control.disabled);
      sending = true; button.disabled = true; button.textContent = 'Wird gesendet …';
      controls.forEach(control => { control.disabled = true; });
      m.classList.remove('bad'); m.textContent = 'Ticket wird gesendet …';
      try {
        const r = await post('ticket_new', { ...body, requestId: submission.requestId }); const j = await r.json().catch(() => ({}));
        if (!r.ok) { m.textContent = j.error || 'Senden fehlgeschlagen. Bitte erneut versuchen.'; m.classList.add('bad'); return; }
        submission = null;
        m.classList.remove('bad'); m.textContent = 'Danke, ist angekommen.'; $d('tTitle').value = $d('tBody').value = '';
        await list().catch(() => { $d('tList').textContent = 'Ticket gesendet. Die Liste konnte nicht geladen werden.'; });
      } catch (e) { m.textContent = 'Senden fehlgeschlagen. Bitte erneut versuchen.'; m.classList.add('bad'); }
      finally {
        sending = false; button.disabled = false; button.textContent = oldText;
        controls.forEach((control, i) => { control.disabled = disabled[i]; });
      }
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
        chips(l.online || []); setCounts(l.comments, l.changed);
        if (!firstDone) { firstDone = true; cb({ docs: changes.map(c => c.doc), docChanges: () => changes }); setTimeout(() => { if (window.__deepLink) window.__deepLink(); }, 50); }
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
            // Aufgaben, deren Zuständige sich geändert haben: Server benachrichtigt nach dem Speichern
            const pend = window.__tpNotify instanceof Set ? [...window.__tpNotify].filter(k => k.startsWith(id + ':')) : [];
            const r = await call(() => post('put', { id, json: v.json, base: ver.get(id) || 0, ...(pend.length ? { notify: pend.map(k => Number(k.slice(id.length + 1))) } : {}) }));
            if (r.ok) pend.forEach(k => window.__tpNotify.delete(k));
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
      const col = makeCol(); col.uid = me.id; col.readOnly = me.role === 'viewer' || me.role === 'gantt'; col.ganttOnly = me.role === 'gantt';
      if (col.ganttOnly) window.TP_COMMENTS.available = false;
      return col;
    }
  };
})();
