import type { Game } from '../game';
import { Driver, laneSpot, spawnTraffic } from './traffic';
import type { Ped } from './peds';

/**
 * The wanted system, after the big open-world games:
 *  - crimes raise your stars (1–5) when the police see them or a witness calls it in;
 *  - every star brings more units: cruisers, then cops shooting, then SWAT;
 *  - break line of sight and get out of the search area (it follows your last known
 *    position) and the stars flash, then fade away;
 *  - one star, on foot, a cop right next to you and you're not fighting back: BUSTED.
 */

export type Crime = 'shots' | 'assault' | 'murder' | 'copAssault' | 'copMurder' | 'carjack' | 'theft' | 'vehicleDamage' | 'copCar' | 'explosion' | 'robbery';
const MIN_STARS: Record<Crime, number> = { shots: 1, assault: 1, murder: 2, copAssault: 2, copMurder: 3, carjack: 1, theft: 1, vehicleDamage: 1, copCar: 2, explosion: 2, robbery: 2 };

export class Police {
  level = 0;
  heat = 0;
  /** Where the police think you are. */
  lastX = 0;
  lastZ = 0;
  /** Seconds nobody has seen you. */
  hiddenT = 0;
  searching = false;
  units: Driver[] = [];
  private spawnT = 0;
  private arrestT = 0;
  busted = false;
  /** Escalates with time while you're seen at 4–5 stars. */
  private seenT = 0;

  constructor(private g: Game) {}

  get radius(): number {
    return 90 + this.level * 45;
  }

  /** Something illegal happened at (x, z). */
  crime(kind: Crime, x: number, z: number, witnessed: boolean): void {
    const g = this.g;
    const seen = witnessed || this.copsSee(x, z);
    if (!seen && kind !== 'copMurder' && kind !== 'copAssault') return;
    const before = this.level;
    this.level = Math.min(5, Math.max(this.level, MIN_STARS[kind]));
    if ((kind === 'murder' || kind === 'copMurder' || kind === 'explosion') && this.level === before && before > 0) {
      this.heat += kind === 'copMurder' ? 1 : 0.4;
      if (this.heat >= 1 && this.level < 5) {
        this.level++;
        this.heat = 0;
      }
    }
    this.lastX = x;
    this.lastZ = z;
    this.hiddenT = 0;
    this.searching = false;
    if (this.level > before) g.hud.flash(`${'★'.repeat(this.level)}`, 'wanted');
  }

  private copsSee(x: number, z: number): boolean {
    const g = this.g;
    for (const c of g.peds.list) if (c.role !== 'civ' && !c.dead && Math.hypot(c.x - x, c.z - z) < 50 && g.lineOfSight(c.x, c.y + 1.6, c.z, x, 1.2, z)) return true;
    for (const u of this.units) {
      const p = u.car.pos;
      if (Math.hypot(p.x - x, p.z - z) < 60 && g.lineOfSight(p.x, p.y + 1.6, p.z, x, 1.2, z)) return true;
    }
    return false;
  }

  tryArrest(dt: number): void {
    if (this.g.player.firedRecently) {
      this.arrestT = 0;
      return;
    }
    this.arrestT += dt;
    if (this.arrestT > 1.6) this.busted = true;
  }

  clear(): void {
    this.level = 0;
    this.heat = 0;
    this.searching = false;
    this.busted = false;
    this.arrestT = 0;
    for (const c of this.g.peds.list) if (c.role !== 'civ' && !c.dead) c.state = 'idle';
    for (const u of this.units) {
      u.mode = 'traffic';
      u.car.sirenOn = false;
    }
    this.units = [];
  }

  update(dt: number): void {
    const g = this.g;
    if (this.level === 0) return;
    const p = g.player.pos;
    // Seen?
    const seen = this.copsSee(p.x, p.z);
    if (seen) {
      this.lastX = p.x;
      this.lastZ = p.z;
      this.hiddenT = 0;
      this.searching = false;
      this.seenT += dt;
    } else {
      this.hiddenT += dt;
      if (this.hiddenT > 2) this.searching = true;
      // Out of the search area and unseen long enough: they give up.
      const out = Math.hypot(p.x - this.lastX, p.z - this.lastZ) > this.radius;
      if (this.searching && out && this.hiddenT > 8 + this.level * 3) {
        g.hud.flash('LOST THE COPS', 'good');
        this.clear();
        return;
      }
      // The search area drifts toward you slowly (they have a rough idea).
      this.lastX += (p.x - this.lastX) * dt * 0.02;
      this.lastZ += (p.z - this.lastZ) * dt * 0.02;
    }
    this.arrestT = Math.max(0, this.arrestT - dt * 0.5);
    // Units: more stars, more cars.
    this.units = this.units.filter((u) => !u.car.wrecked && g.vehicles.includes(u.car));
    const want = [0, 2, 3, 5, 7, 9][this.level]!;
    this.spawnT -= dt;
    if (this.units.length < want && this.spawnT <= 0) {
      this.spawnT = 2.5;
      const spot = laneSpot(g, this.searching ? { x: this.lastX, z: this.lastZ } : p, 70, 140);
      if (spot) {
        const swat = this.level >= 4 && Math.random() < 0.4;
        const u = spawnTraffic(g, swat ? 'van' : 'police', spot, 'pursuit', 'swat');
        u.crew = swat ? 3 : 2;
        u.car.sirenOn = true;
        g.traffic.push(u);
        this.units.push(u);
      }
    }
    // Cops get out when they reach you (on foot, or you've stopped).
    for (const u of this.units) {
      const c = u.car.pos;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      const slow = Math.abs(u.car.speed) < 3;
      if (u.crew > 0 && d < 22 && slow && (!g.player.inCar || (g.player.car && Math.abs(g.player.car.speed) < 4))) {
        for (let k = 0; k < u.crew; k++) {
          const side = k % 2 ? 1 : -1;
          const cop: Ped = g.peds.spawnAt(this.level >= 4 && u.car.def.model === 'van' ? 'swat' : 'cop', c.x + side * 1.8, c.z + (k - 1) * 1.2);
          cop.car = u.car;
        }
        u.crew = 0;
        u.mode = 'parked';
        u.car.input = { throttle: 0, steer: 0, handbrake: true };
      }
    }
  }
}
