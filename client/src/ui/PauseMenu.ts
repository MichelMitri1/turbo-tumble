import { el } from './dom';
import { bindFullscreenButton } from './fullscreen';

export interface PauseActions {
  resume(): void;
  reset(): void;
  restart(): void;
  quit(): void;
  toggleDebug(): void;
}

/** Simple pause panel (keyboard/gamepad navigable via the game's input polling). */
export class PauseMenu {
  readonly root: HTMLElement;
  private readonly buttons: HTMLButtonElement[];
  private readonly title: HTMLElement;
  private focus = 0;
  open = false;

  constructor(parent: HTMLElement, actions: PauseActions) {
    const button = (label: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', 'tt-button', label);
      b.addEventListener('click', fn);
      return b;
    };
    this.buttons = [
      button('Resume', () => actions.resume()),
      button('Reset Kart', () => {
        actions.reset();
        actions.resume();
      }),
      button('Restart Race', () => actions.restart()),
      button('Quit to Menu', () => actions.quit()),
      button('Fullscreen', () => undefined),
      button('Toggle Debug', () => actions.toggleDebug()),
    ];
    bindFullscreenButton(this.buttons[4]!, ['Fullscreen', 'Exit Fullscreen']);
    this.title = el('h2', 'tt-panel__title tt-display', 'PAUSED');
    this.root = el('div', 'tt-pause', [el('div', 'tt-panel', [this.title, ...this.buttons])]);
    parent.appendChild(this.root);
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.classList.toggle('is-open', open);
    if (open) this.setFocus(0);
  }

  /** Online races can't pause or restart: the panel becomes a menu over the live race. */
  setOnline(online: boolean): void {
    this.title.textContent = online ? 'MENU' : 'PAUSED';
    this.buttons[2]!.style.display = online ? 'none' : '';
    this.buttons[3]!.textContent = online ? 'Leave Room' : 'Quit to Menu';
  }

  private visible(): HTMLButtonElement[] {
    return this.buttons.filter((b) => b.style.display !== 'none');
  }

  move(delta: number): void {
    const n = this.visible().length;
    this.setFocus((this.focus + delta + n) % n);
  }

  activate(): void {
    this.visible()[this.focus]?.click();
  }

  private setFocus(i: number): void {
    this.focus = i;
    const shown = this.visible();
    this.buttons.forEach((b) => b.classList.toggle('is-focused', b === shown[i]));
  }
}
