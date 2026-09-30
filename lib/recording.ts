import { playMix, type Arrangement, type StudioOutput } from './audio';
import type { MicrophoneLease } from './room-audio';
import { encodeWave } from './audio-files';
import { recordingTiming, type RecordingTiming } from './recording-timing';
import { loopPlan } from './loop-recording';

export type CapturePhase =
  | 'idle'
  | 'opening'
  | 'ready'
  | 'preparing'
  | 'counting'
  | 'preroll'
  | 'recording'
  | 'draining'
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
  correctionMs?: number;
  loopPass?: number;
};
export type CaptureHooks = {
  state: (phase: CapturePhase) => void;
  level: (peak: number) => void;
  progress: (
    seconds: number,
    beatsLeft: number,
    pass?: number,
    total?: number,
  ) => void;
  take: (take: RecordedTake) => void;
  error: (message: string) => void;
};
export type CaptureDependencies = {
  media: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  context: () => AudioContext;
  acquire?: (deviceId?: string) => MicrophoneLease | Promise<MicrophoneLease>;
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
  private monitorGain: GainNode | null = null;
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
  private musicalFrame = 0;
  private correctionFrames = 0;
  private limitFrames = 0;
  private finishFrames: number | null = null;
  private cycleFrames = 0;
  private passCount = 1;
  private completedPasses = 0;
  private deliveredPasses = 0;
  private totalReceived = 0;
  private passQueue: Promise<void> = Promise.resolve();
  private loopError = '';
  private closingLoop = false;
  private interruptedLoop = false;
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
    if (this.monitorGain) {
      try {
        this.monitorGain.gain.cancelScheduledValues(0);
        this.monitorGain.gain.value = 0;
      } catch {}
      this.monitorGain.disconnect();
      this.monitorGain = null;
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
    this.finishFrames = null;
    this.cycleFrames = 0;
    this.passCount = 1;
    this.completedPasses = 0;
    this.deliveredPasses = 0;
    this.totalReceived = 0;
    this.passQueue = Promise.resolve();
    this.loopError = '';
    this.closingLoop = false;
    this.interruptedLoop = false;
    this.musicalFrame = 0;
    this.startTime = 0;
    this.correctionFrames = 0;
    this.limitFrames = 0;
    this.set('idle');
  }
  dispose() {
    this.cancel();
  }
  /** Headphone monitoring level for the input, 0 (silent) to 1. */
  setMonitor(level: number) {
    const target = Math.max(0, Math.min(1, Number(level) || 0));
    if (!this.monitorGain || !this.c) return;
    const now = this.c.currentTime;
    try {
      this.monitorGain.gain.cancelScheduledValues(now);
      this.monitorGain.gain.setTargetAtTime(target, now, 0.02);
    } catch {}
  }
  /** Round-trip latency estimate from the audio stack, in whole ms. */
  latencyEstimateMs(): number {
    const c = this.c as
      | (AudioContext & {
          outputLatency?: number;
        })
      | null;
    if (!c) return 0;
    const seconds =
      (Number(c.baseLatency) || 0) + (Number(c.outputLatency) || 0);
    return Math.max(0, Math.min(500, Math.round(seconds * 1000)));
  }
  get sampleRate() {
    return this.c?.sampleRate;
  }
  interrupt(message: string) {
    this.fail(message);
  }
  private fail(message: string) {
    if (this.cycleFrames && this.closingLoop) {
      this.loopError = message;
      return;
    }
    if (this.cycleFrames && this.phase !== 'preparing' && this.node && this.c) {
      this.loopError = message;
      if (this.interruptedLoop) return;
      this.interruptedLoop = true;
      const token = this.epoch,
        cutoff = Math.floor(this.c.currentTime * this.c.sampleRate);
      this.finishFrames = Math.min(
        this.finishFrames ?? this.limitFrames,
        Math.max(0, cutoff - this.musicalFrame - this.correctionFrames),
      );
      this.set('finishing');
      this.backing?.stop();
      this.input?.disconnect();
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (this.finishTimer) clearTimeout(this.finishTimer);
      // Leave the port alive for queued complete passes and the ordered stop ack.
      this.node.port.postMessage({ type: 'halt', end: cutoff });
      this.finishTimer = setTimeout(() => {
        if (this.valid(token))
          void this.finishLoop(
            token,
            this.loopError +
              ' The audio stop could not be confirmed; only complete passes received before recovery are kept.',
          );
      }, 1000);
      return;
    }
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
      const lease = await this.deps.acquire?.(deviceId);
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
      await c.audioWorklet.addModule('/recording-worklet.js?v=3');
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
      this.monitorGain = c.createGain();
      this.monitorGain.gain.value = 0;
      this.input.connect(this.monitorGain).connect(c.destination);
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
        if (!this.valid(token) || this.closingLoop) return;
        if (data.type === 'level') this.hooks.level(data.peak);
        if (data.type === 'error') this.fail(data.message);
        if (data.type === 'halted' && this.interruptedLoop) {
          void this.finishLoop(token);
          return;
        }
        if (
          data.type === 'samples' &&
          [
            'counting',
            'preroll',
            'recording',
            'draining',
            'finishing',
          ].includes(this.phase)
        ) {
          if (
            !(data.samples instanceof Float32Array) ||
            this.frameCount + data.samples.length >
              (this.cycleFrames || c.sampleRate * 120) ||
            this.totalReceived + data.samples.length > c.sampleRate * 240
          )
            return this.fail('The take exceeded its recording limit.');
          this.chunks.push(data.samples);
          this.frameCount += data.samples.length;
          this.totalReceived += data.samples.length;
        }
        if (data.type === 'pass' && this.cycleFrames) {
          if (
            data.index !== this.completedPasses + 1 ||
            data.index > this.passCount ||
            data.frames !== this.cycleFrames ||
            this.frameCount !== this.cycleFrames
          )
            return this.fail('A loop pass was incomplete.');
          const chunks = this.chunks,
            frames = this.frameCount,
            index = ++this.completedPasses;
          this.chunks = [];
          this.frameCount = 0;
          const withinStop = () =>
            this.finishFrames === null || index * frames <= this.finishFrames;
          this.passQueue = this.passQueue
            .then(async () => {
              if (!this.valid(token) || !withinStop()) return;
              const take = await this.encodeTake(chunks, frames, c.sampleRate);
              if (this.valid(token) && withinStop()) {
                this.deliveredPasses++;
                this.hooks.take({ ...take, loopPass: index });
              }
            })
            .catch((e) => {
              if (this.valid(token))
                this.loopError =
                  e instanceof Error
                    ? e.message
                    : 'A completed pass could not be prepared.';
            });
        }
        if (
          data.type === 'done' &&
          [
            'counting',
            'preroll',
            'recording',
            'draining',
            'finishing',
          ].includes(this.phase)
        )
          if (this.cycleFrames) {
            if (data.frames !== this.totalReceived)
              this.loopError = 'The final loop audio was incomplete.';
            void this.finishLoop(token);
          } else void this.complete(token, data.frames, c.sampleRate);
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
    exact?: { frames: number; sampleRate: number; passes?: number },
    timing: RecordingTiming = {},
  ) {
    if (this.phase !== 'ready' || !this.c || !this.node) return;
    const token = this.epoch,
      c = this.c;
    this.set('preparing');
    try {
      const clock = recordingTiming(
        arrangement.bpm,
        offset,
        bars,
        c.sampleRate,
        timing,
      );
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
      if (
        exact &&
        (exact.sampleRate !== c.sampleRate ||
          !Number.isSafeInteger(exact.frames) ||
          exact.frames < Math.ceil(c.sampleRate * 0.1) ||
          exact.frames / c.sampleRate >
            Math.min(maxSeconds, 300 - offset) + 1e-9)
      )
        throw new Error(
          'The microphone sample rate or recording limit does not match this punch. Your current vocal is unchanged.',
        );
      this.offset = offset;
      this.beat = clock.beat;
      this.correctionFrames = clock.correctionFrames;
      this.finishFrames = null;
      this.limitFrames =
        exact?.frames ??
        Math.floor(Math.min(maxSeconds, 300 - offset) * c.sampleRate);
      if (exact?.passes !== undefined) {
        const loop = loopPlan(
          offset,
          exact.frames / c.sampleRate,
          exact.passes,
          c.sampleRate,
        );
        this.cycleFrames = loop.frames;
        this.passCount = loop.passes;
        this.limitFrames = loop.frames * loop.passes;
      }
      const lead = clock.countFrames / c.sampleRate + 0.35;
      if (arrangement.tracks.length) {
        const backing = await playMix(structuredClone(arrangement), undefined, {
          audioContext: c,
          from: clock.from,
          allowPastEnd: true,
          startDelay: lead,
          signal: this.control.signal,
          output: this.deps.output,
          recordingLoop: this.cycleFrames
            ? {
                offset,
                frames: this.cycleFrames,
                passes: this.passCount,
                preRollFrames: clock.preRollFrames,
              }
            : undefined,
        });
        if (!this.valid(token)) {
          backing.stop();
          return;
        }
        this.backing = backing;
      }
      const backingFrame =
        this.backing?.audioStartFrame ??
        Math.ceil((c.currentTime + lead) * c.sampleRate);
      this.musicalFrame = backingFrame + clock.preRollFrames;
      this.startTime = this.musicalFrame / c.sampleRate;
      this.node!.port.postMessage({
        type: 'arm',
        start: this.musicalFrame + this.correctionFrames,
        limit: this.limitFrames,
        ...(this.cycleFrames ? { cycle: this.cycleFrames } : {}),
      });
      for (let n = 0; n < bars * 4; n++) {
        const when =
          (backingFrame - clock.countFrames) / c.sampleRate + n * this.beat;
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
        if (['counting', 'preroll', 'recording'].includes(this.phase)) {
          if (elapsed >= this.limitFrames / c.sampleRate) {
            this.endAt(this.musicalFrame + this.limitFrames);
          } else {
            const next =
              elapsed >= 0
                ? 'recording'
                : c.currentTime >= backingFrame / c.sampleRate
                  ? 'preroll'
                  : 'counting';
            if (this.phase !== next) this.set(next);
          }
        }
        this.hooks.progress(
          this.cycleFrames
            ? Math.max(0, elapsed) % (this.cycleFrames / c.sampleRate)
            : Math.max(0, Math.min(this.limitFrames / c.sampleRate, elapsed)),
          Math.max(
            0,
            Math.min(
              this.phase === 'counting' ? bars * 4 : Infinity,
              Math.ceil(
                ((this.phase === 'counting'
                  ? backingFrame / c.sampleRate
                  : this.startTime) -
                  c.currentTime) /
                  this.beat,
              ),
            ),
          ),
          this.cycleFrames
            ? Math.min(
                this.passCount,
                Math.floor(
                  (Math.max(0, elapsed) * c.sampleRate) / this.cycleFrames,
                ) + 1,
              )
            : 1,
          this.passCount,
        );
      };
      tick();
      if (this.valid(token)) this.timer = setInterval(tick, 70);
    } catch (e) {
      if (this.valid(token))
        this.fail(
          e instanceof Error ? e.message : 'Recording could not start.',
        );
    }
  }
  finish() {
    if (this.cycleFrames && this.phase === 'preparing') {
      this.cancel();
      return;
    }
    if (
      (!this.cycleFrames && this.phase !== 'recording') ||
      (this.cycleFrames &&
        !['counting', 'preroll', 'recording'].includes(this.phase)) ||
      !this.c
    )
      return;
    this.endAt(
      Math.min(
        this.musicalFrame + this.limitFrames,
        Math.max(
          this.musicalFrame,
          Math.ceil(this.c.currentTime * this.c.sampleRate),
        ),
      ),
    );
  }
  private async encodeTake(
    chunks: Float32Array[],
    frames: number,
    sampleRate: number,
  ): Promise<RecordedTake> {
    const samples = new Float32Array(frames);
    let at = 0,
      peak = 0;
    for (const chunk of chunks) {
      const kept = chunk.subarray(0, Math.max(0, frames - at));
      samples.set(kept, at);
      at += kept.length;
    }
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
    return {
      blob: encoded.blob,
      seconds: frames / sampleRate,
      offset: this.offset,
      peak: encoded.peak,
      sampleRate,
      depth,
      correctionMs: (this.correctionFrames * 1000) / sampleRate,
    };
  }
  private async finishLoop(token: number, message = '') {
    if (!this.valid(token) || this.closingLoop) return;
    this.closingLoop = true;
    this.set('finishing');
    this.release();
    this.chunks = [];
    this.frameCount = 0;
    await this.passQueue;
    if (!this.valid(token)) return;
    this.set('review');
    const issue = message || this.loopError;
    if (issue || this.deliveredPasses < this.passCount)
      this.hooks.error(
        (issue ? issue + ' ' : '') +
          (this.deliveredPasses
            ? `${this.deliveredPasses} completed ${this.deliveredPasses === 1 ? 'pass is' : 'passes are'} kept. The unfinished pass was discarded.`
            : 'No complete loop pass was recorded. Try again.'),
      );
  }
  private endAt(frame: number) {
    if (!this.c || !['counting', 'preroll', 'recording'].includes(this.phase))
      return;
    const token = this.epoch;
    this.finishFrames = Math.max(0, frame - this.musicalFrame);
    this.set(this.correctionFrames ? 'draining' : 'finishing');
    if (!this.valid(token)) return;
    this.backing?.stop();
    this.node?.port.postMessage({
      type: 'finish',
      end: frame + this.correctionFrames,
    });
    this.finishTimer = setTimeout(() => {
      if (this.valid(token))
        this.fail(
          'The recording did not finish. Please reconnect the microphone and retry.',
        );
    }, 5000);
  }
  private async complete(token: number, frames: number, sampleRate: number) {
    if (!this.valid(token)) return;
    this.set('finishing');
    this.release();
    try {
      if (frames !== this.frameCount)
        throw new Error('The take was incomplete. Please record it again.');
      const keptFrames = Math.min(
        frames,
        this.finishFrames ?? this.limitFrames,
      );
      if (keptFrames < sampleRate * 0.1)
        throw new Error(
          'The take was too short or incomplete. Record at least a tenth of a second.',
        );
      const samples = new Float32Array(keptFrames);
      let at = 0;
      for (const chunk of this.chunks) {
        const kept = chunk.subarray(0, Math.max(0, keptFrames - at));
        samples.set(kept, at);
        at += kept.length;
      }
      this.chunks = [];
      let peak = 0;
      for (const value of samples) peak = Math.max(peak, Math.abs(value));
      const depth = peak > 1 ? 32 : 24;
      const encoded = await encodeWave(
        {
          length: keptFrames,
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
        seconds: keptFrames / sampleRate,
        offset: this.offset,
        peak: encoded.peak,
        sampleRate,
        depth,
        correctionMs: (this.correctionFrames * 1000) / sampleRate,
      });
    } catch (e) {
      if (this.valid(token))
        this.fail(
          e instanceof Error ? e.message : 'The take could not be prepared.',
        );
    }
  }
}
