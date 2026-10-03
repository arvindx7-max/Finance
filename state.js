// App state: loading, recalculation, changes with undo.
import { aggregate, reconcile, DEFAULT_SETTINGS, emptyProfile, lines, SECTIONS, USER_SECTIONS, lineLabel, lineMeta, monthLabel, deDate, monthOf } from './model.js';
import { toast } from './util.js';
import { all, kvGet, kvSet, lock } from './storage.js';
import { markChanged, stampDiff } from './sync.js';
import { render } from './views.js';
// ---------------- state ----------------
export const fresh = () => structuredClone(DEFAULT_SETTINGS);
export const state = { tx: [], statements: [], settings: fresh(), lastBackup: null, tab: 'overview', period: { mode: 'month', key: null }, section: 'fixed', q: '', agg: null, undo: [] };
export async function load() {
  lock.meta = await kvGet('lockMeta', null); lock.on = !!lock.meta;
  if (lock.on) { recompute(); return; } // data stays sealed until Face ID unlocks it
  state.tx = await all('tx');
  state.statements = await all('statements');
  state.settings = { ...fresh(), ...(await kvGet('settings', {})) };
  state.lastBackup = await kvGet('lastBackup', null);
  state.undo = await kvGet('undo', []);
  recompute();
}
export function recompute() {
  state.agg = aggregate(state.tx, state.settings);
}
export const saveSettings = () => kvSet('settings', state.settings);
export const ensureProfile = () => (state.settings.profile ||= emptyProfile());

// Every change to your answers, lines or trips can be undone (last 15 steps).
export async function change(label, fn) {
  state.undo.push(JSON.stringify(state.settings));
  if (state.undo.length > 15) state.undo.shift();
  const before = JSON.parse(JSON.stringify(state.settings));
  fn(state.settings);
  stampDiff(before, state.settings);
  await saveSettings(); await kvSet('undo', state.undo);
  recompute(); render(); markChanged();
  toast(label, true);
}
export async function undo() {
  const prev = state.undo.pop(); if (!prev) return;
  const before = state.settings; state.settings = JSON.parse(prev); stampDiff(before, state.settings);
  await saveSettings(); await kvSet('undo', state.undo);
  recompute(); render(); markChanged(); toast('Undone');
}

// ---------------- lookups ----------------
export const txById = (id) => state.agg.rows.find((r) => r.id === id) || state.tx.find((r) => r.id === id);
