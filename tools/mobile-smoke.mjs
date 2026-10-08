import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-gpu', '--use-angle=metal'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const origin = process.argv[2] ?? 'http://localhost:5173';
  await page.goto(origin + '/boostball/');
  await page.waitForSelector('#m-free');
  // Exercise the real input adapters in isolation with browser touch pointers.
  await page.evaluate(async () => {
    const { Input } = await import('/src/rocket/input.ts');
    window.testInput = new Input(document.createElement('div'));
    window.testInput.active = true;
    window.testInput.poll(.016);
    window.testInput.touch.root.style.zIndex = '100';
  });
  const cdp = await page.createCDPSession();
  const points = await page.evaluate(() => {
    const root = window.testInput.touch.root;
    return ['.mobile-stick', '[data-action="jump"]', '[data-action="boost"]'].map((s, id) => {
      const r = root.querySelector(s).getBoundingClientRect();
      return { x: r.x + r.width * (id === 0 ? .8 : .5), y: r.y + r.height / 2, id };
    });
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  const held = await page.evaluate(() => window.testInput.poll(.016).controls);
  assert(held.steer > .5 && held.jump && held.boost && held.throttle === 1, JSON.stringify(held));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [points[1]] });
  const released = await page.evaluate(() => window.testInput.poll(.016).controls);
  assert(!released.jump && released.boost && released.steer > .5, JSON.stringify(released));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const cancelled = await page.evaluate(() => window.testInput.poll(.016).controls);
  assert(!cancelled.jump && !cancelled.boost && cancelled.steer === 0);
  await page.evaluate(() => { window.testInput.touch.root.remove(); });
  await page.reload();
  await page.waitForSelector('#loading.hidden', { timeout: 60000 });
  await page.tap('#m-free');
  await page.waitForSelector('.mobile-controls:not([hidden])', { timeout: 60000 }).catch(async e => {
    await page.screenshot({ path: '/tmp/mobile-failure.png' });
    console.log(errors, await page.evaluate(() => document.body.innerText));
    throw e;
  });
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await page.setViewport({ width, height, isMobile: true, hasTouch: true });
    await page.screenshot({ path: `/tmp/boostball-mobile-${width}.png` });
    assert(await page.evaluate(() => [...document.querySelectorAll('.mobile-controls:not([hidden]) button, .mobile-controls:not([hidden]) .mobile-stick')].every(e => {
      const r = e.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    })));
  }
  await page.tap('.mobile-controls:not([hidden]) [data-action="pause"]');
  await page.waitForSelector('#pause:not(.hidden)');
  await page.goto(origin + '/turbo-tumble/?mode=race&racers=4&intro=0');
  await page.waitForFunction(() => !!window.__game, { timeout: 60000 });
  await page.waitForSelector('.tt-loading', { hidden: true });
  await page.waitForSelector('.mobile-controls:not([hidden])');
  const racePoints = await page.evaluate(() => ['.mobile-stick', '[data-action="drift"]', '[data-action="item"]'].map((s, id) => {
    const r = document.querySelector('.mobile-controls ' + s).getBoundingClientRect();
    return { x: r.x + r.width * (id === 0 ? .8 : .5), y: r.y + r.height / 2, id };
  }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: racePoints });
  const raceInput = await page.evaluate(() => window.__game.input.createSource({ kind: 'any' }).read({}));
  assert(raceInput.steer > .5 && raceInput.drift && raceInput.item && raceInput.throttle === 1, JSON.stringify(raceInput));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await page.setViewport({ width, height, isMobile: true, hasTouch: true });
    await page.screenshot({ path: `/tmp/turbo-mobile-${width}.png` });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.tap('.mobile-controls [data-action="pause"]');
  await page.waitForSelector('.tt-pause.is-open');
  assert.deepEqual(errors, []);
  console.log('PASS: multitouch steering/jump/boost, independent release, cancellation, both orientations and pause in both games. Screenshots: /tmp/*mobile-*.png');
} finally { await browser.close(); }
