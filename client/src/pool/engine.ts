import { FOOT_SPOT_X, HEAD_STRING_X, POCKETS, R, Sim, rack, spotFree, BOUNDS, type BallRest, type ShotInput, type SimEvent } from './physics';

/**
 * 8-ball rules (WPA-style, as in the popular online game):
 *  - break from the kitchen; the table stays open after the break
 *  - first legally pocketed ball after the break picks your group (solids 1–7 / stripes 9–15)
 *  - pot one of yours (and no foul) to keep shooting
 *  - fouls → opponent gets ball in hand anywhere: scratch, hitting nothing, hitting
 *    the wrong ball first, no ball reaching a cushion after contact, running out of time
 *  - clear your group, then call a pocket and sink the 8. The 8 early, in the wrong
 *    pocket, or with a foul loses the game. 8 on the break is re-spotted.
 */
export type Group = 'solids' | 'stripes';

export interface PlayerSetup {
  id: string;
  name: string;
  bot: boolean;
  avatar: number;
}
export interface Player extends PlayerSetup {
  group: Group | null;
  connected: boolean;
}

export interface Rules {
  /** Seconds per shot (0 = unlimited). */
  shotTime: number;
}

export type Action = { t: 'shoot'; shot: ShotInput; cue?: { x: number; y: number }; call?: number };

export type GameEvent =
  | { k: 'start'; breaker: string }
  | { k: 'shot'; by: string; seq: number; start: BallRest[]; shot: ShotInput; call: number }
  | { k: 'result'; by: string; pocketed: number[]; foul: string | null; assigned: Group | null; keep: boolean; respot8: boolean }
  | { k: 'turn'; player: string; ballInHand: boolean }
  | { k: 'timeout'; by: string }
  | { k: 'left'; by: string }
  | { k: 'over'; winner: string; reason: string };

export const isSolid = (id: number) => id >= 1 && id <= 7;
export const isStripe = (id: number) => id >= 9 && id <= 15;
export const groupOf = (id: number): Group | null => (isSolid(id) ? 'solids' : isStripe(id) ? 'stripes' : null);

let seedCounter = 1;

export class PoolEngine {
  readonly players: Player[];
  readonly rules: Rules;
  balls: BallRest[];
  cur = 0;
  phase: 'aim' | 'rolling' | 'over' = 'aim';
  isBreak = true;
  ballInHand = true;
  /** Ball in hand restricted to the kitchen (the break). */
  kitchen = true;
  shotLeft = 0;
  /** Real seconds left of the current shot animation. */
  rollLeft = 0;
  seq = 0;
  winner: string | null = null;
  reason = '';
  lastFoul: string | null = null;
  events: GameEvent[] = [];
  private rng: number;

  constructor(setups: PlayerSetup[], rules: Partial<Rules> = {}) {
    if (setups.length !== 2) throw new Error('8-ball needs exactly two players');
    this.rules = { shotTime: 0, ...rules };
    this.players = setups.map((s) => ({ ...s, group: null, connected: true }));
    this.rng = (Date.now() ^ (seedCounter++ * 2654435761)) >>> 0 || 1;
    this.cur = this.rand() < 0.5 ? 0 : 1;
    this.balls = rack(() => this.rand());
    this.events.push({ k: 'start', breaker: this.current.id });
    this.beginTurn(true);
  }

