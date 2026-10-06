import {
  ACESFilmicToneMapping,
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { racerStats } from '@shared/roster/Roster';
import { createKartState } from '@shared/vehicles/KartState';
import type { KartStats } from '@shared/vehicles/KartStats';
import type { AssetLoader } from '../assets/AssetLoader';
import { engineLabel, getEngineProfile } from '../audio/EngineProfiles';
import { CHARACTERS, KART_BODIES, getCharacter, getKartBody } from '../config/roster';
import type { MenuNav } from '../input/InputManager';
import { buildKartRig } from '../vehicles/KartModelFactory';
import { KartView, type KartRenderState } from '../vehicles/KartView';
import { el } from './dom';

/** Stat bars: label, how to read it from KartStats, and whether lower is better. */
const STAT_BARS: Array<[label: string, read: (s: KartStats) => number]> = [
  ['Speed', (s) => s.maxSpeed],
  ['Acceleration', (s) => s.accelRate],
  ['Handling', (s) => s.turnRate],
  ['Grip', (s) => s.grip],
  ['Weight', (s) => s.weight],
];

export interface GarageChoice {
  character: string;
  kart: string;
}

/**
 * Character & kart select: a turntable preview of the actual kart (driver,
 * topper, scarf, idle animation), stat bars and the kart's engine (revved on
 * every kart change). ←→ racer · ↑↓ kart · Enter confirm · Esc back.
 */
export class GarageScreen {
  readonly root: HTMLElement;
  open = false;
  private character = 0;
  private kart = 0;
  private readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(32, 1, 0.1, 100);
  private view: KartView | null = null;
  private readonly info: HTMLElement;
  private raf = 0;
  private last = 0;
  private spin = 0;
  private done: ((choice: GarageChoice | null) => void) | null = null;
  private readonly ranges: Array<[number, number]>;

  constructor(
    parent: HTMLElement,
    private readonly assets: AssetLoader,
    private readonly preview: (kart: string | null) => void,
  ) {
    this.canvas = el('canvas', 'tt-garage__canvas');
    this.info = el('div', 'tt-garage__info');
    const back = el('button', 'tt-button tt-online__btn is-small', 'Back');
    back.addEventListener('click', () => this.finish(false));
    const go = el('button', 'tt-button tt-menu__start tt-garage__go', "LET'S GO!");
    go.addEventListener('click', () => this.finish(true));
    this.root = el('div', 'tt-garage', [
      el('h2', 'tt-join__title tt-display', 'GARAGE'),
      el('div', 'tt-garage__body', [el('div', 'tt-garage__stage', [this.canvas]), this.info]),
      el('div', 'tt-garage__actions', [back, go]),
      el('div', 'tt-join__help', '←→ racer · ↑↓ kart (hear its engine) · Enter / Ⓐ go · Esc / Ⓑ back'),
    ]);
    parent.appendChild(this.root);

    // Normalise stat bars across every racer × kart combination.
    const all = CHARACTERS.flatMap((c) => KART_BODIES.map((k) => racerStats(c.id, k.id)));
    this.ranges = STAT_BARS.map(([, read]) => {
      const v = all.map(read);
      return [Math.min(...v), Math.max(...v)];
    });

    this.scene.background = new Color('#1d1650');
    this.scene.add(new HemisphereLight('#dfe8ff', '#3a2f7a', 1.6));
    const sun = new DirectionalLight('#fff3dc', 2.4);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);
    const floor = new Mesh(new CircleGeometry(3.2, 48), new MeshStandardMaterial({ color: '#3a2f97', roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.camera.position.set(0, 3.1, 10);
    this.camera.lookAt(0, 1.45, 0);
  }

  show(character: string, kart: string, done: (choice: GarageChoice | null) => void): void {
    this.character = Math.max(0, CHARACTERS.findIndex((c) => c.id === character));
    this.kart = Math.max(0, KART_BODIES.findIndex((k) => k.id === kart));
    this.done = done;
    this.open = true;
    this.root.classList.add('is-open');
    if (!this.renderer) {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.toneMapping = ACESFilmicToneMapping;
    }
    this.rebuild();
    this.preview(KART_BODIES[this.kart]!.id);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('is-open');
    cancelAnimationFrame(this.raf);
    this.preview(null);
  }

  private finish(go: boolean): void {
    const choice = { character: CHARACTERS[this.character]!.id, kart: KART_BODIES[this.kart]!.id };
    const done = this.done;
    this.done = null;
    this.hide();
    done?.(go ? choice : null);
  }

  handle(nav: MenuNav, escape: boolean): void {
    if (!this.open) return;
    if (escape || nav.back) return this.finish(false);
    if (nav.confirm) return this.finish(true);
    if (nav.left || nav.right) {
      this.character = (this.character + (nav.right ? 1 : -1) + CHARACTERS.length) % CHARACTERS.length;
      this.rebuild();
    }
    if (nav.up || nav.down) {
      this.kart = (this.kart + (nav.down ? 1 : -1) + KART_BODIES.length) % KART_BODIES.length;
      this.rebuild();
      this.preview(KART_BODIES[this.kart]!.id);
    }
  }

  private rebuild(): void {
    if (this.view) this.scene.remove(this.view.root);
    const c = CHARACTERS[this.character]!;
    const k = KART_BODIES[this.kart]!;
    this.view = new KartView(buildKartRig(this.assets, getKartBody(k.id), getCharacter(c.id)));
    this.scene.add(this.view.root);

    const stats = racerStats(c.id, k.id);
    const arrow = (label: string, delta: number, axis: 'c' | 'k'): HTMLElement => {
      const b = el('button', 'tt-menu__arrow', label);
      b.addEventListener('click', () => this.handle({ up: axis === 'k' && delta < 0, down: axis === 'k' && delta > 0, left: axis === 'c' && delta < 0, right: axis === 'c' && delta > 0, confirm: false, back: false }, false));
      return b;
    };
    const swatch = el('span', 'tt-garage__swatch');
    swatch.style.background = c.color;
    this.info.replaceChildren(
      el('div', 'tt-garage__pick', [arrow('◀', -1, 'c'), el('div', 'tt-garage__name', [swatch, el('span', 'tt-display', c.name), el('small', '', c.tagline)]), arrow('▶', 1, 'c')]),
      el('div', 'tt-garage__pick', [arrow('▲', -1, 'k'), el('div', 'tt-garage__name', [el('span', 'tt-display', k.name), el('small', '', `🔊 ${engineLabel(getEngineProfile(k.engine))}`)]), arrow('▼', 1, 'k')]),
      el(
        'div',
        'tt-garage__stats',
        STAT_BARS.map(([label, read], i) => {
          const [lo, hi] = this.ranges[i]!;
          const t = hi > lo ? (read(stats) - lo) / (hi - lo) : 0.5;
          const fill = el('div', 'tt-garage__fill');
          fill.style.width = `${Math.round(18 + t * 82)}%`;
          return el('div', 'tt-garage__stat', [el('span', '', label), el('div', 'tt-garage__bar', [fill])]);
        }),
      ),
      el('div', 'tt-garage__count', `Racer ${this.character + 1} / ${CHARACTERS.length} · Kart ${this.kart + 1} / ${KART_BODIES.length}`),
    );
  }

  private readonly frame = (now: number): void => {
    if (!this.open || !this.renderer) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w && h && (this.canvas.width !== Math.round(w * devicePixelRatio) || this.canvas.height !== Math.round(h * devicePixelRatio))) {
      this.renderer.setPixelRatio(devicePixelRatio);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.spin += dt * 0.6;
    if (this.view) {
      const rs: KartRenderState = {
        position: new Vector3(0, 0, 0),
        quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.spin),
        forwardSpeed: 0,
        speed01: 0.15,
        steer: Math.sin(now / 900) * 0.6,
        grounded: true,
        respawnTimer: 0,
        groundY: 0,
      };
      this.view.update(rs, createKartState(), dt);
      this.view.contactShadow.visible = false;
    }
    this.renderer.render(this.scene, this.camera);
  };
}
