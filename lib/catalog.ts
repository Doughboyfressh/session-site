export type Track = {
  id: string;
  title: string;
  creator: string;
  owner?: string;
  kind: string;
  genre: string;
  bpm: number;
  musicalKey: string;
  visibility: string;
  permission: string;
  fileId?: string;
  demo?: boolean;
  color?: string;
  likes?: number;
  price?: number | null;
  created?: number;
};
export const demos: Track[] = [
  {
    id: 'demo-1',
    title: 'AFTER HOURS',
    creator: 'SESSION Originals',
    kind: 'beat',
    genre: 'R&B',
    bpm: 92,
    musicalKey: 'F minor',
    visibility: 'public',
    permission: 'collaborate',
    demo: true,
    color: 'lime',
  },
  {
    id: 'demo-2',
    title: 'BLUE HOUR',
    creator: 'SESSION Originals',
    kind: 'beat',
    genre: 'Hip-hop',
    bpm: 85,
    musicalKey: 'C minor',
    visibility: 'public',
    permission: 'collaborate',
    demo: true,
    color: 'blue',
  },
  {
    id: 'demo-3',
    title: 'NO SIGNAL',
    creator: 'SESSION Originals',
    kind: 'beat',
    genre: 'Trap',
    bpm: 140,
    musicalKey: 'D minor',
    visibility: 'public',
    permission: 'collaborate',
    demo: true,
    color: 'pink',
  },
  {
    id: 'demo-4',
    title: 'SOFT FOCUS',
    creator: 'SESSION Originals',
    kind: 'beat',
    genre: 'Lo-fi',
    bpm: 76,
    musicalKey: 'A minor',
    visibility: 'public',
    permission: 'collaborate',
    demo: true,
    color: 'amber',
  },
  {
    id: 'demo-5',
    title: 'MIDNIGHT DRIVE',
    creator: 'SESSION Originals',
    kind: 'beat',
    genre: 'Electronic',
    bpm: 120,
    musicalKey: 'G minor',
    visibility: 'public',
    permission: 'collaborate',
    demo: true,
    color: 'blue',
  },
  {
    id: 'demo-6',
    title: 'GOLDEN HOUR',
    creator: 'SESSION Originals',
    kind: 'beat',
    genre: 'Pop',
    bpm: 104,
    musicalKey: 'A minor',
    visibility: 'public',
    permission: 'collaborate',
    demo: true,
    color: 'amber',
  },
  {
    id: 'demo-7',
    title: 'CONCRETE',
    creator: 'SESSION Originals',
    kind: 'beat',
    genre: 'Hip-hop',
    bpm: 88,
    musicalKey: 'E minor',
    visibility: 'public',
    permission: 'collaborate',
    demo: true,
    color: 'pink',
  },
  {
    id: 'demo-8',
    title: 'LOW TIDE',
    creator: 'SESSION Originals',
    kind: 'beat',
    genre: 'Lo-fi',
    bpm: 72,
    musicalKey: 'D minor',
    visibility: 'public',
    permission: 'collaborate',
    demo: true,
    color: 'lime',
  },
  {
    id: 'demo-9',
    title: 'SIGNAL LOST',
    creator: 'SESSION Originals',
    kind: 'beat',
    genre: 'Trap',
    bpm: 146,
    musicalKey: 'F minor',
    visibility: 'public',
    permission: 'collaborate',
    demo: true,
    color: 'pink',
  },
  {
    id: 'demo-10',
    title: 'SLOW BURN',
    creator: 'SESSION Originals',
    kind: 'beat',
    genre: 'R&B',
    bpm: 96,
    musicalKey: 'C minor',
    visibility: 'public',
    permission: 'collaborate',
    demo: true,
    color: 'blue',
  },
];
export const genres = [
  'All genres',
  'Hip-hop',
  'R&B',
  'Trap',
  'Lo-fi',
  'Pop',
  'Electronic',
];
export const defaultPattern = [
  [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
];
