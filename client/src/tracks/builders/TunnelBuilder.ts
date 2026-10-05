import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { extrudeAlongPath, type ProfilePoint } from '@shared/track/Extrude';
import { buildTunnelKerbs } from '@shared/track/TrackGeometry';
import type { TrackSample } from '@shared/track/TrackPath';
import { Noise2D } from '@shared/math/noise';
import { clamp, smoothstep } from '@shared/math/scalar';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { toGeometry } from '../../rendering/meshData';
import { sampleQuaternion } from '../frames';

const EXTEND = 2;
const WALL_HEIGHT = 4.6;
const ARCH_RISE = 4.8;
const SHELL_SPREAD = 23;
const SHELL_TOP = 16;
const ARCH_SEGMENTS = 12;
const SHELL_SEGMENTS = 20;

/** Inner arch, ordered left → over the top → right. */
function innerProfile(s: TrackSample): ProfilePoint[] {
  const w = s.wallOffset;
  const pts: ProfilePoint[] = [{ x: -w, y: -1 }];
  for (let i = 0; i <= ARCH_SEGMENTS; i++) {
    const a = Math.PI - (i / ARCH_SEGMENTS) * Math.PI;
    pts.push({ x: Math.cos(a) * w, y: WALL_HEIGHT + Math.sin(a) * ARCH_RISE });
  }
  pts.push({ x: w, y: -1 });
  return pts;
}

/** Rocky hill over the tunnel, ordered left → right. */
function shellProfile(s: TrackSample, noise: Noise2D): ProfilePoint[] {
  const W = s.wallOffset + SHELL_SPREAD;
  const pts: ProfilePoint[] = [];
  for (let i = 0; i <= SHELL_SEGMENTS; i++) {
    const f = i / SHELL_SEGMENTS;
    const x = -W + f * W * 2;
    const bump = Math.pow(0.5 + 0.5 * Math.cos((Math.PI * x) / W), 0.75);
    const rough = noise.noise(s.distance * 0.07, f * 6) * 1.6 * bump;
    pts.push({ x, y: -2.5 + (SHELL_TOP + 2.5) * bump + rough });
  }
  return pts;
}

export function buildTunnels(ctx: BuildContext): void {
  const { path } = ctx;
  const noise = new Noise2D(ctx.def.terrain.seed + 7);
  for (const run of path.runs((s) => s.kind === 'tunnel')) buildTunnel(ctx, run, noise);
}

function buildTunnel(ctx: BuildContext, run: [number, number], noise: Noise2D): void {
  const { path } = ctx;
  const n = path.samples.length;
  const idx = path.runIndices([(run[0] - EXTEND + n) % n, (run[1] + EXTEND) % n]);

  // Inner tube (faces inward).
  const inner = extrudeAlongPath(path, idx, innerProfile, { frame: 'flat', flip: true, vScale: 6 });
  for (let i = 0; i < inner.uvs.length; i += 2) inner.uvs[i]! /= 6;
  const tube = new Mesh(toGeometry(inner), TrackMaterials.tunnelInner());
  tube.name = 'tunnel-inner';
  tube.receiveShadow = true;
  tube.castShadow = true;
  ctx.add(tube);

  // Concrete kerbs from the road edge to the walls (collider built in shared code).
  const walk = buildTunnelKerbs(path, EXTEND);
  if (walk) {
    const walkMesh = new Mesh(toGeometry(walk), TrackMaterials.paint('#6f6a66'));
    walkMesh.name = 'tunnel-kerb';
    walkMesh.receiveShadow = true;
    ctx.add(walkMesh);
  }

  // Outer shell with grass-on-top / rock-on-sides vertex colours.
  const shellData = extrudeAlongPath(path, idx, (s) => shellProfile(s, noise), { frame: 'flat' });
  const shellGeo = toGeometry(shellData);
  colorShell(shellGeo, ctx.def.terrain.palette.grassA, ctx.def.terrain.palette.rock, noise);
  const shell = new Mesh(shellGeo, TrackMaterials.shell());
  shell.name = 'tunnel-shell';
  shell.castShadow = true;
  shell.receiveShadow = true;
  ctx.add(shell);

  // Portal faces at both ends.
  ctx.add(buildPortal(path.samples[idx[0]!]!, noise, -1));
  ctx.add(buildPortal(path.samples[idx[idx.length - 1]!]!, noise, 1));

  // Ceiling lamps.
  const lamps: Matrix4[] = [];
  const q = new Quaternion();
  const p = new Vector3();
  const sc = new Vector3(0.5, 0.18, 2.4);
  idx.forEach((i, k) => {
    if (k % 4 !== 0) return;
    const s = path.samples[i]!;
    sampleQuaternion(s, false, q);
    for (const side of [-1, 1]) {
      p.copy(s.position).addScaledVector(s.flatRight, side * 3.2);
      p.y += WALL_HEIGHT + Math.sqrt(Math.max(0, 1 - (3.2 / s.wallOffset) ** 2)) * ARCH_RISE - 0.25;
      lamps.push(new Matrix4().compose(p, q, sc));
    }
  });
  const lampMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), TrackMaterials.emissive('#ffd98a', 3), lamps.length);
  lamps.forEach((mm, i) => lampMesh.setMatrixAt(i, mm));
  lampMesh.computeBoundingSphere();
  lampMesh.name = 'tunnel-lamps';
  ctx.add(lampMesh);

  // No trees growing through the hill.
  for (const i of idx) {
    if (i % 4 !== 0) continue;
    const s = path.samples[i]!;
    ctx.footprints.push({ x: s.position.x, z: s.position.z, r: s.wallOffset + SHELL_SPREAD * 0.8 });
  }
}

