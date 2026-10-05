import { Group, InstancedMesh, Matrix4, type Mesh, type Object3D } from 'three';

export interface InstancedModelOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  name?: string;
}

/**
 * Render many copies of a (possibly multi-mesh, multi-material) model with one
 * draw call per sub-mesh. Geometry and materials are shared with the template.
 */
export function createInstancedModel(template: Object3D, matrices: Matrix4[], opts: InstancedModelOptions = {}): Group {
  const group = new Group();
  group.name = opts.name ?? `instanced:${template.name}`;
  if (matrices.length === 0) return group;
  template.updateMatrixWorld(true);
  const local = new Matrix4();
  const m = new Matrix4();
  template.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    local.copy(mesh.matrixWorld);
    const inst = new InstancedMesh(mesh.geometry, mesh.material, matrices.length);
    matrices.forEach((mat, i) => inst.setMatrixAt(i, m.multiplyMatrices(mat, local)));
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = opts.castShadow ?? false;
    inst.receiveShadow = opts.receiveShadow ?? true;
    inst.computeBoundingSphere();
    group.add(inst);
  });
  return group;
}
