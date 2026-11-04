// v21.2 checks: B64, I60, I71-I74, I76, I84-I86. Mock data only (ledger values; the v21.2 rows of the ledger for the same-shop and trip tests).
import { serve, launch, open, confirmDialog, PHONE, MAC } from './lib.mjs';
import { reporter } from './report.mjs';
import { bankCsv, rulesFile, BASIC } from './mock.mjs';
import { aggregate, DEFAULT_SETTINGS, lines } from '../model.js';
import { sameShop, suggestLines, tripOffer, countryOf } from '../suggest.js';
const { ok, done } = reporter();

// ---------- unit: same shop, trip offer, suggestions, received from abroad
const R = (id, date, amount, vendor, text, line = null) => ({ id, date, amount, vendor, text, vkey: vendor.toUpperCase(), line });
const filler = Array.from({ length: 12 }, (_, i) => R(`f${i}`, '2026-03-01', -10 - i, `Shop F${i}`, `Shop F${i} Kartenzahlung Elsewhere ${i}`, 'v.drugstore'));
const secOf = (id) => (lines().find((l) => l.id === id) || {}).sec;
{
  const rows = [...filler, R('a1', '2026-03-01', -12.5, 'Alpha Corner', 'Alpha Corner Test Town Kartenzahlung', 'v.bakery'), R('a2', '2026-03-15', -45.9, 'Alpha Corner', 'Alpha Corner Test Town Kartenzahlung', 'v.bakery'), R('b1', '2026-03-15', -12.5, 'Alpha Kiosk', 'Alpha Kiosk Test Town Kartenzahlung')];
  const s = sameShop(rows[rows.length - 1], rows, secOf);
  ok('I84: a new name with the same rare word and place is offered the answered shop', s && s.vendor === 'Alpha Corner' && s.line === 'v.bakery', JSON.stringify(s));
  const other = [...rows.slice(0, -1), R('b2', '2026-03-15', -12.5, 'Alpha Kiosk', 'Alpha Kiosk Elsewhere Else Kartenzahlung')];
  ok('I84: no offer when only the name word matches and the place differs', sameShop(other[other.length - 1], other, secOf) === null);
  const mixed = rows.map((r) => (r.id === 'a2' ? { ...r, line: 'v.drugstore' } : r));
  ok('I84: no offer when the earlier answers for that shop disagree', sameShop(mixed[mixed.length - 1], mixed, secOf) === null);
  ok('I84: no offer for a shop that is itself answered', sameShop(rows[rows.length - 3], rows, secOf) === null);
}
{
  const T = (id, date, vendor, cc = 'ES') => R(id, date, -12.5, vendor, `${vendor}//Test City/${cc} ${date.slice(8)}-03-2026T10:00:00`);
  const trip = [T('t1', '2026-03-02', 'Shop A'), T('t2', '2026-03-03', 'Shop B'), T('t3', '2026-03-04', 'Alpha Kiosk')];
  const o = tripOffer(trip, trip, []);
  ok('I85: three card payments abroad on nearby days are offered as a trip', o && o.country === 'ES' && o.from === '2026-03-02' && o.to === '2026-03-04' && o.ids.length === 3, JSON.stringify(o));
  ok('I85: nothing is offered when a trip already covers the dates', tripOffer(trip, trip, [{ name: 'Test Trip', from: '2026-03-01', to: '2026-03-15' }]) === null);
  ok('I85: nothing is offered for two payments only', tripOffer(trip.slice(0, 2), trip, []) === null);
  ok('I85: payments in Germany are not a trip', tripOffer(trip.map((t) => ({ ...t, text: t.text.replace('/ES ', '/DE ') })), trip, []) === null);
  const online = [...trip, R('x', '2026-03-15', -12.5, 'Shop A', 'Shop A//Test City/ES 15-03-2026T10:00:00')];
  ok('I85: a shop that also books on other days (an online shop) is not part of a trip', tripOffer(trip, online, []) === null);
  ok('I85: the country comes from the card text', countryOf('X//Test City/ES 02-03-2026') === 'ES' && countryOf('X//Test City/DE 02-03-2026') === null && countryOf('plain text') === null);
}
{
  const ans = [R('r1', '2026-03-01', -10, 'Shop R1', 'aaaa', 'v.drugstore'), R('r2', '2026-03-01', -10, 'Shop R2', 'bbbb cccc', 'v.bakery'), ...filler.map((f) => ({ ...f, text: `${f.text} noise` }))];
  const tx = R('n1', '2026-03-15', -10, 'Shop N', 'aaaa'); const tx2 = R('n2', '2026-03-15', -10, 'Shop N', 'bbbb cccc');
  ok('I73: suggestions use only the shown booking when no group is given', suggestLines(tx, [...ans, tx], 1)[0] === 'v.drugstore');
  ok('I73: suggestions use every booking of the shop', suggestLines(tx, [...ans, tx, tx2], 1, [tx, tx2])[0] === 'v.bakery');
}
{
  const s = structuredClone(DEFAULT_SETTINGS); const base = [{ id: 'i1', date: '2026-03-01', amount: 2345.67, text: 'Lohn/Gehalt TEST SALARY', vendor: 'TEST EMPLOYER GMBH', vkey: 'TEST EMPLOYER GMBH', cardDate: null }];
  const rec = { id: 'i2', date: '2026-03-15', amount: 100, text: 'Example Remit Ltd', vendor: 'Example Remit Ltd', vkey: 'EXAMPLE REMIT LTD', cardDate: null };
  const a0 = aggregate(base, structuredClone(s)); const s2 = structuredClone(s); s2.txRules['i2'] = 'ab.received';
  const a1 = aggregate([...base, rec], s2);
  const m0 = a0.summary.find((x) => x.month === '2026-03'), m1 = a1.summary.find((x) => x.month === '2026-03');
  ok('I76: money received from abroad has its own line in its own section', lines().some((l) => l.id === 'ab.received' && l.sec === 'recv'));
  ok('I76: it does not change earned income or Saved, but it is in the balance change', m1.earned === m0.earned && m1.saved === m0.saved && Math.abs(m1.kept - m0.kept - 100) < 0.005, JSON.stringify([m0.saved, m1.saved, m0.kept, m1.kept]));
}

