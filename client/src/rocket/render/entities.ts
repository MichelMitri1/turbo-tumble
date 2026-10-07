import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Car } from '../sim/car';
import { BALL_RADIUS, BOOST_PADS, CARS, STEER_ANGLE_CURVE, POWERSLIDE_STEER_CURVE, carBody, carInfo, curve, type CarBody, type CarId } from '../sim/constants';
import { S, toThree } from './arenaMesh';
import { TEAM_COLORS } from './colors';

/** Sim quaternion (z-up) → three.js (y-up): conjugate by the axis change. */
const AXIS = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const AXIS_INV = AXIS.clone().invert();
export const toThreeQuat = (q: THREE.Quaternion, out = new THREE.Quaternion()): THREE.Quaternion => out.copy(AXIS).multiply(q).multiply(AXIS_INV);

// ---------------------------------------------------------------- car models

interface Template {
  body: THREE.Object3D;
  wheel: THREE.Mesh;
  bodyBox: THREE.Box3;
}
/** Loaded models by file name. */
const templates = new Map<string, Template>();
let palette: THREE.Texture | null = null;

/** Team paint cells in Kenney's 8×8 colormap (column, rows 2–3). */
const PAINT_COL = [7, 5] as const;
const PAINT = [
  ['#3d86ff', '#1f55e0'],
  ['#ff9a2e', '#f06a10'],
];

function teamPalette(src: THREE.Texture): THREE.Texture {
  const img = src.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const cell = img.width / 8;
  PAINT_COL.forEach((col, team) => {
    for (let r = 0; r < 2; r++) {
      g.fillStyle = PAINT[team]![r]!;
      g.fillRect(col * cell, (2 + r) * cell, cell, cell);
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export async function loadCars(): Promise<void> {
  const loader = new GLTFLoader();
  const models = [...new Set(Object.values(CARS).map((c) => c.model))];
  await Promise.all(
    models.map(async (model) => {
      const gltf = await loader.loadAsync(`/assets/rocket/${model}.glb`);
      let body: THREE.Object3D | null = null;
      let wheel: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => {
        if (o.name === 'body') body = o;
        if (o.name === 'wheel-front-left' && (o as THREE.Mesh).isMesh) wheel = o as THREE.Mesh;
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.map && !palette) palette = teamPalette(m.map);
      });
      if (!body || !wheel) throw new Error(`model ${model}: missing body/wheel`);
      const bodyObj = body as THREE.Object3D;
      bodyObj.position.set(0, 0, 0);
      bodyObj.updateMatrixWorld(true);
      templates.set(model, { body: bodyObj, wheel, bodyBox: new THREE.Box3().setFromObject(bodyObj) });
    }),
  );
}

/** Clone a model part with the team paint (UVs of paint cells moved to the team column). */
function paintClone(src: THREE.Object3D, team: 0 | 1, glossy = false): THREE.Object3D {
  const o = src.clone(true);
  o.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      const col = Math.floor(u * 8);
      const row = Math.floor(v * 8);
      if ((row === 2 || row === 3) && col >= 3 && col <= 7) uv.setX(i, u + (PAINT_COL[team] - col) / 8);
    }
    mesh.geometry = g;
    const src = mesh.material as THREE.MeshStandardMaterial;
    // Body: satin car paint with a light clear coat (no mirror shine). Wheels: rubber.
    mesh.material = glossy
      ? new THREE.MeshPhysicalMaterial({ map: palette ?? src.map, roughness: 0.52, metalness: 0.08, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.65 })
      : new THREE.MeshStandardMaterial({ map: palette ?? src.map, roughness: 0.62, metalness: 0.15, envMapIntensity: 0.9 });
    mesh.castShadow = true;
  });
  return o;
}

const flameGeo = new THREE.ConeGeometry(1, 1, 14, 1, true).rotateZ(Math.PI / 2).translate(-0.5, 0, 0);

