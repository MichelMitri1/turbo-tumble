# Velora

An open-world crime sandbox at `/velora/`, in the style of the big modern city games (original names throughout).

## The game

- **The city (about 2 × 2 km), built from curves rather than a grid:**
  - **Districts:** Downtown towers inside the elevated **Velora Freeway** ring (ramps on and off), the Midtown grid, Port Velora, and **Vista Hills** with the switchbacks of Mulholland Dr up to Crest Rd. The curved crescents of **Palm Heights** sit across the river, and the beach district runs along the Ocean Hwy coast road.
  - **River and bridges:** a river winds through the city, crossed by the Mission, Harbor and Palm Fwy bridges and two avenue bridges to the beach.
  - **Streets:** two to six lanes with medians, parking lanes, crosswalks, junction plates, working traffic lights, sidewalks with street lamps, and real street names.
  - **Elevated roads:** bridges and the freeway have decks on pillars and crash barriers.
  - **Water:** you swim in the river and the sea, and cars sink.
  - **Day/night:** a full cycle (24 minutes).
- **On foot:**
  - jog (6.4 m/s), sprint (9.2 m/s, stamina), jump, swim;
  - a third-person or **first-person** camera (V), with a first-person gun that kicks;
  - aiming, a sniper scope, punching, and a weapon wheel (Tab).
- **Weapons:** you start with all of them, with infinite ammo: Pistol, Heavy Revolver, Micro SMG, Carbine Rifle, Pump Shotgun, Sniper Rifle and RPG.
- **Cars:** 19 vehicles, from compacts, hatches, sedans, wagons and taxis to SUVs, pickups, a muscle car, sports cars, a supercar, a race car, vans, box and garbage trucks, an ambulance, a fire engine, police interceptors and a tractor.
  - **Physics:** each has its real mass, power, top speed (up to 330 km/h), drivetrain, grip, drag/downforce and suspension, on Rapier raycast vehicles with handbrake drifts.
  - **Damage** comes from how hard you hit: a dent at 50 km/h, smoke at 100 km/h, fire after a 200 km/h wall hit. Trucks are tougher.
  - **Cameras (V cycles):** near and far chase cams and a hood cam.
  - You get out on the driver's side, or the other side if that's blocked.
- **Traffic and people:**
  - **Traffic:** follows its lanes round curves and over bridges, merges on and off the freeway, turns at junctions (lefts from the inside lane), stops at red lights, brakes and honks, and flees from gunfire.
  - **Pedestrians:** walk every sidewalk and cross at junctions, panic, cower, get run over and drop cash.
  - **Pooling:** cars and people are pooled, so nothing is created mid-drive.
- **Wanted level (1–5 stars):** cruisers route to you over the road network and ram you; cops and SWAT shoot and arrest. Lose them by escaping the search circle.
- **Shops:** 18 across town: Lock & Load, Threadz, Quik-Stop (robbable), Spray Away, two hospitals, two VCPD stations, Velora Motors.
- **HUD:** radar, full map with GPS routing over the real roads, help prompts, area/street/vehicle names, WASTED/BUSTED.

## Velora Online

A shared free-roam session for up to 16 players (Create Session → share the code, Join, or Quick Join). Online and LAN use the same arcade server.

- **What everyone shares:** you see each other on foot and in cars, with name tags and blips on the radar and map. Wanted players flash red and blue.
- **Fighting:** you can shoot each other (headshots count double), run each other over, and blow each other up with the RPG. Kills show in the feed ("X killed Y").
- **Parked cars:** the car you leave stays in the world for everyone. Anyone can walk up and press F to take it.
- **Chat and players:** T opens text chat; hold Z for the player list (wanted level, kills, deaths).
- **Clock and pause:** everyone shares the time of day, and the world keeps going while your pause menu or map is open. The pause menu shows the session code.

How it works:
- Each client simulates its own character and car and sends its state 20 times a second (30 on LAN).
- The server (`server/src/rooms/VeloraRoom.ts`) relays snapshots and sanity-checks hits before forwarding them to the target, whose client applies the damage. It also runs the kill feed, chat, the car claims (first come, first served) and the clock.
- Other players are drawn about 120 ms behind, interpolated. Their cars are kinematic, so they're solid to crash into.
- NPC traffic, pedestrians and your police chase are local to each player.

## Code

- `world/`: the city's shape (`layout.ts`: district map, river, coast, every road as a curve), the land (`terrain.ts`: heightfield, hills, river channel), the road network (`net.ts`: sampled roads, same-level intersections, joins, edges, lanes, routing) and the placements (`city.ts`: buildings along the streets, shops, parking, lamps, lights, trees). `npx tsx tools/velora-map.ts out.png` draws it.
- `render/`: the city view (instanced Kenney buildings, roads, lights), the camera rig and the effects.
- `actors/`:
  - `human.ts`: animated people and the gun-in-hand mount;
  - `vehicle.ts`: cars;
  - `player.ts`;
  - `peds.ts`: pedestrians and cops on foot;
  - `traffic.ts`: drivers, including police pursuit;
  - `police.ts`: the wanted system.
- `combat.ts`: weapons, inventory and hit resolution.
- `ui/`: the HUD, radar and map, and the shops.
- `game.ts`: the loop, physics stepping, crashes, run-overs, explosions, pickups, population and respawns.

The assets come from `tools/velora-assets.mjs` (CC0 Kenney and Quaternius; see `client/public/assets/LICENSES.md`).

## Roadmap

2. **Missions:** story jobs and side activities (races, taxi jobs, heists).
3. **More to drive:** bikes, helicopters and boats, plus enterable interiors.
