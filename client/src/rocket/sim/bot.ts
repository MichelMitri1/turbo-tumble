import { Vector3 } from 'three';
import { Ball } from './ball';
import { ARENA } from './arena';
import { NO_CONTROLS, type Car, type Controls } from './car';
import * as C from './constants';
import type { World } from './world';

export type BotLevel = 'rookie' | 'pro' | 'allstar';

const LEVEL = {
  rookie: { reaction: 0.35, boost: 0.35, flips: false, aerial: false, maxSpeed: 0.8, aim: 0.5 },
  pro: { reaction: 0.15, boost: 0.8, flips: true, aerial: false, maxSpeed: 1, aim: 0.85 },
  allstar: { reaction: 0.05, boost: 1, flips: true, aerial: true, maxSpeed: 1, aim: 1 },
};

interface Mem {
  think: number;
  /** Planned dodge: seconds until the second jump press. */
  dodgeIn: number;
  dodgePitch: number;
  dodgeYaw: number;
  jumpHold: number;
  aerial: number;
  target: Vector3;
  lastOut: Controls;
}

const PREDICT_STEP = 1 / 30;
const PREDICT_TIME = 3;

/** Rocket League bots: chase / shoot / save / rotate, with flips and simple aerials. */
export class Bots {
  private mem = new Map<number, Mem>();
  private prediction: Array<{ t: number; pos: Vector3 }> = [];
  private predictTimer = 0;

  constructor(
    private readonly world: World,
    readonly level: BotLevel = 'pro',
  ) {}

  /** Controls for every bot car this tick. */
  update(dt: number, out: Map<number, Controls>): void {
    const w = this.world;
    this.predictTimer -= dt;
    if (this.predictTimer <= 0) {
      this.predictTimer = 0.1;
      this.predictBall();
    }
    for (const p of w.players) {
      if (!p.bot) continue;
      const car = w.car(p.id);
      if (!car) continue;
      let m = this.mem.get(p.id);
      if (!m) {
        m = { think: 0, dodgeIn: -1, dodgePitch: 0, dodgeYaw: 0, jumpHold: 0, aerial: 0, target: new Vector3(), lastOut: { ...NO_CONTROLS } };
        this.mem.set(p.id, m);
      }
      out.set(p.id, car.demolished || w.phase === 'countdown' ? { ...NO_CONTROLS } : this.drive(car, m, dt));
    }
  }

  private predictBall(): void {
    const b = this.world.ball;
    const sim = new Ball();
    sim.pos.copy(b.pos);
    sim.vel.copy(b.vel);
    sim.angVel.copy(b.angVel);
    this.prediction = [];
    for (let t = 0; t <= PREDICT_TIME; t += PREDICT_STEP) {
      this.prediction.push({ t, pos: sim.pos.clone() });
      for (let k = 0; k < 4; k++) sim.tick(PREDICT_STEP / 4);
    }
  }

  // -------------------------------------------------------------- decisions

