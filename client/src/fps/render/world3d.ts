import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Box, Material } from '../sim/level';
import type { MapDef, PropPlacement } from '../sim/maps';
import { TILE, texture } from './textures';
import { cloneModel } from './assets';
import { backdrop } from './backdrop';

/** Per-sky lighting: strong sky fill (shade and interiors stay readable), a little ambient, and lamps at dusk / night. */
const SKY: Record<MapDef['theme']['sky'], { top: string; mid: string; bottom: string; sun: string; sunI: number; hemi: number; bounce: string; amb: number; exposure: number; lamps: boolean }> = {
  day: { top: '#2f6fbf', mid: '#8fbde8', bottom: '#dfe8ee', sun: '#fff4e0', sunI: 2.3, hemi: 2.3, bounce: '#7a6e5c', amb: 0.15, exposure: 1.0, lamps: false },
  dusk: { top: '#2a3b6a', mid: '#d88a58', bottom: '#f2c48a', sun: '#ffc890', sunI: 2.1, hemi: 1.9, bounce: '#9a7656', amb: 0.3, exposure: 1.05, lamps: true },
  overcast: { top: '#6c7684', mid: '#a3abb5', bottom: '#c3c8cd', sun: '#e8eef4', sunI: 1.2, hemi: 2.6, bounce: '#6a655e', amb: 0.15, exposure: 1.0, lamps: false },
  night: { top: '#05070f', mid: '#141c33', bottom: '#2a3350', sun: '#9fb4ff', sunI: 0.6, hemi: 0.9, bounce: '#2a2a33', amb: 0.35, exposure: 1.2, lamps: true },
};

/** Geometry for one box with UVs in world metres (so textures tile at a fixed scale). */
function boxGeometry(b: Box, tile: number): THREE.BufferGeometry {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const d = b.z1 - b.z0;
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry face order: +x, −x, +y, −y, +z, −z (4 verts each).
  const dims: Array<[number, number]> = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f]!;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      // Offset by world position so neighbouring boxes line up.
      const ou = f < 2 ? b.z0 : b.x0;
      const ov = f === 2 || f === 3 ? b.z0 : b.y0;
      uv.setXY(i, (uv.getX(i) * su + ou) / tile, (uv.getY(i) * sv + ov) / tile);
    }
  }
  g.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  return g;
}

export interface MapView {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  barrels: THREE.Object3D[];
  flags: Array<{ group: THREE.Group; cloth: THREE.Mesh; ring: THREE.Mesh }>;
  /** Free everything this map created (shared model geometry / cached textures stay). */
  dispose(): void;
}

/** Dispose a self-built object tree (geometries + materials). Only for objects that don't share cached model geometry. */
export function disposeTree(o: THREE.Object3D): void {
  o.removeFromParent();
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh && !(n as THREE.Line).isLine && !(n as THREE.Points).isPoints) return;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat?.dispose();
  });
}

