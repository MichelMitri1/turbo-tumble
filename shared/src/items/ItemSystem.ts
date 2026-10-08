import { Vector3 } from 'three';
import type { PlayerInput } from '../types/input';
import type { RaceContext, Racer } from '../race/RaceTypes';
import { v3 } from '../race/RaceTypes';
import { isInvulnerable } from '../vehicles/KartState';
import { rollItem } from './ItemDistribution';
import { FIREBALL_SPEED, ItemEntities, type EntityKind, type ItemEntity } from './ItemEntities';
import { DEPLOY_CHILD, ITEMS, OCTO_SEQUENCE, type ItemId } from './ItemTypes';

export const ROULETTE_TIME = 2.0;
const HORN_RADIUS = 13;
const QUAKE_PULSES = [0, 0.55, 1.1];
const ZAP_COOLDOWN = 15;
/** Crown Busters are spaced out like Zap Storms: one per this many seconds at most. */
const CROWN_COOLDOWN = 25;
const ZAP_SHRINK_MAX = 5;
const PHANTOM_TIME = 3;
const GIANT_TIME = 8;
const FEATHER_LIFT = 13;
const UP = new Vector3(0, 1, 0);

/** Entity spawned when a hold-style item is readied behind the kart. */
const HOLD_ENTITY: Partial<Record<ItemId, EntityKind>> = { puck: 'puck', seeker: 'seeker', goo: 'goo', decoy: 'decoy', boomBall: 'boom' };

interface Quake {
  owner: number;
  t: number;
  pulse: number;
}

/**
 * Item slot logic for every racer (roulette, use styles, timed items, global
 * effects) on top of the live entity simulation.
 */
export class ItemSystem {
  readonly entities: ItemEntities;
  private readonly quakes: Quake[] = [];
  private lastZap = -ZAP_COOLDOWN;
  private lastCrown = -CROWN_COOLDOWN;
  /** Item taken by a Phantom this tick (handed over after the Phantom is consumed). */
  private stolen: { item: ItemId; uses: number } | null = null;
  private readonly t1 = new Vector3();
  private readonly t2 = new Vector3();

  constructor(private readonly ctx: RaceContext) {
    this.entities = new ItemEntities(ctx);
  }

  dispose(): void {
    this.entities.dispose();
  }

  // ------------------------------------------------------------------ rolling

  private blockedItems(): Set<ItemId> {
    const blocked = new Set<ItemId>();
    const holds = (id: ItemId): boolean => this.ctx.racers.some((r) => r.slot.item === id || r.slot.pending === id || r.slot.reserve === id || r.slot.reservePending === id);
    const crownLive = this.entities.list.some((e) => e.kind === 'crown' && !e.dead);
    if (crownLive || holds('crownBuster') || this.ctx.time - this.lastCrown < CROWN_COOLDOWN) blocked.add('crownBuster');
    if (holds('zap') || this.ctx.time - this.lastZap < ZAP_COOLDOWN) blocked.add('zap');
    return blocked;
  }

  /**
   * Start the roulette after an item box: into the front slot, or — while the front
   * is busy — into the second slot. Returns false if both are taken.
   */
  grantRoll(r: Racer): boolean {
    const slot = r.slot;
    const front = !slot.item && slot.roulette <= 0;
    if (!front && (slot.reserve || slot.reserveRoulette > 0)) return false;
    const item = rollItem({ position: r.progress.position, racerCount: this.ctx.racers.length, blocked: this.blockedItems() }, this.ctx.rng);
    if (front) {
      slot.pending = item;
      slot.roulette = ROULETTE_TIME;
    } else {
      slot.reservePending = item;
      slot.reserveRoulette = ROULETTE_TIME;
    }
    return true;
  }

  /** The second slot moves up once the front item is completely used up. */
  private promote(r: Racer): void {
    const slot = r.slot;
    if (slot.item || slot.roulette > 0 || !slot.reserve || slot.reserveRoulette > 0) return;
    if (slot.heldEntity >= 0 || slot.orbit.length || slot.timer > 0) return;
    slot.item = slot.reserve;
    slot.uses = ITEMS[slot.item].uses;
    slot.reserve = null;
  }

