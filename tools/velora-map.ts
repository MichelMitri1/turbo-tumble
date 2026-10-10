/** Build Velora City headlessly and draw a top-down map (roads, buildings, water, heights). npx tsx tools/velora-map.ts [out.png] */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { buildCity } from '../client/src/velora/world/city';
import { HALF } from '../client/src/velora/world/layout';
import { WATER_Y } from '../client/src/velora/world/layout';

const out = process.argv[2] ?? '/tmp/velora-map.png';
const man = JSON.parse(readFileSync('client/public/assets/velora/manifest.json', 'utf8'));
const fps = JSON.parse(readFileSync('client/public/assets/fps/manifest.json', 'utf8'));
const t0 = performance.now();
const city = buildCity({ ...man.kits, fps });
const ms = performance.now() - t0;
const S = 1000; // px
const k = S / (HALF * 2);
const img = Buffer.alloc(S * S * 3);
const set = (x: number, y: number, c: [number, number, number]) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 3;
  img[i] = c[0];
  img[i + 1] = c[1];
  img[i + 2] = c[2];
};
for (let py = 0; py < S; py++)
  for (let px = 0; px < S; px++) {
    const x = px / k - HALF;
    const z = py / k - HALF;
    const h = city.terrain.height(x, z);
    const c: [number, number, number] = h < WATER_Y ? [40, 100, 170] : h < 0.6 && z > 500 ? [220, 200, 140] : [60 + Math.min(80, h * 2.5), 110 + Math.min(60, h * 1.5), 60];
    set(px, py, c);
  }
const P = (x: number, z: number) => [Math.round((x + HALF) * k), Math.round((z + HALF) * k)] as const;
for (const p of city.placements) {
  if (!p.box) {
    const [x, y] = P(p.x, p.z);
    set(x, y, [30, 80, 30]);
    continue;
  }
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  for (let u = -p.box.hx; u <= p.box.hx; u += 1)
    for (let v = -p.box.hz; v <= p.box.hz; v += 1) {
      const [x, y] = P(p.x + u * c + v * s, p.z - u * s + v * c);
      set(x, y, [70, 70, 80]);
    }
}
for (const e of city.net.edges) {
  const col: [number, number, number] = e.type === 'highway' ? (e.raised ? [255, 200, 40] : [230, 160, 40]) : e.type === 'ramp' ? [255, 220, 120] : e.raised ? [255, 255, 255] : e.type === 'rural' ? [200, 180, 150] : [210, 210, 210];
  for (let i = 0; i < e.px.length; i++) {
    const [x, y] = P(e.px[i]!, e.pz[i]!);
    const w = Math.max(1, Math.round((e.spec.width / 2) * k));
    for (let dx = -w; dx <= w; dx++) for (let dy = -w; dy <= w; dy++) set(x + dx, y + dy, col);
  }
}
for (const n of city.net.nodes) {
  const [x, y] = P(n.x, n.z);
  const c: [number, number, number] = n.light ? [255, 40, 40] : [40, 40, 255];
  for (let d = -1; d <= 1; d++) {
    set(x + d, y, c);
    set(x, y + d, c);
  }
}
for (const s of city.shops) {
  const [x, y] = P(s.x, s.z);
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) set(x + dx, y + dy, [255, 0, 255]);
}
await sharp(img, { raw: { width: S, height: S, channels: 3 } }).png().toFile(out);
console.log(`built in ${ms.toFixed(0)} ms · nodes ${city.net.nodes.length} edges ${city.net.edges.length} (lights ${city.net.nodes.filter((n) => n.light).length}) · buildings ${city.placements.filter((p) => p.box).length} trees ${city.placements.filter((p) => !p.box).length} · shops ${city.shops.length} · parking ${city.parking.length} · lamps ${city.lamps.length} · road km ${(city.net.edges.reduce((a, e) => a + e.len, 0) / 1000).toFixed(1)}`);
