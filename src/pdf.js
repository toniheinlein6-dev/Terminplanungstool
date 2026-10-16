// ===== PDF-Ausgabe: eine durchgehende Seite im Querformat, Aufbau wie im Planer =====
const PC = { ink: '#16231d', muted: '#5a6a62', line: '#d3dbd6', grid: '#e4e9e6', hdr: '#e6ece8', sumrow: '#e9f0ec', sum: '#1d3b2e', task: '#3d7e5e', sub: '#94c4aa',
  ms: '#d4861b', link: '#c0574a', today: '#1f6feb', todayBg: '#e2ecfb', weekend: '#eaeeec', holiday: '#f3dcd8', warn: '#b23a2b', white: '#ffffff' };
const JSPDF_URLS = ['https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js'];
let jsPdfP = null;
function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (jsPdfP) return jsPdfP;
  const urls = window.JSPDF_SRC ? [window.JSPDF_SRC] : JSPDF_URLS;
  jsPdfP = new Promise((res, rej) => {
    const tryAt = k => {
      if (k >= urls.length) { jsPdfP = null; rej(new Error('PDF-Baustein konnte nicht geladen werden')); return; }
      const s = document.createElement('script'); s.src = urls[k]; s.async = true;
      s.onload = () => (window.jspdf && window.jspdf.jsPDF) ? res(window.jspdf.jsPDF) : tryAt(k + 1);
      s.onerror = () => { s.remove(); tryAt(k + 1); };
      document.head.appendChild(s);
    };
    tryAt(0);
  });
  return jsPdfP;
}
// Farbe mischen (für erledigte und Fortschrittsanteile eigener Farben)
function mixHex(a, b, t) { const p = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)), x = p(a), y = p(b); return '#' + x.map((v, k) => Math.round(v + (y[k] - v) * t).toString(16).padStart(2, '0')).join(''); }
// Standardschrift im PDF kennt nur Westeuropäisch (WinAnsi)
const pt = s => String(s ?? '').replace(/→/g, '->').replace(/[^\x20-\x7e\xa0-\xff–—„“”‚‘’•…€]/g, '');

