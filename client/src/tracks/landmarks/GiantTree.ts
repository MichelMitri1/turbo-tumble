import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { Noise2D } from '@shared/math/noise';
import { SeededRandom } from '@shared/math/random';
import { smoothstep } from '@shared/math/scalar';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { bakeStatic } from './Castle';
import { placeSetPiece } from './placement';

const RADIUS = 28;
const TRUNK_H = 24;
const LEAF_COUNT = 110;
const FOLIAGE = ['#ff6a1a', '#e8361f', '#ffb627', '#c42a1a', '#ff8c2a'];
const BARK = '#6b4630';
const BARK_DARK = '#4a2f20';
const PLANK = '#a8703f';
const UP = new Vector3(0, 1, 0);
const GROUND_LEAF = new Color('#7a5a2a');
const GRASS = new Color('#9c9a52');

/** Flat vertex colour on a non-indexed copy of `geo`, ready for merging into one vertex-coloured mesh. */
function tint(geo: BufferGeometry, color: Color | string): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) data.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(data, 3));
  return g;
}

/** Tapered cylinder running from `a` (radius r0) to `b` (radius r1). */
function limb(a: Vector3, b: Vector3, r0: number, r1: number, segs = 7): BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const g = new CylinderGeometry(r1, r0, len, segs, 2);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** Deterministic 0..1 hash (leaf respawn spots). */
const hash = (n: number): number => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Maple Glen's ancient maple: a twisted trunk on flaring roots, a towering
 * blaze of orange / red / gold foliage, a treehouse with a rope ladder, a carpet
 * of fallen leaves and leaves drifting down and spinning all the time.
 */
