// Fabricated test data. Everything here comes from the mock data ledger in CLAUDE.md: only invented names,
// vendors and amounts, and only the 1st and 15th of a month.
export const MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
const IBAN = 'DE00 0000 0000 0000 0000 00';
const HEAD = 'Buchungstag;Wert;Umsatzart;Begünstigter / Auftraggeber;Verwendungszweck;IBAN;BIC;Kundenreferenz;Mandatsreferenz;Gläubiger ID;Fremde Gebühren;Betrag;Abweichender Empfänger;Anzahl der Aufträge;Anzahl der Schecks;Soll;Haben;Währung';
const de = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const row = (date, type, cp, purpose, amount) => ['', '', type, cp, purpose, IBAN, '', '', '', '', '', de(amount), '', '', '', '', '', 'EUR'].map((x, i) => (i === 0 || i === 1 ? date : x)).join(';');
// month (YYYY-MM) -> bookings [day, type, counterparty, purpose, amount]
export function bookings(m) {
  const i = MONTHS.indexOf(m); const b = [];
  const salary = !['2026-06', '2026-07'].includes(m);          // overspent months: no salary
  if (salary) b.push(['01', 'Lohn/Gehalt', 'TEST EMPLOYER GMBH', 'TEST SALARY', 2345.67]);
  if (m === '2026-05') b.push(['01', 'Lohn/Gehalt', 'TEST EMPLOYER GMBH', 'TEST SALARY', 12345.67]); // large total
  b.push(['01', 'Dauerauftrag', 'Shop B', 'RENT', -1500]);
  b.push(['15', 'Kartenzahlung', 'Test Supermarket', 'Test Supermarket', -45.9]);
  b.push(['15', 'Kartenzahlung', 'Test Fuel Station', 'Test Fuel Station', -45.9]);
  b.push(['15', 'Kartenzahlung', 'Test Cafe', 'Test Cafe', -12.5]);
  if (m === '2026-05' || m === '2026-07') b.push(['15', 'Kartenzahlung', 'Test Online Store', 'Test Online Store', -45.9]); // one-time items only here
  if (m === '2026-04') b.push(['15', 'Überweisung', 'Savings Test Account', 'Savings Test Account', -100]);   // moved to savings
  if (m === '2026-06') b.push(['15', 'Überweisung', 'Savings Test Account', 'Savings Test Account', 1500]);   // top-up from savings
  if (m === '2026-03' || m === '2026-04') b.push(['15', 'Überweisung', 'Example Remit Ltd', 'Example Remit Ltd', -100]); // transfer abroad
  if (m === '2026-08') b.push(['15', 'Kartenzahlung', 'Shop A', 'Shop A', -12.5]);                              // lands in Review
  return b;
}
export function csv(m, { plusBalance = true } = {}) {
  const lines = ['Umsatzliste;;;', `Konto;${IBAN};;`, '', HEAD];
  for (const [d, type, cp, purpose, amount] of bookings(m)) lines.push(row(`${d}.${m.slice(5)}.${m.slice(0, 4)}`, type, cp, purpose, amount));
  if (plusBalance) lines.push(`Kontostand;15.${m.slice(5)}.${m.slice(0, 4)};${'+'}2.345,67;EUR`);
  return lines.join('\n') + '\n';
}
export const rulesFile = () => ({
  app: 'finance-insights-rules', version: 1, catalog: 2, lines: [], notes: {}, sheetNames: {}, trips: [], startMonth: null,
  rules: [
    { line: 'v.otherGrocery', any: ['TEST SUPERMARKET'] },
    { line: 'v.fuel', any: ['TEST FUEL STATION'] },
    { line: 'ot.other', any: ['TEST ONLINE STORE'], first: true },
    { line: 'ab.transfer', any: ['EXAMPLE REMIT LTD'], sign: '-' },
    { line: 'sv.out', any: ['SAVINGS TEST ACCOUNT'], sign: '-' },
    { line: 'sv.in', any: ['SAVINGS TEST ACCOUNT'], sign: '+' },
  ],
});
// Settings in the format of earlier versions (a section that no longer exists, an old line id), for the one-time conversion test.
export const legacySettings = () => ({
  vendorRules: { 'EXAMPLE REMIT LTD': 'ind.remit' }, txRules: { user_test_123: 'tr.remit' },
  profile: { app: 'finance-insights-rules', version: 1, notes: {}, sheetNames: {}, trips: [], startMonth: null,
    rules: [{ line: 'ind.remit', any: ['EXAMPLE REMIT LTD'] }],
    lines: [{ id: 'c.test_line', sec: 'retired_section', label: 'Test line', group: '' }] },
});
// Expected monthly figures, computed independently from the bookings above.
export function expected() {
  return MONTHS.map((m) => {
    let earned = 0, spent = 0, abroad = 0;
    for (const [, type, cp, , a] of bookings(m)) {
      if (type === 'Lohn/Gehalt') earned += a;
      else if (cp === 'Example Remit Ltd') abroad += -a;
      else if (cp === 'Savings Test Account' || cp === 'Shop A') continue; // Shop A waits in Review: not counted
      else spent += -a;
    }
    const r = (x) => Math.round(x * 100) / 100;
    return { month: m, earned: r(earned), spent: r(spent), abroad: r(abroad), saved: r(earned - spent - abroad) };
  });
}
// B55: an answer that points to a line only a rules file defines, and the rules file that defines it.
export const answerOnlyFile = () => ({ ...rulesFile(), vendorAnswers: { 'SHOP A': 'c.test_line' } });
export const lineFile = () => ({ ...rulesFile(), lines: [{ id: 'c.test_line', sec: 'variable', label: 'Test line', group: 'Subscriptions & other' }], vendorAnswers: { 'SHOP A': 'c.test_line' } });
// A rules file from before v19.1 (no catalog marker).
export const oldRulesFile = () => { const r = rulesFile(); delete r.catalog; return r; };
