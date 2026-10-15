const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function app(directory) {
  // Nur HTML-/SVG-Ausgaben und Elementzustände werden benötigt. Kein Browserlayout
  // und keine HTML-Parser: Interaktionen werden über die echten Auswahlfunktionen geprüft.
  const nodes = new Map();
  const make = () => ({ innerHTML: '', textContent: '', value: '', hidden: true, dataset: {}, style: {}, events: {}, children: [],
    classList: { toggle() {}, add() {}, remove() {} }, querySelectorAll: () => [], querySelector: () => null,
    contains(value) { return this === value || this.children.some(child => child.contains(value)); },
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this[name] = value; }, addEventListener(name, handler) { this.events[name] = handler; } });
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, make());
    return nodes.get(id);
  };
  const context = vm.createContext({ console, window: {}, setTimeout: () => 0, clearTimeout() {},
    document: { getElementById: el, querySelector: el, activeElement: null, createElement: make, createDocumentFragment: make },
    localStorage: { getItem: () => null, setItem() {} } });
  const run = code => vm.runInContext(code, context);
  run(['logic.js', 'people.js', 'ui.js', 'views.js', 'assignee-picker.js', 'pdf.js']
    .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n'));
  run('todayDn = () => dn(2026, 10, 15)');
  const data = expression => JSON.parse(run(`JSON.stringify(${expression})`));
  const team = value => { context.directory = value; run(value === undefined ? 'delete window.TP_TEAM' : 'window.TP_TEAM = () => directory'); };
  team(directory);
  const load = rows => {
    context.fixture = rows;
    run('state = blankPlan(); state.name = "Personentest"; state.start = "2026-10-12"; state.rows = JSON.parse(JSON.stringify(fixture)); sched = schedule(state); resetViewFilters()');
  };
  return { run, data, load, team, el };
}
const row = (who = '', assignees) => ({ id: 1, type: 'vorgang', name: 'Montage', who, pred: '', rel: 'EA', lag: '', fixed: '', dur: '1', st: '',
  ...(assignees === undefined ? {} : { assignees }) });
const initialTeam = [{ id: '1', name: 'Anna Kern' }, { id: '2', name: 'Bo Lang' }, { id: '3', name: 'Clara West' }];

test('Benutzer-IDs folgen Umbenennungen und überstehen Namenskollisionen sowie gelöschte Konten', () => {
  const a = app(initialTeam);
  a.load([row('Veralteter Text', [{ id: '1', name: 'Anna früher' }, { id: '99', name: 'Ehemaliger Kollege' }, { id: null, name: 'Bo Lang' }])]);
  a.team([{ id: '1', name: 'Anna Neu' }, { id: '2', name: 'Anna früher' }, { id: '3', name: 'Bo Lang' }]);
  assert.deepEqual(a.data('assigneeEntries(state.rows[0])'), [
    { id: '1', name: 'Anna Neu', available: true }, { id: '99', name: 'Ehemaliger Kollege', available: false }, { id: null, name: 'Bo Lang', available: false }
  ]);
  assert.equal(a.data('assigneeNames(state.rows[0])'), 'Anna Neu, Ehemaliger Kollege, Bo Lang');
  a.team([]); assert.equal(a.data('assigneeEntries(state.rows[0])[0].name'), 'Anna früher');
});

test('Alte Namen werden über alle vorhandenen Trenner nur bei eindeutiger Übereinstimmung verknüpft', () => {
  const a = app(initialTeam);
  for (const separator of [',', ';', '/', '&', '+', ' und ', ' UND ']) {
    a.load([row(` anna kern ${separator} BO LANG ${separator} Externes Gewerk `)]);
    assert.deepEqual(a.data('assigneeEntries(state.rows[0])').map(entry => [entry.id, entry.name]), [['1', 'Anna Kern'], ['2', 'Bo Lang'], [null, 'Externes Gewerk']]);
  }
  a.team([{ id: '1', name: 'Anna Kern' }, { id: '2', name: 'ANNA KERN' }]);
  a.load([row('anna kern')]); assert.equal(a.data('assigneeEntries(state.rows[0])[0].id'), null);
  a.team(undefined); a.load([row('Freies Gewerk; Andere Person')]);
  assert.equal(a.data('hasUserDirectory()'), false);
  assert.deepEqual(a.data('assigneeEntries(state.rows[0])').map(entry => entry.name), ['Freies Gewerk', 'Andere Person']);
});

