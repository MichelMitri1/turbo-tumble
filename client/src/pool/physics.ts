/**
 * Pool physics — the classic event model (Leckie & Greenspan) stepped at 1 kHz:
 * every ball slides until its contact point stops slipping, then rolls; side
 * spin decays separately. Ball–ball impacts are near-elastic with a little
 * "throw" friction; cushions bounce with speed loss and pick up english.
 *
 * Deterministic: only + − × ÷ and Math.sqrt (exp/sin/cos are replaced by short
 * polynomials), so the server and every browser replay the exact same shot
 * from the same inputs.
 *
 * Units: metres, seconds. Table origin at the centre, x along the length
 * (head string on the left), y across.
 */
export const R = 0.028575; // 2¼" ball
export const TABLE_L = 1.98; // 7-ft "bar box" playing surface (the classic online-pool look)
export const TABLE_W = 0.99;
const G = 9.81;
const MU_SLIDE = 0.2;
const MU_ROLL = 0.015;
const MU_SPIN = 0.044;
const E_BALL = 0.98;
const E_JAW = 0.45;
const MU_CUSHION = 0.2;
const MU_BALL = 0.06;
/** Side-spin squirt: the cue ball leaves the tip this far (rad) off the aim line at max offset, losing ~10 % speed. */
const SQUIRT = (3 * Math.PI) / 180;
/** A ball still on the table / knocked off it (never a pot; the rules respot it). */
export const ON_TABLE = -1;
export const ESCAPED = -2;
export const DT = 1 / 1000;
export const MAX_CUE_SPEED = 9;
/** Tip offset limit (fraction of R) before a miscue. */
export const MAX_TIP = 0.6;

export interface Pocket {
  /** Centre of the hole (the capture circle). */
  x: number;
  y: number;
  /** Capture radius: the ball drops once its centre is this close and heading in. */
  r: number;
  /** Aim point a little inside the mouth (for bots / guides). */
  ax: number;
  ay: number;
  /** Unit direction into the pocket, and the mouth line's offset from the centre along it (negative = table side). */
  mx: number;
  my: number;
  mouth: number;
  side: boolean;
}
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Pocket jaw facing (softer, deader rubber). */
  jaw?: boolean;
  /** Inside the pocket (its back wall): collides, but isn't drawn. */
  hidden?: boolean;
}

const HL = TABLE_L / 2;
const HW = TABLE_W / 2;
const CORNER_MOUTH = 0.134;
const SIDE_MOUTH = 0.144;
const CC = CORNER_MOUTH / Math.SQRT2;
const SM = SIDE_MOUTH / 2;
const FACE = 0.06;

const CORNER_R = 0.06;
const SIDE_R = 0.045;
const SIDE_DEPTH = 0.05;
const corner = (sx: number, sy: number): Pocket => ({ x: sx * HL, y: sy * HW, r: CORNER_R, ax: sx * (HL - 0.03), ay: sy * (HW - 0.03), mx: sx * Math.SQRT1_2, my: sy * Math.SQRT1_2, mouth: -CC * Math.SQRT1_2, side: false });
const side = (sy: number): Pocket => ({ x: 0, y: sy * (HW + SIDE_DEPTH), r: SIDE_R, ax: 0, ay: sy * (HW - 0.005), mx: 0, my: sy, mouth: -SIDE_DEPTH, side: true });
/** The side pockets sit behind the rail line so a ball rolling along the cushion (y = ±(HW − R)) never drops. */
export const POCKETS: Pocket[] = [corner(-1, 1), side(1), corner(1, 1), corner(-1, -1), side(-1), corner(1, -1)];

