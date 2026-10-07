import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { WEAPON, type Attachments } from '../sim/weapons';
import { MAP } from '../sim/maps';
import { cloneModel, loaded } from './assets';
import { assembleGun, makeLaser, makeOptic } from './gunmodel';
import { buildMap } from './world3d';
import { camoTime } from './camo';

/**
 * Menu previews: a live 3D turntable for the selected gun (camo + attachments)
 * and cached thumbnails for guns, camos, attachments, equipment and maps.
 */

const NO_ATT: Attachments = { optic: 'iron', muzzle: 'none', under: 'none', ammo: 'standard' };

function studio(renderer: THREE.WebGLRenderer): THREE.Scene {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#dfe8ff', '#3a342c', 0.25));
  const key = new THREE.DirectionalLight('#fff4e4', 1.3);
  key.position.set(2, 3, 2);
  const rim = new THREE.DirectionalLight('#9cc4ff', 1.0);
  rim.position.set(-2, 1, -3);
  scene.add(key, rim);
  return scene;
}

/** Frame `obj` (muzzle along −z) from its right side, so the muzzle points right; `yaw` turns a little towards the stock. */
function frame(cam: THREE.PerspectiveCamera, obj: THREE.Object3D, aspect: number, pad = 1.12, yaw = 0.2, pitch = 0.15): void {
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.sub(box.getCenter(new THREE.Vector3()));
  const sz = box.getSize(new THREE.Vector3());
  const fov = (cam.fov * Math.PI) / 180;
  const d = (Math.max(sz.y, sz.z / aspect) * pad) / 2 / Math.tan(fov / 2) + sz.x / 2;
  cam.aspect = aspect;
  cam.position.set(Math.cos(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, Math.sin(yaw) * Math.cos(pitch) * d);
  cam.lookAt(0, 0, 0);
  cam.near = d / 50;
  cam.far = d * 10;
  cam.updateProjectionMatrix();
}

// ---------------------------------------------------------------- thumbnails

let thumbR: THREE.WebGLRenderer | null = null;
let thumbScene: THREE.Scene | null = null;
const thumbCam = new THREE.PerspectiveCamera(22, 2, 0.01, 50);
const cache = new Map<string, string>();

function thumbRenderer(): THREE.WebGLRenderer {
  if (!thumbR) {
    thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbR.outputColorSpace = THREE.SRGBColorSpace;
    thumbR.toneMapping = THREE.ACESFilmicToneMapping;
    thumbR.toneMappingExposure = 1.05;
    thumbR.setPixelRatio(1);
    thumbScene = studio(thumbR);
  }
  return thumbR;
}

function shoot(key: string, obj: THREE.Object3D, w: number, h: number, opts: { yaw?: number; pitch?: number; pad?: number } = {}): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const r = thumbRenderer();
  r.setSize(w, h, false);
  const pivot = new THREE.Group();
  pivot.add(obj);
  thumbScene!.add(pivot);
  frame(thumbCam, obj, w / h, opts.pad, opts.yaw, opts.pitch);
  r.setClearColor(0x000000, 0);
  r.render(thumbScene!, thumbCam);
  const url = r.domElement.toDataURL('image/png');
  thumbScene!.remove(pivot);
  cache.set(key, url);
  return url;
}

/** A weapon thumbnail (side view). Empty string until the models are loaded. */
export function gunThumb(id: string, camo = 'none', att: Attachments = NO_ATT): string {
  const def = WEAPON[id];
  if (!def || !loaded(def.model)) return '';
  const key = `g:${id}:${camo}:${att.optic}${att.muzzle}${att.under}`;
  return cache.get(key) ?? shoot(key, assembleGun(def, att, camo).gun, 320, 150, { yaw: 0.12, pitch: 0.1, pad: 1.04 });
}

export type ItemThumb = Attachments['optic'] | 'suppressor' | 'grip' | 'laser' | 'extended' | 'standard' | 'none' | 'grenade' | 'knife';

