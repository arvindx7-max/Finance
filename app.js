import { parsePdf, parseCsv } from './parser.js';
import { aggregate, reconcile, DEFAULT_SETTINGS, emptyProfile, lines, SECTIONS, USER_SECTIONS, lineLabel, lineMeta, monthLabel, deDate, monthOf } from './model.js';
import { buildWorkbook } from './xlsx.js';

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
const state = { tx: [], statements: [], settings: fresh(), lastBackup: null, tab: 'overview', month: null, section: 'fixed', q: '', agg: null, undo: [] };
async function load() {
  state.tx = await all('tx');
  state.statements = await all('statements');
  state.settings = { ...fresh(), ...(await kvGet('settings', {})) };
  state.lastBackup = await kvGet('lastBackup', null);
  state.undo = await kvGet('undo', []);
  recompute();
}
function recompute() {
  state.agg = aggregate(state.tx, state.settings);
  const ms = state.agg.months;
  if (!state.month || !ms.includes(state.month)) state.month = ms[ms.length - 1] || null;
}
const saveSettings = () => kvSet('settings', state.settings);
const ensureProfile = () => (state.settings.profile ||= emptyProfile());

// Every change to your answers, lines or trips can be undone (last 15 steps).
async function change(label, fn) {
  state.undo.push(JSON.stringify(state.settings));
  if (state.undo.length > 15) state.undo.shift();
  fn(state.settings);
  await saveSettings(); await kvSet('undo', state.undo);
  recompute(); render();
  toast(label, true);
}
async function undo() {
  const prev = state.undo.pop(); if (!prev) return;
  state.settings = JSON.parse(prev);
  await saveSettings(); await kvSet('undo', state.undo);
  recompute(); render(); toast('Undone');
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
  showImportReport(report);
}

// ---------------- your rules file (kept on this phone, never in the app code) ----------------
async function loadRules(j) {
  if (!Array.isArray(j.rules) || !Array.isArray(j.lines)) throw new Error('rules file is missing its "rules" or "lines" list');
  for (const r of j.rules) for (const p of [...(r.any || []), ...(r.all || []), ...(r.none || [])]) new RegExp(p, 'i'); // fail early on a bad pattern
  const { vendorAnswers = {}, bookingAnswers = {}, dismissed = {}, ...profile } = j;
  const s = state.settings;
  s.profile = profile;
  if (Array.isArray(j.trips)) s.trips = j.trips;
  if (j.startMonth) s.startMonth = j.startMonth;
  s.vendorRules = { ...s.vendorRules, ...vendorAnswers };
  s.txRules = { ...s.txRules, ...bookingAnswers };
  s.flagDismissed = { ...s.flagDismissed, ...dismissed };
  await saveSettings();
  return `your rules loaded (${j.rules.length} rules, ${j.lines.length} line names, ${Object.keys(vendorAnswers).length} vendor answers)`;
}
function rulesPayload() {
  const s = state.settings;
  return { ...(s.profile || emptyProfile()), trips: s.trips, startMonth: s.startMonth,
    vendorAnswers: s.vendorRules, bookingAnswers: s.txRules, dismissed: s.flagDismissed };
}
const exportRules = () => deliver(new Blob([JSON.stringify(rulesPayload(), null, 2)], { type: 'application/json' }), 'my-rules.json');

// ---------------- backup ----------------
function backupPayload() {
  return { app: 'finance-insights', version: 2, exportedAt: new Date().toISOString(), tx: state.tx, statements: state.statements, settings: state.settings };
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
  const keptV = Object.keys(local.vendorRules).filter((k) => !(k in inc.vendorRules)).length;
  const keptT = Object.keys(local.txRules).filter((k) => !(k in inc.txRules)).length;
  inc.vendorRules = { ...local.vendorRules, ...inc.vendorRules };
  inc.txRules = { ...local.txRules, ...inc.txRules };
  inc.flagDismissed = { ...local.flagDismissed, ...inc.flagDismissed };
  const localOwn = (local.profile?.lines || []).filter((l) => l.id.startsWith('c.'));
  if (localOwn.length) {
    inc.profile ||= emptyProfile();
    const have = new Set(inc.profile.lines.map((l) => l.id));
    inc.profile.lines = [...inc.profile.lines, ...localOwn.filter((l) => !have.has(l.id))];
  }
  state.settings = inc; await saveSettings();
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
  const n = state.agg.review.length + state.agg.flags.length;
  $('#review-badge').textContent = n; $('#review-badge').hidden = !n;
  const main = $('#main');
  if (!state.tx.length && state.tab !== 'data') { main.innerHTML = emptyView(); return; }
  main.innerHTML = { overview: overviewView, months: monthsView, review: reviewView, data: dataView }[state.tab]();
}

