import type { ArenaId } from '../arenas';

/** Colours as CSS strings (canvas) or [r, g, b] in linear-ish 0..1 (shaders / lights). */
export type Rgb = [number, number, number];

/**
 * Everything that makes one arena look different from another. Collision is
 * shared; the field geometry is shared; only materials, surroundings, sky,
 * lighting, weather and ambience come from here.
 */
export interface ArenaTheme {
  id: ArenaId;
  turf: {
    /** Grass gets blade detail + mowing stripes; the others get their own ground detail. */
    kind: 'grass' | 'synthetic' | 'dirt' | 'snow' | 'metal';
    /** Alternating band colours. */
    base: [string, string];
    /** Field markings. */
    line: string;
    lineGlow: number;
    /** Team-colour wash strength near each goal (0..1). */
    teamTint: number;
    /** View-dependent mowing stripes. */
    stripes: boolean;
    /** Large lush / dry patches. */
    patches: boolean;
    roughness: number;
    normalScale: number;
  };
  walls: {
    /** Glass base colour. */
    tint: string;
    /** Emissive pattern colour per team (null = the team glow). */
    glow: [string, string] | null;
    emissive: number;
    pattern: 'hex' | 'grid';
    /** Light strips along the curve / top (0 = off). */
    strips: number;
    /** Ceiling veil opacity. */
    top: number;
    /** Net / post emissive strength. */
    netGlow: number;
  };
  surround: {
    kind: 'stadium' | 'skyline' | 'canyon' | 'void';
    ground: string;
    struct: string;
    aisle: string;
    /** Floodlight ring colour (linear, > 1 = bright). */
    flood: Rgb;
    crowd: {
      /** Seat backs for blue / orange / mixed sections. */
      seats: [string, string, string];
      blue: string[];
      orange: string[];
      neutral: string[];
      /** How many fans wear team colours (0..1). */
      teamFans: number;
      /** Concrete tier colour. */
      tier: string;
      /** Camera-flash brightness. */
      flashes: number;
    } | null;
    /** White caps along the tier edges. */
    snow: boolean;
  };
  led: {
    panels: Array<[string, string, string]>;
    /** Brightness (toneMapped off). */
    base: number;
  };
  sky: {
    top: Rgb;
    mid: Rgb;
    horizon: Rgb;
    /** Star density (0 = none). */
    stars: number;
    sun: { dir: Rgb; color: Rgb; size: number; halo: number } | null;
    /** Cloud cover 0..1 and colour. */
    clouds: number;
    cloudColor: Rgb;
    /** A planet (space arenas): direction, angular radius, two band colours and the atmosphere rim. */
    planet: { dir: Rgb; radius: number; color: Rgb; band: Rgb; atmo: Rgb } | null;
    nebula: number;
  };
  light: {
    hemi: { sky: number; ground: number; intensity: number };
    /** The straight-down shadow caster (ball shadow). */
    sun: { color: number; intensity: number; dir: Rgb };
    key: { color: number; intensity: number; dir: Rgb };
    rim: { color: number; intensity: number; dir: Rgb };
    fog: { color: number; near: number; far: number } | null;
    exposure: number;
    env: number;
    /** Bloom strength (bright day arenas need much less). */
    bloom: number;
    /** Bloom luminance threshold (default 1.05); daylight raises it so sunlit concrete doesn't glow. */
    bloomThreshold?: number;
  };
  weather: { kind: 'snow' | 'dust' | 'ash'; count: number; color: Rgb; size: number; speed: number; drift: number } | null;
  ambience: { crowd: number; wind: number; hum: number; muffled: boolean };
}

const DOME_PANELS: Array<[string, string, string]> = [
  ['#0b1a44', '#5aa0ff', 'BOOSTBALL'],
  ['#2a1204', '#ff9a2e', 'SUPERSONIC'],
  ['#05060c', '#ffffff', '» » » » »'],
  ['#0b1a44', '#5aa0ff', 'AERIAL CHAMPIONSHIP'],
  ['#2a1204', '#ff9a2e', 'BOOSTBALL'],
  ['#05060c', '#ffd23f', '★ GOAL OF THE NIGHT ★'],
];

