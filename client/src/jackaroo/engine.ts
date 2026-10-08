import { buildDeck, isBlack, type Card } from './cards';

/**
 * Jackaroo rules engine (pure logic: runs in the browser for local games, on the
 * server for online ones, and in tools/jackaroo-sim.ts).
 *
 * Board model
 *  - 76 track squares, numbered clockwise; quadrant q owns squares 19q … 19q+18.
 *  - Quadrant q's safe-zone gate is square 19q (the middle of its arm end) and its
 *    start square is the next one, 19q + 1. A marble moving forward off its own gate
 *    goes into its safe zone (it never does a second lap), so a marble that steps
 *    back with a 4 from just past its start reaches safety with a short forward move.
 *  - Marble positions: -1 = home, 0–75 = track, 76–79 = safe slots 0–3 (own zone).
 *  - Marble ids: player p owns 4p … 4p+3. 2v2 seats players 0–3 on quadrants 0–3
 *    (partners 0&2 / 1&3 sit opposite); 1v1 puts players 0 and 1 on quadrants 0 and 2.
 */
export type Mode = 'classic' | 'complex';
export const TRACK = 76;
export const PER = 19;
export const SAFE0 = 76;
export const HOME = -1;

export interface Rules {
  mode: Mode;
  /** Seconds per turn (0 = unlimited). */
  turnTime: number;
}
export const DEFAULT_RULES: Rules = { mode: 'classic', turnTime: 0 };

export type Move =
  | { k: 'out'; m: number }
  | { k: 'fwd'; m: number; n: number }
  | { k: 'back'; m: number }
  | { k: 'split'; parts: Array<{ m: number; n: number }> }
  | { k: 'swap'; m: number; t: number }
  | { k: 'attack' };

export type Action = { t: 'play'; card: number; move: Move } | { t: 'burn'; card: number };

export type GameEvent =
  | { k: 'hand'; hand: number; inDeck: number; perDeck: number; deck: number; dealer: number; size: number }
  | { k: 'deal'; p: number; n: number; cards?: Card[] }
  | { k: 'shuffle'; deck: number }
  | { k: 'turn'; p: number }
  | { k: 'play'; p: number; card: Card; move: Move }
  | { k: 'out'; m: number }
  | { k: 'move'; m: number; path: number[]; back?: boolean; kills?: Array<{ m: number; at: number }>; split?: number }
  | { k: 'capture'; m: number; by: number; at: number }
  | { k: 'swap'; a: number; b: number }
  | { k: 'safe'; m: number }
  | { k: 'finish'; p: number }
  | { k: 'burn'; p: number; card: Card; why: 'stuck' | 'attack'; by?: number }
  | { k: 'over'; team: number; players: number[] }
  | { k: 'timeout'; p: number }
  | { k: 'left'; p: number };

// ============================================================================ board (pure)

export interface Board {
  n: 2 | 4;
  mode: Mode;
  /** Position of every marble (index = marble id). */
  marbles: number[];
}

export const owner = (m: number) => m >> 2;
export const quadOf = (n: number, p: number) => (n === 4 ? p : p * 2);
export const startOf = (n: number, p: number) => quadOf(n, p) * PER + 1;
export const gateOf = (n: number, p: number) => quadOf(n, p) * PER;
export const partnerOf = (n: number, p: number) => (n === 4 ? (p + 2) % 4 : -1);
export const teamOf = (n: number, p: number) => (n === 4 ? p % 2 : p);
export const teamPlayers = (n: number, team: number) => (n === 4 ? [team, team + 2] : [team]);
export const marblesOf = (p: number) => [p * 4, p * 4 + 1, p * 4 + 2, p * 4 + 3];

export function cloneBoard(b: Board): Board {
  return { n: b.n, mode: b.mode, marbles: b.marbles.slice() };
}

export function isFinished(b: Board, p: number): boolean {
  for (let k = 0; k < 4; k++) if (b.marbles[p * 4 + k]! < SAFE0) return false;
  return true;
}

/** Whose marbles player p moves: their own, or their partner's once all 4 of theirs are safe. */
export function controlledOwner(b: Board, p: number): number {
  return b.n === 4 && isFinished(b, p) ? partnerOf(b.n, p) : p;
}

/** A marble sitting on its own start square: nobody may pass, capture or swap it. */
export function isProtected(b: Board, m: number): boolean {
  return b.marbles[m] === startOf(b.n, owner(m));
}

