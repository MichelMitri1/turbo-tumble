/**
 * Controllers: two keyboard layouts and any number of gamepads (PS4 layout, FC "classic"
 * buttons). Each device gives a stick (screen space) and buttons; main.ts turns the stick
 * into pitch directions for the current camera.
 *
 *  PS4: L-stick move · R2 sprint · ✕ pass / contain · ○ shoot / tackle · □ lob, cross / slide
 *       △ through ball · R1 finesse · L1 chip / switch player · R1+L1+○ power shot · R3 knock-on
 *       L2 (held at a free kick / penalty / corner) pick the taker with ◀ ▶ · OPTIONS pause
 *       Right stick: skill-move combos (see SKILL_GUIDE); facing a penalty, flick it left / right to dive.
 */

let equippedSkill = 3;
export const getEquippedSkill = () => equippedSkill;
export const equipSkill = (id: number) => { if (id >= 1 && id <= 100) equippedSkill = id; };

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
  /** L2: held at our set piece to pick the taker (stick / d-pad left-right cycles). */
  l2: boolean;
  /** Skill move just completed on the right stick / keys (TRICKS index in sim/match, 0 = none). */
  trick: number;
  /** Right stick (screen space): the penalty dive. */
  rx: number;
  ry: number;
}

/** The skill-move guide: right-stick combo (↑ = up on the stick), keyboard keys (P1 · P2), TRICKS index. */
export const SKILL_GUIDE: Array<[string, string, string, number]> = [
  ['Step-over', '← → (or → ←)', '1 · 7', 3],
  ['Roulette', 'Roll a full circle', '2 · 8', 6],
  ['Rainbow flick', '↓ ↑ ↑', '3 · 9', 5],
  ['Flick up', '↑ ↓', '4 · 0', 4],
  ['Drag back', '↓', '5 · -', 2],
  ['Ball roll', '← ← (or → →)', '6 · =', 7],
  ['Knock-on', '↑ (or R3)', 'E · N', 1],
];
/** Right-stick token sequences → skill (U D L R as on screen). */
const COMBOS = new Map<string, number>([
  ['DUU', 5],
  ['UD', 4],
  ['LR', 3],
  ['RL', 3],
  ['LL', 7],
  ['RR', 7],
  ['D', 2],
  ['U', 1],
  ...['URDL', 'ULDR', 'RDLU', 'LDRU', 'DRUL', 'DLUR', 'RULD', 'LURD', 'URD', 'ULD', 'DRU', 'DLU', 'RDL', 'LDR', 'RUL', 'LUR'].map((s) => [s, 6] as [string, number]),
]);
interface Combo {
  seq: string;
  dir: string;
  at: number;
  out: number;
  until: number;
}
const combos = new Map<string, Combo>();
/** Feed the right stick each frame; returns a skill index for a moment once a combo completes. */
function comboTick(id: string, x: number, y: number): number {
  const now = performance.now();
  let c = combos.get(id);
  if (!c) combos.set(id, (c = { seq: '', dir: '', at: 0, out: 0, until: 0 }));
  const m = Math.hypot(x, y);
  const tok = m > 0.7 ? (Math.abs(x) > Math.abs(y) ? (x > 0 ? 'R' : 'L') : y > 0 ? 'U' : 'D') : m < 0.35 ? '' : c.dir;
  if (tok && tok !== c.dir) {
    c.seq = (c.seq + tok).slice(-4);
    c.at = now;
  }
  c.dir = tok;
  // Back in the middle and nothing more for a beat: that's the combo.
  if (c.seq && !tok && now - c.at > 240) {
    c.out = COMBOS.get(c.seq) ?? COMBOS.get(c.seq.slice(-3)) ?? 0;
    c.until = now + 130;
    c.seq = '';
  }
  return now < c.until ? c.out : 0;
}

export type DeviceId = 'kb1' | 'kb2' | `pad${number}`;

