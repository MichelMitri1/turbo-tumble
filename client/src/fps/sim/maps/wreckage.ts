import { Builder, FACE, building, pointMirror, sp, type MapDef } from '../mapkit';

/**
 * Wreckage: a desert town with a downed transport helicopter in the market street
 * (Crash-style). Two-storey houses with windows over the street, alleys, a market,
 * walled spawn courtyards. Point-symmetric.
 */
function half(b: Builder): void {
  const sand = '#d2b48a';
  const clay = '#c49a6a';
  const pale = '#e2cfa8';
  // Spawn courtyard (west): low walls with gaps, a lean-to.
  b.with({ tint: clay }, () => {
    b.wallZ(-30, -12, -44, 1.6, 0.5, 'plaster');
    b.wallZ(-6, 14, -44, 1.6, 0.5, 'plaster');
    b.wallZ(20, 30, -44, 1.6, 0.5, 'plaster');
  });
  b.with({ roof: true }, () => b.box(-51, 2.6, -8, -46, 2.8, 4, 'metal'));
  for (const z of [-8, 4]) b.pillar(-46.2, z, 0.15, 2.6, 'wood');
  b.crates(-49, -18, 3, 1.3);
  b.crates(-48, 24, 2, 1.3);
  b.car(-48, 10, 0, '#6a5a48');
  // The houses.
  building(b, -40, -34, -28, -22, { mat: 'plaster', tint: sand, floors: 2, doors: [['e', -28], ['s', -34], ['w', -30]], inner: true });
  building(b, -40, -16, -30, -4, { mat: 'plaster', tint: pale, doors: [['e', -10], ['n', -35]] });
  building(b, -25, -17, -13, -5, { mat: 'plaster', tint: clay, floors: 2, doors: [['w', -11], ['e', -11], ['s', -19]], inner: true });
  building(b, -26, 8, -14, 20, { mat: 'brick', tint: '#c8a888', floors: 2, doors: [['e', 14], ['n', -20], ['w', 14]] });
  building(b, -40, 10, -31, 22, { mat: 'plaster', tint: sand, doors: [['e', 16], ['s', -35]] });
  building(b, -12, -36, -3, -27, { mat: 'plaster', tint: pale, doors: [['s', -7.5], ['e', -31]], h: 3.4 });
  building(b, -12, 27, -4, 36, { mat: 'plaster', tint: clay, doors: [['n', -8], ['e', 31]] });
  // Market: stalls with awnings along the main street, mud walls, cover.
  const stall = (x: number, z: number, tint: string) => {
    b.counter(x - 1.3, z - 0.45, x + 1.3, z + 0.45, 0.9, 'wood', 'wood');
    for (const [dx, dz] of [[-1.4, -1], [1.4, -1], [-1.4, 1], [1.4, 1]] as Array<[number, number]>) b.deco(x + dx - 0.06, 0, z + dz - 0.06, x + dx + 0.06, 2.4, z + dz + 0.06, 'wood');
    b.deco(x - 1.6, 2.4, z - 1.2, x + 1.6, 2.5, z + 1.2, 'fabric', tint);
  };
  stall(-9, -12, '#b8402a');
  stall(-9, -20, '#2a6ab8');
  stall(-20, 3, '#d8a830');
  stall(-34, 2, '#3a8a4a');
  b.with({ tint: clay }, () => {
    b.wallX(-28, -20, 24.5, 1.8, 0.5, 'plaster');
    b.wallZ(-24, -18, -8, 1.4, 0.5, 'plaster');
    b.wallX(-40, -34, -1, 1.2, 0.5, 'plaster');
  });
  b.car(-19, -26, 1, '#8a7a60');
  b.car(-34, 30, 0, '#5a6a7a');
  b.prop('prop-sacktrench', -14, -1, 1, 0.9);
  b.prop('prop-sacktrench', -30, 27, 0, 0.9);
  b.prop('prop-debris-tires', -8, 22, 0, 1.2);
  b.prop('prop-explodingbarrel', -16, 23, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-watertank-floor', -45, -28, 1, 1.2);
  b.crates(-22, -35, 2, 1.3);
  b.crates(-6, -16, 3, 1.3);
}

export function wreckage(): MapDef {
  const b = new Builder();
  const HX = 52;
  const HZ = 40;
  b.bounds(HX, HZ);
  pointMirror(b, half, { '#d2b48a': '#d8c09a', '#c49a6a': '#b88c62' });
  // The wreck: a transport helicopter on its side across the street, tail snapped off.
  b.box(-4.5, 0, -1.6, 3.5, 2.6, 1.6, 'metal');
  b.deco(-4.6, 0.6, -1.65, -1, 2.0, -1.6, 'glass', '#2a3440');
  b.box(3.5, 0.6, -0.6, 6.5, 1.8, 0.6, 'metal');
  b.box(7.2, 0, -2.2, 10.5, 1.2, -0.8, 'metal');
  b.deco(10.5, 0, -2.6, 10.7, 2.2, -0.4, 'metal');
  b.deco(-1, 2.6, -6.5, 0.2, 2.7, 6.5, 'metal', '#2a2c30');
  b.deco(-7, 0.02, 1.5, -1, 0.12, 2.2, 'metal', '#2a2c30');
  b.box(-6.8, 0, 3.6, -5.2, 0.9, 5.4, 'metal');
  b.box(5, 0, -5, 6.4, 0.7, -3.4, 'metal');
  b.prop('prop-debris-pile', -2, 4.5, 0, 1.4, { collide: false });
  b.prop('prop-debris-pile', 2, -4.5, 2, 1.4, { collide: false });
  return {
    id: 'wreckage',
    name: 'Wreckage',
    desc: 'A desert town around a downed chopper. Windows, rooftops, alleys — classic three-lane.',
    half: [HX, HZ],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    cyls: b.cyls,
    spawns: [
      [sp(-48, -14, FACE.px), sp(-48, -6, FACE.px), sp(-49, 0, FACE.px), sp(-48, 16, FACE.px), sp(-48, 20, FACE.px), sp(-49, -24, FACE.px)],
      [sp(48, 14, FACE.nx), sp(48, 6, FACE.nx), sp(49, 0, FACE.nx), sp(48, -16, FACE.nx), sp(48, -20, FACE.nx), sp(49, 24, FACE.nx)],
    ],
    ffa: [sp(-48, -36, 0.8), sp(48, 36, -2.4), sp(-48, 36, 2.4), sp(48, -36, -0.8), sp(-34, -28, FACE.px), sp(34, 28, FACE.nx), sp(-35, 15, FACE.px), sp(35, -15, FACE.nx), sp(0, -36, FACE.pz), sp(0, 36, FACE.nz), sp(-19, -9, FACE.px), sp(19, 9, FACE.nx)],
    flags: [
      { x: -22, z: -1, y: 0 },
      { x: 0, z: 9, y: 0 },
      { x: 22, z: 1, y: 0 },
    ],
    theme: {
      sky: 'day',
      ground: 'sand',
      patches: [
        [-52, -3, 52, 3, 'dirt'],
        [-3, -40, 3, 40, 'dirt'],
        [-12, -24, 12, -14, 'dirt'],
        [-12, 14, 12, 24, 'dirt'],
      ],
      sun: [0.55, 0.8, 0.25],
      fog: ['#e2cba6', 90, 480],
    },
    backdrop: 'desert',
    size: 'large',
  };
}
