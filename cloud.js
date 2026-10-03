// Encrypted sync with Google Drive. No server: the browser talks to Google directly.
// The vault file in Drive holds only ciphertext (AES-GCM 256, key derived from your passphrase).
// Google identifiers come from config.js (public by design: they only work from this app's address).

const enc = new TextEncoder(), dec = new TextDecoder();
export const VAULT_NAME = 'finance-vault.json';
const SCOPE = 'https://www.googleapis.com/auth/drive.file'; // only files this app created or you picked
const ITER = 310000;

// ---------- base64 (chunked, safe for large payloads) ----------
function b64(buf) {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) { const s = atob(str); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }

// ---------- encryption ----------
export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));
export async function deriveKey(passphrase, salt, iter = ITER, extractable = false) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(salt), iterations: iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']); // non-extractable unless app lock needs to seal it
}
export async function seal(obj, key, salt, iter = ITER) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return JSON.stringify({ app: 'finance-insights-vault', v: 1, kdf: 'PBKDF2-SHA256', iter, salt, iv: b64(iv), ct: b64(ct) });
}
export function vaultHeader(text) {
  const v = JSON.parse(text);
  if (v.app !== 'finance-insights-vault') throw new Error('This Drive file is not a vault from this app.');
  return v;
}
export async function unseal(text, key) {
  const v = vaultHeader(text);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, key, unb64(v.ct));
    return JSON.parse(dec.decode(pt));
  } catch { throw new Error("That passphrase doesn't open this vault."); }
}

// ---------- Google sign-in (redirect flow, no pop-ups) ----------
export const redirectUri = () => location.origin + location.pathname;
export function signIn(clientId, next = 'sync') {
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { localStorage.setItem('oauth_state', state); localStorage.setItem('oauth_next', next); } catch { /* storage blocked */ }
  const p = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE, include_granted_scopes: 'true', state });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
}
// Called on every start: picks up the token Google hands back in the address after sign-in.
export function readRedirect() {
  if (!/access_token=|error=/.test(location.hash)) return null;
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  let expected = null, next = 'sync';
  try { expected = localStorage.getItem('oauth_state'); next = localStorage.getItem('oauth_next') || 'sync'; localStorage.removeItem('oauth_state'); } catch { /* ignore */ }
  if (h.get('error')) return { error: h.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed (${h.get('error')}).` };
  if (!expected || h.get('state') !== expected) return { error: 'Google sign-in could not be verified. Try again.' };
  return { token: h.get('access_token'), exp: Date.now() + (Number(h.get('expires_in') || 3600) - 60) * 1000, next };
}

// ---------- Google sign-in in a window (laptop, Safari tab): no page reload ----------
// Home Screen apps on iPhone handle pop-up windows poorly, so they keep the redirect above.
export const isStandalone = () => !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
export async function signInWindow(clientId) {
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((res, rej) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: (r) => (r && r.access_token ? res({ token: r.access_token, exp: Date.now() + (Number(r.expires_in || 3600) - 60) * 1000 }) : rej(Object.assign(new Error(r && r.error_description ? r.error_description : 'Google sign-in failed.'), { code: 'failed' }))),
      error_callback: (e) => rej(Object.assign(new Error(e && e.type === 'popup_closed' ? 'Google sign-in was closed.' : 'The Google sign-in window could not open.'), { code: e && e.type })),
    });
    tc.requestAccessToken({ prompt: '' });
  });
}

// ---------- Drive ----------
async function api(token, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (r.status === 401) throw Object.assign(new Error('Google sign-in has expired.'), { code: 401 });
  if (r.status === 404) throw Object.assign(new Error('The vault file was not found in Google Drive (deleted, or no longer shared with you).'), { code: 404 });
  if (!r.ok) throw new Error(`Google Drive answered with error ${r.status}.`);
  return r;
}
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export async function findVault(token) {
  const q = encodeURIComponent(`name='${VAULT_NAME}' and trashed=false`);
  const r = await api(token, `${DRIVE}?q=${q}&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime,ownedByMe)`);
  return (await r.json()).files || [];
}
export async function fileMeta(token, id) { return (await api(token, `${DRIVE}/${id}?fields=id,name,modifiedTime,ownedByMe`)).json(); }
export async function download(token, id) { return (await api(token, `${DRIVE}/${id}?alt=media`)).text(); }
export async function createVault(token, text) {
  const boundary = `fin${Date.now()}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: VAULT_NAME, mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
  return (await api(token, `${UPLOAD}?uploadType=multipart&fields=id,modifiedTime`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json();
}
export async function updateVault(token, id, text) {
  return (await api(token, `${UPLOAD}/${id}?uploadType=media&fields=id,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text })).json();
}

// ---------- Google Picker: lets someone you shared the vault with open it once ----------
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load Google Picker. Check the internet connection.'));
    document.head.appendChild(s);
  });
}
export async function pickVault(token, apiKey, appId) {
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((res) => window.gapi.load('picker', res));
  const P = window.google.picker;
  return new Promise((res) => {
    const shared = new P.DocsView(P.ViewId.DOCS).setOwnedByMe(false).setIncludeFolders(true).setMimeTypes('application/json').setMode(P.DocsViewMode.LIST);
    const mine = new P.DocsView(P.ViewId.DOCS).setOwnedByMe(true).setIncludeFolders(true).setMimeTypes('application/json').setMode(P.DocsViewMode.LIST);
    new P.PickerBuilder().addView(shared).addView(mine).setOAuthToken(token).setDeveloperKey(apiKey).setAppId(appId)
      .setTitle(`Choose ${VAULT_NAME}`)
      .setCallback((d) => { if (d.action === P.Action.PICKED) res(d.docs[0].id); else if (d.action === P.Action.CANCEL) res(null); })
      .build().setVisible(true);
  });
}