/** Cushion noses + pocket jaw facings. */
export const SEGMENTS: Segment[] = (() => {
  const s: Segment[] = [];
  const k = FACE / Math.SQRT2;
  for (const sy of [1, -1]) {
    // Long rails (split by the side pocket).
    s.push({ x1: -HL + CC, y1: sy * HW, x2: -SM, y2: sy * HW });
    s.push({ x1: SM, y1: sy * HW, x2: HL - CC, y2: sy * HW });
    // Side pocket facings (slightly flared).
    s.push({ x1: -SM, y1: sy * HW, x2: -SM + 0.012, y2: sy * (HW + FACE), jaw: true });
    s.push({ x1: SM, y1: sy * HW, x2: SM - 0.012, y2: sy * (HW + FACE), jaw: true });
    // Inside of the side pocket (a ball that skips the hole rattles instead of leaving the table).
    const sb = HW + SIDE_DEPTH + 0.035;
    s.push({ x1: -SM + 0.012, y1: sy * (HW + FACE), x2: -SM + 0.012, y2: sy * sb, jaw: true, hidden: true });
    s.push({ x1: SM - 0.012, y1: sy * (HW + FACE), x2: SM - 0.012, y2: sy * sb, jaw: true, hidden: true });
    s.push({ x1: -SM + 0.012, y1: sy * sb, x2: SM - 0.012, y2: sy * sb, jaw: true, hidden: true });
    // Corner facings on the long rails.
    s.push({ x1: -HL + CC, y1: sy * HW, x2: -HL + CC - k, y2: sy * (HW + k), jaw: true });
    s.push({ x1: HL - CC, y1: sy * HW, x2: HL - CC + k, y2: sy * (HW + k), jaw: true });
  }
  for (const sx of [1, -1]) {
    // Short rails + their corner facings.
    s.push({ x1: sx * HL, y1: -HW + CC, x2: sx * HL, y2: HW - CC });
    s.push({ x1: sx * HL, y1: HW - CC, x2: sx * (HL + k), y2: HW - CC + k, jaw: true });
    s.push({ x1: sx * HL, y1: -HW + CC, x2: sx * (HL + k), y2: -HW + CC - k, jaw: true });
    // Inside of the corner pockets: the jaws run on into a back wall just behind the hole's centre.
    const e = 0.035 / Math.SQRT2;
    for (const sy of [1, -1]) {
      const ax = sx * (HL - CC + k);
      const ay = sy * (HW + k);
      const bx = sx * (HL + k);
      const by = sy * (HW - CC + k);
      s.push({ x1: ax, y1: ay, x2: ax + sx * e, y2: ay + sy * e, jaw: true, hidden: true });
      s.push({ x1: bx, y1: by, x2: bx + sx * e, y2: by + sy * e, jaw: true, hidden: true });
      s.push({ x1: ax + sx * e, y1: ay + sy * e, x2: bx + sx * e, y2: by + sy * e, jaw: true, hidden: true });
    }
  }
  return s;
})();

export const HEAD_STRING_X = -TABLE_L / 4;
export const FOOT_SPOT_X = TABLE_L / 4;

export interface Ball {
  id: number; // 0 = cue, 1–15
  x: number;
  y: number;
  vx: number;
  vy: number;
  wx: number;
  wy: number;
  wz: number;
  /** Pocket index once pocketed (-1 on the table). */
  pocket: number;
}

export type SimEvent =
  | { k: 'ball'; t: number; a: number; b: number; speed: number }
  | { k: 'cushion'; t: number; a: number; speed: number; jaw: boolean }
  | { k: 'pocket'; t: number; a: number; pocket: number; speed: number }
  | { k: 'escape'; t: number; a: number };

export interface ShotInput {
  /** Unit aim direction. */
  dx: number;
  dy: number;
  /** 0..1 of MAX_CUE_SPEED. */
  power: number;
  /** Tip offset (fractions of R): side (+ = right english), vertical (+ = follow). */
  sx: number;
  sy: number;
}

export interface BallRest {
  id: number;
  x: number;
  y: number;
  /** Pocket index once pocketed; ON_TABLE, or ESCAPED (knocked off the table). */
  pocket: number;
}

/**
 * Squirt (cue-ball deflection): side spin pushes the ball off the aim line, away
 * from the tip, and costs a little speed. Returned direction is unit length.
 */
export function squirt(dx: number, dy: number, sx: number, sy: number): { dx: number; dy: number; speed: number } {
  let a = sx;
  let b = sy;
  const m = Math.sqrt(a * a + b * b);
  if (m > MAX_TIP) {
    a = (a / m) * MAX_TIP;
    b = (b / m) * MAX_TIP;
  }
  const f = a / MAX_TIP;
  // Right english (+) → the ball squirts left (counter-clockwise of the aim line).
  const th = SQUIRT * f;
  const c = 1 - (th * th) / 2;
  const s = th - (th * th * th) / 6;
  const x = dx * c - dy * s;
  const y = dx * s + dy * c;
  const l = Math.sqrt(x * x + y * y);
  return { dx: x / l, dy: y / l, speed: 1 - 0.1 * f * f };
}