/** Track occupancy: square → marble id (-1 empty). */
export function occupancy(b: Board): Int16Array {
  const occ = new Int16Array(TRACK).fill(-1);
  for (let m = 0; m < b.marbles.length; m++) {
    const p = b.marbles[m]!;
    if (p >= 0 && p < TRACK) occ[p] = m;
  }
  return occ;
}

/** Squares a marble visits moving n forward (null: it would overshoot its safe zone). */
export function fwdPath(b: Board, m: number, n: number): number[] | null {
  let p = b.marbles[m]!;
  if (p < 0 || n < 1) return null;
  const gate = gateOf(b.n, owner(m));
  const path: number[] = [];
  for (let i = 0; i < n; i++) {
    if (p >= SAFE0) {
      p++;
      if (p > SAFE0 + 3) return null;
    } else if (p === gate) p = SAFE0;
    else p = (p + 1) % TRACK;
    path.push(p);
  }
  return path;
}

/** Backward moves stay on the track (never into a safe zone). */
export function backPath(b: Board, m: number, n: number): number[] | null {
  let p = b.marbles[m]!;
  if (p < 0 || p >= TRACK) return null;
  const path: number[] = [];
  for (let i = 0; i < n; i++) {
    p = (p + TRACK - 1) % TRACK;
    path.push(p);
  }
  return path;
}

export interface PathCheck {
  /** Marble sent home by landing on it (-1: none). */
  capture: number;
  /** King sweep victims (Complex): marble + the step it is passed on. */
  kills: Array<{ m: number; at: number }>;
}

/**
 * Can marble m travel this path? Protected marbles block it (passing or landing), it
 * can't land on a marble of its own colour, and inside a safe zone it can't jump
 * over or land on its own marbles. With sweep, every other marble passed dies.
 */
export function checkPath(b: Board, m: number, path: number[], sweep: boolean, occ = occupancy(b)): PathCheck | null {
  const me = owner(m);
  const kills: PathCheck['kills'] = [];
  let capture = -1;
  for (let i = 0; i < path.length; i++) {
    const q = path[i]!;
    const last = i === path.length - 1;
    if (q >= SAFE0) {
      for (let k = 0; k < 4; k++) if (b.marbles[me * 4 + k] === q && me * 4 + k !== m) return null;
      continue;
    }
    const o = occ[q]!;
    if (o < 0 || o === m) continue;
    if (isProtected(b, o)) return null;
    if (last) {
      if (owner(o) === me) return null;
      capture = o;
    } else if (sweep) kills.push({ m: o, at: i });
  }
  return { capture, kills };
}

function nextIdx(n: number, p: number): number {
  return (p + 1) % n;
}

