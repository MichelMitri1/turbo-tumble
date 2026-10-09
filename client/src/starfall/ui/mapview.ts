import { COLORS, type Action } from '../sim/game';
import type { MapDef, SabotageKind, Spot } from '../sim/maps';
import type { SfView } from '../sim/view';
import { beanIcon } from '../render/art';
import { ICON } from './icons';

/**
 * The holographic ship map (your tasks in yellow, sabotages in red), the impostor's sabotage
 * map (one button per system + every set of doors), the admin table (people per room),
 * security cameras and vitals.
 */

type Rect = [number, number, number, number];

export function roomCenter(def: MapDef, name: string): Spot {
  const r = def.rooms.find((x) => x.name === name);
  if (!r) return { x: 0, y: 0 };
  if (r.rect) return { x: (r.rect[0] + r.rect[2]) / 2, y: (r.rect[1] + r.rect[3]) / 2 };
  const pts = r.poly!;
  return { x: pts.reduce((a, p) => a + p[0], 0) / pts.length, y: pts.reduce((a, p) => a + p[1], 0) / pts.length };
}

const SAB_LABEL: Record<SabotageKind, string> = { reactor: 'Reactor', o2: 'Oxygen', lights: 'Lights', comms: 'Comms', seismic: 'Seismic' };

export class MapOverlay {
  readonly el: HTMLDivElement;
  private c: HTMLCanvasElement;
  private sabs: HTMLElement;
  private fit = { s: 1, ox: 0, oy: 0 };
  private btns: Array<{ el: HTMLButtonElement; kind: SabotageKind | 'doors'; room?: string; at: Spot }> = [];

  constructor(root: HTMLElement, private def: MapDef, readonly mode: 'map' | 'sabotage' | 'admin', private act: (a: Action) => void, private close: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'ov';
    this.el.innerHTML = `<div class="mapov"><canvas></canvas><h3 class="disp">${mode === 'admin' ? 'Admin' : mode === 'sabotage' ? 'Sabotage' : def.name}</h3><div class="sabs"></div><button class="closex">✕</button></div>`;
    root.appendChild(this.el);
    this.c = this.el.querySelector('canvas')!;
    this.sabs = this.el.querySelector('.sabs')!;
    (this.el.querySelector('.closex') as HTMLElement).onclick = close;
    this.el.onclick = (e) => {
      if (e.target === this.el) close();
    };
    if (mode === 'sabotage') {
      for (const [kind, spots] of Object.entries(def.sabotage) as Array<[SabotageKind, Spot[]]>) {
        if (!spots?.length) continue;
        // Put the button in the room of its first station.
        const at = { x: spots.reduce((a, s) => a + s.x, 0) / spots.length, y: spots.reduce((a, s) => a + s.y, 0) / spots.length };
        if (kind === 'reactor' || kind === 'seismic' || kind === 'o2') Object.assign(at, spots[0]!);
        this.addBtn(kind, ICON[kind], SAB_LABEL[kind], at);
      }
      for (const room of new Set(def.doors.map((d) => d.room))) {
        const at = roomCenter(def, room);
        this.addBtn('doors', ICON.door, `Close ${room} doors`, { x: at.x, y: at.y + 1.6 }, room);
      }
    }
  }

  private addBtn(kind: SabotageKind | 'doors', svg: string, title: string, at: Spot, room?: string): void {
    const b = document.createElement('button');
    b.innerHTML = `${svg}<em></em>`;
    b.title = title;
    if (kind === 'doors') b.classList.add('door');
    b.onclick = (e) => {
      e.stopPropagation();
      this.act({ k: 'sabotage', kind, room });
      if (kind !== 'doors') this.close();
    };
    this.sabs.appendChild(b);
    this.btns.push({ el: b, kind, room, at });
  }

  private toS(x: number, y: number): [number, number] {
    return [x * this.fit.s + this.fit.ox, y * this.fit.s + this.fit.oy];
  }

