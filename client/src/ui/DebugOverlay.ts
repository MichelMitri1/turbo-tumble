import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, type Scene } from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '@shared/physics/PhysicsWorld';
import { SurfaceType } from '@shared/types/surface';
import { el } from './dom';

export interface DebugSnapshot {
  fps: number;
  frameMs: number;
  ticks: number;
  drawCalls: number;
  triangles: number;
  players: Array<{
    label: string;
    speed: number;
    position: { x: number; y: number; z: number };
    grounded: boolean;
    surface: SurfaceType;
    steer: number;
    trackIndex: number;
    lapDistance: number;
    lateral: number;
    input: string;
    device: string;
    race: string;
  }>;
  gamepads: string[];
  network: string;
}

/**
 * Toggleable developer overlay. F3: stats panel. F4: collider wireframes
 * (terrain excluded to keep it cheap; walls, road, curbs and karts shown live).
 */
export class DebugOverlay {
  readonly root: HTMLElement;
  private lines: LineSegments | null = null;
  private collidersVisible = false;
  private accum = 0;

  constructor(
    parent: HTMLElement,
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly excludeFromColliders: RAPIER.Collider[] = [],
  ) {
    this.root = el('div', 'tt-debug');
    parent.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3' || e.code === 'Backquote') {
        e.preventDefault();
        this.toggle();
      } else if (e.code === 'F4') {
        e.preventDefault();
        this.toggleColliders();
      }
    });
  }

  get visible(): boolean {
    return this.root.classList.contains('is-open');
  }

  toggle(): void {
    this.root.classList.toggle('is-open');
  }

  toggleColliders(): void {
    this.collidersVisible = !this.collidersVisible;
    if (!this.collidersVisible && this.lines) {
      this.scene.remove(this.lines);
      this.lines.geometry.dispose();
      this.lines = null;
    }
  }

  update(dt: number, snap: () => DebugSnapshot): void {
    if (this.collidersVisible) this.refreshColliders();
    if (!this.visible) return;
    this.accum += dt;
    if (this.accum < 0.1) return;
    this.accum = 0;
    const s = snap();
    const f = (n: number, d = 1): string => n.toFixed(d);
    const lines = [
      `FPS ${f(s.fps, 0)}  (${f(s.frameMs)} ms)  ticks/frame ${s.ticks}`,
      `draw calls ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(0)}k`,
      `net ${s.network}`,
      `pads ${s.gamepads.length ? s.gamepads.join(' | ') : 'none'}`,
      '',
    ];
    for (const p of s.players) {
      lines.push(
        `[${p.label}] ${p.device}`,
        `  speed ${f(p.speed * 3.6, 0)} km/h  steer ${f(p.steer, 2)}`,
        `  pos ${f(p.position.x)} ${f(p.position.y)} ${f(p.position.z)}`,
        `  ${p.grounded ? 'grounded' : 'AIRBORNE'}  surface ${SurfaceType[p.surface]}`,
        `  track #${p.trackIndex}  lap ${f(p.lapDistance, 0)} m  lateral ${f(p.lateral)}`,
        `  input ${p.input}`,
        `  ${p.race}`,
      );
    }
    lines.push('', 'F3 panel · F4 colliders · F5 racing line');
    this.root.textContent = lines.join('\n');
  }

  private refreshColliders(): void {
    const excluded = new Set(this.excludeFromColliders.map((c) => c.handle));
    const { vertices, colors } = this.physics.debugLines((c) => !excluded.has(c.handle));
    if (!this.lines) {
      this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 }));
      this.lines.frustumCulled = false;
      this.lines.renderOrder = 999;
      this.scene.add(this.lines);
    }
    const g = this.lines.geometry;
    g.setAttribute('position', new BufferAttribute(vertices, 3));
    g.setAttribute('color', new BufferAttribute(colors, 4));
  }
}
