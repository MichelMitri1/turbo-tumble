import { Grid, pointInPoly, type Rect } from './geom';

/**
 * The three maps, laid out after the originals:
 *  - VANGUARD  (the ship):       cafeteria hub, engines + reactor aft, weapons / navigation fore,
 *                                doors, security cameras, admin table, reactor + O2 + lights + comms.
 *  - STRATUS HQ (the sky base):  launchpad → locker room → decontamination → the long hallway,
 *                                labs, greenhouse, balcony; door-less, vents all linked.
 *  - FROSTFALL  (the ice planet): buildings around open snowfields, a dropship, specimen room,
 *                                seismic stabilizers, vitals.
 * Units are metres; y points down the screen.
 */

export type Floor = 'tile' | 'metal' | 'grate' | 'carpet' | 'hall' | 'wood' | 'lab' | 'snow' | 'rock' | 'green' | 'white' | 'dark';

export interface RoomDef {
  name: string;
  rect?: Rect;
  poly?: Array<[number, number]>;
  floor: Floor;
}
export type PropKind =
  | 'table' | 'roundtable' | 'button' | 'engine' | 'reactor' | 'console' | 'bed' | 'scanner' | 'crate' | 'shelf' | 'chair' | 'adminmap'
  | 'cams' | 'vitals' | 'locker' | 'rocket' | 'plant' | 'railing' | 'vending' | 'drill' | 'rockpile' | 'lava' | 'machine' | 'boxes' | 'pipes' | 'shield' | 'chute' | 'telescope' | 'dropship' | 'tree';
export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  /** Adds collision. */
  solid?: boolean;
  rot?: number;
}
export interface DoorDef {
  rect: Rect;
  room: string;
}
export interface VentDef {
  x: number;
  y: number;
  links: number[];
}

/** Task types (each is a minigame). */
export type TaskKind =
  | 'swipe' | 'wires' | 'download' | 'upload' | 'fuel' | 'garbage' | 'asteroids' | 'shields' | 'o2filter' | 'chart' | 'steering' | 'align'
  | 'calibrate' | 'divert' | 'accept' | 'sample' | 'scan' | 'reactor' | 'manifolds' | 'beverage' | 'water' | 'idcode' | 'weather' | 'artifact'
  | 'diagnostics' | 'process' | 'sort' | 'canister' | 'keys' | 'waterways' | 'temperature' | 'wifi' | 'drill' | 'jug' | 'boarding' | 'store'
  | 'telescope' | 'node' | 'tree';
export interface Spot {
  x: number;
  y: number;
}
export interface TaskDef {
  name: string;
  /** Common (everyone has it), short or long. */
  type: 'common' | 'short' | 'long';
  /** Steps done in order: each is a minigame at a spot (a step may pick one of several spots). */
  steps: Array<{ kind: TaskKind; at: Spot[]; label?: string }>;
  /** Visual task: others can see you do it (proves you're crew). */
  visual?: boolean;
}

export type SabotageKind = 'reactor' | 'o2' | 'lights' | 'comms' | 'seismic';
export interface MapDef {
  id: string;
  name: string;
  tagline: string;
  theme: 'space' | 'sky' | 'planet';
  bounds: Rect;
  rooms: RoomDef[];
  halls: Rect[];
  /** Outdoor walkable areas (snow etc.), drawn with the floor style. */
  outdoor?: Array<{ rect: Rect; floor: Floor }>;
  props: Prop[];
  doors: DoorDef[];
  vents: VentDef[];
  spawn: Spot;
  button: Spot;
  tasks: TaskDef[];
  sabotage: Partial<Record<SabotageKind, Spot[]>> & { lights: Spot[]; comms: Spot[] };
  /** Sabotage that makes you lose when the timer runs out (reactor / seismic) and its time. */
  critical: Partial<Record<'reactor' | 'o2' | 'seismic', number>>;
  admin?: Spot;
  security?: Spot;
  cams?: Array<Spot & { name: string }>;
  vitalsAt?: Spot;
}

const R = (x0: number, y0: number, x1: number, y1: number): Rect => [x0, y0, x1, y1];

// ============================================================================ VANGUARD

