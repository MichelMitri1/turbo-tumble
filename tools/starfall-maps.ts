/**
 * Starfall map checks: everything you need to reach is reachable from the spawn, and a
 * picture of each layout (PPM → PNG next to the given dir).
 *   npx tsx tools/starfall-maps.ts [outdir]
 */
import { writeFileSync } from 'node:fs';
import { MAPS, buildMap } from '../client/src/starfall/sim/maps';

const out = process.argv[2];
for (const def of MAPS) {
  const m = buildMap(def);
  const g = m.grid;
  // Flood fill from spawn over cells where a body (r 0.32) fits.
  const reach = new Uint8Array(g.w * g.h);
  const fitsCell = (i: number, j: number) => g.fits(g.ox + (i + 0.5) * 0.25, g.oy + (j + 0.5) * 0.25, 0.3);
  const si = g.ci(def.spawn.x), sj = g.cj(def.spawn.y);
  const st = [[si, sj]];
  if (!fitsCell(si, sj)) console.log(`${def.id}: SPAWN BLOCKED`);
  reach[sj * g.w + si] = 1;
  while (st.length) {
    const [i, j] = st.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i! + di!, nj = j! + dj!;
      if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h || reach[nj * g.w + ni] || !fitsCell(ni, nj)) continue;
      reach[nj * g.w + ni] = 1;
      st.push([ni, nj]);
    }
  }
  const ok = (x: number, y: number, range = 1.1) => {
    // Reachable within 1 m (you use things from next to them).
    for (let j = g.cj(y - range); j <= g.cj(y + range); j++) for (let i = g.ci(x - range); i <= g.ci(x + range); i++) if (i >= 0 && j >= 0 && i < g.w && j < g.h && reach[j * g.w + i] && Math.hypot(g.ox + (i + 0.5) * 0.25 - x, g.oy + (j + 0.5) * 0.25 - y) <= range) return true;
    return false;
  };
  const bad: string[] = [];
  const chk = (what: string, x: number, y: number) => { if (!ok(x, y)) bad.push(`${what}@(${x},${y})`); };
  if (!ok(def.button.x, def.button.y, 2.4)) bad.push('button');
  def.tasks.forEach((t) => t.steps.forEach((s) => s.at.forEach((a) => chk(`${t.name}/${s.kind}`, a.x, a.y))));
  def.vents.forEach((v, i) => chk(`vent${i}`, v.x, v.y));
  for (const [k, spots] of Object.entries(def.sabotage)) (spots ?? []).forEach((s) => chk(`sab:${k}`, s.x, s.y));
  if (def.admin) chk('admin', def.admin.x, def.admin.y);
  if (def.security) chk('security', def.security.x, def.security.y);
  if (def.vitalsAt) chk('vitals', def.vitalsAt.x, def.vitalsAt.y);
  // Every room must be entered.
  for (const r of def.rooms) {
    const [cx, cy] = r.rect ? [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2] : [r.poly!.reduce((a, p) => a + p[0], 0) / r.poly!.length, r.poly!.reduce((a, p) => a + p[1], 0) / r.poly!.length];
    let any = false;
    for (let j = 0; j < g.h && !any; j++) for (let i = 0; i < g.w && !any; i++) if (reach[j * g.w + i] && m.roomAt(g.ox + (i + 0.5) * 0.25, g.oy + (j + 0.5) * 0.25) === r.name) any = true;
    if (!any) bad.push(`room ${r.name} (${cx},${cy}) unreachable`);
  }
  const area = reach.reduce((a, v) => a + v, 0) * 0.0625;
  console.log(`${def.id.padEnd(10)} ${g.w}x${g.h} cells · walkable ${area.toFixed(0)} m² · ${bad.length ? 'PROBLEMS: ' + bad.join(', ') : 'all reachable'}`);
  if (out) {
    const px = Buffer.alloc(g.w * g.h * 3);
    for (let k = 0; k < g.w * g.h; k++) {
      const c = g.floor[k] ? (g.furniture[k] ? [150, 90, 40] : reach[k] ? [200, 210, 220] : [230, 60, 60]) : [20, 24, 40];
      px.set(c, k * 3);
    }
    const mark = (x: number, y: number, c: number[]) => { for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const i = g.ci(x) + di, j = g.cj(y) + dj; if (i >= 0 && j >= 0 && i < g.w && j < g.h) px.set(c, (j * g.w + i) * 3); } };
    def.tasks.forEach((t) => t.steps.forEach((s) => s.at.forEach((a) => mark(a.x, a.y, [250, 210, 30]))));
    def.vents.forEach((v) => mark(v.x, v.y, [60, 200, 60]));
    for (const spots of Object.values(def.sabotage)) (spots ?? []).forEach((s) => mark(s.x, s.y, [255, 60, 200]));
    mark(def.button.x, def.button.y, [255, 0, 0]);
    mark(def.spawn.x, def.spawn.y, [0, 120, 255]);
    writeFileSync(`${out}/${def.id}.ppm`, Buffer.concat([Buffer.from(`P6\n${g.w} ${g.h}\n255\n`), px]));
  }
}
