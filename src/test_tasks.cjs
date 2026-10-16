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

test('Organigramm: alte Stände werden in Teams mit Mitgliedschaften umgewandelt', () => {
  const run = app();
  const old = [
    { id: 1, kind: 'person', name: 'Leitung', parent: '' },
    { id: 2, kind: 'team', name: 'Planung', parent: 1 },
    { id: 3, kind: 'person', name: 'B', parent: 2, also: [{ team: 4, role: 'Statik' }] },
    { id: 4, kind: 'team', name: 'Bau', parent: 2 },
    { id: 5, kind: 'person', name: 'C', parent: 3 },
    { id: 6, kind: 'person', name: 'D', parent: 1 }];
  const s = run('sanitize(' + JSON.stringify({ rows: [], org: old }) + ').org');
  const by = id => s.find(n => n.id === id);
  assert.equal(by(1).pl, true); assert.deepEqual(by(1).teams, []);
  assert.equal(by(2).parent, '');                                   // Team unter Person -> direkt unter der Projektleitung
  assert.equal(by(4).parent, 2);                                    // Unterteam bleibt
  assert.deepEqual(by(3).teams, [{ team: 2, lead: false, role: '' }, { team: 4, lead: false, role: 'Statik' }]);
  assert.deepEqual(by(5).teams, [{ team: 2, lead: false, role: '' }]);   // Person unter Person -> Team der Vorgesetzten
  assert.equal(by(6).pl, false); assert.deepEqual(by(6).teams, []); // ohne Team
});

test('Organigramm: Bereinigung und Abgleich im neuen Aufbau', () => {
  const run = app();
  const s = run('sanitize(' + JSON.stringify({ rows: [], org: [
    { id: 1, kind: 'team', name: 'T', color: 'rot', parent: 5 },
    { id: 2, kind: 'person', name: 'P', pl: false, photo: 'javascript:x', teams: [{ team: 1, lead: true }, { team: 1 }, { team: 3 }, { team: 'x' }, null] },
    { id: 3, kind: 'person', name: 'Q', pl: true, teams: [] }] }) + ').org');
  assert.equal(s[0].color, ''); assert.equal(s[0].parent, '');
  assert.equal(s[1].photo, ''); assert.deepEqual(s[1].teams, [{ team: 1, lead: true, role: '' }]);
  assert.equal(s[2].pl, true);
  const person = (id, extra) => ({ id, kind: 'person', name: 'N' + id, role: '', uid: '', photo: '', pl: false, teams: [], ...extra });
  const b = { rows: [], org: [person(1), person(2)] };
  const m = { rows: [], org: [person(1, { teams: [{ team: 9, lead: true, role: '' }] }), person(2), person(300001)] };
  const t = { rows: [], org: [person(1, { name: 'Neu' }), person(2, { pl: true })] };
  const out = run('mergePlans(' + [b, m, t].map(x => JSON.stringify(x)).join(',') + ')');
  assert.deepEqual(out.org.map(n => n.id), [1, 2, 300001]);
  assert.equal(out.org[0].name, 'Neu'); assert.equal(out.org[0].teams[0].lead, true); assert.equal(out.org[1].pl, true);
});
