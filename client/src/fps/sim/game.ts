import { Level, raySphere, rayAabb } from './level';
import { MAP, type MapDef, type SpawnPoint } from './maps';
import { NO_INPUT, P, eyeHeight, height, newMove, stepMove, type Input, type MoveState } from './player';
import { WEAPON, STREAKS, applyAttachments, damageAt, type Attachments, type Loadout, type Perk, type Streak, type WeaponDef } from './weapons';

export type Mode = 'tdm' | 'ffa' | 'dom' | 'kc';
export const MODES: Record<Mode, { name: string; short: string; desc: string }> = {
  tdm: { name: 'Team Deathmatch', short: 'TDM', desc: 'First team to the kill limit wins.' },
  ffa: { name: 'Free-for-All', short: 'FFA', desc: 'Every soldier for themselves.' },
  dom: { name: 'Domination', short: 'DOM', desc: 'Capture and hold flags A, B and C.' },
  kc: { name: 'Kill Confirmed', short: 'KC', desc: 'Collect enemy dog tags to score.' },
};

export interface SoldierSetup {
  id: string;
  name: string;
  team: 0 | 1;
  bot: boolean;
  loadout: Loadout;
  /** Camo id per weapon id (cosmetic). */
  camos?: Record<string, string>;
}

export interface WeaponState {
  def: WeaponDef;
  att: Attachments;
  ammo: number;
  reserve: number;
}

export interface Soldier {
  id: string;
  name: string;
  team: 0 | 1;
  bot: boolean;
  loadout: Loadout;
  camos: Record<string, string>;
  m: MoveState;
  hp: number;
  alive: boolean;
  respawnIn: number;
  weapons: [WeaponState, WeaponState];
  cur: 0 | 1;
  /** 0..1 aim-down-sights progress. */
  adsT: number;
  nextFire: number;
  burstLeft: number;
  triggerHeld: boolean;
  reloadT: number;
  swapT: number;
  /** Sprint-out: time before you can fire after sprinting. */
  sprintOut: number;
  meleeT: number;
  grenades: number;
  cookStart: number;
  lastDamageT: number;
  spawnT: number;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  headshots: number;
  streak: number;
  bestStreak: number;
  streaks: Streak[];
  earned: Set<Streak>;
  /** Damage dealt to me this life by each attacker (assists). */
  damagers: Map<string, number>;
  lastFireT: number;
  suppressed: boolean;
  lastInput: Input;
  /** Bullets fired since trigger pull (recoil for bots). */
  shotsInBurst: number;
  /** Server-side input queue (online). */
  queue: Input[];
  ackSeq: number;
  /** Last attacker (for killcam / death screen). */
  killedBy: string;
  connected: boolean;
  /** Online human: shots arrive as messages (with their own directions), not from inputs. */
  remote: boolean;
  /** Class picked mid-match: applied at the next spawn. */
  nextLoadout?: Loadout;
}

export interface Grenade {
  id: number;
  owner: string;
  team: 0 | 1;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
  /** Airstrike bombs and barrels reuse the explosion code. */
  kind: 'frag';
}

export interface Heli {
  id: number;
  owner: string;
  team: 0 | 1;
  until: number;
  angle: number;
  x: number;
  y: number;
  z: number;
  hp: number;
  target: string;
  burst: number;
  nextShot: number;
  cooldown: number;
}

export interface Flag {
  name: string;
  x: number;
  y: number;
  z: number;
  owner: -1 | 0 | 1;
  /** −1..1: progress towards team 1 (+) or team 0 (−). */
  progress: number;
  capturing: -1 | 0 | 1;
}

export interface Tag {
  id: number;
  team: 0 | 1;
  victim: string;
  killer: string;
  x: number;
  y: number;
  z: number;
  t: number;
}

export type Medal = 'headshot' | 'doublekill' | 'triplekill' | 'longshot' | 'revenge' | 'payback' | 'firstblood' | 'bloodthirsty' | 'merciless' | 'knife' | 'grenade' | 'buzzkill' | 'collateral';

export type GameEvent =
  | { k: 'shot'; by: string; w: string; fx: number; fy: number; fz: number; hits: Array<[number, number, number, number]>; sup: boolean }
  | { k: 'hit'; by: string; target: string; dmg: number; head: boolean; kill: boolean; fx: number; fz: number }
  | { k: 'kill'; killer: string; victim: string; weapon: string; head: boolean; assist: string[]; streak: number }
  | { k: 'medal'; who: string; medal: Medal; xp: number }
  | { k: 'score'; who: string; pts: number; why: string }
  | { k: 'spawn'; who: string }
  | { k: 'reload'; who: string }
  | { k: 'empty'; who: string }
  | { k: 'melee'; who: string; hit: boolean }
  | { k: 'grenadeThrow'; who: string; id: number }
  | { k: 'explosion'; x: number; y: number; z: number; r: number; kind: 'frag' | 'barrel' | 'airstrike' }
  | { k: 'streakEarned'; who: string; streak: Streak }
  | { k: 'streakUsed'; who: string; team: 0 | 1; streak: Streak; x?: number; z?: number; dx?: number; dz?: number }
  | { k: 'heliShot'; id: number; x: number; y: number; z: number; tx: number; ty: number; tz: number }
  | { k: 'heliDown'; id: number; by: string }
  | { k: 'flag'; flag: number; team: -1 | 0 | 1; by: string[] }
  | { k: 'tag'; who: string; confirmed: boolean }
  | { k: 'over'; winner: -1 | 0 | 1; top: string }
  | { k: 'timeLeft'; s: number };

export interface GameOptions {
  mode: Mode;
  scoreLimit?: number;
  timeLimit?: number;
}

export const TICK = 1 / 60;
const RESPAWN = 3;
const REGEN_DELAY = 4;
const REGEN_RATE = 45;
const HISTORY = 60; // 1 s of positions for lag compensation

