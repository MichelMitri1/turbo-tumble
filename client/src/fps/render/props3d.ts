import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PROP_BOUNDS } from '../sim/propBounds';
import { CONTAINER_L, CONTAINER_S } from '../sim/mapkit';
import { surface, type SurfaceName } from './textures';

/**
 * Props built from the photoscanned surfaces instead of the old toon models: shipping
 * containers, T-walls, sandbag walls, dumpsters, pallets, pipes, rubble, cones, planks
 * and trees. Each is built in its model's units, inside the box the sim collides with
 * (PROP_BOUNDS), so placements and collision are unchanged.
 *
 * A saturated material colour is a "paint": maps that tint a prop repaint it (see cloneModel).
 */

type V3 = [number, number, number];

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function mat(name: SurfaceName, color = '#ffffff', o: { rough?: number; metal?: number; normal?: number } = {}): THREE.MeshStandardMaterial {
  const s = surface(name);
  const m = new THREE.MeshStandardMaterial({ color, map: s?.map ?? null, normalMap: s?.normal ?? null, roughnessMap: s?.rough ?? null, roughness: o.rough ?? 1, metalness: o.metal ?? 0 });
  if (o.normal !== undefined) m.normalScale.setScalar(o.normal);
  return m;
}

/**
 * A box from (x0, y0, z0) to (x1, y1, z1) in model units with UVs in world metres
 * (`k` = the placement scale, so a stretched container still tiles at the right size).
 */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tile: number, k: V3 = [1, 1, 1]): THREE.BufferGeometry {
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const dims: Array<[number, number]> = [
    [d * k[2], h * k[1]],
    [d * k[2], h * k[1]],
    [w * k[0], d * k[2]],
    [w * k[0], d * k[2]],
    [w * k[0], h * k[1]],
    [w * k[0], h * k[1]],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f]!;
    for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
  }
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** One mesh per material (each geometry keeps its own normals). */
function group(parts: Array<[THREE.Material, THREE.BufferGeometry[]]>): THREE.Group {
  const g = new THREE.Group();
  for (const [m, geos] of parts) {
    if (!geos.length) continue;
    const merged = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)));
    for (const x of geos) x.dispose();
    g.add(new THREE.Mesh(merged, m));
  }
  return g;
}

const bounds = (name: string) => {
  const b = PROP_BOUNDS[name]!;
  return { x0: b[0], y0: Math.max(0, b[1]), z0: b[2], x1: b[3], y1: b[4], z1: b[5] };
};

// ---------------------------------------------------------------- shipping container

function container(name: string, k: V3): THREE.Group {
  const { x0, y0, z0, x1, y1, z1 } = bounds(name);
  // Model units per metre on each axis.
  const ux = 1 / k[0];
  const uy = 1 / k[1];
  const uz = 1 / k[2];
  const paint = mat('container', '#8a2a22', { rough: 0.85, metal: 0.25 });
  const steel = mat('metal', '#5e6064', { rough: 0.7, metal: 0.5 });
  const frame = mat('metal', '#8a2a22', { rough: 0.8, metal: 0.3 });
  const p = 0.11; // corner post (m)
  const body: THREE.BufferGeometry[] = [box(x0 + p * ux * 0.5, y0 + 0.12 * uy, z0 + 0.03 * uz, x1 - p * ux * 0.5, y1 - 0.1 * uy, z1 - 0.03 * uz, 1.94, k)];
  const fr: THREE.BufferGeometry[] = [];
  const bars: THREE.BufferGeometry[] = [];
  for (const x of [x0, x1 - p * ux])
    for (const z of [z0, z1 - p * uz]) fr.push(box(x, y0, z, x + p * ux, y1, z + p * uz, 1, k));
  for (const z of [z0, z1 - 0.14 * uz]) {
    fr.push(box(x0, y0, z, x1, y0 + 0.16 * uy, z + 0.14 * uz, 1, k));
    fr.push(box(x0, y1 - 0.12 * uy, z, x1, y1, z + 0.14 * uz, 1, k));
  }
  for (const x of [x0, x1 - 0.14 * ux]) {
    fr.push(box(x, y0, z0, x + 0.14 * ux, y0 + 0.16 * uy, z1, 1, k));
    fr.push(box(x, y1 - 0.12 * uy, z0, x + 0.14 * ux, y1, z1, 1, k));
  }
  // Doors at +x: the seam, four locking bars and their handles.
  const dz = (z1 - z0) / 2 + z0;
  fr.push(box(x1 - 0.02 * ux, y0, dz - 0.02 * uz, x1 + 0.005 * ux, y1, dz + 0.02 * uz, 1, k));
  for (const f of [0.18, 0.38, 0.62, 0.82]) {
    const z = z0 + (z1 - z0) * f;
    bars.push(box(x1, y0 + 0.2 * uy, z - 0.025 * uz, x1 + 0.05 * ux, y1 - 0.15 * uy, z + 0.025 * uz, 1, k));
    bars.push(box(x1, y0 + 1.1 * uy, z - 0.02 * uz, x1 + 0.09 * ux, y0 + 1.16 * uy, z + 0.12 * uz, 1, k));
  }
  return group([
    [paint, body],
    [frame, fr],
    [steel, bars],
  ]);
}

