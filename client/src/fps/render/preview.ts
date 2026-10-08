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
 *
 * Everything renders through ONE offscreen "studio" renderer (one GL context, one
 * PMREM environment, shaders compiled once): a preview renders into the corner of
 * its canvas and is copied into the 2D canvas / image that shows it.
 */

const NO_ATT: Attachments = { optic: 'iron', muzzle: 'none', under: 'none', ammo: 'standard' };
const STUDIO_W = 1536;
const STUDIO_H = 768;

let studioR: THREE.WebGLRenderer | null = null;
let studioEnv: THREE.Texture | null = null;

function studioRenderer(): THREE.WebGLRenderer {
  if (!studioR) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.setPixelRatio(1);
    r.setSize(STUDIO_W, STUDIO_H, false);
    const pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    studioEnv = pmrem.fromScene(room, 0.04, 0.1, 100, { size: 128 }).texture;
    room.dispose();
    pmrem.dispose();
    studioR = r;
  }
  return studioR;
}

/** The studio renderer with `scene` lit by its environment (set before compiling, or the render needs another shader variant). */
function studioFor(scene: THREE.Scene): THREE.WebGLRenderer {
  const r = studioRenderer();
  scene.environment = studioEnv;
  return r;
}

/** Render `scene` into the bottom-left w×h corner of the studio canvas. */
function renderRegion(scene: THREE.Scene, cam: THREE.Camera, w: number, h: number, clear = 0x000000, alpha = 0): void {
  const r = studioFor(scene);
  r.setScissorTest(true);
  r.setViewport(0, 0, w, h);
  r.setScissor(0, 0, w, h);
  r.setClearColor(clear, alpha);
  r.render(scene, cam);
  r.setScissorTest(false);
}

/** Copy the last rendered w×h corner into a 2D canvas. */
function blit(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(studioRenderer().domElement, 0, STUDIO_H - h, w, h, 0, 0, w, h);
}

function studio(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.environmentIntensity = 0.75;
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

const thumbScene = studio();
const thumbCam = new THREE.PerspectiveCamera(22, 2, 0.01, 50);

/**
 * Thumbnails are cached in memory and in localStorage (WebP data URLs), keyed by
 * weapon | camo | attachments. Bump the version whenever the look changes.
 */
const VERSION = 2;
const LS = `zh:thumb:v${VERSION}:`;
const LS_INDEX = `zh:thumbs:v${VERSION}`;
const MAX_STORED = 160;
const cache = new Map<string, string>();
let index: string[] = [];
try {
  index = JSON.parse(localStorage.getItem(LS_INDEX) ?? '[]') as string[];
  // Drop thumbnails from older versions.
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('zh:thumb:') || k.startsWith('zh:thumbs:')) && !k.startsWith(LS) && k !== LS_INDEX) localStorage.removeItem(k);
  }
} catch {
  index = [];
}

function store(key: string, url: string): void {
  cache.set(key, url);
  try {
    localStorage.setItem(LS + key, url);
    index = index.filter((k) => k !== key);
    index.push(key);
    // The origin's storage is shared with the other games: keep ours bounded.
    while (index.length > MAX_STORED) localStorage.removeItem(LS + index.shift()!);
    localStorage.setItem(LS_INDEX, JSON.stringify(index));
  } catch {
    /* quota: memory cache only */
  }
}

/** What a thumbnail shows: a gun (camo, attachments) or an attachment / equipment item. */
export type ThumbSpec = { gun: string; camo: string; att?: Attachments } | { item: ItemThumb };

export function thumbKey(t: ThumbSpec): string {
  if ('item' in t) return `i:${t.item}`;
  const a = t.att ?? NO_ATT;
  return `g:${t.gun}:${t.camo}:${a.optic}${a.muzzle}${a.under}`;
}

