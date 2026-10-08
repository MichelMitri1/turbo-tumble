import './touch.css';

export const touchDevice = () => matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;

/** Pointer-owned controls: every finger releases only its own action. */
export class TouchControls {
  readonly root = document.createElement('div');
  x = 0;
  y = 0;
  autoDrive = true;
  private enabled = false;
  private held = new Map<number, string>();
  private edges = new Set<string>();
  private stickId: number | null = null;
  private knob: HTMLElement;

  constructor(kind: 'race' | 'ball') {
    this.root.className = `mobile-controls mobile-${kind}`;
    this.root.hidden = true;
    this.root.innerHTML = `<div class="mobile-tools"></div><div class="mobile-stick" role="group" aria-label="Steering joystick"><span></span><small>${kind === 'ball' ? 'STEER / AIM' : 'STEER'}</small></div><div class="mobile-actions"></div>`;
    this.knob = this.root.querySelector('.mobile-stick span')!;
    const buttons = kind === 'race'
      ? [['brake', 'BRAKE'], ['drift', 'DRIFT'], ['item', 'ITEM']]
      : [['reverse', 'BRAKE'], ['powerslide', 'SLIDE / ROLL'], ['jump', 'JUMP'], ['boost', 'BOOST']];
    for (const [action, label] of [...buttons, ['drive', 'AUTO ON'], ...(kind === 'ball' ? [['ballCam', 'BALL CAM']] : [['reset', 'RESET']]), ['pause', 'PAUSE']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label!;
      b.dataset.action = action;
      b.setAttribute('aria-label', label!);
      if (action === 'drive') b.setAttribute('aria-pressed', 'true');
      const tool = ['drive', 'pause', 'reset', 'ballCam'].includes(action!);
      this.root.querySelector(tool ? '.mobile-tools' : '.mobile-actions')!.append(b);
      b.addEventListener('pointerdown', e => {
        if (!this.enabled) return;
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        this.held.set(e.pointerId, action!);
        this.edges.add(action!);
        b.classList.add('is-down');
        if (action === 'drive') {
          this.autoDrive = !this.autoDrive;
          b.textContent = this.autoDrive ? 'AUTO ON' : 'AUTO OFF';
          b.setAttribute('aria-pressed', String(this.autoDrive));
        }
      });
      const release = (e: PointerEvent) => {
        this.held.delete(e.pointerId);
        if (!this.down(action!)) b.classList.remove('is-down');
      };
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('lostpointercapture', release);
    }
    const stick = this.root.querySelector<HTMLElement>('.mobile-stick')!;
    const move = (e: PointerEvent) => {
      if (this.stickId !== e.pointerId) return;
      const r = stick.getBoundingClientRect();
      const dx = (e.clientX - r.left - r.width / 2) / (r.width * .35);
      const dy = (e.clientY - r.top - r.height / 2) / (r.height * .35);
      const length = Math.hypot(dx, dy);
      const scale = length > .12 ? Math.min(1, (length - .12) / .88) / length : 0;
      this.x = dx * scale;
      this.y = dy * scale;
      this.knob.style.transform = `translate(${this.x * r.width * .3}px, ${this.y * r.height * .3}px)`;
    };
    stick.addEventListener('pointerdown', e => {
      if (!this.enabled || this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      move(e);
    });
    stick.addEventListener('pointermove', move);
    const releaseStick = (e: PointerEvent) => {
      if (this.stickId !== e.pointerId) return;
      this.stickId = null;
      this.x = this.y = 0;
      this.knob.style.transform = '';
    };
    stick.addEventListener('pointerup', releaseStick);
    stick.addEventListener('pointercancel', releaseStick);
    stick.addEventListener('lostpointercapture', releaseStick);
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('blur', () => this.reset());
    addEventListener('resize', () => this.reset());
    document.addEventListener('visibilitychange', () => this.reset());
    document.body.append(this.root);
  }

  setActive(active: boolean): void {
    const next = active && touchDevice();
    if (next === this.enabled) return;
    this.enabled = next;
    this.root.hidden = !next;
    document.body.classList.toggle('touch-playing', next);
    this.reset();
  }
  get active(): boolean { return this.enabled; }
  down(action: string): boolean { return this.enabled && [...this.held.values()].includes(action); }
  pressed(action: string): boolean { return this.enabled && this.edges.has(action); }
  endFrame(): void { this.edges.clear(); }
  reset(): void {
    this.held.clear();
    this.edges.clear();
    this.stickId = null;
    this.x = this.y = 0;
    this.knob.style.transform = '';
    this.root.querySelectorAll('.is-down').forEach(b => b.classList.remove('is-down'));
  }
}
