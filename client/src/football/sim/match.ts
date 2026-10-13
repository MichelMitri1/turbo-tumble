import { CLUB, FORMATIONS, type Club, type FormationId, type PlayerDef, type Role } from './data';
import { TeamAI } from './ai';
import { cpuProfile, CPU_PROFILE, type CpuLevel, type CpuProfile } from './difficulty';
import { SKILL_BY_ID, SKILL_NAMES, skillPosition } from './skills';
import { cushionNet, type NetDimensions } from './net';
import { KEEPER_DIVE_TIME, KEEPER_SAVE_HEIGHT, keeperContact, keeperGeometry, keeperGrip, keeperHeight, type KeeperPoint } from './keeper';

/**
 * Matchday match engine: 22 players, a physical ball and the laws of the game.
 * Shared by the browser (vs CPU / local) and the server (online), stepped at 60 Hz.
 *
 * Coordinates in metres: x along the pitch (−52.5 … 52.5), z across (−34 … 34),
 * y up. Team 0 attacks +x in the first half; the ends swap at half time.
 */

export const PITCH = { HL: 52.5, HW: 34, GOAL_HW: 4.4, GOAL_H: 2.44, GOAL_D: 2.6, BOX_D: 16.5, BOX_HW: 20.16, SIX_D: 5.5, SIX_HW: 9.16, SPOT: 11, CIRCLE: 9.15 };
export const BALL_R = 0.11;
export const GOAL_NET: NetDimensions = { depth: PITCH.GOAL_D, halfWidth: PITCH.GOAL_HW, height: PITCH.GOAL_H, radius: BALL_R };
export const TICK = 1 / 60;
const G = 9.81;
export const DRAG = 0.0133; // ½ρCdA/m for a size-5 ball
const MAGNUS = 0.0045;
const POST_R = 0.06;
/** Celebration + replay before the restart (seconds). */
export const GOAL_PAUSE = 12.5;
/** Of the goal pause: the celebration (then the replay). */
export const CELEBRATE_T = 4.8;
/** Scorer's celebration (state time): sprint away, knee slide, then the pose. */
export const CELEB = { total: 6.4, slide: 4.5, pose: 3.6 };
/** Seconds of holding a button for full power (pass / shot / through / lob). */
export const CHARGE_TIME = 0.4;

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
  /** L2 held at our set piece: picking the taker; tkNext / tkPrev cycle through them (edge-triggered). */
  l2: boolean;
  tkNext: boolean;
  tkPrev: boolean;
  /** Skill move from a right-stick combo (0 = none, see TRICKS); fires when it changes. */
  trick: number;
  /** Right stick across the goal while facing a penalty: the keeper dives that way (pitch z sign, 0 = stay). */
  dive: number;
}
export const NO_INPUT: Input = { mx: 0, mz: 0, sprint: false, pass: false, shoot: false, through: false, lob: false, finesse: false, chip: false, switch: false, skill: false, l2: false, tkNext: false, tkPrev: false, trick: 0, dive: 0 };

/** Skill moves (right-stick combos): index = Input.trick. */
export const TRICKS = SKILL_NAMES;
/** A side's line-up from team management: formation, which squad member plays each slot, mentality (−1 … 1). */
export interface Lineup {
  formation: FormationId;
  xi: number[];
  mentality: number;
}

/** Set-piece taker attributes (what the taker picker shows), derived from the card's face stats. */
export function takerStats(s: PlayerDef['stats']): { power: number; accuracy: number; curve: number; pens: number } {
  return { power: Math.round(s.sho * 0.55 + s.phy * 0.45), accuracy: Math.round(s.sho * 0.6 + s.pas * 0.4), curve: Math.round(s.pas * 0.6 + s.dri * 0.4), pens: Math.round(s.sho * 0.8 + s.dri * 0.2) };
}
export type TakerKind = 'penalty' | 'fkShot' | 'fkPass' | 'corner';
/** What kind of set piece this is for picking a taker (a free kick in range is a shooting chance). */
export function takerKind(kind: RestartKind | null, x: number, z: number, attackDir: number): TakerKind | null {
  if (kind === 'penalty') return 'penalty';
  if (kind === 'corner') return 'corner';
  if (kind === 'free') return Math.hypot(attackDir * PITCH.HL - x, z) < 32 ? 'fkShot' : 'fkPass';
  return null;
}
/** How suited a player is to a set piece. */
export function takerRating(d: PlayerDef, k: TakerKind): number {
  const t = takerStats(d.stats);
  if (k === 'penalty') return t.pens;
  if (k === 'fkShot') return t.accuracy * 0.45 + t.curve * 0.35 + t.power * 0.2;
  return t.curve * 0.6 + d.stats.pas * 0.4;
}
/** Who can take it, best first (the same order on every client and on the server). */
export function takerCandidates<T extends { i: number; def: PlayerDef; role: Role; state: string }>(mates: T[], k: TakerKind, n = 5): T[] {
  return mates
    .filter((p) => p.role !== 'GK' && p.state !== 'off' && p.state !== 'down')
    .sort((a, c) => takerRating(c.def, k) - takerRating(a.def, k) || a.i - c.i)
    .slice(0, n);
}

export type KickType = 'pass' | 'through' | 'lob' | 'lobThrough' | 'cross' | 'shot' | 'finesse' | 'chip' | 'clear' | 'throw' | 'gkThrow' | 'header' | 'penalty' | 'power' | 'bicycle';
/** Shots at goal (for the keeper, the stats, blocks and the commentary). */
export const SHOT_KICKS: ReadonlySet<KickType | null> = new Set<KickType | null>(['shot', 'finesse', 'chip', 'penalty', 'header', 'power', 'bicycle']);
/** 'rise': getting back up after a slide tackle. */
export type PState = 'run' | 'kick' | 'tackle' | 'slide' | 'down' | 'dive' | 'hold' | 'celebrate' | 'off' | 'rise' | 'jump' | 'skill' | 'place';

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
  /** Dive: signed lateral amplitude (−1…1) and target height / KEEPER_SAVE_HEIGHT. */
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
  /** AI: face the ball while moving (keepers, jockeying defenders) instead of the way you run. */
  look: boolean;
  /** A skill move in progress: which (TRICKS index), its sideways direction and the facing it started from. */
  skill: { k: number; sx: number; sz: number; f0: number; dur: number } | null;
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

export type Phase = 'kickoff' | 'play' | 'stop' | 'goal' | 'halftime' | 'fulltime' | 'var';
/** How long a VAR review takes on screen (seconds). */
export const VAR_T = 7;
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
  | { k: 'net'; end: number; time: number; x: number; y: number; z: number; strength: number }
  | { k: 'tackle'; p: number; won: boolean; slide: boolean }
  | { k: 'foul'; by: number; on: number; card: 'yellow' | 'red' | null; penalty: boolean }
  | { k: 'offside'; p: number }
  | { k: 'whistle'; long: boolean }
  | { k: 'restart'; kind: RestartKind; team: 0 | 1 }
  | { k: 'out'; kind: RestartKind }
  | { k: 'half'; half: 1 | 2 }
  | { k: 'full' }
  | { k: 'switch'; human: number; p: number }
  | { k: 'chance'; team: 0 | 1 }
  | { k: 'added'; mins: number }
  | { k: 'trick'; p: number; trick: number }
  /**
   * VAR: a check starts (with the moment to look at: when the pass was played, the attacker's
   * and the second-last defender's x, the attacker's z), then it's confirmed or overturned.
   */
  | { k: 'var'; stage: 'check' | 'confirm' | 'overturn'; what: 'offside' | 'penalty'; at: number; ax: number; dx: number; az: number; team: 0 | 1 };

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
  /** `power`: R1 + L1 were held while charging ○ (a power shot). */
  charge: { btn: 'pass' | 'shoot' | 'through' | 'lob'; t: number; power: boolean } | null;
  last: Input;
  /** A pass / shot asked for before the ball arrived (first-time). */
  queued: { type: KickType; power: number; until: number; ax: number; az: number } | null;
  /** No auto-switching until this time (just switched by hand). */
  lock: number;
  /** Receiving our pass: the stick at the moment it was played, and whether you've taken over. */
  recv: { id: number; sx: number; sz: number; manual: boolean; off: number } | null;
  /** Set-piece target (corners, free kicks, goal kicks): moved with the stick. */
  aim: { x: number; z: number } | null;
  /** Holding L2 at our set piece: choosing who takes it. */
  picking: boolean;
}

export interface MatchOptions {
  home: string;
  away: string;
  /** Real seconds per half (the clock shows 45 minutes over that). */
  halfSeconds: number;
  difficulty: CpuLevel;
  seed?: number;
  /** Team management: each side's formation / XI / mentality (default: the club's own). */
  lineups?: [Lineup | null, Lineup | null];
  /** Untimed practice: no offsides or disciplinary stoppages. */
  training?: boolean;
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
  private foulPause: { until: number; resume: () => void } | null = null;
  /** Held △ while defending: that team's keeper rushes out (until this time). */
  readonly gkRush: [number, number] = [0, 0];
  /** Held R1 while defending: a second team-mate presses the carrier (until this time). */
  readonly teamPress: [number, number] = [0, 0];
  /** The keeper's read of a shot: he shuffles across to `z`, then dives / blocks at the right moment. */
  readonly gkTrack: [{ z: number; until: number } | null, { z: number; until: number } | null] = [null, null];
  /** Last time each keeper tried to smother at an attacker's feet. */
  private smotherAt = [-9, -9];
  /** The ball was last gained at (first touch: it settles rather than snapping to the feet). */
  private gainedAt = -9;
  /** The defensive wall at the current free kick. */
  private wall: number[] = [];
  /** Team that struck the ball last (a touch / deflection doesn't change it). */
  private kickTeam: 0 | 1 = 0;
  private kickPlayer = -1;
  /** Offside margins at the moment of each pass, per team-mate (+ = offside, by how many metres). */
  private passMargins = new Map<number, { at: number; m: Map<number, { margin: number; x: number; z: number; line: number }> }>();
  /** This attack so far: every received pass and how tight the offside was (cleared when the ball changes hands). */
  private chain: Array<{ margin: number; at: number; ax: number; dx: number; az: number }> = [];
  private chainTeam: 0 | 1 = 0;
  /** A decision waiting for the VAR. */
  private varPending: { what: 'offside' | 'penalty'; overturn: boolean; at: number; ax: number; dx: number; az: number; team: 0 | 1; then: (overturn: boolean) => void } | null = null;
  /** Each side's shape and mentality (−1 defensive … 1 attacking). */
  readonly formations: [FormationId, FormationId];
  readonly mentality: [number, number] = [0, 0];
  /** Time lost to stoppages this half (game seconds) and the added minutes once the board goes up. */
  private lost = 0;
  added = 0;
  /** A human's chosen dive at a penalty against them (pitch z sign; 0 = stay in the middle). */
  private penDive: [number, number] = [0, 0];

