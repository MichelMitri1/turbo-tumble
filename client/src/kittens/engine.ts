import { DECKS, GODCAT_AS, title, type Card, type CardType, type DeckId } from './cards';

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
  | { id: number; k: 'insert'; player: string; size: number; deadline: number }
  | { id: number; k: 'give'; player: string; to: string; deadline: number }
  | { id: number; k: 'fan'; player: string; from: string; order: number[]; deadline: number }
  | { id: number; k: 'heck'; player: string; card: Card; deadline: number }
  | { id: number; k: 'armDeal'; player: string; deadline: number }
  | { id: number; k: 'armPick'; player: string; against: string; deadline: number };

export type Action =
  | { t: 'play'; cards: number[]; target?: string; as?: CardType; named?: string }
  | { t: 'draw' }
  | { t: 'nope'; card: number }
  | { t: 'pass' }
  | { t: 'respond'; prompt: number; choice: number | string | { target: string; give: 'godcat' | 'devilcat' } };

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
  | { k: 'insert'; by: string; index?: number }
  | { k: 'eliminated'; by: string }
  | { k: 'steal'; from: string; to: string; card?: Card }
  | { k: 'give'; from: string; to: string; card?: Card }
  | { k: 'missed'; from: string; to: string; named: string }
  | { k: 'shuffle'; by: string }
  | { k: 'future'; by: string; cards?: Card[] }
  | { k: 'reveal'; by: string; cards: Card[] }
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

export interface EngineOptions {
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
  draw: Card[] = [];
  discard: Card[] = [];
  mat: { godcat: Card | null; devilcat: Card };
  current = 0;
  turns = 1;
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
    this.opt = { seed: (Math.random() * 2 ** 31) | 0, nopeWindow: 2.4, promptTimeout: 0, turnTimeout: 0, ...options };
    this.rng = this.opt.seed || 7;
    this.deckId = options.deck;
    this.players = setups.map((s) => ({ ...s, hand: [], alive: true, knows: new Set(), connected: true }));
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

  kittensInPile(): number {
    return this.draw.filter((c) => c.type === 'kitten').length;
  }

