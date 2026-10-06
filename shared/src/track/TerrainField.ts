import type { TerrainDefinition } from '../types/track';
import type { TrackPath, TrackSample } from './TrackPath';
import type { MeshData } from './Extrude';
import { Noise2D } from '../math/noise';
import { clamp, lerp, smoothstep } from '../math/scalar';

export interface TrackInfluence {
  /** Horizontal distance from the centerline. */
  distance: number;
  /** Signed lateral offset (positive = right). */
  lateral: number;
  /** Road surface height continued laterally (bank applied, clamped at road edge). */
  roadY: number;
  wallOffset: number;
  halfWidth: number;
  groundBlend: number;
  /** Over the void: carve a chasm. */
  open: boolean;
  sample: TrackSample;
}

const CELL = 16;

/**
 * Heightfield around the track. Natural terrain = noise + hills − lakes, then
 * flattened into shoulders near the track and carved into valleys under bridges.
 */
export class TerrainField {
  readonly def: TerrainDefinition;
  readonly centerX: number;
  readonly centerZ: number;
  private readonly noise: Noise2D;
  private readonly grid = new Map<number, number[]>();
  private readonly influenceRadius: number;
  private heights: Float32Array | null = null;
  /** Shortcut dirt paths (world points) the terrain is flattened along. */
  private readonly shortcuts: Array<{ x: number; y: number; z: number }[]>;
  private readonly shortcutWidth: number[];

