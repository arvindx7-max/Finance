// Every screen: overview, months, insights, review, data, charts and sheets.
import { aggregate, reconcile, DEFAULT_SETTINGS, emptyProfile, lines, SECTIONS, USER_SECTIONS, lineLabel, lineMeta, monthLabel, deDate, monthOf } from './model.js';
import * as I from './insights.js';
import * as L from './lock.js';
import { $, daysSince, eur, h, n2, refreshSheet, sheet } from './util.js';
import { all, lock } from './storage.js';
import { change, state, txById } from './state.js';
import { cloud, cloudCard, cloudPill, cloudReady, live, same } from './sync.js';
import { DEVICE, lockCard, lockView } from './security.js';
import { pdfStatements } from './io.js';
// ---------------- insights tab ----------------
export const APP_VERSION = 'v16';
export const pct = (x) => `${Math.round(x * 100)}%`;
export function bar(ratio, tone) { const w = Math.min(100, Math.max(0, ratio * 100)); return `<span class="pbar ${tone}"><i style="width:${w.toFixed(1)}%"></i></span>`; }
export function insightsView() {
  ensurePeriod();
  const p = state.period; const ms = monthsIn(p.key, p.mode); const a = state.agg; const s = state.settings;
  const label = h(periodLabel(p.key, p.mode));
  // budgets
  const bs = I.budgets(a, ms, s.budgets);
  const anyBudget = bs.some((b) => b.limit);
  const budgetHtml = `<section class="card"><h2>Budgets <small>${label}</small></h2>
    ${anyBudget ? `<ul class="budgets">${bs.filter((b) => b.limit).map((b) => { const tone = b.ratio > 1 ? 'over' : b.ratio > 0.8 ? 'near' : 'ok'; return `<li><div><span>${h(b.group)}</span><b>${eur(b.spent)} <small>of ${eur(b.limit)}</small></b></div>${bar(b.ratio, tone)}<small class="${tone}">${b.ratio > 1 ? `${eur(b.spent - b.limit)} over` : `${eur(b.limit - b.spent)} left`}</small></li>`; }).join('')}</ul>` : '<p class="fine">Set a monthly budget per category; bars turn amber at 80% and red when you go over.</p>'}
    <button class="btn" data-act="editbudgets">${anyBudget ? 'Edit budgets' : 'Set budgets'}</button></section>`;
  // savings goal
  const g = I.goal(a, s.goal);
  const goalHtml = `<section class="card"><h2>Savings goal${g ? ` <small>${g.year}</small>` : ''}</h2>
    ${g ? `<div class="goal"><b class="num">${eur(g.saved)}</b><span>saved of ${eur(g.target)}</span></div>${bar(g.saved / g.target, g.onTrack ? 'ok' : 'near')}
      <p class="fine">At your average of ${eur(g.avg)} a month you'd reach about <b>${eur(g.projected)}</b> by December${g.onTrack ? ': on track.' : `. To hit the goal you'd need ${eur(g.needPerMonth)} a month for the remaining ${g.remaining} month${g.remaining === 1 ? '' : 's'}.`}</p>
      <button class="link" data-act="editgoal">Change goal</button>`
    : `<p class="fine">Set a target for the year to see your progress and where your current pace lands you in December.</p><button class="btn" data-act="editgoal">Set a goal</button>`}</section>`;
  // recurring
  const r = I.recurring(a);
  const recHtml = `<section class="card wide"><h2>Recurring costs and subscriptions</h2>
    <p class="fine">About <b>${eur(r.yearly)}</b> a year, ${eur(r.yearly / 12)} a month on average.</p>
    <ul class="rec">${r.items.map((i) => `<li><div><b>${h(i.label)}</b><small>${i.multi ? 'several charges a month' : `last ${eur(i.last)} on ${deDate(i.lastDate)}`}</small>${i.change ? `<em class="flag ${i.change.to > i.change.from ? 'up' : 'down'}">Price ${i.change.to > i.change.from ? 'up' : 'down'}: ${eur(i.change.from)} → ${eur(i.change.to)}</em>` : ''}${i.isNew ? '<em class="flag new">New</em>' : ''}</div><span class="num">${eur(i.yearly)}<small>/year</small></span></li>`).join('')}</ul></section>`;
  // upcoming
  const u = I.upcoming(a);
  const upHtml = u.month ? `<section class="card"><h2>Coming up in ${h(monthLabel(u.month))}</h2>
    <p class="fine">Fixed payments expected: <b>${eur(u.total)}</b>. Keep at least this in the account on the 1st.</p>
    <ul class="upc">${u.items.map((i) => `<li><span class="day num">${i.day ? `${i.day}.` : '—'}</span><span>${h(i.label)}${i.every > 1 ? ` <small>every ${i.every} months</small>` : ''}${i.multi ? ' <small>several charges</small>' : ''}</span><b class="num">${eur(i.amount)}</b></li>`).join('')}</ul></section>` : '';
  // fees
  const f = I.fees(a, ms);
  const feeHtml = `<section class="card"><h2>Bank and card fees <small>${label}</small></h2>
    ${f.total ? `<p class="fine"><b>${eur(f.total)}</b> in fees: ${f.atm.n ? `${f.atm.n} ATM withdrawal${f.atm.n > 1 ? 's' : ''} ${eur(f.atm.sum)}` : ''}${f.atm.n && (f.card.n || f.bank.n) ? ', ' : ''}${f.card.n ? `foreign card fees ${eur(f.card.sum)}` : ''}${f.card.n && f.bank.n ? ', ' : ''}${f.bank.n ? `account fees ${eur(f.bank.sum)}` : ''}.</p>
      ${f.atm.n ? '<p class="tip">ATM fees come from withdrawing at other banks\' machines. Cash Group ATMs (Deutsche Bank, Commerzbank, HypoVereinsbank, Postbank) are free for you, and supermarkets can pay out cash at the till.</p>' : ''}
      ${f.card.n ? '<p class="tip">Card fees are charged on payments in other currencies (e.g. US dollars for Claude).</p>' : ''}
      <details><summary>${f.items.length} fee${f.items.length > 1 ? 's' : ''}</summary><ul class="feelist">${f.items.map((x) => `<li><span>${deDate(x.date)} ${h(x.what)}</span><b class="num">${eur(x.v)}</b></li>`).join('')}</ul></details>`
    : '<p class="fine">No fees in this period.</p>'}</section>`;
  // patterns
  const pt = I.patterns(a, ms);
  const maxDay = Math.max(1, ...pt.days.map((d) => d.amount));
  const patHtml = `<section class="card"><h2>Spending patterns <small>${label}</small></h2>
    ${pt.total ? `<div class="shares"><div><b class="num">${pct(pt.grocShare)}</b><span>groceries &amp; bakery<br>${eur(pt.groceries)}</span></div><div><b class="num">${pct(pt.eatShare)}</b><span>eating out<br>${eur(pt.eatingOut)}</span></div><div><b class="num">${eur(pt.avgGroceryBill)}</b><span>average supermarket bill<br>${pt.perMonthGroceryTrips} trips a month</span></div></div>
      <h3>Card spending by weekday</h3><ul class="wd">${pt.days.map((d) => `<li class="${d.day === pt.busiest ? 'top' : ''}"><i style="height:${(d.amount / maxDay * 100).toFixed(0)}%"></i><span>${d.day.slice(0, 2)}</span></li>`).join('')}</ul>
      <p class="fine">Most card spending happens on ${pt.busiest}s.</p>` : '<p class="fine">No variable spending in this period.</p>'}</section>`;
  const sb = I.savingsBalance(a, s.savingsStart);
  let savHtml;
  if (!sb) savHtml = `<section class="card"><h2>Savings balance <small>estimate</small></h2><p class="fine">Enter what was in your savings account at the start of a month. The app then follows every transfer between this account and your savings account to estimate the balance.</p><button class="btn" data-act="editsavbal">Set starting balance</button></section>`;
  else {
    const inP = sb.points.filter((x) => ms.includes(x.month)); const endP = inP.length ? inP[inP.length - 1] : null;
    const chg = inP.reduce((x, y) => x + y.change, 0);
    const max = Math.max(1, ...sb.points.map((x) => Math.abs(x.balance)));
    savHtml = `<section class="card"><h2>Savings balance <small>estimate</small></h2>
      <div class="goal"><b class="num">${eur(endP ? endP.balance : sb.now)}</b><span>${endP ? `end of ${label}` : 'latest estimate'}</span></div>
      ${endP ? `<p class="fine">${chg >= 0 ? 'Up' : 'Down'} ${eur(Math.abs(chg))} in ${label}: moved in ${eur(inP.reduce((x, y) => x + y.toSav, 0))}, taken back ${eur(inP.reduce((x, y) => x + y.fromSav, 0))}${inP.some((y) => y.passThrough) ? `, passed on to India ${eur(inP.reduce((x, y) => x + y.passThrough, 0))}` : ''}.</p>` : ''}
      <ul class="savbars">${sb.points.map((x) => `<li class="${ms.includes(x.month) ? 'on' : ''}"><i style="height:${Math.max(4, Math.abs(x.balance) / max * 100).toFixed(0)}%"></i><span>${h(monthLabel(x.month, true))}</span></li>`).join('')}</ul>
      <p class="fine">Started at ${eur(sb.start.amount)} on 1 ${h(monthLabel(sb.start.month))}. Only transfers this account can see are counted; interest, other deposits or spending from that account are not.</p>
      <button class="link" data-act="editsavbal">Change starting balance</button></section>`;
  }
  return `${topbar('Insights')}${periodPicker()}<div class="data-grid">${savHtml}${budgetHtml}${goalHtml}${recHtml}${upHtml}${feeHtml}${patHtml}</div>`;
}
export function budgetSheet() {
  const groups = [...new Set(state.agg.order.filter((l) => l.sec === 'variable').map((l) => l.group || 'Other'))];
  const b = state.settings.budgets || {};
  const avg = (g) => { const ms = state.agg.months; if (!ms.length) return 0; const f = I.budgets(state.agg, ms, {}).find((x) => x.group === g); return (f ? f.spent : 0) / ms.length; };
  sheet(`<h2>Monthly budgets</h2><p class="fine">Leave a field empty for no budget. Your average so far is shown as a guide.</p>
  <form class="stack" data-act="budgets">${groups.map((g) => `<label>${h(g)} <small>average ${eur(avg(g))}</small><input type="number" inputmode="decimal" min="0" step="10" name="${h(g)}" value="${b[g] || ''}" placeholder="—"></label>`).join('')}
  <button class="btn primary">Save budgets</button><button type="button" class="btn" data-act="close">Cancel</button></form>`);
}
export function savBalSheet() {
  const cur = state.settings.savingsStart || {}; const ms = state.agg.months;
  sheet(`<h2>Savings starting balance</h2><p class="fine">What was in your savings account at the start of the chosen month? Check it once in that account's banking app. This is an estimate tool; it never touches that account.</p>
  <form class="stack" data-act="savbal"><label>Balance at the start of<select name="month">${ms.map((m) => `<option value="${m}"${(cur.month || ms[0]) === m ? ' selected' : ''}>${h(monthLabel(m))}</option>`).join('')}</select></label>
  <label>Balance (€)<input type="number" inputmode="decimal" name="amount" step="0.01" value="${cur.amount ?? ''}" required></label>
  <button class="btn primary">Save</button>${state.settings.savingsStart ? '<button type="button" class="btn warn" data-act="clearsavbal">Remove</button>' : ''}<button type="button" class="btn" data-act="close">Cancel</button></form>`);
}
export function goalSheet() {
  const g = state.settings.goal || {}; const y = g.year || new Date().getFullYear();
  sheet(`<h2>Savings goal</h2><form class="stack" data-act="goal"><label>Year<input type="number" name="year" value="${y}" min="2026" max="2100" required></label>
  <label>Target to save that year (€)<input type="number" inputmode="decimal" name="amount" value="${g.amount || ''}" min="0" step="100" required></label>
  <button class="btn primary">Save goal</button>${state.settings.goal ? '<button type="button" class="btn warn" data-act="cleargoal">Remove goal</button>' : ''}<button type="button" class="btn" data-act="close">Cancel</button></form>`);
}
// Drill-down: bookings behind a chart bar or a vendor
export function drillSheet(title, ids) {
  const html = () => { const txs = ids.map(txById).filter(Boolean); return `<h2>${h(title)}</h2><p class="fine">${txs.length} booking${txs.length === 1 ? '' : 's'} · ${eur(txs.reduce((s, t) => s + t.amount, 0))}</p>${txList(txs)}<button class="btn" data-act="close">Done</button>`; };
  sheet(html(), html);
}

// ---------------- keyword rules (made in the app) ----------------
export const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const userRules = () => ((state.settings.profile || {}).rules || []).filter((r) => r.mine);
export function ruleMatches(kw, sign) {
  const re = new RegExp(escRe(kw), 'i');
  return state.agg.rows.filter((t) => re.test(t.text) && (!sign || (sign === '+' ? t.amount > 0 : t.amount < 0)));
}
export function addUserRule(s, kw, line, sign) {
  s.profile ||= emptyProfile();
  const rule = { line, any: [escRe(kw)], mine: true, label: kw, since: new Date().toISOString().slice(0, 10) };
  if (sign) rule.sign = sign;
  s.profile.rules = [rule, ...(s.profile.rules || []).filter((r) => !(r.mine && r.label === kw))];
}
export function ruleSheetHtml(kw = '', line = '', sign = '') {
  const hits = kw.trim().length >= 2 ? ruleMatches(kw.trim(), sign) : [];
  return `<h2>New keyword rule</h2><p class="fine">Every booking whose text contains these words goes to the chosen line, now and in future imports. Answers you gave for a specific vendor in Review still take priority.</p>
  <form class="stack" data-act="saverule"><label>Booking text contains<input name="kw" value="${h(kw)}" required minlength="2" autocomplete="off" placeholder="e.g. Bakery or Indian Store"></label>
  <label>Money<select name="sign"><option value="">In or out</option><option value="-"${sign === '-' ? ' selected' : ''}>Only money out</option><option value="+"${sign === '+' ? ' selected' : ''}>Only money in</option></select></label>
  <label>Line<select name="line" required><option value=""${line ? '' : ' selected'}>Choose a line…</option>${lineOptions(line).replace('<optgroup label="Something else"><option value="__new">＋ New line…</option></optgroup>', '')}</select></label>
  <p class="fine" id="rule-preview">${kw.trim().length >= 2 ? `Matches ${hits.length} booking${hits.length === 1 ? '' : 's'} so far${hits.length ? `: ${[...new Set(hits.map((t) => t.vendor))].slice(0, 4).map(h).join(', ')}` : ''}.` : 'Type at least 2 characters to see which bookings match.'}</p>
  <button class="btn primary">Save rule</button><button type="button" class="btn" data-act="manage">Back</button></form>`;
}

// ---------------- bulk assign from search ----------------
export function bulkBar(n) {
  if (!state.q.trim() || !n) return '';
  return `<form class="bulk" data-act="bulk"><span>Move all ${n} match${n === 1 ? '' : 'es'} to</span><select name="line" required><option value="">Choose a line…</option>${lineOptions('').replace('<optgroup label="Something else"><option value="__new">＋ New line…</option></optgroup>', '')}</select>
    <label class="check"><input type="checkbox" name="future"> Also for future bookings whose text contains "${h(state.q.trim())}"</label><button class="btn primary">Move</button></form>`;
}
export function searchHits() {
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const all = [...state.agg.rows].sort((x, y) => y.date.localeCompare(x.date));
  return terms.length ? all.filter((t) => { const hay = `${t.vendor} ${t.text} ${n2(Math.abs(t.amount))} ${Math.abs(t.amount)} ${deDate(t.date)} ${lineLabel(t.line)} ${(state.settings.notes || {})[t.id] || ''}`.toLowerCase(); return terms.every((w) => hay.includes(w)); }) : all;
}

// ---------------- render ----------------
export function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false'));
  const n = state.agg.review.length + state.agg.flags.length + state.agg.passFlags.length;
  $('#review-badge').textContent = n; $('#review-badge').hidden = !n;
  const main = $('#main');
  document.body.classList.toggle('locked', lock.on && !lock.key);
  if (lock.on && !lock.key) { main.innerHTML = lockView(); return; }
  const view = `${state.tab}|${state.section}`; const same = view === lastView;
  const SIDEWAYS = ['.periods', '.seg', '.tablewrap'];
  const lefts = same ? Object.fromEntries(SIDEWAYS.map((sel) => [sel, main.querySelector(sel)?.scrollLeft])) : {}; const y = window.scrollY;
  if (!state.tx.length && state.tab !== 'data') { main.innerHTML = emptyView(); lastView = view; return; }
  main.innerHTML = { overview: overviewView, months: monthsView, insights: insightsView, review: reviewView, data: dataView }[state.tab]();
  for (const sel of SIDEWAYS) { const el = main.querySelector(sel); if (el && lefts[sel] != null) el.scrollLeft = lefts[sel]; }
  for (const sel of ['.periods', '.seg']) keepSelectedInView(main.querySelector(sel));
  if (same) window.scrollTo(0, y);
  lastView = view;
  if (state.tab === 'overview') animateCount();
  refreshSheet();
}
export let lastView = null;
// Scroll a sideways row just enough that its selected chip is fully visible (never the page itself).
export function keepSelectedInView(row) {
  if (!row) return; const sel = row.querySelector('[aria-selected="true"]'); if (!sel) return;
  const r = row.getBoundingClientRect(), b = sel.getBoundingClientRect();
  if (b.left < r.left) row.scrollLeft -= r.left - b.left + 12;
  else if (b.right > r.right) row.scrollLeft += b.right - r.right + 12;
}

export function emptyView() {
  return `${topbar('Finances')}<section class="empty">
    <h1>Start with your statements</h1>
    <p>Add your Deutsche Bank Kontoauszug PDFs (or the CSV export). Everything is read and stored on this ${DEVICE} only.</p>
    <label class="btn primary">Add statements<input type="file" accept=".pdf,.csv,.json,application/pdf,text/csv,application/json" multiple data-act="import" hidden></label>
    <p class="fine">Your rules file (my-rules.json) and backups are .json files: choose them here too.</p>
  </section>`;
}
export function backupBanner() {
  const d = daysSince(state.lastBackup);
  if ((d !== null && d < 7) || (cloud.meta && cloud.meta.fileId && cloud.key)) return '';
  return `<button class="banner" data-act="backup">${d === null ? 'No backup yet.' : `Last backup ${d} days ago.`} <u>Export backup</u></button>`;
}

// ---------------- periods: month, quarter, year, total ----------------
export const PMODES = [['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['all', 'Total']];
export function periodKey(m, mode) {
  const [y, mo] = m.split('-').map(Number);
  return mode === 'month' ? m : mode === 'quarter' ? `${y}-Q${Math.ceil(mo / 3)}` : mode === 'year' ? String(y) : 'all';
}
export const periodList = (mode) => [...new Set(state.agg.months.map((m) => periodKey(m, mode)))];
export const monthsIn = (key, mode) => state.agg.months.filter((m) => periodKey(m, mode) === key);
export function periodLabel(key, mode, short = false) {
  if (mode === 'month') return monthLabel(key, short);
  if (mode === 'quarter') { const [y, q] = key.split('-'); return short ? q : `${q} ${y}`; }
  if (mode === 'year') return key;
  const ms = state.agg.months; return ms.length ? `${monthLabel(ms[0], true)} ${ms[0].slice(0, 4)} – ${monthLabel(ms[ms.length - 1], true)} ${ms[ms.length - 1].slice(0, 4)}` : 'All';
}
export const SUM_KEYS = ['earned', 'fixed', 'variable', 'onetime', 'spent', 'indiaGross', 'passThrough', 'india', 'saved', 'toSav', 'fromSav', 'netToSav', 'kept', 'unassigned'];
export function sumMonths(months) {
  const out = Object.fromEntries(SUM_KEYS.map((k) => [k, 0]));
  for (const s of state.agg.summary) if (months.includes(s.month)) for (const k of SUM_KEYS) out[k] = Math.round((out[k] + s[k]) * 100) / 100;
  out.savingsRate = out.earned ? out.saved / out.earned : 0;
  return out;
}
export function ensurePeriod() {
  const p = state.period; const list = periodList(p.mode);
  if (!list.includes(p.key)) p.key = list[list.length - 1] || null;
}
export function periodPicker() {
  const p = state.period;
  return `<div class="modes" role="tablist" aria-label="Period type">${PMODES.map(([k, l]) => `<button role="tab" aria-selected="${p.mode === k}" data-pmode="${k}">${l}</button>`).join('')}</div>
  ${p.mode === 'all' ? '' : `<div class="periods" role="tablist" aria-label="Period">${[...periodList(p.mode)].reverse().map((k) => `<button role="tab" aria-selected="${k === p.key}" data-pkey="${k}">${h(periodLabel(k, p.mode, p.mode === 'month'))}${p.mode === 'month' ? ` ${k.slice(2, 4)}` : ''}</button>`).join('')}</div>`}`;
}

// ---------------- theme ----------------
export const THEMES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
export function currentTheme() { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } }
export function applyTheme(t) {
  try { localStorage.setItem('theme', t); } catch { /* storage blocked */ }
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#0B1222' : '#EEF2F8';
}
export function isDark() { return document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); }
export function topbar(title) {
  const status = cloudPill();
  return `<header class="topbar${status ? ' has-status' : ''}"><h1>${h(title)}</h1><div class="row"><button class="icon-btn" data-act="search" aria-label="Search bookings"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg></button><button class="icon-btn" data-act="theme" aria-label="Switch to ${isDark() ? 'light' : 'dark'} theme">${isDark()
    ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>'}</button></div>${status ? `<div class="tb-status">${status}</div>` : ''}</header>`;
}

