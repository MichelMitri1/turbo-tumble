import { getCard } from './cards';
import { BRIDGES, RIVER_Y, type BattleEngine, type Unit } from './engine';
import type { CardDefinition, Team } from './types';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

interface Profile {
  /** Seconds between decisions. */
  think: number;
  /** Seconds before it notices a new enemy troop. */
  reaction: number;
  /** Chance a decision is fumbled (wrong spot / random card). */
  mistakes: number;
  /** Elixir to bank before starting a push. */
  pushAt: number;
  /** Supports its pushes, counter-pushes, spends spells for value, punishes overspending. */
  smart: boolean;
}

const PROFILE: Record<AIDifficulty, Profile> = {
  easy: { think: 1.7, reaction: 1.8, mistakes: 0.45, pushAt: 5.5, smart: false },
  normal: { think: 0.9, reaction: 0.9, mistakes: 0.15, pushAt: 8, smart: false },
  hard: { think: 0.4, reaction: 0.3, mistakes: 0, pushAt: 8.5, smart: true },
};

/**
 * The rival: reads the board every think tick and either defends (counter the
 * biggest threat with the right kind of card, placed to pull or intercept),
 * spends a spell for value, or builds a push behind a tank.
 */
export class ArenaAI {
  private timer = 2.5;
  private get p() {
    return PROFILE[this.level];
  }
  /** Threats we've seen and when (reaction delay). */
  private seen = new Map<number, number>();

  constructor(
    private readonly engine: BattleEngine,
    readonly team: Team = 'red',
    readonly level: AIDifficulty = 'normal',
  ) {}

  update(dt: number): void {
    const e = this.engine;
    if (e.phase !== 'battle' && e.phase !== 'overtime') return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.p.think * (0.7 + e.rand() * 0.6);
    this.decide();
  }

  private get me() {
    return this.engine.player(this.team);
  }

  /** +1 for red's half direction (towards blue), so "forward" = towards the enemy. */
  private get fwd(): number {
    return this.team === 'red' ? 1 : -1;
  }

  private myHalf(y: number): boolean {
    return this.team === 'red' ? y < RIVER_Y : y > RIVER_Y;
  }

  private decide(): void {
    const e = this.engine;
    const hand = this.me.hand.map(getCard).filter((c) => e.costOf(this.team, c) <= this.me.elixir);
    if (!hand.length) return;
    const now = e.time;
    const enemies = e.units.filter((u) => !u.dead && u.team !== this.team && u.kind === 'troop' && !u.burrow);
    for (const u of enemies) if (!this.seen.has(u.id)) this.seen.set(u.id, now);
    const visible = enemies.filter((u) => now - this.seen.get(u.id)! >= this.p.reaction);
    // Threats: enemy troops on our half or about to cross.
    const threats = visible.filter((u) => this.myHalf(u.y) || Math.abs(u.y - RIVER_Y) < 4);
    if (this.p.mistakes && e.rand() < this.p.mistakes * 0.5) {
      // A clumsy play: a random affordable card somewhere on our side.
      const c = hand[Math.floor(e.rand() * hand.length)]!;
      if (c.type !== 'spell' || e.rand() < 0.3) this.place(c, 2 + e.rand() * 14, RIVER_Y - this.fwd * (2 + e.rand() * 11));
      return;
    }
    if (threats.length && this.defend(threats, hand)) return;
    if ((this.p.smart || this.level === 'normal') && this.spellForValue(visible, hand)) return;
    if (this.p.smart && this.punish(hand)) return;
    this.attack(hand);
  }

  // ------------------------------------------------------------------ defence

