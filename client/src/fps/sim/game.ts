import { Level, raySphere, rayAabb } from './level';
import { MAP, type MapDef, type SpawnPoint } from './maps';
import { NO_INPUT, P, eyeHeight, height, newMove, stepMove, type Input, type MoveState } from './player';
import { WEAPON, STREAKS, LETHALS, TACTICALS, applyAttachments, damageAt, fixLoadout, type Attachments, type Loadout, type Perk, type Streak, type WeaponDef } from './weapons';
import { NavGrid } from './nav';
import { Horde, rayZombieBox, type ZEvent, type ZPlayer } from './horde';
import { zdef } from './zweapons';
import { ZMAP } from './maps';

export type Mode = 'tdm' | 'ffa' | 'dom' | 'kc' | 'zombies';
export const MODES: Record<Mode, { name: string; short: string; desc: string }> = {
  tdm: { name: 'Team Deathmatch', short: 'TDM', desc: 'First team to the kill limit wins.' },
  ffa: { name: 'Free-for-All', short: 'FFA', desc: 'Every soldier for themselves.' },
  dom: { name: 'Domination', short: 'DOM', desc: 'Capture and hold flags A, B and C.' },
  kc: { name: 'Kill Confirmed', short: 'KC', desc: 'Collect enemy dog tags to score.' },
  zombies: { name: 'Zombies', short: 'ZM', desc: 'Survive endless rounds of the undead.' },
};
/** The multiplayer modes (Zombies has its own menu). */
export const MP_MODES = (Object.keys(MODES) as Mode[]).filter((m) => m !== 'zombies');

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
  /** Lethal / tactical equipment left this life. */
  grenades: number;
  tacticals: number;
  cookStart: number;
  /** Flashed until / stunned until (game time). */
  blindT: number;
  stunT: number;
  /** Id of the killstreak unit this soldier is piloting (0 = none). */
  ctrl: number;
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
  /** Round-trip time in ms (online humans; from the server's scoreboard). */
  ping?: number;
  /** Zombies: points, perks, last stand. */
  zm?: ZPlayer;
  /** Length of the reload in progress (perks change it). */
  reloadLen?: number;
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
  kind: NadeKind;
  /** Semtex stuck to a soldier (their id) or a wall (rest). */
  stuck?: string;
  rest?: boolean;
}

export type NadeKind = 'frag' | 'semtex' | 'molotov' | 'tknife' | 'flash' | 'stun' | 'smoke' | 'monkey';
export const NADE_KINDS: NadeKind[] = ['frag', 'semtex', 'molotov', 'tknife', 'flash', 'stun', 'smoke', 'monkey'];

/** Killstreak hardware on the ground / in the air. */
export type UnitKind = 'rcxd' | 'drone' | 'sentry' | 'dog' | 'gunner';
export const UNIT_KINDS: UnitKind[] = ['rcxd', 'drone', 'sentry', 'dog', 'gunner'];
export interface Unit {
  id: number;
  kind: UnitKind;
  owner: string;
  team: 0 | 1;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  hp: number;
  until: number;
  nextShot: number;
  /** Dogs: current target and path. */
  target: string;
  path: number[];
  repath: number;
  /** Gunship orbit angle. */
  angle: number;
  /** Seconds stuck (RC-XD autopilot). */
  stuckT: number;
}
export const UNIT_HP: Record<UnitKind, number> = { rcxd: 40, drone: 60, sentry: 350, dog: 70, gunner: 2200 };
const UNIT_R: Record<UnitKind, [number, number]> = { rcxd: [0.5, 0.25], drone: [0.6, 0], sentry: [0.7, 0.8], dog: [0.55, 0.5], gunner: [4, 0] };
export const UNIT_NAMES: Record<UnitKind, string> = { rcxd: 'RC-XD', drone: 'Recon Drone', sentry: 'Sentry Gun', dog: 'Attack Dog', gunner: 'Chopper Gunner' };

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

export type Medal = 'headshot' | 'doublekill' | 'triplekill' | 'longshot' | 'revenge' | 'payback' | 'firstblood' | 'bloodthirsty' | 'merciless' | 'knife' | 'grenade' | 'buzzkill' | 'collateral' | 'stuck' | 'tknife' | 'destroyer';

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
  | { k: 'grenadeThrow'; who: string; id: number; kind: NadeKind }
  | { k: 'explosion'; x: number; y: number; z: number; r: number; kind: 'frag' | 'barrel' | 'airstrike' | 'semtex' | 'rcxd' | 'flash' | 'stun' | 'smoke' | 'molotov' | 'ray' | 'ray2' }
  | { k: 'unitShot'; id: number; x: number; y: number; z: number; tx: number; ty: number; tz: number }
  | { k: 'unitDown'; id: number; kind: UnitKind; by: string }
  | { k: 'bite'; id: number; x: number; z: number }
  | { k: 'flashed'; who: string; amount: number }
  | { k: 'stunned'; who: string; amount: number }
  | { k: 'streakEarned'; who: string; streak: Streak }
  | { k: 'streakUsed'; who: string; team: 0 | 1; streak: Streak; x?: number; z?: number; dx?: number; dz?: number }
  | { k: 'heliShot'; id: number; x: number; y: number; z: number; tx: number; ty: number; tz: number }
  | { k: 'heliDown'; id: number; by: string }
  | { k: 'flag'; flag: number; team: -1 | 0 | 1; by: string[] }
  | { k: 'tag'; who: string; confirmed: boolean }
  | { k: 'over'; winner: -1 | 0 | 1; top: string }
  /** Online: someone joined mid-match (replacing `removed`, a bot, if any). */
  | { k: 'joined'; who: SoldierSetup; removed: string }
  | { k: 'timeLeft'; s: number }
  | ZEvent;