const DOME_CROWD = {
  seats: ['#16295e', '#5a2a0e', '#2a2f45'] as [string, string, string],
  blue: ['#2f62c8', '#3f75e0', '#1d3f99', '#5b8cf0', '#e9eef8'],
  orange: ['#d8661a', '#f08a2c', '#b44c0c', '#ffb050', '#f4ece0'],
  neutral: ['#2b2b33', '#7a2230', '#2f6e3a', '#c9b23a', '#5a3d82', '#9aa0aa', '#d8d8d8', '#1e4f6e'],
  teamFans: 0.82,
  tier: '#0d1020',
  flashes: 1,
};

const dome: ArenaTheme = {
  id: 'dome',
  turf: { kind: 'grass', base: ['#3f8c30', '#37802b'], line: '255,255,255', lineGlow: 0.45, teamTint: 1, stripes: true, patches: true, roughness: 0.88, normalScale: 0.55 },
  walls: { tint: '#121c40', glow: null, emissive: 0.38, pattern: 'hex', strips: 1, top: 0.07, netGlow: 0.38 },
  surround: { kind: 'stadium', ground: '#15182a', struct: '#1a1f36', aisle: '#272b3d', flood: [2.1, 2.06, 1.9], crowd: DOME_CROWD, snow: false },
  led: { panels: DOME_PANELS, base: 1.5 },
  sky: { top: [0.02, 0.03, 0.09], mid: [0.1, 0.12, 0.32], horizon: [0.45, 0.33, 0.55], stars: 1, sun: null, clouds: 0, cloudColor: [1, 1, 1], planet: null, nebula: 0 },
  light: {
    hemi: { sky: 0xb8c8ff, ground: 0x30402a, intensity: 0.75 },
    sun: { color: 0xffffff, intensity: 1.25, dir: [0.01, 60, 0.01] },
    key: { color: 0xfff1dd, intensity: 0.75, dir: [-30, 40, 20] },
    rim: { color: 0x8fb0ff, intensity: 0.6, dir: [30, 25, -20] },
    fog: { color: 0x0a0d22, near: 140, far: 420 },
    exposure: 1,
    env: 0.55,
    bloom: 0.5,
  },
  weather: null,
  ambience: { crowd: 1, wind: 0, hum: 0.15, muffled: false },
};

const mannfield: ArenaTheme = {
  id: 'mannfield',
  turf: { kind: 'grass', base: ['#3e9a2b', '#368c25'], line: '255,255,255', lineGlow: 0.15, teamTint: 0.6, stripes: true, patches: true, roughness: 0.9, normalScale: 0.5 },
  walls: { tint: '#1e2a48', glow: null, emissive: 0.16, pattern: 'hex', strips: 0.5, top: 0.02, netGlow: 0.2 },
  surround: {
    kind: 'stadium',
    ground: '#4f5d4a',
    struct: '#7a8089',
    aisle: '#676d76',
    flood: [1.3, 1.3, 1.3],
    crowd: {
      // Coloured seat sections (blue end, orange end, navy sides) on grey concrete.
      seats: ['#2457b8', '#c95a1a', '#22386e'],
      blue: ['#2f64c8', '#4579dc', '#22479e', '#6d98e8', '#e2e8f2'],
      orange: ['#d86e22', '#ee8e38', '#b45410', '#f7ad55', '#efe4d2'],
      neutral: ['#2a2a32', '#b8303a', '#2f7d43', '#d4b63e', '#5e4592', '#7d828c', '#d9d9dd', '#245d7e', '#c9a27e', '#1c1c1c'],
      teamFans: 0.6,
      tier: '#5d626a',
      flashes: 0.3,
    },
    snow: false,
  },
  led: {
    panels: [
      ['#0d2a6e', '#ffffff', 'BOOSTBALL'],
      ['#8a2c06', '#ffd9a0', 'MANNFIELD'],
      ['#0a0c14', '#7fd0ff', '» » » » »'],
      ['#0d2a6e', '#ffd23f', 'SUNDAY LEAGUE'],
      ['#8a2c06', '#ffffff', 'BOOSTBALL'],
      ['#0a0c14', '#ffd23f', '★ HOME OF CHAMPIONS ★'],
    ],
    base: 1.15,
  },
  sky: { top: [0.06, 0.22, 0.68], mid: [0.2, 0.44, 0.86], horizon: [0.5, 0.66, 0.86], stars: 0, sun: { dir: [0.45, 0.5, -0.75], color: [1, 0.97, 0.9], size: 0.03, halo: 0.35 }, clouds: 0.42, cloudColor: [0.86, 0.88, 0.92], planet: null, nebula: 0 },
  light: {
    hemi: { sky: 0xc6dcff, ground: 0x5a7a3c, intensity: 0.5 },
    sun: { color: 0xffffff, intensity: 1.05, dir: [8, 60, 6] },
    key: { color: 0xfff0d2, intensity: 0.95, dir: [45, 62, 35] },
    rim: { color: 0xbfd6ff, intensity: 0.3, dir: [-30, 20, -30] },
    fog: { color: 0x8fb2e0, near: 320, far: 1500 },
    exposure: 0.92,
    env: 0.45,
    bloom: 0.15,
    bloomThreshold: 1.7,
  },
  weather: null,
  ambience: { crowd: 0.9, wind: 0.6, hum: 0, muffled: false },
};

