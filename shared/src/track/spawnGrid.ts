import { Vector3 } from 'three';
import type { TrackAnchor } from '../types/track';
import type { TrackPath } from './TrackPath';

export interface SpawnSlot {
  position: Vector3;
  forward: Vector3;
}

/** Track-space anchor of grid slot `slot` (0 = pole position). */
export function spawnSlotAnchor(path: TrackPath, slot: number): Required<Pick<TrackAnchor, 'distance' | 'lateral'>> {
  const g = path.def.spawnGrid;
  const cols = g.columns.length;
  const row = Math.floor(slot / cols);
  const col = slot % cols;
  return { distance: -(g.firstRowOffset + row * g.rowSpacing + col * g.stagger), lateral: g.columns[col]! };
}

/** World transform of grid slot `slot`. */
export function spawnSlot(path: TrackPath, slot: number): SpawnSlot {
  const frame = path.anchorToWorld({ ...spawnSlotAnchor(path, slot), height: 0.4 });
  return { position: frame.position.clone(), forward: frame.tangent.clone() };
}
