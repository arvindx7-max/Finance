// v20 checks: Demo mode (I65) and the other v20 items. Fabricated data only (mock.mjs / the ledger in CLAUDE.md).
import { serve, launch, open, confirmDialog, PHONE, MAC, BROWSER } from './lib.mjs';
import { reporter } from './report.mjs';
import { MONTHS, csv, rulesFile, lineFile } from './mock.mjs';
const { ok, done } = reporter();
const { port } = await serve(); const b = await launch();
const PASS = 'test-passphrase-only';
const idb = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('finance-insights'); r.onsuccess = () => { const d = r.result; const out = {}; let n = 0;
    ['tx', 'statements', 'kv'].forEach((s) => { const q = d.transaction(s).objectStore(s).getAllKeys(); q.onsuccess = () => { out[s] = q.result; if (++n === 3) { d.close(); res(out); } }; }); }; }));
const enterDemo = async (p) => { await p.waitForSelector('#main .start [data-act=opendemo]'); await p.click('[data-act=opendemo]'); await p.waitForSelector('#main .topbar'); await p.waitForTimeout(500); };
const reloaded = async (p) => { await p.reload(); await p.waitForSelector('#main .topbar, #main .start', { timeout: 15000 }); const od = await p.$('#main [data-act=opendemo]'); if (od) { await od.click(); await p.waitForSelector('#main .topbar'); } await p.waitForTimeout(500); };
const setupVault = (p) => p.evaluate(async (pass) => { const C = await import('./cloud.js'); const salt = C.newSalt(); const key = await C.deriveKey(pass, salt); const cl = window.__app.cloud; cl.meta = { fileId: 'file_test', salt, iter: 310000 }; cl.key = key; }, PASS);
const goSettings = async (p, vp) => { await p.click(vp === PHONE ? '[data-act=settings]' : '.tabbar [data-tab=settings]'); await p.waitForTimeout(250); };
const goTab = async (p, t) => { await p.click(`.tabbar [data-tab=${t}]`); await p.waitForTimeout(250); };
const stat = (p) => p.evaluate(() => { const s = window.__app.state; return { tx: s.tx.length, months: s.agg.months, review: s.agg.review.length, strip: !!document.querySelector('.demo-strip') }; });

