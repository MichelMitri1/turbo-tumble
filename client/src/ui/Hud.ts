import { ALL_ITEMS, ITEMS, type ItemId } from '@shared/items/ItemTypes';
import type { TrackPath } from '@shared/track/TrackPath';
import type { ViewportRect } from '../rendering/ViewportLayout';
import { el } from './dom';
import { Minimap, type MinimapDot } from './Minimap';
import { SpeedLines } from './SpeedLines';

export interface HudOptions {
  standings: boolean;
  minimap: boolean;
  timer: boolean;
  /** Controls hint (single player only — split views are too small). */
  hint: boolean;
}

export interface StandingRow {
  id: string;
  name: string;
  color: string;
  position: number;
  me: boolean;
}

/** m:ss.cc */
export function formatTime(t: number): string {
  const v = Math.max(0, t);
  const m = Math.floor(v / 60);
  return `${m}:${(v - m * 60).toFixed(2).padStart(5, '0')}`;
}

export interface HudData {
  position: number;
  racerCount: number;
  lap: number;
  laps: number;
  coins: number;
  item: ItemId | null;
  uses: number;
  /** Seconds of roulette left (0 = not spinning). */
  roulette: number;
  /** 0..1 remaining for an active timed item, or -1. */
  timed: number;
  ink: number;
  wrongWay: boolean;
  /** 0..1 — speed-line intensity (flat out / boosting). */
  speedFx: number;
}

export interface ResultRow {
  position: number;
  name: string;
  time: string;
  me: boolean;
}

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0]!;
};

