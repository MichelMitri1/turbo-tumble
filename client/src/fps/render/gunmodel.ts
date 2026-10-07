import * as THREE from 'three';
import type { Attachments, WeaponDef } from '../sim/weapons';
import { cloneModel, gunBounds, type GunInfo } from './assets';
import { applyCamo } from './camo';

/**
 * A weapon with its camo and attachments, in "holder" space: the pistol grip at
 * the origin, the muzzle towards −z, metres. Shared by the first-person view and
 * the menu previews.
 */
export interface GunBuild {
  gun: THREE.Group;
  b: GunInfo;
  /** Model → metres. */
  s: number;
  gripX: number;
  foreX: number;
  sightX: number;
  sightY: number;
}

export function assembleGun(def: WeaponDef, att: Attachments, camo: string): GunBuild {
  const gun = new THREE.Group();
  const model = cloneModel(def.model);
  applyCamo(model, camo);
  const b = gunBounds(def.model);
  const len = b.max.x - b.min.x;
  const pistol = def.cls === 'pistol';
  // Grip (right hand) and foregrip (left hand) along the gun (+x = muzzle).
  const gripX = b.min.x + len * (pistol ? 0.22 : def.cls === 'shotgun' ? 0.33 : 0.36);
  const gripY = b.min.y + (b.max.y - b.min.y) * 0.25;
  const foreX = b.min.x + len * (pistol ? 0.3 : 0.66);
  // Sight line: just above the top of the receiver.
  let sightY = b.max.y - (b.max.y - b.min.y) * (def.scoped ? 0.05 : 0.12);
  const sightX = b.min.x + len * 0.45;
  const s = def.scale;
  model.position.set(-gripX, -gripY, 0);
  const inner = new THREE.Group();
  inner.add(model);
  inner.scale.setScalar(s);
  inner.rotation.y = Math.PI / 2; // model +x (muzzle) → −z
  gun.add(inner);
  if (!def.scoped && att.optic !== 'iron') {
    const optic = makeOptic(att.optic);
    // Sit on the top rail (a little below the tallest point, which is usually a sight post).
    const rail = b.max.y - (b.max.y - b.min.y) * 0.12;
    optic.position.set(0, (rail - gripY) * s, -(sightX - gripX) * s);
    gun.add(optic);
    sightY = rail + (att.optic === 'acog' ? ACOG_EYE : att.optic === 'holo' ? 0.03 : 0.026) / s;
  }
  if (att.muzzle === 'suppressor') {
    const sup = cloneModel('acc-silencer-1');
    sup.scale.setScalar(s * 1.1);
    sup.rotation.y = Math.PI / 2;
    sup.position.set(0, (b.min.y + (b.max.y - b.min.y) * 0.62 - gripY) * s, -(b.max.x - gripX) * s - 0.06);
    gun.add(sup);
  }
  if (att.under === 'grip' && !pistol) {
    const grip = cloneModel('acc-grip');
    grip.scale.setScalar(s * 1.1);
    grip.rotation.y = Math.PI / 2;
    grip.position.set(0, (b.min.y + (b.max.y - b.min.y) * 0.35 - gripY) * s, -(foreX - gripX) * s);
    gun.add(grip);
  }
  if (att.under === 'laser') {
    const laser = makeLaser();
    laser.position.set(0.012, (b.min.y + (b.max.y - b.min.y) * (pistol ? 0.42 : 0.5) - gripY) * s - 0.02, -((pistol ? b.max.x - len * 0.25 : foreX + len * 0.06) - gripX) * s);
    gun.add(laser);
  }
  return { gun, b, s, gripX, foreX, sightX, sightY };
}

/** Height of the ACOG's tube axis above the rail. */
const ACOG_EYE = 0.018;

export function makeOptic(kind: Attachments['optic']): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'iron') return g;
  const black = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.5, metalness: 0.6 });
  if (kind === 'acog') {
    const scope = cloneModel('acc-scope-3');
    scope.scale.setScalar(0.08);
    scope.rotation.y = Math.PI / 2;
    scope.position.y = 0.002;
    // See-through glass, and a tube you can look down when aiming.
    scope.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.side = THREE.DoubleSide;
      if (/glass/i.test(mat.name)) Object.assign(mat, { transparent: true, opacity: 0.14, depthWrite: false, color: new THREE.Color('#9fd8ff') });
      else mat.color.multiplyScalar(0.4);
      m.material = mat;
    });
    g.add(scope);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0012, 12), new THREE.MeshBasicMaterial({ color: '#ff3a2a' }));
    dot.position.set(0, ACOG_EYE, -0.045);
    g.add(dot);
    return g;
  }
  // Red dot / holographic: a small housing with a glowing reticle.
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.06), black);
  base.position.y = 0.006;
  g.add(base);
  if (kind === 'holo') {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.036, 0.004), black);
    frame.position.set(0, 0.03, 0.02);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.034, 0.026), new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.18 }));
    hole.position.set(0, 0.03, 0.022);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.0055, 0.0068, 24), new THREE.MeshBasicMaterial({ color: '#ff2a1a' }));
    ring.position.set(0, 0.03, 0.023);
    g.add(frame, hole, ring);
  } else {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.04, 16, 1, true), black);
    tube.rotation.x = Math.PI / 2;
    tube.position.y = 0.026;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), new THREE.MeshBasicMaterial({ color: '#7fd0ff', transparent: true, opacity: 0.22 }));
    lens.position.set(0, 0.026, 0.015);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0018, 10), new THREE.MeshBasicMaterial({ color: '#ff2a1a' }));
    dot.position.set(0, 0.026, 0.016);
    g.add(tube, lens, dot);
  }
  return g;
}

/** Tactical laser module: the flashlight body with a red emitter. */
export function makeLaser(): THREE.Group {
  const g = new THREE.Group();
  const body = cloneModel('acc-flashlight');
  body.scale.setScalar(0.11);
  body.rotation.y = Math.PI / 2;
  g.add(body);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.005, 12), new THREE.MeshBasicMaterial({ color: '#ff2a1a' }));
  lens.position.set(0, 0.008, -0.031);
  lens.rotation.y = Math.PI;
  g.add(lens);
  return g;
}
