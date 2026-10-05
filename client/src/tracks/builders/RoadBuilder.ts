import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { extrudeAlongPath, mergeMeshData, type MeshData } from '@shared/track/Extrude';
import { buildRoadSurface } from '@shared/track/TrackGeometry';
import { spawnSlotAnchor } from '@shared/track/spawnGrid';
import type { TrackSample } from '@shared/track/TrackPath';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { toGeometry } from '../../rendering/meshData';

function mesh(data: MeshData, material: Mesh['material'], name: string, shadows = { cast: false, receive: true }): Mesh {
  const m = new Mesh(toGeometry(data), material);
  m.name = name;
  m.castShadow = shadows.cast;
  m.receiveShadow = shadows.receive;
  return m;
}

/** Asphalt, edge lips, curbs, barriers and start-line paint. */
export function buildRoad(ctx: BuildContext): void {
  const { path } = ctx;
  const loop = path.runIndices([0, path.samples.length]);
  const cw = path.def.path.curbWidth;

  const road = mesh(buildRoadSurface(path), TrackMaterials.road(), 'road');
  applyOcclusion(road.geometry, roadOcclusion(ctx), 2);
  ctx.add(road);

  // Dark lip from the road edge down into the terrain (hides the shoulder step).
  const lips = mergeMeshData([
    extrudeAlongPath(path, loop, (s) => [{ x: s.halfWidth, y: 0 }, { x: s.halfWidth + 0.35, y: -0.5 }]),
    extrudeAlongPath(path, loop, (s) => [{ x: -s.halfWidth - 0.35, y: -0.5 }, { x: -s.halfWidth, y: 0 }]),
  ]);
  const lipMesh = mesh(lips, TrackMaterials.roadLip(), 'road-lips');
  applyOcclusion(lipMesh.geometry, [...roadOcclusion(ctx), ...roadOcclusion(ctx)], 2);
  ctx.add(lipMesh);

  // Raised curbs in corners.
  const curbs: MeshData[] = [];
  for (const run of path.runs((s) => s.curb)) {
    const idx = path.runIndices(run);
    if (idx.length < 2) continue;
    curbs.push(
      extrudeAlongPath(
        path,
        idx,
        (s) => [
          { x: s.halfWidth - 0.05, y: 0.01, u: 0 },
          { x: s.halfWidth + 0.2, y: 0.08, u: 0.2 },
          { x: s.halfWidth + cw - 0.1, y: 0.08, u: 0.8 },
          { x: s.halfWidth + cw + 0.3, y: -0.4, u: 1 },
        ],
        { vScale: 8 },
      ),
      extrudeAlongPath(
        path,
        idx,
        (s) => [
          { x: -s.halfWidth - cw - 0.3, y: -0.4, u: 1 },
          { x: -s.halfWidth - cw + 0.1, y: 0.08, u: 0.8 },
          { x: -s.halfWidth - 0.2, y: 0.08, u: 0.2 },
          { x: -s.halfWidth + 0.05, y: 0.01, u: 0 },
        ],
        { vScale: 8 },
      ),
    );
  }
  if (curbs.length) ctx.add(mesh(mergeMeshData(curbs), TrackMaterials.curb(), 'curbs'));

  buildBarriers(ctx);
  buildStartLine(ctx);
}

/** Warm, dim tint applied to asphalt inside tunnels (sky IBL can't be occluded there). */
const TUNNEL_TINT: [number, number, number] = [0.78, 0.56, 0.34];

/**
 * Per-ring colour multiplier along the closed road loop: white in the open, warm and
 * dark inside tunnels with soft ramps at the portals.
 */
function roadOcclusion(ctx: BuildContext): Array<[number, number, number]> {
  const { path } = ctx;
  const n = path.samples.length;
  const ramp = 8;
  const inTunnel = path.samples.map((s) => s.kind === 'tunnel');
  const tint = path.samples.map((_, i): [number, number, number] => {
    let nearest = Infinity;
    for (let d = 0; d <= ramp; d++) {
      if (inTunnel[(i + d) % n] || inTunnel[(i - d + n) % n]) {
        nearest = d;
        break;
      }
    }
    const t = nearest === Infinity ? 1 : nearest / ramp;
    return [TUNNEL_TINT[0] + (1 - TUNNEL_TINT[0]) * t, TUNNEL_TINT[1] + (1 - TUNNEL_TINT[1]) * t, TUNNEL_TINT[2] + (1 - TUNNEL_TINT[2]) * t];
  });
  tint.push(tint[0]!); // closing ring of the loop
  return tint;
}

