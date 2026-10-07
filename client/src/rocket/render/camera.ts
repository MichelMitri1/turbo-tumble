import * as THREE from 'three';
import { S, toThree } from './arenaMesh';

/** Rocket League's default camera settings (uu / degrees). */
export interface CamSettings {
  fov: number;
  distance: number;
  height: number;
  angle: number;
  stiffness: number;
  swivel: number;
  transition: number;
  shake: boolean;
}
export const DEFAULT_CAM: CamSettings = { fov: 110, distance: 270, height: 100, angle: -4, stiffness: 0.45, swivel: 2.5, transition: 1.2, shake: true };

export interface CamTarget {
  pos: THREE.Vector3; // sim units
  vel: THREE.Vector3;
  forward: THREE.Vector3;
  up: THREE.Vector3;
  onGround: boolean;
  /** Dodge in progress (the camera holds its heading). */
  flipping: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();

/** Car cam / ball cam / rear view with swivel, like the real thing. */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  settings: CamSettings = { ...DEFAULT_CAM };
  ballCam = true;
  rearView = false;
  /** Right-stick look (−1..1). */
  swivelX = 0;
  swivelY = 0;
  private yaw = 0;
  private pitch = 0;
  private readonly camUp = new THREE.Vector3(0, 1, 0);
  private ballBlend = 1;
  private shakeT = 0;
  private shakeAmp = 0;
  private initialized = false;
  private readonly lookOffset = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 1200);
    this.setAspect(aspect);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // Rocket League's FOV is horizontal.
    const h = (this.settings.fov * Math.PI) / 180;
    this.camera.fov = (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  shake(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
    this.shakeT = 0.6;
  }

  reset(): void {
    this.initialized = false;
  }

  /** Free orbit (spectating / replays / end screen). */
  orbit(center: THREE.Vector3, t: number, radius = 40, height = 14): void {
    this.camera.position.set(center.x + Math.cos(t) * radius, center.y + height, center.z + Math.sin(t) * radius);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);
  }

  update(dt: number, car: CamTarget, ball: THREE.Vector3 | null): void {
    const st = this.settings;
    const carPos = toThree(car.pos.x, car.pos.y, car.pos.z, new THREE.Vector3());
    const fwd = toThree(car.forward.x, car.forward.y, car.forward.z, new THREE.Vector3()).divideScalar(S);
    const carUp = toThree(car.up.x, car.up.y, car.up.z, new THREE.Vector3()).divideScalar(S);
    // Like the real game, the camera never rolls or tips with the car: it stays level
    // (world up) and only turns to follow the car's heading. Drive up a wall and you look
    // at the car's roof from behind, exactly as in Rocket League.
    this.camUp.copy(UP);

    // Desired view direction (horizontal).
    let dir: THREE.Vector3;
    const ballThree = ball ? toThree(ball.x, ball.y, ball.z, new THREE.Vector3()) : null;
    const wantBall = this.ballCam && !!ballThree;
    this.ballBlend += ((wantBall ? 1 : 0) - this.ballBlend) * Math.min(1, dt * (1 / Math.max(0.05, st.transition)) * 4);
    if (wantBall && ballThree) dir = v1.copy(ballThree).sub(carPos);
    else {
      const flatFwd = new THREE.Vector3(fwd.x, 0, fwd.z);
      const hold = () => v1.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      if (car.onGround) {
        // On a surface: flat forward, plus "left × up", which faces the wall while the
        // nose points straight up it.
        const left = v3.crossVectors(carUp, fwd);
        dir = v1.copy(flatFwd).multiplyScalar(2).add(new THREE.Vector3().crossVectors(left, UP));
        if (dir.lengthSq() < 0.02) dir = hold();
      } else if (car.flipping || flatFwd.lengthSq() < 0.12 || (carUp.y < 0 && flatFwd.dot(hold()) < 0)) {
        // Mid-dodge, nose straight up/down, or tumbling upside down past the heading:
        // keep the current heading (a half-flip turns the camera once you roll upright).
        dir = hold();
      } else {
        // In the air the camera follows only where the nose points horizontally, so air
        // roll (spinning around the nose) never turns the camera.
        dir = v1.copy(flatFwd);
      }
    }
    if (this.rearView) dir.negate();
    const flat = v2.copy(dir).addScaledVector(this.camUp, -dir.dot(this.camUp));
    if (flat.lengthSq() < 1e-6) flat.copy(fwd).addScaledVector(this.camUp, -fwd.dot(this.camUp));
    flat.normalize();
    // Yaw/pitch in a frame built on camUp.
    const ref = Math.abs(this.camUp.y) > 0.5 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const right0 = new THREE.Vector3().crossVectors(ref, this.camUp).normalize();
    const fwd0 = new THREE.Vector3().crossVectors(this.camUp, right0).normalize();
    let yaw = Math.atan2(flat.dot(right0), flat.dot(fwd0));
    // Swivel (right stick): up to ~180° around.
    yaw += this.swivelX * Math.PI;
    // Ball cam: the camera sits on the ball→car line (elevation follows the ball, clamped).
    let elev = 0;
    if (wantBall && ballThree && !this.rearView) {
      const d = ballThree.clone().sub(carPos);
      const horiz = Math.max(1, d.clone().addScaledVector(this.camUp, -d.dot(this.camUp)).length());
      elev = Math.max(-0.25, Math.min(0.6, Math.atan2(d.dot(this.camUp) - 0.6, horiz + st.distance * S * 0.6))) * this.ballBlend;
    }
    const pitch = elev + this.swivelY * 0.6;
    if (!this.initialized) {
      this.yaw = yaw;
      this.pitch = pitch;
      this.initialized = true;
    }
    // Smooth the swing (ball cam turns faster, like the game).
    let dy = yaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const rate = (wantBall ? 9 : 7.5) * (0.6 + st.stiffness);
    this.yaw += dy * Math.min(1, dt * rate);
    this.pitch += (pitch - this.pitch) * Math.min(1, dt * rate);

    const flatDir = fwd0.clone().multiplyScalar(Math.cos(this.yaw)).addScaledVector(right0, Math.sin(this.yaw));
    const side = new THREE.Vector3().crossVectors(flatDir, this.camUp).normalize();
    const viewDir = flatDir.clone().applyAxisAngle(side, this.pitch);
    // Pull back with speed (lower stiffness = more stretch).
    const speed = car.vel.length();
    const stretch = 1 + (1 - st.stiffness) * Math.min(1, speed / 2300) * 0.18;
    const dist = st.distance * S * stretch;
    const camPos = carPos.clone().addScaledVector(viewDir, -dist).addScaledVector(this.camUp, st.height * S);
    // The camera may pass behind the walls / ceiling (like the real game); only the floor stops it.
    camPos.y = Math.max(0.25, camPos.y);
    const look = viewDir.clone().applyAxisAngle(side, (st.angle * Math.PI) / 180);
    this.camera.position.copy(camPos);
    this.camera.up.copy(this.camUp);
    this.lookOffset.copy(camPos).add(look);
    this.camera.lookAt(this.lookOffset);
    if (this.shakeT > 0 && this.settings.shake !== false) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT / 0.6);
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a));
    } else this.shakeAmp = 0;
  }
}
