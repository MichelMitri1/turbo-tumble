/** Headless CPU-vs-CPU matches: npx tsx tools/football-sim.ts [games] */
import { MatchSim } from '../client/src/football/sim/match';
import { CLUBS } from '../client/src/football/sim/data';

const games = Number(process.argv[2] ?? 10);
const tot = { goals: 0, shots: 0, onT: 0, saves: 0, corners: 0, fouls: 0, offs: 0, pens: 0, throws: 0, gk: 0, passes: 0, done: 0, ms: 0, stuck: 0 };
const empty = new Map();
for (let g = 0; g < games; g++) {
  const a = CLUBS[g % CLUBS.length]!;
  const b = CLUBS[(g * 3 + 1) % CLUBS.length]!;
  const m = new MatchSim({ home: a.id, away: b.id === a.id ? CLUBS[(g + 1) % CLUBS.length]!.id : b.id, halfSeconds: 180, difficulty: 'world', seed: 1000 + g });
  const t0 = performance.now();
  let ticks = 0;
  let still = 0;
  let maxStill = 0;
  let lastX = 0;
  while (m.phase !== 'fulltime' && ticks < 60 * 60 * 12) {
    m.step(empty);
    ticks++;
    for (const e of m.events) {
      if (e.k === 'restart') {
        if (e.kind === 'penalty') tot.pens++;
        if (e.kind === 'throw') tot.throws++;
        if (e.kind === 'goalkick') tot.gk++;
      }
    }
    m.events.length = 0;
    if (Math.abs(m.ball.x - lastX) < 0.01 && m.phase === 'play') still++;
    else still = 0;
    maxStill = Math.max(maxStill, still);
    lastX = m.ball.x;
    for (const p of m.players) if (!Number.isFinite(p.x) || !Number.isFinite(m.ball.x)) throw new Error('NaN');
  }
  const ms = (performance.now() - t0) / ticks;
  const [s0, s1] = m.stats;
  const poss = (s0.possession / (s0.possession + s1.possession || 1)) * 100;
  console.log(`${m.clubs[0].short} ${m.score[0]}-${m.score[1]} ${m.clubs[1].short}  shots ${s0.shots}/${s1.shots} onT ${s0.onTarget}/${s1.onTarget} poss ${poss.toFixed(0)}% pass ${s0.passesDone}/${s0.passes} ${s1.passesDone}/${s1.passes} corners ${s0.corners + s1.corners} fouls ${s0.fouls + s1.fouls} off ${s0.offsides + s1.offsides} saves ${s0.saves + s1.saves} maxStill ${(maxStill / 60).toFixed(1)}s ${ms.toFixed(3)}ms/tick ${m.phase}`);
  tot.goals += m.score[0] + m.score[1];
  tot.shots += s0.shots + s1.shots;
  tot.passes += s0.passes + s1.passes;
  tot.done += s0.passesDone + s1.passesDone;
  if (maxStill > 600) tot.stuck++;
}
console.log(`avg goals ${(tot.goals / games).toFixed(2)} shots ${(tot.shots / games).toFixed(1)} pass% ${((tot.done / tot.passes) * 100).toFixed(0)} pens ${tot.pens} throws/g ${(tot.throws / games).toFixed(1)} gk/g ${(tot.gk / games).toFixed(1)} stuck ${tot.stuck}`);
