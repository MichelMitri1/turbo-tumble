import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Box, Material } from '../sim/level';
import type { MapDef } from '../sim/maps';
import { TILE, texture } from './textures';
import { cloneModel } from './assets';
import { backdrop } from './backdrop';

const SKY: Record<MapDef['theme']['sky'], { top: string; mid: string; bottom: string; sun: string; sunI: number; hemi: number; exposure: number }> = {
  day: { top: '#2f6fbf', mid: '#8fbde8', bottom: '#dfe8ee', sun: '#fff4e0', sunI: 2.3, hemi: 2.3, exposure: 1.0 },
  dusk: { top: '#2a3b6a', mid: '#d88a58', bottom: '#f2c48a', sun: '#ffc890', sunI: 2.1, hemi: 1.9, exposure: 1.05 },
  overcast: { top: '#6c7684', mid: '#a3abb5', bottom: '#c3c8cd', sun: '#e8eef4', sunI: 1.2, hemi: 2.6, exposure: 1.0 },
  night: { top: '#05070f', mid: '#141c33', bottom: '#2a3350', sun: '#9fb4ff', sunI: 0.6, hemi: 0.9, exposure: 1.2 },
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
}

export function buildMap(scene: THREE.Scene, renderer: THREE.WebGLRenderer, map: MapDef): MapView {
  const group = new THREE.Group();
  const sky = SKY[map.theme.sky];
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
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), skyMat);
  skyMesh.renderOrder = -1;
  group.add(skyMesh);
  scene.fog = new THREE.Fog(map.theme.fog[0], map.theme.fog[1], map.theme.fog[2]);
  scene.background = new THREE.Color(sky.bottom);
  // Lights.
  // Strong sky fill so shade and interiors stay readable (bounce light).
  group.add(new THREE.HemisphereLight(sky.mid, '#7a6e5c', sky.hemi));
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
  // Ground.
  const ground = texture(map.theme.ground);
  const gt = ground.clone();
  gt.repeat.set(1400 / TILE[map.theme.ground], 1400 / TILE[map.theme.ground]);
  gt.needsUpdate = true;
  const gm = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.95 }));
  gm.rotation.x = -Math.PI / 2;
  gm.receiveShadow = true;
  group.add(gm);
  map.theme.patches.forEach(([x0, z0, x1, z1, mat], i) => {
    const t = texture(mat).clone();
    t.repeat.set((x1 - x0) / TILE[mat], (z1 - z0) / TILE[mat]);
    t.needsUpdate = true;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 - i, polygonOffsetUnits: -1 - i }));
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
  const ROUGH: Partial<Record<Material, number>> = { metal: 0.6, marble: 0.3, glass: 0.15, darkwood: 0.6, paint: 0.7 };
  for (const { mat, tint, geos } of byMat.values()) {
    const geo = mergeGeometries(geos);
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: texture(mat), color: tint ? new THREE.Color(tint) : 0xffffff, roughness: ROUGH[mat] ?? 0.9, metalness: mat === 'metal' ? 0.08 : mat === 'glass' ? 0.2 : 0 }),
    );
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  for (const p of scenery.props) {
    const o = cloneModel(p.model, p.tint, 0.35);
    o.position.set(p.x, p.y, p.z);
    o.rotation.y = (p.rot * Math.PI) / 2;
    o.scale.set(p.sx, p.sy, p.sz);
    o.traverse((n) => (n.castShadow = false));
    group.add(o);
  }
  // Rolling hills and mountains on the horizon.
  const mound = new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  const peak = new THREE.ConeGeometry(1, 1, 7, 1);
  peak.translate(0, 0.5, 0);
  const landMat = new Map<string, THREE.MeshStandardMaterial>();
  const land = (c: string) => landMat.get(c) ?? (landMat.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true })), landMat.get(c)!);
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
  for (const p of map.props) {
    const o = cloneModel(p.model, p.tint, 0.35);
    o.position.set(p.x, p.y, p.z);
    o.rotation.y = (p.rot * Math.PI) / 2;
    o.scale.set(p.sx, p.sy, p.sz);
    group.add(o);
    if (p.explosive) barrels.push(o);
  }
  // Domination flags.
  const flags = map.flags.map((f, i) => {
    const g = new THREE.Group();
    g.position.set(f.x, f.y, f.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8), new THREE.MeshStandardMaterial({ color: '#d0d0d0', metalness: 0.8, roughness: 0.3 }));
    pole.position.y = 1.6;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7, 8, 2), new THREE.MeshStandardMaterial({ color: '#dddddd', side: THREE.DoubleSide, emissive: '#000000' }));
    cloth.position.set(0.55, 2.75, 0);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.3, 3.5, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    g.add(pole, cloth, ring);
    g.userData.letter = 'ABC'[i];
    g.visible = false;
    group.add(g);
    return { group: g, cloth, ring };
  });
  scene.add(group);
  return { group, sun, barrels, flags };
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
