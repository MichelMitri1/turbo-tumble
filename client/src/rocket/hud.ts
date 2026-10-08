import * as THREE from 'three';
import type { World, PlayerInfo, Stats } from './sim/world';
import type { RocketRenderer } from './render/scene';
import { QUICK_CHAT } from './input';
import { TEAM_COLORS } from './render/colors';
import { toThree } from './render/arenaMesh';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function fmtClock(sec: number, overtime: boolean): string {
  const s = overtime ? Math.floor(sec) : Math.ceil(sec);
  const m = Math.floor(s / 60);
  return `${overtime ? '+' : ''}${m}:${String(s % 60).padStart(2, '0')}`;
}

/** The in-match overlay (DOM). */
export class Hud {
  readonly el: HTMLElement;
  private readonly $ = <T extends HTMLElement = HTMLElement>(s: string) => this.el.querySelector<T>(s)!;
  private last = { s0: -1, s1: -1, clock: '', boost: -1, big: '' };
  private bigTimer = 0;
  private readonly labels = new Map<number, HTMLElement>();
  private feedItems: Array<{ el: HTMLElement; t: number }> = [];
  private chatItems: Array<{ el: HTMLElement; t: number }> = [];
  private readonly pt = { x: 0, y: 0 };
  private readonly v = new THREE.Vector3();
  private ballCamShown: boolean | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'rk-hud hidden';
    this.el.innerHTML = `
      <div class="rk-sb">
        <div class="rk-sb-team blue"><b id="h-s0">0</b></div>
        <div class="rk-sb-clock"><span id="h-clock">5:00</span><small id="h-ot" class="hidden">OVERTIME</small></div>
        <div class="rk-sb-team orange"><b id="h-s1">0</b></div>
      </div>
      <div class="rk-feed" id="h-feed"></div>
      <div class="rk-chat" id="h-chat"></div>
      <div class="rk-chatmenu hidden" id="h-chatmenu"></div>
      <div class="rk-big hidden" id="h-big"></div>
      <div class="rk-boost" id="h-boost">
        <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" class="trk"/><circle cx="60" cy="60" r="50" class="bar" id="h-boost-bar"/></svg>
        <b id="h-boost-n">33</b><small>BOOST</small>
      </div>
      <div class="rk-speed" id="h-speed"></div>
      <div class="rk-camicon" id="h-cam"><i></i><span>BALL CAM</span></div>
      <div class="rk-ballind hidden" id="h-ball"><i></i><b id="h-ball-d"></b></div>
      <div class="rk-edge" id="h-edge"></div>
      <div class="rk-labels" id="h-labels"></div>
      <div class="rk-board hidden" id="h-board"></div>
      <div class="rk-hint" id="h-hint"></div>`;
    parent.appendChild(this.el);
  }

  show(on: boolean): void {
    this.el.classList.toggle('hidden', !on);
    if (!on) {
      for (const l of this.labels.values()) l.remove();
      this.labels.clear();
    }
  }

  /** Replays: only the scoreboard stays up. */
  replay(on: boolean): void {
    this.el.classList.toggle('replay', on);
    if (on) this.el.classList.remove('hidden');
  }

  /** Boost pad picked up: the gauge flashes; a big pad also lights the screen edges. */
  pad(big: boolean): void {
    for (const [el, cls] of [[this.$('#h-boost'), 'flash'], ...(big ? [[this.$('#h-edge'), 'on']] : [])] as Array<[HTMLElement, string]>) {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    }
  }

  /** Big centre text (countdown, GOAL!, overtime…). */
  big(html: string, seconds: number, cls = ''): void {
    const b = this.$('#h-big');
    b.innerHTML = html;
    b.className = `rk-big ${cls}`;
    void b.offsetWidth;
    b.classList.add('pop');
    this.bigTimer = seconds;
  }

  feed(html: string): void {
    const el = document.createElement('div');
    el.className = 'rk-feed-item';
    el.innerHTML = html;
    this.$('#h-feed').prepend(el);
    this.feedItems.push({ el, t: 5 });
  }

  chat(name: string, team: 0 | 1, text: string, teamOnly = false): void {
    const el = document.createElement('div');
    el.className = 'rk-chat-item';
    el.innerHTML = `<b style="color:${TEAM_COLORS[team].css}">${esc(name)}</b>${teamOnly ? ' <i>[TEAM]</i>' : ''}: ${esc(text)}`;
    this.$('#h-chat').appendChild(el);
    this.chatItems.push({ el, t: 6 });
    while (this.chatItems.length > 6) this.chatItems.shift()!.el.remove();
  }

  private ballIndicator(world: World, me: World['cars'][number] | undefined, r: RocketRenderer): void {
    placeIndicator(this.$('#h-ball'), this.$('#h-ball-d'), world, me, r);
  }

  hint(text: string): void {
    this.$('#h-hint').textContent = text;
  }

  update(dt: number, world: World, myId: number, r: RocketRenderer, opts: { scoreboard: boolean; chatGroup: number; device: 'pad' | 'kb'; ballCam: boolean }): void {
    const L = this.last;
    if (world.score[0] !== L.s0) this.$('#h-s0').textContent = String((L.s0 = world.score[0]));
    if (world.score[1] !== L.s1) this.$('#h-s1').textContent = String((L.s1 = world.score[1]));
    const clock = world.freePlay ? 'FREE PLAY' : fmtClock(world.clock, world.overtime);
    if (clock !== L.clock) {
      this.$('#h-clock').textContent = L.clock = clock;
      this.$('#h-ot').classList.toggle('hidden', !world.overtime);
      this.$('.rk-sb-clock').classList.toggle('low', !world.overtime && !world.freePlay && world.clock <= 30);
    }
    const me = world.car(myId);
    const boostEl = this.$('#h-boost');
    boostEl.classList.toggle('hidden', !me);
    if (me) {
      const b = Math.floor(me.boost);
      if (b !== L.boost) {
        L.boost = b;
        this.$('#h-boost-n').textContent = String(b);
        const c = 2 * Math.PI * 50;
        const bar = this.$('#h-boost-bar');
        bar.style.strokeDasharray = `${(c * b) / 100} ${c}`;
        boostEl.classList.toggle('empty', b === 0);
        boostEl.classList.toggle('full', b === 100);
      }
      this.$('#h-speed').textContent = me.supersonic ? 'SUPERSONIC' : '';
    }
    if (opts.ballCam !== this.ballCamShown) {
      this.ballCamShown = opts.ballCam;
      const cam = this.$('#h-cam');
      cam.classList.toggle('on', opts.ballCam);
      cam.querySelector('span')!.textContent = opts.ballCam ? 'BALL CAM' : 'CAR CAM';
    }
    this.ballIndicator(world, me, r);
    if (this.bigTimer > 0) {
      this.bigTimer -= dt;
      if (this.bigTimer <= 0) this.$('#h-big').classList.add('hidden');
    }
    for (const list of [this.feedItems, this.chatItems]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const it = list[i]!;
        it.t -= dt;
        if (it.t < 0.5) it.el.style.opacity = String(Math.max(0, it.t * 2));
        if (it.t <= 0) {
          it.el.remove();
          list.splice(i, 1);
        }
      }
    }
    // Name tags above other cars.
    const seen = new Set<number>();
    for (const car of world.cars) {
      if (car.id === myId || car.demolished) continue;
      const p = world.players.find((x) => x.id === car.id);
      if (!p) continue;
      const view = r.cars.get(car.id);
      if (!view) continue;
      this.v.copy(view.root.position);
      const pos = new THREE.Vector3(this.v.x * 100, -this.v.z * 100, this.v.y * 100 + 85);
      if (!r.project(pos, this.pt)) continue;
      seen.add(car.id);
      let l = this.labels.get(car.id);
      if (!l) {
        l = document.createElement('div');
        l.className = `rk-label t${car.team}`;
        l.textContent = p.name;
        this.$('#h-labels').appendChild(l);
        this.labels.set(car.id, l);
      }
      const d = r.cam.camera.position.distanceTo(view.root.position);
      l.style.transform = `translate(${this.pt.x}px, ${this.pt.y}px) translate(-50%, -100%) scale(${Math.max(0.6, Math.min(1, 14 / d))})`;
      l.style.opacity = d > 70 ? '0.6' : '1';
    }
    for (const [id, l] of this.labels) {
      if (!seen.has(id)) {
        l.remove();
        this.labels.delete(id);
      }
    }
    // Quick chat menu.
    const menu = this.$('#h-chatmenu');
    const g = opts.chatGroup;
    if (String(g) !== L.big) {
      L.big = String(g);
      menu.classList.toggle('hidden', g < 0);
      if (g >= 0) {
        const keys = opts.device === 'pad' ? ['▲', '◀', '▶', '▼'] : ['1', '2', '3', '4'];
        menu.innerHTML = QUICK_CHAT[g]!.map((t, i) => `<div><kbd>${keys[i]}</kbd>${esc(t)}</div>`).join('');
      }
    }
    // Scoreboard (held).
    const board = this.$('#h-board');
    board.classList.toggle('hidden', !opts.scoreboard);
    if (opts.scoreboard) board.innerHTML = scoreboardHtml(world, myId);
  }
}

