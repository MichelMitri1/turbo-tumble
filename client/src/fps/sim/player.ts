import type { Level } from './level';

/** One tick of player intent (the same struct goes over the network). */
export interface Input {
  seq: number;
  /** Strafe (+right) and forward (+forward), −1..1. */
  mx: number;
  mz: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  ads: boolean;
  fire: boolean;
  reload: boolean;
  /** Weapon slot wanted (0 primary, 1 secondary, -1 no change). */
  slot: number;
  /** Lethal: hold to cook (frag), release to throw. */
  grenade: boolean;
  /** Tactical: throw on press. */
  tactical: boolean;
  melee: boolean;
  /** Killstreak to call in: −1 none, 0–2 that slot, 3 the next ready one. */
  streak: number;
  /** Zombies: the use button, held (buy / rebuild / revive). */
  use?: boolean;
}

export const NO_INPUT: Input = { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, sprint: false, crouch: false, ads: false, fire: false, reload: false, slot: -1, grenade: false, tactical: false, melee: false, streak: -1 };

export const P = {
  radius: 0.34,
  height: 1.8,
  crouchHeight: 1.15,
  eye: 1.62,
  crouchEye: 1.0,
  walk: 5.2,
  sprint: 7.6,
  crouchSpeed: 2.6,
  adsMul: 0.55,
  accel: 55,
  airAccel: 9,
  gravity: 19,
  jump: 6.2,
  step: 0.55,
  slideTime: 0.85,
  slideSpeed: 10,
};

export interface MoveState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  crouched: boolean;
  /** Seconds of slide left. */
  slide: number;
  sprinting: boolean;
  /** Last frame's crouch button (edge detection). */
  lastCrouch: boolean;
  lastJump: boolean;
}

export function newMove(x: number, y: number, z: number, yaw: number): MoveState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, onGround: true, crouched: false, slide: 0, sprinting: false, lastCrouch: false, lastJump: false };
}

export function height(m: MoveState): number {
  return m.crouched || m.slide > 0 ? P.crouchHeight : P.height;
}
export function eyeHeight(m: MoveState): number {
  return m.slide > 0 ? 0.8 : m.crouched ? P.crouchEye : P.eye;
}

/**
 * Advance movement one tick. `speedMul` folds in the weapon / perk / ADS speed.
 * `canSprint` is false while ADS, reloading with a pistol, etc.
 */
