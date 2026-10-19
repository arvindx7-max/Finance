// I81: entries you type in yourself (cash, card, transfer; expense or income), the cash wallet, and the match with statement bookings.
// An entry is a booking with source 'manual'. It is never removed from storage (the vault merge would bring it back); removing or merging
// it only marks it in settings.manualGone, which syncs like every other answer.
import { $, eur, h, toast, sheet, closeSheet } from './util.js';
import { ask } from './security.js';
import { state, change, recompute } from './state.js';
import { putMany } from './storage.js';
import { markChanged } from './sync.js';
import { normalize } from './parser.js';
import { classify, deDate } from './model.js';
import { lineOptions } from './views.js';

const r2 = (v) => Math.round(v * 100) / 100;
export const isManual = (t) => t.source === 'manual';
export const gone = (id) => !!(state.settings.manualGone || {})[id];
export const waitingFor = (t) => !!(t.manual && t.manual.waiting && !(state.settings.manualKept || {})[t.id]); // still waiting for its statement booking
const dayNo = (iso) => Math.round(Date.parse(iso) / 86400000);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const WAYS = { cash: 'Cash', card: 'Card', transfer: 'Bank transfer' };

// ---------------- the form ----------------
export function entrySheet() {
  const cash = state.settings.cash;
  const html = () => `<h2>Add an entry</h2>
  <p class="fine">Something that is not on a statement (yet): cash, a card payment or a transfer. Card and transfer entries wait for the statement and are matched with it.</p>
  <form class="entryform" data-act="addentry">
    <div class="fgroup">
      <label class="frow"><span>Type</span><select name="dir"><option value="out">Expense</option><option value="in">Income</option></select></label>
      <label class="frow"><span>Paid with</span><select name="way"><option value="cash">Cash</option><option value="card">Card</option><option value="transfer">Bank transfer</option></select></label>
      <label class="frow"><span>Amount (€)</span><input name="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="12,50" required></label>
      <label class="frow"><span>Date</span><input name="date" type="date" value="${today()}" required></label>
      <label class="frow"><span>What or where</span><input name="vendor" type="text" maxlength="60" placeholder="e.g. Test Cafe" required></label>
      <label class="frow"><span>Line</span><select name="line"><option value="">Let the app decide</option>${lineOptions('')}</select></label>
      <label class="frow"><span>Note</span><input name="note" type="text" maxlength="200" placeholder="optional"></label>
      <label class="frow sw" data-atmrow><span>Paid with cash from an ATM withdrawal<small>${cash === 'count' ? 'ATM withdrawals already count as spent, so only cash that did not come from an ATM belongs here.' : 'Leave ticked if the money came out of an ATM. It then comes out of your wallet.'}</small></span><input type="checkbox" class="switch" name="atm" checked${cash === 'count' ? ' disabled' : ''}></label>
    </div>
    <button class="btn primary" type="submit" style="width:100%">Save entry</button>
  </form>`;
  sheet(html(), null);
  syncEntryForm($('.entryform'));
}
export function syncEntryForm(f) {
  if (!f) return;
  const cash = f.way.value === 'cash' && f.dir.value === 'out';
  const row = f.querySelector('[data-atmrow]'); if (row) row.hidden = !cash;
}