/** Write a vertex colour per ring (`perRing` vertices each). */
function applyOcclusion(geo: BufferGeometry, rings: Array<[number, number, number]>, perRing: number): void {
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) colors.set(rings[Math.floor(v / perRing)] ?? [1, 1, 1], v * 3);
  geo.setAttribute('color', new BufferAttribute(colors, 3));
}

/** Red/white crash barriers sitting on the terrain at the wall line (ground segments). */
function buildBarriers(ctx: BuildContext): void {
  const { path, terrain } = ctx;
  const parts: MeshData[] = [];
  const baseY = (s: TrackSample, side: 1 | -1): number => {
    const x = s.position.x + s.flatRight.x * s.wallOffset * side;
    const z = s.position.z + s.flatRight.z * s.wallOffset * side;
    return terrain.sample(x, z) - s.position.y;
  };
  for (const run of path.runs((s) => s.kind === 'ground')) {
    const idx = path.runIndices(run);
    if (idx.length < 2) continue;
    for (const side of [1, -1] as const) {
      parts.push(
        extrudeAlongPath(
          path,
          idx,
          (s) => {
            const w = s.wallOffset * side;
            const b = baseY(s, side);
            const t = 0.32 * side;
            // Profile ordered so faces point away from the inside of the barrier.
            const pts = [
              { x: w + t, y: b - 0.5, u: 0 },
              { x: w + t, y: b + 0.75, u: 0.35 },
              { x: w + t * 0.4, y: b + 1.05, u: 0.5 },
              { x: w - t * 0.4, y: b + 1.05, u: 0.6 },
              { x: w - t, y: b + 0.75, u: 0.75 },
              { x: w - t, y: b - 0.5, u: 1 },
            ];
            // Inner edge first on the right, outer edge first on the left → top faces point up.
            return side === 1 ? pts.reverse() : pts;
          },
          { frame: 'flat', vScale: 12 },
        ),
      );
    }
  }
  if (parts.length) {
    const m = mesh(mergeMeshData(parts), TrackMaterials.barrier(), 'barriers', { cast: true, receive: true });
    ctx.add(m);
  }
}

/** Checkered start/finish band and painted grid boxes. */
function buildStartLine(ctx: BuildContext): void {
  const { path } = ctx;
  const quad = (corners: Vector3[], uvs: number[]): BufferGeometry => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(corners.flatMap((v) => [v.x, v.y, v.z]), 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setIndex([0, 1, 2, 1, 3, 2]);
    g.computeVertexNormals();
    return g;
  };
  const at = (distance: number, lateral: number): Vector3 => path.anchorToWorld({ distance, lateral, height: 0.025 }).position.clone();

  const hw = path.anchorToWorld({ distance: 0 }).halfWidth;
  const band = 2.4;
  const cells = Math.round((hw * 2) / (band / 2));
  const line = new Mesh(
    quad([at(-band / 2, -hw), at(-band / 2, hw), at(band / 2, -hw), at(band / 2, hw)], [0, 0, cells / 8, 0, 0, 2 / 8, cells / 8, 2 / 8]),
    TrackMaterials.checker(),
  );
  line.name = 'start-line';
  line.receiveShadow = true;
  ctx.add(line);

  // Grid slot brackets: a short bar across the front plus two side ticks.
  const marks: BufferGeometry[] = [];
  for (let slot = 0; slot < 12; slot++) {
    const { distance, lateral: lat } = spawnSlotAnchor(path, slot);
    const front = distance + 1.9;
    marks.push(quad([at(front - 0.25, lat - 1.5), at(front - 0.25, lat + 1.5), at(front, lat - 1.5), at(front, lat + 1.5)], [0, 0, 1, 0, 0, 1, 1, 1]));
    for (const sx of [-1.5, 1.35]) {
      marks.push(quad([at(front - 1.6, lat + sx), at(front - 1.6, lat + sx + 0.15), at(front, lat + sx), at(front, lat + sx + 0.15)], [0, 0, 1, 0, 0, 1, 1, 1]));
    }
  }
  const grid = new Mesh(mergeGeometries(marks), TrackMaterials.linePaint());
  grid.receiveShadow = true;
  grid.name = 'grid-marks';
  ctx.add(grid);
}
