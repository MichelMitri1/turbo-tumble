/**
 * Boostball bot drills — repeatable situations scored the same way every run, to tune the SSL
 * bots against what humans actually do to them:
 *   save    a shot already on its way into the bot's net (ground / lofted, from anywhere in its
 *           half), the bot placed goal-side, in net or beaten; an SSL attacker follows the shot up.
 *   aerial  a high ball the bot could fly at (or wisely leave); counts jumps that never touch.
 *   cross   a (human) teammate carries the ball up a wing for 2.5 s, then centres it; two SSL bots defend.
 *           Is our bot up in support, does it get to the cross, does it score?
 *   shoot   a loose ball in their half (rolling / bouncing), the bot behind it, their keeper in net:
 *           how hard it hits it and how often it scores.
 *   wall    a high ball by a side wall in their half, the bot driving at that wall below it: does it
 *           go up and fly off the wall at it (air touches, ball value)?
 *   pass    the bot gets a loose ball on a wing of their half; its (human) teammate waits
 *           in front of their goal and attacks any ball that comes to it. Does the bot set it up?
 *   replay  every shot the bots faced in a saved match (SAVE MATCH LOG), re-played from that
 *           frame with the humans' recorded inputs.
 *   npx tsx tools/rocket-drills.ts [save|aerial|replay] [--n=300] [--bot=path/to/bot.ts] [--log=match.json] [--v] [--only=K]
 * `--v` lists the save drills conceded; `--only=K` traces save drill K tick by tick (and every jump with the plan behind it).
 * `--bot` swaps in another copy of the bot (a baseline) so two versions are measured on the same seeds.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { World, type PlayerInfo } from '../client/src/rocket/sim/world';
import { Bots as ThisBots } from '../client/src/rocket/sim/bot';
import { predictBall, predictedGoal, type BallSample } from '../client/src/rocket/sim/ball';
import { ARENA } from '../client/src/rocket/sim/arena';
import { readSnapshot } from '../client/src/rocket/sim/snapshot';
import type { Controls } from '../client/src/rocket/sim/car';
import * as C from '../client/src/rocket/sim/constants';
import type { MatchLogFile } from '../client/src/rocket/matchlog';
import { loadNextoFromDisk } from '../server/src/nexto';
loadNextoFromDisk();

const args = process.argv.slice(2);
const flag = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const kind = args.find((a) => !a.startsWith('--')) ?? 'save';
const N = Number(flag('n', '300'));
const verbose = args.includes('--v');
const only = Number(flag('only', '-1'));
const botPath = flag('bot', '');
const Bots = (botPath ? (await import(resolve(botPath))).Bots : ThisBots) as typeof ThisBots;

let seed = 1;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const U = (a: number, b: number) => a + (b - a) * rnd();
const path: BallSample[] = [];

function world(players: PlayerInfo[]): World {
  const w = new World(players, 300, 7, false);
  while (w.phase === 'countdown') w.step(new Map());
  w.events.length = 0;
  return w;
}

/** Throw the ball from `p` so it crosses the goal line at (tx, ±goal, tz) at `speed` uu/s (flat). */
function throwAt(w: World, px: number, py: number, pz: number, tx: number, ty: number, tz: number, speed: number): void {
  const d = Math.hypot(tx - px, ty - py);
  const T = d / speed;
  const g = C.GRAVITY;
  w.ball.pos.set(px, py, pz);
  w.ball.vel.set(((tx - px) / d) * speed, ((ty - py) / d) * speed, (tz - pz) / T - 0.5 * g * T);
  w.ball.angVel.set(0, 0, 0);
  w.ball.lastTouch = 2;
  w.ball.lastTouchTeam = 1;
}

