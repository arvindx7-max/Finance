// Taps, forms and start-up. The rest of the app lives in the modules imported below.
import { aggregate, reconcile, DEFAULT_SETTINGS, emptyProfile, lines, SECTIONS, USER_SECTIONS, lineLabel, lineMeta, monthLabel, deDate, monthOf } from './model.js';
import { buildWorkbook } from './xlsx.js';
import * as C from './cloud.js';
import { $, closeSheet, eur, h, hideBusy, sheet, showBusy, toast } from './util.js';
import { all, clear, kvSet, lock, sealAll } from './storage.js';
import { change, fresh, load, recompute, state, txById, undo } from './state.js';
import { cfg, chooseVault, cloud, createVaultFlow, loadCloud, refreshStatus, saveCloudMeta, syncNow, unlockFlow } from './sync.js';
import { BIO, ask, dialogDone, disableLock, enableLock, lockFallback, unlockApp } from './security.js';
import { applyMotion, setMotion } from './motion.js';
import { exportBackup, exportExcel, exportRules, importFiles } from './io.js';
import { addUserRule, applyTheme, assign, budgetSheet, createLine, currentTheme, drillSheet, forgetView, goalSheet, isDark, manageSheet, monthsIn, newLineSheet, oneTimeSheet, overviewSheet, periodLabel, render, ruleMatches, ruleSheetHtml, savBalSheet, searchHits, searchResults, takePendingNew, txList } from './views.js';
// ---------------- events ----------------
// B40: no pinch zoom (iPhone and Mac Safari send gesture events; other browsers send ctrl + wheel).
['gesturestart', 'gesturechange'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
const TAB_LABEL = { overview: 'Overview', months: 'Months', insights: 'Insights', review: 'Review', data: 'Data', settings: 'Settings' };
// Open Months at a section (and month), remembering where we came from for the "‹ back" link.
function goMonths(section, month) {
  if (state.tab !== 'months') state.back = { tab: state.tab, label: TAB_LABEL[state.tab], y: window.scrollY };
  state.tab = 'months'; state.section = section; state.focusMonth = month || null;
  forgetView(); render(); window.scrollTo(0, 0);
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button, [data-section], [data-cell], [data-drill], [data-pjump], [data-gosec]');
  if (!b) return;
  const ds = b.dataset;
  if (ds.tab) {
    closeSheet();
    if (ds.tab === state.tab) { // already here: back to the start of this tab
      if (state.tab === 'months') state.focusMonth = null;
      if (state.tab === 'overview' || state.tab === 'insights') { const ms = state.agg.months; state.period = { mode: 'month', key: ms[ms.length - 1] }; }
      forgetView();
    }
    state.back = null; state.tab = ds.tab; render(); window.scrollTo(0, 0); return;
  }
  if (ds.pmode) { state.period.mode = ds.pmode; state.period.key = null; render(); return; }
  if (ds.pkey) { state.period.key = ds.pkey; render(); return; }
  if (ds.themeset) { applyTheme(ds.themeset); render(); return; }
  if (ds.motionset) { setMotion('mode', ds.motionset); render(); return; }
  if (ds.speedset) { setMotion('speed', ds.speedset); render(); return; }
  if (ds.section) { state.section = ds.section; render(); return; }
  if (ds.cell) {
    const key = ds.cell; const i = key.lastIndexOf('|'); const id = key.slice(0, i), m = key.slice(i + 1);
    const html = () => { const c = state.agg.cell[key]; return `<h2>${h(lineLabel(id))}</h2><p class="fine">${monthLabel(m)} · ${c ? `${c.txs.length} booking${c.txs.length > 1 ? 's' : ''} · ${eur(c.amt)}` : 'no bookings left on this line'}</p>${c ? txList(c.txs) : ''}<button class="btn" data-act="close">Done</button>`; };
    sheet(html(), html);
    return;
  }
  if (ds.dlg) { if (dialogDone) { const inp = $('#dlg-in'); dialogDone(ds.dlg === 'ok' ? (inp ? inp.value : true) : null); } return; }
  if (ds.pjump) { const i = ds.pjump.indexOf('|'); state.period = { mode: ds.pjump.slice(0, i), key: ds.pjump.slice(i + 1) }; render(); return; }
  if (ds.delrule) { const i = ds.delrule.lastIndexOf('|'); const kw = ds.delrule.slice(0, i), sg = ds.delrule.slice(i + 1); await change(`Rule "${kw}" removed`, (s) => { s.profile.rules = s.profile.rules.filter((r) => !(r.mine && r.label === kw && (r.sign || '') === sg)); }); return; }
  if (ds.gosec) { goMonths(ds.gosec, state.period.mode === 'month' ? state.period.key : null); return; }
  if (ds.drill) {
    const i = ds.drill.lastIndexOf('|'); const g = ds.drill.slice(0, i), key = ds.drill.slice(i + 1); const mode = state.period.mode === 'all' ? 'month' : state.period.mode; const ms = monthsIn(key, mode);
    overviewSheet(`${g}, ${periodLabel(key, mode)}`, state.agg.rows.filter((t) => t.line && ms.includes(monthOf(t.date)) && lineMeta(t.line).sec === 'variable' && (lineMeta(t.line).group || 'Other') === g).map((t) => t.id), { section: 'variable', month: ms[ms.length - 1] });
    return;
  }
  if (ds.vendor) {
    const ms = monthsIn(state.period.key, state.period.mode);
    overviewSheet(`${ds.vendor}, ${periodLabel(state.period.key, state.period.mode)}`, state.agg.rows.filter((t) => t.vendor === ds.vendor && ms.includes(monthOf(t.date)) && t.line && lineMeta(t.line).sec === 'variable').map((t) => t.id), { section: 'variable', month: ms[ms.length - 1] });
    return;
  }
  if (ds.tx) { const id = ds.tx; const html = () => { const t = txById(id); return `<h2>${h(t.vendor)}</h2>${txList([t])}<button class="btn" data-act="close">Done</button>`; }; sheet(html(), html); return; }
  if (ds.onetime) { oneTimeSheet(ds.onetime); return; }
  if (ds.passyes) { const id = ds.passyes; await change('Marked as forwarded to India from savings', (s) => { s.txRules[id] = 'pt.sav'; }); return; }
  if (ds.dismiss) { const id = ds.dismiss; await change('Kept as regular spend', (s) => { (s.flagDismissed ||= {})[id] = true; }); return; }
  if (ds.deltrip) { const i = +ds.deltrip; await change('Trip removed', (s) => { s.trips.splice(i, 1); }); return; }
  if (ds.delvendor) { const k = ds.delvendor; await change('Vendor answer removed', (s) => { delete s.vendorRules[k]; }); return; }
  if (ds.deltx) { const k = ds.deltx; await change('Booking answer removed', (s) => { delete s.txRules[k]; }); return; }
  if (ds.renline) {
    const l = state.settings.profile.lines.find((x) => x.id === ds.renline);
    const name = await ask({ title: 'Rename line', input: l.label, ok: 'Rename' }); if (!name || !name.trim()) return;
    await change('Line renamed', (s) => { s.profile.lines.find((x) => x.id === l.id).label = name.trim(); }); return;
  }
  if (ds.delline) {
    const id = ds.delline; const n = state.agg.rows.filter((t) => t.line === id).length;
    if (n && !(await ask({ title: 'Remove this line?', text: `${n} booking${n > 1 ? 's use' : ' uses'} it. They will go back to the rules or to Review.`, ok: 'Remove', danger: true }))) return;
    await change('Line removed', (s) => {
      s.profile.lines = s.profile.lines.filter((x) => x.id !== id);
      for (const k of Object.keys(s.vendorRules)) if (s.vendorRules[k] === id) delete s.vendorRules[k];
      for (const k of Object.keys(s.txRules)) if (s.txRules[k] === id) delete s.txRules[k];
    });
    return;
  }
  const act = ds.act;
  if (act === 'backup') await exportBackup();
  else if (act === 'excel') await exportExcel();
  else if (act === 'exportrules') await exportRules();
  else if (act === 'manage') manageSheet();
  else if (act === 'newrule') sheet(ruleSheetHtml());
  else if (act === 'search') { closeSheet(); if (state.tab !== 'months') state.back = { tab: state.tab, label: TAB_LABEL[state.tab] }; state.tab = 'months'; state.section = 'search'; render(); window.scrollTo(0, 0); const q = $('#q'); if (q) q.focus(); }
  else if (act === 'back') { const bk = state.back; state.back = null; if (bk) { state.tab = bk.tab; render(); window.scrollTo(0, bk.y || 0); } }
  else if (act === 'editmonths') { closeSheet(); goMonths(b.dataset.sec, b.dataset.month); }
  else if (act === 'unlockapp') await unlockApp();
  else if (act === 'lockfallback') await lockFallback();
  else if (act === 'lockoff') { if (await ask({ title: 'Turn off app lock?', text: `The data on this device will no longer be encrypted with ${BIO}; your device's own lock still protects it.`, ok: 'Turn off', danger: true })) { await disableLock(); render(); toast('App lock is off'); } }
  else if (act === 'editbudgets') budgetSheet();
  else if (act === 'editgoal') goalSheet();
  else if (act === 'editsavbal') savBalSheet();
  else if (act === 'clearsavbal') { closeSheet(); await change('Savings starting balance removed', (s) => { s.savingsStart = null; }); }
  else if (act === 'cleargoal') { closeSheet(); await change('Savings goal removed', (s) => { s.goal = null; }); }

  else if (act === 'gsignin') {
    if (C.isStandalone()) { C.signIn(cfg.googleClientId, 'sync'); return; }
    try {
      cloud.token = await C.signInWindow(cfg.googleClientId); await kvSet('gtoken', cloud.token);
      refreshStatus(); if (!cloud.meta || !cloud.meta.fileId) await chooseVault(); else await syncNow();
      render();
    } catch (err) { if (err.code === 'popup_failed_to_open') C.signIn(cfg.googleClientId, 'sync'); else toast(err.message); }
  }
  else if (act === 'syncnow') await syncNow();
  else if (act === 'pickvault') await cloudAction('Opening Google Drive…', async () => { const id = await C.pickVault(cloud.token.token, cfg.googleApiKey, cfg.googleAppId); if (id) { cloud.meta = { fileId: id, owner: false }; await saveCloudMeta(); } });
  else if (act === 'lockvault') { cloud.key = null; await kvSet('cloudKey', null); refreshStatus(); render(); toast('Vault locked on this device'); }
  else if (act === 'forgetvault' || act === 'disconnect') {
    if (act === 'disconnect' && !(await ask({ title: 'Stop syncing this device?', text: 'Your data stays on this device and in Google Drive.', ok: 'Stop syncing', danger: true }))) return;
    cloud.meta = null; cloud.key = null; cloud.dirty = false; await kvSet('cloud', null); await kvSet('cloudKey', null); refreshStatus(); render();
  }
  else if (act === 'theme') { applyTheme(isDark() ? 'light' : 'dark'); render(); }
  else if (act === 'newline') newLineSheet(null);
  else if (act === 'undo') { $('#toast').hidden = true; await undo(); }
  else if (act === 'resetflags') { await change('One-time checks reset', (s) => { s.flagDismissed = {}; }); }
  else if (act === 'close') closeSheet();
  else if (act === 'goreview') { closeSheet(); state.tab = 'review'; render(); }
  else if (act === 'wipe') {
    if (!(await ask({ title: 'Erase everything on this device?', text: 'All bookings, statements, rules and answers on this device are removed. Your vault in Google Drive is not touched.', ok: 'Erase', danger: true }))) return;
    await clear('tx'); await clear('statements'); await clear('kv');
    lock.on = false; lock.key = null; lock.meta = null; lock.vaultRaw = null;
    state.tx = []; state.statements = []; state.settings = fresh(); state.lastBackup = null; state.undo = []; cloud.meta = null; cloud.key = null; cloud.token = null; refreshStatus(); recompute(); render();
  }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.act === 'import' && t.files.length) { await importFiles([...t.files]); t.value = ''; return; }
  if (t.dataset.txline !== undefined && t.value) {
    const allBox = document.querySelector(`[data-txall="${CSS.escape(t.dataset.txline)}"]`);
    const all_ = !!(allBox && allBox.checked);
    if (t.value === '__new') { newLineSheet({ txId: t.dataset.txline, all: all_ }); return; }
    await assign(t.dataset.txline, t.value, all_);
    const li = t.closest('li'); if (li) li.classList.add('saved');
  }
  if (t.dataset.note !== undefined) {
    const id = t.dataset.note; const v = t.value.trim();
    await change(v ? 'Note saved' : 'Note removed', (s) => { s.notes ||= {}; if (v) s.notes[id] = v; else delete s.notes[id]; });
    return;
  }
  if (t.name === 'sec') { const f = t.form; f.querySelectorAll('.grp').forEach((g) => { g.hidden = t.value !== 'variable'; }); }
});
document.addEventListener('input', (e) => {
  const rf = e.target.form && e.target.form.dataset.act === 'saverule' ? e.target.form : null;
  if (rf) { const kw = rf.kw.value.trim(); const hits = kw.length >= 2 ? ruleMatches(kw, rf.sign.value) : []; $('#rule-preview').textContent = kw.length >= 2 ? `Matches ${hits.length} booking${hits.length === 1 ? '' : 's'} so far${hits.length ? `: ${[...new Set(hits.map((t) => t.vendor))].slice(0, 4).join(', ')}` : ''}.` : 'Type at least 2 characters to see which bookings match.'; }
  if (e.target.id === 'q') { state.q = e.target.value; $('#results').innerHTML = searchResults(); }
  if (e.target.form && e.target.form.dataset.act === 'saverule' && e.target.name === 'sign') e.target.form.kw.dispatchEvent(new Event('input', { bubbles: true }));
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const fd = new FormData(f);
  if (f.dataset.act === 'addtrip') {
    if (fd.get('to') < fd.get('from')) { toast('The trip ends before it starts.'); return; }
    const trip = { name: fd.get('name').trim(), from: fd.get('from'), to: fd.get('to'), scope: fd.get('all') ? 'all' : 'dining' };
    await change(`Trip "${trip.name}" added`, (s) => { s.trips.push(trip); });
  } else if (f.dataset.act === 'start') {
    const v = fd.get('start') || null; await change('Start month saved', (s) => { s.startMonth = v; });
  } else if (f.dataset.act === 'newline') {
    const sec = fd.get('sec'); let group = fd.get('group');
    if (group === '__newgroup') group = (fd.get('newgroup') || '').trim() || 'Other';
    const ctx = takePendingNew();
    const label = fd.get('label').trim();
    const tx = ctx ? txById(ctx.txId) : null;
    closeSheet();
    await change(tx ? `Created "${label}" and moved ${tx.vendor}` : `Line "${label}" created`, (s) => {
      const id = createLine(s, { label, sec, group });
      if (tx) { if (ctx.all) s.vendorRules[tx.vkey] = id; else s.txRules[tx.id] = id; }
    });
  } else if (f.dataset.act === 'onetime') {
    const txId = f.dataset.tx; const label = (fd.get('label') || '').trim(); const existing = fd.get('existing');
    if (!label && !existing) { toast('Name the item or pick an existing one-time line.'); return; }
    closeSheet();
    await change(`Moved to one-time: ${label || lineLabel(existing)}`, (s) => {
      s.txRules[txId] = existing || createLine(s, { label, sec: 'onetime', group: '' });
      if (s.flagDismissed) s.flagDismissed[txId] = null;
    });
  } else if (f.dataset.act === 'budgets') {
    const nb = {}; for (const [k, v] of fd.entries()) if (v !== '' && +v > 0) nb[k] = +v;
    closeSheet(); await change('Budgets saved', (s) => { s.budgets = nb; });
  } else if (f.dataset.act === 'savbal') {
    const v = { month: fd.get('month'), amount: Math.round(parseFloat(String(fd.get('amount')).replace(',', '.')) * 100) / 100 };
    if (Number.isNaN(v.amount)) return;
    closeSheet(); await change('Savings starting balance saved', (s) => { s.savingsStart = v; });
  } else if (f.dataset.act === 'goal') {
    const goal = { year: +fd.get('year'), amount: +fd.get('amount') };
    closeSheet(); await change('Savings goal saved', (s) => { s.goal = goal; });
  } else if (f.dataset.act === 'saverule') {
    const kw = fd.get('kw').trim(); const line = fd.get('line'); const sign = fd.get('sign') || '';
    if (kw.length < 2 || !line) return;
    await change(`Rule "${kw}" saved`, (s) => addUserRule(s, kw, line, sign)); manageSheet();
  } else if (f.dataset.act === 'bulk') {
    const line = fd.get('line'); if (!line) return; const ids = searchHits().map((t) => t.id); const kw = state.q.trim();
    const n = ids.length;
    await change(`${n} booking${n === 1 ? '' : 's'} moved to ${lineLabel(line)}${fd.get('future') ? ', with a rule for future ones' : ''}`, (s) => {
      for (const id of ids) s.txRules[id] = line;
      if (fd.get('future')) addUserRule(s, kw, line, '');
    });
  } else if (f.dataset.act === 'lockon') {
    showBusy(`Setting up ${BIO}…`);
    try { await enableLock(fd.get('p')); toast('App lock is on'); } catch (err) { toast(err.message); } finally { hideBusy(); render(); }
  } else if (f.dataset.act === 'createvault') {
    if (fd.get('p1') !== fd.get('p2')) { toast('The two passphrases are different.'); return; }
    await cloudAction('Creating your encrypted vault…', () => createVaultFlow(fd.get('p1'), !!fd.get('remember')));
  } else if (f.dataset.act === 'unlock') {
    await cloudAction('Unlocking…', () => unlockFlow(fd.get('p'), !!fd.get('remember')));
  }
});
export async function cloudAction(msg, fn) {
  showBusy(msg);
  try { await fn(); refreshStatus(); toast('Cloud sync is on'); }
  catch (e) { if (e.code === 401) { cloud.token = null; await kvSet('gtoken', null); } refreshStatus(); toast(e.message); }
  finally { hideBusy(); render(); }
}
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (dialogDone) dialogDone(null); else if (!$('#sheet').hidden) closeSheet();
});

