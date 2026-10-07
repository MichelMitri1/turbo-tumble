import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Game, TICK, type GameEvent, type Soldier } from './sim/game';
import { BotBrain, type BotSkill } from './sim/bots';
import { NO_INPUT, eyeHeight, type Input } from './sim/player';
import { WEAPON, type WeaponClass } from './sim/weapons';
import { buildMap, makeHeli, makeJet, makeTag, type MapView } from './render/world3d';
import { ViewModel } from './render/viewmodel';
import { SoldierView, type Pose } from './render/soldiers';
import { Fx } from './render/fx';
import { camoTime, progress } from './render/camo';
import { Hud, MEDAL_NAMES } from './hud';
import type { FpsInput, FrameInput } from './input';
import type { FpsAudio } from './audio';

export interface MatchSettings {
  fov: number;
  quality: 'high' | 'low';
}

/** Source of truth for a match: a local game with bots, or an online mirror. */
export interface Session {
  readonly game: Game;
  readonly meId: string;
  readonly online: boolean;
  /** Interpolation factor between the last two ticks. */
  alpha: number;
  /** Advance with the local player's per-tick input builder; returns new events. */
  update(dt: number, input: () => Input): GameEvent[];
  /** Interpolated render position of a soldier. */
  pose(s: Soldier): { x: number; y: number; z: number; yaw: number; pitch: number; vx: number; vz: number };
  dispose(): void;
}

export class LocalSession implements Session {
  readonly online = false;
  readonly meId = 'me';
  alpha = 0;
  private acc = 0;
  private prev = new Map<string, [number, number, number]>();
  private readonly bots: BotBrain;
  private readonly inputs = new Map<string, Input>();

  constructor(
    readonly game: Game,
    skill: BotSkill,
  ) {
    this.bots = new BotBrain(game, skill);
  }

