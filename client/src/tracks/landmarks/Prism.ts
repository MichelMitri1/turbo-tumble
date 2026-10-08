import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';

const SPECTRUM = ['#ff3a5a', '#ff8a2a', '#ffe23a', '#3aff7a', '#3ad8ff', '#5a6aff', '#c25aff'];

/** A triangular prism (equilateral cross-section, `side` wide, `height` tall). */
function prismGeometry(side: number, height: number): BufferGeometry {
  const r = side / Math.sqrt(3);
  const pts = [0, 1, 2].map((i) => [Math.cos((i / 3) * Math.PI * 2 + Math.PI / 2) * r, Math.sin((i / 3) * Math.PI * 2 + Math.PI / 2) * r] as const);
  const pos: number[] = [];
  const h = height / 2;
  for (let i = 0; i < 3; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[(i + 1) % 3]!;
    pos.push(ax, -h, az, bx, -h, bz, bx, h, bz, ax, -h, az, bx, h, bz, ax, h, az);
  }
  for (const y of [-h, h]) {
    const order = y > 0 ? [0, 1, 2] : [0, 2, 1];
    for (const k of order) pos.push(pts[k]![0], y, pts[k]![1]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Prism Road's centrepiece: a colossal glass prism turning in the void. A white
 * beam strikes one face and fans out of the other as the seven rainbow beams the
 * road is made of; crystal shards and halo rings drift around it.
 */
export function buildPrism(ctx: BuildContext, _p: LandmarkPlacement): void {
  const { path } = ctx;
  const rng = new SeededRandom(ctx.def.terrain.seed + 77);
  const ys = path.samples.map((s) => s.position.y);
  const cx = path.samples.reduce((a, s) => a + s.position.x, 0) / path.samples.length;
  const cz = path.samples.reduce((a, s) => a + s.position.z, 0) / path.samples.length;
  const top = Math.max(...ys);
  const centre = new Vector3(cx, top + 70, cz);

  const prism = new Group();
  prism.position.copy(centre);
  const glass = new MeshStandardMaterial({ color: '#e8f0ff', emissive: new Color('#9a8aff'), emissiveIntensity: 0.35, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55, flatShading: true });
  const body = new Mesh(prismGeometry(46, 64), glass);
  prism.add(body);
  const edges = new MeshBasicMaterial({ color: new Color('#ffffff').multiplyScalar(1.4) });
  const r = 46 / Math.sqrt(3);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const edge = new Mesh(new CylinderGeometry(0.5, 0.5, 64, 6), edges);
    edge.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    prism.add(edge);
  }
  ctx.add(prism);

  // The incoming white beam and the outgoing fan, in a group that turns with the prism.
  const beams = new Group();
  beams.position.copy(centre);
  const beamMat = (c: string, o: number): MeshBasicMaterial => new MeshBasicMaterial({ color: new Color(c), transparent: true, opacity: o, blending: AdditiveBlending, depthWrite: false });
  const white = new Mesh(new BoxGeometry(900, 3.2, 3.2), beamMat('#ffffff', 0.7));
  white.position.set(-450 - 8, 0, 0);
  beams.add(white);
  const fan: Mesh[] = [];
  SPECTRUM.forEach((c, i) => {
    const b = new Mesh(new BoxGeometry(900, 2.6, 4.2), beamMat(c, 0.6));
    b.geometry.translate(450, 0, 0);
    b.position.set(8, 0, 0);
    b.rotation.y = -0.22 + (i / (SPECTRUM.length - 1)) * 0.44;
    b.rotation.z = -0.12 - i * 0.012;
    beams.add(b);
    fan.push(b);
  });
  ctx.add(beams);

  // Halo rings in spectrum colours, tilted and slowly precessing.
  const rings: Mesh[] = [];
  SPECTRUM.forEach((c, i) => {
    const ring = new Mesh(new TorusGeometry(70 + i * 7, 0.9, 6, 96), new MeshBasicMaterial({ color: new Color(c), transparent: true, opacity: 0.55, depthWrite: false }));
    ring.position.copy(centre);
    ring.rotation.set(Math.PI / 2 + 0.35, 0, i * 0.4);
    rings.push(ring);
    ctx.add(ring);
  });

  // Crystal shards floating round the course.
  const count = 90;
  const shards = new InstancedMesh(new OctahedronGeometry(1, 0), new MeshStandardMaterial({ color: '#ffffff', roughness: 0.1, flatShading: true, transparent: true, opacity: 0.85, emissive: new Color('#ffffff'), emissiveIntensity: 0.5 }), count);
  const base: Array<{ p: Vector3; s: Vector3; spin: number }> = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const reach = Math.max(260, ctx.terrain.def.size * 0.42);
  for (let i = 0; i < count; i++) {
    let p: Vector3;
    let guard = 0;
    do {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(60, reach);
      p = new Vector3(cx + Math.cos(a) * d, rng.range(Math.min(...ys) - 80, top + 90), cz + Math.sin(a) * d);
    } while (path.samples.some((s) => s.position.distanceTo(p) < s.wallOffset + 18) && guard++ < 10);
    const s = rng.range(2, 9);
    base.push({ p, s: new Vector3(s, s * rng.range(1.6, 2.8), s), spin: rng.range(0.2, 0.8) });
    shards.setColorAt(i, new Color(SPECTRUM[i % SPECTRUM.length]!));
  }
  shards.name = 'prism-shards';
  ctx.add(shards);

  ctx.updatables.push({
    update: (_dt, time) => {
      prism.rotation.y = time * 0.08;
      beams.rotation.y = time * 0.08;
      fan.forEach((b, i) => ((b.material as MeshBasicMaterial).opacity = 0.45 + 0.2 * Math.sin(time * 2 + i * 0.7)));
      rings.forEach((r, i) => (r.rotation.z = time * (0.05 + i * 0.01) + i * 0.4));
      for (let i = 0; i < count; i++) {
        const b = base[i]!;
        q.setFromAxisAngle(new Vector3(0, 1, 0), time * b.spin + i);
        m.compose(new Vector3(b.p.x, b.p.y + Math.sin(time * 0.5 + i) * 3, b.p.z), q, b.s);
        shards.setMatrixAt(i, m);
      }
      shards.instanceMatrix.needsUpdate = true;
    },
  });
}