const VANGUARD: MapDef = {
  id: 'vanguard',
  name: 'Vanguard',
  tagline: 'The classic: a cruiser with a cafeteria hub, two engines, a reactor, doors and cameras.',
  theme: 'space',
  bounds: R(-50, -27, 48, 33),
  rooms: [
    { name: 'Cafeteria', poly: [[-5, -23], [5, -23], [9, -19], [9, -9], [5, -5], [-5, -5], [-9, -9], [-9, -19]], floor: 'tile' },
    { name: 'Upper Engine', rect: R(-34, -22, -23, -10), floor: 'metal' },
    { name: 'MedBay', rect: R(-20, -9, -11, -1), floor: 'white' },
    { name: 'Reactor', rect: R(-48, -10, -39, 6), floor: 'grate' },
    { name: 'Security', rect: R(-26, -6, -20, 2), floor: 'dark' },
    { name: 'Lower Engine', rect: R(-34, 12, -23, 24), floor: 'metal' },
    { name: 'Electrical', rect: R(-19, 4, -10, 12), floor: 'grate' },
    { name: 'Storage', rect: R(-6, 9, 8, 26), floor: 'metal' },
    { name: 'Admin', rect: R(5, -1, 15, 7), floor: 'carpet' },
    { name: 'O2', rect: R(10, -9, 17, -3), floor: 'green' },
    { name: 'Weapons', rect: R(14, -25, 26, -13), floor: 'metal' },
    { name: 'Navigation', poly: [[36, -12], [43, -12], [47, -6], [47, -2], [43, 4], [36, 4]], floor: 'tile' },
    { name: 'Shields', rect: R(27, 10, 40, 22), floor: 'metal' },
    { name: 'Communications', rect: R(13, 24, 23, 31), floor: 'dark' },
  ],
  halls: [
    R(-23, -17, -8.5, -13), // upper engine ↔ cafeteria
    R(-17, -13, -14, -9), // → medbay
    R(-31, -10, -27, 12), // the left corridor (engines)
    R(-39, -2, -31, 1), // → reactor
    R(-27, -3, -26, 0), // → security
    R(-23, 17, -6, 21), // lower engine ↔ storage
    R(-16, 12, -13, 17), // → electrical
    R(-2, -5.5, 2, 9), // cafeteria ↔ storage
    R(2, 1, 5, 4), // → admin
    R(8.5, -19, 14, -15), // cafeteria ↔ weapons
    R(19, -13, 23, -2), // weapons ↓
    R(23, -6, 36, -2), // → navigation
    R(17, -6, 19, -3), // → O2
    R(37, 4, 41, 10), // navigation ↔ shields
    R(8, 18, 27, 22), // storage ↔ shields
    R(16, 22, 20, 24), // → communications
  ],
  doors: [
    { rect: R(-9.75, -17, -9.25, -13), room: 'Cafeteria' },
    { rect: R(9.1, -19, 9.6, -15), room: 'Cafeteria' },
    { rect: R(-2, -5.6, 2, -5.1), room: 'Cafeteria' },
    { rect: R(-17, -9.5, -14, -9), room: 'MedBay' },
    { rect: R(-26.6, -3, -26.1, 0), room: 'Security' },
    { rect: R(-16, 12, -13, 12.5), room: 'Electrical' },
    { rect: R(-31, -10.5, -27, -10), room: 'Upper Engine' },
    { rect: R(-23, -17, -22.5, -13), room: 'Upper Engine' },
    { rect: R(-31, 11.5, -27, 12), room: 'Lower Engine' },
    { rect: R(-23, 17, -22.5, 21), room: 'Lower Engine' },
    { rect: R(-2, 8.5, 2, 9), room: 'Storage' },
    { rect: R(-6.5, 17, -6, 21), room: 'Storage' },
    { rect: R(8, 18, 8.5, 22), room: 'Storage' },
  ],
  props: [
    { kind: 'roundtable', x: 0, y: -14, r: 1.7, solid: true },
    { kind: 'button', x: 0, y: -14 },
    { kind: 'roundtable', x: -5, y: -18.5, r: 1.25, solid: true },
    { kind: 'roundtable', x: 5, y: -18.5, r: 1.25, solid: true },
    { kind: 'roundtable', x: -5, y: -9.5, r: 1.25, solid: true },
    { kind: 'roundtable', x: 5, y: -9.5, r: 1.25, solid: true },
    { kind: 'chute', x: 6.5, y: -21.6 },
    { kind: 'engine', x: -32, y: -16, w: 4, h: 7, solid: true },
    { kind: 'engine', x: -32, y: 18, w: 4, h: 7, solid: true },
    { kind: 'reactor', x: -45, y: -2, r: 2.4, solid: true },
    { kind: 'bed', x: -18.5, y: -7.5, w: 2, h: 1, solid: true },
    { kind: 'bed', x: -18.5, y: -5.2, w: 2, h: 1, solid: true },
    { kind: 'scanner', x: -14, y: -4.5 },
    { kind: 'cams', x: -23, y: -5.4, w: 3, h: 0.9, solid: true },
    { kind: 'machine', x: -11.2, y: 7.5, w: 1.2, h: 4, solid: true },
    { kind: 'crate', x: 3.5, y: 13, w: 2, h: 2, solid: true },
    { kind: 'crate', x: -3.5, y: 19, w: 2.2, h: 2.2, solid: true },
    { kind: 'boxes', x: 4.5, y: 22, w: 2.6, h: 2, solid: true },
    { kind: 'adminmap', x: 10, y: 3.5, w: 4, h: 2.4, solid: true },
    { kind: 'chair', x: 20, y: -20.5, w: 1.6, h: 1.6, solid: true },
    { kind: 'console', x: 44.5, y: -4, w: 1, h: 3, solid: true },
    { kind: 'shield', x: 33.5, y: 16, r: 1.6, solid: true },
    { kind: 'console', x: 18, y: 26, w: 4, h: 1, solid: true },
    { kind: 'plant', x: 13.5, y: -5.5, r: 0.8, solid: true },
    { kind: 'pipes', x: -45, y: 4.5, w: 4, h: 1 },
  ],
  vents: [
    { x: -41, y: -8, links: [1, 2] }, // 0 reactor
    { x: -25, y: -20, links: [0, 2] }, // 1 upper engine
    { x: -25, y: 22.5, links: [0, 1] }, // 2 lower engine
    { x: -12.5, y: -2.5, links: [4, 5] }, // 3 medbay
    { x: -21, y: -1, links: [3, 5] }, // 4 security
    { x: -17.5, y: 10.5, links: [3, 4] }, // 5 electrical
    { x: 6.5, y: -8, links: [7, 8] }, // 6 cafeteria
    { x: 13.5, y: 5.5, links: [6, 8] }, // 7 admin
    { x: 21, y: -10, links: [6, 7] }, // 8 corridor
    { x: 16, y: -23, links: [10] }, // 9 weapons
    { x: 38, y: -10.5, links: [9] }, // 10 navigation (top)
    { x: 38, y: 2.5, links: [12] }, // 11 navigation (bottom)
    { x: 29, y: 12, links: [11] }, // 12 shields
  ],
  spawn: { x: 0, y: -18 },
  button: { x: 0, y: -14 },
  tasks: [
    { name: 'Swipe Card', type: 'common', steps: [{ kind: 'swipe', at: [{ x: 13, y: 6.3 }] }] },
    { name: 'Fix Wiring', type: 'common', steps: [0, 1, 2].map(() => ({ kind: 'wires' as TaskKind, at: [{ x: -3, y: -22.4 }, { x: -18.4, y: 8 }, { x: -5.4, y: 11 }, { x: 6, y: -0.4 }, { x: 38.5, y: -11.4 }, { x: -25.4, y: 1.4 }] })) },
    { name: 'Upload Data', type: 'long', steps: [{ kind: 'download', at: [{ x: -6.8, y: -21 }, { x: 25.4, y: -14 }, { x: 41, y: -11.4 }, { x: 22.4, y: 30.4 }, { x: -10.6, y: 11.4 }], label: 'Download Data' }, { kind: 'upload', at: [{ x: 8.6, y: -0.4 }] }] },
    { name: 'Fuel Engines', type: 'long', steps: [{ kind: 'fuel', at: [{ x: -4.5, y: 25.4 }], label: 'Fill Gas Can' }, { kind: 'fuel', at: [{ x: -28.6, y: -11 }], label: 'Fuel Upper Engine' }, { kind: 'fuel', at: [{ x: -4.5, y: 25.4 }], label: 'Fill Gas Can' }, { kind: 'fuel', at: [{ x: -28.6, y: 23.4 }], label: 'Fuel Lower Engine' }] },
    { name: 'Empty Garbage', type: 'long', steps: [{ kind: 'garbage', at: [{ x: 6.5, y: -21 }, { x: 16.4, y: -8.4 }] }, { kind: 'garbage', at: [{ x: 7.4, y: 25.4 }], label: 'Empty Chute' }] },
    { name: 'Clear Asteroids', type: 'long', steps: [{ kind: 'asteroids', at: [{ x: 20, y: -18.8 }] }] },
    { name: 'Prime Shields', type: 'short', steps: [{ kind: 'shields', at: [{ x: 31, y: 10.6 }] }] },
    { name: 'Clean O2 Filter', type: 'short', steps: [{ kind: 'o2filter', at: [{ x: 11, y: -8.4 }] }] },
    { name: 'Chart Course', type: 'short', steps: [{ kind: 'chart', at: [{ x: 43.4, y: -1.2 }] }] },
    { name: 'Stabilize Steering', type: 'short', steps: [{ kind: 'steering', at: [{ x: 43.4, y: -6.8 }] }] },
    { name: 'Align Engine Output', type: 'long', steps: [{ kind: 'align', at: [{ x: -26.2, y: -21.4 }] }, { kind: 'align', at: [{ x: -26.2, y: 23.4 }] }] },
    { name: 'Calibrate Distributor', type: 'short', steps: [{ kind: 'calibrate', at: [{ x: -13, y: 4.6 }] }] },
    { name: 'Divert Power', type: 'short', steps: [{ kind: 'divert', at: [{ x: -16.5, y: 4.6 }] }, { kind: 'accept', at: [{ x: -24.4, y: -21.4 }, { x: -24.4, y: 23.4 }, { x: -40.4, y: 5.4 }, { x: 15.4, y: -24.4 }, { x: 39.4, y: 20.6 }, { x: 13.6, y: 30.4 }, { x: 37.4, y: 3.4 }, { x: 16.4, y: -4 }, { x: -21.4, y: 1.4 }] }] },
    { name: 'Inspect Sample', type: 'long', steps: [{ kind: 'sample', at: [{ x: -11.6, y: -6.6 }] }] },
    { name: 'Submit Scan', type: 'long', visual: true, steps: [{ kind: 'scan', at: [{ x: -14, y: -4.5 }] }] },
    { name: 'Start Reactor', type: 'long', steps: [{ kind: 'reactor', at: [{ x: -40.4, y: -6 }] }] },
    { name: 'Unlock Manifolds', type: 'short', steps: [{ kind: 'manifolds', at: [{ x: -44, y: -9.4 }] }] },
  ],
  sabotage: {
    reactor: [{ x: -47.4, y: -8.6 }, { x: -47.4, y: 4.6 }],
    o2: [{ x: 16.4, y: -6 }, { x: 14.4, y: -0.4 }],
    lights: [{ x: -15, y: 11.4 }],
    comms: [{ x: 18, y: 25.4 }],
  },
  critical: { reactor: 30, o2: 30 },
  admin: { x: 10, y: 5.6 },
  security: { x: -23, y: -4.6 },
  cams: [
    { x: 29, y: -4, name: 'Navigation' },
    { x: 0, y: 3, name: 'Admin' },
    { x: -29, y: -5, name: 'Security' },
    { x: -19, y: -15, name: 'MedBay' },
  ],
};