const urban: ArenaTheme = {
  id: 'urban',
  turf: { kind: 'synthetic', base: ['#1e4a2c', '#1b4428'], line: '255,255,255', lineGlow: 0.1, teamTint: 0.5, stripes: false, patches: false, roughness: 0.82, normalScale: 0.25 },
  walls: { tint: '#1a1624', glow: null, emissive: 0.3, pattern: 'grid', strips: 0.9, top: 0.04, netGlow: 0.3 },
  surround: { kind: 'skyline', ground: '#1c1a22', struct: '#2a2630', aisle: '#38333f', flood: [2.4, 1.5, 0.6], crowd: { ...DOME_CROWD, seats: ['#2a2434', '#2a2434', '#2a2434'], teamFans: 0.7, tier: '#17141c', flashes: 0.8 }, snow: false },
  led: {
    panels: [
      ['#1a0a2a', '#ff6ad5', 'BOOSTBALL'],
      ['#2a1204', '#ffa040', 'URBAN CENTRAL'],
      ['#05060c', '#ffffff', '» » » » »'],
      ['#1a0a2a', '#7df9ff', 'MIDNIGHT LEAGUE'],
      ['#2a1204', '#ffa040', 'BOOSTBALL'],
      ['#05060c', '#ffd23f', '★ ROOFTOP SERIES ★'],
    ],
    base: 1.6,
  },
  sky: { top: [0.1, 0.05, 0.22], mid: [0.42, 0.16, 0.42], horizon: [0.98, 0.5, 0.22], stars: 0.35, sun: { dir: [0.55, 0.05, -0.83], color: [1, 0.55, 0.25], size: 0.045, halo: 1.2 }, clouds: 0.25, cloudColor: [0.9, 0.5, 0.5], planet: null, nebula: 0 },
  light: {
    hemi: { sky: 0x6a4aa8, ground: 0x2a1a14, intensity: 0.7 },
    sun: { color: 0xffd8b0, intensity: 1.1, dir: [0.01, 60, 0.01] },
    key: { color: 0xffa050, intensity: 1.1, dir: [40, 30, -40] },
    rim: { color: 0x9050ff, intensity: 0.8, dir: [-35, 25, 25] },
    fog: { color: 0x2a1330, near: 170, far: 560 },
    exposure: 1.02,
    env: 0.5,
    bloom: 0.45,
  },
  weather: null,
  ambience: { crowd: 0.7, wind: 0.2, hum: 0.9, muffled: false },
};

