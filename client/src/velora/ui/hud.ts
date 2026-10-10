import type { Game } from '../game';
import { WEAPON, WEAPONS } from '../combat';
import type { City } from '../world/city';
import { HALF, SIZE, WATER_Y, coastZ } from '../world/layout';

const BOUNDS = { x0: -HALF, z0: -HALF, x1: HALF, z1: HALF };
import { SHOP_STYLE } from '../render/cityview';

/**
 * The on-screen display, laid out like the big open-world games: the radar bottom-left
 * (rotates with the camera, shows shops, cops, the search area and your GPS route) with
 * health / armour under it; stars, cash, weapon and ammo top-right; a help box top-left;
 * area / vehicle names bottom-right; big WASTED / BUSTED cards; and the weapon wheel.
 */

const MAP_PPM = 1; // map canvas pixels per metre

export class Hud {
  readonly el: HTMLDivElement;
  private radar: HTMLCanvasElement;
  private mapImg: HTMLCanvasElement;
  private $: Record<string, HTMLElement> = {};
  private flashT = 0;
  private helpT = 0;
  private nameT = 0;
  private wheelOpen = false;
  route: Array<[number, number]> = [];
  waypoint: { x: number; z: number } | null = null;

  constructor(parent: HTMLElement, private g: Game) {
    this.el = document.createElement('div');
    this.el.className = 'vhud';
    this.el.innerHTML = `
      <div class="v-help hidden"></div>
      <div class="v-topright">
        <div class="v-stars">${'<i>★</i>'.repeat(5)}</div>
        <div class="v-cash">$0</div>
        <div class="v-weapon"><span class="v-wname"></span><b class="v-ammo"></b></div>
      </div>
      <div class="v-radarbox"><canvas class="v-radar" width="300" height="190"></canvas><div class="v-bars"><i class="v-hp"><b></b></i><i class="v-armor"><b></b></i></div></div>
      <div class="v-names"><b class="v-area"></b><span class="v-street"></span><em class="v-vehicle"></em></div>
      <div class="v-flash"></div>
      <div class="v-cross"></div>
      <div class="v-scope hidden"></div>
      <div class="v-hurt"></div>
      <div class="v-big hidden"></div>
      <div class="v-wheel hidden"></div>
      <div class="v-clock"></div>`;
    parent.appendChild(this.el);
    for (const k of ['help', 'stars', 'cash', 'wname', 'ammo', 'hp', 'armor', 'area', 'street', 'vehicle', 'flash', 'cross', 'scope', 'hurt', 'big', 'wheel', 'clock']) this.$[k] = this.el.querySelector(`.v-${k}`)!;
    this.radar = this.el.querySelector('.v-radar')!;
    this.mapImg = drawMap(g.city);
  }

  flash(text: string, kind: 'wanted' | 'good' | 'info' = 'info'): void {
    const f = this.$.flash!;
    f.textContent = text;
    f.className = `v-flash on ${kind}`;
    this.flashT = 2.6;
  }
  help(text: string, secs = 0.2): void {
    this.$.help!.innerHTML = text;
    this.$.help!.classList.remove('hidden');
    this.helpT = secs;
  }
  showNames(vehicle = ''): void {
    this.$.vehicle!.textContent = vehicle;
    this.nameT = 4;
  }
  big(text: string, sub: string, cls: string): void {
    const b = this.$.big!;
    b.className = `v-big ${cls}`;
    b.innerHTML = `<h1>${text}</h1><p>${sub}</p>`;
  }
  hideBig(): void {
    this.$.big!.className = 'v-big hidden';
  }

