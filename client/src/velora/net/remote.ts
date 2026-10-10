import * as THREE from 'three';
import type { CarModel, PersonModel } from '../assets';
import { Human, GUN_LOOK, type Pose } from '../actors/human';
import { Vehicle } from '../actors/vehicle';
import type { Game } from '../game';
import type { CarState, RemoteState } from './protocol';

/**
 * Everyone else in the session: their character (animated, with a name tag and their gun),
 * the car they're driving and the one they left parked — all drawn ~120 ms behind the latest
 * update, interpolated, so movement is smooth. Their cars are solid (kinematic) so you can
 * crash into them; the bullets you fire at them are reported to their owner.
 */

const DELAY = 0.12;

interface Sample {
  t: number;
  s: RemoteState;
}

function tag(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 34px "Barlow Condensed", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(name, 128, 32);
  g.fillStyle = '#9fd0ff';
  g.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.renderOrder = 10;
  return s;
}

export class RemotePlayer {
  human: Human;
  private name: THREE.Sprite;
  samples: Sample[] = [];
  car: Vehicle | null = null;
  parked: Vehicle | null = null;
  /** Interpolated state. */
  x = 0;
  y = 0;
  z = 0;
  alive = true;
  wanted = 0;
  inCar = false;
  model = '';
  kills = 0;
  deaths = 0;
  private gunKey = '';

  constructor(
    private g: Game,
    readonly id: string,
    public label: string,
    model: string,
  ) {
    this.model = model;
    this.human = new Human((model || 'casual') as PersonModel);
    this.name = tag(label);
    g.scene.add(this.human.root, this.name);
  }

  push(s: RemoteState, t: number): void {
    this.samples.push({ t, s });
    if (this.samples.length > 30) this.samples.shift();
    this.kills = s.kills;
    this.deaths = s.deaths;
    if (s.model !== this.model) {
      // Changed clothes.
      this.model = s.model;
      this.human.dispose();
      this.human = new Human(s.model as PersonModel);
      this.g.scene.add(this.human.root);
      this.gunKey = '';
    }
  }

  /** Interpolate to (now − DELAY). */
  update(now: number, dt: number): void {
    const at = now - DELAY;
    const ss = this.samples;
    if (!ss.length) return;
    let a = ss[0]!;
    let b = ss[ss.length - 1]!;
    for (let i = 0; i < ss.length - 1; i++)
      if (ss[i]!.t <= at && ss[i + 1]!.t >= at) {
        a = ss[i]!;
        b = ss[i + 1]!;
        break;
      }
    const span = b.t - a.t;
    const f = span > 0 ? Math.max(0, Math.min(1.2, (at - a.t) / span)) : 1;
    const A = a.s;
    const B = b.s;
    this.x = A.x + (B.x - A.x) * f;
    this.y = A.y + (B.y - A.y) * f;
    this.z = A.z + (B.z - A.z) * f;
    this.alive = B.alive;
    this.wanted = B.wanted;
    this.inCar = !!B.car;
    // Character.
    const h = this.human;
    h.root.visible = !B.car;
    if (!B.car) {
      let dh = B.h - A.h;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      h.heading = A.h + dh * f;
      h.root.position.set(this.x, this.y, this.z);
      h.play((B.alive ? B.pose : 'dead') as Pose);
      if (B.gun !== this.gunKey) {
        this.gunKey = B.gun;
        h.setGunLook(B.gun && GUN_LOOK[B.gun] ? GUN_LOOK[B.gun]! : null);
      }
    }
    h.update(dt);
    // Their car.
    this.car = this.syncCar(this.car, A.car, B.car, f, dt, now);
    this.parked = this.syncCar(this.parked, B.parked, B.parked, 1, dt, now);
    // Name tag over the head (or the car).
    const top = B.car ? (this.car?.roofY ?? 1.5) + 0.9 : 2.25;
    const p = B.car && this.car ? this.car.p : h.root.position;
    this.name.position.set(p.x, p.y + top, p.z);
    this.name.visible = B.alive;
  }

  private syncCar(v: Vehicle | null, A: CarState | null, B: CarState | null, f: number, dt: number, now: number): Vehicle | null {
    if (!B) {
      if (v) this.g.dropRemoteCar(v);
      return null;
    }
    if (!v || v.def.model !== B.model) {
      if (v) this.g.dropRemoteCar(v);
      v = this.g.addRemoteCar(B.model as CarModel, B.paint, this.id);
    }
    if (v.paintHex !== B.paint) v.repaint(B.paint);
    const a = A && A.model === B.model ? A : B;
    const qa = new THREE.Quaternion(a.qx, a.qy, a.qz, a.qw);
    const qb = new THREE.Quaternion(B.qx, B.qy, B.qz, B.qw);
    const q = qa.slerp(qb, Math.min(1, f));
    v.sirenOn = B.siren;
    v.health = B.hp;
    v.remotePose(a.x + (B.x - a.x) * f, a.y + (B.y - a.y) * f, a.z + (B.z - a.z) * f, q, B.v, dt, now);
    return v;
  }

  dispose(): void {
    if (this.car) this.g.dropRemoteCar(this.car);
    if (this.parked) this.g.dropRemoteCar(this.parked);
    this.human.dispose();
    this.name.removeFromParent();
  }
}

export class Remotes {
  readonly map = new Map<string, RemotePlayer>();
  private clock = 0;

  constructor(private g: Game) {}

  snapshot(players: RemoteState[], me: string): void {
    const t = this.clock;
    const seen = new Set<string>();
    for (const s of players) {
      if (s.id === me) continue;
      seen.add(s.id);
      let r = this.map.get(s.id);
      if (!r) this.map.set(s.id, (r = new RemotePlayer(this.g, s.id, s.name, s.model)));
      r.push(s, t);
    }
    for (const [id, r] of this.map)
      if (!seen.has(id)) {
        r.dispose();
        this.map.delete(id);
      }
  }

  update(dt: number): void {
    this.clock += dt;
    for (const r of this.map.values()) r.update(this.clock, dt);
  }

  /** The remote player whose car (driving or parked) uses this vehicle. */
  ownerOf(v: Vehicle): { r: RemotePlayer; parked: boolean } | null {
    for (const r of this.map.values()) {
      if (r.car === v) return { r, parked: false };
      if (r.parked === v) return { r, parked: true };
    }
    return null;
  }

  dispose(): void {
    for (const r of this.map.values()) r.dispose();
    this.map.clear();
  }
}
