import { Ball, BALL_R, predict, type BallEvent, type PathSample } from './ball';
import { COURT, serviceBox, sideSign } from './court';
import { rightX, shotTarget, solveShot, type ShotIntent, type ShotKind } from './shots';
import { RACKET, RACKETS, type Racket } from './rackets';
import { Brain, type Level } from './ai';
import { ARM, armJoints, bodyToWorld, type LiveArm, type V3 } from './arm';

/**
 * A padel match: 2 v 2 (or 1 v 1), the rules and scoring of the FIP. Fixed 120 Hz ticks.
 * Humans give a movement stick and strokes (a swing: direction, power, lob or not — from the mouse,
 * a stick flick, later the camera); bots get the same from their brain (ai.ts). Players with auto
 * move on are walked to the ball by the brain, so a human only has to swing.
 */
export const TICK = 1 / 120;
/** A swing can meet the ball this long after it starts; contact is best at IDEAL. */
const WINDOW = 0.42;
const IDEAL = 0.2;
const COOLDOWN = 0.32;
/** Reach from the body centre (arm + racket), and the heights a player can take the ball at. */
export const REACH = 1.05;
export const LOW = 0.12;
export const HIGH = 2.45;
/** With a jump an overhead gets this much higher. */
const JUMP = 0.45;
const ACCEL = 16;

export interface PlayerDef {
  id: string;
  name: string;
  team: 0 | 1;
  /** 0 plays the right side (the drive side), 1 the left (the backhand side). */
  slot: 0 | 1;
  human: boolean;
  racket: string;
  level?: Level;
}

/** A swing from a human: screen-space direction (dx right, dy down) and speed 0 … 1, lob or not. */
export interface Stroke {
  dx: number;
  dy: number;
  power: number;
  lob: boolean;
  /** Timing assist (camera swings): a stroke up to this many seconds early waits for the ball. */
  hold?: number;
}

export interface Input {
  /** Movement, team-relative: x to the right, z towards the net (−1 … 1). */
  mx: number;
  mz: number;
  stroke: Stroke | null;
  /** Let the brain move this player (swinging stays the human's). */
  auto: boolean;
  /** Camera motion play: the live racket arm (then the racket itself hits the ball, no strokes). */
  arm?: LiveArm | null;
}
export const NO_INPUT: Input = { mx: 0, mz: 0, stroke: null, auto: true };

export type SwingKind = 'fh' | 'bh' | 'oh' | 'serve';

export interface Swing {
  t: number;
  kind: SwingKind;
  stroke: Stroke;
  hit: boolean;
}

export class Player {
  readonly pos: [number, number] = [0, 0];
  readonly vel: [number, number] = [0, 0];
  /** Jump height (overheads) and its speed. */
  y = 0;
  vy = 0;
  /** Facing (radians, 0 = +z). */
  facing = 0;
  swing: Swing | null = null;
  cooldown = 0;
  /** Where the brain wants this player (auto move / bots). */
  readonly target: [number, number] = [0, 0];
  auto = true;
  /** An early stroke waiting for the ball (timing assist): released at `at` (match time). */
  held: { s: Stroke; at: number } | null = null;
  /** Camera motion play: the live racket arm, and the ball relative to the racket face last tick. */
  arm: LiveArm | null = null;
  rel: V3 | null = null;
  /** This tick: did the ball pass through the live racket (off-centre 0 … 1, −1 = no)? */
  touch = -1;
  readonly racket: Racket;
  readonly maxSpeed: number;

  constructor(readonly def: PlayerDef) {
    this.racket = RACKET[def.racket] ?? RACKETS[0]!;
    this.maxSpeed = 4.7;
  }
  get team(): 0 | 1 {
    return this.def.team;
  }
}

export type PointReason =
  | 'double-fault'
  | 'net'
  | 'two-bounces'
  | 'wall-first'
  | 'out'
  | 'own-side'
  | 'hit-player'
  | 'came-back'
  | 'winner';

export type MatchEvent =
  | { k: 'serve-ready'; p: number }
  | { k: 'swing'; p: number; kind: SwingKind }
  | { k: 'hit'; p: number; shot: ShotKind; power: number; x: number; y: number; z: number }
  | { k: 'whiff'; p: number }
  | { k: 'bounce'; x: number; z: number; speed: number }
  | { k: 'wall'; mat: 'glass' | 'mesh'; x: number; y: number; z: number; speed: number }
  | { k: 'net'; speed: number }
  | { k: 'fault'; second: boolean; why: string }
  | { k: 'let' }
  | { k: 'point'; team: 0 | 1; why: PointReason }
  | { k: 'game'; team: 0 | 1 }
  | { k: 'set'; team: 0 | 1 }
  | { k: 'match'; team: 0 | 1 };

