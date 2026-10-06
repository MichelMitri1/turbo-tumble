import { CanvasTexture, Color, DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, RepeatWrapping, SphereGeometry, RingGeometry, type Texture } from 'three';
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

/** Speed streams: glowing animated lanes on the road surface. */
export function buildStreams(ctx: BuildContext): void {
  const { path } = ctx;
  for (const st of ctx.def.streams ?? []) {
    const from = path.wrapIndex(Math.round((path.startDistance + st.distance) / path.spacing));
    const count = Math.max(2, Math.round(st.length / path.spacing));
    const idx = Array.from({ length: count + 1 }, (_, k) => (from + k) % path.samples.length);
    const lat = st.lateral ?? 0;
    const data = extrudeAlongPath(path, idx, () => [{ x: lat - st.width / 2, y: 0.05, u: 0 }, { x: lat + st.width / 2, y: 0.05, u: 1 }], { vScale: 6 });
    const tex = streamTexture(st.style);
    const look = STREAM_LOOK[st.style];
    const m = new Mesh(
      toGeometry(data),
      new MeshStandardMaterial({ map: tex, emissive: new Color(look.base), emissiveIntensity: look.glow, transparent: true, opacity: 0.88, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    m.name = `stream-${st.style}`;
    m.receiveShadow = true;
    ctx.add(m);
    const speed = 0.6 + st.strength * 0.12;
    ctx.updatables.push({ update: (dt) => (tex.offset.y -= dt * speed) });
  }
}

/** Shortcut trails: packed-dirt strips across the infield. */
export function buildShortcutTrails(ctx: BuildContext): void {
  const data = buildShortcutSurfaces(ctx.path, (x, z) => ctx.terrain.sample(x, z));
  if (!data) return;
  const m = new Mesh(toGeometry(data), new MeshStandardMaterial({ color: '#a8835a', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.name = 'shortcut-trails';
  m.receiveShadow = true;
  ctx.add(m);
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
  const colors = ['#ff6fae', '#3fd8ff', '#ffd23f', '#7a5cff', '#7ddc4a'];
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
