'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Pick, Confirm } from './helpers';
import { midiPlan, quantizeMidi, type MidiPlan } from '@/lib/midi-notes';
import {
  MidiRecorder,
  type MidiHooks,
  type MidiPhase,
} from '@/lib/midi-recording';
import {
  playMix,
  midiFile,
  download,
  type Arrangement,
  type MixerTrack,
  type Note,
  type StudioOutput,
} from '@/lib/audio';
import { noteName } from './piano-roll';

export default function RecordMidi({
  data,
  target,
  start,
  canEdit,
  onKeep,
  onClose,
  output,
  createRecorder,
}: {
  data: Arrangement;
  target: MixerTrack;
  start: number;
  canEdit: boolean;
  onKeep: (notes: Note[]) => void;
  onClose: () => void;
  output?: StudioOutput;
  createRecorder?: (hooks: MidiHooks, target: MixerTrack) => MidiRecorder;
}) {
  const [phase, setPhase] = useState<MidiPhase>('idle'),
    [ports, setPorts] = useState<{ id: string; name: string }[]>([]),
    [selected, setSelected] = useState(''),
    [error, setError] = useState(''),
    [startBeat, setStartBeat] = useState(String(start + 1)),
    [beats, setBeats] = useState(
      String(
        Math.min(
          8,
          (target.noteLoopBeats ?? 256) - start,
          ((300 - target.offset) * data.bpm) / 60 - start,
        ),
      ),
    ),
    [countIn, setCountIn] = useState('1'),
    [elapsed, setElapsed] = useState(0),
    [count, setCount] = useState(0),
    [lastPitch, setLastPitch] = useState(-1),
    [notes, setNotes] = useState<Note[]>([]),
    [plan, setPlan] = useState<MidiPlan | null>(null),
    [snap, setSnap] = useState('0'),
    [confirm, setConfirm] = useState(false),
    [previewing, setPreviewing] = useState(false),
    [supported, setSupported] = useState(true);
  const capture = useRef<MidiRecorder | null>(null),
    alive = useRef(true),
    allowed = useRef(canEdit),
    applying = useRef(false),
    preview = useRef<Awaited<ReturnType<typeof playMix>> | null>(null),
    previewJob = useRef<AbortController | null>(null);
  allowed.current = canEdit;
  useEffect(() => {
    alive.current = true;
    setSupported(
      !!createRecorder || typeof navigator.requestMIDIAccess === 'function',
    );
    const hooks: MidiHooks = {
      state: (p) => {
        if (alive.current) setPhase(p);
      },
      inputs: (list, id) => {
        if (alive.current) {
          setPorts(list);
          setSelected(id);
        }
      },
      progress: (at, n) => {
        if (alive.current) {
          setElapsed(at);
          setCount(n);
        }
      },
      activity: (pitch) => {
        if (alive.current) setLastPitch(pitch);
      },
      take: (result) => {
        if (alive.current) setNotes(result);
      },
      error: (message) => {
        if (alive.current) setError(message);
      },
    };
    capture.current = createRecorder
      ? createRecorder(hooks, target)
      : new MidiRecorder(hooks, target, { output });
    const hidden = () => {
      if (document.hidden)
        capture.current?.interrupt(
          'Recording paused because this page was hidden. Review the notes received so far.',
        );
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', hidden);
      capture.current?.dispose();
      previewJob.current?.abort();
      preview.current?.stop();
    };
  }, []);
  useEffect(() => {
    if (!canEdit) {
      capture.current?.interrupt(
        'Editing access ended. You can download your recorded notes.',
      );
      stopPreview();
    }
  }, [canEdit]);
  const active = ['preparing', 'counting', 'recording'].includes(phase);
  const locked = active || phase === 'opening' || phase === 'review';
  let nextPlan: MidiPlan | null = null,
    issue = '';
  try {
    nextPlan = midiPlan(target, data.bpm, Number(startBeat) - 1, Number(beats));
  } catch (e) {
    issue = e instanceof Error ? e.message : 'Choose a recording range.';
  }
  const chosen = plan ? quantizeMidi(notes, Number(snap), plan) : notes;
  function stopPreview() {
    previewJob.current?.abort();
    preview.current?.stop();
    preview.current = null;
    setPreviewing(false);
  }
  function close() {
    if (active || notes.length) setConfirm(true);
    else onClose();
  }
  async function listen() {
    if (previewing) {
      stopPreview();
      return;
    }
    stopPreview();
    setPreviewing(true);
    setError('');
    const controller = new AbortController();
    previewJob.current = controller;
    try {
      const player = await playMix(
        {
          bpm: data.bpm,
          tracks: [
            {
              ...target,
              notes: chosen,
              duration: undefined,
              peaks: undefined,
              muted: false,
              solo: false,
            },
          ],
        },
        () => {
          if (alive.current) setPreviewing(false);
        },
        { from: plan!.timeline, signal: controller.signal },
      );
      if (!alive.current || controller.signal.aborted) {
        player.stop();
        return;
      }
      preview.current = player;
    } catch (e) {
      if (alive.current && !controller.signal.aborted) {
        setPreviewing(false);
        setError(e instanceof Error ? e.message : 'Preview failed.');
      }
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent className="record-dialog midi-record-dialog">
          <DialogTitle>Record MIDI · {target.name}</DialogTitle>
          <DialogDescription>
            Play your keyboard with the project, then review the notes before
            adding them.
          </DialogDescription>
          <p>
            {data.bpm} BPM · {target.notes!.length} existing{' '}
            {target.notes!.length === 1 ? 'note' : 'notes'} ·{' '}
            {256 - target.notes!.length} note spaces left
          </p>
          {!supported && (
            <p role="status">
              MIDI keyboards are not supported in this browser. You can still
              add and edit notes in the piano roll.
            </p>
          )}
          {phase !== 'review' && (
            <>
              <fieldset className="piano-tools" disabled={locked || !canEdit}>
                <Pick
                  label="MIDI input"
                  value={selected}
                  onChange={(id) => {
                    setError('');
                    void capture.current?.select(id);
                  }}
                  options={
                    ports.length
                      ? [
                          { value: '', label: 'Choose a keyboard' },
                          ...ports.map((p) => ({ value: p.id, label: p.name })),
                        ]
                      : [{ value: '', label: 'No keyboard connected' }]
                  }
                />
                <label className="field">
                  <span>Start beat (from 1)</span>
                  <input
                    aria-label="MIDI start beat"
                    type="number"
                    min="1"
                    max="256"
                    step="0.25"
                    disabled={locked || !canEdit}
                    value={startBeat}
                    onChange={(e) => setStartBeat(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Length in beats</span>
                  <input
                    aria-label="MIDI recording length"
                    type="number"
                    min="0.25"
                    max="32"
                    step="0.25"
                    disabled={locked || !canEdit}
                    value={beats}
                    onChange={(e) => setBeats(e.target.value)}
                  />
                </label>
                <Pick
                  label="MIDI count-in"
                  value={countIn}
                  onChange={setCountIn}
                  options={[
                    { value: '0', label: 'No count-in' },
                    { value: '1', label: '1 bar · 4 beats' },
                    { value: '2', label: '2 bars · 8 beats' },
                  ]}
                />
              </fieldset>
              {!active && issue && <p role="status">{issue}</p>}
              {phase === 'ready' && !ports.length && (
                <p role="status">
                  Connect a MIDI keyboard, then choose it above. The device list
                  updates automatically.
                </p>
              )}
              <p className="midi-live-status" role="status">
                {phase === 'opening'
                  ? 'Connecting keyboard…'
                  : phase === 'preparing'
                    ? 'Preparing backing tracks…'
                    : phase === 'counting'
                      ? `Count-in · ${Math.max(1, Math.ceil(-elapsed))} beats`
                      : phase === 'recording'
                        ? `Recording · beat ${(elapsed + 1).toFixed(1)} · ${count} notes`
                        : phase === 'ready'
                          ? lastPitch >= 0
                            ? `Keyboard ready · ${noteName(lastPitch)}`
                            : 'Keyboard ready · play a note to hear your instrument'
                          : 'Keyboard is off'}
              </p>
              <div className="actions">
                {!active && (
                  <button
                    className="button secondary"
                    disabled={!supported || !canEdit || phase === 'opening'}
                    onClick={() => {
                      setError('');
                      void capture.current?.connect();
                    }}
                  >
                    {phase === 'ready'
                      ? 'Reconnect MIDI keyboard'
                      : 'Connect MIDI keyboard'}
                  </button>
                )}
                {active ? (
                  <button
                    className="button primary"
                    onClick={() => capture.current?.finish()}
                  >
                    Stop MIDI recording
                  </button>
                ) : (
                  <button
                    className="button primary"
                    disabled={
                      !canEdit || phase !== 'ready' || !selected || !nextPlan
                    }
                    onClick={() => {
                      if (!nextPlan) return;
                      setPlan(nextPlan);
                      setError('');
                      void capture.current
                        ?.start(data, nextPlan, Number(countIn))
                        .catch((e) => setError(e.message));
                    }}
                  >
                    Start MIDI recording
                  </button>
                )}
              </div>
              <p className="small-note">
                Play after the count-in. Notes, velocity, and sustain-pedal
                length are captured. Your keyboard preview uses this
                instrument’s channel settings. MIDI access reads keyboard input;
                it does not record a microphone.
              </p>
            </>
          )}
          {phase === 'review' && (
            <>
              <p role="status">
                {notes.length
                  ? `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} ready to review. Existing notes are unchanged.`
                  : 'No notes were captured. Close and try again after the count-in.'}
              </p>
              {!!notes.length && (
                <>
                  <Pick
                    label="Snap recorded note starts"
                    value={snap}
                    onChange={(value) => {
                      stopPreview();
                      setSnap(value);
                    }}
                    options={[
                      { value: '0', label: 'Keep played timing' },
                      { value: '0.25', label: 'Sixteenth notes' },
                      { value: '0.5', label: 'Eighth notes' },
                      { value: '1', label: 'Quarter notes' },
                    ]}
                  />
                  <div
                    className="midi-review-list"
                    aria-label="Recorded MIDI notes"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Note</th>
                          <th>Start beat</th>
                          <th>Length</th>
                          <th>Velocity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chosen.map((n) => (
                          <tr key={n.id}>
                            <td>{noteName(n.pitch)}</td>
                            <td>{(n.start + 1).toFixed(2)}</td>
                            <td>{n.length.toFixed(2)}</td>
                            <td>{Math.round(n.velocity * 100)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="actions">
                    <button
                      className="button secondary"
                      onClick={() => void listen()}
                    >
                      {previewing ? 'Stop MIDI preview' : 'Preview MIDI take'}
                    </button>
                    <button
                      className="button secondary"
                      onClick={() =>
                        download(
                          midiFile(chosen, data.bpm),
                          target.name + ' MIDI take.mid',
                        )
                      }
                    >
                      Download MIDI take
                    </button>
                    <button
                      className="button primary"
                      disabled={!canEdit}
                      onClick={() => {
                        if (applying.current || !allowed.current) return;
                        applying.current = true;
                        stopPreview();
                        try {
                          onKeep(chosen);
                        } catch (e) {
                          applying.current = false;
                          setError(
                            e instanceof Error
                              ? e.message
                              : 'This take could not be added.',
                          );
                        }
                      }}
                    >
                      Keep MIDI notes
                    </button>
                  </div>
                </>
              )}
              <p className="small-note">
                Keep adds these notes to the instrument as one Undo step. Save
                the project to retain them. Unkept notes are lost when this
                recorder closes.
              </p>
            </>
          )}
          {error && (
            <p className="record-error" role="alert">
              {error}
            </p>
          )}
          <button className="button secondary" onClick={close}>
            {notes.length ? 'Discard MIDI take' : 'Close MIDI recorder'}
          </button>
        </DialogContent>
      </Dialog>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          capture.current?.dispose();
          stopPreview();
          onClose();
        }}
        title="Discard this MIDI take?"
        description="Recorded notes that you have not kept or downloaded will be lost. Your existing instrument notes will stay unchanged."
        confirmLabel="Discard MIDI take"
      />
    </>
  );
}
