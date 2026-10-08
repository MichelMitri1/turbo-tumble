import { Builder, FACE, garage, house, sp, type MapDef } from '../mapkit';

/**
 * A 1950s nuclear test-site street (Nuketown-style, original layout): two pastel houses
 * face each other across a cul-de-sac with a bus and a truck in the middle; backyards
 * with garages are the spawns.
 */
export function atomic(): MapDef {
  const b = new Builder();
  const HX = 34;
  const HZ = 26;
  b.bounds(HX, HZ);
  house(b, -12, -1, -1, 'paint', '#e8c860', '#4a6a8a'); // yellow, x −24…−12, z −9…5
  house(b, 12, 1, 1, 'paint', '#86c8a8', '#8a3a3a'); // mint, x 12…24, z −7…7
  garage(b, -15, -1, 8, 14.5, '#e8e0d0', '#c84a3a');
  garage(b, 15, 1, -14.5, -8, '#e8e0d0', '#3a6aa8');

  for (const side of [-1, 1] as const) {
    const s = side;
    // Backyard fences with gates between the yards and the street.
    b.fence(s * 24, -26, s * 24, s < 0 ? -17 : -16, 1.9, 'wood', '#f0ece4');
    b.fence(s * 24, s < 0 ? -15 : -14, s * 24, s < 0 ? -9.2 : -7.2, 1.9, 'wood', '#f0ece4');
    b.fence(s * 24, s < 0 ? 5.2 : 7.2, s * 24, s < 0 ? 15 : 16, 1.9, 'wood', '#f0ece4');
    b.fence(s * 24, s < 0 ? 17 : 18, s * 24, 26, 1.9, 'wood', '#f0ece4');
    // White picket fences along the front lawns (low cover).
    b.fence(s * 11, -22, s * 11, -14, 0.9, 'paint', '#f4f2ec', 0.1);
    b.fence(s * 11, 14, s * 11, 22, 0.9, 'paint', '#f4f2ec', 0.1);
    // Backyard: a playhouse, a picnic table, a doghouse, trees.
    const p0 = Math.min(s * 28, s * 31);
    const p1 = Math.max(s * 28, s * 31);
    const pz = s < 0 ? 18 : -21;
    b.with({ tint: s < 0 ? '#d86a8a' : '#6a8ad8' }, () => b.room(p0, pz, p1, pz + 3, 2.2, 'paint', 0.12, s < 0 ? { e: [[pz + 1, pz + 2.2, 0, 1.6]] } : { w: [[pz + 1, pz + 2.2, 0, 1.6]] }));
    b.with({ roof: true }, () => b.box(p0 - 0.2, 2.2, pz - 0.2, p1 + 0.2, 2.35, pz + 3.2, 'paint'));
    b.roofTop(p0 - 0.2, pz - 0.2, p1 + 0.2, pz + 3.2, 2.35, true, '#f4f4f0', 3, 0.3);
    b.table(s * 29.5, s < 0 ? -18 : 18, 2, 1, 0.75, 'wood');
    b.prop('prop-tree-1', s * 31, s < 0 ? -9 : 9, 0, 2.1);
    b.prop('prop-tree-3', s * 29, s < 0 ? 9 : -9, 1, 2);
    b.prop('prop-crate', s * 32.5, s < 0 ? 2 : -2, 0, 1.3);
    b.prop('prop-cardboardboxes-1', s * 26, s < 0 ? -24 : 24, 0, 1.2);
    // Mailbox + lamp at the kerb.
    b.box(s * 10.2 - 0.12, 0, (s < 0 ? -12 : 12) - 0.12, s * 10.2 + 0.12, 1.1, (s < 0 ? -12 : 12) + 0.12, 'metal');
    b.prop('prop-streetlight', s * 10.5, s < 0 ? 12 : -12, s < 0 ? 0 : 2, 1.4, { collide: false });
  }

  // The cul-de-sac: bus, truck, cars, planters.
  b.bus(-3, 0, true, 1, '#e8b020');
  b.truck(4, 9, true, -1, '#f0ece0', '#c83a2a');
  b.car(6.5, -13, 1, '#5a9ac8');
  b.car(-6.5, 14, 1, '#d87a4a');
  b.box(7, 0, -2, 9, 0.8, 0, 'brick');
  b.box(-9, 0, 10, -7, 0.8, 12, 'brick');
  b.prop('prop-barrier-single', 0, -17, 0, 1.2);
  b.prop('prop-barrier-single', 0, 17, 0, 1.2);
  b.prop('prop-explodingbarrel', 1, -9, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-trafficcone', 3, 3, 0, 1.2, { collide: false });
  b.prop('prop-sign', 0, -23, 0, 2, { collide: false });
  // Tyres and crates by the road ends.
  b.prop('prop-debris-tires', -4, -22, 0, 1.2);
  b.prop('prop-debris-tires', 4, 22, 0, 1.2);
  b.crates(-19, 23, 3, 1.3);
  b.crates(19, -23, 3, 1.3);
  return {
    id: 'atomic',
    name: 'Atomic Row',
    desc: 'A 1950s test-site street: two houses, a bus in the middle, no time to breathe.',
    half: [HX, HZ],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    spawns: [
      [sp(-31, -15, FACE.px), sp(-31, -4, FACE.px), sp(-31, 4, FACE.px), sp(-27, 14, FACE.px), sp(-27, -22, FACE.px), sp(-32, 23, FACE.px)],
      [sp(31, 15, FACE.nx), sp(31, 4, FACE.nx), sp(31, -4, FACE.nx), sp(27, -14, FACE.nx), sp(27, 22, FACE.nx), sp(32, -23, FACE.nx)],
    ],
    ffa: [sp(-31, -22, 0.8), sp(31, 22, -2.4), sp(-31, 22, 2.4), sp(31, -22, -0.8), sp(-16.5, 0, FACE.px), sp(16.5, 2, FACE.nx), sp(-19, 13.6, FACE.px), sp(19, -13.6, FACE.nx), sp(0, -24, FACE.pz), sp(0, 24, FACE.nz)],
    flags: [
      { x: -17, z: 19, y: 0 },
      { x: 1.5, z: 0, y: 0 },
      { x: 17, z: -19, y: 0 },
    ],
    theme: {
      sky: 'day',
      ground: 'sand',
      patches: [
        [-11, -16, 11, 16, 'asphalt'],
        [-24, -26, -11, 26, 'grass'],
        [11, -26, 24, 26, 'grass'],
        [-34, -26, -24, 26, 'grass'],
        [24, -26, 34, 26, 'grass'],
        [-15, 8.6, -11, 13.9, 'concrete'],
        [11, -13.9, 15, -8.6, 'concrete'],
      ],
      sun: [0.5, 0.8, -0.3],
      fog: ['#e8d8b8', 90, 480],
    },
    backdrop: 'desert',
    size: 'small',
  };
}
