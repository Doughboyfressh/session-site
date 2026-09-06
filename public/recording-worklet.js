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
          data.limit > sampleRate * 120
        ) {
          this.port.postMessage({
            type: 'error',
            message: 'Recording timing could not start. Try again.',
          });
          return;
        }
        this.start = data.start;
        this.limit = data.limit;
        this.active = true;
        this.frames = 0;
        this.used = 0;
      } else if (data.type === 'finish') this.finish();
      else if (data.type === 'cancel') {
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
        this.chunk[this.used++] = value;
        this.frames++;
        if (this.used === this.chunk.length) this.flush();
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
