import { DECKS, GODCAT_AS, IMPLODING_PACK, title, type Card, type CardType, type DeckId } from './cards';

/**
 * Kitten Kaboom rules engine (pure logic, runs in the browser for bot games and on
 * the server for online games). Time-based only for the Nope window and prompt
 * timeouts — call update(dt). Hidden information is handled by view.ts.
 */

export interface PlayerSetup {
  id: string;
  name: string;
  bot: boolean;
  avatar: number;
}

export interface Player extends PlayerSetup {
  hand: Card[];
  alive: boolean;
  /** Draw-pile card ids whose identity this player knows (position is derived). */
  knows: Set<number>;
  connected: boolean;
  /** The card that took this player out (kittens are removed from play, not discarded). */
  out: Card | null;
}

export type Effect =
  | { k: 'attack' }
  | { k: 'targeted'; target: string }
  | { k: 'skip' }
  | { k: 'favor'; target: string }
  | { k: 'shuffle' }
  | { k: 'future' }
  | { k: 'reveal' }
  | { k: 'heck' }
  | { k: 'armageddon' }
  | { k: 'reverse' }
  | { k: 'bottom' }
  | { k: 'alter' }
  | { k: 'five' }
  | { k: 'steal2'; target: string }
  | { k: 'steal3'; target: string; named: string };

export interface Pending {
  id: number;
  by: string;
  cards: Card[];
  effect: Effect;
  /** Card the Angel Cat was played as. */
  as?: CardType;
  nopes: number;
  deadline: number;
  /** Players who let this action through (it resolves early once every possible Noper passed). */
  passed: string[];
  /** Earliest resolve time (so the play animation can be seen). */
  minAt: number;
}

export type Prompt =
  | { id: number; k: 'insert'; player: string; size: number; kind: 'kitten' | 'imploding'; deadline: number }
  | { id: number; k: 'give'; player: string; to: string; deadline: number }
  | { id: number; k: 'fan'; player: string; from: string; order: number[]; deadline: number }
  | { id: number; k: 'heck'; player: string; card: Card; deadline: number }
  | { id: number; k: 'reorder'; player: string; cards: Card[]; deadline: number }
  | { id: number; k: 'rummage'; player: string; deadline: number }
  | { id: number; k: 'armDeal'; player: string; deadline: number }
  | { id: number; k: 'armPick'; player: string; against: string; deadline: number };

export type Choice = number | string | number[] | { target: string; give: 'godcat' | 'devilcat' };

export type Action =
  | { t: 'play'; cards: number[]; target?: string; as?: CardType; named?: string }
  | { t: 'draw' }
  /** `expect`: the Nope count this answers (stale clicks after someone else Noped are rejected). */
  | { t: 'nope'; card: number; expect?: number }
  | { t: 'pass' }
  | { t: 'respond'; prompt: number; choice: Choice };

/** `vis`: who sees the full event (others get it redacted); omitted = everyone. */
export type GameEvent = { vis?: string[] } & (
  | { k: 'start'; deck: DeckId }
  | { k: 'turn'; player: string; turns: number }
  | { k: 'play'; by: string; cards: Card[]; target?: string; as?: CardType; named?: string }
  | { k: 'nope'; by: string; card: Card; count: number }
  | { k: 'resolve'; ok: boolean; effect: Effect['k'] }
  | { k: 'draw'; by: string; card?: Card; bottom?: boolean }
  | { k: 'explode'; by: string; card: Card }
  | { k: 'defuse'; by: string; card: Card }
  | { k: 'insert'; by: string; index?: number; card?: Card; kind: 'kitten' | 'imploding' }
  | { k: 'eliminated'; by: string; card?: Card }
  | { k: 'steal'; from: string; to: string; card?: Card }
  | { k: 'give'; from: string; to: string; card?: Card }
  | { k: 'missed'; from: string; to: string; named: string }
  | { k: 'shuffle'; by: string }
  | { k: 'future'; by: string; cards?: Card[] }
  | { k: 'reveal'; by: string; cards: Card[] }
  | { k: 'alter'; by: string }
  | { k: 'reverse'; by: string; dir: 1 | -1 }
  | { k: 'rummage'; by: string; card: Card }
  | { k: 'heckTop'; by: string; card?: Card }
  | { k: 'attacked'; by: string; target: string; turns: number }
  | { k: 'armStart'; by: string }
  | { k: 'armDeal'; by: string; target: string }
  | { k: 'armPick'; by: string; swap: boolean }
  | { k: 'armReveal'; god: string; devil: string }
  | { k: 'godcatHome'; by: string }
  | { k: 'win'; by: string }
);

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface Rules {
  /** Keep the whole deck with 2–3 players (house rule: a third is dropped for a faster game). */
  fullDeck: boolean;
  /** Any two cards with the same name pair up (current rulebook) — otherwise cat cards only (classic). */
  anyPairs: boolean;
  /** Imploding Kittens pack. */
  imploding: boolean;
}

