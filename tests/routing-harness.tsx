import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  channel,
  defaults,
  routingGraph,
  scheduleClip,
  playMix,
  type Arrangement,
} from '../lib/audio';
import { renderExportTrack } from '../lib/audio-export';
import { defaultRouting, type MixerRouting } from '../lib/mixer-routing';
import Studio from '../app/studio';
import '../app/globals.css';
import '../app/advanced.css';
const settings = {
  sampleRate: 48000 as 44100 | 48000,
  processing: 'processed' as const,
  gainDb: 0,
};
const tracks = [
  {
    ...defaults('Lead vocal'),
    id: 'lead',
    groupId: 'group-1' as const,
    volume: 0.7,
    sendReverb: 0.4,
    sendDelay: 0.3,
  },
  {
    ...defaults('Drums'),
    id: 'drums',
    groupId: 'group-2' as const,
    volume: 0.6,
    sendReverb: 0.2,
    sendDelay: 0.1,
  },
];
const arrangement: Arrangement = {
  bpm: 120,
  routing: defaultRouting(),
  tracks: tracks.map((t) => ({
    ...t,
    notes: [
      {
        id: 'n',
        pitch: t.id === 'lead' ? 60 : 40,
        start: 0,
        length: 4,
        velocity: 0.5,
      },
    ],
    duration: 2.5,
    peaks: [0.2, 0.3],
  })),
};
let latestDraft: { data: Arrangement & { routing: MixerRouting } };
const findButton = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) =>
      b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  );
