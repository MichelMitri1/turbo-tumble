import type { Game, Medal, Soldier } from './sim/game';
import { MODES } from './sim/game';
import { STREAKS, WEAPON, type Streak } from './sim/weapons';

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
};

const STREAK_ICON: Record<Streak, string> = { uav: '📡', airstrike: '✈️', heli: '🚁' };

export class Hud {
  readonly el: HTMLElement;
  private readonly $ = <T extends HTMLElement = HTMLElement>(s: string) => this.el.querySelector<T>(s)!;
  private mini: HTMLCanvasElement;
  private miniBase: HTMLCanvasElement | null = null;
  private feed: Array<{ el: HTMLElement; t: number }> = [];
  private pops: Array<{ el: HTMLElement; t: number }> = [];
  private hitT = 0;
  private damage: Array<{ el: HTMLElement; t: number; x: number; z: number }> = [];
  private last: Record<string, string> = {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'zh-hud hidden';
    this.el.innerHTML = `
      <div class="zh-scope hidden" id="h-scope"><div class="zh-scope__ret"></div><svg class="zh-scope__chev" viewBox="0 0 40 40"><path d="M8 22 L20 12 L32 22" fill="none" stroke="#ff3a24" stroke-width="2.6" stroke-linejoin="miter"/><path d="M20 12 V30" stroke="#ff3a24" stroke-width="1.2"/></svg></div>
      <div class="zh-mini"><canvas id="h-mini" width="220" height="220"></canvas><div class="zh-mini__label" id="h-uav"></div></div>
      <div class="zh-score"><div class="zh-score__team me"><b id="h-s0">0</b><i id="h-bar0"></i></div><div class="zh-score__mid"><span id="h-time">10:00</span><small id="h-mode">TDM</small></div><div class="zh-score__team them"><b id="h-s1">0</b><i id="h-bar1"></i></div></div>
      <div class="zh-flags" id="h-flags"></div>
      <div class="zh-feed" id="h-feed"></div>
      <div class="zh-cross" id="h-cross"><i></i><i></i><i></i><i></i></div>
      <div class="zh-hit" id="h-hit"><i></i><i></i><i></i><i></i></div>
      <div class="zh-pops" id="h-pops"></div>
      <div class="zh-enemy" id="h-enemy"></div>
      <div class="zh-ammo"><div class="zh-ammo__name" id="h-wname"></div><div class="zh-ammo__count"><b id="h-mag">30</b><span id="h-res">/ 90</span></div><div class="zh-ammo__nades" id="h-nades"></div><div class="zh-ammo__reload" id="h-reload">RELOAD</div></div>
      <div class="zh-streaks" id="h-streaks"></div>
      <div class="zh-dmg" id="h-dmg"></div>
      <div class="zh-blood" id="h-blood"></div>
      <div class="zh-dead hidden" id="h-dead"></div>
      <div class="zh-board hidden" id="h-board"></div>
      <div class="zh-center" id="h-center"></div>
      <div class="zh-hint" id="h-hint"></div>`;
    parent.appendChild(this.el);
    this.mini = this.$<HTMLCanvasElement>('#h-mini');
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
    (this as unknown as { miniScale: number }).miniScale = s;
  }

  hitmarker(kill: boolean, head: boolean): void {
    const h = this.$('#h-hit');
    h.className = `zh-hit on ${kill ? 'kill' : ''} ${head ? 'head' : ''}`;
    this.hitT = kill ? 0.35 : 0.18;
  }

  damageFrom(x: number, z: number): void {
    const el = document.createElement('div');
    el.className = 'zh-dmg__arc';
    this.$('#h-dmg').appendChild(el);
    this.damage.push({ el, t: 1.2, x, z });
  }

  killfeed(killer: string, kTeam: number, victim: string, vTeam: number, weapon: string, head: boolean, myTeam: number, ffa: boolean): void {
    const col = (t: number, name: string) => `<b class="${ffa ? 'neutral' : t === myTeam ? 'ally' : 'enemy'}">${esc(name)}</b>`;
    const w = WEAPON[weapon]?.name ?? (weapon === 'knife' ? 'Knife' : weapon === 'grenade' ? 'Frag' : weapon === 'airstrike' ? 'Airstrike' : weapon === 'heli' ? 'Attack Heli' : weapon === 'barrel' ? 'Explosion' : weapon);
    const el = document.createElement('div');
    el.className = 'zh-feed__item';
    el.innerHTML = killer === victim ? `${col(vTeam, victim)} <i>[${esc(w)}]</i>` : `${col(kTeam, killer)} <i>[${esc(w)}${head ? ' ☠' : ''}]</i> ${col(vTeam, victim)}`;
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
    (this as unknown as { centerT: number }).centerT = seconds;
  }

  hint(text: string): void {
    this.set('#h-hint', text);
  }

