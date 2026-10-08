import { CLUB, FORMATIONS, type Club, type PlayerDef, type Role } from './data';
import { TeamAI } from './ai';

/**
 * Matchday match engine: 22 players, a physical ball and the laws of the game.
 * Shared by the browser (vs CPU / local) and the server (online), stepped at 60 Hz.
 *
 * Coordinates in metres: x along the pitch (−52.5 … 52.5), z across (−34 … 34),
 * y up. Team 0 attacks +x in the first half; the ends swap at half time.
 */

export const PITCH = { HL: 52.5, HW: 34, GOAL_HW: 3.66, GOAL_H: 2.44, GOAL_D: 2.2, BOX_D: 16.5, BOX_HW: 20.16, SIX_D: 5.5, SIX_HW: 9.16, SPOT: 11, CIRCLE: 9.15 };
export const BALL_R = 0.11;
export const TICK = 1 / 60;
const G = 9.81;
const DRAG = 0.0133; // ½ρCdA/m for a size-5 ball
const MAGNUS = 0.0045;
const POST_R = 0.06;
/** Celebration + replay before the restart (seconds). */
export const GOAL_PAUSE = 9.5;
/** Seconds of holding a button for full power (pass / shot / through / lob). */
export const CHARGE_TIME = 0.45;

/** One tick of a human's controls (stick already turned into pitch directions). */
export interface Input {
  mx: number;
  mz: number;
  sprint: boolean;
  /** Held buttons: pass (X), shoot (○), through (△), lob/cross (□). */
  pass: boolean;
  shoot: boolean;
  through: boolean;
  lob: boolean;
  /** Modifiers: finesse (R1) and chip (L1). */
  finesse: boolean;
  chip: boolean;
  /** Edge-triggered: switch player (L1 / Q), knock-on (R-stick / E). */
  switch: boolean;
  skill: boolean;
}
export const NO_INPUT: Input = { mx: 0, mz: 0, sprint: false, pass: false, shoot: false, through: false, lob: false, finesse: false, chip: false, switch: false, skill: false };

export type KickType = 'pass' | 'through' | 'lob' | 'lobThrough' | 'cross' | 'shot' | 'finesse' | 'chip' | 'clear' | 'throw' | 'gkThrow' | 'header' | 'penalty';
/** 'rise': getting back up after a slide tackle. */
export type PState = 'run' | 'kick' | 'tackle' | 'slide' | 'down' | 'dive' | 'hold' | 'celebrate' | 'off' | 'rise';

export interface Pl {
  i: number;
  team: 0 | 1;
  slot: number;
  def: PlayerDef;
  role: Role;
  x: number;
  z: number;
  vx: number;
  vz: number;
  face: number;
  state: PState;
  /** Seconds left in the current state. */
  t: number;
  kick: { type: KickType; power: number; ax: number; az: number; aimZ: number; target: number; struck: boolean; at: number; tx?: number; tz?: number } | null;
  /** Can't take the ball again until this time (just kicked / tackled). */
  noTouch: number;
  /** Controller index of the human steering this player (−1 = AI). */
  human: number;
  sprint: boolean;
  /** Dive: lateral direction (−1/1) and height of the save. */
  dive: { dz: number; dy: number } | null;
  yellow: number;
  /** Set when caught offside by the pass with this id. */
  offside: number;
  /** AI intent (where to go). */
  tx: number;
  tz: number;
  tSprint: boolean;
  /** Visual: stride phase / kicked with left foot. */
  leftFoot: boolean;
}

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Angular velocity (rad/s). */
  wx: number;
  wy: number;
  wz: number;
  owner: number;
  lastTeam: 0 | 1;
  lastPlayer: number;
  /** Id of the kick that last sent it (shots, passes). */
  kickId: number;
  kickType: KickType | null;
  /** Sim time of the last kick (defenders need a moment to read a pass). */
  kickAt: number;
}

export type Phase = 'kickoff' | 'play' | 'stop' | 'goal' | 'halftime' | 'fulltime';
export type RestartKind = 'kickoff' | 'throw' | 'corner' | 'goalkick' | 'free' | 'penalty';
export interface Restart {
  kind: RestartKind;
  team: 0 | 1;
  x: number;
  z: number;
  taker: number;
  /** Seconds until an AI taker acts. */
  wait: number;
}

export type MatchEvent =
  | { k: 'kick'; p: number; type: KickType; power: number }
  | { k: 'touch'; p: number; heavy: boolean }
  | { k: 'goal'; team: 0 | 1; scorer: number; assist: number; own: boolean; minute: number }
  | { k: 'save'; gk: number; catch: boolean }
  | { k: 'post'; x: number; y: number; z: number }
  | { k: 'tackle'; p: number; won: boolean; slide: boolean }
  | { k: 'foul'; by: number; on: number; card: 'yellow' | 'red' | null; penalty: boolean }
  | { k: 'offside'; p: number }
  | { k: 'whistle'; long: boolean }
  | { k: 'restart'; kind: RestartKind; team: 0 | 1 }
  | { k: 'out'; kind: RestartKind }
  | { k: 'half'; half: 1 | 2 }
  | { k: 'full' }
  | { k: 'switch'; human: number; p: number }
  | { k: 'chance'; team: 0 | 1 };

export interface TeamStats {
  shots: number;
  onTarget: number;
  possession: number;
  passes: number;
  passesDone: number;
  fouls: number;
  corners: number;
  offsides: number;
  yellows: number;
  saves: number;
}

export interface Human {
  id: string;
  team: 0 | 1;
  /** Index of the player being steered. */
  p: number;
  /** Which button is charging and for how long. */
  charge: { btn: 'pass' | 'shoot' | 'through' | 'lob'; t: number } | null;
  last: Input;
  /** A pass / shot asked for before the ball arrived (first-time). */
  queued: { type: KickType; power: number; until: number; ax: number; az: number } | null;
  /** No auto-switching until this time (just switched by hand). */
  lock: number;
  /** Receiving our pass: the stick at the moment it was played, and whether you've taken over. */
  recv: { id: number; sx: number; sz: number; manual: boolean } | null;
  /** Set-piece target (corners, free kicks, goal kicks): moved with the stick. */
  aim: { x: number; z: number } | null;
}

export interface MatchOptions {
  home: string;
  away: string;
  /** Real seconds per half (the clock shows 45 minutes over that). */
  halfSeconds: number;
  difficulty: 'amateur' | 'pro' | 'world' | 'legendary';
  seed?: number;
}

export class MatchSim {
  readonly players: Pl[] = [];
  readonly ball: Ball = { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, owner: -1, lastTeam: 0, lastPlayer: -1, kickId: 0, kickType: null, kickAt: 0 };
  readonly clubs: [Club, Club];
  readonly score: [number, number] = [0, 0];
  readonly stats: [TeamStats, TeamStats];
  readonly humans: Human[] = [];
  readonly opts: MatchOptions;
  readonly ai: [TeamAI, TeamAI];
  phase: Phase = 'kickoff';
  half: 1 | 2 = 1;
  /** Game seconds (0 … 5400). */
  clock = 0;
  time = 0;
  phaseT = 0;
  restart: Restart | null = null;
  /** Direction each team attacks (+1 = towards +x). */
  dir: [1 | -1, 1 | -1] = [1, -1];
  events: MatchEvent[] = [];
  /** Goals: [team, scorer index, minute]. */
  goals: Array<{ team: 0 | 1; p: number; minute: number; own: boolean }> = [];
  rand: () => number;
  private kickSeq = 0;
  /** Last pass: who sent it and to whom (completion, offside, assists). */
  lastPass: { id: number; from: number; to: number; team: 0 | 1 } | null = null;
  private prevToucher = -1;
  private kickoffTeam: 0 | 1 = 0;
  private gkShot = new Map<number, number>();
  /** Deferred actions on the sim clock (deterministic, no real timers). */
  private later: Array<[number, () => void]> = [];

  constructor(opts: MatchOptions) {
    this.opts = opts;
    let s = (opts.seed ?? Date.now()) >>> 0 || 1;
    this.rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    this.clubs = [CLUB[opts.home]!, CLUB[opts.away]!];
    const st = (): TeamStats => ({ shots: 0, onTarget: 0, possession: 0, passes: 0, passesDone: 0, fouls: 0, corners: 0, offsides: 0, yellows: 0, saves: 0 });
    this.stats = [st(), st()];
    for (const team of [0, 1] as const) {
      const club = this.clubs[team];
      FORMATIONS[club.formation].forEach((slot, k) => {
        const def = club.players[k]!;
        this.players.push({ i: this.players.length, team, slot: k, def, role: slot.role, x: 0, z: 0, vx: 0, vz: 0, face: 0, state: 'run', t: 0, kick: null, noTouch: 0, human: -1, sprint: false, dive: null, yellow: 0, offside: 0, tx: 0, tz: 0, tSprint: false, leftFoot: def.left });
      });
    }
    this.ai = [new TeamAI(this, 0), new TeamAI(this, 1)];
    this.kickoffTeam = this.rand() < 0.5 ? 0 : 1;
    this.setKickoff(this.kickoffTeam);
  }

  // ---------------------------------------------------------------- helpers

  get minute(): number {
    return Math.floor(this.clock / 60);
  }
  teamPlayers(team: 0 | 1): Pl[] {
    return this.players.filter((p) => p.team === team && p.state !== 'off');
  }
  gkOf(team: 0 | 1): Pl {
    return this.players.find((p) => p.team === team && p.role === 'GK')!;
  }
  /** x of the goal a team defends. */
  ownGoalX(team: 0 | 1): number {
    return -this.dir[team] * PITCH.HL;
  }
  owner(): Pl | null {
    return this.ball.owner >= 0 ? this.players[this.ball.owner]! : null;
  }
  /** Which team has the ball (or touched it last when loose). */
  get attacking(): 0 | 1 {
    return this.owner()?.team ?? this.ball.lastTeam;
  }
  stat(p: Pl, k: keyof PlayerDef['stats']): number {
    return p.def.stats[k];
  }
  addHuman(id: string, team: 0 | 1): Human {
    const h: Human = { id, team, p: -1, charge: null, last: { ...NO_INPUT }, queued: null, lock: 0, recv: null, aim: null };
    this.humans.push(h);
    this.autoSwitch(h, true);
    return h;
  }
  /** A human left: their player goes back to the AI. */
  removeHuman(id: string): void {
    const i = this.humans.findIndex((h) => h.id === id);
    if (i < 0) return;
    const h = this.humans[i]!;
    if (h.p >= 0) this.players[h.p]!.human = -1;
    this.humans.splice(i, 1);
    for (const p of this.players) p.human = this.humans.findIndex((x) => x.p === p.i);
  }
  /** Skip the rest of a goal celebration / replay (local play). */
  skipGoal(): void {
    if (this.phase === 'goal' && this.phaseT > 1.2) this.phaseT = GOAL_PAUSE;
  }
  private emit(e: MatchEvent): void {
    this.events.push(e);
  }
  diff(): number {
    return { amateur: 0.55, pro: 0.75, world: 0.9, legendary: 1.05 }[this.opts.difficulty];
  }

