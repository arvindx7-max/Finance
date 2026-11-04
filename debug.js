// I60: a description of what the app shows, with every name, shop, date and exact amount replaced, so a problem can be
// shown to Claude or Gemini without real data. Runs on the device; nothing is sent anywhere.
import { state } from './state.js';
import { live } from './sync.js';
const bucket = (x) => (x < 10 ? 'under 10' : x < 50 ? '10 to 50' : x < 200 ? '50 to 200' : 'over 200');
// Line ids of the built-in catalog are neutral (fx.rent, v.groceries); your own lines and trips are named only by kind.
const lineKind = (id) => (!id ? 'in Review' : String(id).startsWith('c.') ? 'own line' : String(id).startsWith('trip:') ? 'trip line' : id);
export function debugInfo(version) {
  const a = state.agg; const s = state.settings;
  const byV = new Map();
  for (const t of a.rows) { const e = byV.get(t.vkey) || byV.set(t.vkey, { n: 0, line: t.line, sum: 0 }).get(t.vkey); e.n++; e.sum += Math.abs(t.amount); }
  const top = [...byV.values()].sort((x, y) => y.n - x.n).slice(0, 30);
  const dark = document.documentElement.dataset.theme === 'dark';
  return [
    `Finances ${version} · ${innerWidth} × ${innerHeight} · ${dark ? 'dark' : 'light'}`,
    `Months: ${a.months.length} · Bookings: ${state.tx.length} · Statements: ${state.statements.length}`,
    `In Review: ${a.reviewShops} shops, ${a.review.length} bookings · One-time checks: ${a.flags.length} · Forwarded checks: ${a.passFlags.length}`,
    `Lines in use: ${a.order.length} · Vendor answers: ${live(s.vendorRules).length} · Booking answers: ${live(s.txRules).length} · Keyword rules: ${((s.profile || {}).rules || []).length} · Trips: ${(s.trips || []).length}`,
    '', 'Shops (replaced by numbers, most bookings first):',
    ...top.map((v, i) => `Shop ${i + 1} · ${lineKind(v.line)} · ${v.n} booking${v.n === 1 ? '' : 's'} · usual amount ${bucket(v.sum / v.n)}`),
  ].join('\n');
}
