import { INSTRUMENTS, type SynthCtx } from '../synth';
import { SONG_TRIM, compileSong, stepSeconds, type SongSpec } from './Song';

/**
 * Schedule one full pass of a song into any context (used by tools/audio-check
 * to render songs offline). Returns the end time.
 */
export function scheduleSongPass(c: SynthCtx, spec: SongSpec, tempoMul = 1, transpose = 0): number {
  const song = compileSong(spec);
  const step = stepSeconds(spec, tempoMul);
  let t = c.t;
  for (const name of spec.order) {
    const section = spec.sections[name]!;
    const parts = song.sections.get(name)!;
    for (let bar = 0; bar < section.bars; bar++) {
      for (const [part, bars] of parts) {
        const inst = INSTRUMENTS[spec.parts[part]!.instrument]!;
        for (const e of bars[bar % bars.length]!) {
          const swing = e.step % 2 === 1 ? (spec.swing ?? 0) * step : 0;
          for (const midi of e.midi) inst({ ...c, t: t + e.step * step + swing }, midi ? midi + transpose : 0, e.steps * step * 0.95, e.velocity * spec.parts[part]!.gain * SONG_TRIM);
        }
      }
      t += 16 * step;
    }
  }
  return t;
}