// ---------------------------------------------------------------- concrete T-wall

function twall(name: string): THREE.Group {
  const { x0, z0, x1, y1, z1 } = bounds(name);
  const conc = mat('concrete', '#c4bfb6');
  const zc = (z0 + z1) / 2;
  const geos = [
    box(x0, 0, z0, x1, 0.32, z1, 3),
    box(x0 + 0.02, 0.32, zc - 0.22, x1 - 0.02, 0.62, zc + 0.22, 3),
    box(x0 + 0.02, 0.62, zc - 0.13, x1 - 0.02, y1 - 0.1, zc + 0.13, 3),
    box(x0 + 0.05, y1 - 0.1, zc - 0.09, x1 - 0.05, y1, zc + 0.09, 3),
  ];
  // Lifting hooks.
  const steel = mat('metal', '#4a4440', { metal: 0.6, rough: 0.6 });
  const hooks = [-0.6, 0.6].map((x) => box(x - 0.04, y1, zc - 0.02, x + 0.04, y1 + 0.1, zc + 0.02, 1));
  return group([
    [conc, geos],
    [steel, hooks],
  ]);
}

// ---------------------------------------------------------------- sandbags

function sandbags(name: string, seed: number): THREE.Group {
  const { x0, z0, x1, y1, z1 } = bounds(name);
  const R = rng(seed);
  const hess = mat('hessian', '#cbb68e', { normal: 1.4 });
  const geos: THREE.BufferGeometry[] = [];
  const bw = 0.58;
  const bh = 0.155;
  const bd = 0.34;
  const rows = Math.max(3, Math.floor(y1 / (bh * 0.93)));
  const deep = z1 - z0 > 0.7;
  for (let r = 0; r < rows; r++) {
    const y = r * bh * 0.93 + bh / 2;
    const off = r % 2 ? bw / 2 : 0;
    const layers = deep && r < rows - 3 ? [z0 + bd / 2 + 0.03, z0 + bd * 1.45 + 0.03] : [(z0 + z1) / 2 - 0.05];
    for (const z of layers)
      for (let x = x0 + bw / 2 - off; x <= x1 - bw / 2 + 0.01; x += bw * 0.97) {
        const g = new RoundedBoxGeometry(bw * (0.93 + R() * 0.08), bh, bd * (0.92 + R() * 0.1), 3, 0.07);
        const uv = g.getAttribute('uv') as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.2, uv.getY(i) * 1.2);
        g.rotateY((R() - 0.5) * 0.12);
        g.rotateZ((R() - 0.5) * 0.04);
        g.translate(Math.max(x0 + bw / 2, Math.min(x1 - bw / 2, x)), y, z + (R() - 0.5) * 0.04);
        geos.push(g);
      }
  }
  return group([[hess, geos]]);
}

// ---------------------------------------------------------------- pallet, planks, pipes, dumpster, cone

function pallet(name: string): THREE.Group {
  const { x0, y0, z0, x1, y1, z1 } = bounds(name);
  const wood = mat('wood', '#d8c4a0');
  const geos: THREE.BufferGeometry[] = [];
  const h = y1 - y0;
  // Three runners along x, seven top boards across them.
  for (const f of [0.06, 0.5, 0.94]) {
    const z = z0 + (z1 - z0) * f;
    geos.push(box(x0, y0, z - 0.05, x1, y0 + h * 0.7, z + 0.05, 1.5));
  }
  for (let i = 0; i < 7; i++) {
    const x = x0 + 0.05 + ((x1 - x0 - 0.1) * i) / 6;
    geos.push(box(x - 0.06, y0 + h * 0.7, z0, x + 0.06, y1, z1, 1.5));
  }
  return group([[wood, geos]]);
}

