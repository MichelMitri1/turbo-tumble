import { Vector3 } from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY } from '../constants/simulation';
import { clamp, dampFactor } from '../math/scalar';
import type { MoveResult } from '../physics/PhysicsWorld';
import type { RaceContext, Racer } from '../race/RaceTypes';
import { v3 } from '../race/RaceTypes';
import { isInvulnerable, type HitKind } from '../vehicles/KartState';
import type { ItemId } from './ItemTypes';

export type EntityKind = 'puck' | 'seeker' | 'crown' | 'goo' | 'decoy' | 'boom' | 'fireball' | 'rang' | 'explosion' | 'octo';
export type Attachment = 'none' | 'held' | 'orbit' | 'trail';

export interface ItemEntity {
  id: number;
  kind: EntityKind;
  /** For octo orbs: which item this orb represents. */
  item: ItemId | null;
  position: Vector3;
  velocity: Vector3;
  owner: number;
  age: number;
  life: number;
  radius: number;
  attach: Attachment;
  slotIndex: number;
  target: number;
  splineDistance: number;
  trackIndex: number;
  bounces: number;
  phase: number;
  phaseTime: number;
  /** Racers already hit (explosions and boomerangs hit each racer once). */
  hits: number[];
  dead: boolean;
}

const RADIUS: Record<EntityKind, number> = {
  puck: 0.7,
  seeker: 0.7,
  crown: 1.0,
  goo: 0.9,
  decoy: 1.0,
  boom: 0.8,
  fireball: 0.55,
  rang: 0.9,
  explosion: 1,
  octo: 0.6,
};

const KART_HIT_RADIUS = 1.25;
export const PUCK_SPEED = 46;
const SEEKER_SPEED = 50;
const CROWN_SPEED = 115;
export const FIREBALL_SPEED = 40;
const RANG_SPEED = 44;
const EXPLOSION_LIFE = 0.6;

const UP = new Vector3(0, 1, 0);

/**
 * Live item objects in the world and their collisions with karts and each other.
 * Deterministic: driven only by the race context, fixed dt and the seeded RNG.
 */
export class ItemEntities {
  readonly list: ItemEntity[] = [];
  private nextId = 1;
  private readonly probe: RAPIER.Collider;
  private readonly move: MoveResult = { movement: new Vector3(), contacts: [] };
  private readonly t1 = new Vector3();
  private readonly t2 = new Vector3();

  constructor(private readonly ctx: RaceContext) {
    this.probe = ctx.physics.createProbeCollider(0.5);
  }

  dispose(): void {
    this.ctx.physics.removeCollider(this.probe);
    this.list.length = 0;
  }

  byId(id: number): ItemEntity | undefined {
    return this.list.find((e) => e.id === id && !e.dead);
  }

  spawn(kind: EntityKind, owner: number, position: Vector3, velocity: Vector3, opts: Partial<ItemEntity> = {}): ItemEntity {
    const e: ItemEntity = {
      id: this.nextId++,
      kind,
      item: null,
      position: position.clone(),
      velocity: velocity.clone(),
      owner,
      age: 0,
      life: 0,
      radius: RADIUS[kind],
      attach: 'none',
      slotIndex: 0,
      target: -1,
      splineDistance: 0,
      trackIndex: -1,
      bounces: 0,
      phase: 0,
      phaseTime: 0,
      hits: [],
      dead: false,
      ...opts,
    };
    this.list.push(e);
    return e;
  }

  kill(e: ItemEntity, poof = true): void {
    if (e.dead) return;
    e.dead = true;
    if (poof && e.kind !== 'explosion') this.ctx.emit({ type: 'entityGone', kind: e.kind, position: v3(e.position) });
  }

  /** `breaksGiant`: a Crown Buster blast also cuts a Giant down to size (then hits normally). */
  explode(at: Vector3, owner: number, radius: number, breaksGiant = false): void {
    if (breaksGiant) for (const r of this.ctx.racers) if (r.state.position.distanceTo(at) <= radius + KART_HIT_RADIUS) r.state.megaTimer = 0;
    this.spawn('explosion', owner, at, new Vector3(), { life: EXPLOSION_LIFE, radius });
    this.ctx.emit({ type: 'explosion', position: v3(at), radius, owner });
  }