if (kind === 'save') {
  let saves = 0;
  let total = 0;
  let wasted = 0;
  let jumps = 0;
  const byType: Record<string, [number, number]> = {};
  for (let i = 0; total < N; i++) {
    seed = (Math.imul(i + 1, 2654435761) ^ 0x5bd1e995) >>> 0;
    for (let k = 0; k < 4; k++) rnd();
    const w = world([
      { id: 1, name: 'D', team: 0, bot: true, body: 'octane' },
      { id: 2, name: 'A', team: 1, bot: true, body: 'octane' },
    ]);
    const bots = new Bots(w, 'ssl');
    bots.stats = {};
    const own = -ARENA.halfY;
    // The shot.
    const lob = rnd() < 0.35;
    const bx = U(-3200, 3200);
    const by = U(-3600, 800);
    const bz = lob ? U(100, 700) : 93;
    throwAt(w, bx, by, bz, U(-750, 750), own - 60, lob ? U(150, 560) : U(93, 200), U(1300, 2800));
    predictBall(w.ball, 4, 1 / 30, path);
    if (predictedGoal(path, w.ball.radius) !== 1) continue;
    // The defender: in net, goal-side somewhere between, or beaten (level with / past the ball).
    const r = rnd();
    const type = r < 0.25 ? 'in-net' : r < 0.7 ? 'goal-side' : 'beaten';
    const d = w.cars[0]!;
    let dx: number;
    let dy: number;
    if (type === 'in-net') {
      dx = U(-800, 800);
      dy = own + U(150, 700);
    } else if (type === 'goal-side') {
      const f = U(0.15, 0.85);
      dx = bx * (1 - f) + U(-1200, 1200);
      dy = by + (own - by) * f;
    } else {
      dx = U(-3000, 3000);
      dy = by + U(200, 1800);
    }
    dx = Math.max(-3800, Math.min(3800, dx));
    d.place(dx, Math.max(own + 150, Math.min(4800, dy)), U(-Math.PI, Math.PI), Math.round(U(0, 100)));
    d.vel.copy(d.forward).multiplyScalar(U(0, 1600));
    // The attacker following its shot up.
    const a = w.cars[1]!;
    a.place(bx + U(-600, 600), Math.min(4800, by + U(700, 2200)), -Math.PI / 2 + U(-0.4, 0.4), Math.round(U(20, 100)));
    a.vel.copy(a.forward).multiplyScalar(U(800, 1800));
    const inputs = new Map<number, Controls>();
    let goal = -1;
    let touched = false;
    let inAir = false;
    let airTouch = false;
    for (let k = 0; k < 120 * 5 && goal < 0; k++) {
      bots.update(1 / 120, inputs);
      if (only === i && inputs.get(1)?.jump && d.onGround) {
        const m = (bots as unknown as { mem: Map<number, Record<string, unknown>> }).mem.get(1)!;
        console.log(`  JUMP @${(k / 120).toFixed(2)} planScore ${(m.planScore as number).toFixed(0)} planAt +${((m.planAt as number) - w.tickCount / 120).toFixed(2)} blockScore ${(m.blockScore as number).toFixed(0)} blockAt +${((m.blockAt as number) - w.tickCount / 120).toFixed(2)} cand ${JSON.stringify(m.planC)}`);
      }
      w.step(inputs);
      for (const e of w.events) {
        if (e.k === 'goal') goal = e.team;
        if (e.k === 'touch' && e.car === 1) {
          touched = true;
          if (inAir) airTouch = true;
        }
        if (e.k === 'jump' && e.car === 1) {
          jumps++;
          inAir = true;
          airTouch = false;
        }
      }
      if (inAir && !d.hasJumped && d.onGround) {
        if (!airTouch) wasted++;
        inAir = false;
      }
      w.events.length = 0;
      if (only === i && k % 6 === 0) console.log(`  ${(k / 120).toFixed(2)} ball ${w.ball.pos.toArray().map(Math.round).join(',')} v${w.ball.vel.toArray().map(Math.round).join(',')} D ${d.pos.toArray().map(Math.round).join(',')} fwd${Math.round(d.forwardSpeed)} yaw${Math.round((Math.atan2(d.forward.y, d.forward.x) * 180) / Math.PI)} b${Math.round(d.boost)} ${bots.planOf(1)} t${d.controls.throttle.toFixed(1)} s${d.controls.steer.toFixed(1)}${d.controls.boost ? 'B' : ''}${d.controls.jump ? 'J' : ''}${d.controls.handbrake ? 'H' : ''} ${JSON.stringify(bots.stats)}`);
    }
    if (inAir && !airTouch) wasted++;
    total++;
    const ok = goal !== 1;
    if (ok) saves++;
    const k = `${type}${lob ? ' lob' : ''}`;
    byType[k] ??= [0, 0];
    byType[k]![0] += ok ? 1 : 0;
    byType[k]![1]++;
    if (verbose && !ok) console.log(`#${i} ${k} conceded · ball from ${Math.round(bx)},${Math.round(by)},${Math.round(bz)} · defender from ${Math.round(dx)},${Math.round(dy)}${touched ? ' (touched it)' : ''}`);
  }
  console.log(`save drill (${botPath || 'current bot'}): ${saves}/${total} kept out (${((100 * saves) / total).toFixed(1)}%) · jumps ${jumps}, ${wasted} never touched the ball`);
  for (const [k, [s, t]] of Object.entries(byType).sort()) console.log(`  ${k.padEnd(16)} ${s}/${t} (${((100 * s) / t).toFixed(0)}%)`);
} else if (kind === 'aerial') {
  let jumps = 0;
  let wasted = 0;
  let airHits = 0;
  let value = 0;
  let goals = 0;
  let conceded = 0;
  let airSpeed = 0;
  let airN = 0;
  for (let i = 0; i < N; i++) {
    seed = (Math.imul(i + 7, 2246822519) ^ 0x27d4eb2f) >>> 0;
    for (let k = 0; k < 4; k++) rnd();
    const w = world([
      { id: 1, name: 'B', team: 0, bot: true, body: 'octane' },
      { id: 2, name: 'O', team: 1, bot: true, body: 'octane' },
    ]);
    const bots = new Bots(w, 'ssl');
    // A high ball somewhere in the middle of the field, drifting.
    w.ball.pos.set(U(-2800, 2800), U(-2500, 3500), U(500, 1500));
    w.ball.vel.set(U(-500, 500), U(-700, 900), U(-200, 600));
    w.ball.angVel.set(0, 0, 0);
    w.ball.lastTouch = 2;
    const b = w.cars[0]!;
    b.place(U(-3000, 3000), w.ball.pos.y - U(800, 3000), U(-Math.PI, Math.PI), Math.round(U(20, 100)));
    b.vel.copy(b.forward).multiplyScalar(U(0, 1800));
    // Their defender, back in their net area.
    const o = w.cars[1]!;
    o.place(U(-1500, 1500), U(3800, 5000), -Math.PI / 2, Math.round(U(20, 100)));
    const inputs = new Map<number, Controls>();
    let inAir = false;
    let airTouch = false;
    let goal = -1;
    let measureAt = -1;
    for (let k = 0; k < 120 * 4 && goal < 0; k++) {
      if (k === measureAt) {
        airSpeed += w.ball.vel.length();
        airN++;
      }
      bots.update(1 / 120, inputs);
      w.step(inputs);
      for (const e of w.events) {
        if (e.k === 'goal') goal = e.team;
        if (e.k === 'touch' && e.car === 1 && inAir) {
          if (!airTouch) {
            airHits++;
            measureAt = k + 18;
          }
          airTouch = true;
        }
        if (e.k === 'jump' && e.car === 1) {
          jumps++;
          inAir = true;
          airTouch = false;
        }
      }
      w.events.length = 0;
      if (inAir && !b.hasJumped && b.onGround) {
        if (!airTouch) wasted++;
        inAir = false;
      }
    }
    if (inAir && !airTouch) wasted++;
    if (goal === 0) goals++;
    if (goal === 1) conceded++;
    // Where's the ball heading after 4 s (blue attacks +y): y plus velocity, capped.
    value += goal === 0 ? 6000 : goal === 1 ? -6000 : w.ball.pos.y + w.ball.vel.y;
  }
  console.log(`aerial drill (${botPath || 'current bot'}): jumps ${jumps}, air touches ${airHits}, jumps that never touched ${wasted} (${((100 * wasted) / Math.max(1, jumps)).toFixed(0)}%) · goals ${goals}, conceded ${conceded} · ball value ${(value / N).toFixed(0)} · ball speed after air touches ${Math.round(airSpeed / Math.max(1, airN))}`);
} else if (kind === 'cross') {
  let goals = 0;
  let conceded = 0;
  let reached = 0;
  let depth = 0;
  for (let i = 0; i < N; i++) {
    seed = (Math.imul(i + 3, 2654435761) ^ 0x1b873593) >>> 0;
    for (let k = 0; k < 4; k++) rnd();
    const w = world([
      { id: 1, name: 'Us', team: 0, bot: true, body: 'octane' },
      { id: 2, name: 'O1', team: 1, bot: true, body: 'octane' },
      { id: 3, name: 'Mate', team: 0, bot: false, body: 'octane' },
      { id: 4, name: 'O2', team: 1, bot: true, body: 'octane' },
    ]);
    const bots = new Bots(w, 'ssl');
    const us = w.cars[0]!;
    const mate = w.car(3)!;
    const side = rnd() < 0.5 ? -1 : 1;
    us.place(U(-2500, 2500), U(-3200, -600), Math.PI / 2 + U(-0.6, 0.6), Math.round(U(30, 100)));
    w.car(2)!.place(U(-600, 600), 4900, -Math.PI / 2, 60);
    w.car(4)!.place(side * U(1500, 2500), U(2500, 3500), -Math.PI / 2, 60);
    const inputs = new Map<number, Controls>();
    const carry = 2.5;
    let goal = -1;
    let touched = false;
    const y0 = U(600, 1600);
    const y1 = U(3600, 4400);
    const x0 = side * U(2800, 3500);
    for (let k = 0; k < 120 * (carry + 4) && goal < 0; k++) {
      const t = k / 120;
      if (t < carry) {
        // The teammate dribbles up the wing (scripted: ball kept just ahead of its nose).
        const y = y0 + ((y1 - y0) * t) / carry;
        w.ball.pos.set(x0, y + 140, 93);
        w.ball.vel.set(0, (y1 - y0) / carry, 0);
        w.ball.angVel.set(0, 0, 0);
        w.ball.lastTouch = 3;
        w.ball.lastTouchTeam = 0;
        mate.place(x0, y, Math.PI / 2, 50);
        mate.vel.set(0, (y1 - y0) / carry, 0);
      } else if (Math.abs(t - carry) < 1 / 240) {
        // The cross: towards the slot in front of their goal.
        depth += us.pos.y;
        const tx = U(-600, 600);
        const ty = U(3300, 4300);
        const d = Math.hypot(tx - x0, ty - w.ball.pos.y);
        const sp = U(1500, 2200);
        w.ball.vel.set(((tx - x0) / d) * sp, ((ty - w.ball.pos.y) / d) * sp, U(0, 450));
        mate.place(x0, y1 - 300, Math.PI / 2, 50);
      }
      bots.update(1 / 120, inputs);
      inputs.delete(3);
      w.step(inputs);
      for (const e of w.events) {
        if (e.k === 'goal') goal = e.team;
        if (e.k === 'touch' && e.car === 1 && t > carry) touched = true;
      }
      w.events.length = 0;
      if (only === i && k % 12 === 0) {
        const B = bots as unknown as { supportPoint(c: unknown): { x: number; y: number } | null; possession(c: unknown): number };
        const sp = B.supportPoint(us);
        console.log(`  ${t.toFixed(1)} ball ${w.ball.pos.toArray().map(Math.round).join(',')} us ${us.pos.toArray().map(Math.round).join(',')} v${Math.round(us.forwardSpeed)} b${Math.round(us.boost)} ${bots.planOf(1)} poss ${B.possession(us)} support ${sp ? `${Math.round(sp.x)},${Math.round(sp.y)}` : '-'} t${us.controls.throttle.toFixed(1)}${us.controls.boost ? 'B' : ''}`);
      }
    }
    if (goal === 0) goals++;
    if (goal === 1) conceded++;
    if (touched) reached++;
  }
  console.log(`cross drill (${botPath || 'current bot'}): ${N} crosses · our bot ${Math.round(depth / N)} up the field when it's crossed · touched the cross ${reached} · goals ${goals} · conceded ${conceded}`);
} else if (kind === 'shoot') {
  let goals = 0;
  let hit = 0;
  let speed = 0;
  let hard = 0;
  for (let i = 0; i < N; i++) {
    seed = (Math.imul(i + 11, 2246822519) ^ 0x68e31da4) >>> 0;
    for (let k = 0; k < 4; k++) rnd();
    const w = world([
      { id: 1, name: 'Us', team: 0, bot: true, body: 'octane' },
      { id: 2, name: 'Keeper', team: 1, bot: true, body: 'octane' },
    ]);
    const bots = new Bots(w, 'ssl');
    w.ball.pos.set(U(-2500, 2500), U(500, 3200), rnd() < 0.3 ? U(150, 500) : 93);
    w.ball.vel.set(U(-500, 500), U(-600, 400), U(0, 300));
    w.ball.angVel.set(0, 0, 0);
    w.ball.lastTouch = 2;
    const us = w.cars[0]!;
    us.place(w.ball.pos.x + U(-1500, 1500), w.ball.pos.y - U(1200, 3000), Math.PI / 2 + U(-0.8, 0.8), Math.round(U(30, 100)));
    us.vel.copy(us.forward).multiplyScalar(U(300, 1500));
    w.car(2)!.place(U(-500, 500), 4900, -Math.PI / 2, 60);
    const inputs = new Map<number, Controls>();
    let goal = -1;
    let first = -1;
    for (let k = 0; k < 120 * 5 && goal < 0; k++) {
      bots.update(1 / 120, inputs);
      w.step(inputs);
      for (const e of w.events) {
        if (e.k === 'goal') goal = e.team;
        if (e.k === 'touch' && e.car === 1 && first < 0) first = k;
      }
      w.events.length = 0;
      if (first >= 0 && k === first + 18) {
        hit++;
        const sp = w.ball.vel.length();
        speed += sp;
        if (sp > 2500) hard++;
      }
    }
    if (goal === 0) goals++;
    if (verbose) console.log(`#${i} ${goal === 0 ? 'GOAL' : 'no'} first touch ${first < 0 ? '-' : (first / 120).toFixed(2)}s`);
  }
  console.log(`shoot drill (${botPath || 'current bot'}): ${N} loose balls · hit ${hit} · first-touch ball speed ${Math.round(speed / Math.max(1, hit))} uu/s (${Math.round((100 * hard) / Math.max(1, hit))}% >2500) · goals ${goals}`);
} else if (kind === 'wall') {
  let touches = 0;
  let wallJumps = 0;
  let airTouches = 0;
  let value = 0;
  let goals = 0;
  for (let i = 0; i < N; i++) {
    seed = (Math.imul(i + 5, 2654435761) ^ 0x7f4a7c15) >>> 0;
    for (let k = 0; k < 4; k++) rnd();
    const w = world([
      { id: 1, name: 'Us', team: 0, bot: true, body: 'octane' },
      { id: 2, name: 'Keeper', team: 1, bot: true, body: 'octane' },
    ]);
    const bots = new Bots(w, 'ssl');
    bots.stats = {};
    const side = rnd() < 0.5 ? -1 : 1;
    w.ball.pos.set(side * U(3200, 3800), U(500, 3500), U(700, 1500));
    w.ball.vel.set(side * U(0, 200), U(-200, 400), U(-100, 300));
    w.ball.angVel.set(0, 0, 0);
    w.ball.lastTouch = 2;
    const us = w.cars[0]!;
    us.place(side * U(2000, 3200), w.ball.pos.y - U(800, 2200), side > 0 ? U(0.2, 0.9) : Math.PI - U(0.2, 0.9), Math.round(U(50, 100)));
    us.vel.copy(us.forward).multiplyScalar(U(900, 1600));
    w.car(2)!.place(U(-500, 500), 4900, -Math.PI / 2, 60);
    const inputs = new Map<number, Controls>();
    let goal = -1;
    let touched = false;
    for (let k = 0; k < 120 * 4 && goal < 0; k++) {
      bots.update(1 / 120, inputs);
      const offWall = us.onGround && us.up.z < 0.6;
      w.step(inputs);
      for (const e of w.events) {
        if (e.k === 'goal') goal = e.team;
        if (e.k === 'jump' && e.car === 1 && offWall) wallJumps++;
        if (e.k === 'touch' && e.car === 1 && !touched) {
          touched = true;
          touches++;
          if (!us.onGround) airTouches++;
        }
      }
      w.events.length = 0;
      if (only === i && k % 12 === 0) console.log(`  ${(k / 120).toFixed(1)} ball ${w.ball.pos.toArray().map(Math.round).join(',')} us ${us.pos.toArray().map(Math.round).join(',')} up.z ${us.up.z.toFixed(2)} b${Math.round(us.boost)} ${bots.planOf(1)} ${JSON.stringify(bots.stats)}`);
    }
    if (goal === 0) goals++;
    value += goal === 0 ? 6000 : goal === 1 ? -6000 : w.ball.pos.y + w.ball.vel.y;
  }
  console.log(`wall drill (${botPath || 'current bot'}): ${N} balls · touched ${touches} (${airTouches} in the air) · jumps off a wall ${wallJumps} · goals ${goals} · ball value ${Math.round(value / N)}`);
} else if (kind === 'pass') {
  let goals = 0;
  let mateTouches = 0;
  let botGoals = 0;
  const passStats: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    seed = (Math.imul(i + 9, 2654435761) ^ 0x2545f491) >>> 0;
    for (let k = 0; k < 4; k++) rnd();
    const w = world([
      { id: 1, name: 'Us', team: 0, bot: true, body: 'octane' },
      { id: 2, name: 'Keeper', team: 1, bot: true, body: 'octane' },
      { id: 3, name: 'Mate', team: 0, bot: false, body: 'octane' },
      { id: 4, name: 'O2', team: 1, bot: true, body: 'octane' },
    ]);
    const bots = new Bots(w, 'ssl');
    bots.stats = passStats;
    const side = rnd() < 0.5 ? -1 : 1;
    w.ball.pos.set(side * U(2000, 3300), U(1200, 3600), 93);
    w.ball.vel.set(side * U(-300, 200), U(-300, 300), 0);
    w.ball.angVel.set(0, 0, 0);
    w.ball.lastTouch = 2;
    const us = w.cars[0]!;
    us.place(w.ball.pos.x - side * U(200, 900), w.ball.pos.y - U(900, 1800), Math.PI / 2 + side * U(0, 0.5), Math.round(U(40, 100)));
    us.vel.copy(us.forward).multiplyScalar(U(800, 1500));
    const mate = w.car(3)!;
    mate.place(U(-700, 700), U(1800, 2600), Math.PI / 2, 60);
    w.car(2)!.place(U(-400, 400), 4900, -Math.PI / 2, 60);
    w.car(4)!.place(-side * U(500, 1500), U(3500, 4300), -Math.PI / 2, 60);
    const inputs = new Map<number, Controls>();
    let goal = -1;
    let scorer = -1;
    let mateTouched = false;
    for (let k = 0; k < 120 * 5 && goal < 0; k++) {
      bots.update(1 / 120, inputs);
      // The teammate: holds its spot, then attacks a ball that comes within reach (drive + flip into it).
      const b = w.ball.pos;
      const d = Math.hypot(b.x - mate.pos.x, b.y - mate.pos.y);
      const c: Controls = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };
      if (d < 2800 && b.z < 400 && w.ball.lastTouch === 1) {
        const tx = b.x + w.ball.vel.x * 0.2 - mate.pos.x;
        const ty = b.y + w.ball.vel.y * 0.2 - 90 - mate.pos.y;
        const ang = Math.atan2(tx * mate.left.x + ty * mate.left.y, tx * mate.forward.x + ty * mate.forward.y);
        c.steer = Math.max(-1, Math.min(1, -ang * 3));
        c.throttle = 1;
        c.boost = Math.abs(ang) < 0.3;
      }
      inputs.set(3, c);
      if (only === i && k % 12 === 0) console.log(`  ${(k / 120).toFixed(1)} ball ${w.ball.pos.toArray().map(Math.round).join(',')} v${w.ball.vel.toArray().map(Math.round).join(',')} us ${us.pos.toArray().map(Math.round).join(',')} mate ${mate.pos.toArray().map(Math.round).join(',')} ${bots.planOf(1)} last ${w.ball.lastTouch}`);
      w.step(inputs);
      for (const e of w.events) {
        if (e.k === 'goal') {
          goal = e.team;
          scorer = w.ball.lastTouch;
        }
        if (e.k === 'touch' && e.car === 3 && !mateTouched) {
          mateTouched = true;
          mateTouches++;
        }
      }
      w.events.length = 0;
    }
    if (goal === 0) {
      goals++;
      if (scorer === 1) botGoals++;
    }
  }
  console.log(JSON.stringify(passStats));
  console.log(`pass drill (${botPath || 'current bot'}): ${N} corner balls · teammate got it ${mateTouches} · team goals ${goals} (bot ${botGoals}, teammate ${goals - botGoals})`);
} else if (kind === 'replay') {
  const log = JSON.parse(readFileSync(flag('log', 'smoke-out/boostball-match-2026-10-11-2209.json'), 'utf8')) as MatchLogFile;
  const buf = Buffer.from(log.frames, 'base64');
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = all.length / log.frameSize;
  const botTeams = new Set(log.players.filter((p) => p.bot).map((p) => p.team));
  const probe = new World(log.players, 300, 1, false, log.rules);
  // Shot starts: first frame of each spell where the ball is predicted into a net with a bot defending.
  const starts: number[] = [];
  let inShot = -1;
  for (let i = 0; i < n; i++) {
    readSnapshot(probe, all.subarray(i * log.frameSize, (i + 1) * log.frameSize));
    if (probe.phase !== 'play') {
      inShot = -1;
      continue;
    }
    predictBall(probe.ball, 3, 1 / 30, path);
    const g = predictedGoal(path, probe.ball.radius);
    if (g >= 0 && botTeams.has((1 - g) as 0 | 1) && inShot !== g) starts.push(i);
    inShot = g;
  }
  let kept = 0;
  for (const s of starts) {
    const w = new World(log.players, 300, 1, false, log.rules);
    const bots = new Bots(w, 'ssl');
    const out = new Map<number, Controls>();
    // Warm the bots up on the second before the shot so their memory is realistic.
    for (let i = Math.max(0, s - 15); i <= s; i++) {
      readSnapshot(w, all.subarray(i * log.frameSize, (i + 1) * log.frameSize));
      for (let k = 0; k < 8; k++) bots.update(1 / 120, out);
    }
    readSnapshot(w, all.subarray(s * log.frameSize, (s + 1) * log.frameSize));
    const t0 = w.tickCount;
    predictBall(w.ball, 3, 1 / 30, path);
    const defending = 1 - predictedGoal(path, w.ball.radius);
    const inputs = new Map<number, Controls>();
    let goal = -1;
    let frame = s;
    for (let k = 0; k < 120 * 4 && goal < 0 && w.phase === 'play'; k++) {
      // Humans: their recorded inputs (held between the 15 Hz frames).
      if ((w.tickCount - t0) % 8 === 0 && frame + 1 < n) frame++;
      bots.update(1 / 120, out);
      for (const p of log.players) {
        if (p.bot) inputs.set(p.id, out.get(p.id)!);
        else {
          const o = (frame * log.frameSize) + 25 + probe.pads.length + log.players.findIndex((q) => q.id === p.id) * 38 + 32;
          inputs.set(p.id, { throttle: all[o]!, steer: all[o + 1]!, pitch: all[o + 2]!, yaw: all[o + 3]!, roll: all[o + 4]!, jump: (all[o + 5]! & 1) !== 0, boost: (all[o + 5]! & 2) !== 0, handbrake: (all[o + 5]! & 4) !== 0 });
        }
      }
      w.step(inputs);
      for (const e of w.events) if (e.k === 'goal') goal = e.team;
      w.events.length = 0;
    }
    const ok = goal !== 1 - defending;
    if (ok) kept++;
    console.log(`  ${(t0 / 120).toFixed(1)}s ${defending ? 'orange' : 'blue'} ${ok ? 'kept out' : 'GOAL'}`);
  }
  console.log(`replay (${botPath || 'current bot'}): ${kept}/${starts.length} shots kept out`);
}
