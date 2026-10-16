// Aufgaben: Bereinigung und Dreiwege-Abgleich zwischen zwei Teammitgliedern
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
  vm.runInContext(['logic.js', 'people.js', 'ui.js', 'views.js', 'tasks.js'].map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n'), context);
  return code => JSON.parse(vm.runInContext('JSON.stringify(' + code + ')', context));
}
const plan = tasks => ({ name: 'T', start: '2026-10-12', rows: [{ id: 1, type: 'vorgang', name: 'A' }], tasks });
const task = (id, title, extra) => ({ id, title, desc: '', who: '', due: '', prio: 'normal', done: false, row: '', by: '', created: '2026-10-15', ...extra });

test('Bereinigung: ungültige Werte werden korrigiert, doppelte Nummern ersetzt', () => {
  const run = app();
  const s = run('sanitize(' + JSON.stringify(plan([task(5, 'X', { prio: 'egal', due: 'morgen', row: 'x' }), task(5, 'Y'), { id: 'a', title: 7 }])) + ')');
  assert.equal(s.tasks.length, 3);
  assert.deepEqual(s.tasks.map(t => t.id), [5, 6, 7]);
  assert.equal(s.tasks[0].prio, 'normal'); assert.equal(s.tasks[0].due, ''); assert.equal(s.tasks[0].row, '');
  assert.equal(s.tasks[2].title, '7');
  assert.deepEqual(run('sanitize(' + JSON.stringify({ rows: [] }) + ').tasks'), []);
});

test('Abgleich: gleichzeitig angelegte, geänderte und gelöschte Aufgaben', () => {
  const run = app();
  const b = plan([task(1, 'Basis'), task(2, 'Wird gelöscht'), task(3, 'Feld')]);
  const m = plan([task(1, 'Basis', { done: true }), task(2, 'Wird gelöscht'), task(3, 'Feld', { prio: 'hoch' }), task(400001, 'Meine neue')]);
  const t = plan([task(1, 'Basis'), task(3, 'Feld', { due: '2026-10-20' }), task(500002, 'Neue der Kollegin')]);
  const out = run('mergePlans(' + [b, m, t].map(x => JSON.stringify(x)).join(',') + ')');
  assert.deepEqual(out.tasks.map(x => x.id), [1, 3, 500002, 400001]);
  assert.equal(out.tasks[0].done, true);                              // meine Änderung
  assert.equal(out.tasks[1].prio, 'hoch'); assert.equal(out.tasks[1].due, '2026-10-20');   // beide Felder
});

test('Abgleich: Zuständige werden als Ganzes übernommen', () => {
  const run = app();
  const b = plan([task(1, 'A', { who: 'Alice' })]);
  const m = plan([task(1, 'A', { who: 'Alice, Bob', assignees: [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }] })]);
  const t = plan([task(1, 'A erweitert', { who: 'Alice' })]);
  const out = run('mergePlans(' + [b, m, t].map(x => JSON.stringify(x)).join(',') + ')');
  assert.equal(out.tasks[0].title, 'A erweitert'); assert.equal(out.tasks[0].who, 'Alice, Bob'); assert.equal(out.tasks[0].assignees.length, 2);
});

test('Organigramm: Bereinigung und Abgleich', () => {
  const run = app();
  const node = (id, name, extra) => ({ id, kind: 'person', name, role: '', uid: '', photo: '', parent: '', color: '', ...extra });
  const s = run('sanitize(' + JSON.stringify({ rows: [], org: [node(1, 'A', { kind: 'team', color: 'rot' }), node(2, 'B', { parent: 1, photo: 'javascript:x' }), node(3, 'C', { parent: 3 })] }) + ')');
  assert.equal(s.org[0].kind, 'team'); assert.equal(s.org[0].color, ''); assert.equal(s.org[1].photo, ''); assert.equal(s.org[1].parent, 1); assert.equal(s.org[2].parent, '');
  const b = { rows: [], org: [node(1, 'Leitung'), node(2, 'B', { parent: 1 })] };
  const m = { rows: [], org: [node(1, 'Leitung'), node(2, 'B', { parent: 1, role: 'Statik' }), node(300001, 'Neu von mir', { parent: 1 })] };
  const t = { rows: [], org: [node(1, 'Projektleitung'), node(2, 'B', { parent: 1 })] };
  const out = run('mergePlans(' + [b, m, t].map(x => JSON.stringify(x)).join(',') + ')');
  assert.deepEqual(out.org.map(n => n.id), [1, 2, 300001]);
  assert.equal(out.org[0].name, 'Projektleitung'); assert.equal(out.org[1].role, 'Statik');
});
