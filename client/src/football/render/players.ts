import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Kit, PlayerDef } from '../sim/data';
import type { FramePlayer } from '../sim/snapshot';

/**
 * Footballers: the CC0 Quaternius character (tools/football-assets.mjs) with the kit
 * painted on per team — shirt pattern done in the shader (stripes / hoops / sash /
 * halves in the model's own space, so it moves with the body) — plus skin and hair.
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
  const mat = new THREE.MeshStandardMaterial({ color: kit.shirt, roughness: 0.75 });
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
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'kit';
  return mat;
}

export class PlayerView {
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private loco = '';
  private lastState = '';
  private tilt = 0;
  private lift = 0;
  private roll = 0;
  readonly height: number;
  private mats: Record<string, THREE.MeshStandardMaterial> = {};

  constructor(
    readonly def: PlayerDef,
    kit: Kit,
  ) {
    const g = gltf!;
    this.body = cloneSkinned(g.scene) as THREE.Group;
    if (!rigBox) rigBox = new THREE.Box3().setFromObject(g.scene);
    const h = rigBox.max.y - rigBox.min.y || 1;
    const target = 1.72 + (def.stats.phy - 70) * 0.004 + (def.role === 'GK' ? 0.08 : 0);
    this.height = target;
    this.body.scale.setScalar(target / h);
    this.body.position.y = -rigBox.min.y * (target / h);
    this.root = new THREE.Group();
    const tilter = new THREE.Group();
    tilter.add(this.body);
    this.root.add(tilter);
    this.mats = {
      Shirt: shirtMaterial(kit),
      Shorts: new THREE.MeshStandardMaterial({ color: kit.shorts, roughness: 0.75 }),
      Socks: new THREE.MeshStandardMaterial({ color: kit.socks, roughness: 0.85 }),
      Boots: new THREE.MeshStandardMaterial({ color: ['#111111', '#f4f4f4', '#e8ff3a', '#ff5a1f', '#2a6bff'][def.num % 5]!, roughness: 0.4 }),
      Skin: new THREE.MeshStandardMaterial({ color: SKINS[def.skin % SKINS.length], roughness: 0.7 }),
      Skin_Darker: new THREE.MeshStandardMaterial({ color: new THREE.Color(SKINS[def.skin % SKINS.length]).multiplyScalar(0.82), roughness: 0.7 }),
      Hair: new THREE.MeshStandardMaterial({ color: HAIRS[def.hair % HAIRS.length], roughness: 0.9 }),
    };
    this.body.traverse((n) => {
      const m = n as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => this.mats[src.name] ?? src);
      m.material = Array.isArray(m.material) ? mats : mats[0]!;
    });
    this.mixer = new THREE.AnimationMixer(this.body);
    for (const clip of g.animations) {
      const a = this.mixer.clipAction(clip);
      if (['Kick_Left', 'Kick_Right', 'HitRecieve', 'Death', 'Interact', 'Roll'].includes(clip.name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(clip.name, a);
    }
    this.play('Idle', 0);
  }

  setKit(kit: Kit): void {
    this.mats.Shirt!.color.set(kit.shirt);
    this.mats.Shorts!.color.set(kit.shorts);
    this.mats.Socks!.color.set(kit.socks);
  }

  private play(name: string, fade = 0.18, speed = 1): THREE.AnimationAction | null {
    const a = this.actions.get(name);
    if (!a) return null;
    a.timeScale = speed;
    if (this.current === a) return a;
    a.reset();
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (this.current && fade > 0) a.crossFadeFrom(this.current, fade, false);
    else if (this.current) this.current.stop();
    a.play();
    this.current = a;
    return a;
  }

  update(f: FramePlayer, dt: number): void {
    this.root.visible = f.state !== 'off';
    this.root.position.set(f.x, 0, f.z);
    this.root.rotation.y = f.face + Math.PI / 2;
    const state = f.state;
    const entered = state !== this.lastState;
    this.lastState = state;
    let tilt = 0;
    let lift = 0;
    let roll = 0;
    switch (state) {
      case 'kick':
      case 'tackle':
        if (entered) {
          const kick = f.kick === 'throw' || f.kick === 'gkThrow' ? 'Interact' : f.leftFoot ? 'Kick_Left' : 'Kick_Right';
          this.play(kick, 0.08, f.kick === 'shot' || f.kick === 'penalty' || f.kick === 'clear' ? 1.25 : 1.45);
          this.loco = '';
        }
        break;
      case 'slide':
        // Feet first along the ground.
        tilt = -1.25;
        lift = 0.25;
        if (entered) this.play('Idle_Neutral', 0.1);
        this.loco = '';
        break;
      case 'rise':
        // Getting up from a slide: ease out of the slide pose.
        tilt = -1.25 * Math.max(0, Math.min(1, f.t / 0.4));
        lift = 0.25 * Math.max(0, Math.min(1, f.t / 0.4));
        if (entered) this.play('Idle_Neutral', 0.3);
        this.loco = '';
        break;
      case 'down':
        if (entered) this.play('Death', 0.15, 1.6);
        this.loco = '';
        break;
      case 'dive':
        roll = f.diveZ * 1.25;
        lift = 0.35 + f.diveY * 0.9;
        if (entered) this.play('Idle_Neutral', 0.08);
        this.loco = '';
        break;
      case 'celebrate':
        if (f.speed > 2) this.locomotion(f.speed, true);
        else if (entered || this.loco !== 'Wave') {
          this.play('Wave', 0.25);
          this.loco = 'Wave';
        }
        break;
      case 'hold':
        if (f.speed > 0.5) this.locomotion(f.speed, f.sprint);
        else if (this.loco !== 'Idle_Neutral') {
          this.play('Idle_Neutral', 0.2);
          this.loco = 'Idle_Neutral';
        }
        break;
      default:
        this.locomotion(f.speed, f.sprint);
    }
    // Ease into poses (slides, dives) rather than snapping.
    const k = Math.min(1, dt * 12);
    this.tilt += (tilt - this.tilt) * k;
    this.lift += (lift - this.lift) * k;
    this.roll += (roll - this.roll) * k;
    const tilter = this.body.parent!;
    tilter.rotation.x = this.tilt;
    tilter.rotation.z = -this.roll;
    tilter.position.y = this.lift;
    this.mixer.update(dt);
  }

  private locomotion(speed: number, sprint: boolean): void {
    let name = 'Idle';
    let ts = 1;
    if (speed > 3.2) {
      name = 'Run';
      ts = Math.max(0.75, Math.min(1.6, speed / 6.2)) * (sprint ? 1.08 : 1);
    } else if (speed > 0.5) {
      name = 'Walk';
      ts = Math.max(0.6, speed / 1.6);
    }
    if (name !== this.loco) {
      this.play(name, 0.2, ts);
      this.loco = name;
    } else if (this.current) this.current.timeScale = ts;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
