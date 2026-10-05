import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { SkyDefinition } from '@shared/types/track';

const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to the far plane
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSunGlow;
  uniform vec3 uSunDir;
  uniform float uStars;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.65, h), 0.8));
    col = mix(col, uBottom, smoothstep(0.0, -0.25, h));
    float sun = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunGlow * (pow(sun, 8.0) * 0.35 + pow(sun, 64.0) * 0.6);
    col = mix(col, vec3(1.0), pow(sun, 900.0));
    if (uStars > 0.0) {
      vec3 cell = floor(d * 380.0);
      float star = step(0.9965, hash(cell)) * smoothstep(0.02, 0.3, h);
      col += vec3(star * uStars * (0.6 + 0.4 * hash(cell + 7.0)));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Gradient sky dome with a soft sun glow. Always rendered at the far plane. */
export class Sky {
  readonly mesh: Mesh;

  constructor(def: SkyDefinition, sunDirection: Vector3) {
    const mat = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uTop: { value: new Color(def.top) },
        uHorizon: { value: new Color(def.horizon) },
        uBottom: { value: new Color(def.bottom) },
        uSunGlow: { value: new Color(def.sunGlow) },
        uSunDir: { value: sunDirection.clone().normalize() },
        uStars: { value: def.stars ?? 0 },
      },
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(1000, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  /** Keep the dome centred on the active camera (called per viewport). */
  follow(position: Vector3): void {
    this.mesh.position.copy(position);
  }
}
