import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FramePlayer } from '../sim/snapshot';
import type { Racket } from '../sim/rackets';
import type { SwingKind } from '../sim/match';
import { racketMesh } from './racket';
import { bodyToWorld, type LiveArm, type V3 } from '../sim/arm';
import { HANDLE_L, HEAD_L } from '../sim/rackets';

/**
 * Padel players: the CC0 Quaternius character (shared with Matchday) in a padel kit, its run / walk /
 * side-step clips for the legs, and the racket arm driven live — two-bone IK to keyframed hand
 * positions for each stroke (forehand, backhand, overhead, underhand serve) with the shoulders turning
 * into it, the racket held in the hand and angled through the swing.
 */
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
let gltf: GLTF | null = null;
export async function loadPlayerModel(): Promise<void> {
  gltf ??= await loader.loadAsync('/assets/football/player.glb');
}

export interface Look {
  shirt: string;
  shorts: string;
  socks: string;
  shoes: string;
  skin: string;
  hair: string;
}

export const SKINS = ['#f3d2b8', '#e8b48f', '#cf9670', '#a8704a', '#7a4c2f', '#55331f'];
export const HAIRS = ['#1b120c', '#3b2414', '#6b4423', '#a8783e', '#d9b56c', '#2a2a2a'];

/** A pose of the racket arm in the player's frame (right, up, forward), relative to the right shoulder. */
interface Pose {
  hand: [number, number, number];
  dir: [number, number, number];
  /** Shoulder turn (radians, + = towards the right side). */
  turn: number;
}
const READY: Pose = { hand: [-0.1, -0.38, 0.38], dir: [0.15, 0.85, 0.35], turn: 0 };
const POSES: Record<SwingKind, [Pose, Pose, Pose]> = {
  fh: [
    { hand: [0.28, -0.18, -0.38], dir: [0.6, 0.3, -0.7], turn: 0.55 },
    { hand: [0.3, -0.25, 0.42], dir: [0.95, 0.15, 0.25], turn: 0.05 },
    { hand: [-0.5, 0.12, 0.35], dir: [-0.6, 0.6, 0.45], turn: -0.45 },
  ],
  bh: [
    { hand: [-0.62, -0.12, -0.15], dir: [-0.6, 0.4, -0.6], turn: -0.6 },
    { hand: [-0.48, -0.25, 0.38], dir: [-0.95, 0.1, 0.3], turn: -0.05 },
    { hand: [0.22, 0.25, 0.32], dir: [0.6, 0.6, 0.45], turn: 0.4 },
  ],
  oh: [
    { hand: [0.12, 0.32, -0.22], dir: [0.1, -0.6, -0.75], turn: 0.4 },
    { hand: [0.15, 0.6, 0.35], dir: [0.05, 0.9, 0.45], turn: 0 },
    { hand: [-0.38, -0.3, 0.38], dir: [-0.4, -0.5, 0.65], turn: -0.4 },
  ],
  serve: [
    { hand: [0.22, -0.55, -0.42], dir: [0.2, -0.6, -0.75], turn: 0.3 },
    { hand: [0.25, -0.5, 0.36], dir: [0.3, -0.2, 0.9], turn: 0 },
    { hand: [0.0, 0.18, 0.45], dir: [0.1, 0.8, 0.5], turn: -0.25 },
  ],
};
/** Swing timeline (s): wind-up until BACK, strike to contact at HIT, follow-through to FOLLOW, recover by END. */
const BACK = 0.12;
const HIT = 0.21;
const FOLLOW = 0.4;
const END = 0.58;

const ease = (t: number) => t * t * (3 - 2 * t);
function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const k = ease(Math.max(0, Math.min(1, t)));
  const L = (x: number[], y: number[]) => x.map((v, i) => v + (y[i]! - v) * k) as [number, number, number];
  return { hand: L(a.hand, b.hand), dir: L(a.dir, b.dir), turn: a.turn + (b.turn - a.turn) * k };
}

