import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { initPhysics } from '../../shared/src/physics/PhysicsWorld';
import { DEFAULT_SERVER_PORT, PROTOCOL_VERSION, ROOM_NAME } from '../../shared/src/net/Protocol';
import { RaceRoom } from './rooms/RaceRoom';
import { CrownfallRoom } from './rooms/CrownfallRoom';
import { KittensRoom } from './rooms/KittensRoom';
import { RocketRoom } from './rooms/RocketRoom';
import { LastCardRoom } from './rooms/LastCardRoom';
import { FourHundredRoom } from './rooms/FourHundredRoom';
import { PoolRoom } from './rooms/PoolRoom';
import { FpsRoom } from './rooms/FpsRoom';
import { KK_ROOM } from '../../client/src/kittens/net/protocol';
import { CF_ROOM } from '../../client/src/arena/net/protocol';
import { RB_ROOM } from '../../client/src/rocket/net/protocol';
import { LC_ROOM } from '../../client/src/lastcard/net/protocol';
import { FH_ROOM } from '../../client/src/arba3meyeh/net/protocol';
import { PL_ROOM } from '../../client/src/pool/net/protocol';
import { FP_ROOM } from '../../client/src/fps/net/protocol';
import { LAN_MODE, lanAddresses } from './lan';

/**
 * Turbo Tumble game server: Colyseus rooms over WebSockets. If the client has
 * been built (`npm run build`), the same port also serves the game itself, so a
 * single process is all a deployment needs.
 *
 *   PORT=2567 npm run server
 */
const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const dist = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../client/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

type Next = () => void;
interface ExpressLike {
  get(path: string, handler: (req: IncomingMessage, res: ServerResponse) => void): void;
  use(handler: (req: IncomingMessage, res: ServerResponse, next: Next) => void): void;
}

/** Minimal static file handler for client/dist: one page per game, plus the hub at /. */
function serveClient(req: IncomingMessage, res: ServerResponse, next: Next): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/matchmake')) return next();
  let file = normalize(join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist)) return next();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    // Unknown path: fall back to its game's page (first path segment), else the hub.
    const game = join(dist, url.pathname.split('/')[1] ?? '', 'index.html');
    file = game.startsWith(dist) && existsSync(game) ? game : join(dist, 'index.html');
  }
  if (!existsSync(file)) return next();
  res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
  if (file.includes(`${join('dist', 'assets')}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  let body: Buffer = readFileSync(file);
  if (COMPRESSIBLE.has(extname(file)) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    let gz = gzipCache.get(file);
    if (!gz) gzipCache.set(file, (gz = gzipSync(body, { level: 6 })));
    body = gz;
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
  }
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** Text, JS, wasm and glTF compress 2–10×; images are already compressed. */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.wasm', '.glb', '.svg', '.md']);
const gzipCache = new Map<string, Buffer>();

await initPhysics();

const server = new Server({
  transport: new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 3 }),
  greet: false,
  express: (app: ExpressLike) => {
    app.get('/health', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, game: 'turbo-tumble', protocol: PROTOCOL_VERSION, ...(LAN_MODE ? { lan: lanAddresses(), port } : {}) }));
    });
    if (existsSync(join(dist, 'index.html'))) app.use(serveClient);
  },
});
server.define(ROOM_NAME, RaceRoom);
server.define(CF_ROOM, CrownfallRoom);
server.define(KK_ROOM, KittensRoom);
server.define(RB_ROOM, RocketRoom);
server.define(LC_ROOM, LastCardRoom);
server.define(FH_ROOM, FourHundredRoom);
server.define(PL_ROOM, PoolRoom);
server.define(FP_ROOM, FpsRoom);

const latency = Number(process.env.LATENCY ?? 0);
if (latency > 0) {
  server.simulateLatency(latency);
  console.log(`Simulating ${latency} ms latency`);
}

await server.listen(port, '0.0.0.0');
console.log(`Turbo Tumble server listening on :${port}${existsSync(join(dist, 'index.html')) ? ' (also serving client/dist)' : ''}`);
if (LAN_MODE) {
  const ips = lanAddresses();
  console.log('\n  LAN mode — snapshots every tick.');
  console.log(`  This laptop:   http://localhost:${port}/`);
  for (const ip of ips) console.log(`  Other laptops: http://${ip}:${port}/   (e.g. /boostball/, /turbo-tumble/)`);
  if (!ips.length) console.log('  (No local network address found — is Wi-Fi connected?)');
  console.log('  Same Wi-Fi only. If macOS asks, allow "node" to accept incoming connections.\n');
}
