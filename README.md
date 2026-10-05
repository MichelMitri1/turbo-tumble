# Turbo Tumble

A browser-based 3D arcade kart racer — original characters, tracks and branding.
TypeScript · Vite · Three.js · Rapier 3D · Colyseus.

## Run

```bash
npm install
npm run dev          # game http://localhost:5173 (next free port if taken) + game server :2567
npm run dev:client   # just the game (offline modes)   · npm run dev:server — just the server
npm run build        # type-check + production bundle (client/dist)
npm start            # build, then ONE process on :2567 serves the game and the online rooms
npm run typecheck    # shared + client + server
```

Opening the site shows the **main menu** (over a live CPU race): pick Single Race,
Grand Prix, Time Trial or Online, players (1–4), racer/kart, CPU difficulty, laps and items.
**Controls** in the menu rebinds keys/buttons and sets the stick dead zone.

### Local multiplayer (split-screen)

Set *Players* to 2–4 and press Start. On the **Who's racing?** screen each player joins
with their own device — any button on a controller, **WASD + Space** (left half of the
keyboard) or **Arrows + /** (right half) — then picks a racer (←→) and kart (↑↓) and
readies up (Ⓐ / Space / `/`). Any mix of keyboard halves and up to four controllers works.
2 players can split top/bottom or side by side; 3 players get a 2×2 grid whose fourth
quarter is a live TV camera; 4 players a 2×2 grid.

### Online multiplayer

Pick **Online** in the menu (Players 2–4 first if you want split-screen *online*) → enter a
name → **Create room** (private, share the 4-letter code or **Copy invite link**), **Quick
match** (joins any open public room or opens one) or type a code and **Join**. In the lobby
everyone readies up; the host picks laps, items, grid size (CPUs fill empty slots, or humans
only) and CPU difficulty, then starts. Up to **8 human racers per room** (any mix of
browsers and split-screen seats) plus CPUs up to 12. After each race the room shows results
with Grand Prix points, keeps a running points total and returns to the lobby.

- **Friends on your Wi-Fi/LAN:** run `npm run dev`, they open `http://<your-ip>:5173`
  (the game finds the server on the same host, port 2567).
- **Over the internet:** deploy `npm start` on any Node host (it serves the game and the
  rooms on one port, `PORT` env to change it), or point a client at a server with
  `?server=host:port`.
- Dropped connections reconnect automatically (20 s seat hold; your kart is on autopilot
  meanwhile). Esc during an online race opens the menu without pausing (Leave Room there).

Testing latency on one machine: `?lag=150&jitter=20` adds simulated round-trip lag to that
browser; `LATENCY=100 npm run dev:server` delays the server side. F3 shows the net line
(RTT, snapshot rate, bandwidth, unacknowledged inputs, mean correction).

| Param | Example | Effect |
| --- | --- | --- |
| `room` | `?room=K7QX` | Invite link: opens Online with the code filled in |
| `server` | `?server=192.168.1.20:2567` | Game server address (default: this host :2567 in dev, same origin in production) |
| `lag`, `jitter` | `?lag=150&jitter=20` | Simulated round-trip latency in ms (testing) |

### Dev launch parameters (skip the menu)

| Param | Example | Effect |
| --- | --- | --- |
| `mode` | `?mode=race` / `grandprix` / `timetrial` | Start straight into a mode |
| `cpu` | `?cpu=easy` / `normal` / `hard` | CPU difficulty |
| `track` | `?track=sunny-circuit` | Track id from `shared/src/tracks/registry.ts` |
| `char`, `kart` | `?char=pip&kart=lagoon` | Driver and kart body are chosen independently |
| `players` | `?players=2` … `4` | Split-screen preview (P1 WASD, P2 arrows, P3/P4 pads) |
| `split` | `?split=vertical` | 2-player side-by-side instead of stacked |
| `racers`, `laps`, `items` | `?racers=8&laps=3&items=0` | Field size (CPUs fill the grid), lap count, items on/off |
| `lowgfx` | `?lowgfx` | 1024 shadows, 1× pixel ratio, half decoration density |

## Controls

| Action | Keyboard | Controller (standard mapping) |
| --- | --- | --- |
| Accelerate | W / ↑ | A or RT (analog) |
| Brake / reverse | S / ↓ | B or LT (analog) |
| Steer | A D / ← → | Left stick (radial dead zone) or D-pad |
| Hop / drift (hold + steer) | Space | RB or X |
| Use item (hold to keep it behind you as a shield) | Shift | LB or Y |
| Throw backwards | hold S/↓ while releasing the item | hold B/LT |
| Reset kart | R | View / Share |
| Pause | Esc | Menu / Options |
| Debug panel / colliders / racing line | F3 (or \`) / F4 / F5 | — |

Keyboard bindings are rebindable through `InputManager.rebindKey()` and persist in `localStorage`
(the settings UI lands in Phase 7).

## Racing

- **Drift:** hold Space and steer to hop into a drift; the stick tightens or widens the arc.
  Sparks go cyan → orange → magenta; release for a mini-turbo (bigger each stage).
- **Rocket start:** hit the throttle just as the last light goes out — too early stalls you.
- **Boost pads, coins** (each coin = a little top speed, max 10, lose 3 when hit),
  **kart-to-kart bumping** (weight-based), checkpoint-gated **laps**, live **positions**,
  **wrong-way** warning, results screen, restart.
- **CPU field** (8 racers by default): lanes, trap avoidance, drifting, item tactics.

## Modes

- **Single Race** — one race vs. 7 CPUs (Easy / Normal / Hard).
- **Grand Prix** — the Sunny Cup: four races, points (15-12-10-9-8-7-6-5…), standings
  after each race, grid ordered by the standings, trophy podium at the end. (The cup
  repeats Sunny Circuit until more tracks arrive in Phase 7.)
- **Time Trial** — solo with a Fizz Six-Pack; your best run is saved locally and races
  you as a translucent ghost; lap splits and record on the HUD.

HUD: item slot, position, lap, coins, race timer with lap splits, live standings list,
minimap (racers, item boxes, Crown Buster, ghost).

## CPU racers

- Follow a computed **racing line** (`shared/src/track/RacingLine.ts`: minimum-curvature
  relaxation inside the road + a curvature speed profile with braking zones), blended with a
  personal lane so the pack spreads out.
- Overtake slower karts, dodge traps, drift through tight corners for mini-turbos, recover
  when stuck, and use items tactically.
- Difficulty sets speed, line discipline, drift and item skill. Pack balancing is mild:
  CPUs far ahead of every human ease off ≤5%, hopeless back-markers get ≤6% — no
  rubber-band teleporting.

## Items

Every classic kart-racer item role, with original names and original 3D models
(`client/src/items/ItemModels.ts`; HUD icons are rendered from those models at load).
Distribution is position-aware: leaders get defensive items, the back of the pack gets
catch-up items; only one Crown Buster can be in play and Zap Storm has a cooldown.

| Item | Role | Use |
| --- | --- | --- |
| Turbo Fizz / Fizz Six-Pack | single / triple speed boost | press |
| Golden Fizz | unlimited boosts for 7.5 s | press repeatedly |
| Bumper Puck / Puck Trio | straight shot that ricochets off walls (×3 orbit as a shield) | hold = shield, release = fire |
| Seeker Drone / Drone Squad | homes in on the racer ahead (×3 orbit) | hold / release |
| Crown Buster | flies over the field to 1st place and explodes | press |
| Goo Blob / Goo Chain | slippery trap dropped behind (×3 trail) | hold / release |
| Boom Ball | lobbed bomb with a big blast radius | hold / release |
| Decoy Box | fake prize box trap | hold / release |
| Paint Splat | splatters the screens of everyone ahead | press |
| Zap Storm | every rival spins, shrinks (can be squashed) and loses items | press |
| Hyper Prism | invincible, faster, ignores off-road, bowls karts over | press |
| Jet Rocket | autopilot rocket form that blasts through traffic | press |
| Ember Blaster | bouncing fireballs for 5 s | press repeatedly |
| Whirl-a-rang | boomerang that returns — three throws | press |
| Snapper Pot | plant on your nose chomps nearby racers & items; press to lunge | press |
| Blast Horn | shockwave: knocks back nearby racers, destroys items (incl. Crown Buster) | press |
| Octo Orbit | eight assorted items circling you, used one by one | press |
| Spark Coins | +2 coins | press |
| Quake Block | after three pulses, grounded racers ahead spin out — hop to dodge | press |

## Architecture

```
shared/src/            Pure game logic — runs in the browser AND in Node (future server)
  constants/           Tick rate (60 Hz fixed), gravity, limits
  types/               PlayerInput, SurfaceType, TrackDefinition schema
  math/                Scalar helpers, seeded RNG, 2D noise
  physics/             PhysicsWorld: Rapier used as a collision/query engine
  track/               TrackPath (spline → banked samples, track-space queries),
                       TerrainField (heightfield shaped around the track),
                       Extrude (profile sweeps), TrackGeometry/TrackColliders, spawn grid
  tracks/              Track definitions (data) + registry
  vehicles/            KartState, KartStats, KartSimulation (arcade integrator: drift,
                       mini-turbos, boosts, hit reactions, status effects)
  race/                RaceSimulation (authoritative race loop), LapTracker, Pickups, events
  items/               ItemTypes (catalogue), ItemDistribution, ItemSystem (slots, global
                       effects), ItemEntities (projectiles, traps, explosions, collisions)
  ai/                  AIDriver (CPU racing + item tactics), AIDifficulty
  race/GrandPrix       Cup points & standings · tracks/cups — cup definitions
  roster/              Driver & kart ids, names, stat deltas, CPU field (shared by client + server)
  net/                 Protocol (messages, room settings, limits), InputCodec (1 int per seat),
                       StateCodec (typed field layouts) + Snapshot (binary race snapshots)

client/src/
  core/GameLoop        Fixed-timestep loop with render interpolation
  game/Game            App: renderer, track, loop, main menu, pause, mode flow (GP / TT)
  game/RaceSession     One race: simulation, karts, items, players or spectator camera
  game/SessionConfig   Modes and field building · game/Ghost — Time Trial ghosts/records
  game/RacePresenter   Race events → HUD banners, camera kicks, VFX, start lights
  game/OnlineFlow      Online mode: connect / lobby / race hand-off, reconnect toasts
  net/                 NetClient (Colyseus SDK wrapper, lag simulation, ping — lazy-loaded),
                       NetRaceSync (prediction, reconciliation, interpolation), interpolate
  assets/              AssetManifest (all paths live here) + AssetLoader (lazy, cached glTF)
  rendering/           Renderer (multi-viewport scissor), ChaseCamera, Sky, Lighting,
                       Water, ProceduralTextures, InstancedModel, ViewportLayout
  tracks/              TrackBuilder → builders (terrain, road, bridge, tunnel),
                       landmarks (registry of procedural set pieces), decor scatter
  vehicles/            KartModelFactory (driver × body composition), KartView, KartEntity
  input/               InputManager, KeyboardState, GamepadState, bindings
  players/             LocalPlayer (device + kart + camera + HUD + viewport + netId)
  items/               ItemModels (procedural 3D item assets), IconStudio, ItemViews
  vfx/                 Particles (GPU billboards), Effects (sparks, flames, explosions…)
  ui/                  Loading screen, main menu, HUD (timer, standings, minimap), GP panel,
                       pause, debug overlay, join screen, controls, online screens
  config/              Camera tuning, graphics settings, racer/kart roster (models, colours)
  audio/               — Phase 6

server/src/
  index.ts             Colyseus server (WebSocket transport) + static client/dist + /health
  rooms/RaceRoom       Lobby (codes, members, settings, ready-up, host migration,
                       reconnection) → races → results/points → lobby
  race/ServerRace      Authoritative 60 Hz RaceSimulation, per-client input queues, snapshots
  state/LobbyState     Colyseus schema for the lobby · matchmaking/RoomCodes · simulation/TrackWorld
tools/                 Dev tooling (see below)
```

**Key decisions**

- **Arcade handling on top of Rapier.** Rapier answers "where is the ground" (raycasts) and
  "what wall did I hit" (kinematic character-controller sweeps). Velocity, steering, grip,
  slopes, hops and wall bounces are our own deterministic integrator in
  `shared/src/vehicles/KartSimulation.ts`, so handling is fully tunable and the identical
  code can run on the server for authority and on clients for prediction/reconciliation.
- **Tracks are data.** A `TrackDefinition` describes the centerline (with per-point width,
  shoulder and segment kind: ground / bridge / tunnel), spawn grid, checkpoints, terrain
  (noise, hills, lakes), lighting, sky, decoration (props, scatter rules, landmarks), music,
  and gameplay objects (boost pads, item boxes, hazards, shortcuts — consumed in later
  phases). Road, curbs, walls, terrain, bridges, tunnels and colliders are all generated from
  it. Placements are in track space (lap distance + lateral) so they survive layout edits.
- **Split-screen ready.** Every local player owns a camera, HUD and viewport; the renderer
  draws N scissored viewports from one scene. Online, one client can bring several seats.
- **Server-authoritative netcode.** The server runs the same `RaceSimulation` at 60 Hz and
  applies exactly one input per client per tick. Clients send one packed integer per seat
  per tick and receive ~30 binary snapshots/s (~30 KiB/s for 8 karts): a compact section
  for every kart/item plus full-precision state for their own karts. Own karts are
  **predicted** with the quantised input the server will see, then **reconciled** (rewind
  to the acknowledged state, replay unacknowledged inputs, smooth the visual difference);
  other karts and items are **interpolated** 100 ms in the past. Race events (hits, laps,
  item use…) arrive as an ordered stream for the presenter. Lobby state uses Colyseus schema.
- **Lazy assets.** The manifest maps ids → files; tracks declare the models they need and
  only those are loaded.

## Tools

```bash
npx tsx tools/sim-lap.ts [trackId] [laps]      # headless: autopilot laps on the real colliders
npx tsx tools/sim-race.ts [racers] [laps] [--cycle-items] [--seed=N] [--cpu=easy|normal|hard] [--no-items]
                                               # headless full race with items; --cycle-items
                                               # forces every item into rotation
npx tsx tools/dump-track-layout.ts [trackId]   # sampled layout JSON (length, min radius…)
node tools/smoke.mjs <url> <outDir> --script=menu|gp|tt|line|drive|drift|race|items|spectacle|finish|icons|tour|views|systems|idle

npx tsx tools/net-codec-test.ts                # snapshot/input codecs + replay determinism
npx tsx tools/net-bots.ts [bots=8] [--laps=1] [--cpus=0] [--join=CODE] [--stay]
                                               # headless bot clients race a room (server needed)
node tools/online-smoke.mjs <url> <outDir> [--lag=150] [--jitter=20] [--bots=4] [--drop]
                                               # two browsers through the real UI: create, invite,
                                               # race, smoothness, reconnect (--drop), leave
node tools/online-flow.mjs <url> <outDir>      # room lifecycle: results/points → lobby,
                                               # mid-race join refusal, quick match
```

`smoke.mjs` drives the game in local Chrome (puppeteer-core): screenshots, telemetry,
console errors. `systems` injects a virtual standard gamepad and checks input, dead zone,
pause and resize. Set `CHROME_PATH` if Chrome isn't in `/Applications`.

## Assets

All bundled 3D models are CC0 by [Kenney](https://kenney.nl) — see
`client/public/assets/LICENSES.md`. Sponsor brands, logos, textures, the track and all
procedural geometry are original. Folder layout: `client/public/assets/{characters,karts,
tracks,environment,items,animations,textures,particles,audio,ui}`.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Setup, architecture, renderer, Sunny Circuit, real kart, chase camera, driving | ✅ |
| 2 | Drift + mini-turbos, boost pads, kart collisions, checkpoints, laps, countdown, rocket start, **full item set**, basic CPU field, race HUD, results | ✅ |
| 3 | Racing lines, AI difficulty & overtaking, minimap, timers, standings, Grand Prix, Time Trial + ghosts, main menu | ✅ |
| 4 | Join screen & device assignment, 1–4P menus, split layouts, controls rebinding, per-viewport framing, faster karts + speed lines | ✅ |
| 5 | Colyseus server, rooms/codes, quick match, lobby + ready-up, 8 online humans (+ online split-screen), prediction + reconciliation + interpolation, reconnection, results/points | ✅ |
| 6 | Audio, character animation, VFX polish (items & core particles done in Phase 2) | next |
| 7 | Neon Metro, Volcano Run, more racers, menus, kart select | |
| 8 | Optimisation, balance, full test pass | |
