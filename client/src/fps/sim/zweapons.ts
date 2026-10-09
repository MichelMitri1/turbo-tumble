import { WEAPON, type WeaponClass, type WeaponDef } from './weapons';

/**
 * Zombies arsenal, after Black Ops (2010) zombies: the starting pistol, the chalk-outline
 * wall weapons, the mystery box pool and the wonder weapons, each with its Pack-a-Punch
 * upgrade (more damage, bigger mags, a new name). Damage is zombie damage (zombies start
 * at 150 health), so the numbers are bigger than multiplayer's.
 *
 * These live in the same WEAPON table (the viewmodel, sounds and hit code all look weapons
 * up by id) but never appear in the multiplayer class editor.
 */

export interface ZWeaponExtra {
  /** Explosive rounds: splash radius / damage at the centre (rockets, grenades, ray bolts). */
  splash?: { r: number; dmg: number; self?: number };
  /** Projectile look for explosive rounds. */
  proj?: 'ray' | 'ray2' | 'grenade' | 'rocket';
  /** The Thundergun: a cone that blows away everything in front of you. */
  thunder?: { range: number; cos: number };
  /** Incendiary pellets: zombies hit burn. */
  burn?: boolean;
  /** Ammo you start with when it's bought / drawn (else full reserve). */
  startReserve?: number;
  /** Pack-a-Punch result. */
  pap?: string;
  /** Upgraded already. */
  upgraded?: boolean;
  /** Mystery box weight (0 = not in the box). */
  box?: number;
}
export type ZWeaponDef = WeaponDef & { zm: ZWeaponExtra };

type Spec = {
  id: string;
  name: string;
  cls: WeaponClass;
  model: string;
  rpm: number;
  mode: WeaponDef['mode'];
  mag: number;
  reserve: number;
  dmg: number;
  head?: number;
  reload?: number;
  pellets?: number;
  hip?: number;
  scale: number;
  zm: ZWeaponExtra;
  sfx: [string, number];
  move?: number;
  zoom?: number;
  scoped?: boolean;
  /** PaP: [name, damage ×, mag, reserve, extra]. */
  up?: [string, number, number, number, Partial<ZWeaponExtra>?, Partial<Spec>?];
};

const BASE: Record<WeaponClass, Partial<WeaponDef>> = {
  pistol: { reload: 1.6, reloadEmpty: 1.9, ads: 0.16, adsSpread: 0.3, move: 1.05, recoilV: 1.4, recoilH: 0.4, zoom: 1.15, sprintOut: 0.13, hip: 1.4 },
  smg: { reload: 2.2, reloadEmpty: 2.6, ads: 0.2, adsSpread: 0.25, move: 1.02, recoilV: 0.45, recoilH: 0.35, zoom: 1.25, sprintOut: 0.18, hip: 1.6 },
  ar: { reload: 2.4, reloadEmpty: 2.9, ads: 0.25, adsSpread: 0.15, move: 0.95, recoilV: 0.6, recoilH: 0.32, zoom: 1.35, sprintOut: 0.24, hip: 2.2 },
  lmg: { reload: 5.0, reloadEmpty: 5.8, ads: 0.4, adsSpread: 0.15, move: 0.86, recoilV: 0.5, recoilH: 0.35, zoom: 1.4, sprintOut: 0.38, hip: 2.8 },
  shotgun: { reload: 3.2, reloadEmpty: 3.6, ads: 0.25, adsSpread: 3.6, move: 0.97, recoilV: 3.5, recoilH: 1, zoom: 1.15, sprintOut: 0.22, hip: 4.5 },
  sniper: { reload: 3.2, reloadEmpty: 3.8, ads: 0.4, adsSpread: 0, move: 0.9, recoilV: 3.5, recoilH: 0.5, zoom: 3.5, sprintOut: 0.36, hip: 4 },
  marksman: { reload: 2.6, reloadEmpty: 3.1, ads: 0.3, adsSpread: 0, move: 0.93, recoilV: 1.6, recoilH: 0.4, zoom: 2.2, sprintOut: 0.28, hip: 3 },
};