export function buildMap(scene: THREE.Scene, renderer: THREE.WebGLRenderer, map: MapDef): MapView {
  const group = new THREE.Group();
  const sky = SKY[map.theme.sky];
  // Everything created here (as opposed to shared model geometry / cached textures) is freed on dispose.
  const own: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(x: T): T => (own.push(x), x);
  renderer.toneMappingExposure = sky.exposure;
  // Sky dome.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color(sky.top) }, mid: { value: new THREE.Color(sky.mid) }, bottom: { value: new THREE.Color(sky.bottom) }, sunDir: { value: new THREE.Vector3(...map.theme.sun).normalize() }, sunCol: { value: new THREE.Color(sky.sun) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol;
      void main(){ float h = vDir.y; vec3 c = mix(bottom, mid, smoothstep(-0.05, 0.12, h)); c = mix(c, top, smoothstep(0.12, 0.7, h));
        float s = max(0.0, dot(normalize(vDir), sunDir)); c += sunCol * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const skyMesh = new THREE.Mesh(keep(new THREE.SphereGeometry(600, 32, 16)), keep(skyMat));
  skyMesh.renderOrder = -1;
  group.add(skyMesh);
  scene.fog = new THREE.Fog(map.theme.fog[0], map.theme.fog[1], map.theme.fog[2]);
  scene.background = new THREE.Color(sky.bottom);
  // Lights.
  // Strong sky fill so shade and interiors stay readable (bounce light), plus a little ambient.
  group.add(new THREE.HemisphereLight(sky.mid, sky.bounce, sky.hemi), new THREE.AmbientLight(sky.sun, sky.amb));
  const sun = new THREE.DirectionalLight(sky.sun, sky.sunI);
  const sd = new THREE.Vector3(...map.theme.sun).normalize();
  sun.position.copy(sd.multiplyScalar(80));
  sun.castShadow = true;
  const half = Math.max(map.half[0], map.half[1]) + 6;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 220 });
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  group.add(sun, sun.target);
  // Ground: the playable area at full brightness, a darker out-of-bounds ring around it out to the
  // horizon (wide enough to carry the backdrop scenery).
  const [hx, hz] = map.half;
  const tile = TILE[map.theme.ground];
  const ground = (w: number, d: number, y: number, color: string, offset: number) => {
    const t = keep(texture(map.theme.ground).clone());
    t.repeat.set(w / tile, d / tile);
    t.offset.set(-w / 2 / tile, -d / 2 / tile);
    t.needsUpdate = true;
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, d)), keep(new THREE.MeshStandardMaterial({ map: t, color, roughness: 0.95, polygonOffset: offset !== 0, polygonOffsetFactor: offset, polygonOffsetUnits: offset })));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    group.add(m);
  };
  ground(1400, 1400, 0, '#8e867a', 0);
  ground(2 * hx + 1, 2 * hz + 1, 0.002, '#ffffff', -1);
  map.theme.patches.forEach(([x0, z0, x1, z1, mat], i) => {
    const t = keep(texture(mat).clone());
    t.repeat.set((x1 - x0) / TILE[mat], (z1 - z0) / TILE[mat]);
    t.needsUpdate = true;
    const p = new THREE.Mesh(keep(new THREE.PlaneGeometry(x1 - x0, z1 - z0)), keep(new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 - i, polygonOffsetUnits: -2 - i })));
    p.rotation.x = -Math.PI / 2;
    p.position.set((x0 + x1) / 2, 0.005 + i * 0.002, (z0 + z1) / 2);
    p.receiveShadow = true;
    group.add(p);
  });
  // Boxes (map + decor + the scenery outside the border), merged per material and tint.
  const scenery = backdrop(map);
  const byMat = new Map<string, { mat: Material; tint?: string; geos: THREE.BufferGeometry[] }>();
  for (const b of [...map.boxes, ...map.decor, ...scenery.boxes]) {
    if (b.hidden || b.mat === 'invisible') continue;
    const key = `${b.mat}|${b.tint ?? ''}`;
    let l = byMat.get(key);
    if (!l) byMat.set(key, (l = { mat: b.mat, tint: b.tint, geos: [] }));
    l.geos.push(boxGeometry(b, TILE[b.mat]));
  }
  // Cylinders (tanks, silos, pipes): UVs in metres like the boxes.
  for (const c of map.cyls ?? []) {
    const key = `${c.mat}|${c.tint ?? ''}`;
    let l = byMat.get(key);
    if (!l) byMat.set(key, (l = { mat: c.mat, tint: c.tint, geos: [] }));
    const geo = new THREE.CylinderGeometry(c.r, c.r, c.h, Math.max(12, Math.min(32, Math.round(c.r * 6))), 1);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const tile = TILE[c.mat];
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 2 * Math.PI * c.r) / tile, (uv.getY(i) * c.h) / tile);
    if (c.axis === 'x') geo.rotateZ(Math.PI / 2);
    if (c.axis === 'z') geo.rotateX(Math.PI / 2);
    geo.translate(c.x, c.axis === 'y' ? c.y + c.h / 2 : c.y, c.z);
    l.geos.push(geo);
  }
  const ROUGH: Partial<Record<Material, number>> = { metal: 0.6, marble: 0.3, glass: 0.15, darkwood: 0.6, paint: 0.7 };
  for (const { mat, tint, geos } of byMat.values()) {
    const geo = keep(mergeGeometries(geos));
    for (const g of geos) g.dispose();
    const m = new THREE.Mesh(
      geo,
      keep(new THREE.MeshStandardMaterial({ map: texture(mat), color: tint ? new THREE.Color(tint) : 0xffffff, roughness: ROUGH[mat] ?? 0.9, metalness: mat === 'metal' ? 0.08 : mat === 'glass' ? 0.2 : 0 })),
    );
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  for (const p of scenery.props) {
    const o = cloneModel(p.model, p.tint, 0.35);
    o.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) own.push(mat);
    });
    o.position.set(p.x, p.y, p.z);
    o.rotation.y = (p.rot * Math.PI) / 2;
    o.scale.set(p.sx, p.sy, p.sz);
    o.traverse((n) => (n.castShadow = false));
    group.add(o);
  }
  // Rolling hills and mountains on the horizon.
  const mound = keep(new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2));
  const peak = keep(new THREE.ConeGeometry(1, 1, 7, 1));
  peak.translate(0, 0.5, 0);
  const landMat = new Map<string, THREE.MeshStandardMaterial>();
  const land = (c: string) => landMat.get(c) ?? (landMat.set(c, keep(new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }))), landMat.get(c)!);
  for (const [x, z, rad, h, c] of scenery.hills) {
    const m = new THREE.Mesh(mound, land(c));
    m.position.set(x, -0.05, z);
    m.scale.set(rad, h, rad * 0.8);
    m.receiveShadow = true;
    group.add(m);
  }
  for (const [x, z, rad, h, c] of scenery.peaks) {
    const m = new THREE.Mesh(peak, land(c));
    m.position.set(x, -1, z);
    m.scale.set(rad, h, rad);
    m.rotation.y = x * 0.13;
    group.add(m);
  }
  // Props.
  const barrels: THREE.Object3D[] = [];
  const edges = new Map<string, PropPlacement[]>();
  for (const p of map.props) {
    if (p.edge) {
      const k = `${p.model}|${p.tint ?? ''}`;
      edges.set(k, [...(edges.get(k) ?? []), p]);
      continue;
    }
    // (Gritty clones always get their own materials; the geometry stays shared with the model cache.)
    const o = cloneModel(p.model, p.tint, 0.35);
    o.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) own.push(mat);
    });
    o.position.set(p.x, p.y, p.z);
    o.rotation.y = (p.rot * Math.PI) / 2;
    o.scale.set(p.sx, p.sy, p.sz);
    group.add(o);
    if (p.explosive) barrels.push(o);
  }
  // Boundary dressing: one instanced draw per model part (dozens of identical walls / fences).
  const mtx = new THREE.Matrix4();
  for (const list of edges.values()) {
    const tpl = cloneModel(list[0]!.model, list[0]!.tint, 0.35);
    tpl.updateMatrixWorld(true);
    tpl.traverse((n) => {
      const src = n as THREE.Mesh;
      if (!src.isMesh) return;
      const mat = keep(src.material as THREE.Material);
      const inst = keep(new THREE.InstancedMesh(src.geometry, mat, list.length));
      list.forEach((p, i) => {
        mtx.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (p.rot * Math.PI) / 2), new THREE.Vector3(p.sx, p.sy, p.sz));
        inst.setMatrixAt(i, mtx.multiply(src.matrixWorld));
      });
      inst.receiveShadow = true;
      group.add(inst);
    });
  }
  // Dusk / night: warm lamps glow in the buildings (emissive only, no extra lights).
  if (sky.lamps) {
    const geo = keep(new THREE.BoxGeometry(0.5, 0.12, 0.5));
    const mat = keep(new THREE.MeshStandardMaterial({ color: '#ffe2b0', emissive: '#ffb35a', emissiveIntensity: 3 }));
    const halo = keep(new THREE.SpriteMaterial({ map: keep(glowTexture()), color: '#ffb060', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
    for (const b of map.boxes) {
      // A lamp under every roof / slab big enough to be a room ceiling.
      if (b.hidden || b.mat === 'invisible' || b.y0 < 2.5 || b.y1 - b.y0 > 0.5 || (b.x1 - b.x0) * (b.z1 - b.z0) < 30) continue;
      const lamp = new THREE.Mesh(geo, mat);
      lamp.position.set((b.x0 + b.x1) / 2, b.y0 - 0.06, (b.z0 + b.z1) / 2);
      const s = new THREE.Sprite(halo);
      s.scale.setScalar(2.2);
      s.position.copy(lamp.position).y -= 0.15;
      group.add(lamp, s);
    }
  }
  // Domination flags.
  const flags = map.flags.map((f, i) => {
    const g = new THREE.Group();
    g.position.set(f.x, f.y, f.z);
    const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8)), keep(new THREE.MeshStandardMaterial({ color: '#d0d0d0', metalness: 0.8, roughness: 0.3 })));
    pole.position.y = 1.6;
    const cloth = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.1, 0.7, 8, 2)), keep(new THREE.MeshStandardMaterial({ color: '#dddddd', side: THREE.DoubleSide, emissive: '#000000' })));
    cloth.position.set(0.55, 2.75, 0);
    const ring = new THREE.Mesh(keep(new THREE.RingGeometry(3.3, 3.5, 48)), keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    g.add(pole, cloth, ring);
    g.userData.letter = 'ABC'[i];
    g.visible = false;
    group.add(g);
    return { group: g, cloth, ring };
  });
  scene.add(group);
  const dispose = () => {
    group.removeFromParent();
    for (const o of own) o.dispose();
    own.length = 0;
    sun.shadow.dispose();
  };
  return { group, sun, barrels, flags, dispose };
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------- vehicles for killstreaks