  constructor(
    private readonly path: TrackPath,
    def: TerrainDefinition,
  ) {
    this.def = def;
    this.noise = new Noise2D(def.seed);
    const b = path.bounds();
    this.centerX = (b.minX + b.maxX) / 2;
    this.centerZ = (b.minZ + b.maxZ) / 2;
    const maxWall = Math.max(...path.samples.map((s) => s.wallOffset));
    this.influenceRadius = maxWall + 2 + def.blendDistance;
    this.buildSegmentGrid();
    this.shortcuts = path.def.shortcuts.map((sc) => path.shortcutPoints(sc).map((p) => ({ x: p.x, y: p.y, z: p.z })));
    this.shortcutWidth = path.def.shortcuts.map((sc) => sc.halfWidth);
  }

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  private buildSegmentGrid(): void {
    const s = this.path.samples;
    const r = this.influenceRadius;
    for (let i = 0; i < s.length; i++) {
      const a = s[i]!.position;
      const b = s[(i + 1) % s.length]!.position;
      const minX = Math.floor((Math.min(a.x, b.x) - r) / CELL);
      const maxX = Math.floor((Math.max(a.x, b.x) + r) / CELL);
      const minZ = Math.floor((Math.min(a.z, b.z) - r) / CELL);
      const maxZ = Math.floor((Math.max(a.z, b.z) + r) / CELL);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const k = this.key(cx, cz);
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(i);
        }
      }
    }
  }

  /** Nearest track segment info within the influence radius, or null. */
  influence(x: number, z: number): TrackInfluence | null {
    const list = this.grid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return null;
    const s = this.path.samples;
    let bestD = Infinity;
    let bestI = -1;
    let bestT = 0;
    // Where roads cross, the lowest ground-level road owns the terrain (the upper one is a bridge).
    let groundD = Infinity;
    let groundI = -1;
    let groundT = 0;
    for (const i of list) {
      const a = s[i]!.position;
      const b = s[(i + 1) % s.length]!.position;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1;
      const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / len2, 0, 1);
      const px = a.x + abx * t - x;
      const pz = a.z + abz * t - z;
      const d = px * px + pz * pz;
      if (d < bestD) {
        bestD = d;
        bestI = i;
        bestT = t;
      }
      // Lowest ground road within its own reach (where roads cross, never bury the lower one).
      const reach = s[i]!.wallOffset + 4;
      if (s[i]!.groundBlend > 0.5 && !s[i]!.open && d < reach * reach && (groundI < 0 || s[i]!.position.y < s[groundI]!.position.y - 0.5 || (Math.abs(s[i]!.position.y - s[groundI]!.position.y) <= 0.5 && d < groundD))) {
        groundD = d;
        groundI = i;
        groundT = t;
      }
    }
    if (bestI < 0) return null;
    if (groundI >= 0 && groundI !== bestI && (s[bestI]!.groundBlend < 0.5 || s[groundI]!.position.y < s[bestI]!.position.y - 2)) {
      bestD = groundD;
      bestI = groundI;
      bestT = groundT;
    }
    const a = s[bestI]!;
    const b = s[(bestI + 1) % s.length]!;
    const cy = lerp(a.position.y, b.position.y, bestT);
    const cx = lerp(a.position.x, b.position.x, bestT);
    const cz = lerp(a.position.z, b.position.z, bestT);
    const frx = lerp(a.flatRight.x, b.flatRight.x, bestT);
    const frz = lerp(a.flatRight.z, b.flatRight.z, bestT);
    const lateral = (x - cx) * frx + (z - cz) * frz;
    const halfWidth = lerp(a.halfWidth, b.halfWidth, bestT);
    const rightY = lerp(a.right.y, b.right.y, bestT);
    const curbOuter = halfWidth + this.path.def.path.curbWidth;
    return {
      distance: Math.sqrt(bestD),
      lateral,
      roadY: cy + rightY * clamp(lateral, -curbOuter, curbOuter),
      wallOffset: lerp(a.wallOffset, b.wallOffset, bestT),
      halfWidth,
      groundBlend: lerp(a.groundBlend, b.groundBlend, bestT),
      open: a.open || b.open,
      sample: bestT < 0.5 ? a : b,
    };
  }

  /** Terrain without track shaping. */
  natural(x: number, z: number): number {
    const d = this.def;
    if (this.path.def.space) return -320; // floating course: nothing below
    let h = d.baseHeight + this.noise.fbm(x * d.noiseScale, z * d.noiseScale, 4) * d.noiseAmplitude;
    // Low frequency swell for larger rolling hills.
    h += this.noise.noise(x * d.noiseScale * 0.25 + 17.3, z * d.noiseScale * 0.25 - 4.1) * d.noiseAmplitude * 1.4;
    for (const hill of d.hills) {
      const dx = x - hill.x;
      const dz = z - hill.z;
      h += hill.height * Math.exp(-(dx * dx + dz * dz) / (hill.radius * hill.radius));
    }
    // Fade to a flat skirt at the grid border so it meets the outer ground ring.
    const edge = Math.max(Math.abs(x - this.centerX), Math.abs(z - this.centerZ));
    h = lerp(h, d.baseHeight - 2, smoothstep(d.size / 2 - 90, d.size / 2 - 4, edge));
    if (d.waterLevel !== null) {
      for (const lake of d.lakes) {
        const ex = (x - lake.x) / lake.radiusX;
        const ez = (z - lake.z) / lake.radiusZ;
        const e = Math.sqrt(ex * ex + ez * ez);
        if (e < 1.6) {
          const bed = d.waterLevel - lake.depth * (1 - smoothstep(0, 1, e));
          const shore = smoothstep(0.75, 1.6, e);
          h = lerp(Math.min(h, bed), h, shore);
        }
      }
    }
    return h;
  }

  /** Final terrain height (track shaping applied). */
  height(x: number, z: number): number {
    const nat = this.shortcutHeight(x, z, this.natural(x, z));
    const inf = this.influence(x, z);
    if (!inf) return nat;
    if (this.path.def.space) return nat;
    if (inf.open) {
      // The void: a deep chasm under the road (falls are fatal).
      const reach = inf.wallOffset + this.def.blendDistance;
      return lerp(nat, Math.min(nat, inf.roadY - 70), 1 - smoothstep(reach * 0.55, reach, inf.distance));
    }
    const flatEdge = inf.wallOffset + 1.5;
    const w = 1 - smoothstep(flatEdge, flatEdge + this.def.blendDistance, inf.distance);
    if (w <= 0) return nat;
    // Ground: shoulder just under the road surface (deeper beneath the asphalt itself).
    const underRoad = 1 - smoothstep(inf.halfWidth - 2, inf.halfWidth, inf.distance);
    const groundTarget = inf.roadY - 0.14 - underRoad * 0.5;
    // Bridge: valley well below the deck.
    const valleyTarget = Math.min(nat, inf.roadY - 9);
    const target = lerp(valleyTarget, groundTarget, inf.groundBlend);
    const weight = inf.groundBlend > 0.5 ? w : 1 - smoothstep(0, inf.wallOffset + this.def.blendDistance, inf.distance);
    return lerp(nat, target, clamp(weight, 0, 1));
  }

  /** Natural height blended flat along shortcut paths (between their entry/exit road heights). */
  private shortcutHeight(x: number, z: number, nat: number): number {
    let h = nat;
    this.shortcuts.forEach((pts, k) => {
      let best = Infinity;
      let y = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const abx = b.x - a.x;
        const abz = b.z - a.z;
        const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1), 0, 1);
        const d = Math.hypot(a.x + abx * t - x, a.z + abz * t - z);
        if (d < best) {
          best = d;
          y = lerp(a.y, b.y, t);
        }
      }
      const w = this.shortcutWidth[k]!;
      const blend = 1 - smoothstep(w + 1, w + 14, best);
      if (blend > 0) h = lerp(h, y - 0.12, blend);
    });
    return h;
  }

  /** Build the render/collision grid. Heights are cached for fast `sample()`. */
  buildMesh(): MeshData {
    const { size, resolution } = this.def;
    const verts = resolution + 1;
    const positions = new Float32Array(verts * verts * 3);
    const uvs = new Float32Array(verts * verts * 2);
    const heights = new Float32Array(verts * verts);
    const half = size / 2;
    const step = size / resolution;
    for (let iz = 0; iz < verts; iz++) {
      for (let ix = 0; ix < verts; ix++) {
        const x = this.centerX - half + ix * step;
        const z = this.centerZ - half + iz * step;
        const y = this.height(x, z);
        const v = iz * verts + ix;
        heights[v] = y;
        positions[v * 3] = x;
        positions[v * 3 + 1] = y;
        positions[v * 3 + 2] = z;
        uvs[v * 2] = x / 8;
        uvs[v * 2 + 1] = z / 8;
      }
    }
    const indices = new Uint32Array(resolution * resolution * 6);
    let o = 0;
    for (let iz = 0; iz < resolution; iz++) {
      for (let ix = 0; ix < resolution; ix++) {
        const a = iz * verts + ix;
        const b = a + 1;
        const c = a + verts;
        const d = c + 1;
        // Counter-clockwise seen from above (+Y).
        indices.set([a, c, b, b, c, d], o);
        o += 6;
      }
    }
    this.heights = heights;
    return { positions, normals: null, uvs, colors: null, indices };
  }

  /** Height matching the triangulated mesh exactly (requires buildMesh first). */
  sample(x: number, z: number): number {
    if (!this.heights) return this.height(x, z);
    const { size, resolution } = this.def;
    const verts = resolution + 1;
    const step = size / resolution;
    const fx = clamp((x - (this.centerX - size / 2)) / step, 0, resolution - 1e-4);
    const fz = clamp((z - (this.centerZ - size / 2)) / step, 0, resolution - 1e-4);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const h = this.heights;
    const a = h[iz * verts + ix]!;
    const b = h[iz * verts + ix + 1]!;
    const c = h[(iz + 1) * verts + ix]!;
    const d = h[(iz + 1) * verts + ix + 1]!;
    // Triangles (a,c,b) and (b,c,d) split along the b–c diagonal.
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  /** 0 at a lake centre, 1 at its shoreline, larger outside (min over lakes). */
  lakeDistance(x: number, z: number): number {
    let best = Infinity;
    for (const lake of this.def.lakes) {
      const ex = (x - lake.x) / lake.radiusX;
      const ez = (z - lake.z) / lake.radiusZ;
      best = Math.min(best, Math.sqrt(ex * ex + ez * ez));
    }
    return best;
  }

  isUnderwater(x: number, z: number, margin = 0): boolean {
    return this.def.waterLevel !== null && this.sample(x, z) < this.def.waterLevel + margin;
  }
}
