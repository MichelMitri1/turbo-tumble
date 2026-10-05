import { Vector3 } from 'three';
import type { PlayerInput } from '../types/input';
import type { RaceContext, Racer } from '../race/RaceTypes';
import type { ItemSystem } from '../items/ItemSystem';
import { ITEMS } from '../items/ItemTypes';
import { clamp } from '../math/scalar';
import { SeededRandom } from '../math/random';
import type { RacingLine } from '../track/RacingLine';
import type { DifficultyProfile } from './AIDifficulty';

/** Race view the AI needs: the race context plus the live item world and racing line. */
export interface AIContext extends RaceContext {
  readonly items: ItemSystem;
  readonly racingLine: RacingLine;
}

/** Per-CPU driving style: a difficulty profile plus small personal variations. */
export interface AIPersonality {
  /** Preferred lateral offset from the racing line (m). */
  lane: number;
  lineFollow: number;
  laneWander: number;
  driftSkill: number;
  itemSkill: number;
  itemDelay: number;
  steerGain: number;
  overtakes: boolean;
}

export function personalityFor(profile: DifficultyProfile, rng: SeededRandom): AIPersonality {
  return {
    lane: rng.range(-2.5, 2.5),
    lineFollow: clamp(profile.lineFollow + rng.range(-0.1, 0.1), 0, 1),
    laneWander: profile.laneWander,
    driftSkill: clamp(profile.driftSkill + rng.range(-0.15, 0.15), 0, 1),
    itemSkill: clamp(profile.itemSkill + rng.range(-0.15, 0.15), 0, 1),
    itemDelay: profile.itemDelay,
    steerGain: profile.steerGain,
    overtakes: profile.overtakes,
  };
}

const UP = new Vector3(0, 1, 0);

/**
 * CPU racer: pursues a target on the racing line (blended with a personal lane),
 * plans speed from the line's speed profile, steers around traps and slower karts,
 * drifts through corners for mini-turbos and uses items situationally.
 */
export class AIDriver {
  private readonly rng: SeededRandom;
  private think = 0;
  private holding = false;
  private holdTime = 0;
  private pulse = false;
  private reverse = 0;
  private readonly fwd = new Vector3();
  private readonly right = new Vector3();
  private readonly tmp = new Vector3();

  constructor(
    seed: number,
    readonly personality: AIPersonality,
  ) {
    this.rng = new SeededRandom(seed);
  }

  private lineIndex(ctx: AIContext, splineDistance: number): number {
    return Math.floor(ctx.track.wrapDistance(splineDistance) / ctx.track.spacing) % ctx.track.samples.length;
  }