  // ---------------------------------------------------------------- restarts

  /** Formation spot of a player in the current shape (x shift by ball, attacking or not). */
  formationSpot(p: Pl, bx: number, bz: number, attacking: boolean): [number, number] {
    const slot = FORMATIONS[this.clubs[p.team].formation][p.slot]!;
    const s = this.dir[p.team];
    // Block moves up/down the pitch with the ball (in team-relative coordinates).
    const ballRel = bx * s; // −52 … 52 (own goal … their goal)
    const shift = Math.max(-18, Math.min(30, ballRel * 0.55 + (attacking ? 9 : -5)));
    let rx = slot.x * 42 + shift;
    if (p.role === 'GK') rx = -PITCH.HL + 4 + Math.max(0, (ballRel + 20) * 0.08);
    // Defenders don't go past halfway much; strikers stay onside-ish (handled by the AI).
    if (['CB', 'LB', 'RB'].includes(p.role)) rx = Math.min(rx, attacking ? 12 : 2);
    // Stretch the pitch in possession, stay compact without it.
    const sz = slot.z * (attacking ? 43 : 27) * s;
    let z = sz + (bz - sz) * (attacking ? 0.18 : 0.32);
    if (p.role === 'GK') z = bz * 0.12;
    const x = rx * s;
    return [Math.max(-PITCH.HL + 1, Math.min(PITCH.HL - 1, x)), Math.max(-PITCH.HW + 1, Math.min(PITCH.HW - 1, z))];
  }

  private placeAll(fn: (p: Pl) => [number, number]): void {
    for (const p of this.players) {
      if (p.state === 'off') continue;
      const [x, z] = fn(p);
      p.x = x;
      p.z = z;
      p.vx = p.vz = 0;
      p.state = 'run';
      p.t = 0;
      p.kick = null;
      p.dive = null;
    }
  }

  private setKickoff(team: 0 | 1): void {
    this.phase = 'kickoff';
    this.phaseT = 0;
    const b = this.ball;
    Object.assign(b, { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, owner: -1, kickType: null });
    this.lastPass = null;
    // Everyone in their own half, the kicking team's two strikers at the spot.
    this.placeAll((p) => {
      const [x, z] = this.formationSpot(p, 0, 0, false);
      const s = this.dir[p.team];
      let xx = Math.min(-1.5, x * s - 2) * s;
      if (Math.abs(xx) < PITCH.CIRCLE + 0.5 && p.team !== team && Math.hypot(xx, z) < PITCH.CIRCLE + 0.5) xx = -(PITCH.CIRCLE + 1) * s;
      return [xx, z];
    });
    const kickers = this.teamPlayers(team)
      .filter((p) => p.role !== 'GK')
      .sort((a, b2) => Math.hypot(a.x, a.z) - Math.hypot(b2.x, b2.z));
    const s = this.dir[team];
    const k1 = kickers[0]!;
    const k2 = kickers[1]!;
    k1.x = -0.6 * s;
    k1.z = 0.2;
    k2.x = -1 * s;
    k2.z = -3.5;
    for (const p of this.players) p.face = this.dir[p.team] > 0 ? 0 : Math.PI;
    this.restart = { kind: 'kickoff', team, x: 0, z: 0, taker: k1.i, wait: 1.4 };
    for (const h of this.humans) this.autoSwitch(h, true);
    this.emit({ k: 'restart', kind: 'kickoff', team });
  }

