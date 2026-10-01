import type { Arrangement, MixerTrack, Note } from './audio';
import type { Track } from './catalog';
import type { Sound } from './instruments';
import { emptyDrumPattern, type DrumKit, type DrumLane } from './drum-pattern';

// Version 1 is immutable: shared links and saved scores must keep their music.
export const ORIGINALS_VERSION = 1;
type Style = 'sustain' | 'offbeat' | 'strum' | 'arp' | 'seventh';
type Family = {
  genre: string;
  kit: DrumKit;
  harmony: Sound;
  bass: Sound;
  lead: Sound;
  style: Style;
  swing: number;
  kick: number[];
  snare: number[];
  hats: number[];
  percussion: number[];
  bassAt: number[];
  melodyAt: number[];
};
const families: Family[] = [
  {
    genre: 'Hip-hop',
    kit: 'dusty',
    harmony: 'epiano',
    bass: 'sub',
    lead: 'brass',
    style: 'seventh',
    swing: 24,
    kick: [0, 6, 10],
    snare: [4, 12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14],
    percussion: [7, 15],
    bassAt: [0, 1.5, 2.75],
    melodyAt: [0, 0.75, 1.5, 2.5, 3.25],
  },
  {
    genre: 'R&B',
    kit: 'studio',
    harmony: 'epiano',
    bass: 'sub',
    lead: 'bell',
    style: 'seventh',
    swing: 16,
    kick: [0, 7, 10],
    snare: [4, 12],
    hats: [0, 3, 6, 8, 11, 14],
    percussion: [5, 13],
    bassAt: [0, 1.75, 3],
    melodyAt: [0.5, 1.25, 2, 2.75, 3.5],
  },
  {
    genre: 'Trap',
    kit: 'analog',
    harmony: 'pad',
    bass: 'sub',
    lead: 'pluck',
    style: 'sustain',
    swing: 0,
    kick: [0, 3, 10, 14],
    snare: [8],
    hats: [0, 2, 4, 6, 7, 8, 10, 12, 14, 15],
    percussion: [11],
    bassAt: [0, 0.75, 2.5, 3.5],
    melodyAt: [0, 0.5, 1.75, 2.5, 3.5],
  },
  {
    genre: 'Lo-fi',
    kit: 'dusty',
    harmony: 'epiano',
    bass: 'bass',
    lead: 'mallet',
    style: 'seventh',
    swing: 38,
    kick: [0, 6, 9],
    snare: [4, 12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14],
    percussion: [3, 11],
    bassAt: [0, 1.5, 2.25],
    melodyAt: [0.25, 1, 1.75, 2.75, 3.25],
  },
  {
    genre: 'Pop',
    kit: 'studio',
    harmony: 'guitar',
    bass: 'bass',
    lead: 'lead',
    style: 'strum',
    swing: 0,
    kick: [0, 6, 8, 10],
    snare: [4, 12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14],
    percussion: [7, 15],
    bassAt: [0, 1, 2, 3],
    melodyAt: [0, 1, 1.5, 2.5, 3],
  },
  {
    genre: 'Electronic',
    kit: 'analog',
    harmony: 'pad',
    bass: 'bass',
    lead: 'pluck',
    style: 'arp',
    swing: 0,
    kick: [0, 6, 8, 14],
    snare: [4, 12],
    hats: [2, 6, 10, 14],
    percussion: [1, 9, 15],
    bassAt: [0, 0.75, 2, 2.75],
    melodyAt: [0, 0.5, 1, 2.25, 3],
  },
  {
    genre: 'House',
    kit: 'analog',
    harmony: 'epiano',
    bass: 'bass',
    lead: 'organ',
    style: 'offbeat',
    swing: 12,
    kick: [0, 4, 8, 12],
    snare: [4, 12],
    hats: [2, 6, 10, 14],
    percussion: [3, 7, 11, 15],
    bassAt: [0.5, 1.5, 2.5, 3.5],
    melodyAt: [0.5, 1.25, 2, 2.5, 3.5],
  },
  {
    genre: 'Techno',
    kit: 'analog',
    harmony: 'strings',
    bass: 'bass',
    lead: 'pluck',
    style: 'arp',
    swing: 0,
    kick: [0, 4, 8, 12],
    snare: [12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14],
    percussion: [3, 6, 11, 14],
    bassAt: [0, 0.75, 1.5, 2.25, 3],
    melodyAt: [0, 0.75, 1.5, 2.25, 3.75],
  },
  {
    genre: 'Drum & Bass',
    kit: 'studio',
    harmony: 'pad',
    bass: 'sub',
    lead: 'epiano',
    style: 'seventh',
    swing: 0,
    kick: [0, 7, 10],
    snare: [4, 12],
    hats: [0, 2, 3, 6, 8, 10, 11, 14],
    percussion: [5, 13, 15],
    bassAt: [0, 1.75, 2.5, 3.75],
    melodyAt: [0, 0.75, 1.25, 2, 3.5],
  },
  {
    genre: 'Dubstep',
    kit: 'analog',
    harmony: 'pad',
    bass: 'bass',
    lead: 'brass',
    style: 'sustain',
    swing: 0,
    kick: [0, 6, 14],
    snare: [8],
    hats: [0, 2, 5, 7, 10, 12, 14],
    percussion: [3, 11, 15],
    bassAt: [0, 0.5, 1.5, 2.75, 3.5],
    melodyAt: [0, 0.75, 1.5, 2.75, 3.5],
  },
  {
    genre: 'Afrobeats',
    kit: 'latin',
    harmony: 'guitar',
    bass: 'sub',
    lead: 'mallet',
    style: 'strum',
    swing: 10,
    kick: [0, 6, 10],
    snare: [4, 11],
    hats: [0, 3, 6, 8, 11, 14],
    percussion: [2, 5, 7, 10, 13, 15],
    bassAt: [0, 1.5, 2.5, 3.25],
    melodyAt: [0, 0.75, 1.5, 2.25, 3.25],
  },
  {
    genre: 'Amapiano',
    kit: 'latin',
    harmony: 'epiano',
    bass: 'log',
    lead: 'mallet',
    style: 'seventh',
    swing: 26,
    kick: [0, 8],
    snare: [4, 12],
    hats: [2, 6, 10, 14],
    percussion: [1, 3, 7, 9, 11, 15],
    bassAt: [0.75, 1.5, 2.75, 3.5, 3.75],
    melodyAt: [0.5, 1, 1.75, 2.5, 3.25],
  },
  {
    genre: 'Dancehall',
    kit: 'latin',
    harmony: 'organ',
    bass: 'sub',
    lead: 'brass',
    style: 'offbeat',
    swing: 0,
    kick: [0, 6, 10],
    snare: [3, 8, 11],
    hats: [0, 2, 6, 8, 10, 14],
    percussion: [5, 13, 15],
    bassAt: [0, 1.5, 2.75],
    melodyAt: [0, 0.75, 1.5, 2.75, 3.25],
  },
  {
    genre: 'Reggaeton',
    kit: 'latin',
    harmony: 'pluck',
    bass: 'sub',
    lead: 'brass',
    style: 'offbeat',
    swing: 0,
    kick: [0, 8],
    snare: [3, 6, 11, 14],
    hats: [2, 4, 6, 10, 12, 14],
    percussion: [1, 7, 9, 15],
    bassAt: [0, 1.5, 2, 3.5],
    melodyAt: [0, 0.75, 1.5, 2.5, 3.5],
  },
  {
    genre: 'Latin Pop',
    kit: 'latin',
    harmony: 'guitar',
    bass: 'bass',
    lead: 'mallet',
    style: 'strum',
    swing: 0,
    kick: [0, 6, 8, 14],
    snare: [4, 12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14],
    percussion: [0, 3, 6, 10, 13],
    bassAt: [0, 1.5, 2, 3],
    melodyAt: [0.25, 1, 1.75, 2.5, 3.25],
  },
  {
    genre: 'Reggae',
    kit: 'acoustic',
    harmony: 'organ',
    bass: 'bass',
    lead: 'guitar',
    style: 'offbeat',
    swing: 12,
    kick: [8],
    snare: [8],
    hats: [0, 2, 4, 6, 8, 10, 12, 14],
    percussion: [3, 7, 11, 15],
    bassAt: [0, 1.5, 2.75, 3.5],
    melodyAt: [0.5, 1.5, 2, 2.75, 3.5],
  },
  {
    genre: 'Funk',
    kit: 'acoustic',
    harmony: 'guitar',
    bass: 'bass',
    lead: 'brass',
    style: 'strum',
    swing: 18,
    kick: [0, 3, 6, 10, 14],
    snare: [4, 12],
    hats: [0, 1, 2, 4, 6, 7, 8, 10, 12, 14, 15],
    percussion: [5, 11],
    bassAt: [0, 0.75, 1.5, 2, 2.75, 3.5],
    melodyAt: [0, 0.75, 1.25, 2.5, 3.25],
  },
  {
    genre: 'Disco',
    kit: 'acoustic',
    harmony: 'strings',
    bass: 'bass',
    lead: 'brass',
    style: 'offbeat',
    swing: 0,
    kick: [0, 4, 8, 12],
    snare: [4, 12],
    hats: [2, 6, 10, 14],
    percussion: [0, 4, 8, 12, 15],
    bassAt: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    melodyAt: [0.5, 1, 2, 2.75, 3.5],
  },
  {
    genre: 'Soul',
    kit: 'acoustic',
    harmony: 'epiano',
    bass: 'bass',
    lead: 'organ',
    style: 'seventh',
    swing: 30,
    kick: [0, 7, 10],
    snare: [4, 12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14],
    percussion: [6, 14],
    bassAt: [0, 1.75, 2.5, 3.5],
    melodyAt: [0.25, 1, 1.75, 2.5, 3.5],
  },
  {
    genre: 'Jazz',
    kit: 'dusty',
    harmony: 'epiano',
    bass: 'bass',
    lead: 'mallet',
    style: 'seventh',
    swing: 60,
    kick: [0, 10],
    snare: [6, 12],
    hats: [0, 4, 6, 8, 12, 14],
    percussion: [4, 12],
    bassAt: [0, 1, 2, 3],
    melodyAt: [0, 0.75, 1.5, 2.75, 3.5],
  },
  {
    genre: 'Rock',
    kit: 'acoustic',
    harmony: 'guitar',
    bass: 'bass',
    lead: 'guitar',
    style: 'strum',
    swing: 0,
    kick: [0, 2, 8, 10],
    snare: [4, 12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14],
    percussion: [0, 8],
    bassAt: [0, 0.5, 1, 2, 2.5, 3],
    melodyAt: [0, 0.5, 1.5, 2.5, 3],
  },
  {
    genre: 'Country',
    kit: 'acoustic',
    harmony: 'guitar',
    bass: 'bass',
    lead: 'guitar',
    style: 'strum',
    swing: 10,
    kick: [0, 8],
    snare: [4, 12],
    hats: [0, 4, 8, 12],
    percussion: [6, 14],
    bassAt: [0, 2],
    melodyAt: [0, 0.75, 1.5, 2, 3],
  },
  {
    genre: 'Ambient',
    kit: 'dusty',
    harmony: 'strings',
    bass: 'sub',
    lead: 'bell',
    style: 'sustain',
    swing: 0,
    kick: [0],
    snare: [],
    hats: [],
    percussion: [10],
    bassAt: [0],
    melodyAt: [0, 1.5, 2, 2.75, 3.5],
  },
  {
    genre: 'Gospel',
    kit: 'acoustic',
    harmony: 'organ',
    bass: 'bass',
    lead: 'epiano',
    style: 'seventh',
    swing: 20,
    kick: [0, 6, 8],
    snare: [4, 12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14],
    percussion: [4, 12, 15],
    bassAt: [0, 1.5, 2, 3.5],
    melodyAt: [0, 0.75, 1.5, 2.25, 3.5],
  },
];
export const ORIGINAL_GENRES = families.map((f) => f.genre);
type Composition = {
  version: 1;
  id: string;
  title: string;
  family: Family;
  bpm: number;
  root: number;
  minor: boolean;
  progression: number[];
  motif: number[];
  variant: number;
};
// Explicit melody degrees and chord progressions for each composition, in its key.
type Score = [string, number, number, boolean, number[], number[]];
const scores: Score[][] = [
  [
    ['BRICKLIGHT', 88, 36, true, [0, 5, 3, 4], [0, 2, 4, 1, 6, 4, 2, 0]],
    [
      'SIDE STREET THEORY',
      94,
      40,
      true,
      [0, 3, 6, 4],
      [4, 3, 1, 0, 2, 6, 5, 2],
    ],
  ],
  [
    ['VELVET WINDOW', 82, 42, true, [0, 3, 5, 4], [2, 4, 6, 5, 3, 2, 1, 4]],
    ['SILK CURRENT', 98, 45, false, [0, 5, 1, 4], [4, 2, 1, 0, 6, 5, 2, 4]],
  ],
  [
    ['OBSIDIAN', 142, 38, true, [0, 0, 5, 4], [0, 4, 3, 0, 6, 4, 1, 0]],
    ['ICE ORBIT', 154, 41, true, [0, 6, 3, 5], [6, 4, 2, 0, 1, 3, 4, 2]],
  ],
  [
    ['PAPER MOON', 74, 45, true, [0, 3, 1, 4], [2, 1, 0, 4, 3, 6, 5, 2]],
    ['DUST ON THE SILL', 80, 43, false, [1, 4, 0, 5], [4, 6, 5, 2, 0, 1, 3, 2]],
  ],
  [
    ['DAYBREAK PARADE', 110, 36, false, [0, 4, 5, 3], [0, 2, 4, 4, 5, 4, 2, 1]],
    ['OPEN WINDOWS', 118, 38, false, [5, 3, 0, 4], [4, 5, 6, 4, 2, 3, 1, 0]],
  ],
  [
    ['PRISM ENGINE', 124, 42, true, [0, 5, 2, 6], [0, 3, 4, 6, 2, 1, 5, 4]],
    ['GLASS CIRCUIT', 132, 45, true, [0, 3, 6, 4], [4, 1, 3, 0, 6, 2, 4, 5]],
  ],
  [
    ['ROOFTOP MOTION', 122, 41, true, [0, 3, 5, 4], [2, 4, 6, 4, 1, 0, 3, 2]],
    ['CITRUS CLUB', 126, 43, false, [0, 5, 1, 4], [4, 5, 2, 0, 1, 3, 6, 4]],
  ],
  [
    ['STEEL BLOOM', 134, 38, true, [0, 0, 5, 6], [0, 1, 4, 2, 0, 5, 3, 1]],
    ['PULSE FORGE', 138, 42, true, [0, 3, 0, 4], [4, 0, 3, 1, 6, 2, 0, 5]],
  ],
  [
    ['RAIN RUNNER', 170, 41, true, [0, 5, 3, 6], [0, 4, 6, 5, 2, 3, 1, 4]],
    ['SKYLINE VELOCITY', 174, 43, true, [0, 3, 6, 4], [6, 4, 2, 3, 1, 0, 5, 2]],
  ],
  [
    ['GRAVITY WELL', 140, 40, true, [0, 0, 3, 6], [0, 6, 4, 1, 0, 3, 2, 5]],
    ['FRACTURE FIELD', 148, 38, true, [0, 5, 0, 4], [4, 2, 0, 5, 1, 6, 3, 0]],
  ],
  [
    ['PALM SIGNAL', 104, 45, true, [0, 6, 5, 6], [0, 2, 4, 2, 6, 5, 3, 1]],
    ['SUN MARKET', 112, 41, false, [0, 3, 4, 0], [4, 5, 2, 1, 0, 3, 2, 6]],
  ],
  [
    ['JOZI LANTERNS', 112, 42, true, [0, 3, 5, 4], [2, 4, 1, 0, 6, 3, 5, 2]],
    ['LOGWOOD', 116, 45, true, [0, 6, 3, 4], [4, 2, 6, 1, 0, 5, 3, 4]],
  ],
  [
    ['YARD LIGHTS', 96, 43, true, [0, 6, 0, 5], [0, 4, 2, 1, 6, 3, 2, 0]],
    ['ISLAND RELAY', 106, 38, true, [0, 3, 6, 4], [4, 1, 0, 2, 5, 6, 3, 1]],
  ],
  [
    ['NEON PATIO', 94, 41, true, [0, 5, 3, 6], [0, 2, 4, 6, 4, 1, 3, 2]],
    ['LUNA ESQUINA', 102, 45, true, [0, 6, 5, 4], [4, 3, 1, 0, 2, 5, 6, 2]],
  ],
  [
    ['MANGO AVENUE', 108, 38, false, [0, 4, 5, 3], [0, 4, 5, 2, 1, 3, 4, 6]],
    ['CORAL PROMENADE', 116, 43, false, [5, 3, 0, 4], [2, 3, 4, 1, 0, 6, 5, 4]],
  ],
  [
    ['CEDAR DUB', 78, 36, true, [0, 3, 4, 0], [0, 2, 4, 2, 1, 6, 3, 0]],
    ['EASY HORIZON', 86, 41, false, [0, 3, 0, 4], [4, 2, 0, 1, 3, 5, 2, 4]],
  ],
  [
    ['POCKET CHROME', 106, 40, true, [0, 0, 3, 4], [0, 2, 3, 4, 6, 4, 1, 2]],
    ['RUBBER SOLE', 114, 45, true, [0, 3, 0, 6], [4, 6, 2, 0, 3, 1, 5, 4]],
  ],
  [
    [
      'MIRRORBALL EXPRESS',
      118,
      38,
      true,
      [0, 3, 5, 4],
      [4, 2, 0, 2, 5, 6, 4, 3],
    ],
    ['SATURDAY SATIN', 124, 41, false, [0, 5, 1, 4], [0, 2, 4, 5, 4, 6, 3, 1]],
  ],
  [
    ['AMBER LETTER', 84, 43, false, [0, 5, 1, 4], [2, 4, 5, 4, 1, 0, 6, 2]],
    ['COPPER HEART', 92, 40, true, [0, 3, 5, 4], [4, 6, 3, 2, 0, 1, 5, 4]],
  ],
  [
    ['BLUE TERRACE', 96, 38, true, [1, 4, 0, 5], [1, 3, 5, 6, 4, 2, 0, 3]],
    [
      'AFTERNOON QUARTET',
      122,
      41,
      false,
      [1, 4, 0, 5],
      [4, 6, 2, 5, 3, 1, 0, 2],
    ],
  ],
  [
    ['REDLINE GARAGE', 128, 40, true, [0, 5, 3, 6], [0, 4, 4, 2, 6, 5, 3, 1]],
    ['WIDE OPEN ROAD', 144, 43, false, [0, 3, 4, 3], [4, 2, 0, 2, 3, 5, 6, 4]],
  ],
  [
    ['PORCHLIGHT TRAIL', 92, 38, false, [0, 3, 0, 4], [0, 2, 4, 2, 1, 3, 5, 4]],
    [
      'DUSTY COUNTY LINE',
      104,
      45,
      false,
      [0, 5, 3, 4],
      [4, 2, 1, 0, 3, 4, 6, 5],
    ],
  ],
  [
    ['TIDAL AURORA', 64, 41, false, [0, 2, 5, 3], [0, 4, 2, 6, 5, 3, 1, 4]],
    ['FLOATING GARDEN', 72, 38, true, [0, 5, 3, 6], [4, 2, 0, 3, 6, 5, 1, 2]],
  ],
  [
    [
      'MORNING TESTIMONY',
      90,
      41,
      false,
      [0, 3, 1, 4],
      [0, 2, 4, 5, 6, 4, 2, 1],
    ],
    [
      'STAINED GLASS RISE',
      108,
      43,
      false,
      [0, 5, 1, 4],
      [4, 5, 6, 2, 3, 1, 0, 4],
    ],
  ],
];
export const originals: Composition[] = families.flatMap((family, index) =>
  scores[index].map(
    ([title, bpm, root, minor, progression, motif], variant) => ({
      version: 1,
      id: `demo-original-v1-${index + 1}-${variant + 1}`,
      title,
      family,
      bpm,
      root,
      minor,
      progression,
      motif,
      variant,
    }),
  ),
);
export function originalFor(id: string) {
  return originals.find((o) => o.id === id);
}
const keyNames = [
  'C',
  'C♯',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
];
export function originalBars(o: Composition) {
  return Math.round(o.bpm / 8) * 4;
}
export const originalTracks: Track[] = originals.map((o, i) => ({
  id: o.id,
  title: o.title,
  creator: 'SESSION Originals',
  kind: 'beat',
  genre: o.family.genre,
  bpm: o.bpm,
  musicalKey: `${keyNames[o.root % 12]} ${o.minor ? 'minor' : 'major'}`,
  visibility: 'public',
  permission: 'collaborate',
  demo: true,
  color: ['lime', 'blue', 'pink', 'amber'][i % 4],
}));

