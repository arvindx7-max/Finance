// Categorisation and aggregation. Totals are always computed from stored transactions.
// This file holds ONLY generic rules. Anything personal (names, customer numbers, local shops,
// trips, specific amounts) lives in the user's rules file, which is stored on the device.

export const SECTIONS = {
  income: 'Earned income', fixed: 'Fixed / recurring', variable: 'Variable expenses', onetime: 'One-time items',
  india: 'Transfers to India', passthrough: 'Pass-through to India',
  tosav: 'Moved to savings', fromsav: 'Top-ups from savings', offset: 'Offsetting pairs',
};
// Sections a user can pick when creating a new line.
export const USER_SECTIONS = ['fixed', 'variable', 'onetime', 'income', 'india', 'tosav', 'fromsav'];

const L = (id, sec, label, group = '') => ({ id, sec, label, group });
// Generic line catalog. A rules file can relabel these, regroup them, or add new lines.
export const BASE_LINES = [
  L('fx.rent', 'fixed', 'Rent'),
  L('fx.rundfunk', 'fixed', 'Broadcast fee (Rundfunk)'),
  L('fx.mobile', 'fixed', 'Mobile phone'),
  L('fx.internet', 'fixed', 'Internet / WiFi'),
  L('fx.ai', 'fixed', 'AI subscription'),
  L('fx.electricity', 'fixed', 'Electricity'),
  L('fx.lifeIns', 'fixed', 'Life insurance'),
  L('fx.insurance', 'fixed', 'Insurance'),
  L('fx.transitAbo', 'fixed', 'Transport subscription'),
  L('fx.uberOne', 'fixed', 'Uber One'),
  L('fx.transitExtra', 'fixed', 'Transport extras'),
  L('fx.canteen', 'fixed', 'Canteen / lunch card'),
  L('fx.bankFee', 'fixed', 'Bank fee'),
  L('fx.other', 'fixed', 'Other recurring'),

  L('v.edeka', 'variable', 'EDEKA', 'Supermarkets'),
  L('v.rewe', 'variable', 'REWE', 'Supermarkets'),
  L('v.lidlAldi', 'variable', 'Lidl / Aldi', 'Supermarkets'),
  L('v.otherGrocery', 'variable', 'Other grocery', 'Supermarkets'),
  L('v.rossmann', 'variable', 'Rossmann', 'Drugstore'),
  L('v.dm', 'variable', 'DM', 'Drugstore'),
  L('v.bakery', 'variable', 'Bakery', 'Bakery & butcher'),
  L('v.butcher', 'variable', 'Butcher', 'Bakery & butcher'),
  L('v.restaurants', 'variable', 'Restaurants & dining', 'Restaurants & dining'),
  L('v.delivery', 'variable', 'Food delivery', 'Restaurants & dining'),
  L('v.fuel', 'variable', 'Fuel', 'Transport & fuel'),
  L('v.uber', 'variable', 'Uber rides', 'Transport & fuel'),
  L('v.amazon', 'variable', 'Amazon (net of refunds)', 'Online & shopping'),
  L('v.fashion', 'variable', 'Fashion', 'Online & shopping'),
  L('v.decathlon', 'variable', 'Sports / department stores', 'Online & shopping'),
  L('v.homeOnline', 'variable', 'Zalando / IKEA', 'Online & shopping'),
  L('v.pharmacy', 'variable', 'Pharmacy', 'Health & personal care'),
  L('v.personalCare', 'variable', 'Doctor / dentist / salon', 'Health & personal care'),
  L('v.fitnessCleaning', 'variable', 'Fitness / cleaning', 'Health & personal care'),
  L('v.atm', 'variable', 'ATM cash', 'Cash'),
  L('v.apple', 'variable', 'Apple subscription', 'Subscriptions & other'),
  L('v.unidentified', 'variable', 'Unidentified (nameless PayPal)', 'Subscriptions & other'),
  L('v.other', 'variable', 'Other variable', 'Subscriptions & other'),

  L('ot.other', 'onetime', 'Other one-time'),

  L('in.salary', 'income', 'Monthly salary', 'Salary'),
  L('in.employerOther', 'income', 'Employer credit (non-salary)', 'Other income'),
  L('in.cash', 'income', 'Cash deposits', 'Other income'),
  L('in.kindergeld', 'income', 'Kindergeld', 'Kindergeld'),

  L('ind.remit', 'india', 'Money transfer to India', 'Transfers to India'),
  L('pt.in', 'passthrough', 'Received to forward to India', 'Transfers to India'),
  L('sv.out', 'tosav', 'Moved to savings account', 'Savings movements'),
  L('sv.in', 'fromsav', 'Top-up from savings account', 'Savings movements'),

  L('off.other', 'offset', 'Offsetting pair'),
];