// ---------- I65 Demo mode, app lock off: the vault passphrase protects the real data ----------
for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) {
  const p = await open(b, port, vp); const N = `${dn}: I65`;
  const real = await stat(p);
  // without a vault the demo cannot protect anything: it refuses and nothing changes
  await goSettings(p, vp); await p.click('[data-act=startdemo]'); await p.waitForTimeout(300);
  ok(`${N} refuses without a vault or app lock`, !(await p.evaluate(() => !!document.querySelector('#dialog:not([hidden])'))) && (await stat(p)).tx === real.tx);
  await setupVault(p);
  // wrong passphrase: nothing is hidden
  await p.click('[data-act=startdemo]'); await p.fill('#dlg-in', 'wrong-passphrase'); await p.click('[data-dlg=ok]'); await p.waitForTimeout(1500);
  ok(`${N} a wrong passphrase does not start the demo`, (await idb(p)).tx.length === real.tx && !(await idb(p)).kv.includes('demo'));
  // cancel: nothing happens
  await p.click('[data-act=startdemo]'); await p.click('[data-dlg=cancel]'); await p.waitForTimeout(200);
  ok(`${N} cancelling keeps everything as it was`, (await idb(p)).tx.length === real.tx);
  // start
  await p.evaluate(() => window.__app.cloud.token = { token: 'token_test', exp: Date.now() + 1e6 }); await p.evaluate(async () => { const s = await import('./storage.js'); await s.kvSet('gtoken', { token: 'token_test', exp: Date.now() + 1e6 }); });
  await p.click('[data-act=startdemo]'); await p.fill('#dlg-in', PASS);
  await Promise.all([p.waitForEvent('load'), p.click('[data-dlg=ok]')]); await enterDemo(p);
  const i = await idb(p); const d = await stat(p);
  ok(`${N} start: the plain copy of bookings and statements is gone`, i.tx.length === 0 && i.statements.length === 0, JSON.stringify(i));
  ok(`${N} start: settings, vault key and Google sign-in are gone from storage`, !['settings', 'cloud', 'cloudKey', 'gtoken', 'settingsBackup', 'undo', 'lastBackup'].some((k) => i.kv.includes(k)) && i.kv.includes('demoVault'), JSON.stringify(i.kv));
  ok(`${N} start: the app shows the made-up data and the Demo strip`, d.strip && d.tx > 0 && d.months.includes('2026-09') && !d.months.includes('2026-10'), JSON.stringify(d));
  ok(`${N} start: no cloud pill, no backup banner`, await p.evaluate(() => !document.querySelector('.cloud-pill, .banner[data-act=backup]')));
  await goTab(p, 'data');
  ok(`${N} Data tab explains that import and backup are off`, /turned off while the demo is on/.test(await p.textContent('#main')) && !(await p.$('[data-act=import], [data-act=backup], [data-act=wipe]')));
  await goSettings(p, vp);
  ok(`${N} Settings: no Erase, no App lock; Exit is offered`, !(await p.$('[data-act=wipe], [data-act=lockon], [data-act=lockoff]')) && !!(await p.$('#main [data-act=exitdemo]')));
  // import is refused
  const before = await stat(p);
  await p.evaluate(async () => { await window.__app.importFiles([new File(['x'], 'statement_test_2026-04.csv', { type: 'text/csv' })]); });
  ok(`${N} import is refused during the demo`, (await stat(p)).tx === before.tx);
  // a change in the demo is not kept
  await goTab(p, 'review');
  const sugg = await p.$('[data-suggest]');
  if (sugg) await sugg.click(); else await p.selectOption('.rv select', { index: 1 });
  await p.waitForTimeout(500);
  ok(`${N} a change in the demo is possible`, (await stat(p)).review === 0);
  ok(`${N} the change is not written to storage`, !(await idb(p)).kv.includes('settings') && !(await idb(p)).kv.includes('undo'));
  await reloaded(p);
  ok(`${N} after a reload the demo is back to its start`, (await stat(p)).review === 1);
  // exit with a wrong passphrase
  await goSettings(p, vp); await p.click('#main [data-act=exitdemo]'); await p.fill('#xd-pass', 'wrong-passphrase'); await p.click('[data-xd=pass]'); await p.waitForTimeout(1500);
  ok(`${N} exit with a wrong passphrase is refused and the demo stays`, /doesn't open/.test(await p.textContent('#xd-msg')) && (await stat(p)).strip && (await idb(p)).tx.length === 0);
  await p.click('[data-xd=stay]'); await p.waitForTimeout(200);
  ok(`${N} "Stay in demo" closes the question`, await p.evaluate(() => document.querySelector('#dialog').hidden));
  // exit with the right one
  await p.click('#main [data-act=exitdemo]'); await p.fill('#xd-pass', PASS);
  await Promise.all([p.waitForEvent('load'), p.click('[data-xd=pass]')]); await p.waitForSelector('#main .topbar'); await p.waitForTimeout(600);
  const back = await stat(p); const i2 = await idb(p);
  ok(`${N} exit: your bookings are back`, back.tx === real.tx && JSON.stringify(back.months) === JSON.stringify(MONTHS) && !back.strip, JSON.stringify(back));
  ok(`${N} exit: your rules and answers are back`, back.review === real.review && i2.kv.includes('settings'));
  ok(`${N} exit: the demo files are removed, the Google sign-in and vault key are not restored`, !i2.kv.includes('demo') && !i2.kv.includes('demoVault') && !i2.kv.includes('gtoken') && !i2.kv.includes('cloudKey'), JSON.stringify(i2.kv));
  ok(`${N} no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}

// ---------- I65 Demo mode, app lock on: nothing is unsealed; Face ID (here a virtual authenticator) ends the demo ----------
if (BROWSER === 'chromium') for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) {
  const p = await open(b, port, vp); const N = `${dn}: I65 app lock`;
  const real = await stat(p); await setupVault(p);
  const cdp = await p.context().newCDPSession(p); await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } });
  const err = await p.evaluate(async (pass) => { try { await (await import('./security.js')).enableLock(pass); window.__app.refresh(); return null; } catch (e) { return e.message; } }, PASS);
  ok(`${N} is on (test setup)`, err === null, String(err));
  await reloaded(p);
  ok(`${N} locked screen offers "Show demo"`, !!(await p.$('.start [data-act=showdemo]')) && (await idb(p)).kv.includes('sealed'));
  await Promise.all([p.waitForEvent('load'), p.click('[data-act=showdemo]')]); await enterDemo(p);
  const d = await stat(p); const i = await idb(p);
  ok(`${N} Show demo opens made-up data with one tap; the sealed data stays`, d.strip && d.months.includes('2026-09') && i.kv.includes('sealed') && i.kv.includes('lockMeta') && i.tx.length === 0, JSON.stringify(i.kv));
  await goTab(p, 'overview'); await p.click('.topbar [data-act=exitdemo]'); await p.waitForSelector('#dialog:not([hidden]) [data-xd]');
  ok(`${N} exit offers Face ID / Touch ID and the passphrase fallback`, !!(await p.$('[data-xd=bio]')) && !!(await p.$('[data-xd=fallback]')) && !(await p.$('#xd-pass')));
  await Promise.all([p.waitForEvent('load'), p.click('[data-xd=bio]')]); await p.waitForSelector('#main .start, #main .topbar'); await p.waitForTimeout(500);
  ok(`${N} exit with Face ID returns to the locked screen`, !!(await p.$('.start [data-act=unlockapp]')) && !(await idb(p)).kv.includes('demo'));
  await p.click('[data-act=unlockapp]'); await p.waitForSelector('#main .topbar', { timeout: 15000 }); await p.waitForTimeout(400);
  const back = await stat(p);
  ok(`${N} unlocking shows your own data again`, back.tx === real.tx && !back.strip && JSON.stringify(back.months) === JSON.stringify(MONTHS), JSON.stringify(back));
  // starting from the unlocked app: one confirmation, no passphrase
  await goSettings(p, vp); await p.click('[data-act=startdemo]');
  ok(`${N} Start demo asks for confirmation only`, !(await p.$('#dlg-in')));
  await Promise.all([p.waitForEvent('load'), p.click('[data-dlg=ok]')]); await enterDemo(p);
  ok(`${N} started from Settings`, (await stat(p)).strip && (await idb(p)).tx.length === 0);
  ok(`${N} no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}
// ---------- B57, B58, I66, I67, I68, I69, I70 ----------
const tabTo = async (p, t, vp) => { if (t === 'settings' && vp === PHONE) await p.click('[data-act=settings]'); else await p.click(`.tabbar [data-tab=${t}]`); await p.waitForTimeout(250); };
const imp = (p, name, type, content) => p.evaluate(([n, t, c]) => { window.__pending = window.__app.importFiles([new File([c], n, { type: t })]); }, [name, type, content]);
for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) for (const scheme of ['light', 'dark']) {
  const p = await open(b, port, vp, { scheme }); const N = `${dn} ${scheme}`;
  // B57: the Trips form stays inside its card
  await tabTo(p, 'settings', vp);
  const fit = await p.evaluate(() => { const f = document.querySelector('.tripform'); const c = f.closest('.card').getBoundingClientRect(); return [...f.querySelectorAll('input, select, button, label')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= c.left - 0.5 && r.right <= c.right + 0.5; }) && document.documentElement.scrollWidth <= innerWidth + 1; });
  ok(`${N}: B57 the Trips form fits inside its card`, fit);
  // I66: set-once items live in Settings (Data settings), the Danger zone is last; Data starts with Add statements
  const set = await p.evaluate(() => ({ skip: !!document.querySelector('input[data-skipempty]'), start: !!document.querySelector('form[data-act=start]'), trips: !!document.querySelector('.tripform'), wipe: !!document.querySelector('[data-act=wipe]'), heads: [...document.querySelectorAll('.group-head')].map((x) => x.textContent) }));
  ok(`${N}: I66 Settings holds Months table, Tracking starts, Trips and the Danger zone`, set.skip && set.start && set.trips && set.wipe && set.heads.join('|') === 'Data settings|Danger zone', JSON.stringify(set));
  await tabTo(p, 'data', vp);
  const dat = await p.evaluate(() => ({ first: document.querySelector('.data-grid .card h2').textContent, moved: !!document.querySelector('input[data-skipempty], form[data-act=start], .tripform, [data-act=wipe]') }));
  ok(`${N}: I66 Data starts with Add statements and no longer holds the set-once items`, dat.first === 'Add statements' && !dat.moved, JSON.stringify(dat));
  // I67: Insights shows real insights first, "Add more insights" last
  await tabTo(p, 'insights', vp);
  const ins = await p.evaluate(() => { const c = [...document.querySelector('.data-grid').children]; return { n: c.length, lastMore: c[c.length - 1].classList.contains('addmore'), onlyOne: document.querySelectorAll('.addmore').length }; });
  ok(`${N}: I67 "Add more insights" is the last card on Insights`, ins.lastMore && ins.onlyOne === 1 && ins.n > 1, JSON.stringify(ins));
  // I68: Review with one-tap suggestions, counter, answered row with Undo, no scrolling
  await tabTo(p, 'review', vp);
  const sg = await p.evaluate(() => ({ chips: [...document.querySelectorAll('.sugg [data-suggest]')].map((x) => x.dataset.suggest), other: /Other line/.test(document.querySelector('#main').textContent) }));
  ok(`${N}: I68 suggested lines are offered as buttons, with "Other line…"`, sg.chips.length > 0 && sg.other, JSON.stringify(sg));
  ok(`${N}: I68 a money-out booking is never offered an income or savings-in line`, sg.chips.every((id) => !/^(in|ear|sal|sv\.in|pt)/.test(id)) , JSON.stringify(sg.chips));
  await p.evaluate(() => window.scrollTo(0, 40)); const y0 = await p.evaluate(() => scrollY);
  await p.click('.sugg [data-suggest]'); await p.waitForTimeout(500);
  const ans = await p.evaluate(() => ({ review: window.__app.state.agg.review.length, rows: document.querySelectorAll('.done-row').length, undo: !!document.querySelector('[data-reviewundo]'), vr: Object.keys(window.__app.state.settings.vendorRules).filter((k) => window.__app.state.settings.vendorRules[k]), y: scrollY }));
  ok(`${N}: I68 one tap answers the booking and shows an answered row with Undo`, ans.review === 0 && ans.rows === 1 && ans.undo && ans.vr.includes('SHOP A'), JSON.stringify(ans));
  ok(`${N}: I68 the page did not scroll by itself`, Math.abs(ans.y - y0) < 2, `${y0} -> ${ans.y}`);
  await p.click('[data-reviewundo]'); await p.waitForTimeout(500);
  const un = await p.evaluate(() => ({ review: window.__app.state.agg.review.length, rows: document.querySelectorAll('.done-row').length, vr: !!window.__app.state.settings.vendorRules['SHOP A'] }));
  ok(`${N}: I68 Undo on the answered row takes the answer back`, un.review === 1 && un.rows === 0 && !un.vr, JSON.stringify(un));
  // I69: line detail, 12-month bars equal the Months totals
  await tabTo(p, 'months', vp); await p.click('[data-section=variable]'); await p.waitForTimeout(250);
  const want = await p.evaluate(() => { const a = window.__app.state.agg; const id = 'v.fuel'; const rows = a.rows.filter((t) => t.line === id); const per = a.months.slice(-12).map((m) => Math.round(rows.filter((t) => t.date.slice(0, 7) === m).reduce((x, t) => x - t.amount, 0) * 100) / 100); return { id, n: rows.length, per, total: Math.round(per.reduce((x, y) => x + y, 0) * 100) / 100 }; });
  await p.click(`[data-line="${want.id}"]`); await p.waitForSelector('#sheet:not([hidden]) .ld-bars');
  const bars = await p.$$eval('.ld-bars button', (bs) => bs.map((x) => x.getAttribute('aria-label')));
  const num = (s) => parseFloat(s.split(': ')[1].replace(/[^\d,-]/g, '').replace(',', '.'));
  ok(`${N}: I69 the monthly bars equal the monthly amounts`, bars.length === want.per.length && bars.every((l, i) => Math.abs(num(l) - want.per[i]) < 0.006), JSON.stringify([bars, want.per]));
  const avg = await p.textContent('.ld-stats b'); const avgN = parseFloat(avg.replace(/[^\d,-]/g, '').replace(',', '.'));
  ok(`${N}: I69 the average is the total over the shown months`, Math.abs(avgN - want.total / want.per.length) < 0.011, `${avg} vs ${want.total / want.per.length}`);
  await p.click('.ld-bars button:last-child'); await p.waitForTimeout(250);
  ok(`${N}: I69 tapping a bar filters to that month`, /· \d+ booking/.test(await p.textContent('.ld-head h3')) && !!(await p.$('.ld-head [data-ldmonth=""]')));
  await p.click('.ld-head [data-ldmonth=""]'); await p.waitForTimeout(200);
  ok(`${N}: I69 nothing is ticked, so nothing can be moved`, await p.evaluate(() => document.querySelector('#ld-move').disabled));
  await p.click('.ld-list [data-ldtick]'); await p.waitForTimeout(150);
  ok(`${N}: I69 the move button counts the ticked bookings`, /Move 1 booking…/.test(await p.textContent('#ld-move')));
  await p.click('#ld-move'); await p.waitForTimeout(250);
  ok(`${N}: I69 the move step repeats the count`, /Move 1 booking/.test(await p.textContent('#sheet .sheet-bar b')) && /Only the booking you ticked moves/.test(await p.textContent('#sheet')));
  await p.selectOption('#sheet select[name=line]', 'v.otherGrocery'); await p.click('#sheet form button');
  await p.waitForTimeout(600);
  const mv = await p.evaluate(() => { const a = window.__app.state.agg; return { fuel: a.rows.filter((t) => t.line === 'v.fuel').length, groc: a.rows.filter((t) => t.line === 'v.otherGrocery').length, ans: Object.keys(window.__app.state.settings.txRules).filter((k) => window.__app.state.settings.txRules[k]).length }; });
  ok(`${N}: I69 only the ticked booking moved`, mv.fuel === want.n - 1 && mv.ans === 1, JSON.stringify([mv, want.n]));
  await p.click('#toast [data-act=undo]'); await p.waitForTimeout(500);
  ok(`${N}: I69 the move can be undone`, await p.evaluate((n) => window.__app.state.agg.rows.filter((t) => t.line === 'v.fuel').length === n, want.n));
  await p.keyboard.press('Escape');
  ok(`${N}: v20 no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}
// B58: loading a rules file or a backup asks first (picker, notice and drop use the same code path); cancel changes nothing; rules load can be undone
for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) {
  const p = await open(b, port, vp); const N = `${dn}: B58`;
  const snap = () => p.evaluate(() => JSON.stringify([window.__app.state.settings, window.__app.state.tx.length]));
  const before = await snap();
  await imp(p, 'rules_test.json', 'application/json', JSON.stringify(lineFile()));
  await p.waitForSelector('#dialog:not([hidden]) [data-dlg=ok]');
  ok(`${N} a rules file asks first`, /Load this rules file/.test(await p.textContent('#dialog')));
  await p.click('[data-dlg=cancel]'); await p.evaluate(() => window.__pending); await p.waitForTimeout(300);
  ok(`${N} cancelling a rules file changes nothing`, (await snap()) === before && /not loaded/.test(await p.textContent('#sheet')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await imp(p, 'rules_test.json', 'application/json', JSON.stringify(lineFile())); await confirmDialog(p); await p.evaluate(() => window.__pending); await p.waitForTimeout(300);
  const after = await snap();
  ok(`${N} accepting loads the rules`, after !== before);
  ok(`${N} the report offers to undo the rules load`, !!(await p.$('#sheet [data-act=undo]')));
  await p.click('#sheet [data-act=undo]'); await p.waitForTimeout(500);
  ok(`${N} undo restores the earlier rules`, JSON.parse(await snap())[0].profile.rules.length === JSON.parse(before)[0].profile.rules.length && JSON.stringify(JSON.parse(await snap())[0].profile) === JSON.stringify(JSON.parse(before)[0].profile));
  const bk = JSON.stringify({ app: 'finance-insights', version: 2, tx: [], statements: [], settings: {} });
  await imp(p, 'backup_test.json', 'application/json', bk);
  await p.waitForSelector('#dialog:not([hidden]) [data-dlg=ok]');
  ok(`${N} a backup asks first and says it replaces all bookings`, /Replace all bookings/.test(await p.textContent('#dialog')) && /cannot be undone/.test(await p.textContent('#dialog')));
  await p.click('[data-dlg=cancel]'); await p.evaluate(() => window.__pending); await p.waitForTimeout(300);
  ok(`${N} cancelling a backup keeps every booking`, (await p.evaluate(() => window.__app.state.tx.length)) === JSON.parse(before)[1]);
  ok(`${N} no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}
// I70: drop statements on the Mac
{
  const p = await open(b, port, MAC); const N = 'Mac: I70';
  const drag = (types, files) => p.evaluate(([ty, fs]) => { const dt = new DataTransfer(); for (const f of fs) dt.items.add(new File([f.c], f.n, { type: f.t })); const out = {}; for (const t of ty) { const e = new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }); document.dispatchEvent(e); out[t] = e.defaultPrevented; } out.zone = !document.querySelector('#dropzone').hidden; return out; }, [types, files]);
  const n0 = await p.evaluate(() => window.__app.state.tx.length);
  const hover = await drag(['dragenter', 'dragover'], [{ n: 'statement_test_2026-09.csv', t: 'text/csv', c: csv('2026-09') }]);
  ok(`${N} dragging a file shows the drop zone and the browser does not open it`, hover.zone && hover.dragover);
  await p.evaluate(() => document.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: (() => { const d = new DataTransfer(); d.items.add(new File(['x'], 'a.csv')); return d; })() })));
  ok(`${N} leaving hides the drop zone`, await p.evaluate(() => document.querySelector('#dropzone').hidden));
  await drag(['dragenter', 'drop'], [{ n: 'statement_test_2026-09.csv', t: 'text/csv', c: csv('2026-09') }]);
  await p.waitForSelector('#sheet:not([hidden]) .report', { timeout: 15000 }); await p.waitForTimeout(300);
  ok(`${N} dropping a CSV imports it like the file picker`, (await p.evaluate(() => window.__app.state.tx.length)) > n0 && (await p.evaluate(() => window.__app.state.agg.months.includes('2026-09'))));
  ok(`${N} the drop zone is hidden after the drop`, await p.evaluate(() => document.querySelector('#dropzone').hidden));
  await p.keyboard.press('Escape'); await p.waitForSelector('#sheet', { state: 'hidden' }); await p.waitForTimeout(200);
  const n1 = await p.evaluate(() => window.__app.state.tx.length);
  await drag(['dragenter', 'drop'], [{ n: 'notes.txt', t: 'text/plain', c: 'Test note' }]);
  await p.waitForTimeout(400);
  ok(`${N} a wrong file type is rejected with a message`, /Only PDF and CSV/.test(await p.textContent('#toast')) && (await p.evaluate(() => window.__app.state.tx.length)) === n1);
  await drag(['dragenter', 'drop'], [{ n: 'rules_test.json', t: 'application/json', c: JSON.stringify(lineFile()) }]);
  await p.waitForSelector('#dialog:not([hidden]) [data-dlg=ok]', { timeout: 5000 });
  ok(`${N} a dropped rules file asks first`, /Load this rules file/.test(await p.textContent('#dialog')));
  await p.click('[data-dlg=cancel]'); await p.waitForTimeout(500);
  ok(`${N} no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}
// ---------- second Gemini review: B59, trip lines, long lists, Mac Data layout, equal chips ----------
for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) {
  const p = await open(b, port, vp); const N = `${dn}:`;
  await tabTo(p, 'review', vp);
  const st = await p.$$eval('.chips button', (bs) => bs.map((x) => getComputedStyle(x).backgroundColor));
  ok(`${N} I68 all suggestions look the same (none is shown as the answer)`, st.length > 1 && st.every((c) => c === st[0]), JSON.stringify(st));
  await p.click('.sugg [data-suggest]'); await p.waitForTimeout(400);
  await p.click('#toast [data-act=undo]'); await p.waitForTimeout(400);
  const u = await p.evaluate(() => ({ review: window.__app.state.agg.review.length, rows: document.querySelectorAll('.done-row').length, count: document.querySelector('.rv-count')?.textContent || null }));
  ok(`${N} B59 Undo in the toast also removes the answered row`, u.review === 1 && u.rows === 0 && u.count === null, JSON.stringify(u));
  // trip line: no ticks, no move, a note instead
  await p.evaluate(() => { const s = window.__app.state.settings; s.trips = [{ name: 'Test Trip', from: '2026-08-01', to: '2026-08-15', scope: 'all' }]; window.__app.refresh(); });
  await tabTo(p, 'months', vp); await p.click('[data-section=variable]'); await p.waitForTimeout(250);
  await p.click('[data-line^="trip:"]'); await p.waitForSelector('#sheet:not([hidden]) .ld-list');
  ok(`${N} Gemini-1 a trip line cannot move bookings and says why`, !(await p.$('#sheet [data-ldtick], #sheet #ld-move')) && /follow the trip dates/.test(await p.textContent('#sheet')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // long line: 20 most recent first, then "Show all"
  await p.evaluate(() => { const st = window.__app.state; st.settings.trips = []; const base = st.tx.find((t) => t.vendor === 'Test Supermarket'); for (let i = 0; i < 21; i++) st.tx.push({ ...base, id: `${base.id}|extra${i}` }); window.__app.refresh(); });
  await p.click('[data-line="v.otherGrocery"]'); await p.waitForSelector('#sheet:not([hidden]) .ld-list');
  const total = await p.evaluate(() => window.__app.state.agg.rows.filter((t) => t.line === 'v.otherGrocery').length);
  const li = () => p.$$eval('#sheet .ld-list li:not(.ld-month)', (x) => x.length);
  ok(`${N} Gemini long lists show the 20 most recent bookings first`, (await li()) === 20 && new RegExp(`Show all ${total} bookings`).test(await p.textContent('#sheet .ld-all')), String(await li()));
  await p.click('#sheet .ld-all'); await p.waitForTimeout(200);
  ok(`${N} Gemini "Show all" lists every booking`, (await li()) === total && !(await p.$('#sheet .ld-all')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await tabTo(p, 'data', vp);
  ok(`${N} Gemini Add statements spans the full width on the Mac`, await p.evaluate(() => document.querySelector('.data-grid .card').classList.contains('wide')));
  ok(`${N} no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}