  private drive(car: Car, m: Mem, dt: number): Controls {
    const L = LEVEL[this.level];
    const w = this.world;
    const out: Controls = { ...NO_CONTROLS };
    // Dodge in progress (second press of a flip).
    if (m.jumpHold > 0) {
      m.jumpHold -= dt;
      out.jump = true;
      out.throttle = 1;
      return out;
    }
    if (m.dodgeIn >= 0) {
      m.dodgeIn -= dt;
      out.throttle = 1;
      if (m.dodgeIn < 0) {
        out.jump = true;
        out.pitch = m.dodgePitch;
        out.yaw = m.dodgeYaw;
      }
      return out;
    }
    // Airborne without a plan: land on the wheels.
    if (!car.onGround && car.numContacts === 0 && m.aerial <= 0) {
      // Turtled: tap jump to auto-flip back over.
      if (car.worldContact && car.up.z < -0.7) {
        out.jump = !m.lastOut.jump;
        m.lastOut = { ...out };
        return out;
      }
      this.recover(car, out);
      out.throttle = 1;
      return out;
    }

    const ownGoalY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const oppGoal = new Vector3(0, -ownGoalY, 300);
    const ball = w.ball;
    const teammates = w.cars.filter((c) => c.team === car.team && !c.demolished);
    // Role: closest (in time) to the ball attacks; the rest support / defend.
    const eta = (c: Car) => c.pos.distanceTo(ball.pos) / Math.max(800, c.speed) + (Math.sign(ball.pos.y - c.pos.y) === Math.sign(-ownGoalY) ? 0 : 0.6);
    const order = [...teammates].sort((a, b) => eta(a) - eta(b));
    const role = order.indexOf(car);

    // Kickoff: straight at the ball, boost, flip in.
    if (w.phase === 'play' && ball.pos.x === 0 && ball.pos.y === 0 && ball.vel.lengthSq() < 1) {
      if (role === 0) {
        const d = car.pos.distanceTo(ball.pos);
        this.steerTo(car, ball.pos, out, L.maxSpeed);
        out.boost = car.boost > 0 && d > 700;
        if (L.flips && d < 650 && car.onGround && car.speed > 1200) this.startDodge(car, m, ball.pos);
        return out;
      }
      // Others grab boost / hang back.
      this.steerTo(car, new Vector3(Math.sign(car.pos.x) * 3072 || 3072, ownGoalY * 0.8, 0), out, 0.9);
      return out;
    }

    const target = new Vector3();
    let shootable = false;
    if (role === 0 || teammates.length === 1) {
      // Find the earliest reachable ball position.
      const intercept = this.findIntercept(car, L.aerial && car.boost > 40) ?? { t: 1, pos: ball.pos.clone() };
      const toGoal = oppGoal.clone().sub(intercept.pos).setZ(0).normalize();
      // Defending: if we're on the wrong side of the ball, go around it first.
      const goalSide = Math.sign(intercept.pos.y - car.pos.y) === Math.sign(-ownGoalY);
      const danger = Math.abs(intercept.pos.y - ownGoalY) < 2500;
      if (!goalSide && danger) {
        // Get back to the far post, then challenge.
        const post = new Vector3(Math.sign(intercept.pos.x || 1) * -600, ownGoalY * 0.92, 0);
        if (car.pos.distanceTo(post) > 600 && Math.abs(car.pos.y - ownGoalY) > Math.abs(intercept.pos.y - ownGoalY)) target.copy(post);
        else target.copy(intercept.pos).addScaledVector(toGoal, -60);
      } else {
        // Approach from behind the ball, lined up with the goal.
        const offset = 110 + Math.min(500, car.pos.distanceTo(intercept.pos) * 0.25) * L.aim;
        target.copy(intercept.pos).addScaledVector(toGoal, -offset);
        shootable = true;
      }
      // Aerial.
      if (L.aerial && intercept.pos.z > 350 && car.onGround && car.boost > 40 && car.pos.distanceTo(intercept.pos) < 1800 && this.facing(car, intercept.pos) > 0.85) {
        m.aerial = 1.6;
        m.target.copy(intercept.pos);
        m.jumpHold = 0.18;
        out.jump = true;
        return out;
      }
      if (m.aerial > 0) {
        m.aerial -= dt;
        this.aerialTo(car, m.target, out);
        return out;
      }
      // Jump / flip into the ball.
      const dist = car.pos.distanceTo(intercept.pos);
      if (car.onGround && dist < 320 && intercept.pos.z > 160 && intercept.pos.z < 360) {
        m.jumpHold = 0.15;
        out.jump = true;
        return out;
      }
      if (L.flips && shootable && car.onGround && dist < 380 && intercept.pos.z < 160 && car.speed > 900 && this.facing(car, intercept.pos) > 0.9) {
        this.startDodge(car, m, intercept.pos);
        return out;
      }
    } else if (role === 1) {
      // Support: shadow between the ball and our goal.
      target.set(ball.pos.x * 0.5, ball.pos.y + Math.sign(ownGoalY) * 2600, 0);
      target.y = Math.max(-ARENA.halfY + 600, Math.min(ARENA.halfY - 600, target.y));
    } else {
      // Goalie (or boost run when low).
      if (car.boost < 30) {
        const pad = w.pads.filter((p) => p.big && p.timer <= 0).sort((a, b) => car.pos.distanceTo(new Vector3(a.x, a.y, 0)) - car.pos.distanceTo(new Vector3(b.x, b.y, 0)))[0];
        target.copy(pad ? new Vector3(pad.x, pad.y, 0) : new Vector3(0, ownGoalY * 0.9, 0));
      } else target.set(Math.max(-700, Math.min(700, ball.pos.x * 0.3)), ownGoalY * 0.93, 0);
    }
    this.steerTo(car, target, out, L.maxSpeed);
    // Arrive slowly at a waiting spot.
    if (role > 0 && car.pos.distanceTo(target) < 400) out.throttle = car.forwardSpeed > 300 ? -0.3 : 0.2;
    const far = car.pos.distanceTo(target) > 1500;
    out.boost = car.boost > 0 && car.onGround && Math.random() < L.boost && this.facing(car, target) > 0.92 && (far || shootable) && car.speed < 2250;
    return out;
  }

