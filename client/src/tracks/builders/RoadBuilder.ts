import { BufferAttribute, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { extrudeAlongPath, mergeMeshData, type MeshData } from '@shared/track/Extrude';
import { loopRuns, wallRuns } from '@shared/track/TrackGeometry';
import { barrierGlow, barrierTextureFor, curbTextureFor, surfaceClock, surfaceFor, surfaceMaterial, type Surface } from '../surfaces';
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

  void loop;
  const surface = surfaceFor(path.def);
  const tint = roadOcclusion(ctx);
  const runs = loopRuns(path, (i) => !path.samples[i]!.gap);
  const roadParts = runs.map((idx) => {
    const g = toGeometry(
      extrudeAlongPath(path, idx, (s) => [{ x: -s.halfWidth, y: 0, u: 0 }, { x: s.halfWidth, y: 0, u: 1 }], { vScale: 16, normals: true }),
    );
    applyOcclusion(g, idx.map((i) => tint[i]!), 2);
    return g;
  });
  const road = new Mesh(roadParts.length === 1 ? roadParts[0]! : mergeGeometries(roadParts), surfaceMaterial(surface));
  if (surface === 'rainbow') ctx.updatables.push({ update: (_dt, time) => (surfaceClock.value = time) });
  road.name = 'road';
  road.receiveShadow = true;
  ctx.add(road);

  // Dark lip from the road edge down into the terrain (hides the shoulder step).
  const lipParts = runs.map((idx) => {
    const g = toGeometry(
      mergeMeshData([
        extrudeAlongPath(path, idx, (s) => [{ x: s.halfWidth, y: 0 }, { x: s.halfWidth + 0.35, y: -0.5 }]),
        extrudeAlongPath(path, idx, (s) => [{ x: -s.halfWidth - 0.35, y: -0.5 }, { x: -s.halfWidth, y: 0 }]),
      ]),
    );
    const rings = idx.map((i) => tint[i]!);
    applyOcclusion(g, [...rings, ...rings], 2);
    return g;
  });
  const lipMesh = new Mesh(lipParts.length === 1 ? lipParts[0]! : mergeGeometries(lipParts), TrackMaterials.roadLip());
  lipMesh.name = 'road-lips';
  lipMesh.receiveShadow = true;
  ctx.add(lipMesh);

  buildFloatingDeck(ctx, surface);

  // Raised curbs in corners.
  const curbs: MeshData[] = [];
  for (const run of path.runs((s) => s.curb && !s.gap)) {
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
  const curbTex = curbTextureFor(surface);
  const curbMat = curbTex ? new MeshStandardMaterial({ map: curbTex, roughness: 0.7, ...(surface === 'neon' || surface === 'rainbow' || surface === 'starlight' || surface === 'comet' ? { emissive: new Color('#ffffff'), emissiveMap: curbTex, emissiveIntensity: 0.5 } : {}) }) : TrackMaterials.curb();
  if (curbs.length) ctx.add(mesh(mergeMeshData(curbs), curbMat, 'curbs'));

  buildBarriers(ctx, surface);
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
function buildBarriers(ctx: BuildContext, surface: Surface): void {
  const { path, terrain } = ctx;
  const parts: MeshData[] = [];
  const baseY = (s: TrackSample, side: 1 | -1): number => {
    const x = s.position.x + s.flatRight.x * s.wallOffset * side;
    const z = s.position.z + s.flatRight.z * s.wallOffset * side;
    return terrain.sample(x, z) - s.position.y;
  };
  const floating = Boolean(path.def.space);
  // Ground stretches with a wall get crash barriers (bridges / tunnels have their own).
  const groundPieces = (idx: number[]): number[][] => {
    const out: number[][] = [];
    let cur: number[] = [];
    for (const i of idx) {
      if (path.samples[i]!.kind === 'ground') cur.push(i);
      else if (cur.length) {
        out.push(cur);
        cur = [];
      }
    }
    if (cur.length) out.push(cur);
    return out.filter((r) => r.length > 1);
  };
  for (const side of [1, -1] as const) {
    for (const idx of wallRuns(path, side === 1 ? 'right' : 'left').flatMap(groundPieces)) {
      parts.push(
        extrudeAlongPath(
          path,
          idx,
          (s) => {
            const w = s.wallOffset * side;
            const b = floating ? -0.6 : baseY(s, side);
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
    const tex = barrierTextureFor(surface);
    const mat = tex
      ? new MeshStandardMaterial({ map: tex, roughness: 0.75, ...(barrierGlow(surface) ? { emissive: new Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.45 } : {}) })
      : TrackMaterials.barrier();
    const m = mesh(mergeMeshData(parts), mat, 'barriers', { cast: true, receive: true });
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

// ------------------------------------------------------------------ road styles & floating decks

const EDGE_COLORS: Partial<Record<Surface, string>> = { rainbow: '#ffffff', neon: '#3fe8ff', starlight: '#8af0ff', comet: '#5affd8', cloud: '#ffd84a', basalt: '#ff7a2a', ice: '#bff0ff' };
const DECK_COLORS: Partial<Record<Surface, string>> = { cloud: '#e8ecf6', rainbow: '#3a2a6a', starlight: '#1a1a4a', comet: '#0a2a2a', neon: '#22203a', beachSand: '#8a6a48', flagstone: '#5a5a50', boardwalk: '#4a3626' };

/**
 * Over the void (and everywhere on floating courses) the road is a slab: an underside
 * plus glowing edge lines so the drop reads clearly.
 */
function buildFloatingDeck(ctx: BuildContext, surface: Surface): void {
  const { path } = ctx;
  const floating = Boolean(path.def.space);
  const runs = loopRuns(path, (i) => (floating || path.samples[i]!.open) && !path.samples[i]!.gap);
  if (!runs.length) return;
  const under: MeshData[] = [];
  const edges: MeshData[] = [];
  for (const idx of runs) {
    under.push(
      extrudeAlongPath(path, idx, (s) => [
        { x: s.halfWidth + 0.35, y: -0.5 },
        { x: s.halfWidth * 0.55, y: -1.9 },
        { x: -s.halfWidth * 0.55, y: -1.9 },
        { x: -s.halfWidth - 0.35, y: -0.5 },
      ]),
    );
    for (const side of [1, -1]) {
      edges.push(
        extrudeAlongPath(path, idx, (s) => {
          const pts = [
            { x: side * (s.halfWidth - 0.05), y: 0.04 },
            { x: side * (s.halfWidth + 0.4), y: 0.04 },
          ];
          return side === 1 ? pts : pts.reverse();
        }),
      );
    }
  }
  const deck = mesh(mergeMeshData(under), new MeshStandardMaterial({ color: DECK_COLORS[surface] ?? '#2c2f3c', roughness: 0.95, side: DoubleSide }), 'road-deck');
  ctx.add(deck);
  const edgeColor = EDGE_COLORS[surface] ?? '#ffd23f';
  const glow = new Mesh(toGeometry(mergeMeshData(edges)), new MeshBasicMaterial({ color: new Color(edgeColor).multiplyScalar(1.4) }));
  glow.name = 'void-edges';
  ctx.add(glow);
}