  private defend(threats: Unit[], hand: CardDefinition[]): boolean {
    const e = this.engine;
    // Group by lane.
    const lanes = [0, 1].map((lane) => threats.filter((u) => (lane === 0 ? u.x < 9 : u.x >= 9)));
    const scored = lanes.map((l) => ({ units: l, score: l.reduce((s, u) => s + u.hp + u.damage * 4, 0) })).sort((a, b) => b.score - a.score);
    const lane = scored[0]!;
    if (!lane.units.length) return false;
    // Already defended? Count our troops near the threat.
    const cx = lane.units.reduce((s, u) => s + u.x, 0) / lane.units.length;
    const cy = lane.units.reduce((s, u) => s + u.y, 0) / lane.units.length;
    const ours = e.units.filter((u) => !u.dead && u.team === this.team && u.kind !== 'tower' && Math.hypot(u.x - cx, u.y - cy) < 5);
    const ourPower = ours.reduce((s, u) => s + u.hp + u.damage * 4, 0);
    if (ourPower > lane.score * 1.1) return false;
    const air = lane.units.filter((u) => u.flying);
    const swarm = lane.units.filter((u) => u.maxHp < 400).length >= 3;
    const tank = lane.units.find((u) => u.maxHp > 2000);
    const buildingHunter = lane.units.find((u) => u.card.targets === 'buildings');

    const pick = (pred: (c: CardDefinition) => boolean, score: (c: CardDefinition) => number = () => 0): CardDefinition | undefined =>
      hand.filter((c) => pred(c) && (c.type !== 'spell' || c.id === 'sky-drop')).sort((a, b) => score(b) - score(a))[0];
    let card: CardDefinition | undefined;
    if (air.length) card = pick((c) => c.targets === 'all' && c.damage > 0, (c) => c.damage / c.hitSpeed * c.count - c.cost * 30);
    if (!card && swarm) card = pick((c) => Boolean(c.abilities.splash) && c.damage > 0) ?? this.spellOn(lane.units, hand, ['arrows', 'zap', 'rolling-log', 'fireball', 'giant-snowball', 'viking-keg', 'poison']);
    if (!card && tank) card = pick((c) => (c.damage / c.hitSpeed) * c.count > 280 || Boolean(c.abilities.ramp) || c.count >= 10, (c) => (c.damage / c.hitSpeed) * c.count * (c.abilities.ramp ? 4 : 1));
    if (!card && buildingHunter) card = pick((c) => c.type === 'building' && c.damage > 0) ?? pick((c) => c.damage > 0 && c.cost <= 4);
    if (!card) card = pick((c) => c.damage > 0 && c.targets !== 'buildings' && (!air.length || c.targets === 'all'), (c) => -Math.abs(c.cost - 3.5));
    if (!card) return false;
    if (card.type === 'spell' && card.id !== 'sky-drop') return this.cast(card, lane.units);
    if (card.id === 'sky-drop') return this.place(card, cx, this.myHalf(cy) ? cy : RIVER_Y - this.fwd * 2);
    if (e.rand() < this.p.mistakes) return false;
    // Placement: buildings pull from the centre; troops intercept between threat and tower.
    let x: number;
    let y: number;
    if (card.type === 'building') {
      x = 9 + (cx < 9 ? -1.2 : 1.2);
      y = RIVER_Y - this.fwd * 6.5;
    } else if (card.range > 3) {
      // Ranged: behind the tower line, opposite side of the lane centre.
      x = cx < 9 ? 5.5 : 12.5;
      y = RIVER_Y - this.fwd * 10.5;
    } else {
      x = Math.min(17, Math.max(1, cx + (cx < 9 ? 1.2 : -1.2)));
      y = this.myHalf(cy) ? cy - this.fwd * 2.2 : RIVER_Y - this.fwd * 3.5;
    }
    return this.place(card, x, y);
  }

  private spellOn(units: Unit[], hand: CardDefinition[], ids: string[]): CardDefinition | undefined {
    const hit = units.reduce((s, u) => s + u.card.cost / Math.max(1, u.card.count), 0);
    for (const id of ids) {
      const c = hand.find((h) => h.id === id);
      if (c && hit >= c.cost * 0.9) return c;
    }
    return undefined;
  }

  private cast(card: CardDefinition, units: Unit[]): boolean {
    const r = card.spell?.radius ?? 2;
    let best = { x: 0, y: 0, value: 0 };
    for (const u of units) {
      const near = units.filter((v) => Math.hypot(v.x - u.x, v.y - u.y) <= r);
      const value = near.reduce((s, v) => s + v.card.cost / Math.max(1, v.card.count) + (v.hp > 0 ? 0.1 : 0), 0);
      if (value > best.value) best = { x: near.reduce((s, v) => s + v.x, 0) / near.length, y: near.reduce((s, v) => s + v.y, 0) / near.length, value };
    }
    if (best.value < card.cost * 0.8) return false;
    // Lead moving targets a little.
    const lead = card.spell?.travel === 'fromKing' ? 0.7 : 0.2;
    const mover = units[0];
    const y = best.y + (mover ? mover.dirY * mover.speed * lead : 0);
    if (card.spell?.travel === 'roll') return this.place(card, best.x, best.y - this.fwd * 4);
    return this.place(card, best.x, y);
  }

  // ------------------------------------------------------------------ value spells

