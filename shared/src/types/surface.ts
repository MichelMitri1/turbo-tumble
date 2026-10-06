export enum SurfaceType {
  Road = 0,
  Curb = 1,
  Offroad = 2,
  Dirt = 3,
  Boost = 4,
  /** Packed shortcut trail: a little slower than asphalt. */
  Trail = 5,
}

export interface SurfaceParams {
  /** Multiplier on kart top speed */
  speedMul: number;
  /** Multiplier on lateral grip */
  gripMul: number;
  /** Extra linear drag (1/s) applied when over the surface's top speed */
  overspeedDrag: number;
}

export const SURFACE_PARAMS: Record<SurfaceType, SurfaceParams> = {
  [SurfaceType.Road]: { speedMul: 1, gripMul: 1, overspeedDrag: 1.5 },
  [SurfaceType.Curb]: { speedMul: 0.97, gripMul: 0.95, overspeedDrag: 1.5 },
  [SurfaceType.Offroad]: { speedMul: 0.5, gripMul: 0.75, overspeedDrag: 3.2 },
  [SurfaceType.Dirt]: { speedMul: 0.7, gripMul: 0.8, overspeedDrag: 2.5 },
  [SurfaceType.Boost]: { speedMul: 1, gripMul: 1, overspeedDrag: 0.5 },
  [SurfaceType.Trail]: { speedMul: 0.92, gripMul: 0.95, overspeedDrag: 1.6 },
};
