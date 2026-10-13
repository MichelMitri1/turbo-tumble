import { Builder, CONTAINER_COLORS as C, FACE, building, pointMirror, sp, type MapDef } from '../mapkit';

/**
 * An arctic research station in a snowstorm: a two-storey lab in the middle, corrugated huts,
 * fuel tanks and a radar mast, trenches and containers in the drifts, pine forest all round.
 */
export function frostbite(): MapDef {
  const b = new Builder();
  const HX = 46;
  const HZ = 40;
  b.bounds(HX, HZ, 14, 'concrete');

  // ---------------------------------------------------------------- the lab (x −9…9, z −7…7, two floors)
  building(b, -9, -7, 9, 7, { mat: 'corrugated', tint: '#c8ccd0', doors: [['n', -4], ['n', 4], ['s', -4], ['s', 4], ['w', 0], ['e', 0]], floors: 2, inner: true, floor: ['tile', '#c8ccd0'] });
  // Lab benches and server racks downstairs.
  b.counter(-6.5, -2.2, -2.5, -1.3, 0.92, 'metal', 'metal');
  b.counter(2.5, 1.3, 6.5, 2.2, 0.92, 'metal', 'metal');
  b.shelf(-8.4, 3, -7.8, 6.2, 2, 'metal', '#2a2e34');
  b.shelf(7.8, -6.2, 8.4, -3, 2, 'metal', '#2a2e34');
  // Radar mast on the roof (decor) and a dish.
  b.deco(-0.15, 6.6, -0.15, 0.15, 13, 0.15, 'metal', '#d8dce0');
  b.cyl(0, 13, 0, 1.4, 0.2, 'x', 'metal', '#e8ecef', false);

  // ---------------------------------------------------------------- the base (south half, mirrored north)
  pointMirror(b, (w) => {
    // Huts.
    building(w, -38, -31, -28, -22, { mat: 'corrugated', tint: '#7a8a6a', doors: [['s', -33], ['e', -26.5]], roof: 'pitched', roofTint: '#e8ecef' });
    building(w, -20, -35, -10, -27, { mat: 'corrugated', tint: '#a84a3a', doors: [['s', -15], ['w', -31]], roof: 'pitched', roofTint: '#e8ecef', floors: 2 });
    building(w, 14, -31, 26, -22, { mat: 'corrugated', tint: '#8a9098', doors: [['s', 20], ['w', -26.5], ['e', -26.5]], roof: 'pitched', roofTint: '#e8ecef' });
    building(w, 31, -38, 41, -30, { mat: 'corrugated', tint: '#d8a830', doors: [['w', -34], ['s', 36]], roof: 'pitched', roofTint: '#e8ecef' });
    // Fuel tanks behind a sandbag wall.
    w.cyl(28, 0, -14, 2.1, 4.2, 'y', 'metal', '#d8d8d0');
    w.cyl(33.5, 0, -14, 2.1, 4.2, 'y', 'metal', '#d8d8d0');
    w.prop('prop-sacktrench', 30.5, -10.4, 0, 0.9);
    w.prop('prop-lpg', 36.5, -11.5, 0, 1.2);
    // Containers, trenches, crates in the yard.
    w.container(-24, -12, 0, true, C[0]!);
    w.container(-6, -20, 1, false, C[3]!);
    w.prop('prop-sacktrench', -14, -12.5, 0, 0.9);
    w.prop('prop-sacktrench-small', 9, -14, 0, 0.9);
    w.prop('prop-barrier-large', -36, -14, 1, 1);
    w.crates(4, -24, 3, 1.3);
    w.prop('prop-generator', 12, -19.5, 1, 1.2);
    w.prop('prop-explodingbarrel', 19, -17, 0, 1, { explosive: true, shrink: 0.8 });
    w.prop('prop-barrel', 19.8, -17.6, 0, 1);
    w.prop('prop-barrel', 20.2, -16.8, 0, 1);
    // A snowcat stuck at the gate.
    w.truck(-31, -5, false, 1, '#d8dce0', '#c84a2a');
    w.prop('prop-pallet', -40, -20, 1, 1.1);
    // Pines along the fence.
    for (const [x, z] of [
      [-43, -36],
      [-25, -38],
      [-2, -37],
      [10, -36.5],
      [27, -36],
      [44, -24],
      [-44, -6],
    ] as Array<[number, number]>)
      w.prop('prop-tree-2', x, z, 0, 1.6);
  });
  return {
    id: 'frostbite',
    name: 'Frostbite',
    desc: 'An arctic research station: a two-storey lab, huts and fuel tanks in the snow, pine forest all round.',
    half: [HX, HZ],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    cyls: b.cyls,
    spawns: [
      [sp(-42, -2, FACE.px), sp(-42, 2, FACE.px), sp(-42, 6, FACE.px), sp(-39, 10, FACE.px), sp(-39, -9, FACE.px), sp(-42, 14, FACE.px)],
      [sp(42, 2, FACE.nx), sp(42, -2, FACE.nx), sp(42, -6, FACE.nx), sp(39, -10, FACE.nx), sp(39, 9, FACE.nx), sp(42, -14, FACE.nx)],
    ],
    ffa: [sp(-40, -35, 0.8), sp(40, 35, -2.4), sp(-6, -4.5, FACE.px), sp(6, 4.5, FACE.nx), sp(-15, -31, FACE.pz), sp(15, 31, FACE.nz), sp(0, -30, FACE.nz), sp(0, 30, FACE.pz), sp(-20, -18, FACE.px), sp(20, 18, FACE.nx), sp(-5, 4.5, FACE.px, 3.45), sp(5, -4.5, FACE.nx, 3.45)],
    flags: [
      { x: -28, z: 3, y: 0 },
      { x: 0, z: 0, y: 0 },
      { x: 28, z: -3, y: 0 },
    ],
    theme: {
      sky: 'snow',
      ground: 'snow',
      patches: [
        [-46, -3, 46, 3, 'gravel'],
        [-3, -40, 3, 40, 'gravel'],
        [-11, -9, 11, 9, 'concrete'],
      ],
      sun: [0.35, 0.55, -0.6],
      fog: ['#d4dae0', 50, 300],
    },
    backdrop: 'snow',
    size: 'medium',
  };
}
