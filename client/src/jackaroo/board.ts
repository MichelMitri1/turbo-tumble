import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { backSvg, buildDeck, cardImage, type Card } from './cards';
import { HOME, owner, PER, quadOf, SAFE0, TRACK } from './engine';

// ============================================================================ palette

export interface SeatColor {
  name: string;
  hex: string;
  light: string;
  dark: string;
}
const BLUE: SeatColor = { name: 'Blue', hex: '#2f6dff', light: '#8fb4ff', dark: '#163a8c' };
const RED: SeatColor = { name: 'Red', hex: '#e8323c', light: '#ff9a9f', dark: '#7d1218' };
const GREEN: SeatColor = { name: 'Green', hex: '#17b679', light: '#7ff0c4', dark: '#0b5c3c' };
const GOLD: SeatColor = { name: 'Gold', hex: '#ffb01f', light: '#ffe08a', dark: '#8a5a00' };

/** Partners share a team temperature: Blue + Green (cool) vs Red + Gold (warm). */
export function playerColor(n: number, p: number): SeatColor {
  return n === 4 ? [BLUE, RED, GREEN, GOLD][p]! : [BLUE, RED][p]!;
}
export const TEAM_NAMES = ['Team Sea', 'Team Sun'];

// ============================================================================ layout

/** Board units: holes ~1 apart. h = half-width of an arm, A = arm length (track centre lines). */
const H = 2.2;
const R_OUT = 1.1;
const R_IN = 0.7;
const A = (19 + (2 - Math.PI / 2) * (2 * R_OUT + R_IN)) / 2;
/** Half size of the square board. */
export const B = A + 1.55;
const HOLE_R = 0.4;
const MARBLE_R = 0.41;
const REST_Y = MARBLE_R - 0.12;
const TOP_Y = 0;

type V2 = { x: number; z: number };
/** Quadrant rotation: bottom → left → top → right (clockwise on screen). */
const rot = (p: V2, q: number): V2 => {
  let { x, z } = p;
  for (let i = 0; i < ((q % 4) + 4) % 4; i++) [x, z] = [-z, x];
  return { x, z };
};

/** Dense polyline of the plus-shaped track centre line, starting at the bottom arm's middle, clockwise. */
function outline(): V2[] {
  const corners: Array<[number, number, number]> = [
    [-H, A, R_OUT],
    [-H, H, R_IN],
    [-A, H, R_OUT],
    [-A, -H, R_OUT],
    [-H, -H, R_IN],
    [-H, -A, R_OUT],
    [H, -A, R_OUT],
    [H, -H, R_IN],
    [A, -H, R_OUT],
    [A, H, R_OUT],
    [H, H, R_IN],
    [H, A, R_OUT],
  ];
  const pts: V2[] = [{ x: 0, z: A }];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const [cx, cz, r] = corners[i]!;
    const prev = i === 0 ? { x: 0, z: A } : { x: corners[i - 1]![0], z: corners[i - 1]![1] };
    const next = { x: corners[(i + 1) % n]![0], z: corners[(i + 1) % n]![1] };
    const d1 = norm({ x: cx - prev.x, z: cz - prev.z });
    const d2 = norm({ x: next.x - cx, z: next.z - cz });
    const p1 = { x: cx - d1.x * r, z: cz - d1.z * r };
    const p2 = { x: cx + d2.x * r, z: cz + d2.z * r };
    // Quadratic-ish fillet through the corner (good enough at this sampling).
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const a = { x: p1.x + (cx - p1.x) * t, z: p1.z + (cz - p1.z) * t };
      const b = { x: cx + (p2.x - cx) * t, z: cz + (p2.z - cz) * t };
      pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  pts.push({ x: 0, z: A });
  return pts;
}
function norm(v: V2): V2 {
  const l = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / l, z: v.z / l };
}

interface Layout {
  line: V2[];
  track: V2[];
  /** [quadrant][slot] */
  safe: V2[][];
  home: V2[][];
  homeCenter: V2[];
}

function buildLayout(): Layout {
  const line = outline();
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1]! + Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.z - line[i - 1]!.z));
  const total = cum[cum.length - 1]!;
  const track: V2[] = [];
  let j = 0;
  for (let i = 0; i < TRACK; i++) {
    const s = (i * total) / TRACK;
    while (j < cum.length - 2 && cum[j + 1]! < s) j++;
    const t = (s - cum[j]!) / Math.max(1e-6, cum[j + 1]! - cum[j]!);
    track.push({ x: line[j]!.x + (line[j + 1]!.x - line[j]!.x) * t, z: line[j]!.z + (line[j + 1]!.z - line[j]!.z) * t });
  }
  const safe: V2[][] = [];
  const home: V2[][] = [];
  const homeCenter: V2[] = [];
  for (let q = 0; q < 4; q++) {
    safe.push([0, 1, 2, 3].map((k) => rot({ x: 0, z: A - 1.02 * (k + 1) }, q)));
    const c = { x: -(H + A) / 2 - 0.15, z: (H + A) / 2 + 0.15 };
    homeCenter.push(rot(c, q));
    home.push([[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]].map(([dx, dz]) => rot({ x: c.x + dx!, z: c.z + dz! }, q)));
  }
  return { line, track, safe, home, homeCenter };
}
export const LAYOUT = buildLayout();

// ============================================================================ textures

/** Value noise for the wood grain. */
function makeNoise(seed: number): (x: number, y: number) => number {
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rnd();
  }
  for (let i = 255; i > 0; i--) {
    const k = Math.floor(rnd() * (i + 1));
    [perm[i], perm[k]] = [perm[k]!, perm[i]!];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i]!;
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const X = xi & 255;
    const Y = yi & 255;
    const a = vals[perm[X + perm[Y]!]!]!;
    const b = vals[perm[X + 1 + perm[Y]!]!]!;
    const c = vals[perm[X + perm[Y + 1]!]!]!;
    const d = vals[perm[X + 1 + perm[Y + 1]!]!]!;
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Walnut / rosewood grain running along x (rgb into data). */
function woodPixels(size: number, tone: [number, number, number], tone2: [number, number, number], seed: number, ringFreq = 0.05): Uint8ClampedArray<ArrayBuffer> {
  const n1 = makeNoise(seed);
  const n2 = makeNoise(seed + 7);
  const data = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  const k = 2048 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const X = x * k;
      const Y = y * k;
      const warp = n1(X * 0.0018, Y * 0.01) * 2 + n1(X * 0.007, Y * 0.035) * 0.5;
      const ring = Y * ringFreq + warp * 4.5;
      const f = ring - Math.floor(ring);
      const band = Math.pow(Math.abs(Math.sin(f * Math.PI)), 3);
      const fiber = n2(X * 0.02, Y * 0.6) * 0.6 + n2(X * 0.08, Y * 1.7) * 0.4;
      const t = Math.min(1, Math.max(0, 0.15 + band * 0.45 + fiber * 0.32 + (warp - 1.3) * 0.08));
      const i = (y * size + x) * 4;
      data[i] = tone[0] + (tone2[0] - tone[0]) * t;
      data[i + 1] = tone[1] + (tone2[1] - tone[1]) * t;
      data[i + 2] = tone[2] + (tone2[2] - tone[2]) * t;
      data[i + 3] = 255;
    }
  }
  return data;
}

