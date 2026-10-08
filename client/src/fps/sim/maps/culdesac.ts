import { Builder, D, FACE, W, garage, house, faceCentre, sp, type MapDef } from '../mapkit';

/** Suburban street: two family houses face off; a ranch house and a corner store close the ends. */
export function culdesac(): MapDef {
  const b = new Builder();
  const HX = 44;
  const HZ = 34;
  b.bounds(HX, HZ);
  house(b, -18, -1, 0, 'plaster', '#e0d2b4', '#6a4030');
  house(b, 18, 1, 0, 'brick', undefined, '#3a4048');
  garage(b, -19, -1, 8, 14.5, '#d8d0c0', '#5a6a8a');
  garage(b, 19, 1, 8, 14.5, '#c8b8a0', '#8a3a2a');

  for (const side of [-1, 1] as const) {
    // Backyard (spawn): privacy fences with gates, a shed, an above-ground pool.
    b.fence(side * 30, -34, side * 30, -20.5, 1.9, 'wood', '#a88a62');
    b.fence(side * 30, -18.5, side * 30, -8.2, 1.9, 'wood', '#a88a62');
    b.fence(side * 30, 14.8, side * 30, 23.5, 1.9, 'wood', '#a88a62');
    b.fence(side * 30, 25.5, side * 30, 34, 1.9, 'wood', '#a88a62');
    b.fence(Math.min(side * 26, side * 30), 14.6, Math.max(side * 26, side * 30), 14.6, 1.9, 'wood', '#a88a62');
    const s0 = Math.min(side * 38, side * 42);
    const s1 = Math.max(side * 38, side * 42);
    b.with({ tint: '#8a6a4a' }, () => b.room(s0, -15, s1, -10, 2.6, 'wood', 0.15, side > 0 ? { w: [D(-12.5)], s: [W(side * 40, 1, 1.1, 1.9)] } : { e: [D(-12.5)], s: [W(side * 40, 1, 1.1, 1.9)] }));
    b.with({ roof: true }, () => b.box(s0 - 0.3, 2.6, -15.3, s1 + 0.3, 2.8, -9.7, 'metal'));
    b.crates(side * 41, -14, 2, 1.2);
    b.with({ tint: '#4a90c0' }, () => b.box(Math.min(side * 33, side * 37), 0, 9, Math.max(side * 33, side * 37), 1.2, 13.5, 'paint'));
    b.deco(Math.min(side * 33.2, side * 36.8), 1.2, 9.2, Math.max(side * 33.2, side * 36.8), 1.22, 13.3, 'glass', '#3a7ab0');
    b.prop('prop-tree-1', side * 41, 26, 0, 2.2);
    b.prop('prop-tree-3', side * 35, -27, 1, 2.2);
    b.prop('prop-tree-2', side * 41, -30, 0, 2);
    b.table(side * 35, 22, 1.8, 0.9, 0.75, 'wood');
    b.prop('prop-gastank', side * 31.5, -10.5, 0, 1);
    // Front: garden walls, lawns, trees, sandbags.
    b.box(side * 16 - 0.25, 0, -22, side * 16 + 0.25, 1.1, -16, 'brick');
    b.box(side * 16 - 0.25, 0, 16, side * 16 + 0.25, 1.1, 22, 'brick');
    b.prop('prop-tree-2', side * 13, -20, 0, 2);
    b.prop('prop-tree-1', side * 13, 19.5, 1, 2);
    b.prop('prop-sacktrench-small', side * 22, -14, 0, 0.9);
    b.prop('prop-sacktrench-small', side * 22, 18.5, 0, 0.9);
    b.box(side * 8 - 1, 0, side * -5 - 1, side * 8 + 1, 0.85, side * -5 + 1, 'brick'); // planter
    b.prop('prop-streetlight', side * 12, side * -9, side > 0 ? 2 : 0, 1.4, { collide: false });
  }

  // North end: a ranch house.
  b.with({ tint: '#b8c8d8' }, () =>
    b.room(-10, -33, 10, -23, 3, 'paint', 0.25, {
      s: [D(0), W(-6, 2), W(6, 2)],
      n: [W(-5), W(5)],
      w: [D(-28, 1.2)],
      e: [D(-28, 1.2)],
    }),
  );
  b.with({ thin: true, tint: '#d8d0bc' }, () => b.wallZ(-33, -23, 0, 3, 0.2, 'wallpaper', [[-29, -27.4, 0, 2.2]]));
  b.with({ roof: true }, () => b.box(-10.4, 3, -33.4, 10.4, 3.2, -22.6, 'paint'));
  b.roofTop(-10.6, -33.6, 10.6, -22.4, 3.2, true, '#4a3a34', 4, 0.45);
  b.floor(-10, -33, 10, -23, 'darkwood', '#b89878');
  b.sofa(-6, -30.5, 3, 1, 'n', '#7a6a5a');
  b.table(-6, -28.5, 1.4, 0.8, 0.45);
  b.counter(3, -32.6, 9.6, -31.9);
  b.table(5.5, -27.5, 1.6, 1);
  b.prop('prop-cardboardboxes-1', -8.5, -24.2, 0, 1);

  // South end: a corner store.
  b.with({ tint: '#d0b890' }, () =>
    b.room(-10, 23, 10, 33, 3.4, 'brick', 0.3, {
      n: [D(0, 1.8), W(-6, 3.5, 0.9, 2.6), W(6, 3.5, 0.9, 2.6)],
      w: [D(28, 1.2)],
      e: [D(28, 1.2)],
    }),
  );
  b.with({ roof: true }, () => b.box(-10.4, 3.4, 22.6, 10.4, 3.6, 33.4, 'concrete'));
  b.deco(-10.4, 2.7, 22.3, 10.4, 3.3, 22.6, 'paint', '#b03030'); // awning sign
  b.floor(-10, 23, 10, 33, 'marble', '#c8c8c0');
  b.shelf(-7.5, 27.4, -2.5, 28.1, 1.6, 'metal', '#c84a3a');
  b.shelf(2.5, 27.4, 7.5, 28.1, 1.6, 'metal', '#3a6ac8');
  b.counter(-2.5, 30.8, 2.5, 31.6);
  b.shelf(-9.6, 30, -8.9, 32.6, 2, 'metal', '#5a5a5a');

  // The street.
  b.car(-5, -12, 0, '#7a8aa0');
  b.car(6, 12, 2, '#a05a3a');
  b.car(-12.5, 15, 1, '#4a6a4a');
  b.truck(3, -17, false, 1);
  b.prop('prop-barrier-single', -9, 3, 1, 1.2);
  b.prop('prop-barrier-single', 9, -3, 1, 1.2);
  b.prop('prop-explodingbarrel', -2, 0, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-trashcontainer', 10, -19, 0, 1.15, { tint: '#3d6b35' });
  b.prop('prop-trafficcone', -1, -12, 0, 1.2, { collide: false });
  b.prop('prop-trafficcone', 1.5, -12.5, 0, 1.2, { collide: false });
  return {
    id: 'culdesac',
    name: 'Cul-de-Sac',
    desc: 'Four buildings around a suburban street. Fight through the houses and backyards.',
    half: [HX, HZ],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    spawns: [
      faceCentre([sp(-41, -4, FACE.px), sp(-41, 2, FACE.px), sp(-35, -12, FACE.px), sp(-41, 8, FACE.px), sp(-34, 18, FACE.px), sp(-41, -21, FACE.px)], HX, HZ),
      faceCentre([sp(41, -4, FACE.nx), sp(41, 2, FACE.nx), sp(35, -12, FACE.nx), sp(41, 8, FACE.nx), sp(34, 18, FACE.nx), sp(41, -21, FACE.nx)], HX, HZ),
    ],
    ffa: faceCentre([sp(-40, -30, 0.8), sp(40, 30, -2.4), sp(-40, 30, 2.4), sp(40, -30, -0.8), sp(2, -26, FACE.pz), sp(0, 26, FACE.nz), sp(-21, -5, FACE.px), sp(21, 2, FACE.nx), sp(-23.5, 13.6, FACE.px), sp(23.5, 13.6, FACE.nx)], HX, HZ),
    flags: [
      { x: -12, z: 0, y: 0 },
      { x: 0, z: 3, y: 0 },
      { x: 12, z: 0, y: 0 },
    ],
    theme: {
      sky: 'day',
      ground: 'grass',
      patches: [
        [-16, -6, 16, 6, 'asphalt'],
        [-6, -22, 6, 22, 'asphalt'],
        [-18, -3.5, -16, 0.5, 'concrete'],
        [16, -0.5, 18, 3.5, 'concrete'],
        [-19, 8.6, -16, 13.9, 'concrete'],
        [16, 8.6, 19, 13.9, 'concrete'],
      ],
      sun: [-0.5, 0.75, 0.35],
      fog: ['#bcd3e6', 90, 450],
    },
    backdrop: 'suburb',
    size: 'medium',
  };
}
