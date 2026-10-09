import type { Floor, Prop } from '../sim/maps';

/**
 * Hand-drawn (vector) art in the style of the original: chunky black outlines, bean-shaped
 * crewmates with a visor and a backpack, half-bodies with a bone, see-through ghosts.
 * Everything is drawn in metres (the caller sets the world transform).
 */

type Ctx = CanvasRenderingContext2D;
export const INK = '#0b0b10';
const LW = 0.07;

export const VISOR = '#95cadc';
export const VISOR_DARK = '#4b7a92';

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[]): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** The bean's body outline (facing right, feet at 0,0). */
function bodyPath(ctx: Ctx, legA: number, legB: number): void {
  ctx.beginPath();
  // Back leg, front leg (their bottoms move when walking).
  ctx.moveTo(-0.36, -0.62);
  ctx.arc(0, -0.62, 0.36, Math.PI, 0);
  ctx.lineTo(0.36, -0.06 + legB);
  ctx.quadraticCurveTo(0.36, 0.02 + legB, 0.26, 0.02 + legB);
  ctx.lineTo(0.12, 0.02 + legB);
  ctx.quadraticCurveTo(0.05, 0.02 + legB, 0.05, -0.08 + legB * 0.5);
  ctx.lineTo(0.05, -0.16);
  ctx.lineTo(-0.05, -0.16);
  ctx.lineTo(-0.05, -0.08 + legA * 0.5);
  ctx.quadraticCurveTo(-0.05, 0.02 + legA, -0.12, 0.02 + legA);
  ctx.lineTo(-0.26, 0.02 + legA);
  ctx.quadraticCurveTo(-0.36, 0.02 + legA, -0.36, -0.06 + legA);
  ctx.closePath();
}

export interface BeanOpts {
  left?: boolean;
  /** Walk cycle phase (radians); moving = legs swing. */
  phase?: number;
  moving?: boolean;
  alpha?: number;
  ghost?: boolean;
  /** Outline glow (red for a kill target, yellow when highlighted). */
  glow?: string;
  scale?: number;
}

