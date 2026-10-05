import { DIFFICULTIES, DIFFICULTY } from '@shared/ai/AIDifficulty';
import { MAX_RACERS } from '@shared/constants/simulation';
import { MAX_ONLINE_HUMANS, normalizeRoomCode, type LobbyMemberView, type LobbyStateView, type RoomSettings } from '@shared/net/Protocol';
import { getCharacter } from '../config/roster';
import type { MenuNav } from '../input/InputManager';
import { el } from './dom';

export interface OnlineActions {
  create(name: string): void;
  quickMatch(name: string): void;
  join(name: string, code: string): void;
  /** Leave the room (lobby view) or close the screen (connect view). */
  back(): void;
  ready(ready: boolean): void;
  settings(change: Partial<RoomSettings>): void;
  start(): void;
}

interface FocusItem {
  el: HTMLElement;
  activate?: () => void;
  change?: (delta: number) => void;
}

const NAME_KEY = 'turbo-tumble.name.v1';
const GRID_SIZES = [0, 4, 6, 8, 10, 12].filter((n) => n <= MAX_RACERS);

function loadName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return `Racer${Math.floor(100 + Math.random() * 900)}`;
}

/**
 * Online screens: "connect" (name, create / quick match / join by code) and the
 * room lobby (code + invite link, members, ping, host settings, ready-up).
 * Mouse, keyboard and controller navigable.
 */
export class OnlineScreen {
  readonly root: HTMLElement;
  open = false;
  view: 'connect' | 'lobby' = 'connect';
  private readonly panel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;
  private items: FocusItem[] = [];
  private focus = 0;
  private busy = false;
  private lobby: LobbyStateView | null = null;
  private me = '';

  constructor(
    parent: HTMLElement,
    private readonly actions: OnlineActions,
    private readonly serverLabel: string,
  ) {
    this.panel = el('div', 'tt-gp__panel tt-online__panel');
    this.status = el('div', 'tt-online__status');
    this.root = el('div', 'tt-gp tt-online', [this.panel]);
    this.nameInput = el('input', 'tt-online__input');
    this.nameInput.maxLength = 16;
    this.nameInput.value = loadName();
    this.nameInput.spellcheck = false;
    this.nameInput.addEventListener('change', () => this.saveName());
    this.codeInput = el('input', 'tt-online__input tt-online__code-input');
    this.codeInput.maxLength = 4;
    this.codeInput.placeholder = 'CODE';
    this.codeInput.spellcheck = false;
    this.codeInput.autocapitalize = 'characters';
    // (Enter in the code box arrives as menu "confirm" → join.)
    this.codeInput.addEventListener('input', () => (this.codeInput.value = normalizeRoomCode(this.codeInput.value)));
    parent.appendChild(this.root);
  }

  get name(): string {
    return this.nameInput.value.trim() || 'Racer';
  }

  private saveName(): void {
    try {
      localStorage.setItem(NAME_KEY, this.name);
    } catch {
      /* ignore */
    }
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.classList.toggle('is-open', open);
    if (!open) (document.activeElement as HTMLElement | null)?.blur?.();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.panel.classList.toggle('is-busy', busy);
  }

  setStatus(text: string, kind: 'info' | 'error' = 'info'): void {
    this.status.textContent = text;
    this.status.className = `tt-online__status is-${kind}`;
  }

  // ---------------------------------------------------------------- connect view

  showConnect(code = ''): void {
    this.view = 'connect';
    this.lobby = null;
    if (code) this.codeInput.value = normalizeRoomCode(code);
    const create = el('button', 'tt-button tt-online__btn', 'Create room');
    const quick = el('button', 'tt-button tt-online__btn', 'Quick match');
    const join = el('button', 'tt-button tt-online__btn', 'Join');
    const back = el('button', 'tt-button tt-online__btn is-small', 'Back');
    create.addEventListener('click', () => this.run(() => this.actions.create(this.name)));
    quick.addEventListener('click', () => this.run(() => this.actions.quickMatch(this.name)));
    join.addEventListener('click', () => this.doJoin());
    back.addEventListener('click', () => this.actions.back());
    this.panel.replaceChildren(
      el('h2', 'tt-gp__title tt-display', 'ONLINE'),
      el('div', 'tt-gp__sub', 'Race friends anywhere'),
      el('label', 'tt-online__field', [el('span', 'tt-online__label', 'Your name'), this.nameInput]),
      el('div', 'tt-online__choices', [
        el('div', 'tt-online__choice', [create, el('div', 'tt-online__blurb', 'Private room — share the code')]),
        el('div', 'tt-online__choice', [quick, el('div', 'tt-online__blurb', 'Jump into any open room')]),
        el('div', 'tt-online__choice', [el('div', 'tt-online__join', [this.codeInput, join]), el('div', 'tt-online__blurb', 'Got a code? Type it here')]),
      ]),
      this.status,
      el('div', 'tt-online__footer', [back, el('span', 'tt-online__server', `Server: ${this.serverLabel}`)]),
    );
    this.items = [{ el: this.nameInput, activate: () => this.nameInput.focus() }, { el: create, activate: () => create.click() }, { el: quick, activate: () => quick.click() }, { el: this.codeInput, activate: () => (this.codeInput.value ? this.doJoin() : this.codeInput.focus()) }, { el: join, activate: () => join.click() }, { el: back, activate: () => back.click() }];
    this.focus = this.codeInput.value ? 4 : 1;
    this.renderFocus();
  }

