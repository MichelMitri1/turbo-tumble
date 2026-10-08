import { Builder, CONTAINER_H, CONTAINER_COLORS as C, CONTAINER_S, D, FACE, W, faceCentre, sp, type MapDef } from '../mapkit';

/** Container yard: two warehouses (the spawns), stacked container lanes, a climbable stack in the middle. */
export function freight(): MapDef {
  const b = new Builder();
  const H = 32;
  b.bounds(H, H, 14, 'metal');

  // Team warehouses: enclosed sheds with three big bay doors facing the yard.
  for (const side of [-1, 1] as const) {
    const xf = side * 22;
    const xb = side * 32;
    const lo = Math.min(xf, xb);
    const hi = Math.max(xf, xb);
    b.with({ tint: side < 0 ? '#c4d0dc' : '#e0ccb0' }, () => {
      b.wallZ(-10, 10, xf, 5.5, 0.4, 'metal', [
        [-7.5, -4, 0, 3.4],
        [-1.75, 1.75, 0, 3.4],
        [4, 7.5, 0, 3.4],
      ]);
      b.wallZ(-10, 10, xb, 5.5, 0.4, 'metal');
      b.wallX(lo, hi, -10, 5.5, 0.4, 'metal', [D(side * 25.8, 1.6), W(side * 29, 2, 2.2, 3.4)]);
      b.wallX(lo, hi, 10, 5.5, 0.4, 'metal', [D(side * 25.8, 1.6), W(side * 29, 2, 2.2, 3.4)]);
    });
    b.with({ roof: true, tint: '#b0b8c0' }, () => b.box(lo - 0.3, 5.5, -10.3, hi + 0.3, 5.8, 10.3, 'metal'));
    b.floor(lo, -10, hi, 10, 'concrete', '#a8a49c');
    // Racks along the back wall and pallets of crates by the doors.
    b.shelf(side * 30.2, -8.5, side * 31.4, -2.5, 3, 'metal', '#3a5a8a');
    b.shelf(side * 30.2, 2.5, side * 31.4, 8.5, 3, 'metal', '#3a5a8a');
    b.crates(side * 24, -9 + 0.2, 2);
    b.prop('prop-pallet', side * 26, 8.6, 0, 1.2, { collide: false });
    b.prop('prop-cardboardboxes-3', side * 26, 8.6, 0, 1);
    b.prop('prop-gastank', side * 29, 0, 0, 1);
  }

  // Centre: two containers with a corridor between them; stairs up onto each.
  b.container(-3, 0, 1, true, C[2]!);
  b.container(3, 0, 1, true, C[3]!);
  b.stairs(-4.2, -10, -1.8, -5.6, 'z+', CONTAINER_H, 'metal');
  b.stairs(1.8, 5.6, 4.2, 10, 'z-', CONTAINER_H, 'metal');
  b.prop('prop-crate', -3, 3, 0, 1.4, { y: CONTAINER_H });
  b.prop('prop-crate', 3, -3, 0, 1.4, { y: CONTAINER_H });

  // Lanes (point-symmetric so both sides play the same).
  const both = (fn: (s: 1 | -1) => void) => [1, -1].forEach((s) => fn(s as 1 | -1));
  both((s) => {
    const k = s > 0 ? 0 : 3;
    // A two-high container wall, a long container, a short one across the lane.
    b.container(-11 * s, -22 * s, 0, true, C[(0 + k) % 6]!);
    b.container(-11 * s, -22 * s, 0, true, C[(1 + k) % 6]!, CONTAINER_H);
    b.container(11 * s, -27 * s, 0, true, C[(4 + k) % 6]!);
    b.container(1 * s, -19 * s, 1, false, C[(5 + k) % 6]!);
    b.container(-16 * s, -14 * s, 0, false, C[(2 + k) % 6]!);
    b.container(17 * s, -17 * s, 1, false, C[(3 + k) % 6]!);
    b.container(-26 * s, -24 * s, 1, false, C[(1 + k) % 6]!);
    b.container(26 * s, -14 * s, 0, false, C[(0 + k) % 6]!);
    b.crates(-4 * s, -27 * s);
    b.crates(6 * s, -13 * s);
    b.crates(20 * s, -29 * s, 2);
    b.prop('prop-sacktrench', -6 * s, -15.5 * s, 0, 0.9);
    b.prop('prop-pipes', 16 * s, -22.5 * s, 0, 1.3);
    b.prop('prop-pipes', -20 * s, -29 * s, 1, 1.3);
    // Mid lanes between the warehouses and the centre stack.
    b.container(-13 * s, 4 * s, 1, false, C[(4 + k) % 6]!);
    b.crates(-10 * s, -5 * s);
    b.prop('prop-sacktrench', -17 * s, -2 * s, 1, 0.9);
    b.prop('prop-explodingbarrel', -8 * s, 8 * s, 0, 1.2, { explosive: true, shrink: 0.8 });
    b.prop('prop-gastank', -14 * s, -8 * s, 0, 1);
    b.prop('prop-barrier-single', 7 * s, -21 * s, 1, 1.2);
    b.prop('prop-trashcontainer', -27 * s, 24 * s, 1, 1.15, { tint: '#3d6b35' });
    b.prop('prop-streetlight', -20.5 * s, -12 * s, s > 0 ? 1 : 3, 1.4, { collide: false });
  });
  // Container corners close the yard off.
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) b.prop('prop-container-small', x * (H + 1.3), z * (H + 1.3), 0, CONTAINER_S, { collide: false, tint: '#5c5f63' });
  return {
    id: 'freight',
    name: 'Freight',
    desc: 'A container yard between two warehouses. Fast, close and loud.',
    half: [H, H],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    spawns: [
      faceCentre([sp(-28, -6, FACE.px), sp(-28, -2, FACE.px), sp(-28, 2, FACE.px), sp(-28, 6, FACE.px), sp(-25.5, -7.5, FACE.px), sp(-25.5, 7.5, FACE.px)], H, H),
      faceCentre([sp(28, -6, FACE.nx), sp(28, -2, FACE.nx), sp(28, 2, FACE.nx), sp(28, 6, FACE.nx), sp(25.5, -7.5, FACE.nx), sp(25.5, 7.5, FACE.nx)], H, H),
    ],
    ffa: faceCentre([sp(-28, -5, FACE.px), sp(28, 5, FACE.nx), sp(-29, -29, 0.8), sp(29, 29, -2.4), sp(-29, 29, 2.4), sp(29, -29, -0.8), sp(0, -30, FACE.pz), sp(0, 30, FACE.nz), sp(-10, -30, FACE.pz), sp(10, 30, FACE.nz)], H, H),
    flags: [
      { x: -15.5, z: 0, y: 0 },
      { x: 0, z: 0, y: 0 },
      { x: 15.5, z: 0, y: 0 },
    ],
    theme: { sky: 'overcast', ground: 'concrete', patches: [[-32, -32, 32, 32, 'asphalt']], sun: [0.4, 0.8, 0.3], fog: ['#9aa3ad', 80, 420] },
    backdrop: 'industrial',
    size: 'small',
  };
}
