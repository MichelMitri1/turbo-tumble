import { Builder, D, FACE, W, building, sp, type MapDef } from '../mapkit';

/**
 * Terminal: an airport. A big concourse (gates, shops, food court, an upper walkway),
 * a jet bridge out to a parked airliner you can board, and the tarmac beyond.
 * Coalition spawns in the car park (west), Militia by the cargo hangar (east).
 */
export function terminal(): MapDef {
  const b = new Builder();
  const HX = 56;
  const HZ = 38;
  b.bounds(HX, HZ);
  const glass = '#8fb4c8';

  // ---------------------------------------------------------------- the concourse: x −36…14, z −22…10
  const H = 7;
  b.with({ tint: glass, thin: true }, () => {
    // Glass curtain walls with doors (thin: bullets go through, slowed).
    b.wallX(-36, 14, -22, H, 0.25, 'glass', [D(-30, 2.4, 2.6), D(-12, 2.4, 2.6), D(4, 2.4, 2.6)]);
    b.wallX(-36, 14, 10, H, 0.25, 'glass', [D(-28, 2.4, 2.6), D(-14, 2.4, 2.6), D(0, 2.4, 2.6)]);
    b.wallZ(-22, 10, -36, H, 0.25, 'glass', [D(-14, 2.4, 2.6), D(-2, 2.4, 2.6), D(6, 2.4, 2.6)]);
    b.wallZ(-22, 10, 14, H, 0.25, 'glass', [D(-14, 2.4, 2.6), [-4.4, -2.8, 0, 2.6], D(5, 2.4, 2.6)]);
  });
  // Steel frame between the panes.
  for (let x = -36; x <= 14; x += 5) for (const z of [-22, 10]) b.pillar(x, z, 0.18, H, 'metal');
  b.with({ roof: true }, () => b.box(-36.4, H, -22.4, 14.4, H + 0.35, 10.4, 'metal'));
  b.floor(-36, -22, 14, 10, 'marble', '#d4d0c8');
  b.floor(-6, -22, 14, 10, 'carpet', '#3a4a6a', 0.01);
  for (let x = -26; x <= 6; x += 8) for (const z of [-12, 0]) b.pillar(x, z, 0.45, H, 'concrete');
  // Upper walkway along the south side with stairs at both ends.
  b.box(-34, 3.6, -21.8, 10, 3.9, -17.2, 'concrete');
  b.rail(-28, -17.3, 6, -17.15, 3.9, 1.05, 'metal');
  b.stairs(6.2, -17.1, 13.6, -15.4, 'x-', 3.9, 'concrete');
  b.stairs(-35.6, -17.1, -28.2, -15.4, 'x+', 3.9, 'concrete');
  b.deco(-28, 3.9, -21.6, -18, 6.2, -21.5, 'paint', '#203a5a');
  // Gates (east): seat rows and a gate desk; the jet bridge leaves the east wall.
  for (const z of [-13, -9, -5, 1, 5]) for (const x of [-3, 4]) b.with({ tint: '#2a3a5a' }, () => b.box(x, 0, z - 0.3, x + 5, 0.48, z + 0.3, 'fabric', true));
  b.counter(9.6, -9, 10.6, -5.5, 1.1);
  b.deco(9, 3.4, -9, 9.1, 4.4, -5.5, 'paint', '#1a2a3a');
  // Shops along the north wall (west part).
  for (const [x0, tint] of [[-35.6, '#c84a3a'], [-27.6, '#3a6ab8'], [-19.6, '#d8b048']] as Array<[number, string]>) {
    b.with({ tint: '#d8d4cc' }, () => {
      b.wallX(x0, x0 + 7.4, 3.5, 3.4, 0.2, 'paint', [D(x0 + 3.7, 2.2, 2.4)]);
      b.wallZ(3.5, 9.8, x0 + 7.4, 3.4, 0.2, 'paint');
    });
    b.with({ roof: true }, () => b.box(x0, 3.4, 3.4, x0 + 7.5, 3.55, 9.8, 'paint'));
    b.deco(x0 + 0.5, 2.6, 3.3, x0 + 6.9, 3.3, 3.4, 'paint', tint);
    b.shelf(x0 + 0.3, 9.1, x0 + 6.8, 9.7, 1.8, 'metal', tint);
    b.counter(x0 + 1, 5.6, x0 + 3.2, 6.4);
  }
  // Food court tables and a baggage carousel (west / middle).
  for (const [x, z] of [[-30, -10], [-26, -6], [-30, -4], [-22, -10], [-18, -6]] as Array<[number, number]>) b.table(x, z, 1.2, 1.2, 0.76, 'metal', '#c8c8c8');
  b.box(-16, 0, 1, -8, 0.6, 2.4, 'metal');
  b.box(-16, 0, -2.4, -8, 0.6, -1, 'metal');
  b.box(-17.4, 0, -2.4, -16, 0.6, 2.4, 'metal');
  b.box(-8, 0, -2.4, -6.6, 0.6, 2.4, 'metal');
  b.crates(-12, 0, 2, 1.1);

  // ---------------------------------------------------------------- jet bridge + airliner (fuselage along z at x 30)
  b.with({ tint: '#c8ccd0' }, () => {
    b.wallX(14, 27.6, -4.6, 3.6, 0.2, 'metal', [W(18, 1.2, 1, 2.2), W(23, 1.2, 1.4, 2.6)]);
    b.wallX(14, 27.6, -2.6, 3.6, 0.2, 'metal', [W(18, 1.2, 1, 2.2), W(23, 1.2, 1.4, 2.6)]);
  });
  b.with({ roof: true }, () => b.box(14, 3.6, -4.7, 27.6, 3.8, -2.5, 'metal'));
  b.stairs(25.2, -4.5, 27.6, -2.7, 'x+', 1, 'metal');
  const fx0 = 27.6;
  const fx1 = 32.4;
  const fy = 1;
  const fz0 = -24;
  const fz1 = 14;
  b.box(fx0, 0, fz0, fx1, fy, fz1, 'metal');
  b.with({ tint: '#eef0f2' }, () => {
    // Cabin windows, skipping the doors.
    const wins = (doors: Array<[number, number]>) => Array.from({ length: 12 }, (_, i) => -21 + i * 3).filter((c) => doors.every(([a, z]) => c + 0.6 < a || c - 0.6 > z)).map((c) => W(c, 0.5, 1.1, 1.7));
    b.wallZ(fz0, fz1, fx0, 2.8, 0.15, 'paint', [[-4.4, -2.8, 0, 2.2], ...wins([[-4.4, -2.8]])], fy);
    b.wallZ(fz0, fz1, fx1, 2.8, 0.15, 'paint', [[11.3, 12.7, 0, 2.2], [-17, -15.6, 0, 2.2], ...wins([[11.3, 12.7], [-17, -15.6]])], fy);
    b.wallX(fx0, fx1, fz0, 2.8, 0.15, 'paint', [], fy);
    b.wallX(fx0, fx1, fz1, 2.8, 0.15, 'paint', [], fy);
  });
  b.with({ roof: true, tint: '#eef0f2' }, () => b.box(fx0 - 0.1, fy + 2.8, fz0, fx1 + 0.1, fy + 3.2, fz1, 'paint'));
  b.deco(fx0 + 0.6, fy + 3.2, fz0 + 2, fx1 - 0.6, fy + 3.5, fz1 - 2, 'paint', '#eef0f2');
  // Nose, tail and the blue cheat line.
  b.deco(fx0 + 0.3, 0.3, fz0 - 4, fx1 - 0.3, fy + 2.6, fz0, 'paint', '#eef0f2');
  b.deco(fx0 + 0.8, 1.6, fz0 - 4.05, fx1 - 0.8, 2.6, fz0 - 3.9, 'glass', '#203040');
  b.deco(fx0 + 0.6, 0.6, fz1, fx1 - 0.6, fy + 2.4, fz1 + 6, 'paint', '#eef0f2');
  b.deco(29.8, fy + 2.4, fz1 + 1, 30.2, fy + 8, fz1 + 6, 'paint', '#2a4a8a');
  b.deco(fx0 - 0.02, fy + 0.2, fz0, fx0, fy + 0.5, fz1, 'paint', '#2a4a8a');
  b.deco(fx1, fy + 0.2, fz0, fx1 + 0.02, fy + 0.5, fz1, 'paint', '#2a4a8a');
  // Cabin: seat rows either side of the aisle.
  for (let z = fz0 + 3; z < fz1 - 2; z += 1.6) {
    if (z > -5.6 && z < -1.6) continue;
    if (z > 10.4 && z < 13.6) continue;
    if (z > -18 && z < -14.6) continue;
    b.with({ tint: '#3a4a7a', thin: true }, () => {
      // Wide aisle down the middle (x 29.1…30.9).
      b.box(fx0 + 0.2, fy, z, fx0 + 1.5, fy + 0.95, z + 0.6, 'fabric');
      b.box(fx1 - 1.5, fy, z, fx1 - 0.2, fy + 0.95, z + 0.6, 'fabric');
    });
  }
  b.floor(fx0, fz0, fx1, fz1, 'carpet', '#4a5a7a', fy);
  // Wings (crouch under them) and engines.
  b.box(fx0 - 16, 1.2, 0, fx0, 1.6, 8, 'paint');
  b.box(fx1, 1.2, 0, fx1 + 16, 1.6, 8, 'paint');
  b.cyl(fx0 - 7.5, 0.7, 4, 0.75, 4.5, 'z', 'metal', '#9aa0a8');
  b.cyl(fx1 + 7.5, 0.7, 4, 0.75, 4.5, 'z', 'metal', '#9aa0a8');
  // Air stairs at the back door and a service door.
  b.stairs(fx1 + 0.2, 11.3, fx1 + 2.6, 12.7, 'x-', fy, 'metal');
  b.stairs(fx1 + 0.2, -17, fx1 + 2.6, -15.6, 'x-', fy, 'metal');

  // ---------------------------------------------------------------- tarmac (east) and car park (west)
  for (const [x, z] of [[20, 14], [20, 18], [24, 22], [40, -20], [44, -16], [40, 24]] as Array<[number, number]>) b.container(x, z, 0, false, '#9aa0a8');
  b.truck(40, -8, true, 1, '#e8e4dc', '#d8a830');
  b.truck(20, -26, false, 1, '#d8d4cc', '#c83a2a');
  for (const [x, z] of [[18, 6], [22, -8], [36, -14]] as Array<[number, number]>) b.crates(x, z, 2, 1.1);
  for (const [x, z] of [[17, -14], [23, -12], [37, 12], [16, 28]] as Array<[number, number]>) b.prop('prop-trafficcone', x, z, 0, 1.2, { collide: false });
  // Cargo hangar (Militia spawn side).
  building(b, 44, 14, 55, 34, { mat: 'metal', tint: '#b8c0c8', doors: [['w', 18], ['w', 26], ['n', 49], ['s', 49]], h: 6, win: 6 });
  b.crates(50, 20, 3, 1.3);
  b.crates(50, 28, 3, 1.3);
  b.container(52, -30, 1, false, '#5a7a9a');
  b.container(52, -18, 1, false, '#9a5a3a');
  b.prop('prop-barrier-large', 47, -24, 1, 1, { tint: '#c8c0b0' });
  // Car park (Coalition spawn side) and a drop-off kerb.
  for (const [x, z, t] of [[-48, -20, '#2a2a30'], [-48, -8, '#c8c0b0'], [-48, 8, '#6a1a1a'], [-42, 22, '#3a5a8a'], [-44, -30, '#5a6a4a']] as Array<[number, number, string]>) b.car(x, z, 1, t);
  // Kerbs with gaps at the doors.
  for (const [z0, z1] of [[-36, -16], [-12, -4], [0, 4], [8, 30]] as Array<[number, number]>) b.box(-38, 0, z0, -37.4, 0.9, z1, 'concrete');
  b.box(-56, 0, 26, -51, 0.9, 26.6, 'concrete');
  b.box(-46, 0, 26, -40, 0.9, 26.6, 'concrete');
  b.with({ tint: '#2a5a8a' }, () => b.room(-54, -36, -46, -32, 2.6, 'paint', 0.15, { s: [D(-50, 1.6)], e: [W(-34, 1.4, 1, 2)] }));
  b.with({ roof: true }, () => b.box(-54.2, 2.6, -36.2, -45.8, 2.8, -31.8, 'metal'));
  b.prop('prop-streetlight', -40, -14, 1, 1.4, { collide: false });
  b.prop('prop-streetlight', -40, 14, 1, 1.4, { collide: false });
  b.car(-22, 18, 1, '#d8c040');
  b.car(-6, 20, 1, '#d8c040');
  b.prop('prop-barrier-single', -14, 14, 0, 1.2);
  return {
    id: 'terminal',
    name: 'Terminal',
    desc: 'An airport: gates, shops, a walkway upstairs and an airliner you can board. Big and varied.',
    half: [HX, HZ],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    cyls: b.cyls,
    spawns: [
      [sp(-51, -14, FACE.px), sp(-51, -2, FACE.px), sp(-51, 4, FACE.px), sp(-51, 14, FACE.px), sp(-44, 30, FACE.px), sp(-51, -26, FACE.px)],
      [sp(50, 24, FACE.nx), sp(52, 18, FACE.nx), sp(52, 30, FACE.nx), sp(52, -6, FACE.nx), sp(52, 6, FACE.nx), sp(54, -24, FACE.nx)],
    ],
    ffa: [sp(-51, -34, 0.8), sp(48, 36.5, -2.4), sp(-51, 34, 2.4), sp(52, -34, -0.8), sp(-30, -14, FACE.px), sp(8, 0, FACE.nx), sp(30, -10, FACE.pz, 1), sp(30, 0, FACE.nz, 1), sp(-20, -19.6, FACE.px, 3.9), sp(0, -19.6, FACE.nx, 3.9), sp(20, 28, FACE.nz), sp(40, 10, FACE.nx)],
    flags: [
      { x: -24, z: -2, y: 0 },
      { x: 30, z: -11, y: 1 },
      { x: 38, z: 14, y: 0 },
    ],
    theme: {
      sky: 'day',
      ground: 'asphalt',
      patches: [
        [-56, -38, -38, 38, 'asphalt'],
        [-38, 10, 14, 38, 'concrete'],
        [14, -38, 56, 38, 'concrete'],
      ],
      sun: [0.4, 0.8, 0.4],
      fog: ['#c4d0dc', 90, 470],
    },
    backdrop: 'city',
    size: 'large',
  };
}
