// Demo mode (v20, I65): shows made-up data so the app can be shown to others. Nothing real is read, shown or kept.
// Start: with app lock on, your data is already encrypted (nothing more to do). With app lock off, it is encrypted
// with your vault passphrase first and the plain copy is removed. Exit: Face ID / Touch ID, or the vault passphrase.
// Every value below comes from the mock data ledger in CLAUDE.md (made-up vendors, ledger amounts, only the 1st and 15th).
import { parseCsv } from './parser.js';
import { mergeRows } from './io.js';
import * as C from './cloud.js';
import * as L from './lock.js';
import { all, kvGet, lock, rawClear, rawDel, rawPut, sealAll } from './storage.js';
import { cloud } from './sync.js';
import { fresh } from './state.js';

export const DEMO_MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const IBAN = 'DE00 0000 0000 0000 0000 00';
const HEAD = 'Buchungstag;Wert;Umsatzart;Begünstigter / Auftraggeber;Verwendungszweck;IBAN;BIC;Kundenreferenz;Mandatsreferenz;Gläubiger ID;Fremde Gebühren;Betrag;Abweichender Empfänger;Anzahl der Aufträge;Anzahl der Schecks;Soll;Haben;Währung';
const de = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const row = (date, type, cp, purpose, amount) => ['', '', type, cp, purpose, IBAN, '', '', '', '', '', de(amount), '', '', '', '', '', 'EUR'].map((x, i) => (i < 2 ? date : x)).join(';');
function bookings(m) {
  const b = []; const none = ['2026-06', '2026-07'].includes(m);
  if (!none) b.push(['01', 'Lohn/Gehalt', 'TEST EMPLOYER GMBH', 'TEST SALARY', 2345.67]);
  b.push(['01', 'Dauerauftrag', 'Shop B', 'RENT', -1500]);
  b.push(['01', 'Kartenzahlung', 'Test Supermarket', 'Test Supermarket', -45.9]);
  b.push(['15', 'Kartenzahlung', 'Test Supermarket', 'Test Supermarket', -45.9]);
  b.push(['15', 'Kartenzahlung', 'Test Fuel Station', 'Test Fuel Station', -45.9]);
  b.push(['01', 'Kartenzahlung', 'Test Cafe', 'Test Cafe', -12.5]);
  b.push(['15', 'Kartenzahlung', 'Test Cafe', 'Test Cafe', -12.5]);
  if (['2026-05', '2026-07'].includes(m)) b.push(['15', 'Kartenzahlung', 'Test Online Store', 'Test Online Store', -45.9]);
  if (m === '2026-04') b.push(['15', 'Überweisung', 'Savings Test Account', 'Savings Test Account', -100]);
  if (m === '2026-06') b.push(['15', 'Überweisung', 'Savings Test Account', 'Savings Test Account', 1500]);
  if (['2026-03', '2026-04', '2026-09'].includes(m)) b.push(['15', 'Überweisung', 'Example Remit Ltd', 'Example Remit Ltd', -100]);
  if (m === '2026-09') b.push(['15', 'Kartenzahlung', 'Shop A', 'Shop A', -12.5]); // waits in Review, so the demo can show it
  return b;
}
const demoCsv = () => {
  const out = ['Umsatzliste;;;', `Konto;${IBAN};;`, '', HEAD];
  for (const m of DEMO_MONTHS) for (const [d, type, cp, purpose, a] of bookings(m)) out.push(row(`${d}.${m.slice(5)}.${m.slice(0, 4)}`, type, cp, purpose, a));
  return out.join('\n') + '\n';
};
export function demoData() {
  const { added } = mergeRows([], parseCsv(demoCsv()).rows);
  const settings = fresh();
  settings.profile = {
    app: 'finance-insights-rules', version: 1, catalog: 2, lines: [], notes: {}, sheetNames: {}, trips: [], startMonth: null,
    rules: [
      { line: 'v.otherGrocery', any: ['TEST SUPERMARKET'] }, { line: 'v.fuel', any: ['TEST FUEL STATION'] },
      { line: 'ot.other', any: ['TEST ONLINE STORE'], first: true }, { line: 'ab.transfer', any: ['EXAMPLE REMIT LTD'], sign: '-' },
      { line: 'sv.out', any: ['SAVINGS TEST ACCOUNT'], sign: '-' }, { line: 'sv.in', any: ['SAVINGS TEST ACCOUNT'], sign: '+' },
    ],
  };
  return { tx: added, statements: [], settings };
}

