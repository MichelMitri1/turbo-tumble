import type { Frame } from './sim/snapshot';
import type { Stroke, PointReason } from './sim/match';
import type { ShotKind } from './sim/shots';

/**
 * The in-match overlay: a broadcast scoreboard (sets · games · points, serve dot), big call-outs
 * (FAULT, LET, GAME…), the name of the shot just played, how the point ended, and the swing meter —
 * the last stroke's direction and power, so you learn the mouse.
 */
const WHY: Record<PointReason, string> = {
  'double-fault': 'DOUBLE FAULT',
  net: 'INTO THE NET',
  'two-bounces': 'TWO BOUNCES',
  'wall-first': 'HIT THE GLASS FIRST',
  out: 'OUT',
  'own-side': 'DIDN’T CLEAR THE NET',
  'hit-player': 'HIT A PLAYER',
  'came-back': 'IT CAME BACK OVER',
  winner: 'WINNER — OUT OF THE CAGE!',
};
const SHOT: Partial<Record<ShotKind, string>> = { smash: 'SMASH!', bandeja: 'BANDEJA', vibora: 'VÍBORA', lob: 'LOB', chiquita: 'CHIQUITA', volley: 'VOLLEY' };

export class Hud {
  readonly el: HTMLDivElement;
  private readonly board: HTMLDivElement;
  private readonly call: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly shot: HTMLDivElement;
  private readonly meter: HTMLCanvasElement;
  private readonly hint: HTMLDivElement;
  private callT = 0;
  private shotT = 0;
  private boardKey = '';

  constructor(parent: HTMLElement, private readonly names: [string, string]) {
    this.el = document.createElement('div');
    this.el.className = 'pd-hud';
    this.el.innerHTML = `<div class="pd-board"></div><div class="pd-call"></div><div class="pd-sub"></div><div class="pd-shot"></div><canvas class="pd-meter" width="120" height="120"></canvas><div class="pd-hint"></div>`;
    parent.appendChild(this.el);
    this.board = this.el.querySelector('.pd-board')!;
    this.call = this.el.querySelector('.pd-call')!;
    this.sub = this.el.querySelector('.pd-sub')!;
    this.shot = this.el.querySelector('.pd-shot')!;
    this.meter = this.el.querySelector('.pd-meter')!;
    this.hint = this.el.querySelector('.pd-hint')!;
  }

  setHint(text: string): void {
    this.hint.textContent = text;
    this.hint.classList.toggle('show', !!text);
  }

  /** A big call-out for a moment (and a smaller line under it). */
  callout(text: string, sub = '', secs = 1.6): void {
    this.call.textContent = text;
    this.sub.textContent = sub;
    this.call.classList.add('show');
    this.sub.classList.toggle('show', !!sub);
    this.callT = secs;
  }

  pointCall(teamName: string, why: PointReason, ours: boolean): void {
    this.callout(`${ours ? 'POINT' : 'POINT'} — ${teamName.toUpperCase()}`, WHY[why], 1.8);
    this.call.classList.toggle('ours', ours);
  }

  shotName(kind: ShotKind, power: number): void {
    const label = kind === 'smash' && power > 0.95 ? 'POR TRES!' : SHOT[kind];
    if (!label) return;
    this.shot.textContent = label;
    this.shot.classList.remove('show');
    void this.shot.offsetWidth;
    this.shot.classList.add('show');
    this.shotT = 1;
  }

  update(f: Frame, dt: number, stroke: Stroke | null, strokeAge: number, serverTeam: 0 | 1, pointLabel: (t: 0 | 1) => string): void {
    const key = `${f.points}|${f.games}|${f.sets}|${f.tiebreak}|${serverTeam}|${f.history.length}`;
    if (key !== this.boardKey) {
      this.boardKey = key;
      const row = (t: 0 | 1) => `<div class="pd-row t${t}"><span class="pd-serve${serverTeam === t ? ' on' : ''}"></span><span class="pd-name">${this.names[t]}</span>${f.history.map((h) => `<span class="pd-set">${h[t]}</span>`).join('')}<span class="pd-games">${f.games[t]}</span><span class="pd-pts">${pointLabel(t)}</span></div>`;
      this.board.innerHTML = `${row(0)}${row(1)}${f.tiebreak ? '<div class="pd-tb">TIE-BREAK</div>' : ''}`;
    }
    if (this.callT > 0) {
      this.callT -= dt;
      if (this.callT <= 0) {
        this.call.classList.remove('show', 'ours');
        this.sub.classList.remove('show');
      }
    }
    if (this.shotT > 0) {
      this.shotT -= dt;
      if (this.shotT <= 0) this.shot.classList.remove('show');
    }
    // Swing meter: the stroke's direction as an arrow, its power as the arc — fading out.
    const g = this.meter.getContext('2d')!;
    g.clearRect(0, 0, 120, 120);
    const a = Math.max(0, 1 - strokeAge / 1.4);
    if (stroke && a > 0) {
      g.globalAlpha = a;
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(60, 60, 46, 0, Math.PI * 2);
      g.stroke();
      const p = stroke.power;
      g.strokeStyle = p > 0.78 ? '#ff5d3a' : p < 0.28 ? '#8be9ff' : '#ffe14d';
      g.beginPath();
      g.arc(60, 60, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(60, 60);
      g.lineTo(60 + stroke.dx * 36, 60 + stroke.dy * 36);
      g.stroke();
      g.font = '700 13px "Barlow Condensed", sans-serif';
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.fillText(stroke.lob ? 'LOB' : `${Math.round(p * 100)}%`, 60, 112);
      g.globalAlpha = 1;
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
