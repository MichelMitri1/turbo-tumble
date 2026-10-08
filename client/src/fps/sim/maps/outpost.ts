import { Builder, CONTAINER_L, CONTAINER_S, D, FACE, W, house, faceCentre, sp, type MapDef } from '../mapkit';
import type { Material } from '../level';

/** Desert town: a two-storey compound in the middle, walled spawn courtyards, houses on the corners. */
export function outpost(): MapDef {
  const b = new Builder();
  const H = 54;
  b.bounds(H, H);
  // Central two-storey compound with a rooftop.
  const t = 0.4;
  const wall: Material = 'concrete';
  b.wallX(-7, 7, -5, 3.2, t, wall, [
    [-1, 1, 0, 2.3],
    [-5, -3, 1.1, 2.3],
    [3, 5, 1.1, 2.3],
  ]);
  b.wallX(-7, 7, 5, 3.2, t, wall, [
    [-1, 1, 0, 2.3],
    [-5, -3, 1.1, 2.3],
    [3, 5, 1.1, 2.3],
  ]);
  b.wallZ(-5, 5, -7, 3.2, t, wall, [[-1, 1, 0, 2.3]]);
  b.wallZ(-5, 5, 7, 3.2, t, wall, [[-1, 1, 0, 2.3]]);
  b.box(-7, 3.2, -5, 7, 3.5, 5, 'concrete'); // first floor slab
  // Upstairs: open room with windows on all sides.
  b.wallX(-7, 7, -5, 2.8, t, wall, [
    [-5, -2.5, 1, 2.2],
    [-1.2, 1.2, 0, 2.3],
    [2.5, 5, 1, 2.2],
  ], 3.5);
  b.wallX(-7, 7, 5, 2.8, t, wall, [
    [-5, -1, 1, 2.2],
    [1, 5, 1, 2.2],
  ], 3.5);
  b.wallZ(-5, 5, -7, 2.8, t, wall, [[-3, 3, 1, 2.2]], 3.5);
  b.wallZ(-5, 5, 7, 2.8, t, wall, [[-3, 3, 1, 2.2]], 3.5);
  b.box(-7.3, 6.3, -5.3, 7.3, 6.6, 5.3, 'concrete'); // roof
  // Outside stairs up the south face to the first floor door.
  b.stairs(-6.8, -8.2, -2.2, -5.4, 'x+', 3.5, 'concrete');
  b.box(-2.2, 3.2, -8.2, 1, 3.5, -5.2, 'concrete'); // landing
  // Sandbag trenches and T-walls along the lanes.
  for (const [x, z, r] of [
    [-20, -8, 1],
    [20, 8, 1],
    [-12, 14, 0],
    [12, -14, 0],
    [-30, 20, 0],
    [30, -20, 0],
    [-24, -24, 0],
    [24, 24, 0],
  ] as Array<[number, number, number]>)
    b.prop('prop-sacktrench', x, z, r, 0.9);
  for (const [x, z, r] of [
    [-16, 24, 0],
    [-12, 24, 0],
    [16, -24, 0],
    [12, -24, 0],
    [-34, -8, 1],
    [34, 8, 1],
  ] as Array<[number, number, number]>)
    b.prop('prop-barrier-large', x, z, r, 1, { tint: '#b8ad96' });
  // Wrecks and containers.
  b.prop('prop-tank', -21, 17, 1, [2.6, 1.4, 2.6], { tint: '#6b6a4a' });
  b.prop('prop-debris-brokencar', 18, -6, 1, 1, { tint: '#8a7a60' });
  b.prop('prop-debris-brokencar', -26, -16, 0, 1, { tint: '#6a5a4a' });
  b.prop('prop-container-long', 24, -30, 0, CONTAINER_L, { tint: '#8a5a2a' });
  b.prop('prop-container-small', 30, -24, 1, CONTAINER_S, { tint: '#4a5a3a' });
  b.prop('prop-container-long', -24, 30, 0, CONTAINER_L, { tint: '#5a4a3a' });
  b.prop('prop-container-small', 0, 28, 1, CONTAINER_S, { tint: '#7a2a22' });
  b.prop('prop-container-small', 0, -28, 1, CONTAINER_S, { tint: '#2a4a6a' });
  // Spawn courtyards: mud-brick walls with gates, a hut to hide in.
  for (const side of [-1, 1] as const) {
    const lo = Math.min(side * 42, side * 54);
    const hi = Math.max(side * 42, side * 54);
    const gate: [number, number] = [Math.min(side * 47, side * 49.5), Math.max(side * 47, side * 49.5)];
    b.with({ tint: '#c8a070' }, () => {
      b.wallZ(-14, 14, side * 42, 2.6, 0.5, 'plaster', [
        [-10, -7, 0, 2.6],
        [7, 10, 0, 2.6],
      ]);
      b.wallX(lo, hi, -14, 2.6, 0.5, 'plaster', [[gate[0], gate[1], 0, 2.6]]);
      b.wallX(lo, hi, 14, 2.6, 0.5, 'plaster', [[gate[0], gate[1], 0, 2.6]]);
    });
    const h0 = Math.min(side * 48, side * 53);
    const h1 = Math.max(side * 48, side * 53);
    b.with({ tint: '#b89870' }, () => b.room(h0, -5, h1, 5, 3, 'brick', 0.3, side > 0 ? { w: [D(0), W(-3), W(3)], n: [W(side * 50.5)], s: [W(side * 50.5)] } : { e: [D(0), W(-3), W(3)], n: [W(side * 50.5)], s: [W(side * 50.5)] }));
    b.with({ roof: true }, () => b.box(h0 - 0.3, 3, -5.3, h1 + 0.3, 3.25, 5.3, 'metal'));
    b.floor(h0, -5, h1, 5, 'carpet', '#8a4a3a');
    b.prop('prop-sacktrench', side * 44.5, -7, 1, 0.9);
    b.prop('prop-sacktrench', side * 44.5, 7, 1, 0.9);
    b.crates(side * 52, -11, 3);
    b.crates(side * 52, 11, 2);
  }
  // Two-storey houses on the far corners.
  house(b, -20, -1, -36, 'plaster', '#c8a878', '#7a5a40');
  house(b, 20, 1, 36, 'plaster', '#c8a878', '#7a5a40');
  // Market street: stalls with awnings.
  const stall = (x: number, z: number, tint: string) => {
    b.counter(x - 1.3, z - 0.45, x + 1.3, z + 0.45, 0.9, 'wood', 'wood');
    for (const [dx, dz] of [[-1.4, -1], [1.4, -1], [-1.4, 1], [1.4, 1]] as Array<[number, number]>) b.deco(x + dx - 0.06, 0, z + dz - 0.06, x + dx + 0.06, 2.4, z + dz + 0.06, 'wood');
    b.deco(x - 1.6, 2.4, z - 1.2, x + 1.6, 2.5, z + 1.2, 'fabric', tint);
  };
  for (const [x, z, t] of [[-10, -18, '#b8402a'], [-5, -18, '#2a6ab8'], [5, -18, '#d8a830'], [10, -18, '#3a8a4a'], [10, 18, '#b8402a'], [5, 18, '#2a6ab8'], [-5, 18, '#d8a830'], [-10, 18, '#3a8a4a']] as Array<[number, number, string]>) stall(x, z, t);
  // Ruined walls.
  b.with({ tint: '#c0a074' }, () => {
    b.wallX(-38, -33, -18, 2.4, 0.5, 'plaster', [W(-35, 1.4, 1, 1.9)]);
    b.wallX(33, 38, 18, 2.4, 0.5, 'plaster', [W(35, 1.4, 1, 1.9)]);
    b.wallX(-6, -1, 40, 2, 0.5, 'plaster');
    b.wallX(1, 6, -40, 2, 0.5, 'plaster');
    b.wallZ(30, 35, -14, 2.2, 0.5, 'plaster');
    b.wallZ(-35, -30, 14, 2.2, 0.5, 'plaster');
    b.wallZ(-24, -19, -44, 2.2, 0.5, 'plaster');
    b.wallZ(19, 24, 44, 2.2, 0.5, 'plaster');
  });
  // Water towers and scatter.
  b.prop('prop-watertank-platform', 36, -36, 0, 1.8);
  b.prop('prop-watertank-platform', -36, 36, 2, 1.8);
  for (const [x, z] of [
    [8, 18],
    [-8, -18],
    [38, -4],
    [-38, 4],
    [-14, -36],
    [14, 36],
  ] as Array<[number, number]>) {
    b.prop('prop-crate', x, z, 0, 1.4);
    b.prop('prop-crate', x + 1.1, z + 0.2, 1, 1.4);
  }
  b.prop('prop-explodingbarrel', 9, 7, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-explodingbarrel', -9, -7, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-explodingbarrel', 27, 0, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-debris-tires', -5, 12, 0, 1.2);
  b.prop('prop-debris-tires', 5, -12, 0, 1.2);
  b.prop('prop-pipes', -28, -2, 0, 1.3);
  b.prop('prop-pipes', 28, 2, 0, 1.3);
  b.prop('prop-tree-2', -40, -40, 0, 2.4, { tint: '#b8a060' });
  b.prop('prop-tree-2', 40, 40, 0, 2.4, { tint: '#b8a060' });
  return {
    id: 'outpost',
    name: 'Outpost',
    desc: 'A desert town around a two-storey compound. Long sightlines, walled spawns, a market street.',
    half: [H, H],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    spawns: [
      faceCentre([sp(-45, -3, FACE.px), sp(-45, 3, FACE.px), sp(-45, -11, FACE.px), sp(-45, 11, FACE.px), sp(-50.5, 0, FACE.px), sp(-50.5, -8.5, FACE.px), sp(-50.5, 8.5, FACE.px)], H, H),
      faceCentre([sp(45, 3, FACE.nx), sp(45, -3, FACE.nx), sp(45, 11, FACE.nx), sp(45, -11, FACE.nx), sp(50.5, 0, FACE.nx), sp(50.5, 8.5, FACE.nx), sp(50.5, -8.5, FACE.nx)], H, H),
    ],
    ffa: faceCentre([sp(-50, -50, 0.8), sp(50, 50, -2.4), sp(-50, 50, 2.4), sp(50, -50, -0.8), sp(0, -50, FACE.pz), sp(0, 50, FACE.nz), sp(-50.5, 0, FACE.px), sp(50.5, 0, FACE.nx), sp(-23.5, -37, FACE.px), sp(23.5, 37, FACE.nx), sp(-33, 23.5, 1), sp(33, -23.5, -2)], H, H),
    flags: [
      { x: -28, z: 8, y: 0 },
      { x: 0, z: 10, y: 0 },
      { x: 28, z: -8, y: 0 },
    ],
    theme: { sky: 'dusk', ground: 'sand', patches: [[-54, -3, 54, 3, 'dirt'], [-3, -54, 3, 54, 'dirt'], [-14, -21, 14, -15, 'dirt'], [-14, 15, 14, 21, 'dirt'], [-9, -7, 9, 7, 'concrete']], sun: [0.6, 0.45, -0.4], fog: ['#d6b48a', 90, 480] },
    backdrop: 'desert',
    size: 'large',
  };
}
