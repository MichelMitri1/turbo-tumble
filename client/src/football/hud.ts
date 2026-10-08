import type { Club, Kit } from './sim/data';
import type { Frame } from './sim/snapshot';
import type { TeamStats } from './sim/match';
import { PITCH } from './sim/match';
import { HUMAN_COLORS, type MatchView } from './render/view';

/** Club crest as SVG (shield / round / diamond, two colours, monogram). */
export function badgeSvg(c: Club, size = 40): string {
  const { shape, c1, c2, mark } = c.badge;
  const body =
    shape === 'shield'
      ? `<path d="M50 4 L92 16 L88 60 Q80 86 50 98 Q20 86 12 60 L8 16 Z" fill="${c1}" stroke="${c2}" stroke-width="6"/><path d="M50 14 L50 90" stroke="${c2}" stroke-width="3" opacity=".35"/>`
      : shape === 'round'
        ? `<circle cx="50" cy="50" r="44" fill="${c1}" stroke="${c2}" stroke-width="7"/><circle cx="50" cy="50" r="33" fill="none" stroke="${c2}" stroke-width="2" opacity=".6"/>`
        : `<path d="M50 4 L94 50 L50 96 L6 50 Z" fill="${c1}" stroke="${c2}" stroke-width="6"/>`;
  return `<svg class="badge" width="${size}" height="${size}" viewBox="0 0 100 100">${body}<text x="50" y="${shape === 'shield' ? 60 : 62}" text-anchor="middle" font-family="Russo One, sans-serif" font-size="30" fill="${c2 === '#111111' ? '#ffffff' : c2}" stroke="rgba(0,0,0,.35)" stroke-width="1">${mark}</text></svg>`;
}

