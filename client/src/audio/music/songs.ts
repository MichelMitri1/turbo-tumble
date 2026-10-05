import { arp, hold, octaves, rest, type SongSpec } from './Song';

/**
 * Original Turbo Tumble music, written as step data (see Song.ts). Chord
 * progressions are common-practice; every melody and arrangement here is our own.
 */

const DRUMS_STRAIGHT = {
  kick: ['x . . . x . . . x . . . x . . .'],
  snare: ['. . . . x . . . . . . . x . . .'],
  hat: ['. . x . . . x . . . x . . . x .'],
};

// ------------------------------------------------------------------ Sunny Circuit (race)

export const SUNNY_CIRCUIT: SongSpec = {
  id: 'music-sunny',
  bpm: 150,
  parts: {
    kick: { instrument: 'kick', gain: 0.9 },
    snare: { instrument: 'snare', gain: 0.8 },
    hat: { instrument: 'hat', gain: 0.9 },
    crash: { instrument: 'crash', gain: 0.8 },
    bass: { instrument: 'bass', gain: 0.85 },
    pad: { instrument: 'pad', gain: 0.8 },
    arp: { instrument: 'pluck', gain: 0.7 },
    lead: { instrument: 'lead', gain: 1 },
  },
  sections: {
    intro: {
      bars: 2,
      parts: {
        kick: ['x . . . x . . . x . . . x . . .', 'x . . . x . . . x . . . x . x x'],
        hat: DRUMS_STRAIGHT.hat,
        snare: [rest, '. . . . . . . . . . . . x x X X'],
        bass: [octaves('D2', 'D3'), octaves('A1', 'A2')],
        pad: [hold('D4+F#4+A4'), hold('C#4+E4+A4')],
      },
    },
    verse: {
      bars: 8,
      parts: {
        ...DRUMS_STRAIGHT,
        snare: ['. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . x . x x X X'],
        crash: ['X . . . . . . . . . . . . . . .', rest, rest, rest, rest, rest, rest, rest],
        bass: [octaves('D2', 'D3'), octaves('A1', 'A2'), octaves('B1', 'B2'), octaves('G1', 'G2')],
        pad: [hold('D4+F#4+A4'), hold('C#4+E4+A4'), hold('B3+D4+F#4'), hold('B3+D4+G4')],
        arp: [arp('D5', 'F#5', 'A5'), arp('C#5', 'E5', 'A5'), arp('B4', 'D5', 'F#5'), arp('B4', 'D5', 'G5')],
        lead: [
          'F#5 - - A5 - - D6 - C#6 - A5 - F#5 - E5 -',
          'E5 - - - C#5 - E5 - A5 - - - G#5 - E5 -',
          'F#5 - - D5 - - B4 - D5 - F#5 - B5 - A5 -',
          'G5 - - - B5 - - - A5 - G5 - F#5 - E5 -',
          'F#5 - - A5 - - D6 - E6 - F#6 - E6 - D6 -',
          'C#6 - - - A5 - - - E5 - - - A5 - B5 -',
          'D6 - - C#6 - - B5 - A5 - F#5 - D5 - F#5 -',
          'G5 - - - - - B5 - A5 - - - - - . .',
        ],
      },
    },
    chorus: {
      bars: 8,
      parts: {
        kick: DRUMS_STRAIGHT.kick,
        snare: ['. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . x . x . x X X X X'],
        hat: ['x o x o x o x o x o x o x o x o'],
        crash: ['X . . . . . . . . . . . . . . .', rest, rest, rest, 'X . . . . . . . . . . . . . . .', rest, rest, rest],
        bass: [octaves('G1', 'G2'), octaves('A1', 'A2'), octaves('F#1', 'F#2'), octaves('B1', 'B2'), octaves('G1', 'G2'), octaves('A1', 'A2'), octaves('D2', 'D3'), octaves('D2', 'D3')],
        pad: [hold('B3+D4+G4'), hold('C#4+E4+A4'), hold('A3+C#4+F#4'), hold('B3+D4+F#4'), hold('B3+D4+G4'), hold('C#4+E4+A4'), hold('D4+F#4+A4'), hold('D4+F#4+A4')],
        arp: [arp('B4', 'D5', 'G5'), arp('C#5', 'E5', 'A5'), arp('A4', 'C#5', 'F#5'), arp('B4', 'D5', 'F#5'), arp('B4', 'D5', 'G5'), arp('C#5', 'E5', 'A5'), arp('D5', 'F#5', 'A5'), arp('D5', 'F#5', 'A5')],
        lead: [
          'B5 - - - A5 - G5 - A5 - B5 - - - D6 -',
          'C#6 - - - B5 - A5 - E5 - - - A5 - - -',
          'A5 - - - C#6 - - - F#5 - - - A5 - G#5 -',
          'B5 - - - - - D6 - C#6 - B5 - A5 - F#5 -',
          'G5 - B5 - D6 - - - E6 - D6 - B5 - G5 -',
          'A5 - C#6 - E6 - - - F#6 - E6 - C#6 - A5 -',
          'D6 - - - - - - - F#6 - - - E6 - - -',
          'D6 - - - - - - - . . . . A5 B5 C#6 .',
        ],
      },
    },
    bridge: {
      bars: 8,
      parts: {
        kick: ['x . . . . . . . x . . . . . . .'],
        snare: ['. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', 'x . x . x . x . x x x x X X X X'],
        hat: DRUMS_STRAIGHT.hat,
        bass: [octaves('E2', 'E3'), octaves('A1', 'A2'), octaves('D2', 'D3'), octaves('B1', 'B2'), octaves('E2', 'E3'), octaves('F#1', 'F#2'), octaves('G1', 'G2'), octaves('A1', 'A2')],
        pad: [hold('B3+E4+G4'), hold('C#4+E4+A4'), hold('D4+F#4+A4'), hold('B3+D4+F#4'), hold('B3+E4+G4'), hold('A3+C#4+F#4'), hold('B3+D4+G4'), hold('C#4+E4+A4')],
        lead: [
          'B5 - - - G5 - - - E5 - - - G5 - B5 -',
          'C#6 - - - - - B5 - A5 - - - E5 - - -',
          'F#5 - - - A5 - - - D6 - - - - - - -',
          'C#6 - B5 - A5 - F#5 - - - - - . . . .',
          'G5 - - - B5 - - - E6 - - - D6 - B5 -',
          'C#6 - - - A5 - - - F#5 - - - A5 - C#6 -',
          'D6 - - - B5 - - - G5 - - - B5 - D6 -',
          'E6 - - - - - - - - - - - . . . .',
        ],
      },
    },
  },
  order: ['intro', 'verse', 'chorus', 'verse', 'bridge', 'chorus'],
  loopFrom: 1,
};

