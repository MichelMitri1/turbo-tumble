/** Audio-only drivetrain: it never changes kart handling or race simulation. */
export interface EngineTuning {
  idle: number;
  redline: number;
  response: number;
  gears: number;
}

export interface EngineDriveInput {
  speed01: number;
  throttle: number;
  freeRev: boolean;
  stunned: boolean;
}

export class EngineDynamics {
  rpm: number;
  gear = 1;
  shift = 0;
  lift = 0;
  private throttle = 0;
  private shiftLock = 0;

  constructor(readonly tuning: EngineTuning) { this.rpm = tuning.idle; }

  update(input: EngineDriveInput, dt: number): void {
    dt = Math.min(0.1, Math.max(0, dt));
    const t = this.tuning;
    const throttle = Math.max(0, Math.min(1, input.throttle));
    this.shift = Math.max(0, this.shift - dt);
    this.lift = Math.max(0, this.lift - dt);
    this.shiftLock = Math.max(0, this.shiftLock - dt);
    if (this.throttle > 0.6 && throttle < 0.25 && this.rpm > t.idle + (t.redline - t.idle) * 0.35) this.lift = 0.3;
    this.throttle = throttle;
    const speed = Math.max(0, input.speed01);
    const span = 1.15 / t.gears;
    if (!input.freeRev && this.shiftLock === 0) {
      let next = this.gear;
      if (speed > this.gear * span && this.gear < t.gears) next++;
      if (speed < (this.gear - 1) * span - 0.07 && this.gear > 1) next--;
      if (next !== this.gear) {
        this.gear = next;
        this.shift = 0.13;
        this.shiftLock = 0.25;
      }
    }
    const band = Math.max(0, Math.min(1, (speed - (this.gear - 1) * span) / span));
    const driven = speed < 0.025 ? 0 : 0.28 + band * 0.61 + throttle * 0.08;
    const rev = input.freeRev ? throttle * 0.94 : driven;
    let target = t.idle + (t.redline - t.idle) * Math.min(1, rev);
    if (input.stunned) target = t.idle * 0.85;
    const rate = target > this.rpm ? t.response : t.response * 0.65;
    this.rpm += (target - this.rpm) * (1 - Math.exp(-rate * dt));
    this.rpm = Math.max(t.idle * 0.8, Math.min(t.redline, this.rpm));
  }
}