function planks(name: string): THREE.Group {
  const { x0, y0, z0, x1, y1, z1 } = bounds(name);
  const wood = mat('wood', '#e0c8a0');
  const R = rng(5);
  const geos: THREE.BufferGeometry[] = [];
  const n = 4;
  const th = (y1 - y0) / 3;
  for (let i = 0; i < n + 2; i++) {
    const layer = i < n ? 0 : i < n + 1 ? 1 : 2;
    const w = (x1 - x0) / n;
    const x = x0 + w * ((i % n) + 0.5) + (layer ? w * 0.3 : 0);
    const g = box(x - w * 0.45, y0 + layer * th, z0 + R() * 0.06, x + w * 0.45, y0 + (layer + 1) * th, z1 - R() * 0.06, 1.5);
    geos.push(g);
  }
  return group([[wood, geos]]);
}

function pipes(name: string): THREE.Group {
  const { x0, y0, z0, x1, y1, z1 } = bounds(name);
  const rusty = mat('metal', '#8a7660', { metal: 0.45, rough: 0.8 });
  const wood = mat('wood', '#c8b090');
  const r = Math.min((x1 - x0) / 4.2, (y1 - y0) / 3.6);
  const len = z1 - z0 - 0.1;
  const geos: THREE.BufferGeometry[] = [];
  const cx = (x0 + x1) / 2;
  for (const [px, py] of [
    [cx - r * 1.02, y0 + 0.08 + r],
    [cx + r * 1.02, y0 + 0.08 + r],
    [cx, y0 + 0.08 + r * 2.75],
  ] as Array<[number, number]>) {
    const outer = new THREE.CylinderGeometry(r, r, len, 18, 1, true);
    const inner = new THREE.CylinderGeometry(r * 0.88, r * 0.88, len, 18, 1, true);
    inner.scale(-1, 1, 1);
    for (const g of [outer, inner]) {
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 2 * Math.PI * r) / 2, (uv.getY(i) * len) / 2);
      g.rotateX(Math.PI / 2);
      g.translate(px, py, (z0 + z1) / 2);
      geos.push(g);
    }
  }
  const chocks = [z0 + 0.4, z1 - 0.4].map((z) => box(x0, y0, z - 0.06, x1, y0 + 0.1, z + 0.06, 1));
  return group([
    [rusty, geos],
    [wood, chocks],
  ]);
}

function dumpster(name: string): THREE.Group {
  const { x0, z0, x1, y1, z1 } = bounds(name);
  const paint = mat('metal', '#2a6a3a', { metal: 0.35, rough: 0.75 });
  const dark = mat('metal', '#2a2a2c', { metal: 0.3, rough: 0.8 });
  const top = Math.min(1.35, y1 * 0.68);
  const body = [box(x0 + 0.04, 0.16, z0 + 0.04, x1 - 0.04, top, z1 - 0.04, 2), box(x0, top - 0.08, z0, x1, top, z1, 2)];
  // Ribs down the front and back.
  for (const f of [0.2, 0.5, 0.8]) {
    const x = x0 + (x1 - x0) * f;
    for (const z of [z0 - 0.02, z1 - 0.04]) body.push(box(x - 0.04, 0.2, z, x + 0.04, top - 0.05, z + 0.06, 2));
  }
  // Lids: one shut, one thrown back against the wall.
  const lids = [box(x0, top, z0 + 0.02, (x0 + x1) / 2 - 0.02, top + 0.06, z1 - 0.02, 2)];
  const open = box((x0 + x1) / 2 + 0.02, 0, -0.03, x1, z1 - z0 - 0.04, 0.03, 2);
  open.rotateX(-0.25);
  open.translate(0, top, z1 - 0.02);
  lids.push(open);
  const wheels: THREE.BufferGeometry[] = [];
  for (const x of [x0 + 0.2, x1 - 0.2])
    for (const z of [z0 + 0.2, z1 - 0.2]) {
      const w = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10);
      w.rotateX(Math.PI / 2);
      w.translate(x, 0.07, z);
      wheels.push(w);
    }
  return group([
    [paint, body],
    [dark, [...lids, ...wheels]],
  ]);
}

