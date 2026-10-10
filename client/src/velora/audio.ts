import type * as THREE from 'three';

/**
 * Sound: recorded engines (CC BY-SA, assets/audio/engines) pitched with the revs, recorded
 * gunshots (CC0 Free Firearm Sound Library, assets/fps/sfx: near + far), and synthesised
 * sirens, horns, explosions, crashes and city ambience. Positional by distance to the camera.
 */

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Set<string>();
  private engine: { src: AudioBufferSourceNode; gain: GainNode; name: string } | null = null;
  private siren: { osc: OscillatorNode; gain: GainNode; t: number } | null = null;
  private ambience: GainNode | null = null;
  listener = { x: 0, y: 0, z: 0 };
  volume = 0.7;

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // City hum: filtered noise.
    const n = this.noiseBuffer(4);
    const src = this.ctx.createBufferSource();
    src.buffer = n;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    this.ambience = this.ctx.createGain();
    this.ambience.gain.value = 0.05;
    src.connect(f).connect(this.ambience).connect(this.master);
    src.start();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  private noiseBuffer(sec: number): AudioBuffer {
    const c = this.ctx!;
    const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return b;
  }

  private async load(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const hit = this.buffers.get(url);
    if (hit) return hit;
    if (this.loading.has(url)) return null;
    this.loading.add(url);
    try {
      const r = await fetch(url);
      const b = await this.ctx.decodeAudioData(await r.arrayBuffer());
      this.buffers.set(url, b);
      return b;
    } catch {
      return null;
    }
  }
  private play(buf: AudioBuffer, vol: number, rate = 1): void {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = vol;
    s.connect(g).connect(this.master);
    s.start();
  }
  private fall(p: { x: number; y: number; z: number }, ref = 12): number {
    const d = Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z);
    return ref / (ref + d);
  }

  /** A gunshot (near / far recording by distance). */
  gun(name: string, p: THREE.Vector3, rate = 1, mine = false): void {
    if (!this.ctx || !name) return;
    const d = Math.hypot(p.x - this.listener.x, p.z - this.listener.z);
    const url = `/assets/fps/sfx/${name}-${mine || d < 40 ? 'near' : 'far'}.wav`;
    const b = this.buffers.get(url);
    if (b) this.play(b, (mine ? 0.55 : 0.6) * this.fall(p, 20), rate * (0.97 + Math.random() * 0.06));
    else void this.load(url);
  }

  explosion(p: THREE.Vector3): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuffer(2);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(80, c.currentTime + 1.8);
    const g = c.createGain();
    g.gain.setValueAtTime(2.2 * this.fall(p, 30), c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 2);
    s.connect(f).connect(g).connect(this.master);
    s.start();
  }

  crash(p: THREE.Vector3, force: number): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuffer(0.4);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 300 + Math.random() * 400;
    const g = c.createGain();
    g.gain.setValueAtTime(Math.min(1.5, force) * this.fall(p, 15), c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.35);
    s.connect(f).connect(g).connect(this.master);
    s.start();
  }

  punch(p: THREE.Vector3): void {
    this.crash(p, 0.5);
  }

  horn(p: THREE.Vector3, len = 0.35): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.12 * this.fall(p, 15), c.currentTime);
    g.gain.setValueAtTime(0.12 * this.fall(p, 15), c.currentTime + len - 0.03);
    g.gain.linearRampToValueAtTime(0, c.currentTime + len);
    for (const fr of [400, 500]) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = fr;
      o.connect(g);
      o.start();
      o.stop(c.currentTime + len);
    }
    g.connect(this.master);
  }

  /** The engine of the car you drive: revs from speed / throttle. */
  engineUpdate(on: boolean, sample: string, speed: number, throttle: number, top: number): void {
    if (!this.ctx) return;
    const url = `/assets/audio/engines/${sample}.wav`;
    if (!on) {
      if (this.engine) {
        this.engine.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        this.engine.src.stop(this.ctx.currentTime + 0.4);
        this.engine = null;
      }
      return;
    }
    if (!this.engine || this.engine.name !== url) {
      const b = this.buffers.get(url);
      if (!b) {
        void this.load(url);
        return;
      }
      this.engine?.src.stop();
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.master);
      src.start();
      this.engine = { src, gain, name: url };
    }
    // Gears: revs climb within each gear.
    const v = Math.abs(speed) / top;
    const gear = Math.min(5, Math.floor(v * 5));
    const inGear = v * 5 - gear;
    const rev = 0.55 + inGear * 0.55 + gear * 0.05 + Math.max(0, throttle) * 0.08;
    this.engine.src.playbackRate.setTargetAtTime(rev, this.ctx.currentTime, 0.05);
    this.engine.gain.gain.setTargetAtTime(0.18 + Math.abs(throttle) * 0.12, this.ctx.currentTime, 0.1);
  }

  /** Police siren (the nearest unit) — wail. */
  sirenUpdate(p: THREE.Vector3 | null, dt: number): void {
    if (!this.ctx) return;
    if (!p) {
      if (this.siren) {
        this.siren.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
        this.siren.osc.stop(this.ctx.currentTime + 0.6);
        this.siren = null;
      }
      return;
    }
    if (!this.siren) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2000;
      osc.connect(f).connect(gain).connect(this.master);
      osc.start();
      this.siren = { osc, gain, t: 0 };
    }
    this.siren.t += dt;
    const w = (Math.sin(this.siren.t * 1.6) + 1) / 2;
    this.siren.osc.frequency.setTargetAtTime(650 + w * 700, this.ctx.currentTime, 0.02);
    this.siren.gain.gain.setTargetAtTime(0.09 * this.fall(p, 25), this.ctx.currentTime, 0.1);
  }

  /** Short UI blips (shops, pickups, cash). */
  blip(kind: 'cash' | 'buy' | 'error' | 'wanted' | 'click'): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const tones: Record<string, number[]> = { cash: [880, 1320], buy: [660, 990], error: [220, 180], wanted: [520, 390, 520], click: [1200] };
    tones[kind]!.forEach((f, i) => {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = c.createGain();
      const t = c.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.15);
    });
  }
}
