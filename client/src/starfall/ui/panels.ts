import type { Action } from '../sim/game';
import type { TaskKind } from '../sim/maps';
import type { SfView } from '../sim/view';
import type { Sfx } from '../audio';

/**
 * Every task as a little interactive panel, after the originals (swipe the card at the right
 * speed, connect the wires, clear asteroids, Simon-says the reactor…), plus the sabotage
 * panels (light switches, O2 keypad, hand scanners, comms dial). Drawn on a 600×600 canvas.
 */

type Ctx = CanvasRenderingContext2D;
const INK = '#0b0b10';
const SZ = 600;

export interface PanelHost {
  /** The task step is complete. */
  done(): void;
  close(): void;
  act(a: Action): void;
  sound(s: Sfx): void;
  view(): SfView | null;
}

export interface PanelInfo {
  kind: TaskKind | 'lights' | 'o2' | 'reactor-fix' | 'seismic' | 'comms';
  label: string;
  /** Persistent key (long timers survive closing the panel). */
  key: string;
  /** Extra (divert: the target room; sabotage: station index; my colour). */
  room?: string;
  station?: number;
  color?: string;
  colorName?: string;
}

/** Timers of waiting tasks (Inspect Sample, Run Diagnostics, Reboot Wifi) by key. */
const timers = new Map<string, number>();
const now = () => performance.now() / 1000;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const shuffle = <T>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};
const inR = (x: number, y: number, r: [number, number, number, number]) => x >= r[0] && y >= r[1] && x <= r[0] + r[2] && y <= r[1] + r[3];

// ---------------------------------------------------------------- drawing helpers

