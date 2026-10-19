// Importing statements, rules files and backups; exporting backups and Excel.
import { parsePdf, parseCsv } from './parser.js';
import { aggregate, reconcile, DEFAULT_SETTINGS, emptyProfile, lines, SECTIONS, USER_SECTIONS, lineLabel, lineMeta, monthLabel, deDate, monthOf } from './model.js';
import { buildWorkbook } from './xlsx.js';
import { $, eur, hideBusy, sheet, showBusy, toast } from './util.js';
import { clear, kvSet, lock, putMany } from './storage.js';
import { adopt, fresh, pushUndo, recompute, saveSettings, state } from './state.js';
import { live, markChanged, same, stampDiff } from './sync.js';
import { DEVICE, ask } from './security.js';
import { render, showImportReport } from './views.js';
import { askMapping, guessMap, parseWithMap, sniff } from './banks.js';
import { matchWaiting } from './entries.js';
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
export function mergeRows(existing0, incoming) {
  const existing = existing0.filter((t) => t.source !== 'manual'); // entries you typed in are matched separately (entries.js)
  // I83: bookings of different banks are never duplicates of each other, even with the same date and amount.
  const kk = (t) => `${t.bank || ''}|${t.date}|${t.amount}`;
  const byDA = new Map();
  for (const t of existing) { const k = kk(t); (byDA.get(k) || byDA.set(k, []).get(k)).push(t); }
  const groups = new Map();
  for (const t of incoming) { const k = kk(t); (groups.get(k) || groups.set(k, []).get(k)).push(t); }
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
  const used = new Set(existing0.map((t) => t.id));
  for (const t of added) { let n = 0; let id; do { id = `${t.date}|${t.amount}|${t.vkey}|${n++}`; } while (used.has(id)); used.add(id); t.id = id; }
  return { added, dup };
}

