import type { Abilities, CardDefinition, CardType, ModelSpec, ProjectileKind, Rarity, SpellSpec, Speed, Targets } from './types';

/**
 * The Crownfall roster: every role from the classic real-time card battler, with
 * original names for the trademark-y ones and a real 3D model per card (Quaternius
 * + Kenney CC0 packs, see assets/arena/LICENSES.md). Stats are tournament-level.
 */

interface UnitOpts {
  hp: number;
  damage?: number;
  hitSpeed?: number;
  firstHit?: number;
  speed?: Speed | 'none';
  range?: number;
  sight?: number;
  count?: number;
  targets?: Targets;
  flying?: boolean;
  radius?: number;
  mass?: number;
  projectile?: ProjectileKind;
  lifetime?: number;
  deployTime?: number;
  abilities?: Abilities;
  squad?: CardDefinition['squad'];
}

const ALL: CardDefinition[] = [];
const TOKEN_IDS = new Set<string>();

function unit(type: CardType, id: string, name: string, rarity: Rarity, cost: number, blurb: string, o: UnitOpts, visual: ModelSpec): CardDefinition {
  const ranged = (o.range ?? 0.8) > 1.6;
  const card: CardDefinition = {
    id,
    name,
    rarity,
    type,
    cost,
    blurb,
    hp: o.hp,
    damage: o.damage ?? 0,
    hitSpeed: o.hitSpeed ?? 1.2,
    firstHit: o.firstHit ?? Math.min(0.6, (o.hitSpeed ?? 1.2) * 0.45),
    speed: o.speed ?? (type === 'building' ? 'none' : 'medium'),
    range: o.range ?? 0.8,
    sight: o.sight ?? (type === 'building' ? Math.max(o.range ?? 0.8, 5.5) : Math.max(5.5, (o.range ?? 0.8) + 0.5)),
    count: o.count ?? 1,
    targets: o.targets ?? 'ground',
    flying: o.flying ?? false,
    radius: o.radius ?? (type === 'building' ? 0.9 : 0.45),
    mass: o.mass ?? 4,
    projectile: o.projectile ?? (ranged ? 'arrow' : undefined),
    lifetime: o.lifetime,
    deployTime: o.deployTime ?? 1,
    abilities: o.abilities ?? {},
    visual,
    squad: o.squad,
  };
  ALL.push(card);
  return card;
}
const troop = (id: string, name: string, rarity: Rarity, cost: number, blurb: string, o: UnitOpts, v: ModelSpec) => unit('troop', id, name, rarity, cost, blurb, o, v);
const building = (id: string, name: string, rarity: Rarity, cost: number, blurb: string, o: UnitOpts, v: ModelSpec) => unit('building', id, name, rarity, cost, blurb, { lifetime: 30, mass: 100, ...o }, v);
/** Spawned-only units (not in the collection). */
const token = (id: string, name: string, o: UnitOpts, v: ModelSpec) => {
  TOKEN_IDS.add(id);
  return unit('troop', id, name, 'Common', 0, '', o, v);
};
function spell(id: string, name: string, rarity: Rarity, cost: number, blurb: string, s: SpellSpec, v: ModelSpec): CardDefinition {
  const card: CardDefinition = {
    id, name, rarity, type: 'spell', cost, blurb,
    hp: 1, damage: s.damage, hitSpeed: 1, firstHit: 0, speed: 'none', range: s.radius, sight: 0, count: 1,
    targets: 'all', flying: false, radius: s.radius, mass: 0, deployTime: 0, abilities: {}, spell: s, visual: v,
  };
  ALL.push(card);
  return card;
}

// Common props.
const SWORD = { model: 'p-mini-weapon-sword', height: 0.55, at: 'hand' as const };
const SPEAR = { model: 'p-mini-weapon-spear', height: 0.9, at: 'hand' as const };
const BOMB = { model: 'p-tower-weapon-ammo-cannonball', height: 0.35, at: 'hand' as const };
const AXE = { model: 'proc:axe', height: 0.6, at: 'hand' as const };
const BOW = { model: 'proc:bow', height: 0.7, at: 'hand' as const };
const STAFF = { model: 'proc:staff', height: 1, at: 'hand' as const };
const GUN = { model: 'proc:gun', height: 0.5, at: 'hand' as const };
const CROWN = { model: 'proc:crown', height: 0.25, at: 'head' as const };

// ============================================================================ troops