// ---------- browser
const { port } = await serve(); const b = await launch();
const csvFile = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
const rulesF = { name: 'rules_test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rulesFile())) };
const ROWS = [['01', 'Kartenzahlung', 'Alpha Corner', 'Alpha Corner//Test Town/DE 01-03-2026T10:00:00', -12.5], ['15', 'Kartenzahlung', 'Alpha Kiosk', 'Alpha Kiosk//Test Town/DE 15-03-2026T11:00:00', -12.5], ['15', 'Kartenzahlung', 'Shop A', 'Shop A//Test City/DE 15-03-2026T11:00:00', -45.9], ['01', 'Kartenzahlung', 'Shop B', 'Shop B//Test City/DE 01-03-2026T11:00:00', -12.5]];
const openWith = async (vp, rows, scheme) => {
  const p = await open(b, port, vp, { load: false, scheme });
  await p.setInputFiles('input[data-act=import]', [csvFile('statement_test_2026-03.csv', bankCsv('2026-03', [...BASIC('2026-03'), ...rows])), rulesF]);
  await confirmDialog(p); await p.waitForSelector('#sheet:not([hidden]) .report', { timeout: 30000 }); await p.keyboard.press('Escape'); await p.waitForTimeout(400); return p;
};
const goReview = async (p) => { await p.evaluate(() => { document.querySelector('[data-tab=review]').click(); }); await p.waitForTimeout(300); };
for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) for (const scheme of ['light', 'dark']) {
  const N = `${dn} ${scheme}`;
  // B64 + I84 + I73 + I74
  let p = await openWith(vp, ROWS, scheme);
  const cnt = await p.evaluate(() => ({ shops: window.__app.state.agg.reviewShops, n: window.__app.state.agg.review.length, badge: document.querySelector('#review-badge').textContent }));
  ok(`${N}: B64 the Review badge counts shops, not bookings`, cnt.shops === 4 && cnt.n === 4 && cnt.badge === '4', JSON.stringify(cnt));
  await p.evaluate(() => { const s = window.__app.state.settings; s.vendorRules['ALPHA CORNER'] = 'v.drugstore'; window.__app.refresh(); });
  await goReview(p);
  const same = await p.evaluate(() => [...document.querySelectorAll('#main button.same')].map((x) => x.textContent));
  ok(`${N}: I84 a new name that looks like an answered shop is offered "Same shop as"`, same.length === 1 && /Same shop as “Alpha Corner”/.test(same[0]), JSON.stringify(same));
  ok(`${N}: B64 the Review header names shops and bookings`, /3 shops to answer · 3 bookings/.test(await p.textContent('#main')), (await p.textContent('#main')).slice(0, 200));
  await p.click('#main button.same'); await p.waitForTimeout(500);
  const ans = await p.evaluate(() => window.__app.state.settings.vendorRules['ALPHA KIOSK']);
  ok(`${N}: I84 one tap answers for the new name`, ans === 'v.drugstore', String(ans));
  if (dn === 'Mac') {
    await p.keyboard.press('1'); await p.waitForTimeout(500);
    const nAns = await p.evaluate(() => Object.keys(window.__app.state.settings.vendorRules).length);
    ok(`${N}: I74 key 1 picks the first suggested line`, nAns >= 3, String(nAns));
  }
  ok(`${N}: no errors (B64, I84)`, p.errs.length === 0, p.errs.join('; ')); await p.context().close();

  // I86 select several
  p = await openWith(vp, ROWS, scheme); await goReview(p);
  await p.click('[data-act=revselect]'); await p.waitForSelector('[data-revtick]');
  ok(`${N}: I86 select mode shows a tick box for every shop`, (await p.$$('[data-revtick]')).length === 4);
  await p.check('[data-revtick="SHOP A"]'); await p.waitForTimeout(200); await p.check('[data-revtick="SHOP B"]'); await p.waitForSelector('form[data-act=revapply]');
  ok(`${N}: I86 the apply button names the shops and bookings`, /Apply to 2 shops \(2 bookings\)/.test(await p.textContent('form[data-act=revapply]')), (await p.textContent('form[data-act=revapply]')).slice(0, 200));
  ok(`${N}: I86 focus stays on the ticked box (no full re-render)`, await p.evaluate(() => document.activeElement && document.activeElement.dataset.revtick === 'SHOP B'));
  ok(`${N}: I86 apply form hidden again when nothing is ticked`, await (async () => { await p.uncheck('[data-revtick="SHOP A"]'); await p.uncheck('[data-revtick="SHOP B"]'); const hid = await p.evaluate(() => document.querySelector('form[data-act=revapply]').hidden && !document.querySelector('#rev-hint').hidden); await p.check('[data-revtick="SHOP A"]'); await p.check('[data-revtick="SHOP B"]'); return hid; })());
  ok(`${N}: tripoffer-no without an offer does nothing (no error)`, await (async () => { await p.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'tripoffer-no'; b.id = 'tmp-no'; document.body.appendChild(b); }); await p.click('#tmp-no'); await p.evaluate(() => document.getElementById('tmp-no').remove()); return p.errs.length === 0; })());
  await p.selectOption('form[data-act=revapply] select[name=line]', 'v.drugstore'); await p.click('form[data-act=revapply] button.primary'); await p.waitForTimeout(600);
  const vr = await p.evaluate(() => ({ a: window.__app.state.settings.vendorRules['SHOP A'], b: window.__app.state.settings.vendorRules['SHOP B'], left: window.__app.state.agg.reviewShops }));
  ok(`${N}: I86 both shops get the line, the others stay in Review`, vr.a === 'v.drugstore' && vr.b === 'v.drugstore' && vr.left === 2, JSON.stringify(vr));
  ok(`${N}: I86 select mode is left afterwards`, !(await p.$('[data-revtick]')));
  ok(`${N}: no errors (I86)`, p.errs.length === 0, p.errs.join('; ')); await p.context().close();

  // I85 trip offer
  const tripRows = [['02', 'Kartenzahlung', 'Shop A', 'Shop A//Test City/ES 02-03-2026T10:00:00', -12.5], ['03', 'Kartenzahlung', 'Alpha Corner', 'Alpha Corner//Test City/ES 03-03-2026T10:00:00', -45.9], ['04', 'Kartenzahlung', 'Alpha Kiosk', 'Alpha Kiosk//Test City/ES 04-03-2026T10:00:00', -12.5]];
  p = await openWith(vp, tripRows, scheme); await goReview(p);
  ok(`${N}: I85 three card payments abroad show the trip offer with dates filled in`, await p.isVisible('.tripoffer') && (await p.inputValue('.tripoffer [name=from]')) === '2026-03-02' && (await p.inputValue('.tripoffer [name=to]')) === '2026-03-04');
  await p.click('.tripoffer [data-act=tripoffer-no]'); await p.waitForTimeout(300);
  ok(`${N}: I85 "Not now" hides the offer`, !(await p.$('.tripoffer')));
  await p.close(); // a fresh page for the "create" path
  p = await openWith(vp, tripRows, scheme); await goReview(p);
  await p.fill('.tripoffer [name=name]', 'Test Trip'); await p.click('.tripoffer button.primary'); await p.waitForTimeout(700);
  const tr = await p.evaluate(() => ({ trips: window.__app.state.settings.trips.map((t) => t.name), review: window.__app.state.agg.review.length, lines: window.__app.state.agg.rows.filter((t) => t.line === 'trip:Test Trip').length }));
  ok(`${N}: I85 creating the trip puts the waiting payments on it`, tr.trips.join() === 'Test Trip' && tr.lines === 3 && tr.review === 0, JSON.stringify(tr));
  ok(`${N}: no errors (I85)`, p.errs.length === 0, p.errs.join('; ')); await p.context().close();

  // I60, I71, I72 with the standard mock data
  p = await open(b, port, vp, { scheme });
  await p.evaluate(() => { document.querySelector('[data-tab=data]').click(); }); await p.waitForTimeout(300);
  await p.click('[data-act=debuginfo]'); await p.waitForSelector('#dbg-text');
  const txt = await p.inputValue('#dbg-text');
  ok(`${N}: I60 the debug text has counts and numbered shops`, /Finances v21\.2/.test(txt) && /Shop 1 ·/.test(txt) && /Months: \d+/.test(txt), txt.slice(0, 200));
  ok(`${N}: I60 no shop name, date or exact amount is in the text`, !/Test Supermarket|Shop A|Shop B|TEST EMPLOYER|Test Cafe|2026|\d,\d\d/.test(txt.replace(/Finances v21\.2/, '')), txt.slice(0, 400));
  await p.click('#sheet [data-act=close]'); await p.waitForTimeout(300);
  await p.evaluate(() => { document.querySelector('[data-tab=insights]').click(); }); await p.waitForTimeout(400);
  const link = await p.$('.rec .linkname, .upc .linkname');
  ok(`${N}: I71 recurring and upcoming names are links to the line detail`, !!link);
  if (link) { await link.click(); await p.waitForSelector('#sheet:not([hidden]) .ld-feed'); ok(`${N}: I72 the line detail says what feeds the line`, /What feeds this line/.test(await p.textContent('#sheet'))); }
  ok(`${N}: no errors (I60, I71, I72)`, p.errs.length === 0, p.errs.join('; ')); await p.context().close();
}
await b.close(); done();