function colorShell(geo: BufferGeometry, grassHex: string, rockHex: string, noise: Noise2D): void {
  const grass = new Color(grassHex);
  const rock = new Color(rockHex);
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const flat = nrm.getY(i);
    const n = noise.noise(pos.getX(i) * 0.08, pos.getZ(i) * 0.08);
    c.copy(rock).lerp(grass, smoothstep(0.55, 0.85, flat + n * 0.15));
    c.offsetHSL(0, 0, n * 0.04);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
}

/**
 * Portal: a stone facade filling the hill cross-section, a protruding arch ring
 * framing the opening and a bright keystone. `outward` (+1/-1) points away from
 * the tunnel along the track tangent.
 */
function buildPortal(s: TrackSample, noise: Noise2D, outward: number): Group {
  const g = new Group();
  g.name = 'tunnel-portal';
  const toWorld = (x: number, y: number, along = 0): Vector3 =>
    s.position.clone().addScaledVector(s.flatRight, x).addScaledVector(s.tangent, along * outward).setY(s.position.y + y);

  // Facade between the arch and the hill outline.
  const count = 40;
  const a = resample(innerProfile(s), count);
  const b = resample(shellProfile(s, noise), count);
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i < count; i++) {
    for (const q of [a[i]!, b[i]!]) {
      const v = toWorld(q.x, q.y);
      positions.push(v.x, v.y, v.z);
      uvs.push(q.x / 5, q.y / 5);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    const a0 = i * 2;
    index.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
  }
  const facade = new BufferGeometry();
  facade.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  facade.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  facade.setIndex(index);
  facade.computeVertexNormals();
  g.add(new Mesh(facade, TrackMaterials.stone()));

  // Arch ring: box-section sweep around the opening, protruding from the facade.
  const arch = resample(innerProfile(s).slice(1, -1), 28);
  const ringPos: number[] = [];
  const ringIdx: number[] = [];
  const thick = 1.3;
  const depth = 0.8;
  arch.forEach((q, i) => {
    const len = Math.hypot(q.x, q.y - WALL_HEIGHT) || 1;
    const nx = q.y > WALL_HEIGHT ? q.x / len : Math.sign(q.x);
    const ny = q.y > WALL_HEIGHT ? (q.y - WALL_HEIGHT) / len : 0;
    const corners = [
      toWorld(q.x, q.y, -0.1),
      toWorld(q.x + nx * thick, q.y + ny * thick, -0.1),
      toWorld(q.x + nx * thick, q.y + ny * thick, depth),
      toWorld(q.x, q.y, depth),
    ];
    corners.forEach((v) => ringPos.push(v.x, v.y, v.z));
    if (i > 0) {
      const p0 = (i - 1) * 4;
      const p1 = i * 4;
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        ringIdx.push(p0 + k, p1 + k, p0 + k2, p0 + k2, p1 + k, p1 + k2);
      }
    }
  });
  const ring = new BufferGeometry();
  ring.setAttribute('position', new BufferAttribute(new Float32Array(ringPos), 3));
  ring.setIndex(ringIdx);
  ring.computeVertexNormals();
  g.add(new Mesh(ring, TrackMaterials.paint('#d8b98f')));

  const key = new Mesh(new BoxGeometry(1.8, 2.0, depth + 0.5), TrackMaterials.paint('#ffd23f'));
  key.position.copy(toWorld(0, WALL_HEIGHT + ARCH_RISE + 0.75, depth / 2));
  key.quaternion.copy(sampleQuaternion(s, false));
  g.add(key);

  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return g;
}

/** Resample a polyline to `count` points evenly by length. */
function resample(pts: ProfilePoint[], count: number): ProfilePoint[] {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  const total = lens[lens.length - 1]!;
  const out: ProfilePoint[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const d = (k / (count - 1)) * total;
    while (seg < pts.length - 2 && lens[seg + 1]! < d) seg++;
    const t = clamp((d - lens[seg]!) / Math.max(1e-6, lens[seg + 1]! - lens[seg]!), 0, 1);
    out.push({ x: pts[seg]!.x + (pts[seg + 1]!.x - pts[seg]!.x) * t, y: pts[seg]!.y + (pts[seg + 1]!.y - pts[seg]!.y) * t });
  }
  return out;
}
