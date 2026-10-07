import * as THREE from 'three';
import { ARENA, OCTAGON_INSET } from '../sim/arena';
import { BOOST_PADS } from '../sim/constants';
import { TEAM_COLORS } from './colors';

/** Sim (x, y, z) in Unreal units → three.js (x, z, −y) in metres. */
export const S = 0.01;
export const toThree = (x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 => out.set(x * S, z * S, -y * S);

const R = ARENA.fillet;
const H = ARENA.height;
const GX = ARENA.goalHalfX;
const GH = ARENA.goalHeight;
const GD = ARENA.goalDepth;
const HY = ARENA.halfY;

interface ContourPt {
  qx: number;
  qy: number;
  nx: number;
  ny: number;
  /** Arc length along the outer contour (texture u). */
  u: number;
}

/** The rounded octagon (inset octagon + outward normals), finely sampled. */
function contour(): ContourPt[] {
  const V = OCTAGON_INSET;
  const n = V.length;
  const normals = V.map((a, i) => {
    const b = V[(i + 1) % n]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const l = Math.hypot(ex, ey);
    return [ey / l, -ex / l] as const;
  });
  const pts: ContourPt[] = [];
  let u = 0;
  let last: [number, number] | null = null;
  const push = (qx: number, qy: number, nx: number, ny: number) => {
    const ox = qx + nx * R;
    const oy = qy + ny * R;
    if (last) u += Math.hypot(ox - last[0], oy - last[1]);
    last = [ox, oy];
    pts.push({ qx, qy, nx, ny, u });
  };
  for (let i = 0; i < n; i++) {
    const [ax, ay] = V[i]!;
    const [bx, by] = V[(i + 1) % n]!;
    const np = normals[(i + n - 1) % n]!;
    const nc = normals[i]!;
    // Corner arc from the previous edge's normal to this edge's normal.
    const a0 = Math.atan2(np[1], np[0]);
    let a1 = Math.atan2(nc[1], nc[0]);
    while (a1 < a0) a1 += Math.PI * 2;
    const steps = 6;
    for (let k = 0; k <= steps; k++) {
      const a = a0 + ((a1 - a0) * k) / steps;
      push(ax, ay, Math.cos(a), Math.sin(a));
    }
    // Edge interior, with exact breaks at the goal posts on the back walls.
    const len = Math.hypot(bx - ax, by - ay);
    const ts = new Set<number>();
    const segs = Math.max(1, Math.ceil(len / 320));
    for (let k = 1; k < segs; k++) ts.add(k / segs);
    if (Math.abs(nc[1]) > 0.99) for (const gx of [-GX, GX]) ts.add((gx - ax) / (bx - ax));
    for (const t of [...ts].filter((t) => t > 0 && t < 1).sort((p, q) => p - q)) push(ax + (bx - ax) * t, ay + (by - ay) * t, nc[0], nc[1]);
  }
  // Close the loop.
  const f = pts[0]!;
  push(f.qx, f.qy, f.nx, f.ny);
  return pts;
}

/** Vertical profile: lower fillet, wall, upper fillet (angle a: 0 = floor, π/2 = wall, π = ceiling). */
function profile(): Array<{ h: number; z: number; a: number }> {
  const rows: Array<{ h: number; z: number; a: number }> = [];
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * (Math.PI / 2);
    rows.push({ h: R * Math.sin(a), z: R - R * Math.cos(a), a });
  }
  for (const z of [GH, 900, 1200, 1500, H - R]) rows.push({ h: R, z, a: Math.PI / 2 });
  for (let k = 1; k <= 6; k++) {
    const a = Math.PI / 2 + (k / 6) * (Math.PI / 2);
    rows.push({ h: R * Math.sin(a), z: H - R - R * Math.cos(a), a });
  }
  return rows;
}

