import { freight } from './maps/freight';
import { culdesac } from './maps/culdesac';
import { outpost } from './maps/outpost';
import { atomic } from './maps/atomic';
import { manor } from './maps/manor';
import { downtown } from './maps/downtown';
import { wreckage } from './maps/wreckage';
import { terminal } from './maps/terminal';
import { refinery } from './maps/refinery';
import { farmstead } from './maps/farmstead';
import { nachtkino } from './maps/nachtkino';
import type { ZMapMeta } from './zmap';
import { Level } from './level';
import { P } from './player';
import type { MapDef, SpawnPoint } from './mapkit';

export type { Backdrop, MapDef, MapTheme, PropPlacement, SpawnPoint } from './mapkit';

/**
 * Up to 9 a side: grow each spawn list with free spots beside the hand-placed ones
 * (sideways along the spawn's facing, then a step back), on the same floor.
 */
function moreSpawns(m: MapDef): MapDef {
  const level = new Level(m.boxes);
  const [hx, hz] = m.half;
  const r = P.radius + 0.1;
  const ok = (x: number, y: number, z: number) =>
    Math.abs(x) < hx - 1 && Math.abs(z) < hz - 1 && !level.blocked(x - r, y + 0.1, z - r, x + r, y + P.height, z + r) && Math.abs(level.floorAt(x, z, y + 0.3, 0.2) - y) < 0.05;
  const grow = (list: SpawnPoint[], want: number): SpawnPoint[] => {
    const out = [...list];
    for (const off of [[1.8, 0], [-1.8, 0], [0, 2], [3.6, 0], [-3.6, 0], [1.8, 2], [-1.8, 2]]) {
      for (const p of list) {
        if (out.length >= want) return out;
        // The sim's yaw: facing (−sin, −cos); right = (cos, −sin).
        const rx = Math.cos(p.yaw);
        const rz = -Math.sin(p.yaw);
        const bx = Math.sin(p.yaw);
        const bz = Math.cos(p.yaw);
        const x = p.x + rx * off[0]! + bx * off[1]!;
        const z = p.z + rz * off[0]! + bz * off[1]!;
        if (ok(x, p.y, z) && out.every((q) => Math.hypot(q.x - x, q.z - z) > 1.2)) out.push({ x, y: p.y, z, yaw: p.yaw });
      }
    }
    return out;
  };
  return { ...m, spawns: [grow(m.spawns[0], 12), grow(m.spawns[1], 12)], ffa: grow(m.ffa, 16) };
}

/** Multiplayer maps (each built from boxes + props, see mapkit.ts). */
export const MAPS: MapDef[] = [atomic(), freight(), culdesac(), downtown(), wreckage(), terminal(), refinery(), farmstead(), manor(), outpost()].map(moreSpawns);
/** Zombies maps (not in the multiplayer rotation): the MapDef plus its zombies layout. */
const NK = nachtkino();
export const ZMAPS: Array<{ map: MapDef; z: ZMapMeta }> = [NK];
export const ZMAP = Object.fromEntries(ZMAPS.map((m) => [m.map.id, m.z])) as Record<string, ZMapMeta>;
export const MAP = Object.fromEntries([...MAPS, ...ZMAPS.map((m) => m.map)].map((m) => [m.id, m])) as Record<string, MapDef>;