function starPath(ctx: CanvasRenderingContext2D, cx: number, cz: number, r: number, inner = 0.72, points = 8, rot0 = -Math.PI / 2): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot0 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    if (i) ctx.lineTo(x, z);
    else ctx.moveTo(x, z);
  }
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, z: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, z);
  ctx.arcTo(x + w, z, x + w, z + h, r);
  ctx.arcTo(x + w, z + h, x, z + h, r);
  ctx.arcTo(x, z + h, x, z, r);
  ctx.arcTo(x, z, x + w, z, r);
  ctx.closePath();
}

const BAKE = 2048;
const PX = BAKE / (2 * B);
let woodCache: ImageData | null = null;

/** Paint the board top: wood, ebony track inlay with brass pinstripes, coloured lanes, homes, start squares, holes. */
function bakeTop(colors: Array<SeatColor | null>): { map: HTMLCanvasElement; normal: HTMLCanvasElement } {
  const map = document.createElement('canvas');
  map.width = map.height = BAKE;
  const ctx = map.getContext('2d')!;
  if (!woodCache) {
    woodCache = new ImageData(woodPixels(BAKE, [58, 28, 13], [138, 78, 38], 11, 0.035), BAKE, BAKE);
  }
  ctx.putImageData(woodCache, 0, 0);
  ctx.setTransform(PX, 0, 0, PX, B * PX, B * PX);
  const L = LAYOUT;
  // Soft vignette towards the rim (lacquer pooling).
  const vg = ctx.createRadialGradient(0, 0, B * 0.4, 0, 0, B * 1.45);
  vg.addColorStop(0, 'rgba(255,220,170,0.06)');
  vg.addColorStop(1, 'rgba(20,8,2,0.38)');
  ctx.fillStyle = vg;
  ctx.fillRect(-B, -B, 2 * B, 2 * B);
  // Inner border line (marquetry).
  ctx.strokeStyle = 'rgba(230,180,90,0.55)';
  ctx.lineWidth = 0.06;
  roundRect(ctx, -B + 0.45, -B + 0.45, 2 * B - 0.9, 2 * B - 0.9, 1.2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(30,14,4,0.55)';
  ctx.lineWidth = 0.14;
  roundRect(ctx, -B + 0.62, -B + 0.62, 2 * B - 1.24, 2 * B - 1.24, 1.05);
  ctx.stroke();

  const tracePath = () => {
    ctx.beginPath();
    L.line.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Track: brass edge, ebony band, fine inner line.
  tracePath();
  ctx.strokeStyle = '#d9a648';
  ctx.lineWidth = 1.42;
  ctx.stroke();
  tracePath();
  ctx.strokeStyle = '#1d120c';
  ctx.lineWidth = 1.26;
  ctx.stroke();
  tracePath();
  ctx.strokeStyle = 'rgba(255,220,160,0.08)';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  for (let q = 0; q < 4; q++) {
    const col = colors[q];
    const gate = L.track[q * PER]!;
    const start = L.track[q * PER + 1]!;
    const safe = L.safe[q]!;
    const end = safe[3]!;
    if (col) {
      // Safe lane.
      ctx.strokeStyle = '#d9a648';
      ctx.lineWidth = 1.16;
      ctx.beginPath();
      ctx.moveTo(gate.x, gate.z);
      ctx.lineTo(end.x, end.z);
      ctx.stroke();
      const lg = ctx.createLinearGradient(gate.x, gate.z, end.x, end.z);
      lg.addColorStop(0, col.dark);
      lg.addColorStop(1, col.hex);
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.0;
      ctx.stroke();
      // Arrow from the gate into the lane.
      const mid = { x: (gate.x + safe[0]!.x) / 2, z: (gate.z + safe[0]!.z) / 2 };
      const dir = norm({ x: safe[0]!.x - gate.x, z: safe[0]!.z - gate.z });
      ctx.fillStyle = 'rgba(255,240,200,0.75)';
      ctx.beginPath();
      ctx.moveTo(mid.x + dir.x * 0.16, mid.z + dir.z * 0.16);
      ctx.lineTo(mid.x - dir.x * 0.1 - dir.z * 0.16, mid.z - dir.z * 0.1 + dir.x * 0.16);
      ctx.lineTo(mid.x - dir.x * 0.1 + dir.z * 0.16, mid.z - dir.z * 0.1 - dir.x * 0.16);
      ctx.fill();
      // Start square: coloured disc with a brass ring.
      ctx.fillStyle = '#d9a648';
      ctx.beginPath();
      ctx.arc(start.x, start.z, 0.68, 0, Math.PI * 2);
      ctx.fill();
      const sg = ctx.createRadialGradient(start.x - 0.15, start.z - 0.15, 0.05, start.x, start.z, 0.62);
      sg.addColorStop(0, col.light);
      sg.addColorStop(1, col.hex);
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(start.x, start.z, 0.6, 0, Math.PI * 2);
      ctx.fill();
      // Gate disc (darker).
      ctx.fillStyle = col.dark;
      ctx.beginPath();
      ctx.arc(gate.x, gate.z, 0.52, 0, Math.PI * 2);
      ctx.fill();
    }
    // Home pocket: framed inlay with an eight-pointed star.
    const hc = L.homeCenter[q]!;
    ctx.save();
    ctx.translate(hc.x, hc.z);
    starPath(ctx, 0, 0, 2.15, 0.78, 8, -Math.PI / 2 + Math.PI / 8);
    ctx.fillStyle = 'rgba(30,14,4,0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(230,180,90,0.7)';
    ctx.lineWidth = 0.06;
    ctx.stroke();
    roundRect(ctx, -1.18, -1.18, 2.36, 2.36, 0.45);
    ctx.fillStyle = '#d9a648';
    ctx.fill();
    roundRect(ctx, -1.08, -1.08, 2.16, 2.16, 0.38);
    const hg = ctx.createRadialGradient(-0.3, -0.3, 0.1, 0, 0, 1.6);
    hg.addColorStop(0, col ? col.hex : '#5a3a22');
    hg.addColorStop(1, col ? col.dark : '#2a1a0e');
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.restore();
  }
  // Centre medallion under the discard pile.
  ctx.save();
  starPath(ctx, 0, 0, 1.95, 0.76, 8, -Math.PI / 2 + Math.PI / 8);
  ctx.fillStyle = '#d9a648';
  ctx.fill();
  starPath(ctx, 0, 0, 1.8, 0.76, 8, -Math.PI / 2 + Math.PI / 8);
  const mg = ctx.createRadialGradient(-0.4, -0.4, 0.1, 0, 0, 2);
  mg.addColorStop(0, '#2a5a5e');
  mg.addColorStop(1, '#0b2a30');
  ctx.fillStyle = mg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(240,200,110,0.6)';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.arc(0, 0, 1.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Holes: deep shadow + a lit lower rim.
  const hole = (p: V2, tint: string | null) => {
    const g = ctx.createRadialGradient(p.x - 0.06, p.z - 0.08, 0.02, p.x, p.z, HOLE_R);
    g.addColorStop(0, '#050302');
    g.addColorStop(0.7, tint ?? '#140b06');
    g.addColorStop(1, '#2a1a10');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.z, HOLE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,225,170,0.28)';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.arc(p.x, p.z, HOLE_R + 0.015, Math.PI * 0.05, Math.PI * 0.95);
    ctx.stroke();
  };
  L.track.forEach((p) => hole(p, null));
  for (let q = 0; q < 4; q++) {
    for (const p of L.home[q]!) hole(p, colors[q] ? shade(colors[q]!.dark, 0.5) : null);
    if (colors[q]) for (const p of L.safe[q]!) hole(p, shade(colors[q]!.dark, 0.6));
  }

  // Normal map: flat, with a spherical dimple per hole.
  const normal = document.createElement('canvas');
  normal.width = normal.height = BAKE;
  const nctx = normal.getContext('2d')!;
  nctx.fillStyle = 'rgb(128,128,255)';
  nctx.fillRect(0, 0, BAKE, BAKE);
  const sprite = dimpleSprite(Math.round(HOLE_R * 1.12 * PX));
  const drawDimple = (p: V2) => nctx.drawImage(sprite, (p.x + B) * PX - sprite.width / 2, (p.z + B) * PX - sprite.height / 2);
  L.track.forEach(drawDimple);
  for (let q = 0; q < 4; q++) {
    L.home[q]!.forEach(drawDimple);
    if (colors[q]) L.safe[q]!.forEach(drawDimple);
  }
  return { map, normal };
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return `#${c.getHexString()}`;
}

/** Normal-map sprite of a spherical dimple (with a raised lip). */
function dimpleSprite(r: number): HTMLCanvasElement {
  const size = r * 2 + 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - size / 2) / r;
      const dy = (y + 0.5 - size / 2) / r;
      const d = Math.hypot(dx, dy);
      const i = (y * size + x) * 4;
      let nx = 0;
      let ny = 0;
      if (d < 0.9) {
        // Inside the bowl the surface slopes down towards the centre.
        const s = d / 0.9;
        nx = (dx / (d || 1)) * s * 0.85;
        ny = (dy / (d || 1)) * s * 0.85;
      } else if (d < 1) {
        // Rounded lip.
        const s = (1 - d) / 0.1;
        nx = -(dx / d) * s * 0.6;
        ny = -(dy / d) * s * 0.6;
      }
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = d < 1 ? 255 : 0;
    }
  g.putImageData(img, 0, 0);
  return c;
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Glossy marble skin: the colour with a lighter swirl band (it shows the marble rolling). */
function marbleTexture(col: SeatColor): THREE.CanvasTexture {
  return canvasTex(256, 128, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, col.dark);
    g.addColorStop(0.5, col.hex);
    g.addColorStop(1, col.dark);
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 128);
    c.globalAlpha = 0.55;
    c.strokeStyle = col.light;
    c.lineWidth = 9;
    c.beginPath();
    for (let x = 0; x <= 256; x += 4) {
      const y = 64 + Math.sin((x / 256) * Math.PI * 4) * 26;
      if (x) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.stroke();
    c.globalAlpha = 0.35;
    c.strokeStyle = '#ffffff';
    c.lineWidth = 3;
    c.stroke();
  });
}