export interface Format {
  /** Games to win a set (6 = a real set, 4 = short). */
  games: 4 | 6;
  /** Best of 1 or 3 sets. */
  sets: 1 | 3;
  /** Deciding point at deuce (no advantages). */
  golden: boolean;
}

export type Phase = 'serve' | 'toss' | 'rally' | 'dead' | 'over';

export interface Score {
  points: [number, number];
  games: [number, number];
  sets: [number, number];
  /** Finished sets' games, for the scoreboard. */
  history: Array<[number, number]>;
  tiebreak: boolean;
}

export interface MatchOptions {
  players: PlayerDef[];
  format: Format;
  seed: number;
  /** Team serving first. */
  first?: 0 | 1;
}

export class MatchSim {
  readonly ball = new Ball();
  readonly players: Player[];
  readonly format: Format;
  phase: Phase = 'serve';
  /** Time in the current phase. */
  phaseT = 0;
  time = 0;
  readonly score: Score = { points: [0, 0], games: [0, 0], sets: [0, 0], history: [], tiebreak: false };
  winner: 0 | 1 | -1 = -1;
  events: MatchEvent[] = [];
  /** Serving: who, which side (true = right / deuce court), first or second serve. */
  server = 0;
  serveRight = true;
  secondServe = false;
  /** Games played (whole match) — drives the serve rotation. */
  private gamesPlayed = 0;
  private servingTeam: 0 | 1;
  /** Rally state: the team that last hit it, whether it has crossed since, floor bounces on the far side since. */
  lastHitter = -1;
  /** When the last hit was (match time). */
  hitAt = 0;
  lastTeam: 0 | 1 | -1 = -1;
  crossed = false;
  bounces = 0;
  /** It's a serve still in flight (it must bounce in the box; the receiver can't volley it). */
  serving = false;
  private serveIntent: Stroke | null = null;
  /** The box the serve in flight must land in. */
  private box = { x0: 0, x1: 0, z0: 0, z1: 0 };
  private letCall = false;
  /** The ball's predicted path (shared by the brains), refreshed every few ticks. */
  readonly path: PathSample[] = [];
  private pathT = 0;
  private rng: number;
  private readonly brain: Brain;
  private readonly ballEvents: BallEvent[] = [];
  /** Last point, for the HUD. */
  lastPoint: { team: 0 | 1; why: PointReason } | null = null;

  constructor(o: MatchOptions) {
    this.players = o.players.map((d) => new Player(d));
    this.format = o.format;
    this.rng = o.seed >>> 0 || 1;
    this.ball.rand = () => this.rand();
    this.servingTeam = o.first ?? (this.rand() < 0.5 ? 0 : 1);
    this.brain = new Brain(this);
    this.setupServe();
  }