function panelBg(ctx: Ctx, col = '#4a5361', inner = '#2b313b'): void {
  ctx.fillStyle = col;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(6, 6, SZ - 12, SZ - 12, 22);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.roundRect(30, 30, SZ - 60, SZ - 60, 14);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#8994a3';
  for (const [x, y] of [[18, 18], [SZ - 18, 18], [18, SZ - 18], [SZ - 18, SZ - 18]]) {
    ctx.beginPath();
    ctx.arc(x!, y!, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}
function text(ctx: Ctx, s: string, x: number, y: number, size = 24, col = '#fff', align: CanvasTextAlign = 'center', font = 'Lilita One'): void {
  ctx.font = `${size}px "${font}", "Arial Black", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(3, size / 6);
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = col;
  ctx.fillText(s, x, y);
}
function rbox(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, r = 10, lw = 4): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
}
function circle(ctx: Ctx, x: number, y: number, r: number, fill: string, lw = 4): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}
function button(ctx: Ctx, r: [number, number, number, number], label: string, col: string, pressed = false, size = 26): void {
  const [x, y, w, h] = r;
  rbox(ctx, x, y + 6, w, h, '#1a1d24', 14);
  rbox(ctx, x, y + (pressed ? 5 : 0), w, h, col, 14);
  text(ctx, label, x + w / 2, y + h / 2 + (pressed ? 5 : 0), size);
}
function bar(ctx: Ctx, x: number, y: number, w: number, h: number, f: number, col = '#44d36b'): void {
  rbox(ctx, x, y, w, h, '#1a1d24', 8);
  if (f > 0) {
    ctx.beginPath();
    ctx.roundRect(x + 4, y + 4, (w - 8) * Math.min(1, f), h - 8, 5);
    ctx.fillStyle = col;
    ctx.fill();
  }
}

// ---------------------------------------------------------------- the base

export abstract class Panel {
  protected t = 0;
  protected msg = '';
  protected msgT = 0;
  finished = false;
  private doneT = 0;
  protected px = 0;
  protected py = 0;
  protected pressed = false;
  constructor(protected host: PanelHost, protected info: PanelInfo) {}
  down(x: number, y: number): void {
    this.px = x;
    this.py = y;
    this.pressed = true;
    if (!this.finished) this.onDown(x, y);
  }
  move(x: number, y: number): void {
    this.px = x;
    this.py = y;
    if (!this.finished) this.onMove(x, y);
  }
  up(x: number, y: number): void {
    this.pressed = false;
    if (!this.finished) this.onUp(x, y);
  }
  protected onDown(_x: number, _y: number): void {}
  protected onMove(_x: number, _y: number): void {}
  protected onUp(_x: number, _y: number): void {}
  key(_k: string): void {}
  /** Release anything held (closing the panel). */
  release(): void {}
  update(dt: number): void {
    this.t += dt;
    this.msgT -= dt;
    if (this.finished) {
      this.doneT += dt;
      if (this.doneT > 0.75) this.host.close();
    } else this.tick(dt);
  }
  protected tick(_dt: number): void {}
  protected say(m: string, secs = 1.4): void {
    this.msg = m;
    this.msgT = secs;
  }
  protected complete(): void {
    if (this.finished) return;
    this.finished = true;
    this.host.sound('taskStep');
    this.host.done();
  }
  render(ctx: Ctx): void {
    this.draw(ctx);
    if (this.msgT > 0) {
      rbox(ctx, 90, 520, 420, 50, 'rgba(10,12,20,0.9)', 12);
      text(ctx, this.msg, 300, 545, 24);
    }
    if (this.finished) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, SZ, SZ);
      text(ctx, 'TASK COMPLETED!', 300, 300, 46, '#7dff7d');
    }
  }
  protected abstract draw(ctx: Ctx): void;
}

/** "Hold / press a button and wait" tasks (download, upload, weather, process, fuel…). */
class ProgressPanel extends Panel {
  private on = false;
  private f = 0;
  constructor(host: PanelHost, info: PanelInfo, private opts: { button: string; secs: number; hold?: boolean; art: (ctx: Ctx, f: number, t: number) => void; col?: string }) {
    super(host, info);
  }
  private btnR: [number, number, number, number] = [190, 430, 220, 70];
  protected override onDown(x: number, y: number): void {
    if (inR(x, y, this.btnR)) {
      this.on = true;
      this.host.sound('click');
    }
  }
  protected override onUp(): void {
    if (this.opts.hold) this.on = false;
  }
  override release(): void {
    if (this.opts.hold) this.on = false;
  }
  protected override tick(dt: number): void {
    if (this.on) this.f = Math.min(1, this.f + dt / this.opts.secs);
    if (this.f >= 1) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, this.info.label, 300, 64, 30);
    this.opts.art(ctx, this.f, this.t);
    bar(ctx, 70, 370, 460, 40, this.f, this.opts.col);
    text(ctx, `${Math.round(this.f * 100)}%`, 300, 390, 22);
    button(ctx, this.btnR, this.opts.button, this.on ? '#2fa84f' : '#3f8cff', this.on && !!this.opts.hold);
  }
}

// ---------------------------------------------------------------- tasks

class Swipe extends Panel {
  private stage: 'wallet' | 'ready' | 'drag' = 'wallet';
  private cx = 80;
  private t0 = 0;
  protected override onDown(x: number, y: number): void {
    if (this.stage === 'wallet' && y > 330) {
      this.stage = 'ready';
      this.host.sound('click');
      this.say('Please swipe card', 1.5);
    } else if (this.stage === 'ready' && Math.abs(x - this.cx) < 90 && y > 120 && y < 280) {
      this.stage = 'drag';
      this.t0 = this.t;
    }
  }
  protected override onMove(x: number): void {
    if (this.stage === 'drag') this.cx = Math.max(80, Math.min(520, x));
  }
  protected override onUp(): void {
    if (this.stage !== 'drag') return;
    const dt = this.t - this.t0;
    if (this.cx < 500) this.say('Bad read. Try again.');
    else if (dt < 0.55) this.say('Too fast. Try again.');
    else if (dt > 1.3) this.say('Too slow. Try again.');
    else {
      this.say('Accepted. Thank you.');
      this.complete();
      return;
    }
    this.host.sound('wrong');
    this.cx = 80;
    this.stage = 'ready';
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx, '#5a6270', '#3d434d');
    // Reader.
    rbox(ctx, 50, 60, 500, 70, '#1d2a22', 10);
    const lit = this.msgT > 0 ? this.msg : this.stage === 'wallet' ? 'Please insert card' : 'Please swipe card';
    text(ctx, lit.toUpperCase(), 300, 95, 22, '#7dff7d', 'center', 'Nunito');
    rbox(ctx, 40, 180, 520, 24, '#15181e', 6);
    // Wallet.
    rbox(ctx, 120, 360, 360, 180, '#7a4a25', 18);
    if (this.stage === 'wallet') this.card(ctx, 300, 420);
    else this.card(ctx, this.cx, 200);
  }
  private card(ctx: Ctx, x: number, y: number): void {
    rbox(ctx, x - 80, y - 50, 160, 100, '#cfe8ff', 10);
    ctx.fillStyle = '#4e7cc9';
    ctx.fillRect(x - 70, y - 40, 40, 40);
    ctx.fillStyle = '#7d8aa0';
    ctx.fillRect(x - 20, y - 30, 80, 10);
    ctx.fillRect(x - 20, y - 10, 60, 10);
  }
}

const WIRE = ['#ff3434', '#2f6bff', '#ffe23a', '#ff3ff2'];
class Wires extends Panel {
  private left = shuffle([0, 1, 2, 3]);
  private right = shuffle([0, 1, 2, 3]);
  private links = new Map<number, number>(); // left index → right index
  private drag = -1;
  private ly = (i: number) => 140 + i * 100;
  protected override onDown(x: number, y: number): void {
    if (x < 140) for (let i = 0; i < 4; i++) if (Math.abs(y - this.ly(i)) < 35 && !this.links.has(i)) this.drag = i;
  }
  protected override onUp(x: number, y: number): void {
    if (this.drag < 0) return;
    if (x > 440)
      for (let j = 0; j < 4; j++)
        if (Math.abs(y - this.ly(j)) < 40 && this.right[j] === this.left[this.drag]) {
          this.links.set(this.drag, j);
          this.host.sound('click');
        }
    this.drag = -1;
    if (this.links.size === 4) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx, '#3b3f48', '#23262c');
    for (let i = 0; i < 4; i++) {
      rbox(ctx, 40, this.ly(i) - 18, 70, 36, WIRE[this.left[i]!]!, 6);
      rbox(ctx, 490, this.ly(i) - 18, 70, 36, WIRE[this.right[i]!]!, 6);
      circle(ctx, 120, this.ly(i), 12, '#c9a24a');
      circle(ctx, 480, this.ly(i), 12, '#c9a24a');
    }
    ctx.lineCap = 'round';
    const wire = (x0: number, y0: number, x1: number, y1: number, col: string) => {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 26;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 18;
      ctx.stroke();
    };
    for (const [i, j] of this.links) wire(120, this.ly(i), 480, this.ly(j), WIRE[this.left[i]!]!);
    if (this.drag >= 0) wire(120, this.ly(this.drag), this.px, this.py, WIRE[this.left[this.drag]!]!);
  }
}

class Fuel extends Panel {
  private f = 0;
  private holding = false;
  private btn: [number, number, number, number] = [400, 420, 140, 100];
  protected override onDown(x: number, y: number): void {
    if (inR(x, y, this.btn)) this.holding = true;
  }
  protected override onUp(): void {
    this.holding = false;
  }
  override release(): void {
    this.holding = false;
  }
  protected override tick(dt: number): void {
    if (this.holding) this.f = Math.min(1, this.f + dt / 3);
    if (this.f >= 1) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, this.info.label, 300, 64, 30);
    const can = /can/i.test(this.info.label);
    rbox(ctx, 120, 110, can ? 220 : 260, 380, '#20252d', 18);
    const h = 360 * this.f;
    ctx.fillStyle = '#e8b63a';
    ctx.fillRect(130, 480 - h, (can ? 220 : 260) - 20, h);
    if (can) rbox(ctx, 170, 80, 120, 40, '#d33', 8);
    for (let i = 1; i < 6; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(130, 120 + i * 60, 40, 4);
    }
    button(ctx, this.btn, 'HOLD', this.holding ? '#2fa84f' : '#e04a3b', this.holding, 30);
    circle(ctx, 470, 340, 18, this.f >= 1 ? '#44ff66' : this.holding ? '#ffd23f' : '#552222');
  }
}

class Garbage extends Panel {
  private lever = 0; // 0 up … 1 down
  private dragging = false;
  private trash: Array<{ x: number; y: number; vy: number; c: string }> = [];
  private left = 1;
  constructor(h: PanelHost, i: PanelInfo) {
    super(h, i);
    for (let k = 0; k < 18; k++) this.trash.push({ x: rand(130, 400), y: rand(150, 430), vy: 0, c: ['#8b5a2b', '#d9c27a', '#6a9c3a', '#b04a4a', '#7a8a99'][k % 5]! });
  }
  protected override onDown(x: number, y: number): void {
    if (x > 470 && Math.abs(y - (150 + this.lever * 250)) < 50) this.dragging = true;
  }
  protected override onMove(_x: number, y: number): void {
    if (this.dragging) this.lever = Math.max(0, Math.min(1, (y - 150) / 250));
  }
  protected override onUp(): void {
    this.dragging = false;
    this.lever = 0;
  }
  override release(): void {
    this.dragging = false;
    this.lever = 0;
  }
  protected override tick(dt: number): void {
    if (this.lever > 0.9) {
      for (const tr of this.trash) {
        tr.vy += 900 * dt;
        tr.y += tr.vy * dt;
      }
      this.left = this.trash.filter((t) => t.y < 600).length / this.trash.length;
      if (this.left <= 0) this.complete();
    }
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, this.info.label, 260, 64, 28);
    rbox(ctx, 100, 100, 330, 440, '#20252d', 10);
    ctx.save();
    ctx.beginPath();
    ctx.rect(104, 104, 322, 432);
    ctx.clip();
    for (const tr of this.trash) circle(ctx, tr.x, tr.y, 26, tr.c, 3);
    ctx.restore();
    if (this.lever > 0.9) rbox(ctx, 100, 536, 330, 10, '#111', 2, 2);
    rbox(ctx, 500, 140, 24, 280, '#1a1d24', 10);
    circle(ctx, 512, 150 + this.lever * 250, 34, '#e04a3b');
    text(ctx, 'PULL', 512, 470, 22);
  }
}

class Asteroids extends Panel {
  private rocks: Array<{ x: number; y: number; vx: number; vy: number; r: number; a: number; hit: number }> = [];
  private n = 0;
  private spawn = 0;
  private shots: Array<{ x: number; y: number; t: number }> = [];
  protected override onDown(x: number, y: number): void {
    this.shots.push({ x, y, t: 0.15 });
    this.host.sound('click');
    for (const r of this.rocks)
      if (r.hit <= 0 && Math.hypot(r.x - x, r.y - y) < r.r + 10) {
        r.hit = 0.3;
        this.n++;
        if (this.n >= 20) this.complete();
        break;
      }
  }
  protected override tick(dt: number): void {
    this.spawn -= dt;
    if (this.spawn <= 0 && this.rocks.length < 7) {
      this.spawn = rand(0.35, 0.8);
      this.rocks.push({ x: 600, y: rand(80, 520), vx: rand(-200, -110), vy: rand(-40, 40), r: rand(22, 38), a: 0, hit: 0 });
    }
    for (const r of this.rocks) {
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.a += dt;
      if (r.hit > 0) {
        r.hit -= dt;
        if (r.hit <= 0) r.hit = -1;
      }
    }
    this.rocks = this.rocks.filter((r) => r.x > -50 && r.hit >= 0);
    for (const s of this.shots) s.t -= dt;
    this.shots = this.shots.filter((s) => s.t > 0);
  }
  protected draw(ctx: Ctx): void {
    rbox(ctx, 6, 6, SZ - 12, SZ - 12, '#05140c', 22, 6);
    ctx.strokeStyle = 'rgba(80,255,120,0.25)';
    ctx.lineWidth = 2;
    for (let i = 60; i < 600; i += 60) {
      ctx.beginPath();
      ctx.moveTo(i, 10);
      ctx.lineTo(i, 590);
      ctx.moveTo(10, i);
      ctx.lineTo(590, i);
      ctx.stroke();
    }
    for (const r of this.rocks) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.a);
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const rr = r.r * (0.8 + ((k * 37) % 5) * 0.06);
        ctx.lineTo(Math.cos((k / 8) * Math.PI * 2) * rr, Math.sin((k / 8) * Math.PI * 2) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = r.hit > 0 ? '#ff9a3c' : '#2aa84a';
      ctx.fill();
      ctx.strokeStyle = '#7dff9a';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
    for (const s of this.shots) {
      ctx.strokeStyle = '#ff5050';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(300, 600);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
    // Crosshair.
    ctx.strokeStyle = '#ff5050';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.px, this.py, 18, 0, Math.PI * 2);
    ctx.moveTo(this.px - 26, this.py);
    ctx.lineTo(this.px + 26, this.py);
    ctx.moveTo(this.px, this.py - 26);
    ctx.lineTo(this.px, this.py + 26);
    ctx.stroke();
    text(ctx, `Destroyed: ${this.n}`, 300, 40, 26, '#7dff9a', 'center', 'Nunito');
  }
}

class Shields extends Panel {
  private red: boolean[];
  constructor(h: PanelHost, i: PanelInfo) {
    super(h, i);
    this.red = Array.from({ length: 7 }, () => Math.random() < 0.5);
    if (!this.red.some(Boolean)) this.red[3] = true;
  }
  private at(i: number): [number, number] {
    if (i === 6) return [300, 300];
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return [300 + Math.cos(a) * 150, 300 + Math.sin(a) * 150];
  }
  protected override onDown(x: number, y: number): void {
    for (let i = 0; i < 7; i++) {
      const [cx, cy] = this.at(i);
      if (Math.hypot(x - cx, y - cy) < 70) {
        this.red[i] = !this.red[i];
        this.host.sound('click');
      }
    }
    if (!this.red.some(Boolean)) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    for (let i = 0; i < 7; i++) {
      const [cx, cy] = this.at(i);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) ctx.lineTo(cx + Math.cos((k * Math.PI) / 3) * 74, cy + Math.sin((k * Math.PI) / 3) * 74);
      ctx.closePath();
      ctx.fillStyle = this.red[i] ? '#e8434a' : '#eef3f8';
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
  }
}

class O2Filter extends Panel {
  private leaves = Array.from({ length: 6 }, () => ({ x: rand(250, 520), y: rand(120, 480), vx: rand(-30, 30), vy: rand(-30, 30), a: rand(0, 6), out: false }));
  private drag = -1;
  protected override onDown(x: number, y: number): void {
    this.drag = this.leaves.findIndex((l) => !l.out && Math.hypot(l.x - x, l.y - y) < 40);
  }
  protected override onMove(x: number, y: number): void {
    const l = this.leaves[this.drag];
    if (l) {
      l.x = x;
      l.y = y;
    }
  }
  protected override onUp(): void {
    const l = this.leaves[this.drag];
    if (l && l.x < 110) {
      l.out = true;
      this.host.sound('click');
    }
    this.drag = -1;
    if (this.leaves.every((l) => l.out)) this.complete();
  }
  protected override tick(dt: number): void {
    this.leaves.forEach((l, i) => {
      if (l.out || i === this.drag) return;
      l.x = Math.max(150, Math.min(540, l.x + l.vx * dt));
      l.y = Math.max(80, Math.min(520, l.y + l.vy * dt));
      if (l.x <= 150 || l.x >= 540) l.vx *= -1;
      if (l.y <= 80 || l.y >= 520) l.vy *= -1;
      l.a += dt;
    });
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx, '#4a5361', '#7fa8a0');
    rbox(ctx, 30, 220, 90, 160, '#1d2229', 8);
    text(ctx, '←', 75, 300, 50);
    for (const l of this.leaves) {
      if (l.out) continue;
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.a);
      ctx.beginPath();
      ctx.ellipse(0, 0, 38, 20, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#5fae3c';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-30, 0);
      ctx.lineTo(30, 0);
      ctx.stroke();
      ctx.restore();
    }
  }
}

class Chart extends Panel {
  private pts: Array<[number, number]> = [];
  private k = 0;
  private sx: number;
  private sy: number;
  private drag = false;
  constructor(h: PanelHost, i: PanelInfo) {
    super(h, i);
    for (let n = 0; n < 5; n++) this.pts.push([80 + n * 110, rand(160, 460)]);
    [this.sx, this.sy] = this.pts[0]!;
  }
  protected override onDown(x: number, y: number): void {
    this.drag = Math.hypot(x - this.sx, y - this.sy) < 50;
  }
  protected override onMove(x: number, y: number): void {
    if (!this.drag) return;
    const [ax, ay] = this.pts[this.k]!;
    const [bx, by] = this.pts[this.k + 1]!;
    // Project onto the current leg.
    const dx = bx - ax;
    const dy = by - ay;
    const f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    this.sx = ax + dx * f;
    this.sy = ay + dy * f;
    if (f > 0.97) {
      this.k++;
      this.host.sound('click');
      if (this.k >= this.pts.length - 1) {
        this.drag = false;
        this.complete();
      }
    }
  }
  protected override onUp(): void {
    this.drag = false;
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx, '#4a5361', '#173a6b');
    ctx.setLineDash([12, 10]);
    ctx.strokeStyle = '#d6e6ff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    this.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.setLineDash([]);
    this.pts.forEach(([x, y], i) => circle(ctx, x, y, 14, i <= this.k ? '#7dff7d' : '#fff'));
    ctx.save();
    ctx.translate(this.sx, this.sy);
    const [bx, by] = this.pts[Math.min(this.k + 1, this.pts.length - 1)]!;
    ctx.rotate(Math.atan2(by - this.sy, bx - this.sx));
    ctx.beginPath();
    ctx.moveTo(34, 0);
    ctx.lineTo(-24, -20);
    ctx.lineTo(-14, 0);
    ctx.lineTo(-24, 20);
    ctx.closePath();
    ctx.fillStyle = '#e8eef5';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
  }
}

class Steering extends Panel {
  private x = rand(120, 480);
  private y = rand(120, 480);
  private drag = false;
  protected override onDown(x: number, y: number): void {
    this.drag = Math.hypot(x - this.x, y - this.y) < 70;
  }
  protected override onMove(x: number, y: number): void {
    if (this.drag) [this.x, this.y] = [x, y];
  }
  protected override onUp(): void {
    this.drag = false;
    if (Math.hypot(this.x - 300, this.y - 300) < 18) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx, '#4a5361', '#0f2a4f');
    ctx.strokeStyle = 'rgba(160,210,255,0.5)';
    ctx.lineWidth = 3;
    for (const r of [80, 160, 240]) {
      ctx.beginPath();
      ctx.arc(300, 300, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(300, 40);
    ctx.lineTo(300, 560);
    ctx.moveTo(40, 300);
    ctx.lineTo(560, 300);
    ctx.stroke();
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 46, 0, Math.PI * 2);
    ctx.moveTo(this.x - 70, this.y);
    ctx.lineTo(this.x + 70, this.y);
    ctx.moveTo(this.x, this.y - 70);
    ctx.lineTo(this.x, this.y + 70);
    ctx.stroke();
  }
}

class Align extends Panel {
  private v = (Math.random() < 0.5 ? -1 : 1) * rand(0.4, 0.95);
  private drag = false;
  private y = () => 300 + this.v * 220;
  protected override onDown(x: number, y: number): void {
    this.drag = x > 380 && Math.abs(y - this.y()) < 60;
  }
  protected override onMove(_x: number, y: number): void {
    if (this.drag) this.v = Math.max(-1, Math.min(1, (y - 300) / 220));
  }
  protected override onUp(): void {
    if (this.drag && Math.abs(this.v) < 0.05) {
      this.v = 0;
      this.complete();
    }
    this.drag = false;
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, this.info.label, 300, 60, 26);
    // The engine's output beam, tilted by the slider.
    ctx.save();
    ctx.translate(120, 300);
    ctx.rotate(this.v * 0.45);
    rbox(ctx, -60, -60, 120, 120, '#8994a3', 20);
    ctx.fillStyle = Math.abs(this.v) < 0.05 ? '#7dff7d' : '#ffb347';
    ctx.fillRect(60, -12, 300, 24);
    ctx.restore();
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(120, 300);
    ctx.lineTo(440, 300);
    ctx.stroke();
    ctx.setLineDash([]);
    rbox(ctx, 470, 70, 30, 460, '#1a1d24', 10);
    rbox(ctx, 440, this.y() - 26, 90, 52, '#ffd23f', 12);
  }
}

class Calibrate extends Panel {
  private k = 0;
  private a = [0, 1.5, 3];
  private speed = [2.2, 2.8, 3.4];
  private btns = [0, 1, 2].map((i) => [400, 90 + i * 160, 150, 80] as [number, number, number, number]);
  protected override onDown(x: number, y: number): void {
    const i = this.btns.findIndex((b) => inR(x, y, b));
    if (i < 0) return;
    if (i !== this.k) return;
    const a = ((this.a[i]! % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (a < 0.45 || a > Math.PI * 2 - 0.45) {
      this.k++;
      this.host.sound('click');
      if (this.k >= 3) this.complete();
    } else {
      this.host.sound('wrong');
      this.k = 0;
    }
  }
  protected override tick(dt: number): void {
    for (let i = 0; i < 3; i++) if (i >= this.k) this.a[i]! += this.speed[i]! * dt;
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    for (let i = 0; i < 3; i++) {
      const cy = 130 + i * 160;
      circle(ctx, 200, cy, 62, '#1a1d24');
      // Target notch at the top.
      ctx.fillStyle = '#44d36b';
      ctx.beginPath();
      ctx.moveTo(200, cy);
      ctx.arc(200, cy, 58, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45);
      ctx.fill();
      ctx.save();
      ctx.translate(200, cy);
      ctx.rotate(this.a[i]!);
      ctx.fillStyle = ['#ffd23f', '#3fd8ff', '#ff6b9a'][i]!;
      ctx.fillRect(-5, -56, 10, 56);
      ctx.restore();
      button(ctx, this.btns[i]!, i < this.k ? '✓' : 'CALIBRATE', i < this.k ? '#2fa84f' : i === this.k ? '#3f8cff' : '#555c66', false, 20);
    }
  }
}

const DIVERT_ROOMS = ['Engines', 'Weapons', 'Navigation', 'Shields', 'Comms', 'O2', 'Security', 'Lab'];
class Divert extends Panel {
  private target: number;
  private v = 0;
  private drag = false;
  private names: string[];
  constructor(h: PanelHost, i: PanelInfo) {
    super(h, i);
    this.names = [...DIVERT_ROOMS];
    this.target = Math.floor(Math.random() * 8);
    if (i.room) this.names[this.target] = i.room.replace(/ (Engine|Room)$/, '').slice(0, 10);
  }
  protected override onDown(x: number, y: number): void {
    const sx = 65 + this.target * 67;
    this.drag = Math.abs(x - sx) < 30 && Math.abs(y - (460 - this.v * 300)) < 40;
  }
  protected override onMove(_x: number, y: number): void {
    if (this.drag) this.v = Math.max(0, Math.min(1, (460 - y) / 300));
  }
  protected override onUp(): void {
    this.drag = false;
    if (this.v > 0.95) this.complete();
    else this.v = 0;
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    for (let i = 0; i < 8; i++) {
      const x = 65 + i * 67;
      const on = i === this.target;
      rbox(ctx, x - 8, 150, 16, 320, on ? '#ffd23f' : '#1a1d24', 6, 3);
      rbox(ctx, x - 26, 460 - (on ? this.v : 0) * 300 - 18, 52, 36, on ? '#ffffff' : '#7b8492', 8);
      ctx.save();
      ctx.translate(x, 110);
      ctx.rotate(-Math.PI / 2);
      text(ctx, this.names[i]!, 0, 0, 16, on ? '#ffd23f' : '#c9d2dc', 'center', 'Nunito');
      ctx.restore();
    }
  }
}

class Accept extends Panel {
  protected override onDown(x: number, y: number): void {
    if (Math.hypot(x - 300, y - 300) < 120) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, 'Accept Diverted Power', 300, 70, 28);
    circle(ctx, 300, 300, 120, '#1a1d24');
    ctx.save();
    ctx.translate(300, 300);
    ctx.rotate(this.finished ? 0 : -0.8);
    rbox(ctx, -20, -110, 40, 120, '#ffd23f', 10);
    ctx.restore();
    ctx.strokeStyle = this.finished ? '#ffd23f' : '#444';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(60, 500);
    for (let x = 60; x < 540; x += 30) ctx.lineTo(x + 15, 500 + (this.finished ? Math.sin(x + this.t * 20) * 20 : 0));
    ctx.stroke();
  }
}

/** Tasks with a wait (Inspect Sample 60 s, Run Diagnostics 90 s): leave and come back. */
class Waiting extends Panel {
  private pick = Math.floor(Math.random() * 5);
  constructor(h: PanelHost, i: PanelInfo, private secs: number, private items: number, private title: string) {
    super(h, i);
    this.pick = Math.floor(Math.random() * items);
  }
  private get left(): number | null {
    const end = timers.get(this.info.key);
    return end === undefined ? null : Math.max(0, end - now());
  }
  private startR: [number, number, number, number] = [200, 430, 200, 70];
  protected override onDown(x: number, y: number): void {
    const left = this.left;
    if (left === null) {
      if (inR(x, y, this.startR)) {
        timers.set(this.info.key, now() + this.secs);
        this.host.sound('click');
        this.say('You can leave and come back.', 2.5);
      }
      return;
    }
    if (left > 0) return;
    for (let i = 0; i < this.items; i++) {
      const cx = 300 - ((this.items - 1) * 90) / 2 + i * 90;
      if (Math.abs(x - cx) < 40 && y > 160 && y < 380) {
        if (i === this.pick) {
          timers.delete(this.info.key);
          this.complete();
        } else {
          this.host.sound('wrong');
          this.say('Wrong one. Start over.');
          timers.delete(this.info.key);
        }
      }
    }
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, this.title, 300, 64, 28);
    const left = this.left;
    for (let i = 0; i < this.items; i++) {
      const cx = 300 - ((this.items - 1) * 90) / 2 + i * 90;
      const ready = left === 0;
      rbox(ctx, cx - 28, 170, 56, 200, '#cfe2ee', 28);
      const fill = left === null ? 0 : ready ? 1 : 1 - left / this.secs;
      ctx.fillStyle = ready && i === this.pick ? '#ff4f4f' : '#4fb6ff';
      ctx.fillRect(cx - 22, 364 - 180 * fill, 44, 180 * fill);
    }
    if (left === null) button(ctx, this.startR, 'START', '#3f8cff');
    else if (left > 0) text(ctx, `Ready in ${Math.ceil(left)}s`, 300, 460, 34, '#ffd23f');
    else text(ctx, 'Select the anomaly', 300, 460, 30, '#7dff7d');
  }
}

class Scan extends Panel {
  private f = 0;
  protected override tick(dt: number): void {
    this.f = Math.min(1, this.f + dt / 10);
    if (this.f >= 1) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx, '#4a5361', '#1a2a24');
    text(ctx, 'MEDBAY SCAN', 300, 64, 30, '#7dff9a');
    const lines = [`ID: ${this.info.colorName ?? 'CREW'}`, `HT: 3' 6"`, `WT: 92lb`, `BT: O-`, `SCAN ${Math.round(this.f * 100)}%`];
    const shown = Math.ceil(this.f * lines.length);
    lines.slice(0, shown).forEach((l, i) => text(ctx, l, 90, 150 + i * 56, 30, '#7dff9a', 'left', 'Nunito'));
    bar(ctx, 70, 470, 460, 40, this.f, '#4cf1a0');
  }
}

class Simon extends Panel {
  private seq: number[] = [];
  private stage = 1;
  private input: number[] = [];
  private show = 0;
  private flash = -1;
  private flashT = 0;
  private press = -1;
  private pressT = 0;
  constructor(h: PanelHost, i: PanelInfo) {
    super(h, i);
    for (let k = 0; k < 5; k++) this.seq.push(Math.floor(Math.random() * 9));
    this.show = 0.8;
  }
  private cell(i: number, x0: number): [number, number, number, number] {
    return [x0 + (i % 3) * 82, 180 + Math.floor(i / 3) * 82, 74, 74];
  }
  protected override onDown(x: number, y: number): void {
    if (this.playing()) return;
    for (let i = 0; i < 9; i++)
      if (inR(x, y, this.cell(i, 320))) {
        this.press = i;
        this.pressT = 0.2;
        if (this.seq[this.input.length] === i) {
          this.input.push(i);
          this.host.sound('click');
          if (this.input.length === this.stage) {
            this.stage++;
            this.input = [];
            if (this.stage > 5) return this.complete();
            this.show = 0.8;
          }
        } else {
          this.host.sound('wrong');
          this.stage = 1;
          this.input = [];
          this.show = 1.2;
        }
      }
  }
  private playing(): boolean {
    return this.show > 0 || this.flash >= 0;
  }
  protected override tick(dt: number): void {
    this.pressT -= dt;
    if (this.show > 0) {
      this.show -= dt;
      if (this.show <= 0) {
        this.flash = 0;
        this.flashT = 0.5;
      }
    } else if (this.flash >= 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flash++;
        this.flashT = 0.5;
        if (this.flash >= this.stage) this.flash = -1;
      }
    }
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, 'Start Reactor', 300, 64, 30);
    for (let k = 0; k < 5; k++) circle(ctx, 160 + k * 30, 130, 9, k < this.stage - 1 ? '#7dff7d' : '#333', 3);
    for (let k = 0; k < 5; k++) circle(ctx, 360 + k * 30, 130, 9, k < this.input.length ? '#7dff7d' : '#333', 3);
    for (let i = 0; i < 9; i++) {
      const lit = this.flash >= 0 && this.flashT > 0.15 && this.seq[this.flash] === i;
      const [x, y, w, h] = this.cell(i, 40);
      rbox(ctx, x, y, w, h, lit ? '#4fb6ff' : '#14181e', 6);
      const [bx, by, bw, bh] = this.cell(i, 320);
      rbox(ctx, bx, by, bw, bh, this.press === i && this.pressT > 0 ? '#ffd23f' : '#c9d2dc', 10);
    }
  }
}