// What is stored under the passphrase while the demo runs (everything personal that is kept on this device).
const KV_SEALED = ['settings', 'settingsBackup', 'undo', 'lastBackup', 'cloud'];
const PURGE = [...KV_SEALED, 'cloudKey', 'gtoken']; // the Google sign-in and the remembered vault key are dropped: sign in again after the demo
export const demoState = async () => kvGet('demo', null);

export async function checkPassphrase(pass) {
  if (!cloud.meta || !cloud.meta.fileId || !cloud.key) throw new Error('Unlock your vault in Data first (cloud sync), so the demo can be protected with your vault passphrase.');
  const vk = await C.deriveKey(pass, cloud.meta.salt, cloud.meta.iter || 310000, true);
  const probe = await C.seal({ ok: 1 }, cloud.key, cloud.meta.salt);
  await C.unseal(probe, vk).catch(() => { throw new Error("That passphrase doesn't open your vault."); });
}
async function purge() {
  await rawClear('tx'); await rawClear('statements');
  for (const k of PURGE) await rawDel(k);
}
// pass: only needed with app lock off.
export async function startDemo(pass) {
  if (lock.on) { await sealAll(); await rawDel('gtoken'); await rawPut('kv', [{ k: 'demo', v: { mode: 'lock' } }]); return; }
  await checkPassphrase(pass);
  const kv = {}; for (const k of KV_SEALED) kv[k] = await kvGet(k, null);
  const salt = C.newSalt(); const key = await C.deriveKey(pass, salt);
  const vault = await C.seal({ tx: await all('tx'), statements: await all('statements'), kv }, key, salt);
  await rawPut('kv', [{ k: 'demoVault', v: vault }, { k: 'demo', v: { mode: 'pass', pending: true } }]); // data is safe before anything is removed
  await purge();
  await rawPut('kv', [{ k: 'demo', v: { mode: 'pass' } }]);
}
// The page was closed half-way through starting: finish removing the plain copy.
export async function finishStart(d) { if (d && d.pending) { await purge(); await rawPut('kv', [{ k: 'demo', v: { mode: d.mode } }]); } }
// Exit with the vault passphrase (app lock off). Wrong passphrase: nothing changes.
export async function exitWithPassphrase(pass) {
  const vault = await kvGet('demoVault', null); if (!vault) throw new Error('No protected data found.');
  const salt = JSON.parse(vault).salt; const iter = JSON.parse(vault).iter;
  const d = await C.unseal(vault, await C.deriveKey(pass, salt, iter)).catch(() => { throw new Error("That passphrase doesn't open your data."); });
  await rawPut('tx', d.tx); await rawPut('statements', d.statements);
  await rawPut('kv', Object.entries(d.kv).filter(([, v]) => v !== null).map(([k, v]) => ({ k, v })));
  await rawDel('demoVault'); await rawDel('demo');
}
// Exit with Face ID / Touch ID (app lock on): the data was never unsealed, so only proof that it is you is needed.
export async function exitWithBiometrics() {
  const meta = await kvGet('lockMeta', null); if (!meta) throw new Error('App lock is not set up.');
  await L.unlock(meta); await rawDel('demo');
}
// Locked screen: "Show demo". Nothing is unsealed.
export async function startDemoLocked() { await rawDel('gtoken'); await rawPut('kv', [{ k: 'demo', v: { mode: 'lock' } }]); }
// Used by "Use my passphrase instead" while in demo: the lock fallback wipes the device, so the demo flag goes too.
export const clearDemoFlag = async () => { await rawDel('demo'); await rawDel('demoVault'); };
