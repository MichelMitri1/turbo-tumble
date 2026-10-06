/**
 * Kitten Kaboom card definitions. Mechanics follow the "Good vs. Evil" edition of
 * the classic exploding-kitten card game (with Armageddon and the Angel / Demon
 * cats), plus a Classic deck. Names and art are original.
 */

export type CardType =
  | 'kitten' // explode unless you Defuse
  | 'defuse'
  | 'nope'
  | 'attack' // next player takes 2 turns
  | 'targeted' // any player takes 2 turns
  | 'skip' // (classic) end turn without drawing
  | 'favor' // a player gives you a card of their choice
  | 'shuffle'
  | 'future' // (classic) you see the top 3
  | 'reveal' // (good vs evil) everyone sees the top 3
  | 'heck' // Raising Heck: take the bottom card or put it on top; ends turn
  | 'armageddon' // Angel vs Demon showdown
  | 'godcat' // Angel Cat: play as any card except Nope
  | 'devilcat' // Demon Cat: explode (lives on the playmat)
  | 'feral' // wild cat card
  | 'cat'; // powerless cat card (pairs / triples)

export type CatKind = 'pizza' | 'robo' | 'cactus' | 'disco' | 'banana' | 'mustache' | 'sushi' | 'rainbow' | 'potato';
export type DeckId = 'gve' | 'classic';

export interface Card {
  id: number;
  type: CardType;
  cat?: CatKind;
}

export interface CardInfo {
  name: string;
  text: string;
  /** Hand-sorting order. */
  order: number;
  color: string;
}

export const CARD_INFO: Record<CardType, CardInfo> = {
  kitten: { name: 'Kaboom Kitten', text: 'Show this immediately. Unless you have a Defuse, you explode and you are out.', order: 0, color: '#2a1f3d' },
  defuse: { name: 'Defuse', text: 'Instead of exploding, secretly put the Kaboom Kitten back into the deck anywhere you like.', order: 1, color: '#43c26b' },
  nope: { name: 'Nope', text: 'Stop any action except a Kaboom Kitten or a Defuse. Play any time — even on another Nope.', order: 2, color: '#e8334a' },
  attack: { name: 'Attack 2×', text: 'End your turn without drawing. The next player takes two turns in a row.', order: 3, color: '#ff8c1a' },
  targeted: { name: 'Targeted Attack 2×', text: 'End your turn without drawing. Choose ANY player to take two turns in a row.', order: 4, color: '#ff5a1a' },
  skip: { name: 'Skip', text: 'End your turn without drawing a card.', order: 5, color: '#3f8cff' },
  favor: { name: 'Favor', text: 'One player must give you a card of their choice.', order: 6, color: '#ff6ad5' },
  shuffle: { name: 'Shuffle', text: 'Shuffle the draw pile.', order: 7, color: '#9b4dff' },
  future: { name: 'See the Future 3×', text: 'Privately look at the top three cards of the draw pile.', order: 8, color: '#5b3fd8' },
  reveal: { name: 'Reveal the Future 3×', text: 'Show EVERYONE the top three cards of the draw pile.', order: 8, color: '#5b3fd8' },
  heck: { name: 'Raising Heck', text: 'Take the bottom card. Keep it, or put it on top of the pile. Ends your turn.', order: 9, color: '#c2263a' },
  armageddon: { name: 'Armageddon', text: 'Angel vs Demon! Only while the Angel Cat is on the playmat. Ends your turn.', order: 10, color: '#1b1446' },
  godcat: { name: 'Angel Cat', text: 'Play as ANY card except a Nope — even a Defuse. Then it returns to the playmat.', order: 11, color: '#ffd23f' },
  devilcat: { name: 'Demon Cat', text: 'Whoever ends Armageddon with me explodes. Discard a Defuse or die.', order: 12, color: '#b0122c' },
  feral: { name: 'Feral Cat', text: 'Use as any cat card in a pair or a triple.', order: 13, color: '#ff4fd8' },
  cat: { name: 'Cat', text: 'Powerless alone. Play two of a kind to steal a random card, three to name the card you want.', order: 14, color: '#ffb84a' },
};

export const CAT_NAMES: Record<CatKind, string> = {
  pizza: 'Pizza Cat',
  robo: 'Robo Cat',
  cactus: 'Cactus Cat',
  disco: 'Disco Cat',
  banana: 'Banana Cat',
  mustache: 'Mustache Cat',
  sushi: 'Sushi Cat',
  rainbow: 'Rainbow Cat',
  potato: 'Potato Cat',
};

export function cardName(c: Pick<Card, 'type' | 'cat'>): string {
  return c.type === 'cat' && c.cat ? CAT_NAMES[c.cat] : CARD_INFO[c.type].name;
}

/** A card's "title" for pairs/triples (Feral Cat matches any cat card). */
export function title(c: Pick<Card, 'type' | 'cat'>): string {
  return c.type === 'cat' ? `cat:${c.cat}` : c.type;
}

export const DECKS: Record<DeckId, { name: string; blurb: string; counts: Partial<Record<CardType, number>>; cats: CatKind[]; catCount: number; anyPairs: boolean }> = {
  gve: {
    name: 'Heaven vs Heck',
    blurb: 'Armageddon, the Angel Cat and the Demon Cat. Any matching pair steals.',
    counts: { kitten: 4, defuse: 6, nope: 5, armageddon: 3, attack: 2, targeted: 2, favor: 4, feral: 4, heck: 2, reveal: 3, shuffle: 2 },
    cats: ['pizza', 'robo', 'cactus', 'disco'],
    catCount: 4,
    anyPairs: true,
  },
  classic: {
    name: 'Classic',
    blurb: 'The original: Skip, See the Future and five kinds of cat cards.',
    counts: { kitten: 4, defuse: 6, nope: 5, attack: 4, skip: 4, favor: 4, shuffle: 4, future: 5 },
    cats: ['banana', 'mustache', 'sushi', 'rainbow', 'potato'],
    catCount: 4,
    anyPairs: false,
  },
};

/** Card types the Angel Cat may be played as (on your turn). */
export const GODCAT_AS: CardType[] = ['attack', 'targeted', 'skip', 'favor', 'shuffle', 'future', 'reveal', 'heck'];