  /** Release an attached entity into the world as a moving item. */
  launch(e: ItemEntity, racer: Racer, backward: boolean): void {
    const s = racer.state;
    const fwd = this.t1.copy(s.forward).setY(0).normalize();
    const dir = backward ? -1 : 1;
    e.attach = 'none';
    e.age = 0;
    e.position.copy(s.position).addScaledVector(fwd, dir * 2.8).addScaledVector(UP, 0.6);
    e.trackIndex = s.trackIndex;
    const kartSpeed = Math.max(0, s.forwardSpeed);
    switch (e.kind) {
      case 'puck':
        e.velocity.copy(fwd).multiplyScalar(backward ? -PUCK_SPEED * 0.75 : PUCK_SPEED + kartSpeed * 0.3);
        e.life = 9;
        break;
      case 'seeker': {
        e.velocity.copy(fwd).multiplyScalar(backward ? -PUCK_SPEED * 0.75 : SEEKER_SPEED);
        e.life = 14;
        const ahead = this.ctx.standings()[racer.progress.position - 2];
        e.target = backward || !ahead ? -1 : ahead.index;
        // Thrown backwards: flies straight. Forwards: rides the road (homing once close).
        e.phase = backward ? 1 : 0;
        const loc = this.ctx.track.locate(e.position, s.trackIndex, 10);
        e.splineDistance = loc.splineDistance;
        break;
      }
      case 'boom':
        if (backward) e.velocity.set(0, 2, 0);
        else e.velocity.copy(fwd).multiplyScalar(22 + kartSpeed * 0.6).addScaledVector(UP, 9);
        e.life = 4;
        break;
      case 'goo':
      case 'decoy':
        e.position.copy(s.position).addScaledVector(fwd, -2.8).addScaledVector(UP, 0.8);
        e.velocity.set(0, 1, 0).addScaledVector(fwd, -2);
        e.life = 90;
        break;
      default:
        break;
    }
  }

