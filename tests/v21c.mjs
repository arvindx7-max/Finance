// v21.1 review fixes: sync of entries/layouts/answers, own-account pairing, split-column CSV, mapping preview. Mock data only.
import { serve, launch, open, PHONE, MAC } from './lib.mjs';
import { reporter } from './report.mjs';
import { pairOwnTransfers } from '../model.js';
const { ok, done } = reporter();
const { port } = await serve(); const b = await launch();
const tx = (o) => ({ vendor: 'Test Cafe', vkey: 'test cafe', amount: -12.5, date: '2026-03-15', bank: '', ...o });

// ---- pairing: only bookings not already sorted into spending or income
{
  const rows = [
    tx({ id: 'a', amount: -100, vkey: 'x', bank: '', line: undefined }), tx({ id: 'b', amount: 100, vkey: 'y', bank: 'Example Bank Two', line: undefined }),
    tx({ id: 'c', amount: -45.9, vkey: 'x', bank: '', line: 'v.restaurants' }), tx({ id: 'd', amount: 45.9, vkey: 'y', bank: 'Example Bank Two', line: undefined }),
  ];
  const n = pairOwnTransfers(rows, { txRules: {} });
  ok('unsorted opposite bookings at two banks are paired', n === 1 && rows[0].line === 'off.other' && rows[1].line === 'off.other');
  ok('a booking already sorted into spending is never paired away', rows[2].line === 'v.restaurants' && !rows[3].ownPair);
}

for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) {
  const N = dn; const p = await open(b, port, vp, { load: false });
  const r = await p.evaluate(async ({ T }) => {
    const S = await import('./sync.js'); const B = await import('./banks.js');
    const out = {};
    // 1: entries you typed in are told apart by id; the bank is part of the key
    const e1 = { ...T, id: 'm|2026-03-15|1250|aaa', source: 'manual' }, e2 = { ...T, id: 'm|2026-03-15|1250|bbb', source: 'manual' };
    out.m1 = S.mergeTx([e1], [e1, e2]).length;
    const s1 = { ...T, id: 's1', amount: -45.9, vkey: 'shop a' }, s2 = { ...T, id: 's2', amount: -45.9, vkey: 'shop a', bank: 'Example Bank Two' };
    out.m2 = S.mergeTx([s1], [s2]).length;
    out.m3 = S.mergeTx([s1], [{ ...s1, id: 'other' }]).length;
    // 3 and 4: answers and layouts merge per key
    const L = { stamps: { 'c:lay1': 5, 'k:m|x': 5 }, csvMaps: { lay1: { bank: 'Example Bank Two' } }, manualKept: { 'm|x': true } };
    const R = { stamps: { 'c:lay2': 9 }, csvMaps: { lay2: { bank: 'Example Bank Three' } }, manualKept: {} };
    const M = S.mergeSettings(L, R);
    out.maps = Object.keys(M.csvMaps).sort().join(','); out.kept = !!M.manualKept['m|x'];
    // 7: split columns, a row with neither amount is skipped
    const map = { bank: 'Example Bank Two', dateCol: 0, dateFmt: 'ymd', amountMode: 'split', debitCol: 1, creditCol: 2, decimal: 'dot', desc: [3] };
    const table = { headers: ['Date', 'Out', 'In', 'Description'], rows: [['2026-03-01', '12.50', '', 'Test Cafe'], ['2026-03-15', '', '100.00', 'Test Salary'], ['2026-03-15', '', '', 'Test line']] };
    const pw = B.parseWithMap(table, map); out.rows = pw.rows.map((x) => x.amount).join(','); out.skipped = pw.skipped;
    return out;
  }, { T: tx({}) });
  ok(`${N}: two identical typed-in entries both survive a sync merge`, r.m1 === 2, JSON.stringify(r));
  ok(`${N}: the same booking at two banks is not taken for one`, r.m2 === 2, JSON.stringify(r));
  ok(`${N}: the same booking with another id is still taken for one`, r.m3 === 1, JSON.stringify(r));
  ok(`${N}: column layouts of two devices both survive`, r.maps === 'lay1,lay2', r.maps);
  ok(`${N}: "kept separate" travels in the settings`, r.kept === true);
  ok(`${N}: a split-column row with neither amount is skipped, not read as 0,00`, r.rows === '-12.5,100' && r.skipped === 1, JSON.stringify(r));
  ok(`${N}: no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}
await b.close(); done();