// ============================================================================ animation

interface Anim {
  t: number;
  dur: number;
  delay: number;
  step: (k: number) => void;
  done?: () => void;
}
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;

interface MarbleObj {
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  /** Game position currently shown. */
  pos: number;
  busy: number;
  lift: number;
  liftTarget: number;
  base: THREE.Vector3;
}

export interface Ring {
  /** Board-local spot. */
  x: number;
  z: number;
  /** Optional label (7 split steps). */
  label?: string;
  color?: string;
  /** Identifier handed back by pick(). */
  id: number;
}

export interface Reserve {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The 3D Jackaroo table: wooden board, marbles, card piles. Owns the renderer;
 * one instance lives for the whole page (reset() between games disposes the
 * per-game objects so rematches never leak).
 */
export class BoardView {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  /** Rotates so my quadrant faces the camera; holds everything that belongs to a quadrant. */
  private readonly boardGroup = new THREE.Group();
  private readonly fixed = new THREE.Group();
  private readonly shared: Array<{ dispose(): void }> = [];
  private readonly cardTex = new Map<number, THREE.Texture>();
  private readonly cardMat = new Map<number, THREE.Material>();
  private backTex: THREE.Texture | null = null;
  private topMat: THREE.MeshPhysicalMaterial;
  private topMaps: { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } | null = null;
  private bakedKey = '';
  private marbles: MarbleObj[] = [];
  private marbleMats: THREE.Material[] = [];
  private marbleGeo: THREE.SphereGeometry;
  private hitGeo: THREE.SphereGeometry;
  private shadowMat: THREE.MeshBasicMaterial;
  private ringGeo: THREE.RingGeometry;
  private ringHitGeo: THREE.CircleGeometry;
  private discGeo: THREE.CircleGeometry;
  private rings: THREE.Object3D[] = [];
  private labelTex = new Map<string, THREE.CanvasTexture>();
  private cardGeo: THREE.PlaneGeometry;
  private pile: THREE.Mesh[] = [];
  private firePile: THREE.Mesh[] = [];
  private deck: THREE.Mesh;
  private flames: Array<{ s: THREE.Sprite; v: THREE.Vector3; life: number; max: number }> = [];
  private flameMat: THREE.SpriteMaterial;
  private sparkMat: THREE.SpriteMaterial;
  private glow: THREE.Mesh;
  private anims: Anim[] = [];
  private n: 2 | 4 = 4;
  private seatRot = 0;
  private time = 0;
  private size = { w: 1, h: 1 };
  private reserve: Reserve = { top: 60, bottom: 160, left: 0, right: 0 };
  private fit = { dist: 40, offX: 0, offY: 0 };
  private readonly ray = new THREE.Raycaster();
  private readonly onResize = () => this.resize();
  private disposed = false;
  /** A marble landed on a hole (index in the path, path length) — for the click sounds. */
  onHop: ((i: number, n: number) => void) | null = null;
  /** Orbit slowly (menu backdrop). */
  showcase = true;

  /** Board-local positions of the deck stack and the fire bowl (world-fixed, beside the centre). */
  static readonly DECK_AT = new THREE.Vector3(-3.95, 0, 0);
  static readonly FIRE_AT = new THREE.Vector3(3.95, 0, 0);

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'jk-canvas';
    container.appendChild(this.canvas);

    const pm = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const env = pm.fromScene(room, 0.04).texture;
    room.dispose();
    pm.dispose();
    this.shared.push(env);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color('#0d1416');
    this.scene.fog = new THREE.Fog('#0d1416', 60, 120);
    this.scene.add(this.boardGroup, this.fixed);

