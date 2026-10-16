// End-to-end checks in a real browser at phone and laptop size, light and dark. Mock data only (see mock.mjs).
import { serve, launch, open, confirmDialog, PHONE, MAC } from './lib.mjs';
import { reporter } from './report.mjs';
import { MONTHS, expected, legacySettings, answerOnlyFile, lineFile, oldRulesFile } from './mock.mjs';
import fs from 'fs';
const { ok, done } = reporter();
const { port } = await serve(); const b = await launch();
const EXP = expected();
const tab = async (p, t, vp) => { await p.click(t === 'settings' && vp === PHONE ? '[data-act=settings]' : `.tabbar [data-tab=${t}]`); await p.waitForTimeout(150); };
const section = async (p, s) => { await p.click('.tabbar [data-tab=months]'); await p.click(`[data-section=${s}]`); await p.waitForTimeout(150); };
const heads = (p) => p.$$eval('.grid thead th[data-m]', (t) => t.map((x) => x.dataset.m));
const totals = (p) => p.$$eval('.grid tfoot .tot, .grid tbody tr:not(.sub) .tot', (t) => t.map((x) => x.textContent.trim()));
const fits = (p) => p.evaluate(() => [...document.querySelectorAll('.grid td, .grid th')].filter((c) => c.scrollWidth > c.clientWidth + 1).length === 0);
const monthOf = (k) => `2026-${k}`;