test('Explizit leere Zuordnungen haben Vorrang vor altem who-Text und bleiben beim Sanitizen und JSON-Roundtrip erhalten', () => {
  const a = app(initialTeam); a.load([row('Anna Kern', [])]);
  assert.deepEqual(a.data('assigneeEntries(state.rows[0])'), []); assert.equal(a.data('assigneeNames(state.rows[0])'), '');
  assert.deepEqual(a.data('sanitize(JSON.parse(JSON.stringify(state))).rows[0].assignees'), []);
  a.run('state.rows[0].assignees = [{id:"1",name:"Anna Kern"},{id:null,name:"Extern"}]');
  assert.deepEqual(a.data('sanitize(JSON.parse(JSON.stringify(state))).rows[0].assignees'), [{ id: '1', name: 'Anna Kern' }, { id: null, name: 'Extern' }]);
});

test('Zuordnungssnapshots werden normalisiert, dedupliziert und auf sichere ID-/Namensfelder begrenzt', () => {
  const a = app(initialTeam);
  assert.deepEqual(a.data('sanitizeAssignees([null,42,"Text",{id:1,name:" Anna Kern ",html:"<script>"},{id:"1",name:"Doppelt"},{id:null,name:" Extern "},{id:null,name:"EXTERN"},{id:"2"},{id:"../bad",name:"Freies Gewerk"}])'), [
    { id: null, name: '42' }, { id: null, name: 'Text' }, { id: '1', name: 'Anna Kern' }, { id: null, name: 'Extern' }, { id: '2', name: 'Benutzer #2' }, { id: null, name: 'Freies Gewerk' }
  ]);
  assert.deepEqual(a.data('sanitizeAssignees({id:"1",name:"Kein Array"})'), []);
});

test('Ein unregelmäßiger Altimport erhält primitive Namen und ungültige IDs als lesbare freie Zuordnungen', () => {
  const a = app(initialTeam); a.load([row('', [null, 42, 'Altgewerk', { id: 'alte-id' }, '', { id: null }])]);
  a.run('state = sanitize(JSON.parse(JSON.stringify(state)))');
  assert.deepEqual(a.data('state.rows[0].assignees'), [{ id: null, name: '42' }, { id: null, name: 'Altgewerk' }, { id: null, name: 'alte-id' }]);
  assert.equal(a.data('assigneeNames(state.rows[0])'), '42, Altgewerk, alte-id');
  assert.deepEqual(a.data('sanitize(JSON.parse(JSON.stringify(state))).rows[0].assignees'), a.data('state.rows[0].assignees'));
});

test('Initialen verwenden Vor- und Nachnamen, auch bei mehrteiligen Namen und einzelnen Wörtern', () => {
  const a = app(initialTeam);
  assert.equal(a.data('assigneeInitials(" Julia von Hahn ")'), 'JH');
  assert.equal(a.data('assigneeInitials("Anna-Lena Müller")'), 'AM');
  assert.equal(a.data('assigneeInitials("Clara")'), 'CL');
  assert.equal(a.data('assigneeInitials("X")'), 'X');
});

test('Webfilter bindet an Benutzer-IDs und sucht aktuelle volle Namen statt veralteter Snapshots', () => {
  const a = app(initialTeam);
  a.load([row('Alte Namen', [{ id: '1', name: 'Anna früher' }, { id: '2', name: 'Bo früher' }]),
    { ...row('Anna Kern', [{ id: null, name: 'Anna Kern' }]), id: 2 }, { ...row('', [{ id: '3', name: 'Clara West' }]), id: 3 }]);
  a.team([{ id: '1', name: 'Anna Neu' }, { id: '2', name: 'Bo Lang' }, { id: '3', name: 'Clara West' }]);
  a.run('fWho = "user:1"; fQ = "Anna Neu"; renderFilteredViews()');
  assert.deepEqual(a.data('visibleRowIndices()'), [0]);
  a.run('fWho = "user:2"; fQ = "Montage"; renderFilteredViews()'); assert.deepEqual(a.data('visibleRowIndices()'), [0]);
  const options = a.run('whoOptions()');
  assert.match(options, /value="user:1"[^>]*>Anna Neu/); assert.doesNotMatch(options, /Anna früher|value="Anna Kern"/);
  a.run('fWho = "user:3"; fQ = "Anna Neu"; renderFilteredViews()'); assert.deepEqual(a.data('visibleRowIndices()'), []);
});

