import * as THREE from 'three';
import { ARENA, GOAL_BACK_OUT, GOAL_INNER, GOAL_R, GOAL_RS, OCTAGON_INSET, arenaDistance, arenaMainDistance } from '../sim/arena';
import { BOOST_PADS } from '../sim/constants';
import { TEAM_COLORS } from './colors';
import type { ArenaTheme, Rgb } from './themes';

/** Sim (x, y, z) in Unreal units → three.js (x, z, −y) in metres. */
export const S = 0.01;
export const toThree = (x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 => out.set(x * S, z * S, -y * S);

const R = ARENA.fillet;
const H = ARENA.height;
const GX = ARENA.goalHalfX;
const GH = ARENA.goalHeight;
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
  /** Goal sweeps: use field UVs (turf) instead of surface UVs. */
  turfUv = false;
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
  /** A triangle wound so its front face points along its vertex normals. */
  triFacing(a: number, b: number, c: number): void {
    const P = this.pos;
    const N = this.nor;
    const e = (i: number, j: number, k: number) => P[j * 3 + k]! - P[i * 3 + k]!;
    const fx = e(a, b, 1) * e(a, c, 2) - e(a, b, 2) * e(a, c, 1);
    const fy = e(a, b, 2) * e(a, c, 0) - e(a, b, 0) * e(a, c, 2);
    const fz = e(a, b, 0) * e(a, c, 1) - e(a, b, 1) * e(a, c, 0);
    const d = fx * (N[a * 3]! + N[b * 3]! + N[c * 3]!) + fy * (N[a * 3 + 1]! + N[b * 3 + 1]! + N[c * 3 + 1]!) + fz * (N[a * 3 + 2]! + N[b * 3 + 2]! + N[c * 3 + 2]!);
    if (d < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
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

/**
 * Generated textures are expensive (the turf alone is 2048 × 2560 with 42k
 * blades), so each is built once per theme and kept for the session. Arena
 * disposal skips anything in CACHED_TEXTURES.
 */
const texCache = new Map<string, THREE.Texture>();
export const CACHED_TEXTURES = new Set<THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    texCache.set(key, t);
    CACHED_TEXTURES.add(t);
  }
  return t;
}

/** Async variant for the big textures: built in slices between yields so the loading spinner keeps turning. */
const texPending = new Map<string, Promise<THREE.Texture>>();
function cachedAsync(key: string, make: () => Promise<THREE.Texture>): Promise<THREE.Texture> {
  const t = texCache.get(key);
  if (t) return Promise.resolve(t);
  let p = texPending.get(key);
  if (!p) {
    p = make().then((t) => {
      texCache.set(key, t);
      CACHED_TEXTURES.add(t);
      texPending.delete(key);
      return t;
    });
    texPending.set(key, p);
  }
  return p;
}

const rgba = (rgb: string, a: number) => `rgba(${rgb},${a})`;

/** Turf: mowed stripes (or plates / dirt / snow), team tints and the field markings (2048 × 2560 = 4 uu/px). */
function turfTexture(theme: ArenaTheme, pause: Yield): Promise<THREE.Texture> {
  return cachedAsync(`turf:${theme.id}`, async () => {
    const T = theme.turf;
    const W = 2048;
    const Hh = 2560;
    const [c, g] = canvas(W, Hh);
    const px = (x: number) => ((x + ARENA.halfX) / (2 * ARENA.halfX)) * W;
    const py = (y: number) => (1 - (y + HY) / (2 * HY)) * Hh; // canvas y down = sim −y... flipped below via uv
    // Base + bands across the width (mowing stripes, or deck plates for metal).
    const band = T.kind === 'metal' ? 1024 : 512;
    for (let y = -HY - 1000; y < HY + 1000; y += band) {
      const even = Math.round((y + HY) / band) % 2 === 0;
      g.fillStyle = even ? T.base[0] : T.base[1];
      g.fillRect(0, py(y + band), W, py(y) - py(y + band) + 1);
    }
    if (T.kind === 'dirt') {
      // Dusty blotches and a web of cracks.
      for (let i = 0; i < 700; i++) {
        if (i === 350) await pause();
        const v = Math.random();
        g.fillStyle = v < 0.5 ? `rgba(70,45,20,${0.05 + Math.random() * 0.08})` : `rgba(230,200,150,${0.04 + Math.random() * 0.08})`;
        g.beginPath();
        g.ellipse(Math.random() * W, Math.random() * Hh, 20 + Math.random() * 120, 10 + Math.random() * 60, Math.random() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = 'rgba(60,38,18,0.55)';
      g.lineCap = 'round';
      await pause();
      for (let i = 0; i < 520; i++) {
        if (i % 130 === 129) await pause();
        let x = Math.random() * W;
        let y = Math.random() * Hh;
        let a = Math.random() * Math.PI * 2;
        g.lineWidth = 1 + Math.random() * 1.6;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 6 + Math.random() * 8; k++) {
          a += (Math.random() - 0.5) * 1.4;
          x += Math.cos(a) * (8 + Math.random() * 18);
          y += Math.sin(a) * (8 + Math.random() * 18);
          g.lineTo(x, y);
        }
        g.stroke();
      }
    } else if (T.kind === 'snow') {
      // Soft drifts and the odd tyre track.
      for (let i = 0; i < 300; i++) {
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        grd.addColorStop(0, `rgba(190,205,230,${0.12 + Math.random() * 0.12})`);
        grd.addColorStop(1, 'rgba(190,205,230,0)');
        g.fillStyle = grd;
        const r = 40 + Math.random() * 160;
        g.setTransform(r, 0, 0, r * 0.5, Math.random() * W, Math.random() * Hh);
        g.fillRect(-1, -1, 2, 2);
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    } else if (T.kind === 'metal') {
      // Plate seams and rivets.
      g.strokeStyle = 'rgba(10,12,20,0.75)';
      g.lineWidth = 3;
      for (let x = 0; x <= W; x += 256) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, Hh);
        g.stroke();
      }
      for (let y = 0; y <= Hh; y += 256) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(140,150,170,0.5)';
      for (let x = 12; x < W; x += 256) for (let y = 12; y < Hh; y += 256) for (const [ox, oy] of [[0, 0], [232, 0], [0, 232], [232, 232]]) g.fillRect(x + ox!, y + oy!, 4, 4);
    } else if (T.kind === 'synthetic') {
      // Rubber-crumb speckle.
      for (let i = 0; i < 24000; i++) {
        if (i % 6000 === 5999) await pause();
        g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(90,140,90,0.2)';
        g.fillRect(Math.random() * W, Math.random() * Hh, 2, 2);
      }
    }
    await pause();
    // Team tints.
    const tint = (y0: number, y1: number, color: string) => {
      const grd = g.createLinearGradient(0, py(y0), 0, py(y1));
      grd.addColorStop(0, color.replace('A', String(0.16 * T.teamTint)));
      grd.addColorStop(1, color.replace('A', String(0.02 * T.teamTint)));
      g.fillStyle = grd;
      g.fillRect(0, Math.min(py(y0), py(y1)), W, Math.abs(py(y1) - py(y0)));
    };
    if (T.teamTint > 0) {
      tint(-HY - 900, 0, 'rgba(40,110,255,A)');
      tint(HY + 900, 0, 'rgba(255,120,30,A)');
    }
    // Lines: crisp paint with a soft edge.
    g.strokeStyle = rgba(T.line, 0.82);
    g.shadowColor = rgba(T.line, T.lineGlow);
    g.shadowBlur = T.lineGlow > 0 ? 4 : 0;
    g.lineWidth = 6;
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
    g.fillStyle = rgba(T.line, 0.9);
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
    g.shadowBlur = 0;
    g.lineWidth = 4;
    g.strokeStyle = rgba(T.line, 0.25);
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
  });
}

/**
 * Tileable grass: thousands of short blades (grey, multiplied over the turf)
 * plus a normal map derived from the same blades so light catches them.
 * Shared by every theme (dirt / snow use it as fine grain).
 */
async function grassTextures(pause: Yield): Promise<{ detail: THREE.Texture; normal: THREE.Texture }> {
  const detail = await cachedAsync('grass:detail', async () => {
    const N = 512;
    const [c, g] = canvas(N, N);
    g.fillStyle = '#7a7a7a';
    g.fillRect(0, 0, N, N);
    // Soft clumps.
    for (let i = 0; i < 260; i++) {
      const v = 100 + Math.random() * 60;
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grd.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
      grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grd;
      const x = Math.random() * N;
      const y = Math.random() * N;
      const r = 10 + Math.random() * 40;
      for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]] as const) {
        g.setTransform(r, 0, 0, r, x + ox, y + oy);
        g.fillRect(-1, -1, 2, 2);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Blades (wrapped so the tile is seamless).
    g.lineCap = 'round';
    for (let i = 0; i < 42000; i++) {
      if (i % 7000 === 6999) await pause();
      const v = 55 + Math.random() * 170;
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.lineWidth = 0.8 + Math.random() * 1.1;
      const x = Math.random() * N;
      const y = Math.random() * N;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      const l = 3 + Math.random() * 7;
      for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]] as const) {
        if (ox && (x > 12 && x < N - 12)) continue;
        if (oy && (y > 12 && y < N - 12)) continue;
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
        g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  });
  const normal = await cachedAsync('grass:normal', async () => {
    // Normal map from the blade heights (Sobel, wrapped).
    const N = 512;
    const g = (detail.image as HTMLCanvasElement).getContext('2d')!;
    const src = g.getImageData(0, 0, N, N).data;
    const [nc, ng] = canvas(N, N);
    const out = ng.createImageData(N, N);
    const h = (x: number, y: number) => src[(((y + N) % N) * N + ((x + N) % N)) * 4]! / 255;
    const k = 2.2;
    for (let y = 0; y < N; y++) {
      if (y % 128 === 127) await pause();
      for (let x = 0; x < N; x++) {
        const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)) * k;
        const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)) * k;
        const l = Math.hypot(dx, dy, 1);
        const o = (y * N + x) * 4;
        out.data[o] = ((-dx / l) * 0.5 + 0.5) * 255;
        out.data[o + 1] = ((dy / l) * 0.5 + 0.5) * 255;
        out.data[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
        out.data[o + 3] = 255;
      }
    }
    ng.putImageData(out, 0, 0);
    const t = new THREE.CanvasTexture(nc);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  });
  return { detail, normal };
}