// ---------------- overview ----------------
export function overviewView() {
  ensurePeriod();
  const p = state.period; const ms = monthsIn(p.key, p.mode); const s = sumMonths(ms);
  const rec = reconcile(state.tx, pdfStatements()).filter((r) => ms.includes(monthOf(r.to)));
  const tie = rec.length ? rec.every((r) => Math.abs(r.diff) < 0.005 && r.chainOk) : null;
  const pending = state.agg.review.filter((t) => ms.includes(monthOf(t.date))).length;
  // money-flow strip: earned income split into where it went
  const parts = [['fixed', s.fixed], ['variable', s.variable], ['onetime', s.onetime], ['india', Math.max(0, s.india)], ['saved', Math.max(0, s.saved)]];
  const whole = Math.max(s.earned, s.spent + Math.max(0, s.india), 1);
  const over = s.saved < 0 ? -s.saved : 0;
  const river = parts.filter(([, v]) => v > 0).map(([k, v]) => `<i class="c-${k}" style="width:${(v / whole * 100).toFixed(2)}%" title="${k}"></i>`).join('')
    + (over ? `<i class="over" style="width:${Math.min(30, over / whole * 100).toFixed(2)}%" title="spent more than earned"></i>` : '');
  const rate = s.earned ? Math.round(s.saved / s.earned * 100) : 0;
  const missing = I.missingStatements(state.statements, state.settings.startMonth);
  const hl = p.mode === 'month' ? I.highlights(state.agg, p.key) : [];
  const hlHtml = hl.length ? `<section class="card wide highlights"><h2>Highlights</h2><ul>${hl.map((x) => `<li class="${x.tone}">${h(x.text)}</li>`).join('')}</ul></section>` : '';
  return `${topbar('Overview')}${missing.length ? `<button class="banner" data-tab="data">${missing.length === 1 ? `The statement for ${monthLabel(missing[0])} hasn't been imported yet.` : `Statements missing for ${[...missing].reverse().map((m) => monthLabel(m, true) + ' ' + m.slice(0, 4)).join(', ')}.`} <u>Add statements</u></button>` : ''}${backupBanner()}${periodPicker()}
  <div class="overview">
  <section class="hero">
    <div class="hero-head"><p>${h(periodLabel(p.key, p.mode))}</p><span class="badge${s.saved < 0 ? ' neg' : ''}">${s.saved >= 0 ? `${rate}% of earnings saved` : s.spent > s.earned ? 'Spent more than earned' : 'Sent more to India than you saved'}</span></div>
    <div class="saved-fig${s.saved < 0 ? ' neg' : ''}" data-count="${s.saved}">${eur(s.saved)}</div>
    <p class="saved-cap">saved${p.mode === 'all' ? ' in total' : ''}</p>
    <div class="river" role="img" aria-label="How earned income was used">${river}</div>
    <ul class="flow">
      <li class="lead"><i class="dot c-earned"></i><span>Earned income</span><b>${eur(s.earned)}</b></li>
      <li><i class="dot c-fixed"></i><span>Fixed / recurring</span><b>−${eur(s.fixed)}</b></li>
      <li><i class="dot c-variable"></i><span>Variable</span><b>−${eur(s.variable)}</b></li>
      <li><i class="dot c-onetime"></i><span>One-time</span><b>−${eur(s.onetime)}</b></li>
      <li><i class="dot c-india"></i><span>Sent to India</span><b>−${eur(s.indiaGross)}</b></li>
      ${s.passThrough ? `<li class="sub"><i></i><span>${h(lineLabel('pt.in'))}</span><b>+${eur(s.passThrough)}</b></li>` : ''}
      <li class="total"><i class="dot c-saved"></i><span>Saved</span><b>${eur(s.saved)}</b></li>
    </ul>
    <div class="went"><h3>Where the saved money is</h3>
      <div><span>Moved to savings, net</span><b>${eur(s.netToSav)}</b></div>
      <div><span>Kept in this account</span><b>${eur(s.kept)}</b></div>
    </div>
    ${tie === null ? '<p class="seal">No statement for this period yet</p>' : `<p class="seal ${tie ? 'ok' : 'bad'}">${tie ? `Ties to ${rec.length > 1 ? `${rec.length} statements` : 'the statement'}: ${eur(rec[0].open)} → ${eur(rec[rec.length - 1].close)}` : 'A statement in this period does not tie (see Data)'}</p>`}
    ${state.agg.passFlags.some((t) => ms.includes(monthOf(t.date))) ? '<button class="seal bad" data-tab="review">Was money from savings forwarded to India? Answer in Review</button>' : ''}
    ${pending ? `<button class="seal bad" data-tab="review">${pending} booking${pending > 1 ? 's' : ''} (${eur(s.unassigned)}) still need review</button>` : ''}
  </section>
  <div class="chart-grid">
    ${hlHtml}
    <section class="card wide"><h2>Earned, spent and saved</h2>${chartFlows()}</section>
    <section class="card"><h2>Savings rate</h2>${chartRate()}</section>
    <section class="card"><h2>Top variable vendors</h2>${(() => { const top = topVendors(ms, 6); return top.length ? barsH(top) : '<p class="fine">No variable spend in this period.</p>'; })()}</section>
    <section class="card wide"><h2>Variable spend by category</h2>${chartStack()}</section>
  </div>
  </div>`;
}
export function topVendors(months, n) {
  const m = {};
  for (const t of state.agg.rows) if (months.includes(monthOf(t.date)) && t.line && lineMeta(t.line).sec === 'variable') m[t.vendor] = (m[t.vendor] || 0) - t.amount;
  return Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n);
}
// Count the saved figure up from its previous value: the one orchestrated motion.
export let lastSaved = 0;
export function animateCount() {
  const el = document.querySelector('[data-count]'); if (!el) return;
  const to = +el.dataset.count; const from = lastSaved; lastSaved = to;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) return;
  const t0 = performance.now(); const dur = 650;
  const step = (now) => { const k = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - k, 3); el.textContent = eur(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); else el.textContent = eur(to); };
  requestAnimationFrame(step);
}

