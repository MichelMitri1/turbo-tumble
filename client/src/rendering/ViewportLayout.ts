/** Normalised viewport rectangle (0..1, top-left origin). */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TwoPlayerSplit = 'horizontal' | 'vertical';

/**
 * Split-screen layouts for 1–4 local players.
 * - 2P: stacked (horizontal split) or side-by-side (vertical split)
 * - 3P: balanced 2×2 grid — the 4th quarter shows a race "TV camera" (see tvViewport)
 * - 4P: 2×2 grid
 */
export function computeViewports(count: number, twoPlayer: TwoPlayerSplit = 'horizontal'): ViewportRect[] {
  switch (count) {
    case 1:
      return [{ x: 0, y: 0, width: 1, height: 1 }];
    case 2:
      return twoPlayer === 'horizontal'
        ? [
            { x: 0, y: 0, width: 1, height: 0.5 },
            { x: 0, y: 0.5, width: 1, height: 0.5 },
          ]
        : [
            { x: 0, y: 0, width: 0.5, height: 1 },
            { x: 0.5, y: 0, width: 0.5, height: 1 },
          ];
    case 3:
      return [
        { x: 0, y: 0, width: 0.5, height: 0.5 },
        { x: 0.5, y: 0, width: 0.5, height: 0.5 },
        { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      ];
    default:
      return [
        { x: 0, y: 0, width: 0.5, height: 0.5 },
        { x: 0.5, y: 0, width: 0.5, height: 0.5 },
        { x: 0, y: 0.5, width: 0.5, height: 0.5 },
        { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
      ];
  }
}

/** Spare quarter used as a spectator view in 3-player games, else null. */
export function tvViewport(count: number): ViewportRect | null {
  return count === 3 ? { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } : null;
}
