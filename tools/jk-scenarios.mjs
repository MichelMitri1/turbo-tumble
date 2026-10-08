// Temporary scenarios for tools/jk-shots.mjs (deleted when done).
export async function menu({ shot, sleep }) {
  await sleep(1500);
  await shot('menu');
}

export async function start({ page, shot, jk, waitFor, sleep }) {
  await page.click('#m-play');
  await waitFor(() => window.__jk.view && window.__jk.queue === 0, 20000);
  await sleep(2500);
  await shot('start');
  await waitFor(() => window.__jk.canAct(), 60000);
  await sleep(500);
  await shot('myturn');
  const info = await jk(() => ({ hand: window.__jk.view.hand, moves: window.__jk.view.hand.map((c) => window.__jk.movesIn(c.id).length) }));
  console.log(JSON.stringify(info));
}

export async function spots({ page, jk, waitFor, sleep }) {
  await page.click('#m-play');
  await waitFor(() => window.__jk.view && window.__jk.queue === 0, 20000);
  await sleep(1500);
  console.log(JSON.stringify(await jk(() => ({ spots: window.__jk.freeSpots().map((r) => [r.x, r.y, r.width, r.height].map(Math.round)), br: (() => { const r = window.__jk.board.boardRect(); return [r.x, r.y, r.width, r.height].map(Math.round); })(), me: document.querySelector('#me').getBoundingClientRect().top, tk: document.querySelector('#ticker').getBoundingClientRect().top }))));
}

export async function bannertest({ page, jk, waitFor, sleep, shot }) {
  await page.click('#m-play');
  await waitFor(() => window.__jk.view && window.__jk.queue === 0, 20000);
  await sleep(1500);
  await jk(() => window.__jk.banner('NO MOVE — BURN A CARD', 'small'));
  await sleep(400);
  console.log(await jk(() => { const w = document.querySelector('.jk-float'); return w ? [w.style.left, w.style.top, w.firstChild.style.fontSize, getComputedStyle(w).transform].join(' ') : 'none'; }));
  await shot('bannertest');
}

export async function turnbanner({ page, jk, waitFor, sleep, shot }) {
  await page.click('#m-play');
  await waitFor(() => document.querySelector('.jk-banner.small'), 60000);
  console.log(await jk(() => { const w = document.querySelector('.jk-banner.small').parentElement; return [w.style.left, w.style.top, w.firstChild.style.fontSize, w.firstChild.textContent, JSON.stringify(window.__jk.freeSpots().map((r) => [r.x, r.y, r.width, r.height].map(Math.round)))].join(' '); }));
  await shot('turnbanner');
}

/** Watch the evLog for an event; returns when one newer than `since` matches. */
async function waitEv(jk, sleep, pred, since, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = await jk((p, s) => window.__jk.evLog.filter((e) => e.t > s).find(new Function('e', `return ${p}`)), pred, since);
    if (hit) return hit;
    await sleep(40);
  }
  return null;
}
const now = (jk) => jk(() => performance.now());

export async function game({ page, shot, jk, waitFor, sleep }) {
  const mode = process.env.MODE ?? 'classic';
  await jk((m) => { window.__jk.settings.mode = m; window.__jk.settings.level = 'hard'; }, mode);
  await jk(() => window.__jk.startLocal());
  await jk(() => { window.__jk.setAuto(true); window.__jk.setSpeed(Number(new URLSearchParams(location.search).get('speed')) || 1.6); });
  await sleep(2500);
  await shot(`${mode}-board-start`);
  const want = { capture: "e.k==='capture'", hop: "e.k==='move' && !e.kills", burn: "e.k==='burn'", safe: "e.k==='safe'", swap: "e.k==='swap'", split: "e.k==='move' && e.split===0" };
  if (mode === 'complex') want.sweep = "e.k==='move' && e.kills>0";
  const got = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 200000 && !(await jk(() => window.__jk.view?.phase === 'over'))) {
    for (const [name, pred] of Object.entries(want)) {
      if (got.has(name)) continue;
      const since = await now(jk);
      const hit = await waitEv(jk, sleep, pred, since - 30, 400);
      if (hit) {
        await sleep(name === 'capture' ? 260 : name === 'burn' ? 380 : name === 'sweep' ? 500 : name === 'swap' ? 300 : 140);
        await shot(`${mode}-${name}`);
        got.add(name);
      }
    }
    if (got.size === Object.keys(want).length) break;
  }
  console.log('got', [...got].join(','));
}

