/**
 * Study a saved Boostball match (SAVE MATCH LOG on the end / pause screen).
 *   npx tsx tools/rocket-matchlog.ts <match.json> [out-dir=smoke-out/matchlog] [--secs=6]
 * Prints every goal with the seconds before it (positions, speeds, boost, what each bot was
 * doing) and renders each goal as a strip of top-down frames (goal-N.png) to look at.
 * Online logs have no bot plans; they're re-derived by running the SSL brain on the frames.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { World, type WorldEvent } from '../client/src/rocket/sim/world';
import { readSnapshot } from '../client/src/rocket/sim/snapshot';
import { Bots, type BotLevel } from '../client/src/rocket/sim/bot';
import { ARENA } from '../client/src/rocket/sim/arena';
import type { MatchLogFile } from '../client/src/rocket/matchlog';
import type { Controls } from '../client/src/rocket/sim/car';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'))!;
const outDir = resolve(args.filter((a) => !a.startsWith('--'))[1] ?? 'smoke-out/matchlog');
const secs = Number(args.find((a) => a.startsWith('--secs='))?.split('=')[1] ?? 6);
const log = JSON.parse(readFileSync(file, 'utf8')) as MatchLogFile;
mkdirSync(outDir, { recursive: true });

const buf = Buffer.from(log.frames, 'base64');
const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const n = all.length / log.frameSize;
const world = new World(log.players, 300, 1, false, log.rules);
const name = new Map(log.players.map((p) => [p.id, `${p.name}${p.bot ? '' : ' (human)'}`]));
const humanTeams = new Set(log.players.filter((p) => !p.bot).map((p) => p.team));

// Plans: logged (local) or re-derived (online).
let plans = log.plans;
if (!plans) {
  const bots = new Bots(world, (['rookie', 'pro', 'allstar', 'ssl'].includes(log.level) ? log.level : 'ssl') as BotLevel);
  const out = new Map<number, Controls>();
  plans = [];
  for (let i = 0; i < n; i++) {
    readSnapshot(world, all.subarray(i * log.frameSize, (i + 1) * log.frameSize));
    for (let k = 0; k < 8; k++) bots.update(1 / 120, out);
    const p: Record<number, string> = {};
    for (const pl of log.players) if (pl.bot) p[pl.id] = `${bots.planOf(pl.id)}?`;
    plans.push(p);
  }
}

interface F { tick: number; ball: [number, number, number]; bv: [number, number, number]; cars: Array<{ id: number; team: 0 | 1; x: number; y: number; z: number; yaw: number; v: number; boost: number; sup: boolean; demo: boolean }> }
const frames: F[] = [];
for (let i = 0; i < n; i++) {
  readSnapshot(world, all.subarray(i * log.frameSize, (i + 1) * log.frameSize));
  frames.push({
    tick: world.tickCount,
    ball: [world.ball.pos.x, world.ball.pos.y, world.ball.pos.z],
    bv: [world.ball.vel.x, world.ball.vel.y, world.ball.vel.z],
    cars: world.cars.map((c) => ({ id: c.id, team: c.team, x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: Math.atan2(c.forward.y, c.forward.x), v: c.speed, boost: c.boost, sup: c.supersonic, demo: c.demolished })),
  });
}
const at = (tick: number) => {
  let i = frames.findIndex((f) => f.tick >= tick);
  if (i < 0) i = frames.length - 1;
  return i;
};

const goals = log.events.filter((x) => x.e.k === 'goal') as Array<{ tick: number; e: Extract<WorldEvent, { k: 'goal' }> }>;
const touches = log.events.filter((x) => x.e.k === 'touch') as Array<{ tick: number; e: Extract<WorldEvent, { k: 'touch' }> }>;
const byHuman = goals.filter((g) => humanTeams.has(g.e.team)).length;
console.log(`${log.online ? 'Online' : 'Local'} match, ${log.players.length} cars, bots: ${log.level}, ${(n / 15 / 60).toFixed(1)} min logged · goals: humans' team ${byHuman}, bots' team ${goals.length - byHuman}`);

const html: string[] = [];
goals.forEach((g, gi) => {
  const end = at(g.tick);
  const start = Math.max(0, end - Math.round(secs * 15));
  const who = humanTeams.has(g.e.team) ? 'HUMANS SCORED' : 'bots scored';
  const lastT = touches.filter((t) => t.tick <= g.tick && t.tick >= frames[start]!.tick);
  console.log(`\n=== Goal ${gi + 1} (${who}) at ${(g.tick / 120).toFixed(1)} s by ${name.get(g.e.scorer) ?? '?'}, ${Math.round(g.e.speed * 0.036)} kph`);
  console.log(`  touches before: ${lastT.map((t) => `${name.get(t.e.car)} @${(t.tick / 120).toFixed(1)}s z${Math.round(t.e.z)}`).join(' → ')}`);
  for (let i = start; i <= end; i += 7) {
    const f = frames[i]!;
    const p = plans![i] ?? {};
    console.log(`  t${(f.tick / 120).toFixed(1)} ball ${f.ball.map((v) => Math.round(v)).join(',')} v ${f.bv.map((v) => Math.round(v)).join(',')} | ` + f.cars.map((c) => `${name.get(c.id)} ${Math.round(c.x)},${Math.round(c.y)},${Math.round(c.z)} ${Math.round(c.v)}uu/s b${Math.round(c.boost)}${c.demo ? ' DEMO' : ''}${p[c.id] ? ` [${p[c.id]}]` : ''}`).join(' | '));
  }
  // Top-down strip: 8 panels over the last `secs` seconds.
  const panels: string[] = [];
  for (let k = 0; k < 8; k++) {
    const i = Math.round(start + ((end - start) * k) / 7);
    const f = frames[i]!;
    const p = plans![i] ?? {};
    const S = 0.022;
    const X = (x: number) => 100 + x * S;
    const Y = (y: number) => 125 - y * S * (humanTeams.has(1) ? -1 : 1);
    const trail = frames.slice(Math.max(start, i - 15), i + 1).map((t) => `${X(t.ball[0]).toFixed(1)},${Y(t.ball[1]).toFixed(1)}`).join(' ');
    const cars = f.cars
      .map((c) => {
        const col = c.team === 0 ? '#3b82f6' : '#f97316';
        const hx = Math.cos(c.yaw) * 6;
        const hy = -Math.sin(c.yaw) * 6 * (humanTeams.has(1) ? -1 : 1);
        const human = !log.players.find((pl) => pl.id === c.id)?.bot;
        return `<g opacity="${c.demo ? 0.25 : 1}"><circle cx="${X(c.x)}" cy="${Y(c.y)}" r="${human ? 4.5 : 3.6}" fill="${col}" stroke="${human ? '#fff' : '#000'}" stroke-width="${human ? 1.4 : 0.6}"/><line x1="${X(c.x)}" y1="${Y(c.y)}" x2="${X(c.x) + hx}" y2="${Y(c.y) + hy}" stroke="${col}" stroke-width="1.4"/><text x="${X(c.x) + 5}" y="${Y(c.y) - 4}" font-size="5.5" fill="#fff">${(name.get(c.id) ?? '').replace(' (human)', '★')}${c.z > 150 ? ` ↑${Math.round(c.z)}` : ''}</text><text x="${X(c.x) + 5}" y="${Y(c.y) + 3}" font-size="4.5" fill="#cbd5e1">${p[c.id] ?? ''} b${Math.round(c.boost)}</text></g>`;
      })
      .join('');
    const ox = ARENA.goalHalfX * S;
    panels.push(`<div class="p"><svg viewBox="0 0 200 250" width="300" height="375"><rect x="${X(-4096)}" y="${Y(5120) < Y(-5120) ? Y(5120) : Y(-5120)}" width="${4096 * 2 * S}" height="${5120 * 2 * S}" fill="#14532d" stroke="#94a3b8"/><line x1="${X(-4096)}" y1="125" x2="${X(4096)}" y2="125" stroke="#94a3b8" stroke-width="0.5"/><circle cx="100" cy="125" r="${1000 * S}" fill="none" stroke="#94a3b8" stroke-width="0.5"/><rect x="${100 - ox}" y="${Y(-5120) - (Y(-5120) > 125 ? 0 : 6)}" width="${ox * 2}" height="6" fill="${humanTeams.has(1) ? '#f97316' : '#3b82f6'}" opacity="0.6"/><rect x="${100 - ox}" y="${Y(5120) - (Y(5120) > 125 ? 0 : 6)}" width="${ox * 2}" height="6" fill="${humanTeams.has(1) ? '#3b82f6' : '#f97316'}" opacity="0.6"/><polyline points="${trail}" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="0.8"/><circle cx="${X(f.ball[0])}" cy="${Y(f.ball[1])}" r="${Math.max(2.5, 2 + f.ball[2] / 400)}" fill="#fff"/><text x="${X(f.ball[0]) + 4}" y="${Y(f.ball[1]) + 8}" font-size="5" fill="#fde68a">${f.ball[2] > 200 ? `z${Math.round(f.ball[2])}` : ''}</text>${cars}</svg><div class="t">−${((frames[end]!.tick - f.tick) / 120).toFixed(1)} s</div></div>`);
  }
  html.push(`<section id="g${gi + 1}"><h2>Goal ${gi + 1}: ${who} · ${(g.tick / 120).toFixed(1)} s · by ${name.get(g.e.scorer) ?? '?'}</h2><div class="row">${panels.join('')}</div></section>`);
});
const page = `<!doctype html><meta charset="utf-8"><style>body{background:#0b1020;color:#e2e8f0;font:14px system-ui;margin:12px}h2{font-size:16px;margin:10px 0 6px}.row{display:grid;grid-template-columns:repeat(4,300px);gap:6px}.p{background:#0f172a;border-radius:6px;padding:2px}.t{text-align:center;color:#94a3b8;font-size:12px}</style>${html.join('')}`;
writeFileSync(`${outDir}/goals.html`, page);
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const pg = await b.newPage();
await pg.setViewport({ width: 1260, height: 900 });
await pg.goto(`file://${outDir}/goals.html`);
for (let gi = 0; gi < goals.length; gi++) {
  const el = await pg.$(`#g${gi + 1}`);
  await el?.screenshot({ path: `${outDir}/goal-${gi + 1}.png` });
}
await b.close();
console.log(`\nTop-down strips: ${outDir}/goal-*.png (${outDir}/goals.html)`);