/** An attack helicopter built from primitives. */
export function makeHeli(team: 0 | 1): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: team === 0 ? '#3a4652' : '#5a5038', roughness: 0.6, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.5, metalness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: '#203040', roughness: 0.1, metalness: 0.9 });
  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 3.2, 6, 12), body);
  fus.rotation.z = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10), glass);
  nose.position.set(-2.1, 0.15, 0);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 4.5, 8), body);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(3.8, 0.3, 0);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.1), body);
  fin.position.set(5.8, 0.8, 0);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 3.6), dark);
  wing.position.set(-0.2, -0.3, 0);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.05, 0.3), dark);
  rotor.position.y = 1.15;
  rotor.name = 'rotor';
  const rotor2 = rotor.clone();
  rotor2.rotation.y = Math.PI / 2;
  rotor2.name = 'rotor';
  const tr = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 0.04), dark);
  tr.position.set(5.9, 0.9, 0.12);
  tr.name = 'tailrotor';
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), dark);
  gun.rotation.z = Math.PI / 2;
  gun.position.set(-2.4, -0.7, 0);
  g.add(fus, nose, tail, fin, wing, rotor, rotor2, tr, gun);
  g.traverse((n) => ((n as THREE.Mesh).isMesh ? (n.castShadow = true) : null));
  return g;
}