type KeyAction = keyof Omit<Pad, 'sx' | 'sy' | 'trick' | 'rx' | 'ry'> | 'up' | 'down' | 'left' | 'right' | 't2' | 't3' | 't4' | 't5' | 't6' | 't7' | 'diveL' | 'diveR';
export const KEY_LAYOUTS: Record<'kb1' | 'kb2', Record<KeyAction, string[]>> = {
  kb1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], sprint: ['ShiftLeft'], pass: ['KeyJ'], shoot: ['KeyK'], through: ['KeyL'], lob: ['KeyI'], finesse: ['KeyU'], chip: ['KeyO'], switch: ['KeyQ'], skill: ['KeyE'], pause: ['Escape'], l2: ['KeyF'], t3: ['Digit1'], t6: ['Digit2'], t5: ['Digit3'], t4: ['Digit4'], t2: ['Digit5'], t7: ['Digit6'], diveL: ['KeyZ'], diveR: ['KeyC'] },
  kb2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], sprint: ['ShiftRight'], pass: ['Comma', 'Numpad1'], shoot: ['Period', 'Numpad2'], through: ['Slash', 'Numpad3'], lob: ['Semicolon', 'Numpad5'], finesse: ['Quote', 'Numpad4'], chip: ['KeyP', 'Numpad6'], switch: ['KeyM', 'Numpad0'], skill: ['KeyN', 'NumpadAdd'], pause: ['Backspace'], l2: ['Enter', 'NumpadEnter'], t3: ['Digit7'], t6: ['Digit8'], t5: ['Digit9'], t4: ['Digit0'], t2: ['Minus'], t7: ['Equal'], diveL: ['BracketLeft'], diveR: ['BracketRight'] },
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
  const trick = down.has(id === 'kb1' ? 'KeyT' : 'KeyB') ? equippedSkill : ([2, 3, 4, 5, 6, 7] as const).find((k) => any(L[`t${k}`])) ?? 0;
  const rx = (any(L.diveR) ? 1 : 0) - (any(L.diveL) ? 1 : 0);
  return { sx, sy, sprint: any(L.sprint), pass: any(L.pass), shoot: any(L.shoot), through: any(L.through), lob: any(L.lob), finesse: any(L.finesse), chip: any(L.chip), switch: any(L.switch), skill: any(L.skill), pause: any(L.pause), l2: any(L.l2), trick, rx, ry: 0 };
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
  const rsx = g.axes[2] ?? 0;
  const rsy = -(g.axes[3] ?? 0);
  const trick = b(6) && b(11) ? equippedSkill : comboTick(`pad${index}`, rsx, rsy);
  return { sx, sy, sprint: b(7), pass: b(0), shoot: b(1), lob: b(2), through: b(3), finesse: b(5), chip: b(4), switch: b(4), skill: b(11) && !b(6), pause: b(9), l2: b(6) || (g.buttons[6]?.value ?? 0) > 0.5, trick, rx: Math.abs(rsx) > 0.5 ? rsx : 0, ry: rsy };
}

export function readDevice(id: DeviceId): Pad {
  if (id === 'kb1' || id === 'kb2') return readKeyboard(id);
  return readPad(Number(id.slice(3))) ?? { sx: 0, sy: 0, sprint: false, pass: false, shoot: false, through: false, lob: false, finesse: false, chip: false, switch: false, skill: false, pause: false, l2: false, trick: 0, rx: 0, ry: 0 };
}

export function deviceName(id: DeviceId): string {
  if (id === 'kb1') return 'Keyboard (WASD)';
  if (id === 'kb2') return 'Keyboard (Arrows)';
  const g = navigator.getGamepads?.()[Number(id.slice(3))];
  const n = g?.id ?? 'Controller';
  return /054c|dualshock|wireless controller|playstation|dualsense/i.test(n) ? 'PS Controller' : /xbox|045e|xinput/i.test(n) ? 'Xbox Controller' : 'Controller';
}