const has = (re) => (t) => re.test(t.T);
export const GENERIC_RULES = [
  ['in.salary', (t) => t.amount > 0 && /SALA LOHN\/GEHALT|LOHN, GEHALT|LOHN\/GEHALT/.test(t.T)],
  ['in.kindergeld', has(/FAMILIENKASSE/)],
  ['in.cash', (t) => t.amount > 0 && /BAREINZAHLUNG/.test(t.T)],
  ['ind.remit', (t) => t.amount < 0 && /WESTERN UNION|WISE PAYMENTS|REMITLY/.test(t.T)],
  ['fx.rent', (t) => t.amount < 0 && /DAUERAUFTRAG/.test(t.T) && /MIETE|RENT/.test(t.T)],
  ['fx.lifeIns', has(/LEBENSVERSICHERUNG/)],
  ['fx.insurance', has(/VERSICHERUNG|INSURANCE/)],
  ['fx.transitAbo', (t) => /DB ?VERTRIEB/.test(t.T) && /\bABO\b/.test(t.T)],
  ['fx.transitExtra', (t) => /DB ?VERTRIEB/.test(t.T) && /IHR AUFTRAG/.test(t.T)],
  ['fx.mobile', has(/VODAFONE|TELEKOM|TELEFONICA|\bO2\b/)],
  ['fx.rundfunk', has(/RUNDFUNK/)],
  ['fx.electricity', has(/E\.ON|ABSCHLAG \(STROM\)|STADTWERKE/)],
  ['fx.ai', has(/ANTHROPIC|CLAUDE\.AI|OPENAI/)],
  ['fx.uberOne', has(/UBER \.?ONE/)],
  ['fx.bankFee', has(/SALDO DER ABSCHLUSSPOSTEN/)],
  ['v.amazon', has(/AMAZON/)],
  ['v.edeka', has(/EDEKA/)],
  ['v.rewe', has(/REWE/)],
  ['v.lidlAldi', has(/\bLIDL\b|\bALDI\b/)],
  ['v.otherGrocery', has(/KAUFLAND|SUPER K\b|NETTO|PENNY|NORMA\b|TEGUT/)],
  ['v.rossmann', has(/ROSSMANN/)],
  ['v.dm', has(/DM DROGERIE|DM-DROGERIE/)],
  ['v.bakery', has(/BACKSTUBE|B.CKEREI|BAECKEREI|BAKERY/)],
  ['v.butcher', has(/METZGEREI/)],
  ['v.delivery', has(/LIEFERANDO|WOLT|UBER EATS/)],
  ['v.fuel', has(/\bAVIA\b|\bARAL\b|\bESSO\b|\bSHELL\b|\bJET\b|TOTALENERGIES/)],
  ['v.uber', has(/UBER/)],
  ['v.fashion', has(/PRIMARK|TEMU|DEICHMANN|H&M|C&A|SHEIN/)],
  ['v.decathlon', has(/DECATHLON|EINKAUFSCENTER/)],
  ['v.homeOnline', has(/ZALANDO|IKEA/)],
  ['v.pharmacy', has(/APOTHEKE/)],
  ['v.personalCare', has(/ZAHNARZT|ARZTPRAXIS|FRISEUR/)],
  ['v.atm', has(/BARGELDAUSZAHLUNG/)],
  ['v.apple', has(/APPLE\.COM/)],
  ['v.unidentified', (t) => /PAYPAL/.test(t.T) && t.vendor === 'PayPal (no vendor name)'],
  ['v.restaurants', has(/RESTAURANT|RESTORAN|SUSHI|\bCAFE\b|PIZZ|GRILL|BISTRO|KEBAP|DOENER|BURGER|TRATTORIA|OSTERIA|BRAUHAUS/)],
];