/** Hexagon (or square grid) glow pattern for walls / ceiling: crisp lines, soft halo, faintly lit cells. */
function hexTexture(line: number, pattern: 'hex' | 'grid', size = 1024): THREE.Texture {
  return cached(`wall:${pattern}:${line}`, () => {
    const [c, g] = canvas(size, size);
    // Opaque black base: emissive maps use RGB, and faint strokes on a transparent
    // canvas would un-premultiply to full white.
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    const cells: Array<[number, number]> = [];
    let cellPath: (cx: number, cy: number, inset: number) => void;
    let r: number;
    if (pattern === 'hex') {
      r = size / 6;
      const w = Math.sqrt(3) * r;
      for (let row = -1; row < size / (1.5 * r) + 1; row++) for (let col = -1; col < size / w + 1; col++) cells.push([col * w + (row % 2 ? w / 2 : 0), row * 1.5 * r]);
      cellPath = (cx, cy, inset) => {
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          const x = cx + (r - inset) * Math.cos(a);
          const y = cy + (r - inset) * Math.sin(a);
          k ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.closePath();
      };
    } else {
      r = size / 8;
      for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) cells.push([col * r + r / 2, row * r + r / 2]);
      cellPath = (cx, cy, inset) => {
        g.beginPath();
        g.rect(cx - r / 2 + inset, cy - r / 2 + inset, r - inset * 2, r - inset * 2);
      };
    }
    // Faintly lit cells (some brighter), fading to the centre.
    for (const [cx, cy] of cells) {
      const lit = Math.random() < 0.12 ? 0.16 : 0.035 + Math.random() * 0.04;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, `rgba(255,255,255,${lit * 0.3})`);
      grd.addColorStop(1, `rgba(255,255,255,${lit})`);
      g.fillStyle = grd;
      cellPath(cx, cy, line);
      g.fill();
    }
    // Glow, then crisp lines.
    g.strokeStyle = '#fff';
    g.shadowColor = 'rgba(255,255,255,0.9)';
    g.shadowBlur = line * 3;
    g.lineWidth = line;
    for (const [cx, cy] of cells) {
      cellPath(cx, cy, 0);
      g.stroke();
    }
    g.shadowBlur = 0;
    g.lineWidth = Math.max(1, line * 0.45);
    for (const [cx, cy] of cells) {
      cellPath(cx, cy, 0);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  });
}

