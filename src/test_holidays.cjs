// Gesetzliche Feiertage je Bundesland und eigene freie Zeiträume
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'logic.js'), 'utf8') + ';this.L = { legalHolidays, easterDn, toISO, parseHolidayLine, schedule, fmtLong, REGIONS };', ctx);
const L = ctx.L, list = (r, y) => JSON.parse(JSON.stringify(L.legalHolidays(r, y).map(h => L.toISO(h.d) + ' ' + h.n)));

test('Ostersonntag', () => {
  assert.deepEqual([2024, 2025, 2026, 2027, 2028].map(y => String(L.toISO(L.easterDn(y)))), ['2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28', '2028-04-16']);
});
test('Baden-Württemberg 2027: 12 Feiertage', () => {
  assert.deepEqual(list('BW', 2027), ['2027-01-01 Neujahr', '2027-01-06 Heilige Drei Könige', '2027-03-26 Karfreitag', '2027-03-29 Ostermontag', '2027-05-01 Tag der Arbeit',
    '2027-05-06 Christi Himmelfahrt', '2027-05-17 Pfingstmontag', '2027-05-27 Fronleichnam', '2027-10-03 Tag der Deutschen Einheit', '2027-11-01 Allerheiligen',
    '2027-12-25 1. Weihnachtstag', '2027-12-26 2. Weihnachtstag']);
});
test('Länderbesonderheiten', () => {
  assert.ok(list('SN', 2026).includes('2026-11-18 Buß- und Bettag'));
  assert.ok(list('BE', 2026).includes('2026-03-08 Internationaler Frauentag'));
  assert.ok(list('MV', 2026).includes('2026-03-08 Internationaler Frauentag'));
  assert.ok(list('TH', 2026).includes('2026-09-20 Weltkindertag'));
  assert.ok(list('NI', 2026).includes('2026-10-31 Reformationstag'));
  assert.ok(!list('NW', 2026).some(x => x.includes('Reformationstag')));
  assert.ok(list('BY', 2026).includes('2026-08-15 Mariä Himmelfahrt'));
  assert.ok(list('BB', 2026).includes('2026-04-05 Ostersonntag'));
  assert.equal(L.legalHolidays('', 2026).length, 0);
  assert.equal(L.REGIONS.length, 16);
});
test('Zeiträume lesen', () => {
  assert.deepEqual({ ...L.parseHolidayLine('24.12.2026 - 06.01.2027 Betriebsurlaub') }, { d: '2026-12-24', n: 'Betriebsurlaub', to: '2027-01-06' });
  assert.deepEqual({ ...L.parseHolidayLine('2026-12-24 bis 2026-12-31') }, { d: '2026-12-24', n: '', to: '2026-12-31' });
  assert.equal(L.parseHolidayLine('31.12.2026 - 01.12.2026').bad, true);
});
test('Terminberechnung überspringt Feiertage und Betriebsurlaub', () => {
  const st = { start: '2026-12-21', mode: 'work', region: 'BW', holidays: [{ d: '2026-12-28', to: '2026-12-31', n: 'Betriebsurlaub' }],
    rows: [{ id: 1, type: 'vorgang', name: 'A', dur: '5', pred: '', rel: 'EA', lag: '', fixed: '' }] };
  const s = L.schedule(st);
  // 21.–24.12. = 4 AT, 25./26. Feiertag, 28.–31. Urlaub, 1.1. Neujahr → 5. AT am Montag 4.1.2027
  assert.equal(L.toISO(s.out[0].E), '2027-01-04');
  assert.equal(s.holName.get(L.easterDn(2027) - 2), 'Karfreitag');
});