function poseAt(kind: SwingKind | null, t: number): Pose {
  if (!kind) return READY;
  const [back, hit, follow] = POSES[kind];
  if (t < BACK) return lerpPose(READY, back, t / BACK);
  if (t < HIT) return lerpPose(back, hit, (t - BACK) / (HIT - BACK));
  if (t < FOLLOW) return lerpPose(hit, follow, (t - HIT) / (FOLLOW - HIT));
  if (t < END) return lerpPose(follow, READY, (t - FOLLOW) / (END - FOLLOW));
  return READY;
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Turn `bone` (world space) so the point `from` (a child's world position) moves towards `to`. */
function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  const p = bone.getWorldPosition(new THREE.Vector3());
  const a = from.clone().sub(p).normalize();
  const b = to.clone().sub(p).normalize();
  if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) return;
  const rot = q1.setFromUnitVectors(a, b);
  rotateWorld(bone, rot);
}

/** Apply a world-space rotation to a bone. */
function rotateWorld(bone: THREE.Object3D, rot: THREE.Quaternion): void {
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const parent = bone.parent ? bone.parent.getWorldQuaternion(q2) : q2.identity();
  bone.quaternion.copy(parent.invert().multiply(rot.clone().multiply(world)));
  bone.updateMatrixWorld(true);
}

export class PlayerView {
  readonly root = new THREE.Group();
  private readonly body: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private loco = '';
  private readonly bones: Record<string, THREE.Bone> = {};
  readonly racket: THREE.Group;
  /** Colour of the live racket's motion trail. */
  trailColor = '#e7f53a';
  private readonly ring: THREE.Mesh;
  /** Smoothed racket-arm pose (so a new swing eases in). */
  private pose: Pose = READY;
  private readonly rest: Array<[THREE.Bone, THREE.Quaternion]> = [];

