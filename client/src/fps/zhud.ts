import type { Game, Soldier } from './sim/game';
import { POWERUPS, ZPERKS, type PowerUp, type ZPerk } from './sim/zweapons';

/**
 * The zombies HUD, laid out like the 2010 game: the round in red chalk (tally marks up to
 * five) bottom-left with your perks above it, everyone's points bottom-right (+points float
 * off), active power-ups along the bottom, the "Press □ to …" prompt in the middle, the
 * last-stand overlay and the end-of-game summary.
 */

const PLAYER_COLORS = ['#f2f2f2', '#6ab6ff', '#ffd23f', '#7ee06a'];
const PERK_ICON: Record<ZPerk, string> = { jug: '♥', revive: '✚', speed: '⚡', dtap: '✦' };
const POWER_ICON: Record<PowerUp, string> = { maxammo: '▤', insta: '☠', double: '×2', nuke: '☢', carpenter: '⚒', firesale: '$' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type Projector = (x: number, y: number, z: number) => [number, number] | null;

export class ZHud {
  readonly el: HTMLDivElement;
  private round: HTMLElement;
  private perks: HTMLElement;
  private points: HTMLElement;
  private powers: HTMLElement;
  private prompt: HTMLElement;
  private down: HTMLElement;
  private bar: HTMLElement;
  private markers: HTMLElement;
  private center: HTMLElement;
  private over: HTMLElement;
  private roundShown = -1;
  private roundFlash = 0;
  private centerT = 0;
  private pops: Array<{ el: HTMLElement; t: number }> = [];

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'zz-hud';
    this.el.innerHTML = `
      <div class="zz-down hidden"><div class="zz-down__vig"></div><div class="zz-down__txt"></div></div>
      <div class="zz-markers"></div>
      <div class="zz-perks"></div>
      <div class="zz-round"></div>
      <div class="zz-points"></div>
      <div class="zz-powers"></div>
      <div class="zz-prompt"></div>
      <div class="zz-bar hidden"><i></i><span></span></div>
      <div class="zz-center"></div>
      <div class="zz-over hidden"></div>`;
    parent.appendChild(this.el);
    const $ = (s: string) => this.el.querySelector(s) as HTMLElement;
    this.round = $('.zz-round');
    this.perks = $('.zz-perks');
    this.points = $('.zz-points');
    this.powers = $('.zz-powers');
    this.prompt = $('.zz-prompt');
    this.down = $('.zz-down');
    this.bar = $('.zz-bar');
    this.markers = $('.zz-markers');
    this.center = $('.zz-center');
    this.over = $('.zz-over');
  }

  /** Tally marks for rounds 1–5, then the number. */
  private roundHtml(r: number): string {
    if (r <= 0) return '';
    if (r <= 5) return `<span class="tally">${'<i></i>'.repeat(Math.min(4, r))}${r === 5 ? '<b></b>' : ''}</span>`;
    return `<span class="num">${r}</span>`;
  }

  /** "+50" floating off a player's points. */
  pop(idx: number, pts: number): void {
    const row = this.points.children[idx] as HTMLElement | undefined;
    if (!row) return;
    const el = document.createElement('div');
    el.className = `zz-pop ${pts < 0 ? 'neg' : ''}`;
    el.textContent = pts > 0 ? `+${pts}` : `${pts}`;
    el.style.setProperty('--dx', `${-30 - Math.random() * 60}px`);
    el.style.setProperty('--dy', `${-10 - Math.random() * 30}px`);
    row.appendChild(el);
    this.pops.push({ el, t: 0.9 });
  }

  say(html: string, secs = 2.5): void {
    this.center.innerHTML = html;
    this.center.classList.add('on');
    this.centerT = secs;
  }

  update(dt: number, g: Game, me: Soldier, project: Projector, pad: boolean): void {
    const h = g.horde!;
    // Round counter (flashes white when it changes, like the chalk being redrawn).
    if (h.round !== this.roundShown) {
      this.roundShown = h.round;
      this.round.innerHTML = this.roundHtml(h.round);
      this.roundFlash = h.round > 1 ? 4 : 0;
    }
    this.roundFlash = Math.max(0, this.roundFlash - dt);
    this.round.classList.toggle('flash', this.roundFlash > 0 && Math.sin(this.roundFlash * 6) > 0);
    this.round.classList.toggle('dogs', h.dogRound && h.phase === 'round');
    // Perks.
    const perks = me.zm?.perks ?? [];
    const pk = perks.join(',');
    if (this.perks.dataset.k !== pk) {
      this.perks.dataset.k = pk;
      this.perks.innerHTML = perks.map((p) => `<i style="--c:${ZPERKS[p].color}" title="${ZPERKS[p].name}">${PERK_ICON[p]}</i>`).join('');
    }
    // Points (everyone).
    const rows = g.soldiers.map((s, i) => `<div class="zz-pt ${s === me ? 'me' : ''} ${s.zm?.downed ? 'down' : ''} ${s.zm?.dead ? 'dead' : ''}" style="--c:${PLAYER_COLORS[i % 4]}"><span>${s.zm?.points ?? 0}</span><small>${esc(s.name)}</small></div>`);
    const key = rows.join('');
    if (this.points.dataset.k !== key) {
      // Keep the floating pops: rebuild the numbers only.
      if (this.points.children.length !== g.soldiers.length) {
        this.points.innerHTML = rows.join('');
      } else
        g.soldiers.forEach((s, i) => {
          const row = this.points.children[i] as HTMLElement;
          row.className = `zz-pt ${s === me ? 'me' : ''} ${s.zm?.downed ? 'down' : ''} ${s.zm?.dead ? 'dead' : ''}`;
          (row.firstElementChild as HTMLElement).textContent = String(s.zm?.points ?? 0);
        });
      this.points.dataset.k = key;
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]!;
      p.t -= dt;
      if (p.t <= 0) {
        p.el.remove();
        this.pops.splice(i, 1);
      }
    }
    // Active power-ups.
    const act: Array<[PowerUp, number]> = (
      [
        ['insta', h.insta],
        ['double', h.double],
        ['firesale', h.firesale],
      ] as Array<[PowerUp, number]>
    )
      .map(([k, until]) => [k, until - g.time] as [PowerUp, number])
      .filter(([, left]) => left > 0);
    this.powers.innerHTML = act.map(([k, left]) => `<i class="${left < 5 && Math.sin(left * 14) < 0 ? 'blink' : ''}" title="${POWERUPS[k].name}">${POWER_ICON[k]}</i>`).join('');
    // Prompt.
    const p = me.alive && !me.zm?.downed ? h.prompt(me) : null;
    const key2 = pad ? '<kbd class="sq">□</kbd>' : '<kbd>F</kbd>';
    if (p) {
      const text = p.text.replace(/^Hold/, `Hold ${key2}`).replace(/^You must/, 'You must');
      this.prompt.innerHTML = `${text}${p.cost > 0 ? ` <b>[Cost: ${p.cost}]</b>` : ''}`;
      this.prompt.classList.add('on');
    } else this.prompt.classList.remove('on');
    // Hold bars: reviving someone / being revived.
    const reviving = g.soldiers.find((o) => o.zm?.reviveBy === me.id);
    const beingRevived = me.zm?.downed && me.zm.reviveBy ? me.zm.reviveP : -1;
    const prog = reviving ? reviving.zm!.reviveP : beingRevived;
    this.bar.classList.toggle('hidden', prog < 0);
    if (prog >= 0) {
      (this.bar.firstElementChild as HTMLElement).style.width = `${prog * 100}%`;
      (this.bar.lastElementChild as HTMLElement).textContent = reviving ? `Reviving ${reviving.name}` : 'Being revived';
    }
    // Last stand.
    const z = me.zm;
    this.down.classList.toggle('hidden', !z?.downed);
    if (z?.downed) {
      const txt = this.down.lastElementChild as HTMLElement;
      txt.innerHTML = z.selfReviveT > 0 ? `<b>SECOND WIND</b><span>Back on your feet in ${Math.ceil(z.selfReviveT)}</span>` : `<b>YOU ARE DOWN</b><span>${g.soldiers.length > 1 ? `Bleeding out ${Math.ceil(z.bleed)}` : ''}</span>`;
    }
    // Downed team-mates: a red marker with their bleed-out.
    const marks = g.soldiers.filter((o) => o !== me && o.alive && o.zm?.downed);
    while (this.markers.children.length < marks.length) this.markers.appendChild(document.createElement('div'));
    [...this.markers.children].forEach((el, i) => {
      const o = marks[i];
      const e = el as HTMLElement;
      const at = o ? project(o.m.x, o.m.y + 1.0, o.m.z) : null;
      if (!o || !at) {
        e.style.display = 'none';
        return;
      }
      e.style.display = '';
      e.className = 'zz-mark';
      e.style.transform = `translate(${at[0]}px, ${at[1]}px)`;
      e.innerHTML = `<i>✚</i><small>${Math.ceil(o.zm!.bleed)}</small>`;
    });
    // Centre messages.
    if (this.centerT > 0) {
      this.centerT -= dt;
      if (this.centerT <= 0) this.center.classList.remove('on');
    }
  }

  /** The end screen: rounds survived and everyone's numbers. */
  gameOver(g: Game): void {
    const h = g.horde!;
    this.over.classList.remove('hidden');
    this.over.innerHTML = `<h1>GAME OVER</h1><h2>You survived ${h.round} round${h.round === 1 ? '' : 's'}</h2>
      <table><tr><th></th><th>Points</th><th>Kills</th><th>Headshots</th><th>Downs</th><th>Revives</th></tr>
      ${g.soldiers.map((s, i) => `<tr style="--c:${PLAYER_COLORS[i % 4]}"><td>${esc(s.name)}</td><td>${s.zm?.earned ?? 0}</td><td>${s.zm?.kills ?? 0}</td><td>${s.zm?.headshots ?? 0}</td><td>${s.zm?.downs ?? 0}</td><td>${s.zm?.revives ?? 0}</td></tr>`).join('')}</table>`;
  }

  dispose(): void {
    this.el.remove();
  }
}