  update(v: SfView, me: Spot, tasks: Spot[], alerts: Spot[], t: number): void {
    const c = this.c;
    const dpr = Math.min(2, devicePixelRatio);
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
    if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const b = this.def.bounds;
    const s = Math.min((W - 60) / (b[2] - b[0]), (H - 90) / (b[3] - b[1]));
    this.fit = { s, ox: W / 2 - ((b[0] + b[2]) / 2) * s, oy: H / 2 + 20 - ((b[1] + b[3]) / 2) * s };
    ctx.clearRect(0, 0, W, H);
    const rect = (r: Rect) => {
      const [x0, y0] = this.toS(r[0], r[1]);
      const [x1, y1] = this.toS(r[2], r[3]);
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
    };
    // Outline pass then fill pass: joined shapes read as one ship.
    const shapes = () => {
      ctx.beginPath();
      for (const o of this.def.outdoor ?? []) rect(o.rect);
      for (const h of this.def.halls) rect(h);
      for (const r of this.def.rooms) {
        if (r.rect) rect(r.rect);
        else {
          r.poly!.forEach(([x, y], i) => {
            const [sx, sy] = this.toS(x, y);
            if (i) ctx.lineTo(sx, sy);
            else ctx.moveTo(sx, sy);
          });
          ctx.closePath();
        }
      }
    };
    shapes();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#bfe3ff';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fillStyle = '#3d7bc4';
    ctx.fill('nonzero');
    // Doors.
    const closed = new Set(v.doors);
    for (const d of this.def.doors) if (closed.has(d.room)) {
      ctx.beginPath();
      rect(d.rect);
      ctx.fillStyle = '#ff4f4f';
      ctx.fill();
    }
    // Room names.
    ctx.font = `900 ${Math.max(10, Math.min(16, s * 0.7))}px Nunito, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of this.def.rooms) {
      const at = roomCenter(this.def, r.name);
      const [x, y] = this.toS(at.x, at.y);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#0b2a52';
      ctx.strokeText(r.name, x, y - (this.mode === 'admin' ? 14 : 0));
      ctx.fillStyle = '#fff';
      ctx.fillText(r.name, x, y - (this.mode === 'admin' ? 14 : 0));
    }
    // Admin: little grey beans per room.
    if (this.mode === 'admin' && v.admin) {
      for (const [room, n] of Object.entries(v.admin)) {
        const at = roomCenter(this.def, room);
        const [x, y] = this.toS(at.x, at.y);
        const sz = Math.max(16, s * 1.1);
        for (let i = 0; i < n; i++) drawMini(ctx, x - ((Math.min(n, 6) - 1) * sz * 0.6) / 2 + (i % 6) * sz * 0.6, y + 8 + Math.floor(i / 6) * sz * 0.7, sz, '#c7d3df');
      }
    } else if (this.mode === 'admin') {
      ctx.font = '400 28px "Lilita One", sans-serif';
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText('Comms Sabotaged', W / 2, H / 2);
    }
    // My tasks and alarms.
    const pulse = Math.sin(t * 6) > 0;
    if (this.mode !== 'admin') {
      for (const s2 of tasks) {
        const [x, y] = this.toS(s2.x, s2.y);
        ctx.font = '400 22px "Lilita One", sans-serif';
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#0b0b14';
        ctx.strokeText('!', x, y);
        ctx.fillStyle = '#ffd23f';
        ctx.fillText('!', x, y);
      }
      for (const a of alerts) {
        const [x, y] = this.toS(a.x, a.y);
        ctx.beginPath();
        ctx.arc(x, y, pulse ? 12 : 8, 0, Math.PI * 2);
        ctx.fillStyle = '#ff3b3b';
        ctx.fill();
      }
    }
    // Me.
    const col = COLORS[v.players[v.me]!.color]!;
    const [mx, my] = this.toS(me.x, me.y);
    drawMini(ctx, mx, my, 26, col[1]);
    // Sabotage buttons follow the fit.
    const cd = v.sabotageCd;
    for (const btn of this.btns) {
      const [x, y] = this.toS(btn.at.x, btn.at.y);
      btn.el.style.left = `${x}px`;
      btn.el.style.top = `${y}px`;
      const em = btn.el.querySelector('em')!;
      if (btn.kind === 'doors') {
        const left = v.doorCd[btn.room!] ?? 0;
        btn.el.disabled = left > 0 || closed.has(btn.room!);
        em.textContent = left > 0 ? String(Math.ceil(left)) : '';
      } else {
        btn.el.disabled = cd > 0 || !!v.sabotage;
        em.textContent = cd > 0 && !v.sabotage ? String(Math.ceil(cd)) : '';
      }
    }
  }

  dispose(): void {
    this.el.remove();
  }
}

function drawMini(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, col: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 40, size / 40);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#0b0b14';
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.roundRect(-18, -6, 8, 16, 3);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-12, -18, 24, 34, [12, 12, 5, 5]);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#95cadc';
  ctx.beginPath();
  ctx.roundRect(-2, -12, 15, 9, 5);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Security: every camera at once (static while comms are down). */
export class CamsUI {
  readonly el: HTMLDivElement;
  private cv: HTMLCanvasElement[] = [];
  constructor(root: HTMLElement, private def: MapDef, private drawCam: (ctx: CanvasRenderingContext2D, W: number, H: number, cam: Spot, v: SfView, t: number) => void, close: () => void) {
    const cams = def.cams ?? [];
    this.el = document.createElement('div');
    this.el.className = 'ov';
    this.el.innerHTML = `<div class="cams ${cams.length > 4 ? 'five' : ''}">${cams.map((c) => `<div><canvas></canvas><small>${c.name}</small></div>`).join('')}<button class="closex">✕</button></div>`;
    root.appendChild(this.el);
    this.cv = [...this.el.querySelectorAll('canvas')];
    (this.el.querySelector('.closex') as HTMLElement).onclick = close;
  }
  update(v: SfView, t: number): void {
    const comms = v.sabotage?.kind === 'comms';
    (this.def.cams ?? []).forEach((cam, i) => {
      const c = this.cv[i]!;
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== W) c.width = W;
      if (c.height !== H) c.height = H;
      const ctx = c.getContext('2d')!;
      if (comms) {
        const img = ctx.createImageData(W, H);
        for (let k = 0; k < img.data.length; k += 4) {
          const g = Math.random() * 255;
          img.data[k] = img.data[k + 1] = img.data[k + 2] = g;
          img.data[k + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        return;
      }
      this.drawCam(ctx, W, H, cam, v, t);
    });
  }
  dispose(): void {
    this.el.remove();
  }
}

export class VitalsUI {
  readonly el: HTMLDivElement;
  private box: HTMLElement;
  private key = '';
  constructor(root: HTMLElement, close: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'ov';
    this.el.innerHTML = '<div class="vitals"></div>';
    root.appendChild(this.el);
    this.box = this.el.querySelector('.vitals')!;
    this.el.onclick = (e) => {
      if (e.target === this.el) close();
    };
    const x = document.createElement('button');
    x.className = 'closex';
    x.textContent = '✕';
    x.onclick = close;
    this.box.appendChild(x);
  }
  update(v: SfView): void {
    const st = v.vitals;
    const key = JSON.stringify(st ?? null);
    if (key === this.key) return;
    this.key = key;
    const x = this.box.querySelector('.closex')!;
    this.box.innerHTML = st
      ? v.players.map((p, i) => `<div class="${st[i]}"><img src="${beanIcon(COLORS[p.color]![1], COLORS[p.color]![2], st[i] === 'dead', 64)}"><span>${p.name}<br><b>${st[i] === 'ok' ? 'OK' : st[i] === 'dead' ? 'DEAD' : 'D/C'}</b></span></div>`).join('')
      : '<h2 class="disp" style="grid-column:1/-1;text-align:center;color:#ff6b6b">Comms Sabotaged</h2>';
    this.box.appendChild(x);
  }
  dispose(): void {
    this.el.remove();
  }
}
