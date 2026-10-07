/**
 * Headless 8-ball games, bot vs bot: games finish, rule stats, think time.
 *   npx tsx tools/pool-sim.ts [games=40] [levelA=hard] [levelB=normal]
 */
import { PoolEngine, type GameEvent } from '../client/src/pool/engine';
import { PoolBot, type BotLevel } from '../client/src/pool/bots';
const args = process.argv.slice(2);
const games = Number(args[0] ?? 40);
const A = (args[1] ?? 'hard') as BotLevel, B = (args[2] ?? 'normal') as BotLevel;
const bots = { a: new PoolBot(A), b: new PoolBot(B) };
const wins = { a: 0, b: 0 };
const stats: Record<string, number> = {};
let shots = 0, stuck = 0, thinkMs = 0, potsPerShot = 0;
for (let g = 0; g < games; g++) {
  const e = new PoolEngine([{ id: 'a', name: A, bot: true, avatar: 0 }, { id: 'b', name: B, bot: true, avatar: 1 }]);
  let n = 0;
  while (!e.isOver && n < 400) {
    if (e.phase === 'rolling') { e.update(100); continue; }
    const t0 = performance.now();
    const action = bots[e.current.id as 'a' | 'b'].plan(e);
    thinkMs += performance.now() - t0;
    const err = e.act(e.current.id, action);
    if (err) { stats[`err:${err}`] = (stats[`err:${err}`] ?? 0) + 1; e.act(e.current.id, { t: 'shoot', shot: { dx: 1, dy: 0, power: 0.3, sx: 0, sy: 0 }, call: 0, cue: e.ballInHand ? { x: -0.8, y: 0.3 } : undefined }); }
    n++; shots++;
    for (const ev of e.events.splice(0) as GameEvent[]) {
      if (ev.k === 'result') { if (ev.foul) stats[ev.foul] = (stats[ev.foul] ?? 0) + 1; potsPerShot += ev.pocketed.filter((x) => x).length; if (ev.keep) stats.keep = (stats.keep ?? 0) + 1; }
      if (ev.k === 'over') stats[`over: ${ev.reason.replace(/^\w+ /, '')}`] = (stats[`over: ${ev.reason.replace(/^\w+ /, '')}`] ?? 0) + 1;
    }
  }
  if (!e.isOver) stuck++; else wins[e.winner as 'a' | 'b']++;
}
console.log(`${games} games ${A} vs ${B}: wins ${A}=${wins.a} ${B}=${wins.b} · stuck ${stuck} · shots/game ${(shots / games).toFixed(1)} · pots/shot ${(potsPerShot / shots).toFixed(2)} · think ${(thinkMs / shots).toFixed(1)} ms`);
console.log(stats);
