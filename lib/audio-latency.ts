const cache = new Map<number, Promise<number>>();

/** Measure this browser's compressor lookahead in samples before aligned export. */
export function compressorLatency(sampleRate: number) {
  if (!cache.has(sampleRate)) {
    const task = (async () => {
      const c = new OfflineAudioContext(
        1,
        Math.ceil(sampleRate * 0.1),
        sampleRate,
      );
      const source = c.createBufferSource(),
        compressor = c.createDynamicsCompressor();
      source.buffer = c.createBuffer(1, 1, sampleRate);
      source.buffer.getChannelData(0)[0] = 0.1;
      compressor.ratio.value = 1;
      compressor.threshold.value = 0;
      compressor.knee.value = 0;
      source.connect(compressor).connect(c.destination);
      source.start();
      try {
        const data = (await c.startRendering()).getChannelData(0);
        let peak = 0;
        for (let i = 1; i < data.length; i++)
          if (Math.abs(data[i]) > Math.abs(data[peak])) peak = i;
        if (data[peak] < 0.01 || peak > sampleRate * 0.02)
          throw new Error(
            'This browser could not verify export timing. Try another browser.',
          );
        return peak;
      } finally {
        source.disconnect();
        compressor.disconnect();
      }
    })();
    cache.set(sampleRate, task);
    void task.catch(() => cache.delete(sampleRate));
  }
  return cache.get(sampleRate)!;
}
