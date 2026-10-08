import { getCard } from './cards';
import { ARENA_H, BRIDGES, RIVER_Y, type BattleEngine, type Unit } from './engine';
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
  /** Spell value needed per elixir spent (lower = more willing). */
  spellBar: number;
  /** Extra elixir it's happy to overspend on a defence (easy throws everything at it). */
  overspend: number;
  /** Counter-pushes, punishes low elixir, utility spells, prediction. */
  smart: boolean;
}

const PROFILE: Record<AIDifficulty, Profile> = {
  easy: { think: 1.8, reaction: 2.2, mistakes: 0.45, pushAt: 5.5, spellBar: 1.6, overspend: 9, smart: false },
  normal: { think: 0.9, reaction: 0.9, mistakes: 0.15, pushAt: 8, spellBar: 1.15, overspend: 1.5, smart: false },
  hard: { think: 0.35, reaction: 0.25, mistakes: 0, pushAt: 8.5, spellBar: 0.95, overspend: 0, smart: true },
};

const SWARM_IDS = new Set(['imp-horde', 'bone-legion', 'graveyard', 'barbarians', 'shield-recruits', 'goblin-gang', 'buzz-bees']);
const SMALL_SPELLS = ['zap', 'rolling-log', 'arrows', 'giant-snowball', 'viking-keg', 'fireball', 'poison', 'void', 'goblin-hex', 'earthquake'];
const isWinCon = (c: CardDefinition) => c.type === 'troop' && (c.targets === 'buildings' || Boolean(c.abilities.burrow));
const dps = (c: CardDefinition) => (c.damage / Math.max(0.2, c.hitSpeed)) * c.count;
const isSwarm = (c: CardDefinition) => c.count >= 4 || SWARM_IDS.has(c.id);

/**
 * The rival. Every think tick it reads the board and picks one play, in priority:
 * overtime all-in → a positive-trade defence of the most dangerous lane → a spell that
 * pays for itself (predicted positions, tower chip counted) → punishing an empty-handed
 * opponent → turning a successful defence into a counter-push → building a push.
 */
export class ArenaAI {
  private timer = 2.5;
  /** Threats we've seen and when (reaction delay). */
  private seen = new Map<number, number>();
  /** Elixir we spent defending recently, and when the lane went quiet. */
  private defenceSpent = 0;
  private lastThreatAt = -99;
  private clearedAt = -99;
  private lastPushAt = -99;
  /** Last defensive play per lane (time, threat value then) so we don't stack answers. */
  private laneDefence: Array<{ t: number; value: number }> = [{ t: -99, value: 0 }, { t: -99, value: 0 }];

  constructor(
    private readonly engine: BattleEngine,
    readonly team: Team = 'red',
    readonly level: AIDifficulty = 'normal',
  ) {}

  private get p(): Profile {
    return PROFILE[this.level];
  }

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

  private get foeTeam(): Team {
    return this.team === 'red' ? 'blue' : 'red';
  }

  /** +1 for red's half direction (towards blue), so "forward" = towards the enemy. */
  private get fwd(): number {
    return this.team === 'red' ? 1 : -1;
  }

  private myHalf(y: number): boolean {
    return this.team === 'red' ? y < RIVER_Y : y > RIVER_Y;
  }

  /** Rows from our king: 0 at our back wall, 32 at theirs. */
  private depth(y: number): number {
    return this.team === 'red' ? y : ARENA_H - y;
  }

  /** Elixir worth of a unit on the board (tokens priced by their stats, damaged units count less). */
  private value(u: Unit): number {
    const c = u.card;
    const base = c.cost > 0 ? c.cost / Math.max(1, c.count) : Math.min(4, u.maxHp / 450 + dps(c) / 180);
    return base * (0.45 + 0.55 * (u.hp + u.shield) / Math.max(1, u.maxHp + u.maxShield));
  }