const badlands: ArenaTheme = {
  id: 'badlands',
  turf: { kind: 'dirt', base: ['#b4854f', '#ac7d4a'], line: '255,238,200', lineGlow: 0.05, teamTint: 0.35, stripes: false, patches: false, roughness: 0.97, normalScale: 0.75 },
  walls: { tint: '#5a4630', glow: ['#ffb060', '#ffb060'], emissive: 0.12, pattern: 'hex', strips: 0.35, top: 0.02, netGlow: 0.15 },
  surround: { kind: 'canyon', ground: '#b58a55', struct: '#6e5236', aisle: '#8a6a44', flood: [2.2, 2, 1.7], crowd: null, snow: false },
  led: {
    panels: [
      ['#3a2210', '#ffd08a', 'BOOSTBALL'],
      ['#2a1a0a', '#ff9a2e', 'BADLANDS'],
      ['#1a1008', '#ffffff', '» » » » »'],
      ['#3a2210', '#ffd08a', 'DUST BOWL CUP'],
      ['#2a1a0a', '#ff9a2e', 'BOOSTBALL'],
      ['#1a1008', '#ffd23f', '★ HOT ★'],
    ],
    base: 1.3,
  },
  sky: { top: [0.16, 0.34, 0.66], mid: [0.62, 0.5, 0.38], horizon: [0.88, 0.62, 0.36], stars: 0, sun: { dir: [-0.35, 0.38, -0.85], color: [1, 0.95, 0.82], size: 0.035, halo: 1 }, clouds: 0.04, cloudColor: [0.95, 0.85, 0.7], planet: null, nebula: 0 },
  light: {
    hemi: { sky: 0xffe6c4, ground: 0x9a6a3a, intensity: 0.85 },
    sun: { color: 0xfff4de, intensity: 2.2, dir: [10, 60, 4] },
    key: { color: 0xffe2b8, intensity: 1, dir: [50, 70, 25] },
    rim: { color: 0xffc090, intensity: 0.4, dir: [-30, 15, -30] },
    fog: { color: 0xc89a6a, near: 140, far: 560 },
    exposure: 1.05,
    env: 0.6,
    bloom: 0.2,
    bloomThreshold: 1.5,
  },
  weather: { kind: 'dust', count: 700, color: [0.62, 0.48, 0.32], size: 0.9, speed: 0.4, drift: 5 },
  ambience: { crowd: 0.15, wind: 1, hum: 0, muffled: false },
};

const frosty: ArenaTheme = {
  id: 'frosty',
  turf: { kind: 'snow', base: ['#c4cedd', '#bcc7d8'], line: '30,100,255', lineGlow: 0.5, teamTint: 0.45, stripes: false, patches: false, roughness: 0.95, normalScale: 0.45 },
  walls: { tint: '#1a2a48', glow: ['#58a8ff', '#78b8ff'], emissive: 0.34, pattern: 'hex', strips: 0.8, top: 0.08, netGlow: 0.3 },
  surround: {
    kind: 'stadium',
    ground: '#9aa4b4',
    struct: '#2c3446',
    aisle: '#a8b2c2',
    flood: [1.7, 1.9, 2.3],
    crowd: {
      seats: ['#20305a', '#4a2a16', '#2a3048'],
      blue: ['#3466c8', '#4a7ad8', '#243f8a', '#6b94e6', '#eef2fa'],
      orange: ['#d2651c', '#e98a34', '#aa4c10', '#f5b060', '#f4ece0'],
      neutral: ['#1e1e26', '#3a2a40', '#2a3d2a', '#6a6a74', '#f0f0f4', '#3d2f22', '#8e2a30', '#dcdce2'],
      teamFans: 0.6,
      tier: '#5c6476',
      flashes: 0.8,
    },
    snow: true,
  },
  led: {
    panels: [
      ['#0b1a44', '#9ad0ff', 'BOOSTBALL'],
      ['#102a3a', '#ffffff', 'FROSTY MANNFIELD'],
      ['#05060c', '#cfe6ff', '» » » » »'],
      ['#0b1a44', '#9ad0ff', 'WINTER CLASSIC'],
      ['#102a3a', '#ffffff', 'BOOSTBALL'],
      ['#05060c', '#9ad0ff', '❄ ❄ ❄ ❄ ❄'],
    ],
    base: 1.4,
  },
  sky: { top: [0.07, 0.09, 0.15], mid: [0.26, 0.3, 0.4], horizon: [0.5, 0.54, 0.62], stars: 0.15, sun: null, clouds: 0.85, cloudColor: [0.42, 0.46, 0.56], planet: null, nebula: 0 },
  light: {
    hemi: { sky: 0x9cbcff, ground: 0x3c4a66, intensity: 0.6 },
    sun: { color: 0xe4ecff, intensity: 0.85, dir: [0.01, 60, 0.01] },
    key: { color: 0xb8ccff, intensity: 0.55, dir: [-30, 40, 20] },
    rim: { color: 0x6a8cff, intensity: 0.6, dir: [30, 25, -20] },
    fog: { color: 0x3e4860, near: 150, far: 520 },
    exposure: 0.85,
    env: 0.35,
    bloom: 0.28,
    bloomThreshold: 1.4,
  },
  weather: { kind: 'snow', count: 1800, color: [0.9, 0.93, 1], size: 0.3, speed: 1.6, drift: 1.2 },
  ambience: { crowd: 0.55, wind: 0.5, hum: 0, muffled: true },
};