    this.buildLights();
    this.buildTable();
    this.topMat = this.buildBoard();
    this.marbleGeo = this.keep(new THREE.SphereGeometry(MARBLE_R, 40, 28));
    this.hitGeo = this.keep(new THREE.SphereGeometry(0.62, 8, 6));
    this.shadowMat = this.keep(
      new THREE.MeshBasicMaterial({
        map: this.keep(
          canvasTex(64, 64, (c) => {
            const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
            g.addColorStop(0, 'rgba(0,0,0,0.75)');
            g.addColorStop(0.5, 'rgba(0,0,0,0.35)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = g;
            c.fillRect(0, 0, 64, 64);
          }),
        ),
        transparent: true,
        depthWrite: false,
      }),
    );
    this.ringGeo = this.keep(new THREE.RingGeometry(0.47, 0.72, 48));
    this.discGeo = this.keep(new THREE.CircleGeometry(0.47, 32));
    this.ringHitGeo = this.keep(new THREE.CircleGeometry(0.62, 16));
    this.cardGeo = this.keep(new THREE.PlaneGeometry(2.25, 2.25 * (349 / 240)));
    const flameTex = this.keep(
      canvasTex(64, 64, (c) => {
        const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,250,210,1)');
        g.addColorStop(0.35, 'rgba(255,170,40,0.85)');
        g.addColorStop(0.7, 'rgba(220,60,10,0.35)');
        g.addColorStop(1, 'rgba(120,10,0,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, 64, 64);
      }),
    );
    this.flameMat = this.keep(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.sparkMat = this.keep(new THREE.SpriteMaterial({ map: flameTex, color: '#ffffff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    // Deck stack (left of the centre) and fire bowl (right).
    const deckSide = this.keep(new THREE.MeshStandardMaterial({ color: '#efe4c8', roughness: 0.7 }));
    this.deck = new THREE.Mesh(this.keep(new THREE.BoxGeometry(1.9 * (349 / 240), 1, 1.9)), [deckSide, deckSide, deckSide, deckSide, deckSide, deckSide]);
    this.deck.position.copy(BoardView.DECK_AT);
    this.deck.castShadow = true;
    this.deck.receiveShadow = true;
    this.fixed.add(this.deck);
    this.buildFireBowl();
    // Turn glow (moves to the current player's home pocket).
    this.glow = new THREE.Mesh(
      this.keep(new THREE.CircleGeometry(3.2, 48)),
      this.keep(
        new THREE.MeshBasicMaterial({
          map: this.keep(
            canvasTex(128, 128, (c) => {
              const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
              g.addColorStop(0, 'rgba(255,255,255,0.55)');
              g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
              g.addColorStop(1, 'rgba(255,255,255,0)');
              c.fillStyle = g;
              c.fillRect(0, 0, 128, 128);
            }),
          ),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = TOP_Y + 0.012;
    this.glow.visible = false;
    this.boardGroup.add(this.glow);
    this.resize();
    addEventListener('resize', this.onResize);
  }

  private keep<T extends { dispose(): void }>(r: T): T {
    this.shared.push(r);
    return r;
  }

  // ---------------------------------------------------------------- build

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight('#ffe9cc', '#1a1410', 0.9));
    const key = new THREE.DirectionalLight('#fff1dc', 2.4);
    key.position.set(-9, 26, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -16;
    sc.right = sc.top = 16;
    sc.near = 5;
    sc.far = 60;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#9fd6ff', 0.5);
    rim.position.set(12, 10, -14);
    this.scene.add(rim);
  }

  private buildTable(): void {
    const felt = this.keep(
      canvasTex(512, 512, (c) => {
        const img = c.createImageData(512, 512);
        const nz = makeNoise(5);
        for (let y = 0; y < 512; y++)
          for (let x = 0; x < 512; x++) {
            const v = nz(x * 0.08, y * 0.08) * 0.5 + nz(x * 0.4, y * 0.4) * 0.5;
            const i = (y * 512 + x) * 4;
            img.data[i] = 14 + v * 14;
            img.data[i + 1] = 38 + v * 20;
            img.data[i + 2] = 40 + v * 20;
            img.data[i + 3] = 255;
          }
        c.putImageData(img, 0, 0);
      }),
    );
    felt.wrapS = felt.wrapT = THREE.RepeatWrapping;
    felt.repeat.set(10, 10);
    const table = new THREE.Mesh(this.keep(new THREE.CircleGeometry(80, 64)), this.keep(new THREE.MeshStandardMaterial({ map: felt, roughness: 0.95, color: '#9fb5b0' })));
    table.rotation.x = -Math.PI / 2;
    table.position.y = -1.0;
    table.receiveShadow = true;
    this.scene.add(table);
    // A pool of warm light on the felt around the board.
    const pool = new THREE.Mesh(
      this.keep(new THREE.CircleGeometry(30, 64)),
      this.keep(
        new THREE.MeshBasicMaterial({
          map: this.keep(
            canvasTex(256, 256, (c) => {
              const g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
              g.addColorStop(0, 'rgba(255,200,140,0.16)');
              g.addColorStop(1, 'rgba(255,200,140,0)');
              c.fillStyle = g;
              c.fillRect(0, 0, 256, 256);
            }),
          ),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = -0.99;
    this.scene.add(pool);
  }

  private buildBoard(): THREE.MeshPhysicalMaterial {
    const shape = new THREE.Shape();
    const r = 1.6;
    const s = B;
    shape.moveTo(-s + r, -s);
    shape.lineTo(s - r, -s);
    shape.quadraticCurveTo(s, -s, s, -s + r);
    shape.lineTo(s, s - r);
    shape.quadraticCurveTo(s, s, s - r, s);
    shape.lineTo(-s + r, s);
    shape.quadraticCurveTo(-s, s, -s, s - r);
    shape.lineTo(-s, -s + r);
    shape.quadraticCurveTo(-s, -s, -s + r, -s);
    const bevel = 0.28;
    const body = this.keep(new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 5, curveSegments: 24 }));
    const sideTex = this.keep(
      (() => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 512;
        const c = cv.getContext('2d')!;
        c.putImageData(new ImageData(woodPixels(512, [70, 34, 16], [128, 72, 36], 3, 0.12), 512, 512), 0, 0);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(0.08, 0.08);
        return t;
      })(),
    );
    const sideMat = this.keep(new THREE.MeshPhysicalMaterial({ map: sideTex, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.25 }));
    const mesh = new THREE.Mesh(body, sideMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = TOP_Y - 0.7 - bevel;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.boardGroup.add(mesh);
    // The painted top (baked per game: colours depend on the seats).
    const top = this.keep(new THREE.ShapeGeometry(shape, 24));
    const mat = this.keep(new THREE.MeshPhysicalMaterial({ roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.18, normalScale: new THREE.Vector2(1.4, 1.4) }));
    const topMesh = new THREE.Mesh(top, mat);
    topMesh.rotation.x = -Math.PI / 2;
    topMesh.position.y = TOP_Y + 0.001;
    topMesh.receiveShadow = true;
    this.boardGroup.add(topMesh);
    return mat;
  }

  private buildFireBowl(): void {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector2(0.15 + Math.sin(t * Math.PI * 0.5) * 1.15, t * 0.42));
    }
    pts.push(new THREE.Vector2(1.38, 0.44), new THREE.Vector2(1.38, 0.5), new THREE.Vector2(1.24, 0.48));
    const geo = this.keep(new THREE.LatheGeometry(pts, 48));
    const brass = this.keep(new THREE.MeshStandardMaterial({ color: '#c8923a', metalness: 0.9, roughness: 0.32, side: THREE.DoubleSide }));
    const bowl = new THREE.Mesh(geo, brass);
    bowl.position.copy(BoardView.FIRE_AT);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    this.fixed.add(bowl);
    const ash = new THREE.Mesh(this.keep(new THREE.CircleGeometry(1.08, 32)), this.keep(new THREE.MeshStandardMaterial({ color: '#2a201a', roughness: 1 })));
    ash.rotation.x = -Math.PI / 2;
    ash.position.copy(BoardView.FIRE_AT).add(new THREE.Vector3(0, 0.12, 0));
    this.fixed.add(ash);
  }

  // ---------------------------------------------------------------- assets

  /** Load the 52 card faces + the back, then compile every shader behind the loading screen. */
  async warmup(onProgress?: (f: number) => void): Promise<void> {
    const loader = new THREE.TextureLoader();
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    let done = 0;
    const deck = buildDeck();
    await Promise.all(
      deck.map(async (c) => {
        try {
          const t = await loader.loadAsync(cardImage(c));
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = aniso;
          this.cardTex.set(c.id, t);
        } catch {
          /* missing card art: the material falls back to a plain card */
        }
        onProgress?.(++done / 53);
      }),
    );
    try {
      const t = await loader.loadAsync(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(backSvg())}`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      // The deck lies sideways (long edge along x).
      t.center.set(0.5, 0.5);
      t.rotation = Math.PI / 2;
      this.backTex = t;
      const mats = this.deck.material as THREE.Material[];
      const back = this.keep(new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
      mats[2] = back;
    } catch {
      /* keep the plain top */
    }
    onProgress?.(1);
    // Compile: one of everything that can appear.
    this.reset({ n: 4, me: 0 }, new Array(16).fill(HOME));
    const tmp = new THREE.Group();
    tmp.add(this.cardMesh(deck[0]!), this.cardMesh(deck[1]!, true));
    const s1 = new THREE.Sprite(this.flameMat);
    const s2 = new THREE.Sprite(this.sparkMat);
    tmp.add(s1, s2);
    this.setRings([{ x: 0, z: 0, id: 0, label: '7' }]);
    this.glow.visible = true;
    this.scene.add(tmp);
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* not supported: the render below compiles */
    }
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(tmp);
    this.setRings([]);
    this.glow.visible = false;
  }

  private cardMat_(c: Card, burnt = false): THREE.Material {
    const key = c.id + (burnt ? 100 : 0);
    let m = this.cardMat.get(key);
    if (!m) {
      const map = this.cardTex.get(c.id) ?? null;
      m = new THREE.MeshStandardMaterial({ map, color: burnt ? '#5a4030' : '#ffffff', roughness: 0.55, alphaTest: 0.5, side: THREE.DoubleSide });
      this.cardMat.set(key, m);
    }
    return m;
  }

  private cardMesh(c: Card, burnt = false): THREE.Mesh {
    const m = new THREE.Mesh(this.cardGeo, this.cardMat_(c, burnt));
    m.rotation.x = -Math.PI / 2;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // ---------------------------------------------------------------- game setup

  /** New game: bake the board for these seats, place the marbles, clear the piles. */
  reset(cfg: { n: 2 | 4; me: number }, marbles: number[]): void {
    this.n = cfg.n;
    const colors: Array<SeatColor | null> = [0, 1, 2, 3].map((q) => {
      if (cfg.n === 4) return playerColor(4, q);
      return q === 0 ? playerColor(2, 0) : q === 2 ? playerColor(2, 1) : null;
    });
    const key = colors.map((c) => c?.hex ?? '-').join();
    if (key !== this.bakedKey) {
      this.bakedKey = key;
      const { map, normal } = bakeTop(colors);
      this.topMaps?.map.dispose();
      this.topMaps?.normal.dispose();
      const mt = new THREE.CanvasTexture(map);
      mt.colorSpace = THREE.SRGBColorSpace;
      mt.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const nt = new THREE.CanvasTexture(normal);
      for (const t of [mt, nt]) {
        t.repeat.set(1 / (2 * B), 1 / (2 * B));
        t.offset.set(0.5, 0.5);
      }
      this.topMaps = { map: mt, normal: nt };
      this.topMat.map = mt;
      this.topMat.normalMap = nt;
      this.topMat.needsUpdate = true;
    }
    // Marbles (rebuilt: the count / colours may change).
    for (const m of this.marbles) {
      m.mesh.removeFromParent();
      m.shadow.removeFromParent();
    }
    for (const mat of this.marbleMats) {
      const map = (mat as THREE.MeshPhysicalMaterial).map;
      map?.dispose();
      mat.dispose();
    }
    this.marbleMats = [];
    this.marbles = [];
    const mats: THREE.Material[] = [];
    for (let p = 0; p < cfg.n; p++) {
      const col = playerColor(cfg.n, p);
      const mat = new THREE.MeshPhysicalMaterial({
        map: marbleTexture(col),
        roughness: 0.08,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        iridescence: 0.25,
        iridescenceIOR: 1.6,
        emissive: new THREE.Color(col.hex),
        emissiveIntensity: 0.06,
      });
      mats.push(mat);
    }
    this.marbleMats = mats;
    for (let m = 0; m < cfg.n * 4; m++) {
      const mesh = new THREE.Mesh(this.marbleGeo, mats[owner(m)]!);
      mesh.castShadow = true;
      mesh.userData.m = m;
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      const hit = new THREE.Mesh(this.hitGeo, this.shadowMat);
      hit.visible = false;
      hit.userData.m = m;
      mesh.add(hit);
      const shadow = new THREE.Mesh(this.ringHitGeo, this.shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.scale.setScalar(0.85);
      this.boardGroup.add(mesh, shadow);
      this.marbles.push({ mesh, shadow, pos: HOME, busy: 0, lift: 0, liftTarget: 0, base: new THREE.Vector3() });
    }
    this.anims = [];
    this.setSeat(cfg.me < 0 ? 0 : cfg.me);
    this.sync(marbles, true);
    // Piles.
    for (const m of [...this.pile, ...this.firePile]) m.removeFromParent();
    this.pile = [];
    this.firePile = [];
    for (const f of this.flames) f.s.removeFromParent();
    this.flames = [];
    this.setDeckCount(52);
    this.setRings([]);
    this.setTurn(-1);
  }

  /** Rotate the board so this player's quadrant faces the camera. */
  setSeat(p: number): void {
    this.seatRot = (quadOf(this.n, p) * Math.PI) / 2;
    this.boardGroup.rotation.y = this.seatRot;
  }

  /** Board-local spot for a marble at a game position. */
  spot(m: number, pos: number): V2 {
    const p = owner(m);
    const q = quadOf(this.n, p);
    if (pos === HOME) return LAYOUT.home[q]![m % 4]!;
    if (pos >= SAFE0) return LAYOUT.safe[q]![pos - SAFE0]!;
    return LAYOUT.track[pos]!;
  }
  /** Board-local spot of a track square / safe hole for a given owner. */
  squareSpot(p: number, pos: number): V2 {
    if (pos >= SAFE0) return LAYOUT.safe[quadOf(this.n, p)]![pos - SAFE0]!;
    return LAYOUT.track[pos]!;
  }

  /** Snap idle marbles to the given positions. */
  sync(marbles: number[], force = false): void {
    marbles.forEach((pos, m) => {
      const o = this.marbles[m];
      if (!o || (o.busy && !force)) return;
      if (o.pos === pos && !force && o.mesh.position.y >= 0) return;
      o.pos = pos;
      const s = this.spot(m, pos);
      o.base.set(s.x, REST_Y, s.z);
      o.mesh.position.copy(o.base);
      o.mesh.scale.setScalar(1);
      o.shadow.position.set(s.x, TOP_Y + 0.006, s.z);
    });
  }

  setDeckCount(n: number): void {
    const h = 0.02 + n * 0.0075;
    this.deck.visible = n > 0;
    this.deck.scale.y = h;
    this.deck.position.y = TOP_Y + h / 2;
  }

  /** Glow under the current player's home pocket (-1 = none). */
  setTurn(p: number, color?: string): void {
    if (p < 0) {
      this.glow.visible = false;
      return;
    }
    const c = LAYOUT.homeCenter[quadOf(this.n, p)]!;
    this.glow.position.set(c.x, TOP_Y + 0.012, c.z);
    (this.glow.material as THREE.MeshBasicMaterial).color.set(color ?? '#ffffff');
    this.glow.visible = true;
  }

  // ---------------------------------------------------------------- highlights

  /** Lift these marbles a little (selectable), and the selected one more. */
  setLift(ids: number[], selected = -1): void {
    this.marbles.forEach((o, m) => (o.liftTarget = m === selected ? 0.42 : ids.includes(m) ? 0.2 : 0));
  }

  setRings(rings: Ring[]): void {
    for (const r of this.rings) {
      r.removeFromParent();
      r.traverse((o) => {
        const mesh = o as THREE.Mesh | THREE.Sprite;
        if ((mesh as THREE.Mesh).isMesh && mesh.material !== this.shadowMat) (mesh.material as THREE.Material).dispose();
        if ((mesh as THREE.Sprite).isSprite) (mesh.material as THREE.Material).dispose();
      });
    }
    this.rings = [];
    for (const r of rings) {
      const g = new THREE.Group();
      g.position.set(r.x, TOP_Y + 0.02, r.z);
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: r.color ?? '#ffd76a', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.userData.ring = r.id;
      const disc = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({ color: r.color ?? '#ffd76a', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.005;
      g.add(disc);
      const hit = new THREE.Mesh(this.ringHitGeo, new THREE.MeshBasicMaterial({ visible: false }));
      hit.rotation.x = -Math.PI / 2;
      hit.userData.ring = r.id;
      g.add(ring, hit);
      if (r.label) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.label(r.label), depthTest: false, transparent: true }));
        sp.position.y = 1.15;
        sp.scale.setScalar(0.95);
        sp.renderOrder = 5;
        sp.userData.ring = r.id;
        g.add(sp);
      }
      g.userData.ring = r.id;
      this.boardGroup.add(g);
      this.rings.push(g);
    }
  }

  private label(text: string): THREE.CanvasTexture {
    let t = this.labelTex.get(text);
    if (!t) {
      t = canvasTex(96, 96, (c) => {
        c.fillStyle = '#ffd76a';
        c.strokeStyle = '#1a1206';
        c.lineWidth = 6;
        c.beginPath();
        c.arc(48, 48, 40, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.fillStyle = '#1a1206';
        c.font = '900 50px "Lilita One", Arial Black, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(text, 48, 52);
      });
      this.labelTex.set(text, t);
    }
    return t;
  }

  // ---------------------------------------------------------------- animations

  private add(a: Omit<Anim, 't'>): void {
    this.anims.push({ ...a, t: 0 });
  }

  /** Hop a marble along its path, one arc per square. Returns seconds. */
  hop(m: number, path: number[], opts: { back?: boolean; delay?: number; kills?: Array<{ m: number; at: number }>; onKill?: (victim: number) => void } = {}): number {
    const o = this.marbles[m];
    if (!o || !path.length) return 0;
    const per = path.length > 9 ? 0.12 : 0.15;
    const p = owner(m);
    const pts = [this.spot(m, o.pos), ...path.map((pos) => this.squareSpot(p, pos))];
    o.busy++;
    const total = per * path.length;
    const kills = new Map((opts.kills ?? []).map((k) => [k.at, k.m]));
    let landed = 0;
    this.add({
      dur: total,
      delay: opts.delay ?? 0,
      step: (k) => {
        const f = Math.min(path.length - 1e-6, k * path.length);
        const i = Math.floor(f);
        const t = ease(f - i);
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const y = REST_Y + Math.sin(t * Math.PI) * (opts.back ? 0.34 : 0.5) + o.lift;
        o.mesh.position.set(x, y, z);
        o.shadow.position.set(x, TOP_Y + 0.006, z);
        o.shadow.scale.setScalar(0.85 - Math.sin(t * Math.PI) * 0.25);
        // Roll: spin around the axis across the direction of travel.
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        o.mesh.rotateOnWorldAxis(new THREE.Vector3(dz / len, 0, -dx / len).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seatRot), 0.22 * (opts.back ? -1 : 1));
        while (landed < i) {
          landed++;
          this.onHop?.(landed - 1, path.length);
          const v = kills.get(landed - 1);
          if (v !== undefined) opts.onKill?.(v);
        }
      },
      done: () => {
        while (landed < path.length) {
          landed++;
          this.onHop?.(landed - 1, path.length);
          const v = kills.get(landed - 1);
          if (v !== undefined) opts.onKill?.(v);
        }
        o.busy--;
        o.pos = path[path.length - 1]!;
        const s = this.spot(m, o.pos);
        o.base.set(s.x, REST_Y, s.z);
        o.mesh.position.copy(o.base);
        o.shadow.position.set(s.x, TOP_Y + 0.006, s.z);
        o.shadow.scale.setScalar(0.85);
        this.puff(s, '#ffffff', 5, 0.25);
      },
    });
    return total + (opts.delay ?? 0);
  }

  /** Arc a marble to a target position (home / start / swap), with landing bounces. */
  fly(m: number, to: number, opts: { height?: number; dur?: number; delay?: number; knock?: V2; spinUp?: boolean } = {}): number {
    const o = this.marbles[m];
    if (!o) return 0;
    const from = this.spot(m, o.pos);
    const end = this.spot(m, to);
    const dur = opts.dur ?? 0.7;
    const hgt = opts.height ?? 1.6;
    o.busy++;
    const knock = opts.knock;
    this.add({
      dur,
      delay: opts.delay ?? 0,
      step: (k) => {
        let x: number, z: number, y: number;
        if (knock) {
          // First a short bounce away from the hit, then the long arc home.
          if (k < 0.25) {
            const t = k / 0.25;
            x = from.x + knock.x * 0.7 * t;
            z = from.z + knock.z * 0.7 * t;
            y = REST_Y + Math.sin(t * Math.PI) * 0.7;
          } else {
            const t = easeOut((k - 0.25) / 0.75);
            const sx = from.x + knock.x * 0.7;
            const sz = from.z + knock.z * 0.7;
            x = sx + (end.x - sx) * t;
            z = sz + (end.z - sz) * t;
            y = REST_Y + Math.sin(t * Math.PI) * hgt * (1 - t * 0.3) + Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t) * 0.2;
          }
        } else {
          const t = ease(k);
          x = from.x + (end.x - from.x) * t;
          z = from.z + (end.z - from.z) * t;
          y = REST_Y + Math.sin(t * Math.PI) * hgt;
          if (opts.spinUp && k < 0.2) o.mesh.scale.setScalar(0.6 + k * 2);
        }
        o.mesh.position.set(x, y, z);
        o.mesh.rotation.x += 0.15;
        o.mesh.rotation.z += 0.09;
        o.shadow.position.set(x, TOP_Y + 0.006, z);
        o.shadow.scale.setScalar(Math.max(0.3, 0.85 - (y - REST_Y) * 0.25));
      },
      done: () => {
        o.busy--;
        o.pos = to;
        o.base.set(end.x, REST_Y, end.z);
        o.mesh.position.copy(o.base);
        o.mesh.scale.setScalar(1);
        o.shadow.position.set(end.x, TOP_Y + 0.006, end.z);
        o.shadow.scale.setScalar(0.85);
        this.puff(end, '#ffffff', 6, 0.3);
      },
    });
    return dur + (opts.delay ?? 0);
  }

  /** Bring out: pop up from the pocket and drop onto the start square. */
  out(m: number, start: number): number {
    const s = this.spot(m, HOME);
    this.puff(s, playerColor(this.n, owner(m)).light, 10, 0.5);
    return this.fly(m, start, { height: 2.2, dur: 0.6, spinUp: true });
  }

  /** Captured: knocked away from the capturer and rolled back to its pocket. */
  capture(victim: number, by: number): number {
    const o = this.marbles[victim];
    if (!o) return 0;
    const a = this.spot(victim, o.pos);
    const bm = this.marbles[by];
    const b = bm ? { x: bm.mesh.position.x, z: bm.mesh.position.z } : { x: 0, z: 0 };
    let d = norm({ x: a.x - b.x, z: a.z - b.z });
    if (!Number.isFinite(d.x) || (d.x === 0 && d.z === 0)) d = norm({ x: a.x, z: a.z });
    this.puff(a, '#ffd76a', 16, 0.7);
    return this.fly(victim, HOME, { knock: d, height: 2.4, dur: 0.85 });
  }

  /** J swap: the two marbles cross in arcs of different heights. */
  swap(a: number, b: number): number {
    const pa = this.marbles[a]?.pos ?? HOME;
    const pb = this.marbles[b]?.pos ?? HOME;
    this.fly(a, pb, { height: 1.9, dur: 0.85 });
    return this.fly(b, pa, { height: 0.9, dur: 0.85 });
  }

  /** A marble just entered its safe zone: sparkles in its colour. */
  safeBurst(m: number): void {
    const o = this.marbles[m];
    if (!o) return;
    const s = this.spot(m, o.pos);
    this.puff(s, playerColor(this.n, owner(m)).light, 22, 0.9);
  }

  /** Card lands on the discard pile (board centre). */
  addDiscard(c: Card): void {
    const mesh = this.cardMesh(c);
    const i = this.pile.length;
    mesh.position.set((Math.random() - 0.5) * 0.35, TOP_Y + 0.02 + Math.min(i, 30) * 0.006, (Math.random() - 0.5) * 0.3);
    mesh.rotation.z = (Math.random() - 0.5) * 0.7;
    this.fixed.add(mesh);
    this.pile.push(mesh);
    const y = mesh.position.y;
    this.add({
      dur: 0.25,
      delay: 0,
      step: (k) => {
        mesh.position.y = y + (1 - easeOut(k)) * 0.8;
        mesh.scale.setScalar(1 + (1 - k) * 0.15);
      },
      done: () => {
        mesh.position.y = y;
        mesh.scale.setScalar(1);
      },
    });
    // Only the top few need to exist.
    while (this.pile.length > 10) this.pile.shift()!.removeFromParent();
  }

  /** Show exactly these cards on the discard pile (after a reconnect / new deck). */
  setDiscard(cards: Card[]): void {
    for (const m of this.pile) m.removeFromParent();
    this.pile = [];
    cards.forEach((c, i) => {
      const mesh = this.cardMesh(c);
      mesh.position.set(Math.sin(c.id * 7.3) * 0.17, TOP_Y + 0.02 + i * 0.006, Math.cos(c.id * 3.1) * 0.15);
      mesh.rotation.z = Math.sin(c.id * 12.9) * 0.35;
      this.fixed.add(mesh);
      this.pile.push(mesh);
    });
  }

  setFire(cards: Card[]): void {
    for (const m of this.firePile) m.removeFromParent();
    this.firePile = [];
    cards.slice(-4).forEach((c, i) => this.pushFire(c, i));
  }

  private pushFire(c: Card, i: number): THREE.Mesh {
    const mesh = this.cardMesh(c, true);
    mesh.scale.setScalar(0.62);
    mesh.position.copy(BoardView.FIRE_AT).add(new THREE.Vector3(Math.sin(c.id * 5.1) * 0.25, 0.16 + i * 0.01, Math.cos(c.id * 2.3) * 0.2));
    mesh.rotation.z = Math.sin(c.id * 9.7) * 1.4;
    this.fixed.add(mesh);
    this.firePile.push(mesh);
    while (this.firePile.length > 4) this.firePile.shift()!.removeFromParent();
    return mesh;
  }

  /** Burned card drops into the bowl with a burst of flame. */
  burn(c: Card): void {
    this.pushFire(c, this.firePile.length);
    const at = BoardView.FIRE_AT;
    for (let i = 0; i < 46; i++) {
      const s = new THREE.Sprite(i % 5 ? this.flameMat : this.sparkMat);
      s.position.set(at.x + (Math.random() - 0.5) * 1.4, 0.35, at.z + (Math.random() - 0.5) * 1.4);
      const max = 0.6 + Math.random() * 0.7;
      s.scale.setScalar(0.5 + Math.random() * 0.7);
      this.fixed.add(s);
      this.flames.push({ s, v: new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.6 + Math.random() * 2.4, (Math.random() - 0.5) * 0.8), life: max, max });
    }
  }

  /** Little additive sparks at a board-local spot. */
  private puff(at: V2, color: string, count: number, speed: number): void {
    const p = new THREE.Vector3(at.x, REST_Y, at.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seatRot);
    for (let i = 0; i < count; i++) {
      const mat = this.sparkMat.clone();
      mat.color.set(color);
      const s = new THREE.Sprite(mat);
      s.position.copy(p);
      s.scale.setScalar(0.18 + Math.random() * 0.18);
      const a = Math.random() * Math.PI * 2;
      const max = 0.35 + Math.random() * 0.35;
      this.fixed.add(s);
      this.flames.push({ s, v: new THREE.Vector3(Math.cos(a) * speed * 3, 0.6 + Math.random() * speed * 3, Math.sin(a) * speed * 3), life: max, max });
    }
  }

  // ---------------------------------------------------------------- frame

  setReserve(r: Reserve): void {
    const o = this.reserve;
    if (Math.abs(o.top - r.top) < 1 && Math.abs(o.bottom - r.bottom) < 1 && Math.abs(o.left - r.left) < 1 && Math.abs(o.right - r.right) < 1) return;
    this.reserve = { ...r };
    this.fitCamera();
  }

  resize(): void {
    const w = this.canvas.parentElement?.clientWidth || innerWidth;
    const h = this.canvas.parentElement?.clientHeight || innerHeight;
    this.size = { w, h };
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.fitCamera();
  }

  /** Free screen rectangle the board must fit in. */
  get area(): { x: number; y: number; w: number; h: number } {
    const r = this.reserve;
    return { x: r.left, y: r.top, w: Math.max(50, this.size.w - r.left - r.right), h: Math.max(50, this.size.h - r.top - r.bottom) };
  }

  private elev = (55 * Math.PI) / 180;

  private placeCamera(dist: number, az: number, el: number): void {
    const c = this.camera;
    c.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    c.lookAt(0, 0, 0);
  }

  /** Fit the board (plus a margin) into the free area, centred, by distance + view offset. */
  private fitCamera(): void {
    const { w, h } = this.size;
    const ar = this.area;
    const c = this.camera;
    c.aspect = w / h;
    c.clearViewOffset();
    c.updateProjectionMatrix();
    const corners: THREE.Vector3[] = [];
    const m = B + 0.4;
    for (const x of [-m, m]) for (const z of [-m, m]) for (const y of [-0.75, 0.6]) corners.push(new THREE.Vector3(x, y, z));
    let dist = this.fit.dist;
    let bx = 0;
    let by = 0;
    for (let it = 0; it < 6; it++) {
      this.placeCamera(dist, 0, this.elev);
      c.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of corners) {
        const v = p.clone().project(c);
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * h;
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy);
        y1 = Math.max(y1, sy);
      }
      const k = Math.max((x1 - x0) / (ar.w * 0.99), (y1 - y0) / (ar.h * 0.99));
      bx = (x0 + x1) / 2;
      by = (y0 + y1) / 2;
      dist *= k;
    }
    this.fit = { dist, offX: bx - (ar.x + ar.w / 2), offY: by - (ar.y + ar.h / 2) };
    // Fog only fades the far felt, however far the camera had to back off.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = dist * 1.4;
    fog.far = dist * 3.2;
    c.far = dist * 4;
    c.setViewOffset(w, h, this.fit.offX, this.fit.offY, w, h);
    c.updateProjectionMatrix();
  }

  /** Screen position (CSS px) of a board-local point (rotated with the board) or world point. */
  project(p: THREE.Vector3, local = true): { x: number; y: number } {
    const v = local ? p.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seatRot) : p.clone();
    v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.size.w, y: (-v.y * 0.5 + 0.5) * this.size.h };
  }
  /** Screen position of a marble / spot / pile. */
  screenOfSpot(s: V2, y = 0.3): { x: number; y: number } {
    return this.project(new THREE.Vector3(s.x, y, s.z));
  }
  screenOfDiscard(): { x: number; y: number } {
    return this.project(new THREE.Vector3(0, 0.1, 0), false);
  }
  screenOfFire(): { x: number; y: number } {
    return this.project(BoardView.FIRE_AT.clone().setY(0.4), false);
  }
  screenOfDeck(): { x: number; y: number } {
    return this.project(BoardView.DECK_AT.clone().setY(0.3), false);
  }
  screenOfHome(p: number): { x: number; y: number } {
    return this.screenOfSpot(LAYOUT.homeCenter[quadOf(this.n, p)]!, 0.2);
  }
  /** Screen-space bounding box of the board. */
  boardRect(): DOMRect {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [-B, B])
      for (const z of [-B, B]) {
        const s = this.project(new THREE.Vector3(x, 0, z), false);
        x0 = Math.min(x0, s.x);
        x1 = Math.max(x1, s.x);
        y0 = Math.min(y0, s.y);
        y1 = Math.max(y1, s.y);
      }
    return new DOMRect(x0, y0, x1 - x0, y1 - y0);
  }

  /** What's under the pointer: a highlight ring, else a marble. */
  pick(clientX: number, clientY: number): { ring?: number; marble?: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const ringHits = this.ray.intersectObjects(this.rings, true);
    for (const h of ringHits) if (h.object.userData.ring !== undefined) return { ring: h.object.userData.ring as number };
    const hits = this.ray.intersectObjects(
      this.marbles.map((o) => o.mesh),
      true,
    );
    for (const h of hits) if (h.object.userData.m !== undefined) return { marble: h.object.userData.m as number };
    return null;
  }

  /** Jump every running animation to its end (the table moves on to the next event). */
  finishAll(): void {
    const list = this.anims;
    this.anims = [];
    for (const a of list) {
      a.step(1);
      a.done?.();
    }
  }

  get animating(): boolean {
    return this.anims.length > 0;
  }

  frame(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    // Animations.
    for (let i = 0; i < this.anims.length; i++) {
      const a = this.anims[i]!;
      if (a.delay > 0) {
        a.delay -= dt;
        continue;
      }
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      a.step(k);
      if (k >= 1) {
        this.anims.splice(i--, 1);
        a.done?.();
      }
    }
    // Lifted (selectable) marbles bob gently.
    for (const o of this.marbles) {
      o.lift += (o.liftTarget - o.lift) * Math.min(1, dt * 10);
      if (!o.busy) {
        const bob = o.liftTarget > 0 ? Math.sin(this.time * 4 + o.base.x) * 0.05 : 0;
        o.mesh.position.y = o.base.y + o.lift + bob;
        o.shadow.scale.setScalar(0.85 - o.lift * 0.4);
      }
    }
    // Flames / sparks.
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i]!;
      f.life -= dt;
      if (f.life <= 0) {
        f.s.removeFromParent();
        if (f.s.material !== this.flameMat && f.s.material !== this.sparkMat) f.s.material.dispose();
        this.flames.splice(i--, 1);
        continue;
      }
      f.s.position.addScaledVector(f.v, dt);
      f.v.y -= dt * 1.2;
      const k = f.life / f.max;
      f.s.material.opacity = k;
      f.s.scale.multiplyScalar(1 + dt * 0.6);
    }
    // Rings pulse.
    const pulse = 1 + Math.sin(this.time * 6) * 0.08;
    for (const r of this.rings) r.scale.set(pulse, 1, pulse);
    // Turn glow breathes.
    if (this.glow.visible) (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(this.time * 3) * 0.25;
    // Camera: slow orbit in the menu, a gentle drift in game.
    if (this.showcase) this.placeCamera(this.fit.dist * 1.05, this.time * 0.06, this.elev + Math.sin(this.time * 0.2) * 0.05);
    else this.placeCamera(this.fit.dist, Math.sin(this.time * 0.13) * 0.018, this.elev + Math.sin(this.time * 0.09) * 0.012);
    this.renderer.render(this.scene, this.camera);
  }

  /** Tear down: every GPU resource and the WebGL context itself. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    removeEventListener('resize', this.onResize);
    const seen = new Set<object>();
    const free = (o: { dispose(): void } | null | undefined) => {
      if (!o || seen.has(o)) return;
      seen.add(o);
      o.dispose();
    };
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) free(m.geometry);
      if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) free(v);
        free(mat);
      }
    });
    for (const r of this.shared) free(r);
    for (const t of this.cardTex.values()) free(t);
    for (const m of this.cardMat.values()) free(m);
    for (const t of this.labelTex.values()) free(t);
    for (const m of this.marbleMats) free(m);
    free(this.backTex);
    free(this.topMaps?.map);
    free(this.topMaps?.normal);
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
