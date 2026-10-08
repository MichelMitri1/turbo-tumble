import {
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { placeSetPiece } from './placement';

const RADIUS = 76;
const SAND_LIGHT = '#f0d49c';
const SAND_DARK = '#cfa866';
const STONE = '#cf9f62';
const STONE_DARK = '#b98f55';
const UP = new Vector3(0, 1, 0);

/** Pyramid layout in local space (+Z faces the track): centre, base width, height, steps. */
const PYRAMIDS = [
  { x: 8, z: -22, base: 64, height: 42, steps: 11 },
  { x: -46, z: -10, base: 40, height: 26, steps: 8 },
  { x: 52, z: 24, base: 26, height: 17, steps: 6 },
] as const;

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

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string): BufferGeometry {
  return tint(new BoxGeometry(w, h, d).translate(x, y, z), color);
}

/** Tapered cylinder running from `a` (radius r0) to `b` (radius r1). */
function limb(a: Vector3, b: Vector3, r0: number, r1: number, segs = 6): BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const g = new CylinderGeometry(r1, r0, len, segs);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir.normalize()));
  return g.translate(a.x, a.y, a.z);
}

/** Palm: banded curved trunk (into `trunks`) and a crown of drooping fronds (returned for swaying). */
function palm(trunks: BufferGeometry[], rng: SeededRandom, x: number, y: number, z: number, h: number): Mesh {
  const lean = rng.range(0, Math.PI * 2);
  const bend = rng.range(1.5, 3.5);
  let prev = new Vector3(x, y - 0.5, z);
  const segs = 6;
  for (let k = 1; k <= segs; k++) {
    const t = k / segs;
    const next = new Vector3(x + Math.cos(lean) * bend * t * t, y + h * t, z + Math.sin(lean) * bend * t * t);
    trunks.push(tint(limb(prev, next, 0.55 - t * 0.2, 0.5 - t * 0.2), k % 2 ? '#8a6a44' : '#a07c50'));
    prev = next;
  }
  const fronds: BufferGeometry[] = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const f = new ConeGeometry(1.1, 6.5, 4);
    f.scale(0.25, 1, 1);
    f.translate(0, 3.25, 0);
    f.rotateZ(-Math.PI / 2 - 0.3);
    f.rotateY(a);
    fronds.push(tint(f, i % 2 ? '#3f9a3a' : '#57b444'));
  }
  const coco = new CylinderGeometry(0.5, 0.5, 0.8, 6);
  fronds.push(tint(coco.translate(0, -0.4, 0), '#6b4a2a'));
  const crown = new Mesh(mergeGeometries(fronds), TrackMaterials.shell());
  crown.position.copy(prev);
  crown.userData.phase = rng.range(0, Math.PI * 2);
  return crown;
}

/**
 * Dune Canyon's necropolis: three stepped sandstone pyramids with gold
 * capstones that glint in the sun, a sphinx on a plinth facing the track
 * between two gold-tipped obelisks, and an oasis pond ringed by swaying palms.
 */
