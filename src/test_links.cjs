// Mehrere Vorgänger: Terminberechnung, Bereinigung, Löschen eines Vorgängers
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function app() {
  const el = () => ({ innerHTML: '', textContent: '', value: '', hidden: true, dataset: {}, style: {}, querySelectorAll: () => [], querySelector: () => null,
    contains: () => false, classList: { toggle() {}, contains() { return false; } }, setAttribute() {}, addEventListener() {} });
  const context = vm.createContext({ console, window: {}, exportPdf() {}, document: { getElementById: el, querySelector: el, activeElement: null, documentElement: el() },
    localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(['logic.js', 'people.js', 'ui.js', 'views.js'].map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n'), context);
  return code => JSON.parse(vm.runInContext('JSON.stringify(' + code + ')', context));
}
const row = (id, dur, extra) => ({ id, type: 'vorgang', name: 'V' + id, dur: String(dur), pred: '', rel: 'EA', lag: '', fixed: '', ...extra });
const plan = rows => ({ name: 'T', start: '2026-10-12', mode: 'cal', holidays: [], rows });

test('Der späteste Vorgänger bestimmt den Start', () => {
  const run = app();
  const p = plan([row(1, 3), row(2, 8), row(3, 2, { pred: 1, deps: [{ pred: 2, rel: 'EA', lag: '' }] })]);
  const s = run('(() => { const s = schedule(' + JSON.stringify(p) + '); return s.out.map(o => [toISO(o.S), toISO(o.E), o.pred, o.preds.length]); })()');
  assert.deepEqual(s[2], ['2026-10-20', '2026-10-21', 1, 2]);   // nach V2 (bis 19.10.), nicht nach V1
});
test('Beziehung und Versatz gelten je Vorgänger', () => {
  const run = app();
  const p = plan([row(1, 3), row(2, 8), row(3, 2, { pred: 2, rel: 'AA', lag: '1', deps: [{ pred: 1, rel: 'EA', lag: '5' }] })]);
  const s = run('(() => { const s = schedule(' + JSON.stringify(p) + '); return [toISO(s.out[2].S), s.out[2].pred]; })()');
  assert.deepEqual(s, ['2026-10-20', 0]);   // V1 endet 14.10. + 1 + 5 = 20.10.; V2 AA+1 = 13.10.
});
test('Zirkelbezug über einen weiteren Vorgänger wird erkannt', () => {
  const run = app();
  const p = plan([row(1, 3, { pred: 2 }), row(2, 2, { pred: 3, deps: [{ pred: 1 }] }), row(3, 1)]);
  const s = run('schedule(' + JSON.stringify(p) + ').out.map(o => o.err)');
  assert.ok(s[0] || s[1]);
});
test('Bereinigung: Duplikate entfallen, erster Vorgänger rückt nach, ohne weitere kein deps', () => {
  const run = app();
  const a = run('sanitize(' + JSON.stringify(plan([row(1, 1), row(2, 1), row(3, 1, { pred: '', deps: [{ pred: 2, rel: 'EE', lag: '3' }, { pred: 2 }, { pred: 1, rel: 'xx' }] })])) + ').rows[2]');
  assert.equal(a.pred, 2); assert.equal(a.rel, 'EE'); assert.equal(a.lag, '3'); assert.deepEqual(a.deps, [{ pred: 1, rel: 'EA', lag: '' }]);
  const b = run('sanitize(' + JSON.stringify(plan([row(1, 1), row(2, 1, { pred: 1, deps: [] })])) + ').rows[1]');
  assert.equal('deps' in b, false); assert.equal(b.pred, 1);
});
test('Hilfsfunktionen: Liste lesen und zurückschreiben', () => {
  const run = app();
  const r = run('(() => { const r = { pred: 4, rel: "AA", lag: "2", deps: [{ pred: 7, rel: "EA", lag: "" }] }; const L = rowLinks(r); L.shift(); setRowLinks(r, L); return [r, L.map(linkText)]; })()');
  assert.equal(r[0].pred, 7); assert.equal('deps' in r[0], false); assert.deepEqual(r[1], ['7']);
});
test('Abhängige Zeilen sind als Vorgänger ausgeschlossen (auch über Sammelvorgang)', () => {
  const run = app();
  const p = plan([row(1, 2), { ...row(2, 1), type: 'untervorgang', pred: 1 }, row(3, 1, { pred: 2 }), row(4, 1)]);
  const d = run('(() => { const p = ' + JSON.stringify(p) + '; return [...dependentsOf(p.rows, schedule(p), 0)].sort(); })()');
  assert.deepEqual(d, [0, 1, 2]);   // die Zeile selbst, ihr Untervorgang (mit ihr als Vorgänger) und Zeile 3 (Vorgänger ist der Untervorgang)
});