  /** Driving only (also used for autopilot: finished racers, Jet Rocket). */
  drive(ctx: AIContext, me: Racer, out: PlayerInput, dt: number, allowDrift = true): void {
    const s = me.state;
    const p = this.personality;
    const track = ctx.track;
    const line = ctx.racingLine;
    const loc = track.locate(s.position, s.trackIndex, 8);
    const speed = Math.max(0, s.forwardSpeed);

    // Target lateral: racing line blended with a slowly wandering personal lane.
    const look = 8 + speed * 0.55;
    const targetDist = loc.splineDistance + look;
    const ti = this.lineIndex(ctx, targetDist);
    const wander = Math.sin(ctx.time * 0.11 + me.index * 1.7) * p.laneWander;
    let lane = line.lateral[ti]! * p.lineFollow + (p.lane + wander) * (1 - p.lineFollow * 0.6);
    lane += this.trapAvoidance(ctx, me, loc.splineDistance, lane);
    if (p.overtakes) lane += this.trafficAvoidance(ctx, me, loc.splineDistance, lane, speed);
    const sample = track.samples[ti]!;
    // Commit to a clear side until the kart has passed the obstacle. Apply after
    // overtaking so traffic cannot steer us back into a solid road prop.
    let avoidingObstacle = false;
    let nearest = Infinity;
    for (const hazard of track.def.hazards) {
      let ahead = track.wrapDistance(track.startDistance + hazard.distance - loc.splineDistance);
      if (ahead > track.length - 7) ahead -= track.length;
      if (ahead < -7 || ahead > look + 24 || ahead >= nearest) continue;
      const lateral = hazard.lateral ?? 0;
      const clearance = hazard.radius + 2.6;
      if (Math.abs(lane - lateral) >= clearance) continue;
      const width = Math.min(sample.halfWidth, track.frameAtSplineDistance(track.startDistance + hazard.distance).halfWidth) - 2;
      const left = lateral - clearance;
      const right = lateral + clearance;
      lane = left < -width ? right : right > width ? left : lateral > 0 ? left : right;
      nearest = ahead;
      avoidingObstacle = true;
    }
    lane = clamp(lane, -sample.halfWidth + 2, sample.halfWidth - 2);

    const f = track.frameAtSplineDistance(targetDist);
    const target = this.tmp.copy(f.position).addScaledVector(f.right, lane);
    const to = target.sub(s.position).setY(0).normalize();
    this.fwd.copy(s.forward).setY(0).normalize();
    this.right.crossVectors(this.fwd, UP).normalize();
    const angle = Math.atan2(to.dot(this.right), to.dot(this.fwd));

    out.steer = clamp(angle * 2.5 * p.steerGain, -1, 1);
    out.throttle = 1;
    out.brake = 0;

    // Speed planning from the racing line's profile (braking zones on tight tracks).
    const planned = line.speed[this.lineIndex(ctx, loc.splineDistance + speed * 0.8)]!;
    if (speed > planned + 1.5) out.throttle = 0;
    if (speed > planned + 5 || (Math.abs(angle) > 0.65 && speed > 20)) out.brake = 0.6;

    // Drift through corners: decided from the line's curvature a little ahead.
    // Only genuinely tight corners (line radius under ~40–60 m) are worth a drift.
    const k = line.curvature[this.lineIndex(ctx, loc.splineDistance + 12 + speed * 0.3)]!;
    const threshold = 1 / (38 + 22 * p.driftSkill);
    // Sliding wide of our line towards the outside of the corner → straighten up.
    const hereLat = line.lateral[this.lineIndex(ctx, loc.splineDistance)]! * p.lineFollow;
    const outward = s.drifting ? -(loc.lateral - hereLat) * s.driftDir : 0;
    const wantDrift = allowDrift && p.driftSkill > 0.3 && Math.abs(k) > threshold && speed > 15;
    if (s.drifting) {
      out.drift = outward < 2.5 && Math.abs(k) > threshold * 0.45 && !(s.driftStage >= 2 && Math.abs(k) < threshold);
      if (outward > 1) out.steer = clamp(s.driftDir * (0.5 + outward * 0.25), -1, 1);
    } else if (wantDrift) {
      out.drift = true;
      out.steer = Math.sign(k) * Math.max(0.6, Math.abs(out.steer));
    } else {
      out.drift = false;
    }

    if (avoidingObstacle) out.drift = false;

    // Unstick: back up with opposite lock.
    if (s.stuckTime > 1.3 && this.reverse <= 0) this.reverse = 1.1;
    if (this.reverse > 0) {
      this.reverse -= dt;
      out.throttle = 0;
      out.brake = 1;
      out.steer = -out.steer;
      out.drift = false;
    }
  }

  /** Lateral nudge away from traps sitting on our line ahead. */
  private trapAvoidance(ctx: AIContext, me: Racer, splineDistance: number, lane: number): number {
    for (const e of ctx.items.entities.list) {
      if (e.dead || e.attach !== 'none' || !(e.kind === 'goo' || e.kind === 'decoy' || e.kind === 'boom')) continue;
      const loc = ctx.track.locate(e.position, e.trackIndex >= 0 ? e.trackIndex : me.state.trackIndex, 20);
      const ahead = ctx.track.wrapDistance(loc.splineDistance - splineDistance);
      if (ahead > 4 && ahead < 32 && Math.abs(loc.lateral - lane) < 2.8) return loc.lateral > lane ? -4 : 4;
    }
    return 0;
  }