export async function importFiles(files) {
  if (lock.demo) { toast('Not available in the demo.'); return; }
  const report = { files: [], added: 0, dup: 0, errors: [] }; const addedAll = [];
  // rules files first, so statements in the same batch are categorised with them
  files = [...files].sort((a, b) => (/\.json$/i.test(b.name) ? 1 : 0) - (/\.json$/i.test(a.name) ? 1 : 0));
  showBusy(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`);
  try {
    for (const f of files) {
      try {
        if (/\.json$/i.test(f.name)) {
          const j = JSON.parse(await f.text());
          // B58: loading a rules file or a backup replaces stored data, so it always asks first (file picker, notice and drop alike).
          const isRules = j.app === 'finance-insights-rules';
          if (!isRules && !(j.app === 'finance-insights' && Array.isArray(j.tx))) throw new Error('not a backup or rules file from this app');
          hideBusy();
          const yes = await ask(isRules
            ? { title: 'Load this rules file?', text: `${f.name} replaces your rules and line names, and your trips and tracking start if the file has them. Your answers from Review and the lines you created are kept. You can undo this right after.`, ok: 'Load rules' }
            : { title: 'Replace all bookings?', text: `${f.name} replaces all ${state.tx.length} bookings and statements on this ${DEVICE} with the ones in the backup. Your answers are merged. This cannot be undone: export a backup first if you are not sure.`, ok: 'Replace', danger: true });
          showBusy(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`);
          if (!yes) { report.files.push(`${f.name}: not loaded (you cancelled)`); continue; }
          if (isRules) { report.files.push(`${f.name}: ${await loadRules(j)}`); report.undoable = true; continue; }
          report.files.push(`${f.name}: ${await restoreBackup(j)}`); continue;
        }
        let rows, statement = null, checkpoint = null, bankName = '';
        if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
          const out = await parsePdf(await getPdfjs(), new Uint8Array(await f.arrayBuffer()));
          if (!out.statement.ties) throw new Error(`totals do not tie to the statement (opening ${eur(out.statement.open)}, closing ${eur(out.statement.close)}). Nothing was imported from this file.`);
          rows = out.rows; statement = out.statement;
        } else {
          const text = await f.text();
          if (/^"?Buchungstag"?;/m.test(text)) {
            const out = parseCsv(text); rows = out.rows;
            if (out.footer && out.footer.balance !== null) checkpoint = { id: `csv_${out.footer.date}`, kind: 'checkpoint', date: out.footer.date, close: out.footer.balance, source: 'csv' };
          } else { // I83: any other bank's CSV: the columns are asked once and remembered
            const table = sniff(text); if (!table) throw new Error('this does not look like a bank CSV (no table with a header row found)');
            let map = state.settings.csvMaps && state.settings.csvMaps[table.fingerprint];
            if (map && [map.dateCol, map.amountCol, map.debitCol, map.creditCol, ...map.desc].some((i) => i >= table.headers.length)) map = null;
            const known = !!map;
            if (!map) { hideBusy(); map = await askMapping(table, guessMap(table)); showBusy(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`); if (!map) throw new Error('not imported (you cancelled the column question)'); }
            rows = parseWithMap(table, map).rows;
            if (!known) { const before = JSON.parse(JSON.stringify(state.settings)); state.settings.csvMaps = { ...state.settings.csvMaps, [table.fingerprint]: map }; stampDiff(before, state.settings); await saveSettings(); }
            bankName = map.bank;
          }
        }
        const { added, dup } = mergeRows(state.tx, rows);
        await putMany('tx', added); state.tx.push(...added);
        for (const s of [statement, checkpoint].filter(Boolean)) { await putMany('statements', [s]); state.statements = state.statements.filter((x) => x.id !== s.id).concat(s); }
        report.added += added.length; report.dup += dup; addedAll.push(...added);
        report.files.push(`${statement ? `Statement ${deDate(statement.from)} – ${deDate(statement.to)}` : f.name}${bankName ? ` (${bankName})` : ''}: ${added.length} new, ${dup} already stored`);
      } catch (e) { report.errors.push(`${f.name}: ${e.message}`); }
    }
  } finally { hideBusy(); }
  recompute(); render();
  if (addedAll.length) { try { const m = await matchWaiting(addedAll); if (m) report.files.push(m); } catch (e) { report.errors.push(`matching your entries: ${e.message}`); } }
  if (report.added || report.files.length) markChanged();
  showImportReport(report);
}

// ---------------- your rules file (kept on this phone, never in the app code) ----------------
export async function loadRules(j) {
  if (!Array.isArray(j.rules) || !Array.isArray(j.lines)) throw new Error('rules file is missing its "rules" or "lines" list');
  for (const r of j.rules) for (const p of [...(r.any || []), ...(r.all || []), ...(r.none || [])]) new RegExp(p, 'i'); // fail early on a bad pattern
  const { vendorAnswers = {}, bookingAnswers = {}, dismissed = {}, ...profile } = j;
  await pushUndo(); // B58: loading a rules file can be undone
  const s = state.settings; const before = JSON.parse(JSON.stringify(s));
  // Keep what was made in the app (keyword rules, own lines) unless the file has the same item.
  const old = s.profile || {};
  const sameRule = (a, b) => a.mine && b.mine && a.label === b.label && (a.sign || '') === (b.sign || '');
  const keepRules = (old.rules || []).filter((r) => r.mine && !profile.rules.some((x) => sameRule(x, r)));
  const keepLines = (old.lines || []).filter((l) => l.id.startsWith('c.') && !profile.lines.some((x) => x.id === l.id));
  s.profile = { ...profile, rules: [...keepRules, ...profile.rules], lines: [...profile.lines, ...keepLines] };
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
    vendorAnswers: Object.fromEntries(live(s.vendorRules)), bookingAnswers: Object.fromEntries(live(s.txRules).filter(([id]) => !(s.manualGone || {})[id])), dismissed: Object.fromEntries(live(s.flagDismissed)) };
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
  const local = state.settings; let inc = { ...fresh(), ...(p.settings || {}) };
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
  inc = await adopt(inc); stampDiff(local, inc); state.settings = inc; await saveSettings();
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