test('Dreiwege-Zusammenführung erhält neue Zuordnungen und explizite Löschungen neben fremden Änderungen', () => {
  const a = app(initialTeam); a.load([row('Anna Kern', [{ id: '1', name: 'Anna Kern' }])]);
  a.run('globalThis.b = JSON.parse(JSON.stringify(state)); globalThis.m = JSON.parse(JSON.stringify(state)); globalThis.t = JSON.parse(JSON.stringify(state)); m.rows[0].assignees = []; m.rows[0].who = ""; t.rows[0].name = "Von Kollegen geändert"; globalThis.result = sanitize(mergePlans(b,m,t))');
  assert.deepEqual(a.data('result.rows[0].assignees'), []); assert.equal(a.data('result.rows[0].name'), 'Von Kollegen geändert');
  a.run('m = JSON.parse(JSON.stringify(b)); t = JSON.parse(JSON.stringify(b)); m.rows[0].name = "Meine Bezeichnung"; t.rows[0].assignees = [{id:"2",name:"Bo Lang"}]; t.rows[0].who = "Bo Lang"; result = sanitize(mergePlans(b,m,t))');
  assert.deepEqual(a.data('result.rows[0].assignees'), [{ id: '2', name: 'Bo Lang' }]); assert.equal(a.data('result.rows[0].name'), 'Meine Bezeichnung');
});

test('Eine neue Auswahl schreibt IDs und Namen und bleibt nach späterer Umbenennung stabil', () => {
  const a = app(initialTeam); a.load([row('Altes Gewerk')]);
  a.run('globalThis.calls = []; refresh = () => calls.push("refresh"); changed = () => calls.push("changed"); setRowAssignees(0,[{id:"1",name:"Anna Kern"},{id:"2",name:"Bo Lang"}])');
  assert.deepEqual(a.data('state.rows[0].assignees').map(entry => entry.id), ['1', '2']);
  assert.equal(a.data('state.rows[0].who'), 'Anna Kern, Bo Lang');
  assert.ok(a.data('calls.includes("refresh") && calls.includes("changed")'));
  a.team([{ id: '1', name: 'Anna Neu' }, { id: '2', name: 'Bo Lang' }]);
  assert.equal(a.data('assigneeNames(state.rows[0])'), 'Anna Neu, Bo Lang');
  a.run('setRowAssignees(0,[])'); assert.deepEqual(a.data('state.rows[0].assignees'), []); assert.equal(a.data('state.rows[0].who'), '');
});

test('Neue Auswahlen sind auf echte Benutzer beschränkt, vorhandene freie und gelöschte Zuordnungen bleiben entfernbar', () => {
  const a = app(initialTeam); a.load([row('', [{ id: null, name: 'Extern' }, { id: '99', name: 'Gelöscht' }])]);
  a.run('refresh = () => {}; changed = () => {}; setRowAssignees(0,[{id:"1",name:"Anna Kern"},{id:null,name:"Extern"},{id:"99",name:"Gelöscht"},{id:null,name:"Neu erfunden"},{id:"404",name:"Unbekannt"}])');
  assert.deepEqual(a.data('state.rows[0].assignees'), [{ id: '1', name: 'Anna Kern' }, { id: null, name: 'Extern' }, { id: '99', name: 'Gelöscht' }]);
  a.run('readOnly = true; setRowAssignees(0,[])'); assert.equal(a.data('state.rows[0].assignees.length'), 3);
});

test('CSV und PDF erhalten vollständige aktuelle Namen statt Initialen oder veraltetem who-Text', () => {
  const a = app(initialTeam); a.load([row('FALSCH', [{ id: '1', name: 'Anna früher' }, { id: '2', name: 'Bo früher' }])]);
  assert.match(a.run('csvText()'), /"Anna Kern, Bo Lang"/); assert.doesNotMatch(a.run('csvText()'), /FALSCH|früher/);
  a.run('globalThis.pdfText = []; function FakePdf() { return new Proxy({text: value => pdfText.push(value), getTextWidth: () => 0, output: () => "PDF"}, {get: (target,key) => target[key] || (() => {})}); } buildPdf(FakePdf)');
  assert.ok(a.data('pdfText.includes("Anna Kern, Bo Lang")')); assert.ok(!a.data('pdfText.includes("FALSCH")'));
});