/** Why a move is illegal for player p holding this card (null = legal). nextHasCards: the attack option. */
export function validate(b: Board, p: number, card: Card, mv: Move, nextHasCards: boolean): string | null {
  if (!mv || typeof mv !== 'object') return 'Unknown move.';
  const ctl = controlledOwner(b, p);
  const mine = (m: unknown): m is number => typeof m === 'number' && Number.isInteger(m) && owner(m) === ctl && m >= 0 && m < b.marbles.length;
  const complex = b.mode === 'complex';
  const r = card.r;
  switch (mv.k) {
    case 'out': {
      if (r !== 1 && r !== 13) return 'Only an Ace or a King brings a marble out.';
      if (!mine(mv.m) || b.marbles[mv.m] !== HOME) return 'Pick a marble at home.';
      const s = startOf(b.n, ctl);
      const o = occupancy(b)[s]!;
      if (o >= 0 && owner(o) === ctl) return 'Your own marble is on your start square.';
      return null;
    }
    case 'fwd': {
      const allowed = r === 1 ? [1, 11] : r === 13 ? [13] : r === 12 ? [12] : [2, 3, 5, 6, 8, 9, 10].includes(r) ? [r] : [];
      if (!allowed.includes(mv.n)) return 'That card cannot move that far.';
      const anyMarble = complex && r === 5;
      if (anyMarble) {
        if (typeof mv.m !== 'number' || !Number.isInteger(mv.m) || mv.m < 0 || mv.m >= b.marbles.length) return 'Pick a marble.';
        const pos = b.marbles[mv.m]!;
        if (!mine(mv.m)) {
          if (pos < 0 || pos >= TRACK) return 'A 5 moves any marble on the track.';
          if (isProtected(b, mv.m)) return 'That marble is protected on its start square.';
        }
      } else if (!mine(mv.m)) return 'Pick one of your marbles.';
      const path = fwdPath(b, mv.m, mv.n);
      if (!path) return b.marbles[mv.m]! < 0 ? 'That marble is still at home.' : 'It would overshoot the safe zone.';
      if (!checkPath(b, mv.m, path, complex && r === 13)) return 'The way is blocked.';
      return null;
    }
    case 'back': {
      if (r !== 4) return 'Only a 4 moves backward.';
      if (!mine(mv.m)) return 'Pick one of your marbles.';
      const path = backPath(b, mv.m, 4);
      if (!path) return 'Only marbles on the track can move backward.';
      if (!checkPath(b, mv.m, path, false)) return 'The way is blocked.';
      return null;
    }
    case 'split': {
      if (r !== 7) return 'Only a 7 can be split.';
      const parts = mv.parts;
      if (!Array.isArray(parts) || parts.length < 1 || parts.length > 2) return 'Split the 7 into one or two moves.';
      let total = 0;
      for (const pt of parts) {
        if (!pt || !Number.isInteger(pt.n) || pt.n < 1 || pt.n > 7) return 'Bad split.';
        total += pt.n;
      }
      if (total !== 7) return 'Use all 7 steps.';
      if (parts.length === 2 && parts[0]!.m === parts[1]!.m) return 'Split between two different marbles.';
      const t = cloneBoard(b);
      for (const pt of parts) {
        const c = controlledOwner(t, p);
        if (typeof pt.m !== 'number' || owner(pt.m) !== c || pt.m < 0 || pt.m >= t.marbles.length) return 'Pick your own marbles.';
        const path = fwdPath(t, pt.m, pt.n);
        if (!path) return 'A marble would overshoot (or is at home).';
        const chk = checkPath(t, pt.m, path, false);
        if (!chk) return 'The way is blocked.';
        if (chk.capture >= 0) t.marbles[chk.capture] = HOME;
        t.marbles[pt.m] = path[path.length - 1]!;
      }
      return null;
    }
    case 'swap': {
      if (r !== 11) return 'Only a Jack swaps.';
      if (!mine(mv.m)) return 'Pick one of your marbles.';
      if (typeof mv.t !== 'number' || !Number.isInteger(mv.t) || mv.t < 0 || mv.t >= b.marbles.length || owner(mv.t) === ctl) return 'Pick another colour to swap with.';
      for (const x of [mv.m, mv.t]) {
        const pos = b.marbles[x]!;
        if (pos < 0 || pos >= TRACK) return 'Both marbles must be on the track.';
        if (isProtected(b, x)) return 'A marble on its own start square cannot be swapped.';
      }
      return null;
    }
    case 'attack': {
      if (!complex || !(r === 10 || (r === 12 && isBlack(card)))) return 'Only a 10 or a black Queen (Complex) does that.';
      if (!nextHasCards) return 'The next player has no cards.';
      return null;
    }
  }
  return 'Unknown move.';
}

/** Every legal move for this card (one "bring out" per player; 7 splits in both orders). */
export function cardMoves(b: Board, p: number, card: Card, nextHasCards: boolean): Move[] {
  const out: Move[] = [];
  const ctl = controlledOwner(b, p);
  const own = marblesOf(ctl);
  const try_ = (mv: Move) => {
    if (!validate(b, p, card, mv, nextHasCards)) out.push(mv);
  };
  const r = card.r;
  if (r === 1 || r === 13) {
    const home = own.find((m) => b.marbles[m] === HOME);
    if (home !== undefined) try_({ k: 'out', m: home });
  }
  const steps = r === 1 ? [1, 11] : r === 13 ? [13] : r === 12 ? [12] : [2, 3, 5, 6, 8, 9, 10].includes(r) ? [r] : [];
  if (steps.length) {
    const who = b.mode === 'complex' && r === 5 ? b.marbles.map((_, i) => i) : own;
    for (const m of who) for (const n of steps) try_({ k: 'fwd', m, n });
  }
  if (r === 4) for (const m of own) try_({ k: 'back', m });
  if (r === 11) for (const m of own) for (let t = 0; t < b.marbles.length; t++) if (owner(t) !== ctl) try_({ k: 'swap', m, t });
  if (r === 7) out.push(...splitMoves(b, p));
  if (b.mode === 'complex' && (r === 10 || (r === 12 && isBlack(card)))) try_({ k: 'attack' });
  return out;
}

