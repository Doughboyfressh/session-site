import {
  channel,
  playMix,
  sampleBuffer,
  type Arrangement,
  type MixerTrack,
  type Note,
  type StudioOutput,
} from './audio';
import { playSample } from './sample-instrument';
import {
  midiEvent,
  MidiPerformance,
  type MidiEvent,
  type MidiPlan,
} from './midi-notes';

export type MidiPhase =
  | 'idle'
  | 'opening'
  | 'ready'
  | 'preparing'
  | 'counting'
  | 'recording'
  | 'review'
  | 'error';
export type MidiHooks = {
  state: (phase: MidiPhase) => void;
  inputs: (ports: { id: string; name: string }[], selected: string) => void;
  progress: (beats: number, count: number) => void;
  activity: (pitch: number, voices: number) => void;
  take: (notes: Note[]) => void;
  error: (message: string) => void;
};
export type MidiDependencies = {
  access: () => Promise<MIDIAccess>;
  context: () => AudioContext;
  now: () => number;
  output?: StudioOutput;
};
type Voice = { channel: number; down: boolean; stop: () => void };

export class MidiRecorder {
  private epoch = 0;
  private portEpoch = 0;
  private phase: MidiPhase = 'idle';
  private c: AudioContext | null = null;
  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private inputId = '';
  private wantedInput = '';
  private control = new AbortController();
  private backing: Awaited<ReturnType<typeof playMix>> | null = null;
  private monitor: ReturnType<typeof channel> | null = null;
  private master: GainNode | null = null;
  private releaseOutput: (() => void) | undefined;
  private voices = new Map<string, Voice>();
  private sampleAudio: AudioBuffer | null = null;
  private releasing = new Set<() => void>();
  private pedal = new Set<number>();
  private clicks = new Set<OscillatorNode>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private performance: MidiPerformance | null = null;
  private startAt = 0;
  private endAt = 0;
  private deps: MidiDependencies;
  constructor(
    private hooks: MidiHooks,
    private target: MixerTrack,
    deps: Partial<MidiDependencies> = {},
  ) {
    this.deps = {
      access: () => {
        if (typeof navigator.requestMIDIAccess !== 'function')
          throw Error(
            'MIDI keyboards are not supported in this browser. You can still add and edit notes in the piano roll.',
          );
        return navigator.requestMIDIAccess({ sysex: false, software: false });
      },
      context: () => new AudioContext({ latencyHint: 'interactive' }),
      now: () => performance.now(),
      ...deps,
    };
  }
  private set(p: MidiPhase) {
    this.phase = p;
    this.hooks.state(p);
  }
  private current(epoch: number) {
    return epoch === this.epoch && !this.control.signal.aborted;
  }
  private clearVoices() {
    for (const v of this.voices.values()) v.stop();
    this.voices.clear();
    for (const stop of this.releasing) stop();
    this.releasing.clear();
    this.pedal.clear();
    this.hooks.activity(-1, 0);
  }
  private release() {
    this.epoch++;
    this.portEpoch++;
    this.control.abort();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.backing?.stop();
    this.backing = null;
    this.clearVoices();
    this.sampleAudio = null;
    for (const o of this.clicks) {
      try {
        o.stop();
      } catch {}
      o.disconnect();
    }
    this.clicks.clear();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    if (this.input) {
      this.input.onmidimessage = null;
      void this.input.close().catch(() => {});
    }
    this.input = null;
    this.inputId = '';
    this.wantedInput = '';
    this.releaseOutput?.();
    this.releaseOutput = undefined;
    this.monitor?.dispose();
    this.monitor = null;
    this.master?.disconnect();
    this.master = null;
    if (this.c) {
      this.c.onstatechange = null;
      void this.c.close().catch(() => {});
    }
    this.c = null;
  }
  dispose() {
    this.release();
    this.performance = null;
  }
  private ports() {
    return [...(this.access?.inputs.values() || [])]
      .filter((p) => p.state === 'connected')
      .map((p) => ({
        id: p.id,
        name: p.name || p.manufacturer || 'MIDI keyboard',
      }));
  }
  async connect() {
    this.release();
    this.performance = null;
    this.control = new AbortController();
    const epoch = this.epoch;
    this.set('opening');
    try {
      const c = this.deps.context();
      this.c = c;
      await c.resume();
      if (!this.current(epoch)) return;
      if (this.target.sample) {
        const sample = await sampleBuffer(this.target, {
          sampleRate: c.sampleRate,
          signal: this.control.signal,
          revalidate: true,
        });
        if (!this.current(epoch)) return;
        this.sampleAudio = sample;
      }
      const access = await this.deps.access();
      if (!this.current(epoch)) return;
      this.access = access;
      const master = c.createGain();
      master.connect(c.destination);
      this.master = master;
      this.monitor = channel(
        c,
        { ...this.target, muted: false, solo: false },
        master,
      );
      this.releaseOutput = this.deps.output?.(master);
      c.onstatechange = () => {
        if (this.current(epoch) && c.state !== 'running')
          this.interrupt(
            'Audio was interrupted. Reconnect the keyboard before recording again.',
          );
      };
      access.onstatechange = () => {
        if (!this.current(epoch)) return;
        if (this.input && this.input.state !== 'connected') {
          this.interrupt(
            'The selected MIDI keyboard disconnected. Notes received so far are available for review.',
          );
          return;
        }
        this.hooks.inputs(this.ports(), this.inputId);
      };
      this.set('ready');
      this.hooks.inputs(this.ports(), '');
      const first = this.ports()[0];
      if (first) await this.select(first.id);
    } catch (e) {
      if (!this.current(epoch)) return;
      this.release();
      this.set('error');
      this.hooks.error(
        e instanceof Error &&
          ['NotAllowedError', 'SecurityError'].includes(e.name)
          ? 'MIDI access was declined or blocked by this browser. Allow MIDI access when you are ready, or use the piano roll.'
          : e instanceof Error
            ? e.message
            : 'The MIDI keyboard could not connect.',
      );
    }
  }
  async select(id: string) {
    if (this.phase !== 'ready' || !this.access) return;
    const epoch = this.epoch,
      portEpoch = ++this.portEpoch;
    this.wantedInput = id;
    const previous = this.input;
    this.input = null;
    this.inputId = '';
    this.clearVoices();
    if (previous) {
      previous.onmidimessage = null;
      void previous.close().catch(() => {});
    }
    const port = this.access.inputs.get(id);
    this.hooks.inputs(this.ports(), '');
    if (!port || port.state !== 'connected') return;
    try {
      await port.open();
      if (!this.current(epoch) || portEpoch !== this.portEpoch) {
        if (this.access?.inputs.get(this.wantedInput) !== port)
          void port.close().catch(() => {});
        return;
      }
      if (port.state !== 'connected')
        throw Error('The MIDI keyboard disconnected before it opened.');
      this.input = port;
      this.inputId = id;
      port.onmidimessage = (message) => {
        if (
          !this.current(epoch) ||
          portEpoch !== this.portEpoch ||
          this.input !== port ||
          !['ready', 'preparing', 'counting', 'recording'].includes(this.phase)
        )
          return;
        const event = message.data && midiEvent(message.data);
        if (!event || !this.c) return;
        const now = this.deps.now(),
          stamp =
            Number.isFinite(message.timeStamp) && message.timeStamp >= 0
              ? Math.min(message.timeStamp, now)
              : now;
        this.preview(event);
        if (this.performance) {
          this.performance.push(event, stamp);
          if (this.performance.full)
            this.finish(
              'The instrument note limit was reached. Review the notes already recorded.',
            );
        }
      };
      this.hooks.inputs(this.ports(), id);
    } catch (e) {
      if (this.current(epoch) && portEpoch === this.portEpoch)
        this.hooks.error(
          e instanceof Error ? e.message : 'Choose another MIDI input.',
        );
    }
  }
  private preview(event: MidiEvent) {
    if (!this.c || !this.monitor) return;
    const stop = (key: string) => {
      const v = this.voices.get(key);
      v?.stop();
      this.voices.delete(key);
    };
    if (event.kind === 'pedal') {
      if (event.down) this.pedal.add(event.channel);
      else {
        this.pedal.delete(event.channel);
        for (const [key, v] of this.voices)
          if (v.channel === event.channel && !v.down) stop(key);
      }
    } else if (event.kind === 'reset') {
      this.pedal.delete(event.channel);
      for (const [key, v] of this.voices)
        if (v.channel === event.channel) stop(key);
    } else {
      const key = event.channel + ':' + event.pitch;
      if (event.kind === 'off') {
        const v = this.voices.get(key);
        if (v) {
          v.down = false;
          if (!this.pedal.has(event.channel)) stop(key);
        }
      } else {
        stop(key);
        if (this.voices.size >= 32) stop(this.voices.keys().next().value!);
        if (this.target.sample && this.sampleAudio) {
          const c = this.c;
          const voice = playSample(
            c,
            this.monitor.input,
            this.sampleAudio,
            this.target.sample,
            event.pitch,
            c.currentTime,
            120,
            event.velocity,
            () => {
              if (this.voices.get(key)?.stop === release)
                this.voices.delete(key);
              this.releasing.delete(voice.stop);
            },
          );
          const release = () => {
            voice.release();
            this.releasing.add(voice.stop);
            if (this.releasing.size > 64)
              this.releasing.values().next().value!();
          };
          this.voices.set(key, {
            channel: event.channel,
            down: true,
            stop: release,
          });
          this.hooks.activity(event.pitch, this.voices.size);
          return;
        }
        const c = this.c,
          o = c.createOscillator(),
          g = c.createGain(),
          f = c.createBiquadFilter();
        o.type =
          this.target.sound === 'bass'
            ? 'sawtooth'
            : this.target.sound === 'pad'
              ? 'triangle'
              : 'sine';
        o.frequency.value = 440 * 2 ** ((event.pitch - 69) / 12);
        f.type = 'lowpass';
        f.frequency.value =
          this.target.sound === 'bass'
            ? 650
            : this.target.sound === 'pad'
              ? 1800
              : 8000;
        g.gain.setValueAtTime(0, c.currentTime);
        g.gain.linearRampToValueAtTime(
          event.velocity * 0.16,
          c.currentTime + (this.target.sound === 'pad' ? 0.08 : 0.008),
        );
        o.connect(f).connect(g).connect(this.monitor.input);
        let ended = false;
        const dispose = () => {
          o.onended = null;
          try {
            o.stop();
          } catch {}
          o.disconnect();
          f.disconnect();
          g.disconnect();
          this.releasing.delete(dispose);
        };
        o.onended = dispose;
        const release = () => {
          if (ended) return;
          ended = true;
          g.gain.cancelAndHoldAtTime(c.currentTime);
          g.gain.setTargetAtTime(0, c.currentTime, 0.015);
          o.stop(c.currentTime + 0.08);
          this.releasing.add(dispose);
          if (this.releasing.size > 64) this.releasing.values().next().value!();
        };
        this.voices.set(key, {
          channel: event.channel,
          down: true,
          stop: release,
        });
        o.start();
        this.hooks.activity(event.pitch, this.voices.size);
      }
    }
  }
  async start(data: Arrangement, plan: MidiPlan, countBars: number) {
    if (this.phase !== 'ready' || !this.c || !this.input)
      throw Error('Connect and choose a MIDI keyboard first.');
    if (![0, 1, 2].includes(countBars))
      throw Error('Choose an available count-in.');
    const epoch = this.epoch,
      c = this.c;
    const heldPedals = [...this.pedal];
    this.clearVoices();
    heldPedals.forEach((channel) => this.pedal.add(channel));
    this.set('preparing');
    try {
      if (this.target.sample) {
        const sample = await sampleBuffer(this.target, {
          sampleRate: c.sampleRate,
          signal: this.control.signal,
          revalidate: true,
        });
        if (!this.current(epoch)) return;
        this.sampleAudio = sample;
      }
      const backing = await playMix(structuredClone(data), undefined, {
        audioContext: c,
        from: plan.timeline,
        allowPastEnd: true,
        startDelay: (countBars * 4 * 60) / plan.bpm + 0.35,
        signal: this.control.signal,
        output: this.deps.output,
      });
      if (!this.current(epoch)) {
        backing.stop();
        return;
      }
      this.backing = backing;
      this.startAt = backing.audioStartTime;
      this.endAt = this.startAt + (plan.beats * 60) / plan.bpm;
      const clockStart =
        this.deps.now() + (this.startAt - c.currentTime) * 1000;
      this.performance = new MidiPerformance(plan, clockStart);
      for (const channel of this.pedal)
        this.performance.push(
          { kind: 'pedal', channel, down: true },
          clockStart - 1,
        );
      for (let beat = 0; beat < countBars * 4; beat++) {
        const at = this.startAt - ((countBars * 4 - beat) * 60) / plan.bpm,
          o = c.createOscillator(),
          g = c.createGain();
        o.frequency.value = beat % 4 ? 800 : 1200;
        g.gain.setValueAtTime(0.04, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
        o.connect(g).connect(c.destination);
        this.clicks.add(o);
        o.onended = () => {
          this.clicks.delete(o);
          o.disconnect();
          g.disconnect();
        };
        o.start(at);
        o.stop(at + 0.05);
      }
      this.set('counting');
      const tick = () => {
        if (!this.current(epoch)) return;
        if (c.currentTime >= this.endAt) {
          this.finish();
          return;
        }
        if (c.currentTime >= this.startAt && this.phase === 'counting')
          this.set('recording');
        this.hooks.progress(
          ((c.currentTime - this.startAt) * plan.bpm) / 60,
          this.performance!.count,
        );
      };
      tick();
      this.timer = setInterval(tick, 50);
    } catch (e) {
      if (this.current(epoch))
        this.interrupt(
          e instanceof Error ? e.message : 'MIDI recording could not start.',
        );
    }
  }
  finish(message = '') {
    if (!this.performance || !this.c) {
      this.interrupt(
        message || 'Recording stopped before any notes were captured.',
      );
      return;
    }
    const clockEnd =
      this.performance.clockStart +
      (Math.min(this.c.currentTime, this.endAt) - this.startAt) * 1000;
    const notes = this.performance.finish(clockEnd);
    this.release();
    this.performance = null;
    this.hooks.take(notes);
    this.set('review');
    if (message) this.hooks.error(message);
  }
  interrupt(message: string) {
    if (this.phase === 'review') {
      this.hooks.error(message);
      return;
    }
    if (this.performance && this.c) this.finish(message);
    else {
      this.release();
      this.set('error');
      this.hooks.error(message);
    }
  }
}