  update(
    dt: number,
    g: Game,
    me: Soldier,
    opts: { spread: number; ads: number; scoped: boolean; scope: '' | 'sniper' | 'acog'; yaw: number; enemyName: string; scoreboard: boolean; pad: boolean; reloadP: number },
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
    this.set('#h-nades', '◆'.repeat(me.grenades));
    const showReload = me.alive && w.ammo <= Math.ceil(w.def.mag * 0.25) && me.reloadT <= 0 && w.reserve > 0;
    this.$('#h-reload').classList.toggle('show', showReload);
    this.set('#h-reload', me.reloadT > 0 ? 'RELOADING' : opts.pad ? 'RELOAD □' : 'RELOAD [R]');
    this.$('#h-reload').classList.toggle('show', showReload || me.reloadT > 0);
    // Streak tracker.
    const off = me.loadout.perks.includes('hardline') ? 1 : 0;
    const streakHtml = (['uav', 'airstrike', 'heli'] as Streak[])
      .map((s) => {
        const need = STREAKS[s].kills - off;
        const ready = me.streaks.includes(s);
        const got = me.earned.has(s) && !ready;
        return `<div class="zh-streak ${ready ? 'ready' : ''} ${got ? 'used' : ''}"><span>${STREAK_ICON[s]}</span><small>${ready ? (opts.pad ? 'D-PAD →' : 'PRESS 4') : `${Math.min(me.streak, need)}/${need}`}</small></div>`;
      })
      .join('');
    this.set('#h-streaks', streakHtml, true);
    // Crosshair: four lines pushed out by the spread; hidden when aiming.
    const cross = this.$('#h-cross');
    // `spread` is the cone's radius as a fraction of half the screen height.
    const gap = 3 + opts.spread * innerHeight * 0.5;
    cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    cross.style.opacity = me.alive ? String(Math.max(0, 1 - opts.ads * 3)) : '0';
    this.$('#h-scope').classList.toggle('hidden', !opts.scoped);
    this.$('#h-scope').classList.toggle('acog', opts.scope === 'acog');
    // Hitmarker.
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.$('#h-hit').className = 'zh-hit';
    }
    // Red name when aiming at an enemy.
    this.set('#h-enemy', opts.enemyName);
    // Damage indicators (relative to where I'm looking).
    for (let i = this.damage.length - 1; i >= 0; i--) {
      const d = this.damage[i]!;
      d.t -= dt;
      const ang = Math.atan2(-(d.x - me.m.x), -(d.z - me.m.z)) - opts.yaw;
      d.el.style.transform = `rotate(${(-ang * 180) / Math.PI}deg)`;
      d.el.style.opacity = String(Math.min(1, d.t));
      if (d.t <= 0) {
        d.el.remove();
        this.damage.splice(i, 1);
      }
    }
    this.$('#h-blood').style.opacity = me.alive ? String(Math.max(0, (65 - me.hp) / 65) * 0.9) : '0';
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
    const self = this as unknown as { centerT: number };
    if (self.centerT > 0) {
      self.centerT -= dt;
      if (self.centerT <= 0) this.$('#h-center').classList.remove('show');
    }
    // Death screen.
    const dead = this.$('#h-dead');
    dead.classList.toggle('hidden', me.alive || g.phase === 'over');
    if (!me.alive && g.phase !== 'over') {
      const k = g.soldier(me.killedBy);
      this.set('#h-dead', `<div class="zh-dead__card"><small>KILLED BY</small><b>${k && k !== me ? esc(k.name) : 'YOURSELF'}</b>${k && k !== me ? `<span>${k.hp > 0 ? Math.ceil(k.hp) : 0} HP left · ${k.weapons[k.cur].def.name}</span>` : ''}</div><div class="zh-dead__spawn">Respawning in ${Math.max(0, me.respawnIn).toFixed(1)}</div><div class="zh-dead__tip">${opts.pad ? 'Press OPTIONS to change class' : 'Press ESC to change class'}</div>`, true);
    }
    // Scoreboard.
    this.$('#h-board').classList.toggle('hidden', !opts.scoreboard);
    if (opts.scoreboard) this.set('#h-board', scoreboard(g, me.id), true);
    this.drawMinimap(g, me, opts.yaw);
  }

  private drawMinimap(g: Game, me: Soldier, yaw: number): void {
    const c = this.mini;
    const x = c.getContext('2d')!;
    const W = c.width;
    const s = (this as unknown as { miniScale: number }).miniScale ?? 5;
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
        const seen = (uav && !o.loadout.perks.includes('ghost')) || firing;
        if (seen) dot(o.m.x, o.m.z, '#ff3a2a', 8);
      }
    }
    for (const h of g.helis) dot(h.x, h.z, h.team === me.team && g.mode !== 'ffa' ? '#4aa3ff' : '#ff3a2a', 12);
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

export function scoreboard(g: Game, meId: string): string {
  const row = (s: Soldier) =>
    `<tr class="${s.id === meId ? 'me' : ''} ${s.alive ? '' : 'dead'}"><td>${esc(s.name)}${s.bot ? ' <i>BOT</i>' : ''}</td><td>${s.score}</td><td>${s.kills}</td><td>${s.deaths}</td><td>${s.assists}</td><td>${s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2)}</td></tr>`;
  const head = '<tr><th></th><th>SCORE</th><th>K</th><th>D</th><th>A</th><th>K/D</th></tr>';
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
