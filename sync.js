// Merging between devices and the encrypted Google Drive vault.
import * as C from './cloud.js';
import { $, h } from './util.js';
import { clear, kvGet, kvSet, lock, putMany } from './storage.js';
import { change, fresh, recompute, saveSettings, state } from './state.js';
import { render } from './views.js';
// ---------------- change timestamps (so two devices can merge) ----------------
export const MAPS = [['vendorRules', 'v'], ['txRules', 't'], ['flagDismissed', 'f'], ['notes', 'n']];
export const WHOLE = ['profile', 'trips', 'startMonth', 'budgets', 'goal', 'savingsStart'];
export const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// Removed answers are kept as null so the removal itself can sync.
export function stampDiff(before, after) {
  const now = Date.now(); after.stamps = { ...(before.stamps || {}), ...(after.stamps || {}) };
  for (const [m, p] of MAPS) {
    const b = before[m] || {}; const a = (after[m] ||= {});
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (!(k in a)) a[k] = null;
      if (!same(b[k], a[k])) after.stamps[`${p}:${k}`] = now;
    }
  }
  for (const w of WHOLE) if (!same(before[w], after[w])) after.stamps[w] = now;
}
export const live = (obj) => Object.entries(obj || {}).filter(([, v]) => v !== null && v !== undefined);
// Newer change wins. With no change dates on either side (data from before dates existed),
// real data beats an empty default, and otherwise the shared vault wins over this device.
export const isEmpty = (v) => v === null || v === undefined || (Array.isArray(v) ? !v.length : typeof v === 'object' && !Object.keys(v).length);
export function mergeSettings(l, r) {
  const out = { ...fresh(), ...r, ...l, stamps: {} };
  const st = (s, k) => (s.stamps || {})[k] || 0;
  const pick = (k, lv, rv) => {
    const ls = st(l, k), rs = st(r, k); out.stamps[k] = Math.max(ls, rs);
    if (rs !== ls) return rs > ls ? rv : lv;
    if (isEmpty(lv) !== isEmpty(rv)) return isEmpty(lv) ? rv : lv;
    return rv === undefined ? lv : rv;
  };
  for (const [m, p] of MAPS) {
    out[m] = {}; const L = l[m] || {}, R = r[m] || {};
    for (const k of new Set([...Object.keys(L), ...Object.keys(R)])) out[m][k] = pick(`${p}:${k}`, L[k], R[k]) ?? null;
  }
  for (const w of WHOLE) out[w] = pick(w, l[w], r[w]);
  return out;
}
// Bookings: same id = same booking; otherwise matched by date + amount + vendor, count for count.
export function mergeTx(local, remote) {
  const ids = new Set(local.map((t) => t.id)); const key = (t) => `${t.date}|${t.amount}|${t.vkey}`;
  const lc = {}; for (const t of local) lc[key(t)] = (lc[key(t)] || 0) + 1;
  const groups = {}; for (const t of remote) (groups[key(t)] ||= []).push(t);
  const add = [];
  for (const [k, rs] of Object.entries(groups)) {
    let room = rs.length - (lc[k] || 0);
    for (const t of rs) { if (room <= 0) break; if (ids.has(t.id)) continue; add.push(t); ids.add(t.id); room--; }
  }
  return [...local, ...add];
}