  // ------------------------------------------------------------------ per-racer slot

  tickSlot(r: Racer, input: PlayerInput, dt: number): void {
    const slot = r.slot;
    slot.cooldown = Math.max(0, slot.cooldown - dt);
    const pressed = input.item && !slot.pressed;
    const released = !input.item && slot.pressed;
    slot.pressed = input.item;

    if (slot.reserveRoulette > 0) {
      slot.reserveRoulette = Math.max(0, slot.reserveRoulette - dt);
      if (slot.reserveRoulette === 0 && slot.reservePending) {
        slot.reserve = slot.reservePending;
        slot.reservePending = null;
        this.ctx.emit({ type: 'itemReady', racer: r.index, item: slot.reserve });
      }
    }
    this.promote(r);

    if (slot.roulette > 0) {
      slot.roulette = Math.max(0, slot.roulette - dt);
      if (slot.roulette === 0 && slot.pending) {
        slot.item = slot.pending;
        slot.pending = null;
        slot.uses = ITEMS[slot.item].uses;
        this.ctx.emit({ type: 'itemReady', racer: r.index, item: slot.item });
      }
      return;
    }

    if (slot.timer > 0) {
      this.tickTimed(r, pressed, input, dt);
      return;
    }

    const item = slot.item;
    if (!item) return;
    const def = ITEMS[item];
    const backward = input.brake > 0.5;

    switch (def.use) {
      case 'instant':
        if (pressed && this.useInstant(r, item)) {
          this.consume(r, item);
          this.handOverStolen(r);
        }
        break;
      case 'hold':
        if (pressed && slot.heldEntity < 0) {
          const kind = HOLD_ENTITY[item]!;
          const e = this.entities.spawn(kind, r.index, r.state.position, new Vector3(), { attach: 'held' });
          slot.heldEntity = e.id;
        } else if (released && slot.heldEntity >= 0) {
          const e = this.entities.byId(slot.heldEntity);
          slot.heldEntity = -1;
          if (e) this.entities.launch(e, r, backward);
          this.consume(r, item);
        }
        break;
      case 'deploy':
        if (!pressed) break;
        if (slot.orbit.length === 0) {
          this.deploy(r, item);
          this.ctx.emit({ type: 'itemUse', racer: r.index, item });
        } else {
          this.fireDeployed(r, item, backward);
        }
        break;
      case 'timed':
        if (pressed) {
          slot.timer = def.duration ?? 5;
          slot.timedItem = item;
          this.ctx.emit({ type: 'itemUse', racer: r.index, item });
          this.tickTimed(r, true, input, 0);
        }
        break;
    }
  }

  private consume(r: Racer, item: ItemId): void {
    const slot = r.slot;
    this.ctx.emit({ type: 'itemUse', racer: r.index, item });
    slot.uses--;
    if (slot.uses <= 0) {
      slot.item = null;
      slot.uses = 0;
    }
  }

  /** Phantom: the swiped item lands in the thief's (now empty) front slot. */
  private handOverStolen(r: Racer): void {
    const loot = this.stolen;
    if (!loot) return;
    this.stolen = null;
    const slot = r.slot;
    if (!slot.item && slot.roulette <= 0) {
      slot.item = loot.item;
      slot.uses = loot.uses;
    } else if (!slot.reserve && slot.reserveRoulette <= 0) {
      slot.reserve = loot.item;
    }
  }

