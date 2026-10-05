/**
 * Online soak test: N headless bot clients create/join a room by code, ready up,
 * race (steering from their own snapshots) and return to the lobby.
 * Requires the server: `npm run dev:server` (or `npm run dev`).
 *
 *   npx tsx tools/net-bots.ts [bots=8] [--laps=1] [--cpus=0] [--track=sunny-circuit] [--url=ws://localhost:2567] [--join=CODE] [--stay]
 *
 * --join=CODE  join an existing room (e.g. one a browser created) instead of creating one
 * --stay       keep racing round after round (for browser testing alongside bots)
 */
import { Vector3 } from 'three';
import { Client, type Room } from '../client/node_modules/@colyseus/sdk/build/index.mjs';
import { PROTOCOL_VERSION, ROOM_NAME, Msg, type EventsMessage, type LobbyStateView, type RaceEndMessage, type RaceStartMessage } from '../shared/src/net/Protocol';
import { decodeSnapshot, type RaceSnapshot } from '../shared/src/net/Snapshot';
import { packInput } from '../shared/src/net/InputCodec';
import { getTrack } from '../shared/src/tracks/registry';
import { TrackPath } from '../shared/src/track/TrackPath';
import { Pickups } from '../shared/src/race/Pickups';
import { clamp } from '../shared/src/math/scalar';
import { createEmptyInput } from '../shared/src/types/input';

const args = process.argv.slice(2);
const flag = (name: string, def: string): string => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const count = Number(args.find((a) => !a.startsWith('--')) ?? 8);
const laps = Number(flag('laps', '1'));
const cpus = Number(flag('cpus', '0'));
const url = flag('url', 'ws://localhost:2567');
const joinCode = flag('join', '');
const stay = args.includes('--stay');
const trackId = flag('track', 'sunny-circuit');

const def = getTrack(trackId);
const path = new TrackPath(def);
const pickups = new Pickups(path, def);
const CHARS = ['bix', 'pip', 'zuzu', 'tuko', 'mox'];
const KARTS = ['comet', 'bubblegum', 'sunburst', 'lagoon', 'mocha'];

