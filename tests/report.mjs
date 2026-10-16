// On GitHub, failures and crashes also show as annotations on the test run.
const out = [];
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { console.log(out.slice(-3).join('\n')); console.log(`::error::${process.env.BROWSER || 'chromium'}: ${String(e && e.message || e).split('\n')[0]}`); process.exit(1); });
export function reporter() {
  let fail = 0;
  const ok = (name, cond, info = '') => { if (!cond) { fail++; if (process.env.GITHUB_ACTIONS) console.log(`::error::${process.env.BROWSER || 'chromium'}: ${name}${info ? ' ' + info : ''}`); } out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && info ? '  ' + info : ''}`); };
  const done = () => { console.log(out.join('\n')); console.log(`\n${out.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
  return { ok, done };
}
