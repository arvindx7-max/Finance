// I83: CSV exports of other banks. The first time a layout is seen, the person says which column is which;
// the answer is remembered for every later file with the same column names. Pure parsing here, the question lives in askMapping().
import { normalize } from './parser.js';
import { h } from './util.js';
import { ask } from './security.js';

const r2 = (v) => Math.round(v * 100) / 100;
function split(line, d) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === d && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
// Finds the separator and the header row of any CSV file. Returns null when it does not look like a table.
export function sniff(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const head = lines.slice(0, 12);
  let best = null;
  for (const d of [';', ',', '\t']) {
    const counts = head.map((l) => split(l, d).length);
    const top = Math.max(...counts); if (top < 3) continue;
    const score = counts.filter((c) => c === top).length;
    if (!best || score > best.score || (score === best.score && top > best.top)) best = { d, top, score };
  }
  if (!best) return null;
  const { d, top } = best;
  const hi = lines.findIndex((l) => split(l, d).length === top);
  const headers = split(lines[hi], d);
  const rows = lines.slice(hi + 1).map((l) => split(l, d)).filter((r) => r.length === top);
  if (!rows.length) return null;
  return { delim: d, headers, rows, fingerprint: fingerprint(d, headers) };
}
export function fingerprint(delim, headers) {
  const s = delim + '|' + headers.map((x) => x.toLowerCase().replace(/\s+/g, ' ')).join('|');
  let hsh = 5381; for (let i = 0; i < s.length; i++) hsh = ((hsh * 33) ^ s.charCodeAt(i)) >>> 0;
  return hsh.toString(16);
}
const find = (headers, re) => headers.findIndex((x) => re.test(x));
export function guessMap(table, bank = '') {
  const H = table.headers; const d = find(H, /date|datum|buchung|booking/i);
  const debit = find(H, /debit|soll|withdraw|paid out|money out/i), credit = find(H, /credit|haben|deposit|paid in|money in/i);
  const amount = find(H, /^(amount|betrag|value|sum|umsatz)\b/i);
  const sample = table.rows.slice(0, 20).map((r) => r[amount >= 0 ? amount : 0] || '').join(' ');
  const desc = H.map((x, i) => (/descr|text|payee|name|reference|purpose|verwendung|memo|details|empf|beg|counterparty|merchant/i.test(x) ? i : -1)).filter((i) => i >= 0);
  return { bank, dateCol: Math.max(d, 0), dateFmt: guessDateFmt(table.rows.map((r) => r[Math.max(d, 0)])),
    amountMode: amount < 0 && debit >= 0 && credit >= 0 ? 'split' : 'one', amountCol: Math.max(amount, 0), debitCol: Math.max(debit, 0), creditCol: Math.max(credit, 0),
    decimal: /\d,\d\d(\D|$)/.test(sample) && !/\d\.\d\d(\D|$)/.test(sample) ? 'comma' : /\d\.\d\d(\D|$)/.test(sample) && !/\d,\d\d(\D|$)/.test(sample) ? 'dot' : 'comma', desc: desc.length ? desc : [Math.min(1, H.length - 1)] };
}
export function guessDateFmt(values) {
  const v = values.filter(Boolean).slice(0, 40);
  if (v.some((x) => /^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(x))) return 'ymd';
  const p = v.map((x) => /^(\d{1,2})[-./](\d{1,2})[-./]\d{2,4}/.exec(x)).filter(Boolean);
  if (p.some((m) => +m[1] > 12)) return 'dmy';
  if (p.some((m) => +m[2] > 12)) return 'mdy';
  return 'dmy';
}
export function parseDate(s, fmt) {
  const m = /^(\d{1,4})[-./](\d{1,2})[-./](\d{1,4})/.exec(String(s || '').trim());
  if (!m) return null;
  let [y, mo, d] = fmt === 'ymd' ? [m[1], m[2], m[3]] : fmt === 'mdy' ? [m[3], m[1], m[2]] : [m[3], m[2], m[1]];
  if (String(y).length === 2) y = `20${y}`;
  y = +y; mo = +mo; d = +d;
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function parseAmount(s, decimal) {
  let x = String(s ?? '').replace(/[^\d.,()+-]/g, '');
  if (!/\d/.test(x)) return NaN;
  const neg = /^\(.*\)$/.test(x) || /-$/.test(x);
  x = x.replace(/[()+]/g, '').replace(/-$/, '');
  x = decimal === 'dot' ? x.replace(/,/g, '') : x.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(x);
  return neg ? -Math.abs(v) : v;
}
// Rows of the table -> normalised bookings, tagged with the bank so the same amount at two banks is never taken for a duplicate.
export function parseWithMap(table, map) {
  const rows = []; let skipped = 0;
  for (const r of table.rows) {
    const date = parseDate(r[map.dateCol], map.dateFmt);
    let amount = map.amountMode === 'split'
      ? (parseAmount(r[map.creditCol], map.decimal) || 0) - Math.abs(parseAmount(r[map.debitCol], map.decimal) || 0)
      : parseAmount(r[map.amountCol], map.decimal);
    if (!date || Number.isNaN(amount)) { skipped++; continue; }
    const parts = (map.desc || []).map((i) => r[i]).filter(Boolean);
    rows.push(normalize({ date, valuta: null, amount: r2(amount), type: '', lines: [parts[0] || '', 'Verwendungszweck/ Kundenreferenz', ...parts.slice(1)].filter(Boolean), source: 'csv', bank: map.bank }));
  }
  if (!rows.length || skipped > rows.length) throw new Error(`could not read the bookings with these columns (${skipped} of ${skipped + rows.length} rows failed). Check the date format and the amount columns.`);
  return { rows, skipped };
}
const opt = (cols, sel) => cols.map((c, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${h(c || `Column ${i + 1}`)}</option>`).join('');
// The one-time question: which column is which. Resolves with the mapping, or null when cancelled.
export async function askMapping(table, map0) {
  const H = table.headers; const m = map0;
  const body = `<label>Bank name<input type="text" name="bank" value="${h(m.bank)}" maxlength="40" placeholder="the name of the bank" required></label>
    <label>Date column<select name="dateCol">${opt(H, m.dateCol)}</select></label>
    <label>Date looks like<select name="dateFmt"><option value="dmy"${m.dateFmt === 'dmy' ? ' selected' : ''}>day, month, year (31.12.2026)</option><option value="mdy"${m.dateFmt === 'mdy' ? ' selected' : ''}>month, day, year (12/31/2026)</option><option value="ymd"${m.dateFmt === 'ymd' ? ' selected' : ''}>year, month, day (2026-12-31)</option></select></label>
    <label>Amounts are in<select name="amountMode"><option value="one"${m.amountMode === 'one' ? ' selected' : ''}>one column (negative = money out)</option><option value="split"${m.amountMode === 'split' ? ' selected' : ''}>two columns (money out, money in)</option></select></label>
    <label data-one>Amount column<select name="amountCol">${opt(H, m.amountCol)}</select></label>
    <label data-split>Money out column<select name="debitCol">${opt(H, m.debitCol)}</select></label>
    <label data-split>Money in column<select name="creditCol">${opt(H, m.creditCol)}</select></label>
    <label>Numbers are written like<select name="decimal"><option value="comma"${m.decimal === 'comma' ? ' selected' : ''}>1.234,56</option><option value="dot"${m.decimal === 'dot' ? ' selected' : ''}>1,234.56</option></select></label>
    <label>Description (first one is the name of the shop or person)</label>
    ${H.map((c, i) => `<label class="chk"><input type="checkbox" name="desc" value="${i}"${(m.desc || []).includes(i) ? ' checked' : ''}> ${h(c || `Column ${i + 1}`)}</label>`).join('')}`;
  const r = await ask({ title: 'Which column is which?', text: 'This file comes from a bank the app has not seen before. Say once what each column holds; the answer is remembered for files with the same columns.', ok: 'Use these columns', body });
  if (!r) return null;
  const desc = [].concat(r.desc || []).map(Number);
  const out = { bank: String(r.bank || '').trim().slice(0, 40), dateCol: +r.dateCol, dateFmt: r.dateFmt, amountMode: r.amountMode, amountCol: +r.amountCol, debitCol: +r.debitCol, creditCol: +r.creditCol, decimal: r.decimal, desc: desc.length ? desc : [0] };
  return out.bank ? out : null;
}

// Shows only the amount columns that belong to the chosen way of writing amounts.
export function syncMappingForm(f) {
  if (!f || !f.amountMode) return; const split = f.amountMode.value === 'split';
  f.querySelectorAll('[data-one]').forEach((x) => { x.hidden = split; }); f.querySelectorAll('[data-split]').forEach((x) => { x.hidden = !split; });
}
