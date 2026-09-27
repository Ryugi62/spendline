// Demo video without a human voice (reused & generalized from Ryugi62/justenough, 2026-09-24):
// macOS `say` narration per scene → Playwright records 1280x720 while captions are burned into the page → ffmpeg mux to H.264/AAC mp4 + .srt.
// Usage: FFMPEG=<path> npm run video -- --scenes docs/video/scenes-demo.json --name spendline-demo --check demo [--voice Samantha --rate 175]
// A scene: { "id": "s1", "url": "ui:#/receipt/2" (the web UI, served in-process) | "docs/video/stage.html#x" | "http://…", "en": "narration + caption",
//            "actions": ["click:text=STOP", "scroll:#receipts", "wait:800", "fill:#budget=9.9"] }
// --check demo|pitch runs the AC-31 narration check against the record first and refuses to record on any finding.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { checkScript } from '../src/application/pitch.ts';
import { recordFacts } from '../src/infrastructure/record-facts.ts';

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const NAME = opt('name', 'spendline-demo');
const OUT = opt('out', 'docs/video');
const WORK = join(OUT, `work-${NAME}`);
const VOICE = ['-v', opt('voice', 'Samantha'), '-r', opt('rate', '175')];
const MAX_SECONDS = Number(opt('max', '180'));
mkdirSync(WORK, { recursive: true });
const scenes = JSON.parse(readFileSync(opt('scenes', join(OUT, 'scenes.json')), 'utf8'));
const CHECK = opt('check', '');
if (CHECK) {
  const findings = checkScript(scenes, recordFacts(), CHECK === 'demo' ? { maxSeconds: 180, firstStopBy: 20 } : { maxSeconds: MAX_SECONDS });
  if (findings.length) throw new Error(`narration check (AC-31) failed:\n${findings.join('\n')}`);
}
let server;
let uiBase = '';
if (scenes.some((s) => s.url.startsWith('ui:'))) {
  server = await createServer({ root: 'web', configFile: 'web/vite.config.ts', server: { port: 5198, strictPort: false }, logLevel: 'error' });
  await server.listen();
  uiBase = server.resolvedUrls?.local[0] ?? 'http://localhost:5198/';
}
const abs = (u) => (u.startsWith('ui:') ? uiBase + u.slice(3) : u.startsWith('http') || u.startsWith('file:') ? u : 'file://' + resolve(u));

function durationOf(file) {
  try { execFileSync(FFMPEG, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(e.stderr));
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  throw new Error(`no duration for ${file}`);
}

// 1) narration
for (const s of scenes) {
  const aiff = join(WORK, `${s.id}.aiff`);
  execFileSync('say', [...VOICE, '-o', aiff, s.en]);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '48000', '-ac', '2', join(WORK, `${s.id}.wav`)]);
  s.seconds = durationOf(join(WORK, `${s.id}.wav`));
}
const planned = scenes.reduce((n, s) => n + s.seconds + 0.9, 0);
if (planned > MAX_SECONDS) throw new Error(`narration ${planned.toFixed(1)}s > limit ${MAX_SECONDS}s — cut text before recording`);

// 2) record
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, recordVideo: { dir: WORK, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const CAP = `#sl-cap{position:fixed;left:0;right:0;bottom:0;z-index:99999;background:rgba(10,14,20,.88);color:#fff;padding:12px 48px 14px;
font:600 21px/1.4 -apple-system,'Apple SD Gothic Neo',sans-serif;text-align:center;pointer-events:none} .cta-bar{bottom:92px!important} .sl-click{outline:4px solid #ffb020!important;outline-offset:3px}`;
async function caption(text) {
  await page.evaluate(({ css, text }) => {
    if (!document.getElementById('sl-cap-style')) { const st = document.createElement('style'); st.id = 'sl-cap-style'; st.textContent = css; document.head.appendChild(st); }
    let el = document.getElementById('sl-cap');
    if (!el) { el = document.createElement('div'); el.id = 'sl-cap'; document.body.appendChild(el); }
    el.textContent = text;
  }, { css: CAP, text });
}
const t0 = Date.now();
const starts = [];
let current = '';
for (const s of scenes) {
  const start = (Date.now() - t0) / 1000;
  starts.push(start);
  const url = abs(s.url);
  if (url !== current) {
    const sameDoc = current && url.split('#')[0] === current.split('#')[0];
    if (sameDoc) await page.evaluate((h) => { location.hash = h; }, url.split('#')[1] ?? '');
    else await page.goto(url);
    await page.waitForTimeout(250);
    current = url;
  }
  await caption(s.en);
  for (const a of s.actions ?? []) {
    const [kind, ...rest] = a.split(':');
    const arg = rest.join(':');
    if (kind === 'click') { const l = page.locator(arg).first(); await l.scrollIntoViewIfNeeded(); await l.evaluate((el) => el.classList.add('sl-click')); await page.waitForTimeout(400); await l.click(); }
    else if (kind === 'scroll') await page.locator(arg).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    else if (kind === 'wait') await page.waitForTimeout(Number(arg));
    else if (kind === 'fill') { const [sel, ...v] = arg.split('='); await page.locator(sel).first().fill(v.join('=')); }
    await caption(s.en);
  }
  const elapsed = (Date.now() - t0) / 1000 - start;
  await page.waitForTimeout(Math.max(0, (s.seconds + 0.9 - elapsed) * 1000));
}
const total = (Date.now() - t0) / 1000;
const recorded = await page.video().path();
await ctx.close();
await browser.close();
if (server) await server.close();
renameSync(recorded, join(WORK, 'screen.webm'));

// 3) narration track + 4) mux
const inputs = scenes.flatMap((s) => ['-i', join(WORK, `${s.id}.wav`)]);
const delays = scenes.map((s, i) => `[${i}:a]adelay=${Math.round(starts[i] * 1000)}|${Math.round(starts[i] * 1000)}[a${i}]`).join(';');
const mix = `${delays};${scenes.map((_, i) => `[a${i}]`).join('')}amix=inputs=${scenes.length}:normalize=0,apad,atrim=0:${total.toFixed(2)}[aout]`;
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', mix, '-map', '[aout]', join(WORK, 'narration.wav')]);
const mp4 = join(OUT, `${NAME}.mp4`);
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', join(WORK, 'screen.webm'), '-i', join(WORK, 'narration.wav'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'medium', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', mp4]);
const ts = (x) => { const ms = Math.round(x * 1000); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`; };
writeFileSync(join(OUT, `${NAME}.en.srt`), scenes.map((s, i) => `${i + 1}\n${ts(starts[i])} --> ${ts(starts[i] + s.seconds)}\n${s.en}\n`).join('\n'));
const seconds = durationOf(mp4);
if (seconds > MAX_SECONDS) throw new Error(`video ${seconds}s > ${MAX_SECONDS}s`);
console.log(JSON.stringify({ seconds: Math.round(seconds * 10) / 10, scenes: scenes.length, out: mp4 }));
