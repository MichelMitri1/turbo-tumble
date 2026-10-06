import { Vector3 } from 'three';
import { arenaDistance, arenaNormal, ARENA } from './arena';
import { Ball } from './ball';
import { Car, NO_CONTROLS, type Controls } from './car';
import * as C from './constants';

export interface PlayerInfo {
  id: number;
  name: string;
  team: 0 | 1;
  bot: boolean;
  body: C.CarBody['id'];
}

export interface Stats {
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  demos: number;
  touches: number;
  score: number;
}

export type WorldEvent =
  | { k: 'countdown'; n: number }
  | { k: 'go' }
  | { k: 'touch'; car: number; power: number; x: number; y: number; z: number }
  | { k: 'bounce'; power: number; x: number; y: number; z: number }
  | { k: 'goal'; team: 0 | 1; scorer: number; assist: number; speed: number; x: number; y: number; z: number }
  | { k: 'demo'; attacker: number; victim: number; x: number; y: number; z: number }
  | { k: 'bump'; car: number; other: number }
  | { k: 'pad'; car: number; big: boolean; index: number }
  | { k: 'jump'; car: number }
  | { k: 'dodge'; car: number }
  | { k: 'kickoff' }
  | { k: 'overtime' }
  | { k: 'over'; winner: 0 | 1 };

export type Phase = 'countdown' | 'play' | 'goal' | 'over';

const tmp = () => new Vector3();

/**
 * A soccar match: cars, ball, boost pads, kickoffs, goals, the clock and
 * overtime. Fixed 120 Hz step; pure logic (runs on the server too).
 */
export class World {
  readonly ball = new Ball();
  readonly cars: Car[] = [];
  readonly players: PlayerInfo[] = [];
  readonly stats = new Map<number, Stats>();
  readonly pads = C.BOOST_PADS.map((p) => ({ ...p, timer: 0 }));
  score: [number, number] = [0, 0];
  phase: Phase = 'countdown';
  phaseTimer = 3;
  /** Seconds left (counts up in overtime). */
  clock: number;
  overtime = false;
  tickCount = 0;
  events: WorldEvent[] = [];
  winner: 0 | 1 | -1 = -1;
  private lastCountdown = 4;
  private touches: Array<{ car: number; team: 0 | 1; t: number }> = [];
  private readonly extraHitTick = new Map<number, number>();
  private readonly v1 = tmp();
  private readonly v2 = tmp();
  private readonly v3 = tmp();
  private readonly v4 = tmp();
  private rng: number;

  constructor(
    players: PlayerInfo[],
    readonly matchLength = 300,
    seed = 1,
  ) {
    this.rng = seed || 1;
    this.clock = matchLength;
    for (const p of players) {
      this.players.push(p);
      this.cars.push(new Car(p.id, p.team, C.BODIES[p.body]));
      this.stats.set(p.id, { goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, touches: 0, score: 0 });
    }
    this.kickoff();
  }