export function bean(ctx: Ctx, x: number, y: number, main: string, shadow: string, o: BeanOpts = {}): void {
  const s = o.scale ?? 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(o.left ? -s : s, s);
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.lineJoin = 'round';
  ctx.lineWidth = LW;
  ctx.strokeStyle = INK;
  if (o.ghost) {
    ghostBody(ctx, main, shadow, o.phase ?? 0);
    ctx.restore();
    return;
  }
  const ph = o.phase ?? 0;
  const legA = o.moving ? Math.max(0, Math.sin(ph)) * -0.09 : 0;
  const legB = o.moving ? Math.max(0, -Math.sin(ph)) * -0.09 : 0;
  const bob = o.moving ? Math.abs(Math.sin(ph)) * -0.03 : 0;
  ctx.translate(0, bob);
  // Shadow on the floor.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02 - bob, 0.38, 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  // Backpack.
  rr(ctx, -0.5, -0.74, 0.22, 0.46, 0.08);
  ctx.fillStyle = main;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = shadow;
  ctx.fillRect(-0.5, -0.5, 0.22, 0.3);
  ctx.restore();
  ctx.stroke();
  // Body.
  bodyPath(ctx, legA, legB);
  ctx.fillStyle = main;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(-0.36, -0.36, 0.2, 0.56, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-0.4, -0.12, 0.8, 0.2);
  // Glossy highlight.
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.ellipse(0.05, -0.86, 0.14, 0.06, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  bodyPath(ctx, legA, legB);
  if (o.glow) {
    ctx.save();
    ctx.strokeStyle = o.glow;
    ctx.lineWidth = LW * 2.4;
    ctx.stroke();
    ctx.restore();
  }
  ctx.stroke();
  visor(ctx);
  ctx.restore();
}

function visor(ctx: Ctx): void {
  rr(ctx, -0.02, -0.84, 0.48, 0.28, 0.14);
  ctx.fillStyle = VISOR;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = VISOR_DARK;
  ctx.beginPath();
  ctx.ellipse(0.2, -0.54, 0.34, 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(0.27, -0.76, 0.1, 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  rr(ctx, -0.02, -0.84, 0.48, 0.28, 0.14);
  ctx.stroke();
}

function ghostBody(ctx: Ctx, main: string, shadow: string, ph: number): void {
  ctx.globalAlpha *= 0.5;
  const w = Math.sin(ph * 0.5) * 0.04;
  rr(ctx, -0.5, -0.74, 0.22, 0.4, 0.08);
  ctx.fillStyle = main;
  ctx.fill();
  ctx.stroke();
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(-0.36, -0.62);
    ctx.arc(0, -0.62, 0.36, Math.PI, 0);
    ctx.lineTo(0.36, -0.12);
    // Wavy tail.
    ctx.quadraticCurveTo(0.24, -0.02 + w, 0.18, -0.12);
    ctx.quadraticCurveTo(0.08, 0.04 - w, 0, -0.1);
    ctx.quadraticCurveTo(-0.1, 0.04 + w, -0.18, -0.1);
    ctx.quadraticCurveTo(-0.28, 0.02 - w, -0.36, -0.12);
    ctx.closePath();
  };
  path();
  ctx.fillStyle = main;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(-0.3, -0.28, 0.24, 0.5, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  path();
  ctx.stroke();
  visor(ctx);
}

/** A dead body: the bottom half, with a bone poking out. */
export function deadBody(ctx: Ctx, x: number, y: number, main: string, shadow: string, scale = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  ctx.lineWidth = LW;
  ctx.strokeStyle = INK;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 0.4, 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  // Bone.
  ctx.fillStyle = '#f4f1e6';
  rr(ctx, -0.04, -0.62, 0.08, 0.26, 0.03);
  ctx.fill();
  ctx.stroke();
  for (const dx of [-0.05, 0.05]) {
    ctx.beginPath();
    ctx.arc(dx, -0.62, 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Lower half.
  ctx.beginPath();
  ctx.moveTo(-0.36, -0.42);
  ctx.lineTo(0.36, -0.42);
  ctx.lineTo(0.36, -0.06);
  ctx.quadraticCurveTo(0.36, 0.02, 0.26, 0.02);
  ctx.lineTo(0.12, 0.02);
  ctx.quadraticCurveTo(0.05, 0.02, 0.05, -0.08);
  ctx.lineTo(0.05, -0.16);
  ctx.lineTo(-0.05, -0.16);
  ctx.lineTo(-0.05, -0.08);
  ctx.quadraticCurveTo(-0.05, 0.02, -0.12, 0.02);
  ctx.lineTo(-0.26, 0.02);
  ctx.quadraticCurveTo(-0.36, 0.02, -0.36, -0.06);
  ctx.closePath();
  ctx.fillStyle = main;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = shadow;
  ctx.fillRect(-0.4, -0.2, 0.8, 0.3);
  ctx.restore();
  ctx.stroke();
  // The cut (inside of the bean).
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(0, -0.42, 0.36, 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f4f1e6';
  ctx.beginPath();
  ctx.ellipse(0, -0.42, 0.06, 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- floors

const FLOOR_COLORS: Record<Floor, [string, string]> = {
  tile: ['#9aa4ae', '#8a949f'],
  metal: ['#6a7480', '#5d6772'],
  grate: ['#4d5660', '#3c444d'],
  carpet: ['#466073', '#3f586a'],
  hall: ['#79838e', '#6e7883'],
  wood: ['#8a6440', '#7a5636'],
  lab: ['#c8d5df', '#b6c5d1'],
  snow: ['#dfe8f1', '#cfdbe7'],
  rock: ['#7d6a5c', '#6e5c4f'],
  green: ['#5f8c66', '#557f5b'],
  white: ['#d7dfe7', '#c6d0da'],
  dark: ['#3a414c', '#323843'],
};
export const floorColor = (f: Floor) => FLOOR_COLORS[f][0];

const patterns = new Map<string, CanvasPattern>();
const canvases = new Map<string, HTMLCanvasElement>();
/** A floor pattern (one tile = 2 m). */
export function floorPattern(ctx: Ctx, f: Floor): CanvasPattern {
  const hit = patterns.get(f);
  if (hit) return hit;
  const p = ctx.createPattern(floorCanvas(f), 'repeat')!;
  p.setTransform(new DOMMatrix().scale(2 / 128));
  patterns.set(f, p);
  return p;
}

/** The floor tile itself (128 px = 2 m), also used as a 3D texture. */
export function floorCanvas(f: Floor): HTMLCanvasElement {
  const hit = canvases.get(f);
  if (hit) return hit;
  const N = 128; // one tile = 2 m
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const [a, b] = FLOOR_COLORS[f];
  g.fillStyle = a;
  g.fillRect(0, 0, N, N);
  const line = (x0: number, y0: number, x1: number, y1: number, col: string, w = 2) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  const noise = (n: number, col: string, size = 2) => {
    g.fillStyle = col;
    let s = f.length * 977;
    for (let i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      const x = s % N;
      s = (s * 16807) % 2147483647;
      const y = s % N;
      g.fillRect(x, y, size, size);
    }
  };
  switch (f) {
    case 'tile':
      g.fillStyle = b;
      g.fillRect(0, 0, N / 2, N / 2);
      g.fillRect(N / 2, N / 2, N / 2, N / 2);
      line(0, 0, N, 0, 'rgba(0,0,0,0.25)');
      line(0, 0, 0, N, 'rgba(0,0,0,0.25)');
      line(N / 2, 0, N / 2, N, 'rgba(0,0,0,0.18)');
      line(0, N / 2, N, N / 2, 'rgba(0,0,0,0.18)');
      break;
    case 'white':
    case 'lab':
      for (let i = 0; i <= N; i += N / 4) {
        line(i, 0, i, N, 'rgba(60,80,100,0.22)');
        line(0, i, N, i, 'rgba(60,80,100,0.22)');
      }
      break;
    case 'metal':
    case 'hall':
      g.fillStyle = b;
      g.fillRect(0, 0, N, N / 2 - 2);
      line(0, 0, N, 0, 'rgba(0,0,0,0.35)', 3);
      line(0, N / 2, N, N / 2, 'rgba(0,0,0,0.35)', 3);
      line(N / 2, 0, N / 2, N / 2, 'rgba(0,0,0,0.25)', 2);
      line(0, N / 2, 0, N, 'rgba(0,0,0,0.25)', 2);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      for (const [x, y] of [[6, 6], [N / 2 - 8, 6], [N / 2 + 6, N / 2 + 6], [N - 8, N / 2 + 6], [6, N / 2 + 6], [N / 2 + 6, 6]]) g.fillRect(x!, y!, 3, 3);
      break;
    case 'grate':
      for (let i = -N; i < N * 2; i += 10) line(i, 0, i + N, N, 'rgba(0,0,0,0.35)', 2);
      for (let i = -N; i < N * 2; i += 10) line(i + N, 0, i, N, 'rgba(255,255,255,0.06)', 2);
      line(0, 0, N, 0, 'rgba(0,0,0,0.5)', 4);
      line(0, 0, 0, N, 'rgba(0,0,0,0.5)', 4);
      break;
    case 'carpet':
      noise(900, b, 2);
      noise(300, 'rgba(255,255,255,0.05)', 2);
      break;
    case 'wood':
      for (let y = 0; y < N; y += 16) {
        line(0, y, N, y, 'rgba(0,0,0,0.3)');
        line(((y * 7) % N) | 0, y, ((y * 7) % N) | 0, y + 16, 'rgba(0,0,0,0.25)');
      }
      break;
    case 'snow':
      noise(500, b, 3);
      noise(200, '#ffffff', 2);
      break;
    case 'rock':
      noise(700, b, 3);
      break;
    case 'green':
      for (let i = 0; i <= N; i += N / 2) {
        line(i, 0, i, N, 'rgba(0,0,0,0.25)');
        line(0, i, N, i, 'rgba(0,0,0,0.25)');
      }
      noise(200, b, 3);
      break;
    case 'dark':
      for (let i = 0; i <= N; i += N / 2) {
        line(i, 0, i, N, 'rgba(255,255,255,0.06)');
        line(0, i, N, i, 'rgba(255,255,255,0.06)');
      }
      break;
  }
  canvases.set(f, c);
  return c;
}

// ---------------------------------------------------------------- props

function box(ctx: Ctx, x: number, y: number, w: number, h: number, top: string, front: string, r = 0.12, depth = 0.35): void {
  // A block seen from above at a slant: top face + front face.
  rr(ctx, x - w / 2, y - h / 2 + depth, w, h, r);
  ctx.fillStyle = front;
  ctx.fill();
  ctx.stroke();
  rr(ctx, x - w / 2, y - h / 2, w, h, r);
  ctx.fillStyle = top;
  ctx.fill();
  ctx.stroke();
}
function screen(ctx: Ctx, x: number, y: number, w: number, h: number, col: string, t: number): void {
  rr(ctx, x - w / 2, y - h / 2, w, h, 0.06);
  ctx.fillStyle = '#10202a';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.globalAlpha *= 0.75 + Math.sin(t * 3 + x) * 0.15;
  ctx.fillRect(x - w / 2 + 0.06, y - h / 2 + 0.06, w - 0.12, h - 0.12);
  ctx.globalAlpha = 1;
}

/** Draw a map prop. `t` = time (animations). */
export function prop(ctx: Ctx, p: Prop, t: number): void {
  ctx.save();
  ctx.lineWidth = LW;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  const w = p.w ?? (p.r ?? 0.5) * 2;
  const h = p.h ?? (p.r ?? 0.5) * 2;
  const { x, y } = p;
  switch (p.kind) {
    case 'roundtable':
    case 'table': {
      if (p.kind === 'roundtable') {
        ctx.fillStyle = '#6d7a87';
        ctx.beginPath();
        ctx.ellipse(x, y + 0.25, p.r!, p.r! * 0.92, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#b8c3cc';
        ctx.beginPath();
        ctx.ellipse(x, y, p.r!, p.r! * 0.92, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.ellipse(x - p.r! * 0.3, y - p.r! * 0.3, p.r! * 0.35, p.r! * 0.2, -0.6, 0, Math.PI * 2);
        ctx.fill();
      } else box(ctx, x, y, w, h, '#a9b4be', '#6d7a87');
      break;
    }
    case 'button': {
      // The emergency button under its glass dome.
      ctx.fillStyle = '#5f6b77';
      ctx.beginPath();
      ctx.ellipse(x, y, 0.55, 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e0242c';
      ctx.beginPath();
      ctx.ellipse(x, y - 0.06, 0.32, 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(190,230,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, y - 0.18, 0.46, 0.4, 0, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'engine': {
      box(ctx, x, y, w, h, '#8f9aa6', '#5a6470', 0.6, 0.5);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = '#ffb347';
        ctx.globalAlpha = 0.5 + Math.sin(t * 6 + i) * 0.3;
        ctx.fillRect(x - w / 2 - 0.5, y - h / 2 + 1 + i * 2, 0.5, 0.8);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = '#3d4650';
      for (let i = 0; i < 4; i++) ctx.fillRect(x - w / 2 + 0.4, y - h / 2 + 0.8 + i * 1.5, w - 0.8, 0.25);
      break;
    }
    case 'reactor': {
      const r = p.r!;
      ctx.fillStyle = '#4b5560';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const g = ctx.createRadialGradient(x, y, 0.2, x, y, r * 0.75);
      g.addColorStop(0, '#d8fbff');
      g.addColorStop(0.5, '#5fd6ff');
      g.addColorStop(1, '#1b6aa8');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * (0.7 + Math.sin(t * 2) * 0.03), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'console':
      box(ctx, x, y, w, h, '#58636f', '#3a434d', 0.1, 0.25);
      screen(ctx, x, y - 0.05, w * 0.8, h * 0.55, '#41d1ff', t);
      break;
    case 'cams':
      box(ctx, x, y, w, h, '#58636f', '#3a434d', 0.1, 0.25);
      for (let i = 0; i < 4; i++) screen(ctx, x - w / 2 + 0.4 + i * ((w - 0.8) / 3), y - 0.05, 0.55, h * 0.55, '#7cf59a', t + i);
      break;
    case 'vitals':
      box(ctx, x, y, w, h, '#58636f', '#3a434d', 0.1, 0.25);
      screen(ctx, x, y - 0.05, w * 0.85, h * 0.6, '#44ff88', t);
      break;
    case 'bed':
      box(ctx, x, y, w, h, '#e9eef3', '#8d9ba8', 0.15, 0.25);
      ctx.fillStyle = '#9fd3ff';
      rr(ctx, x - w / 2 + 0.1, y - h / 2 + 0.1, 0.5, h - 0.2, 0.1);
      ctx.fill();
      ctx.stroke();
      break;
    case 'scanner': {
      ctx.fillStyle = '#6f7b87';
      ctx.beginPath();
      ctx.ellipse(x, y, 0.75, 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#4cf1a0';
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.ellipse(x, y, 0.55, 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'crate':
      box(ctx, x, y, w, h, '#c08a4b', '#8a5f2e', 0.08, 0.35);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y - h / 2);
      ctx.lineTo(x + w / 2, y + h / 2);
      ctx.moveTo(x + w / 2, y - h / 2);
      ctx.lineTo(x - w / 2, y + h / 2);
      ctx.stroke();
      break;
    case 'boxes':
      box(ctx, x - w / 4, y + h / 6, w / 2, h / 1.6, '#b37c45', '#7d5428', 0.05, 0.3);
      box(ctx, x + w / 4, y - h / 6, w / 2, h / 1.6, '#c99358', '#8a5f2e', 0.05, 0.3);
      break;
    case 'shelf':
      box(ctx, x, y, w, h, '#7c858e', '#4d555d', 0.05, 0.4);
      for (let i = 0; i < Math.floor(w); i++) {
        ctx.fillStyle = ['#e9c46a', '#7ad3f5', '#f28482', '#84dc8a'][i % 4]!;
        ctx.fillRect(x - w / 2 + 0.3 + i, y - 0.2, 0.5, 0.35);
      }
      break;
    case 'chair':
      ctx.fillStyle = '#4b5560';
      ctx.beginPath();
      ctx.arc(x, y, w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d14b4b';
      ctx.beginPath();
      ctx.arc(x, y - 0.1, w / 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'adminmap': {
      box(ctx, x, y, w, h, '#3a4855', '#25303a', 0.15, 0.35);
      ctx.fillStyle = '#4cf1ff';
      ctx.globalAlpha = 0.55 + Math.sin(t * 2) * 0.1;
      rr(ctx, x - w / 2 + 0.25, y - h / 2 + 0.25, w - 0.5, h - 0.5, 0.1);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 0.04;
      ctx.strokeRect(x - w / 4, y - h / 4, w / 2, h / 2);
      break;
    }
    case 'locker':
      box(ctx, x, y, w, h, '#7a8a9a', '#4f5d6b', 0.05, 0.6);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      for (let i = 1; i < w / 0.8; i++) {
        ctx.beginPath();
        ctx.moveTo(x - w / 2 + i * 0.8, y - h / 2);
        ctx.lineTo(x - w / 2 + i * 0.8, y + h / 2 + 0.6);
        ctx.stroke();
      }
      break;
    case 'rocket': {
      const r = p.r!;
      ctx.fillStyle = '#d9dee4';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.7, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e04a3b';
      ctx.beginPath();
      ctx.ellipse(x, y - r * 0.6, r * 0.45, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = VISOR;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'plant':
    case 'tree': {
      const r = p.r ?? 0.8;
      ctx.fillStyle = '#7a5130';
      rr(ctx, x - r * 0.45, y - r * 0.1, r * 0.9, r * 0.75, 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = p.kind === 'tree' ? '#2f8f5b' : '#3faa4f';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.sin(t + i) * 0.05;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * r * 0.45, y - r * 0.45 + Math.sin(a) * r * 0.35, r * 0.45, r * 0.32, a, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'railing':
      ctx.fillStyle = '#8b97a3';
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      break;
    case 'vending':
      box(ctx, x, y, w, h, '#d6463f', '#932b25', 0.08, 0.4);
      screen(ctx, x, y - h / 4, w * 0.6, h * 0.25, '#ffe066', t);
      break;
    case 'drill': {
      const r = p.r!;
      ctx.fillStyle = '#d9a33b';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 1.5);
      ctx.fillStyle = '#5e6670';
      for (let i = 0; i < 3; i++) {
        ctx.rotate((Math.PI * 2) / 3);
        ctx.fillRect(-0.15, 0, 0.3, r * 0.8);
      }
      ctx.restore();
      break;
    }
    case 'rockpile': {
      const r = p.r!;
      for (const [dx, dy, s] of [[-0.3, 0.2, 0.7], [0.35, 0.15, 0.6], [0, -0.25, 0.75]] as const) {
        ctx.fillStyle = '#8b7d72';
        ctx.beginPath();
        ctx.ellipse(x + dx * r, y + dy * r, r * s * 0.7, r * s * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f0f5fa';
        ctx.beginPath();
        ctx.ellipse(x + dx * r, y + dy * r - r * s * 0.25, r * s * 0.45, r * s * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'lava': {
      const r = p.r!;
      const g = ctx.createRadialGradient(x, y, 0.1, x, y, r);
      g.addColorStop(0, '#ffe08a');
      g.addColorStop(0.5, '#ff7b2e');
      g.addColorStop(1, '#a3261b');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'machine':
      box(ctx, x, y, w, h, '#6f7a85', '#46505a', 0.08, 0.4);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = Math.sin(t * 4 + i * 2) > 0 ? '#ffd23f' : '#6b5a1e';
        ctx.beginPath();
        ctx.arc(x - w / 3 + (i * w) / 3, y, 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'pipes':
      ctx.lineWidth = 0.32;
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y - h / 4);
      ctx.lineTo(x + w / 2, y - h / 4);
      ctx.moveTo(x - w / 2, y + h / 4);
      ctx.lineTo(x + w / 2, y + h / 4);
      ctx.stroke();
      ctx.lineWidth = 0.2;
      ctx.strokeStyle = '#a7b2bd';
      ctx.stroke();
      break;
    case 'shield': {
      const r = p.r!;
      ctx.fillStyle = '#4b5560';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      for (let i = 0; i < 7; i++) {
        const a = (i / 6) * Math.PI * 2;
        const cx = i === 6 ? x : x + Math.cos(a) * r * 0.55;
        const cy = i === 6 ? y : y + Math.sin(a) * r * 0.55;
        ctx.fillStyle = '#7fd8ff';
        ctx.beginPath();
        for (let k = 0; k < 6; k++) ctx.lineTo(cx + Math.cos((k * Math.PI) / 3) * r * 0.28, cy + Math.sin((k * Math.PI) / 3) * r * 0.28);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'chute':
      box(ctx, x, y, 1.4, 1, '#77818b', '#4b545d', 0.1, 0.3);
      ctx.fillStyle = '#20262c';
      ctx.fillRect(x - 0.45, y - 0.3, 0.9, 0.5);
      break;
    case 'telescope': {
      const r = p.r!;
      ctx.fillStyle = '#5a6470';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.7);
      ctx.fillStyle = '#c9d3dc';
      rr(ctx, -0.2, -r * 1.6, 0.4, r * 1.6, 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'dropship': {
      ctx.fillStyle = '#c9d2db';
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y + h / 2);
      ctx.lineTo(x - w / 2 + 0.8, y - h / 2);
      ctx.lineTo(x + w / 2 - 0.8, y - h / 2);
      ctx.lineTo(x + w / 2, y + h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e15b4c';
      ctx.fillRect(x - w / 2 + 1, y - 0.4, w - 2, 0.8);
      ctx.strokeRect(x - w / 2 + 1, y - 0.4, w - 2, 0.8);
      ctx.fillStyle = VISOR;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(x - w / 4 + (i * w) / 4, y - h / 4, 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

/** A floor vent (open = the lid flipped up, while someone hops in or out). */
export function vent(ctx: Ctx, x: number, y: number, open: number): void {
  ctx.save();
  ctx.lineWidth = LW;
  ctx.strokeStyle = INK;
  rr(ctx, x - 0.5, y - 0.32, 1, 0.64, 0.08);
  ctx.fillStyle = '#20262c';
  ctx.fill();
  ctx.stroke();
  if (open < 0.95) {
    ctx.save();
    ctx.translate(x, y - 0.32);
    ctx.scale(1, 1 - open * 2);
    rr(ctx, -0.5, 0, 1, 0.64, 0.08);
    ctx.fillStyle = '#7e8994';
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#3a434c';
    ctx.lineWidth = 0.06;
    for (let i = 1; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(-0.4, i * 0.128);
      ctx.lineTo(0.4, i * 0.128);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Crewmate icon for the UI (meeting cards, lists): a small canvas data URL. */
const iconCache = new Map<string, string>();
export function beanIcon(main: string, shadow: string, dead = false, size = 64, ghost = false): string {
  const key = `${main}|${dead}|${size}|${ghost}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.scale(size / 1.25, size / 1.25);
  ctx.translate(0.66, 1.12);
  if (dead) deadBody(ctx, 0, 0, main, shadow);
  else bean(ctx, 0, 0, main, shadow, { ghost });
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}
