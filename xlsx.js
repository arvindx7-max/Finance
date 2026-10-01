// Minimal styled XLSX writer (stored zip, inline strings, formulas with cached values).
import { lineMeta, lineLabel, lineNote, sheetName, monthLabel, dateSummary, SECTIONS, deDate } from './model.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const colL = (n) => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const r2 = (v) => Math.round(v * 100) / 100;

// style ids (see styles())
const S = { hdr: 1, sub: 2, bar: 3, barGreen: 4, text: 5, num: 6, dates: 7, totLbl: 8, totNum: 9, note: 10, date: 11, bold: 12, boldNum: 13, pct: 14, legend: 15 };

class Sheet {
  constructor(name) { this.name = name; this.rows = {}; this.merges = []; this.cols = []; this.freeze = null; }
  set(c, r, v, s = S.text, f = null) { (this.rows[r] ||= {})[c] = { v, s, f }; }
  merge(c1, r1, c2, r2_) { this.merges.push(`${colL(c1)}${r1}:${colL(c2)}${r2_}`); }
  xml() {
    const rows = Object.keys(this.rows).map(Number).sort((a, b) => a - b).map((r) => {
      const cells = Object.keys(this.rows[r]).map(Number).sort((a, b) => a - b).map((c) => {
        const { v, s, f } = this.rows[r][c]; const ref = `${colL(c)}${r}`;
        if (f) return `<c r="${ref}" s="${s}"><f>${esc(f)}</f>${typeof v === 'number' ? `<v>${v}</v>` : ''}</c>`;
        if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${s}"/>`;
        if (typeof v === 'number') return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
        return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('');
      return `<row r="${r}">${cells}</row>`;
    }).join('');
    const pane = this.freeze ? `<pane xSplit="${this.freeze[0]}" ySplit="${this.freeze[1]}" topLeftCell="${colL(this.freeze[0])}${this.freeze[1] + 1}" activePane="bottomRight" state="frozen"/>` : '';
    const cols = this.cols.length ? `<cols>${this.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const merges = this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${merges}</worksheet>`;
  }
}

function styles() {
  const font = (sz, b, color, i) => `<font>${b ? '<b/>' : ''}${i ? '<i/>' : ''}<sz val="${sz}"/><color rgb="${color}"/><name val="Arial"/><family val="2"/></font>`;
  const fonts = [font(11, 0, 'FF000000'), font(11, 1, 'FFFFFFFF'), font(9, 1, 'FFFFFFFF'), font(10, 1, 'FFFFFFFF'), font(11, 1, 'FF000000'), font(9, 0, 'FF595959', 1), font(10, 0, 'FF000000')];
  const fill = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', fill('FF1F3864'), fill('FF4472C4'), fill('FF8496B0'), fill('FF2E7D32'), fill('FFD9E1F2')];
  const xf = (font_, fill_, numFmt, align = '') => `<xf numFmtId="${numFmt}" fontId="${font_}" fillId="${fill_}" borderId="0" xfId="0"${numFmt ? ' applyNumberFormat="1"' : ''}${font_ ? ' applyFont="1"' : ''}${fill_ ? ' applyFill="1"' : ''}${align ? ` applyAlignment="1"><alignment ${align}/></xf>` : '/>'}`;
  const xfs = [
    xf(0, 0, 0), // 0 default
    xf(1, 2, 0, 'horizontal="center" vertical="center" wrapText="1"'), // 1 hdr
    xf(2, 3, 0, 'horizontal="center"'), // 2 sub
    xf(3, 4, 0), // 3 bar
    xf(3, 5, 0), // 4 bar green
    xf(0, 0, 0), // 5 text
    xf(0, 0, 164, 'horizontal="right"'), // 6 num
    xf(6, 0, 0, 'horizontal="left"'), // 7 dates
    xf(4, 6, 0), // 8 total label
    xf(4, 6, 164, 'horizontal="right"'), // 9 total num
    xf(5, 0, 0, 'wrapText="1" vertical="top"'), // 10 note
    xf(0, 0, 165, 'horizontal="left"'), // 11 date value
    xf(4, 0, 0), // 12 bold
    xf(4, 0, 164, 'horizontal="right"'), // 13 bold num
    xf(4, 6, 166, 'horizontal="right"'), // 14 pct
    xf(5, 0, 0), // 15 legend
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00;-#,##0.00;&quot;-&quot;"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

// Header rows 1-2 for a month-pair sheet. first = column index of first month's Amount col.
function monthHeader(sh, title, months, first, extraLead = []) {
  sh.set(0, 1, title, S.hdr); sh.set(0, 2, '', S.hdr); sh.merge(0, 1, 0, 2);
  extraLead.forEach((t, i) => { sh.set(i + 1, 1, t, S.hdr); sh.set(i + 1, 2, '', S.hdr); sh.merge(i + 1, 1, i + 1, 2); });
  months.forEach((m, i) => {
    const c = first + i * 2;
    sh.set(c, 1, monthLabel(m), S.hdr); sh.set(c + 1, 1, '', S.hdr); sh.merge(c, 1, c + 1, 1);
    sh.set(c, 2, 'Amount €', S.sub); sh.set(c + 1, 2, 'Date', S.sub);
  });
  const tot = first + months.length * 2;
  const span = months.length ? `${monthLabel(months[0], true)}–${monthLabel(months[months.length - 1], true)}` : '';
  sh.set(tot, 1, `Total (${span}) €`, S.hdr); sh.set(tot, 2, '', S.hdr); sh.merge(tot, 1, tot, 2);
  sh.set(tot + 1, 1, 'Notes', S.hdr); sh.set(tot + 1, 2, '', S.hdr); sh.merge(tot + 1, 1, tot + 1, 2);
  sh.freeze = [first, 2];
  sh.cols = [40, ...extraLead.map(() => 12), ...months.flatMap(() => [11, 24]), 14, 48];
  return tot;
}



// Writes one data row for a line; returns nothing. sign: -1 for expenses (shown positive).
function lineRow(sh, r, label, lineId, months, first, agg, sign, note = '') {
  sh.set(0, r, label, S.text);
  const refs = [];
  let total = 0;
  months.forEach((m, i) => {
    const c = first + i * 2; const cell = agg.cell[`${lineId}|${m}`];
    if (cell) { const v = r2(sign * cell.amt); total += v; sh.set(c, r, v, S.num); sh.set(c + 1, r, dateSummary(cell.dates), S.dates); }
    else { sh.set(c, r, null, S.num); sh.set(c + 1, r, '', S.dates); }
    refs.push(`${colL(c)}${r}`);
  });
  const tot = first + months.length * 2;
  sh.set(tot, r, r2(total), S.num, refs.length ? `SUM(${refs.join(',')})` : null);
  sh.set(tot + 1, r, note || lineNote(lineId), S.note);
}
function sumRow(sh, r, label, months, first, ranges, values, style = [S.totLbl, S.totNum]) {
  sh.set(0, r, label, style[0]);
  const refs = [];
  months.forEach((m, i) => {
    const c = first + i * 2;
    const f = ranges.map((rg) => (typeof rg === 'string' ? rg.replace(/@/g, colL(c)) : `${colL(c)}${rg}`)).join(',');
    sh.set(c, r, r2(values[i]), style[1], `SUM(${f})`);
    sh.set(c + 1, r, '', style[0]);
    refs.push(`${colL(c)}${r}`);
  });
  const tot = first + months.length * 2;
  sh.set(tot, r, r2(values.reduce((a, b) => a + b, 0)), style[1], refs.length ? `SUM(${refs.join(',')})` : null);
  sh.set(tot + 1, r, '', style[0]);
}
const secLines = (agg, sec) => agg.order.filter((l) => l.sec === sec);
const monthVals = (agg, key) => agg.summary.map((s) => s[key]);

export function buildWorkbook(agg, recon, settings) {
  const months = agg.months;
  const sheets = [];

  // ---- Fixed / recurring (sheet name kept as in the original workbook) ----
  const fixedName = sheetName('fixed', 'Fixed');
  const fixedSh = new Sheet(fixedName); sheets.push(fixedSh);
  const mFirst = 2;
  monthHeader(fixedSh, 'Description', months, mFirst, ['Latest €']);
  let r = 3;
  const fixed = secLines(agg, 'fixed');
  for (const l of fixed) {
    const last = [...months].reverse().map((m) => agg.cell[`${l.id}|${m}`]).find(Boolean);
    lineRow(fixedSh, r, l.label, l.id, months, mFirst, agg, -1);
    fixedSh.set(1, r, last ? r2(-last.txs[last.txs.length - 1].amount) : null, S.num);
    r++;
  }
  const fixedTotalRow = r;
  sumRow(fixedSh, r, 'TOTAL fixed / recurring', months, mFirst, [`@3:@${r - 1}`], monthVals(agg, 'fixed'));
  fixedSh.set(1, r, '', S.totLbl);
  r += 2;
  fixedSh.set(0, r++, 'Where several charges fell in one month, the Date column lists them and the Amount is their sum.', S.legend);
  fixedSh.set(0, r++, 'More than 3 dates are condensed to "first .. last (Nx)".', S.legend);

  // ---- Variable ----
  const vs = new Sheet('Variable Expenses'); sheets.push(vs);
  const vFirst = 1;
  const vTot = monthHeader(vs, 'Category / Vendor', months, vFirst);
  r = 3; let group = null;
  for (const l of secLines(agg, 'variable')) {
    if (l.group !== group) {
      group = l.group; vs.set(0, r, group.toUpperCase(), S.bar);
      for (let c = 1; c <= vTot + 1; c++) vs.set(c, r, '', S.bar);
      r++;
    }
    const tripNote = l.id.startsWith('trip:') ? (() => { const t = settings.trips.find((x) => `trip:${x.name}` === l.id); return t ? `Restaurant charges dated ${deDate(t.from)}–${deDate(t.to)}, kept apart from regular spend.` : ''; })() : '';
    lineRow(vs, r, l.label, l.id, months, vFirst, agg, -1, tripNote); r++;
  }
  const varTotalRow = r;
  sumRow(vs, r, 'TOTAL VARIABLE SPEND', months, vFirst, [`@3:@${r - 1}`], monthVals(agg, 'variable'));
  r += 2;
  vs.set(0, r++, `Excludes items on the ${fixedName} (fixed / recurring) and One-Time sheets.`, S.legend);
  vs.set(0, r++, 'Refunds are netted against the vendor they came from; they are not income.', S.legend);

  // ---- One-time ----
  const os = new Sheet('One-Time'); sheets.push(os);
  monthHeader(os, 'Description', months, vFirst);
  r = 3;
  for (const l of secLines(agg, 'onetime')) { lineRow(os, r, l.label, l.id, months, vFirst, agg, -1); r++; }
  const otTotalRow = r;
  sumRow(os, r, 'TOTAL ONE-TIME', months, vFirst, r > 3 ? [`@3:@${r - 1}`] : ['@3:@3'], monthVals(agg, 'onetime'));
  r += 2;
  os.set(0, r++, 'Kept out of regular monthly averages, but counted in savings.', S.legend);
  const offs = agg.rows.filter((t) => t.line && t.line.startsWith('off.'));
  if (offs.length) os.set(0, r++, `Offsetting pairs not tracked (they cancel out): ${[...new Set(offs.map((t) => lineLabel(t.line)))].join('; ')}.`, S.legend);

  // ---- Income & transfers ----
  const is = new Sheet('Income & Transfers'); sheets.push(is);
  const iTot = monthHeader(is, 'Description', months, vFirst);
  r = 3;
  const bar = (label) => { is.set(0, r, label, S.barGreen); for (let c = 1; c <= iTot + 1; c++) is.set(c, r, '', S.barGreen); r++; };
  const subtot = {};
  const block = (title, ids, subLabel, key) => {
    bar(title);
    const start = r;
    for (const id of ids) { if (!agg.order.find((l) => l.id === id)) continue; lineRow(is, r, lineMeta(id).label, id, months, vFirst, agg, key === 'transfer' ? -1 : 1); r++; }
    const vals = months.map((m) => r2(ids.reduce((s, id) => s + (agg.cell[`${id}|${m}`]?.amt || 0), 0) * (key === 'transfer' ? -1 : 1)));
    if (r === start) { is.set(0, r, '(none)', S.legend); r++; }
    subtot[key] = r;
    sumRow(is, r, subLabel, months, vFirst, [`@${start}:@${r - 1}`], vals); r += 2;
    return vals;
  };
  // Income sections follow the line groups (Salary, Other income, Kindergeld), then outbound transfers.
  const incomeLines = agg.order.filter((l) => l.sec === 'income');
  const groups = [...new Set(incomeLines.map((l) => l.group))];
  const incomeSubRows = []; const income = months.map(() => 0);
  groups.forEach((g, gi) => {
    const ids = incomeLines.filter((l) => l.group === g).map((l) => l.id);
    const vals = block(g.toUpperCase(), ids, `Subtotal — ${g.replace(/ \(.*\)$/, '')}`, `in${gi}`);
    incomeSubRows.push(subtot[`in${gi}`]); vals.forEach((v, i) => { income[i] = r2(income[i] + v); });
  });
  const trIds = agg.order.filter((l) => l.sec === 'transfer').map((l) => l.id);
  const trGroup = (agg.order.find((l) => l.sec === 'transfer') || { group: 'Outbound transfers' }).group || 'Outbound transfers';
  block(trGroup.toUpperCase(), trIds, 'Subtotal — Outbound transfers', 'transfer');
  bar('MONTHLY SAVINGS SUMMARY');
  const rowIncome = r;
  const xref = (sheet, row, offset) => (c) => `'${sheet}'!${colL(c + offset)}${row}`;
  const put = (label, vals, fn, style = [S.bold, S.boldNum]) => {
    is.set(0, r, label, style[0]);
    months.forEach((m, i) => { const c = vFirst + i * 2; is.set(c, r, r2(vals[i]), style[1], fn(c)); is.set(c + 1, r, '', style[0]); });
    const t = vFirst + months.length * 2;
    const refs = months.map((_, i) => `${colL(vFirst + i * 2)}${r}`);
    is.set(t, r, r2(vals.reduce((a, b) => a + b, 0)), style[1], refs.length ? `SUM(${refs.join(',')})` : null);
    r++;
  };
  put('Total income', income, (c) => (incomeSubRows.length ? incomeSubRows.map((rr) => `${colL(c)}${rr}`).join('+') : '0'));
  const rowFixed = r; put(`Fixed / recurring (${fixedName})`, monthVals(agg, 'fixed'), (c) => xref(fixedName, fixedTotalRow, mFirst - vFirst)(c));
  const rowVar = r; put('Variable expenses', monthVals(agg, 'variable'), (c) => xref('Variable Expenses', varTotalRow, 0)(c));
  const rowOt = r; put('One-time items', monthVals(agg, 'onetime'), (c) => xref('One-Time', otTotalRow, 0)(c));
  const rowExp = r; put('Total expenses (fixed + variable + one-time)', monthVals(agg, 'expenses'), (c) => `${colL(c)}${rowFixed}+${colL(c)}${rowVar}+${colL(c)}${rowOt}`);
  const rowTr = r; put('Outbound transfers', monthVals(agg, 'transfers'), (c) => `${colL(c)}${subtot.transfer}`);
  const rowSav = r; put('MONTHLY SAVINGS', monthVals(agg, 'savings'), (c) => `${colL(c)}${rowIncome}-${colL(c)}${rowExp}-${colL(c)}${rowTr}`, [S.totLbl, S.totNum]);
  // savings rate
  is.set(0, r, 'Savings rate', S.totLbl);
  months.forEach((m, i) => { const c = vFirst + i * 2; const s = agg.summary[i]; is.set(c, r, s.income ? r2(s.savings / s.income * 1000) / 1000 : 0, S.pct, `IF(${colL(c)}${rowIncome}=0,0,${colL(c)}${rowSav}/${colL(c)}${rowIncome})`); is.set(c + 1, r, '', S.totLbl); });
  r += 2;
  is.set(0, r++, 'Savings = Total income − Total expenses (fixed + variable + one-time) − Outbound transfers.', S.legend);
  is.set(0, r++, 'Refunds and reimbursements are not income; they are netted against the spend they reverse.', S.legend);
  is.set(0, r++, 'Each month\'s savings equals the change in the account balance for that month (see Reconciliation).', S.legend);

  // ---- Reconciliation ----
  const rc = new Sheet('Reconciliation'); sheets.push(rc);
  const H = ['Statement period', 'Opening balance €', 'Debits €', 'Credits €', 'Computed closing €', 'Statement closing €', 'Difference €', 'Bookings', 'Chains to previous'];
  H.forEach((h, i) => rc.set(i, 1, h, S.hdr));
  rc.cols = [26, 16, 14, 14, 18, 18, 14, 10, 18];
  rc.freeze = [1, 1];
  recon.forEach((s, i) => {
    const rr = i + 2;
    rc.set(0, rr, `${deDate(s.from)} – ${deDate(s.to)}`, S.text);
    rc.set(1, rr, s.open, S.num); rc.set(2, rr, s.debits, S.num); rc.set(3, rr, s.credits, S.num);
    rc.set(4, rr, s.computed, S.num, `B${rr}+C${rr}+D${rr}`);
    rc.set(5, rr, s.close, S.num);
    rc.set(6, rr, s.diff, S.num, `ROUND(E${rr}-F${rr},2)`);
    rc.set(7, rr, s.count, S.text);
    rc.set(8, rr, s.chainOk ? 'Yes' : `No — gap after ${deDate(s.gapFrom)}`, S.text);
  });

  // ---- Transactions (real Excel dates) ----
  const tx = new Sheet('Transactions'); sheets.push(tx);
  ['Booking date', 'Value date', 'Amount €', 'Section', 'Line', 'Vendor', 'Booking text'].forEach((h, i) => tx.set(i, 1, h, S.hdr));
  tx.cols = [13, 13, 12, 20, 40, 30, 90]; tx.freeze = [0, 1];
  const serial = (iso) => { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };
  [...agg.rows].sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount).forEach((t, i) => {
    const rr = i + 2;
    tx.set(0, rr, serial(t.date), S.date); tx.set(1, rr, serial(t.valuta), S.date); tx.set(2, rr, t.amount, S.num);
    const meta = lineMeta(t.line);
    tx.set(3, rr, meta ? SECTIONS[meta.sec] : 'Needs review', S.text); tx.set(4, rr, lineLabel(t.line), S.text);
    tx.set(5, rr, t.vendor, S.text); tx.set(6, rr, t.text, S.text);
  });

  return zip(packageFiles(sheets));
}

function packageFiles(sheets) {
  const files = {};
  files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  files['xl/styles.xml'] = styles();
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = s.xml(); });
  return files;
}

// ---- stored zip ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const nb = enc.encode(name); const data = enc.encode(content); const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true);
    c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, Object.keys(files).length, true); e.setUint16(10, Object.keys(files).length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
