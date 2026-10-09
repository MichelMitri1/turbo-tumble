/**
 * Headless zombies checks: nav reachability of every window / riser / buyable, an idle
 * player (the horde tears through and downs them), and an auto-fighting player who
 * survives rounds (counts, health, dog rounds, drops), plus the buyables.
 *   npx tsx tools/zombies-sim.ts
 */
import { Game, type GameEvent, type Soldier } from '../client/src/fps/sim/game';
import { NO_INPUT, type Input } from '../client/src/fps/sim/player';
import { NavGrid } from '../client/src/fps/sim/nav';
import { Horde } from '../client/src/fps/sim/horde';
import { DEFAULT_CLASSES } from '../client/src/fps/sim/weapons';

const mk = (n = 1) => new Game('nachtkino', { mode: 'zombies' }, Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, team: 0 as const, bot: false, loadout: DEFAULT_CLASSES[0]! })), 7);

// ---- 1. connectivity (all doors open)
{
  const g = mk();
  const h = g.horde!;
  h.meta.doors.forEach((_, i) => h.openDoor(i, ''));
  const nav = new NavGrid(g.level, g.map.half[0], g.map.half[1]);
  const s = g.soldiers[0]!;
  const home = nav.component(nav.nearest(s.m.x, s.m.y, s.m.z));
  const bad: string[] = [];
  const check = (what: string, x: number, y: number, z: number) => {
    const n = nav.nearest(x, y, z, 1.3);
    const nd = nav.nodes[n];
    if (n < 0 || nav.component(n) !== home || !nd || Math.hypot(nd.x - x, nd.z - z) > 1.2) bad.push(`${what} (${x.toFixed(1)}, ${z.toFixed(1)})`);
  };
  h.meta.windows.forEach((w, i) => check(`window ${i}`, w.x + w.nx * 0.9, 0, w.z + w.nz * 0.9));
  h.meta.spawners.filter((sp) => sp.window < 0).forEach((sp, i) => check(`riser ${i}`, sp.x, 0, sp.z));
  h.meta.wallbuys.forEach((w) => check(`wall ${w.weapon}`, w.x + w.nx * 0.8, w.y > 2.2 ? 1 : 0, w.z + w.nz * 0.8));
  h.meta.perks.forEach((p) => check(`perk ${p.perk}`, p.x + p.nx * 0.9, 0, p.z + p.nz * 0.9));
  h.meta.boxSpots.forEach((b, i) => check(`box ${i}`, b.x + b.nx * 0.9, 0, b.z + b.nz * 0.9));
  check('power', h.meta.power.x + h.meta.power.nx * 0.8, 1, h.meta.power.z + h.meta.power.nz * 0.8);
  check('pap', h.meta.pap.x + h.meta.pap.nx * 1.2, 1, h.meta.pap.z + h.meta.pap.nz * 1.2);
  // Closets: spawners outside must NOT be reachable from inside (players can't leave).
  const leaks = h.meta.spawners.filter((sp) => sp.window >= 0).filter((sp) => nav.component(nav.nearest(sp.x, 0, sp.z)) === home);
  console.log(`1) connectivity: ${bad.length ? 'UNREACHABLE ' + bad.join(', ') : 'all reachable'}; closets leaking inside: ${leaks.length}`);
  // With doors closed, the lobby is sealed: wings unreachable.
  const g2 = mk();
  const nav2 = new NavGrid(g2.level, g2.map.half[0], g2.map.half[1]);
  const s2 = g2.soldiers[0]!;
  const home2 = nav2.component(nav2.nearest(s2.m.x, s2.m.y, s2.m.z));
  const wing = nav2.component(nav2.nearest(-27, 0, 0));
  console.log(`   doors closed: lobby sealed from wings: ${home2 !== wing}`);
}

// ---- 2. idle player: the horde breaks in and downs them
{
  const g = mk();
  const ev: Record<string, number> = {};
  let firstBoard = -1, firstClimb = -1, down = -1;
  for (let i = 0; i < 60 * 120 && g.phase !== 'over'; i++) {
    g.step(new Map([['p0', { ...NO_INPUT, seq: i }]]));
    for (const e of g.events) {
      ev[e.k] = (ev[e.k] ?? 0) + 1;
      if (e.k === 'zboard' && firstBoard < 0) firstBoard = g.time;
      if (e.k === 'zdown' && down < 0) down = g.time;
    }
    g.events.length = 0;
    if (firstClimb < 0 && g.horde!.zombies.some((z) => z.state === 'chase')) firstClimb = g.time;
  }
  console.log(`2) idle: first board torn ${firstBoard.toFixed(1)} s, first zombie inside ${firstClimb.toFixed(1)} s, downed ${down.toFixed(1)} s, phase ${g.phase}, round ${g.horde!.round}`, JSON.stringify(ev));
}

