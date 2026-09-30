import type { StudioOutput } from './audio';

export type MicrophoneLease = {
  stream: MediaStream;
  signal: AbortSignal;
  release: () => void;
};

// Only explicitly supplied studio outputs enter this bus. Neither the room
// microphone nor received media/HTML audio is connected here.
export class StudioBroadcast {
  private c: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private epoch = 0;
  private outputs = new Map<AudioNode, (() => void) | null>();
  constructor(
    private createContext = () =>
      new AudioContext({ latencyHint: 'interactive' }),
    private interrupted: () => void = () => {},
  ) {}

  output: StudioOutput = (node) => {
    this.outputs.set(node, null);
    this.connect(node);
    return () => {
      this.outputs.get(node)?.();
      this.outputs.delete(node);
    };
  };

  private connect(node: AudioNode) {
    if (!this.c || !this.destination || this.outputs.get(node)) return;
    // A stream bridge also accepts backing playback from a recorder-owned
    // context. AudioNodes cannot be connected across different contexts.
    const tap = (node.context as AudioContext).createMediaStreamDestination();
    const source = this.c.createMediaStreamSource(tap.stream);
    node.connect(tap);
    source.connect(this.destination);
    this.outputs.set(node, () => {
      try {
        node.disconnect(tap);
      } catch {}
      source.disconnect();
      tap.stream.getTracks().forEach((track) => track.stop());
    });
  }

  async enable() {
    this.disable();
    const token = this.epoch;
    const c = this.createContext();
    this.c = c;
    try {
      await c.resume();
      if (token !== this.epoch)
        throw new DOMException('Sharing cancelled.', 'AbortError');
      const destination = c.createMediaStreamDestination();
      this.destination = destination;
      for (const node of this.outputs.keys()) this.connect(node);
      c.onstatechange = () => {
        if (token === this.epoch && c.state !== 'running') {
          this.disable();
          this.interrupted();
        }
      };
      return destination.stream;
    } catch (error) {
      if (token === this.epoch) this.disable();
      throw error;
    }
  }

  disable() {
    this.epoch++;
    for (const [node, release] of this.outputs) {
      release?.();
      this.outputs.set(node, null);
    }
    this.destination?.stream.getTracks().forEach((track) => track.stop());
    this.destination = null;
    if (this.c) {
      this.c.onstatechange = null;
      void this.c.close().catch(() => {});
    }
    this.c = null;
  }

  dispose() {
    this.disable();
    this.outputs.clear();
  }
}

// The recorder owns only a clone, so cancelling a take cannot stop the call.
// Call mute and recording are independent; the UI says this explicitly.
export class RoomMicrophones {
  private source: MediaStream | null = null;
  private leases = new Set<() => void>();
  private endListeners = new Set<() => void>();

  set(stream: MediaStream | null) {
    this.end();
    this.source = stream;
  }

  onEnd(callback: () => void) {
    this.endListeners.add(callback);
    return () => this.endListeners.delete(callback);
  }

  acquire = (): MicrophoneLease => {
    const original = this.source?.getAudioTracks()[0];
    if (!original || original.readyState !== 'live' || original.muted)
      throw new Error('Join the room call before enabling this recorder.');
    const track = original.clone();
    track.enabled = true;
    const controller = new AbortController();
    const release = () => {
      original.removeEventListener('ended', ended);
      original.removeEventListener('mute', ended);
      this.leases.delete(ended);
      track.stop();
    };
    const ended = () => {
      controller.abort();
      release();
    };
    original.addEventListener('ended', ended, { once: true });
    original.addEventListener('mute', ended, { once: true });
    this.leases.add(ended);
    return {
      stream: new MediaStream([track]),
      signal: controller.signal,
      release,
    };
  };

  end() {
    this.source = null;
    for (const release of [...this.leases]) release();
    this.leases.clear();
    for (const listener of [...this.endListeners]) listener();
  }

  /**
   * Studio-grade lease: opens a second getUserMedia with call processing
   * (echo cancellation, noise suppression, AGC) disabled so takes recorded
   * inside a room keep full fidelity. Falls back to the processed call mic
   * when the raw path is unavailable. The lease dies with the call.
   */
  acquireStudio = async (
    deviceId = '',
    media: (constraints: MediaStreamConstraints) => Promise<MediaStream> = (
      constraints,
    ) => navigator.mediaDevices.getUserMedia(constraints),
  ): Promise<MicrophoneLease> => {
    const live = this.source?.getAudioTracks()[0];
    if (!live || live.readyState !== 'live')
      throw new Error('Join the room call before enabling this recorder.');
    const controller = new AbortController();
    let stream: MediaStream;
    try {
      stream = await media({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
    } catch {
      // Raw capture unavailable (device busy or permission narrowed) —
      // the processed call mic is still a valid take source.
      return this.acquire();
    }
    const off = this.onEnd(() => controller.abort());
    const release = () => {
      off();
      stream.getTracks().forEach((t) => t.stop());
    };
    controller.signal.addEventListener('abort', release, { once: true });
    return { stream, signal: controller.signal, release };
  };
}

export type RoomAudio = {
  output: StudioOutput;
  acquire: () => MicrophoneLease;
  acquireStudio?: (
    deviceId?: string,
  ) => Promise<MicrophoneLease> | MicrophoneLease;
};
