import { Vector3, type PerspectiveCamera } from 'three';
import type { ItemId } from '@shared/items/ItemTypes';
import type { RaceSimulation } from '@shared/race/RaceSimulation';
import type { RaceEvent } from '@shared/race/RaceTypes';
import { SurfaceType } from '@shared/types/surface';
import { isStunned } from '@shared/vehicles/KartState';
import type { LocalPlayer } from '../players/LocalPlayer';
import type { KartEntity } from '../vehicles/KartEntity';
import { EngineVoice } from './EngineVoice';
import { getEngineProfile } from './EngineProfiles';
import { getKartBody } from '../config/roster';
import type { GameAudio } from './GameAudio';
import { PODIUM, STING_FINAL_LAP, STING_FINISH, STING_INTRO, STING_LOSE, STING_WIN, trackSong } from './music/songs';
import type { SfxName } from './sfx';

const ITEM_SOUND: Partial<Record<ItemId, SfxName>> = {
  fizz: 'fizz',
  fizz3: 'fizz',
  fizzGold: 'fizz',
  puck: 'throw',
  puck3: 'throw',
  seeker: 'seekerLaunch',
  seeker3: 'seekerLaunch',
  crownBuster: 'crownLaunch',
  goo: 'splat',
  goo3: 'splat',
  boomBall: 'fuse',
  decoy: 'clunk',
  prism: 'prism',
  jetRocket: 'jetRocket',
  ember: 'fire',
  rang: 'rang',
  snapper: 'chomp',
  horn: 'horn',
  octo: 'bubbles',
  coin: 'coin',
  quake: 'shockwave',
  // zap / paint are voiced by their own race events.
};

const HIT_SOUND = { spin: 'hitSpin', tumble: 'hitTumble', squish: 'hitSquish' } as const;
const CROWN_ALARM_EVERY = 0.5;

export interface RaceAudioOptions {
  race: RaceSimulation;
  karts: KartEntity[];
  players: LocalPlayer[];
  /** Spectator camera (attract / 3P TV) — used as the ear when nobody plays. */
  spectator: PerspectiveCamera | null;
  /** Attract mode behind the menu: stay quiet (menu music only). */
  quiet: boolean;
  /** TrackDefinition.music id. */
  music: string;
}

/**
 * The sound of one race: engines for every kart, race events → positional
 * sound effects, roulette / alarm / wrong-way cues for local players, and the
 * music flow (intro sting → countdown → track theme → final lap → finish).
 */
export class RaceAudio {
  private readonly engines: Array<EngineVoice | null>;
  private readonly prevSpeed: number[];
  private readonly load: number[];
  private readonly local = new Set<number>();
  private readonly rouletteStep = new Map<number, number>();
  private readonly wrongWay = new Map<number, boolean>();
  private readonly finished = new Set<number>();
  private finalLapPlayed = false;
  private alarmTimer = 0;
  private paused = false;
  private readonly tmp = new Vector3();
  private readonly listenerPool: Array<{ position: Vector3; right: Vector3 }> = [];

  constructor(
    private readonly audio: GameAudio,
    private readonly o: RaceAudioOptions,
  ) {
    for (const p of o.players) this.local.add(p.racerIndex);
    const ok = audio.engine.available && !o.quiet;
    this.engines = o.karts.map((k) => (ok ? new EngineVoice(audio.engine, this.local.has(k.racer.index), getEngineProfile(getKartBody(k.racer.kartId).engine), 1 + ((k.racer.index * 7) % 5 - 2) * 0.003) : null));
    this.prevSpeed = o.karts.map(() => 0);
    this.load = o.karts.map(() => 0.3);
    if (!o.quiet) {
      audio.leaveMenu();
      audio.music.stop(0.4);
      audio.engine.duckMusic(1);
      audio.music.stinger(STING_INTRO);
    }
  }

  private get sfx(): GameAudio['sfx'] {
    return this.audio.sfx;
  }

  private posOf(racer: number): Vector3 | null {
    return this.o.karts[racer]?.render.position ?? null;
  }

  /** Own karts play centred and full; others are placed in the world. */
  private at(racer: number): Vector3 | null {
    return this.local.has(racer) ? null : this.posOf(racer);
  }

  private v(p: [number, number, number]): Vector3 {
    return this.tmp.set(p[0], p[1], p[2]);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.audio.engine.duckMusic(paused ? 0.35 : 1);
  }

  // ---------------------------------------------------------------- events

