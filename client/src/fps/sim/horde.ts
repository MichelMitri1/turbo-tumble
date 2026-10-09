import type { Box } from './level';
import { NavGrid } from './nav';
import type { Input } from './player';
import type { Game, Soldier, WeaponState } from './game';
import type { ZMapMeta } from './zmap';
import { BOX_POOL, POWERUPS, POWERUP_LIST, ZPERKS, ZPERK_LIST, zdef, type PowerUp, type ZPerk, type ZWeaponDef } from './zweapons';
import { WEAPON } from './weapons';

/**
 * Zombies, after Black Ops (2010): endless rounds of undead that claw through boarded
 * windows, get tougher and faster every round, with hellhound rounds every few rounds.
 * Points buy doors, wall weapons, perks, the mystery box and the Pack-a-Punch.
 *
 * The numbers are the game's:
 *  - health 150, +100 a round to round 9, then ×1.1 a round;
 *  - count 24 + 6·mult per extra player (solo: + 3·mult), mult = round/5 (≥1),
 *    ×0.15·round from round 10; rounds 1–5 scaled 25/30/50/70/90 %; at most 24 alive;
 *  - spawn delay 2 s ×0.95 a round; 10 points a hit, 50 a kill (100 head, 130 knife);
 *  - power-ups drop each time the team's earnings pass 2000 (×1.14 each time), max 4 a round;
 *  - six boards a window, 10 points a board (capped per round);
 *  - perks: 2500 / 1500 (500 solo) / 3000 / 2000; Pack-a-Punch 5000; the box 950.
 */

export type ZState = 'rise' | 'approach' | 'barrier' | 'climb' | 'chase' | 'dead';
export const ZSTATES: ZState[] = ['rise', 'approach', 'barrier', 'climb', 'chase', 'dead'];

export interface Zombie {
  id: number;
  dog: boolean;
  male: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  /** 0 walk, 1 run, 2 sprint. */
  pace: 0 | 1 | 2;
  speed: number;
  state: ZState;
  /** Seconds in the current state. */
  t: number;
  win: number;
  /** Swing timer (counts down from 1; damage lands half-way) and cooldown. */
  atk: number;
  atkCd: number;
  hitDone: boolean;
  target: string;
  retarget: number;
  burnT: number;
  burnBy: string;
  /** Killed by a headshot (the head pops). */
  head: boolean;
  /** Stuck detection. */
  stuckT: number;
  lastX: number;
  lastZ: number;
  /** Render: current speed. */
  v: number;
  /** Thunder Cannon / explosion fling on death. */
  flingX: number;
  flingZ: number;
}

export interface ZPlayer {
  points: number;
  perks: ZPerk[];
  downed: boolean;
  /** Seconds of bleed-out left while downed. */
  bleed: number;
  /** Bled out: waits for the next round. */
  dead: boolean;
  reviveBy: string;
  /** Revive progress 0..1. */
  reviveP: number;
  /** Solo Second Wind: self-revives left. */
  selfRevives: number;
  selfReviveT: number;
  bowie: boolean;
  monkeys: number;
  /** Hold-to-use progress (rebuild cadence). */
  holdT: number;
  repairPts: number;
  /** Drinking a perk / being handed a box gun: hands busy. */
  busyT: number;
  /** Weapons put away while downed. */
  saved: { weapons: [WeaponState, WeaponState]; cur: 0 | 1 } | null;
  kills: number;
  headshots: number;
  downs: number;
  revives: number;
  /** Total earned (for the drop counter and the end screen). */
  earned: number;
}

export interface MysteryBox {
  /** idle (closed, buyable), roll (cycling), offer (weapon floating), bear (teddy: leaving), gone (moving away). */
  state: 'idle' | 'roll' | 'offer' | 'bear' | 'gone';
  t: number;
  user: string;
  weapon: string;
}

export interface Drop {
  id: number;
  kind: PowerUp;
  x: number;
  y: number;
  z: number;
  t: number;
}

export type ZEvent =
  | { k: 'zround'; round: number; dog: boolean }
  | { k: 'zroundEnd'; round: number }
  | { k: 'zpts'; who: string; pts: number }
  | { k: 'zbuy'; who: string; what: string }
  | { k: 'zdeny'; who: string; why: string }
  | { k: 'zboard'; win: number; add: boolean }
  | { k: 'zhit'; id: number; by: string; dmg: number; head: boolean; kill: boolean; x: number; y: number; z: number }
  | { k: 'zdown'; who: string }
  | { k: 'zrevived'; who: string; by: string }
  | { k: 'zbleed'; who: string }
  | { k: 'zperk'; who: string; perk: ZPerk }
  | { k: 'zpower' }
  | { k: 'zdrop'; id: number; kind: PowerUp; x: number; z: number }
  | { k: 'zgrab'; id: number; kind: PowerUp; who: string }
  | { k: 'zbox'; spot: number; what: 'open' | 'offer' | 'bear' | 'move' | 'take' | 'arrive'; weapon: string; who: string }
  | { k: 'zpap'; what: 'start' | 'ready' | 'take'; who: string; weapon: string }
  | { k: 'zswing'; id: number; who: string; hit: boolean }
  | { k: 'zthunder'; who: string; x: number; y: number; z: number; dx: number; dz: number }
  | { k: 'zspawn'; id: number; x: number; z: number; dog: boolean }
  | { k: 'zdoor'; door: number; who: string }
  | { k: 'zover'; round: number };

const MAX_ALIVE = 24;
const BOARDS = 6;
const BLEED = 30;
const ZOMBIE_HIT = 50;
const DOG_HIT = 35;
const PACES = [1.05, 3.4, 5.6];
const DOG_SPEED = 7.2;

export class Horde {
  readonly meta: ZMapMeta;
  round = 0;
  /** pre: before round 1 · round: undead coming · break: between rounds · over: everyone's down. */
  phase: 'pre' | 'round' | 'break' | 'over' = 'pre';
  /** Seconds left in pre / break. */
  phaseT = 3;
  zombies: Zombie[] = [];
  toSpawn = 0;
  spawnT = 0;
  dogRound = false;
  private nextDogRound = 0;
  private dogRounds = 0;
  boards: number[];
  doors: boolean[];
  zones: boolean[];
  power = false;
  readonly doorBoxes: Box[] = [];
  boxAt = 0;
  boxes: MysteryBox[];
  private boxUses = 0;
  private boxMoved = false;
  pap: { state: 'idle' | 'work' | 'ready'; t: number; user: string; weapon: string; slot: 0 | 1 } = { state: 'idle', t: 0, user: '', weapon: '', slot: 0 };
  drops: Drop[] = [];
  insta = 0;
  double = 0;
  firesale = 0;
  /** Solo Second Wind can only be bought 3 times; then the machine is gone. */
  reviveBought = 0;
  private dropAt = 2000;
  private dropEarned = 0;
  private dropsThisRound = 0;
  private dropBag: PowerUp[] = [];
  private nextId = 1;
  private nav: NavGrid | null = null;
  /** Flow fields: soldier id (or 'monkey:<id>') → path distance per nav node. */
  private fields = new Map<string, Float32Array>();
  private fieldT = 0;
  /** Monkey bombs: zombies chase these while they sing. */
  monkeys: Array<{ id: number; x: number; y: number; z: number; t: number; owner: string }> = [];
  /** Recent zombie positions (lag compensation for online shots): [time, id → [x, y, z, yaw]]. */
  private history: Array<[number, Map<number, [number, number, number, number]>]> = [];
  /** Mirror: snapshot samples per zombie, for interpolating at the render time. */
  private samples = new Map<number, Array<[number, number, number, number, number]>>();
  /** A mirror (online client) never simulates: the server's snapshots drive it. */
  mirror = false;
  /** Levels to keep in sync with door purchases (the game's, and on clients the predictor's). */
  levels: Array<Game['level']>;

  constructor(
    readonly game: Game,
    meta: ZMapMeta,
  ) {
    this.meta = meta;
    this.boards = meta.windows.map(() => BOARDS);
    this.doors = meta.doors.map(() => false);
    this.zones = meta.zones.map((_, i) => i === 0);
    this.levels = [game.level];
    for (const d of meta.doors) {
      const [x0, z0, x1, z1] = d.box;
      const box: Box = { x0, y0: 0, z0, x1, y1: 3.2, z1, mat: d.look === 'door' ? 'darkwood' : 'wood', hidden: true };
      this.doorBoxes.push(box);
      game.level.add(box);
    }
    this.boxes = meta.boxSpots.map(() => ({ state: 'idle', t: 0, user: '', weapon: '' }) as MysteryBox);
    this.boxAt = Math.floor(game.rand() * meta.boxSpots.length);
    this.nextDogRound = 5 + Math.floor(game.rand() * 3);
  }

  private ev(e: ZEvent): void {
    (this.game.events as unknown as ZEvent[]).push(e);
  }

  // ---------------------------------------------------------------- players

  /** Fresh zombies loadout: the M1911 (8 + 32), knife, two frags, 500 points. */
  initPlayer(s: Soldier): void {
    s.zm = {
      points: 500,
      perks: [],
      downed: false,
      bleed: 0,
      dead: false,
      reviveBy: '',
      reviveP: 0,
      selfRevives: 0,
      selfReviveT: 0,
      bowie: false,
      monkeys: 0,
      holdT: 0,
      repairPts: 0,
      busyT: 0,
      saved: null,
      kills: 0,
      headshots: 0,
      downs: 0,
      revives: 0,
      earned: 0,
    };
    // Pack-a-Punched guns wear the shifting camo.
    s.camos = { ...s.camos };
    for (const id of Object.keys(WEAPON)) if (id.endsWith('_up')) s.camos[id] = 'darkmatter';
  }

