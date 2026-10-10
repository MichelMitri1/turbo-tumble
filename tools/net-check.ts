/**
 * Online health check (no browser): a Node client joins each real-time game, starts it, and
 * reports whether the fast lane (WebRTC, unreliable) opened, how many snapshots arrived and
 * over which path, their spacing, and the round-trip time over the lane.
 *
 *   npx tsx tools/net-check.ts [host:port=localhost:2600]
 *
 * Needs a running game server (e.g. LAN=1 PORT=2600 npx tsx server/src/index.ts).
 */
import { RTCPeerConnection } from 'node-datachannel/polyfill';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { Room } from '@colyseus/sdk';
import { FastLane } from '../client/src/net/fastlane';

(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = RTCPeerConnection;
// The SDK lives in client/node_modules.
const sdkPath = createRequire(new URL('../client/package.json', import.meta.url)).resolve('@colyseus/sdk');
const { Client } = (await import(pathToFileURL(sdkPath).href)) as typeof import('@colyseus/sdk');
const host = process.argv[2] ?? 'localhost:2600';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Game {
  name: string;
  room: string;
  join: object;
  snap: string;
  ping?: string;
  start?: (room: Room, lane: FastLane) => void;
}
const GAMES: Game[] = [
  { name: 'Zero Hour', room: 'zerohour', join: { version: 4, name: 'check', visibility: 'private' }, snap: 'fp:snap', ping: 'fp:ping', start: (r) => r.send('fp:start') },
  { name: 'Boostball', room: 'boostball', join: { version: 3, name: 'check', body: 'octane', visibility: 'private' }, snap: 'rb:snap', ping: 'rb:ping', start: (r) => r.send('rb:start') },
  { name: 'Matchday', room: 'football', join: { version: 1, name: 'check', visibility: 'private' }, snap: 'fb:snap', ping: 'fb:ping', start: (r) => (r.send('fb:hello'), r.send('fb:start')) },
  { name: 'Starfall', room: 'starfall', join: { version: 2, name: 'check', color: 0, visibility: 'private' }, snap: 'sf:snap', start: (r) => (r.send('sf:config', { bots: 5 }), r.send('sf:start')) },
  { name: 'Velora', room: 'velora', join: { version: 1, name: 'check', model: 'casual', visibility: 'private' }, snap: 'vl:snap', start: (_r, lane) => lane.send('vl:state', { x: 0, y: 0, z: 0, h: 0, pose: 'idle', gun: '', alive: true, wanted: 0, car: null, parked: null, model: 'casual' }) },
];

for (const g of GAMES) {
  const sdk = new Client(host.includes("://") ? host : `ws://${host}`);
  let room: Room;
  try {
    room = await sdk.create(g.room, g.join);
  } catch (e) {
    console.log(`${g.name.padEnd(10)} could not join: ${(e as Error).message}`);
    continue;
  }
  for (const t of ['fp:lobby', 'fp:begin', 'fp:events', 'fp:err', 'rb:lobby', 'rb:begin', 'rb:events', 'rb:stats', 'rb:err', 'fb:lobby', 'fb:begin', 'fb:events', 'fb:stats', 'fb:err', 'vl:welcome', 'vl:feed', 'sf:lobby', 'sf:begin', 'sf:err', 'rb:ev', 'fb:ev', 'rtc:answer', 'rtc:ice']) room.onMessage(t, () => undefined);
  const lane = new FastLane(room);
  const arrivals: number[] = [];
  let viaLane = 0;
  // Count which path each snapshot took (the lane hands us a subarray / parsed JSON both ways, so tag via the lane's open state).
  lane.on(g.snap, () => {
    arrivals.push(performance.now());
    if (lane.open) viaLane++;
  }, { latestOnly: true });
  const rtts: number[] = [];
  if (g.ping) lane.on(g.ping, (m: { t: number }) => rtts.push(performance.now() - m.t));
  for (let k = 0; k < 40 && !lane.open; k++) await sleep(100);
  const opened = lane.open;
  g.start?.(room, lane);
  const t0 = performance.now();
  while (performance.now() - t0 < 4000) {
    if (g.ping) lane.send(g.ping, { t: performance.now() });
    if (g.name === 'Velora') lane.send('vl:state', { x: 0, y: 0, z: 0, h: 0, pose: 'idle', gun: '', alive: true, wanted: 0, car: null, parked: null, model: 'casual' });
    await sleep(100);
  }
  const gaps = arrivals.slice(1).map((t, i) => t - arrivals[i]!);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const p95 = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)]! : 0);
  console.log(`${g.name.padEnd(10)} lane ${opened ? 'OPEN' : 'closed (WebSocket fallback)'} · snapshots ${arrivals.length} (${viaLane} on the lane) · gap avg ${avg(gaps).toFixed(1)} p95 ${p95(gaps).toFixed(1)} ms · lane RTT ${rtts.length ? `${avg(rtts).toFixed(1)} ms` : '-'}`);
  lane.close();
  await room.leave(true).catch(() => undefined);
}
process.exit(0);