  private doJoin(): void {
    const code = normalizeRoomCode(this.codeInput.value);
    if (code.length < 4) {
      this.setStatus('Room codes have 4 letters — ask the host for theirs.', 'error');
      this.codeInput.focus();
      return;
    }
    this.run(() => this.actions.join(this.name, code));
  }

  private run(fn: () => void): void {
    if (this.busy) return;
    this.saveName();
    fn();
  }

  // ---------------------------------------------------------------- lobby view

  showLobby(): void {
    this.view = 'lobby';
    this.focus = 0;
    if (this.lobby) this.renderLobby();
  }

  updateLobby(view: LobbyStateView, me: string): void {
    this.lobby = view;
    this.me = me;
    if (this.view === 'lobby') this.renderLobby();
  }

  private renderLobby(): void {
    const v = this.lobby!;
    const host = v.hostId === this.me;
    const members = Object.values(v.members);
    const humans = members.reduce((n, m) => n + m.seats.length, 0);
    const meMember = v.members[this.me];

    const invite = el('button', 'tt-button tt-online__btn is-small', 'Copy invite link');
    invite.addEventListener('click', () => {
      const url = `${location.origin}${location.pathname}?room=${v.code}`;
      void navigator.clipboard?.writeText(url).then(
        () => this.setStatus('Invite link copied — send it to your friends!'),
        () => this.setStatus(url),
      );
    });

    const list = el(
      'div',
      'tt-online__members',
      members.map((m) => this.memberRow(m, v)),
    );
    for (let i = humans; i < MAX_ONLINE_HUMANS && i < Math.max(humans + 1, 4); i++) list.appendChild(el('div', 'tt-online__member is-empty', 'Waiting for racers…'));

    const settingRows: FocusItem[] = [];
    const setting = (label: string, value: string, change: (d: number) => void): HTMLElement => {
      const prev = el('button', 'tt-menu__arrow', '◀');
      const next = el('button', 'tt-menu__arrow', '▶');
      prev.addEventListener('click', () => change(-1));
      next.addEventListener('click', () => change(1));
      const row = el('div', `tt-menu__row tt-online__setting${host ? '' : ' is-readonly'}`, [el('span', 'tt-menu__label', label), prev, el('span', 'tt-menu__value', value), next]);
      if (host) settingRows.push({ el: row, change });
      return row;
    };
    const cycle = <T,>(list: readonly T[], cur: T, d: number): T => list[(Math.max(0, list.indexOf(cur)) + d + list.length) % list.length]!;
    const grid = v.racerCount <= humans ? 'Humans only' : `${v.racerCount} karts + CPUs`;
    const settings = el('div', 'tt-online__settings', [
      setting('Laps', String(v.laps), (d) => this.actions.settings({ laps: Math.min(5, Math.max(1, v.laps + d)) })),
      setting('Items', v.items ? 'On' : 'Off', () => this.actions.settings({ items: !v.items })),
      setting('Grid', grid, (d) => this.actions.settings({ racerCount: cycle(GRID_SIZES, GRID_SIZES.includes(v.racerCount) ? v.racerCount : 8, d) })),
      setting('CPU', DIFFICULTY[v.difficulty]?.label ?? v.difficulty, (d) => this.actions.settings({ difficulty: cycle(DIFFICULTIES, v.difficulty, d) })),
    ]);

    const waiting = members.filter((m) => !m.ready && m.sessionId !== v.hostId);
    const main = el('button', 'tt-button tt-online__btn tt-online__go');
    if (v.phase !== 'lobby') {
      main.textContent = 'Race in progress…';
      main.disabled = true;
    } else if (host) {
      main.textContent = waiting.length ? `Waiting for ${waiting.length} racer${waiting.length > 1 ? 's' : ''}…` : 'START RACE!';
      main.classList.toggle('is-waiting', waiting.length > 0);
      main.addEventListener('click', () => this.actions.start());
    } else {
      main.textContent = meMember?.ready ? 'Ready! (click to cancel)' : 'READY UP';
      main.classList.toggle('is-ready', Boolean(meMember?.ready));
      main.addEventListener('click', () => this.actions.ready(!meMember?.ready));
    }
    const leave = el('button', 'tt-button tt-online__btn is-small', 'Leave room');
    leave.addEventListener('click', () => this.actions.back());

    this.panel.replaceChildren(
      el('div', 'tt-online__room', [el('span', 'tt-online__label', 'Room code'), el('span', 'tt-online__code tt-display', v.code), invite]),
      el('div', 'tt-gp__sub', `${humans} / ${MAX_ONLINE_HUMANS} racers · ${v.raceCount ? `${v.raceCount} race${v.raceCount > 1 ? 's' : ''} played` : 'first race'}`),
      list,
      settings,
      el('div', 'tt-online__actions', [main, leave]),
      this.status,
      el('div', 'tt-gp__hint', host ? '↑↓ choose · ←→ change settings · Enter / Ⓐ start · Esc / Ⓑ leave' : 'Enter / Ⓐ ready up · Esc / Ⓑ leave · the host picks the settings'),
    );
    this.items = [...settingRows, { el: main, activate: () => main.click() }, { el: leave, activate: () => leave.click() }];
    this.focus = Math.min(this.focus, this.items.length - 1);
    if (this.focus < settingRows.length && !host) this.focus = settingRows.length;
    this.renderFocus();
  }