// ---------------- charts (inline SVG), one bar per period of the chosen type ----------------
export let W = 340; const PAD = 34;
export const WIDE = matchMedia('(min-width: 960px)');
WIDE.addEventListener('change', () => render());
export const wideW = () => (WIDE.matches ? 720 : 340);
export function scale(min, max, hgt, top = 10) { const span = max - min || 1; return (v) => top + (max - v) / span * hgt; }
export function axis(y, min, max, unit = '') {
  const ticks = [min, 0, max].filter((v, i, a) => a.indexOf(v) === i && v >= min && v <= max);
  return ticks.map((v) => `<line x1="${PAD}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'zero' : 'grid'}"/><text x="${PAD - 4}" y="${y(v) + 3}" class="tick" text-anchor="end">${v === 0 ? '0' : (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v))}${v ? unit : ''}</text>`).join('');
}
export const pjumpMode = () => (state.period.mode === 'all' ? 'month' : state.period.mode);
export function series() {
  const mode = state.period.mode === 'all' ? 'month' : state.period.mode;
  return periodList(mode).map((k) => ({ key: k, label: periodLabel(k, mode, true), sel: state.period.mode === 'all' || k === state.period.key, ...sumMonths(monthsIn(k, mode)) }));
}
export function chartFlows() {
  W = wideW(); const S = series(); const H = WIDE.matches ? 200 : 150;
  const out = S.map((s) => s.spent + s.india);
  const max = Math.max(...S.map((s) => s.earned), ...out, 1), min = Math.min(0, ...S.map((s) => s.saved));
  const y = scale(min, max, H); const bw = (W - PAD) / S.length;
  const px = (i) => PAD + i * bw + bw * 0.43;
  const bars = S.map((s, i) => {
    const x = PAD + i * bw; const sel = s.sel ? ' sel' : '';
    return `<rect x="${x + bw * 0.12}" width="${bw * 0.3}" y="${y(s.earned)}" height="${y(0) - y(s.earned)}" rx="3" class="b-in${sel}"/>
      <rect x="${x + bw * 0.44}" width="${bw * 0.3}" y="${y(out[i])}" height="${y(0) - y(out[i])}" rx="3" class="b-out${sel}"/>
      <text x="${px(i)}" y="${H + 26}" class="tick" text-anchor="middle">${h(s.label)}</text>
      <rect class="hit" data-pjump="${pjumpMode()}|${s.key}" x="${x}" y="0" width="${bw}" height="${H + 32}"><title>Show ${h(s.label)}</title></rect>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H + 32}" class="chart" role="img" aria-label="Earned, spent and saved per period">${axis(y, Math.round(min), Math.round(max))}${bars}<polyline points="${S.map((s, i) => `${px(i)},${y(s.saved)}`).join(' ')}" class="l-sav"/>${S.map((s, i) => `<circle cx="${px(i)}" cy="${y(s.saved)}" r="3.5" class="d-sav"/>`).join('')}</svg>
  <p class="legend"><span><i class="k-in"></i>Earned</span><span><i class="k-out"></i>Spent and sent to India</span><span><i class="k-sav"></i>Saved</span></p>`;
}
export function chartRate() {
  W = 340; const S = series(); const H = 110;
  const v = S.map((s) => s.savingsRate * 100);
  const max = Math.max(10, ...v), min = Math.min(0, ...v);
  const y = scale(min, max, H); const bw = (W - PAD) / S.length;
  const px = (i) => PAD + i * bw + bw / 2;
  const area = `${px(0)},${y(0)} ${v.map((r, i) => `${px(i)},${y(r)}`).join(' ')} ${px(v.length - 1)},${y(0)}`;
  return `<svg viewBox="0 0 ${W} ${H + 32}" class="chart" role="img" aria-label="Savings rate per period">${axis(y, Math.round(min), Math.round(max), '%')}<polygon points="${area}" class="a-rate"/><polyline points="${v.map((r, i) => `${px(i)},${y(r)}`).join(' ')}" class="l-rate"/>${v.map((r, i) => `<rect class="hit" data-pjump="${pjumpMode()}|${S[i].key}" x="${PAD + i * bw}" y="0" width="${bw}" height="${H + 32}"><title>Show ${h(S[i].label)}</title></rect><circle cx="${px(i)}" cy="${y(r)}" r="3.5" class="d-rate"/><text x="${px(i)}" y="${y(r) - 8}" class="val" text-anchor="middle">${Math.round(r)}%</text><text x="${px(i)}" y="${H + 26}" class="tick" text-anchor="middle">${h(S[i].label)}</text>`).join('')}</svg>
  <p class="fine">Saved as a share of earned income.</p>`;
}
export const GROUP_COLORS = ['var(--indigo)', 'var(--sky)', 'var(--lagoon)', 'var(--saffron)', 'var(--rose)', '#8E7CF0', '#2BA6B8', 'var(--slate)', '#C77D4A', '#5FB36B'];
export function chartStack() {
  W = wideW(); const S = series(); const H = WIDE.matches ? 200 : 150;
  const used = state.agg.order.filter((l) => l.sec === 'variable');
  const groups = [...new Set(used.map((l) => l.group || 'Other'))];
  const mode = state.period.mode === 'all' ? 'month' : state.period.mode;
  const val = (g, key) => { const ms = monthsIn(key, mode); return -state.agg.rows.filter((t) => t.line && ms.includes(monthOf(t.date)) && lineMeta(t.line).sec === 'variable' && (lineMeta(t.line).group || 'Other') === g).reduce((a, t) => a + t.amount, 0); };
  const max = Math.max(...S.map((s) => s.variable), 1);
  const y = scale(0, max, H); const bw = (W - PAD) / S.length;
  const bars = S.map((s, i) => {
    let acc = 0; const x = PAD + i * bw + bw * 0.18;
    return `<g opacity="${s.sel ? 1 : 0.45}">${groups.map((g, gi) => { const v = Math.max(0, val(g, s.key)); const r = v > 0 ? `<rect class="drill" data-drill="${h(g)}|${s.key}" x="${x}" width="${bw * 0.64}" y="${y(acc + v)}" height="${Math.max(0, y(acc) - y(acc + v) - 1)}" fill="${GROUP_COLORS[gi % GROUP_COLORS.length]}"><title>${h(g)}: ${eur(v)}</title></rect>` : ''; acc += v; return r; }).join('')}</g><text x="${x + bw * 0.32}" y="${H + 26}" class="tick" text-anchor="middle">${h(s.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H + 32}" class="chart" role="img" aria-label="Variable spend by category per period">${axis(y, 0, Math.round(max))}${bars}</svg>
  <p class="legend">${groups.map((g, gi) => `<span><i style="background:${GROUP_COLORS[gi % GROUP_COLORS.length]}"></i>${h(g)}</span>`).join('')}</p><p class="fine">Tap a bar segment to see its bookings.</p>`;
}
export function barsH(items) {
  const max = items[0][1];
  return `<ul class="hbars">${items.map(([k, v]) => `<li><button data-vendor="${h(k)}"><span>${h(k)}</span><b>${eur(v)}</b><i style="width:${(v / max * 100).toFixed(1)}%"></i></button></li>`).join('')}</ul>`;
}

// ---------------- months (workbook-style tables) + search ----------------
export function shortDates(dates) {
  const s = [...dates].sort(); const dm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  return s.length > 2 ? `${s.length}x · ${dm(s[0])}–${dm(s[s.length - 1])}` : s.map(dm).join(', ');
}
export const SEG = [['fixed', 'Fixed'], ['variable', 'Variable'], ['onetime', 'One-time'], ['income', 'Income'], ['search', 'Search']];
export function monthsView() {
  const seg = `<div class="seg" role="tablist">${SEG.map(([k, l]) => `<button role="tab" aria-selected="${state.section === k}" data-section="${k}">${l}</button>`).join('')}</div>`;
  if (state.section === 'search') return topbar('Months') + seg + searchView();
  const a = state.agg; const ms = [...a.months].reverse(); // newest month first
  const secs = state.section === 'income' ? ['income', 'india', 'passthrough', 'tosav', 'fromsav'] : [state.section];
  const ls = a.order.filter((l) => secs.includes(l.sec));
  let group = null;
  const rows = ls.map((l) => {
    const sign = ['income', 'passthrough', 'fromsav'].includes(l.sec) ? 1 : -1;
    const g = state.section === 'variable' ? l.group : state.section === 'income' ? (l.sec === 'income' ? 'Earned income' : SECTIONS[l.sec]) : '';
    let bar = '';
    if (g && g !== group) { group = g; bar = `<tr class="bar"><th colspan="${ms.length + 2}"><span>${h(g)}</span></th></tr>`; }
    let tot = 0;
    const vals = ms.map((m) => sign * (a.cell[`${l.id}|${m}`]?.amt || 0)).filter((v) => v > 0);
    const avgL = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : 0;
    const shade = ['fixed', 'variable'].includes(l.sec) && vals.length >= 3;
    const cells = ms.map((m) => { const c = a.cell[`${l.id}|${m}`]; if (!c) return '<td class="nil">–</td>'; const v = sign * c.amt; tot += v;
      const heat = shade && avgL ? Math.max(0, Math.min(1, (v / avgL - 1.15) / 1.2)) : 0;
      return `<td${heat > 0 ? ` class="hot" style="--heat:${(heat * 30 + 8).toFixed(0)}%" title="${Math.round(v / avgL * 100)}% of usual"` : ''}><button data-cell="${h(l.id)}|${m}">${n2(v)}<small>${h(shortDates(c.dates))}</small></button></td>`; }).join('');
    return `${bar}<tr><th>${h(l.label)}</th><td class="tot">${n2(tot)}</td>${cells}</tr>`;
  }).join('');
  const sumOf = Object.fromEntries(a.summary.map((x) => [x.month, x]));
  const footRow = (label, key) => `<tr class="total"><th>${label}</th><td class="tot">${n2(a.summary.reduce((x, s) => x + s[key], 0))}</td>${ms.map((m) => `<td>${n2(sumOf[m][key])}</td>`).join('')}</tr>`;
  const foot = state.section === 'income'
    ? [['Earned income', 'earned'], ['Total spent', 'spent'], ['Sent to India (own money)', 'india'], ['Saved', 'saved'], ['Moved to savings, net', 'netToSav'], ['Kept in account', 'kept']].map(([l, k]) => footRow(l, k)).join('')
    : footRow('Total', state.section);
  return `${topbar('Months')}${seg}<div class="tablewrap"><table class="grid fixed" style="--cols:${ms.length + 1}"><colgroup><col class="c-line"><col class="c-num">${ms.map(() => '<col class="c-num">').join('')}</colgroup><thead><tr><th>Line</th><th class="tot">Total</th>${ms.map((m) => `<th>${monthLabel(m, true)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${ms.length + 2}" class="fine">Nothing in this section yet.</td></tr>`}</tbody><tfoot>${foot}</tfoot></table></div>
  <p class="fine pad">Tap an amount to see its bookings and move any of them to another line. Tinted amounts are well above that line's usual level.</p>`;
}
export function searchView() {
  return `<div class="pad"><input type="search" id="q" placeholder="Vendor, text, amount or note" value="${h(state.q)}" autocomplete="off"></div><div id="results">${searchResults()}</div>`;
}
export function searchResults() {
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = searchHits();
  const shown = hit.slice(0, 80);
  return `${bulkBar(terms.length ? hit.length : 0)}<p class="fine pad">${terms.length ? `${hit.length} match${hit.length === 1 ? '' : 'es'}` : `All ${hit.length} bookings, newest first`}${hit.length > 80 ? ' · showing 80' : ''}</p>
  <ul class="results">${shown.map((t) => `<li><button data-tx="${h(t.id)}"><span><b>${h(t.vendor)}</b><small>${deDate(t.date)} · ${h(lineLabel(t.line))}${(state.settings.notes || {})[t.id] ? ` · ${h(state.settings.notes[t.id])}` : ''}</small></span><strong class="${t.amount > 0 ? 'pos' : ''}">${eur(t.amount)}</strong></button></li>`).join('')}</ul>`;
}

// ---------------- picking a line ----------------
export function lineOptions(selected) {
  const trips = (state.settings.trips || []).map((t) => ({ id: `trip:${t.name}`, sec: 'variable', label: lineLabel(`trip:${t.name}`) }));
  const L = [...lines(), ...trips];
  const order = ['fixed', 'variable', 'onetime', 'income', 'india', 'passthrough', 'tosav', 'fromsav', 'offset'];
  return order.map((sec) => { const ls = L.filter((l) => l.sec === sec); return ls.length ? `<optgroup label="${h(SECTIONS[sec])}">${ls.map((l) => `<option value="${h(l.id)}"${l.id === selected ? ' selected' : ''}>${h(l.label)}</option>`).join('')}</optgroup>` : ''; }).join('')
    + '<optgroup label="Something else"><option value="__new">＋ New line…</option></optgroup>';
}
export function txList(txs, allDefault = false) {
  return `<ul class="txs">${[...txs].sort((x, y) => y.date.localeCompare(x.date)).map((t) => `<li>
    <div><b>${h(t.vendor)}</b><span>${deDate(t.date)}${t.cardDate && t.cardDate !== t.date ? ` · paid ${deDate(t.cardDate)}` : ''}</span></div>
    <strong class="${t.amount < 0 ? '' : 'pos'}">${eur(t.amount)}</strong>
    <label>Line <select data-txline="${h(t.id)}">${t.line ? '' : '<option value="" selected>Choose a line…</option>'}${lineOptions(t.line)}</select></label>
    <label class="check"><input type="checkbox" data-txall="${h(t.id)}"${allDefault ? ' checked' : ''}> Apply to every booking from ${h(t.vendor)}</label>
    <label class="note">Note <input type="text" data-note="${h(t.id)}" value="${h((state.settings.notes || {})[t.id] || '')}" placeholder="Add a note, e.g. birthday gift" maxlength="200"></label>
    ${t.amount < 0 ? `<button class="link small" data-onetime="${h(t.id)}">Make this a one-time item…</button>` : ''}
    <details><summary>Booking text</summary><p>${h(t.text)}</p></details></li>`).join('')}</ul>`;
}
export async function assign(txId, lineId, allFromVendor) {
  const t = txById(txId); if (!t) return;
  await change(`Moved to ${lineLabel(lineId)}${allFromVendor ? `, for every booking from ${t.vendor}` : ''}`, (s) => {
    if (allFromVendor) { s.vendorRules[t.vkey] = lineId; delete s.txRules[t.id]; } else s.txRules[t.id] = lineId;
  });
}

// New line (any section). ctx = { txId, all } when created while categorising a booking.
export let pendingNew = null;
export function takePendingNew() { const c = pendingNew; pendingNew = null; return c; }
export function newLineSheet(ctx, presetSec = 'variable', presetName = '') {
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
export function oneTimeSheet(txId) {
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
export function createLine(s, { label, sec, group }) {
  const id = `c.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  (s.profile ||= emptyProfile()).lines = [...(s.profile.lines || []), { id, sec, label, group: sec === 'variable' ? group : '' }];
  return id;
}

// ---------------- review ----------------
export function reviewView() {
  const byNewest = (x, y) => y.date.localeCompare(x.date);
  const r = [...state.agg.review].sort(byNewest); const f = [...state.agg.flags].sort(byNewest); const pf = [...state.agg.passFlags].sort(byNewest);
  const passHtml = pf.length ? `<section class="pad"><h1 class="h1">Forwarded to India?</h1><p class="fine">Money came in from your savings account in a month when you also sent money to India. If you passed it on, it is not a top-up and does not reduce your savings.</p></section>
  ${pf.map((t) => `<section class="card flag"><div><b>${h(t.vendor)}</b><span>${deDate(t.date)}, ${eur(t.india)} sent to India that month</span></div><strong class="pos">${eur(t.amount)}</strong>
    <div class="row"><button class="btn primary" data-passyes="${h(t.id)}">Yes, forwarded</button><button class="btn" data-dismiss="${h(t.id)}">No, a top-up</button></div></section>`).join('')}` : '';
  if (!r.length && !f.length && !pf.length) return `${topbar('Review')}<section class="empty small"><h1>Nothing to review</h1><p>Every booking matched a rule or one of your answers, and nothing looks like a one-time spend.</p></section>`;
  const byV = {};
  for (const t of r) (byV[t.vkey] ||= []).push(t);
  return `${topbar('Review')}${passHtml}${r.length ? `<section class="pad"><h1 class="h1">Unknown vendors</h1><p class="fine">Pick a line once; with "Apply to every booking" ticked, the app uses it for this vendor from now on.</p></section>
  ${Object.values(byV).map((ts) => `<section class="card">${txList(ts.slice(0, 1), true)}${ts.length > 1 ? `<p class="fine">${ts.length} bookings from this vendor: ${ts.map((t) => eur(t.amount)).join(', ')}</p>` : ''}</section>`).join('')}` : ''}
  ${f.length ? `<section class="pad"><h1 class="h1">Possible one-time items</h1><p class="fine">These are at least three times the usual amount for their line.</p></section>
  ${f.map((t) => `<section class="card flag"><div><b>${h(t.vendor)}</b><span>${deDate(t.date)} · ${h(lineLabel(t.line))} · usually around ${eur(t.median)}</span></div><strong>${eur(t.amount)}</strong>
    <div class="row"><button class="btn primary" data-onetime="${h(t.id)}">One-time…</button><button class="btn" data-dismiss="${h(t.id)}">Regular spend</button></div></section>`).join('')}` : ''}`;
}

// ---------------- data ----------------
export function dataView() {
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
  const nAns = live(s.vendorRules).length + live(s.txRules).length;
  const own = (s.profile?.lines || []).filter((l) => l.id.startsWith('c.')).length;
  const theme = currentTheme();
  return `${topbar('Data')}<div class="data-grid">${cloudCard()}${cloudReady() && cloud.meta && cloud.meta.fileId ? lockCard() : ''}<section class="card">
    <h2>Add statements</h2>
    <p class="fine">PDF Kontoauszug or CSV export. Overlapping files are fine: bookings already stored are skipped.</p>
    <label class="btn primary">Choose files<input type="file" accept=".pdf,.csv,.json,application/pdf,text/csv,application/json" multiple data-act="import" hidden></label>
  </section>
  <section class="card">
    <h2>Your rules and answers</h2>
    <p class="fine">${s.profile ? `${(s.profile.rules || []).length} rules from your rules file, ` : 'No rules file loaded, '}${nAns} answer${nAns === 1 ? '' : 's'} from Review, ${own} line${own === 1 ? '' : 's'} you created. All of it lives only on your devices, in your encrypted vault, your backups and the exported rules file.</p>
    <div class="row"><button class="btn" data-act="manage">Manage</button><button class="btn" data-act="newline">New line</button><button class="btn" data-act="exportrules">Export rules</button><label class="btn">Load rules file<input type="file" accept=".json,application/json" data-act="import" hidden></label></div>
  </section>
  <section class="card">
    <h2>Backup</h2>
    <p class="fine">${d === null ? 'No backup yet.' : `Last backup: ${d === 0 ? 'today' : `${d} day${d > 1 ? 's' : ''} ago`}.`} With cloud sync on, your encrypted vault is the backup; this file is an extra copy you can keep in Files or iCloud Drive.</p>
    <div class="row"><button class="btn primary" data-act="backup">Export backup</button><label class="btn">Restore backup<input type="file" accept=".json,application/json" data-act="import" hidden></label></div>
  </section>
  <section class="card">
    <h2>Excel workbook</h2>
    <p class="fine">Fixed, Variable Expenses, One-Time, Income &amp; Transfers (with the savings summary), plus Reconciliation and all transactions.</p>
    <button class="btn primary" data-act="excel">Export Excel</button>
  </section>
  <section class="card">
    <h2>Appearance</h2>
    <div class="themes" role="group" aria-label="Theme">${THEMES.map(([k, l]) => `<button data-themeset="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}</div>
    <p class="fine">Auto follows your phone or laptop setting.</p>
  </section>
  <section class="card wide">
    <h2>Reconciliation</h2>
    ${rec.length || cpRows ? `<ul class="recon-list">${[...rec].reverse().map((x) => { const ok = Math.abs(x.diff) < 0.005 && x.chainOk; return `<li class="${ok ? 'ok' : 'bad'}"><div><b>${deDate(x.from)} – ${deDate(x.to)}</b><span>${ok ? 'Ties' : Math.abs(x.diff) >= 0.005 ? `Off by ${eur(x.diff)}` : `Gap: opening ≠ ${deDate(x.gapFrom)} closing`}</span></div><p>${n2(x.open)} − ${n2(-x.debits)} + ${n2(x.credits)} = <b>${n2(x.computed)}</b> · bank: ${n2(x.close)}</p></li>`; }).join('')}${cpRows}</ul>` : '<p class="fine">Import a PDF statement to see the balance check.</p>'}
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
    <h2>Erase data on this ${DEVICE}</h2>
    <p class="fine">Removes all bookings, statements, rules and answers. Export a backup first.</p>
    <button class="btn warn" data-act="wipe">Erase everything</button>
  </section></div>
  <p class="fine pad">Finances ${APP_VERSION}. ${state.tx.length} bookings stored on this device. Works offline; nothing is sent anywhere.</p>`;
}

export function manageSheet() { sheet(manageHtml(), manageHtml); }
export function manageHtml() {
  const s = state.settings;
  const v = live(s.vendorRules);
  const b = live(s.txRules);
  const own = (s.profile?.lines || []).filter((l) => l.id.startsWith('c.'));
  const nDis = live(s.flagDismissed).length;
  const usage = (id) => state.agg.rows.filter((t) => t.line === id).length;
  const ur = userRules();
  return `<h2>Your answers and lines</h2>
  <h3>Keyword rules (${ur.length})</h3>
  ${ur.length ? `<ul class="manage">${ur.map((r) => `<li><span><b>"${h(r.label)}"${r.sign ? ` <small>${r.sign === '+' ? 'money in' : 'money out'}</small>` : ''}</b><small>→ ${h(lineLabel(r.line))} · ${ruleMatches(r.label, r.sign).length} bookings</small></span><button class="link" data-delrule="${h(r.label)}">Remove</button></li>`).join('')}</ul>` : '<p class="fine">None yet. A keyword rule catches every booking whose text contains certain words, even when the shop name varies.</p>'}
  <button class="btn" data-act="newrule">New keyword rule</button>
  <h3>Vendor answers (${v.length})</h3>
  ${v.length ? `<ul class="manage">${v.map(([k, id]) => `<li><span><b>${h(k)}</b><small>→ ${h(lineLabel(id))}</small></span><button class="link" data-delvendor="${h(k)}">Remove</button></li>`).join('')}</ul>` : '<p class="fine">None yet.</p>'}
  <h3>Single-booking answers (${b.length})</h3>
  ${b.length ? `<ul class="manage">${b.map(([id, line]) => { const t = txById(id); return `<li><span><b>${h(t ? t.vendor : id)}</b><small>${t ? `${deDate(t.date)} · ${eur(t.amount)} ` : ''}→ ${h(lineLabel(line))}</small></span><button class="link" data-deltx="${h(id)}">Remove</button></li>`; }).join('')}</ul>` : '<p class="fine">None yet.</p>'}
  <h3>Lines you created (${own.length})</h3>
  ${own.length ? `<ul class="manage">${own.map((l) => `<li><span><b>${h(l.label)}</b><small>${h(SECTIONS[l.sec])}${l.group ? ` · ${h(l.group)}` : ''} · ${usage(l.id)} booking${usage(l.id) === 1 ? '' : 's'}</small></span><span class="row"><button class="link" data-renline="${h(l.id)}">Rename</button><button class="link danger" data-delline="${h(l.id)}">Remove</button></span></li>`).join('')}</ul>` : '<p class="fine">None yet.</p>'}
  ${nDis ? `<h3>Confirmed as regular spend (${nDis})</h3><button class="link" data-act="resetflags">Show these as possible one-time items again</button>` : ''}
  <p class="fine">Removing an answer sends its bookings back to the rules (or to Review if no rule matches). Every change can be undone.</p>
  <button class="btn" data-act="close">Done</button>`;
}

export function showImportReport(r) {
  const review = state.agg.review.length;
  sheet(`<h2>${r.errors.length && !r.added && !r.files.length ? 'Import failed' : 'Import finished'}</h2>
    <ul class="report">${r.files.map((f) => `<li>${h(f)}</li>`).join('')}${r.errors.map((e) => `<li class="bad">${h(e)}</li>`).join('')}</ul>
    ${r.added || r.dup ? `<p>${r.added} new booking${r.added === 1 ? '' : 's'} added${r.dup ? `, ${r.dup} duplicate${r.dup === 1 ? '' : 's'} skipped` : ''}.${review ? ` ${review} need${review === 1 ? 's' : ''} review.` : ''}</p>` : ''}
    ${r.added ? '<p class="fine">Save a backup now so these bookings survive if Safari clears its storage.</p><button class="btn primary" data-act="backup">Export backup</button>' : ''}
    ${review || state.agg.flags.length || state.agg.passFlags.length ? '<button class="btn" data-act="goreview">Open Review</button>' : ''}
    <button class="btn" data-act="close">Done</button>`);
}

