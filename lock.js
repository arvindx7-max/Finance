// App lock with Face ID / Touch ID. A passkey for this site, with the PRF extension, produces a secret
// that only appears after your face or fingerprint is verified. That secret becomes the AES key that
// encrypts everything the app stores on this device. Without Face ID, the stored data is unreadable.

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function available() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}

async function keyFromPrf(prfBytes, salt) {
  const base = await crypto.subtle.importKey('raw', prfBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: unb64(salt), info: enc.encode('finances-device-lock-v1') }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function prfFor(credId, prfSalt) {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [{ type: 'public-key', id: unb64(credId) }],
    userVerification: 'required', timeout: 60000,
    extensions: { prf: { eval: { first: unb64(prfSalt) } } },
  } });
  const r = cred.getClientExtensionResults();
  const out = r && r.prf && r.prf.results && r.prf.results.first;
  if (!out) throw Object.assign(new Error('This browser verified you but cannot provide an encryption key (Face ID encryption is not supported here).'), { code: 'noprf' });
  return out;
}

// After a passkey window closes (notably on the Mac), Safari needs a moment to give focus back to the page;
// a passkey request from an unfocused page fails with "The document is not focused".
function waitForFocus(ms = 4000) {
  if (document.hasFocus()) return Promise.resolve();
  return new Promise((res) => { const done = () => { window.removeEventListener('focus', done); res(); }; window.addEventListener('focus', done); setTimeout(done, ms); });
}
const notFocused = (e) => e && (e.name === 'NotAllowedError' || e.name === 'InvalidStateError') && /focus/i.test(e.message || '');
async function prfWhenFocused(credId, prfSalt) {
  await waitForFocus();
  try { return await prfFor(credId, prfSalt); }
  catch (e) { if (!notFocused(e)) throw e; await new Promise((r) => setTimeout(r, 400)); await waitForFocus(); return prfFor(credId, prfSalt); }
}

// Creates the passkey (or reuses one from an unfinished attempt), proves the PRF key works, returns { meta, key }.
// The key is asked for while the passkey is created, so normally only one Touch ID / Face ID prompt is needed.
const PENDING = 'finances-lock-pending';
export async function setup() {
  let pending = null; try { pending = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch { /* none */ }
  const prfSalt = pending ? pending.prfSalt : b64(crypto.getRandomValues(new Uint8Array(32)));
  const hkdfSalt = pending ? pending.hkdfSalt : b64(crypto.getRandomValues(new Uint8Array(16)));
  let credId = pending ? pending.credId : null; let prf = null;
  if (!credId) {
    let cred;
    try {
      cred = await navigator.credentials.create({ publicKey: {
        rp: { name: 'Finances' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Finances app lock', displayName: 'Finances app lock' },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000, extensions: { prf: { eval: { first: unb64(prfSalt) } } },
      } });
    } catch (e) { throw new Error(e.name === 'NotAllowedError' && !notFocused(e) ? 'Setup was cancelled.' : `Setup failed: ${e.message || e.name}`); }
    credId = b64(cred.rawId);
    const r = cred.getClientExtensionResults();
    prf = r && r.prf && r.prf.results && r.prf.results.first; // given at creation by newer Safari versions
    try { sessionStorage.setItem(PENDING, JSON.stringify({ credId, prfSalt, hkdfSalt })); } catch { /* ignore */ }
  }
  if (!prf) {
    try { prf = await prfWhenFocused(credId, prfSalt); }
    catch (e) {
      if (e.code === 'noprf') { try { sessionStorage.removeItem(PENDING); } catch { /* ignore */ } throw e; }
      throw new Error(notFocused(e) ? 'Almost done: tap the button once more to finish with Touch ID / Face ID (the passkey is already saved).' : `Setup could not finish: ${e.message || e.name}. Tap the button again to retry.`);
    }
  }
  try { sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
  return { meta: { credId, prfSalt, hkdfSalt, since: new Date().toISOString() }, key: await keyFromPrf(prf, hkdfSalt) };
}
export async function unlock(meta) {
  try { return await keyFromPrf(await prfWhenFocused(meta.credId, meta.prfSalt), meta.hkdfSalt); }
  catch (e) { if (e.code === 'noprf') throw e; throw new Error(notFocused(e) ? 'Not quite ready yet: tap Unlock once more.' : e.name === 'NotAllowedError' ? 'Touch ID / Face ID was cancelled or did not match. Tap Unlock to try again.' : `Unlock failed (${e.name || e.message}).`); }
}
export async function seal(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
export async function open(blob, key) {
  try { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct)))); }
  catch { throw new Error('The data on this device could not be decrypted.'); }
}
// The vault key must be storable inside the sealed data, so with app lock it is derived extractable.
export const exportRaw = async (key) => b64(await crypto.subtle.exportKey('raw', key));
export const importRaw = (raw) => crypto.subtle.importKey('raw', unb64(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