  /** Stop play and set a restart (throw-in, corner, goal kick, free kick, penalty). */
  private setRestart(kind: RestartKind, team: 0 | 1, x: number, z: number): void {
    this.phase = 'stop';
    this.phaseT = 0;
    const b = this.ball;
    Object.assign(b, { x, y: kind === 'throw' ? 1.9 : BALL_R, z, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, owner: -1, kickType: null });
    this.lastPass = null;
    for (const p of this.players) p.offside = 0;
    const s = this.dir[team];
    // Taker: keeper for goal kicks, best passer/shooter for set pieces, nearest for throws.
    const mates = this.teamPlayers(team).filter((p) => p.state !== 'down');
    let taker: Pl;
    if (kind === 'goalkick') taker = this.gkOf(team);
    else if (kind === 'penalty') taker = mates.filter((p) => p.role !== 'GK').reduce((a, p) => (p.def.stats.sho > a.def.stats.sho ? p : a));
    else if (kind === 'corner' || (kind === 'free' && Math.abs(x - s * PITCH.HL) < 32)) taker = mates.filter((p) => p.role !== 'GK').reduce((a, p) => (p.def.stats.pas + p.def.stats.sho * (kind === 'free' ? 0.6 : 0.2) > a.def.stats.pas + a.def.stats.sho * (kind === 'free' ? 0.6 : 0.2) ? p : a));
    else taker = mates.filter((p) => p.role !== 'GK' || kind === 'free').reduce((a, p) => (Math.hypot(p.x - x, p.z - z) < Math.hypot(a.x - x, a.z - z) ? p : a));
    // Everybody else takes a sensible spot (a quick cut, like the broadcast does).
    const att = team;
    this.placeAll((p) => {
      let [px, pz] = this.formationSpot(p, x, z, p.team === att);
      if (kind === 'penalty') {
        // Outside the box and arc, behind the ball.
        const gx = s * PITCH.HL;
        if (p.role !== 'GK') {
          px = gx - s * (PITCH.BOX_D + 2 + (p.i % 4));
          pz = ((p.i % 7) - 3) * 4;
        }
      }
      if (kind === 'corner' && p.team === att && !['GK', 'CB'].includes(p.role) ) {
        // Attackers crowd the box.
        px = s * (PITCH.HL - 6 - (p.i % 5) * 2);
        pz = ((p.i % 6) - 2.5) * 3;
      }
      if (kind === 'corner' && p.team !== att && p.role !== 'GK') {
        px = s * (PITCH.HL - 4 - (p.i % 5) * 2.2);
        pz = ((p.i % 7) - 3) * 2.6;
      }
      // Ten yards from free kicks / corners for the defending side.
      if (p.team !== att && (kind === 'free' || kind === 'corner') && Math.hypot(px - x, pz - z) < PITCH.CIRCLE) {
        const d = Math.hypot(px - x, pz - z) || 1;
        px = x + ((px - x) / d) * PITCH.CIRCLE;
        pz = z + ((pz - z) / d) * PITCH.CIRCLE;
      }
      // Goal kick: opponents out of the box.
      if (kind === 'goalkick' && p.team !== att && Math.abs(px - this.ownGoalX(att)) < PITCH.BOX_D + 1 && Math.abs(pz) < PITCH.BOX_HW + 1) px = this.ownGoalX(att) + s * (PITCH.BOX_D + 2);
      return [px, pz];
    });
    // Free kick wall: up to four defenders 9.15 m out, on the line to goal.
    if (kind === 'free') {
      const dgx = s * PITCH.HL - x;
      const dist = Math.hypot(dgx, -z);
      if (dist < 32) {
        const ux = dgx / dist;
        const uz = -z / dist;
        const wall = this.teamPlayers(1 - team as 0 | 1)
          .filter((p) => p.role !== 'GK')
          .sort((a, b2) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b2.x - x, b2.z - z))
          .slice(0, dist < 22 ? 4 : 3);
        wall.forEach((p, k) => {
          p.x = x + ux * PITCH.CIRCLE - uz * (k - (wall.length - 1) / 2) * 0.62;
          p.z = z + uz * PITCH.CIRCLE + ux * (k - (wall.length - 1) / 2) * 0.62;
        });
      }
    }
    // The keeper on his line for penalties; the taker at the ball.
    if (kind === 'penalty') {
      const gk = this.gkOf((1 - team) as 0 | 1);
      gk.x = s * (PITCH.HL - 0.3);
      gk.z = 0;
    }
    taker.x = x - s * (kind === 'throw' ? 0 : 0.7) * (kind === 'corner' || kind === 'goalkick' ? -1 : 1);
    taker.z = z + (kind === 'throw' ? Math.sign(z) * 0.4 : 0);
    if (kind === 'corner') {
      taker.x = x + Math.sign(x) * 0.6;
      taker.z = z + Math.sign(z) * 0.6;
    }
    if (kind === 'goalkick') taker.x = x - s * 1.2;
    const toGoalX = s * PITCH.HL - taker.x;
    taker.face = kind === 'throw' ? (z > 0 ? -Math.PI / 2 : Math.PI / 2) * -1 : Math.atan2(-(0 - taker.z), toGoalX);
    for (const p of this.players) if (p !== taker) p.face = Math.atan2(-(z - p.z), x - p.x);
    taker.face = Math.atan2(-(kind === 'throw' ? -Math.sign(z) : -taker.z * 0.2), kind === 'throw' ? s * 0.3 : toGoalX);
    this.restart = { kind, team, x, z, taker: taker.i, wait: kind === 'penalty' ? 2.2 : 1.6 + this.rand() * 0.8 };
    for (const h of this.humans) this.autoSwitch(h, true);
    if (kind === 'corner') this.stats[team].corners++;
    this.emit({ k: 'restart', kind, team });
  }

  // ---------------------------------------------------------------- the step

  step(inputs: ReadonlyMap<string, Input>): void {
    const dt = TICK;
    this.time += dt;
    this.phaseT += dt;
    for (let i = this.later.length - 1; i >= 0; i--) {
      if (this.time >= this.later[i]![0]) this.later.splice(i, 1)[0]![1]();
    }
    if (this.phase === 'fulltime') return;
    if (this.phase === 'halftime') {
      if (this.phaseT > 9) {
        this.half = 2;
        this.dir = [-1, 1];
        this.setKickoff((1 - this.kickoffTeam) as 0 | 1);
        this.emit({ k: 'half', half: 2 });
      }
      return;
    }
    if (this.phase === 'goal') {
      for (const p of this.players) this.movePlayer(p, dt, 0, 0, false);
      if (this.phaseT >= GOAL_PAUSE) this.setKickoff(this.lastConceded);
      this.stepBall(dt);
      return;
    }
    // Clock: 45 minutes per half over `halfSeconds`, running in play.
    if (this.phase === 'play') {
      this.clock += (45 * 60 * dt) / this.opts.halfSeconds;
      const end = this.half * 45 * 60;
      if (this.clock >= end && (this.ball.owner < 0 || Math.abs(this.ball.x) < 30)) {
        this.clock = end;
        this.emit({ k: 'whistle', long: true });
        if (this.half === 1) {
          this.phase = 'halftime';
          this.phaseT = 0;
          this.emit({ k: 'half', half: 1 });
        } else {
          this.phase = 'fulltime';
          this.emit({ k: 'full' });
        }
        return;
      }
      const o = this.owner();
      if (o) this.stats[o.team].possession++;
    }
    // Humans.
    for (const h of this.humans) this.humanTick(h, inputs.get(h.id) ?? NO_INPUT, dt);
    // AI for everyone not steered by a human.
    this.ai[0].update(dt);
    this.ai[1].update(dt);
    // Players.
    for (const p of this.players) {
      if (p.state === 'off') continue;
      this.tickState(p, dt);
      if (p.human < 0) this.movePlayer(p, dt, p.tx - p.x, p.tz - p.z, p.tSprint, true);
    }
    this.collidePlayers();
    this.keepDistance();
    // Restart: the taker acts.
    if (this.restart && (this.phase === 'stop' || this.phase === 'kickoff')) this.tickRestart(dt);
    this.stepBall(dt);
    if (this.phase === 'play') {
      this.keepers(dt);
      this.control();
      this.challenges();
      this.lawsOfTheGame();
    }
  }

  /**
   * Laws at restarts (humans included): at a kick-off everyone stays in their own half and the
   * defending side outside the centre circle; at free kicks / corners / goal kicks opponents
   * stay 9.15 m from the ball (2 m at a throw-in).
   */
  private keepDistance(): void {
    const r = this.restart;
    if (!r || (this.phase !== 'kickoff' && this.phase !== 'stop')) return;
    for (const p of this.players) {
      if (p.state === 'off' || p.i === r.taker) continue;
      if (r.kind === 'kickoff') {
        const s = this.dir[p.team];
        if (p.x * s > -0.25) p.x = -0.25 * s;
        if (p.team !== r.team) {
          const d = Math.hypot(p.x, p.z);
          const R = PITCH.CIRCLE + 0.3;
          if (d < R) {
            const k = R / (d || 1);
            p.x = d ? p.x * k : -R * s;
            p.z *= d ? k : 0;
            if (p.x * s > -0.25) p.x = -0.25 * s;
          }
        }
        continue;
      }
      if (p.team === r.team || r.kind === 'penalty') continue;
      const R = r.kind === 'throw' ? 2 : PITCH.CIRCLE;
      const dx = p.x - r.x;
      const dz = p.z - r.z;
      const d = Math.hypot(dx, dz);
      if (d < R) {
        // The free-kick wall stands exactly at the distance; anyone else is pushed back out.
        const k = R / (d || 1);
        p.x = r.x + (d ? dx * k : -this.dir[r.team] * R);
        p.z = r.z + (d ? dz * k : 0);
      }
    }
  }

  // ---------------------------------------------------------------- players

  /** Move towards (dx, dz) (a direction or an offset to a target when `toTarget`). */
  movePlayer(p: Pl, dt: number, dx: number, dz: number, sprint: boolean, toTarget = false): void {
    if (p.state === 'off') return;
    const busy = p.state === 'down' || p.state === 'rise' || p.state === 'dive' || p.state === 'slide' || p.state === 'celebrate';
    const pac = p.def.stats.pac;
    const hasBall = this.ball.owner === p.i;
    const jog = 6.0 + pac * 0.008;
    let top = sprint ? 7.6 + pac * 0.028 : jog;
    if (hasBall) top *= 0.88 + p.def.stats.dri * 0.0009;
    if (p.state === 'kick' || p.state === 'tackle') top *= 0.45;
    let wx = 0;
    let wz = 0;
    const len = Math.hypot(dx, dz);
    if (!busy && len > 0.01) {
      // To a target: slow into it; as a stick direction: full speed by stick amount.
      const sp = toTarget ? Math.min(top, len * 2.2) : top * Math.min(1, len);
      wx = (dx / len) * sp;
      wz = (dz / len) * sp;
    }
    if (p.state === 'slide') {
      // Sliding: momentum only, slowing down.
      const k = Math.exp(-dt * 1.4);
      p.vx *= k;
      p.vz *= k;
    } else if (p.state === 'down' || p.state === 'rise' || p.state === 'dive' || p.state === 'celebrate') {
      const k = Math.exp(-dt * (p.state === 'dive' ? 1.5 : p.state === 'celebrate' ? 0.2 : 6));
      p.vx *= k;
      p.vz *= k;
    } else {
      // Sharp: quick to top speed, and changing direction brakes hard instead of arcing round.
      const v = Math.hypot(p.vx, p.vz);
      const reversing = v > 0.5 && (wx || wz) && (wx * p.vx + wz * p.vz) / (v * Math.hypot(wx, wz)) < 0.3;
      const acc = (!(wx || wz) ? 32 : reversing ? 48 : 20 + pac * 0.1) * (p.human >= 0 ? 1.15 : 1) * dt;
      const ex = wx - p.vx;
      const ez = wz - p.vz;
      const e = Math.hypot(ex, ez);
      const k = e > acc ? acc / e : 1;
      p.vx += ex * k;
      p.vz += ez * k;
    }
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.x = Math.max(-PITCH.HL - 3, Math.min(PITCH.HL + 3, p.x));
    p.z = Math.max(-PITCH.HW - 3, Math.min(PITCH.HW + 3, p.z));
    if (p.state === 'hold') {
      // Ball in hands: free to move, but only inside your own penalty area.
      const gx = this.ownGoalX(p.team);
      const s = Math.sign(gx);
      const inner = gx - s * (PITCH.BOX_D - 0.4);
      p.x = s > 0 ? Math.max(inner, Math.min(gx - 0.3, p.x)) : Math.min(inner, Math.max(gx + 0.3, p.x));
      p.z = Math.max(-PITCH.BOX_HW + 0.4, Math.min(PITCH.BOX_HW - 0.4, p.z));
    }
    p.sprint = sprint && Math.hypot(p.vx, p.vz) > jog * 0.9;
    // Face the way you're going: humans turn on the stick (a 180 is a drag-back, not a loop),
    // AI players follow their velocity.
    const sp = Math.hypot(p.vx, p.vz);
    if (!busy && p.state !== 'kick') {
      if (p.human >= 0 && (wx || wz)) p.face = turn(p.face, Math.atan2(-wz, wx), 30 * dt);
      else if (sp > 0.4) p.face = turn(p.face, Math.atan2(-p.vz, p.vx), (hasBall ? (p.sprint ? 12 : 16) : 20) * dt);
    }
  }

  private collidePlayers(): void {
    const ps = this.players;
    for (let a = 0; a < ps.length; a++) {
      const p = ps[a]!;
      if (p.state === 'off') continue;
      for (let b = a + 1; b < ps.length; b++) {
        const q = ps[b]!;
        if (q.state === 'off') continue;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.42 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (0.65 - d) / 2;
        // Stronger players move less.
        const wp = q.def.stats.phy / (p.def.stats.phy + q.def.stats.phy);
        p.x -= (dx / d) * push * wp * 2;
        p.z -= (dz / d) * push * wp * 2;
        q.x += (dx / d) * push * (1 - wp) * 2;
        q.z += (dz / d) * push * (1 - wp) * 2;
      }
    }
  }

  private tickState(p: Pl, dt: number): void {
    if (p.state === 'run') return;
    p.t -= dt;
    if (p.state === 'kick' && p.kick) {
      // Contact a beat after the swing starts.
      if (!p.kick.struck && p.t <= p.kick.at) {
        p.kick.struck = true;
        this.strike(p);
      }
    }
    if (p.state === 'slide') this.slideContact(p);
    if (p.state === 'tackle' && p.t < 0.3 && p.t > 0.12) this.tackleContact(p);
    if (p.t <= 0) {
      if (p.state === 'slide') {
        // Back on your feet (not a fall: that's only for whoever got fouled).
        p.state = 'rise';
        p.t = 0.4;
        return;
      }
      if (p.state === 'hold') return; // the keeper decides
      p.state = 'run';
      p.kick = null;
      p.dive = null;
    }
  }

  // ---------------------------------------------------------------- humans

  /** Pick a player for a human: the ball carrier on their team, else the one nearest the ball. */
  autoSwitch(h: Human, force = false, prefer?: number): void {
    const o = this.owner();
    let pick: Pl | null = null;
    if (prefer !== undefined) pick = this.players[prefer]!;
    else if (this.restart && this.players[this.restart.taker]!.team === h.team) pick = this.players[this.restart.taker]!;
    else if (o && o.team === h.team) pick = o;
    else {
      const b = this.ball;
      const cands = this.teamPlayers(h.team).filter((p) => p.role !== 'GK' && !this.humans.some((x) => x !== h && x.p === p.i));
      pick = cands.reduce<Pl | null>((a, p) => (!a || Math.hypot(p.x - b.x, p.z - b.z) < Math.hypot(a.x - b.x, a.z - b.z) ? p : a), null);
    }
    if (!pick || (!force && pick.i === h.p)) return;
    // Two humans on one team never steer the same player.
    if (this.humans.some((x) => x !== h && x.p === pick!.i)) return;
    if (h.p >= 0) this.players[h.p]!.human = -1;
    h.p = pick.i;
    pick.human = this.humans.indexOf(h);
    this.emit({ k: 'switch', human: this.humans.indexOf(h), p: pick.i });
  }

  /** Without the ball, you always control whoever is nearest to it. */
  private autoNearest(h: Human, p: Pl): void {
    const b = this.ball;
    if (this.time < h.lock || p.state === 'tackle' || p.state === 'slide' || p.state === 'kick') return;
    if (b.owner >= 0 && this.players[b.owner]!.team === h.team) return;
    // Our pass is on its way: you control its receiver.
    const lp = this.lastPass;
    if (b.owner < 0 && lp && lp.team === h.team && b.kickId === lp.id && lp.to >= 0) {
      if (h.p !== lp.to && !this.humans.some((x) => x !== h && x.p === lp.to)) this.autoSwitch(h, true, lp.to);
      return;
    }
    const bx = b.x + b.vx * 0.25;
    const bz = b.z + b.vz * 0.25;
    let best: Pl | null = null;
    let bd = Infinity;
    for (const q of this.teamPlayers(h.team)) {
      if (q.role === 'GK' || q.state === 'down' || this.humans.some((x) => x !== h && x.p === q.i)) continue;
      const d = Math.hypot(q.x - bx, q.z - bz);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    // A little hysteresis so control doesn't flicker between two players.
    if (best && best !== p && bd < Math.hypot(p.x - bx, p.z - bz) - 1.2) this.autoSwitch(h, true, best.i);
  }

  private humanTick(h: Human, inp: Input, dt: number): void {
    const p = this.players[h.p];
    if (!p) return;
    const b = this.ball;
    const hasBall = b.owner === p.i;
    const myRestart = this.restart && this.restart.taker === p.i && (this.phase === 'stop' || this.phase === 'kickoff');
    // Switching (manual): the team-mate nearest the ball; press again to cycle to the next nearest.
    if (inp.switch && !h.last.switch && !hasBall && !myRestart) {
      const bx = b.x + b.vx * 0.25;
      const bz = b.z + b.vz * 0.25;
      const mates = this.teamPlayers(h.team)
        .filter((q) => q.role !== 'GK' && q.state !== 'down' && !this.humans.some((x) => x !== h && x.p === q.i))
        .sort((a, c) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(c.x - bx, c.z - bz));
      const best = mates[0] === p ? mates[1] : mates[0];
      if (best) {
        this.autoSwitch(h, true, best.i);
        h.lock = this.time + 1.2;
      }
    } else if (!hasBall && !myRestart) this.autoNearest(h, p);
    const cur = this.players[h.p]!;
    const attacking = b.owner >= 0 ? this.players[b.owner]!.team === h.team : false;
    // Buttons: charge on press, act on release (power = hold time).
    const btns = ['pass', 'shoot', 'through', 'lob'] as const;
    for (const k of btns) {
      if (inp[k] && !h.last[k] && !h.charge) h.charge = { btn: k, t: 0 };
    }
    if (h.charge) h.charge.t += dt;
    const released = h.charge && !inp[h.charge.btn];
    // Defending: pass = contain, shoot = tackle, lob = slide, through = teammate press.
    if (!attacking && b.owner >= 0 && !myRestart) {
      if (inp.shoot && !h.last.shoot) this.standingTackle(cur);
      if (inp.lob && !h.last.lob) this.slideTackle(cur);
      if (released) h.charge = null;
      const carrier = this.players[b.owner]!;
      let mx = inp.mx;
      let mz = inp.mz;
      if (inp.pass) {
        // Contain: stay goal-side of the carrier, closing in.
        const gx = this.ownGoalX(cur.team);
        const tx = carrier.x + (gx - carrier.x) * 0.06;
        const tz = carrier.z + (0 - carrier.z) * 0.06;
        mx = (tx - cur.x) * 0.8 + inp.mx * 0.3;
        mz = (tz - cur.z) * 0.8 + inp.mz * 0.3;
      }
      this.movePlayer(cur, dt, mx, mz, inp.sprint && !inp.pass);
      // Jockeying: square up to the carrier (shuffle sideways / backwards).
      if (inp.pass) cur.face = turn(cur.face, Math.atan2(-(carrier.z - cur.z), carrier.x - cur.x), dt * 20);
      h.last = { ...inp };
      return;
    }
    // Attacking / loose ball.
    if (released && h.charge) {
      const power = Math.min(1, h.charge.t / CHARGE_TIME);
      let type: KickType =
        h.charge.btn === 'pass' ? 'pass' : h.charge.btn === 'through' ? (inp.chip ? 'lobThrough' : 'through') : h.charge.btn === 'lob' ? (Math.abs(cur.z) > 18 && Math.abs(cur.x - this.dir[cur.team] * PITCH.HL) < 32 ? 'cross' : 'lob') : inp.chip ? 'chip' : inp.finesse ? 'finesse' : 'shot';
      h.charge = null;
      if (myRestart && this.restart!.kind === 'throw') type = 'throw';
      // From the keeper's hands: pass / through = throw it out, lob / shot = kick it long.
      if (hasBall && cur.state === 'hold') type = type === 'pass' || type === 'through' || type === 'lobThrough' ? 'gkThrow' : 'lob';
      if (myRestart && this.restart!.kind === 'penalty') type = 'penalty';
      if (myRestart && this.restart!.kind === 'corner' && h.charge === null && type === 'lob') type = 'cross';
      let [ax, az] = Math.hypot(inp.mx, inp.mz) > 0.3 ? [inp.mx, inp.mz] : [Math.cos(cur.face), -Math.sin(cur.face)];
      const spot = myRestart && h.aim ? { ...h.aim } : undefined;
      if (spot) [ax, az] = [spot.x - b.x, spot.z - b.z];
      if (spot && type === 'shot' || spot && type === 'finesse') {
        // Free kick at goal: the marker picks the spot across the goal.
        if (Math.abs(spot.x - this.dir[cur.team] * PITCH.HL) < 8) az = Math.max(-1, Math.min(1, spot.z / 3.6));
        else [ax, az] = [ax, 0];
      }
      if (hasBall || (myRestart && (this.phase === 'stop' || this.phase === 'kickoff'))) this.startKick(cur, type, power, ax, az, false, spot);
      else h.queued = { type, power, until: this.time + 0.7, ax, az }; // first-time, when the ball arrives
    }
    // Keeper: drop the ball at your feet (knock-on button) and play it with your feet.
    if (inp.skill && !h.last.skill && hasBall && cur.state === 'hold') {
      cur.state = 'run';
      cur.t = 0;
      h.last = { ...inp };
      return;
    }
    // Knock-on (push the ball ahead and chase it).
    if (inp.skill && !h.last.skill && hasBall && cur.state === 'run') {
      const ax = Math.cos(cur.face);
      const az = -Math.sin(cur.face);
      b.owner = -1;
      b.vx = cur.vx + ax * 7;
      b.vz = cur.vz + az * 7;
      cur.noTouch = this.time + 0.35;
    }
    if (!myRestart) {
      h.aim = null;
      let [mx, mz, sprint] = [inp.mx, inp.mz, inp.sprint];
      // Receiving a pass: run onto it automatically (you take over as soon as you move the
      // stick somewhere new — just holding the direction you were dribbling doesn't count).
      const lp = this.lastPass;
      const incoming = b.owner < 0 && lp && lp.team === h.team && b.kickId === lp.id && lp.to === cur.i && cur.state === 'run';
      if (incoming) {
        if (!h.recv || h.recv.id !== lp.id) h.recv = { id: lp.id, sx: inp.mx, sz: inp.mz, manual: false };
        const sl = Math.hypot(inp.mx, inp.mz);
        const rl = Math.hypot(h.recv.sx, h.recv.sz);
        const same = sl < 0.3 || (rl > 0.3 && (inp.mx * h.recv.sx + inp.mz * h.recv.sz) / (sl * rl) > 0.7);
        if (!same) h.recv.manual = true;
        if (!h.recv.manual) {
          const r = this.ai[h.team].intercept(cur);
          const dx = r.x - cur.x;
          const dz = r.z - cur.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.2) {
            mx = (dx / d) * Math.min(1, d / 1.2);
            mz = (dz / d) * Math.min(1, d / 1.2);
          } else mx = mz = 0;
          sprint = d > 3;
        }
      } else h.recv = null;
      this.movePlayer(cur, dt, mx, mz, sprint);
      // Waiting for it: open up to the ball.
      if (incoming && !h.recv?.manual && Math.hypot(cur.vx, cur.vz) < 1) cur.face = turn(cur.face, Math.atan2(-(b.z - cur.z), b.x - cur.x), dt * 14);
    } else {
      const kind = this.restart!.kind;
      if (kind === 'corner' || kind === 'free' || kind === 'goalkick') {
        // Aiming a set piece: the stick moves the target marker.
        if (!h.aim) h.aim = this.defaultAim(cur.team, kind);
        h.aim.x = Math.max(-PITCH.HL, Math.min(PITCH.HL, h.aim.x + inp.mx * 20 * dt));
        h.aim.z = Math.max(-PITCH.HW, Math.min(PITCH.HW, h.aim.z + inp.mz * 20 * dt));
        cur.face = turn(cur.face, Math.atan2(-(h.aim.z - b.z), h.aim.x - b.x), dt * 8);
      } else if (Math.hypot(inp.mx, inp.mz) > 0.3) cur.face = turn(cur.face, Math.atan2(-inp.mz, inp.mx), dt * 4);
      cur.vx = cur.vz = 0;
    }
    // A queued first-time action fires as soon as the ball is in reach.
    if (h.queued && this.time > h.queued.until) h.queued = null;
    if (h.queued && cur.state === 'run') {
      const d = Math.hypot(b.x - cur.x, b.z - cur.z);
      if (hasBall || (b.owner < 0 && d < 1.1 && b.y < 2.2 && this.time >= cur.noTouch)) {
        this.startKick(cur, b.y > 1.0 && !hasBall ? 'header' : h.queued.type, h.queued.power, h.queued.ax, h.queued.az, true);
        h.queued = null;
      }
    }
    h.last = { ...inp };
  }

  /** Where the set-piece marker starts: the penalty spot for corners, goal for close free kicks. */
  private defaultAim(team: 0 | 1, kind: RestartKind): { x: number; z: number } {
    const s = this.dir[team];
    const b = this.ball;
    if (kind === 'corner') return { x: s * (PITCH.HL - 9), z: 0 };
    if (kind === 'goalkick') return { x: b.x + s * 40, z: b.z * 0.5 };
    const gd = Math.hypot(s * PITCH.HL - b.x, b.z);
    if (gd < 32) return { x: s * PITCH.HL, z: b.z > 0 ? -2.4 : 2.4 };
    return { x: b.x + s * 25, z: b.z * 0.7 };
  }

  // ---------------------------------------------------------------- kicking

  /** Begin a kick: a short wind-up, then `strike` (direction = aim). */
  startKick(p: Pl, type: KickType, power: number, ax: number, az: number, firstTime = false, spot?: { x: number; z: number }): void {
    if (p.state !== 'run' && p.state !== 'hold') return;
    const al = Math.hypot(ax, az) || 1;
    // Pick the target player now (the pass goes where you aim).
    let target = -1;
    if (['pass', 'through', 'lob', 'lobThrough', 'cross', 'throw', 'gkThrow', 'header'].includes(type)) target = this.pickReceiver(p, ax / al, az / al, type);
    const windup = firstTime ? 0.08 : type === 'shot' || type === 'finesse' || type === 'penalty' ? 0.2 : type === 'throw' ? 0.35 : 0.13;
    p.state = 'kick';
    p.t = windup + 0.32;
    p.kick = { type, power, ax: ax / al, az: az / al, aimZ: Math.max(-1, Math.min(1, az)), target, struck: false, at: 0.32, tx: spot?.x, tz: spot?.z };
    // An aimed lofted set piece goes to the marked spot, not to a player.
    if (spot && (type === 'cross' || type === 'lob' || type === 'lobThrough')) p.kick.target = -1;
    // Kicking foot: the side the ball is going to (left foot for left-footers mostly).
    p.leftFoot = p.def.left ? this.rand() < 0.85 : this.rand() < 0.15;
  }

  /** Receiver for a pass in a direction: the best-aligned teammate (assisted passing). */
  pickReceiver(p: Pl, ax: number, az: number, type: KickType): number {
    // The nearest team-mate in the direction you aim (within ~35°); failing that, the nearest
    // within ~60°, weighted towards the one most in line with the stick.
    let best = -1;
    let bs = Infinity;
    for (const narrow of [true, false]) {
      for (const q of this.teamPlayers(p.team)) {
        if (q === p || q.state === 'down') continue;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.5 || d > 70) continue;
        const cos = (dx * ax + dz * az) / d;
        if (cos < (narrow ? 0.82 : 0.5)) continue;
        const score = narrow ? d : d * (1 + (1 - cos) * 3);
        if (score < bs) {
          bs = score;
          best = q.i;
        }
      }
      if (best >= 0) break;
    }
    void type;
    return best;
  }

  /** Ball meets boot: velocity and spin from the kick type, power, stats and luck. */
  private strike(p: Pl): void {
    const k = p.kick!;
    const b = this.ball;
    const owned = b.owner === p.i;
    const near = Math.hypot(b.x - p.x, b.z - p.z) < 1.3 && b.y < 2.4;
    if (!owned && !near && b.owner !== -2) return; // whiffed: the ball moved on
    if (b.owner >= 0 && !owned) return;
    const s = this.dir[p.team];
    const st = p.def.stats;
    const target = k.target >= 0 ? this.players[k.target]! : null;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    let wy = 0;
    // Hit first time off a team-mate's pass (a header from a cross, a one-two): that pass found its man.
    const lp = this.lastPass;
    if (!owned && lp && lp.team === p.team && b.kickId === lp.id && lp.from !== p.i) this.stats[p.team].passesDone++;
    const id = ++this.kickSeq;
    // A set piece is live the moment it's struck.
    if (this.restart) {
      if (this.restart.kind === 'kickoff' || this.restart.kind === 'penalty') this.emit({ k: 'whistle', long: false });
      this.phase = 'play';
      this.restart = null;
    }
    const lead = (q: Pl, t: number) => [q.x + q.vx * t, q.z + q.vz * t] as [number, number];
    const error = (sigma: number) => (this.rand() + this.rand() + this.rand() - 1.5) * sigma;
    switch (k.type) {
      case 'pass':
      case 'throw':
      case 'gkThrow': {
        let tx: number;
        let tz: number;
        if (target) {
          const d0 = Math.hypot(target.x - b.x, target.z - b.z);
          [tx, tz] = lead(target, d0 / 14);
        } else {
          const d = 8 + k.power * 22;
          tx = b.x + k.ax * d;
          tz = b.z + k.az * d;
        }
        const d = Math.hypot(tx - b.x, tz - b.z);
        // Ground pass: enough pace to arrive at a nice speed (power adds zip).
        let v0 = rollSpeedFor(d, 7 + k.power * 6);
        v0 = Math.max(11, Math.min(30, v0 * (0.92 + k.power * 0.25)));
        if (k.type === 'throw' || k.type === 'gkThrow') v0 = Math.min(v0, k.type === 'throw' ? 16 : 22);
        const ang = Math.atan2(tz - b.z, tx - b.x) + error(0.015 + 0.09 * (1 - st.pas / 100) + (this.players.some((q) => q.team !== p.team && Math.hypot(q.x - p.x, q.z - p.z) < 1.8) ? 0.04 : 0));
        vx = Math.cos(ang) * v0;
        vz = Math.sin(ang) * v0;
        vy = k.type === 'throw' ? 3 : k.type === 'gkThrow' ? 2.5 : 0.4;
        this.notePass(p, target, id);
        break;
      }
      case 'through':
      case 'lobThrough':
      case 'lob':
      case 'cross':
      case 'clear':
      case 'header': {
        let tx: number;
        let tz: number;
        if (k.tx !== undefined && k.tz !== undefined && k.type !== 'through' && k.type !== 'header') {
          tx = k.tx;
          tz = k.tz;
        } else if (k.type === 'cross') {
          // Into the box: near post, penalty spot or far post (towards the best-placed attacker).
          const gx = s * (PITCH.HL - 8);
          const runner = this.teamPlayers(p.team).filter((q) => Math.abs(q.x - s * PITCH.HL) < 18 && Math.abs(q.z) < 14 && q !== p).sort((a, c) => Math.abs(a.z) - Math.abs(c.z))[0];
          tx = runner ? runner.x + runner.vx * 0.9 : gx;
          tz = runner ? runner.z + runner.vz * 0.9 : -Math.sign(b.z) * 2;
        } else if (k.type === 'clear') {
          tx = b.x + s * (30 + this.rand() * 20);
          tz = b.z + (this.rand() - 0.5) * 70;
        } else if (target && k.type !== 'header') {
          const runAhead = k.type === 'through' || k.type === 'lobThrough' ? 4 + k.power * 9 : 0;
          const d0 = Math.hypot(target.x - b.x, target.z - b.z);
          const t0 = d0 / (k.type === 'through' ? 15 : 13);
          [tx, tz] = lead(target, t0);
          const tl = Math.hypot(target.vx, target.vz) || 1;
          // Through balls go into space ahead of the runner (towards goal if standing).
          const fx = tl > 1 ? target.vx / tl : s;
          const fz = tl > 1 ? target.vz / tl : 0;
          tx += fx * runAhead;
          tz += fz * runAhead;
          // Into space, but never out of play.
          tx = Math.max(-PITCH.HL + 3, Math.min(PITCH.HL - 3, tx));
          tz = Math.max(-PITCH.HW + 2, Math.min(PITCH.HW - 2, tz));
        } else if (k.type === 'header') {
          // Head it towards goal if close, else to a teammate.
          const gx = s * PITCH.HL;
          const near2 = Math.abs(gx - b.x) < 18;
          tx = near2 ? gx : target ? target.x : b.x + k.ax * 15;
          // Headers at goal are hard to place: anywhere from inside the posts to well wide.
          tz = near2 ? (this.rand() - 0.5) * 9 : target ? target.z : b.z + k.az * 15;
        } else {
          const d = 15 + k.power * 30;
          tx = b.x + k.ax * d;
          tz = b.z + k.az * d;
        }
        const d = Math.hypot(tx - b.x, tz - b.z);
        if (k.type === 'through') {
          // A driven ground through ball.
          // Weighted to die in the runner's path (it arrives slowly at the spot).
          const v0 = Math.max(9, Math.min(30, rollSpeedFor(d, 2.5 + k.power * 3)));
          const ang = Math.atan2(tz - b.z, tx - b.x) + error(0.06 * (1 - st.pas / 115));
          vx = Math.cos(ang) * v0;
          vz = Math.sin(ang) * v0;
          vy = 0.3;
        } else if (k.type === 'header') {
          const ang = Math.atan2(tz - b.z, tx - b.x) + error(0.16);
          const v0 = Math.abs(s * PITCH.HL - b.x) < 18 ? 10 + st.sho * 0.05 + st.phy * 0.02 : 9 + d * 0.15;
          vx = Math.cos(ang) * v0;
          vz = Math.sin(ang) * v0;
          vy = Math.abs(s * PITCH.HL - b.x) < 18 ? -1.5 + this.rand() * 4.5 : 3;
          if (Math.abs(s * PITCH.HL - b.x) < 18) this.stats[p.team].shots++;
        } else {
          // Lofted: flight time grows with distance (more power = flatter and quicker).
          const t = loftTime(d, k.power) + (k.type === 'lobThrough' ? 0.25 : 0);
          // Crosses curl in (whipped from the outside of the boot / instep).
          if (k.type === 'cross') wy = -Math.sign(b.z) * s * 18;
          // Error: off-line and over/under-hit, by passing skill.
          // (An aimed set piece is struck from a dead ball: it goes close to the marker.)
          const sig = k.tx !== undefined ? 0.008 + 0.05 * (1 - st.pas / 100) : (k.type === 'cross' ? 0.07 : 0.03) + 0.1 * (1 - st.pas / 100) + Math.max(0, k.power - 0.9) * 0.3;
          const ang = Math.atan2(tz - b.z, tx - b.x) + error(sig);
          const dd = d * (1 + error(sig * 1.5));
          [vx, vy, vz] = loftTo(b.x, b.y, b.z, b.x + Math.cos(ang) * dd, b.z + Math.sin(ang) * dd, t, wy);
        }
        if (k.type !== 'clear' && !(k.type === 'header' && Math.abs(s * PITCH.HL - b.x) < 18)) this.notePass(p, target, id);
        break;
      }
      case 'shot':
      case 'finesse':
      case 'chip':
      case 'penalty': {
        const gx = s * PITCH.HL;
        const gk = this.gkOf((1 - p.team) as 0 | 1);
        // Aim: stick sideways picks the corner; neutral = away from the keeper.
        // Aim: the stick across the goal picks the spot; neutral = the side away from the keeper.
        let zt = Math.abs(k.aimZ) > 0.2 ? Math.max(-3.2, Math.min(3.2, k.aimZ * 3.6)) : gk.z > 0 ? -2.6 : 2.6;
        if (k.tx !== undefined && k.tz !== undefined && Math.abs(k.tx - gx) < 8) zt = Math.max(-3.3, Math.min(3.3, k.tz));
        const dist = Math.hypot(gx - b.x, zt - b.z);
        const sho = st.sho;
        const power = k.power;
        let yt = 0.35 + power * 1.2;
        let speed = 17 + power * 15 * (0.65 + sho / 280);
        if (k.type === 'finesse') {
          speed *= 0.8;
          yt = 0.9 + power * 0.8;
        }
        if (k.type === 'penalty') {
          speed = 18 + power * 10;
          yt = 0.3 + power * 1.6;
        }
        // Accuracy: the stat, over-hitting, distance, pressure.
        const pressure = this.players.filter((q) => q.team !== p.team && Math.hypot(q.x - p.x, q.z - p.z) < 2.2).length;
        const sigma = 0.035 + (1 - sho / 100) * 0.09 + Math.max(0, power - 0.82) * 0.25 + dist * 0.0015 + pressure * 0.025 - (k.type === 'finesse' ? 0.015 : 0);
        if (k.type === 'chip') {
          const t = 0.9 + dist * 0.035;
          const h = (dist / t) * 1.08;
          const ang = Math.atan2(zt - b.z, gx - b.x) + error(sigma);
          vx = Math.cos(ang) * h;
          vz = Math.sin(ang) * h;
          vy = 0.5 * G * t * 0.92;
        } else {
          const dx = gx - b.x;
          const dz = zt - b.z;
          const ang = Math.atan2(dz, dx) + error(sigma);
          const flat = speed;
          vx = Math.cos(ang) * flat;
          vz = Math.sin(ang) * flat;
          // Enough lift to get to the target height (plus over-hit lift).
          const t = Math.hypot(dx, dz) / flat;
          vy = (yt - b.y + 0.5 * G * t * t) / Math.max(0.15, t) + error(sigma * 6) + Math.max(0, power - 0.88) * 9;
          if (k.type === 'finesse') {
            // Curl from outside the post into the corner: start the ball outside and bend it in.
            const curl = Math.sign(zt - b.z) || 1;
            const out = 0.15 * curl;
            vx = Math.cos(ang - out * s) * flat;
            vz = Math.sin(ang - out * s) * flat;
            wy = curl * s * 26;
          }
        }
        this.stats[p.team].shots++;
        this.emit({ k: 'chance', team: p.team });
        break;
      }
    }
    b.owner = -1;
    b.vx = vx;
    b.vy = vy;
    b.vz = vz;
    b.wx = 0;
    b.wy = wy;
    b.wz = 0;
    b.lastTeam = p.team;
    b.lastPlayer = p.i;
    b.kickId = id;
    b.kickType = k.type;
    b.kickAt = this.time;
    if (b.y < BALL_R) b.y = BALL_R;
    if (k.type === 'throw') b.y = 2;
    p.noTouch = this.time + 0.3;
    if (p.state === 'hold') p.state = 'run';
    this.emit({ k: 'kick', p: p.i, type: k.type, power: k.power });
  }

  private notePass(p: Pl, target: Pl | null, id: number): void {
    this.stats[p.team].passes++;
    this.lastPass = { id, from: p.i, to: target?.i ?? -1, team: p.team };
    // Offside: judged when the ball is played.
    const s = this.dir[p.team];
    const opp = this.teamPlayers((1 - p.team) as 0 | 1).map((q) => q.x * s).sort((a, c) => c - a);
    const secondLast = opp[1] ?? PITCH.HL;
    for (const q of this.teamPlayers(p.team)) {
      q.offside = 0;
      if (q === p) continue;
      const qx = q.x * s;
      if (qx > 0 && qx > this.ball.x * s + 0.3 && qx > secondLast + 0.3) q.offside = id;
    }
    // FC-style: the controlled player follows the pass to its receiver.
    if (target) for (const h of this.humans) if (h.team === p.team && h.p === p.i) this.autoSwitch(h, true, target.i);
  }

  // ---------------------------------------------------------------- tackles

  standingTackle(p: Pl): void {
    if (p.state !== 'run') return;
    p.state = 'tackle';
    p.t = 0.42;
  }
  slideTackle(p: Pl): void {
    if (p.state !== 'run') return;
    const sp = Math.max(7.5, Math.hypot(p.vx, p.vz) + 2);
    p.vx = Math.cos(p.face) * sp;
    p.vz = -Math.sin(p.face) * sp;
    p.state = 'slide';
    p.t = 0.75;
    this.emit({ k: 'tackle', p: p.i, won: false, slide: true });
  }

  private tackleContact(p: Pl): void {
    const o = this.owner();
    if (!o || o.team === p.team || p.kick || o.state === 'hold') return;
    const dx = o.x - p.x;
    const dz = o.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.5) return;
    const fx = Math.cos(p.face);
    const fz = -Math.sin(p.face);
    if ((dx * fx + dz * fz) / (d || 1) < 0.3) return;
    p.kick = { type: 'pass', power: 0, ax: 0, az: 0, aimZ: 0, target: -1, struck: true, at: 0 }; // one roll per tackle
    const chance = Math.max(0.12, Math.min(0.88, 0.5 + (p.def.stats.def - o.def.stats.dri) * 0.012 + (o.sprint ? -0.08 : 0.05)));
    const won = this.rand() < chance;
    this.emit({ k: 'tackle', p: p.i, won, slide: false });
    if (won) {
      const b = this.ball;
      b.owner = -1;
      const a = Math.atan2(fz, fx) + (this.rand() - 0.5) * 2.4;
      const sp = 3 + this.rand() * 6;
      b.vx = Math.cos(a) * sp;
      b.vz = Math.sin(a) * sp;
      b.lastTeam = p.team;
      b.lastPlayer = p.i;
      o.noTouch = this.time + 0.5;
      // Strong defenders come away with it.
      if (this.rand() < 0.35 + p.def.stats.def * 0.004) {
        b.owner = p.i;
        this.gained(p);
      }
    } else {
      // Clipped him from behind?
      const behind = (Math.cos(o.face) * dx + -Math.sin(o.face) * dz) / (d || 1) > 0.45;
      if (behind ? this.rand() < 0.3 : this.rand() < (o.sprint ? 0.14 : 0.06)) this.foul(p, o, behind && this.rand() < 0.3);
    }
  }

  private slideContact(p: Pl): void {
    if (p.t < 0.2) return;
    const b = this.ball;
    const db = Math.hypot(b.x - p.x, b.z - p.z);
    const o = this.owner();
    // Player first?
    for (const q of this.players) {
      if (q.team === p.team || q.state === 'down' || q.state === 'off' || q.role === 'GK' && q.state === 'hold') continue;
      const dq = Math.hypot(q.x - p.x, q.z - p.z);
      if (dq < 0.85 && (dq < db - 0.2 || b.y > 0.8)) {
        if (o === q || Math.hypot(b.x - q.x, b.z - q.z) < 3) {
          const fromBehind = (Math.cos(q.face) * (q.x - p.x) + -Math.sin(q.face) * (q.z - p.z)) / (dq || 1) > 0.35;
          this.foul(p, q, fromBehind);
          return;
        }
      }
    }
    if (db < 0.95 && b.y < 0.7 && (b.owner < 0 || this.players[b.owner]!.team !== p.team)) {
      const sp = Math.hypot(p.vx, p.vz);
      b.owner = -1;
      b.vx = p.vx * 0.9 + (this.rand() - 0.5) * 3;
      b.vz = p.vz * 0.9 + (this.rand() - 0.5) * 3;
      b.vy = 0.5;
      b.lastTeam = p.team;
      b.lastPlayer = p.i;
      if (o) o.noTouch = this.time + 0.6;
      p.noTouch = this.time + 0.4;
      this.emit({ k: 'tackle', p: p.i, won: true, slide: true });
      void sp;
    }
  }

  private foul(by: Pl, on: Pl, reckless: boolean): void {
    if (this.phase !== 'play') return;
    on.state = 'down';
    on.t = 1.3;
    by.vx *= 0.3;
    by.vz *= 0.3;
    this.stats[by.team].fouls++;
    let card: 'yellow' | 'red' | null = null;
    if (reckless && this.rand() < 0.55) {
      by.yellow++;
      card = by.yellow >= 2 ? 'red' : 'yellow';
      this.stats[by.team].yellows++;
    }
    // In the box → penalty.
    const s = this.dir[on.team];
    const gx = s * PITCH.HL;
    const inBox = Math.abs(on.x - gx) < PITCH.BOX_D && Math.abs(on.z) < PITCH.BOX_HW;
    this.emit({ k: 'foul', by: by.i, on: on.i, card, penalty: inBox });
    this.emit({ k: 'whistle', long: false });
    if (card === 'red') {
      by.state = 'off';
      by.x = 0;
      by.z = -PITCH.HW - 6;
      if (by.human >= 0) {
        const h = this.humans[by.human]!;
        by.human = -1;
        h.p = -1;
        this.autoSwitch(h, true);
      }
    }
    if (inBox) this.setRestart('penalty', on.team, gx - s * PITCH.SPOT, 0);
    else this.setRestart('free', on.team, on.x, on.z);
  }

  /** Bumps: a stronger player shrugging the carrier off the ball. */
  private challenges(): void {
    const o = this.owner();
    if (!o || o.state === 'hold') return;
    for (const p of this.players) {
      if (p.team === o.team || p.state !== 'run') continue;
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      if (d > 0.75) continue;
      const edge = (p.def.stats.phy + p.def.stats.def) - (o.def.stats.phy + o.def.stats.dri);
      if (this.rand() < Math.max(0.002, 0.012 + edge * 0.0004)) {
        const b = this.ball;
        b.owner = -1;
        b.vx = (p.vx + o.vx) * 0.4 + (this.rand() - 0.5) * 4;
        b.vz = (p.vz + o.vz) * 0.4 + (this.rand() - 0.5) * 4;
        b.lastPlayer = p.i;
        b.lastTeam = p.team;
        o.noTouch = this.time + 0.4;
      }
    }
  }

  // ---------------------------------------------------------------- the ball

  private stepBall(dt: number): void {
    const b = this.ball;
    const o = this.owner();
    if (o && o.state === 'hold') {
      // In the keeper's hands.
      b.x = o.x + Math.cos(o.face) * 0.35;
      b.z = o.z - Math.sin(o.face) * 0.35;
      b.y = 1.1;
      b.vx = o.vx;
      b.vz = o.vz;
      b.vy = 0;
      return;
    }
    if (o) {
      // Dribbling: the ball runs a touch ahead of the carrier.
      const sp = Math.hypot(o.vx, o.vz);
      const reach = 0.42 + sp * 0.07 + Math.max(0, Math.sin(this.time * (7 + sp * 0.6)) * sp * 0.035);
      const tx = o.x + Math.cos(o.face) * reach;
      const tz = o.z - Math.sin(o.face) * reach;
      const k = Math.min(1, dt * 22);
      b.x += (tx - b.x) * k;
      b.z += (tz - b.z) * k;
      b.y = BALL_R;
      b.vx = o.vx;
      b.vz = o.vz;
      b.vy = 0;
      // Rolling spin for the renderer.
      b.wx = -o.vz / BALL_R;
      b.wz = o.vx / BALL_R;
      return;
    }
    // Free flight / rolling.
    const v = Math.hypot(b.vx, b.vy, b.vz);
    const onGround = b.y <= BALL_R + 0.005 && Math.abs(b.vy) < 0.4;
    // Drag and Magnus (spin × velocity).
    let ax = -DRAG * v * b.vx + MAGNUS * (b.wy * b.vz - b.wz * b.vy);
    let ay = -G - DRAG * v * b.vy + MAGNUS * (b.wz * b.vx - b.wx * b.vz);
    let az = -DRAG * v * b.vz + MAGNUS * (b.wx * b.vy - b.wy * b.vx);
    if (onGround) {
      ay = 0;
      b.vy = 0;
      b.y = BALL_R;
      const hv = Math.hypot(b.vx, b.vz);
      if (hv > 0) {
        // Grass: rolling resistance.
        const dec = (ROLL_A + ROLL_B * hv) / hv;
        ax -= b.vx * dec;
        az -= b.vz * dec;
      }
      b.wx = -b.vz / BALL_R;
      b.wz = b.vx / BALL_R;
      b.wy *= Math.exp(-dt * 3);
    }
    b.vx += ax * dt;
    b.vy += ay * dt;
    b.vz += az * dt;
    if (onGround && Math.hypot(b.vx, b.vz) < 0.08) b.vx = b.vz = 0;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    if (!onGround) {
      b.wx *= Math.exp(-dt * 0.5);
      b.wy *= Math.exp(-dt * 0.5);
      b.wz *= Math.exp(-dt * 0.5);
    }
    if (b.y < BALL_R) {
      b.y = BALL_R;
      if (b.vy < -0.6) {
        b.vy = -b.vy * 0.55;
        b.vx *= 0.82;
        b.vz *= 0.82;
      } else b.vy = 0;
    }
    this.goalFrame();
  }

  /** End whose goal the ball went into (0 = none). */
  private netIn = 0;
  /** Posts, crossbar and net. */
  private goalFrame(): void {
    const b = this.ball;
    if (Math.abs(b.x) < PITCH.HL) this.netIn = 0;
    for (const gx of [-PITCH.HL, PITCH.HL]) {
      if (Math.abs(b.x - gx) > 3) continue;
      // Posts.
      for (const pz of [-PITCH.GOAL_HW, PITCH.GOAL_HW]) {
        if (b.y > PITCH.GOAL_H + BALL_R) continue;
        const dx = b.x - gx;
        const dz = b.z - pz;
        const d = Math.hypot(dx, dz);
        if (d < POST_R + BALL_R && d > 0) this.bounce(dx / d, 0, dz / d, POST_R + BALL_R - d, gx, b.y, pz);
      }
      // Crossbar.
      if (Math.abs(b.z) < PITCH.GOAL_HW) {
        const dx = b.x - gx;
        const dy = b.y - PITCH.GOAL_H;
        const d = Math.hypot(dx, dy);
        if (d < POST_R + BALL_R && d > 0) this.bounce(dx / d, dy / d, 0, POST_R + BALL_R - d, gx, PITCH.GOAL_H, b.z);
      }
      // Inside the goal: the net catches it — only if it went in through the mouth
      // (a ball wide of the post is simply out of play, never pulled into the goal).
      const inside = Math.sign(gx) * (b.x - gx) > BALL_R;
      if (inside && this.netIn === 0 && Math.abs(b.z) < PITCH.GOAL_HW && b.y < PITCH.GOAL_H) this.netIn = Math.sign(gx);
      if (inside && this.netIn === Math.sign(gx)) {
        const back = gx + Math.sign(gx) * PITCH.GOAL_D;
        if (Math.sign(gx) * (b.x - back) > -BALL_R) {
          b.x = back - Math.sign(gx) * BALL_R;
          b.vx *= -0.15;
          b.vz *= 0.3;
        }
        if (Math.abs(b.z) > PITCH.GOAL_HW - BALL_R) {
          b.z = Math.sign(b.z) * (PITCH.GOAL_HW - BALL_R);
          b.vz *= -0.15;
          b.vx *= 0.5;
        }
        if (b.y > PITCH.GOAL_H - BALL_R) {
          b.y = PITCH.GOAL_H - BALL_R;
          b.vy = Math.min(0, b.vy) * 0.2;
        }
      }
    }
  }

  private bounce(nx: number, ny: number, nz: number, pen: number, x: number, y: number, z: number): void {
    const b = this.ball;
    b.x += nx * pen;
    b.y += ny * pen;
    b.z += nz * pen;
    const vn = b.vx * nx + b.vy * ny + b.vz * nz;
    if (vn < 0) {
      b.vx -= 1.7 * vn * nx;
      b.vy -= 1.7 * vn * ny;
      b.vz -= 1.7 * vn * nz;
      if (Math.abs(vn) > 3) this.emit({ k: 'post', x, y, z });
    }
  }

  // ---------------------------------------------------------------- first touch / possession

  private control(): void {
    const b = this.ball;
    if (b.owner >= 0) return;
    let best: Pl | null = null;
    let bd = Infinity;
    for (const p of this.players) {
      if (p.state === 'off' || p.state === 'down' || p.state === 'rise' || p.state === 'dive' || p.state === 'slide' || p.state === 'celebrate' || p.state === 'kick') continue;
      if (this.time < p.noTouch) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      // A fast ball is harder to stop: the reach shrinks with its pace (passes get through gaps).
      const rv0 = Math.hypot(b.vx - p.vx, b.vz - p.vz);
      const mine = this.lastPass?.to === p.i && b.kickId === this.lastPass.id && this.lastPass.team === p.team;
      // The player a pass is meant for stretches for it (and takes it on the chest / thigh).
      const reach = mine ? 1.05 + p.def.stats.dri * 0.003 : (0.6 + p.def.stats.dri * 0.0025) * Math.max(0.4, Math.min(1, 1.3 - rv0 * 0.05));
      if (d > reach) continue;
      if (b.y > (p.role === 'GK' && this.inOwnBox(p) ? 2.5 : mine ? 1.9 : 1.0)) continue;
      // Contested: closest wins (stronger breaks ties); the man it was meant for shields it.
      const score = d - p.def.stats.phy * 0.002 - (mine ? 0.45 : 0);
      if (score < bd) {
        bd = score;
        best = p;
      }
    }
    if (!best) return;
    const p = best;
    const rv = Math.hypot(b.vx - p.vx, b.vz - p.vz);
    const maxCtl = 11 + p.def.stats.dri * 0.12;
    // Keepers in their box catch what reaches them.
    if (p.role === 'GK' && this.inOwnBox(p) && b.lastTeam !== p.team) {
      this.gkCatch(p);
      return;
    }
    // Cutting out a driven ball: often it's only a block / deflection, not clean control.
    const intended = this.lastPass?.to === p.i && b.kickId === this.lastPass.id;
    if (!intended && b.lastTeam !== p.team && rv > 9 && this.rand() < 0.35 + (rv - 9) * 0.04 - p.def.stats.def * 0.002) {
      const a = this.rand() * Math.PI * 2;
      const sp = 3 + this.rand() * rv * 0.45;
      b.vx = Math.cos(a) * sp + b.vx * 0.15;
      b.vz = Math.sin(a) * sp + b.vz * 0.15;
      b.vy = this.rand() * 4;
      this.touched(p);
      p.noTouch = this.time + 0.3;
      this.emit({ k: 'touch', p: p.i, heavy: true });
      return;
    }
    // A pass to you is under control unless it's a rocket.
    if (intended && rv < 26) {
      b.owner = p.i;
      this.gained(p);
      return;
    }
    if (rv > maxCtl) {
      // Too hot to handle: it deflects off him.
      b.vx = b.vx * -0.25 + p.vx * 0.5;
      b.vz = b.vz * -0.25 + p.vz * 0.5;
      b.vy = Math.abs(b.vy) * 0.3 + 0.5;
      this.touched(p);
      p.noTouch = this.time + 0.25;
      this.emit({ k: 'touch', p: p.i, heavy: true });
      return;
    }
    // Heavy touch: it squirms away a little (worse for poor dribblers on fast balls).
    if (rv > 7 && this.rand() < (rv - 7) * 0.04 * (1.3 - p.def.stats.dri / 100)) {
      b.vx = p.vx + Math.cos(p.face) * 3.5 + (this.rand() - 0.5) * 2;
      b.vz = p.vz - Math.sin(p.face) * 3.5 + (this.rand() - 0.5) * 2;
      this.touched(p);
      p.noTouch = this.time + 0.15;
      this.emit({ k: 'touch', p: p.i, heavy: true });
      return;
    }
    b.owner = p.i;
    this.gained(p);
  }

  /** Bookkeeping for a touch that isn't a clean control. */
  private touched(p: Pl): void {
    const b = this.ball;
    if (p.offside && p.offside === b.kickId && this.lastPass?.team === p.team) return this.offside(p);
    this.prevToucher = b.lastPlayer;
    b.lastPlayer = p.i;
    b.lastTeam = p.team;
    for (const q of this.players) q.offside = 0;
  }

  /** A player has the ball under control. */
  gained(p: Pl): void {
    const b = this.ball;
    if (p.offside && p.offside === b.kickId && this.lastPass?.team === p.team) return this.offside(p);
    if (this.lastPass && this.lastPass.team === p.team && b.kickId === this.lastPass.id) this.stats[p.team].passesDone++;
    this.prevToucher = b.lastPlayer;
    b.lastPlayer = p.i;
    b.lastTeam = p.team;
    b.kickType = null;
    for (const q of this.players) q.offside = 0;
    for (const h of this.humans) {
      if (h.team === p.team && p.role !== 'GK') this.autoSwitch(h, false, p.i);
      if (h.team !== p.team && h.p >= 0) {
        // Lost it: hand control to whoever is nearest the new carrier.
        const me = this.players[h.p]!;
        const near = this.teamPlayers(h.team).filter((q) => q.role !== 'GK' && !this.humans.some((x) => x !== h && x.p === q.i)).sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0];
        if (near && near !== me && Math.hypot(me.x - p.x, me.z - p.z) > Math.hypot(near.x - p.x, near.z - p.z) + 4) this.autoSwitch(h, true, near.i);
      }
    }
    this.emit({ k: 'touch', p: p.i, heavy: false });
  }

  private offside(p: Pl): void {
    this.stats[p.team].offsides++;
    this.emit({ k: 'offside', p: p.i });
    this.emit({ k: 'whistle', long: false });
    this.setRestart('free', (1 - p.team) as 0 | 1, p.x, p.z);
  }

  private inOwnBox(p: Pl): boolean {
    const gx = this.ownGoalX(p.team);
    return Math.abs(p.x - gx) < PITCH.BOX_D && Math.abs(p.z) < PITCH.BOX_HW;
  }

  // ---------------------------------------------------------------- goalkeepers

  private gkCatch(gk: Pl): void {
    const b = this.ball;
    b.owner = gk.i;
    gk.state = 'hold';
    gk.t = 1.2 + this.rand() * 1.4;
    gk.vx = gk.vz = 0;
    this.prevToucher = b.lastPlayer;
    b.lastPlayer = gk.i;
    b.lastTeam = gk.team;
    for (const q of this.players) q.offside = 0;
    for (const h of this.humans) if (h.team === gk.team) this.autoSwitch(h, true, gk.i);
  }

  /** Shot-stopping: read the shot, dive if it's reachable, catch or parry. */
  private keepers(dt: number): void {
    const b = this.ball;
    for (const team of [0, 1] as const) {
      const gk = this.gkOf(team);
      if (gk.state === 'off') continue;
      // Holding: distribute after a moment (humans choose; AI throws or kicks).
      if (gk.state === 'hold') {
        gk.t -= dt;
        if (gk.human < 0 && gk.t <= 0) this.ai[team].distribute(gk);
        continue;
      }
      if (b.owner >= 0) continue;
      const gx = this.ownGoalX(team);
      const s = Math.sign(gx);
      const vToward = b.vx * s;
      if (vToward <= 2) continue;
      // Where does it cross the keeper's line, and when?
      const t = (gk.x - b.x) / b.vx;
      if (t <= 0 || t > 1.6) continue;
      const zc = b.z + b.vz * t;
      const yc = b.y + b.vy * t - 0.5 * G * t * t;
      // Heading at the goal (with a little margin)?
      const tLine = (gx - b.x) / b.vx;
      const zLine = b.z + b.vz * tLine;
      if (Math.abs(zLine) > PITCH.GOAL_HW + 1 || b.y + b.vy * tLine - 0.5 * G * tLine * tLine > PITCH.GOAL_H + 0.6) continue;
      if (this.gkShot.get(gk.i) === b.kickId) continue;
      this.gkShot.set(gk.i, b.kickId);
      if (b.lastTeam === team) continue;
      const shotKick = b.kickType === 'shot' || b.kickType === 'finesse' || b.kickType === 'chip' || b.kickType === 'penalty' || b.kickType === 'header';
      if (shotKick && Math.abs(zLine) < PITCH.GOAL_HW) this.stats[1 - team].onTarget++;
      const skill = gk.def.stats.gk * (gk.human < 0 ? this.diff() * (b.lastTeam === 1 && this.humans.some((h) => h.team === 0) ? 1 : 1) : 1);
      const react = 0.3 - skill * 0.0019;
      const avail = Math.max(0, t - react);
      const dz = zc - gk.z;
      const dy = Math.max(0, yc - 1.0);
      const dist = Math.hypot(dz, dy);
      const reach = 1.05 + avail * (3.2 + skill * 0.05);
      const speed = Math.hypot(b.vx, b.vy, b.vz);
      // A dive (or a step) towards it either way.
      if (dist > 0.7) {
        gk.state = 'dive';
        gk.t = 1.1;
        gk.dive = { dz: Math.sign(dz), dy: Math.min(1, dy / 1.4) };
        const dd = Math.min(dist, reach);
        gk.vx = 0;
        gk.vz = (dz / (dist || 1)) * (dd / Math.max(0.25, avail + 0.15));
      }
      if (dist <= reach) {
        // Saved: hold it if it's comfortable, else palm it away.
        const comfortable = speed < 16 + skill * 0.08 && dist < 1.4;
        if (comfortable && this.rand() < 0.35 + skill * 0.006) {
          this.saveLater(gk, t, true);
        } else this.saveLater(gk, t, false);
      }
    }
    // Pending saves resolve when the ball arrives.
    for (const sv of this.saves.splice(0)) {
      if (this.time >= sv.at) this.resolveSave(sv);
      else this.saves.push(sv);
    }
  }
  private saves: Array<{ gk: number; at: number; hold: boolean; kick: number }> = [];
  private saveLater(gk: Pl, t: number, hold: boolean): void {
    this.saves.push({ gk: gk.i, at: this.time + Math.max(0, t - 0.03), hold, kick: this.ball.kickId });
  }
  private resolveSave(sv: { gk: number; hold: boolean; kick: number }): void {
    const b = this.ball;
    const gk = this.players[sv.gk]!;
    if (b.owner >= 0 || b.kickId !== sv.kick) return;
    const s = Math.sign(this.ownGoalX(gk.team));
    // Already past him?
    if (Math.sign(b.x - gk.x) === s && Math.abs(b.x - gk.x) > 1.2) return;
    if (b.kickType === 'shot' || b.kickType === 'finesse' || b.kickType === 'chip' || b.kickType === 'penalty' || b.kickType === 'header') this.stats[gk.team].saves++;
    if (sv.hold) {
      this.gkCatch(gk);
      gk.state = 'dive';
      gk.t = 0.6;
      this.emit({ k: 'save', gk: gk.i, catch: true });
      // He'll hold it once he lands.
      this.later.push([this.time + 0.6, () => {
        if (b.owner === gk.i) {
          gk.state = 'hold';
          gk.t = 1.2;
        }
      }]);
      return;
    }
    // Parry: out wide (often for a corner) or back into play.
    const out = this.rand();
    const side = Math.sign(b.z - gk.z) || 1;
    if (Math.abs(b.z) > 1.4 && out < 0.45) {
      // Tipped round the post: it carries on behind for a corner.
      b.vx *= 0.35;
      b.vz = Math.sign(b.z) * (6 + out * 8);
      b.vy = 1.5 + out * 3;
    } else {
      b.vx = -b.vx * 0.25 + -s * 2;
      b.vz = side * (5 + out * 6);
      b.vy = 2 + out * 3;
    }
    b.lastTeam = gk.team;
    b.lastPlayer = gk.i;
    gk.noTouch = this.time + 0.6;
    this.emit({ k: 'save', gk: gk.i, catch: false });
  }

  // ---------------------------------------------------------------- the laws

  private lastConceded: 0 | 1 = 0;
  private lawsOfTheGame(): void {
    const b = this.ball;
    if (b.owner >= 0) {
      const o = this.players[b.owner]!;
      if (o.state === 'hold') return; // in the keeper's hands
      // Dribbled over a line: it's out (or in) off the carrier.
      if (Math.abs(b.x) <= PITCH.HL + BALL_R && Math.abs(b.z) <= PITCH.HW + BALL_R) return;
      b.owner = -1;
      b.lastTeam = o.team;
      b.lastPlayer = o.i;
    }
    // Goal: the whole ball over the line, between the posts, under the bar.
    if (Math.abs(b.x) > PITCH.HL + BALL_R && Math.abs(b.z) < PITCH.GOAL_HW && b.y < PITCH.GOAL_H) {
      const end = Math.sign(b.x);
      // The team attacking that end scores.
      const scorerTeam: 0 | 1 = this.dir[0] === end ? 0 : 1;
      const own = b.lastTeam !== scorerTeam;
      this.score[scorerTeam]++;
      const scorer = b.lastPlayer;
      const assist = !own && this.lastPass && this.lastPass.team === scorerTeam && this.lastPass.from !== scorer && this.prevToucher === this.lastPass.from ? this.lastPass.from : -1;
      this.goals.push({ team: scorerTeam, p: scorer, minute: this.minute + 1, own });
      this.emit({ k: 'goal', team: scorerTeam, scorer, assist, own, minute: this.minute + 1 });
      this.phase = 'goal';
      this.phaseT = 0;
      this.lastConceded = (1 - scorerTeam) as 0 | 1;
      const sc = this.players[scorer];
      if (sc && sc.team === scorerTeam) {
        sc.state = 'celebrate';
        sc.t = 4;
      }
      return;
    }
    // Over the touchline: throw-in to the other side.
    if (Math.abs(b.z) > PITCH.HW + BALL_R) {
      this.emit({ k: 'out', kind: 'throw' });
      this.setRestart('throw', (1 - b.lastTeam) as 0 | 1, Math.max(-PITCH.HL + 1, Math.min(PITCH.HL - 1, b.x)), Math.sign(b.z) * PITCH.HW);
      return;
    }
    // Over the goal line: corner or goal kick.
    if (Math.abs(b.x) > PITCH.HL + BALL_R) {
      const end = Math.sign(b.x);
      const defending: 0 | 1 = this.dir[0] === end ? 1 : 0;
      if (b.lastTeam === defending) {
        this.emit({ k: 'out', kind: 'corner' });
        this.setRestart('corner', (1 - defending) as 0 | 1, end * PITCH.HL, Math.sign(b.z || 1) * PITCH.HW);
      } else {
        this.emit({ k: 'out', kind: 'goalkick' });
        this.setRestart('goalkick', defending, end * (PITCH.HL - PITCH.SIX_D), Math.sign(b.z || 1) * 5);
      }
    }
  }

  private tickRestart(dt: number): void {
    const r = this.restart!;
    const taker = this.players[r.taker]!;
    // Hold the ball at the spot until it's taken.
    const b = this.ball;
    b.x = r.x;
    b.z = r.z;
    b.y = r.kind === 'throw' ? 1.95 : BALL_R;
    b.vx = b.vy = b.vz = 0;
    // A human taker gets 8 s before the AI takes it for them (no stalling online).
    if ((taker.human >= 0 && this.phaseT < 8) || taker.state !== 'run') return;
    if (this.phaseT < 0.6) return;
    r.wait -= dt;
    if (r.wait > 0) return;
    this.ai[r.team].takeRestart(taker, r);
  }
}

