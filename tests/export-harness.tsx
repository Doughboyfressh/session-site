import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ExportAudio from '../app/export-audio';
import { defaults, channel, scheduleClip, synth } from '../lib/audio';
import {
  createAudioExport,
  renderExportTrack,
  compressorLatency,
  exportEnd,
  type ExportOptions,
} from '../lib/audio-export';
import { encodeWave, zipAudio } from '../lib/audio-files';
import '../app/globals.css';
import '../app/advanced.css';

const settings: ExportOptions = {
  kind: 'tracks',
  sampleRate: 48000,
  depth: 32,
  processing: 'processed',
  trackIds: [],
  tail: 2,
  gainDb: 0,
  dither: false,
  includeMix: true,
};
const keyTrack = {
  ...defaults('Keys'),
  notes: [{ id: 'n', pitch: 60, start: 0, length: 2, velocity: 0.7 }],
};
const padTrack = {
  ...defaults('Keys'),
  notes: [{ id: 'n', pitch: 67, start: 2, length: 2, velocity: 0.6 }],
  pan: -0.3,
};
function App() {
  const [lines, setLines] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false);
  async function run() {
    setBusy(true);
    setLines([]);
    let checks = 0;
    const log = (s: string) => setLines((l) => [...l, s]);
    const check = (ok: boolean, message: string) => {
      if (!ok) throw new Error(message);
      checks++;
    };
    const near = (a: number, b: number, tolerance = 1e-5) =>
      check(Math.abs(a - b) <= tolerance, `Expected ${b}, received ${a}`);
    const peakIndex = (a: Float32Array) => {
      let j = 0;
      for (let i = 1; i < a.length; i++)
        if (Math.abs(a[i]) > Math.abs(a[j])) j = i;
      return j;
    };
    try {
      for (const rate of [44100, 48000] as const) {
        const latency = await compressorLatency(rate);
        check(
          latency >= 0 && latency < rate * 0.02,
          'Measured latency out of range',
        );
        const c = new OfflineAudioContext(2, rate * 2, rate),
          source = c.createBuffer(2, rate * 2, rate);
        source.getChannelData(0)[Math.round(0.75 * rate)] = 0.1;
        source.getChannelData(1)[Math.round(0.8 * rate)] = 0.2;
        const t = {
          ...defaults('Impulse'),
          offset: 0.25,
          trimStart: 0.5,
          trimEnd: 0.25,
          volume: 1,
        };
        near(exportEnd(t, source.duration), 1.5);
        const dry = await renderExportTrack(t, source, rate * 2, {
          ...settings,
          sampleRate: rate,
          processing: 'dry',
        });
        const wet = await renderExportTrack(t, source, rate * 2, {
          ...settings,
          sampleRate: rate,
        });
        near(peakIndex(dry.getChannelData(0)), Math.round(0.5 * rate), 1);
        near(peakIndex(wet.getChannelData(0)), Math.round(0.5 * rate), 1);
        near(peakIndex(dry.getChannelData(1)), Math.round(0.55 * rate), 1);
        near(peakIndex(wet.getChannelData(1)), Math.round(0.55 * rate), 1);
        near(dry.getChannelData(0)[Math.round(0.5 * rate)], 0.1);
        near(wet.getChannelData(0)[Math.round(0.5 * rate)], 0.1, 1e-4);
        near(
          wet
            .getChannelData(0)
            .slice(Math.round(0.51 * rate))
            .reduce((sum, x) => sum + Math.abs(x), 0),
          0,
          1e-3,
        );
        const compressed = await renderExportTrack(
          { ...t, compression: 0.5 },
          source,
          rate * 2,
          { ...settings, sampleRate: rate },
        );
        near(
          peakIndex(compressed.getChannelData(0)),
          Math.round(0.5 * rate),
          1,
        );
        near(
          peakIndex(compressed.getChannelData(1)),
          Math.round(0.55 * rate),
          1,
        );
        const switching = new OfflineAudioContext(2, rate, rate),
          switched = channel(
            switching,
            { ...defaults('Toggle'), compression: 0.5 },
            switching.destination,
          );
        switched.update(
          { ...defaults('Toggle'), compression: 0, volume: 0.5 },
          false,
          true,
        );
        const switchSource = switching.createBuffer(2, rate, rate);
        switchSource.getChannelData(0)[0] = 0.2;
        switchSource.getChannelData(1)[0] = 0.2;
        scheduleClip(
          switching,
          defaults('Toggle'),
          switchSource,
          switched,
          0,
          0,
          1,
        );
        const switchResult = await switching.startRendering();
        near(switchResult.getChannelData(0)[0], 0.1);
        switched.dispose();
        const dynamic = new OfflineAudioContext(2, rate, rate);
        const dynamicTrack = {
          ...defaults('Dynamic'),
          volume: 1,
          compression: 0.5,
        };
        const dynamicChannel = channel(
          dynamic,
          dynamicTrack,
          dynamic.destination,
        );
        const dynamicBuffer = dynamic.createBuffer(2, rate, rate);
        dynamicBuffer.getChannelData(0).fill(0.1, 0, Math.round(0.15 * rate));
        dynamicBuffer.getChannelData(1).fill(0.1, 0, Math.round(0.15 * rate));
        scheduleClip(
          dynamic,
          dynamicTrack,
          dynamicBuffer,
          dynamicChannel,
          0,
          0,
          1,
        );
        const paused = dynamic.suspend(0.1),
          renderedDynamic = dynamic.startRendering();
        await paused;
        dynamicChannel.update({ ...dynamicTrack, compression: 0 }, false, true);
        const pausedAgain = dynamic.suspend(0.3);
        await dynamic.resume();
        await pausedAgain;
        dynamicChannel.update(dynamicTrack, false, true);
        await dynamic.resume();
        const dynamicResult = (await renderedDynamic).getChannelData(0);
        near(
          dynamicResult
            .slice(Math.ceil(0.31 * rate))
            .reduce((sum, x) => sum + Math.abs(x), 0),
          0,
        );
        dynamicChannel.dispose();
        log(
          `${rate} Hz: dry, processed and compressed impulses align; compressor bypass is clean (${latency} frames compensated when enabled).`,
        );
        const constant = c.createBuffer(2, rate, rate);
        constant.getChannelData(0).fill(0.2);
        constant.getChannelData(1).fill(0.2);
        const base = { ...defaults('Envelope'), volume: 1 };
        const short = await renderExportTrack(
          { ...base, fadeIn: 3 },
          constant,
          rate,
          { ...settings, sampleRate: rate, processing: 'dry' },
        );
        near(short.getChannelData(0)[Math.round(0.5 * rate)], 0.2 / 6, 1e-4);
        near(short.getChannelData(0)[rate - 1], 0.2 / 3, 1e-4);
        const overlap = await renderExportTrack(
          { ...base, fadeIn: 2, fadeOut: 2 },
          constant,
          rate,
          { ...settings, sampleRate: rate, processing: 'dry' },
        );
        near(overlap.getChannelData(0)[0], 0);
        near(overlap.getChannelData(0)[rate / 2], 0.2 * 0.25 * 0.25, 1e-5);
        near(overlap.getChannelData(0)[rate - 1], 0, 1e-5);
        const startup = await renderExportTrack(
          { ...base, volume: 0.5 },
          constant,
          rate,
          { ...settings, sampleRate: rate },
        );
        near(startup.getChannelData(0)[0], 0.1, 1e-4);
        const selectedMute = await renderExportTrack(
          { ...base, muted: true, solo: false },
          constant,
          rate,
          { ...settings, sampleRate: rate },
        );
        near(selectedMute.getChannelData(0)[0], 0.2, 1e-4);
        const dryBypass = await renderExportTrack(
          {
            ...base,
            muted: true,
            volume: 0,
            pan: 1,
            compression: 1,
            automation: [{ time: 0, value: 0 }],
          },
          constant,
          rate,
          { ...settings, sampleRate: rate, processing: 'dry' },
        );
        near(dryBypass.getChannelData(0)[0], 0.2);
        near(dryBypass.getChannelData(1)[0], 0.2);
        const automation = await renderExportTrack(
          {
            ...base,
            automation: [
              { time: 0, value: 0 },
              { time: 0.5, value: 0 },
              { time: 0.6, value: 1 },
            ],
          },
          constant,
          rate,
          { ...settings, sampleRate: rate },
        );
        near(automation.getChannelData(0)[Math.round(0.4 * rate)], 0);
        near(automation.getChannelData(0)[Math.round(0.7 * rate)], 0.2, 1e-4);
        const playlistTrack = {
          ...base,
          clipName: 'Intro',
          clips: [
            {
              id: 'repeat',
              name: 'Verse repeat',
              offset: 2,
              trimStart: 0,
              trimEnd: 0,
              fadeIn: 0.25,
              fadeStart: 0,
            },
          ],
        };
        const playlist = await renderExportTrack(
          playlistTrack,
          constant,
          rate * 4,
          { ...settings, sampleRate: rate, processing: 'dry' },
        );
        near(playlist.getChannelData(0)[Math.round(0.5 * rate)], 0.2, 1e-4);
        near(playlist.getChannelData(0)[Math.round(1.5 * rate)], 0);
        near(playlist.getChannelData(0)[Math.round(2.125 * rate)], 0.1, 1e-4);
        near(playlist.getChannelData(0)[Math.round(2.5 * rate)], 0.2, 1e-4);
        near(exportEnd(playlistTrack, constant.duration), 3);
        const echo = await renderExportTrack(
          { ...base, delay: 0.5 },
          constant,
          rate * 2,
          { ...settings, sampleRate: rate },
        );
        check(
          Math.abs(echo.getChannelData(0)[Math.round(1.1 * rate)]) > 0.001,
          'Wet delay tail missing',
        );
        check(
          exportEnd({ ...base, offset: 299 }, 1) === 300,
          'Exact timeline limit should be accepted',
        );
        let rejected = false;
        try {
          exportEnd({ ...base, trimStart: 1 }, 1);
        } catch {
          rejected = true;
        }
        check(rejected, 'Fully trimmed track was accepted');
        log(
          `${rate} Hz: fades, automation, reusable clips and retained delay tails passed.`,
        );
      }
      const pattern = [
        [1, ...Array(15).fill(0)],
        [0, 1, ...Array(14).fill(0)],
        [0, 0, 1, ...Array(13).fill(0)],
      ];
      const s1 = await synth(240, pattern, undefined, 44100),
        s2 = await synth(240, pattern, undefined, 44100);
      let delta = 0;
      for (let i = 0; i < s1.length; i++)
        delta = Math.max(
          delta,
          Math.abs(s1.getChannelData(0)[i] - s2.getChannelData(0)[i]),
        );
      near(delta, 0);
      log('Repeated drum synthesis is deterministic.');
      let invalidNotes = false;
      try {
        await createAudioExport(
          'Limit',
          {
            bpm: 120,
            tracks: [
              {
                ...keyTrack,
                notes: [
                  {
                    id: 'late',
                    pitch: 60,
                    start: 600,
                    length: 1,
                    velocity: 0.5,
                  },
                ],
              },
            ],
          },
          { ...settings, trackIds: [keyTrack.id] },
        );
      } catch (e) {
        invalidNotes =
          e instanceof Error &&
          e.message.includes('five-minute instrument limit');
      }
      check(invalidNotes, 'Late instrument notes were silently shortened');
      let invalidSelection = false;
      try {
        await createAudioExport(
          'Missing',
          { bpm: 120, tracks: [keyTrack] },
          { ...settings, trackIds: ['missing'] },
        );
      } catch (e) {
        invalidSelection =
          e instanceof Error && e.message.includes('available track');
      }
      check(invalidSelection, 'Unknown selected track was accepted');
      const tracks = [keyTrack, padTrack],
        snapshot = JSON.stringify(tracks);
      const opts = { ...settings, trackIds: tracks.map((t) => t.id), tail: 0 };
      const archive = await createAudioExport(
        'QA ../session',
        { bpm: 120, tracks },
        opts,
      );
      check(
        JSON.stringify(tracks) === snapshot,
        'Export mutated the arrangement',
      );
      const zip = new Uint8Array(await archive.blob.arrayBuffer()),
        view = new DataView(zip.buffer),
        files: { name: string; bytes: ArrayBuffer }[] = [];
      let at = 0;
      while (view.getUint32(at, true) === 0x04034b50) {
        const size = view.getUint32(at + 18, true),
          len = view.getUint16(at + 26, true),
          extra = view.getUint16(at + 28, true);
        files.push({
          name: new TextDecoder().decode(zip.slice(at + 30, at + 30 + len)),
          bytes: zip.slice(at + 30 + len + extra, at + 30 + len + extra + size)
            .buffer,
        });
        at += 30 + len + extra + size;
      }
      check(
        files.length === 4,
        'Package should contain two tracks, reference and guide',
      );
      check(
        files[0].name !== files[1].name,
        'Duplicate track names were not numbered',
      );
      const parsed = files
        .filter((f) => f.name.endsWith('.wav'))
        .map((f) => {
          const v = new DataView(f.bytes);
          let pos = 12;
          while (
            new TextDecoder().decode(f.bytes.slice(pos, pos + 4)) !== 'data'
          )
            pos +=
              8 + v.getUint32(pos + 4, true) + (v.getUint32(pos + 4, true) & 1);
          const count = v.getUint32(pos + 4, true) / 4;
          return Array.from({ length: count }, (_, i) =>
            v.getFloat32(pos + 8 + i * 4, true),
          );
        });
      check(
        parsed.every((a) => a.length === parsed[0].length),
        'WAV lengths differ',
      );
      let diff = 0;
      for (let i = 0; i < parsed[0].length; i++)
        diff = Math.max(
          diff,
          Math.abs(parsed[0][i] + parsed[1][i] - parsed[2][i]),
        );
      near(diff, 0, 1e-6);
      check(
        new TextDecoder()
          .decode(files[3].bytes)
          .includes('Import every WAV at 00:00'),
        'Import instructions missing',
      );
      log(
        'Track ZIP, unique filenames, common lengths, source immutability and reference sum passed.',
      );
      const aborted = new AbortController();
      aborted.abort();
      let cancelled = false;
      try {
        await createAudioExport(
          'Cancel',
          { bpm: 120, tracks },
          opts,
          aborted.signal,
        );
      } catch (e) {
        cancelled = e instanceof Error && e.name === 'AbortError';
      }
      check(cancelled, 'Pre-cancel did not stop');
      const renderCancel = new AbortController();
      const controllerContext = new OfflineAudioContext(2, 48000, 48000),
        source = controllerContext.createBuffer(2, 48000, 48000);
      const pending = renderExportTrack(
        defaults('Cancel'),
        source,
        48000 * 3,
        settings,
        renderCancel.signal,
      );
      renderCancel.abort();
      cancelled = false;
      try {
        await pending;
      } catch (e) {
        cancelled = e instanceof Error && e.name === 'AbortError';
      }
      check(cancelled, 'Cancelled render was returned');
      const crcCancel = new AbortController();
      const packed = zipAudio(
        [
          {
            name: 'large.wav',
            blob: new Blob([new Uint8Array(4 * 1024 * 1024)]),
          },
        ],
        crcCancel.signal,
      );
      crcCancel.abort();
      cancelled = false;
      try {
        await packed;
      } catch (e) {
        cancelled = e instanceof Error && e.name === 'AbortError';
      }
      check(cancelled, 'Packaging ignored cancellation');
      const encodingCancel = new AbortController();
      const encoded = encodeWave(
        {
          length: 48000 * 3,
          sampleRate: 48000,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array(48000 * 3),
        },
        24,
        { signal: encodingCancel.signal },
      );
      encodingCancel.abort();
      cancelled = false;
      try {
        await encoded;
      } catch (e) {
        cancelled = e instanceof Error && e.name === 'AbortError';
      }
      check(cancelled, 'Encoding ignored cancellation');
      const retry = await createAudioExport(
        'Retry',
        { bpm: 120, tracks: [keyTrack] },
        { ...opts, kind: 'mix', trackIds: [keyTrack.id] },
      );
      check(retry.blob.size > 44, 'Export did not recover after cancellation');
      log(
        'Cancellation during rendering, encoding and packaging, then retry passed.',
      );
      log(`PASS: ${checks} browser audio assertions.`);
    } catch (e) {
      log('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: 30 }}>
      <h1>SESSION export verification</h1>
      <p>
        Synthetic audio only. No camera, microphone, account or private files.
      </p>
      <div className="actions" style={{ margin: '24px 0' }}>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? 'Checking audio…' : 'Run audio checks'}
        </button>
        <button className="button secondary" onClick={() => setShow(true)}>
          Open export panel
        </button>
      </div>
      <ol aria-label="Verification results">
        {lines.map((line, i) => (
          <li key={i} style={{ padding: '12px 0' }}>
            {line}
          </li>
        ))}
      </ol>
      {show && (
        <ExportAudio
          title="QA studio export"
          data={{ bpm: 120, tracks: [keyTrack, padTrack] }}
          onClose={() => setShow(false)}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
