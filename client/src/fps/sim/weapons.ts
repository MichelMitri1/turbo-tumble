/**
 * Weapon stats, tuned like modern CoD multiplayer (100 HP, no armour):
 * damage falls off over range, headshots multiply, ARs kill in 4–5 hits,
 * SMGs shred up close, snipers one-shot to the upper body, shotguns one-shot
 * in their range. Names are original; the models come from the Ultimate Gun Pack.
 */
export type WeaponClass = 'ar' | 'smg' | 'lmg' | 'shotgun' | 'sniper' | 'marksman' | 'pistol';

export interface WeaponDef {
  id: string;
  name: string;
  cls: WeaponClass;
  model: string;
  /** Rounds per minute. */
  rpm: number;
  /** 'auto', 'semi', 'burst' (3), 'bolt' / 'pump' (manual cycle). */
  mode: 'auto' | 'semi' | 'burst' | 'bolt' | 'pump';
  mag: number;
  reserve: number;
  reload: number;
  reloadEmpty: number;
  /** ADS time (s). */
  ads: number;
  /** [range m, damage] steps (damage applies up to that range). */
  damage: Array<[number, number]>;
  head: number;
  limb: number;
  pellets?: number;
  /** Hipfire cone (degrees, half-angle), ADS cone. */
  hip: number;
  adsSpread: number;
  /** Movement speed multiplier. */
  move: number;
  /** Recoil per shot: vertical / horizontal (degrees). */
  recoilV: number;
  recoilH: number;
  /** ADS zoom (fov divisor). */
  zoom: number;
  /** Sprint-out time (s). */
  sprintOut: number;
  slot: 'primary' | 'secondary';
  /** Built-in scope (snipers). */
  scoped?: boolean;
  /** Viewmodel scale (model units → metres) and grip offset. */
  scale: number;
}

