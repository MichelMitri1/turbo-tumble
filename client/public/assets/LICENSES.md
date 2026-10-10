# Third-party asset licenses

All bundled 3D assets are **CC0 1.0 (public domain)** by Kenney (www.kenney.nl):

| Folder | Source pack |
| --- | --- |
| `karts/` | Kenney Car Kit 3.1 – kart-oobi / oodi / ooli / oopi / oozi (kart + driver) |
| `items/` | Kenney Toy Car Kit – item-box, item-cone |
| `environment/racing/` | Kenney Racing Kit – grandstands, tents, banners, flags, lights, billboards |
| `environment/nature/` | Kenney Nature Kit – trees, bushes, rocks, flowers |
| `environment/kits/` | Kenney Pirate Kit, Castle Kit, Fantasy Town Kit 2.0, Graveyard Kit 5.0, Holiday Kit, Factory Kit 3.0, City Kit Industrial 2.0, Survival Kit, City Kit Suburban 2.0, Space Kit – selected models packed one GLB per kit (`pirate`, `castle`, `town`, `graveyard`, `holiday`, `factory`, `industrial`, `survival`, `suburban`, `space`; colormap as lossless WebP, meshopt geometry, ~1.5 MB total) for track set pieces |

https://creativecommons.org/publicdomain/zero/1.0/
All textures in `textures/` and all procedural content are original to this project.

Engine recordings (`audio/engines/`) are CC BY-SA adaptations of Wikimedia Commons recordings — see `audio/engines/LICENSES.md`.

## Zero Hour (`fps/`)

CC0 by [Quaternius](https://quaternius.com): Ultimate Gun Pack, Ultimate Modular Characters
(SWAT), Toon Shooter Game Kit. Converted with `tools/fps-assets.mjs`.

Gun sounds (`fps/sfx/`): The Free Firearm Sound Library by Ben Jaszczak, Brian Nelson,
Kevin Heras and Matthew Nanney — CC0
(https://opengameart.org/content/the-free-firearm-sound-library). Trimmed with `tools/fps-sfx.mjs`.

Zombies (`fps/zombie-*.glb`, `fps/hellhound.glb`, extra guns): Quaternius Ultimate Animated Character Pack
(Zombie Male / Female), Ultimate Animated Animals (Wolf → hellhound), Ultimate Gun Pack, Toon Shooter Game Kit
(launchers) — CC0. Sounds (`fps/zsfx/`), CC0 from Freesound, cut with `tools/zombies-sfx.py`: #125405 "Monster Groans,
Grunts, Slobbers", #463721 zombie groan, #426637 "Zombie Choking", #133974 "Horrific Zombie Growl", #249495 "3 Headed
Dog", #404920 "Dog Growl - Beast / Creature", #873248 plywood cracking, #394891 hammer on wood, #274379 "creepy music
box", #556701 "Ghost Monster Scream".

400 playing cards (`400/cards/`): Vector Playing Cards by Byron Knoll (via
github.com/notpeter/Vector-Playing-Cards) — public domain. Rendered to WebP.

## Matchday 27 (`football/`)

Footballer: "Casual 2" from [Quaternius](https://quaternius.com)' Ultimate Modular Characters — CC0.
Kit-split (shirt / shorts / socks / boots) with `tools/football-assets.mjs`.

Sounds (`football/sfx/`), all CC0 from [Freesound](https://freesound.org), trimmed with `tools/football-sfx.py`:
crowd loop + goal roar — #528799 "Football Crowd - Reaction To Goal"; cheer — #397434 "Crowd Cheer";
ooh — #619007 "crowd oh disappointed"; whistle — #538422 "Referee whistle sound";
kicks — #555042 "Soccer Ball Kick", #261267 "Soccer Kick".

## Velora (`velora/`)

CC0 1.0 (public domain):
- Cars (`velora/cars/`): Quaternius "Cars" pack (Sedan, Hatch, Sports, Super, Muscle, Police, Taxi, SUV, Pickup, Box Truck), KayKit city vehicles by Kay Lousberg (Wagon, Compact) — both via poly.pizza — and the Kenney Car Kit (ambulance, fire engine, garbage truck, vans, race car, tractor). All normalised by `tools/velora-assets.mjs`.
- City (`velora/downtown.glb`, `suburb.glb`, `street.glb`): Kenney City Kit Commercial 2.1, City Kit Suburban 2.0 and City Kit Roads, with selected models packed one GLB per kit.
- People (`velora/people/`): Quaternius Ultimate Modular Characters (Casual, Hoodie, Suit, Business Man, Worker ×2, Punk ×2, Farmer, Adventurer, Woman ×2, SWAT), downloaded from poly.pizza. They share one skeleton, so the animations live in `casual.glb` only.

Velora also reuses the guns and gun sounds from `fps/` and the engine recordings from `audio/engines/` (see those sections).

Converted with `tools/velora-assets.mjs`.
