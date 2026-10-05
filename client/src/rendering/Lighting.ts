import { Color, DirectionalLight, HemisphereLight, Matrix4, Object3D, Vector3, type Scene } from 'three';
import type { LightingDefinition } from '@shared/types/track';
import type { GraphicsSettings } from '../config/graphics';

/**
 * Sun + sky lighting. The sun's shadow frustum is small and follows the focus point
 * (snapped to shadow texels to avoid shimmering) so kart shadows stay crisp.
 */
export class Lighting {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly sunDirection: Vector3;
  private readonly target = new Object3D();
  private readonly lightView = new Matrix4();
  private readonly lightViewInv = new Matrix4();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private texel: number;
  private range: number;

  constructor(
    scene: Scene,
    def: LightingDefinition,
    private readonly settings: GraphicsSettings,
  ) {
    this.sunDirection = new Vector3(...def.sunDirection).normalize();
    this.hemi = new HemisphereLight(new Color(def.skyColor), new Color(def.groundColor), def.hemiIntensity);
    scene.add(this.hemi);

    this.sun = new DirectionalLight(new Color(def.sunColor), def.sunIntensity);
    this.sun.target = this.target;
    scene.add(this.sun, this.target);

    const r = settings.shadowRange;
    this.range = r;
    this.texel = (r * 2) / settings.shadowMapSize;
    if (settings.shadows) {
      this.sun.castShadow = true;
      const cam = this.sun.shadow.camera;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 1;
      cam.far = 600;
      this.sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.04;
      this.sun.shadow.radius = 2;
    }
    // Rotation-only light view used for texel snapping.
    this.lightView.lookAt(this.sunDirection, new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    this.lightViewInv.copy(this.lightView).invert();
  }

  /** Re-tune for another track (colours, intensities, sun direction). */
  configure(def: LightingDefinition): void {
    this.sunDirection.set(...def.sunDirection).normalize();
    this.hemi.color.set(def.skyColor);
    this.hemi.groundColor.set(def.groundColor);
    this.hemi.intensity = def.hemiIntensity;
    this.sun.color.set(def.sunColor);
    this.sun.intensity = def.sunIntensity;
    this.lightView.lookAt(this.sunDirection, new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    this.lightViewInv.copy(this.lightView).invert();
  }

  /**
   * Fit the shadow frustum around every local player (split-screen). Single
   * player keeps the crisp default range; spread-out players widen it.
   */
  fit(points: readonly Vector3[]): void {
    if (points.length === 0) return;
    const center = this.tmp2.set(0, 0, 0);
    for (const p of points) center.add(p);
    center.divideScalar(points.length);
    let spread = 0;
    for (const p of points) spread = Math.max(spread, p.distanceTo(center));
    const range = Math.min(260, Math.max(this.settings.shadowRange, spread + 45));
    if (Math.abs(range - this.range) > 4) this.setRange(range);
    this.follow(center);
  }

  private setRange(r: number): void {
    this.range = r;
    this.texel = (r * 2) / this.settings.shadowMapSize;
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.updateProjectionMatrix();
  }

  /** Centre the shadow frustum slightly ahead of the focus point. */
  follow(focus: Vector3): void {
    const p = this.tmp.copy(focus).applyMatrix4(this.lightViewInv);
    p.x = Math.round(p.x / this.texel) * this.texel;
    p.y = Math.round(p.y / this.texel) * this.texel;
    p.applyMatrix4(this.lightView);
    this.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(this.sunDirection, 300);
    this.target.updateMatrixWorld();
  }

  get shadowRange(): number {
    return this.settings.shadowRange;
  }
}
