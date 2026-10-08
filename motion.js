// v18 motion: how the screen changes when you switch tabs, sections or periods.
// Only transform and opacity are animated (never left/width), so it stays smooth on the phone.
// Settings → Motion: Full or Reduced (cross-fades only). Settings → Animation speed: Quick, Normal, Relaxed.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const MOTIONS = [['full', 'Full'], ['reduced', 'Reduced']];
export const SPEEDS = [['quick', 'Quick'], ['normal', 'Normal'], ['relaxed', 'Relaxed']];
const FACTOR = { quick: 0.7, normal: 1, relaxed: 1.5 };
const read = (k, dflt, ok) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : dflt; } catch { return dflt; } };
export const motion = { mode: read('motion', 'full', ['full', 'reduced']), speed: read('speed', 'normal', ['quick', 'normal', 'relaxed']) };
const rm = () => motion.mode === 'reduced';
const D = (ms) => ms * FACTOR[motion.speed];
export function applyMotion() {
  document.documentElement.dataset.motion = motion.mode;
  document.documentElement.style.setProperty('--spd', FACTOR[motion.speed]);
}
export function setMotion(key, value) {
  motion[key] = value;
  try { localStorage.setItem(key === 'mode' ? 'motion' : 'speed', value); } catch { /* storage blocked */ }
  applyMotion();
}
export const reducedMotion = rm;

// ---------- the tab highlight (pill) ----------
const SEL = '[aria-selected="true"], [aria-pressed="true"]';
const vertical = () => matchMedia('(min-width: 960px)').matches; // the Mac sidebar runs top to bottom
function pillBox(btn) { return { x: btn.offsetLeft + (vertical() ? 0 : 4), y: btn.offsetTop + (vertical() ? 0 : 2), w: btn.offsetWidth - (vertical() ? 0 : 8), h: btn.offsetHeight - (vertical() ? 0 : 4) }; }
const pillTf = (b, s = 1) => `translate3d(${b.x}px,${b.y}px,0) ${vertical() ? `scaleY(${s})` : `scaleX(${s})`}`;
export function placePill() {
  const pill = $('.tabbar .pill'); const cur = $('.tabbar [aria-current="page"]'); if (!pill || !cur) return;
  pill.getAnimations().forEach((a) => a.cancel());
  const b = pillBox(cur); pill.style.width = `${b.w}px`; pill.style.height = `${b.h}px`; pill.style.transform = pillTf(b);
}
function movePill(fromBtn, toBtn) {
  const pill = $('.tabbar .pill'); if (!pill) return;
  const a = pillBox(fromBtn), b = pillBox(toBtn);
  pill.getAnimations().forEach((x) => x.cancel());
  pill.style.width = `${b.w}px`; pill.style.height = `${b.h}px`; pill.style.transform = pillTf(b);
  if (rm()) { pill.animate([{ opacity: 0 }, { opacity: 1 }], { duration: D(200) }); return; }
  const dist = vertical() ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; const stretch = 1 + Math.min(1.1, dist / (vertical() ? 90 : 120));
  pill.animate([{ transform: pillTf(a) }, { transform: pillTf(mid, stretch), offset: 0.45 }, { transform: pillTf(b) }], { duration: D(420), easing: 'cubic-bezier(.3,1.25,.45,1)' });
}

// ---------- sliding thumbs in segmented controls ----------
const thumbOf = (ctl) => { let t = $(':scope > .thumb', ctl); if (!t) { t = document.createElement('span'); t.className = 'thumb'; t.setAttribute('aria-hidden', 'true'); ctl.prepend(t); } return t; };
function placeThumb(ctl, from) {
  const sel = $(SEL, ctl); const t = thumbOf(ctl); if (!sel) { t.style.opacity = 0; return; }
  t.style.opacity = ''; t.style.width = `${sel.offsetWidth}px`; const b = sel.offsetLeft; t.style.transform = `translate3d(${b}px,0,0)`;
  if (!from || from.left === b) return;
  if (rm()) { t.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: D(180) }); return; }
  const a = from.left, mid = (a + b) / 2, s = 1 + Math.min(0.6, Math.abs(b - a) / 260);
  t.animate([{ transform: `translate3d(${a}px,0,0)` }, { transform: `translate3d(${mid}px,0,0) scaleX(${s})`, offset: 0.45 }, { transform: `translate3d(${b}px,0,0)` }], { duration: D(340), easing: 'cubic-bezier(.3,1.2,.45,1)' });
}
const THUMBED = '.modes, .seg';