// ---------------------------------------------------------------- helpers

const ROLL_A = 0.9;
const ROLL_B = 0.06;
/** Distance a ground ball rolls while slowing from v0 to v1 (precomputed table). */
const ROLL_TABLE: number[] = (() => {
  // S[i] = distance to roll from speed i*0.1 down to 0.
  const out: number[] = [0];
  let s = 0;
  for (let i = 1; i <= 450; i++) {
    const v = i * 0.1;
    const dec = ROLL_A + ROLL_B * v + DRAG * v * v;
    s += (v * 0.1) / dec;
    out.push(s);
  }
  return out;
})();
const rollDist = (v: number) => ROLL_TABLE[Math.min(450, Math.max(0, Math.round(v * 10)))]!;
/** Kick speed for a ground ball to cover `d` metres and still be doing `arrive` m/s. */
export function rollSpeedFor(d: number, arrive: number): number {
  const need = d + rollDist(arrive);
  let lo = 0;
  let hi = 450;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ROLL_TABLE[mid]! < need) lo = mid + 1;
    else hi = mid;
  }
  return lo * 0.1;
}

export function turn(from: number, to: number, max: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-max, Math.min(max, d));
}

/** Flight time of a lofted ball over `d` metres (power makes it flatter and quicker). */
export function loftTime(d: number, power: number): number {
  return (0.85 + d * 0.032) * (1.15 - Math.max(0, Math.min(1, power)) * 0.3);
}

