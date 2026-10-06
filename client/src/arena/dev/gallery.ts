import * as THREE from 'three';
import { instantiate, modelManifest, findClip } from '../assets';

/** `?gallery[=prefix]`: every converted model on a grid, playing its idle — for picking card visuals. */
export async function runGallery(prefix = ''): Promise<void> {
  document.body.style.margin = '0';
  document.body.style.background = '#222';
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#3a3f55');
  scene.add(new THREE.HemisphereLight('#ffffff', '#445', 2.4));
  const sun = new THREE.DirectionalLight('#fff', 2);
  sun.position.set(5, 10, 8);
  scene.add(sun);
  const names = Object.keys(await modelManifest()).filter((n) => n.startsWith(prefix)).sort();
  const cols = Math.ceil(Math.sqrt(names.length * 1.6));
  const mixers: THREE.AnimationMixer[] = [];
  const labels: Array<{ el: HTMLElement; pos: THREE.Vector3 }> = [];
  await Promise.all(
    names.map(async (n, i) => {
      const inst = await instantiate(n, 1.4);
      const x = (i % cols) - cols / 2;
      const z = Math.floor(i / cols);
      inst.root.position.set(x * 2.2, 0, z * 2.4);
      inst.root.rotation.y = 0.5;
      scene.add(inst.root);
      if (inst.mixer) {
        const c = findClip(inst.clips, /^idle$/i, /flying_idle/i, /idle/i);
        if (c) inst.mixer.clipAction(c).play();
        mixers.push(inst.mixer);
      }
      const el = document.createElement('div');
      el.textContent = n;
      el.style.cssText = 'position:fixed;font:11px monospace;color:#fff;background:#0008;padding:1px 3px;transform:translate(-50%,0);pointer-events:none';
      document.body.appendChild(el);
      labels.push({ el, pos: new THREE.Vector3(x * 2.2, -0.15, z * 2.4) });
    }),
  );
  const rows = Math.ceil(names.length / cols);
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(0, rows * 2.6, rows * 2.4 + 8);
  camera.lookAt(0, 0, rows * 1.1);
  const clock = new THREE.Clock();
  const v = new THREE.Vector3();
  const tick = (): void => {
    const dt = clock.getDelta();
    for (const m of mixers) m.update(dt);
    renderer.render(scene, camera);
    for (const l of labels) {
      v.copy(l.pos).project(camera);
      l.el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      l.el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    }
    requestAnimationFrame(tick);
  };
  tick();
  (window as unknown as { __galleryReady?: boolean }).__galleryReady = true;
}
