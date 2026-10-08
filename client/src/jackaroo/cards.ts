/** Jackaroo uses one standard 52-card deck (no jokers). */
export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

export interface Card {
  /** 0–51: suit * 13 + rank - 1. */
  id: number;
  /** 1 = Ace … 11 = Jack, 12 = Queen, 13 = King. */
  r: number;
  s: Suit;
}

export const cardOf = (id: number): Card => ({ id, r: (id % 13) + 1, s: SUITS[Math.floor(id / 13)]! });

export function buildDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => cardOf(i));
}

export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const isRed = (c: Card) => c.s === 'H' || c.s === 'D';
export const isBlack = (c: Card) => !isRed(c);

export const cardLabel = (c: Card) => `${RANK_LABEL[c.r]}${SUIT_GLYPH[c.s]}`;
/** Image file (public/assets/jackaroo/cards/), rendered from Byron Knoll's public-domain vector deck. */
export const cardImage = (c: Card) => `/assets/jackaroo/cards/${RANK_LABEL[c.r]}${c.s}.webp`;

/** Hand order: by rank (A…K), then suit. */
export const sortKey = (c: Card) => c.r * 4 + SUITS.indexOf(c.s);

/**
 * The arcade card back: a lacquered teal field with an eight-pointed-star
 * (khatam) lattice in gold, framed like a mosaic panel.
 */
export function backSvg(): string {
  const star = (cx: number, cy: number, r: number) => {
    const pts: string[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8 - Math.PI / 2;
      const rr = i % 2 ? r * 0.62 : r;
      pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
    }
    return `<polygon points="${pts.join(' ')}"/>`;
  };
  let lattice = '';
  for (let y = 0; y <= 5; y++) for (let x = 0; x <= 3; x++) lattice += star(14 + x * 28 - (y % 2 ? 14 : 0), 16 + y * 28, 10);
  return `<svg viewBox="0 0 120 175" width="240" height="350" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
  <defs>
    <linearGradient id="jkb-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d5c63"/><stop offset="0.55" stop-color="#093f4a"/><stop offset="1" stop-color="#062a33"/></linearGradient>
    <clipPath id="jkb-c"><rect x="9" y="9" width="102" height="157" rx="6"/></clipPath>
  </defs>
  <rect x="1" y="1" width="118" height="173" rx="11" fill="#fbf4e2" stroke="#1d1a14" stroke-width="2"/>
  <rect x="6" y="6" width="108" height="163" rx="8" fill="url(#jkb-g)"/>
  <g clip-path="url(#jkb-c)" fill="none" stroke="#e6b450" stroke-width="1.6" opacity="0.85">${lattice}</g>
  <rect x="9" y="9" width="102" height="157" rx="6" fill="none" stroke="#e6b450" stroke-width="2"/>
  <circle cx="60" cy="87.5" r="22" fill="#062a33" stroke="#f2c867" stroke-width="2.5"/>
  ${star(60, 87.5, 17).replace('<polygon', '<polygon fill="#f2c867"')}
  <circle cx="60" cy="87.5" r="6" fill="#0d5c63"/>
</svg>`;
}