export async function finish({ page, shot, jk, waitFor, sleep }) {
  const mode = process.env.MODE ?? 'classic';
  const n = Number(process.env.N ?? 4);
  await jk((m, n) => { window.__jk.settings.mode = m; window.__jk.settings.players = n; window.__jk.settings.level = 'normal'; }, mode, n);
  await jk(() => window.__jk.startLocal());
  await jk(() => { window.__jk.setAuto(true); window.__jk.setSpeed(8); });
  const ok = await waitFor(() => window.__jk.view?.phase === 'over' && !document.querySelector('#modal').classList.contains('hidden'), 400000);
  await sleep(1200);
  await shot(`${mode}-${n}-win`);
  const gaps = await jk(() => window.__jk.gaps);
  console.log('finished', ok, 'max gap', Math.max(...gaps.slice(60)).toFixed(1), 'avg', (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1), 'mem', JSON.stringify(await jk(() => window.__jk.board.renderer.info.memory)), 'progs', await jk(() => window.__jk.board.renderer.info.programs?.length));
}

async function setup(jk, sleep, waitFor, pos, hand, mode = 'classic') {
  await jk((m) => { window.__jk.settings.mode = m; window.__jk.settings.players = 4; }, mode);
  await jk(() => window.__jk.startLocal());
  await waitFor(() => window.__jk.canAct(), 60000);
  await jk((pos, hand) => {
    const e = window.__jk.link.engine;
    pos.forEach((p, i) => (e.board.marbles[i] = p));
    const ids = hand;
    e.players[0].hand = ids.map((id) => ({ id, r: (id % 13) + 1, s: 'SHDC'[Math.floor(id / 13)] }));
    window.__jk.link.tick(0.6);
  }, pos, hand);
  await sleep(600);
}
const H_ = -1, S_ = 76;
const POS = [5, 30, H_, H_, 8, 50, H_, H_, 40, H_, H_, S_ + 3, 33, 64, H_, H_];

export async function select({ shot, jk, waitFor, sleep }) {
  await setup(jk, sleep, waitFor, POS, [0, 19, 36, 42, 25]);
  await jk(() => window.__jk.selectCard(0));
  await sleep(700);
  await shot('select-ace');
  await jk(() => window.__jk.selectCard(19));
  await sleep(500);
  await shot('select-seven');
  await jk(() => window.__jk.onMarble(1));
  await sleep(600);
  await shot('split-chooser');
  console.log('rings', await jk(() => window.__jk.rings));
  await jk(() => window.__jk.ring(2));
  await sleep(600);
  await shot('split-second');
  await jk(() => window.__jk.selectCard(36));
  await sleep(300);
  await jk(() => window.__jk.onMarble(1));
  await sleep(600);
  await shot('jack-target');
  await jk(() => window.__jk.selectCard(42));
  await sleep(600);
  await shot('select-four');
}

export async function sweep({ shot, jk, waitFor, sleep }) {
  // Complex: my marble at 20 (p1's start is 20 — p1 marble elsewhere), victims ahead within 13.
  const pos = [21, H_, H_, H_, 24, 40, H_, H_, 27, H_, H_, H_, 30, 34, H_, H_];
  await setup(jk, sleep, waitFor, pos, [12, 1, 2, 3, 4], 'complex');
  await jk(() => window.__jk.selectCard(12));
  await sleep(600);
  await shot('sweep-select');
  await jk(() => window.__jk.ring(0));
  await sleep(1150);
  await shot('sweep-mid');
  await sleep(1500);
  await shot('sweep-after');
}

export async function mobile({ page, shot, jk, waitFor, sleep }) {
  await sleep(800);
  await shot('mobile-menu');
  await setup(jk, sleep, waitFor, POS, [0, 19, 36, 42, 25]);
  await sleep(800);
  await shot('mobile-board');
  await jk(() => window.__jk.selectCard(19));
  await jk(() => window.__jk.onMarble(1));
  await sleep(300);
  await jk(() => window.__jk.ring(2));
  await sleep(600);
  await shot('mobile-split');
  await jk(() => window.__jk.selectCard(25));
  await sleep(600);
  await shot('mobile-select');
  await jk(() => window.__jk.setAuto(true));
  await sleep(6000);
  await shot('mobile-play');
  await page.click('#rules-btn');
  await sleep(500);
  await shot('mobile-rules');
}
