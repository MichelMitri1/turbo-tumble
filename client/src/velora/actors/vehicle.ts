import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { assets, type CarModel } from '../assets';
import { G, groups, physics } from '../physics';

/**
 * A drivable vehicle on a Rapier ray-cast vehicle: real masses, power, top speeds, grip,
 * aerodynamic drag (and downforce on the fast ones), suspension, handbrake slides, and
 * damage from the size of each impact (a fender-bender scratches, a 120 km/h wall hit hurts,
 * a few of those set it on fire). Police lights and sirens, headlights.
 */

const tmpF = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

export interface CarDef {
  model: CarModel;
  name: string;
  /** Mass (kg), total engine force (N), top speed (m/s), steering lock (rad). */
  mass: number;
  power: number;
  top: number;
  steer: number;
  /** Tyre grip (friction slip). */
  grip: number;
  drive: 'rwd' | 'fwd' | 'awd';
  /** Aero drag (N per (m/s)²) and downforce (fraction of weight per (m/s)² × 100). */
  drag: number;
  downforce?: number;
  /** Suspension stiffness. */
  spring: number;
  siren?: boolean;
  price: number;
  /** Damage resistance multiplier (trucks are tougher). */
  armor: number;
  cls: 'compact' | 'sedan' | 'sports' | 'super' | 'muscle' | 'suv' | 'truck' | 'service' | 'emergency';
}

