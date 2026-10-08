import { COLORS, points, type Card, type Color } from './cards';
import type { LastCardEngine, Player } from './engine';

export type BotLevel = 'easy' | 'normal' | 'hard';

const LEVEL: Record<BotLevel, { pace: [number, number]; callChance: number; catchChance: number; catchDelay: number; bluff: number; jump: number }> = {
  easy: { pace: [1.4, 2.6], callChance: 0.7, catchChance: 0.35, catchDelay: 2.2, bluff: 0.4, jump: 0.15 },
  normal: { pace: [1.2, 2.2], callChance: 0.92, catchChance: 0.75, catchDelay: 1.3, bluff: 0.1, jump: 0.4 },
  hard: { pace: [1.0, 1.9], callChance: 1, catchChance: 1, catchDelay: 0.7, bluff: 0.06, jump: 0.75 },
};

const zero = (): Record<Color, number> => ({ r: 0, y: 0, g: 0, b: 0 });

/**
 * Drives every bot seat: plays, colour choice, calling, catching, challenges and
 * jump-ins. Hard bots keep a little memory of the table (who drew on which colour,
 * who last played what) and use it for colour picks and challenges.
 */
export class BotDriver {
  private wait = new Map<string, number>();
  private catchTimer = new Map<string, number>();
  private jumpTimer = new Map<string, number>();
  private lastVulnerable: string | null = null;
  private lastTurnKey = '';
  /** Table memory (state diffs, so it works the same locally, online and in the sim). */
  private drewOn = new Map<string, Record<Color, number>>();
  private lastPlayedColor = new Map<string, Color>();
  private wildBy = new Map<number, string>();
  private colorBefore: Color | null = null;
  private prev = { cur: '', count: 0, discard: 0, color: null as Color | null, round: 0 };

  constructor(
    private readonly e: LastCardEngine,
    readonly level: BotLevel = 'normal',
    /** Which seats this driver controls (default: every bot). */
    private readonly drives: (id: string) => boolean = () => true,
  ) {}

  private mine(p: Player): boolean {
    return p.bot && this.drives(p.id);
  }

