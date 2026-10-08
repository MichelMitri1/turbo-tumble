import { buildDeck, COLORS, points, type Card, type Color } from './cards';

/**
 * Last Card rules engine (pure logic — runs in the browser for local games and on
 * the server for online ones). Official rules, with optional house rules:
 *  - match the top card by colour, number or symbol; Wilds go on anything
 *  - Skip, Reverse (= Skip with two players), Draw Two, Wild, Wild Draw Four
 *  - Wild Draw Four may be challenged: if the player had a card of the current
 *    colour they draw 4 instead, otherwise the challenger draws 6
 *  - can't (or won't) play → draw one; a playable drawn card may be played at once
 *  - call "LAST CARD!" when down to one card, or be caught and draw 2
 *  - round winner scores everyone else's cards; first to the target wins
 */
export interface Rules {
  /** Draw Two / Wild Draw Four can be stacked onto the next player. */
  stacking: boolean;
  /** With stacking: a Draw Two may also go onto a Wild Draw Four. */
  stackTwoOnFour: boolean;
  /** Keep drawing until you get a playable card (and play it). */
  drawToMatch: boolean;
  /** Wild Draw Four can be challenged (off = it simply costs 4). */
  challenge: boolean;
  /** 7 = swap hands with a player of your choice, 0 = every hand moves along in play direction. */
  sevenZero: boolean;
  /** A card identical to the top one may be played out of turn. */
  jumpIn: boolean;
  /** Must play when able; a playable drawn card must be played. */
  forcePlay: boolean;
  /** Cards drawn when caught with one card and no call. */
  unoPenalty: number;
  /** Points to win (0 = a single round). */
  target: number;
  /** Seconds per turn (0 = unlimited). */
  turnTime: number;
}
export const DEFAULT_RULES: Rules = {
  stacking: false,
  stackTwoOnFour: false,
  drawToMatch: false,
  challenge: true,
  sevenZero: false,
  jumpIn: false,
  forcePlay: false,
  unoPenalty: 2,
  target: 0,
  turnTime: 0,
};

export interface PlayerSetup {
  id: string;
  name: string;
  bot: boolean;
  avatar: number;
}
export interface Player extends PlayerSetup {
  hand: Card[];
  score: number;
  connected: boolean;
  /** Said "last card" for the current one-card stretch. */
  called: boolean;
}

/** pickColor: a Wild was flipped to start, the first player names the colour. pickSwap: a 7 (7-0 rule) waits for a target. */
export type Phase = 'play' | 'drawn' | 'challenge' | 'pickColor' | 'pickSwap' | 'roundOver' | 'over';

export type Action =
  | { t: 'play'; card: number; color?: Color }
  | { t: 'draw' }
  | { t: 'keep' }
  | { t: 'call' }
  | { t: 'catch'; target: string }
  | { t: 'challenge'; yes: boolean }
  | { t: 'color'; color: Color }
  | { t: 'swap'; target: string };

export type DrawWhy = 'turn' | 'match' | 'penalty' | 'stack' | 'catch' | 'challenge' | 'deal';

export type GameEvent =
  | { k: 'round'; round: number; dealer: string }
  | { k: 'flip'; card: Card; color: Color | null }
  | { k: 'turn'; player: string }
  | { k: 'play'; by: string; card: Card; color: Color | null; left: number; jump?: boolean; bluff?: boolean }
  | { k: 'draw'; by: string; n: number; why: DrawWhy; cards?: Card[] }
  | { k: 'skip'; target: string }
  | { k: 'reverse'; dir: 1 | -1 }
  | { k: 'stack'; total: number }
  | { k: 'call'; by: string }
  | { k: 'caught'; by: string; target: string }
  | { k: 'challenge'; by: string; target: string; yes: boolean; guilty: boolean }
  | { k: 'keep'; by: string }
  | { k: 'color'; by: string; color: Color }
  | { k: 'swap'; by: string; with: string }
  | { k: 'rotate'; dir: 1 | -1 }
  | { k: 'reshuffle' }
  | { k: 'timeout'; by: string }
  | { k: 'left'; by: string }
  | { k: 'roundOver'; winner: string; points: number; hands: Record<string, Card[]>; scores: Record<string, number> }
  | { k: 'over'; winner: string };

