import { Vector3 } from 'three';
import { predictBall, predictedGoal, type BallSample } from './ball';
import { ARENA, arenaDistance } from './arena';
import { NO_CONTROLS, type Car, type Controls } from './car';
import * as C from './constants';
import type { World } from './world';

export type BotLevel = 'rookie' | 'pro' | 'allstar';

/**
 * Skill table — everything that separates the levels:
 *   reaction  seconds between looks at the ball (the prediction and decisions go stale in between)
 *   error     sideways aim error (uu), re-rolled every second
 *   whiff     chance a shot dodge is mistimed
 *   boost     boost duty cycle (deterministic, see `boostOk`)
 *   maxSpeed  throttle cap
 *   aerialZ   highest ball played in the air (0 = never leaves the ground for it)
 *   blockZ    highest ball jumped at (jump / double jump)
 *   demo      hunts demolitions
 *   fake      chance to delay the kickoff (so humans can win 50/50s)
 */
const LEVEL = {
  rookie: { reaction: 0.3, error: 260, whiff: 0.3, boost: 0.4, maxSpeed: 0.85, aerialZ: 0, blockZ: 340, demo: false, fake: 0.5 },
  pro: { reaction: 0.12, error: 70, whiff: 0.08, boost: 0.8, maxSpeed: 1, aerialZ: 900, blockZ: 520, demo: false, fake: 0.3 },
  allstar: { reaction: 0.05, error: 25, whiff: 0, boost: 1, maxSpeed: 1, aerialZ: 1500, blockZ: 560, demo: true, fake: 0.3 },
} as const;
type Level = (typeof LEVEL)[BotLevel];

type Role = 'attack' | 'support' | 'back';
type Plan = 'ball' | 'boost' | 'shadow' | 'demo';

interface Mem {
  think: number;
  role: Role;
  plan: Plan;
  /** Sideways aim error (uu), re-rolled every second; the goal-mouth spot aimed at. */
  err: number;
  errAt: number;
  aim: number;
  /** Planned dodge: seconds until the second jump press (pitch / yaw 0 = double jump). */
  dodgeIn: number;
  dodgePitch: number;
  dodgeYaw: number;
  jumpHold: number;
  /** Aerial in progress: world time the ball is met, and the deadline to give up. */
  aerialAt: number;
  aerialEnd: number;
  /** Kickoff delay (fake) still to wait. */
  kickoffWait: number;
  kickoffRolled: boolean;
  demoTarget: number;
  demoEnd: number;
  pad: number;
  lastJump: boolean;
}

const PREDICT_STEP = 1 / 30;
const PREDICT_TIME = 3;
/** A teammate must beat the attacker's ETA by this much to take over. */
const ROLE_HYSTERESIS = 0.3;
const V = () => new Vector3();

/**
 * Rocket League bots: roles with rotation (attacker → support → back), shots
 * aimed through the ball at the net, power flips, blocks, wall play, boost
 * routing, aerials and demos — scaled by the skill table above. Deterministic
 * (own LCG seeded from the world), so the server and replays agree.
 */
export class Bots {
  private mem = new Map<number, Mem>();
  private path: BallSample[] = [];
  private pathTime = 0;
  private predictTimer = 0;
  /** Where the predicted ball ends up: the scoring team (-1 = none) and when. */
  private goalIn: { team: 0 | 1 | -1; t: number } = { team: -1, t: 0 };
  private readonly attacker: [number, number] = [-1, -1];
  private rng: number;
  private readonly tmp = V();
  private readonly tmp2 = V();

  constructor(
    private readonly world: World,
    readonly level: BotLevel = 'pro',
  ) {
    this.rng = (world.rng ^ 0x9e3779b9) >>> 0 || 1;
  }

