/** Logical actions a player can perform. Devices map physical inputs onto these. */
export type InputAction = 'accelerate' | 'brake' | 'left' | 'right' | 'drift' | 'item' | 'reset' | 'pause';

export const INPUT_ACTIONS: readonly InputAction[] = ['accelerate', 'brake', 'left', 'right', 'drift', 'item', 'reset', 'pause'];

/** Keyboard binding: action → list of KeyboardEvent.code values. */
export type KeyboardBindings = Record<InputAction, string[]>;

/** Keyboard profiles let up to two players share one keyboard. */
export type KeyboardProfileId = 'full' | 'left' | 'right';

export const DEFAULT_KEYBOARD_PROFILES: Record<KeyboardProfileId, KeyboardBindings> = {
  // Single player: both clusters work.
  full: {
    accelerate: ['KeyW', 'ArrowUp'],
    brake: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    drift: ['Space'],
    item: ['ShiftLeft', 'ShiftRight'],
    reset: ['KeyR'],
    pause: ['Escape'],
  },
  // Shared keyboard, left-hand player.
  left: {
    accelerate: ['KeyW'],
    brake: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    drift: ['Space'],
    item: ['ShiftLeft'],
    reset: ['KeyR'],
    pause: ['Escape'],
  },
  // Shared keyboard, right-hand player.
  right: {
    accelerate: ['ArrowUp'],
    brake: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    drift: ['Slash', 'Numpad0'],
    item: ['ShiftRight', 'Period'],
    reset: ['Backspace'],
    pause: ['Escape'],
  },
};

/** Gamepad binding: action → list of standard-mapping button indices. */
export type GamepadBindings = Record<InputAction, number[]>;

/**
 * Standard mapping (https://w3c.github.io/gamepad/#remapping):
 * 0 A/Cross, 1 B/Circle, 2 X/Square, 3 Y/Triangle, 4 LB, 5 RB, 6 LT, 7 RT,
 * 8 View/Share, 9 Menu/Options, 12–15 D-pad up/down/left/right.
 */
export const DEFAULT_GAMEPAD_BINDINGS: GamepadBindings = {
  accelerate: [0, 7],
  brake: [1, 6],
  left: [14],
  right: [15],
  drift: [5, 2],
  item: [4, 3],
  reset: [8],
  pause: [9],
};

const STORAGE_KEY = 'turbo-tumble.bindings.v1';

interface StoredBindings {
  keyboard?: Partial<Record<KeyboardProfileId, Partial<KeyboardBindings>>>;
  gamepad?: Partial<GamepadBindings>;
  deadZone?: number;
}

function readStored(): StoredBindings {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as StoredBindings;
  } catch {
    return {};
  }
}

export function loadKeyboardBindings(profile: KeyboardProfileId): KeyboardBindings {
  const stored = readStored().keyboard?.[profile] ?? {};
  return { ...DEFAULT_KEYBOARD_PROFILES[profile], ...stored };
}

export function loadGamepadBindings(): GamepadBindings {
  return { ...DEFAULT_GAMEPAD_BINDINGS, ...(readStored().gamepad ?? {}) };
}

export function saveKeyboardBindings(profile: KeyboardProfileId, bindings: KeyboardBindings): void {
  const s = readStored();
  s.keyboard = { ...s.keyboard, [profile]: bindings };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) — bindings stay session-only */
  }
}

export function saveGamepadBindings(bindings: GamepadBindings): void {
  const s = readStored();
  s.gamepad = bindings;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function resetBindings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadDeadZone(fallback: number): number {
  const v = readStored().deadZone;
  return typeof v === 'number' && v >= 0 && v < 0.6 ? v : fallback;
}

export function saveDeadZone(value: number): void {
  const s = readStored();
  s.deadZone = value;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** Human-readable label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  const names: Record<string, string> = { Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', Escape: 'Esc', Slash: '/', Period: '.', Backspace: 'Bksp', Enter: 'Enter', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt' };
  return names[code] ?? code;
}

/** Standard-mapping button names (Xbox / PlayStation). */
export function buttonLabel(index: number): string {
  const names = ['A / ✕', 'B / ○', 'X / □', 'Y / △', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'View / Share', 'Menu / Options', 'L-Stick', 'R-Stick', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home'];
  return names[index] ?? `Button ${index}`;
}
