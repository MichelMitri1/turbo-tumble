import type { Box } from '../level';
import { Builder, D, FACE, W, sp, type MapDef } from '../mapkit';

/**
 * City block: a main street with a plaza runs north–south; each side has an apartment
 * building, a row of three shops you can run through, alleys and a parking lot. Teams
 * spawn on the back streets behind their buildings. The west half is built once and
 * copied rotated 180° for the east, so both sides play the same.
 */
function westSide(b: Builder): void {
  // ---- Apartment building (two storeys, stairs inside): x −36…−14, z −36…−21.
  const FH = 3.4;
  const UY = 3.7;
  b.with({ tint: '#b07050' }, () => {
    b.wallX(-36, -14, -36, FH, 0.35, 'brick', [W(-30), W(-20)]);
    b.wallX(-36, -14, -21, FH, 0.35, 'brick', [D(-17), W(-25), W(-31)]);
    b.wallZ(-36, -21, -36, FH, 0.35, 'brick', [D(-28.5)]);
    b.wallZ(-36, -21, -14, FH, 0.35, 'brick', [D(-28.5, 1.8), W(-33), W(-24)]);
    b.wallX(-36, -14, -36, 3.2, 0.35, 'brick', [W(-30), W(-20)], UY);
    b.wallX(-36, -14, -21, 3.2, 0.35, 'brick', [W(-17), W(-25), W(-31)], UY);
    b.wallZ(-36, -21, -36, 3.2, 0.35, 'brick', [W(-28.5)], UY);
    b.wallZ(-36, -21, -14, 3.2, 0.35, 'brick', [W(-33, 2), W(-28.5, 2), W(-24, 2), W(-18, 2)], UY);
  });
  b.with({ thin: true, tint: '#d8d0c0' }, () => {
    b.wallZ(-36, -21, -25, FH, 0.2, 'wallpaper', [D(-24)]);
    b.wallZ(-36, -21, -25, 3.2, 0.2, 'wallpaper', [D(-27)], UY);
  });
  b.slab(-36, -36, -14, -21, FH, UY - FH, 'wood', [[-35.6, -35.8, -27, -33.4]]);
  b.stairs(-35.5, -35.6, -27, -33.6, 'x+', UY, 'wood');
  b.rail(-35.6, -33.45, -27.6, -33.3, UY);
  b.with({ roof: true }, () => b.box(-36.3, UY + 3.2, -36.3, -13.7, UY + 3.4, -20.7, 'concrete'));
  b.deco(-36.3, UY + 3.4, -36.3, -13.7, UY + 4, -35.9, 'brick', '#8a5a40');
  b.deco(-14.1, UY + 3.4, -36.3, -13.7, UY + 4, -20.7, 'brick', '#8a5a40');
  b.floor(-36, -36, -14, -21, 'darkwood', '#b89878');
  b.floor(-36, -36, -14, -21, 'carpet', '#6a7a8a', UY);
  b.sofa(-19, -32, 3, 1, 'n', '#5a6a4a');
  b.table(-19, -29.5, 1.4, 0.8, 0.45);
  b.counter(-24.4, -35.6, -22, -34.9);
  b.bed(-17, -33, 1.6, 2.1, 'n', '#a8889a', UY);
  b.bed(-31, -24, 1.6, 2.1, 'w', '#8898a8', UY);
  b.table(-20, -24, 1.4, 0.9, 0.76, 'darkwood');

  // Alley north of the shops.
  b.prop('prop-trashcontainer', -31, -18, 0, 1.15, { tint: '#2a5a3a' });
  b.crates(-24, -19.5, 2, 1.2);
  b.prop('prop-cardboardboxes-3', -17, -17, 0, 1);

  // ---- Row of three shops: x −36…−14, z −15…15.
  const shopTint = ['#c84a3a', '#3a6ab8', '#d8b048'];
  b.with({ tint: '#d8cbb4' }, () => {
    b.wallX(-36, -14, -15, 3.6, 0.3, 'plaster', [W(-25, 2, 1, 2.2)]);
    b.wallX(-36, -14, 15, 3.6, 0.3, 'plaster', [W(-25, 2, 1, 2.2)]);
    b.wallZ(-15, 15, -14, 3.6, 0.3, 'plaster', [D(-7.5, 1.6), W(-11.5, 3.6, 0.9, 2.6), D(2.5, 1.6), W(-1.5, 3.6, 0.9, 2.6), D(12.5, 1.6), W(8.5, 3.6, 0.9, 2.6)]);
    b.wallZ(-15, 15, -36, 3.6, 0.3, 'plaster', [D(-10), D(0), D(10)]);
  });
  b.with({ thin: true, tint: '#e0d8c8' }, () => {
    b.wallX(-36, -14, -5, 3.6, 0.2, 'wallpaper', [D(-30)]);
    b.wallX(-36, -14, 5, 3.6, 0.2, 'wallpaper', [D(-30)]);
  });
  b.with({ roof: true }, () => b.box(-36.3, 3.6, -15.3, -13.7, 3.8, 15.3, 'concrete'));
  [-10, 0, 10].forEach((c, i) => b.deco(-13.85, 2.75, c - 4, -13.6, 3.4, c + 4, 'paint', shopTint[i]));
  // Café.
  b.floor(-36, -15, -14, -5, 'marble', '#d0c0a8');
  b.counter(-34, -14.6, -29, -13.9);
  for (const [x, z] of [[-20, -11.5], [-20, -8], [-25, -11.5], [-25, -8]] as Array<[number, number]>) b.table(x, z, 1, 1, 0.76, 'darkwood');
  // Store: shelf aisles.
  b.floor(-36, -5, -14, 5, 'marble', '#c8c8c8');
  b.shelf(-31, -2.3, -19, -1.7, 1.7, 'metal', '#b8402a');
  b.shelf(-31, 1.7, -19, 2.3, 1.7, 'metal', '#2a6ab8');
  b.counter(-17.5, -4.2, -16.5, -1.2);
  // Bank: teller counter and a vault.
  b.floor(-36, 5, -14, 15, 'marble', '#e0dcd0');
  b.counter(-28, 6, -27.3, 13, 1.15);
  b.box(-35.6, 0, 11.5, -33, 2.4, 14.6, 'metal');
  b.sofa(-18, 8, 2.4, 0.9, 'n', '#4a3a3a');

  // Alley south of the shops.
  b.prop('prop-trashcontainer', -21, 18, 0, 1.15, { tint: '#3a3a5a' });
  b.crates(-32, 19.2, 3, 1.2);

  // ---- Parking lot: x −36…−14, z 21…38.
  b.box(-14.3, 0, 21, -13.9, 1, 30, 'concrete');
  b.box(-14.3, 0, 33, -13.9, 1, 38, 'concrete');
  b.car(-30, 25, 1, '#2a2a30');
  b.car(-22, 25, 1, '#c8c0b0');
  b.car(-30, 33, 1, '#6a1a1a');
  b.car(-24, 32.5, 1, '#3a5a8a');
  b.with({ tint: '#2a6a5a' }, () => b.room(-19, 34.5, -16, 37.5, 2.5, 'paint', 0.12, { n: [D(-17.5, 1)], e: [W(36, 1.4, 1, 2)] }));
  b.with({ roof: true }, () => b.box(-19.2, 2.5, 34.3, -15.8, 2.65, 37.7, 'metal'));
  b.prop('prop-barrier-single', -17.5, 29, 1, 1.2);
  b.prop('prop-trafficcone', -18, 23, 0, 1.2, { collide: false });

  // ---- Back street (spawn): dumpsters, pallets.
  b.prop('prop-trashcontainer', -38, -12, 1, 1.15, { tint: '#3d6b35' });
  b.prop('prop-trashcontainer', -38, 18, 1, 1.15, { tint: '#6a6a6a' });
  b.prop('prop-pallet', -44, 4, 0, 1.3, { collide: false });
  b.crates(-44, -20, 3, 1.3);
  b.prop('prop-streetlight', -37, 0, 1, 1.4, { collide: false });

  // ---- Main street furniture on this side.
  b.box(-12.8, 0, -9.5, -12, 2.3, -8.7, 'paint');
  b.box(-13, 0, 19.4, -11, 1.6, 20.6, 'darkwood'); // newsstand
  b.box(-13.1, 0, 26, -12.9, 2.4, 30, 'glass', true); // bus shelter
  b.deco(-13.2, 2.4, 25.8, -11.4, 2.55, 30.2, 'metal', '#3a3a3a');
  for (const z of [-30, -6, 18]) b.prop('prop-streetlight', -12.5, z, 1, 1.4, { collide: false });
  b.prop('prop-tree-2', -7, -7, 0, 1.8);
  b.box(-8.2, 0, -8.2, -5.8, 0.8, -5.8, 'brick');
  b.prop('prop-barrier-single', -3, -12, 0, 1.2);
  b.car(-6, 14, 0, '#d8d8d8');
  b.car(-9, 30, 0, '#a83a2a');
}

