import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ItemId } from '@shared/items/ItemTypes';

/**
 * Procedural 3D assets for every item, the prize box, coins and projectiles.
 * Original designs; built once and cloned (geometry/materials shared).
 * Models are ~1 m across, centred, resting around y = 0.
 */

const mats = new Map<string, MeshStandardMaterial>();
function mat(color: string, opts: { emissive?: number; metal?: number; rough?: number; opacity?: number; flat?: boolean; double?: boolean } = {}): MeshStandardMaterial {
  const key = `${color}|${JSON.stringify(opts)}`;
  let m = mats.get(key);
  if (!m) {
    m = new MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.45,
      metalness: opts.metal ?? 0,
      emissive: opts.emissive ? new Color(color) : new Color(0),
      emissiveIntensity: opts.emissive ?? 0,
      transparent: opts.opacity !== undefined,
      opacity: opts.opacity ?? 1,
      flatShading: opts.flat ?? false,
      side: opts.double ? DoubleSide : undefined,
      depthWrite: opts.opacity === undefined,
    });
    mats.set(key, m);
  }
  return m;
}

function mesh(geo: BufferGeometry, material: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function starShape(points: number, outer: number, inner: number): Shape {
  const s = new Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

function boltShape(scale = 1): Shape {
  const pts: Array<[number, number]> = [
    [0.1, 0.5],
    [-0.22, 0.02],
    [0.0, 0.02],
    [-0.12, -0.5],
    [0.24, 0.06],
    [0.02, 0.06],
    [0.18, 0.5],
  ];
  const s = new Shape();
  pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x * scale, y * scale) : s.lineTo(x * scale, y * scale)));
  s.closePath();
  return s;
}

const extrude = (shape: Shape, depth: number, bevel = 0.02): ExtrudeGeometry =>
  new ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2 }).translate(0, 0, -depth / 2);

/** Rainbow vertex colours by height/angle — used by the prize box & prism. */
function rainbow(geo: BufferGeometry, lightness = 0.62): BufferGeometry {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const h = (Math.atan2(pos.getZ(i), pos.getX(i)) / (Math.PI * 2) + pos.getY(i) * 0.35 + 1) % 1;
    c.setHSL(h, 0.85, lightness);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

// ------------------------------------------------------------------ builders

function prizeBox(decoy = false): Group {
  const g = new Group();
  const shell = new Mesh(
    rainbow(new RoundedBoxGeometry(1.35, 1.35, 1.35, 4, 0.22), decoy ? 0.5 : 0.66),
    new MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.62, roughness: 0.15, emissive: decoy ? '#5a1a00' : '#3a3a6a', emissiveIntensity: 0.4, depthWrite: false }),
  );
  shell.name = 'shell';
  const core = mesh(extrude(starShape(decoy ? 6 : 4, 0.45, decoy ? 0.3 : 0.16), 0.18), mat(decoy ? '#ff5a2a' : '#fff6c8', { emissive: 1.2 }));
  core.name = 'core';
  g.add(core, shell);
  return g;
}

function fizzBottle(color: string, gold = false): Group {
  const g = new Group();
  const profile = [
    [0, 0],
    [0.24, 0],
    [0.27, 0.06],
    [0.27, 0.5],
    [0.2, 0.62],
    [0.1, 0.72],
    [0.1, 0.84],
    [0, 0.84],
  ].map(([x, y]) => new Vector2(x, y));
  const glass = gold ? mat(color, { metal: 0.85, rough: 0.22, emissive: 0.15 }) : mat(color, { rough: 0.2 });
  g.add(mesh(new LatheGeometry(profile, 20), glass));
  g.add(mesh(new CylinderGeometry(0.285, 0.285, 0.26, 20, 1, true), mat(gold ? '#fff3b0' : '#ffffff', { double: true }), 0, 0.3, 0));
  const bolt = mesh(extrude(boltShape(0.42), 0.04, 0.005), mat(gold ? '#ff8c1a' : '#ffd23f', { emissive: 0.4 }), 0, 0.3, 0.29);
  g.add(bolt);
  g.add(mesh(new CylinderGeometry(0.12, 0.12, 0.08, 16), mat('#c9ced8', { metal: 0.7, rough: 0.3 }), 0, 0.87, 0));
  g.position.y = -0.42;
  const wrap = new Group();
  wrap.add(g);
  return wrap;
}