// ---------- the icon of the tapped tab ----------
function animateIcon(btn, tab) {
  if (rm() || !btn) return; const svg = $('svg', btn); if (!svg || !svg.animate) return;
  const draw = (el, delay) => { if (!el) return; const len = el.getTotalLength(); el.animate([{ strokeDasharray: len, strokeDashoffset: len }, { strokeDasharray: len, strokeDashoffset: 0 }], { duration: D(320), delay: D(delay), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }); };
  const one = (s, frames, o) => { const el = $(s, svg); if (el) el.animate(frames, { duration: D(o.d), easing: o.e || 'ease-out' }); };
  if (tab === 'overview') ['.b1', '.b2', '.b3'].forEach((s, i) => draw($(s, svg), i * 70));
  if (tab === 'months') { draw($('.g1', svg), 0); draw($('.g2', svg), 90); }
  if (tab === 'insights') {
    one('.bulb-glow', [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 0.55, transform: 'scale(1.15)', offset: 0.4 }, { opacity: 0, transform: 'scale(1.3)' }], { d: 620 });
    one('.bulb', [{ stroke: 'currentColor' }, { stroke: 'var(--saffron)', offset: 0.35 }, { stroke: 'currentColor' }], { d: 620 });
  }
  if (tab === 'review') { // the magnifier zooms in
    one('.lens', [{ transform: 'scale(1)' }, { transform: 'scale(1.38)', offset: 0.45 }, { transform: 'scale(.94)', offset: 0.75 }, { transform: 'scale(1)' }], { d: 560, e: 'cubic-bezier(.3,1.1,.5,1)' });
    one('.zoomring', [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 0.9, transform: 'scale(1)', offset: 0.4 }, { opacity: 0, transform: 'scale(1.7)' }], { d: 560 });
  }
  if (tab === 'data') one('.arrow', [{ transform: 'translateY(-6px)', opacity: 0 }, { transform: 'translateY(1.5px)', opacity: 1, offset: 0.6 }, { transform: 'translateY(0)' }], { d: 460, e: 'cubic-bezier(.3,1.2,.5,1)' });
  if (tab === 'settings') one('.cog', [{ transform: 'rotate(0)' }, { transform: 'rotate(75deg)', offset: 0.7 }, { transform: 'rotate(45deg)' }], { d: 560, e: 'cubic-bezier(.3,1.2,.5,1)' });
}

