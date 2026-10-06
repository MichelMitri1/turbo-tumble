import { Vector3 } from 'three';
import type { MoverDefinition } from '../types/track';
import type { TrackPath } from '../track/TrackPath';
import type { HitKind, KartState } from '../vehicles/KartState';

/** Stomper hang height above the road (m). */
export const STOMPER_HEIGHT = 7.5;
/** Pendulum pivot height and arm length (m). */
export const PENDULUM_PIVOT = 10.5;
export const PENDULUM_ARM = 8.8;
/** Cruiser half-length (m); `size` is its half-width. */
export const CRUISER_HALF_LENGTH = 3.4;
/** Post radius of sweepers (m). */
export const SWEEPER_POST = 0.7;

const KART_R = 1.1;

/** Where a mover is right now (world space) plus a kind-specific state value. */
export interface MoverPose {
  /** Centre of the moving body. */
  position: Vector3;
  /** Road frame at the mover. */
  base: Vector3;
  right: Vector3;
  tangent: Vector3;
  /**
   * stomper: drop height above the road · roller: lateral offset · sweeper / pendulum:
   * angle (rad) · geyser: <0 warning (−1..0), 0..1 eruption · cruiser: lap distance.
   */
  value: number;
  /** stomper: shaking before the drop · geyser: erupting. */
  warning: boolean;
  active: boolean;
  /** Cycle position 0..1. */
  u: number;
}

export interface MoverContact {
  hit: HitKind | null;
  /** Push-out direction (xz) and depth. */
  nx: number;
  nz: number;
  depth: number;
  /** Extra upward kick (geysers). */
  launch: number;
}

const frac = (x: number): number => x - Math.floor(x);
const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * All moving obstacles of a track. Poses are pure functions of race time; the
 * same class drives the authoritative collisions (shared sim) and the visuals.
 */
export class MoverField {
  readonly defs: MoverDefinition[];
  readonly poses: MoverPose[];
  private readonly staticFrames: Array<{ base: Vector3; right: Vector3; tangent: Vector3 }>;

  constructor(private readonly track: TrackPath) {
    this.defs = track.def.movers ?? [];
    this.staticFrames = this.defs.map((d) => {
      const f = track.anchorToWorld({ distance: d.distance, lateral: d.lateral ?? 0 });
      return { base: f.position.clone(), right: f.right.clone().setY(0).normalize(), tangent: f.tangent.clone().setY(0).normalize() };
    });
    this.poses = this.defs.map((_, i) => ({
      position: new Vector3(),
      base: this.staticFrames[i]!.base.clone(),
      right: this.staticFrames[i]!.right.clone(),
      tangent: this.staticFrames[i]!.tangent.clone(),
      value: 0,
      warning: false,
      active: false,
      u: 0,
    }));
  }

  /** Cycle position 0..1 of mover `i` at time `t`. */
  cycle(i: number, t: number): number {
    const d = this.defs[i]!;
    return frac(t / d.period + d.phase);
  }

  /** Recompute every pose for race time `t`. */
  update(t: number): void {
    for (let i = 0; i < this.defs.length; i++) this.pose(i, t, this.poses[i]!);
  }