function puck(color = '#2fd06a', dark = '#0f7a3a'): Group {
  const g = new Group();
  g.add(mesh(new CylinderGeometry(0.55, 0.55, 0.28, 28), mat(color)));
  g.add(mesh(new TorusGeometry(0.55, 0.09, 10, 28).rotateX(Math.PI / 2), mat(dark)));
  g.add(mesh(new CylinderGeometry(0.32, 0.36, 0.06, 24), mat('#e9fff0'), 0, 0.16, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(mesh(new SphereGeometry(0.08, 8, 6), mat('#ffffff'), Math.cos(a) * 0.45, 0.17, Math.sin(a) * 0.45));
  }
  return g;
}

function seekerDrone(): Group {
  const g = new Group();
  g.add(mesh(new SphereGeometry(0.42, 20, 14), mat('#ff2f3f', { rough: 0.25 })));
  g.add(mesh(new SphereGeometry(0.2, 14, 10), mat('#1b1446', { rough: 0.1 }), 0, 0.05, 0.3));
  g.add(mesh(new SphereGeometry(0.08, 8, 6), mat('#ffe14d', { emissive: 2 }), 0, 0.07, 0.48));
  const rotor = new Group();
  rotor.name = 'rotor';
  rotor.position.y = 0.5;
  rotor.add(mesh(new CylinderGeometry(0.05, 0.05, 0.16, 8), mat('#e8eef5'), 0, -0.06, 0));
  rotor.add(mesh(new CylinderGeometry(0.62, 0.62, 0.03, 4).scale(1, 1, 0.12), mat('#ffffff')));
  rotor.add(mesh(new CylinderGeometry(0.62, 0.62, 0.03, 4).scale(0.12, 1, 1), mat('#ffffff')));
  g.add(rotor);
  for (const s of [-1, 1]) g.add(mesh(new ConeGeometry(0.12, 0.3, 8).rotateZ((s * Math.PI) / 2), mat('#ffe1e4'), s * 0.45, 0, -0.05));
  return g;
}

function crownBuster(): Group {
  const g = new Group();
  g.add(mesh(new SphereGeometry(0.62, 22, 16), mat('#2f6bff', { rough: 0.25, emissive: 0.25 })));
  const spike = new ConeGeometry(0.14, 0.5, 8);
  const ico = new IcosahedronGeometry(0.62, 0);
  const pos = ico.getAttribute('position');
  const seen = new Set<string>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
    if (seen.has(key) || y < -0.3) continue;
    seen.add(key);
    const m = mesh(spike, mat('#ffffff'), x * 1.05, y * 1.05, z * 1.05);
    m.lookAt(x * 3, y * 3, z * 3);
    m.rotateX(Math.PI / 2);
    g.add(m);
  }
  const wing = new Shape();
  wing.moveTo(0, 0);
  wing.quadraticCurveTo(0.6, 0.55, 1.15, 0.35);
  wing.quadraticCurveTo(0.8, 0.15, 1.0, -0.05);
  wing.quadraticCurveTo(0.6, -0.05, 0, -0.15);
  for (const s of [-1, 1]) {
    const w = mesh(extrude(wing, 0.06, 0.01), mat('#bfe0ff', { emissive: 0.3 }), s * 0.45, 0.1, -0.1);
    w.name = s < 0 ? 'wingL' : 'wingR';
    w.scale.x = s;
    g.add(w);
  }
  return g;
}

function gooBlob(): Group {
  const g = new Group();
  const blob = mesh(new SphereGeometry(0.6, 22, 14).scale(1, 0.55, 1), mat('#b6f03a', { rough: 0.15, emissive: 0.08 }), 0, 0.2, 0);
  blob.name = 'blob';
  g.add(blob);
  g.add(mesh(new SphereGeometry(0.22, 12, 8).scale(1, 0.5, 1), mat('#9be020', { rough: 0.15 }), 0.55, 0.02, 0.25));
  g.add(mesh(new SphereGeometry(0.15, 10, 8).scale(1, 0.5, 1), mat('#9be020', { rough: 0.15 }), -0.5, 0.0, -0.3));
  for (const s of [-1, 1]) {
    g.add(mesh(new SphereGeometry(0.12, 10, 8), mat('#ffffff'), s * 0.17, 0.48, 0.35));
    g.add(mesh(new SphereGeometry(0.06, 8, 6), mat('#1b1446'), s * 0.17, 0.5, 0.45));
  }
  return g;
}

