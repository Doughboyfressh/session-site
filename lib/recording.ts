import { playMix, type Arrangement, type StudioOutput } from './audio';
import type { MicrophoneLease } from './room-audio';
import { encodeWave } from './audio-files';

export type CapturePhase =
  | 'idle'
  | 'opening'
  | 'ready'
  | 'preparing'
  | 'counting'
  | 'recording'
  | 'finishing'
  | 'review'
  | 'error';
export type RecordedTake = {
  blob: Blob;
  seconds: number;
  offset: number;
  peak: number;
  sampleRate: number;
  depth: 24 | 32;
  kind?: 'comp';
};
export type CaptureHooks = {
  state: (phase: CapturePhase) => void;
  level: (peak: number) => void;
  progress: (seconds: number, beatsLeft: number) => void;
  take: (take: RecordedTake) => void;
  error: (message: string) => void;
};
export type CaptureDependencies = {
  media: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  context: () => AudioContext;
  acquire?: () => MicrophoneLease;
  output?: StudioOutput;
};
export class TakeCapture {
  private epoch = 0;
  private phase: CapturePhase = 'idle';
  private c: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private lease: MicrophoneLease | null = null;
  private releaseListener: (() => void) | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private backing: Awaited<ReturnType<typeof playMix>> | null = null;
  private clicks = new Set<OscillatorNode>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private finishTimer: ReturnType<typeof setTimeout> | null = null;
  private control = new AbortController();
  private chunks: Float32Array[] = [];
  private frameCount = 0;
  private offset = 0;
  private startTime = 0;
  private beat = 1;
  constructor(
    private hooks: CaptureHooks,
    private deps: CaptureDependencies = {
      media: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
      context: () =>
        new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }),
    },
  ) {}
  private set(phase: CapturePhase) {
    this.phase = phase;
    this.hooks.state(phase);
  }
  private valid(token: number) {
    return token === this.epoch && !this.control.signal.aborted;
  }
  private release() {
    this.releaseListener?.();
    this.releaseListener = null;
    this.lease?.release();
    this.lease = null;
    this.backing?.stop();
    this.backing = null;
    for (const o of this.clicks) {
      try {
        o.stop();
      } catch {}
      o.disconnect();
    }
    this.clicks.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = null;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.port.close();
      this.node.disconnect();
      this.node = null;
    }
    this.input?.disconnect();
    this.input = null;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.onmute = null;
      t.stop();
    });
    this.stream = null;
    if (this.c) {
      this.c.onstatechange = null;
      void this.c.close().catch(() => {});
      this.c = null;
    }
    this.hooks.level(0);
  }
  cancel() {
    this.epoch++;
    this.control.abort();
    this.release();
    this.chunks = [];
    this.frameCount = 0;
    this.set('idle');
  }
  dispose() {
    this.cancel();
  }
  private fail(message: string) {
    this.cancel();
    this.set('error');
    this.hooks.error(message);
  }
  async connect(deviceId = '') {
    this.cancel();
    this.control = new AbortController();
    const token = this.epoch;
    this.set('opening');
    try {
      const c = this.deps.context();
      this.c = c;
      if (!c.audioWorklet || ![44100, 48000].includes(c.sampleRate))
        throw new Error(
          'Use a browser with audio recording support at 44.1 or 48 kHz. You can also import an existing recording.',
        );
      await c.resume();
      if (!this.valid(token)) return;
      const lease = this.deps.acquire?.();
      const stream =
        lease?.stream ||
        (await this.deps.media({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            channelCount: { ideal: 1 },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        }));
      if (!this.valid(token)) {
        lease?.release();
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      if (lease) {
        this.lease = lease;
        const ended = () => {
          if (this.valid(token))
            this.fail(
              'The room microphone disconnected. Rejoin the call before recording another take.',
            );
        };
        lease.signal.addEventListener('abort', ended, { once: true });
        this.releaseListener = () =>
          lease.signal.removeEventListener('abort', ended);
        if (lease.signal.aborted) {
          ended();
          return;
        }
      }
      await c.audioWorklet.addModule('/recording-worklet.js?v=1');
      if (!this.valid(token)) return;
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState !== 'live' || track.muted)
        throw new Error(
          'This microphone is unavailable or used by another tab. Reconnect it and try again.',
        );
      track.onended = () => {
        if (this.valid(token))
          this.fail(
            'The microphone disconnected. This take was stopped; reconnect before trying again.',
          );
      };
      track.onmute = () => {
        if (this.valid(token))
          this.fail(
            'The browser interrupted the microphone. Keep this studio open and check other calls or tabs before retrying.',
          );
      };
      this.input = c.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(c, 'session-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.node.onprocessorerror = () => {
        if (this.valid(token))
          this.fail(
            'Recording stopped because the audio processor failed. Please try again.',
          );
      };
      this.node.port.onmessage = ({ data }) => {
        if (!this.valid(token)) return;
        if (data.type === 'level') this.hooks.level(data.peak);
        if (data.type === 'error') this.fail(data.message);
        if (
          data.type === 'samples' &&
          ['counting', 'recording', 'finishing'].includes(this.phase)
        ) {
          if (
            !(data.samples instanceof Float32Array) ||
            this.frameCount + data.samples.length > c.sampleRate * 120
          )
            return this.fail('The take exceeded its recording limit.');
          this.chunks.push(data.samples);
          this.frameCount += data.samples.length;
        }
        if (
          data.type === 'done' &&
          ['counting', 'recording', 'finishing'].includes(this.phase)
        )
          void this.complete(token, data.frames, c.sampleRate);
      };
      this.input.connect(this.node).connect(c.destination);
      c.onstatechange = () => {
        if (this.valid(token) && c.state !== 'running')
          this.fail(
            'Audio was interrupted. Keep the studio in the foreground and try again.',
          );
      };
      this.set('ready');
    } catch (e) {
      if (this.valid(token))
        this.fail(
          e instanceof Error && e.name === 'NotAllowedError'
            ? 'Microphone access was declined. Allow it in your browser when you are ready.'
            : e instanceof Error
              ? e.message
              : 'The microphone could not start.',
        );
    }
  }
  async start(
    arrangement: Arrangement,
    offset: number,
    bars: number,
    maxSeconds = 120,
  ) {
    if (this.phase !== 'ready' || !this.c || !this.node) return;
    const token = this.epoch,
      c = this.c;
    this.set('preparing');
    try {
      if (
        ![0, 1, 2].includes(bars) ||
        !Number.isFinite(offset) ||
        offset < 0 ||
        offset >= 300 ||
        arrangement.bpm < 40 ||
        arrangement.bpm > 240 ||
        !Number.isFinite(maxSeconds) ||
        maxSeconds < 0.1 ||
        maxSeconds > 120
      )
        throw new Error('Choose a valid recording position and tempo.');
      this.offset = offset;
      this.beat = 60 / arrangement.bpm;
      const lead = bars * 4 * this.beat + 0.35;
      if (arrangement.tracks.length) {
        const backing = await playMix(structuredClone(arrangement), undefined, {
          audioContext: c,
          from: offset,
          allowPastEnd: true,
          startDelay: lead,
          signal: this.control.signal,
          output: this.deps.output,
        });
        if (!this.valid(token)) {
          backing.stop();
          return;
        }
        this.backing = backing;
      }
      this.startTime = this.backing?.audioStartTime ?? c.currentTime + lead;
      const firstFrame =
        this.backing?.audioStartFrame ??
        Math.ceil(this.startTime * c.sampleRate);
      this.startTime = firstFrame / c.sampleRate;
      this.node!.port.postMessage({
        type: 'arm',
        start: firstFrame,
        limit: Math.floor(Math.min(maxSeconds, 300 - offset) * c.sampleRate),
      });
      for (let n = 0; n < bars * 4; n++) {
        const when = this.startTime - (bars * 4 - n) * this.beat;
        const o = c.createOscillator(),
          g = c.createGain();
        o.frequency.value = n % 4 === 0 ? 1200 : 800;
        g.gain.setValueAtTime(0.06, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
        o.connect(g).connect(c.destination);
        this.clicks.add(o);
        o.onended = () => {
          this.clicks.delete(o);
          o.disconnect();
          g.disconnect();
        };
        o.start(when);
        o.stop(when + 0.05);
      }
      this.set('counting');
      const tick = () => {
        if (!this.valid(token)) return;
        const elapsed = c.currentTime - this.startTime;
        if (elapsed >= 0 && this.phase === 'counting') this.set('recording');
        this.hooks.progress(
          Math.max(0, elapsed),
          Math.max(0, Math.min(bars * 4, Math.ceil(-elapsed / this.beat))),
        );
      };
      tick();
      this.timer = setInterval(tick, 70);
    } catch (e) {
      if (this.valid(token))
        this.fail(
          e instanceof Error ? e.message : 'Recording could not start.',
        );
    }
  }
  finish() {
    if (this.phase !== 'recording') return;
    this.set('finishing');
    this.backing?.stop();
    this.node?.port.postMessage({ type: 'finish' });
    this.finishTimer = setTimeout(
      () =>
        this.fail(
          'The recording did not finish. Please reconnect the microphone and retry.',
        ),
      5000,
    );
  }
  private async complete(token: number, frames: number, sampleRate: number) {
    if (!this.valid(token)) return;
    this.set('finishing');
    this.release();
    try {
      if (frames !== this.frameCount || frames < sampleRate * 0.1)
        throw new Error(
          'The take was too short or incomplete. Record at least a tenth of a second.',
        );
      const samples = new Float32Array(frames);
      let at = 0;
      for (const chunk of this.chunks) {
        samples.set(chunk, at);
        at += chunk.length;
      }
      this.chunks = [];
      let peak = 0;
      for (const value of samples) peak = Math.max(peak, Math.abs(value));
      const depth = peak > 1 ? 32 : 24;
      const encoded = await encodeWave(
        {
          length: frames,
          sampleRate,
          numberOfChannels: 1,
          getChannelData: () => samples,
        },
        depth,
        { channels: 1, dither: true, signal: this.control.signal },
      );
      if (!this.valid(token)) return;
      this.set('review');
      this.hooks.take({
        blob: encoded.blob,
        seconds: frames / sampleRate,
        offset: this.offset,
        peak: encoded.peak,
        sampleRate,
        depth,
      });
    } catch (e) {
      if (this.valid(token))
        this.fail(
          e instanceof Error ? e.message : 'The take could not be prepared.',
        );
    }
  }
}
