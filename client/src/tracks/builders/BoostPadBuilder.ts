import { BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, RepeatWrapping } from 'three';
import type { BuildContext } from '../BuildContext';
import { boostPadTexture } from '../../rendering/ProceduralTextures';

/** Glowing chevron pads painted on the road; the chevrons scroll forward. */
export function buildBoostPads(ctx: BuildContext): void {
  if (!ctx.def.boostPads.length) return;
  const tex = boostPadTexture().clone();
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.needsUpdate = true;
  const mat = new MeshStandardMaterial({
    map: tex,
    emissive: '#ffffff',
    emissiveMap: tex,
    emissiveIntensity: 0.9,
    roughness: 0.4,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  for (const pad of ctx.def.boostPads) {
    const corner = (along: number, across: number): number[] => {
      const f = ctx.path.anchorToWorld({ distance: pad.distance + along, lateral: (pad.lateral ?? 0) + across, height: 0.03 });
      return [f.position.x, f.position.y, f.position.z];
    };
    const hl = pad.length / 2;
    const hw = pad.width / 2;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([...corner(-hl, -hw), ...corner(-hl, hw), ...corner(hl, -hw), ...corner(hl, hw)], 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, pad.length / pad.width, 1, pad.length / pad.width], 2));
    g.setIndex([0, 1, 2, 1, 3, 2]);
    g.computeVertexNormals();
    const m = new Mesh(g, mat);
    m.name = 'boost-pad';
    m.receiveShadow = true;
    ctx.add(m);
  }
  ctx.updatables.push({ update: (_dt, time) => (tex.offset.y = -time * 1.6) });
}