async function until(fn: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('Mixer UI timed out');
}
async function press(name: string) {
  await until(() => !!findButton(name) && !findButton(name)!.disabled);
  findButton(name)!.click();
  await new Promise((r) => setTimeout(r, 25));
}
function field(label: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(
    'input[aria-label="' + label + '"]',
  )!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function App() {
  const [log, setLog] = useState(''),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false),
    [uiKey, setUiKey] = useState(0),
    [editable, setEditable] = useState(true);
  async function runUI() {
    setBusy(true);
    setLog('Checking mixer controls…');
    let checks = 0;
    const check = (ok: unknown, message: string) => {
      if (!ok) throw Error(message);
      checks++;
    };
    try {
      setEditable(true);
      setUiKey((n) => n + 1);
      setShow(true);
      await press('Mixer');
      check(
        document.querySelectorAll('.group-mixer .mix-channel').length === 4,
        'Group channels missing',
      );
      const name = document.querySelector<HTMLInputElement>(
        '[aria-label="Group 1 name"]',
      )!;
      name.focus();
      field('Group 1 name', 'Lead group');
      name.blur();
      await new Promise((r) => setTimeout(r, 25));
      check(
        latestDraft.data.routing.groups[0].name === 'Lead group',
        'Group rename not in draft',
      );
      await press('Undo');
      check(
        latestDraft.data.routing.groups[0].name === 'Vocals',
        'Group rename Undo failed',
      );
      const fader = document.querySelector<HTMLInputElement>(
        '[aria-label="Vocals group volume"]',
      )!;
      fader.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
      field('Vocals group volume', '.8');
      await new Promise((r) => setTimeout(r, 20));
      field('Vocals group volume', '.5');
      await new Promise((r) => setTimeout(r, 20));
      fader.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }),
      );
      check(
        latestDraft.data.routing.groups[0].volume === 0.5,
        'Group fader not applied',
      );
      await press('Undo');
      check(
        latestDraft.data.routing.groups[0].volume === 1,
        'Fader gesture became multiple undo steps',
      );
      await press('Redo');
      check(
        latestDraft.data.routing.groups[0].volume === 0.5,
        'Group fader Redo failed',
      );
      field('Lead vocal reverb send', '.75');
      await new Promise((r) => setTimeout(r, 25));
      check(
        latestDraft.data.tracks[0].sendReverb === 0.75,
        'Send level not retained',
      );
      field('Shared delay level', '.35');
      await new Promise((r) => setTimeout(r, 25));
      check(
        latestDraft.data.routing.delay === 0.35,
        'Shared return not retained',
      );
      await press('Mute Vocals group');
      check(
        latestDraft.data.routing.groups[0].muted,
        'Group mute not retained',
      );
      setEditable(false);
      setUiKey((n) => n + 1);
      await new Promise((r) => setTimeout(r, 50));
      await press('Mixer');
      check(
        document.querySelector<HTMLInputElement>(
          '[aria-label="Vocals group volume"]',
        )?.disabled,
        'Read-only group fader enabled',
      );
      check(
        document.querySelector<HTMLInputElement>(
          '[aria-label="Lead vocal reverb send"]',
        )?.disabled &&
          document.querySelector<HTMLFieldSetElement>('.channel-routing')
            ?.disabled,
        'Read-only send/output enabled',
      );
      setShow(false);
      setLog(
        'PASS: ' +
          checks +
          ' mixer groups, gestures, Undo/Redo, sends, returns and read-only UI assertions.',
      );
    } catch (e) {
      setLog('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    setBusy(true);
    setLog('Rendering synthetic audio…');
    let checks = 0;
    const check = (v: unknown, m: string) => {
      if (!v) throw Error(m);
      checks++;
    };
    const diff = (
      a: { getChannelData: (ch: number) => Float32Array },
      b: { getChannelData: (ch: number) => Float32Array },
    ) => {
      let peak = 0;
      for (let ch = 0; ch < 2; ch++) {
        const x = a.getChannelData(ch),
          y = b.getChannelData(ch);
        for (let i = 0; i < x.length; i++)
          peak = Math.max(peak, Math.abs(x[i] - y[i]));
      }
      return peak;
    };
    try {
      for (const rate of [44100, 48000] as const) {
        const frames = rate * 2;
        const source = new AudioBuffer({
          numberOfChannels: 2,
          length: rate / 2,
          sampleRate: rate,
        });
        for (let ch = 0; ch < 2; ch++)
          for (let i = 0; i < rate / 4; i++)
            source.getChannelData(ch)[i] =
              0.1 * Math.sin((2 * Math.PI * (ch ? 330 : 220) * i) / rate);
        const data: Arrangement = {
          bpm: 120,
          routing: defaultRouting(),
          tracks: structuredClone(tracks),
        };
        data.routing!.groups[0].volume = 0.6;
        data.routing!.groups[0].pan = -0.2;
        data.routing!.groups[1].volume = 0.8;
        const render = async (
          d: Arrangement,
          routed = true,
          ignore = false,
        ) => {
          const c = new OfflineAudioContext(2, frames, rate);
          const graph = routed
            ? routingGraph(c, d, c.destination, false, ignore)
            : null;
          const inputs = d.tracks.map((t) => {
            const input = channel(
              c,
              t,
              graph?.inputs.get(t.id) || c.destination,
            );
            scheduleClip(c, t, source, input, 0, 0, frames / rate);
            return input;
          });
          try {
            return await c.startRendering();
          } finally {
            inputs.forEach((n) => n.dispose());
            graph?.dispose();
          }
        };
        const legacy: Arrangement = {
          bpm: 120,
          tracks: tracks.map((t) => ({
            ...t,
            groupId: undefined,
            sendReverb: 0,
            sendDelay: 0,
          })),
        };
        check(
          diff(await render(legacy), await render(legacy, false)) < 1e-7,
          'Legacy mix changed with default routing at ' + rate,
        );
        const mix = await render(data);
        const stems = await Promise.all(
          data.tracks.map((t) =>
            renderExportTrack(
              t,
              source,
              frames,
              { ...settings, sampleRate: rate },
              undefined,
              data,
            ),
          ),
        );
        const sum = {
          getChannelData: (ch: number) =>
            Float32Array.from(
              stems[0].getChannelData(ch),
              (n, i) => n + stems[1].getChannelData(ch)[i],
            ),
        };
        check(
          diff(mix, sum) < 5e-6,
          'Processed stems do not sum to shared graph at ' +
            rate +
            ': ' +
            diff(mix, sum),
        );
        const zero = structuredClone(data);
        zero.routing!.groups.forEach((g) => (g.muted = true));
        const silence = await render(zero);
        check(
          silence.getChannelData(0).every((n) => Math.abs(n) < 1e-8),
          'Muted groups leak through shared sends',
        );
        const dryRoutes = structuredClone(data);
        dryRoutes.routing!.reverb = 0;
        dryRoutes.routing!.delay = 0;
        const noSends = structuredClone(data);
        noSends.tracks.forEach((t) => {
          t.sendReverb = 0;
          t.sendDelay = 0;
        });
        check(
          diff(await render(dryRoutes), await render(noSends)) < 1e-7,
          'Zero return fails to silence shared effects',
        );
        let tail = 0;
        for (const n of mix.getChannelData(0).subarray(rate / 2))
          tail = Math.max(tail, Math.abs(n));
        check(tail > 0.00001, 'Shared effect tail missing');
        const groupZero = structuredClone(data);
        groupZero.routing!.groups.forEach((g) => (g.volume = 0));
        check(
          (await render(groupZero))
            .getChannelData(0)
            .every((n) => Math.abs(n) < 1e-8),
          'Group zero volume leaves wet sends audible',
        );
        const half = structuredClone(data);
        half.routing!.groups.forEach((g) => (g.volume *= 0.5));
        const halfMix = await render(half);
        check(
          diff(halfMix, {
            getChannelData: (ch) =>
              Float32Array.from(mix.getChannelData(ch), (n) => n * 0.5),
          }) < 1e-6,
          'Sends do not follow group level',
        );
        const dryA = await renderExportTrack(
          data.tracks[0],
          source,
          frames,
          { sampleRate: rate, processing: 'dry', gainDb: 0 },
          undefined,
          data,
        );
        const dryB = await renderExportTrack(
          { ...data.tracks[0], volume: 0.1, sendReverb: 1 },
          source,
          frames,
          { sampleRate: rate, processing: 'dry', gainDb: 0 },
        );
        check(diff(dryA, dryB) < 1e-7, 'Dry export includes routing');
        const mutedExport = await renderExportTrack(
          { ...data.tracks[0], muted: true, solo: true },
          source,
          frames,
          { ...settings, sampleRate: rate },
          undefined,
          zero,
        );
        check(
          diff(mutedExport, stems[0]) < 1e-7,
          'Selected processed export does not bypass listening mute/solo',
        );
        const impulse = new AudioBuffer({
          numberOfChannels: 2,
          length: rate / 2,
          sampleRate: rate,
        });
        impulse.getChannelData(0)[5000] = 0.1;
        impulse.getChannelData(1)[5000] = 0.1;
        const comp = {
          ...data.tracks[0],
          compression: 0.4,
          sendReverb: 0,
          sendDelay: 0,
        };
        const aligned = await renderExportTrack(
          comp,
          impulse,
          frames,
          { ...settings, sampleRate: rate },
          undefined,
          data,
        );
        const samples = aligned.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < samples.length; i++)
          if (Math.abs(samples[i]) > Math.abs(samples[peak])) peak = i;
        check(
          peak === 5000,
          'Group routing moved compensated compressor timing',
        );
      }
      const c = new AudioContext({ sampleRate: 48000 });
      let release = 0;
      const live = await playMix(arrangement, undefined, {
        audioContext: c,
        output: () => () => release++,
      });
      try {
        await new Promise((r) => setTimeout(r, 500));
        check(
          Object.keys(live.levels()).includes('return:reverb') &&
            Object.keys(live.levels()).includes('group:group-1'),
          'Group/return meters missing',
        );
        const next = structuredClone(arrangement);
        next.tracks[0].groupId = 'group-2';
        next.routing!.groups[1].volume = 0;
        next.routing!.reverb = 0;
        next.routing!.delay = 0;
        live.update(next);
        await new Promise((r) => setTimeout(r, 250));
        check(
          live.level() < 0.0001,
          'Live reroute or group/return level failed',
        );
        live.update(arrangement);
        await new Promise((r) => setTimeout(r, 250));
        check(live.level() > 0.0001, 'Live routing cannot resume');
      } finally {
        live.stop();
        live.stop();
        await c.close();
      }
      check(release === 1, 'Room output released incorrectly');
      setLog(
        'PASS: ' +
          checks +
          ' shared-routing audio, stem-sum, mute, level, latency, live-update and room-output assertions.',
      );
    } catch (e) {
      setLog('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <h1>SESSION routing verification</h1>
      <p>Synthetic audio only. No microphone, camera, accounts or uploads.</p>
      <button disabled={busy} onClick={() => void run()}>
        Run routing audio checks
      </button>
      <button disabled={busy} onClick={() => void runUI()}>
        Run mixer UI checks
      </button>
      <button
        onClick={() => {
          setEditable(true);
          setShow(!show);
        }}
      >
        Show mixer example
      </button>
      <output aria-label="Routing results">{log}</output>
      {show && (
        <Studio
          key={uiKey}
          initial={{
            title: 'Routing example',
            data: arrangement,
            canEdit: editable,
          }}
          onDraft={(draft) => {
            latestDraft = draft;
          }}
          onSaved={() => {}}
          onBrowse={() => {}}
          notify={() => {}}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
