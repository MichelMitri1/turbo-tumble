import * as THREE from 'three';
import { ARENA, GOAL_BACK_OUT, GOAL_INNER, GOAL_R, GOAL_RS, OCTAGON_INSET, arenaMainDistance } from '../sim/arena';
import { BOOST_PADS } from '../sim/constants';
import { TEAM_COLORS } from './colors';

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
    g.fillStyle = even ? '#3f8c30' : '#37802b';
    g.fillRect(0, py(y + band), W, py(y) - py(y + band) + 1);
  }
  // Team tints.
  const tint = (y0: number, y1: number, color: string) => {
    const grd = g.createLinearGradient(0, py(y0), 0, py(y1));
    grd.addColorStop(0, color.replace('A', '0.16'));
    grd.addColorStop(1, color.replace('A', '0.02'));
    g.fillStyle = grd;
    g.fillRect(0, Math.min(py(y0), py(y1)), W, Math.abs(py(y1) - py(y0)));
  };
  tint(-HY - 900, 0, 'rgba(40,110,255,A)');
  tint(HY + 900, 0, 'rgba(255,120,30,A)');
  // Lines: crisp paint with a soft edge.
  g.strokeStyle = 'rgba(255,255,255,0.82)';
  g.shadowColor = 'rgba(255,255,255,0.45)';
  g.shadowBlur = 4;
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
  g.shadowBlur = 0;
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

/**
 * Tileable grass: thousands of short blades (grey, multiplied over the turf)
 * plus a normal map derived from the same blades so light catches them.
 */
function grassTextures(): { detail: THREE.Texture; normal: THREE.Texture } {
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
  const detail = new THREE.CanvasTexture(c);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.anisotropy = 8;
  // Normal map from the blade heights (Sobel, wrapped).
  const src = g.getImageData(0, 0, N, N).data;
  const [nc, ng] = canvas(N, N);
  const out = ng.createImageData(N, N);
  const h = (x: number, y: number) => src[(((y + N) % N) * N + ((x + N) % N)) * 4]! / 255;
  const k = 2.2;
  for (let y = 0; y < N; y++)
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
  ng.putImageData(out, 0, 0);
  const normal = new THREE.CanvasTexture(nc);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.anisotropy = 8;
  return { detail, normal };
}

