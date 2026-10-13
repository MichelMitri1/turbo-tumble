/**
 * Frame-level audit of a saved Boostball match (SAVE MATCH LOG): how every car (bots and
 * humans side by side) jumps, defends, positions and uses boost.
 *   npx tsx tools/rocket-botaudit.ts <match.json> [--jumps] [--shots]
 * Jumps: every take-off, whether that car touched the ball before landing, and why it jumped
 * (the SSL brain re-run on the frame). Shots: every ball predicted into a net, who was back,
 * and whether it was saved.
 */
import { readFileSync } from 'node:fs';
import { World } from '../client/src/rocket/sim/world';
import { readSnapshot } from '../client/src/rocket/sim/snapshot';
import { predictBall, predictedGoal, type BallSample } from '../client/src/rocket/sim/ball';
import { ARENA } from '../client/src/rocket/sim/arena';
import { Bots, type BotLevel } from '../client/src/rocket/sim/bot';
import type { Controls } from '../client/src/rocket/sim/car';
import type { MatchLogFile } from '../client/src/rocket/matchlog';
import { loadNextoFromDisk } from '../server/src/nexto';
loadNextoFromDisk();

const args = process.argv.slice(2);
const log = JSON.parse(readFileSync(args.find((a) => !a.startsWith('--'))!, 'utf8')) as MatchLogFile;
const buf = Buffer.from(log.frames, 'base64');
const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const n = all.length / log.frameSize;
const world = new World(log.players, 300, 1, false, log.rules);
const bots = new Bots(world, (['rookie', 'pro', 'allstar', 'ssl'].includes(log.level) ? log.level : 'ssl') as BotLevel);
const ctl = new Map<number, Controls>();
const name = (id: number) => {
  const p = log.players.find((q) => q.id === id)!;
  return p.bot ? p.name : `human#${p.id}(${p.team ? 'O' : 'B'})`;
};
const sec = (tick: number) => `${Math.floor(tick / 120 / 60)}:${String(Math.floor((tick / 120) % 60)).padStart(2, '0')}`;
const touches = log.events.filter((x) => x.e.k === 'touch').map((x) => ({ tick: x.tick, car: (x.e as { car: number }).car, z: (x.e as { z: number }).z }));
const touchedBetween = (id: number, a: number, b: number) => touches.some((t) => t.car === id && t.tick >= a && t.tick <= b);

interface Jump { id: number; tick: number; land: number; dist: number; ballZ: number; maxZ: number; dodge: boolean; touched: boolean; plan: string; ownHalf: boolean }
interface Acc { frames: number; air: number; boost: number; empty: number; speed: number; sup: number; goalSide: number; ballDist: number; demoT: number; lastBack: number; wall: number }
const acc = new Map<number, Acc>();
const jumps: Jump[] = [];
const open = new Map<number, Jump>();
const path: BallSample[] = [];
interface Shot { team: 0 | 1; start: number; end: number; outcome: string; by: number; info: string }
const shots: Shot[] = [];
let shot: Shot | null = null;
let doubleCommit = [0, 0];
let noOneBack = [0, 0];
let playFrames = 0;
/** Ball velocity by frame tick (for how hard each touch sent it). */
const ballVel: Array<{ tick: number; vx: number; vy: number; vz: number }> = [];
/** Stuck: throttle down, barely moving, for over a second (wedged on the net / a wall). */
const stuckSince = new Map<number, number>();
const stuckAt = new Map<number, string>();
const stuck: string[] = [];