const ROUND_PAUSE = 7;

const isColor = (c: unknown): c is Color => typeof c === 'string' && (COLORS as string[]).includes(c);

export class LastCardEngine {
  readonly players: Player[];
  readonly rules: Rules;
  draw: Card[] = [];
  discard: Card[] = [];
  /** Colour to match (null only while the first player picks one for a flipped Wild). */
  color: Color | null = null;
  dir: 1 | -1 = 1;
  cur = 0;
  dealer = 0;
  phase: Phase = 'play';
  round = 0;
  /** Stacked Draw Two / Four total waiting for the current player. */
  pendingDraw = 0;
  pendingKind: 'draw2' | 'wild4' | null = null;
  /** Card the current player just drew and may still play. */
  drawnId = -1;
  /** Player down to one card without calling (can be caught). */
  vulnerable: string | null = null;
  /** Wild Draw Four challenge state. */
  wild4: { by: string; guilty: boolean } | null = null;
  turnLeft = 0;
  pauseLeft = 0;
  winner: string | null = null;
  roundWinner: string | null = null;
  lastPoints = 0;
  events: GameEvent[] = [];

  /** onEvent runs right after each event (e.g. to snapshot a player's view for the animations). */
  constructor(
    setups: PlayerSetup[],
    rules: Partial<Rules> = {},
    private readonly onEvent?: (e: LastCardEngine) => void,
  ) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.players = setups.map((s) => ({ ...s, hand: [], score: 0, connected: true, called: false }));
    this.dealer = Math.floor(Math.random() * this.players.length);
    this.startRound();
  }

  get isOver(): boolean {
    return this.phase === 'over';
  }
  get current(): Player {
    return this.players[this.cur]!;
  }
  get top(): Card {
    return this.discard[this.discard.length - 1]!;
  }
  player(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }
  private emit(ev: GameEvent): void {
    this.events.push(ev);
    this.onEvent?.(this);
  }
  private idx(id: string): number {
    return this.players.findIndex((p) => p.id === id);
  }
  private next(from = this.cur, steps = 1): number {
    const n = this.players.length;
    return (((from + this.dir * steps) % n) + n) % n;
  }

  // ---------------------------------------------------------------- rounds

  private startRound(): void {
    this.round++;
    this.dealer = (this.dealer + 1) % this.players.length;
    this.draw = shuffle(buildDeck());
    this.discard = [];
    this.color = null;
    this.dir = 1;
    this.pendingDraw = 0;
    this.pendingKind = null;
    this.drawnId = -1;
    this.vulnerable = null;
    this.wild4 = null;
    this.roundWinner = null;
    // Nobody can act while the cards are dealt (the deal is one event per player).
    this.phase = 'roundOver';
    for (const p of this.players) {
      p.hand = [];
      p.called = false;
    }
    this.emit({ k: 'round', round: this.round, dealer: this.players[this.dealer]!.id });
    for (const p of this.players) {
      p.hand = this.draw.splice(0, 7);
      this.emit({ k: 'draw', by: p.id, n: 7, why: 'deal', cards: p.hand.slice() });
    }
    // Flip the first card; a Wild Draw Four goes back into the deck.
    let first = this.draw.shift()!;
    while (first.kind === 'wild4') {
      this.draw.push(first);
      this.draw = shuffle(this.draw);
      first = this.draw.shift()!;
    }
    this.discard.push(first);
    this.color = first.color;
    this.emit({ k: 'flip', card: first, color: first.color });
    this.cur = this.next(this.dealer);
    this.phase = 'play';
    // The first card acts on the first player.
    if (first.kind === 'skip') {
      this.emit({ k: 'skip', target: this.current.id });
      this.cur = this.next();
    } else if (first.kind === 'rev') {
      if (this.players.length > 2) {
        this.dir = -1;
        this.emit({ k: 'reverse', dir: -1 });
        this.cur = this.dealer;
      } else {
        this.emit({ k: 'skip', target: this.current.id });
        this.cur = this.next();
      }
    } else if (first.kind === 'draw2') {
      const victim = this.current;
      this.give(victim, 2, 'penalty');
      this.emit({ k: 'skip', target: victim.id });
      this.cur = this.next();
    } else if (first.kind === 'wild') {
      // The first player names the colour before anything is played.
      this.beginTurn('pickColor');
      return;
    }
    this.beginTurn();
  }

  private beginTurn(phase: Phase = 'play'): void {
    this.phase = phase;
    this.drawnId = -1;
    this.turnLeft = this.rules.turnTime;
    this.emit({ k: 'turn', player: this.current.id });
  }

  private endRound(winner: Player): void {
    const last = this.top;
    // A final Draw Two / Four still hits the next player (it counts for points).
    if (last.kind === 'draw2' || last.kind === 'wild4') {
      const victim = this.players[this.next()]!;
      if (victim !== winner) this.give(victim, (last.kind === 'draw2' ? 2 : 4) + this.pendingDraw, 'penalty');
    }
    this.pendingDraw = 0;
    let pts = 0;
    const hands: Record<string, Card[]> = {};
    for (const p of this.players) {
      hands[p.id] = p.hand.slice();
      if (p !== winner) pts += p.hand.reduce((s, c) => s + points(c), 0);
    }
    winner.score += pts;
    this.lastPoints = pts;
    this.roundWinner = winner.id;
    this.vulnerable = null;
    const scores = Object.fromEntries(this.players.map((p) => [p.id, p.score]));
    this.emit({ k: 'roundOver', winner: winner.id, points: pts, hands, scores });
    if (!this.rules.target || winner.score >= this.rules.target) this.finish(winner.id);
    else {
      this.phase = 'roundOver';
      this.pauseLeft = ROUND_PAUSE;
    }
  }

  private finish(winner: string): void {
    this.phase = 'over';
    this.winner = winner;
    this.emit({ k: 'over', winner });
  }

  // ---------------------------------------------------------------- rules

  /** Can this card go on the pile right now (for the current player)? */
  canPlay(c: Card): boolean {
    if (this.phase !== 'play' && this.phase !== 'drawn') return false;
    if (this.phase === 'drawn' && c.id !== this.drawnId) return false;
    if (this.pendingDraw > 0) return c.kind === 'wild4' || (c.kind === 'draw2' && (this.pendingKind === 'draw2' || this.rules.stackTwoOnFour));
    if (c.kind === 'wild' || c.kind === 'wild4') return true;
    if (this.color === null || c.color === this.color) return true;
    const t = this.top;
    return c.kind === t.kind && (c.kind !== 'num' || c.n === t.n);
  }

  /** Jump-in: an identical (non-wild) card may be slapped down out of turn. */
  canJump(c: Card): boolean {
    if (!this.rules.jumpIn || (this.phase !== 'play' && this.phase !== 'drawn') || this.pendingDraw > 0) return false;
    const t = this.top;
    return c.color !== null && c.color === t.color && c.color === this.color && c.kind === t.kind && c.n === t.n;
  }

  /** Would a Wild Draw Four be a bluff (holding a card of the current colour)? */
  isBluff(p: Player, except = -1): boolean {
    return this.color !== null && p.hand.some((c) => c.id !== except && c.color === this.color);
  }

  /** Must the current player play rather than draw / keep? */
  mustPlay(): boolean {
    if (this.phase === 'drawn') return this.rules.forcePlay || this.rules.drawToMatch;
    return this.rules.forcePlay && this.phase === 'play' && this.current.hand.some((c) => this.canPlay(c));
  }

  private give(p: Player, n: number, why: DrawWhy): Card[] {
    const got: Card[] = [];
    for (let i = 0; i < n; i++) {
      if (!this.draw.length) this.reshuffle();
      const c = this.draw.shift();
      if (!c) break;
      got.push(c);
      p.hand.push(c);
    }
    if (p.hand.length > 1) {
      p.called = false;
      if (this.vulnerable === p.id) this.vulnerable = null;
    }
    this.emit({ k: 'draw', by: p.id, n: got.length, why, cards: got });
    return got;
  }

  private reshuffle(): void {
    if (this.discard.length <= 1) return;
    const top = this.discard.pop()!;
    this.draw = shuffle(this.discard);
    this.discard = [top];
    this.emit({ k: 'reshuffle' });
  }

  // ---------------------------------------------------------------- actions

  /** Apply a player's action; returns an error message or null. */
  act(id: string, a: Action): string | null {
    const p = this.player(id);
    if (!p) return 'Not in this game.';
    if (!a || typeof a !== 'object') return 'Unknown action.';
    if (this.phase === 'over' || this.phase === 'roundOver') return 'The round is over.';
    switch (a.t) {
      case 'call': {
        if (p.hand.length > 2) return 'Call it when you are down to 2 cards!';
        if (p.called) return null;
        p.called = true;
        if (this.vulnerable === id) this.vulnerable = null;
        this.emit({ k: 'call', by: id });
        return null;
      }
      case 'catch': {
        if (!this.vulnerable || this.vulnerable !== a.target || a.target === id) return 'Nobody to catch.';
        const t = this.player(a.target)!;
        this.vulnerable = null;
        this.emit({ k: 'caught', by: id, target: t.id });
        this.give(t, this.rules.unoPenalty, 'catch');
        return null;
      }
      case 'challenge': {
        if (this.phase !== 'challenge' || this.current.id !== id || !this.wild4) return 'Nothing to challenge.';
        this.resolveChallenge(a.yes === true);
        return null;
      }
      case 'color': {
        if (this.phase !== 'pickColor' || this.current.id !== id) return 'Nothing to pick.';
        if (!isColor(a.color)) return 'Pick a colour.';
        this.color = a.color;
        this.emit({ k: 'color', by: id, color: a.color });
        this.beginTurn();
        return null;
      }
      case 'swap': {
        if (this.phase !== 'pickSwap' || this.current.id !== id) return 'Nothing to swap.';
        const t = this.player(a.target);
        if (!t || t === p) return 'Pick another player.';
        this.swapHands(p, t);
        this.advance(1);
        return null;
      }
    }
    // Jump-in: the same card, out of turn — the turn moves to whoever slapped it down.
    let jump = false;
    if (a.t === 'play' && this.current.id !== id) {
      const card = p.hand.find((c) => c.id === a.card);
      if (!card || !this.canJump(card)) return this.rules.jumpIn ? 'Only an identical card can jump in.' : "It's not your turn.";
      this.cur = this.idx(id);
      jump = true;
    }
    if (this.current.id !== id) return "It's not your turn.";
    if (this.phase === 'challenge') return 'Challenge or accept the Wild Draw Four first.';
    if (this.phase === 'pickColor') return 'Pick a colour first.';
    if (this.phase === 'pickSwap') return 'Pick who to swap hands with first.';
    // The next player acting ends the window to catch someone.
    if (this.vulnerable && this.vulnerable !== id) this.vulnerable = null;
    switch (a.t) {
      case 'play': {
        const card = p.hand.find((c) => c.id === a.card);
        if (!card) return "You don't have that card.";
        if (jump) {
          this.phase = 'play';
          this.drawnId = -1;
        } else if (!this.canPlay(card)) return this.pendingDraw ? `Stack a Draw card or take ${this.pendingDraw}.` : "That card doesn't match.";
        const wild = card.kind === 'wild' || card.kind === 'wild4';
        if (wild && !isColor(a.color)) return 'Pick a colour.';
        const bluff = card.kind === 'wild4' && this.isBluff(p, card.id);
        p.hand.splice(p.hand.indexOf(card), 1);
        this.discard.push(card);
        this.color = wild ? a.color! : card.color;
        this.drawnId = -1;
        this.emit({ k: 'play', by: id, card, color: this.color, left: p.hand.length, jump: jump || undefined, bluff: card.kind === 'wild4' ? bluff : undefined });
        if (p.hand.length === 1 && !p.called) this.vulnerable = id;
        if (!p.hand.length) {
          this.endRound(p);
          return null;
        }
        this.applyEffect(card, bluff);
        return null;
      }
      case 'draw': {
        if (this.phase === 'drawn') return 'Play the card you drew, or keep it.';
        if (this.pendingDraw > 0) {
          const n = this.pendingDraw;
          this.pendingDraw = 0;
          this.pendingKind = null;
          this.give(p, n, 'stack');
          this.advance(1);
          return null;
        }
        if (this.mustPlay()) return 'You have a playable card — play it!';
        let got = this.give(p, 1, 'turn');
        while (this.rules.drawToMatch && got.length && !this.canPlay(got[0]!) && this.draw.length + this.discard.length > 1) got = this.give(p, 1, 'match');
        const c = got[0];
        if (c && this.canPlay(c)) {
          this.phase = 'drawn';
          this.drawnId = c.id;
        } else this.advance(1);
        return null;
      }
      case 'keep': {
        if (this.phase !== 'drawn') return 'Nothing to keep.';
        if (this.mustPlay()) return 'You must play the card you drew.';
        this.emit({ k: 'keep', by: id });
        this.advance(1);
        return null;
      }
    }
    return 'Unknown action.';
  }

  private applyEffect(card: Card, bluff: boolean): void {
    const n = this.players.length;
    switch (card.kind) {
      case 'skip':
        this.emit({ k: 'skip', target: this.players[this.next()]!.id });
        this.advance(2);
        return;
      case 'rev':
        if (n === 2) {
          this.emit({ k: 'skip', target: this.players[this.next()]!.id });
          this.advance(2);
        } else {
          this.dir = this.dir === 1 ? -1 : 1;
          this.emit({ k: 'reverse', dir: this.dir });
          this.advance(1);
        }
        return;
      case 'draw2':
        if (this.rules.stacking) {
          this.pendingDraw += 2;
          this.pendingKind = 'draw2';
          this.emit({ k: 'stack', total: this.pendingDraw });
          this.advance(1);
        } else {
          const victim = this.players[this.next()]!;
          this.give(victim, 2, 'penalty');
          this.emit({ k: 'skip', target: victim.id });
          this.advance(2);
        }
        return;
      case 'wild4':
        if (this.rules.stacking) {
          this.pendingDraw += 4;
          this.pendingKind = 'wild4';
          this.emit({ k: 'stack', total: this.pendingDraw });
          this.advance(1);
        } else if (!this.rules.challenge) {
          const victim = this.players[this.next()]!;
          this.give(victim, 4, 'penalty');
          this.emit({ k: 'skip', target: victim.id });
          this.advance(2);
        } else {
          this.wild4 = { by: this.current.id, guilty: bluff };
          this.cur = this.next();
          this.phase = 'challenge';
          this.turnLeft = this.rules.turnTime ? Math.min(this.rules.turnTime, 15) : 0;
          this.emit({ k: 'turn', player: this.current.id });
        }
        return;
      case 'num':
        if (this.rules.sevenZero && card.n === 0 && n > 1) {
          this.rotateHands();
          this.advance(1);
          return;
        }
        if (this.rules.sevenZero && card.n === 7) {
          if (n === 2) {
            this.swapHands(this.current, this.players[this.next()]!);
            this.advance(1);
          } else {
            // Same player, but they still have to pick a victim.
            this.phase = 'pickSwap';
            this.turnLeft = this.rules.turnTime;
          }
          return;
        }
        this.advance(1);
        return;
      default:
        this.advance(1);
    }
  }

  /** 7-0 rule: trade hands. The actor keeps their "last card" status only if the new hand is one card. */
  private swapHands(a: Player, b: Player): void {
    [a.hand, b.hand] = [b.hand, a.hand];
    this.emit({ k: 'swap', by: a.id, with: b.id });
    this.afterHandChange([a, b]);
  }

  private rotateHands(): void {
    const hands = this.players.map((p) => p.hand);
    for (let i = 0; i < this.players.length; i++) this.players[this.next(i)]!.hand = hands[i]!;
    this.emit({ k: 'rotate', dir: this.dir });
    this.afterHandChange(this.players);
  }

  private afterHandChange(changed: Player[]): void {
    for (const p of changed) if (p.hand.length !== 1) p.called = false;
    const me = this.current;
    this.vulnerable = me.hand.length === 1 && !me.called ? me.id : null;
  }

  private resolveChallenge(yes: boolean): void {
    const w = this.wild4!;
    this.wild4 = null;
    const challenger = this.current;
    const offender = this.player(w.by)!;
    this.emit({ k: 'challenge', by: challenger.id, target: offender.id, yes, guilty: w.guilty });
    if (yes && w.guilty) {
      // Caught bluffing: the offender draws 4, the challenger plays normally.
      this.give(offender, 4, 'challenge');
      this.beginTurn();
    } else {
      this.give(challenger, yes ? 6 : 4, yes ? 'challenge' : 'penalty');
      this.emit({ k: 'skip', target: challenger.id });
      this.advance(1);
    }
  }

  private advance(steps: number): void {
    this.cur = this.next(this.cur, steps);
    this.beginTurn();
  }

  // ---------------------------------------------------------------- time

  update(dt: number): void {
    if (this.phase === 'roundOver') {
      this.pauseLeft -= dt;
      if (this.pauseLeft <= 0) this.startRound();
      return;
    }
    if (this.phase === 'over' || !this.rules.turnTime) return;
    this.turnLeft -= dt;
    if (this.turnLeft > 0) return;
    const p = this.current;
    this.emit({ k: 'timeout', by: p.id });
    this.autoAct(p.id);
  }

  /** What an idle / disconnected player does: accept, draw, keep (or the forced play). */
  autoAct(id: string): void {
    const p = this.current;
    if (p.id !== id) return;
    if (this.phase === 'challenge') this.act(id, { t: 'challenge', yes: false });
    else if (this.phase === 'pickColor') this.act(id, { t: 'color', color: dominantColor(p.hand) });
    else if (this.phase === 'pickSwap') {
      const others = this.players.filter((q) => q !== p).sort((a, b) => a.hand.length - b.hand.length);
      this.act(id, { t: 'swap', target: others[0]!.id });
    } else if (this.phase === 'drawn') {
      if (this.mustPlay()) this.playAny(p);
      else this.act(id, { t: 'keep' });
    } else if (this.phase === 'play') {
      if (this.mustPlay()) this.playAny(p);
      else {
        this.act(id, { t: 'draw' });
        if ((this.phase as Phase) === 'drawn' && this.current.id === id) {
          if (this.mustPlay()) this.playAny(p);
          else this.act(id, { t: 'keep' });
        }
      }
    }
  }

  private playAny(p: Player): void {
    const c = p.hand.find((x) => this.canPlay(x));
    if (c) this.act(p.id, { t: 'play', card: c.id, color: dominantColor(p.hand.filter((x) => x !== c)) });
  }

  /** A player left: their cards go under the deck. */
  leave(id: string): void {
    const i = this.idx(id);
    if (i < 0 || this.phase === 'over') return;
    const p = this.players[i]!;
    const wasCurrent = i === this.cur;
    this.draw.push(...p.hand);
    p.hand = [];
    this.players.splice(i, 1);
    this.emit({ k: 'left', by: id });
    if (this.vulnerable === id) this.vulnerable = null;
    if (this.wild4?.by === id) this.wild4 = null;
    if (i < this.cur) this.cur--;
    if (this.cur >= this.players.length) this.cur = 0;
    if (this.players.length < 2) {
      this.cur = 0;
      this.finish(this.players[0]?.id ?? id);
      return;
    }
    if (this.dealer >= this.players.length) this.dealer = 0;
    if (wasCurrent) {
      this.cur = ((this.dir === 1 ? i : i - 1) + this.players.length) % this.players.length;
      this.pendingDraw = 0;
      this.pendingKind = null;
      this.wild4 = null;
      if (this.phase === 'pickColor') this.color = COLORS[Math.floor(Math.random() * 4)]!;
      if (this.phase !== 'roundOver') this.beginTurn();
    }
  }
}

/** The colour a hand holds the most of (random on an empty / all-wild hand). */
export function dominantColor(hand: Card[]): Color {
  const counts: Record<Color, number> = { r: 0, y: 0, g: 0, b: 0 };
  for (const c of hand) if (c.color) counts[c.color]++;
  let best = COLORS[Math.floor(Math.random() * 4)]!;
  for (const c of COLORS) if (counts[c] > counts[best]) best = c;
  return best;
}

export function shuffle<T>(a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}