function boomBall(): Group {
  const g = new Group();
  g.add(mesh(new SphereGeometry(0.55, 22, 16), mat('#2a2638', { rough: 0.35 }), 0, 0.55, 0));
  g.add(mesh(new TorusGeometry(0.555, 0.07, 8, 28).rotateX(Math.PI / 2), mat('#ff8c1a'), 0, 0.55, 0));
  g.add(mesh(new CylinderGeometry(0.16, 0.2, 0.18, 12), mat('#8a8fa6', { metal: 0.6 }), 0, 1.12, 0));
  g.add(mesh(new CylinderGeometry(0.035, 0.035, 0.3, 6).rotateZ(0.5), mat('#c9a27a'), 0.07, 1.32, 0));
  const spark = mesh(new IcosahedronGeometry(0.1, 0), mat('#ffe14d', { emissive: 3 }), 0.16, 1.47, 0);
  spark.name = 'spark';
  g.add(spark);
  g.position.y = -0.4;
  const wrap = new Group();
  wrap.add(g);
  return wrap;
}

function paintCan(): Group {
  const g = new Group();
  g.add(mesh(new CylinderGeometry(0.38, 0.33, 0.7, 22), mat('#9b4dff', { rough: 0.35 }), 0, 0, 0));
  g.add(mesh(new CylinderGeometry(0.39, 0.39, 0.06, 22), mat('#c9ced8', { metal: 0.6 }), 0, 0.36, 0));
  g.add(mesh(new TorusGeometry(0.38, 0.025, 6, 20, Math.PI).rotateZ(0), mat('#c9ced8', { metal: 0.6 }), 0, 0.38, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(mesh(new SphereGeometry(0.07, 8, 6).scale(1, 2.2, 1), mat('#ff4fd8'), Math.cos(a) * 0.37, 0.22 - (i % 2) * 0.1, Math.sin(a) * 0.37));
  }
  g.add(mesh(new SphereGeometry(0.3, 14, 8).scale(1, 0.35, 1), mat('#ff4fd8', { rough: 0.2 }), 0, 0.4, 0));
  return g;
}

function zapBolt(): Group {
  const g = new Group();
  g.add(mesh(extrude(boltShape(1.4), 0.2, 0.04), mat('#ffe14d', { emissive: 0.9 })));
  const back = mesh(extrude(boltShape(1.62), 0.12, 0.02), mat('#3a2fb0'), 0, 0, -0.08);
  g.add(back);
  return g;
}

function prism(): Group {
  const g = new Group();
  const core = new Mesh(rainbow(new OctahedronGeometry(0.62, 0).toNonIndexed(), 0.55), new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.15, metalness: 0.1, emissive: '#ff4fd8', emissiveIntensity: 0.18 }));
  core.scale.set(0.85, 1.15, 0.85);
  core.castShadow = true;
  g.add(core);
  g.add(mesh(new TorusGeometry(0.75, 0.035, 6, 32).rotateX(Math.PI / 2), mat('#ffffff', { emissive: 1.5 })));
  return g;
}

function rocket(): Group {
  const g = new Group();
  const body = mesh(new CylinderGeometry(0.42, 0.42, 1.4, 22).rotateX(Math.PI / 2), mat('#e8eef5', { rough: 0.3 }));
  const nose = mesh(new ConeGeometry(0.42, 0.7, 22).rotateX(Math.PI / 2), mat('#ff3b5c', { rough: 0.3 }), 0, 0, 1.05);
  const port = mesh(new CylinderGeometry(0.17, 0.17, 0.06, 16).rotateZ(Math.PI / 2), mat('#3fd8ff', { emissive: 0.6 }), 0.41, 0.1, 0.25);
  const port2 = port.clone();
  port2.position.x = -0.41;
  g.add(body, nose, port, port2);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const fin = mesh(new BoxGeometry(0.07, 0.42, 0.55), mat('#ff3b5c'), Math.cos(a) * 0.58, Math.sin(a) * 0.58, -0.45);
    fin.rotation.z = a - Math.PI / 2; // local +Y points radially outward
    g.add(fin);
  }
  const flame = mesh(new ConeGeometry(0.34, 0.9, 16).rotateX(-Math.PI / 2), mat('#ff8c1a', { emissive: 2.5, opacity: 0.85 }), 0, 0, -1.15);
  flame.name = 'flame';
  g.add(flame);
  return g;
}

