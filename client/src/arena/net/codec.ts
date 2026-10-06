import { CARD_MAP } from '../cards';
import { ARENA_H, ARENA_W, towerCard, type Area, type BattleEngine, type BattleEvent, type PlayerState, type Projectile, type UnitKind, type TowerRole } from '../engine';
import type { ProjectileKind, Team } from '../types';

/**
 * Battle snapshots for online play. The server encodes its engine every few ticks;
 * clients apply the snapshot to a never-stepped mirror engine, updating objects in
 * place (the 3D views hold references). `flip` turns the board around for the red
 * player so everyone plays from the bottom as blue.
 */

export interface Snapshot {
  /** time, countdown, phase, winner */
  m: [number, number, number, number];
  /** blue, red players */
  p: [PlayerRow, PlayerRow];
  u: UnitRow[];
  j: ProjRow[];
  a: AreaRow[];
  e: BattleEvent[];
}
type PlayerRow = [number, string[], string, number, string, number];
type UnitRow = [number, string, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
type ProjRow = [number, string, number, number, number, number, string, string];
type AreaRow = [number, string, number, number, number, number, number, number, number];

const PHASES = ['countdown', 'battle', 'overtime', 'ended'] as const;
const WINNERS = [null, 'blue', 'red', 'draw'] as const;
const KINDS: UnitKind[] = ['troop', 'building', 'tower'];
const ROLES: Array<TowerRole | undefined> = [undefined, 'king', 'left', 'right'];
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Mirroring the board swaps which princess tower is on the left. */
const flipRole = (r: TowerRole | undefined, flip: boolean): TowerRole | undefined => (!flip || !r || r === 'king' ? r : r === 'left' ? 'right' : 'left');
const tIdx = (t: Team) => (t === 'blue' ? 0 : 1);

// ============================================================================ encode (server)

export function encodeSnapshot(e: BattleEngine, events: BattleEvent[]): Snapshot {
  const player = (p: PlayerState): PlayerRow => [r2(p.elixir), [...p.hand], p.next, p.crowns, p.lastPlayed ?? '', Math.round(p.elixirSpent)];
  return {
    m: [r2(e.time), r2(e.countdown), PHASES.indexOf(e.phase), WINNERS.indexOf(e.winner)],
    p: [player(e.blue), player(e.red)],
    u: e.units.map((u) => {
      const flags =
        (u.moving ? 1 : 0) | (u.flying ? 2 : 0) | (u.dead ? 4 : 0) | (u.hidden ? 8 : 0) | (u.invisible ? 16 : 0) | (u.charging ? 32 : 0) |
        (u.active ? 64 : 0) | (u.burrow ? 128 : 0) | (u.hitFlash > 0.1 ? 256 : 0) | (u.dash?.jump ? 512 : 0) | (u.dash ? 1024 : 0);
      return [
        u.id, u.card.id, tIdx(u.team), KINDS.indexOf(u.kind), ROLES.indexOf(u.role), r2(u.x), r2(u.y), r2(u.dirX), r2(u.dirY), flags,
        Math.round(u.hp), Math.round(u.maxHp), Math.round(u.shield), Math.round(u.maxShield), r2(u.deploy), u.attackSeq,
        r2(u.stun), r2(u.freeze), r2(u.slow), r2(u.rage), r2(u.deadFor), u.targetId, r2(u.attackCd), u.hitSpeed, u.speed, u.radius,
        r2(u.dash?.t ?? 0), r2(u.dash?.dur ?? 0), r2(u.slowAmt),
      ];
    }),
    j: e.projectiles.map((p) => [p.id, p.kind, tIdx(p.team), r2(p.x), r2(p.y), r2(p.z), p.card?.id ?? '', p.spellCard?.id ?? '']),
    a: e.areas.map((a) => [a.id, a.card.id, tIdx(a.team), r2(a.x), r2(a.y), a.radius, r2(a.t), a.duration, a.roll ? a.roll.dy : 0]),
    e: events,
  };
}

// ============================================================================ apply (client)

export function applySnapshot(e: BattleEngine, s: Snapshot, flip: boolean): BattleEvent[] {
  const X = (x: number) => (flip ? ARENA_W - x : x);
  const Y = (y: number) => (flip ? ARENA_H - y : y);
  const T = (i: number): Team => ((i === 0) !== flip ? 'blue' : 'red');
  e.time = s.m[0];
  e.countdown = s.m[1];
  e.phase = PHASES[s.m[2]] ?? 'battle';
  const w = WINNERS[s.m[3]] ?? null;
  e.winner = w === 'blue' || w === 'red' ? (flip ? (w === 'blue' ? 'red' : 'blue') : w) : w;
  const setPlayer = (p: PlayerState, row: PlayerRow) => {
    p.elixir = row[0];
    p.hand = row[1];
    p.next = row[2];
    p.crowns = row[3];
    p.lastPlayed = row[4] || null;
    p.elixirSpent = row[5];
  };
  setPlayer(e.blue, s.p[flip ? 1 : 0]);
  setPlayer(e.red, s.p[flip ? 0 : 1]);

  // Units: update in place by id.
  const byId = new Map(e.units.map((u) => [u.id, u]));
  e.units = s.u.map((row) => {
    const [id, cardId, team, kind, role] = row;
    let u = byId.get(id);
    if (!u) {
      const k = KINDS[kind] ?? 'troop';
      const card = k === 'tower' ? towerCard(ROLES[role] === 'king') : CARD_MAP.get(cardId);
      u = e.shell(card ?? CARD_MAP.get('knight')!, T(team), k);
      u.id = id;
      u.role = flipRole(ROLES[role], flip);
    }
    const flags = row[9];
    u.x = X(row[5]);
    u.y = Y(row[6]);
    u.dirX = flip ? -row[7] : row[7];
    u.dirY = flip ? -row[8] : row[8];
    u.moving = Boolean(flags & 1);
    u.flying = Boolean(flags & 2);
    u.dead = Boolean(flags & 4);
    u.hidden = Boolean(flags & 8);
    u.invisible = Boolean(flags & 16);
    u.charging = Boolean(flags & 32);
    u.active = Boolean(flags & 64);
    u.burrow = flags & 128 ? { x: u.x, y: u.y } : null;
    if (flags & 256) u.hitFlash = 0.12;
    u.dash = flags & 1024 ? { fromX: u.x, fromY: u.y, toX: u.x, toY: u.y, t: row[26], dur: row[27] || 0.35, targetId: -1, jump: Boolean(flags & 512) } : null;
    u.hp = row[10];
    u.maxHp = row[11];
    u.shield = row[12];
    u.maxShield = row[13];
    u.deploy = row[14];
    u.attackSeq = row[15];
    u.stun = row[16];
    u.freeze = row[17];
    u.slow = row[18];
    u.rage = row[19];
    u.deadFor = row[20];
    u.targetId = row[21];
    u.attackCd = row[22];
    u.hitSpeed = row[23];
    u.speed = row[24];
    u.radius = row[25];
    u.slowAmt = row[28];
    return u;
  });

  const projs = new Map(e.projectiles.map((p) => [p.id, p]));
  e.projectiles = s.j.map(([id, kind, team, x, y, z, cardId, spellId]) => {
    let p = projs.get(id);
    if (!p) {
      p = {
        id, kind: kind as ProjectileKind, team: T(team), sourceId: -1, card: CARD_MAP.get(cardId) ?? null, x: X(x), y: Y(y), z, fromX: X(x), fromY: Y(y), tx: X(x), ty: Y(y),
        targetId: -1, speed: 0, damage: 0, splash: 0, arc: 0, t: 0, dur: 1, homing: false, pierce: null, airOnly: false, groundOnly: false,
        spellCard: CARD_MAP.get(spellId) ?? null, towerMul: 1, done: false,
      } satisfies Projectile;
    }
    p.x = X(x);
    p.y = Y(y);
    p.z = z;
    return p;
  });

  const areas = new Map(e.areas.map((a) => [a.id, a]));
  e.areas = s.a.map(([id, cardId, team, x, y, radius, t, duration, rollDy]) => {
    let a = areas.get(id);
    if (!a) {
      a = { id, card: CARD_MAP.get(cardId)!, team: T(team), x: X(x), y: Y(y), radius, t, duration, tick: 0, roll: rollDy ? { dx: 0, dy: flip ? -rollDy : rollDy, left: 0, hit: new Set() } : null, spawned: 0, pulses: 0 } satisfies Area;
    }
    a.x = X(x);
    a.y = Y(y);
    a.t = t;
    a.duration = duration;
    return a;
  });

  return s.e.map((ev) => flipEvent(ev, flip));
}

/** Mirror an event's coordinates/team (and who won) for the red player. */
function flipEvent(ev: BattleEvent, flip: boolean): BattleEvent {
  if (!flip) return ev;
  const o = { ...ev } as Record<string, unknown>;
  for (const k of ['x', 'fromX', 'toX']) if (typeof o[k] === 'number') o[k] = ARENA_W - (o[k] as number);
  for (const k of ['y', 'fromY', 'toY']) if (typeof o[k] === 'number') o[k] = ARENA_H - (o[k] as number);
  if (ev.type === 'tower') o.role = flipRole(ev.role, true);
  if (o.team === 'blue') o.team = 'red';
  else if (o.team === 'red') o.team = 'blue';
  if (ev.type === 'announce') {
    if (ev.text === 'VICTORY!') o.text = 'DEFEAT';
    else if (ev.text === 'DEFEAT') o.text = 'VICTORY!';
    if (o.text === 'VICTORY!') o.tone = 'gold';
    if (o.text === 'DEFEAT') o.tone = 'pink';
  }
  return o as unknown as BattleEvent;
}

/** Board → server coordinates for a play made on a flipped board. */
export function toServer(x: number, y: number, flip: boolean): { x: number; y: number } {
  return flip ? { x: ARENA_W - x, y: ARENA_H - y } : { x, y };
}