function splitMoves(b: Board, p: number): Move[] {
  const out: Move[] = [];
  const own = marblesOf(controlledOwner(b, p));
  const occ = occupancy(b);
  for (const a of own) {
    for (let n1 = 1; n1 <= 7; n1++) {
      const path = fwdPath(b, a, n1);
      if (!path) break;
      const chk = checkPath(b, a, path, false, occ);
      if (!chk) {
        // A block or one of my own marbles: farther steps may still be fine (landing past it).
        continue;
      }
      if (n1 === 7) {
        out.push({ k: 'split', parts: [{ m: a, n: 7 }] });
        continue;
      }
      const t = cloneBoard(b);
      if (chk.capture >= 0) t.marbles[chk.capture] = HOME;
      t.marbles[a] = path[path.length - 1]!;
      const n2 = 7 - n1;
      const occ2 = occupancy(t);
      for (const c of marblesOf(controlledOwner(t, p))) {
        if (c === a) continue;
        const p2 = fwdPath(t, c, n2);
        if (p2 && checkPath(t, c, p2, false, occ2)) out.push({ k: 'split', parts: [{ m: a, n: n1 }, { m: c, n: n2 }] });
      }
    }
  }
  return out;
}

/**
 * Apply a legal move to the board (no validation). emit receives the board events
 * right after the state they describe changed (so per-event snapshots line up).
 */
export function applyMove(b: Board, p: number, card: Card, mv: Move, emit?: (ev: GameEvent) => void): void {
  const ctl = controlledOwner(b, p);
  const sendHome = (victim: number, by: number) => {
    const at = b.marbles[victim]!;
    b.marbles[victim] = HOME;
    emit?.({ k: 'capture', m: victim, by, at });
  };
  const travel = (m: number, path: number[], back: boolean, sweep: boolean, split?: number) => {
    const chk = checkPath(b, m, path, sweep)!;
    const wasSafe = b.marbles[m]! >= SAFE0;
    b.marbles[m] = path[path.length - 1]!;
    for (const k of chk.kills) b.marbles[k.m] = HOME;
    if (emit) {
      const ev: GameEvent = { k: 'move', m, path };
      if (back) ev.back = true;
      if (chk.kills.length) ev.kills = chk.kills;
      if (split !== undefined) ev.split = split;
      emit(ev);
    }
    if (chk.capture >= 0) sendHome(chk.capture, m);
    if (!wasSafe && b.marbles[m]! >= SAFE0) emit?.({ k: 'safe', m });
  };
  switch (mv.k) {
    case 'out': {
      const s = startOf(b.n, ctl);
      const victim = occupancy(b)[s]!;
      b.marbles[mv.m] = s;
      emit?.({ k: 'out', m: mv.m });
      if (victim >= 0) sendHome(victim, mv.m);
      return;
    }
    case 'fwd':
      travel(mv.m, fwdPath(b, mv.m, mv.n)!, false, b.mode === 'complex' && card.r === 13);
      return;
    case 'back':
      travel(mv.m, backPath(b, mv.m, 4)!, true, false);
      return;
    case 'split':
      mv.parts.forEach((pt, i) => travel(pt.m, fwdPath(b, pt.m, pt.n)!, false, false, mv.parts.length > 1 ? i : undefined));
      return;
    case 'swap': {
      const a = b.marbles[mv.m]!;
      b.marbles[mv.m] = b.marbles[mv.t]!;
      b.marbles[mv.t] = a;
      emit?.({ k: 'swap', a: mv.m, b: mv.t });
      return;
    }
    case 'attack':
      return;
  }
}

/** Winning team (all its marbles safe), else -1. */
export function winningTeam(b: Board, prefer = -1): number {
  const teams = b.n === 4 ? [0, 1] : [0, 1];
  const done = teams.filter((t) => teamPlayers(b.n, t).every((p) => isFinished(b, p)));
  if (!done.length) return -1;
  return done.includes(prefer) ? prefer : done[0]!;
}

// ============================================================================ game

export interface PlayerSetup {
  id: string;
  name: string;
  bot: boolean;
  avatar: number;
}
export interface Player extends PlayerSetup {
  hand: Card[];
  connected: boolean;
}

export type Phase = 'play' | 'over';

export interface EngineOptions {
  /** Picks the move for an idle / timed-out / disconnected player (the bots' brain). */
  auto?: (e: JackarooEngine, p: number) => Action;
  /** Don't deal (tests set the position up by hand). */
  noDeal?: boolean;
  dealer?: number;
}

