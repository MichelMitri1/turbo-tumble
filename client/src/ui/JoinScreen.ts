import { CHARACTERS, KART_BODIES } from '../config/roster';
import { deviceLabel, sameDevice, type DeviceAssignment, type InputManager } from '../input/InputManager';
import type { PlayerSetup } from '../game/SessionConfig';
import { el } from './dom';
import { engineLabel, getEngineProfile } from '../audio/EngineProfiles';

interface Slot {
  device: DeviceAssignment | null;
  character: number;
  kart: number;
  ready: boolean;
  card: HTMLElement;
}

const PLAYER_COLORS = ['#ff4f9a', '#3fd8ff', '#ffd23f', '#7ddc4a'];

/**
 * "Player N — press any button": each local player claims a slot with their own
 * device (a controller, or one half of the keyboard), picks a racer (←→) and kart
 * (↑↓) with that device, and readies up. Starts when every slot is ready.
 */
export class JoinScreen {
  readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private slots: Slot[] = [];
  open = false;

  constructor(
    parent: HTMLElement,
    private readonly input: InputManager,
    private readonly onDone: (players: PlayerSetup[] | null) => void,
    private readonly sound: (name: 'uiJoin' | 'uiReady' | 'uiChange' | 'uiBack') => void = () => undefined,
    private readonly onEnginePreview: (kart: string | null) => void = () => undefined,
  ) {
    this.grid = el('div', 'tt-join__grid');
    this.root = el('div', 'tt-join', [
      el('h2', 'tt-join__title tt-display', 'WHO’S RACING?'),
      this.grid,
      el('div', 'tt-join__help', [
        el('div', '', 'Join: press any button on a controller · Keyboard: WASD + Space  or  Arrows + /'),
        el('div', '', '←→ racer · ↑↓ kart · confirm (Ⓐ / Space / /) ready · back (Ⓑ / R / Backspace) leave · Esc cancel'),
      ]),
    ]);
    parent.appendChild(this.root);
  }

  /** Open for `count` players, seeding player 1's picks from the main menu. */
  show(count: number, firstCharacter: string, firstKart: string): void {
    this.grid.replaceChildren();
    this.slots = Array.from({ length: count }, (_, i) => {
      const card = el('div', 'tt-join__card');
      card.style.setProperty('--slot-color', PLAYER_COLORS[i]!);
      this.grid.appendChild(card);
      return {
        device: null,
        character: i === 0 ? Math.max(0, CHARACTERS.findIndex((c) => c.id === firstCharacter)) : i % CHARACTERS.length,
        kart: i === 0 ? Math.max(0, KART_BODIES.findIndex((k) => k.id === firstKart)) : (i * 2) % KART_BODIES.length,
        ready: false,
        card,
      };
    });
    this.open = true;
    this.root.classList.add('is-open');
    this.render();
  }

  hide(): void {
    this.onEnginePreview(null);
    this.open = false;
    this.root.classList.remove('is-open');
  }

  /** Per-frame input handling (joins, picks, ready-up). */
  update(): void {
    if (!this.open) return;
    // Escape (shared by both keyboard halves) cancels back to the menu.
    if (this.input.keyboard.wasPressed('Escape')) {
      this.hide();
      this.onDone(null);
      return;
    }
    let changed = false;
    // Joined players drive their own slot.
    for (const slot of this.slots) {
      if (!slot.device) continue;
      const nav = this.input.navFor(slot.device);
      if (nav.back) {
        if (slot.ready) slot.ready = false;
        else slot.device = null;
        this.sound('uiBack');
        changed = true;
        continue;
      }
      if (slot.ready) {
        if (nav.confirm) slot.ready = false;
        changed ||= nav.confirm;
        continue;
      }
      if (nav.left || nav.right) slot.character = (slot.character + (nav.right ? 1 : -1) + CHARACTERS.length) % CHARACTERS.length;
      if (nav.up || nav.down) slot.kart = (slot.kart + (nav.down ? 1 : -1) + KART_BODIES.length) % KART_BODIES.length;
      if (nav.up || nav.down) this.onEnginePreview(KART_BODIES[slot.kart]!.id);
      if (nav.left || nav.right || nav.up || nav.down) this.sound('uiChange');
      if (nav.confirm) {
        slot.ready = true;
        this.sound('uiReady');
      }
      changed ||= nav.left || nav.right || nav.up || nav.down || nav.confirm;
    }
    // A new device claims the first open slot.
    const join = this.input.detectJoin();
    if (join && !this.slots.some((s) => s.device && sameDevice(s.device, join))) {
      const free = this.slots.find((s) => !s.device);
      if (free) {
        free.device = join;
        this.sound('uiJoin');
        changed = true;
      }
    }
    if (changed) this.render();
    if (this.slots.every((s) => s.device && s.ready)) {
      this.hide();
      this.onDone(this.slots.map((s) => ({ character: CHARACTERS[s.character]!.id, kart: KART_BODIES[s.kart]!.id, device: s.device! })));
    }
  }

  private render(): void {
    this.slots.forEach((s, i) => {
      const c = CHARACTERS[s.character]!;
      const k = KART_BODIES[s.kart]!;
      const swatch = el('div', 'tt-join__swatch');
      swatch.style.background = c.color;
      if (!s.device) {
        s.card.className = 'tt-join__card is-waiting';
        s.card.replaceChildren(el('div', 'tt-join__p tt-display', `P${i + 1}`), el('div', 'tt-join__wait', 'Press any button'));
        return;
      }
      s.card.className = `tt-join__card is-joined${s.ready ? ' is-ready' : ''}`;
      s.card.replaceChildren(
        el('div', 'tt-join__p tt-display', `P${i + 1}`),
        el('div', 'tt-join__device', deviceLabel(s.device)),
        swatch,
        el('div', 'tt-join__racer', `◀ ${c.name} ▶`),
        el('div', 'tt-join__kart', `▲ ${k.name} ▼`),
        el('div', 'tt-join__engine', engineLabel(getEngineProfile(k.engine))),
        el('div', 'tt-join__state tt-display', s.ready ? 'READY!' : 'Choose…'),
      );
    });
  }
}
