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
    tagline: 'Real-time 3D card battles: 122 animated cards, two lanes, three crowns.',
    href: '/arena-crown/',
    tags: ['Strategy', 'vs AI', 'Online · LAN', '122 cards'],
    art: { emoji: '👑', from: '#3fd8ff', to: '#9b4dff' },
  },
  {
    id: 'kitten-kaboom',
    title: 'Kitten Kaboom',
    tagline: 'Draw cards, dodge kittens, survive Armageddon. The explosive party card game.',
    href: '/kitten-kaboom/',
    tags: ['Cards', 'vs Bots', 'Online · LAN', '2–5 players'],
    art: { emoji: '💣', from: '#ff8c1a', to: '#b0122c' },
  },
  {
    id: 'boostball',
    title: 'Boostball',
    tagline: 'Rocket-powered car soccer: boost, jump, flip, aerial. Real game physics at 120 Hz.',
    href: '/boostball/',
    tags: ['Sports', 'vs Bots', 'Online · LAN', 'PS4 pad'],
    art: { emoji: '🚀', from: '#3d86ff', to: '#ff8a1f' },
  },
  {
    id: 'last-card',
    title: 'Last Card',
    tagline: 'Match colours, dump your hand, shout LAST CARD! The classic colour-matching card game.',
    href: '/last-card/',
    tags: ['Cards', 'vs Bots', 'Online · LAN', '2–8 players'],
    art: { emoji: '🃏', from: '#e8262f', to: '#1f6fd6' },
  },
  {
    id: 'corner-pocket',
    title: 'Corner Pocket',
    tagline: '8-ball pool with real ball physics: spin, draw, follow, english. Pot your group, then the 8.',
    href: '/corner-pocket/',
    tags: ['Pool', 'vs Bot', 'Online · LAN', '1v1'],
    art: { emoji: '🎱', from: '#16854a', to: '#5a2a12' },
  },
  {
    id: 'zero-hour',
    title: 'Zero Hour',
    tagline: 'Fast multiplayer FPS: 18 guns, camos, killstreaks, TDM / Domination / FFA / Kill Confirmed on 3 maps.',
    href: '/zero-hour/',
    tags: ['FPS', 'vs Bots', 'Online · LAN', 'up to 12'],
    art: { emoji: '🎯', from: '#3a4a2a', to: '#c4f24a' },
  },
];