  handle(events: readonly RaceEvent[]): void {
    if (this.o.quiet) return;
    const sfx = this.sfx;
    for (const e of events) {
      switch (e.type) {
        case 'countdown':
          sfx.play('countBeep', { minGap: 0.3 });
          break;
        case 'go':
          sfx.play('countGo');
          sfx.play('crowdCheer', { intensity: 0.6 });
          this.audio.music.play(trackSong(this.o.music), { fadeIn: 0.05, restart: true });
          break;
        case 'rocketStart':
          if (this.local.has(e.racer)) sfx.play(e.good ? 'rocketGood' : 'rocketStall');
          break;
        case 'itemBox':
          sfx.play('itemBox', { at: this.local.has(e.racer) ? null : this.v(e.position), volume: this.local.has(e.racer) ? 1 : 0.6 });
          break;
        case 'itemReady':
          if (this.local.has(e.racer)) sfx.play('itemReady');
          break;
        case 'itemUse': {
          const name = ITEM_SOUND[e.item];
          if (name) sfx.play(name, { at: this.at(e.racer), minGap: 0.02 });
          break;
        }
        case 'hit':
          sfx.play(HIT_SOUND[e.kind], { at: this.at(e.racer), minGap: 0.02 });
          break;
        case 'blocked':
          sfx.play('blocked', { at: this.v(e.position) });
          break;
        case 'explosion':
          sfx.play('explosion', { at: this.v(e.position), intensity: Math.min(1, 0.6 + e.radius / 20), minGap: 0.05 });
          break;
        case 'shockwave':
          sfx.play('shockwave', { at: this.v(e.position) });
          break;
        case 'zap':
          sfx.play('zap', { minGap: 0.5 });
          break;
        case 'paint':
          sfx.play('paint', { minGap: 0.3 });
          break;
        case 'quakePulse':
          sfx.play('quakePulse', { stage: e.pulse, minGap: 0.15 });
          break;
        case 'coin':
          sfx.play('coin', { at: this.local.has(e.racer) ? null : this.v(e.position), volume: this.local.has(e.racer) ? 1 : 0.5, minGap: 0.02 });
          break;
        case 'boostPad':
        case 'jump':
        case 'slipstream':
          sfx.play('boostPad', { at: this.at(e.racer), minGap: 0.02 });
          break;
        case 'chomp':
          sfx.play('chomp', { at: this.v(e.position) });
          break;
        case 'entityGone':
          sfx.play('poof', { at: this.v(e.position), volume: 0.6 });
          break;
        case 'bump':
          sfx.play('bump', { at: this.local.has(e.a) || this.local.has(e.b) ? null : this.v(e.position), intensity: Math.min(1, e.impact / 14), minGap: 0.06 });
          break;
        case 'lap':
          if (this.local.has(e.racer)) this.onLocalLap(e.lap);
          break;
        case 'finish':
          if (this.local.has(e.racer)) this.onLocalFinish(e.racer, e.position);
          break;
        default:
          break;
      }
    }
  }

  private onLocalLap(lap: number): void {
    const laps = this.o.race.config.laps;
    if (lap === laps && laps > 1 && !this.finalLapPlayed) {
      // Final lap: jingle, then the theme comes back faster and a semitone up.
      this.finalLapPlayed = true;
      const music = this.audio.music;
      this.audio.engine.duckMusic(0.25, 0.1);
      music.stinger(STING_FINAL_LAP, () => {
        music.tempoMul = 1.1;
        music.transpose = 1;
        this.audio.engine.duckMusic(1, 0.4);
      });
    } else if (lap > 1) {
      this.sfx.play('lap');
    }
  }

  private onLocalFinish(racer: number, position: number): void {
    const first = this.finished.size === 0;
    this.finished.add(racer);
    this.sfx.play('crowdCheer', { intensity: position <= 3 ? 1 : 0.5 });
    if (!first) return;
    const field = this.o.race.racers.length;
    const music = this.audio.music;
    music.stop(0.15);
    const sting = position <= 3 ? STING_WIN : position > Math.max(4, field * 0.6) ? STING_LOSE : STING_FINISH;
    music.stinger(sting, () => {
      if (this.finished.size >= this.local.size) music.play(PODIUM, { fadeIn: 1 });
    });
  }

  // ---------------------------------------------------------------- per frame

