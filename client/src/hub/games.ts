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
  /** Card art: a gameplay screenshot (16:9, in public/), or a big emoji over a two-colour gradient. */
  art: { image?: string; emoji: string; from: string; to: string };
}

export const GAMES: GameEntry[] = [
  {
    id: 'starfall',
    title: 'Starfall',
    tagline: 'First-person 3D social deduction aboard a spaceship. Complete tasks, find bodies, vote out the impostor — or be one.',
    href: '/starfall/',
    tags: ['First-person 3D', '7 bots', 'Crew / Impostor', 'Controller'],
    art: { emoji: '🧑‍🚀', from: '#132f4d', to: '#127f88' },
  },
  {
    id: 'cage-kings',
    title: 'Cage Kings',
    tagline: 'Full-contact MMA: strike, wrestle and submit with authentic damage, stamina and controller combat.',
    href: '/cage-kings/',
    tags: ['MMA', 'vs CPU', 'Local 1v1', 'Controller'],
    art: { emoji: '🥊', from: '#ef263c', to: '#12151c' },
  },
  {
    id: 'turbo-tumble',
    title: 'Turbo Tumble',
    tagline: 'Kart racing with items, 24 tracks, Grand Prix cups and online races.',
    href: '/turbo-tumble/',
    tags: ['Racing', '1–4 local', 'Online'],
    art: { image: '/assets/hub/turbo-tumble.webp', emoji: '🏎️', from: '#ff8c1a', to: '#ff4f9a' },
  },
  {
    id: 'crownfall-arena',
    title: 'Crownfall Arena',
    tagline: 'Real-time 3D card battles: 122 animated cards, two lanes, three crowns.',
    href: '/arena-crown/',
    tags: ['Strategy', 'vs AI', 'Online · LAN', '122 cards'],
    art: { image: '/assets/hub/crownfall-arena.webp', emoji: '👑', from: '#3fd8ff', to: '#9b4dff' },
  },
  {
    id: 'kitten-kaboom',
    title: 'Kitten Kaboom',
    tagline: 'Draw cards, dodge kittens, survive Armageddon. The explosive party card game.',
    href: '/kitten-kaboom/',
    tags: ['Cards', 'vs Bots', 'Online · LAN', '2–5 players'],
    art: { image: '/assets/hub/kitten-kaboom.webp', emoji: '💣', from: '#ff8c1a', to: '#b0122c' },
  },
  {
    id: 'boostball',
    title: 'Boostball',
    tagline: 'Rocket-powered car soccer: boost, jump, flip, aerial. Real game physics at 120 Hz.',
    href: '/boostball/',
    tags: ['Sports', 'vs Bots', 'Online · LAN', 'PS4 pad'],
    art: { image: '/assets/hub/boostball.webp', emoji: '🚀', from: '#3d86ff', to: '#ff8a1f' },
  },
  {
    id: 'last-card',
    title: 'Last Card',
    tagline: 'Match colours, dump your hand, shout LAST CARD! The classic colour-matching card game.',
    href: '/last-card/',
    tags: ['Cards', 'vs Bots', 'Online · LAN', '2–8 players'],
    art: { image: '/assets/hub/last-card.webp', emoji: '🃏', from: '#e8262f', to: '#1f6fd6' },
  },
  {
    id: 'arba3meyeh',
    title: '400 · أربعمية',
    tagline: 'The Lebanese partnership trick-taker: bid your tricks, hearts are trump, first team to 41 wins.',
    href: '/arba3meyeh/',
    tags: ['Cards', 'vs Bots', 'Online · LAN', '2 v 2'],
    art: { image: '/assets/hub/arba3meyeh.webp', emoji: '♥️', from: '#0b4f2c', to: '#a3172b' },
  },
  {
    id: 'corner-pocket',
    title: 'Corner Pocket',
    tagline: '8-ball pool with real ball physics: spin, draw, follow, english. Pot your group, then the 8.',
    href: '/corner-pocket/',
    tags: ['Pool', 'vs Bot', 'Online · LAN', '1v1'],
    art: { image: '/assets/hub/corner-pocket.webp', emoji: '🎱', from: '#16854a', to: '#5a2a12' },
  },
  {
    id: 'zero-hour',
    title: 'Zero Hour',
    tagline: 'Fast multiplayer FPS: 18 guns, classes, 9 killstreaks, 10 maps, 4-player splitscreen — plus round-based Zombies with the box, perks and Pack-a-Punch.',
    href: '/zero-hour/',
    tags: ['FPS', 'vs Bots', 'Zombies', 'Online · LAN', '9 v 9'],
    art: { image: '/assets/hub/zero-hour.webp', emoji: '🎯', from: '#3a4a2a', to: '#c4f24a' },
  },
  {
    id: 'jackaroo',
    title: 'Jackaroo',
    tagline: 'The Gulf marble race (جاكارو): play cards, hop marbles round a 3D wooden board, capture rivals, bring your team home.',
    href: '/jackaroo/',
    tags: ['Board', 'Teams 2v2', 'vs Bots', 'Online · LAN'],
    art: { image: '/assets/hub/jackaroo.webp', emoji: '🔵', from: '#8a4a1f', to: '#0d5c63' },
  },
  {
    id: 'matchday',
    title: 'Matchday 27',
    tagline: 'Eleven-a-side football: rated squads, FC-style passing and shooting, broadcast camera, crowd and commentary.',
    href: '/matchday/',
    tags: ['Football', 'vs CPU', 'Online · LAN', 'up to 4 v 4'],
    art: { image: '/assets/hub/matchday.webp', emoji: '⚽', from: '#0b6b2e', to: '#0a1f44' },
  },
];
