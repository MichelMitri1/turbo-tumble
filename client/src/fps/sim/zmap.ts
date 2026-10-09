import type { ZPerk } from './zweapons';

/**
 * A zombies map's layout on top of its MapDef: zones that open as doors are bought, boarded
 * windows the undead tear through, the spawn closets behind them, wall weapons, perk
 * machines, the mystery box's possible spots, the power switch and the Pack-a-Punch.
 *
 * (nx, nz) is always the direction a player faces the thing from (into the room).
 */
export interface ZWindow {
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** Opening width. */
  w: number;
  sill: number;
  top: number;
  zone: number;
}
export interface ZSpawner {
  x: number;
  z: number;
  zone: number;
  /** Window this closet feeds (zombies walk up to it); −1 = rises out of the ground. */
  window: number;
}
export interface ZDoor {
  /** Blocking box [x0, z0, x1, z1] (height 3). */
  box: [number, number, number, number];
  cost: number;
  /** Zones that open when it's bought. */
  zones: number[];
  /** 'door' (wooden double doors) or 'debris' (a pile of junk). */
  look: 'door' | 'debris';
  /** Use point and facing for the prompt (either side works). */
  x: number;
  z: number;
}
export interface ZWallBuy {
  weapon: string;
  cost: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
}
export interface ZMachine {
  x: number;
  z: number;
  nx: number;
  nz: number;
}
export interface ZMapMeta {
  zones: string[];
  windows: ZWindow[];
  spawners: ZSpawner[];
  doors: ZDoor[];
  wallbuys: ZWallBuy[];
  perks: Array<ZMachine & { perk: ZPerk }>;
  boxSpots: ZMachine[];
  power: ZMachine;
  pap: ZMachine;
  /** Where players start (and come back at the start of a round after bleeding out). */
  start: Array<{ x: number; z: number; yaw: number }>;
}