  constructor(look: Look, racket: Racket, human: boolean, ringColor: string) {
    const g = gltf!;
    this.body = cloneSkinned(g.scene) as THREE.Group;
    const box = new THREE.Box3().setFromObject(g.scene);
    const h = box.max.y - box.min.y || 1;
    const target = 1.78;
    this.body.scale.setScalar(target / h);
    this.body.position.y = -box.min.y * (target / h);
    this.root.add(this.body);
    const mats: Record<string, THREE.MeshStandardMaterial> = {
      Shirt: new THREE.MeshStandardMaterial({ color: look.shirt, roughness: 0.7 }),
      Shorts: new THREE.MeshStandardMaterial({ color: look.shorts, roughness: 0.75 }),
      Socks: new THREE.MeshStandardMaterial({ color: look.socks, roughness: 0.85 }),
      Boots: new THREE.MeshStandardMaterial({ color: look.shoes, roughness: 0.45 }),
      BootSole: new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.6 }),
      Skin: new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.7 }),
      Skin_Darker: new THREE.MeshStandardMaterial({ color: new THREE.Color(look.skin).multiplyScalar(0.82), roughness: 0.7 }),
      Hair: new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.9 }),
    };
    this.body.traverse((n) => {
      const bone = n as THREE.Bone;
      if (bone.isBone) this.bones[bone.name] = bone;
      const m = n as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false;
      const list = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => mats[src.name] ?? src);
      m.material = Array.isArray(m.material) ? list : list[0]!;
    });
    // Rest poses of the bones we turn by hand: reset every frame so turns don't pile up (the clips
    // don't drive all of them).
    for (const n of ['Torso', 'Chest', 'UpperArmR', 'LowerArmR', 'WristR', 'UpperArmL', 'LowerArmL', 'WristL']) {
      const b = this.bones[n];
      if (b) this.rest.push([b, b.quaternion.clone()]);
    }
    this.mixer = new THREE.AnimationMixer(this.body);
    for (const clip of g.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.play('Idle', 0);
    this.racket = racketMesh(racket);
    this.racket.scale.setScalar(1.12);
    this.racket.traverse((n) => ((n as THREE.Mesh).castShadow = true));
    // A ring under the human player(s).
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: human ? 0.85 : 0, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.01;
    this.ring.visible = human;
    this.root.add(this.ring);
  }

  private play(name: string, fade = 0.2, speed = 1): void {
    const a = this.actions.get(name);
    if (!a) return;
    a.timeScale = speed;
    if (this.current === a) return;
    a.reset();
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (this.current && fade > 0) a.crossFadeFrom(this.current, fade, false);
    else if (this.current) this.current.stop();
    a.play();
    this.current = a;
  }

  /** `ball`: where the ball is (the swing reaches up / down for it). Racket is added to `scene` by the caller. */
  update(f: FramePlayer, dt: number, ball: THREE.Vector3): void {
    this.root.position.set(f.x, f.y, f.z);
    this.root.rotation.y = f.facing;
    // Legs: run / side-step / back-pedal by the velocity relative to facing.
    const fx = Math.sin(f.facing), fz = Math.cos(f.facing);
    const vf = f.vx * fx + f.vz * fz;
    const vr = f.vx * -fz + f.vz * fx;
    const speed = Math.hypot(f.vx, f.vz);
    let name = 'Idle';
    let ts = 1;
    if (speed > 0.6) {
      ts = Math.max(0.7, Math.min(1.5, speed / 4));
      if (Math.abs(vr) > Math.abs(vf) * 1.2) name = vr > 0 ? 'Run_Right' : 'Run_Left';
      else name = vf >= 0 ? 'Run' : 'Run_Back';
    }
    if (name !== this.loco) {
      this.play(name, 0.15, ts);
      this.loco = name;
    } else if (this.current) this.current.timeScale = ts;
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    // The racket arm: your own (camera motion play), or the animated swing.
    if (f.arm) {
      this.liveArm(f.arm, f.facing, dt);
      return;
    }
    this.liveSm = null;
    const want = poseAt(f.swing, f.swingT);
    const k = f.swing ? 1 : Math.min(1, dt * 10);
    this.pose = lerpPose(this.pose, want, k);
    this.arm(this.pose, f, ball);
  }

  /** Smoothed live arm directions (the camera updates ~30–60 times a second; we draw at 120+). */
  private liveSm: { yaw: number; upper: THREE.Vector3; fore: THREE.Vector3; dir: THREE.Vector3; normal: THREE.Vector3 } | null = null;

  /** Camera motion play: the arm and racket copy the real arm, exactly. */
  private liveArm(a: LiveArm, facing: number, dt: number): void {
    const B = this.bones;
    const s = a.side === 2 ? 'L' : 'R';
    const upper = B[`UpperArm${s}`];
    const lower = B[`LowerArm${s}`];
    const wrist = B[`Wrist${s}`];
    const torso = B['Torso'] ?? B['Chest'];
    if (!upper || !lower || !wrist) return;
    const w = (v: V3) => new THREE.Vector3(...bodyToWorld(facing, v));
    // The tracker already hands us a clean, predicted pose every frame: only soften any snap.
    const k = Math.min(1, dt * 120);
    const tgt = { yaw: a.yaw, upper: w(a.upper), fore: w(a.fore), dir: w(a.dir), normal: w(a.normal) };
    const sm = this.liveSm;
    if (!sm) this.liveSm = { yaw: tgt.yaw, upper: tgt.upper, fore: tgt.fore, dir: tgt.dir, normal: tgt.normal };
    else {
      sm.yaw += (tgt.yaw - sm.yaw) * k;
      sm.upper.lerp(tgt.upper, k).normalize();
      sm.fore.lerp(tgt.fore, k).normalize();
      sm.dir.lerp(tgt.dir, k).normalize();
      sm.normal.lerp(tgt.normal, k).normalize();
    }
    const L = this.liveSm!;
    // Shoulders turn with yours.
    if (torso && Math.abs(L.yaw) > 0.01) {
      const right = w([1, 0, 0]);
      const turned = w([Math.cos(L.yaw), 0, -Math.sin(L.yaw)]);
      rotateWorld(torso, new THREE.Quaternion().setFromUnitVectors(right, turned));
    }
    const S = upper.getWorldPosition(new THREE.Vector3());
    const E0 = lower.getWorldPosition(new THREE.Vector3());
    const lu = E0.distanceTo(S);
    const lf = wrist.getWorldPosition(new THREE.Vector3()).distanceTo(E0);
    const E = S.clone().addScaledVector(L.upper, lu);
    aimBone(upper, E0, E);
    const W0 = wrist.getWorldPosition(new THREE.Vector3());
    const E1 = lower.getWorldPosition(new THREE.Vector3());
    aimBone(lower, W0, E1.clone().addScaledVector(L.fore, lf));
    // The racket in the hand, along your racket's line, face square to your palm.
    const hand = wrist.getWorldPosition(new THREE.Vector3());
    const rd = L.dir.clone().normalize();
    const normal = L.normal.clone().addScaledVector(rd, -L.normal.dot(rd)).normalize();
    if (normal.lengthSq() < 0.01) normal.set(0, 1, 0);
    const xAxis = new THREE.Vector3().crossVectors(rd, normal).normalize();
    this.racket.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, rd, normal));
    this.racket.position.copy(hand).addScaledVector(rd, -0.05);
  }

  /** Centre of the racket face (world) — for the motion trail. */
  racketHead(out: THREE.Vector3): THREE.Vector3 {
    return this.racket.localToWorld(out.set(0, HANDLE_L + HEAD_L / 2, 0));
  }
  /** The racket's tip (world). */
  racketTip(out: THREE.Vector3): THREE.Vector3 {
    return this.racket.localToWorld(out.set(0, HANDLE_L + HEAD_L, 0));
  }

  private arm(pose: Pose, f: FramePlayer, ball: THREE.Vector3): void {
    const B = this.bones;
    const upper = B['UpperArmR'];
    const lower = B['LowerArmR'];
    const wrist = B['WristR'];
    const torso = B['Torso'] ?? B['Chest'];
    if (!upper || !lower || !wrist) return;
    const fwd = v1.set(Math.sin(f.facing), 0, Math.cos(f.facing));
    const right = v2.set(-fwd.z, 0, fwd.x);
    // Shoulders turn into the shot.
    if (torso && pose.turn) rotateWorld(torso, new THREE.Quaternion().setFromAxisAngle(UP, -pose.turn));
    const S = upper.getWorldPosition(new THREE.Vector3());
    // Reach up or down to meet a ball that's close (contact height follows the ball).
    let du = 0;
    if (f.swing && f.swing !== 'serve' && f.swingT < FOLLOW) {
      const near = Math.hypot(ball.x - f.x, ball.z - f.z) < 1.8;
      if (near) du = Math.max(-0.75, Math.min(0.55, ball.y - (S.y + pose.hand[1]))) * (f.swing === 'oh' ? 0.6 : 0.8);
    }
    const T = S.clone().addScaledVector(right, pose.hand[0]).addScaledVector(UP, pose.hand[1] + du).addScaledVector(fwd, pose.hand[2]);
    // Two-bone IK: elbow in the plane of shoulder → hand and a pole down and behind.
    const E0 = lower.getWorldPosition(new THREE.Vector3());
    const W0 = wrist.getWorldPosition(new THREE.Vector3());
    const a = E0.distanceTo(S);
    const b = W0.distanceTo(E0);
    const toT = T.clone().sub(S);
    const d = Math.min(a + b - 0.002, Math.max(Math.abs(a - b) + 0.002, toT.length()));
    const dir = toT.normalize();
    const pole = new THREE.Vector3().copy(UP).multiplyScalar(-1).addScaledVector(fwd, -0.35).addScaledVector(right, 0.25);
    const perp = pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const E = S.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
    aimBone(upper, E0, E);
    const W1 = wrist.getWorldPosition(new THREE.Vector3());
    aimBone(lower, W1, S.clone().addScaledVector(dir, d));
    // The racket in the hand: along the pose's direction, face square to where it's going.
    const hand = wrist.getWorldPosition(new THREE.Vector3());
    const rd = v3.set(0, 0, 0).addScaledVector(right, pose.dir[0]).addScaledVector(UP, pose.dir[1]).addScaledVector(fwd, pose.dir[2]).normalize();
    const normal = fwd.clone().addScaledVector(rd, -fwd.dot(rd)).normalize();
    if (normal.lengthSq() < 0.01) normal.copy(UP);
    const xAxis = new THREE.Vector3().crossVectors(rd, normal).normalize();
    const m = new THREE.Matrix4().makeBasis(xAxis, rd, normal);
    this.racket.quaternion.setFromRotationMatrix(m);
    this.racket.position.copy(hand).addScaledVector(rd, -0.05);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}
