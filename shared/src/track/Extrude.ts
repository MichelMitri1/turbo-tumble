import { Vector3 } from 'three';
import type { TrackPath, TrackSample } from './TrackPath';

/** Plain geometry arrays usable by both the renderer and the physics engine. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array;
  colors: Float32Array | null;
  indices: Uint32Array;
}

export interface ProfilePoint {
  /** Lateral offset (positive = right of driving direction). */
  x: number;
  /** Vertical offset. */
  y: number;
  /** Optional explicit U texture coordinate; defaults to cumulative profile length. */
  u?: number;
  /** Optional vertex colour (linear RGB 0..1). */
  color?: [number, number, number];
}

export interface ExtrudeOptions {
  /** 'banked' uses the road frame, 'flat' uses horizontal right + world up. */
  frame?: 'banked' | 'flat';
  /** Metres of path per V texture repeat. */
  vScale?: number;
  /** Swap triangle winding (useful for left-side walls facing inward). */
  flip?: boolean;
  /** Compute smooth normals from the profile (otherwise left null). */
  normals?: boolean;
}

const WORLD_UP = new Vector3(0, 1, 0);

/**
 * Sweep a 2D profile along a run of track samples. The profile may vary per sample
 * (e.g. width changes) but must keep the same vertex count.
 */
export function extrudeAlongPath(
  path: TrackPath,
  indices: number[],
  profile: (s: TrackSample) => ProfilePoint[],
  opts: ExtrudeOptions = {},
): MeshData {
  const frame = opts.frame ?? 'banked';
  const vScale = opts.vScale ?? 10;
  const rings = indices.length;
  const first = profile(path.samples[indices[0]!]!);
  const ppr = first.length;
  const positions = new Float32Array(rings * ppr * 3);
  const uvs = new Float32Array(rings * ppr * 2);
  const hasColor = first.some((p) => p.color);
  const colors = hasColor ? new Float32Array(rings * ppr * 3) : null;
  const normals = opts.normals ? new Float32Array(rings * ppr * 3) : null;

  const right = new Vector3();
  const up = new Vector3();
  const tmp = new Vector3();
  let travelled = 0;

  for (let r = 0; r < rings; r++) {
    const s = path.samples[indices[r]!]!;
    if (r > 0) {
      const prev = path.samples[indices[r - 1]!]!;
      travelled += prev.position.distanceTo(s.position);
    }
    right.copy(frame === 'banked' ? s.right : s.flatRight);
    up.copy(frame === 'banked' ? s.up : WORLD_UP);
    const prof = r === 0 ? first : profile(s);
    let cum = 0;
    for (let k = 0; k < ppr; k++) {
      const p = prof[k]!;
      if (k > 0) {
        const q = prof[k - 1]!;
        cum += Math.hypot(p.x - q.x, p.y - q.y);
      }
      const vi = (r * ppr + k) * 3;
      tmp.copy(s.position).addScaledVector(right, p.x).addScaledVector(up, p.y);
      positions[vi] = tmp.x;
      positions[vi + 1] = tmp.y;
      positions[vi + 2] = tmp.z;
      const ui = (r * ppr + k) * 2;
      uvs[ui] = p.u ?? cum;
      uvs[ui + 1] = travelled / vScale;
      if (colors) {
        const c = p.color ?? [1, 1, 1];
        colors[vi] = c[0];
        colors[vi + 1] = c[1];
        colors[vi + 2] = c[2];
      }
      if (normals) {
        // Profile-space normal (perpendicular to the profile edge), mapped to world.
        const a = prof[Math.max(0, k - 1)]!;
        const b = prof[Math.min(ppr - 1, k + 1)]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        // Rotate edge (ex, ey) by +90° → (-ey, ex); orientation chosen so a flat
        // left→right profile yields +up.
        tmp.set(0, 0, 0).addScaledVector(right, -ey).addScaledVector(up, ex).normalize();
        if (opts.flip) tmp.negate();
        normals[vi] = tmp.x;
        normals[vi + 1] = tmp.y;
        normals[vi + 2] = tmp.z;
      }
    }
  }

  const quadCount = (rings - 1) * (ppr - 1);
  const idx = new Uint32Array(quadCount * 6);
  let o = 0;
  for (let r = 0; r < rings - 1; r++) {
    for (let k = 0; k < ppr - 1; k++) {
      const a = r * ppr + k;
      const b = a + 1;
      const c = a + ppr;
      const d = c + 1;
      // (b-a)×(c-a) = right×tangent = up → counter-clockwise when seen from +up.
      if (opts.flip) {
        idx.set([a, c, b, b, c, d], o);
      } else {
        idx.set([a, b, c, b, d, c], o);
      }
      o += 6;
    }
  }
  return { positions, normals, uvs, colors, indices: idx };
}

/** Concatenate several MeshData blocks into one (all must agree on optional attributes). */
export function mergeMeshData(parts: MeshData[]): MeshData {
  const vCount = parts.reduce((n, p) => n + p.positions.length / 3, 0);
  const iCount = parts.reduce((n, p) => n + p.indices.length, 0);
  const withNormals = parts.every((p) => p.normals);
  const withColors = parts.every((p) => p.colors);
  const positions = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  const normals = withNormals ? new Float32Array(vCount * 3) : null;
  const colors = withColors ? new Float32Array(vCount * 3) : null;
  const indices = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    positions.set(p.positions, vo * 3);
    uvs.set(p.uvs, vo * 2);
    if (normals && p.normals) normals.set(p.normals, vo * 3);
    if (colors && p.colors) colors.set(p.colors, vo * 3);
    for (let i = 0; i < p.indices.length; i++) indices[io + i] = p.indices[i]! + vo;
    vo += p.positions.length / 3;
    io += p.indices.length;
  }
  return { positions, normals, uvs, colors, indices };
}
