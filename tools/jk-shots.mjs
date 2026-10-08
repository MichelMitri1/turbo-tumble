// Temporary browser check for Jackaroo (deleted when done). node tools/jk-shots.mjs <scenario> [w] [h]
import puppeteer from 'puppeteer-core';
const OUT = '/private/tmp/claude-501/-Users-eliemitri-Desktop-turbo-tumble/5186cc6a-a403-4bad-b466-4910971d4ccb/scratchpad/jackaroo/';
const BASE = 'http://localhost:5199/jackaroo/';
const scenario = process.argv[2] ?? 'menu';
const W = Number(process.argv[3] ?? 1280);
const H = Number(process.argv[4] ?? 720);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => {
  console.log('GLOBAL TIMEOUT');
  process.exit(2);
}, Number(process.env.TIMEOUT ?? 240000));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: W < 500 ? 2 : 1, isMobile: W < 500, hasTouch: W < 500 },
});
const errors = [];
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  if (process.env.LOG) console.log('  [page]', m.text());
});
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log('shot', name);
};
const jk = (fn, ...a) => page.evaluate(fn, ...a);
const waitFor = async (fn, ms = 30000, ...a) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn, ...a)) return true;
    await sleep(100);
  }
  return false;
};
const params = process.env.Q ?? '';
try {
  await page.goto(`${BASE}?server=localhost:2599${params}`, { waitUntil: 'domcontentloaded' });
  await waitFor(() => window.__jk?.loaded, 60000);
  await sleep(800);
  const mod = await import(`./jk-scenarios.mjs?${Date.now()}`);
  await mod[scenario]({ page, shot, jk, waitFor, sleep, W, H, errors, OUT });
} catch (e) {
  errors.push(`script: ${e.stack}`);
}
console.log(errors.length ? `ERRORS (${errors.length}):\n${errors.slice(0, 20).join('\n')}` : 'no page errors');
await browser.close();
process.exit(0);
