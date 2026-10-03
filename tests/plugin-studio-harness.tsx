import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PianoRoll from '@/app/piano-roll';
import ExportAudio from '@/app/export-audio';
import {
  bufferFor,
  defaults,
  playMix,
  type Arrangement,
  type MixerTrack,
} from '@/lib/audio';
import { createAudioExport } from '@/lib/audio-export';
import { validateArrangement } from '@/lib/arrangement-validation';
import { defaultBrowserInstrument } from '@/lib/browser-instruments';
import { pluginFingerprint } from '@/lib/instrument-plugins';
import { companionSnapshot, disconnectCompanion } from '@/lib/plugin-companion';
import '@/app/globals.css';

// This standalone harness owns only synthetic local fixture storage and API responses.
// The actual companion's cross-origin requests pass through unchanged, including pairing.
const prefix = 'session.plugin-studio-fixture.v1.';
const projectId = 'fixture-plugin-project';
type StoredFile = { type: string; purpose: string; base64: string };
type Evidence = {
  passed: boolean;
  checks: number;
  metrics: Record<string, number | string>;
  error?: string;
};
const traffic = { uploads: 0, fileGets: 0, fileHeads: 0, companionRequests: 0 };
const sessions = new Map<
  string,
  { purpose: string; name: string; parts: Blob[] }
