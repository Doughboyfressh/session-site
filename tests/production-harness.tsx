import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaults, bufferFor } from '../lib/audio';
import {
  renderExportTrack,
  createAudioExport,
  compressorLatency,
} from '../lib/audio-export';
import { processInWorker } from '../lib/audio-processing';
import { encodeWave } from '../lib/audio-files';
import { masterStereo } from '../lib/mastering';
import ChannelFx from '../app/channel-fx';
import '../app/globals.css';
import '../app/advanced.css';
function App() {
  const [result, setResult] = useState('Ready'),
    [busy, setBusy] = useState(false),
    [track, setTrack] = useState(defaults('Preset check'));
  async function run() {
    setBusy(true);
    setResult('Running');
    let checks = 0;
    const check = (ok: boolean, label: string) => {
      if (!ok) throw Error(label);
      checks++;
    };
    const originalFetch = window.fetch;
    try {
      for (const sampleRate of [44100, 48000] as const) {
        const input = new AudioBuffer({
          length: sampleRate,
          numberOfChannels: 2,
          sampleRate,
        });
        input.getChannelData(0)[1000] = 0.25;
        input.getChannelData(1)[1000] = 0.25;
        for (const limiter of [0, 0.5]) {
          const output = await renderExportTrack(
            { ...defaults(), limiter },
            input,
            sampleRate,
            { sampleRate, processing: 'processed', gainDb: 0 },
          );
          const values = output.getChannelData(0);
          let peak = 0;
          values.forEach((v, i) => {
            if (Math.abs(v) > Math.abs(values[peak])) peak = i;
          });
          check(
            Math.abs(peak - 1000) <= 1,
            'limiter export alignment ' + sampleRate + ' ' + limiter,
          );
          check(values.every(Number.isFinite), 'finite output');
        }
        check(
          (await compressorLatency(sampleRate)) >= 0,
          'latency measurement',
        );
      }
      const sr = 44100,
        source = new AudioBuffer({
          length: sr,
          numberOfChannels: 2,
          sampleRate: sr,
        });
      source
        .getChannelData(0)
        .forEach(
          (_, i) =>
            (source.getChannelData(0)[i] =
              0.1 * Math.sin((2 * Math.PI * 440 * i) / sr)),
        );
      source.copyToChannel(source.getChannelData(0), 1);
      let ticks = 0;
      const interval = setInterval(() => ticks++, 1);
      const processed = await processInWorker(source, {
        ...defaults(),
        stretch: 1.5,
        pitchShift: 1,
      });
      clearInterval(interval);
      check(
        processed.length === Math.round(sr * 1.5),
        'worker processed duration',
      );
      check(ticks > 0, 'interface remains responsive during processing');
      let firstFinished = false;
      const firstJob = processInWorker(source, {
        ...defaults(),
        stretch: 2,
      }).then(() => {
        firstFinished = true;
      });
      const queuedCancel = new AbortController();
      const queuedJob = processInWorker(
        source,
        { ...defaults(), stretch: 1.5 },
        queuedCancel.signal,
      );
      queuedCancel.abort();
      try {
        await queuedJob;
        throw Error('queued abort ignored');
      } catch (e) {
        check(
          (e as Error).name === 'AbortError' && !firstFinished,
          'queued cancellation is immediate',
        );
      }
      await firstJob;
      const cancelled = new AbortController();
      cancelled.abort();
      try {
        await processInWorker(
          source,
          { ...defaults(), stretch: 2 },
          cancelled.signal,
        );
        throw Error('abort was ignored');
      } catch (e) {
        check((e as Error).name === 'AbortError', 'worker cancellation');
      }
      const wave = await encodeWave(source, 32);
      let reads = 0,
        allowed = true;
      window.fetch = (async () => {
        reads++;
        return allowed
          ? new Response(wave.blob)
          : new Response(null, { status: 403 });
      }) as typeof fetch;
      const file = { ...defaults('Source'), fileId: 'production-fixture' };
      const data = {
        bpm: 120,
        tracks: [{ ...file, autoPitch: 1, denoise: 1 }],
      };
      const settings = {
        kind: 'mix',
        sampleRate: 44100,
        depth: 32,
        processing: 'dry',
        trackIds: [file.id],
        tail: 0,
        gainDb: 0,
        dither: false,
        includeMix: false,
      } as const;
      await createAudioExport('Dry', data, {
        ...settings,
        trackIds: [file.id],
      });
      check(reads >= 2, 'dry vocal bypass and file access checks');
      allowed = false;
      try {
        await bufferFor(file, 120, { revalidate: true });
        throw Error('revocation ignored');
      } catch (e) {
        check(
          (e as Error).message.includes('private'),
          'cached file revalidation',
        );
      }
      const stereo = [
        source.getChannelData(0).slice(),
        source.getChannelData(1).slice(),
      ] as [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];
      const mastered = await masterStereo(stereo, sr, 'universal');
      check(mastered[0].length === sr, 'master length');
      check(mastered[0].every(Number.isFinite), 'master finite');
      setResult('PASS: ' + checks + ' production browser checks');
    } catch (e) {
      setResult('FAIL: ' + (e as Error).message);
    } finally {
      window.fetch = originalFetch;
      setBusy(false);
    }
  }
  return (
    <main style={{ padding: 32, maxWidth: 800 }}>
      <h1>SESSION production verification</h1>
      <p>Synthetic audio only. No microphone, camera or account data.</p>
      <button className="button primary" disabled={busy} onClick={run}>
        Run production checks
      </button>
      <output style={{ display: 'block', margin: 20 }}>{result}</output>
      <h2>Preset controls</h2>
      <ChannelFx
        track={track}
        onPatch={(_, patch) => setTrack((t) => ({ ...t, ...patch }))}
      />
      <output aria-label="Applied EQ">
        EQ: {track.low}, {track.mid}, {track.high}
      </output>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
