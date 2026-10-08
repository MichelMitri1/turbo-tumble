import type { Controls } from './sim/car';

/**
 * Rebindable input, Rocket League style. Defaults:
 *
 * PS4 (Gamepad API "standard" layout):
 *   R2 throttle · L2 reverse · Left stick steer / pitch / yaw
 *   ✕ jump · ○ boost · □ powerslide + air roll · L1 / R1 air roll left / right
 *   △ ball cam · R3 rear view · Right stick camera swivel · touchpad scoreboard
 *   OPTIONS pause · D-pad quick chat
 *
 * Keyboard + mouse:
 *   W / S throttle & reverse (pitch in the air) · A / D steer (yaw in the air)
 *   Right mouse jump · Left mouse boost · Left Shift powerslide / air roll
 *   Q / E air roll left / right · Space ball cam · Tab scoreboard · Esc pause
 *   1–4 quick chat · H rear view
 *
 * Sticks, pause (Esc / P / OPTIONS) and quick chat are fixed.
 */
export const PAD = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, share: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, ps: 16, touchpad: 17 } as const;

export type BindAction = 'throttle' | 'reverse' | 'steerLeft' | 'steerRight' | 'pitchUp' | 'pitchDown' | 'jump' | 'boost' | 'powerslide' | 'airRoll' | 'airRollLeft' | 'airRollRight' | 'ballCam' | 'rearView' | 'scoreboard';

/** Rebindable actions; `pad: false` = handled by the left stick on a controller. */
export const BIND_ACTIONS: ReadonlyArray<{ id: BindAction; label: string; pad: boolean }> = [
  { id: 'throttle', label: 'Drive forward', pad: true },
  { id: 'reverse', label: 'Reverse / brake', pad: true },
  { id: 'steerLeft', label: 'Steer left · Air yaw left', pad: false },
  { id: 'steerRight', label: 'Steer right · Air yaw right', pad: false },
  { id: 'pitchDown', label: 'Air pitch down (nose)', pad: false },
  { id: 'pitchUp', label: 'Air pitch up (nose)', pad: false },
  { id: 'jump', label: 'Jump · Dodge', pad: true },
  { id: 'boost', label: 'Boost', pad: true },
  { id: 'powerslide', label: 'Powerslide', pad: true },
  { id: 'airRoll', label: 'Air roll (free)', pad: true },
  { id: 'airRollLeft', label: 'Air roll left', pad: true },
  { id: 'airRollRight', label: 'Air roll right', pad: true },
  { id: 'ballCam', label: 'Ball cam', pad: true },
  { id: 'rearView', label: 'Rear view', pad: true },
  { id: 'scoreboard', label: 'Scoreboard', pad: true },
];

/** Up to two binds per action: keyboard codes ('KeyW', 'Mouse0'…) and gamepad button indices. */
export interface Bindings {
  kb: Record<BindAction, string[]>;
  pad: Record<BindAction, number[]>;
}

export const DEFAULT_BINDINGS: Bindings = {
  kb: {
    throttle: ['KeyW', 'ArrowUp'],
    reverse: ['KeyS', 'ArrowDown'],
    steerLeft: ['KeyA', 'ArrowLeft'],
    steerRight: ['KeyD', 'ArrowRight'],
    pitchDown: ['KeyW', 'ArrowUp'],
    pitchUp: ['KeyS', 'ArrowDown'],
    jump: ['Mouse2'],
    boost: ['Mouse0'],
    powerslide: ['ShiftLeft'],
    airRoll: ['ShiftLeft'],
    airRollLeft: ['KeyQ'],
    airRollRight: ['KeyE'],
    ballCam: ['Space'],
    rearView: ['KeyH'],
    scoreboard: ['Tab'],
  },
  pad: {
    throttle: [PAD.r2],
    reverse: [PAD.l2],
    steerLeft: [],
    steerRight: [],
    pitchDown: [],
    pitchUp: [],
    jump: [PAD.cross],
    boost: [PAD.circle],
    powerslide: [PAD.square],
    airRoll: [PAD.square],
    airRollLeft: [PAD.l1],
    airRollRight: [PAD.r1],
    ballCam: [PAD.triangle],
    rearView: [PAD.r3],
    scoreboard: [PAD.touchpad, PAD.share],
  },
};