/** An attachment / equipment thumbnail. */
export function itemThumb(kind: ItemThumb): string {
  if (!loaded('acc-grip')) return '';
  const key = `i:${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let o: THREE.Object3D;
  const s = 0.17;
  if (kind === 'iron') {
    // The rear sight of a rifle: show the receiver of the M13 close up.
    const g = assembleGun(WEAPON.m13!, NO_ATT, 'none');
    o = g.gun;
    return shoot(key, o, 160, 100, { yaw: 0.35, pitch: 0.35, pad: 0.55 });
  } else if (kind === 'reddot' || kind === 'holo' || kind === 'acog') o = makeOptic(kind);
  else if (kind === 'suppressor') {
    o = cloneModel('acc-silencer-1');
    o.scale.setScalar(s);
    o.rotation.y = Math.PI / 2;
  } else if (kind === 'grip') {
    o = cloneModel('acc-grip');
    o.scale.setScalar(s);
    o.rotation.y = Math.PI / 2;
  } else if (kind === 'laser') o = makeLaser();
  else if (kind === 'grenade') o = cloneModel('item-grenade');
  else if (kind === 'knife') {
    o = cloneModel('item-knife-1');
    o.rotation.x = -Math.PI / 2;
  } else if (kind === 'extended' || kind === 'standard') o = magazine(kind === 'extended');
  else o = new THREE.Group();
  const wrap = new THREE.Group();
  wrap.add(o);
  return shoot(key, wrap, 160, 100, { yaw: 0.45, pitch: 0.3, pad: 1.25 });
}

function magazine(extended: boolean): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#5a5f66', roughness: 0.45, metalness: 0.4 });
  const n = extended ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.06), mat);
    m.position.set(0, -i * 0.1, i * 0.022);
    m.rotation.x = 0.22;
    g.add(m);
  }
  return g;
}

/** A map overview shot (built with the real map renderer). */
export function mapThumb(id: string): string {
  const key = `m:${id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const def = MAP[id];
  if (!def || def.props.some((p) => !loaded(p.model))) return '';
  const r = thumbRenderer();
  const w = 480;
  const h = 270;
  r.setSize(w, h, false);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const view = buildMap(scene, r, def);
  scene.fog = null;
  const [hx, hz] = def.half;
  const cam = new THREE.PerspectiveCamera(50, w / h, 0.5, 1500);
  const m = Math.max(hx, hz);
  cam.position.set(hx * 0.75, m * 0.95, hz * 1.15);
  cam.lookAt(0, 0, -hz * 0.08);
  r.setClearColor(0x000000, 1);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/jpeg', 0.85);
  view.sun.shadow.map?.dispose();
  r.shadowMap.enabled = false;
  r.toneMappingExposure = 1.05;
  cache.set(key, url);
  return url;
}

// ---------------------------------------------------------------- live turntable

/** A rotating 3D weapon in a canvas (drag to turn it). */
export class GunStage {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private readonly cam = new THREE.PerspectiveCamera(24, 2, 0.01, 50);
  private readonly pivot = new THREE.Group();
  private key = '';
  private yaw = 0;
  private spin = 0.35;
  private dragging = false;
  private lastX = 0;
  private raf = 0;
  private last = 0;

  constructor() {
    this.canvas.className = 'zh-stage__gl';
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.012;
      this.lastX = e.clientX;
    });
    const up = () => (this.dragging = false);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  /** Show a weapon (no-op if it's already shown). */
  show(id: string, camo: string, att: Attachments = NO_ATT): void {
    const def = WEAPON[id];
    if (!def || !loaded(def.model)) return;
    const key = `${id}:${camo}:${att.optic}${att.muzzle}${att.under}`;
    if (key === this.key) return;
    this.key = key;
    this.ensure();
    this.pivot.clear();
    const { gun } = assembleGun(def, att, camo);
    const box = new THREE.Box3().setFromObject(gun);
    gun.position.sub(box.getCenter(new THREE.Vector3()));
    this.pivot.add(gun);
    const sz = box.getSize(new THREE.Vector3());
    this.fitLen = Math.max(sz.z, sz.y * 2.2);
    this.resize();
  }

  private fitLen = 0.8;

  private ensure(): void {
    if (this.renderer) return;
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer = r;
    this.scene = studio(r);
    this.scene.add(this.pivot);
    this.start();
  }

  private resize(): void {
    const r = this.renderer;
    if (!r) return;
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 260;
    r.setSize(w, h, false);
    this.cam.aspect = w / h;
    const fov = (this.cam.fov * Math.PI) / 180;
    const d = Math.max(this.fitLen * 0.62 / this.cam.aspect, this.fitLen * 0.3) / Math.tan(fov / 2) + this.fitLen * 0.3;
    this.cam.position.set(0, d * 0.16, d);
    this.cam.lookAt(0, 0, 0);
    this.cam.updateProjectionMatrix();
  }

  private start(): void {
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      if (!this.canvas.isConnected || !this.canvas.offsetParent) return;
      const dt = Math.min(0.05, (t - (this.last || t)) / 1000);
      this.last = t;
      if (!this.dragging) this.yaw += this.spin * dt;
      camoTime.value += dt;
      // Turn around the vertical axis; the side profile faces the camera at yaw 0.
      this.pivot.rotation.set(0, -Math.PI / 2 + Math.sin(this.yaw) * 0.55, 0);
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (w && h && (Math.abs(w / h - this.cam.aspect) > 0.01 || this.renderer!.domElement.width !== Math.round(w * this.renderer!.getPixelRatio()))) this.resize();
      this.renderer!.render(this.scene!, this.cam);
    };
    this.raf = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
    this.renderer = null;
  }
}