/** A cached thumbnail, or '' if it still has to be rendered. */
export function cachedThumb(t: ThumbSpec): string {
  const key = thumbKey(t);
  let url = cache.get(key);
  if (url === undefined) {
    try {
      url = localStorage.getItem(LS + key) ?? '';
    } catch {
      url = '';
    }
    if (url) cache.set(key, url);
  }
  return url;
}

/** Waits for a quiet moment before a thumbnail's render + readback (the menu sets this to its idle check). */
let gate: () => Promise<void> = () => Promise.resolve();
export function setThumbGate(fn: () => Promise<void>): void {
  gate = fn;
}

/** Thumbnails render one at a time (they share the studio scene). */
let queue: Promise<unknown> = Promise.resolve();

/** Render (or fetch) a thumbnail. Shaders compile asynchronously first, so a new gun / camo doesn't stall the menu. '' until the models are loaded. */
export function renderThumb(t: ThumbSpec): Promise<string> {
  const hit = cachedThumb(t);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    const key = thumbKey(t);
    const again = cache.get(key);
    if (again) return again;
    if ('item' in t) {
      const o = itemModel(t.item);
      return o ? shoot(key, o.obj, 160, 100, o.opts) : '';
    }
    const def = WEAPON[t.gun];
    if (!def || !loaded(def.model)) return '';
    return shoot(key, assembleGun(def, t.att ?? NO_ATT, t.camo).gun, 320, 150, { yaw: 0.12, pitch: 0.1, pad: 1.04 });
  });
  queue = job.catch(() => '');
  return job;
}

async function shoot(key: string, obj: THREE.Object3D, w: number, h: number, opts: { yaw?: number; pitch?: number; pad?: number } = {}): Promise<string> {
  const r = studioFor(thumbScene);
  const pivot = new THREE.Group();
  pivot.add(obj);
  thumbScene.add(pivot);
  frame(thumbCam, obj, w / h, opts.pad, opts.yaw, opts.pitch);
  await r.compileAsync(thumbScene, thumbCam);
  await gate();
  renderRegion(thumbScene, thumbCam, w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  blit(c.getContext('2d')!, w, h);
  thumbScene.remove(pivot);
  // Encode off the main thread (toDataURL's WebP encode is synchronous and slow).
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/webp', 0.85));
  const url = blob
    ? await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => res('');
        fr.readAsDataURL(blob);
      })
    : '';
  // Free what this shot built (model geometry is shared; camo materials are per-gun clones).
  obj.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.geometry.userData.cached) m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat.userData.orig) mat.dispose();
  });
  if (url) store(key, url);
  return url;
}

export type ItemThumb = Attachments['optic'] | 'suppressor' | 'grip' | 'laser' | 'extended' | 'standard' | 'none' | 'grenade' | 'knife';

