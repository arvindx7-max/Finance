import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, webkit } from 'playwright';
import { MONTHS, csv, rulesFile } from './mock.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
export function serve() {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
    }).listen(0, () => res({ s, port: s.address().port }));
  });
}
export const PHONE = { width: 390, height: 844 }, MAC = { width: 1470, height: 956 };
// BROWSER=webkit runs the same checks in Safari's engine (iPhone and Mac use it).
export const BROWSER = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium';
export const launch = () => (BROWSER === 'webkit' ? webkit : chromium).launch();
export const files = (dir) => {
  const out = MONTHS.map((m) => ({ name: `statement_test_${m}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv(m)) }));
  out.push({ name: 'rules_test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rulesFile())) });
  return out;
};
// B58: loading a rules file or a backup asks first; tests answer the question.
export async function confirmDialog(p, accept = true) {
  await p.waitForSelector('#dialog:not([hidden]) [data-dlg=ok]', { timeout: 10000 });
  await p.click(accept ? '#dialog [data-dlg=ok]' : '#dialog [data-dlg=cancel]'); await p.waitForTimeout(200);
}
export async function open(b, port, vp, opts = {}) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: opts.scheme || 'light', acceptDownloads: true });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto(`http://localhost:${port}/index.html`); await p.waitForTimeout(300);
  if (opts.load !== false) { await p.setInputFiles('input[data-act=import]', files()); await confirmDialog(p); await p.waitForSelector('#sheet:not([hidden]) .report', { timeout: 30000 }); await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
  return p;
}
export { reporter } from './report.mjs';
