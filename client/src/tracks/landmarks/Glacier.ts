import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { roadClearance } from './placement';

const CLUSTERS: [number, number] = [10, 14];
const NEAR = 40;
const FAR = 250;
const BASE_COLOR = new Color('#4aa4ec');
const TIP_COLOR = new Color('#eafcff');
const AURORA_RIBBONS = 4;
const AURORA_SEGMENTS = 120;

/** A faceted ice prism with a pointed tip, base at the origin, coloured deep blue → white. */
function prism(r: number, h: number, sides: number): BufferGeometry {
  const body = new CylinderGeometry(r * 0.72, r, h * 0.76, sides, 1).translate(0, h * 0.38, 0);
  const tip = new ConeGeometry(r * 0.72, h * 0.24, sides).translate(0, h * 0.88, 0);
  const g = mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()])!;
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(BASE_COLOR).lerp(TIP_COLOR, Math.min(1, Math.max(0, pos.getY(i) / h)) ** 1.4);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

/** Aurora curtain: an undulating, additive ribbon, green at its bright lower hem fading to purple. */
function auroraMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { time: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    vertexShader: /* glsl */ `
      uniform float time;
      attribute float phase;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        float sway = sin(uv.x * 11.0 + time * 0.35 + phase) * 22.0 + sin(uv.x * 27.0 - time * 0.6 + phase * 2.0) * 7.0;
        p.z += sway * (0.6 + uv.y * 0.6);
        p.y += sin(uv.x * 7.0 + time * 0.25 + phase) * 10.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      varying vec2 vUv;
      void main() {
        float v = vUv.y;
        vec3 green = vec3(0.25, 1.0, 0.55);
        vec3 teal = vec3(0.1, 0.85, 0.95);
        vec3 purple = vec3(0.65, 0.3, 1.0);
        vec3 col = mix(green, teal, smoothstep(0.05, 0.5, v));
        col = mix(col, purple, smoothstep(0.45, 1.0, v));
        float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
        float rays = 0.55 + 0.45 * sin(vUv.x * 170.0 + time * 0.7 + sin(vUv.x * 23.0 + time * 0.3) * 3.0);
        float pulse = 0.75 + 0.25 * sin(vUv.x * 9.0 - time * 0.5);
        float a = smoothstep(0.0, 0.07, v) * pow(1.0 - v, 1.4) * edge * rays * pulse * 1.1;
        gl_FragColor = vec4(col * a, a);
      }`,
  });
}

/** A curved curtain `length` long and `height` tall, its base along the local x axis. */
function auroraRibbon(length: number, height: number, bend: number, phase: number): BufferGeometry {
  const n = AURORA_SEGMENTS;
  const pos: number[] = [];
  const uv: number[] = [];
  const phases: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = (u - 0.5) * length;
    const z = Math.sin(u * Math.PI * 1.6 + phase) * bend;
    pos.push(x, 0, z, x, height, z + bend * 0.12);
    uv.push(u, 0, u, 1);
    phases.push(phase, phase);
    if (i < n) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('phase', new Float32BufferAttribute(phases, 1));
  g.setIndex(index);
  return g;
}

/**
 * Glacier Gauntlet: clusters of giant translucent ice crystals beside the lap,
 * icebergs bobbing on the frozen lakes and an aurora rippling across the sky.
 */
