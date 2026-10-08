import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  SRGBColorSpace,
  Scene,
  Vector3,
} from 'three';
import { createKartState, type KartState } from '@shared/vehicles/KartState';
import type { AssetLoader } from '../assets/AssetLoader';
import { getCharacter, getKartBody } from '../config/roster';
import type { Renderer } from '../rendering/Renderer';
import { buildKartRig } from '../vehicles/KartModelFactory';
import { KartView, type KartRenderState } from '../vehicles/KartView';
import { Effects } from '../vfx/Effects';

export interface PodiumRacer {
  characterId: string;
  kartId: string;
}

/** Step heights for 1st / 2nd / 3rd and where each stands (x). */
const STEPS = [
  { height: 1.7, x: 0, color: '#ffc21a', label: '1' },
  { height: 1.15, x: -3.6, color: '#d9e1ee', label: '2' },
  { height: 0.75, x: 3.6, color: '#e0844a', label: '3' },
];

/**
 * Trophy ceremony: the top three karts on a podium in their own little scene,
 * drivers cheering, the camera slowly orbiting and confetti raining. Rendered
 * full-screen in place of the race views while open (the standings panel sits
 * over it).
 */
export class Podium {
  readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(42, 16 / 9, 0.1, 200);
  private readonly fx = new Effects();
  private readonly views: KartView[] = [];
  private readonly kartStates: KartState[] = [];
  private time = 0;
  private confettiTimer = 0;
  open = false;

  constructor(private readonly assets: AssetLoader) {
    const s = this.scene;
    s.background = new Color('#6fb8ff');
    s.fog = new Fog('#6fb8ff', 30, 90);
    s.add(new HemisphereLight('#e8f4ff', '#4a6a3a', 1.7));
    const sun = new DirectionalLight('#fff3dc', 2.6);
    sun.position.set(6, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    s.add(sun);
    const ground = (new Mesh(new CircleGeometry(40, 48), new MeshStandardMaterial({ color: '#5fbf4a', roughness: 1 })));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    // A red carpet ring under the podium.
    const carpet = (new Mesh(new CylinderGeometry(7.5, 7.5, 0.06, 48), new MeshStandardMaterial({ color: '#c8243f', roughness: 0.9 })));
    carpet.position.y = 0.03;
    carpet.receiveShadow = true;
    s.add(ground, carpet);
    for (const step of STEPS) {
      const mat = new MeshStandardMaterial({ color: step.color, roughness: 0.35, metalness: step.label === '1' ? 0.4 : 0.2 });
      const box = (new Mesh(new BoxGeometry(3.4, step.height, 3.4), mat));
      box.position.set(step.x, step.height / 2, 0);
      box.castShadow = box.receiveShadow = true;
      s.add(box);
      const plate = (new Mesh(new BoxGeometry(1.4, 1.0, 0.05), new MeshStandardMaterial({ map: numberTexture(step.label), roughness: 0.6 })));
      plate.position.set(step.x, Math.max(0.55, step.height / 2), 1.73);
      s.add(plate);
    }
    s.add(this.fx.root);
  }

  /** Put these racers (1st, 2nd, 3rd) on the podium and start the show. */
  show(top: readonly PodiumRacer[]): void {
    this.clearKarts();
    top.slice(0, 3).forEach((r, i) => {
      const view = new KartView(buildKartRig(this.assets, getKartBody(r.kartId), getCharacter(r.characterId)));
      view.setMood('cheer');
      view.root.position.set(STEPS[i]!.x, STEPS[i]!.height, 0);
      this.scene.add(view.root);
      this.views.push(view);
      this.kartStates.push(createKartState());
    });
    this.time = 0;
    this.confettiTimer = 0.3;
    this.open = true;
  }

  hide(): void {
    this.open = false;
    this.clearKarts();
  }

  private clearKarts(): void {
    for (const v of this.views) v.dispose();
    this.views.length = 0;
    this.kartStates.length = 0;
  }

  private readonly rs: KartRenderState = { position: new Vector3(), quaternion: new Quaternion(), forwardSpeed: 0, speed01: 0.1, steer: 0, grounded: true, respawnTimer: 0, groundY: null };
  private readonly up = new Vector3(0, 1, 0);

  render(renderer: Renderer, dt: number): void {
    this.time += dt;
    const t = this.time;
    // Karts face the camera's side, with a little sway.
    this.views.forEach((v, i) => {
      this.rs.position.set(STEPS[i]!.x, STEPS[i]!.height, 0);
      this.rs.quaternion.setFromAxisAngle(this.up, Math.sin(t * 0.8 + i) * 0.25 + (i === 0 ? 0 : i === 1 ? 0.35 : -0.35));
      v.update(this.rs, this.kartStates[i]!, dt);
      v.contactShadow.visible = false;
    });
    // Slow swing round the front of the podium, easing in from a wider shot.
    const intro = Math.min(1, t / 2.5);
    const ease = 1 - (1 - intro) * (1 - intro);
    const a = Math.sin(t * 0.25) * 0.55;
    const dist = 25 - ease * 6;
    this.camera.position.set(Math.sin(a) * dist, 5.2 + (1 - ease) * 4, Math.cos(a) * dist);
    this.camera.lookAt(0, 2.3, 0);
    const { width, height } = renderer.size;
    // The standings panel covers the right of wide screens: frame the podium left of centre.
    this.camera.aspect = width / Math.max(1, height);
    this.camera.setViewOffset(width, height, width > height * 1.3 ? width * 0.17 : 0, 0, width, height);
    this.camera.updateProjectionMatrix();

    this.confettiTimer -= dt;
    if (this.confettiTimer <= 0) {
      this.confettiTimer = 1.4;
      for (let i = 0; i < 3; i++) this.fx.confetti(new Vector3(STEPS[i]!.x, STEPS[i]!.height + 1.5, 0), i === 0 ? 1 : 0.5);
    }
    this.fx.update(dt);
    renderer.render(this.scene, [{ camera: this.camera, rect: { x: 0, y: 0, width: 1, height: 1 } }]);
  }
}

function numberTexture(label: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1446';
  g.fillRect(0, 0, 128, 96);
  g.fillStyle = '#ffffff';
  g.font = '900 80px "Lilita One", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 64, 52);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
