import { Quaternion, Vector3 } from 'three';
import { predictBall, predictedGoal, type Ball, type BallSample } from './ball';
import { ARENA, arenaDistance } from './arena';
import { NO_CONTROLS, type Car, type Controls } from './car';
import * as C from './constants';
import { World } from './world';

export type BotLevel = 'rookie' | 'pro' | 'allstar' | 'ssl';

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
  // Supersonic Legend: plays through its own movement model (see the SSL section) — on-time
  // intercepts, aimed aerials, jump / double-jump shots, dribbles and flicks, half-flips, speed-flip kickoffs.
  ssl: { reaction: 1 / 60, error: 0, whiff: 0, boost: 1, maxSpeed: 1, aerialZ: 1950, blockZ: 620, demo: true, fake: 0.12 },
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
  /** SSL: a scripted move in progress (half-flip, flick), its clock and side. */
  man: { kind: 'half' | 'flick'; t: number; side: number } | null;
  /** Keep boosting through the current dodge (speed-flip kickoff). */
  boostHold: boolean;
  kickFlip: boolean;
  /** Carrying the ball on the roof since (world time), −1 = not carrying. */
  carrySince: number;
  /** SSL: the touch picked by simulation, for which intercept (world time), kept until. */
  planC: Cand | null;
  planAt: number;
  planUntil: number;
}

/** A way to play a touch: shot direction, contact offset sideways (uu), dodge into it or not. */
interface Cand {
  dir: Vector3;
  off: number;
  dodge: boolean;
}

/** Copy a car's whole simulation state (numbers, flags, vectors) onto another car of the same hitbox. */
function copyCar(d: Car, s: Car): void {
  const D = d as unknown as Record<string, unknown>;
  const S = s as unknown as Record<string, unknown>;
  for (const k of Object.keys(S)) {
    if (k === 'rules' || k === 'body' || k === 'wheels') continue;
    const v = S[k];
    if (typeof v === 'number' || typeof v === 'boolean') D[k] = v;
    else if (v instanceof Vector3 || v instanceof Quaternion) (D[k] as Vector3).copy(v as Vector3);
    else if (Array.isArray(v)) {
      if (typeof v[0] !== 'object') for (let i = 0; i < v.length; i++) (D[k] as unknown[])[i] = v[i];
    } else if (v && typeof v === 'object') Object.assign(D[k] as object, v);
  }
}

