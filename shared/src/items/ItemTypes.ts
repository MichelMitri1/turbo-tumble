/**
 * Item catalogue. Every classic kart-racer item role is covered, with original names
 * and designs (gameplay roles are noted for reference only).
 */
export type ItemId =
  | 'fizz' //            single speed boost
  | 'fizz3' //           three speed boosts
  | 'fizzGold' //        unlimited boosts for a few seconds
  | 'puck' //            straight bouncing projectile
  | 'puck3' //           three orbiting bouncing projectiles
  | 'seeker' //          homing projectile (targets the racer ahead)
  | 'seeker3' //         three orbiting homing projectiles
  | 'crownBuster' //     flies to 1st place and explodes
  | 'goo' //             slippery trap
  | 'goo3' //            three trailing traps
  | 'boomBall' //        thrown bomb with blast radius
  | 'decoy' //           fake item box trap
  | 'paint' //           splats the screens of racers ahead
  | 'zap' //             shrinks & spins every opponent
  | 'prism' //           invincibility + speed
  | 'jetRocket' //       autopilot rocket that bowls through traffic
  | 'ember' //           fireball blaster for a few seconds
  | 'rang' //            boomerang, three throws
  | 'snapper' //         chomping plant that bites nearby racers & items
  | 'horn' //            shockwave: knocks back racers, destroys incoming items
  | 'octo' //            eight orbiting assorted items
  | 'coin' //            +2 coins
  | 'quake' //           ground-shaking block: spins racers ahead who aren't airborne
  | 'phantom' //         turn see-through (items pass) and steal an item from a racer ahead
  | 'giant' //           grow huge: flatten karts, shrug off most items
  | 'feather'; //        a very high hop over traps and shots

export type ItemCategory = 'boost' | 'projectile' | 'trap' | 'attack' | 'buff' | 'utility';

/** How the item is used from the slot. */
export type UseStyle =
  | 'instant' //  each press consumes one use immediately
  | 'hold' //     press to hold behind the kart (shield), release to throw/drop
  | 'deploy' //   first press deploys orbit/trail, further presses fire one each
  | 'timed'; //   first press starts a timer, presses during it trigger the effect

export interface ItemDefinition {
  id: ItemId;
  name: string;
  description: string;
  category: ItemCategory;
  use: UseStyle;
  uses: number;
  /** Duration (s) for timed items. */
  duration?: number;
  /** Primary + secondary colours used by models, icons and UI. */
  colors: [string, string];
}

