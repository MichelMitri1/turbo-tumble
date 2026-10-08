import { DECKS, title, type Card, type CardType } from './cards';
import type { Action, KittensEngine, Player } from './engine';
import { viewFor, type View } from './view';

export type BotLevel = 'easy' | 'normal' | 'hard';

interface Memory {
  /** pending id + nope count we already reacted to. */
  noped: string;
  /** Actions taken this turn (avoid looping). */
  turnKey: string;
  actions: number;
  think: number;
  /** (Hard) Top draws since a rival secretly hid a kitten (-1 = none pending / pile mixed since). */
  hot: number;
  pile: number;
  faceUp: number;
  kittens: number;
  inserting: boolean;
  /** Nope count of a pending Shuffle / Alter the Future (-1 = none). */
  mixing: number;
  /** Last prompt we started thinking about. */
  prompt: number;
}

/** Hard bots remember public table events between decisions (what a sharp human would notice). */
function observe(v: View, m: Memory): void {
  const pr = v.prompt;
  const faceUp = v.known.filter((k) => k.card.faceUp).length;
  if (pr && !pr.mine && pr.k === 'insert') m.inserting = true;
  else if (m.inserting) {
    m.inserting = false;
    // The pile grew by one and no face-up card appeared: a kitten went back in secretly.
    if (v.drawCount > m.pile && faceUp <= m.faceUp) m.hot = 0;
  }
  if (m.hot >= 0 && v.drawCount < m.pile) m.hot += m.pile - v.drawCount;
  if (v.pending && (v.pending.effect.k === 'shuffle' || v.pending.effect.k === 'alter')) m.mixing = v.pending.nopes;
  else if (m.mixing >= 0 && !v.pending) {
    if (m.mixing % 2 === 0) m.hot = -1;
    m.mixing = -1;
  }
  // A kitten left the pile without going back in: whatever we suspected may be gone.
  if (v.kittens < m.kittens && !m.inserting) m.hot = -1;
  m.pile = v.drawCount;
  m.faceUp = faceUp;
  m.kittens = v.kittens;
}

/** Chance the top card is the kitten a rival just hid (they like it on top for the next player). */
const HOT = [0.55, 0.4, 0.45];

/**
 * Bots decide from their own View only (no peeking at hidden cards). The driver
 * gives each bot a short "thinking" delay so the table feels human.
 */
export class BotDriver {
  private mem = new Map<string, Memory>();
  constructor(
    private readonly engine: KittensEngine,
    private readonly level: BotLevel = 'normal',
    private readonly speed = 1,
    /** Seconds a bot "thinks" between actions [min, max]. */
    private readonly pace: [number, number] = [1.6, 2.8],
  ) {}

  /** `only`: drive just some of the bots (several drivers can share one engine). */
  update(dt: number, only?: (p: Player) => boolean): void {
    const e = this.engine;
    if (e.isOver) return;
    for (const p of e.players) {
      if (!p.bot || !p.alive || (only && !only(p))) continue;
      const m = this.mem.get(p.id) ?? { noped: '', turnKey: '', actions: 0, think: 0.5, hot: -1, pile: e.draw.length, faceUp: 0, kittens: e.kittensInPile(), inserting: false, mixing: -1, prompt: -1 };
      this.mem.set(p.id, m);
      if (this.level === 'hard') observe(viewFor(e, p.id), m);
      // A prompt deserves a moment's thought (and the table gets to show who it's waiting for).
      const pr = e.prompt;
      if (pr && pr.player === p.id && m.prompt !== pr.id) {
        m.prompt = pr.id;
        m.think = Math.max(m.think, 0.8 + Math.random() * 0.8);
      }
      m.think -= dt * this.speed;
      // In a Nope window bots react within ~0.3–0.8 s, whatever they were doing.
      if (e.phase === 'nope' && m.think > 1.2) m.think = 0.6 + Math.random() * 0.6;
      if (m.think > 0) continue;
      const v = viewFor(e, p.id);
      const a = decide(v, m, this.level);
      if (!a) {
        m.think = 0.15;
        continue;
      }
      const err = e.act(p.id, a);
      const [lo, hi] = this.pace;
      m.think = err ? 0.4 : a.t === 'nope' || a.t === 'pass' ? 0.3 : lo + Math.random() * (hi - lo);
      if (!err && a.t === 'play') m.actions++;
    }
  }
}

