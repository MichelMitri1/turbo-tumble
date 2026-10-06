import { INPUT_ACTIONS, buttonLabel, keyLabel, type InputAction } from '../input/bindings';
import type { InputManager, MenuNav } from '../input/InputManager';
import { el } from './dom';
import type { AudioEngine } from '../audio/AudioEngine';

const ACTION_LABELS: Record<InputAction, string> = {
  accelerate: 'Accelerate',
  brake: 'Brake / Reverse',
  left: 'Steer Left',
  right: 'Steer Right',
  drift: 'Hop / Drift',
  item: 'Use Item',
  reset: 'Reset Kart',
  pause: 'Pause',
};

type Column = 'keyboard' | 'gamepad';
type Row = InputAction | 'music' | 'sound' | 'deadzone' | 'reset' | 'back';
type VolumeRow = 'music' | 'sound';
const DEADZONES = [0.05, 0.1, 0.16, 0.22, 0.3];

/**
 * Rebinding screen: single-player keyboard keys and controller buttons (shared by
 * every pad), music / sound volume and the stick dead zone. Choose a cell and
 * press the new key/button.
 */
export class ControlsPanel {
  readonly root: HTMLElement;
  private readonly table: HTMLElement;
  private row: Row = 'accelerate';
  private column: Column = 'keyboard';
  private capturing = false;
  open = false;

  constructor(
    parent: HTMLElement,
    private readonly input: InputManager,
    private readonly audio: AudioEngine,
    private readonly onClose: () => void,
  ) {
    this.table = el('div', 'tt-controls__table');
    this.root = el('div', 'tt-gp tt-controls', [
      el('div', 'tt-gp__panel', [
        el('h2', 'tt-gp__title tt-display', 'CONTROLS & SOUND'),
        el('div', 'tt-gp__sub', 'Pick a binding and press the new key or button · M mutes anytime'),
        this.table,
        el('div', 'tt-gp__hint', '↑↓ row · ←→ keyboard / controller · Enter / Ⓐ rebind · Esc / Ⓑ back'),
        el('div', 'tt-controls__credits', 'Engine recordings: Edvvc, Altair78 · Wikimedia Commons · CC BY-SA (assets/audio/engines/LICENSES.md)'),
      ]),
    ]);
    parent.appendChild(this.root);
  }

  private rows(): Row[] {
    return [...INPUT_ACTIONS, 'music', 'sound', 'deadzone', 'reset', 'back'];
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.classList.toggle('is-open', open);
    if (!open) this.stopCapture();
    if (open) this.render();
  }

  handle(nav: MenuNav): void {
    if (!this.open || this.capturing) return;
    if (nav.back || this.input.keyboard.wasPressed('Escape')) {
      this.setOpen(false);
      this.onClose();
      return;
    }
    const rows = this.rows();
    const i = rows.indexOf(this.row);
    if (nav.up) this.row = rows[(i - 1 + rows.length) % rows.length]!;
    if (nav.down) this.row = rows[(i + 1) % rows.length]!;
    if ((this.row === 'music' || this.row === 'sound') && (nav.left || nav.right)) {
      this.changeVolume(this.row, nav.right ? 1 : -1);
    } else if (this.row === 'deadzone' && (nav.left || nav.right)) {
      const cur = DEADZONES.findIndex((d) => d >= this.input.stick.deadZone - 1e-3);
      const next = Math.min(DEADZONES.length - 1, Math.max(0, (cur < 0 ? 2 : cur) + (nav.right ? 1 : -1)));
      this.input.setDeadZone(DEADZONES[next]!);
    } else if (nav.left || nav.right) {
      this.column = this.column === 'keyboard' ? 'gamepad' : 'keyboard';
    }
    if (nav.confirm) this.activate();
    if (nav.up || nav.down || nav.left || nav.right || nav.confirm) this.render();
  }

