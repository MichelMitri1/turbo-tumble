import { title, type Card, type CardType } from './cards';
import type { Action, KittensEngine } from './engine';
import { viewFor, type View } from './view';

export type BotLevel = 'easy' | 'normal' | 'hard';

interface Memory {
  /** pending id + nope count we already reacted to. */
  noped: string;
  /** Actions taken this turn (avoid looping). */
  turnKey: string;
  actions: number;
  think: number;
}

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

  update(dt: number): void {
    const e = this.engine;
    if (e.isOver) return;
    for (const p of e.players) {
      if (!p.bot || !p.alive) continue;
      const m = this.mem.get(p.id) ?? { noped: '', turnKey: '', actions: 0, think: 0.5 };
      this.mem.set(p.id, m);
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

export function decide(v: View, m: Memory, level: BotLevel): Action | null {
  const smart = level !== 'easy';
  // ---- prompts addressed to me
  if (v.prompt?.mine) {
    const pr = v.prompt;
    switch (pr.k) {
      case 'insert': {
        // Hurt the next player: kitten on top (or 2nd when they're under attack); sometimes hide it.
        const r = Math.random();
        const choice = !smart || r < 0.25 ? Math.floor(Math.random() * (pr.size + 1)) : r < 0.75 ? 0 : Math.min(pr.size, 1 + Math.floor(Math.random() * 3));
        return { t: 'respond', prompt: pr.id, choice };
      }
      case 'give': {
        const worst = [...v.hand].sort((a, b) => keep(a) - keep(b))[0];
        return { t: 'respond', prompt: pr.id, choice: worst?.id ?? 0 };
      }
      case 'fan':
        return { t: 'respond', prompt: pr.id, choice: smart && (pr.fanGod ?? -1) >= 0 ? pr.fanGod! : Math.floor(Math.random() * (pr.fanCount ?? 1)) };
      case 'heck':
        return { t: 'respond', prompt: pr.id, choice: pr.card.type === 'kitten' ? 'top' : 'keep' };
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
    const target = 'target' in pd.effect ? pd.effect.target : undefined;
    const meNext = pd.effect.k === 'attack' && nextAlive(v, pd.by) === v.you;
    const hurtsMe = target === v.you || meNext;
    let want = false;
    if (mine && pd.nopes % 2 === 1) want = Math.random() < (smart ? 0.85 : 0.4); // Yup!
    else if (!mine && pd.nopes % 2 === 0 && hurtsMe) want = Math.random() < (smart ? 0.8 : 0.35);
    else if (!mine && pd.nopes % 2 === 0 && pd.effect.k === 'armageddon') want = Math.random() < 0.25;
    m.noped = key;
    return want ? { t: 'nope', card: nope.id } : { t: 'pass' };
  }
  // ---- my turn
  if (v.phase !== 'play' || v.current !== v.you) return null;
  const turnKey = `${v.current}:${v.turns}:${v.drawCount}`;
  if (m.turnKey !== turnKey) {
    m.turnKey = turnKey;
    m.actions = 0;
  }
  const top = v.known.find((k) => k.index === 0)?.card;
  const topIsKitten = top?.type === 'kitten';
  const topSafe = top && top.type !== 'kitten';
  const risk = v.drawCount ? v.kittens / v.drawCount : 1;
  const defuses = v.hand.filter((c) => c.type === 'defuse' || c.type === 'godcat').length;
  const danger = topIsKitten || (!topSafe && risk > (defuses ? 0.32 : 0.18));
  const victim = () => (smart ? [...others(v)].sort((a, b) => (b.godcat ? 100 : 0) + b.count - ((a.godcat ? 100 : 0) + a.count))[0]! : pick(others(v)));
  if (m.actions >= 4) return { t: 'draw' };

  if (danger) {
    for (const t of ['skip', 'attack', 'targeted', 'armageddon', 'shuffle', 'heck'] as CardType[]) {
      const c = has(v, t);
      if (!c) continue;
      if (t === 'armageddon' && !v.godcatOnMat) continue;
      if (t === 'shuffle' && !topIsKitten) continue;
      if (t === 'heck' && !topIsKitten) continue;
      return { t: 'play', cards: [c.id], target: t === 'targeted' ? victim().id : undefined };
    }
    const god = has(v, 'godcat');
    if (god && topIsKitten && !has(v, 'defuse')) return { t: 'play', cards: [god.id], as: v.deck === 'classic' ? 'skip' : 'attack' };
  }
  // Learn the future when it's getting dangerous.
  if (!top && risk > 0.12) {
    const f = has(v, 'reveal') ?? has(v, 'future');
    if (f) return { t: 'play', cards: [f.id] };
  }
  // Grab the Angel Cat while it's free.
  if (v.godcatOnMat && has(v, 'armageddon') && (smart ? Math.random() < 0.35 : Math.random() < 0.15)) return { t: 'play', cards: [has(v, 'armageddon')!.id] };
  // Steal with pairs / triples.
  const combo = findCombo(v);
  if (combo && Math.random() < (smart ? 0.7 : 0.35)) {
    const t = victim();
    if (t.count > 0) return combo.length === 3 ? { t: 'play', cards: combo.map((c) => c.id), target: t.id, named: t.godcat ? 'godcat' : 'defuse' } : { t: 'play', cards: combo.map((c) => c.id), target: t.id };
  }
  const favor = has(v, 'favor');
  if (favor && Math.random() < 0.4) {
    const t = victim();
    if (t.count > 0) return { t: 'play', cards: [favor.id], target: t.id };
  }
  return { t: 'draw' };
}

function nextAlive(v: View, from: string): string {
  const i = v.players.findIndex((p) => p.id === from);
  for (let k = 1; k <= v.players.length; k++) {
    const p = v.players[(i + k) % v.players.length]!;
    if (p.alive) return p.id;
  }
  return from;
}

/** A pair or triple worth spending: cats first, never Defuse/Nope/Angel. */
function findCombo(v: View): Card[] | null {
  const groups = new Map<string, Card[]>();
  const ferals = v.hand.filter((c) => c.type === 'feral');
  for (const c of v.hand) {
    if (['defuse', 'nope', 'godcat', 'feral'].includes(c.type)) continue;
    if (v.deck === 'classic' && c.type !== 'cat') continue;
    if (c.type !== 'cat' && !['shuffle', 'favor', 'reveal', 'future'].includes(c.type)) continue;
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

function keep(c: Card): number {
  return { kitten: -1, cat: 1, feral: 2, shuffle: 3, reveal: 4, future: 4, favor: 4, heck: 4, armageddon: 5, skip: 6, attack: 6, targeted: 6, nope: 7, defuse: 10, godcat: 11, devilcat: 0 }[c.type];
}
