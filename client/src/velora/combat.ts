import * as THREE from 'three';
import type { Game } from './game';
import type { Ped } from './actors/peds';
import type { Vehicle } from './actors/vehicle';

/**
 * Weapons (Ammu-Nation style catalogue, original names), the player's inventory and
 * hit resolution: rays against people (body + head), cars (Rapier) and the city.
 */

export interface WeaponDef {
  id: string;
  name: string;
  look: string | null; // GUN_LOOK key
  dmg: number;
  rpm: number;
  auto: boolean;
  mag: number;
  reload: number;
  spread: number;
  range: number;
  pellets?: number;
  explosive?: boolean;
  zoom?: number;
  sfx: [string, number];
  price: number;
  ammoPrice: number;
  ammoPack: number;
}

export const WEAPONS: WeaponDef[] = [
  { id: 'fist', name: 'Fists', look: null, dmg: 12, rpm: 120, auto: false, mag: 0, reload: 0, spread: 0, range: 1.6, sfx: ['', 1], price: 0, ammoPrice: 0, ammoPack: 0 },
  { id: 'pistol', name: 'Pistol', look: 'pistol', dmg: 26, rpm: 320, auto: false, mag: 12, reload: 1.3, spread: 0.012, range: 90, sfx: ['m1911', 1], price: 750, ammoPrice: 60, ammoPack: 36 },
  { id: 'revolver', name: 'Heavy Revolver', look: 'revolver', dmg: 75, rpm: 110, auto: false, mag: 6, reload: 2.1, spread: 0.008, range: 110, sfx: ['sw642', 0.9], price: 2400, ammoPrice: 90, ammoPack: 18 },
  { id: 'smg', name: 'Micro SMG', look: 'smg', dmg: 16, rpm: 900, auto: true, mag: 30, reload: 1.7, spread: 0.04, range: 70, sfx: ['m45', 1.1], price: 3200, ammoPrice: 90, ammoPack: 90 },
  { id: 'rifle', name: 'Carbine Rifle', look: 'rifle', dmg: 30, rpm: 650, auto: true, mag: 30, reload: 2.1, spread: 0.018, range: 160, sfx: ['ar15', 1], price: 6500, ammoPrice: 120, ammoPack: 90 },
  { id: 'shotgun', name: 'Pump Shotgun', look: 'shotgun', dmg: 13, rpm: 70, auto: false, mag: 8, reload: 2.8, spread: 0.08, range: 40, pellets: 8, sfx: ['model12', 1], price: 3000, ammoPrice: 80, ammoPack: 24 },
  { id: 'sniper', name: 'Sniper Rifle', look: 'sniper', dmg: 180, rpm: 45, auto: false, mag: 5, reload: 2.8, spread: 0.0015, range: 450, zoom: 4, sfx: ['tikka', 1], price: 15000, ammoPrice: 200, ammoPack: 15 },
  { id: 'rpg', name: 'RPG', look: 'rpg', dmg: 400, rpm: 40, auto: false, mag: 1, reload: 2.4, spread: 0.004, range: 300, explosive: true, sfx: ['', 1], price: 30000, ammoPrice: 800, ammoPack: 3 },
];
export const WEAPON: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

export class Inventory {
  owned = new Map<string, { mag: number; ammo: number }>([['fist', { mag: 0, ammo: 0 }]]);
  current = 'fist';
  reloadT = 0;
  cooldown = 0;
  /** Bottomless magazines (never reload, never run out). */
  infinite = false;

  give(id: string, ammo: number): void {
    const def = WEAPON[id]!;
    const have = this.owned.get(id);
    if (have) have.ammo += ammo;
    else this.owned.set(id, { mag: Math.min(def.mag, ammo), ammo: Math.max(0, ammo - def.mag) });
  }
  get def(): WeaponDef {
    return WEAPON[this.current]!;
  }
  get slot(): { mag: number; ammo: number } {
    return this.owned.get(this.current)!;
  }
  /** Cycle through owned weapons. */
  cycle(dir: number): void {
    const ids = WEAPONS.map((w) => w.id).filter((id) => this.owned.has(id));
    const i = ids.indexOf(this.current);
    this.current = ids[(i + dir + ids.length) % ids.length]!;
    this.reloadT = 0;
  }
  select(id: string): void {
    if (this.owned.has(id)) {
      this.current = id;
      this.reloadT = 0;
    }
  }
  reload(): boolean {
    if (this.infinite) return false;
    const d = this.def;
    const s = this.slot;
    if (!d.mag || s.mag >= d.mag || s.ammo <= 0 || this.reloadT > 0) return false;
    this.reloadT = d.reload;
    return true;
  }
  update(dt: number): void {
    this.cooldown -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const s = this.slot;
        const take = Math.min(this.def.mag - s.mag, s.ammo);
        s.mag += take;
        s.ammo -= take;
      }
    }
  }
  /** Try to fire: true when a shot goes off. */
  trigger(): boolean {
    const d = this.def;
    if (this.cooldown > 0 || this.reloadT > 0) return false;
    if (d.mag && !this.infinite) {
      const s = this.slot;
      if (s.mag <= 0) {
        this.reload();
        return false;
      }
      s.mag--;
    }
    this.cooldown = 60 / d.rpm;
    return true;
  }
}