troop('knight', 'Knight', 'Common', 3, 'Sturdy sword-swinger. Cheap mini-tank.', { hp: 1766, damage: 202, hitSpeed: 1.2 }, { model: 'r-warrior', height: 1.25 });
troop('archers', 'Archers', 'Common', 3, 'A pair of sharp-eyed archers. Hits air and ground.', { hp: 304, damage: 107, hitSpeed: 0.9, range: 5, targets: 'all', count: 2, projectile: 'arrow' }, { model: 'r-ranger', height: 1.1 });
troop('goblins', 'Goblins', 'Common', 2, 'Four nimble goblins with knives.', { hp: 202, damage: 120, hitSpeed: 1.1, speed: 'veryFast', count: 4, radius: 0.35 }, { model: 'c-goblin-male', height: 0.85, props: [SWORD] });
troop('spear-goblins', 'Spear Goblins', 'Common', 2, 'Three goblins hurling spears from range.', { hp: 133, damage: 81, hitSpeed: 1.7, speed: 'veryFast', range: 5, targets: 'all', count: 3, radius: 0.35, projectile: 'spear' }, { model: 'c-goblin-female', height: 0.85, props: [SPEAR] });
troop('bomber', 'Bomber', 'Common', 2, 'Lobs bombs that splash ground troops.', { hp: 332, damage: 222, hitSpeed: 1.8, range: 4.5, projectile: 'bomb', abilities: { splash: 1.5 } }, { model: 'k-skeleton', height: 0.95, props: [BOMB] });
troop('skeletons', 'Skeletons', 'Common', 1, 'Three rattling bone fighters. Great distraction.', { hp: 81, damage: 81, hitSpeed: 1, speed: 'fast', count: 3, radius: 0.3, mass: 1 }, { model: 'k-skeleton', height: 0.75, props: [SWORD] });
troop('imps', 'Imps', 'Common', 3, 'Three winged imps that swoop on anything.', { hp: 252, damage: 107, hitSpeed: 1, speed: 'fast', range: 1.6, targets: 'all', flying: true, count: 3, radius: 0.4, projectile: 'magic' }, { model: 'm-fly-demon', height: 0.9 });
troop('imp-horde', 'Imp Horde', 'Common', 5, 'Six imps. A swarm in the sky.', { hp: 252, damage: 107, hitSpeed: 1, speed: 'fast', range: 1.6, targets: 'all', flying: true, count: 6, radius: 0.4, projectile: 'magic' }, { model: 'm-fly-demon', height: 0.9, tint: { hue: 0.08 } });
troop('barbarians', 'Barbarians', 'Common', 5, 'Five fierce raiders with blades.', { hp: 670, damage: 192, hitSpeed: 1.4, count: 5 }, { model: 'c-viking-male', height: 1.15, props: [SWORD] });
troop('elite-barbarians', 'Elite Barbarians', 'Common', 6, 'Two very fast, very angry raiders.', { hp: 1341, damage: 384, hitSpeed: 1.4, speed: 'veryFast', count: 2 }, { model: 'c-viking-female', height: 1.25, tint: { color: '#ffd0c0' }, props: [AXE] });
troop('siege-giant', 'Siege Giant', 'Common', 6, 'Carries a cannon. Shells buildings from range.', { hp: 3164, damage: 307, hitSpeed: 1.7, speed: 'slow', range: 5, targets: 'buildings', radius: 0.75, mass: 18, projectile: 'cannonball' }, { model: 'm-big-bluedemon', height: 2.1, props: [{ model: 'p-tower-weapon-cannon', height: 0.8, at: 'back' }] });
troop('rascals', 'Rascals', 'Common', 5, 'One tough kid and two slingshot sisters.', { hp: 1940, damage: 133, hitSpeed: 1.5, squad: [{ card: 'rascal-girl', count: 2 }] }, { model: 'c-casual2-male', height: 1.2 });
token('rascal-girl', 'Rascal Girl', { hp: 261, damage: 133, hitSpeed: 1, range: 5, targets: 'all', projectile: 'shot' }, { model: 'c-casual-female', height: 1.05, props: [{ model: 'proc:slingshot', height: 0.35, at: 'hand' }] });
troop('firecracker', 'Firecracker', 'Common', 3, 'Fires bursting rockets — recoils with every shot.', { hp: 304, damage: 210, hitSpeed: 3, range: 6, targets: 'all', projectile: 'firework', abilities: { splash: 2 } }, { model: 'c-kimono-female', height: 1.05, props: [{ model: 'proc:launcher', height: 0.6, at: 'back' }] });
troop('shield-recruits', 'Shield Recruits', 'Common', 7, 'Six shielded soldiers — split them across both lanes.', { hp: 552, damage: 133, hitSpeed: 1.3, count: 6, abilities: { shield: 240 } }, { model: 'c-bluesoldier-male', height: 1.15, props: [SPEAR, { model: 'p-mini-shield-rectangle', height: 0.5, at: 'back' }] });
troop('bone-balloon', 'Bone Balloon', 'Common', 3, 'A barrel of skeletons under a balloon. Pops on buildings.', { hp: 532, damage: 133, speed: 'medium', targets: 'buildings', flying: true, abilities: { kamikaze: true, deathDamage: { damage: 133, radius: 1.5 }, deathSpawn: { card: 'skeletons', count: 7 } } }, { model: 'p-mini-barrel', height: 0.8, props: [{ model: 'proc:balloon', height: 1.3, at: 'offset', offset: [0, 1.2, 0] }] });
troop('bone-drakes', 'Bone Drakes', 'Common', 4, 'Two skeletal drakes spitting splash fire.', { hp: 440, damage: 133, hitSpeed: 1.9, speed: 'fast', range: 3.5, targets: 'all', flying: true, count: 2, projectile: 'fireball', abilities: { splash: 1 } }, { model: 'm-fly-dragon', height: 1.1, tint: { sat: -0.8, light: 0.25 } });
troop('goblin-gang', 'Goblin Gang', 'Common', 3, 'Three knife goblins and three spear goblins.', { hp: 202, damage: 120, hitSpeed: 1.1, speed: 'veryFast', count: 3, radius: 0.35, squad: [{ card: 'spear-goblins', count: 3 }] }, { model: 'c-goblin-male', height: 0.85, props: [SWORD] });
troop('buzz-bees', 'Buzz Bees', 'Common', 2, 'Five fast stingers. Fragile but furious.', { hp: 81, damage: 81, hitSpeed: 1.3, speed: 'veryFast', range: 1.2, targets: 'all', flying: true, count: 5, radius: 0.3, mass: 1 }, { model: 'm-fly-armabee', height: 0.6 });
troop('frost-spirit', 'Frost Spirit', 'Common', 1, 'Leaps in and freezes a crowd.', { hp: 209, damage: 91, speed: 'veryFast', range: 2.5, targets: 'all', radius: 0.35, abilities: { kamikaze: true, splash: 1.5, stun: 1.1 }, projectile: 'iceball' }, { model: 'm-blob-greenblob', height: 0.6, tint: { hue: 0.22, sat: 0.3, light: 0.25, emissive: '#66e0ff', emissiveIntensity: 0.25 } });
troop('fire-spirit', 'Fire Spirit', 'Common', 1, 'Leaps in and explodes in flames.', { hp: 230, damage: 207, speed: 'veryFast', range: 2.5, targets: 'all', radius: 0.35, abilities: { kamikaze: true, splash: 2.3 }, projectile: 'fireball' }, { model: 'm-blob-greenspikyblob', height: 0.65, tint: { hue: -0.25, sat: 0.4, emissive: '#ff6a1a', emissiveIntensity: 0.35 } });
troop('spark-spirit', 'Spark Spirit', 'Common', 1, 'Leaps in and chain-zaps up to nine enemies.', { hp: 230, damage: 99, speed: 'veryFast', range: 2.5, targets: 'all', radius: 0.35, abilities: { kamikaze: true, splash: 0.6, chain: 8, stun: 0.5 }, projectile: 'zap' }, { model: 'm-blob-alien', height: 0.6, tint: { hue: 0.35, sat: 0.4, light: 0.15, emissive: '#7fe3ff', emissiveIntensity: 0.3 } });
troop('berserker', 'Berserker', 'Common', 2, 'Swings non-stop. Cheap and relentless.', { hp: 900, damage: 100, hitSpeed: 0.6, speed: 'fast' }, { model: 'c-viking-female', height: 1.1, props: [AXE] });

