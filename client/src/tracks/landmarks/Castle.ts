import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, Mesh, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { Noise2D } from '@shared/math/noise';
import type { BuildContext } from '../BuildContext';
import type { KitId } from '../kits';
import { TrackMaterials } from '../materials';
import { placeSetPiece } from './placement';

const RADIUS = 35;
/** Courtyard half-size: corner towers sit on its corners. */
const YARD = 13;
/** Radius of the mound's flat top. */
const MOUND_TOP = 25;
const CORNER_W = 7;
const KEEP_W = 10;
const HEX_W = 7;
/** Tree spots on the mound top (degrees from the gate axis). */
const TREE_ANGLES = [70, 110, 160, 200, 250, 290];
const PENNANTS = ['#e8413a', '#ffcf3a', '#e8413a', '#3a7bff'];
const BAKE_ATTRS = ['position', 'normal', 'uv'] as const;

/** Non-indexed float copy of a (possibly quantized / interleaved) geometry with just position, normal and uv. */
function floatGeometry(src: BufferGeometry): BufferGeometry {
  const index = src.getIndex();
  const count = index ? index.count : src.getAttribute('position').count;
  const out = new BufferGeometry();
  for (const name of BAKE_ATTRS) {
    const size = name === 'uv' ? 2 : 3;
    const data = new Float32Array(count * size);
    if (src.hasAttribute(name)) {
      const a = src.getAttribute(name);
      for (let i = 0; i < count; i++) {
        const v = index ? index.getX(i) : i;
        for (let k = 0; k < size; k++) data[i * size + k] = a.getComponent(v, k);
      }
    }
    out.setAttribute(name, new BufferAttribute(data, size));
  }
  if (!src.hasAttribute('normal')) out.computeVertexNormals();
  return out;
}

/**
 * Merge every static mesh under `root` (kit pieces placed in root's space) into one
 * mesh per material — a few draw calls instead of one per kit part.
 */
