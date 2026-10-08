import {
  BufferAttribute,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { Noise2D } from '@shared/math/noise';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { roadClearance } from './placement';

const GRASS = new Color('#6ccf4a');
const GRASS_DARK = new Color('#4fae3a');
const EARTH = new Color('#a8764a');
const ROCK = new Color('#8a8290');

/** Falling-water streaks (V scrolls downward). */
function fallTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(190,235,255,0)');
  grad.addColorStop(0.2, 'rgba(210,242,255,0.9)');
  grad.addColorStop(0.8, 'rgba(210,242,255,0.9)');
  grad.addColorStop(1, 'rgba(190,235,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 26; i++) g.fillRect(6 + ((i * 37) % 52), (i * 71) % 256, 3, 30 + ((i * 13) % 40));
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/**
 * An island: grassy dome on an inverted, faceted rock cone (earth band, rock
 * underneath), vertex coloured, centred at the origin with its lawn at y = 0.
 */
function islandGeometry(radius: number, depth: number, rng: SeededRandom, noise: Noise2D): BufferGeometry {
  const top = new CylinderGeometry(radius, radius * 0.92, 2.4, 14, 1).toNonIndexed();
  top.translate(0, -1.2, 0);
  const cone = new ConeGeometry(radius * 0.92, depth, 14, 4).toNonIndexed();
  cone.rotateX(Math.PI);
  cone.translate(0, -2.4 - depth / 2, 0);
  const parts = [top, cone].map((g, k) => {
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const n = noise.noise(x * 0.08 + rng.next() * 0.01, z * 0.08) * radius * 0.12;
      const r = Math.hypot(x, z) || 1;
      if (k === 1 && y < -3) pos.setXYZ(i, x + (x / r) * n, y, z + (z / r) * n);
      if (k === 0) c.copy(y > -0.2 ? GRASS : GRASS_DARK);
      else c.copy(EARTH).lerp(ROCK, Math.min(1, (-y - 2.4) / (depth * 0.5)));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  return merged;
}

/** Puffy toon tree (trunk + two leaf balls) merged into one geometry at (x, z). */
function treeGeometry(x: number, z: number, s: number, rng: SeededRandom): BufferGeometry[] {
  const trunk = new CylinderGeometry(0.35 * s, 0.5 * s, 3 * s, 6).toNonIndexed();
  trunk.translate(x, 1.5 * s, z);
  const leaf = new IcosahedronGeometry(2.2 * s, 0).toNonIndexed();
  leaf.translate(x, 4 * s, z);
  const leaf2 = new IcosahedronGeometry(1.5 * s, 0).toNonIndexed();
  leaf2.translate(x + rng.range(-0.8, 0.8) * s, 5.6 * s, z + rng.range(-0.8, 0.8) * s);
  const paint = (g: BufferGeometry, color: Color): BufferGeometry => {
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new BufferAttribute(colors, 3));
    return g;
  };
  const green = new Color().setHSL(rng.range(0.25, 0.36), 0.6, rng.range(0.38, 0.5));
  return [paint(trunk, new Color('#8a5a3a')), paint(leaf, green), paint(leaf2, green.clone().offsetHSL(0, 0, 0.06))];
}

/**
 * Sky Garden: floating islands all round the course — lawns, trees and little
 * shrines on faceted rock, waterfalls spilling off their edges into a sea of
 * cloud far below — a sky palace on the biggest island and a rainbow arc overhead.
 */
export function buildSkyIslands(ctx: BuildContext, _p: LandmarkPlacement): void {
  const { path } = ctx;
  const rng = new SeededRandom(ctx.def.terrain.seed + 909);
  const noise = new Noise2D(ctx.def.terrain.seed + 910);
  const ys = path.samples.map((s) => s.position.y);
  const roadLow = Math.min(...ys);
  const roadHigh = Math.max(...ys);
  const cx = path.samples.reduce((a, s) => a + s.position.x, 0) / path.samples.length;
  const cz = path.samples.reduce((a, s) => a + s.position.z, 0) / path.samples.length;
  const islandMat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const fallTex = fallTexture();
  const fallMat = new MeshStandardMaterial({ map: fallTex, transparent: true, depthWrite: false, side: DoubleSide, emissive: new Color('#bfeaff'), emissiveIntensity: 0.35, roughness: 0.2 });
  const mistMat = new MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, roughness: 1, flatShading: true, depthWrite: false });
  const bobbers: Array<{ g: Group; base: number; phase: number }> = [];
  const treeMat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const placed: Array<{ x: number; z: number; r: number }> = [];

  const island = (x: number, z: number, y: number, radius: number, opts: { falls: number; trees: number; palace?: boolean }): void => {
    const g = new Group();
    g.position.set(x, y, z);
    const depth = radius * rng.range(1.1, 1.6);
    g.add(new Mesh(islandGeometry(radius, depth, rng, noise), islandMat));
    const trees: BufferGeometry[] = [];
    for (let i = 0; i < opts.trees; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(opts.palace ? radius * 0.6 : 0, radius * 0.8);
      trees.push(...treeGeometry(Math.cos(a) * r, Math.sin(a) * r, rng.range(0.8, 1.5), rng));
    }
    if (trees.length) {
      const grove = new Mesh(mergeGeometries(trees), treeMat);
      grove.castShadow = true;
      g.add(grove);
    }
    // Waterfalls pour off the rim and fade into the clouds.
    for (let i = 0; i < opts.falls; i++) {
      const a = rng.range(0, Math.PI * 2);
      const len = rng.range(60, 110);
      const w = rng.range(3, 6);
      const fall = new Mesh(new PlaneGeometry(w, len), fallMat);
      fall.position.set(Math.cos(a) * (radius * 0.93), -len / 2 + 0.5, Math.sin(a) * (radius * 0.93));
      fall.rotation.y = -a + Math.PI / 2;
      g.add(fall);
      const pool = new Mesh(new CylinderGeometry(w * 0.7, w * 0.7, 0.3, 12), new MeshStandardMaterial({ color: '#5ac8f0', roughness: 0.2, emissive: new Color('#3aa8e0'), emissiveIntensity: 0.2 }));
      pool.position.set(Math.cos(a) * radius * 0.7, 0.05, Math.sin(a) * radius * 0.7);
      g.add(pool);
      for (let k = 0; k < 3; k++) {
        const mist = new Mesh(new IcosahedronGeometry(w * rng.range(0.7, 1.1), 1), mistMat);
        mist.position.set(fall.position.x, -len + k * 4, fall.position.z);
        g.add(mist);
      }
    }
    if (opts.palace) g.add(skyPalace(radius, rng));
    else if (rng.chance(0.45)) g.add(shrine(rng));
    ctx.add(g);
    bobbers.push({ g, base: y, phase: rng.range(0, 6.28) });
    ctx.footprints.push({ x, z, r: radius });
    placed.push({ x, z, r: radius });
  };

  // The palace island hangs off the infield side of the lap, high up.
  const spot = (minOut: number, maxOut: number, r: number): Vector3 | null => {
    for (let k = 0; k < 60; k++) {
      const s = path.samples[rng.int(0, path.samples.length - 1)]!;
      const side = rng.chance(0.5) ? 1 : -1;
      const out = rng.range(minOut, maxOut);
      const x = s.position.x + s.flatRight.x * side * (s.wallOffset + out + r);
      const z = s.position.z + s.flatRight.z * side * (s.wallOffset + out + r);
      if (roadClearance(ctx, x, z) < r + 6) continue;
      if (placed.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 8)) continue;
      return new Vector3(x, s.position.y, z);
    }
    return null;
  };
  const palace = spot(60, 200, 42);
  if (palace) island(palace.x, palace.z, roadHigh + 26, 42, { falls: 3, trees: 6, palace: true });
  for (let i = 0; i < 16; i++) {
    const r = rng.range(9, 24);
    const at = spot(8, 200, r);
    if (!at) continue;
    // Some sit level with the road, most below or above it.
    const y = at.y + rng.pick([-32, -18, -8, 10, 24]) + rng.range(-5, 5);
    island(at.x, at.z, y, r, { falls: rng.int(0, 2), trees: Math.round(r / 5) });
  }

  // A sea of cloud far below the course.
  const puff = new IcosahedronGeometry(1, 1);
  puff.scale(1, 0.45, 1);
  const count = 260;
  const sea = new InstancedMesh(puff, new MeshStandardMaterial({ color: '#ffffff', emissive: '#e6f2ff', emissiveIntensity: 0.4, roughness: 1, flatShading: true }), count);
  const m = new Matrix4();
  const q = new Quaternion();
  const reach = Math.max(500, ctx.terrain.def.size * 0.55);
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * reach;
    const s = rng.range(26, 60);
    m.compose(new Vector3(cx + Math.cos(a) * d, roadLow - 95 + rng.range(-12, 10), cz + Math.sin(a) * d), q.setFromAxisAngle(new Vector3(0, 1, 0), rng.range(0, 6)), new Vector3(s, s, s * rng.range(0.7, 1.3)));
    sea.setMatrixAt(i, m);
  }
  sea.name = 'cloud-sea';
  ctx.add(sea);

  // A rainbow arching over the whole garden.
  const bands = ['#ff5a5a', '#ffa83a', '#ffe84a', '#5adc5a', '#4ab8ff', '#8a6aff'];
  const rainbow = new Group();
  bands.forEach((c, i) => {
    const arc = new Mesh(new TorusGeometry(420 - i * 9, 4.5, 6, 64, Math.PI), new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, depthWrite: false }));
    rainbow.add(arc);
  });
  rainbow.position.set(cx + 120, roadLow - 70, cz - 260);
  rainbow.rotation.y = 0.6;
  ctx.add(rainbow);

  ctx.updatables.push({
    update: (_dt, time) => {
      for (const b of bobbers) b.g.position.y = b.base + Math.sin(time * 0.4 + b.phase) * 1.6;
      fallTex.offset.y = (time * 0.9) % 1;
    },
  });
}