test('Der JSON-Export schreibt aktuelle Namenssnapshots mit IDs und verändert den ursprünglichen Plan nicht', () => {
  const a = app(initialTeam); a.load([row('Alt', [{ id: '1', name: 'Anna früher' }]), { ...row('Bo Lang'), id: 2 }, { ...row('Stale', []), id: 3 }]);
  a.team([{ id: '1', name: 'Anna Neu' }, ...initialTeam.slice(1)]); const before = a.data('state');
  a.run('globalThis.exportedPlan = planWithAssignees(state)');
  assert.deepEqual(a.data('exportedPlan.rows.map(row => row.assignees)'), [[{ id: '1', name: 'Anna Neu' }], [{ id: '2', name: 'Bo Lang' }], []]);
  assert.deepEqual(a.data('exportedPlan.rows.map(row => row.who)'), ['Anna Neu', 'Bo Lang', '']);
  a.run('exportedPlan.rows[0].assignees[0].name = "Nur im Export"; exportedPlan.rows[0].who = "Nur im Export"');
  assert.deepEqual(a.data('state'), before);
});

test('Kompakte Zellen zeigen höchstens zwei Initialen mit +N und escapen vollständige Namen im Tooltip', () => {
  const a = app([{ id: '1', name: 'Dora "D" <Chef>' }, ...initialTeam.slice(1)]);
  a.load([row('', [{ id: '1', name: 'Alt' }, { id: '2', name: 'Alt' }, { id: '3', name: 'Alt' }])]);
  const html = a.run('assigneeCell(state.rows[0],0)');
  assert.equal((html.match(/class="who-initials"/g) || []).length, 2); assert.match(html, /class="who-more"[^>]*>\+1/);
  assert.match(html, /title="Dora &quot;D&quot; &lt;Chef&gt;, Bo Lang, Clara West"/);
  assert.match(html, /data-who-row="1"/); assert.doesNotMatch(html, /<Chef>|data-f="who"/);
  a.team(undefined); a.load([row('Altes Gewerk')]);
  assert.match(a.run('assigneeCell(state.rows[0],0)'), /input data-f="who".*value="Altes Gewerk"/);
  a.load([row('Veralteter Eintrag', [])]);
  assert.match(a.run('assigneeCell(state.rows[0],0)'), /input data-f="who".*value=""/);
});

test('Die echte Checkboxauswahl bleibt nach Umbenennung und Zeilenwechsel an dieselbe Benutzer- und Zeilen-ID gebunden', () => {
  const a = app(initialTeam); a.load([row(), { ...row('', [{ id: '3', name: 'Clara West' }]), id: 2 }]);
  a.run('refresh = () => {}; changed = () => {}; refreshAssigneePicker = () => {}; apState = {rowId:1}; apRenderOptions(state.rows[0])');
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const checkbox = id => descendants(a.el('peoplePickerOptions')).find(node => node.dataset.assigneeKey === 'user:' + id);
  const anna = checkbox('1'); assert.equal(anna.checked, false); anna.checked = true; anna.events.change();
  assert.deepEqual(a.data('state.rows[0].assignees'), [{ id: '1', name: 'Anna Kern' }]);
  a.team([{ id: '1', name: 'Anna Neu' }, ...initialTeam.slice(1)]);
  a.run('state.rows.reverse(); apRenderOptions(state.rows[1])');
  assert.equal(checkbox('1').checked, true); assert.equal(a.data('assigneeNames(state.rows[1])'), 'Anna Neu');
  checkbox('1').checked = false; checkbox('1').events.change(); checkbox('2').checked = true; checkbox('2').events.change();
  assert.deepEqual(a.data('state.rows[1].assignees'), [{ id: '2', name: 'Bo Lang' }]);
  assert.deepEqual(a.data('state.rows[0].assignees'), [{ id: '3', name: 'Clara West' }]);
});

test('Der erste Serversnapshot ersetzt den lokalen main-Platzhalter durch ein wirklich vorhandenes Projekt', () => {
  const a = app(initialTeam); a.load([row()]); a.run('renderAll()');
  assert.equal(a.data('proj.has("main") && typeof proj.get("main").json !== "string"'), true);
  a.run('globalThis.snapshotNext = null; attach({onSnapshot(next) { snapshotNext = next; }}, () => [...proj.keys()][0] || null, null)');
  assert.doesNotThrow(() => a.run('snapshotNext({docs:[{id:"serverprojekt",data:() => ({json:JSON.stringify({...state,name:"Echter Serverplan"}),savedAt:"2026-10-15T10:00:00.000Z",by:"1"})}]})'));
  assert.equal(a.data('curId'), 'serverprojekt'); assert.equal(a.data('state.name'), 'Echter Serverplan');
  assert.deepEqual(a.data('[...proj.keys()]'), ['serverprojekt']);
  assert.doesNotMatch(a.el('projSel').innerHTML, /value="main"/);
});
