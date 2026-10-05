import type { TrackPath } from './TrackPath';
import { extrudeAlongPath, mergeMeshData, type MeshData } from './Extrude';

/** Wall collision strip height below / above the road surface. */
export const WALL_BOTTOM = -3;
export const WALL_TOP = 5;

/** Drivable asphalt (one closed strip, edge line to edge line). */
export function buildRoadSurface(path: TrackPath, vScale = 16): MeshData {
  const loop = path.runIndices([0, path.samples.length]);
  return extrudeAlongPath(
    path,
    loop,
    (s) => [
      { x: -s.halfWidth, y: 0, u: 0 },
      { x: s.halfWidth, y: 0, u: 1 },
    ],
    { vScale, normals: true },
  );
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

/** Vertical collision walls on both sides of the whole lap. */
export function buildWallColliders(path: TrackPath): MeshData {
  const loop = path.runIndices([0, path.samples.length]);
  const left = extrudeAlongPath(
    path,
    loop,
    (s) => [
      { x: -s.wallOffset, y: WALL_BOTTOM },
      { x: -s.wallOffset, y: WALL_TOP },
    ],
    { frame: 'flat' },
  );
  const right = extrudeAlongPath(
    path,
    loop,
    (s) => [
      { x: s.wallOffset, y: WALL_BOTTOM },
      { x: s.wallOffset, y: WALL_TOP },
    ],
    { frame: 'flat', flip: true },
  );
  return mergeMeshData([left, right]);
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
