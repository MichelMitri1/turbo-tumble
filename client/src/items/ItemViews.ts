import { Group, Vector3, type Object3D } from 'three';
import type { RaceSimulation } from '@shared/race/RaceSimulation';
import type { EntityKind, ItemEntity } from '@shared/items/ItemEntities';
import { createItemModel, type ModelKey } from './ItemModels';
import type { Effects } from '../vfx/Effects';

interface EntityView {
  object: Object3D;
  key: ModelKey;
  prev: Vector3;
  cur: Vector3;
  seen: boolean;
  /** Trail particle accumulator. */
  trail: number;
}

/** Trail look per moving item: colour, size, life, additive glow or smoke, particles/s. */
const TRAILS: Partial<Record<string, { color: string; size: number; life: number; additive: boolean; rate: number }>> = {
  puck: { color: '#dfffe0', size: 0.5, life: 0.35, additive: true, rate: 24 },
  seeker: { color: '#ff6a3a', size: 0.7, life: 0.4, additive: true, rate: 40 },
  crown: { color: '#5aa0ff', size: 1.2, life: 0.6, additive: true, rate: 50 },
  fireball: { color: '#ff9a1a', size: 0.8, life: 0.3, additive: true, rate: 45 },
  rang: { color: '#ffffff', size: 0.6, life: 0.25, additive: true, rate: 40 },
  boom: { color: '#8a8698', size: 0.6, life: 0.6, additive: false, rate: 14 },
};

const MODEL_FOR_KIND: Record<Exclude<EntityKind, 'explosion' | 'octo'>, ModelKey> = {
  puck: 'puck',
  seeker: 'seeker',
  crown: 'crownBuster',
  goo: 'goo',
  decoy: 'decoyBox',
  boom: 'boomBall',
  fireball: 'fireball',
  rang: 'rang',
};

/**
 * Renders the item world: live entities (pooled, tick-interpolated, animated),
 * item boxes and coins.
 */
export class ItemViews {
  readonly root = new Group();
  private readonly views = new Map<number, EntityView>();
  private readonly pool = new Map<ModelKey, Object3D[]>();
  private readonly boxes: Object3D[] = [];
  private readonly boxScale: number[] = [];
  private readonly coins: Object3D[] = [];
  private time = 0;

  constructor(
    private readonly race: RaceSimulation,
    private readonly fx: Effects | null = null,
  ) {
    this.root.name = 'items';
    for (const b of race.pickups.boxes) {
      const o = createItemModel('prizeBox');
      o.position.copy(b.position);
      this.root.add(o);
      this.boxes.push(o);
      this.boxScale.push(1);
    }
    for (const c of race.pickups.coins) {
      const o = createItemModel('coinPickup');
      o.position.copy(c.position);
      o.scale.setScalar(1.3);
      this.root.add(o);
      this.coins.push(o);
    }
  }

  private keyFor(e: ItemEntity): ModelKey | null {
    if (e.kind === 'explosion') return null;
    if (e.kind === 'octo') return (e.item ?? 'coin') as ModelKey;
    return MODEL_FOR_KIND[e.kind];
  }

  private acquire(key: ModelKey): Object3D {
    const list = this.pool.get(key);
    const o = list?.pop() ?? createItemModel(key);
    o.visible = true;
    o.scale.setScalar(1);
    o.rotation.set(0, 0, 0);
    this.root.add(o);
    return o;
  }

  private release(v: EntityView): void {
    this.root.remove(v.object);
    let list = this.pool.get(v.key);
    if (!list) this.pool.set(v.key, (list = []));
    list.push(v.object);
  }

  /** Call after every simulation tick to capture entity positions for interpolation. */
  afterTick(): void {
    for (const v of this.views.values()) v.seen = false;
    for (const e of this.race.items.entities.list) {
      if (e.dead) continue;
      const key = this.keyFor(e);
      if (!key) continue;
      let v = this.views.get(e.id);
      if (!v) {
        v = { object: this.acquire(key), key, prev: e.position.clone(), cur: e.position.clone(), seen: true, trail: 0 };
        this.views.set(e.id, v);
      }
      v.prev.copy(v.cur);
      v.cur.copy(e.position);
      // Attached items jump with the kart; don't smear them across a respawn.
      if (v.prev.distanceToSquared(v.cur) > 400) v.prev.copy(v.cur);
      v.seen = true;
    }
    for (const [id, v] of this.views) {
      if (!v.seen) {
        this.release(v);
        this.views.delete(id);
      }
    }
  }

