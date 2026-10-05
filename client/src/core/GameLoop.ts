import { FIXED_DT, MAX_STEPS_PER_FRAME } from '@shared/constants/simulation';

export interface LoopCallbacks {
  /** Called once per frame before any ticks (input polling, UI). */
  frameStart(dt: number): void;
  /** Fixed-rate simulation tick. */
  tick(dt: number): void;
  /** Render with interpolation factor alpha (0..1) between the last two ticks. */
  render(alpha: number, dt: number): void;
}

/**
 * Fixed-timestep loop: simulation runs at TICK_RATE regardless of display refresh
 * (60/120/144 Hz) and rendering interpolates between ticks.
 */
export class GameLoop {
  private last = 0;
  private acc = 0;
  private raf = 0;
  private running = false;
  paused = false;
  /** Ticks executed in the most recent frame (debug). */
  lastTicks = 0;
  /** Smoothed frame time in ms (debug). */
  frameMs = 16.7;

  constructor(private readonly cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.1;

    this.cb.frameStart(dt);
    let ticks = 0;
    if (!this.paused) {
      this.acc += dt;
      while (this.acc >= FIXED_DT && ticks < MAX_STEPS_PER_FRAME) {
        this.cb.tick(FIXED_DT);
        this.acc -= FIXED_DT;
        ticks++;
      }
      if (ticks === MAX_STEPS_PER_FRAME) this.acc = 0;
    }
    this.lastTicks = ticks;
    this.cb.render(this.paused ? 1 : this.acc / FIXED_DT, this.paused ? 0 : dt);
  };
}