  private decide(): void {
    const e = this.engine;
    const hand = this.me.hand.map(getCard).filter((c) => e.costOf(this.team, c) <= this.me.elixir);
    if (!hand.length) return;
    const now = e.time;
    const enemies = e.units.filter((u) => !u.dead && u.team !== this.team && u.kind !== 'tower' && !u.burrow && !u.hidden);
    for (const u of enemies) if (!this.seen.has(u.id)) this.seen.set(u.id, now);
    const visible = enemies.filter((u) => now - this.seen.get(u.id)! >= this.p.reaction);
    // Threats: enemy troops on our half or about to cross, siege buildings that reach our towers, pocket buildings.
    const threats = visible.filter((u) => {
      if (u.kind === 'building') return this.myHalf(u.y) || (u.range >= 9 && e.towers(this.team).some((t) => Math.hypot(t.x - u.x, t.y - u.y) - t.radius - u.radius <= u.range + 0.5));
      return this.myHalf(u.y) || (Math.abs(u.y - RIVER_Y) < 3.5 && u.dirY * this.fwd < 0.2);
    });
    if (threats.length) this.lastThreatAt = now;
    else if (this.lastThreatAt > this.clearedAt) this.clearedAt = now;
    if (this.p.mistakes && e.rand() < this.p.mistakes * 0.5) {
      // A clumsy play: a random affordable card somewhere on our side.
      const c = hand[Math.floor(e.rand() * hand.length)]!;
      if (c.type !== 'spell' || e.rand() < 0.3) this.place(c, 2 + e.rand() * 14, RIVER_Y - this.fwd * (2 + e.rand() * 11));
      return;
    }
    if (e.phase === 'overtime' && this.p.smart && this.allIn(hand, threats)) return;
    if (threats.length && this.defend(threats, hand)) return;
    // Trivial dribbles (a lone skeleton) are the tower's job; they shouldn't stall our push.
    const serious = threats.filter((u) => this.value(u) >= 1.2 || u.card.targets === 'buildings' || u.kind === 'building');
    if (this.level !== 'easy' && this.spellForValue(visible, hand)) return;
    if (this.p.smart && this.utilityDefence(threats, hand)) return;
    if (this.p.smart && this.punish(hand)) return;
    if (this.p.smart && this.counterPush(hand, threats)) return;
    this.attack(hand, this.p.smart ? serious : threats);
  }

  // ------------------------------------------------------------------ defence

