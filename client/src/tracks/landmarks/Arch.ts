import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { brandTexture } from '../../rendering/ProceduralTextures';
import { TrackMaterials } from '../materials';
import { sampleQuaternion } from '../frames';
import { roadClearance } from './placement';

/** Lap distances already spanned by an arch, per track (keeps arches apart). */
const spans = new WeakMap<BuildContext['def'], number[]>();

/**
 * Nearest usable lap distance to `want`: not on a jump run-up / flight, a gap, a
 * tunnel or bridge, a shortcut mouth or the start, and with room for both legs.
 */
function clearDistance(ctx: BuildContext, want: number, legOut: number): number | null {
  const { path, def } = ctx;
  const L = path.length;
  const wrap = (d: number): number => ((d % L) + L) % L;
  const ahead = (from: number, d: number): number => wrap(d - from);
  const used = spans.get(def) ?? [];
  const ok = (d: number): boolean => {
    if (Math.min(d, L - d) < 60) return false;
    if (def.jumps.some((j) => ahead(j.distance - 12, d) < j.length + 12 + 95)) return false;
    if ((def.gaps ?? []).some((g) => ahead(g.distance - 25, d) < g.length + 50)) return false;
    if (def.shortcuts.some((sc) => ahead(sc.from - 8, d) < sc.halfWidth * 2 + 18 || ahead(sc.to - sc.halfWidth * 2 - 14, d) < sc.halfWidth * 2 + 22)) return false;
    if (used.some((u) => Math.min(Math.abs(u - d), L - Math.abs(u - d)) < 40)) return false;
    for (const dd of [-10, 0, 10]) {
      const f = path.frameAtSplineDistance(path.startDistance + d + dd);
      if (f.sample.kind === 'tunnel' || f.sample.kind === 'bridge') return false;
    }
    const f = path.anchorToWorld({ distance: d });
    // Both legs must stand clear of every other stretch of road.
    for (const side of [-1, 1]) {
      const x = f.position.x + f.right.x * side * (f.wallOffset + legOut);
      const z = f.position.z + f.right.z * side * (f.wallOffset + legOut);
      if (roadClearance(ctx, x, z) < legOut - 0.8) return false;
    }
    return true;
  };
  for (let k = 0; k < 40; k++) {
    for (const s of k ? [1, -1] : [1]) {
      const d = wrap(want + s * k * 9);
      if (ok(d)) {
        used.push(d);
        spans.set(def, used);
        return d;
      }
    }
  }
  return null;
}

interface ArchKit {
  g: Group;
  /** Half span between leg centres (just beyond the walls). */
  span: number;
  /** Ground height (local y) under each leg: index 0 = left (+x), 1 = right (−x). */
  ground: [number, number];
  floating: boolean;
  rng: SeededRandom;
}

const mesh = (geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0): Mesh => {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
};

/** A vertical leg from the ground (or deep into the void) up to `top`. */
function leg(k: ArchKit, side: number, top: number, w: number, mat: Material, round = false): Mesh {
  const bottom = k.floating ? -26 : k.ground[side > 0 ? 0 : 1] - 0.5;
  const h = top - bottom;
  const geo = round ? new CylinderGeometry(w * 0.45, w * 0.55, h, 10) : new BoxGeometry(w, h, w);
  return mesh(geo, mat, side * k.span, bottom + h / 2, 0);
}

