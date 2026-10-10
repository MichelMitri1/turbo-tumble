/**
 * The shape of Velora City (≈ 2 × 2 km): districts, the river, the coast, the hills, and
 * every road as a curve before the network is built from them.
 *
 * x → east, z → south, metres. The ocean is to the south.
 */

export const SIZE = 2000;
export const HALF = SIZE / 2;
export const RIVER_W = 72;
export const WATER_Y = -1.6;
export const HIGHWAY_Y = 10;

export type RoadType = 'street' | 'avenue' | 'highway' | 'rural' | 'ramp';
export interface RoadSpec {
  /** Lanes each way, lane width, median width. */
  lanes: number;
  median: number;
  sidewalk: boolean;
  /** Parking lane along each curb. */
  parking: boolean;
  /** Cruise speed for traffic (m/s). */
  speed: number;
  /** Total width (curb to curb). */
  width: number;
}
const LANE = 3.5;
export const PARK_W = 2.4;
const spec = (lanes: number, median: number, sidewalk: boolean, speed: number, parking = false): RoadSpec => ({ lanes, median, sidewalk, speed, parking, width: lanes * 2 * LANE + median + 1 + (parking ? PARK_W * 2 : 0) });
export const SPECS: Record<RoadType, RoadSpec> = {
  street: spec(1, 0.3, true, 12, true),
  avenue: spec(2, 0.4, true, 14),
  highway: spec(3, 1.2, false, 27),
  rural: spec(1, 0.3, false, 17),
  ramp: spec(1, 0.4, false, 18),
};
export const LANE_W = LANE;

export interface RoadDef {
  name: string;
  type: RoadType;
  /** Control points (x, z); smoothed with Catmull-Rom unless `sharp`. */
  pts: Array<[number, number]>;
  sharp?: boolean;
  /** Height along the road (0…1 → metres) for elevated roads; ground roads follow the land. */
  height?: (f: number, x: number, z: number) => number;
}

// ---------------------------------------------------------------- water / land

export const RIVER: Array<[number, number]> = [
  [-640, -1060], [-600, -760], [-520, -520], [-470, -300], [-440, -80], [-380, 140], [-250, 300], [-60, 380], [160, 420], [380, 470], [540, 560], [640, 700], [700, 860],
];
export function coastZ(x: number): number {
  return 790 + 16 * Math.sin(x * 0.009) + 8 * Math.sin(x * 0.023 + 1);
}

export type District = 'downtown' | 'midtown' | 'port' | 'hills' | 'west' | 'beach' | 'park';
export const DISTRICT_NAMES: Record<District, string> = {
  downtown: 'Downtown Velora',
  midtown: 'Midtown',
  port: 'Port Velora',
  hills: 'Vista Hills',
  west: 'Palm Heights',
  beach: 'Del Mar Beach',
  park: 'Grove Park',
};
export function districtAt(x: number, z: number, riverSide: number): District {
  if (x > -120 && x < 40 && z > -260 && z < -120) return 'park';
  if (z > coastZ(x) - 300 && riverSide > 0 && z > 300) return 'beach';
  if (x < -480 && riverSide < 0) return 'west';
  if (z < -640 && x < 420) return 'hills';
  if (z < -500 && x >= 420) return 'port';
  if (x >= -290 && x <= 370 && z >= -430 && z <= 230) return 'downtown';
  return 'midtown';
}

// ---------------------------------------------------------------- roads

const NS = ['Vinewood Ave', 'Alta St', 'Elgin Ave', 'Vespucci Blvd', 'Palomino Ave', 'Rockford Dr', 'Strawberry Ave', 'Mirror Park Blvd', 'Grove St', 'Marathon Ave', 'Tongva Dr', 'Carson Ave'];
const EW = ['Hawick Ave', 'Sinner St', 'Mission Row', 'Popular St', 'Capital Blvd', 'Innocence Blvd', 'Davis Ave', 'Forum Dr', 'Olympic Way', 'Lindsay Circus', 'Spanish Ave', 'Prosperity St'];