for (let i = 0; i < n; i++) {
  readSnapshot(world, all.subarray(i * log.frameSize, (i + 1) * log.frameSize));
  for (let k = 0; k < 8; k++) bots.update(1 / 120, ctl); // keep the brain's memory warm so plans are meaningful
  if (world.phase !== 'play') {
    open.clear();
    stuckSince.clear();
    if (shot) {
      shot.end = world.tickCount;
      shot.outcome = world.phase === 'goal' ? 'GOAL' : 'phase';
      shots.push(shot);
      shot = null;
    }
    continue;
  }
  playFrames++;
  const ball = world.ball;
  ballVel.push({ tick: world.tickCount, vx: ball.vel.x, vy: ball.vel.y, vz: ball.vel.z });
  for (const c of world.cars) {
    const pushing = !c.demolished && Math.abs(c.controls.throttle) > 0.5 && c.vel.length() < 150;
    if (pushing && !stuckSince.has(c.id)) {
      stuckSince.set(c.id, world.tickCount);
      stuckAt.set(c.id, [c.pos.x, c.pos.y, c.pos.z].map(Math.round).join(','));
    }
    if (!pushing && stuckSince.has(c.id)) {
      const t0 = stuckSince.get(c.id)!;
      if (world.tickCount - t0 > 120) stuck.push(`  ${sec(t0)} ${name(c.id)} stuck ${((world.tickCount - t0) / 120).toFixed(1)}s at ${stuckAt.get(c.id)}`);
      stuckSince.delete(c.id);
    }
  }
  for (const c of world.cars) {
    const a = acc.get(c.id) ?? { frames: 0, air: 0, boost: 0, empty: 0, speed: 0, sup: 0, goalSide: 0, ballDist: 0, demoT: 0, lastBack: 0, wall: 0 };
    acc.set(c.id, a);
    a.frames++;
    if (c.demolished) {
      a.demoT++;
      open.delete(c.id);
      continue;
    }
    const ownY = c.team === 0 ? -ARENA.halfY : ARENA.halfY;
    a.boost += c.boost;
    if (c.boost < 1) a.empty++;
    a.speed += c.vel.length();
    if (c.supersonic) a.sup++;
    const airborne = c.hasJumped || (c.airTime > 0.15 && c.pos.z > 60);
    if (airborne) a.air++;
    if (c.up.z < 0.5 && !airborne) a.wall++;
    if (Math.abs(c.pos.y - ownY) < Math.abs(ball.pos.y - ownY)) a.goalSide++;
    a.ballDist += c.pos.distanceTo(ball.pos);
    const mates = world.cars.filter((m) => m.team === c.team && !m.demolished);
    if (mates.every((m) => Math.abs(m.pos.y - ownY) >= Math.abs(c.pos.y - ownY))) a.lastBack++;
    // Jump bookkeeping.
    const j = open.get(c.id);
    if (!j && c.hasJumped && c.airTimeSinceJump < 0.2) {
      const plan = log.players.find((p) => p.id === c.id)!.bot ? bots.planOf(c.id) : '';
      open.set(c.id, { id: c.id, tick: world.tickCount, land: 0, dist: c.pos.distanceTo(ball.pos), ballZ: ball.pos.z, maxZ: c.pos.z, dodge: false, touched: false, plan, ownHalf: Math.sign(ball.pos.y) === Math.sign(ownY) });
    } else if (j) {
      j.maxZ = Math.max(j.maxZ, c.pos.z);
      if (c.hasFlipped) j.dodge = true;
      if (!c.hasJumped) {
        j.land = world.tickCount;
        j.touched = touchedBetween(c.id, j.tick - 8, j.land + 4);
        jumps.push(j);
        open.delete(c.id);
      }
    }
  }
  for (const team of [0, 1] as const) {
    const ownY = team === 0 ? -ARENA.halfY : ARENA.halfY;
    const mates = world.cars.filter((m) => m.team === team && !m.demolished);
    if (mates.length >= 2 && mates.every((m) => m.pos.distanceTo(ball.pos) < 900)) doubleCommit[team]++;
    if (Math.sign(ball.pos.y) === Math.sign(ownY) && mates.length > 0 && mates.every((m) => Math.abs(m.pos.y - ownY) > Math.abs(ball.pos.y - ownY) + 200)) noOneBack[team]++;
  }
  // Shots: ball predicted into a net.
  predictBall(ball, 3, 1 / 30, path);
  const g = predictedGoal(path, ball.radius);
  if (shot && (g !== 1 - shot.team || touches.some((t) => t.tick > shot!.start && t.tick <= world.tickCount && world.cars.find((c) => c.id === t.car)?.team === shot!.team))) {
    const saver = touches.filter((t) => t.tick > shot!.start && t.tick <= world.tickCount + 8).find((t) => world.cars.find((c) => c.id === t.car)?.team === shot!.team);
    shot.end = world.tickCount;
    shot.outcome = saver ? 'saved' : g === -1 ? 'missed/wide' : 'changed';
    shot.by = saver?.car ?? -1;
    shots.push(shot);
    shot = null;
  }
  if (!shot && g >= 0) {
    // The defending team = the one whose net it's going into.
    const team = (1 - g) as 0 | 1;
    let t = 3;
    for (const p of path) if (Math.abs(p.pos.y) >= ARENA.goalLineY) {
      t = p.t;
      break;
    }
    const ownY = team === 0 ? -ARENA.halfY : ARENA.halfY;
    const info = world.cars
      .filter((c) => c.team === team)
      .map((c) => `${name(c.id)} ${c.demolished ? 'DEMOLISHED' : `${Math.round(Math.abs(c.pos.y - ownY))}uu from own line, ${Math.abs(c.pos.y - ownY) < Math.abs(ball.pos.y - ownY) ? 'goal-side' : 'BEATEN'}, b${Math.round(c.boost)}${log.players.find((p) => p.id === c.id)!.bot ? ` [${bots.planOf(c.id)}]` : ''}`}`)
      .join(' · ');
    shot = { team, start: world.tickCount, end: 0, outcome: '', by: -1, info: `in ${t.toFixed(1)}s, ball ${Math.round(ball.vel.length())}uu/s from ${Math.round(Math.abs(ball.pos.y - ownY))}uu out, z${Math.round(ball.pos.z)} | ${info}` };
  }
}

