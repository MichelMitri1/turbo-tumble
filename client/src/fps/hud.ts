import type { Game, Medal, Soldier } from './sim/game';
import { MODES } from './sim/game';
import { LETHALS, STREAKS, TACTICALS, WEAPON } from './sim/weapons';
import { UNIT_NAMES, type UnitKind } from './sim/game';
import { icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const MEDAL_NAMES: Record<Medal, string> = {
  headshot: 'HEADSHOT',
  doublekill: 'DOUBLE KILL',
  triplekill: 'TRIPLE KILL',
  longshot: 'LONGSHOT',
  revenge: 'REVENGE',
  payback: 'PAYBACK',
  firstblood: 'FIRST BLOOD',
  bloodthirsty: 'BLOODTHIRSTY',
  merciless: 'MERCILESS',
  knife: 'KNIFED',
  grenade: 'FRAG KILL',
  buzzkill: 'BUZZKILL',
  collateral: 'COLLATERAL',
  stuck: 'STUCK',
  tknife: 'BULLSEYE',
  destroyer: 'DESTROYER',
};

/** Kill-feed icon for whatever did the killing. */
const FEED_ICON: Record<string, string> = { knife: 'knife', grenade: 'grenade', semtex: 'semtex', molotov: 'molotov', tknife: 'tknife', airstrike: 'airstrike', heli: 'heli', rcxd: 'rcxd', sentry: 'sentry', dog: 'dogs', gunner: 'gunner' };
const weaponIcon = (w: string) => icon(WEAPON[w]?.cls ?? FEED_ICON[w] ?? 'barrel', 'zh-feed__ico');
/** What the HUD shows while you pilot a killstreak. */
export interface PilotInfo {
  kind: UnitKind;
  left: number;
  hp: number;
}
const MARKS = 14;
const SPAWN_PROTECT = 1.5;
const NUMS = 16;

/** Screen position of a world point (px), or null when behind the camera / off screen. */
export type Projector = (x: number, y: number, z: number) => [number, number] | null;

export class Hud {
  readonly el: HTMLElement;
  private readonly $ = <T extends HTMLElement = HTMLElement>(s: string) => this.el.querySelector<T>(s)!;
  private mini: HTMLCanvasElement;
  private miniBase: HTMLCanvasElement | null = null;
  private miniScale = 5;
  private compass: HTMLCanvasElement;
  private feed: Array<{ el: HTMLElement; t: number }> = [];
  private pops: Array<{ el: HTMLElement; t: number }> = [];
  private hitT = 0;
  private damage: Array<{ el: HTMLElement; t: number; x: number; z: number }> = [];
  /** Floating damage numbers: a fixed pool of labels, projected every frame. */
  private nums: Array<{ el: HTMLElement; t: number; x: number; y: number; z: number; dmg: number; target: string }> = [];
  private last: Record<string, string> = {};
  private centerT = 0;
  /** Brief edge flash after taking a hit. */
  private hurtT = 0;
  private deadKey = '';
  /** This HUD's viewport size (the whole window, or one splitscreen quarter). */
  vw = innerWidth;
  vh = innerHeight;
  private marks: HTMLElement[] = [];

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'zh-hud hidden';
    this.el.innerHTML = `
      <div class="zh-blood" id="h-blood"></div>
      <div class="zh-pilot hidden" id="h-pilot"></div>
      <div class="zh-marks" id="h-marks"></div>
      <div class="zh-dmg" id="h-dmg"></div>
      <div class="zh-adsvig" id="h-adsvig"></div>
      <div class="zh-scope hidden" id="h-scope"><div class="zh-scope__ret"></div><svg class="zh-scope__chev" viewBox="0 0 40 40"><path d="M8 22 L20 12 L32 22" fill="none" stroke="#ff3a24" stroke-width="2.6" stroke-linejoin="miter"/><path d="M20 12 V30" stroke="#ff3a24" stroke-width="1.2"/></svg></div>
      <div class="zh-mini"><canvas id="h-mini" width="220" height="220"></canvas><div class="zh-mini__label" id="h-uav"></div></div>
      <div class="zh-score"><div class="zh-score__team me"><b id="h-s0">0</b><i id="h-bar0"></i></div><div class="zh-score__mid"><span id="h-time">10:00</span><small id="h-mode">TDM</small></div><div class="zh-score__team them"><b id="h-s1">0</b><i id="h-bar1"></i></div></div>
      <canvas class="zh-compass" id="h-compass" width="440" height="36"></canvas>
      <div class="zh-flags" id="h-flags"></div>
      <div class="zh-feed" id="h-feed"></div>
      <div class="zh-cross" id="h-cross"><i></i><i></i><i></i><i></i></div>
      <div class="zh-hit" id="h-hit"><i></i><i></i><i></i><i></i></div>
      <div class="zh-nums" id="h-nums"></div>
      <div class="zh-pops" id="h-pops"></div>
      <div class="zh-enemy" id="h-enemy"></div>
      <div class="zh-shield hidden" id="h-shield">${icon('shield', 'zh-shield__ico')}<span>SPAWN PROTECTION</span></div>
      <div class="zh-ammo"><div class="zh-ammo__name" id="h-wname"></div><div class="zh-ammo__count"><b id="h-mag">30</b><span id="h-res">/ 90</span></div><div class="zh-ammo__nades" id="h-nades"></div><div class="zh-ammo__reload" id="h-reload">RELOAD</div></div>
      <div class="zh-streaks" id="h-streaks"></div>
      <div class="zh-dead hidden" id="h-dead"></div>
      <div class="zh-board hidden" id="h-board"></div>
      <div class="zh-center" id="h-center"></div>
      <div class="zh-hint" id="h-hint"></div>
      <div class="zh-flash" id="h-flash"></div>`;
    parent.appendChild(this.el);
    this.mini = this.$<HTMLCanvasElement>('#h-mini');
    this.compass = this.$<HTMLCanvasElement>('#h-compass');
    const numsEl = this.$('#h-nums');
    for (let i = 0; i < NUMS; i++) {
      const el = document.createElement('div');
      el.className = 'zh-num';
      el.style.display = 'none';
      numsEl.appendChild(el);
      this.nums.push({ el, t: 0, x: 0, y: 0, z: 0, dmg: 0, target: '' });
    }
    const marksEl = this.$('#h-marks');
    for (let i = 0; i < MARKS; i++) {
      const el = document.createElement('i');
      el.style.display = 'none';
      marksEl.appendChild(el);
      this.marks.push(el);
    }
  }

  /** The viewport this HUD covers. */
  setSize(w: number, h: number): void {
    this.vw = w;
    this.vh = h;
  }

  show(on: boolean): void {
    this.el.classList.toggle('hidden', !on);
  }

  private set(id: string, text: string, html = false): void {
    if (this.last[id] === text) return;
    this.last[id] = text;
    const el = this.$(id);
    if (html) el.innerHTML = text;
    else el.textContent = text;
  }

  /** Pre-render the minimap's static layout (top-down boxes). */
  buildMinimap(g: Game): void {
    const c = document.createElement('canvas');
    const [hx, hz] = g.map.half;
    const s = 512 / (2 * Math.max(hx, hz));
    c.width = c.height = 512;
    const x = c.getContext('2d')!;
    x.fillStyle = 'rgba(20,26,30,0.92)';
    x.fillRect(0, 0, 512, 512);
    x.fillStyle = 'rgba(40,50,55,1)';
    x.fillRect(256 - hx * s, 256 - hz * s, 2 * hx * s, 2 * hz * s);
    const boxes = [...g.level.boxes].filter((b) => b.mat !== 'invisible' && !b.roof).sort((a, b) => a.y1 - b.y1);
    for (const b of boxes) {
      const h = Math.min(1, b.y1 / 5);
      x.fillStyle = `rgba(${130 + h * 80},${140 + h * 80},${140 + h * 70},0.9)`;
      x.fillRect(256 + b.x0 * s, 256 + b.z0 * s, Math.max(1, (b.x1 - b.x0) * s), Math.max(1, (b.z1 - b.z0) * s));
    }
    this.miniBase = c;
    this.miniScale = s;
  }

  /** Hitmarker: pops in large and settles; red X on a kill, yellow on a headshot. */
  hitmarker(kill: boolean, head: boolean): void {
    const h = this.$('#h-hit');
    h.className = `zh-hit on ${kill ? 'kill' : ''} ${head ? 'head' : ''}`;
    h.getAnimations().forEach((a) => a.cancel());
    h.animate([{ transform: `scale(${kill ? 1.9 : 1.5})`, filter: 'brightness(2.2)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: kill ? 220 : 120, easing: 'cubic-bezier(.2,.9,.3,1)' });
    this.hitT = kill ? 0.45 : 0.2;
  }

  /** A floating damage number at a world position (hits on the same target in quick succession add up). */
  damageNumber(target: string, x: number, y: number, z: number, dmg: number, head: boolean, kill: boolean): void {
    let n = this.nums.find((k) => k.t > 0.45 && k.target === target);
    if (n) n.dmg += dmg;
    else {
      n = this.nums.reduce((a, b) => (b.t < a.t ? b : a));
      n.dmg = dmg;
      n.target = target;
    }
    n.t = 0.9;
    n.x = x + (Math.random() - 0.5) * 0.3;
    n.y = y;
    n.z = z;
    n.el.textContent = String(Math.round(n.dmg));
    n.el.className = `zh-num ${head ? 'head' : ''} ${kill ? 'kill' : ''}`;
    n.el.style.display = '';
  }

  damageFrom(x: number, z: number): void {
    this.hurtT = 0.4;
    const el = document.createElement('div');
    el.className = 'zh-dmg__arc';
    this.$('#h-dmg').appendChild(el);
    this.damage.push({ el, t: 1.2, x, z });
  }

  killfeed(killer: string, kTeam: number, victim: string, vTeam: number, weapon: string, head: boolean, myTeam: number, ffa: boolean, kMe: boolean, vMe: boolean): void {
    const col = (t: number, name: string, me: boolean) => `<b class="${me ? 'you' : ffa ? 'neutral' : t === myTeam ? 'ally' : 'enemy'}">${esc(name)}</b>`;
    const el = document.createElement('div');
    el.className = `zh-feed__item ${kMe || vMe ? 'mine' : ''}`;
    const how = `${weaponIcon(weapon)}${head ? icon('headshot', 'zh-feed__ico head') : ''}`;
    el.innerHTML = killer === victim ? `${how} ${col(vTeam, victim, vMe)}` : `${col(kTeam, killer, kMe)} ${how} ${col(vTeam, victim, vMe)}`;
    this.$('#h-feed').prepend(el);
    this.feed.push({ el, t: 6 });
    while (this.feed.length > 6) this.feed.shift()!.el.remove();
  }

  popup(text: string, pts: number, big = false): void {
    const el = document.createElement('div');
    el.className = `zh-pop ${big ? 'big' : ''}`;
    el.innerHTML = `${esc(text)}${pts ? ` <b>+${pts}</b>` : ''}`;
    this.$('#h-pops').prepend(el);
    this.pops.push({ el, t: 2.2 });
    while (this.pops.length > 5) this.pops.shift()!.el.remove();
  }

  center(html: string, seconds: number): void {
    const c = this.$('#h-center');
    c.innerHTML = html;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
    this.centerT = seconds;
  }

  hint(text: string): void {
    this.set('#h-hint', text);
  }

  update(
    dt: number,
    g: Game,
    me: Soldier,
    opts: { spread: number; ads: number; scoped: boolean; scope: '' | 'sniper' | 'acog'; yaw: number; enemyName: string; scoreboard: boolean; pad: boolean; reloadP: number; project: Projector; ping?: (s: Soldier) => number; pilot?: PilotInfo | null },
  ): void {
    const ffa = g.mode === 'ffa';
    // Score banner.
    const myScore = ffa ? me.kills : g.score[me.team];
    const theirScore = ffa ? Math.max(0, ...g.soldiers.filter((s) => s !== me).map((s) => s.kills)) : g.score[1 - me.team];
    this.set('#h-s0', String(myScore));
    this.set('#h-s1', String(theirScore));
    this.$('#h-bar0').style.width = `${Math.min(100, (myScore / g.scoreLimit) * 100)}%`;
    this.$('#h-bar1').style.width = `${Math.min(100, (theirScore / g.scoreLimit) * 100)}%`;
    const t = Math.max(0, Math.ceil(g.timeLeft));
    this.set('#h-time', g.phase === 'warmup' ? `0:0${Math.ceil(g.warmup)}` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    this.set('#h-mode', `${MODES[g.mode].short} · ${g.scoreLimit}`);
    // Domination flags.
    if (g.mode === 'dom') {
      const html = g.flags.map((f) => `<span class="${f.owner === -1 ? 'neutral' : f.owner === me.team ? 'ally' : 'enemy'} ${f.capturing ? 'cap' : ''}" style="--p:${Math.abs(f.progress)}">${f.name}</span>`).join('');
      this.set('#h-flags', html, true);
    } else this.set('#h-flags', '', true);
    // Ammo / weapon.
    const w = me.weapons[me.cur];
    this.set('#h-wname', w.def.name.toUpperCase());
    this.set('#h-mag', String(w.ammo));
    this.set('#h-res', `/ ${w.reserve}`);
    this.$('#h-mag').classList.toggle('low', w.ammo <= Math.ceil(w.def.mag * 0.25));
    this.set('#h-nades', `<span title="${LETHALS[me.loadout.lethal].name}">${icon(me.loadout.lethal, 'zh-nade__ico')}<b>${me.grenades}</b></span><span title="${TACTICALS[me.loadout.tactical].name}">${icon(me.loadout.tactical, 'zh-nade__ico')}<b>${me.tacticals}</b></span>`, true);
    const showReload = me.alive && w.ammo <= Math.ceil(w.def.mag * 0.25) && me.reloadT <= 0 && w.reserve > 0;
    this.set('#h-reload', me.reloadT > 0 ? 'RELOADING' : opts.pad ? 'RELOAD □' : 'RELOAD [R]');
    this.$('#h-reload').classList.toggle('show', me.alive && (showReload || me.reloadT > 0));
    // Killstreak chip: kill pips with your three rewards marked, then their icons (ready ones show their key).
    const off = me.loadout.perks.includes('hardline') ? 1 : 0;
    const mine = me.loadout.streaks;
    const top = Math.max(...mine.map((s) => STREAKS[s].kills)) - off;
    const marks = new Set(mine.map((s) => STREAKS[s].kills - off));
    const pips = Array.from({ length: top }, (_, i) => `<i class="${i < me.streak ? 'on' : ''} ${marks.has(i + 1) ? 'mark' : ''}"></i>`).join('');
    const icons = mine.map((s, i) => {
      const ready = me.streaks.includes(s);
      const used = me.earned.has(s) && !ready;
      const key = opts.pad ? ['D-PAD ←', 'D-PAD ↑', 'D-PAD ↓'][i] : `PRESS ${4 + i}`;
      return `<span class="zh-streak ${ready ? 'ready' : ''} ${used ? 'used' : ''}" title="${STREAKS[s].name}">${icon(s, 'zh-streak__ico')}<small>${ready ? key : STREAKS[s].kills - off}</small></span>`;
    }).join('');
    this.set('#h-streaks', `<div class="zh-streaks__pips">${pips}</div><div class="zh-streaks__row">${icons}</div>`, true);
    // Spawn protection.
    this.$('#h-shield').classList.toggle('hidden', !(me.alive && g.phase === 'play' && g.time - me.spawnT < SPAWN_PROTECT));
    // Crosshair: four lines pushed out by the spread; hidden when aiming.
    const cross = this.$('#h-cross');
    // `spread` is the cone's radius as a fraction of half the screen height.
    const gap = 3 + opts.spread * this.vh * 0.5;
    cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    cross.style.opacity = me.alive && !opts.pilot ? String(Math.max(0, 1 - opts.ads * 3)) : '0';
    // Flashbang: white-out that fades; stun: blurry.
    const blind = Math.max(0, me.blindT - g.time);
    this.$('#h-flash').style.opacity = me.alive ? Math.min(1, blind / 1.6).toFixed(3) : '0';
    this.el.classList.toggle('stunned', me.alive && g.time < me.stunT);
    // Piloting a killstreak.
    const pilot = this.$('#h-pilot');
    pilot.classList.toggle('hidden', !opts.pilot);
    this.el.classList.toggle('piloting', !!opts.pilot);
    if (opts.pilot) {
      const p = opts.pilot;
      const hint = { rcxd: `${opts.pad ? 'R2' : 'FIRE'} TO DETONATE`, drone: `${opts.pad ? 'R2' : 'FIRE'} TO MARK ENEMIES · ${opts.pad ? 'R3' : 'V'} TO EXIT`, gunner: `${opts.pad ? 'R2' : 'FIRE'} MINIGUN · ${opts.pad ? 'R3' : 'V'} TO EXIT`, sentry: '', dog: '' }[p.kind];
      this.set('#h-pilot', `<div class="zh-pilot__top"><b>${UNIT_NAMES[p.kind].toUpperCase()}</b><span>${Math.ceil(p.left)}s</span></div><div class="zh-pilot__ret ${p.kind}"></div><div class="zh-pilot__hint">${hint}</div><div class="zh-pilot__hp"><i style="width:${Math.max(0, Math.min(100, p.hp * 100)).toFixed(0)}%"></i></div>`, true);
    }
    // Drone-marked enemies: red diamonds through walls.
    let mi = 0;
    for (const o of g.soldiers) {
      if (mi >= MARKS) break;
      if (!o.alive || !g.enemies(me, o) || !g.marked(me, o)) continue;
      const p = opts.project(o.m.x, o.m.y + 2.1, o.m.z);
      if (!p) continue;
      const el = this.marks[mi++]!;
      el.style.display = '';
      el.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px) translate(-50%, -50%) rotate(45deg)`;
    }
    for (; mi < MARKS; mi++) this.marks[mi]!.style.display = 'none';
    this.$('#h-scope').classList.toggle('hidden', !opts.scoped);
    this.$('#h-scope').classList.toggle('acog', opts.scope === 'acog');
    // ADS: a soft vignette pulls focus to the sight.
    this.$('#h-adsvig').style.opacity = me.alive && !opts.scoped ? (opts.ads * 0.9).toFixed(2) : '0';
    // Hitmarker.
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.$('#h-hit').className = 'zh-hit';
    }
    // Damage numbers rise and fade over the target.
    for (const n of this.nums) {
      if (n.t <= 0) continue;
      n.t -= dt;
      const p = n.t > 0 ? opts.project(n.x, n.y, n.z) : null;
      if (!p) {
        if (n.t <= 0) n.el.style.display = 'none';
        n.el.style.opacity = '0';
        continue;
      }
      const age = 0.9 - n.t;
      n.el.style.opacity = String(Math.min(1, n.t * 3));
      n.el.style.transform = `translate(${p[0].toFixed(1)}px, ${(p[1] - age * 40).toFixed(1)}px) translate(-50%, -100%) scale(${age < 0.08 ? 1.35 : 1})`;
    }
    // Red name when aiming at an enemy.
    this.set('#h-enemy', opts.enemyName);
    // Damage indicators: a red wedge out at the screen edge in the hit's direction (relative to where I'm looking).
    for (let i = this.damage.length - 1; i >= 0; i--) {
      const d = this.damage[i]!;
      d.t -= dt;
      const ang = Math.atan2(-(d.x - me.m.x), -(d.z - me.m.z)) - opts.yaw;
      const ex = -Math.sin(ang) * this.vw * 0.42;
      const ey = -Math.cos(ang) * this.vh * 0.42;
      d.el.style.transform = `translate(${ex.toFixed(1)}px, ${ey.toFixed(1)}px) rotate(${(-ang * 180) / Math.PI}deg)`;
      d.el.style.opacity = String(Math.min(1, d.t));
      if (d.t <= 0) {
        d.el.remove();
        this.damage.splice(i, 1);
      }
    }
    // Edge vignette: grows as health drops (and flashes briefly on a hit), fades as it regenerates.
    this.hurtT = Math.max(0, this.hurtT - dt);
    const low = Math.max(0, (65 - me.hp) / 65);
    this.$('#h-blood').style.opacity = me.alive ? Math.min(1, low + this.hurtT).toFixed(3) : '0';
    // Killfeed / popups age.
    for (const list of [this.feed, this.pops]) {
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
    if (this.centerT > 0) {
      this.centerT -= dt;
      if (this.centerT <= 0) this.$('#h-center').classList.remove('show');
    }
    // Death screen: the card is built once per death; only the countdown text changes.
    const dead = this.$('#h-dead');
    const showDead = !me.alive && g.phase !== 'over';
    dead.classList.toggle('hidden', !showDead);
    if (showDead) {
      const k = g.soldier(me.killedBy);
      const key = `${me.deaths}|${me.killedBy}|${opts.pad}`;
      if (key !== this.deadKey) {
        this.deadKey = key;
        this.last['#h-dead-t'] = '';
        dead.innerHTML = `<div class="zh-dead__card"><small>KILLED BY</small><b>${k && k !== me ? esc(k.name) : 'YOURSELF'}</b>${k && k !== me ? `<span>${k.hp > 0 ? Math.ceil(k.hp) : 0} HP left · ${k.weapons[k.cur].def.name}</span>` : ''}</div><div class="zh-dead__spawn">Respawning in <b id="h-dead-t"></b></div><div class="zh-dead__tip">${opts.pad ? 'Press SHARE to change class' : 'Press B to change class'}</div>`;
      }
      this.set('#h-dead-t', String(Math.max(0, Math.ceil(me.respawnIn))));
    }
    // Scoreboard (centre popups hide while it's open).
    this.$('#h-board').classList.toggle('hidden', !opts.scoreboard);
    this.el.classList.toggle('board-open', opts.scoreboard);
    if (opts.scoreboard) this.set('#h-board', scoreboard(g, me.id, opts.ping), true);
    this.drawMinimap(g, me, opts.yaw);
    this.drawCompass(g, me, opts.yaw);
  }

  /** Heading strip: ticks every 15°, cardinal letters, flags / UAV-spotted enemies / gunships as markers. */
  private drawCompass(g: Game, me: Soldier, yaw: number): void {
    const c = this.compass;
    const x = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const ppr = W / 2 / (Math.PI / 2); // ±90° visible
    x.clearRect(0, 0, W, H);
    const bg = x.createLinearGradient(0, 0, W, 0);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(0.2, 'rgba(0,0,0,0.38)');
    bg.addColorStop(0.8, 'rgba(0,0,0,0.38)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);
    // Bearings use the sim's yaw convention: 0 = north (−z), +π/2 = west.
    const sx = (bearing: number) => {
      let d = bearing - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return W / 2 - d * ppr;
    };
    x.textAlign = 'center';
    x.font = '600 11px Rajdhani, sans-serif';
    for (let deg = 0; deg < 360; deg += 15) {
      const px = sx((-deg * Math.PI) / 180);
      if (px < 6 || px > W - 6) continue;
      const fade = 1 - Math.abs(px - W / 2) / (W / 2);
      const card = deg % 90 === 0;
      x.globalAlpha = Math.min(1, fade * 1.6);
      x.fillStyle = card ? '#fff' : 'rgba(255,255,255,0.7)';
      if (card) {
        x.font = '700 15px Rajdhani, sans-serif';
        x.fillText('NESW'[deg / 90]!, px, 15);
        x.font = '600 11px Rajdhani, sans-serif';
      } else if (deg % 45 === 0) x.fillText(String(deg), px, 13);
      x.fillRect(px - 0.5, card ? 19 : 21, 1, card ? 8 : 5);
    }
    x.globalAlpha = 1;
    const mark = (wx: number, wz: number, color: string, label?: string) => {
      const px = sx(Math.atan2(-(wx - me.m.x), -(wz - me.m.z)));
      if (px < 8 || px > W - 8) return;
      x.fillStyle = color;
      if (label) {
        x.font = '700 13px Rajdhani, sans-serif';
        x.fillText(label, px, 34);
      } else {
        x.beginPath();
        x.moveTo(px, 35);
        x.lineTo(px - 4, 29);
        x.lineTo(px + 4, 29);
        x.closePath();
        x.fill();
      }
    };
    for (const f of g.flags) mark(f.x, f.z, f.owner === -1 ? '#ddd' : f.owner === me.team ? '#4aa3ff' : '#ff4a3a', f.name);
    if (g.jammed(me)) return;
    if (g.uavFor(me)) for (const o of g.soldiers) if (o.alive && g.enemies(me, o) && !o.loadout.perks.includes('ghost')) mark(o.m.x, o.m.z, '#ff3a2a');
    for (const h of g.helis) mark(h.x, h.z, h.team === me.team && g.mode !== 'ffa' ? '#4aa3ff' : '#ff3a2a', '✚');
    // Centre notch.
    x.fillStyle = '#ffd23f';
    x.fillRect(W / 2 - 1, 18, 2, 12);
  }

  private drawMinimap(g: Game, me: Soldier, yaw: number): void {
    const c = this.mini;
    const x = c.getContext('2d')!;
    const W = c.width;
    const s = this.miniScale;
    x.save();
    x.clearRect(0, 0, W, W);
    x.beginPath();
    x.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    x.clip();
    x.translate(W / 2, W / 2);
    // Rotate with the player (north-up would be static; CoD rotates).
    x.rotate(yaw);
    const zoom = 0.9;
    x.scale(zoom, zoom);
    x.translate(-me.m.x * s, -me.m.z * s);
    if (this.miniBase) x.drawImage(this.miniBase, -256, -256);
    // Counter-UAV: the map is just static.
    if (g.jammed(me)) {
      x.restore();
      const img = x.createImageData(W, W);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 160;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 200;
      }
      x.save();
      x.beginPath();
      x.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
      x.clip();
      x.putImageData(img, 0, 0);
      x.restore();
      this.set('#h-uav', 'JAMMED');
      return;
    }
    const uav = g.uavFor(me);
    const dot = (px: number, pz: number, color: string, r: number, arrow?: number) => {
      x.fillStyle = color;
      x.beginPath();
      if (arrow !== undefined) {
        x.save();
        x.translate(px * s, pz * s);
        x.rotate(-arrow);
        x.moveTo(0, -r * 1.5);
        x.lineTo(r, r);
        x.lineTo(-r, r);
        x.closePath();
        x.fill();
        x.restore();
      } else {
        x.arc(px * s, pz * s, r, 0, Math.PI * 2);
        x.fill();
      }
    };
    for (const f of g.flags) {
      x.fillStyle = f.owner === -1 ? '#ddd' : f.owner === me.team ? '#4aa3ff' : '#ff4a3a';
      x.font = 'bold 26px sans-serif';
      x.textAlign = 'center';
      x.save();
      x.translate(f.x * s, f.z * s);
      x.rotate(-yaw);
      x.fillText(f.name, 0, 9);
      x.restore();
    }
    for (const o of g.soldiers) {
      if (!o.alive || o === me) continue;
      const ally = g.mode !== 'ffa' && o.team === me.team;
      if (ally) dot(o.m.x, o.m.z, '#4aa3ff', 7, o.m.yaw);
      else {
        // Enemies show when firing unsuppressed, or under our UAV (unless Ghost).
        const firing = g.time - o.lastFireT < 1.2 && !o.suppressed;
        const seen = (uav && !o.loadout.perks.includes('ghost')) || firing || g.marked(me, o);
        if (seen) dot(o.m.x, o.m.z, '#ff3a2a', 8);
      }
    }
    for (const h of g.helis) dot(h.x, h.z, h.team === me.team && g.mode !== 'ffa' ? '#4aa3ff' : '#ff3a2a', 12);
    // Our own killstreak hardware (enemy hardware only under a UAV).
    for (const u of g.units) {
      const ours = g.mode === 'ffa' ? u.owner === me.id : u.team === me.team;
      if (ours || uav) dot(u.x, u.z, ours ? '#7fd0ff' : '#ff6a4a', u.kind === 'gunner' ? 12 : 6);
    }
    x.restore();
    // Me: arrow at the centre, pointing up.
    x.fillStyle = '#ffd23f';
    x.beginPath();
    x.moveTo(W / 2, W / 2 - 11);
    x.lineTo(W / 2 + 8, W / 2 + 8);
    x.lineTo(W / 2, W / 2 + 3);
    x.lineTo(W / 2 - 8, W / 2 + 8);
    x.closePath();
    x.fill();
    this.set('#h-uav', uav ? 'UAV ONLINE' : '');
  }
}

/** The scoreboard; with `ping` (online) it gets a PING column. */
export function scoreboard(g: Game, meId: string, ping?: (s: Soldier) => number): string {
  const row = (s: Soldier) =>
    `<tr class="${s.id === meId ? 'me' : ''} ${s.alive ? '' : 'dead'}"><td>${esc(s.name)}${s.bot ? ' <i>BOT</i>' : ''}</td><td>${s.score}</td><td>${s.kills}</td><td>${s.deaths}</td><td>${s.assists}</td><td>${s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2)}</td>${ping ? `<td class="ping">${s.bot ? 'BOT' : Math.round(ping(s))}</td>` : ''}</tr>`;
  const head = `<tr><th></th><th>SCORE</th><th>K</th><th>D</th><th>A</th><th>K/D</th>${ping ? '<th>PING</th>' : ''}</tr>`;
  if (g.mode === 'ffa') return `<div class="zh-board__team ffa"><h3>FREE-FOR-ALL</h3><table>${head}${[...g.soldiers].sort((a, b) => b.kills - a.kills || b.score - a.score).map(row).join('')}</table></div>`;
  const me = g.soldier(meId);
  const teams = me?.team === 1 ? [1, 0] : [0, 1];
  return teams
    .map(
      (t) =>
        `<div class="zh-board__team ${t === (me?.team ?? 0) ? 'ally' : 'enemy'}"><h3>${t === 0 ? 'COALITION' : 'MILITIA'} <b>${g.score[t]}</b></h3><table>${head}${g.soldiers
          .filter((s) => s.team === t)
          .sort((a, b) => b.score - a.score)
          .map(row)
          .join('')}</table></div>`,
    )
    .join('');
}
