// ===== LOGIC START =====
const DAY = 86400000;
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const pad2 = x => String(x).padStart(2, '0');
function dn(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / DAY); }
function parseISO(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? dn(+m[1], +m[2], +m[3]) : null; }
function ymd(n) { const t = new Date(n * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
function toISO(n) { const t = ymd(n); return t.y + '-' + pad2(t.m) + '-' + pad2(t.d); }
function isoWd(n) { return (((n + 3) % 7) + 7) % 7 + 1; }           // Mo=1 ... So=7
function wdName(n) { return WD[(((n + 4) % 7) + 7) % 7]; }
function fmt(n) { const t = ymd(n); return wdName(n) + ' ' + pad2(t.d) + '.' + pad2(t.m) + '.' + String(t.y).slice(2); }
function fmtShort(n) { const t = ymd(n); return pad2(t.d) + '.' + pad2(t.m) + '.'; }
function fmtLong(n) { const t = ymd(n); return pad2(t.d) + '.' + pad2(t.m) + '.' + t.y; }
function isoWeek(n) { const th = n - isoWd(n) + 4; const y = ymd(th).y; return Math.floor((th - dn(y, 1, 1)) / 7) + 1; }
function mondayOf(n) { return n - isoWd(n) + 1; }
function todayDn() { const t = new Date(); return dn(t.getFullYear(), t.getMonth() + 1, t.getDate()); }

// Eine Zeile der eigenen freien Tage: „24.12.2026 Heiligabend“ oder „24.12.2026 - 06.01.2027 Betriebsurlaub“ (auch „bis“, ISO-Datum)
function parseHolidayLine(line) {
  line = line.trim(); if (!line) return null;
  const D = '(\\d{1,2}\\.\\d{1,2}\\.\\d{4}|\\d{4}-\\d{2}-\\d{2})';
  const m = new RegExp('^' + D + '(?:\\s*(?:-|–|—|bis)\\s*' + D + ')?\\s*(.*)$').exec(line); if (!m) return { bad: true };
  const one = t => {
    let y, mo, d, x = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
    if (x) { d = +x[1]; mo = +x[2]; y = +x[3]; } else { x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t); y = +x[1]; mo = +x[2]; d = +x[3]; }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const n = dn(y, mo, d), c = ymd(n); return c.d === d && c.m === mo ? n : null;
  };
  const a = one(m[1]), b = m[2] ? one(m[2]) : null;
  if (a == null || (m[2] && (b == null || b < a || b - a > 366))) return { bad: true };
  return Object.assign({ d: toISO(a), n: m[3].trim() }, b != null && b > a ? { to: toISO(b) } : {});
}

// Alle Vorgänger einer Zeile: der erste steht in pred/rel/lag, weitere in deps [{ pred, rel, lag }]
function rowLinks(r) {
  const out = [], seen = new Set(), add = (p, rel, lag) => {
    if (p === '' || p == null || !Number.isFinite(Number(p)) || seen.has(Number(p))) return;
    seen.add(Number(p)); out.push({ pred: Number(p), rel: ['EA', 'AA', 'EE', 'AE'].includes(rel) ? rel : 'EA', lag: lag === '' || lag == null ? '' : String(parseInt(lag, 10) || 0) });
  };
  if (r) { add(r.pred, r.rel, r.lag); (Array.isArray(r.deps) ? r.deps : []).forEach(d => d && add(d.pred, d.rel, d.lag)); }
  return out;
}
// Schreibt eine Vorgängerliste zurück: erster nach pred/rel/lag, weitere nach deps (deps entfällt, wenn leer)
function setRowLinks(r, links) {
  const L = rowLinks({ deps: links });
  if (L.length) { r.pred = L[0].pred; r.rel = L[0].rel; r.lag = L[0].lag; } else { r.pred = ''; r.rel = r.rel || 'EA'; r.lag = ''; }
  if (L.length > 1) r.deps = L.slice(1); else delete r.deps;
}
// Zeilen, die (auch über Sammelvorgänge) von Zeile k abhängen: als Vorgänger von k nicht wählbar, sonst Zirkelbezug
function dependentsOf(rows, sc, k) {
  const by = new Map(rows.map((r, j) => [Number(r.id), j])), next = rows.map(() => []);
  rows.forEach((r, j) => rowLinks(r).forEach(l => { const p = by.get(l.pred); if (p !== undefined) next[p].push(j); }));
  if (sc && sc.parent && sc.parent.length === rows.length) sc.parent.forEach((p, j) => { if (p >= 0) next[j].push(p); });
  const seen = new Set([k]), st = [k];
  while (st.length) { const x = st.pop(); for (const y of next[x]) if (!seen.has(y)) { seen.add(y); st.push(y); } }
  return seen;
}
const linkText = l => l.pred + (l.rel && l.rel !== 'EA' ? l.rel : '') + (parseInt(l.lag, 10) ? (parseInt(l.lag, 10) > 0 ? '+' : '') + parseInt(l.lag, 10) : '');

/* ---------- Gesetzliche Feiertage nach Bundesland ---------- */
// Nach den Feiertagsgesetzen der Länder berechnet (Ostern nach Gauß); rein örtliche Feiertage
// (Augsburger Friedensfest, Fronleichnam nur in Teilen von Sachsen und Thüringen) sind nicht enthalten.
const REGIONS = [['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'], ['BB', 'Brandenburg'], ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'],
  ['MV', 'Mecklenburg-Vorpommern'], ['NI', 'Niedersachsen'], ['NW', 'Nordrhein-Westfalen'], ['RP', 'Rheinland-Pfalz'], ['SL', 'Saarland'], ['SN', 'Sachsen'],
  ['ST', 'Sachsen-Anhalt'], ['SH', 'Schleswig-Holstein'], ['TH', 'Thüringen']];
const regionName = c => (REGIONS.find(x => x[0] === c) || [])[1] || '';
function easterDn(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return dn(y, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}
function legalHolidays(region, y) {
  if (!regionName(region)) return [];
  const E = easterDn(y), out = [], in_ = (...l) => l.includes(region), add = (d, n) => out.push({ d, n });
  add(dn(y, 1, 1), 'Neujahr');
  if (in_('BW', 'BY', 'ST')) add(dn(y, 1, 6), 'Heilige Drei Könige');
  if ((region === 'BE' && y >= 2019) || (region === 'MV' && y >= 2023)) add(dn(y, 3, 8), 'Internationaler Frauentag');
  add(E - 2, 'Karfreitag');
  if (region === 'BB') add(E, 'Ostersonntag');
  add(E + 1, 'Ostermontag');
  add(dn(y, 5, 1), 'Tag der Arbeit');
  if (region === 'BE' && (y === 2020 || y === 2025)) add(dn(y, 5, 8), 'Tag der Befreiung');
  add(E + 39, 'Christi Himmelfahrt');
  if (region === 'BB') add(E + 49, 'Pfingstsonntag');
  add(E + 50, 'Pfingstmontag');
  if (in_('BW', 'BY', 'HE', 'NW', 'RP', 'SL')) add(E + 60, 'Fronleichnam');
  if (in_('BY', 'SL')) add(dn(y, 8, 15), 'Mariä Himmelfahrt');
  if (region === 'TH' && y >= 2019) add(dn(y, 9, 20), 'Weltkindertag');
  add(dn(y, 10, 3), 'Tag der Deutschen Einheit');
  if (y === 2017 || in_('BB', 'MV', 'SN', 'ST', 'TH') || (in_('HB', 'HH', 'NI', 'SH') && y >= 2018)) add(dn(y, 10, 31), 'Reformationstag');
  if (in_('BW', 'BY', 'NW', 'RP', 'SL')) add(dn(y, 11, 1), 'Allerheiligen');
  if (region === 'SN') { let d = dn(y, 11, 22); while (isoWd(d) !== 3) d--; add(d, 'Buß- und Bettag'); }
  add(dn(y, 12, 25), '1. Weihnachtstag'); add(dn(y, 12, 26), '2. Weihnachtstag');
  return out.sort((a, b) => a.d - b.d);
}
// Alle freien Tage eines Plans: gesetzliche Feiertage des Bundeslands (Projektjahr -1 bis +15) und eigene Tage/Zeiträume
function freeDays(st, P) {
  const names = new Map(), add = (d, n) => { const o = names.get(d); names.set(d, o && o !== n ? o + ' · ' + n : n); };
  if (st.region) { const y0 = ymd(P).y; for (let y = y0 - 1; y <= y0 + 15; y++) legalHolidays(st.region, y).forEach(h => add(h.d, h.n)); }
  (st.holidays || []).forEach(h => {
    const a = parseISO(h.d); if (a == null) return;
    const b = parseISO(h.to); const z = b != null && b >= a && b - a <= 366 ? b : a;
    for (let d = a; d <= z; d++) add(d, h.n || 'Frei');
  });
  return names;
}

function schedule(st) {
  const rows = st.rows, N = rows.length;
  const P = parseISO(st.start) ?? todayDn();
  const holName = freeDays(st, P), hol = new Set(holName.keys());
  const work = st.mode === 'work';
  const isWork = n => isoWd(n) <= 5 && !hol.has(n);
  const addWork = (x, k) => { if (k === 0) return x; const s = k > 0 ? 1 : -1; let c = Math.abs(k), g = 0; while (c > 0 && g < 40000) { x += s; g++; if (isWork(x)) c--; } return x; };
  const sh = (x, k) => work ? addWork(x, k) : x + k;
  const nextWork = x => { let g = 0; while (!isWork(x) && g < 400) { x++; g++; } return x; };
  const idIdx = new Map(rows.map((r, i) => [Number(r.id), i]));
  const parent = new Array(N).fill(-1), kids = rows.map(() => []);
  let cur = -1;
  rows.forEach((r, i) => {
    if (r.type === 'vorgang') cur = i;
    else if (r.type === 'untervorgang' && cur >= 0) { parent[i] = cur; kids[cur].push(i); }
    else cur = -1;
  });
  const out = new Array(N).fill(null), seen = new Array(N).fill(0);
  function calc(i) {
    if (seen[i] === 2) return out[i];
    if (seen[i] === 1) return null;
    seen[i] = 1;
    const r = rows[i]; let res;
    if (r.type === 'vorgang' && kids[i].length) {
      let S = Infinity, E = -Infinity;
      for (const k of kids[i]) { const c = calc(k); if (c) { S = Math.min(S, c.S); E = Math.max(E, c.E); } }
      let err = null; if (S === Infinity) { S = P; E = P; err = 'Zirkelbezug'; }
      res = { S, E, summary: true, err, pred: -1, preds: [], dur: E - S + 1 };
    } else {
      const d = r.type === 'meilenstein' ? 1 : Math.max(parseInt(r.dur, 10) || 1, 1);
      let S = P, err = null, pidx = -1, best = -Infinity;
      const fx = parseISO(r.fixed); if (fx != null) S = Math.max(S, fx);
      const preds = [];
      // Mehrere Vorgänger: der späteste bestimmt den Start (pred = maßgeblicher Vorgänger)
      for (const l of rowLinks(r)) {
        const pi = idIdx.get(l.pred);
        if (pi === undefined || pi === i) continue;
        const pr = calc(pi);
        if (!pr) { err = 'Zirkelbezug'; continue; }
        const lag = parseInt(l.lag, 10) || 0; let c;
        switch (l.rel) {
          case 'AA': c = sh(pr.S, lag); break;
          case 'EE': c = sh(sh(pr.E, lag), 1 - d); break;
          case 'AE': c = sh(sh(pr.S, lag), 1 - d); break;
          default: c = sh(pr.E, 1 + lag);
        }
        preds.push({ i: pi, rel: l.rel });
        if (c > best) { best = c; pidx = pi; }
        S = Math.max(S, c);
      }
      if (work) S = nextWork(S);
      const E = r.type === 'meilenstein' ? S : sh(S, d - 1);
      res = { S, E, summary: false, err, pred: pidx, preds, dur: d };
    }
    seen[i] = 2; out[i] = res; return res;
  }
  for (let i = 0; i < N; i++) calc(i);
  for (let i = 0; i < N; i++) if (!out[i]) out[i] = { S: P, E: P, summary: false, err: 'Zirkelbezug', pred: -1, preds: [], dur: 1 };
  let top = 0, sub = 0; const psp = [];
  rows.forEach((r, i) => {
    if (r.type === 'untervorgang' && parent[i] >= 0) { sub++; psp.push(top + '.' + sub); }
    else { top++; sub = 0; psp.push(String(top)); }
  });
  return { out, parent, kids, psp, P, hol, holName, work, isWork };
}
// ===== LOGIC END =====
