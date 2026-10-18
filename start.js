// v21 (I78, I79): the start screens. Welcome (new device), Welcome back (restore from the encrypted vault),
// Locked (every day with app lock on) and the demo start screen. Pure markup: the taps are handled in app.js.
// Light and dark follow the theme chosen in Settings; with Auto (the default) they follow the device.
import { h } from './util.js';
import { BIO } from './security.js';
import { cfg, cloud, cloudReady } from './sync.js';
import { state } from './state.js';

const leaf = (style, size = 120, op = 0.85) => `<svg class="st-leaf" style="${style};width:${size}px;height:${size * 2}px;opacity:${op}" aria-hidden="true"><use href="#st-leaf"/></svg>`;
const wave = '<svg class="st-waves" viewBox="0 0 400 190" preserveAspectRatio="none" aria-hidden="true"><path d="M0 70 C 90 20, 170 110, 260 70 S 400 40, 400 40 V190 H0Z" fill="var(--st-mist)" opacity=".75"/><path d="M0 120 C 110 80, 200 150, 300 110 S 400 100, 400 100 V190 H0Z" fill="var(--st-mist)"/></svg>';
// The corner shapes; pick() leaves some out (the demo start screen uses the 1st and 4th).
const CORNERS = [
  '<div class="st-corner" style="width:260px;height:260px;right:-90px;top:-90px;background:var(--st-mist)"></div>',
  '<div class="st-corner" style="width:170px;height:170px;right:-30px;top:-40px;background:color-mix(in srgb,var(--st-mist) 60%,var(--st-paper))"></div>',
  '<div class="st-corner" style="width:240px;height:240px;left:-110px;bottom:-60px;background:var(--st-mist);opacity:.7"></div>',
  '<div class="st-corner" style="width:200px;height:200px;right:-70px;bottom:-80px;background:var(--st-peach)"></div>',
];
const corners = (pick = [0, 1, 2, 3]) => pick.map((i) => CORNERS[i]).join('');
const lockIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
const IC = {
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16"/><path d="M5 15l4-4 3 3 6-7"/><path d="M15 7h3v3"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c.6 4.6 3.4 7.4 8 8-4.6.6-7.4 3.4-8 8-.6-4.6-3.4-7.4-8-8 4.6-.6 7.4-3.4 8-8z"/></svg>',
};
const GOOGLE = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
// Shapes used by every start screen; the page holds them once.
export const SPRITE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><symbol id="st-leaf" viewBox="0 0 100 200"><path d="M50 198 C 52 150, 46 90, 50 10" fill="none" stroke="currentColor" stroke-width="3"/><g fill="currentColor"><path d="M50 170 C 20 165, 8 140, 14 122 C 34 128, 48 148, 50 170Z"/><path d="M50 150 C 80 145, 92 120, 86 102 C 66 108, 52 128, 50 150Z"/><path d="M50 120 C 22 116, 12 92, 18 76 C 38 82, 50 100, 50 120Z"/><path d="M50 98 C 78 92, 88 70, 82 54 C 64 60, 52 78, 50 98Z"/><path d="M50 66 C 30 60, 26 40, 32 26 C 46 34, 52 50, 50 66Z"/></g></symbol></defs></svg>';

