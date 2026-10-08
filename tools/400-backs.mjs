/**
 * 400 card backs: a fine diamond lattice in the deck colour, white border, "400" and a heart
 * in the middle. Rendered once to WebP (CSS data-URI SVG backgrounds aren't reliable in every browser).
 *   node tools/400-backs.mjs
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const COLORS = ['#a3172b', '#1d4fa0', '#1f6b3a', '#2a2a2e'];
const svg = (col) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="726" viewBox="0 0 250 363"><defs><pattern id="p" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="14" fill="${col}"/><path d="M0 0H14M0 0V14" stroke="#fff" stroke-opacity=".38" stroke-width="2"/><circle cx="7" cy="7" r="2" fill="#fff" fill-opacity=".25"/></pattern></defs><rect width="250" height="363" rx="16" fill="#fff"/><rect x="12" y="12" width="226" height="339" rx="10" fill="url(#p)"/><rect x="12" y="12" width="226" height="339" rx="10" fill="none" stroke="${col}" stroke-width="3"/><ellipse cx="125" cy="181" rx="62" ry="40" fill="#fff"/><ellipse cx="125" cy="181" rx="56" ry="34" fill="${col}"/><text x="125" y="194" font-family="Georgia,Times New Roman,serif" font-size="38" font-weight="700" fill="#fff" text-anchor="middle">400</text><path d="M125 236c-6-5-14-10-14-16a7 7 0 0 1 14-2a7 7 0 0 1 14 2c0 6-8 11-14 16z" fill="#fff"/></svg>`;
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage();
for (const [i, col] of COLORS.entries()) {
  const data = await p.evaluate(async (src) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 250;
    c.height = 363;
    c.getContext('2d').drawImage(img, 0, 0, 250, 363);
    return c.toDataURL('image/webp', 0.9);
  }, svg(col));
  writeFileSync(`client/public/assets/400/backs/back-${i}.webp`, Buffer.from(data.split(',')[1], 'base64'));
}
console.log('wrote', COLORS.length, 'backs');
await b.close();
