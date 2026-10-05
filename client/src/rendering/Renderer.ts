import {
  NeutralToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  WebGLRenderer,
  type Scene,
} from 'three';
import type { ViewportRect } from './ViewportLayout';
import type { GraphicsSettings } from '../config/graphics';

export interface ViewRender {
  camera: PerspectiveCamera;
  rect: ViewportRect;
}

/**
 * Owns the WebGL context. Renders one or more viewports (split-screen) per frame
 * using scissor rectangles on a single canvas.
 */
export class Renderer {
  readonly gl: WebGLRenderer;
  private width = 1;
  private height = 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private settings: GraphicsSettings,
  ) {
    this.gl = new WebGLRenderer({
      canvas,
      antialias: settings.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = NeutralToneMapping;
    this.gl.toneMappingExposure = 1;
    this.gl.shadowMap.enabled = settings.shadows;
    this.gl.shadowMap.type = PCFSoftShadowMap;
    this.gl.setScissorTest(true);
    this.resize();
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  get maxAnisotropy(): number {
    return this.gl.capabilities.getMaxAnisotropy();
  }

  setExposure(v: number): void {
    this.gl.toneMappingExposure = v;
  }

  resize(): boolean {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio);
    if (w === this.width && h === this.height && this.gl.getPixelRatio() === ratio) return false;
    this.width = w;
    this.height = h;
    this.gl.setPixelRatio(ratio);
    this.gl.setSize(w, h, false);
    return true;
  }

  render(scene: Scene, views: ViewRender[]): void {
    for (const v of views) {
      // WebGL viewports are bottom-left based; our rects are top-left based.
      const x = Math.round(v.rect.x * this.width);
      const w = Math.round(v.rect.width * this.width);
      const h = Math.round(v.rect.height * this.height);
      const y = Math.round((1 - v.rect.y - v.rect.height) * this.height);
      this.gl.setViewport(x, y, w, h);
      this.gl.setScissor(x, y, w, h);
      this.gl.render(scene, v.camera);
    }
  }

  get info(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.gl.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }
}
