// Small shared helpers: DOM, formatting, busy indicator, toasts, bottom sheets.
// ---------------- helpers ----------------
export const $ = (sel, el = document) => el.querySelector(sel);
export const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const nf = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const eur = (v) => `${v < 0 ? '−' : ''}€${nf.format(Math.abs(v))}`;
export const n2 = (v) => nf.format(v || 0);
export const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);

export function showBusy(msg) { const b = $('#busy'); b.textContent = msg; b.hidden = false; }
export function hideBusy() { $('#busy').hidden = true; }
export let toastTimer;
export function toast(msg, canUndo = false) {
  const t = $('#toast');
  t.innerHTML = `<span>${h(msg)}</span>${canUndo ? '<button data-act="undo">Undo</button>' : ''}`;
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}
export let sheetTimer;
export let sheetRefresh = null;
export let sheetOpener = null;
// refresh = a function returning the sheet's html again, so the sheet updates after a change.
// iOS-style top bar: title in the middle, Done on the right (forms keep their own Save / Cancel buttons).
function chrome(html) {
  const m = html.match(/^\s*<h2>([\s\S]*?)<\/h2>/); if (!m) return html;
  let rest = html.slice(m[0].length).replace(/<button class="btn" data-act="close">Done<\/button>\s*$/, '');
  const form = /<form/.test(rest);
  return `<div class="sheet-bar"><span>${form ? '<button type="button" class="link" data-act="close">Cancel</button>' : ''}</span><b tabindex="-1">${m[1]}</b><span>${form ? '' : '<button type="button" class="link strong" data-act="close">Done</button>'}</span></div>${rest}`;
}
export function sheet(html, refresh = null) {
  html = chrome(html); if (refresh) { const r = refresh; refresh = () => chrome(r()); }
  clearTimeout(sheetTimer);
  const s = $('#sheet'); const body = $('#sheet-body'); const reopen = !s.hidden;
  if (!reopen) sheetOpener = document.activeElement;
  body.innerHTML = html; sheetRefresh = refresh; s.hidden = false;
  requestAnimationFrame(() => { s.classList.add('open'); if (!reopen) { const f = body.querySelector('.sheet-bar b, h2'); if (f) { f.tabIndex = -1; f.focus({ preventScroll: true }); } } });
}
export function closeSheet() {
  const s = $('#sheet'); if (s.hidden) return;
  sheetRefresh = null;
  s.classList.remove('open'); clearTimeout(sheetTimer); sheetTimer = setTimeout(() => { s.hidden = true; }, 220);
  if (sheetOpener && document.contains(sheetOpener)) sheetOpener.focus({ preventScroll: true });
}
export function refreshSheet() {
  const s = $('#sheet'); if (s.hidden || !sheetRefresh) return;
  const body = $('#sheet-body'); const a = document.activeElement;
  if (a && body.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return; // never wipe what you are typing
  const top = body.scrollTop; body.innerHTML = sheetRefresh(); body.scrollTop = top;
}

