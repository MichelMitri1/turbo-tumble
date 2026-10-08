import { BoxGeometry, CanvasTexture, Color, DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, RepeatWrapping, SphereGeometry, RingGeometry, type Texture } from 'three';
import { extrudeAlongPath } from '@shared/track/Extrude';
import { buildShortcutSurfaces } from '@shared/track/TrackGeometry';
import type { StreamDefinition } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { toGeometry } from '../../rendering/meshData';

const STREAM_LOOK: Record<StreamDefinition['style'], { base: string; streak: string; glow: number }> = {
  water: { base: '#2fb6ff', streak: '#e6fbff', glow: 0.35 },
  neon: { base: '#7a3cff', streak: '#3fe8ff', glow: 1.2 },
  wind: { base: '#dff6ff', streak: '#ffffff', glow: 0.5 },
  lava: { base: '#ff5a1a', streak: '#ffd23f', glow: 1.4 },
};

/** Flowing stripes with chevrons pointing downstream (scrolled every frame). */
function streamTexture(style: StreamDefinition['style']): Texture {
  const look = STREAM_LOOK[style];
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = look.base;
  g.fillRect(0, 0, 64, 128);
  g.strokeStyle = look.streak;
  g.lineWidth = 7;
  g.globalAlpha = 0.85;
  for (const y of [20, 84]) {
    g.beginPath();
    g.moveTo(8, y + 22);
    g.lineTo(32, y);
    g.lineTo(56, y + 22);
    g.stroke();
  }
  g.globalAlpha = 0.35;
  g.fillStyle = look.streak;
  for (let i = 0; i < 18; i++) g.fillRect((i * 37) % 60, (i * 53) % 128, 3, 14);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Factory conveyor belt: dark rubber slats with yellow arrows, scrolled like a stream. */
function conveyorTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#26262c';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#34343c';
  for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 64, 9);
  g.fillStyle = '#f2c230';
  for (const y of [24, 88]) {
    g.beginPath();
    g.moveTo(14, y + 18);
    g.lineTo(32, y);
    g.lineTo(50, y + 18);
    g.lineTo(50, y + 26);
    g.lineTo(32, y + 8);
    g.lineTo(14, y + 26);
    g.fill();
  }
  g.fillStyle = '#9a9aa4';
  g.fillRect(0, 0, 5, 128);
  g.fillRect(59, 0, 5, 128);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Speed streams: glowing animated lanes on the road surface (conveyors in the factory). */