  update(dt: number, input: () => Input): GameEvent[] {
    const out: GameEvent[] = [];
    this.acc = Math.min(this.acc + dt, 0.2);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      for (const s of this.game.soldiers) this.prev.set(s.id, [s.m.x, s.m.y, s.m.z]);
      this.inputs.clear();
      this.bots.update(TICK, this.inputs);
      this.inputs.set(this.meId, input());
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

/** One match on screen: rendering, camera, viewmodel, HUD, effects, sounds. */
export class Match {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly hud: Hud;
  private mapView: MapView;
  private vm: ViewModel;
  private fx = new Fx();
  private views = new Map<string, SoldierView>();
  private heliViews = new Map<number, THREE.Group>();
  private jets: Array<{ g: THREE.Group; t: number; from: THREE.Vector3; dir: THREE.Vector3 }> = [];
  private tagViews = new Map<number, THREE.Group>();
  private grenadeViews = new Map<number, THREE.Object3D>();
  private nadeGeo = new THREE.SphereGeometry(0.06, 8, 6);
  private nadeMat = new THREE.MeshStandardMaterial({ color: '#2f3a24', roughness: 0.6 });
  // View state.
  yaw = 0;
  pitch = 0;
  private recoilP = 0;
  private recoilY = 0;
  private eyeY = 1.62;
  private shake = 0;
  private flinch = 0;
  private vmKey = '';
  private lastFrame: FrameInput | null = null;
  private latch = { reload: false, slot: -1, melee: false, streak: false, jump: false };
  private seq = 0;
  private stepT = 0;
  private wasAlive = true;
  private deadT = 0;
  over = false;
  onOver: ((g: Game) => void) | null = null;
  onPause: (() => void) | null = null;
  private lastSoundDist = 0;

  constructor(
    private readonly host: HTMLElement,
    readonly session: Session,
    private readonly input: FpsInput,
    private readonly audio: FpsAudio,
    public settings: MatchSettings,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: settings.quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'high' ? 1.75 : 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = settings.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 900);
    const g = session.game;
    this.mapView = buildMap(this.scene, this.renderer, g.map);
    if (settings.quality !== 'high') this.mapView.sun.castShadow = false;
    this.scene.add(this.fx.group);
    const me = this.me;
    this.vm = new ViewModel(me.team);
    // Reflections so metallic camos (Gold, Platinum, Diamond) shine in first person.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.vm.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.vm.scene.environmentIntensity = 0.45;
    pmrem.dispose();
    this.hud = new Hud(host);
    this.hud.buildMinimap(g);
    this.hud.show(true);
    this.yaw = me.m.yaw;
    addEventListener('resize', this.onResize);
    this.onResize();
    this.input.enabled = true;
  }

  get me(): Soldier {
    return this.session.game.soldier(this.session.meId)!;
  }

  private onResize = () => {
    const w = this.host.clientWidth || innerWidth;
    const h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vm.resize(w / h);
    this.fx.resize(h * this.renderer.getPixelRatio(), this.camera.fov);
  };

  dispose(): void {
    removeEventListener('resize', this.onResize);
    this.input.enabled = false;
    this.input.unlock();
    this.audio.heliLoop(false);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hud.el.remove();
    this.session.dispose();
  }

  /** Build this tick's input from the latest frame (edges are latched until a tick uses them). */
  private buildInput = (): Input => {
    const f = this.lastFrame;
    const me = this.me;
    const inp: Input = { ...NO_INPUT, seq: ++this.seq, yaw: this.yaw + this.recoilY, pitch: this.pitch + this.recoilP };
    if (f) {
      inp.mx = f.mx;
      inp.mz = f.mz;
      inp.jump = f.jump || this.latch.jump;
      inp.sprint = f.sprint;
      inp.crouch = f.crouch;
      inp.ads = f.ads;
      inp.fire = f.fire;
      inp.grenade = f.grenade;
    }
    inp.reload = this.latch.reload;
    inp.melee = this.latch.melee;
    inp.streak = this.latch.streak;
    inp.slot = this.latch.slot >= 0 ? this.latch.slot : -1;
    if (this.latch.slot === -2) inp.slot = 1 - me.cur;
    this.latch = { reload: false, slot: -1, melee: false, streak: false, jump: false };
    return inp;
  };

  frame(dt: number): void {
    const g = this.session.game;
    const me = this.me;
    const w = me.weapons[me.cur];
    // Controller aim assist: slow the stick when the crosshair is on someone.
    const target = this.aimTarget(40, 0.07);
    const f = this.input.poll(dt, me.adsT, target && this.input.device === 'pad' && this.input.settings.aimAssist ? 0.55 : 1);
    this.lastFrame = f;
    if (f.reload) this.latch.reload = true;
    if (f.melee) this.latch.melee = true;
    if (f.streak) this.latch.streak = true;
    if (f.jump) this.latch.jump = true;
    if (f.slot >= 0) this.latch.slot = f.slot;
    if (f.swap) this.latch.slot = -2;
    if (f.menu) this.onPause?.();
    // Look.
    if (me.alive) {
      this.yaw += f.dyaw;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + f.dpitch));
      // Rotational aim assist: drift towards a target you're tracking while moving.
      if (target && this.input.device === 'pad' && this.input.settings.aimAssist && (f.mx || f.mz || Math.abs(f.dyaw) > 0)) {
        const dx = target.m.x - me.m.x;
        const dz = target.m.z - me.m.z;
        const want = Math.atan2(-dx, -dz);
        let d = want - (this.yaw + this.recoilY);
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.yaw += d * Math.min(1, dt * (1.5 + me.adsT * 2));
      }
    }
    // Recoil recovery (most of it comes back when you stop shooting).
    const firing = f.fire && me.alive;
    const rec = firing ? 1.5 : 7;
    this.recoilP -= this.recoilP * Math.min(1, dt * rec);
    this.recoilY -= this.recoilY * Math.min(1, dt * rec);
    // Simulate.
    const events = this.session.update(dt, this.buildInput);
    for (const e of events) this.handle(e);
    // Respawn: snap the view to the spawn direction.
    if (me.alive && !this.wasAlive) {
      this.yaw = me.m.yaw;
      this.pitch = 0;
      this.recoilP = this.recoilY = 0;
    }
    this.wasAlive = me.alive;
    camoTime.value += dt;
    this.render(dt, f);
    // HUD.
    const enemy = this.aimTarget(60, 0.03);
    this.hud.update(dt, g, me, {
      spread: Math.tan(g.spread(me)) / Math.tan(((this.camera.fov / 2) * Math.PI) / 180),
      ads: me.adsT,
      scoped: this.vm.scoped,
      scope: this.vm.scope,
      yaw: this.yaw,
      enemyName: enemy ? enemy.name : '',
      scoreboard: f.scoreboard || g.phase === 'over',
      pad: this.input.device === 'pad',
      reloadP: me.reloadT > 0 ? 1 - me.reloadT / (w.ammo === 0 ? w.def.reloadEmpty : w.def.reload) : -1,
    });
    if (g.phase === 'over' && !this.over) {
      this.over = true;
      this.input.unlock();
      setTimeout(() => this.onOver?.(g), 2500);
    }
  }

  /** The enemy under the crosshair (within angle, visible). */
  private aimTarget(range: number, ang: number): Soldier | null {
    const g = this.session.game;
    const me = this.me;
    if (!me.alive) return null;
    const eye = g.eye(me);
    const d = Game.dir(this.yaw + this.recoilY, this.pitch + this.recoilP);
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
      if (a < bestA + 0.6 / dist && g.level.visible(eye[0], eye[1], eye[2], o.m.x, o.m.y + 1.2, o.m.z)) {
        bestA = a;
        best = o;
      }
    }
    return best;
  }

  private distTo(x: number, y: number, z: number): [number, number] {
    const me = this.me;
    const dx = x - me.m.x;
    const dz = z - me.m.z;
    const d = Math.hypot(dx, y - me.m.y - 1.5, dz);
    const ang = Math.atan2(-dx, -dz) - this.yaw;
    return [d, -Math.sin(ang)];
  }

  private handle(e: GameEvent): void {
    const g = this.session.game;
    const me = this.me;
    const mine = (id: string) => id === me.id;
    switch (e.k) {
      case 'shot': {
        const w = WEAPON[e.w];
        const cls: WeaponClass = w?.cls ?? 'ar';
        if (mine(e.by)) {
          this.vm.fire();
          this.audio.shot(cls, e.sup, 0);
          // Recoil (camera kick).
          const ws = me.weapons[me.cur].def;
          const k = 1 - me.adsT * 0.35;
          this.recoilP += ((ws.recoilV * Math.PI) / 180) * k;
          this.recoilY += (((Math.random() - 0.35) * 2 * ws.recoilH * Math.PI) / 180) * k;
          this.shake = Math.max(this.shake, cls === 'sniper' || cls === 'shotgun' ? 0.25 : 0.06);
          this.input.rumble(cls === 'sniper' || cls === 'shotgun' ? 0.8 : 0.35, 0.3, 60);
          this.camera.updateMatrixWorld();
          this.vm.muzzleWorld(v1, this.camera);
          for (const h of e.hits) {
            v2.set(h[0], h[1], h[2]);
            this.fx.tracer(v1, v2, cls === 'shotgun' ? 0.4 : 0.8);
            this.impactAt(e.fx, e.fy, e.fz, v2, !!h[3]);
          }
          if (w?.mode === 'bolt' || w?.mode === 'pump') setTimeout(() => this.audio.bolt(), 250);
        } else {
          const v = this.views.get(e.by);
          v?.fired();
          const [d, pan] = this.distTo(e.fx, e.fy, e.fz);
          this.audio.shot(cls, e.sup, d, pan);
          const from = v ? v.muzzle : v1.set(e.fx, e.fy, e.fz);
          if (!e.sup) this.fx.muzzle(from);
          for (const h of e.hits) {
            v2.set(h[0], h[1], h[2]);
            this.fx.tracer(from, v2, cls === 'shotgun' ? 0.25 : 0.55);
            this.impactAt(e.fx, e.fy, e.fz, v2, !!h[3]);
          }
        }
        break;
      }
      case 'hit':
        if (mine(e.by)) {
          this.hud.hitmarker(e.kill, e.head);
          this.audio.hitmarker(e.kill, e.head);
        }
        if (mine(e.target)) {
          this.hud.damageFrom(e.fx, e.fz);
          this.audio.hurt();
          this.flinch = Math.min(0.06, 0.02 + e.dmg / 1500);
          this.input.rumble(0.6, 0.6, 120);
        }
        break;
      case 'kill': {
        const k = g.soldier(e.killer);
        const vv = g.soldier(e.victim);
        if (k && vv) this.hud.killfeed(k.name, k.team, vv.name, vv.team, e.weapon, e.head, me.team, g.mode === 'ffa');
        if (mine(e.killer) && !mine(e.victim) && WEAPON[e.weapon]) {
          const unlocked = progress.addKill(e.weapon);
          if (unlocked) this.hud.center(`<small>CAMO UNLOCKED</small><b>${unlocked.toUpperCase()}</b><span>${WEAPON[e.weapon]!.name}</span>`, 3);
        }
        if (mine(e.victim)) this.deadT = 0;
        break;
      }
      case 'medal':
        if (mine(e.who)) {
          this.hud.popup(MEDAL_NAMES[e.medal], e.xp, true);
          this.audio.medal();
        }
        break;
      case 'score':
        if (mine(e.who) && e.why !== 'Kill') this.hud.popup(e.why.toUpperCase(), e.pts);
        else if (mine(e.who)) this.hud.popup('KILL', e.pts);
        break;
      case 'streakEarned':
        if (mine(e.who)) {
          const name = { uav: 'UAV', airstrike: 'Precision Airstrike', heli: 'Attack Helicopter' }[e.streak];
          this.hud.center(`<small>KILLSTREAK READY</small><b>${name.toUpperCase()}</b><span>${this.input.device === 'pad' ? 'D-pad →' : 'Press 4'}</span>`, 2.5);
          this.audio.say(`${name} ready`);
        }
        break;
      case 'streakUsed': {
        const friendly = g.mode === 'ffa' ? mine(e.who) : e.team === me.team;
        const says = { uav: friendly ? 'U A V online' : 'Enemy U A V spotted', airstrike: friendly ? 'Airstrike inbound' : 'Enemy airstrike inbound', heli: friendly ? 'Attack helicopter inbound' : 'Enemy attack helicopter' }[e.streak];
        this.audio.say(says);
        this.hud.popup(says.replace('U A V', 'UAV').toUpperCase(), 0);
        if (e.streak === 'airstrike' && e.x !== undefined) {
          const dir = new THREE.Vector3(e.dx!, 0, e.dz!);
          for (let k = 0; k < 2; k++) {
            const jet = makeJet();
            this.scene.add(jet);
            const from = new THREE.Vector3(e.x - e.dx! * 120 + k * 6 * e.dz!, 40 + k * 3, e.z! - e.dz! * 120 - k * 6 * e.dx!);
            jet.lookAt(jet.position.clone().add(dir));
            this.jets.push({ g: jet, t: 0, from, dir });
          }
          setTimeout(() => this.audio.jet(), 1200);
        }
        break;
      }
      case 'explosion': {
        v1.set(e.x, e.y, e.z);
        this.fx.explosion(v1, e.r);
        const [d, pan] = this.distTo(e.x, e.y, e.z);
        this.audio.explosion(d, pan);
        this.shake = Math.max(this.shake, Math.max(0, 1 - d / 25) * 0.9);
        if (d < 15) this.input.rumble(1, 1, 300);
        // Barrels vanish.
        for (const [i, b] of g.barrels.entries()) if (!b.alive && this.mapView.barrels[i]) this.mapView.barrels[i]!.visible = false;
        break;
      }
      case 'heliShot': {
        v1.set(e.x, e.y, e.z);
        v2.set(e.tx, e.ty, e.tz);
        this.fx.tracer(v1, v2, 1);
        this.fx.impact(v2, new THREE.Vector3(0, 1, 0), 'dust');
        const [d, pan] = this.distTo(e.x, e.y, e.z);
        this.audio.shot('lmg', false, d, pan);
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
      case 'flag':
        this.audio.capture();
        {
          const f = g.flags[e.flag]!;
          const ours = e.team === me.team;
          this.hud.center(`<b>${e.team === -1 ? `${f.name} NEUTRALISED` : ours ? `SECURED ${f.name}` : `LOST ${f.name}`}</b>`, 1.6);
          if (e.team !== -1) this.audio.say(ours ? `${f.name} secured` : `We've lost ${f.name}`);
        }
        break;
      case 'tag':
        break;
      case 'reload':
        if (mine(e.who)) {
          const w = me.weapons[me.cur];
          this.audio.reload(w.def.cls, me.reloadT);
        }
        break;
      case 'empty':
        if (mine(e.who)) this.audio.empty();
        break;
      case 'melee':
        if (mine(e.who)) this.audio.knife(e.hit);
        break;
      case 'grenadeThrow':
        if (mine(e.who)) this.audio.grenadePin();
        break;
      case 'over': {
        const won = g.mode === 'ffa' ? e.top === me.id : e.winner === me.team;
        this.audio.say(e.winner === -1 && g.mode !== 'ffa' ? 'Draw' : won ? 'Victory' : 'Defeat');
        break;
      }
    }
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

  private render(dt: number, f: FrameInput): void {
    const g = this.session.game;
    const me = this.me;
    const w = me.weapons[me.cur];
    // Viewmodel weapon.
    const key = `${w.def.id}:${JSON.stringify(w.att)}:${me.camos[w.def.id] ?? 'none'}`;
    if (key !== this.vmKey) {
      this.vmKey = key;
      this.vm.setWeapon(w.def, w.att, me.camos[w.def.id] ?? 'none');
    }
    // Camera.
    const p = this.session.pose(me);
    const targetEye = eyeHeight(me.m);
    this.eyeY += (targetEye - this.eyeY) * Math.min(1, dt * 12);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.flinch = Math.max(0, this.flinch - dt * 0.4);
    const sh = this.shake * 0.04;
    if (me.alive) {
      this.camera.position.set(p.x + (Math.random() - 0.5) * sh, p.y + this.eyeY + (Math.random() - 0.5) * sh, p.z + (Math.random() - 0.5) * sh);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(this.pitch + this.recoilP + this.flinch * Math.sin(performance.now() / 30), this.yaw + this.recoilY, me.m.slide > 0 ? -0.06 : 0);
    } else {
      // Death cam: rise over the body and look at the killer.
      this.deadT += dt;
      const k = g.soldier(me.killedBy);
      const up = Math.min(1, this.deadT);
      this.camera.position.set(me.m.x, me.m.y + 1.2 + up * 1.8, me.m.z);
      if (k && k !== me) this.camera.lookAt(k.m.x, k.m.y + 1.4, k.m.z);
    }
    const zoom = 1 + (w.def.zoom - 1) * me.adsT;
    const baseV = (2 * Math.atan(Math.tan((this.settings.fov * Math.PI) / 360) / Math.max(1, this.camera.aspect))) * (180 / Math.PI);
    const fov = Math.max(10, baseV / (this.vm.scoped ? w.def.zoom : zoom));
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // Other soldiers.
    const seen = new Set<string>();
    for (const s of g.soldiers) {
      if (s === me) continue;
      seen.add(s.id);
      let v = this.views.get(s.id);
      if (!v) {
        v = new SoldierView(s.team);
        this.views.set(s.id, v);
        this.scene.add(v.root);
      }
      const sp = this.session.pose(s);
      const pose: Pose = { ...sp, crouch: s.m.crouched, sprint: s.m.sprinting, slide: s.m.slide > 0, ads: s.adsT > 0.5, alive: s.alive || s.respawnIn > 0.2, weapon: s.weapons[s.cur].def.id, camo: s.camos[s.weapons[s.cur].def.id] ?? 'none', reloading: s.reloadT > 0 };
      if (!s.alive && s.respawnIn < RESPAWN_HIDE) v.root.visible = false;
      else v.root.visible = true;
      pose.alive = s.alive;
      v.update(pose, dt);
      // Footsteps.
      if (s.alive && s.m.onGround && Math.hypot(s.m.vx, s.m.vz) > 3 && !s.m.crouched) {
        const [d, pan] = this.distTo(s.m.x, s.m.y, s.m.z);
        if (d < 22 && Math.random() < dt * (s.m.sprinting ? 3.4 : 2.4)) this.audio.footstep(d, pan);
      }
    }
    for (const [id, v] of this.views) if (!seen.has(id)) {
      v.dispose();
      this.views.delete(id);
    }
    // My footsteps.
    this.stepT -= dt * Math.hypot(me.m.vx, me.m.vz) * (me.m.onGround ? 1 : 0);
    if (this.stepT <= 0 && me.alive && !me.m.crouched) {
      this.stepT = 2.3;
      this.audio.footstep(1.5);
    }
    // Domination flags.
    this.mapView.flags.forEach((fv, i) => {
      const fl = g.flags[i];
      fv.group.visible = !!fl;
      if (!fl) return;
      const col = fl.owner === -1 ? '#e8e8e8' : fl.owner === me.team ? '#3c8cff' : '#ff4a3a';
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
        tv = makeTag(t.team === me.team ? 0 : 1);
        this.tagViews.set(t.id, tv);
        this.scene.add(tv);
      }
      tv.position.set(t.x, t.y + Math.sin(performance.now() / 300 + t.id) * 0.08, t.z);
      tv.rotation.y += dt * 2.5;
    }
    for (const [id, tv] of this.tagViews) if (!tagSeen.has(id)) {
      tv.removeFromParent();
      this.tagViews.delete(id);
    }
    // Grenades.
    const nadeSeen = new Set<number>();
    for (const n of g.grenades) {
      nadeSeen.add(n.id);
      let o = this.grenadeViews.get(n.id);
      if (!o) {
        o = new THREE.Mesh(this.nadeGeo, this.nadeMat);
        this.grenadeViews.set(n.id, o);
        this.scene.add(o);
      }
      o.position.set(n.x, n.y, n.z);
    }
    for (const [id, o] of this.grenadeViews) if (!nadeSeen.has(id)) {
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
        hv = makeHeli(g.mode === 'ffa' ? (h.owner === me.id ? 0 : 1) : h.team === me.team ? 0 : 1);
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
      nearest = Math.min(nearest, Math.hypot(h.x - me.m.x, h.z - me.m.z));
    }
    for (const [id, hv] of this.heliViews) if (!heliSeen.has(id)) {
      hv.removeFromParent();
      this.heliViews.delete(id);
    }
    this.audio.heliLoop(g.helis.length > 0, nearest);
    // Jets.
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i]!;
      j.t += dt;
      j.g.position.copy(j.from).addScaledVector(j.dir, j.t * 95);
      if (j.t > 3) {
        j.g.removeFromParent();
        this.jets.splice(i, 1);
      }
    }
    this.fx.update(dt);
    // Viewmodel.
    const reloadTotal = w.ammo === 0 ? w.def.reloadEmpty : w.def.reload;
    this.vm.update(dt, {
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
      lookDX: f.dyaw / Math.max(dt, 1e-3) * 0.02,
      lookDY: f.dpitch / Math.max(dt, 1e-3) * 0.02,
    });
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (me.alive) {
      this.renderer.clearDepth();
      this.renderer.render(this.vm.scene, this.vm.camera);
    }
    void this.lastSoundDist;
  }
}

const RESPAWN_HIDE = 0.4;