export class CarView {
  readonly root = new THREE.Group();
  private readonly wheels: Array<{ pivot: THREE.Group; steer: THREE.Group; spin: THREE.Group; front: boolean }> = [];
  private readonly flame: THREE.Group;
  private readonly flameOuter: THREE.Mesh;
  private readonly flameInner: THREE.Mesh;
  private spin = 0;
  readonly body: CarBody;
  /** Visual error offset after a network correction (decays). */
  readonly errPos = new THREE.Vector3();
  readonly errQuat = new THREE.Quaternion();
  /** Local exhaust position (three units, car frame). */
  readonly exhaust = new THREE.Vector3();
  readonly wheelWorld = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  constructor(
    readonly carId: number,
    readonly team: 0 | 1,
    carModel: CarId,
  ) {
    this.body = carBody(carModel);
    const t = templates.get(carInfo(carModel).model)!;
    const b = this.body;
    // Body: forward (+z model) → +x car; scaled to the hitbox length, a bit wider than the stock model.
    const size = t.bodyBox.getSize(new THREE.Vector3());
    const s = (b.hitbox[0] * S) / size.z;
    const model = new THREE.Group();
    const body = paintClone(t.body, this.team, true);
    const center = t.bodyBox.getCenter(new THREE.Vector3());
    body.position.set(-center.x, -t.bodyBox.min.y, -center.z);
    model.add(body);
    model.scale.set(s * 1.32, s, s);
    model.rotation.y = Math.PI / 2;
    // Hitbox bottom in local space (sim z) → model base.
    const hbBottom = b.offset[2] - b.hitbox[2] / 2;
    model.position.set(b.offset[0] * S, (hbBottom - 1) * S, 0);
    this.root.add(model);
    // Wheels at the simulated hardpoints.
    t.wheel.geometry.computeBoundingBox();
    const wbox = t.wheel.geometry.boundingBox!;
    const wsize = wbox.getSize(new THREE.Vector3());
    const wc = wbox.getCenter(new THREE.Vector3());
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const left = i % 2 === 0;
      const w = front ? b.front : b.back;
      const pivot = new THREE.Group();
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      const mesh = paintClone(t.wheel, this.team);
      // Model wheel axle is model x; we want it along the car's left axis (three −z).
      const ws = (2 * w.radius * S) / wsize.y;
      mesh.position.set(-wc.x, -wc.y, -wc.z);
      const holder = new THREE.Group();
      holder.add(mesh);
      holder.scale.setScalar(ws);
      holder.rotation.y = Math.PI / 2;
      spin.add(holder);
      steer.add(spin);
      pivot.add(steer);
      pivot.position.set(w.offset[0] * S, 0, -(left ? 1 : -1) * w.offset[1] * S);
      this.root.add(pivot);
      this.wheels.push({ pivot, steer, spin, front });
    }
    // Boost flame.
    this.flame = new THREE.Group();
    const col = new THREE.Color(TEAM_COLORS[this.team].glow);
    this.flameOuter = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.45, 0.1).lerp(col, 0.25).multiplyScalar(3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.flameInner = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.7).multiplyScalar(4), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.flameInner.scale.set(0.6, 0.55, 0.55);
    this.flame.add(this.flameOuter, this.flameInner);
    const rear = b.offset[0] - b.hitbox[0] / 2;
    this.exhaust.set(rear * S, (b.offset[2] - 2) * S, 0);
    this.flame.position.copy(this.exhaust);
    this.flame.scale.set(0.7, 0.13, 0.13);
    this.flame.visible = false;
    this.root.add(this.flame);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.flameOuter.castShadow = this.flameInner.castShadow = false;
  }

  /** Pose from the car state (alpha-blended previous → current is done by the caller). */
  update(car: Car, pos: THREE.Vector3, quat: THREE.Quaternion, dt: number): void {
    this.root.visible = !car.demolished;
    if (car.demolished) return;
    toThree(pos.x, pos.y, pos.z, this.root.position).add(this.errPos);
    toThreeQuat(quat, this.root.quaternion).premultiply(this.errQuat);
    const fwd = car.forwardSpeed;
    const absF = Math.abs(fwd);
    let steerAngle = curve(STEER_ANGLE_CURVE, absF);
    if (car.handbrakeVal) steerAngle += (curve(POWERSLIDE_STEER_CURVE, absF) - steerAngle) * car.handbrakeVal;
    this.spin += ((fwd / this.body.front.radius) * dt) % (Math.PI * 2);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      const sw = car.wheels[i]!;
      const rest = sw.maxLen - sw.radius;
      const d = car.wheelContact[i] ? Math.max(sw.radius, car.wheelDist[i]!) - sw.radius : rest;
      w.pivot.position.y = (sw.local.z - Math.min(d, rest)) * S;
      if (w.front) w.steer.rotation.y = -car.controls.steer * steerAngle * 1.4;
      w.spin.rotation.z = -this.spin;
      w.pivot.getWorldPosition(this.wheelWorld[i]!);
    }
    this.flame.visible = car.isBoosting;
    if (car.isBoosting) {
      const f = 0.85 + Math.random() * 0.3;
      this.flame.scale.set(0.75 * f, 0.13 * (0.9 + Math.random() * 0.2), 0.13 * (0.9 + Math.random() * 0.2));
    }
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

// ---------------------------------------------------------------- ball

/** Fibonacci points for the ball's hexagon panels. */
function ballPanels(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push(new THREE.Vector3(Math.cos(g * i) * r, y, Math.sin(g * i) * r));
  }
  return out;
}