export function buildGiantTree(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, RADIUS);
  if (!spot) return;
  const { kits, terrain } = ctx;
  const rng = new SeededRandom(ctx.def.terrain.seed + 53);
  const noise = new Noise2D(ctx.def.terrain.seed + 54);
  const g = new Group();
  g.name = 'giantTree';
  g.position.copy(spot.position);
  g.rotation.y = spot.yaw;
  const cos = Math.cos(spot.yaw);
  const sin = Math.sin(spot.yaw);
  const groundAt = (x: number, z: number): number =>
    terrain.sample(spot.position.x + x * cos + z * sin, spot.position.z - x * sin + z * cos) - spot.position.y;
  let low = Infinity;
  for (let a = 0; a < 12; a++) for (const r of [0, 6, 12, 20]) low = Math.min(low, groundAt(Math.cos(a) * r, Math.sin(a) * r));
  const base = Math.min(0, low) - 1.5;

  // Twisted, fluted trunk flaring at the foot.
  const wood: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(2.4, 4.2, TRUNK_H, 14, 12);
  const tp = trunk.getAttribute('position');
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i);
    const y = tp.getY(i);
    const z = tp.getZ(i);
    const t = (y + TRUNK_H / 2) / TRUNK_H;
    const a = Math.atan2(z, x) + t * 1.3;
    const r = Math.hypot(x, z) * (1 + 0.13 * Math.sin(a * 5 - t * 4) + Math.pow(1 - t, 5) * 0.9);
    tp.setXYZ(i, Math.cos(a) * r + Math.sin(t * Math.PI) * 0.9, y + TRUNK_H / 2 + base, Math.sin(a) * r);
  }
  const trunkGeo = trunk.toNonIndexed();
  const tc = new Float32Array(trunkGeo.getAttribute('position').count * 3);
  const c = new Color();
  const tpos = trunkGeo.getAttribute('position');
  for (let i = 0; i < tpos.count; i++) {
    const groove = Math.sin(Math.atan2(tpos.getZ(i), tpos.getX(i)) * 5 - tpos.getY(i) * 0.2);
    c.set(BARK).lerp(new Color(BARK_DARK), groove > 0.3 ? 0.7 : 0);
    tc.set([c.r, c.g, c.b], i * 3);
  }
  trunkGeo.setAttribute('color', new BufferAttribute(tc, 3));
  wood.push(trunkGeo);
  // Roots spreading out and diving into the ground.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const reach = rng.range(9, 13);
    const from = new Vector3(Math.cos(a) * 2.5, base + 3.5, Math.sin(a) * 2.5);
    const mid = new Vector3(Math.cos(a) * reach * 0.55, groundAt(Math.cos(a) * reach * 0.55, Math.sin(a) * reach * 0.55) + 0.6, Math.sin(a) * reach * 0.55);
    const end = new Vector3(Math.cos(a) * reach, groundAt(Math.cos(a) * reach, Math.sin(a) * reach) - 1, Math.sin(a) * reach);
    wood.push(tint(limb(from, mid, 1.8, 1.0), BARK), tint(limb(mid, end, 1.0, 0.25), BARK));
  }
  // Main boughs, each ending in a foliage cluster.
  const top = base + TRUNK_H;
  const clusters: Array<{ at: Vector3; r: number }> = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const from = new Vector3(Math.cos(a) * 1.2, top - 3 - (i % 2) * 3, Math.sin(a) * 1.2);
    const elbow = new Vector3(Math.cos(a) * 7, top + 2 + (i % 3), Math.sin(a) * 7);
    const end = new Vector3(Math.cos(a + 0.3) * 13, top + 7 + (i % 2) * 3, Math.sin(a + 0.3) * 13);
    wood.push(tint(limb(from, elbow, 1.5, 0.9), BARK), tint(limb(elbow, end, 0.9, 0.35), BARK));
    clusters.push({ at: end, r: 7 }, { at: elbow.clone().add(new Vector3(0, 3, 0)), r: 6 });
  }
  clusters.push(
    { at: new Vector3(0, top + 6, 0), r: 9 },
    { at: new Vector3(0, top + 12, 0), r: 10 },
    { at: new Vector3(5, top + 15, -4), r: 7 },
    { at: new Vector3(-4, top + 16, 4), r: 7 },
    { at: new Vector3(1, top + 19, -1), r: 7 },
  );

  // Treehouse on the track side: platform, cabin, railing and a rope ladder.
  const thY = base + 13.5;
  const thZ = 6.6;
  wood.push(tint(new BoxGeometry(7.5, 0.5, 6).translate(0, thY, thZ), PLANK));
  for (const sx of [-1, 1]) wood.push(tint(limb(new Vector3(sx * 1.2, thY - 6, 2.4), new Vector3(sx * 2.8, thY - 0.3, thZ + 1.5), 0.3, 0.25, 5), BARK_DARK));
  wood.push(tint(new BoxGeometry(5, 3.6, 4).translate(0, thY + 2.05, thZ - 0.6), '#c48a52'));
  const roof = new ConeGeometry(4.1, 2.6, 4);
  roof.rotateY(Math.PI / 4);
  roof.scale(1.15, 1, 1);
  wood.push(tint(roof.translate(0, thY + 5.15, thZ - 0.6), '#d8432f'));
  wood.push(tint(new BoxGeometry(1.2, 2.2, 0.2).translate(-1.2, thY + 1.35, thZ + 1.45), '#5a3622'));
  wood.push(tint(new BoxGeometry(1.2, 1.1, 0.2).translate(1.2, thY + 2.4, thZ + 1.45), '#2c2a3a'));
  for (const x of [-3.5, -1.2, 1.2, 3.5]) wood.push(tint(new BoxGeometry(0.2, 1.1, 0.2).translate(x, thY + 0.8, thZ + 2.8), PLANK));
  wood.push(tint(new BoxGeometry(7.2, 0.2, 0.2).translate(0, thY + 1.35, thZ + 2.8), PLANK));
  const ladderZ = thZ + 3.1;
  const foot = groundAt(2.4, ladderZ + 0.6);
  for (const x of [1.8, 3]) wood.push(tint(limb(new Vector3(x, foot, ladderZ + 0.6), new Vector3(x, thY + 1.35, ladderZ), 0.06, 0.06, 4), '#d9c08a'));
  for (let y = foot + 0.6; y < thY; y += 0.75) {
    const k = (y - foot) / (thY + 1.35 - foot);
    wood.push(tint(new BoxGeometry(1.4, 0.12, 0.18).translate(2.4, y, ladderZ + 0.6 * (1 - k)), '#8a5a33'));
  }
  const woodMesh = new Mesh(mergeGeometries(wood), TrackMaterials.shell());
  g.add(woodMesh);

  // Foliage: lumpy icosahedron clusters, each blob a fall colour with per-face shading jitter.
  const palette = FOLIAGE.map((h) => new Color(h));
  const leaves: BufferGeometry[] = [];
  for (const cl of clusters) {
    const blobs = cl.r > 8 ? 7 : 5;
    for (let k = 0; k < blobs; k++) {
      const r = cl.r * rng.range(0.5, 0.8);
      const blob = new IcosahedronGeometry(r, 1);
      blob.scale(1, 0.8, 1);
      blob.translate(cl.at.x + rng.range(-0.75, 0.75) * cl.r, cl.at.y + rng.range(-0.3, 0.5) * cl.r, cl.at.z + rng.range(-0.75, 0.75) * cl.r);
      const tone = palette[rng.int(0, palette.length - 1)]!;
      const n = blob.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i += 3) {
        c.copy(tone).offsetHSL(rng.range(-0.015, 0.015), 0, rng.range(-0.05, 0.05) + (blob.getAttribute('position').getY(i) - top - 10) * 0.004);
        for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], (i + v) * 3);
      }
      blob.setAttribute('color', new BufferAttribute(col, 3));
      leaves.push(blob);
    }
  }
  const crown = mergeGeometries(leaves);
  const canopy = new Mesh(crown, TrackMaterials.shell());
  g.add(canopy);

  // Carpet of fallen leaves draped over the ground.
  const carpet = new RingGeometry(0.01, RADIUS - 8, 32, 5).rotateX(-Math.PI / 2).toNonIndexed();
  const kp = carpet.getAttribute('position');
  const kc = new Float32Array(kp.count * 3);
  for (let i = 0; i < kp.count; i++) {
    const a = Math.atan2(kp.getZ(i), kp.getX(i));
    const f = 1 + noise.noise(Math.cos(a) * 2, Math.sin(a) * 2) * 0.22;
    const x = kp.getX(i) * f;
    const z = kp.getZ(i) * f;
    kp.setXYZ(i, x, groundAt(x, z) + 0.2, z);
    c.copy(palette[Math.floor(((noise.noise(x * 0.2, z * 0.2) + 1) / 2) * 0.999 * palette.length)]!).lerp(GROUND_LEAF, 0.35).lerp(GRASS, smoothstep(0.55, 1, Math.hypot(x, z) / (RADIUS - 8)));
    kc.set([c.r, c.g, c.b], i * 3);
  }
  carpet.setAttribute('color', new BufferAttribute(kc, 3));
  carpet.computeVertexNormals();
  const carpetMesh = new Mesh(carpet, TrackMaterials.vertexColor());
  carpetMesh.receiveShadow = true;
  g.add(carpetMesh);

  // Smaller autumn trees round the glade (baked).
  const kit = new Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng.range(-0.15, 0.15);
    if (Math.abs(Math.atan2(Math.cos(a), Math.sin(a))) < 0.5) continue; // keep the track-side view open
    const name = i % 2 ? 'tree-autumn-tall' : 'tree-autumn';
    if (!kits.has('survival', name)) continue;
    const r = rng.range(RADIUS - 8, RADIUS - 3);
    const t = kits.instantiate('survival', name, rng.range(9, 14));
    t.position.set(Math.cos(a) * r, groundAt(Math.cos(a) * r, Math.sin(a) * r) - 0.3, Math.sin(a) * r);
    t.rotation.y = rng.range(0, Math.PI * 2);
    kit.add(t);
  }
  g.add(bakeStatic(kit));

  g.traverse((o) => {
    if ((o as Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  carpetMesh.castShadow = false;

  // Falling leaves: instanced quads drifting down, spinning, respawning in the crown.
  const leafGeo = new PlaneGeometry(0.9, 0.7);
  const falling = new InstancedMesh(leafGeo, TrackMaterials.paint('#ffffff'), LEAF_COUNT);
  for (let i = 0; i < LEAF_COUNT; i++) falling.setColorAt(i, palette[i % palette.length]!);
  falling.frustumCulled = false;
  g.add(falling);
  const fallTop = top + 10;
  const fallRange = fallTop - low;
  const dummy = new Object3D();
  ctx.add(g);
  ctx.updatables.push({
    update: (_dt, time) => {
      canopy.rotation.z = Math.sin(time * 0.5) * 0.006;
      canopy.rotation.x = Math.sin(time * 0.37 + 1) * 0.005;
      for (let i = 0; i < LEAF_COUNT; i++) {
        const speed = 1.1 + hash(i) * 0.9;
        const u = (time * speed) / fallRange + hash(i + 0.5);
        const cycle = Math.floor(u);
        const k = u - cycle;
        const a = hash(i * 7 + cycle) * Math.PI * 2;
        const r = 3 + hash(i * 13 + cycle) * 15;
        dummy.position.set(
          Math.cos(a) * r + Math.sin(time * 1.3 + i) * 1.4 + k * 3,
          fallTop - k * fallRange,
          Math.sin(a) * r + Math.cos(time * 1.1 + i * 0.7) * 1.4,
        );
        dummy.rotation.set(time * 2.1 + i, time * 1.3 + i * 0.5, Math.sin(time * 3 + i) * 0.8);
        dummy.updateMatrix();
        falling.setMatrixAt(i, dummy.matrix);
      }
      falling.instanceMatrix.needsUpdate = true;
    },
  });
}
