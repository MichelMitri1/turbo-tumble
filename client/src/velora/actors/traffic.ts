import * as THREE from 'three';
import type { PersonModel } from '../assets';
import type { Game } from '../game';
import type { RoadNet, REdge } from '../world/net';
import { Vehicle, type CarDef } from './vehicle';

/**
 * AI drivers on the road network: keep to their lane round curves and over bridges, turn
 * at junctions (lefts from the inside lane), stop at red lights, merge on and off the
 * freeway, brake for cars / people / you and honk when you're in the way, and floor it when
 * shots ring out. Police drivers route to you over the network and ram you once they're close.
 */

export type Mode = 'traffic' | 'flee' | 'pursuit' | 'parked';

type Curve = [{ x: number; z: number }, { x: number; z: number }, { x: number; z: number }];

// ---------------------------------------------------------------- traffic lights

export const CYCLE = 26;
const groups = new Map<number, Map<number, number>>();
/** Which phase group an approach (edge) belongs to at a lit junction. */
function groupOf(net: RoadNet, node: number, edge: number): number {
  let g = groups.get(node);
  if (!g) {
    g = new Map();
    const n = net.nodes[node]!;
    let ref: number | null = null;
    for (const id of n.edges) {
      const e = net.edges[id]!;
      const [tx, tz] = net.tangent(e, e.a === node ? 0 : e.len);
      let a = Math.atan2(tz, tx);
      a = ((a % Math.PI) + Math.PI) % Math.PI;
      if (ref === null) ref = a;
      let d = Math.abs(a - ref);
      d = Math.min(d, Math.PI - d);
      g.set(id, d < Math.PI / 4 ? 0 : 1);
    }
    groups.set(node, g);
  }
  return g.get(edge) ?? 0;
}
export function lightFor(net: RoadNet, node: number, edge: number, time: number): 'green' | 'yellow' | 'red' {
  const n = net.nodes[node]!;
  if (!n.light) return 'green';
  const t = (time + node * 7.3) % CYCLE;
  const grp = groupOf(net, node, edge);
  if (grp === 0) return t < 11 ? 'green' : t < 13 ? 'yellow' : 'red';
  return t >= 13 && t < 24 ? 'green' : t >= 24 ? 'yellow' : 'red';
}

// ---------------------------------------------------------------- drivers

const P = { x: 0, y: 0, z: 0 };

export class Driver {
  e: REdge;
  dir: 1 | -1;
  lane: number;
  /** Distance travelled along the lane (in travel direction). */
  s: number;
  curve: Curve | null = null;
  next: { e: REdge; dir: 1 | -1; lane: number; turn: number } | null = null;
  mode: Mode;
  stuckT = 0;
  honkT = 0;
  fleeT = 0;
  person: PersonModel;
  private path: Array<[number, number]> = [];
  private repath = 0;
  crew = 0;
  private blockedByPlayer = false;

  constructor(readonly car: Vehicle, e: REdge, dir: 1 | -1, lane: number, s: number, mode: Mode, person: PersonModel) {
    this.e = e;
    this.dir = dir;
    this.lane = lane;
    this.s = s;
    this.mode = mode;
    this.person = person;
    car.driver = 'ai';
  }

  /** The node we're driving towards. */
  private get endNode(): number {
    return this.dir > 0 ? this.e.b : this.e.a;
  }