export class Sim {
  balls: Ball[];
  t = 0;
  events: SimEvent[] = [];
  /** First object ball the cue ball touched (-1 none). */
  firstHit = -1;
  /** Some ball hit a cushion after the first contact. */
  railAfterHit = false;
  /** Balls that hit a cushion during the shot. */
  readonly railed = new Set<number>();

  constructor(rest: BallRest[]) {
    this.balls = rest.map((b) => ({ id: b.id, x: b.x, y: b.y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, pocket: b.pocket }));
  }

  ball(id: number): Ball | undefined {
    return this.balls.find((b) => b.id === id);
  }

  rest(): BallRest[] {
    return this.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, pocket: b.pocket }));
  }

  /** Strike the cue ball. */
  shoot(s: ShotInput): void {
    const cue = this.ball(0)!;
    let a = s.sx;
    let b = s.sy;
    const m = Math.sqrt(a * a + b * b);
    if (m > MAX_TIP) {
      a = (a / m) * MAX_TIP;
      b = (b / m) * MAX_TIP;
    }
    const sq = squirt(s.dx, s.dy, a, b);
    const V = Math.max(0.02, Math.min(1, s.power)) * MAX_CUE_SPEED * sq.speed;
    cue.vx = sq.dx * V;
    cue.vy = sq.dy * V;
    // ω = 5/(2R²) · r × (V d): vertical offset → follow/draw, side → english.
    const k = (5 * V) / (2 * R);
    cue.wx = k * b * -s.dy;
    cue.wy = k * b * s.dx;
    cue.wz = k * a;
  }

  get moving(): boolean {
    for (const b of this.balls) if (b.pocket === ON_TABLE && (b.vx !== 0 || b.vy !== 0 || b.wx !== 0 || b.wy !== 0)) return true;
    return false;
  }

  /** Run until everything stops (or a time cap). */
  runToRest(maxT = 30): void {
    while (this.moving && this.t < maxT) this.step();
    this.settle();
  }

  /** Kill leftover spin once the table has stopped. */
  settle(): void {
    for (const b of this.balls) {
      b.vx = b.vy = b.wx = b.wy = b.wz = 0;
    }
  }

  step(): void {
    const dt = DT;
    this.t += dt;
    for (const b of this.balls) {
      if (b.pocket !== ON_TABLE) continue;
      this.motion(b, dt);
    }
    // Collisions.
    const bs = this.balls;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i]!;
      if (a.pocket !== ON_TABLE) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const c = bs[j]!;
        if (c.pocket !== ON_TABLE) continue;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 4 * R * R && d2 > 0) this.collideBalls(a, c, dx, dy, d2);
      }
      this.collideCushions(a);
      this.checkPockets(a);
    }
  }

  private motion(b: Ball, dt: number): void {
    const speed2 = b.vx * b.vx + b.vy * b.vy;
    // Contact-point slip u = v + ω × (−R ẑ).
    const ux = b.vx - R * b.wy;
    const uy = b.vy + R * b.wx;
    const u = Math.sqrt(ux * ux + uy * uy);
    if (u > 1e-4) {
      const decel = MU_SLIDE * G;
      // Snap to rolling if this step would overshoot.
      if (u <= 3.5 * decel * dt) this.toRolling(b);
      else {
        const ax = (-decel * ux) / u;
        const ay = (-decel * uy) / u;
        b.vx += ax * dt;
        b.vy += ay * dt;
        const k = (5 / (2 * R)) * dt;
        b.wx += k * ay;
        b.wy -= k * ax;
      }
    } else if (speed2 > 0) {
      const speed = Math.sqrt(speed2);
      const dv = MU_ROLL * G * dt;
      if (speed <= dv) {
        b.vx = b.vy = b.wx = b.wy = 0;
      } else {
        const f = (speed - dv) / speed;
        b.vx *= f;
        b.vy *= f;
        b.wx = -b.vy / R;
        b.wy = b.vx / R;
      }
    } else {
      b.wx = b.wy = 0;
    }
    // Side spin decays on its own.
    if (b.wz !== 0) {
      const dw = ((5 * MU_SPIN * G) / (2 * R)) * dt;
      b.wz = Math.abs(b.wz) <= dw ? 0 : b.wz - (b.wz > 0 ? dw : -dw);
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  /** Sliding → rolling, conserving angular momentum about the contact point. */
  private toRolling(b: Ball): void {
    const vx = (5 * b.vx + 2 * R * b.wy) / 7;
    const vy = (5 * b.vy - 2 * R * b.wx) / 7;
    b.vx = vx;
    b.vy = vy;
    b.wx = -vy / R;
    b.wy = vx / R;
  }

  private collideBalls(a: Ball, c: Ball, dx: number, dy: number, d2: number): void {
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    // Separate.
    const push = (2 * R - d) / 2;
    a.x -= nx * push;
    a.y -= ny * push;
    c.x += nx * push;
    c.y += ny * push;
    const vn = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
    if (vn <= 0) return;
    const J = ((1 + E_BALL) / 2) * vn;
    a.vx -= J * nx;
    a.vy -= J * ny;
    c.vx += J * nx;
    c.vy += J * ny;
    // Throw: friction from the contact's tangential slip (side spin + cut); the
    // coefficient falls off with slip speed, μ = 0.06·e^(−|u|/1.5) + 0.01.
    const tx = -ny;
    const ty = nx;
    const ut = (a.vx - c.vx) * tx + (a.vy - c.vy) * ty + R * (a.wz + c.wz);
    const u = (ut < 0 ? -ut : ut) / 1.5;
    const mu = MU_BALL / (1 + u + (u * u) / 2 + (u * u * u) / 6) + 0.01;
    const jt0 = Math.min(mu * J, Math.abs(ut) / 7);
    const jt = ut > 0 ? jt0 : -jt0;
    a.vx -= jt * tx;
    a.vy -= jt * ty;
    c.vx += jt * tx;
    c.vy += jt * ty;
    const kw = (5 / (2 * R)) * jt;
    a.wz -= kw;
    c.wz -= kw;
    if (a.id === 0 && this.firstHit < 0) this.firstHit = c.id;
    else if (c.id === 0 && this.firstHit < 0) this.firstHit = a.id;
    this.events.push({ k: 'ball', t: this.t, a: a.id, b: c.id, speed: vn });
  }

  private collideCushions(b: Ball): void {
    // Only near the edges.
    if (b.x > -HL + R + 0.002 && b.x < HL - R - 0.002 && b.y > -HW + R + 0.002 && b.y < HW - R - 0.002) return;
    for (const s of SEGMENTS) {
      const ex = s.x2 - s.x1;
      const ey = s.y2 - s.y1;
      const l2 = ex * ex + ey * ey;
      let t = ((b.x - s.x1) * ex + (b.y - s.y1) * ey) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = s.x1 + ex * t;
      const py = s.y1 + ey * t;
      const dx = b.x - px;
      const dy = b.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      b.x += nx * (R - d);
      b.y += ny * (R - d);
      const vn = b.vx * nx + b.vy * ny;
      if (vn >= 0) continue;
      // Rubber gets deader the harder it's hit: e = 0.85 − 0.03·|vn|, 0.65..0.9.
      const ec = 0.85 + 0.03 * vn;
      const e = s.jaw ? E_JAW : ec < 0.65 ? 0.65 : ec > 0.9 ? 0.9 : ec;
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
      // English grabs the cushion.
      const tx = -ny;
      const ty = nx;
      const ut = b.vx * tx + b.vy * ty - R * b.wz;
      const jt0 = Math.min(MU_CUSHION * (1 + e) * -vn, Math.abs(ut) / 3.5);
      const jt = ut > 0 ? jt0 : -jt0;
      b.vx -= jt * tx;
      b.vy -= jt * ty;
      b.wz += (5 / (2 * R)) * jt;
      // The nose sits above centre: the roll along the cushion survives, the roll
      // into it doesn't — so the ball comes off a hard rebound sliding (shorter)
      // and running english keeps its bite.
      const wt = b.wx * tx + b.wy * ty;
      b.wx = wt * tx;
      b.wy = wt * ty;
      if (this.firstHit >= 0) this.railAfterHit = true;
      this.railed.add(b.id);
      this.events.push({ k: 'cushion', t: this.t, a: b.id, speed: -vn, jaw: !!s.jaw });
    }
  }

  /**
   * A ball drops once it is past the mouth line and its centre is over the hole —
   * provided it is heading in: a slow ball just falls, a fast one must be lined
   * up with the pocket (corners forgive more than sides) or it bounces between
   * the jaws and may rattle back out.
   */
  private checkPockets(b: Ball): void {
    if (b.x > -HL + 0.03 && b.x < HL - 0.03 && b.y > -HW + 0.03 && b.y < HW - 0.03) return;
    for (let i = 0; i < POCKETS.length; i++) {
      const p = POCKETS[i]!;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const d2 = dx * dx + dy * dy;
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      // A slow ball hanging over the lip tips in from a little further out.
      const r = speed < 0.5 ? p.r + 0.015 : p.r;
      if (d2 >= r * r) continue;
      if (-(dx * p.mx + dy * p.my) < p.mouth) continue;
      const along = b.vx * p.mx + b.vy * p.my;
      const need = p.side ? Math.min(0.95, 0.4 + 0.09 * speed) : Math.min(0.9, 0.3 + 0.07 * speed);
      if (speed > 1 && along < need * speed) continue;
      b.pocket = i;
      b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      this.events.push({ k: 'pocket', t: this.t, a: b.id, pocket: i, speed });
      return;
    }
    // Safety: a ball that somehow left the table is frozen; the rules put it back.
    if (b.x < -HL - 0.08 || b.x > HL + 0.08 || b.y < -HW - 0.08 || b.y > HW + 0.08) {
      b.pocket = ESCAPED;
      b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      this.events.push({ k: 'escape', t: this.t, a: b.id });
    }
  }
}

/** Is a spot free for the cue ball (on the cloth, not touching any ball)? */
export function spotFree(balls: BallRest[], x: number, y: number, ignore = 0): boolean {
  if (x < -HL + R || x > HL - R || y < -HW + R || y > HW - R) return false;
  for (const b of balls) {
    if (b.id === ignore || b.pocket !== ON_TABLE) continue;
    const dx = b.x - x;
    const dy = b.y - y;
    if (dx * dx + dy * dy < 4 * R * R * 1.0001) return false;
  }
  return true;
}

/** First thing the cue ball would hit going along (dx, dy): for aim guides and bots. */
export function castCue(balls: BallRest[], cx: number, cy: number, dx: number, dy: number): { t: number; ball: number; nx: number; ny: number } {
  let best = { t: Infinity, ball: -1, nx: 0, ny: 0 };
  for (const b of balls) {
    if (b.id === 0 || b.pocket !== ON_TABLE) continue;
    // Ray vs circle of radius 2R.
    const ox = cx - b.x;
    const oy = cy - b.y;
    const bq = ox * dx + oy * dy;
    const c = ox * ox + oy * oy - 4 * R * R;
    const disc = bq * bq - c;
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);
    if (t > 0 && t < best.t) {
      const hx = cx + dx * t;
      const hy = cy + dy * t;
      best = { t, ball: b.id, nx: (b.x - hx) / (2 * R), ny: (b.y - hy) / (2 * R) };
    }
  }
  // Cushions (inset by R).
  const lim = [
    [(HL - R - cx) / dx, -1, 0],
    [(-HL + R - cx) / dx, 1, 0],
    [(HW - R - cy) / dy, 0, -1],
    [(-HW + R - cy) / dy, 0, 1],
  ] as const;
  for (const [t, nx, ny] of lim) if (t > 0 && t < best.t) best = { t, ball: -1, nx, ny };
  return best;
}

