/**
 * Data-only description of a race track. Everything a client needs to build the
 * visuals and everything a server needs to run the race (path, walls, checkpoints,
 * spawn grid, gameplay objects) is derived from this definition.
 *
 * Coordinates are metres, Y up. A track is a closed centerline spline; most
 * placements are expressed in track space (distance along the lap + lateral offset)
 * so they survive layout edits.
 */

export type Vec3Tuple = [number, number, number];

/** How a stretch of track interacts with the surrounding world. */
export type SegmentKind = 'ground' | 'bridge' | 'tunnel' | 'void';

export interface TrackControlPoint {
  pos: Vec3Tuple;
  /** Road half-width at this point (falls back to path.defaultHalfWidth). */
  halfWidth?: number;
  /** Drivable off-road shoulder beyond the road edge before the wall. */
  shoulder?: number;
  /** Kind of the segment that *starts* at this control point. */
  kind?: SegmentKind;
  /** Extra manual bank in degrees (positive raises the right edge). */
  bank?: number;
}

export interface TrackPathDefinition {
  points: TrackControlPoint[];
  defaultHalfWidth: number;
  defaultShoulder: number;
  /** Distance between generated samples in metres. */
  sampleSpacing: number;
  /** Automatic banking from curvature (max degrees). 0 disables. */
  autoBankDeg: number;
  /** Width of painted curbs at corners. */
  curbWidth: number;
}

/** A placement in track space. */
export interface TrackAnchor {
  /** Metres along the lap from the start line (wraps). */
  distance: number;
  /** Signed lateral offset from the centerline (positive = right of driving direction). */
  lateral?: number;
  /** Extra height above the road surface. */
  height?: number;
}

export interface SpawnGridDefinition {
  /** Distance behind the start line of the first grid slot. */
  firstRowOffset: number;
  rowSpacing: number;
  /** Lateral offsets of the slots in one row (karts are staggered per row). */
  columns: number[];
  /** Additional back-offset applied to each successive column (MK style stagger). */
  stagger: number;
}

export interface BoostPadDefinition extends TrackAnchor {
  length: number;
  width: number;
}

/** A raised launch ramp. Distance is the start of the climb, not its lip. */
export interface JumpDefinition extends TrackAnchor {
  length: number;
  width: number;
  rise: number;
  launchSpeed: number;
}

export interface ItemBoxRowDefinition extends TrackAnchor {
  count: number;
  spacing: number;
}

export interface CoinRowDefinition extends TrackAnchor {
  count: number;
  /** Spacing along the track (m). */
  spacing: number;
}

export interface HazardDefinition extends TrackAnchor {
  type: 'obstacle';
  /** Existing asset-manifest model, sized to the shared collision envelope. */
  model: string;
  radius: number;
  obstacleHeight: number;
}

/**
 * An alternate route: the wall opens on `side` at `from`, a dirt path runs across
 * (bulging out by `bulge` metres) and rejoins the road at `to` (lap distances).
 */
export interface ShortcutDefinition {
  from: number;
  to: number;
  side: 'left' | 'right';
  /** Side the trail rejoins on (defaults to `side`). */
  toSide?: 'left' | 'right';
  bulge: number;
  halfWidth: number;
  /** A boost pad at the entry (risky shortcuts reward a boost). */
  boost?: boolean;
}

/** A hole in the road (over the void) — needs a jump ramp right before it. */
export interface GapDefinition {
  /** Lap distance where the road ends. */
  distance: number;
  length: number;
}

/** A current along the road (flowing water, conveyor, wind ribbon) that pushes you faster. */
export interface StreamDefinition extends TrackAnchor {
  length: number;
  width: number;
  /** Extra top speed while on it (m/s). */
  strength: number;
  style: 'water' | 'neon' | 'wind' | 'lava';
}

export type MoverKind = 'stomper' | 'roller' | 'sweeper' | 'pendulum' | 'geyser' | 'cruiser';

/**
 * A moving obstacle. Its motion is a pure function of race time, so every client
 * and the server agree on where it is without sending it over the network.
 *   stomper   a heavy block that hangs overhead and slams down (squishes)
 *   roller    a boulder rolling from side to side across the road (tumbles)
 *   sweeper   a spinning arm on a post (spins you out)
 *   pendulum  a wrecking ball swinging across the road from a gantry (tumbles)
 *   geyser    a vent that erupts every few seconds (launches you)
 *   cruiser   slow traffic driving round the lap in a lane (spins you out)
 */
