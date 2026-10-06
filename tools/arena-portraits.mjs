/**
 * Bakes every Crownfall card portrait (each card's 3D model on its rarity
 * background) into client/public/assets/arena/portraits/<id>.webp + index.json.
 * Needs the dev server running:  npm run dev:client, then
 *   node tools/arena-portraits.mjs [url=http://localhost:5173/arena-crown/]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const url = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/arena-crown/';
const out = 'client/public/assets/arena/portraits';
mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(url, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__arena, { timeout: 60000 });
const shots = await page.evaluate(() => window.__arena.renderAll());
for (const [id, data] of Object.entries(shots)) writeFileSync(`${out}/${id}.webp`, Buffer.from(data.split(',')[1], 'base64'));
writeFileSync(`${out}/index.json`, JSON.stringify(Object.keys(shots)));
console.log(`${Object.keys(shots).length} portraits → ${out}`);
await browser.close();