/** Rounded rectangle (closed) for the freeway ring. */
function roundRect(x0: number, z0: number, x1: number, z1: number, r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const arc = (cx: number, cz: number, a0: number) => {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  };
  arc(x1 - r, z0 + r, -Math.PI / 2);
  arc(x1 - r, z1 - r, 0);
  arc(x0 + r, z1 - r, Math.PI / 2);
  arc(x0 + r, z0 + r, Math.PI);
  out.push(out[0]!);
  return out;
}

export function roads(): RoadDef[] {
  const R: RoadDef[] = [];
  const line = (name: string, type: RoadType, a: [number, number], b: [number, number]) => R.push({ name, type, pts: [a, b], sharp: true });
  // Downtown + Midtown grid: north-south lines, and east-west lines that run on into Midtown.
  const DX = [-280, -200, -120, -40, 40, 120, 200, 280, 360];
  const DZ = [-420, -340, -260, -180, -100, -20, 60, 140, 220];
  DX.forEach((x, i) => line(NS[i]!, i % 2 === 0 ? 'avenue' : 'street', [x, -430], [x, 230]));
  DZ.forEach((z, j) => line(EW[j]!, j % 2 === 0 ? 'avenue' : 'street', [-290, z], [930, z]));
  // Midtown north-south.
  [480, 600, 720, 840].forEach((x, i) => line(NS[(i + 9) % NS.length]!, i % 2 ? 'street' : 'avenue', [x, -500], [x, 400]));
  // Port (north-east): wide avenues and the dock road.
  [540, 740, 930].forEach((x, i) => line(`Dock Rd ${i + 1}`, 'avenue', [x, -500], [x, -950]));
  [-680, -820, -950].forEach((z, i) => line(`Terminal St ${i + 1}`, 'street', [470, z], [940, z]));
  // Hill Avenue along the foot of the hills, joining the port.
  R.push({ name: 'Vista Hill Ave', type: 'avenue', pts: [[-420, -560], [-200, -590], [100, -600], [330, -585], [540, -570]] });
  // Vista Hills: switchbacks up to the crest, and the crest road.
  R.push({ name: 'Mulholland Dr', type: 'rural', pts: [[40, -598], [70, -660], [-30, -700], [-90, -740], [20, -790], [130, -820], [60, -870], [-60, -900], [-140, -935]] });
  R.push({ name: 'Crest Rd', type: 'rural', pts: [[-420, -930], [-260, -950], [-140, -935], [40, -960], [220, -940], [380, -955], [540, -950]] });
  R.push({ name: 'Canyon Pass', type: 'rural', pts: [[-420, -930], [-430, -780], [-420, -560]] });
  // West side (Palm Heights): curved streets round a centre to the west + radial avenues.
  const C: [number, number] = [-1260, -80];
  [300, 390, 480, 570].forEach((r, k) => {
    const pts: Array<[number, number]> = [];
    for (let a = -48; a <= 48; a += 8) pts.push([C[0] + Math.cos((a * Math.PI) / 180) * r, C[1] + Math.sin((a * Math.PI) / 180) * r]);
    R.push({ name: ['Palm Crescent', 'Sunset Arc', 'Orchid Way', 'Laguna Curve'][k]!, type: 'street', pts });
  });
  [-40, -20, 0, 20, 40].forEach((a, k) => {
    const c = Math.cos((a * Math.PI) / 180);
    const s = Math.sin((a * Math.PI) / 180);
    R.push({ name: ['Bay Ave', 'Cove Rd', 'Heights Blvd', 'Shore Rd', 'Marina Ave'][k]!, type: a === 0 ? 'avenue' : 'street', pts: [[C[0] + c * 270, C[1] + s * 270], [C[0] + c * 610, C[1] + s * 610]], sharp: true });
  });
  // The south-west: Laguna Blvd down to the beach, and its side streets.
  R.push({ name: 'Laguna Blvd', type: 'avenue', pts: [[-690, 95], [-660, 260], [-580, 420], [-500, 560], [-470, coastZ(-470) - 190]] });
  R.push({ name: 'Canal St', type: 'street', pts: [[-975, 300], [-800, 290], [-640, 300], [-470, 330], [-330, 380]] });
  R.push({ name: 'Marsh Way', type: 'street', pts: [[-960, 460], [-760, 470], [-560, 450]] });
  R.push({ name: 'Heron Rd', type: 'street', pts: [[-820, 120], [-840, 290], [-860, 470], [-860, coastZ(-860) - 190]] });
  // Bridges west over the river.
  R.push({ name: 'Mission Bridge', type: 'avenue', pts: [[-290, -260], [-420, -255], [-560, -250], [-700, -240]] });
  R.push({ name: 'Harbor Bridge', type: 'avenue', pts: [[-290, 60], [-400, 70], [-520, 90], [-690, 95]] });
  // South over the river to the beach (the downtown avenues carry on).
  R.push({ name: 'Elgin Ave', type: 'avenue', pts: [[-40, 230], [-40, 330], [-30, 450], [-40, 560], [-40, 700]] });
  R.push({ name: 'Rockford Dr', type: 'avenue', pts: [[200, 230], [200, 330], [215, 460], [210, 580], [200, 700]] });
  // Beach district streets.
  [-860, -740, -620, -500, -380, -260, 80, 320, 440, 560, 760, 880].forEach((x, i) => R.push({ name: `${['Ocean', 'Sand', 'Surf', 'Pier', 'Coral', 'Dune', 'Tide', 'Reef', 'Shell', 'Kelp', 'Gull', 'Bay'][i]} St`, type: 'street', pts: [[x, coastZ(x) - 70], [x + 10, coastZ(x) - 260]], sharp: true }));
  R.push({ name: 'Boardwalk Ave', type: 'avenue', pts: Array.from({ length: 21 }, (_, k): [number, number] => [-980 + k * 98, coastZ(-980 + k * 98) - 190]) });
  // Ocean Highway along the coast.
  R.push({ name: 'Ocean Hwy', type: 'highway', pts: Array.from({ length: 23 }, (_, k): [number, number] => [-1000 + k * 91, coastZ(-1000 + k * 91) - 70]) });
  // The edges of the map: coastal roads up the west and east sides.
  R.push({ name: 'Western Coast Rd', type: 'rural', pts: [[-985, -700], [-975, -300], [-985, 100], [-960, 450], [-930, coastZ(-930) - 70]] });
  R.push({ name: 'Eastern Fwy', type: 'rural', pts: [[940, -950], [965, -600], [960, -200], [955, 200], [945, 500], [930, coastZ(930) - 70]] });
  R.push({ name: 'North Coast Rd', type: 'rural', pts: [[-985, -700], [-860, -820], [-700, -900], [-560, -920], [-420, -930]] });
  // The Velora Freeway: an elevated ring round downtown.
  R.push({ name: 'Velora Fwy', type: 'highway', pts: roundRect(-330, -485, 425, 300, 120), height: () => HIGHWAY_Y });
  // West spur: elevated over the river, down to Palm Heights.
  R.push({ name: 'Palm Fwy', type: 'highway', pts: [[-330, -150], [-450, -150], [-570, -150], [-690, -140], [-800, -120]], height: (f) => (f < 0.55 ? HIGHWAY_Y : HIGHWAY_Y * Math.max(0, 1 - (f - 0.55) / 0.4)) });
  // On / off ramps.
  const ramp = (name: string, pts: Array<[number, number]>) => R.push({ name, type: 'ramp', pts, height: (f) => HIGHWAY_Y * (1 - smooth(f)) });
  ramp('Fwy Exit 1', [[150, -485], [175, -530], [190, -585]]);
  ramp('Fwy Exit 2', [[425, -40], [470, -10], [530, 20], [600, 30]]);
  ramp('Fwy Exit 3', [[40, 300], [110, 330], [200, 350]]);
  ramp('Fwy Exit 4', [[425, -300], [480, -320], [540, -330], [600, -345]]);
  return R;
}

export function smooth(f: number): number {
  const t = Math.max(0, Math.min(1, f));
  return t * t * (3 - 2 * t);
}
