import { Vector3 } from 'three';
import type { PlayerInput } from '../types/input';
import type { RaceContext, Racer } from '../race/RaceTypes';
import type { ItemSystem } from '../items/ItemSystem';
import { ITEMS } from '../items/ItemTypes';
import { clamp } from '../math/scalar';
import { SeededRandom } from '../math/random';
import type { MoverField } from '../race/Movers';
import type { Pickups } from '../race/Pickups';
import type { RacingLine } from '../track/RacingLine';
import type { DifficultyProfile } from './AIDifficulty';

/** Race view the AI needs: the race context plus the live item world and racing line. */
export interface AIContext extends RaceContext {
  readonly items: ItemSystem;
  readonly racingLine: RacingLine;
  readonly movers: MoverField;
  readonly pickups: Pickups;
}

/** Per-CPU driving style: a difficulty profile plus small personal variations. */
export interface AIPersonality {
  /** Preferred lateral offset from the racing line (m). */
  lane: number;
  lineFollow: number;
  laneWander: number;
  driftSkill: number;
  driftRadius: number;
  cornerPace: number;
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
    driftRadius: profile.driftRadius,
    cornerPace: profile.cornerPace,
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
  /** Lane chosen last tick (keeps obstacle dodges from flip-flopping). */
  private lastLane = 0;
  /** Flat list of threats ahead: [ahead, lateral, half-width, timed] × n. */
  private readonly threats: number[] = [];
  /** Shortcut being approached (index) and whether we're taking it this time. */
  private cutIndex = -1;
  private cutYes = false;
  private cutAhead = Infinity;
  /** Dirt-trail points while cutting through a shortcut. */
  private trail: Vector3[] | null = null;
  private trailIdx = 0;
  /** Shortcuts taken (stats). */
  shortcutsTaken = 0;

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

    // Shortcut in progress: follow the dirt trail instead of the road.
    if (this.followTrail(me, out, speed)) return;

    // Target lateral: racing line blended with a slowly wandering personal lane.
    const look = 8 + speed * 0.55;
    const targetDist = loc.splineDistance + look;
    const ti = this.lineIndex(ctx, targetDist);
    const wander = Math.sin(ctx.time * 0.11 + me.index * 1.7) * p.laneWander;
    let lane = line.lateral[ti]! * p.lineFollow + (p.lane + wander) * (1 - p.lineFollow * 0.6);
    lane += this.trapAvoidance(ctx, me, loc.splineDistance, lane);
    if (p.overtakes) lane += this.trafficAvoidance(ctx, me, loc.splineDistance, lane, speed);
    const box = this.boxLane(ctx, me, loc.splineDistance, lane);
    if (box !== null) lane = box;
    else {
      const coin = this.coinLane(ctx, me, loc.splineDistance, lane);
      if (coin !== null) lane = coin;
    }
    const sample = track.samples[ti]!;
    const cutLane = this.shortcutLane(ctx, me, loc.splineDistance);
    if (cutLane !== null) lane = cutLane;
    const jumpAhead = track.def.jumps.some((jump) => track.wrapDistance(track.startDistance + jump.distance + jump.length - loc.splineDistance + 8) < 85);
    if (jumpAhead) lane = 0;
    // Floating courses have their barriers right at the road edge: keep further in.
    const floating = track.def.space === true;
    const edgeRoom = (sample.open ? 3.2 : cutLane !== null ? 1.2 : 2 + Math.min(1.2, Math.abs(line.curvature[ti]!) * 40)) + (floating && cutLane === null ? 1.3 : 0);
    const lim = Math.max(0, sample.halfWidth - edgeRoom);
    // Obstacles: pick the clearest lane given where everything will be when we arrive.
    const plan = cutLane !== null || jumpAhead ? null : this.planLane(ctx, loc.splineDistance, loc.lateral, lane, speed, look, lim);
    if (plan) lane = plan.lane;
    const avoidingObstacle = plan?.avoiding ?? false;
    lane = clamp(lane, -lim, lim);

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
    const planned = line.speed[this.lineIndex(ctx, loc.splineDistance + speed * 0.8)]! * p.cornerPace;
    if (speed > planned + 1.5) out.throttle = 0;
    if (speed > planned + 5 || (Math.abs(angle) > 0.65 && speed > 20)) out.brake = 0.6;
    // Every lane blocked by a timed obstacle (piston, pendulum…): ease off and let it clear.
    if (plan?.wait && speed > 11) {
      out.throttle = 0;
      if (plan.wait > 1) out.brake = 0.5;
    }
    // Lining up for a shortcut: slow enough to make the turn onto the trail.
    if (cutLane !== null && this.cutAhead < speed * 0.9 + 10 && speed > 18) {
      out.throttle = 0;
      out.brake = 0.6;
    }