const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(0)}%`;
console.log(`${log.online ? 'online' : 'local'} · level ${log.level} · ${n} frames · ${(playFrames / 15 / 60).toFixed(1)} min in play\n`);
console.log('car                 team  air  wall  goal-side  last-back  avg-dist  avg-boost  empty  avg-speed  supersonic  demo-time');
for (const p of log.players) {
  const a = acc.get(p.id)!;
  const live = a.frames - a.demoT;
  console.log(`${name(p.id).padEnd(20)}${(p.team ? 'O' : 'B').padEnd(6)}${pct(a.air, live).padEnd(5)}${pct(a.wall, live).padEnd(6)}${pct(a.goalSide, live).padEnd(11)}${pct(a.lastBack, live).padEnd(11)}${String(Math.round(a.ballDist / live)).padEnd(10)}${String(Math.round(a.boost / live)).padEnd(11)}${pct(a.empty, live).padEnd(7)}${String(Math.round(a.speed / live)).padEnd(11)}${pct(a.sup, live).padEnd(12)}${pct(a.demoT, a.frames)}`);
}
console.log(`\ndouble commits (both within 900 of ball): blue ${pct(doubleCommit[0]!, playFrames)} · orange ${pct(doubleCommit[1]!, playFrames)}`);
console.log(`nobody back (ball in own half, both upfield of it): blue ${pct(noOneBack[0]!, playFrames)} · orange ${pct(noOneBack[1]!, playFrames)}`);

console.log('\nJUMPS          total  touched  dodged  aerial(>400)  ball>1000 away at take-off  own half');
for (const p of log.players) {
  const js = jumps.filter((j) => j.id === p.id);
  const t = js.filter((j) => j.touched).length;
  console.log(`${name(p.id).padEnd(15)}${String(js.length).padEnd(7)}${`${t} (${pct(t, js.length)})`.padEnd(9)}${String(js.filter((j) => j.dodge).length).padEnd(8)}${`${js.filter((j) => j.maxZ > 400).length} (${js.filter((j) => j.maxZ > 400 && j.touched).length} hit)`.padEnd(14)}${String(js.filter((j) => j.dist > 1000).length).padEnd(28)}${js.filter((j) => j.ownHalf).length}`);
}
// Missed bot jumps by the plan the brain had at take-off.
const missed = jumps.filter((j) => log.players.find((p) => p.id === j.id)!.bot && !j.touched);
const byPlan = new Map<string, number>();
for (const j of missed) {
  const k = `${j.plan.replace(/\?$/, '')} · ${j.maxZ > 400 ? 'high' : 'low'} · ${j.dist > 1000 ? 'far' : j.dist > 400 ? 'mid' : 'close'}`;
  byPlan.set(k, (byPlan.get(k) ?? 0) + 1);
}
console.log('\nbot jumps that never touched the ball, by (plan · height · distance at take-off):');
for (const [k, v] of [...byPlan].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
if (args.includes('--jumps'))
  for (const j of jumps.filter((x) => log.players.find((p) => p.id === x.id)!.bot))
    console.log(`  ${sec(j.tick)} ${name(j.id)} ${j.touched ? 'HIT ' : 'miss'} dist ${Math.round(j.dist)} ballZ ${Math.round(j.ballZ)} peak ${Math.round(j.maxZ)} ${j.dodge ? 'dodge' : ''} ${((j.land - j.tick) / 120).toFixed(2)}s [${j.plan}]`);

// Touch quality: the ball's speed ~0.15 s after each touch, and how much of it goes towards their goal.
{
  const after = (tick: number) => ballVel.find((f) => f.tick >= tick + 16);
  const rows = new Map<number, { n: number; speed: number; fwd: number; hard: number; air: number; airSpeed: number; clear: number; clearSpeed: number }>();
  let last = -99;
  let lastCar = -1;
  for (const t of touches) {
    if (t.car === lastCar && t.tick - last < 30) continue; // one per contact, not every tick of a dribble
    last = t.tick;
    lastCar = t.car;
    const f = after(t.tick);
    if (!f) continue;
    const p = log.players.find((q) => q.id === t.car)!;
    const dir = p.team === 0 ? 1 : -1;
    const sp = Math.hypot(f.vx, f.vy, f.vz);
    const r = rows.get(t.car) ?? { n: 0, speed: 0, fwd: 0, hard: 0, air: 0, airSpeed: 0, clear: 0, clearSpeed: 0 };
    rows.set(t.car, r);
    r.n++;
    r.speed += sp;
    r.fwd += f.vy * dir;
    if (sp > 2500) r.hard++;
    if (t.z > 300) {
      r.air++;
      r.airSpeed += sp;
    }
    const ev = touches.find((x) => x.tick === t.tick && x.car === t.car)!;
    void ev;
  }
  console.log('\nTOUCH QUALITY (ball ~0.15 s after each contact)   contacts  avg speed  towards their goal  >2500 uu/s  air touches (avg speed)');
  for (const p of log.players) {
    const r = rows.get(p.id);
    if (!r) continue;
    console.log(`  ${name(p.id).padEnd(20)}${String(r.n).padEnd(10)}${String(Math.round(r.speed / r.n)).padEnd(11)}${String(Math.round(r.fwd / r.n)).padEnd(20)}${`${Math.round((100 * r.hard) / r.n)}%`.padEnd(12)}${r.air} (${r.air ? Math.round(r.airSpeed / r.air) : 0})`);
  }
}
console.log(`\nSTUCK (throttle down, not moving > 1 s): ${stuck.length ? `\n${stuck.join('\n')}` : 'none'}`);
console.log('\nSHOTS ON GOAL (ball predicted in)');
for (const team of [0, 1] as const) {
  const s = shots.filter((x) => x.team === team);
  const tally = (o: string) => s.filter((x) => x.outcome === o).length;
  console.log(`  ${team ? 'orange' : 'blue'} faced ${s.length}: saved ${tally('saved')} · goals ${tally('GOAL')} · went wide/deflected ${tally('missed/wide') + tally('changed')}`);
  const savers = new Map<string, number>();
  for (const x of s.filter((y) => y.outcome === 'saved')) savers.set(name(x.by), (savers.get(name(x.by)) ?? 0) + 1);
  console.log(`    saves by: ${[...savers].map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
for (const s of shots.filter((x) => x.outcome === 'GOAL' || args.includes('--shots')))
  console.log(`  ${sec(s.start)} ${s.team ? 'orange' : 'blue'} ${s.outcome.padEnd(11)} ${s.info}`);

// --window=a-b (seconds of match time, as printed): every frame of the bots in that span.
const win = args.find((a) => a.startsWith('--window='))?.split('=')[1];
if (win) {
  const [a, b] = win.split('-').map((s) => (s.includes(':') ? Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]) : Number(s)));
  const w2 = new World(log.players, 300, 1, false, log.rules);
  const b2 = new Bots(w2, 'ssl');
  const out = new Map<number, Controls>();
  for (let i = 0; i < n; i++) {
    readSnapshot(w2, all.subarray(i * log.frameSize, (i + 1) * log.frameSize));
    for (let k = 0; k < 8; k++) b2.update(1 / 120, out);
    const t = w2.tickCount / 120;
    if (t < a! || t > b!) continue;
    const bl = w2.ball;
    console.log(`${sec(w2.tickCount)}.${String(Math.floor((t % 1) * 10))} ${w2.phase} ball ${[bl.pos.x, bl.pos.y, bl.pos.z].map(Math.round).join(',')} v${[bl.vel.x, bl.vel.y, bl.vel.z].map(Math.round).join(',')} | ` +
      w2.cars.map((c) => {
        const k = c.controls;
        const bot = log.players.find((p) => p.id === c.id)!.bot;
        return `${name(c.id)} ${[c.pos.x, c.pos.y, c.pos.z].map(Math.round).join(',')} v${Math.round(c.forwardSpeed)} yaw${Math.round((Math.atan2(c.forward.y, c.forward.x) * 180) / Math.PI)} b${Math.round(c.boost)}${c.hasJumped ? ' AIR' : ''}${c.demolished ? ' DEMO' : ''} t${k.throttle.toFixed(1)}${k.boost ? 'B' : ''}${k.jump ? 'J' : ''}${bot ? ` [${b2.planOf(c.id)}]` : ''}`;
      }).join(' | '));
  }
}