class Manifolds extends Panel {
  private nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  private next = 1;
  private bad = 0;
  private r(i: number): [number, number, number, number] {
    return [55 + (i % 5) * 100, 200 + Math.floor(i / 5) * 110, 90, 90];
  }
  protected override onDown(x: number, y: number): void {
    for (let i = 0; i < 10; i++)
      if (inR(x, y, this.r(i))) {
        if (this.nums[i] === this.next) {
          this.next++;
          this.host.sound('click');
          if (this.next > 10) this.complete();
        } else {
          this.host.sound('wrong');
          this.bad = 0.4;
          this.next = 1;
        }
      }
  }
  protected override tick(dt: number): void {
    this.bad -= dt;
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, 'Unlock Manifolds', 300, 80, 30);
    for (let i = 0; i < 10; i++) {
      const n = this.nums[i]!;
      rbox(ctx, ...this.r(i), this.bad > 0 ? '#e8434a' : n < this.next ? '#4fb6ff' : '#2b3340', 10);
      text(ctx, String(n), this.r(i)[0] + 45, this.r(i)[1] + 45, 36);
    }
  }
}

class Pick extends Panel {
  /** Pick the matching item (Buy Beverage). */
  private want = Math.floor(Math.random() * 4);
  private drinks = ['#7b3f1d', '#e8434a', '#44d36b', '#4fb6ff'];
  private names = ['Coffee', 'Cola', 'Lime', 'Water'];
  protected override onDown(x: number, y: number): void {
    for (let i = 0; i < 4; i++)
      if (inR(x, y, [70 + i * 120, 330, 100, 120])) {
        if (i === this.want) this.complete();
        else {
          this.host.sound('wrong');
          this.say('Wrong drink!');
        }
      }
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx, '#c0392b', '#2b3340');
    text(ctx, 'ORDER:', 200, 120, 30);
    rbox(ctx, 300, 70, 120, 110, '#fff', 12);
    circle(ctx, 360, 125, 34, this.drinks[this.want]!);
    for (let i = 0; i < 4; i++) {
      rbox(ctx, 70 + i * 120, 330, 100, 120, '#e9eef3', 12);
      rbox(ctx, 95 + i * 120, 350, 50, 70, this.drinks[i]!, 10);
      text(ctx, this.names[i]!, 120 + i * 120, 470, 18, '#fff', 'center', 'Nunito');
    }
  }
}

