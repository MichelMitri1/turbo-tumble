import type { HazardDefinition, HillDefinition, LakeDefinition, LandmarkPlacement, PropPlacement, TrackDefinition } from '../types/track';
import { SeededRandom } from '../math/random';
import { generateLayout, type LayoutSpec } from './generator';
import { THEMES } from './themes';
import { addCourseJumps } from './jumps';

export interface TrackSpec {
  id: string;
  name: string;
  theme: keyof typeof THEMES;
  seed: number;
  layout: LayoutSpec;
  /** Infield lagoon (if the theme has lakes and the infield is big enough). */
  infieldLake?: boolean;
  music?: string;
  /** Hand-authored obstacle rhythm, measured from the start line. */
  obstacles: Array<Omit<HazardDefinition, 'distance' | 'type'> & { fraction: number }>;
  jumps: number[];
  launchSpeed?: number;
}

/**
 * Builds a full TrackDefinition from a generated layout + a theme: terrain sized to
 * the layout, hills and lakes placed clear of the road, lakes under bridges and
 * hills over tunnels, start area, billboards, item boxes, coins and boost pads.
 */
export function defineTrack(spec: TrackSpec): TrackDefinition {
  const theme = THEMES[spec.theme]!;
  const layout = generateLayout(spec.layout);
  const L = layout.length;
  const rng = new SeededRandom(spec.seed);
  const [sx, sz] = spec.layout.stretch ?? [1, 1];
  const outer = spec.layout.radius * (1 + spec.layout.harmonics.reduce((a, h) => a + Math.abs(h[1]), 0)) * Math.max(sx, sz);
  const size = Math.max(1000, Math.ceil((outer * 2 + 560) / 50) * 50);

  // Scenic hills ring + one per tunnel; lakes in the infield and under bridges.
  const hills: HillDefinition[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const d = outer + rng.range(140, 240);
    hills.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, radius: rng.range(100, 150), height: rng.range(18, 34) });
  }
  const lakes: LakeDefinition[] = [];
  const minInner = layout.innerRadius * Math.min(sx, sz);
  if (theme.lakes && spec.infieldLake !== false && minInner > 120) {
    const r = Math.min(110, (minInner - 55) * 0.6);
    lakes.push({ x: 0, z: 0, radiusX: r * 1.1, radiusZ: r * 0.85, depth: 6 });
  }
  for (const seg of spec.layout.segments ?? []) {
    const mid = layout.at((seg.from + seg.to) / 2);
    const span = (seg.to - seg.from) * L;
    if (seg.kind === 'bridge' && theme.lakes) lakes.push({ x: mid.x, z: mid.z, radiusX: span * 0.42, radiusZ: span * 0.42, depth: 6 });
    if (seg.kind === 'tunnel') {
      // Hill centred just outside the tunnel line so the bore runs through its flank.
      const out = Math.hypot(mid.x, mid.z) || 1;
      hills.push({ x: mid.x + (mid.x / out) * 26, z: mid.z + (mid.z / out) * 26, radius: Math.max(70, span * 0.75), height: 24 + mid.y });
    }
  }
  if (!theme.noCrowd && minInner > 160 && !lakes.some((l) => Math.hypot(l.x, l.z) < 60)) hills.push({ x: 0, z: 0, radius: Math.min(80, minInner * 0.4), height: 12 });

  const billboards: LandmarkPlacement[] = [];
  for (let i = 1; i < 8; i++) {
    billboards.push({ type: 'billboard', anchor: { distance: Math.round((i * L) / 8), side: i % 2 ? 'left' : 'right', wallOffset: 3 }, params: { brand: i % 5 } });
  }
  const crowd: LandmarkPlacement[] = theme.noCrowd
    ? []
    : [
        { type: 'grandstand', anchor: { distance: -6, side: 'left', wallOffset: 2.5, length: 80 }, params: { roof: true, tiers: 6 } },
        { type: 'pitRow', anchor: { distance: 46, side: 'right', wallOffset: 4, length: 40 } },
      ];
  const scenery: LandmarkPlacement[] = [];
  if (theme.mountains) scenery.push({ type: 'mountains', params: { radius: Math.max(760, outer + 420), count: 34, low: theme.mountains.low, mid: theme.mountains.mid, peak: theme.mountains.peak, snow: Boolean(theme.mountains.snow) } });
  if (theme.sky.clouds > 0) scenery.push({ type: 'clouds' });

  const props: PropPlacement[] = [
    { model: 'lightPostLarge', distance: -40, side: 'left', wallOffset: 1, scale: 9, repeat: { every: 26, until: 40 } },
    { model: 'flagCheckers', distance: -8, side: 'right', wallOffset: 1, scale: 8, yaw: 90 },
    { model: 'flagCheckers', distance: 8, side: 'right', wallOffset: 1, scale: 8, yaw: 90 },
    { model: 'bannerTowerRed', distance: Math.round(L * 0.2), side: 'right', wallOffset: 2, scale: 8, repeat: { every: 70, until: Math.round(L * 0.35) } },
    { model: 'bannerTowerGreen', distance: Math.round(L * 0.62), side: 'left', wallOffset: 2, scale: 8, repeat: { every: 70, until: Math.round(L * 0.75) } },
    ...(theme.props?.(L) ?? []),
  ];

  // Gameplay objects by lap fraction; boost pads on the straights.
  const hazards: HazardDefinition[] = spec.obstacles.map(({ fraction, ...obstacle }) => ({ ...obstacle, type: 'obstacle', distance: Math.round(fraction * L) }));
  const gap = (a: number, b: number): number => Math.min(Math.abs(a - b), L - Math.abs(a - b));
  const pads = layout.straights.filter((d) => hazards.every((h) => gap(h.distance, d) > 55)).slice(0, 3).map((d, i) => ({ distance: Math.round(d), lateral: [0, -2.5, 2.5][i]!, length: 7, width: 5 }));
  const clear = (d: number): number => {
    for (let k = 0; k < 32 && (pads.some((p) => gap(p.distance, d) < 30) || hazards.some((h) => gap(h.distance, d) < 35)); k++) d = (d + 35) % L;
    return Math.round(d % L);
  };
  // Rows must fit even when their placement falls inside a narrow causeway.
  const pickupHalfWidth = Math.min(theme.halfWidth, ...layout.points.map((p) => p.halfWidth ?? theme.halfWidth));
  const itemBoxes = [0.13, 0.45, 0.76].map((f, i) => {
    const count = i === 1 ? 4 : 5;
    return { distance: clear(f * L), lateral: 0, count, spacing: Math.min(3.6, (pickupHalfWidth - 1) * 2 / (count - 1)) };
  });
  const coins = [0.28, 0.6, 0.9].map((f, i) => ({ distance: clear(f * L), lateral: [3.5, -3, 4][i]!, count: 6, spacing: 4 }));

  const halfWidth = theme.halfWidth;
  return addCourseJumps({
    id: spec.id,
    name: spec.name,
    theme: theme.id,
    laps: 3,
    path: { points: layout.points, defaultHalfWidth: halfWidth, defaultShoulder: 7, sampleSpacing: 2, autoBankDeg: 6, curbWidth: 1.4 },
    startDistance: layout.startDistance,
    spawnGrid: { firstRowOffset: 7, rowSpacing: 7.5, columns: [-3.6, 3.6], stagger: 3.2 },
    checkpointCount: 16,
    terrain: {
      seed: spec.seed,
      size,
      resolution: Math.min(380, Math.round(size / 3.3)),
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
      landmarks: [{ type: 'startGantry', anchor: { distance: 0 } }, ...crowd, ...billboards, ...(theme.landmarks?.(L) ?? []), ...scenery],
      props,
      scatter: theme.scatter(spec.seed * 10),
    },
    minimap: { rotation: 0 },
    music: spec.music ?? theme.music,
    boostPads: pads,
    jumps: [],
    itemBoxes,
    coins,
    hazards,
    shortcuts: [],
  }, spec.jumps, spec.launchSpeed);
}
