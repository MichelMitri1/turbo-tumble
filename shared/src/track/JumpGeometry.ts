import type { JumpDefinition } from '../types/track';
import type { MeshData } from './Extrude';
import type { TrackPath } from './TrackPath';

/** Same curved ramp surface for rendering and Rapier ground queries. */
export function buildJumpSurface(path: TrackPath, jump: JumpDefinition): MeshData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const steps = Math.ceil(jump.length / 1.5);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    for (const side of [-1, 1]) {
      const frame = path.anchorToWorld({ distance: jump.distance + t * jump.length, lateral: (jump.lateral ?? 0) + side * jump.width / 2 });
      // Vertical rise matches the launch test even on a banked road.
      positions.push(frame.position.x, frame.position.y + 0.04 + jump.rise * t * t, frame.position.z);
      uvs.push((side + 1) / 2, t * jump.length / jump.width);
    }
    if (i < steps) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  return { positions: new Float32Array(positions), normals: null, uvs: new Float32Array(uvs), colors: null, indices: new Uint32Array(indices) };
}