/** A white-and-gold sky palace with blue spires. */
function skyPalace(radius: number, rng: SeededRandom): Group {
  const g = new Group();
  const white = TrackMaterials.paint('#f6f4fa');
  const blue = TrackMaterials.paint('#4a7ae8');
  const gold = TrackMaterials.emissive('#ffd84a', 0.5);
  const keep = new Mesh(new CylinderGeometry(7, 8, 22, 12), white);
  keep.position.y = 11;
  g.add(keep);
  const dome = new Mesh(new SphereGeometry(7.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), blue);
  dome.position.y = 22;
  g.add(dome);
  const spire = new Mesh(new ConeGeometry(0.8, 8, 8), gold);
  spire.position.y = 33;
  g.add(spire);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const r = radius * 0.5;
    const h = rng.range(12, 20);
    const tower = new Mesh(new CylinderGeometry(2.4, 2.8, h, 10), white);
    tower.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    const roof = new Mesh(new ConeGeometry(3.2, 7, 10), blue);
    roof.position.set(tower.position.x, h + 3.5, tower.position.z);
    const flag = new Mesh(new PlaneGeometry(2.2, 1.2), TrackMaterials.paint('#ff5a8a'));
    flag.position.set(tower.position.x + 1.1, h + 8, tower.position.z);
    g.add(tower, roof, flag);
  }
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return g;
}

/** Little round shrine: six columns and a dome. */
function shrine(rng: SeededRandom): Group {
  const g = new Group();
  const white = TrackMaterials.paint('#f2eee4');
  const roofColor = TrackMaterials.paint(rng.pick(['#e8603a', '#4a8ae8', '#e8c048']));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const col = new Mesh(new CylinderGeometry(0.35, 0.35, 5, 8), white);
    col.position.set(Math.cos(a) * 3, 2.5, Math.sin(a) * 3);
    g.add(col);
  }
  const dome = new Mesh(new SphereGeometry(3.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), roofColor);
  dome.position.y = 5;
  g.add(dome);
  g.position.set(rng.range(-3, 3), 0, rng.range(-3, 3));
  g.traverse((o) => (o.castShadow = true));
  return g;
}
