/**
 * Two-browser online test through the real UI:
 *   A: main menu → Online → Create room          B: opens the invite link (?room=CODE) → Join → Ready
 *   A: Start race → both drive with key events → screenshots, net stats, motion smoothness.
 * Needs `npm run dev` (client + server).
 *
 *   node tools/online-smoke.mjs [url=http://localhost:5174/turbo-tumble/] [outDir=smoke-out/online] [--lag=150] [--jitter=20] [--bots=0] [--seconds=20]
 *
 * --lag/--jitter apply simulated round-trip latency to browser B (client-side).
 * --drop       B's connection is cut mid-race; it must reconnect and keep racing.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const url = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5174/turbo-tumble/';
const outDir = args.find((a) => !a.startsWith('http') && !a.startsWith('--')) ?? 'smoke-out/online';
const lag = Number(flag('lag', '0'));
const jitter = Number(flag('jitter', '0'));
const bots = Number(flag('bots', '0'));
const seconds = Number(flag('seconds', '20'));
const drop = args.includes('--drop');
fs.mkdirSync(outDir, { recursive: true });
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${m}`);

async function open(label, href) {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--window-size=1280,720', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${label} ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${label} pageerror] ${e.message}`));
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game !== undefined, { timeout: 90000 });
  await sleep(800);
  return { label, browser, page, errors };
}

const clickText = (page, selector, text) =>
  page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(t) && e.offsetParent !== null);
      if (!el) return false;
      el.click();
      return true;
    },
    selector,
    text,
  );

const state = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    const s = g.session;
    const p = s.players[0];
    const k = p?.kart;
    return {
      flow: g.flow,
      mode: s.config.mode,
      phase: s.race.phase,
      time: +s.race.time.toFixed(2),
      racers: s.race.racers.length,
      net: s.netStats && { ...s.netStats, rtt: Math.round(s.netStats.rtt), kibPerSec: +s.netStats.kibPerSec.toFixed(1), correction: +s.netStats.correction.toFixed(3) },
      me: k && { pos: [k.state.position.x, k.state.position.z].map((v) => +v.toFixed(1)), kmh: Math.round(k.state.forwardSpeed * 3.6), pos_in_race: k.racer.progress.position, lap: k.racer.progress.lap },
      status: document.querySelector('.tt-online__status')?.textContent ?? '',
    };
  });

/** Per-frame render positions of own kart + a remote kart for ~2 s; returns jerkiness stats. */
const smoothness = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const g = window.__game;
        const s = g.session;
        const me = s.players[0].racerIndex;
        const other = s.karts.findIndex((k, i) => i !== me && !k.racer.isAI) >= 0 ? s.karts.findIndex((k, i) => i !== me && !k.racer.isAI) : (me + 1) % s.karts.length;
        const track = { me: [], other: [] };
        let last = performance.now();
        const frame = () => {
          const now = performance.now();
          const dt = (now - last) / 1000;
          last = now;
          for (const [key, idx] of [['me', me], ['other', other]]) {
            const p = s.karts[idx].render.position;
            track[key].push({ x: p.x, z: p.z, dt });
          }
          if (track.me.length < 120) requestAnimationFrame(frame);
          else {
            const stats = (arr) => {
              const v = [];
              for (let i = 1; i < arr.length; i++) v.push(Math.hypot(arr[i].x - arr[i - 1].x, arr[i].z - arr[i - 1].z) / Math.max(1e-3, arr[i].dt));
              const mean = v.reduce((a, b) => a + b, 0) / v.length;
              // Jerk: frame-to-frame speed changes bigger than 25% of mean speed.
              let spikes = 0;
              for (let i = 1; i < v.length; i++) if (Math.abs(v[i] - v[i - 1]) > Math.max(2, mean * 0.25)) spikes++;
              return { meanSpeed: +mean.toFixed(1), spikes };
            };
            resolve({ me: stats(track.me), other: { ...stats(track.other), idx: other, name: s.karts[other].racer.name } });
          }
        };
        requestAnimationFrame(frame);
      }),
  );

const A = await open('A', url);
log('A loaded; choosing Online in the menu');
await clickText(A.page, '.tt-menu__mode', 'Online');
await clickText(A.page, 'button', 'START!');
await sleep(400);
await A.page.evaluate(() => {
  const i = document.querySelector('.tt-online__input');
  i.value = 'Alpha';
  i.dispatchEvent(new Event('change'));
});
await clickText(A.page, 'button', 'Create room');
await A.page.waitForFunction(() => document.querySelector('.tt-online__code')?.textContent?.length === 4, { timeout: 10000 });
const code = await A.page.$eval('.tt-online__code', (e) => e.textContent);
log(`A created room ${code}`);
await A.page.screenshot({ path: `${outDir}/a-lobby-empty.png` });