  update(g: Game, dt: number): void {
    const car = this.car;
    if (car.wrecked || car.health <= 0 || this.mode === 'parked') {
      car.input = { throttle: 0, steer: 0, handbrake: true };
      return;
    }
    const p = car.p;
    const f = car.f;
    const v = car.spd;
    let target: [number, number];
    let want: number;
    if (this.mode === 'pursuit') [target, want] = this.pursue(g, p, dt);
    else {
      [target, want] = this.follow(g, p, v);
      if (this.mode === 'flee') {
        want *= 1.7;
        this.fleeT -= dt;
        if (this.fleeT <= 0) this.mode = 'traffic';
      }
      const ahead = this.obstacle(g, p, f, v);
      if (ahead < Infinity) {
        want = Math.min(want, Math.max(0, (ahead - 6) * 0.9));
        if (ahead < 9 && this.mode === 'traffic' && this.blockedByPlayer) {
          this.honkT -= dt;
          if (this.honkT <= 0) {
            g.audio.horn(p);
            this.honkT = 2.5 + Math.random() * 3;
          }
        }
      }
    }
    // Pure pursuit steering.
    const tx = target[0] - p.x;
    const tz = target[1] - p.z;
    const ang = Math.atan2(f.x * tz - f.z * tx, f.x * tx + f.z * tz);
    let steer = Math.max(-1, Math.min(1, ang * 2.3));
    let throttle = Math.max(-1, Math.min(1, (want - v) * 0.3));
    if (want < 0.5 && v < 1) throttle = 0;
    if (want > 3 && Math.abs(v) < 0.4) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 3) {
      throttle = -0.7;
      steer = -steer;
      if (this.stuckT > 5) this.stuckT = 0;
    }
    if (car.flipped) throttle = steer = 0;
    car.input = { throttle, steer, handbrake: want < 0.5 && Math.abs(v) < 2 };
  }

  private follow(g: Game, p: THREE.Vector3, v: number): [[number, number], number] {
    const net = g.city.net;
    const e = this.e;
    let want = e.spec.speed;
    if (!this.curve) {
      // Progress: project onto the lane around where we were.
      const [tx, tz] = net.lane(e, this.dir, this.lane, this.s, P);
      this.s = Math.max(0, Math.min(e.len, this.s + (p.x - P.x) * tx + (p.z - P.z) * tz));
      const node = net.nodes[this.endNode]!;
      const stop = node.r + 2;
      const end = e.len - stop;
      if (!this.next) this.next = this.pick(net);
      const toLine = end - this.s;
      // Lights.
      if (this.mode === 'traffic' && node.light && toLine > 0.5 && toLine < 34) {
        const l = lightFor(net, node.id, e.id, g.time);
        if (l === 'red' || (l === 'yellow' && toLine > 9)) want = Math.min(want, Math.sqrt(Math.max(0, 2 * 4.5 * (toLine - 1.5))));
      }
      // Slow for the turn.
      if (this.next && Math.abs(this.next.turn) > 0.5) want = Math.min(want, Math.max(7, toLine * 0.5));
      // Slow for bends.
      const [ax, az] = net.tangent(e, this.dir > 0 ? this.s : e.len - this.s);
      const [bx, bz] = net.tangent(e, this.dir > 0 ? Math.min(e.len, this.s + 25) : Math.max(0, e.len - this.s - 25));
      const bend = Math.acos(Math.max(-1, Math.min(1, ax * bx + az * bz)));
      if (bend > 0.15) want = Math.min(want, Math.max(9, 26 - bend * 30));
      if (this.s >= end - 0.5 || (node.r === 0 && this.s >= e.len - 1)) {
        if (this.next) this.curve = this.turnCurve(net, stop);
        else {
          // Dead end: turn round.
          this.dir = this.dir > 0 ? -1 : 1;
          this.s = e.len - this.s;
        }
      } else {
        const look = Math.max(7, Math.abs(v) * 0.75);
        net.lane(e, this.dir, this.lane, Math.min(e.len, this.s + look), P);
        return [[P.x, P.z], want];
      }
    }
    // Through the junction.
    const c = this.curve!;
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k <= 12; k++) {
      const q = bez(c, k / 12);
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = k / 12;
      }
    }
    const nx = this.next!;
    want = Math.abs(nx.turn) > 0.5 ? 7.5 : 12;
    if (best >= 0.9) {
      this.e = nx.e;
      this.dir = nx.dir;
      this.lane = nx.lane;
      this.s = net.nodes[nx.dir > 0 ? nx.e.a : nx.e.b]!.r + 2;
      this.next = null;
      this.curve = null;
      net.lane(this.e, this.dir, this.lane, this.s + 6, P);
      return [[P.x, P.z], want];
    }
    const q = bez(c, Math.min(1, best + 0.3));
    return [[q.x, q.z], want];
  }

  /** Where to go at the next junction. */
  private pick(net: RoadNet): Driver['next'] {
    const node = net.nodes[this.endNode]!;
    const [ix, iz] = (() => {
      const [tx, tz] = net.tangent(this.e, this.dir > 0 ? this.e.len : 0);
      return this.dir > 0 ? [tx, tz] : [-tx, -tz];
    })();
    const opts: Array<NonNullable<Driver['next']>> = [];
    for (const id of node.edges) {
      if (id === this.e.id && node.edges.length > 1) continue;
      const ne = net.edges[id]!;
      const dir: 1 | -1 = ne.a === node.id ? 1 : -1;
      const [tx0, tz0] = net.tangent(ne, dir > 0 ? 0 : ne.len);
      const ox = dir > 0 ? tx0 : -tx0;
      const oz = dir > 0 ? tz0 : -tz0;
      const cross = ix * oz - iz * ox; // + = right turn
      const dot = ix * ox + iz * oz;
      if (dot < -0.85 && node.edges.length > 1) continue; // no U-turn
      const turn = dot > 0.7 ? 0 : cross > 0 ? 1 : -1;
      const lanes = ne.spec.lanes;
      const lane = turn < 0 ? 0 : turn > 0 ? lanes - 1 : Math.min(this.lane, lanes - 1);
      opts.push({ e: ne, dir, lane, turn });
    }
    if (!opts.length) return null;
    // Prefer going straight on bigger roads.
    const straight = opts.filter((o) => o.turn === 0);
    if (straight.length && Math.random() < 0.55) return straight[Math.floor(Math.random() * straight.length)]!;
    return opts[Math.floor(Math.random() * opts.length)]!;
  }

  private turnCurve(net: RoadNet, stop: number): Curve {
    const nx = this.next!;
    const a = { x: 0, y: 0, z: 0 };
    const [ax, az] = net.lane(this.e, this.dir, this.lane, this.e.len - stop, a);
    const node = net.nodes[nx.dir > 0 ? nx.e.a : nx.e.b]!;
    const b = { x: 0, y: 0, z: 0 };
    const [bx, bz] = net.lane(nx.e, nx.dir, nx.lane, node.r + 2, b);
    // Control point: where the two lane lines cross (else halfway).
    const den = ax * bz - az * bx;
    let c = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (Math.abs(den) > 0.2) {
      const t = ((b.x - a.x) * bz - (b.z - a.z) * bx) / den;
      if (t > 0 && t < 60) c = { x: a.x + ax * t, z: a.z + az * t };
    }
    return [{ x: a.x, z: a.z }, c, { x: b.x, z: b.z }];
  }

  /** Distance to the nearest thing ahead in our path. */
  private obstacle(g: Game, p: THREE.Vector3, f: THREE.Vector3, v: number): number {
    const reach = 9 + Math.max(0, v) * 1.5;
    let best = Infinity;
    this.blockedByPlayer = false;
    const check = (x: number, y: number, z: number, width: number, isPlayer = false) => {
      if (Math.abs(y - p.y) > 3) return;
      const rx = x - p.x;
      const rz = z - p.z;
      if (Math.abs(rx) > reach || Math.abs(rz) > reach) return;
      const fwd = rx * f.x + rz * f.z;
      if (fwd <= 0 || fwd > reach) return;
      const lat = Math.abs(rx * f.z - rz * f.x);
      if (lat > width) return;
      if (fwd < best) {
        best = fwd;
        this.blockedByPlayer = isPlayer;
      }
    };
    for (const o of g.vehicles) if (o !== this.car) check(o.p.x, o.p.y, o.p.z, 2.4, o.driver === 'player');
    for (const o of g.peds.list) if (!o.dead) check(o.x, o.y, o.z, 1.6);
    if (!g.player.inCar) check(g.player.pos.x, g.player.pos.y, g.player.pos.z, 1.6, true);
    return best;
  }

  /** Police: drive to the suspect over the network; straight at them when close. */
  private pursue(g: Game, p: THREE.Vector3, dt: number): [[number, number], number] {
    const t = g.player.pos;
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    this.car.sirenOn = true;
    if (d < 50 || (d < 120 && g.lineOfSight(p.x, p.y + 1.5, p.z, t.x, t.y + 1, t.z))) {
      const tv = g.player.vel;
      const lead = Math.min(1.2, d / 30);
      const want = g.player.inCar ? 45 : Math.max(0, Math.min(20, (d - 9) * 1.4));
      return [[t.x + tv.x * lead, t.z + tv.z * lead], want];
    }
    this.repath -= dt;
    const net = g.city.net;
    if (this.repath <= 0 || !this.path.length) {
      this.repath = 2;
      const nodes = net.route(net.nearestNode(p.x, p.z).id, net.nearestNode(t.x, t.z).id);
      // Follow the actual road shapes between nodes.
      this.path = [];
      for (let k = 0; k < nodes.length - 1; k++) {
        const e = net.between(nodes[k]!, nodes[k + 1]!);
        if (!e) continue;
        const fwd = e.a === nodes[k];
        for (let s = 0; s <= e.len; s += 12) {
          net.point(e, fwd ? s : e.len - s, P);
          this.path.push([P.x, P.z]);
        }
      }
      this.path.push([t.x, t.z]);
    }
    while (this.path.length > 1 && Math.hypot(this.path[0]![0] - p.x, this.path[0]![1] - p.z) < 12) this.path.shift();
    return [this.path[0]!, 38];
  }
}

