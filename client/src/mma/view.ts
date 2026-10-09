import * as THREE from 'three';
import type { FighterDef } from './data';

export type AnimState = 'idle' | 'move' | 'jab' | 'cross' | 'hook' | 'bodyKick' | 'headKick' | 'block' | 'hurt' | 'takedown' | 'ground' | 'ko' | 'win';
export interface VisualState { x: number; z: number; facing: number; anim: AnimState; phase: number; hurt: number; stamina: number; }

interface Rig {
  root: THREE.Group; body: THREE.Group; head: THREE.Mesh; armL: THREE.Group; armR: THREE.Group;
  foreL: THREE.Group; foreR: THREE.Group; legL: THREE.Group; legR: THREE.Group; shinL: THREE.Group; shinR: THREE.Group;
}

const mat = (color: number, roughness = .72) => new THREE.MeshStandardMaterial({ color, roughness, metalness: .05 });
const limb = (radius: number, length: number, material: THREE.Material): THREE.Group => {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 10), material);
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  g.add(mesh);
  return g;
};

function fighterRig(def: FighterDef, blue: boolean): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const skin = mat(def.skin); const shorts = mat(def.color); const glove = mat(blue ? 0x2f6fe0 : 0xe12239, .4);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.32, .66, 8, 14), skin); torso.position.y = 1.72; torso.scale.set(1.06, 1, .72); torso.castShadow = true; body.add(torso);
  const waist = new THREE.Mesh(new THREE.CylinderGeometry(.31, .34, .35, 12), shorts); waist.position.y = 1.16; waist.castShadow = true; body.add(waist);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(.345, .345, .08, 12), mat(def.accent)); band.position.y = 1.31; body.add(band);
  const head = new THREE.Mesh(new THREE.CapsuleGeometry(.21, .22, 8, 14), skin); head.position.y = 2.48; head.scale.z = .9; head.castShadow = true; body.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.215, 14, 8, 0, Math.PI * 2, 0, Math.PI * .52), mat(def.id === 'okoye' ? 0x16100e : 0x201713)); hair.position.set(0, 2.61, 0); hair.scale.z = .92; body.add(hair);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.045, .1, 6), skin); nose.rotation.x = Math.PI / 2; nose.position.set(0, 2.48, .215); body.add(nose);
  const eyeMat = mat(0x161213, .9);
  for (const x of [-.075, .075]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(.024, 8, 6), eyeMat); eye.position.set(x, 2.535, .202); eye.scale.set(1, .72, .5); body.add(eye); }
  const armL = limb(.105, .54, skin); armL.position.set(-.39, 2.03, 0); armL.rotation.z = -.12; body.add(armL);
  const armR = limb(.105, .54, skin); armR.position.set(.39, 2.03, 0); armR.rotation.z = .12; body.add(armR);
  const foreL = limb(.09, .49, skin); foreL.position.y = -.58; armL.add(foreL);
  const foreR = limb(.09, .49, skin); foreR.position.y = -.58; armR.add(foreR);
  for (const f of [foreL, foreR]) { const hand = new THREE.Mesh(new THREE.SphereGeometry(.135, 10, 8), glove); hand.position.y = -.55; hand.scale.z = .8; hand.castShadow = true; f.add(hand); }
  const legL = limb(.145, .58, skin); legL.position.set(-.19, 1.05, 0); legL.rotation.z = -.04; body.add(legL);
  const legR = limb(.145, .58, skin); legR.position.set(.19, 1.05, 0); legR.rotation.z = .04; body.add(legR);
  const shinL = limb(.115, .58, skin); shinL.position.y = -.66; legL.add(shinL);
  const shinR = limb(.115, .58, skin); shinR.position.y = -.66; legR.add(shinR);
  for (const s of [shinL, shinR]) { const foot = new THREE.Mesh(new THREE.CapsuleGeometry(.105, .17, 5, 8), skin); foot.rotation.x = Math.PI / 2; foot.position.set(0, -.64, .12); foot.castShadow = true; s.add(foot); }
  root.scale.setScalar(.88);
  return { root, body, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR };
}

function resetRig(r: Rig): void {
  r.body.rotation.set(0, 0, 0); r.body.position.set(0, 0, 0); r.head.rotation.set(0, 0, 0);
  r.armL.rotation.set(-.62, 0, -.42); r.armR.rotation.set(-.62, 0, .42);
  r.foreL.rotation.set(-1.25, 0, 0); r.foreR.rotation.set(-1.25, 0, 0);
  r.legL.rotation.set(0, 0, -.04); r.legR.rotation.set(0, 0, .04); r.shinL.rotation.set(0, 0, 0); r.shinR.rotation.set(0, 0, 0);
}

