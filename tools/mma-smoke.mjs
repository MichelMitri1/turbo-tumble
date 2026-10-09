import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://127.0.0.1:5175/cage-kings/';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-gpu', '--use-angle=metal', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`page: ${err.message}`));
page.on('response', (response) => { if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`); });
await page.goto(url, { waitUntil: 'networkidle0' });
await page.waitForSelector('.brand h1');
await page.screenshot({ path: '/tmp/cage-menu.png' });
await page.click('[data-action=fight]');
await page.waitForSelector('.roster');
await page.click('[data-start]');
await new Promise((resolve) => setTimeout(resolve, 4300));
await page.keyboard.down('j');
await new Promise((resolve) => setTimeout(resolve, 80));
await page.keyboard.up('j');
await new Promise((resolve) => setTimeout(resolve, 900));
await page.screenshot({ path: '/tmp/cage-fight.png' });
const result = await page.evaluate(() => ({
  title: document.title,
  canvas: !!document.querySelector('canvas'),
  hud: !!document.querySelector('.hud'),
  round: document.querySelector('.clock small')?.textContent,
  clock: document.querySelector('.clock strong')?.textContent,
  healthBars: document.querySelectorAll('.bar.hp span').length,
  menuButtons: document.querySelectorAll('[data-action]').length,
}));
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto(url, { waitUntil: 'networkidle0' });
await page.click('[data-action=fight]');
await page.waitForSelector('.roster');
await page.screenshot({ path: '/tmp/cage-mobile-select.png' });
const mobile = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > innerWidth,
  cards: document.querySelectorAll('.fighter-card').length,
  panelsHidden: [...document.querySelectorAll('.fighter-panel')].every((el) => getComputedStyle(el).display === 'none'),
}));
await page.click('[data-start]');
await new Promise((resolve) => setTimeout(resolve, 3600));
await page.screenshot({ path: '/tmp/cage-mobile-fight.png' });
const touch = await page.evaluate(() => ({
  visible: getComputedStyle(document.querySelector('.touch')).display !== 'none',
  buttons: document.querySelectorAll('.touch-btn').length,
  overflow: document.documentElement.scrollWidth > innerWidth,
}));
console.log(JSON.stringify({ ...result, mobile, touch, errors }, null, 2));
await browser.close();
if (errors.length) process.exitCode = 1;