for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) for (const scheme of ['light', 'dark']) {
  const p = await open(b, port, vp, { scheme }); const N = `${dn} ${scheme}`;
  const s = await p.evaluate(() => { const a = window.__app.state.agg; return { months: a.months, saved: a.summary.map((x) => x.saved), earned: a.summary.map((x) => x.earned), spent: a.summary.map((x) => x.spent), abroad: a.summary.map((x) => x.abroad), review: a.review.length, n: window.__app.state.tx.length }; });
  ok(`${N}: figures match the mock bookings`, JSON.stringify(s.months) === JSON.stringify(MONTHS) && JSON.stringify(s.saved) === JSON.stringify(EXP.map((x) => x.saved))
    && JSON.stringify(s.spent) === JSON.stringify(EXP.map((x) => x.spent)) && JSON.stringify(s.abroad) === JSON.stringify(EXP.map((x) => x.abroad)), JSON.stringify(s.saved));
  ok(`${N}: exactly one booking waits in Review`, s.review === 1);
  ok(`${N}: two months are overspent`, s.saved.filter((x) => x < 0).length === 2);
  for (const t of ['overview', 'months', 'insights', 'review', 'data', 'settings']) {
    await tab(p, t, vp);
    const r = await p.evaluate(() => ({ len: document.querySelector('#main').innerHTML.length, hscroll: document.documentElement.scrollWidth > innerWidth + 1 }));
    ok(`${N}: ${t} renders, no page side-scroll`, r.len > 400 && !r.hscroll);
  }
  // B52: skip months with nothing in them (on by default)
  await section(p, 'onetime');
  ok(`${N}: B52 One-time skips months without one-time items`, JSON.stringify(await heads(p)) === JSON.stringify(['2026-07', '2026-05']), JSON.stringify(await heads(p)));
  const oneTotalOn = await totals(p);
  await section(p, 'income');
  ok(`${N}: B52 Income skips the month with no income, transfer or savings booking`, !(await heads(p)).includes('2026-07') && (await heads(p)).includes('2026-06') && (await heads(p)).length === 5, JSON.stringify(await heads(p)));
  await section(p, 'fixed');
  ok(`${N}: B52 Fixed keeps every month (rent every month)`, (await heads(p)).length === 6);
  await section(p, 'variable');
  ok(`${N}: B52 Variable keeps every month`, (await heads(p)).length === 6);
  // switch off in the Data tab
  await tab(p, 'settings', vp);
  ok(`${N}: B52 switch sits in Settings (Data settings) and is on by default`, await p.isChecked('input[data-skipempty]'));
  await p.evaluate(() => document.querySelector('input[data-skipempty]').click()); await p.waitForTimeout(400);
  ok(`${N}: B52 switch is saved with the settings`, await p.evaluate(() => window.__app.state.settings.skipEmptyMonths === false));
  await section(p, 'onetime');
  ok(`${N}: B52 switched off: all six months show`, (await heads(p)).length === 6);
  ok(`${N}: B52 totals are the same with the switch on or off`, JSON.stringify(await totals(p)) === JSON.stringify(oneTotalOn));
  await tab(p, 'settings', vp); await p.evaluate(() => document.querySelector('input[data-skipempty]').click()); await p.waitForTimeout(400);
  // B53: wide amounts
  for (const sec of ['fixed', 'variable', 'onetime', 'income']) { await section(p, sec); ok(`${N}: B53 ${sec}: every amount fits its cell`, await fits(p)); }
  await section(p, 'income');
  const wide = await p.$$eval('.grid tfoot .tot', (t) => t.map((x) => x.textContent.trim()));
  ok(`${N}: B53 a five-digit total is on screen`, wide.some((x) => /^\d\d\.\d{3},\d\d$/.test(x)), wide.join(' | '));
  // The test browser's font is narrower than the phone's, so the rule is by character count: 10 px per character plus padding.
  const colOk = await p.evaluate(() => {
    const chars = Math.max(...[...document.querySelectorAll('.grid td, .grid tfoot th')].map((td) => (td.textContent.trim().match(/^-?\d[\d.]*,\d\d/) || [''])[0].length));
    const w = Math.min(...[...document.querySelectorAll('.grid thead th')].slice(1).map((c) => c.getBoundingClientRect().width)); // header cells: WebKit gives <col> no size
    return { chars, w, ok: w >= chars * 10 + 20 };
  });
  ok(`${N}: B53 amount columns are wide enough for the widest amount`, colOk.ok && colOk.chars >= 9, JSON.stringify(colOk));
  ok(`${N}: no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}
// switch survives a reload
{
  const p = await open(b, port, PHONE);
  await tab(p, 'settings', PHONE); await p.evaluate(() => document.querySelector('input[data-skipempty]').click()); await p.waitForTimeout(500);
  await p.reload(); await p.waitForTimeout(800); await tab(p, 'settings', PHONE);
  ok('B52 switch setting survives a reload', !(await p.isChecked('input[data-skipempty]')));
  await p.context().close();
}
// each theme renders every section without errors, phone and laptop
for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) {
  const p = await open(b, port, vp, { scheme: 'dark' });
  for (const pal of ['electric', 'lagoon', 'classic']) {
    await p.evaluate((x) => document.documentElement.setAttribute('data-palette', x), pal);
    for (const sec of ['fixed', 'income']) { await section(p, sec); ok(`${dn} ${pal}: ${sec} fits`, await fits(p)); }
  }
  ok(`${dn} themes: no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}
// the one-time conversion on restore: backup first, then converted
{
  const p = await open(b, port, PHONE);
  await p.evaluate(async (legacy) => {
    const tx = window.__app.state.tx; const payload = { app: 'finance-insights', version: 2, tx, statements: window.__app.state.statements, settings: legacy };
    const file = new File([JSON.stringify(payload)], 'backup_test.json', { type: 'application/json' });
    window.__pending = window.__app.importFiles([file]);
    return file.name;
  }, legacySettings());
  await confirmDialog(p); await p.evaluate(() => window.__pending); await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const st = window.__app.state;
    return { rule: st.settings.profile.rules[0].line, vendor: st.settings.vendorRules['EXAMPLE REMIT LTD'], sec: st.settings.profile.lines.find((l) => l.id === 'c.test_line').sec, backup: st.settingsBackup && st.settingsBackup.settings.vendorRules['EXAMPLE REMIT LTD'] };
  });
  ok('conversion on restore: rules, answers and lines are converted', r.rule === 'ab.transfer' && r.vendor === 'ab.transfer' && r.sec === 'abroad', JSON.stringify(r));
  ok('conversion on restore: the old settings were saved first', r.backup === 'ind.remit', JSON.stringify(r));
  ok('conversion on restore: no errors', p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}
