import { Builder, CONTAINER_COLORS as C, D, FACE, W, pointMirror, sp, type MapDef } from '../mapkit';

/**
 * A training compound (Shoot House-style, original layout): a roofless plywood shoot house in the
 * middle (every wall wallbangs), a long-range lane on each side with target stands, sandbags and a
 * guard tower, and a staging tent at each end for the spawns.
 */
export function killhouse(): MapDef {
  const b = new Builder();
  const HX = 32;
  const HZ = 22;
  b.bounds(HX, HZ);
  const ply = '#ffffff';

  // ---------------------------------------------------------------- the shoot house: x −10…10, z −8…8, no roof
  b.with({ tint: ply, thin: true }, () => {
    b.wallX(-10, 10, -8, 3, 0.2, 'plywood', [D(0, 1.8), W(-6.5, 1.6, 1.1, 2.1), W(6.5, 1.6, 1.1, 2.1)]);
    b.wallX(-10, 10, 8, 3, 0.2, 'plywood', [D(0, 1.8), W(-6.5, 1.6, 1.1, 2.1), W(6.5, 1.6, 1.1, 2.1)]);
    // A door into each side room (the room divider meets the middle of the wall).
    b.wallZ(-8, 8, -10, 3, 0.2, 'plywood', [D(-3.6, 1.5), D(3.6, 1.5), W(-6.6, 1.2, 1.1, 2.1), W(6.6, 1.2, 1.1, 2.1)]);
    b.wallZ(-8, 8, 10, 3, 0.2, 'plywood', [D(-3.6, 1.5), D(3.6, 1.5), W(-6.6, 1.2, 1.1, 2.1), W(6.6, 1.2, 1.1, 2.1)]);
    // The hall down the middle, rooms either side (two each, split at z 0).
    b.wallZ(-8, 8, -3.5, 3, 0.16, 'plywood', [D(-4.5, 1.3), D(4.5, 1.3)]);
    b.wallZ(-8, 8, 3.5, 3, 0.16, 'plywood', [D(-4.5, 1.3), D(4.5, 1.3)]);
    b.wallX(-10, -3.5, 0, 3, 0.16, 'plywood', [D(-7, 1.3)]);
    b.wallX(3.5, 10, 0, 3, 0.16, 'plywood', [D(7, 1.3)]);
  });
  b.floor(-10, -8, 10, 8, 'concrete', '#a8a49a');
  // Hall cover: a table on its side and stacked crates; furniture props in the rooms.
  b.crates(0, -2.5, 2, 1.1);
  b.crates(0, 2.5, 2, 1.1);
  b.table(-7, -4, 1.6, 0.8, 0.75, 'wood');
  b.table(7, 4, 1.6, 0.8, 0.75, 'wood');
  b.prop('prop-shelves', -9.4, 5, 1, 1, { collide: true });
  b.prop('prop-shelves', 9.4, -5, 3, 1, { collide: true });
  b.prop('prop-cardboardboxes-1', -5, 6.6, 0, 1.2);
  b.prop('prop-cardboardboxes-1', 5, -6.6, 0, 1.2);
  // Pop-up targets (plywood, bullets go straight through).
  for (const [x, z] of [
    [-6, -1.6],
    [6, 1.6],
    [-1.8, -6.4],
    [1.8, 6.4],
  ] as Array<[number, number]>)
    b.with({ tint: '#f0e4c8', thin: true }, () => b.box(x - 0.3, 0, z - 0.04, x + 0.3, 1.8, z + 0.04, 'plywood'));

  // ---------------------------------------------------------------- the lanes and staging areas (south half, mirrored north)
  pointMirror(b, (w) => {
    // Long lane (z −22…−9): target stands, sandbags, a truck and a container for cover.
    for (const x of [-18, -12, 12, 18]) w.with({ tint: '#f0e4c8', thin: true }, () => w.box(x - 0.4, 0, -20.04, x + 0.4, 1.9, -19.96, 'plywood'));
    w.prop('prop-sacktrench', -4, -13, 0, 0.9);
    w.prop('prop-sacktrench-small', 8, -15.5, 0, 0.9);
    w.truck(-1, -18.5, false, 1, '#c8c0a8', '#4a5a3a');
    w.container(17, -13, 0, false, C[1]!);
    w.prop('prop-barrier-large', -22, -12, 0, 1);
    w.prop('prop-barrier-large', -15.5, -10.5, 0, 1);
    w.prop('prop-explodingbarrel', 11, -10, 0, 1, { explosive: true, shrink: 0.8 });
    w.prop('prop-barrel', 10.2, -10.6, 0, 1);
    w.prop('prop-pallet', 23, -18, 0, 1);
    w.prop('prop-milcrate', 23, -18, 0, 1, { y: 0.19, collide: false });
    // Guard tower (platform at 3.4 m, stairs from the east).
    w.box(-25, 3.2, -21, -21, 3.45, -17, 'wood');
    for (const [x, z] of [
      [-25, -21],
      [-21.2, -21],
      [-25, -17.2],
      [-21.2, -17.2],
    ] as Array<[number, number]>)
      w.box(x, 0, z, x + 0.2, 3.2, z + 0.2, 'wood');
    w.stairs(-21, -20.2, -16.8, -18.8, 'x-', 3.45, 'wood');
    w.rail(-25, -21, -21, -20.85, 3.45, 1, 'wood');
    w.rail(-25, -21, -24.85, -17, 3.45, 1, 'wood');
    w.rail(-25, -17.15, -21, -17, 3.45, 1, 'wood');
    w.with({ roof: true, tint: '#6a6a50' }, () => w.box(-25.3, 5.6, -21.3, -20.9, 5.75, -16.9, 'fabric'));
    for (const [x, z] of [
      [-25, -21],
      [-21.2, -21],
      [-25, -17.2],
      [-21.2, -17.2],
    ] as Array<[number, number]>)
      w.box(x, 3.45, z, x + 0.12, 5.6, z + 0.12, 'wood');
    // West staging area: an open-front tent, crates, a generator.
    w.with({ tint: '#6a6e4e', thin: true }, () => w.room(-31.5, -9, -27, -4.5, 2.6, 'fabric', 0.08, { e: [[-8.2, -5.3, 0, 2.3]] }));
    w.with({ roof: true, tint: '#5e6248' }, () => w.box(-31.7, 2.6, -9.2, -26.8, 2.75, -4.3, 'fabric'));
    w.table(-29.2, -6.8, 1.8, 0.9, 0.78, 'metal', '#5a5e60');
    w.prop('prop-ammobox', -29.6, -6.8, 1, 1.2, { y: 0.78, collide: false });
    w.prop('prop-generator', -30.5, -11.2, 0, 1);
    w.prop('prop-jerrycan', -29.5, -11.4, 1, 1, { collide: false });
    w.crates(-26, -15, 3, 1.2);
    w.prop('prop-cementbags', -18, -5, 1, 1);
    w.prop('prop-concreteblock', -18, -1.5, 1, 1);
  });

  return {
    id: 'killhouse',
    name: 'Killhouse',
    desc: 'A training compound: a roofless plywood shoot house you can shoot straight through, flanked by two long lanes.',
    half: [HX, HZ],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    cyls: b.cyls,
    spawns: [
      [sp(-24, -3, FACE.px), sp(-24, 1, FACE.px), sp(-25, 4.5, FACE.px), sp(-28.5, -2, FACE.px), sp(-28.5, 2, FACE.px), sp(-29, 13, FACE.px)],
      [sp(24, 3, FACE.nx), sp(24, -1, FACE.nx), sp(25, -4.5, FACE.nx), sp(28.5, 2, FACE.nx), sp(28.5, -2, FACE.nx), sp(29, -13, FACE.nx)],
    ],
    ffa: [sp(-29, -19, 0.8), sp(29, 19, -2.4), sp(-29, 19, 2.4), sp(29, -19, -0.8), sp(-5.5, -6.5, FACE.px), sp(5.5, 6.5, FACE.nx), sp(0, -14, FACE.pz), sp(0, 14, FACE.nz), sp(-23, -19, FACE.px, 3.45), sp(23, 19, FACE.nx, 3.45), sp(14, -18, FACE.nz), sp(-14, 18, FACE.pz)],
    flags: [
      { x: -18, z: 7, y: 0 },
      { x: 0, z: 0, y: 0 },
      { x: 18, z: -7, y: 0 },
    ],
    theme: {
      sky: 'day',
      ground: 'dirt',
      patches: [
        [-32, -22, 32, -9, 'gravel'],
        [-32, 9, 32, 22, 'gravel'],
        [-32, -9, -27, 9, 'concrete'],
        [27, -9, 32, 9, 'concrete'],
      ],
      sun: [0.45, 0.8, 0.35],
      fog: ['#d8d2c4', 80, 430],
    },
    backdrop: 'desert',
    size: 'small',
  };
}
