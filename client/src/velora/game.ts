import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { assets, type CarModel, type PersonModel } from './assets';
import { Audio } from './audio';
import { WEAPON, type WeaponDef } from './combat';
import { Input, type Frame } from './input';
import { physics } from './physics';
import { CityView } from './render/cityview';
import { CameraRig } from './render/camera';
import { Fx } from './render/fx';
import { Hud } from './ui/hud';
import { ShopUI } from './ui/shops';
import { Peds, type Ped } from './actors/peds';
import { Player } from './actors/player';
import { Police, type Crime } from './actors/police';
import { Driver, laneSpot, lightFor, spawnTraffic } from './actors/traffic';
import { PAINTS, PARKED_MIX, TRAFFIC_MIX, Vehicle } from './actors/vehicle';
import { buildCity, districtName, type City, type Shop } from './world/city';
import { WATER_Y } from './world/layout';
import type { VeloraNet } from './net/online';
import { Remotes } from './net/remote';
import type { CarState, PlayerState } from './net/protocol';
import { OnlineUI } from './ui/online';

/**
 * Velora: the open city. Owns the scene, the physics world, everyone in it, the day /
 * night cycle and the main loop; the population manager keeps the streets busy around
 * you (pedestrians, traffic, parked cars) like the big sandbox games do.
 */

const STEP = 1 / 60;