/** A shirt silhouette in the kit's colours / pattern. */
export function kitSvg(k: Kit, size = 64, num = ''): string {
  const id = `k${Math.random().toString(36).slice(2, 8)}`;
  const pat =
    k.pattern === 'stripes'
      ? `<pattern id="${id}" width="18" height="10" patternUnits="userSpaceOnUse"><rect width="18" height="10" fill="${k.shirt}"/><rect width="9" height="10" fill="${k.trim}"/></pattern>`
      : k.pattern === 'hoops'
        ? `<pattern id="${id}" width="10" height="18" patternUnits="userSpaceOnUse"><rect width="10" height="18" fill="${k.shirt}"/><rect width="10" height="9" fill="${k.trim}"/></pattern>`
        : k.pattern === 'halves'
          ? `<linearGradient id="${id}"><stop offset=".5" stop-color="${k.shirt}"/><stop offset=".5" stop-color="${k.trim}"/></linearGradient>`
          : k.pattern === 'sash'
            ? `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset=".4" stop-color="${k.shirt}"/><stop offset=".4" stop-color="${k.trim}"/><stop offset=".56" stop-color="${k.trim}"/><stop offset=".56" stop-color="${k.shirt}"/></linearGradient>`
            : '';
  const fill = pat ? `url(#${id})` : k.shirt;
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><defs>${pat}</defs><path d="M30 8 L42 4 Q50 12 58 4 L70 8 L94 26 L84 42 L74 36 L74 94 L26 94 L26 36 L16 42 L6 26 Z" fill="${fill}" stroke="rgba(0,0,0,.45)" stroke-width="2"/><path d="M42 4 Q50 14 58 4" fill="none" stroke="${k.trim}" stroke-width="3"/>${num ? `<text x="50" y="70" text-anchor="middle" font-family="Russo One" font-size="30" fill="${k.trim === k.shirt ? '#fff' : k.trim}">${num}</text>` : ''}</svg>`;
}

export const fmtClock = (secs: number): string => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export class Hud {
  readonly el: HTMLDivElement;
  private score: HTMLDivElement;
  private clock: HTMLSpanElement;
  private radar: HTMLCanvasElement;
  private labels: HTMLDivElement[] = [];
  private banner: HTMLDivElement;
  private bannerT = 0;
  private replayTag: HTMLDivElement;
  private ticker: HTMLDivElement;
  private tickerT = 0;
  readonly overlay: HTMLDivElement;
  private colors: [string, string];

  constructor(
    host: HTMLElement,
    private clubs: [Club, Club],
    kits: [Kit, Kit],
    private names: string[],
  ) {
    this.colors = [kits[0].shirt, kits[1].shirt];
    const el = document.createElement('div');
    el.className = 'fb-hud';
    el.innerHTML = `
      <div class="fb-score">
        <span class="fb-clock">00:00</span>
        <span class="fb-team">${badgeSvg(clubs[0], 22)}<b>${clubs[0].short}</b><i style="background:${kits[0].shirt}"></i></span>
        <span class="fb-goals">0 - 0</span>
        <span class="fb-team"><i style="background:${kits[1].shirt}"></i><b>${clubs[1].short}</b>${badgeSvg(clubs[1], 22)}</span>
      </div>
      <div class="fb-ticker"></div>
      <canvas class="fb-radar" width="252" height="164"></canvas>
      <div class="fb-banner"></div>
      <div class="fb-replay">REPLAY</div>
      <div class="fb-overlay"></div>`;
    host.appendChild(el);
    this.el = el;
    this.score = el.querySelector('.fb-goals')!;
    this.clock = el.querySelector('.fb-clock')!;
    this.radar = el.querySelector('.fb-radar')!;
    this.banner = el.querySelector('.fb-banner')!;
    this.replayTag = el.querySelector('.fb-replay')!;
    this.ticker = el.querySelector('.fb-ticker')!;
    this.overlay = el.querySelector('.fb-overlay')!;
    for (let i = 0; i < 8; i++) {
      const l = document.createElement('div');
      l.className = 'fb-label';
      l.innerHTML = `<span class="n"></span><span class="arrow"></span><span class="pw"><i></i></span>`;
      l.style.setProperty('--c', HUMAN_COLORS[i]!);
      el.appendChild(l);
      this.labels.push(l);
    }
  }

  setKits(kits: [Kit, Kit]): void {
    this.colors = [kits[0].shirt, kits[1].shirt];
  }

  update(f: Frame, view: MatchView, dt: number, replay: boolean, playerName: (i: number) => string): void {
    this.score.textContent = `${f.score[0]} - ${f.score[1]}`;
    const shown = f.phase === 'halftime' ? 45 * 60 : f.clock;
    this.clock.textContent = fmtClock(shown);
    this.replayTag.style.display = replay ? 'block' : 'none';
    this.radar.style.display = replay ? 'none' : 'block';
    // Banner timeout.
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.classList.remove('on');
    }
    if (this.tickerT > 0) {
      this.tickerT -= dt;
      if (this.tickerT <= 0) this.ticker.classList.remove('on');
    }
    // Player indicators: name, arrow, shot power.
    const w = view.camera.userData.w as number;
    const h = view.camera.userData.h as number;
    this.labels.forEach((l, i) => {
      const hu = f.humans[i];
      const p = hu ? f.players[hu.p] : undefined;
      if (!p || replay || p.state === 'off') {
        l.style.display = 'none';
        return;
      }
      const s = view.project(p.x, 2.25, p.z, w, h);
      if (!s) {
        l.style.display = 'none';
        return;
      }
      l.style.display = 'flex';
      l.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%, -100%)`;
      (l.firstElementChild as HTMLElement).textContent = `${this.names[i] ? this.names[i] + ' · ' : ''}${playerName(hu!.p)}`;
      const pw = l.querySelector('.pw') as HTMLElement;
      pw.style.visibility = hu!.power >= 0 ? 'visible' : 'hidden';
      (pw.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, hu!.power)) * 100}%`;
    });
    this.drawRadar(f);
  }

  private drawRadar(f: Frame): void {
    const c = this.radar;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,40,20,.55)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.55)';
    g.lineWidth = 1.5;
    const X = (x: number) => ((x + PITCH.HL) / (PITCH.HL * 2)) * (W - 8) + 4;
    const Y = (z: number) => ((z + PITCH.HW) / (PITCH.HW * 2)) * (H - 8) + 4;
    g.strokeRect(X(-PITCH.HL), Y(-PITCH.HW), X(PITCH.HL) - X(-PITCH.HL), Y(PITCH.HW) - Y(-PITCH.HW));
    g.beginPath();
    g.moveTo(X(0), Y(-PITCH.HW));
    g.lineTo(X(0), Y(PITCH.HW));
    g.stroke();
    g.beginPath();
    g.arc(X(0), Y(0), (PITCH.CIRCLE / (PITCH.HL * 2)) * (W - 8), 0, Math.PI * 2);
    g.stroke();
    for (const e of [-1, 1]) {
      const x0 = X(e * PITCH.HL);
      const x1 = X(e * (PITCH.HL - PITCH.BOX_D));
      g.strokeRect(Math.min(x0, x1), Y(-PITCH.BOX_HW), Math.abs(x1 - x0), Y(PITCH.BOX_HW) - Y(-PITCH.BOX_HW));
    }
    f.players.forEach((p, i) => {
      if (p.state === 'off') return;
      const team = i < 11 ? 0 : 1;
      g.fillStyle = this.colors[team]!;
      g.strokeStyle = 'rgba(0,0,0,.7)';
      g.beginPath();
      g.arc(X(p.x), Y(p.z), 3.6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    });
    f.humans.forEach((h, k) => {
      const p = f.players[h.p];
      if (!p) return;
      g.strokeStyle = HUMAN_COLORS[k]!;
      g.lineWidth = 2.2;
      g.beginPath();
      g.arc(X(p.x), Y(p.z), 6, 0, Math.PI * 2);
      g.stroke();
    });
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(X(f.ball.x), Y(f.ball.z), 3, 0, Math.PI * 2);
    g.fill();
  }

  /** Big centre banner (GOAL!, PENALTY, OFFSIDE…). */
  show(html: string, secs = 2.5, kind = ''): void {
    this.banner.innerHTML = html;
    this.banner.className = `fb-banner on ${kind}`;
    this.bannerT = secs;
  }

  /** Small strip under the scoreboard (scorer, cards, subs). */
  tick(html: string, secs = 4): void {
    this.ticker.innerHTML = html;
    this.ticker.classList.add('on');
    this.tickerT = secs;
  }

  /** Match facts panel (half time / full time / pause). */
  statsHtml(title: string, score: [number, number], stats: [TeamStats, TeamStats], goals: Array<{ team: 0 | 1; p: number; minute: number; own: boolean }>, playerName: (i: number) => string): string {
    const [a, b] = stats;
    const poss = Math.round((a.possession / Math.max(1, a.possession + b.possession)) * 100);
    const row = (label: string, x: number | string, y: number | string, fx = Number(x), fy = Number(y)) => {
      const t = fx + fy || 1;
      return `<div class="st-row"><b>${x}</b><span>${label}<em><i style="width:${(fx / t) * 100}%;background:${this.colors[0]}"></i><i style="width:${(fy / t) * 100}%;background:${this.colors[1]}"></i></em></span><b>${y}</b></div>`;
    };
    const scorers = (team: 0 | 1) =>
      goals
        .filter((g) => g.team === team)
        .map((g) => `<div>⚽ ${playerName(g.p)} ${g.minute}'${g.own ? ' (OG)' : ''}</div>`)
        .join('');
    return `<div class="fb-stats">
      <h2>${title}</h2>
      <div class="st-head">${badgeSvg(this.clubs[0], 54)}<div class="st-name">${this.clubs[0].name}</div><div class="st-score">${score[0]} - ${score[1]}</div><div class="st-name">${this.clubs[1].name}</div>${badgeSvg(this.clubs[1], 54)}</div>
      <div class="st-scorers"><div>${scorers(0)}</div><div>${scorers(1)}</div></div>
      ${row('Possession %', poss, 100 - poss)}
      ${row('Shots', a.shots, b.shots)}
      ${row('Shots on target', a.onTarget, b.onTarget)}
      ${row('Passes', a.passes, b.passes)}
      ${row('Pass accuracy %', Math.round((a.passesDone / Math.max(1, a.passes)) * 100), Math.round((b.passesDone / Math.max(1, b.passes)) * 100))}
      ${row('Saves', a.saves, b.saves)}
      ${row('Corners', a.corners, b.corners)}
      ${row('Fouls', a.fouls, b.fouls)}
      ${row('Offsides', a.offsides, b.offsides)}
      ${row('Yellow cards', a.yellows, b.yellows)}
    </div>`;
  }

  dispose(): void {
    this.el.remove();
  }
}
