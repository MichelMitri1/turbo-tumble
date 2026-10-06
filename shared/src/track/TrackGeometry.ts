import type { TrackPath } from './TrackPath';
import { extrudeAlongPath, mergeMeshData, type MeshData } from './Extrude';

/** Wall collision strip height below / above the road surface. */
export const WALL_BOTTOM = -3;
export const WALL_TOP = 5;

/** Index runs of the closed loop where `pred` holds (whole loop if it always holds). */
export function loopRuns(path: TrackPath, pred: (i: number) => boolean): number[][] {
  const n = path.samples.length;
  if (path.samples.every((_, i) => pred(i))) return [path.runIndices([0, n])];
  const out: number[][] = [];
  // Start scanning just after a failing sample so runs don't wrap mid-way.
  const start = path.samples.findIndex((_, i) => !pred(i));
  let run: number[] = [];
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (pred(i)) run.push(i);
    else if (run.length) {
      out.push(run);
      run = [];
    }
  }
  if (run.length) out.push(run);
  // Each run includes the next sample so strips meet without cracks.
  return out.filter((r) => r.length > 1).map((r) => [...r, (r[r.length - 1]! + 1) % n].filter((i) => pred(i) || i === (r[r.length - 1]! + 1) % n));
}

/** Drivable road (edge line to edge line), with holes where the track has gaps. */
export function buildRoadSurface(path: TrackPath, vScale = 16): MeshData {
  const s = path.samples;
  const parts = loopRuns(path, (i) => !s[i]!.gap).map((idx) =>
    extrudeAlongPath(
      path,
      idx,
      (smp) => [
        { x: -smp.halfWidth, y: 0, u: 0 },
        { x: smp.halfWidth, y: 0, u: 1 },
      ],
      { vScale, normals: true },
    ),
  );
  return parts.length === 1 ? parts[0]! : mergeMeshData(parts);
}

/** Curb strips (both sides) wherever the path flags a corner. */
export function buildCurbSurfaces(path: TrackPath): MeshData | null {
  const w = path.def.path.curbWidth;
  const parts: MeshData[] = [];
  for (const run of path.runs((s) => s.curb)) {
    const idx = path.runIndices(run);
    if (idx.length < 2) continue;
    parts.push(extrudeAlongPath(path, idx, (s) => [{ x: s.halfWidth - 0.05, y: 0 }, { x: s.halfWidth + w, y: 0 }]));
    parts.push(extrudeAlongPath(path, idx, (s) => [{ x: -s.halfWidth - w, y: 0 }, { x: -s.halfWidth + 0.05, y: 0 }]));
  }
  return parts.length ? mergeMeshData(parts) : null;
}

/** Shortcut trail strips laid on the (flattened) terrain. */
export function buildShortcutSurfaces(path: TrackPath, groundHeight: (x: number, z: number) => number): MeshData | null {
  const parts: MeshData[] = [];
  for (const sc of path.def.shortcuts) {
    const pts = path.shortcutPoints(sc, 2.5);
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let v = 0;
    pts.forEach((p, i) => {
      const next = pts[Math.min(pts.length - 1, i + 1)]!;
      const prev = pts[Math.max(0, i - 1)]!;
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      const rx = dz / len;
      const rz = -dx / len;
      for (const side of [-1, 1]) {
        const x = p.x + rx * side * sc.halfWidth;
        const z = p.z + rz * side * sc.halfWidth;
        positions.push(x, groundHeight(x, z) + 0.07, z);
        uvs.push((side + 1) / 2, (v * 2.5) / 8);
      }
      if (i < pts.length - 1) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      v++;
    });
    parts.push({ positions: new Float32Array(positions), normals: null, uvs: new Float32Array(uvs), colors: null, indices: new Uint32Array(indices) });
  }
  return parts.length ? mergeMeshData(parts) : null;
}

/** Index runs of samples that have a wall on the given side. */
export function wallRuns(path: TrackPath, side: 'left' | 'right'): number[][] {
  const key = side === 'left' ? 'wallLeft' : 'wallRight';
  return loopRuns(path, (i) => path.samples[i]![key]);
}

/** Vertical collision walls — none over the void, at gaps or at shortcut openings. */
export function buildWallColliders(path: TrackPath): MeshData | null {
  const parts: MeshData[] = [];
  for (const idx of wallRuns(path, 'left')) {
    parts.push(
      extrudeAlongPath(
        path,
        idx,
        (s) => [
          { x: -s.wallOffset, y: WALL_BOTTOM },
          { x: -s.wallOffset, y: WALL_TOP },
        ],
        { frame: 'flat' },
      ),
    );
  }
  for (const idx of wallRuns(path, 'right')) {
    parts.push(
      extrudeAlongPath(
        path,
        idx,
        (s) => [
          { x: s.wallOffset, y: WALL_BOTTOM },
          { x: s.wallOffset, y: WALL_TOP },
        ],
        { frame: 'flat', flip: true },
      ),
    );
  }
  return parts.length ? mergeMeshData(parts) : null;
}

/** Tunnel kerbs: flat strips from the road edge to the tunnel walls (drivable). */
export function buildTunnelKerbs(path: TrackPath, extend = 2): MeshData | null {
  const n = path.samples.length;
  const parts: MeshData[] = [];
  for (const run of path.runs((s) => s.kind === 'tunnel')) {
    const idx = path.runIndices([(run[0] - extend + n) % n, (run[1] + extend) % n]);
    for (const side of [1, -1]) {
      parts.push(
        extrudeAlongPath(
          path,
          idx,
          (s) => {
            const pts = [
              { x: side * (s.halfWidth - 0.02), y: 0.02 },
              { x: side * (s.wallOffset + 0.1), y: 0.02 },
            ];
            return side === 1 ? pts : pts.reverse();
          },
          { frame: 'banked', vScale: 4 },
        ),
      );
    }
  }
  return parts.length ? mergeMeshData(parts) : null;
}
