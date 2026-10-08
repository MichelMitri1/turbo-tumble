import * as THREE from 'three';
import type { Game } from '../sim/game';

/** Smoke grenades (billowing grey clouds) and molotov fire pools, rebuilt from the game state every frame. */
export class Areas {
  readonly group = new THREE.Group();
  private smoke = new Map<number, { g: THREE.Group; puffs: Array<{ s: THREE.Sprite; base: THREE.Vector3; size: number; spin: number }> }>();
  private fire = new Map<number, { g: THREE.Group; flames: Array<{ s: THREE.Sprite; phase: number; size: number }> }>();
  private smokeMat: THREE.SpriteMaterial;
  private fireMat: THREE.SpriteMaterial;
  private scorch: THREE.MeshBasicMaterial;

  constructor() {
    const soft = (inner: string, outer: string) => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d')!;
      const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, inner);
      grd.addColorStop(1, outer);
      x.fillStyle = grd;
      x.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    this.smokeMat = new THREE.SpriteMaterial({ map: soft('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), color: '#b8bcc0', transparent: true, depthWrite: false, opacity: 0.85 });
    this.fireMat = new THREE.SpriteMaterial({ map: soft('rgba(255,240,180,1)', 'rgba(255,90,10,0)'), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.scorch = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.45, depthWrite: false });
  }

  update(g: Game, dt: number): void {
    const now = performance.now() / 1000;
    // Smoke.
    const seenS = new Set<number>();
    for (const sm of g.smokes) {
      seenS.add(sm.id);
      let v = this.smoke.get(sm.id);
      if (!v) {
        const grp = new THREE.Group();
        const puffs = [];
        for (let i = 0; i < 26; i++) {
          const s = new THREE.Sprite(this.smokeMat.clone());
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random());
          const base = new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.35) * 0.8, Math.sin(a) * r);
          puffs.push({ s, base, size: 2.6 + Math.random() * 2.2, spin: (Math.random() - 0.5) * 0.3 });
          grp.add(s);
        }
        grp.position.set(sm.x, sm.y, sm.z);
        this.group.add(grp);
        this.smoke.set(sm.id, (v = { g: grp, puffs }));
      }
      const r = g.smokeRadius(sm);
      const fade = Math.min(1, Math.max(0, (sm.until - g.time) / 2));
      for (const p of v.puffs) {
        p.s.position.set(p.base.x * r, p.base.y * r * 0.6 + Math.sin(now * 0.4 + p.size) * 0.15, p.base.z * r);
        const sz = p.size * (0.4 + 0.6 * Math.min(1, r / 6));
        p.s.scale.set(sz, sz, 1);
        (p.s.material as THREE.SpriteMaterial).opacity = 0.75 * fade;
        (p.s.material as THREE.SpriteMaterial).rotation += p.spin * dt;
      }
    }
    for (const [id, v] of this.smoke)
      if (!seenS.has(id)) {
        v.g.removeFromParent();
        for (const p of v.puffs) (p.s.material as THREE.Material).dispose();
        this.smoke.delete(id);
      }
    // Fire.
    const seenF = new Set<number>();
    for (const f of g.fires) {
      seenF.add(f.id);
      let v = this.fire.get(f.id);
      if (!v) {
        const grp = new THREE.Group();
        const flames = [];
        for (let i = 0; i < 18; i++) {
          const s = new THREE.Sprite(this.fireMat);
          const a = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(Math.random()) * f.r * 0.9;
          s.position.set(Math.cos(a) * rr, 0.4, Math.sin(a) * rr);
          flames.push({ s, phase: Math.random() * 6, size: 0.8 + Math.random() * 0.9 });
          grp.add(s);
        }
        const burn = new THREE.Mesh(new THREE.CircleGeometry(f.r, 24), this.scorch);
        burn.rotation.x = -Math.PI / 2;
        burn.position.y = 0.04;
        grp.add(burn);
        grp.position.set(f.x, f.y, f.z);
        this.group.add(grp);
        this.fire.set(f.id, (v = { g: grp, flames }));
      }
      const left = Math.min(1, (f.until - g.time) / 1.5);
      for (const fl of v.flames) {
        const k = 0.7 + Math.sin(now * 9 + fl.phase) * 0.2 + Math.sin(now * 23 + fl.phase * 2) * 0.1;
        const sz = fl.size * k * left;
        fl.s.scale.set(sz, sz * 1.6, 1);
        fl.s.position.y = 0.2 + sz * 0.6;
      }
    }
    for (const [id, v] of this.fire)
      if (!seenF.has(id)) {
        v.g.removeFromParent();
        this.fire.delete(id);
      }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const v of this.smoke.values()) for (const p of v.puffs) (p.s.material as THREE.Material).dispose();
    this.smokeMat.map?.dispose();
    this.fireMat.map?.dispose();
    this.smokeMat.dispose();
    this.fireMat.dispose();
    this.scorch.dispose();
  }
}
