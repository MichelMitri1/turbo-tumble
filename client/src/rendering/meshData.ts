import { BufferAttribute, BufferGeometry } from 'three';
import type { MeshData } from '@shared/track/Extrude';

/** Wrap shared MeshData arrays in a Three.js geometry (no copies). */
export function toGeometry(data: MeshData, computeNormals = !data.normals): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(data.positions, 3));
  g.setAttribute('uv', new BufferAttribute(data.uvs, 2));
  if (data.normals) g.setAttribute('normal', new BufferAttribute(data.normals, 3));
  if (data.colors) g.setAttribute('color', new BufferAttribute(data.colors, 3));
  g.setIndex(new BufferAttribute(data.indices, 1));
  if (computeNormals) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
