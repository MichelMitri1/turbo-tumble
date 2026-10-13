import { Builder, FACE, building, pointMirror, sp, type MapDef } from '../mapkit';

/**
 * A desert market town where two roads cross (Crossfire-style, original layout): sandstone houses
 * with rooftops along the main road, market stalls on the pavements, wrecks in the street, a burnt-out
 * bus down the cross street and walled courtyards (and a minaret) behind the houses.
 */
export function crossroads(): MapDef {
  const b = new Builder();
  const HX = 48;
  const HZ = 34;
  b.bounds(HX, HZ, 14, 'concrete');

  // ---------------------------------------------------------------- the crossing: two planters
  for (const s of [-1, 1] as const) {
    b.with({ tint: '#d8ccb4' }, () => b.box(s * 8 - 0.8, 0, -0.8, s * 8 + 0.8, 0.9, 0.8, 'concrete'));
    b.deco(s * 8 - 0.7, 0.9, -0.7, s * 8 + 0.7, 1.25, 0.7, 'hedge');
  }

  // ---------------------------------------------------------------- one side of the street (mirrored to the other)
  const stall = (w: Builder, x: number, colour: string) => {
    w.table(x, -6.3, 2.2, 1.1, 0.9, 'wood', '#9a7a58');
    for (const [dx, dz] of [
      [-1.25, -7.1],
      [1.25, -7.1],
      [-1.25, -5.5],
      [1.25, -5.5],
    ] as Array<[number, number]>)
      w.deco(x + dx - 0.04, 0, dz - 0.04, x + dx + 0.04, 2.3, dz + 0.04, 'wood');
    w.deco(x - 1.4, 2.3, -7.3, x + 1.4, 2.36, -5.3, 'fabric', colour);
  };
  pointMirror(b, (w) => {
    building(w, -47, -20, -35, -8, { mat: 'plaster', tint: '#d8c49a', doors: [['s', -41], ['e', -14]], floors: 2 });
    building(w, -31, -18, -21, -8, { mat: 'plaster', tint: '#c8a878', doors: [['s', -26], ['w', -13]] });
    w.stairs(-31, -19.6, -25.2, -18.3, 'x+', 3.4, 'concrete');
    building(w, -18, -22, -7, -9, { mat: 'plaster', tint: '#e0d0b0', doors: [['s', -12.5], ['e', -15.5]], floors: 2 });
    building(w, 7, -20, 19, -9, { mat: 'plaster', tint: '#b89a70', doors: [['s', 13], ['w', -14.5]], floors: 2 });
    building(w, 23, -24, 33, -12, { mat: 'brick', tint: '#d8c0a0', doors: [['s', 28], ['n', 28]] });
    w.stairs(23, -25.6, 28.8, -24.3, 'x+', 3.4, 'concrete');
    building(w, 37, -22, 47, -10, { mat: 'plaster', tint: '#c4ac84', doors: [['w', -16], ['s', 42]], floors: 2 });
    // Market stalls on the pavement.
    stall(w, -34, '#b83a2a');
    stall(w, -24, '#2a6a9a');
    stall(w, -15, '#d8a830');
    stall(w, 11, '#3a8a5a');
    stall(w, 21, '#8a3a7a');
    stall(w, 31, '#c86a2a');
    w.prop('prop-cardboardboxes-1', -33.5, -6.3, 0, 1, { y: 0.9, collide: false });
    w.prop('prop-plasticcrate', -24, -6.3, 1, 1.5, { y: 0.9, collide: false });
    w.prop('prop-cementbags', 21, -6.3, 0, 1, { y: 0.9, collide: false });
    // Wrecks in the road, a burnt-out bus down the cross street.
    w.car(-28, -2.5, 1, '#c8c0b0');
    w.car(14, -2.2, 1, '#4a6a8a');
    w.bus(0, -18, true, 1, '#6a5a48');
    w.prop('prop-debris-tires', -5.5, -10, 0, 1);
    w.prop('prop-concreteblock', 5.5, -7.8, 0, 1);
    w.prop('prop-barrier-single', -40, -4.2, 0, 1);
    // Courtyards behind the houses: a minaret, a well, palms, a wrecked car, crates.
    w.cyl(-41, 0, -29, 1.3, 13, 'y', 'plaster', '#e8dcc0');
    w.cyl(-41, 13, -29, 1.7, 0.4, 'y', 'plaster', '#d8ccb0', false);
    w.with({ tint: '#d8c49a' }, () => {
      w.box(-48, 0, -24.2, -30, 2.2, -23.8, 'plaster');
      w.box(-26, 0, -24.2, -8, 2.2, -23.8, 'plaster');
    });
    w.cyl(-17, 0, -29, 1, 0.9, 'y', 'concrete', '#c8bca8');
    w.prop('prop-tree-3', -10, -30, 0, 1.4);
    w.prop('prop-tree-3', 9, -29, 1, 1.4);
    w.car(17, -29.5, 1, '#8a6a4a');
    w.crates(37, -29, 3, 1.3);
    w.prop('prop-explodingbarrel', 30.5, -28, 0, 1, { explosive: true, shrink: 0.8 });
    w.prop('prop-jerrycan', 31.2, -27.6, 0, 1, { collide: false });
    w.prop('prop-streetlight', -20, -7.2, 0, 1.2, { collide: false });
    w.prop('prop-streetlight', 24, -7.2, 0, 1.2, { collide: false });
  });

  return {
    id: 'crossroads',
    name: 'Crossroads',
    desc: 'A desert market town where two roads cross: rooftops, stalls on the pavements and a burnt-out bus down the middle.',
    half: [HX, HZ],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    cyls: b.cyls,
    spawns: [
      [sp(-45, -6, FACE.px), sp(-45, -2, FACE.px), sp(-45, 2, FACE.px), sp(-45, 6, FACE.px), sp(-41, -1, FACE.px), sp(-41, 3, FACE.px)],
      [sp(45, 6, FACE.nx), sp(45, 2, FACE.nx), sp(45, -2, FACE.nx), sp(45, -6, FACE.nx), sp(41, 1, FACE.nx), sp(41, -3, FACE.nx)],
    ],
    ffa: [sp(-34, -30, FACE.px), sp(34, 30, FACE.nx), sp(-21, -29, FACE.pz), sp(21, 29, FACE.nz), sp(-12, -15, FACE.px), sp(12, 15, FACE.nx), sp(-26, -13, FACE.pz, 3.4), sp(26, 13, FACE.nz, 3.4), sp(0, -28, FACE.nz), sp(0, 28, FACE.pz), sp(-3, -4, FACE.px), sp(3, 4, FACE.nx)],
    flags: [
      { x: -22, z: 1.5, y: 0 },
      { x: 0, z: 0, y: 0 },
      { x: 22, z: -1.5, y: 0 },
    ],
    theme: {
      sky: 'day',
      ground: 'sand',
      patches: [
        [-48, -5, 48, 5, 'asphalt'],
        [-4, -34, 4, 34, 'asphalt'],
        [-48, -7, 48, -5, 'concrete'],
        [-48, 5, 48, 7, 'concrete'],
        [-48, -34, 48, -24, 'gravel'],
        [-48, 24, 48, 34, 'gravel'],
      ],
      sun: [0.3, 0.85, 0.4],
      fog: ['#e0d0b0', 90, 480],
    },
    backdrop: 'desert',
    size: 'medium',
  };
}