troop('giant', 'Giant', 'Rare', 5, 'Slow, huge, and only cares about buildings.', { hp: 4091, damage: 253, hitSpeed: 1.5, speed: 'slow', targets: 'buildings', radius: 0.8, mass: 18 }, { model: 'm-big-yeti', height: 2.4 });
troop('musketeer', 'Musketeer', 'Rare', 4, 'Long-range sharpshooter. Air and ground.', { hp: 721, damage: 218, hitSpeed: 1, range: 6, targets: 'all', projectile: 'shot' }, { model: 'c-pirate-female', height: 1.15, props: [GUN] });
troop('musketeer-trio', 'Musketeer Trio', 'Rare', 9, 'Three sharpshooters. Expensive, devastating.', { hp: 721, damage: 218, hitSpeed: 1, range: 6, targets: 'all', count: 3, projectile: 'shot' }, { model: 'c-pirate-female', height: 1.15, tint: { hue: 0.55 }, props: [GUN] });
troop('mini-titan', 'Mini Titan', 'Rare', 4, 'Small armoured brawler with a huge punch.', { hp: 1361, damage: 720, hitSpeed: 1.6, speed: 'fast' }, { model: 'c-knight-male', height: 1.15, tint: { color: '#a8c8ff' }, props: [{ model: 'p-mini-weapon-sword', height: 0.7, at: 'hand' }] });
troop('valkyrie', 'Valkyrie', 'Rare', 4, 'Spins her axe — hits everything around her.', { hp: 1908, damage: 267, hitSpeed: 1.5, abilities: { splash: 2 } }, { model: 'c-viking-female', height: 1.25, props: [AXE] });
troop('bull-rider', 'Bull Rider', 'Rare', 4, 'Charges straight at buildings and leaps the river.', { hp: 1696, damage: 318, hitSpeed: 1.6, speed: 'veryFast', targets: 'buildings', radius: 0.6, mass: 8, abilities: { riverJump: true } }, { model: 'c-viking-male', height: 1.05, mount: { model: 'a-bull', height: 1.2, seat: 0.95 }, props: [{ model: 'proc:hammer', height: 0.7, at: 'hand' }] });
troop('wizard', 'Wizard', 'Rare', 5, 'Hurls fireballs that splash groups.', { hp: 721, damage: 281, hitSpeed: 1.4, range: 5.5, targets: 'all', projectile: 'fireball', abilities: { splash: 1.5 } }, { model: 'r-wizard', height: 1.25 });
troop('battle-ram', 'Battle Ram', 'Rare', 4, 'Two raiders charge a log into buildings.', { hp: 967, damage: 286, speed: 'fast', targets: 'buildings', radius: 0.7, mass: 10, abilities: { charge: 2, kamikaze: true, deathSpawn: { card: 'barbarians', count: 2 } } }, { model: 'proc:ram', height: 1.1 });
troop('frost-golem', 'Frost Golem', 'Rare', 2, 'Tough little iceberg. Chills everything when it melts.', { hp: 1197, damage: 84, hitSpeed: 2.5, speed: 'slow', targets: 'buildings', radius: 0.6, mass: 12, abilities: { deathDamage: { damage: 84, radius: 2 }, deathSlow: true } }, { model: 'm-big-yeti', height: 1.4, tint: { hue: 0.04, sat: 0.2, light: 0.1, emissive: '#bff2ff', emissiveIntensity: 0.15 } });
troop('big-imp', 'Big Imp', 'Rare', 3, 'A chunky flying imp that hits hard.', { hp: 837, damage: 311, hitSpeed: 1.6, range: 1.6, targets: 'all', flying: true, radius: 0.55, mass: 6 }, { model: 'm-fly-ghost', height: 1.25 });
troop('dart-goblin', 'Dart Goblin', 'Rare', 3, 'Quick-firing blowgun with huge range.', { hp: 260, damage: 156, hitSpeed: 1.1, speed: 'veryFast', range: 6.5, targets: 'all', radius: 0.35, projectile: 'dart' }, { model: 'c-goblin-male', height: 0.9, tint: { hue: 0.1 }, props: [{ model: 'proc:blowgun', height: 0.6, at: 'hand' }] });
troop('gyrocopter', 'Gyrocopter', 'Rare', 4, 'A flying gun platform with long range.', { hp: 614, damage: 171, hitSpeed: 1.1, speed: 'fast', range: 6, targets: 'all', flying: true, radius: 0.6, projectile: 'bolt' }, { model: 'p-tower-enemy-ufo-a', height: 0.8 });
troop('zap-bots', 'Zap Bots', 'Rare', 4, 'Three bots whose zaps stun on every hit.', { hp: 529, damage: 133, hitSpeed: 2.1, range: 4.5, targets: 'all', count: 3, projectile: 'zap', abilities: { stun: 0.5 } }, { model: 'm-blob-alien', height: 0.85, tint: { hue: 0.4, sat: 0.3, emissive: '#ffe14d', emissiveIntensity: 0.15 } });
troop('wolf-pack', 'Wolf Pack', 'Rare', 5, 'Four wolves that sprint to buildings and leap the river.', { hp: 837, damage: 74, hitSpeed: 1.2, speed: 'veryFast', targets: 'buildings', count: 4, radius: 0.45, abilities: { riverJump: true } }, { model: 'a-wolf', height: 0.85 });
troop('heal-spirit', 'Heal Spirit', 'Rare', 1, 'Leaps in and heals your troops.', { hp: 191, damage: 109, speed: 'veryFast', range: 2.5, targets: 'all', radius: 0.35, abilities: { kamikaze: true, splash: 2.5, healAura: 400 }, projectile: 'heal' }, { model: 'm-blob-pinkblob', height: 0.6, tint: { hue: 0.12, light: 0.15, emissive: '#ffe48a', emissiveIntensity: 0.3 } });
troop('essence-golem', 'Essence Golem', 'Rare', 3, 'Splits in two, then four, when defeated.', { hp: 1260, damage: 211, hitSpeed: 1.3, targets: 'buildings', radius: 0.7, mass: 10, abilities: { deathSpawn: { card: 'essence-golemite', count: 2 } } }, { model: 'm-blob-pinkblob', height: 1.4, tint: { emissive: '#ff4fd8', emissiveIntensity: 0.15 } });
token('essence-golemite', 'Essence Golemite', { hp: 630, damage: 106, hitSpeed: 1.3, speed: 'fast', targets: 'buildings', radius: 0.5, abilities: { deathSpawn: { card: 'essence-blob', count: 2 } } }, { model: 'm-blob-pinkblob', height: 0.9, tint: { emissive: '#ff4fd8', emissiveIntensity: 0.15 } });
token('essence-blob', 'Essence Blob', { hp: 315, damage: 53, hitSpeed: 1.3, speed: 'veryFast', targets: 'buildings', radius: 0.35 }, { model: 'm-blob-pinkblob', height: 0.55, tint: { emissive: '#ff4fd8', emissiveIntensity: 0.15 } });
troop('war-cleric', 'War Cleric', 'Rare', 4, 'Heals nearby troops while she fights.', { hp: 1717, damage: 148, hitSpeed: 1.5, abilities: { healAura: 48 } }, { model: 'r-cleric', height: 1.25 });
troop('goblin-demolisher', 'Goblin Demolisher', 'Rare', 4, 'Throws bombs, then explodes when beaten.', { hp: 1300, damage: 240, hitSpeed: 2, range: 5, projectile: 'bomb', abilities: { splash: 1.5, deathDamage: { damage: 350, radius: 2 } } }, { model: 'c-goblin-male', height: 1.15, tint: { color: '#c9b39a' }, props: [BOMB] });
troop('sneaky-bush', 'Sneaky Bush', 'Rare', 2, 'Two goblins sneak to a tower hidden in a bush.', { hp: 99, damage: 0, targets: 'buildings', radius: 0.6, abilities: { invisible: true, kamikaze: true, deathSpawn: { card: 'goblins', count: 2 } } }, { model: 'nature:plant_bushLarge', height: 1, tint: { color: '#c4ff86' } });