export interface MoverDefinition extends TrackAnchor {
  kind: MoverKind;
  /** Seconds per cycle. */
  period: number;
  /** Cycle offset, 0..1. */
  phase: number;
  /** Block / ball half-size, arm length (m). */
  size: number;
  /** Roller / pendulum sideways travel (m). */
  span?: number;
  /** Cruiser speed (m/s); sweeper spin direction (±1). */
  speed?: number;
}

export type TrackDifficulty = 'easy' | 'medium' | 'hard';
export type RoadStyle = 'asphalt' | 'rainbow' | 'sand' | 'cobble' | 'wood' | 'neon' | 'ice';

export interface LakeDefinition {
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  depth: number;
}

export interface HillDefinition {
  x: number;
  z: number;
  radius: number;
  height: number;
}

export interface TerrainDefinition {
  seed: number;
  size: number;
  resolution: number;
  baseHeight: number;
  noiseAmplitude: number;
  noiseScale: number;
  /** Width over which terrain blends from the track shoulder to natural height. */
  blendDistance: number;
  hills: HillDefinition[];
  lakes: LakeDefinition[];
  waterLevel: number | null;
  /** Look of the lakes (default: water). Lava glows; ice is pale and opaque. */
  liquid?: { color: string; emissive?: string; emissiveIntensity?: number; opacity?: number };
  palette: {
    grassA: string;
    grassB: string;
    shoulder: string;
    sand: string;
    rock: string;
  };
}

export interface LightingDefinition {
  sunDirection: Vec3Tuple;
  sunColor: string;
  sunIntensity: number;
  skyColor: string;
  groundColor: string;
  hemiIntensity: number;
  exposure: number;
}

export interface SkyDefinition {
  top: string;
  horizon: string;
  bottom: string;
  sunGlow: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  clouds: number;
  /** 0..1 star field brightness (night tracks). */
  stars?: number;
}

/** Visual model scattered or placed by the decoration system (ids from the asset manifest). */
export interface ScatterRule {
  models: string[];
  count: number;
  /** Min/max distance from the nearest wall (outside the drivable area). */
  minWallDistance: number;
  maxWallDistance: number;
  scale: [number, number];
  /** Avoid areas lower than water level + this. */
  avoidWater?: boolean;
  castShadow?: boolean;
  seed: number;
  /** Blend the models' colours towards this (e.g. snow-dusted pines). */
  tint?: string;
  tintAmount?: number;
}

export interface PropPlacement extends TrackAnchor {
  model: string;
  /** Which side of the track; lateral is measured outward from that side's wall. */
  side: 'left' | 'right';
  /** Metres outward from the wall. */
  wallOffset: number;
  /** Extra yaw in degrees (0 = facing the track). */
  yaw?: number;
  scale?: number;
  /** Repeat placement every N metres until `until` distance. */
  repeat?: { every: number; until: number };
}

/** Bespoke procedural set pieces (start gantry, grandstands, windmills...). */
export interface LandmarkPlacement {
  type: string;
  anchor?: TrackAnchor & { side?: 'left' | 'right'; wallOffset?: number; length?: number };
  position?: Vec3Tuple;
  yaw?: number;
  scale?: number;
  params?: Record<string, number | string | boolean>;
}

export interface TrackDecorDefinition {
  scatter: ScatterRule[];
  props: PropPlacement[];
  landmarks: LandmarkPlacement[];
}

export interface MinimapDefinition {
  /** Rotation (degrees) applied when drawing the minimap so the track reads well. */
  rotation: number;
}

export interface TrackDefinition {
  id: string;
  name: string;
  theme: string;
  laps: number;
  path: TrackPathDefinition;
  /** Distance along the spline (from control point 0) where the start/finish line sits. */
  startDistance: number;
  spawnGrid: SpawnGridDefinition;
  /** Number of auto-generated checkpoints (evenly spaced) used for lap validation. */
  checkpointCount: number;
  terrain: TerrainDefinition;
  lighting: LightingDefinition;
  sky: SkyDefinition;
  decor: TrackDecorDefinition;
  minimap: MinimapDefinition;
  music: string;
  difficulty?: TrackDifficulty;
  /** Road surface look. */
  roadStyle?: RoadStyle;
  /** Floating course in the sky / space: no terrain at all, the void is everywhere off-road. */
  space?: boolean;
  gaps?: GapDefinition[];
  streams?: StreamDefinition[];
  movers?: MoverDefinition[];
  // Gameplay objects.
  boostPads: BoostPadDefinition[];
  jumps: JumpDefinition[];
  itemBoxes: ItemBoxRowDefinition[];
  coins: CoinRowDefinition[];
  hazards: HazardDefinition[];
  shortcuts: ShortcutDefinition[];
}
