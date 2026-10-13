/**
 * Zero Hour realism pass: photoscanned CC0 assets from Poly Haven (https://polyhaven.com).
 *
 *   node tools/fps-realism.mjs [textures|skies|models ...]   (default: all three)
 *
 * - textures → client/public/assets/fps/tex/<material>.webp (+ _n normal, _r roughness), 1k / 512 / 256.
 *   Surfaces the maps tint (paint, fabric, roofs…) are made neutral so the tint still reads.
 * - skies    → client/public/assets/fps/sky/<sky>.webp: a 2k "puresky" HDRI tone-mapped to LDR, plus
 *   sky.json with where its sun is and the horizon colour (the fog matches it).
 * - models   → client/public/assets/fps/prop-*.glb (512 px WebP textures, meshopt). Replacements are
 *   fitted into the old Quaternius model's box so every placement and collision box stays valid.
 *   manifest.json and client/src/fps/sim/propBounds.ts are refreshed from the results.
 *
 * Downloads are cached in $PH_CACHE (default: the OS temp dir).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, flatten, getBounds, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { FloatType } from 'three';

const ROOT = resolve('.');
const OUT = join(ROOT, 'client/public/assets/fps');
const CACHE = process.env.PH_CACHE ?? join(tmpdir(), 'polyhaven');
mkdirSync(CACHE, { recursive: true });
const what = process.argv.slice(2);
const want = (k) => !what.length || what.includes(k);

async function fetchCached(url, file) {
  const p = join(CACHE, file);
  if (existsSync(p)) return readFileSync(p);
  mkdirSync(dirname(p), { recursive: true });
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'turbo-tumble-asset-tool' } });
    if (r.ok) {
      const b = Buffer.from(await r.arrayBuffer());
      writeFileSync(p, b);
      return b;
    }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  throw new Error(`download failed: ${url}`);
}
const files = async (id) => JSON.parse((await fetchCached(`https://api.polyhaven.com/files/${id}`, `${id}/files.json`)).toString());
const info = async (id) => JSON.parse((await fetchCached(`https://api.polyhaven.com/info/${id}`, `${id}/info.json`)).toString());

// ---------------------------------------------------------------- textures

/**
 * Material → Poly Haven texture. `neutral`: desaturate (keeping `sat` of the colour) and set the mean
 * brightness to this (sRGB 0..1) — for surfaces whose colour mostly comes from the map's tint.
 * `contrast`: scale the brightness variation (big plain walls show a scan's blotches repeating).
 */
const TEX = {
  concrete: { id: 'dirty_concrete' },
  brick: { id: 'red_brick' },
  metal: { id: 'rusty_metal_sheet', neutral: 0.5, sat: 0.45 },
  wood: { id: 'brown_planks_03' },
  dirt: { id: 'dirt' },
  sand: { id: 'dense_sand' },
  asphalt: { id: 'asphalt_02' },
  grass: { id: 'sparse_grass' },
  plaster: { id: 'white_plaster_02', neutral: 0.74, sat: 0.6, contrast: 0.5 },
  tile: { id: 'large_grey_tiles' },
  marble: { id: 'marble_01' },
  carpet: { id: 'dirty_carpet', neutral: 0.78, sat: 0.1 },
  wallpaper: { id: 'decrepit_wallpaper', neutral: 0.84, sat: 0.5, contrast: 0.7 },
  darkwood: { id: 'wood_floor' },
  shingle: { id: 'grey_roof_tiles', neutral: 0.66, sat: 0.2 },
  hedge: { id: 'forest_leaves_03' },
  paint: { id: 'painted_plaster_wall', neutral: 0.86, sat: 0.2, contrast: 0.7 },
  fabric: { id: 'cotton_jersey', neutral: 0.82, sat: 0.1 },
  snow: { id: 'snow_01' },
  plywood: { id: 'plywood', neutral: 0.68, sat: 0.75 },
  gravel: { id: 'gravel_floor' },
  corrugated: { id: 'corrugated_iron', neutral: 0.66, sat: 0.3 },
  // Not box materials: generated props (shipping containers, sandbags).
  container: { id: 'container_side', neutral: 0.97, sat: 0 },
  hessian: { id: 'hessian_230' },
  bark: { id: 'bark_brown_02' },
};

const pick = (f, map) => {
  const m = f[map]?.['1k'];
  return m?.jpg?.url ?? m?.png?.url;
};