let nextId = 1;

/** Deterministic-enough PRNG for spread / spawn choice. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Game {
  readonly map: MapDef;
  readonly level: Level;
  readonly mode: Mode;
  readonly soldiers: Soldier[] = [];
  readonly score: [number, number] = [0, 0];
  readonly scoreLimit: number;
  timeLeft: number;
  phase: 'warmup' | 'play' | 'over' = 'warmup';
  warmup = 3;
  time = 0;
  tickCount = 0;
  events: GameEvent[] = [];
  grenades: Grenade[] = [];
  helis: Heli[] = [];
  flags: Flag[] = [];
  tags: Tag[] = [];
  /** Team (or player, in FFA) UAV expiry times. */
  uav = new Map<string, number>();
  airstrikes: Array<{ t: number; owner: string; team: 0 | 1; x: number; z: number; dx: number; dz: number; n: number }> = [];
  barrels: Array<{ x: number; y: number; z: number; hp: number; fuse: number; alive: boolean; box: number }> = [];
  winner: -1 | 0 | 1 = -1;
  firstBlood = false;
  private history: Array<{ t: number; pos: Map<string, [number, number, number, boolean]> }> = [];
  readonly rand: () => number;
  private domTick = 0;

  constructor(mapId: string, opts: GameOptions, setups: SoldierSetup[], seed = Date.now()) {
    this.map = MAP[mapId] ?? MAP.freight!;
    this.level = new Level(this.map.boxes);
    this.level.minX = -this.map.half[0];
    this.level.maxX = this.map.half[0];
    this.level.minZ = -this.map.half[1];
    this.level.maxZ = this.map.half[1];
    this.mode = opts.mode;
    this.rand = rng(seed);
    const n = setups.length;
    const defaults: Record<Mode, number> = { tdm: n >= 10 ? 75 : n >= 6 ? 50 : 30, ffa: n >= 8 ? 30 : 20, dom: 200, kc: n >= 10 ? 65 : 40 };
    this.scoreLimit = opts.scoreLimit ?? defaults[this.mode];
    this.timeLeft = opts.timeLimit ?? 600;
    if (this.mode === 'dom') this.flags = this.map.flags.map((f, i) => ({ name: 'ABC'[i]!, x: f.x, y: f.y, z: f.z, owner: -1, progress: 0, capturing: 0 }));
    // Explosive barrels (their collision box index, so it can be removed when they blow).
    this.map.props.forEach((p) => {
      if (!p.explosive) return;
      const bi = this.level.boxes.findIndex((b) => b.hidden && Math.abs((b.x0 + b.x1) / 2 - p.x) < 0.6 && Math.abs((b.z0 + b.z1) / 2 - p.z) < 0.6);
      this.barrels.push({ x: p.x, y: p.y, z: p.z, hp: 60, fuse: -1, alive: true, box: bi });
    });
    for (const s of setups) this.add(s);
  }

  add(s: SoldierSetup): Soldier {
    const mk = (id: string, att: Attachments): WeaponState => {
      const def = applyAttachments(WEAPON[id] ?? WEAPON.m13!, att);
      return { def, att, ammo: def.mag, reserve: def.reserve };
    };
    const sol: Soldier = {
      id: s.id,
      name: s.name,
      team: this.mode === 'ffa' ? ((this.soldiers.length % 2) as 0 | 1) : s.team,
      bot: s.bot,
      loadout: s.loadout,
      camos: s.camos ?? {},
      m: newMove(0, 0, 0, 0),
      hp: 100,
      alive: false,
      respawnIn: 0,
      weapons: [mk(s.loadout.primary, s.loadout.primaryAtt), mk(s.loadout.secondary, { optic: 'iron', muzzle: 'none', under: 'none', ammo: 'standard' })],
      cur: 0,
      adsT: 0,
      nextFire: 0,
      burstLeft: 0,
      triggerHeld: false,
      reloadT: 0,
      swapT: 0,
      sprintOut: 0,
      meleeT: 0,
      grenades: 2,
      cookStart: -1,
      lastDamageT: -99,
      spawnT: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      score: 0,
      headshots: 0,
      streak: 0,
      bestStreak: 0,
      streaks: [],
      earned: new Set(),
      damagers: new Map(),
      lastFireT: -99,
      suppressed: s.loadout.primaryAtt.muzzle === 'suppressor',
      lastInput: { ...NO_INPUT },
      shotsInBurst: 0,
      queue: [],
      ackSeq: 0,
      killedBy: '',
      connected: true,
      remote: false,
    };
    this.soldiers.push(sol);
    this.spawn(sol);
    return sol;
  }

  makeWeapon(id: string, att: Attachments): WeaponState {
    const def = applyAttachments(WEAPON[id] ?? WEAPON.m13!, att);
    return { def, att, ammo: def.mag, reserve: def.reserve };
  }

  remove(id: string): void {
    const i = this.soldiers.findIndex((s) => s.id === id);
    if (i >= 0) this.soldiers.splice(i, 1);
  }

  soldier(id: string): Soldier | undefined {
    return this.soldiers.find((s) => s.id === id);
  }

  enemies(a: Soldier, b: Soldier): boolean {
    return a.id !== b.id && (this.mode === 'ffa' || a.team !== b.team);
  }

  has(s: Soldier, perk: Perk): boolean {
    return s.loadout.perks.includes(perk);
  }

  weapon(s: Soldier): WeaponState {
    return s.weapons[s.cur];
  }

  eye(s: Soldier): [number, number, number] {
    return [s.m.x, s.m.y + eyeHeight(s.m), s.m.z];
  }

  // ---------------------------------------------------------------- spawning

  private spawn(s: Soldier): void {
    const pts: SpawnPoint[] = this.mode === 'ffa' ? this.map.ffa : [...this.map.spawns[s.team], ...this.map.ffa];
    const enemies = this.soldiers.filter((o) => o.alive && this.enemies(s, o));
    let best: SpawnPoint = pts[0]!;
    let bestScore = -Infinity;
    for (const p of pts) {
      let near = 80;
      let seen = 0;
      for (const e of enemies) {
        const d = Math.hypot(e.m.x - p.x, e.m.z - p.z);
        near = Math.min(near, d);
        // Anyone who could see you appear (any range a rifle reaches).
        if (d < 75 && Math.abs(e.m.y - p.y) < 12 && this.level.visible(e.m.x, e.m.y + 1.5, e.m.z, p.x, p.y + 1.5, p.z)) seen++;
      }
      const own = this.mode !== 'ffa' && this.map.spawns[s.team].includes(p) ? 14 : 0;
      const close = near < 10 ? 45 : near < 18 ? 20 : 0;
      const sc = Math.min(near, 40) + own - seen * 40 - close + this.rand() * 5;
      if (sc > bestScore) {
        bestScore = sc;
        best = p;
      }
    }
    // Nudge off anyone already standing there.
    let x = best.x;
    let z = best.z;
    for (let k = 0; k < 8 && this.soldiers.some((o) => o !== s && o.alive && Math.hypot(o.m.x - x, o.m.z - z) < 0.8); k++) {
      x = best.x + Math.cos(k * 1.3) * (0.9 + k * 0.3);
      z = best.z + Math.sin(k * 1.3) * (0.9 + k * 0.3);
    }
    if (s.nextLoadout) {
      s.loadout = s.nextLoadout;
      s.nextLoadout = undefined;
      s.weapons = [this.makeWeapon(s.loadout.primary, s.loadout.primaryAtt), this.makeWeapon(s.loadout.secondary, { optic: 'iron', muzzle: 'none', under: 'none', ammo: 'standard' })];
      s.suppressed = s.loadout.primaryAtt.muzzle === 'suppressor';
    }
    s.m = newMove(x, best.y, z, best.yaw);
    s.hp = 100;
    s.alive = true;
    s.cur = 0;
    s.adsT = 0;
    s.reloadT = s.swapT = s.meleeT = 0;
    s.grenades = 2;
    s.cookStart = -1;
    s.streak = 0;
    s.earned.clear();
    s.damagers.clear();
    s.spawnT = this.time;
    for (const w of s.weapons) {
      w.ammo = w.def.mag;
      w.reserve = w.def.reserve;
    }
    this.events.push({ k: 'spawn', who: s.id });
  }

  // ---------------------------------------------------------------- step

  /** Advance one tick. `inputs` = this tick's inputs for local soldiers (bots / local player). */
  step(inputs: ReadonlyMap<string, Input>): void {
    const dt = TICK;
    this.tickCount++;
    this.time += dt;
    if (this.phase === 'over') return;
    if (this.phase === 'warmup') {
      this.warmup -= dt;
      if (this.warmup <= 0) this.phase = 'play';
    } else {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) return this.finish();
    }
    for (const s of this.soldiers) {
      // Online players use their queued inputs (one per tick, catch up if behind).
      let inp = inputs.get(s.id);
      if (!inp && s.queue.length) {
        inp = s.queue.shift()!;
        if (s.queue.length > 6) s.queue.splice(0, s.queue.length - 3);
        s.ackSeq = inp.seq;
      }
      if (!inp) inp = { ...s.lastInput, fire: false, jump: false, melee: false, grenade: false, streak: false, reload: false, slot: -1, seq: s.lastInput.seq };
      if (!s.alive) {
        s.respawnIn -= dt;
        if (s.respawnIn <= 0) this.spawn(s);
        s.lastInput = inp;
        continue;
      }
      this.tickSoldier(s, inp, dt);
      s.lastInput = inp;
    }
    this.recordHistory();
    this.tickGrenades(dt);
    this.tickBarrels(dt);
    this.tickStreaks(dt);
    this.tickMode(dt);
  }

  private tickSoldier(s: Soldier, inp: Input, dt: number): void {
    const w = this.weapon(s);
    const frozen = this.phase === 'warmup';
    // Weapon swap.
    if (inp.slot >= 0 && inp.slot !== s.cur && s.swapT <= 0 && s.meleeT <= 0) {
      s.cur = inp.slot as 0 | 1;
      s.swapT = 0.55;
      s.reloadT = 0;
      s.burstLeft = 0;
    }
    s.swapT = Math.max(0, s.swapT - dt);
    s.meleeT = Math.max(0, s.meleeT - dt);
    // Reload.
    if (s.reloadT > 0) {
      s.reloadT -= dt;
      if (s.reloadT <= 0) {
        const need = w.def.mag - w.ammo;
        const take = Math.min(need, w.reserve);
        w.ammo += take;
        w.reserve -= take;
      }
    } else if ((inp.reload || (inp.fire && w.ammo === 0)) && w.ammo < w.def.mag && w.reserve > 0 && s.swapT <= 0) {
      s.reloadT = w.ammo === 0 ? w.def.reloadEmpty : w.def.reload;
      s.burstLeft = 0;
      this.events.push({ k: 'reload', who: s.id });
    }
    // ADS.
    // Aiming cancels a sprint (like CoD: hold right click while running and you raise the gun).
    const wantAds = inp.ads && s.meleeT <= 0;
    s.adsT = Math.max(0, Math.min(1, s.adsT + (wantAds ? dt / w.def.ads : -dt / (w.def.ads * 0.7))));
    // Movement.
    const lw = this.has(s, 'lightweight') ? 1.07 : 1;
    const canSprint = !inp.ads && s.adsT < 0.3 && !(inp.fire && w.ammo > 0 && s.reloadT <= 0);
    if (!frozen) stepMove(this.level, s.m, inp, dt, w.def.move * lw, canSprint, s.adsT);
    else {
      s.m.yaw = inp.yaw;
      s.m.pitch = inp.pitch;
    }
    if (s.m.sprinting) s.sprintOut = w.def.sprintOut;
    else s.sprintOut = Math.max(0, s.sprintOut - dt);
    // Health regen.
    const delay = this.has(s, 'quickfix') ? 2.5 : REGEN_DELAY;
    if (s.hp < 100 && this.time - s.lastDamageT > delay) s.hp = Math.min(100, s.hp + REGEN_RATE * dt);
    if (frozen) return;
    // Melee.
    if (inp.melee && !s.lastInput.melee && s.meleeT <= 0) this.melee(s);
    // Grenade: hold to cook, release to throw.
    if (inp.grenade && s.grenades > 0 && s.cookStart < 0 && s.swapT <= 0) s.cookStart = this.time;
    if (s.cookStart >= 0) {
      const held = this.time - s.cookStart;
      if (held >= 3.2) {
        // Cooked too long: it goes off in your hand.
        s.cookStart = -1;
        s.grenades--;
        this.explode(s.m.x, s.m.y + 1, s.m.z, 6.5, 160, s.id, 'frag', 'grenade');
      } else if (!inp.grenade) {
        this.throwGrenade(s, Math.max(0.3, 3.2 - held));
        s.cookStart = -1;
      }
    }
    // Killstreaks.
    if (inp.streak && !s.lastInput.streak && s.streaks.length) this.useStreak(s, s.streaks.shift()!);
    // Shooting.
    if (!inp.fire) {
      s.triggerHeld = false;
      if (s.burstLeft <= 0) s.shotsInBurst = 0;
    }
    if (!this.canFire(s)) return;
    const edge = inp.fire && !s.triggerHeld;
    if (w.def.mode === 'burst' && edge && w.ammo > 0 && this.time >= s.nextFire) s.burstLeft = 3;
    const wantShot = w.def.mode === 'auto' ? inp.fire : w.def.mode === 'burst' ? s.burstLeft > 0 : edge;
    if (inp.fire) s.triggerHeld = true;
    if (!wantShot || this.time < s.nextFire) return;
    if (w.ammo <= 0) {
      if (edge) this.events.push({ k: 'empty', who: s.id });
      s.burstLeft = 0;
      return;
    }
    if (!s.remote) this.fire(s, null, null);
  }

  canFire(s: Soldier): boolean {
    return s.alive && this.phase === 'play' && s.reloadT <= 0 && s.swapT <= 0 && s.meleeT <= 0 && s.sprintOut <= 0 && !s.m.sprinting && s.cookStart < 0;
  }

  /** Spread cone (half-angle, radians) right now. */
  spread(s: Soldier): number {
    const w = this.weapon(s).def;
    const moving = Math.hypot(s.m.vx, s.m.vz) > 1 ? 1.25 : 1;
    const air = s.m.onGround ? 1 : 2;
    let hip = w.hip * moving * air * (s.m.crouched ? 0.8 : 1) * (this.has(s, 'steady') ? 0.65 : 1);
    if (this.weapon(s).att.under === 'laser') hip *= 1;
    const deg = hip + (w.adsSpread - hip) * s.adsT;
    return (deg * Math.PI) / 180;
  }

  /** View direction from yaw/pitch. */
  static dir(yaw: number, pitch: number): [number, number, number] {
    const cp = Math.cos(pitch);
    return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  }

  /**
   * Fire the current weapon. Online, the shooter's client sends its pellet
   * directions and the time it was looking at (`atTime`, for lag compensation).
   */
  fire(s: Soldier, dirs: Array<[number, number, number]> | null, atTime: number | null, origin?: [number, number, number]): void {
    const ws = this.weapon(s);
    const w = ws.def;
    if (ws.ammo <= 0 || this.time < s.nextFire - 0.02) return;
    ws.ammo--;
    s.nextFire = this.time + 60 / w.rpm;
    if (w.mode === 'burst') {
      s.burstLeft--;
      if (s.burstLeft <= 0) s.nextFire = this.time + 0.32;
    }
    s.lastFireT = this.time;
    s.shotsInBurst++;
    const eye = this.eye(s);
    const o = origin && Math.hypot(origin[0] - eye[0], origin[1] - eye[1], origin[2] - eye[2]) < 1.5 ? origin : eye;
    const pellets = w.pellets ?? 1;
    const base = Game.dir(s.m.yaw, s.m.pitch);
    const spread = this.spread(s);
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < pellets; i++) {
      let d = dirs?.[i];
      // Reject impossible directions from clients (aimbot-ish deviations).
      if (d) {
        const dot = d[0] * base[0] + d[1] * base[1] + d[2] * base[2];
        if (dot < Math.cos(Math.max(spread * 1.6, 0.06) + 0.06)) d = undefined;
      }
      out.push(d ?? this.cone(base, spread));
    }
    const hits: Array<[number, number, number, number]> = [];
    const hitPlayers = new Map<string, { dmg: number; head: boolean; fx: number; fz: number }>();
    for (const d of out) {
      const r = this.trace(s, o, d, w, atTime);
      hits.push([r.x, r.y, r.z, r.target ? 1 : 0]);
      if (r.target) {
        const h = hitPlayers.get(r.target.id) ?? { dmg: 0, head: false, fx: o[0], fz: o[2] };
        h.dmg += r.dmg;
        h.head ||= r.head;
        hitPlayers.set(r.target.id, h);
      }
    }
    this.events.push({ k: 'shot', by: s.id, w: w.id, fx: o[0], fy: o[1], fz: o[2], hits, sup: s.suppressed && s.cur === 0 });
    let killsThisShot = 0;
    for (const [id, h] of hitPlayers) {
      const t = this.soldier(id);
      if (!t) continue;
      if (this.damage(t, h.dmg, s, w.id, h.head, h.fx, h.fz)) killsThisShot++;
    }
    if (killsThisShot >= 2) this.medal(s, 'collateral', 100);
  }

  private cone(d: [number, number, number], ang: number): [number, number, number] {
    if (ang <= 0) return d;
    // Random direction within a cone around d.
    const u = this.rand();
    const v = this.rand();
    // Biased towards the centre (most rounds land near the crosshair, like CoD hipfire).
    const theta = u * ang;
    const phi = v * Math.PI * 2;
    const ax = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    // Orthonormal basis.
    let px = d[1] * ax[2]! - d[2] * ax[1]!;
    let py = d[2] * ax[0]! - d[0] * ax[2]!;
    let pz = d[0] * ax[1]! - d[1] * ax[0]!;
    const pl = Math.hypot(px, py, pz);
    px /= pl;
    py /= pl;
    pz /= pl;
    const qx = d[1] * pz - d[2] * py;
    const qy = d[2] * px - d[0] * pz;
    const qz = d[0] * py - d[1] * px;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    return [d[0] * ct + (px * Math.cos(phi) + qx * Math.sin(phi)) * st, d[1] * ct + (py * Math.cos(phi) + qy * Math.sin(phi)) * st, d[2] * ct + (pz * Math.cos(phi) + qz * Math.sin(phi)) * st];
  }

  /** Positions to test against (rewound for lag compensation). */
  private posAt(t: Soldier, atTime: number | null): [number, number, number, boolean] {
    if (atTime !== null && this.history.length) {
      for (let i = this.history.length - 1; i >= 0; i--) {
        const h = this.history[i]!;
        if (h.t <= atTime) {
          const p = h.pos.get(t.id);
          if (p) return p;
          break;
        }
      }
    }
    return [t.m.x, t.m.y, t.m.z, t.m.crouched || t.m.slide > 0];
  }

  private recordHistory(): void {
    const pos = new Map<string, [number, number, number, boolean]>();
    for (const s of this.soldiers) if (s.alive) pos.set(s.id, [s.m.x, s.m.y, s.m.z, s.m.crouched || s.m.slide > 0]);
    this.history.push({ t: this.time, pos });
    if (this.history.length > HISTORY) this.history.shift();
  }

  /** One bullet: walls (with thin-wall penetration), players' hitboxes, helis, barrels. */
  private trace(s: Soldier, o: [number, number, number], d: [number, number, number], w: WeaponDef, atTime: number | null): { x: number; y: number; z: number; target: Soldier | null; dmg: number; head: boolean } {
    const maxT = 200;
    const solid = this.level.raycast(o[0], o[1], o[2], d[0], d[1], d[2], maxT, true);
    const any = this.level.raycast(o[0], o[1], o[2], d[0], d[1], d[2], solid.t);
    let best: { t: number; target: Soldier; head: boolean; limb: boolean } | null = null;
    for (const t of this.soldiers) {
      if (!t.alive || !this.enemies(s, t)) continue;
      const [x, y, z, crouched] = this.posAt(t, atTime);
      const k = crouched ? P.crouchHeight / P.height : 1;
      const headY = y + (crouched ? P.crouchEye : P.eye) + 0.05;
      const th = raySphere(o[0], o[1], o[2], d[0], d[1], d[2], x, headY, z, 0.17);
      const tb = rayAabb(o[0], o[1], o[2], d[0], d[1], d[2], x - 0.3, y + 0.95 * k, z - 0.3, x + 0.3, y + 1.5 * k, z + 0.3);
      const tl = rayAabb(o[0], o[1], o[2], d[0], d[1], d[2], x - 0.26, y, z - 0.26, x + 0.26, y + 0.95 * k, z + 0.26);
      for (const [tt, head, limb] of [
        [th, true, false],
        [tb, false, false],
        [tl, false, true],
      ] as Array<[number, boolean, boolean]>) {
        if (tt >= 0 && tt < solid.t && (!best || tt < best.t)) best = { t: tt, target: t, head, limb };
      }
    }
    // Helicopters.
    for (const h of this.helis) {
      if (this.mode !== 'ffa' && h.team === s.team) continue;
      if (h.owner === s.id) continue;
      const th = raySphere(o[0], o[1], o[2], d[0], d[1], d[2], h.x, h.y, h.z, 3);
      if (th >= 0 && th < solid.t && (!best || th < best.t)) {
        h.hp -= damageAt(w, th) * 1;
        if (h.hp <= 0) this.heliDown(h, s);
        return { x: o[0] + d[0] * th, y: o[1] + d[1] * th, z: o[2] + d[2] * th, target: null, dmg: 0, head: false };
      }
    }
    // Barrels.
    for (const b of this.barrels) {
      if (!b.alive || b.fuse >= 0) continue;
      const tb = rayAabb(o[0], o[1], o[2], d[0], d[1], d[2], b.x - 0.4, b.y, b.z - 0.4, b.x + 0.4, b.y + 1.1, b.z + 0.4);
      if (tb >= 0 && tb < solid.t && (!best || tb < best.t)) {
        b.hp -= damageAt(w, tb);
        if (b.hp <= 0) {
          b.fuse = 0.6;
          (b as unknown as { by: string }).by = s.id;
        }
        return { x: o[0] + d[0] * tb, y: o[1] + d[1] * tb, z: o[2] + d[2] * tb, target: null, dmg: 0, head: false };
      }
    }
    if (!best) return { x: o[0] + d[0] * solid.t, y: o[1] + d[1] * solid.t, z: o[2] + d[2] * solid.t, target: null, dmg: 0, head: false };
    let dmg = damageAt(w, best.t) * (best.head ? w.head : best.limb ? w.limb : 1);
    // Through a thin wall: reduced damage.
    if (any.box && any.t < best.t) dmg *= 0.55;
    return { x: o[0] + d[0] * best.t, y: o[1] + d[1] * best.t, z: o[2] + d[2] * best.t, target: best.target, dmg, head: best.head };
  }

  /** Apply damage; returns true on a kill. */
  damage(t: Soldier, dmg: number, by: Soldier | null, weapon: string, head: boolean, fx: number, fz: number): boolean {
    if (!t.alive || this.phase !== 'play') return false;
    // Spawn protection: the first moments after spawning take much less damage.
    if (this.time - t.spawnT < 1.5 && by && by.id !== t.id) dmg *= 0.3;
    t.hp -= dmg;
    t.lastDamageT = this.time;
    if (by && by.id !== t.id) t.damagers.set(by.id, (t.damagers.get(by.id) ?? 0) + dmg);
    const kill = t.hp <= 0;
    if (by) this.events.push({ k: 'hit', by: by.id, target: t.id, dmg: Math.round(dmg), head, kill, fx, fz });
    if (kill) this.kill(t, by, weapon, head);
    return kill;
  }

  private kill(t: Soldier, by: Soldier | null, weapon: string, head: boolean): void {
    t.alive = false;
    t.hp = 0;
    t.deaths++;
    t.respawnIn = RESPAWN;
    t.killedBy = by?.id ?? '';
    t.cookStart = -1;
    const victimStreak = t.streak;
    t.streak = 0;
    const assist: string[] = [];
    for (const [id, dmg] of t.damagers) {
      if (id === by?.id || dmg < 25) continue;
      const a = this.soldier(id);
      if (!a) continue;
      a.assists++;
      a.score += 25;
      assist.push(id);
      this.events.push({ k: 'score', who: id, pts: 25, why: 'Assist' });
    }
    if (by && by.id !== t.id) {
      by.kills++;
      by.streak++;
      by.bestStreak = Math.max(by.bestStreak, by.streak);
      by.score += 100;
      if (head) by.headshots++;
      this.events.push({ k: 'score', who: by.id, pts: 100, why: 'Kill' });
      if (this.mode === 'tdm') this.addScore(by.team, 1);
      if (this.mode === 'ffa') this.checkFfa(by);
      if (this.mode === 'kc') this.tags.push({ id: nextId++, team: t.team, victim: t.id, killer: by.id, x: t.m.x, y: t.m.y + 0.8, z: t.m.z, t: this.time });
      // Medals.
      if (head) this.medal(by, 'headshot', 50);
      if (!this.firstBlood) {
        this.firstBlood = true;
        this.medal(by, 'firstblood', 100);
      }
      const dist = Math.hypot(t.m.x - by.m.x, t.m.z - by.m.z);
      if (dist > 35 && weapon !== 'knife') this.medal(by, 'longshot', 50);
      if (weapon === 'knife') this.medal(by, 'knife', 50);
      if (weapon === 'grenade') this.medal(by, 'grenade', 50);
      if (victimStreak >= 3) this.medal(by, 'buzzkill', 50);
      if (by.killedBy === t.id) this.medal(by, 'payback', 50);
      const recent = (by as Soldier & { recentKills?: number[] }).recentKills ?? [];
      recent.push(this.time);
      while (recent.length && this.time - recent[0]! > 4) recent.shift();
      (by as Soldier & { recentKills?: number[] }).recentKills = recent;
      if (recent.length === 2) this.medal(by, 'doublekill', 50);
      if (recent.length === 3) this.medal(by, 'triplekill', 75);
      if (by.streak === 5) this.medal(by, 'bloodthirsty', 100);
      if (by.streak === 10) this.medal(by, 'merciless', 150);
      // Killstreaks (per life, Hardline makes them cheaper).
      const off = this.has(by, 'hardline') ? 1 : 0;
      for (const st of ['uav', 'airstrike', 'heli'] as Streak[]) {
        if (by.streak >= STREAKS[st].kills - off && !by.earned.has(st)) {
          by.earned.add(st);
          by.streaks.push(st);
          this.events.push({ k: 'streakEarned', who: by.id, streak: st });
        }
      }
      // Scavenger.
      if (this.has(by, 'scavenger')) for (const w of by.weapons) w.reserve = Math.min(w.def.reserve * 1.5, w.reserve + w.def.mag);
    }
    this.events.push({ k: 'kill', killer: by?.id ?? t.id, victim: t.id, weapon, head, assist, streak: by?.streak ?? 0 });
  }

  private medal(s: Soldier, medal: Medal, xp: number): void {
    s.score += xp;
    this.events.push({ k: 'medal', who: s.id, medal, xp });
  }

  private addScore(team: 0 | 1, n: number): void {
    this.score[team] += n;
    if (this.score[team] >= this.scoreLimit) this.finish();
  }

  private checkFfa(s: Soldier): void {
    if (s.kills >= this.scoreLimit) this.finish();
  }

  private finish(): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    const ranked = [...this.soldiers].sort((a, b) => (this.mode === 'ffa' ? b.kills - a.kills : b.score - a.score));
    this.winner = this.mode === 'ffa' ? -1 : this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
    this.events.push({ k: 'over', winner: this.winner, top: ranked[0]?.id ?? '' });
  }

  // ---------------------------------------------------------------- melee / grenades / explosions

  private melee(s: Soldier): void {
    s.meleeT = 0.7;
    s.reloadT = 0;
    const f = Game.dir(s.m.yaw, 0);
    let hit = false;
    for (const t of this.soldiers) {
      if (!t.alive || !this.enemies(s, t)) continue;
      const dx = t.m.x - s.m.x;
      const dz = t.m.z - s.m.z;
      const dy = t.m.y - s.m.y;
      const d = Math.hypot(dx, dz);
      if (d > 2.3 || Math.abs(dy) > 1.2) continue;
      if ((dx * f[0] + dz * f[2]) / (d || 1) < 0.6) continue;
      if (!this.level.visible(s.m.x, s.m.y + 1.2, s.m.z, t.m.x, t.m.y + 1.2, t.m.z)) continue;
      this.damage(t, 200, s, 'knife', false, s.m.x, s.m.z);
      hit = true;
      // Lunge.
      s.m.vx = dx * 2;
      s.m.vz = dz * 2;
      break;
    }
    this.events.push({ k: 'melee', who: s.id, hit });
  }

  private throwGrenade(s: Soldier, fuse: number): void {
    s.grenades--;
    const d = Game.dir(s.m.yaw, s.m.pitch + 0.18);
    const e = this.eye(s);
    const g: Grenade = { id: nextId++, owner: s.id, team: s.team, x: e[0] + d[0] * 0.5, y: e[1] - 0.1, z: e[2] + d[2] * 0.5, vx: d[0] * 17 + s.m.vx * 0.5, vy: d[1] * 17 + 2, vz: d[2] * 17 + s.m.vz * 0.5, fuse, kind: 'frag' };
    this.grenades.push(g);
    this.events.push({ k: 'grenadeThrow', who: s.id, id: g.id });
  }

  private tickGrenades(dt: number): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i]!;
      g.fuse -= dt;
      g.vy -= 16 * dt;
      const r = 0.07;
      for (const ax of ['x', 'y', 'z'] as const) {
        const v = ax === 'x' ? g.vx : ax === 'y' ? g.vy : g.vz;
        const old = g[ax];
        g[ax] += v * dt;
        const hitGround = ax === 'y' && g.y < r;
        if (hitGround || this.level.blocked(g.x - r, g.y - r, g.z - r, g.x + r, g.y + r, g.z + r)) {
          g[ax] = hitGround ? r : old;
          if (ax === 'x') g.vx *= -0.35;
          if (ax === 'z') g.vz *= -0.35;
          if (ax === 'y') {
            g.vy *= -0.3;
            g.vx *= 0.6;
            g.vz *= 0.6;
          }
        }
      }
      if (g.fuse <= 0) {
        this.grenades.splice(i, 1);
        this.explode(g.x, g.y, g.z, 6.5, 160, g.owner, 'frag', 'grenade');
      }
    }
  }

  /** Radial damage with line of sight. */
  explode(x: number, y: number, z: number, radius: number, max: number, owner: string, kind: 'frag' | 'barrel' | 'airstrike', weapon: string): void {
    this.events.push({ k: 'explosion', x, y, z, r: radius, kind });
    const by = this.soldier(owner) ?? null;
    let kills = 0;
    for (const t of this.soldiers) {
      if (!t.alive) continue;
      if (by && t.id !== by.id && !this.enemies(by, t)) continue;
      const cy = t.m.y + 1;
      const d = Math.hypot(t.m.x - x, cy - y, t.m.z - z);
      if (d > radius) continue;
      if (!this.level.visible(x, y + 0.2, z, t.m.x, cy, t.m.z)) continue;
      const dmg = d < radius * 0.35 ? max : max * (1 - (d - radius * 0.35) / (radius * 0.65)) * 0.7 + 10;
      if (this.damage(t, t.id === owner ? dmg * 0.6 : dmg, by, weapon, false, x, z)) kills++;
    }
    // Chain-react barrels.
    for (const b of this.barrels) if (b.alive && b.fuse < 0 && Math.hypot(b.x - x, b.z - z) < radius * 0.8) b.fuse = 0.25 + this.rand() * 0.3;
    if (by && kills >= 2) this.medal(by, 'collateral', 100);
  }

  private tickBarrels(dt: number): void {
    for (const b of this.barrels) {
      if (!b.alive || b.fuse < 0) continue;
      b.fuse -= dt;
      if (b.fuse <= 0) {
        b.alive = false;
        if (b.box >= 0) {
          const box = this.level.boxes[b.box]!;
          box.y1 = box.y0; // flatten its collision
        }
        this.explode(b.x, b.y + 0.6, b.z, 6, 150, (b as unknown as { by?: string }).by ?? '', 'barrel', 'barrel');
      }
    }
  }

  // ---------------------------------------------------------------- killstreaks

  uavFor(s: Soldier): boolean {
    const key = this.mode === 'ffa' ? s.id : `t${s.team}`;
    return (this.uav.get(key) ?? 0) > this.time;
  }

  private useStreak(s: Soldier, st: Streak): void {
    const enemies = this.soldiers.filter((o) => o.alive && this.enemies(s, o));
    if (st === 'uav') {
      const key = this.mode === 'ffa' ? s.id : `t${s.team}`;
      this.uav.set(key, Math.max(this.uav.get(key) ?? this.time, this.time) + 30);
      this.events.push({ k: 'streakUsed', who: s.id, team: s.team, streak: st });
    } else if (st === 'airstrike') {
      // Bomb the densest group of enemies (or the enemy side of the map).
      let tx = 0;
      let tz = 0;
      let best = -1;
      for (const e of enemies) {
        const n = enemies.filter((o) => Math.hypot(o.m.x - e.m.x, o.m.z - e.m.z) < 9).length;
        if (n > best) {
          best = n;
          tx = e.m.x;
          tz = e.m.z;
        }
      }
      if (best < 0) {
        tx = (s.team === 0 ? 1 : -1) * this.map.half[0] * 0.6;
        tz = 0;
      }
      const a = this.rand() * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      this.airstrikes.push({ t: this.time + 2.5, owner: s.id, team: s.team, x: tx - dx * 9, z: tz - dz * 9, dx, dz, n: 7 });
      this.events.push({ k: 'streakUsed', who: s.id, team: s.team, streak: st, x: tx, z: tz, dx, dz });
    } else {
      const r = Math.min(this.map.half[0], this.map.half[1]) * 0.55;
      this.helis.push({ id: nextId++, owner: s.id, team: s.team, until: this.time + 40, angle: this.rand() * 6.28, x: r, y: 20, z: 0, hp: 1400, target: '', burst: 0, nextShot: this.time + 3, cooldown: 0 });
      this.events.push({ k: 'streakUsed', who: s.id, team: s.team, streak: st });
    }
  }

  private tickStreaks(dt: number): void {
    // Airstrike bombs walk along their line.
    for (let i = this.airstrikes.length - 1; i >= 0; i--) {
      const a = this.airstrikes[i]!;
      if (this.time < a.t) continue;
      const k = 7 - a.n;
      this.explode(a.x + a.dx * k * 3, 0.5, a.z + a.dz * k * 3, 6.5, 170, a.owner, 'airstrike', 'airstrike');
      a.n--;
      a.t = this.time + 0.12;
      if (a.n <= 0) this.airstrikes.splice(i, 1);
    }
    // Helicopters circle and hunt.
    for (let i = this.helis.length - 1; i >= 0; i--) {
      const h = this.helis[i]!;
      if (this.time > h.until) {
        this.helis.splice(i, 1);
        continue;
      }
      const r = Math.min(this.map.half[0], this.map.half[1]) * 0.55;
      h.angle += dt * 0.18;
      h.x = Math.cos(h.angle) * r;
      h.z = Math.sin(h.angle) * r;
      h.y = 20 + Math.sin(this.time * 0.7) * 1.5;
      if (this.time < h.nextShot) continue;
      const owner = this.soldier(h.owner);
      const targets = this.soldiers.filter((t) => t.alive && t.id !== h.owner && (this.mode === 'ffa' || t.team !== h.team) && !this.has(t, 'ghost') && this.level.visible(h.x, h.y - 2, h.z, t.m.x, t.m.y + 1.2, t.m.z));
      if (!targets.length) {
        h.nextShot = this.time + 0.5;
        continue;
      }
      const t = targets.reduce((a, b) => (Math.hypot(a.m.x - h.x, a.m.z - h.z) < Math.hypot(b.m.x - h.x, b.m.z - h.z) ? a : b));
      const miss = this.rand() < 0.45;
      const tx = t.m.x + (miss ? (this.rand() - 0.5) * 3 : 0);
      const tz = t.m.z + (miss ? (this.rand() - 0.5) * 3 : 0);
      this.events.push({ k: 'heliShot', id: h.id, x: h.x, y: h.y - 1.5, z: h.z, tx, ty: t.m.y + 1, tz });
      if (!miss) this.damage(t, 26, owner ?? null, 'heli', false, h.x, h.z);
      h.burst++;
      if (h.burst >= 8) {
        h.burst = 0;
        h.nextShot = this.time + 1.6;
      } else h.nextShot = this.time + 0.1;
    }
  }

  private heliDown(h: Heli, by: Soldier): void {
    const i = this.helis.indexOf(h);
    if (i < 0) return;
    this.helis.splice(i, 1);
    by.score += 150;
    this.events.push({ k: 'heliDown', id: h.id, by: by.id });
    this.events.push({ k: 'score', who: by.id, pts: 150, why: 'Helicopter shot down' });
  }

  // ---------------------------------------------------------------- modes

  private tickMode(dt: number): void {
    if (this.phase !== 'play') return;
    if (this.mode === 'dom') {
      for (let i = 0; i < this.flags.length; i++) {
        const f = this.flags[i]!;
        const inside = this.soldiers.filter((s) => s.alive && Math.hypot(s.m.x - f.x, s.m.z - f.z) < 3.5 && Math.abs(s.m.y - f.y) < 2.5);
        const t0 = inside.filter((s) => s.team === 0).length;
        const t1 = inside.filter((s) => s.team === 1).length;
        f.capturing = 0;
        if ((t0 > 0) === (t1 > 0)) continue; // empty or contested
        const team: 0 | 1 = t0 > 0 ? 0 : 1;
        const n = team === 0 ? t0 : t1;
        if (f.owner === team) {
          f.progress = team === 1 ? 1 : -1;
          continue;
        }
        f.capturing = team === 0 ? -1 : 1;
        const rate = (dt / 5) * (1 + 0.5 * (Math.min(3, n) - 1));
        f.progress += team === 1 ? rate : -rate;
        f.progress = Math.max(-1, Math.min(1, f.progress));
        if ((team === 1 && f.progress >= 1) || (team === 0 && f.progress <= -1)) {
          f.owner = team;
          for (const s of inside) {
            s.score += 150;
            this.events.push({ k: 'score', who: s.id, pts: 150, why: `Captured ${f.name}` });
          }
          this.events.push({ k: 'flag', flag: i, team, by: inside.map((s) => s.id) });
        } else if (f.owner !== -1 && Math.abs(f.progress) < 0.02) {
          f.owner = -1;
          this.events.push({ k: 'flag', flag: i, team: -1, by: inside.map((s) => s.id) });
        }
      }
      this.domTick += dt;
      if (this.domTick >= 2.5) {
        this.domTick = 0;
        for (const f of this.flags) if (f.owner !== -1) this.addScore(f.owner, 1);
      }
    }
    if (this.mode === 'kc') {
      for (let i = this.tags.length - 1; i >= 0; i--) {
        const tag = this.tags[i]!;
        if (this.time - tag.t > 30) {
          this.tags.splice(i, 1);
          continue;
        }
        const s = this.soldiers.find((p) => p.alive && Math.hypot(p.m.x - tag.x, p.m.z - tag.z) < 1.2 && Math.abs(p.m.y + 0.8 - tag.y) < 1.5);
        if (!s) continue;
        this.tags.splice(i, 1);
        const confirmed = s.team !== tag.team;
        s.score += confirmed ? 50 : 25;
        this.events.push({ k: 'tag', who: s.id, confirmed });
        this.events.push({ k: 'score', who: s.id, pts: confirmed ? 50 : 25, why: confirmed ? 'Kill confirmed' : 'Kill denied' });
        if (confirmed) this.addScore(s.team, 1);
      }
    }
  }
}

export { height, eyeHeight };