  constructor(opts: MatchOptions) {
    this.opts = opts;
    let s = (opts.seed ?? Date.now()) >>> 0 || 1;
    this.rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    this.clubs = [CLUB[opts.home]!, CLUB[opts.away]!];
    const st = (): TeamStats => ({ shots: 0, onTarget: 0, possession: 0, passes: 0, passesDone: 0, fouls: 0, corners: 0, offsides: 0, yellows: 0, saves: 0 });
    this.stats = [st(), st()];
    const lu = opts.lineups ?? [null, null];
    this.formations = [lu[0]?.formation ?? this.clubs[0].formation, lu[1]?.formation ?? this.clubs[1].formation];
    for (const team of [0, 1] as const) {
      const club = this.clubs[team];
      const xi = lu[team]?.xi;
      this.mentality[team] = Math.max(-1, Math.min(1, lu[team]?.mentality ?? 0));
      FORMATIONS[this.formations[team]].forEach((slot, k) => {
        const def = club.players[xi?.[k] ?? k] ?? club.players[k]!;
        this.players.push({ i: this.players.length, team, slot: k, def, role: slot.role, x: 0, z: 0, vx: 0, vz: 0, face: 0, state: 'run', t: 0, kick: null, noTouch: 0, human: -1, sprint: false, dive: null, yellow: 0, offside: 0, tx: 0, tz: 0, tSprint: false, leftFoot: def.left, look: false, skill: null });
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
    const h: Human = { id, team, p: -1, charge: null, last: { ...NO_INPUT }, queued: null, lock: 0, recv: null, aim: null, picking: false };
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
    return cpuProfile(this.opts.difficulty).skill;
  }
  /** Human teammates stay competent while the chosen level controls CPU opponents. */
  botProfile(team: 0 | 1): CpuProfile {
    return this.humans.some((h) => h.team === team) ? CPU_PROFILE.pro : cpuProfile(this.opts.difficulty);
  }

  /** Clear an attempt without constructing another match or changing its clock. */
  resetPractice(): void {
    if (!this.opts.training) return;
    this.phase = 'play'; this.phaseT = 0; this.restart = null; this.clock = 0; this.foulPause = null;
    this.netIn = 0; this.netFaces = 0;
    this.lastPass = null; this.varPending = null; this.chain.length = 0; this.passMargins.clear();
    this.gkPlan = [null, null]; this.gkTrack[0] = this.gkTrack[1] = null; this.later.length = 0;
    this.gkRush[0] = this.gkRush[1] = 0; this.teamPress[0] = this.teamPress[1] = 0;
    this.events.length = 0;
    Object.assign(this.ball, { owner: -1, y: BALL_R, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, kickType: null });
    for (const p of this.players) Object.assign(p, { state: 'off', human: -1, vx: 0, vz: 0, t: 0, kick: null, skill: null, dive: null, noTouch: 0, yellow: 0, offside: 0 });
    for (const h of this.humans) Object.assign(h, { charge: null, queued: null, recv: null, aim: null, lock: this.time + 10000, last: { ...NO_INPUT } });
  }
  practiceRestart(kind: 'free' | 'penalty', x: number, z: number): void {
    if (this.opts.training) this.setRestart(kind, 0, x, z);
  }

  // ---------------------------------------------------------------- restarts

  /** Out-of-possession back line, measured towards the opponent's goal. The
   * block steps up with play and enters our box only when the attack reaches it. */
  defensiveLine(team: 0 | 1, bx: number): number {
    return Math.max(-PITCH.HL + 8, Math.min(2, -18 + bx * this.dir[team] * 0.5 + this.mentality[team] * 3));
  }

  /** Formation spot of a player in the current shape (x shift by ball, attacking or not). */
  formationSpot(p: Pl, bx: number, bz: number, attacking: boolean): [number, number] {
    const slots = FORMATIONS[this.formations[p.team]];
    const slot = slots[p.slot]!;
    const s = this.dir[p.team];
    // Block moves up/down the pitch with the ball (in team-relative coordinates).
    const ballRel = bx * s; // −52 … 52 (own goal … their goal)
    // (Mentality pushes the whole block up or drops it off.)
    const shift = Math.max(-18, Math.min(30, ballRel * 0.55 + (attacking ? 9 : -5) + this.mentality[p.team] * 4));
    let rx = slot.x * 42 + shift;
    if (!attacking) {
      const backs = slots.filter((q) => q.role === 'CB');
      const baseLine = backs.reduce((sum, q) => sum + q.x * 42, 0) / backs.length;
      rx = slot.x * 42 + this.defensiveLine(p.team, bx) - baseLine;
    }
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
    // (The start of a half gets the full kick-off sequence on screen first.)
    this.restart = { kind: 'kickoff', team, x: 0, z: 0, taker: k1.i, wait: this.clock === 0 || this.clock === 45 * 60 ? 3.4 : 2.2 };
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
    this.penDive = [0, 0];
    const s = this.dir[team];
    // Taker: keeper for goal kicks, best passer/shooter for set pieces, nearest for throws.
    const mates = this.teamPlayers(team).filter((p) => p.state !== 'down');
    let taker: Pl;
    // (Penalties, corners and free kicks: the side's specialist, the top of the taker picker's list.)
    const tk = takerKind(kind, x, z, s);
    const spec = tk && (kind !== 'free' || tk === 'fkShot') ? takerCandidates(mates, tk)[0] : undefined;
    if (kind === 'goalkick') taker = this.gkOf(team);
    else if (spec) taker = spec;
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
        this.wall = wall.map((p) => p.i);
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
    if (kind === 'free' || kind === 'penalty') { taker.state = 'place'; taker.t = 1.4; }
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
    if (this.foulPause) {
      const pause = this.foulPause;
      this.lost += ((45 * 60) / this.opts.halfSeconds) * dt * 0.4;
      for (const p of this.players) {
        if (p.state === 'off') continue;
        this.tickState(p, dt);
        this.movePlayer(p, dt, 0, 0, false);
      }
      if (this.time >= pause.until) { this.foulPause = null; pause.resume(); }
      return;
    }
    if (this.phase === 'halftime') {
      if (this.phaseT > 9) {
        this.half = 2;
        this.dir = [-1, 1];
        this.lost = 0;
        this.added = 0;
        this.setKickoff((1 - this.kickoffTeam) as 0 | 1);
        this.emit({ k: 'half', half: 2 });
      }
      return;
    }
    if (this.phase === 'var') {
      // Everyone waits on the VAR (walking back, hands on hips).
      this.ai[0].update(dt);
      this.ai[1].update(dt);
      for (const p of this.players) {
        if (p.state === 'off') continue;
        if (p.state !== 'run' && p.state !== 'hold') {
          p.t -= dt;
          if (p.t <= 0) {
            p.state = 'run';
            p.kick = null;
            p.dive = null;
          }
        }
        this.movePlayer(p, dt, p.tx - p.x, p.tz - p.z, false, true);
      }
      this.collidePlayers();
      if (this.phaseT >= VAR_T) this.resolveVar();
      return;
    }
    if (this.phase === 'goal') {
      // The scorer wheels away, his team-mates chase him down, the other lot trudge back.
      this.ai[0].update(dt);
      this.ai[1].update(dt);
      for (const p of this.players) {
        if (p.state === 'off') continue;
        if (p.state !== 'run' && p.state !== 'hold') {
          p.t -= dt;
          if (p.t <= 0) {
            p.state = 'run';
            p.kick = null;
            p.dive = null;
          }
        }
        this.movePlayer(p, dt, p.tx - p.x, p.tz - p.z, p.tSprint, true);
      }
      this.collidePlayers();
      if (this.phaseT >= GOAL_PAUSE) {
        if (this.varPending) this.startVar();
        else this.setKickoff(this.lastConceded);
      }
      this.stepBall(dt);
      return;
    }
    // Time lost to stoppages (restarts, celebrations, the VAR) comes back as added time.
    if (this.phase !== 'play' && !(this.phase === 'kickoff' && (this.clock === 0 || this.clock === 45 * 60))) this.lost += ((45 * 60) / this.opts.halfSeconds) * dt * 0.4;
    // Clock: 45 minutes per half over `halfSeconds`, running in play.
    if (this.phase === 'play') {
      if (!this.opts.training) this.clock += (45 * 60 * dt) / this.opts.halfSeconds;
      const regular = this.half * 45 * 60;
      // The fourth official's board goes up in the last minute.
      if (!this.added && this.clock >= regular - 60) {
        this.added = Math.max(1, Math.min(9, Math.round(this.lost / 60)));
        this.emit({ k: 'added', mins: this.added });
      }
      const end = regular + this.added * 60;
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
    if (!this.opts.training) this.ai[0].update(dt);
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
    // Celebrating: free to run until the knee slide, then it's momentum and the pose.
    const celebRun = p.state === 'celebrate' && p.t > CELEB.slide;
    const busy = p.state === 'place' || p.state === 'down' || p.state === 'rise' || p.state === 'dive' || p.state === 'slide' || p.state === 'jump' || p.state === 'skill' || (p.state === 'celebrate' && !celebRun);
    const pac = p.def.stats.pac;
    const hasBall = this.ball.owner === p.i;
    const jog = 6.0 + pac * 0.008;
    let top = sprint ? 7.6 + pac * 0.028 : jog;
    if (hasBall) top *= 0.88 + p.def.stats.dri * 0.0009;
    if (p.state === 'kick' || p.state === 'tackle') top *= 0.45;
    if (p.look && p.human < 0 && Math.hypot(dx, dz) > 0.01) {
      // Backpedalling / shuffling sideways is slower than running forwards.
      const fwd = (Math.cos(p.face) * dx - Math.sin(p.face) * dz) / Math.hypot(dx, dz);
      top *= fwd < -0.3 ? 0.68 : fwd < 0.5 ? 0.82 : 1;
    }
    let wx = 0;
    let wz = 0;
    const len = Math.hypot(dx, dz);
    if (!busy && len > 0.01) {
      // To a target: slow into it; as a stick direction: full speed by stick amount.
      // (Keepers set themselves sharply: small, quick steps into position.)
      const sp = toTarget ? Math.min(top, len * (p.role === 'GK' ? 4.5 : 2.2)) : top * Math.min(1, len);
      wx = (dx / len) * sp;
      wz = (dz / len) * sp;
    }
    if (p.state === 'skill') {
      // A skill move: its velocity is scripted (see skillTick).
    } else if (p.state === 'tackle') {
      // The lunge carries him in, then he plants.
      const k = Math.exp(-dt * 5);
      p.vx *= k;
      p.vz *= k;
    } else if (p.state === 'slide') {
      // Sliding: momentum only, slowing down.
      const k = Math.exp(-dt * 1.4);
      p.vx *= k;
      p.vz *= k;
    } else if (p.state === 'down' || p.state === 'rise' || p.state === 'dive' || (p.state === 'celebrate' && !celebRun)) {
      const k = Math.exp(-dt * (p.state === 'dive' ? 1.5 : p.state === 'celebrate' ? (p.t > CELEB.pose ? 1.1 : 7) : 6));
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
      else if (p.human < 0 && p.look && !hasBall) {
        // Keepers and jockeying defenders keep their eyes on the ball: shuffle / backpedal.
        const b = this.ball;
        p.face = turn(p.face, Math.atan2(-(b.z - p.z), b.x - p.x), 12 * dt);
      }
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
    if (p.state === 'skill') this.skillTick(p);
    if (p.state === 'tackle' && p.t < 0.37 && p.t > 0.1) this.tackleContact(p);
    if (p.t <= 0) {
      if (p.state === 'slide') {
        // Back on your feet (not a fall: that's only for whoever got fouled).
        p.state = 'rise';
        p.t = 0.4;
        return;
      }
      if (p.state === 'hold') return; // the keeper decides
      if (p.state === 'skill') this.skillEnd(p);
      p.state = 'run';
      p.kick = null;
      p.dive = null;
      p.skill = null;
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
    // Their pass on its way: you get whoever can cut it out first (not just the nearest to the ball now).
    const theirs = b.owner < 0 && b.lastTeam !== h.team && b.kickType !== null && Math.hypot(b.vx, b.vz) > 4;
    const ai = this.ai[h.team];
    let best: Pl | null = null;
    let bd = Infinity;
    for (const q of this.teamPlayers(h.team)) {
      if (q.role === 'GK' || q.state === 'down' || this.humans.some((x) => x !== h && x.p === q.i)) continue;
      const d = theirs ? ai.intercept(q).t * 7 : Math.hypot(q.x - bx, q.z - bz);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    // A little hysteresis so control doesn't flicker between two players.
    const mine = theirs ? ai.intercept(p).t * 7 : Math.hypot(p.x - bx, p.z - bz);
    if (best && best !== p && bd < mine - (theirs ? 2.5 : 1.2)) this.autoSwitch(h, true, best.i);
  }

  private humanTick(h: Human, inp: Input, dt: number): void {
    const p = this.players[h.p];
    if (!p) return;
    const b = this.ball;
    const hasBall = b.owner === p.i;
    const myRestart = this.restart && this.restart.taker === p.i && (this.phase === 'stop' || this.phase === 'kickoff');
    if (p.state === 'place') { h.charge = null; h.last = { ...inp }; return; }
    // Our free kick / penalty / corner: hold L2 to pick the taker (◀ ▶ cycles through them).
    const tk = myRestart ? takerKind(this.restart!.kind, this.restart!.x, this.restart!.z, this.dir[h.team]) : null;
    h.picking = !!tk && inp.l2;
    if (h.picking) {
      const step = inp.tkNext && !h.last.tkNext ? 1 : inp.tkPrev && !h.last.tkPrev ? -1 : 0;
      if (step) this.changeTaker(h, tk!, step);
      h.charge = null;
      h.last = { ...inp };
      return;
    }
    // Facing a penalty: the right stick picks the keeper's dive (left / right; leave it to stay in the middle).
    const theirPen = (this.restart?.kind === 'penalty' && this.restart.team !== h.team) || (this.phase === 'play' && b.kickType === 'penalty' && this.kickTeam !== h.team && this.time - b.kickAt < 0.2);
    if (theirPen && inp.dive) this.penDive[h.team] = Math.sign(inp.dive);
    // Their free kick: △ makes our wall jump (time it with the strike — too early and it goes under).
    const theirFk = (this.restart?.kind === 'free' && this.restart.team !== h.team && this.phase === 'stop') || (this.phase === 'play' && this.kickTeam !== h.team && this.time - b.kickAt < 0.5 && (b.kickType === 'shot' || b.kickType === 'finesse'));
    if (theirFk && inp.through && !h.last.through) this.wallJump(h.team);
    // Switching (manual): the team-mate nearest the ball; press again to cycle to the next nearest.
    // (Not while a pass to you is on its way and R1 is held: that's L1 for a first-time power shot.)
    const passToMe = b.owner < 0 && this.lastPass?.team === h.team && this.lastPass.to === p.i && b.kickId === this.lastPass.id;
    if (inp.switch && !h.last.switch && !hasBall && !myRestart && !(passToMe && inp.finesse)) {
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
    // Defending (they have it, or it's loose off their boot): hold △ = keeper rushes out,
    // hold R1 = a team-mate presses the carrier too.
    const defending = !myRestart && this.phase === 'play' && (b.owner >= 0 ? !attacking : b.lastTeam !== h.team && b.kickType !== null);
    if (defending && inp.through) this.gkRush[h.team] = this.time + 0.1;
    if (defending && inp.finesse) this.teamPress[h.team] = this.time + 0.1;
    // Buttons: charge on press, act on release (power = hold time).
    const btns = ['pass', 'shoot', 'through', 'lob'] as const;
    for (const k of btns) {
      if (k === 'through' && (defending || theirFk)) continue;
      if (inp[k] && !h.last[k] && !h.charge) h.charge = { btn: k, t: 0, power: false };
    }
    if (h.charge) {
      h.charge.t += dt;
      // R1 + L1 held at any point while charging ○: it's a power shot.
      if (h.charge.btn === 'shoot' && inp.chip && inp.finesse) h.charge.power = true;
    }
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
    // A restart can't be taken the instant it's given (and a kick-off waits for the whistle).
    const early = myRestart && this.phaseT < (this.restart!.kind === 'kickoff' ? 1.2 : 0.5);
    if (released && h.charge && early) h.charge = null;
    if (released && h.charge) {
      // A tap still plays a proper ball; holding builds to full power.
      let power = Math.max(h.charge.btn === 'shoot' ? 0.1 : 0.18, Math.min(1, h.charge.t / CHARGE_TIME));
      let type: KickType =
        h.charge.btn === 'pass' ? 'pass' : h.charge.btn === 'through' ? (inp.chip ? 'lobThrough' : 'through') : h.charge.btn === 'lob' ? (Math.abs(cur.z) > 18 && Math.abs(cur.x - this.dir[cur.team] * PITCH.HL) < 32 ? 'cross' : 'lob') : h.charge.power || (inp.chip && inp.finesse) ? 'power' : inp.chip ? 'chip' : inp.finesse ? 'finesse' : 'shot';
      h.charge = null;
      if (myRestart && this.restart!.kind === 'throw') type = 'throw';
      // From the keeper's hands: ✕ / △ = throw it out (hold ✕ for a long one), ○ / □ = kick it long.
      const fromHands = hasBall && cur.state === 'hold';
      if (fromHands) type = type === 'pass' || type === 'through' || type === 'lobThrough' ? 'gkThrow' : 'lob';
      if (myRestart && this.restart!.kind === 'penalty') type = 'penalty';
      if (myRestart && this.restart!.kind === 'corner' && h.charge === null && type === 'lob') type = 'cross';
      let [ax, az] = Math.hypot(inp.mx, inp.mz) > 0.3 ? [inp.mx, inp.mz] : [Math.cos(cur.face), -Math.sin(cur.face)];
      const spot = myRestart && h.aim ? { ...h.aim } : undefined;
      if (spot) [ax, az] = [spot.x - b.x, spot.z - b.z];
      if ((spot && type === 'shot') || (spot && type === 'finesse') || (spot && type === 'power')) {
        // Free kick at goal: the marker picks the spot across the goal.
        if (Math.abs(spot.x - this.dir[cur.team] * PITCH.HL) < 8) az = Math.max(-1, Math.min(1, spot.z / 3.6));
        else [ax, az] = [ax, 0];
      }
      let kickTo = -1;
      if (myRestart && this.restart!.kind === 'kickoff') {
        // Kick-off: it goes to a team-mate in our half — never forward to the other side.
        const s = this.dir[cur.team];
        const mates = this.teamPlayers(cur.team).filter((q) => q !== cur && q.role !== 'GK' && q.state === 'run' && q.x * s < 0.3);
        const al = Math.hypot(ax, az) || 1;
        let best: Pl | null = null;
        let bs = Infinity;
        for (const q of mates) {
          const d = Math.hypot(q.x - b.x, q.z - b.z) || 1;
          const cos = ((q.x - b.x) * ax + (q.z - b.z) * az) / (d * al);
          const sc = d * (1 + (1 - cos) * 3);
          if (sc < bs) {
            bs = sc;
            best = q;
          }
        }
        if (best) {
          type = 'pass';
          [ax, az] = [best.x - b.x, best.z - b.z];
          power = Math.min(power, 0.55);
          kickTo = best.i;
        }
      }
      if (hasBall || (myRestart && (this.phase === 'stop' || this.phase === 'kickoff'))) {
        this.startKick(cur, type, power, ax, az, false, spot);
        if (kickTo >= 0 && cur.kick) cur.kick.target = kickTo;
        if (fromHands && cur.kick) this.keeperRelease(cur, type, power, ax, az);
      } else h.queued = { type, power, until: this.time + 0.7, ax, az }; // first-time, when the ball arrives
    }
    // Keeper: drop the ball at your feet (knock-on button) and play it with your feet.
    if (inp.skill && !h.last.skill && hasBall && cur.state === 'hold') {
      cur.state = 'run';
      cur.t = 0;
      h.last = { ...inp };
      return;
    }
    // Skill moves (right-stick combos / keys).
    if (inp.trick > 1 && inp.trick !== h.last.trick && hasBall && cur.state === 'run') this.doTrick(cur, inp.trick, inp.mx, inp.mz);
    // Knock-on (push the ball ahead and chase it).
    if (((inp.skill && !h.last.skill) || (inp.trick === 1 && h.last.trick !== 1)) && hasBall && cur.state === 'run') {
      this.doTrick(cur, 1, inp.mx, inp.mz);
    }
    if (!myRestart) {
      h.aim = null;
      let [mx, mz, sprint] = [inp.mx, inp.mz, inp.sprint];
      // Their pass on its way and ✕ held: go and cut it out (meet it on its path).
      if (b.owner < 0 && b.lastTeam !== h.team && b.kickType !== null && inp.pass && cur.state === 'run') {
        h.charge = null;
        const r = this.ai[h.team].intercept(cur);
        const dx = r.x - cur.x;
        const dz = r.z - cur.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.15) [mx, mz] = [(dx / d) * Math.min(1, d / 0.8), (dz / d) * Math.min(1, d / 0.8)];
        sprint = d > 1.5;
      }
      // Receiving a pass: run onto it automatically (you take over as soon as you move the
      // stick somewhere new — just holding the direction you were dribbling doesn't count).
      const lp = this.lastPass;
      const incoming = b.owner < 0 && lp && lp.team === h.team && b.kickId === lp.id && lp.to === cur.i && cur.state === 'run';
      if (incoming) {
        if (!h.recv || h.recv.id !== lp.id) h.recv = { id: lp.id, sx: inp.mx, sz: inp.mz, manual: false, off: 0 };
        const sl = Math.hypot(inp.mx, inp.mz);
        const rl = Math.hypot(h.recv.sx, h.recv.sz);
        const same = sl < 0.3 || (rl > 0.3 && (inp.mx * h.recv.sx + inp.mz * h.recv.sz) / (sl * rl) > 0.5);
        // You take over only by pushing the stick somewhere new and meaning it (a moment, not a twitch).
        h.recv.off = same ? 0 : h.recv.off + dt;
        if (h.recv.off > 0.18) h.recv.manual = true;
        if (!h.recv.manual) {
          // He comes to meet the ball: the earliest point on its path he can get to, at full tilt.
          const r = this.ai[h.team].intercept(cur);
          const dx = r.x - cur.x;
          const dz = r.z - cur.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.15) {
            mx = (dx / d) * Math.min(1, d / 0.8);
            mz = (dz / d) * Math.min(1, d / 0.8);
          } else mx = mz = 0;
          sprint = d > 1.5;
        }
      } else h.recv = null;
      this.movePlayer(cur, dt, mx, mz, sprint);
      // Waiting for it: open up to the ball.
      if (incoming && !h.recv?.manual && Math.hypot(cur.vx, cur.vz) < 1.5) cur.face = turn(cur.face, Math.atan2(-(b.z - cur.z), b.x - cur.x), dt * 14);
    } else {
      const kind = this.restart!.kind;
      if (early) {
        // (Placing the ball.)
      } else if (kind === 'corner' || kind === 'free' || kind === 'goalkick') {
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
      if (hasBall || (b.owner < 0 && d < 1.2 && b.y < 2.6 && this.time >= cur.noTouch)) {
        // In the air: a header — or, with your back to goal and a shot asked for, an overhead kick.
        let type = h.queued.type;
        if (!hasBall && b.y > 1.0) {
          const s = this.dir[cur.team];
          const toGoal = Math.cos(cur.face) * s;
          const shot = type === 'shot' || type === 'finesse' || type === 'power' || type === 'chip';
          type = shot && b.y > 1.2 && b.y < 2.3 && toGoal < -0.15 && Math.abs(s * PITCH.HL - b.x) < 30 ? 'bicycle' : 'header';
        }
        this.startKick(cur, type, h.queued.power, h.queued.ax, h.queued.az, true);
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

  /** L2 + ◀ ▶ at our set piece: hand it to the next (or previous) man on the taker list. */
  private changeTaker(h: Human, k: TakerKind, step: number): void {
    const r = this.restart!;
    const pool = this.teamPlayers(h.team).filter((q) => q.i === r.taker || !this.humans.some((x) => x !== h && x.p === q.i));
    const list = takerCandidates(pool, k);
    if (list.length < 2) return;
    const at = list.findIndex((q) => q.i === r.taker);
    const next = list[at < 0 ? 0 : (at + step + list.length) % list.length]!;
    const old = this.players[r.taker]!;
    if (next === old) return;
    // They swap places: the new man steps up to the ball.
    [old.x, next.x] = [next.x, old.x];
    [old.z, next.z] = [next.z, old.z];
    [old.face, next.face] = [next.face, old.face];
    old.vx = old.vz = next.vx = next.vz = 0;
    r.taker = next.i;
    this.autoSwitch(h, true, next.i);
    // Fresh clock for the new taker (the CPU doesn't take it for you while you choose).
    this.phaseT = Math.min(this.phaseT, 2);
  }

  /** The keeper letting it go from his hands: a long throw (hold ✕) finds a man further up; a kick (○ / □) goes long. */
  private keeperRelease(gk: Pl, type: KickType, power: number, ax: number, az: number): void {
    const k = gk.kick!;
    const al = Math.hypot(ax, az) || 1;
    const [ux, uz] = [ax / al, az / al];
    if (type === 'gkThrow' && power > 0.55) {
      // Hard press: over the near men to a team-mate further up the pitch in that direction.
      const far = this.teamPlayers(gk.team)
        .filter((q) => q !== gk && q.state === 'run')
        .map((q) => ({ q, d: Math.hypot(q.x - gk.x, q.z - gk.z), cos: ((q.x - gk.x) * ux + (q.z - gk.z) * uz) / (Math.hypot(q.x - gk.x, q.z - gk.z) || 1) }))
        .filter((c) => c.cos > 0.6 && c.d > 15 && c.d < 22 + power * 26)
        .sort((a, c) => c.d - a.d)[0];
      if (far) k.target = far.q.i;
    }
    if (type === 'lob') {
      // A kick from the hands: long and high towards that side (power = distance), to the man nearest the drop.
      const d = 35 + power * 32;
      const tx = Math.max(-PITCH.HL + 3, Math.min(PITCH.HL - 3, gk.x + ux * d));
      const tz = Math.max(-PITCH.HW + 3, Math.min(PITCH.HW - 3, gk.z + uz * d));
      k.tx = tx;
      k.tz = tz;
      k.target = -1;
      k.power = Math.max(power, 0.7);
    }
  }

  /** Start a skill move on the ball (side: from the stick, else a coin toss). Poorer dribblers can fluff it. */
  doTrick(p: Pl, k: number, mx: number, mz: number): void {
    const move = SKILL_BY_ID.get(k);
    if (!move) return;
    if (p.state !== 'run' || this.ball.owner !== p.i) return;
    const b = this.ball;
    const fx = Math.cos(p.face);
    const fz = -Math.sin(p.face);
    // Sideways (perpendicular to his facing), towards where the stick points.
    const lat = mx * -fz + mz * fx;
    const side = k > 7 ? 1 : Math.abs(lat) > 0.2 ? Math.sign(lat) : this.rand() < 0.5 ? -1 : 1;
    const [sx, sz] = [-fz * side, fx * side];
    this.emit({ k: 'trick', p: p.i, trick: k });
    if (k === 1) {
      b.owner = -1; b.vx = p.vx + fx * 8; b.vz = p.vz + fz * 8; p.noTouch = this.time + 0.35;
      return;
    }
    if (!this.opts.training && this.rand() > 0.62 + p.def.stats.dri * 0.0042 - (k > 7 ? (move.stars - 1) * 0.035 : 0)) {
      // Fluffed: a heavy touch, the ball squirms away.
      b.owner = -1;
      b.vx = p.vx * 0.6 + fx * 3 + (this.rand() - 0.5) * 3;
      b.vz = p.vz * 0.6 + fz * 3 + (this.rand() - 0.5) * 3;
      p.noTouch = this.time + 0.25;
      this.emit({ k: 'touch', p: p.i, heavy: true });
      return;
    }
    if (k > 7) {
      p.state = 'skill';
      p.skill = { k, sx, sz, f0: p.face, dur: move.duration };
      p.t = move.duration;
      if (move.lift) {
        b.owner = -1; b.vx = fx * (move.family === 'rainbow' ? 5 : 2.5) + p.vx * 0.3;
        b.vz = fz * (move.family === 'rainbow' ? 5 : 2.5) + p.vz * 0.3; b.vy = move.lift; b.y = Math.max(0.25, b.y);
        b.lastPlayer = p.i; b.lastTeam = p.team; p.noTouch = this.time + 0.25;
      }
      return;
    }
    if (k === 4 || k === 5) {
      // Flick up (over a lunging leg) / rainbow (up the back of the leg, over his own head and the defender's).
      const rain = k === 5;
      b.owner = -1;
      b.vx = p.vx * (rain ? 0.4 : 0.8) + fx * (rain ? 7 : 2);
      b.vz = p.vz * (rain ? 0.4 : 0.8) + fz * (rain ? 7 : 2);
      b.vy = rain ? 6.2 : 4;
      b.y = Math.max(b.y, 0.25);
      b.lastPlayer = p.i;
      b.lastTeam = p.team;
      p.noTouch = this.time + (rain ? 0.4 : 0.25);
      p.state = 'skill';
      p.skill = { k, sx, sz, f0: p.face, dur: rain ? 0.42 : 0.3 };
      p.t = p.skill.dur;
      return;
    }
    const dur = k === 2 ? 0.42 : k === 3 ? 0.5 : k === 6 ? 0.6 : 0.42;
    p.state = 'skill';
    p.skill = { k, sx, sz, f0: p.face, dur };
    p.t = dur;
  }

  /** A skill move in progress: the footwork moves him (the ball stays at his feet). */
  private skillTick(p: Pl): void {
    const sk = p.skill;
    if (!sk) return;
    const u = 1 - Math.max(0, p.t) / sk.dur;
    const fx = Math.cos(sk.f0);
    const fz = -Math.sin(sk.f0);
    let vx = 0;
    let vz = 0;
    if (sk.k > 7) {
      const move = SKILL_BY_ID.get(sk.k)!;
      const a = skillPosition(move, Math.max(0, u - 0.015)), b = skillPosition(move, Math.min(1, u + 0.015));
      const dt = Math.max(0.001, (b.at - a.at) * sk.dur);
      const lateral = sk.sx * -fz + sk.sz * fx;
      const f = (b.forward - a.forward) / dt, l = (b.lateral - a.lateral) / dt;
      p.vx = fx * f - fz * l * lateral;
      p.vz = fz * f + fx * l * lateral;
      p.face = sk.f0 - skillPosition(move, u).turn * lateral;
      return;
    }
    if (sk.k === 2) {
      // Drag back: stop it under the sole and turn away with it.
      p.face = sk.f0 + Math.PI * Math.min(1, u * 1.3) * (sk.sx * fz - sk.sz * fx > 0 ? 1 : -1);
      vx = -fx * 1.2 * (1 - u);
      vz = -fz * 1.2 * (1 - u);
    } else if (sk.k === 3) {
      // Step-over: the shimmy one way… then away the other at pace.
      if (u < 0.6) [vx, vz] = [fx * 2.2 - sk.sx * 1.2, fz * 2.2 - sk.sz * 1.2];
      else [vx, vz] = [fx * 3 + sk.sx * 6.5, fz * 3 + sk.sz * 6.5];
    } else if (sk.k === 6) {
      // Roulette: a full turn over the ball, rolling round the defender.
      p.face = sk.f0 + Math.PI * 2 * u * (sk.sx * fz - sk.sz * fx > 0 ? -1 : 1);
      [vx, vz] = [fx * 2 + sk.sx * 3.6, fz * 2 + sk.sz * 3.6];
    } else if (sk.k === 7) {
      // Ball roll: the sole drags it across, sideways.
      [vx, vz] = [sk.sx * 3.6, sk.sz * 3.6];
    } else {
      // The flicks: keep running on under it.
      [vx, vz] = [fx * 6.5, fz * 6.5];
    }
    p.vx = vx;
    p.vz = vz;
  }

  /** The move's done: a step-over / roulette has sold the nearby defenders the wrong way. */
  private skillEnd(p: Pl): void {
    const sk = p.skill;
    if (!sk) return;
    if (sk.k === 3 || sk.k === 6 || sk.k === 7 || sk.k > 7) {
      for (const q of this.players) {
        if (q.team === p.team || q.state !== 'run' || Math.hypot(q.x - p.x, q.z - p.z) > 3.2) continue;
        q.noTouch = Math.max(q.noTouch, this.time + 0.35);
        q.vx -= sk.sx * 2.5;
        q.vz -= sk.sz * 2.5;
      }
    }
  }

  // ---------------------------------------------------------------- kicking

  /** Begin a kick: a short wind-up, then `strike` (direction = aim). */
  startKick(p: Pl, type: KickType, power: number, ax: number, az: number, firstTime = false, spot?: { x: number; z: number }): void {
    if (p.state !== 'run' && p.state !== 'hold') return;
    const al = Math.hypot(ax, az) || 1;
    // Pick the target player now (the pass goes where you aim).
    let target = -1;
    if (['pass', 'through', 'lob', 'lobThrough', 'cross', 'throw', 'gkThrow', 'header'].includes(type)) target = this.pickReceiver(p, ax / al, az / al, type);
    // (A power shot: the long, planted run-up into it.)
    const windup = type === 'power' ? (firstTime ? 0.22 : 0.42) : firstTime ? 0.08 : type === 'shot' || type === 'finesse' || type === 'penalty' ? 0.2 : type === 'throw' ? 0.35 : 0.13;
    p.state = 'kick';
    // (An overhead kick: up, over, and he lands on his back.)
    const after = type === 'bicycle' ? 0.85 : 0.32;
    p.t = windup + after;
    p.kick = { type, power, ax: ax / al, az: az / al, aimZ: Math.max(-1, Math.min(1, az)), target, struck: false, at: after, tx: spot?.x, tz: spot?.z };
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
    for (const minCos of [0.82, 0.5, 0.2]) {
      const narrow = minCos > 0.8;
      for (const q of this.teamPlayers(p.team)) {
        if (q === p || q.state === 'down') continue;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.5 || d > 70) continue;
        const cos = (dx * ax + dz * az) / d;
        if (cos < minCos) continue;
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
    if (!owned && lp && lp.team === p.team && b.kickId === lp.id && lp.from !== p.i) {
      this.stats[p.team].passesDone++;
      // First time off a team-mate's ball (a header from a cross, a volley): part of the move for the VAR.
      const mm = this.passMargins.get(lp.id)?.m.get(p.i);
      if (mm && this.chainTeam === p.team) this.chain.push({ margin: mm.margin, at: this.passMargins.get(lp.id)!.at, ax: mm.x, dx: mm.line, az: mm.z });
    }
    const id = ++this.kickSeq;
    // A set piece is live the moment it's struck. (A CPU side's wall jumps at a free kick on goal.)
    if (this.restart?.kind === 'free' && (k.type === 'shot' || k.type === 'finesse' || k.type === 'chip' || k.type === 'power')) {
      const d = (1 - p.team) as 0 | 1;
      if (!this.humans.some((h) => h.team === d) && this.rand() < 0.75) this.wallJump(d);
    }
    // From a dead ball, the taker's set-piece attributes count (power, accuracy, curve).
    const deadBall = this.restart?.kind === 'free' || this.restart?.kind === 'penalty' || this.restart?.kind === 'corner' ? takerStats(st) : null;
    if (this.restart) {
      if (this.restart.kind === 'kickoff' || this.restart.kind === 'penalty') this.emit({ k: 'whistle', long: false });
      this.phase = 'play';
      this.restart = null;
    }
    const lead = (q: Pl, t: number) => [q.x + q.vx * t, q.z + q.vz * t] as [number, number];
    const error = (sigma: number) => (this.rand() + this.rand() + this.rand() - 1.5) * sigma * (p.human < 0 ? this.botProfile(p.team).kickError : 1);
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
          const d = 10 + k.power * 28;
          tx = b.x + k.ax * d;
          tz = b.z + k.az * d;
        }
        const d = Math.hypot(tx - b.x, tz - b.z);
        // Ground pass: enough pace to arrive at a nice speed (power adds zip).
        let v0 = rollSpeedFor(d, 9 + k.power * 10);
        v0 = Math.max(13, Math.min(35, v0 * (1 + k.power * 0.32)));
        // (A keeper's throw: rolled out, or hurled with everything for a long one.)
        if (k.type === 'throw' || k.type === 'gkThrow') v0 = Math.min(v0, k.type === 'throw' ? 16 : 16 + k.power * 13);
        const ang = Math.atan2(tz - b.z, tx - b.x) + error(0.015 + 0.09 * (1 - st.pas / 100) + (this.players.some((q) => q.team !== p.team && Math.hypot(q.x - p.x, q.z - p.z) < 1.8) ? 0.04 : 0));
        vx = Math.cos(ang) * v0;
        vz = Math.sin(ang) * v0;
        vy = k.type === 'throw' ? 3 : k.type === 'gkThrow' ? 2.5 + Math.max(0, k.power - 0.55) * 5 : 0.4;
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
          const runAhead = k.type === 'through' || k.type === 'lobThrough' ? 3 + k.power * 7 : 0;
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
          const d = 18 + k.power * 40;
          tx = b.x + k.ax * d;
          tz = b.z + k.az * d;
        }
        const d = Math.hypot(tx - b.x, tz - b.z);
        if (k.type === 'through') {
          // A driven ground through ball.
          // Weighted to die in the runner's path (it arrives slowly at the spot).
          const v0 = Math.max(11, Math.min(33, rollSpeedFor(d, 5 + k.power * 6)));
          const ang = Math.atan2(tz - b.z, tx - b.x) + error(0.06 * (1 - st.pas / 115));
          vx = Math.cos(ang) * v0;
          vz = Math.sin(ang) * v0;
          vy = 0.3;
        } else if (k.type === 'header') {
          const ang = Math.atan2(tz - b.z, tx - b.x) + error(0.2);
          const v0 = Math.abs(s * PITCH.HL - b.x) < 18 ? 8.5 + st.sho * 0.045 + st.phy * 0.02 : 9 + d * 0.15;
          vx = Math.cos(ang) * v0;
          vz = Math.sin(ang) * v0;
          vy = Math.abs(s * PITCH.HL - b.x) < 18 ? -1.5 + this.rand() * 4.5 : 3;
          if (Math.abs(s * PITCH.HL - b.x) < 18) this.stats[p.team].shots++;
        } else {
          // Lofted: flight time grows with distance (more power = flatter and quicker).
          const t = loftTime(d, k.power) + (k.type === 'lobThrough' ? 0.25 : 0);
          // Crosses curl in (whipped from the outside of the boot / instep).
          if (k.type === 'cross') wy = -Math.sign(b.z) * s * 18 * (deadBall ? 0.7 + deadBall.curve * 0.005 : 1);
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
      case 'power':
      case 'bicycle':
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
        let speed = 19 + power * 18 * (0.7 + sho / 300);
        if (k.type === 'power') {
          // Laced: a rocket, low and flat — hard to keep down if he's not set (under-hit ones are scuffed).
          speed = 27 + power * 16 * (0.75 + sho / 400);
          yt = 0.25 + power * 0.95;
        }
        if (deadBall) speed *= 0.9 + deadBall.power * 0.0015;
        if (k.type === 'bicycle') {
          // Overhead: less pace, harder to keep on target — spectacular when it goes in.
          speed *= 0.82;
          yt = 0.6 + power * 1.1;
        }
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
        let sigma = (0.05 + (1 - sho / 100) * 0.14 + Math.max(0, power - 0.82) * 0.25 + dist * 0.0025 + pressure * 0.045 - (k.type === 'finesse' ? 0.015 : 0)) * (k.type === 'power' ? 1.2 + Math.max(0, 0.6 - power) : 1);
        if (deadBall) sigma *= 1.3 - (k.type === 'penalty' ? deadBall.pens : deadBall.accuracy) * 0.006;
        if (k.type === 'bicycle') sigma += 0.05 + (1 - st.dri / 100) * 0.06;
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
            wy = curl * s * 26 * (deadBall ? 0.7 + deadBall.curve * 0.005 : 1);
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
    this.kickTeam = p.team;
    this.kickPlayer = p.i;
    if (b.y < BALL_R) b.y = BALL_R;
    if (k.type === 'throw') b.y = 2;
    p.noTouch = this.time + 0.3;
    if (p.state === 'hold') p.state = 'run';
    this.emit({ k: 'kick', p: p.i, type: k.type, power: k.power });
    // A ball into space still has a man: whoever of ours gets to it first runs onto it.
    const pass = this.lastPass;
    if (pass && pass.id === id && pass.to < 0) {
      const ai = this.ai[p.team];
      ai.refreshPath();
      let best: Pl | null = null;
      let bt = 3;
      for (const q of this.teamPlayers(p.team)) {
        if (q === p || q.role === 'GK' || q.state !== 'run') continue;
        const t = ai.intercept(q).t;
        if (t < bt) {
          bt = t;
          best = q;
        }
      }
      if (best) {
        const to = best;
        pass.to = to.i;
        for (const h of this.humans) if (h.team === p.team && h.p === p.i && !this.humans.some((x) => x !== h && x.p === to.i)) this.autoSwitch(h, true, to.i);
      }
    }
    // The keeper has let it go (goal kick, throw, punt): you're back on an outfield player.
    if (p.role === 'GK') {
      for (const h of this.humans) {
        if (h.p !== p.i) continue;
        const to = pass && pass.id === id && pass.to >= 0 ? this.players[pass.to]! : null;
        const free = (q: Pl) => !this.humans.some((x) => x !== h && x.p === q.i);
        const alt = this.teamPlayers(p.team)
          .filter((q) => q.role !== 'GK' && free(q))
          .sort((a, c) => Math.hypot(a.x - b.x - b.vx, a.z - b.z - b.vz) - Math.hypot(c.x - b.x - b.vx, c.z - b.z - b.vz))[0];
        const pick = to && to.role !== 'GK' && free(to) ? to : alt;
        if (pick) this.autoSwitch(h, true, pick.i);
      }
    }
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
      // The assistant flags what he can see (a clear yard); the VAR line is exact (see the goal check).
      if (qx > 0 && qx > this.ball.x * s + 0.3 && qx > secondLast + 0.3) q.offside = id;
      if (qx > 0) {
        const line = Math.max(secondLast, this.ball.x * s);
        let e = this.passMargins.get(id);
        if (!e) this.passMargins.set(id, (e = { at: this.time, m: new Map() }));
        e.m.set(q.i, { margin: qx - line, x: q.x, z: q.z, line: line * s });
      }
    }
    // FC-style: the controlled player follows the pass to its receiver.
    if (target) for (const h of this.humans) if (h.team === p.team && h.p === p.i) this.autoSwitch(h, true, target.i);
  }

  // ---------------------------------------------------------------- tackles

  standingTackle(p: Pl): void {
    if (p.state !== 'run') return;
    p.state = 'tackle';
    p.t = 0.42;
    // Lunge at the ball: turn to it and step in (a tackle goes where the ball is, not where you faced).
    const b = this.ball;
    const dx = b.x + b.vx * 0.15 - p.x;
    const dz = b.z + b.vz * 0.15 - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05 && d < 3.2) {
      p.face = Math.atan2(-dz, dx);
      const sp = Math.min(6.5, Math.max(Math.hypot(p.vx, p.vz), d * 3.2));
      p.vx = (dx / d) * sp;
      p.vz = (dz / d) * sp;
    }
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
    const b = this.ball;
    const fx = Math.cos(p.face);
    const fz = -Math.sin(p.face);
    // Where the tackling foot lands vs where the ball actually is (it runs ahead of a sprinter).
    const dBall = Math.hypot(b.x - (p.x + fx * 0.6), b.z - (p.z + fz * 0.6));
    const dx = o.x - p.x;
    const dz = o.z - p.z;
    const d = Math.hypot(dx, dz);
    if (dBall > 1.15 && d > 1.3) return; // nothing in reach yet: the leg is still going in
    if ((dx * fx + dz * fz) / (d || 1) < 0.1 && dBall > 0.8) return;
    p.kick = { type: 'pass', power: 0, ax: 0, az: 0, aimZ: 0, target: -1, struck: true, at: 0 }; // one go per tackle
    // Coming through the back of him: the carrier's body is between you and the ball.
    const behind = (Math.cos(o.face) * -dx + -Math.sin(o.face) * -dz) / (d || 1) < -0.35;
    const reach = dBall < 1.15;
    const st = p.def.stats;
    const chance = reach
      ? Math.max(0.15, Math.min(0.93, 0.66 + (st.def - o.def.stats.dri) * 0.008 + (o.sprint ? 0.08 : 0) + (dBall < 0.6 ? 0.08 : 0) + (Math.hypot(b.x - o.x, b.z - o.z) > 0.65 ? 0.1 : 0) - (behind ? 0.32 : 0)))
      : 0.06;
    // (Mid skill move, the carrier is hard to read.)
    const execution = p.human < 0 ? this.botProfile(p.team).tackleSuccess : 1;
    const won = this.rand() < Math.min(0.97, chance * execution * (o.state === 'skill' ? 0.55 : 1));
    this.emit({ k: 'tackle', p: p.i, won, slide: false });
    if (won) {
      b.owner = -1;
      const a = Math.atan2(fz, fx) + (this.rand() - 0.5) * 2.2;
      const sp = 3 + this.rand() * 5;
      b.vx = Math.cos(a) * sp;
      b.vz = Math.sin(a) * sp;
      b.lastTeam = p.team;
      b.lastPlayer = p.i;
      o.noTouch = this.time + 0.5;
      // A clean, front-on tackle: you come away with it.
      if (this.rand() < (reach && !behind ? 0.4 + st.def * 0.004 : 0.15)) {
        b.owner = p.i;
        this.gained(p);
      }
    } else if (d < 1.1 && this.rand() < (behind ? 0.42 : reach ? 0.05 : 0.2)) this.foul(p, o, behind && this.rand() < 0.35);
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
    if (this.opts.training) return;
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
    // Exactly where was the contact (in or out of the box)? The referee sees it from where he is —
    // a call right on the line can be wrong, and then the VAR steps in.
    const depth = PITCH.BOX_D - Math.abs(on.x - gx);
    const width = PITCH.BOX_HW - Math.abs(on.z);
    const inside = Math.min(depth, width);
    const inBoxExact = inside > 0;
    const close = Math.abs(inside) < 0.9;
    const inBox = close ? inside + (this.rand() - 0.5) * 1.6 > 0 : inBoxExact;
    this.emit({ k: 'foul', by: by.i, on: on.i, card, penalty: inBox });
    this.emit({ k: 'whistle', long: false });
    const sendOff = () => { if (card === 'red') {
      by.state = 'off';
      by.x = 0;
      by.z = -PITCH.HW - 6;
      if (by.human >= 0) {
        const h = this.humans[by.human]!;
        by.human = -1;
        h.p = -1;
        this.autoSwitch(h, true);
      }
    } };
    const contact = { x: on.x, z: on.z };
    const give = (pen: boolean) => { sendOff(); pen ? this.setRestart('penalty', on.team, gx - s * PITCH.SPOT, 0) : this.setRestart('free', on.team, contact.x, contact.z); };
    if (close && (inBox || inBoxExact)) {
      // Check it: was it inside?
      this.varPending = { what: 'penalty', overturn: inBox !== inBoxExact, at: this.time, ax: on.x, dx: gx - s * PITCH.BOX_D, az: on.z, team: on.team, then: (over) => give(over ? !inBox : inBox) };
      this.phase = 'stop'; this.phaseT = 0; this.restart = null;
      Object.assign(this.ball, { x: contact.x, z: contact.z, y: BALL_R, owner: -1, vx: 0, vy: 0, vz: 0, kickType: null });
      this.foulPause = { until: this.time + (card ? 4 : 2.8), resume: () => this.startVar() };
      return;
    }
    // Let the referee approach and warn/book the player before setting up the kick.
    this.phase = 'stop'; this.phaseT = 0; this.restart = null;
    Object.assign(this.ball, { x: contact.x, z: contact.z, y: BALL_R, owner: -1, vx: 0, vy: 0, vz: 0, kickType: null });
    this.foulPause = { until: this.time + (card ? 4 : 2.8), resume: () => give(inBox) };
  }

  // ---------------------------------------------------------------- VAR

  private startVar(): void {
    const v = this.varPending!;
    this.phase = 'var';
    this.phaseT = 0;
    for (const p of this.players) if (p.state === 'celebrate') p.state = 'run';
    this.emit({ k: 'var', stage: 'check', what: v.what, at: v.at, ax: v.ax, dx: v.dx, az: v.az, team: v.team });
  }

  private resolveVar(): void {
    const v = this.varPending!;
    this.varPending = null;
    this.emit({ k: 'var', stage: v.overturn ? 'overturn' : 'confirm', what: v.what, at: v.at, ax: v.ax, dx: v.dx, az: v.az, team: v.team });
    this.emit({ k: 'whistle', long: false });
    if (v.what === 'penalty') return v.then(v.overturn);
    if (!v.overturn) return this.setKickoff(this.lastConceded);
    // Goal ruled out: off the scoreboard, free kick to the defenders where the attacker was.
    this.score[v.team]--;
    for (let i = this.goals.length - 1; i >= 0; i--) {
      if (this.goals[i]!.team === v.team) {
        this.goals.splice(i, 1);
        break;
      }
    }
    this.stats[v.team].offsides++;
    this.chain.length = 0;
    this.setRestart('free', (1 - v.team) as 0 | 1, Math.max(-PITCH.HL + 2, Math.min(PITCH.HL - 2, v.ax)), Math.max(-PITCH.HW + 1, Math.min(PITCH.HW - 1, v.az)));
  }

  /** Bumps: a stronger player shrugging the carrier off the ball. */
  private challenges(): void {
    const o = this.owner();
    if (!o || o.state === 'hold' || o.state === 'skill') return;
    for (const p of this.players) {
      if (p.team === o.team || p.state !== 'run') continue;
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      if (d > 0.75) continue;
      const edge = (p.def.stats.phy + p.def.stats.def) - (o.def.stats.phy + o.def.stats.dri);
      const execution = p.human < 0 ? this.botProfile(p.team).tackleSuccess : 1;
      if (this.rand() < Math.max(0.002, 0.012 + edge * 0.0004) * execution) {
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
    this.ballFrom = { x: b.x, y: b.y, z: b.z };
    const o = this.owner();
    if (o && o.role === 'GK' && (o.state === 'hold' || o.state === 'dive')) {
      // In the keeper's hands.
      Object.assign(b, keeperGrip(o, keeperHeight(o.def.stats.phy)));
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
      // First touch: the ball is cushioned into stride rather than glued straight to the boot.
      const k = Math.min(1, dt * (this.time - this.gainedAt < 0.28 ? 8 : 22));
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
        b.vx *= BOUNCE_KEEP;
        b.vz *= BOUNCE_KEEP;
      } else b.vy = 0;
    }
    this.goalFrame(dt);
  }

  /** End whose goal the ball went into (0 = none). */
  private netIn = 0;
  private netFaces = 0;
  private ballFrom: KeeperPoint = { x: 0, y: BALL_R, z: 0 };
  /** Posts, crossbar and net. */
  private goalFrame(dt: number): void {
    const b = this.ball;
    if (Math.abs(b.x) < PITCH.HL) { this.netIn = 0; this.netFaces = 0; }
    for (const gx of [-PITCH.HL, PITCH.HL]) {
      if (Math.abs(b.x - gx) > PITCH.GOAL_D + 1.3) continue;
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
        const end = Math.sign(gx);
        const local = { x: end * (b.x - gx), y: b.y, z: b.z, vx: end * b.vx, vy: b.vy, vz: b.vz };
        const velocity = { x: local.vx, y: local.vy, z: local.vz };
        const contacts = cushionNet(local, GOAL_NET, dt);
        let faces = 0;
        for (const p of contacts) {
          faces |= p.surface;
          const speed = velocity.x * p.nx + velocity.y * p.ny + velocity.z * p.nz;
          if (!(this.netFaces & p.surface) && speed > 1) this.emit({ k: 'net', end, time: this.time,
            x: gx + end * p.x, y: p.y, z: p.z, strength: Math.min(1.1, 0.2 + speed * 0.035) });
        }
        this.netFaces = faces;
        Object.assign(b, { x: gx + end * local.x, y: local.y, z: local.z, vx: end * local.vx, vy: local.vy, vz: local.vz });
        if (contacts.length) { const grip = Math.exp(-dt * 10); b.wx *= grip; b.wy *= grip; b.wz *= grip; }
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
    if (this.blockShot()) return;
    let best: Pl | null = null;
    let bd = Infinity;
    for (const p of this.players) {
      if (p.state === 'off' || p.state === 'down' || p.state === 'rise' || p.state === 'dive' || p.state === 'slide' || p.state === 'celebrate' || p.state === 'kick') continue;
      if (this.time < p.noTouch) continue;
      // Incoming shots use the same physical save contact as a dive. Generic
      // foot/chest control must not catch them a metre away before the gloves.
      if (p.role === 'GK' && this.inOwnBox(p) && SHOT_KICKS.has(b.kickType) && (this.kickTeam !== p.team || b.lastTeam !== p.team)) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      // A fast ball is harder to stop: the reach shrinks with its pace (passes get through gaps).
      const rv0 = Math.hypot(b.vx - p.vx, b.vz - p.vz);
      const mine = this.lastPass?.to === p.i && b.kickId === this.lastPass.id && this.lastPass.team === p.team;
      // The player a pass is meant for stretches for it (and takes it on the chest / thigh).
      // Cutting out the other side's ball: defenders read it and get a leg / body to it.
      const theirs = b.lastTeam !== p.team && b.owner < 0;
      let reach = mine
        ? 1.05 + p.def.stats.dri * 0.003
        : theirs
          ? (0.86 + p.def.stats.def * 0.0042) * Math.max(0.7, Math.min(1, 1.3 - rv0 * 0.02))
          : (0.6 + p.def.stats.dri * 0.0025) * Math.max(0.4, Math.min(1, 1.3 - rv0 * 0.05));
      // The player you steer gets to a slow, loose ball he's running onto (no dancing round it).
      // (And gets a leg to their passes going past him.)
      if (p.human >= 0 && (rv0 < 9 || theirs)) reach *= theirs ? 1.15 : 1.2;
      if (p.human < 0 && p.role !== 'GK' && theirs) reach *= 0.7 + this.botProfile(p.team).skill * 0.3;
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
    if (!intended && b.lastTeam !== p.team && rv > 15 && this.rand() < 0.12 + (rv - 15) * 0.025 - p.def.stats.def * 0.0015) {
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

  /** A shot driven into a defender in the way: blocked (it ricochets off whatever it hits). */
  /** The wall leaps together. */
  wallJump(team: 0 | 1): void {
    for (const i of this.wall) {
      const p = this.players[i]!;
      if (p.team !== team || p.state !== 'run') continue;
      p.state = 'jump';
      p.t = 0.62;
      p.vx = p.vz = 0;
    }
  }

  private blockShot(): boolean {
    const b = this.ball;
    const kt = b.kickType;
    if (kt !== 'shot' && kt !== 'finesse' && kt !== 'chip' && kt !== 'power') return false;
    if (b.y > 2.75 || this.time - b.kickAt < 0.04) return false;
    for (const p of this.players) {
      if (p.team === this.kickTeam || p.role === 'GK' || p.state === 'off' || p.state === 'down' || this.time < p.noTouch) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      // Legs and body: wider when sliding / stretching.
      if (d > (p.state === 'slide' ? 1.0 : 0.62)) continue;
      // Standing: up to head height. Jumping: up to 2.7 m — but a low one goes under.
      if (p.state === 'jump' ? b.y > 2.4 || b.y < 0.42 : b.y > 1.9) continue;
      p.noTouch = this.time + 0.4;
      if (this.rand() > (p.state === 'slide' ? 0.85 : p.state === 'jump' ? 0.42 : 0.62)) continue; // squeezed past him
      const sp = Math.hypot(b.vx, b.vz);
      const a = Math.atan2(b.vz, b.vx) + Math.PI + (this.rand() - 0.5) * 2.6;
      const k = 0.25 + this.rand() * 0.35;
      b.vx = Math.cos(a) * sp * k;
      b.vz = Math.sin(a) * sp * k;
      b.vy = this.rand() * 5;
      b.wx = b.wy = b.wz = 0;
      this.touched(p);
      this.emit({ k: 'touch', p: p.i, heavy: true });
      return true;
    }
    return false;
  }

  /** Bookkeeping for a touch that isn't a clean control. */
  private touched(p: Pl): void {
    const b = this.ball;
    if (!this.opts.training && p.offside && p.offside === b.kickId && this.lastPass?.team === p.team) return this.offside(p);
    this.prevToucher = b.lastPlayer;
    b.lastPlayer = p.i;
    b.lastTeam = p.team;
    for (const q of this.players) q.offside = 0;
  }

  /** A player has the ball under control. */
  gained(p: Pl): void {
    const b = this.ball;
    if (!this.opts.training && p.offside && p.offside === b.kickId && this.lastPass?.team === p.team) return this.offside(p);
    if (this.lastPass && this.lastPass.team === p.team && b.kickId === this.lastPass.id) this.stats[p.team].passesDone++;
    this.prevToucher = b.lastPlayer;
    b.lastPlayer = p.i;
    b.lastTeam = p.team;
    b.kickType = null;
    this.gainedAt = this.time;
    // The attack's chain of passes (for the VAR): a new attack when the other side wins it.
    if (p.team !== this.chainTeam) {
      this.chain.length = 0;
      this.chainTeam = p.team;
    }
    const pm = this.lastPass && this.lastPass.team === p.team && b.kickId === this.lastPass.id ? this.passMargins.get(this.lastPass.id) : undefined;
    const mm = pm?.m.get(p.i);
    if (pm && mm) this.chain.push({ margin: mm.margin, at: pm.at, ax: mm.x, dx: mm.line, az: mm.z });
    if (this.passMargins.size > 40) this.passMargins.delete(this.passMargins.keys().next().value!);
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

  /** Keeper quality in the sim: the CPU's level for CPU sides, a steady "pro" for a human's side. */
  gkSkill(gk: Pl): number {
    // (Difficulty changes the CPU keeper a little; it never turns him into a clown.)
    return gk.def.stats.gk * (this.humans.some((h) => h.team === gk.team) ? 1 : this.botProfile(gk.team).keeper);
  }

  private keepers(dt: number): void {
    for (const team of [0, 1] as const) {
      const gk = this.gkOf(team);
      if (gk.state === 'off') continue;
      // Holding: distribute after a moment (humans choose; AI throws or kicks).
      if (gk.state === 'hold') {
        gk.t -= dt;
        if (gk.human < 0 && gk.t <= 0) this.ai[team].distribute(gk);
        continue;
      }
      this.smother(gk);
      this.shotStop(gk);
    }
  }

  /** Each keeper's read of the ball coming at his goal. */
  private gkPlan: Array<{ kick: number; seen: number; at: number; z: number; y: number; pvx: number; pvz: number; committed: boolean; resolved: boolean; outcome: 'catch' | 'parry' | 'miss'; guess: number } | null> = [null, null];

  /**
   * Shot-stopping, like a real keeper: a reaction time to read it, a shuffle across into the
   * line while there's time, then the dive (or a set block) at the last moment. Whether it's
   * kept out depends on reaching the ball; his rating affects reaction and handling.
   */
  private shotStop(gk: Pl): void {
    const team = gk.team;
    const b = this.ball;
    let plan = this.gkPlan[team];
    if (b.owner >= 0) {
      this.gkPlan[team] = null;
      return;
    }
    // A new kick, or deflected on the way (a sudden change of direction): read it again.
    if (plan && !plan.resolved) {
      const h0 = Math.hypot(plan.pvx, plan.pvz);
      const h1 = Math.hypot(b.vx, b.vz);
      const turned = h0 > 1 && h1 > 1 && (plan.pvx * b.vx + plan.pvz * b.vz) / (h0 * h1) < 0.992;
      if (plan.kick !== b.kickId || turned || h1 > h0 + 1.5) plan = this.gkPlan[team] = null;
    }
    if (plan) {
      plan.pvx = b.vx;
      plan.pvz = b.vz;
    }
    const gx = this.ownGoalX(team);
    const s = Math.sign(gx);
    // Our own deliberate ball (a back-pass) isn't a shot; a deflection off one of ours still is.
    const ours = this.kickTeam === team && b.lastTeam === team;
    if (b.vx * s <= 2 || ours || Math.abs(b.x - gx) > 45) {
      if (plan && !plan.committed) this.gkPlan[team] = null;
      if (plan?.committed && !plan.resolved && this.time >= plan.at) plan.resolved = true;
      return;
    }
    if (plan?.resolved || (gk.state !== 'run' && gk.state !== 'dive' && gk.state !== 'jump')) return;
    const g = this.crossAt(gx);
    const c = this.crossAt(gk.x) ?? g;
    if (!g || !c) return;
    const onTarget = Math.abs(g.z) < PITCH.GOAL_HW + BALL_R && g.y < PITCH.GOAL_H + BALL_R;
    const skill = this.gkSkill(gk);
    if (!plan) {
      plan = { kick: b.kickId, seen: this.time, at: this.time + c.t, z: c.z, y: c.y, pvx: b.vx, pvz: b.vz, committed: false, resolved: false, outcome: 'miss', guess: 0 };
      this.gkPlan[team] = plan;
      const shotKick = SHOT_KICKS.has(b.kickType);
      if (shotKick && onTarget && this.gkShot.get(gk.i) !== b.kickId) {
        this.gkShot.set(gk.i, b.kickId);
        this.stats[1 - team]!.onTarget++;
      }
      // Penalties: he has to guess. Good keepers read the taker more often.
      if (b.kickType === 'penalty') {
        const right = Math.sign(c.z - gk.z) || 1;
        const r = this.rand();
        plan.guess = r < 0.36 + skill * 0.0022 ? right : r < 0.9 ? -right : 0;
        // A human's side: the keeper goes where you told him (or stands his ground: 2 = stay in the middle).
        if (this.humans.some((h) => h.team === team)) plan.guess = this.penDive[team] || 2;
      }
    }
    if (!plan.committed) {
      plan.at = this.time + c.t;
      plan.z = c.z;
      plan.y = c.y;
    }
    // Going wide or over: let it go.
    if (!onTarget && !plan.committed) return;
    const react = Math.max(0.07, 0.27 - skill * 0.0022);
    if (this.time - plan.seen < react && b.kickType !== 'penalty') return;
    const lateral = plan.z - gk.z;
    const up = Math.max(0, plan.y - 1.25);
    const need = Math.hypot(lateral, up * 0.85);
    const tLeft = plan.at - this.time;
    if (!plan.committed) {
      // Set, and shuffle across into the line while there's time; dive when it's now or never.
      this.gkTrack[team] = { z: plan.z, until: this.time + 0.1 };
      const diveT = Math.max(0.2, Math.min(0.5, 0.16 + need * 0.12));
      if (tLeft > diveT && !plan.guess) return;
      this.commitSave(gk, plan, need, lateral, tLeft, skill);
    }
    if (!plan.resolved && gk.noTouch <= this.time) {
      const contact = keeperContact(gk, keeperHeight(gk.def.stats.phy), this.ballFrom, b, BALL_R);
      if (contact) {
        Object.assign(b, contact.point);
        plan.resolved = true;
        this.saveBall(gk, contact.hands && plan.outcome === 'catch', b.z, b.y);
      } else if (s * (b.x - gk.x) > 1.2) plan.resolved = true;
    }
  }

  private commitSave(gk: Pl, plan: NonNullable<MatchSim['gkPlan'][number]>, need: number, lateral: number, tLeft: number, skill: number): void {
    const b = this.ball;
    plan.committed = true;
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    let dir = Math.sign(lateral) || 1;
    if (plan.guess && plan.guess !== 2) dir = plan.guess;
    const comfortable = speed < 15 + skill * 0.09 && need < 1.3 && plan.y < 2.1 && !(this.kickTeam !== gk.team && b.lastTeam === gk.team && b.kickType === null);
    // Handling decides catch versus parry; a reachable shot is never preselected
    // as a miss. The actual swept hand/body contact below decides whether it saves.
    plan.outcome = comfortable && this.rand() < 0.35 + skill * 0.006 ? 'catch' : 'parry';
    const guessed = plan.guess === 1 || plan.guess === -1;
    // (Told to stay in the middle: he stands his ground and only goes for what's near him.)
    const stays = plan.guess === 2 && need > 1.1;
    if (stays) {
      gk.vx *= 0.2;
      gk.vz = 0;
      // (…and holds that spot until the ball's gone past.)
      this.gkTrack[gk.team] = { z: gk.z, until: plan.at + 0.4 };
    } else if (need > 0.6 || plan.y > 1.95 || guessed) {
      gk.state = 'dive';
      gk.t = KEEPER_DIVE_TIME;
      gk.dive = { dz: dir * (guessed ? 1 : Math.min(1, Math.abs(lateral) / 1.2)), dy: Math.max(0, Math.min(1, plan.y / KEEPER_SAVE_HEIGHT)) };
      const T = Math.max(0.08, tLeft);
      // Match the launch to the body/shoulder pose at interception, including
      // momentum lost during the dive, so the glove doesn't overshoot the shot.
      const geo = keeperGeometry({ ...gk, t: KEEPER_DIVE_TIME - T }, keeperHeight(gk.def.stats.phy));
      const bodyZ = (geo.shoulders[0].z + geo.shoulders[1].z) / 2 - gk.z;
      const travel = (1 - Math.exp(-1.5 * T)) / 1.5;
      let vz = (lateral - bodyZ - dir * Math.min(0.18, Math.abs(lateral) * 0.2)) / travel;
      if (guessed && Math.sign(plan.guess) !== Math.sign(lateral)) vz = dir * 4.5;
      vz = Math.max(-7.5, Math.min(7.5, vz));
      gk.vz = vz;
      gk.vx = -Math.sign(this.ownGoalX(gk.team)) * 0.8;
      gk.kick = null;
    } else {
      // It's at him: set, feet planted, a block or a catch into the chest.
      gk.vx *= 0.2;
      gk.vz = lateral / Math.max(0.25, tLeft);
    }
  }

  /** Where (and when) the loose ball crosses the plane x = px: same drag, curl and bounces as the match. */
  private crossAt(px: number): { t: number; z: number; y: number } | null {
    const b = this.ball;
    let { x, y, z, vx, vy, vz, wy } = b;
    const side = Math.sign(px - x);
    if (!side) return { t: 0, z, y };
    const h = 1 / 120;
    for (let i = 0; i < 300; i++) {
      const v = Math.hypot(vx, vy, vz);
      const ground = y <= BALL_R + 0.005 && Math.abs(vy) < 0.4;
      vx += (-DRAG * v * vx + MAGNUS * wy * vz) * h;
      vz += (-DRAG * v * vz - MAGNUS * wy * vx) * h;
      if (ground) {
        vy = 0;
        const hv = Math.hypot(vx, vz);
        if (hv > 0.05) {
          const k = Math.max(0, hv - (ROLL_A + ROLL_B * hv) * h) / hv;
          vx *= k;
          vz *= k;
        }
      } else vy += (-G - DRAG * v * vy) * h;
      const nx = x + vx * h;
      if (Math.sign(px - nx) !== side) {
        const f = (px - x) / (nx - x || 1e-9);
        return { t: (i + f) * h, z: z + vz * h * f, y: Math.max(BALL_R, y + vy * h * f) };
      }
      x = nx;
      y += vy * h;
      z += vz * h;
      if (y < BALL_R) {
        y = BALL_R;
        if (vy < -0.6) {
          vy = -vy * 0.55;
          vx *= BOUNCE_KEEP;
          vz *= BOUNCE_KEEP;
        } else vy = 0;
      }
      wy *= Math.exp(-h * 0.5);
      if (Math.hypot(vx, vz) < 0.3) return null;
    }
    return null;
  }

  /** Hands on it: held (on the dive, then gathered) or palmed away. */
  private saveBall(gk: Pl, hold: boolean, z: number, y: number): void {
    const b = this.ball;
    if (b.owner >= 0) return;
    const s = Math.sign(this.ownGoalX(gk.team));
    // Already past him?
    if (Math.sign(b.x - gk.x) === s && Math.abs(b.x - gk.x) > 1.2) return;
    if (SHOT_KICKS.has(b.kickType)) this.stats[gk.team].saves++;
    if (hold && this.inOwnBox(gk)) {
      this.catchOnTheDive(gk);
      this.emit({ k: 'save', gk: gk.i, catch: true });
      return;
    }
    const r = this.rand();
    const side = Math.sign(z - gk.z) || (r < 0.5 ? -1 : 1);
    if (y > 2.0 && Math.abs(z) < PITCH.GOAL_HW && r < 0.55) {
      // Fingertips: tipped over the bar.
      b.vx *= 0.3;
      b.vy = 4.5 + r * 2;
      b.vz *= 0.4;
    } else if (Math.abs(z) > 1.2 && r < 0.62) {
      // Turned round the post.
      b.vx *= 0.35;
      b.vz = Math.sign(z) * (6 + r * 8);
      b.vy = 1.5 + r * 3;
    } else {
      // Pushed away from goal and out wide — not back into the middle where they follow in.
      const wide = Math.abs(z) > 0.3 ? Math.sign(z) : side;
      b.vx = -s * (3 + r * 4);
      b.vz = wide * (6 + r * 6);
      b.vy = 1.2 + r * 2.8;
    }
    b.wx = b.wy = b.wz = 0;
    b.lastTeam = gk.team;
    b.lastPlayer = gk.i;
    gk.noTouch = this.time + 0.6;
    this.emit({ k: 'save', gk: gk.i, catch: false });
  }

  /** Caught while diving / spreading: hold it once he's back up. */
  private catchOnTheDive(gk: Pl): void {
    const b = this.ball;
    const diving = gk.state === 'dive', remaining = gk.t, vx = gk.vx, vz = gk.vz;
    this.gkCatch(gk);
    if (!diving) return;
    gk.state = 'dive';
    gk.t = remaining; gk.vx = vx; gk.vz = vz;
    this.later.push([
      this.time + remaining,
      () => {
        if (b.owner === gk.i) {
          gk.state = 'hold';
          gk.t = 1.2;
        }
      },
    ]);
  }

  /** One-on-one: the keeper spreads himself at the attacker's feet (or he's rounded). */
  private smother(gk: Pl): void {
    if (gk.state !== 'run' || gk.human >= 0) return;
    const o = this.owner();
    if (!o || o.team === gk.team || o.state === 'hold' || this.time - this.smotherAt[gk.team]! < 1.4) return;
    const b = this.ball;
    const db = Math.hypot(b.x - gk.x, b.z - gk.z);
    const rushing = this.gkRush[gk.team] > this.time;
    if (db > (rushing ? 2.4 : 2.0) || (!this.inOwnBox(gk) && !rushing)) return;
    // Only when he's actually closing the attacker down (not when the ball is going away from him).
    if ((b.x - gk.x) * (o.vx - gk.vx) + (b.z - gk.z) * (o.vz - gk.vz) > 2 && db > 1.4) return;
    this.smotherAt[gk.team] = this.time;
    const side = Math.sign(b.z - gk.z) || 1;
    gk.state = 'dive';
    gk.t = KEEPER_DIVE_TIME;
    gk.dive = { dz: side, dy: BALL_R / KEEPER_SAVE_HEIGHT };
    gk.vx = (b.x - gk.x) * 2.4;
    gk.vz = (b.z - gk.z) * 2.4;
    gk.face = Math.atan2(-(b.z - gk.z), b.x - gk.x);
    const p = Math.max(0.15, Math.min(0.85, 0.5 + (this.gkSkill(gk) - o.def.stats.dri) * 0.014 + (o.sprint ? 0.08 : 0) - (db > 1.6 ? 0.12 : 0)));
    if (this.rand() >= p) {
      gk.noTouch = this.time + 0.7; // rounded: he's on the floor
      return;
    }
    b.owner = -1;
    o.noTouch = this.time + 0.6;
    this.stats[gk.team].saves++;
    if (this.inOwnBox(gk) && this.rand() < 0.45) {
      this.catchOnTheDive(gk);
      this.emit({ k: 'save', gk: gk.i, catch: true });
      return;
    }
    const a = Math.atan2(b.z - gk.z, b.x - gk.x) + (this.rand() - 0.5) * 1.6;
    const sp = 5 + this.rand() * 5;
    b.vx = Math.cos(a) * sp;
    b.vz = Math.sin(a) * sp;
    b.vy = 1 + this.rand() * 2;
    b.lastTeam = gk.team;
    b.lastPlayer = gk.i;
    gk.noTouch = this.time + 0.5;
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
      // A shot that's deflected or parried in still belongs to whoever hit it.
      const own = b.lastTeam !== scorerTeam && this.kickTeam !== scorerTeam;
      this.score[scorerTeam]++;
      const scorer = own || b.lastTeam === scorerTeam || this.kickPlayer < 0 ? b.lastPlayer : this.kickPlayer;
      const assist = !own && this.lastPass && this.lastPass.team === scorerTeam && this.lastPass.from !== scorer && this.prevToucher === this.lastPass.from ? this.lastPass.from : -1;
      // Anything tight in the move? The VAR will look at it after the celebrations.
      const recent = this.chainTeam === scorerTeam ? this.chain.filter((c) => this.time - c.at < 16 && c.margin > -2.0) : [];
      if (!this.opts.training && !own && recent.length) {
        const worst = recent.reduce((a, c) => (c.margin > a.margin ? c : a));
        this.varPending = { what: 'offside', overturn: worst.margin > 0, at: worst.at, ax: worst.ax, dx: worst.dx, az: worst.az, team: scorerTeam, then: () => {} };
      }
      this.goals.push({ team: scorerTeam, p: scorer, minute: this.minute + 1, own });
      this.emit({ k: 'goal', team: scorerTeam, scorer, assist, own, minute: this.minute + 1 });
      this.phase = 'goal';
      this.phaseT = 0;
      this.lastConceded = (1 - scorerTeam) as 0 | 1;
      const sc = this.players[scorer];
      if (sc && sc.team === scorerTeam) {
        sc.state = 'celebrate';
        sc.t = CELEB.total;
        sc.kick = null;
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
    b.y = r.kind === 'throw' ? 1.95 : taker.state === 'place' ? BALL_R + 0.85 * Math.pow(Math.max(0, taker.t / 1.4), 2) : BALL_R;
    b.vx = b.vy = b.vz = 0;
    // A human taker gets 8 s before the AI takes it for them (no stalling online).
    if ((taker.human >= 0 && (this.opts.training || this.phaseT < 8)) || taker.state !== 'run') return;
    if (this.phaseT < 0.6) return;
    r.wait -= dt;
    if (r.wait > 0) return;
    this.ai[r.team].takeRestart(taker, r);
  }
}

// ---------------------------------------------------------------- helpers

/** Grass: rolling resistance (constant + with speed). A proper, slightly heavy pitch. */
export const ROLL_A = 1.45;
export const ROLL_B = 0.085;
/** Speed kept on a bounce. */
export const BOUNCE_KEEP = 0.76;
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
