import { COLORS, type Card, type Color } from './cards';
import type { LastCardEngine, Player } from './engine';

export type BotLevel = 'easy' | 'normal' | 'hard';

const LEVEL: Record<BotLevel, { pace: [number, number]; callChance: number; catchChance: number; catchDelay: number; bluff: number }> = {
  easy: { pace: [1.4, 2.6], callChance: 0.7, catchChance: 0.35, catchDelay: 2.2, bluff: 0.4 },
  normal: { pace: [1.2, 2.2], callChance: 0.92, catchChance: 0.75, catchDelay: 1.3, bluff: 0.1 },
  hard: { pace: [1.0, 1.9], callChance: 1, catchChance: 1, catchDelay: 0.7, bluff: 0.06 },
};

/** Drives every bot seat: plays, colour choice, calling, catching and challenges. */
export class BotDriver {
  private wait = new Map<string, number>();
  private catchTimer = new Map<string, number>();
  private lastVulnerable: string | null = null;
  private lastTurnKey = '';

  constructor(
    private readonly e: LastCardEngine,
    readonly level: BotLevel = 'normal',
  ) {}

  update(dt: number): void {
    const e = this.e;
    if (e.phase === 'over' || e.phase === 'roundOver') return;
    const L = LEVEL[this.level];
    // Catching someone who forgot to call.
    if (e.vulnerable !== this.lastVulnerable) {
      this.lastVulnerable = e.vulnerable;
      this.catchTimer.clear();
      if (e.vulnerable)
        for (const p of e.players) {
          if (!p.bot || p.id === e.vulnerable || Math.random() > L.catchChance) continue;
          this.catchTimer.set(p.id, L.catchDelay * (0.6 + Math.random() * 0.8));
        }
    }
    for (const [id, t] of this.catchTimer) {
      const left = t - dt;
      if (left > 0) this.catchTimer.set(id, left);
      else {
        this.catchTimer.delete(id);
        if (e.vulnerable) e.act(id, { t: 'catch', target: e.vulnerable });
      }
    }
    // A bot that forgot to call may remember late.
    const v = e.vulnerable && e.player(e.vulnerable);
    if (v && v.bot && Math.random() < dt * 0.25 * L.callChance) e.act(v.id, { t: 'call' });

    const p = e.current;
    if (!p.bot) return;
    const key = `${e.round}:${p.id}:${e.phase}:${e.discard.length}:${p.hand.length}`;
    if (key !== this.lastTurnKey) {
      this.lastTurnKey = key;
      this.wait.set(p.id, L.pace[0] + Math.random() * (L.pace[1] - L.pace[0]) * (e.phase === 'drawn' ? 0.5 : 1));
    }
    const w = (this.wait.get(p.id) ?? 0) - dt;
    this.wait.set(p.id, w);
    if (w > 0) return;
    this.act(p);
  }

  private act(p: Player): void {
    const e = this.e;
    const L = LEVEL[this.level];
    if (e.phase === 'challenge') {
      e.act(p.id, { t: 'challenge', yes: this.shouldChallenge() });
      return;
    }
    const playable = p.hand.filter((c) => e.canPlay(c));
    if (!playable.length) {
      e.act(p.id, e.phase === 'drawn' ? { t: 'keep' } : { t: 'draw' });
      return;
    }
    const card = this.choose(p, playable);
    if (!card) {
      e.act(p.id, e.phase === 'drawn' ? { t: 'keep' } : { t: 'draw' });
      return;
    }
    if (p.hand.length === 2 && Math.random() < L.callChance) e.act(p.id, { t: 'call' });
    const wild = card.kind === 'wild' || card.kind === 'wild4';
    e.act(p.id, { t: 'play', card: card.id, color: wild ? this.bestColor(p, card) : undefined });
  }

  /** Pick a card: weigh damage to the next player, keep wilds for later, dump high points. */
  private choose(p: Player, playable: Card[]): Card | null {
    const e = this.e;
    const L = LEVEL[this.level];
    if (this.level === 'easy') return playable[Math.floor(Math.random() * playable.length)]!;
    const nextP = e.players[(((e.cur + e.dir) % e.players.length) + e.players.length) % e.players.length]!;
    const danger = nextP.hand.length <= 2;
    const counts = this.colorCounts(p);
    let best: Card | null = null;
    let bestScore = -Infinity;
    for (const c of playable) {
      let s = 0;
      if (c.kind === 'num') s += 2 + c.n * 0.1;
      if (c.kind === 'skip' || c.kind === 'rev') s += danger ? 8 : 3;
      if (c.kind === 'draw2') s += danger ? 10 : 4;
      if (c.kind === 'wild') s += p.hand.length <= 2 ? 6 : -4;
      if (c.kind === 'wild4') {
        const bluff = e.isBluff(p, c.id);
        if (bluff && Math.random() > L.bluff) continue;
        s += danger ? 12 : p.hand.length <= 3 ? 5 : -6;
      }
      // Stay in the colour we hold the most of.
      if (c.color) s += counts[c.color] * (this.level === 'hard' ? 0.9 : 0.5);
      // Pending stack: always stack if we can.
      if (e.pendingDraw > 0) s += 20;
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    // Hard bots hold a lone wild if they have alternatives.
    return best ?? playable.find((c) => c.kind !== 'wild4') ?? null;
  }

  private colorCounts(p: Player): Record<Color, number> {
    const counts: Record<Color, number> = { r: 0, y: 0, g: 0, b: 0 };
    for (const c of p.hand) if (c.color) counts[c.color] += 1 + (c.kind === 'num' ? 0 : 0.5);
    return counts;
  }

  private bestColor(p: Player, playing: Card): Color {
    const counts = this.colorCounts({ ...p, hand: p.hand.filter((c) => c.id !== playing.id) });
    if (this.level === 'easy' && Math.random() < 0.4) return COLORS[Math.floor(Math.random() * 4)]!;
    let best: Color = COLORS[Math.floor(Math.random() * 4)]!;
    for (const c of COLORS) if (counts[c] > counts[best]) best = c;
    return best;
  }

  private shouldChallenge(): boolean {
    const e = this.e;
    const by = e.wild4 && e.player(e.wild4.by);
    if (!by) return false;
    // Winning a challenge swings 8 cards, losing costs 2 extra: worth it only when a
    // bluff is plausible — a big hand, or a human (bots rarely bluff).
    const base = this.level === 'easy' ? 0.2 : this.level === 'normal' ? 0.12 : 0.04;
    const big = by.hand.length >= 6 ? (this.level === 'hard' ? 0.25 : 0.12) : 0;
    const human = by.bot ? 0 : this.level === 'hard' ? 0.2 : 0.1;
    return Math.random() < base + big + human;
  }
}
