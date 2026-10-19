// v21 step 1 checks: B60-B63, I75, I77-I80. Fabricated data only (mock.mjs / the ledger in CLAUDE.md).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { serve, launch, open, confirmDialog, PHONE, MAC, BROWSER } from './lib.mjs';
import { reporter } from './report.mjs';
import { MONTHS, csv, rulesFile } from './mock.mjs';
const { ok, done } = reporter();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { port } = await serve(); const b = await launch();
const PASS = 'test-passphrase-only';
const HEAD = csv('2026-03').split('\n').slice(0, 4).join('\n');
// Persona "Bob": only salary, rent and one supermarket booking. No abroad, no savings, no one-time items.
const bobCsv = (m) => { const d = (x) => `${x}.${m.slice(5)}.${m.slice(0, 4)}`; const r = (date, t, cp, a) => `${date};${date};${t};${cp};${cp};DE00 0000 0000 0000 0000 00;;;;;;${a};;;;;;EUR`;
  return `${HEAD}\n${r(d('01'), 'Lohn/Gehalt', 'TEST EMPLOYER GMBH', '2.345,67')}\n${r(d('01'), 'Dauerauftrag', 'Shop B', '-1.500,00')}\n${r(d('15'), 'Kartenzahlung', 'Test Supermarket', '-45,90')}\n`; };
const bobFiles = () => ['2026-03', '2026-04'].map((m) => ({ name: `statement_test_${m}.csv`, mimeType: 'text/csv', buffer: Buffer.from(bobCsv(m)) }))
  .concat([{ name: 'rules_test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rulesFile())) }]);
const openBob = async (vp, scheme) => { const p = await open(b, port, vp, { load: false, scheme }); await p.setInputFiles('input[data-act=import]', bobFiles()); await confirmDialog(p); await p.waitForSelector('#sheet:not([hidden]) .report', { timeout: 30000 }); await p.keyboard.press('Escape'); await p.waitForTimeout(500); return p; };
const idb = (p) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('finance-insights'); r.onsuccess = () => { const d = r.result; const out = {}; let n = 0; ['tx', 'statements', 'kv'].forEach((s) => { const q = d.transaction(s).objectStore(s).getAllKeys(); q.onsuccess = () => { out[s] = q.result; if (++n === 3) { d.close(); res(out); } }; }); }; }));
const goTab = async (p, vp, t) => { await p.click(t === 'settings' && vp === PHONE ? '[data-act=settings]' : vp === PHONE ? `.tabbar [data-tab=${t}]` : `.tabbar [data-tab=${t}], .sidebar [data-tab=${t}]`); await p.waitForTimeout(300); };
const text = (p) => p.textContent('#main');
const tabs = (p) => p.evaluate(() => [...document.querySelectorAll('#main .seg [data-section]')].map((x) => x.textContent.trim()));
const setupVault = (p) => p.evaluate(async (pass) => { const C = await import('./cloud.js'); const salt = C.newSalt(); const key = await C.deriveKey(pass, salt); const cl = window.__app.cloud; cl.meta = { fileId: 'file_test', salt, iter: 310000 }; cl.key = key; }, PASS);

for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) for (const scheme of ['light', 'dark']) {
  const N = `${dn} ${scheme}`;
  // ---- I80: Bob (little data) vs Alice (full ledger)
  const bob = await openBob(vp, scheme);
  const inUseB = await bob.evaluate(() => window.__app.state.agg.inUse);
  ok(`${N}: I80 Bob has no abroad/savings/one-time in use`, !inUseB.abroad && !inUseB.savings && !inUseB.onetime, JSON.stringify(inUseB));
  const bt = await text(bob);
  ok(`${N}: I80 Bob's Overview shows no abroad, savings or one-time rows`, !/Sent abroad|Moved to savings|One-time/.test(bt));
  await goTab(bob, vp, 'months');
  ok(`${N}: I80 Bob's Months has no One-time tab`, !(await tabs(bob)).some((t) => /One-time/.test(t)), (await tabs(bob)).join('|'));
  await goTab(bob, vp, 'insights');
  ok(`${N}: I80 Bob's Insights has no savings balance to-do`, !/Savings balance/.test(await text(bob)));
  ok(`${N}: I80 Bob: no errors`, bob.errs.length === 0, bob.errs.join('; '));
  await bob.context().close();
  const alice = await open(b, port, vp, { scheme });
  const inUseA = await alice.evaluate(() => window.__app.state.agg.inUse);
  ok(`${N}: I80 Alice has abroad, savings and one-time in use`, inUseA.abroad && inUseA.savings && inUseA.onetime, JSON.stringify(inUseA));
  const at = await text(alice);
  ok(`${N}: I80 Alice's Overview shows the abroad and savings rows`, /Sent abroad/.test(at) && /Moved to savings/.test(at));
  await goTab(alice, vp, 'months');
  ok(`${N}: I80 Alice's Months has the One-time tab`, (await tabs(alice)).some((t) => /One-time/.test(t)));
  // ---- B62 neutral wording
  ok(`${N}: B62 no vendor-specific wording in the page`, !/Cash Group|Claude/.test(await alice.content()));
  // ---- I77 Lock now only with app lock on
  await goTab(alice, vp, 'settings');
  ok(`${N}: I77 no Lock now button when the app lock is off`, !(await alice.$('[data-act=locknow]')));
  ok(`${N}: B63 no errors`, alice.errs.length === 0, alice.errs.join('; '));
  await alice.context().close();
}

