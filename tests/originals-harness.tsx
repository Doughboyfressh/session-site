import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  originals,
  originalArrangement,
  ORIGINAL_GENRES,
} from '../lib/originals';
import {
  renderBuffer,
  playMix,
  wav,
  audioCacheStats,
  context,
} from '../lib/audio';
import { changeArrangementTempo } from '../lib/arrangement-tempo';
import { validateArrangement } from '../lib/arrangement-validation';
import { editNotes, applyNotePatch } from '../lib/note-edit';
import SessionApp from '../app/session-app';
import '../app/globals.css';
import '../app/advanced.css';

// Frontend save/reopen fixture; production persistence is tested separately over HTTP.
const originalFetch = window.fetch.bind(window);
let project: {
  id: string;
  revision: number;
  data: import('../lib/audio').Arrangement;
  title: string;
} | null = null;
window.fetch = async (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url === '/api/state')
    return Response.json({
      profile: { id: 'audition', name: 'Audition' },
      tracks: [],
      profiles: [],
      projects: project ? [project] : [],
      rooms: [],
      saved: [],
      follows: [],
      posts: [],
      orders: [],
      trending: [],
      liveRooms: [],
      pulse: { tracks: 0, creators: 0, tracksToday: 0, publicRooms: 0 },
      payments: {},
      unreadNotifications: 0,
    });
  if (url === '/api/action') {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    if (body.action === 'project') {
      project = { ...body, id: 'audition-project', revision: 1 };
      return Response.json({ id: 'audition-project', revision: 1 });
    }
    if (body.action === 'projectRead') return Response.json(project);
    return Response.json({ ok: true });
  }
  return originalFetch(input, init);
};
function audit(buffer: AudioBuffer) {
  let peak = 0,
    sum = 0,
    quiet = 0,
    longestQuiet = 0,
    hash = 2166136261;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const samples = buffer.getChannelData(ch);
    quiet = 0;
    for (let i = 0; i < samples.length; i++) {
      const value = samples[i];
      if (!Number.isFinite(value)) throw Error('Non-finite audio');
      peak = Math.max(peak, Math.abs(value));
      sum += value * value;
      if (Math.abs(value) < 0.00001) quiet++;
      else quiet = 0;
      longestQuiet = Math.max(longestQuiet, quiet);
      if (i % 100 === 0)
        hash = Math.imul(hash ^ Math.round(value * 32767), 16777619) >>> 0;
    }
  }
  const rms = Math.sqrt(sum / (buffer.length * buffer.numberOfChannels));
  if (peak >= 0.999 || rms < 0.002 || longestQuiet / buffer.sampleRate > 2)
    throw Error(
      `Audio audit: peak ${peak}, RMS ${rms}, silence ${longestQuiet / buffer.sampleRate}s`,
    );
  return {
    peak,
    rms,
    silence: longestQuiet / buffer.sampleRate,
    hash,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
  };
}
function App() {
  const [lines, setLines] = useState<
      {
        id: string;
        title: string;
        genre: string;
        preview: ReturnType<typeof audit>;
        full: ReturnType<typeof audit>;
        wav: number;
        cache: ReturnType<typeof audioCacheStats>;
      }[]
    >([]),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('Ready'),
    [showApp, setShowApp] = useState(false);
  const playback = useRef<Awaited<ReturnType<typeof playMix>> | null>(null);
  const controller = useRef<AbortController | null>(null);
  async function preview(id: string) {
    controller.current?.abort();
    playback.current?.stop();
    const c = new AbortController();
    controller.current = c;
    try {
      await context().resume();
      const p = await playMix(
        originalArrangement(id, { preview: true })!,
        undefined,
        { signal: c.signal },
      );
      if (c.signal.aborted) p.stop();
      else {
        playback.current = p;
        setStatus('Playing ' + id);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') setStatus(e.message);
    }
  }
  async function run() {
    setBusy(true);
    setLines([]);
    const hashes = new Set<number>();
    try {
      for (const o of originals) {
        setStatus('Auditing ' + o.title);
        const previewScore = originalArrangement(o.id, { preview: true })!,
          full = originalArrangement(o.id)!;
        const previewAudit = audit(await renderBuffer(previewScore));
        if (hashes.has(previewAudit.hash))
          throw Error('Duplicate rendered preview');
        hashes.add(previewAudit.hash);
        const fullBuffer = await renderBuffer(full),
          fullAudit = audit(fullBuffer);
        if (fullAudit.duration < 90 || fullAudit.duration > 150)
          throw Error('Arrangement length');
        const blob = wav(fullBuffer),
          head = new DataView(await blob.slice(0, 44).arrayBuffer());
        if (
          head.getUint32(24, true) !== 44100 ||
          head.getUint32(40, true) !== fullBuffer.length * 4
        )
          throw Error('WAV header');
        const roundTrip = await new OfflineAudioContext(
          2,
          1,
          44100,
        ).decodeAudioData(await blob.arrayBuffer());
        if (Math.abs(roundTrip.duration - fullBuffer.duration) > 0.001)
          throw Error('WAV duration');
        if (o.variant === 0) {
          const tempo = changeArrangementTempo(full, Math.round(o.bpm * 1.1));
          const changed = audit(await renderBuffer(tempo));
          if (
            Math.abs(
              changed.duration -
                ((fullAudit.duration - 1.8) * o.bpm) / tempo.bpm -
                1.8,
            ) > 0.001
          )
            throw Error('Tempo alignment');
          const stem = full.tracks.find((t) => t.notes)!;
          const edited = applyNotePatch(full, full.bpm, stem, {
            notes: editNotes(stem, full.bpm, [stem.notes![0].id], {
              kind: 'move',
              beats: 0.25,
            }).notes,
          });
          validateArrangement(edited);
          const reopened = JSON.parse(JSON.stringify(edited));
          validateArrangement(reopened);
          audit(await renderBuffer(reopened));
        }
        const cache = audioCacheStats();
        if (cache.bytes > cache.limit) throw Error('Cache overflow');
        setLines((l) => [
          ...l,
          {
            id: o.id,
            title: o.title,
            genre: o.family.genre,
            preview: previewAudit,
            full: fullAudit,
            wav: blob.size,
            cache,
          },
        ]);
        await new Promise((r) => setTimeout(r, 0));
      }
      setStatus(
        'PASS: 48 previews, 48 full arrangements and WAV round trips; 24 tempo/edit/reopen checks',
      );
    } catch (e: unknown) {
      setStatus('FAIL: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <main style={{ padding: 20 }}>
        <h1>SESSION Originals audition</h1>
        <p>
          Two compositions in each of 24 families. Preview buttons use the
          production playback engine.
        </p>
        <div className="actions">
          <button className="button primary" disabled={busy} onClick={run}>
            Audit all 48
          </button>
          <button
            className="button secondary"
            onClick={() => {
              controller.current?.abort();
              playback.current?.stop();
              setStatus('Stopped');
            }}
          >
            Stop audio
          </button>
          <button
            className="button secondary"
            onClick={() => setShowApp(!showApp)}
          >
            Toggle library and Studio
          </button>
        </div>
        <output id="status">{status}</output>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))',
            gap: 12,
            marginTop: 20,
          }}
        >
          {ORIGINAL_GENRES.map((genre) => (
            <section key={genre}>
              <h2>{genre}</h2>
              {originals
                .filter((o) => o.family.genre === genre)
                .map((o) => (
                  <button
                    key={o.id}
                    className="button secondary"
                    onClick={() => preview(o.id)}
                  >
                    {o.title} · {o.bpm}
                  </button>
                ))}
            </section>
          ))}
        </div>
        <pre id="results" style={{ whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(lines, null, 2)}
        </pre>
      </main>
      {showApp && <SessionApp user={{ id: 'audition', name: 'Audition' }} />}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