  private rand(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  car(id: number): Car | undefined {
    return this.cars.find((c) => c.id === id);
  }

  // ---------------------------------------------------------------- kickoff

  kickoff(): void {
    this.ball.reset();
    for (const p of this.pads) p.timer = 0;
    const perTeam = [0, 1].map((t) => this.cars.filter((c) => c.team === t));
    const n = Math.max(perTeam[0]!.length, perTeam[1]!.length);
    // Random spawn slots, mirrored for orange (Rocket League does the same).
    const slots = [0, 1, 2, 3, 4].sort(() => this.rand() - 0.5).slice(0, Math.min(5, n));
    for (const team of [0, 1] as const) {
      perTeam[team]!.forEach((car, i) => {
        const [x, y, yaw] = C.KICKOFF_SPAWNS[slots[i % slots.length]!]!;
        if (team === 0) car.place(x, y, yaw);
        else car.place(-x, -y, yaw + Math.PI);
      });
    }
    this.phase = 'countdown';
    this.phaseTimer = 3;
    this.lastCountdown = 4;
    this.events.push({ k: 'kickoff' });
  }

  // ---------------------------------------------------------------- step

  step(inputs: ReadonlyMap<number, Controls>): void {
    const dt = C.TICK;
    this.tickCount++;
    if (this.phase === 'over') {
      this.physics(dt, inputs, true);
      return;
    }
    if (this.phase === 'countdown') {
      this.phaseTimer -= dt;
      const n = Math.ceil(this.phaseTimer);
      if (n !== this.lastCountdown && n > 0) {
        this.lastCountdown = n;
        this.events.push({ k: 'countdown', n });
      }
      if (this.phaseTimer <= 0) {
        this.phase = 'play';
        this.events.push({ k: 'go' });
      }
      // Cars sit still during the countdown.
      for (const car of this.cars) car.tick(dt, NO_CONTROLS);
      for (const car of this.cars) {
        car.vel.set(0, 0, 0);
        car.angVel.set(0, 0, 0);
      }
      return;
    }
    this.physics(dt, inputs, this.phase !== 'play');
    if (this.phase === 'play') {
      this.checkGoal();
      if (!this.overtime) {
        this.clock = Math.max(0, this.clock - dt);
        // Time's up: the match ends once the ball touches the ground (unless tied).
        if (this.clock <= 0 && this.phase === 'play') {
          if (this.score[0] === this.score[1]) {
            this.overtime = true;
            this.clock = 0;
            this.events.push({ k: 'overtime' });
            this.kickoff();
          } else if (this.ball.pos.z < C.BALL_WORLD_RADIUS + 10) this.finish();
        }
      } else this.clock += dt;
    } else if (this.phase === 'goal') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (this.overtime) this.finish();
        else if (this.clock <= 0 && this.score[0] !== this.score[1]) this.finish();
        else if (this.clock <= 0) {
          this.overtime = true;
          this.events.push({ k: 'overtime' });
          this.kickoff();
        } else this.kickoff();
      }
    }
  }

  private finish(): void {
    this.phase = 'over';
    this.winner = this.score[0] > this.score[1] ? 0 : 1;
    this.events.push({ k: 'over', winner: this.winner });
  }

  private physics(dt: number, inputs: ReadonlyMap<number, Controls>, ballFrozen: boolean): void {
    for (const car of this.cars) {
      if (car.demolished) {
        car.respawnTimer -= dt;
        if (car.respawnTimer <= 0) this.respawn(car);
        continue;
      }
      const wasJumping = car.hasJumped;
      const wasFlipped = car.hasFlipped;
      car.tick(dt, inputs.get(car.id) ?? NO_CONTROLS);
      if (!wasJumping && car.hasJumped) this.events.push({ k: 'jump', car: car.id });
      if (!wasFlipped && car.hasFlipped) this.events.push({ k: 'dodge', car: car.id });
    }
    for (const car of this.cars) if (!car.demolished) this.collideCarWorld(car);
    for (const car of this.cars) car.integrate(dt);
    if (!ballFrozen || this.phase === 'over') this.ball.tick(dt);
    if (this.ball.bounce > 250) this.events.push({ k: 'bounce', power: this.ball.bounce, x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.pos.z });
    if (!ballFrozen) for (const car of this.cars) if (!car.demolished) this.collideCarBall(car);
    for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) this.collideCars(this.cars[i]!, this.cars[j]!);
    this.updatePads(dt);
  }

  private respawn(car: Car): void {
    const opts = C.RESPAWNS;
    const [x, y, yaw] = opts[Math.floor(this.rand() * opts.length)]!;
    if (car.team === 0) car.place(x, y, yaw);
    else car.place(-x, -y, yaw + Math.PI);
  }

  // ---------------------------------------------------------------- car ↔ world

  private readonly corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => new Vector3(x, y, z))));

  private collideCarWorld(car: Car): void {
    car.worldContact = false;
    const center = car.hitboxCenter(this.v4);
    for (let iter = 0; iter < 4; iter++) {
      let deepest = 0;
      let point: Vector3 | null = null;
      for (const c of this.corners) {
        const p = this.v1.copy(c).multiply(car.halfExtents).applyQuaternion(car.quat).add(center);
        const d = arenaDistance(p.x, p.y, p.z);
        if (d < 1.5 && !car.worldContact) {
          car.worldContact = true;
          arenaNormal(p.x, p.y, p.z, car.worldContactNormal);
        }
        if (d < deepest) {
          deepest = d;
          point = this.v2.copy(p);
        }
      }
      if (!point) return;
      const n = arenaNormal(point.x, point.y, point.z, this.v3);
      car.pos.addScaledVector(n, -deepest);
      center.addScaledVector(n, -deepest);
      point.addScaledVector(n, -deepest);
      car.worldContact = true;
      car.worldContactNormal.copy(n);
      const r = this.v1.copy(point).sub(car.pos);
      const pv = r.clone().crossVectors(car.angVel, r).add(car.vel);
      const vn = pv.dot(n);
      if (vn >= 0) continue;
      const j = (-(1 + C.CARWORLD_RESTITUTION) * vn) / car.invMassAt(point, n);
      car.applyImpulse(n.clone().multiplyScalar(j), point);
      const vt = pv.addScaledVector(n, -vn);
      const vtl = vt.length();
      if (vtl > 1e-3) {
        const t = vt.multiplyScalar(1 / vtl);
        const jt = Math.min(C.CARWORLD_FRICTION * j, vtl / car.invMassAt(point, t));
        car.applyImpulse(t.multiplyScalar(-jt), point);
      }
    }
  }

  // ---------------------------------------------------------------- car ↔ ball

  private collideCarBall(car: Car): void {
    const ball = this.ball;
    const center = car.hitboxCenter(this.v1);
    const inv = car.quat.clone().invert();
    const local = this.v2.copy(ball.pos).sub(center).applyQuaternion(inv);
    const he = car.halfExtents;
    const closest = this.v3.set(Math.max(-he.x, Math.min(he.x, local.x)), Math.max(-he.y, Math.min(he.y, local.y)), Math.max(-he.z, Math.min(he.z, local.z)));
    const diff = local.clone().sub(closest);
    let dist = diff.length();
    if (dist >= C.BALL_RADIUS) {
      this.checkFlipReset(car);
      return;
    }
    let nLocal: Vector3;
    if (dist < 1e-4) {
      // Ball centre inside the box: push out along the shallowest axis.
      const px = he.x - Math.abs(local.x);
      const py = he.y - Math.abs(local.y);
      const pz = he.z - Math.abs(local.z);
      nLocal = px < py && px < pz ? new Vector3(Math.sign(local.x) || 1, 0, 0) : py < pz ? new Vector3(0, Math.sign(local.y) || 1, 0) : new Vector3(0, 0, Math.sign(local.z) || 1);
      dist = 0;
    } else nLocal = diff.multiplyScalar(1 / dist);
    const n = nLocal.applyQuaternion(car.quat).normalize();
    const contact = closest.applyQuaternion(car.quat).add(center);
    // Separate (ball is 1/6 of the car's mass).
    const pen = C.BALL_RADIUS - dist;
    ball.pos.addScaledVector(n, pen * (6 / 7));
    car.pos.addScaledVector(n, -pen / 7);
    // Relative velocity at the contact.
    const preBallVel = ball.vel.clone();
    const rb = contact.clone().sub(ball.pos);
    const vb = new Vector3().crossVectors(ball.angVel, rb).add(ball.vel);
    const rc = contact.clone().sub(car.pos);
    const vc = new Vector3().crossVectors(car.angVel, rc).add(car.vel);
    const rel = vb.sub(vc);
    const vn = rel.dot(n);
    if (vn < 0) {
      const invM = 1 / C.BALL_MASS + car.invMassAt(contact, n);
      const jn = -vn / invM; // restitution 0 for car-ball
      ball.vel.addScaledVector(n, jn / C.BALL_MASS);
      car.applyImpulse(n.clone().multiplyScalar(-jn), contact);
      // Friction (high: the ball grips the car).
      const vt = rel.addScaledVector(n, -vn);
      const vtl = vt.length();
      if (vtl > 1e-3) {
        const t = vt.multiplyScalar(1 / vtl);
        const I = 0.4 * C.BALL_MASS * C.BALL_RADIUS * C.BALL_RADIUS;
        const invMt = 1 / C.BALL_MASS + (C.BALL_RADIUS * C.BALL_RADIUS) / I + car.invMassAt(contact, t);
        const jt = Math.min(C.CARBALL_FRICTION * jn, vtl / invMt);
        const J = t.multiplyScalar(-jt);
        ball.vel.addScaledVector(J, 1 / C.BALL_MASS);
        ball.angVel.add(new Vector3().crossVectors(rb, J).multiplyScalar(1 / I));
        car.applyImpulse(J.clone().negate(), contact);
      }
    }
    // Psyonix "extra" impulse, at most every other tick per car.
    const last = this.extraHitTick.get(car.id) ?? -10;
    if (this.tickCount > last + 1) {
      this.extraHitTick.set(car.id, this.tickCount);
      const relV = preBallVel.clone().sub(car.vel);
      const relSpeed = Math.min(relV.length(), C.BALL_EXTRA_MAX_DV);
      if (relSpeed > 0) {
        const hitDir = ball.pos.clone().sub(car.pos).multiply(new Vector3(1, 1, C.BALL_EXTRA_Z_SCALE)).normalize();
        hitDir.addScaledVector(car.forward, -hitDir.dot(car.forward) * (1 - C.BALL_EXTRA_FORWARD_SCALE)).normalize();
        ball.vel.addScaledVector(hitDir, relSpeed * C.curve(C.BALL_EXTRA_CURVE, relSpeed));
      }
      this.touch(car, relSpeed);
    }
    if (ball.vel.lengthSq() > C.BALL_MAX_SPEED ** 2) ball.vel.setLength(C.BALL_MAX_SPEED);
  }

  private touch(car: Car, power: number): void {
    const prev = this.touches[this.touches.length - 1];
    const now = this.tickCount * C.TICK;
    if (!prev || prev.car !== car.id || now - prev.t > 0.2) {
      this.touches.push({ car: car.id, team: car.team, t: now });
      if (this.touches.length > 8) this.touches.shift();
      const s = this.stats.get(car.id)!;
      s.touches++;
      s.score += 2;
      // Save: ball heading into own goal, cleared by a defender.
      const ownGoalY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
      const b = this.ball;
      if (Math.sign(b.pos.y) === Math.sign(ownGoalY) && Math.abs(b.pos.y) > 3500 && Math.abs(b.pos.x) < 1300) {
        s.saves++;
        s.score += 50;
      }
    }
    this.ball.lastTouch = car.id;
    this.ball.lastTouchTeam = car.team;
    this.events.push({ k: 'touch', car: car.id, power, x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.pos.z });
  }

  /** Wheels touching the ball while airborne give back the flip. */
  private checkFlipReset(car: Car): void {
    if (car.onGround || car.numContacts) return;
    const b = this.ball.pos;
    let touching = 0;
    for (const w of car.wheels) {
      const hp = this.v4.copy(w.local).applyQuaternion(car.quat).add(car.pos);
      const d = hp.distanceTo(b) - C.BALL_RADIUS;
      if (d < w.radius + 8) touching++;
    }
    if (touching >= 3) car.flipReset();
  }

  // ---------------------------------------------------------------- car ↔ car

  private collideCars(a: Car, b: Car): void {
    if (a.demolished || b.demolished) return;
    const ca = a.hitboxCenter(this.v1.clone());
    const cb = b.hitboxCenter(this.v2.clone());
    if (ca.distanceToSquared(cb) > 200 * 200) return;
    const axesA = [a.forward, a.left, a.up];
    const axesB = [b.forward, b.left, b.up];
    const ha = [a.halfExtents.x, a.halfExtents.y, a.halfExtents.z];
    const hb = [b.halfExtents.x, b.halfExtents.y, b.halfExtents.z];
    const d = cb.clone().sub(ca);
    let best = Infinity;
    const bestAxis = new Vector3();
    const test = (L: Vector3) => {
      const len = L.length();
      if (len < 1e-6) return true;
      const ax = L.clone().multiplyScalar(1 / len);
      const ra = ha[0]! * Math.abs(axesA[0]!.dot(ax)) + ha[1]! * Math.abs(axesA[1]!.dot(ax)) + ha[2]! * Math.abs(axesA[2]!.dot(ax));
      const rb = hb[0]! * Math.abs(axesB[0]!.dot(ax)) + hb[1]! * Math.abs(axesB[1]!.dot(ax)) + hb[2]! * Math.abs(axesB[2]!.dot(ax));
      const dist = d.dot(ax);
      const overlap = ra + rb - Math.abs(dist);
      if (overlap < 0) return false;
      if (overlap < best) {
        best = overlap;
        bestAxis.copy(ax).multiplyScalar(dist < 0 ? -1 : 1);
      }
      return true;
    };
    for (const A of axesA) if (!test(A)) return;
    for (const B of axesB) if (!test(B)) return;
    for (const A of axesA) for (const B of axesB) if (!test(new Vector3().crossVectors(A, B))) return;
    // Collision: n points from a to b.
    const n = bestAxis;
    a.pos.addScaledVector(n, -best / 2);
    b.pos.addScaledVector(n, best / 2);
    const contact = ca.clone().add(cb).multiplyScalar(0.5);
    const rel = new Vector3().crossVectors(b.angVel, contact.clone().sub(b.pos)).add(b.vel).sub(new Vector3().crossVectors(a.angVel, contact.clone().sub(a.pos)).add(a.vel));
    const vn = rel.dot(n);
    if (vn < 0) {
      const j = (-(1 + C.CARCAR_RESTITUTION) * vn) / (a.invMassAt(contact, n) + b.invMassAt(contact, n));
      b.applyImpulse(n.clone().multiplyScalar(j), contact);
      a.applyImpulse(n.clone().multiplyScalar(-j), contact);
    }
    // Bumps & demos: whoever hits with their nose.
    for (const [att, vic, dir] of [[a, b, n], [b, a, n.clone().negate()]] as const) {
      if (att.bumpCooldown > 0) continue;
      const nose = att.forward.dot(dir);
      const front = contact.clone().sub(att.pos).dot(att.forward);
      if (nose < 0.5 || front < 30) continue;
      if (att.forwardSpeed < 400) continue;
      att.bumpCooldown = C.BUMP_COOLDOWN;
      if (att.supersonic && att.team !== vic.team) {
        vic.demolished = true;
        vic.respawnTimer = C.DEMO_RESPAWN;
        this.stats.get(att.id)!.demos++;
        this.stats.get(att.id)!.score += 15;
        this.events.push({ k: 'demo', attacker: att.id, victim: vic.id, x: vic.pos.x, y: vic.pos.y, z: vic.pos.z });
      } else {
        const speed = att.forwardSpeed;
        const flat = dir.clone().setZ(0).normalize();
        vic.vel.addScaledVector(flat, C.curve(vic.onGround ? C.BUMP_GROUND_CURVE : C.BUMP_AIR_CURVE, speed) * 0.6);
        vic.vel.z += C.curve(C.BUMP_UP_CURVE, speed) * 0.6;
        this.events.push({ k: 'bump', car: att.id, other: vic.id });
      }
      break;
    }
  }

  // ---------------------------------------------------------------- pads & goals

  private updatePads(dt: number): void {
    this.pads.forEach((pad, i) => {
      if (pad.timer > 0) {
        pad.timer -= dt;
        return;
      }
      const r = pad.big ? C.PAD_RADIUS_BIG : C.PAD_RADIUS_SMALL;
      for (const car of this.cars) {
        if (car.demolished || car.boost >= 100) continue;
        if (car.pos.z > C.PAD_HEIGHT + 20) continue;
        if ((car.pos.x - pad.x) ** 2 + (car.pos.y - pad.y) ** 2 > r * r) continue;
        car.boost = Math.min(100, car.boost + (pad.big ? 100 : 12));
        pad.timer = pad.big ? C.PAD_COOLDOWN_BIG : C.PAD_COOLDOWN_SMALL;
        this.events.push({ k: 'pad', car: car.id, big: pad.big, index: i });
        break;
      }
    });
  }

  private checkGoal(): void {
    const b = this.ball.pos;
    if (Math.abs(b.y) < ARENA.goalLineY + C.BALL_RADIUS) return;
    const team: 0 | 1 = b.y > 0 ? 0 : 1;
    this.score[team]++;
    // Credit: the last toucher on the scoring team, an assist to their previous teammate.
    const now = this.tickCount * C.TICK;
    const mine = this.touches.filter((t) => t.team === team);
    const scorer = mine[mine.length - 1];
    const assist = [...mine].reverse().find((t) => t.car !== scorer?.car && now - t.t < 5);
    if (scorer) {
      const s = this.stats.get(scorer.car)!;
      s.goals++;
      s.shots++;
      s.score += 100;
    }
    if (assist) {
      const s = this.stats.get(assist.car)!;
      s.assists++;
      s.score += 50;
    }
    this.events.push({ k: 'goal', team, scorer: scorer?.car ?? -1, assist: assist?.car ?? -1, speed: this.ball.vel.length(), x: b.x, y: b.y, z: b.z });
    this.phase = 'goal';
    this.phaseTimer = 3;
    this.touches = [];
  }
}