const starbase: ArenaTheme = {
  id: 'starbase',
  turf: { kind: 'metal', base: ['#2a2f3c', '#262a36'], line: '120,255,220', lineGlow: 0.6, teamTint: 0.8, stripes: false, patches: false, roughness: 0.45, normalScale: 0.3 },
  walls: { tint: '#0a1020', glow: ['#20e0ff', '#ff40c0'], emissive: 0.55, pattern: 'grid', strips: 1.4, top: 0.05, netGlow: 0.5 },
  surround: { kind: 'void', ground: '#0b0e18', struct: '#1a2030', aisle: '#222a3c', flood: [1.2, 2.2, 2.6], crowd: null, snow: false },
  led: {
    panels: [
      ['#061024', '#20e0ff', 'BOOSTBALL'],
      ['#200a2a', '#ff40c0', 'STARBASE ARC'],
      ['#05060c', '#ffffff', '» » » » »'],
      ['#061024', '#20e0ff', 'ORBITAL LEAGUE'],
      ['#200a2a', '#ff40c0', 'BOOSTBALL'],
      ['#05060c', '#ffd23f', '★ ZERO-G CUP ★'],
    ],
    base: 1.8,
  },
  sky: { top: [0.0, 0.0, 0.01], mid: [0.01, 0.01, 0.03], horizon: [0.02, 0.02, 0.05], stars: 1.6, sun: null, clouds: 0, cloudColor: [1, 1, 1], planet: { dir: [0.06, 0.15, -1], radius: 0.3, color: [0.1, 0.3, 0.6], band: [0.38, 0.66, 0.82], atmo: [0.3, 0.7, 1.25] }, nebula: 1 },
  light: {
    hemi: { sky: 0x4060b0, ground: 0x201030, intensity: 0.6 },
    sun: { color: 0xdde8ff, intensity: 1.4, dir: [0.01, 60, 0.01] },
    key: { color: 0x80c0ff, intensity: 0.8, dir: [-30, 40, 20] },
    rim: { color: 0xff60c0, intensity: 0.8, dir: [30, 25, -20] },
    fog: null,
    exposure: 1.05,
    env: 0.7,
    bloom: 0.6,
  },
  weather: null,
  ambience: { crowd: 0.35, wind: 0, hum: 1, muffled: false },
};

const shores: ArenaTheme = {
  id: 'shores',
  turf: { kind: 'dirt', base: ['#d9bf8c', '#d2b783'], line: '255,255,255', lineGlow: 0.05, teamTint: 0.35, stripes: false, patches: false, roughness: 0.98, normalScale: 0.5 },
  walls: { tint: '#2a4a5a', glow: ['#60d8ff', '#ffb070'], emissive: 0.12, pattern: 'hex', strips: 0.4, top: 0.02, netGlow: 0.18 },
  surround: {
    kind: 'stadium',
    ground: '#c8ae80',
    struct: '#e8e0d0',
    aisle: '#d6cbb6',
    flood: [1.4, 1.3, 1.1],
    crowd: { ...DOME_CROWD, seats: ['#2a7ab8', '#e07a3a', '#3aa6a0'], teamFans: 0.55, tier: '#d8ccb4', flashes: 0.3 },
    snow: false,
  },
  led: {
    panels: [
      ['#06384a', '#7fe8ff', 'BOOSTBALL'],
      ['#4a1e06', '#ffc070', 'SUNSET SHORES'],
      ['#05060c', '#ffffff', '» » » » »'],
      ['#06384a', '#7fe8ff', 'BEACH CUP'],
      ['#4a1e06', '#ffc070', 'BOOSTBALL'],
      ['#05060c', '#ffd23f', '☀ SURF & TURF ☀'],
    ],
    base: 1.15,
  },
  sky: { top: [0.12, 0.26, 0.6], mid: [0.62, 0.48, 0.5], horizon: [1, 0.66, 0.36], stars: 0, sun: { dir: [-0.6, 0.12, -0.79], color: [1, 0.72, 0.42], size: 0.05, halo: 1.1 }, clouds: 0.3, cloudColor: [1, 0.74, 0.6], planet: null, nebula: 0 },
  light: {
    hemi: { sky: 0xffd8b0, ground: 0xb08850, intensity: 0.8 },
    sun: { color: 0xfff0d8, intensity: 1.6, dir: [6, 60, 4] },
    key: { color: 0xffb070, intensity: 1.1, dir: [-50, 30, -40] },
    rim: { color: 0x80c8ff, intensity: 0.45, dir: [35, 25, 30] },
    fog: { color: 0xe0a880, near: 220, far: 800 },
    exposure: 1,
    env: 0.45,
    bloom: 0.2,
    bloomThreshold: 1.6,
  },
  weather: null,
  ambience: { crowd: 0.8, wind: 0.7, hum: 0, muffled: false },
};

