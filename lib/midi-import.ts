import { defaults, type Arrangement, type Note } from './audio';
import { validateArrangement } from './arrangement-validation';

export const MIDI_FILE_LIMIT = 2 * 1024 * 1024;
export type MidiPart = {
  id: string;
  name: string;
  channel: number;
  port: number;
  notes: Note[];
  issue?: string;
};
export type MidiDocument = {
  parts: MidiPart[];
  bpm: number;
  variableTempo: boolean;
  warnings: string[];
};
export type MidiChoice = { id: string; sound: 'keys' | 'bass' | 'pad' };
type Event = {
  tick: number;
  track: number;
  order: number;
  port: number;
  status: number;
  a: number;
  b: number;
};

/** Bounded Standard MIDI File reader. File bytes never leave the browser. */
export function parseMidi(buffer: ArrayBuffer): MidiDocument {
  if (!buffer.byteLength || buffer.byteLength > MIDI_FILE_LIMIT)
    throw Error('Choose a MIDI file under 2 MB.');
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  let pos = 0,
    limit = bytes.length;
  const need = (n: number) => {
    if (n < 0 || pos + n > limit)
      throw Error(
        'The MIDI file is incomplete or has an invalid event length.',
      );
  };
  const byte = () => {
    need(1);
    return bytes[pos++];
  };
  const word = () => {
    need(2);
    const v = view.getUint16(pos);
    pos += 2;
    return v;
  };
  const long = () => {
    need(4);
    const v = view.getUint32(pos);
    pos += 4;
    return v;
  };
  const tag = () => String.fromCharCode(byte(), byte(), byte(), byte());
  const vlq = () => {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const v = byte();
      n = n * 128 + (v & 127);
      if (!(v & 128)) return n;
    }
    throw Error('The MIDI file contains an invalid timing value.');
  };
  if (tag() !== 'MThd')
    throw Error('Choose a Standard MIDI File (.mid or .midi).');
  const header = long();
  need(header);
  if (header < 6) throw Error('The MIDI header is invalid.');
  const format = word(),
    count = word(),
    ppq = word();
  pos += header - 6;
  if (format > 1)
    throw Error('MIDI format 2 is not supported. Export a format 0 or 1 file.');
  if (!count || count > 128 || (format === 0 && count !== 1))
    throw Error('Use a MIDI file with 1–128 source tracks.');
  if (!ppq || ppq & 0x8000)
    throw Error(
      'Use a MIDI file with musical beat timing (PPQ), rather than SMPTE timing.',
    );
  const events: Event[] = [],
    names: string[] = [],
    tempos: { tick: number; value: number; order: number }[] = [];
  const warnings = new Set<string>();
  let total = 0,
    noteOns = 0,
    endTick = 0,
    tracks = 0;
  while (pos < bytes.length) {
    limit = bytes.length;
    const kind = tag(),
      size = long();
    need(size);
    const end = pos + size;
    if (kind !== 'MTrk') {
      pos = end;
      continue;
    }
    if (tracks >= count)
      throw Error('The MIDI track count does not match its header.');
    limit = end;
    const track = tracks++;
    let tick = 0,
      running = 0,
      port = 0,
      ended = false;
    while (pos < end) {
      if (++total > 50000)
        throw Error(
          'This MIDI file has too many events. Export a smaller selection.',
        );
      tick += vlq();
      if (!Number.isSafeInteger(tick) || tick / ppq > 1000000)
        throw Error('This MIDI timeline is too long.');
      endTick = Math.max(endTick, tick);
      let status = byte();
      if (status < 128) {
        if (!running) throw Error('The MIDI file has invalid running status.');
        pos--;
        status = running;
      }
      if (status === 255) {
        running = 0;
        const type = byte(),
          length = vlq();
        need(length);
        if (type === 47) {
          if (length !== 0 || pos !== end)
            throw Error('The MIDI end-of-track marker is invalid.');
          ended = true;
          break;
        }
        if (type === 3)
          names[track] = new TextDecoder()
            .decode(bytes.subarray(pos, pos + Math.min(length, 256)))
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .trim()
            .slice(0, 72);
        if (type === 81) {
          if (length !== 3) throw Error('The MIDI tempo event is invalid.');
          const value =
            bytes[pos] * 65536 + bytes[pos + 1] * 256 + bytes[pos + 2];
          if (!value) throw Error('The MIDI tempo cannot be zero.');
          tempos.push({ tick, value, order: total });
        }
        if (type === 33) {
          if (length !== 1) throw Error('The MIDI port event is invalid.');
          port = bytes[pos];
        }
        if (type === 88) {
          if (length !== 4) throw Error('The MIDI time signature is invalid.');
          if (bytes[pos] !== 4 || bytes[pos + 1] !== 2)
            warnings.add(
              'Time signature changes are not imported. SESSION displays a 4/4 grid.',
            );
        }
        if (type === 2)
          warnings.add(
            'Copyright and other text metadata stay in your original file; they are not added to the project. Keep the original file and any required credits.',
          );
        pos += length;
      } else if (status === 240 || status === 247) {
        running = 0;
        const length = vlq();
        need(length);
        pos += length;
        warnings.add('System-exclusive instrument settings are not imported.');
      } else {
        if (status < 128 || status >= 240)
          throw Error('The MIDI file contains an unsupported system event.');
        running = status;
        const type = status & 240,
          a = byte(),
          b = type === 192 || type === 208 ? 0 : byte();
        if (a > 127 || b > 127)
          throw Error(
            'The MIDI file contains invalid note or controller data.',
          );
        if (type === 144 && b && ++noteOns > 10000)
          throw Error(
            'This MIDI file has too many notes. Export a smaller selection.',
          );
        if ([128, 144, 176].includes(type))
          events.push({ tick, track, order: total, port, status, a, b });
        if (type === 192)
          warnings.add(
            'Original instrument presets are not imported. Choose a SESSION sound for each part.',
          );
        if (
          [160, 208, 224].includes(type) ||
          (type === 176 && ![64, 120, 121, 123].includes(a))
        )
          warnings.add(
            'Pitch bends, expression and other controller automation are not imported. Note velocity and sustain are preserved.',
          );
      }
    }
    if (!ended) throw Error('A MIDI track is missing its end-of-track marker.');
    pos = end;
  }
  if (tracks !== count)
    throw Error('The MIDI track count does not match its header.');
  const parts = new Map<string, MidiPart>(),
    pedal = new Set<string>();
  type Voice = {
    part: MidiPart;
    note: Note;
    down: boolean;
    channel: string;
    tick: number;
  };
  const voices: Voice[] = [];
  const finish = (voice: Voice, tick: number) => {
    const length = (tick - voice.tick) / ppq;
    if (length < 0.01)
      warnings.add(
        'Notes shorter than 0.01 beat were lengthened to SESSION’s minimum note length.',
      );
    voice.note.length = Math.max(0.01, length);
    voice.part.notes.push(voice.note);
    voices.splice(voices.indexOf(voice), 1);
  };
  events.sort(
    (a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order,
  );
  for (const e of events) {
    const channel = e.port + ':' + (e.status & 15),
      type = e.status & 240;
    if (type === 176) {
      if (e.a === 64) {
        if (e.b >= 64) pedal.add(channel);
        else {
          pedal.delete(channel);
          for (const v of [...voices])
            if (v.channel === channel && !v.down) finish(v, e.tick);
        }
      } else if ([120, 121, 123].includes(e.a)) {
        if (e.a === 121) pedal.delete(channel);
        for (const v of [...voices])
          if (v.channel === channel) {
            if (e.a === 123) v.down = false;
            if (e.a === 120 || (!v.down && !pedal.has(channel)))
              finish(v, e.tick);
          }
      }
    } else if (type === 128 || !e.b) {
      const voice = voices.find(
        (v) => v.channel === channel && v.note.pitch === e.a && v.down,
      );
      if (voice) {
        voice.down = false;
        if (!pedal.has(channel)) finish(voice, e.tick);
      }
    } else {
      const key = e.track + ':' + channel;
      let part = parts.get(key);
      if (!part) {
        if (parts.size >= 64)
          throw Error('Use a MIDI file with up to 64 note-bearing parts.');
        part = {
          id: crypto.randomUUID(),
          name: names[e.track] || `MIDI track ${e.track + 1}`,
          channel: (e.status & 15) + 1,
          port: e.port,
          notes: [],
        };
        parts.set(key, part);
      }
      if (
        voices.some(
          (v) => v.channel === channel && v.note.pitch === e.a && v.down,
        )
      )
        warnings.add(
          'Overlapping notes of the same pitch and channel are paired in arrival order. Check these parts before adding them.',
        );
      if (voices.length >= 2048)
        throw Error('This MIDI file has too many simultaneous notes.');
      voices.push({
        part,
        channel,
        tick: e.tick,
        down: true,
        note: {
          id: crypto.randomUUID(),
          pitch: e.a,
          start: e.tick / ppq,
          length: 0.01,
          velocity: e.b / 127,
        },
      });
    }
  }
  if (voices.length)
    warnings.add(
      'Notes still held at the end of the file were ended at that point.',
    );
  for (const v of [...voices]) finish(v, endTick);
  for (const part of parts.values()) {
    part.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    if (part.channel === 10)
      part.issue =
        'Drum-channel parts are not supported by this instrument importer.';
    else if (part.notes.length > 256)
      part.issue = 'More than 256 notes. Export this part in smaller sections.';
    else if (part.notes.some((n) => n.start > 256 || n.length > 32))
      part.issue =
        'Use note starts within 256 beats and note lengths within 32 beats.';
  }
  let tempo = 500000,
    initial = 500000,
    variableTempo = false;
  const effectiveTempos = new Map<number, number>();
  for (const t of tempos.sort((a, b) => a.tick - b.tick || a.order - b.order))
    effectiveTempos.set(t.tick, t.value);
  for (const [tick, value] of effectiveTempos) {
    const t = { tick, value };
    if (t.tick === 0) initial = tempo = t.value;
    else if (t.value !== tempo) {
      variableTempo = true;
      tempo = t.value;
    }
  }
  if (variableTempo)
    warnings.add(
      'Tempo changes are not imported. Beat positions are preserved and all parts play at the project tempo.',
    );
  if (!parts.size) throw Error('This file contains no MIDI notes to import.');
  return {
    parts: [...parts.entries()]
      .sort(
        ([a], [b]) =>
          Number(a.split(':')[0]) - Number(b.split(':')[0]) ||
          a.localeCompare(b),
      )
      .map(([, part]) => part),
    bpm: 60000000 / initial,
    variableTempo,
    warnings: [...warnings],
  };
}

