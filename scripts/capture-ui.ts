// Physical check for R1: serve web/ in-process (no stray server), capture every screen at 390 and 1280 px,
// and fail if any page scrolls sideways. Writes docs/ui/<screen>-<width>.png.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: 'web', configFile: 'web/vite.config.ts', server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
mkdirSync('docs/ui', { recursive: true });
const shots: [string, string, ((p: import('playwright').Page) => Promise<void>)?][] = [
  ['feed', '#/feed'],
  ['receipt-paid', '#/receipt/1'],
  ['receipt-stopped', '#/receipt/2'],
  ['audit', '#/audit'],
  ['audit-questions', '#/audit', async (p) => { await p.locator('.qas').first().evaluate((el) => el.scrollIntoView({ block: 'start' })); }],
  ['grant-1', '#/grant'],
  ['grant-4', '#/grant', async (p) => {
    await p.fill('#budget', '9.9'); await p.fill('#perTxCap', '8'); await p.click('[data-action=next]');
    await p.fill('#merchants', 'THpQu2d3BZk2tJu36iTPbRR9n5kLgXxk56'); await p.click('[data-action=next]');
    await p.fill('#deadline', '2030-09-30T12:00'); await p.click('[data-action=next]');
  }],
  ['grant-error', '#/grant', async (p) => { await p.fill('#budget', '5'); await p.fill('#perTxCap', '6'); await p.click('[data-action=next]'); }],
  ['stop-sheet', '#/feed', async (p) => { await p.click('[data-action=stop]'); }],
];
const report: string[] = [];
let bad = 0;
for (const width of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [name, hash, act] of shots) {
    await page.goto(base + hash);
    if (hash === '#/grant') await page.reload(); // grant steps live in page memory; start each grant shot fresh
    await page.waitForSelector('.cta');
    if (act) await act(page);
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, ctas: document.querySelectorAll('.cta').length, ctaH: (document.querySelector('.cta') as HTMLElement).getBoundingClientRect().height }));
    const ok = m.sw <= m.cw && m.ctas === 1 && m.ctaH >= 52;
    if (!ok) bad++;
    report.push(`${ok ? 'ok ' : 'BAD'} ${name}@${width}: scrollWidth ${m.sw}/${m.cw} · CTAs ${m.ctas} · CTA ${Math.round(m.ctaH)}px`);
    await page.screenshot({ path: `docs/ui/${name}-${width}.png` }); // viewport = what a person sees; the fixed CTA stays at the bottom
  }
  if (errors.length) { bad++; report.push(`page errors @${width}: ${errors.join(' | ')}`); }
  await ctx.close();
}
await browser.close();
await server.close();
console.log(report.join('\n'));
process.exit(bad ? 1 : 0);