const neon: ArenaTheme = {
  id: 'neon',
  turf: { kind: 'metal', base: ['#120a24', '#100820'], line: '255,80,220', lineGlow: 0.5, teamTint: 0.7, stripes: false, patches: false, roughness: 0.7, normalScale: 0.2 },
  walls: { tint: '#0c0618', glow: ['#30d8ff', '#ff3cc8'], emissive: 0.45, pattern: 'grid', strips: 1.2, top: 0.05, netGlow: 0.45 },
  surround: { kind: 'skyline', ground: '#0a0614', struct: '#1a1030', aisle: '#2a1a44', flood: [2, 0.9, 2.2], crowd: { ...DOME_CROWD, seats: ['#1a1030', '#1a1030', '#1a1030'], teamFans: 0.75, tier: '#0e0a1c', flashes: 1 }, snow: false },
  led: {
    panels: [
      ['#12042a', '#ff4ad8', 'BOOSTBALL'],
      ['#04182a', '#38e0ff', 'NEON GRID'],
      ['#05060c', '#ffffff', '» » » » »'],
      ['#12042a', '#ff4ad8', 'RETRO WAVE'],
      ['#04182a', '#38e0ff', 'BOOSTBALL'],
      ['#05060c', '#ffd23f', '★ 1987 ★'],
    ],
    base: 1.6,
  },
  sky: { top: [0.02, 0.0, 0.06], mid: [0.2, 0.03, 0.3], horizon: [0.9, 0.2, 0.55], stars: 1.2, sun: { dir: [0, 0.12, -1], color: [1, 0.35, 0.6], size: 0.09, halo: 0.8 }, clouds: 0, cloudColor: [1, 1, 1], planet: null, nebula: 0.3 },
  light: {
    hemi: { sky: 0x7040c0, ground: 0x200830, intensity: 0.7 },
    sun: { color: 0xf0d8ff, intensity: 1.1, dir: [0.01, 60, 0.01] },
    key: { color: 0xff60d0, intensity: 0.9, dir: [-30, 35, -40] },
    rim: { color: 0x40d0ff, intensity: 0.9, dir: [30, 25, 30] },
    fog: { color: 0x200a30, near: 180, far: 600 },
    exposure: 1,
    env: 0.45,
    bloom: 0.5,
  },
  weather: null,
  ambience: { crowd: 0.6, wind: 0, hum: 1, muffled: false },
};