export interface EngineOptions extends Partial<Rules> {
  deck: DeckId;
  seed?: number;
  /** Seconds others get to Nope an action. */
  nopeWindow?: number;
  /** Seconds before a prompt picks a default (0 = wait forever). */
  promptTimeout?: number;
  /** Seconds before an idle turn auto-draws (0 = never). */
  turnTimeout?: number;
}

export class KittensEngine {
  readonly players: Player[];
  readonly deckId: DeckId;
  readonly rules: Rules;
  draw: Card[] = [];
  discard: Card[] = [];
  /** Cards out of the game (the kittens that blew someone up). */
  removed: Card[] = [];
  mat: { godcat: Card | null; devilcat: Card };
  current = 0;
  turns = 1;
  /** Turn direction (Reverse flips it). */
  dir: 1 | -1 = 1;
  phase: 'play' | 'nope' | 'prompt' | 'over' = 'play';
  pending: Pending | null = null;
  prompt: Prompt | null = null;
  winner: string | null = null;
  events: GameEvent[] = [];
  /** Monotonic event counter (clients use it to request missed events). */
  eventSeq = 0;
  time = 0;
  turnDeadline = 0;
  private nextId = 1;
  private rng: number;
  private readonly opt: Required<EngineOptions>;
  /** Armageddon in progress. */
  private arm: { by: string; target: string; giveTarget: 'godcat' | 'devilcat'; swap: boolean } | null = null;
  /** After an explosion is defused: how many turns the defuser still owes. */
  private afterInsert: (() => void) | null = null;

  constructor(setups: PlayerSetup[], options: EngineOptions) {
    const def = DECKS[options.deck];
    this.opt = { seed: (Math.random() * 2 ** 31) | 0, nopeWindow: 2.4, promptTimeout: 0, turnTimeout: 0, fullDeck: false, anyPairs: def.anyPairs, imploding: false, ...options };
    this.rules = { fullDeck: this.opt.fullDeck, anyPairs: this.opt.anyPairs, imploding: this.opt.imploding };
    this.rng = this.opt.seed || 7;
    this.deckId = options.deck;
    this.players = setups.map((s) => ({ ...s, hand: [], alive: true, knows: new Set(), connected: true, out: null }));
    this.mat = { godcat: options.deck === 'gve' ? this.card('godcat') : null, devilcat: this.card('devilcat') };
    this.setup();
  }

  // ------------------------------------------------------------------ helpers

