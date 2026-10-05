/**
 * Online room lifecycle through the real UI (needs `npm run dev`):
 *  1. A hosts a 1-lap room, 3 bots join (tools/net-bots.ts --join --stay)
 *  2. race → bots finish → grace period / A finishes → results with points → back to the lobby
 *  3. while the room is racing, browser B tries the code and must get a clear "race in progress"
 *  4. quick match: B and C both press Quick match and land in the same public room
 *
 *   node tools/online-flow.mjs [url=http://localhost:5174/] [outDir=smoke-out/online-flow]
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5174/';
const outDir = args.find((a) => !a.startsWith('http') && !a.startsWith('--')) ?? 'smoke-out/online-flow';
fs.mkdirSync(outDir, { recursive: true });
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${m}`);
let failures = 0;
const check = (ok, msg) => {
  if (!ok) failures++;
  log(`${ok ? '✓' : '✗'} ${msg}`);
};

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const errors = [];
async function open(label, href = url) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  // (A refused matchmaking request shows up as a failed resource load — expected in step 3.)
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`[${label}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${label} pageerror] ${e.message}`));
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game !== undefined, { timeout: 90000 });
  await sleep(600);
  return page;
}
const clickText = (page, selector, text) =>
  page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(t) && e.offsetParent !== null);
      el?.click();
      return Boolean(el);
    },
    selector,
    text,
  );
const setName = (page, name) =>
  page.evaluate((n) => {
    const i = document.querySelector('.tt-online__input');
    i.value = n;
    i.dispatchEvent(new Event('change'));
  }, name);
const status = (page) => page.$eval('.tt-online__status', (e) => e.textContent);
const openOnline = async (page) => {
  await clickText(page, '.tt-menu__mode', 'Online');
  await clickText(page, 'button', 'START!');
  await sleep(300);
};

// 1. Host a 1-lap room.
const A = await open('A');
await openOnline(A);
await setName(A, 'Alpha');
await clickText(A, 'button', 'Create room');
await A.waitForFunction(() => document.querySelector('.tt-online__code')?.textContent?.length === 4, { timeout: 10000 });
const code = await A.$eval('.tt-online__code', (e) => e.textContent);
// Laps row is the first setting: ◀ twice → 1 lap.
for (let i = 0; i < 2; i++) {
  await A.evaluate(() => document.querySelector('.tt-online__setting .tt-menu__arrow').click());
  await sleep(150);
}
const laps = await A.$eval('.tt-online__setting .tt-menu__value', (e) => e.textContent);
check(laps === '1', `host changed laps to ${laps}`);

const bots = spawn('npx', ['tsx', 'tools/net-bots.ts', '3', `--join=${code}`, '--stay'], { stdio: ['ignore', 'pipe', 'pipe'] });
let botLog = '';
bots.stdout.on('data', (d) => (botLog += d));
await A.waitForFunction(() => document.querySelectorAll('.tt-online__member:not(.is-empty)').length === 4, { timeout: 20000 });
await sleep(800);
check(true, 'three bots joined and readied');
await clickText(A, 'button', 'START RACE');
await A.waitForFunction(() => window.__game.flow === 'online', { timeout: 10000 });
log('race started');
await A.keyboard.down('ArrowUp');

// 3. Race in progress: B can't join.
const B = await open('B', `${url}?room=${code}`);
await setName(B, 'Bravo');
await clickText(B, 'button', 'Join');
await sleep(1500);
const refused = await status(B);
check(/mid-race|in progress/i.test(refused), `late joiner told: "${refused}"`);
await B.screenshot({ path: `${outDir}/b-refused.png` });

// 2. Wait for results (bots finish ~40 s, grace 30 s after the first human finisher).
await A.waitForFunction(() => window.__game.session.sync?.end, { timeout: 120000, polling: 500 });
log('race end received');
await A.keyboard.up('ArrowUp');
await A.waitForFunction(() => document.querySelector('.tt-results')?.offsetParent !== null && document.querySelector('.tt-results')?.textContent.includes('+'), { timeout: 10000 });
const results = await A.$eval('.tt-results', (e) => e.innerText.replace(/\n+/g, ' | '));
check(/\+15/.test(results), `results with points: ${results.slice(0, 160)}…`);
await A.screenshot({ path: `${outDir}/a-results.png` });
await A.waitForFunction(() => document.querySelector('.tt-online')?.classList.contains('is-open') && window.__game.flow === 'menu', { timeout: 30000 });
const lobby = await A.$$eval('.tt-online__member:not(.is-empty)', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
check(lobby.length === 4 && lobby.some((m) => /[1-9]\d* pts/.test(m)), `back in lobby with points: ${lobby.join(' / ')}`);
await A.screenshot({ path: `${outDir}/a-lobby-after.png` });

// 4. Quick match pairs two players.
await clickText(B, 'button', 'Quick match');
await B.waitForFunction(() => document.querySelector('.tt-online__code')?.textContent?.length === 4, { timeout: 10000 });
const qcode = await B.$eval('.tt-online__code', (e) => e.textContent);
const C = await open('C');
await openOnline(C);
await setName(C, 'Charlie');
await clickText(C, 'button', 'Quick match');
await C.waitForFunction(() => document.querySelector('.tt-online__code')?.textContent?.length === 4, { timeout: 10000 });
const ccode = await C.$eval('.tt-online__code', (e) => e.textContent);
check(qcode === ccode && qcode !== code, `quick match: B in ${qcode}, C in ${ccode} (private room ${code} not matched)`);
await C.screenshot({ path: `${outDir}/c-quick.png` });

bots.kill();
console.log(errors.length ? `console errors:\n  ${errors.join('\n  ')}` : 'no console errors');
await Promise.race([browser.close(), sleep(5000)]);
process.exit(failures || errors.length ? 1 : 0);