export const CARS: Record<string, CarDef> = {
  compact: { model: 'compact', name: 'Pip', cls: 'compact', mass: 1000, power: 5200, top: 45, steer: 0.62, grip: 1.9, drive: 'fwd', drag: 0.42, spring: 30, price: 9000, armor: 0.9 },
  hatch: { model: 'hatch', name: 'Swift Hatch', cls: 'compact', mass: 1150, power: 6400, top: 49, steer: 0.6, grip: 2.0, drive: 'fwd', drag: 0.42, spring: 30, price: 14000, armor: 1 },
  sedan: { model: 'sedan', name: 'Meridian', cls: 'sedan', mass: 1450, power: 7600, top: 54, steer: 0.56, grip: 2.0, drive: 'rwd', drag: 0.45, spring: 28, price: 22000, armor: 1 },
  wagon: { model: 'wagon', name: 'Homestead Wagon', cls: 'sedan', mass: 1550, power: 7200, top: 50, steer: 0.55, grip: 1.95, drive: 'fwd', drag: 0.5, spring: 28, price: 18000, armor: 1.05 },
  taxi: { model: 'taxi', name: 'Downtown Cab', cls: 'sedan', mass: 1500, power: 7400, top: 52, steer: 0.56, grip: 2.0, drive: 'rwd', drag: 0.46, spring: 28, price: 16000, armor: 1.05 },
  sports: { model: 'sports', name: 'Vortex GT', cls: 'sports', mass: 1350, power: 11500, top: 72, steer: 0.52, grip: 2.45, drive: 'awd', drag: 0.36, downforce: 0.08, spring: 38, price: 85000, armor: 0.95 },
  super: { model: 'super', name: 'Aurora RS', cls: 'super', mass: 1320, power: 14500, top: 85, steer: 0.5, grip: 2.7, drive: 'awd', drag: 0.32, downforce: 0.14, spring: 44, price: 240000, armor: 0.9 },
  muscle: { model: 'muscle', name: 'Stallion 500', cls: 'muscle', mass: 1700, power: 12000, top: 68, steer: 0.52, grip: 1.85, drive: 'rwd', drag: 0.48, spring: 30, price: 55000, armor: 1.15 },
  suv: { model: 'suv', name: 'Ranger XL', cls: 'suv', mass: 2150, power: 9800, top: 55, steer: 0.52, grip: 2.05, drive: 'awd', drag: 0.6, spring: 32, price: 45000, armor: 1.3 },
  pickup: { model: 'pickup', name: 'Haul 1500', cls: 'suv', mass: 2350, power: 10500, top: 50, steer: 0.5, grip: 2.0, drive: 'awd', drag: 0.65, spring: 34, price: 32000, armor: 1.4 },
  police: { model: 'police', name: 'Police Interceptor', cls: 'emergency', mass: 1800, power: 11800, top: 66, steer: 0.54, grip: 2.3, drive: 'rwd', drag: 0.45, spring: 34, siren: true, price: 0, armor: 1.4 },
  boxtruck: { model: 'boxtruck', name: 'Box Truck', cls: 'truck', mass: 5200, power: 17000, top: 36, steer: 0.48, grip: 1.9, drive: 'rwd', drag: 1.1, spring: 40, price: 30000, armor: 2.2 },
  ambulance: { model: 'ambulance', name: 'Ambulance', cls: 'emergency', mass: 3200, power: 12500, top: 45, steer: 0.5, grip: 1.95, drive: 'rwd', drag: 0.9, spring: 36, siren: true, price: 0, armor: 1.8 },
  firetruck: { model: 'firetruck', name: 'Fire Engine', cls: 'service', mass: 9000, power: 26000, top: 38, steer: 0.45, grip: 1.9, drive: 'rwd', drag: 1.4, spring: 46, siren: true, price: 0, armor: 3 },
  garbage: { model: 'garbage', name: 'Garbage Truck', cls: 'service', mass: 9000, power: 24000, top: 32, steer: 0.45, grip: 1.9, drive: 'rwd', drag: 1.4, spring: 46, price: 0, armor: 3 },
  van: { model: 'van', name: 'Shuttle Van', cls: 'truck', mass: 2300, power: 8400, top: 46, steer: 0.52, grip: 1.95, drive: 'rwd', drag: 0.8, spring: 32, price: 16000, armor: 1.4 },
  delivery: { model: 'delivery', name: 'Parcel Van', cls: 'truck', mass: 3500, power: 11500, top: 42, steer: 0.5, grip: 1.95, drive: 'rwd', drag: 1.0, spring: 36, price: 21000, armor: 1.8 },
  racer: { model: 'racer', name: 'Phantom R', cls: 'super', mass: 1000, power: 15500, top: 92, steer: 0.48, grip: 3.0, drive: 'awd', drag: 0.3, downforce: 0.2, spring: 52, price: 400000, armor: 0.8 },
  tractor: { model: 'tractor', name: 'Field Tractor', cls: 'service', mass: 3000, power: 11000, top: 16, steer: 0.6, grip: 2.4, drive: 'awd', drag: 1.2, spring: 30, price: 9000, armor: 2 },
};
/** What drives around town (weighted). */
export const TRAFFIC_MIX: CarModel[] = ['sedan', 'sedan', 'sedan', 'hatch', 'hatch', 'compact', 'wagon', 'taxi', 'taxi', 'suv', 'suv', 'pickup', 'pickup', 'sports', 'muscle', 'van', 'delivery', 'boxtruck', 'super', 'garbage', 'ambulance'];
export const PARKED_MIX: CarModel[] = ['sedan', 'sedan', 'hatch', 'compact', 'wagon', 'suv', 'pickup', 'sports', 'muscle', 'van', 'super'];
export const PAINTS = [0xc62828, 0x1565c0, 0x2e7d32, 0xf9a825, 0x212121, 0xeeeeee, 0x6a1b9a, 0x37474f, 0xff6f00, 0x00838f, 0x8d6e63, 0xb0bec5, 0x0d47a1, 0x880e4f];

export interface Controls {
  throttle: number; // −1 … 1 (negative = reverse / brake)
  steer: number; // −1 left … 1 right
  handbrake: boolean;
}

let nextId = 1;

interface Wheel {
  node: THREE.Object3D;
  base: THREE.Quaternion;
  front: boolean;
  /** The physics wheel driving this node's spin / height. */
  phys: number;
  r: number;
  spin: number;
}

