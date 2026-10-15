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
  function chrome() {
    const btn = document.getElementById('openPanel'); if (!btn || document.getElementById('logoutBtn')) return;
    const mk = (id, txt, fn) => { const b = document.createElement('button'); b.className = 'btn'; b.id = id; b.type = 'button'; b.textContent = txt; b.addEventListener('click', fn); btn.parentNode.insertBefore(b, btn); return b; };
    if (me.role === 'admin') mk('adminBtn', 'Verwaltung', () => { location.href = 'admin.html'; });
    mk('logoutBtn', 'Abmelden (' + me.name + ')', async () => { try { await post('logout'); } catch (e) { } location.reload(); });
  }
  function chips(list) {
    const box = document.getElementById('online'); if (!box) return; box.innerHTML = '';
    const cur = window.__cur ? window.__cur() : null;
    list.forEach(p => {
      const c = document.createElement('span'); c.className = 'chip' + (p.project === cur ? ' here' : '');
      c.textContent = p.name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
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
      await ensureLogin(); chrome();
      const col = makeCol(); col.uid = me.id; col.readOnly = me.role === 'viewer'; return col;
    }
  };
})();
