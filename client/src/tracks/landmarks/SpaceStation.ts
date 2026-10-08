import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Object3D,
} from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { roadClearance } from './placement';

/**
 * Starlight Highway's orbital station: a glass-domed hub inside a spinning habitat
 * ring with solar wings, dishes and docking lights, ships looping round it, a
 * few satellites drifting by the road and shooting stars overhead.
 */
export function buildSpaceStation(ctx: BuildContext, _p: LandmarkPlacement): void {
  const { path, def } = ctx;
  const rng = new SeededRandom(def.terrain.seed + 55);
  const ys = path.samples.map((s) => s.position.y);
  const top = Math.max(...ys);
  const cx = path.samples.reduce((a, s) => a + s.position.x, 0) / path.samples.length;
  const cz = path.samples.reduce((a, s) => a + s.position.z, 0) / path.samples.length;
  // Prefer the infield; fall back further out.
  let at = new Vector3(cx, top + 45, cz);
  for (let k = 0; k < 40 && roadClearance(ctx, at.x, at.z) < 70; k++) {
    const a = rng.range(0, Math.PI * 2);
    at = new Vector3(cx + Math.cos(a) * (60 + k * 10), top + 45, cz + Math.sin(a) * (60 + k * 10));
  }

  const station = new Group();
  station.position.copy(at);
  const hull = new MeshStandardMaterial({ color: '#d8dcea', roughness: 0.45, metalness: 0.4 });
  const dark = TrackMaterials.paint('#2a2e48');
  const glow = TrackMaterials.emissive('#8af0ff', 2.2);
  // Hub: a kit glass hangar on a drum.
  const hub = ctx.kits.instantiate('space', 'hangar_roundGlass', 22);
  hub.position.y = 6;
  station.add(hub);
  const drum = new Mesh(new CylinderGeometry(16, 18, 14, 24), hull);
  station.add(drum);
  station.add(new Mesh(new CylinderGeometry(18.2, 18.2, 1.4, 24), glow));
  const keel = new Mesh(new CylinderGeometry(4, 6, 40, 12), hull);
  keel.position.y = -27;
  station.add(keel);
  const beacon = new MeshStandardMaterial({ color: '#ff4a4a', emissive: new Color('#ff2a2a'), emissiveIntensity: 2 });
  const tip = new Mesh(new SphereGeometry(2, 10, 8), beacon);
  tip.position.y = -48;
  station.add(tip);

  // Habitat ring on four spokes, spinning.
  const ring = new Group();
  ring.add(new Mesh(new TorusGeometry(62, 5, 10, 64), hull));
  ring.add(new Mesh(new TorusGeometry(62, 5.3, 4, 64, Math.PI * 2), new MeshBasicMaterial({ color: '#8af0ff', wireframe: true, transparent: true, opacity: 0.25 })));
  for (let i = 0; i < 4; i++) {
    const spoke = new Mesh(new BoxGeometry(46, 2.4, 2.4), dark);
    spoke.position.set(Math.cos((i * Math.PI) / 2) * 39, Math.sin((i * Math.PI) / 2) * 39, 0);
    spoke.rotation.z = (i * Math.PI) / 2;
    ring.add(spoke);
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const win = new Mesh(new BoxGeometry(2, 2, 1), glow);
    win.position.set(Math.cos(a) * 62, Math.sin(a) * 62, 5.2);
    ring.add(win);
  }
  ring.rotation.x = Math.PI / 2;
  const ringHolder = new Group();
  ringHolder.add(ring);
  station.add(ringHolder);

  // Solar wings.
  const panel = new MeshStandardMaterial({ color: '#2a3a9a', emissive: new Color('#1a2a8a'), emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.6 });
  for (const s of [-1, 1]) {
    const mast = new Mesh(new BoxGeometry(70, 1.6, 1.6), dark);
    mast.position.set(s * 100, -10, 0);
    station.add(mast);
    for (let k = 0; k < 3; k++) {
      const wing = new Mesh(new BoxGeometry(16, 0.4, 30), panel);
      wing.position.set(s * (78 + k * 18), -10, 0);
      station.add(wing);
    }
  }
  // Dishes and docking lights on the drum.
  for (let i = 0; i < 3; i++) {
    const dish = ctx.kits.instantiate('space', i % 2 ? 'satelliteDish_detailed' : 'satelliteDish_large', 9);
    const a = (i / 3) * Math.PI * 2;
    dish.position.set(Math.cos(a) * 12, -7, Math.sin(a) * 12);
    dish.rotation.set(Math.PI, a, 0);
    station.add(dish);
  }
  const lights: MeshStandardMaterial[] = [];
  for (let i = 0; i < 8; i++) {
    const m = new MeshStandardMaterial({ color: '#ffe14d', emissive: new Color('#ffd23f'), emissiveIntensity: 1 });
    lights.push(m);
    const l = new Mesh(new SphereGeometry(0.9, 8, 6), m);
    const a = (i / 8) * Math.PI * 2;
    l.position.set(Math.cos(a) * 18.5, 7.5, Math.sin(a) * 18.5);
    station.add(l);
  }
  station.traverse((o) => (o.receiveShadow = true));
  ctx.add(station);

  // Ships looping round the station.
  const ships: Array<{ o: Object3D; r: number; speed: number; tilt: number; phase: number }> = [];
  for (const [i, name] of ['craft_speederA', 'craft_cargoA', 'craft_racer', 'craft_speederA'].entries()) {
    const o = ctx.kits.instantiate('space', name, 5 + (i % 2) * 3);
    const holder = new Group();
    o.rotation.y = Math.PI / 2;
    holder.add(o);
    const trail = new Mesh(new CylinderGeometry(0.2, 1.2, 14, 8, 1, true), new MeshBasicMaterial({ color: '#8af0ff', transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false }));
    trail.rotation.z = Math.PI / 2;
    trail.position.x = -9;
    holder.add(trail);
    ctx.add(holder);
    ships.push({ o: holder, r: 90 + i * 22, speed: 0.25 + i * 0.05, tilt: rng.range(-0.4, 0.4), phase: rng.range(0, 6.28) });
  }

  // A few satellites drifting near the road.
  const sats: Array<{ o: Object3D; base: Vector3; phase: number }> = [];
  for (let i = 0, made = 0; i < 60 && made < 7; i++) {
    const s = path.samples[rng.int(0, path.samples.length - 1)]!;
    const side = rng.chance(0.5) ? 1 : -1;
    const p = s.position.clone().addScaledVector(s.flatRight, side * (s.wallOffset + rng.range(25, 80)));
    p.y += rng.range(-20, 25);
    if (roadClearance(ctx, p.x, p.z) < 18) continue;
    const o = ctx.kits.instantiate('space', rng.pick(['satelliteDish_large', 'satelliteDish_detailed', 'machine_generatorLarge']), rng.range(5, 9));
    o.position.copy(p);
    ctx.add(o);
    sats.push({ o, base: p, phase: rng.range(0, 6.28) });
    made++;
  }

  // Shooting stars: streaks that cross the sky and respawn.
  const streakMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false });
  const streaks = Array.from({ length: 5 }, (_, i) => {
    const m = new Mesh(new BoxGeometry(60, 0.6, 0.6), streakMat);
    ctx.add(m);
    return { m, phase: i / 5, a: rng.range(0, 6.28), h: rng.range(160, 320) };
  });

  ctx.updatables.push({
    update: (_dt, time) => {
      ringHolder.rotation.y = time * 0.12;
      station.rotation.y = Math.sin(time * 0.05) * 0.1;
      lights.forEach((m, i) => (m.emissiveIntensity = (Math.floor(time * 4) % 8) === i ? 3 : 0.4));
      beacon.emissiveIntensity = Math.sin(time * 3) > 0.7 ? 3 : 0.2;
      for (const s of ships) {
        const u = time * s.speed + s.phase;
        s.o.position.set(at.x + Math.cos(u) * s.r, at.y + Math.sin(u) * s.r * s.tilt, at.z + Math.sin(u) * s.r);
        s.o.rotation.set(0, -u, s.tilt);
      }
      for (const s of sats) {
        s.o.position.y = s.base.y + Math.sin(time * 0.3 + s.phase) * 2;
        s.o.rotation.y = time * 0.1 + s.phase;
      }
      for (const st of streaks) {
        const k = (time * 0.12 + st.phase) % 1;
        const r = 900;
        st.m.position.set(cx + Math.cos(st.a) * r * (1 - 2 * k), st.h - k * 80, cz + Math.sin(st.a) * r * 0.4);
        st.m.rotation.y = -st.a;
        st.m.rotation.z = 0.08;
        streakMat.opacity = 0.85;
      }
    },
  });
}