function cone(name: string): THREE.Group {
  const { x0, x1, y1 } = bounds(name);
  const w = (x1 - x0) / 2;
  const orange = new THREE.MeshStandardMaterial({ color: '#f0601a', roughness: 0.55 });
  const white = new THREE.MeshStandardMaterial({ color: '#e8e8e4', roughness: 0.35 });
  const black = new THREE.MeshStandardMaterial({ color: '#202022', roughness: 0.8 });
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 0.04, w * 2), black);
  base.position.y = 0.02;
  const h = y1 - 0.04;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.12, w * 0.55, h, 20, 1, true), orange);
  body.position.y = 0.04 + h / 2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.38, h * 0.2, 20, 1, true), white);
  band.position.y = 0.04 + h * 0.55;
  band.scale.setScalar(1.01);
  g.add(base, body, band);
  return g;
}

// ---------------------------------------------------------------- chain-link fence

let chainTex: THREE.CanvasTexture | null = null;
/** Diamond wire mesh (alpha-tested), one 14 cm repeat. */
function chainLink(): THREE.CanvasTexture {
  if (chainTex) return chainTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#d0d4d8';
  g.lineWidth = 9;
  for (const [a, b] of [
    [0, 0],
    [64, 0],
    [128, 0],
  ]) {
    g.beginPath();
    g.moveTo(a! - 64, b!);
    g.lineTo(a! + 64, b! + 128);
    g.moveTo(a! + 64, b!);
    g.lineTo(a! - 64, b! + 128);
    g.stroke();
  }
  chainTex = new THREE.CanvasTexture(c);
  chainTex.wrapS = chainTex.wrapT = THREE.RepeatWrapping;
  chainTex.colorSpace = THREE.SRGBColorSpace;
  chainTex.anisotropy = 8;
  return chainTex;
}

function fence(name: string): THREE.Group {
  const { x0, z0, x1, y1, z1 } = bounds(name);
  const zc = (z0 + z1) / 2;
  const steel = mat('metal', '#8a9096', { metal: 0.7, rough: 0.5 });
  const posts: THREE.BufferGeometry[] = [];
  for (const x of [x0 + 0.04, x1 - 0.04]) {
    const p = new THREE.CylinderGeometry(0.035, 0.035, y1, 8);
    p.translate(x, y1 / 2, zc);
    posts.push(p);
  }
  for (const y of [y1 - 0.03, 0.08]) {
    const r = new THREE.CylinderGeometry(0.02, 0.02, x1 - x0, 6);
    r.rotateZ(Math.PI / 2);
    r.translate((x0 + x1) / 2, y, zc);
    posts.push(r);
  }
  const g = group([[steel, posts]]);
  const w = x1 - x0;
  const plane = new THREE.PlaneGeometry(w, y1 - 0.1);
  const uv = plane.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 0.14, (uv.getY(i) * (y1 - 0.1)) / 0.14);
  plane.translate((x0 + x1) / 2, (y1 - 0.1) / 2 + 0.05, zc);
  const wire = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({ map: chainLink(), alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.45, color: '#b8bcc0' }));
  // A solid shadow would look like a wall: the wire casts none.
  wire.userData.noShadow = true;
  g.add(wire);
  return g;
}

// ---------------------------------------------------------------- rubble

function rubble(name: string): THREE.Group {
  const { x0, y0, z0, x1, y1, z1 } = bounds(name);
  const R = rng(17);
  const conc = mat('concrete', '#b8b2a8');
  const brick = mat('brick');
  const a: THREE.BufferGeometry[] = [];
  const b: THREE.BufferGeometry[] = [];
  const h = Math.max(0.12, y1 - y0);
  for (let i = 0; i < 42; i++) {
    const s = 0.08 + R() * 0.28;
    const g = new THREE.DodecahedronGeometry(s, 0);
    g.scale(1 + R() * 0.8, (h / s) * (0.3 + R() * 0.5), 1 + R() * 0.6);
    g.computeVertexNormals();
    g.rotateY(R() * Math.PI);
    // Heaped towards the middle.
    const fx = (R() + R()) / 2;
    const fz = (R() + R()) / 2;
    g.translate(x0 + (x1 - x0) * fx, y0 + h * 0.15, z0 + (z1 - z0) * fz);
    (i % 4 === 0 ? b : a).push(g);
  }
  // A slab or two of broken wall.
  const slab = box(-0.5, 0, -0.4, 0.5, 0.08, 0.4, 3);
  slab.rotateZ(0.12);
  slab.translate((x0 + x1) / 2 + 0.2, y0 + 0.06, (z0 + z1) / 2);
  a.push(slab);
  return group([
    [conc, a],
    [brick, b],
  ]);
}

// ---------------------------------------------------------------- trees