const SPECS: Spec[] = [
  // ---- the starting pistol
  { id: 'zm_m1911', name: 'M1911', cls: 'pistol', model: 'gun-pistol-2', rpm: 625, mode: 'semi', mag: 8, reserve: 80, dmg: 40, head: 2.5, scale: 0.12, sfx: ['m1911', 1], zm: { startReserve: 32 },
    up: ['Mustang & Sally', 1, 12, 60, { splash: { r: 3.2, dmg: 650, self: 0 }, proj: 'grenade' }] },
  // ---- wall weapons (chalk outlines)
  { id: 'zm_olympia', name: 'Olympia', cls: 'shotgun', model: 'gun-shotgun-2', rpm: 300, mode: 'semi', mag: 2, reserve: 38, dmg: 75, pellets: 8, scale: 0.15, sfx: ['model12', 0.95], zm: {},
    up: ['Hades', 1.6, 2, 60, { burn: true }] },
  { id: 'zm_m14', name: 'M14', cls: 'marksman', model: 'gun-assaultrifle-1', rpm: 450, mode: 'semi', mag: 8, reserve: 92, dmg: 105, head: 3, scale: 0.17, sfx: ['m1917', 1.05], zm: {},
    up: ['Mnesia', 2, 12, 132] },
  { id: 'zm_mp5k', name: 'MP5K', cls: 'smg', model: 'gun-submachinegun-4', rpm: 750, mode: 'auto', mag: 30, reserve: 120, dmg: 50, head: 3, scale: 0.16, sfx: ['m45', 1.1], zm: { box: 0 },
    up: ['MP115 Kollider', 2.2, 40, 200] },
  { id: 'zm_mp40', name: 'MP40', cls: 'smg', model: 'gun-submachinegun-2', rpm: 500, mode: 'auto', mag: 32, reserve: 192, dmg: 70, head: 3, scale: 0.15, sfx: ['ppsh', 0.85], zm: {},
    up: ['The Afterburner', 2, 64, 384] },
  { id: 'zm_pm63', name: 'PM63', cls: 'smg', model: 'gun-submachinegun-1', rpm: 1000, mode: 'auto', mag: 20, reserve: 100, dmg: 50, head: 3, scale: 0.15, sfx: ['m45', 1.2], zm: {},
    up: ['Tokyo & Rose', 2.2, 40, 200] },
  { id: 'zm_mpl', name: 'MPL', cls: 'smg', model: 'gun-submachinegun-3', rpm: 900, mode: 'auto', mag: 24, reserve: 192, dmg: 50, head: 3, scale: 0.15, sfx: ['m45', 1.05], zm: {},
    up: ['MPL-LF', 2.2, 48, 288] },
  { id: 'zm_ak74u', name: 'AK74u', cls: 'smg', model: 'gun-assaultrifle2-4', rpm: 800, mode: 'auto', mag: 20, reserve: 160, dmg: 80, head: 3, scale: 0.16, sfx: ['ak47', 1.08], zm: {},
    up: ['AK74fu2', 2, 40, 280] },
  { id: 'zm_m16', name: 'M16', cls: 'ar', model: 'gun-assaultrifle-2', rpm: 900, mode: 'burst', mag: 30, reserve: 120, dmg: 100, head: 3, scale: 0.16, sfx: ['ar15', 1], zm: {},
    up: ['Skullpiercer', 1.6, 30, 240] },
  { id: 'zm_stakeout', name: 'Stakeout', cls: 'shotgun', model: 'gun-shotgun-3', rpm: 70, mode: 'pump', mag: 6, reserve: 54, dmg: 160, pellets: 8, scale: 0.15, sfx: ['nova', 1], zm: {},
    up: ['Raid', 2, 10, 60] },
  // ---- the mystery box
  { id: 'zm_galil', name: 'Galil', cls: 'ar', model: 'gun-assaultrifle-4', rpm: 750, mode: 'auto', mag: 35, reserve: 315, dmg: 100, head: 3, scale: 0.16, sfx: ['ak47', 0.98], zm: { box: 10 },
    up: ['Lamentation', 1.6, 35, 490] },
  { id: 'zm_commando', name: 'Commando', cls: 'ar', model: 'gun-assaultrifle2-2', rpm: 770, mode: 'auto', mag: 30, reserve: 270, dmg: 100, head: 3, scale: 0.16, sfx: ['ar15', 0.95], zm: { box: 10 },
    up: ['Predator', 1.6, 30, 360] },
  { id: 'zm_famas', name: 'FAMAS', cls: 'ar', model: 'gun-bullpup-2', rpm: 1000, mode: 'auto', mag: 30, reserve: 270, dmg: 100, head: 3, scale: 0.16, sfx: ['sks', 1.1], zm: { box: 10 },
    up: ['G16-GL35', 1.6, 45, 360] },
  { id: 'zm_aug', name: 'AUG', cls: 'ar', model: 'gun-bullpup-1', rpm: 690, mode: 'auto', mag: 30, reserve: 270, dmg: 120, head: 3, scale: 0.15, sfx: ['sks', 1], zm: { box: 10 },
    up: ['AUG-50M3', 1.6, 30, 360] },
  { id: 'zm_g11', name: 'G11', cls: 'ar', model: 'gun-bullpup-3', rpm: 1200, mode: 'burst', mag: 48, reserve: 192, dmg: 100, head: 3, scale: 0.16, sfx: ['sks', 1.2], zm: { box: 8 },
    up: ['G115 Generator', 1.6, 48, 288] },
  { id: 'zm_hk21', name: 'HK21', cls: 'lmg', model: 'gun-assaultrifle2-1', rpm: 800, mode: 'auto', mag: 125, reserve: 500, dmg: 130, head: 2, scale: 0.16, sfx: ['ak47', 0.88], zm: { box: 8 },
    up: ['H115 Oscillator', 1.6, 150, 750] },
  { id: 'zm_rpk', name: 'RPK', cls: 'lmg', model: 'gun-assaultrifle-5', rpm: 750, mode: 'auto', mag: 100, reserve: 400, dmg: 130, head: 2, scale: 0.16, sfx: ['ak47', 0.84], zm: { box: 8 },
    up: ['R115 Resonator', 1.6, 100, 600] },
  { id: 'zm_spas', name: 'SPAS-12', cls: 'shotgun', model: 'gun-shotgun-1', rpm: 240, mode: 'semi', mag: 8, reserve: 32, dmg: 120, pellets: 8, scale: 0.15, sfx: ['daly', 1], zm: { box: 9 },
    up: ['SPAZ-24', 2, 24, 72] },
  { id: 'zm_hs10', name: 'HS10', cls: 'shotgun', model: 'gun-shotgun-shortstock', rpm: 300, mode: 'semi', mag: 6, reserve: 36, dmg: 100, pellets: 8, scale: 0.13, sfx: ['daly', 1.12], zm: { box: 8 },
    up: ['Typhoid & Mary', 2, 12, 72] },
  { id: 'zm_python', name: 'Python', cls: 'pistol', model: 'gun-revolver-1', rpm: 180, mode: 'semi', mag: 6, reserve: 84, dmg: 450, head: 2, scale: 0.13, sfx: ['sw642', 0.92], zm: { box: 9 },
    up: ['Cobra', 2.2, 6, 84] },
  { id: 'zm_cz75', name: 'CZ75', cls: 'pistol', model: 'gun-pistol-3', rpm: 600, mode: 'semi', mag: 15, reserve: 135, dmg: 150, head: 3, scale: 0.12, sfx: ['ppq', 1], zm: { box: 9 },
    up: ['Calamity', 2, 15, 180] },
  { id: 'zm_dragunov', name: 'Dragunov', cls: 'sniper', model: 'gun-sniperrifle-3', rpm: 320, mode: 'semi', mag: 10, reserve: 50, dmg: 500, head: 3, scale: 0.15, sfx: ['tikka', 1.05], zoom: 3, scoped: true, zm: { box: 7 },
    up: ['D115 Disassembler', 2, 15, 90] },
  { id: 'zm_l96', name: 'L96A1', cls: 'sniper', model: 'gun-sniperrifle-1', rpm: 45, mode: 'bolt', mag: 5, reserve: 50, dmg: 1000, head: 3, scale: 0.15, sfx: ['mosin', 0.95], zoom: 4.5, scoped: true, zm: { box: 7 },
    up: ['L115 Isolator', 2, 8, 64] },
  { id: 'zm_chinalake', name: 'China Lake', cls: 'shotgun', model: 'gun-grenadelauncher', rpm: 60, mode: 'pump', mag: 2, reserve: 30, dmg: 50, scale: 0.75, sfx: ['model12', 0.7], zm: { box: 7, splash: { r: 4.5, dmg: 900, self: 60 }, proj: 'grenade' },
    up: ['China Beach', 1, 5, 40, { splash: { r: 5, dmg: 1800, self: 60 } }] },
  { id: 'zm_law', name: 'M72 LAW', cls: 'shotgun', model: 'gun-rocketlauncher', rpm: 60, mode: 'semi', mag: 1, reserve: 20, dmg: 100, scale: 0.75, sfx: ['model12', 0.6], zm: { box: 7, splash: { r: 5, dmg: 1200, self: 75 }, proj: 'rocket' },
    up: ['M72 Anarchy', 1, 5, 40, { splash: { r: 5.5, dmg: 2400, self: 75 } }] },
  // ---- wonder weapons
  { id: 'zm_raygun', name: 'Ray Gun', cls: 'pistol', model: 'gun-revolver-4', rpm: 181, mode: 'semi', mag: 20, reserve: 160, dmg: 1000, head: 1, scale: 0.15, sfx: ['ppq', 0.6], zm: { box: 5, splash: { r: 2.4, dmg: 300, self: 25 }, proj: 'ray' },
    up: ["Porter's X2 Ray Gun", 1.5, 40, 200, { splash: { r: 3, dmg: 1000, self: 25 }, proj: 'ray2' }] },
  { id: 'zm_thunder', name: 'Thunder Cannon', cls: 'shotgun', model: 'gun-shortcannon', rpm: 50, mode: 'semi', mag: 2, reserve: 12, dmg: 0, scale: 0.8, sfx: ['model12', 0.45], zm: { box: 2, thunder: { range: 15, cos: 0.82 } },
    up: ['Zeus Cannon', 1, 4, 24, { thunder: { range: 18, cos: 0.78 } }] },
];

