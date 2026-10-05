/**
 * Dev tool: sample a track and print JSON (length, min corner radius, samples) for
 * plotting / sanity checks.  Usage: npx tsx tools/dump-track-layout.ts [trackId]
 */
import { TrackPath } from '../shared/src/track/TrackPath';
import { getTrack } from '../shared/src/tracks/registry';

const p = new TrackPath(getTrack(process.argv[2] ?? 'sunny-circuit'));
const minRadius = Math.min(...p.samples.map((s) => 1 / Math.max(1e-6, Math.abs(s.curvature))));
console.log(
  JSON.stringify({
    length: p.length,
    minRadius,
    samples: p.samples.map((s) => ({
      x: s.position.x, y: s.position.y, z: s.position.z, hw: s.halfWidth, w: s.wallOffset, k: s.curvature, kind: s.kind, curb: s.curb,
    })),
  }),
);
