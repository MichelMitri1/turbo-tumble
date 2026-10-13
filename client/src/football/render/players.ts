import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Kit, PlayerDef } from '../sim/data';
import type { FramePlayer } from '../sim/snapshot';
import { CELEB } from '../sim/match';
import { SKILL_BY_ID } from '../sim/skills';
import { GLOVE_LENGTH, GLOVE_PALM_REACH, KEEPER_DIVE_TIME, keeperDivePose } from '../sim/keeper';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Footballers: the CC0 Quaternius character (tools/football-assets.mjs) with the kit
 * painted on per team — shirt pattern done in the shader (stripes / hoops / sash /
 * halves in the model's own space, so it moves with the body) — plus skin and hair.
 *
 * Animation is two layers:
 *  - clips, blended by where the player is actually moving relative to where he faces
 *    (run / backpedal / strafe left / strafe right / walk / idle), with one-shots
 *    (kicks, throws, falls) cross-faded over the top;
 *  - a procedural layer on the bones after the mixer: the head tracks the ball, the body
 *    leans into acceleration and banks into turns, keepers crouch into their set position
 *    and reach both gloves toward saves, headers leap, celebrations slide on their knees.
 */

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
let gltf: GLTF | null = null;
export async function loadPlayerModel(): Promise<void> {
  gltf ??= await loader.loadAsync('/assets/football/player.glb');
}

export const SKINS = ['#f3d2b8', '#e8b48f', '#cf9670', '#a8704a', '#7a4c2f', '#55331f'];
export const HAIRS = ['#1b120c', '#3b2414', '#6b4423', '#a8783e', '#d9b56c', '#2a2a2a', '#7a2e12', '#c9c9c9'];
const PATTERN = { plain: 0, stripes: 1, hoops: 2, sash: 3, halves: 4 } as const;

let rigBox: THREE.Box3 | null = null;

/** A shirt material: base colour + a second colour in a pattern (the model's quantized object space: roughly −0.35 … 0.35). */
function shirtMaterial(kit: Kit): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: kit.shirt, roughness: 0.62, metalness: 0.02 });
  const uniforms = { uTrim: { value: new THREE.Color(kit.trim) }, uPattern: { value: PATTERN[kit.pattern] } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vKitPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvKitPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKitPos;\nuniform vec3 uTrim;\nuniform int uPattern;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float m = 0.0;
          vec3 p = vKitPos;
          if (uPattern == 1) m = step(0.5, fract(p.x * 4.5 + 0.25));
          else if (uPattern == 2) m = step(0.5, fract(p.y * 11.0));
          else if (uPattern == 3) m = step(abs(p.x + p.y * 0.85 - 0.02), 0.075);
          else if (uPattern == 4) m = step(0.0, p.x);
          diffuseColor.rgb = mix(diffuseColor.rgb, uTrim, m);
          // Woven fabric: a fine knit that catches the floodlights.
          float knit = sin(p.x * 900.0) * sin(p.y * 900.0);
          diffuseColor.rgb *= 0.96 + 0.04 * knit;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'kit';
  return mat;
}

/** What a player sees around him this frame (the ball, the match moment). */
export interface PoseContext {
  ball: { x: number; y: number; z: number; owner?: number; vx?: number; vy?: number; vz?: number };
  phase: string;
  /** Team celebrating a goal (−1 if none). */
  celebTeam: number;
  /** x of the goal this player defends. */
  ownGoalX: number;
  time: number;
  /** The restart being set up, who's taking it, seconds since the phase began, and this player's index. */
  restart?: string | null;
  taker?: number;
  phaseT?: number;
  self?: number;
}

type LocoClip = 'Idle' | 'Walk' | 'Run' | 'Run_Back' | 'Run_Left' | 'Run_Right';
const LOCO: LocoClip[] = ['Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right'];

const _pq = new THREE.Quaternion();
const _pqi = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