  /** (Re)spawned: pistol only. Points and stats carry over. */
  onSpawn(s: Soldier): void {
    const z = s.zm;
    if (!z) return;
    s.weapons = [this.gun('zm_m1911'), this.gun('zm_empty')];
    s.cur = 0;
    s.grenades = 2;
    s.tacticals = 0;
    s.hp = 100;
    z.downed = false;
    z.dead = false;
    z.perks = [];
    z.saved = null;
    z.reviveP = 0;
  }

  gun(id: string, full = false): WeaponState {
    const def = WEAPON[id]!;
    const zd = zdef(id);
    return { def, att: { optic: 'iron', muzzle: 'none', under: 'none', ammo: 'standard' }, ammo: def.mag, reserve: full ? def.reserve : (zd?.zm.startReserve ?? def.reserve) };
  }

  has(s: Soldier, perk: ZPerk): boolean {
    return !!s.zm?.perks.includes(perk);
  }
  maxHp(s: Soldier): number {
    return this.has(s, 'jug') ? 250 : 100;
  }
  reloadMul(s: Soldier): number {
    return this.has(s, 'speed') ? 0.5 : 1;
  }
  rofMul(s: Soldier): number {
    return this.has(s, 'dtap') ? 1.33 : 1;
  }
  private solo(): boolean {
    return this.game.soldiers.length <= 1;
  }

  addPoints(s: Soldier, pts: number, earned = true): void {
    const z = s.zm;
    if (!z) return;
    if (earned && this.game.time < this.double) pts *= 2;
    z.points = Math.max(0, z.points + pts);
    if (earned && pts > 0) {
      z.earned += pts;
      this.dropEarned += pts;
    }
    this.ev({ k: 'zpts', who: s.id, pts });
  }

  private spend(s: Soldier, cost: number, what: string): boolean {
    const z = s.zm!;
    if (z.points < cost) {
      this.ev({ k: 'zdeny', who: s.id, why: 'points' });
      return false;
    }
    z.points -= cost;
    this.ev({ k: 'zpts', who: s.id, pts: -cost });
    this.ev({ k: 'zbuy', who: s.id, what });
    return true;
  }

  /** Damage to a player (zombie swipes, your own explosives): downed instead of killed. */
  damagePlayer(t: Soldier, dmg: number): boolean {
    const z = t.zm;
    if (!z || !t.alive || z.downed || this.phase === 'over') return false;
    t.hp -= dmg;
    t.lastDamageT = this.game.time;
    if (t.hp > 0) return false;
    this.down(t);
    return true;
  }

  private down(t: Soldier): void {
    const z = t.zm!;
    t.hp = 1;
    z.downed = true;
    z.bleed = BLEED;
    z.downs++;
    z.reviveP = 0;
    z.reviveBy = '';
    // Solo Second Wind: back up in 10 seconds.
    z.selfReviveT = this.solo() && this.has(t, 'revive') ? 10 : 0;
    z.perks = [];
    // 5% of your points, gone.
    const lost = Math.floor(z.points * 0.05 / 10) * 10;
    if (lost) {
      z.points -= lost;
      this.ev({ k: 'zpts', who: t.id, pts: -lost });
    }
    // Last stand: your best pistol (the Ray Gun counts), else an M1911.
    z.saved = { weapons: [t.weapons[0], t.weapons[1]], cur: t.cur };
    const pistols = t.weapons.filter((w) => w.def.cls === 'pistol' && w.def.id !== 'zm_empty').sort((a, b) => (b.def.damage[0]![1] ?? 0) - (a.def.damage[0]![1] ?? 0));
    const side = pistols[0] ? { ...pistols[0], ammo: Math.max(pistols[0].ammo, 1) } : { ...this.gun('zm_m1911'), reserve: 24 };
    t.weapons = [side, this.gun('zm_empty')];
    t.cur = 0;
    t.reloadT = t.swapT = 0;
    t.cookStart = -1;
    t.m.crouched = true;
    this.ev({ k: 'zdown', who: t.id });
    this.checkOver();
  }

  private revive(t: Soldier, by: Soldier | null): void {
    const z = t.zm!;
    z.downed = false;
    z.reviveP = 0;
    z.reviveBy = '';
    t.hp = 100;
    t.lastDamageT = this.game.time;
    if (z.saved) {
      // Ammo spent from an owned pistol stays spent.
      const used = t.weapons[0];
      const [a, b] = z.saved.weapons;
      if (a.def.id === used.def.id) a.ammo = used.ammo;
      else if (b.def.id === used.def.id) b.ammo = used.ammo;
      t.weapons = [a, b];
      t.cur = z.saved.cur;
      z.saved = null;
    }
    if (by && by.zm) by.zm.revives++;
    this.ev({ k: 'zrevived', who: t.id, by: by?.id ?? t.id });
  }

  private bleedOut(t: Soldier): void {
    const z = t.zm!;
    z.downed = false;
    z.dead = true;
    z.saved = null;
    t.alive = false;
    t.hp = 0;
    t.respawnIn = Infinity;
    t.deaths++;
    const lost = Math.floor(z.points * 0.1 / 10) * 10;
    if (lost) {
      z.points -= lost;
      this.ev({ k: 'zpts', who: t.id, pts: -lost });
    }
    this.ev({ k: 'zbleed', who: t.id });
    this.checkOver();
  }

  private checkOver(): void {
    if (this.phase === 'over') return;
    const up = this.game.soldiers.filter((s) => s.alive && s.zm && (!s.zm.downed || s.zm.selfReviveT > 0) && s.connected !== false);
    if (up.length) return;
    this.phase = 'over';
    this.game.phase = 'over';
    this.ev({ k: 'zover', round: this.round });
    (this.game.events as unknown as Array<{ k: 'over'; winner: -1; top: string }>).push({ k: 'over', winner: -1, top: '' });
  }

  /** Downed players crawl: no sprint, jump or slide; crouched; slow. */
  adjust(s: Soldier, inp: Input): { inp: Input; speed: number } {
    const z = s.zm;
    if (!z) return { inp, speed: 1 };
    if (z.downed) return { inp: { ...inp, jump: false, sprint: false, crouch: false, grenade: false, tactical: false, melee: false, slot: -1 }, speed: 0.22 };
    if (z.busyT > 0 || z.holdT > 0) return { inp: { ...inp, fire: false, ads: false, sprint: false }, speed: z.holdT > 0 ? 0 : 1 };
    return { inp, speed: 1 };
  }

  // ---------------------------------------------------------------- interaction

  /** What's in front of a player to use (nearest first). */
  prompt(s: Soldier): { kind: string; text: string; cost: number; idx: number } | null {
    const z = s.zm;
    if (!z || !s.alive || this.phase === 'over') return null;
    if (z.downed) return null;
    const px = s.m.x;
    const pz = s.m.z;
    const look = [-Math.sin(s.m.yaw), -Math.cos(s.m.yaw)];
    const facing = (x: number, zz: number) => {
      const dx = x - px;
      const dz = zz - pz;
      const d = Math.hypot(dx, dz) || 1;
      return (dx * look[0]! + dz * look[1]!) / d;
    };
    // A team-mate to pick up.
    for (const o of this.game.soldiers) {
      if (o === s || !o.alive || !o.zm?.downed) continue;
      if (Math.hypot(o.m.x - px, o.m.z - pz) < 1.9) return { kind: 'revive', text: `Hold to revive ${o.name}`, cost: 0, idx: this.game.soldiers.indexOf(o) };
    }
    let best: { kind: string; text: string; cost: number; idx: number; d: number } | null = null;
    const offer = (kind: string, text: string, cost: number, idx: number, x: number, zz: number, range: number, needFacing = 0.25) => {
      const d = Math.hypot(x - px, zz - pz);
      if (d > range || Math.abs(s.m.y - (kind === 'pap' || kind === 'power' || (kind === 'wall' && this.meta.wallbuys[idx]!.y > 2.2) ? 1 : 0)) > 1.6) return;
      if (d > 0.6 && facing(x, zz) < needFacing) return;
      if (!best || d < best.d) best = { kind, text, cost, idx, d };
    };
    this.meta.windows.forEach((w, i) => {
      if (this.boards[i]! >= BOARDS || !this.zones[w.zone]) return;
      offer('window', 'Hold to rebuild barrier', 0, i, w.x + w.nx * 0.9, w.z + w.nz * 0.9, 1.7, -1);
    });
    this.meta.doors.forEach((d, i) => {
      if (this.doors[i]) return;
      offer('door', `Hold to ${d.look === 'door' ? 'open door' : 'clear debris'}`, d.cost, i, d.x, d.z, 2.6, -0.2);
    });
    this.meta.wallbuys.forEach((w, i) => {
      const owned = s.weapons.find((x) => x.def.id === w.weapon || x.def.id === `${w.weapon}_up`);
      let text: string;
      let cost = w.cost;
      if (w.weapon === 'frag') text = 'Hold to buy Frag Grenades';
      else if (w.weapon === 'bowie') {
        if (z.bowie) return;
        text = 'Hold to buy Bowie Knife';
      } else if (owned) {
        cost = owned.def.id.endsWith('_up') ? 4500 : Math.round(w.cost / 2);
        text = `Hold to buy ammo for ${owned.def.name}`;
      } else text = `Hold to buy ${WEAPON[w.weapon]?.name}`;
      offer('wall', text, cost, i, w.x + w.nx * 0.8, w.z + w.nz * 0.8, 1.6);
    });
    this.meta.perks.forEach((p, i) => {
      if (z.perks.includes(p.perk)) return;
      const soloRevive = p.perk === 'revive' && this.solo();
      if (soloRevive && this.reviveBought >= 3) return;
      const cost = soloRevive ? 500 : ZPERKS[p.perk].price;
      const text = !this.power && !soloRevive ? 'You must turn on the power first!' : `Hold to buy ${ZPERKS[p.perk].name}`;
      offer('perk', text, !this.power && !soloRevive ? -1 : cost, i, p.x + p.nx * 0.9, p.z + p.nz * 0.9, 1.5);
    });
    this.meta.boxSpots.forEach((b, i) => {
      if (!this.boxActive(i)) return;
      const bx = this.boxes[i]!;
      const fire = this.game.time < this.firesale;
      if (bx.state === 'idle') offer('box', 'Hold for Mystery Box', fire ? 10 : 950, i, b.x + b.nx * 0.9, b.z + b.nz * 0.9, 1.9);
      else if (bx.state === 'offer' && bx.user === s.id) offer('box', `Hold to take ${WEAPON[bx.weapon]?.name ?? 'Clockwork Monkey'}`, 0, i, b.x + b.nx * 0.9, b.z + b.nz * 0.9, 1.9);
    });
    if (!this.power) offer('power', 'Hold to turn on the power', 0, 0, this.meta.power.x + this.meta.power.nx * 0.8, this.meta.power.z + this.meta.power.nz * 0.8, 1.6);
    {
      const p = this.meta.pap;
      const w = s.weapons[s.cur];
      const zd = zdef(w.def.id);
      if (this.pap.state === 'ready' && this.pap.user === s.id) offer('pap', `Hold to take ${WEAPON[this.pap.weapon]?.name}`, 0, 0, p.x + p.nx * 1.2, p.z + p.nz * 1.2, 2.1);
      else if (this.pap.state === 'idle') {
        if (!this.power) offer('pap', 'You must turn on the power first!', -1, 0, p.x + p.nx * 1.2, p.z + p.nz * 1.2, 2.1);
        else if (zd?.zm.pap) offer('pap', 'Hold to Pack-a-Punch', 5000, 0, p.x + p.nx * 1.2, p.z + p.nz * 1.2, 2.1);
      }
    }
    if (!best) return null;
    const { kind, text, cost, idx } = best as { kind: string; text: string; cost: number; idx: number };
    return { kind, text, cost, idx };
  }