  private rand(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  private shuffleInPlace<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  private card(type: CardType, cat?: Card['cat']): Card {
    return { id: this.nextId++, type, cat };
  }

  private emit(e: GameEvent): void {
    this.events.push(e);
    this.eventSeq++;
  }

  /** (A getter, so TypeScript doesn't narrow `phase` across calls that change it.) */
  get isOver(): boolean {
    return this.phase === 'over';
  }

  player(id: string): Player {
    return this.players.find((p) => p.id === id)!;
  }

  get currentPlayer(): Player {
    return this.players[this.current]!;
  }

  alive(): Player[] {
    return this.players.filter((p) => p.alive);
  }

  /** Cards in the pile that blow you up when drawn (a face-up Imploding Kitten counts). */
  kittensInPile(): number {
    return this.draw.filter((c) => c.type === 'kitten' || (c.type === 'imploding' && c.faceUp)).length;
  }

  private nextAliveIndex(from: number): number {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + k * this.dir) % n) + n) % n;
      if (this.players[i]!.alive) return i;
    }
    return from;
  }

  /** Everyone but `keep` forgets where things are in the pile (face-up cards stay visible). */
  private forgetPile(keep?: Player): void {
    for (const x of this.players) {
      if (x === keep) continue;
      const faceUp = [...x.knows].filter((id) => this.draw.find((c) => c.id === id)?.faceUp);
      x.knows.clear();
      for (const id of faceUp) x.knows.add(id);
    }
  }

  // ------------------------------------------------------------------ setup

  private setup(): void {
    const def = DECKS[this.deckId];
    const n = this.players.length;
    const body: Card[] = [];
    const counts: Partial<Record<CardType, number>> = { ...def.counts };
    if (this.rules.imploding) {
      for (const [type, count] of Object.entries(IMPLODING_PACK.counts) as Array<[CardType, number]>) counts[type] = (counts[type] ?? 0) + count;
      if (!counts.feral) counts.feral = IMPLODING_PACK.feral;
    }
    for (const [type, count] of Object.entries(counts) as Array<[CardType, number]>) {
      if (type === 'kitten' || type === 'defuse') continue;
      for (let i = 0; i < count; i++) body.push(this.card(type));
    }
    for (const cat of def.cats) for (let i = 0; i < def.catCount; i++) body.push(this.card('cat', cat));
    this.shuffleInPlace(body);
    // Deal 7 + a Defuse each.
    for (const p of this.players) {
      p.hand = body.splice(0, 7);
      p.hand.push(this.card('defuse'));
    }
    // House rule for a faster 2–3 player game: drop a third of what's left (off with "Full deck").
    if (n <= 3 && !this.rules.fullDeck) body.splice(0, Math.floor(body.length / 3));
    const extraDefuses = Math.min(Math.max(0, (def.counts.defuse ?? 6) - n), n >= 5 ? 1 : 2);
    for (let i = 0; i < extraDefuses; i++) body.push(this.card('defuse'));
    // One kitten fewer than players; the Imploding Kitten takes one kitten's place (never the only bomb).
    const kittens = this.rules.imploding ? Math.max(1, n - 2) : n - 1;
    for (let i = 0; i < kittens; i++) body.push(this.card('kitten'));
    if (this.rules.imploding) body.push(this.card('imploding'));
    this.draw = this.shuffleInPlace(body);
    this.current = Math.floor(this.rand() * n);
    this.turns = 1;
    this.emit({ k: 'start', deck: this.deckId });
    this.beginTurn();
  }

  private beginTurn(): void {
    this.phase = 'play';
    this.turnDeadline = this.opt.turnTimeout ? this.time + this.opt.turnTimeout : 0;
    this.emit({ k: 'turn', player: this.currentPlayer.id, turns: this.turns });
  }

  // ------------------------------------------------------------------ actions

  /** Returns an error message, or null when the action was accepted. */
  act(playerId: string, a: Action): string | null {
    if (this.phase === 'over') return 'The game is over.';
    const p = this.players.find((x) => x.id === playerId);
    if (!p || !p.alive) return 'You are out.';
    switch (a.t) {
      case 'draw':
        if (this.phase !== 'play' || this.currentPlayer !== p) return "It's not your turn.";
        this.drawCard(p, false);
        return null;
      case 'nope':
        return this.nope(p, a.card, a.expect);
      case 'pass':
        if (this.phase !== 'nope' || !this.pending) return null;
        if (!this.pending.passed.includes(p.id)) this.pending.passed.push(p.id);
        return null;
      case 'play':
        if (this.phase !== 'play' || this.currentPlayer !== p) return "It's not your turn.";
        return this.play(p, a);
      case 'respond':
        return this.respond(p, a.prompt, a.choice);
    }
  }

  /** Card types the Angel Cat may become in this game. */
  canPlayAs(type: CardType): boolean {
    if (!GODCAT_AS.includes(type)) return false;
    if (type === 'skip' || type === 'future') return this.deckId === 'classic';
    if (type === 'reveal' || type === 'heck') return this.deckId === 'gve';
    if (type === 'reverse' || type === 'bottom' || type === 'alter') return this.rules.imploding;
    return true;
  }

  private play(p: Player, a: Extract<Action, { t: 'play' }>): string | null {
    const cards = a.cards.map((id) => p.hand.find((c) => c.id === id));
    if (!cards.length || cards.some((c) => !c) || new Set(a.cards).size !== a.cards.length) return 'You do not have those cards.';
    const list = cards as Card[];
    const others = (t?: string) => (t && t !== p.id && this.players.find((x) => x.id === t && x.alive) ? t : null);
    let effect: Effect;
    let as: CardType | undefined;
    if (list.length === 1) {
      const c = list[0]!;
      let type = c.type;
      if (type === 'godcat') {
        if (!a.as || !this.canPlayAs(a.as)) return 'Choose what the Angel Cat becomes.';
        type = a.as;
        as = a.as;
      }
      switch (type) {
        case 'attack':
          effect = { k: 'attack' };
          break;
        case 'targeted': {
          const t = others(a.target);
          if (!t) return 'Choose a player to attack.';
          effect = { k: 'targeted', target: t };
          break;
        }
        case 'skip':
          effect = { k: 'skip' };
          break;
        case 'favor': {
          // An empty-handed target is allowed: the Favor simply fizzles.
          const t = others(a.target);
          if (!t) return 'Choose a player.';
          effect = { k: 'favor', target: t };
          break;
        }
        case 'shuffle':
          effect = { k: 'shuffle' };
          break;
        case 'future':
          effect = { k: 'future' };
          break;
        case 'reveal':
          effect = { k: 'reveal' };
          break;
        case 'heck':
          effect = { k: 'heck' };
          break;
        case 'reverse':
          effect = { k: 'reverse' };
          break;
        case 'bottom':
          effect = { k: 'bottom' };
          break;
        case 'alter':
          effect = { k: 'alter' };
          break;
        case 'armageddon':
          if (!this.mat.godcat) return 'Armageddon needs the Angel Cat on the playmat.';
          if (this.alive().length < 2) return 'No one to battle.';
          effect = { k: 'armageddon' };
          break;
        default:
          return `${type === 'defuse' ? 'Defuse is played automatically when you explode' : type === 'nope' ? 'Nope is played on someone else’s action' : 'That card does nothing alone — pair it up'}.`;
      }
    } else if (list.length === 5) {
      // Five different cards: take any card from the discard pile.
      if (list.some((c) => c.type === 'godcat')) return 'The Angel Cat can’t join a combo.';
      if (new Set(list.map(title)).size !== 5) return 'Five different cards needed.';
      effect = { k: 'five' };
    } else {
      if (list.length > 3) return 'Play one card, a pair, three of a kind — or five different cards.';
      if (list.some((c) => c.type === 'godcat')) return 'The Angel Cat can’t join a combo.';
      // Pairs/triples: same title (Feral matches any cat card; any title counts with "any pairs").
      const titles = list.filter((c) => c.type !== 'feral').map(title);
      const catTitles = titles.every((t) => t.startsWith('cat:'));
      if (titles.length && new Set(titles).size > 1) return 'Combos need matching cards.';
      if (list.some((c) => c.type === 'feral') && titles.length && !catTitles) return 'Feral Cat only matches cat cards.';
      if (!this.rules.anyPairs && !catTitles) return 'Only cat cards make pairs in this game.';
      const t = others(a.target);
      if (!t) return 'Choose a player to steal from.';
      if (!this.player(t).hand.length) return 'They have no cards.';
      if (list.length === 2) effect = { k: 'steal2', target: t };
      else {
        if (!a.named) return 'Name the card you want.';
        effect = { k: 'steal3', target: t, named: a.named };
      }
    }
    // Move the cards to the discard pile (the Angel Cat goes home after resolving).
    for (const c of list) p.hand.splice(p.hand.indexOf(c), 1);
    for (const c of list) if (c.type !== 'godcat') this.discard.push(c);
    if (as) {
      this.mat.godcat = list[0]!;
      this.emit({ k: 'godcatHome', by: p.id });
    }
    const target = 'target' in effect ? effect.target : undefined;
    this.emit({ k: 'play', by: p.id, cards: list, target, as, named: effect.k === 'steal3' ? effect.named : undefined });
    this.pending = { id: this.nextId++, by: p.id, cards: list, effect, as, nopes: 0, deadline: this.time + this.opt.nopeWindow, passed: [], minAt: this.time + 0.45 };
    this.phase = 'nope';
    return null;
  }

  private nope(p: Player, cardId: number, expect?: number): string | null {
    if (this.phase !== 'nope' || !this.pending) return 'Nothing to Nope right now.';
    // A Nope aimed at an older state of the stack (someone else just Noped) is dropped, not flipped.
    if (expect !== undefined && expect !== this.pending.nopes) return 'Too late — someone beat you to it.';
    if (p.id === this.pending.by && this.pending.nopes % 2 === 0) return 'You can’t Nope your own action.';
    const c = p.hand.find((x) => x.id === cardId && x.type === 'nope');
    if (!c) return 'You need a Nope card.';
    p.hand.splice(p.hand.indexOf(c), 1);
    this.discard.push(c);
    this.pending.nopes++;
    this.pending.deadline = this.time + this.opt.nopeWindow;
    this.pending.passed = [];
    this.pending.minAt = this.time + 0.45;
    this.emit({ k: 'nope', by: p.id, card: c, count: this.pending.nopes });
    return null;
  }

  // ------------------------------------------------------------------ time

  update(dt: number): void {
    if (this.phase === 'over') return;
    this.time += dt;
    if (this.phase === 'nope' && this.pending) {
      // Resolve when the window closes — or as soon as nobody who could Nope still might.
      const pd = this.pending;
      const waiting = this.noperCandidates().some((p) => !pd.passed.includes(p.id));
      if (this.time >= pd.deadline || (!waiting && this.time >= pd.minAt)) this.resolvePending();
    }
    if (this.phase === 'prompt' && this.prompt && this.prompt.deadline && this.time >= this.prompt.deadline) this.respond(this.player(this.prompt.player), this.prompt.id, this.defaultChoice(this.prompt), true);
    if (this.phase === 'play' && this.turnDeadline && this.time >= this.turnDeadline) this.drawCard(this.currentPlayer, false);
  }

  /** Who could still respond to the pending action: Nope holders (the actor only to "Yup" a Nope). */
  noperCandidates(): Player[] {
    const pd = this.pending;
    if (!pd) return [];
    return this.alive().filter((p) => p.hand.some((c) => c.type === 'nope') && (p.id !== pd.by || pd.nopes % 2 === 1));
  }

  // ------------------------------------------------------------------ resolution

  private resolvePending(): void {
    const pd = this.pending!;
    this.pending = null;
    const ok = pd.nopes % 2 === 0;
    this.emit({ k: 'resolve', ok, effect: pd.effect.k });
    this.phase = 'play';
    this.turnDeadline = this.opt.turnTimeout ? this.time + this.opt.turnTimeout : 0;
    const p = this.player(pd.by);
    if (!ok || !p.alive) return this.afterAction();
    const e = pd.effect;
    switch (e.k) {
      case 'attack':
      case 'targeted': {
        const target = e.k === 'targeted' ? this.players.findIndex((x) => x.id === e.target) : this.nextAliveIndex(this.current);
        const turns = (this.turns > 1 ? this.turns : 0) + 2;
        this.emit({ k: 'attacked', by: p.id, target: this.players[target]!.id, turns });
        this.current = target;
        this.turns = turns;
        this.beginTurn();
        return;
      }
      case 'skip':
        this.endOneTurn();
        return;
      case 'reverse':
        this.dir = this.dir === 1 ? -1 : 1;
        this.emit({ k: 'reverse', by: p.id, dir: this.dir });
        this.endOneTurn();
        return;
      case 'bottom':
        this.drawCard(p, true);
        return;
      case 'favor': {
        const t = this.player(e.target);
        if (!t.alive || !t.hand.length) return this.afterAction();
        this.ask({ k: 'give', player: t.id, to: p.id });
        return;
      }
      case 'shuffle':
        this.shuffleInPlace(this.draw);
        this.forgetPile();
        this.emit({ k: 'shuffle', by: p.id });
        return this.afterAction();
      case 'future': {
        const top = this.draw.slice(0, 3);
        for (const c of top) p.knows.add(c.id);
        this.emit({ k: 'future', by: p.id, cards: top, vis: [p.id] });
        return this.afterAction();
      }
      case 'alter': {
        const top = this.draw.slice(0, 3);
        if (!top.length) return this.afterAction();
        for (const c of top) p.knows.add(c.id);
        this.ask({ k: 'reorder', player: p.id, cards: top });
        return;
      }
      case 'reveal': {
        const top = this.draw.slice(0, 3);
        for (const x of this.players) for (const c of top) x.knows.add(c.id);
        this.emit({ k: 'reveal', by: p.id, cards: top });
        return this.afterAction();
      }
      case 'heck': {
        const card = this.draw.pop();
        if (!card) return this.endOneTurn();
        this.emit({ k: 'draw', by: p.id, card: { ...card }, bottom: true, vis: card.faceUp ? undefined : [p.id] });
        this.ask({ k: 'heck', player: p.id, card });
        return;
      }
      case 'five':
        if (!this.discard.length) return this.afterAction();
        this.ask({ k: 'rummage', player: p.id });
        return;
      case 'armageddon':
        if (!this.mat.godcat) return this.afterAction();
        this.emit({ k: 'armStart', by: p.id });
        this.ask({ k: 'armDeal', player: p.id });
        return;
      case 'steal2': {
        const t = this.player(e.target);
        if (!t.alive || !t.hand.length) return this.afterAction();
        this.ask({ k: 'fan', player: p.id, from: t.id, order: this.shuffleInPlace(t.hand.map((c) => c.id)) });
        return;
      }
      case 'steal3': {
        const t = this.player(e.target);
        const c = t.hand.find((x) => title(x) === e.named || (e.named === 'godcat' && x.type === 'godcat'));
        if (!c) {
          this.emit({ k: 'missed', from: t.id, to: p.id, named: e.named });
          return this.afterAction();
        }
        this.transfer(t, p, c, 'steal');
        return this.afterAction();
      }
    }
  }

  private transfer(from: Player, to: Player, c: Card, kind: 'steal' | 'give'): void {
    from.hand.splice(from.hand.indexOf(c), 1);
    // A card owed to someone who already left the table goes to the discard pile instead.
    if (to.alive) to.hand.push(c);
    else this.discard.push(c);
    this.emit({ k: kind, from: from.id, to: to.id, card: c, vis: [from.id, to.id] });
  }

  private afterAction(): void {
    if (this.phase === 'over') return;
    this.phase = 'play';
    // The acting player may have left mid-action.
    if (!this.currentPlayer.alive) {
      this.current = this.nextAliveIndex(this.current);
      this.turns = 1;
      this.beginTurn();
    }
  }

  private ask(p: DistOmit<Prompt, 'id' | 'deadline'>): void {
    this.prompt = { ...(p as Prompt), id: this.nextId++, deadline: this.opt.promptTimeout ? this.time + this.opt.promptTimeout : 0 } as Prompt;
    this.phase = 'prompt';
  }

  defaultChoice(pr: Prompt): Choice {
    switch (pr.k) {
      case 'insert':
        // Never within the inserter's own remaining draws.
        return Math.min(pr.size, Math.max(Math.floor(this.rand() * (pr.size + 1)), this.turns - 1));
      case 'give': {
        const h = this.player(pr.player).hand;
        const sorted = [...h].sort((a, b) => worth(a) - worth(b));
        return sorted[0]!.id;
      }
      case 'fan':
        return Math.floor(this.rand() * pr.order.length);
      case 'heck':
        return pr.card.type === 'kitten' ? 'top' : 'keep';
      case 'reorder':
        return pr.cards.map((_, i) => i);
      case 'rummage':
        return [...this.discard].sort((a, b) => worth(b) - worth(a))[0]!.id;
      case 'armDeal': {
        const others = this.alive().filter((x) => x.id !== pr.player);
        return { target: others[Math.floor(this.rand() * others.length)]!.id, give: this.rand() < 0.5 ? 'godcat' : 'devilcat' };
      }
      case 'armPick':
        return this.rand() < 0.5 ? 'keep' : 'swap';
    }
  }

  private respond(p: Player, promptId: number, choice: Choice, auto = false): string | null {
    const pr = this.prompt;
    if (this.phase !== 'prompt' || !pr || pr.id !== promptId || pr.player !== p.id) return auto ? null : 'Nothing to answer.';
    switch (pr.k) {
      case 'insert': {
        const i = Math.max(0, Math.min(pr.size, Math.round(Number(choice))));
        if (!Number.isFinite(i)) return 'Pick a position.';
        this.prompt = null;
        const kitten = this.discardKittenFor();
        this.draw.splice(i, 0, kitten);
        if (pr.kind === 'imploding') {
          // Goes back face up: everyone sees exactly where it sits.
          kitten.faceUp = true;
          for (const x of this.players) x.knows.add(kitten.id);
          this.emit({ k: 'insert', by: p.id, index: i, card: { ...kitten }, kind: 'imploding' });
        } else {
          // Secret: everything others knew about pile positions has shifted, so they forget it all
          // (keeping it would mark the kitten by the gap it leaves).
          this.forgetPile(p);
          p.knows.add(kitten.id);
          this.emit({ k: 'insert', by: p.id, index: i, card: kitten, kind: 'kitten', vis: [p.id] });
        }
        const then = this.afterInsert;
        this.afterInsert = null;
        this.phase = 'play';
        then?.();
        return null;
      }
      case 'give': {
        const c = p.hand.find((x) => x.id === choice) ?? p.hand[0];
        if (!c) return 'Pick a card.';
        this.prompt = null;
        this.transfer(p, this.player(pr.to), c, 'give');
        this.afterAction();
        return null;
      }
      case 'fan': {
        const idx = Math.max(0, Math.min(pr.order.length - 1, Math.round(Number(choice))));
        const from = this.player(pr.from);
        const c = from.hand.find((x) => x.id === pr.order[idx]) ?? from.hand[0];
        this.prompt = null;
        if (c) this.transfer(from, p, c, 'steal');
        this.afterAction();
        return null;
      }
      case 'heck': {
        this.prompt = null;
        if (choice === 'top') {
          this.draw.unshift(pr.card);
          p.knows.add(pr.card.id);
          if (pr.card.faceUp) for (const x of this.players) x.knows.add(pr.card.id);
          this.emit({ k: 'heckTop', by: p.id, card: pr.card, vis: pr.card.faceUp ? undefined : [p.id] });
          this.endOneTurn();
        } else {
          this.receive(p, pr.card);
        }
        return null;
      }
      case 'reorder': {
        const n = pr.cards.length;
        const order = Array.isArray(choice) ? choice.map((x) => Math.round(Number(x))) : null;
        const valid = order && order.length === n && new Set(order).size === n && order.every((i) => i >= 0 && i < n);
        if (!valid && !auto) return 'Put the cards in an order.';
        this.prompt = null;
        const top = valid ? order.map((i) => pr.cards[i]!) : pr.cards;
        this.draw.splice(0, n, ...top);
        // Others who had seen these cards no longer know the order (face-up cards stay visible).
        for (const x of this.players) if (x !== p) for (const c of top) if (!c.faceUp) x.knows.delete(c.id);
        this.emit({ k: 'alter', by: p.id });
        this.afterAction();
        return null;
      }
      case 'rummage': {
        const c = this.discard.find((x) => x.id === choice);
        if (!c) return 'Pick a card from the discard pile.';
        this.prompt = null;
        this.discard.splice(this.discard.indexOf(c), 1);
        p.hand.push(c);
        this.emit({ k: 'rummage', by: p.id, card: c });
        this.afterAction();
        return null;
      }
      case 'armDeal': {
        const c = choice as { target: string; give: 'godcat' | 'devilcat' };
        const t = this.players.find((x) => x.id === c?.target && x.alive && x.id !== p.id);
        if (!t || (c.give !== 'godcat' && c.give !== 'devilcat')) return 'Choose a player and a card.';
        this.prompt = null;
        this.arm = { by: p.id, target: t.id, giveTarget: c.give, swap: false };
        this.emit({ k: 'armDeal', by: p.id, target: t.id });
        this.ask({ k: 'armPick', player: t.id, against: p.id });
        return null;
      }
      case 'armPick': {
        const arm = this.arm!;
        this.prompt = null;
        arm.swap = choice === 'swap';
        this.emit({ k: 'armPick', by: p.id, swap: arm.swap });
        const targetGets = arm.swap ? (arm.giveTarget === 'godcat' ? 'devilcat' : 'godcat') : arm.giveTarget;
        const god = targetGets === 'godcat' ? arm.target : arm.by;
        const devil = targetGets === 'godcat' ? arm.by : arm.target;
        this.emit({ k: 'armReveal', god, devil });
        const godcat = this.mat.godcat!;
        this.mat.godcat = null;
        this.player(god).hand.push(godcat);
        this.arm = null;
        const starter = this.player(arm.by);
        // The Demon Cat explodes whoever holds it: Defuse (or the Angel Cat) or die. No reinsertion.
        const victim = this.player(devil);
        const saver = victim.hand.find((x) => x.type === 'defuse') ?? victim.hand.find((x) => x.type === 'godcat');
        this.emit({ k: 'explode', by: victim.id, card: this.mat.devilcat });
        if (saver) {
          victim.hand.splice(victim.hand.indexOf(saver), 1);
          if (saver.type === 'godcat') this.mat.godcat = saver;
          else this.discard.push(saver);
          this.emit({ k: 'defuse', by: victim.id, card: saver });
        } else {
          this.eliminate(victim, this.mat.devilcat);
          if (this.isOver) return null;
        }
        // Armageddon ends the starter's turn (one of them) without drawing.
        if (starter.alive) this.endOneTurn();
        else this.advanceAfterDeath(starter);
        return null;
      }
    }
  }

  // ------------------------------------------------------------------ drawing & exploding

  private drawCard(p: Player, bottom: boolean): void {
    const c = bottom ? this.draw.pop() : this.draw.shift();
    if (!c) return this.endOneTurn();
    for (const x of this.players) x.knows.delete(c.id);
    const bomb = c.type === 'kitten' || c.type === 'imploding';
    this.emit({ k: 'draw', by: p.id, card: { ...c }, bottom: bottom || undefined, vis: bomb ? undefined : [p.id] });
    this.receive(p, c);
  }

  /** A card arrives in hand from the pile (normal draw or Raising Heck "keep"). */
  private receive(p: Player, c: Card): void {
    if (c.type === 'imploding') {
      // (Events carry snapshots: this very card turns face up later.)
      this.emit({ k: 'explode', by: p.id, card: { ...c } });
      if (c.faceUp) {
        // Drawn face up: no Defuse can help.
        this.eliminate(p, c);
        if (!this.isOver) this.advanceAfterDeath(p);
        return;
      }
      // First time out: it goes back face up wherever the drawer likes, and that was their draw.
      this.pendingKitten = c;
      this.afterInsert = () => this.endOneTurn();
      this.ask({ k: 'insert', player: p.id, size: this.draw.length, kind: 'imploding' });
      return;
    }
    if (c.type !== 'kitten') {
      p.hand.push(c);
      this.endOneTurn();
      return;
    }
    this.emit({ k: 'explode', by: p.id, card: c });
    const saver = p.hand.find((x) => x.type === 'defuse') ?? p.hand.find((x) => x.type === 'godcat');
    if (!saver) {
      this.eliminate(p, c);
      if (!this.isOver) this.advanceAfterDeath(p);
      return;
    }
    p.hand.splice(p.hand.indexOf(saver), 1);
    if (saver.type === 'godcat') this.mat.godcat = saver;
    else this.discard.push(saver);
    this.emit({ k: 'defuse', by: p.id, card: saver });
    this.pendingKitten = c;
    this.afterInsert = () => this.endOneTurn();
    this.ask({ k: 'insert', player: p.id, size: this.draw.length, kind: 'kitten' });
  }

  private pendingKitten: Card | null = null;
  private discardKittenFor(): Card {
    const k = this.pendingKitten ?? this.card('kitten');
    this.pendingKitten = null;
    return k;
  }

  /** `by`: the card that did it (kittens leave the game with their victim; the Demon Cat stays on the mat). */
  private eliminate(p: Player, by?: Card): void {
    p.alive = false;
    p.out = by ?? null;
    if (by && by.type !== 'devilcat') this.removed.push(by);
    for (const c of p.hand) {
      if (c.type === 'godcat') this.mat.godcat = c;
      else this.discard.push(c);
    }
    p.hand = [];
    this.emit({ k: 'eliminated', by: p.id, card: by && { ...by } });
    const left = this.alive();
    if (left.length <= 1) {
      this.phase = 'over';
      this.winner = left[0]?.id ?? null;
      this.pending = null;
      this.prompt = null;
      if (this.winner) this.emit({ k: 'win', by: this.winner });
    }
  }

  private advanceAfterDeath(dead: Player): void {
    if (this.phase === 'over') return;
    const i = this.players.indexOf(dead);
    if (this.current === i) {
      this.current = this.nextAliveIndex(i);
      this.turns = 1;
      this.beginTurn();
    }
  }

  private endOneTurn(): void {
    if (this.phase === 'over') return;
    this.turns -= 1;
    if (this.turns > 0 && this.currentPlayer.alive) {
      this.beginTurn();
      return;
    }
    this.current = this.nextAliveIndex(this.current);
    this.turns = 1;
    this.beginTurn();
  }

  // ------------------------------------------------------------------ connection

  /** A player left an online game: they're out (cards discarded, Angel Cat home). */
  leave(id: string): void {
    const p = this.players.find((x) => x.id === id);
    if (!p || !p.alive || this.phase === 'over') return;
    const wasCurrent = this.currentPlayer === p;
    if (this.prompt?.player === p.id) this.respond(p, this.prompt.id, this.defaultChoice(this.prompt), true);
    this.eliminate(p);
    if (wasCurrent && !this.isOver && this.phase === 'play') this.advanceAfterDeath(p);
  }
}

/** How much a card is worth keeping (lower = give away first). */
export function worth(c: Card): number {
  return { kitten: -1, imploding: -1, cat: 1, feral: 2, shuffle: 3, bottom: 3, reveal: 4, future: 4, favor: 4, heck: 4, alter: 5, armageddon: 5, skip: 6, reverse: 6, attack: 6, targeted: 6, nope: 7, defuse: 10, godcat: 11, devilcat: 0 }[c.type];
}
