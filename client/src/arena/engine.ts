import { CARD_MAP, DEFAULT_DECK, AI_DECKS, SPEED_TILES, getCard } from './cards';
import type { CardDefinition, ProjectileKind, SpawnSpec, Team, Vec2 } from './types';

/**
 * Crownfall battle simulation (fixed 30 Hz, tile units). 18 × 32 arena, blue at the
 * bottom (y high), red at the top. Pure logic — the renderer reads `units`,
 * `projectiles`, `areas` and drains `events`.
 */

export const ARENA_W = 18;
export const ARENA_H = 32;
export const RIVER_Y = 16;
const RIVER_HALF = 1;
export const BRIDGES = [3.5, 14.5];
const BRIDGE_HALF = 1.1;
const TICK = 1 / 30;
const ELIXIR_RATE = 1 / 2.8;
const REGULATION = 180;
const OVERTIME = 120;

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const enemyOf = (t: Team): Team => (t === 'blue' ? 'red' : 'blue');

export type UnitKind = 'troop' | 'building' | 'tower';
export type TowerRole = 'king' | 'left' | 'right';

export interface Unit {
  id: number;
  card: CardDefinition;
  team: Team;
  kind: UnitKind;
  role?: TowerRole;
  x: number;
  y: number;
  /** Last movement direction (for facing). */
  dirX: number;
  dirY: number;
  moving: boolean;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  flying: boolean;
  radius: number;
  mass: number;
  damage: number;
  hitSpeed: number;
  range: number;
  speed: number;
  /** Seconds left until deployed (can't act). */
  deploy: number;
  targetId: number;
  attackCd: number;
  /** Counter bumped on every attack (the view plays the attack animation). */
  attackSeq: number;
  stun: number;
  freeze: number;
  slow: number;
  slowAmt: number;
  rage: number;
  invisible: boolean;
  visibleFor: number;
  /** Charge: distance travelled since the last hit; charging = bonus active. */
  chargeDist: number;
  charging: boolean;
  dash: { fromX: number; fromY: number; toX: number; toY: number; t: number; dur: number; targetId: number; jump: boolean } | null;
  dashCd: number;
  rampTime: number;
  spawnTimer: number;
  life: number;
  elixirTimer: number;
  /** Burrowing underground towards its deploy spot. */
  burrow: { x: number; y: number } | null;
  hidden: boolean;
  active: boolean;
  abilityCd: number;
  abilityUsed: boolean;
  abilityActive: number;
  souls: number;
  /** Goblin Hex / Hex Witch curse: dies → becomes a unit for this team. */
  cursedBy: Team | null;
  curseCard: string;
  pending: Array<{ t: number; targetId: number }>;
  hitFlash: number;
  dead: boolean;
  /** Seconds since death (the view plays the death animation). */
  deadFor: number;
  /** Battle Ram: carried barbarians spill out on death. */
  facing: number;
  age: number;
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  team: Team;
  sourceId: number;
  card: CardDefinition | null;
  x: number;
  y: number;
  z: number;
  fromX: number;
  fromY: number;
  tx: number;
  ty: number;
  targetId: number;
  speed: number;
  damage: number;
  splash: number;
  /** Arc height (lobbed). */
  arc: number;
  t: number;
  dur: number;
  homing: boolean;
  /** Straight-line piercing: direction and remaining length. */
  pierce: { dx: number; dy: number; left: number; hit: Set<number>; back: boolean } | null;
  airOnly: boolean;
  groundOnly: boolean;
  spellCard: CardDefinition | null;
  towerMul: number;
  done: boolean;
  /** Charge / ramp bonus hit (big gold damage number). */
  crit?: boolean;
}

export interface Area {
  id: number;
  card: CardDefinition;
  team: Team;
  x: number;
  y: number;
  radius: number;
  t: number;
  duration: number;
  tick: number;
  /** Rolling spells move. */
  roll: { dx: number; dy: number; left: number; hit: Set<number> } | null;
  spawned: number;
  pulses: number;
  /** Vines: only these units take the area's damage. */
  grab?: number[];
}

export type BattleEvent =
  | { type: 'deploy'; unitId: number; x: number; y: number; team: Team; card: string }
  | { type: 'play'; team: Team; card: string; x: number; y: number }
  | { type: 'attack'; unitId: number }
  | { type: 'hit'; x: number; y: number; team: Team; amount: number; unitId: number; crit?: boolean; kind?: string }
  | { type: 'splash'; x: number; y: number; radius: number; team: Team; kind: string }
  | { type: 'death'; unitId: number; x: number; y: number; team: Team; card: string; kind: UnitKind }
  | { type: 'tower'; x: number; y: number; team: Team; role: TowerRole }
  | { type: 'spell'; card: string; x: number; y: number; team: Team; radius: number }
  | { type: 'zap'; fromX: number; fromY: number; toX: number; toY: number; team: Team }
  | { type: 'heal'; x: number; y: number; team: Team }
  | { type: 'elixir'; team: Team; x: number; y: number }
  | { type: 'jump'; unitId: number }
  | { type: 'charge'; unitId: number }
  | { type: 'ability'; unitId: number; name: string }
  | { type: 'emerge'; unitId: number; x: number; y: number }
  | { type: 'dmg'; unitId: number; x: number; y: number; amount: number; crit: boolean; tower: boolean }
  | { type: 'king'; unitId: number; x: number; y: number; team: Team }
  | { type: 'emote'; team: Team; emote: number }
  | { type: 'announce'; text: string; tone?: 'gold' | 'pink' | 'cyan' };

export interface PlayerState {
  team: Team;
  name: string;
  elixir: number;
  deck: string[];
  hand: string[];
  queue: string[];
  next: string;
  crowns: number;
  lastPlayed: string | null;
  elixirSpent: number;
}

export interface Command {
  team: Team;
  cardId: string;
  x: number;
  y: number;
}

let NEXT_ID = 1;

const TOWER_CARDS = new Map<boolean, CardDefinition>();
/** The (shared) card definition of a crown tower. */
export function towerCard(king: boolean): CardDefinition {
  let c = TOWER_CARDS.get(king);
  if (!c) {
    c = {
      id: king ? 'king-tower' : 'princess-tower', name: king ? 'King Tower' : 'Princess Tower', rarity: 'Common', type: 'building', cost: 0, blurb: '',
      hp: king ? 4824 : 3052, damage: 109, hitSpeed: king ? 1 : 0.8, firstHit: 0.4, speed: 'none', range: king ? 7 : 7.5, sight: king ? 7 : 7.5,
      count: 1, targets: 'all', flying: false, radius: king ? 1.9 : 1.45, mass: 1000, projectile: king ? 'cannonball' : 'arrow', deployTime: 0, abilities: {},
      visual: { model: 'tower', height: 3 },
    };
    TOWER_CARDS.set(king, c);
  }
  return c;
}

export class BattleEngine {
  time = 0;
  phase: 'countdown' | 'battle' | 'overtime' | 'ended' = 'countdown';
  countdown = 3.2;
  winner: Team | 'draw' | null = null;
  units: Unit[] = [];
  projectiles: Projectile[] = [];
  areas: Area[] = [];
  events: BattleEvent[] = [];
  blue: PlayerState;
  red: PlayerState;
  debug = { infiniteElixir: false, speed: 1 };
  private accumulator = 0;
  private rngState: number;
  private lastMultiplier = 1;
  private bigText = new Set<string>();

  constructor(blueDeck = BattleEngine.loadDeck(), redDeck?: string[], seed = (Math.random() * 2 ** 31) | 0) {
    this.rngState = seed || 1;
    const red = redDeck ?? AI_DECKS[Math.floor(this.rand() * AI_DECKS.length)]!;
    this.blue = this.makePlayer('blue', 'YOU', blueDeck);
    this.red = this.makePlayer('red', 'RIVAL', red);
    this.spawnTowers();
  }

  static loadDeck(): string[] {
    try {
      const d = JSON.parse(localStorage.getItem('crownfall-deck-v2') || '[]') as unknown;
      if (Array.isArray(d) && d.length === 8 && d.every((id) => typeof id === 'string' && CARD_MAP.has(id))) return d as string[];
    } catch {
      /* ignore */
    }
    return [...DEFAULT_DECK];
  }

