/** Keeper benchmark: shots from typical spots at an unmarked goal. npx tsx tools/football-gk-test.ts [n] */
import { MatchSim, PITCH, type KickType } from '../client/src/football/sim/match';

const N = Number(process.argv[2] ?? 300);
const empty = new Map();
const spots: Array<[string, number, number]> = [
  ['penalty spot 11m', 11, 0],
  ['edge of box 18m', 18, 4],
  ['angle 14m', 13, 12],
  ['long range 25m', 25, -3],
  ['six yard 7m', 7, 3],
];
const types: KickType[] = ['shot', 'finesse', 'power'];
for (const type of types) {
  for (const [name, dist, z0] of spots) {
    let goals = 0, saves = 0, miss = 0, other = 0;
    for (let n = 0; n < N; n++) {
      const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 900, difficulty: 'world', seed: 77 + n * 13 });
      m.phase = 'play';
      m.restart = null;
      const s = m.dir[0];
      const shooter = m.players.find((p) => p.team === 0 && p.role === 'ST')!;
      for (const p of m.players) if (p !== shooter && p.role !== 'GK') { p.x = -s * 40; p.z = p.z * 0.5; }
      shooter.x = s * (PITCH.HL - dist);
      shooter.z = z0;
      shooter.face = s > 0 ? 0 : Math.PI;
      const gk = m.gkOf(1);
      // Let the keeper set himself.
      m.ball.x = shooter.x + s * 0.5; m.ball.z = z0; m.ball.owner = shooter.i;
      for (let i = 0; i < 90; i++) { m.step(empty); m.events.length = 0; if (m.ball.owner !== shooter.i) { m.ball.owner = shooter.i; } shooter.x = s * (PITCH.HL - dist); shooter.z = z0; shooter.vx = shooter.vz = 0; for (const p of m.players) if (p !== shooter && p.role !== 'GK') { p.x = -s * 40; } }
      const aim = (process.env.CORNERS ? (m.rand() < 0.5 ? -1 : 1) * (0.65 + m.rand() * 0.3) : (m.rand() - 0.5) * 2);
      m.startKick(shooter, type, 0.55 + m.rand() * 0.4, s, aim);
      let res = '';
      for (let i = 0; i < 60 * 4 && !res; i++) {
        m.step(empty);
        for (const e of m.events) {
          if (e.k === 'goal') res = 'goal';
          if (e.k === 'save') res = 'save';
          if (e.k === 'out' || e.k === 'post') res = res || 'miss';
        }
        m.events.length = 0;
        if (!res && m.ball.owner === gk.i) res = 'save';
      }
      if (res === 'goal') goals++; else if (res === 'save') saves++; else if (res === 'miss') miss++; else other++;
    }
    const onT = goals + saves;
    console.log(`${type.padEnd(8)} ${name.padEnd(18)} goals ${goals} saves ${saves} miss ${miss} other ${other}  save% of on-target ${((saves / Math.max(1, onT)) * 100).toFixed(0)}`);
  }
}