  pose(i: number, t: number, out: MoverPose): MoverPose {
    const d = this.defs[i]!;
    const u = this.cycle(i, t);
    const fr = this.staticFrames[i]!;
    out.warning = false;
    out.active = false;
    out.u = u;
    if (d.kind !== 'cruiser') {
      out.base.copy(fr.base);
      out.right.copy(fr.right);
      out.tangent.copy(fr.tangent);
    }
    switch (d.kind) {
      case 'stomper': {
        let h = STOMPER_HEIGHT;
        if (u >= 0.5 && u < 0.62) out.warning = true;
        else if (u >= 0.62 && u < 0.68) h = STOMPER_HEIGHT * (1 - ((u - 0.62) / 0.06) ** 2);
        else if (u >= 0.68 && u < 0.86) h = 0;
        else if (u >= 0.86) h = STOMPER_HEIGHT * smooth((u - 0.86) / 0.14);
        out.value = h;
        out.active = h < 2.2;
        out.position.copy(out.base).y += h + d.size;
        break;
      }
      case 'roller': {
        const lat = (d.span ?? 5) * Math.sin(u * Math.PI * 2);
        out.value = lat;
        out.active = true;
        out.position.copy(out.base).addScaledVector(out.right, lat).y += d.size;
        break;
      }
      case 'sweeper': {
        out.value = u * Math.PI * 2 * (d.speed ?? 1);
        out.active = true;
        out.position.copy(out.base).y += 1;
        break;
      }
      case 'pendulum': {
        const a = 1.05 * Math.sin(u * Math.PI * 2);
        out.value = a;
        out.position.copy(out.base).addScaledVector(out.right, Math.sin(a) * PENDULUM_ARM).y += PENDULUM_PIVOT - Math.cos(a) * PENDULUM_ARM;
        out.active = out.position.y - out.base.y < d.size + 2;
        break;
      }
      case 'geyser': {
        out.value = u < 0.55 ? 0 : u < 0.75 ? -(u - 0.55) / 0.2 : u < 0.92 ? 1 : 1 - (u - 0.92) / 0.08;
        out.warning = u >= 0.55 && u < 0.75;
        out.active = u >= 0.75 && u < 0.92;
        out.position.copy(out.base);
        break;
      }
      case 'cruiser': {
        const L = this.track.length;
        const dist = (((d.distance + (d.speed ?? 14) * Math.max(0, t) + d.phase * L) % L) + L) % L;
        const f = this.track.anchorToWorld({ distance: dist, lateral: d.lateral ?? 0 });
        out.base.copy(f.position);
        out.right.copy(f.right).setY(0).normalize();
        out.tangent.copy(f.tangent).setY(0).normalize();
        out.value = dist;
        out.active = true;
        out.position.copy(out.base);
        break;
      }
    }
    return out;
  }

  /** Contact between a kart and mover `i` (pose must be current), or null. */
  contact(i: number, s: KartState, out: MoverContact): MoverContact | null {
    const d = this.defs[i]!;
    const p = this.poses[i]!;
    if (Math.abs(s.position.y - p.base.y) > 6) return null;
    out.hit = null;
    out.launch = 0;
    const dx = s.position.x - p.base.x;
    const dz = s.position.z - p.base.z;
    switch (d.kind) {
      case 'stomper': {
        if (p.value > 2.2) return null;
        const lx = dx * p.right.x + dz * p.right.z;
        const lz = dx * p.tangent.x + dz * p.tangent.z;
        const ex = d.size + KART_R - Math.abs(lx);
        const ez = d.size + KART_R - Math.abs(lz);
        if (ex <= 0 || ez <= 0) return null;
        // Under it as it lands → squished; driving into a block already down → bump.
        if (p.u >= 0.62 && p.u < 0.72) out.hit = 'squish';
        if (ex < ez) this.normal(out, p.right, Math.sign(lx) || 1, ex);
        else this.normal(out, p.tangent, Math.sign(lz) || 1, ez);
        if (out.hit) out.depth = 0;
        return out;
      }
      case 'roller':
      case 'cruiser': {
        const cx = p.position.x - p.base.x;
        const cz = p.position.z - p.base.z;
        const rx = dx - cx;
        const rz = dz - cz;
        if (d.kind === 'roller') {
          const dist = Math.hypot(rx, rz);
          const depth = d.size + KART_R - dist;
          if (depth <= 0) return null;
          out.nx = dist > 1e-4 ? rx / dist : p.tangent.x;
          out.nz = dist > 1e-4 ? rz / dist : p.tangent.z;
          out.depth = depth;
          out.hit = 'tumble';
          return out;
        }
        const lx = rx * p.right.x + rz * p.right.z;
        const lz = rx * p.tangent.x + rz * p.tangent.z;
        const ex = d.size + KART_R - Math.abs(lx);
        const ez = CRUISER_HALF_LENGTH + KART_R - Math.abs(lz);
        if (ex <= 0 || ez <= 0) return null;
        if (ex < ez) this.normal(out, p.right, Math.sign(lx) || 1, ex);
        else this.normal(out, p.tangent, Math.sign(lz) || 1, ez);
        out.hit = 'spin';
        return out;
      }
      case 'sweeper': {
        // Post: solid. Arm: a segment through the post, spinning.
        const post = Math.hypot(dx, dz);
        if (post < SWEEPER_POST + KART_R) {
          out.nx = post > 1e-4 ? dx / post : 1;
          out.nz = post > 1e-4 ? dz / post : 0;
          out.depth = SWEEPER_POST + KART_R - post;
          return out;
        }
        if (post > d.size + KART_R) return null;
        const ax = Math.cos(p.value) * p.tangent.x + Math.sin(p.value) * p.right.x;
        const az = Math.cos(p.value) * p.tangent.z + Math.sin(p.value) * p.right.z;
        const along = dx * ax + dz * az;
        const perp = dx * -az + dz * ax;
        if (Math.abs(along) > d.size || Math.abs(perp) > 0.6 + KART_R) return null;
        const side = Math.sign(perp) || 1;
        out.nx = -az * side;
        out.nz = ax * side;
        out.depth = 0.6 + KART_R - Math.abs(perp);
        out.hit = 'spin';
        return out;
      }
      case 'pendulum': {
        if (!p.active) return null;
        const ky = s.position.y + 0.6;
        const dist = Math.hypot(s.position.x - p.position.x, ky - p.position.y, s.position.z - p.position.z);
        if (dist > d.size + 1.1) return null;
        const h = Math.hypot(s.position.x - p.position.x, s.position.z - p.position.z) || 1;
        out.nx = (s.position.x - p.position.x) / h;
        out.nz = (s.position.z - p.position.z) / h;
        out.depth = 0;
        out.hit = 'tumble';
        return out;
      }
      case 'geyser': {
        if (!p.active || Math.hypot(dx, dz) > d.size + KART_R * 0.6) return null;
        out.nx = out.nz = out.depth = 0;
        out.hit = 'tumble';
        out.launch = 11;
        return out;
      }
    }
  }

