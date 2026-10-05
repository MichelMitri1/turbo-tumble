/**
 * Loads every track in Chrome, races on autopilot and screenshots a few moments.
 *   node tools/track-tour.mjs [url=http://localhost:5174/] [outDir=smoke-out/tour] [trackId…]
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5174/';
const outDir = args.find((a) => !a.startsWith('http') && a.includes('/')) ?? 'smoke-out/tour';
const only = args.filter((a) => !a.startsWith('http') && !a.includes('/'));
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game !== undefined, { timeout: 90000 });
const registry = `/@fs${path.resolve('shared/src/tracks/registry.ts')}`;
const ids = only.length ? only : await page.evaluate(async (m) => (await import(m)).TRACKS.map((t) => t.id), registry);
for (const id of ids) {
  const t0 = Date.now();
  await page.goto(`${url}?mode=race&track=${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.race?.phase === 'racing', { timeout: 120000 });
  const load = ((Date.now() - t0) / 1000).toFixed(1);
  await page.evaluate(() => (window.__game.players[0].kart.racer.isAI = true));
  for (const [i, wait] of [[0, 6000], [1, 9000]]) {
    await sleep(wait);
    await page.screenshot({ path: `${outDir}/${id}-${i}.png` });
  }
  const info = await page.evaluate(() => ({ fps: Math.round(1000 / window.__game.loop.frameMs), calls: window.__game.renderer.gl.info.render.calls, tris: Math.round(window.__game.renderer.gl.info.render.triangles / 1000) }));
  console.log(`${id.padEnd(16)} load ${load}s  fps ${info.fps}  calls ${info.calls}  tris ${info.tris}k`);
}
console.log(errors.length ? errors.slice(0, 8) : 'no errors');
await Promise.race([browser.close(), sleep(3000)]);
process.exit(0);