export function bakeStatic(root: Object3D): Group {
  root.updateMatrixWorld(true);
  const byMat = new Map<Material, BufferGeometry[]>();
  const out = new Group();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    if (Array.isArray(m.material)) {
      const keep = m.clone();
      m.matrixWorld.decompose(keep.position, keep.quaternion, keep.scale);
      out.add(keep);
      return;
    }
    const list = byMat.get(m.material) ?? [];
    list.push(floatGeometry(m.geometry).applyMatrix4(m.matrixWorld));
    byMat.set(m.material, list);
  });
  for (const [mat, parts] of byMat) {
    const mesh = new Mesh(mergeGeometries(parts), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

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

/**
 * Storybook castle on a grassy mound: four kit corner towers joined by curtain
 * walls with a gate facing the track, a tall central keep flanked by hexagon
 * towers, banners on the keep and pennants swaying on every roof.
 */
export function buildCastle(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, RADIUS);
  if (!spot) return;
  const { kits, terrain } = ctx;
  const castle: KitId = 'castle';
  const has = (name: string): boolean => kits.has(castle, name);
  const g = new Group();
  g.name = 'castle';
  g.position.copy(spot.position);
  g.rotation.y = spot.yaw;

  // Mound: flat-topped grassy hill that swallows the local terrain relief.
  let hi = -Infinity;
  let lo = Infinity;
  for (let r = 0; r <= RADIUS; r += 5) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      const h = terrain.sample(spot.position.x + Math.cos(t) * r, spot.position.z + Math.sin(t) * r) - spot.position.y;
      if (r <= MOUND_TOP) hi = Math.max(hi, h);
      lo = Math.min(lo, h);
    }
  }
  const top = hi + 2.5;
  const bottom = lo - 3;
  const moundGeo = new CylinderGeometry(MOUND_TOP, RADIUS + 1, top - bottom, 24, 3).toNonIndexed();
  const noise = new Noise2D(ctx.def.terrain.seed + 31);
  const mp = moundGeo.getAttribute('position');
  const mc = new Float32Array(mp.count * 3);
  const grass = new Color('#6cc04a');
  const grassDark = new Color('#3f8f3a');
  const c = new Color();
  for (let i = 0; i < mp.count; i++) {
    const x = mp.getX(i);
    const y = mp.getY(i);
    const z = mp.getZ(i);
    const rr = Math.hypot(x, z);
    const isTop = y > (top - bottom) / 2 - 0.01 && rr < MOUND_TOP + 0.5;
    if (!isTop && rr > 1) {
      const n = 1 + noise.noise(x * 0.12, z * 0.12) * 0.05;
      mp.setXYZ(i, x * n, y, z * n);
    }
    c.copy(isTop ? grass : grassDark).lerp(grass, isTop ? 0 : 0.35 + noise.noise(x * 0.3, y * 0.3) * 0.25);
    mc.set([c.r, c.g, c.b], i * 3);
  }
  moundGeo.setAttribute('color', new BufferAttribute(mc, 3));
  moundGeo.translate(0, (top + bottom) / 2, 0);
  moundGeo.computeVertexNormals();
  const parts: BufferGeometry[] = [moundGeo];
  // Cobbled path from the gate across the mound top, then a ramp down towards the track.
  const fx = Math.sin(spot.yaw);
  const fz = Math.cos(spot.yaw);
  const foot = terrain.sample(spot.position.x + fx * (RADIUS + 2), spot.position.z + fz * (RADIUS + 2)) - spot.position.y;
  const walk = tint(new BoxGeometry(6, 0.4, MOUND_TOP - YARD + 1), '#d8c6a4');
  walk.translate(0, top, (MOUND_TOP + YARD) / 2);
  const run = RADIUS + 2 - MOUND_TOP;
  const ramp = tint(new BoxGeometry(6, 0.6, Math.hypot(run, top - foot) + 0.6), '#c9b89a');
  ramp.rotateX(Math.atan2(top - foot, run));
  ramp.translate(0, (top + foot) / 2, MOUND_TOP + run / 2);
  parts.push(walk, ramp);
  // Flowering shrubs dotted over the slopes.
  const bloom = ['#ff7ab0', '#ffd84a', '#ffffff', '#b98cff'];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + noise.noise(i, 3) * 0.3;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.25) continue;
    const k = 0.25 + (i % 3) * 0.25;
    const r = MOUND_TOP + (RADIUS + 1 - MOUND_TOP) * k;
    const y = top - (top - bottom) * k * 0.9;
    const bush = tint(new IcosahedronGeometry(1.4 + (i % 2) * 0.6, 0), '#4fae3e');
    bush.scale(1, 0.75, 1);
    bush.translate(Math.sin(a) * r, y + 0.6, Math.cos(a) * r);
    const flower = tint(new IcosahedronGeometry(0.5, 0), bloom[i % bloom.length]!);
    flower.translate(Math.sin(a) * r, y + 1.6, Math.cos(a) * r);
    parts.push(bush, flower);
  }
  const ground = new Mesh(mergeGeometries(parts), TrackMaterials.shell());
  ground.receiveShadow = true;
  ground.castShadow = true;
  g.add(ground);

  const kit = new Group();
  kit.position.y = top;
  const flags: Object3D[] = [];
  const piece = (name: string, s: number, x: number, y: number, z: number, rotY = 0): number => {
    if (!has(name)) return 0;
    const o = kits.instantiate(castle, name);
    o.scale.setScalar(s);
    o.position.set(x, y, z);
    o.rotation.y = rotY;
    kit.add(o);
    return kits.size(castle, name).y * s;
  };
  const poles: BufferGeometry[] = [];
  const pennant = new BufferGeometry();
  pennant.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, -1.8, 0, 4.2, -0.9, 0], 3));
  pennant.computeVertexNormals();
  /** Pole with a pennant swinging from its top. */
  const flag = (x: number, y: number, z: number, h: number): void => {
    const pole = tint(new CylinderGeometry(0.12, 0.18, h, 5), '#5b4635');
    pole.translate(x, top + y + h / 2, z);
    const knob = tint(new IcosahedronGeometry(0.35, 0), '#ffd23a');
    knob.translate(x, top + y + h + 0.2, z);
    poles.push(pole, knob);
    const f = new Mesh(pennant, TrackMaterials.paint(PENNANTS[flags.length % PENNANTS.length]!));
    f.position.set(x, top + y + h - 0.15, z);
    f.scale.setScalar(h / 5);
    f.userData.phase = flags.length * 1.37;
    flags.push(f);
    g.add(f);
  };
  /** Stack of square tower pieces; returns the roof apex height. */
  const squareTower = (x: number, z: number, w: number, mids: string[]): number => {
    let y = piece('tower-square-base', w, x, 0, z);
    for (const m of mids) y += piece(m, w, x, y, z);
    return y + piece('tower-square-top-roof-high', w, x, y, z);
  };

  // Corner towers and curtain walls.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const apex = squareTower(sx * YARD, sz * YARD, CORNER_W, ['tower-square-mid-windows']);
    flag(sx * YARD, apex - 1, sz * YARD, 5);
  }
  const span = 2 * YARD - CORNER_W;
  const tiles = 3;
  const tw = span / tiles;
  for (let k = 0; k < tiles; k++) {
    const u = -span / 2 + tw * (k + 0.5);
    piece('wall', tw, u, 0, -YARD);
    piece('wall', tw, -YARD, 0, u, Math.PI / 2);
    piece('wall', tw, YARD, 0, u, Math.PI / 2);
    if (k !== 1) piece('wall', tw, u, 0, YARD);
  }
  // Gatehouse facing the track.
  piece('gate', tw, 0, 0, YARD, Math.PI / 2);

  // Keep with hexagon towers either side.
  const keepZ = -3;
  const keepApex = squareTower(0, keepZ, KEEP_W, ['tower-square-mid-windows', 'tower-square-mid', 'tower-square-mid-windows']);
  flag(0, keepApex - 1.2, keepZ, 7);
  for (const sx of [-1, 1]) {
    const x = sx * (KEEP_W / 2 + HEX_W / 2 + 0.5);
    let y = piece('tower-hexagon-base', HEX_W, x, 0, keepZ - 1);
    for (let k = 0; k < 3; k++) y += piece('tower-hexagon-mid', HEX_W, x, y, keepZ - 1);
    y += piece('tower-hexagon-roof', HEX_W, x, y, keepZ - 1);
    flag(x, y - 1, keepZ - 1, 5);
  }
  // Trees round the mound top, between the corner towers.
  TREE_ANGLES.forEach((deg, i) => {
    const name = i % 3 === 0 ? 'tree-small' : 'tree-large';
    if (!has(name)) return;
    const a = (deg * Math.PI) / 180;
    const t = kits.instantiate(castle, name, 8 + (i % 3) * 2);
    t.position.set(Math.sin(a) * (MOUND_TOP - 3), 0, Math.cos(a) * (MOUND_TOP - 3));
    kit.add(t);
  });
  g.add(new Mesh(mergeGeometries(poles), TrackMaterials.shell()));
  const baked = bakeStatic(kit);
  baked.position.y = top;
  g.add(baked);

  // Long banners hanging on the keep's track face.
  const banners: Object3D[] = [];
  if (has('flag-banner-long')) {
    for (const sx of [-1, 1]) {
      const b = kits.instantiate(castle, 'flag-banner-long', 13);
      b.rotation.y = Math.PI / 2;
      const pivot = new Group();
      pivot.position.set(sx * 2.6, top + KEEP_W * 2.9, keepZ + KEEP_W * 0.47 + 0.4);
      b.position.y = -13;
      pivot.add(b);
      banners.push(pivot);
      g.add(pivot);
    }
  }

  g.traverse((o) => {
    if ((o as Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  ctx.add(g);
  ctx.updatables.push({
    update: (_dt, time) => {
      for (const f of flags) {
        const ph = f.userData.phase as number;
        f.rotation.y = ph + Math.sin(time * 1.4 + ph) * 0.45;
        f.rotation.x = Math.sin(time * 5 + ph * 2) * 0.12;
      }
      banners.forEach((b, i) => (b.rotation.x = Math.sin(time * 1.1 + i * 1.9) * 0.05));
    },
  });
}