export class BallView {
  readonly mesh: THREE.Mesh;
  readonly quat = new THREE.Quaternion();
  readonly errPos = new THREE.Vector3();
  private readonly uniforms = { panels: { value: ballPanels(72) }, glow: { value: new THREE.Color(0, 0, 0) } };
  private glowT = 0;

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8dbe4, roughness: 0.32, metalness: 0.55, envMapIntensity: 1.2 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjN = normalize(position);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObjN;\nuniform vec3 panels[72];\nuniform vec3 glow;\nfloat ballEdge;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float d1 = 10.0, d2 = 10.0;
          for (int i = 0; i < 72; i++) { float d = distance(vObjN, panels[i]); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
          ballEdge = 1.0 - smoothstep(0.012, 0.03, d2 - d1);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.17, 0.21), ballEdge);`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += glow * (0.25 + ballEdge * 2.5);');
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS * S, 48, 32), mat);
    this.mesh.castShadow = true;
  }

  /** Ball-size mutator. */
  setScale(s: number): void {
    this.mesh.scale.setScalar(s);
  }

  /** Flash the seams in a team colour after a hit. */
  flash(team: 0 | 1, power: number): void {
    this.uniforms.glow.value.set(TEAM_COLORS[team].glow).multiplyScalar(Math.min(1, power / 2500) * 1.2);
    this.glowT = 1;
  }

  update(pos: THREE.Vector3, angVel: THREE.Vector3, dt: number): void {
    toThree(pos.x, pos.y, pos.z, this.mesh.position).add(this.errPos);
    const w = toThree(angVel.x / S, angVel.y / S, angVel.z / S, tmpV);
    const a = w.length() * dt;
    if (a > 1e-6) this.quat.premultiply(tmpQ.setFromAxisAngle(w.normalize(), a));
    this.mesh.quaternion.copy(this.quat);
    if (this.glowT > 0) {
      this.glowT = Math.max(0, this.glowT - dt * 2.2);
      this.uniforms.glow.value.multiplyScalar(this.glowT > 0 ? 0.95 : 0);
    }
  }
}
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

// ---------------------------------------------------------------- boost pads

export class PadsView {
  readonly group = new THREE.Group();
  private readonly orbs: THREE.Object3D[] = [];
  private readonly rings: THREE.MeshBasicMaterial[] = [];
  private readonly pads: THREE.Group[] = [];
  private scale = 1;
  private t = 0;

  constructor() {
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2d38, metalness: 0.7, roughness: 0.35 });
    const orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.62, 0.15).multiplyScalar(3.2), toneMapped: false });
    const orbCore = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.7).multiplyScalar(4), toneMapped: false });
    for (const p of BOOST_PADS) {
      const g = new THREE.Group();
      toThree(p.x, p.y, 0, g.position);
      const r = p.big ? 104 : 46;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(r * S, (r + 10) * S, 6 * S, 28), baseMat);
      base.position.y = 3 * S;
      base.receiveShadow = true;
      g.add(base);
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.55, 0.1).multiplyScalar(2.5), toneMapped: false });
      this.rings.push(ringMat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry((r - 8) * S, (p.big ? 6 : 4) * S, 6, 32), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 7 * S;
      g.add(ring);
      const orb = new THREE.Group();
      if (p.big) {
        orb.add(new THREE.Mesh(new THREE.SphereGeometry(40 * S, 24, 16), orbMat));
        const core = new THREE.Mesh(new THREE.SphereGeometry(22 * S, 16, 12), orbCore);
        orb.add(core);
        orb.position.y = 72 * S;
      } else {
        orb.add(new THREE.Mesh(new THREE.CylinderGeometry(21 * S, 21 * S, 10 * S, 20), orbMat));
        orb.position.y = 18 * S;
      }
      g.add(orb);
      this.orbs.push(orb);
      this.pads.push(g);
      this.group.add(g);
    }
  }

  /** Boost-pad size mutator. */
  setScale(s: number): void {
    if (s === this.scale) return;
    this.scale = s;
    for (const g of this.pads) g.scale.setScalar(s);
  }

  update(timers: ArrayLike<number>, dt: number): void {
    this.t += dt;
    for (let i = 0; i < this.orbs.length; i++) {
      const active = timers[i]! <= 0;
      const o = this.orbs[i]!;
      o.visible = active;
      if (active) {
        o.rotation.y = this.t * 1.5;
        if (BOOST_PADS[i]!.big) o.position.y = (72 + Math.sin(this.t * 2 + i) * 6) * S;
      }
      this.rings[i]!.color.setRGB(1, 0.55, 0.1).multiplyScalar(active ? 2.5 : 0.35);
    }
  }
}

// ---------------------------------------------------------------- garage thumbnails

/** Render a 3/4 studio shot of every car (data URLs), for the garage. */
export function renderCarThumbs(team: 0 | 1, env: THREE.Texture | null): Map<CarId, string> {
  const out = new Map<CarId, string>();
  const W = 360;
  const H = 200;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(W, H);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.7;
  scene.add(new THREE.HemisphereLight(0xc8d6ff, 0x30304a, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb0ff, 1.2);
  rim.position.set(-3, 2, -3);
  scene.add(rim);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 50);
  cam.position.set(2.1, 1.05, 2.5);
  cam.lookAt(0.05, 0.22, 0);
  for (const id of Object.keys(CARS) as CarId[]) {
    const v = new CarView(0, team, id);
    scene.add(v.root);
    r.render(scene, cam);
    out.set(id, r.domElement.toDataURL('image/png'));
    v.dispose();
  }
  r.dispose();
  r.forceContextLoss();
  return out;
}