  /** Call every frame before kart frame events are cleared. */
  frame(dt: number): void {
    if (this.o.quiet) return;
    this.updateListeners();
    const engine = this.audio.engine;
    const race = this.o.race;

    this.o.karts.forEach((k, i) => {
      const s = k.state;
      const r = k.racer;
      const max = r.sim.stats.maxSpeed;
      const speed = Math.abs(s.forwardSpeed);
      // Engine load: own input when we have it, else inferred from acceleration.
      const player = this.o.players.find((p) => p.racerIndex === i);
      const accel = dt > 0 ? (speed - this.prevSpeed[i]!) / dt : 0;
      this.prevSpeed[i] = speed;
      const target = player ? player.input.throttle : r.input.throttle || r.input.brake ? r.input.throttle : speed > 1 ? Math.min(1, Math.max(0, 0.4 + accel * 0.06)) : 0;
      this.load[i] = this.load[i]! + (target - this.load[i]!) * Math.min(1, dt * 10);
      const voice = this.engines[i];
      if (voice) {
        const spatial = this.paused ? { gain: 0, pan: 0 } : this.local.has(i) ? { gain: this.o.players.length > 1 ? 0.7 : 1, pan: 0 } : engine.spatial(k.render.position, 6, 90);
        voice.update(
          {
            speed01: Math.min(1.3, speed / max),
            load: s.boostTimer > 0 || s.rocketTimer > 0 ? 1 : this.load[i]!,
            throttle: target,
            freeRev: race.phase === 'countdown' || !s.grounded || speed < 1,
            drifting: s.drifting,
            grounded: s.grounded,
            offroad: s.surface === SurfaceType.Offroad || s.surface === SurfaceType.Dirt,
            boost: s.rocketTimer > 0 ? 1.3 : s.boostTimer > 0 ? 1 : 0,
            stunned: isStunned(s),
          },
          spatial,
          dt,
        );
      }

      // Kart presentation events (collected over this frame's ticks).
      const ev = k.frameEvents;
      const at = this.at(i);
      const mine = this.local.has(i);
      if (ev.hopped && mine) this.sfx.play('hop', { volume: 0.7 });
      if (ev.landed > 3) this.sfx.play('land', { at, intensity: Math.min(1, ev.landed / 14) });
      if (ev.wallHit > 3) this.sfx.play('wallHit', { at, intensity: Math.min(1, ev.wallHit / 18) });
      if (ev.driftStageUp && mine) this.sfx.play('driftStage', { stage: ev.driftStageUp, minGap: 0.01 });
      if (ev.miniTurbo) this.sfx.play('miniTurbo', { at, stage: ev.miniTurbo, volume: mine ? 1 : 0.7 });
      if (ev.respawned && mine) this.sfx.play('respawn');
    });

    // Local-player cues.
    let leaderIsLocal = false;
    for (const p of this.o.players) {
      const r = race.racers[p.racerIndex]!;
      const slot = r.slot;
      if (slot.roulette > 0) {
        const step = Math.floor(slot.roulette * 14);
        if (step !== this.rouletteStep.get(p.racerIndex)) this.sfx.play('rouletteTick', { minGap: 0 });
        this.rouletteStep.set(p.racerIndex, step);
      }
      const wrong = r.progress.wrongWay && !r.progress.finished;
      if (wrong && !this.wrongWay.get(p.racerIndex)) this.sfx.play('wrongWay');
      this.wrongWay.set(p.racerIndex, wrong);
      if (r.progress.position === 1 && !r.progress.finished) leaderIsLocal = true;
    }

    // Crown Buster alarm while one is hunting a leader on this screen.
    this.alarmTimer -= dt;
    if (leaderIsLocal && this.alarmTimer <= 0 && race.items.entities.list.some((e) => e.kind === 'crown' && !e.dead)) {
      this.sfx.play('alarm', { minGap: 0 });
      this.alarmTimer = CROWN_ALARM_EVERY;
    }
  }

  private updateListeners(): void {
    const ears = this.listenerPool;
    const cams = this.o.players.length ? this.o.players.map((p) => p.camera.camera as PerspectiveCamera) : this.o.spectator ? [this.o.spectator] : [];
    cams.forEach((cam, i) => {
      const ear = (ears[i] ??= { position: new Vector3(), right: new Vector3() });
      ear.position.copy(cam.position);
      ear.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    });
    this.audio.engine.listeners = ears.slice(0, cams.length);
  }

  dispose(): void {
    for (const v of this.engines) v?.dispose();
    this.audio.engine.listeners = [];
  }
}
