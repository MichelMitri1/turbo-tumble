import { noteToMidi } from '../synth';

/**
 * Song data. Each part plays one instrument; each bar is 16 space-separated
 * steps (16th notes):
 *   .            rest
 *   -            hold the previous note
 *   D5 / F#4     note            D4+F#4+A4  chord
 *   x  X  o      drum hit (normal / accent / ghost)
 */
export interface PartSpec {
  instrument: string;
  gain: number;
}

export interface SectionSpec {
  bars: number;
  /** Bars per part; shorter lists repeat to fill the section. Missing part = silent. */
  parts: Record<string, string[]>;
}

export interface SongSpec {
  id: string;
  bpm: number;
  /** 0..0.5 — delay of every second 16th (shuffle). */
  swing?: number;
  parts: Record<string, PartSpec>;
  sections: Record<string, SectionSpec>;
  order: string[];
  /** Index into `order` to loop back to; omit for one-shot stingers. */
  loopFrom?: number;
}

export interface NoteEvent {
  step: number;
  midi: number[];
  /** Length in steps. */
  steps: number;
  velocity: number;
}

/** Parsed: per section, per part, per bar → events. */
export interface CompiledSong {
  spec: SongSpec;
  sections: Map<string, Map<string, NoteEvent[][]>>;
}

/** Overall music level before the music bus (keeps full mixes well under 0 dBFS). */
export const SONG_TRIM = 0.55;

const DRUM_VELOCITY: Record<string, number> = { x: 0.75, X: 1, o: 0.4 };

export function compileBar(bar: string, where: string): NoteEvent[] {
  const tokens = bar.trim().split(/\s+/);
  if (tokens.length !== 16) throw new Error(`${where}: bar has ${tokens.length} steps, expected 16: "${bar}"`);
  const events: NoteEvent[] = [];
  tokens.forEach((tok, step) => {
    if (tok === '.' || tok === '-') {
      if (tok === '-' && events.length && events[events.length - 1]!.step + events[events.length - 1]!.steps === step) events[events.length - 1]!.steps++;
      return;
    }
    const drum = DRUM_VELOCITY[tok];
    if (drum !== undefined) {
      events.push({ step, midi: [0], steps: 1, velocity: drum });
      return;
    }
    events.push({ step, midi: tok.split('+').map(noteToMidi), steps: 1, velocity: 1 });
  });
  return events;
}

export function compileSong(spec: SongSpec): CompiledSong {
  const sections = new Map<string, Map<string, NoteEvent[][]>>();
  for (const [name, section] of Object.entries(spec.sections)) {
    const parts = new Map<string, NoteEvent[][]>();
    for (const [part, bars] of Object.entries(section.parts)) {
      if (!spec.parts[part]) throw new Error(`${spec.id}/${name}: unknown part "${part}"`);
      parts.set(
        part,
        bars.map((b, i) => compileBar(b, `${spec.id}/${name}/${part}[${i}]`)),
      );
    }
    sections.set(name, parts);
  }
  for (const s of spec.order) if (!sections.has(s)) throw new Error(`${spec.id}: unknown section "${s}" in order`);
  return { spec, sections };
}

/** Seconds per 16th step. */
export function stepSeconds(spec: SongSpec, tempoMul = 1): number {
  return 60 / (spec.bpm * tempoMul) / 4;
}

/** Total length in seconds of one pass through `order` (for one-shot stingers). */
export function songSeconds(spec: SongSpec): number {
  return spec.order.reduce((n, s) => n + spec.sections[s]!.bars, 0) * 16 * stepSeconds(spec);
}

// ------------------------------------------------------------------ authoring helpers

/** Held chord for a whole bar. */
export const hold = (chord: string): string => `${chord} ${'- '.repeat(15).trim()}`;
/** Pumping octave bass in 8ths. */
export const octaves = (low: string, high: string): string => `${low} . ${high} . `.repeat(4).trim();
/** 16th arpeggio over three chord tones (up-down). */
export const arp = (a: string, b: string, c: string): string => `${a} ${b} ${c} ${b} `.repeat(4).trim();
export const rest = '. . . . . . . . . . . . . . . .';
