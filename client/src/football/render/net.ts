import type { NetPocket } from '../sim/net';

export interface NetImpact { time: number; x: number; y: number; z: number; strength: number }

/** Tensioned cloth: a local pocket, travelling waves and a soft settling flutter.
 * Sampled by match time so pause, slow motion and reverse replays remain stable. */
export function deformNet(base: Float32Array, out: Float32Array, pin: Float32Array, positions: Float32Array, impacts: NetImpact[], time: number, pockets: NetPocket[] = []): void {
  for (let i = 0; i < pin.length; i++) {
    const o = i * 3, free = pin[i]!;
    let push = 0, flutter = 0;
    for (const hit of impacts) {
      const age = time - hit.time;
      if (age < 0 || age > 5) continue;
      const dx = base[o]! - hit.x, dy = base[o + 1]! - hit.y, dz = base[o + 2]! - hit.z;
      const d = Math.hypot(dx, dy, dz);
      const pocket = Math.sin(Math.min(1, age / 0.16) * Math.PI / 2) * Math.exp(-age * 1.7) * Math.exp(-d * d / 2.1);
      const arrived = age - d / 5.5;
      const wave = arrived > 0 ? Math.sin(arrived * 19) * Math.exp(-arrived * 2.7 - d * 0.3) * 0.23 : 0;
      push += (pocket + wave) * hit.strength;
      flutter += wave * hit.strength;
    }
    const sag = free * 0.045;
    let w = free * Math.max(-0.35, Math.min(1.15, push));
    for (const p of pockets) {
      // Only the touched panel wraps around the ball; nearby cords carry its ripple.
      if (out[o]! * p.nx + out[o + 1]! * p.ny + out[o + 2]! * p.nz < 0.5) continue;
      const d2 = (base[o]! - p.x) ** 2 + (base[o + 1]! - p.y) ** 2 + (base[o + 2]! - p.z) ** 2;
      const local = Math.exp(-d2 / 0.65);
      const supported = (p.depth + 0.025) * local * free / Math.max(0.12, p.weight);
      w = Math.max(supported, w * (1 - local) + supported);
    }
    positions[o] = base[o]! + out[o]! * (w + sag);
    positions[o + 1] = base[o + 1]! + out[o + 1]! * w - sag + free * flutter * 0.04;
    positions[o + 2] = base[o + 2]! + out[o + 2]! * w + free * flutter * 0.035;
  }
}