/** Glass / panel albedo: subtle smudges and fine scratches. */
function glassTexture(): THREE.Texture {
  return cached('glass', () => {
    const N = 512;
    const [c, g] = canvas(N, N);
    g.fillStyle = '#9aa3b8';
    g.fillRect(0, 0, N, N);
    for (let i = 0; i < 120; i++) {
      const v = 140 + Math.random() * 60;
      g.fillStyle = `rgba(${v},${v},${v + 10},0.08)`;
      g.beginPath();
      g.ellipse(Math.random() * N, Math.random() * N, 20 + Math.random() * 80, 10 + Math.random() * 40, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 0.7;
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * N;
      const y = Math.random() * N;
      const a = Math.random() * Math.PI;
      const l = 4 + Math.random() * 30;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  });
}

/** Wall opacity by height (uv1.y = z / ceiling): solid panels low, clear glass high. */
function wallFade(): THREE.Texture {
  return cached('wallfade', () => {
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
  });
}

/** Crowd texture layout: people per row and rows per tile (the shader animates them per cell). */
const CROWD_COLS = 64;
const CROWD_ROWS = 8;
/** One tile spans this many uu along the stands (≈ 110 uu per seat: big enough to read from mid-field). */
const CROWD_TILE_U = CROWD_COLS * 110;
/** Stand rows per texture row. */
const CROWD_ROW_SPAN = 2;
/** Average colour per crowd texture (the shader fades distant seats towards it). */
const crowdAvg = new Map<THREE.Texture, THREE.Color>();

type CrowdPalette = NonNullable<ArenaTheme['surround']['crowd']>;

/**
 * Seated fans, one row per cell: seat backs, bodies in team colours (or mixed),
 * skin / hair, the odd scarf, raised arms and empty seats.
 */
function crowdTexture(kind: 0 | 1 | 2, P: CrowdPalette, id: string): THREE.Texture {
  const t = cached(`crowd:${id}:${kind}`, () => {
    const CW = 32;
    const CH = 64;
    const [c, g] = canvas(CROWD_COLS * CW, CROWD_ROWS * CH);
    const { blue, orange, neutral } = P;
    const skins = ['#f1c7a0', '#d9a77d', '#b9805a', '#8d5a3b', '#5e3b26'];
    const hairs = ['#1d1510', '#3b2616', '#6b4423', '#b88a4a', '#d9c7a0', '#111'];
    const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
    const seatCol = P.seats[kind];
    // Concrete tiers behind the seats.
    g.fillStyle = P.tier;
    g.fillRect(0, 0, c.width, c.height);
    for (let row = 0; row < CROWD_ROWS; row++) {
      const y0 = row * CH;
      // Step edge.
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, y0 + CH - 8, c.width, 8);
      for (let col = 0; col < CROWD_COLS; col++) {
        const x0 = col * CW;
        // Seat back.
        g.fillStyle = seatCol;
        g.fillRect(x0 + 4, y0 + 30, CW - 8, 22);
        if (Math.random() < 0.12) continue; // empty seat
        const teamFan = kind === 2 ? Math.random() < P.teamFans * 0.6 : Math.random() < P.teamFans;
        const palette = kind === 0 || (kind === 2 && Math.random() < 0.5) ? blue : orange;
        const shirt = teamFan ? pick(palette) : pick(neutral);
        const jx = x0 + (Math.random() - 0.5) * 4;
        const jy = y0 + (Math.random() - 0.5) * 4;
        // Body.
        g.fillStyle = shirt;
        g.beginPath();
        g.roundRect(jx + 6, jy + 24, CW - 12, 30, 7);
        g.fill();
        // Scarf.
        if (teamFan && Math.random() < 0.25) {
          g.fillStyle = palette === blue ? '#e9eef8' : '#1c0a00';
          g.fillRect(jx + 8, jy + 24, CW - 16, 4);
        }
        // Raised arms / flag.
        if (Math.random() < 0.14) {
          g.fillStyle = shirt;
          g.fillRect(jx + 3, jy + 6, 4, 22);
          g.fillRect(jx + CW - 7, jy + 6, 4, 22);
          if (Math.random() < 0.35) {
            g.fillStyle = palette[0]!;
            g.fillRect(jx + CW - 7, jy - 6, 14, 10);
          }
        }
        // Head.
        g.fillStyle = pick(skins);
        g.beginPath();
        g.arc(jx + CW / 2, jy + 17, 7, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = Math.random() < 0.15 && teamFan ? palette[0]! : pick(hairs); // hair or a team cap
        g.beginPath();
        g.arc(jx + CW / 2, jy + 15, 7, Math.PI, Math.PI * 2);
        g.fill();
      }
    }
    // Lower the contrast a touch: from mid-field a crowd is a soft mass, not confetti.
    g.globalAlpha = 0.18;
    g.fillStyle = P.tier;
    g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    // Low anisotropy: at grazing angles the seats blur evenly instead of smearing into streaks.
    t.anisotropy = 2;
    // Average colour (linear) for the distance fade.
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0;
    let gg = 0;
    let b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 16) (r += d[i]!), (gg += d[i + 1]!), (b += d[i + 2]!);
    crowdAvg.set(t, new THREE.Color((r / (n / 4)) / 255, (gg / (n / 4)) / 255, (b / (n / 4)) / 255).convertSRGBToLinear());
    return t;
  });
  return t;
}

/** Goal net: a white diamond mesh on transparency (alpha-tested). */
function netTexture(): THREE.Texture {
  return cached('net', () => {
    const [c, g] = canvas(128, 128);
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = '#fff';
    g.lineWidth = 6;
    g.lineCap = 'round';
    for (const [x0, y0, x1, y1] of [
      [0, 64, 64, 0],
      [64, 128, 128, 64],
      [0, 64, 64, 128],
      [64, 0, 128, 64],
      [-64, 64, 0, 0],
      [128, 64, 192, 128],
    ] as const) {
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  });
}

/** Scrolling LED ribbon boards. */
function ledTexture(theme: ArenaTheme): THREE.Texture {
  return cached(`led:${theme.id}`, () => {
    const [c, g] = canvas(2048, 64);
    const panels = theme.led.panels;
    const w = c.width / panels.length;
    panels.forEach(([bg, fg, text], i) => {
      const grd = g.createLinearGradient(0, 0, 0, 64);
      grd.addColorStop(0, bg);
      grd.addColorStop(1, '#000');
      g.fillStyle = grd;
      g.fillRect(i * w, 0, w, 64);
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // Shrink long slogans to fit their panel.
      let size = 34;
      do g.font = `italic 900 ${size}px "Russo One", system-ui, sans-serif`;
      while (g.measureText(text).width > w * 0.86 && --size > 12);
      g.fillText(text, i * w + w / 2, 34);
    });
    // LED pixel grid.
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < c.width; x += 4) g.fillRect(x, 0, 1, 64);
    for (let y = 0; y < 64; y += 4) g.fillRect(0, y, c.width, 1);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 4;
    // Bowl u runs counter-clockwise, i.e. right-to-left as seen from the field: flip so text reads.
    t.repeat.x = -1;
    return t;
  });
}

/** Lit office windows for the skyline towers (albedo = dark facade, emissive = the lit cells). */
function windowTextures(): { map: THREE.Texture; emissive: THREE.Texture } {
  const make = (emissive: boolean) =>
    cached(`windows:${emissive ? 'e' : 'm'}`, () => {
      const N = 256;
      const [c, g] = canvas(N, N);
      g.fillStyle = emissive ? '#000' : '#1c1a22';
      g.fillRect(0, 0, N, N);
      const cell = 16;
      for (let y = 0; y < N; y += cell)
        for (let x = 0; x < N; x += cell) {
          const lit = Math.random() < 0.42;
          if (emissive) {
            if (!lit) continue;
            const warm = Math.random() < 0.7;
            g.fillStyle = warm ? `rgba(255,${200 + Math.random() * 40 | 0},${120 + Math.random() * 60 | 0},${0.55 + Math.random() * 0.45})` : `rgba(180,220,255,${0.5 + Math.random() * 0.4})`;
          } else g.fillStyle = lit ? '#2a2830' : '#101016';
          g.fillRect(x + 3, y + 4, cell - 6, cell - 7);
        }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      return t;
    });
  return { map: make(false), emissive: make(true) };
}

/**
 * The stadium bowl outline: a superellipse around the arena (and the goal
 * boxes), grown by `d` uu. Points run counter-clockwise seen from above.
 */
interface BowlPt {
  x: number;
  y: number;
  nx: number;
  ny: number;
  u: number;
}
const BOWL_A = 5300;
const BOWL_B = 6950;
const BOWL_N = 224;
function bowlOutline(d: number): BowlPt[] {
  const a = BOWL_A + d;
  const b = BOWL_B + d;
  const e = 2 / 5;
  const raw: Array<[number, number]> = [];
  for (let i = 0; i <= BOWL_N; i++) {
    const t = (i / BOWL_N) * Math.PI * 2;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    raw.push([a * Math.sign(c) * Math.abs(c) ** e, b * Math.sign(sn) * Math.abs(sn) ** e]);
  }
  let u = 0;
  return raw.map(([x, y], i) => {
    const [px, py] = raw[(i - 1 + BOWL_N) % BOWL_N]!;
    const [qx, qy] = raw[(i + 1) % BOWL_N]!;
    const tx = qx - px;
    const ty = qy - py;
    const l = Math.hypot(tx, ty) || 1;
    if (i) u += Math.hypot(x - raw[i - 1]![0], y - raw[i - 1]![1]);
    return { x, y, nx: ty / l, ny: -tx / l, u };
  });
}

/**
 * A band of the bowl between two (offset, height) rings, facing the field.
 * `sel` picks a builder per segment (e.g. per crowd section), or null to skip.
 */
function bowlBand(
  sel: (midY: number, segment: number) => GeoBuilder | null,
  d0: number,
  z0: number,
  d1: number,
  z1: number,
  v0: number,
  v1: number,
  uScale: number,
): void {
  const r0 = bowlOutline(d0);
  const r1 = bowlOutline(d1);
  // Fit a whole number of texture repeats around each ring (no seam).
  const fit = (r: BowlPt[]) => {
    const total = r[BOWL_N]!.u;
    return total / Math.max(1, Math.round(total / uScale));
  };
  const u0 = fit(r0);
  const u1 = fit(r1);
  // Facing the field: inward horizontally, tilted up by the band's slope.
  const run = d1 - d0;
  const rise = z1 - z0;
  const len = Math.hypot(run, rise) || 1;
  const hk = rise / len;
  const vk = run / len;
  for (let i = 0; i < BOWL_N; i++) {
    const gb = sel((r0[i]!.y + r0[i + 1]!.y) / 2, i);
    if (!gb) continue;
    const v = (p: BowlPt, z: number, vv: number, us: number) => gb.vert(p.x, p.y, z, -p.nx * hk, -p.ny * hk, vk, p.u / us, vv);
    const a = v(r0[i]!, z0, v0, u0);
    const bq = v(r0[i + 1]!, z0, v0, u0);
    const cq = v(r1[i + 1]!, z1, v1, u1);
    const dd = v(r1[i]!, z1, v1, u1);
    gb.tri(a, cq, bq);
    gb.tri(a, dd, cq);
  }
}

// ------------------------------------------------------------------ goal geometry

interface ProfilePt {
  /** Inner (radius-shrunk) point and outward normal in (y, z). */
  qy: number;
  qz: number;
  ny: number;
  nz: number;
  /** Arc length along the surface. */
  s: number;
}

/**
 * The goal's (y, z) cross-section (see sim/arena.ts), from the floor at y0,
 * round the ramp, up the leaning back and over the roof back to y0.
 */
function goalProfile(y0: number, extra: number): ProfilePt[] {
  const R2 = GOAL_R + extra;
  const [, B, C] = GOAL_INNER as Array<[number, number]>;
  const out: ProfilePt[] = [];
  const push = (qy: number, qz: number, ny: number, nz: number) => {
    const last = out[out.length - 1];
    const sy = qy + ny * R2;
    const sz = qz + nz * R2;
    const s = last ? last.s + Math.hypot(sy - (last.qy + last.ny * R2), sz - (last.qz + last.nz * R2)) : 0;
    out.push({ qy, qz, ny, nz, s });
  };
  const line = (ay: number, az: number, by: number, bz: number, ny: number, nz: number, first: boolean) => {
    const n = Math.max(1, Math.ceil(Math.hypot(by - ay, bz - az) / 70));
    for (let k = first ? 0 : 1; k <= n; k++) push(ay + ((by - ay) * k) / n, az + ((bz - az) * k) / n, ny, nz);
  };
  const arc = (cy: number, cz: number, a0: number, a1: number) => {
    const n = 12;
    for (let k = 1; k < n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      push(cy, cz, Math.cos(a), Math.sin(a));
    }
  };
  const [oy, oz] = GOAL_BACK_OUT;
  const aBack = Math.atan2(oz, oy);
  line(y0, B[1], B[0], B[1], 0, -1, true);
  arc(B[0], B[1], -Math.PI / 2, aBack);
  line(B[0], B[1], C[0], C[1], oy, oz, true);
  arc(C[0], C[1], aBack, Math.PI / 2);
  line(C[0], C[1], y0, C[1], 0, 1, true);
  return out;
}

interface GV {
  x: number;
  y: number;
  z: number;
  /** Normal facing into the goal. */
  nx: number;
  ny: number;
  nz: number;
  u: number;
  v: number;
}

/**
 * Sweep the goal cross-section across its width (side edges rounded) and emit
 * triangles for one goal (`sy` = ±1). `pick` chooses a builder per triangle
 * (or null to drop it).
 */
function sweepGoal(sy: number, extra: number, y0: number, pick: (c: { x: number; y: number; z: number; nz: number }) => GeoBuilder | null, cell: number): void {
  const prof = goalProfile(y0, extra);
  const R2 = GOAL_R + extra;
  const RSx = GOAL_RS + extra;
  const a = ARENA.goalHalfX - GOAL_RS;
  // Columns across x: left round, flat middle, right round. [side, phi] or [0, x].
  const cols: Array<{ sx: number; phi: number; x: number }> = [];
  for (let k = 8; k >= 1; k--) cols.push({ sx: -1, phi: (k / 8) * (Math.PI / 2), x: 0 });
  const nFlat = Math.ceil((2 * a) / 90);
  for (let k = 0; k <= nFlat; k++) cols.push({ sx: 0, phi: 0, x: -a + (2 * a * k) / nFlat });
  for (let k = 1; k <= 8; k++) cols.push({ sx: 1, phi: (k / 8) * (Math.PI / 2), x: 0 });
  const vtx = (p: ProfilePt, c: (typeof cols)[0]): GV => {
    const py = p.qy + p.ny * R2;
    const pz = p.qz + p.nz * R2;
    let x: number;
    let yy: number;
    let zz: number;
    let ox: number;
    let oyz: number;
    if (c.sx === 0) {
      x = c.x;
      yy = py;
      zz = pz;
      ox = 0;
      oyz = 1;
    } else {
      const sn = Math.sin(c.phi);
      const cs = Math.cos(c.phi);
      x = c.sx * (a + RSx * sn);
      yy = py - RSx * (1 - cs) * p.ny;
      zz = pz - RSx * (1 - cs) * p.nz;
      ox = c.sx * sn;
      oyz = cs;
    }
    // Arc length across the width (round edge, flat middle, round edge) so the net mesh stays square.
    const q = RSx * (Math.PI / 2);
    const across = c.sx < 0 ? q - RSx * c.phi : c.sx > 0 ? q + 2 * a + RSx * c.phi : q + c.x + a;
    // Normal into the goal = −outward.
    return { x, y: sy * yy, z: zz, nx: -ox, ny: -oyz * p.ny * sy, nz: -oyz * p.nz, u: p.s / cell, v: across / cell };
  };
  const grid = prof.map((p) => cols.map((c) => vtx(p, c)));
  for (let i = 0; i < prof.length - 1; i++)
    for (let j = 0; j < cols.length - 1; j++) {
      const A = grid[i]![j]!;
      const B = grid[i + 1]![j]!;
      const C = grid[i + 1]![j + 1]!;
      const D = grid[i]![j + 1]!;
      goalTri(pick, A, B, C);
      goalTri(pick, A, C, D);
    }
  // Flat side walls: the cross-section shrunk by the side radius. Behind the goal line it is
  // a convex polygon; in the mouth only the sliver under the arena's floor curve is exposed.
  const HYv = ARENA.halfY;
  const Rf = ARENA.fillet;
  for (const sx of [-1, 1]) {
    const X = sx * (a + RSx);
    const mk = (y: number, z: number): GV => ({ x: X, y: sy * y, z, nx: -sx, ny: 0, nz: 0, u: (y - y0) / cell, v: z / cell });
    const fan = (poly: Array<[number, number]>) => {
      if (poly.length < 3) return;
      const cy = poly.reduce((t, p) => t + p[0], 0) / poly.length;
      const cz = poly.reduce((t, p) => t + p[1], 0) / poly.length;
      const ctr = mk(cy, cz);
      for (let i = 0; i < poly.length; i++) goalTri(() => pickAll, ctr, mk(...poly[i]!), mk(...poly[(i + 1) % poly.length]!));
    };
    const pickAll = pick({ x: X, y: sy * (HYv + 100), z: GOAL_RS + 50, nz: 0 });
    if (!pickAll) continue;
    const ring = prof.map((p) => [p.qy + p.ny * (R2 - RSx), p.qz + p.nz * (R2 - RSx)] as [number, number]);
    // Clip to y ≥ goal line (Sutherland–Hodgman, one edge).
    const clipped: Array<[number, number]> = [];
    for (let i = 0; i < ring.length; i++) {
      const P = ring[i]!;
      const Q = ring[(i + 1) % ring.length]!;
      const pin = P[0] >= HYv;
      const qin = Q[0] >= HYv;
      if (pin) clipped.push(P);
      if (pin !== qin) {
        const t = (HYv - P[0]) / (Q[0] - P[0]);
        clipped.push([HYv, P[1] + (Q[1] - P[1]) * t]);
      }
    }
    fan(clipped);
    // Mouth sliver (net only): between the side wall's bottom and the floor curve.
    if (extra === 0) {
      const zb = GOAL_RS;
      const yStart = HYv - Rf + Math.sqrt(Rf * Rf - (Rf - zb) * (Rf - zb));
      const sliver: Array<[number, number]> = [[HYv, zb]];
      for (let k = 0; k <= 10; k++) {
        const y = HYv - ((HYv - yStart) * k) / 10;
        sliver.push([y, Rf - Math.sqrt(Math.max(0, Rf * Rf - (y - (HYv - Rf)) ** 2))]);
      }
      fan(sliver.reverse());
    }
  }
}

function goalTri(pick: (c: { x: number; y: number; z: number; nz: number }) => GeoBuilder | null, a: GV, b: GV, c: GV): void {
  const cx = (a.x + b.x + c.x) / 3;
  const cy = (a.y + b.y + c.y) / 3;
  const cz = (a.z + b.z + c.z) / 3;
  const gb = pick({ x: cx, y: cy, z: cz, nz: (a.nz + b.nz + c.nz) / 3 });
  if (!gb) return;
  // Wind so the face points along the (inward) vertex normals.
  const e1 = [b.x - a.x, b.y - a.y, b.z - a.z];
  const e2 = [c.x - a.x, c.y - a.y, c.z - a.z];
  const fn = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  const flip = fn[0]! * (a.nx + b.nx + c.nx) + fn[1]! * (a.ny + b.ny + c.ny) + fn[2]! * (a.nz + b.nz + c.nz) < 0;
  const isTurf = gb.turfUv;
  const ids = [a, b, c].map((v) => gb.vert(v.x, v.y, v.z, v.nx, v.ny, v.nz, ...(isTurf ? floorUv(v.x, v.y) : ([v.u, v.v] as [number, number]))));
  if (flip) gb.tri(ids[0]!, ids[2]!, ids[1]!);
  else gb.tri(ids[0]!, ids[1]!, ids[2]!);
}


// ------------------------------------------------------------------ meshes

/** Hands control back to the browser between heavy build steps (keeps the loading spinner moving). */
export type Yield = () => Promise<void>;
export const idle: Yield = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export interface ArenaView {
  group: THREE.Group;
  theme: ArenaTheme;
  /** Goal frames (flash on goal). */
  goalLights: [THREE.Material, THREE.Material];
  /** Goal boxes per team (faded out when the camera sits behind that goal line). */
  shells: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  /** Animate the crowd / LED boards / sky. */
  update(dt: number): void;
  /** The crowd erupts and the boards flash for a goal. */
  cheer(team: 0 | 1): void;
  /** The crowd roars (kickoff), no board flash. */
  roar(): void;
}

/** Free every geometry / material / non-cached texture under an object. */
export function disposeGroup(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture && !CACHED_TEXTURES.has(v as THREE.Texture)) (v as THREE.Texture).dispose();
      mat.dispose();
    }
    (o as THREE.Light).dispose?.();
  });
  root.removeFromParent();
}