export function buildPyramids(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, RADIUS);
  if (!spot) return;
  const { terrain } = ctx;
  const rng = new SeededRandom(ctx.def.terrain.seed + 61);
  const g = new Group();
  g.name = 'pyramids';
  g.position.copy(spot.position);
  g.rotation.y = spot.yaw;
  const cos = Math.cos(spot.yaw);
  const sin = Math.sin(spot.yaw);
  const groundAt = (x: number, z: number): number =>
    terrain.sample(spot.position.x + x * cos + z * sin, spot.position.z - x * sin + z * cos) - spot.position.y;
  /** Min / mean ground over a square of half-size `hs`. */
  const groundUnder = (x: number, z: number, hs: number): { min: number; mean: number; max: number } => {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const h = groundAt(x + (i / 2) * hs, z + (j / 2) * hs);
        min = Math.min(min, h);
        max = Math.max(max, h);
        sum += h;
      }
    }
    return { min, mean: sum / 25, max };
  };

  const parts: BufferGeometry[] = [];
  const gold = new MeshStandardMaterial({ color: '#ffd04a', emissive: new Color('#ffb21a'), emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.25, flatShading: true });
  const golds: BufferGeometry[] = [];

  // Stepped pyramids, the bottom course sunk into the sand.
  for (const py of PYRAMIDS) {
    const ground = groundUnder(py.x, py.z, py.base / 2);
    const y0 = ground.mean;
    const stepH = py.height / py.steps;
    const capW = py.base * 0.09;
    for (let k = 0; k < py.steps; k++) {
      const w = py.base - ((py.base - capW) * k) / py.steps;
      const bottom = k === 0 ? ground.min - 2 : y0 + k * stepH;
      const h = y0 + (k + 1) * stepH - bottom;
      parts.push(box(w, h, w, py.x, bottom + h / 2, py.z, k % 2 ? STONE : SAND_LIGHT));
    }
    const cap = new ConeGeometry(capW * 0.75, stepH * 2.2, 4);
    cap.rotateY(Math.PI / 4);
    golds.push(tint(cap.translate(py.x, y0 + py.height + stepH * 1.1, py.z), '#ffffff'));
    // Dark doorway on the track face.
    parts.push(box(py.base * 0.08, stepH * 1.6, 1, py.x, y0 + stepH * 0.8, py.z + py.base / 2 + 0.2, '#3a2a1e'));
  }

  // Sphinx on a plinth, facing the track.
  const sx = -12;
  const sz = 32;
  const sg = groundUnder(sx, sz, 13);
  const sy = sg.mean;
  parts.push(box(14, sy - sg.min + 3, 30, sx, (sg.min + sy + 2) / 2 - 0.5, sz, STONE_DARK));
  const top = sy + 2;
  parts.push(box(9, 6, 20, sx, top + 3, sz - 3, STONE));
  parts.push(box(8, 3, 4, sx, top + 6.2, sz - 11, STONE));
  for (const side of [-1, 1]) parts.push(box(2.6, 2, 9, sx + side * 2.8, top + 1, sz + 9.5, STONE));
  parts.push(box(6.6, 8, 6, sx, top + 9.5, sz + 5, STONE));
  parts.push(box(8.6, 2, 7, sx, top + 13.5, sz + 4.6, '#3a5fa8'));
  for (const side of [-1, 1]) {
    parts.push(box(1.6, 7.5, 5.2, sx + side * 4, top + 8.7, sz + 4.4, '#3a5fa8'));
    for (const y of [7, 9.5, 12]) parts.push(box(1.7, 0.6, 5.3, sx + side * 4, top + y, sz + 4.4, '#e8c25a'));
  }
  parts.push(box(7, 0.6, 7.1, sx, top + 12.4, sz + 4.6, '#e8c25a'));
  parts.push(box(1.2, 2.2, 1.4, sx, top + 9.6, sz + 8.4, STONE_DARK));
  parts.push(box(1.6, 3, 1.2, sx, top + 4.5, sz + 8.2, '#3a5fa8'));
  for (const side of [-1, 1]) parts.push(box(1.4, 0.6, 0.3, sx + side * 1.6, top + 11, sz + 8.1, '#2a2a3a'));

  // Obelisks flanking the sphinx.
  for (const ox of [sx - 15, sx + 15]) {
    const oz = sz + 10;
    const og = groundUnder(ox, oz, 2.5);
    parts.push(box(5, og.mean - og.min + 2.5, 5, ox, (og.min + og.mean + 1.5) / 2, oz, STONE_DARK));
    const shaft = new CylinderGeometry(1.1, 1.75, 17, 4);
    shaft.rotateY(Math.PI / 4);
    parts.push(tint(shaft.translate(ox, og.mean + 1.5 + 8.5, oz), STONE));
    const tip = new ConeGeometry(1.1 * Math.SQRT1_2 * 1.42, 2.2, 4);
    tip.rotateY(Math.PI / 4);
    golds.push(tint(tip.translate(ox, og.mean + 1.5 + 17 + 1.1, oz), '#ffffff'));
  }

  // Oasis: flat pond on a grassy bank, palms around it.
  const ox = 30;
  const oz = 46;
  const pond = groundUnder(ox, oz, 10);
  const waterY = pond.max + 0.3;
  const bank = new CylinderGeometry(11, 15, waterY - pond.min + 2, 18);
  parts.push(tint(bank.translate(ox, (waterY + pond.min - 2) / 2 - 0.15, oz), '#7cb84a'));
  const rim = new CylinderGeometry(9.6, 10.4, 0.6, 18);
  parts.push(tint(rim.translate(ox, waterY - 0.05, oz), SAND_DARK));
  const water = new Mesh(new CircleGeometry(9.4, 24).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: '#3fc7d9', emissive: new Color('#1a8fb0'), emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.1 }));
  water.position.set(ox, waterY + 0.28, oz);
  water.receiveShadow = true;
  g.add(water);
  const trunks: BufferGeometry[] = [];
  const crowns: Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const px = ox + Math.cos(a) * 12.5;
    const pz = oz + Math.sin(a) * 12.5;
    crowns.push(palm(trunks, rng, px, groundAt(px, pz), pz, rng.range(9, 13)));
  }
  for (const [px, pz] of [[sx - 22, sz - 6], [sx + 20, sz - 10], [-58, 26]] as const) crowns.push(palm(trunks, rng, px, groundAt(px, pz), pz, rng.range(10, 13)));
  parts.push(...trunks);
  // Tumbled blocks scattered in the sand.
  for (let i = 0; i < 9; i++) {
    const bx = rng.range(-60, 10);
    const bz = rng.range(22, 55);
    if (Math.abs(bx - sx) < 10 || Math.hypot(bx - ox, bz - oz) < 16 || Math.hypot(bx, bz) > RADIUS - 6) continue;
    const s = rng.range(1.5, 3.2);
    const b = new BoxGeometry(s * 1.6, s, s);
    b.rotateY(rng.range(0, Math.PI));
    b.rotateZ(rng.range(-0.3, 0.3));
    parts.push(tint(b.translate(bx, groundAt(bx, bz) + s * 0.3, bz), i % 2 ? STONE : SAND_DARK));
  }

  const statics = new Mesh(mergeGeometries(parts), TrackMaterials.shell());
  g.add(statics);
  const caps = new Mesh(mergeGeometries(golds), gold);
  g.add(caps);
  for (const c of crowns) g.add(c);

  g.traverse((o) => {
    if ((o as Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  water.castShadow = false;
  ctx.add(g);
  ctx.updatables.push({
    update: (_dt, time) => {
      gold.emissiveIntensity = 0.45 + Math.pow(Math.max(0, Math.sin(time * 0.9)), 12) * 2.6;
      for (const c of crowns) c.rotation.z = Math.sin(time * 0.8 + (c.userData.phase as number)) * 0.06;
      water.material.emissiveIntensity = 0.3 + Math.sin(time * 1.5) * 0.08;
    },
  });
}
