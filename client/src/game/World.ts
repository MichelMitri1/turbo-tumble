import { BufferGeometry, Color, Float32BufferAttribute, Fog, Line, LineBasicMaterial, PMREMGenerator, Scene, type Mesh, type Object3D, type Texture } from 'three';
import { computeRacingLine } from '@shared/track/RacingLine';
import { PhysicsWorld } from '@shared/physics/PhysicsWorld';
import { getTrack } from '@shared/tracks/registry';
import type { AssetLoader } from '../assets/AssetLoader';
import type { GraphicsSettings } from '../config/graphics';
import { Lighting } from '../rendering/Lighting';
import type { Renderer } from '../rendering/Renderer';
import { Sky } from '../rendering/Sky';
import { loadTrack, type TrackRuntime } from '../tracks/TrackBuilder';

export type WorldProgress = (fraction: number, label: string) => void;

/**
 * Everything that belongs to the current track: collision world, track scene,
 * sky, fog, lights and image-based lighting. `load()` swaps tracks at runtime
 * (menus, Grand Prix, online rooms).
 */
export class World {
  physics: PhysicsWorld | null = null;
  track!: TrackRuntime;
  lighting!: Lighting;
  private sky: Mesh | null = null;
  private envMap: Texture | null = null;
  private line: Line | null = null;
  lineVisible = false;

  constructor(
    private readonly scene: Scene,
    private readonly renderer: Renderer,
    private readonly assets: AssetLoader,
    private readonly graphics: GraphicsSettings,
  ) {}

  get trackId(): string | null {
    return this.track?.def.id ?? null;
  }

  async load(trackId: string, onProgress: WorldProgress): Promise<boolean> {
    if (this.trackId === trackId) return false;
    const def = getTrack(trackId);
    this.unload();
    const physics = (this.physics = new PhysicsWorld());

    // Environment.
    const scene = this.scene;
    scene.background = new Color(def.sky.horizon);
    scene.fog = new Fog(new Color(def.sky.fogColor), def.sky.fogNear, def.sky.fogFar);
    if (!this.lighting) this.lighting = new Lighting(scene, def.lighting, this.graphics);
    else this.lighting.configure(def.lighting);
    this.renderer.setExposure(def.lighting.exposure);
    this.sky = new Sky(def.sky, this.lighting.sunDirection).mesh;
    scene.add(this.sky);
    this.bakeEnvironment(def.sky, this.lighting.sunDirection);

    this.track = await loadTrack(def, { assets: this.assets, physics, graphics: this.graphics }, onProgress);
    scene.add(this.track.root);
    this.buildRacingLine();
    return true;
  }

  private unload(): void {
    if (this.track) {
      this.scene.remove(this.track.root);
      disposeGeometries(this.track.root);
    }
    if (this.sky) this.scene.remove(this.sky);
    if (this.line) {
      this.scene.remove(this.line);
      this.line.geometry.dispose();
    }
    this.physics?.dispose();
  }

  /** Image-based lighting from the sky so materials pick up sky/ground bounce. */
  private bakeEnvironment(skyDef: ConstructorParameters<typeof Sky>[0], sun: ConstructorParameters<typeof Sky>[1]): void {
    const pmrem = new PMREMGenerator(this.renderer.gl);
    const envScene = new Scene();
    envScene.add(new Sky(skyDef, sun).mesh);
    this.envMap?.dispose();
    this.envMap = pmrem.fromScene(envScene, 0, 0.1, 3000).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }

  /** F5 debug: the computed racing line (colour = target speed, red slow → green fast). */
  private buildRacingLine(): void {
    const path = this.track.path;
    const line = computeRacingLine(path);
    const pos: number[] = [];
    const col: number[] = [];
    const c = new Color();
    for (let i = 0; i <= path.samples.length; i++) {
      const k = i % path.samples.length;
      const s = path.samples[k]!;
      const p = s.position.clone().addScaledVector(s.right, line.lateral[k]!).addScaledVector(s.up, 0.3);
      pos.push(p.x, p.y, p.z);
      const t = Math.min(1, Math.max(0, (line.speed[k]! - 20) / 15));
      c.setRGB(1 - t, t, 0.2);
      col.push(c.r, c.g, c.b);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.line = new Line(g, new LineBasicMaterial({ vertexColors: true, depthTest: false }));
    this.line.visible = this.lineVisible;
    this.line.renderOrder = 998;
    this.scene.add(this.line);
  }

  toggleRacingLine(): void {
    this.lineVisible = !this.lineVisible;
    if (this.line) this.line.visible = this.lineVisible;
  }
}

/** Free per-track geometry (materials and textures are shared caches). */
function disposeGeometries(root: Object3D): void {
  root.traverse((o) => {
    const g = (o as Mesh).geometry as BufferGeometry | undefined;
    g?.dispose?.();
  });
}
