// Review (v20, I68): which lines to offer as one-tap suggestions for a booking. Runs on the device only.
// Rows are bookings that already have a line: { line, text, amount, date }.
// Ranked by (a) words the booking text shares with bookings already on a line, then (b) how often the line is used for
// the same direction (money in or out), then (c) how recently. Never a line that has only been used for the other direction.
const words = (text) => String(text || '').toLowerCase().split(/[^a-zäöüß]+/).filter((w) => w.length >= 4);
export function suggestLines(tx, rows, limit = 3) {
  const answered = rows.filter((r) => r.line && r.id !== tx.id);
  if (!answered.length) return [];
  // words that appear in a large share of all bookings (payment-type boilerplate) say nothing about the vendor
  const df = new Map();
  for (const r of rows) for (const w of new Set(words(r.text))) df.set(w, (df.get(w) || 0) + 1);
  const common = (w) => (df.get(w) || 0) > Math.max(3, rows.length * 0.4);
  const mine = new Set(words(tx.text).filter((w) => !common(w)));
  const dir = Math.sign(tx.amount) || -1;
  const byLine = new Map();
  for (const r of answered) {
    if (Math.sign(r.amount) !== dir) continue;
    const e = byLine.get(r.line) || { id: r.line, uses: 0, shared: 0, last: '' };
    e.uses++;
    if (r.date > e.last) e.last = r.date;
    let sh = 0; for (const w of new Set(words(r.text))) if (mine.has(w)) sh++;
    if (sh > e.shared) e.shared = sh;
    byLine.set(r.line, e);
  }
  return [...byLine.values()]
    .sort((a, b) => b.shared - a.shared || b.uses - a.uses || b.last.localeCompare(a.last) || a.id.localeCompare(b.id))
    .slice(0, limit).map((e) => e.id);
}