const temple: ArenaTheme = {
  id: 'temple',
  turf: { kind: 'grass', base: ['#356e26', '#2f6422'], line: '235,245,215', lineGlow: 0.08, teamTint: 0.45, stripes: false, patches: true, roughness: 0.95, normalScale: 0.65 },
  walls: { tint: '#2a3a2a', glow: ['#7ad070', '#e0c060'], emissive: 0.14, pattern: 'hex', strips: 0.3, top: 0.03, netGlow: 0.15 },
  surround: { kind: 'canyon', ground: '#4a5a36', struct: '#6a6450', aisle: '#57603f', flood: [1.6, 1.8, 1.3], crowd: null, snow: false },
  led: {
    panels: [
      ['#16300e', '#c8f080', 'BOOSTBALL'],
      ['#302a0e', '#ffd870', 'JUNGLE TEMPLE'],
      ['#0a0c06', '#ffffff', '» » » » »'],
      ['#16300e', '#c8f080', 'LOST CUP'],
      ['#302a0e', '#ffd870', 'BOOSTBALL'],
      ['#0a0c06', '#ffd23f', '◆ ANCIENT ◆'],
    ],
    base: 1.2,
  },
  sky: { top: [0.18, 0.36, 0.5], mid: [0.42, 0.58, 0.56], horizon: [0.72, 0.78, 0.62], stars: 0, sun: { dir: [0.3, 0.55, -0.78], color: [1, 0.95, 0.8], size: 0.03, halo: 0.6 }, clouds: 0.55, cloudColor: [0.82, 0.88, 0.84], planet: null, nebula: 0 },
  light: {
    hemi: { sky: 0xd0f0c0, ground: 0x3a5020, intensity: 0.75 },
    sun: { color: 0xfff6dc, intensity: 1.3, dir: [6, 60, 4] },
    key: { color: 0xfff0c8, intensity: 0.8, dir: [40, 55, -30] },
    rim: { color: 0xa0e0a0, intensity: 0.35, dir: [-30, 20, 30] },
    fog: { color: 0x8aa890, near: 150, far: 520 },
    exposure: 0.95,
    env: 0.4,
    bloom: 0.15,
    bloomThreshold: 1.6,
  },
  weather: { kind: 'dust', count: 500, color: [0.85, 0.9, 0.55], size: 0.5, speed: 0.25, drift: 2 },
  ambience: { crowd: 0.1, wind: 0.6, hum: 0, muffled: false },
};

const crater: ArenaTheme = {
  id: 'crater',
  turf: { kind: 'dirt', base: ['#3a2c26', '#342722'], line: '255,170,90', lineGlow: 0.35, teamTint: 0.5, stripes: false, patches: false, roughness: 0.97, normalScale: 0.8 },
  walls: { tint: '#2a1410', glow: ['#ff8030', '#ff5020'], emissive: 0.3, pattern: 'hex', strips: 0.7, top: 0.04, netGlow: 0.3 },
  surround: { kind: 'canyon', ground: '#2a1c18', struct: '#3a2620', aisle: '#4a3028', flood: [2.4, 1.3, 0.7], crowd: null, snow: false },
  led: {
    panels: [
      ['#2a0c04', '#ff9040', 'BOOSTBALL'],
      ['#1a0604', '#ffc070', 'EMBER CRATER'],
      ['#0a0404', '#ffffff', '» » » » »'],
      ['#2a0c04', '#ff9040', 'MAGMA LEAGUE'],
      ['#1a0604', '#ffc070', 'BOOSTBALL'],
      ['#0a0404', '#ffd23f', '▲ HOT ZONE ▲'],
    ],
    base: 1.4,
  },
  sky: { top: [0.05, 0.02, 0.02], mid: [0.22, 0.07, 0.04], horizon: [0.7, 0.24, 0.08], stars: 0.2, sun: null, clouds: 0.7, cloudColor: [0.35, 0.16, 0.1], planet: null, nebula: 0 },
  light: {
    hemi: { sky: 0xa05030, ground: 0x401008, intensity: 0.75 },
    sun: { color: 0xffd0b0, intensity: 1.1, dir: [0.01, 60, 0.01] },
    key: { color: 0xff7030, intensity: 1.1, dir: [40, 25, -40] },
    rim: { color: 0xff4020, intensity: 0.7, dir: [-35, 20, 30] },
    fog: { color: 0x3a1408, near: 150, far: 480 },
    exposure: 1.05,
    env: 0.4,
    bloom: 0.45,
  },
  weather: { kind: 'ash', count: 1200, color: [0.5, 0.45, 0.42], size: 0.35, speed: 0.9, drift: 1.5 },
  ambience: { crowd: 0.2, wind: 0.8, hum: 0.4, muffled: false },
};

