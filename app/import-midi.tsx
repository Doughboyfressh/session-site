'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Pick } from './helpers';
import { context, playMix, type Arrangement } from '@/lib/audio';
import {
  appendMidi,
  parseMidi,
  MIDI_FILE_LIMIT,
  type MidiDocument,
  type MidiChoice,
} from '@/lib/midi-import';

// An aborted offline render must settle before another import starts preparing
// audio, including when the dialog is closed and reopened in the meantime.
let pendingPreview: Promise<unknown> | null = null;

export default function ImportMidi({
  data,
  start,
  canEdit,
  onAdd,
  onClose,
}: {
  data: Arrangement;
  start: number;
  canEdit: boolean;
  onAdd: (
    document: MidiDocument,
    choices: MidiChoice[],
    offset: number,
    useFileTempo: boolean,
  ) => void;
  onClose: () => void;
}) {
  const [sampleRate] = useState(() => {
    try {
      return context().sampleRate;
    } catch {
      return 48000;
    }
  });
  const [document, setDocument] = useState<MidiDocument | null>(null),
    [filename, setFilename] = useState(''),
    [choices, setChoices] = useState<MidiChoice[]>([]),
    [offset, setOffset] = useState(String(Math.round(start * 100) / 100)),
    [fileTempo, setFileTempo] = useState(false),
    [reading, setReading] = useState(false),
    [preparing, setPreparing] = useState(!!pendingPreview),
    [previewing, setPreviewing] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(true),
    allowed = useRef(canEdit),
    readJob = useRef(0),
    previewJob = useRef<AbortController | null>(null),
    playback = useRef<Awaited<ReturnType<typeof playMix>> | null>(null),
    applying = useRef(false);
  allowed.current = canEdit;
  function stop() {
    previewJob.current?.abort();
    previewJob.current = null;
    playback.current?.stop();
    playback.current = null;
    if (alive.current) setPreviewing(false);
  }
  useEffect(() => {
    alive.current = true;
    void Promise.resolve(pendingPreview).then(() => {
      if (alive.current) setPreparing(false);
    });
    const hide = () => {
      if (globalThis.document.hidden) stop();
    };
    globalThis.document.addEventListener('visibilitychange', hide);
    return () => {
      alive.current = false;
      readJob.current++;
      stop();
      globalThis.document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  useEffect(() => {
    if (!canEdit) {
      readJob.current++;
      setReading(false);
      stop();
    }
  }, [canEdit]);
  function close() {
    readJob.current++;
    stop();
    onClose();
  }
  async function read(file: File) {
    if (!allowed.current) return;
    const job = ++readJob.current;
    stop();
    setDocument(null);
    setChoices([]);
    setError('');
    setFileTempo(false);
    setFilename(file.name);
    setReading(true);
    try {
      if (file.size > MIDI_FILE_LIMIT)
        throw Error('Choose a MIDI file under 2 MB.');
      const buffer = await file.arrayBuffer();
      if (!alive.current || !allowed.current || job !== readJob.current) return;
      const parsed = parseMidi(buffer);
      setDocument(parsed);
      // Start with one usable part so large arrangements never render by default.
      const first = parsed.parts.find((p) => !p.issue);
      setChoices(first ? [{ id: first.id, sound: 'keys' }] : []);
    } catch (e: any) {
      if (alive.current && job === readJob.current)
        setError(e.message || 'Could not read this MIDI file.');
    } finally {
      if (alive.current && job === readJob.current) setReading(false);
    }
  }
  let proposed: Arrangement | null = null,
    issue = '';
  if (document) {
    try {
      if (!offset.trim()) throw Error('Enter an insertion time.');
      proposed = appendMidi(
        data,
        data.bpm,
        document,
        choices,
        Number(offset),
        fileTempo,
        sampleRate,
      );
    } catch (e: any) {
      issue = e.message;
    }
  }
  async function preview() {
    if (previewing) {
      stop();
      return;
    }
    if (!proposed || !allowed.current || pendingPreview) return;
    // Recheck a recreated device context before allocating any preview buffers.
    try {
      appendMidi(
        data,
        data.bpm,
        document!,
        choices,
        Number(offset),
        fileTempo,
        context().sampleRate,
      );
    } catch (e: any) {
      setError(e.message);
      return;
    }
    stop();
    setError('');
    setPreviewing(true);
    setPreparing(true);
    const controller = new AbortController();
    previewJob.current = controller;
    try {
      const preparation = playMix(
        {
          bpm: proposed.bpm,
          tracks: proposed.tracks.slice(data.tracks.length),
        },
        () => {
          if (alive.current && previewJob.current === controller) {
            playback.current = null;
            setPreviewing(false);
          }
        },
        { signal: controller.signal, from: Number(offset) },
      );
      const settled = preparation.then(
        () => undefined,
        () => undefined,
      );
      pendingPreview = settled;
      void settled.then(() => {
        if (pendingPreview === settled) pendingPreview = null;
        if (alive.current) setPreparing(false);
      });
      const player = await preparation;
      if (
        !alive.current ||
        !allowed.current ||
        controller.signal.aborted ||
        previewJob.current !== controller
      )
        player.stop();
      else playback.current = player;
    } catch (e: any) {
      if (alive.current && previewJob.current === controller) {
        setPreviewing(false);
        if (!controller.signal.aborted)
          setError(e.message || 'Could not preview these parts.');
      }
    }
  }
  const change = (fn: () => void) => {
    stop();
    setError('');
    fn();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="form-dialog midi-import-dialog">
        <DialogTitle>Import MIDI file</DialogTitle>
        <DialogDescription>
          Bring melodies and chords into editable instrument tracks. Your
          original file stays on this device.
        </DialogDescription>
        {!canEdit && (
          <p role="alert">
            Editing access ended. Close this review to return to the project.
          </p>
        )}
        <label className="field">
          <span>Choose MIDI file · up to 2 MB</span>
          <input
            aria-label="Choose MIDI file"
            type="file"
            accept=".mid,.midi,audio/midi,audio/x-midi"
            disabled={!canEdit}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void read(file);
            }}
          />
        </label>
        {reading && <p role="status">Reading MIDI file…</p>}
        {preparing && (
          <p role="status">
            Preparing audio… Please wait before previewing again or adding
            parts.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {document && (
          <>
            <p className="midi-import-filename">
              {filename} · {document.parts.length}{' '}
              {document.parts.length === 1 ? 'part' : 'parts'}
            </p>
            <p className="muted">
              Choose a SESSION sound for each part. Original plug-ins and drum
              kits are not reproduced. Preview plays only the selected parts on
              this device.
            </p>
            <fieldset
              disabled={!canEdit || reading}
              className="midi-import-parts"
            >
              {document.parts.map((part) => {
                const chosen = choices.find((c) => c.id === part.id);
                return (
                  <div className="midi-import-part" key={part.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!chosen}
                        disabled={!!part.issue}
                        onChange={(e) =>
                          change(() =>
                            setChoices((list) =>
                              e.target.checked
                                ? [...list, { id: part.id, sound: 'keys' }]
                                : list.filter((c) => c.id !== part.id),
                            ),
                          )
                        }
                      />
                      <span>
                        <strong>{part.name}</strong>
                        <small>
                          Channel {part.channel}
                          {part.port ? ` · Port ${part.port}` : ''} ·{' '}
                          {part.notes.length} notes
                        </small>
                      </span>
                    </label>
                    {part.issue ? (
                      <p>{part.issue}</p>
                    ) : (
                      chosen && (
                        <Pick
                          label={`Sound for ${part.name} channel ${part.channel}`}
                          value={chosen.sound}
                          options={[
                            { value: 'keys', label: 'Keys' },
                            { value: 'bass', label: 'Bass' },
                            { value: 'pad', label: 'Pad' },
                            { value: 'lead', label: 'Lead' },
                            { value: 'pluck', label: 'Pluck' },
                            { value: 'organ', label: 'Organ' },
                            { value: 'bell', label: 'Bell' },
                          ]}
                          onChange={(v) =>
                            change(() =>
                              setChoices((list) =>
                                list.map((c) =>
                                  c.id === part.id
                                    ? { ...c, sound: v as MidiChoice['sound'] }
                                    : c,
                                ),
                              ),
                            )
                          }
                        />
                      )
                    )}
                  </div>
                );
              })}
            </fieldset>
            <fieldset
              disabled={!canEdit || reading}
              className="midi-import-settings"
            >
              <label className="field">
                <span>Insert at (seconds)</span>
                <input
                  type="number"
                  aria-label="Insert at (seconds)"
                  value={offset}
                  min="0"
                  max="299"
                  step="0.01"
                  onChange={(e) => change(() => setOffset(e.target.value))}
                />
              </label>
              <p>
                Project tempo: {data.bpm} BPM · File tempo:{' '}
                {Math.round(document.bpm * 100) / 100} BPM
                {document.variableTempo ? ' with changes' : ''}
              </p>
              {!data.tracks.length &&
                !document.variableTempo &&
                document.bpm >= 40 &&
                document.bpm <= 240 && (
                  <label>
                    <input
                      type="checkbox"
                      checked={fileTempo}
                      onChange={(e) =>
                        change(() => setFileTempo(e.target.checked))
                      }
                    />{' '}
                    Use file tempo for this empty project
                  </label>
                )}
              <p className="muted">
                All parts keep the same starting point, including rests. Notes
                follow {fileTempo ? 'the file’s' : 'your project’s'} tempo.
              </p>
            </fieldset>
            {!!document.warnings.length && (
              <details>
                <summary>Import notes ({document.warnings.length})</summary>
                <ul>
                  {document.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            {issue && <p role="status">{issue}</p>}
            <div className="midi-import-actions">
              <button
                className="button secondary"
                disabled={
                  !canEdit || !proposed || reading || (preparing && !previewing)
                }
                onClick={() => void preview()}
              >
                {previewing ? 'Stop preview' : 'Preview selected parts'}
              </button>
              <button
                className="button primary"
                disabled={!canEdit || !proposed || reading || preparing}
                onClick={() => {
                  if (
                    !allowed.current ||
                    applying.current ||
                    !proposed ||
                    pendingPreview
                  )
                    return;
                  applying.current = true;
                  stop();
                  try {
                    onAdd(document, choices, Number(offset), fileTempo);
                  } catch (e: any) {
                    setError(e.message || 'Could not add MIDI parts.');
                    applying.current = false;
                  }
                }}
              >
                Add {choices.length || ''}{' '}
                {choices.length === 1 ? 'part' : 'parts'} to project
              </button>
            </div>
          </>
        )}
        <button className="button secondary" onClick={close}>
          Cancel import
        </button>
      </DialogContent>
    </Dialog>
  );
}