  private defend(threats: Unit[], hand: CardDefinition[]): boolean {
    const e = this.engine;
    const lanes = [0, 1].map((lane) => threats.filter((u) => (lane === 0 ? u.x < 9 : u.x >= 9)));
    const scored = lanes.map((l) => ({ units: l, value: l.reduce((s, u) => s + this.value(u) + (u.card.targets === 'buildings' || u.kind === 'building' ? 1.2 : 0), 0) })).sort((a, b) => b.value - a.value);
    const lane = scored[0]!;
    if (!lane.units.length) return false;
    const cx = lane.units.reduce((s, u) => s + u.x, 0) / lane.units.length;
    const cy = lane.units.reduce((s, u) => s + u.y, 0) / lane.units.length;
    // Already defended? Our troops near the threat, in elixir.
    const ours = e.units.filter((u) => !u.dead && u.team === this.team && u.kind !== 'tower' && Math.hypot(u.x - cx, u.y - cy) < (u.deploy > 0 ? 7 : 5.5));
    const ourValue = ours.reduce((s, u) => s + this.value(u) * (u.card.targets === 'buildings' ? 0.3 : 1), 0);
    // One answer at a time: wait for the last defender to land unless the threat has grown a lot.
    const laneIx = cx < 9 ? 0 : 1;
    const prev = this.laneDefence[laneIx]!;
    if (e.time - prev.t < 1.3 && lane.value < prev.value * 1.6) return false;
    const air = lane.units.filter((u) => u.flying);
    const allAir = air.length === lane.units.length;
    const swarm = lane.units.filter((u) => u.maxHp < 400).length >= 4;
    const tank = lane.units.find((u) => u.maxHp > 2000);
    const hunter = lane.units.find((u) => u.card.targets === 'buildings' && u.kind === 'troop');
    const siege = lane.units.find((u) => u.kind === 'building');
    const ranged = lane.units.filter((u) => u.range > 3 && u.maxHp < 900);
    const nearTower = lane.units.some((u) => this.depth(u.y) < 11);
    if (ourValue >= lane.value * (nearTower ? 1.15 : 0.9) && !(siege && !ours.some((u) => u.card.targets === 'buildings' || u.range > 4))) return false;
    // Elixir trade: the answer must be worth it; tiny threats are left to the tower.
    const budget = lane.value - ourValue + (nearTower ? 1.5 : 0.5) + (hunter || siege ? 1.5 : 0) + this.p.overspend;
    if (budget < 1 && !hunter && !siege) return false;
    const canHit = (c: CardDefinition) => c.damage > 0 && (!air.length || c.targets === 'all' || (!allAir && c.type !== 'building'));
    const score = (c: CardDefinition): number => {
      if (c.type === 'spell') {
        if (c.id === 'sky-drop') return 2;
        return -99;
      }
      if (!canHit(c)) return -99;
      let s = 0;
      const cost = e.costOf(this.team, c);
      s -= Math.max(0, cost - budget) * 2.4;
      if (c.targets === 'buildings') s -= 6;
      if (air.length && c.targets === 'all') s += 2;
      if (swarm) s += c.abilities.splash ? 4 : c.count >= 3 ? -1 : -2;
      if (tank) s += Math.min(4, dps(c) / 120) + (c.abilities.ramp ? 3 : 0) + (c.count >= 3 && c.hp < 400 ? 1.5 : 0);
      if (hunter && c.type === 'building') s += 3;
      if (siege && c.type === 'building' && c.range >= 9) s -= 2;
      if (siege && (c.targets === 'buildings' || c.hp > 1500)) s += 3;
      if (ranged.length && !tank && (c.speed === 'fast' || c.speed === 'veryFast' || c.abilities.dash)) s += 1.5;
      if (ranged.length && c.range > 3) s += 1;
      if (c.hp * c.count > 1500 && !tank && !hunter) s -= 1;
      if (c.abilities.elixir || c.abilities.spawn) s -= 3;
      s += Math.min(2, (c.hp * c.count) / 1200) * 0.5 - Math.abs(cost - 3.5) * 0.15;
      return s;
    };
    // Win conditions stay in hand for offence (unless the threat is a building they can hit).
    const keep = (c: CardDefinition) => this.p.smart && c.targets === 'buildings' && !siege;
    const ranked = hand.map((c) => ({ c, s: score(c) })).filter((x) => x.s > (this.p.smart ? -3 : -50) && !keep(x.c)).sort((a, b) => b.s - a.s);
    // Swarms: a spell is the cheapest answer.
    if (swarm || (air.length >= 3 && air.every((u) => u.maxHp < 400))) {
      const spell = this.bestSpell(lane.units, hand.filter((c) => c.type === 'spell' && SMALL_SPELLS.includes(c.id)), this.p.spellBar * 0.85);
      if (spell) return this.place(spell.card, spell.x, spell.y);
    }
    const best = ranked[0]?.c;
    if (!best) return false;
    // Low elixir and a cheap threat that isn't at the tower yet: let the tower soak it.
    if (this.p.smart && !nearTower && lane.value < 2.5 && this.me.elixir - e.costOf(this.team, best) < 2 && !hunter) return false;
    if (e.rand() < this.p.mistakes * 0.6) return false;
    if (best.id === 'sky-drop') return this.place(best, cx, this.myHalf(cy) ? cy : RIVER_Y - this.fwd * 2);
    this.defenceSpent += e.costOf(this.team, best);
    this.laneDefence[laneIx] = { t: e.time, value: lane.value };
    const towardCentre = cx < 9 ? 1 : -1;
    let x: number;
    let y: number;
    const towerY = RIVER_Y - this.fwd * 9.5;
    if (this.level === 'easy') {
      // Easy just drops it somewhere behind its tower line.
      x = cx + (e.rand() - 0.5) * 4;
      y = towerY + this.fwd * (e.rand() * 3 - 1);
    } else if (best.type === 'building') {
      // Buildings pull from the centre, a little towards the threatened lane.
      x = 9 - towardCentre * 1.2;
      y = RIVER_Y - this.fwd * 6.5;
    } else if (best.range > 3) {
      // Ranged: behind the tower line, tucked towards the middle so both towers cover it.
      x = cx + towardCentre * 2.2;
      y = this.myHalf(cy) ? cy - this.fwd * 3.2 : towerY;
      if (this.depth(y) < 4) y = towerY;
    } else if (this.p.smart && hunter && this.depth(hunter.y) < 13) {
      // Building-hunter in our half: drop the DPS right behind it, inside tower range.
      x = hunter.x + towardCentre * 0.6;
      y = hunter.y - this.fwd * 1.2;
    } else if (tank && !hunter && (best.cost <= 3 || best.hp < 1200)) {
      // Kite a melee tank with cheap units: pull it towards the centre, between the towers.
      x = cx + towardCentre * 2.6;
      y = this.myHalf(cy) ? cy - this.fwd * 2.5 : RIVER_Y - this.fwd * 4;
    } else if (swarm && best.abilities.splash) {
      x = cx;
      y = this.myHalf(cy) ? cy - this.fwd * 0.6 : RIVER_Y - this.fwd * 3.5;
    } else {
      // Melee: meet it in front of our tower (tower support), nudged towards the centre.
      const td = this.depth(cy);
      x = cx + towardCentre * 0.8;
      y = RIVER_Y - this.fwd * (td > 12 ? 5.5 : Math.max(2.5, 16 - td + 1.8));
    }
    return this.place(best, Math.min(17, Math.max(1, x)), y);
  }