function scoreLayers(o: Composition): MixerTrack[] {
  const f = o.family,
    scale = o.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const pitch = (degree: number, octave = 0) =>
    o.root +
    scale[((degree % 7) + 7) % 7] +
    Math.floor(degree / 7) * 12 +
    octave * 12;
  const notes = (kind: 'bass' | 'harmony' | 'theme' | 'answer'): Note[] => {
    const result: Note[] = [];
    const add = (p: number, start: number, length: number, velocity: number) =>
      result.push({
        id: `${kind}-${result.length}`,
        pitch: p,
        start,
        length: Math.min(length, 16 - start),
        velocity,
      });
    for (let bar = 0; bar < 4; bar++) {
      const chord = o.progression[bar],
        at = bar * 4;
      if (kind === 'bass') {
        f.bassAt.forEach((beat, i) => {
          const degree =
            chord +
            (f.genre === 'Jazz'
              ? [0, 2, 4, 6][i % 4]
              : i === f.bassAt.length - 1
                ? 4
                : 0);
          const p = pitch(degree) - (pitch(degree) > 47 ? 12 : 0);
          add(
            p,
            at + beat,
            f.genre === 'Ambient'
              ? 3.9
              : Math.min(0.8, (f.bassAt[i + 1] ?? 4) - beat - 0.06),
            0.65 + (i % 2) * 0.1,
          );
        });
      } else if (kind === 'harmony') {
        const chordDegrees = f.style === 'seventh' ? [0, 2, 4, 6] : [0, 2, 4];
        if (f.style === 'arp') {
          for (let i = 0; i < 8; i++)
            add(
              pitch(chord + chordDegrees[(i + o.variant) % 3], 1),
              at + i * 0.5,
              0.42,
              0.4,
            );
        } else {
          const hits =
            f.style === 'offbeat'
              ? [0.5, 1.5, 2.5, 3.5]
              : f.style === 'strum'
                ? [0, 1.5, 2, 3.5]
                : [0];
          hits.forEach((beat) =>
            chordDegrees.forEach((d, i) =>
              add(
                pitch(chord + d, 1),
                at + beat + (f.style === 'strum' ? i * 0.025 : 0),
                f.style === 'sustain' || f.style === 'seventh' ? 3.95 : 0.36,
                0.3 + i * 0.025,
              ),
            ),
          );
        }
      } else {
        f.melodyAt.forEach((beat, i) => {
          const degree =
            o.motif[
              (bar * 3 + i + (kind === 'answer' ? 3 : 0)) % o.motif.length
            ];
          if (kind === 'answer' && i % 2 === 0) return;
          add(
            pitch(degree, kind === 'answer' ? 2 : 2),
            at + beat + (o.variant && i === 2 ? 0.125 : 0),
            f.genre === 'Ambient' ? 0.9 : i === 4 ? 0.45 : 0.3 + (i % 2) * 0.15,
            kind === 'answer' ? 0.28 : 0.46,
          );
        });
      }
    }
    return result;
  };
  function drums(fill: boolean) {
    const p = emptyDrumPattern(64, f.kit);
    p.swing = f.swing;
    for (let bar = 0; bar < 4; bar++) {
      for (const [lane, hits] of [
        ['kick', f.kick],
        ['snare', f.snare],
        ['closedHat', f.hats],
        ['percussion', f.percussion],
      ] as [DrumLane, number[]][]) {
        for (const step of hits)
          p.lanes[lane][bar * 16 + step] =
            lane === 'closedHat'
              ? 0.38 + (step % 4 === 0 ? 0.18 : 0)
              : lane === 'percussion'
                ? 0.34 + (bar % 2) * 0.1
                : 0.8;
      }
      if (o.variant === 1) {
        p.lanes.kick[bar * 16 + (bar % 2 ? 15 : 5)] = 0.6;
        p.lanes.percussion[bar * 16 + 2] = 0.5;
      }
      if (bar % 2 === 1 && f.hats.length) p.lanes.openHat[bar * 16 + 14] = 0.32;
    }
    if (fill) {
      for (const step of [54, 58, 60, 62, 63])
        p.lanes[f.snare.length ? 'snare' : 'percussion'][step] =
          0.4 + (step % 3) * 0.15;
      p.lanes.openHat[48] = 0.6;
    }
    return p;
  }
  const base = (name: string, volume: number, pan = 0): MixerTrack => ({
    id: crypto.randomUUID(),
    name,
    volume,
    pan,
    muted: false,
    solo: false,
    offset: 0,
    trimStart: 0,
    trimEnd: 0,
    low: 0,
    mid: 0,
    high: 0,
  });
  return [
    { ...base('Groove', 0.48), drumPattern: drums(false) },
    { ...base('Turnaround', 0.48), drumPattern: drums(true) },
    {
      ...base(f.bass === 'log' ? 'Log drum bass' : 'Bass', 0.65),
      notes: notes('bass'),
      sound: f.bass,
    },
    {
      ...base('Harmony', 0.6, -0.15),
      notes: notes('harmony'),
      sound: f.harmony,
    },
    { ...base('Theme', 0.58, 0.12), notes: notes('theme'), sound: f.lead },
    {
      ...base('Answer', 0.45, -0.3),
      notes: notes('answer'),
      sound: f.genre === 'Ambient' ? 'mallet' : 'strings',
    },
  ];
}

