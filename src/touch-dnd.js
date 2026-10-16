/* ---------- Ziehen und Ablegen mit dem Finger (Kanban, Organigramm) ---------- */
// Mobile Browser kennen das Ziehen von Elementen mit draggable="true" nur mit der Maus.
// Hier: langes Drücken startet das Ziehen, eine Vorschau folgt dem Finger, und dieselben
// dragstart/dragover/drop/dragend-Ereignisse wie bei der Maus werden ausgelöst.
// Kurzes Tippen und normales Wischen (Scrollen) bleiben unverändert.
function initTouchDnD() {
  if (typeof DataTransfer === 'undefined') return;
  const ZONES = '#vKanban, #vOrg', HOLD = 280, SLOP = 10;
  let t = null;   // { src, x0, y0, timer, on, ghost, dt, last, ok, dx, dy }
  const fire = (el, type, x, y, dt) => {
    let ev;
    try { ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }); }
    catch (e) { ev = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'dataTransfer', { value: dt }); }
    el.dispatchEvent(ev); return ev;
  };
  const scrollParents = el => { const out = []; for (let p = el; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) out.push(p); } return out; };
  const stop = cancelled => {
    if (!t) return; clearTimeout(t.timer);
    if (t.on) {
      if (!cancelled && t.last && t.ok) fire(t.last, 'drop', t.cx, t.cy, t.dt);
      fire(t.src, 'dragend', t.cx, t.cy, t.dt);
      t.ghost.remove(); document.documentElement.classList.remove('tdrag');
    }
    t = null;
  };
  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || readOnly) { stop(true); return; }
    const src = e.target.closest && e.target.closest('[draggable="true"]');
    if (!src || !src.closest(ZONES) || e.target.closest('button, input, select, textarea, a')) return;
    const p = e.touches[0];
    t = { src, x0: p.clientX, y0: p.clientY, cx: p.clientX, cy: p.clientY, on: false };
    t.timer = setTimeout(() => {
      if (!t) return;
      const r = src.getBoundingClientRect();
      t.dt = new DataTransfer(); t.on = true;
      const ev = fire(src, 'dragstart', t.cx, t.cy, t.dt);
      if (ev.defaultPrevented) { t = null; return; }
      const g = src.cloneNode(true); g.classList.remove('drag', 'over'); g.classList.add('tghost'); g.removeAttribute('id');
      g.style.width = r.width + 'px'; t.dx = t.cx - r.left; t.dy = t.cy - r.top;
      g.style.left = r.left + 'px'; g.style.top = r.top + 'px';
      document.body.appendChild(g); t.ghost = g;
      document.documentElement.classList.add('tdrag');
      if (navigator.vibrate) try { navigator.vibrate(12); } catch (x) { }
    }, HOLD);
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!t) return;
    const p = e.touches[0]; t.cx = p.clientX; t.cy = p.clientY;
    if (!t.on) { if (Math.hypot(t.cx - t.x0, t.cy - t.y0) > SLOP) { clearTimeout(t.timer); t = null; } return; }   // Wischen = Scrollen
    e.preventDefault();
    t.ghost.style.left = (t.cx - t.dx) + 'px'; t.ghost.style.top = (t.cy - t.dy) + 'px';
    const el = document.elementFromPoint(t.cx, t.cy); if (!el) return;
    t.last = el; t.ok = fire(el, 'dragover', t.cx, t.cy, t.dt).defaultPrevented;
    // Am Rand weiterscrollen (Kanban-Bahnen nebeneinander, großes Organigramm)
    const edge = 40, W = innerWidth, H = innerHeight;
    let vx = t.cx < edge ? -12 : t.cx > W - edge ? 12 : 0;
    let vy = t.cy < edge + 60 ? -12 : t.cy > H - edge - 70 ? 12 : 0;
    for (const s of (vx || vy) ? scrollParents(el) : []) {
      if (vx) { const b = s.scrollLeft; s.scrollLeft += vx; if (s.scrollLeft !== b) vx = 0; }
      if (vy) { const b = s.scrollTop; s.scrollTop += vy; if (s.scrollTop !== b) vy = 0; }
      if (!vx && !vy) break;
    }
    if (vy) window.scrollBy(0, vy);   // sonst die ganze Seite
  }, { passive: false });
  document.addEventListener('touchend', e => { if (t && t.on) e.preventDefault(); stop(false); }, { passive: false });
  document.addEventListener('touchcancel', () => stop(true));
  // Manche Browser (neueres Android/iOS) starten das Ziehen selbst: dann nur eine der beiden Varianten zulassen
  document.addEventListener('dragstart', e => {
    if (!t || !e.isTrusted) return;
    if (t.on) { e.preventDefault(); e.stopImmediatePropagation(); }
    else { clearTimeout(t.timer); t = null; }
  }, true);
  // Kein Kontextmenü beim langen Drücken auf ziehbare Karten
  document.addEventListener('contextmenu', e => { const s = e.target.closest && e.target.closest('[draggable="true"]'); if (s && s.closest(ZONES)) e.preventDefault(); });
}
// Gerät wird vorwiegend per Finger bedient (Handy, Tablet)
function isTouchUI() { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } }
