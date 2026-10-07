/** Last Card — the classic shedding card game (108-card deck). */
export type Color = 'r' | 'y' | 'g' | 'b';
export const COLORS: Color[] = ['r', 'y', 'g', 'b'];
export type Kind = 'num' | 'skip' | 'rev' | 'draw2' | 'wild' | 'wild4';

export interface Card {
  id: number;
  kind: Kind;
  /** null for wild cards. */
  color: Color | null;
  /** 0–9 for number cards, -1 otherwise. */
  n: number;
}

export const COLOR_INFO: Record<Color, { name: string; hex: string; dark: string }> = {
  r: { name: 'Red', hex: '#e8262f', dark: '#9c1219' },
  y: { name: 'Yellow', hex: '#f7c313', dark: '#a87c00' },
  g: { name: 'Green', hex: '#33a846', dark: '#1b6a28' },
  b: { name: 'Blue', hex: '#1f6fd6', dark: '#0e3f86' },
};

/** 4 colours × (one 0, two each of 1–9, two Skip / Reverse / Draw Two) + 4 Wild + 4 Wild Draw Four. */
export function buildDeck(): Card[] {
  const out: Card[] = [];
  let id = 0;
  for (const color of COLORS) {
    out.push({ id: id++, kind: 'num', color, n: 0 });
    for (let k = 0; k < 2; k++) {
      for (let n = 1; n <= 9; n++) out.push({ id: id++, kind: 'num', color, n });
      for (const kind of ['skip', 'rev', 'draw2'] as const) out.push({ id: id++, kind, color, n: -1 });
    }
  }
  for (let k = 0; k < 4; k++) {
    out.push({ id: id++, kind: 'wild', color: null, n: -1 });
    out.push({ id: id++, kind: 'wild4', color: null, n: -1 });
  }
  return out;
}

/** Scoring: face value; Skip / Reverse / Draw Two 20; Wilds 50. */
export function points(c: Card): number {
  if (c.kind === 'num') return c.n;
  if (c.kind === 'wild' || c.kind === 'wild4') return 50;
  return 20;
}

const KIND_NAME: Record<Kind, string> = { num: '', skip: 'Skip', rev: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four' };

export function cardLabel(c: Pick<Card, 'kind' | 'color' | 'n'>): string {
  if (c.kind === 'wild' || c.kind === 'wild4') return KIND_NAME[c.kind];
  const col = COLOR_INFO[c.color!].name;
  return c.kind === 'num' ? `${col} ${c.n}` : `${col} ${KIND_NAME[c.kind]}`;
}

/** Hand sort: by colour, then number / action, wilds last. */
export function sortKey(c: Card): number {
  const col = c.color ? COLORS.indexOf(c.color) : 4;
  const k = c.kind === 'num' ? c.n : c.kind === 'skip' ? 10 : c.kind === 'rev' ? 11 : c.kind === 'draw2' ? 12 : c.kind === 'wild' ? 13 : 14;
  return col * 100 + k;
}
