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

function parseHolidayLine(line) {
  line = line.trim(); if (!line) return null;
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s*(.*)$/.exec(line), y, mo, d, name;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; name = m[4]; }
  else { m = /^(\d{4})-(\d{2})-(\d{2})\s*(.*)$/.exec(line); if (!m) return { bad: true }; y = +m[1]; mo = +m[2]; d = +m[3]; name = m[4]; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { bad: true };
  const n = dn(y, mo, d); const c = ymd(n); if (c.d !== d || c.m !== mo) return { bad: true };
  return { d: toISO(n), n: name.trim() };
}

function schedule(st) {
  const rows = st.rows, N = rows.length;
  const P = parseISO(st.start) ?? todayDn();
  const hol = new Set(); (st.holidays || []).forEach(h => { const v = parseISO(h.d); if (v != null) hol.add(v); });
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
      res = { S, E, summary: true, err, pred: -1, dur: E - S + 1 };
    } else {
      const d = r.type === 'meilenstein' ? 1 : Math.max(parseInt(r.dur, 10) || 1, 1);
      let S = P, err = null, pidx = -1;
      const fx = parseISO(r.fixed); if (fx != null) S = Math.max(S, fx);
      const pi = (r.pred !== '' && r.pred != null) ? idIdx.get(Number(r.pred)) : undefined;
      if (pi !== undefined && pi !== i) {
        const pr = calc(pi);
        if (!pr) err = 'Zirkelbezug';
        else {
          const lag = parseInt(r.lag, 10) || 0; let c;
          switch (r.rel) {
            case 'AA': c = sh(pr.S, lag); break;
            case 'EE': c = sh(sh(pr.E, lag), 1 - d); break;
            case 'AE': c = sh(sh(pr.S, lag), 1 - d); break;
            default: c = sh(pr.E, 1 + lag);
          }
          S = Math.max(S, c); pidx = pi;
        }
      }
      if (work) S = nextWork(S);
      const E = r.type === 'meilenstein' ? S : sh(S, d - 1);
      res = { S, E, summary: false, err, pred: pidx, dur: d };
    }
    seen[i] = 2; out[i] = res; return res;
  }
  for (let i = 0; i < N; i++) calc(i);
  for (let i = 0; i < N; i++) if (!out[i]) out[i] = { S: P, E: P, summary: false, err: 'Zirkelbezug', pred: -1, dur: 1 };
  let top = 0, sub = 0; const psp = [];
  rows.forEach((r, i) => {
    if (r.type === 'untervorgang' && parent[i] >= 0) { sub++; psp.push(top + '.' + sub); }
    else { top++; sub = 0; psp.push(String(top)); }
  });
  return { out, parent, kids, psp, P, hol, work, isWork };
}
// ===== LOGIC END =====