  private nextAliveIndex(from: number): number {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (this.players[i]!.alive) return i;
    }
    return from;
  }

  // ------------------------------------------------------------------ setup

  private setup(): void {
    const def = DECKS[this.deckId];
    const n = this.players.length;
    const body: Card[] = [];
    for (const [type, count] of Object.entries(def.counts) as Array<[CardType, number]>) {
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
    // Faster variant for 2–3 players: drop a third of what's left.
    if (n <= 3) body.splice(0, Math.floor(body.length / 3));
    const extraDefuses = Math.min(Math.max(0, (def.counts.defuse ?? 6) - n), n >= 5 ? 1 : 2);
    for (let i = 0; i < extraDefuses; i++) body.push(this.card('defuse'));
    for (let i = 0; i < n - 1; i++) body.push(this.card('kitten'));
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
        return this.nope(p, a.card);
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
        if (!a.as || !GODCAT_AS.includes(a.as)) return 'Choose what the Angel Cat becomes.';
        if (a.as === 'skip' && this.deckId !== 'classic') return 'There is no Skip in this deck.';
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
          const t = others(a.target);
          if (!t) return 'Choose a player.';
          if (!this.player(t).hand.length) return 'They have no cards.';
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
        case 'armageddon':
          if (!this.mat.godcat) return 'Armageddon needs the Angel Cat on the playmat.';
          if (this.alive().length < 2) return 'No one to battle.';
          effect = { k: 'armageddon' };
          break;
        default:
          return `${type === 'defuse' ? 'Defuse is played automatically when you explode' : type === 'nope' ? 'Nope is played on someone else’s action' : 'That card does nothing alone — pair it up'}.`;
      }
    } else {
      if (list.length > 3) return 'Play one card, a pair or three of a kind.';
      if (list.some((c) => c.type === 'godcat')) return 'The Angel Cat can’t join a combo.';
      // Pairs/triples: same title (Feral matches any cat card; any title counts in Heaven vs Heck).
      const titles = list.filter((c) => c.type !== 'feral').map(title);
      const catTitles = titles.every((t) => t.startsWith('cat:'));
      if (titles.length && new Set(titles).size > 1) return 'Combos need matching cards.';
      if (list.some((c) => c.type === 'feral') && titles.length && !catTitles) return 'Feral Cat only matches cat cards.';
      if (!DECKS[this.deckId].anyPairs && !catTitles) return 'Only cat cards make pairs in this deck.';
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

  private nope(p: Player, cardId: number): string | null {
    if (this.phase !== 'nope' || !this.pending) return 'Nothing to Nope right now.';
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
      case 'favor': {
        const t = this.player(e.target);
        if (!t.alive || !t.hand.length) return this.afterAction();
        this.ask({ k: 'give', player: t.id, to: p.id });
        return;
      }
      case 'shuffle':
        this.shuffleInPlace(this.draw);
        for (const x of this.players) x.knows.clear();
        this.emit({ k: 'shuffle', by: p.id });
        return this.afterAction();
      case 'future': {
        const top = this.draw.slice(0, 3);
        for (const c of top) p.knows.add(c.id);
        this.emit({ k: 'future', by: p.id, cards: top, vis: [p.id] });
        return this.afterAction();
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
        this.emit({ k: 'draw', by: p.id, card, bottom: true, vis: [p.id] });
        this.ask({ k: 'heck', player: p.id, card });
        return;
      }
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
    to.hand.push(c);
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

  defaultChoice(pr: Prompt): Extract<Action, { t: 'respond' }>['choice'] {
    switch (pr.k) {
      case 'insert':
        return Math.floor(this.rand() * (pr.size + 1));
      case 'give': {
        const h = this.player(pr.player).hand;
        const sorted = [...h].sort((a, b) => worth(a) - worth(b));
        return sorted[0]!.id;
      }
      case 'fan':
        return Math.floor(this.rand() * pr.order.length);
      case 'heck':
        return pr.card.type === 'kitten' ? 'top' : 'keep';
      case 'armDeal': {
        const others = this.alive().filter((x) => x.id !== pr.player);
        return { target: others[Math.floor(this.rand() * others.length)]!.id, give: this.rand() < 0.5 ? 'godcat' : 'devilcat' };
      }
      case 'armPick':
        return this.rand() < 0.5 ? 'keep' : 'swap';
    }
  }

  private respond(p: Player, promptId: number, choice: Extract<Action, { t: 'respond' }>['choice'], auto = false): string | null {
    const pr = this.prompt;
    if (this.phase !== 'prompt' || !pr || pr.id !== promptId || pr.player !== p.id) return auto ? null : 'Nothing to answer.';
    switch (pr.k) {
      case 'insert': {
        const i = Math.max(0, Math.min(pr.size, Math.round(Number(choice))));
        if (!Number.isFinite(i)) return 'Pick a position.';
        this.prompt = null;
        const kitten = this.discardKittenFor();
        this.draw.splice(i, 0, kitten);
        for (const x of this.players) if (x.id !== p.id) x.knows.delete(kitten.id);
        p.knows.add(kitten.id);
        this.emit({ k: 'insert', by: p.id, index: i, vis: [p.id] });
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
          this.emit({ k: 'heckTop', by: p.id, card: pr.card, vis: [p.id] });
          this.endOneTurn();
        } else {
          this.receive(p, pr.card);
        }
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
          this.eliminate(victim);
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

  private drawCard(p: Player, _bottom: boolean): void {
    const c = this.draw.shift();
    if (!c) return this.endOneTurn();
    for (const x of this.players) x.knows.delete(c.id);
    this.emit({ k: 'draw', by: p.id, card: c, vis: c.type === 'kitten' ? undefined : [p.id] });
    this.receive(p, c);
  }

  /** A card arrives in hand from the pile (normal draw or Raising Heck "keep"). */
  private receive(p: Player, c: Card): void {
    if (c.type !== 'kitten') {
      p.hand.push(c);
      this.endOneTurn();
      return;
    }
    this.emit({ k: 'explode', by: p.id, card: c });
    const saver = p.hand.find((x) => x.type === 'defuse') ?? p.hand.find((x) => x.type === 'godcat');
    if (!saver) {
      this.discard.push(c);
      this.eliminate(p);
      if (!this.isOver) this.advanceAfterDeath(p);
      return;
    }
    p.hand.splice(p.hand.indexOf(saver), 1);
    if (saver.type === 'godcat') this.mat.godcat = saver;
    else this.discard.push(saver);
    this.emit({ k: 'defuse', by: p.id, card: saver });
    this.pendingKitten = c;
    this.afterInsert = () => this.endOneTurn();
    this.ask({ k: 'insert', player: p.id, size: this.draw.length });
  }

  private pendingKitten: Card | null = null;
  private discardKittenFor(): Card {
    const k = this.pendingKitten ?? this.card('kitten');
    this.pendingKitten = null;
    return k;
  }

  private eliminate(p: Player): void {
    p.alive = false;
    for (const c of p.hand) {
      if (c.type === 'godcat') this.mat.godcat = c;
      else this.discard.push(c);
    }
    p.hand = [];
    this.emit({ k: 'eliminated', by: p.id });
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
  return { kitten: -1, cat: 1, feral: 2, shuffle: 3, reveal: 4, future: 4, favor: 4, heck: 4, armageddon: 5, skip: 6, attack: 6, targeted: 6, nope: 7, defuse: 10, godcat: 11, devilcat: 0 }[c.type];
}
