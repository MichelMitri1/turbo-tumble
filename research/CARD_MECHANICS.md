# Card mechanics

The runtime is data-driven. Every definition composes one or more behaviors from: melee, ranged projectile, area splash, flying, swarm, tank, charge, dash, jump, shield, invisibility, stun, slow, rage, heal, periodic spawn, death spawn, death bomb, chain, beam/ramping damage, building-only targeting, siege, pull, knockback, damage-over-time, freeze, clone, burrow, transform, reflect, and active ability.

Ground units route through the nearest of two bridges; flying and burrowing units cross directly. Collision separation prevents stacking. Target validation distinguishes ground, air/all, and building-only attacks. Buildings attract appropriate units, decay by lifetime, and spawners emit units on a fixed schedule. Projectiles are represented by synchronized attack/impact events and canvas VFX; damage is applied on the fixed simulation tick.

Special spell implementations include Freeze, Rage, Poison/DoT, Tornado pull, Clone, Graveyard/Goblin Barrel spawning, knockback, chain Lightning, Void split damage, and Vines control. Champion/Hero cards expose the `ability` component in data; automated ability buttons remain an explicit fidelity gap in `IMPLEMENTATION_STATUS.md`.
