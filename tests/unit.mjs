// Unit checks for the catalog, the rules and the one-time conversion. Mock data only.
import { BASE_LINES, GENERIC_RULES, SECTIONS, migrateSettings, aggregate, DEFAULT_SETTINGS, applyProfile, lines } from '../model.js';
import { legacySettings } from './mock.mjs';
import { reporter } from './report.mjs';
import { suggestLines } from '../suggest.js';
const { ok, done } = reporter();
const ids = BASE_LINES.map((l) => l.id);
ok('catalog: line ids are unique', new Set(ids).size === ids.length);
ok('catalog: every line sits in a known section', BASE_LINES.every((l) => SECTIONS[l.sec]));
ok('catalog: every generic rule points at a catalog line', GENERIC_RULES.every(([id]) => ids.includes(id)));
const mk = (id, date, amount, text) => ({ id, date, amount, text, vendor: text, vkey: text.toUpperCase(), cardDate: null });
const settings = () => ({ ...structuredClone(DEFAULT_SETTINGS) });
// conversion
const legacy = legacySettings(); const before = JSON.stringify(legacy);
const r = migrateSettings(legacy);
ok('conversion: reports a change for old settings', r.changed === true);
ok('conversion: old line ids and sections are converted', r.settings.vendorRules['EXAMPLE REMIT LTD'] === 'ab.transfer' && r.settings.txRules.user_test_123 === 'ab.transfer'
  && r.settings.profile.rules[0].line === 'ab.transfer' && r.settings.profile.lines[0].sec === 'abroad');
ok('conversion: input is left untouched (backup stays intact)', JSON.stringify(legacy) === before);
const again = migrateSettings(r.settings);
ok('conversion: running it twice changes nothing', again.changed === false && JSON.stringify(again.settings) === JSON.stringify(r.settings));
ok('conversion: empty settings are fine', migrateSettings({}).changed === false && migrateSettings(undefined).changed === false);
// old rules still classify after conversion
{
  const s = r.settings; s.profile.rules.push({ line: 'ab.transfer', any: ['EXAMPLE REMIT LTD'] });
  const a = aggregate([mk('t1', '2026-04-15', -100, 'Example Remit Ltd'), mk('t2', '2026-04-01', 2345.67, 'Lohn/Gehalt TEST SALARY')], { ...settings(), ...s });
  ok('rules: converted rule classifies a transfer abroad', a.rows[0].line === 'ab.transfer' && a.summary[0].abroadGross === 100);
  ok('rules: generic salary rule still works', a.rows[1].line === 'in.salary');
}
// without a rules file nothing is guessed from names
{
  const a = aggregate([mk('t1', '2026-03-15', -45.9, 'Test Supermarket'), mk('t2', '2026-03-15', -12.5, 'Shop A')], settings());
  ok('starter catalog: unknown shops go to Review', a.review.length === 2);
}
// overspent month, empty month
{
  const a = aggregate([mk('t1', '2026-06-15', -45.9, 'Test Cafe'), mk('t2', '2026-07-15', 100, 'Savings Test Account')], settings());
  ok('overspent month is negative', a.summary[0].saved < 0);
}
// B55: answers to lines the catalog does not have are kept apart from new vendors
{
  const s = { ...settings(), vendorRules: { 'SHOP A': 'c.test_line' } };
  const a = aggregate([mk('t1', '2026-08-15', -12.5, 'Shop A'), mk('t2', '2026-08-15', -45.9, 'Shop B')], s);
  ok('B55: booking with an answer to an unknown line is not in Review', a.unknownLine.length === 1 && a.review.length === 1 && a.review[0].id === 't2');
  ok('B55: the unknown answer is counted', a.orphanCount === 1);
  s.profile = { ...structuredClone(DEFAULT_SETTINGS).profile, lines: [{ id: 'c.test_line', sec: 'variable', label: 'Test line', group: '' }], rules: [] };
  const b = aggregate([mk('t1', '2026-08-15', -12.5, 'Shop A')], s);
  ok('B55: once the line exists, the booking is assigned', b.rows[0].line === 'c.test_line' && b.unknownLine.length === 0 && b.orphanCount === 0);
  const c = aggregate([mk('t1', '2026-08-15', -12.5, 'Shop A')], { ...settings(), profile: { lines: [], rules: [{ line: 'c.test_line', any: ['SHOP A'] }] } });
  ok('B55: a rule to an unknown line is caught too', c.unknownLine.length === 1 && c.review.length === 0 && c.orphanCount === 1);
}
// I68: suggested lines for a booking in Review
{
  const row = (id, line, amount, text, date = '2026-04-01') => ({ id, line, amount, text, date });
  const rows = [
    row('a1', 'v.fuel', -45.9, 'Kartenzahlung Test Fuel Station', '2026-03-15'), row('a2', 'v.fuel', -45.9, 'Kartenzahlung Test Fuel Station', '2026-04-15'),
    row('a3', 'v.otherGrocery', -45.9, 'Kartenzahlung Test Supermarket', '2026-04-15'), row('a4', 'ot.other', -45.9, 'Kartenzahlung Test Online Store', '2026-05-15'),
    row('a5', 'sv.in', 1500, 'Ueberweisung Savings Test Account', '2026-06-15'), row('a6', 'in.salary', 2345.67, 'Lohn TEST EMPLOYER GMBH', '2026-04-01'),
  ];
  const out = suggestLines(row('n1', null, -12.5, 'Kartenzahlung Test Fuel Station Shop'), rows);
  ok('I68: the line with the most shared words comes first', out[0] === 'v.fuel', JSON.stringify(out));
  ok('I68: at most three suggestions', out.length <= 3);
  ok('I68: money out is never offered a line used only for money in', !out.includes('sv.in') && !out.includes('in.salary'), JSON.stringify(out));
  const inn = suggestLines(row('n2', null, 100, 'Ueberweisung Savings Test Account'), rows);
  ok('I68: money in is never offered a line used only for money out', inn.every((x) => ['sv.in', 'in.salary'].includes(x)) && inn[0] === 'sv.in', JSON.stringify(inn));
  ok('I68: nothing answered yet gives no suggestions', suggestLines(row('n3', null, -1, 'Test Cafe'), []).length === 0);
  ok('I68: the booking itself is not used as evidence', suggestLines(row('a1', 'v.fuel', -45.9, 'Kartenzahlung Test Fuel Station'), [rows[0]]).length === 0);
  ok('I68: same input gives the same order', JSON.stringify(suggestLines(row('n1', null, -12.5, 'Test Cafe'), rows)) === JSON.stringify(suggestLines(row('n1', null, -12.5, 'Test Cafe'), [...rows].reverse())));
}
applyProfile(null); ok('lines() returns the catalog', lines().length === BASE_LINES.length);
done();