async function exportPdf(opt) {
  opt = opt || pdfOptions();
  if (opt.plan !== false && !state.rows.length && !opt.org) { toast('Der Plan ist noch leer'); return; }
  const btn = $('pdfBtn'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'PDF wird erstellt …';
  try {
    const JsPDF = await loadJsPdf();
    if (opt.org) opt.photos = await orgPhotoMap();
    const buf = buildPdf(JsPDF, opt);
    await offerBin((opt.plan === false ? 'organigramm-' : 'terminplan-') + slug() + '.pdf', buf);
  } catch (e) { toast((e && e.message) || 'PDF konnte nicht erstellt werden'); }
  btn.disabled = false; btn.textContent = old;
}
async function offerBin(name, buf) {
  if (dl) {
    try { await dl.save({ filename: name, data: buf }); return; }
    catch (e) { if (e && e.code === 'declined') return; if (e && e.code !== 'unavailable') throw new Error('Speichern nicht möglich'); }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Erstellt das PDF: Terminplan und/oder Organigramm, je als eigene Seite
function buildPdf(JsPDF, opt) {
  opt = opt || pdfOptions();
  let doc = null;
  if (opt.plan !== false) doc = buildGanttDoc(JsPDF, opt);
  if (opt.org) doc = buildOrgPage(JsPDF, doc, opt.photos || {});
  if (!doc) throw new Error('Bitte mindestens einen Inhalt auswählen.');
  return doc.output('arraybuffer');
}
function buildGanttDoc(JsPDF, opt) {
  const rows = state.rows.map(row => ({ ...row, who: assigneeNames(row) })), o = sched.out, today = todayDn();
  const M = 28, RH = 16, HH = 36, step = state.raster === 'weeks' ? 7 : 1;
  // Zeilen: alle oder wie in der Ansicht; optional ohne Erledigte; optional nur im Zeitraum
  const from = parseISO(opt.from), to = parseISO(opt.to);
  let idx = opt.view ? ganttRowIndices() : state.rows.map((_, i) => i);
  if (!opt.done) idx = idx.filter(i => o[i].summary || !isDone(i));
  if (opt.onlyRange && (from != null || to != null)) idx = idx.filter(i => (to == null || o[i].S <= to) && (from == null || o[i].E >= from));
  // Sammelvorgänge ohne verbleibende Untervorgänge entfallen, wenn ihre Untervorgänge herausgefiltert wurden
  idx = idx.filter(i => !o[i].summary || idx.some(k => sched.parent[k] === i) || (opt.view && isFolded(state.rows[i].id)));
  if (!idx.length) throw new Error('Für diese Auswahl gibt es keine Vorgänge.');
  const pos = new Map(idx.map((i, k) => [i, k])), N = idx.length, sel = idx.map(i => rows[i]);
  // Spalten ab Nr; leere Spalten (Versatz, Fester Start …) entfallen
  const anyPred = idx.some(i => o[i].pred >= 0), anyLag = sel.some(r => parseInt(r.lag, 10)), anyFixed = sel.some(r => r.fixed);
  const want = k => k === 'name' || !opt.cols || opt.cols.includes(k === 'rel' ? 'pred' : k);
  const cols = [
    { k: 'nr', t: 'Nr', w: 22, a: 'center', mono: true },
    { k: 'psp', t: 'PSP', w: 26, a: 'center', mono: true },
    { k: 'type', t: 'Typ', w: 64 },
    { k: 'name', t: 'Vorgang', w: Math.min(190, Math.max(110, 22 + Math.max(...sel.map(r => (r.name || '').length)) * 4.1)) },
    { k: 'who', t: 'Verantw.', w: Math.min(110, Math.max(56, 12 + Math.max(0, ...sel.map(r => (r.who || '').length)) * 4.1)) },
    (anyPred || opt.cols) && { k: 'pred', t: 'Vorgänger', w: 96 },
    (anyPred || opt.cols) && { k: 'rel', t: 'Bez.', w: 24, a: 'center' },
    (anyLag || opt.cols) && { k: 'lag', t: 'Versatz', w: 38, a: 'center', mono: true },
    (anyFixed || opt.cols) && { k: 'fixed', t: 'Fester Start', w: 52, mono: true },
    { k: 'dur', t: 'Dauer', w: 32, a: 'center', mono: true },
    (idx.some(i => progOf(i) > 0) || opt.cols) && { k: 'pct', t: 'Fortschr.', w: 50, a: 'center', mono: true },
    { k: 'S', t: 'Start', w: 56, mono: true },
    { k: 'E', t: 'Ende', w: 56, mono: true }
  ].filter(c => c && want(c.k));
  const TW = cols.reduce((s, c) => s + c.w, 0);
  // Zeitraum: gewählt, sonst vom Projektstart bis zum letzten Termin, ohne leere Reserve
  let minS = from == null ? sched.P : Infinity, maxE = -Infinity; idx.forEach(i => { const x = o[i]; if (x.S < minS) minS = x.S; if (x.E > maxE) maxE = x.E; });
  if (from != null) minS = from; if (to != null) maxE = to; if (maxE < minS) maxE = minS;
  const first = step === 7 || from == null ? mondayOf(minS) : minS;
  const last = to != null ? (step === 7 ? mondayOf(to) + 6 : to) : (step === 7 ? mondayOf(maxE) + 13 : mondayOf(maxE) + 6);
  const nCols = Math.ceil((last - first + 1) / step);
  let colW = step === 7 ? 26 : 13;
  colW = Math.min(step === 7 ? 60 : 28, Math.max(colW, TW / nCols));   // Zeitachse mindestens so breit wie die Tabelle
  const legendH = 30, titleH = 44;
  const H = M + titleH + HH + N * RH + legendH + M;
  let W = M * 2 + TW + nCols * colW;
  if (W < H * 1.25) { colW = Math.min(step === 7 ? 90 : 40, (H * 1.25 - M * 2 - TW) / nCols); W = M * 2 + TW + nCols * colW; }   // immer Querformat
  if (W > 14000) { colW = Math.max(2.5, (14000 - M * 2 - TW) / nCols); W = M * 2 + TW + nCols * colW; }                     // PDF-Höchstmaß
  const Wp = Math.max(W, H * 1.25), CW = nCols * colW;
  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: [Wp, H], compress: true });
  doc.setProperties({ title: pt(state.name || 'Terminplan'), subject: 'Terminplan', creator: 'Terminplaner' });
  const X0 = M + TW, T = M + titleH, B = T + HH;   // Tabelle links, Zeitachse ab X0; Kopf ab T, Zeilen ab B
  const X = d => X0 + (d - first) / step * colW;
  const fill = (c, x, y, w, h) => { doc.setFillColor(c); doc.rect(x, y, w, h, 'F'); };
  const line = (c, w, x1, y1, x2, y2, dash) => { doc.setDrawColor(c); doc.setLineWidth(w); doc.setLineDashPattern(dash || [], 0); doc.line(x1, y1, x2, y2); };
  const txt = (s, x, y, o2) => doc.text(pt(s), x, y, Object.assign({ baseline: 'middle' }, o2 || {}));
  const font = (f, st, sz, c) => { doc.setFont(f, st); doc.setFontSize(sz); doc.setTextColor(c); };
  const fit = (s, w) => { s = pt(s); if (doc.getTextWidth(s) <= w) return s; while (s.length > 1 && doc.getTextWidth(s + '…') > w) s = s.slice(0, -1); return s + '…'; };

  // Titel
  font('helvetica', 'bold', 15, PC.ink); txt(state.name || 'Terminplan', M, M + 10);
  font('helvetica', 'normal', 8, PC.muted);
  let projEnd = sched.P; o.forEach(x => { if (x.E > projEnd) projEnd = x.E; });
  txt((from != null || to != null ? 'Zeitraum ' + fmt(first) + ' bis ' + fmt(last) + '   ·   ' : '') + 'Projektstart ' + fmt(sched.P) + '   ·   Projektende ' + fmt(projEnd) + '   ·   Dauer in ' + (sched.work ? 'Arbeitstagen' : 'Kalendertagen') +
    '   ·   Raster ' + (step === 7 ? 'Wochen' : 'Tage') + '   ·   Stand ' + fmtLong(today), M, M + 27);

  // Hintergrund Zeitachse: Wochenenden, Feiertage, heute
  const todayCol = Math.floor((today - first) / step);
  fill(PC.hdr, M, T, TW + CW, HH);
  if (step === 1) for (let k = 0; k < nCols; k++) {
    const d = first + k, wd = isoWd(d), x = X0 + k * colW;
    const c = k === todayCol ? PC.todayBg : (sched.hol.has(d) && wd <= 5) ? PC.holiday : wd > 5 ? PC.weekend : null;
    if (c) { fill(c, x, B, colW, N * RH); if (k === todayCol || c === PC.holiday) fill(c, x, T + 22, colW, HH - 22); }
  } else if (todayCol >= 0 && todayCol < nCols) { fill(PC.todayBg, X0 + todayCol * colW, B, colW, N * RH); fill(PC.todayBg, X0 + todayCol * colW, T + 12, colW, HH - 12); }
  // Sammelzeilen in der Tabelle hinterlegen
  idx.forEach((i, k) => { if (o[i].summary) fill(PC.sumrow, M, B + k * RH, TW, RH); });

  // Kopf der Tabelle
  font('helvetica', 'bold', 6.3, PC.muted);
  let cx = M; cols.forEach(c => { const lab = c.t.toUpperCase(); c.x = cx; txt(fit(lab, c.w - 6), c.a === 'center' ? cx + c.w / 2 : cx + 4, T + HH / 2, { align: c.a === 'center' ? 'center' : 'left' }); cx += c.w; });
  // Kopf der Zeitachse: Monate, KW, Tage
  const mh = step === 7 ? 12 : 11;
  line(PC.line, 0.5, X0, T + mh, X0 + CW, T + mh);
  let c = 0;
  while (c < nCols) {
    const d0 = first + c * step, k = ymd(d0).y * 12 + ymd(d0).m; let e = c + 1;
    while (e < nCols) { const d = ymd(first + e * step); if (d.y * 12 + d.m !== k) break; e++; }
    const w = (e - c) * colW, t = ymd(d0);
    line(PC.line, 0.5, X0 + c * colW, T, X0 + c * colW, T + mh);
    font('helvetica', 'bold', 7, PC.ink);
    const lab = w >= 44 ? MON[t.m - 1] + ' ' + t.y : MON[t.m - 1];
    if (w >= 16) txt(fit(lab, w - 4), X0 + c * colW + 3, T + mh / 2);
    c = e;
  }
  if (step === 7) {
    for (let k = 0; k < nCols; k++) {
      const d = first + k * 7, x = X0 + k * colW + colW / 2, on = k === todayCol;
      font('courier', on ? 'bold' : 'normal', colW < 18 ? 5 : 6, on ? PC.today : PC.muted);
      txt(String(isoWeek(d)), x, T + 18, { align: 'center' });
      if (colW >= 18) txt(fmtShort(d).slice(0, 5), x, T + 29, { align: 'center' });
    }
  } else {
    let k = 0;
    line(PC.line, 0.5, X0, T + 22, X0 + CW, T + 22);
    while (k < nCols) {
      const d0 = first + k; let e = k + 1; while (e < nCols && isoWd(first + e) !== 1) e++;
      line(PC.line, 0.5, X0 + k * colW, T + mh, X0 + k * colW, T + 22);
      font('courier', 'normal', 6, PC.muted); if ((e - k) * colW >= 30) txt('KW ' + isoWeek(d0), X0 + k * colW + 3, T + 16.5);
      k = e;
    }
    for (let k2 = 0; k2 < nCols; k2++) {
      const d = first + k2, x = X0 + k2 * colW + colW / 2, on = k2 === todayCol;
      if (colW < 7) continue;
      font('courier', on ? 'bold' : 'normal', colW < 10 ? 4.6 : 5.6, on ? PC.today : PC.muted);
      txt(String(ymd(d).d), x, T + 27, { align: 'center' });
      txt('MDMDFSS'[isoWd(d) - 1], x, T + 33, { align: 'center' });
    }
  }
  line(PC.line, 0.6, M, T + HH, M + TW + CW, T + HH);
  line(PC.line, 0.6, M, T, M + TW + CW, T);

  // Gitter
  for (let k = 0; k <= nCols; k++) {
    const strong = step === 7 || isoWd(first + k) === 1;
    line(strong ? PC.line : PC.grid, strong ? 0.45 : 0.3, X0 + k * colW, B, X0 + k * colW, B + N * RH);
  }
  for (let i = 1; i <= N; i++) line(PC.grid, 0.4, M, B + i * RH, M + TW + CW, B + i * RH);
  line(PC.line, 0.9, X0, T, X0, B + N * RH);
  doc.setDrawColor(PC.line); doc.setLineWidth(0.6); doc.setLineDashPattern([], 0); doc.rect(M, T, TW + CW, HH + N * RH, 'S');
  if (todayCol >= 0 && todayCol < nCols) { const tx = X(today) + (step === 7 ? colW / 14 : colW / 2); line(PC.today, 0.8, tx, B, tx, B + N * RH, [3, 2]); }

  // Tabelleninhalt
  idx.forEach((i, k) => {
    const r = rows[i], y = B + k * RH + RH / 2, x2 = o[i], sub = r.type === 'untervorgang' && sched.parent[i] >= 0, pi = x2.pred;
    cols.forEach(col => {
      let v = '', bold = false, colr = PC.ink;
      switch (col.k) {
        case 'nr': v = r.id; colr = PC.muted; break;
        case 'psp': v = sched.psp[i]; colr = PC.muted; break;
        case 'type': v = x2.summary ? 'Sammelvorg.' : TYPES[r.type]; colr = PC.muted; break;
        case 'name': v = r.name || ''; bold = x2.summary; break;
        case 'who': v = r.who; break;
        case 'pred': v = pi >= 0 ? rows[pi].id + ' · ' + (rows[pi].name || 'ohne Namen') : ''; break;
        case 'rel': v = pi >= 0 ? r.rel : ''; break;
        case 'lag': v = x2.summary ? '' : r.lag; break;
        case 'fixed': v = r.fixed ? fmt(parseISO(r.fixed)) : ''; break;
        case 'dur': v = r.type === 'meilenstein' ? '' : x2.summary ? (x2.E - x2.S + 1) : x2.dur; break;
        case 'pct': v = r.type === 'meilenstein' ? '' : progOf(i) + ' %'; bold = x2.summary; break;
        case 'S': v = fmt(x2.S); bold = x2.summary; colr = x2.err ? PC.warn : PC.ink; break;
        case 'E': v = fmt(x2.E); bold = x2.summary; colr = x2.err ? PC.warn : PC.ink; break;
      }
      if (v === '' || v == null) return;
      font(col.mono ? 'courier' : 'helvetica', bold ? 'bold' : 'normal', col.mono ? 6.8 : 7.3, colr);
      let x = col.a === 'center' ? col.x + col.w / 2 : col.x + 4, w = col.w - 8;
      if (col.k === 'name' && sub) {
        doc.setDrawColor(PC.line); doc.setLineWidth(0.7); doc.setLineDashPattern([], 0);
        doc.lines([[0, 6], [5, 0]], col.x + 8, y - 6);
        x += 12; w -= 12;
      }
      txt(fit(String(v), w), x, y, col.a === 'center' ? { align: 'center' } : undefined);
    });
  });

  // Abhängigkeiten
  const cy = i => B + pos.get(i) * RH + RH / 2;
  // Diagramm auf den gewählten Zeitraum begrenzen
  doc.saveGraphicsState(); doc.rect(X0, B, CW, N * RH, null); doc.clip(); doc.discardPath();
  const isMs = i => rows[i].type === 'meilenstein';
  const msX = i => X(o[i].S + 0.5);
  const ax = (i, end) => isMs(i) ? msX(i) + (end ? 5 : -5) : (end ? X(o[i].E + 1) : X(o[i].S));
  if (opt.lines) {
    o.forEach((x2, i) => {
      if (x2.pred < 0 || x2.err || !pos.has(i) || !pos.has(x2.pred)) return;
      const rel = rows[i].rel, p = x2.pred;
      const x1 = ax(p, !(rel === 'AA' || rel === 'AE')), y1 = cy(p);
      const e = (rel === 'EE' || rel === 'AE') ? -1 : 1, xe = ax(i, e === -1), y2 = cy(i);
      const g = 5, d1 = (rel === 'AA' || rel === 'AE') ? -1 : 1, vx = x1 + d1 * g, apx = xe - e * g, dir = y2 >= y1 ? 1 : -1;
      const ok = e === 1 ? vx <= xe - 2 : vx >= xe + 2;
      const pts = ok ? [[x1, y1], [vx, y1], [vx, y2], [xe - e * 3.5, y2]] : [[x1, y1], [vx, y1], [vx, y1 + dir * RH / 2], [apx, y1 + dir * RH / 2], [apx, y2], [xe - e * 3.5, y2]];
      doc.setDrawColor(PC.link); doc.setLineWidth(0.6); doc.setLineDashPattern([], 0);
      for (let k = 1; k < pts.length; k++) doc.line(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
      doc.setFillColor(PC.link); doc.triangle(xe, y2, xe - e * 4, y2 - 2.4, xe - e * 4, y2 + 2.4, 'F');
    });
  }
  // Balken
  idx.forEach(i => {
    const r = rows[i], x2 = o[i], y = cy(i);
    font('helvetica', 'normal', 6.4, PC.muted);
    if (r.type === 'meilenstein') {
      const mx = msX(i), s = 4.6; doc.setFillColor(r.color || PC.ms);
      doc.triangle(mx - s, y, mx, y - s, mx + s, y, 'F'); doc.triangle(mx - s, y, mx, y + s, mx + s, y, 'F');
      font('helvetica', 'normal', 6.6, PC.ink); txt(r.name || '', mx + 8, y);
      return;
    }
    const x = X(x2.S), w = Math.max((x2.E - x2.S + 1) / step * colW, 2.5);
    if (x2.summary) {
      doc.setFillColor(r.color || PC.sum); doc.rect(x, y - 4, w, 4.5, 'F');
      doc.triangle(x, y + 0.5, x + 4.5, y + 0.5, x, y + 4.5, 'F'); doc.triangle(x + w, y + 0.5, x + w - 4.5, y + 0.5, x + w, y + 4.5, 'F');
      font('helvetica', 'bold', 6.6, PC.ink); txt(r.name || '', x + w + 6, y);
    } else {
      const sub = r.type === 'untervorgang' && sched.parent[i] >= 0;
      doc.setFillColor(r.color ? (rowDone(r) ? mixHex(r.color, '#ffffff', 0.45) : r.color) : rowDone(r) ? (sub ? '#c9e1d4' : '#9ebfae') : (sub ? PC.sub : PC.task));
      doc.roundedRect(x, y - 4.5, w, 9, 1.6, 1.6, 'F');
      const pg = progOf(i);
      if (pg > 0) { doc.setFillColor(r.color ? mixHex(r.color, '#000000', 0.32) : sub ? '#5f9a7c' : '#2a5a42'); doc.roundedRect(x, y - 4.5, Math.max(2, w * Math.min(pg, 100) / 100), 9, 1.6, 1.6, 'F'); }
      if (x2.err) { doc.setDrawColor(PC.warn); doc.setLineWidth(0.8); doc.setLineDashPattern([2, 1.4], 0); doc.roundedRect(x, y - 4.5, w, 9, 1.6, 1.6, 'S'); doc.setLineDashPattern([], 0); }
      const lab = [r.who, rowDone(r) ? 'erledigt' : (progOf(i) ? progOf(i) + ' %' : '')].filter(Boolean).join('  ·  ');
      if (lab) { font('helvetica', 'normal', 6.4, PC.muted); txt(lab, x + w + 6, y); }
    }
  });

  doc.restoreGraphicsState();
  // Legende
  if (opt.legend === false) return doc;
  const ly = B + N * RH + 18; let lx = M;
  const sw = (draw, label) => { draw(lx, ly); font('helvetica', 'normal', 7, PC.muted); txt(label, lx + 16, ly); lx += 22 + doc.getTextWidth(label) + 10; };
  sw((x, y) => { doc.setFillColor(PC.sum); doc.rect(x, y - 2.5, 12, 4, 'F'); }, 'Sammelvorgang');
  sw((x, y) => { doc.setFillColor(PC.task); doc.roundedRect(x, y - 3.5, 12, 7, 1.4, 1.4, 'F'); }, 'Vorgang');
  sw((x, y) => { doc.setFillColor(PC.sub); doc.roundedRect(x, y - 3.5, 12, 7, 1.4, 1.4, 'F'); }, 'Untervorgang');
  sw((x, y) => { doc.setFillColor(PC.ms); doc.triangle(x + 2, y, x + 6, y - 4, x + 10, y, 'F'); doc.triangle(x + 2, y, x + 6, y + 4, x + 10, y, 'F'); }, 'Meilenstein');
  sw((x, y) => line(PC.link, 0.9, x, y, x + 12, y), 'Abhängigkeit');
  sw((x, y) => line(PC.today, 0.9, x, y, x + 12, y, [2.5, 1.6]), 'Heute');
  if (step === 1) { sw((x, y) => fill(PC.weekend, x, y - 4, 12, 8), 'Wochenende'); if (sched.hol.size) sw((x, y) => fill(PC.holiday, x, y - 4, 12, 8), 'Feiertag'); }
  font('helvetica', 'normal', 6.6, PC.muted);
  txt('EA Ende-Anfang  ·  AA Anfang-Anfang  ·  EE Ende-Ende  ·  AE Anfang-Ende', M + TW + CW, ly, { align: 'right' });
  return doc;
}

/* ---------- Organigramm als eigene PDF-Seite ---------- */
// Fotos vorab rund zuschneiden (PNG mit transparenten Ecken); was nicht lädt, erscheint mit Initialen
async function orgPhotoMap() {
  const out = {};
  await Promise.all(orgPeople().filter(p => orgPhoto(p)).map(p => new Promise(res => {
    const im = new Image(), url = orgPhoto(p), t = setTimeout(res, 5000);
    if (!/^data:/.test(url)) im.crossOrigin = 'anonymous';
    im.onload = () => {
      try {
        const n = 160, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
        g.beginPath(); g.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2); g.clip();
        const k = Math.max(n / im.naturalWidth, n / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
        g.drawImage(im, (n - w) / 2, (n - h) / 2, w, h); out[p.id] = c.toDataURL('image/png');
      } catch (e) { }
      clearTimeout(t); res();
    };
    im.onerror = () => { clearTimeout(t); res(); };
    im.src = url;
  })));
  return out;
}
const orgIsEmpty = () => !orgPeople().length && !orgTeams().length;

function buildOrgPage(JsPDF, doc, photos) {
  if (orgIsEmpty()) throw new Error('Das Organigramm ist noch leer.');
  const pls = orgPeople().filter(p => p.pl), loose = orgPeople().filter(p => !p.pl && !orgMemberships(p).length);
  const M = 32, GX = 18, GY = 30, BW = 180, PAD = 10, CARD = 98, titleH = 46, today = todayDn();
  // Zum Messen der Texte genügt ein beliebiges Dokument
  let d = doc || new JsPDF({ unit: 'pt', format: 'a4', compress: true });
  const font = (f, st, sz, c) => { d.setFont(f, st); d.setFontSize(sz); d.setTextColor(c); };
  const fit = (s, w) => { s = pt(s); if (d.getTextWidth(s) <= w) return s; while (s.length > 1 && d.getTextWidth(s + '…') > w) s = s.slice(0, -1); return s + '…'; };
  const wrap = (s, w, max) => { const l = d.splitTextToSize(pt(s), w); return l.length > max ? l.slice(0, max - 1).concat(fit(l.slice(max - 1).join(' '), w)) : l; };
  const txt = (s, x, y, o2) => d.text(s, x, y, Object.assign({ baseline: 'middle' }, o2 || {}));
  const teamName = t => orgName(t) || 'Team ohne Namen', personName = p => orgName(p) || 'Ohne Namen';

  // Person als Zeile (Teamleitung größer, Teammitglied kleiner) mit Rolle und ggf. Hauptteam
  const rowInfo = (p, teamId, lead) => {
    const m = teamId != null ? orgMemberships(p).find(x => x.team === teamId) : null, role = (m && m.role) || p.role || '';
    const main = orgMemberships(p)[0], sec = teamId != null && main && main.team !== teamId ? 'Hauptteam: ' + teamName(orgById(main.team)) : '';
    const av = lead ? 22 : 16, lines = 1 + (role ? 1 : 0) + (sec ? 1 : 0);
    return { p, role, sec, av, h: Math.max(av, 4 + lines * 8.6) + (lead ? 5 : 3) };
  };
  const drawRow = (r, x, y, w) => {
    avatar(r.p, x, y + (r.h - r.av) / 2 - 1, r.av);
    const tx = x + r.av + 6, tw = w - r.av - 6, n = 1 + (r.role ? 1 : 0) + (r.sec ? 1 : 0);
    let ty = y + (r.h - n * 8.6) / 2 + 3.6;
    font('helvetica', 'bold', 7.8, PC.ink); txt(fit(personName(r.p), tw), tx, ty); ty += 8.6;
    if (r.role) { font('helvetica', 'normal', 6.6, PC.muted); txt(fit(r.role, tw), tx, ty); ty += 8.6; }
    if (r.sec) { font('helvetica', 'italic', 6.2, PC.muted); txt(fit(r.sec, tw), tx, ty); }
  };
  const avatar = (p, x, y, s) => {
    const im = photos[p.id];
    if (im) { try { d.addImage(im, 'PNG', x, y, s, s, 'oav' + p.id); return; } catch (e) { } }
    const nm = orgName(p) || '?';
    d.setFillColor(orgHue(nm)); d.circle(x + s / 2, y + s / 2, s / 2, 'F');
    font('helvetica', 'bold', s * 0.36, '#ffffff'); txt(pt(orgInitials(nm)), x + s / 2, y + s / 2 + 0.3, { align: 'center' });
  };
  const label = (s, x, y) => { font('helvetica', 'bold', 5.8, PC.muted); txt(s, x, y, { charSpace: 0.6 }); };
  const box = (x, y, w, h, strip, tint, dashed) => {
    d.setFillColor(tint); d.roundedRect(x, y, w, h, 5, 5, 'F');
    if (strip) { d.setFillColor(strip); d.roundedRect(x, y, w, 9, 5, 5, 'F'); d.setFillColor(tint); d.rect(x, y + 4.5, w, 5.5, 'F'); }
    d.setDrawColor(PC.line); d.setLineWidth(0.7); d.setLineDashPattern(dashed ? [3, 2] : [], 0); d.roundedRect(x, y, w, h, 5, 5, 'S'); d.setLineDashPattern([], 0);
  };

  // Knoten: Projektleitung (Karten nebeneinander) und Teams (Teamleitung, darunter Teammitglieder untereinander)
  const plNode = () => {
    font('helvetica', 'bold', 7.8, PC.ink);
    const cards = pls.map(p => {
      font('helvetica', 'bold', 7.8, PC.ink); const nl = wrap(personName(p), CARD - 10, 2);
      font('helvetica', 'normal', 6.6, PC.muted); const rl = p.role ? wrap(p.role, CARD - 10, 2) : [];
      return { p, nl, rl, h: 8 + 34 + 7 + nl.length * 9.4 + rl.length * 8.4 + 6 };
    });
    const ch = Math.max(24, ...cards.map(c => c.h)), w = Math.max(BW, cards.length * CARD + Math.max(0, cards.length - 1) * 8 + 2 * PAD);
    return {
      w, h: 9 + PAD + 12 + ch + PAD, kids: [],
      draw(x, y) {
        box(x, y, this.w, this.h, PC.ink, PC.white);
        label('PROJEKTLEITUNG', x + this.w / 2 - d.getTextWidth('PROJEKTLEITUNG') / 2 - 4, y + 9 + PAD);
        if (!cards.length) { font('helvetica', 'normal', 8, PC.muted); txt('–', x + this.w / 2, y + 9 + PAD + 12 + ch / 2, { align: 'center' }); return; }
        let cx = x + (this.w - (cards.length * CARD + (cards.length - 1) * 8)) / 2; const cy = y + 9 + PAD + 12;
        cards.forEach(c => {
          d.setDrawColor(PC.line); d.setLineWidth(0.6); d.roundedRect(cx, cy, CARD, ch, 4, 4, 'S');
          avatar(c.p, cx + (CARD - 34) / 2, cy + 8, 34);
          let ty = cy + 8 + 34 + 7 + 3.5;
          font('helvetica', 'bold', 7.8, PC.ink); c.nl.forEach(l => { txt(l, cx + CARD / 2, ty, { align: 'center' }); ty += 9.4; });
          font('helvetica', 'normal', 6.6, PC.muted); c.rl.forEach(l => { txt(l, cx + CARD / 2, ty, { align: 'center' }); ty += 8.4; });
          cx += CARD + 8;
        });
      }
    };
  };
  const teamNode = (t, depth) => {
    const tc = t.color || ORG_COLORS[0], iw = BW - 2 * PAD;
    font('helvetica', 'normal', 6.6, PC.muted); const desc = t.role ? wrap(t.role, iw, 3) : [];
    const leads = orgInTeam(t.id, true).map(p => rowInfo(p, t.id, true)), mem = orgInTeam(t.id, false).map(p => rowInfo(p, t.id, false));
    const zone = rs => rs.length ? rs.reduce((s, r) => s + r.h, 0) : 12;
    const h = 9 + 6 + 12 + desc.length * 8.4 + 6 + 10 + zone(leads) + 9 + 10 + zone(mem) + PAD;
    return {
      w: BW, h, kids: depth > 30 ? [] : orgSubTeams(t.id).map(s => teamNode(s, depth + 1)),
      draw(x, y) {
        box(x, y, BW, h, tc, mixHex(tc, '#ffffff', 0.93));
        let yy = y + 9 + 6 + 5;
        font('helvetica', 'bold', 9.6, mixHex(tc, '#000000', 0.25)); txt(fit(teamName(t), iw), x + PAD, yy); yy += 7;
        font('helvetica', 'normal', 6.6, PC.muted); desc.forEach(l => { yy += 4.2; txt(l, x + PAD, yy); yy += 4.2; });
        yy += 6; label('TEAMLEITUNG', x + PAD, yy + 3); yy += 10;
        if (leads.length) leads.forEach(r => { drawRow(r, x + PAD, yy, iw); yy += r.h; }); else { font('helvetica', 'normal', 7.5, PC.muted); txt('–', x + PAD, yy + 6); yy += 12; }
        yy += 4; d.setDrawColor(mixHex(tc, '#ffffff', 0.6)); d.setLineWidth(0.6); d.line(x + PAD, yy, x + BW - PAD, yy); yy += 5;
        label('TEAMMITGLIEDER', x + PAD, yy + 3); yy += 10;
        if (mem.length) mem.forEach(r => { drawRow(r, x + PAD, yy, iw); yy += r.h; }); else { font('helvetica', 'normal', 7.5, PC.muted); txt('–', x + PAD, yy + 6); }
      }
    };
  };

  // Baum anordnen: Teilbaumbreite, Ebenenhöhe je Tiefe, Eltern mittig über den Kindern
  const root = plNode(); root.kids = orgSubTeams(null).map(t => teamNode(t, 0));
  const levelH = [], sw = n => n.sw ?? (n.sw = Math.max(n.w, n.kids.reduce((s, k) => s + sw(k), 0) + GX * Math.max(0, n.kids.length - 1)));
  const lv = (n, k) => { levelH[k] = Math.max(levelH[k] || 0, n.h); n.kids.forEach(c => lv(c, k + 1)); }; lv(root, 0);
  const levelY = [0]; levelH.forEach((h, k) => { levelY[k + 1] = levelY[k] + h + GY; });
  const place = (n, x0, k) => {
    n.k = k; n.y = levelY[k];
    const kw = n.kids.reduce((s, c) => s + sw(c), 0) + GX * Math.max(0, n.kids.length - 1);
    let cx = x0 + (sw(n) - kw) / 2; n.kids.forEach(c => { place(c, cx, k + 1); cx += sw(c) + GX; });
    const mid = n.kids.length ? (n.kids[0].x + n.kids[0].w / 2 + n.kids[n.kids.length - 1].x + n.kids[n.kids.length - 1].w / 2) / 2 : x0 + sw(n) / 2;
    n.x = Math.min(Math.max(mid - n.w / 2, x0), x0 + sw(n) - n.w);
  };
  place(root, 0, 0);
  const treeW = sw(root), treeH = levelY[levelH.length] - GY;
  // „Noch ohne Team“ unter dem Baum, Personen in Spalten
  const lr = loose.map(p => rowInfo(p, null, false)), lcols = Math.max(1, Math.min(lr.length, Math.floor((Math.max(treeW, 400) - 2 * PAD + 12) / (BW - 2 * PAD + 12))));
  const lrows = Math.ceil(lr.length / lcols), lW = Math.max(220, lcols * (BW - 2 * PAD) + (lcols - 1) * 12 + 2 * PAD);
  const lH = lr.length ? PAD + 12 + Math.max(...lr.map(r => r.h)) * lrows + PAD : 0;
  const contentW = Math.max(treeW, lW), H = M + titleH + treeH + (lH ? GY + lH : 0) + M;
  const Hp = Math.max(H, 595), Wp = Math.min(14000, Math.max(contentW + 2 * M, Hp * 1.3, 842));
  if (doc) doc.addPage([Wp, Hp], 'landscape');
  else doc = d = new JsPDF({ orientation: 'landscape', unit: 'pt', format: [Wp, Hp], compress: true }), doc.setProperties({ title: pt((state.name || 'Projekt') + ' – Organigramm'), subject: 'Organigramm', creator: 'Terminplaner' });
  d = doc;

  // Titel
  font('helvetica', 'bold', 15, PC.ink); txt(pt((state.name || 'Projekt') + ' – Organigramm'), M, M + 10);
  font('helvetica', 'normal', 8, PC.muted); txt(pt('Projektleitung, Teams und Unterteams   ·   Stand ' + fmtLong(today)), M, M + 27);
  // Linien und Kästen
  const ox = (Wp - contentW) / 2 + (contentW - treeW) / 2, oy = M + titleH;
  const walk = n => {
    const X = ox + n.x, Y = oy + n.y;
    if (n.kids.length) {
      const midY = oy + levelY[n.k + 1] - GY / 2, cxs = n.kids.map(c => ox + c.x + c.w / 2);
      d.setDrawColor('#b8c4bd'); d.setLineWidth(1.1); d.setLineDashPattern([], 0);
      d.line(X + n.w / 2, Y + n.h, X + n.w / 2, midY);
      if (cxs.length > 1) d.line(Math.min(...cxs, X + n.w / 2), midY, Math.max(...cxs, X + n.w / 2), midY);
      else d.line(X + n.w / 2, midY, cxs[0], midY);
      cxs.forEach(cx => d.line(cx, midY, cx, oy + levelY[n.k + 1]));
    }
    n.draw(X, Y); n.kids.forEach(walk);
  };
  walk(root);
  if (lH) {
    const x = (Wp - lW) / 2, y = oy + treeH + GY, rh = Math.max(...lr.map(r => r.h));
    box(x, y, lW, lH, null, PC.white, true); label('NOCH OHNE TEAM', x + PAD, y + PAD + 3);
    lr.forEach((r, k) => drawRow(r, x + PAD + (k % lcols) * (BW - 2 * PAD + 12), y + PAD + 12 + Math.floor(k / lcols) * rh, BW - 2 * PAD));
  }
  return doc;
}

/* ---------- Auswahl vor dem Export ---------- */
const PDF_COLS = [['nr', 'Nr'], ['psp', 'PSP'], ['type', 'Typ'], ['who', 'Verantwortlich'], ['pct', 'Fortschritt'], ['pred', 'Vorgänger und Beziehung'], ['lag', 'Versatz'], ['fixed', 'Fester Start'], ['dur', 'Dauer'], ['S', 'Start'], ['E', 'Ende']];
function pdfOptions() {
  let u = {}; try { u = JSON.parse(localStorage.getItem(LS_UI) || '{}').pdf || {}; } catch (e) { }
  return { plan: true, org: !!u.org, cols: Array.isArray(u.cols) ? u.cols : null, view: !!u.view, done: u.done !== false, onlyRange: u.onlyRange !== false, lines: u.lines ?? !!state.lines, legend: u.legend !== false, from: '', to: '' };
}
function openPdfDialog() {
  const hasOrg = typeof orgIsEmpty === 'function' && !orgIsEmpty();
  if (!state.rows.length && !hasOrg) { toast('Der Plan ist noch leer'); return; }
  const op = pdfOptions(), today = todayDn();
  // Vorauswahl: in der Team-Ansicht nur das Organigramm, sonst der Terminplan und das Organigramm, wenn zuletzt mitgedruckt
  if (view === 'org' && hasOrg) { op.plan = false; op.org = true; } else op.plan = true;
  if (!state.rows.length) op.plan = false;
  if (!hasOrg) op.org = false;
  if (!op.plan && !op.org) op.plan = true;
  const defCols = PDF_COLS.map(c => c[0]).filter(k => !['lag', 'fixed'].includes(k) || state.rows.some(r => k === 'lag' ? parseInt(r.lag, 10) : r.fixed));
  const on = k => (op.cols || defCols).includes(k);
  let minS = sched.P, maxE = sched.P; sched.out.forEach(x => { if (x.S < minS) minS = x.S; if (x.E > maxE) maxE = x.E; });
  const s = document.createElement('div'); s.className = 'scrim'; s.id = 'pdfScrim';
  const ck = (id, t, c) => '<label class="chk"><input type="checkbox" id="' + id + '"' + (c ? ' checked' : '') + '> ' + t + '</label>';
  s.innerHTML = '<div class="panel pdfdlg" role="dialog" aria-modal="true" aria-labelledby="pdfT">' +
    '<div class="head"><h2 id="pdfT">PDF exportieren</h2><button class="btn" type="button" data-x>Abbrechen</button></div>' +
    '<div><h3>Inhalt</h3><div class="pcols">' +
    '<label class="chk"><input type="checkbox" id="pPlan"' + (op.plan ? ' checked' : '') + (state.rows.length ? '' : ' disabled') + '> Terminplan (Gantt)</label>' +
    '<label class="chk"><input type="checkbox" id="pOrg"' + (op.org ? ' checked' : '') + (hasOrg ? '' : ' disabled') + '> Organigramm</label></div>' +
    '<p class="hint">Jeder Inhalt kommt auf eine eigene Seite im Querformat.' + (hasOrg ? '' : ' Das Organigramm ist noch leer.') + '</p></div>' +
    '<div id="pPlanOpts" class="pplan"><div><h3>Spalten der Tabelle</h3><div class="pcols">' + PDF_COLS.map(([k, t]) => '<label class="chk"><input type="checkbox" data-pc="' + k + '"' + (on(k) ? ' checked' : '') + '> ' + t + '</label>').join('') + '</div>' +
    '<p class="hint">„Vorgang“ und das Balkendiagramm sind immer enthalten.</p></div>' +
    '<div><h3>Zeitraum</h3><div class="prange"><label class="pf">Von<input class="in" type="date" id="pFrom"></label><label class="pf">Bis<input class="in" type="date" id="pTo"></label></div>' +
    '<div class="pquick"><button type="button" class="btn sm" data-q="all">Gesamtes Projekt</button><button type="button" class="btn sm" data-q="4w">Ab heute 4 Wochen</button><button type="button" class="btn sm" data-q="3m">Ab heute 3 Monate</button><button type="button" class="btn sm" data-q="mon">Dieser Monat</button><button type="button" class="btn sm" data-q="next">Nächster Monat</button></div>' +
    ck('pOnly', 'Nur Vorgänge, die in den Zeitraum fallen', op.onlyRange) + '<p class="hint">Leer lassen für das gesamte Projekt (' + fmt(minS) + ' bis ' + fmt(maxE) + ').</p></div>' +
    '<div><h3>Vorgänge</h3><label class="chk"><input type="radio" name="pv" value="all"' + (op.view ? '' : ' checked') + '> Alle Vorgänge</label>' +
    '<label class="chk"><input type="radio" name="pv" value="view"' + (op.view ? ' checked' : '') + '> Wie in der Ansicht (aktive Filter, eingeklappte Untervorgänge)</label>' +
    ck('pDone', 'Erledigte Vorgänge einschließen', op.done) + '</div>' +
    '<div><h3>Weitere Inhalte</h3>' + ck('pLines', 'Abhängigkeitslinien', op.lines) + ck('pLegend', 'Legende', op.legend) + '</div></div>' +
    '<div class="btns"><span class="msg" id="pMsg"></span><span class="spacer"></span><button class="btn primary" type="button" id="pGo">PDF erstellen</button></div></div>';
  document.body.appendChild(s);
  const q = x => s.querySelector(x), close = () => { s.remove(); document.removeEventListener('keydown', key); $('pdfBtn').focus(); };
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  s.addEventListener('click', e => { if (e.target === s || e.target.closest('[data-x]')) close(); });
  const sync = () => { q('#pPlanOpts').hidden = !q('#pPlan').checked; q('#pMsg').textContent = ''; q('#pMsg').classList.remove('bad'); };
  q('#pPlan').addEventListener('change', sync); q('#pOrg').addEventListener('change', sync); sync();
  q('.pquick').addEventListener('click', e => {
    const b = e.target.closest('[data-q]'); if (!b) return; const t = ymd(today);
    let a = '', z = '';
    if (b.dataset.q === '4w') { a = toISO(today); z = toISO(today + 27); }
    else if (b.dataset.q === '3m') { a = toISO(today); z = toISO(dn(t.y, t.m + 3, t.d) - 1); }
    else if (b.dataset.q === 'mon') { a = toISO(dn(t.y, t.m, 1)); z = toISO(dn(t.m === 12 ? t.y + 1 : t.y, t.m % 12 + 1, 1) - 1); }
    else if (b.dataset.q === 'next') { const ny = t.m === 12 ? t.y + 1 : t.y, nm = t.m % 12 + 1; a = toISO(dn(ny, nm, 1)); z = toISO(dn(nm === 12 ? ny + 1 : ny, nm % 12 + 1, 1) - 1); }
    q('#pFrom').value = a; q('#pTo').value = z;
  });
  q('#pGo').addEventListener('click', async () => {
    const opt = {
      plan: q('#pPlan').checked, org: q('#pOrg').checked,
      cols: [...s.querySelectorAll('[data-pc]')].filter(x => x.checked).map(x => x.dataset.pc),
      view: q('input[name="pv"]:checked').value === 'view', done: q('#pDone').checked, onlyRange: q('#pOnly').checked,
      lines: q('#pLines').checked, legend: q('#pLegend').checked, from: q('#pFrom').value, to: q('#pTo').value
    };
    if (!opt.plan && !opt.org) { q('#pMsg').textContent = 'Bitte mindestens einen Inhalt auswählen.'; q('#pMsg').classList.add('bad'); return; }
    const f = parseISO(opt.from), t = parseISO(opt.to);
    if (opt.plan && f != null && t != null && t < f) { q('#pMsg').textContent = 'Das Ende des Zeitraums liegt vor dem Anfang.'; q('#pMsg').classList.add('bad'); return; }
    saveUi({ pdf: { org: view === 'org' ? pdfOptions().org : opt.org, cols: opt.cols, view: opt.view, done: opt.done, onlyRange: opt.onlyRange, lines: opt.lines, legend: opt.legend } });
    close(); await exportPdf(opt);
  });
  q('#pGo').focus();
}
