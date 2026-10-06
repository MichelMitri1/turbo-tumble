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
npm run lan          # same, in LAN mode for zero-lag play on your home Wi-Fi (see below)
npm run typecheck    # shared + client + server
```

The site opens on the **arcade hub** (`/`, one card per game — registry in
`client/src/hub/games.ts`); Turbo Tumble lives at `/turbo-tumble/`. **Fullscreen** is in the
hub, the game menu and the pause menu, or press **F** anywhere.

Opening the game shows the **main menu** (over a live CPU race): pick Single Race,
Grand Prix, Time Trial or Online, players (1–4), racer/kart, CPU difficulty, laps and items.
**Controls & Sound** in the menu rebinds keys/buttons, sets music / sound volume and the stick dead zone (M mutes anytime).

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

- **Same house, no lag (LAN):** on one laptop run `npm run lan`. It prints an address like
  `http://192.168.1.20:2567/turbo-tumble/` — every laptop on the same Wi-Fi opens it (the
  host can use `localhost`). Online then shows **LAN PLAY** with that address; Create room /
  Quick match as usual. LAN mode sends snapshots every tick (60 Hz) and other karts are drawn
  ~45 ms behind instead of ~100 ms; ping is ~1 ms. If macOS asks, allow `node` incoming
  connections; guest Wi-Fi networks that isolate devices won't work.
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

## Tracks & cups

24 tracks in 6 Grand Prix cups, rated easy / medium / hard (pick a **Track** for Single
Race / Time Trial / online, a **Cup** for Grand Prix):

| Cup | Tracks |
| --- | --- |
| Sunny Cup (easy) | Sunny Circuit · Palm Bay · Harvest Lane · Maple Glen |
| Splash Cup (medium) | Coral Cove · Pinewood Pass · River Rapids · Dune Canyon |
| Wild Cup (medium) | Mushroom Hollow · Temple Ruins · Jungle Falls · Sunset Coast |
| Thunder Cup (medium–hard) | Frost Peak · Neon Metro (figure-8 overpass) · Moonlit Marsh · Clockwork Factory |
| Extreme Cup (hard) | Volcano Run · Sky Garden (floating) · Glacier Gauntlet · Thunder Ridge |
| Cosmic Cup (hard) | Starlight Highway · Magma Core · Comet Coaster (floating figure-8) · Prism Road (rainbow) |

Laps are 2.2–2.75 km (about 75–85 s each) of irregular corners: kinks, sweepers,
tightening curves, esses, chicanes, hairpins and carousels at all sorts of angles, plus
climbs and drops; Neon Metro and Comet Coaster are figure-8s with an overpass.

Course identity (name, theme, difficulty, road style, traffic) lives in
`shared/src/tracks/courses.ts`; layouts live in `shared/src/tracks/layouts.ts`, written
in the course language (`course.ts`): straights, left/right turns, `up` for hills and
per-segment features — `kind: 'void'` (an unrailed deck over a chasm: fall off and you
respawn at the last checkpoint), `jump: { gap }` (a ramp over a hole in the road),
`stream` (water / neon / wind / lava currents that push you faster), `movers`, hazards,
boost pads and named `mark`s that `shortcuts` connect with a dirt trail.

Layouts are generated by `npx tsx tools/design-courses.ts [trackId…]` from the recipes in
`tools/course-recipes.ts` (corner mix, target length, hills, which features) and can be
hand-edited afterwards. The designer tries thousands of candidates per course, keeps one
that closes cleanly without overlapping itself, and places the features.

**Moving obstacles** (`shared/src/race/Movers.ts`, visuals in
`client/src/tracks/builders/MoverBuilder.ts`) move as a pure function of the race clock,
so the server and every client agree without extra network traffic:

| Obstacle | What it does |
| --- | --- |
| Stomper | Piston block that shakes, then slams down — squishes you (solid while down) |
| Roller | Boulder / snowball / hay bale rolling side to side — tumbles you |
| Sweeper | Spinning striped arm on a post — spins you out |
| Pendulum | Spiked wrecking ball swinging across the road from a gantry — tumbles you |
| Geyser | Vent that bubbles, then erupts (water, steam, fire…) — launches you |
| Cruiser | Slow traffic driving round the lap (Neon Metro, Sunset Coast) — spins you out |

CPUs score lanes across the road against every obstacle at the moment they'll arrive (ease off to time a gap when none is clear), and skilled CPUs take the dirt shortcuts.
`npx tsx tools/check-tracks.ts --race` validates every track (self-overlap, corner radius,
ramp flights, CPU falls, obstacle hits, CPU race finishes); `npx tsx tools/plot-tracks.ts`
draws top-down maps; `npx tsx tools/check-terrain.ts` reports any terrain poking through a road.

Most courses have one or two jump ramps. Gold boost pads
lead into each ramp; airborne coin arcs mark the landing line. Press Hop/Drift again
in the air (Space on keyboard) to spin a trick and earn a landing turbo. Air steering
lets you adjust your landing. Stay behind another moving kart for 1.2 seconds to
charge a **slipstream**: wind streaks and a HUD readout build up, then release a
two-second boost. Jump and slipstream physics are shared with online prediction.
Time Trial records use a new storage version for these longer layouts; old recordings
remain stored separately.

