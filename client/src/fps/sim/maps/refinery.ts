import { Builder, FACE, building, pointMirror, sp, type MapDef } from '../mapkit';

/**
 * Refinery: an oil yard in the desert (Rust, grown up). A two-level drilling rig in the
 * middle you can climb, storage tanks, overhead pipe racks to duck under, sheds and
 * containers. Point-symmetric.
 */
function half(b: Builder): void {
  const rust = '#9a6a4a';
  // Storage tanks.
  b.cyl(-26, 0, -22, 5.5, 9, 'y', 'metal', '#c8c4b8');
  b.cyl(-26, 9, -22, 5.6, 0.4, 'y', 'metal', '#8a8a84', false);
  b.cyl(-12, 0, 20, 3, 6, 'y', 'metal', '#b8a890');
  b.cyl(-34, 0, 10, 3.2, 6.5, 'y', 'metal', '#c8c4b8');
  // A stair around the big tank? Just a ladder-like catwalk on its side (decor).
  b.deco(-20.6, 0, -22.4, -20.4, 9, -21.6, 'metal', '#5a5a5a');
  // Pipe rack: posts and a bundle of pipes overhead (duck / walk under at 2.6 m).
  for (let x = -38; x <= -10; x += 7) {
    b.box(x - 0.2, 0, -8.6, x + 0.2, 2.6, -8.2, 'metal');
    b.box(x - 0.2, 0, -5.8, x + 0.2, 2.6, -5.4, 'metal');
  }
  b.box(-38.2, 2.6, -8.6, -9.8, 2.8, -5.4, 'metal');
  for (const [z, r, t] of [[-7.9, 0.32, '#5a6a7a'], [-7.1, 0.28, rust], [-6.2, 0.36, '#8a8a84']] as Array<[number, number, string]>) b.cyl(-24, 2.8 + r, z, r, 28.4, 'x', 'metal', t, false);
  // Ground pipes to hop over / crouch behind.
  b.cyl(-6, 0.45, -22, 0.45, 14, 'x', 'metal', rust);
  b.cyl(-40, 0.4, -4, 0.4, 10, 'z', 'metal', '#5a6a7a');
  // Sheds (one is the spawn's cover).
  building(b, -46, -32, -36, -22, { mat: 'metal', tint: '#a8b0b8', doors: [['e', -27], ['n', -41]], h: 3.6, win: 4 });
  building(b, -20, -38, -10, -30, { mat: 'metal', tint: '#b8a898', doors: [['e', -34], ['s', -15]], h: 3.4, win: 4 });
  building(b, -24, 4, -17, 12, { mat: 'brick', tint: '#b89878', doors: [['e', 8], ['n', -20.5]], h: 3, win: 3.5 });
  // Containers and clutter.
  b.container(-44, 4, 1, false, '#2a4f7a');
  b.container(-44, 16, 1, false, '#8a2a22');
  b.container(-44, 16, 1, false, '#3d6b35', 2.64);
  b.container(-30, 28, 0, true, '#a8742a');
  b.container(-4, 30, 1, false, '#5c5f63');
  b.crates(-14, -2, 3, 1.3);
  b.crates(-32, -14, 2, 1.3);
  b.crates(-6, 14, 2, 1.3);
  b.prop('prop-gastank', -10, -14, 0, 1.2);
  b.prop('prop-gastank', -8.5, -14, 0, 1.2);
  b.prop('prop-explodingbarrel', -16, -16, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-explodingbarrel', -36, 22, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-sacktrench', -40, -12, 1, 0.9);
  b.prop('prop-barrier-large', -30, 36, 0, 1, { tint: '#c8c0b0' });
  b.prop('prop-watertank-platform', -46, 30, 0, 1.6);
  b.prop('prop-streetlight', -20, -10, 1, 1.4, { collide: false });
}

