import { POCKETS, R, SEGMENTS, TABLE_L, TABLE_W, FOOT_SPOT_X, HEAD_STRING_X } from './physics';

export const BALL_COLORS: Record<number, string> = {
  0: '#f8f6ee',
  1: '#f5c000',
  2: '#1546b8',
  3: '#d4222b',
  4: '#5a2a8a',
  5: '#f2671a',
  6: '#11843c',
  7: '#7c1d22',
  8: '#121214',
};
export const ballColor = (id: number) => BALL_COLORS[id > 8 ? id - 8 : id]!;
export const RAIL = 0.115;

// ---------------------------------------------------------------- view transform

/** World (metres, y up) ↔ screen (px, y down), optionally rotated 90° for portrait. */
export class Transform {
  cx = 0;
  cy = 0;
  s = 400;
  rot = false;
  fit(w: number, h: number, padL: number, padR: number, padT: number, padB: number, portrait: boolean): void {
    this.rot = portrait;
    const tw = TABLE_L + 2 * RAIL;
    const th = TABLE_W + 2 * RAIL;
    const aw = w - padL - padR;
    const ah = h - padT - padB;
    this.s = portrait ? Math.min(aw / th, ah / tw) : Math.min(aw / tw, ah / th);
    this.cx = padL + aw / 2;
    this.cy = padT + ah / 2;
  }
  x(wx: number, wy: number): number {
    return this.rot ? this.cx - wy * this.s : this.cx + wx * this.s;
  }
  y(wx: number, wy: number): number {
    return this.rot ? this.cy - wx * this.s : this.cy - wy * this.s;
  }
  /** Screen → world. */
  world(sx: number, sy: number): { x: number; y: number } {
    return this.rot ? { x: (this.cy - sy) / this.s, y: (this.cx - sx) / this.s } : { x: (sx - this.cx) / this.s, y: (this.cy - sy) / this.s };
  }
  /** Screen direction (px, py-down) → world direction. */
  dirToWorld(px: number, py: number): [number, number] {
    return this.rot ? [-py, -px] : [px, -py];
  }
}

// ---------------------------------------------------------------- table

function grain(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, horizontal: boolean): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  for (let i = 0; i < (horizontal ? h : w) / 2.2; i++) {
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,220,170' : '30,10,0'},${0.04 + Math.random() * 0.06})`;
    g.lineWidth = 0.6 + Math.random() * 1.4;
    g.beginPath();
    const o = i * 2.2 + Math.random();
    if (horizontal) {
      g.moveTo(x, y + o);
      for (let k = 0; k <= 8; k++) g.lineTo(x + (w * k) / 8, y + o + Math.sin(k * 0.9 + i) * 1.6);
    } else {
      g.moveTo(x + o, y);
      for (let k = 0; k <= 8; k++) g.lineTo(x + o + Math.sin(k * 0.9 + i) * 1.6, y + (h * k) / 8);
    }
    g.stroke();
  }
  g.restore();
}

