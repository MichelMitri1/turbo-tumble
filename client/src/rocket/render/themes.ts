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

export const THEMES: Record<ArenaId, ArenaTheme> = { dome, mannfield, urban, badlands, frosty, starbase };