export const WEAPONS: WeaponDef[] = [
  // Assault rifles.
  { id: 'm13', name: 'M13 Vanguard', cls: 'ar', model: 'gun-assaultrifle2-1', rpm: 800, mode: 'auto', mag: 30, reserve: 150, reload: 2.1, reloadEmpty: 2.6, ads: 0.24, damage: [[30, 28], [50, 24], [999, 20]], head: 1.4, limb: 0.9, hip: 2.1, adsSpread: 0.15, move: 0.95, recoilV: 0.55, recoilH: 0.3, zoom: 1.35, sprintOut: 0.24, slot: 'primary', scale: 0.17 },
  { id: 'kr47', name: 'KR-47', cls: 'ar', model: 'gun-assaultrifle-3', rpm: 600, mode: 'auto', mag: 30, reserve: 150, reload: 2.4, reloadEmpty: 2.9, ads: 0.27, damage: [[25, 35], [45, 30], [999, 25]], head: 1.35, limb: 0.9, hip: 2.3, adsSpread: 0.2, move: 0.93, recoilV: 0.9, recoilH: 0.5, zoom: 1.35, sprintOut: 0.26, slot: 'primary', scale: 0.19 },
  { id: 'grau', name: 'Grau 5.56', cls: 'ar', model: 'gun-assaultrifle-5', rpm: 740, mode: 'auto', mag: 30, reserve: 150, reload: 2.2, reloadEmpty: 2.7, ads: 0.25, damage: [[35, 25], [60, 22], [999, 20]], head: 1.4, limb: 0.9, hip: 2.1, adsSpread: 0.12, move: 0.95, recoilV: 0.35, recoilH: 0.18, zoom: 1.35, sprintOut: 0.24, slot: 'primary', scale: 0.165 },
  { id: 'raptor', name: 'Raptor Burst', cls: 'ar', model: 'gun-bullpup-1', rpm: 900, mode: 'burst', mag: 30, reserve: 150, reload: 2.3, reloadEmpty: 2.8, ads: 0.25, damage: [[40, 36], [999, 30]], head: 1.4, limb: 0.9, hip: 2.0, adsSpread: 0.12, move: 0.95, recoilV: 0.5, recoilH: 0.2, zoom: 1.4, sprintOut: 0.24, slot: 'primary', scale: 0.15 },
  // SMGs.
  { id: 'viper', name: 'Viper-5', cls: 'smg', model: 'gun-submachinegun-3', rpm: 800, mode: 'auto', mag: 30, reserve: 180, reload: 1.9, reloadEmpty: 2.3, ads: 0.2, damage: [[12, 26], [25, 21], [999, 16]], head: 1.2, limb: 0.9, hip: 1.5, adsSpread: 0.25, move: 1.03, recoilV: 0.45, recoilH: 0.35, zoom: 1.25, sprintOut: 0.18, slot: 'primary', scale: 0.15 },
  { id: 'striker', name: 'Striker 9', cls: 'smg', model: 'gun-submachinegun-1', rpm: 950, mode: 'auto', mag: 40, reserve: 200, reload: 2.0, reloadEmpty: 2.4, ads: 0.19, damage: [[10, 22], [20, 18], [999, 14]], head: 1.2, limb: 0.9, hip: 1.4, adsSpread: 0.3, move: 1.05, recoilV: 0.4, recoilH: 0.4, zoom: 1.2, sprintOut: 0.17, slot: 'primary', scale: 0.16 },
  { id: 'fennec', name: 'Fennec SX', cls: 'smg', model: 'gun-submachinegun-5', rpm: 1100, mode: 'auto', mag: 25, reserve: 175, reload: 1.8, reloadEmpty: 2.2, ads: 0.21, damage: [[9, 24], [18, 19], [999, 14]], head: 1.2, limb: 0.9, hip: 1.6, adsSpread: 0.3, move: 1.02, recoilV: 0.38, recoilH: 0.3, zoom: 1.25, sprintOut: 0.18, slot: 'primary', scale: 0.14 },
  { id: 'carbine', name: 'Ash-9 Carbine', cls: 'smg', model: 'gun-assaultrifle2-3', rpm: 900, mode: 'auto', mag: 30, reserve: 180, reload: 2.0, reloadEmpty: 2.4, ads: 0.21, damage: [[15, 25], [30, 20], [999, 17]], head: 1.25, limb: 0.9, hip: 1.7, adsSpread: 0.2, move: 1.0, recoilV: 0.42, recoilH: 0.3, zoom: 1.3, sprintOut: 0.2, slot: 'primary', scale: 0.15 },
  // LMG.
  { id: 'holger', name: 'Holger-26', cls: 'lmg', model: 'gun-bullpup-3', rpm: 700, mode: 'auto', mag: 100, reserve: 200, reload: 5.2, reloadEmpty: 6, ads: 0.4, damage: [[40, 30], [999, 25]], head: 1.3, limb: 0.9, hip: 2.75, adsSpread: 0.15, move: 0.86, recoilV: 0.45, recoilH: 0.35, zoom: 1.4, sprintOut: 0.38, slot: 'primary', scale: 0.17 },
  // Shotguns.
  { id: 'r725', name: 'R-725 Pump', cls: 'shotgun', model: 'gun-shotgun-1', rpm: 70, mode: 'pump', mag: 6, reserve: 30, reload: 3.4, reloadEmpty: 3.8, ads: 0.25, damage: [[7, 18], [12, 11], [999, 5]], pellets: 8, head: 1, limb: 1, hip: 4.5, adsSpread: 3.6, move: 0.98, recoilV: 4, recoilH: 1, zoom: 1.15, sprintOut: 0.22, slot: 'primary', scale: 0.16 },
  { id: 'origin', name: 'Origin Auto', cls: 'shotgun', model: 'gun-shotgun-4', rpm: 240, mode: 'semi', mag: 8, reserve: 32, reload: 3.0, reloadEmpty: 3.4, ads: 0.26, damage: [[6, 11], [11, 7], [999, 3]], pellets: 8, head: 1, limb: 1, hip: 5, adsSpread: 4.2, move: 0.97, recoilV: 2.2, recoilH: 0.8, zoom: 1.15, sprintOut: 0.22, slot: 'primary', scale: 0.155 },
  // Snipers + marksman.
  { id: 'hdr', name: 'HDR-50', cls: 'sniper', model: 'gun-sniperrifle-2', rpm: 45, mode: 'bolt', mag: 5, reserve: 25, reload: 3.4, reloadEmpty: 4.2, ads: 0.5, damage: [[999, 140]], head: 1.5, limb: 0.7, hip: 4.0, adsSpread: 0, move: 0.9, recoilV: 4, recoilH: 0.5, zoom: 4.5, sprintOut: 0.42, slot: 'primary', scoped: true, scale: 0.15 },
  { id: 'kar', name: 'Kar-98', cls: 'sniper', model: 'gun-sniperrifle-4', rpm: 65, mode: 'bolt', mag: 5, reserve: 30, reload: 3.0, reloadEmpty: 3.6, ads: 0.36, damage: [[75, 105], [999, 90]], head: 1.6, limb: 0.75, hip: 3.5, adsSpread: 0, move: 0.93, recoilV: 3.4, recoilH: 0.4, zoom: 3, sprintOut: 0.32, slot: 'primary', scoped: true, scale: 0.155 },
  { id: 'ebr', name: 'EBR-14', cls: 'marksman', model: 'gun-sniperrifle-5', rpm: 300, mode: 'semi', mag: 15, reserve: 60, reload: 2.6, reloadEmpty: 3.1, ads: 0.32, damage: [[999, 62]], head: 1.65, limb: 0.85, hip: 3.0, adsSpread: 0, move: 0.93, recoilV: 1.5, recoilH: 0.4, zoom: 2.5, sprintOut: 0.28, slot: 'primary', scoped: true, scale: 0.155 },
  // Secondaries.
  { id: 'x9', name: 'X9 Pistol', cls: 'pistol', model: 'gun-pistol-1', rpm: 400, mode: 'semi', mag: 15, reserve: 60, reload: 1.5, reloadEmpty: 1.8, ads: 0.15, damage: [[12, 30], [25, 24], [999, 18]], head: 1.4, limb: 0.9, hip: 1.3, adsSpread: 0.3, move: 1.06, recoilV: 1.2, recoilH: 0.4, zoom: 1.15, sprintOut: 0.12, slot: 'secondary', scale: 0.12 },
  { id: 'deagle', name: '.50 GS', cls: 'pistol', model: 'gun-pistol-5', rpm: 200, mode: 'semi', mag: 7, reserve: 35, reload: 1.8, reloadEmpty: 2.1, ads: 0.17, damage: [[15, 60], [30, 45], [999, 34]], head: 1.5, limb: 0.9, hip: 1.5, adsSpread: 0.3, move: 1.05, recoilV: 3, recoilH: 0.8, zoom: 1.15, sprintOut: 0.13, slot: 'secondary', scale: 0.125 },
  { id: 'magnum', name: '.357 Magnum', cls: 'pistol', model: 'gun-revolver-2', rpm: 150, mode: 'semi', mag: 6, reserve: 30, reload: 2.6, reloadEmpty: 2.6, ads: 0.17, damage: [[18, 70], [35, 55], [999, 40]], head: 1.5, limb: 0.9, hip: 1.5, adsSpread: 0.25, move: 1.05, recoilV: 3.4, recoilH: 0.7, zoom: 1.15, sprintOut: 0.13, slot: 'secondary', scale: 0.12 },
  { id: 'sawed', name: 'Model 680 Sawn-Off', cls: 'shotgun', model: 'gun-shotgun-sawedoff', rpm: 200, mode: 'semi', mag: 2, reserve: 20, reload: 2.2, reloadEmpty: 2.2, ads: 0.18, damage: [[5, 17], [9, 9], [999, 4]], pellets: 9, head: 1, limb: 1, hip: 5.5, adsSpread: 5, move: 1.03, recoilV: 4, recoilH: 1.2, zoom: 1.1, sprintOut: 0.15, slot: 'secondary', scale: 0.11 },
];