const q = new URLSearchParams({ room: code });
if (lag) q.set('lag', String(lag));
if (jitter) q.set('jitter', String(jitter));
const B = await open('B', `${url}?${q}`);
log(`B loaded via invite link${lag ? ` (simulated ${lag} ms RTT ± ${jitter})` : ''}`);
await B.page.evaluate(() => {
  const i = document.querySelector('.tt-online__input');
  i.value = 'Bravo';
  i.dispatchEvent(new Event('change'));
});
await clickText(B.page, 'button', 'Join');
await B.page.waitForFunction(() => document.querySelector('.tt-online__code')?.textContent?.length === 4, { timeout: 10000 });
log('B joined');

let botProc = null;
if (bots > 0) {
  botProc = spawn('npx', ['tsx', 'tools/net-bots.ts', String(bots), `--join=${code}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  botProc.stdout.on('data', (d) => process.stdout.write(`   [bots] ${d}`));
  await sleep(2500);
}

await clickText(B.page, 'button', 'READY UP');
await sleep(600);
await A.page.screenshot({ path: `${outDir}/a-lobby.png` });
await B.page.screenshot({ path: `${outDir}/b-lobby.png` });
log(`lobby A: ${JSON.stringify(await A.page.$$eval('.tt-online__member', (els) => els.map((e) => e.textContent)))}`);
await clickText(A.page, 'button', 'START RACE');
await A.page.waitForFunction(() => window.__game.flow === 'online', { timeout: 10000 });
await B.page.waitForFunction(() => window.__game.flow === 'online', { timeout: 10000 });
log(`race started: A ${JSON.stringify(await state(A.page))}`);

// Hold throttle through the countdown on both, steer B a bit.
for (const c of [A, B]) await c.page.keyboard.down('ArrowUp');
await sleep(6500);
await A.page.screenshot({ path: `${outDir}/a-race-start.png` });
await B.page.screenshot({ path: `${outDir}/b-race-start.png` });

const stopAt = Date.now() + seconds * 1000;
let n = 0;
while (Date.now() < stopAt) {
  // Weave a little and use items so the item path and reconciliation get exercised.
  const c = n % 2 ? A : B;
  const key = n % 4 < 2 ? 'ArrowLeft' : 'ArrowRight';
  await c.page.keyboard.down(key);
  await sleep(250);
  await c.page.keyboard.up(key);
  if (n % 6 === 0) {
    await c.page.keyboard.down('ShiftLeft');
    await sleep(60);
    await c.page.keyboard.up('ShiftLeft');
  }
  n++;
  if (n % 16 === 0) log(`A ${JSON.stringify((await state(A.page)).net)}  B ${JSON.stringify((await state(B.page)).net)}`);
}
if (drop) {
  const before = await state(B.page);
  await B.page.evaluate(() => window.__game.online.net.room.connection.transport.ws.close());
  log(`B connection cut (was ${JSON.stringify(before.me)})`);
  await sleep(400);
  log(`B during drop: status ${(await state(B.page)).net?.status}, toast "${await B.page.$eval('.tt-net-toast', (e) => e.textContent)}"`);
  await B.page.screenshot({ path: `${outDir}/b-dropped.png` });
  await B.page.waitForFunction(() => window.__game.session.netStats?.status === 'connected', { timeout: 15000 });
  log('B reconnected');
  await sleep(3000);
  const after = await state(B.page);
  log(`B after reconnect: ${JSON.stringify(after.me)} flow ${after.flow} net ${JSON.stringify(after.net)}`);
}
for (const c of [A, B]) {
  const st = await state(c.page);
  log(`${c.label}: ${JSON.stringify(st.me)} phase ${st.phase} t=${st.time}`);
  log(`${c.label} smoothness: ${JSON.stringify(await smoothness(c.page))}`);
}
await A.page.screenshot({ path: `${outDir}/a-race.png` });
await B.page.screenshot({ path: `${outDir}/b-race.png` });
// Debug overlay (F3) on B for the net line.
await B.page.keyboard.press('F3');
await sleep(300);
await B.page.screenshot({ path: `${outDir}/b-debug.png` });
log(`B debug: ${await B.page.$eval('.tt-debug', (e) => e.textContent.split('\n').slice(0, 6).join(' | ')).catch(() => '-')}`);

// B leaves via the menu (Esc → Leave Room): A should see a host-side notice-free departure, B lands on the connect screen.
await B.page.keyboard.press('Escape');
await sleep(300);
await clickText(B.page, 'button', 'Leave Room');
await sleep(1200);
log(`B after leaving: flow ${(await state(B.page)).flow}, status "${(await state(B.page)).status}"`);
await B.page.screenshot({ path: `${outDir}/b-left.png` });

botProc?.kill();
const errors = [...A.errors, ...B.errors].filter((e) => !e.includes('GPU stall') && !e.includes('ReadPixels'));
console.log(errors.length ? `console errors:\n  ${errors.join('\n  ')}` : 'no console errors');
// Closing can stall on GPU teardown; don't let it hang the run.
await Promise.race([Promise.all([A.browser.close(), B.browser.close()]), sleep(5000)]);
process.exit(errors.length ? 1 : 0);
