/* Passwörter nur während des Gedrückthaltens anzeigen (Maus, Touch und Tastatur). */
(function () {
  'use strict';
  const active = new Set();
  const hideAll = () => active.forEach(hide => hide());
  window.addEventListener('pointerup', hideAll);
  window.addEventListener('pointercancel', hideAll);
  window.addEventListener('blur', hideAll);
  window.addEventListener('pagehide', hideAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hideAll(); });
  const eye = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  window.tpPasswordEyes = function (root) {
    root.querySelectorAll('input[type="password"]:not([data-eye])').forEach(input => {
      input.dataset.eye = '1';
      const wrap = document.createElement('span'); wrap.className = 'pwwrap';
      input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'pweye'; button.innerHTML = eye;
      button.setAttribute('aria-label', 'Passwort anzeigen (gedrückt halten)');
      button.title = 'Gedrückt halten, um das Passwort anzuzeigen';
      const hide = () => { input.type = 'password'; button.setAttribute('aria-pressed', 'false'); active.delete(hide); };
      const show = () => {
        if (input.disabled || button.disabled) return;
        input.type = 'text'; button.setAttribute('aria-pressed', 'true'); active.add(hide);
      };
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        // Auch ein Loslassen außerhalb des Auges beendet die Anzeige.
        try { button.setPointerCapture(event.pointerId); } catch (e) { }
        show();
      });
      ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'].forEach(name => button.addEventListener(name, hide));
      input.addEventListener('blur', hide);
      button.addEventListener('contextmenu', event => { event.preventDefault(); });
      button.addEventListener('keydown', event => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault(); if (!event.repeat) show();
      });
      button.addEventListener('keyup', event => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault(); hide();
      });
      button.addEventListener('click', event => { event.preventDefault(); });
      input.__hide = hide; hide(); wrap.appendChild(button);
    });
  };
})();
