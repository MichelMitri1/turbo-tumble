import * as THREE from 'three';
import type { PersonModel } from '../assets';
import { WEAPON, fire, type WeaponDef } from '../combat';
import type { Game } from '../game';
import type { REdge } from '../world/net';
import { GUN_LOOK, Human } from './human';
import type { Vehicle } from './vehicle';

/**
 * Pedestrians walk the sidewalks (straight or curved, over bridges), cross at junctions and
 * turn onto the next street; they flee from gunfire, cower, get run over, drop cash and call
 * the cops. Cops and SWAT on foot are peds too: they run you down, aim, shoot and arrest.
 */

export type Role = 'civ' | 'cop' | 'swat';
const CIVS: PersonModel[] = ['casual', 'hoodie', 'suit', 'business', 'worker', 'worker2', 'punk', 'punk2', 'farmer', 'adventurer', 'woman', 'woman2'];
const P = { x: 0, y: 0, z: 0 };

export class Ped {
  readonly human: Human;
  x = 0;
  y = 0;
  z = 0;
  heading = 0;
  health: number;
  dead = false;
  deadT = 0;
  state: 'walk' | 'flee' | 'cower' | 'combat' | 'idle' = 'walk';
  /** Sidewalk: edge, side of the road (+1 right of a→b), walking direction, distance along. */
  e: REdge | null = null;
  side: 1 | -1 = 1;
  dir: 1 | -1 = 1;
  s = 0;
  cross: { ax: number; az: number; bx: number; bz: number; f: number; e: REdge; side: 1 | -1; dir: 1 | -1; s: number } | null = null;
  vx = 0;
  vz = 0;
  vy = 0;
  panicT = 0;
  weapon: WeaponDef | null = null;
  cool = 0;
  car: Vehicle | null = null;
  seesPlayer = false;
  private hitT = 0;
  killedBy: 'player' | Ped | null = null;
  lastAttacker: 'player' | Ped | null = null;

  constructor(readonly role: Role, model: PersonModel) {
    this.human = new Human(model);
    this.health = role === 'swat' ? 160 : role === 'cop' ? 110 : 60;
    if (role !== 'civ') {
      this.weapon = WEAPON[role === 'swat' ? 'rifle' : 'pistol']!;
      this.human.setGunLook(GUN_LOOK[this.weapon.look!]!);
    }
  }

  get pos(): { x: number; y: number; z: number } {
    return { x: this.x, y: this.y, z: this.z };
  }

  hurt(dmg: number, by: 'player' | Ped, dir?: THREE.Vector3): void {
    if (this.dead) return;
    this.health -= dmg;
    this.panicT = 12;
    this.lastAttacker = by;
    if (this.health <= 0) {
      this.die(dir ? dir.x * 2 : 0, dir ? dir.z * 2 : 0);
      this.killedBy = by;
      return;
    }
    if (this.role === 'civ') this.state = 'flee';
    this.hitT = 0.35;
    this.human.play('hit');
  }

  die(vx = 0, vz = 0, vy = 0): void {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.vx = vx;
    this.vz = vz;
    this.vy = vy;
    this.human.setGunLook(null);
    this.human.play('dead');
  }

  /** Put this ped on a sidewalk. */
  onSidewalk(e: REdge, side: 1 | -1, dir: 1 | -1, s: number, g: Game): void {
    this.e = e;
    this.side = side;
    this.dir = dir;
    this.s = s;
    this.cross = null;
    this.walkPoint(g, s);
    this.x = P.x;
    this.y = P.y;
    this.z = P.z;
  }

  private walkPoint(g: Game, s: number): void {
    const e = this.e!;
    const net = g.city.net;
    const at = this.dir > 0 ? s : e.len - s;
    net.point(e, at, P);
    const [tx, tz] = net.tangent(e, at);
    const off = this.side * (e.spec.width / 2 + 2);
    P.x += -tz * off;
    P.z += tx * off;
    P.y += 0.18;
  }

  update(g: Game, dt: number): void {
    const h = this.human;
    if (this.dead) {
      this.deadT += dt;
      if (this.vx || this.vz || this.vy) {
        this.x += this.vx * dt;
        this.z += this.vz * dt;
        this.y += this.vy * dt;
        this.vy -= 18 * dt;
        const gy = g.groundY(this.x, this.z, this.y + 1);
        if (this.y <= gy) {
          this.y = gy;
          this.vy = 0;
        }
        const f = Math.max(0, 1 - dt * 3);
        this.vx *= f;
        this.vz *= f;
        if (Math.hypot(this.vx, this.vz) < 0.05 && this.vy === 0) this.vx = this.vz = 0;
        [this.x, this.z] = g.solid(this.x, this.z, 0.3);
      }
      this.place();
      h.update(dt);
      return;
    }
    this.cool -= dt;
    this.hitT -= dt;
    this.panicT -= dt;
    if (this.role === 'civ') this.civ(g, dt);
    else this.cop(g, dt);
    // Don't stand inside the player.
    const p = g.player.pos;
    const dx = this.x - p.x;
    const dz = this.z - p.z;
    const d = Math.hypot(dx, dz);
    if (!g.player.inCar && d < 0.7 && d > 0.001 && Math.abs(this.y - p.y) < 1.5) {
      this.x = p.x + (dx / d) * 0.7;
      this.z = p.z + (dz / d) * 0.7;
    }
    this.place();
    h.update(dt);
  }

