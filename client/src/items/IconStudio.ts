import { AmbientLight, Box3, DirectionalLight, HemisphereLight, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Sphere, Vector3, WebGLRenderer, NeutralToneMapping } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ALL_ITEMS } from '@shared/items/ItemTypes';
import { createItemModel, type ModelKey } from './ItemModels';

/** Icon-specific viewing angles [pitch, yaw] for flat items. */
const ICON_TILT: Partial<Record<ModelKey, [number, number]>> = {
  puck: [0.75, 0],
  puck3: [0.6, 0],
  rang: [1.15, 0.2],
  coin: [0.1, -0.4],
};

/**
 * Renders every item model to a transparent PNG once at load, so HUD icons always
 * match the in-world 3D assets. Uses a short-lived offscreen renderer.
 */
export function renderItemIcons(size = 160): Record<string, string> {
  const canvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  // Studio reflections so metallic items (gold, brass, coins) read correctly.
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new HemisphereLight('#ffffff', '#6a5aa8', 1.6), new AmbientLight('#ffffff', 0.4));
  const key = new DirectionalLight('#fff3dc', 2.6);
  key.position.set(2, 3, 4);
  scene.add(key);
  const camera = new PerspectiveCamera(28, 1, 0.1, 50);

  const out: Record<string, string> = {};
  const box = new Box3();
  const sphere = new Sphere();
  const keys: ModelKey[] = [...ALL_ITEMS, 'coinPickup', 'prizeBox'];
  for (const id of keys) {
    const model = createItemModel(id);
    const tilt = ICON_TILT[id] ?? [0.15, -0.55];
    model.rotation.set(tilt[0], tilt[1], 0);
    scene.add(model);
    model.updateMatrixWorld(true);
    box.setFromObject(model).getBoundingSphere(sphere);
    const dist = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.8;
    camera.position.copy(sphere.center).add(new Vector3(0, sphere.radius * 0.25, dist));
    camera.lookAt(sphere.center);
    renderer.render(scene, camera);
    out[id] = canvas.toDataURL('image/png');
    scene.remove(model);
  }
  pmrem.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