function textTexture(text: string, bg: string, fg: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.font = '900 72px "Lilita One", "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.strokeText(text, 256, 68);
  g.fillStyle = fg;
  g.fillText(text, 256, 68);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A sign board facing both ways at height y. */
function sign(k: ArchKit, y: number, w: number, h: number, map: CanvasTexture, frame: Material): void {
  const face = new MeshStandardMaterial({ map, roughness: 0.6, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.15 });
  k.g.add(mesh(new BoxGeometry(w + 0.4, h + 0.4, 0.3), frame, 0, y, 0));
  for (const z of [-0.17, 0.17]) {
    const p = mesh(new PlaneGeometry(w, h), face, 0, y, z);
    p.rotation.y = z < 0 ? Math.PI : 0;
    k.g.add(p);
  }
}

type StyleBuilder = (k: ArchKit, ctx: BuildContext) => void;

const STYLES: Record<string, StyleBuilder> = {
  /** Circuit sponsor gantry: truss legs, a sponsor board and chequered flags. */
  banner(k) {
    const blue = TrackMaterials.paint('#2a6ad8');
    const white = TrackMaterials.paint('#f6f3ee');
    for (const s of [-1, 1]) {
      k.g.add(leg(k, s, 10, 1.1, blue));
      for (let y = 1; y < 10; y += 2.2) k.g.add(mesh(new BoxGeometry(1.25, 0.3, 1.25), white, s * k.span, y, 0));
    }
    k.g.add(mesh(new BoxGeometry(k.span * 2 + 1.6, 1.0, 1.0), blue, 0, 10.2, 0));
    sign(k, 8.6, Math.min(14, k.span * 1.4), 2.6, brandTexture(k.rng.int(0, 4)) as CanvasTexture, white);
    const check = TrackMaterials.checker();
    for (const s of [-1, 1]) k.g.add(mesh(new BoxGeometry(2.4, 1.6, 0.1), check, s * (k.span - 2), 11.6, 0));
  },
  /** Tiki gate: lashed bamboo, a thatched lintel and palm fronds. */
  bamboo(k, ctx) {
    const cane = TrackMaterials.paint('#d8b85a');
    const band = TrackMaterials.paint('#6a4a2a');
    const thatch = TrackMaterials.paint('#c89a4a');
    const leaf = TrackMaterials.paint('#3f9a3a');
    for (const s of [-1, 1]) {
      for (const dz of [-0.6, 0.6]) {
        const m = leg(k, s, 11, 0.7, cane, true);
        m.position.z = dz;
        k.g.add(m);
      }
      for (let y = 2; y < 11; y += 2.4) k.g.add(mesh(new CylinderGeometry(0.75, 0.75, 0.3, 8), band, s * k.span, y, 0));
    }
    const beam = mesh(new CylinderGeometry(0.55, 0.55, k.span * 2 + 3, 8), cane, 0, 10.6, 0);
    beam.rotation.z = Math.PI / 2;
    k.g.add(beam);
    const roof = mesh(new ConeGeometry(1, 2.2, 4), thatch, 0, 12, 0);
    roof.scale.set(k.span + 2, 1, 2);
    roof.rotation.y = Math.PI / 4;
    k.g.add(roof);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const frond = mesh(new BoxGeometry(5, 0.12, 1.1), leaf, s * (k.span + 1.5), 12.6, 0);
        frond.rotation.set(0, (i / 5) * Math.PI * 2, -0.45);
        frond.translateX(2.3);
        k.g.add(frond);
      }
    }
    sign(k, 8.4, 9, 1.8, textTexture(ctx.def.name.toUpperCase(), '#2fb6c8', '#fff6d8'), band);
  },
  /** Ranch gate: square posts, a crossbeam sign and hay bales at its feet. */
  barnGate(k, ctx) {
    const wood = TrackMaterials.paint('#8a5a32');
    const dark = TrackMaterials.paint('#5a3a22');
    const hay = TrackMaterials.paint('#e8c45a');
    for (const s of [-1, 1]) {
      k.g.add(leg(k, s, 10.5, 1.1, wood));
      const brace = mesh(new BoxGeometry(0.4, 4, 0.4), dark, s * (k.span - 1.4), 8.2, 0);
      brace.rotation.z = s * 0.7;
      k.g.add(brace);
      for (let i = 0; i < 3; i++) {
        const bale = mesh(new BoxGeometry(2.2, 1.2, 1.4), hay, s * (k.span + 1.6), k.ground[s > 0 ? 0 : 1] + 0.6 + (i === 2 ? 1.2 : 0), i === 2 ? 0 : (i - 0.5) * 1.6);
        k.g.add(bale);
      }
    }
    k.g.add(mesh(new BoxGeometry(k.span * 2 + 2, 0.9, 0.9), wood, 0, 10.4, 0));
    sign(k, 9, 10, 2, textTexture(ctx.def.name.toUpperCase(), '#b8402a', '#fff2d0'), dark);
  },
  /** Covered-bridge frame: timber legs, an A-frame roof and lanterns. */
  wood(k) {
    const wood = TrackMaterials.paint('#a0522d');
    const roof = TrackMaterials.paint('#7a2a1e');
    const trim = TrackMaterials.paint('#f2e2c4');
    for (const s of [-1, 1]) {
      for (const dz of [-1.8, 1.8]) {
        const m = leg(k, s, 9.5, 0.8, wood);
        m.position.z = dz;
        k.g.add(m);
      }
      const x = mesh(new BoxGeometry(0.3, 5.5, 0.3), trim, s * k.span, 6, 0);
      x.rotation.x = 0.55;
      k.g.add(x);
    }
    k.g.add(mesh(new BoxGeometry(k.span * 2 + 1.6, 0.8, 4.4), wood, 0, 9.8, 0));
    for (const s of [-1, 1]) {
      const r = mesh(new BoxGeometry(k.span + 1.6, 0.35, 5.2), roof, s * (k.span / 2 + 0.4), 11.4, 0);
      r.rotation.z = -s * 0.5;
      k.g.add(r);
    }
    k.g.add(mesh(new BoxGeometry(0.5, 0.5, 5.4), trim, 0, 12.7, 0));
    const lamp = TrackMaterials.emissive('#ffb84a', 2.2);
    for (const s of [-1, 1]) k.g.add(mesh(new SphereGeometry(0.4, 8, 6), lamp, s * (k.span - 1.5), 8.8, 2.2));
  },
  /** Lumber-camp gate: raw log legs, a log lintel and a carved sign. */
  log(k, ctx) {
    const bark = TrackMaterials.paint('#6a4a30');
    const cut = TrackMaterials.paint('#d8b480');
    for (const s of [-1, 1]) k.g.add(leg(k, s, 10, 1.3, bark, true));
    for (const y of [10.2, 11.4]) {
      const beam = mesh(new CylinderGeometry(0.6, 0.6, k.span * 2 + 2.5, 10), bark, 0, y, 0);
      beam.rotation.z = Math.PI / 2;
      k.g.add(beam);
      for (const s of [-1, 1]) {
        const end = mesh(new CylinderGeometry(0.62, 0.62, 0.1, 10), cut, s * (k.span + 1.25), y, 0);
        end.rotation.z = Math.PI / 2;
        k.g.add(end);
      }
    }
    sign(k, 8.6, 9, 1.8, textTexture(ctx.def.name.toUpperCase(), '#5a3a22', '#ffe6b0'), bark);
  },
  /** Prayer-flag ropes strung between tall poles. */
  rope(k) {
    const pole = TrackMaterials.paint('#7a5a3a');
    for (const s of [-1, 1]) k.g.add(leg(k, s, 13, 0.6, pole, true));
    const colors = ['#ff4f5a', '#ffd23f', '#3fd87a', '#3fa9f5', '#ffffff'];
    for (const [i, sag] of [3.2, 4.4].entries()) {
      const n = Math.round(k.span * 1.6);
      for (let j = 1; j < n; j++) {
        const t = j / n;
        const x = k.span - t * k.span * 2;
        const y = 12.6 - i * 1.4 - sag * 4 * t * (1 - t);
        const flag = mesh(new PlaneGeometry(0.9, 1.1), TrackMaterials.paint(colors[(j + i) % colors.length]!), x, y - 0.6, 0);
        k.g.add(flag);
      }
      const rope = mesh(new BoxGeometry(k.span * 2, 0.08, 0.08), TrackMaterials.paint('#e8dcc0'), 0, 12.6 - i * 1.4 - sag * 0.7, 0);
      k.g.add(rope);
    }
  },
  /** Egyptian gate: two battered pylons and a lintel with a winged sun disc. */
  sandstone(k) {
    const stone = TrackMaterials.paint('#d8b078');
    const dark = TrackMaterials.paint('#a87a48');
    const gold = TrackMaterials.emissive('#ffc83a', 0.6);
    for (const s of [-1, 1]) {
      const base = k.ground[s > 0 ? 0 : 1];
      const h = 14 - base;
      const p = mesh(new CylinderGeometry(1.8, 2.8, h, 4), stone, s * (k.span + 1.2), base + h / 2, 0);
      p.rotation.y = Math.PI / 4;
      k.g.add(p);
      for (let y = 3; y < 13; y += 3) k.g.add(mesh(new BoxGeometry(3.4, 0.3, 3.4), dark, s * (k.span + 1.2), y, 0));
    }
    k.g.add(mesh(new BoxGeometry(k.span * 2 + 5, 1.8, 3), stone, 0, 13.4, 0));
    k.g.add(mesh(new BoxGeometry(k.span * 2 + 6, 0.5, 3.4), dark, 0, 14.5, 0));
    const disc = mesh(new CylinderGeometry(1.2, 1.2, 0.3, 20), gold, 0, 13.4, 1.6);
    disc.rotation.x = Math.PI / 2;
    k.g.add(disc);
    for (const s of [-1, 1]) {
      const wing = mesh(new BoxGeometry(3.5, 0.6, 0.2), gold, s * 2.6, 13.5, 1.6);
      wing.rotation.z = s * 0.15;
      k.g.add(wing);
    }
  },
  /** Temple gate: stepped stone legs, a corbelled lintel with glyphs, fire bowls. */
  stone(k) {
    const stone = TrackMaterials.stone();
    const moss = TrackMaterials.paint('#5a8a3a');
    for (const s of [-1, 1]) {
      k.g.add(leg(k, s, 11, 2.4, stone));
      for (let y = 2; y < 11; y += 3) k.g.add(mesh(new BoxGeometry(2.8, 0.6, 2.8), stone, s * k.span, y, 0));
      k.g.add(mesh(new BoxGeometry(2.6, 1.2, 2.6), moss, s * k.span, k.ground[s > 0 ? 0 : 1] + 0.4, 0));
    }
    for (let i = 0; i < 3; i++) k.g.add(mesh(new BoxGeometry(k.span * 2 + 3 - i * 3, 1.3, 2.6), stone, 0, 11.6 + i * 1.3, 0));
    const glyph = TrackMaterials.paint('#4a3a2a');
    for (let i = -3; i <= 3; i++) k.g.add(mesh(new BoxGeometry(0.9, 0.9, 0.1), glyph, i * 1.8, 11.6, 1.32));
    const fire = TrackMaterials.emissive('#ff8a2a', 2.4);
    const flames: Mesh[] = [];
    for (const s of [-1, 1]) {
      k.g.add(mesh(new CylinderGeometry(1.1, 0.6, 0.9, 10), TrackMaterials.paint('#3a3a3a'), s * k.span, 15.6, 0));
      const f = mesh(new ConeGeometry(0.8, 2, 8), fire, s * k.span, 16.9, 0);
      flames.push(f);
      k.g.add(f);
    }
    k.g.userData.flames = flames;
  },
  /** Jungle gate: two crooked trunks bridged by a branch, dripping vines and leaves. */
  vine(k) {
    const bark = TrackMaterials.paint('#5a4630');
    const leafs = [TrackMaterials.paint('#2f8a3a'), TrackMaterials.paint('#3fa040'), TrackMaterials.paint('#4fb04a')];
    for (const s of [-1, 1]) {
      const m = leg(k, s, 12, 1.6, bark, true);
      m.rotation.z = s * 0.06;
      k.g.add(m);
    }
    const branch = mesh(new CylinderGeometry(0.8, 1.1, k.span * 2 + 4, 8), bark, 0, 12.4, 0);
    branch.rotation.z = Math.PI / 2 + 0.05;
    k.g.add(branch);
    for (let i = 0; i < 9; i++) {
      const x = (i / 8 - 0.5) * (k.span * 2 + 4);
      k.g.add(mesh(new IcosahedronGeometry(k.rng.range(1.6, 2.6), 0), k.rng.pick(leafs), x, 13.4 + k.rng.range(-0.4, 0.8), k.rng.range(-0.8, 0.8)));
    }
    const vineMat = TrackMaterials.paint('#3f7a2a');
    for (let i = 0; i < 12; i++) {
      const x = (k.rng.next() - 0.5) * k.span * 2;
      const len = k.rng.range(1.5, 3.5);
      k.g.add(mesh(new BoxGeometry(0.12, len, 0.12), vineMat, x, 12 - len / 2, k.rng.range(-0.6, 0.6)));
    }
  },
  /** Alpine gate: snow-capped log frame, icicles and coloured string lights. */
  snow(k) {
    const bark = TrackMaterials.paint('#6a4a30');
    const snow = TrackMaterials.paint('#f4f8ff');
    const ice = new MeshStandardMaterial({ color: '#bfe8ff', roughness: 0.1, transparent: true, opacity: 0.85 });
    for (const s of [-1, 1]) {
      k.g.add(leg(k, s, 10, 1.1, bark, true));
      k.g.add(mesh(new SphereGeometry(1.0, 10, 8), snow, s * k.span, 10.2, 0));
    }
    const beam = mesh(new CylinderGeometry(0.6, 0.6, k.span * 2 + 2, 10), bark, 0, 10.4, 0);
    beam.rotation.z = Math.PI / 2;
    k.g.add(beam);
    const cap = mesh(new BoxGeometry(k.span * 2 + 2.4, 0.6, 1.6), snow, 0, 11.1, 0);
    k.g.add(cap);
    for (let i = 0; i < 14; i++) {
      const x = (i / 13 - 0.5) * k.span * 2;
      const len = k.rng.range(0.6, 1.6);
      const c = mesh(new ConeGeometry(0.18, len, 6), ice, x, 9.8 - len / 2, 0.4);
      c.rotation.x = Math.PI;
      k.g.add(c);
    }
    const bulbs = ['#ff4f5a', '#3fd87a', '#ffd23f', '#3fa9f5'];
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      k.g.add(mesh(new SphereGeometry(0.22, 6, 5), TrackMaterials.emissive(bulbs[i % 4]!, 2.4), k.span - t * k.span * 2, 9.6 - Math.sin(t * Math.PI) * 1.2, -0.7));
    }
  },
  /** Neon portal: a glowing ring around the road with light bars that pulse. */
  neon(k) {
    const r = k.span + 0.8;
    const ringMat = new MeshBasicMaterial({ color: new Color('#ff3fb4').multiplyScalar(1.6) });
    const ring2 = new MeshBasicMaterial({ color: new Color('#3fe8ff').multiplyScalar(1.6) });
    const a = mesh(new TorusGeometry(r, 0.35, 8, 48, Math.PI), ringMat, 0, 2, 0);
    const b = mesh(new TorusGeometry(r + 0.9, 0.22, 8, 48, Math.PI), ring2, 0, 2, -1.2);
    k.g.add(a, b);
    const dark = TrackMaterials.paint('#1a1830');
    for (const s of [-1, 1]) k.g.add(leg(k, s * ((r + 0.6) / k.span), 2, 1.4, dark));
    k.g.userData.pulse = [ringMat, ring2];
  },
  /** Swamp gate: twisted dead trunks hung with flickering lanterns. */
  lantern(k) {
    const bark = TrackMaterials.paint('#3a3430');
    for (const s of [-1, 1]) {
      const m = leg(k, s, 11, 1.2, bark, true);
      m.rotation.z = s * 0.08;
      k.g.add(m);
      for (let i = 0; i < 3; i++) {
        const twig = mesh(new BoxGeometry(0.25, 3, 0.25), bark, s * (k.span + 0.8), 11 + i * 0.8, (i - 1) * 0.8);
        twig.rotation.z = -s * (0.6 + i * 0.3);
        k.g.add(twig);
      }
    }
    const beam = mesh(new CylinderGeometry(0.45, 0.6, k.span * 2 + 1, 7), bark, 0, 11, 0);
    beam.rotation.z = Math.PI / 2 + 0.04;
    k.g.add(beam);
    const glows: MeshStandardMaterial[] = [];
    for (let i = 0; i < 5; i++) {
      const x = (i / 4 - 0.5) * k.span * 1.6;
      const glow = new MeshStandardMaterial({ color: '#d8ff9a', emissive: new Color('#9aff6a'), emissiveIntensity: 2, roughness: 0.4 });
      glows.push(glow);
      k.g.add(mesh(new BoxGeometry(0.06, 1.4, 0.06), TrackMaterials.paint('#222222'), x, 10, 0));
      k.g.add(mesh(new OctahedronGeometry(0.45), glow, x, 9.1, 0));
    }
    k.g.userData.flicker = glows;
  },
  /** Factory gantry: I-beam frame, hazard stripes, a spinning cog and beacons. */
  girder(k) {
    const steel = TrackMaterials.paint('#4a5060');
    const yellow = TrackMaterials.paint('#f2c230');
    for (const s of [-1, 1]) {
      k.g.add(leg(k, s, 11, 1.2, steel));
      for (let y = 1.5; y < 10; y += 3) {
        const brace = mesh(new BoxGeometry(0.25, 3.6, 0.25), yellow, s * k.span, y + 1.5, 0.62);
        brace.rotation.z = (y % 2 ? 1 : -1) * 0.5;
        k.g.add(brace);
      }
    }
    k.g.add(mesh(new BoxGeometry(k.span * 2 + 2, 1.4, 1.4), steel, 0, 11.3, 0));
    k.g.add(mesh(new BoxGeometry(k.span * 2 + 2.1, 0.4, 1.5), yellow, 0, 10.5, 0));
    const cog = new Group();
    cog.position.set(0, 15.2, 0);
    const teeth = 12;
    const cogMat = TrackMaterials.paint('#b87a3a');
    const hub = mesh(new CylinderGeometry(3, 3, 0.9, 24), cogMat);
    hub.rotation.x = Math.PI / 2;
    cog.add(hub);
    for (let i = 0; i < teeth; i++) {
      const t = mesh(new BoxGeometry(1, 1.1, 0.9), cogMat);
      const a = (i / teeth) * Math.PI * 2;
      t.position.set(Math.cos(a) * 3.3, Math.sin(a) * 3.3, 0);
      t.rotation.z = a;
      cog.add(t);
    }
    const axle = mesh(new CylinderGeometry(0.8, 0.8, 1.2, 12), steel);
    axle.rotation.x = Math.PI / 2;
    cog.add(axle);
    k.g.add(cog);
    k.g.add(mesh(new BoxGeometry(1.2, 3.2, 1.2), steel, 0, 12.4, 0));
    const beacon = new MeshStandardMaterial({ color: '#ff8a1a', emissive: new Color('#ff6a00'), emissiveIntensity: 2 });
    for (const s of [-1, 1]) k.g.add(mesh(new SphereGeometry(0.45, 10, 8), beacon, s * (k.span + 0.4), 12.3, 0));
    k.g.userData.spin = cog;
    k.g.userData.beacon = beacon;
  },
  /** Volcanic arch: jagged obsidian with glowing magma seams. */
  obsidian(k) {
    const rock = new MeshStandardMaterial({ color: '#1e1818', roughness: 0.6, metalness: 0.2, flatShading: true });
    const lava = TrackMaterials.emissive('#ff5a1a', 2.6);
    for (const s of [-1, 1]) {
      const base = k.floating ? -20 : k.ground[s > 0 ? 0 : 1] - 1;
      for (let y = base; y < 12; y += 3) {
        const r = mesh(new DodecahedronGeometry(k.rng.range(1.8, 2.6), 0), rock, s * (k.span + 0.6) + k.rng.range(-0.5, 0.5), y + 1.5, k.rng.range(-0.6, 0.6));
        r.rotation.set(k.rng.next() * 3, k.rng.next() * 3, 0);
        k.g.add(r);
      }
      k.g.add(mesh(new BoxGeometry(0.3, 12 - base, 0.3), lava, s * (k.span - 0.9), (12 + base) / 2, 1.4));
    }
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = k.span + 0.6 - t * (k.span * 2 + 1.2);
      const y = 12.5 + Math.sin(t * Math.PI) * 3;
      const r = mesh(new DodecahedronGeometry(k.rng.range(1.6, 2.4), 0), rock, x, y, 0);
      r.rotation.set(k.rng.next() * 3, k.rng.next() * 3, 0);
      k.g.add(r);
      if (i % 2) k.g.add(mesh(new OctahedronGeometry(0.6), lava, x, y - 1.6, 1.2));
    }
  },
  /** Floating gold ring around the road, slowly turning. */
  ring(k) {
    const r = k.span + 2;
    const gold = new MeshStandardMaterial({ color: '#ffd84a', emissive: new Color('#ffb020'), emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.25 });
    const ring = new Group();
    ring.position.y = 3;
    ring.add(mesh(new TorusGeometry(r, 0.7, 10, 56), gold));
    const gem = TrackMaterials.emissive('#7ae8ff', 2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ring.add(mesh(new OctahedronGeometry(0.9), gem, Math.cos(a) * r, Math.sin(a) * r, 0));
    }
    k.g.add(ring);
    k.g.userData.roll = ring;
  },
  /** Ice gate: crystal clusters bridged by a translucent ice lintel. */
  ice(k) {
    const ice = new MeshStandardMaterial({ color: '#a8e4ff', emissive: new Color('#3a9ad8'), emissiveIntensity: 0.35, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.86, flatShading: true });
    for (const s of [-1, 1]) {
      const base = k.ground[s > 0 ? 0 : 1];
      for (let i = 0; i < 4; i++) {
        const h = k.rng.range(8, 15);
        const c = mesh(new CylinderGeometry(0.1, k.rng.range(0.9, 1.6), h, 6), ice, s * (k.span + 0.4 + k.rng.range(-0.6, 1.2)), base + h / 2 - 0.5, k.rng.range(-1.2, 1.2));
        c.rotation.z = s * k.rng.range(-0.15, 0.25);
        k.g.add(c);
      }
    }
    const lintel = mesh(new CylinderGeometry(1.4, 1.4, k.span * 2 + 3, 6), ice, 0, 12, 0);
    lintel.rotation.z = Math.PI / 2;
    k.g.add(lintel);
    for (let i = 0; i < 10; i++) {
      const c = mesh(new ConeGeometry(0.3, k.rng.range(1, 2.4), 6), ice, (i / 9 - 0.5) * k.span * 2, 10.4, 0);
      c.rotation.x = Math.PI;
      k.g.add(c);
    }
  },
  /** Natural sandstone arch, eroded and banded. */
  rock(k) {
    const bands = [TrackMaterials.paint('#b8603a'), TrackMaterials.paint('#a85434'), TrackMaterials.paint('#c8784a')];
    const rock = (geo: BufferGeometry, i: number, x: number, y: number, z = 0): Mesh => mesh(geo, bands[i % bands.length]!, x, y, z);
    for (const s of [-1, 1]) {
      const base = k.ground[s > 0 ? 0 : 1] - 1;
      for (let y = base, i = 0; y < 14; y += 2.5, i++) {
        const w = 5.5 - (y - base) * 0.12;
        k.g.add(rock(new BoxGeometry(w, 2.6, 6), i, s * (k.span + 2.2) + k.rng.range(-0.4, 0.4), y + 1.3));
      }
    }
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = k.span + 2.2 - t * (k.span * 2 + 4.4);
      const y = 15 + Math.sin(t * Math.PI) * 2.5;
      const b = rock(new BoxGeometry((k.span * 2 + 4.4) / 9, 3.4 - Math.sin(t * Math.PI), 5.4), i, x, y);
      k.g.add(b);
    }
  },
  /** Star gate: twin light pylons crowned with stars, a beam of light between. */
  star(k) {
    const dark = TrackMaterials.paint('#1a1a4a');
    const cyan = new MeshBasicMaterial({ color: new Color('#8af0ff').multiplyScalar(1.5) });
    const gold = TrackMaterials.emissive('#ffe14d', 2.4);
    const stars: Mesh[] = [];
    for (const s of [-1, 1]) {
      k.g.add(leg(k, s, 9, 1.2, dark));
      k.g.add(mesh(new BoxGeometry(0.3, 9 + 26, 0.3), cyan, s * k.span, -8.5, 0.65));
      const st = mesh(new OctahedronGeometry(1.6), gold, s * k.span, 11, 0);
      st.scale.set(1, 1.4, 0.4);
      stars.push(st);
      k.g.add(st);
    }
    const beam = new MeshBasicMaterial({ color: new Color('#bff8ff'), transparent: true, opacity: 0.45, side: DoubleSide, depthWrite: false });
    k.g.add(mesh(new PlaneGeometry(k.span * 2, 0.5), beam, 0, 11, 0));
    k.g.userData.stars = stars;
  },
  /** Prism gate: tall faceted crystal shards in rainbow tints. */
  crystal(k) {
    const hues = ['#ff5a8a', '#ffb84a', '#fff06a', '#6aff9a', '#5ad8ff', '#9a7aff'];
    const mats = hues.map((c) => new MeshStandardMaterial({ color: c, emissive: new Color(c), emissiveIntensity: 0.7, roughness: 0.1, transparent: true, opacity: 0.8, flatShading: true }));
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const h = k.rng.range(10, 16);
        const c = mesh(new OctahedronGeometry(1), mats[(i + (s > 0 ? 0 : 3)) % mats.length]!, s * (k.span + k.rng.range(0, 1.5)), h / 2 - 6, k.rng.range(-1.5, 1.5));
        c.scale.set(1.3, h / 2 + 3, 1.3);
        c.rotation.z = s * k.rng.range(-0.1, 0.25);
        k.g.add(c);
      }
    }
    // A row of chunky crystals bridging the gap (a flat lintel read as a sheet).
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const c = mesh(new OctahedronGeometry(1), mats[i % mats.length]!, k.span - t * k.span * 2, 13 + Math.sin(t * Math.PI) * 2, 0);
      c.scale.set(1.6, 2.4, 1.6);
      c.rotation.set(k.rng.range(-0.4, 0.4), k.rng.range(0, 3), k.rng.range(-0.4, 0.4));
      k.g.add(c);
    }
    k.g.userData.shimmer = mats;
  },
};

