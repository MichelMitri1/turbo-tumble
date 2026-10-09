/** Headless Starfall: bots-only games on every map. npx tsx tools/starfall-sim.ts [games=12] */
import { Game, DEFAULT_CONFIG, TICK } from '../client/src/starfall/sim/game';
import { Bots } from '../client/src/starfall/sim/bots';
import { MAPS } from '../client/src/starfall/sim/maps';

const N = Number(process.argv[2] ?? 12);
for (const m of MAPS) {
  const res = { crew: 0, impostor: 0, none: 0 };
  const why: Record<string, number> = {};
  let meetings = 0, kills = 0, ejects = 0, rightEjects = 0, sabs = 0, fixes = 0, mins = 0, ms = 0, stuck = 0;
  for (let k = 0; k < N; k++) {
    const people = Array.from({ length: 10 }, (_, i) => ({ name: `B${i}`, color: i, bot: true }));
    const g = new Game({ ...DEFAULT_CONFIG, map: m.id, impostors: 2 }, people, 100 + k);
    const bots = new Bots(g);
    const t0 = performance.now();
    let ticks = 0;
    const lastPos = g.players.map((p) => [p.x, p.y, 0]);
    while (g.phase !== 'over' && g.time < 60 * 25) {
      bots.update(TICK);
      g.step(TICK);
      const ev = g.events.splice(0);
      bots.events(ev);
      for (const e of ev) {
        if (e.k === 'meeting') meetings++;
        if (e.k === 'kill') kills++;
        if (e.k === 'eject' && e.id >= 0) { ejects++; if (e.impostor) rightEjects++; }
        if (e.k === 'sabotage') sabs++;
        if (e.k === 'fixed') fixes++;
      }
      ticks++;
      if (ticks % 300 === 0 && g.phase === 'play') g.players.forEach((p, i) => {
        const l = lastPos[i]!;
        if (p.alive && !p.impostor && Math.hypot(p.x - l[0]!, p.y - l[1]!) < 0.05 && !p.busy && p.tasks.some((t) => !t.done)) l[2]!++;
        else l[2] = 0;
        if (l[2]! >= 4) { stuck++; l[2] = -99; }
        l[0] = p.x; l[1] = p.y;
      });
    }
    ms += (performance.now() - t0) / ticks;
    mins += g.time / 60;
    if (g.winner) res[g.winner]++; else res.none++;
    why[g.why || 'timeout'] = (why[g.why || 'timeout'] ?? 0) + 1;
  }
  console.log(`${m.id.padEnd(10)} crew ${res.crew} / impostor ${res.impostor} / unfinished ${res.none} · avg ${(mins / N).toFixed(1)} min · kills ${(kills / N).toFixed(1)} meetings ${(meetings / N).toFixed(1)} ejects ${(ejects / N).toFixed(1)} (impostor ${rightEjects}/${ejects}) · sabotages ${sabs} fixed ${fixes} · stuck crew ${stuck} · ${ms.toFixed(3)} ms/tick`);
  console.log('   ', JSON.stringify(why));
}