// ============================================================================ STRATUS HQ

const STRATUS: MapDef = {
  id: 'stratus',
  name: 'Stratus HQ',
  tagline: 'A research HQ above the clouds: the long hallway, labs, a greenhouse — no doors, all vents linked.',
  theme: 'sky',
  bounds: R(-42, -33, 45, 44),
  rooms: [
    { name: 'Launchpad', rect: R(-40, 1, -28, 17), floor: 'metal' },
    { name: 'Locker Room', rect: R(-22, 2, -12, 16), floor: 'tile' },
    { name: 'Decontamination', rect: R(-8, 6, -2, 14), floor: 'white' },
    { name: 'MedBay', rect: R(-8, 16, 0, 24), floor: 'white' },
    { name: 'Communications', rect: R(8, 14, 16, 22), floor: 'dark' },
    { name: 'Laboratory', rect: R(-15, -9, -4, 2), floor: 'lab' },
    { name: 'Reactor', rect: R(-13, -31, 0, -18), floor: 'grate' },
    { name: 'Office', rect: R(10, -8, 20, 2), floor: 'carpet' },
    { name: 'Admin', rect: R(10, -27, 20, -17), floor: 'carpet' },
    { name: 'Greenhouse', rect: R(24, -31, 39, -17), floor: 'green' },
    { name: 'Cafeteria', rect: R(28, 9, 43, 24), floor: 'tile' },
    { name: 'Storage', rect: R(12, 32, 20, 40), floor: 'metal' },
    { name: 'Balcony', rect: R(23, 32, 43, 42), floor: 'grate' },
  ],
  halls: [
    R(-28, 8, -22, 12), // launchpad ↔ locker
    R(-12, 8.5, -8, 11.5), // locker ↔ decon
    R(-2, 8.5, 2.5, 11.5), // decon ↔ hallway
    R(2, -14, 6, 30), // the long hallway (spine)
    R(-8, -14, 31, -10), // upper hallway
    R(-8, -18, -4, -14), // → reactor
    R(-4, -4, 2, -1), // → laboratory
    R(6, -4, 10, -1), // → office
    R(13, -17, 17, -14), // → admin
    R(27, -17, 31, -14), // → greenhouse
    R(0, 19, 2, 22), // → medbay
    R(6, 17, 8, 20), // → comms
    R(2, 26, 41, 30), // lower hallway
    R(33, 24, 37, 26), // → cafeteria
    R(14, 30, 18, 32), // → storage
    R(29, 30, 33, 32), // → balcony
  ],
  doors: [],
  props: [
    { kind: 'rocket', x: -34, y: 9, r: 2.6, solid: true },
    { kind: 'locker', x: -17, y: 3, w: 8, h: 1, solid: true },
    { kind: 'locker', x: -17, y: 15, w: 8, h: 1, solid: true },
    { kind: 'bed', x: -6, y: 18.5, w: 2.2, h: 1, solid: true },
    { kind: 'scanner', x: -2.5, y: 21.5 },
    { kind: 'console', x: 12, y: 18, w: 3, h: 1, solid: true },
    { kind: 'table', x: -9.5, y: -3.5, w: 4, h: 2, solid: true },
    { kind: 'reactor', x: -6.5, y: -26, r: 2.6, solid: true },
    { kind: 'table', x: 15, y: -3, w: 4, h: 2, solid: true },
    { kind: 'adminmap', x: 15, y: -22, w: 4, h: 2.4, solid: true },
    { kind: 'plant', x: 27, y: -28, r: 1, solid: true },
    { kind: 'plant', x: 31, y: -21, r: 1, solid: true },
    { kind: 'plant', x: 35.5, y: -27, r: 1, solid: true },
    { kind: 'plant', x: 36, y: -20, r: 1, solid: true },
    { kind: 'roundtable', x: 33, y: 14, r: 1.3, solid: true },
    { kind: 'roundtable', x: 39, y: 18.5, r: 1.3, solid: true },
    { kind: 'vending', x: 42, y: 13, w: 1, h: 2.4, solid: true },
    { kind: 'boxes', x: 16, y: 37, w: 3, h: 2, solid: true },
    { kind: 'railing', x: 33, y: 41.6, w: 20, h: 0.4 },
    { kind: 'telescope', x: 39, y: 37, r: 0.8, solid: true },
  ],
  vents: [
    { x: -30, y: 15, links: [1, 9] }, // 0 launchpad
    { x: -2.5, y: 7.5, links: [0, 2] }, // 1 decon
    { x: -13.5, y: -7.5, links: [1, 3] }, // 2 lab
    { x: -1.5, y: -29.5, links: [2, 4] }, // 3 reactor
    { x: 18.5, y: -25.5, links: [3, 5] }, // 4 admin
    { x: 37.5, y: -18.5, links: [4, 6] }, // 5 greenhouse
    { x: 18.5, y: 0.5, links: [5, 7] }, // 6 office
    { x: 41.5, y: 22.5, links: [6, 8] }, // 7 cafeteria
    { x: 24.5, y: 40.5, links: [7, 9] }, // 8 balcony
    { x: -6.5, y: 22.5, links: [8, 0] }, // 9 medbay
  ],
  spawn: { x: -34, y: 14 },
  button: { x: 36, y: 16.5 },
  tasks: [
    { name: 'Enter ID Code', type: 'common', steps: [{ kind: 'idcode', at: [{ x: 11, y: -26.4 }] }] },
    { name: 'Fix Wiring', type: 'common', steps: [0, 1, 2].map(() => ({ kind: 'wires' as TaskKind, at: [{ x: -14.4, y: 6 }, { x: -12.4, y: -8.4 }, { x: 9, y: 21.4 }, { x: 19.4, y: -7.4 }, { x: 25, y: -30.4 }, { x: 13, y: 39.4 }] })) },
    { name: 'Buy Beverage', type: 'short', steps: [{ kind: 'beverage', at: [{ x: 41.2, y: 13 }] }] },
    { name: 'Water Plants', type: 'long', steps: [{ kind: 'water', at: [{ x: 19.4, y: 33 }], label: 'Get Watering Can' }, { kind: 'water', at: [{ x: 31.5, y: -24 }] }] },
    { name: 'Measure Weather', type: 'short', steps: [{ kind: 'weather', at: [{ x: 41.5, y: 34 }] }] },
    { name: 'Assemble Artifact', type: 'short', steps: [{ kind: 'artifact', at: [{ x: -4.6, y: -6 }] }] },
    { name: 'Sort Samples', type: 'short', steps: [{ kind: 'sort', at: [{ x: -9.5, y: -1.6 }] }] },
    { name: 'Run Diagnostics', type: 'long', steps: [{ kind: 'diagnostics', at: [{ x: -38, y: 2.6 }] }] },
    { name: 'Process Data', type: 'short', steps: [{ kind: 'process', at: [{ x: 15, y: -1.4 }] }] },
    { name: 'Clear Asteroids', type: 'long', steps: [{ kind: 'asteroids', at: [{ x: 26, y: 40.8 }] }] },
    { name: 'Clean O2 Filter', type: 'short', steps: [{ kind: 'o2filter', at: [{ x: 24.6, y: -24 }] }] },
    { name: 'Fuel Engines', type: 'long', steps: [{ kind: 'fuel', at: [{ x: -38.6, y: 11 }] }] },
    { name: 'Prime Shields', type: 'short', steps: [{ kind: 'shields', at: [{ x: 19.4, y: -20 }] }] },
    { name: 'Start Reactor', type: 'long', steps: [{ kind: 'reactor', at: [{ x: -12.4, y: -21 }] }] },
    { name: 'Submit Scan', type: 'long', visual: true, steps: [{ kind: 'scan', at: [{ x: -2.5, y: 21.5 }] }] },
    { name: 'Empty Garbage', type: 'short', steps: [{ kind: 'garbage', at: [{ x: 29, y: 23.4 }] }] },
    { name: 'Divert Power', type: 'short', steps: [{ kind: 'divert', at: [{ x: -0.6, y: -24 }] }, { kind: 'accept', at: [{ x: -21.4, y: 9 }, { x: -5, y: -8.4 }, { x: 37, y: -30.4 }, { x: 19.4, y: 3 - 1.4 }, { x: 22.4, y: 32.6 }] }] },
  ],
  sabotage: {
    reactor: [{ x: -12.4, y: -30.4 }, { x: -0.6, y: -30.4 }],
    o2: [{ x: 38.4, y: -29 }, { x: 10.6, y: 1.4 }],
    lights: [{ x: 19.4, y: -5 }],
    comms: [{ x: 15.4, y: 16 }, { x: 10.6, y: -6 }],
  },
  critical: { reactor: 45, o2: 30 },
  admin: { x: 15, y: -19.6 },
};