export interface InputPrefs {
  binds: Bindings;
  /** Directional air roll: hold the button, or press once to keep rolling ("auto") until pressed again / landing. */
  airRollMode: 'hold' | 'toggle';
  /** Rocket League control settings. */
  steerSens: number;
  aerialSens: number;
  deadzone: number;
  dodgeDeadzone: number;
  vibration: boolean;
}

export const DEFAULT_PREFS: InputPrefs = { binds: DEFAULT_BINDINGS, airRollMode: 'hold', steerSens: 1, aerialSens: 1, deadzone: 0.12, dodgeDeadzone: 0.5, vibration: true };

/** Merge saved prefs over the defaults (keeps new actions bound after an update). */
export function sanitizePrefs(p: Partial<InputPrefs> | undefined): InputPrefs {
  const d = DEFAULT_PREFS;
  const kb = {} as Bindings['kb'];
  const pad = {} as Bindings['pad'];
  for (const a of BIND_ACTIONS) {
    kb[a.id] = [...DEFAULT_BINDINGS.kb[a.id]];
    pad[a.id] = [...DEFAULT_BINDINGS.pad[a.id]];
    const k = p?.binds?.kb?.[a.id];
    if (Array.isArray(k)) kb[a.id] = k.filter((x) => typeof x === 'string').slice(0, 2);
    const g = p?.binds?.pad?.[a.id];
    if (Array.isArray(g)) pad[a.id] = g.filter((x) => Number.isInteger(x)).slice(0, 2);
  }
  const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  return {
    binds: { kb, pad },
    airRollMode: p?.airRollMode === 'toggle' ? 'toggle' : 'hold',
    steerSens: num(p?.steerSens, d.steerSens),
    aerialSens: num(p?.aerialSens, d.aerialSens),
    deadzone: num(p?.deadzone, d.deadzone),
    dodgeDeadzone: num(p?.dodgeDeadzone, d.dodgeDeadzone),
    vibration: typeof p?.vibration === 'boolean' ? p.vibration : d.vibration,
  };
}

const PAD_NAMES = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'SHARE', 'OPTIONS', 'L3', 'R3', 'D-PAD ▲', 'D-PAD ▼', 'D-PAD ◀', 'D-PAD ▶', 'PS', 'TOUCHPAD'];
export const padLabel = (i: number) => PAD_NAMES[i] ?? `BUTTON ${i}`;
const MOUSE_NAMES = ['LEFT MOUSE', 'MIDDLE MOUSE', 'RIGHT MOUSE', 'MOUSE 4', 'MOUSE 5'];
const KEY_NAMES: Record<string, string> = { Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'TAB', CapsLock: 'CAPS', Enter: 'ENTER', Backquote: '`', MetaLeft: 'CMD', MetaRight: 'CMD' };
export function keyLabel(code: string): string {
  if (code.startsWith('Mouse')) return MOUSE_NAMES[Number(code.slice(5))] ?? code.toUpperCase();
  if (KEY_NAMES[code]) return KEY_NAMES[code]!;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code.toUpperCase();
}

export interface UiInput {
  ballCamToggle: boolean;
  /** Ball cam button currently held (hold mode). */
  ballCamHeld: boolean;
  rearView: boolean;
  scoreboard: boolean;
  pause: boolean;
  /** Quick chat: [group, choice] when a message is picked. */
  chat: [number, number] | null;
  /** Quick chat menu currently open (group) or -1. */
  chatGroup: number;
  swivelX: number;
  swivelY: number;
  /** Which device the player last used (for on-screen prompts). */
  device: 'pad' | 'kb';
  /** Latched directional air roll (toggle mode): −1 left, 1 right, 0 off. */
  autoRoll: number;
}

export const QUICK_CHAT: string[][] = [
  ['I got it!', 'Need boost!', 'Take the shot!', 'Defending...'],
  ['Nice shot!', 'Great pass!', 'Thanks!', 'What a save!'],
  ['OMG!', 'Noooo!', 'Wow!', 'Close one!'],
  ['$#@%!', 'No problem.', 'Whoops...', 'Sorry!'],
];
/** D-pad direction → group / choice index (up, left, right, down). */
const DIR_INDEX: Record<number, number> = { [PAD.up]: 0, [PAD.left]: 1, [PAD.right]: 2, [PAD.down]: 3 };
const KEY_INDEX: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 };

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
/** How long after a jump press the dodge deadzone applies (covers frames with no sim tick). */
const DODGE_WINDOW = 0.03;