export const WEAPON = Object.fromEntries(WEAPONS.map((w) => [w.id, w])) as Record<string, WeaponDef>;
export const PRIMARIES = WEAPONS.filter((w) => w.slot === 'primary');
export const SECONDARIES = WEAPONS.filter((w) => w.slot === 'secondary');

export function damageAt(w: WeaponDef, range: number): number {
  for (const [r, d] of w.damage) if (range <= r) return d;
  return w.damage[w.damage.length - 1]![1];
}

// ---------------------------------------------------------------- attachments / perks / streaks

export type Optic = 'iron' | 'reddot' | 'holo' | 'acog';
export interface Attachments {
  optic: Optic;
  muzzle: 'none' | 'suppressor';
  under: 'none' | 'grip' | 'laser';
  ammo: 'standard' | 'extended';
}
export const NO_ATTACHMENTS: Attachments = { optic: 'iron', muzzle: 'none', under: 'none', ammo: 'standard' };

/** Stats after attachments. */
export function applyAttachments(w: WeaponDef, a: Attachments): WeaponDef {
  const o = { ...w, damage: w.damage.map((d) => [...d] as [number, number]) };
  if (a.optic === 'acog') {
    o.zoom = Math.max(o.zoom, 2.2);
    o.ads += 0.04;
  }
  if (a.muzzle === 'suppressor') {
    o.damage = o.damage.map(([r, d]) => [r * 0.8, d] as [number, number]);
    o.recoilV *= 0.92;
  }
  if (a.under === 'grip') {
    o.recoilV *= 0.78;
    o.recoilH *= 0.78;
    o.ads += 0.02;
  }
  if (a.under === 'laser') {
    o.hip *= 0.7;
    o.ads -= 0.03;
  }
  if (a.ammo === 'extended') {
    o.mag = Math.round(o.mag * (o.mag <= 8 ? 1.5 : 1.5));
    o.reload *= 1.1;
    o.reloadEmpty *= 1.1;
    o.ads += 0.02;
  }
  return o;
}

