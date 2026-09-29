import type { Arrangement, MixerTrack, Note } from './audio';
import { applyNotePatch, checkNotes } from './note-edit';
import { playlistClips, playlistTrackEnd } from './playlist-clips';

export type MidiEvent =
  | { kind: 'on'; channel: number; pitch: number; velocity: number }
  | { kind: 'off'; channel: number; pitch: number }
  | { kind: 'pedal'; channel: number; down: boolean }
  | { kind: 'reset'; channel: number };

export function midiEvent(data: ArrayLike<number>): MidiEvent | null {
  if (
    data.length !== 3 ||
    ![...Array.from(data)].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 255,
    )
  )
    return null;
  const [status, a, b] = Array.from(data);
  if (status < 128 || a > 127 || b > 127) return null;
  const channel = status & 15,
    kind = status & 240;
  if (kind === 144 && b)
    return { kind: 'on', channel, pitch: a, velocity: b / 127 };
  if (kind === 128 || (kind === 144 && !b))
    return { kind: 'off', channel, pitch: a };
  if (kind === 176 && a === 64)
    return { kind: 'pedal', channel, down: b >= 64 };
  if (kind === 176 && [120, 121, 123].includes(a))
    return { kind: 'reset', channel };
  return null;
}

export type MidiPlan = {
  start: number;
  beats: number;
  timeline: number;
  bpm: number;
  capacity: number;
};
export function midiPlan(
  track: MixerTrack,
  bpm: number,
  start: number,
  beats: number,
): MidiPlan {
  if (
    !track.notes ||
    (track.fileId && !track.sample) ||
    track.sequence ||
    track.drumPattern ||
    track.demo
  )
    throw Error('Select an instrument track to record MIDI.');
  if (
    playlistClips(track).some((clip) => clip.trimStart || clip.trimEnd) ||
    track.splitFrom
  )
    throw Error(
      'Use an untrimmed instrument track for MIDI recording. You can add a new instrument track.',
    );
  if (
    ![start, beats, bpm, track.offset].every(Number.isFinite) ||
    bpm < 40 ||
    bpm > 240 ||
    start < 0 ||
    start >= 256 ||
    beats < 0.25 ||
    beats > 32 ||
    start + beats > 256 ||
    track.offset < 0 ||
    playlistClips(track).some(
      (clip) => clip.offset + ((start + beats) * 60) / bpm > 300,
    )
  )
    throw Error(
      'Choose a recording range within 32 beats and the five-minute project limit.',
    );
  const capacity = 256 - track.notes.length;
  checkNotes(track, bpm, track.notes);
  const sourceEnd =
    (Math.max(8, start + beats, ...track.notes.map((n) => n.start + n.length)) *
      60) /
      bpm +
    0.5;
  if (sourceEnd > 300 || playlistTrackEnd(track, sourceEnd) > 300)
    throw Error(
      'This recording range and instrument tail must stay within the five-minute project limit.',
    );
  if (capacity <= 0)
    throw Error(
      'This instrument already has 256 notes. Remove notes or use a new instrument.',
    );
  return {
    start,
    beats,
    bpm,
    capacity,
    timeline: track.offset + (start * 60) / bpm,
  };
}