/** Hexagon glow pattern (walls / ceiling): crisp lines with a soft halo and faintly lit cells. */
function hexTexture(line: number, size = 1024): THREE.Texture {
  const [c, g] = canvas(size, size);
  // Opaque black base: emissive maps use RGB, and faint strokes on a transparent
  // canvas would un-premultiply to full white.
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const r = size / 6;
  const w = Math.sqrt(3) * r;
  const cells: Array<[number, number]> = [];
  for (let row = -1; row < size / (1.5 * r) + 1; row++) for (let col = -1; col < size / w + 1; col++) cells.push([col * w + (row % 2 ? w / 2 : 0), row * 1.5 * r]);
  const hexPath = (cx: number, cy: number, rr: number) => {
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * Math.sin(a);
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
  };
  // Faintly lit cells (some brighter), fading to the centre.
  for (const [cx, cy] of cells) {
    const lit = Math.random() < 0.12 ? 0.16 : 0.035 + Math.random() * 0.04;
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, `rgba(255,255,255,${lit * 0.3})`);
    grd.addColorStop(1, `rgba(255,255,255,${lit})`);
    g.fillStyle = grd;
    hexPath(cx, cy, r - line);
    g.fill();
  }
  // Glow, then crisp lines.
  g.strokeStyle = '#fff';
  g.shadowColor = 'rgba(255,255,255,0.9)';
  g.shadowBlur = line * 3;
  g.lineWidth = line;
  for (const [cx, cy] of cells) {
    hexPath(cx, cy, r);
    g.stroke();
  }
  g.shadowBlur = 0;
  g.lineWidth = Math.max(1, line * 0.45);
  for (const [cx, cy] of cells) {
    hexPath(cx, cy, r);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Glass / panel albedo: subtle smudges and fine scratches. */
function glassTexture(): THREE.Texture {
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

/** Crowd texture layout: people per row and rows per tile (the shader animates them per cell). */
const CROWD_COLS = 64;
const CROWD_ROWS = 8;
/** One tile spans this many uu along the stands (≈ 55 uu per seat). */
const CROWD_TILE_U = CROWD_COLS * 55;

/**
 * Seated fans, one row per cell: seat backs, bodies in team colours (or mixed),
 * skin / hair, the odd scarf, raised arms and empty seats.
 */
function crowdTexture(kind: 0 | 1 | 2): THREE.Texture {
  const CW = 32;
  const CH = 64;
  const [c, g] = canvas(CROWD_COLS * CW, CROWD_ROWS * CH);
  const blue = ['#2f62c8', '#3f75e0', '#1d3f99', '#5b8cf0', '#e9eef8'];
  const orange = ['#d8661a', '#f08a2c', '#b44c0c', '#ffb050', '#f4ece0'];
  const neutral = ['#2b2b33', '#7a2230', '#2f6e3a', '#c9b23a', '#5a3d82', '#9aa0aa', '#d8d8d8', '#1e4f6e'];
  const skins = ['#f1c7a0', '#d9a77d', '#b9805a', '#8d5a3b', '#5e3b26'];
  const hairs = ['#1d1510', '#3b2616', '#6b4423', '#b88a4a', '#d9c7a0', '#111'];
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
  const seatCol = kind === 0 ? '#16295e' : kind === 1 ? '#5a2a0e' : '#2a2f45';
  // Concrete tiers behind the seats.
  g.fillStyle = '#0d1020';
  g.fillRect(0, 0, c.width, c.height);
  for (let row = 0; row < CROWD_ROWS; row++) {
    const y0 = row * CH;
    // Step edge.
    g.fillStyle = '#1a1f33';
    g.fillRect(0, y0 + CH - 8, c.width, 8);
    for (let col = 0; col < CROWD_COLS; col++) {
      const x0 = col * CW;
      // Seat back.
      g.fillStyle = seatCol;
      g.fillRect(x0 + 4, y0 + 30, CW - 8, 22);
      if (Math.random() < 0.12) continue; // empty seat
      const teamFan = kind === 2 ? Math.random() < 0.5 : Math.random() < 0.82;
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Goal net: a white diamond mesh on transparency (alpha-tested). */
function netTexture(): THREE.Texture {
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
}

/** Scrolling LED ribbon boards. */
function ledTexture(): THREE.Texture {
  const [c, g] = canvas(2048, 64);
  const panels: Array<[string, string, string]> = [
    ['#0b1a44', '#5aa0ff', 'BOOSTBALL'],
    ['#2a1204', '#ff9a2e', 'SUPERSONIC'],
    ['#05060c', '#ffffff', '» » » » »'],
    ['#0b1a44', '#5aa0ff', 'AERIAL CHAMPIONSHIP'],
    ['#2a1204', '#ff9a2e', 'BOOSTBALL'],
    ['#05060c', '#ffd23f', '★ GOAL OF THE NIGHT ★'],
  ];
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

export interface ArenaView {
  group: THREE.Group;
  /** Goal frames (flash on goal). */
  goalLights: [THREE.Material, THREE.Material];
  /** Animate the crowd / LED boards. */
  update(dt: number): void;
  /** The crowd erupts and the boards flash for a goal. */
  cheer(team: 0 | 1): void;
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

  // Turf: field texture × blade detail, blade normal map, patchy colour and
  // mowing stripes whose shade depends on the viewing direction (like real grass).
  const grass = grassTextures();
  grass.normal.repeat.set((2 * ARENA.halfX) / 130, (2 * HY) / 130);
  const turfMat = new THREE.MeshStandardMaterial({ map: turfTexture(), normalMap: grass.normal, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.88, metalness: 0 });
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
        diffuseColor.rgb *= 0.6 + near * 0.55 + mid * 0.3;
        // Large patches: slightly drier / lusher grass.
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 1.06, 0.82), smoothstep(0.45, 0.62, grassPatch) * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 0.95, 0.9), smoothstep(0.5, 0.35, grassPatch) * 0.5);
        // Mowing stripes: blades lean one way per 5 m band, lighter when they lean away from you.
        float band = mod(floor(wxz.y / 5.12), 2.0) * 2.0 - 1.0;
        vec3 vdir = normalize(vWorldP - cameraPosition);
        diffuseColor.rgb *= 1.0 + band * vdir.z * 0.11;`,
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

  // Glass walls with a glowing hex pattern, tinted per team.
  const hex = hexTexture(4);
  const fade = wallFade();
  const glassMap = glassTexture();
  for (const team of [0, 1] as const) {
    const col = new THREE.Color(TEAM_COLORS[team].glow);
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x121c40).lerp(col, 0.1), map: glassMap, emissive: col, emissiveMap: hex, emissiveIntensity: 0.38, alphaMap: fade, transparent: true, opacity: 1, roughness: 0.08, metalness: 0.3, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(glass[team]!.build(), m);
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  const topMat = new THREE.MeshStandardMaterial({ color: 0x0b1024, emissive: 0x5070ff, emissiveMap: hex, emissiveIntensity: 0.06, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
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

  // --- Goals (built for the orange end, mirrored for blue): see-through net, metal
  // frame, team-lit trim in the wall, and a dark enclosed goal box behind the net.
  const goalLights: THREE.Material[] = [];
  const netTex = netTexture();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x07080f, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xeef2fa, roughness: 0.22, metalness: 0.75, envMapIntensity: 1.3 });
  for (const team of [0, 1] as const) {
    const col = new THREE.Color(TEAM_COLORS[team].glow);
    const goal = new THREE.Group();
    // Local frame = orange goal: inside the arena is +z (three), the goal box is towards −z.
    if (team === 0) goal.rotation.y = Math.PI;
    // Net (the drivable surface) and the dark shell behind it, from the goal sweep.
    const netMat = new THREE.MeshStandardMaterial({ color: 0xe6ecff, map: netTex, alphaTest: 0.22, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.7, emissive: col.clone().lerp(new THREE.Color(1, 1, 1), 0.35), emissiveMap: netTex, emissiveIntensity: 0.38 });
    group.add(new THREE.Mesh(netB[team]!.build(), netMat));
    const shellTeamMat = shellMat.clone();
    shellTeamMat.emissive = col.clone().multiplyScalar(0.05);
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
          if (prev >= 0) plates.tri(corner, prev, id);
          prev = id;
        }
      }
    group.add(new THREE.Mesh(plates.build(), new THREE.MeshStandardMaterial({ color: 0x1a2038, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide })));
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
    const T = 34;
    const trims: Array<[number, number, number, number]> = [
      [-(GX + P + T / 2), (GH + P) / 2, T, GH + P],
      [GX + P + T / 2, (GH + P) / 2, T, GH + P],
      [0, GH + P + T / 2, 2 * (GX + P + T), T],
    ];
    for (const [x, y, w, h] of trims) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w * S, h * S), trimMat);
      m.position.set(x * S, y * S, -(HY - 3) * S);
      goal.add(m);
    }
    // Light inside the goal.
    const gl = new THREE.PointLight(col, 2.2, 12, 1.8);
    gl.position.set(0, 4.2, -(HY + 420) * S);
    goal.add(gl);
    group.add(goal);
  }

  // --- Stadium bowl: concourse, facades with LED ribbons, two tiers of fans, roof canopy.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.MeshStandardMaterial({ color: 0x15182a, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  group.add(ground);
  const all = () => (_y: number) => structure;
  const structure = new GeoBuilder();
  const crowdB = [new GeoBuilder(), new GeoBuilder(), new GeoBuilder()];
  // Blue fans behind the blue goal, orange behind orange, mixed along the sides.
  const sectionOf = (y: number) => (y < -2600 ? 0 : y > 2600 ? 1 : 2);
  const baseRing = bowlOutline(0);
  const crowdSel = (y: number, i: number) => {
    // Stair aisles every few segments and wherever the section changes.
    const prev = baseRing[i]!;
    if (i % 14 === 0 || sectionOf(prev.y) !== sectionOf(y)) return aisles;
    return crowdB[sectionOf(y)]!;
  };
  const aisles = new GeoBuilder();
  const led = new GeoBuilder();
  // Lower bowl: facade (0 → 700), 26 rows rising to z ≈ 2130.
  const ROW_RUN = 90;
  const ROW_RISE_LO = 55;
  const ROW_RISE_HI = 78;
  const lowRows = 26;
  const highRows = 30;
  bowlBand(all(), -40, -20, 0, -20, 0, 0, 1000);
  bowlBand(all(), 0, -20, 0, 520, 0, 0, 1000);
  bowlBand(() => led, -4, 520, -4, 700, 0, 1, 6000);
  bowlBand(all(), 0, 700, 60, 700, 0, 0, 1000);
  const loEndD = 60 + lowRows * ROW_RUN;
  const loEndZ = 700 + lowRows * ROW_RISE_LO;
  bowlBand(crowdSel, 60, 700, loEndD, loEndZ, 0, lowRows / CROWD_ROWS, CROWD_TILE_U);
  // Walkway + upper facade with its own LED ribbon.
  const upD = loEndD + 260;
  bowlBand(all(), loEndD, loEndZ, upD, loEndZ, 0, 0, 1000);
  bowlBand(all(), upD, loEndZ, upD, loEndZ + 300, 0, 0, 1000);
  bowlBand(() => led, upD - 4, loEndZ + 300, upD - 4, loEndZ + 480, 0, 1, 6000);
  const upZ = loEndZ + 480;
  const hiEndD = upD + highRows * ROW_RUN;
  const hiEndZ = upZ + highRows * ROW_RISE_HI;
  bowlBand(crowdSel, upD, upZ, hiEndD, hiEndZ, 0, highRows / CROWD_ROWS, CROWD_TILE_U);
  // Back wall and the roof canopy (dark underside, floodlight ring on the inner lip).
  const roofZ = hiEndZ + 900;
  bowlBand(all(), hiEndD, hiEndZ, hiEndD, roofZ, 0, 0, 1000);
  const canopyIn = hiEndD - 2100;
  bowlBand(all(), hiEndD, roofZ, canopyIn, roofZ - 120, 0, 0, 1000);
  const flood = new GeoBuilder();
  bowlBand(() => flood, canopyIn, roofZ - 120, canopyIn, roofZ - 300, 0, 1, 2000);
  bowlBand(all(), canopyIn, roofZ - 300, canopyIn + 60, roofZ - 330, 0, 0, 1000);

  const structMat = new THREE.MeshStandardMaterial({ color: 0x1a1f36, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
  const aisleMesh = new THREE.Mesh(aisles.build(), new THREE.MeshStandardMaterial({ color: 0x272b3d, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }));
  aisleMesh.receiveShadow = true;
  group.add(aisleMesh);
  const structMesh = new THREE.Mesh(structure.build(), structMat);
  structMesh.receiveShadow = true;
  group.add(structMesh);

  // Crowd: bobbing fans (they jump when a goal goes in) and camera flashes.
  const crowdUniforms = { uTime: { value: 0 }, uCheer: { value: 0 } };
  for (let k = 0; k < 3; k++) {
    const map = crowdTexture(k as 0 | 1 | 2);
    const m = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, crowdUniforms);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uCheer;\nvec3 crowdGlow;\nfloat crowdFlash;')
        .replace(
          '#include <map_fragment>',
          `vec2 cuv = vMapUv;
          vec2 cell = floor(cuv * vec2(${CROWD_COLS.toFixed(1)}, ${CROWD_ROWS.toFixed(1)}));
          float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float bob = max(0.0, sin(uTime * (4.0 + h * 5.0) + h * 40.0)) * (0.012 + uCheer * 0.075 * step(0.25, h));
          vec4 sampledDiffuseColor = texture2D(map, vec2(cuv.x, cuv.y - bob));
          diffuseColor *= sampledDiffuseColor;
          crowdGlow = sampledDiffuseColor.rgb;
          crowdFlash = step(0.9992, fract(sin(dot(cell + floor(uTime * 5.0) * vec2(1.7, 3.1), vec2(7.13, 3.71))) * 9341.7)) * (0.35 + uCheer * 2.0);`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += crowdGlow * 0.32 + vec3(crowdFlash * 5.0);');
    };
    group.add(new THREE.Mesh(crowdB[k]!.build(), m));
  }

  // LED ribbons + floodlights.
  const ledTex = ledTexture();
  const ledMat = new THREE.MeshBasicMaterial({ map: ledTex, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5), side: THREE.DoubleSide });
  group.add(new THREE.Mesh(led.build(), ledMat));
  const floodMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.98, 0.9).multiplyScalar(2.1), toneMapped: false, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(flood.build(), floodMat));

  let cheer = 0;
  let ledFlash = 0;
  let ledTeam: 0 | 1 = 0;
  const ledBase = new THREE.Color(1.5, 1.5, 1.5);
  return {
    group,
    goalLights: goalLights as [THREE.Material, THREE.Material],
    update(dt: number) {
      crowdUniforms.uTime.value += dt;
      cheer = Math.max(0, cheer - dt * 0.18);
      crowdUniforms.uCheer.value = Math.min(1, cheer);
      ledTex.offset.x = (ledTex.offset.x - dt * 0.02) % 1;
      // After a goal the ribbons pulse in the scoring team's colour.
      ledFlash = Math.max(0, ledFlash - dt * 0.25);
      if (ledFlash > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
        ledMat.color.copy(ledBase).lerp(new THREE.Color(TEAM_COLORS[ledTeam].glow).multiplyScalar(3), Math.min(1, ledFlash * 2) * pulse);
      } else ledMat.color.copy(ledBase);
    },
    cheer(team: 0 | 1) {
      cheer = 1.6;
      ledFlash = 1.6;
      ledTeam = team;
    },
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