// ---------------- cloud sync (Google Drive, encrypted) ----------------
export const cfg = window.FIN_CONFIG || {};
export const cloud = { meta: null, key: null, token: null, status: 'off', msg: '', busy: false, dirty: false, rev: 0 };
export const cloudReady = () => !!cfg.googleClientId;
export const tokenOk = () => cloud.token && cloud.token.exp > Date.now();
export async function loadCloud() {
  cloud.meta = await kvGet('cloud', null);
  cloud.key = await kvGet('cloudKey', null);
  cloud.token = await kvGet('gtoken', null);
  cloud.dirty = !!(cloud.meta && cloud.meta.dirty);
  refreshStatus();
}
export function refreshStatus() {
  if (!cloudReady()) cloud.status = 'off';
  else if (!cloud.meta || !cloud.meta.fileId) cloud.status = tokenOk() ? 'novault' : 'signedout';
  else if (!cloud.key) cloud.status = 'locked';
  else if (!tokenOk()) cloud.status = 'signin';
  else if (cloud.status !== 'error' && cloud.status !== 'syncing') cloud.status = 'synced';
}
export const saveCloudMeta = () => kvSet('cloud', { ...cloud.meta, dirty: cloud.dirty });
export const statePayload = () => ({ tx: state.tx, statements: state.statements, settings: state.settings });
export async function persistAll() {
  await clear('tx'); await putMany('tx', state.tx);
  await clear('statements'); await putMany('statements', state.statements);
  await saveSettings();
}
// Pull the vault, merge it into this device, push the result back if anything here was new.
export async function syncNow(quiet = false) {
  refreshStatus();
  if (cloud.status !== 'synced' || cloud.busy) { if (!quiet) render(); return; }
  cloud.busy = true; cloud.status = 'syncing'; if (!quiet) render(); setPill();
  const startRev = cloud.rev; // changes made while this sync runs are picked up by a follow-up sync
  try {
    const m = await C.fileMeta(cloud.token.token, cloud.meta.fileId);
    let remote = null;
    if (m.modifiedTime !== cloud.meta.remoteModified) remote = await C.unseal(await C.download(cloud.token.token, cloud.meta.fileId), cloud.key);
    let changedHere = cloud.dirty;
    if (remote) {
      const before = JSON.stringify(statePayload());
      state.tx = mergeTx(state.tx, remote.tx || []);
      const ids = new Set(state.statements.map((s) => s.id));
      state.statements = [...state.statements, ...(remote.statements || []).filter((s) => !ids.has(s.id))];
      state.settings = mergeSettings(state.settings, remote.settings || {});
      await persistAll(); recompute();
      const after = JSON.stringify(statePayload());
      const remoteJson = JSON.stringify({ tx: remote.tx, statements: remote.statements, settings: remote.settings });
      changedHere = changedHere || (after !== remoteJson && after !== before) || state.tx.length !== (remote.tx || []).length;
      cloud.meta.remoteModified = m.modifiedTime;
    }
    if (changedHere || !remote && cloud.dirty) {
      const res = await C.updateVault(cloud.token.token, cloud.meta.fileId, await C.seal(statePayload(), cloud.key, cloud.meta.salt, cloud.meta.iter));
      cloud.meta.remoteModified = res.modifiedTime;
    }
    cloud.dirty = cloud.rev !== startRev; cloud.meta.lastSync = new Date().toISOString(); await saveCloudMeta();
    cloud.status = 'synced'; cloud.msg = '';
  } catch (e) {
    if (e.code === 401) { cloud.token = null; await kvSet('gtoken', null); }
    cloud.status = e.code === 401 ? 'signin' : 'error'; cloud.msg = e.message;
  } finally {
    cloud.busy = false; render();
    if (cloud.dirty && cloud.status === 'synced') { clearTimeout(pushTimer); pushTimer = setTimeout(() => syncNow(true), 500); }
  }
}
export let pushTimer;
export function markChanged() {
  if (!cloud.meta || !cloud.meta.fileId) return;
  cloud.dirty = true; cloud.rev++; saveCloudMeta(); clearTimeout(pushTimer); pushTimer = setTimeout(() => syncNow(true), 1500); setPill();
}
export async function createVaultFlow(pass, remember) {
  const salt = C.newSalt(); const key = await C.deriveKey(pass, salt);
  const res = await C.createVault(cloud.token.token, await C.seal(statePayload(), key, salt));
  cloud.meta = { fileId: res.id, salt, iter: 310000, remoteModified: res.modifiedTime, lastSync: new Date().toISOString(), owner: true };
  cloud.key = key; cloud.dirty = false; await saveCloudMeta();
  if (remember) await kvSet('cloudKey', key);
}
// Unlock an existing vault (yours on another device, or one shared with you) and merge it into this device.
export async function unlockFlow(pass, remember) {
  const text = await C.download(cloud.token.token, cloud.meta.fileId);
  const head = C.vaultHeader(text);
  const key = await C.deriveKey(pass, head.salt, head.iter);
  await C.unseal(text, key); // throws on a wrong passphrase
  cloud.meta.salt = head.salt; cloud.meta.iter = head.iter; cloud.meta.remoteModified = null;
  cloud.key = key; cloud.dirty = state.tx.length > 0; await saveCloudMeta();
  if (remember) await kvSet('cloudKey', key);
  refreshStatus(); await syncNow();
}
export async function chooseVault() {
  const files = await C.findVault(cloud.token.token);
  if (files.length) { cloud.meta = { fileId: files[0].id, owner: files[0].ownedByMe }; await saveCloudMeta(); refreshStatus(); render(); return; }
  render();
}
export function setPill() { const p = document.querySelector('.cloud-pill'); if (p) p.outerHTML = cloudPill(); }
export function cloudPill() {
  if (!cloudReady() || cloud.status === 'off') return '';
  const ago = cloud.meta && cloud.meta.lastSync ? Math.max(0, Math.round((Date.now() - new Date(cloud.meta.lastSync)) / 60000)) : null;
  const txt = { syncing: 'Syncing…', synced: cloud.dirty ? 'Saving…' : ago === null ? 'Synced' : ago < 1 ? 'Synced just now' : ago < 60 ? `Synced ${ago} min ago` : 'Synced', signin: 'Sign in to sync', locked: 'Vault locked', signedout: 'Set up sync', novault: 'Set up sync', error: 'Sync problem' }[cloud.status] || '';
  return `<button class="cloud-pill ${cloud.status === 'synced' ? 'ok' : cloud.status === 'error' ? 'bad' : ''}" data-tab="data">${txt}</button>`;
}
export function cloudCard() {
  if (!cloudReady()) return `<section class="card wide"><h2>Cloud sync</h2><p class="fine">Not set up. Add your Google IDs to config.js on GitHub to sync this data, encrypted, through your Google Drive.</p></section>`;
  const s = cloud.status; let body = '';
  if (s === 'signedout') body = `<p class="fine">Sign in with Google to keep this data in your Drive, encrypted with a passphrase only you know.</p><button class="btn primary" data-act="gsignin">Sign in with Google</button>`;
  else if (s === 'novault') body = `<p class="fine">No vault of yours was found in this Google account.</p>
    ${cfg.googleApiKey ? '<p class="fine">Someone shared their vault with you? Open it here.</p><button class="btn primary" data-act="pickvault">Open a shared vault</button>' : ''}
    <h3>Or create a new vault from the data on this device</h3>
    <form class="stack" data-act="createvault"><label>Choose a passphrase (at least 10 characters)<input type="password" name="p1" minlength="10" required autocomplete="new-password"></label><label>Repeat it<input type="password" name="p2" minlength="10" required autocomplete="new-password"></label>
    <label class="check"><input type="checkbox" name="remember" checked> Remember on this device</label>
    <p class="fine">Write the passphrase down somewhere safe. It cannot be recovered: without it the vault cannot be opened, by you or anyone.</p>
    <button class="btn${cfg.googleApiKey ? '' : ' primary'}">Create encrypted vault</button></form>`;
  else if (s === 'locked') body = `<p class="fine">Enter the vault passphrase to sync this device.</p>
    <form class="stack" data-act="unlock"><label>Passphrase<input type="password" name="p" required autocomplete="current-password"></label><label class="check"><input type="checkbox" name="remember" checked> Remember on this device</label><button class="btn primary">Unlock and sync</button></form>
    <button class="link" data-act="forgetvault">Use a different vault</button>`;
  else if (s === 'signin') body = `<p class="fine">Google sign-in lasts about an hour. Sign in again to sync${cloud.dirty ? '; your latest changes are waiting' : ''}.</p><button class="btn primary" data-act="gsignin">Sign in again</button>`;
  else body = `<p class="fine">${s === 'error' ? `<span class="bad">${h(cloud.msg)}</span> ` : ''}Encrypted vault in Google Drive (${cloud.meta.owner === false ? 'shared with you' : 'yours'}). Changes on this device sync automatically.</p>
    <div class="row"><button class="btn primary" data-act="syncnow">Sync now</button>${lock.on ? '' : '<button class="btn" data-act="lockvault">Lock this device</button><button class="btn warn" data-act="disconnect">Disconnect</button>'}</div>${lock.on ? '<p class="fine">Turn off the app lock below to change sync settings on this device.</p>' : ''}
    ${cloud.meta.owner !== false ? '<p class="fine">To share: in Google Drive, share the file finance-vault.json with your wife (Editor), then give her the passphrase in person.</p>' : ''}`;
  return `<section class="card wide"><h2>Cloud sync</h2>${body}</section>`;
}