  update(dt: number): void {
    const e = this.e;
    if (e.phase === 'over' || e.phase === 'roundOver') return;
    this.observe();
    const L = LEVEL[this.level];
    // Catching someone who forgot to call.
    if (e.vulnerable !== this.lastVulnerable) {
      this.lastVulnerable = e.vulnerable;
      this.catchTimer.clear();
      if (e.vulnerable)
        for (const p of e.players) {
          if (!this.mine(p) || p.id === e.vulnerable || Math.random() > L.catchChance) continue;
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
    if (v && this.mine(v) && Math.random() < dt * 0.25 * L.callChance) e.act(v.id, { t: 'call' });
    // Jump-ins: a bot holding the identical card may slap it down out of turn.
    if (e.rules.jumpIn) this.jumpIns(dt);

    const p = e.current;
    if (!this.mine(p)) return;
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

  /** Learn from what changed since the last tick: draws on a colour, who played the top card. */
  private observe(): void {
    const e = this.e;
    const cur = e.current;
    const pv = this.prev;
    if (pv.round !== e.round) {
      this.drewOn.clear();
      this.lastPlayedColor.clear();
      this.wildBy.clear();
      this.colorBefore = null;
      this.jumpTimer.clear();
    } else if (e.discard.length > pv.discard && pv.cur) {
      // Someone (usually the previous current player) put a card down.
      const top = e.top;
      const by = e.phase === 'challenge' ? (e.wild4?.by ?? pv.cur) : pv.cur;
      if (top.color) this.lastPlayedColor.set(by, top.color);
      else this.wildBy.set(top.id, by);
      this.colorBefore = pv.color;
    } else if (cur.id === pv.cur && cur.hand.length === pv.count + 1 && e.discard.length === pv.discard && e.color) {
      const d = this.drewOn.get(cur.id) ?? zero();
      d[e.color]++;
      this.drewOn.set(cur.id, d);
    }
    this.prev = { cur: cur.id, count: cur.hand.length, discard: e.discard.length, color: e.color, round: e.round };
  }

  private jumpIns(dt: number): void {
    const e = this.e;
    const L = LEVEL[this.level];
    for (const p of e.players) {
      if (!this.mine(p) || p === e.current) continue;
      const card = p.hand.find((c) => e.canJump(c));
      if (!card) {
        this.jumpTimer.delete(p.id);
        continue;
      }
      const key = `${p.id}:${e.top.id}`;
      let t = this.jumpTimer.get(key);
      if (t === undefined) {
        t = Math.random() < L.jump ? 0.4 + Math.random() * 0.8 : Infinity;
        this.jumpTimer.set(key, t);
      }
      t -= dt;
      this.jumpTimer.set(key, t);
      if (t > 0) continue;
      if (p.hand.length === 2 && Math.random() < L.callChance) e.act(p.id, { t: 'call' });
      e.act(p.id, { t: 'play', card: card.id });
      return;
    }
  }

  private act(p: Player): void {
    const e = this.e;
    const L = LEVEL[this.level];
    if (e.phase === 'challenge') {
      e.act(p.id, { t: 'challenge', yes: this.shouldChallenge(p) });
      return;
    }
    if (e.phase === 'pickColor') {
      e.act(p.id, { t: 'color', color: this.level === 'easy' ? COLORS[Math.floor(Math.random() * 4)]! : this.bestColor(p, null) });
      return;
    }
    if (e.phase === 'pickSwap') {
      e.act(p.id, { t: 'swap', target: this.swapTarget(p) });
      return;
    }
    const playable = p.hand.filter((c) => e.canPlay(c));
    const pass = (): void => void e.act(p.id, e.phase === 'drawn' ? { t: 'keep' } : { t: 'draw' });
    if (!playable.length) return pass();
    let card = this.choose(p, playable);
    if (!card && e.mustPlay()) card = playable.find((c) => c.kind !== 'wild4') ?? playable[0]!;
    if (!card) return pass();
    if (p.hand.length === 2 && Math.random() < L.callChance) e.act(p.id, { t: 'call' });
    const wild = card.kind === 'wild' || card.kind === 'wild4';
    e.act(p.id, { t: 'play', card: card.id, color: wild ? this.bestColor(p, card) : undefined });
  }

  private nextPlayer(dir = this.e.dir): Player {
    const e = this.e;
    const n = e.players.length;
    return e.players[(((e.cur + dir) % n) + n) % n]!;
  }

  /** Pick a card: weigh damage to the next player, keep wilds for later, dump high points. */
  private choose(p: Player, playable: Card[]): Card | null {
    const e = this.e;
    const L = LEVEL[this.level];
    if (this.level === 'easy') return playable[Math.floor(Math.random() * playable.length)]!;
    const hard = this.level === 'hard';
    const nextP = this.nextPlayer();
    const prevP = this.nextPlayer(-e.dir as 1 | -1);
    const danger = nextP.hand.length <= 2;
    const counts = this.colorCounts(p);
    const many = e.players.length > 2;
    // Late in a scored game (someone is about to go out) high cards are a liability.
    const late = e.rules.target > 0 && e.players.some((q) => q !== p && q.hand.length <= 3);
    const alternatives = playable.filter((c) => c.kind === 'num').length;
    let best: Card | null = null;
    let bestScore = -Infinity;
    for (const c of playable) {
      let s = 0;
      if (c.kind === 'num') s += 2 + c.n * 0.1;
      if (c.kind === 'skip' || c.kind === 'draw2') {
        s += danger ? (c.kind === 'draw2' ? 10 : 8) : c.kind === 'draw2' ? 4 : 3;
        // Hard bots save the punishment for when the next player is about to go out.
        if (hard && !danger && nextP.hand.length > 2 && alternatives && p.hand.length > 3) s -= 4;
      }
      if (c.kind === 'rev') {
        if (hard && many) {
          // Who does the turn go to? Handing it to someone on 1–2 cards is a gift.
          if (prevP.hand.length <= 2) s -= 6;
          else s += danger ? 8 : 3;
        } else s += danger ? 8 : 3;
      }
      if (c.kind === 'wild') s += p.hand.length <= 2 ? 6 : -4;
      if (c.kind === 'wild4') {
        const bluff = e.isBluff(p, c.id);
        // Hard bots bluff when it hurts most: the next player is about to go out.
        const bluffChance = hard && danger ? 0.35 : L.bluff;
        if (bluff && Math.random() > bluffChance) continue;
        s += danger ? 12 : p.hand.length <= 3 ? 5 : -6;
      }
      // A number we also hold in other colours keeps a colour switch open later.
      if (hard && c.kind === 'num') s += 0.6 * p.hand.filter((o) => o !== c && o.kind === 'num' && o.n === c.n).length;
      // Stay in the colour we hold the most of.
      if (c.color) s += counts[c.color] * (hard ? 2 : 0.5);
      if (hard && c.color) {
        // How many of my cards could follow this one next time round?
        s += p.hand.filter((o) => o !== c && (o.color === c.color || (o.kind === c.kind && o.n === c.n) || !o.color)).length;
        // Evidence about the next player: they drew on this colour before (good), or just played it (bad).
        if (this.drewOn.get(nextP.id)?.[c.color]) s += 1.5;
        if (this.lastPlayedColor.get(nextP.id) === c.color) s -= 0.75;
      }
      // 7-0: a 7 is great when someone has a tiny hand and ours is big; a 0 shuffles everyone.
      if (e.rules.sevenZero && c.kind === 'num' && hard) {
        const smallest = Math.min(...e.players.filter((q) => q !== p).map((q) => q.hand.length));
        if (c.n === 7) s += smallest < p.hand.length - 1 ? 6 + (p.hand.length - 1 - smallest) : -5;
        if (c.n === 0) s += nextP.hand.length < p.hand.length - 1 && e.dir === 1 ? 4 : -2;
      }
      if (late) s += points(c) * (hard ? 0.15 : 0.08);
      // Pending stack: always stack if we can.
      if (e.pendingDraw > 0) s += 20;
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    // Hard bots keep a wild for later (draw instead) while the hand is still big.
    if (hard && best && !best.color && e.phase === 'play' && !e.pendingDraw && !danger && p.hand.length >= 5) return null;
    return best ?? playable.find((c) => c.kind !== 'wild4') ?? null;
  }

  private colorCounts(p: Player): Record<Color, number> {
    const counts = zero();
    for (const c of p.hand) if (c.color) counts[c.color] += 1 + (c.kind === 'num' ? 0 : 0.5);
    return counts;
  }

  private bestColor(p: Player, playing: Card | null): Color {
    const e = this.e;
    const counts = this.colorCounts({ ...p, hand: p.hand.filter((c) => c !== playing) });
    if (this.level === 'easy' && Math.random() < 0.4) return COLORS[Math.floor(Math.random() * 4)]!;
    if (this.level === 'hard') {
      // Evidence: colours opponents had to draw on are good, the next player's last colour is bad.
      const nextP = this.nextPlayer();
      for (const [id, d] of this.drewOn) {
        const q = e.player(id);
        if (!q || q === p) continue;
        const w = q === nextP ? 0.4 : 0.15;
        for (const c of COLORS) counts[c] += Math.min(2, d[c]) * w;
      }
      const lastNext = this.lastPlayedColor.get(nextP.id);
      if (lastNext) counts[lastNext] -= 0.7;
    }
    let best: Color = COLORS[Math.floor(Math.random() * 4)]!;
    for (const c of COLORS) if (counts[c] > counts[best]) best = c;
    return best;
  }

  private swapTarget(p: Player): string {
    const others = this.e.players.filter((q) => q !== p);
    if (this.level === 'easy') return others[Math.floor(Math.random() * others.length)]!.id;
    return others.sort((a, b) => a.hand.length - b.hand.length)[0]!.id;
  }

  private shouldChallenge(me: Player): boolean {
    const e = this.e;
    const by = e.wild4 && e.player(e.wild4.by);
    if (!by) return false;
    // Winning a challenge swings 8 cards, losing costs 2 extra: worth it only when a
    // bluff is plausible — a big hand, or a human (bots rarely bluff).
    if (this.level !== 'hard') {
      const base = this.level === 'easy' ? 0.2 : 0.12;
      const big = by.hand.length >= 6 ? 0.12 : 0;
      const human = by.bot ? 0 : 0.1;
      return Math.random() < base + big + human;
    }
    // Hard: weigh the evidence instead of tossing a coin.
    let odds = 0.05;
    if (by.hand.length >= 7) odds += 0.2;
    else if (by.hand.length >= 5) odds += 0.1;
    if (!by.bot) odds += 0.15;
    // They picked the colour that was in play themselves (a Wild of theirs just before) and now say they hold none of it.
    const under = e.discard[e.discard.length - 2];
    if (under && this.wildBy.get(under.id) === by.id) odds += 0.35;
    // They were seen drawing on that colour → they probably really had none.
    if (this.colorBefore && (this.drewOn.get(by.id)?.[this.colorBefore] ?? 0) > 0) odds -= 0.2;
    // They just played that colour a moment ago → holding more of it is likely.
    if (this.colorBefore && this.lastPlayedColor.get(by.id) === this.colorBefore && by.hand.length >= 4) odds += 0.15;
    // When I'm about to go out, a challenge that fails costs 6 — be careful.
    if (me.hand.length <= 2) odds -= 0.1;
    return Math.random() < Math.max(0, Math.min(0.85, odds));
  }
}