/**
 * Per-player race HUD, positioned over that player's viewport and scaled to it
 * with CSS container query units.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly itemBox: HTMLElement;
  private readonly itemImg: HTMLImageElement;
  private readonly itemUses: HTMLElement;
  private readonly itemTimer: HTMLElement;
  private readonly posNum: HTMLElement;
  private readonly posSuffix: HTMLElement;
  private readonly posWrap: HTMLElement;
  private readonly lapValue: HTMLElement;
  private readonly coinValue: HTMLElement;
  private readonly center: HTMLElement;
  private readonly wrongWay: HTMLElement;
  private readonly ink: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly results: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly timerMain: HTMLElement;
  private readonly timerSplits: HTMLElement;
  private readonly timerRecord: HTMLElement;
  private readonly timerCurrent: HTMLElement = el('div', 'tt-timer__current');
  private readonly standings: HTMLElement;
  private readonly standingRows = new Map<string, HTMLElement>();
  private readonly minimap: Minimap | null;
  private speedLines!: SpeedLines;
  private lastSplitCount = -1;
  private hintTimer = 10;
  private rouletteTick = 0;
  private rouletteIndex = 0;
  private shownItem: string | null = null;
  private lastPosition = 0;
  private inkActive = false;

  constructor(
    parent: HTMLElement,
    private readonly icons: Record<string, string>,
    track: TrackPath,
    readonly options: HudOptions,
  ) {
    this.itemImg = el('img');
    this.itemImg.alt = '';
    this.itemUses = el('div', 'tt-item__uses tt-display');
    const timerFill = el('div');
    this.itemTimer = el('div', 'tt-item__timer', [timerFill]);
    this.itemBox = el('div', 'tt-item', [this.itemImg, this.itemUses, this.itemTimer]);

    this.posNum = el('span', 'tt-position__num tt-display', '1');
    this.posSuffix = el('span', 'tt-position__suffix tt-display', 'st');
    this.posWrap = el('div', 'tt-position p1', [this.posNum, this.posSuffix]);

    this.lapValue = el('span', 'tt-display', '1/3');
    this.coinValue = el('span', 'tt-display', '0');
    const coinImg = el('img');
    coinImg.src = icons.coinPickup ?? '';
    const stats = el('div', 'tt-stats', [
      el('div', 'tt-chip', [coinImg, this.coinValue]),
      el('div', 'tt-chip', [el('span', 'tt-chip__label', 'LAP'), this.lapValue]),
    ]);

    this.center = el('div', 'tt-center');
    this.wrongWay = el('div', 'tt-wrongway tt-display', 'WRONG WAY!');
    this.ink = el('div', 'tt-ink');
    this.flashEl = el('div', 'tt-flash');
    this.results = el('div', 'tt-results');

    const item = (keys: string[], label: string): HTMLElement => el('div', 'tt-hint__item', [...keys.map((k) => el('span', 'tt-key', k)), label]);
    this.hint = el('div', 'tt-hint', [item(['W', 'A', 'S', 'D'], 'Drive'), item(['Space'], 'Hop / Drift'), item(['Shift'], 'Item'), item(['S', '+', 'Shift'], 'Throw back'), item(['R'], 'Reset'), item(['Esc'], 'Pause')]);

    this.timerMain = el('div', 'tt-timer__main tt-display', '0:00.00');
    this.timerSplits = el('div', 'tt-timer__splits');
    this.timerRecord = el('div', 'tt-timer__record');
    const timer = el('div', 'tt-timer', [this.timerMain, this.timerSplits, this.timerRecord]);
    timer.style.display = options.timer ? '' : 'none';
    this.standings = el('div', 'tt-standings');
    this.standings.style.display = options.standings ? '' : 'none';

    if (!options.hint) this.hint.style.display = 'none';
    this.root = el('div', 'tt-hud', [this.ink, this.flashEl, this.itemBox, this.standings, stats, timer, this.posWrap, this.center, this.wrongWay, this.hint, this.results]);
    parent.appendChild(this.root);
    this.minimap = options.minimap ? new Minimap(this.root, track, track.def.minimap.rotation) : null;
    this.speedLines = new SpeedLines(this.root);
    this.root.prepend(this.speedLines.canvas); // under every other HUD element
  }

  layout(rect: ViewportRect): void {
    const s = this.root.style;
    s.left = `${rect.x * 100}%`;
    s.top = `${rect.y * 100}%`;
    s.width = `${rect.width * 100}%`;
    s.height = `${rect.height * 100}%`;
  }

  update(dt: number, d: HudData): void {
    this.updateItem(dt, d);
    this.speedLines.draw(d.speedFx, dt);

    if (d.position !== this.lastPosition) {
      this.posNum.textContent = String(d.position);
      this.posSuffix.textContent = ordinal(d.position);
      this.posWrap.className = `tt-position ${d.position <= 3 ? `p${d.position}` : 'pn'}`;
      void this.posWrap.offsetWidth;
      this.posWrap.classList.add('is-bump');
      this.lastPosition = d.position;
    }
    this.lapValue.textContent = `${Math.min(d.laps, Math.max(1, d.lap))}/${d.laps}`;
    this.coinValue.textContent = String(d.coins);
    this.wrongWay.classList.toggle('is-on', d.wrongWay);

    if (d.ink > 0 && !this.inkActive) this.splatter();
    this.inkActive = d.ink > 0;
    this.ink.style.opacity = String(Math.min(1, d.ink / 1.2));

    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hint.classList.add('is-hidden');
    }
  }

  private updateItem(dt: number, d: HudData): void {
    let show: string | null = null;
    if (d.roulette > 0) {
      // Spin through the catalogue, slowing as it lands.
      this.rouletteTick -= dt;
      if (this.rouletteTick <= 0) {
        this.rouletteIndex = (this.rouletteIndex + 1 + Math.floor(Math.random() * 3)) % ALL_ITEMS.length;
        this.rouletteTick = d.roulette > 0.6 ? 0.06 : 0.06 + (0.6 - d.roulette) * 0.35;
      }
      show = `roll:${ALL_ITEMS[this.rouletteIndex]}`;
    } else if (d.item) {
      show = d.item;
    }
    if (show !== this.shownItem) {
      const id = show?.startsWith('roll:') ? show.slice(5) : show;
      this.itemImg.style.visibility = id ? 'visible' : 'hidden';
      if (id) this.itemImg.src = this.icons[id] ?? '';
      if (show && !show.startsWith('roll:')) {
        this.itemBox.classList.remove('is-pop');
        void this.itemBox.offsetWidth;
        this.itemBox.classList.add('is-pop');
        this.itemImg.title = ITEMS[show as ItemId].name;
      }
      this.shownItem = show;
    }
    this.itemUses.textContent = d.item && d.roulette <= 0 && d.uses > 1 ? `×${d.uses}` : '';
    this.itemTimer.style.display = d.timed >= 0 ? 'block' : 'none';
    if (d.timed >= 0) (this.itemTimer.firstElementChild as HTMLElement).style.width = `${d.timed * 100}%`;
  }

  /** Race clock with completed lap splits, the live lap, and the Time Trial record. */
  updateTimer(raceTime: number, lapTimes: readonly number[], currentLap: number | null, record: number | null): void {
    this.timerMain.textContent = formatTime(raceTime);
    if (lapTimes.length !== this.lastSplitCount) {
      this.timerSplits.replaceChildren(...lapTimes.map((t, i) => el('div', '', `L${i + 1}  ${formatTime(t)}`)), this.timerCurrent);
      this.lastSplitCount = lapTimes.length;
    }
    this.timerCurrent.textContent = currentLap !== null ? `L${lapTimes.length + 1}  ${formatTime(currentLap)}` : '';
    this.timerRecord.textContent = record !== null ? `Record ${formatTime(record)}` : '';
  }

  /** Live position list; rows slide to their new slot when places change. */
  updateStandings(rows: readonly StandingRow[]): void {
    if (!this.options.standings) return;
    for (const r of rows) {
      let row = this.standingRows.get(r.id);
      if (!row) {
        row = el('div', 'tt-standings__row', [el('span', 'tt-standings__pos'), el('span', 'tt-standings__dot'), el('span', 'tt-standings__name', r.name)]);
        (row.children[1] as HTMLElement).style.background = r.color;
        this.standings.appendChild(row);
        this.standingRows.set(r.id, row);
      }
      row.children[0]!.textContent = String(r.position);
      row.classList.toggle('is-me', r.me);
      row.style.transform = `translateY(${(r.position - 1) * 100}%)`;
    }
  }

  drawMinimap(dots: readonly MinimapDot[]): void {
    this.minimap?.draw(dots);
  }

  /** Big centre text: countdown numbers or banners. */
  countdown(value: number | 'GO'): void {
    const node = el('div', `tt-count tt-display${value === 'GO' ? ' is-go' : ''}`, value === 'GO' ? 'GO!' : String(value));
    this.center.replaceChildren(node);
  }

  banner(text: string, tone: 'gold' | 'pink' | 'cyan' | 'white' = 'white'): void {
    const node = el('div', `tt-banner tt-display is-${tone}`, text);
    this.center.replaceChildren(node);
  }

  flash(): void {
    this.flashEl.classList.remove('is-on');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('is-on');
  }

  private splatter(): void {
    const colors = ['#9b4dff', '#ff4fd8', '#7a2fe0'];
    const blobs: HTMLElement[] = [];
    for (let i = 0; i < 9; i++) {
      const b = el('div');
      const size = 14 + Math.random() * 24;
      b.style.width = `${size}cqw`;
      b.style.height = `${size * (0.8 + Math.random() * 0.5)}cqw`;
      b.style.left = `${Math.random() * 90 - 10}%`;
      b.style.top = `${Math.random() * 80 - 5}%`;
      const c = colors[i % colors.length]!;
      b.style.background = `radial-gradient(circle at 40% 40%, ${c} 0 55%, ${c}cc 62%, transparent 72%)`;
      b.style.transform = `rotate(${Math.random() * 360}deg)`;
      blobs.push(b);
    }
    this.ink.replaceChildren(...blobs);
  }

  showResults(rows: ResultRow[], hint: string): void {
    this.results.replaceChildren(
      el('h3', 'tt-display', 'RESULTS'),
      ...rows.map((r) => el('div', `tt-results__row${r.me ? ' is-me' : ''}`, [el('span', '', r.position > 0 ? `${r.position}${ordinal(r.position)}` : ''), el('span', '', r.name), el('span', '', r.time)])),
      el('div', 'tt-results__hint', hint),
    );
    this.results.classList.add('is-open');
  }

  hideResults(): void {
    this.results.classList.remove('is-open');
  }

  dispose(): void {
    this.root.remove();
  }
}
