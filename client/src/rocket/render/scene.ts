import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { World, WorldEvent } from '../sim/world';
import { buildArena, buildSky, toThree, S, type ArenaView } from './arenaMesh';
import { BallView, CarView, PadsView, loadCars } from './entities';
import { Fx } from './fx';
import { ChaseCamera } from './camera';

export type Quality = 'high' | 'medium' | 'low';

/** Previous-tick poses for interpolation (sim units). */
export interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q1 = new THREE.Quaternion();

export class RocketRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: ChaseCamera;
  readonly fx = new Fx();
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private arena: ArenaView | null = null;
  readonly cars = new Map<number, CarView>();
  readonly ball = new BallView();
  private readonly pads = new PadsView();
  private sun: THREE.DirectionalLight;
  private quality: Quality = 'high';
  private orbitT = 0;
  /** Smoothed render pose of the ball (sim units, for the HUD / camera). */
  readonly ballPos = new THREE.Vector3();
  private goalFlash = [0, 0];

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.cam = new ChaseCamera(innerWidth / innerHeight);

    // Lighting: an overhead "sun" casting straight-down shadows (the classic ball shadow), plus fill.
    this.scene.add(new THREE.HemisphereLight(0xb8c8ff, 0x30402a, 0.75));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.25);
    this.sun.position.set(0.01, 60, 0.01);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -46;
    sc.right = 46;
    sc.top = 62;
    sc.bottom = -62;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    const key = new THREE.DirectionalLight(0xfff1dd, 0.75);
    key.position.set(-30, 40, 20);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb0ff, 0.6);
    rim.position.set(30, 25, -20);
    this.scene.add(rim);

    this.scene.add(buildSky());
    this.scene.add(this.pads.group, this.ball.mesh, this.fx.group);
    this.scene.fog = new THREE.Fog(0x0a0d22, 140, 420);
    addEventListener('resize', () => this.resize());
  }

  async init(): Promise<void> {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.arena = buildArena();
    this.scene.add(this.arena.group);
    await loadCars();
    this.setQuality(this.quality);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = Math.min(devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.25 : 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    const size = q === 'high' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (q !== 'low') {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : 0 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.cam.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 1.05);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  resize(): void {
    const w = this.host.clientWidth || innerWidth;
    const h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.bloom?.resolution.set(w / 2, h / 2);
    this.cam.setAspect(w / h);
    this.fx.resize(h * this.renderer.getPixelRatio(), this.cam.camera.fov);
  }

  /** (Re)build car views for the world's players. */
  setWorld(world: World): void {
    for (const v of this.cars.values()) v.dispose();
    this.cars.clear();
    for (const car of world.cars) {
      const v = new CarView(car.id, car.team, car.body.id);
      this.cars.set(car.id, v);
      this.scene.add(v.root);
    }
    this.cam.reset();
  }

  /** Effects for simulation events (sounds are handled by the caller). */
  onEvent(e: WorldEvent, world: World): void {
    switch (e.k) {
      case 'touch': {
        const car = world.car(e.car);
        this.fx.hit(toThree(e.x, e.y, e.z, v1), e.power, car?.team ?? 0);
        this.ball.flash(car?.team ?? 0, e.power);
        break;
      }
      case 'goal':
        this.fx.goal(toThree(e.x, Math.sign(e.y) * Math.min(Math.abs(e.y), 5300), e.z, v1), e.team, e.speed);
        this.goalFlash[e.team === 0 ? 1 : 0] = 1;
        break;
      case 'demo': {
        const victim = world.car(e.victim);
        this.fx.demo(toThree(e.x, e.y, e.z, v1), victim?.team ?? 0);
        break;
      }
      case 'pad': {
        const car = world.car(e.car);
        if (car) this.fx.padPickup(toThree(car.pos.x, car.pos.y, car.pos.z, v1), e.big);
        break;
      }
      case 'jump': {
        const car = world.car(e.car);
        if (car) this.fx.jump(toThree(car.pos.x, car.pos.y, 0, v1));
        break;
      }
    }
  }

  /**
   * Draw a frame. `prev` holds last-tick poses; `alpha` blends prev → current.
   * `follow` is the car the camera chases (or null to orbit).
   */
  frame(world: World, prev: Map<number, Pose>, prevBall: THREE.Vector3, alpha: number, dt: number, follow: number | null): void {
    for (const car of world.cars) {
      const view = this.cars.get(car.id);
      if (!view) continue;
      const p = prev.get(car.id);
      const pos = p ? v1.copy(p.pos).lerp(car.pos, alpha) : v1.copy(car.pos);
      const quat = p ? q1.copy(p.quat).slerp(car.quat, alpha) : q1.copy(car.quat);
      // Decay network corrections.
      view.errPos.multiplyScalar(Math.exp(-dt * 12));
      view.errQuat.slerp(IDENTITY, 1 - Math.exp(-dt * 12));
      view.update(car, pos, quat, dt);
      if (car.demolished) continue;
      // Boost / supersonic / powerslide particles.
      const back = v2.set(-1, 0, 0).applyQuaternion(view.root.quaternion);
      const vel = toThree(car.vel.x, car.vel.y, car.vel.z, new THREE.Vector3());
      if (car.isBoosting) this.fx.boost(view.exhaust.clone().applyMatrix4(view.root.matrixWorld), back, vel, car.team);
      if (car.supersonic) for (const i of [2, 3]) this.fx.supersonic(view.wheelWorld[i]!, vel);
      if (car.handbrakeVal > 0.5 && car.onGround && car.speed > 600 && Math.random() < 0.5) this.fx.slide(view.wheelWorld[2 + Math.floor(Math.random() * 2)]!);
    }
    this.ballPos.copy(prevBall).lerp(world.ball.pos, alpha);
    this.ball.errPos.multiplyScalar(Math.exp(-dt * 10));
    this.ball.update(this.ballPos, world.ball.angVel, dt);
    this.pads.update(world.pads.map((p) => p.timer), dt);
    this.fx.update(dt);
    // Goal frames pulse after a goal.
    if (this.arena) {
      for (const t of [0, 1]) {
        this.goalFlash[t] = Math.max(0, this.goalFlash[t]! - dt * 0.4);
        const m = this.arena.goalLights[t] as THREE.MeshBasicMaterial;
        const base = t === 0 ? [0.24, 0.55, 1] : [1, 0.54, 0.12];
        const k = 2.6 + this.goalFlash[t]! * 6 * (0.5 + 0.5 * Math.sin(performance.now() / 60));
        m.color.setRGB(base[0]! * k, base[1]! * k, base[2]! * k);
      }
    }

    const car = follow != null ? world.car(follow) : undefined;
    const view = follow != null ? this.cars.get(follow) : undefined;
    if (car && view && !car.demolished) {
      const p = prev.get(car.id);
      const pos = p ? new THREE.Vector3().copy(p.pos).lerp(car.pos, alpha) : car.pos.clone();
      pos.addScaledVector(view.errPos, 1 / S);
      this.cam.update(dt, { pos, vel: car.vel, forward: car.forward, up: car.up, onGround: car.onGround, flipping: car.isFlipping }, world.phase === 'goal' ? null : this.ballPos);
    } else {
      this.orbitT += dt * 0.15;
      const c = car ? toThree(car.pos.x, car.pos.y, car.pos.z) : toThree(this.ballPos.x, this.ballPos.y, this.ballPos.z);
      this.cam.orbit(c, this.orbitT, car ? 12 : 30, car ? 6 : 10);
    }
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.cam.camera);
  }

  /** Screen position of a sim point (null if behind the camera). */
  project(p: THREE.Vector3, out: { x: number; y: number }): boolean {
    const v = toThree(p.x, p.y, p.z, v2).project(this.cam.camera);
    if (v.z > 1) return false;
    out.x = (v.x * 0.5 + 0.5) * this.renderer.domElement.clientWidth;
    out.y = (-v.y * 0.5 + 0.5) * this.renderer.domElement.clientHeight;
    return true;
  }

  dispose(): void {
    for (const v of this.cars.values()) v.dispose();
    this.cars.clear();
  }
}
const IDENTITY = new THREE.Quaternion();
