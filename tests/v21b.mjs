// v21 step 2 checks: I81 (entries, cash wallet, waiting entries) and I83 (other banks' CSV, own-account transfers). Mock data only.
import { serve, launch, open, confirmDialog, PHONE, MAC } from './lib.mjs';
import { reporter } from './report.mjs';
import { rulesFile, bankCsv, BASIC, bank2Csv } from './mock.mjs';
const { ok, done } = reporter();
const { port } = await serve(); const b = await launch();
const csvFile = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
const base = (months) => months.map((m) => csvFile(`statement_test_${m}.csv`, bankCsv(m, BASIC(m)))).concat([{ name: 'rules_test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rulesFile())) }]);
const openWith = async (vp, files, scheme) => { const p = await open(b, port, vp, { load: false, scheme }); await p.setInputFiles('input[data-act=import]', files); await confirmDialog(p); await p.waitForSelector('#sheet:not([hidden]) .report', { timeout: 30000 }); await p.keyboard.press('Escape'); await p.waitForTimeout(400); return p; };
const sum = (p, m) => p.evaluate((mm) => { const s = window.__app.state.agg.summary.find((x) => x.month === mm); return s ? { spent: s.spent, kept: s.kept, netToSav: s.netToSav } : null; }, m);
const manual = (p) => p.evaluate(() => window.__app.state.tx.filter((t) => t.source === 'manual').map((t) => ({ id: t.id, amount: t.amount, vendor: t.vendor, w: t.manual })));
const lineOf = (p, pred) => p.evaluate((src) => { const f = new Function('t', `return ${src}`); return window.__app.state.agg.rows.filter(f).map((t) => t.line); }, pred);
const addEntry = async (p, { dir = 'out', way = 'cash', amount, date, vendor, atm = true }) => {
  await p.click('#fab'); await p.waitForSelector('.entryform');
  await p.selectOption('.entryform [name=dir]', dir); await p.selectOption('.entryform [name=way]', way);
  await p.fill('.entryform [name=amount]', amount); await p.fill('.entryform [name=date]', date); await p.fill('.entryform [name=vendor]', vendor);
  const box = await p.$('.entryform [name=atm]'); if (box && await box.isVisible() && !(await box.isDisabled())) await box.setChecked(atm, { force: true });
  await p.click('.entryform button[type=submit]');
};
const closeAll = async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(250); };

for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) for (const scheme of ['light', 'dark']) {
  const N = `${dn} ${scheme}`;
  // ---------- I81 cash
  const p = await openWith(vp, base(['2026-03']), scheme);
  const s0 = await sum(p, '2026-03');
  ok(`${N}: I81 before any choice the ATM withdrawal counts as spent`, s0 && Math.abs(s0.spent - 1645.9) < 0.005, JSON.stringify(s0));
  ok(`${N}: I81 the + button is there`, await p.isVisible('#fab'));
  await addEntry(p, { amount: '12,50', date: '2026-03-15', vendor: 'Test Cafe' });
  await p.waitForSelector('#dialog:not([hidden]) input[name=cash]');
  ok(`${N}: I81 the first cash entry asks how cash is handled`, /How should cash be handled/.test(await p.textContent('#dialog')));
  await p.click('#dialog [data-dlg=ok]'); await p.waitForTimeout(600);
  const st = await p.evaluate(() => window.__app.state.settings.cash);
  ok(`${N}: I81 the answer is remembered`, st === 'track', String(st));
  const s1 = await sum(p, '2026-03');
  ok(`${N}: I81 tracked cash: the ATM withdrawal leaves spending, the cash entry counts`, Math.abs(s1.spent - 1558.4) < 0.005, JSON.stringify(s1));
  ok(`${N}: I81 the ATM booking is on the wallet line`, (await lineOf(p, "t.type === 'Bargeldauszahlung'")).every((l) => l === 'cash.wallet'));
  // a second cash entry does not ask again
  await addEntry(p, { amount: '1,00', date: '2026-03-15', vendor: 'Test Cafe' }); await p.waitForTimeout(500);
  ok(`${N}: I81 it asks only once`, !(await p.isVisible('#dialog:not([hidden]) input[name=cash]')) && (await manual(p)).length === 2);
  const gone1 = (await manual(p)).find((m) => m.amount === -1);
  // wallet card
  await p.click(vp === PHONE ? '.tabbar [data-tab=insights]' : '.tabbar [data-tab=insights], .sidebar [data-tab=insights]'); await p.waitForTimeout(400);
  ok(`${N}: I81 wallet card on Insights`, /Cash wallet/.test(await p.textContent('#main')) && /87,50|86,50/.test(await p.textContent('.walletcard')), (await p.textContent('.walletcard') || '').slice(0, 160));
  // remove the 1,00 entry through the search sheet, as a person would
  await p.click('[data-act=search]'); await p.waitForSelector('#q'); await p.fill('#q', 'Test Cafe'); await p.waitForTimeout(300);
  await p.click(`[data-tx="${gone1.id}"]`); await p.waitForSelector('#sheet:not([hidden]) .txs');
  ok(`${N}: I81 an entry you typed in offers "Remove this entry"`, (await p.$$('#sheet [data-delentry]')).length === 1 && /entered by you/.test(await p.textContent('#sheet')));
  await p.click('#sheet [data-delentry]'); await confirmDialog(p); await p.waitForTimeout(500);
  ok(`${N}: I81 removing an entry closes its sheet`, !(await p.isVisible('#sheet:not([hidden]) .txs')));
  await closeAll(p);
  ok(`${N}: I81 a removed entry is marked, not deleted from storage`, (await manual(p)).length === 2 && (await p.evaluate(() => window.__app.state.agg.rows.filter((t) => t.source === 'manual').length)) === 1);
  await p.click(vp === PHONE ? '.tabbar [data-tab=insights]' : '.tabbar [data-tab=insights], .sidebar [data-tab=insights]'); await p.waitForTimeout(400);
  await p.click('[data-act=countrest]'); await p.waitForTimeout(600);
  const s2 = await sum(p, '2026-03');
  ok(`${N}: I81 "Count the rest as spent" brings the total back to what the ATM withdrawal said`, Math.abs(s2.spent - 1645.9) < 0.005, JSON.stringify(s2));
  ok(`${N}: I81 the wallet is empty afterwards`, !(await p.$('[data-act=countrest]')));
  // turning tracking off counts ATM withdrawals again and ignores ATM-paid cash entries (no double counting)
  await p.evaluate(async () => { const s = await import('./state.js'); await s.change('x', (st) => { st.cash = 'count'; }); });
  const s3 = await sum(p, '2026-03');
  ok(`${N}: I81 back to counting ATM withdrawals: nothing is counted twice`, Math.abs(s3.spent - 1645.9) < 0.005, JSON.stringify(s3));
  ok(`${N}: I81 no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();

  // ---------- I81 waiting entries
  const q = await openWith(vp, base(['2026-03']), scheme);
  await addEntry(q, { way: 'card', amount: '45,90', date: '2026-04-15', vendor: 'Test Supermarket' }); await q.waitForTimeout(600);
  let man = await manual(q);
  ok(`${N}: I81 a card entry waits for its statement`, man.length === 1 && man[0].w.waiting === true);
  ok(`${N}: I81 it is counted until then`, Math.abs((await sum(q, '2026-04')).spent - 45.9) < 0.005);
  await q.evaluate(async (csv) => { await window.__app.importFiles([new File([csv], 'statement_test_2026-04.csv', { type: 'text/csv' })]); }, bankCsv('2026-04', BASIC('2026-04')));
  await q.waitForSelector('#sheet:not([hidden]) .report', { timeout: 20000 }); await closeAll(q);
  const sp = await sum(q, '2026-04');
  ok(`${N}: I81 April spent is counted once after the merge`, sp && Math.abs(sp.spent - 1645.9) < 0.005, JSON.stringify(sp));
  ok(`${N}: I81 the entry is marked as merged`, await q.evaluate(() => { const g = window.__app.state.settings.manualGone; return Object.keys(g).length === 1; }));
  ok(`${N}: I81 no errors (waiting)`, q.errs.length === 0, q.errs.join('; '));
  await q.context().close();

  // ---------- I81 two bookings fit: you pick; and "Neither: keep separate"
  for (const choice of ['pick', 'none']) {
    const two = await openWith(vp, base(['2026-03']), scheme);
    await addEntry(two, { way: 'card', amount: '45,90', date: '2026-04-15', vendor: 'Test Supermarket' }); await two.waitForTimeout(500);
    const csv2 = bankCsv('2026-04', [...BASIC('2026-04'), ['15', 'Kartenzahlung', 'Test Fuel Station', 'Test Fuel Station', -45.9]]);
    const pr = two.evaluate(async (csv) => { await window.__app.importFiles([new File([csv], 'statement_test_2026-04.csv', { type: 'text/csv' })]); }, csv2);
    await two.waitForSelector('#dialog:not([hidden]) input[name=m]', { timeout: 20000 });
    ok(`${N}: I81 ${choice}: when two bookings fit, you are asked`, /Which booking is yours/.test(await two.textContent('#dialog')) && (await two.$$('#dialog input[name=m]')).length === 3);
    await two.check(choice === 'pick' ? '#dialog input[name=m][value="0"]' : '#dialog input[name=m][value=none]'); await two.click('#dialog [data-dlg=ok]');
    await pr; await two.waitForSelector('#sheet:not([hidden]) .report', { timeout: 20000 }); await closeAll(two);
    const g = await two.evaluate(() => Object.keys(window.__app.state.settings.manualGone).length);
    const sp2 = await sum(two, '2026-04');
    ok(`${N}: I81 ${choice}: ${choice === 'pick' ? 'merged with the booking you picked' : 'kept separate, still counted'}`, choice === 'pick' ? g === 1 && Math.abs(sp2.spent - 1691.8) < 0.005 : g === 0 && Math.abs(sp2.spent - (1691.8 + 45.9)) < 0.005, JSON.stringify({ g, sp2 }));
    if (choice === 'none') ok(`${N}: I81 "keep separate" is an answer in the settings and the entry is not changed`, await two.evaluate(() => { const m = window.__app.state.tx.find((t) => t.source === 'manual'); return Object.keys(window.__app.state.settings.manualKept).length === 1 && m.manual.waiting === true; }));
    await two.context().close();
  }

  // ---------- I83 other banks
  const a = await openWith(vp, [csvFile('statement_test_2026-04.csv', bankCsv('2026-04', [['15', 'Überweisung', 'Savings Test Account', 'Savings Test Account', -100], ['15', 'Kartenzahlung', 'Test Supermarket', 'Test Supermarket', -45.9]])), { name: 'rules_test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rulesFile())) }], scheme);
  const sav0 = await sum(a, '2026-04');
  ok(`${N}: I83 before the second bank the transfer counts as moved to savings`, sav0 && Math.abs(sav0.netToSav - 100) < 0.005, JSON.stringify(sav0));
  const csvB = bank2Csv([['2026-04-15', 'Test Supermarket', -45.9], ['2026-04-15', 'Alice Placeholder', 100]]);
  const imp = (name, text) => a.evaluate(async ([n, t]) => { await window.__app.importFiles([new File([t], n, { type: 'text/csv' })]); }, [name, text]);
  const pr1 = imp('statement_test_two_2026-04.csv', csvB);
  await a.waitForSelector('#dialog:not([hidden]) form[data-dlgform]', { timeout: 20000 });
  const guess = await a.evaluate(() => { const f = document.querySelector('#dialog form'); return { date: f.dateCol.value, amount: f.amountCol.value, fmt: f.dateFmt.value, dec: f.decimal.value, mode: f.amountMode.value, desc: [...f.querySelectorAll('input[name=desc]:checked')].map((x) => x.value) }; });
  ok(`${N}: I83 a new layout asks which column is which, with sensible guesses`, guess.date === '0' && guess.amount === '2' && guess.fmt === 'ymd' && guess.dec === 'dot' && guess.mode === 'one' && guess.desc.join() === '1', JSON.stringify(guess));
  ok(`${N}: I83 the column question shows the first rows of the file`, /First rows of the file/.test(await a.textContent('#dialog .pv')) && /Test Supermarket/.test(await a.textContent('#dialog .pv')));
  await a.fill('#dialog [name=bank]', 'Example Bank Two'); await a.click('#dialog [data-dlg=ok]');
  await pr1; await a.waitForSelector('#sheet:not([hidden]) .report', { timeout: 20000 });
  ok(`${N}: I83 the report names the bank`, /Example Bank Two/.test(await a.textContent('#sheet')) && /2 new/.test(await a.textContent('#sheet')), (await a.textContent('#sheet')).slice(0, 200)); await closeAll(a);
  const sav1 = await sum(a, '2026-04');
  ok(`${N}: I83 the two sides of the transfer between your own accounts cancel out`, sav1 && Math.abs(sav1.netToSav) < 0.005, JSON.stringify(sav1));
  await a.click(vp === PHONE ? '[data-act=search]' : '[data-act=search]'); await a.waitForSelector('#q'); await a.fill('#q', 'Savings Test Account'); await a.waitForTimeout(300);
  await a.click('[data-tx]'); await a.waitForSelector('#sheet:not([hidden]) .txs');
  ok(`${N}: I83 the tag names the other bank`, /between your own accounts \(Example Bank Two\)/.test(await a.textContent('#sheet')), (await a.textContent('#sheet')).replace(/\s+/g, ' ').slice(0, 200)); await closeAll(a); await closeAll(a);
  ok(`${N}: I83 both are on the offsetting line`, (await lineOf(a, "t.vendor === 'Alice Placeholder' || t.vendor === 'Savings Test Account'")).every((l) => l === 'off.other'));
  ok(`${N}: I83 the same amount at two banks is not taken for a duplicate`, await a.evaluate(() => window.__app.state.tx.filter((t) => t.amount === -45.9).length) === 2);
  ok(`${N}: I83 the columns are remembered`, await a.evaluate(() => Object.keys(window.__app.state.settings.csvMaps).length) === 1);
  // the same layout again: no question
  const pr2 = imp('statement_test_two_2026-05.csv', bank2Csv([['2026-05-01', 'Test Cafe', -12.5]]));
  await a.waitForSelector('#sheet:not([hidden]) .report', { timeout: 20000 });
  ok(`${N}: I83 the same layout is not asked again`, !(await a.isVisible('#dialog:not([hidden])'))); await pr2; await closeAll(a);
  // the same file twice: nothing new
  await imp('statement_test_two_2026-04.csv', csvB); await a.waitForSelector('#sheet:not([hidden]) .report', { timeout: 20000 });
  ok(`${N}: I83 importing the same file again adds nothing`, /0 new, 2 already stored/.test(await a.textContent('#sheet')), (await a.textContent('#sheet')).slice(0, 200)); await closeAll(a);
  // not a bank table
  await imp('statement_test_two_2026-06.csv', 'hello\nworld\n'); await a.waitForSelector('#sheet:not([hidden]) .report', { timeout: 20000 });
  ok(`${N}: I83 a file that is not a bank table is refused with a clear message`, /does not look like a bank CSV/.test(await a.textContent('#sheet'))); await closeAll(a);
  ok(`${N}: I83 no errors`, a.errs.length === 0, a.errs.join('; '));
  await a.context().close();
}
await b.close(); done();