const ndc = new THREE.Vector3();
const camSpace = new THREE.Vector3();

/** When the ball is off screen, an arrow on the screen edge points at it (with the distance). */
function placeIndicator(el: HTMLElement, dist: HTMLElement, world: World, me: World['cars'][number] | undefined, r: RocketRenderer): void {
  const cam = r.cam.camera;
  const b = r.ballPos;
  if (!me || me.demolished || world.phase === 'goal') return void el.classList.add('hidden');
  toThree(b.x, b.y, b.z, camSpace).applyMatrix4(cam.matrixWorldInverse);
  const front = camSpace.z < 0;
  toThree(b.x, b.y, b.z, ndc).project(cam);
  const on = front && Math.abs(ndc.x) < 0.96 && Math.abs(ndc.y) < 0.94;
  if (on) return void el.classList.add('hidden');
  // Screen direction to the ball (mirrored when it's behind the camera).
  let dx = front ? ndc.x : camSpace.x;
  let dy = front ? ndc.y : camSpace.y;
  if (!front && Math.hypot(dx, dy) < 1e-3) dy = -1;
  const W = cam.aspect;
  dx *= W;
  const k = 1 / Math.max(Math.abs(dx) / (W * 0.9), Math.abs(dy) / 0.82);
  const x = (dx * k) / W;
  const y = dy * k;
  const w = innerWidth;
  const h = innerHeight;
  el.classList.remove('hidden');
  el.style.transform = `translate(${(x * 0.5 + 0.5) * w}px, ${(-y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
  (el.firstElementChild as HTMLElement).style.transform = `rotate(${Math.atan2(-dy, dx)}rad)`;
  dist.textContent = `${Math.round(me.pos.distanceTo(b) / 100)} m`;
}

export function scoreboardHtml(world: World, myId: number | null, stats?: Map<number, Stats>): string {
  const st = stats ?? world.stats;
  const team = (t: 0 | 1) => {
    const rows = world.players
      .filter((p) => p.team === t)
      .map((p) => [p, st.get(p.id) ?? { score: 0, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, touches: 0 }] as [PlayerInfo, Stats])
      .sort((a, b) => b[1].score - a[1].score)
      .map(([p, s]) => `<tr class="${p.id === myId ? 'me' : ''}"><td>${esc(p.name)}${p.bot ? ' <i>BOT</i>' : ''}</td><td>${s.score}</td><td>${s.goals}</td><td>${s.assists}</td><td>${s.saves}</td><td>${s.shots}</td><td>${s.demos}</td><td>${s.touches}</td></tr>`)
      .join('');
    return `<div class="rk-board-team t${t}"><div class="rk-board-head"><b>${TEAM_COLORS[t].name}</b><span>${world.score[t]}</span></div>
      <table><thead><tr><th></th><th>SCORE</th><th>GOALS</th><th>ASSISTS</th><th>SAVES</th><th>SHOTS</th><th>DEMOS</th><th>TOUCHES</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  };
  return team(0) + team(1);
}
