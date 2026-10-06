import * as THREE from 'three';
import { RARITY_COLORS, getCard } from './cards';
import { buildCardModel, procSpellIcon } from './models';
import { findClip, instantiate } from './assets';
import type { CardDefinition } from './types';

/**
 * Card art: each card's real 3D model rendered onto a rarity-coloured background.
 * Production loads baked WebPs (tools/arena-portraits.mjs); anything missing is
 * rendered on the fly and cached.
 */

const W = 220;
const H = 264;
const BAKED = `${import.meta.env.BASE_URL}assets/arena/portraits/`;
const cache = new Map<string, Promise<string>>();
let renderer: THREE.WebGLRenderer | null = null;
let bakedList: Promise<Set<string>> | null = null;

function baked(): Promise<Set<string>> {
  bakedList ??= fetch(`${BAKED}index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<string[]>) : []))
    .then((l) => new Set(l))
    .catch(() => new Set<string>());
  return bakedList;
}

export function portrait(id: string, live = false): Promise<string> {
  const key = live ? `live:${id}` : id;
  let p = cache.get(key);
  if (!p) {
    p = (live ? Promise.resolve(new Set<string>()) : baked()).then((set) => (set.has(id) ? `${BAKED}${id}.webp` : render(getCard(id))));
    cache.set(key, p);
  }
  return p;
}

/** Fill every <img data-portrait="id"> under `root`. */
export function hydratePortraits(root: ParentNode): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-portrait]')) {
    const id = img.dataset.portrait!;
    if (img.dataset.loaded === id) continue;
    img.dataset.loaded = id;
    void portrait(id).then((url) => {
      if (img.dataset.portrait === id) img.src = url;
    });
  }
}

let queue: Promise<unknown> = Promise.resolve();

async function render(card: CardDefinition): Promise<string> {
  // One at a time: the shared renderer is not re-entrant.
  const job = queue.then(() => renderNow(card));
  queue = job.catch(() => undefined);
  return job;
}

async function renderNow(card: CardDefinition): Promise<string> {
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W * 2, H * 2, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#6a5a8a', 2.2));
  const key = new THREE.DirectionalLight('#fff4dc', 2.6);
  key.position.set(-3, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9fdcff', 1.6);
  rim.position.set(4, 3, -4);
  scene.add(rim);

  let obj: THREE.Object3D;
  const mixers: THREE.AnimationMixer[] = [];
  if (card.visual.model.startsWith('proc:') && card.type === 'spell') {
    obj = procSpellIcon(card.visual.model.slice(5), 1.4);
  } else if (card.type === 'spell') {
    const inst = await instantiate(card.visual.model, 1.3, card.visual.tint);
    obj = inst.root;
  } else {
    const m = await buildCardModel(card, 'blue');
    obj = m.root;
    mixers.push(...m.mixers);
    // A punchy frame of the idle/attack pose.
    const clip = findClip(m.clips.length ? m.clips : m.mountClips, /^Idle_Weapon$/, /^Flying_Idle$/, /^Idle$/i, /idle/i);
    if (clip && mixers[0]) mixers[0].clipAction(clip).play();
    const sit = findClip(m.riderClips, /^SitDown$/);
    if (sit && m.riderMixer) {
      const a = m.riderMixer.clipAction(sit);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.play();
      m.riderMixer.update(sit.duration);
    }
    for (const mx of mixers) mx.update(0.35);
  }
  obj.rotation.y = card.type === 'spell' ? 0.5 : 0.45;
  scene.add(obj);
  // Frame: fit the model's bounds.
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(28, W / H, 0.05, 100);
  const fitH = size.y * 0.62;
  const fitW = Math.max(size.x, size.z) * 0.62 / (W / H);
  const dist = Math.max(fitH, fitW) / Math.tan(THREE.MathUtils.degToRad(14)) * 1.05 + Math.max(size.x, size.z) * 0.5;
  // Tall units: frame the top two thirds (face + weapon) like a trading card.
  const tall = card.type === 'troop' && size.y > 1.6;
  const lookY = tall ? box.max.y - size.y * 0.38 : center.y;
  const d = tall ? dist * 0.72 : dist;
  cam.position.set(center.x + d * 0.18, lookY + d * 0.22, center.z + d);
  cam.lookAt(center.x, lookY, center.z);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);

  // Compose: rarity gradient + light burst + the render.
  const cv = document.createElement('canvas');
  cv.width = W * 2;
  cv.height = H * 2;
  const c = cv.getContext('2d')!;
  const [a, b] = RARITY_COLORS[card.rarity];
  const g = c.createLinearGradient(0, 0, 0, cv.height);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  c.fillStyle = g;
  c.fillRect(0, 0, cv.width, cv.height);
  const burst = c.createRadialGradient(cv.width / 2, cv.height * 0.45, 10, cv.width / 2, cv.height * 0.45, cv.width * 0.7);
  burst.addColorStop(0, 'rgba(255,255,255,0.55)');
  burst.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = burst;
  c.fillRect(0, 0, cv.width, cv.height);
  c.save();
  c.globalAlpha = 0.12;
  c.translate(cv.width / 2, cv.height * 0.45);
  for (let i = 0; i < 12; i++) {
    c.rotate(Math.PI / 6);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(-30, -cv.height);
    c.lineTo(30, -cv.height);
    c.fill();
  }
  c.restore();
  c.drawImage(renderer.domElement, 0, 0);
  // Free GPU memory from per-portrait materials.
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
  });
  return cv.toDataURL('image/webp', 0.9);
}

/** Dev/bake hook: render every card and return data URLs. */
export async function renderAll(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of ids) out[id] = await portrait(id, true);
  return out;
}
