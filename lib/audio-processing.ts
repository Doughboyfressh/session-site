import type { MixerTrack } from './audio';
let queue: Promise<unknown> = Promise.resolve();
// One processing job at a time limits peak memory; abort terminates CPU work.
export function processInWorker(
  buffer: AudioBuffer,
  options: MixerTrack,
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  const job = queue
    .catch(() => {})
    .then(
      () =>
        new Promise<AudioBuffer>((resolve, reject) => {
          if (signal?.aborted)
            return reject(
              new DOMException('Processing cancelled.', 'AbortError'),
            );
          if (typeof Worker === 'undefined')
            return reject(
              new Error(
                'This browser cannot process audio effects. Use a current browser or turn off vocal and time/pitch processing.',
              ),
            );
          const worker = new Worker(
            new URL('./audio-processing-worker.ts', import.meta.url),
            { type: 'module' },
          );
          const finish = (error?: Error, result?: AudioBuffer) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            worker.terminate();
            if (error) reject(error);
            else resolve(result!);
          };
          const abort = () =>
            finish(new DOMException('Processing cancelled.', 'AbortError'));
          const timer = setTimeout(
            () =>
              finish(
                new Error(
                  'Audio processing took too long. Shorten the source or reduce processing.',
                ),
              ),
            120000,
          );
          signal?.addEventListener('abort', abort, { once: true });
          worker.onerror = () =>
            finish(
              new Error(
                'Audio processing failed. Try a shorter source or turn off processing.',
              ),
            );
          worker.onmessage = (event) => {
            try {
              if (event.data.error) throw new Error(event.data.error);
              const channels: Float32Array<ArrayBuffer>[] = event.data.channels;
              if (
                channels.length !== buffer.numberOfChannels ||
                !channels[0]?.length
              )
                throw new Error('Invalid processed audio.');
              const result = new AudioBuffer({
                length: channels[0].length,
                numberOfChannels: channels.length,
                sampleRate: buffer.sampleRate,
              });
              channels.forEach((data, ch) => result.copyToChannel(data, ch));
              finish(undefined, result);
            } catch (e) {
              finish(e as Error);
            }
          };
          try {
            const channels = Array.from(
              { length: buffer.numberOfChannels },
              (_, ch) => buffer.getChannelData(ch).slice(),
            );
            worker.postMessage(
              { channels, sampleRate: buffer.sampleRate, options },
              channels.map((ch) => ch.buffer),
            );
          } catch (e) {
            finish(e as Error);
          }
        }),
    );
  queue = job.then(
    () => {},
    () => {},
  );
  if (!signal) return job;
  // Cancelling a queued request must not wait for somebody else's worker.
  return new Promise<AudioBuffer>((resolve, reject) => {
    const abort = () =>
      reject(new DOMException('Processing cancelled.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    job
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