interface Bot {
  name: string;
  room: Room;
  start: RaceStartMessage | null;
  latest: RaceSnapshot | null;
  seq: number;
  snapshots: number;
  bytes: number;
  maxGap: number;
  lastSnapAt: number;
  events: number;
  end: RaceEndMessage | null;
  hint: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const t0 = performance.now();
const log = (msg: string): void => console.log(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${msg}`);

function wire(bot: Bot): void {
  bot.room.onMessage(Msg.RaceStart, (m: RaceStartMessage) => {
    bot.start = m;
    bot.seq = 0;
    bot.end = null;
    bot.hint = -1;
  });
  bot.room.onMessage(Msg.Snapshot, (bytes: Uint8Array) => {
    const now = performance.now();
    if (bot.lastSnapAt && bot.snapshots > 2) bot.maxGap = Math.max(bot.maxGap, now - bot.lastSnapAt);
    bot.lastSnapAt = now;
    bot.snapshots++;
    bot.bytes += bytes.length;
    bot.latest = decodeSnapshot(bytes, pickups.boxes.length, pickups.coins.length);
  });
  bot.room.onMessage(Msg.Events, (m: EventsMessage) => (bot.events += m.e.length));
  bot.room.onMessage(Msg.RaceEnd, (m: RaceEndMessage) => (bot.end = m));
  bot.room.onMessage(Msg.Notice, (m: string) => log(`${bot.name} notice: ${m}`));
}

const tmp = new Vector3();
const right = new Vector3();
/** Pure pursuit on the centreline, with lane offsets so bots don't stack. */
function drive(bot: Bot, lane: number): number {
  const own = bot.latest?.own[0];
  if (!own || bot.latest?.phase === 'countdown') return packInput({ throttle: bot.latest && bot.latest.time > -0.4 ? 1 : 0, brake: 0, steer: 0, drift: false, item: false }, false);
  const s = own.kart;
  const loc = path.locate(s.position, bot.hint, 30);
  bot.hint = loc.index;
  const ahead = path.frameAtSplineDistance(loc.splineDistance + 12 + Math.max(0, s.forwardSpeed) * 0.35);
  const target = tmp.copy(ahead.position).addScaledVector(ahead.right, lane);
  const to = target.sub(s.position).setY(0).normalize();
  right.crossVectors(s.forward, s.up).normalize();
  const side = to.dot(right);
  const input = createEmptyInput();
  input.throttle = 1;
  input.steer = clamp(side * 3, -1, 1);
  input.item = own.slot.item !== null && Math.random() < 0.02;
  return packInput(input, s.stuckTime > 2.5);
}

async function main(): Promise<void> {
  const bots: Bot[] = [];
  const mk = (i: number, room: Room): Bot => ({ name: `Bot${i + 1}`, room, start: null, latest: null, seq: 0, snapshots: 0, bytes: 0, maxGap: 0, lastSnapAt: 0, events: 0, end: null, hint: -1 });
  const seat = (i: number) => [{ character: CHARS[i % CHARS.length]!, kart: KARTS[(i * 3) % KARTS.length]! }];

  // Error paths first.
  const probe = new Client(url);
  for (const [label, attempt] of [
    ['bad code', () => probe.joinById('ZZZZ', { version: PROTOCOL_VERSION, name: 'x', seats: seat(0) })],
    ['old version', async () => {
      const r = await probe.create(ROOM_NAME, { version: PROTOCOL_VERSION, name: 'tmp', seats: seat(0), visibility: 'private' });
      const code = r.roomId;
      try {
        await new Client(url).joinById(code, { version: 0, name: 'x', seats: seat(0) });
      } finally {
        await r.leave();
      }
    }],
  ] as const) {
    try {
      await attempt();
      log(`✗ ${label}: join unexpectedly succeeded`);
      process.exitCode = 1;
    } catch (e) {
      log(`✓ ${label} refused: ${(e as Error).message}`);
    }
  }

  let code = joinCode;
  if (!code) {
    const host = await new Client(url).create(ROOM_NAME, { version: PROTOCOL_VERSION, name: 'Bot1', seats: seat(0), visibility: 'private', settings: { trackId, laps, racerCount: count + cpus, items: true, difficulty: 'normal' } });
    code = host.roomId;
    bots.push(mk(0, host));
    log(`room ${code} created by Bot1`);
  }
  for (let i = bots.length; i < count; i++) {
    const room = await new Client(url).joinById(code, { version: PROTOCOL_VERSION, name: `Bot${i + 1}`, seats: seat(i) });
    bots.push(mk(i, room));
  }
  bots.forEach(wire);
  log(`${bots.length} bots in room ${code}`);
  await sleep(300);
  const state = (): LobbyStateView => bots[0]!.room.state.toJSON() as LobbyStateView;
  log(`lobby: ${Object.keys(state().members).length} members, host ${state().members[state().hostId]?.name ?? '(browser)'}`);

  let rounds = 0;
  for (;;) {
    for (const b of bots) b.room.send(Msg.Ready, { ready: true });
    await sleep(400);
    if (!joinCode) bots[0]!.room.send(Msg.StartRace);
    // Wait for the start.
    while (!bots.every((b) => b.start)) await sleep(50);
    log(`race ${bots[0]!.start!.raceId} started: ${bots[0]!.start!.racers.length} racers`);

    // Drive at 60 Hz (drift-corrected) until everyone has the race end.
    const lanes = bots.map((_, i) => ((i % 4) - 1.5) * 2.2);
    let next = performance.now();
    let lastReport = 0;
    while (!bots.every((b) => b.end)) {
      for (const [i, b] of bots.entries()) {
        if (b.end) continue;
        b.seq++;
        b.room.send(Msg.Input, [b.seq, drive(b, lanes[i]!)]);
      }
      next += 1000 / 60;
      const now = performance.now();
      if (now - lastReport > 5000) {
        lastReport = now;
        const snap = bots[0]!.latest;
        if (snap) log(`t=${snap.time.toFixed(1)} ${snap.phase} · leader lap ${Math.max(...snap.racers.map((r) => r.progress.lap))} · entities ${snap.entities.length} · ack lag ${bots[0]!.seq - snap.ack} ticks`);
      }
      await sleep(Math.max(0, next - performance.now()));
    }
    const end = bots[0]!.end!;
    const elapsed = bots[0]!.latest?.time ?? 0;
    log(`race over after ${elapsed.toFixed(1)} s`);
    for (const r of end.rows) console.log(`   ${String(r.position).padStart(2)}. ${r.name.padEnd(8)} ${r.finished ? r.time.toFixed(2) + 's' : 'DNF'}  +${r.points}`);
    for (const b of bots) {
      const secs = Math.max(1, elapsed + 5);
      console.log(`   ${b.name}: ${b.snapshots} snapshots (${(b.snapshots / secs).toFixed(1)}/s), ${(b.bytes / secs / 1024).toFixed(1)} KiB/s, max gap ${b.maxGap.toFixed(0)} ms, ${b.events} events`);
      b.snapshots = b.bytes = b.maxGap = b.lastSnapAt = b.events = 0;
    }
    rounds++;
    // Back to the lobby after the results timer.
    while (state().phase !== 'lobby') await sleep(200);
    log(`back in lobby; points: ${Object.values(state().members).map((m) => `${m.name} ${m.points}`).join(', ')}`);
    for (const b of bots) b.start = null;
    if (!stay) break;
    log(`round ${rounds + 1}…`);
  }
  for (const b of bots) await b.room.leave();
  log('done');
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
