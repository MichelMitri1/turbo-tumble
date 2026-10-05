import { BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial, Vector3 } from 'three';

const MAX_QUADS = 4000;
const LIFE = 9;
const WIDTH = 0.42;
const MIN_STEP = 0.35;
const LIFT = 0.035;

const vertex = /* glsl */ `
  attribute float aBirth;
  uniform float uTime;
  uniform float uLife;
  varying float vAlpha;
  #include <fog_pars_vertex>
  void main() {
    float age = uTime - aBirth;
    vAlpha = aBirth < 0.0 ? 0.0 : clamp(1.0 - age / uLife, 0.0, 1.0);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(uColor, vAlpha * 0.5);
    #include <fog_fragment>
  }
`;

interface Trail {
  last: Vector3;
  active: boolean;
}

/**
 * Tyre marks: one ring buffer of ground quads for the whole race (one draw
 * call). Each emitter (kart wheel) extends its strip while it slides; quads
 * fade out in the shader by age.
 */
export class SkidMarks {
  readonly mesh: Mesh;
  private readonly pos: Float32Array;
  private readonly birth: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly birthAttr: BufferAttribute;
  private readonly material: ShaderMaterial;
  private readonly trails = new Map<string, Trail>();
  private cursor = 0;
  private time = 0;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  private readonly side = new Vector3();

  constructor() {
    this.pos = new Float32Array(MAX_QUADS * 4 * 3);
    this.birth = new Float32Array(MAX_QUADS * 4).fill(-1);
    const index = new Uint32Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) {
      const v = q * 4;
      index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], q * 6);
    }
    const geo = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.birthAttr = new BufferAttribute(this.birth, 1);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aBirth', this.birthAttr);
    geo.setIndex(new BufferAttribute(index, 1));
    this.material = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uTime: { value: 0 }, uLife: { value: LIFE }, uColor: { value: new Color('#1d1a24') }, fogColor: { value: new Color() }, fogNear: { value: 1 }, fogFar: { value: 2000 } },
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.name = 'skid-marks';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Feed a wheel's ground contact this frame; `sliding` false ends its strip. */
  emit(key: string, contact: Vector3, sliding: boolean): void {
    let trail = this.trails.get(key);
    if (!trail) this.trails.set(key, (trail = { last: contact.clone(), active: false }));
    if (!sliding) {
      trail.active = false;
      return;
    }
    if (!trail.active) {
      trail.active = true;
      trail.last.copy(contact);
      return;
    }
    const dx = contact.x - trail.last.x;
    const dz = contact.z - trail.last.z;
    const len = Math.hypot(dx, dz);
    if (len < MIN_STEP) return;
    if (len > 6) {
      // Teleport (respawn): restart the strip.
      trail.last.copy(contact);
      return;
    }
    this.side.set(-dz / len, 0, dx / len).multiplyScalar(WIDTH / 2);
    this.quad(trail.last, contact);
    trail.last.copy(contact);
  }

  private quad(a: Vector3, b: Vector3): void {
    const q = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_QUADS;
    const s = this.side;
    const p = this.pos;
    const o = q * 12;
    p[o] = a.x - s.x;
    p[o + 1] = a.y + LIFT;
    p[o + 2] = a.z - s.z;
    p[o + 3] = a.x + s.x;
    p[o + 4] = a.y + LIFT;
    p[o + 5] = a.z + s.z;
    p[o + 6] = b.x - s.x;
    p[o + 7] = b.y + LIFT;
    p[o + 8] = b.z - s.z;
    p[o + 9] = b.x + s.x;
    p[o + 10] = b.y + LIFT;
    p[o + 11] = b.z + s.z;
    this.birth.fill(this.time, q * 4, q * 4 + 4);
    this.dirtyFrom = Math.min(this.dirtyFrom, q);
    this.dirtyTo = Math.max(this.dirtyTo, q);
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime!.value = this.time;
    if (this.dirtyTo < 0) return;
    const from = this.dirtyFrom;
    const count = this.dirtyTo - from + 1;
    this.posAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(from * 12, count * 12);
    this.posAttr.needsUpdate = true;
    this.birthAttr.clearUpdateRanges();
    this.birthAttr.addUpdateRange(from * 4, count * 4);
    this.birthAttr.needsUpdate = true;
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  /** New race: wipe all marks. */
  clear(): void {
    this.birth.fill(-1);
    this.birthAttr.clearUpdateRanges();
    this.birthAttr.needsUpdate = true;
    this.trails.clear();
  }
}
