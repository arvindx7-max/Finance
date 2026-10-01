import { parsePdf, parseCsv } from './parser.js';
import { aggregate, reconcile, DEFAULT_SETTINGS, lines, SECTIONS, lineLabel, lineMeta, monthLabel, dateSummary, deDate, monthOf } from './model.js';
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
const state = { tx: [], statements: [], settings: structuredClone(DEFAULT_SETTINGS), lastBackup: null, tab: 'overview', month: null, section: 'fixed', agg: null };
async function load() {
  state.tx = await all('tx');
  state.statements = await all('statements');
  state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(await kvGet('settings', {})) };
  state.lastBackup = await kvGet('lastBackup', null);
  recompute();
}
function recompute() {
  state.agg = aggregate(state.tx, state.settings);
  const ms = state.agg.months;
  if (!state.month || !ms.includes(state.month)) state.month = ms[ms.length - 1] || null;
}
const saveSettings = () => kvSet('settings', state.settings);

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
  showBusy(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`);
  try {
    for (const f of files) {
      try {
        if (/\.json$/i.test(f.name)) {
          const j = JSON.parse(await f.text());
          if (j.app === 'finance-insights-rules') { await loadRules(j); report.files.push(`${f.name}: your rules loaded (${(j.rules || []).length} rules, ${(j.lines || []).length} line names)`); continue; }
          await restoreBackup(j); report.files.push(`${f.name}: backup restored`); continue;
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
        if (statement) { await putMany('statements', [statement]); state.statements = state.statements.filter((s) => s.id !== statement.id).concat(statement); }
        if (checkpoint) { await putMany('statements', [checkpoint]); state.statements = state.statements.filter((s) => s.id !== checkpoint.id).concat(checkpoint); }
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
  state.settings.profile = j;
  if (Array.isArray(j.trips)) state.settings.trips = j.trips;
  if (j.startMonth) state.settings.startMonth = j.startMonth;
  await saveSettings();
}
async function exportRules() {
  const p = { ...(state.settings.profile || { app: 'finance-insights-rules', version: 1, lines: [], rules: [], notes: {}, sheetNames: {} }) };
  p.trips = state.settings.trips; p.startMonth = state.settings.startMonth;
  await deliver(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), 'my-rules.json');
}

// ---------------- backup ----------------
function backupPayload() {
  return { app: 'finance-insights', version: 1, exportedAt: new Date().toISOString(), tx: state.tx, statements: state.statements, settings: state.settings };
}
async function exportBackup() {
  const name = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(backupPayload())], { type: 'application/json' });
  const ok = await deliver(blob, name);
  if (ok) { state.lastBackup = new Date().toISOString(); await kvSet('lastBackup', state.lastBackup); render(); }
}
async function restoreBackup(p) {
  if (p.app !== 'finance-insights' || !Array.isArray(p.tx)) throw new Error('not a backup file from this app');
  await clear('tx'); await clear('statements');
  await putMany('tx', p.tx); await putMany('statements', p.statements || []);
  state.tx = p.tx; state.statements = p.statements || [];
  state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(p.settings || {}) }; await saveSettings();
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
const eur0 = (v) => `${v < 0 ? '−' : ''}€${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.abs(v))}`;
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);

function showBusy(msg) { const b = $('#busy'); b.textContent = msg; b.hidden = false; }
function hideBusy() { $('#busy').hidden = true; }
function sheet(html, onMount) {
  const s = $('#sheet'); $('#sheet-body').innerHTML = html; s.hidden = false;
  requestAnimationFrame(() => s.classList.add('open'));
  if (onMount) onMount($('#sheet-body'));
}
function closeSheet() { const s = $('#sheet'); s.classList.remove('open'); setTimeout(() => { s.hidden = true; }, 220); }

// ---------------- render ----------------
function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false'));
  const n = state.agg.review.length;
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
  return `${backupBanner()}${monthPicker()}
  <section class="ledger">
    <p class="ledger-month">${monthLabel(state.month)}</p>
    <ol class="sum">
      <li><span>Income</span><b>${eur(s.income)}</b></li>
      <li><span>− Fixed / recurring</span><b>${eur(s.fixed)}</b></li>
      <li><span>− Variable</span><b>${eur(s.variable)}</b></li>
      <li><span>− One-time</span><b>${eur(s.onetime)}</b></li>
      <li><span>− Outbound transfers</span><b>${eur(s.transfers)}</b></li>
    </ol>
    <div class="savings ${s.savings < 0 ? 'neg' : 'pos'}"><span>Savings</span><strong>${eur(s.savings)}</strong></div>
    ${st ? `<p class="seal ${tie ? 'ok' : 'bad'}">${tie ? `Ties to statement: ${eur(st.open)} → ${eur(st.close)}` : `Does not tie: off by ${eur(st.diff)}`}</p>` : '<p class="seal">No statement for this month yet</p>'}
    ${s.unassigned ? `<p class="seal bad">${eur(s.unassigned)} still needs review</p>` : ''}
  </section>
  <section class="card"><h2>Income, expenses and savings</h2>${chartFlows()}</section>
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
function axis(y, min, max, h) {
  const ticks = [min, 0, max].filter((v, i, a) => a.indexOf(v) === i && v >= min && v <= max);
  return ticks.map((v) => `<line x1="${PAD}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'zero' : 'grid'}"/><text x="${PAD - 4}" y="${y(v) + 3}" class="tick" text-anchor="end">${v === 0 ? '0' : (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v))}</text>`).join('');
}
function chartFlows() {
  const S = state.agg.summary; const H = 150;
  const out = S.map((s) => s.expenses + s.transfers);
  const max = Math.max(...S.map((s) => s.income), ...out), min = Math.min(0, ...S.map((s) => s.savings));
  const y = scale(min, max, H); const bw = (W - PAD) / S.length;
  const bars = S.map((s, i) => {
    const x = PAD + i * bw;
    const sel = s.month === state.month ? ' sel' : '';
    return `<rect x="${x + bw * 0.12}" width="${bw * 0.3}" y="${y(s.income)}" height="${y(0) - y(s.income)}" class="b-in${sel}"/>
      <rect x="${x + bw * 0.44}" width="${bw * 0.3}" y="${y(out[i])}" height="${y(0) - y(out[i])}" class="b-out${sel}"/>
      <text x="${x + bw * 0.43}" y="${H + 26}" class="tick" text-anchor="middle">${monthLabel(s.month, true)}</text>`;
  }).join('');
  const pts = S.map((s, i) => `${PAD + i * bw + bw * 0.43},${y(s.savings)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H + 32}" class="chart" role="img" aria-label="Income, money out and savings per month">${axis(y, min, max, H)}${bars}<polyline points="${pts}" class="l-sav"/>${S.map((s, i) => `<circle cx="${PAD + i * bw + bw * 0.43}" cy="${y(s.savings)}" r="3" class="d-sav"/>`).join('')}</svg>
  <p class="legend"><i class="k-in"></i>Income <i class="k-out"></i>Expenses + transfers <i class="k-sav"></i>Savings</p>`;
}
function chartRate() {
  const S = state.agg.summary; const H = 110;
  const v = S.map((s) => s.savingsRate * 100);
  const max = Math.max(10, ...v), min = Math.min(0, ...v);
  const y = scale(min, max, H); const bw = (W - PAD) / S.length;
  const pts = v.map((r, i) => `${PAD + i * bw + bw / 2},${y(r)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H + 32}" class="chart" role="img" aria-label="Savings rate per month">${axis(y, Math.round(min), Math.round(max), H).replace(/(\d+k?)<\/text>/g, '$1%</text>')}<polyline points="${pts}" class="l-rate"/>${v.map((r, i) => `<circle cx="${PAD + i * bw + bw / 2}" cy="${y(r)}" r="3.5" class="d-rate"/><text x="${PAD + i * bw + bw / 2}" y="${y(r) - 7}" class="val" text-anchor="middle">${Math.round(r)}%</text><text x="${PAD + i * bw + bw / 2}" y="${H + 26}" class="tick" text-anchor="middle">${monthLabel(S[i].month, true)}</text>`).join('')}</svg>`;
}
const GROUP_COLORS = ['#1F3864', '#4472C4', '#8FAADC', '#2E7D32', '#C9A227', '#B4532A', '#7A5195', '#8496B0', '#5E6A80'];
function chartStack() {
  const S = state.agg.summary; const H = 150;
  const groups = [...new Set(lines().filter((l) => l.sec === 'variable').map((l) => l.group))];
  const val = (g, m) => -state.agg.rows.filter((t) => t.line && monthOf(t.date) === m && lineMeta(t.line).sec === 'variable' && lineMeta(t.line).group === g).reduce((a, t) => a + t.amount, 0);
  const max = Math.max(...S.map((s) => s.variable), 1);
  const y = scale(0, max, H); const bw = (W - PAD) / S.length;
  const bars = S.map((s, i) => {
    let acc = 0; const x = PAD + i * bw + bw * 0.18;
    return groups.map((g, gi) => { const v = Math.max(0, val(g, s.month)); const r = `<rect x="${x}" width="${bw * 0.64}" y="${y(acc + v)}" height="${y(acc) - y(acc + v)}" fill="${GROUP_COLORS[gi % GROUP_COLORS.length]}"/>`; acc += v; return r; }).join('') + `<text x="${x + bw * 0.32}" y="${H + 26}" class="tick" text-anchor="middle">${monthLabel(s.month, true)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H + 32}" class="chart" role="img" aria-label="Variable spend by category per month">${axis(y, 0, Math.round(max), H)}${bars}</svg>
  <p class="legend wrap">${groups.map((g, gi) => `<span><i style="background:${GROUP_COLORS[gi % GROUP_COLORS.length]}"></i>${h(g)}</span>`).join('')}</p>`;
}
function barsH(items) {
  const max = items[0][1];
  return `<ul class="hbars">${items.map(([k, v]) => `<li><span>${h(k)}</span><b>${eur(v)}</b><i style="width:${(v / max * 100).toFixed(1)}%"></i></li>`).join('')}</ul>`;
}

// ---------------- months (workbook-style tables) ----------------
// Phone-sized version of the workbook's date column (the Excel export keeps full dates).
function shortDates(dates) {
  const s = [...dates].sort(); const dm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  return s.length > 3 ? `${s.length}x · ${dm(s[0])}–${dm(s[s.length - 1])}` : s.map(dm).join(', ');
}
function monthsView() {
  const secs = [['fixed', 'Fixed'], ['variable', 'Variable'], ['onetime', 'One-time'], ['income', 'Income']];
  const a = state.agg; const ms = a.months;
  const lines = a.order.filter((l) => (state.section === 'income' ? ['income', 'transfer'].includes(l.sec) : l.sec === state.section));
  let group = null;
  const rows = lines.map((l) => {
    const sign = l.sec === 'income' ? 1 : -1;
    let bar = '';
    const g = state.section === 'variable' ? l.group : state.section === 'income' ? SECTIONS[l.sec] : '';
    if (g && g !== group) { group = g; bar = `<tr class="bar"><th colspan="${ms.length + 2}">${h(g)}</th></tr>`; }
    let tot = 0;
    const cells = ms.map((m) => { const c = a.cell[`${l.id}|${m}`]; if (!c) return '<td class="nil">–</td>'; tot += sign * c.amt; return `<td><button data-cell="${l.id}|${m}">${nf.format(sign * c.amt)}<small>${h(shortDates(c.dates))}</small></button></td>`; }).join('');
    return `${bar}<tr><th>${h(l.label)}</th>${cells}<td class="tot">${nf.format(tot)}</td></tr>`;
  }).join('');
  const key = { fixed: 'fixed', variable: 'variable', onetime: 'onetime' }[state.section];
  const foot = key ? `<tr class="total"><th>Total</th>${a.summary.map((s) => `<td>${nf.format(s[key])}</td>`).join('')}<td class="tot">${nf.format(a.summary.reduce((x, s) => x + s[key], 0))}</td></tr>`
    : ['income', 'transfers', 'savings'].map((k) => `<tr class="total"><th>${{ income: 'Total income', transfers: 'Outbound transfers', savings: 'Savings' }[k]}</th>${a.summary.map((s) => `<td>${nf.format(s[k])}</td>`).join('')}<td class="tot">${nf.format(a.summary.reduce((x, s) => x + s[k], 0))}</td></tr>`).join('');
  return `<div class="seg" role="tablist">${secs.map(([k, l]) => `<button role="tab" aria-selected="${state.section === k}" data-section="${k}">${l}</button>`).join('')}</div>
  <div class="tablewrap"><table class="grid"><thead><tr><th>Line</th>${ms.map((m) => `<th>${monthLabel(m, true)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${rows || `<tr><td colspan="${ms.length + 2}" class="fine">Nothing in this section yet.</td></tr>`}</tbody><tfoot>${foot}</tfoot></table></div>
  <p class="fine pad">Tap an amount to see its bookings and move any of them to another line.</p>`;
}

function lineOptions(selected) {
  const trips = state.settings.trips.map((t) => ({ id: `trip:${t.name}`, sec: 'variable', label: lineLabel(`trip:${t.name}`) }));
  const L = lines(); const list = [...L.filter((l) => l.sec !== 'variable'), ...L.filter((l) => l.sec === 'variable'), ...trips];
  const bySec = {};
  for (const l of list) (bySec[l.sec] ||= []).push(l);
  return Object.entries(bySec).map(([sec, ls]) => `<optgroup label="${h(SECTIONS[sec])}">${ls.map((l) => `<option value="${l.id}"${l.id === selected ? ' selected' : ''}>${h(l.label)}</option>`).join('')}</optgroup>`).join('');
}
function txList(txs, allDefault = false) {
  return `<ul class="txs">${txs.sort((x, y) => x.date.localeCompare(y.date)).map((t) => `<li>
    <div><b>${h(t.vendor)}</b><span>${deDate(t.date)}${t.cardDate && t.cardDate !== t.date ? ` · paid ${deDate(t.cardDate)}` : ''}</span></div>
    <strong class="${t.amount < 0 ? '' : 'pos'}">${eur(t.amount)}</strong>
    <label>Line <select data-txline="${h(t.id)}">${t.line ? '' : '<option value="" selected>Choose a line…</option>'}${lineOptions(t.line)}</select></label>
    <label class="check"><input type="checkbox" data-txall="${h(t.id)}"${allDefault ? ' checked' : ''}> Apply to every booking from ${h(t.vendor)}</label>
    <details><summary>Booking text</summary><p>${h(t.text)}</p></details></li>`).join('')}</ul>`;
}

// ---------------- review ----------------
function reviewView() {
  const r = state.agg.review;
  if (!r.length) return `<section class="empty small"><h1>Nothing to review</h1><p>Every booking matched a rule or one of your earlier answers.</p></section>`;
  const byV = {};
  for (const t of r) (byV[t.vkey] ||= []).push(t);
  return `<section class="pad"><h1 class="h1">Unknown vendors</h1><p class="fine">Pick a line once; the app applies it to this vendor from now on.</p></section>
  ${Object.values(byV).map((ts) => `<section class="card">${txList(ts.slice(0, 1), true)}${ts.length > 1 ? `<p class="fine">${ts.length} bookings from this vendor: ${ts.map((t) => eur(t.amount)).join(', ')}</p>` : ''}</section>`).join('')}`;
}

// ---------------- data ----------------
function dataView() {
  const rec = reconcile(state.tx, pdfStatements());
  const cps = state.statements.filter((s) => s.kind === 'checkpoint');
  const anchor = rec[0];
  const cpRows = cps.map((c) => {
    if (!anchor) return `<tr><td>${deDate(c.date)} (CSV)</td><td colspan="3">Add a PDF statement to check this balance.</td></tr>`;
    const computed = Math.round((anchor.open + state.tx.filter((t) => t.date >= anchor.from && t.date <= c.date).reduce((a, t) => a + t.amount, 0)) * 100) / 100;
    const ok = Math.abs(computed - c.close) < 0.005;
    return `<tr><td>CSV ${deDate(c.date)}</td><td>${nf.format(computed)}</td><td>${nf.format(c.close)}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? 'Ties' : nf.format(computed - c.close)}</td></tr>`;
  }).join('');
  const d = daysSince(state.lastBackup);
  return `<section class="card">
    <h2>Add statements</h2>
    <p class="fine">PDF Kontoauszug or CSV export. Overlapping files are fine: bookings already stored are skipped.</p>
    <label class="btn primary">Choose files<input type="file" accept=".pdf,.csv,.json,application/pdf,text/csv,application/json" multiple data-act="import" hidden></label>
  </section>
  <section class="card">
    <h2>Your rules</h2>
    ${state.settings.profile ? `<p class="fine">${(state.settings.profile.rules || []).length} rules and ${(state.settings.profile.lines || []).length} line names loaded, plus ${Object.keys(state.settings.vendorRules).length} vendor answers from Review. They live only on this phone and in your backups.</p>`
      : '<p class="fine">No rules file loaded. Generic rules are in use; names, customer numbers and local shops come from your own rules file.</p>'}
    <div class="row"><label class="btn${state.settings.profile ? '' : ' primary'}">Load rules file<input type="file" accept=".json,application/json" data-act="import" hidden></label>${state.settings.profile ? '<button class="btn" data-act="exportrules">Export rules</button>' : ''}</div>
  </section>
  <section class="card">
    <h2>Backup</h2>
    <p class="fine">${d === null ? 'No backup yet.' : `Last backup: ${d === 0 ? 'today' : `${d} day${d > 1 ? 's' : ''} ago`}.`} Safari can clear this app's storage, so keep a copy in Files or iCloud Drive.</p>
    <div class="row"><button class="btn primary" data-act="backup">Export backup</button><label class="btn">Restore backup<input type="file" accept=".json,application/json" data-act="import" hidden></label></div>
  </section>
  <section class="card">
    <h2>Excel workbook</h2>
    <p class="fine">Fixed, Variable Expenses, One-Time, Income &amp; Transfers, plus Reconciliation and all transactions.</p>
    <button class="btn primary" data-act="excel">Export Excel</button>
  </section>
  <section class="card">
    <h2>Reconciliation</h2>
    ${rec.length ? `<ul class="recon-list">${rec.map((s) => { const ok = Math.abs(s.diff) < 0.005 && s.chainOk; return `<li class="${ok ? 'ok' : 'bad'}"><div><b>${deDate(s.from)} – ${deDate(s.to)}</b><span>${ok ? 'Ties' : Math.abs(s.diff) >= 0.005 ? `Off by ${eur(s.diff)}` : `Gap: opening ≠ ${deDate(s.gapFrom)} closing`}</span></div><p>${nf.format(s.open)} − ${nf.format(-s.debits)} + ${nf.format(s.credits)} = <b>${nf.format(s.computed)}</b> · bank: ${nf.format(s.close)}</p></li>`; }).join('')}</ul>` : '<p class="fine">Import a PDF statement to see the balance check.</p>'}
    ${cpRows ? `<table class="grid recon"><thead><tr><th>Balance</th><th>Computed</th><th>Bank</th><th>Check</th></tr></thead><tbody>${cpRows}</tbody></table>` : ''}
  </section>
  <section class="card">
    <h2>Trips</h2>
    <p class="fine">Restaurant charges paid between these dates go to their own trip line.</p>
    <ul class="trips">${state.settings.trips.map((t, i) => `<li><span>${h(t.name)}</span><span>${deDate(t.from)} – ${deDate(t.to)}</span><button class="link" data-deltrip="${i}">Remove</button></li>`).join('')}</ul>
    <form class="tripform" data-act="addtrip"><input name="name" placeholder="Trip name" required><input name="from" type="date" required><input name="to" type="date" required><button class="btn">Add trip</button></form>
  </section>
  <section class="card">
    <h2>Tracking starts</h2>
    <form class="row" data-act="start"><input type="month" name="start" value="${state.settings.startMonth || ''}"><button class="btn">Save</button></form>
  </section>
  <section class="card danger">
    <h2>Erase data on this phone</h2>
    <p class="fine">Removes all bookings, statements and your answers. Export a backup first.</p>
    <button class="btn warn" data-act="wipe">Erase everything</button>
  </section>
  <p class="fine pad">${state.tx.length} bookings stored · runs offline · nothing leaves this device</p>`;
}

function showImportReport(r) {
  const review = state.agg.review.length;
  sheet(`<h2>${r.errors.length && !r.added ? 'Import failed' : 'Import finished'}</h2>
    <ul class="report">${r.files.map((f) => `<li>${h(f)}</li>`).join('')}${r.errors.map((e) => `<li class="bad">${h(e)}</li>`).join('')}</ul>
    <p>${r.added} new booking${r.added === 1 ? '' : 's'} added${r.dup ? `, ${r.dup} duplicate${r.dup === 1 ? '' : 's'} skipped` : ''}.${review ? ` ${review} need${review === 1 ? 's' : ''} review.` : ''}</p>
    ${r.added ? '<p class="fine">Save a backup now so these bookings survive if Safari clears its storage.</p><button class="btn primary" data-act="backup">Export backup</button>' : ''}
    ${review ? '<button class="btn" data-act="goreview">Review vendors</button>' : ''}
    <button class="btn" data-act="close">Done</button>`);
}

// ---------------- events ----------------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button, [data-month], [data-section], [data-cell]');
  if (!b) return;
  if (b.dataset.tab) { state.tab = b.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (b.dataset.month) { state.month = b.dataset.month; render(); return; }
  if (b.dataset.section) { state.section = b.dataset.section; render(); return; }
  if (b.dataset.cell) {
    const c = state.agg.cell[b.dataset.cell]; const [id, m] = b.dataset.cell.split('|');
    sheet(`<h2>${h(lineLabel(id))}</h2><p class="fine">${monthLabel(m)} · ${c.txs.length} booking${c.txs.length > 1 ? 's' : ''} · ${eur(c.amt)}</p>${txList(c.txs)}<button class="btn" data-act="close">Done</button>`);
    return;
  }
  if (b.dataset.deltrip) { state.settings.trips.splice(+b.dataset.deltrip, 1); await saveSettings(); recompute(); render(); return; }
  const act = b.dataset.act;
  if (act === 'backup') await exportBackup();
  else if (act === 'excel') await exportExcel();
  else if (act === 'exportrules') await exportRules();
  else if (act === 'close') closeSheet();
  else if (act === 'goreview') { closeSheet(); state.tab = 'review'; render(); }
  else if (act === 'wipe') {
    if (!confirm('Erase all bookings, statements and answers on this phone?')) return;
    await clear('tx'); await clear('statements'); await clear('kv');
    state.tx = []; state.statements = []; state.settings = structuredClone(DEFAULT_SETTINGS); state.lastBackup = null; recompute(); render();
  }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.act === 'import' && t.files.length) { await importFiles([...t.files]); t.value = ''; return; }
  if (t.dataset.txline !== undefined) {
    const tx = state.agg.rows.find((r) => r.id === t.dataset.txline); if (!tx || !t.value) return;
    const allBox = document.querySelector(`[data-txall="${CSS.escape(tx.id)}"]`);
    if (allBox && allBox.checked) { state.settings.vendorRules[tx.vkey] = t.value; delete state.settings.txRules[tx.id]; }
    else state.settings.txRules[tx.id] = t.value;
    await saveSettings(); recompute(); render();
    const open = !$('#sheet').hidden;
    if (open) { t.closest('li').classList.add('saved'); }
  }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const fd = new FormData(f);
  if (f.dataset.act === 'addtrip') {
    if (fd.get('to') < fd.get('from')) return alert('The trip ends before it starts.');
    state.settings.trips.push({ name: fd.get('name').trim(), from: fd.get('from'), to: fd.get('to') });
  } else if (f.dataset.act === 'start') state.settings.startMonth = fd.get('start') || null;
  await saveSettings(); recompute(); render();
});
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

// ---------------- boot ----------------
(async () => {
  if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch { /* not granted */ } }
  await load(); render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js');
  window.__app = { state, importFiles, exportExcel, buildWorkbook, reconcile }; // used by automated checks
})();