// ---------------- boot ----------------
(async () => {
  if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch { /* not granted */ } }
  applyTheme(currentTheme()); applyMotion();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (currentTheme() === 'auto') applyTheme('auto'); });
  await load(); await loadCloud();
  const red = C.readRedirect();
  if (red && red.token) { cloud.token = { token: red.token, exp: red.exp }; await kvSet('gtoken', cloud.token); refreshStatus(); if (!cloud.meta || !cloud.meta.fileId) { state.tab = 'data'; try { await chooseVault(); } catch (e) { toast(e.message); } } }
  else if (red && red.error) { state.tab = 'data'; toast(red.error); }
  refreshStatus(); render();
  if (cloud.status === 'synced' && !(lock.on && !lock.key)) syncNow(true);
  // B34: iOS can close the app right after an edit; save the encrypted data immediately.
  window.addEventListener('pagehide', () => { if (lock.on && lock.key) sealAll(); });
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); if (lock.on && lock.key) await sealAll(); return; }
    if (lock.on && lock.key && hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) { location.reload(); return; }
    if (cloud.status === 'synced' && !(lock.on && !lock.key)) syncNow(true);
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => { /* offline copy not available here */ });
  window.__app = { state, cloud, importFiles, exportExcel, buildWorkbook, reconcile, refresh: () => { recompute(); render(); } }; // used by automated checks
})();
