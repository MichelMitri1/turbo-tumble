/**
 * Passing test: a scripted human passes to random team-mates (random distance, aim error and
 * power) and we check the receiver actually gets the ball.
 *   npx tsx tools/football-pass-test.ts [trials=300]
 * Modes: stick left neutral after the pass / stick still held in the passing direction.
 * Run with no opponents (pure mechanics) and in a live match (opponents can intercept).
 */
import { MatchSim, NO_INPUT, type Input, type KickType } from '../client/src/football/sim/match';

const N = Number(process.argv[2] ?? 300);
type Outcome = 'received' | 'mate' | 'opp' | 'out' | 'loose' | 'nokick';

function trial(seed: number, btn: 'pass' | 'through' | 'lob', after: 'neutral' | 'hold', opponents: boolean): { o: Outcome; d: number; type: KickType | null; open?: boolean } {
  const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 900, difficulty: 'pro', seed });
  const h = m.addHuman('me', 0);
  let clear = false;
  const go = (inp: Partial<Input>) => {
    // "No opponents": park the other XI well off the pitch every tick.
    if (clear) for (const p of m.players) if (p.team === 1) Object.assign(p, { x: -40 + p.slot * 7, z: -60, vx: 0, vz: 0 });
    m.step(new Map([['me', { ...NO_INPUT, ...inp }]]));
    return m.events.splice(0);
  };
  let t = 0;
  while (m.phase !== 'play' && t++ < 3000) go({ pass: t % 20 < 3 });
  // Let the match flow a few seconds so everyone is in a natural shape.
  for (let i = 0; i < 60 * (2 + (seed % 5)); i++) go({});
  if (m.phase !== 'play') return { o: 'nokick', d: 0, type: null };
  clear = !opponents;
  const me = m.players[h.p]!;
  m.ball.owner = me.i;
  m.gained(me);
  const rnd = m.rand;
  const mates = m.teamPlayers(0).filter((q) => q !== me && q.role !== 'GK' && Math.hypot(q.x - me.x, q.z - me.z) > 6 && Math.hypot(q.x - me.x, q.z - me.z) < (btn === 'pass' ? 30 : 45) && (btn !== 'through' || (q.x - me.x) * m.dir[0] > 4));
  if (!mates.length) return { o: 'nokick', d: 0, type: null };
  const mate = mates[Math.floor(rnd() * mates.length)]!;
  // "Open": no opponent within 4 m of the receiver, nor near the straight line to him.
  const open = m.teamPlayers(1).every((q) => {
    const dx = mate.x - me.x, dz = mate.z - me.z, L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((q.x - me.x) * dx + (q.z - me.z) * dz) / L2));
    return Math.hypot(q.x - mate.x, q.z - mate.z) > 4 && Math.hypot(q.x - (me.x + dx * t), q.z - (me.z + dz * t)) > 2.5;
  });
  const err = (rnd() - 0.5) * (Math.PI / 180) * 30; // ±15° aim error
  const a0 = Math.atan2(mate.z - me.z, mate.x - me.x) + err;
  const sx = Math.cos(a0);
  const sz = Math.sin(a0);
  const hold = 3 + Math.floor(rnd() * 22); // 0.05 – 0.4 s of charge
  for (let i = 0; i < hold; i++) go({ [btn]: true, mx: sx, mz: sz });
  let kicked = false;
  let target = -1;
  let type: KickType | null = null;
  for (let i = 0; i < 60 * 5; i++) {
    const inp: Partial<Input> = after === 'hold' ? { mx: sx, mz: sz } : {};
    for (const e of go(inp)) {
      if (e.k === 'kick' && e.p === me.i) {
        kicked = true;
        target = m.lastPass?.to ?? -1;
        type = e.type;
      }
      if (!kicked) continue;
      if (e.k === 'touch' && !e.heavy) {
        const p = m.players[e.p]!;
        return { o: p.i === target ? 'received' : p.team === 0 ? 'mate' : 'opp', d: Math.hypot(mate.x - me.x, mate.z - me.z), type, open };
      }
      if (e.k === 'restart' || e.k === 'out') return { o: 'out', d: 0, type, open };
    }
  }
  return { o: kicked ? 'loose' : 'nokick', d: 0, type, open };
}

for (const opponents of [false, true]) {
  for (const btn of ['pass', 'through', 'lob'] as const) {
    for (const after of ['neutral', 'hold'] as const) {
      const tally: Record<string, number> = {};
      const openT = [0, 0];
      const markedT = [0, 0];
      for (let i = 0; i < N; i++) {
        const r = trial(1000 + i, btn, after, opponents);
        tally[r.o] = (tally[r.o] ?? 0) + 1;
        if (r.o !== 'nokick' && opponents) {
          const t = r.open ? openT : markedT;
          t[1]++;
          if (r.o === 'received') t[0]++;
        }
      }
      const kicked = N - (tally.nokick ?? 0);
      const pct = (k: string) => (((tally[k] ?? 0) / Math.max(1, kicked)) * 100).toFixed(0).padStart(3);
      console.log(`${opponents ? 'live match ' : 'no opponents'}  ${btn.padEnd(7)} stick ${after.padEnd(7)}  received ${pct('received')}%  other mate ${pct('mate')}%  intercepted ${pct('opp')}%  out ${pct('out')}%  loose ${pct('loose')}%   (n=${kicked})${opponents ? `   open receiver ${((openT[0] / Math.max(1, openT[1])) * 100).toFixed(0)}% of ${openT[1]}, marked ${((markedT[0] / Math.max(1, markedT[1])) * 100).toFixed(0)}% of ${markedT[1]}` : ''}`);
    }
  }
}