function emberOrb(size = 1): Group {
  const g = new Group();
  g.add(mesh(new SphereGeometry(0.34 * size, 16, 12), mat('#ffc23a', { emissive: 2.2 })));
  const shell = mesh(new IcosahedronGeometry(0.48 * size, 1), mat('#ff4a12', { emissive: 1.4, opacity: 0.75, flat: true }));
  shell.name = 'shell';
  g.add(shell);
  // Flame licks curling upward.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const lick = mesh(new ConeGeometry(0.16 * size, 0.55 * size, 8), mat(i % 2 ? '#ff4a1a' : '#ffb52e', { emissive: 1.8, opacity: 0.85 }), Math.cos(a) * 0.3 * size, 0.28 * size, Math.sin(a) * 0.3 * size);
    lick.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    g.add(lick);
  }
  g.add(mesh(new ConeGeometry(0.22 * size, 0.7 * size, 10), mat('#ffd23f', { emissive: 2, opacity: 0.9 }), 0, 0.45 * size, 0));
  return g;
}

function boomerang(): Group {
  const s = new Shape();
  s.moveTo(-0.7, 0.45);
  s.quadraticCurveTo(-0.25, 0.15, 0, -0.35);
  s.quadraticCurveTo(0.25, 0.15, 0.7, 0.45);
  s.quadraticCurveTo(0.7, 0.2, 0.62, 0.15);
  s.quadraticCurveTo(0.2, 0.0, 0, -0.62);
  s.quadraticCurveTo(-0.2, 0.0, -0.62, 0.15);
  s.quadraticCurveTo(-0.7, 0.2, -0.7, 0.45);
  const g = new Group();
  const body = mesh(extrude(s, 0.1, 0.03).rotateX(Math.PI / 2), mat('#3fd8ff', { rough: 0.3 }));
  g.add(body);
  for (const x of [-0.66, 0.66]) g.add(mesh(new SphereGeometry(0.1, 10, 8).scale(1, 0.6, 1), mat('#ffd23f'), x, 0, -0.42));
  return g;
}