export function buildIceSpires(ctx: BuildContext, p: LandmarkPlacement): void {
  const { terrain, path } = ctx;
  const rng = new SeededRandom(ctx.def.terrain.seed + 515);
  const half = terrain.def.size / 2 - 30;
  const want = Number(p.params?.count ?? rng.int(CLUSTERS[0], CLUSTERS[1]));

  // Crystal clusters: a tall spire ringed by leaning satellites and shards.
  const shells: BufferGeometry[] = [];
  const cores: BufferGeometry[] = [];
  const m = new Matrix4();
  const tilt = new Matrix4();
  let placed = 0;
  for (let attempt = 0; attempt < 600 && placed < want; attempt++) {
    const s = path.samples[rng.int(0, path.samples.length - 1)]!;
    const side = rng.chance(0.5) ? 1 : -1;
    const out = NEAR + Math.pow(rng.next(), 1.6) * (FAR - NEAR);
    const height = rng.range(15, 60);
    const radius = height * 0.32 + 4;
    const x = s.position.x + s.flatRight.x * side * (s.wallOffset + out);
    const z = s.position.z + s.flatRight.z * side * (s.wallOffset + out);
    if (Math.abs(x - terrain.centerX) > half || Math.abs(z - terrain.centerZ) > half) continue;
    if (roadClearance(ctx, x, z) < Math.max(NEAR * 0.8, radius + 8)) continue;
    if (terrain.isUnderwater(x, z, 0.5)) continue;
    if (ctx.footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + radius)) continue;
    ctx.footprints.push({ x, z, r: radius });
    placed++;

    const parts: Array<{ ox: number; oz: number; h: number; lean: number; dir: number }> = [{ ox: 0, oz: 0, h: height, lean: rng.range(0, 0.08), dir: rng.range(0, 6.28) }];
    const sats = rng.int(3, 6);
    for (let k = 0; k < sats; k++) {
      const a = (k / sats) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const d = height * rng.range(0.08, 0.16);
      parts.push({ ox: Math.cos(a) * d, oz: Math.sin(a) * d, h: height * rng.range(0.3, 0.68), lean: rng.range(0.18, 0.5), dir: a });
    }
    for (let k = 0; k < 4; k++) {
      const a = rng.range(0, 6.28);
      const d = height * rng.range(0.18, 0.3);
      parts.push({ ox: Math.cos(a) * d, oz: Math.sin(a) * d, h: rng.range(3, 7), lean: rng.range(0.3, 0.7), dir: a });
    }
    for (const part of parts) {
      const r = part.h * rng.range(0.12, 0.16);
      const sides = rng.int(5, 8);
      const px = x + part.ox;
      const pz = z + part.oz;
      // Lean outward from the cluster centre, sunk into the snow.
      tilt.makeRotationAxis(new Vector3(Math.sin(part.dir), 0, -Math.cos(part.dir)), part.lean);
      m.makeRotationY(rng.range(0, 6.28)).premultiply(tilt).setPosition(px, terrain.sample(px, pz) - 1.5 - r * 0.3, pz);
      shells.push(prism(r, part.h, sides).applyMatrix4(m));
      if (part.h > 10) cores.push(prism(r * 0.5, part.h * 0.82, sides).applyMatrix4(m));
    }
  }
  if (shells.length) {
    const shell = new Mesh(
      mergeGeometries(shells)!,
      new MeshStandardMaterial({ vertexColors: true, emissive: '#3a9ee0', emissiveIntensity: 0.45, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.82, flatShading: true }),
    );
    shell.name = 'ice-spires';
    shell.castShadow = true;
    const core = new Mesh(mergeGeometries(cores)!, new MeshStandardMaterial({ color: '#f0fcff', emissive: '#8ae0ff', emissiveIntensity: 0.7, roughness: 0.2, flatShading: true }));
    core.renderOrder = -1;
    ctx.add(core);
    ctx.add(shell);
  }

  // Icebergs drifting on the lakes.
  const water = ctx.def.terrain.waterLevel;
  if (water !== null) {
    const bergs: BufferGeometry[] = [];
    for (const lake of ctx.def.terrain.lakes.slice(0, 5)) {
      const n = rng.int(1, 3);
      let made = 0;
      for (let k = 0; k < n * 6 && made < n; k++) {
        const a = rng.range(0, 6.28);
        const e = rng.range(0, 0.6);
        const bx = lake.x + Math.cos(a) * lake.radiusX * e;
        const bz = lake.z + Math.sin(a) * lake.radiusZ * e;
        const r = Math.min(lake.radiusX, lake.radiusZ) * rng.range(0.08, 0.16) + 2;
        if (terrain.sample(bx, bz) > water - 1.2 || roadClearance(ctx, bx, bz) < r + 4) continue;
        const berg = rng.chance(0.4) ? new ConeGeometry(r * 0.8, r * 1.8, rng.int(5, 7), 1).translate(0, r * 0.6, 0).toNonIndexed() : new IcosahedronGeometry(r, 0);
        const pos = berg.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          pos.setXYZ(i, pos.getX(i) * rng.range(0.9, 1.15), y < 0 ? y * 0.3 : y * rng.range(0.6, 1), pos.getZ(i) * rng.range(0.9, 1.15));
        }
        berg.deleteAttribute('uv');
        berg.computeVertexNormals();
        bergs.push(berg.rotateY(rng.range(0, 6.28)).translate(bx, water - 0.4, bz));
        made++;
      }
    }
    if (bergs.length) {
      const mesh = new Mesh(mergeGeometries(bergs.map((b) => (b.index ? b.toNonIndexed() : b)))!, new MeshStandardMaterial({ color: '#eef9ff', emissive: '#6ab8e8', emissiveIntensity: 0.25, roughness: 0.35, flatShading: true }));
      mesh.name = 'icebergs';
      mesh.castShadow = mesh.receiveShadow = true;
      ctx.add(mesh);
      ctx.updatables.push({ update: (_dt, time) => (mesh.position.y = Math.sin(time * 0.6) * 0.25) });
    }
  }

  // Aurora curtains ringing the sky.
  const mat = auroraMaterial();
  const start = rng.range(0, Math.PI * 2);
  for (let k = 0; k < AURORA_RIBBONS; k++) {
    const angle = start + (k / AURORA_RIBBONS) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const dist = rng.range(600, 780);
    const ribbon = new Mesh(auroraRibbon(rng.range(600, 900), rng.range(120, 170), rng.range(50, 110), rng.range(0, 6.28)), mat);
    ribbon.name = `aurora-${k}`;
    ribbon.position.set(terrain.centerX + Math.cos(angle) * dist, terrain.def.baseHeight + rng.range(100, 130), terrain.centerZ + Math.sin(angle) * dist);
    ribbon.rotation.y = -angle + Math.PI / 2 + rng.range(-0.35, 0.35);
    ribbon.frustumCulled = false;
    ribbon.renderOrder = 3;
    ctx.add(ribbon);
  }
  ctx.updatables.push({ update: (_dt, time) => (mat.uniforms.time!.value = time) });
}