troop('iron-titan', 'Iron Titan', 'Epic', 7, 'A walking fortress that deletes whatever it hits.', { hp: 3760, damage: 816, hitSpeed: 1.8, speed: 'slow', radius: 0.75, mass: 16 }, { model: 'c-knight-male', height: 2, tint: { color: '#8a7cc8' }, props: [{ model: 'p-mini-weapon-sword', height: 1.2, at: 'hand' }] });
troop('drakeling', 'Drakeling', 'Epic', 4, 'A young flying drake with splash fire.', { hp: 1152, damage: 161, hitSpeed: 1.5, speed: 'fast', range: 3.5, targets: 'all', flying: true, radius: 0.6, mass: 6, projectile: 'fireball', abilities: { splash: 1.5 } }, { model: 'm-fly-dragon', height: 1.35 });
troop('prince', 'Prince', 'Epic', 5, 'Charges with his lance for double damage.', { hp: 1920, damage: 392, hitSpeed: 1.4, radius: 0.6, mass: 8, abilities: { charge: 2.5 } }, { model: 'c-knight-golden-male', height: 1.1, mount: { model: 'a-horse', height: 1.45, seat: 1.05 }, props: [{ model: 'p-mini-weapon-spear', height: 1.2, at: 'hand' }] });
troop('shadow-prince', 'Shadow Prince', 'Epic', 4, 'Shielded charger with a splash mace.', { hp: 1200, damage: 248, hitSpeed: 1.3, radius: 0.6, mass: 8, abilities: { charge: 2.5, shield: 240, splash: 1.1 } }, { model: 'c-knight-male', height: 1.1, tint: { color: '#6b5a8a' }, mount: { model: 'a-horse-white', height: 1.45, seat: 1.05, tint: { color: '#4a4560' } }, props: [{ model: 'proc:mace', height: 0.7, at: 'hand' }] });
troop('witch', 'Witch', 'Epic', 5, 'Summons skeletons and throws splash magic.', { hp: 838, damage: 134, hitSpeed: 1.1, range: 5, targets: 'all', projectile: 'magic', abilities: { splash: 1, spawn: { card: 'skeletons', count: 3, every: 7, first: 1 } } }, { model: 'c-witch', height: 1.25, props: [STAFF] });
troop('bomb-balloon', 'Bomb Balloon', 'Epic', 5, 'Floats to buildings and drops heavy bombs.', { hp: 1679, damage: 640, hitSpeed: 3, speed: 'medium', targets: 'buildings', flying: true, radius: 0.8, mass: 10, abilities: { deathDamage: { damage: 272, radius: 2 } } }, { model: 'proc:bomb-balloon', height: 2 });
troop('stone-golem', 'Stone Golem', 'Epic', 8, 'Massive and slow. Breaks into two golemites.', { hp: 5984, damage: 359, hitSpeed: 2.5, speed: 'slow', targets: 'buildings', radius: 0.95, mass: 30, abilities: { deathDamage: { damage: 259, radius: 2 }, deathSpawn: { card: 'golemite', count: 2 } } }, { model: 'm-big-yeti', height: 2.8, tint: { color: '#9a9488', sat: -0.6 } });
token('golemite', 'Golemite', { hp: 1213, damage: 72, hitSpeed: 2.5, speed: 'slow', targets: 'buildings', radius: 0.6, mass: 12, abilities: { deathDamage: { damage: 51, radius: 1.5 } } }, { model: 'm-big-yeti', height: 1.35, tint: { color: '#9a9488', sat: -0.6 } });
troop('bone-legion', 'Bone Legion', 'Epic', 3, 'Fifteen skeletons. Shreds single targets.', { hp: 81, damage: 81, hitSpeed: 1, speed: 'fast', count: 15, radius: 0.3, mass: 1 }, { model: 'k-skeleton', height: 0.75, props: [SWORD] });
troop('giant-skeleton', 'Giant Skeleton', 'Epic', 6, 'Drops a giant bomb when he falls.', { hp: 3360, damage: 214, hitSpeed: 1.4, radius: 0.8, mass: 16, abilities: { deathDamage: { damage: 1010, radius: 3 } } }, { model: 'k-skeleton', height: 2.1, props: [{ model: 'p-tower-weapon-ammo-cannonball', height: 0.8, at: 'back' }] });
troop('bowler', 'Bowler', 'Epic', 5, 'Rolls boulders that knock back everything in line.', { hp: 2081, damage: 289, hitSpeed: 2.5, speed: 'slow', range: 4, radius: 0.7, mass: 12, projectile: 'boulder', abilities: { pierce: 7.5, knockback: 1 } }, { model: 'm-big-birb', height: 1.8, props: [{ model: 'p-tower-weapon-ammo-boulder', height: 0.6, at: 'hand' }] });
troop('executioner', 'Executioner', 'Epic', 5, 'Throws an axe that slices out and back.', { hp: 1210, damage: 168, hitSpeed: 2.4, range: 4.5, targets: 'all', radius: 0.6, projectile: 'axe', abilities: { pierce: 6 } }, { model: 'm-big-orc', height: 1.6 });
troop('cannon-cart', 'Cannon Cart', 'Epic', 5, 'A fast cannon on wheels, shielded by its cart.', { hp: 1024, damage: 265, hitSpeed: 0.9, speed: 'fast', range: 5.5, projectile: 'cannonball', radius: 0.6, abilities: { shield: 1024 } }, { model: 'proc:cart', height: 1.1 });
troop('hunter', 'Hunter', 'Epic', 4, 'Shotgun blast — brutal up close.', { hp: 817, damage: 300, hitSpeed: 2.2, range: 4, targets: 'all', projectile: 'shot', abilities: { splash: 1.2 } }, { model: 'c-cowboy-male', height: 1.2, props: [GUN] });
troop('guards', 'Guards', 'Epic', 3, 'Three skeleton guards behind shields.', { hp: 90, damage: 90, hitSpeed: 1, speed: 'fast', count: 3, radius: 0.35, abilities: { shield: 199 } }, { model: 'k-skeleton', height: 0.85, props: [SPEAR, { model: 'p-mini-shield-round', height: 0.45, at: 'back' }] });
troop('wall-bombers', 'Wall Bombers', 'Epic', 2, 'Two sprinting skeletons with bombs for buildings.', { hp: 331, damage: 391, speed: 'veryFast', targets: 'buildings', count: 2, radius: 0.35, abilities: { kamikaze: true, splash: 1.5 } }, { model: 'k-skeleton', height: 0.8, props: [{ model: 'p-mini-barrel', height: 0.5, at: 'hand' }] });
troop('storm-drake', 'Storm Drake', 'Epic', 5, 'Breath that chains through three targets and stuns.', { hp: 950, damage: 192, hitSpeed: 2.1, range: 3.5, targets: 'all', flying: true, radius: 0.7, mass: 7, projectile: 'zap', abilities: { chain: 2, stun: 0.5 } }, { model: 'm-fly-dragon-evolved', height: 1.6, tint: { hue: 0.5, emissive: '#3fd8ff', emissiveIntensity: 0.12 } });
troop('goblin-hauler', 'Goblin Hauler', 'Epic', 6, 'Carries two spear goblins straight to buildings.', { hp: 3418, damage: 199, hitSpeed: 1.7, targets: 'buildings', radius: 0.85, mass: 18, abilities: { deathSpawn: { card: 'spear-goblins', count: 2 } } }, { model: 'm-big-orc', height: 2.2, tint: { hue: 0.08 }, props: [{ model: 'c-goblin-female', height: 0.7, at: 'back' }] });
troop('storm-giant', 'Storm Giant', 'Epic', 7, 'Zaps and stuns anything that attacks him.', { hp: 3800, damage: 192, hitSpeed: 1.5, speed: 'slow', targets: 'buildings', radius: 0.85, mass: 20, abilities: { ability: 'reflect' } }, { model: 'm-big-monkroose', height: 2.3, tint: { hue: 0.45, emissive: '#3fd8ff', emissiveIntensity: 0.12 } });
troop('rune-golem', 'Rune Golem', 'Epic', 4, 'Empowers the next friendly troops with runes.', { hp: 2700, damage: 145, hitSpeed: 1.5, targets: 'buildings', radius: 0.8, mass: 16, abilities: { deathRage: true } }, { model: 'm-big-alien', height: 2, tint: { emissive: '#9b4dff', emissiveIntensity: 0.15 } });