// ============================================================================ FROSTFALL

const FROSTFALL: MapDef = {
  id: 'frostfall',
  name: 'Frostfall',
  tagline: 'An outpost on an ice planet: snowfields between buildings, a dropship, seismic stabilizers.',
  theme: 'planet',
  bounds: R(-41, -38, 57, 32),
  rooms: [
    { name: 'Dropship', rect: R(-38, -27, -26, -17), floor: 'metal' },
    { name: 'Security', rect: R(-20, -15, -12, -8), floor: 'dark' },
    { name: 'Communications', rect: R(-8, -32, 2, -25), floor: 'dark' },
    { name: 'Weapons', rect: R(8, -32, 18, -25), floor: 'metal' },
    { name: 'Laboratory', rect: R(24, -36, 43, -25), floor: 'lab' },
    { name: 'Office', rect: R(10, -14, 22, -4), floor: 'carpet' },
    { name: 'Admin', rect: R(26, -14, 37, -4), floor: 'carpet' },
    { name: 'Specimen Room', rect: R(44, -16, 55, 2), floor: 'white' },
    { name: 'Electrical', rect: R(-26, -6, -16, 4), floor: 'grate' },
    { name: 'O2', rect: R(-38, 6, -26, 16), floor: 'green' },
    { name: 'Storage', rect: R(-4, 13, 8, 22), floor: 'metal' },
    { name: 'Boiler Room', rect: R(-22, 20, -10, 29), floor: 'grate' },
  ],
  outdoor: [
    { rect: R(-26, -24, 39, -19.5), floor: 'snow' }, // north road
    { rect: R(-33, -17, -29, 6), floor: 'snow' }, // west road (dropship → O2)
    { rect: R(-12, -6, 9, 10), floor: 'snow' }, // the central snowfield
    { rect: R(-3, -19.5, 1, -6), floor: 'snow' }, // north road ↔ snowfield
    { rect: R(38.5, -19.5, 42.5, 8), floor: 'snow' }, // east road
    { rect: R(9, 4, 42.5, 8), floor: 'snow' }, // south road (snowfield ↔ east road)
    { rect: R(-26, 10, -12, 14), floor: 'snow' }, // O2 ↔ snowfield (south-west)
    { rect: R(-16, 14, -12, 20), floor: 'snow' }, // → boiler room
    { rect: R(-12, 10, -8, 14), floor: 'snow' },
  ],
  halls: [
    R(-26, -23, -24, -19.5), // dropship door
    R(-17, -19.5, -14, -15), // → security
    R(-4.5, -25, -1.5, -24), // → comms
    R(11.5, -25, 14.5, -24), // → weapons
    R(31, -25, 34, -24), // → laboratory
    R(14, -19.5, 17, -14), // → office
    R(29, -19.5, 32, -14), // → admin
    R(42.5, -6, 44, -3), // → specimen
    R(-16, -1, -12, 2), // electrical ↔ snowfield
    R(-29, 8, -26, 11), // west road → O2 door … the O2 room's east side
    R(0, 10, 3, 13), // snowfield → storage
    R(-29, 6, -26, 8),
  ],
  doors: [
    { rect: R(-17, -15.5, -14, -15), room: 'Security' },
    { rect: R(-4.5, -25.2, -1.5, -24.8), room: 'Communications' },
    { rect: R(11.5, -25.2, 14.5, -24.8), room: 'Weapons' },
    { rect: R(14, -14.5, 17, -14), room: 'Office' },
    { rect: R(-16.5, -1, -16, 2), room: 'Electrical' },
    { rect: R(0, 12.5, 3, 13), room: 'Storage' },
    { rect: R(-14, 19.5, -12, 20), room: 'Boiler Room' },
  ],
  props: [
    { kind: 'dropship', x: -32, y: -22, w: 7, h: 6, solid: true },
    { kind: 'cams', x: -16, y: -8.6, w: 3, h: 0.9, solid: true },
    { kind: 'console', x: -3, y: -31.4, w: 4, h: 1, solid: true },
    { kind: 'chair', x: 13, y: -29, w: 1.6, h: 1.6, solid: true },
    { kind: 'drill', x: 29, y: -31, r: 1.8, solid: true },
    { kind: 'telescope', x: 39.5, y: -33, r: 0.9, solid: true },
    { kind: 'table', x: 34, y: -28, w: 4, h: 1.6, solid: true },
    { kind: 'table', x: 16, y: -9, w: 4, h: 2, solid: true },
    { kind: 'adminmap', x: 31.5, y: -9, w: 4, h: 2.4, solid: true },
    { kind: 'shelf', x: 49.5, y: -15, w: 8, h: 1, solid: true },
    { kind: 'machine', x: -21, y: -5.2, w: 4, h: 1.2, solid: true },
    { kind: 'tree', x: -32, y: 11, r: 1.4, solid: true },
    { kind: 'boxes', x: 4, y: 18, w: 3, h: 2.4, solid: true },
    { kind: 'pipes', x: -16, y: 27, w: 8, h: 1.2, solid: true },
    { kind: 'rockpile', x: 3, y: -1, r: 1.6, solid: true },
    { kind: 'rockpile', x: -8, y: 6, r: 1.2, solid: true },
    { kind: 'lava', x: 22, y: 6, r: 1.1 },
    { kind: 'vitals', x: 52, y: 1.2, w: 2.4, h: 0.8, solid: true },
  ],
  vents: [
    { x: -36.5, y: 14.5, links: [1, 2] }, // 0 O2
    { x: -24.5, y: 2.5, links: [0, 2] }, // 1 electrical
    { x: -13.5, y: -9, links: [0, 1] }, // 2 security
    { x: 16.5, y: -26.5, links: [4] }, // 3 weapons
    { x: 2, y: -26.5, links: [3] }, // 4 comms
    { x: 25.5, y: -26.5, links: [6, 7] }, // 5 laboratory
    { x: 35.5, y: -5.5, links: [5, 7] }, // 6 admin
    { x: 53.5, y: -14.5, links: [5, 6] }, // 7 specimen
    { x: 6.5, y: 20.5, links: [9] }, // 8 storage
    { x: -11, y: 27.5, links: [8] }, // 9 boiler
  ],
  spawn: { x: -30, y: -18 },
  button: { x: 16, y: -9 },
  tasks: [
    { name: 'Insert Keys', type: 'common', steps: [{ kind: 'keys', at: [{ x: -27, y: -20 }] }] },
    { name: 'Scan Boarding Pass', type: 'common', steps: [{ kind: 'boarding', at: [{ x: 11, y: -5 }] }] },
    { name: 'Fix Wiring', type: 'common', steps: [0, 1, 2].map(() => ({ kind: 'wires' as TaskKind, at: [{ x: -25.4, y: -2 }, { x: 42.4, y: -26 }, { x: 21.4, y: -12 }, { x: -7.4, y: -26 }, { x: -3.4, y: 21.4 }, { x: -19.4, y: -14.4 }] })) },
    { name: 'Fill Canisters', type: 'long', steps: [{ kind: 'canister', at: [{ x: -37.4, y: 10 }] }] },
    { name: 'Monitor Tree', type: 'short', steps: [{ kind: 'tree', at: [{ x: -29, y: 13.6 }] }] },
    { name: 'Open Waterways', type: 'long', steps: [{ kind: 'waterways', at: [{ x: -21.4, y: 24 }] }, { kind: 'waterways', at: [{ x: -10.6, y: 22 }] }, { kind: 'waterways', at: [{ x: -20, y: 20.6 }] }] },
    { name: 'Replace Water Jug', type: 'long', steps: [{ kind: 'jug', at: [{ x: -12, y: 28.4 }], label: 'Fill Water Jug' }, { kind: 'jug', at: [{ x: 21.4, y: -6 }], label: 'Replace Water Jug' }] },
    { name: 'Record Temperature', type: 'short', steps: [{ kind: 'temperature', at: [{ x: 26, y: -25.6 }, { x: 8.4, y: 9.4 }] }] },
    { name: 'Reboot Wifi', type: 'long', steps: [{ kind: 'wifi', at: [{ x: -7.4, y: -31.4 }] }] },
    { name: 'Repair Drill', type: 'short', steps: [{ kind: 'drill', at: [{ x: 29, y: -28.6 }] }] },
    { name: 'Align Telescope', type: 'short', steps: [{ kind: 'telescope', at: [{ x: 38, y: -32 }] }] },
    { name: 'Store Artifacts', type: 'short', steps: [{ kind: 'store', at: [{ x: 49.5, y: -13.8 }] }] },
    { name: 'Clear Asteroids', type: 'short', steps: [{ kind: 'asteroids', at: [{ x: 13, y: -27.4 }] }] },
    { name: 'Download Data', type: 'short', steps: [{ kind: 'download', at: [{ x: 9, y: -31.4 }, { x: 0, y: -26 }, { x: 42.4, y: -31 }, { x: -25.4, y: 2 }] }, { kind: 'upload', at: [{ x: 26.6, y: -13.4 }] }] },
    { name: 'Inspect Sample', type: 'long', steps: [{ kind: 'sample', at: [{ x: 24.6, y: -31 }] }] },
    { name: 'Fix Weather Node', type: 'long', steps: [{ kind: 'node', at: [{ x: -25.4, y: -21 }, { x: 8.4, y: -4 }, { x: 37.6, y: -20 }, { x: 41.8, y: 6.6 }] }] },
    { name: 'Unlock Manifolds', type: 'short', steps: [{ kind: 'manifolds', at: [{ x: 54.4, y: -4 }] }] },
    { name: 'Empty Garbage', type: 'short', steps: [{ kind: 'garbage', at: [{ x: -26.6, y: 15.4 }] }] },
  ],
  sabotage: {
    seismic: [{ x: 24.6, y: -27 }, { x: 54.4, y: -10 }],
    lights: [{ x: -25.4, y: -5.4 }],
    comms: [{ x: 1.4, y: -28 }],
  },
  critical: { seismic: 60 },
  admin: { x: 31.5, y: -6.6 },
  security: { x: -16, y: -9.6 },
  cams: [
    { x: -31, y: -1, name: 'West Road' },
    { x: 0, y: -21, name: 'North Road' },
    { x: 40.5, y: -8, name: 'East Road' },
    { x: -2, y: 2, name: 'Snowfield' },
    { x: -12, y: 12, name: 'South-West' },
  ],
  vitalsAt: { x: 52, y: 0.2 },
};

