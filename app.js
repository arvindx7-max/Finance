import { parsePdf, parseCsv } from './parser.js';
import { aggregate, reconcile, DEFAULT_SETTINGS, emptyProfile, lines, SECTIONS, USER_SECTIONS, lineLabel, lineMeta, monthLabel, deDate, monthOf } from './model.js';
import { buildWorkbook } from './xlsx.js';
import * as C from './cloud.js';
import * as F from './family.js';

// ---------------- storage (IndexedDB) ----------------
const DB_NAME = 'finance-insights';
let dbp;
function db() {
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
async function all(store) { const d = await db(); return new Promise((res, rej) => { const q = d.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function putMany(store, items) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'); const s = t.objectStore(store); items.forEach((i) => s.put(i)); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function clear(store) { const d = await db(); return new Promise((res) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).clear(); t.oncomplete = res; }); }
async function kvGet(k, def) { const d = await db(); return new Promise((res) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result ? q.result.v : def); q.onerror = () => res(def); }); }
const kvSet = (k, v) => putMany('kv', [{ k, v }]);

// ---------------- state ----------------
const fresh = () => structuredClone(DEFAULT_SETTINGS);
const state = { tx: [], statements: [], settings: fresh(), lastBackup: null, tab: 'overview', period: { mode: 'month', key: null }, section: 'fixed', q: '', agg: null, undo: [], family: null, pendingFamily: null };
async function load() {
  state.tx = await all('tx');
  state.statements = await all('statements');
  state.settings = { ...fresh(), ...(await kvGet('settings', {})) };
  state.lastBackup = await kvGet('lastBackup', null);
  state.undo = await kvGet('undo', []);
  state.family = await kvGet('family', null);
  recompute();
}
function recompute() {
  state.agg = aggregate(state.tx, state.settings);
}
const saveSettings = () => kvSet('settings', state.settings);
const ensureProfile = () => (state.settings.profile ||= emptyProfile());

// Every change to your answers, lines or trips can be undone (last 15 steps).
async function change(label, fn) {
  state.undo.push(JSON.stringify(state.settings));
  if (state.undo.length > 15) state.undo.shift();
  const before = JSON.parse(JSON.stringify(state.settings));
  fn(state.settings);
  stampDiff(before, state.settings);
  await saveSettings(); await kvSet('undo', state.undo);
  recompute(); render(); markChanged();
  toast(label, true);
}
async function undo() {
  const prev = state.undo.pop(); if (!prev) return;
  const before = state.settings; state.settings = JSON.parse(prev); stampDiff(before, state.settings);
  await saveSettings(); await kvSet('undo', state.undo);
  recompute(); render(); markChanged(); toast('Undone');
}

// ---------------- change timestamps (so two devices can merge) ----------------
const MAPS = [['vendorRules', 'v'], ['txRules', 't'], ['flagDismissed', 'f']];
const WHOLE = ['profile', 'trips', 'startMonth'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// Removed answers are kept as null so the removal itself can sync.
function stampDiff(before, after) {
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
const live = (obj) => Object.entries(obj || {}).filter(([, v]) => v !== null && v !== undefined);
function mergeSettings(l, r) {
  const out = { ...fresh(), ...r, ...l, stamps: {} };
  const st = (s, k) => (s.stamps || {})[k] || 0;
  const pick = (k, inL, inR) => { const ls = st(l, k), rs = st(r, k); out.stamps[k] = Math.max(ls, rs); return rs > ls ? 'r' : ls > rs ? 'l' : (inL ? 'l' : inR ? 'r' : 'l'); };
  for (const [m, p] of MAPS) {
    out[m] = {}; const L = l[m] || {}, R = r[m] || {};
    for (const k of new Set([...Object.keys(L), ...Object.keys(R)])) { const side = pick(`${p}:${k}`, k in L, k in R); out[m][k] = (side === 'r' ? R[k] : L[k]) ?? null; }
  }
  for (const w of WHOLE) { const side = pick(w, l[w] !== undefined, r[w] !== undefined); out[w] = side === 'r' ? r[w] : l[w]; }
  return out;
}
// Bookings: same id = same booking; otherwise matched by date + amount + vendor, count for count.
function mergeTx(local, remote) {
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
const cfg = window.FIN_CONFIG || {};
const cloud = { meta: null, key: null, token: null, status: 'off', msg: '', busy: false, dirty: false };
const cloudReady = () => !!cfg.googleClientId;
const tokenOk = () => cloud.token && cloud.token.exp > Date.now();
async function loadCloud() {
  cloud.meta = await kvGet('cloud', null);
  cloud.key = await kvGet('cloudKey', null);
  cloud.token = await kvGet('gtoken', null);
  cloud.dirty = !!(cloud.meta && cloud.meta.dirty);
  refreshStatus();
}
function refreshStatus() {
  if (!cloudReady()) cloud.status = 'off';
  else if (!cloud.meta || !cloud.meta.fileId) cloud.status = tokenOk() ? 'novault' : 'signedout';
  else if (!cloud.key) cloud.status = 'locked';
  else if (!tokenOk()) cloud.status = 'signin';
  else if (cloud.status !== 'error' && cloud.status !== 'syncing') cloud.status = 'synced';
}
const saveCloudMeta = () => kvSet('cloud', { ...cloud.meta, dirty: cloud.dirty });
const statePayload = () => ({ tx: state.tx, statements: state.statements, settings: state.settings, family: state.family });
async function persistAll() {
  await clear('tx'); await putMany('tx', state.tx);
  await clear('statements'); await putMany('statements', state.statements);
  await saveSettings(); await saveFamily();
}
// Pull the vault, merge it into this device, push the result back if anything here was new.
async function syncNow(quiet = false) {
  refreshStatus();
  if (cloud.status !== 'synced' || cloud.busy) { if (!quiet) render(); return; }
  cloud.busy = true; cloud.status = 'syncing'; if (!quiet) render(); setPill();
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
      if (remote.family && (!state.family || (remote.family.stamp || 0) > (state.family.stamp || 0))) state.family = remote.family;
      await persistAll(); recompute();
      const after = JSON.stringify(statePayload());
      const remoteJson = JSON.stringify({ tx: remote.tx, statements: remote.statements, settings: remote.settings, family: remote.family });
      changedHere = changedHere || (after !== remoteJson && after !== before) || state.tx.length !== (remote.tx || []).length;
      cloud.meta.remoteModified = m.modifiedTime;
    }
    if (changedHere || !remote && cloud.dirty) {
      const res = await C.updateVault(cloud.token.token, cloud.meta.fileId, await C.seal(statePayload(), cloud.key, cloud.meta.salt, cloud.meta.iter));
      cloud.meta.remoteModified = res.modifiedTime;
    }
    cloud.dirty = false; cloud.meta.lastSync = new Date().toISOString(); await saveCloudMeta();
    cloud.status = 'synced'; cloud.msg = '';
  } catch (e) {
    if (e.code === 401) { cloud.token = null; await kvSet('gtoken', null); }
    cloud.status = e.code === 401 ? 'signin' : 'error'; cloud.msg = e.message;
  } finally { cloud.busy = false; render(); }
}
let pushTimer;
function markChanged() {
  if (!cloud.meta || !cloud.meta.fileId) return;
  cloud.dirty = true; saveCloudMeta(); clearTimeout(pushTimer); pushTimer = setTimeout(() => syncNow(true), 1500); setPill();
}
async function createVaultFlow(pass, remember) {
  const salt = C.newSalt(); const key = await C.deriveKey(pass, salt);
  const res = await C.createVault(cloud.token.token, await C.seal(statePayload(), key, salt));
  cloud.meta = { fileId: res.id, salt, iter: 310000, remoteModified: res.modifiedTime, lastSync: new Date().toISOString(), owner: true };
  cloud.key = key; cloud.dirty = false; await saveCloudMeta();
  if (remember) await kvSet('cloudKey', key);
}
// Unlock an existing vault (yours on another device, or one shared with you) and merge it into this device.
async function unlockFlow(pass, remember) {
  const text = await C.download(cloud.token.token, cloud.meta.fileId);
  const head = C.vaultHeader(text);
  const key = await C.deriveKey(pass, head.salt, head.iter);
  await C.unseal(text, key); // throws on a wrong passphrase
  cloud.meta.salt = head.salt; cloud.meta.iter = head.iter; cloud.meta.remoteModified = null;
  cloud.key = key; cloud.dirty = state.tx.length > 0; await saveCloudMeta();
  if (remember) await kvSet('cloudKey', key);
  refreshStatus(); await syncNow();
}
async function chooseVault() {
  const files = await C.findVault(cloud.token.token);
  if (files.length) { cloud.meta = { fileId: files[0].id, owner: files[0].ownedByMe }; await saveCloudMeta(); refreshStatus(); render(); return; }
  render();
}
function setPill() { const p = document.querySelector('.cloud-pill'); if (p) p.outerHTML = cloudPill(); }
function cloudPill() {
  if (!cloudReady() || cloud.status === 'off') return '';
  const ago = cloud.meta && cloud.meta.lastSync ? Math.max(0, Math.round((Date.now() - new Date(cloud.meta.lastSync)) / 60000)) : null;
  const txt = { syncing: 'Syncing…', synced: cloud.dirty ? 'Saving…' : ago === null ? 'Synced' : ago < 1 ? 'Synced just now' : ago < 60 ? `Synced ${ago} min ago` : 'Synced', signin: 'Sign in to sync', locked: 'Vault locked', signedout: 'Set up sync', novault: 'Set up sync', error: 'Sync problem' }[cloud.status] || '';
  return `<button class="cloud-pill ${cloud.status === 'synced' ? 'ok' : cloud.status === 'error' ? 'bad' : ''}" data-tab="data">${txt}</button>`;
}
function cloudCard() {
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
    <div class="row"><button class="btn primary" data-act="syncnow">Sync now</button><button class="btn" data-act="lockvault">Lock this device</button><button class="btn warn" data-act="disconnect">Disconnect</button></div>
    ${cloud.meta.owner !== false ? '<p class="fine">To share: in Google Drive, share the file finance-vault.json with your wife (Editor), then give her the passphrase in person.</p>' : ''}`;
  return `<section class="card wide"><h2>Cloud sync</h2>${body}</section>`;
}

// ---------------- family pictures ----------------
// Kept apart from settings (so undo snapshots stay small); synced in the vault, newest set wins.
const CAPTIONS = { cheer: 'Next month is ours.', smile1: 'A good start.', smile2: 'Nicely done.', celebrate: 'What a month!', together: 'We’re in this together.', thinking: 'Let’s figure these out.', question: 'What shall we do next?' };
async function saveFamily() { await kvSet('family', state.family); }
function moodFor(avgSaved) { return avgSaved < 0 ? 'cheer' : avgSaved < 500 ? 'smile1' : avgSaved < 1000 ? 'smile2' : 'celebrate'; }
let lastMood = null;
function familyFig(mood, wide = false) {
  const img = state.family && state.family.images && state.family.images[mood];
  if (!img) return '';
  const anim = mood !== lastMood ? ` pop${mood === 'celebrate' ? ' bounce' : ''}` : ''; lastMood = mood;
  return `<figure class="family${wide ? ' wide' : ''}${anim}"><img src="${img}" alt="Family doodle: ${h(CAPTIONS[mood])}"></figure>`;
}
function familyStrip(mood) {
  const fig = familyFig(mood); if (!fig) return '';
  return `<div class="family-strip">${fig}<p>${h(CAPTIONS[mood])}</p></div>`;
}
function familyCard() {
  const f = state.family || {}; const has = f.images && Object.keys(f.images).length;
  const keyForm = `<form class="stack" data-act="geminikey"><label>Gemini API key<input name="key" type="password" autocomplete="off" required placeholder="AIza…" value="${h(f.key ? '••••••••' : '')}"></label>
    <p class="fine">Create one at aistudio.google.com → Get API key, in your Finances project. Making pictures needs billing switched on for that project; a set costs a few cents.</p><button class="btn">Save key</button></form>`;
  return `<section class="card wide"><h2>Family pictures</h2>
    ${has ? `<div class="fam-grid">${F.MOODS.map(([id, where]) => `<figure><img src="${f.images[id]}" alt=""><figcaption>${h(where)}</figcaption></figure>`).join('')}</div>` : '<p class="fine">Upload one photo of yourself, the two of you or the whole family. Gemini turns it into doodles for every mood in the app: cheering, smiling, celebrating, together, thinking and asking.</p>'}
    ${f.key ? `<div class="row"><label class="btn primary">${has ? 'New photo' : 'Choose a photo'}<input type="file" accept="image/*" data-act="familyphoto" hidden></label>${has ? '<button class="btn warn" data-act="familyremove">Remove pictures</button>' : ''}<button class="link" data-act="familykey">Change API key</button></div>
    <p class="fine">Only the photo you choose is sent to Google to draw the doodles. The finished pictures are kept on your devices and in your encrypted vault.</p>` : keyForm}
  </section>`;
}
function previewSheet() {
  const p = state.pendingFamily;
  sheet(`<h2>Your family doodles</h2><p class="fine">Check each one. Redraw any you don't like, then save.</p>
  <div class="fam-grid big">${F.MOODS.map(([id, where]) => `<figure><img src="${p.set[id]}" alt=""><figcaption>${h(where)}</figcaption><button class="link" data-redo="${id}">Redraw</button></figure>`).join('')}</div>
  <div class="row"><button class="btn primary" data-act="familysave">Save pictures</button><button class="btn" data-act="familycancel">Discard</button></div>`);
}
async function generateFamily(file) {
  const f = state.family || {};
  const raw = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the photo.')); r.readAsDataURL(file); });
  const photo = await F.shrink(raw, 1024);
  showBusy('Sending the photo to Gemini…');
  try {
    const set = await F.makeSet({ key: f.key, model: cfg.geminiModel || 'gemini-3.1-flash-image', photo, onStep: (i, n) => showBusy(`Drawing your family… ${i} of ${n}`) });
    state.pendingFamily = { photo, set }; previewSheet();
  } catch (e) { toast(e.message); } finally { hideBusy(); }
}

// ---------------- import ----------------
let pdfjs;
async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('./pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}
// Dedupe across overlapping uploads: same booking date + amount, matched count-for-count.
// Same source format: the vendor must match too. Different format (PDF vs CSV): date + amount is enough.
function mergeRows(existing, incoming) {
  const byDA = new Map();
  for (const t of existing) { const k = `${t.date}|${t.amount}`; (byDA.get(k) || byDA.set(k, []).get(k)).push(t); }
  const groups = new Map();
  for (const t of incoming) { const k = `${t.date}|${t.amount}`; (groups.get(k) || groups.set(k, []).get(k)).push(t); }
  const added = []; let dup = 0;
  for (const [k, inc] of groups) {
    const ex = byDA.get(k) || [];
    const sameSrc = ex.length && ex.every((e) => e.source === inc[0].source);
    if (sameSrc) {
      const cnt = {}; for (const e of ex) cnt[e.vkey] = (cnt[e.vkey] || 0) + 1;
      const seen = {};
      for (const t of inc) { seen[t.vkey] = (seen[t.vkey] || 0) + 1; if (seen[t.vkey] <= (cnt[t.vkey] || 0)) dup++; else added.push(t); }
    } else {
      inc.slice(ex.length).forEach((t) => added.push(t)); dup += Math.min(ex.length, inc.length);
    }
  }
  const used = new Set(existing.map((t) => t.id));
  for (const t of added) { let n = 0; let id; do { id = `${t.date}|${t.amount}|${t.vkey}|${n++}`; } while (used.has(id)); used.add(id); t.id = id; }
  return { added, dup };
}

async function importFiles(files) {
  const report = { files: [], added: 0, dup: 0, errors: [] };
  // rules files first, so statements in the same batch are categorised with them
  files = [...files].sort((a, b) => (/\.json$/i.test(b.name) ? 1 : 0) - (/\.json$/i.test(a.name) ? 1 : 0));
  showBusy(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`);
  try {
    for (const f of files) {
      try {
        if (/\.json$/i.test(f.name)) {
          const j = JSON.parse(await f.text());
          if (j.app === 'finance-insights-rules') { report.files.push(`${f.name}: ${await loadRules(j)}`); continue; }
          report.files.push(`${f.name}: ${await restoreBackup(j)}`); continue;
        }
        let rows, statement = null, checkpoint = null;
        if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
          const out = await parsePdf(await getPdfjs(), new Uint8Array(await f.arrayBuffer()));
          if (!out.statement.ties) throw new Error(`totals do not tie to the statement (opening ${eur(out.statement.open)}, closing ${eur(out.statement.close)}). Nothing was imported from this file.`);
          rows = out.rows; statement = out.statement;
        } else {
          const out = parseCsv(await f.text()); rows = out.rows;
          if (out.footer && out.footer.balance !== null) checkpoint = { id: `csv_${out.footer.date}`, kind: 'checkpoint', date: out.footer.date, close: out.footer.balance, source: 'csv' };
        }
        const { added, dup } = mergeRows(state.tx, rows);
        await putMany('tx', added); state.tx.push(...added);
        for (const s of [statement, checkpoint].filter(Boolean)) { await putMany('statements', [s]); state.statements = state.statements.filter((x) => x.id !== s.id).concat(s); }
        report.added += added.length; report.dup += dup;
        report.files.push(`${statement ? `Statement ${deDate(statement.from)} – ${deDate(statement.to)}` : f.name}: ${added.length} new, ${dup} already stored`);
      } catch (e) { report.errors.push(`${f.name}: ${e.message}`); }
    }
  } finally { hideBusy(); }
  recompute(); render();
  if (report.added || report.files.length) markChanged();
  showImportReport(report);
}

// ---------------- your rules file (kept on this phone, never in the app code) ----------------
async function loadRules(j) {
  if (!Array.isArray(j.rules) || !Array.isArray(j.lines)) throw new Error('rules file is missing its "rules" or "lines" list');
  for (const r of j.rules) for (const p of [...(r.any || []), ...(r.all || []), ...(r.none || [])]) new RegExp(p, 'i'); // fail early on a bad pattern
  const { vendorAnswers = {}, bookingAnswers = {}, dismissed = {}, ...profile } = j;
  const s = state.settings; const before = JSON.parse(JSON.stringify(s));
  s.profile = profile;
  if (Array.isArray(j.trips)) s.trips = j.trips;
  if (j.startMonth) s.startMonth = j.startMonth;
  s.vendorRules = { ...s.vendorRules, ...vendorAnswers };
  s.txRules = { ...s.txRules, ...bookingAnswers };
  s.flagDismissed = { ...s.flagDismissed, ...dismissed };
  stampDiff(before, s);
  await saveSettings();
  return `your rules loaded (${j.rules.length} rules, ${j.lines.length} line names, ${Object.keys(vendorAnswers).length} vendor answers)`;
}
function rulesPayload() {
  const s = state.settings;
  return { ...(s.profile || emptyProfile()), trips: s.trips, startMonth: s.startMonth,
    vendorAnswers: Object.fromEntries(live(s.vendorRules)), bookingAnswers: Object.fromEntries(live(s.txRules)), dismissed: Object.fromEntries(live(s.flagDismissed)) };
}
const exportRules = () => deliver(new Blob([JSON.stringify(rulesPayload(), null, 2)], { type: 'application/json' }), 'my-rules.json');

// ---------------- backup ----------------
function backupPayload() {
  return { app: 'finance-insights', version: 2, exportedAt: new Date().toISOString(), tx: state.tx, statements: state.statements, settings: state.settings, family: state.family };
}
async function exportBackup() {
  const name = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const ok = await deliver(new Blob([JSON.stringify(backupPayload())], { type: 'application/json' }), name);
  if (ok) { state.lastBackup = new Date().toISOString(); await kvSet('lastBackup', state.lastBackup); render(); }
}
// Bookings and statements are replaced by the backup. Answers and your own lines are merged,
// so changes made on this phone are not lost (the backup wins where both answered the same booking).
async function restoreBackup(p) {
  if (p.app !== 'finance-insights' || !Array.isArray(p.tx)) throw new Error('not a backup or rules file from this app');
  await clear('tx'); await clear('statements');
  await putMany('tx', p.tx); await putMany('statements', p.statements || []);
  state.tx = p.tx; state.statements = p.statements || [];
  const local = state.settings; const inc = { ...fresh(), ...(p.settings || {}) };
  const keptV = live(local.vendorRules).filter(([k]) => !(k in (inc.vendorRules || {}))).length;
  const keptT = live(local.txRules).filter(([k]) => !(k in (inc.txRules || {}))).length;
  inc.vendorRules = { ...local.vendorRules, ...inc.vendorRules };
  inc.txRules = { ...local.txRules, ...inc.txRules };
  inc.flagDismissed = { ...local.flagDismissed, ...inc.flagDismissed };
  const localOwn = (local.profile?.lines || []).filter((l) => l.id.startsWith('c.'));
  if (localOwn.length) {
    inc.profile ||= emptyProfile();
    const have = new Set(inc.profile.lines.map((l) => l.id));
    inc.profile.lines = [...inc.profile.lines, ...localOwn.filter((l) => !have.has(l.id))];
  }
  stampDiff(local, inc); state.settings = inc; await saveSettings();
  if (p.family && (!state.family || (p.family.stamp || 0) > (state.family.stamp || 0))) { state.family = p.family; await saveFamily(); }
  return `backup restored (${p.tx.length} bookings)${keptV + keptT ? `; kept ${keptV + keptT} answer${keptV + keptT > 1 ? 's' : ''} made on this phone` : ''}`;
}
// iOS: the share sheet lets the file go to Files / iCloud Drive. Elsewhere: plain download.
async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
async function exportExcel() {
  const data = buildWorkbook(state.agg, reconcile(state.tx, pdfStatements()), state.settings);
  const last = state.agg.months[state.agg.months.length - 1] || 'empty';
  await deliver(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Finances_${last}.xlsx`);
}
const pdfStatements = () => state.statements.filter((s) => s.kind !== 'checkpoint');

// ---------------- helpers ----------------
const $ = (sel, el = document) => el.querySelector(sel);
const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (v) => `${v < 0 ? '−' : ''}€${nf.format(Math.abs(v))}`;
const n2 = (v) => nf.format(v || 0);
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);
const txById = (id) => state.agg.rows.find((r) => r.id === id) || state.tx.find((r) => r.id === id);

function showBusy(msg) { const b = $('#busy'); b.textContent = msg; b.hidden = false; }
function hideBusy() { $('#busy').hidden = true; }
let toastTimer;
function toast(msg, canUndo = false) {
  const t = $('#toast');
  t.innerHTML = `<span>${h(msg)}</span>${canUndo ? '<button data-act="undo">Undo</button>' : ''}`;
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}
let sheetTimer;
function sheet(html) {
  clearTimeout(sheetTimer);
  const s = $('#sheet'); $('#sheet-body').innerHTML = html; s.hidden = false;
  requestAnimationFrame(() => s.classList.add('open'));
}
function closeSheet() {
  const s = $('#sheet'); if (s.hidden) return;
  s.classList.remove('open'); clearTimeout(sheetTimer); sheetTimer = setTimeout(() => { s.hidden = true; }, 220);
}

// ---------------- render ----------------
function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false'));
  const n = state.agg.review.length + state.agg.flags.length + state.agg.passFlags.length;
  $('#review-badge').textContent = n; $('#review-badge').hidden = !n;
  const main = $('#main');
  if (!state.tx.length && state.tab !== 'data') { main.innerHTML = emptyView(); return; }
  main.innerHTML = { overview: overviewView, months: monthsView, review: reviewView, data: dataView }[state.tab]();
  if (state.tab === 'overview') animateCount();
}

function emptyView() {
  return `${topbar('Finances')}<section class="empty">
    <h1>Start with your statements</h1>
    <p>Add your Deutsche Bank Kontoauszug PDFs (or the CSV export). Everything is read and stored on this phone only.</p>
    <label class="btn primary">Add statements<input type="file" accept=".pdf,.csv,.json,application/pdf,text/csv,application/json" multiple data-act="import" hidden></label>
    <p class="fine">Your rules file (my-rules.json) and backups are .json files: choose them here too.</p>
  </section>`;
}
function backupBanner() {
  const d = daysSince(state.lastBackup);
  if ((d !== null && d < 7) || (cloud.meta && cloud.meta.fileId && cloud.key)) return '';
  return `<button class="banner" data-act="backup">${d === null ? 'No backup yet.' : `Last backup ${d} days ago.`} <u>Export backup</u></button>`;
}

// ---------------- periods: month, quarter, year, total ----------------
const PMODES = [['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['all', 'Total']];
function periodKey(m, mode) {
  const [y, mo] = m.split('-').map(Number);
  return mode === 'month' ? m : mode === 'quarter' ? `${y}-Q${Math.ceil(mo / 3)}` : mode === 'year' ? String(y) : 'all';
}
const periodList = (mode) => [...new Set(state.agg.months.map((m) => periodKey(m, mode)))];
const monthsIn = (key, mode) => state.agg.months.filter((m) => periodKey(m, mode) === key);
function periodLabel(key, mode, short = false) {
  if (mode === 'month') return monthLabel(key, short);
  if (mode === 'quarter') { const [y, q] = key.split('-'); return short ? q : `${q} ${y}`; }
  if (mode === 'year') return key;
  const ms = state.agg.months; return ms.length ? `${monthLabel(ms[0], true)} ${ms[0].slice(0, 4)} – ${monthLabel(ms[ms.length - 1], true)} ${ms[ms.length - 1].slice(0, 4)}` : 'All';
}
const SUM_KEYS = ['earned', 'fixed', 'variable', 'onetime', 'spent', 'indiaGross', 'passThrough', 'india', 'saved', 'toSav', 'fromSav', 'netToSav', 'kept', 'unassigned'];
function sumMonths(months) {
  const out = Object.fromEntries(SUM_KEYS.map((k) => [k, 0]));
  for (const s of state.agg.summary) if (months.includes(s.month)) for (const k of SUM_KEYS) out[k] = Math.round((out[k] + s[k]) * 100) / 100;
  out.savingsRate = out.earned ? out.saved / out.earned : 0;
  return out;
}
function ensurePeriod() {
  const p = state.period; const list = periodList(p.mode);
  if (!list.includes(p.key)) p.key = list[list.length - 1] || null;
}
function periodPicker() {
  const p = state.period;
  return `<div class="modes" role="tablist" aria-label="Period type">${PMODES.map(([k, l]) => `<button role="tab" aria-selected="${p.mode === k}" data-pmode="${k}">${l}</button>`).join('')}</div>
  ${p.mode === 'all' ? '' : `<div class="periods" role="tablist" aria-label="Period">${periodList(p.mode).map((k) => `<button role="tab" aria-selected="${k === p.key}" data-pkey="${k}">${h(periodLabel(k, p.mode, p.mode === 'month'))}${p.mode === 'month' ? ` ${k.slice(2, 4)}` : ''}</button>`).join('')}</div>`}`;
}

// ---------------- theme ----------------
const THEMES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
function currentTheme() { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } }
function applyTheme(t) {
  try { localStorage.setItem('theme', t); } catch { /* storage blocked */ }
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#0B1222' : '#EEF2F8';
}
function isDark() { return document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); }
function topbar(title) {
  return `<header class="topbar"><h1>${h(title)}</h1><div class="row">${cloudPill()}<button class="icon-btn" data-act="theme" aria-label="Switch to ${isDark() ? 'light' : 'dark'} theme">${isDark()
    ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>'}</button></div></header>`;
}

// ---------------- overview ----------------
function overviewView() {
  ensurePeriod();
  const p = state.period; const ms = monthsIn(p.key, p.mode); const s = sumMonths(ms);
  const rec = reconcile(state.tx, pdfStatements()).filter((r) => ms.includes(monthOf(r.to)));
  const tie = rec.length ? rec.every((r) => Math.abs(r.diff) < 0.005 && r.chainOk) : null;
  const pending = state.agg.review.filter((t) => ms.includes(monthOf(t.date))).length;
  // money-flow strip: earned income split into where it went
  const parts = [['fixed', s.fixed], ['variable', s.variable], ['onetime', s.onetime], ['india', Math.max(0, s.india)], ['saved', Math.max(0, s.saved)]];
  const whole = Math.max(s.earned, s.spent + Math.max(0, s.india), 1);
  const over = s.saved < 0 ? -s.saved : 0;
  const river = parts.filter(([, v]) => v > 0).map(([k, v]) => `<i class="c-${k}" style="width:${(v / whole * 100).toFixed(2)}%" title="${k}"></i>`).join('')
    + (over ? `<i class="over" style="width:${Math.min(30, over / whole * 100).toFixed(2)}%" title="spent more than earned"></i>` : '');
  const rate = s.earned ? Math.round(s.saved / s.earned * 100) : 0;
  return `${topbar('Overview')}${backupBanner()}${periodPicker()}
  <div class="overview">
  <section class="hero">
    ${familyFig(moodFor(s.saved / Math.max(1, ms.length)), true)}
    <div class="hero-head"><p>${h(periodLabel(p.key, p.mode))}</p><span class="badge${s.saved < 0 ? ' neg' : ''}">${s.saved >= 0 ? `${rate}% of earnings saved` : s.spent > s.earned ? 'Spent more than earned' : 'Sent more to India than you saved'}</span></div>
    <div class="saved-fig${s.saved < 0 ? ' neg' : ''}" data-count="${s.saved}">${eur(s.saved)}</div>
    <p class="saved-cap">saved${p.mode === 'all' ? ' in total' : ''}</p>
    <div class="river" role="img" aria-label="How earned income was used">${river}</div>
    <ul class="flow">
      <li class="lead"><i class="dot c-earned"></i><span>Earned income</span><b>${eur(s.earned)}</b></li>
      <li><i class="dot c-fixed"></i><span>Fixed / recurring</span><b>−${eur(s.fixed)}</b></li>
      <li><i class="dot c-variable"></i><span>Variable</span><b>−${eur(s.variable)}</b></li>
      <li><i class="dot c-onetime"></i><span>One-time</span><b>−${eur(s.onetime)}</b></li>
      <li><i class="dot c-india"></i><span>Sent to India</span><b>−${eur(s.indiaGross)}</b></li>
      ${s.passThrough ? `<li class="sub"><i></i><span>${h(lineLabel('pt.in'))}</span><b>+${eur(s.passThrough)}</b></li>` : ''}
      <li class="total"><i class="dot c-saved"></i><span>Saved</span><b>${eur(s.saved)}</b></li>
    </ul>
    <div class="went"><h3>Where the saved money is</h3>
      <div><span>Moved to savings, net</span><b>${eur(s.netToSav)}</b></div>
      <div><span>Kept in this account</span><b>${eur(s.kept)}</b></div>
    </div>
    ${tie === null ? '<p class="seal">No statement for this period yet</p>' : `<p class="seal ${tie ? 'ok' : 'bad'}">${tie ? `Ties to ${rec.length > 1 ? `${rec.length} statements` : 'the statement'}: ${eur(rec[0].open)} → ${eur(rec[rec.length - 1].close)}` : 'A statement in this period does not tie (see Data)'}</p>`}
    ${state.agg.passFlags.some((t) => ms.includes(monthOf(t.date))) ? '<button class="seal bad" data-tab="review">Was money from savings forwarded to India? Answer in Review</button>' : ''}
    ${pending ? `<button class="seal bad" data-tab="review">${pending} booking${pending > 1 ? 's' : ''} (${eur(s.unassigned)}) still need review</button>` : ''}
  </section>
  <div class="chart-grid">
    <section class="card wide"><h2>Earned, spent and saved</h2>${chartFlows()}</section>
    <section class="card"><h2>Savings rate</h2>${chartRate()}</section>
    <section class="card"><h2>Top variable vendors</h2>${(() => { const top = topVendors(ms, 6); return top.length ? barsH(top) : '<p class="fine">No variable spend in this period.</p>'; })()}</section>
    <section class="card wide"><h2>Variable spend by category</h2>${chartStack()}</section>
  </div>
  </div>`;
}
function topVendors(months, n) {
  const m = {};
  for (const t of state.agg.rows) if (months.includes(monthOf(t.date)) && t.line && lineMeta(t.line).sec === 'variable') m[t.vendor] = (m[t.vendor] || 0) - t.amount;
  return Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n);
}
// Count the saved figure up from its previous value: the one orchestrated motion.
let lastSaved = 0;
function animateCount() {
  const el = document.querySelector('[data-count]'); if (!el) return;
  const to = +el.dataset.count; const from = lastSaved; lastSaved = to;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) return;
  const t0 = performance.now(); const dur = 650;
  const step = (now) => { const k = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - k, 3); el.textContent = eur(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); else el.textContent = eur(to); };
  requestAnimationFrame(step);
}