troop('frost-mage', 'Frost Mage', 'Legendary', 3, 'Chilling blasts slow everything they touch.', { hp: 688, damage: 75, hitSpeed: 1.7, range: 5.5, targets: 'all', projectile: 'iceball', abilities: { splash: 1, slow: 0.35 } }, { model: 'c-wizard', height: 1.2, tint: { hue: 0.08, light: 0.15, emissive: '#9fe8ff', emissiveIntensity: 0.12 }, props: [STAFF] });
troop('princess', 'Princess', 'Legendary', 3, 'Flaming arrows from extreme range.', { hp: 261, damage: 169, hitSpeed: 3, range: 9, targets: 'all', projectile: 'arrow', abilities: { splash: 2 } }, { model: 'c-elf', height: 1.1, props: [BOW, CROWN] });
troop('miner', 'Miner', 'Legendary', 3, 'Tunnels anywhere on the map and pops up.', { hp: 1210, damage: 193, hitSpeed: 1.2, speed: 'fast', abilities: { burrow: true, buildingBonus: 0.35 } }, { model: 'c-worker-male', height: 1.1, props: [{ model: 'proc:pickaxe', height: 0.7, at: 'hand' }] });
troop('volt-cannon', 'Volt Cannon', 'Legendary', 6, 'Charges up a devastating electric blast.', { hp: 1452, damage: 1331, hitSpeed: 4, firstHit: 3, speed: 'slow', range: 5, radius: 0.7, mass: 12, projectile: 'zap', abilities: { splash: 1.8 } }, { model: 'proc:volt', height: 1.3 });
troop('magma-hound', 'Magma Hound', 'Legendary', 7, 'Flying tank. Bursts into six pups when it dies.', { hp: 3150, damage: 45, hitSpeed: 1.3, speed: 'slow', range: 2, targets: 'buildings', flying: true, radius: 0.95, mass: 20, projectile: 'fireball', abilities: { deathSpawn: { card: 'magma-pup', count: 6 } } }, { model: 'm-fly-hywirl', height: 2, tint: { hue: -0.8, sat: 0.4, emissive: '#ff5a1a', emissiveIntensity: 0.3 } });
token('magma-pup', 'Magma Pup', { hp: 179, damage: 45, hitSpeed: 1.7, range: 1.6, targets: 'all', flying: true, radius: 0.35, projectile: 'fireball' }, { model: 'm-fly-glub', height: 0.6, tint: { hue: -0.7, sat: 0.4, emissive: '#ff5a1a', emissiveIntensity: 0.3 } });
troop('lumberjack', 'Lumberjack', 'Legendary', 4, 'Lightning-fast chops. Drops rage when he falls.', { hp: 1282, damage: 240, hitSpeed: 0.8, speed: 'veryFast', abilities: { deathRage: true } }, { model: 'c-casual2-male', height: 1.15, tint: { color: '#ffb8a0' }, props: [AXE] });
troop('blaze-drake', 'Blaze Drake', 'Legendary', 4, 'A flame beam that heats up the longer it burns.', { hp: 1278, damage: 35, hitSpeed: 0.4, range: 3.5, targets: 'all', flying: true, radius: 0.65, mass: 7, projectile: 'flame', abilities: { ramp: true } }, { model: 'm-fly-dragon-evolved', height: 1.6 });
troop('storm-mage', 'Storm Mage', 'Legendary', 4, 'Twin lightning bolts that stun. Zaps on landing.', { hp: 713, damage: 228, hitSpeed: 1.8, speed: 'fast', range: 5, targets: 'all', projectile: 'zap', abilities: { chain: 1, stun: 0.5 } }, { model: 'c-wizard', height: 1.2, tint: { hue: 0.55, emissive: '#3fd8ff', emissiveIntensity: 0.15 }, props: [STAFF] });
troop('bandit', 'Bandit', 'Legendary', 3, 'Dashes at targets — untouchable mid-dash.', { hp: 906, damage: 193, hitSpeed: 1, speed: 'fast', abilities: { dash: [3.5, 6] } }, { model: 'r-rogue', height: 1.15 });
troop('phantom', 'Phantom', 'Legendary', 3, 'Invisible until it strikes. Splash sword.', { hp: 1210, damage: 261, hitSpeed: 1.8, speed: 'fast', abilities: { invisible: true, splash: 1 } }, { model: 'k-ghost', height: 1.15, props: [SWORD] });
troop('moon-witch', 'Moon Witch', 'Legendary', 4, 'Summons bees and hits hard up close.', { hp: 906, damage: 314, hitSpeed: 1.5, speed: 'fast', abilities: { spawn: { card: 'buzz-bees', count: 2, every: 7, first: 1 }, deathSpawn: { card: 'buzz-bees', count: 1 } } }, { model: 'c-witch', height: 1.3, tint: { color: '#b49cff' }, props: [STAFF] });
troop('colossus-knight', 'Colossus Knight', 'Legendary', 7, 'Lands with a crash and jumps onto enemies.', { hp: 3993, damage: 268, hitSpeed: 1.7, radius: 0.8, mass: 18, abilities: { splash: 1.5, dash: [3.5, 5] } }, { model: 'c-knight-golden-male', height: 1.8, tint: { color: '#7a7a8a' }, props: [{ model: 'proc:mace', height: 0.9, at: 'hand' }] });
troop('stag-rider', 'Stag Rider', 'Legendary', 5, 'Charges buildings while slowing troops.', { hp: 1461, damage: 220, hitSpeed: 1.8, targets: 'buildings', radius: 0.6, mass: 8, abilities: { charge: 2.5, slow: 0.7 } }, { model: 'c-elf', height: 1.05, mount: { model: 'a-stag', height: 1.5, seat: 1.05 } });
troop('arcane-archer', 'Arcane Archer', 'Legendary', 4, 'Magic arrows pierce through everything in line.', { hp: 532, damage: 110, hitSpeed: 1.1, range: 7, targets: 'all', projectile: 'magic', abilities: { pierce: 11 } }, { model: 'c-elf', height: 1.15, tint: { hue: 0.6, emissive: '#9b4dff', emissiveIntensity: 0.12 }, props: [BOW] });
troop('fisherman', 'Fisherman', 'Legendary', 3, 'Hooks enemies and drags them in.', { hp: 922, damage: 192, hitSpeed: 1.3, abilities: { ability: 'getaway' } }, { model: 'c-pirate-male', height: 1.2, props: [{ model: 'proc:hook', height: 0.8, at: 'hand' }] });
troop('hex-witch', 'Hex Witch', 'Legendary', 4, 'Cursed troops she defeats turn into frogs for her.', { hp: 532, damage: 133, hitSpeed: 1.1, range: 5.5, targets: 'all', projectile: 'magic' }, { model: 'c-witch', height: 1.2, tint: { color: '#9bf0a0' }, props: [STAFF] });
token('cursed-frog', 'Cursed Frog', { hp: 520, damage: 52, hitSpeed: 1.5, speed: 'veryFast', targets: 'buildings', radius: 0.45 }, { model: 'm-big-frog', height: 0.8 });
troop('phoenix', 'Phoenix', 'Legendary', 4, 'Explodes when it falls — and is reborn from its egg.', { hp: 1050, damage: 217, hitSpeed: 1, speed: 'fast', range: 1.6, targets: 'all', flying: true, radius: 0.6, abilities: { deathDamage: { damage: 217, radius: 2 }, deathSpawn: { card: 'phoenix-egg', count: 1 } } }, { model: 'm-fly-pigeon', height: 1.2, tint: { hue: 0.35, sat: 0.4, emissive: '#ff6a1a', emissiveIntensity: 0.3 } });
token('phoenix-egg', 'Phoenix Egg', { hp: 198, damage: 0, speed: 'none', radius: 0.45, lifetime: 4.3, abilities: { transform: 'phoenix-reborn' } }, { model: 'proc:egg', height: 0.7 });
token('phoenix-reborn', 'Phoenix', { hp: 1050, damage: 217, hitSpeed: 1, speed: 'fast', range: 1.6, targets: 'all', flying: true, radius: 0.6 }, { model: 'm-fly-pigeon', height: 1.2, tint: { hue: 0.35, sat: 0.4, emissive: '#ff6a1a', emissiveIntensity: 0.3 } });
troop('goblin-mech', 'Goblin Mech', 'Legendary', 5, 'A goblin war machine that fires rockets.', { hp: 2600, damage: 220, hitSpeed: 1.2, range: 1.2, radius: 0.8, mass: 16, abilities: { splash: 1 } }, { model: 'm-big-dino', height: 1.9, tint: { color: '#c0d0c8', sat: -0.3 } });
troop('sky-empress', 'Sky Empress', 'Legendary', 6, 'Royal flyer that rains splash attacks.', { hp: 1100, damage: 280, hitSpeed: 1.7, speed: 'fast', range: 3, targets: 'all', flying: true, radius: 0.75, mass: 8, projectile: 'magic', abilities: { splash: 1.3 } }, { model: 'm-fly-alpaking-evolved', height: 1.6 });
troop('ronin', 'Ronin', 'Legendary', 5, 'A wandering swordsman who dashes between foes.', { hp: 1900, damage: 300, hitSpeed: 1.3, speed: 'fast', radius: 0.55, abilities: { splash: 1, dash: [2.5, 5] } }, { model: 'm-big-ninja', height: 1.5 });