export const MAPS: MapDef[] = [VANGUARD, STRATUS, FROSTFALL];
export const MAP = Object.fromEntries(MAPS.map((m) => [m.id, m])) as Record<string, MapDef>;

// ---------------------------------------------------------------- building a map's grid

export interface BuiltMap {
  def: MapDef;
  grid: Grid;
  /** Room containing a point ('' in halls / outdoors). */
  roomAt(x: number, y: number): string;
}

export function buildMap(def: MapDef): BuiltMap {
  const g = new Grid(def.bounds);
  for (const r of def.rooms) {
    if (r.rect) g.addFloor(r.rect);
    if (r.poly) g.addPolyFloor(r.poly);
  }
  for (const h of def.halls) g.addFloor(h);
  for (const o of def.outdoor ?? []) g.addFloor(o.rect);
  for (const p of def.props) {
    if (!p.solid) continue;
    if (p.r) g.addFurniture({ x: p.x, y: p.y, r: p.r });
    else if (p.w && p.h) g.addFurniture([p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2]);
  }
  const roomAt = (x: number, y: number) => {
    for (const r of def.rooms) {
      if (r.rect && x >= r.rect[0] && x <= r.rect[2] && y >= r.rect[1] && y <= r.rect[3]) return r.name;
      if (r.poly && pointInPoly(x, y, r.poly)) return r.name;
    }
    return '';
  };
  return { def, grid: g, roomAt };
}
