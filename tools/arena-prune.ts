/**
 * Deletes converted arena models that no card, tower or decoration uses, and
 * rewrites manifest.json.   npx tsx tools/arena-prune.ts [--dry]
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CARDS, modelsFor } from '../client/src/arena/cards';

const dir = 'client/public/assets/arena/models';
const keep = modelsFor(CARDS.map((c) => c.id));
for (const m of ['p-castle-tower-square-base', 'p-castle-tower-square-mid-windows', 'p-castle-tower-square-top', 'p-castle-tower-hexagon-base', 'p-castle-tower-hexagon-mid', 'p-castle-tower-hexagon-top', 'c-elf', 'c-knight-golden-male', 'p-tower-weapon-cannon']) keep.add(m);
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')) as Record<string, unknown>;
const dry = process.argv.includes('--dry');
let removed = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.glb')) continue;
  const name = f.slice(0, -4);
  if (keep.has(name)) continue;
  removed++;
  delete manifest[name];
  if (!dry) rmSync(`${dir}/${f}`);
}
const missing = [...keep].filter((m) => !m.startsWith('nature:') && !(m in manifest));
if (!dry) writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest));
console.log(`kept ${Object.keys(manifest).length}, removed ${removed}${dry ? ' (dry run)' : ''}; missing: ${missing.join(', ') || 'none'}`);
