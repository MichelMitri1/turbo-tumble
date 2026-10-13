import type { Stroke } from './sim/match';

/**
 * Padel controls. The swing is a gesture: move the mouse (pointer locked) — or flick the right stick —
 * and the stroke's direction aims the shot (straight up the screen = straight down the court, angled =
 * across it) while its speed is the power. A short soft flick drops it short; hold the right button
 * (or Shift / RT) while you swing for a lob. Overheads happen by themselves when the ball is high:
 * a hard swing smashes, a medium one plays the bandeja, an angled one the víbora.
 * WASD / arrows / left stick move you; leave them alone and auto-move gets you to the ball.
 */
export interface SwingSettings {
  /** Mouse sensitivity multiplier (higher = less movement for full power). */
  sens: number;
  /** Let the game move you to the ball. */
  auto: boolean;
}

/** Mouse speed (px/s of the stroke's peak) for a whisper of a swing and for full power. */
const START = 650;
const FULL = 4200;

export class SwingInput {
  settings: SwingSettings = { sens: 1, auto: true };
  /** Last stroke, for the HUD's swing meter. */
  last: Stroke | null = null;
  lastAt = 0;
  private keys = new Set<string>();
  private lobHeld = false;
  /** Stroke in progress: accumulated movement, peak speed, start time. */
  private acc: { dx: number; dy: number; peak: number; t0: number } | null = null;
  private vx = 0;
  private vy = 0;
  private lastMove = 0;
  private pending: Stroke | null = null;
  private padPrev = { x: 0, y: 0 };
  private padStroke: { dx: number; dy: number; peak: number; t0: number } | null = null;
  enabled = false;

  constructor(private readonly el: HTMLElement) {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.lobHeld = true;
      if (e.code === 'Space' && this.enabled) {
        // Keyboard fallback: a medium swing straight ahead (lob with Shift).
        this.pending = { dx: 0, dy: -1, power: 0.6, lob: this.lobHeld };
        e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.lobHeld = false;
    });
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== el) void el.requestPointerLock?.();
      if (e.button === 2) this.lobHeld = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 2) this.lobHeld = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => this.onMove(e));
  }

  get locked(): boolean {
    return document.pointerLockElement === this.el;
  }

  /** Mouse movement → strokes: a burst of speed starts one, it ends when the hand slows. */
  private onMove(e: MouseEvent): void {
    if (!this.enabled || !this.locked) return;
    const now = performance.now();
    const dt = Math.max(1, now - this.lastMove) / 1000;
    this.lastMove = now;
    const s = this.settings.sens;
    const mx = e.movementX * s;
    const my = e.movementY * s;
    // Smoothed hand speed (px/s).
    const k = Math.min(1, dt * 30);
    this.vx += (mx / dt - this.vx) * k;
    this.vy += (my / dt - this.vy) * k;
    const sp = Math.hypot(this.vx, this.vy);
    if (!this.acc && sp > START) this.acc = { dx: 0, dy: 0, peak: 0, t0: now };
    if (this.acc) {
      this.acc.dx += mx;
      this.acc.dy += my;
      this.acc.peak = Math.max(this.acc.peak, sp);
      if (sp < START * 0.45 || now - this.acc.t0 > 260) this.finish(this.acc, now);
    }
  }

  private finish(a: { dx: number; dy: number; peak: number; t0: number }, now: number): void {
    this.acc = null;
    const len = Math.hypot(a.dx, a.dy) || 1;
    // A stroke pulled back down the screen still swings forward (it's the speed that counts), mirrored.
    const dy = a.dy > 0 ? -a.dy : a.dy;
    const power = Math.max(0.05, Math.min(1, (a.peak - START) / (FULL - START)));
    this.pending = { dx: a.dx / len, dy: dy / len, power, lob: this.lobHeld };
    this.last = this.pending;
    this.lastAt = now;
  }

  /** Movement stick, team-relative (x right, z towards the net). */
  move(): { mx: number; mz: number } {
    let mx = 0;
    let mz = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1;
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const lx = pad.axes[0] ?? 0;
      const ly = pad.axes[1] ?? 0;
      if (Math.hypot(lx, ly) > 0.2) {
        mx = lx;
        mz = -ly;
      }
    }
    const l = Math.hypot(mx, mz);
    return l > 1 ? { mx: mx / l, mz: mz / l } : { mx, mz };
  }

  /** The right stick as a swing: a flick out from the centre is a stroke. */
  private padSwing(): void {
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (!pad) return;
    const x = pad.axes[2] ?? 0;
    const y = pad.axes[3] ?? 0;
    const now = performance.now();
    const r = Math.hypot(x, y);
    const lob = (pad.buttons[7]?.value ?? 0) > 0.4 || !!pad.buttons[5]?.pressed;
    if (!this.padStroke && r > 0.55 && Math.hypot(this.padPrev.x, this.padPrev.y) < 0.35) this.padStroke = { dx: x, dy: y, peak: r, t0: now };
    if (this.padStroke) {
      this.padStroke.dx = x;
      this.padStroke.dy = y;
      this.padStroke.peak = Math.max(this.padStroke.peak, r);
      const fast = now - this.padStroke.t0;
      if (r < 0.3 || fast > 220) {
        // Faster flicks hit harder: time to full deflection.
        const power = Math.max(0.1, Math.min(1, 1.15 - fast / 260));
        const len = Math.hypot(this.padStroke.dx, this.padStroke.dy) || 1;
        const dy = this.padStroke.dy > 0 ? -this.padStroke.dy : this.padStroke.dy;
        this.pending = { dx: this.padStroke.dx / len, dy: dy / len, power, lob };
        this.last = this.pending;
        this.lastAt = now;
        this.padStroke = null;
      }
    }
    this.padPrev = { x, y };
  }

  /** The stroke since the last call (if any). */
  take(): Stroke | null {
    this.padSwing();
    // The hand stopped dead (no more mouse events): that's the end of the stroke.
    if (this.acc && performance.now() - this.lastMove > 45) this.finish(this.acc, performance.now());
    const s = this.pending;
    this.pending = null;
    return s;
  }
}