/** Gun recordings for each zombies weapon (merged into the audio's table: the sim mustn't import audio). */
export const ZM_SFX: Record<string, { src: string; rate: number; vol: number }> = {};
/** Ids of the weapons the box can give (with weights). */
export const BOX_POOL: Array<[string, number]> = [];
export const ZM_WEAPONS: ZWeaponDef[] = [];

for (const s of SPECS) {
  const b = BASE[s.cls];
  const make = (id: string, name: string, mul: number, mag: number, reserve: number, zm: ZWeaponExtra): ZWeaponDef => ({
    id,
    name,
    cls: s.cls,
    model: s.model,
    rpm: s.rpm,
    mode: s.mode,
    mag,
    reserve,
    reload: s.reload ?? b.reload!,
    reloadEmpty: (s.reload ?? b.reload!) * 1.2,
    ads: b.ads!,
    // Little falloff in zombies: a zombie gun hits as hard across a room.
    damage: [
      [30, Math.round(s.dmg * mul)],
      [999, Math.round(s.dmg * mul * 0.8)],
    ],
    head: s.head ?? 1.5,
    limb: 0.9,
    pellets: s.pellets,
    hip: s.hip ?? b.hip!,
    adsSpread: b.adsSpread!,
    move: s.move ?? b.move!,
    recoilV: b.recoilV!,
    recoilH: b.recoilH!,
    zoom: s.zoom ?? b.zoom!,
    sprintOut: b.sprintOut!,
    slot: s.cls === 'pistol' ? 'secondary' : 'primary',
    scoped: s.scoped,
    scale: s.scale,
    zm,
  });
  const base = make(s.id, s.name, 1, s.mag, s.reserve, { ...s.zm, pap: s.up ? `${s.id}_up` : undefined });
  ZM_WEAPONS.push(base);
  ZM_SFX[s.id] = { src: s.sfx[0], rate: s.sfx[1], vol: 1 };
  if (s.zm.box) BOX_POOL.push([s.id, s.zm.box]);
  if (s.up) {
    const [name, mul, mag, reserve, extra] = s.up;
    const up = make(`${s.id}_up`, name, mul, mag, reserve, { ...s.zm, ...extra, upgraded: true, pap: undefined, box: 0, startReserve: undefined });
    // Upgraded guns also fire a touch faster and reload quicker.
    up.rpm = Math.round(up.rpm * 1.1);
    up.reload *= 0.9;
    up.reloadEmpty *= 0.9;
    ZM_WEAPONS.push(up);
    ZM_SFX[up.id] = { src: s.sfx[0], rate: s.sfx[1] * 0.92, vol: 1.05 };
  }
}
// An empty hand (your second slot before you buy a gun; the Pack-a-Punch holding your only one).
ZM_WEAPONS.push({ ...ZM_WEAPONS[0]!, id: 'zm_empty', name: 'None', model: '', mag: 0, reserve: 0, damage: [[999, 0]], zm: {} });
for (const w of ZM_WEAPONS) WEAPON[w.id] = w;

