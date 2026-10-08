/**
 * A standard 52-card deck. A card is a number 0–51: suit * 13 + rank,
 * rank 0 = 2 … 12 = Ace. Hearts are always trump in 400.
 */
export type Suit = 0 | 1 | 2 | 3;
export const SPADES = 0;
export const HEARTS = 1;
export const DIAMONDS = 2;
export const CLUBS = 3;
export const SUIT_LETTER = ['S', 'H', 'D', 'C'] as const;
export const SUIT_SYMBOL = ['♠', '♥', '♦', '♣'] as const;
export const SUIT_NAME = ['Spades', 'Hearts', 'Diamonds', 'Clubs'] as const;
export const RANK_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export const suitOf = (c: number): Suit => Math.floor(c / 13) as Suit;
export const rankOf = (c: number): number => c % 13;
export const card = (suit: Suit, rank: number): number => suit * 13 + rank;
export const label = (c: number): string => `${RANK_LABEL[rankOf(c)]}${SUIT_SYMBOL[suitOf(c)]}`;
/** Image file for a card (public-domain vector deck, rendered to WebP). */
export const cardImage = (c: number): string => `/assets/400/cards/${RANK_LABEL[rankOf(c)]}${SUIT_LETTER[suitOf(c)]}.webp`;

/** Fisher–Yates with an injectable random source (tests, server). */
export function shuffled(rand: () => number = Math.random): number[] {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d;
}

/** Hand order on screen: alternate colours (♠ ♥ ♣ ♦), high to low inside a suit. */
const SUIT_ORDER = [0, 1, 3, 2];
export function sortHand(h: number[]): number[] {
  return [...h].sort((a, b) => SUIT_ORDER[suitOf(a)]! - SUIT_ORDER[suitOf(b)]! || rankOf(b) - rankOf(a));
}

/** Who wins a trick: the highest heart, else the highest card of the suit led. Returns the index into `cards`. */
export function trickWinner(cards: number[]): number {
  const led = suitOf(cards[0]!);
  let best = 0;
  for (let i = 1; i < cards.length; i++) {
    const c = cards[i]!;
    const b = cards[best]!;
    const cTrump = suitOf(c) === HEARTS;
    const bTrump = suitOf(b) === HEARTS;
    if (cTrump && !bTrump) best = i;
    else if (cTrump === bTrump && suitOf(c) === suitOf(b) && rankOf(c) > rankOf(b)) best = i;
    else if (!cTrump && !bTrump && suitOf(c) === led && suitOf(b) !== led) best = i;
  }
  return best;
}
