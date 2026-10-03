// App lock (Face ID / Touch ID) and the app's own dialogs.
import { aggregate, reconcile, DEFAULT_SETTINGS, emptyProfile, lines, SECTIONS, USER_SECTIONS, lineLabel, lineMeta, monthLabel, deDate, monthOf } from './model.js';
import * as C from './cloud.js';
import * as L from './lock.js';
import { $, h, toast } from './util.js';
import { SEALED_KV, kvGet, lock, rawClear, rawDel, rawPut, sealAll } from './storage.js';
import { fresh, recompute, state, undo } from './state.js';
import { cloud, refreshStatus, syncNow } from './sync.js';
import { render } from './views.js';
// ---------------- app lock (Face ID / Touch ID) ----------------
export const isPhone = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
export const BIO = isPhone ? 'Face ID' : 'Touch ID';
export const DEVICE = isPhone ? 'phone' : 'device';
export function lockView() {
  return `<section class="lockscreen"><img src="logo-icon.png" alt="" width="88" height="88"><h1>Finances is locked</h1>
    <p class="fine">Your data on this device is encrypted. Unlock with ${BIO}.</p>
    <button class="btn primary" data-act="unlockapp">Unlock</button>
    <button class="link" data-act="lockfallback">Use my passphrase instead</button></section>`;
}
export async function unlockApp() {
  try {
    const key = await L.unlock(lock.meta);
    const blob = await kvGet('sealed', null);
    const d = blob ? await L.open(blob, key) : { tx: [], statements: [], settings: {}, undo: [] };
    lock.key = key; lock.vaultRaw = d.vaultRaw || null;
    state.tx = d.tx || []; state.statements = d.statements || []; state.settings = { ...fresh(), ...(d.settings || {}) };
    state.undo = d.undo || []; state.lastBackup = d.lastBackup || null;
    if (lock.vaultRaw) cloud.key = await L.importRaw(lock.vaultRaw);
    refreshStatus(); recompute(); render();
    if (cloud.status === 'synced') syncNow(true);
  } catch (e) { toast(e.message); }
}
export async function lockFallback() {
  const ok = await ask({ title: 'Use your passphrase instead?', text: 'This turns off the app lock on this device and restores your data from your encrypted vault in Google Drive. You will sign in with Google and enter your vault passphrase. You can set up Face ID again afterwards.', ok: 'Continue', danger: true });
  if (!ok) return;
  await rawDel('sealed'); await rawDel('lockMeta'); await rawClear('tx'); await rawClear('statements');
  location.reload();
}
export async function enableLock(pass) {
  if (!cloud.meta || !cloud.meta.fileId || !cloud.key) throw new Error('Turn on cloud sync first, so your data can always be restored with your passphrase.');
  // check the passphrase against the vault key this device already uses
  const vk = await C.deriveKey(pass, cloud.meta.salt, cloud.meta.iter || 310000, true);
  const probe = await C.seal({ ok: 1 }, cloud.key, cloud.meta.salt);
  await C.unseal(probe, vk).catch(() => { throw new Error("That passphrase doesn't open your vault."); });
  const { meta, key } = await L.setup();
  lock.vaultRaw = await L.exportRaw(vk); lock.key = key; lock.meta = meta; lock.on = true;
  await sealAll(); await rawPut('kv', [{ k: 'lockMeta', v: meta }]);
  for (const k of SEALED_KV) await rawDel(k);
  await rawClear('tx'); await rawClear('statements');
}
export async function disableLock() {
  lock.on = false;
  await rawPut('tx', state.tx); await rawPut('statements', state.statements);
  await rawPut('kv', [{ k: 'settings', v: state.settings }, { k: 'undo', v: state.undo }, { k: 'lastBackup', v: state.lastBackup }]);
  if (cloud.key) await rawPut('kv', [{ k: 'cloudKey', v: cloud.key }]);
  await rawDel('sealed'); await rawDel('lockMeta');
  lock.key = null; lock.meta = null; lock.vaultRaw = null;
}
export function lockCard() {
  if (lock.on) return `<section class="card"><h2>App lock</h2><p class="fine">On since ${deDate(lock.meta.since.slice(0, 10))}. The data on this device is encrypted and opens with ${BIO}. The app locks again after 5 minutes in the background.</p><button class="btn warn" data-act="lockoff">Turn off app lock</button></section>`;
  const ready = cloud.meta && cloud.meta.fileId && cloud.key;
  return `<section class="card"><h2>App lock</h2><p class="fine">Encrypt the data on this device and open the app with ${BIO}.${ready ? ' Enter your vault passphrase to confirm it is you.' : ' Needs cloud sync, so your data can always be restored with your passphrase.'}</p>
    ${ready ? `<form class="stack" data-act="lockon"><label>Vault passphrase<input type="password" name="p" required autocomplete="current-password"></label><button class="btn primary">Turn on ${BIO} lock</button></form>` : ''}</section>`;
}

// ---------------- own dialogs (instead of browser pop-ups) ----------------
export let dialogDone = null;
export function ask({ title, text = '', ok = 'OK', danger = false, input = null, cancel = 'Cancel' }) {
  return new Promise((res) => {
    const d = $('#dialog');
    d.innerHTML = `<div class="dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t"><h2 id="dlg-t">${h(title)}</h2>${text ? `<p>${h(text)}</p>` : ''}
      ${input !== null ? `<input id="dlg-in" type="text" value="${h(input)}" autocomplete="off">` : ''}
      <div class="row"><button class="btn${danger ? ' warn' : ' primary'}" data-dlg="ok">${h(ok)}</button>${cancel ? `<button class="btn" data-dlg="cancel">${h(cancel)}</button>` : ''}</div></div>`;
    d.hidden = false; dialogDone = (v) => { d.hidden = true; d.innerHTML = ''; dialogDone = null; res(v); };
    setTimeout(() => (d.querySelector('#dlg-in') || d.querySelector('[data-dlg=ok]')).focus(), 30);
  });
}