export const DEFAULT_SETTINGS = {
  startMonth: null,  // null = earliest month in the data
  vendorRules: {},   // vkey -> lineId (answers from the review screen)
  txRules: {},       // tx id -> lineId (single-booking overrides)
  trips: [],         // [{ name, from, to, scope: 'dining'|'all' }] — spend in these dates gets its own trip line
  flagDismissed: {}, // tx id -> true: large bookings confirmed as regular spend
  profile: null,     // the user's rules file
};
export const emptyProfile = () => ({ app: 'finance-insights-rules', version: 1, lines: [], rules: [], notes: {}, sheetNames: {}, trips: [], startMonth: null });

// ---- effective line catalog = base lines + rules-file lines ----
let LINES = BASE_LINES;
let PROFILE_RULES = { first: [], normal: [] };
let NOTES = {};
let SHEETS = {};
let TRIPS = [];
export const lines = () => LINES;
export const lineNote = (id) => NOTES[id] || '';
export const sheetName = (key, def) => SHEETS[key] || def;

// Rules-file line: { id, sec, label, group, after | before } — relabels a base line or adds a new one.
// Rules-file rule: { line, any:[regex], all:[regex], none:[regex], amount, sign:'+'|'-', months:['YYYY-MM'], first:true }
function compileRule(r) {
  const any = (r.any || []).map((s) => new RegExp(s, 'i'));
  const all = (r.all || []).map((s) => new RegExp(s, 'i'));
  const none = (r.none || []).map((s) => new RegExp(s, 'i'));
  return [r.line, (t) => (!any.length || any.some((re) => re.test(t.text)))
    && all.every((re) => re.test(t.text)) && !none.some((re) => re.test(t.text))
    && (r.amount === undefined || Math.abs(Math.abs(t.amount) - Math.abs(r.amount)) < 0.005)
    && (!r.sign || (r.sign === '+' ? t.amount > 0 : t.amount < 0))
    && (!r.months || r.months.includes(t.date.slice(0, 7)))];
}
export function applyProfile(profile) {
  const p = profile || emptyProfile();
  const out = BASE_LINES.map((l) => ({ ...l }));
  for (const pl0 of p.lines || []) {
    const pl = { ...pl0, id: migrateId(pl0.id) };
    const ex = out.find((l) => l.id === pl.id);
    const { after, before, ...rest } = pl;
    if (ex) { Object.assign(ex, rest); continue; }
    const line = { group: '', ...rest };
    const b = before ? out.findIndex((l) => l.id === before) : -1;
    if (b >= 0) { out.splice(b, 0, line); continue; }
    let idx = after ? out.findIndex((l) => l.id === after) : -1;
    if (idx < 0) out.forEach((l, i) => { if (l.sec === line.sec) idx = i; });
    out.splice(idx + 1, 0, line);
  }
  LINES = out;
  const rules = (p.rules || []).filter((r) => r.line).map((r) => ({ r, c: compileRule(r) }));
  PROFILE_RULES = { first: rules.filter((x) => x.r.first).map((x) => x.c), normal: rules.filter((x) => !x.r.first).map((x) => x.c) };
  NOTES = p.notes || {};
  SHEETS = p.sheetNames || {};
}
applyProfile(null);

