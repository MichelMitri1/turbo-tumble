/**
 * Headless padel matches between bots: how long rallies last, how points end, which shots get played.
 *   npx tsx tools/padel-sim.ts [matches=4] [--a=intermediate] [--b=intermediate] [--size=2] [--games=4] [--sets=1] [--v]
 */
import { MatchSim, TICK, type Input, type PlayerDef, type MatchEvent } from '../client/src/padel/sim/match';
import type { Level } from '../client/src/padel/sim/ai';

const args = process.argv.slice(2);
const flag = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const matches = Number(args.find((a) => !a.startsWith('--')) ?? 4);
const la = flag('a', 'intermediate') as Level;
const lb = flag('b', 'intermediate') as Level;
const size = Number(flag('size', '2'));
const verbose = args.includes('--v');

const why: Record<string, number> = {};
const shots: Record<string, number> = {};
const faults: Record<string, number> = {};
let rallies = 0;
let hitsTotal = 0;
let points = 0;
let wins = [0, 0];
const ptsWon = [0, 0];
const serveWon = [0, 0];
const serveTot = [0, 0];
let simSecs = 0;
const t0 = performance.now();
for (let n = 0; n < matches; n++) {
  const players: PlayerDef[] = [];
  for (const team of [0, 1] as const) for (let s = 0; s < size; s++) players.push({ id: `${team}${s}`, name: `P${team}${s}`, team, slot: s as 0 | 1, human: false, racket: ['halo', 'tempest', 'viper'][(n + s) % 3]!, level: team === 0 ? la : lb });
  const m = new MatchSim({ players, format: { games: Number(flag('games', '4')) as 4 | 6, sets: Number(flag('sets', '1')) as 1 | 3, golden: true }, seed: 1000 + n * 77 });
  const inputs = new Map<string, Input>();
  let hits = 0;
  const log: string[] = [];
  while (m.phase !== 'over' && m.time < 60 * 40) {
    m.step(inputs);
    for (const e of m.events as MatchEvent[]) {
      if (e.k === 'hit') {
        hits++;
        shots[e.shot] = (shots[e.shot] ?? 0) + 1;
        if (verbose) log.push(`${m.time.toFixed(1)} hit P${e.p} ${e.shot} ${e.power.toFixed(2)} @${e.x.toFixed(1)},${e.y.toFixed(1)},${e.z.toFixed(1)}`);
      }
      if (e.k === 'fault') faults[e.why] = (faults[e.why] ?? 0) + 1;
      if (e.k === 'point') {
        why[e.why] = (why[e.why] ?? 0) + 1;
        ptsWon[e.team]!++;
        const st = m.players[m.server]!.team;
        serveTot[st]!++;
        if (e.team === st) serveWon[st]!++;
        rallies++;
        points++;
        hitsTotal += hits;
        if (verbose) log.push(`${m.time.toFixed(1)} POINT team ${e.team} (${e.why}) after ${hits} hits · ${m.pointLabel(0)}-${m.pointLabel(1)} games ${m.score.games.join('-')}`);
        hits = 0;
      }
    }
    m.events.length = 0;
  }
  simSecs += m.time;
  if (m.winner >= 0) wins[m.winner]!++;
  if (verbose) console.log(log.slice(0, 80).join('\n'));
  console.log(`match ${n}: ${m.winner >= 0 ? `team ${m.winner} wins` : 'unfinished'} sets ${m.score.sets.join('-')} (${m.score.history.map((h) => h.join('-')).join(', ')}) in ${(m.time / 60).toFixed(1)} min`);
}
console.log(`\n${la} (team 0) vs ${lb} (team 1): ${wins[0]}-${wins[1]} · ${points} points · ${(hitsTotal / Math.max(1, rallies)).toFixed(1)} hits per rally · ${(simSecs / Math.max(1, points)).toFixed(1)} s per point`);
console.log(`points won by side: team 0 ${ptsWon[0]} · team 1 ${ptsWon[1]} · serving team won ${(((serveWon[0]! + serveWon[1]!) / Math.max(1, serveTot[0]! + serveTot[1]!)) * 100).toFixed(0)}% (team 0 serving ${((serveWon[0]! / Math.max(1, serveTot[0]!)) * 100).toFixed(0)}%, team 1 ${((serveWon[1]! / Math.max(1, serveTot[1]!)) * 100).toFixed(0)}%)`);
console.log('points end:', JSON.stringify(why));
console.log('shots:', JSON.stringify(shots));
console.log('faults:', JSON.stringify(faults));
console.log(`${(((performance.now() - t0) / (simSecs / TICK)) * 1000).toFixed(1)} µs per tick`);
