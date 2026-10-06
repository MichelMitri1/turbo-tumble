/**
 * Browser smoke test: loads the game in Chrome, drives with real key events,
 * captures screenshots and prints kart telemetry + any console errors.
 *
 *   node tools/smoke.mjs [url] [outDir] [--script=drive|idle] [--size=1600x900]
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/turbo-tumble/';
const outDir = args.find((a) => !a.startsWith('http') && !a.startsWith('--')) ?? 'smoke-out';
const script = (args.find((a) => a.startsWith('--script=')) ?? '--script=drive').split('=')[1];
const [W, H] = (args.find((a) => a.startsWith('--size=')) ?? '--size=1600x900').split('=')[1].split('x').map(Number);
fs.mkdirSync(outDir, { recursive: true });

const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', `--window-size=${W},${H}`, '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

if (script === 'systems') {
  // Virtual standard-mapping controller (Gamepad API can't be driven headlessly otherwise).
  await page.evaluateOnNewDocument(() => {
    const pad = {
      id: 'Virtual Xbox Controller (STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    window.__pad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  });
}

if (script === 'join') {
  // Two virtual standard controllers.
  await page.evaluateOnNewDocument(() => {
    const mk = (index) => ({
      id: `Virtual Pad ${index + 1} (STANDARD GAMEPAD)`,
      index,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    });
    window.__pads = [mk(0), mk(1)];
    navigator.getGamepads = () => [window.__pads[0], window.__pads[1], null, null];
  });
}

const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game !== undefined, { timeout: 90000 });
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await new Promise((r) => setTimeout(r, 1500));

const telemetry = () =>
  page.evaluate(() => {
    const g = window.__game;
    if (!g.players[0]) return { mode: g.session.config.mode, phase: g.race.phase, fps: +(1000 / g.loop.frameMs).toFixed(0), calls: g.renderer.gl.info.render.calls };
    const s = g.players[0].kart.state;
    const r = g.players[0].kart.racer;
    const info = g.renderer.gl.info.render;
    return {
      pos: [s.position.x, s.position.y, s.position.z].map((v) => +v.toFixed(1)),
      kmh: +(s.forwardSpeed * 3.6).toFixed(0),
      phase: g.race.phase,
      P: r.progress.position,
      lap: r.progress.lap,
      item: r.slot.item ?? (r.slot.roulette > 0 ? 'rolling' : '-'),
      drift: s.drifting ? s.driftStage : '-',
      boost: +s.boostTimer.toFixed(1),
      ents: g.race.items.entities.list.length,
      fps: +(1000 / g.loop.frameMs).toFixed(0),
      calls: info.calls,
    };
  });

const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(name, JSON.stringify(await telemetry()));
};

const hold = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  await new Promise((r) => setTimeout(r, ms));
  for (const k of keys) await page.keyboard.up(k);
};

await shot('00-spawn');
if (script === 'drive' || script === 'drift') {
  // Countdown: press throttle just before GO for a rocket start.
  await page.waitForFunction(() => window.__game.race.countdownRemaining < 0.45, { timeout: 15000 });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.race.phase === 'racing', { timeout: 5000 });
  await shot('00b-go');
  await page.keyboard.up('KeyW');
}
if (script === 'drift') {
  await hold(['KeyW'], 4200);
  await shot('d1-straight');
  // Hop into a drift through turn 1 (a right-hander) and hold it to charge sparks.
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await page.keyboard.down('Space');
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 350));
    await shot(`d2-drift-${i}`);
  }
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyD');
  await new Promise((r) => setTimeout(r, 150));
  await shot('d3-miniturbo');
  await page.keyboard.up('KeyW');
}
if (script === 'race') {
  // Hand the player's kart to the CPU and photograph the race at intervals.
  const secs = Number((args.find((a) => a.startsWith('--secs=')) ?? '--secs=60').split('=')[1]);
  await page.evaluate(() => (window.__game.players[0].kart.racer.isAI = true));
  for (let t = 0; t < secs; t += 5) {
    await new Promise((r) => setTimeout(r, 5000));
    await shot(`race-${String(t + 5).padStart(3, '0')}`);
  }
}
if (script === 'menu') {
  await new Promise((r) => setTimeout(r, 2500));
  await shot('menu-0');
  // One press per frame: repeated keys within a frame count once.
  const tap = async (key) => {
    await page.keyboard.press(key);
    await new Promise((r) => setTimeout(r, 90));
  };
  // Choose Grand Prix (Down from Start passes Controls and wraps to the mode cards), then start.
  await tap('ArrowDown'); // start → controls
  await tap('ArrowDown'); // controls → mode (wraps)
  await tap('ArrowRight'); // race → grandprix
  await tap('ArrowDown'); // players
  await tap('ArrowDown'); // racer
  await tap('ArrowRight'); // next racer
  await new Promise((r) => setTimeout(r, 300));
  await shot('menu-1-gp');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1500));
  await shot('menu-2-started');
  await page.waitForFunction(() => window.__game.race.phase === 'racing', { timeout: 15000 });
  await page.evaluate(() => (window.__game.players[0].kart.racer.isAI = true));
  await new Promise((r) => setTimeout(r, 9000));
  await shot('menu-3-racing');
}
if (script === 'gp') {
  // Full cup with the player on autopilot: results → standings → next race … → podium.
  for (let race = 0; race < 4; race++) {
    await page.waitForFunction(() => window.__game.race.phase === 'racing', { timeout: 30000 });
    await page.evaluate(() => (window.__game.players[0].kart.racer.isAI = true));
    await page.waitForFunction(() => window.__game.players[0].resultsShown, { timeout: 150000, polling: 500 });
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 700));
    await shot(`gp-standings-${race + 1}`);
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 1200));
  }
  await shot('gp-podium');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1500));
  await shot('gp-back-to-menu');
}
if (script === 'tt') {
  // Two Time Trial runs: the first sets a record + ghost, the second races it.
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes('ghost')) localStorage.removeItem(k); });
  for (let run = 0; run < 2; run++) {
    await page.waitForFunction(() => window.__game.race.phase === 'racing', { timeout: 30000 });
    await page.evaluate(() => (window.__game.players[0].kart.racer.isAI = true));
    await new Promise((r) => setTimeout(r, 8000));
    await shot(`tt-run${run + 1}-racing`);
    await page.waitForFunction(() => window.__game.players[0].resultsShown, { timeout: 150000, polling: 500 });
    await shot(`tt-run${run + 1}-results`);
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (script === 'line') {
  await page.waitForFunction(() => window.__game.race.phase === 'racing', { timeout: 30000 });
  await page.evaluate(() => (window.__game.players[0].kart.racer.isAI = true));
  await page.keyboard.press('F5');
  await new Promise((r) => setTimeout(r, 7000));
  await shot('line-overlay');
}
if (script === 'join') {
  const tap = async (pad, button) => {
    await page.evaluate((p, b) => (window.__pads[p].buttons[b] = { pressed: true, touched: true, value: 1 }), pad, button);
    await new Promise((r) => setTimeout(r, 120));
    await page.evaluate((p, b) => (window.__pads[p].buttons[b] = { pressed: false, touched: false, value: 0 }), pad, button);
    await new Promise((r) => setTimeout(r, 120));
  };
  const key = async (k) => {
    await page.keyboard.press(k);
    await new Promise((r) => setTimeout(r, 120));
  };
  await new Promise((r) => setTimeout(r, 1500));
  // Menu: Start → Controls → (wrap) Mode → Players, then Right ×2 = 3 players.
  await key('ArrowDown');
  await key('ArrowDown');
  await key('ArrowDown');
  await key('ArrowRight');
  await key('ArrowRight');
  await shot('join-0-menu');
  await key('Enter');
  await new Promise((r) => setTimeout(r, 400));
  await shot('join-1-empty');
  await tap(0, 0); // P1 joins with controller 1
  await key('Space'); // P2 joins with keyboard (WASD half)
  await tap(1, 0); // P3 joins with controller 2
  await tap(0, 15); // P1 next racer
  await key('KeyS'); // P2 next kart
  await shot('join-2-joined');
  await tap(0, 0);
  await key('Space');
  await tap(1, 0);
  await new Promise((r) => setTimeout(r, 1500));
  await shot('join-3-race');
  await page.waitForFunction(() => window.__game.race.phase === 'racing', { timeout: 15000 });
  await page.evaluate(() => window.__game.players.forEach((p) => (p.kart.racer.isAI = true)));
  await new Promise((r) => setTimeout(r, 9000));
  await shot('join-4-racing');
  console.log('devices', await page.evaluate(() => window.__game.players.map((p) => p.source.describe()).join(' | ')));
}
if (script === 'controls') {
  await new Promise((r) => setTimeout(r, 1500));
  await page.keyboard.press('ArrowDown'); // Start → Controls
  await new Promise((r) => setTimeout(r, 100));
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 300));
  // Rebind "Use Item" (6th row) on the keyboard to E.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('ArrowDown');
    await new Promise((r) => setTimeout(r, 60));
  }
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 200));
  await shot('controls-capturing');
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 200));
  await shot('controls-rebound');
  console.log('item binding now', await page.evaluate(() => JSON.stringify(window.__game.input.bindings('full').item)));
  await page.evaluate(() => window.__game.input.resetAll());
}
if (script === 'perf') {
  await page.waitForFunction(() => window.__game.race.phase === 'racing', { timeout: 30000 });
  await page.evaluate(() => window.__game.players.forEach((p) => (p.kart.racer.isAI = true)));
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    await shot(`perf-${i}`);
  }
}
if (script === 'icons') {
  // Gallery of every HUD icon (rendered from the 3D item models).
  await page.evaluate(() => {
    const icons = window.__game.icons;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99;background:#2a2172;display:grid;grid-template-columns:repeat(7,1fr);gap:8px;padding:16px;font:700 13px Nunito,sans-serif;color:#fff';
    for (const [k, src] of Object.entries(icons)) {
      const cell = document.createElement('div');
      cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;background:rgba(255,255,255,0.08);border-radius:12px;padding:4px';
      cell.innerHTML = `<img src="${src}" style="width:100px;height:100px"><span>${k}</span>`;
      wrap.appendChild(cell);
    }
    document.body.appendChild(wrap);
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: path.join(outDir, 'icons.png') });
}
if (script === 'items') {
  // Give the player (CPU-driven) specific items and photograph them in use.
  const list = (args.find((a) => a.startsWith('--items=')) ?? '--items=seeker,puck3,crownBuster,prism,jetRocket,octo,boomBall,ember,snapper,zap,paint,goo3').split('=')[1].split(',');
  await page.waitForFunction(() => window.__game.race.phase === 'racing', { timeout: 15000 });
  await page.evaluate(() => (window.__game.players[0].kart.racer.isAI = true));
  await new Promise((r) => setTimeout(r, 6000));
  for (const item of list) {
    await page.evaluate((it) => {
      const r = window.__game.players[0].kart.racer;
      const defs = { fizz3: 3, puck3: 3, seeker3: 3, goo3: 3, rang: 3, octo: 8 };
      r.slot.item = it;
      r.slot.uses = defs[it] ?? 1;
      r.slot.roulette = 0;
    }, item);
    await new Promise((r) => setTimeout(r, 120));
    await shot(`item-${item}-a`);
    await new Promise((r) => setTimeout(r, 1300));
    await shot(`item-${item}-b`);
    await new Promise((r) => setTimeout(r, 2200));
  }
}
if (script === 'spectacle') {
  await page.waitForFunction(() => window.__game.race.phase === 'racing', { timeout: 15000 });
  await page.evaluate(() => (window.__game.players[0].kart.racer.isAI = true));
  await new Promise((r) => setTimeout(r, 5000));
  // Snapper Pot mounted on the kart.
  await page.evaluate(() => {
    const r = window.__game.players[0].kart.racer;
    r.slot.item = 'snapper';
    r.slot.timedItem = 'snapper';
    r.slot.timer = 7;
  });
  await new Promise((r) => setTimeout(r, 500));
  await shot('spec-snapper');
  // Crown Buster flying overhead, launched from behind the player.
  await page.evaluate(() => {
    const g = window.__game;
    const me = g.players[0].kart.racer;
    const loc = g.race.track.locate(me.state.position, me.state.trackIndex, 6);
    const ents = g.race.items.entities;
    const pos = me.state.position.clone();
    pos.y += 8;
    const last = g.race.standings()[g.race.racers.length - 1];
    ents.spawn('crown', last.index, pos, pos.clone().set(0, 0, 0), { splineDistance: loc.splineDistance - 25, life: 40 });
  });
  await new Promise((r) => setTimeout(r, 350));
  await shot('spec-crown');
  // Explosion just ahead of the player.
  await page.evaluate(() => {
    const g = window.__game;
    const me = g.players[0].kart.racer;
    const p = me.state.position.clone().addScaledVector(me.state.forward, 14);
    g.race.items.entities.explode(p, 0, 8);
    g.fx.explosion(p, 8); // events emitted between ticks are dropped, so trigger the visual directly
  });
  await new Promise((r) => setTimeout(r, 180));
  await shot('spec-explosion');
}
if (script === 'finish') {
  await page.waitForFunction(() => window.__game.race.phase === 'racing', { timeout: 15000 });
  await page.evaluate(() => (window.__game.players[0].kart.racer.isAI = true));
  await page.waitForFunction(() => window.__game.players[0].resultsShown, { timeout: 120000, polling: 500 });
  await shot('finish-results');
  await new Promise((r) => setTimeout(r, 3000));
  await shot('finish-results-later');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 800));
  await shot('finish-restarted');
}
if (script === 'drive') {
  await hold(['KeyW'], 1200);
  await shot('01-accelerating');
  await hold(['KeyW'], 2500);
  await shot('02-start-straight');
  await hold(['KeyW', 'KeyD'], 1200);
  await shot('03-turning-right');
  await hold(['KeyW'], 1500);
  await shot('04-after-turn');
  await page.keyboard.down('KeyW');
  await page.keyboard.press('Space');
  await new Promise((r) => setTimeout(r, 120));
  await shot('05-hop');
  await page.keyboard.up('KeyW');
  await hold(['KeyW', 'KeyA'], 1800);
  await shot('06-left-into-wall');
  await page.keyboard.press('KeyR');
  await new Promise((r) => setTimeout(r, 300));
  await shot('07-after-reset');
  await page.keyboard.press('F3');
  await hold(['KeyW'], 800);
  await shot('08-debug');
}

if (script === 'tour') {
  const stops = (args.find((a) => a.startsWith('--stops=')) ?? '--stops=0,150,330,420,480,560,640,760,820,900,1000').split('=')[1].split(',').map(Number);
  for (const d of stops) {
    await page.evaluate((dist) => window.__game.debugTeleport(dist), d);
    await hold(['KeyW'], 1400);
    await shot(`tour-${String(d).padStart(4, '0')}`);
  }
}

if (script === 'views') {
  // --views="x,y,z,tx,ty,tz;..." : freeze the sim and frame the scene from fixed cameras.
  const views = (args.find((a) => a.startsWith('--views=')) ?? '--views=').split('=')[1].split(';').filter(Boolean);
  await page.evaluate(() => (window.__game.loop.paused = true));
  for (const [i, v] of views.entries()) {
    const [x, y, z, tx, ty, tz] = v.split(',').map(Number);
    await page.evaluate(
      (c) => {
        const cam = window.__game.players[0].camera.camera;
        cam.position.set(c[0], c[1], c[2]);
        cam.lookAt(c[3], c[4], c[5]);
      },
      [x, y, z, tx, ty, tz],
    );
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(outDir, `view-${i}.png`) });
    console.log(`view-${i}`, v);
  }
}

if (script === 'systems') {
  const setPad = (fn) => page.evaluate(fn);
  const state = () =>
    page.evaluate(() => {
      const g = window.__game;
      const s = g.players[0].kart.state;
      return { kmh: +(s.forwardSpeed * 3.6).toFixed(1), steer: +s.steer.toFixed(2), paused: g.loop.paused, aspect: +g.players[0].camera.camera.aspect.toFixed(3), device: g.players[0].source.describe() };
    });
  // 1) Gamepad: RT analog half-pressed + stick right past the dead zone.
  await setPad(() => {
    window.__pad.buttons[7] = { pressed: true, touched: true, value: 1 };
    window.__pad.axes[0] = 0.6;
  });
  await new Promise((r) => setTimeout(r, 1500));
  console.log('gamepad drive', JSON.stringify(await state()));
  // Dead zone: tiny stick deflection must not steer.
  await setPad(() => (window.__pad.axes[0] = 0.1));
  await new Promise((r) => setTimeout(r, 600));
  console.log('gamepad deadzone', JSON.stringify(await state()));
  await setPad(() => {
    window.__pad.buttons[7] = { pressed: false, touched: false, value: 0 };
    window.__pad.axes[0] = 0;
  });
  // 2) Pause via Start (button 9) edge, then Escape to resume.
  await setPad(() => (window.__pad.buttons[9] = { pressed: true, touched: true, value: 1 }));
  await new Promise((r) => setTimeout(r, 200));
  await setPad(() => (window.__pad.buttons[9] = { pressed: false, touched: false, value: 0 }));
  await shot('sys-paused');
  console.log('after Start', JSON.stringify(await state()));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));
  console.log('after Esc', JSON.stringify(await state()));
  // 3) Resize.
  await page.setViewport({ width: 1100, height: 900 });
  await new Promise((r) => setTimeout(r, 500));
  console.log('after resize 1100x900', JSON.stringify(await state()));
  await shot('sys-resized');
}

console.log(errors.length ? `\nCONSOLE (${errors.length}):\n${[...new Set(errors)].slice(0, 30).join('\n')}` : '\nno console errors');
await browser.close();