// ---------- page content ----------
function crossFadeTitle(main, oldText) {
  const h1 = $('.topbar h1', main); if (!h1 || !oldText || h1.textContent === oldText) return;
  const old = document.createElement('span'); old.className = 'ttl-old'; old.setAttribute('aria-hidden', 'true'); old.textContent = oldText;
  const nu = document.createElement('span'); nu.textContent = h1.textContent; h1.textContent = ''; h1.append(nu, old);
  old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: D(160), fill: 'forwards' }).onfinish = () => old.remove();
  nu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: D(220), delay: D(60), fill: 'backwards' });
}
const BLOCKS = '.hero, .card, .tablewrap, .modes, .periods, .seg, .empty, .banner, .flag';
function cascade(main) {
  const vh = innerHeight; let i = 0;
  for (const el of $$(BLOCKS, main)) {
    if (el.parentElement.closest(BLOCKS)) continue; // only the outer blocks
    if (el.getBoundingClientRect().top > vh) break; // below the fold: nothing to see
    const delay = D(Math.min(i++, 10) * 35);
    if (rm()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: D(200), fill: 'backwards' });
    else el.animate([{ opacity: 0, transform: 'translate3d(0,12px,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { duration: D(320), delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
  }
}
// Sideways slide, only for sub-navigation (Months sections and periods): what comes after the control.
function slideAfter(main, ctl, dir) {
  if (!ctl) return; let top = ctl; while (top.parentElement && top.parentElement !== main) top = top.parentElement;
  let el = top.nextElementSibling; const vh = innerHeight;
  if (top.classList.contains('modes') && el && el.classList.contains('periods')) el = el.nextElementSibling; // the chips row stays put
  for (; el; el = el.nextElementSibling) {
    if (el.getBoundingClientRect().top > vh) break;
    if (rm()) el.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: D(200) });
    else el.animate([{ opacity: 0, transform: `translate3d(${28 * dir}px,0,0)` }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { duration: D(300), easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

// ---------- hooks around render() ----------
let snap = null; let shown = null; // what is on screen now (state changes before render() runs)
const indexIn = (ctl) => (ctl ? $$('button', ctl).findIndex((b) => b.matches(SEL)) : -1);
const keyOf = (ctl) => ctl && [...ctl.classList].filter((c) => c !== 'thumb').join('.') + (ctl.getAttribute('aria-label') || '');
// Before the screen is redrawn: remember where things were.
export function beforeRender(main) {
  const thumbs = {};
  for (const ctl of $$(THUMBED, main)) { const sel = $(SEL, ctl); if (sel) thumbs[keyOf(ctl)] = { left: sel.offsetLeft, width: sel.offsetWidth }; }
  const periods = $('.periods', main);
  if (!shown) return; // nothing drawn yet
  snap = { ...shown, title: $('.topbar h1', main)?.textContent || '', thumbs,
    periodIdx: indexIn(periods), modeIdx: indexIn($('.modes[aria-label="Period type"]', main)), segIdx: indexIn($('.seg', main)) };
}
export function resetMotion() { shown = null; snap = null; }
// After the redraw: play whatever changed. Anything else (an edit, a sync) redraws without motion.
export function afterRender(main, s, { first = false } = {}) {
  const prev = snap; snap = null; shown = { tab: s.tab, section: s.section, mode: s.period.mode, key: s.period.key };
  if (first || !prev) { $$(THUMBED, main).forEach((c) => placeThumb(c)); placePill(); return; }
  const tabChanged = prev.tab !== s.tab;
  if (tabChanged) {
    const from = $(`.tabbar [data-tab="${prev.tab}"]`), to = $(`.tabbar [data-tab="${s.tab}"]`);
    if (from && to) movePill(from, to); else placePill();
    animateIcon(to, s.tab); crossFadeTitle(main, prev.title);
    $$(THUMBED, main).forEach((c) => placeThumb(c)); cascade(main); return;
  }
  placePill();
  for (const c of $$(THUMBED, main)) placeThumb(c, prev.thumbs[keyOf(c)]);
  if (prev.section !== s.section && s.tab === 'months') {
    const seg = $('.seg', main); slideAfter(main, seg, indexIn(seg) >= prev.segIdx ? 1 : -1);
  } else if (prev.mode !== s.period.mode) {
    const m = $('.modes[aria-label="Period type"]', main); slideAfter(main, m, indexIn(m) >= prev.modeIdx ? 1 : -1);
  } else if (prev.key !== s.period.key) {
    const p = $('.periods', main); slideAfter(main, p, indexIn(p) >= prev.periodIdx ? 1 : -1);
  }
}
addEventListener('resize', () => { placePill(); $$(THUMBED, document.getElementById('main') || document).forEach((c) => { const t = $(':scope > .thumb', c); if (t) t.getAnimations().forEach((a) => a.cancel()); placeThumb(c); }); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { placePill(); $$(THUMBED).forEach((c) => placeThumb(c)); });