  private activate(): void {
    if (this.row === 'back') {
      this.setOpen(false);
      this.onClose();
      return;
    }
    if (this.row === 'reset') {
      this.input.resetAll();
      this.render();
      return;
    }
    if (this.row === 'deadzone' || this.row === 'music' || this.row === 'sound') return;
    const action = this.row;
    this.capturing = true;
    this.render();
    if (this.column === 'keyboard') {
      this.input.keyboard.captureNextKey((code) => {
        if (code !== 'Escape' || action === 'pause') this.input.rebindKey('full', action, code);
        this.capturing = false;
        this.render();
      });
    } else {
      this.input.captureNextButton((button) => {
        this.input.rebindButton(action, button);
        this.capturing = false;
        this.render();
      });
    }
  }

  private changeVolume(row: VolumeRow, delta: number): void {
    const kind = row === 'music' ? 'music' : 'sfx';
    this.audio.setVolume(kind, Math.round(this.audio.settings[kind] * 10 + delta) / 10);
    if (this.audio.settings.muted) this.audio.setMuted(false);
  }

  private stopCapture(): void {
    this.capturing = false;
    this.input.captureNextButton(null);
  }

  private render(): void {
    const kb = this.input.bindings('full');
    const pad = this.input.gamepadBindings;
    const cell = (row: Row, col: Column, text: string): HTMLElement => {
      const focused = this.row === row && this.column === col;
      const c = el('span', `tt-controls__cell${focused ? ' is-focused' : ''}${focused && this.capturing ? ' is-capturing' : ''}`, focused && this.capturing ? 'Press…' : text);
      c.addEventListener('click', () => {
        this.row = row;
        this.column = col;
        this.activate();
      });
      return c;
    };
    const lines: HTMLElement[] = [el('div', 'tt-controls__row is-head', [el('span', '', ''), el('span', '', 'Keyboard'), el('span', '', 'Controller')])];
    for (const a of INPUT_ACTIONS) {
      lines.push(
        el('div', 'tt-controls__row', [el('span', 'tt-controls__label', ACTION_LABELS[a]), cell(a, 'keyboard', kb[a].map(keyLabel).join(' / ')), cell(a, 'gamepad', pad[a].map(buttonLabel).join(' / '))]),
      );
    }
    const volume = (row: VolumeRow, label: string): HTMLElement => {
      const v = Math.round(this.audio.settings[row === 'music' ? 'music' : 'sfx'] * 10);
      const bar = '▮'.repeat(v) + '▯'.repeat(10 - v);
      const cell = el('span', 'tt-controls__cell is-wide', `◀ ${bar} ${v * 10}% ▶`);
      cell.addEventListener('click', (e) => {
        const rect = cell.getBoundingClientRect();
        this.row = row;
        this.changeVolume(row, e.clientX > rect.left + rect.width / 2 ? 1 : -1);
        this.render();
      });
      return el('div', `tt-controls__row${this.row === row ? ' is-selected' : ''}`, [el('span', 'tt-controls__label', label), cell]);
    };
    const dz = el('div', `tt-controls__row${this.row === 'deadzone' ? ' is-selected' : ''}`, [
      el('span', 'tt-controls__label', 'Stick dead zone'),
      el('span', 'tt-controls__cell is-wide', `◀ ${Math.round(this.input.stick.deadZone * 100)}% ▶`),
    ]);
    const reset = el('button', `tt-button tt-controls__btn${this.row === 'reset' ? ' is-focused' : ''}`, 'Reset to defaults');
    reset.addEventListener('click', () => {
      this.row = 'reset';
      this.activate();
    });
    const back = el('button', `tt-button tt-controls__btn${this.row === 'back' ? ' is-focused' : ''}`, 'Back');
    back.addEventListener('click', () => {
      this.row = 'back';
      this.activate();
    });
    this.table.replaceChildren(...lines, volume('music', 'Music volume'), volume('sound', 'Sound volume'), dz, el('div', 'tt-controls__buttons', [reset, back]));
  }
}