/** A fast jet for airstrikes. */
export function makeJet(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: '#5a636c', roughness: 0.4, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.7, 9, 10), m);
  body.rotation.z = Math.PI / 2;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 9), m);
  wing.position.x = 0.8;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.8, 0.12), m);
  tail.position.set(3.6, 0.8, 0);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.6) }));
  glow.position.x = 4.6;
  g.add(body, wing, tail, glow);
  return g;
}

/** Dog tag pickup (Kill Confirmed). */
export function makeTag(team: 0 | 1): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: team === 0 ? '#4a8cff' : '#ff5a4a', emissive: team === 0 ? '#1a3cff' : '#ff2a1a', emissiveIntensity: 0.8, metalness: 0.7, roughness: 0.3 });
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 0.02), m);
  const b = a.clone();
  b.rotation.z = 0.35;
  b.position.x = 0.06;
  g.add(a, b);
  return g;
}

// ---------------------------------------------------------------- killstreak hardware (front = −z)

/** RC-XD, recon drone, sentry gun, attack dog or the chopper gunner's gunship. */
export function makeUnit(kind: 'rcxd' | 'drone' | 'sentry' | 'dog' | 'gunner', team: 0 | 1): THREE.Group {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: team === 0 ? '#3a5a7a' : '#7a5a3a', roughness: 0.55, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: '#18191c', roughness: 0.6, metalness: 0.4 });
  const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  if (kind === 'rcxd') {
    box(0.42, 0.14, 0.72, paint, 0, 0.16, 0);
    box(0.3, 0.1, 0.3, new THREE.MeshStandardMaterial({ color: '#c8b070', roughness: 0.8 }), 0, 0.28, 0.08); // the charge
    for (const [x, z] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.26], [0.24, 0.26]] as Array<[number, number]>) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 12), dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.1, z);
      w.name = 'wheel';
      g.add(w);
    }
    box(0.02, 0.4, 0.02, dark, 0.14, 0.45, 0.25);
    const led = box(0.05, 0.05, 0.05, new THREE.MeshBasicMaterial({ color: '#ff2a1a' }), -0.12, 0.33, 0.2);
    led.name = 'led';
  } else if (kind === 'drone') {
    box(0.34, 0.12, 0.34, paint);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const arm = box(0.42, 0.04, 0.05, dark, Math.cos(a) * 0.21, 0, Math.sin(a) * 0.21);
      arm.rotation.y = -a;
      const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.01, 0.04), dark);
      rotor.position.set(Math.cos(a) * 0.42, 0.06, Math.sin(a) * 0.42);
      rotor.name = 'rotor';
      g.add(rotor);
    }
    const cam = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshStandardMaterial({ color: '#101820', roughness: 0.1, metalness: 0.9 }));
    cam.position.set(0, -0.1, -0.1);
    g.add(cam);
  } else if (kind === 'sentry') {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), dark);
      leg.position.set(Math.cos(a) * 0.25, 0.4, Math.sin(a) * 0.25);
      leg.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
      g.add(leg);
    }
    box(0.06, 0.3, 0.06, dark, 0, 0.85, 0);
    box(0.42, 0.32, 0.55, paint, 0, 1.05, 0);
    for (const x of [-0.08, 0.08]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), dark);
      b.rotation.x = Math.PI / 2;
      b.position.set(x, 1.05, -0.55);
      g.add(b);
    }
    box(0.3, 0.2, 0.08, new THREE.MeshStandardMaterial({ color: '#203040', roughness: 0.1, metalness: 0.9 }), 0, 1.2, -0.2);
  } else if (kind === 'dog') {
    const fur = new THREE.MeshStandardMaterial({ color: team === 0 ? '#3a3028' : '#5a4430', roughness: 0.95 });
    box(0.3, 0.3, 0.8, fur, 0, 0.62, 0.05);
    box(0.24, 0.24, 0.3, fur, 0, 0.82, -0.42);
    box(0.14, 0.12, 0.2, fur, 0, 0.74, -0.62);
    box(0.06, 0.12, 0.05, fur, -0.08, 0.98, -0.4);
    box(0.06, 0.12, 0.05, fur, 0.08, 0.98, -0.4);
    box(0.32, 0.08, 0.2, new THREE.MeshStandardMaterial({ color: team === 0 ? '#4aa3ff' : '#ff4a3a' }), 0, 0.8, -0.3); // vest collar
    for (const [x, z, i] of [[-0.1, -0.25, 0], [0.1, -0.25, 1], [-0.1, 0.35, 2], [0.1, 0.35, 3]] as Array<[number, number, number]>) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.5, z);
      leg.name = `leg${i}`;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), fur);
      m.position.y = -0.25;
      leg.add(m);
      g.add(leg);
    }
    const tail = box(0.05, 0.05, 0.3, fur, 0, 0.75, 0.55);
    tail.rotation.x = -0.6;
  } else {
    const heli = makeHeli(team);
    heli.rotation.y = -Math.PI / 2; // nose (−x) → −z
    g.add(heli);
  }
  g.traverse((n) => ((n as THREE.Mesh).isMesh ? (n.castShadow = true) : null));
  return g;
}