const has = (v: View, t: CardType) => v.hand.find((c) => c.type === t);
const others = (v: View) => v.players.filter((p) => p.alive && p.id !== v.you);
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
/** A pile card that kills whoever draws it. */
const deadly = (c?: Card) => Boolean(c && (c.type === 'kitten' || (c.type === 'imploding' && c.faceUp)));

export function decide(v: View, m: Memory, level: BotLevel): Action | null {
  const smart = level !== 'easy';
  const hard = level === 'hard';
  const next = nextAlive(v, v.you);
  const nextP = v.players.find((p) => p.id === next);
  // ---- prompts addressed to me
  if (v.prompt?.mine) {
    const pr = v.prompt;
    switch (pr.k) {
      case 'insert': {
        // My own remaining draws come first: the kitten must sit below them.
        const floor = Math.min(pr.size, Math.max(0, v.turns - 1));
        let choice: number;
        if (!smart) choice = Math.floor(Math.random() * (pr.size + 1));
        else if (pr.kind === 'imploding') choice = floor; // public anyway: right where the next player draws
        else {
          // With one draw each, slot floor+k lands on the k-th rival after me — and past the last rival
          // it comes back round to me. A weak next player (few cards, or probably no Defuse left) gets it
          // right on top; a well-stocked one may Skip it away, so sometimes it goes to the rival after them.
          // Every so often (Normal) it's hidden deep to keep the table guessing.
          const reach = Math.max(0, others(v).length - 1);
          const weak = (nextP?.count ?? 0) <= 2 || (hard && !likelyDefuse(v, nextP));
          const r = Math.random();
          if (weak || !reach || r < (hard ? 0.8 : 0.5)) choice = floor;
          else if (hard || r < 0.85) choice = floor + 1 + Math.floor(Math.random() * reach);
          else choice = floor + Math.floor(Math.random() * (pr.size - floor + 1));
        }
        return { t: 'respond', prompt: pr.id, choice: Math.min(pr.size, Math.max(choice, floor)) };
      }
      case 'give': {
        const worst = [...v.hand].sort((a, b) => keep(a) - keep(b))[0];
        return { t: 'respond', prompt: pr.id, choice: worst?.id ?? 0 };
      }
      case 'fan':
        return { t: 'respond', prompt: pr.id, choice: smart && (pr.fanGod ?? -1) >= 0 ? pr.fanGod! : Math.floor(Math.random() * (pr.fanCount ?? 1)) };
      case 'heck':
        // A kitten goes back on top (next turn may still bring a Skip); keeping it explodes now.
        return { t: 'respond', prompt: pr.id, choice: pr.card.type === 'kitten' || pr.card.type === 'imploding' ? 'top' : 'keep' };
      case 'reorder': {
        // Safe cards cover my own draws; the first kitten lands exactly where the next player draws.
        const idx = pr.cards.map((_, i) => i);
        if (!smart) return { t: 'respond', prompt: pr.id, choice: idx.sort(() => Math.random() - 0.5) };
        const safe = idx.filter((i) => !deadly(pr.cards[i]));
        const bombs = idx.filter((i) => deadly(pr.cards[i]));
        const order = [...safe.slice(0, v.turns), ...bombs, ...safe.slice(v.turns)];
        return { t: 'respond', prompt: pr.id, choice: order };
      }
      case 'rummage': {
        const best = [...v.discard].sort((a, b) => keep(b) - keep(a))[0];
        return { t: 'respond', prompt: pr.id, choice: best?.id ?? 0 };
      }
      case 'armDeal': {
        const target = smart ? [...others(v)].sort((a, b) => b.count - a.count)[0]! : pick(others(v));
        return { t: 'respond', prompt: pr.id, choice: { target: target.id, give: Math.random() < (smart ? 0.65 : 0.5) ? 'devilcat' : 'godcat' } };
      }
      case 'armPick':
        return { t: 'respond', prompt: pr.id, choice: Math.random() < 0.5 ? 'keep' : 'swap' };
    }
  }
  // ---- Nope window
  if (v.phase === 'nope' && v.pending) {
    const pd = v.pending;
    const key = `${pd.by}:${pd.cards[0]?.id}:${pd.nopes}`;
    if (m.noped === key || v.pending.passed) return null;
    const nope = has(v, 'nope');
    if (!nope) return null;
    const mine = pd.by === v.you;
    const ek = pd.effect.k;
    const target = 'target' in pd.effect ? pd.effect.target : undefined;
    const meNext = ek === 'attack' && nextAlive(v, pd.by) === v.you;
    const hurtsMe = target === v.you || meNext;
    // The actor is about to dodge a kitten I know is on top: make them draw it.
    const dodging = pd.by === v.current && deadly(v.known.find((k) => k.index === 0)?.card) && ['skip', 'attack', 'targeted', 'shuffle', 'reverse', 'bottom', 'heck', 'alter'].includes(ek);
    const namesDefuse = ek === 'steal3' && pd.effect.named === 'defuse';
    let want = false;
    if (mine && pd.nopes % 2 === 1) want = Math.random() < (smart ? 0.85 : 0.4); // Yup!
    else if (!mine && pd.nopes % 2 === 0) {
      if (hurtsMe) want = hard || Math.random() < (smart ? 0.8 : 0.35);
      else if (smart && dodging) want = Math.random() < 0.9;
      else if (smart && namesDefuse) want = Math.random() < 0.75;
      else if (ek === 'armageddon') want = Math.random() < 0.25;
    }
    m.noped = key;
    return want ? { t: 'nope', card: nope.id, expect: pd.nopes } : { t: 'pass' };
  }
  // ---- my turn
  if (v.phase !== 'play' || v.current !== v.you) return null;
  const turnKey = `${v.current}:${v.turns}:${v.drawCount}`;
  if (m.turnKey !== turnKey) {
    m.turnKey = turnKey;
    m.actions = 0;
  }
  const kn = (i: number) => v.known.find((k) => k.index === i)?.card;
  const top = kn(0);
  const topIsKitten = deadly(top);
  const topSafe = Boolean(top) && !topIsKitten;
  const bottomDeadly = deadly(kn(v.drawCount - 1));
  // Chance that one of my remaining draws this turn hits a kitten (known-safe cards don't count).
  const draws = Math.max(1, v.turns);
  const knownSafe = Array.from({ length: draws }, (_, i) => kn(i)).filter((c) => c && !deadly(c)).length;
  const knownKittenSoon = Array.from({ length: draws }, (_, i) => deadly(kn(i))).some(Boolean);
  const base = v.drawCount ? v.kittens / v.drawCount : 1;
  // Hard suspects the top card right after a rival's secret insert.
  const hot = hard && !top && m.hot >= 0 && m.hot < HOT.length && v.kittens ? HOT[m.hot]! : 0;
  const unknown = Math.max(0, draws - knownSafe);
  const risk = hot ? 1 - (1 - Math.max(hot, base)) * Math.pow(1 - base, Math.max(0, unknown - 1)) : 1 - Math.pow(1 - base, unknown);
  const defuses = v.hand.filter((c) => c.type === 'defuse' || c.type === 'godcat').length;
  const danger = knownKittenSoon || (!(topSafe && v.turns === 1) && risk > (defuses ? 0.32 : 0.18));
  const strongest = () => [...others(v)].sort((a, b) => (b.godcat ? 100 : 0) + b.count - ((a.godcat ? 100 : 0) + a.count))[0]!;
  const weakest = () => [...others(v)].sort((a, b) => a.count - b.count)[0]!;
  const victim = () => (smart ? strongest() : pick(others(v)));
  // Attack victims: the least able to defend themselves (Hard), otherwise whoever's strongest.
  const attackTarget = () => (hard ? weakest() : victim());
  const play = (c: Card, extra: Partial<Extract<Action, { t: 'play' }>> = {}): Action => ({ t: 'play', cards: [c.id], ...extra });
  if (m.actions >= 5) return { t: 'draw' };

  // Pass stacked attacks along whenever possible.
  if (v.turns > 1) {
    const a = has(v, 'attack');
    if (a) return play(a);
    const ta = has(v, 'targeted');
    if (ta) return play(ta, { target: attackTarget().id });
  }
  if (danger) {
    for (const t of ['skip', 'attack', 'targeted', 'reverse', 'armageddon', 'bottom', 'shuffle', 'heck'] as CardType[]) {
      const c = has(v, t);
      if (!c) continue;
      if (t === 'armageddon' && !v.godcatOnMat) continue;
      if (t === 'bottom' && (bottomDeadly || v.kittens >= v.drawCount || v.drawCount < 2)) continue;
      if (t === 'shuffle' && !knownKittenSoon) continue;
      if (t === 'heck' && (!topIsKitten || bottomDeadly)) continue;
      return play(c, { target: t === 'targeted' ? attackTarget().id : undefined });
    }
    const god = has(v, 'godcat');
    if (god && knownKittenSoon && !has(v, 'defuse')) return play(god, { as: v.deck === 'classic' ? 'skip' : 'attack' });
  }
  // Learn the future when it's getting dangerous.
  if (!top && risk > 0.12) {
    const f = has(v, 'reveal') ?? has(v, 'future') ?? has(v, 'alter');
    if (f) return play(f);
  }
  // Five different cards buy a Defuse back from the discard pile.
  if (smart && !has(v, 'defuse')) {
    const wanted = v.discard.find((c) => c.type === 'defuse');
    const five = findFive(v);
    if (wanted && five) return { t: 'play', cards: five.map((c) => c.id) };
  }
  // Grab the Angel Cat while it's free.
  if (v.godcatOnMat && has(v, 'armageddon') && (smart ? Math.random() < 0.35 : Math.random() < 0.15)) return play(has(v, 'armageddon')!);
  // Reverse so the weaker neighbour follows me instead of the strongest player.
  const rev = has(v, 'reverse');
  if (rev && smart && nextP && nextP.id === strongest().id && others(v).length > 2 && Math.random() < 0.35) return play(rev);
  // Steal with pairs / triples.
  const combo = findCombo(v);
  if (combo && Math.random() < (smart ? 0.7 : 0.35)) {
    const t = victim();
    if (t.count > 0) {
      if (combo.length === 3) return { t: 'play', cards: combo.map((c) => c.id), target: t.id, named: t.godcat ? 'godcat' : 'defuse' };
      return { t: 'play', cards: combo.map((c) => c.id), target: t.id };
    }
  }
  const favor = has(v, 'favor');
  if (favor && Math.random() < 0.4) {
    // The giver picks their worst card, so Hard asks the shortest hand (fewest bad cards to hide behind).
    const t = hard ? ([...others(v)].filter((p) => p.count > 0).sort((a, b) => a.count - b.count)[0] ?? victim()) : victim();
    if (t.count > 0) return play(favor, { target: t.id });
  }
  return { t: 'draw' };
}