export interface GameOptions {
  mode: Mode;
  scoreLimit?: number;
  timeLimit?: number;
  /** Online client mirror: zombies state comes from snapshots, never simulated. */
  mirror?: boolean;
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
  units: Unit[] = [];
  smokes: Array<{ id: number; x: number; y: number; z: number; t0: number; until: number }> = [];
  fires: Array<{ id: number; x: number; y: number; z: number; r: number; until: number; owner: string }> = [];
  /** Counter-UAV expiry per team key (jams everyone else's minimap). */
  cuav = new Map<string, number>();
  /** Recon-drone marks: team key → soldier id → expiry. */
  marks = new Map<string, Map<string, number>>();
  private nav: NavGrid | null = null;
  barrels: Array<{ x: number; y: number; z: number; hp: number; fuse: number; alive: boolean; box: number }> = [];
  winner: -1 | 0 | 1 = -1;
  firstBlood = false;
  private history: Array<{ t: number; pos: Map<string, [number, number, number, boolean]> }> = [];
  readonly rand: () => number;
  private domTick = 0;
  /** Zombies mode director (null in multiplayer modes). */
  horde: Horde | null = null;

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
    const defaults: Record<Mode, number> = { tdm: n >= 10 ? 75 : n >= 6 ? 50 : 30, ffa: n >= 8 ? 30 : 20, dom: 200, kc: n >= 10 ? 65 : 40, zombies: Infinity };
    this.scoreLimit = opts.scoreLimit ?? defaults[this.mode];
    this.timeLeft = opts.timeLimit ?? 600;
    if (this.mode === 'dom') this.flags = this.map.flags.map((f, i) => ({ name: 'ABC'[i]!, x: f.x, y: f.y, z: f.z, owner: -1, progress: 0, capturing: 0 }));
    // Explosive barrels (their collision box index, so it can be removed when they blow).
    this.map.props.forEach((p) => {
      if (!p.explosive) return;
      const bi = this.level.boxes.findIndex((b) => b.hidden && Math.abs((b.x0 + b.x1) / 2 - p.x) < 0.6 && Math.abs((b.z0 + b.z1) / 2 - p.z) < 0.6);
      this.barrels.push({ x: p.x, y: p.y, z: p.z, hp: 60, fuse: -1, alive: true, box: bi });
    });
    if (this.mode === 'zombies') {
      this.horde = new Horde(this, ZMAP[this.map.id] ?? ZMAP.nachtkino!);
      this.horde.mirror = !!opts.mirror;
      this.timeLeft = Infinity;
      this.warmup = 0;
    }
    for (const s of setups) this.add(s);
  }

  add(setup: SoldierSetup): Soldier {
    const s = { ...setup, loadout: fixLoadout(setup.loadout) };
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
      grenades: LETHALS[s.loadout.lethal].count,
      tacticals: TACTICALS[s.loadout.tactical].count,
      cookStart: -1,
      blindT: 0,
      stunT: 0,
      ctrl: 0,
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
    if (this.horde) {
      sol.team = 0;
      this.horde.initPlayer(sol);
    }
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
    // Nudge off anyone already standing there: sideways along the spawn's facing (never into someone's view), then behind.
    let x = best.x;
    let z = best.z;
    const rx = Math.cos(best.yaw);
    const rz = -Math.sin(best.yaw);
    for (let k = 1; k <= 8 && this.soldiers.some((o) => o !== s && o.alive && Math.hypot(o.m.x - x, o.m.z - z) < 0.8); k++) {
      const side = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.1;
      const back = k > 6 ? 1.2 : 0;
      x = best.x + rx * side + Math.sin(best.yaw) * back;
      z = best.z + rz * side + Math.cos(best.yaw) * back;
      const [hx, hz] = this.map.half;
      if (Math.abs(x) > hx - 0.6 || Math.abs(z) > hz - 0.6 || this.level.blocked(x - P.radius, best.y + 0.1, z - P.radius, x + P.radius, best.y + P.height, z + P.radius)) {
        x = best.x;
        z = best.z;
      }
    }
    if (s.nextLoadout) {
      s.loadout = fixLoadout(s.nextLoadout);
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
    s.grenades = LETHALS[s.loadout.lethal].count;
    s.tacticals = TACTICALS[s.loadout.tactical].count;
    s.cookStart = -1;
    s.blindT = s.stunT = 0;
    s.ctrl = 0;
    s.streak = 0;
    s.earned.clear();
    s.damagers.clear();
    s.spawnT = this.time;
    for (const w of s.weapons) {
      w.ammo = w.def.mag;
      w.reserve = w.def.reserve;
    }
    this.horde?.onSpawn(s);
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
        // Keep the buffer short: every input waiting here is latency (a tick each).
        if (s.queue.length > 2) s.queue.splice(0, s.queue.length - 1);
        s.ackSeq = inp.seq;
      }
      if (!inp) inp = { ...s.lastInput, fire: false, jump: false, melee: false, grenade: false, tactical: false, streak: -1, reload: false, slot: -1, seq: s.lastInput.seq };
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
    this.tickUnits(dt);
    this.tickAreas(dt);
    this.tickMode(dt);
    this.horde?.tick(dt);
  }

  private tickSoldier(s: Soldier, inp: Input, dt: number): void {
    // Piloting a killstreak: the input drives the unit, the soldier stands still.
    if (s.ctrl) {
      const u = this.units.find((x) => x.id === s.ctrl);
      if (!u || u.owner !== s.id) s.ctrl = 0;
      else {
        (u as Unit & { inp?: Input }).inp = inp;
        stepMove(this.level, s.m, { ...NO_INPUT, yaw: s.m.yaw, pitch: s.m.pitch }, dt, 1, false, 0);
        s.adsT = 0;
        s.cookStart = -1;
        // Knife key bails out of a drone / gunship early.
        if (inp.melee && !s.lastInput.melee && u.kind !== 'rcxd') this.removeUnit(u, '');
        return;
      }
    }
    // Zombies: the use button (buy / rebuild / revive) and last-stand limits.
    let zSpeed = 1;
    if (this.horde) {
      const adj = this.horde.adjust(s, inp);
      inp = adj.inp;
      zSpeed = adj.speed;
      if (s.zm?.downed) s.m.crouched = true;
      if (this.horde.interact(s, inp, dt)) inp = { ...inp, reload: false };
      // Tactical in zombies: the Clockwork Monkey.
      if (inp.tactical && !s.lastInput.tactical && s.zm && s.zm.monkeys > 0 && !s.zm.downed) {
        s.zm.monkeys--;
        this.throwGrenade(s, 'monkey', 99);
      }
      inp = { ...inp, tactical: false };
    }
    const w = this.weapon(s);
    const frozen = this.phase === 'warmup';
    // Weapon swap.
    if (inp.slot >= 0 && inp.slot !== s.cur && s.swapT <= 0 && s.meleeT <= 0 && s.weapons[inp.slot as 0 | 1].def.id !== 'zm_empty') {
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
      s.reloadT = (w.ammo === 0 ? w.def.reloadEmpty : w.def.reload) * (this.horde?.reloadMul(s) ?? 1);
      s.reloadLen = s.reloadT;
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
    const stun = this.time < s.stunT ? 0.5 : 1;
    if (!frozen) stepMove(this.level, s.m, inp, dt, w.def.move * lw * stun * zSpeed, canSprint && stun === 1, s.adsT);
    else {
      s.m.yaw = inp.yaw;
      s.m.pitch = inp.pitch;
    }
    if (s.m.sprinting) s.sprintOut = w.def.sprintOut;
    else s.sprintOut = Math.max(0, s.sprintOut - dt);
    // Health regen.
    // Zombies: health comes back quickly (and up to 250 with the red perk); never while downed.
    const maxHp = this.horde?.maxHp(s) ?? 100;
    const delay = this.horde ? 2.4 : this.has(s, 'quickfix') ? 2.5 : REGEN_DELAY;
    if (s.hp < maxHp && this.time - s.lastDamageT > delay && !s.zm?.downed) s.hp = Math.min(maxHp, s.hp + (this.horde ? 70 : REGEN_RATE) * dt);
    if (frozen) return;
    // Melee.
    if (inp.melee && !s.lastInput.melee && s.meleeT <= 0) this.melee(s);
    // Lethal: a frag is held to cook and thrown on release; everything else goes on the press.
    const lethal = s.loadout.lethal;
    if (lethal === 'frag') {
      if (inp.grenade && s.grenades > 0 && s.cookStart < 0 && s.swapT <= 0) s.cookStart = this.time;
      if (s.cookStart >= 0) {
        const held = this.time - s.cookStart;
        if (held >= 3.2) {
          // Cooked too long: it goes off in your hand.
          s.cookStart = -1;
          s.grenades--;
          this.explode(s.m.x, s.m.y + 1, s.m.z, 6.5, 160, s.id, 'frag', 'grenade');
        } else if (!inp.grenade) {
          this.throwGrenade(s, 'frag', Math.max(0.3, 3.2 - held));
          s.grenades--;
          s.cookStart = -1;
        }
      }
    } else if (inp.grenade && !s.lastInput.grenade && s.grenades > 0 && s.swapT <= 0) {
      this.throwGrenade(s, lethal, lethal === 'semtex' ? 2 : 99);
      s.grenades--;
    }
    // Tactical.
    if (inp.tactical && !s.lastInput.tactical && s.tacticals > 0 && s.swapT <= 0 && s.cookStart < 0) {
      const t = s.loadout.tactical;
      this.throwGrenade(s, t, t === 'smoke' ? 1.6 : 1.4);
      s.tacticals--;
    }
    // Killstreaks: a slot (0–2) or the next ready one (3).
    if (inp.streak >= 0 && s.lastInput.streak < 0 && s.streaks.length) {
      const want = inp.streak === 3 ? s.streaks[0]! : s.loadout.streaks[inp.streak];
      if (want && s.streaks.includes(want) && !(STREAKS[want].pilot && s.ctrl)) {
        s.streaks.splice(s.streaks.indexOf(want), 1);
        this.useStreak(s, want);
        if (s.ctrl) return;
      }
    }
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
    if (s.zm && (s.zm.busyT > 0 || s.zm.holdT > 0 || this.weapon(s).def.id === 'zm_empty')) return false;
    return s.alive && !s.ctrl && this.phase === 'play' && s.reloadT <= 0 && s.swapT <= 0 && s.meleeT <= 0 && s.sprintOut <= 0 && !s.m.sprinting && s.cookStart < 0;
  }

  /** Spread cone (half-angle, radians) right now. */
  spread(s: Soldier): number {
    const w = this.weapon(s).def;
    const moving = Math.hypot(s.m.vx, s.m.vz) > 1 ? 1.25 : 1;
    const air = s.m.onGround ? 1 : 2;
    // The tac laser is already in the def (applyAttachments: hip × 0.7).
    const hip = w.hip * moving * air * (s.m.crouched ? 0.8 : 1) * (this.has(s, 'steady') ? 0.65 : 1);
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
    s.nextFire = this.time + 60 / (w.rpm * (this.horde?.rofMul(s) ?? 1));
    if (w.mode === 'burst') {
      s.burstLeft--;
      if (s.burstLeft <= 0) s.nextFire = this.time + 0.32;
    }
    s.lastFireT = this.time;
    s.shotsInBurst++;
    const eye = this.eye(s);
    const o = origin && Math.hypot(origin[0] - eye[0], origin[1] - eye[1], origin[2] - eye[2]) < 1.5 ? origin : eye;
    const zd = this.horde ? zdef(w.id) : undefined;
    if (zd?.zm.thunder) {
      this.events.push({ k: 'shot', by: s.id, w: w.id, fx: o[0], fy: o[1], fz: o[2], hits: [], sup: false });
      if (!this.horde!.mirror) this.horde!.thunder(s, zd);
      return;
    }
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
    const hitZombies = new Map<number, { dmg: number; head: boolean }>();
    for (const d of out) {
      const r = this.trace(s, o, d, w, atTime);
      hits.push([r.x, r.y, r.z, r.target || r.zombie ? 1 : 0]);
      if (r.zombie) {
        const h = hitZombies.get(r.zombie) ?? { dmg: 0, head: false };
        h.dmg += r.dmg;
        h.head ||= r.head;
        hitZombies.set(r.zombie, h);
      }
      // Explosive rounds (launchers, the Ray Gun, Mustang & Sally): splash where they land.
      if (zd?.zm.splash && this.horde && !this.horde.mirror) {
        const sp = zd.zm.splash;
        const bx = r.x - d[0] * 0.3;
        const by = r.y - d[1] * 0.3;
        const bz = r.z - d[2] * 0.3;
        const ray = zd.zm.proj === 'ray' || zd.zm.proj === 'ray2';
        this.events.push({ k: 'explosion', x: bx, y: by, z: bz, r: sp.r, kind: ray ? (zd.zm.proj as 'ray' | 'ray2') : 'frag' });
        this.horde.blast(bx, by, bz, sp.r, sp.dmg, s.id, 'explosive');
        const self = Math.hypot(s.m.x - bx, s.m.y + 1 - by, s.m.z - bz);
        if (sp.self && self < sp.r) this.horde.damagePlayer(s, sp.self * (1 - self / sp.r));
      }
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
    if (this.horde && !this.horde.mirror)
      for (const [id, h] of hitZombies) {
        const zb = this.horde.zombieAt(id);
        if (zb) this.horde.hurt(zb, h.dmg, s, w.id, h.head, !!zd?.zm.burn);
      }
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
  private trace(s: Soldier, o: [number, number, number], d: [number, number, number], w: WeaponDef, atTime: number | null): { x: number; y: number; z: number; target: Soldier | null; dmg: number; head: boolean; zombie?: number } {
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
    // The undead (head, torso, legs; hellhounds: head + body).
    if (this.horde) {
      let zbest: { t: number; id: number; head: boolean } | null = null;
      for (const zb of this.horde.zombies) {
        if (zb.state === 'dead' || (zb.state === 'rise' && zb.y < -1)) continue;
        if (Math.abs(zb.x - o[0]) > 80 || Math.abs(zb.z - o[2]) > 80) continue;
        // Where the shooter saw it (online), with the head where the animation puts it.
        const hb = this.horde.hitboxes(zb, atTime);
        const th = rayZombieBox(o, d, hb.at, hb.head);
        const tb = rayZombieBox(o, d, hb.at, hb.body);
        for (const [tt, head] of [
          [th, true],
          [tb, false],
        ] as Array<[number, boolean]>) {
          if (tt >= 0 && tt < solid.t && (!best || tt < best.t) && (!zbest || tt < zbest.t)) zbest = { t: tt, id: zb.id, head };
        }
      }
      if (zbest) {
        const dmg = damageAt(w, zbest.t) * (zbest.head ? w.head : 1);
        return { x: o[0] + d[0] * zbest.t, y: o[1] + d[1] * zbest.t, z: o[2] + d[2] * zbest.t, target: null, dmg, head: zbest.head, zombie: zbest.id };
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
    // Killstreak hardware.
    for (const u of this.units) {
      if (u.owner === s.id || (this.mode !== 'ffa' && u.team === s.team)) continue;
      const [rad, dy] = UNIT_R[u.kind];
      const tu = raySphere(o[0], o[1], o[2], d[0], d[1], d[2], u.x, u.y + dy, u.z, rad);
      if (tu >= 0 && tu < solid.t && (!best || tu < best.t)) {
        this.hurtUnit(u, damageAt(w, tu), s);
        return { x: o[0] + d[0] * tu, y: o[1] + d[1] * tu, z: o[2] + d[2] * tu, target: null, dmg: 0, head: false };
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
    // Zombies: no friendly fire; your own explosives hurt (you go down, not die).
    if (this.horde) return by && by.id !== t.id ? false : this.horde.damagePlayer(t, dmg);
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
    // Dying ends any piloted streak (an RC-XD / drone / gunship without a pilot is lost).
    if (t.ctrl) {
      const u = this.units.find((x) => x.id === t.ctrl);
      if (u) this.removeUnit(u, '');
      t.ctrl = 0;
    }
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
      if (weapon === 'grenade' || weapon === 'semtex') this.medal(by, 'grenade', 50);
      if (weapon === 'tknife') this.medal(by, 'tknife', 75);
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
      for (const st of by.loadout.streaks) {
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
    if (this.horde) {
      hit = this.horde.mirror ? false : this.horde.melee(s);
      this.events.push({ k: 'melee', who: s.id, hit });
      return;
    }
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

  private throwGrenade(s: Soldier, kind: NadeKind, fuse: number): void {
    const knife = kind === 'tknife';
    const d = Game.dir(s.m.yaw, s.m.pitch + (knife ? 0.02 : 0.18));
    const v = knife ? 32 : kind === 'molotov' ? 15 : 17;
    const e = this.eye(s);
    const g: Grenade = { id: nextId++, owner: s.id, team: s.team, x: e[0] + d[0] * 0.5, y: e[1] - 0.1, z: e[2] + d[2] * 0.5, vx: d[0] * v + s.m.vx * 0.5, vy: d[1] * v + (knife ? 0.5 : 2), vz: d[2] * v + s.m.vz * 0.5, fuse, kind };
    this.grenades.push(g);
    this.events.push({ k: 'grenadeThrow', who: s.id, id: g.id, kind });
  }

  private tickGrenades(dt: number): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i]!;
      g.fuse -= dt;
      // Semtex on someone: rides along.
      if (g.stuck) {
        const t = this.soldier(g.stuck);
        if (t && t.alive) {
          g.x = t.m.x;
          g.y = t.m.y + 1.2;
          g.z = t.m.z;
        } else g.stuck = undefined;
      }
      if (g.rest || g.stuck) {
        if (g.fuse <= 0) {
          this.grenades.splice(i, 1);
          this.detonate(g);
        }
        continue;
      }
      g.vy -= (g.kind === 'tknife' ? 9 : 16) * dt;
      // Knives and semtex check bodies along the way.
      if (g.kind === 'tknife' || g.kind === 'semtex') {
        const t = this.soldiers.find((o) => o.alive && o.id !== g.owner && (this.mode === 'ffa' || o.team !== g.team) && Math.hypot(o.m.x - g.x, o.m.z - g.z) < 0.45 && g.y > o.m.y && g.y < o.m.y + height(o.m) + 0.1);
        if (t) {
          if (g.kind === 'tknife') {
            this.grenades.splice(i, 1);
            this.damage(t, 200, this.soldier(g.owner) ?? null, 'tknife', g.y > t.m.y + height(t.m) - 0.3, g.x, g.z);
            continue;
          }
          g.stuck = t.id;
          const by = this.soldier(g.owner);
          if (by) this.medal(by, 'stuck', 50);
          continue;
        }
      }
      const r = 0.07;
      let hit = false;
      for (const ax of ['x', 'y', 'z'] as const) {
        const v = ax === 'x' ? g.vx : ax === 'y' ? g.vy : g.vz;
        const old = g[ax];
        g[ax] += v * dt;
        const hitGround = ax === 'y' && g.y < r;
        if (hitGround || this.level.blocked(g.x - r, g.y - r, g.z - r, g.x + r, g.y + r, g.z + r)) {
          hit = true;
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
      // The Clockwork Monkey lands and starts singing (the horde takes it from here).
      if (hit && g.kind === 'monkey' && Math.abs(g.vy) < 1.5) {
        this.grenades.splice(i, 1);
        if (this.horde && !this.horde.mirror) this.horde.throwMonkey(g.id, g.x, g.y, g.z, g.owner);
        continue;
      }
      // Semtex sticks, a molotov shatters, a knife drops dead.
      if (hit && g.kind === 'semtex') g.rest = true;
      if (hit && (g.kind === 'molotov' || g.kind === 'tknife')) g.fuse = 0;
      if (g.fuse <= 0 || g.y < -5) {
        this.grenades.splice(i, 1);
        if (g.kind !== 'tknife') this.detonate(g);
      }
    }
  }

  private detonate(g: Grenade): void {
    const by = this.soldier(g.owner) ?? null;
    switch (g.kind) {
      case 'frag':
        return this.explode(g.x, g.y, g.z, 6.5, 160, g.owner, 'frag', 'grenade');
      case 'semtex':
        return this.explode(g.x, g.y, g.z, 5.5, 170, g.owner, 'semtex', 'semtex');
      case 'molotov': {
        const y = this.level.floorAt(g.x, g.z, g.y + 0.3);
        this.fires.push({ id: nextId++, x: g.x, y, z: g.z, r: 3.4, until: this.time + 7, owner: g.owner });
        this.events.push({ k: 'explosion', x: g.x, y: y + 0.2, z: g.z, r: 3.4, kind: 'molotov' });
        return;
      }
      case 'smoke':
        this.smokes.push({ id: nextId++, x: g.x, y: Math.max(g.y, this.level.floorAt(g.x, g.z, g.y + 0.3)) + 1.6, z: g.z, t0: this.time, until: this.time + 15 });
        this.events.push({ k: 'explosion', x: g.x, y: g.y, z: g.z, r: 1, kind: 'smoke' });
        return;
      case 'flash':
      case 'stun': {
        this.events.push({ k: 'explosion', x: g.x, y: g.y, z: g.z, r: g.kind === 'flash' ? 2 : 1.5, kind: g.kind });
        const range = g.kind === 'flash' ? 20 : 10;
        for (const t of this.soldiers) {
          if (!t.alive || (by && t.id !== by.id && !this.enemies(by, t))) continue;
          const e = this.eye(t);
          const dx = g.x - e[0];
          const dy = g.y + 0.2 - e[1];
          const dz = g.z - e[2];
          const d = Math.hypot(dx, dy, dz);
          if (d > range || !this.sees(g.x, g.y + 0.2, g.z, e[0], e[1], e[2])) continue;
          const look = Game.dir(t.m.yaw, t.m.pitch);
          const facing = (look[0] * dx + look[1] * dy + look[2] * dz) / (d || 1);
          const self = by && t.id === by.id ? 0.5 : 1;
          if (g.kind === 'flash') {
            const amount = Math.min(1, (1 - d / range) * 1.4 * (0.3 + 0.7 * Math.max(0, facing)) * self);
            if (amount < 0.08) continue;
            t.blindT = Math.max(t.blindT, this.time + amount * 4.5);
            this.events.push({ k: 'flashed', who: t.id, amount });
          } else {
            const amount = Math.min(1, (1 - d / range) * 1.5 * self);
            t.stunT = Math.max(t.stunT, this.time + 1 + amount * 3.5);
            this.events.push({ k: 'stunned', who: t.id, amount });
          }
          if (by && t.id !== by.id) by.score += 10;
        }
        return;
      }
    }
  }

  /** Line of sight that smoke also blocks (bots, turrets, gunships, spawn checks use this). */
  sees(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    for (const sm of this.smokes) {
      const r = this.smokeRadius(sm);
      if (r < 1) continue;
      // Distance from the cloud centre to the segment.
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const l2 = dx * dx + dy * dy + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((sm.x - ax) * dx + (sm.y - ay) * dy + (sm.z - az) * dz) / l2));
      if (Math.hypot(ax + dx * t - sm.x, (ay + dy * t - sm.y) * 1.4, az + dz * t - sm.z) < r * 0.85) return false;
    }
    return this.level.visible(ax, ay, az, bx, by, bz);
  }

  /** Smoke clouds bloom over ~1.5 s and thin out in their last 2 s. */
  smokeRadius(sm: { t0: number; until: number }): number {
    const age = this.time - sm.t0;
    const left = sm.until - this.time;
    return 6 * Math.min(1, age / 1.5) * Math.min(1, Math.max(0, left / 2));
  }

  /** Radial damage with line of sight. */
  explode(x: number, y: number, z: number, radius: number, max: number, owner: string, kind: 'frag' | 'barrel' | 'airstrike' | 'semtex' | 'rcxd', weapon: string): void {
    this.events.push({ k: 'explosion', x, y, z, r: radius, kind });
    const by = this.soldier(owner) ?? null;
    let kills = 0;
    // Grenades are much stronger against the undead (a frag clears a window early on).
    if (this.horde && !this.horde.mirror && max > 0) this.horde.blast(x, y, z, radius, max * 4, owner, weapon);
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
    // Hardware caught in the blast.
    for (const u of [...this.units]) {
      if (by && u.owner !== by.id && this.mode !== 'ffa' && u.team === by.team) continue;
      const d = Math.hypot(u.x - x, u.y - y, u.z - z);
      if (d < radius) this.hurtUnit(u, max * (1 - d / radius) * 1.5, by);
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
    } else if (st === 'heli') {
      const r = Math.min(this.map.half[0], this.map.half[1]) * 0.55;
      this.helis.push({ id: nextId++, owner: s.id, team: s.team, until: this.time + 40, angle: this.rand() * 6.28, x: r, y: 20, z: 0, hp: 1400, target: '', burst: 0, nextShot: this.time + 3, cooldown: 0 });
      this.events.push({ k: 'streakUsed', who: s.id, team: s.team, streak: st });
    } else if (st === 'cuav') {
      const key = this.mode === 'ffa' ? s.id : `t${s.team}`;
      this.cuav.set(key, Math.max(this.cuav.get(key) ?? this.time, this.time) + 25);
      this.events.push({ k: 'streakUsed', who: s.id, team: s.team, streak: st });
    } else {
      const f = Game.dir(s.m.yaw, 0);
      const mk = (kind: UnitKind, x: number, y: number, z: number, life: number): Unit => {
        const u: Unit = { id: nextId++, kind, owner: s.id, team: s.team, x, y, z, yaw: s.m.yaw, pitch: kind === 'drone' || kind === 'gunner' ? -0.6 : 0, speed: 0, hp: UNIT_HP[kind], until: this.time + life, nextShot: this.time + 0.8, target: '', path: [], repath: 0, angle: this.rand() * Math.PI * 2, stuckT: 0 };
        this.units.push(u);
        return u;
      };
      if (st === 'rcxd') {
        const x = s.m.x + f[0] * 1.2;
        const z = s.m.z + f[2] * 1.2;
        const u = mk('rcxd', this.level.blocked(x - 0.3, s.m.y + 0.1, z - 0.3, x + 0.3, s.m.y + 0.5, z + 0.3) ? s.m.x : x, s.m.y, this.level.blocked(x - 0.3, s.m.y + 0.1, z - 0.3, x + 0.3, s.m.y + 0.5, z + 0.3) ? s.m.z : z, 22);
        if (!s.bot) s.ctrl = u.id;
      } else if (st === 'drone') {
        const u = mk('drone', s.m.x, Math.max(s.m.y + 12, 14), s.m.z, 30);
        if (!s.bot) s.ctrl = u.id;
      } else if (st === 'gunner') {
        const u = mk('gunner', 0, 30, 0, 32);
        if (!s.bot) s.ctrl = u.id;
      } else if (st === 'sentry') {
        let x = s.m.x + f[0] * 1.4;
        let z = s.m.z + f[2] * 1.4;
        if (this.level.blocked(x - 0.4, s.m.y + 0.1, z - 0.4, x + 0.4, s.m.y + 1.2, z + 0.4)) {
          x = s.m.x;
          z = s.m.z;
        }
        mk('sentry', x, s.m.y, z, 60);
      } else if (st === 'dogs') {
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const x = s.m.x + Math.cos(a) * 0.9;
          const z = s.m.z + Math.sin(a) * 0.9;
          const ok = !this.level.blocked(x - 0.3, s.m.y + 0.1, z - 0.3, x + 0.3, s.m.y + 0.8, z + 0.3);
          mk('dog', ok ? x : s.m.x, s.m.y, ok ? z : s.m.z, 45);
        }
      }
      this.events.push({ k: 'streakUsed', who: s.id, team: s.team, streak: st, x: s.m.x, z: s.m.z });
    }
  }

  // ---------------------------------------------------------------- killstreak hardware

  private hurtUnit(u: Unit, dmg: number, by: Soldier | null): void {
    u.hp -= dmg;
    if (u.hp > 0) return;
    if (u.kind === 'rcxd') {
      // Shot-up RC-XDs still go off.
      this.removeUnit(u, by?.id ?? '');
      this.explode(u.x, u.y + 0.3, u.z, 5, 180, u.owner, 'rcxd', 'rcxd');
      return;
    }
    this.removeUnit(u, by?.id ?? '');
    if (by && by.id !== u.owner) {
      const pts = u.kind === 'gunner' ? 200 : u.kind === 'dog' ? 50 : 100;
      by.score += pts;
      this.events.push({ k: 'score', who: by.id, pts, why: `${UNIT_NAMES[u.kind]} destroyed` });
      this.medal(by, 'destroyer', 0);
    }
  }

  private removeUnit(u: Unit, by: string): void {
    const i = this.units.indexOf(u);
    if (i < 0) return;
    this.units.splice(i, 1);
    const owner = this.soldier(u.owner);
    if (owner && owner.ctrl === u.id) owner.ctrl = 0;
    this.events.push({ k: 'unitDown', id: u.id, kind: u.kind, by });
  }

  private navGrid(): NavGrid {
    return (this.nav ??= new NavGrid(this.level, this.map.half[0], this.map.half[1]));
  }

  private tickUnits(dt: number): void {
    const [hx, hz] = this.map.half;
    for (const u of [...this.units]) {
      if (!this.units.includes(u)) continue;
      const owner = this.soldier(u.owner);
      if (this.time > u.until || !owner) {
        if (u.kind === 'rcxd') {
          this.removeUnit(u, '');
          this.explode(u.x, u.y + 0.3, u.z, 5, 180, u.owner, 'rcxd', 'rcxd');
        } else this.removeUnit(u, '');
        continue;
      }
      const piloted = owner.ctrl === u.id && !owner.bot;
      const inp = piloted ? (u as Unit & { inp?: Input }).inp : undefined;
      const enemies = this.soldiers.filter((t) => t.alive && t.id !== u.owner && (this.mode === 'ffa' || t.team !== u.team));
      const nearest = (list: Soldier[], maxD: number, los: (t: Soldier) => boolean) => {
        let best: Soldier | null = null;
        let bd = maxD;
        for (const t of list) {
          const d = Math.hypot(t.m.x - u.x, t.m.z - u.z);
          if (d < bd && los(t)) {
            bd = d;
            best = t;
          }
        }
        return best;
      };
      switch (u.kind) {
        case 'rcxd': {
          let throttle = 0;
          if (inp) {
            u.yaw = inp.yaw;
            throttle = inp.mz;
            if (inp.fire) {
              this.removeUnit(u, '');
              this.explode(u.x, u.y + 0.3, u.z, 5, 180, u.owner, 'rcxd', 'rcxd');
              continue;
            }
          } else {
            // Autopilot: straight at the nearest enemy, boom when close or stuck.
            const t = nearest(enemies, 60, () => true);
            if (t) {
              u.yaw = Math.atan2(-(t.m.x - u.x), -(t.m.z - u.z));
              throttle = 1;
              if (Math.hypot(t.m.x - u.x, t.m.z - u.z) < 2.5 || u.stuckT > 1) {
                this.removeUnit(u, '');
                this.explode(u.x, u.y + 0.3, u.z, 5, 180, u.owner, 'rcxd', 'rcxd');
                continue;
              }
            }
          }
          u.speed += (throttle * 11 - u.speed) * Math.min(1, dt * 3);
          const nx = u.x - Math.sin(u.yaw) * u.speed * dt;
          const nz = u.z - Math.cos(u.yaw) * u.speed * dt;
          const r = 0.3;
          const free = (y: number) => !this.level.blocked(nx - r, y + 0.05, nz - r, nx + r, y + 0.45, nz + r) && Math.abs(nx) < hx - 0.3 && Math.abs(nz) < hz - 0.3;
          let moved = false;
          for (const step of [0, 0.32]) {
            if (free(u.y + step)) {
              u.x = nx;
              u.z = nz;
              u.y += step;
              moved = true;
              break;
            }
          }
          if (!moved) {
            u.speed *= -0.2;
            u.stuckT += dt;
          } else u.stuckT = Math.max(0, u.stuckT - dt);
          u.y = this.level.floorAt(u.x, u.z, u.y + 0.05, 0.25);
          break;
        }
        case 'drone': {
          if (inp) {
            u.yaw = inp.yaw;
            u.pitch = Math.max(-1.45, Math.min(0.2, inp.pitch));
            const sp = 11;
            const fx = -Math.sin(u.yaw);
            const fz = -Math.cos(u.yaw);
            u.x += (fx * inp.mz + -fz * inp.mx) * sp * dt;
            u.z += (fz * inp.mz + fx * inp.mx) * sp * dt;
            if (inp.fire && this.time >= u.nextShot) {
              u.nextShot = this.time + 0.35;
              // Mark everyone near the crosshair.
              const d = Game.dir(u.yaw, u.pitch);
              for (const t of enemies) {
                const tx = t.m.x - u.x;
                const ty = t.m.y + 1 - u.y;
                const tz = t.m.z - u.z;
                const dist = Math.hypot(tx, ty, tz);
                if ((tx * d[0] + ty * d[1] + tz * d[2]) / dist > Math.cos(0.12 + 2 / dist) && dist < 80) this.mark(u.team, u.owner, t.id, 10);
              }
            }
          } else {
            // Autopilot: drift over the enemy, marking what it can see.
            const t = nearest(enemies, 200, () => true);
            if (t) {
              const dx = t.m.x - u.x;
              const dz = t.m.z - u.z;
              const d = Math.hypot(dx, dz) || 1;
              u.x += (dx / d) * Math.min(d, 8 * dt);
              u.z += (dz / d) * Math.min(d, 8 * dt);
            }
            if (this.time >= u.nextShot) {
              u.nextShot = this.time + 1;
              for (const e of enemies) if (Math.hypot(e.m.x - u.x, e.m.z - u.z) < 22 && this.sees(u.x, u.y, u.z, e.m.x, e.m.y + 1, e.m.z)) this.mark(u.team, u.owner, e.id, 6);
            }
          }
          u.x = Math.max(-hx, Math.min(hx, u.x));
          u.z = Math.max(-hz, Math.min(hz, u.z));
          break;
        }
        case 'sentry': {
          const t = nearest(enemies, 38, (e) => this.sees(u.x, u.y + 1, u.z, e.m.x, e.m.y + 1.2, e.m.z));
          if (!t) {
            u.yaw += dt * 0.6;
            break;
          }
          const want = Math.atan2(-(t.m.x - u.x), -(t.m.z - u.z));
          let dy = want - u.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          u.yaw += Math.sign(dy) * Math.min(Math.abs(dy), dt * 3.5);
          if (Math.abs(dy) > 0.15 || this.time < u.nextShot) break;
          u.nextShot = this.time + 0.12;
          const dist = Math.hypot(t.m.x - u.x, t.m.z - u.z);
          const miss = this.rand() > 0.75 - dist * 0.01;
          const tx = t.m.x + (miss ? (this.rand() - 0.5) * 2 : 0);
          const tz = t.m.z + (miss ? (this.rand() - 0.5) * 2 : 0);
          this.events.push({ k: 'unitShot', id: u.id, x: u.x - Math.sin(u.yaw) * 0.6, y: u.y + 1.05, z: u.z - Math.cos(u.yaw) * 0.6, tx, ty: t.m.y + 1.1, tz });
          if (!miss) this.damage(t, 16, owner, 'sentry', false, u.x, u.z);
          break;
        }
        case 'dog': {
          u.repath -= dt;
          let t = this.soldier(u.target);
          if (!t || !t.alive || u.repath <= 0) {
            t = nearest(enemies, 999, () => true) ?? undefined;
            u.target = t?.id ?? '';
          }
          if (!t) break;
          const d = Math.hypot(t.m.x - u.x, t.m.z - u.z);
          if (d < 1.7 && Math.abs(t.m.y - u.y) < 1.2) {
            if (this.time >= u.nextShot) {
              u.nextShot = this.time + 1.1;
              this.events.push({ k: 'bite', id: u.id, x: u.x, z: u.z });
              this.damage(t, 120, owner, 'dog', false, u.x, u.z);
            }
            u.yaw = Math.atan2(-(t.m.x - u.x), -(t.m.z - u.z));
            u.speed = 0;
            break;
          }
          const nav = this.navGrid();
          if (u.repath <= 0 || !u.path.length) {
            u.repath = 0.8;
            u.path = nav.path(nav.nearest(u.x, u.y, u.z), nav.nearest(t.m.x, t.m.y, t.m.z), 3000);
          }
          // Run along the path (straight at the target when it's in the open).
          let gx = t.m.x;
          let gy = t.m.y;
          let gz = t.m.z;
          if (!(d < 8 && this.level.visible(u.x, u.y + 0.5, u.z, t.m.x, t.m.y + 0.5, t.m.z))) {
            while (u.path.length > 1) {
              const n = nav.nodes[u.path[0]!]!;
              if (Math.hypot(n.x - u.x, n.z - u.z) > 0.7) break;
              u.path.shift();
            }
            const n = nav.nodes[u.path[0] ?? -1];
            if (n) {
              gx = n.x;
              gy = n.y;
              gz = n.z;
            }
          }
          const dx = gx - u.x;
          const dz = gz - u.z;
          const l = Math.hypot(dx, dz) || 1;
          u.speed = 8.5;
          const stepL = Math.min(l, u.speed * dt);
          u.x += (dx / l) * stepL;
          u.z += (dz / l) * stepL;
          u.y += (gy - u.y) * Math.min(1, dt * 6);
          u.yaw = Math.atan2(-dx, -dz);
          break;
        }
        case 'gunner': {
          const r = Math.min(hx, hz) * 0.45;
          u.angle += dt * 0.13;
          u.x = Math.cos(u.angle) * r;
          u.z = Math.sin(u.angle) * r;
          u.y = 30;
          let fire = false;
          if (inp) {
            u.yaw = inp.yaw;
            u.pitch = Math.max(-1.5, Math.min(0.1, inp.pitch));
            fire = inp.fire;
          } else {
            const t = nearest(enemies, 300, (e) => !this.has(e, 'ghost') && this.sees(u.x, u.y - 2, u.z, e.m.x, e.m.y + 1.2, e.m.z));
            if (t) {
              u.yaw = Math.atan2(-(t.m.x - u.x), -(t.m.z - u.z));
              u.pitch = Math.atan2(t.m.y + 1 - u.y, Math.hypot(t.m.x - u.x, t.m.z - u.z));
              fire = this.rand() < 0.6;
            }
          }
          if (!fire || this.time < u.nextShot) break;
          u.nextShot = this.time + 0.075;
          const base = Game.dir(u.yaw, u.pitch);
          const d = this.cone(base, 0.012);
          const ox = u.x;
          const oy = u.y - 2.2;
          const oz = u.z;
          const hitL = this.level.raycast(ox, oy, oz, d[0], d[1], d[2], 220, true);
          let tEnd = hitL.t;
          let victim: Soldier | null = null;
          for (const t of enemies) {
            const tt = raySphere(ox, oy, oz, d[0], d[1], d[2], t.m.x, t.m.y + 1, t.m.z, 0.7);
            if (tt >= 0 && tt < tEnd) {
              tEnd = tt;
              victim = t;
            }
          }
          const ex = ox + d[0] * tEnd;
          const ey = oy + d[1] * tEnd;
          const ez = oz + d[2] * tEnd;
          this.events.push({ k: 'unitShot', id: u.id, x: ox, y: oy, z: oz, tx: ex, ty: ey, tz: ez });
          if (victim) this.damage(victim, 45, owner, 'gunner', false, ox, oz);
          // Heavy rounds splash a little.
          else for (const t of enemies) if (Math.hypot(t.m.x - ex, t.m.y + 1 - ey, t.m.z - ez) < 1.6) this.damage(t, 18, owner, 'gunner', false, ox, oz);
          break;
        }
      }
    }
  }

  /** Mark an enemy for a team (recon drone). */
  private mark(team: 0 | 1, owner: string, id: string, secs: number): void {
    const key = this.mode === 'ffa' ? owner : `t${team}`;
    let m = this.marks.get(key);
    if (!m) this.marks.set(key, (m = new Map()));
    const was = (m.get(id) ?? 0) > this.time;
    m.set(id, this.time + secs);
    if (!was) {
      const by = this.soldier(owner);
      if (by) {
        by.score += 10;
        this.events.push({ k: 'score', who: owner, pts: 10, why: 'Enemy marked' });
      }
    }
  }

  /** Is `t` marked for `viewer`'s team? */
  marked(viewer: Soldier, t: Soldier): boolean {
    const key = this.mode === 'ffa' ? viewer.id : `t${viewer.team}`;
    return (this.marks.get(key)?.get(t.id) ?? 0) > this.time;
  }

  /** Is `viewer`'s minimap jammed by an enemy counter-UAV? */
  jammed(viewer: Soldier): boolean {
    const mine = this.mode === 'ffa' ? viewer.id : `t${viewer.team}`;
    for (const [k, t] of this.cuav) if (k !== mine && t > this.time) return true;
    return false;
  }

  /** Smoke clouds and fire pools. */
  private tickAreas(dt: number): void {
    this.smokes = this.smokes.filter((sm) => sm.until > this.time);
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i]!;
      if (f.until < this.time) {
        this.fires.splice(i, 1);
        continue;
      }
      const by = this.soldier(f.owner) ?? null;
      for (const t of this.soldiers) {
        if (!t.alive || (by && t.id !== by.id && !this.enemies(by, t))) continue;
        if (Math.hypot(t.m.x - f.x, t.m.z - f.z) > f.r || Math.abs(t.m.y - f.y) > 1.2) continue;
        this.damage(t, (t.id === f.owner ? 20 : 48) * dt, by, 'molotov', false, f.x, f.z);
      }
      for (const u of [...this.units]) if (u.kind === 'dog' && Math.hypot(u.x - f.x, u.z - f.z) < f.r) this.hurtUnit(u, 40 * dt, by);
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
      const targets = this.soldiers.filter((t) => t.alive && t.id !== h.owner && (this.mode === 'ffa' || t.team !== h.team) && !this.has(t, 'ghost') && this.sees(h.x, h.y - 2, h.z, t.m.x, t.m.y + 1.2, t.m.z));
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