  private place(): void {
    this.human.root.position.set(this.x, this.y, this.z);
    this.human.heading = this.heading;
  }

  private civ(g: Game, dt: number): void {
    const h = this.human;
    if (this.hitT > 0) return;
    if (this.state === 'cower') {
      h.play('cower');
      if (this.panicT < 0) this.state = 'walk';
      return;
    }
    const fleeing = this.state === 'flee';
    if (fleeing && this.panicT < 0) this.state = 'walk';
    const speed = fleeing ? 5.2 : 1.4;
    if (!this.e) {
      h.play('idle');
      return;
    }
    if (this.cross) {
      const c = this.cross;
      const len = Math.hypot(c.bx - c.ax, c.bz - c.az) || 1;
      c.f = Math.min(1, c.f + (speed * dt) / len);
      this.heading = Math.atan2(c.bx - c.ax, c.bz - c.az);
      this.x = c.ax + (c.bx - c.ax) * c.f;
      this.z = c.az + (c.bz - c.az) * c.f;
      this.y = g.groundY(this.x, this.z, this.y + 1);
      if (c.f >= 1) this.onSidewalk(c.e, c.side, c.dir, c.s, g);
    } else {
      const e = this.e;
      const net = g.city.net;
      this.s += speed * dt;
      const endNode = net.nodes[this.dir > 0 ? e.b : e.a]!;
      const stop = Math.max(endNode.r - 1, 0) + 1;
      if (this.s >= e.len - stop) this.turn(g);
      else {
        this.walkPoint(g, this.s);
        this.heading = Math.atan2(P.x - this.x, P.z - this.z);
        this.x = P.x;
        this.y = P.y;
        this.z = P.z;
      }
    }
    h.play(fleeing ? 'run' : 'walk', fleeing ? 1.15 : 0.9);
  }

  /** At the end of a sidewalk: cross onto another street's sidewalk (or turn back). */
  private turn(g: Game): void {
    const net = g.city.net;
    const e = this.e!;
    const node = net.nodes[this.dir > 0 ? e.b : e.a]!;
    const opts = node.edges.map((id) => net.edges[id]!).filter((o) => o !== e && o.spec.sidewalk);
    if (!opts.length) {
      this.dir = this.dir > 0 ? -1 : 1;
      this.side = this.side > 0 ? -1 : 1;
      this.s = e.len - this.s;
      return;
    }
    const ne = opts[Math.floor(Math.random() * opts.length)]!;
    const dir: 1 | -1 = ne.a === node.id ? 1 : -1;
    const side: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const s = node.r + 1;
    const save = { e: this.e, dir: this.dir, side: this.side };
    this.e = ne;
    this.dir = dir;
    this.side = side;
    this.walkPoint(g, s);
    const bx = P.x;
    const bz = P.z;
    this.e = save.e;
    this.dir = save.dir;
    this.side = save.side;
    this.cross = { ax: this.x, az: this.z, bx, bz, f: 0, e: ne, side, dir, s };
  }

  /** Cops and SWAT on foot. */
  private cop(g: Game, dt: number): void {
    const h = this.human;
    const p = g.player.pos;
    if (g.police.level === 0) {
      h.play('idle');
      return;
    }
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const d = Math.hypot(dx, dz) || 1;
    this.heading = Math.atan2(dx, dz);
    this.seesPlayer = d < 70 && g.lineOfSight(this.x, this.y + 1.6, this.z, p.x, p.y + 1.2, p.z);
    const range = this.role === 'swat' ? 22 : 15;
    if (!this.seesPlayer || d > range) {
      const sp = 5.6;
      const nx = this.x + (dx / d) * sp * dt;
      const nz = this.z + (dz / d) * sp * dt;
      [this.x, this.z] = g.solid(nx, nz, 0.35);
      this.y = g.groundY(this.x, this.z, this.y + 1.2);
      h.play('run');
      return;
    }
    if (g.police.level === 1 && d < 2.4 && !g.player.inCar) {
      h.play('aim');
      g.police.tryArrest(dt);
      return;
    }
    h.play('aim');
    if (this.cool <= 0 && this.weapon && !g.player.dead && (g.police.level >= 2 || g.player.armed)) {
      this.cool = 60 / this.weapon.rpm + 0.35 + Math.random() * 0.6;
      const from = new THREE.Vector3(this.x, this.y + 1.45, this.z).addScaledVector(new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)), 0.5);
      const aim = new THREE.Vector3(p.x, p.y + 1.1, p.z);
      const miss = 0.05 + Math.min(0.25, g.player.speed * 0.02);
      aim.x += (Math.random() - 0.5) * miss * d;
      aim.y += (Math.random() - 0.5) * miss * d * 0.5;
      aim.z += (Math.random() - 0.5) * miss * d;
      const dir = aim.sub(from).normalize();
      fire(g, { from, dir, def: this.weapon, by: this, ignore: this.car });
      g.fx.muzzle(from);
      g.audio.gun(this.weapon.sfx[0], from, this.weapon.sfx[1]);
      h.fired();
    }
  }

  dispose(): void {
    this.human.dispose();
  }
}

