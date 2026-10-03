// Importing statements, rules files and backups; exporting backups and Excel.
import { parsePdf, parseCsv } from './parser.js';
import { aggregate, reconcile, DEFAULT_SETTINGS, emptyProfile, lines, SECTIONS, USER_SECTIONS, lineLabel, lineMeta, monthLabel, deDate, monthOf } from './model.js';
import { buildWorkbook } from './xlsx.js';
import { $, eur, hideBusy, sheet, showBusy } from './util.js';
import { clear, kvSet, putMany } from './storage.js';
import { fresh, recompute, saveSettings, state } from './state.js';
import { live, markChanged, same, stampDiff } from './sync.js';
import { DEVICE } from './security.js';
import { render, showImportReport } from './views.js';
// ---------------- import ----------------
export let pdfjs;
export async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('./pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}
// Dedupe across overlapping uploads: same booking date + amount, matched count-for-count.
// Same source format: the vendor must match too. Different format (PDF vs CSV): date + amount is enough.
export function mergeRows(existing, incoming) {
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

export async function importFiles(files) {
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
export async function loadRules(j) {
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
export function rulesPayload() {
  const s = state.settings;
  return { ...(s.profile || emptyProfile()), trips: s.trips, startMonth: s.startMonth,
    vendorAnswers: Object.fromEntries(live(s.vendorRules)), bookingAnswers: Object.fromEntries(live(s.txRules)), dismissed: Object.fromEntries(live(s.flagDismissed)) };
}
export const exportRules = () => deliver(new Blob([JSON.stringify(rulesPayload(), null, 2)], { type: 'application/json' }), 'my-rules.json');

// ---------------- backup ----------------
export function backupPayload() {
  return { app: 'finance-insights', version: 2, exportedAt: new Date().toISOString(), tx: state.tx, statements: state.statements, settings: state.settings };
}
export async function exportBackup() {
  const name = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const ok = await deliver(new Blob([JSON.stringify(backupPayload())], { type: 'application/json' }), name);
  if (ok) { state.lastBackup = new Date().toISOString(); await kvSet('lastBackup', state.lastBackup); render(); }
}
// Bookings and statements are replaced by the backup. Answers and your own lines are merged,
// so changes made on this phone are not lost (the backup wins where both answered the same booking).
export async function restoreBackup(p) {
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
  return `backup restored (${p.tx.length} bookings)${keptV + keptT ? `; kept ${keptV + keptT} answer${keptV + keptT > 1 ? 's' : ''} made on this ${DEVICE}` : ''}`;
}
// iOS: the share sheet lets the file go to Files / iCloud Drive. Elsewhere: plain download.
export async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
export async function exportExcel() {
  const data = buildWorkbook(state.agg, reconcile(state.tx, pdfStatements()), state.settings);
  const last = state.agg.months[state.agg.months.length - 1] || 'empty';
  await deliver(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Finances_${last}.xlsx`);
}
export const pdfStatements = () => state.statements.filter((s) => s.kind !== 'checkpoint');

