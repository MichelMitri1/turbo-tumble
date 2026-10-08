import { Builder, D, FACE, W, building, pointMirror, sp, type MapDef } from '../mapkit';

/**
 * Farmstead: two neighbouring farms (Overgrown-style countryside). A barn with a hayloft,
 * a farmhouse, a silo, wheat fields to crawl through, hedgerows and stone walls, and a
 * ruined chapel at the crossroads in the middle. Point-symmetric.
 */
function half(b: Builder): void {
  const stone = '#9a948a';
  // Farmhouse.
  building(b, -40, -30, -28, -18, { mat: 'plaster', tint: '#e6dcc4', floors: 2, doors: [['e', -24], ['s', -34], ['n', -31]], roof: 'pitched', roofTint: '#6a4030', inner: true, floor: ['darkwood', '#c8a888'] });
  b.table(-36, -26, 1.6, 1, 0.76, 'wood');
  b.sofa(-31, -21, 2.2, 0.9, 's', '#6a5a3a');
  // Barn: tall, open at both ends, a hayloft along the west half.
  const red = '#8a3a2a';
  b.with({ tint: red }, () => {
    b.wallX(-26, -10, 12, 6, 0.3, 'wood', [W(-22, 1.4, 1.2, 2.4), W(-14, 1.4, 1.2, 2.4)]);
    b.wallX(-26, -10, 26, 6, 0.3, 'wood', [D(-18, 1.6, 2.4), W(-22, 1.4, 1.2, 2.4), W(-14, 1.4, 1.2, 2.4)]);
    b.wallZ(12, 26, -26, 6, 0.3, 'wood', [[16, 22, 0, 4.4]]);
    b.wallZ(12, 26, -10, 6, 0.3, 'wood', [[16, 22, 0, 4.4]]);
  });
  b.with({ roof: true, tint: '#5a4a44' }, () => b.box(-26.4, 6, 11.6, -9.6, 6.2, 26.4, 'shingle'));
  b.roofTop(-26.6, 11.4, -9.4, 26.6, 6.2, true, '#5a4a44', 5, 0.6);
  b.floor(-26, 12, -10, 26, 'dirt', '#a88a5a');
  b.slab(-25.8, 12.2, -19, 25.8, 3.2, 0.25, 'wood', [[-25.8, 12.2, -24.2, 18.6]]);
  b.stairs(-25.7, 12.4, -24.3, 18.5, 'z+', 3.45, 'wood');
  b.rail(-19.15, 12.2, -19, 25.8, 3.45);
  const hay = '#d8c070';
  for (const [x, z, y] of [[-23, 22, 3.45], [-21, 24, 3.45], [-22, 15, 3.45], [-14, 14, 0], [-13, 24, 0], [-16, 23.5, 0], [-12.5, 18, 0]] as Array<[number, number, number]>) b.with({ tint: hay }, () => b.box(x - 0.6, y, z - 0.45, x + 0.6, y + 0.9, z + 0.45, 'dirt', true));
  b.with({ tint: hay }, () => b.box(-13.6, 0.9, 13.55, -12.4, 1.8, 14.45, 'dirt', true));
  // Silo.
  b.cyl(-32, 0, 30, 2.6, 12, 'y', 'metal', '#b8bcc0');
  b.cyl(-32, 12, 30, 2.7, 0.6, 'y', 'metal', '#8a8e92', false);
  // Tractor.
  b.box(-15.2, 0.6, -11.6, -12.8, 2.1, -8.4, 'paint');
  b.deco(-15.2, 0.6, -11.6, -12.8, 2.1, -8.4, 'paint', '#3a7a3a');
  b.cyl(-14, 0.85, -8.6, 0.85, 3, 'x', 'metal', '#1a1a1a', false);
  b.cyl(-14, 0.5, -11.8, 0.5, 2.6, 'x', 'metal', '#1a1a1a', false);
  b.deco(-14.4, 2.1, -10.8, -13.6, 3.1, -10.4, 'metal', '#2a2a2a');
  // Fields: wheat rows (crouch to hide) and a crop patch.
  for (let z = -42; z <= -34; z += 1.6) b.with({ tint: '#c8b048' }, () => b.box(-22, 0, z, -6, 1.15, z + 0.55, 'hedge', true));
  for (let x = -52; x <= -44; x += 1.6) b.with({ tint: '#7a9a3a' }, () => b.box(x, 0, -16, x + 0.55, 1.0, -4, 'hedge', true));
  // Hedgerows and dry-stone walls with gaps.
  b.fence(-56, 6, -46, 6, 2.1, 'hedge', undefined, 1.2);
  b.fence(-42, 6, -30, 6, 2.1, 'hedge', undefined, 1.2);
  b.fence(-6, 34, -6, 44, 2.1, 'hedge', undefined, 1.2);
  b.with({ tint: stone }, () => {
    b.box(-30, 0, -44, -29.4, 1.1, -36, 'brick');
    b.box(-30, 0, -32, -29.4, 1.1, -14, 'brick');
    b.box(-24, 0, -4.6, -10, 1.1, -4, 'brick');
    b.box(-44, 0, 32, -38, 1.1, 32.6, 'brick');
  });
  // Paddock fence around the barn yard.
  for (const [x0, z0, x1, z1] of [[-8, 4, -8, 10], [-8, 28, -8, 34], [-30, 34, -14, 34]] as Array<[number, number, number, number]>) b.fence(x0, z0, x1, z1, 1.2, 'wood', '#8a6a4a', 0.15);
  // Trees and clutter.
  for (const [x, z, m] of [[-50, -26, 'prop-tree-1'], [-46, 20, 'prop-tree-3'], [-36, 40, 'prop-tree-2'], [-4, -26, 'prop-tree-1'], [-24, 38, 'prop-tree-3']] as Array<[number, number, string]>) b.prop(m, x, z, 0, 2.3);
  b.crates(-34, -12, 3, 1.3);
  b.prop('prop-woodplanks', -20, 8, 0, 1.4, { collide: false });
  b.prop('prop-debris-tires', -34, 18, 0, 1.2);
  b.prop('prop-gastank', -8, 18, 0, 1);
}