troop('gilded-knight', 'Gilded Knight', 'Champion', 4, 'Ability: dash-chains through enemies.', { hp: 1800, damage: 160, hitSpeed: 0.9, abilities: { ability: 'dashChain' } }, { model: 'c-knight-golden-male', height: 1.3, props: [SWORD] });
troop('ranger-queen', 'Ranger Queen', 'Champion', 5, 'Ability: cloaks and fires twice as fast.', { hp: 1000, damage: 225, hitSpeed: 1.2, range: 5, targets: 'all', projectile: 'bolt', abilities: { ability: 'cloak' } }, { model: 'c-ninja-female', height: 1.25, props: [{ model: 'proc:crossbow', height: 0.55, at: 'hand' }, CROWN] });
troop('bone-king', 'Bone King', 'Champion', 4, 'Ability: raises an army from fallen souls.', { hp: 2300, damage: 205, hitSpeed: 1.6, radius: 0.7, mass: 12, abilities: { splash: 1.3, ability: 'soulSummon' } }, { model: 'm-big-orc-skull', height: 1.7, props: [CROWN] });
troop('drill-boss', 'Drill Boss', 'Champion', 4, 'Drill heats up on a target. Ability: bomb + escape.', { hp: 2250, damage: 40, hitSpeed: 0.4, abilities: { ramp: true, ability: 'explosiveEscape' } }, { model: 'c-worker-female', height: 1.35, tint: { color: '#ffd29a' }, props: [{ model: 'proc:pickaxe', height: 0.8, at: 'hand' }] });
troop('monk', 'Monk', 'Champion', 5, 'Ability: reflects projectiles back at the enemy.', { hp: 2000, damage: 140, hitSpeed: 0.8, abilities: { knockback: 0.6, ability: 'reflect' } }, { model: 'r-monk', height: 1.25 });
troop('boy-prince', 'Boy Prince', 'Champion', 3, 'Ability: calls his guardian to the rescue.', { hp: 690, damage: 110, hitSpeed: 1.2, range: 6, targets: 'all', projectile: 'shot', abilities: { ability: 'royalRescue' } }, { model: 'c-casual-male', height: 1, props: [CROWN, GUN] });
token('guardian', 'Guardian', { hp: 1600, damage: 220, hitSpeed: 1.2, speed: 'fast', radius: 0.6, abilities: { knockback: 1 } }, { model: 'c-knight-male', height: 1.4, props: [SWORD] });
troop('patchwork-brute', 'Patchwork Brute', 'Champion', 5, 'A stitched-up monster with a shocking punch.', { hp: 2600, damage: 270, hitSpeed: 1.6, speed: 'slow', radius: 0.75, mass: 16, abilities: { chain: 1, stun: 0.3, ability: 'zapBurst' } }, { model: 'c-zombie-male', height: 1.8, props: [{ model: 'c-goblin-male', height: 0.6, at: 'back' }] });
troop('bandit-boss', 'Bandit Boss', 'Champion', 6, 'Dashes in, and ability: vanishes to escape.', { hp: 2400, damage: 270, hitSpeed: 1, speed: 'fast', radius: 0.6, abilities: { dash: [3, 6], ability: 'getaway' } }, { model: 'c-pirate-male', height: 1.4, tint: { color: '#ffb0b0' }, props: [SWORD] });

// ============================================================================ buildings

