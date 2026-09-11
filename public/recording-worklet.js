// Captures mono PCM on the audio clock. The output stays silent: no microphone monitoring.
class SessionCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.frames = 0;
    this.used = 0;
    this.chunk = new Float32Array(4096);
    this.meterFrames = 0;
    this.peak = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'arm') {
        if (
          !Number.isSafeInteger(data.start) ||
          data.start < currentFrame ||
          !Number.isSafeInteger(data.limit) ||
          data.limit < 1 ||
          data.limit > sampleRate * (data.cycle ? 240 : 120) ||
          (data.cycle !== undefined &&
            (!Number.isSafeInteger(data.cycle) ||
              data.cycle < Math.ceil(sampleRate * 0.1) ||
              data.cycle > sampleRate * 120 ||
              data.limit % data.cycle !== 0 ||
              data.limit / data.cycle < 2 ||
              data.limit / data.cycle > 8))
        ) {
          this.port.postMessage({
            type: 'error',
            message: 'Recording timing could not start. Try again.',
          });
          return;
        }
        this.start = data.start;
        this.limit = data.limit;
        this.cycle = data.cycle || 0;
        this.active = true;
        this.frames = 0;
        this.used = 0;
      } else if (data.type === 'finish') {
        if (data.end === undefined) this.finish();
        else if (!Number.isSafeInteger(data.end) || data.end < this.start) {
          this.port.postMessage({
            type: 'error',
            message: 'Recording end timing was invalid. Try again.',
          });
        } else if (this.active) {
          this.limit = Math.min(this.limit, data.end - this.start);
          // A delayed control message may arrive after this boundary. The
          // receiver trims already-delivered PCM to its requested frame count.
          if (this.frames >= this.limit) this.finish();
        }
      } else if (data.type === 'halt') {
        // Acknowledge after all earlier samples and pass messages on this port.
        if (Number.isSafeInteger(data.end))
          this.limit = Math.min(this.limit, Math.max(0, data.end - this.start));
        this.finish();
        this.port.postMessage({ type: 'halted', frames: this.frames });
      } else if (data.type === 'cancel') {
        this.active = false;
        this.used = 0;
        this.frames = 0;
      }
    };
  }
  flush() {
    if (!this.used) return;
    const samples = this.chunk.slice(0, this.used);
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
    this.used = 0;
  }
  finish() {
    if (!this.active) return;
    this.active = false;
    this.flush();
    this.port.postMessage({ type: 'done', frames: this.frames });
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0] || [];
    const length = channels[0]?.length || outputs[0]?.[0]?.length || 128;
    for (let i = 0; i < length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] ?? 0;
      value /= channels.length || 1;
      if (!Number.isFinite(value)) {
        this.active = false;
        this.port.postMessage({
          type: 'error',
          message:
            'The microphone returned invalid audio. Reconnect it and try again.',
        });
        return false;
      }
      this.peak = Math.max(this.peak, Math.abs(value));
      if (this.active && currentFrame + i >= this.start) {
        if (this.frames >= this.limit) {
          this.finish();
          continue;
        }
        this.chunk[this.used++] = value;
        this.frames++;
        if (this.used === this.chunk.length) this.flush();
        if (this.cycle && this.frames % this.cycle === 0) {
          this.flush();
          this.port.postMessage({
            type: 'pass',
            index: this.frames / this.cycle,
            frames: this.cycle,
          });
        }
        if (this.frames === this.limit) this.finish();
      }
    }
    this.meterFrames += length;
    if (this.meterFrames >= sampleRate / 15) {
      this.port.postMessage({ type: 'level', peak: this.peak });
      this.meterFrames = 0;
      this.peak = 0;
    }
    return true;
  }
}
registerProcessor('session-capture', SessionCapture);