function snapperPot(): Group {
  const g = new Group();
  const pot = [
    [0, -0.6],
    [0.3, -0.6],
    [0.42, -0.1],
    [0.46, -0.05],
    [0.46, 0.02],
    [0, 0.02],
  ].map(([x, y]) => new Vector2(x, y));
  g.add(mesh(new LatheGeometry(pot, 20), mat('#d9774a', { rough: 0.8 })));
  g.add(mesh(new CylinderGeometry(0.06, 0.08, 0.4, 8), mat('#2f8f3a'), 0, 0.2, 0));
  const head = new Group();
  head.name = 'head';
  head.position.y = 0.55;
  const jawTop = new Group();
  jawTop.name = 'jawTop';
  const jawBottom = new Group();
  jawBottom.name = 'jawBottom';
  const half = new SphereGeometry(0.38, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  jawTop.add(mesh(half, mat('#3fbf4a', { double: true })));
  jawTop.add(mesh(half.clone().scale(0.92, 0.9, 0.92), mat('#ff4f6a', { double: true }), 0, -0.01, 0));
  jawBottom.add(mesh(half.clone().rotateX(Math.PI), mat('#3fbf4a', { double: true })));
  jawBottom.add(mesh(half.clone().rotateX(Math.PI).scale(0.92, 0.9, 0.92), mat('#ff4f6a', { double: true }), 0, 0.01, 0));
  for (let i = 0; i < 7; i++) {
    const a = (i / 6) * Math.PI - Math.PI / 2;
    jawTop.add(mesh(new ConeGeometry(0.04, 0.12, 6).rotateX(Math.PI), mat('#ffffff'), Math.sin(a) * 0.33, -0.04, Math.cos(a) * 0.33));
    jawBottom.add(mesh(new ConeGeometry(0.04, 0.12, 6), mat('#ffffff'), Math.sin(a) * 0.33, 0.04, Math.cos(a) * 0.33));
  }
  jawTop.rotation.x = -0.35;
  jawBottom.rotation.x = 0.25;
  head.add(jawTop, jawBottom);
  g.add(head);
  g.position.y = 0.05;
  const wrap = new Group();
  wrap.add(g);
  return wrap;
}

function blastHorn(): Group {
  const g = new Group();
  const bell = [
    [0.05, 0],
    [0.07, 0.3],
    [0.12, 0.55],
    [0.25, 0.75],
    [0.45, 0.88],
    [0.47, 0.9],
  ].map(([x, y]) => new Vector2(x, y));
  const brass = mat('#ffc21a', { metal: 0.85, rough: 0.25 });
  const b = mesh(new LatheGeometry(bell, 22), mat('#ffc21a', { metal: 0.85, rough: 0.25, double: true }));
  b.rotation.z = -Math.PI / 2;
  b.position.x = -0.2;
  g.add(b);
  g.add(mesh(new TorusGeometry(0.22, 0.05, 8, 22), brass, -0.1, -0.05, 0));
  g.add(mesh(new CylinderGeometry(0.05, 0.08, 0.2, 10).rotateZ(Math.PI / 2), mat('#8a5a1a', { metal: 0.6 }), -0.42, -0.02, 0));
  return g;
}

function sparkCoin(): Group {
  const g = new Group();
  const gold = mat('#ffd23f', { metal: 0.9, rough: 0.22, emissive: 0.25 });
  g.add(mesh(new CylinderGeometry(0.45, 0.45, 0.1, 28).rotateX(Math.PI / 2), gold));
  for (const z of [-0.06, 0.06]) g.add(mesh(extrude(starShape(5, 0.24, 0.1), 0.04, 0.005), mat('#ff9a1a', { metal: 0.7, rough: 0.3 }), 0, 0, z));
  return g;
}

function quakeBlock(): Group {
  const g = new Group();
  g.add(mesh(new RoundedBoxGeometry(1, 1, 1, 3, 0.12), mat('#ff8c1a', { rough: 0.5 })));
  const crack = extrude(boltShape(1.1), 0.08, 0.01);
  for (const [ry, z] of [
    [0, 0.5],
    [Math.PI, -0.5],
  ] as const) {
    const m = mesh(crack, mat('#5a2a8a'), 0, 0, 0);
    m.rotation.y = ry;
    m.translateZ(Math.abs(z));
    g.add(m);
  }
  for (const x of [-0.5, 0.5]) {
    const m = mesh(crack, mat('#5a2a8a'));
    m.rotation.y = Math.PI / 2;
    m.position.x = x;
    g.add(m);
  }
  return g;
}

function cluster(build: () => Object3D, n: number, spread = 0.55): Group {
  const g = new Group();
  for (let i = 0; i < n; i++) {
    const m = build();
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    m.position.set(Math.cos(a) * spread, Math.sin(a) * spread * 0.6, 0);
    m.scale.setScalar(0.7);
    g.add(m);
  }
  return g;
}

function octoRing(): Group {
  const g = new Group();
  const colors = ['#ff3b5c', '#2fd06a', '#ff2f3f', '#b6f03a', '#2a2638', '#ff4fd8', '#9b4dff', '#ffd23f'];
  g.add(mesh(new TorusGeometry(0.62, 0.05, 8, 40), mat('#ffffff', { emissive: 0.6 })));
  colors.forEach((c, i) => {
    const a = (i / 8) * Math.PI * 2;
    g.add(mesh(new SphereGeometry(0.17, 12, 10), mat(c, { rough: 0.25, emissive: 0.15 }), Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0));
  });
  g.add(mesh(new SphereGeometry(0.22, 14, 10), mat('#ff8c1a', { emissive: 0.6 })));
  return g;
}

/** Phantom Sheet: a friendly floating sheet ghost with a wavy hem. */
function phantomSheet(): Group {
  const g = new Group();
  const body = [
    [0, 0.62],
    [0.22, 0.58],
    [0.36, 0.44],
    [0.42, 0.2],
    [0.44, -0.1],
    [0.48, -0.32],
  ].map(([x, y]) => new Vector2(x, y));
  const sheet = mat('#eeeaff', { rough: 0.6, emissive: 0.25, double: true, opacity: 0.92 });
  g.add(mesh(new LatheGeometry(body, 24), sheet));
  // Scalloped hem.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(mesh(new SphereGeometry(0.14, 10, 8).scale(1, 0.8, 1), sheet, Math.cos(a) * 0.42, -0.36, Math.sin(a) * 0.42));
  }
  for (const sx of [-1, 1]) {
    g.add(mesh(new SphereGeometry(0.08, 10, 8).scale(1, 1.4, 0.6), mat('#2a1f5c'), sx * 0.15, 0.24, 0.37));
    g.add(mesh(new SphereGeometry(0.06, 8, 6).scale(1.6, 0.7, 0.6), mat('#ff9ad8', { opacity: 0.8 }), sx * 0.27, 0.08, 0.34));
    // Little arms.
    const arm = mesh(new SphereGeometry(0.1, 8, 6).scale(1.8, 0.7, 0.7), sheet, sx * 0.48, 0.02, 0.05);
    arm.rotation.z = sx * -0.5;
    g.add(arm);
  }
  g.add(mesh(new TorusGeometry(0.1, 0.03, 6, 14, Math.PI), mat('#2a1f5c'), 0, 0.08, 0.38));
  return g;
}