export class JackarooEngine {
  readonly players: Player[];
  readonly rules: Rules;
  readonly board: Board;
  deck: Card[] = [];
  discard: Card[] = [];
  fire: Card[] = [];
  cur = 0;
  dealer = 0;
  phase: Phase = 'play';
  /** Hands dealt so far (whole game), hand index within the current deck, decks used. */
  handNo = 0;
  inDeck = 0;
  deckNo = 0;
  turnLeft = 0;
  winner = -1;
  turns = 0;
  /** Rough length (s) of the animations for the last action (the server's bots wait for it). */
  animHint = 0;
  private finished: boolean[];
  events: GameEvent[] = [];

  constructor(
    setups: PlayerSetup[],
    rules: Partial<Rules> = {},
    private readonly onEvent?: (e: JackarooEngine) => void,
    private readonly opts: EngineOptions = {},
  ) {
    if (setups.length !== 2 && setups.length !== 4) throw new Error('Jackaroo needs 2 or 4 players');
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.players = setups.map((s) => ({ ...s, hand: [], connected: true }));
    const n = setups.length as 2 | 4;
    this.board = { n, mode: this.rules.mode, marbles: new Array(n * 4).fill(HOME) };
    this.finished = new Array(n).fill(false);
    this.dealer = opts.dealer ?? Math.floor(Math.random() * n);
    this.deck = shuffle(buildDeck());
    this.deckNo = 1;
    if (!opts.noDeal) this.startHand();
  }

  get n(): number {
    return this.players.length;
  }
  get isOver(): boolean {
    return this.phase === 'over';
  }
  get current(): Player {
    return this.players[this.cur]!;
  }
  /** Cards each deck's hands use: 5 on the first hand, then 4 and 4 (twice round with 2 players). */
  get perDeck(): number {
    return this.n === 4 ? 3 : 6;
  }
  idx(id: string): number {
    return this.players.findIndex((p) => p.id === id);
  }
  player(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }
  private emit(ev: GameEvent): void {
    this.events.push(ev);
    this.onEvent?.(this);
  }

  nextHasCards(p = this.cur): boolean {
    return this.players[nextIdx(this.n, p)]!.hand.length > 0;
  }

  /** Legal moves for player p with one of their cards. */
  movesFor(p: number, card: Card): Move[] {
    return cardMoves(this.board, p, card, this.nextHasCards(p));
  }

  /** Can player p play anything at all (otherwise they must burn a card)? */
  canMove(p = this.cur): boolean {
    return this.players[p]!.hand.some((c) => this.movesFor(p, c).length > 0);
  }

  // ---------------------------------------------------------------- dealing

  private startHand(): void {
    const n = this.n;
    let size = this.inDeck % 3 === 0 ? 5 : 4;
    if (this.deck.length < size * n) {
      this.newDeck();
      size = 5;
    }
    this.dealer = (this.dealer + 1) % n;
    this.handNo++;
    this.emit({ k: 'hand', hand: this.handNo, inDeck: this.inDeck + 1, perDeck: this.perDeck, deck: this.deckNo, dealer: this.dealer, size });
    for (let i = 1; i <= n; i++) {
      const p = this.players[(this.dealer + i) % n]!;
      p.hand = this.deck.splice(0, size);
      this.emit({ k: 'deal', p: (this.dealer + i) % n, n: size, cards: p.hand.slice() });
    }
    this.inDeck++;
    this.cur = (this.dealer + 1) % n;
    this.beginTurn();
  }

  private newDeck(): void {
    // Hands are empty between deals: every card is in the deck, discard or fire pile.
    this.deck = shuffle([...this.deck, ...this.discard, ...this.fire]);
    this.discard = [];
    this.fire = [];
    this.deckNo++;
    this.inDeck = 0;
    this.emit({ k: 'shuffle', deck: this.deckNo });
  }

  private beginTurn(): void {
    this.turnLeft = this.rules.turnTime;
    this.turns++;
    this.emit({ k: 'turn', p: this.cur });
  }

  /** Next player still holding cards; nobody → deal the next hand. */
  private advance(): void {
    for (let i = 1; i <= this.n; i++) {
      const q = (this.cur + i) % this.n;
      if (this.players[q]!.hand.length) {
        this.cur = q;
        this.beginTurn();
        return;
      }
    }
    this.startHand();
  }

  // ---------------------------------------------------------------- actions

