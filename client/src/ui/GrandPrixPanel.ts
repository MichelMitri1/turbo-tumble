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

/** Between-race Grand Prix standings and the final podium. */
export class GrandPrixPanel {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  open = false;

  constructor(parent: HTMLElement) {
    this.panel = el('div', 'tt-gp__panel');
    this.root = el('div', 'tt-gp', [this.panel]);
    parent.appendChild(this.root);
  }

  show(title: string, subtitle: string, rows: readonly GpRow[], hint: string, podium = false): void {
    const children: HTMLElement[] = [el('h2', 'tt-gp__title tt-display', title), el('div', 'tt-gp__sub', subtitle)];
    if (podium) {
      const top = rows.slice(0, 3);
      const order = [1, 0, 2].filter((i) => top[i]);
      children.push(
        el(
          'div',
          'tt-podium',
          order.map((i) => {
            const r = top[i]!;
            return el('div', `tt-podium__step p${i + 1}`, [el('div', 'tt-podium__trophy', i === 0 ? '🏆' : i === 1 ? '🥈' : '🥉'), el('div', '', r.name), el('div', '', `${r.points} pts`)]);
          }),
        ),
      );
    }
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