/** Giant Gummy: a squishy gummy mushroom with sugar spots and an up-arrow badge. */
function giantGummy(): Group {
  const g = new Group();
  const cap = mesh(new SphereGeometry(0.55, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1), mat('#ff4f8a', { rough: 0.15, emissive: 0.12, opacity: 0.92 }), 0, 0.05, 0);
  g.add(cap);
  g.add(mesh(new CylinderGeometry(0.55, 0.55, 0.06, 24), mat('#ffd6e6', { rough: 0.3 }), 0, 0.05, 0));
  g.add(mesh(new CylinderGeometry(0.26, 0.3, 0.5, 18), mat('#fff3d6', { rough: 0.4 }), 0, -0.22, 0));
  const spot = mat('#ffe14d', { rough: 0.3, emissive: 0.2 });
  for (const [x, y, z, r] of [
    [0, 0.47, 0, 0.13],
    [0.33, 0.3, 0.2, 0.1],
    [-0.32, 0.3, 0.22, 0.1],
    [0.1, 0.3, -0.38, 0.1],
    [-0.28, 0.22, -0.3, 0.08],
  ] as const)
    g.add(mesh(new SphereGeometry(r, 10, 8).scale(1, 0.45, 1), spot, x, y, z));
  for (const sx of [-1, 1]) g.add(mesh(new SphereGeometry(0.045, 8, 6), mat('#3a1f2a'), sx * 0.09, -0.15, 0.27));
  const arrow = new Shape();
  arrow.moveTo(0, 0.2);
  arrow.lineTo(0.16, 0.02);
  arrow.lineTo(0.06, 0.02);
  arrow.lineTo(0.06, -0.18);
  arrow.lineTo(-0.06, -0.18);
  arrow.lineTo(-0.06, 0.02);
  arrow.lineTo(-0.16, 0.02);
  arrow.closePath();
  const badge = mesh(extrude(arrow, 0.05, 0.01), mat('#ffffff', { emissive: 0.6 }), 0, 0.28, 0.45);
  badge.rotation.x = -0.45;
  g.add(badge);
  return g;
}

/** Sky Feather: a curved white plume with a golden quill. */
function skyFeather(): Group {
  const g = new Group();
  const vane = new Shape();
  vane.moveTo(0, -0.55);
  vane.quadraticCurveTo(0.34, -0.2, 0.22, 0.25);
  vane.quadraticCurveTo(0.12, 0.55, 0, 0.62);
  vane.quadraticCurveTo(-0.16, 0.45, -0.2, 0.15);
  vane.quadraticCurveTo(-0.22, -0.25, 0, -0.55);
  const plume = mesh(extrude(vane, 0.06, 0.03), mat('#ffffff', { rough: 0.7, emissive: 0.15 }));
  g.add(plume);
  // Barb notches and a warm tip.
  for (const [x, y, rz] of [
    [0.22, 0.05, -0.6],
    [-0.19, -0.12, 0.7],
    [0.2, -0.28, -0.8],
  ] as const) {
    const notch = mesh(new BoxGeometry(0.16, 0.025, 0.09), mat('#e3e8ff'), x, y, 0);
    notch.rotation.z = rz;
    g.add(notch);
  }
  g.add(mesh(new SphereGeometry(0.13, 10, 8).scale(1, 1.4, 0.4), mat('#ffb52e', { emissive: 0.3 }), 0.02, 0.48, 0));
  const quill = mesh(new CylinderGeometry(0.025, 0.012, 1.25, 8), mat('#ffc21a', { metal: 0.6, rough: 0.3 }), 0, -0.05, 0.04);
  g.add(quill);
  g.rotation.z = -0.35;
  const wrap = new Group();
  wrap.add(g);
  return wrap;
}