// 1. Welcome: a device with no data yet and no app lock.
export function welcomeView() {
  const restore = cloudReady() ? '<p class="st-muted" style="margin-top:12px">Already use Finances? <button class="st-link inline" data-act="startrestore">Restore my data</button></p>' : '';
  return SPRITE + `<section class="start welcome">${leaf('right:-46px;bottom:120px;transform:rotate(-24deg)', 70, 0.35)}<div class="st-col">
    <div class="st-top"><img class="st-logo" src="logo-icon.png" alt="Finances"><span class="st-tag">Secure<i>•</i>Private<i>•</i>Yours</span></div>
    <div class="st-left"><h1 class="st-hero st-serif">Take control of your finances</h1>
      <p class="st-lead">Add your bank statements and get clear insights into your spending, savings and goals, all in one place.</p></div>
    <div class="st-right"><div class="st-art" aria-hidden="true"><div class="st-blob"></div>${leaf('left:2px;top:40px;transform:rotate(-8deg)', 70)}
      <div class="st-sheet">Bank statements<hr style="width:70%"><hr><hr style="width:80%"><hr style="width:60%"><span class="ok">✓</span></div>
      <div class="st-phone"><small>Earned this month</small><b>€ 2.345,67</b><div class="st-bars"><i style="height:40%"></i><i style="height:60%"></i><i style="height:45%"></i><i style="height:85%"></i><i style="height:55%"></i><i style="height:70%"></i></div>
        <div class="st-rows"><div><span class="st-dot" style="background:var(--st-ic1)">⌂</span><span>Home</span><span>1.500,00</span></div><div><span class="st-dot" style="background:var(--st-peach)">●</span><span>Food</span><span>45,90</span></div><div><span class="st-dot" style="background:var(--st-ic2)">▲</span><span>Transport</span><span>45,90</span></div><div><span class="st-dot" style="background:var(--st-ic3)">+</span><span>Other</span><span>12,50</span></div></div></div></div></div>
    <div class="st-left"><div class="st-feats">
      <div class="st-feat"><span class="ic" style="background:var(--st-ic1);color:var(--st-link)">${IC.chart}</span><div><h3>Track your spending</h3><p>See where your money goes, month by month.</p></div></div>
      <div class="st-feat"><span class="ic" style="background:var(--st-ic2);color:var(--st-sage-deep)">${IC.shield}</span><div><h3>Stay private</h3><p>Your data is encrypted and stays on your device.</p></div></div>
      <div class="st-feat"><span class="ic" style="background:var(--st-ic3);color:#7C68C9">${IC.spark}</span><div><h3>Make better decisions</h3><p>Simple insights, budgets and savings goals.</p></div></div></div>
    <label class="st-btn primary" role="button" tabindex="0">Get started <span aria-hidden="true">→</span><input type="file" accept=".pdf,.csv,.json,application/pdf,text/csv,application/json" multiple data-act="import" hidden></label>
    <p class="st-muted" style="font-size:13px;margin-top:10px">PDF or CSV statements. Your rules file and backups (.json) work here too.</p>
    ${restore}
    <p class="st-muted" style="margin-top:4px"><button class="st-link" data-act="seedemo">See a demo</button></p></div>
  </div></section>`;
}

// 2a. Welcome back: restore the data from the encrypted vault in Google Drive. The app has no email accounts,
// so it is Google, then the vault passphrase (which cannot be reset).
export function restoreView() {
  const s = cloud.status;
  const back = '<button class="st-link" data-act="startback">‹ Back</button>';
  let steps;
  if (s === 'locked') {
    steps = `<p class="st-step">Step 1 · Google account <span class="st-done" aria-label="done">✓</span></p>
      <p class="st-step" style="margin-top:22px">Step 2 · Vault passphrase</p>
      <form class="st-form" data-act="unlock"><label class="st-field">${lockIcon}<input type="password" name="p" placeholder="Vault passphrase" required autocomplete="current-password" aria-label="Vault passphrase"></label>
        <label class="st-check"><input type="checkbox" name="remember" checked> Remember on this device</label>
        <button class="st-btn primary" style="margin-top:18px">Unlock my data <span aria-hidden="true">→</span></button></form>
      <p class="st-muted" style="font-size:13px">Your passphrase can't be reset. Without it, the vault cannot be opened.</p>`;
  } else if (s === 'signedout' || s === 'signin') {
    steps = `<p class="st-step">Step 1 · Google account</p>
      <button class="st-btn ghost" data-act="gsignin">${GOOGLE}${s === 'signin' ? 'Sign in again with Google' : 'Continue with Google'}</button>
      <p class="st-step st-off" style="margin-top:22px">Step 2 · Vault passphrase</p>
      <div class="st-field st-off">${lockIcon}<span>Vault passphrase</span></div>`;
  } else if (s === 'novault') {
    steps = `<p class="st-step">Step 1 · Google account <span class="st-done" aria-label="done">✓</span></p>
      <p class="st-lead" style="margin-top:14px">No vault of yours was found in this Google account, so there is nothing to restore here.</p>
      ${cfg.googleApiKey ? '<button class="st-btn ghost" data-act="pickvault" style="margin-top:12px">Open a shared vault</button>' : ''}`;
  } else if (s === 'synced' || s === 'syncing') {
    steps = `<p class="st-lead" style="margin-top:14px">Your vault is connected, but it holds no bookings yet.</p>
      <label class="st-btn primary" role="button" tabindex="0" style="margin-top:14px">Add statements <span aria-hidden="true">→</span><input type="file" accept=".pdf,.csv,.json,application/pdf,text/csv,application/json" multiple data-act="import" hidden></label>`;
  } else {
    steps = `<p class="st-lead" style="margin-top:14px">${h(cloud.msg || 'Cloud sync is not set up on this copy of the app.')}</p>`;
  }
  return SPRITE + `<section class="start">${wave}<div class="st-col">
    <div class="st-top">${back}</div>
    <img class="st-logo" src="logo-icon.png" alt="Finances" style="margin-top:8px">
    <h1 class="st-hero st-serif" style="font-size:38px">Welcome back</h1>
    <p class="st-lead">Restore your data from your encrypted vault in Google Drive.</p>
    <div class="st-gap" style="margin-top:26px">${steps}</div>
    <p class="st-lockline">${lockIcon}Your data is encrypted with your passphrase. Only you can open it.</p>
  </div></section>`;
}