  update(dt: number): void {
    for (const e of this.list) {
      if (e.dead) continue;
      e.age += dt;
      e.phaseTime += dt;
      if (e.life > 0 && e.age > e.life) {
        if (e.kind === 'boom') this.explode(e.position, e.owner, 8);
        this.kill(e, e.kind !== 'boom');
        continue;
      }
      if (e.attach === 'none') this.simulate(e, dt);
    }
    this.collideEntities();
    this.collideKarts();
    // Compact.
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i]!.dead) this.list.splice(i, 1);
  }

  // ------------------------------------------------------------------ motion

  private simulate(e: ItemEntity, dt: number): void {
    switch (e.kind) {
      case 'puck':
      case 'fireball':
        this.groundProjectile(e, dt, e.kind === 'puck' ? 5 : 3, false);
        break;
      case 'seeker':
        this.steerSeeker(e, dt);
        this.groundProjectile(e, dt, 0, e.phase === 1);
        break;
      case 'crown':
        this.updateCrown(e, dt);
        break;
      case 'goo':
      case 'decoy':
      case 'boom':
        this.ballistic(e, dt);
        break;
      case 'rang':
        this.updateRang(e, dt);
        break;
      default:
        break;
    }
  }

  /** Slides along the ground at constant speed, bouncing off (or breaking on) walls. */
  private groundProjectile(e: ItemEntity, dt: number, maxBounces: number, breakOnWall: boolean): void {
    const speed = Math.hypot(e.velocity.x, e.velocity.z) || PUCK_SPEED;
    const desired = this.t1.set(e.velocity.x, 0, e.velocity.z).multiplyScalar(dt);
    const res = this.ctx.physics.moveAgainstWalls(this.probe, e.position, desired, this.move);
    e.position.add(res.movement);
    for (const c of res.contacts) {
      const vn = e.velocity.dot(c.normal);
      if (vn >= 0) continue;
      if (e.kind === 'seeker' && !breakOnWall) {
        // Homing drones glance off walls along the road; only a head-on hit breaks them.
        if (-vn > speed * 0.8) {
          this.kill(e);
          return;
        }
        e.velocity.addScaledVector(c.normal, -vn);
        continue;
      }
      if (breakOnWall || ++e.bounces > maxBounces) {
        this.kill(e);
        return;
      }
      e.velocity.addScaledVector(c.normal, -2 * vn);
    }
    const flat = this.t2.set(e.velocity.x, 0, e.velocity.z).normalize().multiplyScalar(speed);
    e.velocity.set(flat.x, 0, flat.z);
    if (!this.snapToGround(e, 0.35)) this.kill(e);
  }

  private snapToGround(e: ItemEntity, lift: number): boolean {
    const hit = this.ctx.physics.raycastGround(this.t2.copy(e.position).addScaledVector(UP, 3), 30);
    if (!hit) return false;
    const targetY = hit.point.y + lift;
    e.position.y += (targetY - e.position.y) * 0.6;
    const loc = this.ctx.track.locate(e.position, e.trackIndex, 20);
    e.trackIndex = loc.index;
    e.splineDistance = loc.splineDistance;
    return true;
  }

  /**
   * Drones ride the road: they follow the centreline ahead (easing onto the target's
   * line) and only home in directly once the target is close — so they round corners
   * instead of flying into the first wall.
   */
  private steerSeeker(e: ItemEntity, dt: number): void {
    if (e.phase === 1) return;
    const target = e.target >= 0 ? this.ctx.racers[e.target] : undefined;
    const track = this.ctx.track;
    const live = target && !target.progress.finished ? target : undefined;
    const tLoc = live ? track.locate(live.state.position, live.state.trackIndex, 6) : null;
    const ahead = tLoc ? track.wrapDistance(tLoc.splineDistance - e.splineDistance) : Infinity;
    const close = live && (ahead < 30 || this.t1.copy(live.state.position).sub(e.position).length() < 16);
    let aim: Vector3;
    if (live && close) {
      aim = this.t1.copy(live.state.position).addScaledVector(UP, 0.5);
    } else {
      const f = track.frameAtSplineDistance(e.splineDistance + 12);
      const lateral = tLoc ? clamp(tLoc.lateral * 0.6, -f.halfWidth + 1.5, f.halfWidth - 1.5) : 0;
      aim = this.t1.copy(f.position).addScaledVector(f.right, lateral);
    }
    const dir = aim.sub(e.position).setY(0).normalize();
    const speed = SEEKER_SPEED;
    e.velocity.lerp(dir.multiplyScalar(speed), dampFactor(close ? 7 : 10, dt));
  }

  private updateCrown(e: ItemEntity, dt: number): void {
    const track = this.ctx.track;
    const leader = this.ctx.standings().find((r) => !r.progress.finished);
    if (!leader) {
      this.kill(e);
      return;
    }
    e.target = leader.index;
    if (e.phase === 0) {
      e.splineDistance = track.wrapDistance(e.splineDistance + CROWN_SPEED * dt);
      const f = track.frameAtSplineDistance(e.splineDistance);
      const goal = this.t1.copy(f.position).addScaledVector(UP, 8);
      e.velocity.copy(goal).sub(e.position).divideScalar(Math.max(dt, 1e-3));
      e.position.copy(goal);
      const lLoc = track.locate(leader.state.position, leader.state.trackIndex, 6);
      const ahead = track.wrapDistance(lLoc.splineDistance - e.splineDistance);
      if (ahead < 18 || ahead > track.length - 6) {
        e.phase = 1;
        e.phaseTime = 0;
      }
    } else {
      const goal = this.t1.copy(leader.state.position).addScaledVector(UP, 0.6);
      const to = goal.sub(e.position);
      if (to.length() < 2.6 || e.phaseTime > 1.1) {
        this.explode(leader.state.position, e.owner, 7, true);
        this.kill(e, false);
        return;
      }
      e.velocity.copy(to.normalize().multiplyScalar(75));
      e.position.addScaledVector(e.velocity, dt);
    }
  }

  /** Thrown/dropped objects: fly under gravity, then sit (or roll a bit) on the ground. */
  private ballistic(e: ItemEntity, dt: number): void {
    if (e.phase === 0) {
      e.velocity.y -= GRAVITY * 0.8 * dt;
      const desired = this.t1.copy(e.velocity).multiplyScalar(dt);
      const res = this.ctx.physics.moveAgainstWalls(this.probe, e.position, desired, this.move);
      e.position.add(res.movement);
      for (const c of res.contacts) {
        const vn = e.velocity.dot(c.normal);
        if (vn < 0) e.velocity.addScaledVector(c.normal, -1.5 * vn);
      }
      const hit = this.ctx.physics.raycastGround(this.t2.copy(e.position).addScaledVector(UP, 2), 60);
      if (!hit) {
        if (e.position.y < -30) this.kill(e);
        return;
      }
      if (e.velocity.y <= 0 && e.position.y <= hit.point.y + e.radius * 0.6) {
        e.position.y = hit.point.y + e.radius * 0.6;
        e.phase = 1;
        e.phaseTime = 0;
        e.velocity.y = 0;
        e.velocity.multiplyScalar(e.kind === 'boom' ? 0.4 : 0);
      }
    } else if (e.kind === 'boom' && e.velocity.lengthSq() > 0.01) {
      e.velocity.multiplyScalar(1 - dampFactor(2.5, dt));
      e.position.addScaledVector(e.velocity, dt);
      const hit = this.ctx.physics.raycastGround(this.t2.copy(e.position).addScaledVector(UP, 2), 10);
      if (hit) e.position.y = hit.point.y + e.radius * 0.6;
      if (e.phaseTime > 1.6) {
        this.explode(e.position, e.owner, 8);
        this.kill(e, false);
      }
    } else if (e.kind === 'boom' && e.phaseTime > 1.6) {
      this.explode(e.position, e.owner, 8);
      this.kill(e, false);
    }
  }

  private updateRang(e: ItemEntity, dt: number): void {
    const owner = this.ctx.racers[e.owner]!;
    if (e.phase === 0 && e.phaseTime > 0.95) {
      e.phase = 1;
      e.phaseTime = 0;
      e.hits.length = 0;
    }
    if (e.phase === 1) {
      const to = this.t1.copy(owner.state.position).addScaledVector(UP, 1).sub(e.position);
      if (to.length() < 2.6 || e.phaseTime > 2.5) {
        this.kill(e, false);
        return;
      }
      e.velocity.lerp(to.normalize().multiplyScalar(RANG_SPEED + Math.max(0, owner.state.forwardSpeed)), dampFactor(6, dt));
    }
    e.position.addScaledVector(e.velocity, dt);
    const hit = this.ctx.physics.raycastGround(this.t2.copy(e.position).addScaledVector(UP, 4), 30);
    if (hit) e.position.y += (hit.point.y + 1.3 - e.position.y) * 0.3;
  }

  // ------------------------------------------------------------------ collisions

  private static isProjectile(k: EntityKind): boolean {
    return k === 'puck' || k === 'seeker' || k === 'fireball' || k === 'rang' || k === 'boom';
  }

  /** Projectiles destroy whatever they touch (including shields held by karts). */
  private collideEntities(): void {
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const a = l[i]!;
      if (a.dead || a.kind === 'explosion' || a.kind === 'crown') continue;
      for (let j = i + 1; j < l.length; j++) {
        const b = l[j]!;
        if (b.dead || b.kind === 'explosion' || b.kind === 'crown') continue;
        const aMoving = a.attach === 'none' && ItemEntities.isProjectile(a.kind);
        const bMoving = b.attach === 'none' && ItemEntities.isProjectile(b.kind);
        if (!aMoving && !bMoving) continue;
        // A racer's own attached items don't destroy their own fresh shots.
        if (a.owner === b.owner && (a.attach !== 'none' || b.attach !== 'none')) continue;
        const r = a.radius + b.radius;
        if (a.position.distanceToSquared(b.position) > r * r) continue;
        for (const e of [a, b]) {
          if (e.kind === 'rang') continue;
          if (e.kind === 'boom') {
            this.explode(e.position, e.owner, 8);
            this.kill(e, false);
          } else {
            this.kill(e);
          }
          if (e.attach !== 'none') this.ctx.emit({ type: 'blocked', racer: e.owner, position: v3(e.position) });
        }
      }
    }
  }

  private collideKarts(): void {
    for (const e of this.list) {
      if (e.dead) continue;
      for (const r of this.ctx.racers) {
        if (e.kind === 'explosion') {
          this.explosionHit(e, r);
          continue;
        }
        if (r.index === e.owner) {
          // Own items: attached ones never hit you; free ones arm after a moment.
          if (e.attach !== 'none' || e.kind === 'crown' || e.kind === 'rang') continue;
          if (e.age < (e.kind === 'goo' || e.kind === 'decoy' || e.kind === 'boom' ? 1.2 : 0.6)) continue;
        }
        if (e.kind === 'crown' && e.phase === 0) continue;
        if (e.kind === 'octo') continue;
        // Phantoms are see-through; a Sky Feather hop sails over everything.
        if (r.state.ghostTimer > 0 || (r.state.featherTimer > 0 && !r.state.grounded)) continue;
        const dy = r.state.position.y + 0.8 - e.position.y;
        const dx = r.state.position.x - e.position.x;
        const dz = r.state.position.z - e.position.z;
        const rr = KART_HIT_RADIUS + e.radius;
        if (dx * dx + dz * dz > rr * rr || Math.abs(dy) > 1.8) continue;
        if (e.kind === 'rang' && e.hits.includes(r.index)) continue;

        if (isInvulnerable(r.state)) {
          if (e.kind !== 'rang') this.kill(e);
          continue;
        }
        if (e.kind === 'boom' || e.kind === 'crown') {
          this.explode(e.position, e.owner, e.kind === 'boom' ? 8 : 7, e.kind === 'crown');
          this.kill(e, false);
          continue;
        }
        const kind: HitKind = e.kind === 'seeker' || e.kind === 'decoy' ? 'tumble' : 'spin';
        this.hitRacer(r, kind, e.owner, e.kind);
        if (e.kind === 'rang') e.hits.push(r.index);
        else this.kill(e, false);
      }
    }
  }

  private explosionHit(e: ItemEntity, r: Racer): void {
    if (e.age > 0.25 || e.hits.includes(r.index) || r.state.ghostTimer > 0) return;
    if (r.state.position.distanceTo(e.position) > e.radius + KART_HIT_RADIUS) return;
    e.hits.push(r.index);
    this.hitRacer(r, 'tumble', e.owner, 'explosion');
  }

  hitRacer(r: Racer, kind: HitKind, by: number, source: string): boolean {
    // Phantoms shrug off anything a racer did to them (track hazards still hit).
    if (by >= 0 && r.state.ghostTimer > 0) return false;
    if (!r.sim.applyHit(kind)) return false;
    this.ctx.emit({ type: 'hit', racer: r.index, kind, by, source });
    this.dropAttached(r);
    return true;
  }

  /** A hit knocks loose anything the racer was holding or orbiting. */
  dropAttached(r: Racer): void {
    const slot = r.slot;
    const ids = [...slot.orbit];
    if (slot.heldEntity >= 0) ids.push(slot.heldEntity);
    for (const id of ids) {
      const e = this.byId(id);
      if (e) this.kill(e);
    }
    const wasAttached = slot.heldEntity >= 0 || slot.orbit.length > 0;
    slot.heldEntity = -1;
    slot.orbit = [];
    if (wasAttached) {
      slot.item = null;
      slot.uses = 0;
      slot.octo = [];
    }
  }

  /** Remove every live item near a point (Blast Horn), except the user's own attached items. */
  clearNear(center: Vector3, radius: number, exceptOwner: number): void {
    for (const e of this.list) {
      if (e.dead || e.kind === 'explosion') continue;
      if (e.owner === exceptOwner && e.attach !== 'none') continue;
      if (e.position.distanceTo(center) <= radius + (e.kind === 'crown' ? 6 : 0)) this.kill(e);
    }
  }
}