  /** Phantom target: a random racer ahead holding an idle item (front slot, else the spare). */
  private steal(r: Racer): void {
    const victims = this.ctx.racers.filter((o) => {
      if (o === r || o.progress.position >= r.progress.position || o.state.ghostTimer > 0) return false;
      const idle = o.slot.item && o.slot.roulette <= 0 && o.slot.heldEntity < 0 && !o.slot.orbit.length && o.slot.timer <= 0;
      return idle || o.slot.reserve !== null;
    });
    if (!victims.length) return;
    const o = victims[Math.floor(this.ctx.rng.next() * victims.length)]!;
    const slot = o.slot;
    let item: ItemId;
    let uses: number;
    if (slot.item && slot.roulette <= 0 && slot.heldEntity < 0 && !slot.orbit.length && slot.timer <= 0) {
      item = slot.item;
      uses = slot.uses;
      slot.item = null;
      slot.uses = 0;
    } else {
      item = slot.reserve!;
      uses = ITEMS[item].uses;
      slot.reserve = null;
    }
    this.stolen = { item, uses };
    this.ctx.emit({ type: 'steal', racer: r.index, from: o.index, item });
  }

  private deploy(r: Racer, item: ItemId): void {
    const slot = r.slot;
    if (item === 'octo') {
      slot.octo = [...OCTO_SEQUENCE];
      slot.orbit = slot.octo.map((it, i) => this.entities.spawn('octo', r.index, r.state.position, new Vector3(), { attach: 'orbit', slotIndex: i, item: it }).id);
      return;
    }
    const child = DEPLOY_CHILD[item]!;
    const kind = HOLD_ENTITY[child]!;
    const attach = child === 'goo' ? 'trail' : 'orbit';
    slot.orbit = Array.from({ length: slot.uses }, (_, i) => this.entities.spawn(kind, r.index, r.state.position, new Vector3(), { attach, slotIndex: i }).id);
  }

  private fireDeployed(r: Racer, item: ItemId, backward: boolean): void {
    const slot = r.slot;
    const id = slot.orbit.shift();
    const e = id !== undefined ? this.entities.byId(id) : undefined;
    if (item === 'octo') {
      const next = slot.octo.shift();
      if (e) this.entities.kill(e, false);
      if (next) this.useOcto(r, next, backward);
    } else if (e) {
      this.entities.launch(e, r, backward || e.kind === 'goo');
    }
    slot.uses--;
    this.ctx.emit({ type: 'itemUse', racer: r.index, item: item === 'octo' ? 'octo' : DEPLOY_CHILD[item]! });
    if (slot.uses <= 0 || slot.orbit.length === 0) {
      for (const rest of slot.orbit) {
        const left = this.entities.byId(rest);
        if (left) this.entities.kill(left, false);
      }
      slot.orbit = [];
      slot.octo = [];
      slot.item = null;
      slot.uses = 0;
    }
  }

  private useOcto(r: Racer, item: ItemId, backward: boolean): void {
    const kind = HOLD_ENTITY[item];
    if (kind) {
      const e = this.entities.spawn(kind, r.index, r.state.position, new Vector3());
      this.entities.launch(e, r, backward || kind === 'goo');
    } else {
      this.useInstant(r, item);
    }
  }

  private tickTimed(r: Racer, pressed: boolean, input: PlayerInput, dt: number): void {
    const slot = r.slot;
    slot.timer = Math.max(0, slot.timer - dt);
    const s = r.state;
    switch (slot.timedItem) {
      case 'fizzGold':
        if (pressed && slot.cooldown === 0) {
          r.sim.giveBoost(1.1, 10);
          slot.cooldown = 0.2;
        }
        break;
      case 'ember':
        if (pressed && slot.cooldown === 0) {
          const back = input.brake > 0.5 ? -1 : 1;
          const fwd = this.t1.copy(s.forward).setY(0).normalize();
          const pos = s.position.clone().addScaledVector(fwd, 2.6 * back).addScaledVector(UP, 0.6);
          const vel = fwd.clone().multiplyScalar(back * (FIREBALL_SPEED + Math.max(0, s.forwardSpeed) * 0.5));
          this.entities.spawn('fireball', r.index, pos, vel, { life: 2.6, trackIndex: s.trackIndex });
          slot.cooldown = 0.25;
        }
        break;
      case 'snapper':
        if (pressed && slot.cooldown < 0.6) {
          r.sim.giveBoost(0.5, 6);
          this.chomp(r, 9.5);
        } else if (slot.cooldown === 0) {
          this.chomp(r, 7);
        }
        break;
      default:
        break;
    }
    if (slot.timer === 0) {
      slot.timedItem = null;
      slot.item = null;
      slot.uses = 0;
    }
  }

