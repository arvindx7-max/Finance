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

// Creates the passkey, proves the PRF key works, returns { meta, key }.
export async function setup() {
  const prfSalt = b64(crypto.getRandomValues(new Uint8Array(32)));
  const hkdfSalt = b64(crypto.getRandomValues(new Uint8Array(16)));
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'Finances' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Finances app lock', displayName: 'Finances app lock' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000, extensions: { prf: {} },
    } });
  } catch (e) { throw new Error(e.name === 'NotAllowedError' ? 'Face ID setup was cancelled.' : `Face ID setup failed (${e.name}).`); }
  const credId = b64(cred.rawId);
  const prf = await prfFor(credId, prfSalt);
  return { meta: { credId, prfSalt, hkdfSalt, since: new Date().toISOString() }, key: await keyFromPrf(prf, hkdfSalt) };
}
export async function unlock(meta) {
  try { return await keyFromPrf(await prfFor(meta.credId, meta.prfSalt), meta.hkdfSalt); }
  catch (e) { if (e.code === 'noprf') throw e; throw new Error(e.name === 'NotAllowedError' ? 'Face ID was cancelled or did not match.' : `Unlock failed (${e.name || e.message}).`); }
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
