import { Color, Vector3, type Mesh, type MeshStandardMaterial } from 'three';
import type { RaceEvent } from '@shared/race/RaceTypes';
import type { RaceSimulation } from '@shared/race/RaceSimulation';
import { ITEMS } from '@shared/items/ItemTypes';
import type { LocalPlayer } from '../players/LocalPlayer';
import type { KartEntity } from '../vehicles/KartEntity';
import type { Effects } from '../vfx/Effects';

const v = (p: [number, number, number]): Vector3 => new Vector3(p[0], p[1], p[2]);
const RED = new Color('#ff2a2a');
const GREEN = new Color('#3dff6a');

/**
 * Turns simulation events into presentation: HUD banners, camera kicks, VFX and
 * the start-gantry lights. Never mutates the simulation.
 */
export class RacePresenter {
  constructor(
    private readonly race: RaceSimulation,
    private readonly players: LocalPlayer[],
    private readonly karts: KartEntity[],
    private readonly fx: Effects,
    private readonly startLights: Mesh[],
  ) {
    this.setLights(0, RED);
  }

  private player(racer: number): LocalPlayer | undefined {
    return this.players.find((p) => p.racerIndex === racer);
  }

  private setLights(count: number, color: Color): void {
    this.startLights.forEach((lamp, i) => {
      const m = lamp.material as MeshStandardMaterial;
      const on = i < count;
      m.emissive.copy(color);
      m.emissiveIntensity = on ? 3.2 : 0.12;
      m.color.copy(on ? color : new Color('#3a0a0a'));
    });
  }

  /** Camera shake for players near a world position. */
  private shakeNear(pos: Vector3, radius: number, amount: number): void {
    for (const p of this.players) {
      const d = p.kart.state.position.distanceTo(pos);
      if (d < radius) p.camera.addTrauma(amount * (1 - d / radius));
    }
  }

  handle(events: readonly RaceEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'countdown':
          this.setLights(e.value === 3 ? 2 : e.value === 2 ? 4 : 5, RED);
          for (const p of this.players) p.hud.countdown(e.value);
          break;
        case 'go':
          this.setLights(5, GREEN);
          for (const p of this.players) p.hud.countdown('GO');
          break;
        case 'rocketStart': {
          const p = this.player(e.racer);
          if (p) p.hud.banner(e.good ? 'ROCKET START!' : 'STALLED!', e.good ? 'cyan' : 'pink');
          const k = this.karts[e.racer];
          if (k && e.good) this.fx.miniTurbo(k.state.position, 3);
          break;
        }
        case 'itemBox':
          this.fx.boxBreak(v(e.position));
          break;
        case 'itemUse': {
          const k = this.karts[e.racer]!;
          const item = ITEMS[e.item];
          if (item.category === 'boost' && e.item !== 'coin') {
            this.fx.miniTurbo(k.state.position, 2);
            this.player(e.racer)?.camera.addTrauma(0.15);
          }
          if (e.item === 'prism') this.fx.burst(k.state.position.clone().setY(k.state.position.y + 1), '#ff4fd8', 30, 7);
          if (e.item === 'jetRocket') this.fx.explosion(k.state.position, 3);
          break;
        }
        case 'hit': {
          const k = this.karts[e.racer]!;
          this.fx.poof(k.state.position.clone().setY(k.state.position.y + 1), e.kind === 'squish' ? '#ffffff' : '#ffe9a6');
          const p = this.player(e.racer);
          if (p) p.camera.addTrauma(e.kind === 'tumble' ? 0.6 : 0.35);
          break;
        }
        case 'blocked':
          this.fx.poof(v(e.position));
          break;
        case 'explosion':
          this.fx.explosion(v(e.position), e.radius);
          this.shakeNear(v(e.position), 40, 0.7);
          break;
        case 'shockwave':
          this.fx.shockwave(v(e.position), e.radius);
          this.shakeNear(v(e.position), 25, 0.4);
          break;
        case 'zap':
          for (const p of this.players) {
            p.hud.flash();
            p.camera.addTrauma(0.3);
          }
          for (const k of this.karts) if (k.racer.index !== e.racer) this.fx.strike(k.state.position);
          break;
        case 'paint':
          this.fx.splat(this.karts[e.racer]!.state.position);
          break;
        case 'quakePulse':
          for (const p of this.players) p.camera.addTrauma(0.3 + e.pulse * 0.12);
          for (const k of this.karts) this.fx.ring(k.state.position, 6, '#ff8c1a', 0.4);
          break;
        case 'coin':
          this.fx.coin(v(e.position));
          break;
        case 'boostPad': {
          const k = this.karts[e.racer]!;
          this.fx.burst(k.state.position.clone().setY(k.state.position.y + 0.5), '#ffb52e', 14, 5);
          this.player(e.racer)?.camera.addTrauma(0.1);
          break;
        }
        case 'chomp':
          this.fx.burst(v(e.position).setY(e.position[1] + 1), '#5ce06a', 16, 6);
          break;
        case 'entityGone':
          this.fx.poof(v(e.position));
          break;
        case 'bump':
          this.fx.burst(v(e.position).setY(e.position[1] + 0.8), '#fff3c0', 8, 4);
          for (const idx of [e.a, e.b]) this.player(idx)?.camera.addTrauma(Math.min(0.35, e.impact / 25));
          break;
        case 'lap': {
          const p = this.player(e.racer);
          if (p) p.hud.banner(e.lap === this.race.config.laps ? 'FINAL LAP!' : `LAP ${e.lap}`, e.lap === this.race.config.laps ? 'pink' : 'gold');
          break;
        }
        case 'finish': {
          const p = this.player(e.racer);
          if (p) p.hud.banner('FINISH!', 'gold');
          break;
        }
        default:
          break;
      }
    }
  }
}