const flip = (b: Box, tint?: Record<string, string>): Box => ({ ...b, x0: -b.x1, x1: -b.x0, z0: -b.z1, z1: -b.z0, tint: b.tint && tint?.[b.tint] ? tint[b.tint] : b.tint });

export function downtown(): MapDef {
  const b = new Builder();
  const HX = 46;
  const HZ = 38;
  b.bounds(HX, HZ);
  const w = new Builder();
  westSide(w);
  const recolor = { '#b07050': '#7e8290', '#d8cbb4': '#c8d0d8', '#2a6a5a': '#8a3a5a' };
  for (const x of w.boxes) b.boxes.push(x, flip(x, recolor));
  for (const x of w.decor) b.decor.push(x, flip(x, recolor));
  for (const p of w.props) b.props.push(p, { ...p, x: -p.x, z: -p.z, rot: (p.rot + 2) % 4 });

  // The plaza and the vehicles in the middle of the street.
  b.box(-2.5, 0, -2.5, 2.5, 0.7, 2.5, 'marble');
  b.deco(-2.2, 0.7, -2.2, 2.2, 0.72, 2.2, 'glass', '#4a8ab8');
  b.pillar(0, 0, 0.45, 2.6);
  b.bus(-6, -25, true, 1, '#3a6ab8');
  b.truck(6, 25, true, -1, '#e8e4dc', '#c83a2a');
  b.prop('prop-explodingbarrel', 3, -20, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-explodingbarrel', -3, 20, 0, 1.2, { explosive: true, shrink: 0.8 });
  return {
    id: 'downtown',
    name: 'Downtown',
    desc: 'City streets, shops you can run through, apartments with a view. Medium-range brawls.',
    half: [HX, HZ],
    boxes: b.boxes,
    decor: b.decor,
    props: b.props,
    spawns: [
      [sp(-41, -32, FACE.px), sp(-41, -26, FACE.px), sp(-41, -8, FACE.px), sp(-41, 0, FACE.px), sp(-41, 8, FACE.px), sp(-41, 30, FACE.px)],
      [sp(41, 32, FACE.nx), sp(41, 26, FACE.nx), sp(41, 8, FACE.nx), sp(41, 0, FACE.nx), sp(41, -8, FACE.nx), sp(41, -30, FACE.nx)],
    ],
    ffa: [sp(-42, -36, 0.8), sp(42, 36, -2.4), sp(-42, 36, 2.4), sp(42, -36, -0.8), sp(-30, -10, FACE.px), sp(30, 10, FACE.nx), sp(-20, -27, FACE.px), sp(20, 27, FACE.nx), sp(0, -35, FACE.pz), sp(0, 35, FACE.nz)],
    flags: [
      { x: -25, z: 29, y: 0 },
      { x: 0, z: 6.5, y: 0 },
      { x: 25, z: -29, y: 0 },
    ],
    theme: {
      sky: 'day',
      ground: 'asphalt',
      patches: [
        [-14, -38, -11.5, 38, 'concrete'],
        [11.5, -38, 14, 38, 'concrete'],
        [-11.5, -9, 11.5, 9, 'concrete'],
        [-36, 21, -14, 38, 'asphalt'],
      ],
      sun: [-0.35, 0.8, 0.45],
      fog: ['#b8c4d0', 90, 460],
    },
    backdrop: 'city',
    size: 'medium',
  };
}