  rand(): number {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  player(team: Team): PlayerState {
    return team === 'blue' ? this.blue : this.red;
  }

  private makePlayer(team: Team, name: string, deck: string[]): PlayerState {
    const clean = deck.filter((id) => CARD_MAP.has(id)).slice(0, 8);
    for (const id of DEFAULT_DECK) if (clean.length < 8 && !clean.includes(id)) clean.push(id);
    const shuffled = [...clean].sort(() => this.rand() - 0.5);
    return { team, name, elixir: 5, deck: clean, hand: shuffled.slice(0, 4), next: shuffled[4]!, queue: shuffled.slice(5), crowns: 0, lastPlayed: null, elixirSpent: 0 };
  }

  // ------------------------------------------------------------------ setup

  private spawnTowers(): void {
    for (const team of ['blue', 'red'] as Team[]) {
      const kingY = team === 'blue' ? 29.5 : 2.5;
      const sideY = team === 'blue' ? 25.5 : 6.5;
      this.addTower(team, 'king', 9, kingY);
      this.addTower(team, 'left', 3.5, sideY);
      this.addTower(team, 'right', 14.5, sideY);
    }
  }

  private addTower(team: Team, role: TowerRole, x: number, y: number): void {
    const king = role === 'king';
    const u = this.makeUnit(towerCard(king), team, x, y, 'tower');
    u.role = role;
    u.active = !king;
    u.deploy = 0;
    this.units.push(u);
  }

  /** A blank unit for mirroring a server snapshot (online clients never step the sim). */
  shell(card: CardDefinition, team: Team, kind: UnitKind): Unit {
    return this.makeUnit(card, team, 0, 0, kind);
  }

  private makeUnit(card: CardDefinition, team: Team, x: number, y: number, kind: UnitKind): Unit {
    const shield = card.abilities.shield ?? 0;
    return {
      id: NEXT_ID++, card, team, kind, x, y, dirX: 0, dirY: team === 'blue' ? -1 : 1, moving: false,
      hp: card.hp, maxHp: card.hp, shield, maxShield: shield, flying: card.flying, radius: card.radius, mass: card.mass,
      damage: card.damage, hitSpeed: card.hitSpeed, range: card.range, speed: SPEED_TILES[card.speed],
      deploy: card.deployTime, targetId: -1, attackCd: card.firstHit, attackSeq: 0, stun: 0, freeze: 0, slow: 0, slowAmt: 0, rage: 0,
      invisible: Boolean(card.abilities.invisible), visibleFor: 0, chargeDist: 0, charging: false, dash: null, dashCd: 0, rampTime: 0,
      spawnTimer: card.abilities.spawn?.first ?? card.abilities.spawn?.every ?? 0, life: card.lifetime ?? Infinity,
      elixirTimer: card.abilities.elixir ?? 0, burrow: null, hidden: Boolean(card.abilities.hides), active: true,
      abilityCd: 4, abilityUsed: false, abilityActive: 0, souls: 0, cursedBy: null, curseCard: '', pending: [], hitFlash: 0,
      dead: false, deadFor: 0, facing: team === 'blue' ? Math.PI : 0, age: 0,
    };
  }

  // ------------------------------------------------------------------ queries

  get multiplier(): number {
    if (this.phase === 'overtime') return 3;
    return this.time >= REGULATION - 60 ? 2 : 1;
  }

  get timeLeft(): number {
    return this.phase === 'overtime' ? REGULATION + OVERTIME - this.time : REGULATION - this.time;
  }

  unit(id: number): Unit | undefined {
    return this.units.find((u) => u.id === id && !u.dead);
  }

  towers(team: Team): Unit[] {
    return this.units.filter((u) => u.kind === 'tower' && u.team === team && !u.dead);
  }

  /** Where `team` may drop troops and buildings. */
  inDeployZone(team: Team, x: number, y: number): boolean {
    if (x < 0.5 || x > ARENA_W - 0.5 || y < 0.5 || y > ARENA_H - 0.5) return false;
    const own = team === 'blue' ? y >= RIVER_Y + RIVER_HALF + 0.05 : y <= RIVER_Y - RIVER_HALF - 0.05;
    if (own) return true;
    // Pocket: past a destroyed enemy princess tower, the front of that lane opens up.
    const foe = enemyOf(team);
    const leftDown = !this.units.some((u) => u.kind === 'tower' && u.team === foe && u.role === 'left' && !u.dead);
    const rightDown = !this.units.some((u) => u.kind === 'tower' && u.team === foe && u.role === 'right' && !u.dead);
    // The whole lane opens up back to the fallen tower's row.
    const deep = team === 'blue' ? y >= 6.5 - 1.5 : y <= ARENA_H - 6.5 + 1.5;
    return deep && ((leftDown && x < 9) || (rightDown && x >= 9));
  }

  canPlay(team: Team, cardId: string, x: number, y: number): boolean {
    if (this.phase !== 'battle' && this.phase !== 'overtime') return false;
    const p = this.player(team);
    const c = CARD_MAP.get(cardId);
    if (!c || !p.hand.includes(cardId)) return false;
    if (!this.debug.infiniteElixir || team === 'red') if (p.elixir < this.costOf(team, c)) return false;
    if (c.spell?.mirror && !p.lastPlayed) return false;
    if (x < 0.3 || x > ARENA_W - 0.3 || y < 0.3 || y > ARENA_H - 0.3) return false;
    const anywhere = c.type === 'spell' ? c.id !== 'sky-drop' : Boolean(c.abilities.burrow);
    if (!anywhere && !this.inDeployZone(team, x, y)) return false;
    if (c.type === 'building' && this.units.some((u) => !u.dead && (u.kind === 'building' || u.kind === 'tower') && dist(u, { x, y }) < u.radius + c.radius + 0.2)) return false;
    return true;
  }

  costOf(team: Team, c: CardDefinition): number {
    if (c.spell?.mirror) {
      const last = this.player(team).lastPlayed;
      return last ? Math.min(10, getCard(last).cost + 1) : 1;
    }
    return c.cost;
  }

  // ------------------------------------------------------------------ playing cards

  play(cmd: Command): boolean {
    if (!this.canPlay(cmd.team, cmd.cardId, cmd.x, cmd.y)) return false;
    const p = this.player(cmd.team);
    let card = getCard(cmd.cardId);
    const cost = this.costOf(cmd.team, card);
    if (!(this.debug.infiniteElixir && cmd.team === 'blue')) p.elixir -= cost;
    p.elixirSpent += cost;
    if (card.spell?.mirror && p.lastPlayed) card = getCard(p.lastPlayed);
    else p.lastPlayed = card.id;
    // Cycle: played card goes to the back of the queue.
    const i = p.hand.indexOf(cmd.cardId);
    p.hand[i] = p.next;
    p.queue.push(cmd.cardId);
    p.next = p.queue.shift()!;
    this.events.push({ type: 'play', team: cmd.team, card: cmd.cardId, x: cmd.x, y: cmd.y });
    this.deployCard(card, cmd.team, cmd.x, cmd.y);
    return true;
  }

  private deployCard(card: CardDefinition, team: Team, x: number, y: number): void {
    if (card.type === 'spell') {
      this.castSpell(card, team, x, y);
      return;
    }
    if (card.abilities.burrow) {
      // Travels underground from the king tower.
      const king = this.units.find((u) => u.kind === 'tower' && u.role === 'king' && u.team === team)!;
      const u = this.spawnUnit(card, team, king.x, king.y);
      u.burrow = { x, y };
      u.deploy = 0;
      return;
    }
    this.spawnGroup(card, team, x, y, true);
    for (const s of card.squad ?? []) this.spawnGroup(getCard(s.card), team, x, y + (team === 'blue' ? 0.9 : -0.9), true, s.count);
    if (card.id === 'colossus-knight') this.blast(team, x, y, 2, 536, 'land', true);
    if (card.id === 'storm-mage') this.blast(team, x, y, 2.5, 159, 'zap', true, 0.5);
  }

  /** Deploy `count` copies in a tidy formation around (x, y). */
  private spawnGroup(card: CardDefinition, team: Team, x: number, y: number, fresh: boolean, count = card.count): Unit[] {
    const out: Unit[] = [];
    const spread = count <= 1 ? 0 : count <= 3 ? 0.6 : count <= 6 ? 0.85 : 1.15;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (team === 'blue' ? Math.PI / 2 : -Math.PI / 2);
      const ring = count > 8 && i % 2 ? 0.55 : 1;
      const u = this.spawnUnit(card, team, clamp(x + Math.cos(a) * spread * ring, 0.5, ARENA_W - 0.5), clamp(y + Math.sin(a) * spread * ring, 0.5, ARENA_H - 0.5));
      if (!fresh) u.deploy = 0.4;
      out.push(u);
    }
    return out;
  }

  private spawnUnit(card: CardDefinition, team: Team, x: number, y: number): Unit {
    const u = this.makeUnit(card, team, x, y, card.type === 'building' ? 'building' : 'troop');
    this.units.push(u);
    this.events.push({ type: 'deploy', unitId: u.id, x, y, team, card: card.id });
    return u;
  }

