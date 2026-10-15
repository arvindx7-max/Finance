// Categorisation and aggregation. Totals are always computed from stored transactions.
// This file holds ONLY a neutral starter catalog and generic rules. Anything personal (names, customer
// numbers, shops, services, benefits, trips, specific amounts) lives in the user's private rules file,
// which is stored on the device and in the encrypted vault.

export const SECTIONS = {
  income: 'Earned income', fixed: 'Fixed / recurring', variable: 'Variable expenses', onetime: 'One-time items',
  abroad: 'Transfers abroad', passthrough: 'Forwarded transfers',
  tosav: 'Moved to savings', fromsav: 'Top-ups from savings', offset: 'Offsetting pairs',
};
// Sections a user can pick when creating a new line.
export const USER_SECTIONS = ['fixed', 'variable', 'onetime', 'income', 'abroad', 'tosav', 'fromsav'];

const L = (id, sec, label, group = '') => ({ id, sec, label, group });
// Neutral starter catalog: no shop, brand or service names. A rules file can relabel these,
// regroup them, or add new lines (shops, services and so on live in the user's private rules file).
export const BASE_LINES = [
  L('fx.rent', 'fixed', 'Rent'),
  L('fx.rundfunk', 'fixed', 'Broadcast fee'),
  L('fx.mobile', 'fixed', 'Mobile phone'),
  L('fx.internet', 'fixed', 'Internet'),
  L('fx.subscription', 'fixed', 'Subscriptions'),
  L('fx.electricity', 'fixed', 'Electricity'),
  L('fx.lifeIns', 'fixed', 'Life insurance'),
  L('fx.insurance', 'fixed', 'Insurance'),
  L('fx.transitAbo', 'fixed', 'Transport subscription'),
  L('fx.transitExtra', 'fixed', 'Transport extras'),
  L('fx.canteen', 'fixed', 'Canteen / lunch card'),
  L('fx.bankFee', 'fixed', 'Bank fee'),
  L('fx.other', 'fixed', 'Other recurring'),

  L('v.otherGrocery', 'variable', 'Groceries', 'Supermarkets'),
  L('v.drugstore', 'variable', 'Drugstore', 'Drugstore'),
  L('v.bakery', 'variable', 'Bakery', 'Bakery & butcher'),
  L('v.butcher', 'variable', 'Butcher', 'Bakery & butcher'),
  L('v.restaurants', 'variable', 'Restaurants & dining', 'Restaurants & dining'),
  L('v.delivery', 'variable', 'Food delivery', 'Restaurants & dining'),
  L('v.fuel', 'variable', 'Fuel', 'Transport & fuel'),
  L('v.rides', 'variable', 'Rides', 'Transport & fuel'),
  L('v.online', 'variable', 'Online shopping', 'Online & shopping'),
  L('v.fashion', 'variable', 'Fashion', 'Online & shopping'),
  L('v.pharmacy', 'variable', 'Pharmacy', 'Health & personal care'),
  L('v.personalCare', 'variable', 'Doctor / dentist / salon', 'Health & personal care'),
  L('v.fitnessCleaning', 'variable', 'Fitness / cleaning', 'Health & personal care'),
  L('v.atm', 'variable', 'ATM cash', 'Cash'),
  L('v.unidentified', 'variable', 'Unidentified payment', 'Subscriptions & other'),
  L('v.other', 'variable', 'Other variable', 'Subscriptions & other'),

  L('ot.other', 'onetime', 'Other one-time'),

  L('in.salary', 'income', 'Monthly salary', 'Salary'),
  L('in.employerOther', 'income', 'Employer credit (non-salary)', 'Other income'),
  L('in.cash', 'income', 'Cash deposits', 'Other income'),
  L('in.benefit', 'income', 'Child benefit', 'Benefits'),

  L('ab.transfer', 'abroad', 'Transfer abroad', 'Transfers abroad'),
  L('pt.in', 'passthrough', 'Received to forward', 'Transfers abroad'),
  L('pt.sav', 'passthrough', 'From savings, forwarded', 'Transfers abroad'),
  L('sv.out', 'tosav', 'Moved to savings account', 'Savings movements'),
  L('sv.in', 'fromsav', 'Top-up from savings account', 'Savings movements'),

  L('off.other', 'offset', 'Offsetting pair'),
];