export interface SaveData {
  cash: number;
  model: PersonModel;
  armor: number;
  weapons: Array<[string, number]>;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam = new CameraRig();
  readonly input: Input;
  readonly physics = physics;
  readonly city: City;
  readonly fx = new Fx();
  readonly audio = new Audio();
  readonly hud: Hud;
  readonly shops: ShopUI;
  view!: CityView;
  player!: Player;
  peds!: Peds;
  police!: Police;
  vehicles: Vehicle[] = [];
  traffic: Driver[] = [];
  time = 0;
  /** Hour of day (0–24). */
  clock = 14;
  paused = false;
  godMode = false;
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5d6b4e, 1.2);
  private sky = new Sky();
  private boxGrid = new Map<string, Array<{ x: number; z: number; c: number; s: number; hx: number; hz: number; y: number; h: number }>>();
  /** Cars put away for reuse (spawning mid-game without hitches). */
  private pool = new Map<string, Vehicle[]>();
  private byCollider = new Map<number, Vehicle>();
  private events = new RAPIER.EventQueue(true);
  private parked = new Map<number, Vehicle>();
  private parkedUsed = new Set<number>();
  private popT = 0;
  private acc = 0;
  private last = 0;
  private deadT = 0;
  private bustedT = 0;
  private counted = new WeakSet<Ped>();
  private rockets: Array<{ m: THREE.Mesh; p: THREE.Vector3; v: THREE.Vector3; life: number }> = [];
  private pickups: Array<{ m: THREE.Object3D; x: number; y: number; z: number; cash: number; weapon?: WeaponDef; ammo?: number; t: number }> = [];
  private robberies = new Map<Shop, number>();
  /** The car you bought / last drove (kept around). */
  private ownCars = new Set<Vehicle>();
  private mapEl: HTMLElement | null = null;
  /** First-person gun (held in front of the camera). */
  private viewGun = new THREE.Group();
  private viewKey = '';
  private viewTip = new THREE.Object3D();
  private recoil = 0;
  private pauseEl: HTMLElement | null = null;
  private routeT = 0;
  onQuit: (() => void) | null = null;

  /** Online session (null = story / single player). */
  net: VeloraNet | null = null;
  remotes = new Remotes(this);
  online: OnlineUI | null = null;
  /** The car you last got out of (online: others see it and can take it). */
  myParked: Vehicle | null = null;
  /** Who last hurt you (online kill credit). */
  private lastHitBy: { id: string; t: number } | null = null;
  private sendT = 0;
  private remoteHitT = new Map<string, number>();
  private diedSent = false;

  constructor(private root: HTMLElement, character: PersonModel, save: SaveData | null, net: VeloraNet | null = null) {
    this.net = net;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    root.appendChild(this.renderer.domElement);
    this.input = new Input(this.renderer.domElement);
    const kits = { ...assets.manifest.kits, fps: assets.fpsBounds };
    this.city = buildCity(kits);
    this.hud = new Hud(root, this);
    this.shops = new ShopUI(this);
    this.setupWorld(character, save);
    addEventListener('resize', this.resize);
    this.resize();
    this.renderer.domElement.addEventListener('click', () => {
      if (!this.paused && !this.shops.open) this.input.lock();
      this.audio.start();
    });
    addEventListener('keydown', this.onKey);
  }

  private setupWorld(character: PersonModel, save: SaveData | null): void {
    const s = this.scene;
    // Sky + sun + fog.
    this.sky.scale.setScalar(1500);
    const u = this.sky.material.uniforms;
    u.turbidity!.value = 4;
    u.rayleigh!.value = 1.2;
    u.mieCoefficient!.value = 0.004;
    u.mieDirectionalG!.value = 0.85;
    s.add(this.sky);
    s.fog = new THREE.Fog(0xbcd2e6, 260, 900);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.near = 1;
    sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    s.add(this.sun, this.sun.target, this.hemi);
    // The camera carries the first-person gun.
    s.add(this.cam.camera);
    this.cam.camera.add(this.viewGun);
    // City.
    this.view = new CityView(this.city);
    s.add(this.view.root, this.fx.root);
    // Building lookup for people (2D push-out).
    for (const p of this.city.placements) {
      if (!p.box) continue;
      const b = { x: p.x, z: p.z, c: Math.cos(p.yaw), s: Math.sin(p.yaw), hx: p.box.hx, hz: p.box.hz, y: p.y, h: p.box.h };
      const r = Math.hypot(b.hx, b.hz);
      for (let gx = Math.floor((p.x - r) / 16); gx <= Math.floor((p.x + r) / 16); gx++)
        for (let gz = Math.floor((p.z - r) / 16); gz <= Math.floor((p.z + r) / 16); gz++) {
          const k = `${gx},${gz}`;
          if (!this.boxGrid.has(k)) this.boxGrid.set(k, []);
          this.boxGrid.get(k)!.push(b);
        }
    }
    this.peds = new Peds(this);
    this.peds.prewarm(36);
    this.police = new Police(this);
    const sp = this.city.spawn;
    this.player = new Player(this, save?.model ?? character, sp.x, sp.z, this.groundY(sp.x, sp.z, 80));
    if (save) {
      this.player.cash = save.cash;
      this.player.armor = save.armor;
    }
    // Every weapon, bottomless ammo.
    this.player.inv.infinite = true;
    for (const w of Object.keys(WEAPON)) if (w !== 'fist') this.player.inv.give(w, 999);
    this.cam.yaw = sp.h + Math.PI;
    // A car to start with, parked by the curb next to you.
    const start = this.addVehicle('sports', sp.x - Math.sin(sp.h) * 6, sp.z - Math.cos(sp.h) * 6, sp.h, 0xc62828);
    this.ownCars.add(start);
    // Warm the car pool so the first minutes of driving don't hitch.
    for (const m of [...TRAFFIC_MIX.slice(0, 10), ...PARKED_MIX.slice(0, 6)]) {
      const v = new Vehicle(m, 0, 0, 0);
      v.park();
      this.byCollider.set(v.collider.handle, v);
      if (!this.pool.has(m)) this.pool.set(m, []);
      this.pool.get(m)!.push(v);
    }
  }

  private resize = (): void => {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
  };

  start(): void {
    this.last = performance.now();
    requestAnimationFrame(this.frame);
    this.hud.flash('WELCOME TO VELORA', 'info');
    this.hud.help('Click to look around. <b>WASD</b> move · <b>Shift</b> sprint · <b>F</b> get in a car · <b>RMB</b> aim · <b>LMB</b> shoot · <b>M</b> map', 8);
  }

  // ---------------------------------------------------------------- queries

  /** Ground height under a point: the land, a bridge / freeway deck, a roof (ray down from `fromY`). */
  groundY(x: number, z: number, fromY: number): number {
    const hit = this.physics.world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), fromY + 20, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    return hit ? fromY - hit.timeOfImpact : this.city.terrain.height(x, z);
  }
  /** Push a person (radius r) out of buildings (rotated boxes). */
  solid(x: number, z: number, r: number): [number, number] {
    const list = this.boxGrid.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`);
    if (!list) return [x, z];
    for (const b of list) {
      // Into the box's frame.
      const dx = x - b.x;
      const dz = z - b.z;
      const lx = dx * b.c - dz * b.s;
      const lz = dx * b.s + dz * b.c;
      const ox = b.hx + r - Math.abs(lx);
      const oz = b.hz + r - Math.abs(lz);
      if (ox > 0 && oz > 0) {
        let nx = lx;
        let nz = lz;
        if (ox < oz) nx += Math.sign(lx) * ox;
        else nz += Math.sign(lz) * oz;
        x = b.x + nx * b.c + nz * b.s;
        z = b.z - nx * b.s + nz * b.c;
      }
    }
    return [x, z];
  }
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const hit = this.physics.world.castRay(new RAPIER.Ray({ x: ax, y: ay, z: az }, { x: dx / d, y: dy / d, z: dz / d }), d, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    return !hit;
  }
  vehicleByCollider(handle: number): Vehicle | undefined {
    return this.byCollider.get(handle);
  }
  areaName(): string {
    return districtName(this.player.pos.x, this.player.pos.z);
  }
  private streetT = 0;
  private street = '';
  streetName(): string {
    if (this.time - this.streetT > 0.5) {
      this.streetT = this.time;
      const p = this.player.pos;
      this.street = this.city.net.nearest(p.x, p.z, 40)?.e.name ?? '';
    }
    return this.street;
  }

  // ---------------------------------------------------------------- spawning

  addVehicle(model: CarModel, x: number, z: number, heading: number, paint?: number, y?: number): Vehicle {
    const col = paint ?? PAINTS[Math.floor(Math.random() * PAINTS.length)];
    const gy = y ?? this.groundY(x, z, 80) + 0.3;
    let v = this.pool.get(model)?.pop();
    if (v) v.reset(x, z, heading, col, gy);
    else {
      v = new Vehicle(model, x, z, heading, col);
      v.reset(x, z, heading, undefined, gy);
      this.byCollider.set(v.collider.handle, v);
    }
    this.vehicles.push(v);
    this.scene.add(v.root);
    return v;
  }
  removeVehicle(v: Vehicle): void {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    this.traffic = this.traffic.filter((d) => d.car !== v);
    for (const [k, pv] of this.parked) if (pv === v) this.parked.delete(k);
    this.ownCars.delete(v);
    const list = this.pool.get(v.def.model) ?? [];
    if (v.reusable && list.length < 6) {
      v.park();
      list.push(v);
      this.pool.set(v.def.model, list);
    } else {
      this.byCollider.delete(v.collider.handle);
      v.dispose();
    }
  }
  /** Velora Motors: your new car waits outside. */
  deliverCar(model: string, shop: Shop): void {
    const v = this.addVehicle(model as CarModel, shop.x + shop.fx * 8, shop.z + shop.fz * 8, Math.atan2(-shop.fz, shop.fx), PAINTS[Math.floor(Math.random() * PAINTS.length)]);
    this.ownCars.add(v);
    this.hud.flash(`${v.def.name} DELIVERED`, 'good');
  }

  // ---------------------------------------------------------------- events from actors

  crime(kind: Crime, x: number, z: number, witnessed?: boolean): void {
    let w = witnessed ?? false;
    if (witnessed === undefined)
      for (const p of this.peds.list)
        if (!p.dead && p.role === 'civ' && Math.hypot(p.x - x, p.z - z) < 28) {
          w = true;
          break;
        }
    this.police.crime(kind, x, z, w);
  }

  shotsFired(x: number, z: number): void {
    this.peds.panic(x, z, 50);
    for (const d of this.traffic)
      if (d.mode === 'traffic' && d.car.pos.distanceTo(new THREE.Vector3(x, d.car.pos.y, z)) < 45) {
        d.mode = 'flee';
        d.fleeT = 12;
      }
    // Firing a gun near people is a crime; the police hear it if they're around.
    let near = false;
    for (const p of this.peds.list) if (!p.dead && Math.hypot(p.x - x, p.z - z) < 30) near = true;
    if (near) this.crime('shots', x, z);
  }

  jack(v: Vehicle): void {
    const d = this.traffic.find((t) => t.car === v);
    if (!d) return;
    this.traffic.splice(this.traffic.indexOf(d), 1);
    const p = v.pos;
    const h = v.heading;
    const ped = this.peds.spawnAt('civ', p.x + Math.cos(h) * (v.half.x + 1.2), p.z - Math.sin(h) * (v.half.x + 1.2));
    ped.hurt(5, 'player');
    this.crime(v.def.siren ? 'copCar' : 'carjack', p.x, p.z, false);
  }

  enteredCar(v: Vehicle): void {
    this.hud.showNames(v.def.name);
    if (v.def.siren && v.def.model === 'police') this.crime('copCar', v.pos.x, v.pos.z, false);
  }

  carAttacked(car: Vehicle): void {
    const d = this.traffic.find((t) => t.car === car);
    if (d && d.mode === 'traffic') {
      d.mode = 'flee';
      d.fleeT = 15;
    }
    if (d && d.mode === 'pursuit') this.crime('copAssault', car.pos.x, car.pos.z, true);
  }

  robbedRecently(s: Shop): boolean {
    return (this.robberies.get(s) ?? -999) > this.time - 180;
  }
  robbed(s: Shop): void {
    this.robberies.set(s, this.time);
  }

  rocket(from: THREE.Vector3, dir: THREE.Vector3): void {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8), new THREE.MeshBasicMaterial({ color: 0xffd080 }));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.position.copy(from);
    this.scene.add(m);
    this.rockets.push({ m, p: from.clone(), v: dir.clone().multiplyScalar(60), life: 5 });
  }

  explode(at: THREE.Vector3, by: 'player' | Ped | null, remote = false): void {
    if (by === 'player' && !remote) this.net?.boom(at.x, at.y, at.z);
    this.fx.explosion(at);
    this.audio.explosion(at);
    this.peds.panic(at.x, at.z, 70);
    for (const p of this.peds.list) {
      const d = Math.hypot(p.x - at.x, p.z - at.z);
      if (d < 8 && !p.dead) {
        const k = (8 - d) / 8;
        p.hurt(250 * k, by ?? 'player');
        if (p.dead) {
          const dx = (p.x - at.x) / (d || 1);
          const dz = (p.z - at.z) / (d || 1);
          p.vx = dx * 9 * k;
          p.vz = dz * 9 * k;
          p.vy = 7 * k;
        }
      }
    }
    for (const v of this.vehicles) {
      const vp = v.pos;
      const d = vp.distanceTo(at);
      if (d < 9) {
        const k = (9 - d) / 9;
        v.damage(900 * k);
        const dir = vp.clone().sub(at).normalize();
        v.body.applyImpulse({ x: dir.x * v.def.mass * 6 * k, y: v.def.mass * 7 * k, z: dir.z * v.def.mass * 6 * k }, true);
        v.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * v.def.mass * 4 * k, y: 0, z: (Math.random() - 0.5) * v.def.mass * 4 * k }, true);
      }
    }
    const pd = this.player.pos.distanceTo(at);
    if (pd < 9) this.player.hurt(160 * ((9 - pd) / 9));
    if (by === 'player') this.crime('explosion', at.x, at.z);
  }

  // ---------------------------------------------------------------- the loop

  private onKey = (e: KeyboardEvent): void => {
    if (this.shops.open) {
      e.preventDefault();
      this.shops.key(e.code);
      this.input.consume();
      if (!this.shops.open) this.input.lock();
      return;
    }
    if (this.mapEl && (e.code === 'Escape' || e.code === 'KeyM')) {
      this.closeMap();
      this.input.consume();
      e.preventDefault();
    }
  };

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.mapEl || this.pauseEl || this.shops.open) {
      const f = this.input.read(dt);
      // Online the world doesn't stop for your menu.
      if (this.net) {
        this.time += dt;
        this.advanceClock(dt);
        this.tick(idle(f), dt);
      }
      this.render();
      return;
    }
    const f = this.input.read(dt);
    if (this.online?.typing) Object.assign(f, idle(f));
    if (f.pause) return this.pause();
    if (f.map) return this.openMap();
    this.time += dt;
    this.advanceClock(dt);
    this.tick(f, dt);
    this.render();
  };

  private advanceClock(dt: number): void {
    const w = this.net?.welcome;
    if (w) this.clock = (w.hour + (Date.now() - w.t0) / 60000) % 24;
    else this.clock = (this.clock + dt / 60) % 24;
  }

  private tick(f: Frame, dt: number): void {
    const p = this.player;
    if (this.net) {
      this.remotes.update(dt);
      this.sendState(dt);
      this.online?.update(dt);
    }
    // Weapon wheel (Tab): slow motion while it's open.
    this.hud.wheel(f.wheel && !p.inCar, (id) => {
      p.inv.select(id);
      this.syncGun();
    });
    const slow = f.wheel && !p.inCar ? 0.25 : 1;
    const sdt = dt * slow;
    if (f.slot) {
      const ids = [...p.inv.owned.keys()];
      const id = ids[f.slot - 1];
      if (id) {
        p.inv.select(id);
        this.syncGun();
      }
    }
    const aim = this.cam.aim();
    p.update(f, sdt, this.cam.heading, aim.from, aim.dir);
    // AI drivers, then physics in fixed steps.
    for (const d of this.traffic) d.update(this, sdt);
    this.acc += sdt;
    let n = 0;
    while (this.acc >= STEP && n++ < 4) {
      this.acc -= STEP;
      for (const v of this.vehicles) v.drive(STEP);
      this.physics.world.timestep = STEP;
      this.physics.world.step(this.events);
      for (const v of this.vehicles) v.measure(STEP);
      this.crashes();
    }
    this.impacts();
    this.water(sdt);
    const night = this.nightFactor();
    for (const v of this.vehicles) v.sync(this.time);
    this.carHits();
    this.burning(sdt);
    this.peds.update(sdt);
    this.deaths();
    this.police.update(sdt);
    this.population(sdt);
    this.updateRockets(sdt);
    this.updatePickups(sdt);
    this.fx.update(sdt);
    this.interactions(f);
    this.cam.update(f, dt, p, this.fx.shake);
    // First person on foot: you don't see your own body — just your gun.
    p.human.root.visible = !p.inCar && !(this.cam.first && !p.dead);
    this.viewModel(dt);
    this.gps(dt);
    // Sound.
    const cp = this.cam.camera.position;
    this.audio.listener = { x: cp.x, y: cp.y, z: cp.z };
    const car = p.car;
    this.audio.engineUpdate(!!car && !car.wrecked, car ? engineSample(car) : '', car?.speed ?? 0, car?.input.throttle ?? 0, car?.def.top ?? 1);
    if (car && f.horn) this.audio.horn(car.pos, 0.12);
    let siren: THREE.Vector3 | null = null;
    let sd = 120;
    for (const v of this.vehicles)
      if (v.sirenOn && !v.wrecked) {
        const d = v.pos.distanceTo(cp);
        if (d < sd) {
          sd = d;
          siren = v.pos;
        }
      }
    this.audio.sirenUpdate(siren, dt);
    if (car) car.setHeadlights(night > 0.5);
    // Death / arrest.
    if (p.dead) {
      if (!this.diedSent && this.net) {
        this.diedSent = true;
        const by = this.lastHitBy && this.time - this.lastHitBy.t < 10 ? this.lastHitBy.id : null;
        this.net.died(by);
      }
      this.deadT += dt;
      if (this.deadT > 0.6) this.hud.big('WASTED', '', 'wasted');
      if (this.deadT > 5) this.respawn('hospital');
    } else if (this.police.busted) {
      this.bustedT += dt;
      p.human.play('idle');
      this.hud.big('BUSTED', '', 'busted');
      if (this.bustedT > 4) this.respawn('police');
    }
    this.hud.update(dt);
    this.view.update(this.time, night, (node, edge) => lightFor(this.city.net, node, edge, this.time));
    this.dayNight();
  }

  private syncGun(): void {
    const look = this.player.inv.def.look;
    this.player.human.setGunLook(look ? GUN_LOOKS[look]! : null);
  }

  /** The first-person gun: sways, aims down the middle, kicks when it fires. */
  private viewModel(dt: number): void {
    const p = this.player;
    const show = this.cam.first && !p.inCar && !p.dead && p.armed && !this.cam.scoped;
    this.viewGun.visible = show;
    if (!show) return;
    const look = GUN_LOOKS[p.inv.def.look!]!;
    if (this.viewKey !== look.model) {
      this.viewKey = look.model;
      this.viewGun.clear();
      const g = assets.gun(look.model);
      const box = new THREE.Box3().setFromObject(g);
      const gripX = box.min.x + (box.max.x - box.min.x) * look.grip;
      g.position.set(-gripX, -(box.min.y + (box.max.y - box.min.y) * 0.3), 0);
      const holder = new THREE.Group();
      holder.add(g);
      holder.scale.setScalar(look.scale);
      holder.rotation.y = Math.PI / 2; // muzzle (+x) forward (−z)
      this.viewGun.add(holder);
      this.viewTip = new THREE.Object3D();
      this.viewTip.position.set(box.max.x - gripX, 0.02 / look.scale, 0);
      g.add(this.viewTip);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          (m.material as THREE.Material).depthTest = true;
        }
      });
    }
    this.recoil = Math.max(0, this.recoil - dt * 8);
    const aim = p.aiming;
    const bob = Math.sin(this.time * 9) * Math.min(1, p.speed / 6) * 0.012;
    const tx = aim ? 0 : 0.2;
    const ty = (aim ? -0.13 : -0.2) + bob;
    const tz = (aim ? -0.38 : -0.46) + this.recoil * 0.06;
    this.viewGun.position.lerp(new THREE.Vector3(tx, ty, tz), Math.min(1, dt * 14));
    this.viewGun.rotation.x = this.recoil * 0.12;
  }
  viewMuzzle(): THREE.Vector3 {
    this.cam.camera.updateMatrixWorld(true);
    return this.viewTip.getWorldPosition(new THREE.Vector3());
  }
  kick(): void {
    this.recoil = 1;
  }

  /** Rapier contact events: who rammed whom (damage comes from impacts, below). */
  private crashes(): void {
    this.events.drainContactForceEvents((e) => {
      const a = this.byCollider.get(e.collider1());
      const b = this.byCollider.get(e.collider2());
      const mine = a?.driver === 'player' ? b : b?.driver === 'player' ? a : null;
      if (mine) this.carAttacked(mine);
    });
  }

  /** Crash damage from how suddenly each car's velocity changed. */
  private impacts(): void {
    for (const v of this.vehicles) {
      const dv = v.impact;
      v.impact = 0;
      if (dv < 4) continue;
      const dmg = v.crash(dv);
      if (this.time - v.lastHit > 0.25) {
        v.lastHit = this.time;
        this.audio.crash(v.p, Math.min(1.5, dv * 0.07));
        if (v.driver === 'player') {
          this.fx.shake = Math.max(this.fx.shake, Math.min(0.7, dv * 0.03));
          // Hard crashes hurt the driver a little (no seatbelts in Velora).
          if (dmg > 120) this.player.hurt(Math.min(40, dmg * 0.06));
        }
      }
    }
  }

  /** Cars in the river / the sea sink and die; buoyancy slows them. */
  private water(dt: number): void {
    for (const v of this.vehicles) {
      if (v.p.y < WATER_Y - 0.4) {
        v.sinkT += dt;
        const lv = v.body.linvel();
        v.body.setLinvel({ x: lv.x * 0.96, y: Math.max(lv.y, -1.2), z: lv.z * 0.96 }, true);
        if (v.sinkT > 4 && !v.wrecked) {
          v.wrecked = true;
          v.sirenOn = false;
          v.health = 0;
          if (this.player.car === v) {
            this.player.exitCar();
            this.hud.flash('YOUR CAR SANK', 'info');
          }
        }
      } else v.sinkT = 0;
    }
  }

  /** Cars hitting people (and you). */
  private carHits(): void {
    for (const v of this.vehicles) {
      const sp = Math.abs(v.speed);
      if (sp < 3.5) continue;
      const c = v.pos;
      const f = v.forward();
      const lv = v.body.linvel();
      const test = (x: number, z: number) => {
        const rx = x - c.x;
        const rz = z - c.z;
        const along = rx * f.x + rz * f.z;
        const side = Math.abs(rx * f.z - rz * f.x);
        return Math.abs(along) < v.half.z + 0.3 && side < v.half.x + 0.3;
      };
      for (const p of this.peds.list) {
        if (p.dead || Math.abs(p.x - c.x) > 5 || Math.abs(p.z - c.z) > 5 || Math.abs(p.y - c.y) > 2) continue;
        if (!test(p.x, p.z)) continue;
        p.hurt(sp * 12, v.driver === 'player' ? 'player' : p);
        if (p.dead) {
          p.vx = lv.x * 0.9;
          p.vz = lv.z * 0.9;
          p.vy = 3 + sp * 0.15;
        }
        this.audio.crash(c, 0.6);
      }
      const me = this.player;
      if (!me.inCar && !me.dead && v.driver !== 'player' && Math.abs(me.pos.y - c.y) < 2 && test(me.pos.x, me.pos.z)) {
        me.hurt(sp * 5);
        me.human.play('roll');
      }
      // Running over other players (they take the damage on their side).
      if (this.net && v.driver === 'player')
        for (const r of this.remotes.map.values()) {
          if (r.inCar || !r.alive || Math.abs(r.y - c.y) > 2 || !test(r.x, r.z)) continue;
          if (this.time - (this.remoteHitT.get(r.id) ?? -9) < 0.6) continue;
          this.remoteHitT.set(r.id, this.time);
          this.net.hit(r.id, sp * 6, v.def.name);
          this.audio.crash(c, 0.6);
        }
    }
  }

  /** Wrecks catch fire, then blow up. */
  private burning(dt: number): void {
    for (const v of [...this.vehicles]) {
      if (v.wrecked) continue;
      if (v.health < 350 && v.health > 0 && Math.random() < dt * 6) this.fx.smoke(v.pos.clone().add(new THREE.Vector3(0, v.half.y * 1.8, 0)).addScaledVector(v.forward(), v.half.z * 0.7), v.health < 150);
      if (v.burning > 0) {
        v.burning -= dt;
        if (Math.random() < dt * 30) this.fx.fire(v.pos.clone().add(new THREE.Vector3(0, v.half.y * 1.6, 0)).addScaledVector(v.forward(), v.half.z * 0.6));
        if (v.burning <= 0) {
          v.wrecked = true;
          v.sirenOn = false;
          this.explode(v.pos.clone().add(new THREE.Vector3(0, 1, 0)), null);
          if (this.player.car === v) this.player.hurt(1000);
          const d = this.traffic.find((t) => t.car === v);
          if (d) this.traffic.splice(this.traffic.indexOf(d), 1);
        }
      }
    }
  }

  /** New deaths: crimes, dropped cash and guns. */
  private deaths(): void {
    for (const p of this.peds.list) {
      if (!p.dead || this.counted.has(p)) continue;
      this.counted.add(p);
      if (p.killedBy === 'player' || p.lastAttacker === 'player') {
        const cop = p.role !== 'civ';
        this.crime(cop ? 'copMurder' : 'murder', p.x, p.z, cop ? true : undefined);
      }
      // Drops.
      if (p.role === 'civ' && Math.random() < 0.6) this.dropCash(p.x, p.y, p.z, 5 + Math.floor(Math.random() * 60));
      if (p.weapon) this.dropWeapon(p.x, p.y, p.z, p.weapon, p.weapon.mag * 2);
    }
  }

  private dropCash(x: number, y: number, z: number, cash: number): void {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.18), new THREE.MeshBasicMaterial({ color: 0x4caf50 }));
    m.position.set(x, y + 0.4, z);
    this.scene.add(m);
    this.pickups.push({ m, x, y, z, cash, t: 60 });
  }
  private dropWeapon(x: number, y: number, z: number, w: WeaponDef, ammo: number): void {
    const g = assets.gun(GUN_LOOKS[w.look!]!.model);
    g.scale.setScalar(GUN_LOOKS[w.look!]!.scale);
    g.position.set(x + 0.4, y + 0.5, z);
    this.scene.add(g);
    this.pickups.push({ m: g, x: x + 0.4, y, z, cash: 0, weapon: w, ammo, t: 60 });
  }

  private updatePickups(dt: number): void {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i]!;
      k.t -= dt;
      k.m.rotation.y += dt * 2;
      k.m.position.y = k.y + 0.45 + Math.sin(this.time * 3) * 0.08;
      const got = !p.inCar && !p.dead && Math.hypot(p.pos.x - k.x, p.pos.z - k.z) < 1.3;
      if (got) {
        if (k.cash) {
          p.cash += k.cash;
          this.hud.flash(`+$${k.cash}`, 'good');
          this.audio.blip('cash');
        }
        if (k.weapon) {
          p.inv.give(k.weapon.id, k.ammo ?? 30);
          this.hud.flash(k.weapon.name.toUpperCase(), 'good');
          this.audio.blip('buy');
        }
      }
      if (got || k.t <= 0) {
        k.m.removeFromParent();
        this.pickups.splice(i, 1);
      }
    }
  }

  private updateRockets(dt: number): void {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]!;
      r.life -= dt;
      const step = r.v.clone().multiplyScalar(dt);
      const len = step.length();
      const dir = step.clone().normalize();
      const hit = this.physics.ray(r.p.x, r.p.y, r.p.z, dir.x, dir.y, dir.z, len, this.player.car?.body ?? this.player.body);
      let boom = !!hit || r.life <= 0 || r.p.y < 0.1;
      if (!boom) for (const p of this.peds.list) if (!p.dead && Math.hypot(p.x - r.p.x, p.z - r.p.z) < 0.8 && r.p.y < p.y + 2) boom = true;
      if (hit) r.p.addScaledVector(dir, hit.toi);
      else r.p.add(step);
      r.m.position.copy(r.p);
      if (Math.random() < 0.8) this.fx.smoke(r.p.clone(), false);
      if (boom) {
        this.explode(r.p.clone(), 'player');
        r.m.removeFromParent();
        this.rockets.splice(i, 1);
      }
    }
  }

  /** Shops (E), help prompts, entering cars. */
  private interactions(f: Frame): void {
    const p = this.player;
    if (p.dead) return;
    const pos = p.pos;
    for (const s of this.city.shops) {
      const d = Math.hypot(s.x - pos.x, s.z - pos.z) + Math.abs(s.y - pos.y) * 2;
      const inCarOk = s.kind === 'respray' && p.inCar && d < 9 && Math.abs(p.car!.speed) < 3;
      const footOk = !p.inCar && d < 2.4 && s.kind !== 'respray';
      if (inCarOk || footOk || (s.kind === 'respray' && !p.inCar && d < 2.4)) {
        this.hud.help(`Press <b>E</b> — ${s.name}`);
        if (f.interact) {
          this.input.unlock();
          this.shops.show(s);
          this.audio.blip('click');
        }
        return;
      }
    }
    if (!p.inCar) {
      for (const v of this.vehicles)
        if (!v.wrecked && v.pos.distanceTo(pos) < 4.2) {
          this.hud.help(`Press <b>F</b> to ${v.driver === 'ai' ? 'steal' : 'enter'} the ${v.def.name}`);
          break;
        }
    } else if (p.car!.flipped && Math.abs(p.car!.speed) < 1) {
      this.hud.help('Press <b>Space</b> to flip the car back over');
      if (f.jump || f.handbrake) p.car!.unflip();
    }
  }

  private gps(dt: number): void {
    const w = this.hud.waypoint;
    if (!w) {
      this.hud.route = [];
      return;
    }
    const p = this.player.pos;
    if (Math.hypot(w.x - p.x, w.z - p.z) < 18) {
      this.hud.waypoint = null;
      this.hud.route = [];
      this.hud.flash('DESTINATION REACHED', 'good');
      return;
    }
    this.routeT -= dt;
    if (this.routeT > 0) return;
    this.routeT = 1;
    const net = this.city.net;
    const nodes = net.route(net.nearestNode(p.x, p.z).id, net.nearestNode(w.x, w.z).id);
    const pts: Array<[number, number]> = [];
    const q = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < nodes.length - 1; k++) {
      const e = net.between(nodes[k]!, nodes[k + 1]!);
      if (!e) continue;
      const fwd = e.a === nodes[k];
      for (let s = 0; s <= e.len; s += 8) {
        net.point(e, fwd ? s : e.len - s, q);
        pts.push([q.x, q.z]);
      }
    }
    pts.push([w.x, w.z]);
    this.hud.route = pts;
  }

  /** Keep the streets alive around you (and tidy up far away). */
  private population(dt: number): void {
    this.popT -= dt;
    if (this.popT > 0) return;
    this.popT = 0.25;
    const p = this.player.pos;
    const night = this.nightFactor();
    // People (pooled: spawning is cheap; at most one a tick).
    let civs = 0;
    for (const c of [...this.peds.list]) {
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d > 160 || (c.dead && c.deadT > 45 && d > 40) || (c.role !== 'civ' && this.police.level === 0 && d > 60)) this.peds.remove(c);
      else if (c.role === 'civ') civs++;
    }
    if (civs < (night > 0.5 ? 22 : 38)) this.peds.spawnCiv(p, 50, 130);
    // Traffic.
    for (const d of [...this.traffic]) {
      const dist = d.car.p.distanceTo(p);
      if (dist > 230 || (d.car.wrecked && dist > 80)) this.removeVehicle(d.car);
    }
    let civTraffic = 0;
    for (const d of this.traffic) if (d.mode !== 'pursuit' && d.mode !== 'parked') civTraffic++;
    if (civTraffic < (night > 0.5 ? 14 : 24)) {
      const spot = laneSpot(this, p, 90, 200);
      if (spot) {
        const model = TRAFFIC_MIX[Math.floor(Math.random() * TRAFFIC_MIX.length)]!;
        this.traffic.push(spawnTraffic(this, model, spot, 'traffic', 'casual'));
      }
    }
    // Parked cars at the curb (at most two new ones a tick).
    let made = 0;
    const parking = this.city.parking;
    for (let i = 0; i < parking.length; i++) {
      const s = parking[i]!;
      const dx = s.x - p.x;
      const dz = s.z - p.z;
      if (Math.abs(dx) > 180 || Math.abs(dz) > 180) {
        const have = this.parked.get(i);
        if (have) {
          if (have.p.distanceTo(new THREE.Vector3(s.x, have.p.y, s.z)) > 3) this.parkedUsed.add(i);
          if (have.driver !== 'player' && !this.ownCars.has(have)) this.removeVehicle(have);
          this.parked.delete(i);
        }
        continue;
      }
      const d = Math.hypot(dx, dz);
      if (d < 120 && d > 30 && made < 2 && !this.parked.has(i) && !this.parkedUsed.has(i)) {
        const model = PARKED_MIX[Math.floor(Math.random() * PARKED_MIX.length)]!;
        this.parked.set(i, this.addVehicle(model, s.x, s.z, s.h, undefined, s.y + 0.3));
        made++;
      }
    }
    // Abandoned cars far away (not yours).
    const parkedSet = new Set(this.parked.values());
    const driven = new Set(this.traffic.map((d) => d.car));
    for (const v of [...this.vehicles]) {
      if (v.driver || this.ownCars.has(v) || parkedSet.has(v) || driven.has(v)) continue;
      if (v.p.distanceTo(p) > 240) this.removeVehicle(v);
    }
  }

  private respawn(where: 'hospital' | 'police'): void {
    const p = this.player;
    const shop = this.city.shops.filter((s) => s.kind === where).sort((a, b) => Math.hypot(a.x - p.pos.x, a.z - p.pos.z) - Math.hypot(b.x - p.pos.x, b.z - p.pos.z))[0]!;
    const fee = where === 'hospital' ? 500 : 1000;
    p.cash = Math.max(0, p.cash - fee);
    if (p.car) p.exitCar();
    p.dead = false;
    p.health = 200;
    const ry = this.groundY(shop.x + shop.fx * 3, shop.z + shop.fz * 3, shop.y + 20);
    p.body.setTranslation({ x: shop.x + shop.fx * 3, y: ry + 1.2, z: shop.z + shop.fz * 3 }, true);
    p.pos.set(shop.x + shop.fx * 3, ry, shop.z + shop.fz * 3);
    p.human.play('idle');
    this.police.clear();
    this.deadT = this.bustedT = 0;
    this.hud.hideBig();
    this.hud.flash(where === 'hospital' ? `HOSPITAL BILL  -$${fee}` : `BAIL  -$${fee}`, 'info');
    this.syncGun();
    this.save();
  }

  // ---------------------------------------------------------------- day / night

  nightFactor(): number {
    const el = Math.sin(((this.clock - 6) / 12) * Math.PI);
    return Math.max(0, Math.min(1, -el * 3 + 0.3));
  }

  private dayNight(): void {
    const el = Math.sin(((this.clock - 6) / 12) * Math.PI); // −1 … 1
    const az = ((this.clock - 6) / 12) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(az) * 0.8, Math.max(-0.2, el), 0.45).normalize();
    this.sky.material.uniforms.sunPosition!.value.copy(sunDir);
    const day = Math.max(0, Math.min(1, el * 2.5 + 0.2));
    const p = this.player.pos;
    // The sun light (moonlight at night) follows you so the shadow box stays put.
    const light = day > 0.05 ? sunDir : new THREE.Vector3(-0.3, 0.8, 0.4).normalize();
    this.sun.position.set(p.x + light.x * 150, p.y + light.y * 150, p.z + light.z * 150);
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.intensity = 0.25 + day * 2.4;
    this.sun.color.setHSL(0.1, 0.6 * (1 - day) + 0.1, 0.9);
    this.hemi.intensity = 0.6 + day * 0.7;
    this.renderer.toneMappingExposure = 0.75 + day * 0.25;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setRGB(0.04 + day * 0.7, 0.05 + day * 0.78, 0.09 + day * 0.84);
  }

  private render(): void {
    // The sky dome travels with you (it's inside the far plane).
    this.sky.position.copy(this.cam.camera.position);
    this.renderer.render(this.scene, this.cam.camera);
  }

  // ---------------------------------------------------------------- menus

  private openMap(): void {
    this.input.unlock();
    this.mapEl = this.hud.openMap(() => this.closeMap());
  }
  private closeMap(): void {
    this.mapEl?.remove();
    this.mapEl = null;
    this.routeT = 0;
  }

  pause(): void {
    this.input.unlock();
    const el = document.createElement('div');
    el.className = 'v-pause';
    el.innerHTML = `<div class="v-pausebox"><h1>${this.net ? 'VELORA ONLINE' : 'PAUSED'}</h1>
      <button data-a="resume">Resume</button><button data-a="map">Map</button>
      <label>Mouse sensitivity <input type="range" min="0.0008" max="0.005" step="0.0001" value="${this.input.sensitivity}" data-s="sens"></label>
      <label>Volume <input type="range" min="0" max="1" step="0.05" value="${this.audio.volume}" data-s="vol"></label>
      <label class="chk"><input type="checkbox" data-s="inv" ${this.input.invertY ? 'checked' : ''}> Invert look</label>
      <div class="v-keys"><b>On foot</b> WASD move · Shift sprint · Space jump · F get in · RMB aim · LMB shoot · R reload · Q / wheel / 1-8 weapons · Tab weapon wheel · E use shops<br><b>Driving</b> W/S gas & brake · A/D steer · Space handbrake · F get out · H horn · E siren · C camera · X look back<br><b>Anywhere</b> M map · Esc pause</div>
      ${this.net ? `<div class="v-session">ONLINE SESSION <b>${this.net.welcome?.code ?? ''}</b><span>Friends join with this code${this.net.welcome?.lan ? ' (LAN)' : ''}</span></div>${this.online?.listHtml() ?? ''}` : ''}
      <button data-a="quit">${this.net ? 'Leave Session' : 'Quit to Arcade'}</button></div>`;
    this.root.appendChild(el);
    this.pauseEl = el;
    const resume = () => {
      el.remove();
      this.pauseEl = null;
      this.input.lock();
      this.save();
    };
    el.querySelector<HTMLElement>('[data-a=resume]')!.onclick = resume;
    el.querySelector<HTMLElement>('[data-a=map]')!.onclick = () => {
      resume();
      this.openMap();
    };
    el.querySelector<HTMLElement>('[data-a=quit]')!.onclick = () => {
      this.save();
      void this.net?.leave();
      location.href = this.net ? '/velora/' : '/';
    };
    (el.querySelector('[data-s=sens]') as HTMLInputElement).oninput = (e) => (this.input.sensitivity = Number((e.target as HTMLInputElement).value));
    (el.querySelector('[data-s=vol]') as HTMLInputElement).oninput = (e) => this.audio.setVolume(Number((e.target as HTMLInputElement).value));
    (el.querySelector('[data-s=inv]') as HTMLInputElement).onchange = (e) => (this.input.invertY = (e.target as HTMLInputElement).checked);
    el.addEventListener('keydown', (e) => e.code === 'Escape' && resume());
    addEventListener('keydown', function esc(e) {
      if (e.code === 'Escape' && el.isConnected) {
        removeEventListener('keydown', esc);
        resume();
      }
    });
  }

  // ---------------------------------------------------------------- online

  /** Wire up the session's messages (called once the game exists). */
  goOnline(): void {
    const n = this.net;
    if (!n) return;
    this.online = new OnlineUI(this.root, this);
    n.onSnap = (players) => this.remotes.snapshot(players, n.me);
    n.onHit = (h) => {
      if (this.player.dead) return;
      this.lastHitBy = { id: h.from, t: this.time };
      if (this.player.inCar && h.what !== 'boom') this.player.car!.damage(h.dmg * 0.6);
      else this.player.hurt(h.dmg);
      this.fx.shake = Math.max(this.fx.shake, 0.15);
    };
    n.onCarHit = (dmg, from) => {
      const car = this.player.car ?? this.myParked;
      if (!car) return;
      car.damage(dmg);
      if (car === this.player.car) this.lastHitBy = { id: from, t: this.time };
    };
    n.onShot = (s) => {
      const a = new THREE.Vector3(s.fx, s.fy, s.fz);
      this.fx.tracer(a, new THREE.Vector3(s.tx, s.ty, s.tz));
      this.fx.muzzle(a);
      if (s.sfx) this.audio.gun(s.sfx, a, s.rate);
      this.peds.panic(s.fx, s.fz, 40);
    };
    n.onBoom = (b) => {
      const at = new THREE.Vector3(b.x, b.y, b.z);
      if (this.player.pos.distanceTo(at) < 9) this.lastHitBy = { id: b.from, t: this.time };
      this.explode(at, null, true);
    };
    n.onFeed = (f) => this.online?.feed(f.text, f.kind);
    n.onChat = (c) => this.online?.chat(c.name, c.text, c.from === n.me);
    n.onGranted = (car) => {
      if (this.player.inCar || this.player.dead) return;
      const v = this.addVehicle(car.model as CarModel, car.x, car.z, 0, car.paint, car.y);
      v.body.setRotation({ x: car.qx, y: car.qy, z: car.qz, w: car.qw }, true);
      v.health = car.hp;
      v.repaint(car.paint);
      this.ownCars.add(v);
      this.player.enterCar(v);
    };
    n.onRelease = () => {
      const v = this.myParked;
      this.myParked = null;
      if (v && this.player.car !== v) this.removeVehicle(v);
      this.hud.flash('SOMEONE TOOK YOUR CAR', 'info');
    };
    n.onClosed = (reason) => {
      this.online?.feed(reason ?? 'Disconnected from the session', 'leave');
      this.net = null;
      this.remotes.dispose();
    };
  }

  private carState(v: Vehicle): CarState {
    const q = v.root.quaternion;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return { model: v.def.model, paint: v.paintHex, x: r2(v.p.x), y: r2(v.p.y), z: r2(v.p.z), qx: +q.x.toFixed(4), qy: +q.y.toFixed(4), qz: +q.z.toFixed(4), qw: +q.w.toFixed(4), v: r2(v.speed), siren: v.sirenOn, hp: Math.round(v.health) };
  }

  private sendState(dt: number): void {
    this.sendT -= dt;
    if (this.sendT > 0 || !this.net) return;
    this.sendT = 0.05;
    const p = this.player;
    const parked = this.myParked && !this.myParked.wrecked && this.vehicles.includes(this.myParked) && this.myParked.p.distanceTo(p.pos) < 400 ? this.myParked : null;
    const s: PlayerState = {
      x: Math.round(p.pos.x * 100) / 100,
      y: Math.round(p.pos.y * 100) / 100,
      z: Math.round(p.pos.z * 100) / 100,
      h: +p.human.heading.toFixed(3),
      pose: p.human.pose,
      gun: p.inv.def.look ?? '',
      alive: !p.dead,
      wanted: this.police.level,
      car: p.car ? this.carState(p.car) : null,
      parked: parked && parked !== p.car ? this.carState(parked) : null,
      model: p.model,
    };
    this.net.state(s);
    if (!p.dead) this.diedSent = false;
  }

  /** Online: a car owned by another player (theirs to drive / move). */
  addRemoteCar(model: CarModel, paint: number, owner: string): Vehicle {
    const v = new Vehicle(model, 0, -500, 0, paint);
    v.makeRemote();
    this.byCollider.set(v.collider.handle, v);
    this.remoteOwner.set(v, owner);
    this.scene.add(v.root);
    return v;
  }
  dropRemoteCar(v: Vehicle): void {
    this.byCollider.delete(v.collider.handle);
    this.remoteOwner.delete(v);
    v.dispose();
  }
  private remoteOwner = new Map<Vehicle, string>();
  /** Bullets that hit another player's car: their owner applies the damage. */
  remoteCarHit(v: Vehicle, dmg: number): boolean {
    const owner = this.remoteOwner.get(v);
    if (!owner) return false;
    this.net?.carHit(owner, dmg);
    return true;
  }
  /** Bullets that hit another player on foot. */
  remoteTargets(): Array<{ id: string; x: number; y: number; z: number }> {
    const out: Array<{ id: string; x: number; y: number; z: number }> = [];
    for (const r of this.remotes.map.values()) if (r.alive && !r.inCar) out.push({ id: r.id, x: r.x, y: r.y, z: r.z });
    return out;
  }
  /** Tell the others about a shot (tracer, flash, sound). */
  netShot(from: THREE.Vector3, to: THREE.Vector3, sfx: string, rate: number): void {
    this.net?.shot({ fx: +from.x.toFixed(2), fy: +from.y.toFixed(2), fz: +from.z.toFixed(2), tx: +to.x.toFixed(2), ty: +to.y.toFixed(2), tz: +to.z.toFixed(2), sfx, rate });
  }
  /** F next to another player's parked car: ask for it. */
  claimNearby(): boolean {
    if (!this.net) return false;
    for (const r of this.remotes.map.values()) {
      const v = r.parked;
      if (v && v.p.distanceTo(this.player.pos) < 4.5) {
        this.net.claim(r.id);
        return true;
      }
    }
    return false;
  }

  save(): void {
    const p = this.player;
    const data: SaveData = { cash: p.cash, model: p.model, armor: p.armor, weapons: [...p.inv.owned.entries()].map(([id, s]) => [id, s.mag + s.ammo]) };
    try {
      localStorage.setItem('velora:save', JSON.stringify(data));
    } catch {
      /* storage optional */
    }
  }
}

import { GUN_LOOK as GUN_LOOKS } from './actors/human';

/** A frame with no player input (menus open online: the world keeps going). */
function idle(f: Frame): Frame {
  return { ...f, moveX: 0, moveY: 0, lookX: 0, lookY: 0, sprint: false, jump: false, enter: false, aim: false, fire: false, firePressed: false, reload: false, nextWeapon: false, prevWeapon: false, wheel: false, slot: 0, throttle: 0, steer: 0, handbrake: true, horn: false, siren: false, camera: false, map: false, pause: false, interact: false, lookBack: false };
}

function engineSample(v: Vehicle): string {
  const m = v.def.model;
  if (m === 'racer' || m === 'super') return 'aventador-v12-7550';
  if (m === 'sports' || m === 'hatch' || m === 'compact') return 'gt3-flat6-3300';
  if (m === 'muscle') return 'italia-v8-4400';
  if (m === 'suv' || m === 'pickup' || m === 'police') return 'svr-v8-5550';
  if (m === 'boxtruck' || m === 'garbage' || m === 'delivery' || m === 'firetruck' || m === 'tractor' || m === 'van' || m === 'ambulance') return 'lfa-v10-1550';
  return 'italia-v8-3000';
}