  private memberRow(m: LobbyMemberView, v: LobbyStateView): HTMLElement {
    const dots = el(
      'span',
      'tt-online__dots',
      m.seats.map((s) => {
        const d = el('span', 'tt-gp__dot');
        d.style.background = getCharacter(s.character).color;
        return d;
      }),
    );
    const names = m.seats.length > 1 ? `${m.name} (+${m.seats.length - 1} split-screen)` : m.name;
    const tags: HTMLElement[] = [];
    if (m.sessionId === v.hostId) tags.push(el('span', 'tt-online__tag is-host', 'HOST'));
    if (m.sessionId === this.me) tags.push(el('span', 'tt-online__tag is-you', 'YOU'));
    const state = !m.connected ? 'reconnecting…' : m.sessionId === v.hostId ? '' : m.ready ? 'ready ✓' : 'not ready';
    return el('div', `tt-online__member${m.ready || m.sessionId === v.hostId ? ' is-ready' : ''}${m.connected ? '' : ' is-away'}`, [
      dots,
      el('span', 'tt-online__name', [names, ...tags]),
      el('span', 'tt-online__state', state),
      el('span', 'tt-online__ping', m.ping ? `${m.ping} ms` : '—'),
      el('span', 'tt-online__pts', `${m.points} pts`),
    ]);
  }

  // ---------------------------------------------------------------- navigation

  handle(nav: MenuNav, escape: boolean): void {
    if (!this.open || this.busy) return;
    if (escape || (nav.back && !(document.activeElement instanceof HTMLInputElement))) {
      this.actions.back();
      return;
    }
    const n = this.items.length;
    if (!n) return;
    // A field clicked with the mouse takes the keyboard focus with it.
    const typing = this.items.findIndex((it) => it.el === document.activeElement);
    if (typing >= 0) this.focus = typing;
    if (nav.up) this.focus = (this.focus - 1 + n) % n;
    if (nav.down) this.focus = (this.focus + 1) % n;
    const item = this.items[this.focus]!;
    if ((nav.left || nav.right) && item.change) item.change(nav.right ? 1 : -1);
    if (nav.up || nav.down) this.renderFocus();
    if (nav.confirm) item.activate?.();
  }

  private renderFocus(): void {
    this.items.forEach((it, i) => it.el.classList.toggle('is-focused', i === this.focus));
    const it = this.items[this.focus];
    if (it && it.el instanceof HTMLInputElement) it.el.focus();
    else if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
  }
}