// ---------------------------------------------------------------- hits

/** Ray vs. a person: capsule body + head sphere. Returns distance and whether it's a headshot. */
export function rayPerson(o: THREE.Vector3, d: THREE.Vector3, p: { x: number; y: number; z: number }, max: number): { t: number; head: boolean } | null {
  // Head.
  const head = new THREE.Vector3(p.x, p.y + 1.62, p.z);
  const th = raySphere(o, d, head, 0.17);
  // Body: sample the capsule as a vertical segment with radius.
  let best: number | null = null;
  for (const y of [0.35, 0.75, 1.15, 1.4]) {
    const t = raySphere(o, d, new THREE.Vector3(p.x, p.y + y, p.z), 0.3);
    if (t !== null && (best === null || t < best)) best = t;
  }
  if (th !== null && th <= max && (best === null || th <= best + 0.05)) return { t: th, head: true };
  return best !== null && best <= max ? { t: best, head: false } : null;
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number | null {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

export interface Shot {
  from: THREE.Vector3;
  dir: THREE.Vector3;
  def: WeaponDef;
  /** Who fired: 'player', or a ped / cop. */
  by: 'player' | Ped;
  /** Ignore this vehicle (the shooter's own car). */
  ignore?: Vehicle | null;
}

/** Fire one shot (all pellets): damage, effects, crimes. */
export function fire(g: Game, s: Shot): void {
  const pellets = s.def.pellets ?? 1;
  for (let k = 0; k < pellets; k++) {
    const dir = s.dir.clone();
    if (s.def.spread) {
      dir.x += (Math.random() - 0.5) * 2 * s.def.spread;
      dir.y += (Math.random() - 0.5) * 2 * s.def.spread;
      dir.z += (Math.random() - 0.5) * 2 * s.def.spread;
      dir.normalize();
    }
    pellet(g, s, dir);
  }
}

function pellet(g: Game, s: Shot, dir: THREE.Vector3): void {
  const o = s.from;
  let max = s.def.range;
  // World + cars (Rapier).
  const hit = g.physics.ray(o.x, o.y, o.z, dir.x, dir.y, dir.z, max, s.ignore?.body);
  let end = max;
  let car: Vehicle | undefined;
  if (hit) {
    end = hit.toi;
    car = g.vehicleByCollider(hit.collider.handle);
  }
  // People closer than that?
  let who: Ped | 'player' | null = null;
  let head = false;
  const copShot = s.by !== 'player' && s.by.role !== 'civ';
  for (const p of g.peds.list) {
    if (p === s.by || p.dead || (copShot && p.role !== 'civ')) continue;
    if (Math.abs(p.x - o.x) > end + 1 || Math.abs(p.z - o.z) > end + 1) continue;
    const r = rayPerson(o, dir, p, end);
    if (r && r.t < end) {
      end = r.t;
      who = p;
      head = r.head;
      car = undefined;
    }
  }
  if (s.by !== 'player' && !g.player.inCar && !g.player.dead) {
    const r = rayPerson(o, dir, g.player.pos, end);
    if (r && r.t < end) {
      end = r.t;
      who = 'player';
      head = r.head;
      car = undefined;
    }
  }
  // Other players (online): you report hits on them, they apply the damage.
  let remote: string | null = null;
  if (s.by === 'player')
    for (const r of g.remoteTargets()) {
      if (Math.abs(r.x - o.x) > end + 1 || Math.abs(r.z - o.z) > end + 1) continue;
      const hit2 = rayPerson(o, dir, r, end);
      if (hit2 && hit2.t < end) {
        end = hit2.t;
        remote = r.id;
        head = hit2.head;
        who = null;
        car = undefined;
      }
    }
  const at = o.clone().addScaledVector(dir, end);
  if (remote) {
    g.net?.hit(remote, s.def.dmg * (head ? 2 : 1) * 0.55, s.def.name);
    g.fx.blood(at);
    if (Math.random() < 0.6) g.fx.tracer(o, at);
    return;
  }
  if (Math.random() < 0.6 || s.by === 'player') g.fx.tracer(o, at);
  if (s.def.explosive) {
    g.explode(at, s.by);
    return;
  }
  if (who === 'player') {
    g.player.hurt(s.def.dmg * (head ? 2 : 1) * 0.55, s.from);
    g.fx.blood(at);
  } else if (who) {
    who.hurt(s.def.dmg * (head ? 4 : 1), s.by, dir);
    g.fx.blood(at);
  } else if (car && g.remoteCarHit(car, s.def.dmg * 0.9)) {
    g.fx.impact(at, dir.clone().negate(), true);
  } else if (car) {
    car.damage(s.def.dmg * 0.9);
    if (s.by === 'player') g.carAttacked(car);
    g.fx.impact(at, dir.clone().negate(), true);
  } else if (hit) g.fx.impact(at, dir.clone().negate(), false);
}
