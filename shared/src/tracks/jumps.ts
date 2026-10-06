import { TrackPath } from '../track/TrackPath';
import type { TrackDefinition } from '../types/track';

/** Place authored jump beats on nearby open stretches, with clear run-ups and landings. */
export function addCourseJumps(def: TrackDefinition, fractions: number[], launchSpeed = 16): TrackDefinition {
  const path = new TrackPath(def);
  const L = path.length;
  const gap = (a: number, b: number): number => Math.abs(((a - b + L * 1.5) % L) - L / 2);
  for (const fraction of fractions) {
    let best = -1;
    let score = Infinity;
    for (let d = 150; d < L - 130; d += 8) {
      if (def.jumps.some((j) => gap(j.distance, d) < 240)) continue;
      const frames = [-25, 0, 20, 40, 60, 85].map((o) => path.frameAtSplineDistance(path.startDistance + d + o));
      if (frames.some((f) => f.sample.kind === 'tunnel')) continue;
      const turn = Math.max(...frames.map((f) => Math.acos(Math.min(1, f.tangent.dot(frames[2]!.tangent)))));
      if (turn > 0.55) continue;
      const cost = gap(d, fraction * L) + turn * 150;
      if (cost < score) { best = d; score = cost; }
    }
    if (best < 0) throw new Error(`No clear jump approach on ${def.id}`);
    const width = Math.min(11, ...[0, 10, 20].map((o) => path.frameAtSplineDistance(path.startDistance + best + o).halfWidth * 2 - 2));
    def.jumps.push({ distance: best, length: 20, width, rise: 3.4, launchSpeed });
  }
  const inJump = (distance: number): boolean => def.jumps.some((j) => {
    const ahead = path.wrapDistance(distance - j.distance + 45);
    return ahead < 160;
  });
  // Keep obstacles and pickups out of takeoff/landing zones. Obstacles retain
  // their authored left/right rhythm after being moved farther along the lap.
  for (const hazard of def.hazards) {
    for (let i = 0; i < 100 && (inJump(hazard.distance) || def.hazards.some((h) => h !== hazard && gap(h.distance, hazard.distance) < 30)); i++) {
      hazard.distance = path.wrapDistance(hazard.distance + 24);
    }
  }
  def.boostPads = def.boostPads.filter((p) => !inJump(p.distance));
  // Longer laps need regular item battles, including after the landing zones.
  const rowCount = L > 2000 ? 5 : 4;
  while (def.itemBoxes.length < rowCount) def.itemBoxes.push({ distance: L * (def.itemBoxes.length + 0.5) / rowCount, count: 4, spacing: 3.2 });
  for (const row of def.itemBoxes) {
    for (let i = 0; i < 150 && (inJump(row.distance) || def.hazards.some((h) => gap(h.distance, row.distance) < 30) || def.itemBoxes.some((r) => r !== row && gap(r.distance, row.distance) < 80)); i++) {
      row.distance = path.wrapDistance(row.distance + 24);
    }
    row.spacing = Math.min(row.spacing, (path.anchorToWorld(row).halfWidth - 1) * 2 / (row.count - 1));
  }
  def.coins = def.coins.filter((p) => !inJump(p.distance) && !inJump(p.distance + (p.count - 1) * p.spacing));
  for (const jump of def.jumps) {
    def.boostPads.push({ distance: jump.distance - 13, lateral: 0, length: 14, width: jump.width });
    // A readable airborne coin arc shows where to aim the jump.
    const lip = path.anchorToWorld({ distance: jump.distance + jump.length }).position;
    for (let i = 1; i <= 5; i++) {
      const t = i * 0.16;
      const distance = jump.distance + jump.length + 42 * t;
      const road = path.anchorToWorld({ distance }).position;
      def.coins.push({ distance, count: 1, spacing: 1, height: Math.max(1, lip.y + jump.rise + launchSpeed * t - 16 * t * t - road.y) });
    }
  }
  return def;
}
