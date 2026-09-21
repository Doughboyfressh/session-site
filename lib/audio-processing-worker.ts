import { denoiseChannel, autoPitchChannel } from './pitch';
import { shiftChannels, stretchChannels } from './timestretch';
import type { MixerTrack } from './audio';
const worker = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          channels: Float32Array<ArrayBuffer>[];
          sampleRate: number;
          options: MixerTrack;
        }>,
      ) => void)
    | null;
  postMessage: (value: unknown, transfers?: Transferable[]) => void;
};
worker.onmessage = ({ data: { channels, sampleRate, options: o } }) => {
  try {
    let result = channels.map((channel) => {
      let data = channel;
      if (o.denoise) data = denoiseChannel(data, sampleRate, o.denoise);
      if (o.autoPitch)
        data = autoPitchChannel(
          data,
          sampleRate,
          o.autoPitch,
          o.pitchKey || 0,
          !!o.pitchMinor,
        );
      return data;
    });
    if (o.pitchShift) result = shiftChannels(result, o.pitchShift);
    if (o.stretch && o.stretch !== 1)
      result = stretchChannels(result, o.stretch);
    worker.postMessage(
      { channels: result },
      result.map((ch) => ch.buffer),
    );
  } catch (e) {
    worker.postMessage({ error: (e as Error).message });
  }
};
