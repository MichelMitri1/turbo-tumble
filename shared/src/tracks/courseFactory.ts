import type { HillDefinition, LakeDefinition, LandmarkPlacement, PropPlacement, RoadStyle, ShortcutDefinition, TrackDefinition, TrackDifficulty } from '../types/track';
import { SeededRandom } from '../math/random';
import { TrackPath } from '../track/TrackPath';
import { compileCourse, type Seg } from './course';
import { THEMES } from './themes';

/** Road half-width by difficulty (segments can override with `w`). */
const WIDTH: Record<TrackDifficulty, number> = { easy: 10.5, medium: 9, hard: 7.6 };

export interface CourseSpec {
  id: string;
  name: string;
  theme: keyof typeof THEMES;
  difficulty: TrackDifficulty;
  seed: number;
  segs: Seg[];
  /** Shortcuts between two named marks (cut across on `side`). */
  shortcuts?: Array<{ from: string; to: string; side: 'left' | 'right'; toSide?: 'left' | 'right'; bulge?: number; boost?: boolean; halfWidth?: number }>;
  roadStyle?: RoadStyle;
  /** Floating course: no ground anywhere (sky / space). */
  space?: boolean;
  startHeight?: number;
  /** Extra scenery (world coordinates). */
  lakes?: LakeDefinition[];
  hills?: HillDefinition[];
  music?: string;
  /** Hide the crowd / pits at the start (e.g. wild courses). */
  noCrowd?: boolean;
  /** Slow traffic driving round the lap (cars, carts, buses — themed). */
  traffic?: { count: number; speed: number };
}

/**
 * A full track from a course description (course.ts) + theme: terrain sized to
 * the layout, item boxes / coins spread over the lap (clear of jumps, gaps and
 * hazards), start area, billboards and scenery.
 */
