export type Team = 'blue' | 'red';
export type CardType = 'troop' | 'building' | 'spell';
export type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Champion';
/** What a unit may attack. */
export type Targets = 'ground' | 'air' | 'all' | 'buildings';
export type Speed = 'slow' | 'medium' | 'fast' | 'veryFast';

/** How a ranged attack travels (also picks its 3D look). */
export type ProjectileKind =
  | 'arrow' | 'bolt' | 'spear' | 'dart' | 'cannonball' | 'bomb' | 'boulder' | 'fireball' | 'iceball' | 'magic'
  | 'zap' | 'axe' | 'rocket' | 'flame' | 'shot' | 'firework' | 'hook' | 'heal';

/** Which animation family a model uses for its clips. */
export type AnimSet = 'char' | 'rpg' | 'monster' | 'flyer' | 'blob' | 'animal' | 'kenney' | 'static';

export interface ModelSpec {
  /** Model name in assets/arena/models (or `nature:<file>` from the shared nature kit). */
  model: string;
  /** Height in tiles. */
  height: number;
  /** Size by footprint width instead (flat buildings). */
  width?: number;
  tint?: { color?: string; hue?: number; sat?: number; light?: number; emissive?: string; emissiveIntensity?: number };
  /** Facing correction (radians) for models that don't face +Z. */
  yaw?: number;
  /** Extra props: in a hand, on the back, or a fixed offset. */
  props?: PropSpec[];
  /** Rider + mount: the rider sits on this model. */
  mount?: { model: string; height: number; tint?: ModelSpec['tint']; seat: number };
}

export interface PropSpec {
  model: string;
  height: number;
  at: 'hand' | 'back' | 'head' | 'offset';
  offset?: [number, number, number];
  rotation?: [number, number, number];
  tint?: ModelSpec['tint'];
}

export interface SpawnSpec {
  card: string;
  count: number;
  /** Seconds between spawns (spawners). */
  every?: number;
  /** Delay before the first spawn. */
  first?: number;
}

export interface Abilities {
  /** Splash radius (tiles) around the target. */
  splash?: number;
  /** Charge: after `charge` tiles of uninterrupted travel, double damage + speed. */
  charge?: number;
  /** Dash: jumps onto targets within this range (min, max). */
  dash?: [number, number];
  /** Jumps the river instead of using a bridge. */
  riverJump?: boolean;
  /** Extra hit points absorbed first. */
  shield?: number;
  /** Stun duration (s) applied on hit. */
  stun?: number;
  /** Slow (0..1) applied on hit for 2.5 s. */
  slow?: number;
  /** Hits chain to N further targets. */
  chain?: number;
  /** Damage ramps up the longer it holds a target (inferno). */
  ramp?: boolean;
  /** Knocks targets back (tiles). */
  knockback?: number;
  /** Projectile pierces through everything in a line of this length. */
  pierce?: number;
  /** Heals friendly troops around it (hp/s). */
  healAura?: number;
  /** Spawns troops periodically while alive. */
  spawn?: SpawnSpec;
  /** Spawns troops when it dies. */
  deathSpawn?: SpawnSpec;
  /** Explodes when it dies. */
  deathDamage?: { damage: number; radius: number };
  /** Freezes on death (Frost spirit / golem). */
  deathSlow?: boolean;
  /** Drops a rage puddle on death. */
  deathRage?: boolean;
  /** Goes invisible when not attacking. */
  invisible?: boolean;
  /** Kamikaze: deals damage once and dies. */
  kamikaze?: boolean;
  /** Spawned from the building at the start (Tesla hides underground). */
  hides?: boolean;
  /** Generates elixir every N seconds. */
  elixir?: number;
  /** Burrows: can be deployed anywhere and travels underground. */
  burrow?: boolean;
  /** Turns into this card when its shield breaks / it dies (Cannon Cart, Phoenix egg). */
  transform?: string;
  /** Damage bonus against buildings. */
  buildingBonus?: number;
  /** Champion active ability description (auto-cast by the engine). */
  ability?: 'dashChain' | 'cloak' | 'soulSummon' | 'explosiveEscape' | 'reflect' | 'royalRescue' | 'zapBurst' | 'getaway';
}

export interface SpellSpec {
  radius: number;
  damage: number;
  /** Damage against crown towers (fraction of `damage`). */
  towerDamage?: number;
  /** How it arrives. */
  travel: 'instant' | 'fromKing' | 'roll' | 'drop';
  /** Seconds the area lingers (damage is spread over it). */
  duration?: number;
  /** Repeated waves (Arrows). */
  waves?: number;
  freeze?: number;
  stun?: number;
  slow?: number;
  pull?: boolean;
  knockback?: number;
  rage?: number;
  heal?: number;
  /** Spawns troops on impact or over the duration. */
  spawn?: SpawnSpec;
  /** Only this many targets (Lightning, Vines). */
  maxTargets?: number;
  /** Building damage multiplier (Earthquake). */
  buildingBonus?: number;
  clone?: boolean;
  mirror?: boolean;
  /** Visual style. */
  fx: 'fireball' | 'arrows' | 'rocket' | 'zap' | 'log' | 'freeze' | 'poison' | 'lightning' | 'rage' | 'tornado' | 'quake' | 'graveyard' | 'barrel' | 'snowball' | 'crate' | 'clone' | 'mirror' | 'void' | 'vines' | 'curse';
  /** Rolling spells: length of the roll (tiles). */
  rollLength?: number;
}

export interface CardDefinition {
  id: string;
  name: string;
  rarity: Rarity;
  type: CardType;
  cost: number;
  /** One-line flavour/role shown on the card. */
  blurb: string;
  // ---- unit stats (per unit)
  hp: number;
  damage: number;
  /** Seconds between attacks. */
  hitSpeed: number;
  /** Wind-up before the first attack (s). */
  firstHit: number;
  speed: Speed | 'none';
  /** Attack range in tiles (0.8 = melee). */
  range: number;
  /** Dead zone: can't hit targets closer than this (Mortar). */
  minRange?: number;
  /** How far it notices enemies (tiles). */
  sight: number;
  count: number;
  targets: Targets;
  flying: boolean;
  /** Collision radius (tiles). */
  radius: number;
  /** Push weight. */
  mass: number;
  projectile?: ProjectileKind;
  /** Building lifetime (s). */
  lifetime?: number;
  deployTime: number;
  abilities: Abilities;
  spell?: SpellSpec;
  visual: ModelSpec;
  /** Mixed squads: extra units deployed alongside (Goblin Gang, Rascals…). */
  squad?: Array<{ card: string; count: number }>;
}

export interface Vec2 {
  x: number;
  y: number;
}