export class Peds {
  list: Ped[] = [];
  /** Reusable people (no re-cloning skinned meshes mid-game). */
  private pool = new Map<string, Ped[]>();
  constructor(private g: Game) {}

  private make(role: Role, model: PersonModel): Ped {
    const key = `${role}/${model}`;
    const p = this.pool.get(key)?.pop();
    if (p) {
      p.dead = false;
      p.deadT = 0;
      p.health = role === 'swat' ? 160 : role === 'cop' ? 110 : 60;
      p.state = 'walk';
      p.vx = p.vz = p.vy = 0;
      p.panicT = 0;
      p.killedBy = p.lastAttacker = null;
      p.car = null;
      p.cross = null;
      p.human.play('idle');
      if (p.weapon) p.human.setGunLook(GUN_LOOK[p.weapon.look!]!);
      return p;
    }
    return new Ped(role, model);
  }

  /** Warm the pool (call while loading). */
  prewarm(n: number): void {
    for (let i = 0; i < n; i++) {
      const m = CIVS[i % CIVS.length]!;
      const p = new Ped('civ', m);
      const key = `civ/${m}`;
      if (!this.pool.has(key)) this.pool.set(key, []);
      this.pool.get(key)!.push(p);
    }
    for (let i = 0; i < 6; i++) {
      const p = new Ped('cop', 'swat');
      if (!this.pool.has('cop/swat')) this.pool.set('cop/swat', []);
      this.pool.get('cop/swat')!.push(p);
    }
  }

  spawnCiv(near: { x: number; z: number }, minD: number, maxD: number): Ped | null {
    const net = this.g.city.net;
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = minD + Math.random() * (maxD - minD);
      const n = net.nearest(near.x + Math.cos(a) * r, near.z + Math.sin(a) * r, 50);
      if (!n || !n.e.spec.sidewalk || net.raisedAt(n.e, n.s)) continue;
      const model = CIVS[Math.floor(Math.random() * CIVS.length)]!;
      const p = this.make('civ', model);
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      p.onSidewalk(n.e, Math.random() < 0.5 ? 1 : -1, dir, dir > 0 ? n.s : n.e.len - n.s, this.g);
      const d = Math.hypot(p.x - near.x, p.z - near.z);
      if (d < minD - 10) {
        this.release(p);
        continue;
      }
      this.add(p);
      return p;
    }
    return null;
  }

  spawnAt(role: Role, x: number, z: number): Ped {
    const model: PersonModel = role === 'civ' ? CIVS[Math.floor(Math.random() * CIVS.length)]! : 'swat';
    const p = this.make(role, model);
    p.e = null;
    p.x = x;
    p.z = z;
    p.y = this.g.groundY(x, z, 50);
    p.state = role === 'civ' ? 'flee' : 'combat';
    p.panicT = 10;
    // Civilians get back onto the nearest sidewalk.
    if (role === 'civ') {
      const n = this.g.city.net.nearest(x, z, 40);
      if (n && n.e.spec.sidewalk) {
        const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
        p.e = n.e;
        p.dir = dir;
        p.side = n.side > 0 ? 1 : -1;
        p.s = dir > 0 ? n.s : n.e.len - n.s;
      }
    }
    this.add(p);
    return p;
  }

  private add(p: Ped): void {
    this.list.push(p);
    this.g.scene.add(p.human.root);
  }

  private release(p: Ped): void {
    p.human.root.removeFromParent();
    const key = `${p.role}/${p.human.person}`;
    if (!this.pool.has(key)) this.pool.set(key, []);
    this.pool.get(key)!.push(p);
  }

  remove(p: Ped): void {
    this.list.splice(this.list.indexOf(p), 1);
    this.release(p);
  }

  panic(x: number, z: number, radius: number): void {
    for (const p of this.list) {
      if (p.dead || p.role !== 'civ') continue;
      if (Math.hypot(p.x - x, p.z - z) < radius) {
        p.panicT = 10 + Math.random() * 6;
        p.state = Math.random() < 0.2 ? 'cower' : 'flee';
        // Run away from it.
        if (p.state === 'flee' && p.e && !p.cross) {
          const net = this.g.city.net;
          const [tx, tz] = net.tangent(p.e, p.dir > 0 ? p.s : p.e.len - p.s);
          const away = (tx * p.dir) * (p.x - x) + (tz * p.dir) * (p.z - z);
          if (away < 0) {
            p.dir = p.dir > 0 ? -1 : 1;
            p.s = p.e.len - p.s;
          }
        }
      }
    }
  }

  update(dt: number): void {
    for (const p of this.list) p.update(this.g, dt);
  }
}
