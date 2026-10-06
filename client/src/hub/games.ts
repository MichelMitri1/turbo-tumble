/**
 * Every game on the site. Adding one: give it a folder with its own index.html
 * (e.g. client/my-game/index.html), list that page in vite.config.ts, then add
 * an entry here.
 */
export interface GameEntry {
  id: string;
  title: string;
  tagline: string;
  /** Page URL; omitted while the game is still in the works. */
  href?: string;
  /** Short chips shown on the card. */
  tags: string[];
  /** Card art: a big emoji over a two-colour gradient. */
  art: { emoji: string; from: string; to: string };
}

export const GAMES: GameEntry[] = [
  {
    id: 'turbo-tumble',
    title: 'Turbo Tumble',
    tagline: 'Kart racing with items, 24 tracks, Grand Prix cups and online races.',
    href: '/turbo-tumble/',
    tags: ['Racing', '1–4 local', 'Online'],
    art: { emoji: '🏎️', from: '#ff8c1a', to: '#ff4f9a' },
  },
  {
    id: 'crownfall-arena',
    title: 'Crownfall Arena',
    tagline: 'Real-time card combat. Build a deck, command the lanes and claim the crown.',
    href: '/arena-crown/',
    tags: ['Strategy', '1v1 vs AI', '123 cards'],
    art: { emoji: '♛', from: '#3fd8ff', to: '#2e2670' },
  },
  {
    id: 'coming-soon-2',
    title: 'Coming Soon',
    tagline: 'A new game is on the way.',
    tags: ['???'],
    art: { emoji: '🕹️', from: '#7be36b', to: '#2e2670' },
  },
];
