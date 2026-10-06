/**
 * Finds places where the terrain mesh pokes through the road surface.
 *   npx tsx tools/check-terrain.ts [trackId…]
 */
import { TRACKS } from '../shared/src/tracks/registry';
import { TrackPath } from '../shared/src/track/TrackPath';
import { TerrainField } from '../shared/src/track/TerrainField';

const only = process.argv.slice(2);
let bad = 0;
for (const def of TRACKS) {
  if (only.length && !only.includes(def.id)) continue;
  if (def.space) continue;
  const path = new TrackPath(def);
  const terrain = new TerrainField(path, def.terrain);
  terrain.buildMesh();
  const spots = new Map<number, { n: number; worst: number; lat: number }>();
  for (let i = 0; i < path.samples.length; i++) {
    const s = path.samples[i]!;
    if (s.kind === 'tunnel' || s.gap) continue;
    for (const f of [-1, -0.6, -0.3, 0, 0.3, 0.6, 1]) {
      const lat = f * (s.halfWidth + 0.3);
      const x = s.position.x + s.flatRight.x * lat;
      const z = s.position.z + s.flatRight.z * lat;
      const roadY = s.position.y + s.right.y * lat;
      const over = terrain.sample(x, z) - roadY;
      if (over > 0.08) {
        const d = Math.round(path.lapDistance(i * path.spacing) / 20) * 20;
        const e = spots.get(d) ?? { n: 0, worst: 0, lat };
        e.n++;
        if (over > e.worst) {
          e.worst = over;
          e.lat = lat;
        }
        spots.set(d, e);
      }
    }
  }
  if (spots.size) bad++;
  const list = [...spots.entries()].sort((a, b) => b[1].worst - a[1].worst).slice(0, 8);
  console.log(`${spots.size ? '✗' : '✓'} ${def.id.padEnd(18)} ${spots.size ? list.map(([d, e]) => `${d}m +${e.worst.toFixed(2)} (lat ${e.lat.toFixed(1)}, ×${e.n})`).join('  ') : 'clean'}`);
}
process.exit(bad ? 1 : 0);