class Water extends Panel {
  private got = false;
  private plants = [0, 0, 0, 0];
  private can = /can/i.test(this.info.label);
  protected override onDown(x: number, y: number): void {
    if (this.can) {
      if (Math.hypot(x - 300, y - 320) < 110) this.complete();
      return;
    }
    this.got = true;
  }
  protected override onUp(): void {
    this.got = false;
  }
  protected override tick(dt: number): void {
    if (this.can || !this.got) return;
    for (let i = 0; i < 4; i++) if (Math.abs(this.px - (120 + i * 120)) < 50 && this.py < 380) this.plants[i] = Math.min(1, this.plants[i]! + dt / 1.2);
    if (this.plants.every((p) => p >= 1)) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx, '#4a5361', '#5c8a52');
    text(ctx, this.info.label, 300, 64, 28);
    if (this.can) {
      rbox(ctx, 220, 260, 160, 130, '#3fa7ff', 20);
      rbox(ctx, 370, 270, 90, 24, '#3fa7ff', 8);
      text(ctx, 'Tap the can', 300, 460, 26);
      return;
    }
    for (let i = 0; i < 4; i++) {
      const x = 120 + i * 120;
      rbox(ctx, x - 40, 420, 80, 80, '#8b5a2b', 8);
      const h = 60 + this.plants[i]! * 140;
      ctx.fillStyle = this.plants[i]! >= 1 ? '#3fcf4f' : '#9a8a3a';
      ctx.fillRect(x - 6, 420 - h, 12, h);
      circle(ctx, x, 420 - h, 26, this.plants[i]! >= 1 ? '#3fcf4f' : '#9a8a3a');
    }
    rbox(ctx, this.px - 50, this.py - 50, 80, 60, '#3fa7ff', 14);
    if (this.got) {
      ctx.fillStyle = 'rgba(79,182,255,0.7)';
      for (let k = 0; k < 6; k++) ctx.fillRect(this.px + 30 + Math.sin(this.t * 20 + k) * 8, this.py + k * 22, 6, 14);
    }
    text(ctx, 'Hold over each plant', 300, 120, 22);
  }
}

