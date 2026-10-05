import { el } from './dom';

/** Full-screen branded loading screen with a progress bar. */
export class LoadingScreen {
  readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;

  constructor(parent: HTMLElement) {
    this.fill = el('div', 'tt-loading__fill');
    this.label = el('div', 'tt-loading__label', 'Warming up engines');
    this.root = el('div', 'tt-loading', [
      el('div', 'tt-logo', [
        el('div', 'tt-logo__top tt-display', 'TURBO'),
        el('div', 'tt-logo__bottom tt-display', 'TUMBLE'),
        el('div', 'tt-logo__tag', 'Grand Prix'),
      ]),
      el('div', 'tt-loading__bar', [this.fill]),
      this.label,
    ]);
    parent.appendChild(this.root);
  }

  progress(fraction: number, label?: string): void {
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    if (label) this.label.textContent = label;
  }

  error(message: string): void {
    this.root.appendChild(el('div', 'tt-loading__error', message));
  }

  hide(): void {
    this.root.classList.add('is-hidden');
    window.setTimeout(() => this.root.remove(), 700);
  }
}