  render(alpha: number, dt: number): void {
    this.time += dt;
    const t = this.time;
    const entities = new Map(this.race.items.entities.list.map((e) => [e.id, e]));
    for (const [id, v] of this.views) {
      const e = entities.get(id);
      if (!e) continue;
      const o = v.object;
      o.position.lerpVectors(v.prev, v.cur, alpha);
      const trail = e.attach === 'none' ? TRAILS[e.kind] : undefined;
      if (trail && this.fx && dt > 0 && e.velocity.lengthSq() > 4) {
        v.trail += dt * trail.rate;
        for (; v.trail >= 1; v.trail--) this.fx.trail(o.position, trail.color, trail.size, trail.life, trail.additive);
      }
      const heading = Math.atan2(e.velocity.x, e.velocity.z);
      switch (e.kind) {
        case 'puck':
          o.rotation.set(0, t * 14, 0);
          break;
        case 'seeker': {
          o.rotation.set(0, e.attach === 'none' ? heading : this.ownerYaw(e), 0);
          o.position.y += Math.sin(t * 6 + id) * 0.08;
          const rotor = o.getObjectByName('rotor');
          if (rotor) rotor.rotation.y = t * 30;
          break;
        }
        case 'crown': {
          o.rotation.set(0, t * 3, 0);
          const flap = Math.sin(t * 16) * 0.5;
          o.getObjectByName('wingL')?.rotation.set(0, 0, flap);
          o.getObjectByName('wingR')?.rotation.set(0, 0, -flap);
          o.scale.setScalar(1.4);
          break;
        }
        case 'goo': {
          const blob = o.getObjectByName('blob');
          if (blob) blob.scale.set(1 + Math.sin(t * 5 + id) * 0.06, 1 - Math.sin(t * 5 + id) * 0.08, 1);
          o.rotation.y = id;
          break;
        }
        case 'decoy':
          o.rotation.set(0, t * 1.4, 0);
          o.position.y += 0.5 + Math.sin(t * 2) * 0.15;
          break;
        case 'boom': {
          const spark = o.getObjectByName('spark');
          if (spark) spark.scale.setScalar(0.7 + Math.random() * 0.8);
          if (e.attach === 'none' && e.phase === 1) o.scale.setScalar(1 + Math.max(0, Math.sin(e.phaseTime * 20)) * 0.12 * e.phaseTime);
          else o.scale.setScalar(1);
          break;
        }
        case 'fireball':
          o.position.y += Math.abs(Math.sin(e.age * 10)) * 0.9;
          o.rotation.set(t * 8, t * 6, 0);
          break;
        case 'rang':
          o.rotation.set(0, t * 22, 0);
          o.scale.setScalar(1.3);
          break;
        case 'octo':
          o.scale.setScalar(0.6);
          o.rotation.y = t * 2;
          break;
        default:
          break;
      }
    }

    // Item boxes: spin, bob, pop back in after respawning.
    this.race.pickups.boxes.forEach((b, i) => {
      const o = this.boxes[i]!;
      const target = b.respawn > 0 ? 0 : 1;
      this.boxScale[i] = target === 0 ? 0 : Math.min(1, this.boxScale[i]! + dt * 2.5);
      const s = this.boxScale[i]!;
      o.visible = s > 0.01;
      const pop = s < 1 ? Math.sin(s * Math.PI) * 0.25 : 0;
      o.scale.setScalar(s + pop);
      o.position.set(b.position.x, b.position.y + Math.sin(t * 2 + i) * 0.15, b.position.z);
      o.rotation.set(0.35, t * 1.3 + i, 0.2);
      const core = o.getObjectByName('core');
      if (core) core.rotation.set(0, -t * 3, 0);
    });
    this.race.pickups.coins.forEach((c, i) => {
      const o = this.coins[i]!;
      o.visible = c.respawn <= 0;
      o.rotation.set(0, t * 3 + i * 0.4, 0);
      o.position.y = c.position.y + Math.sin(t * 3 + i) * 0.12;
    });
  }

  private ownerYaw(e: ItemEntity): number {
    const f = this.race.racers[e.owner]?.state.forward;
    return f ? Math.atan2(f.x, f.z) : 0;
  }
}
