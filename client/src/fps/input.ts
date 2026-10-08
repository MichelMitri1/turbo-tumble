/**
 * Controls with the classic CoD defaults.
 *
 * Keyboard + mouse: WASD move · Shift sprint · Space jump · C / Ctrl crouch (slide
 * while sprinting) · LMB fire · RMB aim · R reload · 1 / 2 / wheel swap · G grenade
 * (hold to cook) · V / E melee · 4 killstreak · Tab scoreboard · Esc menu.
 *
 * PS4 (CoD "Default"): L2 aim · R2 fire · R1 grenade · ✕ jump · ○ crouch / slide ·
 * □ reload · △ swap · L3 sprint · R3 melee · D-pad → killstreak · OPTIONS menu ·
 * touchpad scoreboard. Right stick looks (with aim assist).
 */
export interface FrameInput {
  dyaw: number;
  dpitch: number;
  mx: number;
  mz: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  ads: boolean;
  fire: boolean;
  reload: boolean;
  swap: boolean;
  slot: number;
  grenade: boolean;
  melee: boolean;
  streak: boolean;
  scoreboard: boolean;
  menu: boolean;
  pad: boolean;
}

export interface InputSettings {
  sens: number;
  adsSens: number;
  padSens: number;
  invert: boolean;
  aimAssist: boolean;
  toggleAds: boolean;
}
export const DEFAULT_INPUT: InputSettings = { sens: 1, adsSens: 0.8, padSens: 1, invert: false, aimAssist: true, toggleAds: false };

const PAD = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, share: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, touch: 17 };

export class FpsInput {
  settings: InputSettings = { ...DEFAULT_INPUT };
  locked = false;
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouse = [false, false, false];
  private dx = 0;
  private dy = 0;
  private wheel = 0;
  private prevPad: boolean[] = [];
  private sprintLatch = false;
  private adsLatch = false;
  device: 'kb' | 'pad' = 'kb';
  enabled = false;

  constructor(private readonly el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.device = 'kb';
      if (this.enabled && ['Tab', 'Space', 'ControlLeft', 'KeyC'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouse = [false, false, false];
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) {
        this.lock();
        return;
      }
      this.mouse[e.button] = true;
      if (e.button === 2 && this.settings.toggleAds) this.adsLatch = !this.adsLatch;
      this.device = 'kb';
    });
    addEventListener('mouseup', (e) => (this.mouse[e.button] = false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    el.addEventListener('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) this.mouse = [false, false, false];
    });
  }

  /** Ask for pointer lock; browsers refuse without a fresh user gesture (CLICK TO PLAY covers that). */
  lock(): void {
    try {
      const p = this.el.requestPointerLock?.() as Promise<void> | undefined;
      p?.catch?.(() => undefined);
    } catch {
      /* no gesture yet */
    }
  }
  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private gamepad(): Gamepad | null {
    for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected && p.buttons.length >= 16) return p;
    return null;
  }
  get hasPad(): boolean {
    return !!this.gamepad();
  }

  /** Sample the frame. `adsAmount` scales look sensitivity while aiming; `assist` slows the stick near targets. */
  poll(dt: number, adsAmount: number, assist = 1): FrameInput {
    const k = (c: string) => this.keys.has(c);
    const pr = (c: string) => this.pressed.has(c);
    const S = this.settings;
    const sens = 0.0022 * S.sens * (1 - adsAmount * (1 - S.adsSens));
    const out: FrameInput = {
      dyaw: -this.dx * sens,
      dpitch: -this.dy * sens * (S.invert ? -1 : 1),
      mx: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
      mz: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
      jump: k('Space'),
      sprint: k('ShiftLeft') || k('ShiftRight'),
      crouch: k('KeyC') || k('ControlLeft'),
      ads: S.toggleAds ? this.adsLatch : this.mouse[2]!,
      fire: this.mouse[0]!,
      reload: pr('KeyR'),
      swap: this.wheel !== 0,
      slot: pr('Digit1') ? 0 : pr('Digit2') ? 1 : -1,
      grenade: k('KeyG'),
      melee: pr('KeyV') || pr('KeyE'),
      streak: pr('Digit4') || pr('Digit5'),
      scoreboard: k('Tab'),
      menu: pr('Escape'),
      pad: false,
    };
    this.dx = this.dy = 0;
    this.wheel = 0;
    this.pressed.clear();
    if (!this.locked) {
      out.fire = false;
      out.ads = false;
    }
    const p = this.gamepad();
    if (p) {
      const btn = (i: number) => !!p.buttons[i]?.pressed;
      const val = (i: number) => p.buttons[i]?.value ?? 0;
      const edge = (i: number) => btn(i) && !this.prevPad[i];
      const dz = (v: number, d = 0.12) => (Math.abs(v) < d ? 0 : (Math.sign(v) * (Math.abs(v) - d)) / (1 - d));
      const lx = dz(p.axes[0] ?? 0);
      const ly = dz(p.axes[1] ?? 0);
      const rx = dz(p.axes[2] ?? 0, 0.1);
      const ry = dz(p.axes[3] ?? 0, 0.1);
      const any = lx || ly || rx || ry || p.buttons.some((b) => b.pressed);
      if (any) this.device = 'pad';
      if (lx || ly) {
        out.mx = lx;
        out.mz = -ly;
      }
      // Look: dynamic response curve, slower while aiming / near targets.
      const curve = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.8);
      const rate = 3.6 * S.padSens * (1 - adsAmount * 0.45) * assist;
      out.dyaw += -curve(rx) * rate * dt;
      out.dpitch += -curve(ry) * rate * 0.62 * dt * (S.invert ? -1 : 1);
      if (edge(PAD.l3)) this.sprintLatch = !this.sprintLatch;
      if (ly > -0.5) this.sprintLatch = false;
      out.sprint ||= this.sprintLatch;
      out.jump ||= btn(PAD.cross);
      out.crouch ||= btn(PAD.circle);
      out.ads ||= val(PAD.l2) > 0.3;
      out.fire ||= val(PAD.r2) > 0.3;
      out.reload ||= edge(PAD.square);
      out.swap ||= edge(PAD.triangle);
      out.grenade ||= btn(PAD.r1);
      out.melee ||= edge(PAD.r3);
      out.streak ||= edge(PAD.right);
      out.scoreboard ||= btn(PAD.touch) || btn(PAD.share);
      out.menu ||= edge(PAD.options);
      out.pad = this.device === 'pad';
      this.prevPad = p.buttons.map((b) => b.pressed);
    }
    if (!this.enabled) {
      return { ...out, fire: false, ads: false, mx: 0, mz: 0, dyaw: 0, dpitch: 0, jump: false, grenade: false };
    }
    return out;
  }

  /** Menu navigation edges for the controller. */
  menuPad(): { up: boolean; down: boolean; left: boolean; right: boolean; ok: boolean; back: boolean } {
    const p = this.gamepad();
    const r = { up: false, down: false, left: false, right: false, ok: false, back: false };
    if (!p) return r;
    const edge = (i: number) => !!p.buttons[i]?.pressed && !this.prevPad[i];
    r.up = edge(PAD.up);
    r.down = edge(PAD.down);
    r.left = edge(PAD.left);
    r.right = edge(PAD.right);
    r.ok = edge(PAD.cross);
    r.back = edge(PAD.circle) || edge(PAD.options);
    this.prevPad = p.buttons.map((b) => b.pressed);
    return r;
  }

  rumble(strong: number, weak: number, ms: number): void {
    const p = this.gamepad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null;
    void p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => undefined);
  }
}