/** Standard rack: apex on the foot spot, 8 in the middle, one solid + one stripe in the back corners. */
export function rack(rand: () => number): BallRest[] {
  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  const shuffle = <T>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  shuffle(solids);
  shuffle(stripes);
  const cornerSolidLeft = rand() < 0.5;
  // 15 slots: rows 0..4. Slot of 8 = row 2 middle (index 4). Back corners: indices 10 and 14.
  const slots: number[] = new Array(15).fill(0);
  slots[4] = 8;
  slots[10] = cornerSolidLeft ? solids.pop()! : stripes.pop()!;
  slots[14] = cornerSolidLeft ? stripes.pop()! : solids.pop()!;
  const rest = shuffle([...solids, ...stripes]);
  for (let i = 0; i < 15; i++) if (!slots[i]) slots[i] = rest.pop()!;
  const out: BallRest[] = [{ id: 0, x: HEAD_STRING_X, y: 0, pocket: -1 }];
  const gap = 0.0002 + rand() * 0.0003;
  const dxRow = (2 * R + gap) * (Math.sqrt(3) / 2);
  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      out.push({ id: slots[k++]!, x: FOOT_SPOT_X + row * dxRow, y: (j - row / 2) * (2 * R + gap), pocket: -1 });
    }
  }
  return out;
}

export const BOUNDS = { HL, HW };