// ---- 3. an auto-fighter: shoots the nearest zombie in sight (aims at the head), rebuilds, keeps rounds going
{
  const g = mk();
  const h = g.horde!;
  const s = g.soldiers[0]!;
  const perRound: Array<{ r: number; count: number; hp: number; secs: number; dog: boolean }> = [];
  let roundStart = 0;
  let spawned = 0;
  let drops: Record<string, number> = {};
  let shots = 0;
  const t0 = performance.now();
  for (let i = 0; i < 60 * 60 * 25 && g.phase !== 'over' && h.round <= 16; i++) {
    // God mode-ish: keep the fighter topped up so we test the director, not the aim.
    s.hp = 100000;
    const w = s.weapons[s.cur];
    if (w.reserve < 50) w.reserve = w.def.reserve;
    const eye = g.eye(s);
    let tgt = null as null | { x: number; y: number; z: number };
    let bd = 25;
    for (const z of h.zombies) {
      if (z.state === 'dead' || z.state === 'rise') continue;
      const d = Math.hypot(z.x - s.m.x, z.z - s.m.z);
      if (d < bd && g.level.visible(eye[0], eye[1], eye[2], z.x, z.y + 1.6, z.z)) {
        bd = d;
        tgt = z.dog ? { x: z.x - Math.sin(z.yaw) * 0.6, y: z.y + 0.62, z: z.z - Math.cos(z.yaw) * 0.6 } : { x: z.x, y: z.y + 1.63, z: z.z };
      }
    }
    const inp: Input = { ...NO_INPUT, seq: i, yaw: s.m.yaw, pitch: s.m.pitch };
    if (tgt) {
      inp.yaw = Math.atan2(-(tgt.x - eye[0]), -(tgt.z - eye[2]));
      inp.pitch = Math.atan2(tgt.y - eye[1], Math.hypot(tgt.x - eye[0], tgt.z - eye[2]));
      inp.fire = i % 6 < 3;
      shots++;
    }
    if (w.ammo === 0) inp.reload = true;
    g.step(new Map([['p0', inp]]));
    for (const e of g.events as GameEvent[]) {
      if (e.k === 'zround') {
        roundStart = g.time;
        spawned = h.toSpawn;
      }
      if (e.k === 'zroundEnd') perRound.push({ r: e.round, count: spawned, hp: Horde.health(e.round), secs: g.time - roundStart, dog: h.dogRound });
      if (e.k === 'zdrop') drops[e.kind] = (drops[e.kind] ?? 0) + 1;
    }
    g.events.length = 0;
  }
  const ms = (performance.now() - t0) / (g.time * 60);
  console.log(`3) fighter reached round ${h.round} (${g.phase}); ${ms.toFixed(3)} ms/tick; points ${s.zm!.points} (earned ${s.zm!.earned}), kills ${s.zm!.kills}, headshots ${s.zm!.headshots}, downs ${s.zm!.downs}`);
  for (const r of perRound) console.log(`   round ${String(r.r).padStart(2)}${r.dog ? ' (dogs)' : '       '}: ${String(r.count).padStart(3)} undead, ${String(r.hp).padStart(5)} hp, ${r.secs.toFixed(0)} s`);
  console.log('   drops', JSON.stringify(drops));
}

// ---- 4. buyables
{
  const g = mk();
  const h = g.horde!;
  const s = g.soldiers[0]!;
  s.zm!.points = 50000;
  const use = (x: number, z: number, nx: number, nz: number, y = 0, d = 0.9) => {
    s.m.x = x + nx * d;
    s.m.z = z + nz * d;
    s.m.y = y;
    s.m.yaw = Math.atan2(nx, nz); // face it
    const ev: string[] = [];
    for (let k = 0; k < 3; k++) {
      g.step(new Map([['p0', { ...NO_INPUT, seq: k, yaw: s.m.yaw, reload: k === 1 }]]));
      for (const e of g.events) if (e.k.startsWith('z')) ev.push(e.k + ('what' in e ? `:${(e as { what: string }).what}` : ''));
      g.events.length = 0;
    }
    return ev.join(',');
  };
  const out: string[] = [];
  const d0 = h.meta.doors[0]!;
  out.push(`door: ${use(d0.x, d0.z, 1, 0, 0, 1.5)} open=${h.doors[0]}`);
  const wb = h.meta.wallbuys.find((w) => w.weapon === 'zm_olympia')!;
  out.push(`wall: ${use(wb.x, wb.z, wb.nx, wb.nz, 0, 0.8)} → ${s.weapons.map((w) => w.def.id).join('+')}`);
  const pr = h.meta.perks.find((p) => p.perk === 'revive')!;
  out.push(`revive perk: ${use(pr.x, pr.z, pr.nx, pr.nz)} perks=${s.zm!.perks}`);
  const pw = h.meta.power;
  h.meta.doors.forEach((_, i) => h.openDoor(i, ''));
  out.push(`power: ${use(pw.x, pw.z, pw.nx, pw.nz, 1, 0.8)} power=${h.power}`);
  const pj = h.meta.perks.find((p) => p.perk === 'jug')!;
  out.push(`jug: ${use(pj.x, pj.z, pj.nx, pj.nz)} perks=${s.zm!.perks}`);
  const b = h.meta.boxSpots[h.boxAt]!;
  out.push(`box: ${use(b.x, b.z, b.nx, b.nz)} state=${h.boxes[h.boxAt]!.state} → ${h.boxes[h.boxAt]!.weapon}`);
  for (let k = 0; k < 60 * 4.5; k++) g.step(new Map([['p0', { ...NO_INPUT, seq: 10 + k, yaw: s.m.yaw }]]));
  g.events.length = 0;
  out.push(`box take: ${use(b.x, b.z, b.nx, b.nz)} → ${s.weapons.map((w) => w.def.id).join('+')} monkeys=${s.zm!.monkeys}`);
  const p = h.meta.pap;
  s.cur = 0;
  out.push(`pap: ${use(p.x, p.z, p.nx, p.nz, 1, 1.2)} state=${h.pap.state} hands=${s.weapons.map((w) => w.def.id).join('+')}`);
  for (let k = 0; k < 60 * 4.5; k++) g.step(new Map([['p0', { ...NO_INPUT, seq: 400 + k, yaw: s.m.yaw }]]));
  g.events.length = 0;
  out.push(`pap take: ${use(p.x, p.z, p.nx, p.nz, 1, 1.2)} → ${s.weapons.map((w) => w.def.id).join('+')}`);
  console.log('4) buyables\n   ' + out.join('\n   ') + `\n   points left ${s.zm!.points}`);
}
