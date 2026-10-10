import * as THREE from 'three';

/**
 * Supersonic speed lines: thin streaks rushing past the edges of the view, in camera space.
 * Each streak is a narrow quad facing the camera axis, kept out of the middle of the screen
 * so it never hides the ball. Fades in with `rush` (0..1).
 */
const N = 70;
const Z = new THREE.Vector3(0, 0, 1);

export class SpeedLines {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly lines: Array<{ a: number; r: number; z: number; len: number; w: number; v: number }> = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor() {
    // Unit quad along -z (length 1) and x (width 1); the instance transform sizes and places it.
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    // Fade the ends so streaks don't start and stop with a hard edge.
    const uv = geo.attributes.uv!;
    const colors: number[] = [];
    for (let i = 0; i < uv.count; i++) {
      const f = uv.getY(i) > 0.5 ? 0 : 1;
      colors.push(f, f, f);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, N);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.group.add(this.mesh);
    this.group.visible = false;
    for (let i = 0; i < N; i++) this.lines.push(this.spawn(-2 - Math.random() * 14));
  }

  private spawn(z: number): (typeof this.lines)[number] {
    return { a: Math.random() * Math.PI * 2, r: 1.9 + Math.random() * 2.4, z, len: 1.2 + Math.random() * 2.4, w: 0.012 + Math.random() * 0.02, v: 26 + Math.random() * 18 };
  }

  update(dt: number, camera: THREE.Camera, rush: number): void {
    this.mat.opacity = 0.32 * rush;
    this.group.visible = rush > 0.02;
    if (!this.group.visible) return;
    this.group.position.copy(camera.position);
    this.group.quaternion.copy(camera.quaternion);
    for (let i = 0; i < N; i++) {
      const l = this.lines[i]!;
      l.z += l.v * dt;
      if (l.z > 1) this.lines[i] = this.spawn(-14 - Math.random() * 4);
      const c = this.lines[i]!;
      // Lie in the plane through the view axis that faces it (normal = radial direction).
      this.q.setFromAxisAngle(Z, c.a - Math.PI / 2);
      this.p.set(Math.cos(c.a) * c.r, Math.sin(c.a) * c.r, c.z);
      this.s.set(c.w, 1, c.len);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