export function buildStreams(ctx: BuildContext): void {
  const { path } = ctx;
  const conveyor = ctx.def.theme === 'factory';
  for (const st of ctx.def.streams ?? []) {
    const from = path.wrapIndex(Math.round((path.startDistance + st.distance) / path.spacing));
    const count = Math.max(2, Math.round(st.length / path.spacing));
    const idx = Array.from({ length: count + 1 }, (_, k) => (from + k) % path.samples.length);
    const lat = st.lateral ?? 0;
    const data = extrudeAlongPath(path, idx, () => [{ x: lat - st.width / 2, y: 0.05, u: 0 }, { x: lat + st.width / 2, y: 0.05, u: 1 }], { vScale: 6 });
    const tex = conveyor ? conveyorTexture() : streamTexture(st.style);
    const look = STREAM_LOOK[st.style];
    const m = new Mesh(
      toGeometry(data),
      conveyor
        ? new MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.2, emissive: new Color('#f2c230'), emissiveMap: tex, emissiveIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -3 })
        : new MeshStandardMaterial({ map: tex, emissive: new Color(look.base), emissiveIntensity: look.glow, transparent: true, opacity: 0.88, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    m.name = `stream-${st.style}`;
    m.receiveShadow = true;
    ctx.add(m);
    const speed = 0.6 + st.strength * 0.12;
    ctx.updatables.push({ update: (dt) => (tex.offset.y -= dt * speed) });
  }
}

const TRAIL_COLORS: Record<string, string> = {
  beach: '#e8d4a4',
  desert: '#d8a868',
  mesa: '#a8603e',
  snow: '#e2ecf6',
  glacier: '#bfe4f8',
  volcano: '#3a2e2a',
  magma: '#2e2424',
  marsh: '#6a5440',
  factory: '#6a6e78',
  mushroom: '#7a5a8a',
  city: '#3a3654',
};

/** Shortcut trails: packed-dirt strips across the infield (glowing floating planks in the sky). */
export function buildShortcutTrails(ctx: BuildContext): void {
  const data = buildShortcutSurfaces(ctx.path, (x, z) => ctx.terrain.sample(x, z));
  if (!data) return;
  const floating = Boolean(ctx.def.space);
  const color = floating ? (ctx.def.theme === 'sky' ? '#f4f0e0' : '#3a2a7a') : (TRAIL_COLORS[ctx.def.theme] ?? '#a8835a');
  const m = new Mesh(
    toGeometry(data),
    new MeshStandardMaterial({ color, roughness: floating ? 0.4 : 1, polygonOffset: true, polygonOffsetFactor: -2, ...(floating ? { emissive: new Color(ctx.def.theme === 'sky' ? '#fff0c0' : '#6a4aff'), emissiveIntensity: 0.35, side: DoubleSide } : {}) }),
  );
  m.name = 'shortcut-trails';
  m.receiveShadow = true;
  ctx.add(m);
  if (floating) floatingTrailEdges(ctx);
  // Little marker flags at each trail mouth.
  const flagMat = new MeshStandardMaterial({ color: '#ffd23f', emissive: new Color('#ff8a1a'), emissiveIntensity: 0.4 });
  for (const sc of ctx.def.shortcuts) {
    for (const p of [ctx.path.shortcutPoints(sc)[0]!, ctx.path.shortcutPoints(sc).at(-1)!]) {
      const pole = new Mesh(new SphereGeometry(0.5, 8, 6), flagMat);
      pole.position.set(p.x, ctx.terrain.sample(p.x, p.z) + 3, p.z);
      ctx.add(pole);
    }
  }
}

/** Space courses: big ringed planets hanging in the starfield. */
export function buildPlanets(ctx: BuildContext): void {
  const rng = new SeededRandom(ctx.def.terrain.seed + 21);
  const colors = {
    starlight: ['#3f7aff', '#8af0ff', '#ffd23f', '#5a4aff', '#bfe8ff'],
    comet: ['#3fffd0', '#2a8a9a', '#ffd23f', '#7affb0', '#1ac8c8'],
    prism: ['#ff6fae', '#ffd23f', '#b07aff', '#3fd8ff', '#ff9a5a'],
  }[ctx.def.theme] ?? ['#ff6fae', '#3fd8ff', '#ffd23f', '#7a5cff', '#7ddc4a'];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const d = rng.range(700, 1000);
    const r = rng.range(45, 120);
    const color = colors[i % colors.length]!;
    const planet = new Mesh(new SphereGeometry(r, 32, 20), new MeshStandardMaterial({ color, roughness: 0.8, emissive: new Color(color), emissiveIntensity: 0.25 }));
    planet.position.set(ctx.terrain.centerX + Math.cos(a) * d, rng.range(-150, 250), ctx.terrain.centerZ + Math.sin(a) * d);
    ctx.add(planet);
    if (rng.chance(0.5)) {
      const ring = new Mesh(new RingGeometry(r * 1.4, r * 2, 48), new MeshBasicMaterial({ color: new Color(color).lerp(new Color('#ffffff'), 0.5), side: DoubleSide, transparent: true, opacity: 0.6 }));
      ring.position.copy(planet.position);
      ring.rotation.set(rng.range(-1.2, -0.4), 0, rng.range(-0.4, 0.4));
      ctx.add(ring);
    }
  }
}

/** Floating shortcut planks get a slab underside and glowing rails so they read over the void. */
function floatingTrailEdges(ctx: BuildContext): void {
  const edge = new MeshBasicMaterial({ color: new Color(ctx.def.theme === 'sky' ? '#ffd84a' : '#8af0ff').multiplyScalar(1.4) });
  const under = new MeshStandardMaterial({ color: ctx.def.theme === 'sky' ? '#d8dce8' : '#1e1a4a', roughness: 0.9 });
  for (const sc of ctx.def.shortcuts) {
    const pts = ctx.path.shortcutPoints(sc, 2.5);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const len = a.distanceTo(b);
      const mid = a.clone().lerp(b, 0.5);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const slab = new Mesh(new BoxGeometry(sc.halfWidth * 2, 1.2, len + 0.1), under);
      slab.position.set(mid.x, ctx.terrain.sample(mid.x, mid.z) - 0.55, mid.z);
      slab.rotation.y = yaw;
      ctx.add(slab);
      for (const side of [-1, 1]) {
        const rail = new Mesh(new BoxGeometry(0.3, 0.25, len + 0.1), edge);
        rail.position.copy(slab.position);
        rail.position.y += 0.7;
        rail.rotation.y = yaw;
        rail.translateX(side * sc.halfWidth);
        ctx.add(rail);
      }
    }
  }
}