    // Drift through corners: decided from the line's curvature a little ahead.
    // Only genuinely tight corners (line radius under ~40–60 m) are worth a drift.
    const k = line.curvature[this.lineIndex(ctx, loc.splineDistance + 12 + speed * 0.3)]!;
    const threshold = 1 / p.driftRadius;
    // Sliding wide of our line towards the outside of the corner → straighten up.
    const hereLat = line.lateral[this.lineIndex(ctx, loc.splineDistance)]! * p.lineFollow;
    const outward = s.drifting ? -(loc.lateral - hereLat) * s.driftDir : 0;
    // Dodging an obstacle or lining up for a shortcut needs free steering: no drift.
    const busy = avoidingObstacle || cutLane !== null;
    // Never start a drift already at the road's edge (it would only carry us onto the grass).
    const onRoad = Math.abs(loc.lateral) < track.samples[loc.index]!.halfWidth - 1.5;
    const wantDrift = allowDrift && !busy && onRoad && p.driftSkill > 0.3 && Math.abs(k) > threshold && speed > 15;
    if (s.drifting && busy) {
      out.drift = false;
    } else if (s.drifting) {
      out.drift = outward < 2.5 && Math.abs(k) > threshold * 0.45 && !(s.driftStage >= 2 && Math.abs(k) < threshold);
      if (outward > 1) out.steer = clamp(s.driftDir * (0.5 + outward * 0.25), -1, 1);
    } else if (wantDrift) {
      out.drift = true;
      out.steer = Math.sign(k) * Math.max(0.6, Math.abs(out.steer));
    } else {
      out.drift = false;
    }

    // No drifting into corners without walls: the slide would carry us over the edge.
    for (let d = 0; d <= 24 && out.drift; d += 3) if (track.samples[track.wrapIndex(ti + d)]!.open) out.drift = false;
    // Edge guard over the void: where will the slide carry us in ~0.45 s? Pull back
    // from any unwalled edge before the wheels leave the deck.
    const here = track.samples[loc.index]!;
    if (here.open && s.grounded) {
      const predicted = loc.lateral + s.velocity.dot(here.flatRight) * 0.45;
      const edge = here.halfWidth - 1.4;
      const side = predicted > edge && !here.wallRight ? 1 : predicted < -edge && !here.wallLeft ? -1 : 0;
      if (side) {
        out.steer = -side;
        out.drift = false;
        out.throttle = 0;
        out.brake = Math.abs(predicted) > here.halfWidth ? 0.8 : 0.3;
      }
    }
    // A drift running off the road (cutting the apex onto the grass, or sliding wide):
    // open up / tighten the arc, and bail out of the drift rather than leave the tarmac.
    if (s.drifting && s.grounded && !here.open) {
      const inside = (loc.lateral + s.velocity.dot(here.flatRight) * 0.5) * s.driftDir;
      const edge = here.halfWidth - 1.2;
      if (inside > edge - 1) out.steer = -s.driftDir;
      else if (-inside > edge - 1) out.steer = s.driftDir;
      if (Math.abs(inside) > edge + 0.6) out.drift = false;
    }
    // Road edges: correct a slide before it reaches the grass / barrier.
    const walled = here.wallLeft || here.wallRight;
    if ((!here.open || walled) && s.grounded && !s.drifting && cutLane === null && speed > 12 && Math.abs(angle) < 1.1) {
      // Also keeps pure pursuit from cutting a tight apex onto the grass.
      const predicted = loc.lateral + s.velocity.dot(here.flatRight) * 0.4;
      const side = Math.sign(predicted);
      const barrier = side > 0 ? here.wallRight : here.wallLeft;
      const margin = floating && barrier ? 1.7 : 0.6;
      if ((!here.open || barrier) && Math.abs(predicted) > here.halfWidth - margin) out.steer = clamp(out.steer - side * 0.5, -1, 1);
    }
    if (jumpAhead || s.jumpFlight) {
      out.drift = s.jumpFlight && s.airTime > 0.2 && !s.jumpTrick;
      if (jumpAhead) { out.throttle = 1; out.brake = 0; }
    }