  /** Apply a player's action; returns an error message or null. */
  act(id: string, a: Action): string | null {
    const p = this.idx(id);
    if (p < 0) return 'Not in this game.';
    if (this.phase === 'over') return 'The game is over.';
    if (p !== this.cur) return "It's not your turn.";
    if (!a || typeof a !== 'object') return 'Unknown action.';
    const pl = this.players[p]!;
    const card = pl.hand.find((c) => c.id === (a as { card?: unknown }).card);
    if (!card) return "You don't have that card.";
    if (a.t === 'burn') {
      if (this.canMove(p)) return 'You have a legal move — you must play it.';
      pl.hand.splice(pl.hand.indexOf(card), 1);
      this.fire.push(card);
      this.emit({ k: 'burn', p, card, why: 'stuck' });
      this.animHint = 0.9;
      this.advance();
      return null;
    }
    if (a.t !== 'play') return 'Unknown action.';
    const err = validate(this.board, p, card, a.move, this.nextHasCards(p));
    if (err) return err;
    const mv = normalize(a.move);
    pl.hand.splice(pl.hand.indexOf(card), 1);
    this.discard.push(card);
    const mark = this.events.length;
    this.emit({ k: 'play', p, card, move: mv });
    if (mv.k === 'attack') {
      const q = nextIdx(this.n, p);
      const victim = this.players[q]!;
      const lost = victim.hand.splice(Math.floor(Math.random() * victim.hand.length), 1)[0]!;
      this.fire.push(lost);
      this.emit({ k: 'burn', p: q, card: lost, why: 'attack', by: p });
    } else applyMove(this.board, p, card, mv, (ev) => this.emit(ev));
    this.animHint = this.events.slice(mark).reduce((s, ev) => s + animSeconds(ev), 0);
    // Players who just got all four marbles home.
    for (let q = 0; q < this.n; q++) {
      if (!this.finished[q] && isFinished(this.board, q)) {
        this.finished[q] = true;
        this.emit({ k: 'finish', p: q });
      }
    }
    const w = winningTeam(this.board, teamOf(this.n, p));
    if (w >= 0) {
      this.phase = 'over';
      this.winner = w;
      this.emit({ k: 'over', team: w, players: teamPlayers(this.n, w) });
      return null;
    }
    this.advance();
    return null;
  }

  // ---------------------------------------------------------------- time

  update(dt: number): void {
    if (this.phase !== 'play' || !this.rules.turnTime) return;
    this.turnLeft -= dt;
    if (this.turnLeft > 0) return;
    this.emit({ k: 'timeout', p: this.cur });
    this.autoAct(this.current.id);
  }

  /** Play for an idle / disconnected player: the bots' choice, else any legal move, else burn. */
  autoAct(id: string): void {
    const p = this.idx(id);
    if (p !== this.cur || this.phase !== 'play') return;
    if (this.opts.auto) {
      const a = this.opts.auto(this, p);
      if (!this.act(id, a)) return;
    }
    const pl = this.players[p]!;
    for (const c of pl.hand) {
      const mv = this.movesFor(p, c)[0];
      if (mv) {
        this.act(id, { t: 'play', card: c.id, move: mv });
        return;
      }
    }
    if (pl.hand[0]) this.act(id, { t: 'burn', card: pl.hand[0].id });
  }

  /** A player left: a bot takes over their seat (the team keeps its marbles). */
  leave(id: string): void {
    const p = this.idx(id);
    if (p < 0 || this.phase === 'over') return;
    const pl = this.players[p]!;
    pl.bot = true;
    pl.connected = true;
    this.emit({ k: 'left', p });
  }
}

/** Copy only the fields a move kind uses (client messages may carry junk). */
export function normalize(mv: Move): Move {
  switch (mv.k) {
    case 'out':
      return { k: 'out', m: mv.m };
    case 'fwd':
      return { k: 'fwd', m: mv.m, n: mv.n };
    case 'back':
      return { k: 'back', m: mv.m };
    case 'split':
      return { k: 'split', parts: mv.parts.map((p) => ({ m: p.m, n: p.n })) };
    case 'swap':
      return { k: 'swap', m: mv.m, t: mv.t };
    case 'attack':
      return { k: 'attack' };
  }
}

/** How long the table takes to animate an event (seconds, approximate). */
export function animSeconds(ev: GameEvent): number {
  switch (ev.k) {
    case 'play':
      return 0.5;
    case 'move':
      return ev.path.length * 0.15 + 0.2;
    case 'out':
      return 0.6;
    case 'capture':
      return 0.8;
    case 'swap':
      return 0.9;
    case 'burn':
      return 0.8;
    default:
      return 0;
  }
}

export function shuffle<T>(a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}