/** Pre-render the whole table (rails, cushions, cloth, pockets, diamonds) at the current transform. */
export function renderTable(t: Transform, w: number, h: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const s = t.s;
  const P = (x: number, y: number): [number, number] => [t.x(x, y), t.y(x, y)];
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const a = P(x0, y0);
    const b = P(x1, y1);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])] as const;
  };
  const HL = TABLE_L / 2;
  const HW = TABLE_W / 2;
  // Outer shadow.
  const [ox, oy, ow, oh] = rect(-HL - RAIL, -HW - RAIL, HL + RAIL, HW + RAIL);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 40;
  g.shadowOffsetY = 18;
  g.fillStyle = '#2a140a';
  roundRect(g, ox, oy, ow, oh, s * 0.06);
  g.fill();
  g.restore();
  // Wooden rails.
  const wood = g.createLinearGradient(ox, oy, ox, oy + oh);
  wood.addColorStop(0, '#6b3519');
  wood.addColorStop(0.08, '#8a4a22');
  wood.addColorStop(0.5, '#5a2a12');
  wood.addColorStop(0.92, '#7d4120');
  wood.addColorStop(1, '#4a220e');
  g.fillStyle = wood;
  roundRect(g, ox, oy, ow, oh, s * 0.06);
  g.fill();
  grain(g, ox, oy, ow, oh, !t.rot);
  // Inner bevel highlight.
  g.strokeStyle = 'rgba(255,210,150,0.25)';
  g.lineWidth = 2;
  roundRect(g, ox + 3, oy + 3, ow - 6, oh - 6, s * 0.055);
  g.stroke();
  // Cloth (extends under the cushions).
  const [cx, cy, cw, ch] = rect(-HL - 0.045, -HW - 0.045, HL + 0.045, HW + 0.045);
  const cloth = g.createRadialGradient(t.cx, t.cy, 0, t.cx, t.cy, Math.max(cw, ch) * 0.65);
  cloth.addColorStop(0, '#1f9a57');
  cloth.addColorStop(0.6, '#168048');
  cloth.addColorStop(1, '#0c5a31');
  g.fillStyle = cloth;
  g.fillRect(cx, cy, cw, ch);
  // Felt noise.
  const n = document.createElement('canvas');
  n.width = n.height = 128;
  const ng = n.getContext('2d')!;
  const id = ng.createImageData(128, 128);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = Math.random() * 255;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 14;
  }
  ng.putImageData(id, 0, 0);
  g.fillStyle = g.createPattern(n, 'repeat')!;
  g.fillRect(cx, cy, cw, ch);
  // Cloth markings: logo, foot spot, head string.
  g.save();
  g.translate(t.cx, t.cy);
  if (t.rot) g.rotate(-Math.PI / 2);
  g.font = `${Math.round(s * 0.085)}px 'Lilita One', 'Arial Black', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillText('CORNER POCKET', 0, 0);
  g.restore();
  const fs = P(FOOT_SPOT_X, 0);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath();
  g.arc(fs[0], fs[1], Math.max(1.5, s * 0.006), 0, Math.PI * 2);
  g.fill();
  const h1 = P(HEAD_STRING_X, -HW);
  const h2 = P(HEAD_STRING_X, HW);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(h1[0], h1[1]);
  g.lineTo(h2[0], h2[1]);
  g.stroke();
  // Cushions: the rubber between the cushion nose and the rail.
  g.fillStyle = '#0e6a37';
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1;
  for (const seg of SEGMENTS) {
    const ex = seg.x2 - seg.x1;
    const ey = seg.y2 - seg.y1;
    const len = Math.sqrt(ex * ex + ey * ey);
    // Outward normal (away from the cloth centre).
    let nx = -ey / len;
    let ny = ex / len;
    const mx = (seg.x1 + seg.x2) / 2;
    const my = (seg.y1 + seg.y2) / 2;
    if (nx * mx + ny * my < 0) {
      nx = -nx;
      ny = -ny;
    }
    const d = seg.jaw ? 0.03 : 0.05;
    const taper = seg.jaw ? 0 : 0.045;
    const ux = ex / len;
    const uy = ey / len;
    const pts = [
      P(seg.x1, seg.y1),
      P(seg.x2, seg.y2),
      P(seg.x2 + nx * d + ux * taper, seg.y2 + ny * d + uy * taper),
      P(seg.x1 + nx * d - ux * taper, seg.y1 + ny * d - uy * taper),
    ];
    const grad = g.createLinearGradient(pts[0]![0], pts[0]![1], (pts[3]![0] + pts[2]![0]) / 2, (pts[3]![1] + pts[2]![1]) / 2);
    grad.addColorStop(0, '#13824a');
    grad.addColorStop(1, '#0a4d29');
    g.fillStyle = grad;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    g.stroke();
  }
  // Pocket holes.
  for (const p of POCKETS) {
    const [px, py] = P(p.x, p.y);
    const pr = p.r * s * 0.82;
    const grad = g.createRadialGradient(px, py, pr * 0.2, px, py, pr);
    grad.addColorStop(0, '#000');
    grad.addColorStop(0.85, '#070707');
    grad.addColorStop(1, '#1a1a1a');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(px, py, pr, 0, Math.PI * 2);
    g.fill();
  }
  // Leather pocket rims.
  for (const p of POCKETS) {
    const [px, py] = P(p.x, p.y);
    const pr = p.r * s * 0.82;
    // Leather liner on the rail side only (away from the cloth).
    const a0 = Math.atan2(t.y(p.x, p.y) - t.cy, t.x(p.x, p.y) - t.cx);
    g.lineWidth = Math.max(3, s * 0.016);
    g.strokeStyle = '#140a04';
    g.beginPath();
    g.arc(px, py, pr + g.lineWidth / 2, a0 - 1.75, a0 + 1.75);
    g.stroke();
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(255,200,140,0.25)';
    g.beginPath();
    g.arc(px, py, pr + Math.max(3, s * 0.016) + 1, a0 - 1.7, a0 + 1.7);
    g.stroke();
  }
  // Diamonds (sights).
  const diamond = (wx: number, wy: number) => {
    const [x, y] = P(wx, wy);
    const r = Math.max(2, s * 0.009);
    const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r * 1.2);
    grd.addColorStop(0, '#fffdf2');
    grd.addColorStop(1, '#b8ad92');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x, y - r * 1.3);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r * 1.3);
    g.lineTo(x - r, y);
    g.closePath();
    g.fill();
  };
  const off = 0.065;
  for (const sy of [-1, 1]) for (const k of [1, 2, 3, 5, 6, 7]) diamond(-HL + (TABLE_L * k) / 8, sy * (HW + off));
  for (const sx of [-1, 1]) for (const k of [1, 2, 3]) diamond(sx * (HL + off), -HW + (TABLE_W * k) / 4);
  return c;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------------------------------------------------------------- balls

const TEX_W = 256;
const TEX_H = 128;
const textures = new Map<number, Uint8ClampedArray>();

/** Equirectangular texture: colour / stripe band and the two number circles on the equator. */
function ballTexture(id: number): Uint8ClampedArray {
  const cached = textures.get(id);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const g = c.getContext('2d')!;
  const col = ballColor(id);
  const stripe = id >= 9;
  g.fillStyle = id === 0 || stripe ? '#f6f3ea' : col;
  g.fillRect(0, 0, TEX_W, TEX_H);
  if (stripe) {
    g.fillStyle = col;
    const band = (0.56 / Math.PI) * TEX_H;
    g.fillRect(0, TEX_H / 2 - band, TEX_W, band * 2);
  }
  if (id === 0) {
    // A few red dots so you can see the cue ball's spin.
    g.fillStyle = '#c4161c';
    for (const [lon, lat] of [
      [0, 0],
      [Math.PI / 2, 0],
      [Math.PI, 0],
      [-Math.PI / 2, 0],
      [0, 1.2],
      [0, -1.2],
    ] as Array<[number, number]>) {
      const x = ((lon / (2 * Math.PI) + 0.5) % 1) * TEX_W;
      const y = (0.5 - lat / Math.PI) * TEX_H;
      g.beginPath();
      g.ellipse(x, y, 4.5 / Math.max(0.3, Math.cos(lat)), 4.5, 0, 0, Math.PI * 2);
      g.fill();
      if (lat !== 0) g.fillRect(0, y - 4.5, TEX_W, 9);
    }
  } else {
    const rr = 0.4 * (TEX_W / (2 * Math.PI));
    for (const lon of [0, Math.PI]) {
      const x = (lon / (2 * Math.PI) + 0.5) * TEX_W;
      g.fillStyle = '#fbf9f1';
      g.beginPath();
      g.arc(x % TEX_W, TEX_H / 2, rr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.font = `bold ${Math.round(rr * (id >= 10 ? 1.05 : 1.3))}px 'Nunito', Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(id), x % TEX_W, TEX_H / 2 + 1);
      if (id === 6 || id === 9) g.fillRect((x % TEX_W) - rr * 0.35, TEX_H / 2 + rr * 0.55, rr * 0.7, 2);
    }
  }
  const data = g.getImageData(0, 0, TEX_W, TEX_H).data;
  textures.set(id, data);
  return data;
}

