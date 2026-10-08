import type { PlayerInput } from '@shared/types/input';
import { clamp } from '@shared/math/scalar';
import { MAX_LOCAL_PLAYERS } from '@shared/constants/simulation';
import {
  DEFAULT_GAMEPAD_BINDINGS,
  DEFAULT_KEYBOARD_PROFILES,
  loadDeadZone,
  loadGamepadBindings,
  loadKeyboardBindings,
  resetBindings,
  saveDeadZone,
  saveGamepadBindings,
  saveKeyboardBindings,
  type GamepadBindings,
  type InputAction,
  type KeyboardBindings,
  type KeyboardProfileId,
} from './bindings';
import { KeyboardState } from './KeyboardState';
import { TouchControls } from './TouchControls';
import { DEFAULT_STICK, GamepadState, type StickSettings } from './GamepadState';

export const sameDevice = (a: DeviceAssignment, b: DeviceAssignment): boolean =>
  a.kind === b.kind && (a.kind !== 'gamepad' || a.index === (b as { index: number }).index) && (a.kind !== 'keyboard' || a.profile === (b as { profile: string }).profile);

export function deviceLabel(a: DeviceAssignment): string {
  if (a.kind === 'gamepad') return `Controller ${a.index + 1}`;
  if (a.kind === 'keyboard') return a.profile === 'left' ? 'Keyboard (WASD)' : a.profile === 'right' ? 'Keyboard (Arrows)' : 'Keyboard';
  return 'Any device';
}

/** Which physical device(s) drive a local player. */
export type DeviceAssignment =
  | { kind: 'keyboard'; profile: KeyboardProfileId }
  | { kind: 'gamepad'; index: number }
  /** Keyboard (full profile) + every gamepad: the single-player default. */
  | { kind: 'any' };

export interface MenuNav {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
}

/** A player's view of their assigned device(s). */
export interface InputSource {
  readonly assignment: DeviceAssignment;
  /** Fill `out` with the current analog/digital state. */
  read(out: PlayerInput): PlayerInput;
  /** True if `action` was pressed this frame. */
  pressed(action: InputAction): boolean;
  /** Raw debug description of the device state. */
  describe(): string;
}

const GAMEPAD_SLOTS = 4;

/**
 * Polls keyboard + Gamepad API once per frame and hands out per-player input
 * sources. Supports mixing keyboard profiles and up to four controllers.
 */
export class InputManager {
  readonly touch = new TouchControls('race');
  readonly keyboard = new KeyboardState();
  readonly gamepads: GamepadState[] = Array.from({ length: GAMEPAD_SLOTS }, (_, i) => new GamepadState(i));
  stick: StickSettings = { ...DEFAULT_STICK, deadZone: loadDeadZone(DEFAULT_STICK.deadZone) };
  private readonly keyboardBindings = new Map<KeyboardProfileId, KeyboardBindings>();
  gamepadBindings: GamepadBindings = loadGamepadBindings();
  private buttonCapture: ((button: number) => void) | null = null;

  constructor() {
    for (const p of ['full', 'left', 'right'] as const) this.keyboardBindings.set(p, loadKeyboardBindings(p));
  }

