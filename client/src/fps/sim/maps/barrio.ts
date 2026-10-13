import { Builder, FACE, building, pointMirror, sp, type MapDef } from '../mapkit';

/**
 * A hillside slum at sundown (Favela-style, original layout): rows of brightly painted houses packed
 * along two streets, alleys between them, rooftops reached by outside stairs, and a dirt football
 * pitch with low walls in the middle where everything meets.
 */
export function barrio(): MapDef {
  const b = new Builder();
  const HX = 44;
  const HZ = 34;
  b.bounds(HX, HZ, 14, 'concrete');

  // ---------------------------------------------------------------- the pitch (x −11…11, z −7…7)
  for (const s of [-1, 1] as const) {
    // Low walls along the long sides, two gaps each.
    for (const [a, c] of [
      [-11.2, -5],
      [-3, 3],
      [5, 11.2],
    ] as Array<[number, number]>)
      b.with({ tint: '#c8beb0' }, () => b.box(a, 0, s * 7.2 - 0.15, c, 1.05, s * 7.2 + 0.15, 'concrete'));
    // End walls either side of the goal mouth.
    b.with({ tint: '#c8beb0' }, () => {
      b.box(s * 11.2 - 0.15, 0, -7.2, s * 11.2 + 0.15, 1.05, -2.4, 'concrete');
      b.box(s * 11.2 - 0.15, 0, 2.4, s * 11.2 + 0.15, 1.05, 7.2, 'concrete');
    });
    // Goal: posts, bar and a net.
    for (const z of [-1.7, 1.7]) b.box(s * 10.6 - 0.06, 0, z - 0.06, s * 10.6 + 0.06, 2.2, z + 0.06, 'paint', true);
    b.deco(s * 10.6 - 0.06, 2.14, -1.76, s * 10.6 + 0.06, 2.26, 1.76, 'paint', '#f0f0ec');
    b.deco(s * 11.1 - 0.02, 0, -1.7, s * 11.1 + 0.02, 2.1, 1.7, 'fabric', '#e8e8e4');
  }
  b.deco(-0.05, 0.02, -7, 0.05, 0.03, 7, 'paint', '#ece8dc');

  // ---------------------------------------------------------------- houses, streets and back alleys (south half, mirrored north)
  const awning = (w: Builder, x: number, z: number) => w.deco(x - 1.6, 2.45, z, x + 1.6, 2.55, z + 1.3, 'corrugated', '#9a8a78');
  pointMirror(b, (w) => {
    building(w, -43, -25, -33, -12, { mat: 'plaster', tint: '#d8704a', doors: [['s', -38], ['e', -16]], floors: 2 });
    building(w, -30, -24, -21, -13, { mat: 'plaster', tint: '#4a8ac8', doors: [['s', -25.5], ['w', -18.5]] });
    w.stairs(-30, -25.6, -24.2, -24.3, 'x+', 3.4, 'concrete');
    building(w, -18, -23, -8, -12, { mat: 'plaster', tint: '#e8c040', doors: [['s', -13], ['n', -13]], floors: 2 });
    building(w, -5, -22, 5, -13, { mat: 'brick', tint: '#c8a890', doors: [['s', 0], ['e', -17.5], ['w', -17.5]] });
    w.stairs(-5, -23.6, 0.8, -22.3, 'x+', 3.4, 'concrete');
    building(w, 8, -24, 18, -12, { mat: 'plaster', tint: '#c860a0', doors: [['s', 13], ['w', -18]], floors: 2 });
    building(w, 21, -23, 30, -12, { mat: 'plaster', tint: '#e8963a', doors: [['s', 25.5], ['e', -17.5]] });
    w.stairs(21, -24.6, 26.8, -23.3, 'x+', 3.4, 'concrete');
    building(w, 33, -27, 43, -13, { mat: 'plaster', tint: '#8a6ac8', doors: [['w', -20], ['s', 38]], floors: 2 });
    for (const x of [-38, -25.5, -13, 0, 13, 25.5]) awning(w, x, -12);
    // AC units and satellite clutter on the walls (out of the way, overhead).
    for (const [x, z, r] of [
      [-36, -11.7, 2],
      [-14, -11.7, 2],
      [11, -11.7, 2],
      [36, -12.7, 2],
    ] as Array<[number, number, number]>)
      w.prop('prop-aircon', x, z, r, 1, { y: 2.2, collide: false });
    // The street: parked cars, a cart, barrels, lamps.
    w.car(-30, -9.2, 1, '#c8b040');
    w.car(19, -9, 1, '#3a6a9a');
    w.table(-6, -9.5, 1.8, 1, 0.9, 'wood', '#8a6a4a');
    w.prop('prop-plasticcrate', -6, -9.5, 0, 1.4, { y: 0.9, collide: false });
    w.prop('prop-explodingbarrel', 6, -10.3, 0, 1, { explosive: true, shrink: 0.8 });
    w.prop('prop-barrel', 6.9, -10.5, 0, 1);
    w.prop('prop-streetlight', -20, -11.2, 0, 1.2, { collide: false });
    w.prop('prop-streetlight', 15, -11.2, 0, 1.2, { collide: false });
    w.prop('prop-trashbag', -19.5, -11.1, 0, 1, { collide: false });
    w.prop('prop-trashbag', 31.5, -11.2, 1, 1, { collide: false });
    // Back alley (z −34…−25): a dumpster, a car on blocks, tyres, crates.
    w.prop('prop-trashcontainer', -22, -29.5, 0, 1);
    w.car(-8, -29.5, 1, '#8a3a2a');
    w.prop('prop-debris-tires', 12, -30.5, 0, 1);
    w.crates(28, -31, 3, 1.2);
    w.prop('prop-cardboardboxes-3', 2, -31.5, 0, 1);
    w.prop('prop-utilitybox', -31, -33.2, 0, 1);
    w.prop('prop-debris-pile', 35, -30, 0, 1, { collide: false });
    // East end of the street (the far spawn's approach): crates against the wall.
    w.crates(42.4, -9.5, 2, 1.2);
    w.prop('prop-sacktrench-small', 31, -4, 1, 0.9);
  });

  return {
    id: 'barrio',
    name: 'Barrio',
    desc: 'A painted slum at sundown: tight alleys, rooftops up outside stairs, and a dirt football pitch in the middle.',
    half: [HX, HZ],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    cyls: b.cyls,
    spawns: [
      [sp(-40, -8, FACE.px), sp(-40, -4, FACE.px), sp(-40, 0, FACE.px), sp(-40, 4, FACE.px), sp(-37, -9.5, FACE.px), sp(-37, 8, FACE.px)],
      [sp(40, 8, FACE.nx), sp(40, 4, FACE.nx), sp(40, 0, FACE.nx), sp(40, -4, FACE.nx), sp(37, 9.5, FACE.nx), sp(37, -8, FACE.nx)],
    ],
    ffa: [sp(-38, -30, FACE.px), sp(38, 30, FACE.nx), sp(-25, -30, FACE.px), sp(25, 30, FACE.nx), sp(-15, -9, FACE.px), sp(15, 9, FACE.nx), sp(-8, -4, FACE.px), sp(8, 4, FACE.nx), sp(-27, -18, FACE.pz, 3.4), sp(27, 18, FACE.nz, 3.4), sp(0, -27, FACE.nz), sp(0, 27, FACE.pz)],
    flags: [
      { x: -26, z: -2, y: 0 },
      { x: 0, z: 0, y: 0 },
      { x: 26, z: 2, y: 0 },
    ],
    theme: {
      sky: 'dusk',
      ground: 'dirt',
      patches: [
        [-44, -11, 44, -7, 'asphalt'],
        [-44, 7, 44, 11, 'asphalt'],
        [-44, -7, -11, 7, 'asphalt'],
        [11, -7, 44, 7, 'asphalt'],
        [-44, -34, 44, -25, 'concrete'],
        [-44, 25, 44, 34, 'concrete'],
      ],
      sun: [-0.6, 0.38, 0.5],
      fog: ['#c89a78', 70, 420],
    },
    backdrop: 'city',
    size: 'medium',
  };
}