  private spawnFrom(spec: SpawnSpec, team: Team, x: number, y: number, count = spec.count): void {
    const card = getCard(spec.card);
    for (let i = 0; i < count; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = count > 1 ? 0.4 + this.rand() * 0.5 : 0;
      this.spawnUnit(card, team, clamp(x + Math.cos(a) * r, 0.5, ARENA_W - 0.5), clamp(y + Math.sin(a) * r, 0.5, ARENA_H - 0.5)).deploy = 0.35;
    }
  }

  // ------------------------------------------------------------------ spells

  private castSpell(card: CardDefinition, team: Team, x: number, y: number): void {
    const s = card.spell!;
    this.events.push({ type: 'spell', card: card.id, x, y, team, radius: s.radius });
    if (s.travel === 'fromKing') {
      const king = this.units.find((u) => u.kind === 'tower' && u.role === 'king' && u.team === team)!;
      const d = Math.hypot(x - king.x, y - king.y);
      const speed = card.id === 'rocket' ? 9 : card.id === 'goblin-keg' ? 11 : 14;
      this.projectiles.push({
        id: NEXT_ID++, kind: card.id === 'rocket' ? 'rocket' : card.id === 'arrows' ? 'arrow' : card.id === 'goblin-keg' ? 'bomb' : card.id === 'giant-snowball' ? 'iceball' : 'fireball',
        team, sourceId: king.id, card: null, x: king.x, y: king.y, z: 2.5, fromX: king.x, fromY: king.y, tx: x, ty: y, targetId: -1,
        speed, damage: s.damage, splash: s.radius, arc: card.id === 'arrows' ? 5 : card.id === 'goblin-keg' ? 4 : 3, t: 0, dur: Math.max(0.35, d / speed),
        homing: false, pierce: null, airOnly: false, groundOnly: false, spellCard: card, towerMul: s.towerDamage ?? 1, done: false,
      });
      return;
    }
    if (s.travel === 'roll') {
      const dir = team === 'blue' ? -1 : 1;
      this.areas.push({ id: NEXT_ID++, card, team, x, y, radius: s.radius, t: 0, duration: (s.rollLength ?? 8) / 6, tick: 0, roll: { dx: 0, dy: dir, left: s.rollLength ?? 8, hit: new Set() }, spawned: 0, pulses: 0 });
      return;
    }
    if (s.travel === 'drop') {
      this.areas.push({ id: NEXT_ID++, card, team, x, y, radius: s.radius, t: 0, duration: 2.1, tick: 0, roll: null, spawned: 0, pulses: 0 });
      return;
    }
    // Instant (with optional lingering area).
    if (s.clone) {
      for (const u of this.units.filter((u) => !u.dead && u.team === team && u.kind === 'troop' && dist(u, { x, y }) <= s.radius).slice(0, 20)) {
        const c = this.makeUnit(u.card, team, clamp(u.x + 0.5, 0.5, 17.5), u.y, 'troop');
        c.hp = c.maxHp = 1;
        c.shield = 0;
        c.deploy = 0.2;
        this.units.push(c);
        this.events.push({ type: 'deploy', unitId: c.id, x: c.x, y: c.y, team, card: c.card.id });
      }
      return;
    }
    if (card.id === 'lightning') {
      const targets = this.enemiesIn(team, x, y, s.radius, 'all')
        .sort((a, b) => b.hp + b.shield - (a.hp + a.shield))
        .slice(0, s.maxTargets ?? 3);
      targets.forEach((t, i) => {
        this.areas.push({ id: NEXT_ID++, card, team, x: t.x, y: t.y, radius: 0.5, t: -i * 0.18, duration: 0.3, tick: 0, roll: null, spawned: 0, pulses: 0 });
        this.pendingStrike(t.id, i * 0.18, s.damage, s.towerDamage ?? 1, s.stun ?? 0, team);
      });
      return;
    }
    let grab: number[] | undefined;
    if (card.id === 'vines') {
      // Grabs the toughest few troops; only those take the vine damage.
      const targets = this.enemiesIn(team, x, y, s.radius, 'all').filter((u) => u.kind === 'troop').sort((a, b) => b.hp - a.hp).slice(0, s.maxTargets ?? 3);
      for (const t of targets) {
        t.stun = Math.max(t.stun, s.stun ?? 2);
        t.flying = false;
        setTimeoutSim(this, s.duration ?? 2.3, () => (t.flying = t.card.flying));
      }
      grab = targets.map((t) => t.id);
    }
    if (!s.duration) this.applySpellHit(card, team, x, y, s.damage);
    if (s.duration) this.areas.push({ id: NEXT_ID++, card, team, x, y, radius: s.radius, t: 0, duration: s.duration, tick: 0, roll: null, spawned: 0, pulses: 0, grab });
  }

  private strikes: Array<{ t: number; id: number; dmg: number; towerMul: number; stun: number; team: Team }> = [];
  private pendingStrike(id: number, t: number, dmg: number, towerMul: number, stun: number, team: Team): void {
    this.strikes.push({ t, id, dmg, towerMul, stun, team });
  }
  timers: Array<{ t: number; fn: () => void }> = [];

  /** One-shot spell impact at (x, y). */
  private applySpellHit(card: CardDefinition, team: Team, x: number, y: number, damage: number): void {
    const s = card.spell!;
    const hits = this.enemiesIn(team, x, y, s.radius, card.id === 'rolling-log' ? 'ground' : 'all');
    for (const u of hits) {
      let dmg = damage;
      if (u.kind === 'tower') dmg *= s.towerDamage ?? 1;
      else if (u.kind === 'building' && s.buildingBonus) dmg *= s.buildingBonus;
      this.damageUnit(u, dmg, team, null);
      if (s.freeze) u.freeze = Math.max(u.freeze, s.freeze);
      if (s.stun) this.stunUnit(u, s.stun);
      if (s.slow) this.slowUnit(u, s.slow, 3);
      if (s.knockback && u.kind === 'troop' && u.mass < 14) this.knock(u, x, y, s.knockback);
    }
    if (s.rage) for (const u of this.units) if (!u.dead && u.team === team && dist(u, { x, y }) <= s.radius) u.rage = Math.max(u.rage, s.rage);
    if (s.spawn) this.spawnFrom(s.spawn, team, x, y);
    this.events.push({ type: 'splash', x, y, radius: s.radius, team, kind: s.fx });
  }

  // ------------------------------------------------------------------ main loop

  update(dt: number): void {
    this.accumulator += Math.min(dt, 0.1) * this.debug.speed;
    while (this.accumulator >= TICK) {
      this.step(TICK);
      this.accumulator -= TICK;
    }
  }