  private normal(out: MoverContact, axis: Vector3, sign: number, depth: number): void {
    out.nx = axis.x * sign;
    out.nz = axis.z * sign;
    out.depth = depth;
  }

  /**
   * For the AI: the stretch of road (lateral centre ± half) mover `i` blocks at
   * time `t`, or null when it's safe to drive through.
   */
  threat(i: number, t: number): { lateral: number; half: number } | null {
    const d = this.defs[i]!;
    const u = this.cycle(i, t);
    const lat = d.lateral ?? 0;
    switch (d.kind) {
      case 'stomper':
        return u > 0.48 && u < 0.9 ? { lateral: lat, half: d.size + 1.6 } : null;
      case 'roller':
        return { lateral: lat + (d.span ?? 5) * Math.sin(u * Math.PI * 2), half: d.size + 1.8 };
      case 'sweeper':
        return { lateral: lat, half: d.size + 2 };
      case 'pendulum': {
        const a = 1.05 * Math.sin(u * Math.PI * 2);
        return Math.cos(a) > 0.62 ? { lateral: lat + Math.sin(a) * PENDULUM_ARM, half: d.size + 1.8 } : null;
      }
      case 'geyser':
        return u > 0.58 && u < 0.95 ? { lateral: lat, half: d.size + 1.6 } : null;
      case 'cruiser':
        return { lateral: lat, half: d.size + 1.8 };
    }
  }

  /** Lap distance of mover `i` (cruisers move). */
  distanceOf(i: number): number {
    const d = this.defs[i]!;
    return d.kind === 'cruiser' ? this.poses[i]!.value : d.distance;
  }

  /** Push a kart out of a solid contact (and stop it driving further in). */
  static pushOut(s: KartState, c: MoverContact): void {
    if (c.depth <= 0) return;
    s.position.x += c.nx * c.depth;
    s.position.z += c.nz * c.depth;
    const vn = s.velocity.x * c.nx + s.velocity.z * c.nz;
    if (vn < 0) {
      s.velocity.x -= 1.4 * vn * c.nx;
      s.velocity.z -= 1.4 * vn * c.nz;
    }
  }
}