function bez(c: Curve, t: number): { x: number; z: number } {
  const u = 1 - t;
  return { x: u * u * c[0].x + 2 * u * t * c[1].x + t * t * c[2].x, z: u * u * c[0].z + 2 * u * t * c[1].z + t * t * c[2].z };
}

// ---------------------------------------------------------------- spawning

export interface Spot {
  e: REdge;
  dir: 1 | -1;
  lane: number;
  s: number;
  x: number;
  y: number;
  z: number;
  h: number;
}

/** A free lane spot `minD … maxD` from a point. */
export function laneSpot(g: Game, near: { x: number; z: number }, minD: number, maxD: number): Spot | null {
  const net = g.city.net;
  for (let k = 0; k < 24; k++) {
    // Sample a point in the ring, take the road nearest to it.
    const a = Math.random() * Math.PI * 2;
    const r = minD + Math.random() * (maxD - minD);
    const n = net.nearest(near.x + Math.cos(a) * r, near.z + Math.sin(a) * r, 60);
    if (!n) continue;
    const e = n.e;
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const lane = Math.floor(Math.random() * e.spec.lanes);
    const s = dir > 0 ? n.s : e.len - n.s;
    const nodeA = net.nodes[dir > 0 ? e.a : e.b]!;
    const nodeB = net.nodes[dir > 0 ? e.b : e.a]!;
    if (s < nodeA.r + 6 || s > e.len - nodeB.r - 8) continue;
    const pt = { x: 0, y: 0, z: 0 };
    const [tx, tz] = net.lane(e, dir, lane, s, pt);
    const d = Math.hypot(pt.x - near.x, pt.z - near.z);
    if (d < minD || d > maxD) continue;
    if (g.vehicles.some((v) => Math.abs(v.p.x - pt.x) < 9 && Math.abs(v.p.z - pt.z) < 9)) continue;
    return { e, dir, lane, s, x: pt.x, y: pt.y, z: pt.z, h: Math.atan2(tx, tz) };
  }
  return null;
}

export function spawnTraffic(g: Game, model: CarDef['model'], spot: Spot, mode: Mode, person: PersonModel): Driver {
  const car = g.addVehicle(model, spot.x, spot.z, spot.h, undefined, spot.y + 0.4);
  const d = new Driver(car, spot.e, spot.dir, spot.lane, spot.s, mode, person);
  const sp = mode === 'pursuit' ? 18 : spot.e.spec.speed * 0.8;
  car.body.setLinvel({ x: Math.sin(spot.h) * sp, y: 0, z: Math.cos(spot.h) * sp }, true);
  return d;
}
