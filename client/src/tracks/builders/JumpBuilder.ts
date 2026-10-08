import { BoxGeometry, BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshStandardMaterial, RepeatWrapping } from 'three';
import { buildJumpSurface } from '@shared/track/JumpGeometry';
import type { BuildContext } from '../BuildContext';
import { toGeometry } from '../../rendering/meshData';
import { boostPadTexture } from '../../rendering/ProceduralTextures';

/** Big chevron ramps with the same gold/cyan vocabulary as the boost pads. */
export function buildJumps(ctx: BuildContext): void {
  const tex = boostPadTexture().clone();
  tex.wrapS = tex.wrapT = RepeatWrapping;
  const mat = new MeshStandardMaterial({ map: tex, emissive: '#ffb52e', emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.65 });
  // Kickers and trick bumps are cyan/violet so they read as "hop here" rather than "launch".
  const trick = new MeshStandardMaterial({ map: tex, color: '#9ae8ff', emissive: '#3fd8ff', emissiveMap: tex, emissiveIntensity: 0.5, roughness: 0.6 });
  const edge = new MeshStandardMaterial({ color: '#fff3c0', emissive: '#3fd8ff', emissiveIntensity: 0.45, roughness: 0.6 });
  const sides = new MeshStandardMaterial({ color: '#344367', roughness: 0.8, side: DoubleSide });
  for (const jump of ctx.def.jumps) {
    const ramp = new Mesh(toGeometry(buildJumpSurface(ctx.path, jump)), jump.launchSpeed < 14 ? trick : mat);
    ramp.name = 'jump-ramp';
    ramp.castShadow = ramp.receiveShadow = true;
    ctx.add(ramp);
    const skirt: number[] = [];
    const top = ramp.geometry.getAttribute('position');
    const steps = top.count / 2 - 1;
    const point = (i: number, side: number, raised: boolean): number[] => {
      const index = i * 2 + side;
      return [top.getX(index), top.getY(index) - (raised ? 0 : 0.04 + jump.rise * (i / steps) ** 2), top.getZ(index)];
    };
    const quad = (a: number[], b: number[], c: number[], d: number[]): void => { skirt.push(...a, ...b, ...c, ...a, ...c, ...d); };
    for (let i = 0; i < steps; i++) for (const side of [0, 1]) quad(point(i, side, true), point(i, side, false), point(i + 1, side, false), point(i + 1, side, true));
    quad(point(steps, 0, true), point(steps, 0, false), point(steps, 1, false), point(steps, 1, true));
    const shell = new BufferGeometry();
    shell.setAttribute('position', new Float32BufferAttribute(skirt, 3));
    shell.computeVertexNormals();
    const support = new Mesh(shell, sides);
    support.castShadow = support.receiveShadow = true;
    ctx.add(support);
    // Short illuminated edge blocks make the takeoff lip readable at speed.
    for (const side of [-1, 1]) {
      const f = ctx.path.anchorToWorld({ distance: jump.distance + jump.length, lateral: (jump.lateral ?? 0) + side * (jump.width / 2 + 0.25) });
      const marker = new Mesh(new BoxGeometry(0.5, jump.rise + 0.5, 1.2), edge);
      marker.position.copy(f.position);
      marker.position.y += (jump.rise + 0.5) / 2;
      marker.rotation.y = Math.atan2(f.tangent.x, f.tangent.z);
      ctx.add(marker);
    }
  }
}