async function textures() {
  const dir = join(OUT, 'tex');
  mkdirSync(dir, { recursive: true });
  const meta = {};
  let bytes = 0;
  for (const [mat, cfg] of Object.entries(TEX)) {
    const f = await files(cfg.id);
    const i = await info(cfg.id);
    const diff = await fetchCached(pick(f, 'Diffuse'), `${cfg.id}/diff.jpg`);
    const nor = await fetchCached(pick(f, 'nor_gl'), `${cfg.id}/nor.jpg`);
    const roughUrl = pick(f, 'Rough');
    // Some sets only ship the packed AO/rough/metal map: roughness is its green channel.
    const rough = roughUrl ? sharp(await fetchCached(roughUrl, `${cfg.id}/rough.jpg`)).greyscale() : sharp(await fetchCached(pick(f, 'arm'), `${cfg.id}/arm.jpg`)).extractChannel('green');
    let d = sharp(diff).resize(1024, 1024);
    let mean = 0;
    if (cfg.neutral !== undefined) {
      const { data, info: im } = await d.removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const n = im.width * im.height;
      let sum = 0;
      for (let k = 0; k < n; k++) sum += (0.2126 * data[k * 3] + 0.7152 * data[k * 3 + 1] + 0.0722 * data[k * 3 + 2]) / 255;
      const avg = (sum / n) * 255;
      const gain = cfg.neutral / (sum / n);
      const con = cfg.contrast ?? 1;
      for (let k = 0; k < n; k++) {
        const r = data[k * 3];
        const g = data[k * 3 + 1];
        const b = data[k * 3 + 2];
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const y2 = avg + (y - avg) * con;
        for (const [c, v] of [[0, r], [1, g], [2, b]]) data[k * 3 + c] = Math.max(0, Math.min(255, Math.round((y2 + (v - y) * cfg.sat) * gain)));
      }
      d = sharp(data, { raw: { width: im.width, height: im.height, channels: 3 } });
    }
    {
      const { data } = await sharp(await d.clone().png().toBuffer()).resize(16, 16).raw().toBuffer({ resolveWithObject: true });
      for (let k = 0; k < data.length; k += 3) mean += (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) / 255;
      mean /= data.length / 3;
    }
    const outs = [
      [`${mat}.webp`, await d.webp({ quality: 76 }).toBuffer()],
      [`${mat}_n.webp`, await sharp(nor).resize(512, 512).webp({ quality: 88 }).toBuffer()],
      [`${mat}_r.webp`, await rough.resize(256, 256).webp({ quality: 80 }).toBuffer()],
    ];
    for (const [name, buf] of outs) {
      writeFileSync(join(dir, name), buf);
      bytes += buf.length;
    }
    // Real-world size of one repeat (metres), from the scan.
    const size = i.dimensions ? +(i.dimensions[0] / 1000).toFixed(2) : 2;
    meta[mat] = { id: cfg.id, size, mean: +mean.toFixed(3) };
    console.log(`${mat.padEnd(11)} ${cfg.id.padEnd(22)} ${String(size).padStart(5)} m  mean ${mean.toFixed(2)}  ${outs.map(([, b]) => `${(b.length / 1024) | 0}K`).join(' ')}`);
  }
  writeFileSync(join(dir, 'tex.json'), JSON.stringify(meta, null, 1));
  console.log(`textures: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

// ---------------------------------------------------------------- skies

const SKIES = {
  day: { id: 'kloofendal_48d_partly_cloudy_puresky', key: 0.62 },
  dusk: { id: 'belfast_sunset_puresky', key: 0.3 },
  overcast: { id: 'kloofendal_overcast_puresky', key: 0.66 },
  night: { id: 'qwantani_night_puresky', key: 0.045 },
  snow: { id: 'snow_field_puresky', key: 0.7 },
};

async function skies() {
  const dir = join(OUT, 'sky');
  mkdirSync(dir, { recursive: true });
  const meta = {};
  for (const [sky, cfg] of Object.entries(SKIES)) {
    const f = await files(cfg.id);
    const buf = await fetchCached(f.hdri['2k'].hdr.url, `${cfg.id}/2k.hdr`);
    const loader = new HDRLoader();
    loader.setDataType(FloatType);
    const tex = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const { width: W, height: H, data } = tex;
    const lum = (k) => 0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2];
    // The sun: the brightest pixel in the upper half.
    let best = 0;
    let bx = 0;
    let by = 0;
    const lums = [];
    for (let y = 0; y < H / 2; y++)
      for (let x = 0; x < W; x += 2) {
        const k = (y * W + x) * 4;
        const l = lum(k);
        if (l > best) {
          best = l;
          bx = x;
          by = y;
        }
        if (y % 4 === 0) lums.push(l);
      }
    lums.sort((a, b) => a - b);
    const median = lums[lums.length >> 1];
    // Equirect: u = 0.5 + atan2(dir.x, -dir.z) / 2π style; store raw angles and let the client rotate.
    const az = (bx / W) * Math.PI * 2;
    const el = (0.5 - by / H) * Math.PI;
    const exposure = cfg.key / median;
    // Filmic-ish curve (1 − e^(−x)) then sRGB.
    const toS = (v) => {
      const t = 1 - Math.exp(-v * exposure);
      return Math.round(255 * (t <= 0.0031308 ? 12.92 * t : 1.055 * Math.pow(t, 1 / 2.4) - 0.055));
    };
    const rgb = Buffer.alloc(W * H * 3);
    for (let p = 0; p < W * H; p++) for (let c = 0; c < 3; c++) rgb[p * 3 + c] = toS(data[p * 4 + c]);
    // The horizon (1–4° up), averaged: the fog colour.
    const hz = [0, 0, 0];
    let hn = 0;
    for (let y = Math.floor(H / 2 - (4 / 180) * H); y < H / 2 - (1 / 180) * H; y++)
      for (let x = 0; x < W; x += 4) {
        for (let c = 0; c < 3; c++) hz[c] += rgb[(y * W + x) * 3 + c];
        hn++;
      }
    const hex = '#' + hz.map((v) => Math.round(v / hn).toString(16).padStart(2, '0')).join('');
    const out = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 82 }).toBuffer();
    writeFileSync(join(dir, `${sky}.webp`), out);
    meta[sky] = { id: cfg.id, sunAz: +az.toFixed(4), sunEl: +el.toFixed(4), horizon: hex };
    console.log(`${sky.padEnd(9)} ${cfg.id.padEnd(38)} sun az ${((az * 180) / Math.PI).toFixed(0)}° el ${((el * 180) / Math.PI).toFixed(0)}°  horizon ${hex}  ${(out.length / 1024) | 0}K`);
  }
  writeFileSync(join(dir, 'sky.json'), JSON.stringify(meta, null, 1));
}

// ---------------------------------------------------------------- models

/** The Quaternius props being replaced: their box (so placements and collision stay the same). */
const OLD = {
  'prop-explodingbarrel': [-0.392, 0, -0.392, 0.392, 1.024, 0.392],
  'prop-crate': [-0.395, 0.003, -0.395, 0.395, 0.793, 0.395],
  'prop-barrier-single': [-0.935, -0.003, -0.329, 0.955, 0.625, 0.328],
  'prop-cardboardboxes-1': [-0.488, 0, -0.363, 0.488, 0.509, 0.363],
  'prop-cardboardboxes-3': [-0.583, 0, -0.607, 0.673, 2.255, 0.607],
  'prop-debris-tires': [-0.574, -0.029, -0.572, 1.182, 1.059, 0.573],
  'prop-gastank': [-0.503, -0.001, -0.503, 0.503, 1.386, 0.503],
  'prop-streetlight': [-0.209, -0.008, -0.203, 0.209, 5.638, 1.883],
  'prop-debris-brokencar': [-1.321, -0.098, -2.545, 1.321, 1.662, 2.949],
};

/**
 * fit: 'box' = stretch into the old box; 'height' = uniform scale to its height, centred on it; 'place' = real
 * size, centred on the old box;
 * none = real size, base at y 0, centred. `stack`: instances [x, y, z, yaw] (in source units) before fitting.
 * `pick`: 'first' keeps the first variant of a pack. `tris`: simplify down to about this many triangles.
 * `lay`: tip over onto its side (tyres). `origin`: 'height' fit centred on (0, 0), not the old box (street lamps
 * whose old model had its arm off to one side). `height`: real-size model scaled to this height (bad units).
 */
const MODELS = [
  { name: 'prop-explodingbarrel', id: 'Barrel_01', fit: 'box' },
  { name: 'prop-crate', id: 'wooden_crate_02', fit: 'box' },
  { name: 'prop-barrier-single', id: 'concrete_road_barrier', fit: 'box' },
  { name: 'prop-cardboardboxes-1', id: 'cardboard_box_01', fit: 'box' },
  { name: 'prop-cardboardboxes-3', id: 'cardboard_box_01', fit: 'box', stack: 'boxes' },
  { name: 'prop-debris-tires', id: 'old_tyre', fit: 'place', stack: 'tyres', lay: true },
  { name: 'prop-gastank', id: 'propane_tank', fit: 'box' },
  { name: 'prop-streetlight', id: 'street_lamp_01', fit: 'height', origin: true },
  { name: 'prop-debris-brokencar', id: 'covered_car', fit: 'height', tris: 9000 },
  // New dressing (real size).
  { name: 'prop-barrel', id: 'barrel_03' },
  { name: 'prop-milcrate', id: 'old_military_crate' },
  { name: 'prop-ammobox', id: 'ammo_box' },
  { name: 'prop-generator', id: 'portable_generator', tris: 9000 },
  { name: 'prop-aircon', id: 'exterior_aircon_unit', pick: 'first', tris: 6000 },
  { name: 'prop-jerrycan', id: 'metal_jerrycan' },
  { name: 'prop-hydrant', id: 'fire_hydrant', pick: 'first' },
  { name: 'prop-trashcan', id: 'metal_trash_can', pick: 'first' },
  { name: 'prop-utilitybox', id: 'utility_box_02' },
  { name: 'prop-concreteblock', id: 'concrete_road_barrier_02' },
  { name: 'prop-cementbags', id: 'cement_bag', stack: 'bags' },
  { name: 'prop-trashbag', id: 'trashbag', tris: 3000 },
  { name: 'prop-plasticcrate', id: 'plastic_crate_03' },
  { name: 'prop-shelves', id: 'steel_frame_shelves_01', height: 2 },
  { name: 'prop-tyre', id: 'old_tyre', lay: true },
  { name: 'prop-lpg', id: 'small_lpg_tank' },
];

const STACKS = {
  // Four boxes: two on the floor, one on top, one more on top of that (slightly turned).
  boxes: (w, h) => [[-0.52 * w, 0, 0, 0], [0.52 * w, 0, 0, 0.3], [0, h, 0, -0.15], [0.1 * w, 2 * h, 0, 0.5]],
  // Two untidy piles of tyres.
  tyres: (w, h) => [...[0, 1, 2, 3, 4, 5].map((i) => [-0.45 * w + (i % 2) * 0.03, i * h, (i % 3) * 0.02, i]), ...[0, 1, 2, 3].map((i) => [0.62 * w, i * h, 0.08 - (i % 2) * 0.04, i * 2])],
  bags: (w, h) => [[-0.52 * w, 0, 0, 0], [0.52 * w, 0, 0, 0.1], [0, h, 0, -0.1]],
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

function quatY(a) {
  return [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
}

function mul(a, b) {
  // 4×4 column-major multiply.
  const o = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
  return o;
}
const trs = (x, y, z, yaw, sx = 1, sy = 1, sz = 1) => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1];
};

async function model(cfg, manifest) {
  const f = await files(cfg.id);
  const g = f.gltf['1k'].gltf;
  const base = `${cfg.id}/gltf`;
  const main = join(CACHE, base, `${cfg.id}.gltf`);
  await fetchCached(g.url, `${base}/${cfg.id}.gltf`);
  for (const [rel, v] of Object.entries(g.include ?? {})) await fetchCached(v.url, `${base}/${rel}`);
  const doc = await io.read(main);
  doc.createExtension(EXTTextureWebP).setRequired(true);
  await doc.transform(flatten());
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  let nodes = scene.listChildren().filter((n) => n.getMesh());
  if (process.env.DEBUG) console.log(cfg.id, nodes.map((n) => n.getName()));
  if (cfg.pick === 'first') {
    // Packs with variants side by side: keep the first and anything touching it (lids, doors).
    const b0 = getBounds(nodes[0]);
    nodes = nodes.filter((n) => {
      const b = getBounds(n);
      return b.min[0] <= b0.max[0] + 0.02 && b.max[0] >= b0.min[0] - 0.02 && b.min[2] <= b0.max[2] + 0.02 && b.max[2] >= b0.min[2] - 0.02;
    });
  }
  for (const n of scene.listChildren()) if (!nodes.includes(n)) n.dispose();
  // Bake each node's transform into a matrix we can re-instance.
  // Tip over about x (a tyre lying flat).
  const lay = cfg.lay ? [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1] : trs(0, 0, 0, 0);
  const src = nodes.map((n) => ({ mesh: n.getMesh(), m: mul(lay, n.getMatrix()) }));
  for (const n of nodes) n.dispose();
  let b = boundsOf(doc, src);
  const w = b.max[0] - b.min[0];
  const h = b.max[1] - b.min[1];
  const inst = cfg.stack ? STACKS[cfg.stack](w, h) : [[0, 0, 0, 0]];
  const placed = [];
  for (const [x, y, z, yaw] of inst) for (const s of src) placed.push({ mesh: s.mesh, m: mul(trs(x, y, z, yaw), s.m) });
  b = boundsOf(doc, placed);
  // Fit.
  let fitM = trs(-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2, 0);
  const t = OLD[cfg.name];
  if (cfg.fit && t) {
    let sx = b.max[0] - b.min[0];
    let sz = b.max[2] - b.min[2];
    const sy = b.max[1] - b.min[1];
    const tx = t[3] - t[0];
    const ty = t[4] - t[1];
    const tz = t[5] - t[2];
    // Turn a quarter if the long side is the wrong way round.
    const turn = Math.abs(tx - tz) / Math.max(tx, tz) > 0.15 && Math.abs(sx - sz) / Math.max(sx, sz) > 0.15 && tx > tz !== sx > sz;
    if (turn) [sx, sz] = [sz, sx];
    const cx = cfg.origin ? 0 : (t[0] + t[3]) / 2;
    const cz = cfg.origin ? 0 : (t[2] + t[5]) / 2;
    const k = cfg.fit === 'box' ? [tx / sx, ty / sy, tz / sz] : cfg.fit === 'place' ? [1, 1, 1] : [ty / sy, ty / sy, ty / sy];
    // Centre → turn → scale (in the target's axes) → move into the old box.
    fitM = mul(trs(cx, t[1], cz, 0, k[0], k[1], k[2]), mul(trs(0, 0, 0, turn ? Math.PI / 2 : 0), fitM));
  }
  if (cfg.height) {
    const k = cfg.height / (b.max[1] - b.min[1]);
    fitM = mul(trs(0, 0, 0, 0, k, k, k), fitM);
  }
  for (const p of placed) {
    const n = doc.createNode(cfg.name).setMesh(p.mesh).setMatrix(mul(fitM, p.m));
    scene.addChild(n);
  }
  const tris = doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((s, pr) => s + (pr.getIndices()?.getCount() ?? pr.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const target = cfg.tris ?? 5000;
  await doc.transform(weld(), ...(tris > target * 1.2 ? [simplify({ simplifier: MeshoptSimplifier, ratio: target / tris, error: 0.004 })] : []));
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }),
    dedup(),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const file = join(OUT, `${cfg.name}.glb`);
  await io.write(file, doc);
  const out = getBounds(scene);
  manifest[cfg.name] = { min: out.min.map((v) => +v.toFixed(3)), max: out.max.map((v) => +v.toFixed(3)), anims: [] };
  const size = readFileSync(file).length;
  console.log(`${cfg.name.padEnd(24)} ${cfg.id.padEnd(26)} ${String(Math.round(tris)).padStart(6)} tris  ${(size / 1024) | 0}K  [${manifest[cfg.name].min.join(', ')}] → [${manifest[cfg.name].max.join(', ')}]`);
}

/** Bounds of meshes placed with matrices (POSITION accessor min/max corners, transformed). */
function boundsOf(doc, placed) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { mesh, m } of placed)
    for (const prim of mesh.listPrimitives()) {
      const a = prim.getAttribute('POSITION');
      const lo = a.getMin([]);
      const hi = a.getMax([]);
      for (const x of [lo[0], hi[0]])
        for (const y of [lo[1], hi[1]])
          for (const z of [lo[2], hi[2]]) {
            const p = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
            for (let i = 0; i < 3; i++) {
              min[i] = Math.min(min[i], p[i]);
              max[i] = Math.max(max[i], p[i]);
            }
          }
    }
  return { min, max };
}

async function models() {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const mf = join(OUT, 'manifest.json');
  const manifest = JSON.parse(readFileSync(mf, 'utf8'));
  const only = process.env.ONLY?.split(',');
  for (const cfg of MODELS) if (!only || only.includes(cfg.name)) await model(cfg, manifest);
  writeFileSync(mf, JSON.stringify(manifest));
  // The sim's collision boxes come from the model bounds.
  const keys = Object.keys(manifest).filter((k) => k.startsWith('prop-') || k.startsWith('item-'));
  const rows = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify([...manifest[k].min, ...manifest[k].max])}`);
  writeFileSync(
    join(ROOT, 'client/src/fps/sim/propBounds.ts'),
    `/** Model bounds [minX, minY, minZ, maxX, maxY, maxZ] (generated by tools/fps-assets.mjs + tools/fps-realism.mjs → manifest.json). */\nexport const PROP_BOUNDS: Record<string, [number, number, number, number, number, number]> = {${rows.join(',\n  ')}};\n`,
  );
}

if (want('textures')) await textures();
if (want('skies')) await skies();
if (want('models')) await models();
