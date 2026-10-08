/**
 * Controls with the classic CoD defaults.
 *
 * Keyboard + mouse: WASD move · Shift sprint · Space jump · C / Ctrl crouch (slide
 * while sprinting) · LMB fire · RMB aim · R reload · 1 / 2 / wheel swap · G grenade
 * lethal (hold to cook a frag) · Q tactical · V / E melee · 4 / 5 / 6 killstreaks ·
 * Tab scoreboard · Esc menu.
 *
 * PS4 (CoD "Default"): L2 aim · R2 fire · R1 lethal · L1 tactical · ✕ jump · ○ crouch / slide ·
 * □ reload · △ swap · L3 sprint · R3 melee · D-pad → next killstreak (← ↑ ↓: slots 1–3) · OPTIONS menu ·
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
  tactical: boolean;
  melee: boolean;
  /** −1 none, 0–2 a killstreak slot, 3 the next ready one. */
  streak: number;
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

/** Which devices drive this player: the keyboard + mouse and/or the n-th connected gamepad. */
export interface InputSource {
  kb: boolean;
  pad: number | null;
}

/** Connected standard-layout gamepads, in a stable order. */
export function connectedPads(): Gamepad[] {
  return [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected && p.buttons.length >= 16);
}

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

  constructor(
    private readonly el: HTMLElement,
    /** Splitscreen: player 1 keeps the keyboard, the others get a pad each. */
    public source: InputSource = { kb: true, pad: 0 },
  ) {
    if (!source.kb) this.device = 'pad';
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
    if (!this.source.kb) return;
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
    if (this.source.pad === null) return null;
    return connectedPads()[this.source.pad] ?? null;
  }
  get hasPad(): boolean {
    return !!this.gamepad();
  }

  /** Sample the frame. `adsAmount` scales look sensitivity while aiming; `assist` slows the stick near targets. */
  poll(dt: number, adsAmount: number, assist = 1): FrameInput {
    const kb = this.source.kb;
    const k = (c: string) => kb && this.keys.has(c);
    const pr = (c: string) => kb && this.pressed.has(c);
    if (!kb) {
      this.dx = this.dy = this.wheel = 0;
      this.mouse = [false, false, false];
    }
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
      tactical: pr('KeyQ'),
      melee: pr('KeyV') || pr('KeyE'),
      streak: pr('Digit4') ? 0 : pr('Digit5') ? 1 : pr('Digit6') ? 2 : -1,
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
      out.tactical ||= edge(PAD.l1);
      out.melee ||= edge(PAD.r3);
      if (edge(PAD.right)) out.streak = 3;
      else if (edge(PAD.left)) out.streak = 0;
      else if (edge(PAD.up)) out.streak = 1;
      else if (edge(PAD.down)) out.streak = 2;
      out.scoreboard ||= btn(PAD.touch) || btn(PAD.share);
      out.menu ||= edge(PAD.options);
      out.pad = this.device === 'pad';
      this.prevPad = p.buttons.map((b) => b.pressed);
    }
    if (!this.enabled) {
      return { ...out, fire: false, ads: false, mx: 0, mz: 0, dyaw: 0, dpitch: 0, jump: false, grenade: false, tactical: false, streak: -1 };
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