  private findIntercept(car: Car, canAerial: boolean): { t: number; pos: Vector3 } | null {
    const speed = Math.max(car.speed, 600);
    for (const p of this.prediction) {
      if (Math.abs(p.pos.y) > ARENA.halfY + 50) break; // a goal will happen
      const reachZ = canAerial ? 1200 : 300;
      if (p.pos.z > reachZ) continue;
      const d = car.pos.distanceTo(p.pos);
      const turn = (1 - this.facing(car, p.pos)) * 0.6;
      const travel = d / Math.min(2300, speed + (car.boost > 20 ? 600 : 200)) + turn;
      if (travel <= p.t + 0.05) return p;
    }
    return this.prediction[this.prediction.length - 1] ?? null;
  }

  private facing(car: Car, p: Vector3): number {
    const to = p.clone().sub(car.pos);
    to.addScaledVector(car.up, -to.dot(car.up));
    return to.lengthSq() < 1 ? 1 : to.normalize().dot(car.forward);
  }

  private steerTo(car: Car, p: Vector3, out: Controls, maxThrottle: number): void {
    const to = p.clone().sub(car.pos);
    const lx = to.dot(car.forward);
    const ly = to.dot(car.left);
    const angle = Math.atan2(ly, lx);
    out.steer = Math.max(-1, Math.min(1, -angle * 3));
    out.throttle = maxThrottle;
    // Big turns: powerslide; target right behind and close: reverse.
    out.handbrake = Math.abs(angle) > 1.7 && car.speed > 500 && car.onGround;
    if (Math.abs(angle) > 2.6 && to.length() < 600 && car.forwardSpeed < 400) {
      out.throttle = -1;
      out.steer = -out.steer;
    }
  }

  private startDodge(car: Car, m: Mem, at: Vector3): void {
    const to = at.clone().sub(car.pos);
    const lx = to.dot(car.forward);
    const ly = to.dot(car.left);
    const len = Math.hypot(lx, ly) || 1;
    m.jumpHold = 0.07;
    m.dodgeIn = 0.06;
    m.dodgePitch = -lx / len;
    m.dodgeYaw = -ly / len;
    void car;
  }

  /** Point the wheels at the ground. */
  private recover(car: Car, out: Controls): void {
    // Desired up = world up; errors expressed in the car frame.
    const target = new Vector3(0, 0, 1);
    const err = car.up.clone().cross(target);
    const right = car.left.clone().negate();
    const aw = car.angVel;
    out.roll = Math.max(-1, Math.min(1, err.dot(car.forward) * 4 - aw.dot(car.forward) * 0.6));
    out.pitch = Math.max(-1, Math.min(1, err.dot(right) * 4 - aw.dot(right) * 0.6));
    // Face the velocity direction (yaw).
    const vel = car.vel.clone().setZ(0);
    if (vel.lengthSq() > 1e4) {
      const a = Math.atan2(vel.normalize().dot(car.left), vel.dot(car.forward));
      out.yaw = Math.max(-1, Math.min(1, -a * 2));
    }
  }

  private aerialTo(car: Car, target: Vector3, out: Controls): void {
    // Aim the nose a little above the target to fight gravity, boost when aligned.
    const aim = target.clone().sub(car.pos);
    aim.z += 120;
    const dir = aim.normalize();
    const err = car.forward.clone().cross(dir);
    const right = car.left.clone().negate();
    const aw = car.angVel;
    out.pitch = Math.max(-1, Math.min(1, err.dot(right) * 5 - aw.dot(right) * 0.5));
    out.yaw = Math.max(-1, Math.min(1, err.dot(car.up) * -5 + aw.dot(car.up) * 0.5));
    out.roll = Math.max(-1, Math.min(1, -car.left.z * 2));
    out.boost = car.forward.dot(dir) > 0.8 && car.boost > 0;
    if (car.pos.distanceTo(target) < 200 && !car.hasFlipped) {
      out.jump = true;
      out.pitch = -1;
    }
  }
}

export const BOT_LEVELS: BotLevel[] = ['rookie', 'pro', 'allstar'];
export const BOT_NAMES = ['Merlin', 'Sundown', 'Rainmaker', 'Bandit', 'Hound', 'Sticks', 'Fury', 'Jester', 'Tusk', 'Viper', 'Casper', 'Gerwin', 'Junker', 'Squall', 'Raja', 'Saltie'];
void C;
