import type { TrackPath } from '@shared/track/TrackPath';
import { el } from './dom';

export interface MinimapDot {
  x: number;
  z: number;
  color: string;
  kind: 'racer' | 'me' | 'crown' | 'box';
  /** World-space heading (x, z) for the player's arrow. */
  dir?: [number, number];
}

/**
 * Track map drawn from the centreline. The outline is cached per canvas size;
 * racers and notable items are drawn on top every frame.
 */
export class Minimap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private size = 0;
  private readonly pts: Array<[number, number]>;
  private readonly rot: number;
  private minX = 0;
  private minY = 0;
  private span = 1;
  private readonly roadWidth: number;

  constructor(
    parent: HTMLElement,
    private readonly track: TrackPath,
    rotationDeg: number,
  ) {
    this.canvas = el('canvas', 'tt-minimap__canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.root = el('div', 'tt-minimap', [this.canvas]);
    parent.appendChild(this.root);
    this.rot = (rotationDeg * Math.PI) / 180;
    // Top-down map: +X right, -Z up (north up).
    this.pts = track.samples.map((s) => this.rotate(s.position.x, s.position.z));
    const xs = this.pts.map((p) => p[0]);
    const ys = this.pts.map((p) => p[1]);
    this.minX = Math.min(...xs);
    this.minY = Math.min(...ys);
    this.span = Math.max(Math.max(...xs) - this.minX, Math.max(...ys) - this.minY);
    this.roadWidth = track.def.path.defaultHalfWidth * 2;
  }

  private rotate(x: number, z: number): [number, number] {
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return [x * c - z * s, x * s + z * c];
  }

  private toCanvas(x: number, y: number): [number, number] {
    const pad = this.size * 0.1;
    const scale = (this.size - pad * 2) / this.span;
    return [pad + (x - this.minX) * scale, pad + (y - this.minY) * scale];
  }

  private rebuildBase(): void {
    const c = document.createElement('canvas');
    c.width = c.height = this.size;
    const g = c.getContext('2d')!;
    const scale = (this.size * 0.8) / this.span;
    const road = Math.max(3, this.roadWidth * scale);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const path = new Path2D();
    this.pts.forEach(([x, y], i) => {
      const [cx, cy] = this.toCanvas(x, y);
      if (i === 0) path.moveTo(cx, cy);
      else path.lineTo(cx, cy);
    });
    path.closePath();
    g.strokeStyle = 'rgba(27,20,70,0.85)';
    g.lineWidth = road + this.size * 0.035;
    g.stroke(path);
    g.strokeStyle = '#fffaf0';
    g.lineWidth = road + this.size * 0.018;
    g.stroke(path);
    g.strokeStyle = '#6a6f88';
    g.lineWidth = road;
    g.stroke(path);
    // Start line.
    const startIdx = Math.round(this.track.startDistance / this.track.spacing) % this.pts.length;
    const s = this.track.samples[startIdx]!;
    const a = this.rotate(s.position.x - s.flatRight.x * s.halfWidth * 1.6, s.position.z - s.flatRight.z * s.halfWidth * 1.6);
    const b = this.rotate(s.position.x + s.flatRight.x * s.halfWidth * 1.6, s.position.z + s.flatRight.z * s.halfWidth * 1.6);
    g.strokeStyle = '#ffd23f';
    g.lineWidth = Math.max(2, this.size * 0.018);
    g.beginPath();
    g.moveTo(...this.toCanvas(...a));
    g.lineTo(...this.toCanvas(...b));
    g.stroke();
    this.base = c;
  }

  draw(dots: readonly MinimapDot[]): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(this.root.clientWidth * dpr);
    if (size <= 0) return;
    if (size !== this.size) {
      this.size = size;
      this.canvas.width = this.canvas.height = size;
      this.rebuildBase();
    }
    const g = this.ctx;
    g.clearRect(0, 0, size, size);
    if (this.base) g.drawImage(this.base, 0, 0);
    const r = size * 0.034;
    const order = { box: 0, racer: 1, crown: 2, me: 3 } as const;
    for (const d of [...dots].sort((p, q) => order[p.kind] - order[q.kind])) {
      const [x, y] = this.toCanvas(...this.rotate(d.x, d.z));
      g.beginPath();
      if (d.kind === 'box') {
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.arc(x, y, r * 0.45, 0, Math.PI * 2);
        g.fill();
        continue;
      }
      const radius = d.kind === 'me' ? r * 1.35 : d.kind === 'crown' ? r * 1.2 : r;
      g.arc(x, y, radius, 0, Math.PI * 2);
      g.fillStyle = d.color;
      g.fill();
      g.lineWidth = Math.max(1.5, size * 0.012);
      g.strokeStyle = d.kind === 'me' ? '#ffd23f' : '#1b1446';
      g.stroke();
      if (d.kind === 'me' && d.dir) {
        // Heading arrow: rotate the world heading into map space; the arrow is drawn pointing up (-y).
        const [dx, dy] = this.rotate(d.dir[0], d.dir[1]);
        g.save();
        g.translate(x, y);
        g.rotate(Math.atan2(dx, -dy));
        g.beginPath();
        g.moveTo(0, -radius * 2.1);
        g.lineTo(radius * 0.8, -radius * 1.15);
        g.lineTo(-radius * 0.8, -radius * 1.15);
        g.closePath();
        g.fillStyle = '#ffd23f';
        g.fill();
        g.restore();
      }
    }
  }
}