building('cannon', 'Cannon', 'Common', 3, 'Defensive cannon. Ground targets only.', { hp: 824, damage: 212, hitSpeed: 0.9, range: 5.5, projectile: 'cannonball' }, { model: 'p-tower-weapon-cannon', height: 1.2, width: 1.5 });
building('mortar', 'Mortar', 'Common', 4, 'Lobs shells across half the arena.', { hp: 1369, damage: 266, hitSpeed: 5, firstHit: 4, range: 11.5, projectile: 'bomb', abilities: { splash: 2 } }, { model: 'p-castle-siege-catapult', height: 1.3, width: 1.6 });
building('tesla', 'Tesla', 'Common', 4, 'Hides underground until enemies come near.', { hp: 1152, damage: 230, hitSpeed: 1.1, range: 5.5, targets: 'all', projectile: 'zap', abilities: { hides: true } }, { model: 'p-tower-weapon-turret', height: 1.4, width: 1.4, tint: { emissive: '#3fd8ff', emissiveIntensity: 0.15 } });
building('goblin-hut', 'Goblin Hut', 'Rare', 5, 'Spawns spear goblins.', { hp: 1100, lifetime: 40, abilities: { spawn: { card: 'spear-goblins', count: 1, every: 4.5, first: 1 } } }, { model: 'proc:hut', height: 1.8 });
building('blaze-tower', 'Blaze Tower', 'Rare', 5, 'Its beam melts tanks the longer it locks on.', { hp: 1749, damage: 41, hitSpeed: 0.4, range: 6, targets: 'all', projectile: 'flame', abilities: { ramp: true } }, { model: 'p-tower-tower-round-crystals', height: 1.7, width: 1.6, tint: { hue: -0.35, emissive: '#ff4a1a', emissiveIntensity: 0.25 } });
building('bomb-tower', 'Bomb Tower', 'Rare', 4, 'Splash bombs. Explodes when destroyed.', { hp: 1356, damage: 222, hitSpeed: 1.8, range: 6, projectile: 'bomb', abilities: { splash: 1.5, deathDamage: { damage: 222, radius: 3 } } }, { model: 'p-tower-tower-round-bottom-a', height: 1.4, width: 1.6, tint: { color: '#c8a0a0' } });
building('barbarian-hut', 'Barbarian Hut', 'Rare', 6, 'Spawns barbarians in pairs.', { hp: 1936, lifetime: 30, abilities: { spawn: { card: 'barbarians', count: 2, every: 14, first: 0.5 }, deathSpawn: { card: 'barbarians', count: 1 } } }, { model: 'proc:longhouse', height: 1.8 });
building('elixir-pump', 'Elixir Pump', 'Rare', 6, 'Pumps out elixir over time.', { hp: 1070, lifetime: 70, abilities: { elixir: 8.5 } }, { model: 'proc:pump', height: 1.6 });
building('tombstone', 'Tombstone', 'Rare', 3, 'Spawns skeletons. Releases more when destroyed.', { hp: 529, lifetime: 30, abilities: { spawn: { card: 'skeletons', count: 2, every: 3.5, first: 1 }, deathSpawn: { card: 'skeletons', count: 4 } } }, { model: 'p-graveyard-gravestone-cross', height: 1.3, width: 1.2 });
building('furnace', 'Furnace', 'Rare', 4, 'Spawns fire spirits.', { hp: 1000, lifetime: 30, abilities: { spawn: { card: 'fire-spirit', count: 1, every: 5, first: 1 } } }, { model: 'proc:furnace', height: 1.5 });
building('goblin-cage', 'Goblin Cage', 'Rare', 4, 'Releases a goblin brawler when destroyed.', { hp: 1024, lifetime: 20, abilities: { deathSpawn: { card: 'goblin-brawler', count: 1 } } }, { model: 'proc:cage', height: 1.5 });
token('goblin-brawler', 'Goblin Brawler', { hp: 1800, damage: 263, hitSpeed: 1.1, speed: 'fast', radius: 0.55 }, { model: 'm-big-orc', height: 1.4, tint: { hue: 0.1 } });
building('crossbow-turret', 'Crossbow Turret', 'Epic', 6, 'Siege weapon that hits towers from your side.', { hp: 1600, damage: 41, hitSpeed: 0.3, range: 11.5, projectile: 'bolt', deployTime: 3.5 }, { model: 'p-tower-weapon-ballista', height: 1.4, width: 1.6 });
building('goblin-burrow', 'Goblin Burrow', 'Epic', 4, 'Digs in anywhere and spews goblins.', { hp: 1000, lifetime: 9, abilities: { burrow: true, spawn: { card: 'goblins', count: 1, every: 3, first: 1 }, deathSpawn: { card: 'goblins', count: 2 }, deathDamage: { damage: 51, radius: 1.5 } } }, { model: 'proc:drill', height: 1.4 });

// ============================================================================ spells

