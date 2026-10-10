import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PersonModel } from '../assets';
import { Inventory, WEAPON, fire } from '../combat';
import type { Game } from '../game';
import type { Frame } from '../input';
import { G, groups, physics } from '../physics';
import { WATER_Y } from '../world/layout';
import { GUN_LOOK, Human } from './human';
import type { Vehicle } from './vehicle';

/**
 * You. On foot: a Rapier character controller (walk / jog / sprint, jump, step up curbs),
 * over-the-shoulder aiming and shooting, punching. Cars: walk up and press F to get in
 * (pulling the driver out if there is one), F again to get out (or bail at speed).
 */

export class Player {
  human: Human;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  private cc: RAPIER.KinematicCharacterController;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  private vy = 0;
  grounded = true;
  health = 200;
  armor = 0;
  cash = 2500;
  dead = false;
  inv = new Inventory();
  car: Vehicle | null = null;
  aiming = false;
  firedRecently = false;
  private firedT = 0;
  private punchT = 0;
  /** Hurt flash for the HUD. */
  hurtT = 0;
  stamina = 1;

  swimming = false;

  constructor(private g: Game, public model: PersonModel, x: number, z: number, y = 0) {
    this.human = new Human(model);
    g.scene.add(this.human.root);
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + 1.2, z));
    // Only the world physically: cars aren't shoved by you (the controller still walks round them).
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(0.5, 0.32).setCollisionGroups(groups(G.PLAYER, G.WORLD)), this.body);
    this.cc = physics.world.createCharacterController(0.03);
    this.cc.enableAutostep(0.45, 0.2, false);
    this.cc.enableSnapToGround(0.4);
    this.cc.setMaxSlopeClimbAngle(0.9);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(80);
    this.pos.set(x, y, z);
  }

  get inCar(): boolean {
    return !!this.car;
  }
  get armed(): boolean {
    return this.inv.current !== 'fist';
  }
  get speed(): number {
    return this.car ? Math.abs(this.car.speed) : Math.hypot(this.vel.x, this.vel.z);
  }

  /** Change clothes (character model). */
  setModel(model: PersonModel): void {
    this.human.dispose();
    this.model = model;
    this.human = new Human(model);
    this.g.scene.add(this.human.root);
    this.syncGun();
  }

  hurt(dmg: number, from?: THREE.Vector3): void {
    if (this.dead || this.g.godMode) return;
    const toArmor = Math.min(this.armor, dmg * 0.7);
    this.armor -= toArmor;
    this.health -= dmg - toArmor;
    this.hurtT = 0.4;
    void from;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      if (this.car) this.exitCar(true);
      this.human.setGunLook(null);
      this.human.play('dead');
    }
  }

  private syncGun(): void {
    const look = this.inv.def.look;
    this.human.setGunLook(look ? GUN_LOOK[look]! : null);
  }

  /** On foot / in a car, one frame. `yaw` = camera heading, `aimDir` = camera ray. */
  update(f: Frame, dt: number, yaw: number, aimFrom: THREE.Vector3, aimDir: THREE.Vector3): void {
    this.hurtT -= dt;
    this.firedT -= dt;
    this.firedRecently = this.firedT > 0;
    this.inv.update(dt);
    if (this.dead) {
      this.human.update(dt);
      return;
    }
    // Weapons.
    if (f.nextWeapon || f.prevWeapon) {
      this.inv.cycle(f.nextWeapon ? 1 : -1);
      this.syncGun();
    }
    if (f.reload) this.inv.reload();
    if (this.car) return this.drive(f, dt);
    if (f.enter) {
      const near = this.nearestCar();
      if (near) return this.enterCar(near);
      if (this.g.claimNearby()) return;
    }
    // ---- on foot
    const aiming = (f.aim || (f.fire && this.armed)) && !this.human.busy();
    this.aiming = aiming;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const rightV = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3().addScaledVector(fwd, f.moveY).addScaledVector(rightV, f.moveX);
    const amount = Math.min(1, move.length());
    if (amount > 0.01) move.normalize();
    const sprint = f.sprint && !aiming && this.stamina > 0.05;
    this.stamina = Math.max(0, Math.min(1, this.stamina + (sprint && amount > 0.1 ? -dt * 0.08 : dt * 0.25)));
    const speed = this.swimming ? (sprint ? 3.6 : 2.6) : aiming ? 3.6 : sprint ? 9.2 : 6.4;
    const target = move.multiplyScalar(speed * amount);
    // Snappy but not instant.
    this.vel.x += (target.x - this.vel.x) * Math.min(1, dt * 10);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, dt * 10);
    // In deep water you swim: float at the surface.
    this.swimming = this.pos.y < WATER_Y - 1.1;
    if (this.swimming) {
      this.vy = (WATER_Y - 1.25 - this.pos.y) * 4;
    } else {
      if (this.grounded && f.jump) {
        this.vy = 5.6;
        this.human.play('jump');
      }
      this.vy -= 18 * dt;
      if (this.grounded && this.vy < 0) this.vy = -1;
    }
    const delta = { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt };
    this.cc.computeColliderMovement(this.collider, delta, undefined, groups(G.PLAYER, G.WORLD | G.CAR));
    const mv = this.cc.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
    this.grounded = this.cc.computedGrounded();
    this.pos.set(t.x + mv.x, t.y + mv.y - 0.82, t.z + mv.z);
    // Facing: where you aim, else where you go.
    if (aiming) this.human.heading = yaw;
    else if (Math.hypot(this.vel.x, this.vel.z) > 0.4) this.human.heading = Math.atan2(this.vel.x, this.vel.z);
    // Shooting / punching.
    const def = this.inv.def;
    const pull = def.auto ? f.fire : f.firePressed;
    if (def.id === 'fist') {
      this.punchT -= dt;
      if (f.firePressed && this.punchT <= 0) {
        this.punchT = 0.45;
        this.human.heading = yaw;
        this.human.play('punch', 1.4);
        this.punch(yaw);
      }
    } else if (pull && aiming && !this.swimming && this.inv.trigger()) this.shoot(aimFrom, aimDir);
    // Animation.
    const h = this.human;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (!h.busy()) {
      if (!this.grounded) h.play('run');
      else if (aiming) h.play(sp > 0.5 ? 'aimRun' : 'aim');
      else if (this.swimming) h.play('walk', 0.7);
      else if (sp > 7.5) h.play('sprint', sp / 7.2);
      else if (sp > 0.6) h.play('run', sp / 5.6);
      else h.play('idle');
    }
    h.root.position.copy(this.pos);
    h.update(dt);
  }

  private shoot(aimFrom: THREE.Vector3, aimDir: THREE.Vector3): void {
    const g = this.g;
    const def = this.inv.def;
    // Where the crosshair points (from the camera), then a ray from the gun to there.
    const far = g.physics.ray(aimFrom.x, aimFrom.y, aimFrom.z, aimDir.x, aimDir.y, aimDir.z, def.range, this.body);
    const aimAt = aimFrom.clone().addScaledVector(aimDir, far ? far.toi : def.range);
    const muzzle = g.cam.first ? g.viewMuzzle() : this.human.muzzle();
    const dir = aimAt.clone().sub(muzzle).normalize();
    if (def.explosive) g.rocket(muzzle, dir);
    else fire(g, { from: muzzle, dir, def, by: 'player' });
    g.netShot(muzzle, def.explosive ? muzzle.clone().addScaledVector(dir, 2) : aimAt, def.sfx[0], def.sfx[1]);
    g.fx.muzzle(muzzle);
    g.audio.gun(def.sfx[0], muzzle, def.sfx[1], true);
    this.human.fired();
    g.kick();
    this.firedT = 4;
    g.shotsFired(this.pos.x, this.pos.z);
  }

  private punch(yaw: number): void {
    const g = this.g;
    const hx = this.pos.x + Math.sin(yaw) * 1.1;
    const hz = this.pos.z + Math.cos(yaw) * 1.1;
    for (const p of g.peds.list) {
      if (p.dead || Math.hypot(p.x - hx, p.z - hz) > 0.9) continue;
      p.hurt(WEAPON.fist!.dmg, 'player', new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)));
      g.audio.punch(this.pos);
      g.crime(p.role === 'civ' ? (p.dead ? 'murder' : 'assault') : p.dead ? 'copMurder' : 'copAssault', this.pos.x, this.pos.z);
      this.firedT = 3;
      return;
    }
  }

  private nearestCar(): Vehicle | null {
    let best: Vehicle | null = null;
    let bd = 4.2;
    for (const v of this.g.vehicles) {
      if (v.wrecked) continue;
      const d = v.pos.distanceTo(this.pos);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  enterCar(v: Vehicle): void {
    const g = this.g;
    if (g.myParked && g.myParked !== v) g.myParked = null;
    if (v.driver === 'ai') g.jack(v);
    if (v.flipped) v.unflip();
    this.car = v;
    v.driver = 'player';
    this.human.root.visible = false;
    this.body.setEnabled(false);
    this.aiming = false;
    g.enteredCar(v);
  }

  exitCar(bail = false): void {
    const v = this.car;
    if (!v) return;
    const p = v.p;
    const f = v.f;
    // Out of the driver's door (the car's left), or the other side if that's blocked.
    const lx = f.z;
    const lz = -f.x;
    const out = v.half.x + 0.9;
    let ex = p.x + lx * out;
    let ez = p.z + lz * out;
    for (const side of [1, -1]) {
      const x = p.x + lx * out * side;
      const z = p.z + lz * out * side;
      const hit = this.g.physics.ray(p.x, p.y + 1, p.z, lx * side, 0, lz * side, out, v.body);
      if (!hit) {
        ex = x;
        ez = z;
        break;
      }
    }
    const ey = this.g.groundY(ex, ez, p.y + 3);
    this.g.myParked = v;
    this.car = null;
    v.driver = null;
    v.input = { throttle: 0, steer: 0, handbrake: true };
    v.setHeadlights(false);
    this.body.setEnabled(true);
    this.body.setTranslation({ x: ex, y: ey + 0.85, z: ez }, true);
    this.body.setNextKinematicTranslation({ x: ex, y: ey + 0.85, z: ez });
    this.pos.set(ex, ey, ez);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.human.root.position.copy(this.pos);
    this.human.root.visible = true;
    this.human.heading = v.heading;
    if (bail) {
      this.human.play('roll');
      this.hurt(Math.min(40, Math.abs(v.speed) * 1.5));
    }
  }

  private drive(f: Frame, dt: number): void {
    const v = this.car!;
    if (f.enter) {
      this.exitCar(Math.abs(v.speed) > 9);
      return;
    }
    v.input = { throttle: f.throttle, steer: f.steer, handbrake: f.handbrake };
    if (f.siren && v.def.siren) v.sirenOn = !v.sirenOn;
    const p = v.pos;
    this.pos.set(p.x, p.y, p.z);
    const lv = v.body.linvel();
    this.vel.set(lv.x, lv.y, lv.z);
    // Drive-by: aim + shoot sideways with a pistol / SMG.
    this.aiming = false;
    this.body.setTranslation({ x: p.x, y: p.y + 2, z: p.z }, false);
    void dt;
  }

  dispose(): void {
    this.human.dispose();
    physics.world.removeCharacterController(this.cc);
    physics.world.removeRigidBody(this.body);
  }
}