  /**
   * Use button (reload) handling: buys on the press, rebuilds / revives while held.
   * Returns true when the button was used for something (so it doesn't also reload).
   */
  interact(s: Soldier, inp: Input, dt: number): boolean {
    const z = s.zm;
    if (!z) return false;
    const held = !!inp.use || inp.reload;
    const press = inp.reload || (!!inp.use && !s.lastInput.use);
    const p = this.prompt(s);
    if (!held || !p) {
      z.holdT = 0;
      for (const o of this.game.soldiers) if (o.zm?.reviveBy === s.id) {
        o.zm.reviveBy = '';
        o.zm.reviveP = 0;
      }
      return !!p && held;
    }
    if (this.mirror) return true;
    switch (p.kind) {
      case 'revive': {
        const o = this.game.soldiers[p.idx]!;
        const oz = o.zm!;
        oz.reviveBy = s.id;
        oz.reviveP += dt / (this.has(s, 'revive') ? 1.5 : 3);
        z.holdT = dt;
        if (oz.reviveP >= 1) this.revive(o, s);
        return true;
      }
      case 'window': {
        z.holdT += dt;
        if (z.holdT < 0.65) return true;
        z.holdT = 0.001;
        if (this.zombies.some((q) => q.win === p.idx && q.state === 'climb')) return true;
        this.boards[p.idx]!++;
        this.ev({ k: 'zboard', win: p.idx, add: true });
        const cap = Math.min(490, 40 + 50 * (this.round - 1));
        if (z.repairPts < cap) {
          z.repairPts += 10;
          this.addPoints(s, 10);
        }
        return true;
      }
    }
    if (!press) return true;
    switch (p.kind) {
      case 'door': {
        const d = this.meta.doors[p.idx]!;
        if (!this.spend(s, d.cost, 'door')) return true;
        this.openDoor(p.idx, s.id);
        return true;
      }
      case 'wall': {
        const w = this.meta.wallbuys[p.idx]!;
        if (!this.spend(s, p.cost, w.weapon)) return true;
        if (w.weapon === 'frag') s.grenades = 4;
        else if (w.weapon === 'bowie') {
          z.bowie = true;
          z.busyT = 1.2;
        } else {
          const owned = s.weapons.find((x) => x.def.id === w.weapon || x.def.id === `${w.weapon}_up`);
          if (owned) {
            owned.reserve = owned.def.reserve;
            owned.ammo = owned.def.mag;
          } else this.giveWeapon(s, this.gun(w.weapon));
        }
        return true;
      }
      case 'perk': {
        if (p.cost < 0) return true;
        const m = this.meta.perks[p.idx]!;
        if (!this.spend(s, p.cost, m.perk)) return true;
        z.perks.push(m.perk);
        z.busyT = 2;
        if (m.perk === 'revive' && this.solo()) this.reviveBought++;
        if (m.perk === 'jug') s.hp = Math.max(s.hp, 100);
        this.ev({ k: 'zperk', who: s.id, perk: m.perk });
        return true;
      }
      case 'box': {
        const bx = this.boxes[p.idx]!;
        if (bx.state === 'offer' && bx.user === s.id) {
          if (bx.weapon === 'monkey') z.monkeys = 3;
          else this.giveWeapon(s, this.gun(bx.weapon, true));
          this.ev({ k: 'zbox', spot: p.idx, what: 'take', weapon: bx.weapon, who: s.id });
          bx.state = 'idle';
          bx.weapon = '';
          bx.user = '';
          return true;
        }
        if (bx.state !== 'idle' || !this.spend(s, p.cost, 'box')) return true;
        this.rollBox(p.idx, s);
        return true;
      }
      case 'power': {
        this.power = true;
        this.ev({ k: 'zpower' });
        return true;
      }
      case 'pap': {
        if (this.pap.state === 'ready' && this.pap.user === s.id) {
          const up = this.gun(this.pap.weapon, true);
          const slot = s.weapons[this.pap.slot].def.id === 'zm_empty' ? this.pap.slot : s.cur;
          s.weapons[slot] = up;
          s.cur = slot;
          this.ev({ k: 'zpap', what: 'take', who: s.id, weapon: up.def.id });
          this.pap = { state: 'idle', t: 0, user: '', weapon: '', slot: 0 };
          return true;
        }
        if (p.cost < 0) return true;
        const w = s.weapons[s.cur];
        const target = zdef(w.def.id)?.zm.pap;
        if (!target || !this.spend(s, 5000, 'pap')) return true;
        this.pap = { state: 'work', t: 4.2, user: s.id, weapon: target, slot: s.cur };
        s.weapons[s.cur] = this.gun('zm_empty');
        const other = (1 - s.cur) as 0 | 1;
        if (s.weapons[other].def.id !== 'zm_empty') s.cur = other;
        this.ev({ k: 'zpap', what: 'start', who: s.id, weapon: target });
        return true;
      }
    }
    return true;
  }

  /** A new gun: into the empty slot, else it replaces the one in your hands. */
  private giveWeapon(s: Soldier, w: WeaponState): void {
    const empty = s.weapons.findIndex((x) => x.def.id === 'zm_empty');
    const slot = (empty >= 0 ? empty : s.cur) as 0 | 1;
    s.weapons[slot] = w;
    s.cur = slot;
    s.reloadT = 0;
    s.swapT = 0.5;
    s.zm!.busyT = 0.4;
  }

  openDoor(i: number, who: string): void {
    if (this.doors[i]) return;
    this.doors[i] = true;
    const box = this.doorBoxes[i]!;
    for (const lv of this.levels) lv.remove(box);
    for (const zn of this.meta.doors[i]!.zones) this.zones[zn] = true;
    this.nav = null;
    this.fields.clear();
    this.ev({ k: 'zdoor', door: i, who });
  }

  boxActive(i: number): boolean {
    return i === this.boxAt || this.game.time < this.firesale;
  }

  private rollBox(i: number, s: Soldier): void {
    const bx = this.boxes[i]!;
    this.boxUses++;
    const fire = this.game.time < this.firesale;
    // The teddy bear: after a few uses the box may up and leave (never in a fire sale).
    const bear = !fire && i === this.boxAt && this.boxUses > 3 && this.game.rand() < 0.16;
    bx.state = 'roll';
    bx.t = 4.2;
    bx.user = s.id;
    if (bear) bx.weapon = 'bear';
    else {
      const have = new Set(s.weapons.flatMap((w) => [w.def.id, w.def.id.replace(/_up$/, '')]));
      const pool: Array<[string, number]> = [...BOX_POOL.filter(([id]) => !have.has(id)), ['monkey', 7]];
      let r = this.game.rand() * pool.reduce((a, [, w]) => a + w, 0);
      bx.weapon = pool[pool.length - 1]![0];
      for (const [id, w] of pool) if ((r -= w) <= 0) {
        bx.weapon = id;
        break;
      }
    }
    this.ev({ k: 'zbox', spot: i, what: 'open', weapon: bx.weapon, who: s.id });
  }