// 2b. Locked: every day with app lock on.
export function lockedView() {
  return SPRITE + `<section class="start">${corners()}${leaf('left:-8px;top:-34px;transform:rotate(-115deg)', 70)}${leaf('right:6px;bottom:30px;transform:rotate(14deg)', 64, 0.75)}
    <div class="st-col st-center"><img class="st-logo" src="logo-icon.png" alt="" style="width:80px;height:80px">
    <h1 class="st-serif" style="font-size:32px;margin-top:14px">Finances is locked</h1>
    <p class="st-lead" style="font-size:15.5px">Your data on this device is encrypted.<br>Unlock with ${BIO} to continue.</p>
    <div class="st-faceid" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M6 15V9a3 3 0 0 1 3-3h6M33 6h6a3 3 0 0 1 3 3v6M42 33v6a3 3 0 0 1-3 3h-6M15 42H9a3 3 0 0 1-3-3v-6"/><path d="M17 18v3M31 18v3M24 18v8h-2M18 32c3.5 3 8.5 3 12 0"/></svg></div>
    <button class="st-btn primary" style="max-width:340px" data-act="unlockapp">Unlock with ${BIO}</button>
    <button class="st-link" style="margin-top:8px" data-act="lockfallback">Use my passphrase instead</button>
    <button class="st-btn ghost small" style="margin-top:22px" data-act="showdemo">Show demo</button>
    <p class="st-muted" style="font-size:13px;margin-top:10px">Opens made-up data. Your data stays locked.</p></div></section>`;
}

// 2c. Demo start screen (I78): the same look, no sign-in of any kind.
export function demoStartView() {
  return SPRITE + `<section class="start">${corners([0, 3])}${leaf('left:-8px;top:-34px;transform:rotate(-115deg)', 70)}${leaf('right:6px;bottom:30px;transform:rotate(14deg)', 64, 0.75)}
    <div class="st-col st-center"><img class="st-logo" src="logo-icon.png" alt="" style="width:80px;height:80px">
    <h1 class="st-serif" style="font-size:32px;margin-top:14px">Finances</h1><p style="margin-top:10px"><span class="st-badge">Demo</span></p>
    <p class="st-lead" style="font-size:15.5px">Made-up data for showing the app.<br>Nothing you do here is saved.</p>
    <button class="st-btn primary" style="max-width:340px;margin-top:28px" data-act="opendemo">Open the demo <span aria-hidden="true">→</span></button>
    <button class="st-link" style="margin-top:8px" data-act="exitdemo">Exit demo</button></div></section>`;
}

// What the empty app shows: Welcome, or Welcome back when "Restore my data" was chosen or a vault is already linked.
export function emptyView() {
  return state.start === 'restore' || (cloud.meta && cloud.meta.fileId) ? restoreView() : welcomeView();
}