export function farmstead(): MapDef {
  const b = new Builder();
  const HX = 56;
  const HZ = 44;
  b.bounds(HX, HZ);
  pointMirror(b, half, { '#8a3a2a': '#7a5a3a', '#e6dcc4': '#d8e0e6' });
  // The ruined chapel at the crossroads (no roof, broken walls).
  const ruin = '#a8a49a';
  b.with({ tint: ruin }, () => {
    b.wallX(-5, 5, -7, 3.6, 0.6, 'brick', [D(0, 1.8, 2.8), [-4.2, -2.6, 2.2, 3.6]]);
    b.wallX(-5, 1.5, 7, 2.4, 0.6, 'brick', [W(-2.5, 1.4, 1, 2.1)]);
    b.wallX(3, 5, 7, 1.2, 0.6, 'brick');
    b.wallZ(-7, 7, -5, 3, 0.6, 'brick', [W(-3.5, 1.2, 1, 2.4), [0.5, 3.5, 0.9, 3]]);
    b.wallZ(-7, -1, 5, 3.6, 0.6, 'brick', [W(-4, 1.2, 1, 2.4)]);
    b.wallZ(2, 7, 5, 1.6, 0.6, 'brick');
  });
  b.pillar(-4.4, -8.2, 1.2, 6, 'brick');
  b.prop('prop-debris-pile', 1, 2, 0, 1.4, { collide: false });
  for (const [x, z] of [[-2.6, 3.5], [2.6, -3.5], [-2.6, -1], [2.6, 1]] as Array<[number, number]>) b.box(x - 0.9, 0, z - 0.3, x + 0.9, 0.5, z + 0.3, 'darkwood');
  // Graves outside.
  for (const [x, z] of [[8, -4], [8, -1], [8, 2], [-8, 4], [-8, 1], [-8, -2]] as Array<[number, number]>) b.with({ tint: ruin }, () => b.box(x - 0.3, 0, z - 0.5, x + 0.3, 0.9, z + 0.5, 'concrete'));
  return {
    id: 'farmstead',
    name: 'Farmstead',
    desc: 'Two farms and a ruined chapel: barns with haylofts, wheat fields, hedgerows. Wide and open with cover.',
    half: [HX, HZ],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    cyls: b.cyls,
    spawns: [
      [sp(-52, -2, FACE.px), sp(-52, 2, FACE.px), sp(-52, 14, FACE.px), sp(-50, 26, FACE.px), sp(-52, -28, FACE.px), sp(-52, -36, FACE.px)],
      [sp(52, 2, FACE.nx), sp(52, -2, FACE.nx), sp(52, -14, FACE.nx), sp(50, -26, FACE.nx), sp(52, 28, FACE.nx), sp(52, 36, FACE.nx)],
    ],
    ffa: [sp(-52, -40, 0.8), sp(52, 40, -2.4), sp(-52, 40, 2.4), sp(52, -40, -0.8), sp(-34, -24, FACE.px), sp(34, 24, FACE.nx), sp(-18, 19, FACE.px), sp(18, -19, FACE.nx), sp(0, -40, FACE.pz), sp(0, 40, FACE.nz), sp(0, 0, FACE.pz), sp(-40, 0, FACE.px)],
    flags: [
      { x: -18, z: 19, y: 0 },
      { x: 0, z: 0, y: 0 },
      { x: 18, z: -19, y: 0 },
    ],
    theme: {
      sky: 'day',
      ground: 'grass',
      patches: [
        [-56, -2, 56, 2, 'dirt'],
        [-2, -44, 2, 44, 'dirt'],
        [-26, 12, -10, 26, 'dirt'],
        [10, -26, 26, -12, 'dirt'],
      ],
      sun: [-0.5, 0.75, 0.35],
      fog: ['#c8d8e0', 90, 470],
    },
    backdrop: 'estate',
    size: 'large',
  };
}