/** Air-only ball flight (same drag / curl as the match) until it comes down: landing point. */
function landing(x: number, y: number, z: number, vx: number, vy: number, vz: number, wy: number): [number, number] {
  const dt = 1 / 120;
  for (let i = 0; i < 1200; i++) {
    const v = Math.hypot(vx, vy, vz);
    const ax = -DRAG * v * vx + MAGNUS * wy * vz;
    const ay = -G - DRAG * v * vy;
    const az = -DRAG * v * vz - MAGNUS * wy * vx;
    vx += ax * dt;
    vy += ay * dt;
    vz += az * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    wy *= Math.exp(-dt * 0.5);
    if (y <= BALL_R && vy < 0) break;
  }
  return [x, z];
}

/** Launch velocity for a lofted ball to come down on (tx, tz) after about `t` seconds. */
export function loftTo(x0: number, y0: number, z0: number, tx: number, tz: number, t: number, wy: number): [number, number, number] {
  let ax = tx;
  let az = tz;
  let v: [number, number, number] = [0, 0, 0];
  for (let it = 0; it < 5; it++) {
    v = [(ax - x0) / t, 0.5 * G * t - (y0 - BALL_R) / t, (az - z0) / t];
    const [lx, lz] = landing(x0, y0, z0, v[0], v[1], v[2], wy);
    ax += tx - lx;
    az += tz - lz;
  }
  return v;
}
