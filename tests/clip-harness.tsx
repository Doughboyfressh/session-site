import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  channel,
  defaults,
  scheduleClip,
  stereoMeter,
  type MixerTrack,
} from '../lib/audio';
import { splitClip } from '../lib/clip-edit';
import { renderExportTrack, type ExportOptions } from '../lib/audio-export';
import Studio from '../app/studio';
import '../app/globals.css';
import '../app/advanced.css';

const initial = {
  title: 'Clip editing verification',
  canEdit: true,
  data: {
    bpm: 120,
    tracks: [
      {
        ...defaults('Test keys'),
        id: 'keys',
        notes: [{ id: 'n', pitch: 60, start: 0, length: 8, velocity: 0.6 }],
        duration: 4.5,
        peaks: Array.from({ length: 120 }, (_, i) => 0.2 + i / 200),
        fadeIn: 1,
        fadeOut: 1,
        clipName: 'Intro phrase',
        clips: [
          {
            id: 'verse-repeat',
            name: 'Verse repeat',
            offset: 5,
            trimStart: 0,
            trimEnd: 0,
          },
        ],
      },
    ],
  },
};
function App() {
  const [lines, setLines] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<any>(null),
    [allowed, setAllowed] = useState(true),
    [notice, setNotice] = useState('');
  async function run() {
    setBusy(true);
    setLines([]);
    let checks = 0;
    const check = (ok: boolean, message: string) => {
      if (!ok) throw new Error(message);
      checks++;
    };
    const log = (s: string) => setLines((l) => [...l, s]);
    const difference = (a: AudioBuffer, b: AudioBuffer) => {
      let max = 0;
      for (let ch = 0; ch < 2; ch++) {
        const x = a.getChannelData(ch),
          y = b.getChannelData(ch);
        for (let i = 0; i < x.length; i++)
          max = Math.max(max, Math.abs(x[i] - y[i]));
      }
      return max;
    };
    try {
      const picker = document.querySelector(
        'select[aria-label="Selected clip placement"]',
      ) as HTMLSelectElement | null;
      check(!!picker, 'The deterministic clip picker is missing.');
      check(
        [...(picker?.options || [])].map((option) => option.value).join(',') ===
          '$primary,verse-repeat',
        'The clip picker does not expose every placement.',
      );
      const firstClip = document.querySelector<HTMLElement>('.wave-clip');
      check(
        !!firstClip && parseFloat(getComputedStyle(firstClip).minWidth) >= 24,
        'Timeline clips do not have a usable minimum pointer target.',
      );
      for (const sr of [44100, 48000]) {
        const factory = new OfflineAudioContext(2, sr * 6, sr),
          source = factory.createBuffer(2, sr * 4, sr);
        for (let ch = 0; ch < 2; ch++)
          for (let i = 0; i < source.length; i++)
            source.getChannelData(ch)[i] =
              0.22 * Math.sin((i * (ch ? 317 : 223) * Math.PI * 2) / sr);
        const t = {
          ...defaults('Stereo source'),
          id: 'source',
          duration: 4,
          offset: 0.5,
          trimStart: 0.25,
          trimEnd: 0.25,
          fadeIn: 2.8,
          fadeOut: 2.5,
          volume: 1,
          automation: [
            { time: 0, value: 0.3 },
            { time: 1, value: 0.9 },
            { time: 2.5, value: 0.4 },
            { time: 5, value: 0.8 },
          ],
        };
        const render = async (
          tracks: MixerTrack[],
          from = 0,
          fx = false,
          meter = false,
        ) => {
          const c = new OfflineAudioContext(2, sr * 6, sr);
          for (const track of tracks) {
            const ch = fx
              ? channel(c, track, c.destination, meter)
              : { input: c.createGain(), auto: c.createGain() };
            if (!fx) ch.input.connect(ch.auto).connect(c.destination);
            scheduleClip(c, track, source, ch, 0, from, 6);
          }
          return c.startRendering();
        };
        const original = await render([t]);
        for (const cut of [0.75, 1.125, 1.5, 3.75]) {
          const halves = splitClip(
            { bpm: 120, tracks: [t] },
            t.id,
            cut,
            'right',
          ).tracks;
          const rendered = await render(halves);
          check(
            difference(original, rendered) < 2e-5,
            `Split PCM drift at ${sr}/${cut}: ${difference(original, rendered)}`,
          );
          check(
            difference(
              await render([t], cut + 0.1),
              await render(halves, cut + 0.1),
            ) < 2e-5,
            'Playback from inside an inherited fade changed',
          );
        }
        let repeated = splitClip({ bpm: 120, tracks: [t] }, t.id, 1, 'right');
        repeated = splitClip(repeated, 'right', 2, 'third');
        repeated = splitClip(repeated, 'third', 3, 'fourth');
        check(
          difference(original, await render(repeated.tracks)) < 2e-5,
          'Repeated cuts drifted',
        );
        const anchored = { ...t, fadeStart: 1, fadeEnd: 2.5 };
        const anchorA = await render([anchored]);
        const anchorB = await render(
          splitClip({ bpm: 120, tracks: [anchored] }, t.id, 1.1, 'right')
            .tracks,
        );
        let di = 0,
          dm = 0;
        for (let i = 0; i < anchorA.length; i++) {
          const d = Math.abs(
            anchorA.getChannelData(0)[i] - anchorB.getChannelData(0)[i],
          );
          if (d > dm) {
            dm = d;
            di = i;
          }
        }
        check(
          difference(anchorA, anchorB) < 2e-5,
          `Pre/post-anchor hold changed ${sr}: ${difference(anchorA, anchorB)}, left ${dm} at ${di / sr}, values ${anchorA.getChannelData(0)[di]}/${anchorB.getChannelData(0)[di]}`,
        );
        const fx = {
          ...t,
          low: 2,
          mid: -3,
          high: 1,
          reverb: 0.15,
          delay: 0.12,
          pan: -0.25,
        };
        check(
          difference(
            await render([fx], 0, true),
            await render(
              splitClip({ bpm: 120, tracks: [fx] }, t.id, 2, 'right').tracks,
              0,
              true,
            ),
          ) < 0.004,
          'Linear effect tails changed excessively',
        );
        check(
          difference(
            await render([fx], 0, true),
            await render([fx], 0, true, true),
          ) < 1e-6,
          'Meters changed rendered sound',
        );
        const options: ExportOptions = {
          kind: 'tracks',
          sampleRate: sr as 44100 | 48000,
          depth: 32,
          processing: 'dry',
          trackIds: [],
          tail: 0,
          gainDb: 0,
          dither: false,
          includeMix: false,
        };
        const full = await renderExportTrack(
          t,
          source,
          sr * 6,
          options,
          new AbortController().signal,
        );
        const halves = splitClip(
          { bpm: 120, tracks: [t] },
          t.id,
          2,
          'right',
        ).tracks;
        const parts = await Promise.all(
          halves.map((h) =>
            renderExportTrack(
              h,
              source,
              sr * 6,
              options,
              new AbortController().signal,
            ),
          ),
        );
        let exportDiff = 0;
        for (let ch = 0; ch < 2; ch++)
          for (let i = 0; i < full.length; i++)
            exportDiff = Math.max(
              exportDiff,
              Math.abs(
                full.getChannelData(ch)[i] -
                  parts[0].getChannelData(ch)[i] -
                  parts[1].getChannelData(ch)[i],
              ),
            );
        check(exportDiff < 2e-5, 'Dry aligned stems lost fade continuity');
        for (const cut of [1.125, 2]) {
          const index = Math.round((t.trimStart + cut - t.offset) * sr);
          for (let ch = 0; ch < 2; ch++) {
            source.getChannelData(ch).fill(0);
            source.getChannelData(ch).set([0.6, 0.7, 0.8], index - 1);
          }
          const plain = { ...t, fadeIn: 0, fadeOut: 0, automation: [] };
          const impulseA = await render([plain]);
          const impulseB = await render(
            splitClip(
              { bpm: 120, tracks: [plain] },
              plain.id,
              cut,
              'impulse-right',
            ).tracks,
          );
          check(
            difference(impulseA, impulseB) < 1e-6,
            'A split dropped or doubled boundary impulses',
          );
        }
        log(
          `${sr} Hz: split fades, automation, repeated edits, effect tails and export passed.`,
        );
      }
      const c = new AudioContext(),
        silent = c.createGain();
      silent.gain.value = 0;
      silent.connect(c.destination);
      const b = c.createBuffer(2, c.sampleRate, c.sampleRate);
      b.getChannelData(0).fill(0.8);
      b.getChannelData(1).fill(-0.8);
      const source = c.createBufferSource();
      source.buffer = b;
      source.loop = true;
      source.connect(silent);
      const meter = stereoMeter(c, source);
      await c.resume();
      source.start();
      await new Promise((r) => setTimeout(r, 100));
      check(
        meter.level() > 0.79,
        'Opposite-polarity stereo disappeared from meter',
      );
      source.stop();
      source.disconnect();
      meter.dispose();
      silent.disconnect();
      await c.close();
      log(
        `PASS: ${checks} browser editing, export and stereo-meter assertions.`,
      );
    } catch (error: any) {
      log('FAIL: ' + error.message);
    } finally {
      setBusy(false);
    }
  }
  if (new URLSearchParams(location.search).has('compact'))
    return (
      <main style={{ padding: 12 }}>
        <Studio
          initial={initial}
          onDraft={setDraft}
          onSaved={() => {}}
          onBrowse={() => {}}
          notify={setNotice}
          roomAllowed={allowed}
        />
      </main>
    );
  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: 'auto' }}>
      <h1>Clip & mixer verification</h1>
      <p>Synthetic audio only. No accounts, uploads, camera, or microphone.</p>
      <div className="actions" style={{ margin: '20px 0' }}>
        <button className="button primary" disabled={busy} onClick={run}>
          Run clip audio checks
        </button>
        <button
          className="button secondary"
          onClick={() => setAllowed((a) => !a)}
        >
          {allowed ? 'Pause editing access' : 'Restore editing access'}
        </button>
      </div>
      <ol aria-label="Verification results">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
      <p role="status">{notice}</p>
      <output aria-label="Draft track summary">
        {JSON.stringify(
          draft?.data?.tracks.map((t: MixerTrack) => ({
            id: t.id,
            name: t.name,
            offset: t.offset,
            trimStart: t.trimStart,
            trimEnd: t.trimEnd,
            volume: t.volume,
            fadeStart: t.fadeStart,
            fadeEnd: t.fadeEnd,
            clipName: t.clipName,
            clips: t.clips,
          })),
        )}
      </output>
      <Studio
        initial={initial}
        onDraft={setDraft}
        onSaved={() => {}}
        onBrowse={() => {}}
        notify={setNotice}
        roomAllowed={allowed}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
