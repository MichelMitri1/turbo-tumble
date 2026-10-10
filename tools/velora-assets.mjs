/**
 * Velora asset pipeline: CC0 packs → compact GLBs under client/public/assets/velora/.
 *
 *   node tools/velora-assets.mjs <dir>
 *
 * <dir> holds:
 *   kenney_car-kit/                     Kenney Car Kit (cars with separate wheel nodes)
 *   kenney_city-kit-commercial_2.1/     Kenney City Kit Commercial (downtown buildings)
 *   kenney_city-kit-suburban_20/        Kenney City Kit Suburban (houses, fences, trees)
 *   kenney_city-kit-roads/              Kenney City Kit Roads (street lights, traffic lights, props)
 *   people/<poly.pizza id>.glb          Quaternius Ultimate Modular Characters (via poly.pizza, CC0)
 *
 * Kits are packed one GLB per kit: the scene's children are the models, named after their
 * source file. Characters share one skeleton: only `casual` keeps the animations, the
 * game binds those clips to every other character.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, weld, textureCompress, mergeDocuments, getBounds, transformMesh } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const src = resolve(process.argv[2] ?? '.');
const out = resolve('client/public/assets/velora');
import { rmSync } from 'node:fs';
rmSync(join(out, 'cars'), { recursive: true, force: true });
for (const d of ['', 'cars', 'people']) mkdirSync(join(out, d), { recursive: true });
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const manifest = { cars: {}, people: {}, kits: {} };
let total = 0;

async function write(doc, file, keepAnims = true) {
  await doc.transform(dedup(), weld(), prune({ keepLeaves: true }), textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  if (!keepAnims) for (const a of doc.getRoot().listAnimations()) a.dispose();
  await io.write(file, doc);
  const kb = statSync(file).size / 1024;
  total += kb;
  console.log(`${file.replace(out + '/', '').padEnd(32)} ${kb.toFixed(0).padStart(5)} KB`);
}

// ---------------------------------------------------------------- cars
// Every car is normalised: transforms baked into the geometry, front along +z, wheels
// touching y = 0, scaled to a real length, and each wheel re-centred on its axle so it can
// spin. Quaternius' cars keep both rear wheels in one node ('wheels-back').
const CARS = {
  // Quaternius "Cars" (realistic proportions) — CC0 via poly.pizza
  sedan: { src: 'cars2/Cz6yDaUcM9.glb', len: 4.6 },
  hatch: { src: 'cars2/unqqkULtRU.glb', len: 4.1 },
  sports: { src: 'cars2/OyqKvX9xNh.glb', len: 4.5 },
  super: { src: 'cars2/1mkmFkAz5v.glb', len: 4.6 },
  muscle: { src: 'cars2/Gzj704DXdr.glb', len: 4.9 },
  police: { src: 'cars2/BwwnUrWGmV.glb', len: 4.9 },
  taxi: { src: 'cars2/x43lOScTpN.glb', len: 4.8 },
  suv: { src: 'cars2/xsMtZhBkxL.glb', len: 4.9 },
  pickup: { src: 'cars2/qn4grQgHm8.glb', len: 5.4 },
  boxtruck: { src: 'cars2/cXw6oiFtZ8.glb', len: 6.8 },
  // KayKit (CC0)
  wagon: { src: 'cars2/vTTTjDoxhV.glb', len: 4.7 },
  compact: { src: 'cars2/BG0KAhmGDt.glb', len: 3.9 },
  // Kenney Car Kit (special vehicles)
  ambulance: { src: 'kenney_car-kit/Models/GLB format/ambulance.glb', len: 5.8 },
  firetruck: { src: 'kenney_car-kit/Models/GLB format/firetruck.glb', len: 7.6 },
  garbage: { src: 'kenney_car-kit/Models/GLB format/garbage-truck.glb', len: 7.4 },
  van: { src: 'kenney_car-kit/Models/GLB format/van.glb', len: 5.0 },
  delivery: { src: 'kenney_car-kit/Models/GLB format/delivery.glb', len: 6.0 },
  racer: { src: 'kenney_car-kit/Models/GLB format/race-future.glb', len: 4.6 },
  tractor: { src: 'kenney_car-kit/Models/GLB format/tractor.glb', len: 4.0 },
};
function wheelRole(name) {
  const n = name.toLowerCase();
  if (/backwheels|rearwheels/.test(n)) return 'wheels-back';
  const front = /front/.test(n);
  const back = /back|rear/.test(n);
  if (!/wheel/.test(n) || (!front && !back)) return null;
  const left = /left|_l$|\bl$/.test(n);
  const right = /right|_r$|\br$/.test(n);
  return `wheel-${front ? 'front' : 'back'}-${left ? 'left' : right ? 'right' : 'x'}`;
}
function boundsOf(prims) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    const a = p.getAttribute('POSITION');
    const v = [0, 0, 0];
    for (let i = 0; i < a.getCount(); i++) {
      a.getElement(i, v);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], v[k]);
        max[k] = Math.max(max[k], v[k]);
      }
    }
  }
  return { min, max };
}
const mat4 = (m) => m; // gltf-transform matrices are column-major arrays
function translation(x, y, z) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}
function scaleRotY(s, flip) {
  const c = flip ? -1 : 1;
  return [s * c, 0, 0, 0, 0, s, 0, 0, 0, 0, s * c, 0, 0, 0, 0, 1];
}
for (const [name, c] of Object.entries(CARS)) {
  const doc = await io.read(join(src, c.src));
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  // Bake world transforms into each mesh (meshes cloned so shared ones stay correct).
  const parts = [];
  for (const n of root.listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const m = n.getWorldMatrix();
    const own = mesh.clone();
    transformMesh(own, mat4(m));
    parts.push({ role: wheelRole(n.getName()), mesh: own, name: n.getName() });
  }
  for (const n of root.listNodes()) n.dispose();
  // Where's the front? (front wheels' z sign, or the longer overhang)
  const all = boundsOf(parts.flatMap((p) => p.mesh.listPrimitives()));
  const fw = parts.filter((p) => p.role && p.role.includes('front'));
  const fz = fw.length ? boundsOf(fw.flatMap((p) => p.mesh.listPrimitives())) : null;
  const flip = fz ? (fz.min[2] + fz.max[2]) / 2 < (all.min[2] + all.max[2]) / 2 : false;
  const s = c.len / (all.max[2] - all.min[2]);
  const cx = (all.min[0] + all.max[0]) / 2;
  const cz = (all.min[2] + all.max[2]) / 2;
  for (const p of parts) {
    transformMesh(p.mesh, translation(-cx, -all.min[1], -cz));
    transformMesh(p.mesh, scaleRotY(s, flip));
  }
  // Rebuild a clean hierarchy: body + wheels (pivot at the axle).
  const top = doc.createNode(name);
  scene.addChild(top);
  const wheels = [];
  const body = doc.createNode('body');
  top.addChild(body);
  for (const p of parts) {
    if (!p.role) {
      const child = doc.createNode(p.name).setMesh(p.mesh);
      body.addChild(child);
      continue;
    }
    const b = boundsOf(p.mesh.listPrimitives());
    const center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    transformMesh(p.mesh, translation(-center[0], -center[1], -center[2]));
    let role = p.role;
    if (role.endsWith('-x')) role = role.replace('-x', center[0] > 0 ? '-left' : '-right');
    const node = doc.createNode(role).setMesh(p.mesh).setTranslation(center);
    top.addChild(node);
    wheels.push({ name: role, at: center.map((v) => +v.toFixed(3)), r: +((b.max[1] - b.min[1]) / 2).toFixed(3), w: +(b.max[0] - b.min[0]).toFixed(3) });
  }
  const nb = boundsOf(parts.flatMap((p) => p.mesh.listPrimitives()));
  manifest.cars[name] = { len: c.len, min: [-(all.max[0] - all.min[0]) * s / 2, 0, -c.len / 2], max: [(all.max[0] - all.min[0]) * s / 2, (all.max[1] - all.min[1]) * s, c.len / 2], wheels };
  void nb;
  await write(doc, join(out, 'cars', `${name}.glb`));
}

// ---------------------------------------------------------------- people
const PEOPLE = {
  casual: 'kZ3DmIoGip',
  hoodie: 'gKLBoRsyKe',
  suit: 'sOUciDsoVV',
  business: 'JFrLIKqvCH',
  worker: 'E8079Ahx7k',
  worker2: 'Yg2bQZO6Hj',
  punk: 'BTALZymknF',
  punk2: 'djXoqejw6w',
  farmer: '7pn3R6hPvE',
  adventurer: '5EGWBMpuXq',
  woman: 'nIItLV9nxS',
  woman2: 'qJ2gsTUBHL',
  swat: 'Btfn3G5Xv4',
};
const KEEP = ['Idle', 'Idle_Neutral', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right', 'Idle_Gun', 'Idle_Gun_Pointing', 'Idle_Gun_Shoot', 'Gun_Shoot', 'Run_Shoot', 'Punch_Left', 'Punch_Right', 'Kick_Right', 'HitRecieve', 'Death', 'Roll', 'Interact', 'Wave'];
for (const [name, id] of Object.entries(PEOPLE)) {
  const doc = await io.read(join(src, 'people', `${id}.glb`));
  for (const a of doc.getRoot().listAnimations()) {
    const short = a.getName().replace(/^.*\|/, '');
    if (name !== 'casual' || !KEEP.includes(short)) a.dispose();
    else a.setName(short);
  }
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  manifest.people[name] = { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) };
  await write(doc, join(out, 'people', `${name}.glb`));
}

// ---------------------------------------------------------------- kits
async function pack(kit, dir, models) {
  const doc = new Document();
  doc.createBuffer();
  const main = doc.createScene('kit');
  doc.getRoot().setDefaultScene(main);
  const bounds = {};
  for (const m of models) {
    const part = await io.read(join(src, dir, 'Models/GLB format', `${m}.glb`));
    const ps = part.getRoot().getDefaultScene() ?? part.getRoot().listScenes()[0];
    const b = getBounds(ps);
    bounds[m] = { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) };
    const map = mergeDocuments(doc, part);
    const merged = map.get(ps);
    const holder = doc.createNode(m);
    for (const child of merged.listChildren()) holder.addChild(child);
    main.addChild(holder);
    merged.dispose();
  }
  // One buffer.
  const buf = doc.getRoot().listBuffers()[0];
  for (const a of doc.getRoot().listAccessors()) a.setBuffer(buf);
  for (const b of doc.getRoot().listBuffers()) if (b !== buf) b.dispose();
  manifest.kits[kit] = bounds;
  await write(doc, join(out, `${kit}.glb`));
}
const L = (p, n) => Array.from({ length: n }, (_, i) => `${p}${String.fromCharCode(97 + i)}`);
await pack('downtown', 'kenney_city-kit-commercial_2.1', [...L('building-', 14), ...L('building-skyscraper-', 5), 'detail-awning', 'detail-awning-wide', 'detail-overhang', 'detail-parasol-a', 'detail-parasol-b']);
await pack('suburb', 'kenney_city-kit-suburban_20', [...L('building-type-', 21), 'fence-1x2', 'fence-1x3', 'fence-2x2', 'fence-low', 'fence', 'tree-large', 'tree-small', 'planter', 'driveway-long', 'path-long']);
await pack('street', 'kenney_city-kit-roads', ['light-curved', 'light-curved-double', 'light-square', 'light-square-double', 'traffic-light', 'traffic-light-hanging', 'dumpster', 'construction-barrier', 'construction-cone', 'construction-fence', 'construction-light', 'road-sign-stop', 'road-sign-street', 'road-sign-warning', 'electricity-pole', 'electricity-pole-wide', 'bridge-pillar', 'bridge-pillar-wide', 'sign-highway', 'sign-highway-wide']);

writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
console.log(`total ${(total / 1024).toFixed(2)} MB`);