/** Revalidate against the live project immediately before one undoable append. */
export function appendMidi(
  data: Arrangement,
  originalBpm: number,
  document: MidiDocument,
  choices: MidiChoice[],
  offset: number,
  useFileTempo: boolean,
  sampleRate = 48000,
): Arrangement {
  if (!Number.isFinite(sampleRate) || sampleRate < 3000 || sampleRate > 384000)
    throw Error('This audio sample rate is not supported for MIDI import.');
  if (data.bpm !== originalBpm)
    throw Error(
      'The project tempo changed. Close import and reopen it from the updated project.',
    );
  if (!choices.length) throw Error('Select at least one available part.');
  if (!Number.isFinite(offset) || offset < 0 || offset >= 300)
    throw Error('Choose an insertion time from 0 to 299 seconds.');
  if (new Set(choices.map((c) => c.id)).size !== choices.length)
    throw Error('Select each MIDI part only once.');
  if (
    useFileTempo &&
    (data.tracks.length ||
      document.variableTempo ||
      document.bpm < 40 ||
      document.bpm > 240)
  )
    throw Error(
      'File tempo can only be used for a constant-tempo file in an empty project, within 40–240 BPM.',
    );
  const bpm = useFileTempo ? document.bpm : data.bpm;
  const added = choices.map((c) => {
    const p = document.parts.find((p) => p.id === c.id);
    if (!p || p.issue || !['keys', 'bass', 'pad'].includes(c.sound))
      throw Error('Select an available MIDI part and sound.');
    const duration =
      (Math.max(8, ...p.notes.map((n) => n.start + n.length)) * 60) / bpm + 0.5;
    if (duration + offset > 300)
      throw Error(
        `${p.name} exceeds the five-minute project limit at this tempo and insertion time.`,
      );
    return {
      ...defaults(p.name + ` · Ch ${p.channel}`),
      id: p.id,
      notes: p.notes.map((n) => ({ ...n })),
      sound: c.sound,
      offset,
    };
  });
  const next = { ...data, bpm, tracks: [...data.tracks, ...added] };
  validateArrangement(next, true);
  // Generated sources are rendered together by the existing audio engine. Bound the
  // whole project's predicted buffers before triggering automatic enrichment.
  const seconds = next.tracks.reduce(
    (sum, t) =>
      sum +
      (t.notes
        ? (Math.max(8, ...t.notes.map((n) => n.start + n.length)) * 60) / bpm +
          0.5
        : 0),
    0,
  );
  if (seconds * Math.max(44100, sampleRate) * 2 * 4 > 128 * 1024 * 1024)
    throw Error(
      'These parts need too much audio memory together. Select fewer parts or import a shorter section into a new project.',
    );
  if (JSON.stringify(next).length > 250000)
    throw Error(
      'This project is too large. Select fewer MIDI parts or start a new project.',
    );
  return next;
}
