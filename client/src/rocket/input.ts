import type { Controls } from './sim/car';

/**
 * Rocket League default bindings.
 *
 * PS4 (Gamepad API "standard" layout):
 *   R2 throttle · L2 reverse · Left stick steer / pitch / yaw
 *   ✕ jump · ○ boost · □ powerslide + air roll · △ ball cam
 *   R3 rear view · Right stick camera swivel · L1 / touchpad scoreboard
 *   OPTIONS pause · D-pad quick chat
 *
 * Keyboard + mouse:
 *   W / S throttle & reverse (pitch in the air) · A / D steer (yaw in the air)
 *   Right mouse jump · Left mouse boost · Left Shift powerslide / air roll
 *   Q / E air roll left / right · Space ball cam · Tab scoreboard · Esc pause
 *   1–4 quick chat · H rear view
 */
export const PAD = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, share: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, ps: 16, touchpad: 17 } as const;

export interface UiInput {
  ballCamToggle: boolean;
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

const DEADZONE = 0.12;
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (Math.sign(v) * (Math.abs(v) - DEADZONE)) / (1 - DEADZONE));
const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export class Input {
  private readonly keys = new Set<string>();
  private mouseL = false;
  private mouseR = false;
  private prevPad: boolean[] = [];
  private pressedKeys = new Set<string>();
  private chatGroup = -1;
  private chatTimer = 0;
  device: 'pad' | 'kb' = 'kb';
  /** True while a match is on screen (prevents page scroll etc.). */
  active = false;
  padName = '';

  constructor(el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
      this.device = 'kb';
      if (this.active && ['Space', 'Tab', 'ShiftLeft', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouseL = this.mouseR = false;
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 0) this.mouseL = true;
      if (e.button === 2) this.mouseR = true;
      this.device = 'kb';
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseL = false;
      if (e.button === 2) this.mouseR = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && p.connected && p.buttons.length >= 16) return p;
    return null;
  }

  get hasPad(): boolean {
    return !!this.pad();
  }

  /** Sample controls + UI actions for this frame. `airborne` switches the stick to air control. */
  poll(dt: number): { controls: Controls; ui: UiInput } {
    const k = (c: string) => this.keys.has(c);
    const pressed = (c: string) => this.pressedKeys.has(c);
    const p = this.pad();
    const btn = (i: number) => !!p?.buttons[i]?.pressed;
    const val = (i: number) => p?.buttons[i]?.value ?? 0;
    const edge = (i: number) => btn(i) && !this.prevPad[i];

    // Keyboard.
    let throttle = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    let steer = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let pitch = -throttle;
    let jump = this.mouseR;
    let boost = this.mouseL;
    let airRoll = k('ShiftLeft') || k('ShiftRight');
    let rollDir = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0);
    let swivelX = 0;
    let swivelY = 0;
    const ui: UiInput = {
      ballCamToggle: pressed('Space'),
      rearView: k('KeyH'),
      scoreboard: k('Tab'),
      pause: pressed('Escape') || pressed('KeyP'),
      chat: null,
      chatGroup: -1,
      swivelX: 0,
      swivelY: 0,
      device: this.device,
    };

    // Gamepad.
    if (p) {
      const lx = dz(p.axes[0] ?? 0);
      const ly = dz(p.axes[1] ?? 0);
      const rx = dz(p.axes[2] ?? 0);
      const ry = dz(p.axes[3] ?? 0);
      const any = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0 || p.buttons.some((b) => b.pressed);
      if (any) this.device = 'pad';
      this.padName = p.id;
      const padThrottle = val(PAD.r2) - val(PAD.l2);
      if (Math.abs(padThrottle) > 0.02) throttle = padThrottle;
      if (lx) steer = lx;
      // Stick up (negative axis) = nose down, exactly like the game.
      if (ly) pitch = ly;
      jump ||= btn(PAD.cross);
      boost ||= btn(PAD.circle);
      airRoll ||= btn(PAD.square);
      swivelX = rx;
      swivelY = -ry;
      if (edge(PAD.triangle)) ui.ballCamToggle = true;
      ui.rearView ||= btn(PAD.r3);
      ui.scoreboard ||= btn(PAD.l1) || btn(PAD.touchpad);
      if (edge(PAD.options)) ui.pause = true;
      // Quick chat on the D-pad: direction picks the group, a second press picks the message.
      for (const d of [PAD.up, PAD.left, PAD.right, PAD.down]) {
        if (!edge(d)) continue;
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
    // Keyboard quick chat: 1–4 then 1–4.
    for (const [code, i] of Object.entries(KEY_INDEX)) {
      if (!pressed(code)) continue;
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
    ui.chatGroup = this.chatGroup;
    ui.swivelX = swivelX;
    ui.swivelY = swivelY;
    ui.device = this.device;
    this.pressedKeys.clear();

    // Air roll: with the button held, steering rolls instead of yawing.
    const yaw = airRoll ? 0 : steer;
    const roll = airRoll ? steer : rollDir;
    if (rollDir && airRoll) rollDir = 0;
    const controls: Controls = {
      throttle: clamp(throttle),
      steer: clamp(steer),
      pitch: clamp(pitch),
      yaw: clamp(yaw),
      roll: clamp(roll || rollDir),
      jump,
      boost,
      handbrake: airRoll,
    };
    return { controls, ui };
  }

  /** Menu navigation with a controller: stick / D-pad move focus, ✕ clicks, ○ goes back. */
  pollMenu(root: HTMLElement, onBack: () => void): void {
    const p = this.pad();
    if (!p) return;
    const btn = (i: number) => !!p.buttons[i]?.pressed;
    const edge = (i: number) => btn(i) && !this.prevPad[i];
    const ly = p.axes[1] ?? 0;
    const lx = p.axes[0] ?? 0;
    const stickDir = Math.abs(ly) > 0.6 ? (ly > 0 ? 'down' : 'up') : Math.abs(lx) > 0.6 ? (lx > 0 ? 'right' : 'left') : '';
    const dir = edge(PAD.up) ? 'up' : edge(PAD.down) ? 'down' : edge(PAD.left) ? 'left' : edge(PAD.right) ? 'right' : stickDir && stickDir !== this.lastStick ? stickDir : '';
    this.lastStick = stickDir;
    if (dir) {
      this.device = 'pad';
      const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input, [data-nav]')].filter((e) => e.offsetParent !== null);
      const cur = document.activeElement as HTMLElement | null;
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
      }
    }
    if (edge(PAD.cross)) (document.activeElement as HTMLElement | null)?.click();
    if (edge(PAD.circle) || edge(PAD.options)) onBack();
    this.prevPad = p.buttons.map((b) => b.pressed);
  }
  private lastStick = '';

  /** Rumble (DualShock 4 via Chrome's vibrationActuator). */
  rumble(strong: number, weak: number, ms: number): void {
    const p = this.pad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null;
    void p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => undefined);
  }
}
