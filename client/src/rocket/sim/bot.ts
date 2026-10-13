import { Quaternion, Vector3 } from 'three';
import { predictBall, predictedGoal, type Ball, type BallSample } from './ball';
import { ARENA, arenaDistance } from './arena';
import { NO_CONTROLS, type Car, type Controls } from './car';
import * as C from './constants';
import { World } from './world';
import { NextoDriver, nextoReady, type NextoProfile } from './nexto';
import { DEFAULT_RULES } from './rules';

/** Bot difficulty, by Rocket League rank. Every rank plays through Nexto (see RANKS); this brain does kickoffs. */
export type BotLevel = 'bronze' | 'silver' | 'gold' | 'plat' | 'diamond' | 'champ' | 'gc' | 'ssl';
/** This file's own (hand-written) brain levels — kickoffs, mutator games, and tools. */
type BrainLevel = 'rookie' | 'pro' | 'allstar' | 'ssl';

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
type Level = (typeof LEVEL)[BrainLevel];

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
  /** Kickoff delay (fake) still to wait; seconds since the kickoff started. */
  kickoffWait: number;
  kickoffT: number;
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
  /** Simulated value of the planned touch, and when the next aerial may be considered. */
  planScore: number;
  airCheck: number;
  /** Aerial aim override (goal-mouth x), picked by simulation; null = the open-lane default. */
  airAimX: number | null;
  /** This aerial skips the fast-aerial double jump, keeping the flip to dodge into the ball. */
  airNoDJ: boolean;
  /** Aerial options being simulated a few per update. */
  airPend: { opts: AirOpt[]; i: number; best: number; pick: AirOpt | null } | null;
  /** SSL: intercepts before this world time were simulated as misses — look for a later one. */
  skipBefore: number;
  /** SSL save: the spot on the ball's path picked by simulation, when the ball gets there, its value, re-picked after. */
  blockSpot: Vector3 | null;
  blockAt: number;
  blockScore: number;
  blockUntil: number;
  /** Plans being simulated a few candidates per update (see SIM_BUDGET). */
  /** Stuck (throttle down, not moving) for this long; escape attempts so far; reversing out until (world time). */
  stuckT: number;
  unstickN: number;
  reverseUntil: number;
  planPend: { at: number; cands: Cand[]; i: number; best: Cand | null; score: number } | null;
  blockPend: { spots: Array<{ pos: Vector3; at: number }>; i: number; best: { pos: Vector3; at: number } | null; score: number } | null;
}

/** An aerial to simulate: meeting time (world), aim override (goal-mouth x), skip the double jump. */
interface AirOpt {
  at: number;
  ax: number | null;
  noDJ: boolean;
}

/** A way to play a touch: shot direction, contact offset sideways (uu), dodge into it or not. */
interface Cand {
  dir: Vector3;
  off: number;
  dodge: boolean;
  /** Full speed into it (a power shot) instead of arriving just on time. */
  rush?: boolean;
}