function animateRig(r: Rig, s: VisualState, time: number): void {
  resetRig(r); const p = s.phase; const punch = Math.sin(Math.min(1, p) * Math.PI); const bounce = Math.sin(time * 6 + s.x) * .025;
  r.body.position.y = bounce;
  if (s.anim === 'move') { const walk = Math.sin(time * 11); r.legL.rotation.x = walk * .32; r.legR.rotation.x = -walk * .32; r.armL.rotation.x -= walk * .12; r.armR.rotation.x += walk * .12; }
  if (s.anim === 'jab') { r.armL.rotation.set(-1.45 * punch, 0, -.2); r.foreL.rotation.x = -1.25 + 1.25 * punch; r.body.rotation.y = -.12 * punch; }
  if (s.anim === 'cross') { r.armR.rotation.set(-1.55 * punch, 0, .16); r.foreR.rotation.x = -1.25 + 1.25 * punch; r.body.rotation.y = .35 * punch; }
  if (s.anim === 'hook') { r.armR.rotation.set(-1.15, -.9 * punch, .5); r.foreR.rotation.set(-1.45, 0, 0); r.body.rotation.y = .55 * punch; }
  if (s.anim === 'bodyKick' || s.anim === 'headKick') { r.legR.rotation.set(-(.65 + (s.anim === 'headKick' ? .72 : .35)) * punch, 0, .5 * punch); r.shinR.rotation.x = .7 * punch; r.body.rotation.z = -.25 * punch; r.armL.rotation.x = -.9; }
  if (s.anim === 'block') { r.armL.rotation.x = -1.25; r.armR.rotation.x = -1.25; r.foreL.rotation.x = -.25; r.foreR.rotation.x = -.25; }
  if (s.anim === 'hurt') { r.body.rotation.x = -.28 * punch; r.head.rotation.z = .32 * punch; }
  if (s.anim === 'takedown') { r.body.rotation.x = .55 * punch; r.body.position.y -= .32 * punch; r.armL.rotation.x = -1.4; r.armR.rotation.x = -1.4; }
  if (s.anim === 'ground') { r.body.rotation.x = 1.45; r.body.position.y = -.64; r.legL.rotation.x = -.55; r.legR.rotation.x = .55; }
  if (s.anim === 'ko') { r.body.rotation.x = 1.52 * Math.min(1, p * 2); r.body.position.y = -.76 * Math.min(1, p * 2); r.armL.rotation.x = .8; r.armR.rotation.x = -.3; }
  if (s.anim === 'win') { r.armL.rotation.x = -2.75; r.armR.rotation.x = -2.75; r.foreL.rotation.x = 0; r.foreR.rotation.x = 0; r.body.position.y += Math.abs(Math.sin(time * 4)) * .08; }
  if (s.hurt > .5) r.head.rotation.z += Math.sin(time * 9) * .03 * s.hurt;
  r.root.position.set(s.x, 0, s.z); r.root.rotation.y = s.facing;
}

