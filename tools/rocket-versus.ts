/**
 * Two versions of the Boostball bot against each other, both at SSL, swapping sides every match:
 *   npx tsx tools/rocket-versus.ts [--a=path/to/bot.ts] --b=path/to/bot.ts [--n=10] [--size=2] [--length=150] [--seed=1] [--mate=allstar]
 * (default A = the current bot). `--la=gold --lb=plat`: the levels each side plays at (default ssl). Prints wins, goals, saves, jumps that never touched the ball, boost, and sim cost.
 * `--mate=<level>`: each side's first car is the version under test, its teammates are the current bot at
 * that level (a stand-in for a human teammate who chases the ball).
 */
import { resolve } from 'node:path';
import { World, type PlayerInfo } from '../client/src/rocket/sim/world';
import { Bots as ThisBots } from '../client/src/rocket/sim/bot';
import type { Controls } from '../client/src/rocket/sim/car';
import { CAR_IDS } from '../client/src/rocket/sim/constants';
import { loadNextoFromDisk } from '../server/src/nexto';
loadNextoFromDisk();

const args = process.argv.slice(2);
const flag = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const load = async (p: string) => (p ? (await import(resolve(p))).Bots : ThisBots) as typeof ThisBots;
const A = await load(flag('a', ''));
const B = await load(flag('b', ''));
const n = Number(flag('n', '10'));
const size = Number(flag('size', '2'));
const length = Number(flag('length', '150'));
const seed0 = Number(flag('seed', '1'));
const la = flag('la', 'ssl') as 'ssl';
const lb = flag('lb', 'ssl') as 'ssl';
const mate = flag('mate', '') as '' | 'rookie' | 'pro' | 'allstar' | 'ssl';

