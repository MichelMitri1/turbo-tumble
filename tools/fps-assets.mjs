/**
 * Zero Hour asset pipeline: converts the CC0 Quaternius source packs into compact
 * GLBs under client/public/assets/fps/ (meshopt-compressed, unused animations removed).
 *
 *   node tools/fps-assets.mjs <dir with the packs>
 *
 * Expected inside <dir>:
 *   q/ugun/OBJ/*.obj|mtl      — Ultimate Gun Pack (realistic low-poly guns + accessories)
 *   q/modchars/Swat.gltf      — Ultimate Modular Characters: the SWAT operator (gun animations)
 *   q/shooter/{Environment,Guns}/glTF — Toon Shooter Game Kit (military props, grenade, knife)
 *
 * The menu's map shots (client/public/assets/fps/thumbs/<map>.jpg) are baked from the
 * running game instead (rendering a whole map in the menu froze it): open /zero-hour/,
 * run `await __zh.bakeMapThumbs()` in the console and save each data URL as <map>.jpg.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, weld, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const src = resolve(process.argv[2] ?? '.');
const out = resolve('client/public/assets/fps');
mkdirSync(out, { recursive: true });
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const manifest = {};
let total = 0;

async function finish(doc, name) {
  await doc.transform(dedup(), weld(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const file = join(out, `${name}.glb`);
  await io.write(file, doc);
  const bytes = statSync(file).size;
  total += bytes;
  manifest[name] = { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)), anims: doc.getRoot().listAnimations().map((a) => a.getName()) };
  console.log(`${name.padEnd(28)} ${(bytes / 1024).toFixed(0).padStart(5)} KB`);
}

// ---------------------------------------------------------------- OBJ guns → GLB

function parseMtl(text) {
  const mats = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'newmtl') mats[(cur = p[1])] = { kd: [0.5, 0.5, 0.5], d: 1 };
    else if (p[0] === 'Kd' && cur) mats[cur].kd = p.slice(1, 4).map(Number);
    else if (p[0] === 'd' && cur) mats[cur].d = Number(p[1]);
  }
  return mats;
}

function objToDoc(objText, mats, name) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const v = [];
  const n = [];
  const groups = new Map(); // material → {pos:[], nor:[]}
  let mat = 'Default';
  for (const line of objText.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') v.push(p.slice(1, 4).map(Number));
    else if (p[0] === 'vn') n.push(p.slice(1, 4).map(Number));
    else if (p[0] === 'usemtl') mat = p[1];
    else if (p[0] === 'f') {
      const idx = p.slice(1).map((s) => {
        const [vi, , ni] = s.split('/');
        return [Number(vi) - 1, ni ? Number(ni) - 1 : -1];
      });
      let g = groups.get(mat);
      if (!g) groups.set(mat, (g = { pos: [], nor: [] }));
      for (let k = 1; k + 1 < idx.length; k++) {
        for (const [vi, ni] of [idx[0], idx[k], idx[k + 1]]) {
          g.pos.push(...v[vi]);
          g.nor.push(...(ni >= 0 ? n[ni] : [0, 1, 0]));
        }
      }
    }
  }
  const mesh = doc.createMesh(name);
  for (const [m, g] of groups) {
    const info = mats[m] ?? { kd: [0.5, 0.5, 0.5], d: 1 };
    // OBJ Kd is linear-ish; brighten a little so dark gunmetal still reads.
    // MTL Kd values are very dark (≈0.02–0.08); lift them into readable gunmetal / polymer / wood tones.
    const lift = (c) => Math.min(1, Math.pow(c, 0.42) * 0.85);
    const material = doc.createMaterial(m).setBaseColorFactor([...info.kd.map(lift), info.d]).setRoughnessFactor(/metal/i.test(m) ? 0.38 : /wood/i.test(m) ? 0.6 : 0.55).setMetallicFactor(/metal/i.test(m) ? 0.75 : 0.1);
    if (info.d < 1) material.setAlphaMode('BLEND');
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.pos)).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.nor)).setBuffer(buf))
      .setMaterial(material);
    mesh.addPrimitive(prim);
  }
  const node = doc.createNode(name).setMesh(mesh);
  doc.createScene().addChild(node);
  return doc;
}

const GUNS = [
  'AssaultRifle2_1', 'AssaultRifle2_3', 'AssaultRifle_3', 'AssaultRifle_5', 'Bullpup_1', 'Bullpup_3',
  'SubmachineGun_1', 'SubmachineGun_3', 'SubmachineGun_5', 'Shotgun_1', 'Shotgun_4', 'Shotgun_SawedOff',
  'SniperRifle_2', 'SniperRifle_4', 'SniperRifle_5', 'Pistol_1', 'Pistol_5', 'Revolver_2',
];
const ACCESSORIES = ['Scope_1', 'Scope_2', 'Scope_3', 'Silencer_1', 'Silencer_Short', 'Grip', 'Bipod', 'Flashlight'];
for (const g of GUNS) {
  const dir = join(src, 'q/ugun/OBJ');
  const doc = objToDoc(readFileSync(join(dir, `${g}.obj`), 'utf8'), parseMtl(readFileSync(join(dir, `${g}.mtl`), 'utf8')), g);
  await finish(doc, `gun-${g.toLowerCase().replace(/_/g, '-')}`);
}
for (const a of ACCESSORIES) {
  const dir = join(src, 'q/ugun/OBJ/Accessories');
  const doc = objToDoc(readFileSync(join(dir, `${a}.obj`), 'utf8'), parseMtl(readFileSync(join(dir, `${a}.mtl`), 'utf8')), a);
  await finish(doc, `acc-${a.toLowerCase().replace(/_/g, '-')}`);
}

// ---------------------------------------------------------------- characters

const KEEP = ['Idle_Gun', 'Idle_Gun_Pointing', 'Idle_Gun_Shoot', 'Gun_Shoot', 'Run', 'Run_Back', 'Run_Left', 'Run_Right', 'Run_Shoot', 'Walk', 'Death', 'HitRecieve', 'Roll'];
{
  const doc = await io.read(join(src, 'q/modchars/Swat.gltf'));
  for (const a of doc.getRoot().listAnimations()) if (!KEEP.includes(a.getName())) a.dispose();
  await finish(doc, 'soldier');
}

// ---------------------------------------------------------------- props

const PROPS = [
  'Barrier_Fixed', 'Barrier_Large', 'Barrier_Single', 'CardboardBoxes_1', 'CardboardBoxes_3', 'Container_Long', 'Container_Small', 'Crate',
  'Debris_BrokenCar', 'Debris_Pile', 'Debris_Tires', 'ExplodingBarrel', 'Fence', 'Fence_Long', 'GasTank', 'MetalFence', 'Pallet', 'Pipes',
  'SackTrench', 'SackTrench_Small', 'Sign', 'StreetLight', 'Structure_1', 'Structure_2', 'Structure_3', 'Structure_4', 'Tank', 'TrafficCone',
  'TrashContainer', 'Tree_1', 'Tree_2', 'Tree_3', 'WaterTank_Floor', 'WaterTank_Platform', 'WoodPlanks',
];
for (const p of PROPS) {
  const doc = await io.read(join(src, 'q/shooter/Environment/glTF', `${p}.gltf`));
  await finish(doc, `prop-${p.toLowerCase().replace(/_/g, '-')}`);
}
for (const p of ['Grenade', 'Knife_1']) {
  const doc = await io.read(join(src, 'q/shooter/Guns/glTF', `${p}.gltf`));
  await finish(doc, `item-${p.toLowerCase().replace(/_/g, '-')}`);
}

writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
console.log(`\n${Object.keys(manifest).length} models, ${(total / 1024 / 1024).toFixed(2)} MB`);