    // Unstick: back up with opposite lock. Also when facing the wrong way against a
    // wall, where a forward U-turn wouldn't fit (a three-point turn instead).
    if (s.stuckTime > 1.3 && this.reverse <= 0) this.reverse = 1.1;
    if (this.reverse <= 0 && Math.abs(angle) > 1.75 && speed < 14 && s.grounded && Math.abs(loc.lateral) > here.halfWidth - 1.5) this.reverse = 0.9;
    if (this.reverse > 0) {
      this.reverse -= dt;
      out.throttle = 0;
      out.brake = 1;
      out.steer = -out.steer;
      out.drift = false;
    }
  }

  /**
   * Choose a lane: score candidate lanes across the road against every obstacle
   * ahead (static props; moving ones at, just before and just after our arrival
   * time). `wait` > 0 when no lane is clear of a timed obstacle — ease off (1) or
   * brake (2) so it clears before we get there.
   */
  private planLane(ctx: AIContext, splineDistance: number, current: number, want: number, speed: number, look: number, lim: number): { lane: number; avoiding: boolean; wait: number } {
    const track = ctx.track;
    const th = this.threats;
    th.length = 0;
    const reach = look + 26;
    const aheadOf = (d: number): number => {
      const ahead = track.wrapDistance(track.startDistance + d - splineDistance);
      return ahead > track.length - 7 ? ahead - track.length : ahead;
    };
    for (const h of track.def.hazards) {
      const ahead = aheadOf(h.distance);
      if (ahead > -6 && ahead < reach) th.push(ahead, h.lateral ?? 0, h.radius + 2.4, 0);
    }
    const movers = ctx.movers;
    for (let i = 0; i < movers.defs.length; i++) {
      const ahead = aheadOf(movers.distanceOf(i));
      if (ahead < -6 || ahead > reach) continue;
      const arrive = ctx.time + Math.max(0, ahead) / Math.max(8, speed);
      for (const dt of [-0.25, 0, 0.3]) {
        const t = movers.threat(i, arrive + dt);
        if (t) th.push(ahead, t.lateral, t.half, 1);
      }
    }
    if (!th.length) {
      this.lastLane = want;
      return { lane: want, avoiding: false, wait: 0 };
    }
    // Where we'd actually be at each threat if we headed for lane c (sideways speed is limited).
    const blockAt = (c: number): number => {
      let block = 0;
      for (let j = 0; j < th.length; j += 4) {
        const ahead = Math.max(0, th[j]!);
        const shift = 7 * (ahead / Math.max(8, speed)) + 0.5;
        const at = current + clamp(c - current, -shift, shift);
        if (Math.abs(at - th[j + 1]!) < th[j + 2]!) block += 2 - Math.min(1, ahead / reach);
      }
      return block;
    };
    let best = clamp(want, -lim, lim);
    let bestBlock = blockAt(best);
    let bestScore = bestBlock * 50 + Math.abs(best - this.lastLane) * 0.25;
    for (let c = -lim; c <= lim + 1e-6; c += 0.8) {
      const block = blockAt(c);
      const score = block * 50 + Math.abs(c - want) * 0.4 + Math.abs(c - this.lastLane) * 0.25;
      if (score < bestScore) {
        best = c;
        bestBlock = block;
        bestScore = score;
      }
    }
    this.lastLane = best;
    let wait = 0;
    if (bestBlock > 0) {
      // Is the blocker a timed obstacle close enough that slowing down helps?
      for (let j = 0; j < th.length; j += 4) {
        const ahead = th[j]!;
        const at = current + clamp(best - current, -(7 * (Math.max(0, ahead) / Math.max(8, speed)) + 0.5), 7 * (Math.max(0, ahead) / Math.max(8, speed)) + 0.5);
        if (!th[j + 3] || Math.abs(at - th[j + 1]!) >= th[j + 2]!) continue;
        if (ahead > 0 && ahead < speed * 1.4) wait = Math.max(wait, ahead < speed * 0.6 ? 2 : 1);
      }
    }
    return { lane: best, avoiding: Math.abs(best - want) > 0.5, wait };
  }

  /**
   * Shortcuts: skilled CPUs line up with the wall opening and cut through. Returns the
   * lane to hold on the approach (null when not taking one).
   */
  private shortcutLane(ctx: AIContext, me: Racer, splineDistance: number): number | null {
    const p = this.personality;
    const track = ctx.track;
    this.cutAhead = Infinity;
    if (p.driftSkill < 0.45 || me.state.rocketTimer > 0) return null;
    for (let k = 0; k < track.def.shortcuts.length; k++) {
      const sc = track.def.shortcuts[k]!;
      const entry = sc.from + sc.halfWidth + 3;
      const ahead = track.wrapDistance(track.startDistance + entry - splineDistance);
      if (ahead > 80) {
        if (this.cutIndex === k) this.cutIndex = -1;
        continue;
      }
      if (this.cutIndex !== k) {
        this.cutIndex = k;
        this.cutYes = this.rng.next() < (p.driftSkill > 0.85 ? 0.9 : 0.45);
      }
      if (!this.cutYes) return null;
      const side = sc.side === 'left' ? -1 : 1;
      const hw = track.frameAtSplineDistance(track.startDistance + entry).halfWidth;
      this.cutAhead = ahead;
      if (ahead < 9) {
        const sideOut = (sc.toSide ?? sc.side) === 'left' ? -1 : 1;
        const exit = track.anchorToWorld({ distance: sc.to + 10, lateral: sideOut * track.frameAtSplineDistance(track.startDistance + sc.to + 10).halfWidth * 0.4 }).position.clone();
        this.trail = [...track.shortcutPoints(sc, 3), exit];
        this.trailIdx = 0;
        this.cutYes = false;
        this.shortcutsTaken++;
      }
      return side * (hw - 1.2);
    }
    return null;
  }

  /** Pure pursuit along a shortcut's dirt trail; returns false once back on the road. */
  private followTrail(me: Racer, out: PlayerInput, speed: number): boolean {
    const pts = this.trail;
    if (!pts) return false;
    const s = me.state;
    while (this.trailIdx < pts.length - 1 && pts[this.trailIdx]!.distanceToSquared(s.position) > pts[this.trailIdx + 1]!.distanceToSquared(s.position)) this.trailIdx++;
    const lost = pts[this.trailIdx]!.distanceTo(s.position) > 14 || s.respawnTimer > 0 || s.stuckTime > 1;
    if (this.trailIdx >= pts.length - 2 || lost) {
      this.trail = null;
      return false;
    }
    let li = this.trailIdx;
    let acc = 0;
    const look = 6 + speed * 0.35;
    while (li < pts.length - 1 && acc < look) {
      acc += pts[li]!.distanceTo(pts[li + 1]!);
      li++;
    }
    const to = this.tmp.copy(pts[li]!).sub(s.position).setY(0).normalize();
    this.fwd.copy(s.forward).setY(0).normalize();
    this.right.crossVectors(this.fwd, UP).normalize();
    const angle = Math.atan2(to.dot(this.right), to.dot(this.fwd));
    out.steer = clamp(angle * 2.6, -1, 1);
    out.drift = false;
    const cap = Math.abs(angle) > 0.9 ? 13 : Math.abs(angle) > 0.45 ? 19 : 40;
    out.throttle = speed > cap ? 0 : 1;
    out.brake = speed > cap + 4 ? 0.8 : 0;
    return true;
  }

  /** Skilled CPUs with a free item slot line up with the nearest live item box ahead. */
  private boxLane(ctx: AIContext, me: Racer, splineDistance: number, lane: number): number | null {
    const slot = me.slot;
    const full = (slot.item || slot.roulette > 0) && (slot.reserve || slot.reserveRoulette > 0);
    if (this.personality.itemSkill < 0.5 || full || !ctx.pickups) return null;
    const track = ctx.track;
    let best: number | null = null;
    let bestCost = 3.2; // won't swerve further than this for a box
    for (const b of ctx.pickups.boxes) {
      if (b.respawn > 0) continue;
      const ahead = track.wrapDistance(track.startDistance + b.distance - splineDistance);
      if (ahead < 4 || ahead > 45) continue;
      const cost = Math.abs(b.lateral - lane);
      if (cost < bestCost) {
        bestCost = cost;
        best = b.lateral;
      }
    }
    return best;
  }

  /** Coins add top speed: CPUs under the cap drift over to a coin close to their line. */
  private coinLane(ctx: AIContext, me: Racer, splineDistance: number, lane: number): number | null {
    if (me.state.coins >= 10 || this.personality.itemSkill < 0.4 || !ctx.pickups) return null;
    const track = ctx.track;
    let best: number | null = null;
    let bestCost = 1.5 + this.personality.itemSkill * 1.3; // a small swerve, never a detour
    for (const c of ctx.pickups.coins) {
      if (c.respawn > 0) continue;
      const ahead = track.wrapDistance(track.startDistance + c.distance - splineDistance);
      if (ahead < 3 || ahead > 35) continue;
      const cost = Math.abs(c.lateral - lane);
      if (cost < bestCost) {
        bestCost = cost;
        best = c.lateral;
      }
    }
    return best;
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
      if (this.holdTime > 7) release = true;
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
      case 'phantom': {
        // Best when someone ahead has something worth taking, or to slip past a shot.
        const loot = ctx.racers.some((o) => o.progress.position < me.progress.position && (o.slot.item !== null || o.slot.reserve !== null));
        return loot || this.incoming(ctx, me, 30) || this.think < -8 ? press() : false;
      }
      case 'giant':
        return (ahead !== null && ahead.gap < 25) || (straight && this.think < -2) ? press() : false;
      case 'feather': {
        // Hop over an incoming shot or a trap on our line; otherwise just enjoy the jump.
        const trap = this.trapAvoidance(ctx, me, ctx.track.locate(me.state.position, me.state.trackIndex, 8).splineDistance, 0) !== 0;
        return me.state.grounded && (this.incoming(ctx, me, 14) || trap || (straight && this.think < -10)) ? press() : false;
      }
      case 'ember':
      case 'rang':
        this.think = 0.5;
        return press();
      default:
        this.think = 1;
        return press();
    }
  }

  /** A projectile homing on us (or closing from behind) within `range` metres. */
  private incoming(ctx: AIContext, me: Racer, range: number): boolean {
    const p = me.state.position;
    return ctx.items.entities.list.some((e) => {
      if (e.dead || e.attach !== 'none' || e.owner === me.index) return false;
      if (e.kind !== 'seeker' && e.kind !== 'puck' && e.kind !== 'fireball') return false;
      const d = e.position.distanceTo(p);
      if (d > range) return false;
      return e.target === me.index || e.velocity.dot(this.tmp.copy(p).sub(e.position)) > 0;
    });
  }

  private rivalAhead(ctx: RaceContext, me: Racer): { gap: number; aligned: boolean } | null {
    const other = ctx.standings()[me.progress.position - 2];
    if (!other) return null;
    const gap = other.progress.total - me.progress.total;
    const to = this.tmp.copy(other.state.position).sub(me.state.position).setY(0).normalize();
    return { gap, aligned: to.dot(this.fwd) > 0.94 };
  }

  private rivalBehind(ctx: RaceContext, me: Racer): { gap: number } | null {
    const other = ctx.standings()[me.progress.position];
    if (!other) return null;
    return { gap: me.progress.total - other.progress.total };
  }
}