// ------------------------------------------------------------------ Garage Groove (menus / lobby)

export const GARAGE_GROOVE: SongSpec = {
  id: 'music-menu',
  bpm: 104,
  swing: 0.16,
  parts: {
    kick: { instrument: 'kick', gain: 0.75 },
    clap: { instrument: 'clap', gain: 0.7 },
    hat: { instrument: 'hat', gain: 0.8 },
    bass: { instrument: 'bass', gain: 0.8 },
    pad: { instrument: 'pad', gain: 0.9 },
    keys: { instrument: 'keys', gain: 1 },
    pluck: { instrument: 'pluck', gain: 0.6 },
  },
  sections: {
    a: {
      bars: 4,
      parts: {
        kick: ['x . . . . . . . x . x . . . . .'],
        clap: ['. . . . x . . . . . . . x . . .'],
        hat: ['x . x . x . x . x . x . x . x .'],
        bass: ['F2 . . . F2 . A2 . C3 . . . A2 . G2 .', 'D2 . . . D2 . F2 . A2 . . . F2 . E2 .', 'G2 . . . G2 . Bb2 . D3 . . . Bb2 . A2 .', 'C2 . . . C2 . E2 . G2 . . . E2 . C2 .'],
        pad: [hold('A3+C4+E4'), hold('F3+A3+C4'), hold('Bb3+D4+F4'), hold('Bb3+E4+G4')],
        keys: ['A4 - - - C5 - - - E5 - - - D5 - C5 -', 'D5 - - - - - - - F5 - E5 - D5 - - -', 'Bb4 - - - D5 - - - F5 - - - E5 - D5 -', 'E5 - - - - - G5 - - - - - . . . .'],
      },
    },
    b: {
      bars: 4,
      parts: {
        kick: ['x . . . . . . . x . x . . . . .'],
        clap: ['. . . . x . . . . . . . x . . .'],
        hat: ['x . x . x . x . x . x . x . x .'],
        bass: ['F2 . . . F2 . A2 . C3 . . . A2 . G2 .', 'D2 . . . D2 . F2 . A2 . . . F2 . E2 .', 'G2 . . . G2 . Bb2 . D3 . . . Bb2 . A2 .', 'C2 . . . C2 . E2 . G2 . . . E2 . C2 .'],
        pad: [hold('A3+C4+E4'), hold('F3+A3+C4'), hold('Bb3+D4+F4'), hold('Bb3+E4+G4')],
        keys: ['A5 - - - G5 - F5 - E5 - - - C5 - - -', 'D5 - F5 - A5 - - - G5 - F5 - E5 - D5 -', 'F5 - - - D5 - - - Bb4 - C5 - D5 - - -', 'C5 - - - - - - - . . . . . . . .'],
      },
    },
    c: {
      bars: 4,
      parts: {
        kick: ['x . . . . . . . x . x . . . . .'],
        clap: ['. . . . x . . . . . . . x . . .'],
        hat: ['x . x . x . x . x . x . x . x .'],
        bass: ['F2 . . . F2 . A2 . C3 . . . A2 . G2 .', 'D2 . . . D2 . F2 . A2 . . . F2 . E2 .', 'G2 . . . G2 . Bb2 . D3 . . . Bb2 . A2 .', 'C2 . . . C2 . E2 . G2 . . . E2 . C2 .'],
        pad: [hold('A3+C4+E4'), hold('F3+A3+C4'), hold('Bb3+D4+F4'), hold('Bb3+E4+G4')],
        pluck: [arp('C5', 'E5', 'A5'), arp('A4', 'C5', 'F5'), arp('Bb4', 'D5', 'F5'), arp('Bb4', 'E5', 'G5')],
      },
    },
  },
  order: ['a', 'b', 'c'],
  loopFrom: 0,
};