// ---------------- saving ----------------
async function askCashRule() {
  const body = `<label class="chk"><input type="radio" name="cash" value="track" checked> <span><b>Track my cash.</b> ATM withdrawals move to a wallet and no longer count as spending. The cash I spend is entered here and counts.</span></label>
    <label class="chk"><input type="radio" name="cash" value="count"> <span><b>Count ATM withdrawals as spent.</b> I do not enter cash spending.</span></label>`;
  const r = await ask({ title: 'How should cash be handled?', text: 'You can change this later in Settings.', ok: 'Continue', cancel: 'Back', body });
  return r ? r.cash : null;
}
export async function saveEntry(fd) {
  const amount = r2(parseFloat(String(fd.get('amount')).replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')));
  const date = String(fd.get('date') || '');
  if (!(amount > 0)) { toast('Enter an amount above zero.'); return; }
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) { toast('Pick a date.'); return; }
  const dir = fd.get('dir') === 'in' ? 1 : -1; const way = fd.get('way') in WAYS ? fd.get('way') : 'cash';
  const vendor = String(fd.get('vendor') || '').trim(); if (!vendor) { toast('Say what or where.'); return; }
  const note = String(fd.get('note') || '').trim(); const line = String(fd.get('line') || '');
  if (way === 'cash' && dir < 0 && state.settings.cash == null) {
    const pick = await askCashRule(); if (!pick) return;
    await change(pick === 'track' ? 'Cash is tracked' : 'ATM withdrawals count as spent', (s) => { s.cash = pick; });
  }
  const atm = way === 'cash' && dir < 0 && state.settings.cash === 'track' && !!fd.get('atm');
  const signed = r2(dir * amount);
  // A card or transfer entry may already be on the statement: ask before counting it twice.
  if (way !== 'cash') {
    const cands = candidates(signed, date, state.tx.filter((t) => !isManual(t) && !gone(t.id)));
    if (cands.length) {
      const pick = await askMatch(`${vendor} · ${deDate(date)} · ${eur(signed)}`, cands, 'This looks like a booking you already have');
      if (pick === undefined) return;
      if (pick) { // the same booking: keep the statement's, carry over the line and note
        await change('Matched with the booking on your statement', (s) => carryOver(s, { line, note }, pick));
        closeSheet(); return;
      }
    }
  }
  const row = {
    ...normalize({ date, valuta: null, amount: signed, type: 'Manual entry', lines: [vendor, 'Verwendungszweck/ Kundenreferenz', note].filter(Boolean), source: 'manual' }),
    id: `m|${date}|${Math.round(Math.abs(signed) * 100)}|${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    manual: { way, atm, waiting: way !== 'cash' },
  };
  await putMany('tx', [row]); state.tx.push(row);
  await change(`Entry saved: ${vendor} ${eur(signed)}`, (s) => { if (line) s.txRules[row.id] = line; if (note) { s.notes ||= {}; s.notes[row.id] = note; } });
  closeSheet();
}
function carryOver(s, from, target) {
  if (from.line && classify(target, s) !== from.line) s.txRules[target.id] = from.line;
  if (from.note) { s.notes ||= {}; if (!s.notes[target.id]) s.notes[target.id] = from.note; }
}

// ---------------- matching with the statement ----------------
export function candidates(amount, date, rows) {
  return rows.filter((t) => Math.abs(t.amount - amount) < 0.005 && Math.abs(dayNo(t.date) - dayNo(date)) <= 7)
    .sort((a, b) => Math.abs(dayNo(a.date) - dayNo(date)) - Math.abs(dayNo(b.date) - dayNo(date)));
}
// Resolves with the chosen booking, null for "Neither: keep separate", undefined when the person goes back.
async function askMatch(what, cands, title) {
  const body = cands.map((c, i) => `<label class="chk"><input type="radio" name="m" value="${i}"${i === 0 ? ' checked' : ''}> <span>${h(c.vendor)} · ${deDate(c.date)} · ${eur(c.amount)}</span></label>`).join('')
    + '<label class="chk"><input type="radio" name="m" value="none"> <span>Neither: keep separate</span></label>';
  const r = await ask({ title, text: `${what}. Is it one of these? It is then counted once.`, ok: 'Continue', cancel: 'Back', body });
  if (!r) return undefined;
  return r.m === 'none' ? null : cands[+r.m];
}
// After an import: entries that were waiting for a statement meet the new bookings. One match is merged at once; when two fit, you pick.
export async function matchWaiting(added) {
  const waiting = state.tx.filter((t) => isManual(t) && waitingFor(t) && !gone(t.id));
  const fresh = added.filter((t) => !isManual(t));
  if (!waiting.length || !fresh.length) return null;
  const opts = new Map(waiting.map((w) => [w.id, candidates(w.amount, w.date, fresh)])).entries();
  const options = [...opts].filter(([, c]) => c.length);
  if (!options.length) return null;
  const claimants = new Map(); for (const [, cs] of options) for (const c of cs) claimants.set(c.id, (claimants.get(c.id) || 0) + 1);
  const pairs = []; const taken = new Set(); const keep = [];
  for (const [wid, cs] of options) {
    const w = waiting.find((x) => x.id === wid);
    const free = cs.filter((c) => !taken.has(c.id));
    if (free.length === 1 && claimants.get(free[0].id) === 1) { pairs.push([w, free[0]]); taken.add(free[0].id); continue; }
    if (!free.length) continue;
    const pick = await askMatch(`${w.vendor} · ${deDate(w.date)} · ${eur(w.amount)} was waiting for its statement booking`, free, 'Which booking is yours?');
    if (pick) { pairs.push([w, pick]); taken.add(pick.id); } else if (pick === null) keep.push(w.id);
  }
  const kept = keep.length;
  if (!pairs.length && !kept) return null;
  // "Keep separate" and "matched" are both answers in the settings, so they sync to your other devices.
  await change(pairs.length ? `${pairs.length} entr${pairs.length === 1 ? 'y' : 'ies'} matched with the statement` : 'Entries kept separate', (s) => {
    s.manualGone ||= {}; s.manualKept ||= {};
    for (const id of keep) s.manualKept[id] = true;
    for (const [w, c] of pairs) { carryOver(s, { line: classify(w, s), note: (s.notes || {})[w.id] || '' }, c); s.manualGone[w.id] = true; }
  });
  return `${pairs.length} entr${pairs.length === 1 ? 'y' : 'ies'} you typed in matched with statement bookings${kept ? `, ${kept} kept separate` : ''}`;
}

// ---------------- removing ----------------
export async function removeEntry(id) {
  const t = state.tx.find((x) => x.id === id); if (!t || !isManual(t)) return;
  const yes = await ask({ title: 'Remove this entry?', text: `${t.vendor} · ${deDate(t.date)} · ${eur(t.amount)}. Statement bookings are not touched.`, ok: 'Remove', danger: true });
  if (!yes) return;
  closeSheet();
  await change('Entry removed', (s) => { (s.manualGone ||= {})[id] = true; });
}

// ---------------- the wallet ----------------
export function wallet() {
  const rows = state.agg.rows;
  const withdrawn = r2(rows.filter((t) => t.line === 'cash.wallet').reduce((a, t) => a - t.amount, 0));
  const spent = r2(rows.filter((t) => isManual(t) && t.manual && t.manual.atm && t.amount < 0).reduce((a, t) => a - t.amount, 0));
  return { withdrawn, spent, rest: r2(withdrawn - spent) };
}
export async function countRest() {
  const w = wallet(); if (w.rest <= 0.004) return;
  const last = state.agg.rows.filter((t) => !isManual(t)).map((t) => t.date).sort().pop() || today();
  const row = {
    ...normalize({ date: last, valuta: null, amount: -w.rest, type: 'Manual entry', lines: ['Cash not tracked', 'Verwendungszweck/ Kundenreferenz'], source: 'manual' }),
    id: `m|${last}|${Math.round(w.rest * 100)}|rest${Date.now().toString(36)}`, manual: { way: 'cash', atm: true, waiting: false, rest: true },
  };
  await putMany('tx', [row]); state.tx.push(row);
  await change(`The rest of your wallet (${eur(w.rest)}) is counted as spent`, (s) => { s.txRules[row.id] = 'v.other'; });
}
export function walletCard() {
  const s = state.settings; if (s.cash !== 'track') return '';
  const w = wallet(); if (!w.withdrawn && !w.spent) return '';
  return `<section class="card walletcard"><h2>Cash wallet</h2>
    <p class="fine">ATM withdrawals move to your wallet. The cash you spend and enter counts as spending.</p>
    <ul class="kv"><li><span>Withdrawn at ATMs</span><b>${eur(w.withdrawn)}</b></li><li><span>Cash spending you entered</span><b>${eur(w.spent)}</b></li>
    <li><span>${w.rest < 0 ? 'Entered more than withdrawn' : 'Left in the wallet'}</span><b>${eur(Math.abs(w.rest))}</b></li></ul>
    ${w.rest > 0.004 ? `<button class="btn" data-act="countrest">Count the rest as spent</button>` : ''}</section>`;
}
export function cashCard() {
  const s = state.settings;
  return `<section class="card"><h2>Cash and your own entries</h2>
    <label class="frow sw"><span>Track my cash<small>ATM withdrawals move to a wallet and no longer count as spending. The cash you spend is entered with the + button and counts instead.${s.cash == null ? ' Not chosen yet; you are asked at your first cash entry.' : ''}</small></span><input type="checkbox" class="switch" data-cashtrack${s.cash === 'track' ? ' checked' : ''}></label>
    <button class="btn" data-act="addentry">Add an entry</button></section>`;
}
export const entryTag = (t) => (isManual(t) ? ` · entered by you${waitingFor(t) ? ' · waiting for statement' : ''}` : '');