const PREDICT_STEP = 1 / 30;
const PREDICT_TIME = 3;
/** A teammate must beat the attacker's ETA by this much to take over. */
const ROLE_HYSTERESIS = 0.3;
const V = () => new Vector3();
/** Tuning switches (tools only): SSL features to leave out, e.g. SSL_OFF=carry,half. */
/** How long before a touch SSL starts simulating the ways to play it (s). */
const PLAN_T = Number((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SSL_PLAN ?? 1.1);
// Off by default (they measured worse): demo hunting and the flip kickoff.
const OFF = new Set(((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SSL_OFF ?? 'hunt,kick').split(',').filter(Boolean));

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
  /** Memory of the bot being driven this tick. */
  private cur: Mem | null = null;
  /** Rollout in progress: the touch being tested. */
  private forced: { sample: BallSample; cand: Cand; opp: number } | null = null;
  private readonly minis = new Map<number, World>();
  private readonly judgePath: BallSample[] = [];
  /** Counters for tools (aerials started, flicks…); null in games. */
  stats: Record<string, number> | null = null;
  /** Debug: a bot's role / plan. */
  planOf(id: number): string {
    const m = this.mem.get(id);
    return m ? `${m.role}/${m.plan}${m.aerialEnd > this.now ? '/air' : ''}${m.man ? `/${m.man.kind}` : ''}` : '-';
  }
  private count(k: string): void {
    if (this.stats) this.stats[k] = (this.stats[k] ?? 0) + 1;
  }

  constructor(
    private world: World,
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
      this.predictTimer = this.level === 'ssl' ? 1 / 30 : Math.max(0.05, L.reaction);
      this.predictBall();
    }
    this.assignRoles();
    for (const p of w.players) {
      if (!p.bot) continue;
      const car = w.car(p.id);
      if (!car) continue;
      let m = this.mem.get(p.id);
      if (!m) {
        m = { think: 0, role: 'attack', plan: 'ball', err: 0, errAt: 0, aim: 0, dodgeIn: -1, dodgePitch: 0, dodgeYaw: 0, jumpHold: 0, aerialAt: 0, aerialEnd: 0, kickoffWait: 0, kickoffRolled: false, demoTarget: -1, demoEnd: 0, pad: -1, lastJump: false, man: null, boostHold: false, kickFlip: false, carrySince: -1, planC: null, planAt: 0, planUntil: 0 };
        this.mem.set(p.id, m);
      }
      const c = car.demolished || w.phase === 'countdown' ? { ...NO_CONTROLS } : this.drive(car, m, L, dt);
      m.lastJump = c.jump;
      out.set(p.id, c);
    }
  }

  private predictBall(): void {
    const b = this.world.ball;
    predictBall(b, this.level === 'ssl' ? 4 : PREDICT_TIME, PREDICT_STEP, this.path);
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
    if (this.level === 'ssl' && !OFF.has('reach')) return this.reachTime(car, p, this.world.ball.radius + 40);
    const d = Math.hypot(p.x - car.pos.x, p.y - car.pos.y);
    const v = Math.min(C.CAR_MAX_SPEED, Math.max(1000, car.speed + (car.boost > 15 ? 600 : 250)));
    return d / v + (1 - this.facing(car, p)) * 0.5 + (car.onGround ? 0 : 0.3);
  }

  // -------------------------------------------------------------- decisions

  private drive(car: Car, m: Mem, L: Level, dt: number): Controls {
    const w = this.world;
    const out: Controls = { ...NO_CONTROLS };
    this.cur = m;
    if (m.man && this.maneuver(car, m, out, dt)) return out;
    // Dodge / double jump in progress (second press after the first).
    if (m.jumpHold > 0) {
      m.jumpHold -= dt;
      out.jump = true;
      out.throttle = 1;
      out.boost = m.boostHold && car.boost > 0;
      if (m.aerialEnd > this.now) out.pitch = 0.6;
      return out;
    }
    if (m.dodgeIn >= 0) {
      m.dodgeIn -= dt;
      out.throttle = 1;
      out.boost = m.boostHold && car.boost > 0;
      if (m.dodgeIn < 0) {
        out.jump = true;
        out.pitch = m.dodgePitch;
        out.yaw = m.dodgeYaw;
      }
      return out;
    }
    if (m.boostHold) {
      // Speed flip: boost on through the flip until the wheels are down.
      if (car.onGround && car.airTime === 0 && !car.isFlipping) m.boostHold = false;
      else {
        out.throttle = 1;
        out.boost = car.boost > 0;
        if (car.isFlipping) {
          // Cancel the flip (stick back): the car keeps the dodge's burst of speed and stays flat.
          out.pitch = 1;
        } else this.recover(car, out);
        return out;
      }
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
      if (this.level === 'ssl' && !OFF.has('airtouch') && this.airTouch(car, m, out)) return out;
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
    m.kickFlip = false;

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
    // SSL: a ball heading our way with us upfield of it is urgent too (get back, no boost errands).
    const beaten = this.level === 'ssl' && ball.vel.y * Math.sign(ownY) > 600 && Math.abs(car.pos.y - ownY) > Math.abs(ball.pos.y - ownY) - 300;
    const urgent = threat || nearOwnGoal || beaten || (m.role === 'attack' && eta < 1.5);
    // Current errand first.
    if (m.plan === 'boost' && !urgent) {
      const pad = w.pads[m.pad];
      if (pad && pad.timer <= 0 && car.boost < 90) return;
    }
    if (m.plan === 'demo' && this.demoEnd(car, m) === false) return;
    m.plan = m.role === 'attack' ? 'ball' : 'shadow';
    // SSL never chases a ball an opponent will clearly reach first from behind: it gets goal-side and waits for the touch.
    if (this.level === 'ssl' && !OFF.has('challenge') && m.role === 'attack' && !threat) {
      const ip = this.findIntercept(car, 260);
      if (ip) {
        const goalSide = Math.abs(car.pos.y - ownY) < Math.abs(ip.pos.y - ownY);
        const opp = Math.min(...w.cars.filter((e) => e.team !== car.team && !e.demolished).map((e) => this.ballEta(e)), 9);
        if (!goalSide && opp + 0.35 < eta && Math.abs(ip.pos.y - ownY) < 7000) m.plan = 'shadow';
      }
    }
    // SSL: our attacker is beaten (upfield of the ball) and it's in our half → the goal-side man steps up.
    if (this.level === 'ssl' && !OFF.has('stepup') && m.role !== 'attack' && Math.sign(ball.pos.y) === Math.sign(ownY)) {
      const att = w.car(this.attacker[car.team]);
      const goalSide = (c: Car) => Math.abs(c.pos.y - ownY) < Math.abs(ball.pos.y - ownY) - 100;
      if (att && att !== car && !goalSide(att) && goalSide(car) && ball.pos.distanceTo(car.pos) < 2600) {
        m.plan = 'ball';
        return;
      }
    }
    // Boost run: below 40 and the ball isn't urgent, via a pad near the way (the attacker only when the ball is far).
    const wantBoost =
      this.level === 'ssl'
        ? m.role === 'attack'
          ? (car.boost < 35 && eta > 1.6) || (car.boost < 12 && eta > 1.1)
          : car.boost < 60
        : m.role === 'attack'
          ? (car.boost < 30 && eta > 2.2) || (car.boost < 10 && eta > 1.5)
          : car.boost < 40;
    if (!urgent && wantBoost && w.rules.boostMode === 'default') {
      const sslBackInOurHalf = this.level === 'ssl' && m.role === 'back' && Math.sign(ball.pos.y) === Math.sign(ownY) && !OFF.has('nobackboost');
      const pad = this.choosePad(car, m.role === 'attack' ? ball.pos : this.shadowPoint(car, m), m.role === 'attack' ? 900 : sslBackInOurHalf ? 450 : 1600);
      if (pad >= 0) {
        m.plan = 'boost';
        m.pad = pad;
        return;
      }
    }
    // SSL: with the ball in their half, the off-ball man takes out their last defender.
    if (this.level === 'ssl' && !OFF.has('hunt') && m.role !== 'attack' && !threat && w.rules.demolish !== 'disabled' && Math.sign(ball.pos.y) !== Math.sign(ownY)) {
      const oppY = -ownY;
      let best: Car | null = null;
      for (const e of w.cars) if (e.team !== car.team && !e.demolished && (!best || Math.abs(e.pos.y - oppY) < Math.abs(best.pos.y - oppY))) best = e;
      if (best && this.eta(car, best.pos) < 2.5) {
        m.plan = 'demo';
        m.demoTarget = best.id;
        m.demoEnd = this.now + 3;
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
      // SSL speed flip: a front dodge cancelled straight away, boosting all the way — reaches the ball first.
      if (this.level === 'ssl' && !OFF.has('kick') && !m.kickFlip && car.onGround && car.speed > 750 && d > 1900 && this.facing(car, target) > 0.97) {
        m.kickFlip = true;
        this.count('speedFlip');
        m.jumpHold = 0.05;
        m.dodgeIn = 0.03;
        m.dodgePitch = -1;
        m.dodgeYaw = 0;
        m.boostHold = true;
        out.jump = true;
        return out;
      }
      if (d < (this.level === 'ssl' ? 560 : 650) && car.onGround && car.speed > 1200) this.startDodge(car, m, w.ball.pos, L);
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
    if (this.level === 'ssl' && !OFF.has('play')) {
      this.sslPlay(car, m, L, out);
      return;
    }
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
  private findAerial(car: Car, L: Level, maxT = 9): BallSample | null {
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const threat = this.goalIn.team === 1 - car.team;
    const ssl = this.level === 'ssl';
    for (const p of this.path) {
      const t = p.t + this.pathTime - this.now;
      if (t < (ssl ? 0.4 : 0.5)) continue;
      if (t > (ssl ? Math.min(3.2, maxT) : 2.2)) break;
      if (p.pos.z < (ssl ? 300 : L.blockZ + 60) || p.pos.z > L.aerialZ) continue;
      if (Math.abs(p.pos.y) > ARENA.halfY - 100) continue;
      // Reachable: after the jump + double jump (~0.3 s, ~+650 uu/s up) the boost must cover what's left against gravity.
      if (car.pos.distanceTo(p.pos) > (ssl ? 4200 : 2300)) continue;
      const aim = ssl ? this.aerialAim(car, p.pos, V()) : p.pos;
      const T = t - 0.3;
      const g = C.GRAVITY * this.world.rules.gravity;
      const from = this.tmp.copy(car.pos).addScaledVector(car.vel, 0.3);
      from.z += 120 * this.world.rules.jumpHeight;
      const need = this.tmp2.copy(aim).sub(from).addScaledVector(car.vel, -T);
      need.z -= 650 * this.world.rules.jumpHeight * T;
      need.multiplyScalar(2 / (T * T));
      need.z -= g;
      const acc = C.BOOST_ACCEL_AIR * this.world.rules.boostStrength;
      if (need.length() > acc * (ssl ? 0.88 : this.level === 'allstar' ? 0.8 : 0.65)) continue;
      // Enough boost for the flight (unlimited-boost games always have it).
      if (ssl && this.world.rules.boostMode === 'default' && (need.length() / acc) * T * C.BOOST_PER_SECOND + 4 > car.boost) continue;
      if (this.facing(car, p.pos) < (ssl ? (t > 1.2 ? 0.2 : 0.65) : this.level === 'allstar' ? 0.75 : 0.85)) continue;
      // Worth it: a save, or a ball in their half / coming down slowly; and it's ours to play.
      const worth = threat || Math.sign(p.pos.y) !== Math.sign(ownY) || this.level === 'allstar' || ssl;
      if (!worth) continue;
      return p;
    }
    return null;
  }

  /** Fly at the predicted ball: gravity-compensated lead, boost when the nose is on it. */
  private aerial(car: Car, m: Mem, L: Level, out: Controls): void {
    const ball = this.world.ball;
    const T = m.aerialAt - this.now;
    const ssl = this.level === 'ssl';
    const target = ssl ? this.aerialAim(car, this.sampleAt(m.aerialAt).pos, V()) : this.sampleAt(m.aerialAt).pos;
    const dist = car.pos.distanceTo(ball.pos);
    // Bail out: no boost, too late, or the meeting point needs more than the boost can give.
    if (car.boost < (ssl ? 3 : 10) || (T < -0.05 && dist > 300) || car.pos.distanceTo(target) > (ssl ? 4500 : 3000) || car.onGround || this.aerialAccel(car, target, T) > C.BOOST_ACCEL_AIR * (ssl ? 1.5 : 1.8)) {
      m.aerialEnd = 0;
      this.count('aerialBail');
      this.recover(car, out);
      return;
    }
    // Dodge into the ball when it's right there.
    if (dist < ball.radius + 130 && !car.hasFlipped) {
      this.count('aerialHit');
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
    out.boost = car.forward.dot(dir) > (ssl ? 0.7 : this.level === 'allstar' ? 0.75 : 0.85) && mag > 150 && car.boost > 0;
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
    const k = this.level === 'ssl' ? 1.6 : this.level === 'allstar' ? 1.4 : 1;
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
    const ssl = this.level === 'ssl';
    // SSL: a ball in our third coming at us is met head-on (cleared), never driven past with our back to it.
    if (ssl && !OFF.has('meet') && Math.abs(ball.pos.y - ownY) < 3000 && ball.pos.distanceTo(car.pos) < 1400 && (m.role === 'back' || ball.vel.y * Math.sign(ownY) > 300)) {
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
    // SSL: beaten upfield → sprint back.
    if (ssl && !out.boost && car.onGround && dist > 1200 && this.facing(car, target) > 0.9 && !car.supersonic && car.boost > 0) {
      const upfield = Math.abs(car.pos.y - ownY) > Math.abs(ball.pos.y - ownY) - 200;
      out.boost = upfield && ball.vel.y * Math.sign(ownY) > 400;
    }
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
    out.boost = car.boost > 0 && (this.level === 'ssl' || !car.supersonic) && this.facing(car, target) > 0.9;
    out.handbrake = false;
  }


  // -------------------------------------------------------------------- SSL

  /** Seconds to drive to `p` (stopping `stopShort` uu before it): land, turn, then full throttle + boost. */
  private reachTime(car: Car, p: Vector3, stopShort = 0): number {
    const dx = p.x - car.pos.x;
    const dy = p.y - car.pos.y;
    const full = Math.hypot(dx, dy);
    const d = full - stopShort;
    let air = 0;
    if (!car.onGround) {
      // Falling (a car on a wall counts as grounded): time to land.
      const z = Math.max(0, car.pos.z - C.CAR_REST_Z);
      const g = -C.GRAVITY * this.world.rules.gravity;
      air = Math.min(1.5, (car.vel.z + Math.sqrt(car.vel.z * car.vel.z + 2 * g * z)) / g);
    }
    if (d <= 0) return air;
    const fl = Math.hypot(car.forward.x, car.forward.y) || 1;
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * car.forward.x + dy * car.forward.y) / (full * fl))));
    // Fitted to the car driving with steerTo (mean error ~0.16 s): a turn costs ~0.14 s per radian and keeps cos(½·angle) of the speed.
    const turn = ang < 0.1 ? 0 : ang * 0.14;
    const v0 = Math.max(0, car.forwardSpeed) * Math.max(0.3, Math.cos(ang / 2));
    const mode = this.world.rules.boostMode;
    return air + turn + driveTime(v0, mode === 'unlimited' ? 100 : mode === 'none' ? 0 : car.boost, d);
  }

  /** Earliest predicted ball this car can be at in time — on the ground, or up to `maxZ` with a (double) jump. */
  private sslIntercept(car: Car, maxZ: number): BallSample | null {
    const R = this.world.ball.radius;
    for (const p of this.path) {
      if (Math.abs(p.pos.y) > ARENA.halfY + 50) break; // a goal will happen
      const t = p.t + this.pathTime - this.now;
      if (t < 0) continue;
      const wall = this.nearWall(p.pos);
      if (p.pos.z > (wall ? Math.max(maxZ, 900) : maxZ)) continue;
      if (!wall && p.pos.z > 190) {
        const j = jumpFor(p.pos.z);
        if (!j || j.t > t + 0.02) continue;
      }
      if (this.reachTime(car, p.pos, R + 40) <= t + 0.03) return p;
    }
    return null;
  }

  /** A dropping ball we can get under with no one else close: the start of a dribble. */
  private catchPoint(car: Car, maxT: number): BallSample | null {
    for (const p of this.path) {
      const t = p.t + this.pathTime - this.now;
      if (t < 0.25) continue;
      if (t > maxT) break;
      if (p.vel.z > -80 || p.pos.z < 150 || p.pos.z > 230 || Math.hypot(p.vel.x, p.vel.y) > 1300 || this.nearWall(p.pos)) continue;
      if (this.reachTime(car, p.pos, 0) <= t - 0.1) return p;
    }
    return null;
  }

  /** Earliest any opponent gets to the ball. */
  private oppEta(car: Car): number {
    let best = 9;
    for (const e of this.world.cars) if (e.team !== car.team && !e.demolished) best = Math.min(best, this.ballEta(e));
    return best;
  }

  /** SSL attack / save: dribble, aerial, catch, or an on-time ground / jump touch through the shot line. */
  private sslPlay(car: Car, m: Mem, L: Level, out: Controls): void {
    if (this.forced) {
      // Inside a rollout: play the candidate being tested.
      this.sslTouch(car, m, L, out, this.forced.sample, this.forced.cand, false, this.forced.opp);
      return;
    }
    const w = this.world;
    const ball = w.ball;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const threat = this.goalIn.team === 1 - car.team;
    if (!OFF.has('carry') && this.carry(car, m, out)) return;
    m.carrySince = -1;
    const hit = this.sslIntercept(car, L.blockZ);
    const hitT = hit ? hit.t + this.pathTime - this.now : 9;
    // Aerial when it gets there clearly before anything on the ground can.
    if (car.onGround && car.boost > 12 && car.up.z > 0.7 && !OFF.has('aerial')) {
      const a = this.findAerial(car, L, hitT - 0.25);
      if (a) {
        this.count('aerial');
        m.aerialAt = this.pathTime + a.t;
        m.aerialEnd = m.aerialAt + 0.5;
        m.jumpHold = 0.2;
        out.jump = true;
        out.pitch = 0.6;
        return;
      }
    }
    const opp = this.oppEta(car);
    // Catch it for a dribble: dropping, nobody near, away from our net.
    let sample = hit ?? this.landing();
    let catching = false;
    if (!threat && !OFF.has('catch') && m.role === 'attack' && Math.abs(ball.pos.y - ownY) > 3000) {
      const c = this.catchPoint(car, Math.min(2.5, opp - 0.8));
      if (c) {
        sample = c;
        catching = true;
      }
    }
    // Close to the touch: simulate the ways to play it and take the best.
    const tLeft = sample.t + this.pathTime - this.now;
    const cand = !catching && hit && tLeft < PLAN_T && car.onGround && !OFF.has('plan') ? this.planTouch(car, m, L, hit, opp) : null;
    this.sslTouch(car, m, L, out, sample, cand, catching, opp);
  }

  /** Drive the touch: to the contact point behind the ball on the shot line (`cand` overrides aim / offset / dodge), on time, jumping or dodging into it. */
  private sslTouch(car: Car, m: Mem, L: Level, out: Controls, sample: BallSample, cand: Cand | null, catching: boolean, opp: number): void {
    const ball = this.world.ball;
    const R = ball.radius;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const threat = this.goalIn.team === 1 - car.team;
    const ip = sample.pos;
    const tLeft = Math.max(0, sample.t + this.pathTime - this.now);
    const dir = cand ? cand.dir : this.shotDir(car, ip, m, L);
    const reach = catching ? 15 : R + car.halfExtents.x * 0.85;
    const contact = V().copy(ip).addScaledVector(dir, -reach).setZ(0);
    if (cand) contact.x += -dir.y * cand.off, contact.y += dir.x * cand.off;
    const toC = V().copy(contact).sub(car.pos).setZ(0);
    const dist = toC.length();
    const align = dist > 1 ? toC.dot(dir) / dist : 1;
    const goalSide = Math.abs(car.pos.y - ownY) < Math.abs(ip.y - ownY) + 100;
    const target = V().copy(contact);
    if (!goalSide && Math.abs(ip.y - ownY) < 2600 && !threat) {
      // Wrong side near our net: back post first, then challenge.
      const post = V().set(Math.sign(ip.x || 1) * -700, ownY * 0.92, 0);
      if (Math.abs(car.pos.y - ownY) > 1200 && car.pos.distanceTo(post) > 500) target.copy(this.avoidBall(car, post));
    } else if (align < 0.75 && dist > 250) {
      // Swing out behind the shot line so we arrive lined up with it.
      target.addScaledVector(dir, -Math.min(900, dist * 0.45) * (1 - Math.max(0, align)));
      if (align < 0.1) target.copy(this.avoidBall(car, target));
    }
    if (this.nearWall(ip) && ip.z > 200) target.copy(ip);
    else this.clampInside(target, ip);
    const intoOwn = this.headsAtOwnGoal(car, ip) && !threat;
    this.steerTo(car, intoOwn && dist < 900 ? this.avoidBall(car, target) : target, out, 1);

    // Arrive on time: early for a bouncing / uncontested ball means slow down and meet it, not overrun it.
    const fwd = car.forwardSpeed;
    const facingT = this.facing(car, target);
    if (out.throttle > 0 && car.onGround) {
      const early = this.reachTime(car, contact, 0) < tLeft - 0.15;
      if (early && (ip.z > 190 || catching || opp > tLeft + 0.5)) {
        const want = dist / Math.max(0.05, tLeft);
        out.throttle = fwd > want + 250 ? -1 : fwd > want + 50 ? 0 : 1;
        out.boost = fwd < want - 300 && facingT > 0.95 && car.boost > 0 && !car.supersonic;
      } else {
        // Boost when it matters (contested, defending, or plenty in the tank).
        const matters = threat || opp < tLeft + 0.6 || car.boost > 50 || dist > 2500;
        out.boost = matters && facingT > 0.92 && car.boost > 0 && !car.supersonic && !intoOwn;
      }
    }
    if (catching) return;
    // Jump / double jump timed so the nose meets the ball.
    const flat = Math.hypot(ip.x - car.pos.x, ip.y - car.pos.y);
    if (car.onGround && ip.z > 190 && !this.nearWall(ip) && this.facing(car, ip) > 0.75) {
      const j = jumpFor(ip.z);
      if (j && tLeft <= j.t + 1 / 60 && flat < reach + 140 + Math.max(0, fwd) * tLeft) {
        if (!this.forced) this.count(j.double ? 'doubleJumpShot' : 'jumpShot');
        m.jumpHold = 0.2;
        if (j.double) {
          m.dodgeIn = 0.01;
          m.dodgePitch = m.dodgeYaw = 0;
        }
        out.jump = true;
        return;
      }
    }
    // Ground shot: dodge through the ball at the last moment (power shot / clear / 50-50).
    if (car.onGround && ip.z < 190 && tLeft < 0.22 && flat < R + 80 + Math.max(0, fwd) * 0.16 && this.facing(car, ip) > 0.85 && fwd > 500) {
      const toBall = V().copy(ip).sub(car.pos).setZ(0).normalize();
      const clearing = threat || (Math.sign(ip.y) === Math.sign(ownY) && Math.abs(ip.y) > 2500);
      if (cand ? cand.dodge : toBall.dot(dir) > 0.8 || clearing || opp < tLeft + 0.25) this.startDodge(car, m, ip, L);
    }
  }


  /** Candidate touches (aims × contact offsets × dodge), each simulated with the real physics; the best is kept ~0.12 s. */
  private planTouch(car: Car, m: Mem, L: Level, hit: BallSample, opp: number): Cand | null {
    const at = hit.t + this.pathTime;
    if (m.planC && this.now < m.planUntil && Math.abs(m.planAt - at) < 0.1) return m.planC;
    const ip = hit.pos;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const oppY = -ownY;
    const reachX = ARENA.goalHalfX - this.world.ball.radius - 120;
    const dirs = [this.shotDir(car, ip, m, L)];
    for (const gx of [-reachX, 0, reachX]) dirs.push(V().set(gx - ip.x, oppY - ip.y, 0).normalize());
    // Clears: up the side walls.
    if (Math.sign(ip.y) === Math.sign(ownY)) for (const sx of [-1, 1]) dirs.push(V().set(sx * 4000 - ip.x, oppY * 0.3 - ip.y, 0).normalize());
    const toBall = V().copy(ip).sub(car.pos).setZ(0).normalize();
    const cands: Cand[] = [];
    for (const dir of dirs) {
      if (dir.dot(toBall) < -0.2) continue; // can't hit it that way from here
      for (const off of [-40, 0, 40]) cands.push({ dir, off, dodge: ip.z < 190 });
    }
    cands.push({ dir: dirs[0]!, off: 0, dodge: false });
    let best: Cand | null = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      const sc = this.rollout(car, m, L, hit, c, opp);
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    m.planC = best;
    m.planAt = at;
    m.planUntil = this.now + 0.12;
    return best;
  }

  /** Play `cand` forward with only this car and the ball (opponents ignored): how good is the ball after our touch? */
  private rollout(car: Car, m: Mem, L: Level, hit: BallSample, cand: Cand, opp: number): number {
    const real = this.world;
    const mini = this.miniWorld(car);
    const mc = mini.cars[0]!;
    copyCar(mc, car);
    const b = mini.ball;
    b.pos.copy(real.ball.pos);
    b.vel.copy(real.ball.vel);
    b.angVel.copy(real.ball.angVel);
    mini.tickCount = real.tickCount;
    mini.phase = 'play';
    mini.clock = 300;
    mini.events.length = 0;
    (mini as unknown as { extraHitTick: Map<number, number> }).extraHitTick.clear();
    const mm: Mem = { ...m, plan: 'ball', role: 'attack', think: 99, aerialEnd: 0, man: null, boostHold: false, carrySince: -1, planC: null };
    const cur = this.cur;
    const rng = this.rng;
    this.world = mini;
    this.forced = { sample: hit, cand, opp };
    const inputs = new Map<number, Controls>();
    const end = hit.t + this.pathTime + 0.35;
    let touchAt = -1;
    let goal = -1;
    try {
      while (mini.tickCount * C.TICK < end && touchAt < 0 && goal < 0) {
        const c = this.drive(mc, mm, L, C.TICK);
        mm.lastJump = c.jump;
        inputs.set(mc.id, c);
        mini.step(inputs);
        for (const e of mini.events) {
          if (e.k === 'touch') touchAt = mini.tickCount * C.TICK;
          if (e.k === 'goal') goal = e.team;
        }
        mini.events.length = 0;
      }
    } finally {
      this.world = real;
      this.forced = null;
      this.cur = cur;
      this.rng = rng;
    }
    if (goal >= 0) return goal === car.team ? 9000 : -9000;
    if (touchAt < 0) return -20000 + (cand.off === 0 ? 1 : 0);
    return this.judgeBall(b, car.team) - (touchAt - this.now) * 400;
  }

  /** Value of a free ball for `team`: a goal for / against, a shot on target, how far up the field it goes. */
  private judgeBall(ball: Ball, team: 0 | 1): number {
    const path = predictBall(ball, 3, 1 / 20, this.judgePath);
    const g = predictedGoal(path, ball.radius);
    const oppY = team === 0 ? ARENA.halfY : -ARENA.halfY;
    if (g === team) {
      let t = 3;
      for (const p of path) if (Math.abs(p.pos.y) >= ARENA.goalLineY) {
        t = p.t;
        break;
      }
      return 6000 - t * 400;
    }
    if (g === 1 - team) return -9000;
    const toward = Math.sign(oppY);
    const mid = path[Math.min(path.length - 1, 30)]!;
    const last = path[path.length - 1]!;
    let v = mid.pos.y * toward * 0.4 + last.pos.y * toward * 0.4;
    // Dangerous for them: passes in front of / near their net.
    for (const p of path)
      if (Math.sign(p.pos.y) === toward && Math.abs(p.pos.y) > ARENA.halfY - 1200 && Math.abs(p.pos.x) < ARENA.goalHalfX + 300 && p.pos.z < 900) {
        v += 1200;
        break;
      }
    // Sitting in front of our own net is bad.
    for (const p of path)
      if (Math.sign(p.pos.y) === -toward && Math.abs(p.pos.y) > ARENA.halfY - 1500 && Math.abs(p.pos.x) < 1600) {
        v -= 2500;
        break;
      }
    return v;
  }

  /** A one-car world (same hitbox) for rollouts. */
  private miniWorld(car: Car): World {
    let w = this.minis.get(car.id);
    if (!w) {
      const body = C.CAR_IDS.find((k) => C.carInfo(k).hitbox === car.body.id) ?? 'octane';
      w = new World([{ id: car.id, name: '', team: car.team, bot: true, body }], 300, 1, true, this.world.rules);
      this.minis.set(car.id, w);
    }
    return w;
  }

  /** Dribble: ball on the roof → keep it there heading for their net; flick when someone comes or we're in range. */
  private carry(car: Car, m: Mem, out: Controls): boolean {
    const ball = this.world.ball;
    if (!car.onGround || car.up.z < 0.9 || ball.pos.z < 120) return false;
    const rel = V().copy(ball.pos).sub(car.pos);
    const lx = rel.dot(car.forward);
    const ly = rel.dot(car.left);
    const lz = rel.dot(car.up);
    if (lz < 100 || lz > 250 || Math.abs(lx) > 120 || Math.abs(ly) > 90) return false;
    const rv = V().copy(ball.vel).sub(car.vel);
    if (rv.length() > 700) return false;
    if (m.carrySince < 0) {
      m.carrySince = this.now;
      this.count('carry');
    }
    const oppY = car.team === 0 ? ARENA.halfY : -ARENA.halfY;
    const goal = V().set(this.aimX(car, m, ball.pos), oppY, 0).sub(car.pos).setZ(0);
    const ang = Math.atan2(goal.dot(car.left), goal.dot(car.forward));
    const fx = rv.dot(car.forward);
    const fy = rv.dot(car.left);
    // Speed keeps the ball a touch ahead of the roof's centre; steering keeps it centred and turns for the net.
    const push = (lx - 20) / 40 + fx / 300;
    out.throttle = Math.max(-1, Math.min(1, push));
    out.boost = push > 1.4 && car.boost > 0;
    out.steer = Math.max(-1, Math.min(1, -ang * 0.8 - (ly / 40 + fy / 250)));
    const held = this.now - m.carrySince;
    const pressure = this.world.cars.some((e) => {
      if (e.team === car.team || e.demolished) return false;
      const d = e.pos.distanceTo(ball.pos);
      const closing = -V().copy(e.pos).sub(ball.pos).normalize().dot(e.vel);
      return d < 700 || (d < 1600 && closing > 900 && d / closing < 0.75);
    });
    const inRange = Math.abs(ball.pos.y - oppY) < 3200 && Math.abs(ang) < 0.4;
    if (held > 0.3 && (pressure || inRange || held > 5)) {
      this.count('flick');
      m.man = { kind: 'flick', t: 0, side: Math.abs(ang) > 0.25 ? (ang > 0 ? -1 : 1) : 0 };
      m.carrySince = -1;
    }
    return true;
  }

  /** Scripted moves: flick (jump, dodge with the ball on the roof) and half-flip (back flip, cancel, roll over). */
  private maneuver(car: Car, m: Mem, out: Controls, dt: number): boolean {
    const man = m.man!;
    man.t += dt;
    const t = man.t;
    if (man.kind === 'flick') {
      out.throttle = 1;
      if (t < 0.09) out.jump = true;
      else if (t >= 0.14 && t < 0.14 + dt * 1.5) {
        out.jump = true;
        out.pitch = man.side ? -0.7 : -1;
        out.yaw = 0.7 * man.side;
      } else if (t >= 0.14 + dt * 1.5) {
        m.man = null;
        return false;
      }
      return true;
    }
    // Half-flip.
    if (t < 0.07) {
      out.jump = true;
      out.throttle = -1;
    } else if (t < 0.11) out.throttle = -1;
    else if (t < 0.11 + dt * 1.5) {
      out.jump = true;
      out.pitch = 1;
    } else if (t < 0.45) {
      out.pitch = -1;
      out.roll = man.side;
      out.throttle = 1;
    } else if (!car.onGround && t < 1.6) {
      this.recover(car, out);
      out.throttle = 1;
      out.boost = car.boost > 0 && car.forward.z < 0.3 && car.forward.dot(V().copy(car.vel).setZ(0).normalize()) > 0.8;
    } else {
      m.man = null;
      return false;
    }
    return true;
  }

  /** In the air after a jump with the dodge unused and the ball right there: dodge into it. */
  private airTouch(car: Car, m: Mem, out: Controls): boolean {
    if (car.hasFlipped || car.hasDoubleJumped || (car.hasJumped && car.airTimeSinceJump > 1.2)) return false;
    const ball = this.world.ball;
    const to = V().copy(ball.pos).sub(car.hitboxCenter(V()));
    if (to.length() > ball.radius + 110 || to.dot(car.up) < -40 || car.airTime < 0.08) return false;
    const lx = to.dot(car.forward);
    const ly = to.dot(car.left);
    const len = Math.hypot(lx, ly);
    if (len < 20) return false;
    // Not if the dodge would knock it at our own net.
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const push = V().copy(car.forward).multiplyScalar(lx).addScaledVector(car.left, ly).setZ(0).normalize();
    if (push.y * Math.sign(ownY) > 0.6 && Math.abs(ball.pos.y - ownY) < 3000) return false;
    if (m.lastJump) return true; // release first, press next tick
    this.count('airDodge');
    out.jump = true;
    out.pitch = -lx / len;
    out.yaw = -ly / len;
    return true;
  }

  /** Where to meet a ball in the air so the hit sends it at their net (or clears it from ours). */
  private aerialAim(car: Car, p: Vector3, out: Vector3): Vector3 {
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const oppY = -ownY;
    const dir = V();
    if (Math.sign(p.y) === Math.sign(ownY) && Math.abs(p.y) > 1500 && this.goalIn.team === 1 - car.team)
      dir.set(p.x === 0 ? 1 : Math.sign(p.x), -Math.sign(ownY) * 1.5, 0.3).normalize(); // clear up-field and wide
    else dir.set(this.aimX(car, this.cur ?? ({ aim: 0 } as Mem), p) - p.x, oppY - p.y, Math.max(-p.z + 250, -400) * 0.6).normalize();
    return out.copy(p).addScaledVector(dir, -(this.world.ball.radius + 45));
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
    // SSL: a long way back the other way → half-flip instead of a slow U-turn.
    const m = this.cur;
    if (this.level === 'ssl' && !OFF.has('half') && m && !m.man && car.onGround && car.up.z > 0.9 && Math.abs(angle) > 2.6 && d > 1400 && car.forwardSpeed < 350 && car.forwardSpeed > -900) {
      this.count('halfFlip');
      m.man = { kind: 'half', t: 0, side: angle > 0 ? 1 : -1 };
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

// ------------------------------------------------------------- SSL tables

const RT_STEP = 1 / 30;
const RT_N = 180;
const RT_V = 24;
const RT_B = 11;
/** Distance driven straight in k·RT_STEP s at full throttle + boost, from speed bucket ×100 and boost bucket ×10. */
const REACH = (() => {
  const out = new Float32Array(RT_V * RT_B * RT_N);
  for (let vi = 0; vi < RT_V; vi++)
    for (let bi = 0; bi < RT_B; bi++) {
      let v = vi * 100;
      let b = bi * 10;
      let d = 0;
      const base = (vi * RT_B + bi) * RT_N;
      for (let k = 0; k < RT_N; k++) {
        out[base + k] = d;
        for (let s = 0; s < 4; s++) {
          const dt = RT_STEP / 4;
          let a = C.THROTTLE_ACCEL * C.curve(C.DRIVE_TORQUE_CURVE, v);
          if (b > 0) {
            a += C.BOOST_ACCEL_GROUND;
            b -= C.BOOST_PER_SECOND * dt;
          }
          v = Math.min(C.CAR_MAX_SPEED, v + a * dt);
          d += v * dt;
        }
      }
    }
  return out;
})();

/** Seconds to drive `d` uu straight from speed `v0` with `boost`. */
function driveTime(v0: number, boost: number, d: number): number {
  const base = (Math.max(0, Math.min(RT_V - 1, Math.round(v0 / 100))) * RT_B + Math.max(0, Math.min(RT_B - 1, Math.floor(boost / 10)))) * RT_N;
  const last = REACH[base + RT_N - 1]!;
  if (last < d) return RT_N * RT_STEP + (d - last) / C.CAR_MAX_SPEED;
  let lo = 0;
  let hi = RT_N - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (REACH[base + mid]! >= d) hi = mid;
    else lo = mid;
  }
  const d0 = REACH[base + lo]!;
  return (lo + (d - d0) / Math.max(1e-6, REACH[base + hi]! - d0)) * RT_STEP;
}

/** Car height gained per tick after a held jump (rising part only), with or without a second jump at ~0.21 s. */
function jumpRise(double: boolean): number[] {
  const out: number[] = [];
  let z = 0;
  let vz = C.JUMP_IMPULSE;
  for (let t = 0; t < 2 && (vz > 0 || t < 0.25); t += C.TICK) {
    out.push(z);
    if (t < C.JUMP_MAX_TIME) vz += C.JUMP_ACCEL * (t < C.JUMP_MIN_TIME ? 0.62 : 1) * C.TICK;
    vz += C.GRAVITY * C.TICK;
    if (double && Math.abs(t - 0.21) < C.TICK / 2) vz += C.JUMP_IMPULSE;
    z += vz * C.TICK;
  }
  return out;
}
const JUMP1 = jumpRise(false);
const JUMP2 = jumpRise(true);

/** Jump needed to meet a ball at height `ballZ` with the top of the nose: time from the press, and whether it takes a double jump. */
function jumpFor(ballZ: number): { t: number; double: boolean } | null {
  const dz = ballZ - 60 - C.CAR_REST_Z;
  for (const [table, double] of [[JUMP1, false], [JUMP2, true]] as const) {
    const k = table.findIndex((z) => z >= dz);
    if (k >= 0) return { t: k * C.TICK, double };
  }
  return null;
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

export const BOT_LEVELS: BotLevel[] = ['rookie', 'pro', 'allstar', 'ssl'];
export const BOT_NAMES = ['Merlin', 'Sundown', 'Rainmaker', 'Bandit', 'Hound', 'Sticks', 'Fury', 'Jester', 'Tusk', 'Viper', 'Casper', 'Gerwin', 'Junker', 'Squall', 'Raja', 'Saltie'];