  private spellForValue(visible: Unit[], hand: CardDefinition[]): boolean {
    const spells = hand.filter((c) => c.type === 'spell' && (c.spell?.damage ?? 0) > 0);
    for (const s of spells) {
      const r = s.spell!.radius;
      // Troops clumped near an enemy tower: spell hits both.
      for (const t of this.engine.towers(this.team === 'red' ? 'blue' : 'red')) {
        const near = visible.filter((u) => Math.hypot(u.x - t.x, u.y - t.y) < r + 1);
        const value = near.reduce((sum, u) => sum + u.card.cost / Math.max(1, u.card.count), 0) + (s.spell!.damage * (s.spell!.towerDamage ?? 1)) / 300;
        if (value >= s.cost + 1) return this.place(s, (t.x + near.reduce((a, u) => a + u.x, 0)) / (near.length + 1), (t.y + near.reduce((a, u) => a + u.y, 0)) / (near.length + 1));
      }
    }
    // Rocket / Lightning / Fireball can finish a low tower.
    for (const t of this.engine.towers(this.team === 'red' ? 'blue' : 'red')) {
      const finisher = spells.find((s) => s.spell!.damage * (s.spell!.towerDamage ?? 1) >= t.hp);
      if (finisher) return this.place(finisher, t.x, t.y);
    }
    return false;
  }

  // ------------------------------------------------------------------ offence

  private attack(hand: CardDefinition[]): void {
    const e = this.engine;
    const el = this.me.elixir;
    const pushing = e.units.filter((u) => !u.dead && u.team === this.team && u.kind === 'troop');
    const tankOut = pushing.find((u) => u.maxHp > 1800 && (u.card.targets === 'buildings' || u.maxHp > 2500));
    // Hard: turn surviving defenders into a counter-push.
    if (this.p.smart && !tankOut && el >= 4) {
      const defenders = pushing.filter((u) => this.myHalf(u.y) && u.hp > u.maxHp * 0.4 && u.card.cost >= 3);
      const lead = defenders.sort((a, b) => b.hp - a.hp)[0];
      const support = lead && hand.filter((c) => c.type === 'troop' && c.damage > 0 && c.cost <= el - 1).sort((a, b) => b.hp - a.hp)[0];
      if (lead && support && Math.abs(lead.y - RIVER_Y) < 9) return void this.place(support, lead.x, lead.y - this.fwd * 1.5);
    }
    // Support an existing push.
    if (tankOut && el >= 3 && this.level !== 'easy') {
      const support = hand.filter((c) => c.type === 'troop' && c.damage > 0 && c.targets !== 'buildings' && c.cost <= el).sort((a, b) => b.range - a.range)[0];
      if (support) {
        const behind = tankOut.y - this.fwd * 1.8;
        const y = this.myHalf(behind) ? behind : RIVER_Y - this.fwd * 1.5;
        this.place(support, tankOut.x, y);
        return;
      }
    }
    const laneX = this.weakLaneX();
    if (this.utility(hand, el, pushing, laneX)) return;
    if (el < this.p.pushAt) return;
    // Win condition first: tank at the back, fast ones at the bridge.
    const win = hand.filter((c) => c.type === 'troop' && (c.targets === 'buildings' || c.abilities.burrow)).sort((a, b) => b.cost - a.cost)[0];
    if (win) {
      if (win.abilities.burrow) {
        const t = this.engine.towers(this.team === 'red' ? 'blue' : 'red').find((u) => Math.abs(u.x - laneX) < 3) ?? this.engine.towers(this.team === 'red' ? 'blue' : 'red')[0];
        if (t) this.place(win, t.x, t.y - this.fwd * 1.8);
        return;
      }
      const fast = win.speed === 'fast' || win.speed === 'veryFast';
      const y = fast ? RIVER_Y - this.fwd * 1.6 : RIVER_Y - this.fwd * 13.5;
      this.place(win, laneX, y);
      return;
    }
    // Otherwise lead with the beefiest troop, or cycle the cheapest card when full.
    const troops = hand.filter((c) => c.type === 'troop' && c.damage > 0);
    const lead = troops.sort((a, b) => b.hp * b.count - a.hp * a.count)[0];
    if (lead && (el >= 9.5 || lead.hp * lead.count > 1200)) {
      this.place(lead, laneX, RIVER_Y - this.fwd * (lead.hp > 2000 ? 12 : 2.5));
      return;
    }
    if (el >= 9.8) {
      const cheap = hand.filter((c) => c.type !== 'spell').sort((a, b) => a.cost - b.cost)[0];
      if (cheap) this.place(cheap, laneX, RIVER_Y - this.fwd * 12);
    }
  }

