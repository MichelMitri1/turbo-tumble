import { Builder, D, FACE, W, sp, type MapDef } from '../mapkit';

/**
 * Ravenmoor Manor: a huge two-storey mansion. Grand foyer with twin staircases up to a
 * gallery; library, ballroom, dining hall, kitchen and billiards downstairs; bedrooms,
 * a study and an art gallery upstairs; hedge gardens front and back. Spawns: the west
 * garage and the east pool house.
 */
export function manor(): MapDef {
  const b = new Builder();
  const HX = 42;
  const HZ = 34;
  b.bounds(HX, HZ);
  const G = 4.0; // ground-floor wall height
  const UP = 4.3; // upper floor level
  const ext = '#ece2cc';
  const paper = '#d8c4a0';

  // ---------------------------------------------------------------- exterior shell
  b.with({ tint: ext }, () => {
    // Ground floor.
    b.wallX(-28, 28, -16, G, 0.5, 'plaster', [[-1.6, 1.6, 0, 3.2], W(-24, 1.8, 1, 3), W(-19, 1.8, 1, 3), W(-14, 1.8, 1, 3), W(-9, 1.8, 1, 3), W(-4, 1.2, 1, 3), W(4, 1.2, 1, 3), W(9, 1.8, 1, 3), W(14, 1.8, 1, 3), W(19, 1.8, 1, 3), W(24, 1.8, 1, 3)]);
    b.wallX(-28, 28, 16, G, 0.5, 'plaster', [D(-21), W(-26, 1.6, 1, 3), W(-16, 1.6, 1, 3), W(-9, 1.6, 1, 3), D(-5, 1.8, 2.8), W(0, 1.8, 1, 3), D(5, 1.8, 2.8), W(9, 1.6, 1, 3), W(16, 1.6, 1, 3), D(21), W(26, 1.6, 1, 3)]);
    b.wallZ(-16, 16, -28, G, 0.5, 'plaster', [W(-14, 1.6, 1, 3), D(-9.3), W(-4, 1.6, 1, 3), W(1.5, 1.6, 1, 3), D(14.6)]);
    b.wallZ(-16, 16, 28, G, 0.5, 'plaster', [W(-14, 1.6, 1, 3), D(-9.3), W(-4, 1.6, 1, 3), W(1.5, 1.6, 1, 3), D(14.6)]);
    // Upper floor.
    b.wallX(-28, 28, -16, 4, 0.5, 'plaster', [W(-24, 1.6, 1, 2.8), W(-19, 1.6, 1, 2.8), W(-12, 1.6, 1, 2.8), W(-8.5, 1.6, 1, 2.8), [-3, 3, 0.8, 3.4], W(8.5, 1.6, 1, 2.8), W(12, 1.6, 1, 2.8), W(19, 1.6, 1, 2.8), W(24, 1.6, 1, 2.8)], UP);
    b.wallX(-28, 28, 16, 4, 0.5, 'plaster', [W(-26), W(-20), W(-14), W(-6), D(0, 2, 2.6), W(6), W(14), W(20), W(26)], UP);
    b.wallZ(-16, 16, -28, 4, 0.5, 'plaster', [W(-14), W(-6), W(6), W(12)], UP);
    b.wallZ(-16, 16, 28, 4, 0.5, 'plaster', [W(-14), W(-6), W(6), W(12)], UP);
  });
  // Floor between the storeys: open over the foyer and the two back staircases.
  b.slab(-28, -16, 28, 16, G, UP - G, 'darkwood', [
    [-6, -16, 6, -3],
    [-27.6, 3, -24.4, 13],
    [24.4, 3, 27.6, 13],
  ]);
  b.with({ roof: true, tint: '#f2eee6' }, () => b.box(-28.3, 8.3, -16.3, 28.3, 8.6, 16.3, 'paint'));
  b.roofTop(-28.8, -16.8, 28.8, 16.8, 8.6, true, '#6a6e7c', 6, 0.55);
  for (const x of [-18, 18]) b.deco(x - 0.8, 8.6, -1, x + 0.8, 12.6, 1, 'brick');
  // Back balcony over the terrace.
  b.box(-4, G, 16, 4, UP, 19, 'marble');
  b.rail(-4, 18.85, 4, 19, UP, 1, 'marble');
  b.rail(-4, 16.2, -3.85, 19, UP, 1, 'marble');
  b.rail(3.85, 16.2, 4, 19, UP, 1, 'marble');
  for (const x of [-3.6, 3.6]) b.pillar(x, 18.6, 0.25, G, 'marble');
  // Front portico.
  for (const x of [-3.2, 3.2]) b.pillar(x, -18.5, 0.35, 5, 'marble');
  b.deco(-4, 5, -19.5, 4, 5.4, -16, 'marble');
  b.box(-4, 0, -19.5, 4, 0.2, -16, 'marble');

  // ---------------------------------------------------------------- ground floor
  b.with({ thin: true, tint: paper }, () => {
    b.wallZ(-16, -3, -6, G, 0.2, 'wallpaper', [D(-14.4, 1.6, 2.6)]);
    b.wallZ(-16, -3, 6, G, 0.2, 'wallpaper', [D(-14.4, 1.6, 2.6)]);
    b.wallX(-28, 28, -3, G, 0.2, 'wallpaper', [D(-22, 1.6, 2.6), D(-9, 1.6, 2.6), [-3, 3, 0, 3.4], D(9, 1.6, 2.6), D(22, 1.6, 2.6)]);
    b.wallZ(-3, 16, -12, G, 0.2, 'wallpaper', [D(5, 1.6, 2.6), D(12, 1.6, 2.6)]);
    b.wallZ(-3, 16, 12, G, 0.2, 'wallpaper', [D(5, 1.6, 2.6), D(12, 1.6, 2.6)]);
  });
  // Foyer: twin staircases up to the gallery, marble, a round table.
  b.stairs(-5.8, -12.6, -4, -3, 'z+', UP, 'marble');
  b.stairs(4, -12.6, 5.8, -3, 'z+', UP, 'marble');
  b.floor(-6, -16, 6, -3, 'marble', '#f4efe6');
  b.floor(-2.5, -14, 2.5, -6, 'carpet', '#7a1e22', 0.01);
  b.table(0, -9, 1.6, 1.6, 0.8, 'marble');
  b.deco(-1.2, 6.6, -10.2, 1.2, 7.0, -7.8, 'metal', '#c8a040'); // chandelier
  // Library (west front).
  b.floor(-28, -16, -6, -3, 'carpet', '#5a2226');
  b.shelf(-27.7, -12.6, -27.1, -10.2, 2.6);
  b.shelf(-25.4, -14, -24.8, -6);
  b.shelf(-20.4, -13, -19.8, -7);
  b.shelf(-15.4, -14, -14.8, -6);
  b.shelf(-27.5, -15.7, -25.8, -15.1, 2.6);
  b.table(-10.5, -9.5, 2.4, 1.2);
  b.sofa(-10.5, -12.2, 2.2, 0.9, 's', '#3a5a3a');
  b.sofa(-8, -6, 0.9, 0.9, 'e', '#6a3a2a');
  // Dining hall (west back) with the back staircase.
  b.floor(-28, -3, -12, 16, 'darkwood', '#c09878');
  b.stairs(-27.5, 3, -24.5, 13, 'z-', UP, 'darkwood');
  b.table(-18.5, 7, 7, 1.6);
  b.counter(-19, -2.6, -14, -2.1, 1, 'darkwood', 'darkwood');
  b.box(-12.75, 0, 7.8, -12.1, 1.4, 10.2, 'brick'); // fireplace
  // Ballroom (centre back): pillars, a grand piano, sofas.
  b.floor(-12, -3, 12, 16, 'marble', '#e6dccb');
  for (const [x, z] of [[-7, 3], [7, 3], [-7, 11], [7, 11]] as Array<[number, number]>) b.pillar(x, z, 0.45, G);
  b.box(-6, 0, 12.4, -3.6, 1, 14.4, 'darkwood');
  b.sofa(3.5, 13.8, 3, 1, 's', '#8a2a3a');
  b.table(3.5, 12, 1.6, 0.8, 0.45);
  b.deco(-1.5, 3.4, 5, 1.5, 3.8, 8, 'metal', '#c8a040');
  // Kitchen (east front).
  b.floor(6, -16, 28, -3, 'marble', '#b8bcc0');
  b.counter(7, -15.65, 12.5, -14.95);
  b.counter(15.5, -15.65, 27.6, -14.95);
  b.counter(13, -10.5, 19, -8.7);
  b.shelf(26.6, -7, 27.6, -4, 2.1, 'metal', '#d0d4d8');
  b.table(23, -10, 2, 1.2);
  // Billiards / bar (east back) with the other back staircase.
  b.floor(12, -3, 28, 16, 'carpet', '#24402e');
  b.stairs(24.5, 3, 27.5, 13, 'z-', UP, 'darkwood');
  for (const z of [4, 11]) {
    b.box(15.2, 0, z - 0.8, 19.8, 0.8, z + 0.8, 'darkwood');
    b.deco(15.4, 0.8, z - 0.6, 19.6, 0.83, z + 0.6, 'fabric', '#2a7a3a');
  }
  b.counter(12.6, 14.7, 19.5, 15.5, 1.1);
  b.sofa(16, -1.9, 3, 0.9, 'n', '#6a4a2a');

  // ---------------------------------------------------------------- upper floor
  b.with({ thin: true, tint: paper }, () => {
    b.wallZ(-16, -3, -6, 4, 0.2, 'wallpaper', [W(-9.5, 2.4, 1, 2.4)], UP);
    b.wallZ(-16, -3, 6, 4, 0.2, 'wallpaper', [W(-9.5, 2.4, 1, 2.4)], UP);
    b.wallX(-28, -6, -3, 4, 0.2, 'wallpaper', [D(-21.5), D(-10.5)], UP);
    b.wallX(6, 28, -3, 4, 0.2, 'wallpaper', [D(10.5), D(21.5)], UP);
    b.wallZ(-16, -3, -15, 4, 0.2, 'wallpaper', [D(-7)], UP);
    b.wallZ(-16, -3, 15, 4, 0.2, 'wallpaper', [D(-7)], UP);
    b.wallX(-28, 28, 1, 4, 0.2, 'wallpaper', [D(-19), [-4, 4, 0, 3], D(19)], UP);
    b.wallZ(1, 16, -10, 4, 0.2, 'wallpaper', [D(8.5)], UP);
    b.wallZ(1, 16, 10, 4, 0.2, 'wallpaper', [D(8.5)], UP);
  });
  // Gallery railing over the foyer (the stairs arrive at either end).
  b.rail(-4, -3.1, 4, -2.9, UP, 1);
  b.rail(-24.4, 3.4, -24.25, 13, UP, 1);
  b.rail(24.25, 3.4, 24.4, 13, UP, 1);
  b.rail(-27.6, 13, -24.4, 13.15, UP, 1);
  b.rail(24.4, 13, 27.6, 13.15, UP, 1);
  b.floor(-28, -3, 28, 1, 'carpet', '#6a1e24', UP);
  // Master bedroom, second bedroom, study, third bedroom (front).
  b.floor(-28, -16, -15, -3, 'carpet', '#3a4a6a', UP);
  b.bed(-25.6, -9.5, 2.2, 2.4, 'w', '#e8e0d0', UP);
  b.box(-17, UP, -15.6, -15.4, UP + 2.2, -14.8, 'darkwood');
  b.floor(-15, -16, -6, -3, 'carpet', '#5a4a3a', UP);
  b.bed(-12.5, -13.5, 1.6, 2.2, 'n', '#9ab0c8', UP);
  b.box(-8.2, UP, -15.6, -6.4, UP + 0.8, -14.9, 'darkwood');
  b.floor(6, -16, 15, -3, 'darkwood', '#c8a888', UP);
  b.box(8.5, UP, -12.5, 11.5, UP + 0.8, -11.5, 'darkwood');
  b.box(14.2, UP, -15.6, 14.8, UP + 2.4, -9, 'darkwood');
  b.floor(15, -16, 28, -3, 'carpet', '#4a3a5a', UP);
  b.bed(25.6, -9.5, 2.2, 2.4, 'e', '#c8a0a8', UP);
  b.box(17, UP, -15.6, 19, UP + 2.2, -14.8, 'darkwood');
  // Art gallery, sitting room, guest suite (back).
  b.floor(-28, 1, -10, 16, 'marble', '#ddd6c8', UP);
  for (const [x, z] of [[-20, 6], [-16, 11], [-13, 5]] as Array<[number, number]>) b.box(x - 0.4, UP, z - 0.4, x + 0.4, UP + 1.2, z + 0.4, 'marble');
  b.deco(-23, UP + 1.2, 15.7, -18, UP + 3, 15.74, 'paint', '#7a5a3a');
  b.floor(-10, 1, 10, 16, 'carpet', '#6a5a40', UP);
  b.sofa(-3, 9, 1, 3, 'w', '#3a4a5a');
  b.sofa(3, 9, 1, 3, 'e', '#3a4a5a');
  b.table(0, 9, 1.8, 1, 0.45);
  b.floor(10, 1, 28, 16, 'carpet', '#2e3e4e', UP);
  b.bed(16, 13.4, 2, 2.3, 's', '#b8c8a8', UP);
  b.box(11, UP, 2, 12.5, UP + 2, 3, 'darkwood');

  // ---------------------------------------------------------------- spawns: garage (west) & pool house (east)
  b.with({ tint: '#d8ccb4' }, () => {
    b.room(-41, -10, -32, 8, 3.6, 'plaster', 0.3, { e: [[-8, -3.5, 0, 3], [2, 6.5, 0, 3]], n: [D(-36.5)], s: [W(-36.5, 2, 1.2, 2.4)] });
    b.room(32, -8, 41, 10, 3.6, 'plaster', 0.3, { w: [[3.5, 8, 0, 3], [-6.5, -2, 0, 3]], s: [D(36.5)], n: [W(36.5, 2, 1.2, 2.4)] });
  });
  b.with({ roof: true }, () => {
    b.box(-41.3, 3.6, -10.3, -31.7, 3.85, 8.3, 'paint');
    b.box(31.7, 3.6, -8.3, 41.3, 3.85, 10.3, 'paint');
  });
  b.roofTop(-41.4, -10.4, -31.6, 8.4, 3.85, false, '#6a6e7c', 4, 0.45);
  b.roofTop(31.6, -8.4, 41.4, 10.4, 3.85, false, '#6a6e7c', 4, 0.45);
  b.floor(-41, -10, -32, 8, 'concrete');
  b.car(-38, -4, 0, '#1e1e24');
  b.car(-38, 3.5, 0, '#6a1a1a');
  b.shelf(-40.6, -9.6, -39.4, -7.6, 2, 'metal', '#4a5a6a');
  b.floor(32, -8, 41, 10, 'marble', '#c8d8e0');
  b.sofa(38.5, -4, 1, 2.2, 'e', '#e8e0d0');
  b.sofa(38.5, 4, 1, 2.2, 'e', '#e8e0d0');
  b.counter(39.6, -7.6, 40.6, -5.2, 1);

  // ---------------------------------------------------------------- gardens
  // Front: fountain, hedges, statues, cars on the gravel drive.
  b.box(-2.5, 0, -27.5, 2.5, 0.7, -22.5, 'marble');
  b.deco(-2.2, 0.7, -27.2, 2.2, 0.72, -22.8, 'glass', '#4a8ab8');
  b.pillar(0, -25, 0.4, 2.2);
  for (const [x0, z0, x1, z1] of [
    [-24, -22, -10, -21.2],
    [10, -22, 24, -21.2],
    [-24, -30, -14, -29.2],
    [14, -30, 24, -29.2],
    [-14.6, -30, -13.8, -25],
    [13.8, -30, 14.6, -25],
    [-26, -27, -25.2, -23],
    [25.2, -27, 26, -23],
    [-34, -24, -30, -23.2],
    [30, -24, 34, -23.2],
  ] as Array<[number, number, number, number]>)
    b.box(x0, 0, z0, x1, 1.5, z1, 'hedge');
  for (const x of [-5.5, 5.5]) b.pillar(x, -19.5, 0.4, 2.4);
  b.car(8, -27, 0, '#2a2a30');
  b.car(-9, -31, 1, '#c8c0b0');
  b.prop('prop-streetlight', -4.5, -32, 0, 1.4, { collide: false });
  b.prop('prop-streetlight', 4.5, -32, 0, 1.4, { collide: false });
  // Back: terrace, gazebo, hedges, a second fountain and statues.
  for (const [x, z] of [[-2.5, 24.5], [2.5, 24.5], [-2.5, 29.5], [2.5, 29.5]] as Array<[number, number]>) b.pillar(x, z, 0.25, 2.8);
  b.deco(-3.2, 2.8, 23.8, 3.2, 3.1, 30.2, 'marble');
  b.roofTop(-3.2, 23.8, 3.2, 30.2, 3.1, true, '#6a6e7c', 3, 0.35);
  b.table(0, 27, 1.6, 1, 0.75, 'wood');
  for (const [x0, z0, x1, z1] of [
    [-24, 24, -12, 24.8],
    [12, 24, 24, 24.8],
    [-30, 30, -20, 30.8],
    [20, 30, 30, 30.8],
    [-9, 20.5, -8.2, 25],
    [8.2, 20.5, 9, 25],
  ] as Array<[number, number, number, number]>)
    b.box(x0, 0, z0, x1, 1.5, z1, 'hedge');
  b.box(-19.5, 0, 26.5, -16.5, 0.6, 29.5, 'marble');
  b.pillar(-18, 28, 0.3, 1.6);
  b.pillar(18, 28, 0.45, 2.4);
  b.table(-26, 20, 1.8, 1, 0.75, 'wood');
  b.table(26, 20, 1.8, 1, 0.75, 'wood');
  b.prop('prop-tree-2', -36, 24, 0, 2.2);
  b.prop('prop-tree-2', 36, -24, 0, 2.2);
  b.prop('prop-tree-1', -36, -26, 1, 2.2);
  b.prop('prop-tree-3', 36, 27, 0, 2.2);
  b.prop('prop-tree-1', -16, 31, 0, 2);
  b.prop('prop-tree-3', 16, -32, 1, 2);
  return {
    id: 'manor',
    name: 'Ravenmoor Manor',
    desc: 'A huge two-storey mansion: grand staircases, ballroom, library, gardens. Room-to-room fights.',
    half: [HX, HZ],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    spawns: [
      [sp(-34.5, -8, FACE.px), sp(-34.5, -5, FACE.px), sp(-34.5, 0, FACE.px), sp(-34.5, 4, FACE.px), sp(-34.5, 7, FACE.px), sp(-39.5, 7, FACE.px)],
      [sp(34.5, 8, FACE.nx), sp(34.5, 5, FACE.nx), sp(34.5, 0, FACE.nx), sp(34.5, -4, FACE.nx), sp(34.5, -7, FACE.nx), sp(36, -6.5, FACE.nx)],
    ],
    ffa: [sp(-36, -1, FACE.px), sp(36, 1, FACE.nx), sp(0, -31, FACE.pz), sp(0, 32, FACE.nz), sp(-20, -31, FACE.pz), sp(20, 32.5, FACE.nz), sp(-12, -9, FACE.px, UP), sp(14, 8.5, FACE.nx, UP), sp(-22, -9, FACE.pz), sp(22, -6, FACE.nz), sp(-36, 30, 2.4), sp(36, -30, -0.8)],
    flags: [
      { x: -20, z: 10.5, y: 0 },
      { x: 0, z: 6, y: 0 },
      { x: 20.5, z: 7.5, y: 0 },
    ],
    theme: {
      sky: 'overcast',
      ground: 'grass',
      patches: [
        [-3, -34, 3, -19.5, 'dirt'],
        [-12, -33, 12, -19.5, 'dirt'],
        [-28, 16, 28, 21.5, 'concrete'],
        [-42, -1.5, -28, 1.5, 'concrete'],
        [28, -1.5, 42, 1.5, 'concrete'],
      ],
      sun: [0.45, 0.7, -0.5],
      fog: ['#a8b0b8', 70, 400],
    },
    backdrop: 'estate',
    size: 'large',
  };
}