class Keypad extends Panel {
  private code = String(Math.floor(10000 + Math.random() * 90000));
  private typed = '';
  constructor(h: PanelHost, i: PanelInfo, private onEnter?: (code: string) => boolean, fixed?: string) {
    super(h, i);
    if (fixed) this.code = fixed;
  }
  private r(i: number): [number, number, number, number] {
    return [300 + (i % 3) * 82, 160 + Math.floor(i / 3) * 82, 74, 74];
  }
  private label(i: number): string {
    return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '✕', '0', '✓'][i]!;
  }
  protected override onDown(x: number, y: number): void {
    for (let i = 0; i < 12; i++) if (inR(x, y, this.r(i))) this.key(this.label(i));
  }
  override key(k: string): void {
    if (this.finished) return;
    if (k === 'Backspace' || k === '✕') this.typed = '';
    else if (k === 'Enter' || k === '✓') {
      const ok = this.onEnter ? this.onEnter(this.typed) : this.typed === this.code;
      if (ok) this.complete();
      else {
        this.host.sound('wrong');
        this.say('Wrong code');
        this.typed = '';
      }
      return;
    } else if (/^\d$/.test(k) && this.typed.length < 5) this.typed += k;
    else return;
    this.host.sound('click');
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, this.info.label, 300, 64, 28);
    // The note / ID card with the code.
    ctx.save();
    ctx.translate(150, 300);
    ctx.rotate(-0.08);
    rbox(ctx, -110, -90, 220, 180, this.onEnter ? '#fff59a' : '#d9ecff', 8);
    if (!this.onEnter) {
      rbox(ctx, -90, -70, 70, 80, this.info.color ?? '#c51111', 8);
    }
    text(ctx, this.onEnter ? 'Today’s code:' : 'ID', this.onEnter ? 0 : 40, -40, 20, '#333', 'center', 'Nunito');
    text(ctx, this.code, 0, 40, 40, '#222', 'center', 'Nunito');
    ctx.restore();
    rbox(ctx, 300, 96, 238, 50, '#0f1a14', 8);
    text(ctx, this.typed || '·····', 419, 121, 32, '#7dff7d', 'center', 'Nunito');
    for (let i = 0; i < 12; i++) {
      rbox(ctx, ...this.r(i), i === 9 ? '#e8434a' : i === 11 ? '#2fa84f' : '#c9d2dc', 10);
      text(ctx, this.label(i), this.r(i)[0] + 37, this.r(i)[1] + 37, 32);
    }
  }
}

/** Drag items into their places (Assemble Artifact, Sort Samples, Store Artifacts). */
class DragSort extends Panel {
  private items: Array<{ x: number; y: number; kind: number; home: [number, number] | null; done: boolean }> = [];
  private drag = -1;
  constructor(h: PanelHost, i: PanelInfo, private targets: Array<{ x: number; y: number; w: number; h: number; kind: number }>, kinds: number[], private art: (ctx: Ctx, k: number, x: number, y: number) => void, private title: string) {
    super(h, i);
    for (const k of kinds) this.items.push({ x: rand(80, 520), y: rand(110, 280), kind: k, home: null, done: false });
  }
  protected override onDown(x: number, y: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      if (!it.done && Math.hypot(it.x - x, it.y - y) < 40) {
        this.drag = i;
        return;
      }
    }
  }
  protected override onMove(x: number, y: number): void {
    const it = this.items[this.drag];
    if (it) [it.x, it.y] = [x, y];
  }
  protected override onUp(): void {
    const it = this.items[this.drag];
    this.drag = -1;
    if (!it) return;
    const tg = this.targets.find((t) => t.kind === it.kind && Math.abs(it.x - t.x) < t.w / 2 + 10 && Math.abs(it.y - t.y) < t.h / 2 + 10);
    if (tg) {
      it.done = true;
      it.home = [tg.x, tg.y];
      if (this.targets.length === this.items.length) [it.x, it.y] = [tg.x, tg.y];
      this.host.sound('click');
      if (this.items.every((i) => i.done)) this.complete();
    }
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, this.title, 300, 60, 28);
    for (const t of this.targets) {
      ctx.setLineDash([8, 6]);
      rbox(ctx, t.x - t.w / 2, t.y - t.h / 2, t.w, t.h, 'rgba(255,255,255,0.08)', 10, 3);
      ctx.setLineDash([]);
      if (this.targets.length !== this.items.length) {
        ctx.globalAlpha = 0.35;
        this.art(ctx, t.kind, t.x, t.y);
        ctx.globalAlpha = 1;
      }
    }
    for (const it of this.items) this.art(ctx, it.kind, it.x, it.y);
  }
}

class Wheel extends Panel {
  private a = 0;
  private total = 0;
  private last: number | null = null;
  protected override onDown(x: number, y: number): void {
    this.last = Math.atan2(y - 300, x - 300);
  }
  protected override onMove(x: number, y: number): void {
    if (this.last === null || !this.pressed) return;
    const a = Math.atan2(y - 300, x - 300);
    let d = a - this.last;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    if (d > 0) {
      this.a += d;
      this.total += d;
    }
    this.last = a;
    if (this.total > Math.PI * 2) this.complete();
  }
  protected override onUp(): void {
    this.last = null;
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, this.info.label, 300, 64, 28);
    circle(ctx, 300, 300, 190, '#2b3340');
    ctx.save();
    ctx.translate(300, 300);
    ctx.rotate(this.a);
    ctx.lineWidth = 26;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.arc(0, 0, 150, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 18;
    ctx.strokeStyle = '#e04a3b';
    ctx.stroke();
    for (let k = 0; k < 4; k++) {
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#e04a3b';
      ctx.fillRect(-8, 0, 16, 150);
    }
    circle(ctx, 0, 0, 30, '#c9d2dc');
    ctx.restore();
    bar(ctx, 100, 510, 400, 30, Math.min(1, this.total / (Math.PI * 2)), '#4fb6ff');
    text(ctx, '↻ Turn the wheel', 300, 120, 22);
  }
}