  /** Hard: after a big enemy play, hit the other lane while they're low on elixir. */
  private punish(hand: CardDefinition[]): boolean {
    const e = this.engine;
    const foe = e.player(this.team === 'red' ? 'blue' : 'red');
    if (foe.elixir > 3 || this.me.elixir < 5) return false;
    const fast = hand.filter((c) => c.type === 'troop' && (c.targets === 'buildings' || c.speed === 'fast' || c.speed === 'veryFast') && c.damage > 0 && c.cost <= this.me.elixir).sort((a, b) => b.cost - a.cost)[0];
    if (!fast) return false;
    const theirs = e.units.filter((u) => !u.dead && u.team !== this.team && u.kind === 'troop');
    const busy = theirs.length ? theirs.reduce((s, u) => s + u.x, 0) / theirs.length : 9;
    return this.place(fast, busy < 9 ? BRIDGES[1]! : BRIDGES[0]!, RIVER_Y - this.fwd * 1.6);
  }

  /** Spawners, pumps, offensive spells, rage/freeze/clone on a push, mirror. */
  private utility(hand: CardDefinition[], el: number, pushing: Unit[], laneX: number): boolean {
    const e = this.engine;
    const foe = this.team === 'red' ? 'blue' : 'red';
    const target = e.towers(foe).find((t) => Math.abs(t.x - laneX) < 3) ?? e.towers(foe)[0];
    // A push arriving at a tower: boost it.
    if (target) {
      const near = pushing.filter((u) => Math.hypot(u.x - target.x, u.y - target.y) < 6);
      if (near.length >= 3 || near.some((u) => u.maxHp > 2500)) {
        const boost = hand.find((c) => ['rage', 'freeze', 'clone'].includes(c.id) && c.cost <= el);
        if (boost) {
          const cx = near.reduce((s, u) => s + u.x, 0) / near.length;
          const cy = near.reduce((s, u) => s + u.y, 0) / near.length;
          return boost.id === 'freeze' ? this.place(boost, target.x, target.y) : this.place(boost, cx, cy);
        }
      }
    }
    // Mirror right after a strong troop.
    const mirror = hand.find((c) => c.id === 'mirror');
    const last = this.me.lastPlayed ? getCard(this.me.lastPlayed) : null;
    if (mirror && last && last.type === 'troop' && el >= last.cost + 1 && last.cost <= 5) return this.place(mirror, laneX, RIVER_Y - this.fwd * 3);
    if (el < 7) return false;
    // Graveyard / Goblin Keg / Goblin Burrow straight onto a tower.
    const strike = hand.find((c) => ['graveyard', 'goblin-keg', 'goblin-burrow'].includes(c.id) && c.cost <= el - 1);
    if (strike && target) return this.place(strike, target.x + (target.x < 9 ? 1.5 : -1.5), target.y - this.fwd * 1.5);
    // Spawner buildings and the elixir pump go at the back.
    const build = hand.find((c) => c.type === 'building' && (c.abilities.spawn || c.abilities.elixir) && !c.abilities.burrow && c.cost <= el - 1);
    if (build) return this.place(build, laneX < 9 ? 6 : 12, RIVER_Y - this.fwd * (build.abilities.elixir ? 13 : 9));
    return false;
  }

  /** The lane whose enemy tower is weakest. */
  private weakLaneX(): number {
    const foe = this.team === 'red' ? 'blue' : 'red';
    const ts = this.engine.towers(foe).filter((t) => t.role !== 'king');
    if (!ts.length) return BRIDGES[this.engine.rand() < 0.5 ? 0 : 1]!;
    const weakest = ts.sort((a, b) => a.hp - b.hp)[0]!;
    return weakest.x < 9 ? BRIDGES[0]! : BRIDGES[1]!;
  }

  private place(card: CardDefinition, x: number, y: number): boolean {
    const e = this.engine;
    const cx = Math.max(0.6, Math.min(17.4, x));
    const cy = Math.max(0.6, Math.min(31.4, y));
    for (const [dx, dy] of [[0, 0], [0.8, 0], [-0.8, 0], [0, -this.fwd], [1, -this.fwd], [-1, -this.fwd], [0, -2 * this.fwd]] as const) {
      if (e.play({ team: this.team, cardId: card.id, x: cx + dx, y: cy + dy })) return true;
    }
    return false;
  }
}
