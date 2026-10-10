import * as THREE from 'three';
import type { Frame } from '../input';
import type { Player } from '../actors/player';
import { physics } from '../physics';

/**
 * Third-person camera: orbit behind you on foot (over the right shoulder when aiming,
 * scope view for the sniper), a chase camera in cars that swings back behind the car when
 * you stop steering it with the mouse; walls never get between you and the camera.
 */

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(65, 1, 0.1, 950);
  yaw = Math.PI;
  pitch = -0.18;
  private dist = 4;
  private freeT = 0;
  carView = 0;
  /** First person (on foot: toggled; in cars: view 2 = the driver's seat). */
  footFirst = false;
  first = false;
  private fov = 65;
  scoped = false;
  private at = new THREE.Vector3();

  /** Camera forward on the ground plane (for movement). */
  get heading(): number {
    return this.yaw;
  }

  update(f: Frame, dt: number, p: Player, shake: number): void {
    this.yaw -= f.lookX;
    this.pitch = Math.max(-1.25, Math.min(0.75, this.pitch - f.lookY));
    if (Math.abs(f.lookX) + Math.abs(f.lookY) > 0.0005) this.freeT = 1.6;
    else this.freeT -= dt;
    const car = p.car;
    if (f.camera) {
      if (car) this.carView = (this.carView + 1) % 3;
      else this.footFirst = !this.footFirst;
    }
    this.first = car ? this.carView === 2 : this.footFirst;
    if (this.first) return this.firstPerson(f, dt, p, shake);
    let target: THREE.Vector3;
    let want: number;
    let shoulder = 0;
    let fov = 65;
    this.scoped = false;
    if (car) {
      const cp = car.pos;
      target = new THREE.Vector3(cp.x, cp.y + car.half.y * 1.6, cp.z);
      want = [car.half.z * 2 + 3.5, car.half.z * 2 + 8, 0][this.carView]!;
      // Swing back behind the car (or look back).
      if (this.freeT <= 0) {
        const behind = car.heading + (f.lookBack ? Math.PI : 0);
        let d = behind - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * (Math.abs(car.speed) > 2 ? 3.5 : 1));
        this.pitch += (-0.2 - this.pitch) * Math.min(1, dt * 2);
      }
      fov = 68 + Math.min(14, Math.abs(car.speed) * 0.25);
    } else {
      target = new THREE.Vector3(p.pos.x, p.pos.y + 1.62, p.pos.z);
      want = p.aiming ? 1.9 : 3.6;
      shoulder = p.aiming ? 0.55 : 0.32;
      if (p.aiming && p.inv.def.zoom) {
        want = 0.2;
        shoulder = 0.1;
        fov = 65 / p.inv.def.zoom;
        this.scoped = true;
      } else if (p.aiming) fov = 52;
    }
    this.at.lerp(target, this.at.lengthSq() === 0 || car ? 1 : Math.min(1, dt * 18));
    if (this.at.distanceTo(target) > 3) this.at.copy(target);
    this.fov += (fov - this.fov) * Math.min(1, dt * 8);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    const cosP = Math.cos(this.pitch);
    const back = new THREE.Vector3(-Math.sin(this.yaw) * cosP, -Math.sin(this.pitch), -Math.cos(this.yaw) * cosP);
    const rightV = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const pivot = this.at.clone().addScaledVector(rightV, shoulder);
    // Walls: pull in.
    this.dist += (want - this.dist) * Math.min(1, dt * 10);
    let d = this.dist;
    const hit = physics.ray(pivot.x, pivot.y, pivot.z, back.x, back.y, back.z, d + 0.3, car ? car.body : p.body);
    if (hit) d = Math.max(0.3, hit.toi - 0.3);
    const pos = pivot.clone().addScaledVector(back, d);
    if (pos.y < 0.3) pos.y = 0.3;
    if (shake > 0) pos.add(new THREE.Vector3((Math.random() - 0.5) * shake * 0.5, (Math.random() - 0.5) * shake * 0.5, (Math.random() - 0.5) * shake * 0.5));
    this.camera.position.copy(pos);
    this.camera.lookAt(pos.clone().sub(back));
  }

  /** Eyes: your head on foot, the driver's seat in a car. */
  private firstPerson(f: Frame, dt: number, p: Player, shake: number): void {
    const car = p.car;
    let eye: THREE.Vector3;
    let fov = 72;
    this.scoped = false;
    if (car) {
      // Bonnet view: just in front of the windscreen, looking over the hood.
      const local = new THREE.Vector3(0, car.roofY * 0.86, car.half.z * 0.42);
      local.applyQuaternion(car.root.quaternion);
      eye = car.p.clone().add(local);
      if (this.freeT <= 0) {
        let d = car.heading + (f.lookBack ? Math.PI : 0) - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * 5);
        this.pitch += (-0.06 - this.pitch) * Math.min(1, dt * 3);
      }
      fov = 74 + Math.min(10, Math.abs(car.speed) * 0.18);
    } else {
      eye = new THREE.Vector3(p.pos.x, p.pos.y + (p.swimming ? 1.0 : 1.66), p.pos.z);
      eye.add(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.12));
      if (p.aiming && p.inv.def.zoom) {
        fov = 72 / p.inv.def.zoom;
        this.scoped = true;
      } else if (p.aiming) fov = 58;
    }
    this.fov += (fov - this.fov) * Math.min(1, dt * 10);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    if (shake > 0) eye.add(new THREE.Vector3((Math.random() - 0.5) * shake * 0.2, (Math.random() - 0.5) * shake * 0.2, 0));
    const cosP = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cosP, Math.sin(this.pitch), Math.cos(this.yaw) * cosP);
    this.camera.position.copy(eye);
    this.camera.lookAt(eye.clone().add(dir));
    this.dist = 0;
    this.at.copy(eye);
  }

  /** Crosshair ray. */
  aim(): { from: THREE.Vector3; dir: THREE.Vector3 } {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return { from: this.camera.position.clone().addScaledVector(dir, this.dist * 0.9), dir };
  }
}