/** Pickup carrier: a little cloud drone with a propeller and a tow cable (lifts fallen karts). */
function pickupCarrier(): Group {
  const g = new Group();
  const cloud = mat('#ffffff', { rough: 0.85, emissive: 0.15 });
  for (const [x, y, z, r] of [
    [0, 0, 0, 0.62],
    [0.55, -0.08, 0.05, 0.45],
    [-0.55, -0.06, -0.05, 0.47],
    [0.2, 0.22, -0.3, 0.42],
    [-0.25, 0.18, 0.3, 0.4],
    [0, -0.2, 0.42, 0.38],
  ] as const)
    g.add(mesh(new SphereGeometry(r, 14, 10), cloud, x, y, z));
  for (const sx of [-1, 1]) g.add(mesh(new SphereGeometry(0.08, 8, 6).scale(1, 1.3, 0.6), mat('#1b1446'), sx * 0.2, 0.08, 0.62));
  g.add(mesh(new TorusGeometry(0.1, 0.025, 6, 12, Math.PI).rotateZ(Math.PI), mat('#1b1446'), 0, -0.1, 0.64));
  const rotor = new Group();
  rotor.name = 'rotor';
  rotor.position.y = 0.72;
  rotor.add(mesh(new CylinderGeometry(0.05, 0.06, 0.25, 8), mat('#ff4f6a'), 0, -0.1, 0));
  for (const a of [0, Math.PI / 2]) {
    const blade = mesh(new BoxGeometry(1.5, 0.03, 0.14), mat('#ffd23f', { rough: 0.4 }));
    blade.rotation.y = a;
    rotor.add(blade);
  }
  g.add(rotor);
  // Cable down to a hook ring that grabs the kart's roll bar.
  const cable = mesh(new CylinderGeometry(0.025, 0.025, 1, 6), mat('#4a4466'), 0, -0.5, 0);
  cable.name = 'cable';
  g.add(cable);
  const hook = mesh(new TorusGeometry(0.16, 0.045, 8, 16), mat('#c9ced8', { metal: 0.8, rough: 0.3 }), 0, -1.05, 0);
  hook.name = 'hook';
  g.add(hook);
  return g;
}

// ------------------------------------------------------------------ registry

export type ModelKey = ItemId | 'prizeBox' | 'decoyBox' | 'fireball' | 'rocketKart' | 'coinPickup' | 'carrier';

const BUILDERS: Record<ModelKey, () => Object3D> = {
  fizz: () => fizzBottle('#ff3b5c'),
  fizz3: () => cluster(() => fizzBottle('#ff3b5c'), 3, 0.42),
  fizzGold: () => fizzBottle('#ffc21a', true),
  puck: () => puck(),
  puck3: () => cluster(() => puck(), 3),
  seeker: seekerDrone,
  seeker3: () => cluster(seekerDrone, 3),
  crownBuster,
  goo: gooBlob,
  goo3: () => cluster(gooBlob, 3),
  boomBall,
  decoy: () => prizeBox(true),
  paint: paintCan,
  zap: zapBolt,
  prism,
  jetRocket: rocket,
  ember: () => emberOrb(1),
  rang: boomerang,
  snapper: snapperPot,
  horn: blastHorn,
  octo: octoRing,
  coin: () => cluster(sparkCoin, 2, 0.28),
  quake: quakeBlock,
  phantom: phantomSheet,
  giant: giantGummy,
  feather: skyFeather,
  carrier: pickupCarrier,
  prizeBox: () => prizeBox(false),
  decoyBox: () => prizeBox(true),
  fireball: () => emberOrb(0.8),
  rocketKart: rocket,
  coinPickup: sparkCoin,
};

/** Every model key (shader warm-up builds one of each). */
export const MODEL_KEYS = Object.keys(BUILDERS) as ModelKey[];

const templates = new Map<ModelKey, Object3D>();

/** Shared template for a model (built on first use). */
export function itemTemplate(key: ModelKey): Object3D {
  let t = templates.get(key);
  if (!t) {
    t = BUILDERS[key]();
    t.name = `item:${key}`;
    templates.set(key, t);
  }
  return t;
}

/** A fresh instance (geometry/materials shared with the template). */
export function createItemModel(key: ModelKey): Object3D {
  return itemTemplate(key).clone(true);
}
