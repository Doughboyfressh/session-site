import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import BrowserInstrumentControls from '../app/browser-instrument-controls';
import {
  BROWSER_INSTRUMENT_PRESETS,
  defaultBrowserInstrument,
  playBrowserNote,
  validateBrowserInstrument,
  type BrowserInstrument,
} from '../lib/browser-instruments';
import '../app/globals.css';

const sampleRate = 44100;
type Evidence = {
  passed: boolean;
  checks: number;
  metrics: Record<string, number>;
  error?: string;
};
declare global {
  interface Window {
    __browserInstrumentResults?: Evidence;
  }
}
async function verify(): Promise<Evidence> {
  let checks = 0;
  const metrics: Record<string, number> = {};
  const check = (condition: boolean, message: string) => {
    checks++;
    if (!condition) throw Error(message);
  };
  function peak(buffer: AudioBuffer, from = 0, to = buffer.duration) {
    let value = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (
        let i = Math.floor(from * sampleRate);
        i < Math.min(data.length, Math.floor(to * sampleRate));
        i++
      ) {
        if (!Number.isFinite(data[i])) return Infinity;
        value = Math.max(value, Math.abs(data[i]));
      }
    }
    return value;
  }
  function rms(buffer: AudioBuffer, from = 0.15, to = 0.35) {
    const data = buffer.getChannelData(0);
    let square = 0,
      count = 0;
    for (
      let i = Math.floor(from * sampleRate);
      i < Math.floor(to * sampleRate);
      i++
    ) {
      square += data[i] ** 2;
      count++;
    }
    return Math.sqrt(square / count);
  }
  function difference(left: AudioBuffer, right: AudioBuffer) {
    const a = left.getChannelData(0),
      b = right.getChannelData(0);
    let square = 0;
    for (let i = 0; i < a.length; i++) square += (a[i] - b[i]) ** 2;
    return Math.sqrt(square / a.length);
  }
  const render = async (
    instrument: BrowserInstrument,
    {
      pitch = 69,
      start = 0.1,
      length = 0.4,
      velocity = 1,
      stop,
      laterStop,
      noteOff,
      laterNoteOff,
      disconnect = false,
    }: {
      pitch?: number;
      start?: number;
      length?: number;
      velocity?: number;
      stop?: number;
      laterStop?: number;
      noteOff?: number;
      laterNoteOff?: number;
      disconnect?: boolean;
    } = {},
  ) => {
    const context = new OfflineAudioContext(
      2,
      Math.ceil(1.2 * sampleRate),
      sampleRate,
    );
    const voice = playBrowserNote(
      context,
      context.destination,
      pitch,
      start,
      length,
      velocity,
      instrument,
    );
    if (noteOff !== undefined) voice.release(noteOff);
    if (laterNoteOff !== undefined) voice.release(laterNoteOff);
    if (stop !== undefined) voice.stop(stop);
    if (laterStop !== undefined) voice.stop(laterStop);
    if (disconnect) voice.disconnect();
    return context.startRendering();
  };
  const simple = (id: 'session-wavetable' | 'session-fm') => {
    const state = defaultBrowserInstrument(id);
    Object.assign(state.parameters, {
      attack: 0.001,
      decay: 0.001,
      sustain: 1,
      release: 0.005,
      cutoff: 20000,
      resonance: 0,
      drive: 0,
      level: 0.8,
      modulation: 0,
    });
    if (state.id === 'session-wavetable')
      Object.assign(state.parameters, {
        morph: 0,
        unison: 1,
        detune: 0,
        spread: 0,
      });
    else state.parameters.depth = 0;
    return state;
  };
  try {
    for (const id of ['session-wavetable', 'session-fm'] as const) {
      const normal = await render(defaultBrowserInstrument(id));
      const max = peak(normal);
      metrics[`${id}/peak`] = max;
      check(
        Number.isFinite(max) && max > 0.005 && max <= 0.18 + 1e-6,
        `${id}: finite, audible, bounded output`,
      );
      check(
        peak(normal, 0, 0.099) === 0,
        `${id}: no audio before scheduled note`,
      );
      check(peak(normal, 1, 1.2) === 0, `${id}: no audio after release`);
      const canceled = await render(defaultBrowserInstrument(id), {
        start: 0.25,
        stop: 0,
      });
      check(peak(canceled) === 0, `${id}: cancel before future start`);
      const early = await render(defaultBrowserInstrument(id), {
        stop: 0.16,
        laterStop: 0.3,
      });
      check(
        peak(early, 0.18) === 0,
        `${id}: stop all oscillators/LFOs and never postpone cancellation`,
      );
      check(
        peak(
          await render(defaultBrowserInstrument(id), { disconnect: true }),
        ) === 0,
        `${id}: disconnect mutes future notes`,
      );
      const sine = simple(id),
        soft = await render(sine, { velocity: 0.25 }),
        loud = await render(sine, { velocity: 0.75 });
      const ratio = rms(loud) / rms(soft);
      metrics[`${id}/velocityRatio`] = ratio;
      check(Math.abs(ratio - 3) < 0.01, `${id}: velocity scales output`);
      const releaseSound = simple(id);
      releaseSound.parameters.release = 0.3;
      const scoreRelease = await render(releaseSound, { length: 0.2 }),
        midiRelease = await render(releaseSound, {
          length: 0.8,
          noteOff: 0.3,
          laterNoteOff: 0.5,
        });
      metrics[`${id}/midiReleaseDifference`] = difference(
        scoreRelease,
        midiRelease,
      );
      check(
        metrics[`${id}/midiReleaseDifference`] < 1e-8,
        `${id}: MIDI note-off reproduces the score's configured release`,
      );
      metrics[`${id}/midiReleaseMidpointRms`] = rms(midiRelease, 0.43, 0.47);
      check(
        metrics[`${id}/midiReleaseMidpointRms`] > 0.005,
        `${id}: MIDI release remains audible halfway through its tail`,
      );
      check(
        peak(midiRelease, 0.61) === 0,
        `${id}: MIDI release stops every source after its configured tail`,
      );
      for (const pitch of [36, 60, 69, 81, 96, 127]) {
        const buffer = await render(sine, { pitch }),
          data = buffer.getChannelData(0);
        let crossings = 0;
        for (
          let i = Math.floor(0.15 * sampleRate) + 1;
          i < Math.floor(0.45 * sampleRate);
          i++
        )
          if (data[i - 1] <= 0 && data[i] > 0) crossings++;
        const detected = crossings / 0.3,
          expected = 440 * 2 ** ((pitch - 69) / 12);
        metrics[`${id}/midi${pitch}`] = detected;
        check(
          Math.abs(detected - expected) < Math.max(4, expected * 0.01),
          `${id}: accurate MIDI pitch ${pitch}`,
        );
      }
      for (const preset of BROWSER_INSTRUMENT_PRESETS[id]) {
        const sound = await render(
          validateBrowserInstrument(preset.instrument),
        );
        check(
          peak(sound) <= 0.18 + 1e-6 && rms(sound) > 0.0001,
          `${preset.name}: finite and audible`,
        );
      }
      const extreme = simple(id);
      Object.assign(extreme.parameters, {
        resonance: 1,
        drive: 1,
        level: 1,
        modulation: 1,
        rate: 12,
        release: 0.45,
      });
      if (extreme.id === 'session-wavetable')
        Object.assign(extreme.parameters, {
          unison: 4,
          morph: 1,
          detune: 30,
          spread: 1,
        });
      else Object.assign(extreme.parameters, { ratio: 8, depth: 6 });
      const stressed = await render(extreme);
      check(
        peak(stressed) <= 0.18 + 1e-6,
        `${id}: maximum settings stay finite and bounded`,
      );
      check(
        peak(stressed, 0.96) === 0,
        `${id}: longest release stays within 0.5 second tail`,
      );
    }
    const wave = simple('session-wavetable'),
      baseWave = await render(wave);
    if (wave.id !== 'session-wavetable') throw Error('Expected wavetable');
    wave.parameters.morph = 1;
    const morphDifference = difference(baseWave, await render(wave));
    metrics.morphDifference = morphDifference;
    check(
      morphDifference > 0.01,
      'Harmonic morph audibly changes the rendered wave',
    );
    wave.parameters.unison = 4;
    wave.parameters.detune = 17;
    wave.parameters.spread = 1;
    const stereo = await render(wave),
      left = stereo.getChannelData(0),
      right = stereo.getChannelData(1);
    let separation = 0;
    for (let i = 0; i < left.length; i++)
      separation += (left[i] - right[i]) ** 2;
    metrics.stereoSeparation = Math.sqrt(separation / left.length);
    check(
      metrics.stereoSeparation > 0.001,
      'Stereo unison renders different left and right channels',
    );
    const fm = simple('session-fm'),
      baseFm = await render(fm);
    if (fm.id !== 'session-fm') throw Error('Expected FM');
    fm.parameters.depth = 3;
    metrics.fmDepthDifference = difference(baseFm, await render(fm));
    check(metrics.fmDepthDifference > 0.01, 'FM depth changes operator audio');
    fm.parameters.ratio = 3.5;
    metrics.fmRatioDifference = difference(
      await render({ ...fm, parameters: { ...fm.parameters, ratio: 2 } }),
      await render(fm),
    );
    check(metrics.fmRatioDifference > 0.01, 'FM ratio changes sidebands');
    const roundtrip = validateBrowserInstrument(
      JSON.parse(JSON.stringify(wave)),
    );
    check(
      difference(await render(wave), await render(roundtrip)) < 1e-8,
      'Serialized settings reproduce the same audio',
    );
    return { passed: true, checks, metrics };
  } catch (error) {
    return {
      passed: false,
      checks,
      metrics,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
function App() {
  const [instrument, setInstrument] = useState<BrowserInstrument>(
    defaultBrowserInstrument('session-wavetable'),
  );
  const [result, setResult] = useState<Evidence>();
  const [running, setRunning] = useState(false);
  const [disabled, setDisabled] = useState(false);
  async function runChecks() {
    setRunning(true);
    setResult(undefined);
    const evidence = await verify();
    window.__browserInstrumentResults = evidence;
    setResult(evidence);
    setRunning(false);
  }
  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: 'auto' }}>
      <h1>SESSION browser instrument verification</h1>
      <p>
        Generated audio, original presets, no external files or account data.
      </p>
      <button
        className="button"
        disabled={running}
        onClick={() => void runChecks()}
      >
        Run audio checks
      </button>
      <details open>
        <summary aria-live="polite">
          {result
            ? `${result.passed ? 'PASS' : 'FAIL'}: ${result.checks} numerical audio checks`
            : running
              ? 'Rendering numerical audio checks…'
              : 'Ready to run numerical audio checks'}
        </summary>
        <pre
          id="browser-results"
          aria-label="Browser instrument results"
          style={{ overflowX: 'auto', maxWidth: '100%' }}
        >
          {result
            ? JSON.stringify(result, null, 2)
            : running
              ? 'RUNNING'
              : 'READY'}
        </pre>
      </details>
      <div className="actions">
        <button
          className="button secondary"
          onClick={() =>
            setInstrument(defaultBrowserInstrument('session-wavetable'))
          }
        >
          SESSION Wavetable
        </button>
        <button
          className="button secondary"
          onClick={() => setInstrument(defaultBrowserInstrument('session-fm'))}
        >
          SESSION FM
        </button>
        <button
          className="button secondary"
          aria-pressed={disabled}
          onClick={() => setDisabled((value) => !value)}
        >
          Disable controls
        </button>
      </div>
      <BrowserInstrumentControls
        instrument={instrument}
        onChange={setInstrument}
        disabled={disabled}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