// ------------------------------------------------------------------ Podium (results)

export const PODIUM: SongSpec = {
  id: 'music-results',
  bpm: 96,
  parts: {
    kick: { instrument: 'kick', gain: 0.6 },
    hat: { instrument: 'hat', gain: 0.6 },
    bass: { instrument: 'bass', gain: 0.7 },
    pad: { instrument: 'pad', gain: 0.9 },
    pluck: { instrument: 'pluck', gain: 0.6 },
    bell: { instrument: 'bell', gain: 0.8 },
  },
  sections: {
    loop: {
      bars: 4,
      parts: {
        kick: ['x . . . . . . . x . . . . . . .'],
        hat: ['. . x . . . x . . . x . . . x .'],
        bass: ['G2 . . . . . . . G2 . . . D2 . . .', 'E2 . . . . . . . E2 . . . B1 . . .', 'C2 . . . . . . . C2 . . . G1 . . .', 'D2 . . . . . . . D2 . . . A1 . . .'],
        pad: [hold('B3+D4+G4'), hold('B3+E4+G4'), hold('C4+E4+G4'), hold('A3+D4+F#4')],
        pluck: [arp('G5', 'B5', 'D6'), arp('E5', 'G5', 'B5'), arp('E5', 'G5', 'C6'), arp('D5', 'F#5', 'A5')],
        bell: ['B5 - - - - - - - D6 - - - - - - -', 'G5 - - - - - - - B5 - - - - - - -', 'C6 - - - - - - - E6 - - - - - - -', 'D6 - - - - - - - F#6 - - - - - - -'],
      },
    },
  },
  order: ['loop'],
  loopFrom: 0,
};

// ------------------------------------------------------------------ stingers (one-shot)

const STINGER_PARTS = {
  kick: { instrument: 'kick', gain: 1 },
  snare: { instrument: 'snare', gain: 0.9 },
  crash: { instrument: 'crash', gain: 1 },
  brass: { instrument: 'brass', gain: 1 },
  lead: { instrument: 'lead', gain: 1 },
  pad: { instrument: 'pad', gain: 1 },
  bell: { instrument: 'bell', gain: 1 },
  keys: { instrument: 'keys', gain: 1 },
  bass: { instrument: 'bass', gain: 0.9 },
};