>();
let files: Record<string, StoredFile> = {};
try {
  files = JSON.parse(localStorage.getItem(prefix + 'files') || '{}');
} catch {}
const originalFetch = window.fetch.bind(window);
function bytesBase64(bytes: Uint8Array) {
  let text = '';
  for (let at = 0; at < bytes.length; at += 8192)
    text += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(text);
}
function base64Bytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
async function storeFile(blob: Blob, purpose: string) {
  if (blob.size > 4 * 1024 * 1024)
    throw Error('Keep this local fixture upload within 4 MB.');
  const id = 'fixture-plugin-' + crypto.randomUUID();
  files[id] = {
    type: blob.type || (purpose === 'audio' ? 'audio/wav' : 'application/json'),
    purpose,
    base64: bytesBase64(new Uint8Array(await blob.arrayBuffer())),
  };
  try {
    localStorage.setItem(prefix + 'files', JSON.stringify(files));
  } catch (error) {
    delete files[id];
    throw error;
  }
  traffic.uploads++;
  return { id };
}
window.fetch = async (input, init) => {
  const request = new Request(
    input instanceof Request ? input : new URL(String(input), location.href),
    init,
  );
  const url = new URL(request.url);
  if (url.origin === 'http://127.0.0.1:17341') {
    traffic.companionRequests++;
    return originalFetch(input, init);
  }
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/'))
    return originalFetch(input, init);
  if (
    !['localhost', '127.0.0.1'].includes(location.hostname) ||
    location.port !== '4184'
  )
    return json(
      { error: 'Run these synthetic API fixtures only on localhost:4184.' },
      403,
    );
  if (request.signal.aborted)
    throw new DOMException('Fixture request cancelled.', 'AbortError');
  try {
    if (url.pathname.startsWith('/api/file/')) {
      const id = url.pathname.slice('/api/file/'.length),
        file = files[id];
      if (!id.startsWith('fixture-plugin-') || !file)
        return json({ error: 'Fixture file is private or missing.' }, 404);
      const bytes = base64Bytes(file.base64);
      if (request.method === 'HEAD') traffic.fileHeads++;
      else traffic.fileGets++;
      return new Response(request.method === 'HEAD' ? null : bytes, {
        headers: {
          'Content-Type': file.type,
          'Content-Length': String(bytes.byteLength),
          'Cache-Control': 'private, no-store',
        },
      });
    }
    if (url.pathname === '/api/upload' && request.method === 'POST') {
      const body = await request.formData(),
        file = body.get('file'),
        purpose = body.get('purpose');
      if (
        !(file instanceof Blob) ||
        body.get('projectId') !== projectId ||
        typeof purpose !== 'string' ||
        !['audio', 'plugin-state'].includes(purpose)
      )
        return json({ error: 'Use this fixture project only.' }, 403);
      return json(await storeFile(file, purpose));
    }
    if (url.pathname === '/api/upload-session') {
      if (request.method === 'PUT') {
        const session = sessions.get(url.searchParams.get('id') || '');
        const part = Number(url.searchParams.get('part'));
        if (!session || !Number.isInteger(part) || part < 0 || part > 8)
          return json({ error: 'Missing fixture upload.' }, 404);
        session.parts[part] = await request.blob();
        return json({ ok: true });
      }
      const body = (await request.json()) as Record<string, unknown>;
      if (body.operation === 'start') {
        if (
          body.projectId !== projectId ||
          typeof body.purpose !== 'string' ||
          !['audio', 'plugin-state'].includes(body.purpose) ||
          typeof body.name !== 'string' ||
          typeof body.size !== 'number' ||
          !Number.isFinite(body.size) ||
          body.size <= 0 ||
          body.size > 4 * 1024 * 1024
        )
          return json(
            {
              error:
                'Use a synthetic file within 4 MB in this fixture project.',
            },
            403,
          );
        const id = 'fixture-upload-' + crypto.randomUUID(),
          chunkSize = 1024 * 1024;
        sessions.set(id, { purpose: body.purpose, name: body.name, parts: [] });
        return json({ id, chunkSize, parts: Math.ceil(body.size / chunkSize) });
      }
      const sessionId = typeof body.id === 'string' ? body.id : '';
      const session = sessions.get(sessionId);
      if (body.operation === 'cancel') {
        sessions.delete(sessionId);
        return json({ ok: true });
      }
      if (body.operation === 'complete' && session) {
        sessions.delete(sessionId);
        return json(
          await storeFile(
            new Blob(session.parts, {
              type:
                session.purpose === 'audio' ? 'audio/wav' : 'application/json',
            }),
            session.purpose,
          ),
        );
      }
    }
    // No production action, credential or user file route is exercised by this harness.
    return json(
      {
        error:
          'This standalone harness accepts only fixture file and upload routes.',
      },
      409,
    );
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
};

function seed(): Arrangement {
  return {
    bpm: 120,
    tracks: [
      {
        ...defaults('Plugin integration fixture'),
        id: 'fixture-instrument-track',
        plugin: defaultBrowserInstrument('session-wavetable'),
        noteLoopBeats: 8,
        notes: [
          {
            id: 'fixture-note-a',
            pitch: 60,
            start: 1,
            length: 0.75,
            velocity: 0.75,
          },
          {
            id: 'fixture-note-b',
            pitch: 64,
            start: 3,
            length: 0.75,
            velocity: 0.65,
          },
          {
            id: 'fixture-note-c',
            pitch: 67,
            start: 5,
            length: 1,
            velocity: 0.8,
          },
        ],
      },
    ],
  };
}
function loadSaved() {
  const value = JSON.parse(
    localStorage.getItem(prefix + 'project') || 'null',
  ) as Arrangement | null;
  if (!value) throw Error('Save this synthetic fixture before reopening.');
  validateArrangement(value);
  return value;
}
function initial() {
  try {
    return loadSaved();
  } catch {
    return seed();
  }
}
function audioMetrics(buffer: AudioBuffer) {
  let peak = 0,
    square = 0,
    first = -1;
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i]))
      throw Error('Audio contained a non-finite sample.');
    peak = Math.max(peak, Math.abs(data[i]));
    square += data[i] ** 2;
    if (first < 0 && Math.abs(data[i]) > 1e-5) first = i / buffer.sampleRate;
  }
  return {
    peak,
    rms: Math.sqrt(square / data.length),
    first,
    seconds: buffer.duration,
  };
}
function difference(a: AudioBuffer, b: AudioBuffer) {
  const left = a.getChannelData(0),
    right = b.getChannelData(0);
  if (left.length !== right.length) return Infinity;
  let square = 0;
  for (let i = 0; i < left.length; i++) square += (left[i] - right[i]) ** 2;
  return Math.sqrt(square / left.length);
}
const exportOptions = (data: Arrangement) => ({
  kind: 'mix' as const,
  sampleRate: 44100 as const,
  depth: 16 as const,
  processing: 'processed' as const,
  trackIds: data.tracks.map((track) => track.id),
  tail: 0.5,
  gainDb: 0,
  dither: false,
  includeMix: true,
  master: 'off' as const,
});
async function exported(data: Arrangement) {
  return createAudioExport(
    'Synthetic plugin fixture',
    data,
    exportOptions(data),
  );
}
async function waveValid(blob: Blob) {
  const bytes = await blob.arrayBuffer(),
    view = new DataView(bytes);
  const text = (at: number) =>
    String.fromCharCode(...new Uint8Array(bytes, at, 4));
  return (
    bytes.byteLength > 44 &&
    text(0) === 'RIFF' &&
    text(8) === 'WAVE' &&
    view.getUint16(22, true) === 2 &&
    view.getUint32(24, true) === 44100 &&
    view.getUint16(34, true) === 16
  );
}
function suite() {
  let checks = 0;
  const metrics: Evidence['metrics'] = {};
  return {
    metrics,
    check(condition: boolean, message: string) {
      checks++;
      if (!condition) throw Error(message);
    },
    result(error?: unknown): Evidence {
      return {
        passed: error === undefined,
        checks,
        metrics,
        ...(error === undefined
          ? {}
          : {
              error:
                error instanceof Error
                  ? error.message
                  : 'Fixture operation failed.',
            }),
      };
    },
  };
}

