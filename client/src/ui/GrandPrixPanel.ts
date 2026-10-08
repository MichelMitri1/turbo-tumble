import { el } from './dom';

export interface GpRow {
  id: string;
  name: string;
  color: string;
  points: number;
  /** Points just earned (shown as +N). */
  plus: number;
  me: boolean;
}

/** Between-race Grand Prix standings, and the standings overlay on the 3D podium. */
export class GrandPrixPanel {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  open = false;

  constructor(parent: HTMLElement) {
    this.panel = el('div', 'tt-gp__panel');
    this.root = el('div', 'tt-gp', [this.panel]);
    parent.appendChild(this.root);
  }

  /** `podium`: the 3D trophy ceremony is showing — the panel moves aside to frame it. */
  show(title: string, subtitle: string, rows: readonly GpRow[], hint: string, podium = false): void {
    this.root.classList.toggle('is-side', podium);
    const children: HTMLElement[] = [el('h2', 'tt-gp__title tt-display', title), el('div', 'tt-gp__sub', subtitle)];
    rows.forEach((r, i) => {
      const dot = el('span', 'tt-gp__dot');
      dot.style.background = r.color;
      const row = el('div', `tt-gp__row${r.me ? ' is-me' : ''}`, [el('span', '', `${i + 1}.`), dot, el('span', '', r.name), el('span', 'tt-gp__pts', String(r.points)), el('span', 'tt-gp__plus', r.plus ? `+${r.plus}` : '')]);
      row.style.animationDelay = `${i * 0.05}s`;
      children.push(row);
    });
    children.push(el('div', 'tt-gp__hint', hint));
    this.panel.replaceChildren(...children);
    this.open = true;
    this.root.classList.add('is-open');
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('is-open');
  }
}
