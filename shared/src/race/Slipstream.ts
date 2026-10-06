import { isStunned } from '../vehicles/KartState';
import type { TrackPath } from '../track/TrackPath';
import type { Racer } from './RaceTypes';

export const SLIPSTREAM_CHARGE = 1.2;

/** Shared by authoritative races and local prediction. Returns true on boost release. */
export function stepSlipstream(me: Racer, racers: readonly Racer[], track: TrackPath, dt: number): boolean {
  const s = me.state;
  s.slipstreamTimer = Math.max(0, s.slipstreamTimer - dt);
  s.slipstreamCooldown = Math.max(0, s.slipstreamCooldown - dt);
  if (!s.grounded || s.forwardSpeed < 12 || isStunned(s) || s.respawnTimer > 0 || s.rocketTimer > 0 || me.progress.finished) {
    s.slipstreamCharge = 0;
    if (isStunned(s) || s.respawnTimer > 0) s.slipstreamTimer = 0;
    return false;
  }
  if (s.slipstreamCooldown > 0) { s.slipstreamCharge = 0; return false; }
  const drafting = racers.some((other) => {
    const o = other.state;
    if (other === me || !o.grounded || o.forwardSpeed < 10 || other.progress.finished || o.respawnTimer > 0 || isStunned(o)) return false;
    if (s.trackIndex < 0 || o.trackIndex < 0 || track.wrapDistance((o.trackIndex - s.trackIndex) * track.spacing) > 40) return false;
    const dx = o.position.x - s.position.x;
    const dz = o.position.z - s.position.z;
    const forward = dx * o.forward.x + dz * o.forward.z;
    const lateral = Math.abs(dx * o.forward.z - dz * o.forward.x);
    return forward > 4 && forward < 28 && lateral < 2.4 + forward * 0.025 && Math.abs(o.position.y - s.position.y) < 2.5 && s.forward.dot(o.forward) > 0.92;
  });
  s.slipstreamCharge = drafting ? Math.min(SLIPSTREAM_CHARGE, s.slipstreamCharge + dt) : Math.max(0, s.slipstreamCharge - dt * 2.5);
  if (s.slipstreamCharge < SLIPSTREAM_CHARGE) return false;
  s.slipstreamCharge = 0;
  s.slipstreamTimer = 2;
  s.slipstreamCooldown = 3.5;
  me.sim.giveBoost(2, 8);
  return true;
}
