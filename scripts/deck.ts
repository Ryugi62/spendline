// M0-17 / AC-32: Project Introduction + Pitch Deck → docs/deck/deck.html + docs/deck.pdf, built from the record's facts.
// Refuses to write the PDF if any slide states a number that is not in the record (same rule as the model's F2 / F3 answers).
// usage: npm run deck   (keyless, offline except the local headless browser)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { deckDocument, deckSlides, slideText } from '../src/adapters/web/deck';
import { strayInCopy } from '../src/application/pitch';
import { recordFacts } from '../src/infrastructure/record-facts';

const facts = recordFacts();
const declared = readFileSync('README.md', 'utf8').match(/\*\*Declared function \(one sentence\):\*\* (.+)/)?.[1];
if (!declared) throw new Error('README has no declared function line');
const slides = deckSlides(facts, declared);
const stray = slides.flatMap((s) => strayInCopy(slideText(s), facts).map((n) => `${s.id}: ${n}`));
if (stray.length) throw new Error(`numbers not in the record: ${stray.join(', ')}`);
mkdirSync('docs/deck', { recursive: true });
writeFileSync('docs/deck/deck.html', deckDocument(slides));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('file://' + resolve('docs/deck/deck.html'));
await page.waitForLoadState('load');
const overflow = await page.evaluate(() => [...document.querySelectorAll('.slide')].filter((s) => s.scrollHeight > s.clientHeight + 1 || s.scrollWidth > s.clientWidth + 1).map((s) => s.id));
await page.pdf({ path: 'docs/deck.pdf', width: '1280px', height: '720px', printBackground: true, preferCSSPageSize: true });
await browser.close();
const pages = (readFileSync('docs/deck.pdf', 'latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log(`docs/deck.pdf: ${pages} pages / ${slides.length} slides · overflowing slides: ${overflow.join(', ') || 'none'} · numbers outside the record: 0`);
if (pages !== slides.length || overflow.length) process.exit(1);