## Sound, animation & effects

- **All audio is synthesised in the browser** (Web Audio) — no sound files, so everything is
  original: engines (pitch follows speed, brightness follows throttle, tyre squeal while
  drifting, wind, off-road rumble), ~50 effects (countdown, drift sparks, mini-turbos, every
  item, hits, explosions, coins, crowd cheers, menu blips) and the music, written as step data
  in `client/src/audio/music/songs.ts`: *Sunny Circuit* (race), *Garage Groove* (menus),
  *Podium* (results) and stingers (intro, final lap — then the theme speeds up a semitone
  higher —, win / finish / lose). Sounds are positioned around the nearest player's camera
  (works in split-screen). **M** mutes; music and sound volume are in *Controls & Sound*.
  Browsers only allow sound after a click or key press (a hint shows until then).
- **Engines** are hybrids: each kart's engine has real recordings (Jaguar 5.0 supercharged
  V8, Lexus LFA V10, Ferrari 458 V8, Porsche 997 GT3 RS flat-six, Lamborghini Aventador V12 —
  CC BY-SA from Wikimedia Commons, credits in `client/public/assets/audio/engines/LICENSES.md`)
  pitch-tracked and cut into steady RPM loops by `tools/make-engine-loops.mjs`; the designed
  synth voice covers idle and revs outside each recording's range.
- **Drivers** are animated procedurally: lean and look into turns, countdown bounce, lunge on
  item throws, lean back on boosts / rocket starts, shake when hit, stretch in the air, glance
  back at projectiles closing in, cheer (top 3) or sulk at the finish. Each character has a
  springy signature topper (Bix antenna, Pip pom-poms, Zuzu fin crest, Tuko propeller beanie,
  Mox horns) and a scarf that streams with speed, so racers read from behind.
- **Effects**: tyre marks on tarmac, wall-scrape sparks, landing dust, drift-stage flashes,
  item trails, idle exhaust, rocket-start burst, respawn beam, finish confetti and a finish
  camera that swings round to the driver while results show.

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
- **Grand Prix** — pick one of six cups: four races, points (15-12-10-9-8-7-6-5…),
  standings after each race, grid ordered by the standings, trophy podium at the end.
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
  audio/               AudioEngine (buses, settings, unlock, split-screen spatialiser), synth +
                       sfx (every sound effect), EngineVoice, SoundBoard, RaceAudio (events →
                       sound, music flow), music/ (Song format, MusicPlayer sequencer, songs)

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

## Crownfall Arena (`/arena-crown/`)

A real-time 3D card battler (two lanes, three crowns, elixir) with 122 cards — every
troop, building and spell role from the genre, each with a real animated model
(Quaternius + Kenney CC0, see `client/public/assets/arena/LICENSES.md`). Code in
`client/src/arena/`: `engine.ts` (30 Hz battle sim), `ai.ts` (Easy/Normal/Hard rival),
`cards.ts` (roster + stats + visuals), `arena3d.ts` (scene, units, effects), `main.ts` (UI).

- `node tools/arena-assets.mjs <packs dir>` — convert the source packs to compact GLBs (+ manifest)
- `npx tsx tools/arena-prune.ts` — drop models no card uses
- `node tools/arena-portraits.mjs [dev url]` — bake card portraits
- `npx tsx tools/arena-sim.ts 60 --blue=hard --red=easy` — headless AI tournament (crashes, balance, difficulty)
- **Online / LAN 1v1:** menu → *Online · LAN* → Create room (share the 4-letter code or invite
  link), Quick match, or join a code. The game server (`server/src/rooms/CrownfallRoom.ts`) runs the
  real battle engine; clients only send card plays and render 15 Hz snapshots (30 Hz in LAN mode).
  The guest's board is mirrored so both players fight from the bottom. Same LAN flow as Turbo
  Tumble: `npm run lan` on one laptop, everyone opens the printed address + `/arena-crown/`.
  Rematches alternate sides; leaving mid-battle forfeits after a 20 s reconnect window.
- Dev: `/arena-crown/gallery.html?p=m-` shows models; `?battle` jumps straight in; `?debug` → I infinite elixir, F fast-forward

## Tools

- `npx tsx tools/ai-bench.ts [easy|normal|hard] [track…]` — CPU lap-time benchmark on every track (tuning AIDifficulty).

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
npx tsx tools/check-tracks.ts [trackId…] [--race]  # every track: length, tightest corner, CPU race
node tools/track-tour.mjs <url> <outDir> [trackId…]    # loads each track in Chrome, screenshots + fps
node tools/audio-check.mjs <url> <outDir> [--songs=30]
                                               # renders every SFX + song offline in Chrome:
                                               # level / clipping / length check + WAVs to audition
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
| 6 | Synthesised audio (engines, SFX, original music), procedural driver animation + toppers/scarves, VFX polish, finish camera | ✅ |
| 7 | 11 new tracks (12 total) in 3 cups, themes (tropical, farm, alpine, desert, autumn, dusk, ruins, snow, sunset, night city, volcano), runtime track switching, track/cup menus, online track choice, 4 new songs | ✅ |
| 7b | More racers, kart select screen | next |
| 8 | Optimisation, balance, full test pass | |
