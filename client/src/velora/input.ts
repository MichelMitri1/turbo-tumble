/**
 * Keyboard + mouse (pointer lock) + gamepad, merged into one set of actions.
 * Default bindings follow the PC / console versions of the big open-world games:
 *   foot:  WASD move · Shift sprint · Space jump · F enter car · RMB aim · LMB shoot · R reload
 *          Q/E or wheel: weapons · Tab: weapon wheel · G: punch? (LMB unarmed) · M map · Esc pause
 *   car:   W/S gas/brake · A/D steer · Space handbrake · F exit · H horn · E siren · C camera
 *   pad:   LS move · RS look · RT shoot / gas · LT aim / brake · A sprint / handbrake ·
 *          Y enter/exit · X jump / reload · RB / LB weapons · Back map · Start pause
 */

export interface Frame {
  moveX: number;
  moveY: number; // forward = +1
  lookX: number; // radians this frame
  lookY: number;
  sprint: boolean;
  jump: boolean;
  enter: boolean;
  aim: boolean;
  fire: boolean;
  firePressed: boolean;
  reload: boolean;
  nextWeapon: boolean;
  prevWeapon: boolean;
  wheel: boolean;
  slot: number; // 1–9 pressed, 0 none
  // driving
  throttle: number;
  steer: number;
  handbrake: boolean;
  horn: boolean;
  siren: boolean;
  camera: boolean;
  map: boolean;
  pause: boolean;
  interact: boolean;
  lookBack: boolean;
}

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, wheel: 0 };
  private padPrev: boolean[] = [];
  sensitivity = 0.0022;
  invertY = false;
  usingPad = false;
  locked = false;

  constructor(private canvas: HTMLElement) {
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingPad = false;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      if (e.button === 0) {
        this.mouse.left = true;
        this.mouse.leftPressed = true;
      }
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => (this.mouse.wheel += Math.sign(e.deltaY)), { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.mouse.left = this.mouse.right = false;
    });
  }

  /** Forget keys pressed this frame (a menu used them). */
  consume(): void {
    this.pressed.clear();
  }

  lock(): void {
    if (document.pointerLockElement !== this.canvas) void Promise.resolve(this.canvas.requestPointerLock?.()).catch(() => undefined);
  }
  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  read(dt: number): Frame {
    const k = (c: string) => this.keys.has(c);
    const p = (c: string) => this.pressed.has(c);
    const f: Frame = {
      moveX: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
      moveY: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
      lookX: this.mouse.dx * this.sensitivity,
      lookY: this.mouse.dy * this.sensitivity * (this.invertY ? -1 : 1),
      sprint: k('ShiftLeft') || k('ShiftRight'),
      jump: p('Space'),
      enter: p('KeyF'),
      aim: this.mouse.right,
      fire: this.mouse.left,
      firePressed: this.mouse.leftPressed,
      reload: p('KeyR'),
      nextWeapon: p('BracketRight') || this.mouse.wheel > 0,
      prevWeapon: p('KeyQ') || this.mouse.wheel < 0,
      wheel: k('Tab'),
      slot: 0,
      throttle: (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0),
      steer: (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0),
      handbrake: k('Space'),
      horn: k('KeyH'),
      siren: p('KeyE'),
      camera: p('KeyC') || p('KeyV'),
      map: p('KeyM'),
      pause: p('Escape') || p('KeyP'),
      interact: p('KeyE'),
      lookBack: k('KeyX'),
    };
    for (let i = 1; i <= 9; i++) if (p(`Digit${i}`)) f.slot = i;
    // Gamepad.
    const g = navigator.getGamepads?.().find((x) => x && x.connected);
    if (g) {
      const btn = (i: number) => !!g.buttons[i]?.pressed;
      const val = (i: number) => g.buttons[i]?.value ?? 0;
      const edge = (i: number) => btn(i) && !this.padPrev[i];
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      const lx = dz(g.axes[0] ?? 0);
      const ly = dz(g.axes[1] ?? 0);
      const rx = dz(g.axes[2] ?? 0);
      const ry = dz(g.axes[3] ?? 0);
      const any = lx || ly || rx || ry || g.buttons.some((b) => b.pressed);
      if (any) this.usingPad = true;
      if (this.usingPad) {
        f.moveX = lx;
        f.moveY = -ly;
        f.lookX += rx * 3.2 * dt;
        f.lookY += ry * 2.4 * dt * (this.invertY ? -1 : 1);
        f.sprint ||= btn(0);
        f.jump ||= edge(2);
        f.enter ||= edge(3);
        f.aim ||= val(6) > 0.3;
        f.fire ||= val(7) > 0.3;
        f.firePressed ||= val(7) > 0.3 && !this.padPrev[7];
        f.reload ||= edge(2);
        f.nextWeapon ||= edge(5);
        f.prevWeapon ||= edge(4);
        f.throttle = val(7) - val(6) || f.throttle;
        f.steer = lx || f.steer;
        f.handbrake ||= btn(0) || btn(5);
        f.horn ||= btn(10);
        f.siren ||= edge(11);
        f.camera ||= edge(12);
        f.map ||= edge(8);
        f.pause ||= edge(9);
        f.interact ||= edge(1);
        f.lookBack ||= btn(11);
      }
      this.padPrev = g.buttons.map((b) => b.pressed || b.value > 0.3);
    }
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.leftPressed = false;
    this.mouse.wheel = 0;
    this.pressed.clear();
    return f;
  }
}
