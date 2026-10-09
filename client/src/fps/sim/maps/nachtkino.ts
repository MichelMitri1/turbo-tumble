import { Builder, D, sp, type MapDef, type Op } from '../mapkit';
import type { ZMapMeta, ZWindow } from '../zmap';

/**
 * Nachtkino — a derelict 1940s picture house, laid out like the classic theater zombies map:
 * you start in the LOBBY; doors lead to the DRESSING ROOMS (west) and the ALLEY (east), and
 * both of those open onto the THEATER, with the stage, the power switch and the Pack-a-Punch.
 * The lobby → wings → theater loop is the training route.
 *
 * Coordinates: x east, z south (the lobby is south, the stage north).
 */

const HX = 40;
const HZ = 36;
/** Boarded window opening: 1.6 m wide, sill 0.9, top 2.3. */
const WIN = (c: number): Op => [c - 0.8, c + 0.8, 0.9, 2.3];

export function nachtkino(): { map: MapDef; z: ZMapMeta } {
  const b = new Builder();
  b.bounds(HX, HZ, 16, 'concrete');
  const windows: ZWindow[] = [];
  const spawners: ZMapMeta['spawners'] = [];
  /** A window in a wall + its player clip + the spawn closet behind it. */
  const win = (x: number, z: number, nx: number, nz: number, zone: number, closet = 5) => {
    const i = windows.length;
    windows.push({ x, z, nx, nz, w: 1.6, sill: 0.9, top: 2.3, zone });
    // Clip: players can't climb out, bullets and zombies go through.
    // (Inside the wall's thickness, so the floor right in front of the window stays walkable.)
    if (nx) b.boxes.push({ x0: x - 0.15, y0: 0, z0: z - 0.8, x1: x + 0.15, y1: 3, z1: z + 0.8, mat: 'invisible', hidden: true, clip: true });
    else b.boxes.push({ x0: x - 0.8, y0: 0, z0: z - 0.15, x1: x + 0.8, y1: 3, z1: z + 0.15, mat: 'invisible', hidden: true, clip: true });
    spawners.push({ x: x - nx * closet, z: z - nz * closet, zone, window: i });
  };
  /** Ceiling in tiles (each gets a lamp at night). */
  const ceiling = (x0: number, z0: number, x1: number, z1: number, y: number, tint: string) => {
    const nx = Math.max(1, Math.round((x1 - x0) / 7));
    const nz = Math.max(1, Math.round((z1 - z0) / 7));
    b.with({ roof: true, tint }, () => {
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < nz; j++) b.box(x0 + ((x1 - x0) * i) / nx, y, z0 + ((z1 - z0) * j) / nz, x0 + ((x1 - x0) * (i + 1)) / nx, y + 0.3, z0 + ((z1 - z0) * (j + 1)) / nz, 'plaster');
    });
  };

  // ---------------------------------------------------------------- outside: lots, courtyard, streets
  b.floor(-16, 0.2, 16, 9.8, 'dirt', '#4a4234', 0.005); // the courtyard between the lobby and the theater
  b.prop('prop-debris-pile', -12, 5, 0, 1.4, { collide: false });
  b.prop('prop-debris-tires', 12.5, 6, 1, 1.2, { collide: false });
  b.prop('prop-streetlight', 0, 32, 2, 1.4, { collide: false });
  b.prop('prop-debris-brokencar', -26, 28, 1, 1, { collide: false, tint: '#5a5048' });
  b.prop('prop-debris-brokencar', 27, 29, 3, 1, { collide: false, tint: '#3e4a5a' });
  b.prop('prop-tree-2', -38, -30, 0, 2.2, { collide: false });
  b.prop('prop-tree-3', 38, -31, 1, 2.2, { collide: false });
  b.prop('prop-tree-1', -38, 30, 0, 2, { collide: false });

  // ---------------------------------------------------------------- LOBBY (zone 0)
  b.with({ tint: '#c8b49a' }, () =>
    b.room(-10, 10, 10, 26, 5, 'plaster', 0.4, {
      n: [WIN(-5), WIN(5)],
      s: [WIN(0)],
      w: [D(16, 2.8, 3), WIN(22)],
      e: [D(16, 2.8, 3), WIN(22)],
    }),
  );
  ceiling(-10.2, 9.8, 10.2, 26.2, 5, '#a8987e');
  b.floor(-9.8, 10.2, 9.8, 25.8, 'marble', '#d8d0c4');
  b.floor(-2, 10.2, 2, 25.8, 'carpet', '#7a1a20', 0.031);
  win(-5, 10, 0, 1, 0);
  win(5, 10, 0, 1, 0);
  win(0, 26, 0, -1, 0);
  win(-10, 22, 1, 0, 0, 4);
  win(10, 22, -1, 0, 0, 4);
  // Ticket booth, pillars, a broken popcorn counter.
  b.counter(-4, 17.4, 4, 18.4, 1.1, 'darkwood', 'marble');
  b.with({ tint: '#b8a888' }, () => {
    b.pillar(-6.5, 14, 0.35, 5, 'marble');
    b.pillar(6.5, 14, 0.35, 5, 'marble');
    b.pillar(-6.5, 21.5, 0.35, 5, 'marble');
    b.pillar(6.5, 21.5, 0.35, 5, 'marble');
  });
  b.table(-7.5, 24, 1.4, 0.8, 0.8, 'darkwood');
  b.prop('prop-cardboardboxes-1', 8.2, 11.3, 0, 1);

  // ---------------------------------------------------------------- corridors from the lobby
  for (const s of [-1, 1] as const) {
    const x0 = Math.min(s * 10, s * 18);
    const x1 = Math.max(s * 10, s * 18);
    b.with({ tint: '#a89880' }, () => {
      b.wallX(x0, x1, 14, 3.4, 0.4, 'plaster');
      b.wallX(x0, x1, 18, 3.4, 0.4, 'plaster');
    });
    ceiling(x0, 13.8, x1, 18.2, 3.4, '#8a7c68');
    b.floor(x0, 14.2, x1, 17.8, 'darkwood', '#6a5040');
    // To the theater: a short passage between the wing and the theater walls.
    const y0 = Math.min(s * 16, s * 18);
    const y1 = Math.max(s * 16, s * 18);
    b.with({ tint: '#5a2a28' }, () => {
      b.wallX(y0, y1, -8, 4, 0.4, 'wallpaper');
      b.wallX(y0, y1, -4, 4, 0.4, 'wallpaper');
    });
    ceiling(y0, -8.2, y1, -3.8, 4, '#4a2a26');
  }

  // ---------------------------------------------------------------- DRESSING ROOMS (zone 1, west)
  b.with({ tint: '#6a4a5a' }, () =>
    b.room(-36, -14, -18, 18, 4, 'wallpaper', 0.4, {
      n: [WIN(-27)],
      w: [WIN(-6), WIN(10)],
      e: [D(16, 2.8, 3), D(-6, 2.8, 3)],
    }),
  );
  b.with({ thin: true, tint: '#7a5a68' }, () => b.wallX(-36, -18, 2, 4, 0.25, 'wallpaper', [D(-31, 1.6, 2.4), D(-23, 1.6, 2.4)]));
  ceiling(-36.2, -14.2, -17.8, 18.2, 4, '#6a5a5e');
  b.floor(-35.8, -13.8, -18.2, 17.8, 'darkwood', '#7a5a42');
  win(-36, -6, 1, 0, 1, 3);
  win(-36, 10, 1, 0, 1, 3);
  win(-27, -14, 0, 1, 1);
  // Make-up tables with mirrors, racks of costumes, a sofa.
  for (const z of [-12, -9.5]) {
    b.table(-34.6, z, 0.8, 2.2, 0.8, 'darkwood');
    b.deco(-35.78, 1.2, z - 0.9, -35.72, 2.1, z + 0.9, 'glass', '#c8d8e8');
  }
  b.shelf(-26, -13.6, -21, -13.0, 1.8, 'darkwood', '#4a3020');
  b.sofa(-21, -1.2, 3, 1, 's', '#5a2a3a');
  b.table(-30, 9, 1.6, 1, 0.78, 'darkwood');
  b.shelf(-35.6, 4, -35.0, 7.5, 1.9, 'metal', '#6a6a72');
  b.prop('prop-cardboardboxes-3', -20, 15.5, 1, 1);
  b.prop('prop-crate', -33.8, 15.8, 0, 1.2);

  // ---------------------------------------------------------------- ALLEY (zone 2, east): open sky
  b.with({ tint: '#7a5040' }, () =>
    b.room(18, -14, 36, 18, 6, 'brick', 0.4, {
      n: [WIN(27)],
      e: [WIN(-6), WIN(10)],
      w: [D(16, 2.8, 3), D(-6, 2.8, 3)],
    }),
  );
  b.floor(18.2, -13.8, 35.8, 17.8, 'concrete', '#5a5a5e');
  win(36, -6, -1, 0, 2, 3);
  win(36, 10, -1, 0, 2, 3);
  win(27, -14, 0, 1, 2);
  b.prop('prop-trashcontainer', 21, 6, 1, 1);
  b.prop('prop-trashcontainer', 33.5, 0, 1, 1);
  b.prop('prop-pallet', 24, -11, 0, 1.2);
  b.crates(29, 4, 3, 1.3);
  b.prop('prop-gastank', 20, -12, 0, 1);
  b.prop('prop-streetlight', 22, -2, 1, 1.3, { collide: false });
  b.prop('prop-barrier-single', 30, 13, 0, 1);
  b.prop('prop-woodplanks', 33, 16.5, 0, 1, { collide: false });

  // ---------------------------------------------------------------- THEATER (zone 3)
  b.with({ tint: '#5a1418' }, () =>
    b.room(-16, -28, 16, 0, 8, 'wallpaper', 0.4, {
      s: [WIN(-8), WIN(8)],
      w: [D(-6, 2.8, 3), WIN(-20)],
      e: [D(-6, 2.8, 3), WIN(-20)],
    }),
  );
  ceiling(-16.2, -28.2, 16.2, 0.2, 8, '#3a2a28');
  b.floor(-15.8, -27.8, 15.8, -0.2, 'carpet', '#6a141a');
  win(-8, 0, 0, -1, 3);
  win(8, 0, 0, -1, 3);
  win(-16, -20, 1, 0, 3, 4);
  win(16, -20, -1, 0, 3, 4);
  // Stage (1 m up), steps in front, the screen and the curtains.
  b.box(-12, 0, -28, 12, 1, -21, 'darkwood');
  for (let k = 0; k < 3; k++) b.box(-3, 0, -21 + k * 0.45, 3, 1 - (k + 1) * 0.33 + 0.33, -21 + (k + 1) * 0.45, 'darkwood');
  b.deco(-9, 2.2, -27.75, 9, 7, -27.7, 'paint', '#d8d4c8');
  b.with({ thin: true }, () => {
    b.deco(-12, 1, -26.9, -9.5, 7.6, -26.6, 'fabric', '#8a1018');
    b.deco(9.5, 1, -26.9, 12, 7.6, -26.6, 'fabric', '#8a1018');
  });
  b.deco(-12.2, 7, -27.2, 12.2, 7.9, -26.5, 'fabric', '#7a0c14');
  // Rows of seats either side of the centre aisle (side aisles along the walls).
  for (let z = -17; z <= -3; z += 2) {
    b.with({ tint: '#7a1a20', thin: true }, () => {
      b.box(-12, 0, z, -2.2, 0.9, z + 0.6, 'fabric');
      b.box(2.2, 0, z, 12, 0.9, z + 0.6, 'fabric');
    });
  }
  // Balcony front (decor) and the projection booth window.
  b.deco(-16, 5, -1.6, 16, 5.6, -0.2, 'darkwood', '#3a2418');
  b.deco(-1.5, 6.2, -0.25, 1.5, 7.2, -0.2, 'glass', '#ffeec8');

  // ---------------------------------------------------------------- doors (bought in-game; boxes added by the game)
  const doors: ZMapMeta['doors'] = [
    { box: [-14.2, 14.2, -13.8, 17.8], cost: 1000, zones: [1], look: 'door', x: -14, z: 16 },
    { box: [13.8, 14.2, 14.2, 17.8], cost: 1000, zones: [2], look: 'debris', x: 14, z: 16 },
    { box: [-17.8, -7.8, -16.2, -4.2], cost: 750, zones: [1, 3], look: 'door', x: -17, z: -6 },
    { box: [16.2, -7.8, 17.8, -4.2], cost: 750, zones: [2, 3], look: 'debris', x: 17, z: -6 },
  ];

  // ---------------------------------------------------------------- buyables
  const z: ZMapMeta = {
    zones: ['Lobby', 'Dressing Rooms', 'Alley', 'Theater'],
    windows,
    spawners: [
      ...spawners,
      // Risers: they claw out of the ground.
      { x: 24, z: 0, zone: 2, window: -1 },
      { x: 30, z: -8, zone: 2, window: -1 },
      { x: 0, z: -10, zone: 3, window: -1 },
      { x: -14, z: -11, zone: 3, window: -1 },
      { x: 14, z: -11, zone: 3, window: -1 },
    ],
    doors,
    wallbuys: [
      { weapon: 'zm_olympia', cost: 500, x: 0, y: 1.5, z: 10.2, nx: 0, nz: 1 },
      { weapon: 'zm_m14', cost: 500, x: -6, y: 1.5, z: 25.8, nx: 0, nz: -1 },
      { weapon: 'frag', cost: 250, x: -9.8, y: 1.4, z: 12.5, nx: 1, nz: 0 },
      { weapon: 'zm_mp40', cost: 1000, x: -22, y: 1.5, z: -13.8, nx: 0, nz: 1 },
      { weapon: 'zm_pm63', cost: 1000, x: -35.8, y: 1.5, z: 14, nx: 1, nz: 0 },
      { weapon: 'zm_ak74u', cost: 1200, x: 27, y: 1.5, z: 17.8, nx: 0, nz: -1 },
      { weapon: 'zm_mpl', cost: 1000, x: 22, y: 1.5, z: -13.8, nx: 0, nz: 1 },
      { weapon: 'zm_mp5k', cost: 1000, x: 0, y: 2.2, z: -0.2, nx: 0, nz: -1 },
      { weapon: 'zm_stakeout', cost: 1500, x: -15.8, y: 1.6, z: -12, nx: 1, nz: 0 },
      { weapon: 'zm_m16', cost: 1200, x: 15.8, y: 1.6, z: -2.2, nx: -1, nz: 0 },
      { weapon: 'bowie', cost: 3000, x: 6, y: 2.4, z: -27.8, nx: 0, nz: 1 },
    ],
    perks: [
      { perk: 'revive', x: 8.9, z: 24, nx: -1, nz: 0 },
      { perk: 'dtap', x: -34.9, z: -2.5, nx: 1, nz: 0 },
      { perk: 'jug', x: 34.9, z: 2, nx: -1, nz: 0 },
      { perk: 'speed', x: 14.9, z: -12, nx: -1, nz: 0 },
    ],
    boxSpots: [
      { x: -7.5, z: 11, nx: 0, nz: 1 },
      { x: -26, z: 16.9, nx: 0, nz: -1 },
      { x: 30, z: 16.9, nx: 0, nz: -1 },
      { x: -14.9, z: -2, nx: 1, nz: 0 },
    ],
    power: { x: -11, z: -27.75, nx: 0, nz: 1 },
    pap: { x: 0, z: -25.2, nx: 0, nz: 1 },
    start: [
      { x: -2, z: 21, yaw: 0 },
      { x: 2, z: 21, yaw: 0 },
      { x: -2, z: 23.5, yaw: 0 },
      { x: 2, z: 23.5, yaw: 0 },
    ],
  };
  // Machines collide (their look is drawn by the zombies renderer).
  const solid = (x: number, zz: number, w: number, d: number, h: number, nx: number) => {
    const [hw, hd] = nx ? [d / 2, w / 2] : [w / 2, d / 2];
    b.boxes.push({ x0: x - hw, y0: 0, z0: zz - hd, x1: x + hw, y1: h, z1: zz + hd, mat: 'metal', hidden: true });
  };
  for (const p of z.perks) solid(p.x, p.z, 1.0, 0.8, 2.2, p.nx);
  for (const s of z.boxSpots) solid(s.x, s.z, 1.7, 0.8, 0.9, s.nx);
  solid(z.pap.x, z.pap.z, 1.6, 1.2, 1.0 + 1.5, 0);

  const map: MapDef = {
    id: 'nachtkino',
    name: 'Nachtkino',
    desc: 'A derelict picture house. Survive as many rounds as you can.',
    half: [HX, HZ],
    boxes: b.boxes,
    decor: b.decor,
    cyls: b.cyls,
    props: b.props,
    // Facing the ticket booth and the boarded windows (north).
    spawns: [z.start.map((p) => sp(p.x, p.z, 0)), z.start.map((p) => sp(p.x, p.z, 0))],
    ffa: z.start.map((p) => sp(p.x, p.z, 0)),
    flags: [],
    theme: { sky: 'night', ground: 'asphalt', patches: [], sun: [-0.4, 0.8, 0.3], fog: ['#0a0c14', 25, 95] },
    backdrop: 'city',
    size: 'medium',
  };
  return { map, z };
}
