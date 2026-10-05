import type { GamepadBindings, InputAction } from './bindings';

export interface StickSettings {
  /** Radial inner dead zone (0..1). */
  deadZone: number;
  /** Outer saturation (values beyond count as full deflection). */
  outerZone: number;
}

export const DEFAULT_STICK: StickSettings = { deadZone: 0.16, outerZone: 0.95 };

/** Snapshot + edge tracking for one connected gamepad slot. */
export class GamepadState {
  connected = false;
  id = '';
  mapping = '';
  private buttons: number[] = [];
  private prevButtons: number[] = [];
  private axes: number[] = [];
  private prevAxes: number[] = [];
  lastActivity = 0;

  constructor(readonly index: number) {}

  poll(pad: Gamepad | null): void {
    this.prevButtons = this.buttons;
    this.prevAxes = this.axes;
    if (!pad || !pad.connected) {
      this.connected = false;
      this.buttons = [];
      this.axes = [];
      return;
    }
    this.connected = true;
    this.id = pad.id;
    this.mapping = pad.mapping;
    this.buttons = pad.buttons.map((b) => (typeof b === 'object' ? b.value || (b.pressed ? 1 : 0) : Number(b)));
    this.axes = [...pad.axes];
    if (this.buttons.some((v, i) => v > 0.5 && !((this.prevButtons[i] ?? 0) > 0.5)) || this.axes.some((a) => Math.abs(a) > 0.5)) {
      this.lastActivity = performance.now();
    }
  }

  button(i: number): number {
    return this.buttons[i] ?? 0;
  }

  buttonPressed(i: number): boolean {
    return (this.buttons[i] ?? 0) > 0.5 && !((this.prevButtons[i] ?? 0) > 0.5);
  }

  /** Left stick flicked past 0.6 in a direction this frame (menu navigation). */
  stickPressed(dir: 'up' | 'down' | 'left' | 'right'): boolean {
    const axis = dir === 'left' || dir === 'right' ? 0 : 1;
    const sign = dir === 'left' || dir === 'up' ? -1 : 1;
    const now = (this.axes[axis] ?? 0) * sign;
    const before = (this.prevAxes[axis] ?? 0) * sign;
    return now > 0.6 && before <= 0.6;
  }

  anyButtonPressed(): boolean {
    return this.buttons.some((_, i) => this.buttonPressed(i));
  }

  /** Left stick X with radial dead zone and rescaling. */
  steer(stick: StickSettings = DEFAULT_STICK): number {
    const x = this.axes[0] ?? 0;
    const y = this.axes[1] ?? 0;
    const mag = Math.hypot(x, y);
    if (mag < stick.deadZone) return 0;
    const scaled = Math.min(1, (mag - stick.deadZone) / (stick.outerZone - stick.deadZone));
    return (x / mag) * scaled;
  }

  /** Analog value of an action (max over its bound buttons). */
  value(bindings: GamepadBindings, action: InputAction): number {
    let v = 0;
    for (const b of bindings[action]) v = Math.max(v, this.button(b));
    return v;
  }

  pressed(bindings: GamepadBindings, action: InputAction): boolean {
    return bindings[action].some((b) => this.buttonPressed(b));
  }
}