// Generic rules only: words that describe the kind of booking, never a particular shop or provider.
const has = (re) => (t) => re.test(t.T);
export const GENERIC_RULES = [
  ['in.salary', (t) => t.amount > 0 && /SALA LOHN\/GEHALT|LOHN, GEHALT|LOHN\/GEHALT/.test(t.T)],
  ['in.cash', (t) => t.amount > 0 && /BAREINZAHLUNG/.test(t.T)],
  ['fx.rent', (t) => t.amount < 0 && /DAUERAUFTRAG/.test(t.T) && /MIETE|RENT/.test(t.T)],
  ['fx.lifeIns', has(/LEBENSVERSICHERUNG/)],
  ['fx.insurance', has(/VERSICHERUNG|INSURANCE/)],
  ['fx.rundfunk', has(/RUNDFUNK/)],
  ['fx.electricity', has(/ABSCHLAG \(STROM\)/)],
  ['fx.bankFee', has(/SALDO DER ABSCHLUSSPOSTEN/)],
  ['v.bakery', has(/BACKSTUBE|B.CKEREI|BAECKEREI|BAKERY/)],
  ['v.butcher', has(/METZGEREI/)],
  ['v.pharmacy', has(/APOTHEKE/)],
  ['v.personalCare', has(/ZAHNARZT|ARZTPRAXIS|FRISEUR/)],
  ['v.atm', has(/BARGELDAUSZAHLUNG/)],
  ['v.restaurants', has(/RESTAURANT|RESTORAN|SUSHI|\bCAFE\b|PIZZ|GRILL|BISTRO|KEBAP|DOENER|BURGER|TRATTORIA|OSTERIA|BRAUHAUS/)],
];

export const DEFAULT_SETTINGS = {
  startMonth: null,  // null = earliest month in the data
  vendorRules: {},   // vkey -> lineId (answers from the review screen)
  txRules: {},       // tx id -> lineId (single-booking overrides)
  trips: [],         // [{ name, from, to, scope: 'dining'|'all' }] — spend in these dates gets its own trip line
  flagDismissed: {}, // tx id -> true: large bookings confirmed as regular spend
  notes: {},         // tx id -> your note on that booking
  budgets: {},       // variable group -> monthly budget in €
  goal: null,        // { year, amount } yearly savings goal
  savingsStart: null, // { month, amount }: savings account balance at the start of that month (for the estimate)
  skipEmptyMonths: true, // Months: skip month columns with nothing in the section being viewed (Data tab switch)
  profile: null,     // the user's rules file
};
// catalog 2 = made for the neutral starter catalog (v19.1 and later).
export const CATALOG = 2;
export const emptyProfile = () => ({ app: 'finance-insights-rules', version: 1, catalog: CATALOG, lines: [], rules: [], notes: {}, sheetNames: {}, trips: [], startMonth: null });

// ---- effective line catalog = base lines + rules-file lines ----
let LINES = BASE_LINES;
let LINE_MAP = new Map(BASE_LINES.map((l) => [l.id, l]));
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
    if (pl.sec) pl.sec = migrateSec(pl.sec);
    const ex = out.find((l) => l.id === pl.id);
    const { after, before, ...rest } = pl;
    if (ex) { Object.assign(ex, rest); continue; }
    const line = { group: '', ...rest };
    const b = before ? out.findIndex((l) => l.id === before) : -1;
    if (b >= 0) { out.splice(b, 0, line); continue; }
    let idx = after ? out.findIndex((l) => l.id === after) : -1;
    // A new line joins the end of its own group (e.g. Supermarkets), else the end of its section.
    if (idx < 0 && line.group) out.forEach((l, i) => { if (l.sec === line.sec && l.group === line.group) idx = i; });
    if (idx < 0) out.forEach((l, i) => { if (l.sec === line.sec) idx = i; });
    out.splice(idx + 1, 0, line);
  }
  LINES = out;
  LINE_MAP = new Map(out.map((l) => [l.id, l]));
  const rules = (p.rules || []).filter((r) => r.line).map((r) => ({ r, c: compileRule(r) }));
  PROFILE_RULES = { first: rules.filter((x) => x.r.first).map((x) => x.c), normal: rules.filter((x) => !x.r.first).map((x) => x.c) };
  NOTES = p.notes || {};
  SHEETS = p.sheetNames || {};
}
applyProfile(null);

// Line ids renamed in earlier versions; old rules files and answers are mapped forward.
const RENAMED = { 'in.transfersIn': 'sv.in', 'tr.family': 'sv.out', 'tr.remit': 'ab.transfer', 'ind.remit': 'ab.transfer' };
// A section that no longer exists (older versions had a differently named transfers section) is folded into Transfers abroad.
export const migrateSec = (sec) => (SECTIONS[sec] ? sec : 'abroad');
export const migrateId = (id) => RENAMED[id] || id;