const damp = (cur: number, to: number, rate: number, dt: number) => cur + (to - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class PlayerView {
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  private tilter: THREE.Group;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  /** Locomotion blend weights (smoothed). */
  private lw: Record<LocoClip, number> = { Idle: 1, Walk: 0, Run: 0, Run_Back: 0, Run_Left: 0, Run_Right: 0 };
  /** The one-shot / held pose over the locomotion, and its weight. */
  private over: THREE.AnimationAction | null = null;
  private overW = 0;
  private overOn = false;
  private lastState = '';
  private lastKick: string | null = null;
  private stateAge = 0;
  private prev = { x: 0, z: 0, face: 0, ok: false };
  private vel = { x: 0, z: 0 };
  private acc = 0;
  private yawRate = 0;
  // Procedural pose, smoothed.
  private p = { tilt: 0, roll: 0, lift: 0, spin: 0, lean: 0, bank: 0, headYaw: 0, headPitch: 0, crouch: 0, armsUp: 0, armsOut: 0, armsFwd: 0, elbows: 0, spineBack: 0, upR: 0, fwdR: 0, outR: 0, elbR: 0, upL: 0, fwdL: 0, outL: 0, elbL: 0 };
  /** One-arm signals on top of everything (referees: whistle, point, card, flag). */
  signal: { upR?: number; fwdR?: number; outR?: number; elbR?: number; upL?: number; fwdL?: number; outL?: number; elbL?: number; headPitch?: number } | null = null;
  private gestureT = 0;
  /** A gesture for a few seconds (a protest with the arms out, head down after a booking). */
  gesture(sig: NonNullable<PlayerView['signal']>, secs: number): void {
    this.signal = sig;
    this.gestureT = secs;
  }
  /** Something in the right hand (a referee's flag or card). */
  hold(obj: THREE.Object3D): void {
    const wrist = this.bones.WristR;
    if (!wrist) return;
    // The wrist bone is in the model's (scaled) units: undo that so the prop keeps its size in metres.
    const s = 1 / this.body.scale.x;
    obj.scale.multiplyScalar(s);
    wrist.add(obj);
  }
  private bones: Record<string, THREE.Bone | undefined> = {};
  /**
   * Each posed bone's rotation as the mixer left it. The mixer skips writing a bone whose
   * animated value hasn't changed since the last frame, so the procedural layer has to put
   * these back before the mixer runs, or its rotations would pile up frame after frame.
   */
  private unposed = new Map<THREE.Bone, THREE.Quaternion>();
  private chains = new Map<THREE.Bone, THREE.Object3D[]>();
  readonly height: number;
  private mats: Record<string, THREE.MeshStandardMaterial> = {};
  private gloveGeometry: THREE.BufferGeometry[] = [];
  private celebStyle: number;

  constructor(
    readonly def: PlayerDef,
    kit: Kit,
    /** Playing in goal (the slot, not his natural position: team management can put anyone there). */
    readonly keeper = def.role === 'GK',
  ) {
    const g = gltf!;
    this.body = cloneSkinned(g.scene) as THREE.Group;
    if (!rigBox) rigBox = new THREE.Box3().setFromObject(g.scene);
    const h = rigBox.max.y - rigBox.min.y || 1;
    const target = 1.72 + (def.stats.phy - 70) * 0.004 + (keeper ? 0.08 : 0);
    this.height = target;
    this.body.scale.setScalar(target / h);
    this.body.position.y = -rigBox.min.y * (target / h);
    this.root = new THREE.Group();
    this.tilter = new THREE.Group();
    this.tilter.add(this.body);
    this.root.add(this.tilter);
    this.celebStyle = (def.num * 7 + def.name.length) % 3;
    const boot = ['#111111', '#f4f4f4', '#e8ff3a', '#ff5a1f', '#2a6bff', '#ff2d8a'][(def.num + def.name.length) % 6]!;
    this.mats = {
      Shirt: shirtMaterial(kit),
      Shorts: new THREE.MeshStandardMaterial({ color: kit.shorts, roughness: 0.6 }),
      Socks: new THREE.MeshStandardMaterial({ color: kit.socks, roughness: 0.8 }),
      Boots: new THREE.MeshStandardMaterial({ color: boot, roughness: 0.28, metalness: 0.15 }),
      Skin: new THREE.MeshStandardMaterial({ color: SKINS[def.skin % SKINS.length], roughness: 0.55 }),
      Skin_Darker: new THREE.MeshStandardMaterial({ color: new THREE.Color(SKINS[def.skin % SKINS.length]).multiplyScalar(0.82), roughness: 0.6 }),
      Hair: new THREE.MeshStandardMaterial({ color: HAIRS[def.hair % HAIRS.length], roughness: 0.85 }),
    };
    this.body.traverse((n) => {
      const m = n as THREE.SkinnedMesh;
      if ((n as THREE.Bone).isBone) this.bones[n.name] = n as THREE.Bone;
      if (!m.isMesh) return;
      m.castShadow = true;
      // Culled against a fixed sphere round the body (generous: dives, slides, celebrations),
      // instead of skinning every player every frame whether he's in shot or not.
      if (m.isSkinnedMesh) {
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const gs = m.geometry.boundingSphere!;
        m.boundingSphere = new THREE.Sphere(gs.center.clone(), gs.radius * 1.7);
      }
      m.frustumCulled = true;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => this.mats[src.name] ?? src);
      m.material = Array.isArray(m.material) ? mats : mats[0]!;
    });
    if (keeper) this.addGloves();
    this.mixer = new THREE.AnimationMixer(this.body);
    for (const clip of g.animations) {
      const a = this.mixer.clipAction(clip);
      if (['Kick_Left', 'Kick_Right', 'HitRecieve', 'Death', 'Interact', 'Roll'].includes(clip.name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(clip.name, a);
    }
    // Locomotion clips all run together; their weights do the blending.
    for (const n of LOCO) {
      const a = this.actions.get(n)!;
      a.enabled = true;
      a.setEffectiveWeight(n === 'Idle' ? 1 : 0);
      a.play();
      // Different players, different rhythm.
      a.time = (def.num * 0.137) % a.getClip().duration;
    }
  }

  setKit(kit: Kit): void {
    this.mats.Shirt!.color.set(kit.shirt);
    this.mats.Shorts!.color.set(kit.shorts);
    this.mats.Socks!.color.set(kit.socks);
  }

  /** Start a one-shot (or held pose) over the locomotion. */
  private overlay(name: string, speed = 1, restart = true): void {
    const a = this.actions.get(name);
    if (!a) return;
    if (this.over && this.over !== a) this.over.setEffectiveWeight(0).stop();
    if (restart || this.over !== a) {
      a.reset();
      a.play();
    }
    a.enabled = true;
    a.timeScale = speed;
    this.over = a;
    this.overOn = true;
  }
  private release(): void {
    this.overOn = false;
  }

  update(f: FramePlayer, dt: number, ctx: PoseContext): void {
    this.root.visible = f.state !== 'off';
    if (!this.root.visible) return;
    if (this.gestureT > 0) {
      this.gestureT -= dt;
      if (this.gestureT <= 0) this.signal = null;
    }
    this.root.position.set(f.x, 0, f.z);
    this.root.rotation.y = f.face + Math.PI / 2;
    // Motion from the frames themselves (works the same for live, online and replays).
    if (dt > 0) {
      if (this.prev.ok && Math.hypot(f.x - this.prev.x, f.z - this.prev.z) < 3) {
        const vx = (f.x - this.prev.x) / dt;
        const vz = (f.z - this.prev.z) / dt;
        const sp0 = Math.hypot(this.vel.x, this.vel.z);
        this.vel.x = damp(this.vel.x, vx, 14, dt);
        this.vel.z = damp(this.vel.z, vz, 14, dt);
        this.acc = damp(this.acc, (Math.hypot(this.vel.x, this.vel.z) - sp0) / dt, 6, dt);
        this.yawRate = damp(this.yawRate, wrap(f.face - this.prev.face) / dt, 8, dt);
      }
      this.prev = { x: f.x, z: f.z, face: f.face, ok: true };
    }
    const state = f.state;
    const entered = state !== this.lastState || (state === 'kick' && f.kick !== this.lastKick);
    this.lastState = state;
    this.lastKick = f.kick;
    this.stateAge = entered ? 0 : this.stateAge + dt;
    const isGK = this.keeper;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    // Velocity in the body's frame: forward / to the right.
    const fx = Math.cos(f.face);
    const fz = -Math.sin(f.face);
    const vf = this.vel.x * fx + this.vel.z * fz;
    const vr = this.vel.x * -fz + this.vel.z * fx;
    // Ball in the body's frame (for the eyes).
    const bdx = ctx.ball.x - f.x;
    const bdz = ctx.ball.z - f.z;
    const bd = Math.hypot(bdx, bdz);
    const ballYaw = Math.atan2(bdx * fz - bdz * fx, bdx * fx + bdz * fz); // + = to his left
    // Targets for the procedural layer.
    const t = { tilt: 0, roll: 0, lift: 0, spin: 0, lean: 0, bank: 0, headYaw: 0, headPitch: 0, crouch: 0, armsUp: 0, armsOut: 0, armsFwd: 0, elbows: 0, spineBack: 0, upR: 0, fwdR: 0, outR: 0, elbR: 0, upL: 0, fwdL: 0, outL: 0, elbL: 0, ...(this.signal ?? {}) };
    let look = true;
    let loco = true;
    const goalNear = Math.abs(ctx.ball.x - ctx.ownGoalX) < 30 && ctx.phase === 'play';
    switch (state) {
      case 'place': {
        if (entered) this.overlay('Idle_Neutral', 1);
        const u = clamp(1 - f.t / 1.4, 0, 1);
        const bend = Math.sin(Math.PI * u);
        t.crouch = bend * 1.25; t.lean = bend * 0.8;
        t.armsFwd = 0.75; t.elbows = 0.2 + bend * 0.4; t.headPitch = 0.65;
        look = false; loco = false;
        break;
      }
      case 'kick':
      case 'tackle': {
        if (f.kick === 'bicycle') {
          // Overhead kick: up and over backwards, the leg scissoring through, then down on his back.
          if (entered) this.overlay(f.leftFoot ? 'Kick_Left' : 'Kick_Right', 1.1);
          const k = clamp(this.stateAge / 0.9, 0, 1);
          t.tilt = k < 0.7 ? -2.1 * Math.min(1, k * 2.2) : -1.45;
          t.lift = k < 0.7 ? 0.15 + Math.sin(Math.min(1, k * 1.45) * Math.PI) * 0.85 : 0.14;
          t.armsOut = 0.85;
          t.headPitch = -0.3;
          look = false;
        } else if (f.kick === 'header') {
          if (entered) this.overlay('Idle_Neutral', 1);
          // Leap, arch back, then snap the head through it.
          const k = clamp(this.stateAge / 0.42, 0, 1);
          t.lift = Math.sin(k * Math.PI) * 0.45;
          t.spineBack = k < 0.45 ? 0.35 : -0.45;
          t.armsOut = 0.7;
          t.headPitch = k < 0.45 ? -0.3 : 0.45;
          look = false;
        } else if (f.kick === 'throw' || f.kick === 'gkThrow') {
          if (entered) this.overlay('Interact', f.kick === 'throw' ? 1.2 : 1.5);
          if (f.kick === 'throw') {
            t.armsUp = this.stateAge < 0.3 ? 1 : 0.6;
            t.spineBack = this.stateAge < 0.3 ? 0.35 : -0.2;
          }
        } else {
          const shot = f.kick === 'shot' || f.kick === 'penalty' || f.kick === 'clear' || f.kick === 'finesse' || f.kick === 'chip' || f.kick === 'power';
          // A power shot: slower, longer swing, leaning right over it.
          if (entered) this.overlay(f.leftFoot ? 'Kick_Left' : 'Kick_Right', f.kick === 'power' ? 1.0 : shot ? 1.25 : state === 'tackle' ? 1.7 : 1.45);
          // Over the ball, arms out for balance (the opposite arm swings across).
          t.lean = f.kick === 'power' ? 0.3 : shot ? 0.18 : 0.08;
          t.armsOut = f.kick === 'power' ? 0.75 : shot ? 0.55 : 0.3;
          if (state === 'tackle') t.lean = 0.22;
          look = false;
        }
        loco = false;
        break;
      }
      case 'skill': {
        // Skill moves: the footwork comes from the locomotion blend (the sim moves him); the body sells it.
        const a = this.stateAge;
        const advanced = f.trick > 7 ? SKILL_BY_ID.get(f.trick) : null;
        if (advanced) {
          t.armsOut = advanced.family === 'spin' || advanced.family === 'juggle' ? 0.7 : 0.4;
          t.bank = Math.sin(a * (advanced.family === 'step' ? 22 : 12)) * (advanced.family === 'feint' || advanced.family === 'elastic' ? 0.38 : 0.18);
          t.lean = advanced.family === 'drag' || advanced.family === 'stop' ? -0.15 : 0.18;
          if (advanced.lift && entered) this.overlay(f.leftFoot ? 'Kick_Left' : 'Kick_Right', 1.8);
          t.spineBack = advanced.lift ? 0.25 : 0;
          t.lift = advanced.lift ? Math.sin(Math.min(1, a / advanced.duration) * Math.PI) * 0.1 : 0;
        } else if (f.trick === 4 || f.trick === 5) {
          // Flick up / rainbow: heel up behind, the ball rolled up the calf.
          if (entered) this.overlay(f.leftFoot ? 'Kick_Left' : 'Kick_Right', f.trick === 5 ? 1.9 : 1.7);
          t.spineBack = f.trick === 5 ? 0.3 : 0.1;
          t.lift = f.trick === 5 ? Math.sin(clamp(a / 0.4, 0, 1) * Math.PI) * 0.12 : 0;
          loco = false;
        } else if (f.trick === 3) {
          // Step-over: dip the shoulder one way, then the other.
          t.bank = Math.sin(a * 16) * 0.32;
          t.lean = 0.15;
        } else if (f.trick === 6) {
          t.armsOut = 0.5;
          t.lean = 0.1;
        } else {
          // Drag back / ball roll: sole on the ball, arms out for balance.
          t.armsOut = 0.45;
          t.spineBack = f.trick === 2 ? 0.15 : 0;
        }
        t.headPitch = 0.35;
        look = false;
        break;
      }
      case 'slide':
        // Feet first along the ground, one arm down behind for balance.
        t.tilt = -1.2;
        t.lift = 0.22;
        t.armsOut = 0.6;
        t.headPitch = 0.6;
        if (entered) this.overlay('Idle_Neutral', 1);
        loco = false;
        look = false;
        break;
      case 'rise': {
        const k = clamp(f.t / 0.4, 0, 1);
        t.tilt = -1.2 * k;
        t.lift = 0.22 * k;
        if (entered) this.overlay('Idle_Neutral', 1, false);
        loco = false;
        break;
      }
      case 'jump': {
        // Wall jump: up together, arms tucked, back down.
        if (entered) this.overlay('Idle_Neutral', 1);
        const k = Math.max(0, Math.min(1, 1 - f.t / 0.62));
        t.lift = Math.sin(k * Math.PI) * 0.55;
        t.armsFwd = 0.25;
        t.elbows = 0.8;
        t.headPitch = -0.2;
        loco = false;
        look = false;
        break;
      }
      case 'down':
        if (entered) this.overlay('Death', 1.6);
        loco = false;
        look = false;
        break;
      case 'dive': {
        if (entered) this.overlay('Idle_Neutral', 1);
        Object.assign(t, keeperDivePose(f.t, f.diveZ, f.diveY, f.face, this.height));
        loco = false;
        break;
      }
      case 'hold':
        // Ball clutched to the chest.
        t.armsFwd = 0.85;
        t.elbows = 1;
        if (speed < 0.5) {
          if (entered || !this.overOn) this.overlay('Idle_Neutral', 1, false);
          loco = false;
        } else this.release();
        break;
      case 'celebrate': {
        loco = f.t > CELEB.slide;
        look = false;
        if (f.t > CELEB.slide) {
          this.release();
          // Wheeling away: the aeroplane, or a fist in the air.
          if (this.celebStyle === 1) {
            t.armsUp = 0.55;
            t.armsOut = 0.3;
          } else t.armsOut = 1;
          t.headPitch = -0.25;
        } else if (this.celebStyle !== 1) {
          // On the knees across the grass (shins sink below the turf), back arched, arms wide.
          if (!this.overOn) this.overlay('Idle_Neutral', 1);
          const k = clamp((CELEB.slide - f.t) / 0.25, 0, 1);
          t.lift = -0.46 * k;
          t.spineBack = 0.45 * k;
          t.tilt = -0.15 * k;
          t.armsUp = this.celebStyle === 2 ? 1 : 0.55;
          t.armsOut = this.celebStyle === 2 ? 0 : 0.6;
          t.headPitch = -0.55;
          if (f.t < CELEB.pose - 0.8) {
            // Back up, arms aloft, roaring at the crowd.
            const u = clamp((CELEB.pose - 0.8 - f.t) / 0.4, 0, 1);
            t.lift = -0.46 * (1 - u);
            t.spineBack = 0.3;
            t.armsUp = 1;
          }
        } else {
          // The jump and spin with the arms flung out — and land it.
          if (!this.overOn) this.overlay('Idle_Neutral', 1);
          const j = clamp((CELEB.slide - f.t) / 0.75, 0, 1);
          t.lift = Math.sin(j * Math.PI) * 0.75;
          t.spin = j * Math.PI;
          t.armsOut = 1;
          t.armsUp = j >= 1 ? 1 : 0.2;
          t.spineBack = j >= 1 ? 0.35 : 0;
          t.headPitch = -0.4;
        }
        break;
      }
      default:
        this.release();
        // Goal: team-mates of the scorer pile in with their arms up; the others trudge.
        if (ctx.phase === 'goal' && ctx.celebTeam >= 0) {
          if (ctx.celebTeam === this.teamHint) {
            t.armsUp = speed < 3 ? 0.9 : 0.3;
            t.armsOut = 0.3;
            look = false;
          } else {
            t.headPitch = 0.55;
            t.armsFwd = -0.1;
            t.elbows = 0.6;
            t.armsOut = 0.35;
            look = false;
          }
        } else if (ctx.restart === 'goalkick' && ctx.taker === ctx.self && ctx.phase === 'stop' && (ctx.phaseT ?? 9) < 1.2) {
          // Goal kick: bending down to place the ball.
          const k = Math.sin(clamp((ctx.phaseT ?? 0) / 1.2, 0, 1) * Math.PI);
          t.lean = 0.9 * k;
          t.crouch = 0.7 * k;
          t.armsFwd = 0.9 * k;
          t.headPitch = 0.5 * k;
          look = false;
        } else if (ctx.phase === 'kickoff' && ctx.taker !== ctx.self && (ctx.phaseT ?? 9) < 2.8) {
          // Waiting for the whistle: on the toes, bouncing on the spot.
          t.lift = Math.abs(Math.sin(ctx.time * 7 + this.def.num)) * 0.035;
          t.armsOut = 0.12;
        } else if (isGK && goalNear) {
          // Set position: knees bent, weight forward, hands out ready.
          t.crouch = 1;
          t.armsOut = 0.42;
          t.armsFwd = 0.35;
          t.elbows = 0.35;
        }
        // Sprinting: lean into it; accelerating harder leans more. Bank into turns.
        t.lean += clamp(vf / 9, -0.2, 1) * 0.16 + clamp(this.acc / 12, -0.4, 0.6) * 0.12;
        t.bank = clamp(-this.yawRate * speed * 0.012, -0.22, 0.22);
    }
    // ---- clip weights
    const ow = this.overOn ? 1 : 0;
    this.overW = damp(this.overW, ow, this.overOn ? 22 : 9, dt);
    if (this.over) {
      this.over.setEffectiveWeight(this.overW);
      if (!this.overOn && this.overW < 0.01) {
        this.over.stop();
        this.over = null;
      }
    }
    const lt: Record<LocoClip, number> = { Idle: 0, Walk: 0, Run: 0, Run_Back: 0, Run_Left: 0, Run_Right: 0 };
    if (loco) {
      if (speed < 0.5) lt.Idle = 1;
      else {
        const a = Math.atan2(vr, vf);
        let wF = Math.max(0, Math.cos(a));
        let wB = Math.max(0, -Math.cos(a));
        let wR = Math.max(0, Math.sin(a));
        let wL = Math.max(0, -Math.sin(a));
        // Sharpen so a mostly-forward run is a run, not a crab.
        [wF, wB, wR, wL] = [wF, wB, wR, wL].map((w) => w * w);
        const sum = wF + wB + wR + wL || 1;
        const idle = clamp(1 - (speed - 0.5) / 0.9, 0, 1);
        const move = 1 - idle;
        const walk = clamp(1 - (speed - 2.6) / 1.2, 0, 1);
        lt.Idle = idle;
        lt.Walk = (wF / sum) * move * walk;
        lt.Run = (wF / sum) * move * (1 - walk);
        lt.Run_Back = (wB / sum) * move;
        lt.Run_Right = (wR / sum) * move;
        lt.Run_Left = (wL / sum) * move;
      }
    }
    const scale = 1 - this.overW;
    for (const n of LOCO) {
      this.lw[n] = damp(this.lw[n], lt[n], 12, dt);
      const a = this.actions.get(n)!;
      a.setEffectiveWeight(this.lw[n] * scale);
    }
    // Stride rate follows the ground speed (no skating).
    this.actions.get('Run')!.timeScale = clamp(speed / 6.4, 0.7, 1.65) * (f.sprint ? 1.06 : 1);
    this.actions.get('Walk')!.timeScale = clamp(speed / 1.5, 0.6, 1.8);
    for (const n of ['Run_Back', 'Run_Left', 'Run_Right'] as const) this.actions.get(n)!.timeScale = clamp(speed / 4.6, 0.6, 1.5);
    for (const [b, q] of this.unposed) b.quaternion.copy(q);
    this.mixer.update(dt);
    for (const [b, q] of this.unposed) q.copy(b.quaternion);

    // ---- procedural layer
    if (look && bd > 0.5) {
      t.headYaw = clamp(ballYaw, -1.25, 1.25);
      // Looking down at the ball at his feet, up at a high one.
      t.headPitch += clamp(Math.atan2(1.6 - ctx.ball.y, bd) * 0.75, -0.6, 0.55);
    }
    const rate = state === 'dive' || state === 'kick' ? 18 : 10;
    const P = this.p;
    for (const k of Object.keys(P) as Array<keyof typeof P>) P[k] = damp(P[k], t[k], k === 'headYaw' || k === 'headPitch' ? 7 : rate, dt);
    // The physical reach and the rendered body share this exact pose. Sampling
    // the state timer also makes seeking, pausing and reverse playback correct.
    if (state === 'dive') {
      for (const k of ['tilt', 'roll', 'lift', 'spin', 'lean', 'bank', 'crouch', 'spineBack', 'armsUp', 'armsOut', 'armsFwd', 'elbows'] as const) P[k] = t[k];
    }
    // A full spin snaps back cleanly once it's done.
    if (t.spin === 0 && Math.abs(P.spin) > 0.01 && state !== 'celebrate') P.spin = 0;
    const tl = this.tilter;
    tl.rotation.set(P.tilt, P.spin, P.roll + P.bank);
    tl.position.y = P.lift - P.crouch * 0.1;
    this.pose(P);
    if (isGK && (state === 'dive' || state === 'hold' || (state === 'run' && ctx.phase === 'play' && ctx.ball.owner === -1 && bd < 2.5))) {
      this.reachForBall(f, ctx);
    }
  }

  private addGloves(): void {
    // The source rig's fingers extend 0.27m from the wrist. Fit the padding
    // around that skin rather than leaving bare fingers outside a tiny mitten.
    const palm = new RoundedBoxGeometry(0.185, GLOVE_LENGTH, 0.094, 3, 0.025);
    const thumb = new THREE.CapsuleGeometry(0.03, 0.075, 4, 8);
    const cuff = new RoundedBoxGeometry(0.16, 0.045, 0.092, 2, 0.012);
    this.gloveGeometry.push(palm, thumb, cuff);
    this.mats.Glove = new THREE.MeshStandardMaterial({ color: '#f5f4e9', roughness: 0.7 });
    this.mats.GloveCuff = new THREE.MeshStandardMaterial({ color: '#263b46', roughness: 0.65 });
    for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
      const wrist = this.bones[`Wrist${side}`];
      if (!wrist) continue;
      const glove = new THREE.Group();
      glove.name = `keeper-glove-${side}`;
      glove.scale.setScalar(1 / this.body.scale.x);
      const mitt = new THREE.Mesh(palm, this.mats.Glove);
      mitt.position.y = GLOVE_PALM_REACH;
      const digit = new THREE.Mesh(thumb, this.mats.Glove);
      digit.position.set(sign * 0.09, 0.075, 0.005);
      digit.rotation.z = -sign * 0.45;
      const strap = new THREE.Mesh(cuff, this.mats.GloveCuff);
      strap.position.y = -0.012;
      glove.add(mitt, digit, strap);
      glove.traverse(n => { if ((n as THREE.Mesh).isMesh) n.castShadow = true; });
      wrist.add(glove);
    }
  }

  /** Both arms solve shoulder → elbow → wrist without stretching the rig. */
  private reachForBall(f: FramePlayer, ctx: PoseContext): void {
    this.root.updateMatrixWorld(true);
    const upperL = this.bones.UpperArmL, upperR = this.bones.UpperArmR;
    if (!upperL || !upperR) return;
    const left = upperL.getWorldPosition(new THREE.Vector3()), right = upperR.getWorldPosition(new THREE.Vector3());
    const middle = left.clone().add(right).multiplyScalar(0.5);
    const across = left.clone().sub(right).normalize();
    const ball = new THREE.Vector3(ctx.ball.x, ctx.ball.y, ctx.ball.z);
    const owned = ctx.ball.owner === ctx.self;
    // After a missed shot has gone past, gather the hands for landing instead
    // of twisting both shoulders backwards after a ball in the net.
    if (f.state === 'dive' && !owned && (KEEPER_DIVE_TIME - f.t > 0.72 || ball.distanceTo(middle) > 4)) {
      ball.copy(middle).add(new THREE.Vector3(Math.cos(f.face) * 0.24, -0.08, -Math.sin(f.face) * 0.24));
    }
    const direction = ball.clone().sub(middle).normalize();
    const palm = new THREE.Vector3(-(ctx.ball.vx ?? 0), -(ctx.ball.vy ?? 0), -(ctx.ball.vz ?? 0));
    if (owned || palm.lengthSq() < 0.1) palm.set(Math.cos(f.face), 0, -Math.sin(f.face));
    palm.normalize();
    for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
      const centre = ball.clone().addScaledVector(direction, -0.10).addScaledVector(across, sign * 0.06);
      this.reachArm(side, centre, palm);
    }
  }

  private reachArm(side: 'L' | 'R', centre: THREE.Vector3, palm: THREE.Vector3): void {
    const upper = this.bones[`UpperArm${side}`], lower = this.bones[`LowerArm${side}`], wrist = this.bones[`Wrist${side}`];
    if (!upper?.parent || !lower?.parent || !wrist?.parent) return;
    for (const bone of [upper, lower, wrist]) if (!this.unposed.has(bone)) this.unposed.set(bone, bone.quaternion.clone());
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const elbow = lower.getWorldPosition(new THREE.Vector3());
    const hand = wrist.getWorldPosition(new THREE.Vector3());
    const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(hand);
    const aim = centre.clone().sub(shoulder).normalize();
    const target = centre.clone().addScaledVector(aim, -GLOVE_PALM_REACH);
    const direction = target.clone().sub(shoulder);
    const distance = clamp(direction.length(), Math.abs(a - b) + 0.005, a + b - 0.002);
    direction.normalize();
    target.copy(shoulder).addScaledVector(direction, distance);
    // Elbow bends below/outside the arm, with a stable pole even straight up.
    const pole = new THREE.Vector3(-Math.cos(this.root.rotation.y - Math.PI / 2) * 0.2, shoulder.y < 0.45 ? 1 : -1, Math.sin(this.root.rotation.y - Math.PI / 2) * 0.2);
    pole.addScaledVector(new THREE.Vector3().setFromMatrixColumn(this.root.matrixWorld, 0), side === 'L' ? 0.25 : -0.25);
    pole.addScaledVector(direction, -pole.dot(direction));
    if (pole.lengthSq() < 1e-6) pole.copy(Z).addScaledVector(direction, -direction.z);
    pole.normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, a * a - along * along));
    const wantedElbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(pole, bend);
    const turn = (bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) => {
      const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
      const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
      bone.quaternion.copy(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
      bone.updateWorldMatrix(false, true);
    };
    turn(upper, elbow.clone().sub(shoulder), wantedElbow.clone().sub(shoulder));
    const newElbow = lower.getWorldPosition(new THREE.Vector3());
    turn(lower, wrist.getWorldPosition(new THREE.Vector3()).sub(newElbow), target.clone().sub(newElbow));
    // Fingers extend toward the ball; the padded palm faces the incoming shot.
    const y = centre.clone().sub(wrist.getWorldPosition(new THREE.Vector3())).normalize();
    const z = palm.clone().addScaledVector(y, -palm.dot(y));
    if (z.lengthSq() < 1e-6) {
      z.copy(Math.abs(y.y) < 0.9 ? Y : X);
      z.addScaledVector(y, -z.dot(y));
    }
    z.normalize();
    const x = y.clone().cross(z).normalize();
    z.crossVectors(x, y);
    const world = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    wrist.quaternion.copy(wrist.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    wrist.updateWorldMatrix(false, true);
  }

  /** Which team this player is on (set by the view). */
  teamHint: 0 | 1 = 0;

  /** Rotate a bone by `angle` about an axis given in the player's own frame (+z forward, +y up, +x his left). */
  private twist(name: string, axis: THREE.Vector3, angle: number): void {
    const b = this.bones[name];
    if (!b || !b.parent || Math.abs(angle) < 1e-4) return;
    if (!this.unposed.has(b)) this.unposed.set(b, b.quaternion.clone());
    // The parent's rotation in the player's frame: the product of local rotations from just under
    // the tilter down to the parent (no world-matrix updates: this runs ~15× per player per frame).
    let chain = this.chains.get(b);
    if (!chain) {
      chain = [];
      for (let n: THREE.Object3D | null = b.parent; n && n !== this.tilter; n = n.parent) chain.unshift(n);
      this.chains.set(b, chain);
    }
    _pq.identity();
    for (const n of chain) _pq.multiply(n.quaternion);
    _dq.setFromAxisAngle(axis, angle);
    // local' = P⁻¹ · D · P · local
    _pqi.copy(_pq).invert().multiply(_dq).multiply(_pq);
    b.quaternion.premultiply(_pqi);
  }

  private pose(P: PlayerView['p']): void {
    // Spine: lean forward (+x), arch back, and the keeper's crouch.
    const spine = P.lean + P.crouch * 0.32 - P.spineBack;
    this.twist('Abdomen', X, spine * 0.45);
    this.twist('Torso', X, spine * 0.35);
    this.twist('Chest', X, spine * 0.2);
    // Arms: raised overhead (abduction), out to the side, forward.
    for (const [side, s] of [['L', 1], ['R', -1]] as const) {
      const R = side === 'R';
      const up = (P.armsUp + (R ? P.upR : P.upL)) * 2.5;
      const out = (P.armsOut + (R ? P.outR : P.outL)) * 1.15;
      this.twist(`UpperArm${side}`, Z, s * Math.max(up, out));
      this.twist(`UpperArm${side}`, X, -(P.armsFwd + (R ? P.fwdR : P.fwdL)) * 1.25);
      this.twist(`LowerArm${side}`, X, -(P.elbows + (R ? P.elbR : P.elbL)) * 1.1);
    }
    // Eyes on the ball: mostly the head, some neck.
    _ax.copy(Y);
    this.twist('Neck', _ax, P.headYaw * 0.4);
    this.twist('Head', _ax, P.headYaw * 0.6);
    this.twist('Neck', X, P.headPitch * 0.4);
    this.twist('Head', X, P.headPitch * 0.6);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const m of Object.values(this.mats)) m.dispose();
    for (const g of this.gloveGeometry) g.dispose();
  }
}