export function stepMove(level: Level, m: MoveState, inp: Input, dt: number, speedMul: number, canSprint: boolean, adsAmount: number): void {
  m.yaw = inp.yaw;
  m.pitch = Math.max(-1.45, Math.min(1.45, inp.pitch));
  const crouchEdge = inp.crouch && !m.lastCrouch;
  m.lastCrouch = inp.crouch;
  // Sprint: forward only, not crouched.
  const wantSprint = inp.sprint && inp.mz > 0.3 && canSprint && !m.crouched;
  // Slide: crouch while sprinting.
  if (crouchEdge && m.sprinting && m.onGround && m.slide <= 0) {
    m.slide = P.slideTime;
    const f = Math.max(P.slideSpeed, Math.sqrt(m.vx * m.vx + m.vz * m.vz) * 1.15);
    m.vx = Math.sin(m.yaw) * -f;
    m.vz = Math.cos(m.yaw) * -f;
    m.crouched = true;
  } else if (crouchEdge && m.slide <= 0) {
    if (m.crouched) {
      if (canStand(level, m)) m.crouched = false;
    } else m.crouched = true;
  }
  m.sprinting = wantSprint && m.slide <= 0;
  if (m.sprinting && m.crouched && canStand(level, m)) m.crouched = false;
  // Desired velocity (yaw 0 looks down −z, like a three.js camera).
  const sy = Math.sin(m.yaw);
  const cy = Math.cos(m.yaw);
  let mx = inp.mx;
  let mz = inp.mz;
  const ml = Math.sqrt(mx * mx + mz * mz);
  if (ml > 1) {
    mx /= ml;
    mz /= ml;
  }
  // forward = (−sin yaw, −cos yaw); right = (cos yaw, −sin yaw)
  const wx = -sy * mz + cy * mx;
  const wz = -cy * mz - sy * mx;
  let speed = m.sprinting ? P.sprint : m.crouched ? P.crouchSpeed : P.walk;
  speed *= speedMul * (1 - adsAmount * (1 - P.adsMul));
  if (m.slide > 0) {
    m.slide -= dt;
    // Slides keep their momentum and bleed speed.
    const k = Math.exp(-dt * 1.6);
    m.vx *= k;
    m.vz *= k;
    if (m.slide <= 0 && !canStand(level, m)) m.crouched = true;
  } else {
    const tx = wx * speed;
    const tz = wz * speed;
    const a = (m.onGround ? P.accel : P.airAccel) * dt;
    const dvx = tx - m.vx;
    const dvz = tz - m.vz;
    const dl = Math.sqrt(dvx * dvx + dvz * dvz);
    if (dl <= a) {
      m.vx = tx;
      m.vz = tz;
    } else {
      m.vx += (dvx / dl) * a;
      m.vz += (dvz / dl) * a;
    }
  }
  // Jump (slide-cancel jumps too).
  if (inp.jump && !m.lastJump && m.onGround) {
    m.vy = P.jump;
    m.onGround = false;
    if (m.slide > 0) m.slide = 0;
    if (m.crouched && canStand(level, m)) m.crouched = false;
  }
  m.lastJump = inp.jump;
  m.vy -= P.gravity * dt;
  moveAxis(level, m, 'x', m.vx * dt);
  moveAxis(level, m, 'z', m.vz * dt);
  m.onGround = false;
  moveAxis(level, m, 'y', m.vy * dt);
}

function canStand(level: Level, m: MoveState): boolean {
  const r = P.radius;
  return !level.blocked(m.x - r, m.y + P.crouchHeight, m.z - r, m.x + r, m.y + P.height, m.z + r);
}

const tmp: import('./level').Box[] = [];

function moveAxis(level: Level, m: MoveState, axis: 'x' | 'y' | 'z', d: number): void {
  if (d === 0 && axis !== 'y') return;
  const r = P.radius;
  const h = height(m);
  if (axis === 'x') m.x += d;
  else if (axis === 'z') m.z += d;
  else m.y += d;
  const x0 = m.x - r;
  const x1 = m.x + r;
  const z0 = m.z - r;
  const z1 = m.z + r;
  for (const b of level.query(x0, z0, x1, z1, tmp)) {
    if (!(x1 > b.x0 && x0 < b.x1 && m.y + h > b.y0 && m.y < b.y1 && z1 > b.z0 && z0 < b.z1)) continue;
    if (axis === 'y') {
      if (d <= 0) {
        m.y = b.y1;
        m.vy = 0;
        m.onGround = true;
      } else {
        m.y = b.y0 - h;
        m.vy = 0;
      }
      continue;
    }
    // Step up onto low obstacles (stairs, curbs) when walking.
    const rise = b.y1 - m.y;
    if (rise > 0 && rise <= P.step && m.vy <= 0.5 && !level.blocked(x0, b.y1 + 0.01, z0, x1, b.y1 + h, z1)) {
      m.y = b.y1;
      continue;
    }
    if (axis === 'x') {
      m.x = d > 0 ? b.x0 - r - 1e-4 : b.x1 + r + 1e-4;
      m.vx = 0;
    } else {
      m.z = d > 0 ? b.z0 - r - 1e-4 : b.z1 + r + 1e-4;
      m.vz = 0;
    }
    return;
  }
  if (axis === 'y' && m.y <= 0) {
    m.y = 0;
    if (m.vy < 0) m.vy = 0;
    m.onGround = true;
  }
}