function App() {
  const [data, setData] = useState<Arrangement>(initial),
    [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(''),
    [message, setMessage] = useState('');
  const [results, setResults] = useState<Record<string, Evidence>>({});
  const [exportSnapshot, setExportSnapshot] = useState<Arrangement>();
  const [download, setDownload] = useState<{ url: string; name: string }>();
  const [playing, setPlaying] = useState(false),
    [activity, setActivity] = useState(false);
  const [stats, setStats] = useState({
    engineEdits: 0,
    parameterEdits: 0,
    noteEdits: 0,
    tempoEdits: 0,
  });
  const playback = useRef<Awaited<ReturnType<typeof playMix>> | undefined>(
    undefined,
  );
  const alive = useRef(false),
    playEpoch = useRef(0);
  const disposePlayback = useCallback(() => {
    alive.current = false;
    playEpoch.current++;
    playback.current?.stop();
  }, []);
  useEffect(() => {
    alive.current = true;
    return disposePlayback;
  }, [disposePlayback]);
  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download.url);
    },
    [download],
  );
  const track = data.tracks[0];
  function changeTrack(changes: Partial<MixerTrack>) {
    let engine = false,
      parameter = false;
    if (changes.plugin) {
      const prior = track.plugin;
      if (
        !prior ||
        prior.format !== changes.plugin.format ||
        (prior.format === 'browser' &&
          changes.plugin.format === 'browser' &&
          prior.id !== changes.plugin.id)
      )
        engine = true;
      else if (JSON.stringify(prior) !== JSON.stringify(changes.plugin))
        parameter = true;
    }
    setStats((prior) => ({
      ...prior,
      engineEdits: prior.engineEdits + Number(engine),
      parameterEdits: prior.parameterEdits + Number(parameter),
      noteEdits: prior.noteEdits + Number(!!changes.notes),
    }));
    setData((previous) => ({
      ...previous,
      tracks: [{ ...previous.tracks[0], ...changes }],
    }));
  }
  function save() {
    validateArrangement(data);
    localStorage.setItem(prefix + 'project', JSON.stringify(data));
    setMessage(
      'Synthetic project saved locally, including plugin settings, notes, tempo and frozen-file references.',
    );
  }
  function reopen() {
    disconnectCompanion();
    setData(loadSaved());
    setGeneration((value) => value + 1);
    setMessage(
      'Saved fixture reopened with the companion disconnected. Refresh also restores this fixture.',
    );
  }
  async function run(
    name: string,
    operation: (test: ReturnType<typeof suite>) => Promise<void>,
  ) {
    if (busy || exportSnapshot) return;
    const test = suite();
    setBusy(name);
    setMessage('');
    try {
      await operation(test);
      setResults((prior) => ({ ...prior, [name]: test.result() }));
    } catch (error) {
      setResults((prior) => ({ ...prior, [name]: test.result(error) }));
    } finally {
      setBusy('');
    }
  }
  const browserChecks = () =>
    run('Browser integration', async (test) => {
      test.check(
        document.querySelectorAll('[data-fixture-piano-roll]').length === 1,
        'StrictMode must retain one editor panel.',
      );
      for (const id of ['session-wavetable', 'session-fm'] as const) {
        const arrangement = seed();
        arrangement.tracks[0].plugin = defaultBrowserInstrument(id);
        validateArrangement(arrangement);
        const before = await bufferFor(arrangement.tracks[0], 120),
          normal = audioMetrics(before);
        test.metrics[id + '/peak'] = normal.peak;
        test.metrics[id + '/onset120'] = normal.first;
        test.check(
          normal.peak > 0.005 && normal.peak < 1 && normal.rms > 0.001,
          id + ': actual Studio buffer is audible, finite and unclipped.',
        );
        test.check(
          Math.abs(normal.seconds - 4.5) < 1 / 44100,
          id + ': score loop and release tail reach Studio.',
        );
        test.check(
          Math.abs(normal.first - 0.5) < 0.02,
          id + ': score beat timing reaches the synth.',
        );
        const faster = audioMetrics(
          await bufferFor(arrangement.tracks[0], 180),
        );
        test.metrics[id + '/onset180'] = faster.first;
        test.check(
          Math.abs(faster.first - 1 / 3) < 0.02 &&
            faster.seconds < normal.seconds,
          id + ': tempo changes rebuild score audio.',
        );
        const plugin = arrangement.tracks[0].plugin!;
        if (plugin.format !== 'browser') throw Error('Expected browser synth.');
        if (plugin.id === 'session-wavetable') plugin.parameters.morph = 1;
        else plugin.parameters.depth = 5;
        const edited = await bufferFor(arrangement.tracks[0], 120);
        test.metrics[id + '/controlDifference'] = difference(before, edited);
        test.check(
          Number(test.metrics[id + '/controlDifference']) > 0.001,
          id + ': plugin edits invalidate the actual Studio audio cache.',
        );
        localStorage.setItem(prefix + 'roundtrip', JSON.stringify(arrangement));
        const saved = JSON.parse(
          localStorage.getItem(prefix + 'roundtrip')!,
        ) as Arrangement;
        validateArrangement(saved);
        test.check(
          JSON.stringify(saved) === JSON.stringify(arrangement),
          id + ': notes, tempo and plugin state survive fixture save/reopen.',
        );
        test.check(
          difference(edited, await bufferFor(saved.tracks[0], saved.bpm)) <
            1e-8,
          id + ': reopened Studio audio matches the edited sound.',
        );
        const wav = await exported(saved);
        test.metrics[id + '/wavBytes'] = wav.blob.size;
        test.check(
          await waveValid(wav.blob),
          id + ': real export emits stereo 44.1kHz 16-bit WAV.',
        );
        test.check(
          wav.peak > 0.001 && wav.peak < 1,
          id + ': real mixer/export preserves audible unclipped sound.',
        );
      }
    });
  const editedChecks = () =>
    run('Editor fixture', async (test) => {
      for (const [key, value] of Object.entries(stats)) {
        test.metrics[key] = value;
        test.check(
          value > 0,
          'Use the real editor to change ' + key + ' first.',
        );
      }
      test.check(
        track.plugin?.format === 'browser',
        'Choose a SESSION browser plugin for these editor checks.',
      );
      validateArrangement(data);
      save();
      const restored = loadSaved();
      test.check(
        JSON.stringify(restored) === JSON.stringify(data),
        'The saved fixture retains every editor change.',
      );
      const prior = await bufferFor(track, data.bpm),
        reopened = await bufferFor(restored.tracks[0], restored.bpm);
      test.check(
        difference(prior, reopened) < 1e-8,
        'Saved/reopened editor score sounds identical.',
      );
      const wav = await exported(restored);
      test.check(
        (await waveValid(wav.blob)) && wav.peak > 0.001 && wav.peak < 1,
        'Edited score exports through the real WAV pipeline.',
      );
      setData(restored);
      setGeneration((value) => value + 1);
      setDownload({ url: URL.createObjectURL(wav.blob), name: wav.name });
      setMessage(
        'Edited fixture saved, reopened and exported. Download the synthetic WAV below.',
      );
    });
  const freezeChecks = () =>
    run('Disconnected native freeze', async (test) => {
      const plugin = track.plugin;
      test.check(
        plugin?.format === 'vst3' && !!plugin.freeze,
        'Choose the actual SDK instrument and Render for collaborators first.',
      );
      if (plugin?.format !== 'vst3' || !plugin.freeze)
        throw Error('Missing native freeze.');
      test.check(
        plugin.freeze.fingerprint ===
          (await pluginFingerprint(track, data.bpm)),
        'Rendered audio matches the current native score and tempo.',
      );
      test.check(
        !!files[plugin.freeze.fileId],
        'Private fixture WAV survives page reload in localStorage.',
      );
      disconnectCompanion();
      test.check(
        !companionSnapshot().connected,
        'Companion is disconnected before playback/export.',
      );
      const bridgeBefore = traffic.companionRequests,
        readsBefore = traffic.fileGets + traffic.fileHeads;
      const sound = audioMetrics(
        await bufferFor(track, data.bpm, { revalidate: true }),
      );
      test.metrics.peak = sound.peak;
      test.metrics.seconds = sound.seconds;
      test.check(
        sound.peak > 0.001 && sound.peak < 1 && sound.rms > 0.0001,
        'Disconnected Studio loads audible finite native-rendered audio.',
      );
      const wav = await exported(data);
      test.metrics.wavBytes = wav.blob.size;
      test.check(
        await waveValid(wav.blob),
        'Disconnected native score exports a real stereo WAV.',
      );
      test.check(
        wav.peak > 0.0001 && wav.peak < 1,
        'Disconnected native export remains audible and unclipped.',
      );
      test.check(
        traffic.companionRequests === bridgeBefore,
        'Frozen playback/export makes no companion request.',
      );
      test.check(
        traffic.fileGets + traffic.fileHeads > readsBefore,
        'Frozen playback/export revalidates its private fixture file.',
      );
      save();
      test.check(
        JSON.stringify(loadSaved()) === JSON.stringify(data),
        'Native state and frozen audio reference survive save/reopen.',
      );
      const unavailable = async (candidate: MixerTrack, bpm = data.bpm) => {
        validateArrangement({ bpm, tracks: [candidate] });
        try {
          await bufferFor(candidate, bpm, { revalidate: true });
          return '';
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          return error.message;
        }
      };
      const ownedFile = files[plugin.freeze.fileId];
      let revokedError = '';
      try {
        delete files[plugin.freeze.fileId];
        revokedError = await unavailable(track);
      } finally {
        files[plugin.freeze.fileId] = ownedFile;
      }
      test.metrics.revokedCacheError = revokedError;
      test.check(
        /private|available/i.test(revokedError),
        'A cached native freeze is rejected when its private fixture-file access is revoked.',
      );
      test.check(
        audioMetrics(await bufferFor(track, data.bpm)).peak > 0.001,
        'Restoring fixture-file access makes the cached freeze playable again.',
      );
      const decoded44100 = await bufferFor(track, data.bpm, {
          sampleRate: 44100,
        }),
        decoded48000 = await bufferFor(track, data.bpm, { sampleRate: 48000 });
      test.metrics.frames44100 = decoded44100.length;
      test.metrics.frames48000 = decoded48000.length;
      test.check(
        decoded44100.sampleRate === 44100 &&
          decoded48000.sampleRate === 48000 &&
          audioMetrics(decoded44100).peak > 0.001 &&
          audioMetrics(decoded48000).peak > 0.001,
        'The actual native freeze decodes audibly at both requested sample rates.',
      );
      test.check(
        decoded44100 !== decoded48000 &&
          (await bufferFor(track, data.bpm, { sampleRate: 44100 })) ===
            decoded44100 &&
          (await bufferFor(track, data.bpm, { sampleRate: 48000 })) ===
            decoded48000,
        'Sample-rate cache entries remain distinct and reuse their own decoded buffers.',
      );
      const staleNotes: MixerTrack = {
        ...track,
        notes: track.notes!.map((note, index) =>
          index === 0 ? { ...note, pitch: (note.pitch + 1) % 128 } : note,
        ),
      };
      test.check(
        (await pluginFingerprint(staleNotes, data.bpm)) !==
          plugin.freeze.fingerprint,
        'Changing a note invalidates the native freeze fingerprint.',
      );
      const noteError = await unavailable(staleNotes);
      test.metrics.staleNoteError = noteError;
      test.check(
        /connect|private|available/i.test(noteError),
        'Changed notes require a companion instead of returning old frozen audio.',
      );
      const changedTempo = data.bpm === 240 ? 239 : data.bpm + 1;
      test.check(
        (await pluginFingerprint(track, changedTempo)) !==
          plugin.freeze.fingerprint,
        'Changing tempo invalidates the native freeze fingerprint.',
      );
      const tempoError = await unavailable(track, changedTempo);
      test.metrics.staleTempoError = tempoError;
      test.check(
        /connect|private|available/i.test(tempoError),
        'Changed tempo requires a companion instead of returning old frozen audio.',
      );
      const staleState: MixerTrack = {
        ...track,
        plugin: { ...plugin, stateFileId: 'fixture-plugin-unavailable-state' },
      };
      test.check(
        (await pluginFingerprint(staleState, data.bpm)) !==
          plugin.freeze.fingerprint,
        'Changing saved instrument state invalidates the native freeze fingerprint.',
      );
      const stateError = await unavailable(staleState);
      test.metrics.staleStateError = stateError;
      test.check(
        /connect|private|available/i.test(stateError) &&
          traffic.companionRequests === bridgeBefore,
        'Changed state rejects old audio, and all disconnected checks avoid companion requests.',
      );
      setDownload({ url: URL.createObjectURL(wav.blob), name: wav.name });
      setMessage(
        'Native freeze verified without the companion. Refresh this page, then run this check again to prove persistence with a fresh audio cache.',
      );
    });
  async function play() {
    if (playing) {
      playEpoch.current++;
      playback.current?.stop();
      setPlaying(false);
      return;
    }
    const epoch = ++playEpoch.current;
    setBusy('Loading playback');
    try {
      const next = await playMix(data, () => {
        if (alive.current && epoch === playEpoch.current) setPlaying(false);
      });
      if (!alive.current || epoch !== playEpoch.current) {
        next.stop();
        return;
      }
      playback.current = next;
      setPlaying(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (alive.current) setBusy('');
    }
  }
  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: 'auto' }}>
      <h1>SESSION plugin editor integration fixtures</h1>
      <p>
        This page uses the real PianoRoll, plugin controls, playback and export
        under React StrictMode. All saved projects and same-origin uploads are
        synthetic fixtures in this tab’s localStorage. Run on localhost:4184.
      </p>
      <ol>
        <li>
          Run browser integration checks. In Instrument engine choose SESSION
          FM, change FM depth, click Add note and change Fixture tempo. Then
          Verify edited fixture.
        </li>
        <li>
          Use Play fixture to audition. Open real WAV export, then Prepare
          export to verify the actual export dialog.
        </li>
        <li>
          Optional native proof: expand Connect installed VST3 instruments,
          paste the ephemeral fixture pairing code, connect, choose Note
          Expression Synth and Render for collaborators.
        </li>
        <li>
          Verify disconnected freeze and save. Refresh this page; run it again
          and audition/export while disconnected. No pairing code is persisted.
        </li>
      </ol>
      <div className="actions">
        <button
          className="button"
          disabled={!!busy || playing || activity}
          onClick={() => void browserChecks()}
        >
          Run browser integration checks
        </button>
        <button
          className="button"
          disabled={!!busy || playing || activity}
          onClick={() => void editedChecks()}
        >
          Verify edited fixture
        </button>
        <button
          className="button"
          disabled={!!busy || playing || activity}
          onClick={() => void freezeChecks()}
        >
          Verify disconnected freeze and save
        </button>
        <button
          className="button secondary"
          disabled={!!busy || activity}
          onClick={() => void play()}
        >
          {playing ? 'Stop fixture' : 'Play fixture'}
        </button>
        <button
          className="button secondary"
          disabled={!!busy || playing || activity}
          onClick={() => setExportSnapshot(structuredClone(data))}
        >
          Open real WAV export
        </button>
        <button
          className="button secondary"
          disabled={!!busy || playing || activity}
          onClick={save}
        >
          Save fixture
        </button>
        <button
          className="button secondary"
          disabled={!!busy || playing || activity}
          onClick={reopen}
        >
          Reopen fixture
        </button>
        <button
          className="button secondary"
          disabled={!!busy || playing || activity}
          onClick={() => {
            disconnectCompanion();
            for (const suffix of ['files', 'project', 'roundtrip'])
              localStorage.removeItem(prefix + suffix);
            files = {};
            sessions.clear();
            setStats({
              engineEdits: 0,
              parameterEdits: 0,
              noteEdits: 0,
              tempoEdits: 0,
            });
            setData(seed());
            setResults({});
            setDownload(undefined);
            setGeneration((value) => value + 1);
            setMessage('Only this harness’s synthetic fixture data was reset.');
          }}
        >
          Reset synthetic fixture
        </button>
      </div>
      <label className="field">
        <span>Fixture tempo</span>
        <input
          type="number"
          min={40}
          max={240}
          value={data.bpm}
          disabled={!!busy || playing || activity}
          onChange={(event) => {
            const bpm = Number(event.target.value);
            if (bpm >= 40 && bpm <= 240) {
              setStats((prior) => ({
                ...prior,
                tempoEdits: prior.tempoEdits + 1,
              }));
              setData((prior) => ({ ...prior, bpm }));
            }
          }}
        />
      </label>
      <output aria-live="polite">
        {busy || message || 'Ready. Fixture save is local; no account is used.'}
      </output>
      {download && (
        <a className="button" href={download.url} download={download.name}>
          Download verified fixture WAV
        </a>
      )}
      <section aria-label="Visible verification evidence">
        <h2>Results</h2>
        <pre
          id="plugin-studio-results"
          style={{ maxWidth: '100%', overflowX: 'auto' }}
        >
          {JSON.stringify(
            {
              results,
              editorChanges: stats,
              traffic,
              fixtureFiles: Object.keys(files).length,
              current: {
                bpm: data.bpm,
                notes: track.notes?.length,
                plugin: track.plugin,
                companionConnected: companionSnapshot().connected,
              },
            },
            null,
            2,
          )}
        </pre>
      </section>
      <div data-fixture-piano-roll>
        <PianoRoll
          key={generation}
          track={track}
          bpm={data.bpm}
          onChange={changeTrack}
          onAdd={() => {}}
          projectId={projectId}
          disabled={!!busy || playing || !!exportSnapshot}
          onGestureActivity={setActivity}
        />
      </div>
      {exportSnapshot && (
        <ExportAudio
          title="Synthetic plugin fixture"
          data={exportSnapshot}
          onClose={() => setExportSnapshot(undefined)}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