export const zdef = (id: string): ZWeaponDef | undefined => (WEAPON[id] as ZWeaponDef | undefined)?.zm ? (WEAPON[id] as ZWeaponDef) : undefined;

/** Every model the zombies mode can show (preloaded with the map). */
export const ZM_MODELS = [...new Set(ZM_WEAPONS.map((w) => w.model)), 'zombie-male', 'zombie-female', 'hellhound'];

// ---------------------------------------------------------------- perks

export type ZPerk = 'jug' | 'revive' | 'speed' | 'dtap';
export const ZPERKS: Record<ZPerk, { name: string; price: number; color: string; desc: string; jingle: number[] }> = {
  jug: { name: 'Iron Brew', price: 2500, color: '#d2232a', desc: 'Take far more hits before going down.', jingle: [62, 66, 69, 74, 69, 66, 62] },
  revive: { name: 'Second Wind', price: 1500, color: '#2f7fe0', desc: 'Revive team-mates faster. Solo: get back up on your own (3 times).', jingle: [67, 71, 74, 79, 74, 71] },
  speed: { name: 'Quickdraw Cola', price: 3000, color: '#23b04a', desc: 'Reload twice as fast.', jingle: [72, 74, 76, 79, 76, 74, 72] },
  dtap: { name: 'Twin Tap Root Beer', price: 2000, color: '#e8a21c', desc: 'Fire a third faster.', jingle: [60, 64, 67, 72, 67, 64] },
};
export const ZPERK_LIST = Object.keys(ZPERKS) as ZPerk[];

// ---------------------------------------------------------------- power-ups

export type PowerUp = 'maxammo' | 'insta' | 'double' | 'nuke' | 'carpenter' | 'firesale';
export const POWERUPS: Record<PowerUp, { name: string; dur: number }> = {
  maxammo: { name: 'Max Ammo', dur: 0 },
  insta: { name: 'Insta-Kill', dur: 30 },
  double: { name: 'Double Points', dur: 30 },
  nuke: { name: 'Kaboom', dur: 0 },
  carpenter: { name: 'Carpenter', dur: 0 },
  firesale: { name: 'Fire Sale', dur: 30 },
};
export const POWERUP_LIST = Object.keys(POWERUPS) as PowerUp[];
