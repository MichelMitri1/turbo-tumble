/**
 * Headless Zero Hour bot matches: every map × mode, checks the sim doesn't stall,
 * bots move / fight / score, nobody falls out of the map, and the tick cost.
 *   npx tsx tools/fps-sim.ts [seconds=120] [--skill=regular] [--size=6]
 */
import { Game, type Mode, type SoldierSetup } from '../client/src/fps/sim/game';
import { BotBrain, type BotSkill } from '../client/src/fps/sim/bots';
import { MAPS } from '../client/src/fps/sim/maps';
import { DEFAULT_CLASSES } from '../client/src/fps/sim/weapons';
import type { Input } from '../client/src/fps/sim/player';
const args = process.argv.slice(2);
const secs = Number(args.find((a) => !a.startsWith('--')) ?? 120);
const skill = (args.find((a) => a.startsWith('--skill='))?.split('=')[1] ?? 'regular') as BotSkill;
const size = Number(args.find((a) => a.startsWith('--size='))?.split('=')[1] ?? 6);
for (const map of MAPS) {
  for (const mode of ['tdm', 'dom', 'ffa', 'kc'] as Mode[]) {
    const setups: SoldierSetup[] = [];
    for (let i = 0; i < size * 2; i++) setups.push({ id: `b${i}`, name: `Bot${i}`, team: (i % 2) as 0 | 1, bot: true, loadout: DEFAULT_CLASSES[i % DEFAULT_CLASSES.length]! });
    const t0 = performance.now();
    const g = new Game(map.id, { mode, timeLimit: secs + 5, scoreLimit: 9999 }, setups, 42);
    const brains = new BotBrain(g, skill);
    const tNav = performance.now() - t0;
    const inputs = new Map<string, Input>();
    let shots = 0, kills = 0, escapes = 0, grenades = 0, streaks = 0, explosions = 0, flags = 0, tags = 0;
    const tl = performance.now();
    const moved = new Map<string, number>();
    const last = new Map<string, [number, number]>();
    for (let t = 0; t < secs * 60; t++) {
      inputs.clear();
      brains.update(1 / 60, inputs);
      g.step(inputs);
      for (const e of g.events.splice(0)) {
        if (e.k === 'shot') shots++;
        if (e.k === 'kill') kills++;
        if (e.k === 'grenadeThrow') grenades++;
        if (e.k === 'streakUsed') streaks++;
        if (e.k === 'explosion') explosions++;
        if (e.k === 'flag') flags++;
        if (e.k === 'tag') tags++;
      }
      for (const s of g.soldiers) {
        if (!s.alive) continue;
        if (Math.abs(s.m.x) > map.half[0] + 1 || Math.abs(s.m.z) > map.half[1] + 1 || s.m.y < -1 || s.m.y > 20) { escapes++; s.alive = false; s.respawnIn = 0.1; }
        const lp = last.get(s.id);
        if (lp) moved.set(s.id, (moved.get(s.id) ?? 0) + Math.hypot(s.m.x - lp[0], s.m.z - lp[1]));
        last.set(s.id, [s.m.x, s.m.z]);
      }
    }
    const ms = performance.now() - tl;
    const avgMove = [...moved.values()].reduce((a, b) => a + b, 0) / g.soldiers.length;
    const minMove = Math.min(...moved.values());
    console.log(`${map.id.padEnd(9)} ${mode.padEnd(4)} nav ${tNav.toFixed(0)}ms (${brains.nav.nodes.length} nodes) · score ${g.score.join('-')} · kills ${kills} shots ${shots} nades ${grenades} streaks ${streaks} boom ${explosions} flags ${flags} tags ${tags} · escapes ${escapes} · move avg ${avgMove.toFixed(0)}m min ${minMove.toFixed(0)}m · ${(ms / (secs * 60) * 1000).toFixed(0)} µs/tick`);
  }
}
