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
  private pendingWidth = 0;
  private pendingHeight = 0;
  private pendingSince = 0;
  /** Mirror mode: the canvas is flipped by CSS, so viewports are laid out flipped to land back in place. */
  private mirrored = false;

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

    // Mobile browsers report several temporary sizes while their address bar,
    // safe areas and orientation are changing. Keep rendering the previous
    // projection until the new CSS viewport has been stable for a moment.
    if (this.width > 1 && this.height > 1 && (w !== this.pendingWidth || h !== this.pendingHeight)) {
      this.pendingWidth = w;
      this.pendingHeight = h;
      this.pendingSince = performance.now();
      return false;
    }
    if (this.width > 1 && this.height > 1 && performance.now() - this.pendingSince < 120) return false;

    this.width = w;
    this.height = h;
    this.pendingWidth = w;
    this.pendingHeight = h;
    this.gl.setPixelRatio(ratio);
    this.gl.setSize(w, h, false);
    return true;
  }

  render(scene: Scene, views: ViewRender[]): void {
    for (const v of views) {
      // WebGL viewports are bottom-left based; our rects are top-left based.
      const x = Math.round((this.mirrored ? 1 - v.rect.x - v.rect.width : v.rect.x) * this.width);
      const w = Math.round(v.rect.width * this.width);
      const h = Math.round(v.rect.height * this.height);
      const y = Math.round((1 - v.rect.y - v.rect.height) * this.height);
      this.gl.setViewport(x, y, w, h);
      this.gl.setScissor(x, y, w, h);
      this.gl.render(scene, v.camera);
    }
  }

  setMirror(on: boolean): void {
    this.mirrored = on;
    this.canvas.style.transform = on ? 'scaleX(-1)' : '';
  }

  get info(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.gl.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }
}