  /** Freeze a push at our tower; tornado swarms onto our splash or into the king's range. */
  private utilityDefence(threats: Unit[], hand: CardDefinition[]): boolean {
    const e = this.engine;
    if (!threats.length) return false;
    const freeze = hand.find((c) => c.id === 'freeze');
    const tornado = hand.find((c) => c.id === 'tornado');
    const king = e.towers(this.team).find((t) => t.role === 'king');
    const atTower = threats.filter((u) => this.depth(u.y) < 9.5);
    if (freeze && atTower.length) {
      const v = atTower.reduce((s, u) => s + this.value(u), 0);
      const ours = e.units.filter((u) => !u.dead && u.team === this.team && u.kind === 'troop' && atTower.some((t) => Math.hypot(t.x - u.x, t.y - u.y) < 4));
      if (v >= 6 && (ours.length >= 1 || atTower.some((u) => u.maxHp > 2000))) return this.place(freeze, atTower.reduce((s, u) => s + u.x, 0) / atTower.length, atTower.reduce((s, u) => s + u.y, 0) / atTower.length);
    }
    if (tornado) {
      const ground = threats.filter((u) => u.kind === 'troop' && u.mass < 14);
      const ours = e.units.filter((u) => !u.dead && u.team === this.team && u.kind !== 'tower' && u.card.abilities.splash && u.damage > 0);
      const splash = ours.find((o) => ground.filter((g) => Math.hypot(g.x - o.x, g.y - o.y) < 5.5).length >= 3);
      if (splash) return this.place(tornado, splash.x, splash.y + this.fwd * 1.2);
      // King activation: drag a troop that's near a princess tower towards the king.
      if (king && !king.active) {
        const near = ground.find((u) => this.depth(u.y) < 10 && Math.abs(u.x - 9) < 6);
        if (near) return this.place(tornado, 9 + (near.x - 9) * 0.3, king.y + this.fwd * 4.2);
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ spells

  /** Best cast of one of `spells` over `units`: predicted positions, kills counted at full value. */
  private bestSpell(units: Unit[], spells: CardDefinition[], bar: number): { card: CardDefinition; x: number; y: number; value: number } | null {
    const e = this.engine;
    const foe = e.player(this.foeTeam);
    const holds = new Set<string>();
    // Hold the swarm answer if they run a swarm card and it isn't out.
    if (foe.deck.some((id) => isSwarm(getCard(id))) && !units.some((u) => isSwarm(u.card))) for (const id of ['arrows', 'rolling-log', 'zap']) holds.add(id);
    let best: { card: CardDefinition; x: number; y: number; value: number } | null = null;
    for (const card of spells) {
      const s = card.spell!;
      if (!s.damage && !s.freeze && !s.stun) continue;
      const cost = e.costOf(this.team, card);
      const king = e.towers(this.team).find((t) => t.role === 'king');
      const travel = s.travel === 'fromKing' && king ? 0.35 : s.travel === 'roll' ? 0.7 : 0.15;
      const predict = (u: Unit) => {
        const t = s.travel === 'fromKing' && king ? Math.hypot(u.x - king.x, u.y - king.y) / (card.id === 'rocket' ? 9 : 14) + 0.2 : travel;
        const mv = u.moving && this.p.smart ? Math.min(2.5, t * u.speed) : 0;
        return { x: u.x + u.dirX * mv, y: u.y + u.dirY * mv };
      };
      const pts = units.map(predict);
      const ground = s.travel === 'roll' || card.id === 'earthquake';
      for (let i = 0; i < units.length; i++) {
        const c = pts[i]!;
        let value = 0;
        for (let j = 0; j < units.length; j++) {
          const u = units[j]!;
          if (ground && u.flying) continue;
          if (Math.hypot(pts[j]!.x - c.x, pts[j]!.y - c.y) > s.radius + u.radius * 0.5 - 0.2) continue;
          const dmg = u.kind === 'building' && s.buildingBonus ? s.damage * s.buildingBonus : s.damage;
          const kills = dmg >= u.hp + u.shield;
          value += kills ? this.value(u) + 0.3 : this.value(u) * Math.min(0.6, dmg / Math.max(1, u.hp + u.shield)) * 0.7 + (s.freeze || s.stun ? 0.3 : 0);
        }
        // Tower chip: worth more when the tower is low or the clock is short.
        for (const t of e.towers(this.foeTeam)) {
          if (Math.hypot(t.x - c.x, t.y - c.y) > s.radius + t.radius * 0.5) continue;
          const chip = s.damage * (s.towerDamage ?? 1);
          value += chip >= t.hp ? 8 : (chip / 300) * (e.phase === 'overtime' ? 1.6 : 0.8) * (t.hp < 900 ? 1.6 : 1);
        }
        if (holds.has(card.id)) value -= 1.2;
        if (value >= cost * bar && (!best || value - cost * 0.5 > best.value - e.costOf(this.team, best.card) * 0.5)) best = { card, x: c.x, y: c.y, value };
      }
    }
    if (!best) return null;
    const s = best.card.spell!;
    // Rolling spells start behind the target and roll forward over it.
    if (s.travel === 'roll') best = { ...best, y: best.y - this.fwd * Math.min(4, (s.rollLength ?? 8) * 0.4) };
    return best;
  }

  private spellForValue(visible: Unit[], hand: CardDefinition[]): boolean {
    const e = this.engine;
    const spells = hand.filter((c) => c.type === 'spell' && (c.spell?.damage ?? 0) > 0);
    if (!spells.length) return false;
    // Finish a low tower outright.
    for (const t of e.towers(this.foeTeam)) {
      const finisher = spells.find((s) => s.spell!.damage * (s.spell!.towerDamage ?? 1) >= t.hp);
      if (finisher) return this.place(finisher, t.x, t.y);
    }
    const units = visible.filter((u) => u.kind === 'troop' || u.card.abilities.elixir || u.range >= 9 || u.card.abilities.spawn);
    const best = this.bestSpell(units, spells, this.p.spellBar * (this.p.smart ? 0.85 : 1));
    if (!best) return false;
    // Don't throw the big spell at a lone unit crossing while we're low.
    if (best.card.cost >= 4 && this.me.elixir < best.card.cost + 1 && best.value < best.card.cost * 1.3) return false;
    return this.place(best.card, best.x, best.y);
  }

  // ------------------------------------------------------------------ offence

  /** Hard: an empty-handed opponent gets a win-condition at the bridge. */
  private punish(hand: CardDefinition[]): boolean {
    const e = this.engine;
    const foe = e.player(this.foeTeam);
    if (foe.elixir > 2 || this.me.elixir < 4) return false;
    const win = hand.filter((c) => isWinCon(c) || (c.type === 'troop' && (c.speed === 'fast' || c.speed === 'veryFast') && c.damage > 0 && c.hp * c.count > 900)).sort((a, b) => (isWinCon(b) ? 10 : 0) + b.cost - (isWinCon(a) ? 10 : 0) - a.cost)[0];
    if (!win) return false;
    const theirs = e.units.filter((u) => !u.dead && u.team !== this.team && u.kind === 'troop');
    const busy = theirs.length ? theirs.reduce((s, u) => s + u.x, 0) / theirs.length : this.weakLaneX();
    const laneX = theirs.length ? (busy < 9 ? BRIDGES[1]! : BRIDGES[0]!) : busy;
    if (win.abilities.burrow) return this.minerOn(win, laneX);
    this.lastPushAt = e.time;
    return this.place(win, laneX, RIVER_Y - this.fwd * 1.6);
  }

  /** After a defence that left ≥ 4 elixir of our troops alive and the lane clear, push with them. */
  private counterPush(hand: CardDefinition[], threats: Unit[]): boolean {
    const e = this.engine;
    if (threats.length || e.time - this.clearedAt > 10 || this.me.elixir < 4) return false;
    const survivors = e.units.filter((u) => !u.dead && u.team === this.team && u.kind === 'troop' && this.depth(u.y) > 4 && this.depth(u.y) < 20);
    const worth = survivors.reduce((s, u) => s + this.value(u), 0);
    if (worth < 4 || this.defenceSpent < 3) return false;
    const lead = survivors.sort((a, b) => b.hp - a.hp)[0]!;
    const el = this.me.elixir;
    // A tank in front of them if we have one, else support behind.
    const tank = hand.filter((c) => c.type === 'troop' && c.hp * c.count > 1800 && c.cost <= el).sort((a, b) => b.hp - a.hp)[0];
    const support = hand.filter((c) => c.type === 'troop' && c.damage > 0 && c.targets !== 'buildings' && c.cost <= el && c.range > 3).sort((a, b) => b.cost - a.cost)[0];
    const pick = tank ?? support;
    if (!pick) return false;
    this.defenceSpent = 0;
    this.clearedAt = -99;
    this.lastPushAt = e.time;
    const ahead = pick === tank ? lead.y + this.fwd * 1.6 : lead.y - this.fwd * 1.8;
    return this.place(pick, lead.x, this.myHalf(ahead) ? ahead : RIVER_Y - this.fwd * 1.5);
  }

  /** Overtime: everything into the lowest enemy tower. */
  private allIn(hand: CardDefinition[], threats: Unit[]): boolean {
    const e = this.engine;
    const target = e.towers(this.foeTeam).filter((t) => t.role !== 'king').sort((a, b) => a.hp - b.hp)[0] ?? e.towers(this.foeTeam)[0];
    if (!target) return false;
    // Still defend a real threat at our own low tower.
    const ourLow = Math.min(...e.towers(this.team).map((t) => t.hp));
    if (threats.some((u) => this.depth(u.y) < 11) && ourLow < target.hp) return false;
    const laneX = target.x < 9 ? BRIDGES[0]! : BRIDGES[1]!;
    const el = this.me.elixir;
    const near = e.units.filter((u) => !u.dead && u.team === this.team && u.kind === 'troop' && Math.hypot(u.x - target.x, u.y - target.y) < 7);
    const spells = hand.filter((c) => c.type === 'spell' && (c.spell?.damage ?? 0) > 0);
    const chip = spells.sort((a, b) => b.spell!.damage * (b.spell!.towerDamage ?? 1) - a.spell!.damage * (a.spell!.towerDamage ?? 1))[0];
    if (chip && (chip.spell!.damage * (chip.spell!.towerDamage ?? 1) >= target.hp || (near.length >= 2 && el >= 8))) return this.place(chip, target.x, target.y);
    if (el < 5) return false;
    const win = hand.filter((c) => isWinCon(c) && c.cost <= el).sort((a, b) => b.cost - a.cost)[0];
    if (win) {
      this.lastPushAt = e.time;
      return win.abilities.burrow ? this.minerOn(win, laneX) : this.place(win, laneX + (laneX < 9 ? 1 : -1), RIVER_Y - this.fwd * 1.6);
    }
    const troop = hand.filter((c) => c.type === 'troop' && c.damage > 0 && c.cost <= el).sort((a, b) => b.hp * b.count - a.hp * a.count)[0];
    if (!troop) return false;
    this.lastPushAt = e.time;
    return this.place(troop, laneX + (laneX < 9 ? 1 : -1), RIVER_Y - this.fwd * (near.length ? 1.6 : 3));
  }

  private minerOn(card: CardDefinition, laneX: number): boolean {
    const e = this.engine;
    const t = e.towers(this.foeTeam).find((u) => Math.abs(u.x - laneX) < 3) ?? e.towers(this.foeTeam)[0];
    return t ? this.place(card, t.x + (t.x < 9 ? 1.4 : -1.4), t.y - this.fwd * 1.4) : false;
  }

  private attack(hand: CardDefinition[], threats: Unit[]): void {
    const e = this.engine;
    const el = this.me.elixir;
    const pushing = e.units.filter((u) => !u.dead && u.team === this.team && u.kind === 'troop');
    const tankOut = pushing.find((u) => u.maxHp > 1800 && (u.card.targets === 'buildings' || u.maxHp > 2500) && this.depth(u.y) > 3);
    const foe = e.player(this.foeTeam);
    // Support an existing push: ranged behind the tank; once it crosses, also fast melee at the bridge.
    if (tankOut && el >= 3 && this.level !== 'easy') {
      const behindTank = pushing.filter((u) => u !== tankOut && Math.hypot(u.x - tankOut.x, u.y - tankOut.y) < 4).length;
      const crossed = !this.myHalf(tankOut.y);
      if (behindTank < (crossed ? 3 : 2) && (el >= 4 || crossed)) {
        const support = hand.filter((c) => c.type === 'troop' && c.damage > 0 && c.targets !== 'buildings' && c.cost <= el && !c.abilities.elixir).sort((a, b) => b.range - a.range || b.cost - a.cost)[0];
        if (support) {
          const behind = tankOut.y - this.fwd * 1.8;
          this.place(support, tankOut.x, this.myHalf(behind) ? behind : RIVER_Y - this.fwd * 1.5);
          return;
        }
      }
    }
    const laneX = this.weakLaneX();
    if (this.utility(hand, el, pushing, laneX)) return;
    // Don't start a push while they're loaded and we're thin, unless we're full.
    const wait = this.p.smart && foe.elixir >= 8 && el < 9 && !tankOut;
    if (el < this.p.pushAt || wait || (threats.length && el < 9)) return;
    if (this.p.smart && e.multiplier === 1 && el < 9.5) return;
    // Win condition first: slow tanks at the back (offset from the tower), fast ones at the bridge.
    const win = hand.filter(isWinCon).sort((a, b) => b.cost - a.cost)[0];
    const offX = laneX + (laneX < 9 ? 2.2 : -2.2);
    this.lastPushAt = e.time;
    if (win) {
      if (win.abilities.burrow) {
        // Miner: onto the tower, with a ranged unit behind it when we have one.
        this.minerOn(win, laneX);
        return;
      }
      // At the bridge when they can't answer (or it's fast), else from the back with time to support.
      const bridge = win.speed === 'fast' || win.speed === 'veryFast' || (this.p.smart && foe.elixir < 5);
      this.place(win, bridge ? laneX : offX, RIVER_Y - this.fwd * (bridge ? 1.6 : 13.5));
      return;
    }
    // Otherwise lead with the beefiest troop, or cycle the cheapest card when full.
    const troops = hand.filter((c) => c.type === 'troop' && c.damage > 0 && !c.abilities.elixir);
    const lead = troops.sort((a, b) => b.hp * b.count - a.hp * a.count)[0];
    if (lead && (el >= 9.5 || lead.hp * lead.count > 1200)) {
      this.place(lead, lead.hp > 2000 ? offX : laneX, RIVER_Y - this.fwd * (lead.hp > 2000 ? 12 : lead.range > 3 ? 5 : 2.5));
      return;
    }
    if (el >= 9.8) {
      const cheap = hand.filter((c) => c.type !== 'spell').sort((a, b) => a.cost - b.cost)[0];
      if (cheap) this.place(cheap, offX, RIVER_Y - this.fwd * 12);
    }
  }

  /** Spawners, pumps, rage/clone/freeze/graveyard on a push, mirror. */
  private utility(hand: CardDefinition[], el: number, pushing: Unit[], laneX: number): boolean {
    const e = this.engine;
    const foe = this.foeTeam;
    const target = e.towers(foe).find((t) => Math.abs(t.x - laneX) < 3) ?? e.towers(foe)[0];
    if (target) {
      const near = pushing.filter((u) => Math.hypot(u.x - target.x, u.y - target.y) < 6.5 && !this.myHalf(u.y));
      const tank = near.find((u) => u.maxHp > 2000);
      const nearValue = near.reduce((s, u) => s + this.value(u), 0);
      const defenders = e.units.filter((u) => !u.dead && u.team === foe && u.kind !== 'tower' && Math.hypot(u.x - target.x, u.y - target.y) < 6);
      // Rage behind a tank that has crossed with support; clone a big push at the tower; freeze when defenders arrive.
      const rage = hand.find((c) => c.id === 'rage');
      if (rage && tank && near.length >= 2 && !near.some((u) => u.rage > 0.5)) return this.place(rage, tank.x, tank.y - this.fwd * 1.5);
      const clone = hand.find((c) => c.id === 'clone');
      if (clone && near.length >= 3 && nearValue >= 7) return this.place(clone, near.reduce((s, u) => s + u.x, 0) / near.length, near.reduce((s, u) => s + u.y, 0) / near.length);
      const freeze = hand.find((c) => c.id === 'freeze');
      if (freeze && nearValue >= 6 && (defenders.length >= 2 || target.hp < 1200 || (this.p.smart && defenders.length >= 1 && tank))) {
        const fx = defenders.length ? (target.x + defenders.reduce((s, u) => s + u.x, 0) / defenders.length) / 2 : target.x;
        const fy = defenders.length ? (target.y + defenders.reduce((s, u) => s + u.y, 0) / defenders.length) / 2 : target.y;
        return this.place(freeze, fx, fy);
      }
      // Graveyard once a tank is tanking at the tower, or on an undefended tower when we're rich.
      const grave = hand.find((c) => c.id === 'graveyard');
      if (grave && ((tank && Math.hypot(tank.x - target.x, tank.y - target.y) < 4) || (el >= 8 && !defenders.length))) return this.place(grave, target.x + (target.x < 9 ? 1.5 : -1.5), target.y - this.fwd * 1.2);
    }
    // Siege: X-Bow / Mortar at the river reach the tower from our side.
    const siege = hand.find((c) => c.type === 'building' && c.range >= 9 && c.damage > 0 && c.cost <= el - (this.p.smart ? 1 : 0));
    const busy = e.units.some((u) => !u.dead && u.team === foe && u.kind === 'troop' && this.myHalf(u.y));
    if (siege && target && !busy && (this.level !== 'easy' || el >= 9) && !e.units.some((u) => !u.dead && u.team === this.team && u.card === siege)) {
      const sx = target.x + (target.x < 9 ? 1.2 : -1.2);
      return this.place(siege, sx, RIVER_Y - this.fwd * (siege.minRange ? 2.6 : 1.7));
    }
    // Mirror right after a strong troop.
    const mirror = hand.find((c) => c.id === 'mirror');
    const last = this.me.lastPlayed ? getCard(this.me.lastPlayed) : null;
    if (mirror && last && last.type === 'troop' && el >= last.cost + 1 && last.cost <= 5 && e.time - this.lastPushAt < 4) return this.place(mirror, laneX, RIVER_Y - this.fwd * 3);
    if (el < 7) return false;
    // Goblin Keg / Goblin Burrow straight onto a tower.
    const strike = hand.find((c) => ['goblin-keg', 'goblin-burrow'].includes(c.id) && c.cost <= el - 1);
    if (strike && target) return this.place(strike, target.x + (target.x < 9 ? 1.5 : -1.5), target.y - this.fwd * 1.5);
    // Pump early when it's quiet; spawner buildings at the back.
    const pump = hand.find((c) => c.abilities.elixir);
    const quiet = e.time - this.lastThreatAt > 4 && e.player(this.foeTeam).elixir < 8;
    if (pump && el >= 8 && e.time < 150 && (quiet || !this.p.smart)) return this.place(pump, laneX < 9 ? 12 : 6, RIVER_Y - this.fwd * 13);
    const build = hand.find((c) => c.type === 'building' && c.abilities.spawn && !c.abilities.burrow && c.cost <= el - 1);
    if (build) return this.place(build, laneX < 9 ? 6.5 : 11.5, RIVER_Y - this.fwd * 9);
    return false;
  }

  /** The lane whose enemy tower is weakest. */
  private weakLaneX(): number {
    const ts = this.engine.towers(this.foeTeam).filter((t) => t.role !== 'king');
    if (!ts.length) return BRIDGES[this.engine.rand() < 0.5 ? 0 : 1]!;
    const weakest = ts.sort((a, b) => a.hp - b.hp)[0]!;
    return weakest.x < 9 ? BRIDGES[0]! : BRIDGES[1]!;
  }

  private place(card: CardDefinition, x: number, y: number): boolean {
    const e = this.engine;
    const cx = Math.max(0.6, Math.min(17.4, x));
    const cy = Math.max(0.6, Math.min(31.4, y));
    for (const [dx, dy] of [[0, 0], [0.8, 0], [-0.8, 0], [0, -this.fwd], [1, -this.fwd], [-1, -this.fwd], [0, -2 * this.fwd], [1.6, 0], [-1.6, 0]] as const) {
      if (e.play({ team: this.team, cardId: card.id, x: cx + dx, y: cy + dy })) return true;
    }
    return false;
  }
}
