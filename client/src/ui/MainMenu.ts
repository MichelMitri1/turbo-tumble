import { DIFFICULTIES, DIFFICULTY, type Difficulty } from '@shared/ai/AIDifficulty';
import type { MenuNav } from '../input/InputManager';
import { CHARACTERS, KART_BODIES } from '../config/roster';
import { TRACKS } from '@shared/tracks/registry';
import { CUPS } from '@shared/tracks/cups';
import { el } from './dom';
import { trackThumb } from './TrackThumbs';
import { SPEED_CLASSES, type SpeedClass } from '@shared/race/SpeedClass';
import { bindFullscreenButton } from './fullscreen';
import { engineLabel, getEngineProfile } from '../audio/EngineProfiles';

export type MenuMode = 'race' | 'grandprix' | 'timetrial' | 'online';

export interface MenuChoice {
  mode: MenuMode;
  players: number;
  split: 'horizontal' | 'vertical';
  character: string;
  kart: string;
  difficulty: Difficulty;
  laps: number;
  items: boolean;
  trackId: string;
  cupId: string;
  /** Field size including CPUs. */
  racers: number;
  speedClass: SpeedClass;
  mirror: boolean;
}

const RACER_COUNTS = [4, 6, 8, 12] as const;

const MODES: Array<{ id: MenuMode; title: string; blurb: string; icon: string }> = [
  { id: 'race', title: 'Single Race', blurb: 'One race against the CPU field', icon: '🏁' },
  { id: 'grandprix', title: 'Grand Prix', blurb: 'Four races · points decide the cup', icon: '🏆' },
  { id: 'timetrial', title: 'Time Trial', blurb: 'Race the clock and your ghost', icon: '⏱️' },
  { id: 'online', title: 'Online', blurb: 'Room codes · or LAN on your Wi-Fi', icon: '🌐' },
];

type RowId = 'mode' | 'players' | 'split' | 'track' | 'cup' | 'character' | 'kart' | 'engine' | 'difficulty' | 'racers' | 'cc' | 'mirror' | 'laps' | 'items' | 'start' | 'controls';
const STORAGE_KEY = 'turbo-tumble.menu.v1';

const DEFAULT_CHOICE: MenuChoice = { mode: 'race', players: 1, split: 'horizontal', character: 'bix', kart: 'comet', difficulty: 'normal', laps: 3, items: true, trackId: 'sunny-circuit', cupId: 'sunny-cup', racers: 12, speedClass: 150, mirror: false };

function loadChoice(): MenuChoice {
  try {
    const c = { ...DEFAULT_CHOICE, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<MenuChoice>) };
    if (!TRACKS.some((t) => t.id === c.trackId)) c.trackId = DEFAULT_CHOICE.trackId;
    if (!CUPS.some((x) => x.id === c.cupId)) c.cupId = DEFAULT_CHOICE.cupId;
    if (!RACER_COUNTS.includes(c.racers as (typeof RACER_COUNTS)[number])) c.racers = DEFAULT_CHOICE.racers;
    if (!SPEED_CLASSES.includes(c.speedClass)) c.speedClass = DEFAULT_CHOICE.speedClass;
    return c;
  } catch {
    return { ...DEFAULT_CHOICE };
  }
}

/**
 * Title screen / race setup, drawn over the live attract-mode race.
 * Up/Down picks a row, Left/Right changes it, Enter/Ⓐ starts.
 */
export class MainMenu {
  readonly root: HTMLElement;
  private choice: MenuChoice = loadChoice();
  private focus: RowId = 'start';
  private readonly rows = new Map<RowId, HTMLElement>();
  private readonly modeCards: HTMLElement[] = [];
  private readonly thumbs = el('div', 'tt-menu__thumbs');
  open = false;

