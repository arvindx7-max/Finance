// Insights computed from the stored bookings. Pure functions: no storage, no network.
import { lineMeta, lineLabel, monthOf } from './model.js';

const r2 = (v) => Math.round(v * 100) / 100 || 0;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sec = (t) => (t.line ? lineMeta(t.line)?.sec : null);
const grp = (t) => (t.line ? lineMeta(t.line)?.group || '' : '');
export const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthDiff = (a, b) => { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
const lineSum = (agg, id, m) => -(agg.cell[`${id}|${m}`]?.amt || 0);

// ---------- I1 monthly highlights ----------
export function highlights(agg, m) {
  const i = agg.months.indexOf(m); if (i < 0) return [];
  const prior = agg.months.slice(0, i);
  const S = Object.fromEntries(agg.summary.map((s) => [s.month, s])); const s = S[m];
  const out = [];
  // savings
  if (agg.months.length > 1 && s.saved === Math.max(...agg.summary.map((x) => x.saved)) && s.saved > 0) out.push({ tone: 'good', key: 'saved', text: `Best month so far: saved ${eur(s.saved)}, ${Math.round(s.savingsRate * 100)}% of earnings.` });
  else if (prior.length) {
    const avg = mean(prior.map((p) => S[p].saved)); const d = s.saved - avg;
    if (Math.abs(d) >= 50) out.push({ tone: d > 0 ? 'good' : 'warn', key: 'saved', text: `Saved ${eur(s.saved)}, ${eur(Math.abs(d))} ${d > 0 ? 'above' : 'below'} your average of ${eur(avg)}.` });
  }
  if (prior.length) {
    // variable spend vs average, with the line that moved most
    const avgVar = mean(prior.map((p) => S[p].variable)); const d = s.variable - avgVar;
    if (Math.abs(d) >= 50) {
      const lines = agg.order.filter((l) => l.sec === 'variable');
      const moves = lines.map((l) => [l, lineSum(agg, l.id, m) - mean(prior.map((p) => lineSum(agg, l.id, p)))]).filter(([, v]) => Math.sign(v) === Math.sign(d)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      const top = moves[0];
      out.push({ tone: d > 0 ? 'warn' : 'good', key: 'variable', text: `Variable spending ${eur(Math.abs(d))} ${d > 0 ? 'higher' : 'lower'} than usual${top ? `, mostly ${top[0].label} (${top[1] > 0 ? '+' : '−'}${eur(Math.abs(top[1]))})` : ''}.` });
    }
    // fixed costs vs last month
    const prev = prior[prior.length - 1]; const df = s.fixed - S[prev].fixed;
    if (Math.abs(df) >= 30) {
      const lines = agg.order.filter((l) => l.sec === 'fixed');
      const top = lines.map((l) => [l, lineSum(agg, l.id, m) - lineSum(agg, l.id, prev)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
      out.push({ tone: df > 0 ? 'warn' : 'good', key: 'fixed', text: `Fixed costs ${df > 0 ? 'up' : 'down'} ${eur(Math.abs(df))} vs last month${top && Math.abs(top[1]) >= 5 ? ` (${top[0].label} ${top[1] > 0 ? '+' : '−'}${eur(Math.abs(top[1]))})` : ''}.` });
    }
    // new vendors this month
    const seen = new Set(agg.rows.filter((t) => prior.includes(monthOf(t.date))).map((t) => t.vkey));
    const fresh = {};
    for (const t of agg.rows) if (monthOf(t.date) === m && t.amount < 0 && !seen.has(t.vkey) && ['variable', 'fixed'].includes(sec(t))) fresh[t.vendor] = (fresh[t.vendor] || 0) - t.amount;
    const nv = Object.entries(fresh).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (nv.length) out.push({ tone: 'info', key: 'new', text: `New this month: ${nv.map(([v, a]) => `${v} (${eur(a)})`).join(', ')}.` });
  }
  // one-time items
  const ot = agg.order.filter((l) => l.sec === 'onetime').map((l) => [l.label, lineSum(agg, l.id, m)]).filter(([, v]) => v > 0);
  if (ot.length) out.push({ tone: 'info', key: 'onetime', text: `One-time: ${ot.map(([l, v]) => `${l} ${eur(v)}`).join(', ')}.` });
  return out;
}

// ---------- I2 recurring costs and subscriptions ----------
export function recurring(agg) {
  const last = agg.months[agg.months.length - 1]; if (!last) return { items: [], yearly: 0 };
  const groups = new Map(); // key -> {label, txs}
  for (const t of agg.rows) {
    if (t.amount >= 0 || !t.line) continue;
    if (sec(t) === 'fixed') { const k = `line:${t.line}`; (groups.get(k) || groups.set(k, { label: lineLabel(t.line), txs: [] }).get(k)).txs.push(t); }
  }
  // variable vendors that charge the same amount in 3+ different months (e.g. an app subscription)
  const byV = {};
  for (const t of agg.rows) if (t.amount < 0 && sec(t) === 'variable') (byV[t.vkey] ||= []).push(t);
  for (const ts of Object.values(byV)) {
    const ms = new Set(ts.map((t) => monthOf(t.date))); const med = median(ts.map((t) => -t.amount));
    if (ms.size >= 3 && ts.every((t) => Math.abs(-t.amount - med) <= med * 0.05) && ts.length <= ms.size + 1) groups.set(`v:${ts[0].vkey}`, { label: ts[0].vendor, txs: ts });
  }
  const items = [...groups.values()].map(({ label, txs }) => {
    txs.sort((a, b) => a.date.localeCompare(b.date));
    const months = [...new Set(txs.map((t) => monthOf(t.date)))];
    const first = months[0]; const span = monthDiff(first, last) + 1;
    const total = sum(txs.map((t) => -t.amount));
    const multi = txs.filter((t) => monthOf(t.date) === months[months.length - 1]).length > 1; // several charges in the latest month (e.g. DB extras)
    const amounts = txs.map((t) => -t.amount); const lastAmt = amounts[amounts.length - 1];
    let change = null;
    if (!multi && amounts.length >= 3) { const [a, b, c] = amounts.slice(-3); if (Math.abs(a - b) < 0.01 && Math.abs(c - b) > Math.max(0.5, b * 0.01)) change = { from: b, to: c, date: txs[txs.length - 1].date }; }
    return { label, last: lastAmt, lastDate: txs[txs.length - 1].date, monthly: r2(total / span), yearly: r2(total / span * 12), isNew: first === last && agg.months.length > 1, change, multi, count: txs.length };
  }).sort((a, b) => b.yearly - a.yearly);
  return { items, yearly: r2(sum(items.map((i) => i.yearly))) };
}

// ---------- I3 fees ----------
const deAmt = (s) => parseFloat(s.replace(/\./g, '').replace(',', '.'));
export function fees(agg, months) {
  const out = { atm: { n: 0, sum: 0 }, card: { n: 0, sum: 0 }, bank: { n: 0, sum: 0 }, items: [] };
  for (const t of agg.rows) {
    if (!months.includes(monthOf(t.date))) continue;
    const fx = /Fremdentgelt\s+([\d.]+,\d\d)\s*EUR/i.exec(t.text);
    if (fx) { const v = deAmt(fx[1]); out.atm.n++; out.atm.sum += v; out.items.push({ date: t.date, what: `ATM fee, ${t.vendor.replace(/^ATM\s*/, '')}`, v }); continue; }
    const cf = /(?<!Fremd)Entgelt\s+([\d.]+,\d\d)\s*EUR/i.exec(t.text);
    if (cf) { const v = deAmt(cf[1]); out.card.n++; out.card.sum += v; out.items.push({ date: t.date, what: `Card fee, ${t.vendor}`, v }); continue; }
    if (t.line === 'fx.bankFee') { out.bank.n++; out.bank.sum -= t.amount; out.items.push({ date: t.date, what: 'Account fee', v: -t.amount }); }
  }
  for (const k of ['atm', 'card', 'bank']) out[k].sum = r2(out[k].sum);
  out.total = r2(out.atm.sum + out.card.sum + out.bank.sum);
  out.items.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

// ---------- I4 budgets (per variable group, per month; scaled for longer periods) ----------
export function budgets(agg, months, set) {
  const groups = [...new Set(agg.order.filter((l) => l.sec === 'variable').map((l) => l.group || 'Other'))];
  return groups.map((g) => {
    const spent = r2(-sum(agg.rows.filter((t) => months.includes(monthOf(t.date)) && sec(t) === 'variable' && (grp(t) || 'Other') === g).map((t) => t.amount)));
    const per = set && set[g] ? +set[g] : 0; const limit = r2(per * months.length);
    return { group: g, spent, perMonth: per, limit, ratio: limit ? spent / limit : null };
  });
}

// ---------- I5 savings goal ----------
export function goal(agg, g) {
  if (!g || !g.amount) return null;
  const year = String(g.year); const ms = agg.summary.filter((s) => s.month.startsWith(year));
  const saved = r2(sum(ms.map((s) => s.saved))); const n = ms.length;
  const lastMonth = ms.length ? +ms[ms.length - 1].month.slice(5) : 0; const remaining = Math.max(0, 12 - lastMonth);
  const avg = n ? saved / n : 0; const projected = r2(saved + avg * remaining);
  const needPerMonth = remaining ? r2(Math.max(0, g.amount - saved) / remaining) : 0;
  return { year, target: +g.amount, saved, months: n, avg: r2(avg), remaining, projected, needPerMonth, onTrack: projected >= g.amount };
}

// ---------- I6 upcoming fixed payments (the month after the latest data) ----------
export function upcoming(agg) {
  const last = agg.months[agg.months.length - 1]; if (!last) return { month: null, items: [], total: 0 };
  const target = addMonths(last, 1);
  const byLine = {};
  for (const t of agg.rows) if (t.amount < 0 && sec(t) === 'fixed') (byLine[t.line] ||= []).push(t);
  const items = [];
  for (const [line, ts] of Object.entries(byLine)) {
    ts.sort((a, b) => a.date.localeCompare(b.date));
    const months = [...new Set(ts.map((t) => monthOf(t.date)))];
    if (months.length < 2) continue;
    const gaps = months.slice(1).map((m, i) => monthDiff(months[i], m));
    const gap = Math.max(1, median(gaps));
    let due = addMonths(months[months.length - 1], gap); if (due < target) due = target;
    if (due !== target) continue;
    const lastMonthTx = ts.filter((t) => monthOf(t.date) === months[months.length - 1]);
    const multi = lastMonthTx.length > 1; // several charges in the latest month (e.g. DB extras)
    const amount = multi ? r2(sum(lastMonthTx.map((t) => -t.amount))) : -ts[ts.length - 1].amount;
    const day = multi ? null : +ts[ts.length - 1].date.slice(8, 10);
    items.push({ label: lineLabel(line), amount: r2(amount), day, every: gap, multi });
  }
  items.sort((a, b) => (a.day ?? 99) - (b.day ?? 99));
  return { month: target, items, total: r2(sum(items.map((i) => i.amount))) };
}

// ---------- I7 spending patterns ----------
const WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function patterns(agg, months) {
  const v = agg.rows.filter((t) => months.includes(monthOf(t.date)) && t.amount < 0 && sec(t) === 'variable');
  const total = -sum(v.map((t) => t.amount));
  const eat = -sum(v.filter((t) => grp(t) === 'Restaurants & dining').map((t) => t.amount));
  const groc = v.filter((t) => grp(t) === 'Supermarkets');
  const grocTotal = -sum(groc.map((t) => t.amount)) - sum(v.filter((t) => grp(t) === 'Bakery & butcher').map((t) => t.amount));
  const days = WD.map(() => 0);
  for (const t of v) { if (!/Kartenzahlung/i.test(t.type || t.text)) continue; const d = new Date(t.cardDate || t.date); days[(d.getDay() + 6) % 7] -= t.amount; }
  const busiest = days.indexOf(Math.max(...days));
  return { total: r2(total), eatingOut: r2(eat), groceries: r2(grocTotal), eatShare: total ? eat / total : 0, grocShare: total ? grocTotal / total : 0,
    avgGroceryBill: r2(mean(groc.map((t) => -t.amount))), groceryTrips: groc.length, perMonthGroceryTrips: months.length ? r2(groc.length / months.length) : 0,
    days: days.map((d, i) => ({ day: WD[i], amount: r2(d) })), busiest: total ? WD[busiest] : null };
}

// ---------- I11 missing statements ----------
export function missingStatements(statements, startMonth, today = new Date()) {
  const pdf = statements.filter((s) => s.kind !== 'checkpoint');
  if (!pdf.length) return [];
  const covered = new Set();
  for (const s of pdf) { let m = monthOf(s.from); const end = monthOf(s.to); while (m <= end) { covered.add(m); m = addMonths(m, 1); } }
  const first = startMonth && startMonth > [...covered].sort()[0] ? startMonth : [...covered].sort()[0];
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const lastExpected = today.getDate() > 3 ? addMonths(thisMonth, -1) : addMonths(thisMonth, -2);
  const out = []; let m = first;
  while (m <= lastExpected) { if (!covered.has(m)) out.push(m); m = addMonths(m, 1); }
  return out;
}

// euro formatting shared with the app
const nf = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const eur = (v) => `${v < 0 ? '−' : ''}€${nf.format(Math.abs(v))}`;
