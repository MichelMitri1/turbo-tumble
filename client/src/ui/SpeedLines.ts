import { el } from './dom';

/**
 * Screen-edge speed streaks pointing at the vanishing point. Drawn fresh each
 * frame (a little flicker reads as motion); costs nothing when intensity is 0.
 */
export class SpeedLines {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private level = 0;

  constructor(parent: HTMLElement) {
    this.canvas = el('canvas', 'tt-speedlines');
    this.ctx = this.canvas.getContext('2d')!;
    parent.appendChild(this.canvas);
  }

  /** `intensity` 0..1. */
  draw(intensity: number, dt: number): void {
    this.level += (intensity - this.level) * Math.min(1, dt * 6);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const g = this.ctx;
    g.clearRect(0, 0, w, h);
    if (this.level < 0.03 || w === 0) return;
    // Vanishing point roughly at the horizon in the chase framing.
    const cx = w / 2;
    const cy = h * 0.38;
    const reach = Math.hypot(w, h) * 0.62;
    const count = Math.round(14 + 26 * this.level);
    g.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = reach * (0.55 + Math.random() * 0.3);
      const len = reach * (0.12 + Math.random() * 0.25) * (0.6 + this.level);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      g.strokeStyle = `rgba(255,255,255,${(0.3 + Math.random() * 0.4) * this.level})`;
      g.lineWidth = 2 + Math.random() * 4 * this.level;
      g.beginPath();
      g.moveTo(cx + dx * r0, cy + dy * r0);
      g.lineTo(cx + dx * (r0 + len), cy + dy * (r0 + len));
      g.stroke();
    }
  }
}