const harvest: ArenaTheme = {
  id: 'harvest',
  turf: { kind: 'grass', base: ['#3c7a2a', '#357026'], line: '255,250,235', lineGlow: 0.2, teamTint: 0.55, stripes: true, patches: true, roughness: 0.92, normalScale: 0.55 },
  walls: { tint: '#2a2418', glow: ['#ffc860', '#ffa040'], emissive: 0.2, pattern: 'grid', strips: 0.6, top: 0.03, netGlow: 0.25 },
  surround: {
    kind: 'stadium',
    ground: '#2a2a1c',
    struct: '#5a4a34',
    aisle: '#4a3e2c',
    flood: [2.2, 1.9, 1.4],
    crowd: { ...DOME_CROWD, seats: ['#6a4a2a', '#6a4a2a', '#4a3a26'], teamFans: 0.5, tier: '#3a3024', flashes: 0.6 },
    snow: false,
  },
  led: {
    panels: [
      ['#2a1a06', '#ffd080', 'BOOSTBALL'],
      ['#1a2a0a', '#c8f080', 'HARVEST NIGHT'],
      ['#0a0806', '#ffffff', '» » » » »'],
      ['#2a1a06', '#ffd080', 'COUNTY FAIR'],
      ['#1a2a0a', '#c8f080', 'BOOSTBALL'],
      ['#0a0806', '#ffd23f', '★ FRIDAY NIGHT ★'],
    ],
    base: 1.3,
  },
  sky: { top: [0.01, 0.02, 0.06], mid: [0.05, 0.08, 0.18], horizon: [0.25, 0.2, 0.22], stars: 1.4, sun: null, clouds: 0.15, cloudColor: [0.3, 0.32, 0.4], planet: null, nebula: 0 },
  light: {
    hemi: { sky: 0x8a9ac8, ground: 0x2a3418, intensity: 0.6 },
    sun: { color: 0xfff0d8, intensity: 1.2, dir: [0.01, 60, 0.01] },
    key: { color: 0xffd8a0, intensity: 0.9, dir: [-35, 45, 25] },
    rim: { color: 0x9ab0ff, intensity: 0.45, dir: [30, 25, -25] },
    fog: { color: 0x10141e, near: 160, far: 480 },
    exposure: 1,
    env: 0.4,
    bloom: 0.35,
  },
  weather: null,
  ambience: { crowd: 0.65, wind: 0.3, hum: 0.1, muffled: false },
};

const aqua: ArenaTheme = {
  id: 'aqua',
  turf: { kind: 'synthetic', base: ['#1c5a5c', '#1a5456'], line: '220,255,250', lineGlow: 0.3, teamTint: 0.55, stripes: false, patches: false, roughness: 0.85, normalScale: 0.3 },
  walls: { tint: '#0a2a38', glow: ['#40e0ff', '#60ffd0'], emissive: 0.32, pattern: 'hex', strips: 0.9, top: 0.12, netGlow: 0.32 },
  surround: { kind: 'void', ground: '#0a2a34', struct: '#123a48', aisle: '#1a4a58', flood: [0.9, 1.9, 2.2], crowd: null, snow: false },
  led: {
    panels: [
      ['#03222e', '#60f0ff', 'BOOSTBALL'],
      ['#032e26', '#80ffd8', 'AQUA DOME'],
      ['#020a0e', '#ffffff', '» » » » »'],
      ['#03222e', '#60f0ff', 'DEEP SEA CUP'],
      ['#032e26', '#80ffd8', 'BOOSTBALL'],
      ['#020a0e', '#ffd23f', '◎ 20,000 LEAGUES ◎'],
    ],
    base: 1.4,
  },
  sky: { top: [0.0, 0.03, 0.06], mid: [0.02, 0.14, 0.22], horizon: [0.06, 0.34, 0.42], stars: 0, sun: { dir: [0.1, 0.95, -0.2], color: [0.5, 0.9, 1], size: 0.06, halo: 1.4 }, clouds: 0, cloudColor: [1, 1, 1], planet: null, nebula: 0 },
  light: {
    hemi: { sky: 0x60c8e0, ground: 0x0a3040, intensity: 0.8 },
    sun: { color: 0xc8f4ff, intensity: 1.2, dir: [0.01, 60, 0.01] },
    key: { color: 0x80e0ff, intensity: 0.7, dir: [-30, 45, 20] },
    rim: { color: 0x40ffd0, intensity: 0.6, dir: [30, 25, -20] },
    fog: { color: 0x0a3a4a, near: 110, far: 380 },
    exposure: 1,
    env: 0.45,
    bloom: 0.35,
  },
  weather: { kind: 'dust', count: 600, color: [0.7, 0.95, 1], size: 0.35, speed: -0.5, drift: 0.6 },
  ambience: { crowd: 0.2, wind: 0, hum: 0.7, muffled: true },
};

export const THEMES: Record<ArenaId, ArenaTheme> = { dome, mannfield, urban, badlands, frosty, starbase, shores, neon, temple, crater, harvest, aqua };
