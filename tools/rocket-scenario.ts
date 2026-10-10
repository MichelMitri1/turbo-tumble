/**
 * One-bot drills for tuning the Boostball bots: kickoff, aerial, half-flip.
 *   npx tsx tools/rocket-scenario.ts [kickoff|aerial|half] [--level=ssl] [--v]
 */
import { World } from '../client/src/rocket/sim/world';
import { Bots, type BotLevel } from '../client/src/rocket/sim/bot';
import type { Controls } from '../client/src/rocket/sim/car';
import { KICKOFF_SPAWNS } from '../client/src/rocket/sim/constants';

const args = process.argv.slice(2);
const kind = args.find((a) => !a.startsWith('--')) ?? 'kickoff';
const level = (args.find((a) => a.startsWith('--level='))?.split('=')[1] ?? 'ssl') as BotLevel;
const verbose = args.includes('--v');

function setup(): { w: World; bots: Bots; inputs: Map<number, Controls> } {
  const w = new World([{ id: 1, name: 'A', team: 0, bot: true, body: 'octane' }], 300, 1, false);
  const bots = new Bots(w, level);
  bots.stats = {};
  return { w, bots, inputs: new Map() };
}
function run(w: World, bots: Bots, inputs: Map<number, Controls>, secs: number, each?: (t: number) => boolean | void): number {
  for (let k = 0; k < secs * 120; k++) {
    bots.update(1 / 120, inputs);
    w.step(inputs);
    if (each?.(k / 120)) return k / 120;
  }
  return -1;
}
const f = (n: number) => n.toFixed(0).padStart(6);

if (kind === 'kickoff') {
  for (const [x, y, yaw] of KICKOFF_SPAWNS) {
    const { w, bots, inputs } = setup();
    while (w.phase === 'countdown') w.step(new Map());
    const car = w.cars[0]!;
    car.place(x, y, yaw);
    let touched = -1;
    const t = run(w, bots, inputs, 5, (t) => {
      if (verbose && Math.round(t * 120) % 6 === 0) console.log(t.toFixed(2), f(car.pos.x), f(car.pos.y), f(car.pos.z), 'v', f(car.speed), 'boost', f(car.boost), 'up', car.up.z.toFixed(2));
      for (const e of w.events) if (e.k === 'touch') touched = t;
      w.events.length = 0;
      return touched >= 0;
    });
    console.log(`spawn ${x},${y}: touch at ${t.toFixed(2)} s, speed ${car.speed.toFixed(0)}, boost left ${car.boost.toFixed(0)}`, JSON.stringify(bots.stats));
  }
} else if (kind === 'aerial') {
  let hits = 0;
  const N = 12;
  for (let i = 0; i < N; i++) {
    const { w, bots, inputs } = setup();
    while (w.phase === 'countdown') w.step(new Map());
    const car = w.cars[0]!;
    car.place(-1500 + i * 250, -3000, Math.PI / 2, 100);
    // A ball lobbed towards orange's half, high.
    w.ball.pos.set(-600 + i * 100, -1200, 900 + (i % 4) * 250);
    w.ball.vel.set(0, 250, 400);
    w.ball.lastTouch = 0;
    let touch: number | null = null;
    run(w, bots, inputs, 4, (t) => {
      if (verbose && i === 0 && Math.round(t * 120) % 6 === 0) console.log(t.toFixed(2), 'car', f(car.pos.x), f(car.pos.y), f(car.pos.z), 'ball', f(w.ball.pos.x), f(w.ball.pos.y), f(w.ball.pos.z), 'boost', f(car.boost), 'fwd', car.forward.toArray().map((v) => v.toFixed(2)).join(','));
      for (const e of w.events) if (e.k === 'touch' && touch === null) touch = e.z;
      w.events.length = 0;
      return touch !== null;
    });
    if (touch !== null && touch > 300) hits++;
    console.log(`case ${i}: ${touch === null ? 'miss' : `touch at z ${(touch as number).toFixed(0)}`} · ball after ${w.ball.vel.toArray().map((v) => v.toFixed(0)).join(',')}`, JSON.stringify(bots.stats));
  }
  console.log(`air touches ${hits}/${N}`);
} else {
  const { w, bots, inputs } = setup();
  while (w.phase === 'countdown') w.step(new Map());
  const car = w.cars[0]!;
  // Facing orange's goal, ball far behind (towards blue's net), rolling slowly.
  car.place(0, 2000, Math.PI / 2, 60);
  w.ball.pos.set(0, -1500, 93);
  w.ball.vel.set(0, 0, 0);
  w.ball.lastTouch = 0;
  const t = run(w, bots, inputs, 6, (t) => {
    if (verbose && Math.round(t * 120) % 6 === 0) console.log(t.toFixed(2), f(car.pos.x), f(car.pos.y), f(car.pos.z), 'v', f(car.forwardSpeed), 'up', car.up.z.toFixed(2), 'fwd.y', car.forward.y.toFixed(2));
    for (const e of w.events) if (e.k === 'touch') return true;
    w.events.length = 0;
  });
  console.log(`reached the ball behind in ${t.toFixed(2)} s`, JSON.stringify(bots.stats));
}
