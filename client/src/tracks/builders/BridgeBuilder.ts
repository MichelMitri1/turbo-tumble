import { BoxGeometry, CylinderGeometry, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { extrudeAlongPath, mergeMeshData, type MeshData, type ProfilePoint } from '@shared/track/Extrude';
import type { TrackPath } from '@shared/track/TrackPath';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { toGeometry } from '../../rendering/meshData';
import { sampleQuaternion } from '../frames';

const EXTEND = 5;
const ARCH_HEIGHT = 13;
const RAIL_OFFSET = 0.75;

/** Closed rectangle profile centred at (x, y). */
function box(x: number, y: number, w: number, h: number): ProfilePoint[] {
  return [
    { x: x - w / 2, y: y - h / 2 },
    { x: x - w / 2, y: y + h / 2 },
    { x: x + w / 2, y: y + h / 2 },
    { x: x + w / 2, y: y - h / 2 },
    { x: x - w / 2, y: y - h / 2 },
  ];
}

function extendedRun(path: TrackPath, run: [number, number]): number[] {
  const n = path.samples.length;
  const [a, b] = run;
  return path.runIndices([(a - EXTEND + n) % n, (b + EXTEND) % n]);
}

export function buildBridges(ctx: BuildContext): void {
  const { path } = ctx;
  for (const run of path.runs((s) => s.kind === 'bridge')) buildBridge(ctx, run);
}

function buildBridge(ctx: BuildContext, run: [number, number]): void {
  const { path, terrain } = ctx;
  const idx = extendedRun(path, run);
  const core = path.runIndices(run);
  const coreStart = core[0]!;
  const coreLen = core.length;
  /** 0..1 along the core bridge span (clamped outside). */
  const spanT = (i: number): number => {
    const k = (i - coreStart + path.samples.length) % path.samples.length;
    return Math.min(1, Math.max(0, k / (coreLen - 1)));
  };
  const archY = (i: number): number => 1.1 + ARCH_HEIGHT * Math.sin(Math.PI * spanT(i));

  // Deck girder + sidewalks (outward-facing).
  const girder = extrudeAlongPath(
    path,
    idx,
    (s) => [
      { x: -s.halfWidth, y: 0.03 },
      { x: -s.halfWidth - 1.1, y: 0.03 },
      { x: -s.halfWidth - 1.1, y: -1.7 },
      { x: s.halfWidth + 1.1, y: -1.7 },
      { x: s.halfWidth + 1.1, y: 0.03 },
      { x: s.halfWidth, y: 0.03 },
    ],
    { flip: true, vScale: 6 },
  );
  const deck = new Mesh(toGeometry(girder), TrackMaterials.paint('#e4ded3'));
  deck.castShadow = true;
  deck.receiveShadow = true;
  deck.name = 'bridge-deck';
  ctx.add(deck);

  // Rails (top + mid) and the two arches.
  const steel: MeshData[] = [];
  for (const side of [-1, 1]) {
    steel.push(extrudeAlongPath(path, idx, (s) => box(side * (s.halfWidth + RAIL_OFFSET), 1.05, 0.16, 0.14)));
    steel.push(extrudeAlongPath(path, idx, (s) => box(side * (s.halfWidth + RAIL_OFFSET), 0.6, 0.12, 0.1)));
  }
  const rails = new Mesh(toGeometry(mergeMeshData(steel)), TrackMaterials.paint('#f6f3ee'));
  rails.castShadow = true;
  rails.name = 'bridge-rails';
  ctx.add(rails);

  const arches: MeshData[] = [];
  for (const side of [-1, 1]) {
    arches.push(extrudeAlongPath(path, core, (s) => box(side * (s.halfWidth + RAIL_OFFSET), archY(s.index), 0.55, 0.9)));
  }
  const archMesh = new Mesh(toGeometry(mergeMeshData(arches)), TrackMaterials.paint('#e8413a'));
  archMesh.castShadow = true;
  archMesh.name = 'bridge-arches';
  ctx.add(archMesh);

  // Instanced details: posts, hangers, cross braces, piers.
  const q = new Quaternion();
  const p = new Vector3();
  const sc = new Vector3();
  const posts: Matrix4[] = [];
  const hangers: Matrix4[] = [];
  const braces: Matrix4[] = [];
  const columns: Matrix4[] = [];
  const caps: Matrix4[] = [];

  idx.forEach((i, k) => {
    const s = path.samples[i]!;
    sampleQuaternion(s, true, q);
    for (const side of [-1, 1]) {
      const lateral = side * (s.halfWidth + RAIL_OFFSET);
      if (k % 2 === 0) {
        p.copy(s.position).addScaledVector(s.right, lateral);
        posts.push(new Matrix4().compose(p, q, sc.set(0.14, 1.12, 0.14)));
      }
      const t = spanT(i);
      if (k % 3 === 0 && t > 0.03 && t < 0.97) {
        const top = archY(i);
        p.copy(s.position).addScaledVector(s.right, lateral).addScaledVector(s.up, 1.1);
        hangers.push(new Matrix4().compose(p, q, sc.set(0.07, top - 1.1, 0.07)));
      }
    }
  });

  // Cross braces near the arch crown.
  for (const t of [0.3, 0.42, 0.5, 0.58, 0.7]) {
    const s = path.samples[core[Math.round(t * (coreLen - 1))]!]!;
    sampleQuaternion(s, true, q);
    p.copy(s.position).addScaledVector(s.up, archY(s.index) - 0.1);
    braces.push(new Matrix4().compose(p, q, sc.set((s.halfWidth + RAIL_OFFSET) * 2, 0.35, 0.35)));
  }

  // Piers: twin columns + cap every ~22 m.
  for (let k = 6; k < coreLen - 4; k += 11) {
    const s = path.samples[core[k]!]!;
    sampleQuaternion(s, false, q);
    for (const side of [-1, 1]) {
      p.copy(s.position).addScaledVector(s.flatRight, side * s.halfWidth * 0.55);
      const ground = terrain.sample(p.x, p.z) - 1.5;
      const top = s.position.y - 1.7;
      const h = Math.max(0.5, top - ground);
      p.y = ground;
      columns.push(new Matrix4().compose(p, q, sc.set(1.25, h, 1.25)));
    }
    p.copy(s.position).addScaledVector(s.up, -2.1);
    caps.push(new Matrix4().compose(p, q, sc.set(s.halfWidth * 1.6, 0.8, 1.9)));
  }

  const post = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const hanger = new CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
  const column = new CylinderGeometry(1, 1.15, 1, 14).translate(0, 0.5, 0);
  const unitBox = new BoxGeometry(1, 1, 1);
  addInstances(ctx, post, TrackMaterials.paint('#e8413a'), posts, 'bridge-posts');
  addInstances(ctx, hanger, TrackMaterials.paint('#f6f3ee'), hangers, 'bridge-hangers');
  addInstances(ctx, unitBox, TrackMaterials.paint('#e8413a'), braces, 'bridge-braces');
  addInstances(ctx, column, TrackMaterials.paint('#d9d2c5'), columns, 'bridge-columns');
  addInstances(ctx, unitBox, TrackMaterials.paint('#d9d2c5'), caps, 'bridge-caps');

  // Keep scenery off the bridge approaches.
  for (const i of core) {
    if (i % 6 !== 0) continue;
    const s = path.samples[i]!;
    ctx.footprints.push({ x: s.position.x, z: s.position.z, r: s.halfWidth + 14 });
  }
}

function addInstances(ctx: BuildContext, geo: InstancedMesh['geometry'], mat: InstancedMesh['material'], list: Matrix4[], name: string): void {
  if (!list.length) return;
  const inst = new InstancedMesh(geo, mat, list.length);
  list.forEach((mm, i) => inst.setMatrixAt(i, mm));
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingSphere();
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.name = name;
  ctx.add(inst);
}