  // ---------------------------------------------------------------- weapons on zombies

  zombieAt(id: number): Zombie | undefined {
    return this.zombies.find((z) => z.id === id);
  }

  /** Bullet / pellet / knife damage to a zombie. */
  hurt(zb: Zombie, dmg: number, by: Soldier | null, weapon: string, head: boolean, burn = false, dot = false): boolean {
    if (zb.state === 'dead' || (zb.state === 'rise' && zb.t < 0.3)) return false;
    const insta = this.game.time < this.insta;
    if (insta) dmg = Math.max(dmg, zb.hp);
    zb.hp -= dmg;
    if (burn) {
      zb.burnT = this.game.time + 4;
      zb.burnBy = by?.id ?? '';
    }
    const kill = zb.hp <= 0;
    // Burning: silent damage over time (points and a marker only for the kill).
    if (dot && !kill) return false;
    this.ev({ k: 'zhit', id: zb.id, by: by?.id ?? '', dmg: Math.round(dmg), head, kill, x: zb.x, y: zb.y + (zb.dog ? 0.6 : head ? 1.7 : 1.2), z: zb.z });
    if (by) {
      if (kill) {
        const knife = weapon === 'knife';
        const blast = weapon === 'grenade' || weapon === 'explosive';
        this.addPoints(by, knife ? 130 : blast ? 50 : head ? 100 : 50);
        by.zm!.kills++;
        by.kills++;
        if (head) {
          by.zm!.headshots++;
          by.headshots++;
        }
      } else this.addPoints(by, 10);
    }
    if (kill) this.die(zb, by, head);
    return kill;
  }

  private die(zb: Zombie, by: Soldier | null, head: boolean): void {
    const wasOutside = zb.state === 'approach' || zb.state === 'barrier';
    zb.state = 'dead';
    zb.t = 0;
    zb.head = head;
    zb.atk = 0;
    if (!by) return; // nukes don't drop power-ups
    if (this.dogRound) {
      // The last hellhound of a dog round always leaves a Max Ammo.
      if (this.toSpawn <= 0 && !this.zombies.some((q) => q !== zb && q.state !== 'dead')) this.spawnDrop(zb.x, zb.y, zb.z, 'maxammo');
      return;
    }
    // Power-ups: every time the team's earnings pass the threshold (and a small random chance).
    if (this.dropsThisRound < 4 && !wasOutside && (this.dropEarned >= this.dropAt || this.game.rand() < 0.02)) {
      if (this.dropEarned >= this.dropAt) {
        this.dropEarned = 0;
        this.dropAt *= 1.14;
      }
      this.spawnDrop(zb.x, zb.y, zb.z);
    }
  }

  /** Explosions (grenades, launchers, ray bolts): falloff from the centre, no line-of-sight walls. */
  blast(x: number, y: number, z: number, r: number, max: number, owner: string, weapon: string): void {
    const by = this.game.soldier(owner) ?? null;
    for (const zb of this.zombies) {
      if (zb.state === 'dead') continue;
      const d = Math.hypot(zb.x - x, zb.y + 1 - y, zb.z - z);
      if (d > r) continue;
      if (!this.game.level.visible(x, y + 0.3, z, zb.x, zb.y + 1, zb.z)) continue;
      const dmg = max * (1 - (d / r) * 0.75);
      const k = this.hurt(zb, dmg, by, weapon === 'grenade' ? 'grenade' : 'explosive', false);
      if (k) {
        zb.flingX = (zb.x - x) / (d || 1);
        zb.flingZ = (zb.z - z) / (d || 1);
      }
    }
  }

  /** The Thunder Cannon: everything in the cone in front of you is blown away. */
  thunder(s: Soldier, def: ZWeaponDef): void {
    const t = def.zm.thunder!;
    const e = this.game.eye(s);
    const d = [-Math.sin(s.m.yaw) * Math.cos(s.m.pitch), Math.sin(s.m.pitch), -Math.cos(s.m.yaw) * Math.cos(s.m.pitch)];
    this.ev({ k: 'zthunder', who: s.id, x: e[0], y: e[1], z: e[2], dx: d[0]!, dz: d[2]! });
    for (const zb of this.zombies) {
      if (zb.state === 'dead') continue;
      const dx = zb.x - e[0];
      const dy = zb.y + 1 - e[1];
      const dz = zb.z - e[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist > t.range) continue;
      if ((dx * d[0]! + dy * d[1]! + dz * d[2]!) / (dist || 1) < t.cos && dist > 1.5) continue;
      if (!this.game.level.visible(e[0], e[1], e[2], zb.x, zb.y + 1, zb.z)) continue;
      if (this.hurt(zb, zb.hp + 1, s, 'explosive', false)) {
        zb.flingX = (dx / (dist || 1)) * 3;
        zb.flingZ = (dz / (dist || 1)) * 3;
      }
    }
  }