class Temperature extends Panel {
  private target = Math.round(rand(-70, 99));
  private v = Math.round(rand(-70, 99));
  protected override onDown(x: number, y: number): void {
    if (inR(x, y, [400, 140, 120, 120])) this.v++;
    else if (inR(x, y, [400, 340, 120, 120])) this.v--;
    else return;
    this.host.sound('click');
    if (this.v === this.target) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, 'Record Temperature', 300, 60, 28);
    rbox(ctx, 70, 120, 140, 70, '#0f1a14', 8);
    text(ctx, 'LOG', 140, 108, 18);
    text(ctx, `${this.target}`, 140, 155, 36, '#7dff7d', 'center', 'Nunito');
    rbox(ctx, 230, 220, 140, 200, '#d9ecff', 60);
    const f = (this.v + 80) / 190;
    ctx.fillStyle = '#e8434a';
    ctx.fillRect(285, 400 - 160 * f, 30, 160 * f);
    text(ctx, `${this.v}°`, 300, 470, 40, '#fff', 'center', 'Nunito');
    button(ctx, [400, 140, 120, 120], '▲', '#3f8cff', false, 50);
    button(ctx, [400, 340, 120, 120], '▼', '#3f8cff', false, 50);
  }
}

class Wifi extends Panel {
  private lever = 0;
  private drag = false;
  private get left(): number | null {
    const e = timers.get(this.info.key);
    return e === undefined ? null : Math.max(0, e - now());
  }
  constructor(h: PanelHost, i: PanelInfo) {
    super(h, i);
    if (this.left !== null) this.lever = 1;
  }
  protected override onDown(x: number, y: number): void {
    this.drag = x > 380 && Math.abs(y - (150 + this.lever * 280)) < 60;
  }
  protected override onMove(_x: number, y: number): void {
    if (!this.drag) return;
    const l = this.left;
    // Can't push it back up until the reboot is over.
    const min = l === null ? 0 : l > 0 ? 1 : 0;
    this.lever = Math.max(min, Math.min(1, (y - 150) / 280));
  }
  protected override onUp(): void {
    this.drag = false;
    const l = this.left;
    if (l === null && this.lever > 0.95) {
      timers.set(this.info.key, now() + 60);
      this.lever = 1;
      this.say('Rebooting… come back later.', 2.5);
    } else if (l === 0 && this.lever < 0.05) {
      timers.delete(this.info.key);
      this.complete();
    } else this.lever = l === null ? 0 : 1;
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, 'Reboot Wifi', 240, 64, 28);
    rbox(ctx, 60, 120, 280, 300, '#14181e', 12);
    const l = this.left;
    text(ctx, l === null ? 'ONLINE' : l > 0 ? `REBOOTING ${Math.ceil(l)}s` : 'READY', 200, 270, 26, l === null ? '#ff6b6b' : l > 0 ? '#ffd23f' : '#7dff7d', 'center', 'Nunito');
    rbox(ctx, 440, 130, 24, 320, '#1a1d24', 10);
    rbox(ctx, 400, 150 + this.lever * 280 - 30, 104, 60, '#c9d2dc', 14);
    text(ctx, l === 0 ? 'PUSH UP' : 'PULL DOWN', 452, 500, 20);
  }
}

class Drill extends Panel {
  private xs = Array.from({ length: 4 }, () => ({ x: rand(110, 490), y: rand(160, 460), hp: 3 }));
  protected override onDown(x: number, y: number): void {
    for (const p of this.xs)
      if (p.hp > 0 && Math.hypot(p.x - x, p.y - y) < 45) {
        p.hp--;
        this.host.sound('click');
      }
    if (this.xs.every((p) => p.hp <= 0)) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx, '#4a5361', '#2b2e24');
    text(ctx, 'Repair Drill', 300, 64, 28);
    for (const p of this.xs) {
      if (p.hp <= 0) continue;
      rbox(ctx, p.x - 40, p.y - 40, 80, 80, '#ffd23f', 10);
      text(ctx, '!', p.x, p.y, 50, '#e8434a');
      text(ctx, '●'.repeat(p.hp), p.x, p.y + 55, 16, '#fff', 'center', 'Nunito');
    }
  }
}

class Boarding extends Panel {
  private flipped = false;
  private x = 170;
  private y = 330;
  private drag = false;
  protected override onDown(x: number, y: number): void {
    if (Math.abs(x - this.x) < 100 && Math.abs(y - this.y) < 130) {
      if (!this.flipped) {
        this.flipped = true;
        this.host.sound('click');
      } else this.drag = true;
    }
  }
  protected override onMove(x: number, y: number): void {
    if (this.drag) [this.x, this.y] = [x, y];
  }
  protected override onUp(): void {
    this.drag = false;
    if (this.flipped && this.x > 380 && Math.abs(this.y - 300) < 120) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, 'Scan Boarding Pass', 300, 60, 28);
    rbox(ctx, 400, 160, 160, 280, '#1a1d24', 14);
    ctx.fillStyle = this.drag ? '#ff4f4f' : '#7a1f1f';
    ctx.fillRect(410, 290, 140, 6);
    rbox(ctx, this.x - 90, this.y - 120, 180, 240, '#f5f1e6', 10);
    if (!this.flipped) {
      rbox(ctx, this.x - 60, this.y - 90, 120, 110, this.info.color ?? '#c51111', 10);
      text(ctx, 'tap to flip', this.x, this.y + 70, 18, '#333', 'center', 'Nunito');
    } else for (let i = 0; i < 18; i++) {
      ctx.fillStyle = '#111';
      ctx.fillRect(this.x - 70 + i * 8, this.y - 40, (i * 7) % 3 === 0 ? 5 : 2, 80);
    }
  }
}