const side0 = () => ({ wins: 0, goals: 0, saves: 0, shots: 0, jumps: 0, wasted: 0, boost: 0, empty: 0, samples: 0, touches: 0, depth: 0, depthN: 0, hitN: 0, hitSpeed: 0, hard: 0, airN: 0, airSpeed: 0 });
const res = { a: side0(), b: side0() };
let draws = 0;
let ticks = 0;
const tickMs: number[] = [];
const t0 = performance.now();
for (let m = 0; m < n; m++) {
  const aTeam = (m % 2) as 0 | 1;
  const players: PlayerInfo[] = [];
  for (let i = 0; i < size * 2; i++) players.push({ id: i + 1, name: `P${i}`, team: (i % 2) as 0 | 1, bot: true, body: CAR_IDS[(m + i) % 3]! });
  const w = new World(players, length, seed0 + Math.floor(m / 2) * 977, false);
  // Each side only drives its own cars (the other side's are driven by the other brain).
  const brains = [new (aTeam === 0 ? A : B)(w, aTeam === 0 ? la : lb), new (aTeam === 1 ? A : B)(w, aTeam === 1 ? la : lb)];
  const outs = [new Map<number, Controls>(), new Map<number, Controls>()];
  const mates = mate ? new ThisBots(w, mate) : null;
  const mateOut = new Map<number, Controls>();
  const tested = new Set(players.filter((p) => p.id <= 2).map((p) => p.id));
  const inputs = new Map<number, Controls>();
  const team = new Map(players.map((p) => [p.id, p.team]));
  const air = new Map<number, { touched: boolean }>();
  /** Touches waiting to be measured (the ball's speed ~0.15 s later). */
  const pend: Array<{ car: number; at: number; z: number }> = [];
  const lastTouch = new Map<number, number>();
  while (w.phase !== 'over') {
    const tb = performance.now();
    brains[0]!.update(1 / 120, outs[0]!);
    brains[1]!.update(1 / 120, outs[1]!);
    tickMs.push(performance.now() - tb);
    mates?.update(1 / 120, mateOut);
    for (const p of players) inputs.set(p.id, mates && !tested.has(p.id) ? mateOut.get(p.id)! : outs[p.team]!.get(p.id)!);
    w.step(inputs);
    ticks++;
    for (const e of w.events) {
      if (e.k === 'jump') air.set(e.car, { touched: false });
      if (e.k === 'touch' && air.has(e.car)) air.get(e.car)!.touched = true;
      if (e.k === 'touch' && (!mates || tested.has(e.car))) {
        (team.get(e.car) === aTeam ? res.a : res.b).touches++;
        if (w.tickCount - (lastTouch.get(e.car) ?? -99) > 30) pend.push({ car: e.car, at: w.tickCount + 18, z: e.z });
        lastTouch.set(e.car, w.tickCount);
      }
    }
    w.events.length = 0;
    while (pend.length && pend[0]!.at <= w.tickCount) {
      const t = pend.shift()!;
      if (w.phase !== 'play') continue;
      const side = team.get(t.car) === aTeam ? res.a : res.b;
      const sp = w.ball.vel.length();
      side.hitN++;
      side.hitSpeed += sp;
      if (sp > 2500) side.hard++;
      if (t.z > 300) {
        side.airN++;
        side.airSpeed += sp;
      }
    }
    if (ticks % 12 === 0)
      for (const c of w.cars) {
        if (mates && !tested.has(c.id)) continue;
        const side = team.get(c.id) === aTeam ? res.a : res.b;
        side.boost += c.boost;
        side.samples++;
        // How far up the field the car is (towards their goal) while the ball is in their half.
        const dir = team.get(c.id) === 0 ? 1 : -1;
        if (w.ball.pos.y * dir > 1000) {
          side.depth += c.pos.y * dir;
          side.depthN++;
        }
        if (c.boost < 1) side.empty++;
      }
    for (const c of w.cars) {
      if (mates && !tested.has(c.id)) continue;
      const j = air.get(c.id);
      if (j && c.onGround && !c.hasJumped) {
        const side = team.get(c.id) === aTeam ? res.a : res.b;
        side.jumps++;
        if (!j.touched) side.wasted++;
        air.delete(c.id);
      }
    }
  }
  const ga = w.score[aTeam];
  const gb = w.score[1 - aTeam];
  res.a.goals += ga;
  res.b.goals += gb;
  if (ga > gb) res.a.wins++;
  else if (gb > ga) res.b.wins++;
  else draws++;
  for (const [id, s] of w.stats) {
    if (mates && !tested.has(id)) continue;
    const side = team.get(id) === aTeam ? res.a : res.b;
    side.saves += s.saves;
    side.shots += s.shots;
  }
  console.log(`match ${m}: A ${ga} – ${gb} B${w.overtime ? ' (OT)' : ''}`);
}
const row = (k: 'a' | 'b') => `${k.toUpperCase()} wins ${res[k].wins} · goals ${res[k].goals} · shots ${res[k].shots} · saves ${res[k].saves} · touches ${res[k].touches} · jumps ${res[k].jumps} (${((100 * res[k].wasted) / Math.max(1, res[k].jumps)).toFixed(0)}% never touched) · boost ${(res[k].boost / Math.max(1, res[k].samples)).toFixed(0)} (empty ${((100 * res[k].empty) / Math.max(1, res[k].samples)).toFixed(0)}%) · depth when attacking ${(res[k].depth / Math.max(1, res[k].depthN)).toFixed(0)} · hits ${(res[k].hitSpeed / Math.max(1, res[k].hitN)).toFixed(0)} uu/s (${((100 * res[k].hard) / Math.max(1, res[k].hitN)).toFixed(0)}% >2500, air ${(res[k].airSpeed / Math.max(1, res[k].airN)).toFixed(0)})`;
console.log(`\n${n} × ${size}v${size}, ${length} s — A=${flag('a', '') || 'current'} (${la}) B=${flag('b', '') || 'current'} (${lb})${mate ? ` (teammates: ${mate})` : ''}`);
console.log(row('a'));
console.log(row('b'));
tickMs.sort((x, y) => x - y);
console.log(`draws ${draws} · ${(((performance.now() - t0) / ticks) * 1000).toFixed(0)} µs/tick · brains p99 ${tickMs[Math.floor(tickMs.length * 0.99)]!.toFixed(1)} ms, p99.9 ${tickMs[Math.floor(tickMs.length * 0.999)]!.toFixed(1)} ms, max ${tickMs[tickMs.length - 1]!.toFixed(1)} ms`);