// ---------------- charts (inline SVG), one bar per period of the chosen type ----------------
let W = 340; const PAD = 34;
const WIDE = matchMedia('(min-width: 960px)');
WIDE.addEventListener('change', () => render());
const wideW = () => (WIDE.matches ? 720 : 340);
function scale(min, max, hgt, top = 10) { const span = max - min || 1; return (v) => top + (max - v) / span * hgt; }
function axis(y, min, max, unit = '') {
  const ticks = [min, 0, max].filter((v, i, a) => a.indexOf(v) === i && v >= min && v <= max);
  return ticks.map((v) => `<line x1="${PAD}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'zero' : 'grid'}"/><text x="${PAD - 4}" y="${y(v) + 3}" class="tick" text-anchor="end">${v === 0 ? '0' : (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v))}${v ? unit : ''}</text>`).join('');
}
function series() {
  const mode = state.period.mode === 'all' ? 'month' : state.period.mode;
  return periodList(mode).map((k) => ({ key: k, label: periodLabel(k, mode, true), sel: state.period.mode === 'all' || k === state.period.key, ...sumMonths(monthsIn(k, mode)) }));
}
function chartFlows() {
  W = wideW(); const S = series(); const H = WIDE.matches ? 200 : 150;
  const out = S.map((s) => s.spent + s.india);
  const max = Math.max(...S.map((s) => s.earned), ...out, 1), min = Math.min(0, ...S.map((s) => s.saved));
  const y = scale(min, max, H); const bw = (W - PAD) / S.length;
  const px = (i) => PAD + i * bw + bw * 0.43;
  const bars = S.map((s, i) => {
    const x = PAD + i * bw; const sel = s.sel ? ' sel' : '';
    return `<rect x="${x + bw * 0.12}" width="${bw * 0.3}" y="${y(s.earned)}" height="${y(0) - y(s.earned)}" rx="3" class="b-in${sel}"/>
      <rect x="${x + bw * 0.44}" width="${bw * 0.3}" y="${y(out[i])}" height="${y(0) - y(out[i])}" rx="3" class="b-out${sel}"/>
      <text x="${px(i)}" y="${H + 26}" class="tick" text-anchor="middle">${h(s.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H + 32}" class="chart" role="img" aria-label="Earned, spent and saved per period">${axis(y, Math.round(min), Math.round(max))}${bars}<polyline points="${S.map((s, i) => `${px(i)},${y(s.saved)}`).join(' ')}" class="l-sav"/>${S.map((s, i) => `<circle cx="${px(i)}" cy="${y(s.saved)}" r="3.5" class="d-sav"/>`).join('')}</svg>
  <p class="legend"><span><i class="k-in"></i>Earned</span><span><i class="k-out"></i>Spent and sent to India</span><span><i class="k-sav"></i>Saved</span></p>`;
}
function chartRate() {
  W = 340; const S = series(); const H = 110;
  const v = S.map((s) => s.savingsRate * 100);
  const max = Math.max(10, ...v), min = Math.min(0, ...v);
  const y = scale(min, max, H); const bw = (W - PAD) / S.length;
  const px = (i) => PAD + i * bw + bw / 2;
  const area = `${px(0)},${y(0)} ${v.map((r, i) => `${px(i)},${y(r)}`).join(' ')} ${px(v.length - 1)},${y(0)}`;
  return `<svg viewBox="0 0 ${W} ${H + 32}" class="chart" role="img" aria-label="Savings rate per period">${axis(y, Math.round(min), Math.round(max), '%')}<polygon points="${area}" class="a-rate"/><polyline points="${v.map((r, i) => `${px(i)},${y(r)}`).join(' ')}" class="l-rate"/>${v.map((r, i) => `<circle cx="${px(i)}" cy="${y(r)}" r="3.5" class="d-rate"/><text x="${px(i)}" y="${y(r) - 8}" class="val" text-anchor="middle">${Math.round(r)}%</text><text x="${px(i)}" y="${H + 26}" class="tick" text-anchor="middle">${h(S[i].label)}</text>`).join('')}</svg>
  <p class="fine">Saved as a share of earned income.</p>`;
}
const GROUP_COLORS = ['var(--indigo)', 'var(--sky)', 'var(--lagoon)', 'var(--saffron)', 'var(--rose)', '#8E7CF0', '#2BA6B8', 'var(--slate)', '#C77D4A', '#5FB36B'];
function chartStack() {
  W = wideW(); const S = series(); const H = WIDE.matches ? 200 : 150;
  const used = state.agg.order.filter((l) => l.sec === 'variable');
  const groups = [...new Set(used.map((l) => l.group || 'Other'))];
  const mode = state.period.mode === 'all' ? 'month' : state.period.mode;
  const val = (g, key) => { const ms = monthsIn(key, mode); return -state.agg.rows.filter((t) => t.line && ms.includes(monthOf(t.date)) && lineMeta(t.line).sec === 'variable' && (lineMeta(t.line).group || 'Other') === g).reduce((a, t) => a + t.amount, 0); };
  const max = Math.max(...S.map((s) => s.variable), 1);
  const y = scale(0, max, H); const bw = (W - PAD) / S.length;
  const bars = S.map((s, i) => {
    let acc = 0; const x = PAD + i * bw + bw * 0.18;
    return `<g opacity="${s.sel ? 1 : 0.45}">${groups.map((g, gi) => { const v = Math.max(0, val(g, s.key)); const r = `<rect x="${x}" width="${bw * 0.64}" y="${y(acc + v)}" height="${Math.max(0, y(acc) - y(acc + v) - 1)}" fill="${GROUP_COLORS[gi % GROUP_COLORS.length]}"/>`; acc += v; return r; }).join('')}</g><text x="${x + bw * 0.32}" y="${H + 26}" class="tick" text-anchor="middle">${h(s.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H + 32}" class="chart" role="img" aria-label="Variable spend by category per period">${axis(y, 0, Math.round(max))}${bars}</svg>
  <p class="legend">${groups.map((g, gi) => `<span><i style="background:${GROUP_COLORS[gi % GROUP_COLORS.length]}"></i>${h(g)}</span>`).join('')}</p>`;
}
function barsH(items) {
  const max = items[0][1];
  return `<ul class="hbars">${items.map(([k, v]) => `<li><span>${h(k)}</span><b>${eur(v)}</b><i style="width:${(v / max * 100).toFixed(1)}%"></i></li>`).join('')}</ul>`;
}

// ---------------- months (workbook-style tables) + search ----------------
function shortDates(dates) {
  const s = [...dates].sort(); const dm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  return s.length > 3 ? `${s.length}x · ${dm(s[0])}–${dm(s[s.length - 1])}` : s.map(dm).join(', ');
}
const SEG = [['fixed', 'Fixed'], ['variable', 'Variable'], ['onetime', 'One-time'], ['income', 'Income'], ['search', 'Search']];
function monthsView() {
  const seg = `<div class="seg" role="tablist">${SEG.map(([k, l]) => `<button role="tab" aria-selected="${state.section === k}" data-section="${k}">${l}</button>`).join('')}</div>`;
  if (state.section === 'search') return topbar('Months') + familyStrip('together') + seg + searchView();
  const a = state.agg; const ms = a.months;
  const secs = state.section === 'income' ? ['income', 'india', 'passthrough', 'tosav', 'fromsav'] : [state.section];
  const ls = a.order.filter((l) => secs.includes(l.sec));
  let group = null;
  const rows = ls.map((l) => {
    const sign = ['income', 'passthrough', 'fromsav'].includes(l.sec) ? 1 : -1;
    const g = state.section === 'variable' ? l.group : state.section === 'income' ? (l.sec === 'income' ? 'Earned income' : SECTIONS[l.sec]) : '';
    let bar = '';
    if (g && g !== group) { group = g; bar = `<tr class="bar"><th colspan="${ms.length + 2}">${h(g)}</th></tr>`; }
    let tot = 0;
    const cells = ms.map((m) => { const c = a.cell[`${l.id}|${m}`]; if (!c) return '<td class="nil">–</td>'; tot += sign * c.amt; return `<td><button data-cell="${h(l.id)}|${m}">${n2(sign * c.amt)}<small>${h(shortDates(c.dates))}</small></button></td>`; }).join('');
    return `${bar}<tr><th>${h(l.label)}</th>${cells}<td class="tot">${n2(tot)}</td></tr>`;
  }).join('');
  const footRow = (label, key) => `<tr class="total"><th>${label}</th>${a.summary.map((s) => `<td>${n2(s[key])}</td>`).join('')}<td class="tot">${n2(a.summary.reduce((x, s) => x + s[key], 0))}</td></tr>`;
  const foot = state.section === 'income'
    ? [['Earned income', 'earned'], ['Total spent', 'spent'], ['Sent to India (own money)', 'india'], ['Saved', 'saved'], ['Moved to savings, net', 'netToSav'], ['Kept in account', 'kept']].map(([l, k]) => footRow(l, k)).join('')
    : footRow('Total', state.section);
  return `${topbar('Months')}${familyStrip('together')}${seg}<div class="tablewrap"><table class="grid"><thead><tr><th>Line</th>${ms.map((m) => `<th>${monthLabel(m, true)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${rows || `<tr><td colspan="${ms.length + 2}" class="fine">Nothing in this section yet.</td></tr>`}</tbody><tfoot>${foot}</tfoot></table></div>
  <p class="fine pad">Tap an amount to see its bookings and move any of them to another line.</p>`;
}
function searchView() {
  return `<div class="pad"><input type="search" id="q" placeholder="Vendor, text or amount" value="${h(state.q)}" autocomplete="off"></div><div id="results">${searchResults()}</div>`;
}
function searchResults() {
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const all = [...state.agg.rows].sort((x, y) => y.date.localeCompare(x.date));
  const hit = terms.length ? all.filter((t) => { const hay = `${t.vendor} ${t.text} ${n2(Math.abs(t.amount))} ${Math.abs(t.amount)} ${deDate(t.date)} ${lineLabel(t.line)}`.toLowerCase(); return terms.every((w) => hay.includes(w)); }) : all;
  const shown = hit.slice(0, 80);
  return `<p class="fine pad">${terms.length ? `${hit.length} match${hit.length === 1 ? '' : 'es'}` : `All ${hit.length} bookings, newest first`}${hit.length > 80 ? ' · showing 80' : ''}</p>
  <ul class="results">${shown.map((t) => `<li><button data-tx="${h(t.id)}"><span><b>${h(t.vendor)}</b><small>${deDate(t.date)} · ${h(lineLabel(t.line))}</small></span><strong class="${t.amount > 0 ? 'pos' : ''}">${eur(t.amount)}</strong></button></li>`).join('')}</ul>`;
}

// ---------------- picking a line ----------------
function lineOptions(selected) {
  const trips = (state.settings.trips || []).map((t) => ({ id: `trip:${t.name}`, sec: 'variable', label: lineLabel(`trip:${t.name}`) }));
  const L = [...lines(), ...trips];
  const order = ['fixed', 'variable', 'onetime', 'income', 'india', 'passthrough', 'tosav', 'fromsav', 'offset'];
  return order.map((sec) => { const ls = L.filter((l) => l.sec === sec); return ls.length ? `<optgroup label="${h(SECTIONS[sec])}">${ls.map((l) => `<option value="${h(l.id)}"${l.id === selected ? ' selected' : ''}>${h(l.label)}</option>`).join('')}</optgroup>` : ''; }).join('')
    + '<optgroup label="Something else"><option value="__new">＋ New line…</option></optgroup>';
}
function txList(txs, allDefault = false) {
  return `<ul class="txs">${[...txs].sort((x, y) => x.date.localeCompare(y.date)).map((t) => `<li>
    <div><b>${h(t.vendor)}</b><span>${deDate(t.date)}${t.cardDate && t.cardDate !== t.date ? ` · paid ${deDate(t.cardDate)}` : ''}</span></div>
    <strong class="${t.amount < 0 ? '' : 'pos'}">${eur(t.amount)}</strong>
    <label>Line <select data-txline="${h(t.id)}">${t.line ? '' : '<option value="" selected>Choose a line…</option>'}${lineOptions(t.line)}</select></label>
    <label class="check"><input type="checkbox" data-txall="${h(t.id)}"${allDefault ? ' checked' : ''}> Apply to every booking from ${h(t.vendor)}</label>
    ${t.amount < 0 ? `<button class="link small" data-onetime="${h(t.id)}">Make this a one-time item…</button>` : ''}
    <details><summary>Booking text</summary><p>${h(t.text)}</p></details></li>`).join('')}</ul>`;
}
async function assign(txId, lineId, allFromVendor) {
  const t = txById(txId); if (!t) return;
  await change(`Moved to ${lineLabel(lineId)}${allFromVendor ? `, for every booking from ${t.vendor}` : ''}`, (s) => {
    if (allFromVendor) { s.vendorRules[t.vkey] = lineId; delete s.txRules[t.id]; } else s.txRules[t.id] = lineId;
  });
}

// New line (any section). ctx = { txId, all } when created while categorising a booking.
let pendingNew = null;
function newLineSheet(ctx, presetSec = 'variable', presetName = '') {
  pendingNew = ctx;
  const groups = [...new Set(lines().filter((l) => l.sec === 'variable').map((l) => l.group).filter(Boolean))];
  sheet(`<h2>New line</h2>
  <form class="stack" data-act="newline">
    <label>Name<input name="label" required value="${h(presetName)}" placeholder="e.g. Netflix, Laptop, Kita fees"></label>
    <label>Section<select name="sec">${USER_SECTIONS.map((s) => `<option value="${s}"${s === presetSec ? ' selected' : ''}>${h(SECTIONS[s])}</option>`).join('')}</select></label>
    <label class="grp">Group (variable only)<select name="group">${groups.map((g) => `<option>${h(g)}</option>`).join('')}<option value="__newgroup">New group…</option></select></label>
    <label class="grp">New group name<input name="newgroup" placeholder="Only if you chose New group"></label>
    <button class="btn primary">Create${ctx ? ' and assign' : ''}</button>
    <button type="button" class="btn" data-act="close">Cancel</button>
  </form>`);
}
function oneTimeSheet(txId) {
  const t = txById(txId); const ot = lines().filter((l) => l.sec === 'onetime');
  sheet(`<h2>One-time item</h2><p class="fine">${h(t.vendor)} · ${deDate(t.date)} · ${eur(t.amount)}. Only this booking moves; other bookings from ${h(t.vendor)} stay where they are.</p>
  <form class="stack" data-act="onetime" data-tx="${h(txId)}">
    <label>Name the item<input name="label" value="" placeholder="e.g. New laptop" autocomplete="off"></label>
    <p class="fine">or add it to an existing one-time line:</p>
    <select name="existing"><option value="">—</option>${ot.map((l) => `<option value="${h(l.id)}">${h(l.label)}</option>`).join('')}</select>
    <button class="btn primary">Move to one-time</button>
    <button type="button" class="btn" data-act="close">Cancel</button>
  </form>`);
}
function createLine(s, { label, sec, group }) {
  const id = `c.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  (s.profile ||= emptyProfile()).lines = [...(s.profile.lines || []), { id, sec, label, group: sec === 'variable' ? group : '' }];
  return id;
}

// ---------------- review ----------------
function reviewView() {
  const r = state.agg.review; const f = state.agg.flags; const pf = state.agg.passFlags;
  const passHtml = pf.length ? `<section class="pad"><h1 class="h1">Forwarded to India?</h1><p class="fine">Money came in from your savings account in a month when you also sent money to India. If you passed it on, it is not a top-up and does not reduce your savings.</p></section>
  ${pf.map((t) => `<section class="card flag"><div><b>${h(t.vendor)}</b><span>${deDate(t.date)}, ${eur(t.india)} sent to India that month</span></div><strong class="pos">${eur(t.amount)}</strong>
    <div class="row"><button class="btn primary" data-passyes="${h(t.id)}">Yes, forwarded</button><button class="btn" data-dismiss="${h(t.id)}">No, a top-up</button></div></section>`).join('')}` : '';
  if (!r.length && !f.length && !pf.length) return `${topbar('Review')}${familyStrip('thinking')}<section class="empty small"><h1>Nothing to review</h1><p>Every booking matched a rule or one of your answers, and nothing looks like a one-time spend.</p></section>`;
  const byV = {};
  for (const t of r) (byV[t.vkey] ||= []).push(t);
  return `${topbar('Review')}${familyStrip('thinking')}${passHtml}${r.length ? `<section class="pad"><h1 class="h1">Unknown vendors</h1><p class="fine">Pick a line once; with "Apply to every booking" ticked, the app uses it for this vendor from now on.</p></section>
  ${Object.values(byV).map((ts) => `<section class="card">${txList(ts.slice(0, 1), true)}${ts.length > 1 ? `<p class="fine">${ts.length} bookings from this vendor: ${ts.map((t) => eur(t.amount)).join(', ')}</p>` : ''}</section>`).join('')}` : ''}
  ${f.length ? `<section class="pad"><h1 class="h1">Possible one-time items</h1><p class="fine">These are at least three times the usual amount for their line.</p></section>
  ${f.map((t) => `<section class="card flag"><div><b>${h(t.vendor)}</b><span>${deDate(t.date)} · ${h(lineLabel(t.line))} · usually around ${eur(t.median)}</span></div><strong>${eur(t.amount)}</strong>
    <div class="row"><button class="btn primary" data-onetime="${h(t.id)}">One-time…</button><button class="btn" data-dismiss="${h(t.id)}">Regular spend</button></div></section>`).join('')}` : ''}`;
}

// ---------------- data ----------------
function dataView() {
  const rec = reconcile(state.tx, pdfStatements());
  const cps = state.statements.filter((s) => s.kind === 'checkpoint');
  const anchor = rec[0];
  const cpRows = cps.map((c) => {
    if (!anchor) return `<li><div><b>CSV ${deDate(c.date)}</b><span>Add a PDF statement to check</span></div></li>`;
    const computed = Math.round((anchor.open + state.tx.filter((t) => t.date >= anchor.from && t.date <= c.date).reduce((a, t) => a + t.amount, 0)) * 100) / 100;
    const ok = Math.abs(computed - c.close) < 0.005;
    return `<li class="${ok ? 'ok' : 'bad'}"><div><b>Balance on ${deDate(c.date)} (CSV)</b><span>${ok ? 'Ties' : `Off by ${eur(computed - c.close)}`}</span></div><p>Computed ${n2(computed)} · bank ${n2(c.close)}</p></li>`;
  }).join('');
  const s = state.settings; const d = daysSince(state.lastBackup);
  const nAns = live(s.vendorRules).length + live(s.txRules).length;
  const own = (s.profile?.lines || []).filter((l) => l.id.startsWith('c.')).length;
  const theme = currentTheme();
  return `${topbar('Data')}${familyStrip('question')}<div class="data-grid">${cloudCard()}${familyCard()}<section class="card">
    <h2>Add statements</h2>
    <p class="fine">PDF Kontoauszug or CSV export. Overlapping files are fine: bookings already stored are skipped.</p>
    <label class="btn primary">Choose files<input type="file" accept=".pdf,.csv,.json,application/pdf,text/csv,application/json" multiple data-act="import" hidden></label>
  </section>
  <section class="card">
    <h2>Your rules and answers</h2>
    <p class="fine">${s.profile ? `${(s.profile.rules || []).length} rules from your rules file, ` : 'No rules file loaded, '}${nAns} answer${nAns === 1 ? '' : 's'} from Review, ${own} line${own === 1 ? '' : 's'} you created. All of it lives only on this phone, in your backups and in the exported rules file.</p>
    <div class="row"><button class="btn" data-act="manage">Manage</button><button class="btn" data-act="newline">New line</button><button class="btn" data-act="exportrules">Export rules</button><label class="btn">Load rules file<input type="file" accept=".json,application/json" data-act="import" hidden></label></div>
  </section>
  <section class="card">
    <h2>Backup</h2>
    <p class="fine">${d === null ? 'No backup yet.' : `Last backup: ${d === 0 ? 'today' : `${d} day${d > 1 ? 's' : ''} ago`}.`} Safari can clear this app's storage, so keep a copy in Files or iCloud Drive. To share with family, save it to a shared iCloud folder; restoring keeps the answers made on their phone.</p>
    <div class="row"><button class="btn primary" data-act="backup">Export backup</button><label class="btn">Restore backup<input type="file" accept=".json,application/json" data-act="import" hidden></label></div>
  </section>
  <section class="card">
    <h2>Excel workbook</h2>
    <p class="fine">Fixed, Variable Expenses, One-Time, Income &amp; Transfers (with the savings summary), plus Reconciliation and all transactions.</p>
    <button class="btn primary" data-act="excel">Export Excel</button>
  </section>
  <section class="card">
    <h2>Appearance</h2>
    <div class="themes" role="group" aria-label="Theme">${THEMES.map(([k, l]) => `<button data-themeset="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}</div>
    <p class="fine">Auto follows your phone or laptop setting.</p>
  </section>
  <section class="card wide">
    <h2>Reconciliation</h2>
    ${rec.length || cpRows ? `<ul class="recon-list">${rec.map((x) => { const ok = Math.abs(x.diff) < 0.005 && x.chainOk; return `<li class="${ok ? 'ok' : 'bad'}"><div><b>${deDate(x.from)} – ${deDate(x.to)}</b><span>${ok ? 'Ties' : Math.abs(x.diff) >= 0.005 ? `Off by ${eur(x.diff)}` : `Gap: opening ≠ ${deDate(x.gapFrom)} closing`}</span></div><p>${n2(x.open)} − ${n2(-x.debits)} + ${n2(x.credits)} = <b>${n2(x.computed)}</b> · bank: ${n2(x.close)}</p></li>`; }).join('')}${cpRows}</ul>` : '<p class="fine">Import a PDF statement to see the balance check.</p>'}
  </section>
  <section class="card">
    <h2>Trips</h2>
    <p class="fine">Spend paid between these dates gets its own trip line: restaurants only, or all variable spend.</p>
    <ul class="trips">${(s.trips || []).map((t, i) => `<li><span>${h(t.name)}<small>${t.scope === 'all' ? 'All variable spend' : 'Restaurants only'}</small></span><span>${deDate(t.from)} – ${deDate(t.to)}</span><button class="link" data-deltrip="${i}">Remove</button></li>`).join('')}</ul>
    <form class="tripform" data-act="addtrip"><input name="name" placeholder="Trip name" required><input name="from" type="date" required><input name="to" type="date" required><label class="check span"><input type="checkbox" name="all"> Include all variable spend, not just restaurants</label><button class="btn">Add trip</button></form>
  </section>
  <section class="card">
    <h2>Tracking starts</h2>
    <form class="row" data-act="start"><input type="month" name="start" value="${s.startMonth || ''}"><button class="btn">Save</button></form>
  </section>
  <section class="card danger">
    <h2>Erase data on this phone</h2>
    <p class="fine">Removes all bookings, statements, rules and answers. Export a backup first.</p>
    <button class="btn warn" data-act="wipe">Erase everything</button>
  </section></div>
  <p class="fine pad">${state.tx.length} bookings stored on this device. Works offline; nothing is sent anywhere.</p>`;
}

function manageSheet() {
  const s = state.settings;
  const v = live(s.vendorRules);
  const b = live(s.txRules);
  const own = (s.profile?.lines || []).filter((l) => l.id.startsWith('c.'));
  const nDis = live(s.flagDismissed).length;
  const usage = (id) => state.agg.rows.filter((t) => t.line === id).length;
  sheet(`<h2>Your answers and lines</h2>
  <h3>Vendor answers (${v.length})</h3>
  ${v.length ? `<ul class="manage">${v.map(([k, id]) => `<li><span><b>${h(k)}</b><small>→ ${h(lineLabel(id))}</small></span><button class="link" data-delvendor="${h(k)}">Remove</button></li>`).join('')}</ul>` : '<p class="fine">None yet.</p>'}
  <h3>Single-booking answers (${b.length})</h3>
  ${b.length ? `<ul class="manage">${b.map(([id, line]) => { const t = txById(id); return `<li><span><b>${h(t ? t.vendor : id)}</b><small>${t ? `${deDate(t.date)} · ${eur(t.amount)} ` : ''}→ ${h(lineLabel(line))}</small></span><button class="link" data-deltx="${h(id)}">Remove</button></li>`; }).join('')}</ul>` : '<p class="fine">None yet.</p>'}
  <h3>Lines you created (${own.length})</h3>
  ${own.length ? `<ul class="manage">${own.map((l) => `<li><span><b>${h(l.label)}</b><small>${h(SECTIONS[l.sec])}${l.group ? ` · ${h(l.group)}` : ''} · ${usage(l.id)} booking${usage(l.id) === 1 ? '' : 's'}</small></span><span class="row"><button class="link" data-renline="${h(l.id)}">Rename</button><button class="link danger" data-delline="${h(l.id)}">Remove</button></span></li>`).join('')}</ul>` : '<p class="fine">None yet.</p>'}
  ${nDis ? `<h3>Confirmed as regular spend (${nDis})</h3><button class="link" data-act="resetflags">Show these as possible one-time items again</button>` : ''}
  <p class="fine">Removing an answer sends its bookings back to the rules (or to Review if no rule matches). Every change can be undone.</p>
  <button class="btn" data-act="close">Done</button>`);
}

function showImportReport(r) {
  const review = state.agg.review.length;
  sheet(`<h2>${r.errors.length && !r.added && !r.files.length ? 'Import failed' : 'Import finished'}</h2>
    <ul class="report">${r.files.map((f) => `<li>${h(f)}</li>`).join('')}${r.errors.map((e) => `<li class="bad">${h(e)}</li>`).join('')}</ul>
    ${r.added || r.dup ? `<p>${r.added} new booking${r.added === 1 ? '' : 's'} added${r.dup ? `, ${r.dup} duplicate${r.dup === 1 ? '' : 's'} skipped` : ''}.${review ? ` ${review} need${review === 1 ? 's' : ''} review.` : ''}</p>` : ''}
    ${r.added ? '<p class="fine">Save a backup now so these bookings survive if Safari clears its storage.</p><button class="btn primary" data-act="backup">Export backup</button>' : ''}
    ${review || state.agg.flags.length || state.agg.passFlags.length ? '<button class="btn" data-act="goreview">Open Review</button>' : ''}
    <button class="btn" data-act="close">Done</button>`);
}

// ---------------- events ----------------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button, [data-section], [data-cell]');
  if (!b) return;
  const ds = b.dataset;
  if (ds.tab) { closeSheet(); state.tab = ds.tab; render(); window.scrollTo(0, 0); return; }
  if (ds.pmode) { state.period.mode = ds.pmode; state.period.key = null; render(); return; }
  if (ds.pkey) { state.period.key = ds.pkey; render(); return; }
  if (ds.themeset) { applyTheme(ds.themeset); render(); return; }
  if (ds.section) { state.section = ds.section; render(); return; }
  if (ds.cell) {
    const c = state.agg.cell[ds.cell]; const i = ds.cell.lastIndexOf('|'); const id = ds.cell.slice(0, i), m = ds.cell.slice(i + 1);
    sheet(`<h2>${h(lineLabel(id))}</h2><p class="fine">${monthLabel(m)} · ${c.txs.length} booking${c.txs.length > 1 ? 's' : ''} · ${eur(c.amt)}</p>${txList(c.txs)}<button class="btn" data-act="close">Done</button>`);
    return;
  }
  if (ds.tx) { const t = txById(ds.tx); sheet(`<h2>${h(t.vendor)}</h2>${txList([t])}<button class="btn" data-act="close">Done</button>`); return; }
  if (ds.onetime) { oneTimeSheet(ds.onetime); return; }
  if (ds.redo) {
    const id = ds.redo; const p = state.pendingFamily; showBusy('Redrawing…');
    try { p.set[id] = await F.redoOne({ key: state.family.key, model: cfg.geminiModel || 'gemini-3.1-flash-image', photo: p.photo, base: p.set.base, id }); previewSheet(); } catch (e) { toast(e.message); } finally { hideBusy(); }
    return;
  }
  if (ds.passyes) { const id = ds.passyes; await change('Marked as forwarded to India', (s) => { s.txRules[id] = 'pt.in'; }); return; }
  if (ds.dismiss) { const id = ds.dismiss; await change('Kept as regular spend', (s) => { (s.flagDismissed ||= {})[id] = true; }); return; }
  if (ds.deltrip) { const i = +ds.deltrip; await change('Trip removed', (s) => { s.trips.splice(i, 1); }); return; }
  if (ds.delvendor) { const k = ds.delvendor; await change('Vendor answer removed', (s) => { delete s.vendorRules[k]; }); manageSheet(); return; }
  if (ds.deltx) { const k = ds.deltx; await change('Booking answer removed', (s) => { delete s.txRules[k]; }); manageSheet(); return; }
  if (ds.renline) {
    const l = state.settings.profile.lines.find((x) => x.id === ds.renline);
    const name = prompt('New name for this line', l.label); if (!name || !name.trim()) return;
    await change('Line renamed', (s) => { s.profile.lines.find((x) => x.id === l.id).label = name.trim(); }); manageSheet(); return;
  }
  if (ds.delline) {
    const id = ds.delline; const n = state.agg.rows.filter((t) => t.line === id).length;
    if (n && !confirm(`${n} booking${n > 1 ? 's use' : ' uses'} this line. They will go back to the rules or to Review. Remove it?`)) return;
    await change('Line removed', (s) => {
      s.profile.lines = s.profile.lines.filter((x) => x.id !== id);
      for (const k of Object.keys(s.vendorRules)) if (s.vendorRules[k] === id) delete s.vendorRules[k];
      for (const k of Object.keys(s.txRules)) if (s.txRules[k] === id) delete s.txRules[k];
    });
    manageSheet(); return;
  }
  const act = ds.act;
  if (act === 'backup') await exportBackup();
  else if (act === 'excel') await exportExcel();
  else if (act === 'exportrules') await exportRules();
  else if (act === 'manage') manageSheet();
  else if (act === 'familysave') {
    const { base, ...images } = state.pendingFamily.set;
    state.family = { ...(state.family || {}), images, stamp: Date.now() }; state.pendingFamily = null;
    await saveFamily(); closeSheet(); lastMood = null; render(); markChanged(); toast('Family pictures saved');
  }
  else if (act === 'familycancel') { state.pendingFamily = null; closeSheet(); }
  else if (act === 'familyremove') { if (!confirm('Remove the family pictures from all devices?')) return; state.family = { ...(state.family || {}), images: {}, stamp: Date.now() }; await saveFamily(); render(); markChanged(); }
  else if (act === 'familykey') { state.family = { ...(state.family || {}), key: '' }; render(); }
  else if (act === 'gsignin') C.signIn(cfg.googleClientId, 'sync');
  else if (act === 'syncnow') await syncNow();
  else if (act === 'pickvault') await cloudAction('Opening Google Drive…', async () => { const id = await C.pickVault(cloud.token.token, cfg.googleApiKey, cfg.googleAppId); if (id) { cloud.meta = { fileId: id, owner: false }; await saveCloudMeta(); } });
  else if (act === 'lockvault') { cloud.key = null; await kvSet('cloudKey', null); refreshStatus(); render(); toast('Vault locked on this device'); }
  else if (act === 'forgetvault' || act === 'disconnect') {
    if (act === 'disconnect' && !confirm('Stop syncing this device? Data stays here and in Google Drive.')) return;
    cloud.meta = null; cloud.key = null; cloud.dirty = false; await kvSet('cloud', null); await kvSet('cloudKey', null); refreshStatus(); render();
  }
  else if (act === 'theme') { applyTheme(isDark() ? 'light' : 'dark'); render(); }
  else if (act === 'newline') newLineSheet(null);
  else if (act === 'undo') { $('#toast').hidden = true; await undo(); }
  else if (act === 'resetflags') { await change('One-time checks reset', (s) => { s.flagDismissed = {}; }); manageSheet(); }
  else if (act === 'close') closeSheet();
  else if (act === 'goreview') { closeSheet(); state.tab = 'review'; render(); }
  else if (act === 'wipe') {
    if (!confirm('Erase all bookings, statements, rules and answers on this phone?')) return;
    await clear('tx'); await clear('statements'); await clear('kv');
    state.tx = []; state.statements = []; state.settings = fresh(); state.lastBackup = null; state.undo = []; cloud.meta = null; cloud.key = null; cloud.token = null; state.family = null; refreshStatus(); recompute(); render();
  }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.act === 'import' && t.files.length) { await importFiles([...t.files]); t.value = ''; return; }
  if (t.dataset.act === 'familyphoto' && t.files.length) { const file = t.files[0]; t.value = ''; await generateFamily(file); return; }
  if (t.dataset.txline !== undefined && t.value) {
    const allBox = document.querySelector(`[data-txall="${CSS.escape(t.dataset.txline)}"]`);
    const all_ = !!(allBox && allBox.checked);
    if (t.value === '__new') { newLineSheet({ txId: t.dataset.txline, all: all_ }); return; }
    await assign(t.dataset.txline, t.value, all_);
    const li = t.closest('li'); if (li) li.classList.add('saved');
  }
  if (t.name === 'sec') { const f = t.form; f.querySelectorAll('.grp').forEach((g) => { g.hidden = t.value !== 'variable'; }); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { state.q = e.target.value; $('#results').innerHTML = searchResults(); }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const fd = new FormData(f);
  if (f.dataset.act === 'addtrip') {
    if (fd.get('to') < fd.get('from')) { alert('The trip ends before it starts.'); return; }
    const trip = { name: fd.get('name').trim(), from: fd.get('from'), to: fd.get('to'), scope: fd.get('all') ? 'all' : 'dining' };
    await change(`Trip "${trip.name}" added`, (s) => { s.trips.push(trip); });
  } else if (f.dataset.act === 'start') {
    const v = fd.get('start') || null; await change('Start month saved', (s) => { s.startMonth = v; });
  } else if (f.dataset.act === 'newline') {
    const sec = fd.get('sec'); let group = fd.get('group');
    if (group === '__newgroup') group = (fd.get('newgroup') || '').trim() || 'Other';
    const ctx = pendingNew; pendingNew = null;
    const label = fd.get('label').trim();
    const tx = ctx ? txById(ctx.txId) : null;
    closeSheet();
    await change(tx ? `Created "${label}" and moved ${tx.vendor}` : `Line "${label}" created`, (s) => {
      const id = createLine(s, { label, sec, group });
      if (tx) { if (ctx.all) s.vendorRules[tx.vkey] = id; else s.txRules[tx.id] = id; }
    });
  } else if (f.dataset.act === 'onetime') {
    const txId = f.dataset.tx; const label = (fd.get('label') || '').trim(); const existing = fd.get('existing');
    if (!label && !existing) { alert('Name the item or pick an existing one-time line.'); return; }
    closeSheet();
    await change(`Moved to one-time: ${label || lineLabel(existing)}`, (s) => {
      s.txRules[txId] = existing || createLine(s, { label, sec: 'onetime', group: '' });
      if (s.flagDismissed) s.flagDismissed[txId] = null;
    });
  } else if (f.dataset.act === 'geminikey') {
    const k = fd.get('key').trim(); if (!k || k.startsWith('••')) { render(); return; }
    state.family = { ...(state.family || {}), key: k, stamp: Date.now() }; await saveFamily(); render(); markChanged(); toast('Gemini key saved');
  } else if (f.dataset.act === 'createvault') {
    if (fd.get('p1') !== fd.get('p2')) { alert('The two passphrases are different.'); return; }
    await cloudAction('Creating your encrypted vault…', () => createVaultFlow(fd.get('p1'), !!fd.get('remember')));
  } else if (f.dataset.act === 'unlock') {
    await cloudAction('Unlocking…', () => unlockFlow(fd.get('p'), !!fd.get('remember')));
  }
});
async function cloudAction(msg, fn) {
  showBusy(msg);
  try { await fn(); refreshStatus(); toast('Cloud sync is on'); }
  catch (e) { if (e.code === 401) { cloud.token = null; await kvSet('gtoken', null); } refreshStatus(); toast(e.message); }
  finally { hideBusy(); render(); }
}
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

// ---------------- boot ----------------
(async () => {
  if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch { /* not granted */ } }
  await load(); await loadCloud();
  const red = C.readRedirect();
  if (red && red.token) { cloud.token = { token: red.token, exp: red.exp }; await kvSet('gtoken', cloud.token); refreshStatus(); if (!cloud.meta || !cloud.meta.fileId) { state.tab = 'data'; try { await chooseVault(); } catch (e) { toast(e.message); } } }
  else if (red && red.error) { state.tab = 'data'; toast(red.error); }
  refreshStatus(); render();
  if (cloud.status === 'synced') syncNow(true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && cloud.status === 'synced') syncNow(true); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js');
  window.__app = { state, cloud, importFiles, exportExcel, buildWorkbook, reconcile, refresh: () => { recompute(); render(); } }; // used by automated checks
})();
