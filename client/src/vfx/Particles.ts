import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Blending,
  type Texture,
} from 'three';

export interface ParticleSpawn {
  position: Vector3;
  velocity?: Vector3;
  color: Color | string;
  /** Start / end size (m). */
  size: [number, number];
  life: number;
  gravity?: number;
  drag?: number;
  /** Start alpha (fades to 0). */
  alpha?: number;
}

let softTexture: Texture | null = null;
function soft(): Texture {
  if (softTexture) return softTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  softTexture = new CanvasTexture(c);
  return softTexture;
}

const vertex = /* glsl */ `
  attribute vec4 aColor;   // rgb + alpha
  attribute float aSize;
  varying vec4 vColor;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vColor = aColor;
    vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
    mvPosition.xy += position.xy * aSize;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColor;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    float a = texture2D(uMap, vUv).a * vColor.a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, a);
    #include <fog_fragment>
  }
`;

/**
 * Pooled camera-facing particles in a single draw call. Billboarding happens in the
 * vertex shader against whichever camera is rendering, so it works per split-screen
 * viewport.
 */
export class ParticleSystem {
  readonly mesh: InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly colorAttr: InstancedBufferAttribute;
  private readonly sizeAttr: InstancedBufferAttribute;
  private cursor = 0;
  private readonly m = new Matrix4();
  private readonly c = new Color();

  constructor(
    readonly capacity: number,
    blending: Blending = AdditiveBlending,
  ) {
    const geo = new PlaneGeometry(1, 1);
    this.colorAttr = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.sizeAttr = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    geo.setAttribute('aColor', this.colorAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    const mat = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uMap: { value: soft() }, fogColor: { value: new Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } },
      transparent: true,
      depthWrite: false,
      blending,
      fog: true,
    });
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = blending === NormalBlending ? 5 : 6;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
  }

  spawn(p: ParticleSpawn): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const k = i * 3;
    this.pos[k] = p.position.x;
    this.pos[k + 1] = p.position.y;
    this.pos[k + 2] = p.position.z;
    const v = p.velocity;
    this.vel[k] = v ? v.x : 0;
    this.vel[k + 1] = v ? v.y : 0;
    this.vel[k + 2] = v ? v.z : 0;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.size0[i] = p.size[0];
    this.size1[i] = p.size[1];
    this.alpha0[i] = p.alpha ?? 1;
    this.grav[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 0;
    const c = typeof p.color === 'string' ? this.c.set(p.color) : p.color;
    this.colorAttr.setXYZW(i, c.r, c.g, c.b, this.alpha0[i]!);
  }

  update(dt: number): void {
    const n = this.capacity;
    for (let i = 0; i < n; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i] = this.life[i]! - dt;
      const k = i * 3;
      if (this.life[i]! <= 0) {
        this.sizeAttr.setX(i, 0);
        this.colorAttr.setW(i, 0);
        continue;
      }
      const drag = Math.exp(-this.drag[i]! * dt);
      this.vel[k] = this.vel[k]! * drag;
      this.vel[k + 1] = this.vel[k + 1]! * drag - this.grav[i]! * dt;
      this.vel[k + 2] = this.vel[k + 2]! * drag;
      this.pos[k] = this.pos[k]! + this.vel[k]! * dt;
      this.pos[k + 1] = this.pos[k + 1]! + this.vel[k + 1]! * dt;
      this.pos[k + 2] = this.pos[k + 2]! + this.vel[k + 2]! * dt;
      const t = 1 - this.life[i]! / this.maxLife[i]!;
      this.sizeAttr.setX(i, this.size0[i]! + (this.size1[i]! - this.size0[i]!) * t);
      this.colorAttr.setW(i, this.alpha0[i]! * (1 - t * t));
      this.mesh.setMatrixAt(i, this.m.makeTranslation(this.pos[k]!, this.pos[k + 1]!, this.pos[k + 2]!));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}