// Line ids renamed in earlier versions; old rules files and answers are mapped forward.
const RENAMED = { 'in.transfersIn': 'sv.in', 'tr.family': 'sv.out', 'tr.remit': 'ind.remit' };
export const migrateId = (id) => RENAMED[id] || id;

export function lineLabel(id) {
  if (id && id.startsWith('trip:')) {
    const t = TRIPS.find((x) => x.name === id.slice(5));
    return t && t.scope === 'all' ? `${t.name} trip (all spend)` : `Restaurants & dining (${id.slice(5)} trip)`;
  }
  return (LINES.find((l) => l.id === id) || { label: 'Needs review' }).label;
}
export function lineMeta(id) {
  if (id && id.startsWith('trip:')) {
    const t = TRIPS.find((x) => x.name === id.slice(5));
    return { id, sec: 'variable', label: lineLabel(id), group: t && t.scope === 'all' ? 'Trips' : 'Restaurants & dining' };
  }
  return LINES.find((l) => l.id === id) || null;
}

// Order: single-booking answer > rules-file "first" rules (one-time items, offsets) > your vendor answers
//        > rules-file rules > generic rules.
export function classify(tx, settings) {
  const pick = (raw) => { const id = migrateId(raw); return lineMeta(id) ? applyTrip(id, tx, settings) : null; };
  if (settings.txRules[tx.id]) return pick(settings.txRules[tx.id]);
  const t = { ...tx, T: tx.text.toUpperCase() };
  for (const [id, f] of PROFILE_RULES.first) if (f(t)) return pick(id);
  if (settings.vendorRules[tx.vkey]) return pick(settings.vendorRules[tx.vkey]);
  for (const [id, f] of PROFILE_RULES.normal) if (f(t)) return pick(id);
  for (const [id, f] of GENERIC_RULES) if (f(t)) return pick(id);
  return null;
}
function applyTrip(id, tx, settings) {
  const meta = lineMeta(id);
  if (!meta || meta.sec !== 'variable') return id;
  const d = tx.cardDate || tx.date;
  const trip = (settings.trips || []).find((tr) => d >= tr.from && d <= tr.to && (tr.scope === 'all' || id === 'v.restaurants'));
  return trip ? `trip:${trip.name}` : id;
}

export const monthOf = (iso) => iso.slice(0, 7);
export function monthLabel(m, short = false) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', short ? { month: 'short' } : { month: 'long', year: 'numeric' });
}
const r2 = (v) => Math.round(v * 100) / 100 || 0;
export const deDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

// "first .. last (Nx)" when more than 3 bookings; otherwise list dates, "(x2)" for repeats.
export function dateSummary(dates) {
  const s = [...dates].sort();
  if (!s.length) return '';
  if (s.length > 3) return `${deDate(s[0])} .. ${deDate(s[s.length - 1])} (${s.length}x)`;
  const counts = {};
  for (const d of s) counts[d] = (counts[d] || 0) + 1;
  return Object.entries(counts).map(([d, n]) => deDate(d) + (n > 1 ? ` (x${n})` : '')).join(', ');
}