  /** Knife: 150 (Bowie: 1000), a short lunge. */
  melee(s: Soldier): boolean {
    const f = [-Math.sin(s.m.yaw), -Math.cos(s.m.yaw)];
    let best: Zombie | null = null;
    let bd = 2.1;
    for (const zb of this.zombies) {
      if (zb.state === 'dead' || zb.state === 'approach') continue;
      const dx = zb.x - s.m.x;
      const dz = zb.z - s.m.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(zb.y - s.m.y) > 1.4) continue;
      if ((dx * f[0]! + dz * f[1]!) / (d || 1) < 0.5) continue;
      best = zb;
      bd = d;
    }
    if (!best) return false;
    this.hurt(best, s.zm?.bowie ? 1000 : 150, s, 'knife', false);
    return true;
  }

  // ---------------------------------------------------------------- monkeys

  throwMonkey(id: number, x: number, y: number, z: number, owner: string): void {
    this.monkeys.push({ id, x, y, z, t: 8, owner });
  }

  // ---------------------------------------------------------------- rounds

  /** Undead this round (Black Ops formula). */
  roundCount(round: number): number {
    const players = Math.max(1, this.game.soldiers.length);
    let mult = Math.max(1, round / 5);
    if (round >= 10) mult *= round * 0.15;
    let max = 24 + (players === 1 ? Math.floor(0.5 * 6 * mult) : Math.floor((players - 1) * 6 * mult));
    const early = [0.25, 0.3, 0.5, 0.7, 0.9];
    if (round <= 5) max = Math.floor(max * early[round - 1]!);
    return max;
  }

  /** Health this round: 150, +100 a round to round 9, then ×1.1 a round. */
  static health(round: number): number {
    if (round < 10) return 150 + 100 * (round - 1);
    let h = 950;
    for (let r = 10; r <= round; r++) h *= 1.1;
    return Math.round(h);
  }

  private spawnDelay(): number {
    return Math.max(0.08, 2 * Math.pow(0.95, this.round - 1));
  }

  private startRound(): void {
    this.round++;
    this.phase = 'round';
    this.dogRound = this.round === this.nextDogRound;
    if (this.dogRound) {
      this.dogRounds++;
      this.nextDogRound = this.round + 4 + Math.floor(this.game.rand() * 3);
      this.toSpawn = Math.min(24, Math.max(6, this.game.soldiers.length * 6 + (this.game.soldiers.length > 1 ? 2 : 0)));
    } else this.toSpawn = this.roundCount(this.round);
    this.spawnT = this.dogRound ? 3 : 1.5;
    this.dropsThisRound = 0;
    for (const s of this.game.soldiers) {
      const z = s.zm;
      if (!z) continue;
      z.repairPts = 0;
      // Bled out: back in at the start.
      if (z.dead) {
        s.respawnIn = 0;
        z.dead = false;
      } else if (s.alive && this.round > 1) s.grenades = Math.min(4, s.grenades + 2);
    }
    this.ev({ k: 'zround', round: this.round, dog: this.dogRound });
  }

  // ---------------------------------------------------------------- the tick

  tick(dt: number): void {
    if (this.mirror) {
      for (const s of this.game.soldiers) if (s.zm) s.zm.busyT = Math.max(0, s.zm.busyT - dt);
      return;
    }
    const g = this.game;
    if (this.phase === 'over') return;
    // Players: bleeding out, solo revives, busy hands, health.
    for (const s of g.soldiers) {
      const z = s.zm;
      if (!z) continue;
      z.busyT = Math.max(0, z.busyT - dt);
      if (!s.alive || !z.downed) continue;
      if (z.selfReviveT > 0) {
        z.selfReviveT -= dt;
        if (z.selfReviveT <= 0) this.revive(s, null);
        continue;
      }
      if (!z.reviveBy) z.bleed -= dt;
      if (z.bleed <= 0) this.bleedOut(s);
    }
    if (this.phase === 'pre' || this.phase === 'break') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.startRound();
    } else if (this.phase === 'round') {
      this.spawnT -= dt;
      const alive = this.zombies.filter((z) => z.state !== 'dead').length;
      if (this.toSpawn > 0 && this.spawnT <= 0 && alive < MAX_ALIVE) {
        if (this.spawn()) this.toSpawn--;
        this.spawnT = this.dogRound ? Math.max(0.6, 2.2 - this.dogRounds * 0.3) : this.spawnDelay();
      }
      if (this.toSpawn <= 0 && alive === 0) {
        this.phase = 'break';
        this.phaseT = 10;
        this.ev({ k: 'zroundEnd', round: this.round });
      }
    }
    this.tickZombies(dt);
    this.tickWorld(dt);
    // History for lag-compensated hits (1 s).
    const snap = new Map<number, [number, number, number, number]>();
    for (const z of this.zombies) if (z.state !== 'dead') snap.set(z.id, [z.x, z.y, z.z, z.yaw]);
    this.history.push([g.time, snap]);
    while (this.history.length > 60) this.history.shift();
  }

  /** Where a zombie was at a past time (online shots are checked against what the shooter saw). */
  poseAt(zb: Zombie, at: number | null): [number, number, number, number] {
    if (at !== null)
      for (let i = this.history.length - 1; i >= 0; i--) {
        const [t, m] = this.history[i]!;
        if (t <= at) {
          const p = m.get(zb.id);
          if (p) return p;
          break;
        }
      }
    return [zb.x, zb.y, zb.z, zb.yaw];
  }

  /**
   * Hitboxes fitted to the animated models (each box is the head / torso over that animation's
   * whole cycle, so the bob of a walk or a sprinter's hunch is covered): boxes in the zombie's own
   * frame — [side, up, forward] min / max — plus where it stands and faces.
   */
  hitboxes(zb: Zombie, at: number | null): { at: [number, number, number, number]; head: Box6; body: Box6 } {
    const [x, y, z, yaw] = this.poseAt(zb, at);
    const set = zb.dog ? HITBOX.dog : zb.male ? HITBOX.male : HITBOX.female;
    const pose: keyof typeof set =
      zb.state === 'climb' ? 'climb' : zb.state === 'barrier' ? 'tear' : zb.atk > 0 ? 'swing' : zb.v > 0.3 ? (zb.pace > 0 || zb.dog ? 'run' : 'walk') : 'idle';
    const [head, body] = set[pose];
    return { at: [x, y, z, yaw], head, body };
  }

  /** Mirror: put every zombie where it was at the render time (between two snapshots). */
  interpolate(t: number): void {
    for (const zb of this.zombies) {
      const buf = this.samples.get(zb.id);
      if (!buf || buf.length < 2) continue;
      let a = buf[0]!;
      let b = buf[buf.length - 1]!;
      if (t <= a[0]) b = a;
      else
        for (let i = 0; i < buf.length - 1; i++)
          if (buf[i]![0] <= t && buf[i + 1]![0] >= t) {
            a = buf[i]!;
            b = buf[i + 1]!;
            break;
          }
      const k = b[0] > a[0] ? Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))) : 1;
      if (Math.hypot(b[1] - a[1], b[3] - a[3]) > 3) {
        [zb.x, zb.y, zb.z, zb.yaw] = [b[1], b[2], b[3], b[4]];
        continue;
      }
      let dy = b[4] - a[4];
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      zb.x = a[1] + (b[1] - a[1]) * k;
      zb.y = a[2] + (b[2] - a[2]) * k;
      zb.z = a[3] + (b[3] - a[3]) * k;
      zb.yaw = a[4] + dy * k;
    }
  }

  private tickWorld(dt: number): void {
    const g = this.game;
    // Mystery box(es).
    this.boxes.forEach((bx, i) => {
      if (bx.state === 'idle') return;
      bx.t -= dt;
      if (bx.t > 0) return;
      if (bx.state === 'roll') {
        if (bx.weapon === 'bear') {
          bx.state = 'bear';
          bx.t = 3.5;
          // Your points back.
          const u = g.soldier(bx.user);
          if (u) this.addPoints(u, g.time < this.firesale ? 10 : 950, false);
          this.ev({ k: 'zbox', spot: i, what: 'bear', weapon: '', who: bx.user });
        } else {
          bx.state = 'offer';
          bx.t = 12;
          this.ev({ k: 'zbox', spot: i, what: 'offer', weapon: bx.weapon, who: bx.user });
        }
      } else if (bx.state === 'offer') {
        bx.state = 'idle';
        bx.weapon = '';
        bx.user = '';
      } else if (bx.state === 'bear') {
        bx.state = 'gone';
        bx.t = 5;
        this.ev({ k: 'zbox', spot: i, what: 'move', weapon: '', who: '' });
      } else if (bx.state === 'gone') {
        bx.state = 'idle';
        bx.weapon = '';
        bx.user = '';
        let next = this.boxAt;
        while (next === this.boxAt && this.meta.boxSpots.length > 1) next = Math.floor(g.rand() * this.meta.boxSpots.length);
        this.boxAt = next;
        this.boxUses = 0;
        this.boxMoved = true;
        this.ev({ k: 'zbox', spot: next, what: 'arrive', weapon: '', who: '' });
      }
    });
    // Pack-a-Punch.
    if (this.pap.state !== 'idle') {
      this.pap.t -= dt;
      if (this.pap.t <= 0) {
        if (this.pap.state === 'work') {
          this.pap.state = 'ready';
          this.pap.t = 15;
          this.ev({ k: 'zpap', what: 'ready', who: this.pap.user, weapon: this.pap.weapon });
        } else this.pap = { state: 'idle', t: 0, user: '', weapon: '', slot: 0 };
      }
    }
    // Power-ups on the ground.
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.t -= dt;
      if (d.t <= 0) {
        this.drops.splice(i, 1);
        continue;
      }
      const s = g.soldiers.find((p) => p.alive && !p.zm?.downed && Math.hypot(p.m.x - d.x, p.m.z - d.z) < 1.3 && Math.abs(p.m.y - d.y) < 1.8);
      if (!s) continue;
      this.drops.splice(i, 1);
      this.grab(d, s);
    }
    // Monkey bombs.
    for (let i = this.monkeys.length - 1; i >= 0; i--) {
      const m = this.monkeys[i]!;
      m.t -= dt;
      if (m.t <= 0) {
        this.monkeys.splice(i, 1);
        this.fields.delete(`monkey:${m.id}`);
        g.explode(m.x, m.y, m.z, 7, 0, m.owner, 'frag', 'grenade');
        this.blast(m.x, m.y, m.z, 7, 6000, m.owner, 'grenade');
      }
    }
  }

  private spawnDrop(x: number, y: number, z: number, kind?: PowerUp): void {
    if (!kind) {
      if (!this.dropBag.length) this.dropBag = [...POWERUP_LIST].sort(() => this.game.rand() - 0.5);
      kind = this.dropBag.pop()!;
      // No fire sale until the box has moved at least once.
      if (kind === 'firesale' && !this.boxMoved) kind = this.dropBag.pop() ?? 'maxammo';
    }
    this.dropsThisRound++;
    const d: Drop = { id: this.nextId++, kind, x, y: y + 0.9, z, t: 26.5 };
    this.drops.push(d);
    this.ev({ k: 'zdrop', id: d.id, kind, x, z });
  }

  private grab(d: Drop, s: Soldier): void {
    const g = this.game;
    this.ev({ k: 'zgrab', id: d.id, kind: d.kind, who: s.id });
    switch (d.kind) {
      case 'maxammo':
        for (const p of g.soldiers) {
          if (!p.zm || p.zm.dead) continue;
          const ws = p.zm.saved ? p.zm.saved.weapons : p.weapons;
          for (const w of ws) if (w.def.id !== 'zm_empty') w.reserve = w.def.reserve;
          p.grenades = Math.max(p.grenades, 4);
        }
        break;
      case 'insta':
        this.insta = g.time + POWERUPS.insta.dur;
        break;
      case 'double':
        this.double = g.time + POWERUPS.double.dur;
        break;
      case 'firesale':
        this.firesale = g.time + POWERUPS.firesale.dur;
        break;
      case 'nuke':
        for (const zb of this.zombies) if (zb.state !== 'dead' && zb.state !== 'approach') this.die(zb, null, false);
        // Window crawlers die too (they're seen burning on the way).
        for (const zb of this.zombies) if (zb.state === 'approach' || zb.state === 'barrier') this.die(zb, null, false);
        for (const p of g.soldiers) if (p.zm && !p.zm.dead) this.addPoints(p, 400, false);
        break;
      case 'carpenter':
        this.boards = this.boards.map(() => BOARDS);
        this.boards.forEach((_, i) => this.ev({ k: 'zboard', win: i, add: true }));
        for (const p of g.soldiers) if (p.zm && !p.zm.dead) this.addPoints(p, 200, false);
        break;
    }
  }

  // ---------------------------------------------------------------- spawning

  private navGrid(): NavGrid {
    if (!this.nav) {
      const [hx, hz] = this.game.map.half;
      this.nav = new NavGrid(this.game.level, hx, hz);
    }
    return this.nav;
  }

  private targets(): Soldier[] {
    return this.game.soldiers.filter((s) => s.alive && s.zm && !s.zm.downed);
  }

  private spawn(): boolean {
    const g = this.game;
    const players = this.targets();
    if (!players.length) return false;
    const nearPlayer = (x: number, z: number) => Math.min(...players.map((p) => Math.hypot(p.m.x - x, p.m.z - z)));
    if (this.dogRound) {
      // Hellhounds: lightning a little way from someone, on open ground in an open zone.
      const nav = this.navGrid();
      const p = players[Math.floor(g.rand() * players.length)]!;
      const from = nav.nearest(p.m.x, p.m.y, p.m.z);
      for (let k = 0; k < 40; k++) {
        const n = nav.nodes[nav.random(g.rand)]!;
        const d = Math.hypot(n.x - p.m.x, n.z - p.m.z);
        if (d < 8 || d > 18 || nav.component(nav.nearest(n.x, n.y, n.z)) !== nav.component(from)) continue;
        this.addZombie(n.x, n.y, n.z, true, -1, 'chase');
        return true;
      }
      return false;
    }
    const cands = this.meta.spawners.filter((sp) => this.zones[sp.zone] && nearPlayer(sp.x, sp.z) > 4 && nearPlayer(sp.x, sp.z) < 45);
    if (!cands.length) return false;
    // Closer closets are likelier (the action follows the players).
    const w = cands.map((sp) => 1 / (1 + nearPlayer(sp.x, sp.z) / 8));
    let r = g.rand() * w.reduce((a, b) => a + b, 0);
    let sp = cands[0]!;
    for (let i = 0; i < cands.length; i++) if ((r -= w[i]!) <= 0) {
      sp = cands[i]!;
      break;
    }
    this.addZombie(sp.x, 0, sp.z, false, sp.window, sp.window < 0 ? 'rise' : 'approach');
    return true;
  }

  private addZombie(x: number, y: number, z: number, dog: boolean, win: number, state: ZState): void {
    const g = this.game;
    const hp = dog ? [400, 900, 1300, 1600][Math.min(3, this.dogRounds - 1)]! : Horde.health(this.round);
    // Pace: walkers early, runners, then sprinters (move speed = round × 8, with spread).
    const ms = this.round * 8 + (g.rand() - 0.5) * 40;
    const pace: 0 | 1 | 2 = this.round <= 2 ? 0 : ms < 35 ? 0 : ms < 70 ? 1 : 2;
    const zb: Zombie = {
      id: this.nextId++,
      dog,
      male: g.rand() < 0.6,
      x,
      y: state === 'rise' ? y - 1.8 : y,
      z,
      yaw: 0,
      hp,
      maxHp: hp,
      pace: dog ? 2 : pace,
      speed: dog ? DOG_SPEED : PACES[pace]! * (0.9 + g.rand() * 0.2),
      state,
      t: 0,
      win,
      atk: 0,
      atkCd: 0,
      hitDone: false,
      target: '',
      retarget: 0,
      burnT: 0,
      burnBy: '',
      head: false,
      stuckT: 0,
      lastX: x,
      lastZ: z,
      v: 0,
      flingX: 0,
      flingZ: 0,
    };
    this.zombies.push(zb);
    if (dog || state === 'rise') this.ev({ k: 'zspawn', id: zb.id, x, z, dog });
  }

  // ---------------------------------------------------------------- flow fields

  /** Dijkstra from a point over the nav grid (distance to it from every node). */
  private field(key: string, x: number, y: number, z: number): Float32Array {
    let f = this.fields.get(key);
    if (f && this.fieldT > 0) return f;
    const nav = this.navGrid();
    const N = nav.nodes;
    f = new Float32Array(N.length).fill(Infinity);
    const start = nav.nearest(x, y, z, 1.3);
    if (start >= 0) {
      f[start] = 0;
      const heap: number[] = [start];
      const prio = (i: number) => f![i]!;
      const push = (n: number) => {
        heap.push(n);
        let i = heap.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (prio(heap[p]!) <= prio(heap[i]!)) break;
          [heap[p], heap[i]] = [heap[i]!, heap[p]!];
          i = p;
        }
      };
      const done = new Uint8Array(N.length);
      while (heap.length) {
        const top = heap[0]!;
        const last = heap.pop()!;
        if (heap.length) {
          heap[0] = last;
          let i = 0;
          for (;;) {
            const l = i * 2 + 1;
            const r = l + 1;
            let m = i;
            if (l < heap.length && prio(heap[l]!) < prio(heap[m]!)) m = l;
            if (r < heap.length && prio(heap[r]!) < prio(heap[m]!)) m = r;
            if (m === i) break;
            [heap[m], heap[i]] = [heap[i]!, heap[m]!];
            i = m;
          }
        }
        if (done[top]) continue;
        done[top] = 1;
        const a = N[top]!;
        for (const b of a.links) {
          if (done[b]) continue;
          const nb = N[b]!;
          const nd = f[top]! + (nb.x !== a.x && nb.z !== a.z ? 1.414 : 1) + Math.abs(nb.y - a.y);
          if (nd < f[b]!) {
            f[b] = nd;
            push(b);
          }
        }
      }
    }
    this.fields.set(key, f);
    return f;
  }

  // ---------------------------------------------------------------- the undead

  private tickZombies(dt: number): void {
    const g = this.game;
    this.fieldT -= dt;
    const refresh = this.fieldT <= 0;
    if (refresh) {
      this.fieldT = 0.35;
      this.fields.clear();
    }
    const players = this.targets();
    const nav = this.navGrid();
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const zb = this.zombies[i]!;
      zb.t += dt;
      if (zb.state === 'dead') {
        if (zb.t > 3) this.zombies.splice(i, 1);
        continue;
      }
      // Burning (Hades).
      if (zb.burnT > g.time && this.hurt(zb, zb.maxHp * 0.25 * dt + 30 * dt, g.soldier(zb.burnBy) ?? null, 'explosive', false, false, true)) continue;
      zb.atkCd -= dt;
      const ox = zb.x;
      const oz = zb.z;
      switch (zb.state) {
        case 'rise':
          zb.y = Math.min(0, zb.y + dt * 1.25);
          if (zb.t > 1.6) {
            zb.y = 0;
            zb.state = 'chase';
            zb.t = 0;
          }
          break;
        case 'approach':
          this.approach(zb, dt);
          break;
        case 'barrier':
          this.barrier(zb, dt, players);
          break;
        case 'climb': {
          const w = this.meta.windows[zb.win]!;
          const dur = zb.pace === 0 ? 1.6 : 1.1;
          const k = Math.min(1, zb.t / dur);
          zb.x = w.x - w.nx * 0.7 + w.nx * 1.5 * k;
          zb.z = w.z - w.nz * 0.7 + w.nz * 1.5 * k;
          zb.y = Math.sin(k * Math.PI) * 0.9;
          zb.yaw = Math.atan2(-w.nx, -w.nz);
          if (k >= 1) {
            zb.y = 0;
            zb.state = 'chase';
            zb.t = 0;
          }
          break;
        }
        case 'chase':
          this.chase(zb, dt, players, nav);
          break;
      }
      zb.v = Math.hypot(zb.x - ox, zb.z - oz) / dt;
      // Stuck for a long time inside (or wandering far from everyone): recycle into the round.
      if (zb.state === 'chase') {
        if (Math.hypot(zb.x - zb.lastX, zb.z - zb.lastZ) > 1.5) {
          zb.lastX = zb.x;
          zb.lastZ = zb.z;
          zb.stuckT = 0;
        } else if (zb.atk <= 0) zb.stuckT += dt;
        const far = !players.length || Math.min(...players.map((p) => Math.hypot(p.m.x - zb.x, p.m.z - zb.z))) > 55;
        if (zb.stuckT > 12 || (far && zb.t > 25)) {
          this.zombies.splice(i, 1);
          if (this.phase === 'round') this.toSpawn++;
        }
      }
    }
    this.separate();
    this.pushPlayers();
  }

  private approach(zb: Zombie, dt: number): void {
    const w = this.meta.windows[zb.win]!;
    // Queue: the first one at the window works on it; the rest wait behind.
    const queue = this.zombies.filter((q) => q.win === zb.win && (q.state === 'barrier' || q.state === 'climb' || (q.state === 'approach' && q.id < zb.id))).length;
    const tx = w.x - w.nx * (0.75 + queue * 0.9);
    const tz = w.z - w.nz * (0.75 + queue * 0.9);
    const dx = tx - zb.x;
    const dz = tz - zb.z;
    const d = Math.hypot(dx, dz);
    zb.yaw = Math.atan2(-(w.x - zb.x), -(w.z - zb.z));
    if (d > 0.1) {
      const step = Math.min(d, zb.speed * dt);
      zb.x += (dx / d) * step;
      zb.z += (dz / d) * step;
    }
    if (d < 0.2 && queue === 0) {
      zb.state = 'barrier';
      zb.t = 0;
    }
  }

  private barrier(zb: Zombie, dt: number, players: Soldier[]): void {
    const w = this.meta.windows[zb.win]!;
    zb.yaw = Math.atan2(w.nx, w.nz) + Math.PI;
    if (this.boards[zb.win]! <= 0) {
      zb.state = 'climb';
      zb.t = 0;
      return;
    }
    // Someone right at the window: swipe through the boards.
    const ix = w.x + w.nx * 0.6;
    const iz = w.z + w.nz * 0.6;
    const victim = players.find((p) => Math.hypot(p.m.x - ix, p.m.z - iz) < 1.25);
    if (victim) {
      this.swing(zb, victim, dt, 1.7);
      return;
    }
    zb.atk = 0;
    // Tear a board off every second or so (faster on later rounds).
    const tear = Math.max(0.55, 1.4 - this.round * 0.04);
    if (zb.t >= tear) {
      zb.t = 0;
      this.boards[zb.win]!--;
      this.ev({ k: 'zboard', win: zb.win, add: false });
    }
  }

  /** Swing at a player: the hit lands half-way through if they're still in reach. */
  private swing(zb: Zombie, p: Soldier, dt: number, reach: number): void {
    if (zb.atk <= 0) {
      if (zb.atkCd > 0) return;
      zb.atk = zb.dog ? 0.6 : 0.95;
      zb.atkCd = zb.dog ? 0.9 : 1.25;
      zb.hitDone = false;
      zb.target = p.id;
    }
    zb.atk -= dt;
    const half = zb.dog ? 0.3 : 0.48;
    if (!zb.hitDone && zb.atk <= half) {
      zb.hitDone = true;
      const t = this.game.soldier(zb.target);
      const hit = !!t && t.alive && !t.zm?.downed && Math.hypot(t.m.x - zb.x, t.m.z - zb.z) < reach && Math.abs(t.m.y - zb.y) < 1.6;
      this.ev({ k: 'zswing', id: zb.id, who: zb.target, hit });
      if (hit) {
        this.damagePlayer(t!, zb.dog ? DOG_HIT : ZOMBIE_HIT);
        (this.game.events as unknown as Array<{ k: 'hit'; by: string; target: string; dmg: number; head: boolean; kill: boolean; fx: number; fz: number }>).push({ k: 'hit', by: `z${zb.id}`, target: t!.id, dmg: zb.dog ? DOG_HIT : ZOMBIE_HIT, head: false, kill: false, fx: zb.x, fz: zb.z });
      }
    }
  }

  private chase(zb: Zombie, dt: number, players: Soldier[], nav: NavGrid): void {
    const g = this.game;
    // Swinging: hold still (a little drift towards the victim).
    if (zb.atk > 0) {
      const t = g.soldier(zb.target);
      if (t) this.swing(zb, t, dt, zb.dog ? 1.6 : 1.55);
      if (t) zb.yaw = Math.atan2(-(t.m.x - zb.x), -(t.m.z - zb.z));
      return;
    }
    // Monkey bomb: everyone goes for it.
    const monkey = this.monkeys[0];
    let goal: { x: number; y: number; z: number; key: string; soldier: Soldier | null } | null = null;
    if (monkey) goal = { x: monkey.x, y: monkey.y, z: monkey.z, key: `monkey:${monkey.id}`, soldier: null };
    else {
      zb.retarget -= dt;
      let t = g.soldier(zb.target);
      if (!t || !t.alive || t.zm?.downed || zb.retarget <= 0) {
        zb.retarget = 1.2;
        // Nearest by path.
        const node = nav.nearest(zb.x, zb.y, zb.z, 1.3);
        let best: Soldier | null = null;
        let bd = Infinity;
        for (const p of players) {
          const f = this.field(p.id, p.m.x, p.m.y, p.m.z);
          const d = node >= 0 ? f[node]! : Infinity;
          const dd = Number.isFinite(d) ? d : 999 + Math.hypot(p.m.x - zb.x, p.m.z - zb.z);
          if (dd < bd) {
            bd = dd;
            best = p;
          }
        }
        t = best ?? undefined;
        zb.target = t?.id ?? '';
      }
      if (t) goal = { x: t.m.x, y: t.m.y, z: t.m.z, key: t.id, soldier: t };
    }
    if (!goal) return;
    const dxg = goal.x - zb.x;
    const dzg = goal.z - zb.z;
    const dist = Math.hypot(dxg, dzg);
    // In reach: swing.
    if (goal.soldier && dist < (zb.dog ? 1.2 : 1.15) && Math.abs(goal.y - zb.y) < 1.5) {
      zb.yaw = Math.atan2(-dxg, -dzg);
      this.swing(zb, goal.soldier, dt, zb.dog ? 1.6 : 1.55);
      return;
    }
    if (!goal.soldier && dist < 1.2) return;
    // Direction: straight at them if close and in sight, else down the flow field.
    let mx = dxg / (dist || 1);
    let mz = dzg / (dist || 1);
    if (dist > 3.5 || !g.level.visible(zb.x, zb.y + 1.2, zb.z, goal.x, goal.y + 1.2, goal.z)) {
      const f = this.field(goal.key, goal.x, goal.y, goal.z);
      const node = nav.nearest(zb.x, zb.y, zb.z, 1.3);
      if (node >= 0) {
        let bestN = node;
        let bv = f[node]!;
        for (const l of nav.nodes[node]!.links) if (f[l]! < bv) {
          bv = f[l]!;
          bestN = l;
        }
        // Look one more step ahead to smooth the corners.
        let ahead = bestN;
        for (const l of nav.nodes[bestN]!.links) if (f[l]! < f[ahead]!) ahead = l;
        const n = nav.nodes[bestN === node ? node : ahead]!;
        const ddx = n.x - zb.x;
        const ddz = n.z - zb.z;
        const dl = Math.hypot(ddx, ddz);
        if (dl > 0.05) {
          mx = ddx / dl;
          mz = ddz / dl;
        }
        zb.y += (nav.nodes[bestN]!.y - zb.y) * Math.min(1, dt * 8);
      }
    }
    const step = zb.speed * dt;
    this.moveZ(zb, mx * step, mz * step);
    // Turn smoothly towards the heading.
    const want = Math.atan2(-mx, -mz);
    let dy = want - zb.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    zb.yaw += dy * Math.min(1, dt * 10);
  }

  private moveZ(zb: Zombie, dx: number, dz: number): void {
    const lv = this.game.level;
    const r = zb.dog ? 0.28 : 0.26;
    const free = (x: number, z: number) => !lv.blocked(x - r, zb.y + 0.45, z - r, x + r, zb.y + 1.6, z + r);
    if (free(zb.x + dx, zb.z)) zb.x += dx;
    if (free(zb.x, zb.z + dz)) zb.z += dz;
  }

  /** Zombies don't stack inside each other. */
  private separate(): void {
    const zs = this.zombies.filter((z) => z.state === 'chase');
    for (let a = 0; a < zs.length; a++) {
      const p = zs[a]!;
      for (let b = a + 1; b < zs.length; b++) {
        const q = zs[b]!;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d2 = dx * dx + dz * dz;
        const min = p.dog || q.dog ? 0.55 : 0.6;
        if (d2 > min * min || d2 < 1e-6 || Math.abs(p.y - q.y) > 1) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        this.moveZ(p, (-dx / d) * push, (-dz / d) * push);
        this.moveZ(q, (dx / d) * push, (dz / d) * push);
      }
    }
  }

  /** The horde is solid: players get pushed out of zombies (and can be boxed in). */
  private pushPlayers(): void {
    const lv = this.game.level;
    for (const s of this.game.soldiers) {
      if (!s.alive) continue;
      for (const zb of this.zombies) {
        if (zb.state !== 'chase' || Math.abs(zb.y - s.m.y) > 1.2) continue;
        const dx = s.m.x - zb.x;
        const dz = s.m.z - zb.z;
        const d = Math.hypot(dx, dz);
        const min = 0.62;
        if (d >= min || d < 1e-4) continue;
        const nx = s.m.x + (dx / d) * (min - d);
        const nz = s.m.z + (dz / d) * (min - d);
        if (!lv.blocked(nx - 0.34, s.m.y + 0.1, nz - 0.34, nx + 0.34, s.m.y + 1.7, nz + 0.34)) {
          s.m.x = nx;
          s.m.z = nz;
        }
      }
    }
  }

  // ---------------------------------------------------------------- snapshot (online)

  snap(ids: string[]): ZSnap {
    const t = this.game.time;
    return {
      r: this.round,
      ph: ['pre', 'round', 'break', 'over'].indexOf(this.phase),
      pt: +this.phaseT.toFixed(1),
      dog: this.dogRound ? 1 : 0,
      z: this.zombies.map((z) => [z.id, +z.x.toFixed(2), +z.y.toFixed(2), +z.z.toFixed(2), +z.yaw.toFixed(2), (z.dog ? 1 : 0) | (z.male ? 2 : 0) | (z.head ? 4 : 0) | (z.burnT > t ? 8 : 0) | (z.pace << 4) | (ZSTATES.indexOf(z.state) << 6), z.win, +Math.max(0, z.atk).toFixed(2), +z.t.toFixed(2), +z.flingX.toFixed(2), +z.flingZ.toFixed(2)]),
      b: this.boards,
      d: this.doors.map((d) => (d ? 1 : 0)),
      pw: this.power ? 1 : 0,
      ba: this.boxAt,
      bx: this.boxes.map((b) => [['idle', 'roll', 'offer', 'bear', 'gone'].indexOf(b.state), +b.t.toFixed(1), b.weapon, Math.max(-1, ids.indexOf(b.user))]),
      pp: [['idle', 'work', 'ready'].indexOf(this.pap.state), +this.pap.t.toFixed(1), this.pap.weapon, Math.max(-1, ids.indexOf(this.pap.user))],
      dr: this.drops.map((d) => [d.id, POWERUP_LIST.indexOf(d.kind), +d.x.toFixed(2), +d.y.toFixed(2), +d.z.toFixed(2), +d.t.toFixed(1)]),
      ac: [Math.max(0, this.insta - t), Math.max(0, this.double - t), Math.max(0, this.firesale - t)].map((v) => +v.toFixed(1)),
      rb: this.reviveBought,
      mk: this.monkeys.map((m) => [m.id, +m.x.toFixed(2), +m.y.toFixed(2), +m.z.toFixed(2), +m.t.toFixed(1)]),
      pl: this.game.soldiers.map((s, i) => {
        const z = s.zm!;
        return [i, z.points, z.perks.reduce((a, p) => a | (1 << ZPERK_LIST.indexOf(p)), 0), z.downed ? 1 : 0, +z.bleed.toFixed(1), +z.reviveP.toFixed(2), z.bowie ? 1 : 0, z.monkeys, z.kills, z.headshots, z.downs, z.revives, z.dead ? 1 : 0, +z.selfReviveT.toFixed(1), +z.busyT.toFixed(2)];
      }),
    };
  }

  /** Mirror: apply the server's snapshot. */
  apply(s: ZSnap, ids: string[], meId: string, snapT = this.game.time): void {
    const g = this.game;
    const t = g.time;
    this.round = s.r;
    this.phase = (['pre', 'round', 'break', 'over'] as const)[s.ph] ?? 'round';
    this.phaseT = s.pt;
    this.dogRound = !!s.dog;
    const old = new Map(this.zombies.map((z) => [z.id, z]));
    this.zombies = s.z.map((a) => {
      const [id, x, y, z, yaw, flags, win, atk, st, fx, fz] = a as number[];
      const was = old.get(id!);
      const zb: Zombie = was ?? ({ id: id!, hp: 1, maxHp: 1, speed: 0, target: '', retarget: 0, burnBy: '', stuckT: 0, lastX: x!, lastZ: z!, atkCd: 0, hitDone: false } as unknown as Zombie);
      zb.v = was ? Math.hypot(x! - was.x, z! - was.z) * 30 : 0;
      let buf = this.samples.get(id!);
      if (!buf) this.samples.set(id!, (buf = []));
      buf.push([snapT, x!, y!, z!, yaw!]);
      if (buf.length > 12) buf.shift();
      Object.assign(zb, { x, y, z, yaw, dog: !!(flags! & 1), male: !!(flags! & 2), head: !!(flags! & 4), burnT: flags! & 8 ? t + 1 : 0, pace: (flags! >> 4) & 3, state: ZSTATES[(flags! >> 6) & 7] ?? 'chase', win, atk: atk, t: st, flingX: fx, flingZ: fz });
      return zb;
    });
    for (const id of this.samples.keys()) if (!old.has(id) && !this.zombies.some((z) => z.id === id)) this.samples.delete(id);
    this.boards = s.b;
    s.d.forEach((open, i) => {
      if (open && !this.doors[i]) this.openDoor(i, '');
    });
    this.power = !!s.pw;
    this.boxAt = s.ba;
    s.bx.forEach(([st, bt, w, u], i) => {
      const b = this.boxes[i];
      if (!b) return;
      b.state = (['idle', 'roll', 'offer', 'bear', 'gone'] as const)[st as number] ?? 'idle';
      b.t = bt as number;
      b.weapon = w as string;
      b.user = ids[u as number] ?? '';
    });
    const [pst, ptt, pw, pu] = s.pp;
    this.pap.state = (['idle', 'work', 'ready'] as const)[pst as number] ?? 'idle';
    this.pap.t = ptt as number;
    this.pap.weapon = pw as string;
    this.pap.user = ids[pu as number] ?? '';
    this.drops = s.dr.map(([id, k, x, y, z, left]) => ({ id: id!, kind: POWERUP_LIST[k!] ?? 'maxammo', x: x!, y: y!, z: z!, t: left! }));
    this.insta = t + s.ac[0]!;
    this.double = t + s.ac[1]!;
    this.firesale = t + s.ac[2]!;
    this.reviveBought = s.rb;
    this.monkeys = s.mk.map(([id, x, y, z, left]) => ({ id: id!, x: x!, y: y!, z: z!, t: left!, owner: '' }));
    for (const row of s.pl) {
      const [i, pts, perks, downed, bleed, rp, bowie, monk, kills, hs, downs, revs, dead, srt, busy] = row;
      const sol = g.soldier(ids[i!] ?? '');
      if (!sol) continue;
      sol.zm ??= { points: 0, perks: [], downed: false, bleed: 0, dead: false, reviveBy: '', reviveP: 0, selfRevives: 0, selfReviveT: 0, bowie: false, monkeys: 0, holdT: 0, repairPts: 0, busyT: 0, saved: null, kills: 0, headshots: 0, downs: 0, revives: 0, earned: 0 };
      const z = sol.zm;
      z.points = pts!;
      z.perks = ZPERK_LIST.filter((_, k) => perks! & (1 << k));
      z.downed = !!downed;
      z.bleed = bleed!;
      z.reviveP = rp!;
      z.bowie = !!bowie;
      z.monkeys = monk!;
      z.kills = kills!;
      z.headshots = hs!;
      z.downs = downs!;
      z.revives = revs!;
      z.dead = !!dead;
      z.selfReviveT = srt!;
      if (sol.id !== meId) z.busyT = busy!;
    }
  }
}