/** The player after `from` in the current turn direction. */
function nextAlive(v: View, from: string): string {
  const i = v.players.findIndex((p) => p.id === from);
  const n = v.players.length;
  for (let k = 1; k <= n; k++) {
    const p = v.players[(((i + k * v.dir) % n) + n) % n]!;
    if (p.alive) return p.id;
  }
  return from;
}

/** Could this player still hold a Defuse? Counts the ones in the discard pile and in my hand (public plays). */
function likelyDefuse(v: View, p?: { count: number }): boolean {
  if (!p || !p.count) return false;
  const n = v.players.length;
  const total = n + Math.min(Math.max(0, (DECKS[v.deck].counts.defuse ?? 6) - n), n >= 5 ? 1 : 2);
  const seen = v.discard.filter((c) => c.type === 'defuse').length + v.hand.filter((c) => c.type === 'defuse').length;
  return total - seen > 0;
}

/** A pair or triple worth spending: cats first, never Defuse/Nope/Angel. */
function findCombo(v: View): Card[] | null {
  const groups = new Map<string, Card[]>();
  const ferals = v.hand.filter((c) => c.type === 'feral');
  for (const c of v.hand) {
    if (['defuse', 'nope', 'godcat', 'feral'].includes(c.type)) continue;
    if (!v.rules.anyPairs && c.type !== 'cat') continue;
    if (c.type !== 'cat' && !['shuffle', 'favor', 'reveal', 'future', 'bottom'].includes(c.type)) continue;
    const g = groups.get(title(c)) ?? [];
    g.push(c);
    groups.set(title(c), g);
  }
  for (const g of groups.values()) {
    if (g.length >= 3) return g.slice(0, 3);
  }
  for (const [t, g] of groups) {
    if (g.length >= 2) return g.slice(0, 2);
    if (g.length === 1 && t.startsWith('cat:') && ferals[0]) return [g[0]!, ferals[0]];
  }
  return null;
}

/** Five different, cheap cards (never Defuse, Nope or the Angel Cat). */
function findFive(v: View): Card[] | null {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const c of [...v.hand].sort((a, b) => keep(a) - keep(b))) {
    if (['defuse', 'nope', 'godcat'].includes(c.type) || seen.has(title(c))) continue;
    seen.add(title(c));
    out.push(c);
    if (out.length === 5) return out;
  }
  return null;
}

function keep(c: Card): number {
  return { kitten: -1, imploding: -1, cat: 1, feral: 2, shuffle: 3, bottom: 3, reveal: 4, future: 4, favor: 4, heck: 4, alter: 5, armageddon: 5, skip: 6, reverse: 6, attack: 6, targeted: 6, nope: 7, defuse: 10, godcat: 11, devilcat: 0 }[c.type];
}
