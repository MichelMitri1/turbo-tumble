export interface GraphicsSettings {
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Half-extent of the orthographic shadow frustum that follows the player (m). */
  shadowRange: number;
  maxPixelRatio: number;
  /** Multiplier on scattered decoration counts. */
  decorDensity: number;
}

export const DEFAULT_GRAPHICS: GraphicsSettings = {
  antialias: true,
  shadows: true,
  shadowMapSize: 2048,
  shadowRange: 70,
  maxPixelRatio: 2,
  decorDensity: 1,
};