/** Zombies part of an online snapshot. */
export interface ZSnap {
  r: number;
  ph: number;
  pt: number;
  dog: number;
  z: number[][];
  b: number[];
  d: number[];
  pw: number;
  ba: number;
  bx: Array<[number, number, string, number]>;
  pp: [number, number, string, number];
  dr: number[][];
  ac: number[];
  rb: number;
  mk: number[][];
  pl: number[][];
}

type Box6 = [number, number, number, number, number, number];
/** [head, torso] per pose, in the zombie's frame [side, up, forward] (measured at the render scale). */
const HITBOX: Record<'male' | 'female' | 'dog', Record<'idle' | 'walk' | 'run' | 'swing' | 'tear' | 'climb', [Box6, Box6]>> = {
  male: {
    idle: [[-0.32, 1.3, -0.37, 0.31, 1.97, 0.35], [-0.32, 0, -0.22, 0.32, 1.32, 0.22]],
    walk: [[-0.4, 1.22, -0.3, 0.4, 1.97, 0.36], [-0.32, 0, -0.24, 0.32, 1.26, 0.26]],
    run: [[-0.35, 1.03, -0.14, 0.39, 1.92, 0.6], [-0.32, 0, -0.2, 0.32, 1.1, 0.42]],
    swing: [[-0.3, 1.19, -0.39, 0.47, 1.89, 0.53], [-0.34, 0, -0.24, 0.36, 1.22, 0.3]],
    tear: [[-0.34, 1.12, -0.34, 0.39, 1.86, 0.56], [-0.34, 0, -0.24, 0.36, 1.16, 0.32]],
    climb: [[-0.31, 0.9, -0.34, 0.33, 2.69, 0.63], [-0.34, 0, -0.3, 0.34, 2.1, 0.4]],
  },
  female: {
    idle: [[-0.4, 1.24, -0.46, 0.4, 2.04, 0.45], [-0.32, 0, -0.22, 0.32, 1.27, 0.22]],
    walk: [[-0.49, 1.15, -0.4, 0.49, 2.03, 0.47], [-0.32, 0, -0.24, 0.32, 1.2, 0.26]],
    run: [[-0.45, 1.03, -0.25, 0.5, 1.98, 0.73], [-0.32, 0, -0.2, 0.32, 1.1, 0.42]],
    swing: [[-0.37, 1.16, -0.48, 0.57, 1.97, 0.65], [-0.34, 0, -0.24, 0.36, 1.2, 0.3]],
    tear: [[-0.44, 1.1, -0.47, 0.49, 1.92, 0.68], [-0.34, 0, -0.24, 0.36, 1.14, 0.32]],
    climb: [[-0.42, 0.87, -0.42, 0.4, 2.75, 0.75], [-0.34, 0, -0.3, 0.34, 2.1, 0.4]],
  },
  dog: {
    idle: [[-0.15, 0.46, 0.42, 0.14, 0.8, 0.77], [-0.18, 0.05, -0.82, 0.18, 0.72, 0.45]],
    walk: [[-0.17, 0.37, 0.4, 0.17, 0.81, 0.84], [-0.18, 0.05, -0.83, 0.18, 0.75, 0.42]],
    run: [[-0.17, 0.37, 0.4, 0.17, 0.81, 0.84], [-0.18, 0.05, -0.83, 0.18, 0.75, 0.42]],
    swing: [[-0.14, 0.23, 0.27, 0.21, 0.81, 0.87], [-0.2, 0.05, -0.92, 0.2, 0.72, 0.3]],
    tear: [[-0.15, 0.46, 0.42, 0.14, 0.8, 0.77], [-0.18, 0.05, -0.82, 0.18, 0.72, 0.45]],
    climb: [[-0.15, 0.46, 0.42, 0.14, 0.8, 0.77], [-0.18, 0.05, -0.82, 0.18, 0.72, 0.45]],
  },
};

/** Ray (world) against a box in a zombie's frame: distance along the ray, or −1. */
export function rayZombieBox(o: [number, number, number], d: [number, number, number], at: [number, number, number, number], b: Box6): number {
  const [x, y, z, yaw] = at;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // World → (side, up, forward): side = (cos, −sin), forward = (−sin, −cos).
  const ox = o[0] - x;
  const oz = o[2] - z;
  const ls = ox * c - oz * s;
  const lf = -ox * s - oz * c;
  const ds = d[0] * c - d[2] * s;
  const df = -d[0] * s - d[2] * c;
  let t0 = 0;
  let t1 = Infinity;
  for (const [p, v, lo, hi] of [
    [ls, ds, b[0], b[3]],
    [o[1] - y, d[1], b[1], b[4]],
    [lf, df, b[2], b[5]],
  ] as Array<[number, number, number, number]>) {
    if (Math.abs(v) < 1e-9) {
      if (p < lo || p > hi) return -1;
      continue;
    }
    let a = (lo - p) / v;
    let e = (hi - p) / v;
    if (a > e) [a, e] = [e, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, e);
    if (t0 > t1) return -1;
  }
  return t0;
}