// ---------- Gemini change review: safe Demo start, shape check on exit, no drop over an open window ----------
for (const [dn, vp] of [['iPhone', PHONE], ['Mac', MAC]]) {
  const N = `${dn}: v20 review`;
  const startTry = async (p) => { await goSettings(p, vp); await p.click('[data-act=startdemo]'); await p.fill('#dlg-in', PASS); await p.click('[data-dlg=ok]'); await p.waitForTimeout(2500); };
  // (1) the save of the protected copy is cancelled by the browser (as when the storage is full)
  {
    const p = await open(b, port, vp); const real = await stat(p); await setupVault(p);
    await p.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, ...r) { if (v && v.k === 'demoVault') { const req = put.call(this, v, ...r); this.transaction.abort(); return req; } return put.call(this, v, ...r); }; });
    await startTry(p);
    const i = await idb(p);
    ok(`${N} a cancelled save stops the start: nothing removed, no demo`, i.tx.length === real.tx && !i.kv.includes('demo') && !(await stat(p)).strip, JSON.stringify(i.kv));
    ok(`${N} a cancelled save does not leave the app waiting`, await p.evaluate(() => document.querySelector('#busy').hidden));
    ok(`${N} no page errors`, p.errs.length === 0, p.errs.join('; '));
    await p.context().close();
  }
  // (2) the protected copy is saved damaged: the read-back check stops the start
  {
    const p = await open(b, port, vp); const real = await stat(p); await setupVault(p);
    await p.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, ...r) { if (v && v.k === 'demoVault') { const o = JSON.parse(v.v); o.ct = (o.ct[0] === 'A' ? 'B' : 'A') + o.ct.slice(1); return put.call(this, { k: v.k, v: JSON.stringify(o) }, ...r); } return put.call(this, v, ...r); }; });
    await startTry(p);
    const i = await idb(p);
    ok(`${N} a damaged protected copy stops the start and nothing is removed`, i.tx.length === real.tx && i.kv.includes('settings') && !i.kv.includes('demo') && !i.kv.includes('demoVault'), JSON.stringify(i.kv));
    ok(`${N} the reason is shown`, /could not be protected/.test(await p.textContent('#toast')));
    await p.context().close();
  }
  // (3) exit: a protected copy that opens but is not complete is not written back
  {
    const p = await open(b, port, vp); await setupVault(p);
    await goSettings(p, vp); await p.click('[data-act=startdemo]'); await p.fill('#dlg-in', PASS);
    await Promise.all([p.waitForEvent('load'), p.click('[data-dlg=ok]')]); await enterDemo(p);
    await p.evaluate(async (pass) => { const C = await import('./cloud.js'); const S = await import('./storage.js'); const salt = C.newSalt(); const v = await C.seal({ tx: 'not a list' }, await C.deriveKey(pass, salt), salt); await S.rawPut('kv', [{ k: 'demoVault', v }]); }, PASS);
    await goSettings(p, vp); await p.click('#main [data-act=exitdemo]'); await p.fill('#xd-pass', PASS); await p.click('[data-xd=pass]'); await p.waitForTimeout(1500);
    const i = await idb(p);
    ok(`${N} an incomplete protected copy is not written back; the demo stays`, /not complete/.test(await p.textContent('#xd-msg')) && i.tx.length === 0 && i.kv.includes('demoVault') && i.kv.includes('demo'));
    await p.context().close();
  }
}
// (4) Mac: a file dropped while a question is open is ignored, the question stays
{
  const p = await open(b, port, MAC); const N = 'Mac: v20 review';
  const drop = (n, t, c) => p.evaluate(([n, t, c]) => { const dt = new DataTransfer(); dt.items.add(new File([c], n, { type: t })); for (const ty of ['dragenter', 'drop']) document.dispatchEvent(new DragEvent(ty, { dataTransfer: dt, bubbles: true, cancelable: true })); }, [n, t, c]);
  await drop('rules_test.json', 'application/json', JSON.stringify(lineFile()));
  await p.waitForSelector('#dialog:not([hidden]) [data-dlg=ok]', { timeout: 5000 });
  const n0 = await p.evaluate(() => window.__app.state.tx.length);
  await drop('statement_test_2026-09.csv', 'text/csv', csv('2026-09')); await p.waitForTimeout(500);
  ok(`${N} a drop while a question is open is ignored and says why`, /Close the open window first/.test(await p.textContent('#toast')) && /Load this rules file/.test(await p.textContent('#dialog')) && (await p.evaluate(() => window.__app.state.tx.length)) === n0);
  await p.click('[data-dlg=cancel]'); await p.waitForTimeout(400);
  ok(`${N} no errors`, p.errs.length === 0, p.errs.join('; '));
  await p.context().close();
}
await b.close(); done();