const color = (c: string | Rgb, mul = 1) => (typeof c === 'string' ? new THREE.Color(c) : new THREE.Color(c[0], c[1], c[2])).multiplyScalar(mul);
const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);

/** The playing field: turf, curved walls, ceiling, light strips and both goals. Identical geometry for every theme. */
async function buildField(theme: ArenaTheme, group: THREE.Group, pause: Yield): Promise<{ goalLights: [THREE.Material, THREE.Material]; shells: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] }> {
  const pts = contour();
  const rows = profile();
  const T = theme.turf;
  const Wl = theme.walls;
  const glowOf = (team: 0 | 1) => new THREE.Color(Wl.glow ? Wl.glow[team] : TEAM_COLORS[team].glow);

  // --- Turf (floor + lower fillet + goal mouths), planar UVs.
  const turf = new GeoBuilder();
  {
    const c = turf.vert(0, 0, 0, 0, 0, 1, ...floorUv(0, 0));
    const ring = OCTAGON_INSET.map(([x, y]) => turf.vert(x, y, 0, 0, 0, 1, ...floorUv(x, y)));
    for (let i = 0; i < ring.length; i++) turf.tri(c, ring[i]!, ring[(i + 1) % ring.length]!);
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
  await pause();

  // Turf: field texture × fine detail, blade normal map, patchy colour and (for grass)
  // mowing stripes whose shade depends on the viewing direction, like real grass.
  const grass = await grassTextures(pause);
  await pause();
  const turfMap = await turfTexture(theme, pause);
  await pause();
  const detailScale = T.kind === 'grass' ? 1 : T.kind === 'metal' ? 0.25 : 0.6;
  const turfMat = std({ map: turfMap, normalMap: grass.normal, normalScale: new THREE.Vector2(T.normalScale, T.normalScale), roughness: T.roughness, metalness: T.kind === 'metal' ? 0.6 : 0 });
  turfMat.normalMap!.repeat.set((2 * ARENA.halfX) / 130, (2 * HY) / 130);
  turfMat.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: grass.detail };
    sh.vertexShader = sh.vertexShader.replace('#include <uv_pars_vertex>', '#include <uv_pars_vertex>\nvarying vec3 vWorldP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform sampler2D detailMap;\nvarying vec3 vWorldP;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 wxz = vWorldP.xz;
        float near = texture2D(detailMap, wxz * 0.78).r;
        float mid = texture2D(detailMap, wxz * 0.11).r;
        float grassPatch = texture2D(detailMap, wxz * 0.017 + 0.37).r;
        diffuseColor.rgb *= mix(1.0, 0.6 + near * 0.55 + mid * 0.3, ${detailScale.toFixed(2)});
        ${
          T.patches
            ? `// Large patches: slightly drier / lusher grass.
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 1.06, 0.82), smoothstep(0.45, 0.62, grassPatch) * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 0.95, 0.9), smoothstep(0.5, 0.35, grassPatch) * 0.5);`
            : ''
        }
        ${
          T.stripes
            ? `// Mowing stripes: blades lean one way per 5 m band, lighter when they lean away from you.
        float band = mod(floor(wxz.y / 5.12), 2.0) * 2.0 - 1.0;
        vec3 vdir = normalize(vWorldP - cameraPosition);
        diffuseColor.rgb *= 1.0 + band * vdir.z * 0.11;`
            : ''
        }`,
      );
  };
  // Goal floors (the flat part of each goal's sweep) are turf too; the rest is net.
  turf.turfUv = true;
  const netB = [new GeoBuilder(), new GeoBuilder()];
  const shellB = [new GeoBuilder(), new GeoBuilder()];
  const y0 = HY - R;
  for (const team of [0, 1] as const) {
    const sy = team === 0 ? -1 : 1;
    // Drop any part of the sweep that would float inside the main arena's open space.
    sweepGoal(sy, 0, y0, (c) => (arenaMainDistance(c.x, c.y, c.z) > 3 ? null : c.nz > 0.97 && c.z < 2 ? turf : netB[team]!), 90);
    sweepGoal(sy, 70, y0, (c) => (Math.abs(c.y) < HY + 2 ? null : shellB[team]!), 300);
  }
  const turfMesh = new THREE.Mesh(turf.build(), turfMat);
  turfMesh.receiveShadow = true;
  group.add(turfMesh);
  await pause();

  // Glass walls with a glowing hex / grid pattern, tinted per team.
  const hex = hexTexture(4, Wl.pattern);
  await pause();
  const fade = wallFade();
  const glassMap = glassTexture();
  for (const team of [0, 1] as const) {
    const col = glowOf(team);
    const m = std({ color: new THREE.Color(Wl.tint).lerp(col, 0.1), map: glassMap, emissive: col, emissiveMap: hex, emissiveIntensity: Wl.emissive, alphaMap: fade, transparent: true, opacity: 1, roughness: 0.08, metalness: 0.3, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(glass[team]!.build(), m);
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  const topMat = std({ color: new THREE.Color(Wl.tint).multiplyScalar(0.6), emissive: glowOf(0).lerp(glowOf(1), 0.5), emissiveMap: hex, emissiveIntensity: 0.06, transparent: true, opacity: Wl.top, side: THREE.DoubleSide, depthWrite: false });
  const topMesh = new THREE.Mesh(top.build(), topMat);
  topMesh.renderOrder = 3;
  group.add(topMesh);

  // Glowing light strips where the curve meets the wall, and along the top.
  if (Wl.strips > 0)
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
        const m = new THREE.MeshBasicMaterial({ color: glowOf(team).multiplyScalar((z < GH ? 2.4 : 1.6) * Wl.strips), toneMapped: false, side: THREE.DoubleSide });
        group.add(new THREE.Mesh(b.build(), m));
      }
    }

  // --- Goals (built for the orange end, mirrored for blue): see-through net, metal
  // frame, team-lit trim in the wall, and a dark enclosed goal box behind the net.
  // The box and corner plates are only ever seen from inside, so they're front-faced:
  // a camera that ends up behind the goal looks straight through their backs.
  const goalLights: THREE.Material[] = [];
  const shells: THREE.MeshStandardMaterial[] = [];
  const netTex = netTexture();
  const shellMat = std({ color: 0x07080f, roughness: 0.92, metalness: 0, side: THREE.FrontSide });
  const postMat = std({ color: 0xeef2fa, roughness: 0.22, metalness: 0.75, envMapIntensity: 1.3 });
  for (const team of [0, 1] as const) {
    const col = new THREE.Color(TEAM_COLORS[team].glow);
    const goal = new THREE.Group();
    // Local frame = orange goal: inside the arena is +z (three), the goal box is towards −z.
    if (team === 0) goal.rotation.y = Math.PI;
    // Net (the drivable surface) and the dark shell behind it, from the goal sweep.
    const netMat = std({ color: 0xe6ecff, map: netTex, alphaTest: 0.22, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.7, emissive: col.clone().lerp(new THREE.Color(1, 1, 1), 0.35), emissiveMap: netTex, emissiveIntensity: Wl.netGlow });
    group.add(new THREE.Mesh(netB[team]!.build(), netMat));
    const shellTeamMat = shellMat.clone();
    shellTeamMat.emissive = col.clone().multiplyScalar(0.05);
    shells.push(shellTeamMat);
    const shell = new THREE.Mesh(shellB[team]!.build(), shellTeamMat);
    shell.receiveShadow = true;
    group.add(shell);
    // Fill the rounded corners of the mouth (the wall is solid there).
    const plates = new GeoBuilder();
    for (const sx of [-1, 1])
      for (const top of [false, true]) {
        const cx = sx * (GX - GOAL_RS);
        const cz = top ? GH - GOAL_RS : GOAL_RS;
        const corner = plates.vert(sx * GX, team === 0 ? -HY : HY, top ? GH : 0, 0, team === 0 ? 1 : -1, 0, 0, 0);
        const a0 = top ? (sx > 0 ? 0 : Math.PI / 2) : sx > 0 ? -Math.PI / 2 : Math.PI;
        let prev = -1;
        for (let k = 0; k <= 8; k++) {
          const an = a0 + (k / 8) * (Math.PI / 2);
          const id = plates.vert(cx + Math.cos(an) * GOAL_RS, team === 0 ? -HY : HY, cz + Math.sin(an) * GOAL_RS, 0, team === 0 ? 1 : -1, 0, 0, 0);
          if (prev >= 0) plates.triFacing(corner, prev, id);
          prev = id;
        }
      }
    group.add(new THREE.Mesh(plates.build(), std({ color: 0x1a2038, roughness: 0.5, metalness: 0.4, side: THREE.FrontSide })));
    // Metal frame: two posts and a crossbar, set into the wall at the mouth.
    const P = 26;
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(P * S, (GH + P) * S, P * S), postMat);
      post.position.set(sx * (GX + P / 2) * S, ((GH + P) / 2) * S, -(HY + P / 2) * S);
      post.castShadow = true;
      goal.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry((2 * GX + 2 * P) * S, P * S, P * S), postMat);
    bar.position.set(0, (GH + P / 2) * S, -(HY + P / 2) * S);
    bar.castShadow = true;
    goal.add(bar);
    // Team-coloured light trim around the mouth (flashes on goals).
    const trimMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.8), toneMapped: false, side: THREE.DoubleSide });
    goalLights.push(trimMat);
    const T2 = 34;
    const trims: Array<[number, number, number, number]> = [
      [-(GX + P + T2 / 2), (GH + P) / 2, T2, GH + P],
      [GX + P + T2 / 2, (GH + P) / 2, T2, GH + P],
      [0, GH + P + T2 / 2, 2 * (GX + P + T2), T2],
    ];
    for (const [x, y, w, h] of trims) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w * S, h * S), trimMat);
      m.position.set(x * S, y * S, -(HY - 3) * S);
      goal.add(m);
    }
    // (The light inside each goal belongs to the renderer: the scene's light count must
    // never change on an arena switch, or every material in the scene recompiles.)
    group.add(goal);
  }
  return { goalLights: goalLights as [THREE.Material, THREE.Material], shells: shells as [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] };
}

// ------------------------------------------------------------------ surroundings

interface SurroundView {
  update(dt: number): void;
  cheer(team: 0 | 1): void;
  roar(): void;
}

/** Crowd: bobbing fans (they jump when a goal goes in), camera flashes, and a soft blur / fade with distance. */
function crowdMaterial(map: THREE.Texture, uniforms: { uTime: { value: number }; uCheer: { value: number } }, flashes: number): THREE.MeshStandardMaterial {
  const m = std({ map, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const avg = crowdAvg.get(map) ?? new THREE.Color(0.1, 0.1, 0.12);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, { uAvg: { value: avg } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCrowdP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCrowdP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uCheer;\nuniform vec3 uAvg;\nvarying vec3 vCrowdP;\nvec3 crowdGlow;\nfloat crowdFlash;\nfloat crowdHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat crowdNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(crowdHash(i), crowdHash(i + vec2(1.0, 0.0)), f.x), mix(crowdHash(i + vec2(0.0, 1.0)), crowdHash(i + vec2(1.0, 1.0)), f.x), f.y); }')
      .replace(
        '#include <map_fragment>',
        `vec2 cuv = vMapUv;
        vec2 cell = floor(cuv * vec2(${CROWD_COLS.toFixed(1)}, ${CROWD_ROWS.toFixed(1)}));
        float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
        float bob = max(0.0, sin(uTime * (4.0 + h * 5.0) + h * 40.0)) * (0.012 + uCheer * 0.075 * step(0.25, h));
        // Seen far away or edge-on, a seat shrinks below a pixel along one axis and the texture
        // minifies into streaks. Measure that footprint (seats per pixel, worst axis) and hand
        // over to a calm section colour with a faint block-level mottle before it happens.
        vec2 seatUv = cuv * vec2(${CROWD_COLS.toFixed(1)}, ${CROWD_ROWS.toFixed(1)});
        vec2 sdx = dFdx(seatUv);
        vec2 sdy = dFdy(seatUv);
        float foot = max(length(vec2(sdx.x, sdy.x)), length(vec2(sdx.y, sdy.y)));
        float far = max(smoothstep(0.1, 0.3, foot), smoothstep(40.0, 120.0, distance(vCrowdP, cameraPosition)) * 0.7);
        vec4 sampledDiffuseColor = texture2D(map, vec2(cuv.x, cuv.y - bob));
        // Smooth (interpolated) mottle over ~12-seat patches: no hard edges, so nothing to alias;
        // it too fades once the patches themselves get down to a few pixels.
        float mottle = crowdNoise(seatUv / vec2(12.0, 3.0)) - 0.5;
        vec3 mass = uAvg * (1.0 + mottle * 0.3 * (1.0 - smoothstep(2.5, 7.0, foot)));
        sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, mass, far);
        diffuseColor *= sampledDiffuseColor;
        crowdGlow = sampledDiffuseColor.rgb;
        crowdFlash = step(0.9992, fract(sin(dot(cell + floor(uTime * 5.0) * vec2(1.7, 3.1), vec2(7.13, 3.71))) * 9341.7)) * (0.35 + uCheer * 2.0) * ${flashes.toFixed(2)} * (1.0 - far);`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += crowdGlow * 0.32 + vec3(crowdFlash * 5.0);');
  };
  return m;
}

/** Shared bits of every surround: LED ribbon material with the goal pulse, crowd uniforms, cheer state. */
function surroundState(theme: ArenaTheme, ledTex: THREE.Texture | null, sky: THREE.ShaderMaterial | null): SurroundView & { crowdUniforms: { uTime: { value: number }; uCheer: { value: number } }; ledMat: THREE.MeshBasicMaterial } {
  const crowdUniforms = { uTime: { value: 0 }, uCheer: { value: 0 } };
  const ledBase = new THREE.Color(theme.led.base, theme.led.base, theme.led.base);
  const ledMat = new THREE.MeshBasicMaterial({ map: ledTex, toneMapped: false, color: ledBase.clone(), side: THREE.DoubleSide });
  let cheer = 0;
  let ledFlash = 0;
  let ledTeam: 0 | 1 = 0;
  return {
    crowdUniforms,
    ledMat,
    update(dt) {
      crowdUniforms.uTime.value += dt;
      cheer = Math.max(0, cheer - dt * 0.18);
      crowdUniforms.uCheer.value = Math.min(1, cheer);
      if (ledTex) ledTex.offset.x = (ledTex.offset.x - dt * 0.02) % 1;
      if (sky) sky.uniforms.uTime!.value += dt;
      // After a goal the ribbons pulse in the scoring team's colour.
      ledFlash = Math.max(0, ledFlash - dt * 0.25);
      if (ledFlash > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
        ledMat.color.copy(ledBase).lerp(new THREE.Color(TEAM_COLORS[ledTeam].glow).multiplyScalar(3), Math.min(1, ledFlash * 2) * pulse);
      } else ledMat.color.copy(ledBase);
    },
    cheer(team) {
      cheer = 1.6;
      ledFlash = 1.6;
      ledTeam = team;
    },
    roar() {
      cheer = Math.max(cheer, 0.9);
    },
  };
}

function groundDisc(theme: ArenaTheme, radius: number, grain: boolean): THREE.Mesh {
  const m = std({ color: theme.surround.ground, roughness: 0.95 });
  const n = texCache.get('grass:normal');
  if (grain && n) {
    // A clone shares the image (one upload) but gets its own tiling.
    m.normalMap = n.clone();
    m.normalScale.set(0.6, 0.6);
    m.normalMap.repeat.set(radius / 1.3, radius / 1.3);
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), m);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  return ground;
}

/** Crowd section picker shared by the stadium tiers: blue end / orange end / mixed sides, with stair aisles. */
function crowdPicker(crowdB: GeoBuilder[], aisles: GeoBuilder): (y: number, i: number) => GeoBuilder {
  const sectionOf = (y: number) => (y < -2600 ? 0 : y > 2600 ? 1 : 2);
  const baseRing = bowlOutline(0);
  return (y, i) => {
    const prev = baseRing[i]!;
    if (i % 14 === 0 || sectionOf(prev.y) !== sectionOf(y)) return aisles;
    return crowdB[sectionOf(y)]!;
  };
}

const ROW_RUN = 90;
const ROW_RISE_LO = 55;
const ROW_RISE_HI = 78;

/** Full stadium bowl: concourse, facades with LED ribbons, two tiers of fans, roof canopy. */
async function buildStadium(theme: ArenaTheme, group: THREE.Group, pause: Yield, sky: THREE.ShaderMaterial): Promise<SurroundView> {
  const Su = theme.surround;
  const C = Su.crowd!;
  group.add(groundDisc(theme, 160, false));
  const all = () => (_y: number) => structure;
  const structure = new GeoBuilder();
  const crowdB = [new GeoBuilder(), new GeoBuilder(), new GeoBuilder()];
  const aisles = new GeoBuilder();
  const snowB = new GeoBuilder();
  const crowdSel = crowdPicker(crowdB, aisles);
  const led = new GeoBuilder();
  const cap = () => (Su.snow ? () => snowB : all());
  // Lower bowl: facade (0 → 700), 26 rows rising to z ≈ 2130.
  const lowRows = 26;
  const highRows = 30;
  bowlBand(all(), -40, -20, 0, -20, 0, 0, 1000);
  bowlBand(all(), 0, -20, 0, 520, 0, 0, 1000);
  bowlBand(() => led, -4, 520, -4, 700, 0, 1, 6000);
  bowlBand(cap(), 0, 700, 60, 700, 0, 0, 1000);
  const loEndD = 60 + lowRows * ROW_RUN;
  const loEndZ = 700 + lowRows * ROW_RISE_LO;
  bowlBand(crowdSel, 60, 700, loEndD, loEndZ, 0, lowRows / (CROWD_ROWS * CROWD_ROW_SPAN), CROWD_TILE_U);
  // Walkway + upper facade with its own LED ribbon.
  const upD = loEndD + 260;
  bowlBand(cap(), loEndD, loEndZ, upD, loEndZ, 0, 0, 1000);
  bowlBand(all(), upD, loEndZ, upD, loEndZ + 300, 0, 0, 1000);
  bowlBand(() => led, upD - 4, loEndZ + 300, upD - 4, loEndZ + 480, 0, 1, 6000);
  const upZ = loEndZ + 480;
  const hiEndD = upD + highRows * ROW_RUN;
  const hiEndZ = upZ + highRows * ROW_RISE_HI;
  bowlBand(crowdSel, upD, upZ, hiEndD, hiEndZ, 0, highRows / (CROWD_ROWS * CROWD_ROW_SPAN), CROWD_TILE_U);
  // Back wall and the roof canopy (dark underside, floodlight ring on the inner lip).
  const roofZ = hiEndZ + 900;
  bowlBand(all(), hiEndD, hiEndZ, hiEndD, roofZ, 0, 0, 1000);
  const canopyIn = hiEndD - 2100;
  bowlBand(all(), hiEndD, roofZ, canopyIn, roofZ - 120, 0, 0, 1000);
  if (Su.snow) bowlBand(() => snowB, hiEndD + 10, roofZ + 2, hiEndD - 400, roofZ + 60, 0, 0, 1000);
  const flood = new GeoBuilder();
  bowlBand(() => flood, canopyIn, roofZ - 120, canopyIn, roofZ - 300, 0, 1, 2000);
  bowlBand(all(), canopyIn, roofZ - 300, canopyIn + 60, roofZ - 330, 0, 0, 1000);
  await pause();

  const structMat = std({ color: Su.struct, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
  const aisleMesh = new THREE.Mesh(aisles.build(), std({ color: Su.aisle, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }));
  aisleMesh.receiveShadow = true;
  group.add(aisleMesh);
  const structMesh = new THREE.Mesh(structure.build(), structMat);
  structMesh.receiveShadow = true;
  group.add(structMesh);
  if (Su.snow) group.add(new THREE.Mesh(snowB.build(), std({ color: 0xf2f5fa, roughness: 1, side: THREE.DoubleSide })));

  const ledTex = ledTexture(theme);
  const st = surroundState(theme, ledTex, sky);
  for (let k = 0; k < 3; k++) {
    const map = crowdTexture(k as 0 | 1 | 2, C, theme.id);
    await pause();
    group.add(new THREE.Mesh(crowdB[k]!.build(), crowdMaterial(map, st.crowdUniforms, C.flashes)));
  }
  group.add(new THREE.Mesh(led.build(), st.ledMat));
  group.add(new THREE.Mesh(flood.build(), new THREE.MeshBasicMaterial({ color: color(Su.flood), toneMapped: false, side: THREE.DoubleSide })));
  return st;
}

/** Lower tier of fans, then a ring of city towers with lit windows instead of an upper bowl. */
async function buildSkyline(theme: ArenaTheme, group: THREE.Group, pause: Yield, sky: THREE.ShaderMaterial): Promise<SurroundView> {
  const Su = theme.surround;
  const C = Su.crowd!;
  group.add(groundDisc(theme, 300, false));
  const structure = new GeoBuilder();
  const all = () => (_y: number) => structure;
  const crowdB = [new GeoBuilder(), new GeoBuilder(), new GeoBuilder()];
  const aisles = new GeoBuilder();
  const crowdSel = crowdPicker(crowdB, aisles);
  const led = new GeoBuilder();
  const flood = new GeoBuilder();
  const lowRows = 22;
  bowlBand(all(), -40, -20, 0, -20, 0, 0, 1000);
  bowlBand(all(), 0, -20, 0, 520, 0, 0, 1000);
  bowlBand(() => led, -4, 520, -4, 700, 0, 1, 6000);
  bowlBand(all(), 0, 700, 60, 700, 0, 0, 1000);
  const loEndD = 60 + lowRows * ROW_RUN;
  const loEndZ = 700 + lowRows * ROW_RISE_LO;
  bowlBand(crowdSel, 60, 700, loEndD, loEndZ, 0, lowRows / (CROWD_ROWS * CROWD_ROW_SPAN), CROWD_TILE_U);
  // Walkway, parapet with floodlights on top, then the rooftop drops away to the streets.
  const parD = loEndD + 300;
  bowlBand(all(), loEndD, loEndZ, parD, loEndZ, 0, 0, 1000);
  bowlBand(all(), parD, loEndZ, parD, loEndZ + 380, 0, 0, 1000);
  bowlBand(() => flood, parD - 6, loEndZ + 250, parD - 6, loEndZ + 360, 0, 1, 2000);
  bowlBand(all(), parD, loEndZ + 380, parD + 400, loEndZ + 380, 0, 0, 1000);
  bowlBand(all(), parD + 400, loEndZ + 380, parD + 400, -3000, 0, 0, 1000);
  await pause();
  const structMat = std({ color: Su.struct, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(aisles.build(), std({ color: Su.aisle, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide })));
  group.add(new THREE.Mesh(structure.build(), structMat));
  const ledTex = ledTexture(theme);
  const st = surroundState(theme, ledTex, sky);
  for (let k = 0; k < 3; k++) {
    const map = crowdTexture(k as 0 | 1 | 2, C, theme.id);
    await pause();
    group.add(new THREE.Mesh(crowdB[k]!.build(), crowdMaterial(map, st.crowdUniforms, C.flashes)));
  }
  group.add(new THREE.Mesh(led.build(), st.ledMat));
  group.add(new THREE.Mesh(flood.build(), new THREE.MeshBasicMaterial({ color: color(Su.flood), toneMapped: false, side: THREE.DoubleSide })));

  // Tower blocks: three rings, taller further out.
  const WIN_TILE = 16 * 260;
  const win = windowTextures();
  await pause();
  const tb = new GeoBuilder();
  const box = (cx: number, cy: number, w: number, d: number, h: number, zBase: number) => {
    const faces: Array<[number, number, number, number, number, number]> = [
      [1, 0, 0, cx + w / 2, 0, 1],
      [-1, 0, 0, cx - w / 2, 0, 1],
      [0, 1, 0, cy + d / 2, 1, 0],
      [0, -1, 0, cy - d / 2, 1, 0],
    ];
    for (const [nx, ny, , off, ax, ay] of faces) {
      // ax/ay choose which axis runs along the face.
      const ex = ax ? w / 2 : 0;
      const ey = ay ? d / 2 : 0;
      const x0 = nx ? off : cx - ex;
      const x1 = nx ? off : cx + ex;
      const yy0 = ny ? off : cy - ey;
      const yy1 = ny ? off : cy + ey;
      const len = nx ? d : w;
      // One window every ~260 uu (16 per texture tile).
      const a = tb.vert(x0, yy0, zBase, nx, ny, 0, 0, 0);
      const b = tb.vert(x1, yy1, zBase, nx, ny, 0, len / WIN_TILE, 0);
      const c = tb.vert(x1, yy1, zBase + h, nx, ny, 0, len / WIN_TILE, h / WIN_TILE);
      const dd = tb.vert(x0, yy0, zBase + h, nx, ny, 0, 0, h / WIN_TILE);
      // Face outward = towards the field for the inward-facing sides; wind by the normal.
      const flip = (nx > 0 && cx < 0) || (nx < 0 && cx > 0) || (ny > 0 && cy < 0) || (ny < 0 && cy > 0);
      if (flip) (tb.tri(a, b, c), tb.tri(a, c, dd));
      else (tb.tri(a, c, b), tb.tri(a, dd, c));
    }
    // Roof.
    const r0 = tb.vert(cx - w / 2, cy - d / 2, zBase + h, 0, 0, 1, 0, 0);
    const r1 = tb.vert(cx + w / 2, cy - d / 2, zBase + h, 0, 0, 1, 0.01, 0);
    const r2 = tb.vert(cx + w / 2, cy + d / 2, zBase + h, 0, 0, 1, 0.01, 0.01);
    const r3 = tb.vert(cx - w / 2, cy + d / 2, zBase + h, 0, 0, 1, 0, 0.01);
    tb.tri(r0, r1, r2);
    tb.tri(r0, r2, r3);
  };
  const beacons: THREE.Vector3[] = [];
  for (const [dist, hMin, hMax, n] of [
    [2600, 1800, 4200, 34],
    [5200, 3000, 8500, 30],
    [8200, 5000, 12000, 22],
  ] as const) {
    const ring = bowlOutline(dist);
    const step = BOWL_N / n;
    for (let i = 0; i < n; i++) {
      const p = ring[Math.floor(i * step + Math.random() * step * 0.5) % BOWL_N]!;
      const w = 700 + Math.random() * 900;
      const h = hMin + Math.random() * (hMax - hMin);
      box(p.x + p.nx * (Math.random() * 400), p.y + p.ny * (Math.random() * 400), w, w * (0.7 + Math.random() * 0.6), h, -3000);
      if (h > hMax - 1500) beacons.push(new THREE.Vector3(p.x * S, (h - 3000) * S + 0.3, -p.y * S));
    }
  }
  const towerMat = std({ color: 0x4a4650, map: win.map, emissive: 0xffffff, emissiveMap: win.emissive, emissiveIntensity: 0.75, roughness: 0.85, metalness: 0.1 });
  group.add(new THREE.Mesh(tb.build(), towerMat));
  // Red aircraft-warning beacons on the tallest towers (blink in update).
  const beacon = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.2), toneMapped: false }), beacons.length);
  const m4 = new THREE.Matrix4();
  beacons.forEach((p, i) => beacon.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
  group.add(beacon);
  const base = st.update;
  st.update = (dt) => {
    base(dt);
    beacon.visible = Math.sin(st.crowdUniforms.uTime.value * 2.5) > -0.3;
  };
  return st;
}

/** Desert: a tan plain, tyre-stack barriers around a low wall, floodlight poles and mesas on the horizon. */
async function buildCanyon(theme: ArenaTheme, group: THREE.Group, pause: Yield, sky: THREE.ShaderMaterial): Promise<SurroundView> {
  const Su = theme.surround;
  group.add(groundDisc(theme, 320, true));
  const structure = new GeoBuilder();
  const all = () => (_y: number) => structure;
  const led = new GeoBuilder();
  // Low barrier wall with the LED ribbon on it.
  bowlBand(all(), -40, -20, 0, -20, 0, 0, 1000);
  bowlBand(all(), 0, -20, 0, 300, 0, 0, 1000);
  bowlBand(() => led, -4, 300, -4, 440, 0, 1, 6000);
  bowlBand(all(), 0, 440, 90, 440, 0, 0, 1000);
  bowlBand(all(), 90, 440, 90, -20, 0, 0, 1000);
  await pause();
  group.add(new THREE.Mesh(structure.build(), std({ color: Su.struct, roughness: 0.8, metalness: 0.2, side: THREE.DoubleSide })));
  const ledTex = ledTexture(theme);
  const st = surroundState(theme, ledTex, sky);
  group.add(new THREE.Mesh(led.build(), st.ledMat));
  // Tyre stacks along the wall: three tyres high, some black, some painted white / red.
  // In front of the barrier, two stacks deep.
  const ring = [...bowlOutline(-90), ...bowlOutline(-160)];
  const tyreGeo = new THREE.TorusGeometry(0.62, 0.26, 7, 14).rotateX(Math.PI / 2);
  const tyres: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const pal = [new THREE.Color(0x151515), new THREE.Color(0x151515), new THREE.Color(0x151515), new THREE.Color(0xe8e4dc), new THREE.Color(0xc42a2a)];
  for (let i = 0; i < ring.length; i += 2) {
    const p = ring[i]!;
    // Keep clear of the arena (and its goal boxes).
    if (arenaDistance(p.x, p.y, 100) > -150) continue;
    const n = 3 + Math.floor(Math.random() * 4);
    const c = pal[Math.floor(Math.random() * pal.length)]!;
    for (let k = 0; k < n; k++) {
      tyres.push(new THREE.Matrix4().makeTranslation(p.x * S + (Math.random() - 0.5) * 0.15, 0.26 + k * 0.5, -p.y * S + (Math.random() - 0.5) * 0.15));
      cols.push(c);
    }
  }
  const tyreMesh = new THREE.InstancedMesh(tyreGeo, std({ color: 0xffffff, roughness: 0.95 }), tyres.length);
  tyres.forEach((m, i) => (tyreMesh.setMatrixAt(i, m), tyreMesh.setColorAt(i, cols[i]!)));
  tyreMesh.castShadow = true;
  group.add(tyreMesh);
  await pause();
  // Floodlight poles at the four corners.
  const poleMat = std({ color: 0x3a3a40, roughness: 0.6, metalness: 0.6 });
  const headMat = new THREE.MeshBasicMaterial({ color: color(Su.flood), toneMapped: false });
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 32, 8), poleMat);
    pole.position.set(sx * 52, 16, sy * 62);
    group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 1), headMat);
    head.position.set(sx * 52, 31, sy * 62);
    head.lookAt(0, 8, 0);
    group.add(head);
  }
  // Mesas: layered low-poly cylinders, banded red / tan.
  const mesaMat = std({ color: 0xa8623c, roughness: 1, flatShading: true });
  const capMat = std({ color: 0xc48a5a, roughness: 1, flatShading: true });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.25;
    const dist = 150 + Math.random() * 150;
    const r = 22 + Math.random() * 45;
    const h = 18 + Math.random() * 40;
    const sides = 6 + Math.floor(Math.random() * 3);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r, h, sides), mesaMat);
    base.position.set(Math.cos(a) * dist, h / 2 - 0.1, Math.sin(a) * dist);
    base.rotation.y = Math.random() * Math.PI;
    group.add(base);
    if (Math.random() < 0.7) {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.62, h * 0.4, sides), capMat);
      top.position.set(base.position.x, h + h * 0.2 - 0.2, base.position.z);
      top.rotation.y = base.rotation.y;
      group.add(top);
    }
  }
  return st;
}

/** Space station deck: a lit grid floor that ends in nothing, neon pylons and a ribbon board. */
async function buildVoid(theme: ArenaTheme, group: THREE.Group, pause: Yield, sky: THREE.ShaderMaterial): Promise<SurroundView> {
  const Su = theme.surround;
  const grid = hexTexture(4, 'grid');
  const deckMat = std({ color: Su.ground, roughness: 0.4, metalness: 0.7, emissive: 0x20c0ff, emissiveMap: grid, emissiveIntensity: 0.25 });
  const deck = new THREE.Mesh(new THREE.CircleGeometry(95, 64), deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = -0.03;
  deck.receiveShadow = true;
  // Big UVs so the grid cells are ~5 m.
  const uv = deck.geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 38, uv.getY(i) * 38);
  group.add(deck);
  const structure = new GeoBuilder();
  const all = () => (_y: number) => structure;
  const led = new GeoBuilder();
  const flood = new GeoBuilder();
  bowlBand(all(), -40, -20, 0, -20, 0, 0, 1000);
  bowlBand(all(), 0, -20, 0, 420, 0, 0, 1000);
  bowlBand(() => led, -4, 420, -4, 600, 0, 1, 6000);
  bowlBand(all(), 0, 600, 120, 600, 0, 0, 1000);
  bowlBand(all(), 120, 600, 120, -20, 0, 0, 1000);
  // A ring of neon pylons holding the floodlights.
  bowlBand(() => flood, 900, 2700, 900, 2800, 0, 1, 2000);
  await pause();
  group.add(new THREE.Mesh(structure.build(), std({ color: Su.struct, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide })));
  const ledTex = ledTexture(theme);
  const st = surroundState(theme, ledTex, sky);
  group.add(new THREE.Mesh(led.build(), st.ledMat));
  group.add(new THREE.Mesh(flood.build(), new THREE.MeshBasicMaterial({ color: color(Su.flood), toneMapped: false, side: THREE.DoubleSide })));
  const ring = bowlOutline(900);
  const pylonGeo = new THREE.BoxGeometry(2.6, 28, 2.6);
  const neon = [new THREE.Color(0x20e0ff), new THREE.Color(0xff40c0)];
  for (let i = 0; i < BOWL_N; i += 8) {
    const p = ring[i]!;
    const pylon = new THREE.Mesh(pylonGeo, std({ color: 0x141a2a, roughness: 0.5, metalness: 0.7 }));
    pylon.position.set(p.x * S, 14, -p.y * S);
    pylon.rotation.y = Math.atan2(p.nx, p.ny);
    group.add(pylon);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 26, 0.4), new THREE.MeshBasicMaterial({ color: neon[(i / 8) % 2]!.clone().multiplyScalar(2.5), toneMapped: false }));
    strip.position.set((p.x - p.nx * 140) * S, 14, -(p.y - p.ny * 140) * S);
    group.add(strip);
  }
  return st;
}

async function buildSurround(theme: ArenaTheme, group: THREE.Group, pause: Yield, sky: THREE.ShaderMaterial): Promise<SurroundView> {
  switch (theme.surround.kind) {
    case 'skyline':
      return buildSkyline(theme, group, pause, sky);
    case 'canyon':
      return buildCanyon(theme, group, pause, sky);
    case 'void':
      return buildVoid(theme, group, pause, sky);
    default:
      return buildStadium(theme, group, pause, sky);
  }
}

// ------------------------------------------------------------------ sky

/** Sky dome: gradient, stars, a sun disc, procedural clouds, optional planet and nebula, all from the theme. */
export function buildSky(theme: ArenaTheme): THREE.Mesh {
  const K = theme.sky;
  const v3 = (c: Rgb) => new THREE.Vector3(c[0], c[1], c[2]);
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uTop: { value: v3(K.top) },
      uMid: { value: v3(K.mid) },
      uHor: { value: v3(K.horizon) },
      uStars: { value: K.stars },
      uSunDir: { value: K.sun ? v3(K.sun.dir).normalize() : new THREE.Vector3(0, -1, 0) },
      uSunColor: { value: K.sun ? v3(K.sun.color) : new THREE.Vector3() },
      uSunSize: { value: K.sun?.size ?? 0 },
      uSunHalo: { value: K.sun?.halo ?? 0 },
      uClouds: { value: K.clouds },
      uCloudColor: { value: v3(K.cloudColor) },
      uPlanetDir: { value: K.planet ? v3(K.planet.dir).normalize() : new THREE.Vector3(0, 1, 0) },
      uPlanetR: { value: K.planet?.radius ?? 0 },
      uPlanetColor: { value: K.planet ? v3(K.planet.color) : new THREE.Vector3() },
      uPlanetBand: { value: K.planet ? v3(K.planet.band) : new THREE.Vector3() },
      uPlanetAtmo: { value: K.planet ? v3(K.planet.atmo) : new THREE.Vector3() },
      uNebula: { value: K.nebula },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir;
      uniform float uTime, uStars, uSunSize, uSunHalo, uClouds, uPlanetR, uNebula;
      uniform vec3 uTop, uMid, uHor, uSunDir, uSunColor, uCloudColor, uPlanetDir, uPlanetColor, uPlanetBand, uPlanetAtmo;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash2(i), hash2(i+vec2(1,0)), f.x), mix(hash2(i+vec2(0,1)), hash2(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; } return v; }
      void main(){
        vec3 vDir = normalize(vDir);
        float h = vDir.y;
        vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.25, h));
        c = mix(c, uTop, smoothstep(0.25, 0.9, h));
        // Stars (twinkle a little).
        vec3 g = floor(vDir * 300.0);
        float s = step(1.0 - 0.003 * uStars, hash(g)) * smoothstep(0.05, 0.4, h) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(g + 1.0) * 20.0));
        c += vec3(s) * min(1.0, uStars);
        // Nebula wisps.
        if (uNebula > 0.0) {
          float n1 = fbm(vDir.xy * 2.6 + vDir.z * 1.7);
          float n2 = fbm(vDir.zy * 2.2 + 5.0 + vDir.x);
          c += uNebula * (vec3(0.28, 0.07, 0.36) * smoothstep(0.42, 0.78, n1) + vec3(0.04, 0.22, 0.32) * smoothstep(0.5, 0.85, n2)) * 0.6;
        }
        // Sun: a disc and a wide warm halo.
        float sd = dot(vDir, uSunDir);
        if (uSunSize > 0.0) {
          c += uSunColor * (smoothstep(1.0 - uSunSize * uSunSize * 0.5, 1.0 - uSunSize * uSunSize * 0.2, sd) * 4.0);
          c += uSunColor * uSunHalo * (0.5 * pow(max(sd, 0.0), 60.0) + 0.12 * pow(max(sd, 0.0), 6.0));
        }
        // Clouds on a plane overhead; sun-lit tops, shaded undersides.
        if (uClouds > 0.0 && h > 0.0) {
          vec2 cp = vDir.xz / (h + 0.15) * 1.4 + uTime * 0.006;
          float n = fbm(cp);
          float cov = smoothstep(0.62 - uClouds * 0.3, 0.72 - uClouds * 0.12, n) * smoothstep(0.0, 0.12, h);
          float lit = 0.72 + 0.4 * smoothstep(0.55, 0.95, n) + 0.25 * max(sd, 0.0);
          vec3 cc = uCloudColor * lit;
          c = mix(c, cc, cov * 0.95);
        }
        // Planet: banded gas giant lit from the side, with a glowing atmosphere rim and halo.
        if (uPlanetR > 0.0) {
          float cosA = dot(vDir, uPlanetDir);
          float ang = acos(clamp(cosA, -1.0, 1.0));
          vec3 L = normalize(-uPlanetDir + vec3(0.95, 0.45, 0.35));
          // Halo outside the disc (brighter on the lit side).
          vec3 side = normalize(vDir - uPlanetDir * cosA);
          float litSide = 0.35 + 0.65 * max(0.0, dot(side, L));
          c += uPlanetAtmo * exp(-max(0.0, ang - uPlanetR) * 18.0) * step(uPlanetR, ang) * 0.55 * litSide;
          if (ang < uPlanetR) {
            vec3 off = side * (ang / uPlanetR);
            float nz = sqrt(max(0.0, 1.0 - dot(off, off)));
            vec3 n = normalize(off - uPlanetDir * nz);
            float lit = max(0.0, dot(n, L));
            // Bands follow the planet's tilted latitude.
            float lat = dot(off, normalize(vec3(0.25, 1.0, 0.1)));
            float bands = 0.5 + 0.5 * sin(lat * 15.0 + fbm(off.xy * 4.0 + 3.0) * 3.5);
            vec3 albedo = mix(uPlanetColor, uPlanetBand, bands * 0.75);
            vec3 pc = albedo * (0.04 + lit * 0.85);
            // Atmosphere: a bright rim towards the limb on the day side, faint on the night side.
            float limb = pow(1.0 - nz, 2.5);
            pc += uPlanetAtmo * limb * (0.15 + 0.85 * smoothstep(-0.2, 0.5, dot(n, L)));
            c = mix(c, pc, smoothstep(uPlanetR, uPlanetR * 0.992, ang));
          }
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

/** Build a whole arena for a theme, yielding to the browser between the heavy steps. */
export async function buildArena(theme: ArenaTheme, pause: Yield = idle): Promise<ArenaView> {
  const group = new THREE.Group();
  const sky = buildSky(theme);
  group.add(sky);
  const field = await buildField(theme, group, pause);
  await pause();
  const sur = await buildSurround(theme, group, pause, sky.material as THREE.ShaderMaterial);
  return {
    group,
    theme,
    goalLights: field.goalLights,
    shells: field.shells,
    update: (dt) => sur.update(dt),
    cheer: (team) => sur.cheer(team),
    roar: () => sur.roar(),
  };
}
