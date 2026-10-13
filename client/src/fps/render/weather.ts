import * as THREE from 'three';

/**
 * Falling snow around the camera (snow maps): flakes in a box that follows the eye, drifting
 * on the wind and recycled when they land, so a few thousand points cover any map.
 */
const N = 2600;
const BOX = 26;
const TOP = 16;

export class Weather {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private t = 0;

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * BOX * 2;
      this.pos[i * 3 + 1] = Math.random() * TOP;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * BOX * 2;
      this.vel[i] = 0.9 + Math.random() * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    const mat = new THREE.PointsMaterial({ size: 0.11, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, color: '#f4f8ff', opacity: 0.9, sizeAttenuation: true });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  /** Move the flakes; `eye` is where the (first) camera is. */
  update(dt: number, eye: THREE.Vector3): void {
    this.t += dt;
    const wx = Math.sin(this.t * 0.3) * 0.8 + 0.6;
    const wz = Math.cos(this.t * 0.23) * 0.5;
    const p = this.pos;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      p[k] += (wx + Math.sin(this.t * 1.7 + i) * 0.35) * dt;
      p[k + 1] -= this.vel[i]! * dt;
      p[k + 2] += (wz + Math.cos(this.t * 1.3 + i * 0.7) * 0.35) * dt;
      // Recycle: below the ground, or out of the box round the eye.
      if (p[k + 1]! < 0 || p[k + 1]! > eye.y + TOP) p[k + 1] = eye.y + TOP * (0.6 + Math.random() * 0.4);
      if (p[k]! < eye.x - BOX) p[k] += BOX * 2;
      else if (p[k]! > eye.x + BOX) p[k] -= BOX * 2;
      if (p[k + 2]! < eye.z - BOX) p[k + 2] += BOX * 2;
      else if (p[k + 2]! > eye.z + BOX) p[k + 2] -= BOX * 2;
    }
    const a = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    a.needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    const m = this.points.material as THREE.PointsMaterial;
    m.map?.dispose();
    m.dispose();
  }
}