  constructor(
    parent: HTMLElement,
    private readonly onStart: (choice: MenuChoice) => void,
    private readonly onControls: () => void,
    private readonly onEnginePreview: (kart: string | null) => void = () => undefined,
  ) {
    const cards = el(
      'div',
      'tt-menu__modes',
      MODES.map((m) => {
        const card = el('button', 'tt-menu__mode', [el('div', 'tt-menu__mode-icon', m.icon), el('div', 'tt-menu__mode-title tt-display', m.title), el('div', 'tt-menu__mode-blurb', m.blurb)]);
        card.addEventListener('click', () => {
          this.choice.mode = m.id;
          this.focus = 'mode';
          this.render();
        });
        this.modeCards.push(card);
        return card;
      }),
    );
    this.rows.set('mode', cards);

    const option = (id: RowId, label: string): HTMLElement => {
      const prev = el('button', 'tt-menu__arrow', '◀');
      const next = el('button', 'tt-menu__arrow', '▶');
      prev.addEventListener('click', () => this.change(id, -1));
      next.addEventListener('click', () => this.change(id, 1));
      const row = el('div', 'tt-menu__row', [el('span', 'tt-menu__label', label), prev, el('span', 'tt-menu__value'), next]);
      row.addEventListener('mouseenter', () => {
        this.focus = id;
        this.render();
      });
      this.rows.set(id, row);
      return row;
    };

    const start = el('button', 'tt-button tt-menu__start', 'START!');
    start.addEventListener('click', () => this.start());
    this.rows.set('start', start);
    const controls = el('button', 'tt-button tt-menu__controls', 'Controls & Sound');
    controls.addEventListener('click', () => this.onControls());
    this.rows.set('controls', controls);
    const enginePreview = el('button', 'tt-button tt-menu__engine', '▶ REV ENGINE');
    enginePreview.addEventListener('click', () => this.onEnginePreview(this.choice.kart));
    this.rows.set('engine', enginePreview);

    const arcade = el('a', 'tt-button', '← Arcade');
    arcade.href = '/';
    const fullscreen = el('button', 'tt-button');
    bindFullscreenButton(fullscreen);

    this.root = el('div', 'tt-menu', [
      el('div', 'tt-menu__panel', [
        el('div', 'tt-logo tt-menu__logo', [el('div', 'tt-logo__top tt-display', 'TURBO'), el('div', 'tt-logo__bottom tt-display', 'TUMBLE')]),
        cards,
        el('div', 'tt-menu__options', [
          option('players', 'Players'),
          option('split', 'Split'),
          option('track', 'Track'),
          option('cup', 'Cup'),
          option('character', 'Racer'),
          option('kart', 'Kart'),
          option('difficulty', 'CPU'),
          option('racers', 'Racers'),
          option('cc', 'Class'),
          option('mirror', 'Mirror'),
          option('laps', 'Laps'),
          option('items', 'Items'),
        ]),

        start,
        controls,
        el('div', 'tt-menu__help', '↑↓ choose · ←→ change · Enter / Ⓐ select'),
      ]),
      el('div', 'tt-menu__corner', [fullscreen, arcade]),
      this.thumbs,
    ]);
    parent.appendChild(this.root);
    this.render();
  }