  /** Hold Tab: pick a weapon by pointing. */
  wheel(open: boolean, pick?: (id: string) => void): void {
    const w = this.$.wheel!;
    if (open && !this.wheelOpen) {
      const owned = WEAPONS.filter((d) => this.g.player.inv.owned.has(d.id));
      w.innerHTML = owned.map((d, i) => {
        const a = (i / owned.length) * Math.PI * 2 - Math.PI / 2;
        return `<button data-id="${d.id}" style="left:calc(50% + ${Math.cos(a) * 150}px);top:calc(50% + ${Math.sin(a) * 150}px)" class="${d.id === this.g.player.inv.current ? 'on' : ''}"><b>${d.name}</b><small>${d.mag ? this.g.player.inv.owned.get(d.id)!.mag + this.g.player.inv.owned.get(d.id)!.ammo : '∞'}</small></button>`;
      }).join('');
      w.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onmouseenter = b.onclick = () => pick?.(b.dataset.id!)));
    }
    this.wheelOpen = open;
    w.classList.toggle('hidden', !open);
  }

  update(dt: number): void {
    const g = this.g;
    const p = g.player;
    const $ = this.$;
    this.flashT -= dt;
    if (this.flashT <= 0) $.flash!.classList.remove('on');
    this.helpT -= dt;
    if (this.helpT <= 0) $.help!.classList.add('hidden');
    // Stars.
    const lvl = g.police.level;
    const blink = g.police.searching && Math.sin(g.time * 8) > 0;
    $.stars!.querySelectorAll('i').forEach((s, i) => (s.className = i < lvl ? (blink ? 'dim' : 'on') : ''));
    $.cash!.textContent = `$${p.cash.toLocaleString()}`;
    const def = p.inv.def;
    const slot = p.inv.slot;
    $.wname!.textContent = def.name;
    $.ammo!.textContent = def.mag ? (p.inv.infinite ? '∞' : p.inv.reloadT > 0 ? 'RELOADING' : `${slot.mag} / ${slot.ammo}`) : '';
    ($.hp!.firstElementChild as HTMLElement).style.width = `${(p.health / 200) * 100}%`;
    ($.armor!.firstElementChild as HTMLElement).style.width = `${(p.armor / 100) * 100}%`;
    $.hp!.classList.toggle('low', p.health < 60);
    $.hurt!.style.opacity = String(Math.max(0, p.hurtT * 2) + (p.health < 60 ? 0.25 + Math.sin(g.time * 4) * 0.1 : 0));
    // Area / vehicle (shown a few seconds after they change).
    this.nameT -= dt;
    const area = g.areaName();
    if ($.area!.textContent !== area) {
      $.area!.textContent = area;
      this.nameT = 4;
    }
    $.street!.textContent = g.streetName();
    this.el.querySelector('.v-names')!.classList.toggle('on', this.nameT > 0);
    // Crosshair / scope.
    $.cross!.classList.toggle('aim', p.aiming && !g.cam.scoped);
    $.cross!.classList.toggle('hidden', p.inCar || g.cam.scoped || p.dead);
    $.scope!.classList.toggle('hidden', !g.cam.scoped);
    const h = Math.floor(g.clock);
    const mnt = Math.floor((g.clock - h) * 60);
    $.clock!.textContent = `${String(h).padStart(2, '0')}:${String(mnt).padStart(2, '0')}`;
    this.drawRadar();
  }

  /** The rotating radar. */
  private drawRadar(): void {
    const g = this.g;
    const c = this.radar;
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const p = g.player.pos;
    const zoom = g.player.inCar ? 0.75 + Math.min(0.5, Math.abs(g.player.car!.speed) / 60) : 0.55;
    ctx.save();
    ctx.fillStyle = '#2a3a2f';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H * 0.62);
    ctx.rotate(Math.PI + g.cam.yaw);
    ctx.scale(1 / zoom, 1 / zoom);
    ctx.drawImage(this.mapImg, -(p.x - BOUNDS.x0) * MAP_PPM, -(p.z - BOUNDS.z0) * MAP_PPM);
    const toM = (x: number, z: number): [number, number] => [(x - p.x) * MAP_PPM, (z - p.z) * MAP_PPM];
    // Police search area.
    if (g.police.level > 0) {
      const [sx, sz] = toM(g.police.lastX, g.police.lastZ);
      ctx.fillStyle = Math.sin(g.time * 6) > 0 ? 'rgba(255,40,40,0.22)' : 'rgba(40,80,255,0.22)';
      ctx.beginPath();
      ctx.arc(sx, sz, g.police.radius * MAP_PPM, 0, Math.PI * 2);
      ctx.fill();
    }
    // GPS route.
    if (this.route.length) {
      ctx.strokeStyle = '#c86cff';
      ctx.lineWidth = 6 * zoom;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const [ax, az] = toM(p.x, p.z);
      ctx.moveTo(ax, az);
      for (const [x, z] of this.route) ctx.lineTo(...toM(x, z));
      ctx.stroke();
    }
    ctx.restore();
    // Blips (upright, clamped to the edge).
    const blip = (x: number, z: number, draw: (bx: number, by: number) => void, clamp = false) => {
      let [mx, mz] = toM(x, z);
      const a = Math.PI + g.cam.yaw;
      const rx = (mx * Math.cos(a) - mz * Math.sin(a)) / zoom;
      const ry = (mx * Math.sin(a) + mz * Math.cos(a)) / zoom;
      let bx = W / 2 + rx;
      let by = H * 0.62 + ry;
      if (bx < 8 || bx > W - 8 || by < 8 || by > H - 8) {
        if (!clamp) return;
        bx = Math.max(8, Math.min(W - 8, bx));
        by = Math.max(8, Math.min(H - 8, by));
      }
      mx = bx;
      mz = by;
      draw(mx, mz);
    };
    for (const sh of g.city.shops)
      blip(sh.x, sh.z, (x, y) => {
        ctx.fillStyle = SHOP_STYLE[sh.kind].color;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    for (const c2 of g.peds.list)
      if (c2.role !== 'civ' && !c2.dead && g.police.level > 0)
        blip(c2.x, c2.z, (x, y) => {
          ctx.fillStyle = Math.sin(g.time * 10) > 0 ? '#ff3030' : '#3060ff';
          ctx.fillRect(x - 3, y - 3, 6, 6);
        });
    for (const u of g.police.units) {
      const q = u.car.pos;
      blip(q.x, q.z, (x, y) => {
        ctx.fillStyle = Math.sin(g.time * 10) > 0 ? '#ff3030' : '#3060ff';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }, true);
    }
    // Other players (online): blue arrows — flashing red / blue while they're wanted.
    for (const r of g.remotes.map.values())
      blip(r.x, r.z, (x, y) => {
        ctx.fillStyle = r.wanted > 0 ? (Math.sin(g.time * 10) > 0 ? '#ff3030' : '#3060ff') : '#5fb4ff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }, true);
    if (this.waypoint)
      blip(this.waypoint.x, this.waypoint.z, (x, y) => {
        ctx.fillStyle = '#c86cff';
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
      }, true);
    // You (arrow) and north.
    ctx.save();
    ctx.translate(W / 2, H * 0.62);
    const facing = g.player.inCar ? g.player.car!.heading : g.player.human.heading;
    ctx.rotate(g.cam.yaw - facing);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    blip(g.player.pos.x, g.player.pos.z - 4000, (x, y) => {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px "Bebas Neue", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', x, y);
    }, true);
  }

  /** The full map (pause): click to set a waypoint. */
  openMap(close: () => void): HTMLElement {
    const el = document.createElement('div');
    el.className = 'v-map';
    const c = document.createElement('canvas');
    const img = this.mapImg;
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    const draw = () => {
      ctx.drawImage(img, 0, 0);
      const g = this.g;
      const mx = (x: number) => (x - BOUNDS.x0) * MAP_PPM;
      const mz = (z: number) => (z - BOUNDS.z0) * MAP_PPM;
      ctx.font = 'bold 34px "Bebas Neue", sans-serif';
      ctx.textAlign = 'center';
      for (const s of g.city.shops) {
        ctx.fillStyle = SHOP_STYLE[s.kind].color;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(mx(s.x), mz(s.z), 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.lineWidth = 6;
        ctx.strokeText(s.name, mx(s.x), mz(s.z) - 22);
        ctx.fillText(s.name, mx(s.x), mz(s.z) - 22);
      }
      if (this.waypoint) {
        ctx.fillStyle = '#c86cff';
        ctx.beginPath();
        ctx.arc(mx(this.waypoint.x), mz(this.waypoint.z), 10, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const r of g.remotes.map.values()) {
        ctx.fillStyle = '#5fb4ff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(mx(r.x), mz(r.z), 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.strokeText(r.label, mx(r.x), mz(r.z) - 16);
        ctx.fillText(r.label, mx(r.x), mz(r.z) - 16);
      }
      const p = g.player.pos;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.arc(mx(p.x), mz(p.z), 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    draw();
    el.innerHTML = '<div class="v-maphead"><b>VELORA CITY</b><span>Click to set a waypoint · M / Esc to close</span></div>';
    el.appendChild(c);
    c.onclick = (e) => {
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * c.width / MAP_PPM + BOUNDS.x0;
      const z = ((e.clientY - r.top) / r.height) * c.height / MAP_PPM + BOUNDS.z0;
      this.waypoint = this.waypoint && Math.hypot(this.waypoint.x - x, this.waypoint.z - z) < 20 ? null : { x, z };
      this.g.audio.blip('click');
      draw();
    };
    el.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    this.el.parentElement!.appendChild(el);
    return el;
  }
}

/** The city as a map image: land shaded by height, water, buildings, roads (freeway in gold). */
function drawMap(city: City): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(SIZE * MAP_PPM);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(c.width, c.height);
  const t = city.terrain;
  for (let py = 0; py < c.height; py++)
    for (let px = 0; px < c.width; px++) {
      const x = px / MAP_PPM - HALF;
      const z = py / MAP_PPM - HALF;
      const h = t.height(x, z);
      const k = (py * c.width + px) * 4;
      let r: number, g: number, b: number;
      if (h < WATER_Y) [r, g, b] = [52, 108, 160];
      else if (z > coastZ(x) - 75) [r, g, b] = [214, 196, 146];
      else {
        const l = Math.min(1, h / 50);
        [r, g, b] = [72 + l * 70, 98 + l * 50, 66 + l * 20];
      }
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const mx = (x: number) => (x + HALF) * MAP_PPM;
  const mz = (z: number) => (z + HALF) * MAP_PPM;
  // Buildings.
  ctx.fillStyle = '#4a4e57';
  for (const p of city.placements) {
    if (!p.box || p.kit === 'street') continue;
    ctx.save();
    ctx.translate(mx(p.x), mz(p.z));
    ctx.rotate(-p.yaw);
    ctx.fillRect(-p.box.hx * MAP_PPM, -p.box.hz * MAP_PPM, p.box.hx * 2 * MAP_PPM, p.box.hz * 2 * MAP_PPM);
    ctx.restore();
  }
  // Roads: city streets grey-white, freeway gold on top.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const draw = (e: City['net']['edges'][number], color: string, extra = 0) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = (e.spec.width + extra) * MAP_PPM;
    ctx.beginPath();
    for (let k = 0; k < e.px.length; k++) {
      if (k) ctx.lineTo(mx(e.px[k]!), mz(e.pz[k]!));
      else ctx.moveTo(mx(e.px[k]!), mz(e.pz[k]!));
    }
    ctx.stroke();
  };
  const edges = city.net.edges;
  for (const e of edges) if (e.type !== 'highway' && e.type !== 'ramp') draw(e, '#2b2e33', 3);
  for (const e of edges) if (e.type !== 'highway' && e.type !== 'ramp') draw(e, e.type === 'rural' ? '#b9b2a2' : '#d3d6db');
  for (const e of edges) if (e.type === 'highway' || e.type === 'ramp') draw(e, '#7a5c12', 3);
  for (const e of edges) if (e.type === 'highway' || e.type === 'ramp') draw(e, '#e9b93a');
  return c;
}

export { WEAPON };