export function defineCourse(spec: CourseSpec): TrackDefinition {
  const theme = THEMES[spec.theme]!;
  const course = compileCourse(spec.segs, spec.startHeight ?? 2, spec.id);
  const b = course.bounds;
  const rng = new SeededRandom(spec.seed);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const size = Math.max(1000, Math.ceil((extent + 600) / 50) * 50);
  const halfWidth = WIDTH[spec.difficulty];

  const hills: HillDefinition[] = [...(spec.hills ?? []), ...(spec.space ? [] : course.hills)];
  if (!spec.space) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const d = extent / 2 + rng.range(150, 250);
      hills.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, radius: rng.range(100, 150), height: rng.range(18, 36) });
    }
  }
  const lakes: LakeDefinition[] = spec.space || !theme.lakes ? [] : [...(spec.lakes ?? []), ...course.lakes.map((l) => ({ x: l.x, z: l.z, radiusX: l.r, radiusZ: l.r, depth: 6 }))];

  const crowd: LandmarkPlacement[] =
    theme.noCrowd || spec.noCrowd || spec.space
      ? []
      : [
          { type: 'grandstand', anchor: { distance: -6, side: 'left', wallOffset: 2.5, length: 70 }, params: { roof: true, tiers: 6 } },
          { type: 'pitRow', anchor: { distance: 40, side: 'right', wallOffset: 4, length: 34 } },
        ];
  const scenery: LandmarkPlacement[] = [];
  if (theme.mountains && !spec.space) scenery.push({ type: 'mountains', params: { radius: Math.max(760, extent / 2 + 420), count: 34, low: theme.mountains.low, mid: theme.mountains.mid, peak: theme.mountains.peak, snow: Boolean(theme.mountains.snow) } });
  if (theme.sky.clouds > 0) scenery.push(spec.space ? { type: 'clouds', params: { minY: b.minY - 140, maxY: b.minY - 40 } } : { type: 'clouds' });

  const def: TrackDefinition = {
    id: spec.id,
    name: spec.name,
    theme: theme.id,
    laps: 3,
    difficulty: spec.difficulty,
    ...(spec.roadStyle ? { roadStyle: spec.roadStyle } : {}),
    ...(spec.space ? { space: true } : {}),
    path: { points: course.points, defaultHalfWidth: halfWidth, defaultShoulder: spec.difficulty === 'hard' ? 4 : 6, sampleSpacing: 2, autoBankDeg: 7, curbWidth: 1.4 },
    startDistance: course.startDistance,
    spawnGrid: { firstRowOffset: 7, rowSpacing: 7.5, columns: [-3.6, 3.6], stagger: 3.2 },
    checkpointCount: Math.max(16, Math.round(course.length / 90)),
    terrain: {
      seed: spec.seed,
      size,
      resolution: Math.min(400, Math.round(size / 3.3)),
      baseHeight: 0.5,
      noiseAmplitude: theme.noiseAmplitude,
      noiseScale: 1 / 140,
      blendDistance: 34,
      hills,
      lakes,
      waterLevel: lakes.length ? -0.6 : null,
      ...(theme.liquid ? { liquid: theme.liquid } : {}),
      palette: theme.palette,
    },
    lighting: theme.lighting,
    sky: theme.sky,
    decor: {
      landmarks: [{ type: 'startGantry', anchor: { distance: 0 } }, ...crowd, ...(theme.landmarks?.(course.length) ?? []), ...scenery],
      props: spec.space ? [] : [{ model: 'flagCheckers', distance: -8, side: 'right', wallOffset: 1, scale: 8, yaw: 90 }, { model: 'flagCheckers', distance: 8, side: 'right', wallOffset: 1, scale: 8, yaw: 90 }, ...((theme.props?.(course.length) ?? []) as PropPlacement[])],
      scatter: spec.space ? [] : theme.scatter(spec.seed * 10),
    },
    minimap: { rotation: 0 },
    music: spec.music ?? theme.music,
    boostPads: [],
    jumps: [],
    gaps: [],
    streams: [],
    movers: [],
    itemBoxes: [],
    coins: [],
    hazards: [],
    shortcuts: (spec.shortcuts ?? []).map(
      (sc) => ({ from: 0, to: 0, side: sc.side, ...(sc.toSide ? { toSide: sc.toSide } : {}), bulge: sc.bulge ?? 0, halfWidth: sc.halfWidth ?? 5, boost: sc.boost, fromMark: sc.from, toMark: sc.to }) as ShortcutDefinition,
    ),
  };
  course.resolve(def);

  if (spec.traffic) {
    for (let i = 0; i < spec.traffic.count; i++) {
      def.movers!.push({ kind: 'cruiser', distance: Math.round(((i + 0.5) * course.length) / spec.traffic.count), lateral: (i % 2 ? 1 : -1) * halfWidth * 0.45, period: 1, phase: 0, size: 1.4, speed: spec.traffic.speed });
    }
  }

  // Pickups: spread over the lap, clear of jumps / gaps / hazards / shortcut mouths.
  const path = new TrackPath(def);
  const L = path.length;
  const near = (a: number, b2: number): number => Math.min(Math.abs(a - b2), L - Math.abs(a - b2));
  const busy = (d: number): boolean =>
    def.jumps.some((j) => near(j.distance + 15, d) < 70) ||
    def.gaps!.some((g) => near(g.distance + g.length / 2, d) < 60) ||
    def.hazards.some((h) => near(h.distance, d) < 30) ||
    def.boostPads.some((p) => near(p.distance, d) < 25) ||
    def.movers!.some((m) => m.kind !== 'cruiser' && near(m.distance, d) < 30) ||
    def.shortcuts.some((sc) => near(sc.from, d) < 30 || near(sc.to, d) < 30) ||
    path.frameAtSplineDistance(path.startDistance + d).sample.kind === 'tunnel';
  const place = (f: number): number => {
    let d = (f * L) % L;
    for (let k = 0; k < 60 && busy(d); k++) d = (d + 17) % L;
    return Math.round(d);
  };
  const rows = L > 2000 ? 5 : 4;
  for (let i = 0; i < rows; i++) {
    const d = place((i + 0.35) / rows);
    const hw = path.frameAtSplineDistance(path.startDistance + d).halfWidth;
    const count = hw > 9 ? 5 : 4;
    def.itemBoxes.push({ distance: d, lateral: 0, count, spacing: Math.min(3.6, ((hw - 1) * 2) / (count - 1)) });
  }
  for (let i = 0; i < rows; i++) {
    const d = place((i + 0.75) / rows);
    const hw = path.frameAtSplineDistance(path.startDistance + d).halfWidth;
    def.coins.push({ distance: d, lateral: (i % 2 ? -1 : 1) * Math.min(3.5, hw - 2.5), count: 5, spacing: 4 });
  }
  // Coin arc over every jump shows the line.
  for (const jump of def.jumps) {
    const lip = path.anchorToWorld({ distance: jump.distance + jump.length }).position;
    for (let i = 1; i <= 5; i++) {
      const t = i * 0.16;
      const distance = jump.distance + jump.length + 42 * t;
      const road = path.anchorToWorld({ distance }).position;
      def.coins.push({ distance, count: 1, spacing: 1, height: Math.max(1, lip.y + jump.rise + 16 * t - 16 * t * t - road.y) });
    }
  }
  // Billboards along the walls (not over the void).
  if (!spec.space) {
    for (let i = 1; i < 8; i++) {
      const d = Math.round((i * L) / 8);
      const smp = path.frameAtSplineDistance(path.startDistance + d).sample;
      if (smp.open || smp.kind === 'tunnel') continue;
      def.decor.landmarks.push({ type: 'billboard', anchor: { distance: d, side: i % 2 ? 'left' : 'right', wallOffset: 3 }, params: { brand: i % 5 } });
    }
  }
  return def;
}
