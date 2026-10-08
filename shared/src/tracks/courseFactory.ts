import type { HillDefinition, LakeDefinition, LandmarkPlacement, PropPlacement, RoadStyle, ScatterRule, ShortcutDefinition, TrackDefinition, TrackDifficulty } from '../types/track';
import { SeededRandom } from '../math/random';
import { TrackPath } from '../track/TrackPath';
import { computeRacingLine } from '../track/RacingLine';
import { LapTracker } from '../race/LapTracker';
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
  /** Start area: a full circuit (grandstand + pits), a small stand, or nothing. */
  crowd?: 'circuit' | 'stand' | 'none';
  /** Sponsor boards round the lap (default 5; 0 for none). */
  billboards?: number;
  /**
   * This course's own set pieces (landmark builders on the client), placed in
   * track space from the lap length — the signature that makes it recognisable.
   */
  landmarks?: (lapLength: number) => LandmarkPlacement[];
  props?: (lapLength: number) => PropPlacement[];
  /** Open water on one side of the map, out to the horizon (compass side of the layout). */
  sea?: 'north' | 'south' | 'east' | 'west';
  /** Extra scatter on top of the theme's (seeded from the course seed). */
  scatter?: (seed: number) => ScatterRule[];
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
  // Floating roads have their rail right at the edge: give them a little more room.
  const halfWidth = WIDTH[spec.difficulty] + (spec.space ? 1.2 : 0);

  const hills: HillDefinition[] = [...(spec.hills ?? []), ...(spec.space ? [] : course.hills)];
  if (!spec.space) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const d = extent / 2 + rng.range(150, 250);
      hills.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, radius: rng.range(100, 150), height: rng.range(18, 36) });
    }
  }
  const lakes: LakeDefinition[] = spec.space || !theme.lakes ? [] : [...(spec.lakes ?? []), ...course.lakes.map((l) => ({ x: l.x, z: l.z, radiusX: l.r, radiusZ: l.r, depth: 6 }))];
  if (spec.sea && theme.lakes && !spec.space) {
    // A wide, shallow bay whose shore stays well clear of the road; its water plane
    // reaches past the terrain edge so it reads as open sea.
    const r = 150;
    const off = r * 1.6 + 40;
    const [x, z] = { north: [cx, b.minZ - off], south: [cx, b.maxZ + off], east: [b.maxX + off, cz], west: [b.minX - off, cz] }[spec.sea];
    const across = spec.sea === 'east' || spec.sea === 'west';
    lakes.push({ x: x!, z: z!, radiusX: across ? r : r * 2.6, radiusZ: across ? r * 2.6 : r, depth: 9 });
  }

  const crowdKind = spec.crowd ?? (theme.noCrowd || spec.noCrowd || spec.space ? 'none' : 'circuit');
  const crowd: LandmarkPlacement[] =
    crowdKind === 'none'
      ? []
      : crowdKind === 'stand'
        ? [{ type: 'grandstand', anchor: { distance: -10, side: 'left', wallOffset: 2.5, length: 40 }, params: { roof: false, tiers: 4 } }]
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
      landmarks: [
        { type: 'startGantry', anchor: { distance: 0 }, params: { style: theme.id } },
        ...crowd,
        ...(theme.landmarks?.(course.length) ?? []),
        ...(spec.landmarks?.(course.length) ?? []),
        ...scenery,
      ],
      props: [
        ...(spec.space || crowdKind === 'none' ? [] : [{ model: 'flagCheckers', distance: -8, side: 'right', wallOffset: 1, scale: 8, yaw: 90 }, { model: 'flagCheckers', distance: 8, side: 'right', wallOffset: 1, scale: 8, yaw: 90 }] as PropPlacement[]),
        ...((theme.props?.(course.length) ?? []) as PropPlacement[]),
        ...(spec.props?.(course.length) ?? []),
      ],
      scatter: spec.space ? [] : [...theme.scatter(spec.seed * 10), ...(spec.scatter?.(spec.seed * 10 + 50) ?? [])],
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
  // Road obstacles wear the theme (pumpkins on the farm, columns in the ruins…).
  if (theme.hazards) def.hazards.forEach((h, i) => (h.model = theme.hazards![i % theme.hazards!.length]!));

  if (spec.traffic) {
    for (let i = 0; i < spec.traffic.count; i++) {
      def.movers!.push({ kind: 'cruiser', distance: Math.round(((i + 0.5) * course.length) / spec.traffic.count), lateral: (i % 2 ? 1 : -1) * halfWidth * 0.45, period: 1, phase: 0, size: 1.4, speed: spec.traffic.speed });
    }
  }

  // Pickups: clear of jumps / gaps / hazards / shortcut mouths.
  const path = new TrackPath(def);
  // Checkpoints dodge jump / gap / shortcut zones and can bunch up at a zone's end;
  // two a metre apart can be crossed in one tick and the second is then never
  // counted. Use the most checkpoints that stay ≥ 8 m apart (else the widest spread).
  let spread = -1;
  for (let n = 8; n <= 18; n++) {
    const cps = new LapTracker(path, n, 3).checkpointDistances;
    const gap = Math.min(...cps.map((d, i) => (i ? d - cps[i - 1]! : Infinity)));
    if (gap >= 8 || gap > spread) {
      if (spread < 8 || gap >= 8) def.checkpointCount = n;
      spread = Math.max(spread, gap);
    }
  }
  const L = path.length;
  const near = (a: number, b2: number): number => Math.min(Math.abs(a - b2), L - Math.abs(a - b2));
  const wrap = (d: number): number => ((d % L) + L) % L;
  // Boxes handed out just before a gap jump get fired at the pack on the run-up and
  // knock karts into the hole: keep rows well clear ahead of those.
  const gapJump = (j: TrackDefinition['jumps'][number]): boolean => def.gaps!.some((g) => near(g.distance, j.distance + j.length) < 6);
  const busy = (d: number, room = 1): boolean =>
    def.jumps.some((j) => near(j.distance + j.length / 2, d) < 34 * room || (wrap(j.distance - d) < (gapJump(j) ? 190 : 95) * Math.max(room, 0.5) && wrap(j.distance - d) > 0)) ||
    def.gaps!.some((g) => near(g.distance + g.length / 2, d) < g.length / 2 + 30) ||
    def.hazards.some((h) => near(h.distance, d) < 28) ||
    def.boostPads.some((p) => near(p.distance, d) < 22) ||
    def.movers!.some((m) => m.kind !== 'cruiser' && near(m.distance, d) < 30) ||
    def.itemBoxes.some((r) => near(r.distance, d) < 90 * room) ||
    def.shortcuts.some((sc) => near(sc.from, d) < 25 || near(sc.to, d) < 18) ||
    near(0, d) < 60 ||
    path.frameAtSplineDistance(path.startDistance + d).sample.kind === 'tunnel';
  const settle = (d: number, step = 13): number | null => {
    for (let k = 0; k < 40; k++) {
      const at = wrap(d + k * step);
      if (!busy(at)) return Math.round(at);
    }
    return null;
  };
  const hwAt = (d: number): number => path.frameAtSplineDistance(path.startDistance + d).halfWidth;
  const line = computeRacingLine(path, { iterations: 400 });
  const lineAt = (d: number): number => line.lateral[path.wrapIndex(Math.round((path.startDistance + d) / path.spacing))]!;
  const pick = new SeededRandom(spec.seed * 31 + 7);
  /** A row centred on `lateral`, kept inside the road. */
  const row = (d: number, lateral: number, count: number): void => {
    const hw = hwAt(d);
    const spacing = Math.min(3.6, ((hw - 1) * 2) / Math.max(1, count - 1));
    const half = ((count - 1) * spacing) / 2 + 1;
    const lat = Math.max(-(hw - half), Math.min(hw - half, lateral));
    def.itemBoxes.push({ distance: d, lateral: Math.round(lat * 10) / 10, count, spacing });
  };
  // 1. Just after a landing (the reward for the big air).
  const landings = def.jumps.map((j) => {
    const gap = def.gaps!.find((g) => near(g.distance, j.distance + j.length) < 6);
    return j.distance + j.length + (gap ? gap.length : 0) + 42;
  });
  for (const d of landings.slice(0, 2)) {
    const at = settle(d, 9);
    if (at !== null && !def.itemBoxes.some((r) => near(r.distance, at) < 90)) row(at, 0, hwAt(at) > 8.5 ? 4 : 3);
  }
  // 2. A short row on the racing line out of a corner (the line rewards precision).
  const exits: number[] = [];
  for (let i = 0; i < path.samples.length; i += 4) {
    const prev = Math.abs(line.curvature[(i - 12 + path.samples.length) % path.samples.length]!);
    if (prev > 1 / 45 && Math.abs(line.curvature[i]!) < 1 / 140) exits.push(path.lapDistance(path.samples[i]!.distance));
  }
  for (let tries = 0; tries < 6 && exits.length; tries++) {
    const d = pick.pick(exits);
    const at = settle(d + 15, 7);
    if (at === null) continue;
    row(at, lineAt(at), 2);
    break;
  }
  // 3. Two boxes waiting at the end of each shortcut, on its side of the road.
  for (const sc of def.shortcuts) {
    const at = settle(sc.to + 24, 6);
    if (at === null || near(at, sc.to) > 80) continue;
    const side = (sc.toSide ?? sc.side) === 'left' ? -1 : 1;
    row(at, side * (hwAt(at) - 2.6), 2);
  }
  // 4. Fill the longest empty stretches with classic full-width rows.
  const want = L > 1600 ? 5 : 4;
  for (let guard = 0; guard < 8 && def.itemBoxes.length < want; guard++) {
    const ds = def.itemBoxes.map((r) => r.distance).sort((a, b2) => a - b2);
    let best = 0;
    let gapStart = 0;
    ds.forEach((d, i) => {
      const next = i + 1 < ds.length ? ds[i + 1]! : ds[0]! + L;
      if (next - d > best) {
        best = next - d;
        gapStart = d;
      }
    });
    if (!ds.length) {
      best = L;
      gapStart = 0.3 * L;
    }
    const at = settle(gapStart + best * 0.5, 11);
    if (at === null) break;
    const hw = hwAt(at);
    row(at, 0, hw > 9 ? 5 : 4);
  }
  def.itemBoxes.sort((a, b2) => a.distance - b2.distance);

  // Coins: a few lines along the lap, alternating sides.
  const coinRows = Math.max(3, Math.round(L / 400));
  for (let i = 0; i < coinRows; i++) {
    const d0 = ((i + 0.62) * L) / coinRows;
    let d = Math.round(wrap(d0));
    for (let k = 0; k < 30 && (busy(d, 0) || def.coins.some((c) => near(c.distance, d) < 60)); k++) d = Math.round(wrap(d + 11));
    const hw = hwAt(d);
    def.coins.push({ distance: d, lateral: (i % 2 ? -1 : 1) * Math.min(3.5, hw - 2.5), count: 5, spacing: 4 });
  }
  // Coin arc over every big jump shows the line.
  for (const jump of def.jumps) {
    if (jump.launchSpeed < 14) continue;
    const lip = path.anchorToWorld({ distance: jump.distance + jump.length }).position;
    for (let i = 1; i <= 5; i++) {
      const t = i * 0.16;
      const distance = jump.distance + jump.length + 42 * t;
      const road = path.anchorToWorld({ distance }).position;
      def.coins.push({ distance, count: 1, spacing: 1, height: Math.max(1, lip.y + jump.rise + 16 * t - 16 * t * t - road.y) });
    }
  }
  // Billboards along the walls at irregular spacing (not over the void, not at set pieces).
  const boards = spec.space ? 0 : (spec.billboards ?? 5);
  const taken = def.decor.landmarks.flatMap((l) => (l.anchor && l.type !== 'startGantry' ? [l.anchor.distance] : []));
  let d = 120 + pick.range(0, 60);
  for (let i = 0; i < boards && d < L - 90; i++) {
    const smp = path.frameAtSplineDistance(path.startDistance + d).sample;
    const clear = !smp.open && smp.kind === 'ground' && !taken.some((t) => near(t, d) < 50) && !def.shortcuts.some((sc) => near(sc.from, d) < 40 || near(sc.to, d) < 40);
    if (clear) def.decor.landmarks.push({ type: 'billboard', anchor: { distance: Math.round(d), side: pick.chance(0.5) ? 'left' : 'right', wallOffset: 3 }, params: { brand: (spec.seed + i) % 5 } });
    d += (L / (boards + 1)) * pick.range(0.55, 1.45);
  }
  return def;
}