class Telescope extends Panel {
  private ox = rand(-500, 0);
  private oy = rand(-500, 0);
  private tx = rand(150, 950);
  private ty = rand(150, 950);
  private drag: [number, number] | null = null;
  private stars = Array.from({ length: 160 }, () => [rand(0, 1100), rand(0, 1100), rand(1, 3)]);
  protected override onDown(x: number, y: number): void {
    if (Math.hypot(x - (this.tx + this.ox), y - (this.ty + this.oy)) < 45 && x > 30 && x < 570 && y > 30 && y < 570) return this.complete();
    this.drag = [x - this.ox, y - this.oy];
  }
  protected override onMove(x: number, y: number): void {
    if (!this.drag) return;
    this.ox = Math.max(-560, Math.min(60, x - this.drag[0]));
    this.oy = Math.max(-560, Math.min(60, y - this.drag[1]));
  }
  protected override onUp(): void {
    this.drag = null;
  }
  private planet(ctx: Ctx, x: number, y: number, s: number): void {
    circle(ctx, x, y, 34 * s, '#ff9f43', 4);
    ctx.strokeStyle = '#ffe6a8';
    ctx.lineWidth = 6 * s;
    ctx.beginPath();
    ctx.ellipse(x, y, 52 * s, 14 * s, -0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  protected draw(ctx: Ctx): void {
    rbox(ctx, 6, 6, SZ - 12, SZ - 12, '#04050c', 22, 6);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(12, 12, SZ - 24, SZ - 24, 18);
    ctx.clip();
    for (const [x, y, s] of this.stars) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(x! + this.ox, y! + this.oy, s!, s!);
    }
    for (const [k, [x, y]] of [[0, [300, 800]], [1, [900, 300]]] as const) {
      circle(ctx, x + this.ox, y + this.oy, 30, k ? '#5fd6ff' : '#9a7bff');
    }
    this.planet(ctx, this.tx + this.ox, this.ty + this.oy, 1);
    ctx.restore();
    rbox(ctx, 470, 470, 110, 110, '#1a1d24', 10);
    this.planet(ctx, 525, 525, 0.6);
    text(ctx, 'Find & tap', 525, 455, 18);
  }
}

class Maze extends Panel {
  /** Fix Weather Node: trace a path through the grid from left to right. */
  private N = 8;
  private open: boolean[] = [];
  private path: number[] = [];
  private start: number;
  private end: number;
  constructor(h: PanelHost, i: PanelInfo) {
    super(h, i);
    const N = this.N;
    // Carve a random walk from left to right, then open some extra cells.
    this.open = Array(N * N).fill(false);
    let r = Math.floor(rand(0, N));
    this.start = r * N;
    let c = 0;
    this.open[r * N] = true;
    while (c < N - 1) {
      const m = Math.random();
      if (m < 0.5) c++;
      else if (m < 0.75 && r > 0) r--;
      else if (r < N - 1) r++;
      this.open[r * N + c] = true;
    }
    this.end = r * N + c;
    for (let k = 0; k < 14; k++) this.open[Math.floor(rand(0, N * N))] = true;
  }
  private cellAt(x: number, y: number): number {
    const s = 60;
    const c = Math.floor((x - 60) / s);
    const r = Math.floor((y - 80) / s);
    return c >= 0 && r >= 0 && c < this.N && r < this.N ? r * this.N + c : -1;
  }
  protected override onDown(x: number, y: number): void {
    if (this.cellAt(x, y) === this.start) this.path = [this.start];
  }
  protected override onMove(x: number, y: number): void {
    if (!this.path.length || !this.pressed) return;
    const k = this.cellAt(x, y);
    const last = this.path[this.path.length - 1]!;
    if (k < 0 || k === last || !this.open[k]) return;
    if (this.path.length > 1 && this.path[this.path.length - 2] === k) return void this.path.pop();
    const adj = Math.abs((k % this.N) - (last % this.N)) + Math.abs(Math.floor(k / this.N) - Math.floor(last / this.N)) === 1;
    if (adj && !this.path.includes(k)) {
      this.path.push(k);
      if (k === this.end) this.complete();
    }
  }
  protected override onUp(): void {
    if (!this.finished) this.path = [];
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, 'Fix Weather Node', 300, 50, 26);
    for (let k = 0; k < this.N * this.N; k++) {
      const x = 60 + (k % this.N) * 60;
      const y = 80 + Math.floor(k / this.N) * 60;
      rbox(ctx, x + 3, y + 3, 54, 54, k === this.start ? '#44d36b' : k === this.end ? '#ffd23f' : this.open[k] ? '#5b6676' : '#1a1d24', 6, 3);
    }
    if (this.path.length) {
      ctx.strokeStyle = '#4fb6ff';
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.path.forEach((k, i) => {
        const x = 90 + (k % this.N) * 60;
        const y = 110 + Math.floor(k / this.N) * 60;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
  }
}

class Sliders extends Panel {
  /** Monitor Tree: match four sliders to their marks. */
  private target = Array.from({ length: 4 }, () => rand(0.1, 0.9));
  private v = Array.from({ length: 4 }, () => rand(0.1, 0.9));
  private drag = -1;
  protected override onDown(x: number, y: number): void {
    for (let i = 0; i < 4; i++) if (Math.abs(x - (120 + i * 120)) < 50 && Math.abs(y - (480 - this.v[i]! * 340)) < 40) this.drag = i;
  }
  protected override onMove(_x: number, y: number): void {
    if (this.drag >= 0) this.v[this.drag] = Math.max(0, Math.min(1, (480 - y) / 340));
  }
  protected override onUp(): void {
    this.drag = -1;
    if (this.v.every((v, i) => Math.abs(v - this.target[i]!) < 0.04)) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx, '#4a5361', '#24382a');
    text(ctx, 'Monitor Tree', 300, 60, 28);
    const cols = ['#44d36b', '#4fb6ff', '#ffd23f', '#ff6b9a'];
    for (let i = 0; i < 4; i++) {
      const x = 120 + i * 120;
      rbox(ctx, x - 14, 140, 28, 340, '#1a1d24', 10);
      const ty = 480 - this.target[i]! * 340;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 34, ty - 3, 68, 6);
      const ok = Math.abs(this.v[i]! - this.target[i]!) < 0.04;
      rbox(ctx, x - 30, 480 - this.v[i]! * 340 - 20, 60, 40, ok ? '#7dff7d' : cols[i]!, 10);
    }
  }
}

class Canister extends Panel {
  private n = 0;
  private x = 140;
  private y = 420;
  private drag = false;
  private f = 0;
  protected override onDown(x: number, y: number): void {
    this.drag = Math.abs(x - this.x) < 60 && Math.abs(y - this.y) < 80;
  }
  protected override onMove(x: number, y: number): void {
    if (this.drag) [this.x, this.y] = [x, y];
  }
  protected override onUp(): void {
    this.drag = false;
  }
  protected override tick(dt: number): void {
    const docked = Math.abs(this.x - 420) < 50 && Math.abs(this.y - 260) < 60;
    if (docked) {
      [this.x, this.y] = [420, 260];
      this.f += dt / 1.6;
      if (this.f >= 1) {
        this.n++;
        this.f = 0;
        this.host.sound('click');
        [this.x, this.y] = [140, 420];
        this.drag = false;
        if (this.n >= 2) this.complete();
      }
    }
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, `Fill Canisters  ${this.n}/2`, 300, 60, 28);
    rbox(ctx, 380, 100, 80, 80, '#7b8492', 8);
    ctx.fillStyle = '#4fb6ff';
    ctx.fillRect(412, 180, 16, 20);
    rbox(ctx, this.x - 45, this.y - 70, 90, 140, '#d9ecff', 20);
    ctx.fillStyle = '#4fb6ff';
    ctx.fillRect(this.x - 35, this.y + 60 - 120 * this.f, 70, 120 * this.f);
  }
}

class Keys extends Panel {
  private slot = Math.floor(rand(0, 7));
  private kx = 300;
  private ky = 500;
  private inserted = false;
  private turn = 0;
  private drag = false;
  protected override onDown(x: number, y: number): void {
    if (!this.inserted) this.drag = Math.hypot(x - this.kx, y - this.ky) < 60;
    else this.drag = true;
  }
  protected override onMove(x: number, y: number): void {
    if (!this.drag) return;
    if (!this.inserted) [this.kx, this.ky] = [x, y];
    else this.turn = Math.max(0, Math.min(1, (x - this.kx) / 80));
  }
  protected override onUp(): void {
    this.drag = false;
    const sx = 90 + this.slot * 70;
    if (!this.inserted && Math.abs(this.kx - sx) < 30 && Math.abs(this.ky - 260) < 50) {
      this.inserted = true;
      [this.kx, this.ky] = [sx, 260];
      this.host.sound('click');
    } else if (this.inserted && this.turn > 0.9) this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, 'Insert Keys', 300, 60, 28);
    for (let i = 0; i < 7; i++) {
      const x = 90 + i * 70;
      rbox(ctx, x - 26, 200, 52, 120, i === this.slot ? '#ffd23f' : '#5b6676', 10);
      ctx.fillStyle = INK;
      ctx.fillRect(x - 4, 230, 8, 60);
    }
    ctx.save();
    ctx.translate(this.kx, this.ky);
    ctx.rotate(this.turn * (Math.PI / 2));
    rbox(ctx, -30, -30, 60, 60, this.info.color ?? '#c51111', 30);
    rbox(ctx, -6, 20, 12, 60, '#c9a24a', 3, 3);
    ctx.restore();
    if (this.inserted) text(ctx, 'Drag right to turn →', 300, 420, 22);
  }
}

// ---------------------------------------------------------------- sabotage panels

class Lights extends Panel {
  protected override onDown(x: number, y: number): void {
    const s = this.host.view()?.sabotage;
    if (!s || s.kind !== 'lights') return;
    for (let i = 0; i < 5; i++)
      if (Math.abs(x - (100 + i * 100)) < 40 && y > 220 && y < 480) {
        this.host.act({ k: 'switch', i });
        this.host.sound('click');
      }
  }
  protected override tick(): void {
    if (this.host.view()?.sabotage?.kind !== 'lights') this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx, '#5a5f48', '#2b2e24');
    text(ctx, 'Fix Lights', 300, 60, 30);
    const sw = this.host.view()?.sabotage?.switches ?? [true, true, true, true, true];
    for (let i = 0; i < 5; i++) {
      const x = 100 + i * 100;
      circle(ctx, x, 150, 22, sw[i] ? '#7dff7d' : '#2b4a2b');
      rbox(ctx, x - 30, 230, 60, 240, '#1a1d24', 10);
      rbox(ctx, x - 26, sw[i] ? 236 : 360, 52, 106, '#c9d2dc', 8);
    }
  }
}