  /** Remember the racer / kart picked in the garage. */
  setRacer(character: string, kart: string): void {
    this.choice.character = character;
    this.choice.kart = kart;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.choice));
    } catch {
      /* ignore */
    }
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.classList.toggle('is-open', open);
    if (open) this.render();
    else this.onEnginePreview(null);
  }

  private visibleRows(): RowId[] {
    const rows: RowId[] = ['mode'];
    if (this.choice.mode !== 'timetrial') rows.push('players');
    if (this.choice.mode !== 'timetrial' && this.choice.players === 2) rows.push('split');
    rows.push(this.choice.mode === 'grandprix' ? 'cup' : 'track');
    // Racer & kart are chosen in the garage (1P) or on the join screen (split-screen).
    if (this.choice.mode !== 'timetrial') rows.push('difficulty', 'racers');
    if (this.choice.mode !== 'online') rows.push('cc', 'mirror');
    if (this.choice.mode !== 'grandprix') rows.push('laps');
    if (this.choice.mode !== 'timetrial') rows.push('items');
    rows.push('start', 'controls');
    return rows;
  }

  handle(nav: MenuNav): void {
    if (!this.open) return;
    const rows = this.visibleRows();
    let i = rows.indexOf(this.focus);
    if (i < 0) i = rows.length - 1;
    if (nav.up) this.focus = rows[(i - 1 + rows.length) % rows.length]!;
    if (nav.down) this.focus = rows[(i + 1) % rows.length]!;
    if (nav.left) this.change(this.focus, -1);
    if (nav.right) this.change(this.focus, 1);
    if (nav.confirm) {
      if (this.focus === 'controls') this.onControls();
      else if (this.focus === 'engine') this.onEnginePreview(this.choice.kart);
      else this.start();
      return;
    }
    if (nav.up || nav.down) this.render();
  }

  private change(row: RowId, delta: number): void {
    const c = this.choice;
    const cycle = <T,>(list: readonly T[], cur: T): T => list[(list.indexOf(cur) + delta + list.length) % list.length]!;
    switch (row) {
      case 'mode':
        c.mode = cycle(MODES.map((m) => m.id), c.mode);
        break;
      case 'players':
        c.players = Math.min(4, Math.max(1, c.players + delta));
        break;
      case 'split':
        c.split = c.split === 'horizontal' ? 'vertical' : 'horizontal';
        break;
      case 'track':
        c.trackId = cycle(TRACKS.map((t) => t.id), c.trackId);
        break;
      case 'cup':
        c.cupId = cycle(CUPS.map((x) => x.id), c.cupId);
        break;
      case 'character':
        c.character = cycle(CHARACTERS.map((x) => x.id), c.character);
        break;
      case 'kart':
        c.kart = cycle(KART_BODIES.map((x) => x.id), c.kart);
        this.onEnginePreview(c.kart);
        break;
      case 'difficulty':
        c.difficulty = cycle(DIFFICULTIES, c.difficulty);
        break;
      case 'laps':
        c.laps = Math.min(5, Math.max(1, c.laps + delta));
        break;
      case 'racers':
        c.racers = cycle(RACER_COUNTS, c.racers as (typeof RACER_COUNTS)[number]);
        break;
      case 'cc':
        c.speedClass = cycle(SPEED_CLASSES, c.speedClass);
        break;
      case 'mirror':
        c.mirror = !c.mirror;
        break;
      case 'items':
        c.items = !c.items;
        break;
      default:
        return;
    }
    this.focus = row;
    this.render();
  }

  private start(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.choice));
    } catch {
      /* ignore */
    }
    this.onStart({ ...this.choice, players: this.choice.mode === 'timetrial' ? 1 : this.choice.players });
  }

  /** Postcards of the selected track (or the cup's four). */
  private renderThumbs(): void {
    const c = this.choice;
    const ids = c.mode === 'grandprix' ? (CUPS.find((x) => x.id === c.cupId)?.tracks ?? []) : [c.trackId];
    const key = `${ids.join(',')}|${c.mirror}`;
    if (this.thumbs.dataset.key === key) return;
    this.thumbs.dataset.key = key;
    this.thumbs.classList.toggle('is-cup', ids.length > 1);
    this.thumbs.classList.toggle('is-mirror', c.mirror);
    this.thumbs.replaceChildren(
      ...ids.map((id) => {
        const img = el('img');
        img.src = trackThumb(id);
        img.alt = TRACKS.find((t) => t.id === id)?.name ?? id;
        return el('figure', 'tt-menu__thumb', [img, el('figcaption', '', img.alt)]);
      }),
    );
  }

  private render(): void {
    const c = this.choice;
    const visible = new Set(this.visibleRows());
    MODES.forEach((m, i) => this.modeCards[i]!.classList.toggle('is-selected', m.id === c.mode));
    const character = CHARACTERS.find((x) => x.id === c.character)!;
    const kart = KART_BODIES.find((x) => x.id === c.kart)!;
    const values: Partial<Record<RowId, string>> = {
      players: c.players === 1 ? '1 player' : `${c.players} players (split-screen${c.mode === 'online' ? ', online' : ''})`,
      split: c.split === 'horizontal' ? 'Top / Bottom' : 'Side by side',
      track: `${TRACKS.find((t) => t.id === c.trackId)?.name ?? c.trackId}  (${TRACKS.findIndex((t) => t.id === c.trackId) + 1}/${TRACKS.length})${c.mode === 'online' ? ' · if you host' : ''}`,
      cup: (() => {
        const cup = CUPS.find((x) => x.id === c.cupId)!;
        return `${cup.name}: ${cup.tracks.map((id) => TRACKS.find((t) => t.id === id)?.name ?? id).join(' · ')}`;
      })(),
      character: c.players > 1 ? `P1: ${character.name} (others pick on the next screen)` : `${character.name} · ${character.tagline}`,
      kart: `${kart.name} · ${engineLabel(getEngineProfile(kart.engine))}`,
      difficulty: DIFFICULTY[c.difficulty].label + (c.mode === 'online' ? ' (if you host)' : ''),
      laps: String(c.laps) + (c.mode === 'online' ? ' (if you host)' : ''),
      items: (c.items ? 'On' : 'Off') + (c.mode === 'online' ? ' (if you host)' : ''),
      racers: `${c.racers} karts${c.mode === 'online' ? ' (if you host)' : ''}`,
      cc: `${c.speedClass}cc${c.speedClass === 200 ? ' — hold on!' : ''}`,
      mirror: c.mirror ? 'On — the world is flipped' : 'Off',
    };
    this.renderThumbs();
    for (const [id, row] of this.rows) {
      row.classList.toggle('is-focused', id === this.focus);
      row.style.display = visible.has(id) ? '' : 'none';
      const v = row.querySelector('.tt-menu__value');
      if (v && values[id] !== undefined) v.textContent = values[id]!;
    }
  }
}
