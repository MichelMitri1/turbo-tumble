# Starfall

A top-down social-deduction game at `/starfall/`, built after the classic crewmates-vs-impostors formula. Play it against bots, online with friends (private codes or Quick Match), or on a LAN. Empty seats are filled by bots.

## The game

- **4–15 players**, 1–3 impostors. The settings mirror the original lobby: kill cooldown, crewmate and impostor vision, emergency meetings, discussion and voting time, confirm ejects, anonymous votes, the number of common, long and short tasks, and visual tasks.
- **Crewmates** do tasks to fill the shared task bar, report bodies, call emergency meetings and vote. Dead crewmates come back as ghosts: they pass through walls and keep doing tasks.
- **Impostors** fake tasks and kill (with a cooldown, and the killer lands on the body). They travel through linked vents and sabotage:
  - lights cut crew vision to a quarter;
  - comms hides tasks, admin and cameras;
  - doors close a room for 10 s;
  - critical sabotages: reactor (two hand scanners held at once), O2 (a keypad code at two panels) or seismic stabilizers. If the crew doesn't fix one in time, the impostors win.
- **Meetings:** "Dead body reported" or "Emergency meeting", then discussion and voting on the tablet with chat. Skips and ties eject no one. The ejection screen depends on the map: drifting into space, falling through the clouds, or into lava.
- **Vision:** walls block sight and furniture doesn't. Outside your vision the map is dark and players disappear.

## Starfall 3D (`/starfall-3d/`)

The same game drawn in 3D: the same page code with `data-view="3d"`, which swaps the renderer for `render3d/`.
- `render3d/models.ts`: crewmates, bodies, ghosts and props built from primitives, with inverted-hull outlines.
- `render3d/world3d.ts`: walls built from the room outlines (with gaps where the floor carries on), sinking doors and flipping vent lids.
- **Vision fog:** a shader darkens everything outside your sight, using the same ray-cast polygon as the 2D game.
- **First person:** eyes at visor height with a little walking bob, and ceilings over every room.
  - Click to grab the mouse and look around. On a controller the right stick looks; on touch, drag the screen.
  - WASD / the left stick move relative to where you look.
  - In a vent you peek out from floor level.
- **Name tags** shrink with distance. Sabotage arrows point by bearing (up = straight ahead).
- **Top-down chase camera:** still in the code. `placeCamera()` is used when no `fp` option is passed.
- **Security cameras** show the 3D scene from each camera.
- **Everything else is shared** (rules, bots, tasks, meetings, HUD, maps, online). 2D and 3D players can be in the same online room.

## Maps (`sim/maps.ts`)

| Map | After | Highlights |
| --- | --- | --- |
| Vanguard | the ship | 14 rooms, 13 doors, 13 vents in 4 networks, cameras, admin table; reactor / O2 / lights / comms |
| Stratus HQ | the sky HQ | launchpad → decontamination → long hallway, labs, greenhouse, balcony; no doors, all vents in one ring |
| Frostfall | the ice planet | buildings around snowfields, dropship, specimen room, vitals; seismic / lights / comms |

## Tasks (`ui/panels.ts`)

There are 39 task minigames, plus the sabotage panels:

- **Vanguard (the ship):** swipe card, wires, download/upload, fuel, garbage chute, asteroids, prime shields, O2 filter, chart course, steering, align engines, calibrate distributor, divert/accept power, inspect sample, medbay scan, Simon-says reactor, manifolds.
- **Stratus HQ (the sky HQ):** buy beverage, water plants, ID code, weather, assemble artifact, run diagnostics, process data, sort samples.
- **Frostfall (the ice planet):** fill canisters, insert keys, waterways, temperature, reboot wifi, repair drill, water jug, boarding pass, store artifacts, telescope, weather node, monitor tree.

Long waits (sample 60 s, diagnostics 90 s, wifi 60 s) keep running if you walk away.

## Code

- `sim/`: the rules, shared by the browser and the server.
  - `geom.ts`: a 0.25 m collision and vision grid, sliding movement, ray casting, and A* with a cached clearance mask.
  - `maps.ts`: the three maps.
  - `game.ts`: rules and win conditions.
  - `bots.ts`: crew and impostor AI, including meeting talk and votes.
  - `view.ts`: what each player may see. Ghosts are invisible to the living, deaths stay secret until a meeting, roles are secret, and vents hide players.
- `render/`: Canvas 2D art (beans, bodies, ghosts, props, floors) and the world renderer (wall faces, doors, vents, vision fog).
- `ui/`: the HUD icons, task panels, map / sabotage / admin overlays, cameras, vitals, meeting tablet, splash, role reveal, ejection and end screens.
- `link.ts`: the local game (simulation and bots in the page) or the online game (snapshots plus client-predicted movement).
- `server/src/rooms/StarfallRoom.ts`: the authoritative room.
  - It runs the rules and the bots at 30 Hz and sends each player their own view at 15 Hz.
  - Clients send their own position, and the server re-runs it through the walls with a speed limit.
  - A player who leaves is replaced by a bot.

## Controls

| Action | Keyboard / mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | WASD / arrows, or hold the mouse | Left stick / D-pad | Joystick |
| Use / vent | E or Space (V vents) | A (RB vents) | USE |
| Report | R | Y | REPORT |
| Kill | Q | X | KILL |
| Map / sabotage | Tab | View | Map button |
| Close / pause | Esc | B / Start | ✕ |

In task panels a controller moves a cursor with the stick and clicks with A. In a vent, the direction keys hop to a linked vent.

## Checks

- `npx tsx tools/starfall-maps.ts`: every spot on every map is reachable.
- `npx tsx tools/starfall-sim.ts 8`: bots-only games on each map (outcomes, meetings, sabotages, stuck bots, ms per tick).
