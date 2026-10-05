import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry } from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import type { BuildContext } from '../BuildContext';
import { gantryBannerTexture } from '../../rendering/ProceduralTextures';
import { TrackMaterials } from '../materials';
import { sampleQuaternion } from '../frames';

/**
 * Start/finish gantry spanning the track: twin pylons, a branded banner beam and a
 * row of start lights (exposed via userData for the countdown in Phase 2).
 */
export function buildStartGantry(ctx: BuildContext, p: LandmarkPlacement): void {
  const frame = ctx.path.frameAtSplineDistance(ctx.path.startDistance + (p.anchor?.distance ?? 0));
  const s = frame.sample;
  const g = new Group();
  g.name = 'start-gantry';
  g.position.copy(frame.position);
  sampleQuaternion(s, false, g.quaternion);

  const span = frame.wallOffset + 0.9;
  const height = 10.5;
  const navy = TrackMaterials.paint('#2a2172');
  const yellow = TrackMaterials.paint('#ffd23f');

  for (const side of [-1, 1]) {
    const groundY = ctx.terrain.sample(
      frame.position.x - s.flatRight.x * side * span,
      frame.position.z - s.flatRight.z * side * span,
    ) - frame.position.y;
    const pylonH = height + 1.4 - groundY;
    const pylon = new Mesh(new BoxGeometry(1.5, pylonH, 1.5), navy);
    pylon.position.set(side * span, groundY + pylonH / 2, 0);
    const band = new Mesh(new BoxGeometry(1.56, 1.1, 1.56), yellow);
    band.position.set(side * span, groundY + 2.2, 0);
    g.add(pylon, band);
  }

  const beamW = span * 2 + 1.5;
  const beam = new Mesh(new BoxGeometry(beamW, 3.0, 1.2), navy);
  beam.position.set(0, height, 0);
  g.add(beam);

  const bannerMat = new MeshStandardMaterial({ map: gantryBannerTexture(), roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.08 });
  bannerMat.emissiveMap = bannerMat.map;
  for (const face of [-1, 1]) {
    const banner = new Mesh(new PlaneGeometry(beamW - 0.6, 2.6), bannerMat);
    banner.position.set(0, height, face * 0.61);
    // Local -Z faces oncoming karts; the plane's +Z normal must point outward.
    banner.rotation.y = face === -1 ? Math.PI : 0;
    g.add(banner);
  }

  // Start lights hanging under the beam.
  const housingMat = TrackMaterials.paint('#14121c');
  const lights: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 1.6;
    const housing = new Mesh(new BoxGeometry(1.2, 1.2, 0.8), housingMat);
    housing.position.set(x, height - 2.1, -0.1);
    const lamp = new Mesh(
      new SphereGeometry(0.42, 16, 12),
      new MeshStandardMaterial({ color: '#3a0a0a', emissive: '#ff2a2a', emissiveIntensity: 0.15, roughness: 0.3 }),
    );
    lamp.position.set(x, height - 2.1, -0.52);
    g.add(housing, lamp);
    lights.push(lamp);
  }
  g.userData.startLights = lights;

  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  ctx.add(g);
}