export function aggregate(txs, settings) {
  applyProfile(settings.profile);
  TRIPS = settings.trips || [];
  const start = settings.startMonth || '0000-00';
  const rows = txs.filter((t) => monthOf(t.date) >= start).map((t) => ({ ...t, line: classify(t, settings) }));
  const months = [...new Set(rows.map((t) => monthOf(t.date)))].sort();
  const cell = {};
  for (const t of rows) {
    const k = `${t.line}|${monthOf(t.date)}`;
    (cell[k] ||= { amt: 0, dates: [], txs: [] });
    cell[k].amt = r2(cell[k].amt + t.amount);
    cell[k].dates.push(t.date);
    cell[k].txs.push(t);
  }
  const used = new Set(rows.map((t) => t.line));
  const order = [];
  const tripIds = [...used].filter((u) => u && u.startsWith('trip:')).sort();
  const lastVar = LINES.reduce((a, l, i) => (l.sec === 'variable' ? i : a), -1);
  LINES.forEach((l, i) => {
    if (used.has(l.id)) order.push(l);
    if (l.id === 'v.restaurants') tripIds.filter((id) => lineMeta(id).group !== 'Trips').forEach((id) => order.push(lineMeta(id)));
    if (i === lastVar) tripIds.filter((id) => lineMeta(id).group === 'Trips').forEach((id) => order.push(lineMeta(id)));
  });
  const bySec = (sec, m) => r2(rows.filter((t) => t.line && lineMeta(t.line).sec === sec && (!m || monthOf(t.date) === m)).reduce((s, t) => s + t.amount, 0));
  const summary = months.map((m) => {
    const earned = bySec('income', m);
    const fixed = -bySec('fixed', m), variable = -bySec('variable', m), onetime = -bySec('onetime', m);
    const spent = r2(fixed + variable + onetime);
    const indiaGross = -bySec('india', m), passThrough = bySec('passthrough', m);
    const india = r2(indiaGross - passThrough);
    const saved = r2(earned - spent - india);
    const toSav = -bySec('tosav', m), fromSav = bySec('fromsav', m);
    const netToSav = r2(toSav - fromSav);
    const inMonth = rows.filter((t) => monthOf(t.date) === m);
    const kept = r2(inMonth.reduce((s, t) => s + t.amount, 0)); // actual balance change, by booking month
    const unassigned = r2(inMonth.filter((t) => !t.line).reduce((s, t) => s + t.amount, 0));
    return { month: m, earned, fixed, variable, onetime, spent, indiaGross, passThrough, india, saved,
      toSav, fromSav, netToSav, kept, unassigned, savingsRate: earned ? saved / earned : 0 };
  });
  const review = rows.filter((t) => !t.line);
  // Possible one-time items: a variable booking far above what is usual for its line.
  const flags = [];
  const byLine = {};
  for (const t of rows) if (t.line && t.amount < 0 && lineMeta(t.line).sec === 'variable') (byLine[t.line] ||= []).push(t);
  for (const ts of Object.values(byLine)) {
    if (ts.length < 3) continue;
    const a = ts.map((t) => -t.amount).sort((x, y) => x - y);
    const median = a[Math.floor(a.length / 2)];
    for (const t of ts) if (-t.amount >= 250 && -t.amount >= 3 * median && !(settings.flagDismissed || {})[t.id] && !settings.txRules[t.id]) flags.push({ ...t, median });
  }
  // Was a top-up actually forwarded to India? Ask when both happen in the same month.
  const passFlags = [];
  for (const m of months) {
    const india = -rows.filter((t) => t.line && lineMeta(t.line).sec === 'india' && monthOf(t.date) === m).reduce((a, t) => a + t.amount, 0);
    if (india <= 0) continue;
    for (const t of rows) if (monthOf(t.date) === m && t.line && lineMeta(t.line).sec === 'fromsav' && t.amount <= india + 0.005
      && !(settings.flagDismissed || {})[t.id] && !settings.txRules[t.id]) passFlags.push({ ...t, india: r2(india) });
  }
  return { rows, months, cell, order, summary, review, flags, passFlags };
}

// Running-balance reconciliation: every statement must tie on its own and chain to the previous one.
export function reconcile(txs, statements) {
  const st = [...statements].sort((a, b) => a.to.localeCompare(b.to));
  return st.map((s, i) => {
    const inRange = txs.filter((t) => t.date >= s.from && t.date <= s.to);
    const debits = r2(inRange.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0));
    const credits = r2(inRange.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0));
    const computed = r2(s.open + debits + credits);
    const prev = st[i - 1];
    return { ...s, debits, credits, computed, diff: r2(computed - s.close), count: inRange.length,
      chainOk: !prev || Math.abs(prev.close - s.open) < 0.005, gapFrom: prev ? prev.to : null };
  });
}