/** Lumpy foliage: an icosphere pushed in and out. */
function blob(r: number, R: () => number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  // Displace shared positions consistently (non-indexed: same corner, same push).
  const push = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = push.get(key);
    if (k === undefined) push.set(key, (k = 0.78 + R() * 0.4));
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 2.4, uv.getY(i) * r * 1.6);
  return g;
}

function tree(name: string, kind: 'oak' | 'pine' | 'wide', seed: number): THREE.Group {
  const { x0, z0, x1, y1, z1 } = bounds(name);
  const R = rng(seed);
  const cx = 0;
  const cz = 0;
  const span = Math.min(x1 - x0, z1 - z0) / 2;
  const bark = mat('bark', '#c8b8a8');
  const leaves = mat('hedge', '#a8d878', { normal: 1.6 });
  const trunk: THREE.BufferGeometry[] = [];
  const crown: THREE.BufferGeometry[] = [];
  const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const g = new THREE.CylinderGeometry(r1, r0, h, 8, 1);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r0, uv.getY(i) * h);
    g.translate(0, h / 2, 0);
    g.rotateX(rx);
    g.rotateZ(rz);
    g.translate(x, y, z);
    trunk.push(g);
  };
  if (kind === 'pine') {
    cyl(0.2, 0.06, y1 * 0.92, cx, 0, cz);
    const tiers = 6;
    for (let i = 0; i < tiers; i++) {
      const f = i / tiers;
      const r = span * (1 - f * 0.78) * (0.95 + R() * 0.1);
      const h = (y1 * 0.78) / tiers + 0.7;
      const g = new THREE.ConeGeometry(r, h * 1.4, 9, 2, true);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const j = 0.86 + R() * 0.28;
        p.setXYZ(k, p.getX(k) * j, p.getY(k), p.getZ(k) * j);
      }
      g.computeVertexNormals();
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * r * 3, uv.getY(k) * h);
      g.rotateY(R() * Math.PI);
      g.translate(cx, y1 * 0.2 + f * y1 * 0.7 + h * 0.5, cz);
      crown.push(g);
    }
  } else {
    const th = y1 * (kind === 'wide' ? 0.42 : 0.5);
    cyl(0.22, 0.12, th, cx, 0, cz);
    // Three limbs into the crown.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + R();
      cyl(0.1, 0.04, th * 0.7, cx, th * 0.85, cz, Math.cos(a) * 0.6, Math.sin(a) * 0.6);
    }
    const n = kind === 'wide' ? 8 : 6;
    const cy = th + (y1 - th) * 0.45;
    const ry = (y1 - th) * 0.5;
    crown.push(blob(span * 0.62, R));
    crown[0]!.translate(cx, cy, cz);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R() * 0.5;
      const d = span * (0.45 + R() * 0.3);
      const g = blob(span * (0.38 + R() * 0.2), R);
      g.translate(cx + Math.cos(a) * d, cy + (R() - 0.35) * ry, cz + Math.sin(a) * d);
      crown.push(g);
    }
  }
  return group([
    [bark, trunk],
    [leaves, crown],
  ]);
}

// ---------------------------------------------------------------- registry

/** Model name → builder (called once the surfaces are loaded; clones share the result). */
export const GENERATED: Record<string, () => THREE.Group> = {
  'prop-container-long': () => container('prop-container-long', CONTAINER_L),
  'prop-container-small': () => container('prop-container-small', CONTAINER_S),
  'prop-barrier-large': () => twall('prop-barrier-large'),
  'prop-barrier-fixed': () => twall('prop-barrier-fixed'),
  'prop-sacktrench': () => sandbags('prop-sacktrench', 3),
  'prop-sacktrench-small': () => sandbags('prop-sacktrench-small', 9),
  'prop-pallet': () => pallet('prop-pallet'),
  'prop-woodplanks': () => planks('prop-woodplanks'),
  'prop-pipes': () => pipes('prop-pipes'),
  'prop-trashcontainer': () => dumpster('prop-trashcontainer'),
  'prop-trafficcone': () => cone('prop-trafficcone'),
  'prop-debris-pile': () => rubble('prop-debris-pile'),
  'prop-metalfence': () => fence('prop-metalfence'),
  'prop-tree-1': () => tree('prop-tree-1', 'oak', 11),
  'prop-tree-2': () => tree('prop-tree-2', 'pine', 23),
  'prop-tree-3': () => tree('prop-tree-3', 'wide', 37),
};