// the CSV balance line with a leading "+" is read, and Excel export works
{
  const p = await open(b, port, MAC);
  const cps = await p.evaluate(() => window.__app.state.statements.filter((x) => x.kind === 'checkpoint').map((x) => x.close));
  ok('CSV balance with a leading "+" is read', cps.length > 0 && cps.every((c) => c === 2345.67), JSON.stringify(cps));
  await tab(p, 'data', MAC);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=excel]')]); await dl.saveAs('/tmp/finances-test.xlsx');
  ok('Excel workbook is exported', fs.statSync('/tmp/finances-test.xlsx').size > 10000);
  ok('Excel/CSV: no errors', p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}
// B55: an answer to a line from a rules file that is not loaded yet
for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) {
  const p = await open(b, port, vp);
  const add = async (name, obj) => { await tab(p, 'data', vp); await p.setInputFiles('input[data-act=import]', [{ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) }]); await confirmDialog(p); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(300); };
  await add('rules_test.json', oldRulesFile());
  await tab(p, 'review', vp);
  ok(`${dn}: B55 a rules file from before v19.1 asks for the updated one`, /before v19\.1/.test(await p.textContent('#main')));
  // B56: wording for one and for several answers whose line is missing (no matching booking)
  await add('rules_test.json', { ...oldRulesFile(), catalog: 2, vendorAnswers: { 'NO SUCH VENDOR': 'c.test_line' } });
  await tab(p, 'review', vp);
  ok(`${dn}: B56 one answer: "belongs"`, /1 answer or rule belongs to lines/.test(await p.textContent('#main')));
  await add('rules_test.json', { ...oldRulesFile(), catalog: 2, vendorAnswers: { 'NO SUCH VENDOR': 'c.test_line', 'NO OTHER VENDOR': 'c.test_line' } });
  await tab(p, 'review', vp);
  ok(`${dn}: B56 two answers: "belong"`, /2 answers or rules belong to lines/.test(await p.textContent('#main')));
  await add('rules_test.json', answerOnlyFile());
  const s1 = await p.evaluate(() => ({ unk: window.__app.state.agg.unknownLine.length, rev: window.__app.state.agg.review.length }));
  ok(`${dn}: B55 the booking waits apart, not as a new vendor`, s1.unk === 1 && s1.rev === 0, JSON.stringify(s1));
  await tab(p, 'overview', vp);
  ok(`${dn}: B55 Overview says to load the rules file`, /rules file/.test(await p.textContent('#main')));
  await tab(p, 'review', vp);
  ok(`${dn}: B55 Review says to load the rules file`, /rules file/.test(await p.textContent('#main')) && !/Unknown vendors/.test(await p.textContent('#main')));
  // I64: tapping the notice opens the file picker; choosing the rules file loads it right there
  await tab(p, 'review', vp);
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#main [data-act=pickrules]')]);
  await chooser.setFiles([{ name: 'rules_test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(lineFile())) }]); await confirmDialog(p);
  await p.waitForSelector('#sheet:not([hidden]) .report', { timeout: 10000 }); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok(`${dn}: I64 the notice opens the file picker and the file loads`, await p.evaluate(() => window.__app.state.agg.unknownLine.length === 0));
  await add('rules_test.json', answerOnlyFile());
  await add('rules_test.json', lineFile());
  const s2 = await p.evaluate(() => ({ unk: window.__app.state.agg.unknownLine.length, line: window.__app.state.agg.rows.find((t) => t.vendor === 'Shop A').line }));
  ok(`${dn}: B55 after loading the rules file the booking is back on its line`, s2.unk === 0 && s2.line === 'c.test_line', JSON.stringify(s2));
  await tab(p, 'overview', vp);
  ok(`${dn}: B55 notice is gone`, !/rules file/.test(await p.textContent('#main')));
  ok(`${dn}: B55 no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}
await b.close(); done();