export class Vehicle {
  readonly id = nextId++;
  def: CarDef;
  readonly root = new THREE.Group();
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  private ctl!: RAPIER.DynamicRayCastVehicleController;
  private wheels: Wheel[] = [];
  private physFront: boolean[] = [];
  half = new THREE.Vector3();
  input: Controls = { throttle: 0, steer: 0, handbrake: false };
  private steerNow = 0;
  health = 1000;
  burning = 0;
  wrecked = false;
  sirenOn = false;
  driver: 'player' | 'ai' | null = null;
  private beacons: THREE.Mesh[] = [];
  private headlights: THREE.SpotLight[] = [];
  private paint: THREE.MeshStandardMaterial | null = null;
  private mats: THREE.MeshStandardMaterial[] = [];
  lastHit = 0;
  /** Cached each step (no allocations): position, forward, forward speed. */
  readonly p = new THREE.Vector3();
  readonly f = new THREE.Vector3(0, 0, 1);
  spd = 0;
  private prevV = new THREE.Vector3();
  /** The biggest velocity change since last read (crash size, m/s). */
  impact = 0;
  /** Seconds under water. */
  sinkT = 0;
  roofY = 1.4;
  readonly model: THREE.Object3D;

  constructor(model: CarModel, x: number, z: number, heading: number, paint?: number) {
    this.def = CARS[model] ?? CARS.sedan!;
    this.model = assets.car(model);
    this.root.add(this.model);
    // Own materials (paint, damage); the paint is the body's biggest coloured material.
    const area = new Map<THREE.MeshStandardMaterial, number>();
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const own = mats.map((m) => {
        const c = (m as THREE.MeshStandardMaterial).clone();
        this.mats.push(c);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? own : own[0]!;
      let inBody = false;
      for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (p.name === 'body') inBody = true;
      if (!inBody) return;
      for (const c of own) {
        const hsl = { h: 0, s: 0, l: 0 };
        c.color.getHSL(hsl);
        const n = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position!.count) * (hsl.l < 0.12 || hsl.l > 0.93 ? 0.25 : 1);
        area.set(c, (area.get(c) ?? 0) + n);
      }
    });
    let best = 0;
    for (const [m, a] of area)
      if (a > best) {
        best = a;
        this.paint = m;
      }
    if (paint !== undefined && !this.def.siren && this.def.model !== 'taxi') this.repaint(paint);
    this.build(x, z, heading);
  }

  private build(x: number, z: number, heading: number): void {
    const m = assets.manifest.cars[this.def.model]!;
    this.half.set(m.max[0]!, m.max[1]! / 2, m.max[2]!);
    this.roofY = m.max[1]!;
    const R = physics.R;
    const w = physics.world;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, 0.3, z).setRotation(q).setLinearDamping(0.02).setAngularDamping(0.5).setCanSleep(true));
    const wheelR = Math.max(...m.wheels.map((wh) => wh.r));
    const bottom = wheelR * 0.9;
    const top = m.max[1]! * 0.92;
    this.collider = w.createCollider(
      R.ColliderDesc.cuboid(this.half.x * 0.95, (top - bottom) / 2, this.half.z * 0.97)
        .setTranslation(0, (top + bottom) / 2, 0)
        .setDensity(0)
        .setFriction(0.5)
        .setRestitution(0.05)
        .setCollisionGroups(groups(G.CAR, 0xffff))
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(this.def.mass * 20),
      this.body,
    );
    // Mass and inertia of a real car, centre of mass low (near the axles).
    const mass = this.def.mass;
    const hx = this.half.x;
    const hy = (top - bottom) / 2 + 0.2;
    const hz = this.half.z;
    this.body.setAdditionalMassProperties(mass, { x: 0, y: wheelR * 1.3, z: 0 }, { x: (mass * (hy * hy + hz * hz)) / 3, y: (mass * (hx * hx + hz * hz)) / 3, z: (mass * (hx * hx + hy * hy)) / 3 }, { x: 0, y: 0, z: 0, w: 1 }, true);
    this.ctl = w.createVehicleController(this.body);
    const rest = 0.3;
    const d = this.def;
    const addWheel = (x: number, y: number, z: number, r: number, front: boolean) => {
      this.ctl.addWheel({ x, y: y + rest * 0.55, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, r);
      const i = this.ctl.numWheels() - 1;
      this.ctl.setWheelSuspensionStiffness(i, d.spring);
      this.ctl.setWheelSuspensionCompression(i, 2.3);
      this.ctl.setWheelSuspensionRelaxation(i, 3.0);
      this.ctl.setWheelMaxSuspensionTravel(i, 0.28);
      this.ctl.setWheelFrictionSlip(i, d.grip);
      this.ctl.setWheelSideFrictionStiffness(i, 1);
      this.ctl.setWheelMaxSuspensionForce(i, mass * 50);
      this.physFront.push(front);
      return i;
    };
    const front = m.wheels.find((wh) => wh.name.includes('front'));
    const track = front ? Math.abs(front.at[0]!) : this.half.x * 0.8;
    for (const wh of m.wheels) {
      const node = this.model.getObjectByName(wh.name);
      if (!node) continue;
      const [wx, wy, wz] = wh.at as [number, number, number];
      let phys: number;
      if (wh.name === 'wheels-back') {
        phys = addWheel(track, wy, wz, wh.r, false);
        addWheel(-track, wy, wz, wh.r, false);
      } else phys = addWheel(wx, wy, wz, wh.r, wh.name.includes('front'));
      this.wheels.push({ node, base: node.quaternion.clone(), front: wh.name.includes('front'), phys, r: wh.r, spin: 0 });
    }
    if (this.def.siren) {
      const mk = (c: number, bx: number) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.22), new THREE.MeshBasicMaterial({ color: c }));
        b.position.set(bx, m.max[1]! + 0.05, -0.1);
        this.root.add(b);
        this.beacons.push(b);
      };
      mk(0xff2020, -0.3);
      mk(0x2050ff, 0.3);
    }
    this.root.position.set(x, 0.3, z);
    this.root.quaternion.copy(q);
    this.p.set(x, 0.3, z);
    this.f.set(Math.sin(heading), 0, Math.cos(heading));
  }

  /** Body colour (for online sync). */
  paintHex = 0xffffff;
  /** Another player's car: moved by their updates, not by physics here. */
  remote = false;
  repaint(color: number): void {
    this.paintHex = color;
    if (!this.paint) return;
    if (this.paint.map) this.paint.color.setHex(0xffffff).lerp(new THREE.Color(color), 0.6);
    else this.paint.color.setHex(color);
  }

  /** Forward speed (m/s, signed). */
  get speed(): number {
    return this.spd;
  }
  get pos(): THREE.Vector3 {
    return this.p;
  }
  /** Heading (radians, 0 = +z). */
  get heading(): number {
    return Math.atan2(this.f.x, this.f.z);
  }
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.f);
  }
  /** Upside down / on its side. */
  get flipped(): boolean {
    const q = this.body.rotation();
    tmpQ.set(q.x, q.y, q.z, q.w);
    return tmpF.set(0, 1, 0).applyQuaternion(tmpQ).y < 0.3;
  }

  /** Refresh the cached position / heading / speed. */
  refresh(): void {
    const t = this.body.translation();
    const q = this.body.rotation();
    this.p.set(t.x, t.y, t.z);
    tmpQ.set(q.x, q.y, q.z, q.w);
    this.f.set(0, 0, 1).applyQuaternion(tmpQ);
    const v = this.body.linvel();
    this.spd = v.x * this.f.x + v.y * this.f.y + v.z * this.f.z;
  }

  /** Physics inputs (before the world steps). */
  drive(dt: number): void {
    const d = this.def;
    const dead = this.wrecked || this.health <= 0 || this.sinkT > 1.5;
    const { throttle, steer, handbrake } = dead ? { throttle: 0, steer: 0, handbrake: true } : this.input;
    if ((Math.abs(throttle) > 0.05 || Math.abs(steer) > 0.05) && this.body.isSleeping()) this.body.wakeUp();
    if (this.body.isSleeping()) return;
    this.refresh();
    const v = this.spd;
    // Steering eases in and gets lighter at speed (speed-sensitive like a real rack).
    const lock = d.steer / (1 + Math.abs(v) / 22);
    this.steerNow += (steer * lock - this.steerNow) * Math.min(1, dt * 7);
    let engine = 0;
    let brake = 0;
    const brakeForce = d.mass * 0.05;
    if (throttle > 0.05) {
      if (v < -1) brake = brakeForce * throttle;
      else engine = d.power * throttle * Math.max(0, 1 - (Math.max(0, v) / d.top) ** 2.2);
    } else if (throttle < -0.05) {
      if (v > 1) brake = brakeForce * -throttle;
      else engine = -d.power * 0.5 * -throttle * (v < -12 ? 0 : 1);
    } else brake = d.mass * 0.004; // engine braking / rolling resistance
    let nDriven = 0;
    for (const f of this.physFront) if (d.drive === 'awd' || (d.drive === 'fwd') === f) nDriven++;
    for (let i = 0; i < this.physFront.length; i++) {
      const front = this.physFront[i]!;
      const driven = d.drive === 'awd' || (d.drive === 'fwd') === front;
      this.ctl.setWheelSteering(i, front ? -this.steerNow : 0);
      this.ctl.setWheelEngineForce(i, driven ? engine / Math.max(1, nDriven) : 0);
      this.ctl.setWheelBrake(i, handbrake && !front ? brakeForce * 1.4 : brake);
      // Handbrake: the rear lets go (slides / drifts).
      this.ctl.setWheelSideFrictionStiffness(i, handbrake && !front && Math.abs(v) > 5 ? 0.3 : 1);
    }
    this.ctl.updateVehicle(dt, undefined, groups(G.CAR, G.WORLD | G.CAR), (c) => c.handle !== this.collider.handle);
    // Air: drag (and downforce on the fast ones).
    const lv = this.body.linvel();
    const sp = Math.hypot(lv.x, lv.y, lv.z);
    if (sp > 1) {
      const k = (d.drag * sp * dt) / d.mass;
      this.body.setLinvel({ x: lv.x - lv.x * k, y: lv.y - lv.y * k, z: lv.z - lv.z * k }, true);
      if (d.downforce && !this.flipped) this.body.applyImpulse({ x: 0, y: -d.downforce * d.mass * 0.01 * sp * sp * dt, z: 0 }, true);
    }
  }

  /** After each physics step: how hard did it just hit something? */
  measure(dt: number): void {
    if (this.body.isSleeping()) return;
    const v = this.body.linvel();
    const dvx = v.x - this.prevV.x;
    const dvy = v.y - this.prevV.y + 9.81 * dt;
    const dvz = v.z - this.prevV.z;
    this.prevV.set(v.x, v.y, v.z);
    const dv = Math.hypot(dvx, dvy * 0.6, dvz);
    if (dv > this.impact) this.impact = dv;
  }

  /** Visuals after the world steps. */
  sync(t: number): void {
    if (this.body.isSleeping() && !this.sirenOn) return;
    this.refresh();
    this.root.position.copy(this.p);
    const q = this.body.rotation();
    this.root.quaternion.set(q.x, q.y, q.z, q.w);
    for (const w of this.wheels) {
      const steer = w.front ? (this.ctl.wheelSteering(w.phys) ?? 0) : 0;
      const spin = this.ctl.wheelRotation(w.phys) ?? 0;
      const len = this.ctl.wheelSuspensionLength(w.phys) ?? 0.3;
      const conn = this.ctl.wheelChassisConnectionPointCs(w.phys);
      w.node.quaternion.copy(w.base);
      if (steer) w.node.rotateY(steer);
      w.node.rotateX(spin);
      if (conn) w.node.position.y = conn.y - len;
    }
    if (this.beacons.length) {
      const on = this.sirenOn && !this.wrecked;
      const ph = Math.floor(t * 6) % 2;
      this.beacons[0]!.visible = !on || ph === 0;
      this.beacons[1]!.visible = !on || ph === 1;
      (this.beacons[0]!.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xff2020 : 0x551010);
      (this.beacons[1]!.material as THREE.MeshBasicMaterial).color.setHex(on ? 0x2050ff : 0x101855);
    }
    if (this.wrecked && !this.charred) {
      this.charred = true;
      for (const m of this.mats) {
        if (m.map) m.color.setHex(0x2a2522);
        else m.color.multiplyScalar(0.18);
      }
    }
  }
  private charred = false;

  /** Turn this into another player's car (kinematic: solid to hit, moved by the network). */
  makeRemote(): void {
    this.remote = true;
    this.body.setBodyType(physics.R.RigidBodyType.KinematicPositionBased, true);
  }
  /** Network pose for a remote car. */
  remotePose(x: number, y: number, z: number, q: THREE.Quaternion, v: number, dt: number, t: number): void {
    this.body.setNextKinematicTranslation({ x, y, z });
    this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    this.root.position.set(x, y, z);
    this.root.quaternion.copy(q);
    this.p.set(x, y, z);
    this.f.set(0, 0, 1).applyQuaternion(q);
    this.spd = v;
    for (const w of this.wheels) {
      w.spin += (v * dt) / Math.max(0.2, w.r);
      w.node.quaternion.copy(w.base);
      w.node.rotateX(w.spin);
    }
    if (this.beacons.length) {
      const on = this.sirenOn;
      const ph = Math.floor(t * 6) % 2;
      this.beacons[0]!.visible = !on || ph === 0;
      this.beacons[1]!.visible = !on || ph === 1;
      (this.beacons[0]!.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xff2020 : 0x551010);
      (this.beacons[1]!.material as THREE.MeshBasicMaterial).color.setHex(on ? 0x2050ff : 0x101855);
    }
  }

  /** Headlights for the car you drive at night. */
  setHeadlights(on: boolean): void {
    if (on && !this.headlights.length) {
      for (const x of [-0.65, 0.65]) {
        const s = new THREE.SpotLight(0xfff2d6, 40, 55, 0.48, 0.45, 1.2);
        s.position.set(x, 0.8, this.half.z);
        s.target.position.set(x * 2, 0, this.half.z + 18);
        this.root.add(s, s.target);
        this.headlights.push(s);
      }
    }
    for (const h of this.headlights) h.visible = on;
  }

  /** Damage points (bullets, explosions). */
  damage(amount: number): void {
    if (this.wrecked) return;
    this.health -= amount;
    if (this.health <= 0 && this.burning === 0) this.burning = 6;
  }

  /** A crash: `dv` m/s of sudden velocity change. Small knocks are free. */
  crash(dv: number): number {
    const over = dv - 9;
    if (over <= 0) return 0;
    // ~50 km/h into a wall: a dent. ~100: heavy damage. ~200: on fire. Trucks shrug more off.
    const dmg = (Math.pow(over, 1.45) * 3) / this.def.armor;
    this.damage(dmg);
    return dmg;
  }

  unflip(): void {
    const h = this.heading;
    this.body.setTranslation({ x: this.p.x, y: this.p.y + 1.4, z: this.p.z }, true);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h), true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Move a pooled car somewhere new, as good as new. */
  reset(x: number, z: number, heading: number, paint?: number, y = 0.3): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setEnabled(true);
    this.prevV.set(0, 0, 0);
    this.health = 1000;
    this.burning = 0;
    this.sinkT = 0;
    this.impact = 0;
    this.input = { throttle: 0, steer: 0, handbrake: false };
    this.sirenOn = false;
    this.driver = null;
    if (paint !== undefined && !this.def.siren && this.def.model !== 'taxi') this.repaint(paint);
    this.root.visible = true;
    this.root.position.set(x, y, z);
    this.root.quaternion.copy(q);
    this.refresh();
  }
  /** Put it away in the pool. */
  park(): void {
    this.body.setEnabled(false);
    this.root.visible = false;
    this.root.removeFromParent();
    this.setHeadlights(false);
  }
  get reusable(): boolean {
    return !this.wrecked && this.health > 700;
  }

  dispose(): void {
    physics.world.removeVehicleController(this.ctl);
    physics.world.removeRigidBody(this.body);
    this.root.removeFromParent();
  }
}