  private rand(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  get current(): Player {
    return this.players[this.cur]!;
  }
  get other(): Player {
    return this.players[1 - this.cur]!;
  }
  get isOver(): boolean {
    return this.phase === 'over';
  }
  player(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  /** Object balls of a group still on the table. */
  remaining(g: Group): number[] {
    return this.balls.filter((b) => b.pocket < 0 && groupOf(b.id) === g).map((b) => b.id);
  }

  /** What the current player must hit first: their group, the 8, or anything (open). */
  targets(p: Player = this.current): number[] {
    if (!p.group) {
      const open = this.balls.filter((b) => b.pocket < 0 && b.id !== 0 && b.id !== 8).map((b) => b.id);
      return open.length ? open : [8];
    }
    const mine = this.remaining(p.group);
    return mine.length ? mine : [8];
  }

  /** Shooting at the 8 (a pocket must be called). */
  onEight(p: Player = this.current): boolean {
    if (this.isBreak) return false;
    if (!p.group) return this.targets(p)[0] === 8;
    return this.remaining(p.group).length === 0;
  }

  private beginTurn(ballInHand: boolean): void {
    this.phase = 'aim';
    this.ballInHand = ballInHand;
    this.shotLeft = this.rules.shotTime;
    this.events.push({ k: 'turn', player: this.current.id, ballInHand });
  }

  /** Validate a ball-in-hand spot. */
  canPlace(x: number, y: number): boolean {
    if (this.kitchen && x > HEAD_STRING_X) return false;
    return spotFree(this.balls, x, y, 0);
  }

  act(id: string, a: Action): string | null {
    if (this.phase === 'over') return 'The game is over.';
    if (this.phase !== 'aim') return 'Wait for the balls to stop.';
    if (this.current.id !== id) return "It's not your turn.";
    if (a.t !== 'shoot') return 'Unknown action.';
    const s = a.shot;
    if (![s.dx, s.dy, s.power, s.sx, s.sy].every(Number.isFinite)) return 'Bad shot.';
    const len = Math.sqrt(s.dx * s.dx + s.dy * s.dy);
    if (len < 0.5) return 'Bad aim.';
    const shot: ShotInput = { dx: s.dx / len, dy: s.dy / len, power: Math.max(0.02, Math.min(1, s.power)), sx: Math.max(-1, Math.min(1, s.sx)), sy: Math.max(-1, Math.min(1, s.sy)) };
    if (this.ballInHand && a.cue) {
      if (!this.canPlace(a.cue.x, a.cue.y)) return this.kitchen ? 'Place the cue ball behind the line.' : "The cue ball can't go there.";
      const cue = this.balls.find((b) => b.id === 0)!;
      cue.x = a.cue.x;
      cue.y = a.cue.y;
      cue.pocket = -1;
    }
    const call = this.onEight() ? (a.call ?? -1) : -1;
    if (this.onEight() && (call < 0 || call >= POCKETS.length)) return 'Call a pocket for the 8-ball.';
    this.shoot(shot, call);
    return null;
  }

  private shoot(shot: ShotInput, call: number): void {
    const p = this.current;
    const start = this.balls.map((b) => ({ ...b }));
    this.seq++;
    this.events.push({ k: 'shot', by: p.id, seq: this.seq, start, shot, call });
    // What's legal is decided by the table before the shot.
    const targets = new Set(this.targets(p));
    const onEight = this.onEight(p);
    const sim = new Sim(start);
    sim.shoot(shot);
    sim.runToRest();
    this.balls = sim.rest();
    this.phase = 'rolling';
    this.rollLeft = sim.t + 0.4;
    this.judge(sim, call, targets, onEight);
  }

  /** Apply the rules to a finished shot. */
  private judge(sim: Sim, call: number, targets: Set<number>, onEight: boolean): void {
    const p = this.current;
    const wasBreak = this.isBreak;
    const pots = sim.events.filter((e): e is Extract<SimEvent, { k: 'pocket' }> => e.k === 'pocket');
    const pocketed = pots.map((e) => e.a);
    const cueIn = pocketed.includes(0);
    const objects = pocketed.filter((id) => id !== 0);
    let foul: string | null = null;
    if (cueIn) foul = 'Scratch! The cue ball went in.';
    else if (sim.firstHit < 0) foul = 'Foul: the cue ball hit nothing.';
    else if (!wasBreak && !targets.has(sim.firstHit)) foul = sim.firstHit === 8 ? 'Foul: hit the 8-ball first.' : `Foul: hit the ${groupOf(sim.firstHit) ?? ''} ball first.`.replace('  ', ' ');
    else if (!wasBreak && !objects.length && !sim.railAfterHit) foul = 'Foul: no ball reached a cushion.';
    this.isBreak = false;
    this.kitchen = false;
    // The 8-ball.
    const eight = pots.find((e) => e.a === 8);
    let respot8 = false;
    if (eight) {
      if (wasBreak) {
        respot8 = true;
        this.respotEight();
      } else if (onEight && !foul && eight.pocket === call) {
        this.result(p, objects, foul, null, false, respot8);
        return this.finish(p.id, 'potted the 8-ball');
      } else {
        this.result(p, objects, foul, null, false, respot8);
        const why = !onEight ? 'potted the 8-ball too early' : foul ? 'fouled on the 8-ball' : 'potted the 8 in the wrong pocket';
        return this.finish(this.other.id, `${p.name} ${why}`);
      }
    }
    // Groups: the first legally pocketed object ball after the break.
    let assigned: Group | null = null;
    if (!p.group && !wasBreak && !foul) {
      const first = objects.find((id) => id !== 8);
      if (first !== undefined) {
        assigned = groupOf(first)!;
        p.group = assigned;
        this.other.group = assigned === 'solids' ? 'stripes' : 'solids';
      }
    }
    const mine = objects.filter((id) => (wasBreak ? id !== 8 : p.group ? groupOf(id) === p.group : id !== 8));
    const keep = !foul && mine.length > 0;
    this.result(p, objects, foul, assigned, keep, respot8);
    this.lastFoul = foul;
    if (foul) {
      const cue = this.balls.find((b) => b.id === 0)!;
      if (cue.pocket >= 0) {
        // Put it back somewhere legal (the next player can move it anyway).
        cue.pocket = -1;
        this.placeDefaultCue();
      }
      this.cur = 1 - this.cur;
      this.beginTurnLater(true);
    } else {
      if (!keep) this.cur = 1 - this.cur;
      this.beginTurnLater(false);
    }
  }

  private pendingTurn: boolean | null = null;
  private beginTurnLater(ballInHand: boolean): void {
    this.pendingTurn = ballInHand;
  }

  private result(p: Player, pocketed: number[], foul: string | null, assigned: Group | null, keep: boolean, respot8: boolean): void {
    this.events.push({ k: 'result', by: p.id, pocketed, foul, assigned, keep, respot8 });
  }

  private finish(winner: string, reason: string): void {
    this.phase = 'over';
    this.winner = winner;
    this.reason = reason;
    this.pendingTurn = null;
    this.events.push({ k: 'over', winner, reason });
  }

  private respotEight(): void {
    const b8 = this.balls.find((b) => b.id === 8)!;
    b8.pocket = -1;
    for (let dx = 0; dx < 1; dx += 0.01) {
      if (spotFree(this.balls, FOOT_SPOT_X + dx, 0, 8)) {
        b8.x = FOOT_SPOT_X + dx;
        b8.y = 0;
        return;
      }
    }
  }

  private placeDefaultCue(): void {
    const cue = this.balls.find((b) => b.id === 0)!;
    for (let k = 0; k < 400; k++) {
      const x = HEAD_STRING_X - (k % 20) * 0.02 * (k % 2 ? 1 : -1);
      const y = (Math.floor(k / 20) - 10) * 0.05;
      if (spotFree(this.balls, x, y, 0)) {
        cue.x = x;
        cue.y = y;
        return;
      }
    }
  }

  update(dt: number): void {
    if (this.phase === 'rolling') {
      this.rollLeft -= dt;
      if (this.rollLeft <= 0 && this.pendingTurn !== null) {
        const bih = this.pendingTurn;
        this.pendingTurn = null;
        this.beginTurn(bih);
      } else if (this.rollLeft <= 0 && this.winner) this.phase = 'over';
      return;
    }
    if (this.phase !== 'aim' || !this.rules.shotTime) return;
    this.shotLeft -= dt;
    if (this.shotLeft > 0) return;
    // Out of time: foul, ball in hand for the opponent.
    this.events.push({ k: 'timeout', by: this.current.id });
    this.lastFoul = 'Out of time!';
    this.isBreak = false;
    this.kitchen = false;
    this.cur = 1 - this.cur;
    this.beginTurn(true);
  }

  /** A player left: the other one wins. */
  leave(id: string): void {
    if (this.phase === 'over' || !this.player(id)) return;
    this.events.push({ k: 'left', by: id });
    const other = this.players.find((p) => p.id !== id)!;
    this.finish(other.id, 'opponent left');
  }
}

export const BALL_R = R;
export { BOUNDS };