// One-time conversion (v19.1): older answers, rules and lines are moved to the neutral ids and sections.
// Pure function: returns { settings, changed }. The caller keeps a backup of the old settings first.
export function migrateSettings(settings) {
  const s = JSON.parse(JSON.stringify(settings || {}));
  let changed = false;
  const mv = (id) => { const n = migrateId(id); if (n !== id) changed = true; return n; };
  for (const k of ['vendorRules', 'txRules']) for (const key of Object.keys(s[k] || {})) s[k][key] = mv(s[k][key]);
  if (s.profile) {
    for (const l of s.profile.lines || []) { l.id = mv(l.id); if (l.sec && migrateSec(l.sec) !== l.sec) { l.sec = migrateSec(l.sec); changed = true; } }
    for (const r of s.profile.rules || []) if (r.line) r.line = mv(r.line);
  }
  return { settings: s, changed };
}

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
  return LINE_MAP.get(id) || null;
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
  // One pass over the bookings: sums per section and month, plus each month's balance change.
  const acc = new Map(); const add = (k, v) => acc.set(k, (acc.get(k) || 0) + v);
  // Pass-through money counts as "from savings" when marked so, or when it comes from the same sender as savings transfers.
  const savSenders = new Set(rows.filter((t) => t.line && ['tosav', 'fromsav'].includes(lineMeta(t.line).sec)).map((t) => t.vkey));
  for (const t of rows) {
    const m = monthOf(t.date); add(`kept|${m}`, t.amount);
    if (!t.line) { add(`none|${m}`, t.amount); continue; }
    const sec = lineMeta(t.line).sec; add(`${sec}|${m}`, t.amount);
    if (sec === 'passthrough' && (t.line === 'pt.sav' || savSenders.has(t.vkey))) add(`ptsav|${m}`, t.amount);
  }
  const bySec = (sec, m) => r2(acc.get(`${sec}|${m}`) || 0);
  const summary = months.map((m) => {
    const earned = bySec('income', m);
    const fixed = -bySec('fixed', m), variable = -bySec('variable', m), onetime = -bySec('onetime', m);
    const spent = r2(fixed + variable + onetime);
    const abroadGross = -bySec('abroad', m), passThrough = bySec('passthrough', m);
    const abroad = r2(abroadGross - passThrough);
    const saved = r2(earned - spent - abroad);
    const toSav = -bySec('tosav', m), fromSav = bySec('fromsav', m);
    const netToSav = r2(toSav - fromSav);
    const passThroughSav = r2(acc.get(`ptsav|${m}`) || 0);
    const kept = r2(acc.get(`kept|${m}`) || 0); // actual balance change, by booking month
    const unassigned = r2(acc.get(`none|${m}`) || 0);
    return { month: m, earned, fixed, variable, onetime, spent, abroadGross, passThrough, abroad, saved,
      toSav, fromSav, netToSav, passThroughSav, kept,
      // never negative (B43): each month either keeps money or draws on the earlier balance; same for savings transfers
      keptIn: r2(Math.max(0, kept)), fromBalance: r2(Math.max(0, -kept)), movedIn: r2(Math.max(0, netToSav)), takenBack: r2(Math.max(0, -netToSav)), unassigned, savingsRate: earned ? saved / earned : 0 };
  });
  // B55: answers and rules that point to lines this catalog does not have (they come from the private rules file).
  // Their bookings are kept apart from new vendors, so nothing is answered twice before the rules file is loaded.
  const known = (id) => String(id).startsWith('trip:') || !!lineMeta(migrateId(id));
  const live = (o) => Object.values(o || {}).filter((v) => v !== null && v !== undefined);
  const orphanRules = ((settings.profile && settings.profile.rules) || []).filter((r) => r.line && !known(r.line)).map((r) => compileRule(r)[1]);
  const orphanCount = live(settings.vendorRules).filter((v) => !known(v)).length + live(settings.txRules).filter((v) => !known(v)).length + orphanRules.length;
  const isOrphan = (t) => (settings.txRules[t.id] != null && !known(settings.txRules[t.id]))
    || (settings.vendorRules[t.vkey] != null && !known(settings.vendorRules[t.vkey]))
    || orphanRules.some((f) => f({ ...t, T: t.text.toUpperCase() }));
  const unknownLine = rows.filter((t) => !t.line && isOrphan(t));
  // A rules file from before the neutral catalog still relies on lines and matchers that are no longer built in.
  const p0 = settings.profile;
  const oldRulesFile = !!p0 && p0.catalog !== CATALOG && ((p0.rules || []).some((r) => !r.mine) || (p0.lines || []).some((l) => !String(l.id).startsWith('c.')));
  const review = rows.filter((t) => !t.line && !isOrphan(t));
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
  // Was a top-up actually forwarded abroad? Ask when both happen in the same month.
  const passFlags = [];
  for (const m of months) {
    const abroad = -rows.filter((t) => t.line && lineMeta(t.line).sec === 'abroad' && monthOf(t.date) === m).reduce((a, t) => a + t.amount, 0);
    if (abroad <= 0) continue;
    for (const t of rows) if (monthOf(t.date) === m && t.line && lineMeta(t.line).sec === 'fromsav' && t.amount <= abroad + 0.005
      && !(settings.flagDismissed || {})[t.id] && !settings.txRules[t.id]) passFlags.push({ ...t, abroad: r2(abroad) });
  }
  return { rows, months, cell, order, summary, review, unknownLine, orphanCount, oldRulesFile, flags, passFlags };
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