  step(dt = TICK): void {
    if (this.phase === 'ended') {
      for (const u of this.units) if (u.dead) u.deadFor += dt;
      return;
    }
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'battle';
        this.events.push({ type: 'announce', text: 'FIGHT!', tone: 'gold' });
      }
      return;
    }
    this.time += dt;
    this.updateClock();
    if ((this.phase as string) === 'ended') return;
    const regen = dt * ELIXIR_RATE * this.multiplier;
    this.blue.elixir = this.debug.infiniteElixir ? 10 : Math.min(10, this.blue.elixir + regen);
    this.red.elixir = Math.min(10, this.red.elixir + regen);

    for (const tm of [...this.timers]) {
      tm.t -= dt;
      if (tm.t <= 0) {
        tm.fn();
        this.timers.splice(this.timers.indexOf(tm), 1);
      }
    }
    for (const s of [...this.strikes]) {
      s.t -= dt;
      if (s.t > 0) continue;
      this.strikes.splice(this.strikes.indexOf(s), 1);
      const u = this.unit(s.id);
      if (!u) continue;
      this.damageUnit(u, u.kind === 'tower' ? s.dmg * s.towerMul : s.dmg, s.team, null);
      if (s.stun) this.stunUnit(u, s.stun);
      this.events.push({ type: 'splash', x: u.x, y: u.y, radius: 1, team: s.team, kind: 'lightning' });
    }
    for (const u of this.units) if (!u.dead) this.updateUnit(u, dt);
    for (const p of this.projectiles) this.updateProjectile(p, dt);
    this.projectiles = this.projectiles.filter((p) => !p.done);
    for (const a of this.areas) this.updateArea(a, dt);
    this.areas = this.areas.filter((a) => a.t < a.duration);
    this.separate(dt);
    this.reap(dt);
  }

  private updateClock(): void {
    const m = this.multiplier;
    if (m !== this.lastMultiplier) {
      this.lastMultiplier = m;
      if (m === 2) this.events.push({ type: 'announce', text: '2× ELIXIR', tone: 'pink' });
    }
    if (this.timeLeft <= 10 && this.timeLeft > 9.95 && !this.bigText.has(`ten-${this.phase}`)) {
      this.bigText.add(`ten-${this.phase}`);
      this.events.push({ type: 'announce', text: '10 SECONDS', tone: 'pink' });
    }
    if (this.phase === 'battle' && this.time >= REGULATION) {
      if (this.blue.crowns !== this.red.crowns) return this.finish(this.blue.crowns > this.red.crowns ? 'blue' : 'red');
      this.phase = 'overtime';
      this.events.push({ type: 'announce', text: 'OVERTIME · 3× ELIXIR', tone: 'cyan' });
    } else if (this.phase === 'overtime' && this.time >= REGULATION + OVERTIME) {
      this.finishByHealth();
    }
  }

  // ------------------------------------------------------------------ units

  private updateUnit(u: Unit, dt: number): void {
    u.age += dt;
    u.hitFlash = Math.max(0, u.hitFlash - dt);
    u.dashCd = Math.max(0, u.dashCd - dt);
    u.abilityCd = Math.max(0, u.abilityCd - dt);
    u.abilityActive = Math.max(0, u.abilityActive - dt);
    if (u.slow > 0) u.slow = Math.max(0, u.slow - dt);
    if (u.rage > 0) u.rage = Math.max(0, u.rage - dt);
    if (u.visibleFor > 0) u.visibleFor -= dt;

    if (u.burrow) {
      const d = Math.hypot(u.burrow.x - u.x, u.burrow.y - u.y);
      const step = 3.2 * dt;
      if (d <= step) {
        u.x = u.burrow.x;
        u.y = u.burrow.y;
        u.burrow = null;
        u.deploy = 0.7;
        this.events.push({ type: 'emerge', unitId: u.id, x: u.x, y: u.y });
      } else {
        u.dirX = (u.burrow.x - u.x) / d;
        u.dirY = (u.burrow.y - u.y) / d;
        u.x += u.dirX * step;
        u.y += u.dirY * step;
      }
      return;
    }
    if (u.deploy > 0) {
      u.deploy -= dt;
      return;
    }
    if (u.kind === 'building') {
      u.life -= dt;
      // Buildings decay over their lifetime.
      u.hp -= (u.maxHp / (u.card.lifetime ?? 30)) * dt;
      if (u.hp <= 0 || u.life <= 0) {
        u.hp = 0;
        return;
      }
    }
    if (u.card.lifetime && u.kind === 'troop') {
      u.life -= dt;
      if (u.life <= 0) {
        // Phoenix egg hatches.
        if (u.card.abilities.transform) {
          const c = getCard(u.card.abilities.transform);
          this.spawnUnit(c, u.team, u.x, u.y).deploy = 0.3;
        }
        u.hp = 0; // reap() emits the death + death spawns
        return;
      }
    }
    this.runPassives(u, dt);
    if (u.freeze > 0) {
      u.freeze -= dt;
      u.moving = false;
      return;
    }
    if (u.stun > 0) {
      u.stun -= dt;
      u.moving = false;
      return;
    }
    // Pending melee hits / projectile releases.
    for (const p of [...u.pending]) {
      p.t -= dt;
      if (p.t > 0) continue;
      u.pending.splice(u.pending.indexOf(p), 1);
      const t = this.unit(p.targetId);
      if (t) this.deliverAttack(u, t);
    }
    if (u.dash) {
      this.updateDash(u, dt);
      return;
    }
    if (u.card.damage <= 0 && u.kind === 'building') return;
    if (u.kind === 'tower' && !u.active) return;
    if (u.hidden) {
      // Tesla: pops up when something is in range.
      if (this.findTarget(u, u.range + 0.5)) {
        u.hidden = false;
        u.attackCd = 0.5;
      } else return;
    }
    this.think(u, dt);
  }

  private runPassives(u: Unit, dt: number): void {
    const a = u.card.abilities;
    if (a.spawn?.every) {
      u.spawnTimer -= dt;
      if (u.spawnTimer <= 0) {
        u.spawnTimer = a.spawn.every;
        const fwd = u.team === 'blue' ? -1 : 1;
        this.spawnFrom(a.spawn, u.team, u.x, u.y + fwd * (u.radius + 0.5));
      }
    }
    if (a.elixir) {
      u.elixirTimer -= dt;
      if (u.elixirTimer <= 0) {
        u.elixirTimer = a.elixir;
        const p = this.player(u.team);
        p.elixir = Math.min(10, p.elixir + 1);
        this.events.push({ type: 'elixir', team: u.team, x: u.x, y: u.y });
      }
    }
    if (a.healAura && !a.kamikaze) {
      u.spawnTimer -= dt;
      if (u.spawnTimer <= -1) {
        u.spawnTimer = 0;
        for (const f of this.units) {
          if (f.dead || f.team !== u.team || f.kind !== 'troop' || dist(f, u) > 2.5 || f.hp >= f.maxHp) continue;
          f.hp = Math.min(f.maxHp, f.hp + a.healAura);
          this.events.push({ type: 'heal', x: f.x, y: f.y, team: u.team });
        }
      }
    }
    if (u.invisible && u.visibleFor <= 0 && u.card.abilities.invisible) u.invisible = true;
    this.champion(u);
  }

  /** Champion abilities, auto-cast when it makes sense. */
  private champion(u: Unit): void {
    const ab = u.card.abilities.ability;
    if (!ab || u.abilityCd > 0) return;
    const near = (r: number) => this.units.filter((e) => !e.dead && e.team !== u.team && e.kind !== 'tower' && !e.burrow && dist(e, u) <= r);
    const fire = (cd: number) => {
      u.abilityCd = cd;
      this.events.push({ type: 'ability', unitId: u.id, name: ab });
    };
    switch (ab) {
      case 'dashChain': {
        const foes = near(5.5).filter((e) => !e.flying);
        if (foes.length >= 2 || (foes[0] && foes[0].hp > 600)) {
          fire(13);
          let prev: Vec2 = u;
          let delay = 0;
          for (const f of foes.sort((a, b) => dist(a, u) - dist(b, u)).slice(0, 8)) {
            const from = prev;
            setTimeoutSim(this, delay, () => {
              if (f.dead || u.dead) return;
              u.x = f.x + 0.4;
              u.y = f.y;
              this.damageUnit(f, u.damage * 2.2, u.team, u);
              this.events.push({ type: 'zap', fromX: from.x, fromY: from.y, toX: f.x, toY: f.y, team: u.team });
            });
            prev = f;
            delay += 0.18;
          }
        }
        break;
      }
      case 'cloak':
        if (u.targetId >= 0 && this.unit(u.targetId)) {
          fire(17);
          u.abilityActive = 3.5;
          u.invisible = true;
          u.visibleFor = 0;
        }
        break;
      case 'soulSummon':
        if (u.souls >= 3) {
          fire(20);
          this.spawnFrom({ card: 'skeletons', count: Math.min(14, u.souls) }, u.team, u.x, u.y + (u.team === 'blue' ? -1 : 1));
          u.souls = 0;
        }
        break;
      case 'explosiveEscape':
        if (u.hp < u.maxHp * 0.5 && !u.abilityUsed) {
          u.abilityUsed = true;
          fire(99);
          this.blast(u.team, u.x, u.y, 2, 400, 'bomb', true);
          u.y += u.team === 'blue' ? 3 : -3;
        }
        break;
      case 'reflect':
        if (u.card.id === 'monk' && near(5).length) {
          fire(17);
          u.abilityActive = 4;
        }
        break;
      case 'royalRescue':
        if (u.hp < u.maxHp * 0.6 && !u.abilityUsed) {
          u.abilityUsed = true;
          fire(99);
          const g = this.spawnUnit(getCard('guardian'), u.team, u.x, u.y + (u.team === 'blue' ? 2 : -2));
          g.deploy = 0.3;
          this.blast(u.team, u.x, u.y, 2.5, 120, 'land', true);
        }
        break;
      case 'zapBurst':
        if (near(3).length) {
          fire(8);
          this.blast(u.team, u.x, u.y, 3, 150, 'zap', true, 0.5);
        }
        break;
      case 'getaway':
        if (u.card.id === 'fisherman') {
          // Hook: drag the nearest ground troop in range 7 to him.
          const t = near(7).filter((e) => e.kind === 'troop' && !e.flying && dist(e, u) > 2.2).sort((a, b) => dist(a, u) - dist(b, u))[0];
          if (t) {
            fire(4);
            this.events.push({ type: 'zap', fromX: u.x, fromY: u.y, toX: t.x, toY: t.y, team: u.team });
            const d = dist(t, u);
            t.x += ((u.x - t.x) / d) * (d - 1.2);
            t.y += ((u.y - t.y) / d) * (d - 1.2);
            this.stunUnit(t, 0.5);
          }
        } else if (u.hp < u.maxHp * 0.5) {
          fire(15);
          u.invisible = true;
          u.visibleFor = 0;
          u.abilityActive = 2;
          u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.1);
        }
        break;
    }
  }

  /** Target selection, movement and attack timing. */
  private think(u: Unit, dt: number): void {
    let target = u.targetId >= 0 ? this.unit(u.targetId) : undefined;
    if (target && !this.validTarget(u, target)) target = undefined;
    const minRange = u.card.minRange ?? 0;
    // Mortar: targets inside its dead zone are dropped so it can pick another.
    if (target && minRange && this.gap(u, target) < minRange) target = undefined;
    const inRange = target ? this.gap(u, target) <= u.range : false;
    // Re-evaluate targets regularly while walking (not mid-fight).
    if (!target || (!inRange && (u.age * 30) % 6 < 1)) {
      const better = this.findTarget(u, u.kind === 'troop' ? u.card.sight : u.range + 0.5);
      if (better && better !== target) {
        target = better;
        u.targetId = better.id;
        u.attackCd = Math.max(u.attackCd, u.card.firstHit);
        u.rampTime = 0;
      }
    }
    if (!target && u.kind === 'troop') {
      target = this.laneTower(u);
      if (target) u.targetId = target.id;
    }
    if (!target) {
      u.targetId = -1;
      u.moving = false;
      u.rampTime = 0;
      u.attackCd = Math.max(u.attackCd - dt, u.card.firstHit * 0.5);
      return;
    }
    const gap = this.gap(u, target);
    // Dash (Bandit, Colossus, Ronin): leap onto targets at the right distance.
    const dash = u.card.abilities.dash;
    if (dash && u.dashCd <= 0 && !target.flying && gap >= dash[0] && gap <= dash[1] && u.kind === 'troop') {
      u.dash = { fromX: u.x, fromY: u.y, toX: target.x, toY: target.y, t: 0, dur: u.card.id === 'colossus-knight' ? 0.7 : 0.35, targetId: target.id, jump: u.card.id === 'colossus-knight' };
      this.events.push({ type: 'jump', unitId: u.id });
      return;
    }
    if (gap <= u.range && gap >= minRange) {
      u.moving = false;
      this.face(u, target.x - u.x, target.y - u.y);
      u.attackCd -= dt * (u.rage > 0 ? 1.35 : 1) * (u.abilityActive > 0 && u.card.abilities.ability === 'cloak' ? 2 : 1) * (u.slow > 0 ? 1 - u.slowAmt * 0.5 : 1);
      if (u.card.abilities.ramp) u.rampTime += dt;
      if (u.attackCd <= 0) {
        u.attackCd += u.hitSpeed;
        u.attackSeq++;
        this.events.push({ type: 'attack', unitId: u.id });
        if (u.invisible && u.card.abilities.invisible) {
          u.invisible = false;
          u.visibleFor = 1.8;
        }
        const lead = u.card.projectile || u.kind !== 'troop' ? 0.12 : 0.22;
        u.pending.push({ t: lead, targetId: target.id });
      }
      return;
    }
    u.rampTime = 0;
    u.attackCd = Math.max(u.attackCd - dt, u.card.firstHit * 0.6);
    if (u.kind !== 'troop' || u.speed <= 0) return;
    this.moveToward(u, target, dt);
  }

  private face(u: Unit, dx: number, dy: number): void {
    const l = Math.hypot(dx, dy);
    if (l > 1e-4) {
      u.dirX = dx / l;
      u.dirY = dy / l;
    }
  }

  private moveToward(u: Unit, target: Unit, dt: number): void {
    const goal = this.waypoint(u, target);
    let speed = u.speed * (u.rage > 0 ? 1.35 : 1) * (u.slow > 0 ? 1 - u.slowAmt : 1);
    if (u.charging) speed *= 2;
    let dx = goal.x - u.x;
    let dy = goal.y - u.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    if (!u.flying) [dx, dy] = this.steer(u, target, dx, dy, l);
    const step = Math.min(l, speed * dt);
    u.x += dx * step;
    u.y += dy * step;
    this.face(u, dx, dy);
    u.moving = true;
    const ch = u.card.abilities.charge;
    if (ch) {
      u.chargeDist += step;
      if (!u.charging && u.chargeDist >= ch) {
        u.charging = true;
        this.events.push({ type: 'charge', unitId: u.id });
      }
    }
  }

  /**
   * Slide around fixed units (towers, buildings — both teams) sitting on the straight
   * path: aim at the tangent of the obstacle's clearance circle instead of its centre,
   * so troops dropped behind their own tower walk around it rather than wedging.
   */
  private steer(u: Unit, target: Unit, dx: number, dy: number, l: number): [number, number] {
    let block: Unit | null = null;
    let blockD = Infinity;
    for (const o of this.units) {
      if (o === u || o === target || o.dead || o.kind === 'troop' || o.burrow || o.flying) continue;
      const ox = o.x - u.x;
      const oy = o.y - u.y;
      const along = ox * dx + oy * dy;
      if (along <= 0 || along > Math.min(l, o.radius + u.radius + 3)) continue;
      const side = ox * dy - oy * dx;
      if (Math.abs(side) >= o.radius + u.radius + 0.2) continue;
      if (along < blockD) {
        blockD = along;
        block = o;
      }
    }
    if (!block) return [dx, dy];
    const ox = block.x - u.x;
    const oy = block.y - u.y;
    const d = Math.hypot(ox, oy) || 1;
    const clear = block.radius + u.radius + 0.2;
    const theta = Math.atan2(oy, ox);
    const off = Math.asin(Math.min(1, clear / d)) * (d < clear ? 1.6 : 1);
    // Which way round: the side we're already on (obstacle left of our heading → pass on its right);
    // dead centre → the side nearer the arena's middle.
    const cross = dx * oy - dy * ox;
    let a = theta - Math.sign(cross) * off;
    if (Math.abs(cross) < 0.05) a = Math.sign(Math.cos(theta - off)) === Math.sign(9 - block.x) ? theta - off : theta + off;
    return [Math.cos(a), Math.sin(a)];
  }

  /** Ground troops use the bridges; flyers, jumpers and burrowers go straight. */
  private waypoint(u: Unit, target: Unit): Vec2 {
    if (u.flying || u.card.abilities.riverJump) return target;
    const top = RIVER_Y - RIVER_HALF;
    const bottom = RIVER_Y + RIVER_HALF;
    const mySide = u.y < RIVER_Y ? -1 : 1;
    const theirSide = target.y < RIVER_Y ? -1 : 1;
    const onBridge = u.y > top - 0.15 && u.y < bottom + 0.15;
    if (mySide === theirSide && !onBridge) return target;
    const bridge = BRIDGES.reduce((a, b) => (Math.abs(u.x - b) + Math.abs(target.x - b) * 0.3 < Math.abs(u.x - a) + Math.abs(target.x - a) * 0.3 ? b : a));
    if (onBridge) {
      // Walk across, staying on the planks.
      const exitY = theirSide < 0 ? top - 0.6 : bottom + 0.6;
      return { x: clamp(u.x, bridge - BRIDGE_HALF + 0.35, bridge + BRIDGE_HALF - 0.35), y: exitY };
    }
    const entryY = mySide < 0 ? top - 0.1 : bottom + 0.1;
    return { x: bridge + clamp(u.x - bridge, -0.5, 0.5), y: entryY };
  }

  private updateDash(u: Unit, dt: number): void {
    const d = u.dash!;
    const t = this.unit(d.targetId);
    if (t) {
      d.toX = t.x;
      d.toY = t.y;
    }
    d.t += dt;
    const k = Math.min(1, d.t / d.dur);
    u.x = d.fromX + (d.toX - d.fromX) * k;
    u.y = d.fromY + (d.toY - d.fromY) * k;
    this.face(u, d.toX - d.fromX, d.toY - d.fromY);
    u.moving = true;
    if (k >= 1) {
      u.dash = null;
      u.dashCd = u.card.id === 'colossus-knight' ? 2.5 : 0.8;
      if (d.jump) this.blast(u.team, u.x, u.y, 2, u.damage * 2, 'land', true);
      else if (t) this.damageUnit(t, u.damage * (u.card.id === 'bandit' ? 2 : 1.5), u.team, u);
      u.attackCd = u.hitSpeed * 0.5;
      // Step back out of the target.
      if (t) {
        const l = dist(u, t) || 1;
        const want = u.radius + t.radius + 0.1;
        u.x = t.x + ((u.x - t.x) / l) * want;
        u.y = t.y + ((u.y - t.y) / l) * want;
      }
    }
  }

  /** Distance between edges. */
  private gap(a: Unit, b: Unit): number {
    return dist(a, b) - a.radius - b.radius;
  }

  private validTarget(u: Unit, t: Unit): boolean {
    if (t.dead || t.team === u.team || t.burrow) return false;
    if (t.hidden) return false;
    if (t.invisible && t.kind === 'troop' && dist(u, t) > u.radius + t.radius + 0.6) return false;
    if (t.dash && t.card.id === 'bandit') return false;
    // Towers shoot anything in range; buildings follow their rule (buildings count as ground).
    const tg = u.kind === 'tower' ? 'all' : u.card.targets;
    if (tg === 'buildings') return t.kind !== 'troop';
    if (tg === 'ground' && t.flying) return false;
    if (tg === 'air' && !t.flying) return false;
    return true;
  }

  private findTarget(u: Unit, sight: number): Unit | undefined {
    let best: Unit | undefined;
    let bestD = Infinity;
    for (const t of this.units) {
      if (!this.validTarget(u, t)) continue;
      const d = this.gap(u, t);
      if (d > sight || d < (u.card.minRange ?? 0)) continue;
      // Troops prefer troops over the tower they happen to see (unless building-only).
      const score = d + (t.kind === 'tower' && u.card.targets !== 'buildings' ? 0.01 : 0);
      if (score < bestD) {
        bestD = score;
        best = t;
      }
    }
    return best;
  }

  /** The tower (or building) a troop walks to when nothing is in sight. */
  private laneTower(u: Unit): Unit | undefined {
    const foe = enemyOf(u.team);
    const left = u.x < 9;
    const towers = this.units.filter((t) => !t.dead && t.team === foe && t.kind === 'tower');
    const lane = towers.find((t) => t.role === (left ? 'left' : 'right'));
    if (lane) return lane;
    const all = this.units.filter((t) => !t.dead && t.team === foe && t.kind !== 'troop');
    all.sort((a, b) => dist(u, a) - dist(u, b));
    return all[0];
  }

  // ------------------------------------------------------------------ attacks

  private deliverAttack(u: Unit, t: Unit): void {
    if (u.dead) return;
    const a = u.card.abilities;
    let dmg = u.damage;
    let crit = false;
    if (u.charging) {
      dmg *= 2;
      crit = true;
      u.charging = false;
      u.chargeDist = 0;
    } else if (a.charge) u.chargeDist = 0;
    if (a.ramp && u.rampTime >= 2) {
      dmg *= u.rampTime < 4 ? 3.5 : 11;
      crit = true;
    }
    if (a.buildingBonus && t.kind === 'tower') dmg *= a.buildingBonus;
    const kind = u.card.projectile ?? (u.kind === 'tower' ? (u.role === 'king' ? 'cannonball' : 'arrow') : undefined);
    if (kind === 'flame' || (kind === 'zap' && !a.kamikaze && u.card.id !== 'volt-cannon')) {
      // Beams and zaps land instantly.
      this.events.push({ type: 'zap', fromX: u.x, fromY: u.y, toX: t.x, toY: t.y, team: u.team });
      this.hitTarget(u, t, dmg, kind, crit);
      return;
    }
    if (kind && (u.range > 1.6 || a.kamikaze)) {
      this.launch(u, t, kind, dmg, crit);
      if (a.kamikaze) u.hp = 0;
      return;
    }
    this.hitTarget(u, t, dmg, 'melee', crit);
    if (a.kamikaze) u.hp = 0; // Battle Ram's barbarians spill out in reap()
  }

  private launch(u: Unit, t: Unit, kind: ProjectileKind, dmg: number, crit = false): void {
    const a = u.card.abilities;
    const speed = { arrow: 18, bolt: 20, spear: 15, dart: 22, cannonball: 14, bomb: 9, boulder: 6, fireball: 11, iceball: 12, magic: 14, zap: 30, axe: 9, rocket: 9, flame: 30, shot: 24, firework: 10, hook: 15, heal: 10 }[kind];
    const lob = kind === 'bomb' || kind === 'firework' || (a.kamikaze && u.card.id.endsWith('spirit'));
    const d = dist(u, t);
    const p: Projectile = {
      id: NEXT_ID++, kind, team: u.team, sourceId: u.id, card: u.card, x: u.x, y: u.y, z: u.flying ? 2 : u.kind === 'tower' ? 2.6 : 0.8,
      fromX: u.x, fromY: u.y, tx: t.x, ty: t.y, targetId: t.id, speed, damage: dmg, splash: a.splash ?? 0,
      arc: lob ? 2.2 + d * 0.15 : kind === 'cannonball' ? 0.4 : 0, t: 0, dur: Math.max(0.12, d / speed), homing: !lob && !a.pierce,
      pierce: a.pierce ? { dx: (t.x - u.x) / (d || 1), dy: (t.y - u.y) / (d || 1), left: a.pierce, hit: new Set(), back: kind === 'axe' } : null,
      airOnly: u.card.targets === 'air', groundOnly: u.card.targets === 'ground' || kind === 'boulder', spellCard: null, towerMul: 1, done: false, crit,
    };
    this.projectiles.push(p);
  }

  private updateProjectile(p: Projectile, dt: number): void {
    if (p.done) return;
    if (p.pierce) {
      const pc = p.pierce;
      const step = p.speed * dt;
      p.x += pc.dx * step;
      p.y += pc.dy * step;
      pc.left -= step;
      p.t += dt;
      for (const u of this.units) {
        if (u.dead || u.team === p.team || pc.hit.has(u.id) || u.burrow || u.hidden) continue;
        if (p.groundOnly && u.flying) continue;
        if (Math.hypot(u.x - p.x, u.y - p.y) > u.radius + 0.55) continue;
        pc.hit.add(u.id);
        const src = this.unit(p.sourceId);
        this.damageUnit(u, p.damage, p.team, src ?? null);
        if (p.card?.abilities.knockback && u.kind === 'troop' && u.mass < 14) this.knock(u, p.x - pc.dx, p.y - pc.dy, p.card.abilities.knockback);
        this.events.push({ type: 'hit', x: u.x, y: u.y, team: p.team, amount: p.damage, unitId: u.id, kind: p.kind });
      }
      if (pc.left <= 0 || p.x < 0 || p.x > ARENA_W || p.y < 0 || p.y > ARENA_H) {
        if (pc.back) {
          // Executioner's axe flies back.
          const src = this.unit(p.sourceId);
          pc.back = false;
          pc.dx = -pc.dx;
          pc.dy = -pc.dy;
          pc.left = src ? dist(src, p) : 4;
          pc.hit.clear();
        } else p.done = true;
      }
      return;
    }
    p.t += dt;
    const target = p.targetId >= 0 ? this.unit(p.targetId) : undefined;
    if (p.homing && target) {
      p.tx = target.x;
      p.ty = target.y;
    }
    const k = Math.min(1, p.t / p.dur);
    p.x = p.fromX + (p.tx - p.fromX) * k;
    p.y = p.fromY + (p.ty - p.fromY) * k;
    p.z = (p.arc ? Math.sin(k * Math.PI) * p.arc : 0) + (1 - k) * 1 + 0.5;
    if (k < 1) return;
    p.done = true;
    if (p.spellCard) {
      const s = p.spellCard.spell!;
      if (s.waves && s.waves > 1) {
        for (let w = 0; w < s.waves; w++) setTimeoutSim(this, w * 0.22, () => this.applySpellHit(p.spellCard!, p.team, p.tx, p.ty, s.damage / s.waves!));
      } else this.applySpellHit(p.spellCard, p.team, p.tx, p.ty, s.damage);
      return;
    }
    const src = this.unit(p.sourceId) ?? null;
    if (p.kind === 'heal') {
      for (const f of this.units) if (!f.dead && f.team === p.team && f.kind === 'troop' && dist(f, p) <= p.splash) f.hp = Math.min(f.maxHp, f.hp + (p.card?.abilities.healAura ?? 300));
      this.events.push({ type: 'heal', x: p.x, y: p.y, team: p.team });
      this.blast(p.team, p.x, p.y, p.splash, p.damage, 'heal', true);
      return;
    }
    if (p.splash > 0) {
      this.splashAt(p, src);
      return;
    }
    if (target && dist(target, p) < target.radius + 1.2) {
      if (src) this.hitTarget(src, target, p.damage, p.kind, p.crit);
      else this.damageUnit(target, p.damage, p.team, null);
    }
  }

  private splashAt(p: Projectile, src: Unit | null): void {
    const a = p.card?.abilities ?? {};
    for (const u of this.units) {
      if (u.dead || u.team === p.team || u.burrow || u.hidden) continue;
      if (p.groundOnly && u.flying) continue;
      if (p.airOnly && !u.flying) continue;
      if (Math.hypot(u.x - p.x, u.y - p.y) > p.splash + u.radius * 0.5) continue;
      this.damageUnit(u, p.damage, p.team, src);
      if (a.stun) this.stunUnit(u, a.stun);
      if (a.slow) this.slowUnit(u, a.slow, 2.5);
      if (a.chain) this.chainFrom(u, p.team, p.damage, a.chain, a.stun ?? 0, src);
    }
    this.events.push({ type: 'splash', x: p.x, y: p.y, radius: p.splash, team: p.team, kind: p.kind });
  }

  /** Single-target hit with on-hit effects (stun, slow, chain, splash around the target). */
  private hitTarget(src: Unit, t: Unit, dmg: number, kind: string, crit = false): void {
    const a = src.card.abilities;
    if (a.splash) {
      const spin = src.card.id === 'valkyrie' || src.card.id === 'bone-king';
      const cx = spin ? src.x : t.x;
      const cy = spin ? src.y : t.y;
      for (const u of this.units) {
        if (u.dead || u.team === src.team || u.burrow || u.hidden || !this.canHit(src, u)) continue;
        if (Math.hypot(u.x - cx, u.y - cy) > a.splash + u.radius * 0.5) continue;
        this.damageUnit(u, dmg, src.team, src, crit);
        if (a.stun) this.stunUnit(u, a.stun);
        if (a.slow) this.slowUnit(u, a.slow, 2.5);
      }
      this.events.push({ type: 'splash', x: cx, y: cy, radius: a.splash, team: src.team, kind });
    } else {
      this.damageUnit(t, dmg, src.team, src, crit);
      if (a.stun) this.stunUnit(t, a.stun);
      if (a.slow) this.slowUnit(t, a.slow, 2.5);
      if (a.knockback && t.kind === 'troop' && t.mass < 14) this.knock(t, src.x, src.y, a.knockback);
    }
    if (a.chain) this.chainFrom(t, src.team, dmg, a.chain, a.stun ?? 0, src);
    this.events.push({ type: 'hit', x: t.x, y: t.y, team: src.team, amount: dmg, unitId: t.id, kind, crit });
    // Storm Giant zaps back whoever hits him.
    if (t.card.id === 'storm-giant' && !t.dead && dist(src, t) < 3) {
      this.damageUnit(src, 159, t.team, t);
      this.stunUnit(src, 0.5);
      this.events.push({ type: 'zap', fromX: t.x, fromY: t.y, toX: src.x, toY: src.y, team: t.team });
    }
    // Hex Witch curses what she hits.
    if (src.card.id === 'hex-witch' && t.kind === 'troop') {
      t.cursedBy = src.team;
      t.curseCard = 'cursed-frog';
    }
  }

  private canHit(src: Unit, u: Unit): boolean {
    const tg = src.card.targets;
    if (tg === 'ground' || tg === 'buildings') return !u.flying;
    if (tg === 'air') return u.flying;
    return true;
  }

  private chainFrom(from: Unit, team: Team, dmg: number, n: number, stun: number, src: Unit | null): void {
    const hit = new Set([from.id]);
    let cur: Unit = from;
    for (let i = 0; i < n; i++) {
      const next = this.units.filter((u) => !u.dead && u.team !== team && !hit.has(u.id) && !u.burrow && dist(u, cur) < 4).sort((a, b) => dist(a, cur) - dist(b, cur))[0];
      if (!next) break;
      hit.add(next.id);
      this.events.push({ type: 'zap', fromX: cur.x, fromY: cur.y, toX: next.x, toY: next.y, team });
      this.damageUnit(next, dmg * (src?.card.id === 'spark-spirit' ? 1 : 0.8), team, src);
      if (stun) this.stunUnit(next, stun);
      cur = next;
    }
  }

  /** Area damage not tied to a projectile (deploy slams, death bombs, abilities). */
  private blast(team: Team, x: number, y: number, r: number, dmg: number, kind: string, hitAir: boolean, stun = 0): void {
    for (const u of this.units) {
      if (u.dead || u.team === team || u.burrow || u.hidden) continue;
      if (!hitAir && u.flying) continue;
      if (Math.hypot(u.x - x, u.y - y) > r + u.radius * 0.5) continue;
      this.damageUnit(u, u.kind === 'tower' ? dmg * 0.5 : dmg, team, null);
      if (stun) this.stunUnit(u, stun);
    }
    this.events.push({ type: 'splash', x, y, radius: r, team, kind });
  }

  private stunUnit(u: Unit, s: number): void {
    if (u.kind === 'tower' && s < 1) {
      u.attackCd = Math.max(u.attackCd, 0.3);
      return;
    }
    u.stun = Math.max(u.stun, s);
    u.attackCd = Math.max(u.attackCd, u.card.firstHit);
    u.rampTime = 0;
    u.charging = false;
    u.chargeDist = 0;
  }

  private slowUnit(u: Unit, amt: number, time: number): void {
    u.slow = Math.max(u.slow, time);
    u.slowAmt = Math.max(u.slowAmt * (u.slow > 0 ? 1 : 0), amt);
  }

  private knock(u: Unit, fx: number, fy: number, amount: number): void {
    const d = Math.hypot(u.x - fx, u.y - fy) || 1;
    u.x = clamp(u.x + ((u.x - fx) / d) * amount, 0.5, ARENA_W - 0.5);
    u.y = clamp(u.y + ((u.y - fy) / d) * amount, 0.5, ARENA_H - 0.5);
    u.charging = false;
    u.chargeDist = 0;
  }

  damageUnit(u: Unit, amount: number, from: Team, src: Unit | null, crit = false): void {
    if (u.dead || amount <= 0) return;
    if (u.card.id === 'monk' && u.abilityActive > 0) amount *= 0.35;
    const total = Math.min(amount, Math.max(0, u.hp) + u.shield);
    if (u.shield > 0) {
      const used = Math.min(u.shield, amount);
      u.shield -= used;
      amount -= used;
    }
    u.hp -= amount;
    u.hitFlash = 0.12;
    if (total >= 1) this.events.push({ type: 'dmg', unitId: u.id, x: u.x, y: u.y, amount: Math.round(total), crit, tower: u.kind === 'tower' });
    if (u.kind === 'tower' && u.role === 'king' && !u.active) {
      u.active = true;
      this.events.push({ type: 'announce', text: 'KING ACTIVATED', tone: 'pink' });
      this.events.push({ type: 'king', unitId: u.id, x: u.x, y: u.y, team: u.team });
    }
    if (u.hp <= 0 && u.kind === 'tower') this.towerDown(u, from);
    if (u.hp <= 0 && src?.card.id === 'hex-witch' && u.kind === 'troop') {
      u.cursedBy = src.team;
      u.curseCard = 'cursed-frog';
    }
  }

  private towerDown(t: Unit, by: Team): void {
    if (t.dead) return;
    t.dead = true;
    t.hp = 0;
    const p = this.player(by);
    if (t.role === 'king') {
      p.crowns = 3;
    } else {
      p.crowns = Math.min(3, p.crowns + 1);
      const king = this.units.find((u) => u.kind === 'tower' && u.role === 'king' && u.team === t.team && !u.dead);
      if (king && !king.active) {
        king.active = true;
        this.events.push({ type: 'king', unitId: king.id, x: king.x, y: king.y, team: king.team });
      }
    }
    this.events.push({ type: 'tower', x: t.x, y: t.y, team: by, role: t.role! });
    this.events.push({ type: 'death', unitId: t.id, x: t.x, y: t.y, team: t.team, card: t.card.id, kind: 'tower' });
    if (t.role === 'king' || this.phase === 'overtime') this.finish(by);
  }

  // ------------------------------------------------------------------ areas

  private updateArea(a: Area, dt: number): void {
    const s = a.card.spell!;
    a.t += dt;
    if (a.t < 0) return;
    if (a.roll) {
      const r = a.roll;
      const step = 6 * dt;
      a.x += r.dx * step;
      a.y += r.dy * step;
      r.left -= step;
      for (const u of this.units) {
        if (u.dead || u.team === a.team || r.hit.has(u.id) || u.flying || u.burrow) continue;
        if (Math.abs(u.y - a.y) > 0.7 + u.radius * 0.5 || Math.abs(u.x - a.x) > a.radius + u.radius * 0.5) continue;
        r.hit.add(u.id);
        this.damageUnit(u, u.kind === 'tower' ? s.damage * (s.towerDamage ?? 1) : s.damage, a.team, null);
        if (s.knockback && u.kind === 'troop' && u.mass < 14) u.y += r.dy * s.knockback;
      }
      if (r.left <= 0 || a.y < 0.5 || a.y > ARENA_H - 0.5) {
        a.t = a.duration;
        if (s.spawn) this.spawnFrom(s.spawn, a.team, a.x, clamp(a.y, 1, ARENA_H - 1));
      }
      return;
    }
    if (s.travel === 'drop') {
      if (a.t >= a.duration && a.spawned === 0) {
        a.spawned = 1;
        this.applySpellHit(a.card, a.team, a.x, a.y, s.damage);
      }
      return;
    }
    if (a.card.id === 'lightning') return;
    if (s.duration) {
      // Damage-over-time spells hit in 4 pulses per second… Void in three big pulses.
      const pulses = a.card.id === 'void' ? 3 : Math.ceil(s.duration * 2);
      const every = s.duration / pulses;
      a.tick -= dt;
      if (a.tick <= 0 && a.pulses < pulses) {
        a.tick += every;
        a.pulses++;
        let hits = this.enemiesIn(a.team, a.x, a.y, a.radius, a.card.id === 'earthquake' ? 'ground' : 'all');
        if (a.grab) hits = hits.filter((u) => a.grab!.includes(u.id));
        let per = s.damage / pulses;
        if (a.card.id === 'void') per = hits.length <= 1 ? s.damage / 3 : hits.length <= 4 ? s.damage / 3 / 2.5 : s.damage / 3 / 6;
        for (const u of hits) {
          let d = per;
          if (u.kind === 'tower') d *= s.towerDamage ?? 1;
          else if (u.kind === 'building' && s.buildingBonus) d *= s.buildingBonus;
          if (a.card.id !== 'rage' && a.card.id !== 'graveyard') this.damageUnit(u, d, a.team, null);
          if (s.slow) this.slowUnit(u, s.slow, 1);
          if (a.card.id === 'goblin-hex' && u.kind === 'troop') {
            u.cursedBy = a.team;
            u.curseCard = 'goblins';
          }
        }
      }
      // Rage lingers ~2 s after leaving the puddle.
      if (s.rage) for (const u of this.units) if (!u.dead && u.team === a.team && dist(u, a) <= a.radius) u.rage = Math.max(u.rage, 2);
      if (s.pull) {
        for (const u of this.enemiesIn(a.team, a.x, a.y, a.radius, 'all')) {
          if (u.kind !== 'troop') continue;
          const d = dist(u, a) || 1;
          const pull = Math.min(d, 4.2 * dt * clamp(6 / u.mass, 0.25, 1));
          u.x -= ((u.x - a.x) / d) * pull;
          u.y -= ((u.y - a.y) / d) * pull;
        }
      }
      if (s.spawn) {
        const due = Math.floor((a.t / s.duration) * s.spawn.count);
        while (a.spawned < due) {
          a.spawned++;
          const ang = this.rand() * Math.PI * 2;
          const r = Math.sqrt(this.rand()) * a.radius;
          const u = this.spawnUnit(getCard(s.spawn.card), a.team, clamp(a.x + Math.cos(ang) * r, 0.5, 17.5), clamp(a.y + Math.sin(ang) * r, 0.5, 31.5));
          u.deploy = 0.5;
        }
      }
    }
  }

  private enemiesIn(team: Team, x: number, y: number, r: number, which: 'all' | 'ground'): Unit[] {
    return this.units.filter((u) => !u.dead && u.team !== team && !u.burrow && !u.hidden && !(which === 'ground' && u.flying) && Math.hypot(u.x - x, u.y - y) <= r + u.radius * 0.5);
  }

  // ------------------------------------------------------------------ physics + cleanup

  private separate(dt: number): void {
    const list = this.units.filter((u) => !u.dead && !u.burrow);
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        if (a.flying !== b.flying) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        const min = a.radius + b.radius;
        if (d >= min || d < 1e-5) continue;
        const overlap = min - d;
        const fixedA = a.kind !== 'troop' || a.deploy > 0;
        const fixedB = b.kind !== 'troop' || b.deploy > 0;
        if (fixedA && fixedB) continue;
        const wa = fixedA ? 0 : fixedB ? 1 : b.mass / (a.mass + b.mass);
        const wb = 1 - wa;
        const push = Math.min(overlap, overlap * 8 * dt + 0.01);
        a.x += (dx / d) * push * wa;
        a.y += (dy / d) * push * wa;
        b.x -= (dx / d) * push * wb;
        b.y -= (dy / d) * push * wb;
      }
    }
    // River: ground troops can't stand in the water (outside the bridges).
    for (const u of list) {
      if (u.kind !== 'troop' || u.flying) continue;
      u.x = clamp(u.x, 0.4, ARENA_W - 0.4);
      u.y = clamp(u.y, 0.4, ARENA_H - 0.4);
      const inRiver = Math.abs(u.y - RIVER_Y) < RIVER_HALF;
      const onBridge = BRIDGES.some((b) => Math.abs(u.x - b) < BRIDGE_HALF);
      if (inRiver && !onBridge && !u.card.abilities.riverJump && !u.dash) u.y = u.y < RIVER_Y ? RIVER_Y - RIVER_HALF : RIVER_Y + RIVER_HALF;
    }
  }

  private reap(dt: number): void {
    for (const u of this.units) {
      if (u.dead) {
        u.deadFor += dt;
        continue;
      }
      if (u.hp > 0) continue;
      u.dead = true;
      if (u.kind === 'tower') continue;
      this.events.push({ type: 'death', unitId: u.id, x: u.x, y: u.y, team: u.team, card: u.card.id, kind: u.kind });
      const a = u.card.abilities;
      if (a.deathDamage) this.blast(u.team, u.x, u.y, a.deathDamage.radius, a.deathDamage.damage, 'bomb', true);
      if (a.deathSlow) for (const e of this.enemiesIn(u.team, u.x, u.y, 2, 'all')) this.slowUnit(e, 0.35, 1.5);
      if (a.deathRage) {
        const rage = getCard('rage');
        this.areas.push({ id: NEXT_ID++, card: rage, team: u.team, x: u.x, y: u.y, radius: 3, t: 0, duration: 5, tick: 0, roll: null, spawned: 0, pulses: 99 });
        this.events.push({ type: 'spell', card: 'rage', x: u.x, y: u.y, team: u.team, radius: 3 });
      }
      if (a.deathSpawn) this.spawnFrom(a.deathSpawn, u.team, u.x, u.y);
      if (u.cursedBy && u.cursedBy !== u.team && u.card.id !== 'cursed-frog') this.spawnFrom({ card: u.curseCard, count: 1 }, u.cursedBy, u.x, u.y);
      // Souls for the Bone King.
      for (const k of this.units) if (!k.dead && k.card.abilities.ability === 'soulSummon' && dist(k, u) < 9 && u.kind === 'troop') k.souls++;
    }
    // Keep corpses briefly for death animations, then drop them.
    this.units = this.units.filter((u) => !u.dead || (u.kind !== 'tower' && u.deadFor < 2.5) || u.kind === 'tower');
  }

  // ------------------------------------------------------------------ end

  private finish(w: Team | 'draw'): void {
    if (this.phase === 'ended') return;
    this.winner = w;
    this.phase = 'ended';
    this.events.push({ type: 'announce', text: w === 'draw' ? 'DRAW' : w === 'blue' ? 'VICTORY!' : 'DEFEAT', tone: w === 'blue' ? 'gold' : 'pink' });
  }

  /** Tiebreak: the side whose weakest tower has more hit points wins. */
  private finishByHealth(): void {
    const low = (t: Team) => Math.min(...this.towers(t).map((u) => u.hp));
    const b = low('blue');
    const r = low('red');
    this.finish(Math.abs(b - r) < 1 ? 'draw' : b > r ? 'blue' : 'red');
  }

  /** Online: a taunt from either player (purely cosmetic). */
  emote(team: Team, emote: number): void {
    this.events.push({ type: 'emote', team, emote });
  }

  /** A player left: the other one wins. */
  forfeit(loser: Team): void {
    this.events.push({ type: 'announce', text: 'OPPONENT LEFT', tone: 'cyan' });
    this.player(enemyOf(loser)).crowns = 3;
    this.finish(enemyOf(loser));
  }

  forceEnd(): void {
    this.finishByHealth();
  }
}

/** Sim-time timeout (runs inside step()). */
function setTimeoutSim(engine: BattleEngine, t: number, fn: () => void): void {
  engine.timers.push({ t, fn });
}
