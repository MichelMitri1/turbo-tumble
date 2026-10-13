import { clubRatings, type Club, type Kit, type PlayerDef } from './sim/data';
import type { Frame } from './sim/snapshot';
import type { TeamStats } from './sim/match';
import { PITCH, takerCandidates, takerKind, takerStats } from './sim/match';
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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const fmtClock = (secs: number): string => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export class Hud {
  readonly el: HTMLDivElement;
  private score: HTMLDivElement;
  private clock: HTMLSpanElement;
  private added: HTMLSpanElement;
  private radar: HTMLCanvasElement;
  private labels: HTMLDivElement[] = [];
  private banner: HTMLDivElement;
  private bannerT = 0;
  private replayTag: HTMLDivElement;
  private ticker: HTMLDivElement;
  private tickerT = 0;
  readonly overlay: HTMLDivElement;
  private colors: [string, string];
  /** Who plays in each slot (team management). */
  defs: PlayerDef[] = [];

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
        <span class="fb-clock">00:00</span><span class="fb-added" style="display:none"></span>
        <span class="fb-team">${badgeSvg(clubs[0], 22)}<b>${clubs[0].short}</b><i style="background:${kits[0].shirt}"></i></span>
        <span class="fb-goals">0 - 0</span>
        <span class="fb-team"><i style="background:${kits[1].shirt}"></i><b>${clubs[1].short}</b>${badgeSvg(clubs[1], 22)}</span>
      </div>
      <div class="fb-ticker"></div>
      <canvas class="fb-radar" width="252" height="164"></canvas>
      <div class="fb-taker" style="display:none"></div>
      <div class="fb-takerhint" style="display:none"></div>
      <div class="fb-banner"></div>
      <div class="fb-replay">REPLAY</div>
      <div class="fb-overlay"></div>`;
    host.appendChild(el);
    this.el = el;
    this.score = el.querySelector('.fb-goals')!;
    this.clock = el.querySelector('.fb-clock')!;
    this.added = el.querySelector('.fb-added')!;
    this.radar = el.querySelector('.fb-radar')!;
    this.banner = el.querySelector('.fb-banner')!;
    this.replayTag = el.querySelector('.fb-replay')!;
    this.ticker = el.querySelector('.fb-ticker')!;
    this.overlay = el.querySelector('.fb-overlay')!;
    this.takerEl = el.querySelector('.fb-taker')!;
    this.takerHint = el.querySelector('.fb-takerhint')!;
    for (let i = 0; i < 8; i++) {
      const l = document.createElement('div');
      l.className = 'fb-label';
      l.innerHTML = `<span class="n"></span><span class="arrow"></span><span class="pwtag"></span><span class="pw"><i></i></span>`;
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
    // Added time: the clock runs on past 45:00 / 90:00 and the fourth official's board shows how much.
    this.clock.textContent = fmtClock(shown);
    const addOn = f.added > 0 && f.clock >= f.half * 45 * 60 - 60 && f.phase !== 'halftime' && f.phase !== 'fulltime';
    this.added.textContent = addOn ? `+${f.added}` : '';
    this.added.style.display = addOn ? '' : 'none';
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
      // (Hidden during camera sequences — kick-offs, goal kicks — like the controller rings.)
      if (!p || replay || p.state === 'off' || view.cinematic) {
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
      const charging = hu!.power >= 0;
      pw.style.visibility = charging ? 'visible' : 'hidden';
      pw.classList.toggle('full', charging && hu!.power >= 0.99);
      pw.classList.toggle('power', charging && hu!.powerShot);
      (l.querySelector('.pwtag') as HTMLElement).textContent = charging && hu!.powerShot ? 'POWER SHOT' : '';
      (pw.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, hu!.power)) * 100}%`;
    });
    this.takerUi(f, replay, playerName);
    this.drawRadar(f);
  }

  private takerEl: HTMLDivElement;
  private takerHint: HTMLDivElement;
  private takerKey = '';
  /** Set-piece taker picker: hold L2 at our free kick / penalty / corner, ◀ ▶ to change who takes it. */
  private takerUi(f: Frame, replay: boolean, playerName: (i: number) => string): void {
    const hu = f.humans.find((h) => h.p === f.taker);
    const att = f.restartTeam === 0 ? f.dir0 : -f.dir0;
    const kind = !replay && hu && (f.phase === 'stop' || f.phase === 'kickoff') ? takerKind(f.restart, f.ball.x, f.ball.z, att) : null;
    const picking = !!kind && f.humans.some((h) => h.picking && h.team === f.restartTeam);
    const key = kind ? `${kind}|${f.taker}|${picking}` : '';
    if (key === this.takerKey) return;
    this.takerKey = key;
    this.takerEl.style.display = picking ? '' : 'none';
    this.takerHint.style.display = kind && !picking ? '' : 'none';
    if (!kind) return;
    const team = f.restartTeam;
    const club = this.clubs[team];
    // (Slot 0 is the keeper in every formation.)
    const defOf = (i: number) => this.defs[i] ?? this.clubs[i < 11 ? 0 : 1].players[i % 11]!;
    const mates = f.players.map((p, i) => ({ i, def: defOf(i), role: i % 11 === 0 ? ('GK' as const) : ('CM' as const), state: p.state })).filter((p) => (p.i < 11 ? 0 : 1) === team);
    const list = takerCandidates(mates, kind);
    const cur = mates.find((p) => p.i === f.taker);
    const title = kind === 'penalty' ? 'PENALTY TAKER' : kind === 'corner' ? 'CORNER TAKER' : 'FREE KICK TAKER';
    if (!picking) {
      const t = cur ? takerStats(cur.def.stats) : null;
      this.takerHint.innerHTML = `<span>${cur ? `${esc(playerName(cur.i))} · PWR ${t!.power} · ACC ${t!.accuracy} · CRV ${t!.curve}` : ''}</span><span><kbd>L2</kbd> / <kbd>F</kbd> change taker</span>`;
      return;
    }
    const bar = (k: string, v: number) => `<div class="bar"><span>${k}<b>${v}</b></span><i style="--v:${Math.max(4, Math.min(100, (v - 30) * 1.45))}%"></i></div>`;
    this.takerEl.style.setProperty('--c', this.colors[team]!);
    this.takerEl.innerHTML = `<h3>${title}<small>${club.short}</small></h3>${list
      .map((p) => {
        const t = takerStats(p.def.stats);
        return `<div class="tk ${p.i === f.taker ? 'on' : ''}"><div class="num">${p.def.num}</div><div class="nm">${esc(p.def.name)}<em>${p.def.role} · ${p.def.ovr}</em></div><div class="bars">${bar('PWR', t.power)}${bar(kind === 'penalty' ? 'PEN' : 'ACC', kind === 'penalty' ? t.pens : t.accuracy)}${bar('CRV', t.curve)}${bar('SHO', p.def.stats.sho)}</div></div>`;
      })
      .join('')}<div class="hint">◀ ▶ (stick / d-pad · A D · ← →) change taker · release L2 to take it</div>`;
  }

  /** A broadcast strap for a restart: kick-off, second half, goal kick. */
  strap(title: string, sub: string, left: Club, right: Club | null, hold = 2.2): void {
    const el = document.createElement('div');
    el.className = `fb-strap${title === 'FREE KICK' || title === 'REFEREE WARNING' ? ' dead-ball' : ''}`;
    el.style.setProperty('--c1', left.badge.c1);
    el.style.setProperty('--c2', left.badge.c2 === '#111111' ? '#ffffff' : left.badge.c2);
    el.style.setProperty('--c3', (right ?? left).badge.c1);
    el.style.setProperty('--hold', `${hold}s`);
    el.innerHTML = `<div class="sl">${badgeSvg(left, 44)}</div><div class="sm"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}<div class="sweep"></div></div>${right ? `<div class="sr">${badgeSvg(right, 44)}</div>` : ''}`;
    this.el.appendChild(el);
    setTimeout(() => el.remove(), (hold + 0.6) * 1000);
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

  /** Pre-match: the broadcast's match-up card (badges, names, ratings, venue). */
  intro(clubs: [Club, Club], kits: [Kit, Kit], hint: string): void {
    const side = (c: Club, k: Kit, right: boolean) => {
      const r = clubRatings(c);
      return `<div class="in-side ${right ? 'r' : ''}" style="--k:${k.shirt};--k2:${k.trim}">
        <div class="in-badge">${badgeSvg(c, 132)}</div>
        <div class="in-name">${c.name}</div>
        <div class="in-meta">${c.formation} · OVR <b>${r.ovr}</b> · ATT ${r.att} · MID ${r.mid} · DEF ${r.def}</div>
      </div>`;
    };
    const el = document.createElement('div');
    el.className = 'fb-intro';
    el.innerHTML = `<div class="in-top"><span class="live">LIVE</span><span>MATCHDAY <b>27</b></span></div>
      <div class="in-row">${side(clubs[0], kits[0], false)}<div class="in-vs">VS</div>${side(clubs[1], kits[1], true)}</div>
      <div class="in-venue">${clubs[0].stadium} · ${clubs[0].city}</div>
      ${hint ? `<div class="in-hint">${hint}</div>` : ''}`;
    this.el.appendChild(el);
    this.introEl = el;
  }
  private introEl: HTMLDivElement | null = null;
  introOut(): void {
    const el = this.introEl;
    this.introEl = null;
    if (!el) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 600);
  }

  /** The replay wipe: a band in the club's colours sweeps across with the logo. */
  stinger(c: Club): void {
    const el = document.createElement('div');
    el.className = 'fb-stinger';
    el.style.setProperty('--c1', c.badge.c1);
    el.style.setProperty('--c2', c.badge.c2);
    el.innerHTML = `<div class="band"><span>MATCHDAY<b>27</b></span><em>REPLAY</em></div>`;
    this.el.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  /** GOAL! — the letters slam in, then the scorer's lower third. */
  goal(c: Club, k: Kit, scorer: string, minute: number, assist: string): void {
    const el = document.createElement('div');
    el.className = 'fb-goalfx';
    el.style.setProperty('--k', k.shirt);
    el.style.setProperty('--k2', k.trim === k.shirt ? '#ffffff' : k.trim);
    el.innerHTML = `<div class="gw">${[...'GOAL'].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('')}<span class="bang" style="--i:4">!</span></div>
      <div class="gl3">${badgeSvg(c, 54)}<div><div class="gn">${scorer.replace(/[&<>"']/g, '')} <b>${minute}'</b></div>${assist ? `<div class="ga">Assist · ${assist.replace(/[&<>"']/g, '')}</div>` : ''}</div></div>`;
    this.el.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3900);
    setTimeout(() => el.remove(), 4600);
  }

  /** A booking: the card flips up, with the player's name and club. */
  warning(c: Club, name: string): void {
    this.strap('REFEREE WARNING', `${name.replace(/[&<>"']/g, '')} · CAREFUL WITH THE NEXT CHALLENGE`, c, null, 2.8);
  }

  card(color: 'yellow' | 'red', c: Club, name: string, second: boolean): void {
    const el = document.createElement('div');
    el.className = `fb-cardfx ${color}`;
    el.innerHTML = `<div class="cd"></div><div class="ct">${badgeSvg(c, 40)}<div><b>${name.replace(/[&<>"']/g, '')}</b><small>${color === 'red' ? (second ? 'Second yellow · SENT OFF' : 'RED CARD · SENT OFF') : 'YELLOW CARD'}</small></div></div>`;
    this.el.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3600);
    setTimeout(() => el.remove(), 4200);
  }

  /** VAR: the check banner (stays up), then the decision. */
  varBanner(stage: 'check' | 'confirm' | 'overturn', what: 'offside' | 'penalty', detail = ''): void {
    this.varEl?.remove();
    const el = document.createElement('div');
    el.className = `fb-var ${stage}`;
    const title =
      stage === 'check'
        ? what === 'offside'
          ? 'Checking goal · possible offside'
          : 'Checking penalty · contact inside the area?'
        : stage === 'confirm'
          ? what === 'offside'
            ? 'GOAL CONFIRMED'
            : 'DECISION STANDS'
          : what === 'offside'
            ? 'NO GOAL · OFFSIDE'
            : 'DECISION OVERTURNED';
    el.innerHTML = `<div class="vl"><span>VAR</span></div><div class="vt"><b>${title}</b>${detail ? `<small>${detail}</small>` : ''}</div>${stage === 'check' ? '<div class="vbar"><i></i></div>' : ''}`;
    this.el.appendChild(el);
    this.varEl = el;
    if (stage !== 'check') {
      setTimeout(() => el.classList.add('out'), 3200);
      setTimeout(() => el.remove(), 3800);
    }
  }
  private varEl: HTMLDivElement | null = null;

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