export const ITEMS: Record<ItemId, ItemDefinition> = {
  fizz: { id: 'fizz', name: 'Turbo Fizz', description: 'Shake, pop, zoom! One big burst of speed.', category: 'boost', use: 'instant', uses: 1, colors: ['#ff3b5c', '#ffffff'] },
  fizz3: { id: 'fizz3', name: 'Fizz Six-Pack', description: 'Three Turbo Fizz bursts.', category: 'boost', use: 'instant', uses: 3, colors: ['#ff3b5c', '#ffd23f'] },
  fizzGold: { id: 'fizzGold', name: 'Golden Fizz', description: 'Unlimited bursts for a few seconds.', category: 'boost', use: 'timed', uses: 1, duration: 7.5, colors: ['#ffc21a', '#fff3b0'] },
  puck: { id: 'puck', name: 'Bumper Puck', description: 'Fires straight and ricochets off walls.', category: 'projectile', use: 'hold', uses: 1, colors: ['#2fd06a', '#e9fff0'] },
  puck3: { id: 'puck3', name: 'Puck Trio', description: 'Three pucks orbit you as a shield.', category: 'projectile', use: 'deploy', uses: 3, colors: ['#2fd06a', '#0f7a3a'] },
  seeker: { id: 'seeker', name: 'Seeker Drone', description: 'Locks on to the racer ahead.', category: 'projectile', use: 'hold', uses: 1, colors: ['#ff2f3f', '#ffe1e4'] },
  seeker3: { id: 'seeker3', name: 'Drone Squad', description: 'Three seeker drones orbit you.', category: 'projectile', use: 'deploy', uses: 3, colors: ['#ff2f3f', '#8a0f1a'] },
  crownBuster: { id: 'crownBuster', name: 'Crown Buster', description: 'Hunts down the leader and blows up.', category: 'attack', use: 'instant', uses: 1, colors: ['#2f6bff', '#bfe0ff'] },
  goo: { id: 'goo', name: 'Goo Blob', description: 'A slippery splat. Drop it behind you.', category: 'trap', use: 'hold', uses: 1, colors: ['#b6f03a', '#5e9c12'] },
  goo3: { id: 'goo3', name: 'Goo Chain', description: 'Three blobs trailing behind you.', category: 'trap', use: 'deploy', uses: 3, colors: ['#b6f03a', '#ffe14d'] },
  boomBall: { id: 'boomBall', name: 'Boom Ball', description: 'Lob it ahead — big blast radius.', category: 'attack', use: 'hold', uses: 1, colors: ['#2a2638', '#ff8c1a'] },
  decoy: { id: 'decoy', name: 'Decoy Box', description: 'Looks like a prize box. It is not.', category: 'trap', use: 'hold', uses: 1, colors: ['#ff6a3d', '#ffd0a6'] },
  paint: { id: 'paint', name: 'Paint Splat', description: 'Splatters the screens of everyone ahead.', category: 'attack', use: 'instant', uses: 1, colors: ['#9b4dff', '#ff4fd8'] },
  zap: { id: 'zap', name: 'Zap Storm', description: 'Shrinks and spins every rival.', category: 'attack', use: 'instant', uses: 1, colors: ['#ffe14d', '#3a2fb0'] },
  prism: { id: 'prism', name: 'Hyper Prism', description: 'Invincible and extra fast for a while.', category: 'buff', use: 'instant', uses: 1, colors: ['#ff4fd8', '#3fd8ff'] },
  jetRocket: { id: 'jetRocket', name: 'Jet Rocket', description: 'Turn into a rocket and autopilot ahead.', category: 'buff', use: 'instant', uses: 1, colors: ['#e8eef5', '#ff3b5c'] },
  ember: { id: 'ember', name: 'Ember Blaster', description: 'Hurl bouncing fireballs for a few seconds.', category: 'projectile', use: 'timed', uses: 1, duration: 5, colors: ['#ff6a1a', '#ffd23f'] },
  rang: { id: 'rang', name: 'Whirl-a-rang', description: 'Throw it out — it comes back. Three throws.', category: 'projectile', use: 'instant', uses: 3, colors: ['#3fd8ff', '#ffd23f'] },
  snapper: { id: 'snapper', name: 'Snapper Pot', description: 'A hungry plant that chomps anything close.', category: 'attack', use: 'timed', uses: 1, duration: 7, colors: ['#3fbf4a', '#ff4f6a'] },
  horn: { id: 'horn', name: 'Blast Horn', description: 'Shockwave! Knocks rivals and destroys items.', category: 'utility', use: 'instant', uses: 1, colors: ['#ffc21a', '#8a5a1a'] },
  octo: { id: 'octo', name: 'Octo Orbit', description: 'Eight assorted items circling you.', category: 'utility', use: 'deploy', uses: 8, colors: ['#ff8c1a', '#3fd8ff'] },
  coin: { id: 'coin', name: 'Spark Coins', description: 'Two coins — each one adds top speed.', category: 'boost', use: 'instant', uses: 1, colors: ['#ffd23f', '#ff9a1a'] },
  quake: { id: 'quake', name: 'Quake Block', description: 'Shakes the ground — rivals ahead spin out.', category: 'attack', use: 'instant', uses: 1, colors: ['#ff8c1a', '#5a2a8a'] },
  phantom: { id: 'phantom', name: 'Phantom Sheet', description: 'Go see-through for a moment and swipe an item from a racer ahead.', category: 'utility', use: 'instant', uses: 1, colors: ['#eeeaff', '#7a5cff'] },
  giant: { id: 'giant', name: 'Giant Gummy', description: 'Grow huge: flatten anyone you touch, shrug off most items.', category: 'buff', use: 'instant', uses: 1, colors: ['#ff4f8a', '#ffe14d'] },
  feather: { id: 'feather', name: 'Sky Feather', description: 'A huge hop — sail over traps and incoming shots.', category: 'utility', use: 'instant', uses: 1, colors: ['#ffffff', '#ffb52e'] },
};

export const ALL_ITEMS = Object.keys(ITEMS) as ItemId[];

/** Items Octo Orbit cycles through, in order. */
export const OCTO_SEQUENCE: readonly ItemId[] = ['fizz', 'puck', 'seeker', 'goo', 'boomBall', 'prism', 'paint', 'coin'];

/** What a deploy item spawns into its orbit/trail. */
export const DEPLOY_CHILD: Partial<Record<ItemId, ItemId>> = { puck3: 'puck', seeker3: 'seeker', goo3: 'goo' };