  rand(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  // ------------------------------------------------------------- serving

  /** Serve order: team A's first, team B's first, A's second, B's second (whoever exists). */
  private serverFor(game: number): number {
    const order: Array<[0 | 1, 0 | 1]> = [];
    const t0 = this.servingTeamAt(0);
    for (const [team, slot] of [[t0, 0], [1 - t0, 0], [t0, 1], [1 - t0, 1]] as Array<[0 | 1, 0 | 1]>)
      if (this.players.some((p) => p.team === team && p.def.slot === slot)) order.push([team, slot]);
    const [team, slot] = order[game % order.length]!;
    return this.players.findIndex((p) => p.team === team && p.def.slot === slot);
  }
  private firstServer: 0 | 1 = 0;
  private servingTeamAt(_g: number): 0 | 1 {
    return this.firstServer;
  }

  /** Place everyone for the next serve. */
  private setupServe(): void {
    if (this.gamesPlayed === 0 && this.score.points[0] + this.score.points[1] === 0) this.firstServer = this.servingTeam;
    const sc = this.score;
    const pts = sc.points[0] + sc.points[1];
    if (sc.tiebreak) {
      // Tie-break: first point by the next server, then two each.
      const n = Math.floor((pts + 1) / 2);
      this.server = this.serverFor(this.gamesPlayed + n);
    } else this.server = this.serverFor(this.gamesPlayed);
    this.serveRight = pts % 2 === 0;
    const srv = this.players[this.server]!;
    const st = srv.team;
    const rt = (1 - st) as 0 | 1;
    const rs = sideSign(rt);
    const ss = sideSign(st);
    // Right (deuce) court: team's right-hand side.
    const srvX = rightX(st) * (this.serveRight ? 1 : -1) * 2.4;
    for (const p of this.players) {
      p.vel[0] = p.vel[1] = 0;
      p.y = p.vy = 0;
      p.swing = null;
      p.held = null;
      p.rel = null;
      p.cooldown = 0;
      const s = sideSign(p.team);
      if (p === srv) this.place(p, srvX, ss * 8.2);
      else if (p.team === st) this.place(p, -srvX * 1.05, ss * 3.2);
      else {
        // The receiver covers the diagonal; partner the other side.
        const recvSlot = this.serveRight ? 0 : 1;
        const solo = this.players.filter((q) => q.team === rt).length === 1;
        const diagX = -srvX;
        if (solo || p.def.slot === recvSlot) this.place(p, diagX * 1.05, rs * 8.8);
        else this.place(p, -diagX * 1.05, rs * 7.2);
      }
      p.facing = s < 0 ? 0 : Math.PI;
    }
    this.ball.set({ pos: [srv.pos[0] + rightX(st) * 0.3, 1.0, srv.pos[1] - ss * 0.3], vel: [0, 0, 0], spin: [0, 0, 0] });
    this.lastHitter = -1;
    this.lastTeam = -1;
    this.crossed = false;
    this.bounces = 0;
    this.serving = false;
    this.serveIntent = null;
    this.letCall = false;
    this.phase = 'serve';
    this.phaseT = 0;
    this.events.push({ k: 'serve-ready', p: this.server });
  }

  private place(p: Player, x: number, z: number): void {
    p.pos[0] = x;
    p.pos[1] = z;
    p.target[0] = x;
    p.target[1] = z;
  }

  // ---------------------------------------------------------------- step

  step(inputs: ReadonlyMap<string, Input>): void {
    this.time += TICK;
    this.phaseT += TICK;
    if (this.phase === 'over') return;
    // Brains: bots decide (and swing), auto-movers get a target.
    if (this.phase === 'rally' || this.phase === 'serve') {
      this.pathT -= TICK;
      if (this.pathT <= 0) {
        this.pathT = 1 / 30;
        predict(this.ball, 2.6, 1 / 60, this.path);
      }
    }
    const strokes = new Map<number, Stroke>();
    this.players.forEach((p, i) => {
      const inp = inputs.get(p.def.id) ?? NO_INPUT;
      p.auto = !p.def.human || inp.auto;
      if (!p.def.human) return;
      p.arm = inp.arm ?? null;
      if (!p.arm) p.rel = null;
      else return; // the live racket plays its own shots (see liveContact)
      if (inp.stroke) {
        // Timing assist: an early swing waits until the ball is the ideal moment away.
        const c = inp.stroke.hold && this.phase === 'rally' ? this.brain.contactFor(i) : null;
        const lead = c ? c.at - this.time : 0;
        p.held = null;
        if (c && lead > IDEAL + 0.03 && lead < inp.stroke.hold! + IDEAL) p.held = { s: inp.stroke, at: c.at - IDEAL };
        else strokes.set(i, inp.stroke);
      } else if (p.held) {
        const c = this.phase === 'rally' ? this.brain.contactFor(i) : null;
        if (this.phase !== 'rally') p.held = null;
        else {
          if (c) p.held.at = c.at - IDEAL;
          if (!c || this.time >= p.held.at) {
            strokes.set(i, p.held.s);
            p.held = null;
          }
        }
      }
    });
    for (const [i, s] of this.brain.update(TICK)) if (!this.players[i]!.def.human) strokes.set(i, s);

    // Serve: the server's stroke starts the toss; it's hit 0.5 s later.
    const live = this.players[this.server]!.arm ? this.players[this.server]! : null;
    if (this.phase === 'serve' && live) {
      // A live server: the ball hangs at waist height beside them — swing through it to serve.
      const st = live.team;
      const spot = bodyToWorld(live.facing, [0.55 * (live.arm!.side === 2 ? -1 : 1), 0.8, 0.4], [live.pos[0], 0, live.pos[1]]);
      this.ball.pos.splice(0, 3, spot[0], spot[1] + Math.sin(this.phaseT * 3) * 0.04, spot[2]);
      this.ball.vel.splice(0, 3, 0, 0, 0);
      void st;
      if (this.phaseT > 0.6 && live.touch >= 0 && Math.hypot(...live.arm!.vel) > 1.5) {
        const s = this.liveStroke(live);
        s.lob = false;
        this.serveIntent = s;
        live.swing = { t: 0, kind: 'serve', stroke: s, hit: false };
        this.hitServe();
      }
    } else if (this.phase === 'serve') {
      const s = strokes.get(this.server);
      if (s) {
        this.serveIntent = s;
        this.phase = 'toss';
        this.phaseT = 0;
        const srv = this.players[this.server]!;
        srv.swing = { t: 0, kind: 'serve', stroke: s, hit: false };
        this.events.push({ k: 'swing', p: this.server, kind: 'serve' });
      }
    } else if (this.phase === 'toss') {
      this.tossBall();
      if (this.phaseT >= 0.5) this.hitServe();
    }

    // Movement.
    this.players.forEach((p, i) => this.move(p, inputs.get(p.def.id) ?? NO_INPUT, i));
    for (const p of this.players) p.touch = p.arm ? this.liveTouch(p) : -1;

    if (this.phase === 'rally') {
      // New swings, then contact.
      for (const [i, s] of strokes) {
        const p = this.players[i]!;
        if (p.swing || p.cooldown > 0) continue;
        p.swing = { t: 0, kind: this.swingKind(p), stroke: s, hit: false };
        this.events.push({ k: 'swing', p: i, kind: p.swing.kind });
      }
      this.players.forEach((p, i) => (p.arm ? this.liveContact(p, i) : this.contact(p, i)));
      // The ball.
      this.ballEvents.length = 0;
      const oz = this.ball.pos[2];
      this.ball.step(TICK, this.ballEvents);
      if (this.lastTeam >= 0 && (oz < 0) !== (this.ball.pos[2] < 0)) this.crossed = sideOfZ(this.ball.pos[2]) !== this.lastTeam;
      for (const e of this.ballEvents) this.ruleEvent(e);
      if (this.phase === 'rally') this.bodyHits();
    } else if (this.phase === 'dead') {
      // The ball plays on (it's just not in play); then the next point.
      this.ball.step(TICK, null);
      if (this.phaseT > 2) this.nextPoint();
    }
    for (const p of this.players) {
      if (p.swing) {
        p.swing.t += TICK;
        if (p.swing.t > 0.6) {
          if (!p.swing.hit && p.swing.kind !== 'serve') this.events.push({ k: 'whiff', p: this.players.indexOf(p) });
          p.swing = null;
          p.cooldown = COOLDOWN;
        }
      } else p.cooldown = Math.max(0, p.cooldown - TICK);
      // Jump for an overhead.
      if (p.y > 0 || p.vy > 0) {
        p.vy -= 9.81 * TICK;
        p.y = Math.max(0, p.y + p.vy * TICK);
        if (p.y === 0) p.vy = 0;
      }
    }
  }

  /** The serve toss: drop from the hand, bounce, back up to waist height (kinematic). */
  private tossBall(): void {
    const srv = this.players[this.server]!;
    const t = this.phaseT;
    const st = srv.team;
    const x = srv.pos[0] + rightX(st) * 0.32;
    const z = srv.pos[1] - sideSign(st) * 0.35;
    // Down 1.0 m in 0.3 s (bounce), up to 0.75 m by 0.5 s.
    const y = t < 0.3 ? 1.0 - 0.97 * (t / 0.3) ** 2 + BALL_R : BALL_R + 0.72 * Math.sin(((t - 0.3) / 0.2) * (Math.PI / 2));
    this.ball.pos.splice(0, 3, x, y, z);
    this.ball.vel.splice(0, 3, 0, 0, 0);
  }

  private hitServe(): void {
    const srv = this.players[this.server]!;
    const s = this.serveIntent!;
    const box = (this.box = serviceBox(srv.team, srv.pos[0]));
    // Aim: the stroke's sideways angle picks across the box; power the pace (deep serves are harder).
    const aim = this.aimOf(s);
    const bx = (box.x0 + box.x1) / 2 + (aim * rightX(srv.team)) * (box.x1 - box.x0) * 0.38;
    const bzNear = Math.min(Math.abs(box.z0), Math.abs(box.z1));
    const bzFar = Math.max(Math.abs(box.z0), Math.abs(box.z1));
    const depth = bzNear + (bzFar - bzNear) * (0.55 + 0.38 * s.power);
    const errs = this.errors(srv, 0.6, s.power);
    const target: [number, number] = [bx + errs[0], sideSign((1 - srv.team) as 0 | 1) * (depth + errs[1])];
    const L = solveShot([this.ball.pos[0], this.ball.pos[1], this.ball.pos[2]], srv.team, 'serve', target, s.power * srv.racket.power);
    this.launch(L.vel, L.spin);
    srv.swing!.hit = true;
    this.lastHitter = this.server;
    this.hitAt = this.time;
    this.lastTeam = srv.team;
    this.crossed = false;
    this.bounces = 0;
    this.serving = true;
    this.phase = 'rally';
    this.phaseT = 0;
    this.events.push({ k: 'hit', p: this.server, shot: 'serve', power: s.power, x: this.ball.pos[0], y: this.ball.pos[1], z: this.ball.pos[2] });
  }

  /** Turn a velocity by small angles: azimuth (about y) and elevation. */
  private tilt(v: [number, number, number], az: number, el: number): void {
    const h = Math.hypot(v[0], v[2]);
    const sp = Math.hypot(h, v[1]);
    const a = Math.atan2(v[0], v[2]) + az;
    const e = Math.atan2(v[1], h) + el;
    v[0] = Math.sin(a) * Math.cos(e) * sp;
    v[2] = Math.cos(a) * Math.cos(e) * sp;
    v[1] = Math.sin(e) * sp;
  }

  private launch(vel: [number, number, number], spin: [number, number, number]): void {
    this.ball.vel.splice(0, 3, ...vel);
    this.ball.spin.splice(0, 3, ...spin);
  }

  // ------------------------------------------------------------- movement

  private move(p: Player, inp: Input, i: number): void {
    const s = sideSign(p.team);
    let want: [number, number];
    const manual = p.def.human && (Math.abs(inp.mx) > 0.08 || Math.abs(inp.mz) > 0.08);
    if (this.phase === 'serve' || this.phase === 'toss') want = [0, 0];
    else if (manual) {
      // Team-relative stick → world: right = rightX, forward = towards the net (−s).
      const r = rightX(p.team);
      want = [inp.mx * r * p.maxSpeed, -s * inp.mz * p.maxSpeed];
    } else if (p.auto) {
      const dx = p.target[0] - p.pos[0];
      const dz = p.target[1] - p.pos[1];
      const d = Math.hypot(dx, dz);
      const sp = Math.min(p.maxSpeed * this.brain.speedOf(i), d * 6);
      want = d > 0.02 ? [(dx / d) * sp, (dz / d) * sp] : [0, 0];
    } else want = [0, 0];
    const k = Math.min(1, ACCEL * TICK / Math.max(0.001, Math.hypot(want[0] - p.vel[0], want[1] - p.vel[1])));
    p.vel[0] += (want[0] - p.vel[0]) * Math.min(1, k * 1.0);
    p.vel[1] += (want[1] - p.vel[1]) * Math.min(1, k * 1.0);
    p.pos[0] += p.vel[0] * TICK;
    p.pos[1] += p.vel[1] * TICK;
    // Own half, inside the cage.
    p.pos[0] = Math.max(-COURT.halfW + 0.3, Math.min(COURT.halfW - 0.3, p.pos[0]));
    const near = COURT.netGap;
    const far = COURT.halfL - 0.25;
    if (s < 0) p.pos[1] = Math.max(-far, Math.min(-near, p.pos[1]));
    else p.pos[1] = Math.max(near, Math.min(far, p.pos[1]));
    // Face the ball (or the way of travel when sprinting away from it).
    const b = this.ball.pos;
    // A live (camera) player faces the net, like you face your screen: your arm maps 1:1 onto theirs.
    p.facing = p.arm ? (p.team === 0 ? 0 : Math.PI) : Math.atan2(b[0] - p.pos[0], b[2] - p.pos[1]);
  }

  // ------------------------------------------------------------- hitting

  /** Forehand / backhand / overhead, from where the ball is coming relative to the player. */
  swingKind(p: Player): SwingKind {
    const c = this.brain.contactFor(this.players.indexOf(p));
    const bx = c ? c.x : this.ball.pos[0];
    const by = c ? c.y : this.ball.pos[1];
    if (by > 1.85) return 'oh';
    // Forehand side = the player's right.
    return (bx - p.pos[0]) * rightX(p.team) >= 0 ? 'fh' : 'bh';
  }

  /** Can team `team` hit the ball now? (On their side, they didn't touch it last, not a serve they must let bounce.) */
  canHit(team: 0 | 1): boolean {
    if (this.phase !== 'rally') return false;
    if (this.lastTeam === team) return false;
    if (sideOfZ(this.ball.pos[2]) !== team) return false;
    if (this.serving && this.bounces === 0) return false;
    return !this.ball.out;
  }

  private contact(p: Player, i: number): void {
    const sw = p.swing;
    if (!sw || sw.hit || sw.kind === 'serve' || sw.t > WINDOW || !this.canHit(p.team)) return;
    const b = this.ball.pos;
    const dx = b[0] - p.pos[0];
    const dz = b[2] - p.pos[1];
    const reach = REACH + 0.12 * p.racket.sweet;
    const top = HIGH + (sw.kind === 'oh' ? JUMP : 0);
    if (Math.hypot(dx, dz) > reach || b[1] < LOW || b[1] > top) return;
    if (sw.kind === 'oh' && b[1] > HIGH - 0.2 && p.y === 0) p.vy = 3; // jump into it
    sw.hit = true;
    // Timing: early pulls it across, late pushes it the other way; off the sweet spot costs control.
    const timing = (sw.t - IDEAL) / (WINDOW - IDEAL);
    const awkward = (b[1] < 0.35 ? 0.35 : 0) + (sw.kind !== 'oh' && b[1] > 1.7 ? 0.25 : 0);
    const quality = 1 - Math.min(1, Math.abs(timing) * (1.2 - 0.6 * p.racket.sweet)) - awkward;
    this.strike(p, i, sw.stroke, -timing * 0.35 * (sw.kind === 'bh' ? -1 : 1), quality);
  }

  /** The ball meets the racket: stroke → shot (with the errors that quality and pace bring). */
  private strike(p: Player, i: number, s: Stroke, aimShift: number, quality0: number): void {
    const b = this.ball.pos;
    const kind = this.shotKind(p, s, b[1]);
    const intent: ShotIntent = { kind, aim: this.aimOf(s) + aimShift, depth: this.depthOf(kind, s), power: s.power };
    // A fast ball to handle costs accuracy too.
    const vin = Math.hypot(...this.ball.vel);
    const quality = Math.max(0, quality0 - Math.max(0, vin - 13) * 0.025);
    const target = shotTarget(p.team, intent);
    const err = this.errors(p, quality, s.power);
    const so = sideSign((1 - p.team) as 0 | 1);
    target[0] = Math.max(-COURT.halfW + 0.3, Math.min(COURT.halfW - 0.3, target[0] + err[0]));
    target[1] = so * Math.max(0.6, Math.min(COURT.halfL - 0.9, Math.abs(target[1]) + err[1]));
    const L = solveShot([b[0], b[1], b[2]], p.team, kind, target, Math.min(1, s.power * (0.8 + 0.25 * p.racket.power)));
    // Execution: a little off in launch angle too (that's what finds the net or sails it long).
    const lvl = p.def.human ? 0.5 : this.brain.errorOf(i);
    const sig = Math.hypot(err[0], err[1]) / 14 + (1 - quality) * 0.012 * lvl;
    this.tilt(L.vel, (this.rand() - 0.5) * 2 * sig, (this.rand() - 0.5) * 2 * sig);
    // Going for more than the court allows: some of that extra pace stays on the ball and it flies
    // into the glass (the price of hitting too hard from too deep).
    if (L.excess > 1.05) {
      const over = (L.excess - 1) * (0.25 + 0.75 * (1 - quality)) * (0.35 + lvl) * this.rand() * 0.9;
      for (let k = 0; k < 3; k++) L.vel[k]! *= 1 + over;
    }
    this.launch(L.vel, L.spin);
    this.lastHitter = i;
    this.hitAt = this.time;
    this.lastTeam = p.team;
    this.crossed = false;
    this.bounces = 0;
    this.serving = false;
    this.events.push({ k: 'hit', p: i, shot: kind, power: s.power, x: b[0], y: b[1], z: b[2] });
  }

  // ------------------------------------------------------------- the live racket (camera motion play)

  /** Where a live player's racket face is (world), or null. */
  racketHead(p: Player): V3 | null {
    if (!p.arm) return null;
    return bodyToWorld(p.facing, armJoints(p.arm).head, [p.pos[0], p.y, p.pos[1]]);
  }

  /**
   * Did the ball pass through the live racket's face since last tick? (Swept: the ball's path relative
   * to the racket, against the hit radius.) Returns how far off centre it was (0 … 1), or −1.
   */
  private liveTouch(p: Player): number {
    const h = this.racketHead(p);
    if (!h) return -1;
    const b = this.ball.pos;
    const now: V3 = [b[0] - h[0], b[1] - h[1], b[2] - h[2]];
    const was = p.rel ?? now;
    p.rel = now;
    // Closest point of the segment was → now to the face centre.
    const d: V3 = [now[0] - was[0], now[1] - was[1], now[2] - was[2]];
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const t = dd > 1e-9 ? Math.max(0, Math.min(1, -(was[0] * d[0] + was[1] * d[1] + was[2] * d[2]) / dd)) : 1;
    const dist = Math.hypot(was[0] + d[0] * t, was[1] + d[1] * t, was[2] + d[2] * t);
    const r = ARM.hitRadius * (0.9 + 0.25 * p.racket.sweet) * (p.arm!.reach ?? 1);
    return dist < r ? dist / r : -1;
  }

  /** The stroke the live racket's motion makes: speed → power, its direction → aim, upwards → lob. */
  private liveStroke(p: Player): Stroke {
    const v = p.arm!.vel;
    const sp = Math.hypot(v[0], v[1], v[2]);
    const lat = v[0];
    const fwd = v[2];
    const ang = Math.atan2(lat, Math.max(0.35 * Math.hypot(lat, fwd), fwd));
    const a = Math.max(-1, Math.min(1, ang / ((55 * Math.PI) / 180))) * ((40 * Math.PI) / 180);
    // Head speed: ~1.5 m/s is a block, ~11 m/s a full swing.
    const power = Math.max(0.04, Math.min(1, (sp - 1.2) / 9.5));
    const lob = v[1] > 0.6 * sp && sp > 2.2 && this.ball.pos[1] < 1.9;
    return { dx: Math.sin(a), dy: -Math.cos(a), power, lob };
  }

  private liveContact(p: Player, i: number): void {
    const off = p.touch;
    if (off < 0 || p.cooldown > 0 || !this.canHit(p.team)) return;
    p.cooldown = 0.3;
    // A block (racket barely moving) still sends it back, softly; off-centre costs control.
    this.strike(p, i, this.liveStroke(p), 0, 1 - off * off * 0.7);
  }

  /** Which shot a stroke becomes, given the ball. */
  private shotKind(p: Player, s: Stroke, height: number): ShotKind {
    if (s.lob && height < 2.2) return 'lob';
    const volley = this.bounces === 0;
    if (height > 1.85) {
      if (s.power > 0.78) return 'smash';
      return Math.abs(this.aimOf(s)) > 0.45 ? 'vibora' : 'bandeja';
    }
    if (s.lob) return 'lob';
    if (s.power < 0.28) return 'chiquita';
    void p;
    return volley ? 'volley' : 'drive';
  }

  /** Stroke direction → aim (−1 … 1, + = the hitter's right): up to ±40° off straight. */
  private aimOf(s: Stroke): number {
    const fwd = Math.max(0.2, -s.dy);
    const ang = Math.atan2(s.dx, fwd);
    return Math.max(-1, Math.min(1, ang / ((40 * Math.PI) / 180)));
  }

  private depthOf(kind: ShotKind, s: Stroke): number {
    switch (kind) {
      case 'lob':
        return 0.92 + 0.06 * s.power;
      case 'chiquita':
        return 0.25 + 0.2 * s.power;
      case 'smash':
        return 0.55;
      case 'bandeja':
        return 0.82;
      case 'vibora':
        return 0.8;
      case 'volley':
        return 0.6 + 0.3 * s.power;
      default:
        return 0.55 + 0.4 * s.power;
    }
  }

  /** Execution error (metres, x / depth): worse off-centre, at pace, for weaker players; better with a control racket. */
  private errors(p: Player, quality: number, power: number): [number, number] {
    const lvl = p.def.human ? 0.45 : this.brain.errorOf(this.players.indexOf(p));
    const sigma = (0.15 + 0.9 * (1 - quality) + 0.35 * power) * (1.25 - p.racket.control) * lvl;
    const g = () => (this.rand() + this.rand() + this.rand() - 1.5) * 1.15;
    return [g() * sigma, g() * sigma * 0.8];
  }

  // ---------------------------------------------------------------- rules

  private ruleEvent(e: BallEvent): void {
    if (e.k === 'net') this.events.push({ k: 'net', speed: e.speed });
    if (e.k === 'floor') this.events.push({ k: 'bounce', x: e.x, z: e.z, speed: e.speed });
    if (e.k === 'wall') this.events.push({ k: 'wall', mat: e.mat, x: e.x, y: e.y, z: e.z, speed: e.speed });
    if (this.lastTeam < 0) return;
    const hitter = this.lastTeam as 0 | 1;
    const recv = (1 - hitter) as 0 | 1;
    if (e.k === 'net') {
      if (this.serving) this.letCall = true;
      return;
    }
    if (e.k === 'floor') {
      const side = sideOfZ(e.z);
      if (side === hitter) {
        // Never got over (or came back over after bouncing on their side: their point lost).
        if (this.bounces > 0) return this.point(hitter, 'came-back');
        if (this.serving) return this.fault('net');
        return this.point(recv, this.letCall ? 'net' : 'own-side');
      }
      // On the receivers' side.
      if (this.serving && this.bounces === 0) {
        const box = this.box;
        const inBox = e.x >= box.x0 - BALL_R && e.x <= box.x1 + BALL_R && e.z >= box.z0 - BALL_R && e.z <= box.z1 + BALL_R;
        if (!inBox) return this.fault('out');
        if (this.letCall) return this.let();
      }
      this.bounces++;
      if (this.bounces >= 2) return this.point(hitter, 'two-bounces');
      return;
    }
    if (e.k === 'wall') {
      if (e.side === recv && this.bounces === 0) {
        // Straight into their wall / fence before bouncing: the hitter's fault.
        if (this.serving) return this.fault('wall');
        return this.point(recv, 'wall-first');
      }
      if (this.serving && e.side === recv && e.mat === 'mesh' && this.bounces === 1) return this.fault('fence');
      return;
    }
    if (e.k === 'out') {
      if (this.bounces >= 1 && this.crossedOnce()) return this.point(hitter, 'winner');
      if (this.serving) return this.fault('out');
      return this.point(recv, 'out');
    }
  }

  /** The ball got to the receivers' side after the last hit (it bounced there). */
  private crossedOnce(): boolean {
    return this.bounces >= 1;
  }

  /** The ball hits a player's body (not a racket): their team loses the point. */
  private bodyHits(): void {
    const b = this.ball.pos;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]!;
      if (i === this.lastHitter && this.time - this.hitAt < 0.35) continue;
      if (p.swing && !p.swing.hit && p.swing.t < WINDOW) continue; // swinging at it: the racket's there first
      // A struck ball (not one dribbling along the floor) hitting the body.
      if (b[1] > 1.7 + p.y || b[1] < 0.4 || Math.hypot(...this.ball.vel) < 4) continue;
      if (Math.hypot(b[0] - p.pos[0], b[2] - p.pos[1]) > 0.18 + BALL_R) continue;
      if (this.lastTeam < 0) continue;
      return this.point((1 - p.team) as 0 | 1, 'hit-player');
    }
  }

  private fault(why: string): void {
    if (this.phase !== 'rally') return;
    const srv = this.players[this.server]!;
    if (!this.secondServe) {
      this.secondServe = true;
      this.events.push({ k: 'fault', second: false, why });
      this.dead(1.2, () => this.setupServeKeepScore());
      return;
    }
    this.events.push({ k: 'fault', second: true, why });
    this.point((1 - srv.team) as 0 | 1, 'double-fault');
  }

  private let(): void {
    this.events.push({ k: 'let' });
    this.dead(1.2, () => this.setupServeKeepScore());
  }

  private pendingNext: (() => void) | null = null;
  private dead(secs: number, then: () => void): void {
    this.phase = 'dead';
    this.phaseT = 2 - secs;
    this.pendingNext = then;
  }

  /** Re-serve (fault / let) without touching the score. */
  private setupServeKeepScore(): void {
    const second = this.secondServe;
    this.setupServe();
    this.secondServe = second;
  }

  private point(team: 0 | 1, why: PointReason): void {
    if (this.phase !== 'rally') return;
    this.lastPoint = { team, why };
    this.events.push({ k: 'point', team, why });
    this.dead(2, () => {
      this.award(team);
      this.secondServe = false;
      if (this.phase !== 'over') this.setupServe();
    });
  }

  private nextPoint(): void {
    const f = this.pendingNext;
    this.pendingNext = null;
    f?.();
  }

  /** Score a point: game / set / match. */
  private award(team: 0 | 1): void {
    const sc = this.score;
    const o = (1 - team) as 0 | 1;
    sc.points[team]++;
    let game = false;
    if (sc.tiebreak) game = sc.points[team] >= 7 && sc.points[team] - sc.points[o] >= 2;
    else if (this.format.golden && sc.points[team] >= 4 && sc.points[o] >= 3) game = true;
    else if (sc.points[team] >= 4 && sc.points[team] - sc.points[o] >= 2) game = true;
    else if (sc.points[team] === 4 && sc.points[o] === 4) sc.points = [3, 3]; // back to deuce
    if (!game) return;
    sc.points = [0, 0];
    sc.games[team]++;
    this.gamesPlayed++;
    this.events.push({ k: 'game', team });
    const G = this.format.games;
    const setWon = sc.tiebreak || (sc.games[team] >= G && sc.games[team] - sc.games[o] >= 2);
    if (sc.tiebreak) sc.tiebreak = false;
    if (!setWon) {
      if (sc.games[0] === G && sc.games[1] === G) sc.tiebreak = true;
      return;
    }
    sc.history.push([sc.games[0], sc.games[1]]);
    sc.games = [0, 0];
    sc.sets[team]++;
    this.events.push({ k: 'set', team });
    if (sc.sets[team] > this.format.sets / 2) {
      this.winner = team;
      this.phase = 'over';
      this.events.push({ k: 'match', team });
    }
  }

  /** Points as shown: 0 15 30 40 AD (or the tie-break count). */
  pointLabel(team: 0 | 1): string {
    const sc = this.score;
    if (sc.tiebreak) return String(sc.points[team]);
    const a = sc.points[team];
    const b = sc.points[1 - team]!;
    if (a >= 3 && b >= 3) return a > b ? 'AD' : '40';
    return ['0', '15', '30', '40'][Math.min(3, a)]!;
  }

  /** Where the brain expects `p` to meet the ball (for the swing kind and the HUD). */
  contactFor(i: number): { x: number; y: number; z: number; at: number } | null {
    return this.brain.contactFor(i);
  }
}

export const sideOfZ = (z: number): 0 | 1 => (z < 0 ? 0 : 1);
