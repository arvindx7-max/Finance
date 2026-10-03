// On-device storage (IndexedDB), and the encrypted blob used when app lock is on.
import * as L from './lock.js';
import { state, undo } from './state.js';
import { live } from './sync.js';
// ---------------- storage (IndexedDB) ----------------
export const DB_NAME = 'finance-insights';
export let dbp;
export function db() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('tx', { keyPath: 'id' });
      d.createObjectStore('statements', { keyPath: 'id' });
      d.createObjectStore('kv', { keyPath: 'k' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
export async function all(store) { const d = await db(); return new Promise((res, rej) => { const q = d.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
export async function rawPut(store, items) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'); const s = t.objectStore(store); items.forEach((i) => s.put(i)); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
export async function rawClear(store) { const d = await db(); return new Promise((res) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).clear(); t.oncomplete = res; }); }
export async function rawDel(k) { const d = await db(); return new Promise((res) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; }); }
export async function kvGet(k, def) { const d = await db(); return new Promise((res) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result ? q.result.v : def); q.onerror = () => res(def); }); }
// With app lock on, bookings, statements, settings and the vault key never touch storage in the clear:
// they live in memory and are written as one encrypted blob (see sealAll).
export const lock = { on: false, key: null, meta: null, vaultRaw: null };
export const SEALED_KV = new Set(['settings', 'undo', 'lastBackup', 'cloudKey']);
export async function putMany(store, items) {
  if (lock.on && (store !== 'kv' || items.every((i) => SEALED_KV.has(i.k)))) { scheduleSeal(); return; }
  return rawPut(store, items);
}
export async function clear(store) { if (lock.on && store !== 'kv') { scheduleSeal(); return; } return rawClear(store); }
export const kvSet = (k, v) => putMany('kv', [{ k, v }]);
export let sealTimer;
export function scheduleSeal() { clearTimeout(sealTimer); sealTimer = setTimeout(sealAll, 250); }
export async function sealAll() {
  clearTimeout(sealTimer);
  if (!lock.on || !lock.key) return;
  const blob = await L.seal({ tx: state.tx, statements: state.statements, settings: state.settings, undo: state.undo, lastBackup: state.lastBackup, vaultRaw: lock.vaultRaw }, lock.key);
  await rawPut('kv', [{ k: 'sealed', v: blob }]);
}