export class CageView {
  readonly renderer: THREE.WebGLRenderer; readonly scene = new THREE.Scene(); readonly camera = new THREE.PerspectiveCamera(42, 1, .1, 120);
  private red?: Rig; private blue?: Rig; private time = 0; private flash = 0; private crowd: THREE.InstancedMesh;
  private lights: THREE.SpotLight[] = [];
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio)); this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .82;
    this.scene.background = new THREE.Color(0x050609); this.scene.fog = new THREE.FogExp2(0x050609, .022);
    this.camera.position.set(0, 5.4, 9.8); this.camera.lookAt(0, 1.1, 0);
    this.buildArena();
    const crowdGeo = new THREE.BoxGeometry(.16, .32, .13); const crowdMat = new THREE.MeshStandardMaterial({ color: 0x566072, roughness: .9 });
    this.crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, 420); const dummy = new THREE.Object3D();
    for (let i = 0; i < 420; i++) { const a = (i / 420) * Math.PI * 2 + Math.sin(i * 33) * .06; const rad = 7.4 + (i % 5) * .62; dummy.position.set(Math.sin(a) * rad, .42 + (i % 5) * .38, Math.cos(a) * rad); dummy.lookAt(0, 1, 0); dummy.scale.y = .7 + (i % 7) / 9; dummy.updateMatrix(); this.crowd.setMatrixAt(i, dummy.matrix); }
    this.scene.add(this.crowd); addEventListener('resize', () => this.resize()); this.resize();
  }
  private buildArena(): void {
    this.scene.add(new THREE.HemisphereLight(0x7187a8, 0x080809, .74));
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const l = new THREE.SpotLight(i % 2 ? 0xdce6ff : 0xffdccb, 460, 28, .52, .55, 1.2); l.position.set(Math.sin(a) * 7, 10, Math.cos(a) * 7); l.target.position.set(0, 0, 0); l.castShadow = i < 2; this.scene.add(l, l.target); this.lights.push(l); }
    const matFloor = new THREE.MeshStandardMaterial({ color: 0x787a7e, roughness: .86 }); const floor = new THREE.Mesh(new THREE.CylinderGeometry(5.18, 5.18, .18, 8), matFloor); floor.receiveShadow = true; this.scene.add(floor);
    const logo = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.36, 40), new THREE.MeshBasicMaterial({ color: 0xbe182a })); logo.rotation.x = -Math.PI / 2; logo.position.y = .101; this.scene.add(logo);
    const center = new THREE.Mesh(new THREE.CircleGeometry(.13, 24), new THREE.MeshBasicMaterial({ color: 0xbe182a })); center.rotation.x = -Math.PI / 2; center.position.y = .102; this.scene.add(center);
    const postMat = mat(0x12141a, .45); const fenceMat = new THREE.MeshStandardMaterial({ color: 0x59616e, transparent: true, opacity: .28, side: THREE.DoubleSide, wireframe: true });
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; const x = Math.sin(a) * 5.15; const z = Math.cos(a) * 5.15; const post = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, 2.5, 8), postMat); post.position.set(x, 1.27, z); post.castShadow = true; this.scene.add(post); const b = a + Math.PI / 4; const x2 = Math.sin(b) * 5.15; const z2 = Math.cos(b) * 5.15; const dx = x2 - x; const dz = z2 - z; const panel = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(dx, dz), 2.25, 18, 8), fenceMat); panel.position.set((x + x2) / 2, 1.35, (z + z2) / 2); panel.rotation.y = Math.atan2(dx, dz); this.scene.add(panel); }
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(6.3, 6.3, .35, 8), mat(0x0c0e12)); apron.position.y = -.25; this.scene.add(apron);
  }
  setFighters(a: FighterDef, b: FighterDef): void { if (this.red) this.scene.remove(this.red.root); if (this.blue) this.scene.remove(this.blue.root); this.red = fighterRig(a, false); this.blue = fighterRig(b, true); this.scene.add(this.red.root, this.blue.root); }
  hitFlash(amount: number): void { this.flash = Math.max(this.flash, amount); }
  frame(dt: number, a?: VisualState, b?: VisualState, intro = false): void {
    this.time += dt; this.flash = Math.max(0, this.flash - dt * 4); this.renderer.toneMappingExposure = .82 + this.flash * .4;
    if (a && this.red) animateRig(this.red, a, this.time); if (b && this.blue) animateRig(this.blue, b, this.time);
    if (intro) { const ang = this.time * .08; this.camera.position.set(Math.sin(ang) * 9.8, 4.2, Math.cos(ang) * 9.8); this.camera.lookAt(0, 1.2, 0); }
    else if (a && b) { const midX = (a.x + b.x) / 2; const midZ = (a.z + b.z) / 2; const dx = b.x - a.x; const dz = b.z - a.z; const dist = Math.hypot(dx, dz); const sideX = dz / Math.max(.1, dist); const sideZ = -dx / Math.max(.1, dist); const portrait = Math.max(1, Math.min(1.72, .78 / this.camera.aspect)); const cameraDistance = (7.2 + dist * .35) * portrait; this.camera.position.lerp(new THREE.Vector3(midX + sideX * cameraDistance, 4.25 + (portrait - 1) * 1.2, midZ + sideZ * cameraDistance), Math.min(1, dt * 3)); this.camera.lookAt(midX, .95, midZ); }
    const pulse = .92 + Math.sin(this.time * .7) * .06; for (const l of this.lights) l.intensity = 460 * pulse;
    this.renderer.render(this.scene, this.camera);
  }
  resize(): void { const w = innerWidth; const h = innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
}