  /** Pull out to pass slower karts on our line just ahead. */
  private trafficAvoidance(ctx: AIContext, me: Racer, splineDistance: number, lane: number, speed: number): number {
    for (const o of ctx.racers) {
      if (o === me) continue;
      const loc = ctx.track.locate(o.state.position, o.state.trackIndex, 6);
      const ahead = ctx.track.wrapDistance(loc.splineDistance - splineDistance);
      if (ahead < 2 || ahead > 15) continue;
      if (Math.abs(loc.lateral - lane) > 2.6 || o.state.forwardSpeed > speed + 0.5) continue;
      return loc.lateral > lane ? -3.3 : 3.3;
    }
    return 0;
  }

  /** Full CPU control: driving + item use. */
  compute(ctx: AIContext, me: Racer, out: PlayerInput, dt: number): void {
    this.drive(ctx, me, out, dt);
    out.item = this.decideItem(ctx, me, out, dt);
  }

  private decideItem(ctx: AIContext, me: Racer, out: PlayerInput, dt: number): boolean {
    const slot = me.slot;
    if (this.pulse) {
      this.pulse = false;
      return this.holding;
    }
    if (!slot.item || slot.roulette > 0) {
      this.holding = false;
      this.think = this.personality.itemDelay * (0.5 + this.rng.next()) + this.rng.next() * (1.2 - this.personality.itemSkill);
      return false;
    }
    this.think -= dt;
    const def = ITEMS[slot.item];
    const ahead = this.rivalAhead(ctx, me);
    const behind = this.rivalBehind(ctx, me);
    const straight = Math.abs(out.steer) < 0.25 && me.state.grounded;
    const press = (): boolean => {
      this.pulse = true;
      return true;
    };

    if (def.use === 'hold') {
      if (!this.holding) {
        if (this.think > 0) return false;
        this.holding = true;
        this.holdTime = 0;
        return true;
      }
      this.holdTime += dt;
      let release = false;
      if (slot.item === 'seeker') release = ahead !== null && ahead.gap < 160;
      else if (slot.item === 'puck' || slot.item === 'boomBall') release = ahead !== null && ahead.gap < 34 && ahead.aligned;
      else release = behind !== null && behind.gap < 14;
      if (behind !== null && behind.gap < 8 && (slot.item === 'puck' || slot.item === 'seeker')) {
        out.brake = 1; // throw backwards
        release = true;
      }
      if (this.holdTime > 14) release = true;
      if (release) this.holding = false;
      return !release;
    }

    if (this.think > 0) return false;
    switch (slot.item) {
      case 'fizz':
      case 'fizz3':
      case 'fizzGold':
      case 'coin':
      case 'prism':
      case 'jetRocket':
        return straight ? press() : false;
      case 'horn': {
        const crown = ctx.items.entities.list.some(
          (e) => e.kind === 'crown' && e.target === me.index && e.position.distanceTo(me.state.position) < 35,
        );
        return crown || (behind && behind.gap < 7) || (ahead && ahead.gap < 7) ? press() : false;
      }
      case 'puck3':
      case 'seeker3':
      case 'goo3':
      case 'octo':
        if (slot.orbit.length === 0) return press();
        this.think = 1.2 + this.rng.next() * 1.5;
        return ahead || behind ? press() : false;
      case 'snapper':
        return slot.timer === 0 || (ahead !== null && ahead.gap < 10) ? press() : false;
      case 'ember':
      case 'rang':
        this.think = 0.5;
        return press();
      default:
        this.think = 1;
        return press();
    }
  }

  private rivalAhead(ctx: RaceContext, me: Racer): { gap: number; aligned: boolean } | null {
    const other = ctx.standings()[me.progress.position - 2];
    if (!other) return null;
    const gap = other.progress.total - me.progress.total;
    const to = other.state.position.clone().sub(me.state.position).setY(0).normalize();
    return { gap, aligned: to.dot(this.fwd) > 0.94 };
  }

  private rivalBehind(ctx: RaceContext, me: Racer): { gap: number } | null {
    const other = ctx.standings()[me.progress.position];
    if (!other) return null;
    return { gap: me.progress.total - other.progress.total };
  }
}