type Held = {
  channel: number;
  pitch: number;
  velocity: number;
  start: number;
  down: boolean;
};
export class MidiPerformance {
  private held = new Map<string, Held>();
  private pedal = new Set<number>();
  private notes: Note[] = [];
  private last = 0;
  private finished = false;
  full = false;
  constructor(
    readonly plan: MidiPlan,
    readonly clockStart: number,
  ) {
    if (
      !Number.isFinite(clockStart) ||
      !Number.isInteger(plan.capacity) ||
      plan.capacity < 1 ||
      plan.capacity > 256 ||
      ![plan.start, plan.beats, plan.bpm].every(Number.isFinite) ||
      plan.bpm < 40 ||
      plan.bpm > 240 ||
      plan.start < 0 ||
      plan.beats < 0.25 ||
      plan.beats > 32 ||
      plan.start + plan.beats > 256
    )
      throw Error('Invalid MIDI recording plan.');
  }
  get count() {
    return this.notes.length + this.held.size;
  }
  private end(key: string, at: number) {
    const h = this.held.get(key);
    if (!h) return;
    this.held.delete(key);
    this.notes.push({
      id: crypto.randomUUID(),
      pitch: h.pitch,
      velocity: h.velocity,
      start: this.plan.start + h.start,
      length: Math.min(32, Math.max(0.01, at - h.start)),
    });
  }
  push(event: MidiEvent, stamp: number) {
    if (this.finished || !Number.isFinite(stamp)) return;
    const at = ((stamp - this.clockStart) * this.plan.bpm) / 60000;
    if (at < 0) {
      if (event.kind === 'pedal') {
        if (event.down) this.pedal.add(event.channel);
        else this.pedal.delete(event.channel);
      } else if (event.kind === 'reset') this.pedal.delete(event.channel);
      return;
    }
    if (at < this.last || at > this.plan.beats) return;
    this.last = at;
    if (event.kind === 'pedal') {
      if (event.down) this.pedal.add(event.channel);
      else {
        this.pedal.delete(event.channel);
        for (const [key, h] of this.held)
          if (h.channel === event.channel && !h.down) this.end(key, at);
      }
      return;
    }
    if (event.kind === 'reset') {
      this.pedal.delete(event.channel);
      for (const [key, h] of this.held)
        if (h.channel === event.channel) this.end(key, at);
      return;
    }
    const key = event.channel + ':' + event.pitch;
    if (event.kind === 'off') {
      const h = this.held.get(key);
      if (h) {
        h.down = false;
        if (!this.pedal.has(event.channel)) this.end(key, at);
      }
    } else if (at <= this.plan.beats - 0.01) {
      this.end(key, at);
      if (this.count >= this.plan.capacity) {
        this.full = true;
        return;
      }
      this.held.set(key, { ...event, start: at, down: true });
    }
  }
  finish(stamp: number): Note[] {
    this.finished = true;
    const at = Number.isFinite(stamp)
      ? Math.max(
          this.last,
          Math.min(
            this.plan.beats,
            Math.max(0, ((stamp - this.clockStart) * this.plan.bpm) / 60000),
          ),
        )
      : this.last;
    for (const key of this.held.keys()) this.end(key, at);
    this.pedal.clear();
    return this.notes
      .map((n) => ({ ...n }))
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  }
}

export function quantizeMidi(
  notes: Note[],
  grid: number,
  plan: MidiPlan,
): Note[] {
  if (![0, 0.25, 0.5, 1].includes(grid))
    throw Error('Choose an available timing grid.');
  return notes.map((n) => {
    const start = grid
      ? Math.max(
          plan.start,
          Math.min(
            plan.start + plan.beats - n.length,
            Math.round(n.start / grid) * grid,
          ),
        )
      : n.start;
    return { ...n, start };
  });
}

export function keepMidi(
  data: Arrangement,
  original: Arrangement,
  target: MixerTrack,
  notes: Note[],
): Arrangement {
  const current = data.tracks.find((t) => t.id === target.id);
  const signature = (t: MixerTrack) =>
    JSON.stringify([
      t.notes,
      t.sound || 'keys',
      t.sample,
      t.offset,
      t.trimStart,
      t.trimEnd,
      t.splitFrom,
      t.clipName,
      t.clips,
      t.fileId,
      t.sequence,
      t.drumPattern,
      t.demo,
    ]);
  if (
    !current ||
    data.bpm !== original.bpm ||
    signature(current) !== signature(target)
  )
    throw Error(
      'This instrument changed while you were recording. Download the MIDI take or record again from the updated project.',
    );
  if (!notes.length)
    throw Error('Play at least one note before keeping the performance.');
  return applyNotePatch(data, original.bpm, target, {
    notes: [...(current.notes || []), ...notes],
  });
}