const sp = (model: string, height: number, tint?: ModelSpec['tint']): ModelSpec => ({ model, height, tint });
spell('fireball', 'Fireball', 'Rare', 4, 'A blazing ball that knocks back troops.', { radius: 2.5, damage: 689, towerDamage: 0.3, travel: 'fromKing', knockback: 1, fx: 'fireball' }, sp('proc:fireball', 1));
spell('arrows', 'Arrows', 'Common', 3, 'Three volleys over a wide area.', { radius: 4, damage: 366, towerDamage: 0.25, travel: 'fromKing', waves: 3, fx: 'arrows' }, sp('p-tower-weapon-ammo-arrow', 1));
spell('rocket', 'Rocket', 'Rare', 6, 'Huge damage to a small area.', { radius: 2, damage: 1484, towerDamage: 0.3, travel: 'fromKing', knockback: 1.2, fx: 'rocket' }, sp('p-tower-weapon-ammo-bullet', 1));
spell('zap', 'Zap', 'Common', 2, 'Instant shock that stuns briefly.', { radius: 2.5, damage: 192, towerDamage: 0.3, travel: 'instant', stun: 0.5, fx: 'zap' }, sp('proc:bolt', 1));
spell('rolling-log', 'Rolling Log', 'Legendary', 2, 'Rolls forward, knocking back ground troops.', { radius: 1.95, damage: 290, towerDamage: 0.2, travel: 'roll', rollLength: 10, knockback: 0.8, fx: 'log' }, sp('proc:log', 1));
spell('freeze', 'Freeze', 'Epic', 4, 'Freezes everything in the area.', { radius: 3, damage: 115, towerDamage: 0.3, travel: 'instant', freeze: 4, fx: 'freeze' }, sp('p-tower-detail-crystal', 1, { color: '#9fe8ff', light: 0.15 }));
spell('poison', 'Poison', 'Epic', 4, 'A toxic cloud that eats away at troops.', { radius: 3.5, damage: 728, towerDamage: 0.3, travel: 'instant', duration: 8, slow: 0.15, fx: 'poison' }, sp('p-mini-potion', 1, { color: '#7dff6a' }));
spell('lightning', 'Lightning', 'Epic', 6, 'Strikes the three toughest targets.', { radius: 3.5, damage: 1158, towerDamage: 0.3, travel: 'instant', maxTargets: 3, stun: 0.5, fx: 'lightning' }, sp('proc:bolt', 1));
spell('rage', 'Rage', 'Epic', 2, 'Your troops move and attack faster.', { radius: 5, damage: 120, towerDamage: 0.3, travel: 'instant', duration: 6, rage: 6, fx: 'rage' }, sp('p-mini-potion', 1, { color: '#c77dff' }));
spell('tornado', 'Tornado', 'Epic', 3, 'Drags troops into its centre.', { radius: 5.5, damage: 168, towerDamage: 0.3, travel: 'instant', duration: 1.5, pull: true, fx: 'tornado' }, sp('proc:tornado', 1));
spell('earthquake', 'Earthquake', 'Rare', 3, 'Shakes the ground — wrecks buildings.', { radius: 3.5, damage: 455, towerDamage: 0.35, travel: 'instant', duration: 3, slow: 0.5, buildingBonus: 3.5, fx: 'quake' }, sp('p-mini-rocks', 1));
spell('graveyard', 'Graveyard', 'Legendary', 5, 'Skeletons rise all over the area.', { radius: 4, damage: 0, travel: 'instant', duration: 10, spawn: { card: 'skeletons', count: 13 }, fx: 'graveyard' }, sp('p-graveyard-gravestone-round', 1));
spell('goblin-keg', 'Goblin Keg', 'Epic', 3, 'Flings a barrel of goblins anywhere.', { radius: 1.5, damage: 0, travel: 'fromKing', spawn: { card: 'goblins', count: 3 }, fx: 'barrel' }, sp('p-mini-barrel', 1));
spell('viking-keg', 'Viking Keg', 'Epic', 2, 'Rolls a barrel, then out pops a barbarian.', { radius: 1.3, damage: 241, towerDamage: 0.2, travel: 'roll', rollLength: 6.5, knockback: 0.6, spawn: { card: 'barbarians', count: 1 }, fx: 'barrel' }, sp('p-mini-barrel', 1, { hue: 0.05 }));
spell('giant-snowball', 'Giant Snowball', 'Common', 2, 'Knocks back and slows.', { radius: 2.5, damage: 159, towerDamage: 0.3, travel: 'fromKing', slow: 0.35, knockback: 0.9, fx: 'snowball' }, sp('proc:snowball', 1));
spell('sky-drop', 'Sky Drop', 'Common', 3, 'A crate crashes down and a recruit hops out.', { radius: 3, damage: 437, towerDamage: 0.3, travel: 'drop', spawn: { card: 'shield-recruit', count: 1 }, fx: 'crate' }, sp('p-mini-chest', 1));
token('shield-recruit', 'Shield Recruit', { hp: 552, damage: 133, hitSpeed: 1.3, abilities: { shield: 240 } }, { model: 'c-bluesoldier-male', height: 1.15, props: [SPEAR, { model: 'p-mini-shield-rectangle', height: 0.5, at: 'back' }] });
spell('clone', 'Clone', 'Epic', 3, 'Duplicates your troops (1 hp each).', { radius: 4, damage: 0, travel: 'instant', clone: true, fx: 'clone' }, sp('p-tower-detail-crystal', 1, { color: '#7fe3ff', emissive: '#3fd8ff', emissiveIntensity: 0.3 }));
spell('mirror', 'Mirror', 'Epic', 1, 'Replays your last card (costs one more).', { radius: 1, damage: 0, travel: 'instant', mirror: true, fx: 'mirror' }, sp('p-mini-shield-round', 1, { sat: -1, light: 0.3 }));
spell('void', 'Void', 'Epic', 3, 'Three dark pulses — deadlier on fewer targets.', { radius: 2.5, damage: 720, towerDamage: 0.25, travel: 'instant', duration: 3, fx: 'void' }, sp('proc:void', 1));
spell('vines', 'Vines', 'Epic', 3, 'Grabs three targets — even flyers — and holds them.', { radius: 2.5, damage: 280, towerDamage: 0.3, travel: 'instant', duration: 2.3, maxTargets: 3, stun: 2.3, fx: 'vines' }, sp('nature:plant_flatTall', 1, { color: '#a8ff70' }));
spell('goblin-hex', 'Goblin Hex', 'Epic', 2, 'Curses troops — defeated ones become your goblins.', { radius: 3, damage: 180, towerDamage: 0.3, travel: 'instant', duration: 6, fx: 'curse' }, sp('p-mini-potion', 1, { color: '#b6ff4a' }));

// ============================================================================ exports

export const CARD_MAP = new Map(ALL.map((c) => [c.id, c]));
/** Collectible cards (tokens excluded), troops then buildings then spells. */
export const CARDS: CardDefinition[] = ALL.filter((c) => !TOKEN_IDS.has(c.id));

export function getCard(id: string): CardDefinition {
  const c = CARD_MAP.get(id);
  if (!c) throw new Error(`Unknown card: ${id}`);
  return c;
}

export const RARITY_COLORS: Record<Rarity, [string, string]> = {
  Common: ['#9fb4cc', '#5b7088'],
  Rare: ['#ffb24a', '#d06a12'],
  Epic: ['#d36bff', '#7b2fc0'],
  Legendary: ['#7ef0ff', '#ff6ad5'],
  Champion: ['#ffe066', '#ff8a1a'],
};

export const SPEED_TILES: Record<CardDefinition['speed'], number> = { none: 0, slow: 0.75, medium: 1, fast: 1.5, veryFast: 2 };

export const DEFAULT_DECK = ['knight', 'archers', 'giant', 'fireball', 'imps', 'valkyrie', 'goblin-hut', 'zap'];
export const AI_DECKS: string[][] = [
  ['giant', 'witch', 'mini-titan', 'musketeer', 'drakeling', 'fireball', 'arrows', 'tombstone'],
  ['bull-rider', 'frost-spirit', 'firecracker', 'cannon', 'skeletons', 'rolling-log', 'earthquake', 'knight'],
  ['stone-golem', 'moon-witch', 'drakeling', 'lumberjack', 'tornado', 'lightning', 'big-imp', 'viking-keg'],
  ['siege-giant', 'fisherman', 'hunter', 'spark-spirit', 'phoenix', 'fireball', 'rolling-log', 'goblin-cage'],
  ['prince', 'shadow-prince', 'bandit', 'storm-mage', 'bomb-tower', 'poison', 'zap', 'goblin-gang'],
  ['bomb-balloon', 'magma-hound', 'imps', 'big-imp', 'arrows', 'rage', 'bone-legion', 'gilded-knight'],
  ['colossus-knight', 'iron-titan', 'wizard', 'bone-king', 'freeze', 'goblin-keg', 'blaze-tower', 'heal-spirit'],
];

/** Every model a card needs on the battlefield (spawned tokens included). */
export function modelsFor(cardIds: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const c = CARD_MAP.get(id);
    if (!c) return;
    const add = (m: string) => {
      if (!m.startsWith('proc:')) out.add(m);
    };
    add(c.visual.model);
    for (const p of c.visual.props ?? []) add(p.model);
    if (c.visual.mount) add(c.visual.mount.model);
    const a = c.abilities;
    for (const s of [a.spawn, a.deathSpawn, c.spell?.spawn]) if (s) visit(s.card);
    if (a.transform) visit(a.transform);
    for (const s of c.squad ?? []) visit(s.card);
  };
  for (const id of cardIds) visit(id);
  if ([...seen].includes('hex-witch')) visit('cursed-frog');
  if ([...seen].includes('boy-prince')) visit('guardian');
  if ([...seen].includes('goblin-hex')) visit('goblins');
  return out;
}
