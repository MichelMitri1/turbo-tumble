export type Team = 'blue' | 'red';
export type CardType = 'troop' | 'building' | 'spell';
export type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Champion';
export type TargetKind = 'ground' | 'air' | 'all' | 'buildings';

export type Mechanic =
  | 'melee' | 'ranged' | 'splash' | 'flying' | 'swarm' | 'tank' | 'charge'
  | 'dash' | 'jump' | 'shield' | 'invisible' | 'stun' | 'slow' | 'rage'
  | 'heal' | 'spawn' | 'deathSpawn' | 'deathBomb' | 'chain' | 'beam'
  | 'buildingOnly' | 'siege' | 'spawner' | 'pull' | 'knockback' | 'dot'
  | 'freeze' | 'clone' | 'burrow' | 'transform' | 'reflect' | 'ability';

export interface CardDefinition {
  id: string;
  name: string;
  rarity: Rarity;
  type: CardType;
  cost: number;
  hp: number;
  damage: number;
  speed: number;
  range: number;
  hitSpeed: number;
  count: number;
  target: TargetKind;
  mechanics: Mechanic[];
  color: string;
  accent: string;
  description: string;
}

export interface Vec2 { x: number; y: number }

export interface Entity {
  id: number;
  cardId: string;
  name: string;
  team: Team;
  kind: 'unit' | 'building' | 'tower' | 'projectile' | 'effect';
  pos: Vec2;
  vel: Vec2;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  range: number;
  hitSpeed: number;
  attackTimer: number;
  radius: number;
  target: TargetKind;
  mechanics: Mechanic[];
  flying: boolean;
  lifetime: number;
  age: number;
  targetId?: number;
  shield?: number;
  frozen?: number;
  slowed?: number;
  raged?: number;
  invisible?: boolean;
  towerRole?: 'king' | 'left' | 'right';
  active?: boolean;
  color: string;
  accent: string;
}

export interface PlayerState {
  team: Team;
  name: string;
  elixir: number;
  deck: string[];
  cycle: string[];
  hand: string[];
  next: string;
  crowns: number;
}

export interface BattleSnapshot {
  time: number;
  duration: number;
  overtime: boolean;
  multiplier: number;
  phase: 'countdown' | 'battle' | 'ended';
  winner?: Team | 'draw';
  entities: readonly Entity[];
  blue: PlayerState;
  red: PlayerState;
}