function emptyView() {
  return `<section class="empty">
    <h1>Start with your statements</h1>
    <p>Add your Deutsche Bank Kontoauszug PDFs (or the CSV export). Everything is read and stored on this phone only.</p>
    <label class="btn primary">Add statements<input type="file" accept=".pdf,.csv,.json,application/pdf,text/csv,application/json" multiple data-act="import" hidden></label>
    <p class="fine">Your rules file (my-rules.json) and backups are .json files: choose them here too.</p>
  </section>`;
}
function backupBanner() {
  const d = daysSince(state.lastBackup);
  if (d !== null && d < 7) return '';
  return `<button class="banner" data-act="backup">${d === null ? 'No backup yet.' : `Last backup: ${d} days ago.`} <u>Export backup</u></button>`;
}
function monthPicker() {
  return `<div class="months" role="tablist">${state.agg.months.map((m) => `<button role="tab" aria-selected="${m === state.month}" data-month="${m}">${monthLabel(m, true)}<small>${m.slice(2, 4)}</small></button>`).join('')}</div>`;
}

function overviewView() {
  const s = state.agg.summary.find((x) => x.month === state.month);
  const rec = reconcile(state.tx, pdfStatements());
  const st = rec.find((r) => monthOf(r.to) === state.month);
  const tie = st ? (Math.abs(st.diff) < 0.005 && st.chainOk) : null;
  const top = topVendors(state.month, 5);
  const pending = state.agg.review.filter((t) => monthOf(t.date) === state.month).length;
  return `${backupBanner()}${monthPicker()}
  <section class="ledger">
    <p class="ledger-month">${monthLabel(state.month)}</p>
    <ol class="sum">
      <li><span>Earned income</span><b>${eur(s.earned)}</b></li>
      <li><span>− Fixed / recurring</span><b>${eur(s.fixed)}</b></li>
      <li><span>− Variable</span><b>${eur(s.variable)}</b></li>
      <li><span>− One-time</span><b>${eur(s.onetime)}</b></li>
      <li><span>− Sent to India</span><b>${eur(s.india)}</b></li>
    </ol>
    <div class="savings ${s.saved < 0 ? 'neg' : 'pos'}"><span>Saved</span><strong>${eur(s.saved)}</strong></div>
    <ol class="sum went">
      <li><span>Moved to savings, net</span><b>${eur(s.netToSav)}</b></li>
      <li><span>Kept in this account</span><b>${eur(s.kept)}</b></li>
    </ol>
    ${s.passThrough ? `<p class="fine">${eur(s.passThrough)} received and forwarded to India is left out.</p>` : ''}
    ${st ? `<p class="seal ${tie ? 'ok' : 'bad'}">${tie ? `Ties to statement: ${eur(st.open)} → ${eur(st.close)}` : `Does not tie: off by ${eur(st.diff)}`}</p>` : '<p class="seal">No statement for this month yet</p>'}
    ${pending ? `<button class="seal bad link" data-tab="review">${pending} booking${pending > 1 ? 's' : ''} (${eur(s.unassigned)}) still need review</button>` : ''}
  </section>
  <section class="card"><h2>Earned, spent and saved</h2>${chartFlows()}</section>
  <section class="card"><h2>Savings rate</h2>${chartRate()}</section>
  <section class="card"><h2>Variable spend by category</h2>${chartStack()}</section>
  <section class="card"><h2>Top variable vendors, ${monthLabel(state.month, true)}</h2>${top.length ? barsH(top) : '<p class="fine">No variable spend this month.</p>'}</section>`;
}
function topVendors(month, n) {
  const m = {};
  for (const t of state.agg.rows) if (monthOf(t.date) === month && t.line && lineMeta(t.line).sec === 'variable') m[t.vendor] = (m[t.vendor] || 0) - t.amount;
  return Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ---------------- charts (inline SVG) ----------------
const W = 340, PAD = 34;
function scale(min, max, h, top = 10) { const span = max - min || 1; return (v) => top + (max - v) / span * h; }
function axis(y, min, max, unit = '') {
  const ticks = [min, 0, max].filter((v, i, a) => a.indexOf(v) === i && v >= min && v <= max);
  return ticks.map((v) => `<line x1="${PAD}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'zero' : 'grid'}"/><text x="${PAD - 4}" y="${y(v) + 3}" class="tick" text-anchor="end">${v === 0 ? '0' : (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v))}${v ? unit : ''}</text>`).join('');
}
function chartFlows() {
  const S = state.agg.summary; const H = 150;
  const out = S.map((s) => s.spent + s.india);
  const max = Math.max(...S.map((s) => s.earned), ...out, 1), min = Math.min(0, ...S.map((s) => s.saved));
  const y = scale(min, max, H); const bw = (W - PAD) / S.length;
  const bars = S.map((s, i) => {
    const x = PAD + i * bw; const sel = s.month === state.month ? ' sel' : '';
    return `<rect x="${x + bw * 0.12}" width="${bw * 0.3}" y="${y(s.earned)}" height="${y(0) - y(s.earned)}" class="b-in${sel}"/>
      <rect x="${x + bw * 0.44}" width="${bw * 0.3}" y="${y(out[i])}" height="${y(0) - y(out[i])}" class="b-out${sel}"/>
      <text x="${x + bw * 0.43}" y="${H + 26}" class="tick" text-anchor="middle">${monthLabel(s.month, true)}</text>`;
  }).join('');
  const px = (i) => PAD + i * bw + bw * 0.43;
  return `<svg viewBox="0 0 ${W} ${H + 32}" class="chart" role="img" aria-label="Earned, spent and saved per month">${axis(y, Math.round(min), Math.round(max))}${bars}<polyline points="${S.map((s, i) => `${px(i)},${y(s.saved)}`).join(' ')}" class="l-sav"/>${S.map((s, i) => `<circle cx="${px(i)}" cy="${y(s.saved)}" r="3" class="d-sav"/>`).join('')}</svg>
  <p class="legend"><i class="k-in"></i>Earned <i class="k-out"></i>Spent + sent to India <i class="k-sav"></i>Saved</p>`;
}
function chartRate() {
  const S = state.agg.summary; const H = 110;
  const v = S.map((s) => s.savingsRate * 100);
  const max = Math.max(10, ...v), min = Math.min(0, ...v);
  const y = scale(min, max, H); const bw = (W - PAD) / S.length;
  const px = (i) => PAD + i * bw + bw / 2;
  return `<svg viewBox="0 0 ${W} ${H + 32}" class="chart" role="img" aria-label="Savings rate per month">${axis(y, Math.round(min), Math.round(max), '%')}<polyline points="${v.map((r, i) => `${px(i)},${y(r)}`).join(' ')}" class="l-rate"/>${v.map((r, i) => `<circle cx="${px(i)}" cy="${y(r)}" r="3.5" class="d-rate"/><text x="${px(i)}" y="${y(r) - 7}" class="val" text-anchor="middle">${Math.round(r)}%</text><text x="${px(i)}" y="${H + 26}" class="tick" text-anchor="middle">${monthLabel(S[i].month, true)}</text>`).join('')}</svg>
  <p class="fine">Saved as a share of earned income.</p>`;
}
const GROUP_COLORS = ['#1F3864', '#4472C4', '#8FAADC', '#2E7D32', '#C9A227', '#B4532A', '#7A5195', '#8496B0', '#5E6A80', '#2B8C8C'];
function chartStack() {
  const S = state.agg.summary; const H = 150;
  const used = state.agg.order.filter((l) => l.sec === 'variable');
  const groups = [...new Set(used.map((l) => l.group || 'Other'))];
  const val = (g, m) => -state.agg.rows.filter((t) => t.line && monthOf(t.date) === m && lineMeta(t.line).sec === 'variable' && (lineMeta(t.line).group || 'Other') === g).reduce((a, t) => a + t.amount, 0);
  const max = Math.max(...S.map((s) => s.variable), 1);
  const y = scale(0, max, H); const bw = (W - PAD) / S.length;
  const bars = S.map((s, i) => {
    let acc = 0; const x = PAD + i * bw + bw * 0.18;
    return groups.map((g, gi) => { const v = Math.max(0, val(g, s.month)); const r = `<rect x="${x}" width="${bw * 0.64}" y="${y(acc + v)}" height="${y(acc) - y(acc + v)}" fill="${GROUP_COLORS[gi % GROUP_COLORS.length]}"/>`; acc += v; return r; }).join('') + `<text x="${x + bw * 0.32}" y="${H + 26}" class="tick" text-anchor="middle">${monthLabel(s.month, true)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H + 32}" class="chart" role="img" aria-label="Variable spend by category per month">${axis(y, 0, Math.round(max))}${bars}</svg>
  <p class="legend wrap">${groups.map((g, gi) => `<span><i style="background:${GROUP_COLORS[gi % GROUP_COLORS.length]}"></i>${h(g)}</span>`).join('')}</p>`;
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
  if (state.section === 'search') return seg + searchView();
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
  return `${seg}<div class="tablewrap"><table class="grid"><thead><tr><th>Line</th>${ms.map((m) => `<th>${monthLabel(m, true)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${rows || `<tr><td colspan="${ms.length + 2}" class="fine">Nothing in this section yet.</td></tr>`}</tbody><tfoot>${foot}</tfoot></table></div>
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
async function createLine({ label, sec, group }) {
  const id = `c.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  ensureProfile().lines.push({ id, sec, label, group: sec === 'variable' ? group : '' });
  return id;
}

// ---------------- review ----------------
function reviewView() {
  const r = state.agg.review; const f = state.agg.flags;
  if (!r.length && !f.length) return `<section class="empty small"><h1>Nothing to review</h1><p>Every booking matched a rule or one of your answers, and nothing looks like a one-time spend.</p></section>`;
  const byV = {};
  for (const t of r) (byV[t.vkey] ||= []).push(t);
  return `${r.length ? `<section class="pad"><h1 class="h1">Unknown vendors</h1><p class="fine">Pick a line once; with "Apply to every booking" ticked, the app uses it for this vendor from now on.</p></section>
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
  const nAns = Object.keys(s.vendorRules).length + Object.keys(s.txRules).length;
  const own = (s.profile?.lines || []).filter((l) => l.id.startsWith('c.')).length;
  return `<section class="card">
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
  </section>
  <p class="fine pad">${state.tx.length} bookings stored · runs offline · nothing leaves this device</p>`;
}

function manageSheet() {
  const s = state.settings;
  const v = Object.entries(s.vendorRules);
  const b = Object.entries(s.txRules);
  const own = (s.profile?.lines || []).filter((l) => l.id.startsWith('c.'));
  const nDis = Object.keys(s.flagDismissed || {}).length;
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
    ${review || state.agg.flags.length ? '<button class="btn" data-act="goreview">Open Review</button>' : ''}
    <button class="btn" data-act="close">Done</button>`);
}

// ---------------- events ----------------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button, [data-month], [data-section], [data-cell]');
  if (!b) return;
  const ds = b.dataset;
  if (ds.tab) { closeSheet(); state.tab = ds.tab; render(); window.scrollTo(0, 0); return; }
  if (ds.month) { state.month = ds.month; render(); return; }
  if (ds.section) { state.section = ds.section; render(); return; }
  if (ds.cell) {
    const c = state.agg.cell[ds.cell]; const i = ds.cell.lastIndexOf('|'); const id = ds.cell.slice(0, i), m = ds.cell.slice(i + 1);
    sheet(`<h2>${h(lineLabel(id))}</h2><p class="fine">${monthLabel(m)} · ${c.txs.length} booking${c.txs.length > 1 ? 's' : ''} · ${eur(c.amt)}</p>${txList(c.txs)}<button class="btn" data-act="close">Done</button>`);
    return;
  }
  if (ds.tx) { const t = txById(ds.tx); sheet(`<h2>${h(t.vendor)}</h2>${txList([t])}<button class="btn" data-act="close">Done</button>`); return; }
  if (ds.onetime) { oneTimeSheet(ds.onetime); return; }
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
  else if (act === 'newline') newLineSheet(null);
  else if (act === 'undo') { $('#toast').hidden = true; await undo(); }
  else if (act === 'resetflags') { await change('One-time checks reset', (s) => { s.flagDismissed = {}; }); manageSheet(); }
  else if (act === 'close') closeSheet();
  else if (act === 'goreview') { closeSheet(); state.tab = 'review'; render(); }
  else if (act === 'wipe') {
    if (!confirm('Erase all bookings, statements, rules and answers on this phone?')) return;
    await clear('tx'); await clear('statements'); await clear('kv');
    state.tx = []; state.statements = []; state.settings = fresh(); state.lastBackup = null; state.undo = []; recompute(); render();
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
    let newId;
    await change(`Line "${label}" created`, () => { /* line added below, inside the same undo step */ });
    newId = await createLine({ label, sec, group }); await saveSettings(); recompute();
    closeSheet();
    if (ctx) {
      const tx = txById(ctx.txId);
      if (ctx.all) state.settings.vendorRules[tx.vkey] = newId; else state.settings.txRules[tx.id] = newId;
      await saveSettings(); recompute(); render(); toast(`Created "${label}" and moved ${tx.vendor}`, true);
    } else { render(); toast(`Line "${label}" created`, true); }
  } else if (f.dataset.act === 'onetime') {
    const txId = f.dataset.tx; const label = (fd.get('label') || '').trim(); const existing = fd.get('existing');
    if (!label && !existing) { alert('Name the item or pick an existing one-time line.'); return; }
    closeSheet();
    await change(`Moved to one-time: ${label || lineLabel(existing)}`, () => {});
    const id = existing || await createLine({ label, sec: 'onetime', group: '' });
    state.settings.txRules[txId] = id; delete (state.settings.flagDismissed || {})[txId];
    await saveSettings(); recompute(); render();
  }
});
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

// ---------------- boot ----------------
(async () => {
  if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch { /* not granted */ } }
  await load(); render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js');
  window.__app = { state, importFiles, exportExcel, buildWorkbook, reconcile, refresh: () => { recompute(); render(); } }; // used by automated checks
})();