// ---- Empty demo mode (device with nothing to protect): I78, B60, B61, I77 demo variant
for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) {
  const N = `${dn}: demo`;
  const p = await open(b, port, vp, { load: false });
  ok(`${N}: I79 Welcome screen shows with no data`, !!(await p.$('#main .start.welcome')) && /Take control of your finances/.test(await text(p)));
  const picked = await (async () => { await p.waitForSelector('#main .start label.st-btn[role=button]'); await p.focus('#main .start label.st-btn[role=button]'); const wait = p.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null); await p.waitForTimeout(200); await p.keyboard.press('Enter'); const fc = await wait; return fc ? 'ok' : await p.evaluate(() => (document.activeElement || {}).outerHTML?.slice(0, 80) + ' | ' + document.querySelector('#main').innerHTML.slice(0, 120)); })();
  ok(`${N}: Gemini 4 Enter on Get started opens the file picker`, picked === 'ok', picked);
  ok(`${N}: I79 Welcome hides tab bar`, await p.evaluate(() => document.body.classList.contains('locked')));
  await p.evaluate(() => { localStorage.setItem('theme', 'light'); localStorage.setItem('palette', 'classic'); });
  const ls0 = await p.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
  await p.click('[data-act=seedemo]'); await p.waitForTimeout(800);
  const startOnce = async () => { const s = await p.$('#main .start [data-act=opendemo]'); if (s) { await s.click(); await p.waitForSelector('#main .topbar'); await p.waitForTimeout(400); } };
  ok(`${N}: I78 demo start screen is shown first`, !!(await p.$('[data-act=opendemo]')) && !!(await p.$('[data-act=exitdemo]')), (await text(p)).slice(0, 200));
  await startOnce();
  ok(`${N}: I78 the demo shows made-up data and the Demo strip`, !!(await p.$('.demo-strip')));
  // B60: change the look inside the demo; storage keys untouched
  await p.evaluate(() => { const s = document.querySelector('[data-act=settings]'); if (s) s.click(); });
  const look = await p.evaluate(async () => { const v = await import('./views.js'); v.applyTheme('dark'); v.applyPalette('lagoon'); return { theme: v.currentTheme(), palette: v.currentPalette(), attr: document.documentElement.dataset.palette }; });
  ok(`${N}: B60 the demo shows the look chosen in the demo`, look.theme === 'dark' && look.palette === 'lagoon' && look.attr === 'lagoon', JSON.stringify(look));
  const ls1 = await p.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
  ok(`${N}: B60 the demo look is not written to storage`, ls0 === ls1, ls0 + ' / ' + ls1);
  // reload returns to the start screen
  await p.reload(); await p.waitForSelector('#main .start, #main .topbar', { timeout: 15000 });
  ok(`${N}: I78 a reload returns to the demo start screen`, !!(await p.$('#main .start [data-act=opendemo]')));
  // exit
  await p.click('#main .start [data-act=exitdemo]'); await p.waitForTimeout(1500);
  const left = await p.evaluate(() => !document.querySelector('.demo-strip'));
  ok(`${N}: I78 Exit demo leaves the demo`, left && !(await idb(p)).kv.includes('demo'), JSON.stringify((await idb(p)).kv));
  ok(`${N}: demo: no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}

// ---- I77 Lock now with app lock on (Chromium virtual authenticator)
if (BROWSER === 'chromium') for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) {
  const N = `${dn}: I77/I79`; const p = await open(b, port, vp); await setupVault(p);
  const cdp = await p.context().newCDPSession(p); await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } });
  const err = await p.evaluate(async (pass) => { try { await (await import('./security.js')).enableLock(pass); window.__app.refresh(); return null; } catch (e) { return e.message; } }, PASS);
  ok(`${N}: app lock turned on`, !err, String(err));
  const btn = await p.$('[data-act=locknow]');
  ok(`${N}: I77 Lock now button is in the top bar`, !!btn);
  if (btn) { await Promise.all([p.waitForEvent('load'), btn.click()]); await p.waitForSelector('#main .start', { timeout: 15000 }); }
  ok(`${N}: I79 the Locked screen shows after Lock now`, !!(await p.$('#main .start [data-act=unlockapp]')), (await text(p)).slice(0, 160));
  ok(`${N}: I79 no bookings are visible when locked`, !/Test Supermarket|2\.345,67/.test(await text(p)));
  ok(`${N}: lock: no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}

// ---- I75 icons: one background colour, names match
{
  const files = ['apple-touch-icon-v21.png', 'icon-v21-192.png', 'icon-v21-512.png', 'icon-v21-maskable-512.png', 'favicon-v21-32.png'];
  ok('I75: icon files exist', files.every((f) => fs.existsSync(path.join(ROOT, f))));
  ok('I75: old icon files are gone', ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'favicon-32.png'].every((f) => !fs.existsSync(path.join(ROOT, f))));
  const man = fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'), idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ok('I75: manifest, index and service worker use the new names', files.slice(0, 4).filter((f) => f !== 'apple-touch-icon-v21.png').every((f) => man.includes(f)) && idx.includes('apple-touch-icon-v21.png') && idx.includes('favicon-v21-32.png') && files.every((f) => sw.includes(f)));
  ok('I75: service worker version is fin-v21.1', /VERSION\s*=\s*'fin-v21.1'/.test(sw));
  const p = await (await b.newContext()).newPage(); await p.goto(`http://localhost:${port}/index.html`);
  const res = await p.evaluate(async () => { const img = new Image(); img.src = 'apple-touch-icon-v21.png'; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const px = (X, Y) => [...x.getImageData(X, Y, 1, 1).data].join(','); const W = img.width - 1; return { corners: [px(0, 0), px(W, 0), px(0, W), px(W, W)], alpha: x.getImageData(0, 0, 1, 1).data[3] }; });
  ok('I75: icon corners have the same single colour and no transparency', new Set(res.corners).size === 1 && res.alpha === 255, JSON.stringify(res));
  await p.context().close();
}
await b.close(); done();