/** How an opponent is assumed to play during a rollout: drive hard at where the ball is going, jump at it when it's up and close. */
function defenderControls(c: Car, ball: Ball): Controls {
  const out: Controls = { ...NO_CONTROLS };
  if (c.demolished) return out;
  if (!c.onGround) {
    out.throttle = 1;
    return out;
  }
  const lead = Math.min(0.5, c.pos.distanceTo(ball.pos) / 2500);
  let tx = ball.pos.x + ball.vel.x * lead - c.pos.x;
  let ty = ball.pos.y + ball.vel.y * lead - c.pos.y;
  // Back in its own box with the ball further out: a keeper — gets on the ball's line in front of its net.
  const ownY = c.team === 0 ? -ARENA.halfY : ARENA.halfY;
  if (!OFF.has('keepsim') && Math.abs(c.pos.y - ownY) < 1800 && Math.abs(ball.pos.y - ownY) > Math.abs(c.pos.y - ownY) + 300) {
    const gy = ownY * 0.93;
    const vy = ball.vel.y;
    // Where the ball's line reaches the keeper's depth (its x now if it isn't coming this way).
    const k = vy * Math.sign(ownY) > 100 ? (gy - ball.pos.y) / vy : 0;
    const gx = Math.max(-ARENA.goalHalfX, Math.min(ARENA.goalHalfX, ball.pos.x + ball.vel.x * Math.max(0, Math.min(2, k))));
    tx = gx - c.pos.x;
    ty = gy - c.pos.y;
  }
  const lx = tx * c.forward.x + ty * c.forward.y;
  const ly = tx * c.left.x + ty * c.left.y;
  const ang = Math.atan2(ly, lx);
  const d = Math.hypot(tx, ty);
  out.steer = Math.max(-1, Math.min(1, -ang * 3));
  out.throttle = 1;
  out.handbrake = Math.abs(ang) > 1.6 && c.speed > 500;
  out.boost = Math.abs(ang) < 0.3 && d > 600 && c.boost > 0 && !c.supersonic;
  const bd = Math.hypot(ball.pos.x - c.pos.x, ball.pos.y - c.pos.y);
  // Settle on the keeper spot rather than overrun it; jump at a ball coming through high.
  if (d < 250) out.throttle = c.forwardSpeed > 300 ? -1 : 0.2;
  out.jump = ball.pos.z > 200 && ball.pos.z < 500 && bd < 350;
  return out;
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
const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
/** Half-flip timing: how long the back flip turns before it's cancelled, then how long to roll over (s). */
const HF_CANCEL = Number(ENV.SSL_HFC ?? 0.25);
const HF_ROLL = Number(ENV.SSL_HFR ?? 0.35);
/** Rollouts run on this long after our touch, with the opponents driving at the ball (s). */
const OPP_POST = Number(ENV.SSL_POST ?? 0.8);
/** Simulation steps the SSL planners may run per update (all bots together); past it they keep their last plan. */
const SIM_BUDGET = Number(ENV.SSL_BUDGET ?? 400);
/** SSL aerials: boost straight through the contact point for this long before it (s). */
const AIR_STRIKE = Number(ENV.SSL_STRIKE ?? 0.4);
/** Value of setting a teammate up in front of their net (cf. a shot on target ~5000). */
const PASS_VALUE = Number(ENV.SSL_PASS ?? 2500);
/** Support starts once our ball is this far into their half (uu). */
const SUP_MIN = Number(ENV.SSL_SUPMIN ?? 1500);
/** How long before a touch SSL starts simulating the ways to play it (s). */
const PLAN_T = Number((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SSL_PLAN ?? 1.1);
// Off by default (they measured worse in tools/rocket-versus.ts / rocket-drills.ts): demo hunting, the possession
// term, half-flips, power-shot candidates, shadow defence, deliberate wall climbs, the always-reachable touches.
const OFF = new Set(((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SSL_OFF ?? 'hunt,possess,half,rush,shadowdef,wallride,natural').split(',').filter(Boolean));

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
  /** Every car's ball ETA this update (see assignRoles). */
  private readonly etas = new Map<number, number>();
  private rng: number;
  private readonly tmp = V();
  private readonly tmp2 = V();
  /** Memory of the bot being driven this tick. */
  private cur: Mem | null = null;
  /** Rollout in progress: the touch being tested. */
  private forced: { sample: BallSample; cand: Cand; opp: number } | { air: true } | { spot: Vector3; at: number } | null = null;
  private readonly minis = new Map<number, World>();
  private readonly minisOpp = new Map<string, World>();
  private readonly judgePath: BallSample[] = [];
  /** Rollout steps simulated this update (see SIM_BUDGET). */
  private simSteps = 0;
  /** The rank being played (null = this brain only, at `brain`). */
  readonly rank: BotLevel | null;
  /** This brain's level (kickoffs, mutator games, or everything when there's no rank). */
  readonly brain: BrainLevel;
  /** Ranked bots: the Nexto policy (see nexto.ts) plays; this brain does kickoffs, and everything when Nexto can't. */
  private readonly nexto: NextoDriver | null;
  private readonly nextoCars = new Set<number>();
  /** Counters for tools (aerials started, flicks…); null in games. */
  stats: Record<string, number> | null = null;
  /** Debug: a bot's role / plan. */
  planOf(id: number): string {
    if (this.nextoCars.has(id)) return 'nexto';
    const m = this.mem.get(id);
    return m ? `${m.role}/${m.plan}${m.aerialEnd > this.now ? '/air' : ''}${m.man ? `/${m.man.kind}` : ''}` : '-';
  }
  private count(k: string): void {
    if (this.stats) this.stats[k] = (this.stats[k] ?? 0) + 1;
  }

  constructor(
    private world: World,
    level: BotLevel | BrainLevel = 'gold',
  ) {
    const rank = RANKS[level as BotLevel] ? (level as BotLevel) : null;
    this.rank = rank;
    this.brain = rank ? RANKS[rank].brain : (level as BrainLevel);
    this.rng = (world.rng ^ 0x9e3779b9) >>> 0 || 1;
    this.nexto = rank && !OFF.has('nexto') ? new NextoDriver(world, RANKS[rank].nexto) : null;
  }

  /** Nexto was trained in standard Rocket League physics: only use it when no physics mutator is on. */
  private nextoOk(): boolean {
    if (!this.nexto || !nextoReady()) return false;
    const r = this.world.rules;
    const d = DEFAULT_RULES;
    return r.gameSpeed === d.gameSpeed && r.gravity === d.gravity && r.ballSize === d.ballSize && r.ballWeight === d.ballWeight && r.ballBounce === d.ballBounce && r.ballMaxSpeed === d.ballMaxSpeed && r.ballDrag === d.ballDrag && r.hitPower === d.hitPower && r.boostStrength === d.boostStrength && r.jumpHeight === d.jumpHeight && r.airControl === d.airControl;
  }

  private rand(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  /** The planners' share of this update is used up (keep the last plan, re-plan next update). */
  private get overBudget(): boolean {
    return !this.forced && this.simSteps > SIM_BUDGET;
  }

  private get now(): number {
    return this.world.tickCount * C.TICK;
  }

  /** Controls for every bot car this tick. */
  update(dt: number, out: Map<number, Controls>): void {
    const w = this.world;
    const L = LEVEL[this.brain];
    this.simSteps = 0;
    this.predictTimer -= dt;
    if (this.predictTimer <= 0) {
      this.predictTimer = this.brain === 'ssl' ? 1 / 30 : Math.max(0.05, L.reaction);
      this.predictBall();
    }
    this.etas.clear();
    this.assignRoles();
    for (const p of w.players) {
      if (!p.bot) continue;
      const car = w.car(p.id);
      if (!car) continue;
      let m = this.mem.get(p.id);
      if (!m) {
        m = { think: 0, role: 'attack', plan: 'ball', err: 0, errAt: 0, aim: 0, dodgeIn: -1, dodgePitch: 0, dodgeYaw: 0, jumpHold: 0, aerialAt: 0, aerialEnd: 0, kickoffWait: 0, kickoffT: 0, kickoffRolled: false, demoTarget: -1, demoEnd: 0, pad: -1, lastJump: false, man: null, boostHold: false, kickFlip: false, carrySince: -1, planC: null, planAt: 0, planUntil: 0, planScore: -Infinity, airCheck: 0, airAimX: null, airNoDJ: false, airPend: null, skipBefore: 0, blockSpot: null, blockAt: 0, blockScore: 0, blockUntil: 0, planPend: null, blockPend: null, stuckT: 0, unstickN: 0, reverseUntil: 0 };
        this.mem.set(p.id, m);
      }
      // Nexto plays everything but the kickoff (and after the whistle, where it's this brain's drift).
      const kickoff = w.ball.pos.x === 0 && w.ball.pos.y === 0;
      const useNexto = this.nextoOk() && w.phase === 'play' && (!kickoff || (this.rank !== null && RANKS[this.rank].nextoKickoff === true));
      if (useNexto) this.nextoCars.add(p.id);
      else if (this.nextoCars.delete(p.id)) {
        // Taking back over from Nexto (kickoff): nothing of ours is in progress.
        Object.assign(m, { jumpHold: 0, dodgeIn: -1, man: null, boostHold: false, aerialEnd: 0, kickoffRolled: false, kickFlip: false, planC: null, planPend: null, blockPend: null, airPend: null, stuckT: 0, reverseUntil: 0 });
      }
      const c = car.demolished || w.phase === 'countdown' ? { ...NO_CONTROLS } : useNexto ? this.nexto!.controls(car) : this.drive(car, m, L, dt);
      m.lastJump = c.jump;
      out.set(p.id, c);
    }
  }

  private predictBall(): void {
    const b = this.world.ball;
    predictBall(b, this.brain === 'ssl' ? 4 : PREDICT_TIME, PREDICT_STEP, this.path);
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
      mates.forEach((c, i) => this.etas.set(c.id, etas[i]!));
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
    if (this.brain === 'ssl' && !OFF.has('reach')) return this.reachTime(car, p, this.world.ball.radius + 40);
    const d = Math.hypot(p.x - car.pos.x, p.y - car.pos.y);
    const v = Math.min(C.CAR_MAX_SPEED, Math.max(1000, car.speed + (car.boost > 15 ? 600 : 250)));
    return d / v + (1 - this.facing(car, p)) * 0.5 + (car.onGround ? 0 : 0.3);
  }

  // -------------------------------------------------------------- decisions

  private drive(car: Car, m: Mem, L: Level, dt: number): Controls {
    const w = this.world;
    const out: Controls = { ...NO_CONTROLS };
    this.cur = m;
    // Wedged somewhere (e.g. on two wheels against the net), flooring it and going nowhere: jump free, or back out.
    if (!this.forced && !OFF.has('unstick') && w.phase === 'play') {
      if (this.now < m.reverseUntil) {
        out.throttle = -1;
        out.steer = -car.controls.steer || 1;
        return out;
      }
      const pushing = Math.abs(car.controls.throttle) > 0.9 && car.vel.length() < 120 && m.jumpHold <= 0 && m.dodgeIn < 0;
      m.stuckT = pushing ? m.stuckT + dt : 0;
      if (car.vel.length() > 600) m.unstickN = 0;
      if (m.stuckT > 0.6) {
        m.stuckT = 0;
        this.count('unstick');
        if (m.unstickN++ % 2 === 0 && (car.numContacts > 0 || car.worldContact)) {
          m.jumpHold = 0.15;
          out.jump = true;
          return out;
        }
        m.reverseUntil = this.now + 0.6;
        out.throttle = -1;
        return out;
      }
    }
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
      if (this.brain === 'ssl' && !OFF.has('airtouch') && this.airTouch(car, m, out)) return out;
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
    const beaten = this.brain === 'ssl' && ball.vel.y * Math.sign(ownY) > 600 && Math.abs(car.pos.y - ownY) > Math.abs(ball.pos.y - ownY) - 300;
    const urgent = threat || nearOwnGoal || beaten || (m.role === 'attack' && eta < 1.5);
    // Current errand first.
    // SSL: the ball is ours to play now — drop a boost errand unless we're nearly out.
    if (m.plan === 'boost' && this.brain === 'ssl' && m.role === 'attack' && car.boost > 30 && !OFF.has('dropboost')) m.plan = 'ball';
    if (m.plan === 'boost' && !urgent) {
      const pad = w.pads[m.pad];
      if (pad && pad.timer <= 0 && car.boost < 90) return;
    }
    if (m.plan === 'demo' && this.demoEnd(car, m) === false) return;
    m.plan = m.role === 'attack' ? 'ball' : 'shadow';
    // SSL never chases a ball an opponent will clearly reach first from behind: it gets goal-side and waits for the touch.
    if (this.brain === 'ssl' && !OFF.has('challenge') && m.role === 'attack' && !threat) {
      const ip = this.findIntercept(car, 260);
      if (ip) {
        const goalSide = Math.abs(car.pos.y - ownY) < Math.abs(ip.pos.y - ownY);
        const opp = Math.min(...w.cars.filter((e) => e.team !== car.team && !e.demolished).map((e) => this.ballEta(e)), 9);
        if (!goalSide && opp + 0.35 < eta && Math.abs(ip.pos.y - ownY) < 7000) m.plan = 'shadow';
      }
    }
    // SSL: our attacker is beaten (upfield of the ball) and it's in our half → the goal-side man steps up.
    if (this.brain === 'ssl' && !OFF.has('stepup') && m.role !== 'attack' && Math.sign(ball.pos.y) === Math.sign(ownY)) {
      const att = w.car(this.attacker[car.team]);
      const goalSide = (c: Car) => Math.abs(c.pos.y - ownY) < Math.abs(ball.pos.y - ownY) - 100;
      if (att && att !== car && !goalSide(att) && goalSide(car) && ball.pos.distanceTo(car.pos) < 2600) {
        m.plan = 'ball';
        return;
      }
    }
    // Boost run: below 40 and the ball isn't urgent, via a pad near the way (the attacker only when the ball is far).
    const wantBoost =
      this.brain === 'ssl'
        ? m.role === 'attack'
          ? (car.boost < 35 && eta > 1.6) || (car.boost < 12 && eta > 1.1)
          : car.boost < 60
        : m.role === 'attack'
          ? (car.boost < 30 && eta > 2.2) || (car.boost < 10 && eta > 1.5)
          : car.boost < 40;
    // Supporting our attack: no boost errands (small pads on the way only) unless nearly empty.
    const supporting = m.role !== 'attack' && car.boost >= 20 && !!this.supportPoint(car);
    if (!urgent && wantBoost && !supporting && w.rules.boostMode === 'default') {
      const sslBackInOurHalf = this.brain === 'ssl' && m.role === 'back' && Math.sign(ball.pos.y) === Math.sign(ownY) && !OFF.has('nobackboost');
      const pad = this.choosePad(car, m.role === 'attack' ? ball.pos : this.shadowPoint(car, m), m.role === 'attack' ? 900 : sslBackInOurHalf ? 450 : 1600);
      if (pad >= 0) {
        m.plan = 'boost';
        m.pad = pad;
        return;
      }
    }
    // SSL: with the ball in their half, the off-ball man takes out their last defender.
    if (this.brain === 'ssl' && !OFF.has('hunt') && m.role !== 'attack' && !threat && w.rules.demolish !== 'disabled' && Math.sign(ball.pos.y) !== Math.sign(ownY)) {
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
        // SSL only demos when it's right there (not a cross-field errand), never instead of supporting our attack.
        if (this.brain === 'ssl' && !OFF.has('demorestraint') && (this.eta(car, e.pos) > 1.1 || this.facing(car, e.pos) < 0.85 || this.supportPoint(car))) continue;
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
    let taker = mates.every((c) => c === car || c.pos.distanceTo(w.ball.pos) > d - 1 && (c.pos.distanceTo(w.ball.pos) > d + 1 || c.id > car.id));
    if (!m.kickoffRolled) {
      m.kickoffRolled = true;
      m.kickoffT = 0;
      m.kickoffWait = this.rand() < L.fake ? 0.2 + this.rand() * 0.3 : 0;
    }
    m.kickoffT += dt;
    // SSL: the teammate who should take it is a human who isn't going for it — go ourselves.
    if (!taker && this.brain === 'ssl' && !OFF.has('kickcover') && m.kickoffT > 0.35) {
      const ball = w.ball.pos;
      const ahead = mates.filter((c) => c !== car && c.pos.distanceTo(ball) <= d + 1);
      taker = ahead.every((c) => {
        if (w.players.find((p) => p.id === c.id)?.bot) return false;
        const to = V().copy(ball).sub(c.pos).setZ(0).normalize();
        return c.vel.dot(to) < 450;
      });
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
      if (this.brain === 'ssl' && !OFF.has('kick') && !m.kickFlip && car.onGround && car.speed > 750 && d > 1900 && this.facing(car, target) > 0.97) {
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
      if (d < (this.brain === 'ssl' ? 560 : 650) && car.onGround && car.speed > 1200) this.startDodge(car, m, w.ball.pos, L);
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
    if (this.brain === 'ssl' && !OFF.has('play')) {
      this.sslPlay(car, m, L, out);
      return;
    }
    const w = this.world;
    const ball = w.ball;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const oppY = -ownY;
    const threat = this.goalIn.team === 1 - car.team;
    // Aerial opportunity (pro: simple, all-star: higher / further).
    if (L.aerialZ > 0 && car.onGround && car.boost > (this.brain === 'allstar' ? 30 : 45)) {
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
      off += Math.min(700, dist * 0.35) * (1 - Math.max(0, align)) * (this.brain === 'rookie' ? 0.6 : 1);
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
  private findAerial(car: Car, L: Level, maxT = 9, minT = 0): BallSample | null {
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const threat = this.goalIn.team === 1 - car.team;
    const ssl = this.brain === 'ssl';
    for (const p of this.path) {
      const t = p.t + this.pathTime - this.now;
      if (t < Math.max(minT, ssl ? 0.4 : 0.5)) continue;
      if (t > (ssl ? Math.min(3.2, maxT) : 2.2)) break;
      if (p.pos.z < (ssl ? 300 : L.blockZ + 60) || p.pos.z > L.aerialZ) continue;
      if (Math.abs(p.pos.y) > ARENA.halfY - 100) continue;
      // Reachable: after the jump + double jump (~0.3 s, ~+650 uu/s up) the boost must cover what's left against gravity.
      if (car.pos.distanceTo(p.pos) > (ssl ? 4200 : 2300)) continue;
      const aim = ssl ? this.aerialAim(car, p.pos, V()) : p.pos;
      const T = t - 0.3;
      const g = C.GRAVITY * this.world.rules.gravity;
      // The jump pushes off along the roof (up off the floor, out from a wall — SSL takes off from walls too).
      const up = ssl && !OFF.has('wallair') ? car.up : V().set(0, 0, 1);
      const from = this.tmp.copy(car.pos).addScaledVector(car.vel, 0.3).addScaledVector(up, 120 * this.world.rules.jumpHeight);
      const need = this.tmp2.copy(aim).sub(from).addScaledVector(car.vel, -T).addScaledVector(up, -650 * this.world.rules.jumpHeight * T);
      need.multiplyScalar(2 / (T * T));
      need.z -= g;
      const acc = C.BOOST_ACCEL_AIR * this.world.rules.boostStrength;
      if (need.length() > acc * (ssl ? 0.88 : this.brain === 'allstar' ? 0.8 : 0.65)) continue;
      // Enough boost for the flight (unlimited-boost games always have it).
      if (ssl && this.world.rules.boostMode === 'default' && (need.length() / acc) * T * C.BOOST_PER_SECOND + 4 > car.boost) continue;
      // Facing: on a wall the nose can be anywhere — the air control turns it on the way.
      if ((car.up.z > 0.7 || !ssl) && this.facing(car, p.pos) < (ssl ? (t > 1.2 ? 0.2 : 0.65) : this.brain === 'allstar' ? 0.75 : 0.85)) continue;
      // Worth it: a save, or a ball in their half / coming down slowly; and it's ours to play.
      const worth = threat || Math.sign(p.pos.y) !== Math.sign(ownY) || this.brain === 'allstar' || ssl;
      if (!worth) continue;
      return p;
    }
    return null;
  }

  /** Fly at the predicted ball: gravity-compensated lead, boost when the nose is on it. */
  private aerial(car: Car, m: Mem, L: Level, out: Controls): void {
    const ball = this.world.ball;
    const T = m.aerialAt - this.now;
    const ssl = this.brain === 'ssl';
    const target = ssl ? this.aerialAim(car, this.sampleAt(m.aerialAt).pos, V()) : this.sampleAt(m.aerialAt).pos;
    const dist = car.pos.distanceTo(ball.pos);
    // Bail out: no boost, too late, or the meeting point needs more than the boost can give.
    if (car.boost < (ssl ? 3 : 10) || (T < -0.05 && dist > 300) || car.pos.distanceTo(target) > (ssl ? 4500 : 3000) || car.onGround || this.aerialAccel(car, target, T) > C.BOOST_ACCEL_AIR * (ssl ? 1.5 : 1.8)) {
      // SSL: the ball moved (someone touched it) — fly at where it's going now if that's still reachable.
      const re = ssl && !car.onGround && !car.hasFlipped && !OFF.has('retarget') ? this.airRetarget(car) : null;
      if (re) {
        this.count('airRetarget');
        m.aerialAt = this.pathTime + re.t;
        m.aerialEnd = m.aerialAt + 0.5;
        this.aerial(car, m, L, out);
        return;
      }
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
    // SSL power: the last moments before contact, nose on the contact point and boost through it.
    const strike = ssl && !OFF.has('strike') && T < AIR_STRIKE && T > 0 && car.boost > 0;
    if (strike) dir.copy(target).sub(car.pos).normalize();
    this.pointAt(car, dir, out, L);
    out.boost = car.forward.dot(dir) > (ssl ? 0.7 : this.brain === 'allstar' ? 0.75 : 0.85) && (mag > 150 || strike) && car.boost > 0;
    // Fast aerial: double jump (sticks neutral) right after the first jump.
    if (car.hasJumped && !car.hasDoubleJumped && !car.hasFlipped && car.airTimeSinceJump < 0.25 && T > 0.4 && !m.lastJump && !m.airNoDJ) {
      out.jump = true;
      out.pitch = out.yaw = out.roll = 0;
    }
  }

  /** Where to climb a side wall to fly at a ball floating high beside it (null = no such ball). */
  private wallSpot(car: Car): Vector3 | null {
    for (const p of this.path) {
      const t = p.t + this.pathTime - this.now;
      if (t < 0.9) continue;
      if (t > 3) break;
      if (p.pos.z < 550 || p.pos.z > 1500 || Math.abs(p.pos.x) < ARENA.halfX - 900 || Math.abs(p.pos.y) > ARENA.halfY - 900) continue;
      // Reach the foot of the wall below it in time to climb.
      const foot = V().set(Math.sign(p.pos.x) * (ARENA.halfX - 150), p.pos.y - Math.sign(p.pos.y - car.pos.y) * 300, 0);
      if (this.reachTime(car, foot, 0) + 0.6 > t) continue;
      return foot.setX(Math.sign(p.pos.x) * (ARENA.halfX + 300)).setZ(Math.min(p.pos.z - 300, 700));
    }
    return null;
  }

  /** Take off for an aerial meeting the ball at world time `at`. */
  private startAerial(m: Mem, out: Controls, at: number, ax: number | null, noDJ: boolean): void {
    this.count('aerial');
    m.aerialAt = at;
    m.aerialEnd = at + 0.5;
    m.airAimX = ax;
    m.airNoDJ = noDJ;
    m.jumpHold = 0.2;
    out.jump = true;
    out.pitch = 0.6;
  }

  /** In the air with boost: the earliest predicted ball we can still fly to (and leave with a shot or clear). */
  private airRetarget(car: Car): BallSample | null {
    const acc = C.BOOST_ACCEL_AIR * this.world.rules.boostStrength;
    const aim = V();
    for (const p of this.path) {
      const t = p.t + this.pathTime - this.now;
      if (t < 0.15 || p.pos.z < 200) continue;
      if (t > 2.2) break;
      this.aerialAim(car, p.pos, aim);
      const need = this.aerialAccel(car, aim, t);
      if (need > acc * 0.85) continue;
      if (this.world.rules.boostMode === 'default' && (need / acc) * t * C.BOOST_PER_SECOND + 3 > car.boost) continue;
      return p;
    }
    return null;
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
    const k = this.brain === 'ssl' ? 1.6 : this.brain === 'allstar' ? 1.4 : 1;
    const rate = (e: number) => Math.sign(e) * Math.min(5 * Math.abs(e), Math.sqrt(2 * 7 * Math.abs(e)));
    out.pitch = Math.max(-1, Math.min(1, (rate(err.dot(right)) - aw.dot(right)) * k));
    out.yaw = Math.max(-1, Math.min(1, -(rate(err.dot(car.up)) - aw.dot(car.up)) * k));
    out.roll = Math.max(-1, Math.min(1, -car.left.z * 2.5 - aw.dot(car.forward) * 0.3));
    void L;
  }

  // ----------------------------------------------------------------- shadow

  /** Our side's hold on the ball: 2 = a teammate gets there clearly first, 1 = a teammate is contesting it, 0 = theirs / loose. */
  private possession(car: Car): 0 | 1 | 2 {
    let mateT = 9;
    let opp = 9;
    for (const c of this.world.cars) {
      if (c.demolished) continue;
      let t = this.etas.get(c.id) ?? this.ballEta(c);
      // Dribbling (ball on its nose / roof, moving with it): it has the ball now, whatever the ETA says.
      const ball = this.world.ball;
      if (Math.hypot(ball.pos.x - c.pos.x, ball.pos.y - c.pos.y) < 320 && Math.hypot(ball.vel.x - c.vel.x, ball.vel.y - c.vel.y) < 700) t = 0;
      if (c.team !== car.team) opp = Math.min(opp, t);
      else if (c !== car) mateT = Math.min(mateT, t);
    }
    return mateT + 0.25 < opp ? 2 : mateT < opp + 0.35 ? 1 : 0;
  }

  /**
   * SSL support: a teammate has (or is fighting for) the ball in their half → come up for the pass /
   * rebound instead of waiting at our net: central, a pass-length behind the ball (further back while
   * it's a 50-50), on the far side of it from the carrier's wing.
   */
  private supportPoint(car: Car): Vector3 | null {
    if (this.brain !== 'ssl' || OFF.has('support')) return null;
    const ball = this.world.ball;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const dir = -Math.sign(ownY); // towards their goal
    const pos = this.possession(car);
    // Only once the ball is well into their half (deeper still while it's a 50-50): at midfield a lost
    // touch is a breakaway, so the last man stays goal-side.
    if (!pos || ball.pos.y * dir < (pos === 2 ? SUP_MIN : 2500)) return null;
    // Their counter-attacker cherry-picking deep in our half with us out of boost: stay home.
    if (car.boost < 15 && this.world.cars.some((e) => e.team !== car.team && !e.demolished && e.pos.y * dir < -2500)) return null;
    // A pass-length behind the ball, never level with it.
    const gap = pos === 2 ? (ball.pos.y * dir > 2500 ? 1400 : 2100) : 2300;
    const y = Math.min(ball.pos.y * dir - gap, ARENA.halfY * (pos === 2 ? 0.62 : 0.4));
    const x = Math.abs(ball.pos.x) > 1500 ? -Math.sign(ball.pos.x) * 350 : Math.max(-1500, Math.min(1500, -ball.pos.x * 0.6));
    return V().set(x, y * dir, 0);
  }

  /** Goal-side waiting spot: matches the ball's x, between it and our net, further back the faster it comes. */
  private shadowPoint(car: Car, m: Mem): Vector3 {
    const sp = this.supportPoint(car);
    if (sp) {
      this.count('support');
      return sp;
    }
    const ball = this.world.ball;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const toward = Math.sign(ownY);
    const closing = Math.max(0, ball.vel.y * toward);
    const back = m.role === 'support' ? 1300 : Math.max(1500, Math.min(3200, 1800 + closing * 0.6));
    let y = ball.pos.y + toward * back;
    if (Math.abs(y) > Math.abs(ownY) * 0.88) y = ownY * 0.88;
    // Never past the far side of midfield; SSL's last man stays this side of it, deeper still on low boost.
    const limit = this.brain === 'ssl' && m.role === 'back' && !OFF.has('lastman') ? (car.boost < 30 ? -1200 : 0) : 800;
    if (y * -toward > limit) y = -toward * limit;
    const inBox = Math.abs(y - ownY) < 1300;
    const x = inBox ? Math.max(-700, Math.min(700, ball.pos.x * 0.3)) : Math.max(-2200, Math.min(2200, ball.pos.x * (m.role === 'support' ? 0.4 : 0.6)));
    return V().set(x, y, 0);
  }

  private shadow(car: Car, m: Mem, L: Level, out: Controls): void {
    const ball = this.world.ball;
    const spot = this.shadowPoint(car, m);
    const target = this.avoidBall(car, this.viaSmallPad(car, spot));
    // Distance to the waiting spot itself (not to a boost pad on the way there).
    const dist = car.pos.distanceTo(spot);
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    // Ball coming at the net: the back player challenges / blocks instead of waiting.
    const threat = this.goalIn.team === 1 - car.team && this.goalIn.t < 2.5;
    const ssl = this.brain === 'ssl';
    // SSL: never two of us on the same ball — if a teammate is already getting there first, cover.
    const covered = ssl && !OFF.has('nodouble') && this.mateFirst(car);
    if (threat && !covered && (m.role === 'back' || ball.pos.distanceTo(car.pos) < 1500)) {
      this.playBall(car, m, L, out);
      return;
    }
    // SSL: a ball in our third coming at us is met head-on (cleared), never driven past with our back to it.
    if (ssl && !covered && !OFF.has('meet') && Math.abs(ball.pos.y - ownY) < 3000 && ball.pos.distanceTo(car.pos) < 1400 && (m.role === 'back' || ball.vel.y * Math.sign(ownY) > 300)) {
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
    // SSL: get up into support in time for the pass.
    if (ssl && !out.boost && car.onGround && dist > 1200 && car.boost > 20 && this.facing(car, target) > 0.92 && !car.supersonic && this.supportPoint(car)) out.boost = true;
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
    // SSL picks up more of the small pads the emptier its tank.
    const allow = this.brain === 'ssl' && !OFF.has('pads') ? 120 + Math.max(0, 60 - car.boost) * 5 : 120;
    for (const p of this.world.pads) {
      if (p.timer > 0 || p.big) continue;
      const pos = this.tmp.set(p.x, p.y, 0);
      const d1 = car.pos.distanceTo(pos);
      if (d1 < 150 || d1 > direct) continue;
      const detour = d1 + pos.distanceTo(target) - direct;
      if (detour > allow || d1 > bestD) continue;
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
    out.boost = car.boost > 0 && (this.brain === 'ssl' || !car.supersonic) && this.facing(car, target) > 0.9;
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
  private sslIntercept(car: Car, maxZ: number, after = 0): BallSample | null {
    const R = this.world.ball.radius;
    for (const p of this.path) {
      if (Math.abs(p.pos.y) > ARENA.halfY + 50) break; // a goal will happen
      const t = p.t + this.pathTime - this.now;
      if (t < 0 || p.t + this.pathTime < after) continue;
      const wall = this.nearWall(p.pos);
      if (p.pos.z > (wall ? Math.max(maxZ, 900) : maxZ)) continue;
      if (!wall && p.pos.z > 190) {
        const j = jumpFor(p.pos.z, OFF.has('jt') ? 9 : SHOT_JUMP_T);
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
      // Inside a rollout: play the candidate being tested (an aerial rollout does nothing once it lands).
      if ('air' in this.forced) return;
      if ('spot' in this.forced) {
        this.blockTo(car, m, out, this.forced.spot, this.forced.at);
        return;
      }
      this.sslTouch(car, m, L, out, this.forced.sample, this.forced.cand, false, this.forced.opp);
      return;
    }
    const w = this.world;
    const ball = w.ball;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const threat = this.goalIn.team === 1 - car.team;
    if (!OFF.has('carry') && this.carry(car, m, out)) return;
    m.carrySince = -1;
    // Shadow defence: an opponent is dribbling at us — stay goal-side and wait for the mistake
    // (or the box) instead of diving in and getting beaten.
    if (!OFF.has('shadowdef') && this.shadowDefend(car, out)) return;
    if (m.skipBefore && this.now > m.skipBefore + 0.3) m.skipBefore = 0;
    const hit = this.sslIntercept(car, L.blockZ, OFF.has('skip') ? 0 : m.skipBefore);
    const hitT = hit ? hit.t + this.pathTime - this.now : 9;
    // Aerial when it gets there clearly before anything on the ground can — and, simulated, it
    // actually reaches the ball and leaves it better than the ground option (or than leaving it).
    if (car.onGround && car.boost > 12 && (car.up.z > 0.7 || (!OFF.has('wallair') && car.pos.z > 250)) && !OFF.has('aerial')) {
      if (!m.airPend && this.now >= m.airCheck && !this.overBudget) {
        m.airCheck = this.now + 0.12;
        const a = this.findAerial(car, L, hitT - 0.25);
        if (a && OFF.has('airsim')) {
          this.startAerial(m, out, this.pathTime + a.t, null, false);
          return;
        }
        if (a) {
          // A few ways to take it: now or a beat later, at the open lane or the far post, with or without
          // the fast-aerial double jump (without it the flip is kept for a harder hit) — simulated over the
          // next few updates, best one wins.
          const reachX = ARENA.goalHalfX - ball.radius - 120;
          const opts: AirOpt[] = [{ at: this.pathTime + a.t, ax: null, noDJ: false }];
          if (!OFF.has('airflip')) opts.push({ at: this.pathTime + a.t, ax: null, noDJ: true });
          if (!OFF.has('aircands')) {
            const later = this.findAerial(car, L, hitT - 0.25, a.t + 0.35);
            if (later) opts.push({ at: this.pathTime + later.t, ax: null, noDJ: false });
            if (Math.sign(a.pos.y) !== Math.sign(ownY)) {
              const ax = a.pos.x > 0 ? -reachX : reachX;
              opts.push({ at: this.pathTime + a.t, ax, noDJ: false });
              if (!OFF.has('airflip')) opts.push({ at: this.pathTime + a.t, ax, noDJ: true });
            }
          }
          m.airPend = { opts, i: 0, best: -Infinity, pick: null };
        }
      }
      const pend = m.airPend;
      if (pend) {
        let n = 0;
        while (pend.i < pend.opts.length && (n === 0 || !this.overBudget)) {
          const o = pend.opts[pend.i++]!;
          n++;
          if (o.at < this.now + 0.35) continue; // too late to take off for it now
          const sc = this.rolloutAerial(car, m, L, o.at, o.ax, o.noDJ);
          if (sc > pend.best) {
            pend.best = sc;
            pend.pick = o;
          }
        }
        if (pend.i >= pend.opts.length) {
          m.airPend = null;
          const ground = hit && hitT < PLAN_T && m.planC && Math.abs(m.planAt - (hit.t + this.pathTime)) < 0.15 ? m.planScore : this.judgeBall(ball, car.team);
          const pick = pend.pick;
          if (pick && pend.best >= ground + 150 && pick.at > this.now + 0.3) {
            if (pick.noDJ) this.count('airNoDJ');
            this.startAerial(m, out, pick.at, pick.ax, pick.noDJ);
            return;
          }
        }
      }
    } else m.airPend = null;
    const opp = this.oppEta(car);
    // SSL wall play: a high ball by a side wall and no ground touch soon — drive up the wall under it
    // (the aerial check above takes off from there).
    if (!threat && m.role === 'attack' && !OFF.has('wallride') && car.onGround && car.boost > 25 && (!hit || hitT > 1.3)) {
      const spot = this.wallSpot(car);
      if (spot) {
        this.count('wallRide');
        this.steerTo(car, spot, out, 1);
        out.boost = car.up.z > 0.7 && this.facing(car, spot) > 0.9 && car.pos.distanceTo(spot) > 1500 && !car.supersonic;
        return;
      }
    }
    if (threat && !OFF.has('block') && car.onGround) {
      // A shot is coming in: play the touch only when it simulates as a clean clear; otherwise get
      // on the ball's path early and meet it head-on (jumping into a high one).
      const cand = hit && hitT < PLAN_T && !OFF.has('plan') ? this.planTouch(car, m, L, hit, opp) : null;
      if (cand && m.planScore > -8000) {
        this.sslTouch(car, m, L, out, this.sampleAt(m.planAt), cand, false, opp);
        return;
      }
      if (this.block(car, m, L, out)) return;
      if (!OFF.has('keeper') && this.keeper(car, m, out)) return;
    }
    // Goalkeeping: a shot is going in and no touch gets there first → get on the line where it
    // crosses, facing out, and block it (jumping for a high one).
    if (threat && !OFF.has('keeper') && (!hit || hitT > this.goalIn.t - 0.05) && this.keeper(car, m, out)) return;
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
    // Every way of playing this intercept misses in simulation: aim for a later one instead.
    if (cand && m.planScore < -15000 && !OFF.has('skip')) m.skipBefore = hit!.t + this.pathTime + 0.1;
    // Play the intercept that was simulated (the earliest reachable one can shift between plans).
    if (cand && !OFF.has('commit')) sample = this.sampleAt(m.planAt);
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
      const rt = this.reachTime(car, contact, 0);
      const early = rt < tLeft - 0.15;
      // SSL power: a ground ball we're early for is hit at full speed — hang back (coast / brake) until
      // going flat out arrives just in time, rather than rolling in slowly to meet it.
      const power = !!cand?.rush && !catching && ip.z < 190 && !intoOwn && facingT > 0.7;
      if (power && early) {
        out.throttle = fwd > 900 ? -1 : fwd > 350 ? 0 : 0.35;
        out.boost = false;
      } else if (power) {
        out.throttle = 1;
        out.boost = facingT > 0.92 && car.boost > 0 && !car.supersonic;
      } else if (early && !cand?.rush && (ip.z > 190 || catching || opp > tLeft + 0.5)) {
        const want = dist / Math.max(0.05, tLeft);
        out.throttle = fwd > want + 250 ? -1 : fwd > want + 50 ? 0 : 1;
        out.boost = fwd < want - 300 && facingT > 0.95 && car.boost > 0 && !car.supersonic;
      } else {
        // Boost when it matters (contested, defending, or plenty in the tank). SSL doesn't burn it
        // topping up an already fast car for an uncontested ball.
        const contested = !!cand?.rush || threat || opp < tLeft + 0.6;
        const matters = contested || car.boost > 50 || dist > 2500;
        const wasteful = this.brain === 'ssl' && !contested && !OFF.has('saveboost') && (fwd > 1750 || (car.boost < 50 && dist > 2500 && fwd > 1400));
        out.boost = matters && !wasteful && facingT > 0.92 && car.boost > 0 && !car.supersonic && !intoOwn;
      }
    }
    if (catching) return;
    // Simulated, none of the ways to take this touch reach the ball: don't jump or flip at it.
    if (!this.forced && cand && cand === m.planC && m.planScore < -15000 && !OFF.has('gate')) {
      this.count('jumpGated');
      return;
    }
    // Jump / double jump timed so the nose meets the ball.
    const flat = Math.hypot(ip.x - car.pos.x, ip.y - car.pos.y);
    if (car.onGround && ip.z > 190 && !this.nearWall(ip) && this.facing(car, ip) > 0.75) {
      const j = jumpFor(ip.z, OFF.has('jt') ? 9 : SHOT_JUMP_T);
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
    const same = (x: number) => Math.abs(x - at) < 0.1;
    if (m.planPend && !same(m.planPend.at)) m.planPend = null;
    if (!m.planPend) {
      if (m.planC && this.now < m.planUntil && same(m.planAt)) return m.planC;
      m.planPend = { at, cands: this.touchCands(car, m, L, hit), i: 0, best: null, score: -Infinity };
    }
    // Simulate candidates until this update's budget is spent (at least one); the rest next update.
    const pend = m.planPend;
    let n = 0;
    while (pend.i < pend.cands.length && (n === 0 || !this.overBudget)) {
      const c = pend.cands[pend.i++]!;
      n++;
      const sc = this.rollout(car, m, L, hit, c, opp);
      if (sc > pend.score) {
        pend.score = sc;
        pend.best = c;
      }
    }
    const done = pend.i >= pend.cands.length;
    // Keep a finished plan for this intercept while the next one is being worked out.
    if (done || !m.planC || !same(m.planAt)) {
      m.planC = pend.best;
      m.planScore = pend.score;
      m.planAt = at;
    }
    if (done) {
      m.planUntil = this.now + 0.12;
      m.planPend = null;
    }
    return m.planC;
  }

  /** The ways to play intercept `hit`: shot / clear directions × contact offsets × dodge or not. */
  private touchCands(car: Car, m: Mem, L: Level, hit: BallSample): Cand[] {
    const ip = hit.pos;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const oppY = -ownY;
    const reachX = ARENA.goalHalfX - this.world.ball.radius - 120;
    const dirs = [this.shotDir(car, ip, m, L)];
    for (const gx of [-reachX, 0, reachX]) dirs.push(V().set(gx - ip.x, oppY - ip.y, 0).normalize());
    // Clears: up the side walls.
    if (Math.sign(ip.y) === Math.sign(ownY)) for (const sx of [-1, 1]) dirs.push(V().set(sx * 4000 - ip.x, oppY * 0.3 - ip.y, 0).normalize());
    // Always-reachable touches: straight through it the way we're coming, and into the middle in front of
    // their net (a centre — from the corners and wings the shot lines above need a contact point in the wall).
    if (this.brain === 'ssl' && !OFF.has('natural') && (this.nearWall(ip) || Math.abs(ip.x) > 2600)) {
      dirs.push(V().copy(ip).sub(car.pos).setZ(0).normalize());
      dirs.push(V().set(-ip.x * 0.3 - ip.x, oppY - Math.sign(oppY) * 1600 - ip.y, 0).normalize());
    }
    // SSL: passes — to a teammate waiting in front of their net (led a little towards the goal).
    if (this.brain === 'ssl' && !OFF.has('pass'))
      for (const c of this.world.cars) {
        if (c === car || c.team !== car.team || c.demolished) continue;
        if (Math.abs(c.pos.x) > 2200 || c.pos.y * Math.sign(oppY) < ARENA.halfY - 4200 || c.pos.y * Math.sign(oppY) > ARENA.halfY - 500) continue;
        const d = V().set(c.pos.x - ip.x, c.pos.y + Math.sign(oppY) * 450 - ip.y, 0);
        if (d.length() > 400) dirs.push(d.normalize());
      }
    const toBall = V().copy(ip).sub(car.pos).setZ(0).normalize();
    const cands: Cand[] = [];
    dirs.forEach((dir, i) => {
      if (dir.dot(toBall) < -0.2) return; // can't hit it that way from here
      // Contact offsets only for the main aim (the others rarely win and cost a rollout each).
      for (const off of i === 0 || OFF.has('fewcands') ? [-40, 0, 40] : [0]) cands.push({ dir, off, dodge: ip.z < 190 });
      // Power shot: hang back, then flat out and flip through it (the simulation says whether it beats the placed one).
      if (!OFF.has('rush') && ip.z < 190) cands.push({ dir, off: 0, dodge: true, rush: true });
    });
    cands.push({ dir: dirs[0]!, off: 0, dodge: false });
    return cands;
  }

  /** Play `cand` forward (opponents chasing the ball): how good is the ball after our touch? A miss is the worst. */
  private rollout(car: Car, m: Mem, L: Level, hit: BallSample, cand: Cand, opp: number): number {
    const r = this.simulate(car, m, L, { sample: hit, cand, opp }, hit.t + this.pathTime + 0.35, () => undefined, OPP_POST);
    if (r.touchAt < 0) return -20000 + (cand.off === 0 ? 1 : 0);
    if (r.goal >= 0) return r.goal === car.team ? 9000 : -9000;
    return this.judgeBall(r.ball, car.team, r.t - this.now, car.id) - (r.touchAt - this.now) * 400;
  }

  /** Simulate an aerial at predicted sample `a` (jump, fly, dodge into it): the ball's value after, or very low if it misses. */
  private rolloutAerial(car: Car, m: Mem, L: Level, at: number, aimX: number | null = null, noDJ = false): number {
    const r = this.simulate(
      car,
      m,
      L,
      { air: true },
      at + 0.4,
      (mm) => {
        mm.aerialAt = at;
        mm.aerialEnd = at + 0.5;
        mm.jumpHold = 0.2;
        mm.airAimX = aimX;
        mm.airNoDJ = noDJ;
      },
      OPP_POST,
    );
    if (r.touchAt < 0) return -20000;
    if (r.goal >= 0) return r.goal === car.team ? 9000 : -9000;
    return this.judgeBall(r.ball, car.team, r.t - this.now, car.id) - (r.touchAt - this.now) * 400;
  }

  /**
   * Run this car with the ball until it touches it, a goal, or `end` (world time). With `post`
   * > 0 the opponents are in the simulation too (driving at the ball like defenders would) and it
   * runs on `post` s after our touch, so a shot straight at a defender is judged as blocked.
   */
  private simulate(car: Car, m: Mem, L: Level, forced: NonNullable<Bots['forced']>, end: number, prep: (mm: Mem) => void, post = 0): { touchAt: number; goal: number; ball: Ball; t: number } {
    const real = this.world;
    const withOpp = post > 0 && !OFF.has('oppsim');
    const mini = withOpp ? this.miniWorldOpp(car) : this.miniWorld(car);
    const mc = mini.cars[0]!;
    copyCar(mc, car);
    if (withOpp) for (let i = 1; i < mini.cars.length; i++) copyCar(mini.cars[i]!, real.car(mini.cars[i]!.id)!);
    const b = mini.ball;
    b.pos.copy(real.ball.pos);
    b.vel.copy(real.ball.vel);
    b.angVel.copy(real.ball.angVel);
    mini.tickCount = real.tickCount;
    mini.phase = 'play';
    mini.clock = 300;
    mini.events.length = 0;
    (mini as unknown as { extraHitTick: Map<number, number> }).extraHitTick.clear();
    const mm: Mem = { ...m, plan: 'ball', role: 'attack', think: 99, aerialEnd: 0, man: null, boostHold: false, carrySince: -1, planC: null, planPend: null, blockPend: null, airPend: null };
    prep(mm);
    const cur = this.cur;
    const rng = this.rng;
    this.world = mini;
    this.forced = forced;
    const inputs = new Map<number, Controls>();
    let touchAt = -1;
    let goal = -1;
    const going = (t: number) => (touchAt < 0 ? t < end : withOpp && t < touchAt + post);
    try {
      while (going(mini.tickCount * C.TICK) && goal < 0) {
        const c = touchAt < 0 ? this.drive(mc, mm, L, C.TICK) : NO_CONTROLS;
        mm.lastJump = c.jump;
        inputs.set(mc.id, c);
        if (withOpp) for (let i = 1; i < mini.cars.length; i++) inputs.set(mini.cars[i]!.id, defenderControls(mini.cars[i]!, mini.ball));
        mini.step(inputs);
        this.simSteps++;
        for (const e of mini.events) {
          if (e.k === 'touch' && e.car === mc.id && touchAt < 0) touchAt = mini.tickCount * C.TICK;
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
    return { touchAt, goal, ball: b, t: mini.tickCount * C.TICK };
  }

  /** Value of a free ball for `team`: a goal for / against, a shot on target, how far up the field it goes. */
  /**
   * `elapsed` = how far ahead of now `ball` is (cars are where they are now, so they get that much
   * longer to reach it); `shooter` = the car whose touch this is (not counted as a pass target).
   */
  private judgeBall(ball: Ball, team: 0 | 1, elapsed = 0, shooter = -1): number {
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
    // Possession: whoever gets to the ball first next. Handing it to an opponent (especially in
    // our half) is bad; to a teammate is good.
    if (!OFF.has('possess')) {
      for (const p of path) {
        if (p.t < 0.25 || p.pos.z > 320) continue;
        if (p.t > 2.5) break;
        let them = 9;
        let us = 9;
        for (const c of this.world.cars) {
          if (c.demolished) continue;
          const t = this.reachTime(c, p.pos, ball.radius + 40);
          if (c.team === team) us = Math.min(us, t);
          else them = Math.min(them, t);
        }
        if (Math.min(us, them) > p.t + 0.15) continue;
        const ours = Math.sign(p.pos.y) === -toward;
        if (them < us - 0.15) v -= ours ? 1400 + 1400 * Math.min(1, (Math.abs(p.pos.y) - 1000) / 3500) : 500;
        else if (us < them - 0.15) v += ours ? 200 : 450;
        break;
      }
    }
    // SSL: a pass — the ball comes into the slot in front of their net where a teammate gets to it before
    // any of them (a chance, worth nearly as much as a shot).
    if (this.brain === 'ssl' && !OFF.has('pass')) {
      for (const p of path) {
        if (p.t > 2.5) break;
        if (p.pos.z > 380 || Math.abs(p.pos.x) > 1700 || p.pos.y * toward < ARENA.halfY - 3200 || p.pos.y * toward > ARENA.halfY - 250) continue;
        let us = 9;
        let them = 9;
        for (const c of this.world.cars) {
          if (c.demolished || c.id === shooter) continue;
          const t = this.reachTime(c, p.pos, ball.radius + 40) - elapsed;
          if (c.team === team) us = Math.min(us, t);
          else them = Math.min(them, t);
        }
        if (us < p.t + 0.15 && us < them - 0.15) {
          v += PASS_VALUE;
          this.count('passValue');
        }
        break;
      }
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

  /** A world with this car and the opponents (same hitboxes), for rollouts that include defenders. */
  private miniWorldOpp(car: Car): World {
    const opps = this.world.cars.filter((c) => c.team !== car.team);
    const key = `${car.id}:${opps.map((c) => c.id).join(',')}`;
    let w = this.minisOpp.get(key);
    if (!w) {
      const info = (c: Car) => ({ id: c.id, name: '', team: c.team, bot: true, body: C.CAR_IDS.find((k) => C.carInfo(k).hitbox === c.body.id) ?? 'octane' });
      w = new World([info(car), ...opps.map(info)], 300, 1, true, this.world.rules);
      this.minisOpp.set(key, w);
    }
    return w;
  }

  /** A teammate will reach the ball clearly before us and isn't beaten (goal-side of it). */
  private mateFirst(car: Car): boolean {
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const ball = this.world.ball;
    const mine = this.ballEta(car);
    for (const c of this.world.cars) {
      if (c === car || c.team !== car.team || c.demolished) continue;
      if (Math.abs(c.pos.y - ownY) > Math.abs(ball.pos.y - ownY) + 200) continue;
      if (this.ballEta(c) < mine - 0.25) return true;
    }
    return false;
  }

  /** The opponent dribbling the ball (on the roof or pushing it along), if any. */
  private carrier(car: Car): Car | null {
    const ball = this.world.ball;
    if (ball.pos.z > 330) return null;
    for (const e of this.world.cars) {
      if (e.team === car.team || e.demolished || !e.onGround) continue;
      const d = Math.hypot(ball.pos.x - e.pos.x, ball.pos.y - e.pos.y);
      if (d > 260) continue;
      if (Math.hypot(ball.vel.x - e.vel.x, ball.vel.y - e.vel.y) < 650) return e;
    }
    return null;
  }

  /** Shadow an opponent's dribble (see sslPlay). False = challenge now. */
  private shadowDefend(car: Car, out: Controls): boolean {
    const cr = this.carrier(car);
    if (!cr) return false;
    const ball = this.world.ball;
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    const toGoal = V().set(-ball.pos.x, ownY - ball.pos.y, 0);
    const goalDist = toGoal.length();
    // Challenge: they're near our box, they flicked / popped it, or they've run into us.
    if (goalDist < 2600 || ball.vel.z > 350 || car.pos.distanceTo(ball.pos) < 500) return false;
    // Not goal-side yet: get back first (the normal retreat handles it).
    if (Math.abs(car.pos.y - ownY) > Math.abs(ball.pos.y - ownY) - 150) return false;
    this.count('shadowDef');
    const gap = Math.max(800, Math.min(1500, 900 + cr.vel.length() * 0.3));
    const spot = V().copy(ball.pos).setZ(0).addScaledVector(toGoal.normalize(), gap);
    const d = Math.hypot(spot.x - car.pos.x, spot.y - car.pos.y);
    if (d > 350) {
      this.steerTo(car, spot, out, 1, true);
      out.boost = d > 1200 && this.facing(car, spot) > 0.92 && car.boost > 20 && !car.supersonic && car.onGround;
    } else {
      // In position: face the ball and hold the gap (back off as they come).
      this.steerTo(car, V().copy(ball.pos).setZ(0), out, 1, true);
      const dist = Math.hypot(ball.pos.x - car.pos.x, ball.pos.y - car.pos.y);
      const facing = this.facing(car, ball.pos) > 0;
      const tooClose = dist < gap - 150;
      out.throttle = tooClose ? (facing ? -1 : 1) : dist > gap + 200 ? (facing ? 1 : -1) : 0;
      out.handbrake = false;
    }
    return true;
  }

  /**
   * Save (see sslPlay): spots on the ball's way into our net, each simulated (drive there, stop on
   * the line, jump into it if it comes through high, opponents following up); the best is kept
   * ~0.1 s. False when there's nowhere on its path to stand.
   */
  private block(car: Car, m: Mem, L: Level, out: Controls): boolean {
    if (m.blockSpot && m.blockAt < this.now) m.blockSpot = null;
    if (!m.blockPend && (this.now >= m.blockUntil || !m.blockSpot)) {
      const ok: BallSample[] = [];
      for (const p of this.path) {
        if (Math.abs(p.pos.y) > ARENA.halfY - 40) break; // in by then
        const t = p.t + this.pathTime - this.now;
        if (t >= 0.12 && p.pos.z <= 550 + (L.blockZ - 620) && !this.nearWall(p.pos)) ok.push(p);
      }
      if (!ok.length) {
        m.blockSpot = null;
        return false;
      }
      // Up to 6 spots spread along the way in (always the first and the last).
      const spots: Array<{ pos: Vector3; at: number }> = [];
      const k = Math.min(6, ok.length);
      for (let i = 0; i < k; i++) {
        const p = ok[Math.round((i * (ok.length - 1)) / Math.max(1, k - 1))]!;
        if (!spots.some((q) => q.at === p.t + this.pathTime)) spots.push({ pos: V().copy(p.pos), at: p.t + this.pathTime });
      }
      m.blockPend = { spots, i: 0, best: null, score: -Infinity };
    }
    const pend = m.blockPend;
    if (pend) {
      let n = 0;
      while (pend.i < pend.spots.length && (n === 0 || !this.overBudget)) {
        const sp = pend.spots[pend.i++]!;
        n++;
        if (sp.at < this.now + 0.05) continue;
        const sc = this.rolloutBlock(car, m, L, sp.pos, sp.at);
        if (sc > pend.score) {
          pend.score = sc;
          pend.best = sp;
        }
      }
      if (pend.i >= pend.spots.length || !m.blockSpot) {
        m.blockSpot = pend.best?.pos ?? null;
        m.blockAt = pend.best?.at ?? 0;
        m.blockScore = pend.score;
      }
      if (pend.i >= pend.spots.length) {
        m.blockPend = null;
        m.blockUntil = this.now + 0.1;
      }
    }
    // Every spot concedes (e.g. it's dropping in under the bar): leave it to the keeper / an aerial.
    if (!m.blockSpot || m.blockScore <= -8800) return false;
    this.count('block');
    this.blockTo(car, m, out, m.blockSpot, m.blockAt);
    return true;
  }

  /** Simulate a block at `pos` (the ball there at world time `at`): the ball's value after (a goal against is the worst). */
  private rolloutBlock(car: Car, m: Mem, L: Level, pos: Vector3, at: number): number {
    let end = this.pathTime + (this.path[this.path.length - 1]?.t ?? 3);
    for (const q of this.path) if (Math.abs(q.pos.y) > ARENA.halfY) {
      end = q.t + this.pathTime + 0.2;
      break;
    }
    const r = this.simulate(car, m, L, { spot: V().copy(pos), at }, end, () => undefined, OPP_POST);
    if (r.goal >= 0) return r.goal === car.team ? 9000 : -9000 + (r.touchAt >= 0 ? 100 : 0);
    // Earlier contact (further from our net) breaks ties.
    return this.judgeBall(r.ball, car.team, r.t - this.now, car.id) - (r.touchAt >= 0 ? (r.touchAt - this.now) * 200 : 3000);
  }

  /** Drive a block: to `spot` on the ball's line (ball there at world time `at`), stop on it, face the ball, jump into a high one. */
  private blockTo(car: Car, m: Mem, out: Controls, spot3: Vector3, at: number): void {
    const ball = this.world.ball;
    const R = ball.radius;
    const pickT = Math.max(0, at - this.now);
    const ip = this.sampleAt(at).pos;
    // Stand a little in front of where the ball will be, so it runs into our nose.
    const sv = this.sampleAt(at).vel;
    const vlen = Math.hypot(sv.x, sv.y);
    const spot = V().copy(spot3).setZ(0);
    if (vlen > 100) spot.x += (sv.x / vlen) * R * 0.5, spot.y += (sv.y / vlen) * R * 0.5;
    const d = Math.hypot(spot.x - car.pos.x, spot.y - car.pos.y);
    const v = car.forwardSpeed;
    if (d > 140) {
      this.steerTo(car, spot, out, 1, true);
      const urgent = this.reachTime(car, spot, 60) + 0.45 > pickT;
      out.boost = urgent && this.facing(car, spot) > 0.9 && car.boost > 0 && !car.supersonic && car.onGround;
      // Brake to stop on the spot rather than drive through the line.
      const ahead = (spot.x - car.pos.x) * car.forward.x + (spot.y - car.pos.y) * car.forward.y;
      if (Math.abs(v) > 300 && Math.sign(ahead) === Math.sign(v) && Math.abs(ahead) < (v * v) / (2 * C.BRAKE_ACCEL) + 100 && d < Math.abs(ahead) + 150) {
        out.throttle = -Math.sign(v);
        out.boost = false;
      }
    } else {
      // On the line: square up to the ball and hold.
      this.steerTo(car, V().copy(ball.pos).setZ(0), out, 0.3, true);
      if (Math.abs(v) > 250) out.throttle = -Math.sign(v);
      out.boost = false;
      out.handbrake = false;
    }
    // High ball coming through: (double) jump to meet it as it arrives — only if we'll still be under
    // it then (the car can't steer once off the ground).
    const fx = car.pos.x + car.vel.x * pickT - ip.x;
    const fy = car.pos.y + car.vel.y * pickT - ip.y;
    if (car.onGround && ip.z > 170 && Math.hypot(fx, fy) < R + 70) {
      const j = jumpFor(ip.z);
      if (j && pickT <= j.t + 1 / 60) {
        if (!this.forced) this.count('blockJump');
        m.jumpHold = 0.2;
        if (j.double) {
          m.dodgeIn = 0.01;
          m.dodgePitch = m.dodgeYaw = 0;
        }
        out.jump = true;
      }
    }
  }

  /** Block a shot on the goal line (see sslPlay). False when we can't get there in time either. */
  private keeper(car: Car, m: Mem, out: Controls): boolean {
    const ownY = car.team === 0 ? -ARENA.halfY : ARENA.halfY;
    let cross: BallSample | null = null;
    for (const p of this.path) if (Math.abs(p.pos.y) >= ARENA.halfY - 120 && Math.sign(p.pos.y) === Math.sign(ownY)) {
      cross = p;
      break;
    }
    if (!cross) return false;
    const tLeft = cross.t + this.pathTime - this.now;
    const spot = V().set(Math.max(-ARENA.goalHalfX + 60, Math.min(ARENA.goalHalfX - 60, cross.pos.x)), ownY * 0.985, 0);
    if (this.reachTime(car, spot, 60) > tLeft + 0.25) return false;
    this.count('keeper');
    const d = Math.hypot(spot.x - car.pos.x, spot.y - car.pos.y);
    if (d > 180) {
      this.steerTo(car, spot, out, 1, true);
      out.boost = d > 900 && this.facing(car, spot) > 0.9 && car.boost > 0 && !car.supersonic && car.onGround;
      // Arrive and stop on the line rather than overrunning into the net.
      const v = car.forwardSpeed;
      if (d < 700 && v > d * 2.2) out.throttle = -1;
    } else {
      // On the spot: square up to the ball and hold.
      this.steerTo(car, V().copy(cross.pos).setZ(0), out, 0.3, true);
      if (Math.abs(car.forwardSpeed) > 200) out.throttle = -Math.sign(car.forwardSpeed);
    }
    // High shot: jump (double for the top corner) to meet it.
    const j = cross.pos.z > 190 && car.onGround ? jumpFor(cross.pos.z) : null;
    if (j && tLeft <= j.t + 1 / 60 && d < 300) {
      m.jumpHold = 0.2;
      if (j.double) {
        m.dodgeIn = 0.01;
        m.dodgePitch = m.dodgeYaw = 0;
      }
      out.jump = true;
    }
    return true;
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
    } else if (t < 0.11 + HF_CANCEL) {
      // Let the back flip turn the car over (nose up)…
      out.pitch = 1;
      out.throttle = -1;
    } else if (t < 0.11 + HF_CANCEL + HF_ROLL) {
      // …then cancel it and roll the wheels back under: now facing the way we were going.
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
    else {
      const ax = this.cur?.airAimX ?? this.aimX(car, this.cur ?? ({ aim: 0 } as Mem), p);
      dir.set(ax - p.x, oppY - p.y, Math.max(-p.z + 250, -400) * 0.6).normalize();
    }
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
    if (this.brain === 'ssl' && !OFF.has('half') && m && !m.man && car.onGround && car.up.z > 0.9 && Math.abs(angle) > 2.6 && d > 1400 && car.forwardSpeed < 350 && car.forwardSpeed > -900) {
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
    // Land with the wheels along the velocity (keeps the speed); SSL leans that towards the ball so it lands ready to play.
    if (this.brain === 'ssl' && !OFF.has('landball')) {
      const tb = V().copy(this.world.ball.pos).sub(car.pos).setZ(0);
      if (tb.lengthSq() > 1) vel.addScaledVector(tb.normalize(), 700);
    }
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
function jumpFor(ballZ: number, maxT = 9): { t: number; double: boolean } | null {
  const dz = ballZ - 60 - C.CAR_REST_Z;
  for (const [table, double] of [[JUMP1, false], [JUMP2, true]] as const) {
    const k = table.findIndex((z) => z >= dz);
    if (k >= 0 && k * C.TICK <= maxT) return { t: k * C.TICK, double };
  }
  return null;
}
/** Longest (double) jump SSL shoots with on the move: after that it floats, can't steer, and misses. */
const SHOT_JUMP_T = Number(ENV.SSL_JT ?? 0.75);

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

/**
 * The ranks. Nexto itself plays at about low Grand Champion in real Rocket League: GC here is it at full
 * strength, SSL averages each decision with the mirrored view (steadier — beats GC clearly), and the lower
 * ranks add reaction time, sloppier action choices, misread balls, fewer decisions and no / unreliable
 * aerials, tuned so each rank beats the one below (tools/rocket-versus.ts --la / --lb).
 */
const RANKS: Record<BotLevel, { name: string; brain: BrainLevel; nexto: NextoProfile; nextoKickoff?: boolean }> = {
  bronze: { name: 'BRONZE', brain: 'rookie', nexto: { beta: 0.6, skip: 16, delay: 32, misread: 240, air: 0 } },
  silver: { name: 'SILVER', brain: 'rookie', nexto: { beta: 0.68, skip: 16, delay: 26, misread: 170, air: 0.1 } },
  gold: { name: 'GOLD', brain: 'pro', nexto: { beta: 0.74, skip: 12, delay: 21, misread: 130, air: 0.32 } },
  plat: { name: 'PLAT', brain: 'pro', nexto: { beta: 0.82, skip: 12, delay: 16, misread: 80, air: 0.6 } },
  diamond: { name: 'DIAMOND', brain: 'allstar', nexto: { beta: 0.88, skip: 10, delay: 12, misread: 50, air: 0.85 } },
  champ: { name: 'CHAMP', brain: 'allstar', nexto: { beta: 0.93, skip: 8, delay: 8, misread: 30, air: 1 } },
  gc: { name: 'GRAND CHAMP', brain: 'ssl', nexto: { beta: 1, skip: 8, delay: 0, misread: 0, air: 1 } },
  // SSL: Nexto at full strength, deciding on the real view and its mirror image averaged (beat plain Nexto 19-5).
  ssl: { name: 'SSL', brain: 'ssl', nexto: { beta: 1, skip: 8, delay: 0, misread: 0, air: 1, mirror: true } },
};
// Tuning (tools only): NX_GC=beta,skip,delay,misread,air[,mirror] overrides a rank's profile; NX_KICK_GC=1 lets Nexto take its kickoffs.
for (const r of Object.keys(RANKS) as BotLevel[]) if (ENV[`NX_KICK_${r.toUpperCase()}`]) RANKS[r].nextoKickoff = ENV[`NX_KICK_${r.toUpperCase()}`] === '1';
for (const r of Object.keys(RANKS) as BotLevel[]) {
  const o = ENV[`NX_${r.toUpperCase()}`];
  if (o) {
    const [beta, skip, delay, misread, air, mirror] = o.split(',').map(Number);
    RANKS[r].nexto = { beta: beta!, skip: skip!, delay: delay!, misread: misread!, air: air!, mirror: mirror === 1 };
  }
}
export const BOT_LEVELS = Object.keys(RANKS) as BotLevel[];
export const rankName = (l: BotLevel): string => RANKS[l]?.name ?? String(l).toUpperCase();
/** A saved / received level (incl. the old rookie / pro / all-star names) as a rank. */
export function toBotLevel(v: unknown): BotLevel {
  if (typeof v === 'string' && v in RANKS) return v as BotLevel;
  return v === 'rookie' ? 'bronze' : v === 'allstar' ? 'diamond' : 'gold';
}
export const BOT_NAMES = ['Merlin', 'Sundown', 'Rainmaker', 'Bandit', 'Hound', 'Sticks', 'Fury', 'Jester', 'Tusk', 'Viper', 'Casper', 'Gerwin', 'Junker', 'Squall', 'Raja', 'Saltie'];