class Hold extends Panel {
  private on = false;
  protected override onDown(x: number, y: number): void {
    if (Math.hypot(x - 300, y - 320) < 150) {
      this.on = true;
      this.host.act({ k: 'hold', station: this.info.station ?? 0, on: true });
    }
  }
  protected override onUp(): void {
    this.release();
  }
  override release(): void {
    if (!this.on) return;
    this.on = false;
    this.host.act({ k: 'hold', station: this.info.station ?? 0, on: false });
  }
  protected override tick(): void {
    const s = this.host.view()?.sabotage;
    if (!s || (s.kind !== 'reactor' && s.kind !== 'seismic')) this.complete();
  }
  protected draw(ctx: Ctx): void {
    const s = this.host.view()?.sabotage;
    panelBg(ctx, '#5b4040', '#2a1a1a');
    text(ctx, s?.kind === 'seismic' ? 'Seismic Stabilizer' : 'Reactor Meltdown', 300, 60, 30, '#ff6b6b');
    circle(ctx, 300, 320, 150, this.on ? '#2f6b45' : '#1a2a2a');
    // The hand.
    ctx.fillStyle = this.on ? '#7dff9a' : '#4fb6ff';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(240, 300, 120, 110, 30);
    ctx.fill();
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.roundRect(240 + k * 31, 190 + Math.abs(k - 1.5) * 14, 26, 120, 13);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.roundRect(350, 300, 60, 26, 13);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (this.on) {
      ctx.fillStyle = 'rgba(125,255,154,0.6)';
      ctx.fillRect(160, 180 + ((this.t * 300) % 280), 280, 6);
    }
    text(ctx, this.on ? 'Waiting for the second hand…' : 'Hold to stop', 300, 520, 24, this.on ? '#7dff7d' : '#fff');
  }
}

class Comms extends Panel {
  private target = rand(0.6, 2.6);
  private v = rand(0, Math.PI);
  private drag = false;
  protected override onDown(x: number, y: number): void {
    this.drag = Math.hypot(x - 450, y - 420) < 110;
  }
  protected override onMove(x: number, y: number): void {
    if (this.drag) this.v = Math.max(0, Math.min(Math.PI, Math.atan2(420 - y, 450 - x)));
  }
  protected override onUp(): void {
    this.drag = false;
    if (Math.abs(this.v - this.target) < 0.08) {
      this.host.act({ k: 'comms', station: this.info.station ?? 0 });
      this.complete();
    }
  }
  protected override tick(): void {
    if (this.host.view()?.sabotage?.kind !== 'comms') this.complete();
  }
  protected draw(ctx: Ctx): void {
    panelBg(ctx);
    text(ctx, 'Comms Sabotaged', 300, 56, 28, '#ff6b6b');
    rbox(ctx, 50, 100, 500, 200, '#0f1a14', 10);
    const err = Math.abs(this.v - this.target);
    ctx.strokeStyle = err < 0.08 ? '#7dff7d' : '#ff6b6b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = 60; x < 540; x += 4) {
      const n = Math.sin(x * 0.07 + this.t * 8) * 50 * Math.min(1, err * 2) + Math.sin(x * 0.4 + this.t * 30) * 30 * Math.min(1, err * 3);
      const y = 200 + Math.sin(x * 0.05) * 30 + n;
      if (x === 60) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    circle(ctx, 450, 420, 100, '#2b3340');
    ctx.save();
    ctx.translate(450, 420);
    ctx.rotate(-this.v);
    rbox(ctx, -90, -10, 90, 20, '#ffd23f', 8);
    ctx.restore();
    text(ctx, 'Tune the dial', 180, 420, 26);
  }
}

// ---------------------------------------------------------------- factory

const ART_KINDS = ['#9a7bff', '#4fb6ff', '#ffd23f', '#ff6b9a', '#44d36b'];
function gem(ctx: Ctx, k: number, x: number, y: number): void {
  ctx.beginPath();
  const n = 3 + (k % 4);
  for (let i = 0; i < n; i++) ctx.lineTo(x + Math.cos((i / n) * Math.PI * 2) * 34, y + Math.sin((i / n) * Math.PI * 2) * 34);
  ctx.closePath();
  ctx.fillStyle = ART_KINDS[k % 5]!;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

export function makePanel(host: PanelHost, info: PanelInfo): Panel {
  const P = (button: string, secs: number, art: (ctx: Ctx, f: number, t: number) => void, hold = false, col?: string) => new ProgressPanel(host, info, { button, secs, art, hold, col });
  const files = (ctx: Ctx, f: number, t: number) => {
    rbox(ctx, 70, 150, 130, 100, '#ffd23f', 10);
    rbox(ctx, 400, 150, 130, 100, '#ffd23f', 10);
    if (f > 0 && f < 1) for (let k = 0; k < 3; k++) {
      const p = (t * 0.9 + k / 3) % 1;
      rbox(ctx, 120 + p * 330, 180 - Math.sin(p * Math.PI) * 90, 34, 40, '#fff', 4, 3);
    }
  };
  switch (info.kind) {
    case 'swipe':
      return new Swipe(host, info);
    case 'wires':
      return new Wires(host, info);
    case 'download':
      return P('Download', 8, files);
    case 'upload':
      return P('Upload', 8, files);
    case 'process':
      return P('Process', 6, files);
    case 'weather':
      return P('Measure', 6, (ctx, f, t) => {
        circle(ctx, 300, 220, 110, '#0f2a4f');
        ctx.save();
        ctx.translate(300, 220);
        ctx.rotate(t * (f > 0 && f < 1 ? 6 : 0));
        ctx.fillStyle = '#fff';
        ctx.fillRect(-4, -100, 8, 100);
        ctx.restore();
      });
    case 'fuel':
      return new Fuel(host, info);
    case 'jug':
      return P(/fill/i.test(info.label) ? 'Fill' : 'Pour', 2.5, (ctx, f) => {
        rbox(ctx, 220, 110, 160, 230, '#d9ecff', 30);
        ctx.fillStyle = '#4fb6ff';
        ctx.fillRect(228, 334 - 220 * f, 144, 220 * f);
      }, true, '#4fb6ff');
    case 'garbage':
      return new Garbage(host, info);
    case 'asteroids':
      return new Asteroids(host, info);
    case 'shields':
      return new Shields(host, info);
    case 'o2filter':
      return new O2Filter(host, info);
    case 'chart':
      return new Chart(host, info);
    case 'steering':
      return new Steering(host, info);
    case 'align':
      return new Align(host, info);
    case 'calibrate':
      return new Calibrate(host, info);
    case 'divert':
      return new Divert(host, info);
    case 'accept':
      return new Accept(host, info);
    case 'sample':
      return new Waiting(host, info, 60, 5, 'Inspect Sample');
    case 'diagnostics':
      return new Waiting(host, info, 90, 4, 'Run Diagnostics');
    case 'scan':
      return new Scan(host, info);
    case 'reactor':
      return new Simon(host, info);
    case 'manifolds':
      return new Manifolds(host, info);
    case 'beverage':
      return new Pick(host, info);
    case 'water':
      return new Water(host, info);
    case 'idcode':
      return new Keypad(host, info);
    case 'artifact':
      return new DragSort(host, info, [0, 1, 2, 3, 4].map((k) => ({ x: 170 + (k % 3) * 130, y: 380 + Math.floor(k / 3) * 110, w: 90, h: 90, kind: k })), [0, 1, 2, 3, 4], gem, 'Assemble Artifact');
    case 'store':
      return new DragSort(host, info, [0, 1, 2, 3].map((k) => ({ x: 120 + k * 120, y: 460, w: 100, h: 100, kind: k })), [0, 1, 2, 3], gem, 'Store Artifacts');
    case 'sort': {
      const kinds = [0, 0, 1, 1, 2, 2];
      const icon = (ctx: Ctx, k: number, x: number, y: number) => {
        if (k === 0) rbox(ctx, x - 28, y - 22, 56, 44, '#d9c27a', 20);
        else if (k === 1) circle(ctx, x, y, 26, '#7a4a25');
        else {
          ctx.beginPath();
          ctx.ellipse(x, y, 30, 18, 0.6, 0, Math.PI * 2);
          ctx.fillStyle = '#44d36b';
          ctx.fill();
          ctx.lineWidth = 4;
          ctx.strokeStyle = INK;
          ctx.stroke();
        }
      };
      return new DragSort(host, info, [0, 1, 2].map((k) => ({ x: 130 + k * 170, y: 460, w: 150, h: 120, kind: k })), kinds, icon, 'Sort Samples');
    }
    case 'canister':
      return new Canister(host, info);
    case 'keys':
      return new Keys(host, info);
    case 'waterways':
      return new Wheel(host, info);
    case 'temperature':
      return new Temperature(host, info);
    case 'wifi':
      return new Wifi(host, info);
    case 'drill':
      return new Drill(host, info);
    case 'boarding':
      return new Boarding(host, info);
    case 'telescope':
      return new Telescope(host, info);
    case 'node':
      return new Maze(host, info);
    case 'tree':
      return new Sliders(host, info);
    case 'lights':
      return new Lights(host, info);
    case 'o2': {
      const code = host.view()?.sabotage?.code ?? '00000';
      return new Keypad(host, info, (c) => {
        if (c !== code) return false;
        host.act({ k: 'o2', station: info.station ?? 0, code: c });
        return true;
      }, code);
    }
    case 'reactor-fix':
    case 'seismic':
      return new Hold(host, info);
    case 'comms':
      return new Comms(host, info);
  }
}