export type Capture = { kind: 'kb'; done: (code: string | null) => void } | { kind: 'pad'; done: (button: number | null) => void };

export class Input {
  private readonly keys = new Set<string>();
  private readonly mouse = [false, false, false, false, false];
  private prevPad: boolean[] = [];
  private pressedKeys = new Set<string>();
  private chatGroup = -1;
  private chatTimer = 0;
  private autoRoll = 0;
  private jumpWasDown = false;
  private dodgeWindow = 0;
  device: 'pad' | 'kb' = 'kb';
  /** True while a match is on screen (prevents page scroll etc.). */
  active = false;
  padName = '';
  prefs: InputPrefs = DEFAULT_PREFS;
  /** Waiting for a key / button to bind. */
  capture: Capture | null = null;

  constructor(el: HTMLElement) {
    addEventListener(
      'keydown',
      (e) => {
        if (this.capture) {
          e.preventDefault();
          e.stopPropagation();
          const c = this.capture;
          if (c.kind === 'kb') {
            this.capture = null;
            c.done(e.code === 'Escape' ? null : e.code === 'Backspace' || e.code === 'Delete' ? '' : e.code);
          } else if (e.code === 'Escape' || e.code === 'Backspace' || e.code === 'Delete') {
            // -1 = clear the bind.
            this.capture = null;
            c.done(e.code === 'Escape' ? null : -1);
          }
          return;
        }
        if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
        if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);
        this.keys.add(e.code);
        this.device = 'kb';
        if (this.active && (['Space', 'Tab', 'ShiftLeft', 'ArrowUp', 'ArrowDown'].includes(e.code) || this.isBound(e.code))) e.preventDefault();
      },
      { capture: true },
    );
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.fill(false);
    });
    addEventListener(
      'mousedown',
      (e) => {
        if (this.capture?.kind === 'kb') {
          e.preventDefault();
          e.stopPropagation();
          const c = this.capture;
          this.capture = null;
          c.done(`Mouse${e.button}`);
        }
      },
      { capture: true },
    );
    el.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button < this.mouse.length) this.mouse[e.button] = true;
      this.device = 'kb';
      if (e.button === 1) e.preventDefault();
    });
    addEventListener('mouseup', (e) => {
      if (e.button < this.mouse.length) this.mouse[e.button] = false;
    });
    addEventListener('contextmenu', (e) => {
      if (this.active || this.capture) e.preventDefault();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private isBound(code: string): boolean {
    const kb = this.prefs.binds.kb;
    for (const a of BIND_ACTIONS) if (kb[a.id].includes(code)) return true;
    return false;
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && p.connected && p.buttons.length >= 16) return p;
    return null;
  }

  get hasPad(): boolean {
    return !!this.pad();
  }

  /** Cancel a latched air roll (call on landing). */
  resetAutoRoll(): void {
    this.autoRoll = 0;
  }

  /** Sample controls + UI actions for this frame. */
  poll(dt: number): { controls: Controls; ui: UiInput } {
    const pr = this.prefs;
    const kbDown = (c: string) => (c.startsWith('Mouse') ? !!this.mouse[Number(c.slice(5))] : this.keys.has(c));
    const kbEdge = (c: string) => !c.startsWith('Mouse') && this.pressedKeys.has(c);
    const p = this.pad();
    const btn = (i: number) => !!p?.buttons[i]?.pressed;
    const val = (i: number) => p?.buttons[i]?.value ?? 0;
    const edge = (i: number) => btn(i) && !this.prevPad[i];
    const kbAct = (a: BindAction) => pr.binds.kb[a].some(kbDown);
    const padAct = (a: BindAction) => !!p && pr.binds.pad[a].some(btn);
    const act = (a: BindAction) => kbAct(a) || padAct(a);
    // Mouse edges come from the held state of the previous frame.
    const mouseEdge = (a: BindAction) => pr.binds.kb[a].some((c) => c.startsWith('Mouse') && kbDown(c) && !this.prevMouse[Number(c.slice(5))]);
    const actEdge = (a: BindAction) => pr.binds.kb[a].some(kbEdge) || mouseEdge(a) || (!!p && pr.binds.pad[a].some(edge));
    const padVal = (a: BindAction) => (p ? Math.max(0, ...pr.binds.pad[a].map(val)) : 0);
    const padBound = new Set(Object.values(pr.binds.pad).flat());
    const kbBound = new Set(Object.values(pr.binds.kb).flat());

    // Keyboard.
    let throttle = (kbAct('throttle') ? 1 : 0) - (kbAct('reverse') ? 1 : 0);
    let steer = (kbAct('steerRight') ? 1 : 0) - (kbAct('steerLeft') ? 1 : 0);
    let pitch = (kbAct('pitchUp') ? 1 : 0) - (kbAct('pitchDown') ? 1 : 0);
    let stickMag = Math.abs(steer) + Math.abs(pitch);
    const jump = act('jump');
    const boost = act('boost');
    const powerslide = act('powerslide');
    const airRoll = act('airRoll');
    let swivelX = 0;
    let swivelY = 0;
    const ui: UiInput = {
      ballCamToggle: actEdge('ballCam'),
      ballCamHeld: act('ballCam'),
      rearView: act('rearView'),
      scoreboard: act('scoreboard'),
      pause: this.pressedKeys.has('Escape') || (this.pressedKeys.has('KeyP') && !kbBound.has('KeyP')),
      chat: null,
      chatGroup: -1,
      swivelX: 0,
      swivelY: 0,
      device: this.device,
      autoRoll: 0,
    };

    // Gamepad.
    if (p) {
      const dzv = Math.max(0, Math.min(0.9, pr.deadzone));
      const dz = (v: number) => (Math.abs(v) < dzv ? 0 : (Math.sign(v) * (Math.abs(v) - dzv)) / (1 - dzv));
      const lx = dz(p.axes[0] ?? 0);
      const ly = dz(p.axes[1] ?? 0);
      const rx = dz(p.axes[2] ?? 0);
      const ry = dz(p.axes[3] ?? 0);
      const any = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0 || p.buttons.some((b) => b.pressed);
      if (any) this.device = 'pad';
      this.padName = p.id;
      const padThrottle = padVal('throttle') - padVal('reverse');
      if (Math.abs(padThrottle) > 0.02) throttle = padThrottle;
      if (lx) steer = lx;
      // Stick up (negative axis) = nose down, exactly like the game.
      if (ly) pitch = ly;
      if (lx || ly) stickMag = Math.hypot(lx, ly);
      swivelX = rx;
      swivelY = -ry;
      if (edge(PAD.options)) ui.pause = true;
      // Quick chat on the D-pad (unless those buttons are bound): direction picks the group, a second press picks the message.
      for (const d of [PAD.up, PAD.left, PAD.right, PAD.down]) {
        if (!edge(d) || padBound.has(d)) continue;
        if (this.chatGroup < 0) {
          this.chatGroup = DIR_INDEX[d]!;
          this.chatTimer = 2.5;
        } else {
          ui.chat = [this.chatGroup, DIR_INDEX[d]!];
          this.chatGroup = -1;
        }
      }
      this.prevPad = p.buttons.map((b) => b.pressed);
    }
    // Keyboard quick chat: 1–4 then 1–4 (unless bound).
    for (const [code, i] of Object.entries(KEY_INDEX)) {
      if (!this.pressedKeys.has(code) || kbBound.has(code)) continue;
      if (this.chatGroup < 0) {
        this.chatGroup = i;
        this.chatTimer = 2.5;
      } else {
        ui.chat = [this.chatGroup, i];
        this.chatGroup = -1;
      }
    }
    if (this.chatGroup >= 0) {
      this.chatTimer -= dt;
      if (this.chatTimer <= 0) this.chatGroup = -1;
    }

    // Directional air roll: held, or latched on/off per press ("automatic").
    let rollDir: number;
    if (pr.airRollMode === 'toggle') {
      if (actEdge('airRollLeft')) this.autoRoll = this.autoRoll === -1 ? 0 : -1;
      if (actEdge('airRollRight')) this.autoRoll = this.autoRoll === 1 ? 0 : 1;
      rollDir = this.autoRoll;
    } else rollDir = (act('airRollRight') ? 1 : 0) - (act('airRollLeft') ? 1 : 0);
    ui.autoRoll = pr.airRollMode === 'toggle' ? this.autoRoll : 0;

    ui.chatGroup = this.chatGroup;
    ui.swivelX = swivelX;
    ui.swivelY = swivelY;
    ui.device = this.device;
    this.pressedKeys.clear();
    for (let i = 0; i < this.mouse.length; i++) this.prevMouse[i] = this.mouse[i]!;

    // Sensitivities (Rocket League scales then clamps).
    steer = clamp(steer * pr.steerSens);
    const air = pr.aerialSens;
    // Air roll: with the free air-roll button held, steering rolls instead of yawing.
    // Directional air roll overrides it (yaw stays on the stick).
    pitch = clamp(pitch * air);
    let yaw = clamp((airRoll ? 0 : steer) * air);
    let roll = rollDir || clamp((airRoll ? steer : 0) * air);

    // Dodge deadzone: a jump with the stick inside it is a double jump; outside it always dodges.
    if (jump && !this.jumpWasDown) this.dodgeWindow = DODGE_WINDOW;
    this.jumpWasDown = jump;
    if (this.dodgeWindow > 0) {
      this.dodgeWindow -= dt;
      if (stickMag < pr.dodgeDeadzone && !rollDir) pitch = yaw = roll = 0;
      else {
        const sum = Math.abs(pitch) + Math.abs(yaw) + Math.abs(roll);
        if (sum > 0 && sum < 0.5) {
          const k = 0.5 / sum + 1e-3;
          pitch *= k;
          yaw *= k;
          roll *= k;
        }
      }
    }

    const controls: Controls = {
      throttle: clamp(throttle),
      steer,
      pitch,
      yaw,
      roll: clamp(roll),
      jump,
      boost,
      handbrake: powerslide,
    };
    return { controls, ui };
  }
  private readonly prevMouse = [false, false, false, false, false];

  /** Menu navigation with a controller: stick / D-pad move focus, ✕ clicks, ○ goes back. */
  pollMenu(root: HTMLElement, onBack: () => void): void {
    const p = this.pad();
    if (!p) return;
    const btn = (i: number) => !!p.buttons[i]?.pressed;
    const edge = (i: number) => btn(i) && !this.prevPad[i];
    if (this.capture?.kind === 'pad') {
      const c = this.capture;
      for (let i = 0; i < p.buttons.length; i++) {
        if (!edge(i)) continue;
        this.capture = null;
        c.done(i === PAD.options ? null : i);
        break;
      }
      this.prevPad = p.buttons.map((b) => b.pressed);
      return;
    }
    const ly = p.axes[1] ?? 0;
    const lx = p.axes[0] ?? 0;
    const stickDir = Math.abs(ly) > 0.6 ? (ly > 0 ? 'down' : 'up') : Math.abs(lx) > 0.6 ? (lx > 0 ? 'right' : 'left') : '';
    const dir = edge(PAD.up) ? 'up' : edge(PAD.down) ? 'down' : edge(PAD.left) ? 'left' : edge(PAD.right) ? 'right' : stickDir && stickDir !== this.lastStick ? stickDir : '';
    this.lastStick = stickDir;
    if (dir) {
      this.device = 'pad';
      const cur = document.activeElement as HTMLElement | null;
      // Left / right on a slider nudges it.
      if (cur instanceof HTMLInputElement && cur.type === 'range' && (dir === 'left' || dir === 'right')) {
        if (dir === 'left') cur.stepDown();
        else cur.stepUp();
        cur.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, [data-nav]')].filter((e) => e.offsetParent !== null);
        if (!cur || !items.includes(cur)) items[0]?.focus();
        else {
          const r = cur.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          let best: HTMLElement | null = null;
          let bestD = Infinity;
          for (const it of items) {
            if (it === cur) continue;
            const q = it.getBoundingClientRect();
            const dx = q.left + q.width / 2 - cx;
            const dy = q.top + q.height / 2 - cy;
            const ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 : dx > 4;
            if (!ok) continue;
            const d = dir === 'up' || dir === 'down' ? Math.abs(dy) + Math.abs(dx) * 2 : Math.abs(dx) + Math.abs(dy) * 2;
            if (d < bestD) {
              bestD = d;
              best = it;
            }
          }
          best?.focus();
          best?.scrollIntoView({ block: 'nearest' });
        }
      }
    }
    if (edge(PAD.cross)) (document.activeElement as HTMLElement | null)?.click();
    if (edge(PAD.circle) || edge(PAD.options)) onBack();
    this.prevPad = p.buttons.map((b) => b.pressed);
  }
  private lastStick = '';

  /** Rumble (DualShock 4 via Chrome's vibrationActuator). */
  rumble(strong: number, weak: number, ms: number): void {
    if (!this.prefs.vibration) return;
    const p = this.pad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null;
    void p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => undefined);
  }
}
