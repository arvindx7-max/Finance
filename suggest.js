// Review (v20, I68): which lines to offer as one-tap suggestions for a booking. Runs on the device only.
// Rows are bookings that already have a line: { id, line, text, amount, date }.
// Ranked by (a) words the booking text shares with bookings already on a line, rare words counting more than common
// ones, then (b) how close the amount is, (c) how often the line is used, (d) how recently. Only lines used for the same
// direction (money in or out) are offered. Trip lines are never offered: they follow the trip dates, not an answer.
const words = (text) => String(text || '').toLowerCase().split(/[^a-zäöüß]+/).filter((w) => w.length >= 3);
export function suggestLines(tx, rows, limit = 3, group = [tx]) {
  const answered = rows.filter((r) => r.line && r.id !== tx.id && !String(r.line).startsWith('trip:'));
  if (!answered.length) return [];
  // words that appear in a large share of all bookings (payment-type boilerplate) say nothing about the vendor
  const df = new Map();
  for (const r of rows) for (const w of new Set(words(r.text))) df.set(w, (df.get(w) || 0) + 1);
  const n = rows.length;
  const weight = (w) => Math.log((n + 1) / ((df.get(w) || 0) + 1));
  // I73: every booking of this vendor counts (words of all of them, the closest amount of any), not only the one shown
  const mine = new Set(group.flatMap((g) => words(g.text)).filter((w) => (df.get(w) || 0) <= Math.max(3, n * 0.4)));
  const dir = Math.sign(tx.amount) || -1; const amts = group.map((g) => Math.abs(g.amount) || 1);
  const byLine = new Map();
  for (const r of answered) {
    if (Math.sign(r.amount) !== dir) continue;
    const e = byLine.get(r.line) || { id: r.line, uses: 0, score: 0, gap: Infinity, last: '' };
    e.uses++;
    if (r.date > e.last) e.last = r.date;
    let sc = 0; for (const w of new Set(words(r.text))) if (mine.has(w)) sc += weight(w);
    if (sc > e.score) e.score = sc;
    for (const amt of amts) e.gap = Math.min(e.gap, Math.abs(Math.abs(r.amount) - amt) / amt);
    byLine.set(r.line, e);
  }
  return [...byLine.values()]
    .sort((a, b) => b.score - a.score || a.gap - b.gap || b.uses - a.uses || b.last.localeCompare(a.last) || a.id.localeCompare(b.id))
    .slice(0, limit).map((e) => e.id);
}

// I84: a new shop name that looks like a shop you already answered ("Alpha Corner" and "Alpha Kiosk": same rare name word and the
// same place). Returns { vendor, line } or null. Only lines you can answer with (fixed, variable, one-time, income) are used,
// and only when the earlier answers for that shop agree on one line.
const ANSWERABLE = new Set(['fixed', 'variable', 'onetime', 'income']);
export function sameShop(tx, rows, secOf) {
  const dir = Math.sign(tx.amount) || -1;
  const vw = (t) => new Set(words(t.vendor).filter((w) => w.length >= 4));
  const byKey = new Map(); // vkey -> answered rows
  for (const r of rows) if (r.line && r.vkey !== tx.vkey && Math.sign(r.amount) === dir && !String(r.line).startsWith('trip:') && ANSWERABLE.has(secOf(r.line))) (byKey.get(r.vkey) || byKey.set(r.vkey, []).get(r.vkey)).push(r);
  if (!byKey.size) return null;
  const vendorDf = new Map(); // word -> number of distinct shops using it
  const seen = new Map(); for (const r of rows) if (!seen.has(r.vkey)) seen.set(r.vkey, r);
  for (const r of seen.values()) for (const w of vw(r)) vendorDf.set(w, (vendorDf.get(w) || 0) + 1);
  const textDf = new Map(); for (const r of rows) for (const w of new Set(words(r.text))) textDf.set(w, (textDf.get(w) || 0) + 1);
  const boiler = (w) => (textDf.get(w) || 0) > rows.length * 0.4;
  const mineV = vw(tx); const mineT = new Set(words(tx.text).filter((w) => !boiler(w) && !mineV.has(w)));
  let best = null;
  for (const [vkey, rs] of byKey) {
    const theirV = vw(rs[0]);
    const nameWords = [...mineV].filter((w) => theirV.has(w) && (vendorDf.get(w) || 0) <= 3);
    if (!nameWords.length) continue;
    const placeWords = rs.flatMap((r) => words(r.text)).filter((w) => mineT.has(w) && !theirV.has(w));
    if (!placeWords.length) continue;
    const count = {}; for (const r of rs) count[r.line] = (count[r.line] || 0) + 1;
    const [line, c] = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    if (c / rs.length < 0.7) continue;
    const score = nameWords.length * 2 + 1;
    if (!best || score > best.score || (score === best.score && rs.length > best.n)) best = { vendor: rs[0].vendor, line, score, n: rs.length };
  }
  return best ? { vendor: best.vendor, line: best.line } : null;
}

// I85: card payments abroad that are waiting in Review and look like one trip: same country, close together in time,
// at shops that appear nowhere else (so online shops that bill from abroad all year are left out). Returns { country, from, to, ids } or null.
const ABROAD = /\/([A-Z]{2})\s*\/?\s*\d{2}-\d{2}-\d{4}/;
export const countryOf = (text) => { const m = ABROAD.exec(String(text || '')); return m && m[1] !== 'DE' ? m[1] : null; };
export function tripOffer(review, allRows, trips = []) {
  const abroad = review.filter((t) => t.amount < 0 && countryOf(t.text)).sort((a, b) => a.date.localeCompare(b.date));
  const day = (d) => Math.round(Date.parse(d) / 86400000);
  const byCountry = {}; for (const t of abroad) (byCountry[countryOf(t.text)] ||= []).push(t);
  for (const [country, ts] of Object.entries(byCountry)) {
    let cl = [];
    const flush = () => {
      const from = cl[0] && cl[0].date, to = cl.length && cl[cl.length - 1].date;
      if (cl.length >= 3 && new Set(cl.map((t) => t.date)).size >= 2 && day(to) - day(from) <= 30
        && !trips.some((tr) => tr.from <= to && tr.to >= from)
        && cl.every((t) => allRows.filter((x) => x.vkey === t.vkey).every((x) => x.date >= from && x.date <= to))) return { country, from, to, ids: cl.map((t) => t.id) };
      return null;
    };
    for (const t of ts) {
      if (cl.length && day(t.date) - day(cl[cl.length - 1].date) > 4) { const o = flush(); if (o) return o; cl = []; }
      cl.push(t);
    }
    const o = flush(); if (o) return o;
  }
  return null;
}
