/**
 * Crownfall Arena asset pipeline: converts the CC0 source packs (Quaternius +
 * Kenney, downloaded separately — see client/public/assets/arena/LICENSES.md)
 * into compact GLBs under client/public/assets/arena/models/: unused animations
 * stripped, textures resized to WebP, geometry meshopt-compressed.
 *
 *   node tools/arena-assets.mjs <dir with the unzipped packs>
 *
 * Expected layout inside <dir>: q/chars, q/monsters, q/rpg, q/animals (Quaternius
 * Ultimate Animated Character, Ultimate Monsters, RPG Characters, Ultimate Animated
 * Animals) and kenney/kenney_<pack> (castle-kit, tower-defense-kit, graveyard-kit,
 * mini-dungeon, mini-arena).
 */
import { mkdirSync, existsSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress, meshopt, weld, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const src = resolve(process.argv[2] ?? '.');
const out = resolve('client/public/assets/arena/models');
mkdirSync(out, { recursive: true });

const KEEP_CHAR = ['Idle', 'Walk', 'Run', 'SwordSlash', 'Punch', 'Shoot_OneHanded', 'Death', 'RecieveHit', 'Victory', 'Run_Carry', 'Jump', 'SitDown'];
const KEEP_RPG = ['Idle', 'Walk', 'Run', 'Run_Weapon', 'Sword_Attack', 'Sword_Attack2', 'Staff_Attack', 'Spell1', 'Bow_Shoot', 'Dagger_Attack', 'Attack', 'Attack2', 'Punch', 'Death', 'RecieveHit', 'Idle_Weapon'];
const KEEP_ANIMAL = ['Idle', 'Walk', 'Gallop', 'Attack_Headbutt', 'Attack_Kick', 'Death'];
const KEEP_KENNEY = ['idle', 'walk', 'sprint', 'attack-melee-right', 'attack-melee-left', 'holding-right-shoot', 'holding-right', 'die', 'emote-yes', 'jump'];

const q = (p) => join(src, 'q', p);
const k = (pack, name) => join(src, 'kenney', `kenney_${pack}`, 'Models', 'GLB format', `${name}.glb`);

/** [output name, source file, animations to keep (null = all, [] = none)] */
const jobs = [];
const chars = ['Knight_Male', 'Knight_Golden_Male', 'Knight_Golden_Female', 'Goblin_Male', 'Goblin_Female', 'Viking_Male', 'Viking_Female', 'Witch', 'Wizard', 'Ninja_Male', 'Ninja_Female', 'Ninja_Sand', 'Pirate_Male', 'Pirate_Female', 'BlueSoldier_Male', 'BlueSoldier_Female', 'Soldier_Male', 'Zombie_Male', 'Zombie_Female', 'Elf', 'Cowboy_Male', 'Cowboy_Female', 'Worker_Male', 'Worker_Female', 'Kimono_Female', 'Kimono_Male', 'Chef_Male', 'Casual_Male', 'Casual2_Male', 'Casual_Female', 'Doctor_Male_Old', 'OldClassy_Male', 'Suit_Male'];
for (const c of chars) jobs.push([`c-${c.toLowerCase().replace(/_/g, '-')}`, q(`chars/glTF/${c}.gltf`), KEEP_CHAR]);
for (const c of ['Cleric', 'Monk', 'Ranger', 'Rogue', 'Warrior', 'Wizard']) jobs.push([`r-${c.toLowerCase()}`, q(`rpg/glTF/${c}.gltf`), KEEP_RPG]);
for (const [dir, tag] of [['Big', 'big'], ['Blob', 'blob'], ['Flying', 'fly']]) {
  const names = { Big: ['Alien', 'Birb', 'BlueDemon', 'Bunny', 'Cactoro', 'Demon', 'Dino', 'Fish', 'Frog', 'Monkroose', 'MushroomKing', 'Ninja', 'Orc', 'Orc_Skull', 'Tribal', 'Yeti'], Blob: ['Alien', 'Birb', 'Cactoro', 'Cat', 'Chicken', 'Dog', 'Fish', 'GreenBlob', 'GreenSpikyBlob', 'Mushnub', 'Mushnub_Evolved', 'Ninja', 'Orc', 'Pigeon', 'PinkBlob', 'Wizard', 'Yeti'], Flying: ['Alpaking', 'Alpaking_Evolved', 'Armabee', 'Armabee_Evolved', 'Demon', 'Dragon', 'Dragon_Evolved', 'Ghost', 'Ghost_Skull', 'Glub', 'Glub_Evolved', 'Goleling', 'Goleling_Evolved', 'Hywirl', 'Pigeon', 'Squidle', 'Tribal'] }[dir];
  for (const n of names) jobs.push([`m-${tag}-${n.toLowerCase().replace(/_/g, '-')}`, q(`monsters/${dir}/glTF/${n}.gltf`), null]);
}
for (const a of ['Horse', 'Horse_White', 'Bull', 'Stag', 'Wolf', 'Husky', 'Deer', 'Fox', 'Donkey']) jobs.push([`a-${a.toLowerCase().replace(/_/g, '-')}`, q(`animals/glTF/${a}.gltf`), KEEP_ANIMAL]);
for (const [pack, name] of [['graveyard-kit_5.0', 'character-skeleton'], ['graveyard-kit_5.0', 'character-zombie'], ['graveyard-kit_5.0', 'character-ghost'], ['graveyard-kit_5.0', 'character-vampire'], ['mini-dungeon', 'character-orc'], ['mini-arena', 'character-soldier']]) jobs.push([`k-${name.replace('character-', '')}`, k(pack, name), KEEP_KENNEY]);
const props = {
  'castle-kit': ['tower-base', 'tower-square-base', 'tower-square-mid', 'tower-square-mid-windows', 'tower-square-top', 'tower-square-top-roof', 'tower-square-top-color', 'tower-hexagon-base', 'tower-hexagon-mid', 'tower-hexagon-top', 'tower-hexagon-roof', 'tower-top', 'flag', 'flag-banner-long', 'flag-banner-short', 'wall', 'wall-pillar', 'siege-ballista', 'siege-catapult', 'siege-ram', 'rocks-small', 'rocks-large', 'tree-large', 'tree-small', 'bridge-straight', 'bridge-straight-pillar', 'gate', 'metal-gate'],
  'tower-defense-kit': ['weapon-cannon', 'weapon-turret', 'weapon-ballista', 'weapon-catapult', 'weapon-ammo-arrow', 'weapon-ammo-cannonball', 'weapon-ammo-boulder', 'weapon-ammo-bullet', 'tower-round-crystals', 'tower-round-base', 'tower-round-bottom-a', 'tower-round-middle-a', 'tower-round-top-a', 'tower-round-roof-a', 'tower-square-bottom-a', 'tower-square-top-a', 'detail-crystal', 'detail-crystal-large', 'enemy-ufo-a', 'enemy-ufo-b', 'enemy-ufo-c', 'enemy-ufo-d', 'detail-tree', 'detail-tree-large', 'detail-rocks'],
  'graveyard-kit_5.0': ['gravestone-cross', 'gravestone-round', 'gravestone-bevel', 'crypt-small', 'iron-fence', 'iron-fence-border', 'coffin', 'pumpkin-carved', 'lightpost-single', 'pine', 'pine-crooked'],
  'mini-dungeon': ['barrel', 'chest', 'shield-round', 'shield-rectangle', 'weapon-sword', 'weapon-spear', 'banner', 'potion', 'coin', 'wood-structure', 'rocks', 'stones'],
  'mini-arena': ['banner', 'column', 'statue', 'trophy', 'weapon-rack', 'tree'],
};
for (const [pack, names] of Object.entries(props)) for (const n of names) jobs.push([`p-${pack.split('-')[0]}-${n}`, k(pack, n), []]);

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
let total = 0;
let made = 0;
const missing = [];
/** name → { anims, size: [x, y, z] of the bind-pose bounds, bytes } — read by the game for clip lookup and auto-scaling. */
const manifest = {};
for (const [name, file, keep] of jobs) {
  if (!existsSync(file)) {
    missing.push(`${name} (${file})`);
    continue;
  }
  const doc = await io.read(file);
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) {
    const base = anim.getName().replace(/^.*\|/, '');
    anim.setName(base);
    if (keep && !keep.includes(base)) anim.dispose();
  }
  // The Flying / Blob monster files embed a 32 px copy of the shared palette atlas,
  // which blurs neighbouring colours together: swap in the full-size atlas.
  if (name.startsWith('m-')) {
    const atlas = q('monsters/Atlas_Monsters.png');
    for (const tex of root.listTextures()) if (existsSync(atlas)) tex.setImage(readFileSync(atlas)).setMimeType('image/png');
  }
  // Channels that never change are pure JSON overhead (hundreds of KB on 60+ bone rigs).
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const out = ch.getSampler()?.getOutput();
      const node = ch.getTargetNode();
      if (!out || !node) continue;
      const arr = out.getArray();
      const n = out.getElementSize();
      const rest = ch.getTargetPath() === 'rotation' ? node.getRotation() : ch.getTargetPath() === 'scale' ? node.getScale() : ch.getTargetPath() === 'translation' ? node.getTranslation() : null;
      if (!rest) continue;
      let flat = true;
      for (let i = 0; i < arr.length && flat; i += n) {
        // q and −q are the same rotation
        const sign = n === 4 && arr[i] * rest[0] + arr[i + 1] * rest[1] + arr[i + 2] * rest[2] + arr[i + 3] * rest[3] < 0 ? -1 : 1;
        for (let c = 0; c < n; c++) if (Math.abs(arr[i + c] * sign - rest[c]) > 2e-4) flat = false;
      }
      if (flat) ch.dispose();
    }
  }
  await doc.transform(
    dedup(),
    weld(),
    resample({ tolerance: Number(process.env.TOL ?? 0.004) }),
    prune(),
    // Colour-palette atlases are a few pixels per colour: lossy WebP would smear them.
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], pattern: /atlas|colormap|texture-|palette/i, lossless: true }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 88 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const b = getBounds(scene);
  const size = [0, 1, 2].map((i) => Math.round((b.max[i] - b.min[i]) * 1000) / 1000);
  const path = join(out, `${name}.glb`);
  await io.write(path, doc);
  manifest[name] = { anims: root.listAnimations().map((a) => a.getName()), size, minY: Math.round(b.min[1] * 1000) / 1000, bytes: statSync(path).size };
  total += statSync(path).size;
  made++;
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
console.log(`${made} models → ${out} (${(total / 1048576).toFixed(1)} MB)`);
if (missing.length) console.log(`missing ${missing.length}:\n  ${missing.join('\n  ')}`);
