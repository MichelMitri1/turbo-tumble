import { CatmullRomCurve3, Vector3 } from 'three';
import { getTrack } from '@shared/tracks/registry';
import type { TrackDefinition } from '@shared/types/track';

/**
 * Small top-down "postcard" of a track for the menus: sky-tinted backdrop, the
 * theme's ground and lakes, the road ribbon with curbs and the start line. Drawn
 * from the track definition (no 3D load), so it always matches the current layout;
 * cached in memory and in localStorage keyed by a hash of the layout.
 */
const W = 240;
const H = 150;
const STORE = 'turbo-tumble.thumb.v1.';
const memory = new Map<string, string>();

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function trackThumb(id: string): string {
  const cached = memory.get(id);
  if (cached) return cached;
  const def = getTrack(id);
  const key = `${STORE}${id}.${hash(JSON.stringify([def.path, def.startDistance, def.terrain.palette, def.terrain.lakes, def.sky.top, def.minimap.rotation, def.space ?? false]))}`;
  let url: string | null = null;
  try {
    url = localStorage.getItem(key);
  } catch {
    /* storage unavailable */
  }
  if (!url) {
    url = draw(def);
    try {
      // Drop thumbnails of older layouts of this track first.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith(`${STORE}${id}.`) && k !== key) localStorage.removeItem(k);
      }
      localStorage.setItem(key, url);
    } catch {
      /* full or unavailable: memory cache only */
    }
  }
  memory.set(id, url);
  return url;
}

function draw(def: TrackDefinition): string {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const pal = def.terrain.palette;

  // Backdrop: sky gradient, then the ground (or deep space for floating courses).
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, def.sky.top);
  sky.addColorStop(1, def.sky.horizon);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  if (def.space) {
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 40; i++) g.fillRect((i * 97) % W, (i * 53) % H, 1.5, 1.5);
  }

  // Track outline in world XZ → fit into the card (rotated like the minimap).
  const pts = def.path.points.map((p) => new Vector3(p.pos[0], p.pos[1], p.pos[2]));
  const curve = new CatmullRomCurve3(pts, true, 'centripetal');
  const line = curve.getSpacedPoints(260);
  const rot = (def.minimap.rotation * Math.PI) / 180;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const flat = line.map((p) => [p.x * c - p.z * s, p.x * s + p.z * c] as [number, number]);
  const xs = flat.map((p) => p[0]);
  const zs = flat.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const pad = 16;
  const scale = Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2) / Math.max(1, maxZ - minZ));
  const ox = W / 2 - ((minX + maxX) / 2) * scale;
  const oz = H / 2 - ((minZ + maxZ) / 2) * scale;
  const toCard = (x: number, z: number): [number, number] => [ox + (x * c - z * s) * scale, oz + (x * s + z * c) * scale];

  if (!def.space) {
    // Ground island under the course.
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 10;
    const ground = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.6);
    ground.addColorStop(0, pal.grassA);
    ground.addColorStop(1, pal.grassB);
    g.fillStyle = ground;
    g.beginPath();
    g.roundRect(6, 6, W - 12, H - 12, 18);
    g.fill();
    g.restore();
    const liquid = def.terrain.liquid?.color ?? '#3fa8e8';
    g.fillStyle = liquid;
    for (const lake of def.terrain.lakes) {
      const [x, y] = toCard(lake.x, lake.z);
      g.beginPath();
      g.ellipse(x, y, Math.max(3, lake.radiusX * scale), Math.max(3, lake.radiusZ * scale), -rot, 0, Math.PI * 2);
      g.fill();
    }
  }

  const path = (): void => {
    g.beginPath();
    flat.forEach(([x, z], i) => {
      const px = ox + x * scale;
      const pz = oz + z * scale;
      if (i === 0) g.moveTo(px, pz);
      else g.lineTo(px, pz);
    });
    g.closePath();
  };
  const road = Math.max(3, def.path.defaultHalfWidth * 2 * scale);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // Shadow, curb (red/white dashes), shoulder, tarmac, centre dashes.
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = road + 6;
  g.save();
  g.translate(1.5, 2.5);
  path();
  g.stroke();
  g.restore();
  g.strokeStyle = '#ffffff';
  g.lineWidth = road + 3;
  path();
  g.stroke();
  g.strokeStyle = '#ff3b5c';
  g.setLineDash([4, 4]);
  path();
  g.stroke();
  g.setLineDash([]);
  g.strokeStyle = def.space ? '#4a3f8f' : '#55526a';
  g.lineWidth = road;
  path();
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1;
  g.setLineDash([3, 5]);
  path();
  g.stroke();
  g.setLineDash([]);

  // Start / finish: a chequered bar across the road.
  const t = (((def.startDistance % curve.getLength()) + curve.getLength()) % curve.getLength()) / curve.getLength();
  const p = curve.getPointAt(t);
  const tan = curve.getTangentAt(t);
  const [sx, sz] = toCard(p.x, p.z);
  const ang = Math.atan2(tan.x * s + tan.z * c, tan.x * c - tan.z * s);
  g.save();
  g.translate(sx, sz);
  g.rotate(ang);
  const half = road / 2 + 1;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? '#1b1446' : '#ffffff';
      g.fillRect(-2 + j * 2, -half + (i * half) / 2, 2, half / 2);
    }
  }
  g.restore();

  return canvas.toDataURL('image/webp', 0.85);
}