export type Perk = 'lightweight' | 'scavenger' | 'ghost' | 'hardline' | 'steady' | 'quickfix';
export const PERKS: Record<Perk, { name: string; tier: 1 | 2 | 3; desc: string }> = {
  lightweight: { name: 'Lightweight', tier: 1, desc: 'Move 7% faster.' },
  scavenger: { name: 'Scavenger', tier: 1, desc: 'Resupply ammo from enemies you kill.' },
  ghost: { name: 'Ghost', tier: 2, desc: 'Undetectable by enemy UAVs and gunships.' },
  hardline: { name: 'Hardline', tier: 2, desc: 'Killstreaks cost 1 less kill.' },
  steady: { name: 'Steady Aim', tier: 3, desc: '35% tighter hipfire.' },
  quickfix: { name: 'Quick Fix', tier: 3, desc: 'Health starts regenerating sooner.' },
};

export type Streak = 'uav' | 'airstrike' | 'heli';
export const STREAKS: Record<Streak, { name: string; kills: number; desc: string }> = {
  uav: { name: 'UAV', kills: 3, desc: 'Shows enemies on the minimap for 30 s.' },
  airstrike: { name: 'Precision Airstrike', kills: 5, desc: 'Jets carpet-bomb the biggest enemy group.' },
  heli: { name: 'Attack Helicopter', kills: 7, desc: 'A gunship circles the map hunting enemies for 40 s.' },
};

export interface Loadout {
  name: string;
  primary: string;
  primaryAtt: Attachments;
  secondary: string;
  perks: [Perk, Perk, Perk];
}

export const DEFAULT_CLASSES: Loadout[] = [
  { name: 'Assault', primary: 'm13', primaryAtt: { optic: 'reddot', muzzle: 'none', under: 'grip', ammo: 'standard' }, secondary: 'x9', perks: ['lightweight', 'hardline', 'quickfix'] },
  { name: 'Run & Gun', primary: 'viper', primaryAtt: { optic: 'iron', muzzle: 'suppressor', under: 'laser', ammo: 'extended' }, secondary: 'x9', perks: ['lightweight', 'ghost', 'steady'] },
  { name: 'Sniper', primary: 'kar', primaryAtt: NO_ATTACHMENTS, secondary: 'deagle', perks: ['scavenger', 'ghost', 'quickfix'] },
  { name: 'Close Quarters', primary: 'r725', primaryAtt: { optic: 'iron', muzzle: 'none', under: 'laser', ammo: 'standard' }, secondary: 'magnum', perks: ['lightweight', 'hardline', 'steady'] },
  { name: 'Support', primary: 'holger', primaryAtt: { optic: 'holo', muzzle: 'none', under: 'grip', ammo: 'standard' }, secondary: 'sawed', perks: ['scavenger', 'hardline', 'quickfix'] },
];
