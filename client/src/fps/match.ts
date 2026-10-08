import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Game, TICK, UNIT_HP, type GameEvent, type Soldier, type Unit } from './sim/game';
import { BotBrain, type BotSkill } from './sim/bots';
import { NO_INPUT, eyeHeight, type Input } from './sim/player';
import { STREAKS, WEAPON, type WeaponClass, type WeaponDef } from './sim/weapons';
import type { Material } from './sim/level';
import { buildMap, disposeTree, makeHeli, makeJet, makeTag, makeUnit, type MapView } from './render/world3d';
import { Areas } from './render/areas';
import { cloneModel } from './render/assets';
import { prebuildTextures } from './render/textures';
import { ViewModel } from './render/viewmodel';
import { SoldierView, type Pose } from './render/soldiers';
import { Fx } from './render/fx';
import { camoTime, progress } from './render/camo';
import { Hud, MEDAL_NAMES, type PilotInfo, type Projector } from './hud';
import type { FpsInput, FrameInput } from './input';
import type { FpsAudio, Surface } from './audio';

export interface MatchSettings {
  fov: number;
  quality: 'high' | 'low';
}

/** Source of truth for a match: a local game with bots (and up to 4 splitscreen players), or an online mirror. */
export interface Session {
  readonly game: Game;
  /** The first local player (online: the only one). */
  readonly meId: string;
  readonly online: boolean;
  /** Interpolation factor between the last two ticks. */
  alpha: number;
  /** Advance with a per-tick input builder for each local player; returns new events. */
  update(dt: number, input: (id: string) => Input): GameEvent[];
  /** Interpolated render position of a soldier. */
  pose(s: Soldier): { x: number; y: number; z: number; yaw: number; pitch: number; vx: number; vz: number };
  /** Heavy one-off work (bot paths…) done during the loading screen. */
  warm?(): void;
  /** Round-trip time to the server for a soldier (online scoreboard). */
  ping?(s: Soldier): number;
  dispose(): void;
}

export class LocalSession implements Session {
  readonly online = false;
  alpha = 0;
  private acc = 0;
  private prev = new Map<string, [number, number, number]>();
  private readonly bots: BotBrain;
  private readonly inputs = new Map<string, Input>();

  constructor(
    readonly game: Game,
    skill: BotSkill,
    /** Local (human) players: 1 normally, up to 4 in splitscreen. */
    readonly locals: string[] = ['me'],
  ) {
    this.bots = new BotBrain(game, skill);
  }

  get meId(): string {
    return this.locals[0]!;
  }

  /** Nav components + every bot's first path, so the first ticks don't stall on A*. */
  warm(): void {
    this.bots.nav.component(0);
    this.bots.update(0, new Map());
  }

  update(dt: number, input: (id: string) => Input): GameEvent[] {
    const out: GameEvent[] = [];
    this.acc = Math.min(this.acc + dt, 0.2);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      for (const s of this.game.soldiers) this.prev.set(s.id, [s.m.x, s.m.y, s.m.z]);
      this.inputs.clear();
      this.bots.update(TICK, this.inputs);
      for (const id of this.locals) this.inputs.set(id, input(id));
      this.game.step(this.inputs);
      out.push(...this.game.events.splice(0));
    }
    this.alpha = this.acc / TICK;
    return out;
  }

  pose(s: Soldier) {
    const p = this.prev.get(s.id);
    const a = this.alpha;
    // Teleports (spawns) skip interpolation.
    if (!p || Math.hypot(p[0] - s.m.x, p[2] - s.m.z) > 3) return { x: s.m.x, y: s.m.y, z: s.m.z, yaw: s.m.yaw, pitch: s.m.pitch, vx: s.m.vx, vz: s.m.vz };
    return { x: p[0] + (s.m.x - p[0]) * a, y: p[1] + (s.m.y - p[1]) * a, z: p[2] + (s.m.z - p[2]) * a, yaw: s.m.yaw, pitch: s.m.pitch, vx: s.m.vx, vz: s.m.vz };
  }

  dispose(): void {}
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();

// ---------------------------------------------------------------- one renderer for the page

/**
 * The WebGL renderer lives for the whole page (a new context per match leaked
 * GPU memory and threw away every compiled shader). Only a quality change
 * (antialiasing is fixed at context creation) makes a new one.
 */
let shared: { r: THREE.WebGLRenderer; quality: MatchSettings['quality']; env: THREE.Texture } | null = null;
function sharedRenderer(quality: MatchSettings['quality']): { r: THREE.WebGLRenderer; env: THREE.Texture } {
  if (shared && shared.quality !== quality) {
    shared.env.dispose();
    shared.r.dispose();
    shared.r.forceContextLoss();
    shared.r.domElement.remove();
    shared = null;
  }
  if (!shared) {
    const r = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.75 : 1));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = quality === 'high';
    r.shadowMap.type = THREE.PCFShadowMap;
    r.autoClear = false;
    // Reflections so metallic camos (Gold, Platinum, Diamond) shine in first person.
    const pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    shared = { r, quality, env };
  }
  return shared;
}

/** Let the browser paint (the loading bar) before the next heavy step. */
const yieldFrame = () => new Promise<void>((res) => requestAnimationFrame(() => setTimeout(res, 0)));

// ---------------------------------------------------------------- recoil patterns

/**
 * Per-weapon recoil pattern: a fixed sequence of (yaw, pitch) kicks in units of the
 * weapon's recoilH / recoilV, learnable like the real thing. Resets after 0.4 s idle.
 */
const patterns = new Map<string, Array<[number, number]>>();
function recoilPattern(w: WeaponDef): Array<[number, number]> {
  let p = patterns.get(w.id);
  if (p) return p;
  let seed = 0;
  for (const ch of w.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const phase = (seed % 628) / 100;
  const dir = seed % 2 ? 1 : -1;
  p = [];
  for (let i = 0; i < 40; i++) {
    // A strong first kick, a climb that eases a little, and a sideways drift that swings over.
    const y = (i === 0 ? 1.3 : 1) * (1 - Math.min(0.3, i * 0.015));
    const x = Math.sin(i * 0.42 + phase) * 0.7 + (i > 5 ? dir * 0.45 : -dir * 0.25);
    p.push([x, y]);
  }
  patterns.set(w.id, p);
  return p;
}

// ---------------------------------------------------------------- one player's view

/** A local player who gets a view: their soldier id and input device. */
export interface LocalPlayer {
  id: string;
  input: FpsInput;
}

/** Everything that belongs to one local player's screen: camera, gun, HUD, look state. */
class View {
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 900);
  readonly vm: ViewModel;
  readonly hud: Hud;
  /** HUD container covering this view's part of the screen. */
  readonly box: HTMLElement;
  /** Viewport in CSS px (renderer coordinates are bottom-up). */
  x = 0;
  y = 0;
  w = 1;
  h = 1;
  /** HUD scale (smaller HUD in a quarter screen). */
  scale = 1;
  yaw = 0;
  pitch = 0;
  recoilP = 0;
  recoilY = 0;
  recoilIdx = 0;
  lastShotT = 0;
  fovBoost = 0;
  eyeY = 1.62;
  shake = 0;
  flinch = 0;
  vmKey = '';
  lastFrame: FrameInput | null = null;
  latch = { reload: false, slot: -1, melee: false, streak: -1, jump: false, tactical: false };
  seq = 0;
  stepT = 0;
  /** Alive as of the last tick built (spawns snap the view to their facing). */
  tickAlive = true;
  deadT = 0;
  heartT = 0;
  /** Hit desaturation (0..1), decays in ~0.4 s. */
  desat = 0;
  whizzT = 0;
  /** The unit piloted last frame (entering / leaving resets the view). */
  ctrlId = 0;

  constructor(
    readonly id: string,
    readonly input: FpsInput,
    team: 0 | 1,
    env: THREE.Texture,
    host: HTMLElement,
  ) {
    this.vm = new ViewModel(team);
    this.vm.scene.environment = env;
    this.vm.scene.environmentIntensity = 0.45;
    this.box = document.createElement('div');
    this.box.className = 'zh-view';
    host.appendChild(this.box);
    this.hud = new Hud(this.box);
  }

  dispose(): void {
    this.vm.dispose();
    this.box.remove();
  }
}