  /** Call once at the start of every frame. */
  update(): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (let i = 0; i < GAMEPAD_SLOTS; i++) this.gamepads[i]!.poll(pads[i] ?? null);
    if (this.buttonCapture) {
      for (const g of this.gamepads) {
        if (!g.connected) continue;
        for (let b = 0; b < 17; b++) {
          if (g.buttonPressed(b)) {
            const cb = this.buttonCapture;
            this.buttonCapture = null;
            cb(b);
            return;
          }
        }
      }
    }
  }

  /** Capture the next controller button (rebinding UI). */
  captureNextButton(cb: ((button: number) => void) | null): void {
    this.buttonCapture = cb;
  }

  /** Rebind one gamepad action to a single button (all controllers share the mapping). */
  rebindButton(action: InputAction, button: number): void {
    this.gamepadBindings = { ...this.gamepadBindings, [action]: [button] };
    saveGamepadBindings(this.gamepadBindings);
  }

  setDeadZone(value: number): void {
    this.stick = { ...this.stick, deadZone: value };
    saveDeadZone(value);
  }

  /** Restore every binding and the dead zone to defaults. */
  resetAll(): void {
    resetBindings();
    for (const p of ['full', 'left', 'right'] as const) this.keyboardBindings.set(p, { ...DEFAULT_KEYBOARD_PROFILES[p] });
    this.gamepadBindings = { ...DEFAULT_GAMEPAD_BINDINGS };
    this.stick = { ...DEFAULT_STICK };
  }

  /** Call once at the end of every frame (clears pressed-this-frame edges). */
  endFrame(): void {
    this.touch.endFrame();
    this.keyboard.endFrame();
  }

  connectedGamepads(): GamepadState[] {
    return this.gamepads.filter((g) => g.connected);
  }

  bindings(profile: KeyboardProfileId): KeyboardBindings {
    return this.keyboardBindings.get(profile)!;
  }

  /** Rebind one action of a keyboard profile to a single key and persist it. */
  rebindKey(profile: KeyboardProfileId, action: InputAction, code: string): void {
    const b = { ...this.bindings(profile), [action]: [code] };
    this.keyboardBindings.set(profile, b);
    saveKeyboardBindings(profile, b);
  }

  /** For the "Player N — press any button" join screen. */
  detectJoin(): DeviceAssignment | null {
    for (const g of this.gamepads) if (g.connected && g.anyButtonPressed()) return { kind: 'gamepad', index: g.index };
    const kb = this.keyboard;
    const left = this.bindings('left');
    const right = this.bindings('right');
    if (Object.values(left).some((codes) => codes.some((c) => kb.wasPressed(c)))) return { kind: 'keyboard', profile: 'left' };
    if (Object.values(right).some((codes) => codes.some((c) => kb.wasPressed(c)))) return { kind: 'keyboard', profile: 'right' };
    return null;
  }

  /** Device-agnostic menu navigation edges for this frame (any keyboard / any pad). */
  menuNav(): MenuNav {
    const kb = this.keyboard;
    const pads = this.connectedGamepads();
    const nav = (g: GamepadState): MenuNav => this.padNav(g);
    const any = (k: keyof MenuNav): boolean => pads.some((g) => nav(g)[k]);
    return {
      up: kb.wasPressed('ArrowUp') || kb.wasPressed('KeyW') || any('up'),
      down: kb.wasPressed('ArrowDown') || kb.wasPressed('KeyS') || any('down'),
      left: kb.wasPressed('ArrowLeft') || kb.wasPressed('KeyA') || any('left'),
      right: kb.wasPressed('ArrowRight') || kb.wasPressed('KeyD') || any('right'),
      confirm: kb.wasPressed('Enter') || kb.wasPressed('Space') || any('confirm') || this.touch.pressed('item'),
      back: kb.wasPressed('Backspace') || any('back'),
    };
  }

  private padNav(g: GamepadState): MenuNav {
    return {
      up: g.buttonPressed(12) || g.stickPressed('up'),
      down: g.buttonPressed(13) || g.stickPressed('down'),
      left: g.buttonPressed(14) || g.stickPressed('left'),
      right: g.buttonPressed(15) || g.stickPressed('right'),
      confirm: g.buttonPressed(0),
      back: g.buttonPressed(1),
    };
  }

  /** Menu navigation from one player's device only (join screen, per-player picks). */
  navFor(a: DeviceAssignment): MenuNav {
    if (a.kind === 'gamepad') {
      const g = this.gamepads[a.index];
      return g?.connected ? this.padNav(g) : { up: false, down: false, left: false, right: false, confirm: false, back: false };
    }
    if (a.kind === 'any') return this.menuNav();
    const b = this.bindings(a.profile);
    const kb = this.keyboard;
    const hit = (codes: string[]): boolean => codes.some((c) => kb.wasPressed(c));
    return {
      up: hit(b.accelerate),
      down: hit(b.brake),
      left: hit(b.left),
      right: hit(b.right),
      confirm: hit(b.drift) || hit(b.item),
      back: hit(b.reset),
    };
  }

  createSource(assignment: DeviceAssignment): InputSource {
    return new ManagedSource(this, assignment);
  }

  get maxLocalPlayers(): number {
    return MAX_LOCAL_PLAYERS;
  }
}

class ManagedSource implements InputSource {
  constructor(
    private readonly mgr: InputManager,
    readonly assignment: DeviceAssignment,
  ) {}

  private keyboardProfile(): KeyboardProfileId | null {
    const a = this.assignment;
    return a.kind === 'keyboard' ? a.profile : a.kind === 'any' ? 'full' : null;
  }

  private pads(): GamepadState[] {
    const a = this.assignment;
    if (a.kind === 'gamepad') {
      const g = this.mgr.gamepads[a.index];
      return g && g.connected ? [g] : [];
    }
    return a.kind === 'any' ? this.mgr.connectedGamepads() : [];
  }

  read(out: PlayerInput): PlayerInput {
    let throttle = 0;
    let brake = 0;
    let steer = 0;
    let drift = false;
    let item = false;

    const profile = this.keyboardProfile();
    if (profile) {
      const kb = this.mgr.keyboard;
      const b = this.mgr.bindings(profile);
      const held = (action: InputAction): boolean => b[action].some((c) => kb.isDown(c));
      if (held('accelerate')) throttle = 1;
      if (held('brake')) brake = 1;
      steer += (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      drift ||= held('drift');
      item ||= held('item');
    }

    const gb = this.mgr.gamepadBindings;
    for (const g of this.pads()) {
      throttle = Math.max(throttle, g.value(gb, 'accelerate'));
      brake = Math.max(brake, g.value(gb, 'brake'));
      steer += g.steer(this.mgr.stick) + g.value(gb, 'right') - g.value(gb, 'left');
      drift ||= g.value(gb, 'drift') > 0.5;
      item ||= g.value(gb, 'item') > 0.5;
    }

    if (this.assignment.kind === 'any' && this.mgr.touch.active) {
      const t = this.mgr.touch;
      steer += t.x;
      brake = Math.max(brake, t.down('brake') ? 1 : Math.max(0, t.y));
      throttle = Math.max(throttle, brake > .1 ? 0 : t.autoDrive ? 1 : Math.max(0, -t.y));
      drift ||= t.down('drift');
      item ||= t.down('item') || t.pressed('item');
    }
    out.throttle = clamp(throttle, 0, 1);
    out.brake = clamp(brake, 0, 1);
    out.steer = clamp(steer, -1, 1);
    out.drift = drift;
    out.item = item;
    return out;
  }

  pressed(action: InputAction): boolean {
    if (this.assignment.kind === 'any' && this.mgr.touch.pressed(action)) return true;
    const profile = this.keyboardProfile();
    if (profile && this.mgr.bindings(profile)[action].some((c) => this.mgr.keyboard.wasPressed(c))) return true;
    return this.pads().some((g) => g.pressed(this.mgr.gamepadBindings, action));
  }

  describe(): string {
    const a = this.assignment;
    const pads = this.pads()
      .map((g) => `pad${g.index}`)
      .join('+');
    if (a.kind === 'any') return `keyboard${pads ? '+' + pads : ''}`;
    if (a.kind === 'keyboard') return `keyboard(${a.profile})`;
    return pads || `pad${a.index} (disconnected)`;
  }
}