/** A ball's orientation as a quaternion (body → world). */
export type Quat = [number, number, number, number];

export function randomOrientation(): Quat {
  // Number facing up (body x → world z), random spin about the vertical.
  const q1: Quat = [0, -Math.SQRT1_2, 0, Math.SQRT1_2];
  const a = Math.random() * Math.PI * 2;
  const tilt = (Math.random() - 0.5) * 0.8;
  const qz: Quat = [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
  const qx: Quat = [Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2)];
  return qmul(qz, qmul(qx, q1));
}

export function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

/** Rotate by angular velocity ω (world) for dt. */
export function spin(q: Quat, wx: number, wy: number, wz: number, dt: number): Quat {
  const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (w * dt < 1e-6) return q;
  const a = (w * dt) / 2;
  const s = Math.sin(a) / w;
  const r = qmul([wx * s, wy * s, wz * s, Math.cos(a)], q);
  const n = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + r[3] * r[3]);
  return [r[0] / n, r[1] / n, r[2] / n, r[3] / n];
}

const LIGHT = (() => {
  const v = [-0.38, 0.5, 0.78];
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return v.map((x) => x / l) as [number, number, number];
})();

/** Render one ball (px radius r, device pixels) into an ImageData. */
export function renderBall(id: number, q: Quat, r: number, t: Transform, out?: ImageData): ImageData {
  const size = Math.ceil(r * 2) + 2;
  const img = out && out.width === size ? out : new ImageData(size, size);
  const d = img.data;
  const tex = ballTexture(id);
  // Body = q⁻¹ · world: build the inverse rotation matrix.
  const [x, y, z, w] = q;
  const m00 = 1 - 2 * (y * y + z * z);
  const m01 = 2 * (x * y + w * z);
  const m02 = 2 * (x * z - w * y);
  const m10 = 2 * (x * y - w * z);
  const m11 = 1 - 2 * (x * x + z * z);
  const m12 = 2 * (y * z + w * x);
  const m20 = 2 * (x * z + w * y);
  const m21 = 2 * (y * z - w * x);
  const m22 = 1 - 2 * (x * x + y * y);
  const c = size / 2;
  const inv = 1 / r;
  for (let j = 0; j < size; j++) {
    const py = (j + 0.5 - c) * inv;
    for (let i = 0; i < size; i++) {
      const px = (i + 0.5 - c) * inv;
      const d2 = px * px + py * py;
      const o = (j * size + i) * 4;
      if (d2 >= 1.06) {
        d[o + 3] = 0;
        continue;
      }
      const nz = Math.sqrt(Math.max(0, 1 - d2));
      // Screen normal → world normal (portrait rotates the table).
      const [wx, wy] = t.dirToWorld(px, py);
      // Body-space point.
      const bx = m00 * wx + m01 * wy + m02 * nz;
      const by = m10 * wx + m11 * wy + m12 * nz;
      const bz = m20 * wx + m21 * wy + m22 * nz;
      const lat = Math.asin(Math.max(-1, Math.min(1, bz)));
      const lon = Math.atan2(by, bx);
      const tu = Math.min(TEX_W - 1, Math.floor((lon / (2 * Math.PI) + 0.5) * TEX_W));
      const tv = Math.min(TEX_H - 1, Math.floor((0.5 - lat / Math.PI) * TEX_H));
      const ti = (tv * TEX_W + tu) * 4;
      // Lighting in screen space.
      const sx = px;
      const sy = -py;
      const ndl = sx * LIGHT[0] + sy * LIGHT[1] + nz * LIGHT[2];
      const diff = 0.38 + 0.62 * Math.max(0, ndl);
      // Specular (Blinn, view along z).
      const hx = LIGHT[0];
      const hy = LIGHT[1];
      const hz = LIGHT[2] + 1;
      const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
      const ndh = Math.max(0, (sx * hx + sy * hy + nz * hz) / hl);
      const spec = Math.pow(ndh, 70) * 0.95 + Math.pow(ndh, 8) * 0.08;
      const rim = 1 - Math.pow(1 - nz, 3) * 0.35;
      const k = diff * rim;
      d[o] = Math.min(255, tex[ti]! * k + spec * 255);
      d[o + 1] = Math.min(255, tex[ti + 1]! * k + spec * 255);
      d[o + 2] = Math.min(255, tex[ti + 2]! * k + spec * 255);
      d[o + 3] = d2 > 1 ? Math.round(255 * (1 - (d2 - 1) / 0.06)) : 255;
    }
  }
  return img;
}