  /** Snapper Pot bite: nearest racer or item in front of the kart. */
  private chomp(r: Racer, range: number): void {
    const s = r.state;
    const fwd = this.t1.copy(s.forward).setY(0).normalize();
    let bestRacer: Racer | null = null;
    let bestD = range;
    for (const o of this.ctx.racers) {
      if (o === r || isInvulnerable(o.state)) continue;
      const to = this.t2.copy(o.state.position).sub(s.position);
      const d = to.length();
      if (d < bestD && to.setY(0).normalize().dot(fwd) > 0.25) {
        bestD = d;
        bestRacer = o;
      }
    }
    let bestEntity: ItemEntity | null = null;
    for (const e of this.entities.list) {
      if (e.dead || e.owner === r.index || e.kind === 'explosion') continue;
      const d = e.position.distanceTo(s.position);
      if (d < bestD) {
        bestD = d;
        bestEntity = e;
        bestRacer = null;
      }
    }
    if (!bestRacer && !bestEntity) return;
    r.slot.cooldown = 1.0;
    this.ctx.emit({ type: 'chomp', racer: r.index, position: v3((bestRacer?.state.position ?? bestEntity!.position)) });
    if (bestRacer) this.entities.hitRacer(bestRacer, 'spin', r.index, 'snapper');
    else if (bestEntity) this.entities.kill(bestEntity);
  }

