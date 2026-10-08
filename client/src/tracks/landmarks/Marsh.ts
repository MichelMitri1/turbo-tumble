import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { placeSetPiece, roadClearance } from './placement';

const RADIUS = 30;
const YARD_X = 15;
const YARD_BACK = -14;
const YARD_FRONT = 11;
const FENCE_H = 2.4;
const MOON_R = 120;
const MOON_DIST = 800;
const MOON_HEIGHT = 215;
const LAP_WISPS = 14;
const YARD_WISPS = 8;
const LAMP = '#ffb860';
const PUMPKIN = '#ff7a1a';
const WISP = '#6affd8';
const GRAVES = ['gravestone-cross', 'gravestone-round', 'gravestone-bevel', 'gravestone-broken'];
const UP = new Vector3(0, 1, 0);

/**
 * Camera-facing additive glow quads, one draw call for all of them. Each instance's
 * translation places a glow, its scale sets the size and its colour the brightness.
 */
function glowField(count: number): InstancedMesh {
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vUv = uv;
        vColor = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #endif
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * length(instanceMatrix[0].xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - d), 2.2) * 0.8 + smoothstep(0.22, 0.0, d);
        gl_FragColor = vec4(vColor * a, a);
      }`,
  });
  const mesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

/** Instance a graveyard kit model at many (group-local) transforms: one draw call per sub-mesh. */
function instanceKit(ctx: BuildContext, name: string, height: number, at: Matrix4[], parent: Object3D): void {
  if (!at.length || !ctx.kits.has('graveyard', name)) return;
  const o = ctx.kits.instantiate('graveyard', name, height);
  o.updateMatrixWorld(true);
  const m = new Matrix4();
  o.traverse((c) => {
    const mesh = c as Mesh;
    if (!mesh.isMesh) return;
    const inst = new InstancedMesh(mesh.geometry, mesh.material, at.length);
    at.forEach((t, i) => inst.setMatrixAt(i, m.multiplyMatrices(t, mesh.matrixWorld)));
    inst.computeBoundingSphere();
    inst.castShadow = inst.receiveShadow = true;
    parent.add(inst);
  });
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Pale cratered moon face. */
function moonTexture(rng: SeededRandom): CanvasTexture {
  return canvasTexture(256, (g) => {
    const grad = g.createRadialGradient(110, 100, 10, 128, 128, 128);
    grad.addColorStop(0, '#fffdf2');
    grad.addColorStop(0.85, '#e8e6da');
    grad.addColorStop(1, '#cfd2d8');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 26; i++) {
      const r = rng.range(6, i < 5 ? 38 : 16);
      g.fillStyle = `rgba(150, 156, 175, ${rng.range(0.12, 0.3)})`;
      g.beginPath();
      g.arc(rng.range(30, 226), rng.range(30, 226), r, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function haloTexture(): CanvasTexture {
  return canvasTexture(128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.42, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
}

/** Ruined shack on stilts (local origin at ground, door facing +Z). */
function shackGeometry(rng: SeededRandom): { dark: BufferGeometry[]; planks: BufferGeometry[]; window: BufferGeometry[] } {
  const dark: BufferGeometry[] = [];
  const planks: BufferGeometry[] = [];
  const floorY = 3.6;
  for (const x of [-3.4, 0, 3.4]) for (const z of [-2.8, 2.8]) dark.push(new CylinderGeometry(0.22, 0.3, floorY + 0.8, 6).translate(x, (floorY + 0.8) / 2 - 0.8, z));
  planks.push(new BoxGeometry(8.2, 0.35, 6.8).translate(0, floorY, 0));
  // Walls: back, sides, front with a doorway; the right wall is broken off short.
  const wallH = 3.4;
  planks.push(new BoxGeometry(7.8, wallH, 0.25).translate(0, floorY + wallH / 2, -3.2));
  planks.push(new BoxGeometry(0.25, wallH, 6.4).translate(-3.9, floorY + wallH / 2, 0));
  planks.push(new BoxGeometry(0.25, wallH * 0.55, 6.4).translate(3.9, floorY + wallH * 0.27, 0));
  planks.push(new BoxGeometry(2.6, wallH, 0.25).translate(-2.6, floorY + wallH / 2, 3.2), new BoxGeometry(2.6, wallH, 0.25).translate(2.6, floorY + wallH / 2, 3.2));
  planks.push(new BoxGeometry(2.6, 0.9, 0.25).translate(0, floorY + wallH - 0.45, 3.2));
  // Sagging roof: one whole slab, one splintered and askew.
  planks.push(new BoxGeometry(5, 0.25, 7.6).rotateZ(0.55).translate(-2.1, floorY + wallH + 1.2, 0));
  planks.push(new BoxGeometry(3.4, 0.25, 4.6).rotateZ(-0.75).rotateX(0.12).translate(1.5, floorY + wallH + 0.9, -1.2));
  // Loose boards and a rickety ladder down to the bog.
  for (let i = 0; i < 4; i++) dark.push(new BoxGeometry(0.2, 1.4 + rng.range(0, 0.8), 0.6).rotateZ(rng.range(-0.3, 0.3)).translate(3.9, floorY + 2.2, -2 + i * 1.2));
  for (const x of [-0.6, 0.6]) dark.push(new BoxGeometry(0.15, 4.6, 0.15).rotateX(-0.45).translate(x, floorY / 2 - 0.2, 4.4));
  for (let r = 0; r < 5; r++) dark.push(new BoxGeometry(1.4, 0.12, 0.2).translate(0, r * 0.8 + 0.2, 5.2 - r * 0.34));
  const window = [new BoxGeometry(1.2, 1, 0.1).translate(-3.2 + 0.9, floorY + 2, -3.08), new BoxGeometry(0.1, 0.9, 1.1).translate(-4.05, floorY + 2, 0.8)];
  return { dark, planks, window };
}

function merge(list: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}

/**
 * Moonlit Marsh's haunted graveyard: crypts, crooked graves and pines behind an iron
 * fence, flickering lamps and grinning pumpkins, a ruined shack on stilts, a giant
 * full moon low over the horizon and will-o'-wisps drifting around the lap.
 */
export function buildMarshGraves(ctx: BuildContext, p: LandmarkPlacement): void {
  const { terrain } = ctx;
  const rng = new SeededRandom(ctx.def.terrain.seed + 404);
  buildMoon(ctx, rng);

  const glows: Array<{ pos: Vector3; size: number; color: Color; kind: 'lamp' | 'pumpkin' | 'wisp'; phase: number; drift: number }> = [];
  const spot = placeSetPiece(ctx, p, RADIUS);
  if (spot) {
    const g = new Group();
    g.name = 'marsh-graves';
    g.position.copy(spot.position);
    g.rotation.y = spot.yaw;
    g.updateMatrixWorld(true);
    const world = (x: number, z: number): Vector3 => g.localToWorld(new Vector3(x, 0, z));
    const groundAt = (x: number, z: number): number => {
      const w = world(x, z);
      return terrain.sample(w.x, w.z) - spot.position.y;
    };
    const props = new Map<string, Matrix4[]>();
    const sizes: Record<string, number> = {};
    const put = (name: string, height: number, x: number, z: number, yaw = 0, tiltX = 0, tiltZ = 0, sink = 0.1): void => {
      const list = props.get(name) ?? [];
      const q = new Quaternion().setFromAxisAngle(UP, yaw);
      if (tiltX || tiltZ) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tiltX)).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), tiltZ));
      list.push(new Matrix4().compose(new Vector3(x, groundAt(x, z) - sink, z), q, new Vector3(1, 1, 1)));
      props.set(name, list);
      sizes[name] = height;
    };
    const glowAt = (x: number, y: number, z: number, size: number, color: string, kind: 'lamp' | 'pumpkin' | 'wisp'): void => {
      const w = world(x, z);
      w.y = spot.position.y + groundAt(x, z) + y;
      glows.push({ pos: w, size, color: new Color(color), kind, phase: rng.range(0, 100), drift: 0 });
    };

    // Iron fence round the yard with a gateway facing the track.
    if (ctx.kits.has('graveyard', 'iron-fence')) {
      const size = ctx.kits.size('graveyard', 'iron-fence');
      const long = Math.max(size.x, size.z) * (FENCE_H / Math.max(0.01, size.y));
      const turn = size.z > size.x ? Math.PI / 2 : 0;
      const edge = (x0: number, z0: number, x1: number, z1: number, gate: boolean): void => {
        const len = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(1, Math.round(len / long));
        const yaw = Math.atan2(-(z1 - z0), x1 - x0) + turn;
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const x = x0 + (x1 - x0) * t;
          const z = z0 + (z1 - z0) * t;
          if (gate && Math.abs(x) < 3.2) continue;
          put('iron-fence', FENCE_H, x, z, yaw + (i % 3 === 1 ? 0.04 : 0), 0, i % 4 === 2 ? 0.08 : 0);
        }
      };
      edge(-YARD_X, YARD_FRONT, YARD_X, YARD_FRONT, true);
      edge(-YARD_X, YARD_BACK, YARD_X, YARD_BACK, false);
      edge(-YARD_X, YARD_BACK, -YARD_X, YARD_FRONT, false);
      edge(YARD_X, YARD_BACK, YARD_X, YARD_FRONT, false);
    }

    // Crypts at the back, rows of crooked graves either side of the path.
    put('crypt-large', 9, 0, -8.5, 0);
    put('crypt', 6.5, -10, -9, 0.35);
    put('crypt', 6.5, 10, -9, -0.35);
    put('urn-round', 1.6, -3.6, -3.4);
    put('urn-round', 1.6, 3.6, -3.4);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        const x = (col < 3 ? -12 : 4.2) + (col % 3) * 3.9 + rng.range(-0.5, 0.5);
        const z = -2 + row * 4.2 + rng.range(-0.4, 0.4);
        if (rng.chance(0.12)) continue;
        put(rng.pick(GRAVES), rng.range(1.7, 2.6), x, z, rng.range(-0.25, 0.25), rng.range(-0.12, 0.12), rng.range(-0.14, 0.14), 0.25);
      }
    }
    put('cross-column', 4.5, -6, -4.5, 0.2, 0.05, -0.06);

    // Lamps: double posts at the gate, single posts at the corners, glass lanterns along the path.
    for (const s of [-1, 1]) {
      put('lightpost-double', 6, s * 4.4, YARD_FRONT + 0.6, 0);
      glowAt(s * 4.4 - 1.1, 5.6, YARD_FRONT + 0.6, 8, LAMP, 'lamp');
      glowAt(s * 4.4 + 1.1, 5.6, YARD_FRONT + 0.6, 8, LAMP, 'lamp');
      put('lightpost-single', 5, s * (YARD_X - 1), YARD_BACK + 1.2, 0);
      glowAt(s * (YARD_X - 1), 4.7, YARD_BACK + 1.2, 7, LAMP, 'lamp');
    }
    for (const z of [-1, 4, 8]) {
      put('lantern-glass', 1.1, 1.6, z, rng.range(0, 3));
      glowAt(1.6, 0.6, z, 3.6, LAMP, 'lamp');
    }
    put('fire-basket', 2, -3, YARD_FRONT + 2.2);
    glowAt(-3, 2.1, YARD_FRONT + 2.2, 6.5, '#ff8a2a', 'lamp');

    // Glowing pumpkins at the gate and among the graves.
    const pumpkins: Array<[string, number, number, number]> = [
      ['pumpkin-carved', 1.3, 6.8, YARD_FRONT + 2.2],
      ['pumpkin-tall-carved', 1.6, 8.2, YARD_FRONT + 1.4],
      ['pumpkin-carved', 1.2, -7.4, YARD_FRONT + 2],
      ['pumpkin-carved', 1.1, -9, 1.5],
      ['pumpkin-tall-carved', 1.5, 9.6, 5.6],
      ['pumpkin-carved', 1.2, -2.6, -5],
    ];
    for (const [name, h, x, z] of pumpkins) {
      put(name, h, x, z, Math.PI + rng.range(-0.5, 0.5), 0, 0, 0.05);
      glowAt(x, h * 0.5, z, h * 3.6, PUMPKIN, 'pumpkin');
    }

    // Crooked dead pines and fallen ones round the fence.
    const pines: Array<[number, number, number]> = [
      [-YARD_X - 5, YARD_BACK + 2, 16],
      [YARD_X + 4, YARD_BACK - 2, 14],
      [-4, YARD_BACK - 6, 18],
      [YARD_X + 6, 4, 12],
      [8, YARD_BACK - 5, 13],
    ];
    for (const [x, z, h] of pines) put('pine-crooked', h, x, z, rng.range(0, 6.28), rng.range(-0.08, 0.08), rng.range(-0.1, 0.1));
    put('pine-fall-crooked', 9, -YARD_X - 4, 6, 1.2);
    put('pine-fall-crooked', 8, YARD_X + 7, -9, -0.6);
    put('trunk-long', 3, 13, YARD_FRONT + 4, 0.9);
    put('debris-wood', 1.2, -12, YARD_FRONT + 3, 0.4);
    put('rocks-tall', 4, -YARD_X - 8, -4, 0.3);

    for (const [name, list] of props) instanceKit(ctx, name, sizes[name] ?? 2, list, g);

    // Shack on stilts beside the yard, slightly askew.
    const shack = shackGeometry(rng);
    const shackGroup = new Group();
    const sx = -YARD_X - 11;
    const sz = -6;
    shackGroup.position.set(sx, groundAt(sx, sz) - 0.6, sz);
    shackGroup.rotation.set(0.03, 0.5, -0.05);
    shackGroup.add(new Mesh(merge(shack.dark), TrackMaterials.paint('#3a2e26')), new Mesh(merge(shack.planks), TrackMaterials.paint('#5c4a3a')));
    shackGroup.add(new Mesh(merge(shack.window), TrackMaterials.emissive('#c8ff7a', 1.4)));
    g.add(shackGroup);
    shackGroup.updateMatrixWorld(true);
    const lit = shackGroup.localToWorld(new Vector3(-2.3, 5.6, -3.3));
    glows.push({ pos: lit, size: 3.5, color: new Color('#b8ff6a'), kind: 'lamp', phase: 3, drift: 0 });

    // Low mist pooling between the graves.
    const mistMat = new MeshBasicMaterial({ map: haloTexture(), color: '#8aa8e8', transparent: true, opacity: 0.32, depthWrite: false });
    const mists: Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const m = new Mesh(new CircleGeometry(10 + i * 2, 20), mistMat);
      m.rotation.x = -Math.PI / 2;
      const x = -8 + i * 6;
      const z = -4 + (i % 2) * 8;
      m.position.set(x, groundAt(x, z) + 0.6 + i * 0.15, z);
      mists.push(m);
      g.add(m);
    }
    g.traverse((o) => {
      if ((o as Mesh).isMesh && !mists.includes(o as Mesh)) o.castShadow = o.receiveShadow = true;
    });
    ctx.add(g);
    ctx.updatables.push({ update: (_dt, time) => mists.forEach((m, i) => (m.rotation.z = time * 0.03 * (i % 2 ? 1 : -1))) });

    for (let i = 0; i < YARD_WISPS; i++) {
      const x = rng.range(-YARD_X - 6, YARD_X + 6);
      const z = rng.range(YARD_BACK - 4, YARD_FRONT);
      glowAt(x, rng.range(1.5, 4.5), z, 4, WISP, 'wisp');
      glows[glows.length - 1]!.drift = rng.range(2, 5);
    }
  }

  // Will-o'-wisps hovering just off the road round the lap.
  const samples = ctx.path.samples;
  for (let i = 0; i < LAP_WISPS; i++) {
    const s = samples[Math.floor(((i + rng.next() * 0.5) / LAP_WISPS) * samples.length) % samples.length]!;
    const side = rng.chance(0.5) ? 1 : -1;
    const pos = s.position.clone().addScaledVector(s.flatRight, side * (s.wallOffset + rng.range(5, 16)));
    if (roadClearance(ctx, pos.x, pos.z) < 3) continue;
    pos.y = terrain.sample(pos.x, pos.z) + rng.range(1.8, 4);
    glows.push({ pos, size: 4.2, color: new Color(i % 3 ? WISP : '#7ad8ff'), kind: 'wisp', phase: rng.range(0, 100), drift: rng.range(2, 4) });
  }

  if (!glows.length) return;
  const field = glowField(glows.length);
  ctx.add(field);
  const m = new Matrix4();
  const q = new Quaternion();
  const pos = new Vector3();
  const scale = new Vector3();
  const c = new Color();
  const update = (time: number): void => {
    glows.forEach((gl, i) => {
      let k = 1;
      pos.copy(gl.pos);
      if (gl.kind === 'lamp') k = 0.75 + 0.25 * Math.sin(time * 13 + gl.phase) * Math.sin(time * 7.3 + gl.phase * 2) + (Math.sin(time * 2.1 + gl.phase) > 0.93 ? -0.4 : 0);
      else if (gl.kind === 'pumpkin') k = 0.8 + 0.2 * Math.sin(time * 9 + gl.phase);
      else {
        const t = time * 0.4 + gl.phase;
        pos.x += Math.sin(t) * gl.drift;
        pos.z += Math.cos(t * 0.8) * gl.drift;
        pos.y += Math.sin(t * 2.3) * 0.8;
        k = 0.75 + 0.25 * Math.sin(time * 3 + gl.phase);
      }
      m.compose(pos, q, scale.setScalar(gl.size * (0.85 + 0.15 * k)));
      field.setMatrixAt(i, m);
      field.setColorAt(i, c.copy(gl.color).multiplyScalar(k));
    });
    field.instanceMatrix.needsUpdate = true;
    if (field.instanceColor) field.instanceColor.needsUpdate = true;
  };
  update(0);
  ctx.updatables.push({ update: (_dt, time) => update(time) });
}

/** A giant full moon with a soft halo, low over the horizon towards the night light. */
function buildMoon(ctx: BuildContext, rng: SeededRandom): void {
  const { terrain } = ctx;
  const [lx, , lz] = ctx.def.lighting.sunDirection;
  const len = Math.hypot(lx, lz) || 1;
  const mountains = ctx.def.decor.landmarks.find((l) => l.type === 'mountains');
  const dist = Math.max(MOON_DIST, Number(mountains?.params?.radius ?? 0) + 260);
  const pos = new Vector3(terrain.centerX + (lx / len) * dist, terrain.def.baseHeight + MOON_HEIGHT, terrain.centerZ + (lz / len) * dist);
  const facing = new Vector3(terrain.centerX, pos.y - 40, terrain.centerZ);
  const moon = new Mesh(new CircleGeometry(MOON_R, 48), new MeshBasicMaterial({ map: moonTexture(rng), color: new Color('#ffffff').multiplyScalar(1.15), fog: false }));
  moon.name = 'marsh-moon';
  moon.position.copy(pos);
  moon.lookAt(facing);
  const halo = new Mesh(
    new CircleGeometry(MOON_R * 2.6, 40),
    new MeshBasicMaterial({ map: haloTexture(), color: '#9ab4ff', transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending, fog: false }),
  );
  halo.position.copy(pos).addScaledVector(facing.clone().sub(pos).normalize(), -4);
  halo.lookAt(facing);
  ctx.add(moon);
  ctx.add(halo);
}