// ---------------------------------------------------------------- cue stick

/** Draw the cue stick: tip at (tx, ty), pointing along (dx, dy) screen-space unit vector. */
export function drawCue(g: CanvasRenderingContext2D, tx: number, ty: number, dx: number, dy: number, s: number, alpha = 1): void {
  const len = 1.45 * s;
  const tipW = 0.012 * s;
  const buttW = 0.03 * s;
  g.save();
  g.globalAlpha = alpha;
  g.translate(tx, ty);
  g.rotate(Math.atan2(dy, dx) + Math.PI);
  // Shadow.
  g.save();
  g.translate(6, 10);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath();
  g.moveTo(0, -tipW / 2);
  g.lineTo(len, -buttW / 2);
  g.lineTo(len, buttW / 2);
  g.lineTo(0, tipW / 2);
  g.closePath();
  g.fill();
  g.restore();
  const body = (x0: number, x1: number, fill: string | CanvasGradient) => {
    const w0 = tipW + (buttW - tipW) * (x0 / len);
    const w1 = tipW + (buttW - tipW) * (x1 / len);
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(x0, -w0 / 2);
    g.lineTo(x1, -w1 / 2);
    g.lineTo(x1, w1 / 2);
    g.lineTo(x0, w0 / 2);
    g.closePath();
    g.fill();
  };
  const shade = (c1: string, c2: string, w: number) => {
    const gr = g.createLinearGradient(0, -w / 2, 0, w / 2);
    gr.addColorStop(0, c2);
    gr.addColorStop(0.35, c1);
    gr.addColorStop(1, c2);
    return gr;
  };
  body(0, 0.012 * s, shade('#5bb6e8', '#2a6f99', tipW)); // chalked tip
  body(0.012 * s, 0.035 * s, shade('#ffffff', '#c9c4b8', tipW)); // ferrule
  body(0.035 * s, len * 0.58, shade('#f2d9a6', '#b8925a', buttW * 0.7)); // maple shaft
  body(len * 0.58, len * 0.6, shade('#e6e6e6', '#8a8a8a', buttW)); // joint
  body(len * 0.6, len * 0.82, shade('#5a2410', '#2a0e04', buttW)); // forearm
  // Decorative points.
  g.fillStyle = '#e8c070';
  for (let k = 0; k < 4; k++) {
    const x0 = len * 0.6;
    const w = buttW * 0.45;
    g.beginPath();
    g.moveTo(x0 + len * 0.12, (k % 2 ? -1 : 1) * w * 0.25);
    g.lineTo(x0, -w / 2 + (k * w) / 3);
    g.lineTo(x0, -w / 2 + ((k + 1) * w) / 3);
    g.closePath();
    g.fill();
  }
  body(len * 0.82, len * 0.97, shade('#1d1d22', '#050507', buttW)); // wrap
  body(len * 0.97, len, shade('#3a3a40', '#111', buttW)); // butt cap
  g.restore();
}

export const BALL_R = R;