/**
 * A gateway spanning the road (style per course: sponsor gantry, temple gate, neon
 * portal, golden sky ring…). Its legs stand beyond the walls; it moves along the
 * lap to stay clear of jumps, gaps, tunnels and shortcut mouths.
 */
export function buildArch(ctx: BuildContext, p: LandmarkPlacement): void {
  const style = String(p.params?.style ?? 'banner');
  const build = STYLES[style];
  if (!build) return;
  const legOut = 1.6;
  const d = clearDistance(ctx, p.anchor?.distance ?? 0, legOut);
  if (d === null) return;
  const frame = ctx.path.frameAtSplineDistance(ctx.path.startDistance + d);
  const g = new Group();
  g.name = `arch:${style}`;
  g.position.copy(frame.position);
  sampleQuaternion(frame.sample, false, g.quaternion);
  const span = frame.wallOffset + legOut;
  const right = frame.sample.flatRight;
  const groundAt = (side: number): number => {
    if (ctx.def.space) return -2;
    const x = frame.position.x - right.x * side * span;
    const z = frame.position.z - right.z * side * span;
    return ctx.terrain.sample(x, z) - frame.position.y;
  };
  const k: ArchKit = { g, span, ground: [groundAt(1), groundAt(-1)], floating: Boolean(ctx.def.space) || frame.sample.open, rng: new SeededRandom(Math.round(d * 13) + ctx.def.terrain.seed) };
  build(k, ctx);
  g.traverse((o: Object3D) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  ctx.add(g);
  const ud = g.userData as { spin?: Group; roll?: Group; flames?: Mesh[]; flicker?: MeshStandardMaterial[]; pulse?: MeshBasicMaterial[]; beacon?: MeshStandardMaterial; stars?: Mesh[]; shimmer?: MeshStandardMaterial[] };
  if (Object.keys(ud).length) {
    const phase = d * 0.01;
    const base = ud.pulse?.map((m) => m.color.clone());
    ctx.updatables.push({
      update: (dt, time) => {
        if (ud.spin) ud.spin.rotation.z -= dt * 0.8;
        if (ud.roll) ud.roll.rotation.z += dt * 0.25;
        ud.flames?.forEach((f, i) => f.scale.set(1, 0.8 + 0.3 * Math.sin(time * 13 + i * 2), 1));
        ud.flicker?.forEach((m, i) => (m.emissiveIntensity = 1.6 + 0.8 * Math.sin(time * 9 + i * 1.7) * Math.sin(time * 3.1 + i)));
        ud.pulse?.forEach((m, i) => m.color.copy(base![i]!).multiplyScalar(0.75 + 0.35 * Math.sin(time * 3 + i * Math.PI + phase)));
        if (ud.beacon) ud.beacon.emissiveIntensity = Math.sin(time * 6 + phase) > 0 ? 2.6 : 0.2;
        ud.stars?.forEach((s, i) => (s.rotation.y = time * 1.2 + i));
        ud.shimmer?.forEach((m, i) => (m.emissiveIntensity = 0.55 + 0.35 * Math.sin(time * 2 + i)));
      },
    });
  }
}