  private rand(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  private get now(): number {
    return this.world.tickCount * C.TICK;
  }

  /** Controls for every bot car this tick. */
  update(dt: number, out: Map<number, Controls>): void {
    const w = this.world;
    const L = LEVEL[this.level];
    this.predictTimer -= dt;
    if (this.predictTimer <= 0) {
      this.predictTimer = Math.max(0.05, L.reaction);
      this.predictBall();
    }
    this.assignRoles();
    for (const p of w.players) {
      if (!p.bot) continue;
      const car = w.car(p.id);
      if (!car) continue;
      let m = this.mem.get(p.id);
      if (!m) {
        m = { think: 0, role: 'attack', plan: 'ball', err: 0, errAt: 0, aim: 0, dodgeIn: -1, dodgePitch: 0, dodgeYaw: 0, jumpHold: 0, aerialAt: 0, aerialEnd: 0, kickoffWait: 0, kickoffRolled: false, demoTarget: -1, demoEnd: 0, pad: -1, lastJump: false };
        this.mem.set(p.id, m);
      }
      const c = car.demolished || w.phase === 'countdown' ? { ...NO_CONTROLS } : this.drive(car, m, L, dt);
      m.lastJump = c.jump;
      out.set(p.id, c);
    }
  }

  private predictBall(): void {
    const b = this.world.ball;
    predictBall(b, PREDICT_TIME, PREDICT_STEP, this.path);
    this.pathTime = this.now;
    const team = predictedGoal(this.path, b.radius);
    let t = 0;
    if (team >= 0) for (const p of this.path) if (Math.abs(p.pos.y) >= ARENA.goalLineY + b.radius) break; else t = p.t;
    this.goalIn = { team, t };
  }

  /** Predicted ball sample nearest to world time `at` (clamped to the path). */
  private sampleAt(at: number): BallSample {
    const i = Math.max(0, Math.min(this.path.length - 1, Math.round((at - this.pathTime) / PREDICT_STEP)));
    return this.path[i]!;
  }

  // ------------------------------------------------------------------ roles

  /** Attacker = lowest ETA to the ball with hysteresis; the rest rotate back by distance to our goal. */
  private assignRoles(): void {
    const w = this.world;
    for (const team of [0, 1] as const) {
      const mates = w.cars.filter((c) => c.team === team && !c.demolished);
      if (!mates.length) continue;
      const etas = mates.map((c) => this.ballEta(c));
      let best = 0;
      for (let i = 1; i < mates.length; i++) if (etas[i]! < etas[best]!) best = i;
      const cur = mates.findIndex((c) => c.id === this.attacker[team]);
      const keep = cur >= 0 && etas[cur]! <= etas[best]! + ROLE_HYSTERESIS;
      const attacker = mates[keep ? cur : best]!;
      this.attacker[team] = attacker.id;
      const ownY = team === 0 ? -ARENA.halfY : ARENA.halfY;
      const rest = mates.filter((c) => c !== attacker).sort((a, b) => Math.abs(a.pos.y - ownY) - Math.abs(b.pos.y - ownY));
      for (const c of mates) {
        const m = this.mem.get(c.id);
        if (!m) continue;
        m.role = c === attacker ? 'attack' : rest.length > 1 && c !== rest[0] ? 'support' : 'back';
      }
    }
  }

  /** Seconds for `car` to reach the earliest ground-reachable predicted ball position. */
  private ballEta(car: Car): number {
    const p = this.findIntercept(car, 260) ?? this.path[this.path.length - 1];
    if (!p) return 9;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    // Being on the wrong side of the ball (closer to the enemy goal than it) costs a turn-around.
    const wrongSide = Math.abs(car.pos.y - ownY) > Math.abs(p.pos.y - ownY) + 150;
    return Math.max(p.t, this.eta(car, p.pos)) + (wrongSide ? 0.6 : 0);
  }

  private eta(car: Car, p: Vector3): number {
    const d = Math.hypot(p.x - car.pos.x, p.y - car.pos.y);
    const v = Math.min(C.CAR_MAX_SPEED, Math.max(1000, car.speed + (car.boost > 15 ? 600 : 250)));
    return d / v + (1 - this.facing(car, p)) * 0.5 + (car.onGround ? 0 : 0.3);
  }

  // -------------------------------------------------------------- decisions

  private drive(car: Car, m: Mem, L: Level, dt: number): Controls {
    const w = this.world;
    const out: Controls = { ...NO_CONTROLS };
    // Dodge / double jump in progress (second press after the first).
    if (m.jumpHold > 0) {
      m.jumpHold -= dt;
      out.jump = true;
      out.throttle = 1;
      if (m.aerialEnd > this.now) out.pitch = 0.6;
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
    if (m.aerialEnd > this.now) {
      this.aerial(car, m, L, out);
      return out;
    }
    // Airborne without a plan: land on the wheels.
    if (!car.onGround && car.numContacts === 0) {
      // Turtled: tap jump to auto-flip back over.
      if (car.worldContact && car.up.z < -0.7) {
        out.jump = !m.lastJump;
        return out;
      }
      this.recover(car, out);
      out.throttle = 1;
      return out;
    }
    if (w.phase !== 'play') {
      // After a goal / the whistle: just drift towards the ball.
      this.steerTo(car, w.ball.pos, out, 0.5);
      return out;
    }

    const ball = w.ball;
    // Kickoff (untouched ball at the centre spot): the closest teammate goes, maybe after a fake; the other grabs the back big pad.
    if (ball.pos.x === 0 && ball.pos.y === 0) return this.kickoff(car, m, L, out, dt);
    m.kickoffRolled = false;

    m.think -= dt;
    if (m.think <= 0) {
      m.think = L.reaction;
      if (this.now >= m.errAt) {
        m.errAt = this.now + 1;
        m.err = (this.rand() * 2 - 1) * L.error;
      }
      this.decide(car, m, L);
    }
    switch (m.plan) {
      case 'boost':
        this.gotoPad(car, m, L, out);
        break;
      case 'demo':
        this.demo(car, m, out);
        break;
      case 'shadow':
        this.shadow(car, m, L, out);
        break;
      default:
        this.playBall(car, m, L, out);
    }
    return out;
  }

  /** Pick a plan for the current role (every `reaction` seconds). */
  private decide(car: Car, m: Mem, L: Level): void {
    const w = this.world;
    const ball = w.ball;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const threat = this.goalIn.team === 1 - car.team && this.goalIn.t < 2.5;
    const nearOwnGoal = Math.abs(ball.pos.y - ownY) < 1800;
    const eta = this.ballEta(car);
    const urgent = threat || nearOwnGoal || (m.role === 'attack' && eta < 1.5);
    // Current errand first.
    if (m.plan === 'boost' && !urgent) {
      const pad = w.pads[m.pad];
      if (pad && pad.timer <= 0 && car.boost < 90) return;
    }
    if (m.plan === 'demo' && this.demoEnd(car, m) === false) return;
    m.plan = m.role === 'attack' ? 'ball' : 'shadow';
    // Boost run: below 40 and the ball isn't urgent, via a pad near the way (the attacker only when the ball is far).
    const wantBoost = m.role === 'attack' ? (car.boost < 30 && eta > 2.2) || (car.boost < 10 && eta > 1.5) : car.boost < 40;
    if (!urgent && wantBoost && w.rules.boostMode === 'default') {
      const pad = this.choosePad(car, m.role === 'attack' ? ball.pos : this.shadowPoint(car, m), m.role === 'attack' ? 900 : 1600);
      if (pad >= 0) {
        m.plan = 'boost';
        m.pad = pad;
        return;
      }
    }
    // Demo: an enemy camping their goal while the ball is far from it and we're flying.
    const busy = m.role === 'attack' && eta < 1.6;
    if (L.demo && !busy && !threat && (car.supersonic || (car.speed > 1300 && car.boost > 25)) && w.rules.demolish !== 'disabled') {
      const oppY = -ownY;
      let best: Car | null = null;
      for (const e of w.cars) {
        if (e.team === car.team || e.demolished) continue;
        if (Math.abs(e.pos.y - oppY) > 1800 || Math.abs(e.pos.x) > 1600 || e.pos.distanceTo(ball.pos) < 1500) continue;
        if (this.eta(car, e.pos) > 2 || this.facing(car, e.pos) < 0.5) continue;
        if (!best || car.pos.distanceTo(e.pos) < car.pos.distanceTo(best.pos)) best = e;
      }
      if (best) {
        m.plan = 'demo';
        m.demoTarget = best.id;
        m.demoEnd = this.now + 2;
      }
    }
  }

  /** True once the demo errand is over (target gone / bumped / timed out). */
  private demoEnd(car: Car, m: Mem): boolean {
    const t = this.world.car(m.demoTarget);
    return !t || t.demolished || this.now > m.demoEnd || car.bumpCooldown > 0 || !car.supersonic && car.boost <= 0;
  }

  // ---------------------------------------------------------------- kickoff

  private kickoff(car: Car, m: Mem, L: Level, out: Controls, dt: number): Controls {
    const w = this.world;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const mates = w.cars.filter((c) => c.team === car.team && !c.demolished);
    const d = car.pos.distanceTo(w.ball.pos);
    const taker = mates.every((c) => c === car || c.pos.distanceTo(w.ball.pos) > d - 1 && (c.pos.distanceTo(w.ball.pos) > d + 1 || c.id > car.id));
    if (!m.kickoffRolled) {
      m.kickoffRolled = true;
      m.kickoffWait = this.rand() < L.fake ? 0.2 + this.rand() * 0.3 : 0;
    }
    if (taker) {
      if (m.kickoffWait > 0) {
        m.kickoffWait -= dt;
        return out;
      }
      // Diagonals go straight in; the centre spawns grab the small pad on the way.
      const target = Math.abs(car.pos.x) < 600 && Math.abs(car.pos.y) > 1150 ? this.tmp.set(0, ownY * 0.2, 0) : w.ball.pos;
      this.steerTo(car, target, out, L.maxSpeed);
      out.boost = car.boost > 0 && d > 700;
      if (d < 650 && car.onGround && car.speed > 1200) this.startDodge(car, m, w.ball.pos, L);
      return out;
    }
    // Not taking: back big pad, then rotate to mid.
    const pad = w.pads.map((p, i) => ({ p, i })).filter(({ p }) => p.big && p.timer <= 0 && Math.sign(p.y) === Math.sign(ownY)).sort((a, b) => car.pos.distanceTo(this.tmp.set(a.p.x, a.p.y, 0)) - car.pos.distanceTo(this.tmp2.set(b.p.x, b.p.y, 0)))[0];
    if (pad && car.boost < 90) this.steerTo(car, this.tmp.set(pad.p.x, pad.p.y, 0), out, 1);
    else {
      this.steerTo(car, this.tmp.set(0, ownY * 0.55, 0), out, 0.8);
      if (Math.abs(car.pos.y - ownY * 0.55) < 400) out.throttle = 0;
    }
    return out;
  }

  // ------------------------------------------------------------------- ball

  /** Attack / save: drive to the intercept lined up with the shot, flip, jump or fly into it. */
  private playBall(car: Car, m: Mem, L: Level, out: Controls): void {
    const w = this.world;
    const ball = w.ball;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const oppY = -ownY;
    const threat = this.goalIn.team === 1 - car.team;
    // Aerial opportunity (pro: simple, all-star: higher / further).
    if (L.aerialZ > 0 && car.onGround && car.boost > (this.level === 'allstar' ? 30 : 45)) {
      const p = this.findAerial(car, L);
      if (p) {
        m.aerialAt = this.pathTime + p.t;
        m.aerialEnd = m.aerialAt + 0.5;
        m.jumpHold = 0.2;
        out.jump = true;
        out.pitch = 0.6;
        return;
      }
    }
    const ground = this.findIntercept(car, 260);
    const jumpable = ground ?? this.findIntercept(car, L.blockZ);
    const hit = jumpable ?? this.landing();
    const ip = hit.pos;
    const dist = car.pos.distanceTo(ip);
    const goalSide = Math.abs(car.pos.y - ownY) < Math.abs(ip.y - ownY) + 100;
    const danger = Math.abs(ip.y - ownY) < 2600;
    const target = this.tmp;
    let shootable = false;
    let dir: Vector3;
    if (!goalSide && danger) {
      // Wrong side near our goal: get back to the far post first, then challenge.
      const post = this.tmp2.set(Math.sign(ip.x || 1) * -700, ownY * 0.92, 0);
      dir = this.shotDir(car, ip, m, L);
      if (Math.abs(car.pos.y - ownY) > 1200 && car.pos.distanceTo(post) > 500) target.copy(this.avoidBall(car, post));
      else target.copy(ip).addScaledVector(dir, -(ball.radius + 60));
    } else {
      dir = this.shotDir(car, ip, m, L);
      // Approach from behind the ball along the shot line; the offset scales with
      // height (hit it low to lift it, high to keep it down) and closing speed.
      const toBall = this.tmp2.copy(ip).sub(car.pos).setZ(0).normalize();
      const align = toBall.dot(dir);
      const closing = Math.max(0, -hit.vel.dot(toBall));
      let off = ball.radius + 20 + car.halfExtents.x + Math.max(0, ip.z - 120) * 0.25 + Math.min(200, closing * 0.06);
      off += Math.min(700, dist * 0.35) * (1 - Math.max(0, align)) * (this.level === 'rookie' ? 0.6 : 1);
      target.copy(ip).addScaledVector(dir, -off);
      // Behind the shot line's far side: go round the ball rather than through it.
      if (align < 0.2) target.copy(this.avoidBall(car, target));
      shootable = true;
    }
    // Wall play: a ball rolling along a wall is reachable up there — drive at it.
    if (this.nearWall(ip) && ip.z > 200) target.copy(ip);
    else this.clampInside(target, ip);

    // Jump / double jump at a ball above the hitbox (blocks and pop-ups).
    const flat = Math.hypot(ip.x - car.pos.x, ip.y - car.pos.y);
    const soon = hit.t + this.pathTime - this.now;
    if (car.onGround && ip.z > 170 && ip.z <= L.blockZ && flat < 260 + car.speed * 0.12 && soon < 0.45 && this.facing(car, ip) > 0.6) {
      m.jumpHold = ip.z > 300 ? 0.2 : 0.12;
      if (ip.z > 330) {
        m.dodgeIn = 0.22;
        m.dodgePitch = m.dodgeYaw = 0;
      }
      out.jump = true;
      return;
    }
    // Power flip: lined up with the net (< 25°), low ball, close and fast.
    if (shootable && car.onGround && dist < 420 && ip.z < 200 && car.speed > 900 && this.facing(car, ip) > 0.9) {
      const toBall = this.tmp2.copy(ip).sub(car.pos).setZ(0).normalize();
      const openNet = this.openNet(car, ip);
      const aligned = toBall.dot(dir) > Math.cos((25 * Math.PI) / 180) || (openNet && toBall.dot(dir) > 0.7);
      const clearing = threat || (Math.sign(ip.y) === Math.sign(ownY) && Math.abs(ip.y) > 2500);
      if (aligned || clearing) {
        this.startDodge(car, m, ip, L);
        return;
      }
    }
    const facingBall = this.facing(car, ip);
    const lineUp = this.tmp2.copy(ip).sub(car.pos).setZ(0).normalize().dot(dir);
    // Never drive through the ball on a line into our own net (unless it's going in anyway).
    const intoOwn = this.headsAtOwnGoal(car, ip) && !threat;
    if (intoOwn && dist < 900) {
      this.steerTo(car, this.avoidBall(car, target), out, L.maxSpeed);
    } else if (dist < 650 && jumpable && (lineUp > 0.45 || hit.vel.length() > 700 || threat)) {
      // On the ball: hit it through the contact point of the shot, as far as we can still line up.
      const contact = this.tmp2.copy(ip).addScaledVector(dir, -(ball.radius + car.halfExtents.x));
      const toBall = V().copy(ip).sub(car.pos).setZ(0).normalize();
      const toContact = V().copy(contact).sub(car.pos).setZ(0).normalize();
      if (toBall.dot(toContact) < 0.65) contact.lerp(ip, 0.6);
      this.steerTo(car, facingBall > 0.2 ? contact : ip, out, L.maxSpeed);
      // Reverse into a ball sitting right behind when that pushes it the right way (goal-mouth scrambles).
      const lx = this.tmp2.copy(ip).sub(car.pos).dot(car.forward);
      if (lx < -40 && dist < 400 && Math.abs(car.forwardSpeed) < 700 && (-car.forward.dot(dir) > 0.5 || threat)) {
        out.throttle = -1;
        out.handbrake = false;
      }
    } else {
      this.steerTo(car, target, out, L.maxSpeed);
      // Waiting for a high ball: arrive as it comes down rather than overshooting.
      const tdist = car.pos.distanceTo(target);
      if (!jumpable && soon > 0.2 && tdist < 1800) {
        const want = Math.min(C.CAR_MAX_SPEED, (tdist + 150) / soon);
        if (car.forwardSpeed > want + 100) out.throttle = Math.max(-0.4, Math.min(out.throttle, (want - car.forwardSpeed) / 400));
      }
    }
    const far = dist > 1500;
    out.boost = this.boostOk(car, L) && car.onGround && facingBall > 0.5 && this.facing(car, target) > 0.92 && (far || shootable || threat) && out.throttle > 0;
    void oppY;
  }

  /** Direction the ball should go (unit, 2D): at the net, or a clear to the side from our half. */
  private shotDir(car: Car, ip: Vector3, m: Mem, L: Level): Vector3 {
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const oppY = -ownY;
    const dir = V();
    const toBall = V().copy(ip).sub(car.pos).setZ(0).normalize();
    dir.set(this.aimX(car, m, ip) + m.err, oppY, 0).sub(ip).setZ(0).normalize();
    // Beside their goal by the back wall there's no angle: centre it in front of the net instead.
    if (Math.abs(ip.y - oppY) < 1300 && Math.abs(ip.x) > ARENA.goalHalfX + 100) {
      dir.set(m.err * 2, oppY - Math.sign(oppY) * 1500, 0).sub(ip).setZ(0).normalize();
    }
    const inOurHalf = Math.sign(ip.y) === Math.sign(ownY) && Math.abs(ip.y) > 1200;
    if (inOurHalf && toBall.dot(dir) < 0.5) {
      // Not lined up in our half: clear it towards the side wall, up the field.
      const side = Math.sign(ip.x) || (m.err >= 0 ? 1 : -1);
      dir.set(side * 3200, oppY * 0.3, 0).sub(ip).setZ(0).normalize();
    }
    void L;
    return dir;
  }

  /** The line from the car through the ball ends in (or near) our own goal mouth. */
  private headsAtOwnGoal(car: Car, ip: Vector3): boolean {
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const dx = ip.x - car.pos.x;
    const dy = ip.y - car.pos.y;
    if (Math.sign(dy) !== Math.sign(ownY) || Math.abs(dy) < 1) return false;
    const x = ip.x + (dx / dy) * (ownY - ip.y);
    return Math.abs(x) < ARENA.goalHalfX + 500 && Math.abs(ip.y - ownY) < 3500;
  }

  /** Where in the enemy goal mouth to aim (x): the spot whose line from the ball passes furthest from their cars. */
  private aimX(car: Car, m: Mem, ip: Vector3): number {
    const oppY = car.team === 0 ? ARENA.halfY : -ARENA.halfY;
    const reach = ARENA.goalHalfX - this.world.ball.radius - 120;
    let best = Math.max(-reach * 0.5, Math.min(reach * 0.5, ip.x * 0.25));
    let bestScore = -Infinity;
    for (let k = -2; k <= 2; k++) {
      const gx = (k / 2) * reach;
      const dx = gx - ip.x;
      const dy = oppY - ip.y;
      const len = Math.hypot(dx, dy) || 1;
      let clear = 1200;
      for (const e of this.world.cars) {
        if (e.team === car.team || e.demolished) continue;
        const ex = e.pos.x - ip.x;
        const ey = e.pos.y - ip.y;
        const along = (ex * dx + ey * dy) / len;
        if (along < 0 || along > len) continue;
        clear = Math.min(clear, Math.abs(ex * dy - ey * dx) / len);
      }
      // Prefer clear lines, then straighter ones, then the spot we already picked.
      const score = Math.min(clear, 500) - Math.abs(gx - ip.x * 0.25) * 0.15 + (Math.abs(gx - m.aim) < 1 ? 80 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = gx;
      }
    }
    m.aim = best;
    return best;
  }

  /** Nobody of the other team between the ball and their goal (in their half). */
  private openNet(car: Car, ip: Vector3): boolean {
    const oppY = car.team === 0 ? ARENA.halfY : -ARENA.halfY;
    if (Math.sign(ip.y) !== Math.sign(oppY)) return false;
    for (const e of this.world.cars) {
      if (e.team === car.team || e.demolished) continue;
      if (Math.abs(e.pos.y - oppY) < Math.abs(ip.y - oppY) && Math.abs(e.pos.x - ip.x) < 900) return false;
    }
    return true;
  }

  private findIntercept(car: Car, maxZ: number): BallSample | null {
    const radius = this.world.ball.radius;
    for (const p of this.path) {
      if (Math.abs(p.pos.y) > ARENA.halfY + 50) break; // a goal will happen
      const z = p.pos.z - radius + C.BALL_RADIUS;
      if (z > (this.nearWall(p.pos) ? Math.max(maxZ, 900) : maxZ)) continue;
      if (this.eta(car, p.pos) <= p.t + this.pathTime - this.now + 0.05) return p;
    }
    return null;
  }

  /** Where a high ball comes down (first low sample), else the last predicted point. */
  private landing(): BallSample {
    for (const p of this.path) if (p.pos.z < 200 && p.t > 0.1) return p;
    return this.path[this.path.length - 1]!;
  }

  private nearWall(p: Vector3): boolean {
    return Math.abs(p.x) > ARENA.halfX - 220 || Math.abs(p.y) > ARENA.halfY - 220 || Math.abs(p.x) + Math.abs(p.y) > ARENA.corner - 300;
  }

  /** Pull a drive target out of the walls (towards `toward`, usually the ball). */
  private clampInside(p: Vector3, toward: Vector3): Vector3 {
    for (let i = 0; i < 5 && arenaDistance(p.x, p.y, 500) < 150; i++) p.lerp(toward, 0.35);
    return p;
  }

  // ---------------------------------------------------------------- aerial

  /** An aerial-only ball (above the jump range) this car can meet with its boost. */
  private findAerial(car: Car, L: Level): BallSample | null {
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const threat = this.goalIn.team === 1 - car.team;
    for (const p of this.path) {
      const t = p.t + this.pathTime - this.now;
      if (t < 0.5) continue;
      if (t > 2.2) break;
      if (p.pos.z < L.blockZ + 60 || p.pos.z > L.aerialZ) continue;
      if (Math.abs(p.pos.y) > ARENA.halfY - 100) continue;
      // Reachable: after the jump + double jump (~0.3 s, ~+650 uu/s up) the boost must cover what's left against gravity.
      if (car.pos.distanceTo(p.pos) > 2300) continue;
      const T = t - 0.3;
      const g = C.GRAVITY * this.world.rules.gravity;
      const from = this.tmp.copy(car.pos).addScaledVector(car.vel, 0.3);
      from.z += 120 * this.world.rules.jumpHeight;
      const need = this.tmp2.copy(p.pos).sub(from).addScaledVector(car.vel, -T);
      need.z -= 650 * this.world.rules.jumpHeight * T;
      need.multiplyScalar(2 / (T * T));
      need.z -= g;
      if (need.length() > C.BOOST_ACCEL_AIR * this.world.rules.boostStrength * (this.level === 'allstar' ? 0.8 : 0.65)) continue;
      if (this.facing(car, p.pos) < (this.level === 'allstar' ? 0.75 : 0.85)) continue;
      // Worth it: a save, or a ball in their half / coming down slowly; and it's ours to play.
      const worth = threat || Math.sign(p.pos.y) !== Math.sign(ownY) || this.level === 'allstar';
      if (!worth) continue;
      return p;
    }
    return null;
  }

  /** Fly at the predicted ball: gravity-compensated lead, boost when the nose is on it. */
  private aerial(car: Car, m: Mem, L: Level, out: Controls): void {
    const ball = this.world.ball;
    const T = m.aerialAt - this.now;
    const target = this.sampleAt(m.aerialAt).pos;
    const dist = car.pos.distanceTo(ball.pos);
    // Bail out: no boost, too late, or the meeting point needs more than the boost can give.
    if (car.boost < 10 || (T < -0.05 && dist > 300) || car.pos.distanceTo(target) > 3000 || car.onGround || this.aerialAccel(car, target, T) > C.BOOST_ACCEL_AIR * 1.8) {
      m.aerialEnd = 0;
      this.recover(car, out);
      return;
    }
    // Dodge into the ball when it's right there.
    if (dist < ball.radius + 130 && !car.hasFlipped) {
      const to = this.tmp.copy(ball.pos).sub(car.pos);
      out.jump = true;
      out.pitch = -Math.sign(to.dot(car.forward)) || -1;
      out.yaw = Math.max(-1, Math.min(1, -to.dot(car.left) / 100));
      m.aerialEnd = 0;
      return;
    }
    const mag = this.aerialAccel(car, target, T);
    const dir = this.tmp.multiplyScalar(1 / Math.max(1e-6, mag));
    this.pointAt(car, dir, out, L);
    out.boost = car.forward.dot(dir) > (this.level === 'allstar' ? 0.75 : 0.85) && mag > 150 && car.boost > 0;
    // Fast aerial: double jump (sticks neutral) right after the first jump.
    if (car.hasJumped && !car.hasDoubleJumped && !car.hasFlipped && car.airTimeSinceJump < 0.25 && T > 0.4 && !m.lastJump) {
      out.jump = true;
      out.pitch = out.yaw = out.roll = 0;
    }
  }

  /** Acceleration (left in `tmp`, magnitude returned) that brings the car to `target` in `T` s against gravity. */
  private aerialAccel(car: Car, target: Vector3, T: number): number {
    const tt = Math.max(0.12, T);
    const need = this.tmp.copy(target).sub(car.pos).addScaledVector(car.vel, -tt).multiplyScalar(2 / (tt * tt));
    need.z -= C.GRAVITY * this.world.rules.gravity;
    return need.length();
  }

  /** Aim the nose at a direction: per axis, a target turn rate that can still stop in time (√error), wings level with roll. */
  private pointAt(car: Car, dir: Vector3, out: Controls, L: Level): void {
    const err = this.tmp2.copy(car.forward).cross(dir);
    // Facing away: the cross product shrinks again past 90°, so push it to full scale.
    if (car.forward.dot(dir) < 0 && err.lengthSq() > 1e-6) err.normalize();
    const right = V().copy(car.left).negate();
    const aw = car.angVel;
    const k = this.level === 'allstar' ? 1.4 : 1;
    const rate = (e: number) => Math.sign(e) * Math.min(5 * Math.abs(e), Math.sqrt(2 * 7 * Math.abs(e)));
    out.pitch = Math.max(-1, Math.min(1, (rate(err.dot(right)) - aw.dot(right)) * k));
    out.yaw = Math.max(-1, Math.min(1, -(rate(err.dot(car.up)) - aw.dot(car.up)) * k));
    out.roll = Math.max(-1, Math.min(1, -car.left.z * 2.5 - aw.dot(car.forward) * 0.3));
    void L;
  }

  // ----------------------------------------------------------------- shadow

  /** Goal-side waiting spot: matches the ball's x, between it and our net, further back the faster it comes. */
  private shadowPoint(car: Car, m: Mem): Vector3 {
    const ball = this.world.ball;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const toward = Math.sign(ownY);
    const closing = Math.max(0, ball.vel.y * toward);
    const back = m.role === 'support' ? 1300 : Math.max(1500, Math.min(3200, 1800 + closing * 0.6));
    let y = ball.pos.y + toward * back;
    if (Math.abs(y) > Math.abs(ownY) * 0.88) y = ownY * 0.88;
    if (Math.sign(y) !== toward && Math.abs(y) > 800) y = -toward * 800; // never past the far side of midfield
    const inBox = Math.abs(y - ownY) < 1300;
    const x = inBox ? Math.max(-700, Math.min(700, ball.pos.x * 0.3)) : Math.max(-2200, Math.min(2200, ball.pos.x * (m.role === 'support' ? 0.4 : 0.6)));
    return V().set(x, y, 0);
  }

  private shadow(car: Car, m: Mem, L: Level, out: Controls): void {
    const ball = this.world.ball;
    const target = this.avoidBall(car, this.viaSmallPad(car, this.shadowPoint(car, m)));
    const dist = car.pos.distanceTo(target);
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    // Ball coming at the net: the back player challenges / blocks instead of waiting.
    const threat = this.goalIn.team === 1 - car.team && this.goalIn.t < 2.5;
    if (threat && (m.role === 'back' || ball.pos.distanceTo(car.pos) < 1500)) {
      this.playBall(car, m, L, out);
      return;
    }
    this.steerTo(car, target, out, L.maxSpeed, true);
    // Arrive slowly, retreating at the ball's speed when it comes our way.
    if (dist < 500) {
      const closing = Math.max(0, ball.vel.y * Math.sign(ownY));
      const want = Math.min(1, closing / 1400);
      out.throttle = out.throttle < 0 ? -Math.max(0.3, want) : car.forwardSpeed > 350 + closing * 0.3 ? -0.3 : 0.25;
      out.handbrake = false;
    }
    out.boost = this.boostOk(car, L) && car.onGround && dist > 2200 && this.facing(car, target) > 0.95 && !car.supersonic;
  }

  // ------------------------------------------------------------------ boost

  /** Deterministic boost duty cycle (so the sim stays reproducible). */
  private boostOk(car: Car, L: Level): boolean {
    if (car.boost <= 0 || car.supersonic) return false;
    if (L.boost >= 1) return true;
    return ((this.world.tickCount + car.id * 17) % 60) / 60 < L.boost;
  }

  /** Best pad for a boost run towards `next`: a big pad with a modest detour, or a small one on the way. */
  private choosePad(car: Car, next: Vector3, bigDetour: number): number {
    const w = this.world;
    const direct = car.pos.distanceTo(next);
    let best = -1;
    let bestCost = Infinity;
    w.pads.forEach((p, i) => {
      if (p.timer > 0) return;
      const pos = this.tmp.set(p.x, p.y, 0);
      const d1 = car.pos.distanceTo(pos);
      const detour = d1 + pos.distanceTo(next) - direct;
      const limit = p.big ? (car.boost < 20 ? bigDetour * 1.6 : bigDetour) : 350;
      if (detour > limit || d1 > 3500) return;
      const cost = d1 + detour * 0.5 - (p.big ? 1500 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    });
    return best;
  }

  private gotoPad(car: Car, m: Mem, L: Level, out: Controls): void {
    const pad = this.world.pads[m.pad];
    if (!pad || pad.timer > 0 || car.boost >= 95) {
      m.plan = m.role === 'attack' ? 'ball' : 'shadow';
      m.think = 0;
      this.steerTo(car, this.world.ball.pos, out, L.maxSpeed);
      return;
    }
    const target = this.avoidBall(car, this.viaSmallPad(car, this.tmp2.set(pad.x, pad.y, 0)));
    this.steerTo(car, target, out, L.maxSpeed);
    out.boost = this.boostOk(car, L) && car.onGround && car.pos.distanceTo(target) > 1500 && this.facing(car, target) > 0.95;
  }

  /** Rotating back past the ball: go round it (on our side of it) instead of pushing it at our own net. */
  private avoidBall(car: Car, target: Vector3): Vector3 {
    const b = this.world.ball.pos;
    const dx = target.x - car.pos.x;
    const dy = target.y - car.pos.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return target;
    const ux = dx / len;
    const uy = dy / len;
    const along = (b.x - car.pos.x) * ux + (b.y - car.pos.y) * uy;
    const across = (b.x - car.pos.x) * -uy + (b.y - car.pos.y) * ux;
    const clear = this.world.ball.radius + 260;
    if (along < 0 || along > len + 100 || Math.abs(across) > clear || b.z > 400) return target;
    // Pass on the side the car is already on (the ball's other side otherwise), towards the middle when level.
    const side = across !== 0 ? -Math.sign(across) : Math.sign(-b.x) || 1;
    const p = V().set(b.x - uy * side * clear * 1.6, b.y + ux * side * clear * 1.6, 0);
    return this.clampInside(p, V().set(0, 0, 0));
  }

  /** Nudge the route over a small pad that lies almost on the way. */
  private viaSmallPad(car: Car, target: Vector3): Vector3 {
    if (car.boost >= 88) return target;
    const direct = car.pos.distanceTo(target);
    if (direct < 600) return target;
    let best: Vector3 | null = null;
    let bestD = Infinity;
    for (const p of this.world.pads) {
      if (p.timer > 0 || p.big) continue;
      const pos = this.tmp.set(p.x, p.y, 0);
      const d1 = car.pos.distanceTo(pos);
      if (d1 < 150 || d1 > direct) continue;
      const detour = d1 + pos.distanceTo(target) - direct;
      if (detour > 120 || d1 > bestD) continue;
      bestD = d1;
      best = pos.clone();
    }
    return best ?? target;
  }

  // ------------------------------------------------------------------- demo

  private demo(car: Car, m: Mem, out: Controls): void {
    const t = this.world.car(m.demoTarget);
    if (!t || this.demoEnd(car, m)) {
      m.plan = 'shadow';
      m.think = 0;
      this.steerTo(car, this.world.ball.pos, out, 1);
      return;
    }
    const lead = Math.min(0.4, car.pos.distanceTo(t.pos) / 2300);
    const target = this.tmp.copy(t.pos).addScaledVector(t.vel, lead);
    this.steerTo(car, target, out, 1);
    out.boost = car.boost > 0 && !car.supersonic && this.facing(car, target) > 0.9;
    out.handbrake = false;
  }

  // -------------------------------------------------------------- primitives

  private facing(car: Car, p: Vector3): number {
    const to = this.tmp2.copy(p).sub(car.pos);
    to.addScaledVector(car.up, -to.dot(car.up));
    return to.lengthSq() < 1 ? 1 : to.normalize().dot(car.forward);
  }

  /** Steer towards a point; big turns powerslide, close targets behind are reversed into (keeps the nose on the ball when `allowReverse`). */
  private steerTo(car: Car, p: Vector3, out: Controls, maxThrottle: number, allowReverse = false): void {
    const to = this.tmp2.copy(p).sub(car.pos);
    const lx = to.dot(car.forward);
    const ly = to.dot(car.left);
    const angle = Math.atan2(ly, lx);
    const d = Math.hypot(lx, ly);
    out.steer = Math.max(-1, Math.min(1, -angle * 3));
    out.throttle = maxThrottle;
    out.handbrake = Math.abs(angle) > 1.6 && car.speed > 500 && car.onGround;
    // Target inside the turning circle: we'd orbit it. Slow to the fastest speed whose circle reaches it.
    if (car.onGround && Math.abs(angle) > 0.3 && Math.abs(angle) < 2.3) {
      const vmax = Math.max(250, maxTurnSpeed((2 * Math.sin(Math.min(Math.PI / 2, Math.abs(angle)))) / Math.max(1, d)));
      const v = car.forwardSpeed;
      if (v > vmax + 300) out.throttle = -1;
      else if (v > vmax) out.throttle = 0;
      if (v > vmax + 150 && Math.abs(angle) > 1) out.handbrake = true;
      // Inside even the tightest circle: back up (nose swinging towards it) to make room.
      if (Math.abs(angle) > 0.6 && v < 450 && d < 2.2 * (1 / C.CURVATURE_CURVE[0][1]) * Math.sin(Math.min(Math.PI / 2, Math.abs(angle)))) {
        out.throttle = -maxThrottle;
        out.steer = -out.steer;
        out.handbrake = false;
      }
    }
    const reverse = Math.abs(angle) > 2.3 && ((d < 600 && car.forwardSpeed < 400) || (allowReverse && d < 1600 && car.forwardSpeed < 300));
    if (reverse) {
      out.throttle = -maxThrottle;
      out.steer = Math.max(-1, Math.min(1, Math.atan2(-ly, -lx) * 3));
      out.handbrake = false;
    }
  }

  /** Front / side flip into `at` (rookies mistime some). */
  private startDodge(car: Car, m: Mem, at: Vector3, L: Level): void {
    const to = this.tmp2.copy(at).sub(car.pos);
    const lx = to.dot(car.forward);
    const ly = to.dot(car.left);
    const len = Math.hypot(lx, ly) || 1;
    const whiff = this.rand() < L.whiff;
    m.jumpHold = 0.07;
    m.dodgeIn = whiff ? 0.35 : 0.06;
    m.dodgePitch = -lx / len;
    m.dodgeYaw = -ly / len + (whiff ? (this.rand() - 0.5) * 0.8 : 0);
    void car;
  }

  /** Point the wheels at the ground and the nose along the velocity. */
  private recover(car: Car, out: Controls): void {
    const target = this.tmp.set(0, 0, 1);
    const err = this.tmp2.copy(car.up).cross(target);
    const right = V().copy(car.left).negate();
    const aw = car.angVel;
    out.roll = Math.max(-1, Math.min(1, err.dot(car.forward) * 4 - aw.dot(car.forward) * 0.6));
    out.pitch = Math.max(-1, Math.min(1, err.dot(right) * 4 - aw.dot(right) * 0.6));
    const vel = V().copy(car.vel).setZ(0);
    if (vel.lengthSq() > 1e4) {
      const a = Math.atan2(vel.normalize().dot(car.left), vel.dot(car.forward));
      out.yaw = Math.max(-1, Math.min(1, -a * 2));
    }
  }
}

/** Highest speed at which the car still turns with `curvature` (inverse of the curvature table). */
function maxTurnSpeed(curvature: number): number {
  const T = C.CURVATURE_CURVE;
  if (curvature >= T[0][1]) return 0;
  for (let i = 1; i < T.length; i++) {
    const [v1, k1] = T[i]!;
    if (curvature >= k1) {
      const [v0, k0] = T[i - 1]!;
      return v0 + ((v1 - v0) * (k0 - curvature)) / (k0 - k1);
    }
  }
  return C.CAR_MAX_SPEED;
}

export const BOT_LEVELS: BotLevel[] = ['rookie', 'pro', 'allstar'];
export const BOT_NAMES = ['Merlin', 'Sundown', 'Rainmaker', 'Bandit', 'Hound', 'Sticks', 'Fury', 'Jester', 'Tusk', 'Viper', 'Casper', 'Gerwin', 'Junker', 'Squall', 'Raja', 'Saltie'];
