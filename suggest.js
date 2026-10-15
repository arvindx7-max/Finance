// Review (v20, I68): which lines to offer as one-tap suggestions for a booking. Runs on the device only.
// Rows are bookings that already have a line: { id, line, text, amount, date }.
// Ranked by (a) words the booking text shares with bookings already on a line, rare words counting more than common
// ones, then (b) how close the amount is, (c) how often the line is used, (d) how recently. Only lines used for the same
// direction (money in or out) are offered. Trip lines are never offered: they follow the trip dates, not an answer.
const words = (text) => String(text || '').toLowerCase().split(/[^a-zäöüß]+/).filter((w) => w.length >= 3);
export function suggestLines(tx, rows, limit = 3) {
  const answered = rows.filter((r) => r.line && r.id !== tx.id && !String(r.line).startsWith('trip:'));
  if (!answered.length) return [];
  // words that appear in a large share of all bookings (payment-type boilerplate) say nothing about the vendor
  const df = new Map();
  for (const r of rows) for (const w of new Set(words(r.text))) df.set(w, (df.get(w) || 0) + 1);
  const n = rows.length;
  const weight = (w) => Math.log((n + 1) / ((df.get(w) || 0) + 1));
  const mine = new Set(words(tx.text).filter((w) => (df.get(w) || 0) <= Math.max(3, n * 0.4)));
  const dir = Math.sign(tx.amount) || -1; const amt = Math.abs(tx.amount) || 1;
  const byLine = new Map();
  for (const r of answered) {
    if (Math.sign(r.amount) !== dir) continue;
    const e = byLine.get(r.line) || { id: r.line, uses: 0, score: 0, gap: Infinity, last: '' };
    e.uses++;
    if (r.date > e.last) e.last = r.date;
    let sc = 0; for (const w of new Set(words(r.text))) if (mine.has(w)) sc += weight(w);
    if (sc > e.score) e.score = sc;
    e.gap = Math.min(e.gap, Math.abs(Math.abs(r.amount) - amt) / amt);
    byLine.set(r.line, e);
  }
  return [...byLine.values()]
    .sort((a, b) => b.score - a.score || a.gap - b.gap || b.uses - a.uses || b.last.localeCompare(a.last) || a.id.localeCompare(b.id))
    .slice(0, limit).map((e) => e.id);
}