export function originalArrangement(
  id: string,
  options: { preview?: boolean; bpm?: number } = {},
): Arrangement | null {
  const o = originalFor(id);
  if (!o) return null;
  const bpm = options.bpm ?? o.bpm;
  const blocks = options.preview ? 2 : originalBars(o) / 4;
  const blockSeconds = (16 * 60) / bpm;
  const tracks = scoreLayers(o).flatMap((track, index) => {
    const placements = [];
    const tail = track.notes ? 0.5 : 0;
    if (track.notes) track.noteLoopBeats = 16;
    track.duration = blockSeconds + tail;
    for (let block = 0; block < blocks; block++) {
      const intro = block === 0,
        outro = block === blocks - 1;
      const breakdown = block === Math.floor(blocks * 0.55);
      const hook =
        options.preview ||
        (block >= Math.floor(blocks * 0.25) &&
          block < Math.floor(blocks * 0.5)) ||
        block >= Math.floor(blocks * 0.7);
      const fill = block % 4 === 3 || outro;
      const active = options.preview
        ? (index !== 1 || block === 1) && (index !== 0 || block === 0)
        : index === 3 ||
          (index === 4 && !breakdown) ||
          (index === 5 && hook && !outro) ||
          (index === 2 && !intro && !outro) ||
          ((index === 0 || index === 1) &&
            !intro &&
            !breakdown &&
            !outro &&
            (index === 1 ? fill : !fill));
      if (active)
        placements.push({
          id: crypto.randomUUID(),
          name: options.preview
            ? 'Preview'
            : intro
              ? 'Intro'
              : outro
                ? 'Outro'
                : breakdown
                  ? 'Breakdown'
                  : hook
                    ? 'Hook'
                    : fill
                      ? 'Turnaround'
                      : 'Verse',
          offset: block * blockSeconds,
          trimStart: 0,
          trimEnd: tail,
          fadeIn: 0.012,
          fadeOut: outro ? 0.7 : 0.025,
        });
    }
    if (!placements.length) return [];
    const [first, ...clips] = placements;
    return [
      {
        ...track,
        offset: first.offset,
        trimEnd: first.trimEnd,
        fadeIn: first.fadeIn,
        fadeOut: first.fadeOut,
        clipName: first.name,
        clips,
      },
    ];
  });
  return { bpm, tracks };
}
