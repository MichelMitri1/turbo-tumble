/**
 * Controllers: two keyboard layouts and any number of gamepads (PS4 layout, FC "classic"
 * buttons). Each device gives a stick (screen space) and buttons; main.ts turns the stick
 * into pitch directions for the current camera.
 *
 *  PS4: L-stick move · R2 sprint · ✕ pass / contain · ○ shoot / tackle · □ lob, cross / slide
 *       △ through ball · R1 finesse · L1 chip / switch player · R3 knock-on · OPTIONS pause
 */

export interface Pad {
  sx: number;
  sy: number;
  sprint: boolean;
  pass: boolean;
  shoot: boolean;
  through: boolean;
  lob: boolean;
  finesse: boolean;
  chip: boolean;
  switch: boolean;
  skill: boolean;
  pause: boolean;
}

export type DeviceId = 'kb1' | 'kb2' | `pad${number}`;

export const KEY_LAYOUTS: Record<'kb1' | 'kb2', Record<keyof Omit<Pad, 'sx' | 'sy'> | 'up' | 'down' | 'left' | 'right', string[]>> = {
  kb1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], sprint: ['ShiftLeft'], pass: ['KeyJ'], shoot: ['KeyK'], through: ['KeyL'], lob: ['KeyI'], finesse: ['KeyU'], chip: ['KeyO'], switch: ['KeyQ'], skill: ['KeyE'], pause: ['Escape'] },
  kb2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], sprint: ['ShiftRight'], pass: ['Comma', 'Numpad1'], shoot: ['Period', 'Numpad2'], through: ['Slash', 'Numpad3'], lob: ['Semicolon', 'Numpad5'], finesse: ['Quote', 'Numpad4'], chip: ['KeyP', 'Numpad6'], switch: ['KeyM', 'Numpad0'], skill: ['KeyN', 'NumpadAdd'], pause: ['Backspace'] },
};

const down = new Set<string>();
let installed = false;
export function installKeys(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    down.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Quote' || e.code === 'Slash') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());
}

const any = (codes: string[]) => codes.some((c) => down.has(c));

export function readKeyboard(id: 'kb1' | 'kb2'): Pad {
  const L = KEY_LAYOUTS[id];
  let sx = (any(L.right) ? 1 : 0) - (any(L.left) ? 1 : 0);
  let sy = (any(L.up) ? 1 : 0) - (any(L.down) ? 1 : 0);
  if (sx && sy) {
    sx *= Math.SQRT1_2;
    sy *= Math.SQRT1_2;
  }
  return { sx, sy, sprint: any(L.sprint), pass: any(L.pass), shoot: any(L.shoot), through: any(L.through), lob: any(L.lob), finesse: any(L.finesse), chip: any(L.chip), switch: any(L.switch), skill: any(L.skill), pause: any(L.pause) };
}

export function connectedPads(): number[] {
  const out: number[] = [];
  for (const g of navigator.getGamepads?.() ?? []) if (g && g.connected) out.push(g.index);
  return out;
}

export function readPad(index: number): Pad | null {
  const g = navigator.getGamepads?.()[index];
  if (!g) return null;
  const b = (i: number) => !!g.buttons[i]?.pressed;
  const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
  let sx = dz(g.axes[0] ?? 0);
  let sy = -dz(g.axes[1] ?? 0);
  // D-pad works too.
  if (b(15)) sx = 1;
  if (b(14)) sx = -1;
  if (b(12)) sy = 1;
  if (b(13)) sy = -1;
  const l = Math.hypot(sx, sy);
  if (l > 1) {
    sx /= l;
    sy /= l;
  }
  const rsy = -(g.axes[3] ?? 0);
  return { sx, sy, sprint: b(7), pass: b(0), shoot: b(1), lob: b(2), through: b(3), finesse: b(5), chip: b(4), switch: b(4), skill: b(11) || rsy > 0.8, pause: b(9) };
}

export function readDevice(id: DeviceId): Pad {
  if (id === 'kb1' || id === 'kb2') return readKeyboard(id);
  return readPad(Number(id.slice(3))) ?? { sx: 0, sy: 0, sprint: false, pass: false, shoot: false, through: false, lob: false, finesse: false, chip: false, switch: false, skill: false, pause: false };
}

export function deviceName(id: DeviceId): string {
  if (id === 'kb1') return 'Keyboard (WASD)';
  if (id === 'kb2') return 'Keyboard (Arrows)';
  const g = navigator.getGamepads?.()[Number(id.slice(3))];
  const n = g?.id ?? 'Controller';
  return /054c|dualshock|wireless controller|playstation|dualsense/i.test(n) ? 'PS Controller' : /xbox|045e|xinput/i.test(n) ? 'Xbox Controller' : 'Controller';
}