/** An attachment / equipment model framed for its thumbnail. */
function itemModel(kind: ItemThumb): { obj: THREE.Object3D; opts: { yaw: number; pitch: number; pad: number } } | null {
  if (!loaded('acc-grip')) return null;
  let o: THREE.Object3D;
  const s = 0.17;
  // The rear sight of a rifle: show the receiver of the M13 close up.
  if (kind === 'iron') return { obj: assembleGun(WEAPON.m13!, NO_ATT, 'none').gun, opts: { yaw: 0.35, pitch: 0.35, pad: 0.55 } };
  if (kind === 'reddot' || kind === 'holo' || kind === 'acog') o = makeOptic(kind);
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
  return { obj: wrap, opts: { yaw: 0.45, pitch: 0.3, pad: 1.25 } };
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

/**
 * A map overview shot (built with the real map renderer). Too heavy for the menu
 * (full map + 4096² shadows): only used to bake client/public/assets/fps/thumbs/<id>.jpg
 * through the `__zh.bakeMapThumbs()` dev hook.
 */
export function mapThumb(id: string): string {
  const def = MAP[id];
  if (!def || def.props.some((p) => !loaded(p.model))) return '';
  const r = studioRenderer();
  const w = 480;
  const h = 270;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const view = buildMap(scene, r, def);
  scene.fog = null;
  const [hx, hz] = def.half;
  const cam = new THREE.PerspectiveCamera(50, w / h, 0.5, 1500);
  const m = Math.max(hx, hz);
  cam.position.set(hx * 0.75, m * 0.95, hz * 1.15);
  cam.lookAt(0, 0, -hz * 0.08);
  renderRegion(scene, cam, w, h, 0x000000, 1);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  blit(c.getContext('2d')!, w, h);
  const url = c.toDataURL('image/jpeg', 0.85);
  view.dispose();
  r.shadowMap.enabled = false;
  r.toneMappingExposure = 1.05;
  return url;
}

// ---------------------------------------------------------------- live turntable

/** A rotating 3D weapon in a canvas (drag to turn it), drawn by the shared studio renderer. */
export class GunStage {
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly scene = studio();
  private readonly cam = new THREE.PerspectiveCamera(24, 2, 0.01, 50);
  private readonly pivot = new THREE.Group();
  private key = '';
  private yaw = 0;
  private spin = 0.35;
  private dragging = false;
  private lastX = 0;
  private raf = 0;
  private last = 0;
  private fitLen = 0.8;

  constructor() {
    this.canvas.className = 'zh-stage__gl';
    this.scene.add(this.pivot);
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
    this.start();
  }

  /** Show a weapon (no-op if it's already shown). */
  show(id: string, camo: string, att: Attachments = NO_ATT): void {
    const def = WEAPON[id];
    if (!def || !loaded(def.model)) return;
    const key = `${id}:${camo}:${att.optic}${att.muzzle}${att.under}`;
    if (key === this.key) return;
    this.key = key;
    const { gun } = assembleGun(def, att, camo);
    const box = new THREE.Box3().setFromObject(gun);
    gun.position.sub(box.getCenter(new THREE.Vector3()));
    const sz = box.getSize(new THREE.Vector3());
    // Compile the new gun's shaders off the main thread, then swap it in (the old one stays up meanwhile).
    const holder = new THREE.Group();
    holder.add(gun);
    holder.visible = false;
    this.scene.add(holder);
    void studioFor(this.scene)
      .compileAsync(this.scene, this.cam)
      .then(() => {
        holder.removeFromParent();
        if (key !== this.key) return;
        this.pivot.clear();
        this.pivot.add(gun);
        this.fitLen = Math.max(sz.z, sz.y * 2.2);
      });
  }

  /** Create the studio (GL context + lighting) ahead of time (idle), so opening the screen doesn't pay for it. */
  warm(): void {
    studioRenderer();
  }

  private start(): void {
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      if (!this.canvas.isConnected || !this.canvas.offsetParent || !this.pivot.children.length) return;
      const dt = Math.min(0.05, (t - (this.last || t)) / 1000);
      this.last = t;
      if (!this.dragging) this.yaw += this.spin * dt;
      camoTime.value += dt;
      // Turn around the vertical axis; the side profile faces the camera at yaw 0.
      this.pivot.rotation.set(0, -Math.PI / 2 + Math.sin(this.yaw) * 0.55, 0);
      const k = Math.min(2, devicePixelRatio, STUDIO_W / (this.canvas.clientWidth || 600), STUDIO_H / (this.canvas.clientHeight || 260));
      const w = Math.round((this.canvas.clientWidth || 600) * k);
      const h = Math.round((this.canvas.clientHeight || 260) * k);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.cam.aspect = w / h;
      const fov = (this.cam.fov * Math.PI) / 180;
      const d = Math.max((this.fitLen * 0.62) / this.cam.aspect, this.fitLen * 0.3) / Math.tan(fov / 2) + this.fitLen * 0.3;
      this.cam.position.set(0, d * 0.16, d);
      this.cam.lookAt(0, 0, 0);
      this.cam.updateProjectionMatrix();
      renderRegion(this.scene, this.cam, w, h);
      blit(this.ctx, w, h);
    };
    this.raf = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }
}