class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  uv1: number[] = [];
  idx: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    this.pos.push(x * S, z * S, -y * S);
    this.nor.push(nx, nz, -ny);
    this.uv.push(u, v);
    this.uv1.push(0, z / H);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv1, 2));
    g.setIndex(this.idx);
    return g;
  }
}

const floorUv = (x: number, y: number): [number, number] => [(x + ARENA.halfX) / (2 * ARENA.halfX), (y + HY) / (2 * HY)];

// ------------------------------------------------------------------ textures

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Turf: mowed stripes, team tints and the field markings (2048 × 2560 = 4 uu/px). */
function turfTexture(): THREE.Texture {
  const W = 2048;
  const Hh = 2560;
  const [c, g] = canvas(W, Hh);
  const px = (x: number) => ((x + ARENA.halfX) / (2 * ARENA.halfX)) * W;
  const py = (y: number) => (1 - (y + HY) / (2 * HY)) * Hh; // canvas y down = sim −y... flipped below via uv
  // Base + stripes across the width.
  const band = 512;
  for (let y = -HY - 1000; y < HY + 1000; y += band) {
    const even = Math.round((y + HY) / band) % 2 === 0;
    g.fillStyle = even ? '#3d8a2e' : '#357a28';
    g.fillRect(0, py(y + band), W, py(y) - py(y + band) + 1);
  }
  // Team tints.
  const tint = (y0: number, y1: number, color: string) => {
    const grd = g.createLinearGradient(0, py(y0), 0, py(y1));
    grd.addColorStop(0, color.replace('A', '0.34'));
    grd.addColorStop(1, color.replace('A', '0.06'));
    g.fillStyle = grd;
    g.fillRect(0, Math.min(py(y0), py(y1)), W, Math.abs(py(y1) - py(y0)));
  };
  tint(-HY - 900, 0, 'rgba(40,110,255,A)');
  tint(HY + 900, 0, 'rgba(255,120,30,A)');
  // Lines.
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 7;
  g.lineJoin = 'round';
  const poly = (pts: Array<[number, number]>, close = true) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(px(x), py(y)) : g.moveTo(px(x), py(y))));
    if (close) g.closePath();
    g.stroke();
  };
  // Outer boundary (the inset octagon, where the floor meets the curve).
  poly(OCTAGON_INSET.map(([x, y]) => [x * 0.985, y * 0.985]));
  poly([
    [-ARENA.halfX + 300, 0],
    [ARENA.halfX - 300, 0],
  ], false);
  g.beginPath();
  g.arc(px(0), py(0), (1000 / (2 * ARENA.halfX)) * W, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.arc(px(0), py(0), 12, 0, Math.PI * 2);
  g.fill();
  for (const s of [-1, 1]) {
    const back = s * (HY - 300);
    poly([
      [-2000, back],
      [-2000, back - s * 1500],
      [2000, back - s * 1500],
      [2000, back],
    ], false);
    poly([
      [-1150, back],
      [-1150, back - s * 650],
      [1150, back - s * 650],
      [1150, back],
    ], false);
    g.beginPath();
    g.arc(px(0), py(back - s * 1500), (800 / (2 * ARENA.halfX)) * W, s > 0 ? 0 : Math.PI, s > 0 ? Math.PI : Math.PI * 2);
    g.stroke();
  }
  // Pad rings.
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  for (const p of BOOST_PADS) {
    g.beginPath();
    g.arc(px(p.x), py(p.y), ((p.big ? 260 : 150) / (2 * ARENA.halfX)) * W, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.flipY = false;
  return t;
}

/** Tileable grass detail (multiplied over the turf up close). */
function grassDetail(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 90 + Math.random() * 90;
    g.fillStyle = `rgb(${v},${v},${v})`;
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    g.fillRect(x, y, 1, 2 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Hexagon line pattern (walls / net). */
function hexTexture(line: number, size = 512): THREE.Texture {
  const [c, g] = canvas(size, size);
  g.clearRect(0, 0, size, size);
  g.strokeStyle = '#fff';
  g.lineWidth = line;
  const r = size / 6;
  const w = Math.sqrt(3) * r;
  for (let row = -1; row < size / (1.5 * r) + 1; row++) {
    for (let col = -1; col < size / w + 1; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0);
      const cy = row * 1.5 * r;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Wall opacity by height (uv1.y = z / ceiling): solid panels low, clear glass high. */
function wallFade(): THREE.Texture {
  const [c, g] = canvas(4, 256);
  const grd = g.createLinearGradient(0, 256, 0, 0);
  grd.addColorStop(0, '#e0e0e0');
  grd.addColorStop(0.28, '#c8c8c8');
  grd.addColorStop(0.42, '#505050');
  grd.addColorStop(1, '#2a2a2a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.channel = 1;
  t.flipY = true;
  return t;
}

/** A crowd: rows of little coloured people. */
function crowdTexture(team: 0 | 1): THREE.Texture {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#0a0d1c';
  g.fillRect(0, 0, 1024, 512);
  const main = team === 0 ? ['#2f62c8', '#4677d6', '#1d3f99', '#9fb4d8'] : ['#c8641a', '#d98236', '#a8480c', '#d8b89f'];
  const other = ['#8a2a2a', '#2f7a3a', '#a8a03a', '#6a3a8a', '#555', '#222'];
  for (let row = 0; row < 16; row++) {
    const y0 = row * 32;
    // Seat row.
    g.fillStyle = '#141a30';
    g.fillRect(0, y0 + 24, 1024, 6);
    for (let x = 0; x < 1024; x += 16) {
      if (Math.random() < 0.2) continue;
      g.fillStyle = Math.random() < 0.75 ? main[Math.floor(Math.random() * main.length)]! : other[Math.floor(Math.random() * other.length)]!;
      const y = y0 + 6 + Math.random() * 3;
      const px = x + 2 + Math.random() * 3;
      g.fillRect(px, y + 7, 10, 13);
      g.fillStyle = Math.random() < 0.5 ? '#c9a07c' : '#8a6248';
      g.beginPath();
      g.arc(px + 5, y + 3.5, 4, 0, Math.PI * 2);
      g.fill();
      if (Math.random() < 0.08) {
        // Waving arms / flags.
        g.fillStyle = main[0]!;
        g.fillRect(px - 2, y - 6, 3, 12);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ meshes

export interface ArenaView {
  group: THREE.Group;
  /** Goal frames (flash on goal). */
  goalLights: [THREE.Material, THREE.Material];
  update(t: number): void;
}

export function buildArena(): ArenaView {
  const group = new THREE.Group();
  const pts = contour();
  const rows = profile();

  // --- Turf (floor + lower fillet + goal mouths), planar UVs.
  const turf = new GeoBuilder();
  {
    const c = turf.vert(0, 0, 0, 0, 0, 1, ...floorUv(0, 0));
    const ring = OCTAGON_INSET.map(([x, y]) => turf.vert(x, y, 0, 0, 0, 1, ...floorUv(x, y)));
    for (let i = 0; i < ring.length; i++) turf.tri(c, ring[i]!, ring[(i + 1) % ring.length]!);
    // Goal mouths + goal floors.
    for (const s of [-1, 1]) {
      const y0 = s * (HY - R);
      const y1 = s * (HY + GD);
      const q = [turf.vert(-GX, y0, 0, 0, 0, 1, ...floorUv(-GX, y0)), turf.vert(GX, y0, 0, 0, 0, 1, ...floorUv(GX, y0)), turf.vert(GX, y1, 0, 0, 0, 1, ...floorUv(GX, y1)), turf.vert(-GX, y1, 0, 0, 0, 1, ...floorUv(-GX, y1))];
      if (s > 0) {
        turf.tri(q[0]!, q[1]!, q[2]!);
        turf.tri(q[0]!, q[2]!, q[3]!);
      } else {
        turf.tri(q[0]!, q[2]!, q[1]!);
        turf.tri(q[0]!, q[3]!, q[2]!);
      }
    }
  }
  // Wall grid, split into: lower curve (turf), walls (glass per team half), upper curve + ceiling.
  const lowerRows = rows.filter((r) => r.a <= Math.PI / 2 + 1e-6 && r.z <= R + 1e-6);
  const wallRows = rows.filter((r) => Math.abs(r.a - Math.PI / 2) < 1e-6);
  const upperRows = rows.filter((r) => r.a >= Math.PI / 2 - 1e-6 && r.z >= H - R - 1e-6);
  const glass = [new GeoBuilder(), new GeoBuilder()];
  const top = new GeoBuilder();
  const inGoalMouth = (p: ContourPt, q: ContourPt, z1: number) => Math.abs(p.ny) > 0.99 && Math.abs(q.ny) > 0.99 && Math.max(Math.abs(p.qx), Math.abs(q.qx)) <= GX + 1 && z1 <= GH + 1;
  const strip = (b: GeoBuilder | ((p: ContourPt, q: ContourPt) => GeoBuilder), rs: typeof rows, uvOf: (p: ContourPt, r: (typeof rows)[0], x: number, y: number) => [number, number], cut: boolean) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      const gb = typeof b === 'function' ? b(p, q) : b;
      for (let j = 0; j < rs.length - 1; j++) {
        const r0 = rs[j]!;
        const r1 = rs[j + 1]!;
        if (cut && inGoalMouth(p, q, r1.z)) continue;
        const v = (c: ContourPt, r: (typeof rows)[0]) => {
          const x = c.qx + c.nx * r.h;
          const y = c.qy + c.ny * r.h;
          const sa = Math.sin(r.a);
          const ca = Math.cos(r.a);
          return gb.vert(x, y, r.z, -c.nx * sa, -c.ny * sa, ca, ...uvOf(c, r, x, y));
        };
        const a = v(p, r0);
        const bq = v(q, r0);
        const cq = v(q, r1);
        const d = v(p, r1);
        // Contour runs CCW seen from above; the visible side faces inward.
        gb.tri(a, cq, bq);
        gb.tri(a, d, cq);
      }
    }
  };
  strip(turf, lowerRows, (_c, _r, x, y) => floorUv(x, y), true);
  strip((p, q) => glass[(p.qy + q.qy) / 2 < 0 ? 0 : 1]!, wallRows, (c, r) => [c.u / 1400, r.z / 1400], true);
  strip(top, upperRows, (c, r) => [c.u / 1400, r.z / 1400], false);
  {
    const c = top.vert(0, 0, H, 0, 0, -1, 0.5, 0.5);
    const ring = OCTAGON_INSET.map(([x, y]) => top.vert(x, y, H, 0, 0, -1, x / 1400, y / 1400));
    for (let i = 0; i < ring.length; i++) top.tri(c, ring[(i + 1) % ring.length]!, ring[i]!);
  }

  // Turf material with a grass detail layer.
  const detail = grassDetail();
  const turfMat = new THREE.MeshStandardMaterial({ map: turfTexture(), roughness: 0.92, metalness: 0 });
  turfMat.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail };
    sh.vertexShader = sh.vertexShader.replace('#include <uv_pars_vertex>', '#include <uv_pars_vertex>\nvarying vec2 vWorldXZ;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform sampler2D detailMap;\nvarying vec2 vWorldXZ;')
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat dt = texture2D(detailMap, vWorldXZ * 0.9).r * 0.6 + texture2D(detailMap, vWorldXZ * 0.13).r * 0.4;\ndiffuseColor.rgb *= 0.55 + dt * 0.9;');
  };
  const turfMesh = new THREE.Mesh(turf.build(), turfMat);
  turfMesh.receiveShadow = true;
  group.add(turfMesh);

  // Glass walls with a glowing hex pattern, tinted per team.
  const hex = hexTexture(5);
  const fade = wallFade();
  for (const team of [0, 1] as const) {
    const col = new THREE.Color(TEAM_COLORS[team].glow);
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x101a3c).lerp(col, 0.12), emissive: col, emissiveMap: hex, emissiveIntensity: 0.45, alphaMap: fade, transparent: true, opacity: 1, roughness: 0.2, metalness: 0.4, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(glass[team]!.build(), m);
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  const topMat = new THREE.MeshStandardMaterial({ color: 0x0b1024, emissive: 0x5070ff, emissiveMap: hex, emissiveIntensity: 0.12, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const topMesh = new THREE.Mesh(top.build(), topMat);
  topMesh.renderOrder = 3;
  group.add(topMesh);

  // Glowing light strips where the curve meets the wall, and along the top.
  for (const z of [R + 24, H - R - 10]) {
    for (const team of [0, 1] as const) {
      const b = new GeoBuilder();
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i]!;
        const q = pts[i + 1]!;
        if ((p.qy + q.qy) / 2 < 0 !== (team === 0)) continue;
        if (z < GH && inGoalMouth(p, q, z)) continue;
        const v = (c: ContourPt, zz: number) => b.vert(c.qx + c.nx * (R - 3), c.qy + c.ny * (R - 3), zz, -c.nx, -c.ny, 0, 0, 0);
        const a = v(p, z - 9);
        const bq = v(q, z - 9);
        const cq = v(q, z + 9);
        const d = v(p, z + 9);
        b.tri(a, cq, bq);
        b.tri(a, d, cq);
      }
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(TEAM_COLORS[team].glow).multiplyScalar(z < GH ? 2.4 : 1.6), toneMapped: false, side: THREE.DoubleSide });
      group.add(new THREE.Mesh(b.build(), m));
    }
  }

  // --- Goals: net box + glowing frame.
  const goalLights: THREE.Material[] = [];
  const netTex = hexTexture(9, 256);
  netTex.repeat.set(6, 3);
  for (const team of [0, 1] as const) {
    const s = team === 0 ? -1 : 1;
    const col = new THREE.Color(TEAM_COLORS[team].glow);
    const netMat = new THREE.MeshStandardMaterial({ color: 0x15182a, emissive: col, emissiveMap: netTex, emissiveIntensity: 0.9, roughness: 0.8, side: THREE.DoubleSide });
    const box = new THREE.Group();
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * GX * S, GH * S), netMat);
    back.position.set(0, (GH / 2) * S, -s * (HY + GD) * S);
    box.add(back);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(2 * GX * S, GD * S), netMat);
    roof.rotation.x = Math.PI / 2;
    roof.position.set(0, GH * S, -s * (HY + GD / 2) * S);
    box.add(roof);
    // Side walls including the cut of the floor curve.
    const shape = new THREE.Shape();
    shape.moveTo(HY - R, 0);
    for (let k = 1; k <= 8; k++) {
      const a = (k / 8) * (Math.PI / 2);
      shape.lineTo(HY - R + R * Math.sin(a), R - R * Math.cos(a));
    }
    shape.lineTo(HY, GH);
    shape.lineTo(HY + GD, GH);
    shape.lineTo(HY + GD, 0);
    shape.closePath();
    const sideGeo = new THREE.ShapeGeometry(shape);
    // Shape (u = |y|, v = z) → three (x, z·S, −y·S).
    const pos = sideGeo.getAttribute('position') as THREE.BufferAttribute;
    const uv = sideGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (const gx of [-GX, GX]) {
      const g = sideGeo.clone();
      const gp = g.getAttribute('position') as THREE.BufferAttribute;
      const gu = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const yy = pos.getX(i);
        const zz = pos.getY(i);
        gp.setXYZ(i, gx * S, zz * S, -s * yy * S);
        gu.setXY(i, uv.getX(i) / 900, uv.getY(i) / 900);
      }
      g.computeVertexNormals();
      box.add(new THREE.Mesh(g, netMat));
    }
    group.add(box);
    // Frame: posts + crossbar.
    const frameMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.6), toneMapped: false });
    goalLights.push(frameMat);
    const r = 14 * S;
    for (const gx of [-GX, GX]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GH * S, 12), frameMat);
      post.position.set(gx * S, (GH / 2) * S, -s * (HY + 6) * S);
      group.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2 * GX * S, 12), frameMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, GH * S, -s * (HY + 6) * S);
    group.add(bar);
    // A light inside the goal.
    const gl = new THREE.PointLight(col, 6, 14, 1.6);
    gl.position.set(0, 3.5, -s * (HY + 300) * S);
    group.add(gl);
  }

  // --- Stadium: tiered stands with crowds, light towers, sky.
  const stands = new THREE.Group();
  for (const team of [0, 1] as const) {
    const mat = new THREE.MeshStandardMaterial({ map: crowdTexture(team), roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.06 });
    mat.emissiveMap = mat.map;
    const b = new GeoBuilder();
    // A sloped band outside the arena contour.
    const inner = 500;
    const outer = 4200;
    const z0 = -200;
    const z1 = 4200;
    const outline = pts.filter((_, i) => i % 2 === 0);
    for (let i = 0; i < outline.length - 1; i++) {
      const p = outline[i]!;
      const q = outline[i + 1]!;
      if ((p.qy + q.qy) / 2 < 0 !== (team === 0)) continue;
      const v = (c: ContourPt, d: number, z: number, vv: number) => b.vert(c.qx + c.nx * (R + d), c.qy + c.ny * (R + d), z, -c.nx * 0.7, -c.ny * 0.7, 0.7, c.u / 3000, vv);
      const a = v(p, inner, z0, 0);
      const bq = v(q, inner, z0, 0);
      const cq = v(q, outer, z1, 2);
      const d = v(p, outer, z1, 2);
      b.tri(a, cq, bq);
      b.tri(a, d, cq);
    }
    stands.add(new THREE.Mesh(b.build(), mat));
  }
  group.add(stands);
  // Light towers on the stadium rim.
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x2a2f45, metalness: 0.6, roughness: 0.4 });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 0.95).multiplyScalar(4), toneMapped: false });
  for (const [x, y] of [
    [-5800, -6800],
    [5800, -6800],
    [-5800, 6800],
    [5800, 6800],
    [-7600, 0],
    [7600, 0],
  ] as Array<[number, number]>) {
    const tower = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 70, 8), towerMat);
    pole.position.y = 35;
    tower.add(pole);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 1.2), towerMat);
    panel.position.y = 70;
    tower.add(panel);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 2; j++) {
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(1.1, 12), lampMat);
        lamp.position.set(-5.2 + i * 3.5, 68.4 + j * 3.2, 0.65);
        tower.add(lamp);
      }
    tower.position.copy(toThree(x, y, 0));
    tower.lookAt(0, 0, 0);
    group.add(tower);
  }
  return {
    group,
    goalLights: goalLights as [THREE.Material, THREE.Material],
    update() {},
  };
}

/** Night-sky dome with a stadium glow at the horizon. */
export function buildSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      void main(){
        float h = vDir.y;
        vec3 top = vec3(0.02,0.03,0.09);
        vec3 mid = vec3(0.10,0.12,0.32);
        vec3 hor = vec3(0.45,0.33,0.55);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.25, h));
        c = mix(c, top, smoothstep(0.25, 0.9, h));
        vec3 g = floor(vDir * 300.0);
        float s = step(0.997, hash(g)) * smoothstep(0.15, 0.5, h);
        c += vec3(s);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}