/** One match on screen: rendering, cameras, viewmodels, HUDs, effects, sounds — for 1–4 local players. */
export class Match {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private readonly views: View[];
  private mapView!: MapView;
  private fx = new Fx();
  private bodies = new Map<string, SoldierView>();
  private heliViews = new Map<number, THREE.Group>();
  private jets: Array<{ g: THREE.Group; t: number; from: THREE.Vector3; dir: THREE.Vector3; heard: boolean }> = [];
  private tagViews = new Map<number, THREE.Group>();
  private grenadeViews = new Map<number, THREE.Object3D>();
  private nadeGeo = new THREE.SphereGeometry(0.06, 8, 6);
  private nadeMat = new THREE.MeshStandardMaterial({ color: '#2f3a24', roughness: 0.6 });
  private canGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.13, 10);
  private unitViews = new Map<number, THREE.Group>();
  private areas = new Areas();
  private desatCss = '';
  private overTimer = 0;
  private W = 1;
  private H = 1;
  over = false;
  onOver: ((g: Game) => void) | null = null;
  onPause: (() => void) | null = null;

  constructor(
    private readonly host: HTMLElement,
    readonly session: Session,
    locals: LocalPlayer[],
    private readonly audio: FpsAudio,
    public settings: MatchSettings,
  ) {
    const sr = sharedRenderer(settings.quality);
    this.renderer = sr.r;
    if (this.renderer.domElement.parentElement !== host) host.prepend(this.renderer.domElement);
    this.scene.add(this.fx.group, this.areas.group);
    const g = session.game;
    this.views = locals.map((l) => {
      const s = g.soldier(l.id)!;
      const v = new View(l.id, l.input, s.team, sr.env, host);
      v.yaw = s.m.yaw;
      return v;
    });
    host.classList.toggle('zh-split', this.views.length > 1);
    host.dataset.views = String(this.views.length);
  }

  /** The first local player (single-player API). */
  get me(): Soldier {
    return this.meOf(this.views[0]!);
  }
  get hud(): Hud {
    return this.views[0]!.hud;
  }
  private meOf(v: View): Soldier {
    return this.session.game.soldier(v.id)!;
  }
  private viewOf(id: string): View | undefined {
    return this.views.find((v) => v.id === id);
  }

  /** Everything heavy, during the loading screen: textures, map, bot paths, shader warm-up, the first (shadowed) frame. */
  async load(progress: (f: number) => void): Promise<void> {
    const g = this.session.game;
    const step = async (f: number) => {
      progress(f);
      await yieldFrame();
    };
    await step(0.05);
    prebuildTextures(new Set<Material>([g.map.theme.ground, ...g.map.theme.patches.map((p) => p[4]), ...g.map.boxes.map((b) => b.mat)]));
    await step(0.3);
    this.mapView = buildMap(this.scene, this.renderer, g.map);
    this.renderer.shadowMap.enabled = this.settings.quality === 'high';
    if (this.settings.quality !== 'high') this.mapView.sun.castShadow = false;
    await step(0.45);
    this.session.warm?.();
    for (const v of this.views) v.hud.buildMinimap(g);
    addEventListener('resize', this.onResize);
    this.onResize();
    await step(0.55);
    // Shader warm-up: one of everything that can appear mid-match, compiled off the main thread where supported.
    const v0 = this.views[0]!;
    const me = this.me;
    v0.camera.position.set(me.m.x, me.m.y + 1.6, me.m.z);
    v0.camera.rotation.set(0, me.m.yaw, 0, 'YXZ');
    v0.camera.updateMatrixWorld();
    const warm: THREE.Object3D[] = [];
    // Everyone's third-person view is built now (skinned clones are slow), plus a camo'd one so that shader is ready too.
    for (const s of g.soldiers) this.bodyFor(s).update(this.poseOf(s), 0.016);
    const warmView = new SoldierView(0);
    warmView.update({ ...this.poseOf(me), z: me.m.z - 4, alive: true, camo: 'woodland' }, 0.016);
    this.scene.add(warmView.root);
    const jet = makeJet();
    const heli = makeHeli(0);
    const tag = makeTag(0);
    const nade = new THREE.Mesh(this.nadeGeo, this.nadeMat);
    for (const o of [jet, heli, tag, nade, ...this.fx.warmObjects()]) {
      o.position.set(me.m.x, me.m.y + 1, me.m.z - 6);
      this.scene.add(o);
      warm.push(o);
    }
    this.fx.muzzle(v1.set(me.m.x, -40, me.m.z));
    this.fx.tracer(v1, v2.set(me.m.x, -41, me.m.z));
    for (const v of this.views) {
      const s = this.meOf(v);
      const w = s.weapons[s.cur];
      v.vm.setWeapon(w.def, w.att, s.camos[w.def.id] ?? 'none');
      v.vmKey = '';
      v.vm.warm(true);
    }
    this.fx.update(0);
    await this.renderer.compileAsync(this.scene, v0.camera);
    await this.renderer.compileAsync(v0.vm.scene, v0.vm.camera);
    await step(0.8);
    // First real frame: shadow-depth programs (skinned too) and the 4096² shadow map.
    this.renderer.clear();
    this.renderer.render(this.scene, v0.camera);
    this.renderer.clearDepth();
    this.renderer.render(v0.vm.scene, v0.vm.camera);
    for (const v of this.views) v.vm.warm(false);
    warmView.dispose();
    for (const o of warm) {
      if (o === jet || o === heli || o === tag) disposeTree(o);
      else o.removeFromParent();
    }
    await step(1);
    for (const v of this.views) {
      v.hud.show(true);
      v.input.enabled = true;
    }
  }

  /** Splitscreen layout: 1 = full, 2 = top / bottom, 3–4 = quadrants. */
  private onResize = () => {
    const W = this.host.clientWidth || innerWidth;
    const H = this.host.clientHeight || innerHeight;
    this.W = W;
    this.H = H;
    this.renderer.setSize(W, H);
    const n = this.views.length;
    this.views.forEach((v, i) => {
      if (n === 1) [v.x, v.y, v.w, v.h] = [0, 0, W, H];
      else if (n === 2) [v.x, v.y, v.w, v.h] = [0, i * (H / 2), W, H / 2];
      else [v.x, v.y, v.w, v.h] = [(i % 2) * (W / 2), Math.floor(i / 2) * (H / 2), W / 2, H / 2];
      v.scale = n === 1 ? 1 : n === 2 ? 0.8 : 0.66;
      Object.assign(v.box.style, { left: `${v.x}px`, top: `${v.y}px`, width: `${v.w}px`, height: `${v.h}px` });
      v.box.style.setProperty('--hud-scale', String(v.scale));
      v.hud.setSize(v.w / v.scale, v.h / v.scale);
      v.camera.aspect = v.w / v.h;
      v.camera.updateProjectionMatrix();
      v.vm.resize(v.w / v.h);
    });
    this.fx.resize(Math.min(...this.views.map((v) => v.h)) * this.renderer.getPixelRatio(), this.views[0]!.camera.fov);
  };

  /** Screen position (in this view's HUD px) of a world point. */
  private projector(v: View): Projector {
    return (x, y, z) => {
      v3.set(x, y, z).project(v.camera);
      if (v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) return null;
      return [(((v3.x + 1) / 2) * v.w) / v.scale, (((1 - v3.y) / 2) * v.h) / v.scale];
    };
  }

  dispose(): void {
    clearTimeout(this.overTimer);
    this.renderer.domElement.style.filter = '';
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.W, this.H);
    this.renderer.shadowMap.autoUpdate = true;
    removeEventListener('resize', this.onResize);
    for (const v of this.views) {
      v.input.enabled = false;
      v.input.unlock();
      v.dispose();
    }
    this.host.classList.remove('zh-split');
    this.audio.heliLoop(false);
    this.mapView?.dispose();
    this.fx.dispose();
    for (const b of this.bodies.values()) b.dispose();
    this.bodies.clear();
    for (const o of [...this.heliViews.values(), ...this.tagViews.values(), ...this.jets.map((j) => j.g)]) disposeTree(o);
    this.nadeGeo.dispose();
    this.nadeMat.dispose();
    this.canGeo.dispose();
    for (const uv of this.unitViews.values()) disposeTree(uv);
    this.areas.dispose();
    this.renderer.clear();
    this.session.dispose();
  }

  /** Build this tick's input for one local player from their latest frame (edges are latched until a tick uses them). */
  private buildInput = (id: string): Input => {
    const v = this.viewOf(id);
    if (!v) return { ...NO_INPUT };
    const f = v.lastFrame;
    const me = this.meOf(v);
    // Respawned last tick: take the spawn's facing before this tick's input overwrites it.
    if (me.alive && !v.tickAlive) {
      v.yaw = me.m.yaw;
      v.pitch = 0;
      v.recoilP = v.recoilY = 0;
    }
    v.tickAlive = me.alive;
    const inp: Input = { ...NO_INPUT, seq: ++v.seq, yaw: v.yaw + v.recoilY, pitch: v.pitch + v.recoilP };
    if (f) {
      inp.mx = f.mx;
      inp.mz = f.mz;
      inp.jump = f.jump || v.latch.jump;
      inp.sprint = f.sprint;
      inp.crouch = f.crouch;
      inp.ads = f.ads;
      inp.fire = f.fire;
      inp.grenade = f.grenade;
    }
    inp.reload = v.latch.reload;
    inp.melee = v.latch.melee;
    inp.streak = v.latch.streak;
    inp.tactical = v.latch.tactical;
    inp.slot = v.latch.slot >= 0 ? v.latch.slot : -1;
    if (v.latch.slot === -2) inp.slot = 1 - me.cur;
    v.latch = { reload: false, slot: -1, melee: false, streak: -1, jump: false, tactical: false };
    return inp;
  };

  frame(dt: number): void {
    const g = this.session.game;
    // Input + look, per player.
    for (const v of this.views) {
      const me = this.meOf(v);
      // Controller aim assist: slow the stick when the crosshair is on someone.
      const target = this.aimTarget(v, 40, 0.07);
      const f = v.input.poll(dt, me.adsT, target && v.input.device === 'pad' && v.input.settings.aimAssist ? 0.55 : 1);
      v.lastFrame = f;
      if (f.reload) v.latch.reload = true;
      if (f.melee) v.latch.melee = true;
      if (f.streak >= 0) v.latch.streak = f.streak;
      if (f.tactical) v.latch.tactical = true;
      if (f.jump) v.latch.jump = true;
      if (f.slot >= 0) v.latch.slot = f.slot;
      if (f.swap) v.latch.slot = -2;
      if (f.menu && !this.over) this.onPause?.();
      // Stunned: the aim drags.
      if (g.time < me.stunT) {
        f.dyaw *= 0.35;
        f.dpitch *= 0.35;
      }
      // Entering / leaving a piloted killstreak: drones and gunships start looking down; back home, face where you stand.
      if (me.ctrl !== v.ctrlId) {
        const u = g.units.find((x) => x.id === me.ctrl);
        if (u && (u.kind === 'drone' || u.kind === 'gunner')) v.pitch = -0.6;
        if (!me.ctrl) {
          v.yaw = me.m.yaw;
          v.pitch = 0;
        }
        v.recoilP = v.recoilY = 0;
        v.ctrlId = me.ctrl;
      }
      if (me.alive) {
        v.yaw += f.dyaw;
        v.pitch = Math.max(-1.45, Math.min(1.45, v.pitch + f.dpitch));
        // Rotational aim assist: drift towards a target you're tracking while moving.
        if (target && v.input.device === 'pad' && v.input.settings.aimAssist && (f.mx || f.mz || Math.abs(f.dyaw) > 0)) {
          const dx = target.m.x - me.m.x;
          const dz = target.m.z - me.m.z;
          const want = Math.atan2(-dx, -dz);
          let d = want - (v.yaw + v.recoilY);
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          v.yaw += d * Math.min(1, dt * (1.5 + me.adsT * 2));
        }
      }
      // Recoil recovery (most of it comes back when you stop shooting).
      const rec = f.fire && me.alive ? 1.5 : 7;
      v.recoilP -= v.recoilP * Math.min(1, dt * rec);
      v.recoilY -= v.recoilY * Math.min(1, dt * rec);
    }
    // Simulate.
    const events = this.session.update(dt, this.buildInput);
    for (const e of events) this.handle(e);
    camoTime.value += dt;
    this.render(dt);
    for (const v of this.views) this.updateHud(v, dt);
    // A hit drains the colour for a moment (one view only: the filter covers the whole canvas).
    if (this.views.length === 1) {
      const v = this.views[0]!;
      const me = this.meOf(v);
      const sat = me.alive ? Math.max(0.35, 1 - v.desat * 0.6 - Math.max(0, (40 - me.hp) / 40) * 0.25) : 1;
      const css = sat > 0.99 ? '' : `saturate(${sat.toFixed(2)})`;
      if (css !== this.desatCss) this.renderer.domElement.style.filter = this.desatCss = css;
    }
    if (g.phase === 'over' && !this.over) {
      this.over = true;
      for (const v of this.views) v.input.unlock();
      this.overTimer = window.setTimeout(() => this.onOver?.(g), 2500);
    }
  }

  private updateHud(v: View, dt: number): void {
    const g = this.session.game;
    const me = this.meOf(v);
    const w = me.weapons[me.cur];
    // Low health: heartbeat.
    if (me.alive && me.hp < 40 && g.phase === 'play') {
      v.heartT -= dt;
      if (v.heartT <= 0) {
        this.audio.heartbeat(0.4 + (40 - me.hp) / 50);
        v.heartT = 0.7 + me.hp / 90;
      }
    } else v.heartT = 0;
    v.whizzT -= dt;
    v.desat = Math.max(0, v.desat - dt * 2.5);
    const enemy = this.aimTarget(v, 60, 0.03);
    const f = v.lastFrame;
    v.hud.update(dt, g, me, {
      spread: Math.tan(g.spread(me)) / Math.tan(((v.camera.fov / 2) * Math.PI) / 180),
      ads: me.adsT,
      scoped: v.vm.scoped,
      scope: v.vm.scope,
      yaw: v.yaw,
      enemyName: enemy ? enemy.name : '',
      scoreboard: !!f?.scoreboard || g.phase === 'over',
      pad: v.input.device === 'pad',
      reloadP: me.reloadT > 0 ? 1 - me.reloadT / (w.ammo === 0 ? w.def.reloadEmpty : w.def.reload) : -1,
      project: this.projector(v),
      ping: this.session.ping ? (s) => this.session.ping!(s) : undefined,
      pilot: this.pilotInfo(me),
    });
  }

  private pilotInfo(me: Soldier): PilotInfo | null {
    const u = me.ctrl ? this.session.game.units.find((x) => x.id === me.ctrl) : undefined;
    if (!u) return null;
    return { kind: u.kind, left: Math.max(0, u.until - this.session.game.time), hp: u.hp / UNIT_HP[u.kind] };
  }

  /** The enemy under a player's crosshair (within angle, visible). */
  private aimTarget(v: View, range: number, ang: number): Soldier | null {
    const g = this.session.game;
    const me = this.meOf(v);
    if (!me.alive || me.ctrl) return null;
    const eye = g.eye(me);
    const d = Game.dir(v.yaw + v.recoilY, v.pitch + v.recoilP);
    let best: Soldier | null = null;
    let bestA = ang;
    for (const o of g.soldiers) {
      if (!o.alive || !g.enemies(me, o)) continue;
      const tx = o.m.x - eye[0];
      const ty = o.m.y + 1.2 - eye[1];
      const tz = o.m.z - eye[2];
      const dist = Math.hypot(tx, ty, tz);
      if (dist > range) continue;
      const a = Math.acos(Math.max(-1, Math.min(1, (tx * d[0] + ty * d[1] + tz * d[2]) / dist)));
      if (a < bestA + 0.6 / dist && g.sees(eye[0], eye[1], eye[2], o.m.x, o.m.y + 1.2, o.m.z)) {
        bestA = a;
        best = o;
      }
    }
    return best;
  }

  /** Distance and stereo pan of a world point for one player. */
  private distFor(v: View, x: number, y: number, z: number): [number, number] {
    const me = this.meOf(v);
    const dx = x - me.m.x;
    const dz = z - me.m.z;
    const d = Math.hypot(dx, y - me.m.y - 1.5, dz);
    const ang = Math.atan2(-dx, -dz) - v.yaw;
    return [d, -Math.sin(ang)];
  }
  /** …for whichever local player is closest (one shared set of speakers). */
  private distTo(x: number, y: number, z: number): [number, number] {
    let best: [number, number] = [Infinity, 0];
    for (const v of this.views) {
      const r = this.distFor(v, x, y, z);
      if (r[0] < best[0]) best = r;
    }
    return best;
  }

  /** What's underfoot at (x, y, z), for footstep sounds. */
  private surfaceAt(x: number, y: number, z: number): Surface {
    const g = this.session.game;
    const h = g.level.raycast(x, y + 0.2, z, 0, -1, 0, 0.6);
    const mat = h.box?.mat ?? g.map.theme.ground;
    return mat === 'metal' ? 'metal' : mat === 'wood' ? 'wood' : mat === 'grass' || mat === 'sand' || mat === 'dirt' ? 'soft' : 'hard';
  }

  /** A bullet from (o) to (p) that passed close to a player's head without hitting them: whizz. */
  private nearMiss(v: View, ox: number, oy: number, oz: number, p: THREE.Vector3): void {
    const me = this.meOf(v);
    if (!me.alive || v.whizzT > 0) return;
    const ey = me.m.y + eyeHeight(me.m);
    const dx = p.x - ox;
    const dy = p.y - oy;
    const dz = p.z - oz;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    const t = ((me.m.x - ox) * dx + (ey - oy) * dy + (me.m.z - oz) * dz) / len2;
    if (t <= 0 || t >= 1) return;
    const cx = ox + dx * t - me.m.x;
    const cy = oy + dy * t - ey;
    const cz = oz + dz * t - me.m.z;
    const d = Math.hypot(cx, cy, cz);
    if (d > 1.6 || d < 0.35) return;
    v.whizzT = 0.08;
    this.audio.whizz(this.distFor(v, me.m.x + cx, ey + cy, me.m.z + cz)[1]);
  }

  private hostile(v: View, owner: string, team: number): boolean {
    return this.session.game.mode === 'ffa' ? owner !== v.id : team !== this.meOf(v).team;
  }

  private handle(e: GameEvent): void {
    const g = this.session.game;
    const p1 = this.views[0]!;
    switch (e.k) {
      case 'shot': {
        const w = WEAPON[e.w];
        const cls: WeaponClass = w?.cls ?? 'ar';
        const own = this.viewOf(e.by);
        if (own) {
          const me = this.meOf(own);
          own.vm.fire();
          this.audio.shot(e.w, cls, e.sup, 0);
          // Recoil: walk the weapon's pattern (it restarts after a short pause).
          const ws = me.weapons[me.cur].def;
          const now = g.time;
          if (now - own.lastShotT > 0.4) own.recoilIdx = 0;
          own.lastShotT = now;
          const pat = recoilPattern(ws);
          const [kx, ky] = pat[Math.min(own.recoilIdx++, pat.length - 1)]!;
          const k = 1 - me.adsT * 0.35;
          own.recoilP += ((ws.recoilV * Math.PI) / 180) * ky * k;
          own.recoilY += ((ws.recoilH * Math.PI) / 180) * kx * k;
          own.shake = Math.max(own.shake, cls === 'sniper' || cls === 'shotgun' ? 0.25 : 0.06);
          own.input.rumble(cls === 'sniper' || cls === 'shotgun' ? 0.8 : 0.35, 0.3, 60);
          own.camera.updateMatrixWorld();
          own.vm.muzzleWorld(v1, own.camera);
          for (const h of e.hits) {
            v2.set(h[0], h[1], h[2]);
            this.fx.tracer(v1, v2, cls === 'shotgun' ? 0.4 : 0.8);
            this.impactAt(e.fx, e.fy, e.fz, v2, !!h[3]);
          }
          if (w?.mode === 'bolt' || w?.mode === 'pump') setTimeout(() => this.audio.bolt(), 250);
        } else {
          const b = this.bodies.get(e.by);
          b?.fired();
          const [d, pan] = this.distTo(e.fx, e.fy, e.fz);
          this.audio.shot(e.w, cls, e.sup, d, pan);
          const from = b ? b.muzzle : v1.set(e.fx, e.fy, e.fz);
          if (!e.sup) this.fx.muzzle(from);
          const shooter = g.soldier(e.by);
          for (const h of e.hits) {
            v2.set(h[0], h[1], h[2]);
            this.fx.tracer(from, v2, cls === 'shotgun' ? 0.25 : 0.55);
            this.impactAt(e.fx, e.fy, e.fz, v2, !!h[3]);
            if (shooter) for (const v of this.views) if (g.enemies(this.meOf(v), shooter)) this.nearMiss(v, e.fx, e.fy, e.fz, v2);
          }
        }
        break;
      }
      case 'hit': {
        const by = this.viewOf(e.by);
        if (by && e.by !== e.target) {
          by.hud.hitmarker(e.kill, e.head);
          this.audio.hitmarker(e.kill, e.head);
          const t = g.soldier(e.target);
          const head = this.bodies.get(e.target)?.head;
          if (t) by.hud.damageNumber(t.id, t.m.x, (head && head.y > 0 ? head.y : t.m.y + 1.7) + 0.35, t.m.z, e.dmg, e.head, e.kill);
        }
        const tv = this.viewOf(e.target);
        if (tv) {
          tv.hud.damageFrom(e.fx, e.fz);
          tv.desat = Math.min(1, tv.desat + 0.4 + e.dmg / 100);
          this.audio.hurt();
          tv.flinch = Math.min(0.06, 0.02 + e.dmg / 1500);
          tv.input.rumble(0.6, 0.6, 120);
        }
        break;
      }
      case 'kill': {
        const k = g.soldier(e.killer);
        const vv = g.soldier(e.victim);
        for (const v of this.views) if (k && vv) v.hud.killfeed(k.name, k.team, vv.name, vv.team, e.weapon, e.head, this.meOf(v).team, g.mode === 'ffa', k.id === v.id, vv.id === v.id);
        // Camo progress belongs to the profile (player 1).
        if (e.killer === p1.id && e.victim !== p1.id && WEAPON[e.weapon]) {
          const unlocked = progress.addKill(e.weapon);
          if (unlocked) p1.hud.center(`<small>CAMO UNLOCKED</small><b>${unlocked.toUpperCase()}</b><span>${WEAPON[e.weapon]!.name}</span>`, 3);
        }
        const dv = this.viewOf(e.victim);
        if (dv) dv.deadT = 0;
        break;
      }
      case 'medal': {
        const v = this.viewOf(e.who);
        if (v) {
          v.hud.popup(MEDAL_NAMES[e.medal], e.xp, true);
          this.audio.medal();
        }
        break;
      }
      case 'score': {
        const v = this.viewOf(e.who);
        if (!v) break;
        if (e.why === 'Kill confirmed' || e.why === 'Kill denied') v.hud.popup(e.why === 'Kill confirmed' ? 'TAG COLLECTED' : 'TAG DENIED', e.pts, true);
        else v.hud.popup(e.why === 'Kill' ? 'KILL' : e.why.toUpperCase(), e.pts);
        break;
      }
      case 'streakEarned': {
        const v = this.viewOf(e.who);
        if (v) {
          const me = this.meOf(v);
          const name = STREAKS[e.streak].name;
          const slot = Math.max(0, me.loadout.streaks.indexOf(e.streak));
          const key = v.input.device === 'pad' ? ['D-pad ←', 'D-pad ↑', 'D-pad ↓'][slot] : `Press ${4 + slot}`;
          v.hud.center(`<small>KILLSTREAK READY</small><b>${name.toUpperCase()}</b><span>${key}</span>`, 2.5);
          this.audio.say(`${name.replace('UAV', 'U A V').replace('RC-XD', 'R C X D')} ready`);
        }
        break;
      }
      case 'streakUsed': {
        for (const v of this.views) {
          const friendly = g.mode === 'ffa' ? e.who === v.id : e.team === this.meOf(v).team;
          const says = {
            uav: friendly ? 'U A V online' : 'Enemy U A V spotted',
            rcxd: friendly ? 'R C X D deployed' : 'Enemy R C X D',
            cuav: friendly ? 'Counter U A V online' : 'Enemy counter U A V. Minimap jammed',
            drone: friendly ? 'Recon drone deployed' : 'Enemy recon drone',
            sentry: friendly ? 'Sentry gun deployed' : 'Enemy sentry gun',
            airstrike: friendly ? 'Airstrike inbound' : 'Enemy airstrike inbound',
            heli: friendly ? 'Attack helicopter inbound' : 'Enemy attack helicopter',
            dogs: friendly ? 'Attack dogs inbound' : 'Enemy attack dogs',
            gunner: friendly ? 'Chopper gunner inbound' : 'Enemy chopper gunner',
          }[e.streak];
          if (v === p1) this.audio.say(says);
          v.hud.popup(says.replace(/U A V/g, 'UAV').replace('R C X D', 'RC-XD').toUpperCase(), 0);
        }
        if (e.streak === 'airstrike' && e.x !== undefined && e.dx !== undefined) {
          const dir = new THREE.Vector3(e.dx, 0, e.dz!);
          for (let k = 0; k < 2; k++) {
            const jet = makeJet();
            this.scene.add(jet);
            const from = new THREE.Vector3(e.x - e.dx * 120 + k * 6 * e.dz!, 40 + k * 3, e.z! - e.dz! * 120 - k * 6 * e.dx);
            jet.position.copy(from);
            jet.lookAt(jet.position.clone().add(dir));
            jet.rotateY(Math.PI / 2);
            // Only the lead jet makes the fly-over sound (when it's closest to someone).
            this.jets.push({ g: jet, t: 0, from, dir, heard: k > 0 });
          }
        }
        break;
      }
      case 'explosion': {
        v1.set(e.x, e.y, e.z);
        const [d, pan] = this.distTo(e.x, e.y, e.z);
        if (e.kind === 'flash' || e.kind === 'stun' || e.kind === 'smoke' || e.kind === 'molotov') {
          this.fx.impact(v1, v2.set(0, 1, 0), 'dust');
          if (e.kind === 'flash') this.audio.flashbang(d, pan, 0);
          else if (e.kind === 'stun') this.audio.stunPop(d, pan, 0);
          else if (e.kind === 'smoke') this.audio.smokePop(d, pan);
          else this.audio.molotov(d, pan);
          break;
        }
        this.fx.explosion(v1, e.r);
        this.audio.explosion(d, pan);
        // Every airstrike bomb shakes the screen, even from across the map.
        for (const v of this.views) {
          const dv = this.distFor(v, e.x, e.y, e.z)[0];
          const near = Math.max(0, 1 - dv / 25) * 0.9;
          v.shake = Math.max(v.shake, e.kind === 'airstrike' ? Math.max(near, 0.2 + Math.max(0, 1 - dv / 60) * 0.4) : near);
          if (dv < 15 || (e.kind === 'airstrike' && dv < 40)) v.input.rumble(1, 1, 300);
        }
        // Barrels vanish.
        for (const [i, b] of g.barrels.entries()) if (!b.alive && this.mapView.barrels[i]) this.mapView.barrels[i]!.visible = false;
        break;
      }
      case 'heliShot': {
        // Minigun: a stream of tracers walking onto the target.
        v1.set(e.x, e.y, e.z);
        for (let k = 0; k < 3; k++) {
          v2.set(e.tx + (Math.random() - 0.5) * 0.8 * k, e.ty + (Math.random() - 0.5) * 0.4, e.tz + (Math.random() - 0.5) * 0.8 * k);
          this.fx.tracer(v1, v2, 1, 0.09);
        }
        v2.set(e.tx, e.ty, e.tz);
        this.fx.impact(v2, new THREE.Vector3(0, 1, 0), 'dust');
        const [d, pan] = this.distTo(e.x, e.y, e.z);
        this.audio.shot('heli', 'lmg', false, d, pan);
        const heli = g.helis.find((h) => h.id === e.id);
        if (heli) for (const v of this.views) if (this.hostile(v, heli.owner, heli.team)) this.nearMiss(v, e.x, e.y, e.z, v2);
        break;
      }
      case 'unitShot': {
        const u = g.units.find((x) => x.id === e.id);
        v1.set(e.x, e.y, e.z);
        v2.set(e.tx, e.ty, e.tz);
        this.fx.tracer(v1, v2, 1, 0.07);
        this.fx.muzzle(v1);
        this.fx.impact(v2, v3.set(0, 1, 0), 'dust');
        const [d, pan] = this.distTo(e.x, e.y, e.z);
        const piloting = !!u && this.views.some((v) => v.id === u.owner && this.meOf(v).ctrl === u.id);
        this.audio.shot(u?.kind === 'gunner' ? 'gunner' : 'sentry', 'lmg', false, piloting ? 0 : d, pan);
        if (u) for (const v of this.views) if (this.hostile(v, u.owner, u.team)) this.nearMiss(v, e.x, e.y, e.z, v2);
        break;
      }
      case 'unitDown': {
        const uv = this.unitViews.get(e.id);
        if (uv && e.kind !== 'dog') {
          this.fx.explosion(uv.position.clone(), e.kind === 'gunner' ? 8 : 2.5);
          const [d, pan] = this.distTo(uv.position.x, uv.position.y, uv.position.z);
          this.audio.explosion(d, pan);
        }
        break;
      }
      case 'bite': {
        const [d, pan] = this.distTo(e.x, 0.6, e.z);
        this.audio.bark(d, pan, true);
        break;
      }
      case 'flashed': {
        const v = this.viewOf(e.who);
        if (v) {
          const me = this.meOf(v);
          me.blindT = Math.max(me.blindT, g.time + e.amount * 4.5);
          this.audio.flashbang(4, 0, e.amount);
          v.input.rumble(1, 1, 400);
        }
        break;
      }
      case 'stunned': {
        const v = this.viewOf(e.who);
        if (v) {
          const me = this.meOf(v);
          me.stunT = Math.max(me.stunT, g.time + 1 + e.amount * 3.5);
          this.audio.stunPop(3, 0, e.amount);
          v.input.rumble(0.8, 0.4, 500);
        }
        break;
      }
      case 'heliDown': {
        const h = this.heliViews.get(e.id);
        if (h) {
          this.fx.explosion(h.position.clone(), 8);
          this.audio.explosion(30);
        }
        break;
      }
      case 'flag': {
        this.audio.capture();
        const f = g.flags[e.flag]!;
        for (const v of this.views) {
          const ours = e.team === this.meOf(v).team;
          v.hud.center(`<b>${e.team === -1 ? `${f.name} NEUTRALISED` : ours ? `SECURED ${f.name}` : `LOST ${f.name}`}</b>`, 1.6);
          if (v === p1 && e.team !== -1) this.audio.say(ours ? `${f.name} secured` : `We've lost ${f.name}`);
        }
        break;
      }
      case 'tag':
        if (this.viewOf(e.who)) this.audio.tag(e.confirmed);
        break;
      case 'reload': {
        const v = this.viewOf(e.who);
        if (v) {
          const me = this.meOf(v);
          this.audio.reload(me.weapons[me.cur].def.cls, me.reloadT);
        }
        break;
      }
      case 'empty':
        if (this.viewOf(e.who)) this.audio.empty();
        break;
      case 'melee':
        if (this.viewOf(e.who)) this.audio.knife(e.hit);
        break;
      case 'grenadeThrow':
        if (this.viewOf(e.who)) this.audio.grenadePin();
        break;
      case 'over': {
        const me = this.me;
        const won = g.mode === 'ffa' ? e.top === me.id : e.winner === me.team;
        this.audio.say(e.winner === -1 && g.mode !== 'ffa' ? 'Draw' : won ? 'Victory' : 'Defeat');
        break;
      }
    }
  }

  private bodyFor(s: Soldier): SoldierView {
    let b = this.bodies.get(s.id);
    if (!b) {
      b = new SoldierView(s.team);
      this.bodies.set(s.id, b);
      this.scene.add(b.root);
    }
    return b;
  }

  private poseOf(s: Soldier): Pose {
    const w = s.weapons[s.cur].def.id;
    return { ...this.session.pose(s), crouch: s.m.crouched, sprint: s.m.sprinting, slide: s.m.slide > 0, ads: s.adsT > 0.5, alive: s.alive, weapon: w, camo: s.camos[w] ?? 'none', reloading: s.reloadT > 0 };
  }

  private impactAt(ox: number, oy: number, oz: number, p: THREE.Vector3, flesh: boolean): void {
    if (flesh) {
      this.fx.impact(p, new THREE.Vector3(0, 0, 0), 'blood');
      return;
    }
    const g = this.session.game;
    const dx = p.x - ox;
    const dy = p.y - oy;
    const dz = p.z - oz;
    const l = Math.hypot(dx, dy, dz) || 1;
    const h = g.level.raycast(ox, oy, oz, dx / l, dy / l, dz / l, l + 0.2);
    const n = new THREE.Vector3(h.nx, h.ny, h.nz);
    if (n.lengthSq() === 0) n.set(-dx / l, -dy / l, -dz / l);
    const mat = h.box?.mat;
    this.fx.impact(p, n, mat === 'metal' ? 'metal' : mat === 'wood' ? 'wood' : 'dust');
  }

  /** Camera for a piloted killstreak: chase cam behind the RC-XD, the drone's / gunship's own gun camera. */
  private pilotCamera(v: View, u: Unit): void {
    const yaw = v.yaw;
    if (u.kind === 'rcxd') {
      const f = Game.dir(yaw, 0);
      v.camera.position.set(u.x - f[0] * 2.4, u.y + 1.15, u.z - f[2] * 2.4);
      v.camera.lookAt(u.x + f[0] * 3, u.y + 0.35, u.z + f[2] * 3);
      return;
    }
    const uv = this.unitViews.get(u.id);
    v.camera.position.set(uv ? uv.position.x : u.x, (uv ? uv.position.y : u.y) - (u.kind === 'gunner' ? 2.6 : 0.25), uv ? uv.position.z : u.z);
    v.camera.rotation.order = 'YXZ';
    v.camera.rotation.set(v.pitch, yaw, 0);
  }

  /** A thrown piece of equipment. */
  private nadeView(kind: string): THREE.Object3D {
    if (kind === 'frag') return new THREE.Mesh(this.nadeGeo, this.nadeMat);
    if (kind === 'tknife') {
      const k = cloneModel('item-knife-1');
      k.scale.setScalar(0.22);
      k.rotation.x = Math.PI / 2;
      const g = new THREE.Group();
      g.add(k);
      return g;
    }
    const col = { semtex: '#c8b070', molotov: '#3a6a3a', flash: '#4a4e54', stun: '#6a6a3a', smoke: '#5a6a5a' }[kind] ?? '#555';
    const m = new THREE.Mesh(kind === 'semtex' ? new THREE.BoxGeometry(0.1, 0.06, 0.08) : this.canGeo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }));
    if (kind === 'molotov') m.scale.set(1, 1.8, 1);
    return m;
  }

  /** The shared world (bodies, hardware, effects) once, then every player's view. */
  private render(dt: number): void {
    const g = this.session.game;
    const p1 = this.me;
    // Killstreak hardware.
    const unitSeen = new Set<number>();
    for (const u of g.units) {
      unitSeen.add(u.id);
      let uv = this.unitViews.get(u.id);
      if (!uv) {
        uv = makeUnit(u.kind, g.mode === 'ffa' ? (u.owner === p1.id ? 0 : 1) : u.team === p1.team ? 0 : 1);
        uv.position.set(u.x, u.y, u.z);
        this.unitViews.set(u.id, uv);
        this.scene.add(uv);
      }
      // Smooth toward the sim position (online snapshots arrive at 30 Hz).
      const k = Math.min(1, dt * (this.session.online ? 14 : 40));
      uv.position.x += (u.x - uv.position.x) * k;
      uv.position.y += (u.y - uv.position.y) * k;
      uv.position.z += (u.z - uv.position.z) * k;
      let dy = u.yaw - uv.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      uv.rotation.y += dy * k;
      const moving = u.speed > 0.5;
      uv.traverse((n) => {
        if (n.name === 'rotor') n.rotation.y += dt * 60;
        if (n.name === 'wheel') n.rotation.x += dt * u.speed * 8;
        if (n.name.startsWith('leg')) n.rotation.x = moving ? Math.sin(performance.now() / 70 + Number(n.name[3]) * 1.6) * 0.7 : 0;
        if (n.name === 'led') n.visible = Math.sin(performance.now() / 120) > 0;
      });
      if (u.kind === 'dog' && Math.random() < dt * 0.4) {
        const [d, pan] = this.distTo(u.x, u.y, u.z);
        this.audio.bark(d, pan);
      }
    }
    for (const [id, uv] of this.unitViews)
      if (!unitSeen.has(id)) {
        disposeTree(uv);
        this.unitViews.delete(id);
      }
    this.areas.update(g, dt);
    // Soldiers (local players too: the others see them).
    const seen = new Set<string>();
    for (const s of g.soldiers) {
      seen.add(s.id);
      const b = this.bodyFor(s);
      b.root.visible = s.alive || s.respawnIn >= RESPAWN_HIDE;
      b.update(this.poseOf(s), dt);
      // Footsteps (local players hear their own from their step timer).
      if (!this.viewOf(s.id) && s.alive && s.m.onGround && Math.hypot(s.m.vx, s.m.vz) > 3 && !s.m.crouched) {
        const [d, pan] = this.distTo(s.m.x, s.m.y, s.m.z);
        if (d < 22 && Math.random() < dt * (s.m.sprinting ? 3.4 : 2.4)) this.audio.footstep(d, pan, this.surfaceAt(s.m.x, s.m.y, s.m.z));
      }
    }
    for (const [id, b] of this.bodies)
      if (!seen.has(id)) {
        b.dispose();
        this.bodies.delete(id);
      }
    // Domination flags.
    this.mapView.flags.forEach((fv, i) => {
      const fl = g.flags[i];
      fv.group.visible = !!fl;
      if (!fl) return;
      const col = fl.owner === -1 ? '#e8e8e8' : fl.owner === p1.team ? '#3c8cff' : '#ff4a3a';
      (fv.cloth.material as THREE.MeshStandardMaterial).color.set(col);
      (fv.ring.material as THREE.MeshBasicMaterial).color.set(fl.capturing ? '#ffd23f' : col);
      fv.cloth.rotation.y = Math.sin(performance.now() / 400 + i) * 0.25;
    });
    // Dog tags.
    const tagSeen = new Set<number>();
    for (const t of g.tags) {
      tagSeen.add(t.id);
      let tv = this.tagViews.get(t.id);
      if (!tv) {
        tv = makeTag(t.team === p1.team ? 0 : 1);
        this.tagViews.set(t.id, tv);
        this.scene.add(tv);
      }
      tv.position.set(t.x, t.y + Math.sin(performance.now() / 300 + t.id) * 0.08, t.z);
      tv.rotation.y += dt * 2.5;
    }
    for (const [id, tv] of this.tagViews)
      if (!tagSeen.has(id)) {
        disposeTree(tv);
        this.tagViews.delete(id);
      }
    // Thrown equipment.
    const nadeSeen = new Set<number>();
    for (const n of g.grenades) {
      nadeSeen.add(n.id);
      let o = this.grenadeViews.get(n.id);
      if (!o) {
        o = this.nadeView(n.kind);
        this.grenadeViews.set(n.id, o);
        this.scene.add(o);
      }
      o.position.set(n.x, n.y, n.z);
      if (n.kind === 'tknife') o.lookAt(n.x + n.vx, n.y + n.vy, n.z + n.vz);
      else if (!n.rest && !n.stuck) o.rotation.x += dt * 9;
    }
    for (const [id, o] of this.grenadeViews)
      if (!nadeSeen.has(id)) {
        o.removeFromParent();
        this.grenadeViews.delete(id);
      }
    // Helicopters.
    const heliSeen = new Set<number>();
    let nearest = Infinity;
    for (const h of g.helis) {
      heliSeen.add(h.id);
      let hv = this.heliViews.get(h.id);
      if (!hv) {
        hv = makeHeli(g.mode === 'ffa' ? (h.owner === p1.id ? 0 : 1) : h.team === p1.team ? 0 : 1);
        this.heliViews.set(h.id, hv);
        this.scene.add(hv);
      }
      hv.position.set(h.x, h.y, h.z);
      hv.rotation.y = -h.angle + Math.PI;
      hv.rotation.z = 0.12;
      hv.traverse((n) => {
        if (n.name === 'rotor') n.rotation.y += dt * 40;
        if (n.name === 'tailrotor') n.rotation.z += dt * 50;
      });
      nearest = Math.min(nearest, this.distTo(h.x, h.y, h.z)[0]);
    }
    for (const [id, hv] of this.heliViews)
      if (!heliSeen.has(id)) {
        disposeTree(hv);
        this.heliViews.delete(id);
      }
    for (const u of g.units) if (u.kind === 'gunner') nearest = Math.min(nearest, this.distTo(u.x, u.y, u.z)[0]);
    this.audio.heliLoop(g.helis.length > 0 || g.units.some((u) => u.kind === 'gunner'), nearest);
    // Jets: the roar plays as the lead jet closes in.
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i]!;
      j.t += dt;
      j.g.position.copy(j.from).addScaledVector(j.dir, j.t * 95);
      if (!j.heard) {
        // Time until closest approach along the flight line.
        const ahead = (p1.m.x - j.g.position.x) * j.dir.x + (p1.m.z - j.g.position.z) * j.dir.z;
        if (ahead < 95 * 0.9) {
          j.heard = true;
          const [d, pan] = this.distTo(j.g.position.x + j.dir.x * ahead, j.g.position.y, j.g.position.z + j.dir.z * ahead);
          this.audio.jet(d, pan);
        }
      }
      if (j.t > 3.2) {
        disposeTree(j.g);
        this.jets.splice(i, 1);
      }
    }
    this.fx.update(dt);
    // Every player's view.
    const split = this.views.length > 1;
    this.renderer.setScissorTest(split);
    if (split) {
      // One shadow-map pass per frame, not one per view.
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.setViewport(0, 0, this.W, this.H);
      this.renderer.setScissor(0, 0, this.W, this.H);
    } else this.renderer.shadowMap.autoUpdate = true;
    this.renderer.clear();
    for (const v of this.views) this.renderView(v, dt);
    if (split) {
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, this.W, this.H);
    }
  }

  private renderView(v: View, dt: number): void {
    const g = this.session.game;
    const me = this.meOf(v);
    const w = me.weapons[me.cur];
    // Viewmodel weapon.
    const key = `${w.def.id}:${JSON.stringify(w.att)}:${me.camos[w.def.id] ?? 'none'}`;
    if (key !== v.vmKey) {
      v.vmKey = key;
      v.vm.setWeapon(w.def, w.att, me.camos[w.def.id] ?? 'none');
    }
    // Camera.
    const p = this.session.pose(me);
    const targetEye = eyeHeight(me.m);
    v.eyeY += (targetEye - v.eyeY) * Math.min(1, dt * 12);
    v.shake = Math.max(0, v.shake - dt * 2.5);
    v.flinch = Math.max(0, v.flinch - dt * 0.4);
    const sh = v.shake * 0.04;
    const pu = me.ctrl ? g.units.find((u) => u.id === me.ctrl) : undefined;
    if (me.alive && pu) this.pilotCamera(v, pu);
    else if (me.alive) {
      v.camera.position.set(p.x + (Math.random() - 0.5) * sh, p.y + v.eyeY + (Math.random() - 0.5) * sh, p.z + (Math.random() - 0.5) * sh);
      v.camera.rotation.order = 'YXZ';
      v.camera.rotation.set(v.pitch + v.recoilP + v.flinch * Math.sin(performance.now() / 30), v.yaw + v.recoilY, me.m.slide > 0 ? -0.06 : 0);
    } else {
      // Death cam: rise over the body (never through a ceiling) and look at the killer.
      v.deadT += dt;
      const k = g.soldier(me.killedBy);
      const y0 = me.m.y + 1.2;
      const up = Math.min(1, v.deadT) * 1.8;
      const roof = g.level.raycast(me.m.x, y0, me.m.z, 0, 1, 0, up + 0.3);
      v.camera.position.set(me.m.x, y0 + Math.max(0, Math.min(up, roof.t - 0.3)), me.m.z);
      if (k && k !== me) v.camera.lookAt(k.m.x, k.m.y + 1.4, k.m.z);
    }
    // FOV: ADS zooms in; sprint (+9°) and slide (+12°) widen it, eased over ~0.15 s.
    const boost = me.alive ? (me.m.slide > 0 ? 12 : me.m.sprinting ? 9 : 0) * (1 - me.adsT) : 0;
    v.fovBoost += (boost - v.fovBoost) * (1 - Math.exp(-dt / 0.05));
    const zoom = 1 + (w.def.zoom - 1) * me.adsT;
    const baseV = (2 * Math.atan(Math.tan(((this.settings.fov + v.fovBoost) * Math.PI) / 360) / Math.max(1, v.camera.aspect))) * (180 / Math.PI);
    const fov = pu ? baseV / (pu.kind === 'gunner' ? 1.6 + me.adsT : pu.kind === 'drone' ? 1.2 : 1) : Math.max(10, baseV / (v.vm.scoped ? w.def.zoom : zoom));
    if (Math.abs(v.camera.fov - fov) > 0.01) {
      v.camera.fov = fov;
      v.camera.updateProjectionMatrix();
    }
    // My own footsteps.
    v.stepT -= dt * Math.hypot(me.m.vx, me.m.vz) * (me.m.onGround ? 1 : 0);
    if (v.stepT <= 0 && me.alive && !me.m.crouched && !me.ctrl) {
      v.stepT = 2.3;
      this.audio.footstep(1.5, 0, this.surfaceAt(me.m.x, me.m.y, me.m.z));
    }
    // Viewmodel.
    const f = v.lastFrame;
    const reloadTotal = w.ammo === 0 ? w.def.reloadEmpty : w.def.reload;
    v.vm.update(dt, {
      adsT: me.adsT,
      speed: Math.hypot(me.m.vx, me.m.vz),
      sprint: me.m.sprinting,
      grounded: me.m.onGround,
      crouch: me.m.crouched,
      slide: me.m.slide > 0,
      reload: me.reloadT > 0 ? 1 - me.reloadT / reloadTotal : -1,
      swap: me.swapT > 0 ? Math.sin((me.swapT / 0.55) * Math.PI) : 0,
      melee: me.meleeT > 0 ? 1 - me.meleeT / 0.7 : -1,
      cooking: me.cookStart >= 0,
      lookDX: ((f?.dyaw ?? 0) / Math.max(dt, 1e-3)) * 0.02,
      lookDY: ((f?.dpitch ?? 0) / Math.max(dt, 1e-3)) * 0.02,
    });
    // Hide my own body (and the drone / gunship I'm sitting in) in my view.
    const body = this.bodies.get(v.id);
    const bodyWas = body?.root.visible ?? false;
    if (body) body.root.visible = false;
    const uv = pu && pu.kind !== 'rcxd' ? this.unitViews.get(pu.id) : undefined;
    if (uv) uv.visible = false;
    // Viewport (WebGL's y is bottom-up).
    if (this.views.length > 1) {
      const y = this.H - v.y - v.h;
      this.renderer.setViewport(v.x, y, v.w, v.h);
      this.renderer.setScissor(v.x, y, v.w, v.h);
    }
    this.renderer.render(this.scene, v.camera);
    if (me.alive && !pu) {
      this.renderer.clearDepth();
      this.renderer.render(v.vm.scene, v.vm.camera);
    }
    if (body) body.root.visible = bodyWas;
    if (uv) uv.visible = true;
    if (this.views.length > 1) this.renderer.shadowMap.needsUpdate = false;
  }
}

const RESPAWN_HIDE = 0.4;
