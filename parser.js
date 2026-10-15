// Deutsche Bank statement parsers. Pure functions: no DOM, no storage.
// PDF layout (points, A4): date col x<112, valuta 112-155, description 155-400,
// amounts x>=400 (Soll right edge ~465, Haben ~544). Margin code is rotated text at x<60.

export function deNum(s) {
  return parseFloat(String(s).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
}
const r2 = (v) => Math.round(v * 100) / 100;
export function isoFromDE(d) { // dd.mm.yyyy -> yyyy-mm-dd
  const m = /^(\d\d)\.(\d\d)\.(\d{4})$/.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export async function parsePdf(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const txs = [];
  let full = '';
  let cur = null;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const H = page.getViewport({ scale: 1 }).height;
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((it) => it.str && it.str.trim() && Math.abs(it.transform[1]) < 0.01 && it.transform[4] >= 60)
      .map((it) => ({ x: it.transform[4], x1: it.transform[4] + it.width, top: H - it.transform[5], s: it.str }));
    // group into visual lines (tolerance 3pt)
    items.sort((a, b) => a.top - b.top || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const L = lines.length && Math.abs(lines[lines.length - 1].top - it.top) < 3 ? lines[lines.length - 1] : null;
      if (L) L.items.push(it); else lines.push({ top: it.top, items: [it] });
    }
    for (const L of lines) L.items.sort((a, b) => a.x - b.x);
    full += lines.map((L) => L.items.map((i) => i.s.trim()).join(' ')).join('\n') + '\n';

    const hdrIdx = lines.findIndex((L) => { const t = L.items.map((i) => i.s).join(' '); return /Buchung/.test(t) && /Valuta/.test(t); });
    if (hdrIdx < 0) continue;
    for (const L of lines.slice(hdrIdx + 1)) {
      const txt = L.items.map((i) => i.s.trim()).join(' ');
      if (/^Filialnummer|Neuer Saldo|^Wichtige Hinweise/.test(txt)) break;
      const dateCol = L.items.filter((i) => i.x < 112);
      const valCol = L.items.filter((i) => i.x >= 112 && i.x < 155);
      const d0 = dateCol.map((i) => i.s.trim()).join('');
      if (/^\d\d\.\d\d\.$/.test(d0)) {
        cur = { buch: d0, val: valCol.map((i) => i.s.trim()).join(''), desc: [], amt: null };
        txs.push(cur);
      } else if (/^\d{4}$/.test(d0) && cur && cur.buch.length === 6) {
        cur.buch += d0;
        const v = valCol.map((i) => i.s.trim()).join('');
        if (/^\d{4}$/.test(v) && cur.val.length === 6) cur.val += v;
      }
      if (!cur) continue;
      const mid = L.items.filter((i) => i.x >= 155 && i.x < 400);
      if (mid.length) cur.desc.push(mid.map((i) => i.s.trim()).join(' ').replace(/\s+/g, ' '));
      const amt = L.items.filter((i) => i.x >= 400);
      if (amt.length) {
        const a = amt.map((i) => i.s).join('').replace(/\s/g, '');
        if (/^[+-][\d.]+,\d\d$/.test(a)) cur.amt = deNum(a);
      }
    }
  }
  const per = /Kontoauszug vom (\d\d\.\d\d\.\d{4}) bis (\d\d\.\d\d\.\d{4})/.exec(full);
  const op = /Alter Saldo per (\d\d\.\d\d\.\d{4})[\s\S]*?EUR\s*([+-])\s*([\d.]+,\d\d)/.exec(full);
  const cl = /Neuer Saldo[\s\S]*?EUR\s*([+-])\s*([\d.]+,\d\d)/.exec(full);
  if (!per || !op || !cl) throw new Error('This PDF does not look like a Deutsche Bank Kontoauszug (period or balances not found).');
  const bad = txs.filter((t) => t.amt === null || !isoFromDE(t.buch));
  if (bad.length) throw new Error(`${bad.length} booking(s) could not be read cleanly.`);
  const statement = {
    id: `${isoFromDE(per[1])}_${isoFromDE(per[2])}`,
    from: isoFromDE(per[1]), to: isoFromDE(per[2]),
    openDate: isoFromDE(op[1]),
    open: (op[2] === '-' ? -1 : 1) * deNum(op[3]),
    close: (cl[1] === '-' ? -1 : 1) * deNum(cl[2]),
    source: 'pdf',
  };
  const rows = txs.map((t) => normalize({
    date: isoFromDE(t.buch), valuta: isoFromDE(t.val), amount: t.amt,
    type: t.desc[0] || '', lines: t.desc.slice(1), source: 'pdf',
  }));
  const sum = r2(rows.reduce((s, t) => s + t.amount, 0));
  statement.debits = r2(rows.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  statement.credits = r2(rows.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  statement.ties = Math.abs(r2(statement.open + sum) - statement.close) < 0.005;
  return { statement, rows };
}

// ---------- CSV (Deutsche Bank Umsatzexport) ----------
function splitCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ';' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex((l) => /^"?Buchungstag"?;/.test(l));
  if (hi < 0) throw new Error('No "Buchungstag" header row found — is this the Deutsche Bank CSV export?');
  const H = splitCsvLine(lines[hi]);
  const col = (name) => H.findIndex((h) => h.replace(/"/g, '') === name);
  const iB = col('Buchungstag'), iW = col('Wert'), iU = col('Umsatzart'), iC = col('Begünstigter / Auftraggeber'),
    iV = col('Verwendungszweck'), iK = col('Kundenreferenz'), iBet = col('Betrag'), iS = col('Soll'), iHa = col('Haben');
  const rows = []; let footer = null;
  for (const l of lines.slice(hi + 1)) {
    if (!l.trim()) continue;
    const f = splitCsvLine(l);
    if (/^Kontostand/.test(f[0])) {
      const amt = f.slice(1).find((x) => /^[+-]?[\d.]+,\d\d$/.test(x)); // B38: a leading "+" is fine too
      footer = { date: isoFromDE(f[1]), balance: amt ? deNum(amt) : null };
      continue;
    }
    const date = isoFromDE(f[iB]); if (!date) continue;
    let amount = iBet >= 0 && f[iBet] ? deNum(f[iBet]) : NaN;
    if (isNaN(amount)) amount = (iHa >= 0 && f[iHa] ? deNum(f[iHa]) : 0) - Math.abs(iS >= 0 && f[iS] ? deNum(f[iS]) : 0);
    const cp = iC >= 0 ? f[iC] : '';
    const vz = iV >= 0 ? f[iV] : '';
    rows.push(normalize({
      date, valuta: isoFromDE(f[iW]), amount: r2(amount), type: iU >= 0 ? f[iU] : '',
      lines: [cp, 'Verwendungszweck/ Kundenreferenz', vz, iK >= 0 ? f[iK] : ''].filter(Boolean), source: 'csv',
    }));
  }
  return { rows, footer };
}

// ---------- normalisation shared by both formats ----------
export function cardDate(text) {
  const m = /(\d\d)-(\d\d)-(\d{4})\s?T\d\d:\d\d/.exec(text);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
export function vendorOf(type, lines) {
  const text = lines.join(' ');
  const pp = /Ihr Einkauf bei\s+(.+?)(?:\s+\d{10,}|$)/i.exec(text);
  if (/PayPal/i.test(lines[0] || '') || /PayPal/i.test(text.slice(0, 60))) {
    if (pp && /^[A-Za-z]/.test(pp[1])) return pp[1].replace(/,.*$/, '').trim();
    return 'PayPal (no vendor name)';
  }
  if (/Kartenzahlung|Bargeldauszahlung/i.test(type)) {
    const i = lines.findIndex((l) => /Verwendungszweck/.test(l));
    let s = (lines[i + 1] || '').replace(/^WWW\./i, '');
    if (/Bargeldauszahlung/i.test(type)) return 'ATM ' + s.split('//')[0];
    s = s.split('//')[0].split('/')[0];
    s = s.replace(/SAGT DANKE\.?.*$/i, '').replace(/\bGIR \d+.*$/i, '').replace(/Vielen Dank.*$/i, '');
    s = s.split(/\s+/).map((w) => w.replace(/\d+$/, '')).filter((w) => w && !/\d/.test(w)).join(' ');
    s = s.replace(/[.\s]+$/, '').trim();
    return s || 'Card payment';
  }
  if (/Saldo der Abschlussposten/.test(text)) return 'Deutsche Bank';
  return (lines.find((l) => l && !/Verwendungszweck/.test(l)) || type).trim();
}
export function vendorKey(v) {
  return v.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || 'UNKNOWN';
}
function normalize(r) {
  const text = [r.type, ...r.lines].join(' ').replace(/\s+/g, ' ');
  const vendor = vendorOf(r.type, r.lines);
  return { ...r, text, vendor, vkey: vendorKey(vendor), cardDate: cardDate(text) };
}