  /** Instant-use effects. Returns false if the use was refused (e.g. a boomerang still out). */
  private useInstant(r: Racer, item: ItemId): boolean {
    const s = r.state;
    const fwd = this.t1.copy(s.forward).setY(0).normalize();
    switch (item) {
      case 'fizz':
      case 'fizz3':
        r.sim.giveBoost(1.3, 10);
        return true;
      case 'coin':
        s.coins = Math.min(10, s.coins + 2);
        r.sim.giveBoost(0.35, 3);
        this.ctx.emit({ type: 'coin', racer: r.index, total: s.coins, position: v3(s.position) });
        return true;
      case 'prism':
        s.invincibleTimer = 7.5;
        s.spinTimer = s.tumbleTimer = s.squishTimer = s.shrinkTimer = 0;
        return true;
      case 'jetRocket':
        s.rocketTimer = 6.5;
        s.spinTimer = s.tumbleTimer = s.squishTimer = s.shrinkTimer = 0;
        this.entities.dropAttached(r);
        return true;
      case 'crownBuster': {
        this.lastCrown = this.ctx.time;
        const pos = s.position.clone().addScaledVector(UP, 3);
        const loc = this.ctx.track.locate(s.position, s.trackIndex, 6);
        this.entities.spawn('crown', r.index, pos, new Vector3(), { splineDistance: loc.splineDistance, life: 40 });
        return true;
      }
      case 'rang': {
        if (this.entities.list.some((e) => e.kind === 'rang' && e.owner === r.index && !e.dead)) return false;
        const pos = s.position.clone().addScaledVector(fwd, 2.5).addScaledVector(UP, 1.2);
        this.entities.spawn('rang', r.index, pos, fwd.clone().multiplyScalar(44 + Math.max(0, s.forwardSpeed)), { life: 5 });
        return true;
      }
      case 'horn': {
        for (const o of this.ctx.racers) {
          if (o === r || o.state.position.distanceTo(s.position) > HORN_RADIUS) continue;
          this.entities.hitRacer(o, 'spin', r.index, 'horn');
        }
        this.entities.clearNear(s.position, HORN_RADIUS, r.index);
        this.ctx.emit({ type: 'shockwave', racer: r.index, position: v3(s.position), radius: HORN_RADIUS });
        return true;
      }
      case 'paint':
        for (const o of this.ctx.racers) {
          if (o === r || o.progress.position > r.progress.position || isInvulnerable(o.state) || o.state.ghostTimer > 0) continue;
          o.state.inkTimer = 4.5;
          this.ctx.emit({ type: 'paint', racer: o.index, by: r.index });
        }
        return true;
      case 'zap': {
        this.lastZap = this.ctx.time;
        const n = this.ctx.racers.length;
        for (const o of this.ctx.racers) {
          if (o === r) continue;
          o.state.megaTimer = 0; // lightning cuts a Giant down to size
          if (isInvulnerable(o.state) || o.state.ghostTimer > 0) continue;
          const frac = n <= 1 ? 0 : (o.progress.position - 1) / (n - 1);
          this.entities.hitRacer(o, 'spin', r.index, 'zap');
          o.state.shrinkTimer = Math.min(ZAP_SHRINK_MAX, 3 + 4 * (1 - frac));
          Object.assign(o.slot, { item: null, uses: 0, roulette: 0, pending: null, reserve: null, reserveRoulette: 0, reservePending: null });
        }
        this.ctx.emit({ type: 'zap', racer: r.index });
        return true;
      }
      case 'quake':
        this.quakes.push({ owner: r.index, t: 0, pulse: 0 });
        return true;
      case 'phantom':
        s.ghostTimer = PHANTOM_TIME;
        this.steal(r);
        return true;
      case 'giant':
        s.megaTimer = GIANT_TIME;
        s.spinTimer = s.tumbleTimer = s.squishTimer = s.shrinkTimer = 0;
        return true;
      case 'feather':
        if (!s.grounded || s.liftTimer > 0) return false;
        s.velocity.y = Math.max(0, s.velocity.y) + FEATHER_LIFT;
        s.grounded = false;
        s.airTime = 0;
        s.jumpFlight = true;
        s.jumpTrick = false;
        s.lipSpeed = 0;
        s.featherTimer = 1.1;
        return true;
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------ world update

  /** Keep held / orbiting / trailing items glued to their karts. */
  updateAttached(): void {
    const time = this.ctx.time;
    for (const e of this.entities.list) {
      if (e.dead || e.attach === 'none') continue;
      const r = this.ctx.racers[e.owner]!;
      const s = r.state;
      const fwd = this.t1.copy(s.forward).setY(0).normalize();
      if (e.attach === 'held') {
        e.position.copy(s.position).addScaledVector(fwd, -2.3).addScaledVector(UP, 0.55);
      } else if (e.attach === 'trail') {
        e.position.copy(s.position).addScaledVector(fwd, -2.3 - e.slotIndex * 1.5).addScaledVector(UP, 0.55);
      } else {
        const count = Math.max(1, r.slot.orbit.length);
        const order = r.slot.orbit.indexOf(e.id);
        const a = time * 4.2 + (order * Math.PI * 2) / count;
        const rad = e.kind === 'octo' ? 2.9 : 2.5;
        e.position.copy(s.position).add(this.t2.set(Math.sin(a) * rad, 0.8, Math.cos(a) * rad));
      }
    }
  }

  update(dt: number): void {
    this.updateAttached();
    this.updateQuakes(dt);
    this.entities.update(dt);
  }

  private updateQuakes(dt: number): void {
    for (let i = this.quakes.length - 1; i >= 0; i--) {
      const q = this.quakes[i]!;
      q.t += dt;
      while (q.pulse < QUAKE_PULSES.length && q.t >= QUAKE_PULSES[q.pulse]!) {
        q.pulse++;
        this.ctx.emit({ type: 'quakePulse', racer: q.owner, pulse: q.pulse });
      }
      if (q.pulse >= QUAKE_PULSES.length) {
        const owner = this.ctx.racers[q.owner]!;
        for (const o of this.ctx.racers) {
          if (o === owner || o.progress.position > owner.progress.position) continue;
          if (!o.state.grounded) continue; // airborne racers dodge the quake
          this.entities.hitRacer(o, 'spin', q.owner, 'quake');
        }
        this.quakes.splice(i, 1);
      }
    }
  }
}
