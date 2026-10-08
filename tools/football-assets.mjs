/**
 * Matchday footballer: turns Quaternius' CC0 "Ultimate Modular Characters" Casual_2
 * into a kit-ready player (client/public/assets/football/player.glb).
 *
 *   node tools/football-assets.mjs "<Ultimate Modular Characters>/Individual Characters/glTF/Casual_2.gltf"
 *
 * - The trousers are split at the knee into SHORTS (above) and SOCKS (below), so a
 *   footballer's kit can be painted on: shirt / shorts / socks / boots each get their
 *   own material (tinted per team at runtime).
 * - Only the animations a match needs are kept.
 */
import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const src = process.argv[2];
const out = 'client/public/assets/football/player.glb';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot();

const KEEP = ['Idle', 'Idle_Neutral', 'Run', 'Run_Back', 'Run_Left', 'Run_Right', 'Walk', 'Kick_Left', 'Kick_Right', 'Roll', 'Wave', 'HitRecieve', 'Death', 'Interact'];
for (const a of root.listAnimations()) if (!KEEP.includes(a.getName())) a.dispose();

// Material roles: what the kit painter tints at runtime.
const RENAME = { LightBrown: 'Shirt', Red_Dark: 'Boots', White: 'BootSole', LightBlue: 'Shorts' };
for (const m of root.listMaterials()) if (RENAME[m.getName()]) m.setName(RENAME[m.getName()]);
const neutral = (m, rgb) => m.setBaseColorFactor([...rgb, 1]).setRoughnessFactor(0.85).setMetallicFactor(0);
neutral(root.listMaterials().find((m) => m.getName() === 'Shirt'), [0.9, 0.9, 0.9]);
neutral(root.listMaterials().find((m) => m.getName() === 'Shorts'), [0.88, 0.88, 0.88]); // distinct values: dedup() must not merge the kit parts
const socks = doc.createMaterial('Socks');
neutral(socks, [0.86, 0.86, 0.86]);

// Split the trousers at the knee.
const KNEE = 0.6;
const legs = root.listMeshes().find((mesh) => mesh.listPrimitives().some((p) => p.getMaterial()?.getName() === 'Shorts'));
const prim = legs.listPrimitives().find((p) => p.getMaterial()?.getName() === 'Shorts');
const pos = prim.getAttribute('POSITION');
const idx = prim.getIndices();
const above = [];
const below = [];
const v = [];
for (let t = 0; t < idx.getCount(); t += 3) {
  let y = 0;
  const tri = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
  for (const i of tri) {
    pos.getElement(i, v);
    y += v[1] / 3;
  }
  (y >= KNEE ? above : below).push(...tri);
}
const IndexArray = pos.getCount() > 65535 ? Uint32Array : Uint16Array;
prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new IndexArray(above)).setBuffer(idx.getBuffer()));
const sockPrim = prim.clone().setIndices(doc.createAccessor().setType('SCALAR').setArray(new IndexArray(below)).setBuffer(idx.getBuffer())).setMaterial(socks);
legs.addPrimitive(sockPrim);
console.log(`legs split: ${above.length / 3} shorts tris, ${below.length / 3} sock tris`);

await doc.transform(dedup(), weld(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(out, doc);
console.log(out, (statSync(out).size / 1024).toFixed(0), 'KB', root.listAnimations().map((a) => a.getName()).join(' '));
