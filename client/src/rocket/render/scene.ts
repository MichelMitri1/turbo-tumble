import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { World, WorldEvent } from '../sim/world';
import { ARENA } from '../sim/arena';
import { buildArena, disposeGroup, idle, toThree, CACHED_TEXTURES, S, type ArenaView } from './arenaMesh';
import { BallView, CarView, PadsView, acquireCarView, loadCars, releaseCarView, renderCarThumbs } from './entities';
import type { CarId } from '../sim/constants';
import { Fx } from './fx';
import { ChaseCamera } from './camera';
import { THEMES, type ArenaTheme } from './themes';
import type { ArenaId } from '../arenas';
import { TEAM_COLORS } from './colors';

export type Quality = 'high' | 'medium' | 'low';

/** Previous-tick poses for interpolation (sim units). */
export interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

/** Things the renderer notices while drawing that deserve a sound (the sim has no event for them). */
export type FxEvent = { k: 'land'; car: number; strength: number } | { k: 'flipReset'; car: number };

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();

/** Per-car memory for landing / flip-reset / skid detection. */
interface CarTrack {
  air: number;
  onGround: boolean;
  hasFlipped: boolean;
  hasJumped: boolean;
  sliding: boolean;
}

export class RocketRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: ChaseCamera;
  readonly fx = new Fx();
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private arena: ArenaView | null = null;
  private arenaId: ArenaId | null = null;
  readonly cars = new Map<number, CarView>();
  readonly ball = new BallView();
  private readonly pads = new PadsView();
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly key: THREE.DirectionalLight;
  private readonly rim: THREE.DirectionalLight;
  private quality: Quality = 'high';
  private orbitT = 0;
  /** Smoothed render pose of the ball (sim units, for the HUD / camera). */
  readonly ballPos = new THREE.Vector3();
  private goalFlash = [0, 0];
  private readonly shellFade = [1, 1];
  private readonly track = new Map<number, CarTrack>();
  /** One fog object for every arena (switching fog on / off would recompile all shaders). */
  private readonly fog = new THREE.Fog(0x000000, 140, 420);
  /** The theme whose lighting is applied (also while its arena is still building). */
  private theme: ArenaTheme = THEMES.dome;
  onFx: ((e: FxEvent) => void) | null = null;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.cam = new ChaseCamera(innerWidth / innerHeight);

    // Lighting: an overhead "sun" casting straight-down shadows (the classic ball shadow),
    // plus key / rim fill. Colours and strengths come from the arena theme.
    this.hemi = new THREE.HemisphereLight(0xb8c8ff, 0x30402a, 0.75);
    this.scene.add(this.hemi);
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
    this.key = new THREE.DirectionalLight(0xfff1dd, 0.75);
    this.key.position.set(-30, 40, 20);
    this.scene.add(this.key);
    this.rim = new THREE.DirectionalLight(0x8fb0ff, 0.6);
    this.rim.position.set(30, 25, -20);
    this.scene.add(this.rim);

    // Lights inside the goals (blue goal at +z). They live here rather than in the arena so
    // the light count stays fixed across arena switches (a change recompiles every shader).
    for (const team of [0, 1] as const) {
      const gl = new THREE.PointLight(TEAM_COLORS[team].glow, 2.2, 12, 1.8);
      gl.position.set(0, 4.2, (team === 0 ? 1 : -1) * (ARENA.halfY + 420) * S);
      this.scene.add(gl);
    }
    this.scene.fog = this.fog;
    this.scene.add(this.pads.group, this.ball.mesh, this.fx.group);
    this.applyLighting(THEMES.dome);
    addEventListener('resize', () => this.resize());
  }

  async init(): Promise<void> {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    await loadCars();
    this.setQuality(this.quality);
    // Pre-warm the car shaders with one hidden car per team, then keep them in the pool.
    const warm = [acquireCarView(-1, 0, 'octane'), acquireCarView(-2, 1, 'octane')];
    for (const v of warm) this.scene.add(v.root);
    await this.renderer.compileAsync(this.scene, this.cam.camera);
    for (const v of warm) releaseCarView(v);
  }

  get arenaTheme(): ArenaTheme | null {
    return this.arena?.theme ?? null;
  }
  get currentArena(): ArenaId | null {
    return this.arenaId;
  }

  /**
   * Switch arenas: tears the old one down (geometry, materials, uncached textures)
   * and builds the new one in chunks, then compiles its shaders off the main path.
   * No-op when it's already up.
   */
  async setArena(id: ArenaId): Promise<void> {
    if (id === this.arenaId) return;
    this.arenaId = id;
    const theme = THEMES[id];
    if (this.arena) {
      disposeGroup(this.arena.group);
      this.arena = null;
    }
    this.applyLighting(theme);
    this.fx.setWeather(theme.weather);
    const view = await buildArena(theme, idle);
    // Upload the generated textures and compile the shaders (in parallel, off the main
    // path) before the arena joins the scene, so its first frame doesn't stall.
    for (const t of CACHED_TEXTURES) {
      this.renderer.initTexture(t);
      await idle();
    }
    await this.renderer.compileAsync(view.group, this.cam.camera, this.scene);
    // Superseded by another switch while building.
    if (this.arenaId !== id) return disposeGroup(view.group);
    // The GPU driver still builds each pipeline on its first draw (~15 ms apiece), so bring
    // the meshes in a few per frame rather than all in one frame.
    const meshes: THREE.Object3D[] = [];
    view.group.traverse((o) => {
      if (((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) && o.visible) meshes.push(o), (o.visible = false);
    });
    this.scene.add(view.group);
    for (let i = 0; i < meshes.length; i += 3) {
      for (const m of meshes.slice(i, i + 3)) m.visible = true;
      this.warm();
      await idle();
      if (this.arenaId !== id) return disposeGroup(view.group);
    }
    this.arena = view;
    this.shellFade[0] = this.shellFade[1] = 1;
  }

  /** Render one frame off-screen so the post-processing shaders are compiled before the overlay drops. */
  warm(): void {
    if (this.composer) this.composer.render(0);
    else this.renderer.render(this.scene, this.cam.camera);
  }

  private applyLighting(t: ArenaTheme): void {
    this.theme = t;
    const L = t.light;
    this.hemi.color.set(L.hemi.sky);
    this.hemi.groundColor.set(L.hemi.ground);
    this.hemi.intensity = L.hemi.intensity;
    this.sun.color.set(L.sun.color);
    this.sun.intensity = L.sun.intensity;
    this.sun.position.set(...L.sun.dir);
    this.key.color.set(L.key.color);
    this.key.intensity = L.key.intensity;
    this.key.position.set(...L.key.dir);
    this.rim.color.set(L.rim.color);
    this.rim.intensity = L.rim.intensity;
    this.rim.position.set(...L.rim.dir);
    if (L.fog) {
      this.fog.color.set(L.fog.color);
      this.fog.near = L.fog.near;
      this.fog.far = L.fog.far;
    } else {
      // "No fog": push it past the far plane.
      this.fog.near = 5000;
      this.fog.far = 6000;
    }
    this.renderer.toneMappingExposure = L.exposure;
    this.scene.environmentIntensity = L.env;
    if (this.bloom) {
      this.bloom.strength = L.bloom;
      this.bloom.threshold = L.bloomThreshold ?? 1.05;
    }
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
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.theme.light.bloom, 0.5, this.theme.light.bloomThreshold ?? 1.05);
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

  /** (Re)build car views for the world's players (pooled per model and team). */
  setWorld(world: World): void {
    for (const v of this.cars.values()) releaseCarView(v);
    this.cars.clear();
    this.track.clear();
    for (const car of world.cars) {
      const model = world.players.find((p) => p.id === car.id)?.body ?? 'octane';
      const v = acquireCarView(car.id, car.team, model);
      this.cars.set(car.id, v);
      this.scene.add(v.root);
    }
    this.cam.reset();
  }

  /** Forget landing / flip-reset history (switching between the match and a replay). */
  resetTracking(): void {
    this.track.clear();
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
        this.arena?.cheer(e.team);
        break;
      case 'go':
        this.arena?.roar();
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
  frame(world: World, prev: Map<number, Pose>, prevBall: THREE.Vector3, alpha: number, dt: number, follow: number | null, fixedCam: THREE.Vector3 | null = null): void {
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
      let tr = this.track.get(car.id);
      if (!tr) this.track.set(car.id, (tr = { air: 0, onGround: car.onGround, hasFlipped: false, hasJumped: false, sliding: false }));
      if (car.demolished) {
        tr.air = 0;
        tr.onGround = true;
        tr.sliding = false;
        this.fx.ribbon(`${car.id}a`, view.wheelWorld[2]!, UP, false, car.team);
        continue;
      }
      // Boost / supersonic / powerslide particles.
      const back = v2.set(-1, 0, 0).applyQuaternion(view.root.quaternion);
      const vel = toThree(car.vel.x, car.vel.y, car.vel.z, new THREE.Vector3());
      const up = v3.set(0, 1, 0).applyQuaternion(view.root.quaternion).clone();
      if (car.isBoosting) this.fx.boost(view.exhaust.clone().applyMatrix4(view.root.matrixWorld), back, vel, car.team);
      this.fx.ribbon(`${car.id}a`, view.wheelWorld[2]!, up, car.supersonic, car.team);
      this.fx.ribbon(`${car.id}b`, view.wheelWorld[3]!, up, car.supersonic, car.team);
      const sliding = car.handbrakeVal > 0.5 && car.onGround && car.speed > 600;
      if (sliding) {
        if (Math.random() < 0.5) this.fx.slide(view.wheelWorld[2 + Math.floor(Math.random() * 2)]!);
        this.fx.skid(`${car.id}a`, view.wheelWorld[2]!, up);
        this.fx.skid(`${car.id}b`, view.wheelWorld[3]!, up);
      } else if (tr.sliding) {
        this.fx.skidEnd(`${car.id}a`);
        this.fx.skidEnd(`${car.id}b`);
      }
      tr.sliding = sliding;
      // Grinding on a wall / ceiling at speed.
      if (car.onGround && car.up.z < 0.45 && car.speed > 900 && Math.random() < 0.6) this.fx.sparks(view.wheelWorld[Math.floor(Math.random() * 4)]!, vel);
      // Landing after a long flight; flip reset (the dodge comes back while airborne).
      if (car.onGround) {
        if (!tr.onGround && tr.air > 0.5) {
          const strength = Math.min(1, tr.air / 2);
          this.fx.land(view.root.position, strength);
          this.onFx?.({ k: 'land', car: car.id, strength });
        }
        tr.air = 0;
      } else {
        tr.air += dt;
        if (!tr.onGround && ((tr.hasFlipped && !car.hasFlipped) || (tr.hasJumped && !car.hasJumped && !car.isJumping))) {
          this.fx.flipReset(view.root.position);
          this.onFx?.({ k: 'flipReset', car: car.id });
        }
      }
      tr.onGround = car.onGround;
      tr.hasFlipped = car.hasFlipped;
      tr.hasJumped = car.hasJumped;
    }
    this.ballPos.copy(prevBall).lerp(world.ball.pos, alpha);
    this.ball.errPos.multiplyScalar(Math.exp(-dt * 10));
    this.ball.setScale(world.rules.ballSize);
    // The ball is destroyed by the goal explosion until the next kickoff.
    this.ball.mesh.visible = world.phase !== 'goal';
    this.ball.update(this.ballPos, world.ball.angVel, dt);
    this.pads.setScale(world.rules.padSize);
    this.pads.update(world.pads.map((p) => p.timer), dt);
    this.fx.update(dt, this.cam.camera.position);
    // Goal frames pulse after a goal; goal boxes fade when the camera sits behind that goal line.
    if (this.arena) {
      this.arena.update(dt);
      const cz = this.cam.camera.position.z;
      for (const t of [0, 1]) {
        this.goalFlash[t] = Math.max(0, this.goalFlash[t]! - dt * 0.4);
        const m = this.arena.goalLights[t] as THREE.MeshBasicMaterial;
        const base = t === 0 ? [0.24, 0.55, 1] : [1, 0.54, 0.12];
        const k = 1.8 + this.goalFlash[t]! * 6 * (0.5 + 0.5 * Math.sin(performance.now() / 60));
        m.color.setRGB(base[0]! * k, base[1]! * k, base[2]! * k);
        const behind = t === 0 ? cz > ARENA.halfY * S : cz < -ARENA.halfY * S;
        const f = (this.shellFade[t] += ((behind ? 0.1 : 1) - this.shellFade[t]!) * Math.min(1, dt * 8));
        const shell = this.arena.shells[t]!;
        shell.opacity = f;
        shell.transparent = f < 0.995;
      }
    }

    const car = follow != null ? world.car(follow) : undefined;
    const view = follow != null ? this.cars.get(follow) : undefined;
    if (fixedCam) {
      this.cam.broadcast(toThree(fixedCam.x, fixedCam.y, fixedCam.z, v1), toThree(this.ballPos.x, this.ballPos.y, this.ballPos.z, v2), dt);
    } else if (car && view && !car.demolished) {
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

  /** Studio shots of every car for the garage. */
  carThumbs(team: 0 | 1): Map<CarId, string> {
    return renderCarThumbs(team, this.scene.environment);
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
const UP = new THREE.Vector3(0, 1, 0);