/** Before the countdown. */
export const STING_INTRO: SongSpec = {
  id: 'sting-intro',
  bpm: 150,
  parts: STINGER_PARTS,
  sections: {
    s: {
      bars: 1,
      parts: {
        brass: ['D5 - F#5 - A5 - - - D6 - - - - - - -'],
        kick: ['X . . . . . . . X . . . . . . .'],
        crash: ['. . . . . . . . X . . . . . . .'],
        bass: ['D2 - - - - - - - D2 - - - - - - -'],
      },
    },
  },
  order: ['s'],
};

/** Crossing the line into the final lap. */
export const STING_FINAL_LAP: SongSpec = {
  id: 'sting-final-lap',
  bpm: 170,
  parts: STINGER_PARTS,
  sections: {
    s: {
      bars: 2,
      parts: {
        lead: ['A5 . A5 . A5 . D6 - - - . . A5 - D6 -', 'F#6 - - - - - - - - - - - . . . .'],
        brass: ['A4 . A4 . A4 . D5 - - - . . A4 - D5 -', 'F#5 - - - - - - - - - - - . . . .'],
        snare: ['x x x x x x x x X X X X X X X X', rest],
        crash: [rest, 'X . . . . . . . . . . . . . . .'],
        kick: [rest, 'X . . . . . . . . . . . . . . .'],
        bass: [rest, 'D2 - - - - - - - - - - - . . . .'],
      },
    },
  },
  order: ['s'],
};

/** Finishing 1st–3rd. */
export const STING_WIN: SongSpec = {
  id: 'sting-win',
  bpm: 140,
  parts: STINGER_PARTS,
  sections: {
    s: {
      bars: 2,
      parts: {
        brass: ['D5 - - F#5 - - A5 - - D6 - - - - - -', 'B5 - - C#6 - - D6 - - - - - - - - -'],
        lead: ['D6 - - F#6 - - A6 - - D7 - - - - - -', 'B6 - - C#7 - - D7 - - - - - - - - -'],
        pad: [hold('D4+F#4+A4'), hold('D4+G4+B4')],
        kick: ['X . . . . . . . . . . . . . . .', 'X . . X . . X . . . . . . . . .'],
        crash: ['X . . . . . . . . . . . . . . .', '. . . . . . X . . . . . . . . .'],
        bass: ['D2 - - - - - - - A1 - - - - - - -', 'G1 - - A1 - - D2 - - - - - - - - -'],
      },
    },
  },
  order: ['s'],
};

/** Finishing mid-field. */
export const STING_FINISH: SongSpec = {
  id: 'sting-finish',
  bpm: 140,
  parts: STINGER_PARTS,
  sections: {
    s: {
      bars: 2,
      parts: {
        brass: ['A4 - F#4 - A4 - B4 - A4 - - - - - - -', 'D5 - - - - - - - - - - - . . . .'],
        bell: ['A5 - F#5 - A5 - B5 - A5 - - - - - - -', 'D6 - - - - - - - - - - - . . . .'],
        kick: ['X . . . . . . . X . . . . . . .', 'X . . . . . . . . . . . . . . .'],
        crash: [rest, 'X . . . . . . . . . . . . . . .'],
        bass: ['D2 - - - - - - - A1 - - - - - - -', 'D2 - - - - - - - . . . . . . . .'],
      },
    },
  },
  order: ['s'],
};

/** Finishing near the back: a playful "aww". */
export const STING_LOSE: SongSpec = {
  id: 'sting-lose',
  bpm: 120,
  parts: STINGER_PARTS,
  sections: {
    s: {
      bars: 1,
      parts: {
        keys: ['F5 - E5 - D#5 - D5 - - - - - . . . .'],
        bass: ['Bb2 - A2 - Ab2 - G2 - - - - - . . . .'],
      },
    },
  },
  order: ['s'],
};

export const SONGS: SongSpec[] = [SUNNY_CIRCUIT, GARAGE_GROOVE, PODIUM, STING_INTRO, STING_FINAL_LAP, STING_WIN, STING_FINISH, STING_LOSE];

/** Track music ids (TrackDefinition.music) → song. */
export function trackSong(id: string): SongSpec {
  return SONGS.find((s) => s.id === id) ?? SUNNY_CIRCUIT;
}
