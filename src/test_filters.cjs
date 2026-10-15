const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function app() {
  // Die Ansichten erzeugen HTML/SVG-Strings. Dafür genügen Ausgabefelder und
  // Eventregistrierung; diese Mocks parsen kein HTML und simulieren kein Layout.
  const nodes = new Map(), storage = new Map();
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', hidden: true, dataset: {}, style: {}, events: {},
      querySelectorAll: () => [], querySelector: () => null, contains: () => false, classList: { toggle() {} },
      setAttribute(name, value) { this[name] = value; }, addEventListener(name, handler) { this.events[name] = handler; } });
    return nodes.get(id);
  };
  const context = vm.createContext({ console, window: {}, exportPdf() {},
    document: { getElementById: el, querySelector: el, activeElement: null },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  const run = code => vm.runInContext(code, context);
  run(['logic.js', 'people.js', 'ui.js', 'views.js', 'assignee-picker.js'].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n'));
  run('todayDn = () => dn(2026, 10, 15)');
  const data = expression => JSON.parse(run(`JSON.stringify(${expression})`));
  const load = plan => { context.fixture = plan; run('state = JSON.parse(JSON.stringify(fixture)); sched = schedule(state); resetViewFilters()'); };
  const filter = (who = '', status = 'all', query = '') => {
    context.filterInput = { who, status, query };
    run('fWho = filterInput.who; fSt = filterInput.status; fQ = filterInput.query; renderFilteredViews()');
  };
  return { run, data, load, filter, el, indices: () => data('visibleRowIndices()') };
}
const row = (id, type, name, who = '', st = '', pred = '', fixed = '') => ({ id, type, name, who, st, pred, fixed, dur: '1', rel: 'EA', lag: '' });
function plan(rows) {
  return { name: 'Filtertest', start: '2026-10-12', raster: 'days', mode: 'cal', lines: true, people: ['Alice', 'Bob', 'Carol'], holidays: [],
    lanes: [{ id: '', name: 'Offen', c: 0, done: false }, { id: 'abnahme', name: 'Abgenommen', c: 2, done: true }], rows: rows || [
      row(10, 'vorgang', 'Planung'), row(20, 'untervorgang', 'Alpha Bau', 'Alice, Bob'),
      row(30, 'untervorgang', 'Beta Prüfung', 'Bob', 'abnahme', 20),
      row(40, 'vorgang', 'Verdeckter Vorlauf', 'Carol', '', '', '2026-10-20'),
      row(50, 'vorgang', 'Gamma Montage', 'Alice', '', 40), row(60, 'meilenstein', 'Gamma Freigabe', 'Alice und bob', 'abnahme', 50)
    ] };
}
const ids = html => [...html.matchAll(/<g data-i="(\d+)"/g)].map(match => +match[1]);

test('Personenfilter erkennt jede Mehrfachzuordnung, trimmt und unterscheidet keine Großschreibung', () => {
  const a = app(), separators = [',', ';', '/', '&', '+', ' und ', ' UND '];
  const p = plan(separators.map((separator, i) => row(i + 1, 'vorgang', 'Gemeinsam', ` alice ${separator} Bob `)));
  p.people = [' ALICE ', 'bob']; p.rows.push(row(99, 'vorgang', 'Kein Teilworttreffer', 'Malice'));
  a.load(p); a.filter(' aLiCe ');
  assert.deepEqual(a.indices(), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(a.data('filterPeople()'), ['ALICE', 'bob', 'Malice']);
  a.filter('BOB'); assert.deepEqual(a.indices(), [0, 1, 2, 3, 4, 5, 6]);
});

test('Alle Kriterien müssen auf derselben Zeile passen; Kinder dürfen keinen falschen Elterntreffer bilden', () => {
  const a = app(); a.load(plan());
  a.filter('Alice', 'all', 'Beta'); assert.deepEqual(a.indices(), []);
  a.filter('Alice', 'lane:abnahme'); assert.deepEqual(a.indices(), [5]);
  assert.equal(a.data('matches(0)'), false);
});

test('Treffende Kinder behalten Elternkontext, Originalindizes und passende Listenstatistik', () => {
  const a = app(); a.load(plan()); a.filter('Alice', 'all', 'Alpha');
  assert.deepEqual(a.indices(), [0, 1]); assert.equal(a.data('matches(0)'), false);
  a.run("setView('list')");
  assert.deepEqual([...a.el('vList').innerHTML.matchAll(/data-go="(\d+)"/g)].map(match => +match[1]), [0, 1]);
  assert.match(a.el('vList').innerHTML, /1 Vorgänge und Meilensteine/);
  assert.equal(a.el('filterSummary').textContent, '1 von 5 Vorgängen');
  assert.equal(a.el('filterCount').textContent, '2');
});

test('Statusfilter berücksichtigt eigene Projektbahnen, erledigte und überfällige Vorgänge in allen Ansichten', () => {
  const a = app(); a.load(plan());
  a.filter('', 'open'); assert.deepEqual(a.indices(), [0, 1, 3, 4]);
  a.filter('', 'late'); assert.deepEqual(a.indices(), [0, 1]);
  a.filter('', 'lane:abnahme'); assert.deepEqual(a.indices(), [0, 2, 5]);
  a.run("setView('kanban')");
  assert.deepEqual([...a.el('vKanban').innerHTML.matchAll(/<article[^>]*data-i="(\d+)"/g)].map(match => +match[1]), [2, 5]);
  a.run("calM = dn(2026, 10, 1); setView('cal')");
  assert.deepEqual([...new Set([...a.el('vCal').innerHTML.matchAll(/data-go="(\d+)"/g)].map(match => +match[1]))], [2, 5]);
});

test('Gefilterte Gantt-Zeilen rücken zusammen; versteckte Vorgänger bleiben berechnet und erzeugen keine Links', () => {
  const a = app(); a.load(plan());
  const before = a.data('({state, out: sched.out, parent: sched.parent, psp: sched.psp})');
  a.filter('Alice'); const svg = a.el('chart').innerHTML;
  assert.deepEqual(ids(svg), [0, 1, 4, 5]); assert.match(svg, /height="136"/);
  assert.match(svg, /<g data-i="4"[^>]*>[\s\S]*?<rect class="bar-task"[^>]*y="77"/);
  assert.equal((svg.match(/<path class="link/g) || []).length, 1);
  assert.match(svg, /Vorgänger ausgeblendet/); assert.doesNotMatch(svg, /NaN|undefined/);
  assert.deepEqual(a.data('({state, out: sched.out, parent: sched.parent, psp: sched.psp})'), before);
  a.filter('', 'all', 'Ohne Treffer'); assert.deepEqual(a.indices(), []);
  assert.match(a.el('chart').innerHTML, /Kein Vorgang passt zum Filter/);
  a.run('resetViewFilters(); renderFilteredViews()'); assert.deepEqual(a.indices(), [0, 1, 2, 3, 4, 5]);
  assert.equal(a.el('filterCount').hidden, true); assert.equal(a.el('filterSummary').hidden, true);
  a.run('sched = null'); assert.deepEqual(a.indices(), [0, 1, 2, 3, 4, 5]);
});

test('Filterereignisse aktualisieren das Gantt; Umschalten und Projektwechsel setzen die Oberfläche konsistent', () => {
  const a = app(); a.load(plan()); a.run('initViews()');
  a.el('toggleFilters').events.click(); assert.equal(a.el('vfilters').hidden, false);
  assert.equal(a.el('toggleFilters')['aria-expanded'], 'true'); assert.equal(a.el('filterArrow').textContent, '▾');
  a.el('fWho').events.change({ target: { value: 'Carol' } }); assert.deepEqual(ids(a.el('chart').innerHTML), [3]);
  a.run("setView('list'); setView('gantt')"); assert.deepEqual(ids(a.el('chart').innerHTML), [3]);
  a.el('resetFilters').events.click(); assert.equal(ids(a.el('chart').innerHTML).length, 6);
  a.filter('Alice', 'late', 'Alpha');
  a.run("applyProject('anderes-projekt', {...state, rows: Array.from({length: 8}, (_,i) => ({...state.rows[4], id: i+100, pred: '', who: 'Neu'}))})");
  assert.deepEqual(a.data('[fWho, fSt, fQ]'), ['', 'all', '']); assert.equal(a.indices().length, 8);
  assert.equal(a.el('fWho').value, ''); assert.equal(a.el('fSt').value, 'all'); assert.equal(a.el('fQ').value, '');
  a.el('toggleFilters').events.click(); assert.equal(a.el('vfilters').hidden, true);
  assert.equal(a.el('filterArrow').textContent, '▸');
});

test('Eine bearbeitete Zeile bleibt anhand ihrer ID samt Eltern gepinnt, auch nach Reihenfolgeänderungen', () => {
  const a = app(); a.load(plan()); a.filter('Alice', 'all', 'Alpha');
  a.run('filterEditId = 20; state.rows[1].who = "Carol"; sched = schedule(state); renderFilteredViews(true); renderChart()');
  assert.deepEqual(a.indices(), []); assert.deepEqual(a.data('ganttRowIndices()'), [0, 1]);
  assert.deepEqual(ids(a.el('chart').innerHTML), [0, 1]);
  a.run('state.rows.splice(2, 0, state.rows.splice(1, 1)[0]); sched = schedule(state); renderFilteredViews(true); renderChart()');
  assert.equal(a.data('state.rows[2].id'), 20); assert.deepEqual(a.data('ganttRowIndices()'), [0, 2]);
  assert.deepEqual(ids(a.el('chart').innerHTML), [0, 2]);
  assert.deepEqual([...a.el('rowsL').innerHTML.matchAll(/class="grid row" data-i="(\d+)"/g)].map(match => +match[1]), [0, 2]);
  a.run('resetViewFilters()'); assert.equal(a.data('filterEditId'), null);
  a.run('filterEditId = 20; applyProject("anderer-plan", JSON.parse(JSON.stringify(state)))');
  assert.equal(a.data('filterEditId'), null); assert.deepEqual(a.data('ganttRowIndices()'), [0, 1, 2, 3, 4, 5]);
});