export function refinery(): MapDef {
  const b = new Builder();
  const H = 48;
  b.bounds(H, H);
  pointMirror(b, half, { '#a8b0b8': '#b8b0a0' });
  // The rig: four legs, two decks, stairs up from both sides (fair), rails.
  for (const [x, z] of [[-5.3, -5.3], [5.3, -5.3], [-5.3, 5.3], [5.3, 5.3]] as Array<[number, number]>) b.pillar(x, z, 0.3, 11, 'metal');
  const L1 = 3.5;
  const L2 = 7.25;
  b.slab(-5, -5, 5, 5, L1, 0.25, 'metal');
  b.stairs(5, -0.8, 11.5, 0.8, 'x-', L1 + 0.25, 'metal');
  b.stairs(-11.5, -0.8, -5, 0.8, 'x+', L1 + 0.25, 'metal');
  b.stairs(-4.7, -4.7, 1.5, -3.3, 'x+', L2 - L1, 'metal', L1 + 0.25);
  b.slab(-2.6, -4.8, 2.6, 2.6, L2, 0.25, 'metal', [[-4.7, -4.8, 1.5, -3.25]]);
  // Rails (gaps where the stairs arrive).
  const r1 = L1 + 0.25;
  b.rail(-5, 4.85, 5, 5, r1, 1, 'metal');
  b.rail(-5, -5, 5, -4.85, r1, 1, 'metal');
  b.rail(4.85, -5, 5, -1, r1, 1, 'metal');
  b.rail(4.85, 1, 5, 5, r1, 1, 'metal');
  b.rail(-5, -3.2, -4.85, -1, r1, 1, 'metal');
  b.rail(-5, 1, -4.85, 5, r1, 1, 'metal');
  const r2 = L2 + 0.25;
  b.rail(-2.6, 2.45, 2.6, 2.6, r2, 1, 'metal');
  b.rail(-2.6, -3.2, -2.45, 2.6, r2, 1, 'metal');
  b.rail(2.45, -4.8, 2.6, 2.6, r2, 1, 'metal');
  // Derrick mast and the drill pipe.
  b.deco(-0.3, L2, -0.3, 0.3, 22, 0.3, 'metal', '#c84a2a');
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as Array<[number, number]>) b.deco(x - 0.1, L2, z - 0.1, x + 0.1, 20, z + 0.1, 'metal', '#c84a2a');
  b.cyl(0, 0, 0, 0.35, L1, 'y', 'metal', '#3a3a3a');
  b.crates(2.8, 2.8, 2, 1.1);
  b.crates(-3, 3.2, 1, 1.1);
  return {
    id: 'refinery',
    name: 'Refinery',
    desc: 'An oil yard: a climbable rig in the middle, tanks, pipe racks and sheds. Fight up and down.',
    half: [H, H],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    cyls: b.cyls,
    spawns: [
      [sp(-44, -16, FACE.px), sp(-44, -8, FACE.px), sp(-44, 0, FACE.px), sp(-40, 26, FACE.px), sp(-44, -38, FACE.px), sp(-38, -42, FACE.px)],
      [sp(44, 16, FACE.nx), sp(44, 8, FACE.nx), sp(44, 0, FACE.nx), sp(40, -26, FACE.nx), sp(44, 38, FACE.nx), sp(38, 42, FACE.nx)],
    ],
    ffa: [sp(-44, -44, 0.8), sp(44, 44, -2.4), sp(-44, 44, 2.4), sp(44, -44, -0.8), sp(0, -44, FACE.pz), sp(0, 44, FACE.nz), sp(-15, -34, FACE.px), sp(15, 34, FACE.nx), sp(-20, 8, FACE.px), sp(20, -8, FACE.nx), sp(-41, -27, FACE.px), sp(41, 27, FACE.nx)],
    flags: [
      { x: -24, z: -1, y: 0 },
      { x: 1.8, z: -2, y: 0 },
      { x: 24, z: 1, y: 0 },
    ],
    theme: { sky: 'dusk', ground: 'sand', patches: [[-48, -12, 48, 12, 'dirt'], [-10, -48, 10, 48, 'dirt'], [-8, -8, 8, 8, 'concrete']], sun: [0.6, 0.45, -0.4], fog: ['#d6b48a', 90, 480] },
    backdrop: 'industrial',
    size: 'large',
  };
}
