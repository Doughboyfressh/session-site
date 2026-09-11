'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Pick, Confirm } from './helpers';
import {
  TakeCapture,
  type CaptureHooks,
  type CapturePhase,
  type RecordedTake,
} from '@/lib/recording';
import type { Arrangement } from '@/lib/audio';
import type { RoomAudio } from '@/lib/room-audio';
import {
  takeBudget,
  MAX_TAKES,
  MAX_TAKE_SECONDS,
  MAX_TAKE_BYTES,
  fullTake,
  planPunch,
  replaceCompRange,
  renderComp,
  type LocalTake,
  type CompRegion,
} from '@/lib/take-comp';
import TakeWorkbench from './take-workbench';

function TakePanel({
  inline,
  uploading,
  onClose,
  children,
}: {
  inline: boolean;
  uploading: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (inline)
      panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  if (inline)
    return (
      <section
        ref={panel}
        className="embedded-record-panel"
        aria-label="Record a take"
      >
        <div className="section-title">
          <h2>Record a take</h2>
          <button
            className="button secondary"
            disabled={uploading}
            onClick={onClose}
          >
            Close recorder
          </button>
        </div>
        <p className="record-note">
          Check your microphone, get a count-in, then review your performance.
          Your call controls stay available above.
        </p>
        {children}
      </section>
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !uploading) onClose();
      }}
    >
      <DialogContent className="form-dialog record-dialog">
        <DialogTitle>Record a take</DialogTitle>
        <DialogDescription>
          Check your microphone, get a count-in, then review your performance.
        </DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export default function RecordTake({
  data,
  offset,
  canEdit,
  onKeep,
  onClose,
  createCapture,
  roomAudio,
  seed,
}: {
  data: Arrangement;
  offset: number;
  canEdit: boolean;
  onKeep: (take: RecordedTake, signal: AbortSignal) => Promise<void>;
  onClose: () => void;
  createCapture?: (hooks: CaptureHooks) => TakeCapture;
  roomAudio?: RoomAudio;
  seed?: RecordedTake & { name: string };
}) {
  const [phase, setPhase] = useState<CapturePhase>('idle'),
    [level, setLevel] = useState(0),
    [clipped, setClipped] = useState(false),
    [seconds, setSeconds] = useState(0),
    [beats, setBeats] = useState(0),
    [bars, setBars] = useState('1'),
    [preRoll, setPreRoll] = useState('0'),
    [correction, setCorrection] = useState('0'),
    [device, setDevice] = useState(''),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [error, setError] = useState(''),
    [takes, setTakes] = useState<LocalTake[]>([]),
    [selected, setSelected] = useState(''),
    [taking, setTaking] = useState(!seed),
    [punch, setPunch] = useState<ReturnType<typeof planPunch> | null>(null),
    [regions, setRegions] = useState<CompRegion[]>([]),
    [past, setPast] = useState<CompRegion[][]>([]),
    [future, setFuture] = useState<CompRegion[][]>([]),
    [prepared, setPrepared] = useState<(RecordedTake & { url: string }) | null>(
      null,
    ),
    [preparing, setPreparing] = useState(false),
    [added, setAdded] = useState(false),
    [confirmDiscard, setConfirmDiscard] = useState(false),
    [uploading, setUploading] = useState(false),
    [uploadAttempted, setUploadAttempted] = useState(false),
    [confirmClose, setConfirmClose] = useState(false);
  const capture = useRef<TakeCapture | null>(null),
    alive = useRef(false),
    upload = useRef<AbortController | null>(null),
    attempt = useRef(0),
    preview = useRef<HTMLAudioElement | null>(null),
    compPreview = useRef<HTMLAudioElement | null>(null),
    bank = useRef<LocalTake[]>([]),
    plan = useRef<CompRegion[]>([]),
    urls = useRef(new Set<string>()),
    renderJob = useRef<AbortController | null>(null),
    busyRef = useRef(false),
    takeNumber = useRef(0),
    allowed = useRef(canEdit);
  const pendingPunch = useRef<
    (ReturnType<typeof planPunch> & { regions: CompRegion[] }) | null
  >(null);
  const preparedRef = useRef(prepared);
  preparedRef.current = prepared;
  allowed.current = canEdit;
  plan.current = regions;
  const take = takes.find((t) => t.id === selected) || takes.at(-1);
  const { limit: takeLimit, available: hasSpace } = takeBudget(takes, offset);
  function stopPreview() {
    preview.current?.pause();
    compPreview.current?.pause();
  }
  function releaseURL(url: string) {
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  }
  function rememberURL(blob: Blob) {
    const url = URL.createObjectURL(blob);
    urls.current.add(url);
    return url;
  }
  function invalidate() {
    stopPreview();
    renderJob.current?.abort();
    if (preparedRef.current) releaseURL(preparedRef.current.url);
    preparedRef.current = null;
    setPrepared(null);
    setError('');
  }
  function changePlan(next: CompRegion[]) {
    if (busyRef.current || added) return;
    invalidate();
    setPast((p) => [...p, regions].slice(-20));
    setFuture([]);
    setRegions(next);
  }
  useEffect(() => {
    alive.current = true;
    if (seed) {
      const entry: LocalTake = {
        ...seed,
        id: 'original-clip',
        name: seed.name,
        url: rememberURL(seed.blob),
      };
      bank.current = [entry];
      plan.current = fullTake(entry);
      setTakes(bank.current);
      setSelected(entry.id);
      setRegions(plan.current);
    }
    const hooks: CaptureHooks = {
      state: (p) => {
        if (alive.current) setPhase(p);
      },
      level: (p) => {
        if (alive.current) {
          setLevel(p);
          if (p >= 0.98) setClipped(true);
        }
      },
      progress: (s, b) => {
        if (alive.current) {
          setSeconds(s);
          setBeats(b);
        }
      },
      error: (message) => {
        if (alive.current) setError(message);
      },
      take: (t) => {
        if (!alive.current || !allowed.current) return;
        const punch = pendingPunch.current;
        pendingPunch.current = null;
        setPunch(null);
        if (
          bank.current.length >= MAX_TAKES ||
          bank.current.reduce((n, t) => n + t.blob.size, 0) + t.blob.size >
            MAX_TAKE_BYTES ||
          bank.current.reduce((n, t) => n + t.seconds, 0) + t.seconds >
            MAX_TAKE_SECONDS + 1 / 44100
        ) {
          setError(
            'The take bank is full. Download or discard a take before recording again.',
          );
          setTaking(false);
          return;
        }
        const entry: LocalTake = {
          ...t,
          ...(punch
            ? { coverageStart: punch.start, compOrigin: punch.origin }
            : {}),
          id: crypto.randomUUID(),
          name: (punch ? 'Punch ' : 'Take ') + ++takeNumber.current,
          url: rememberURL(t.blob),
        };
        bank.current = [...bank.current, entry];
        setTakes(bank.current);
        setSelected(entry.id);
        setTaking(false);
        if (punch) {
          if (
            t.sampleRate === punch.sampleRate &&
            Math.round(t.seconds * t.sampleRate) === punch.frames &&
            Math.abs(t.offset - punch.offset) < 1e-9 &&
            JSON.stringify(plan.current) === JSON.stringify(punch.regions)
          ) {
            try {
              const next = replaceCompRange(
                plan.current,
                bank.current,
                entry.id,
                punch.start / punch.sampleRate,
                punch.end / punch.sampleRate,
              );
              invalidate();
              const previous = plan.current;
              setPast((p) => [...p, previous].slice(-20));
              setFuture([]);
              plan.current = next;
              setRegions(next);
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : 'Your current comp is unchanged.',
              );
            }
          } else
            setError(
              'The punch ended early or did not match the selected section. Your comp is unchanged. This recording is kept for download or use within its recorded range.',
            );
        } else if (!plan.current.length) {
          const next = fullTake(entry);
          plan.current = next;
          setRegions(next);
        }
      },
    };
    capture.current = createCapture
      ? createCapture(hooks)
      : new TakeCapture(hooks, {
          context: () =>
            new AudioContext({
              sampleRate:
                pendingPunch.current?.sampleRate || seed?.sampleRate || 48000,
              latencyHint: 'interactive',
            }),
          media: (constraints) =>
            navigator.mediaDevices.getUserMedia(constraints),
          acquire: roomAudio?.acquire,
          output: roomAudio?.output,
        });
    return () => {
      alive.current = false;
      attempt.current++;
      upload.current?.abort();
      renderJob.current?.abort();
      capture.current?.dispose();
      stopPreview();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, []);
  useEffect(() => {
    if (!canEdit) {
      attempt.current++;
      upload.current?.abort();
      renderJob.current?.abort();
      capture.current?.cancel();
      pendingPunch.current = null;
      setPunch(null);
      if (bank.current.length) setTaking(false);
      stopPreview();
      busyRef.current = false;
      setPreparing(false);
      setUploading(false);
      setError(
        'Editing access has ended. A completed take can still be downloaded from this tab.',
      );
    }
  }, [canEdit]);
  useEffect(() => {
    let active = true;
    const enumerate = () =>
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => {
          if (active)
            setDevices(
              list.filter((d) => d.kind === 'audioinput' && d.deviceId),
            );
        })
        .catch(() => {});
    void enumerate();
    navigator.mediaDevices?.addEventListener('devicechange', enumerate);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener('devicechange', enumerate);
    };
  }, [phase === 'ready']);
  function connect(id = device) {
    if (!allowed.current || !hasSpace || busyRef.current || added) return;
    stopPreview();
    setError('');
    setClipped(false);
    void capture.current?.connect(id);
  }
  function discard() {
    if (!take || busyRef.current) return;
    if (seed && take.id === 'original-clip') return;
    invalidate();
    releaseURL(take.url);
    const remaining = bank.current.filter((t) => t.id !== take.id);
    bank.current = remaining;
    setTakes(remaining);
    setSelected(remaining[0]?.id || '');
    setPast([]);
    setFuture([]);
    if (regions.some((r) => r.takeId === take.id)) {
      const base = remaining.find((t) => t.coverageStart === undefined);
      plan.current = base ? fullTake(base) : [];
      setRegions(plan.current);
    }
    setTaking(!remaining.length);
    setUploadAttempted(false);
    setError('');
    capture.current?.cancel();
    setSeconds(0);
    setClipped(false);
  }
  function close() {
    if (bank.current.length) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }
  async function keep() {
    if (!takes.length || busyRef.current || added || !allowed.current) return;
    const token = ++attempt.current,
      controller = new AbortController();
    upload.current = controller;
    busyRef.current = true;
    stopPreview();
    setUploading(true);
    setError('');
    try {
      let finalTake: RecordedTake = prepared!;
      if (!finalTake) {
        setPreparing(true);
        finalTake = await renderComp(regions, takes, controller.signal);
        if (
          !alive.current ||
          controller.signal.aborted ||
          token !== attempt.current
        )
          return;
        setPrepared({ ...finalTake, url: rememberURL(finalTake.blob) });
        setPreparing(false);
      }
      if (
        !allowed.current ||
        controller.signal.aborted ||
        token !== attempt.current
      )
        return;
      setUploadAttempted(true);
      await onKeep(finalTake, controller.signal);
      if (
        alive.current &&
        token === attempt.current &&
        !controller.signal.aborted
      )
        setAdded(true);
    } catch (e) {
      if (alive.current && token === attempt.current)
        setError(
          e instanceof Error
            ? e.message
            : 'The take could not be added. Your local recording is still here.',
        );
    } finally {
      if (alive.current && token === attempt.current) {
        setUploading(false);
        setPreparing(false);
        busyRef.current = false;
      }
    }
  }
  function cancelUpload() {
    attempt.current++;
    upload.current?.abort();
    busyRef.current = false;
    setPreparing(false);
    setUploading(false);
    setError(
      'Upload cancelled. Your local take is still available. An upload already accepted by the server may remain in your files.',
    );
  }
  async function buildPreview() {
    if (busyRef.current || !takes.length) return;
    const controller = new AbortController();
    renderJob.current = controller;
    busyRef.current = true;
    setPreparing(true);
    setError('');
    stopPreview();
    try {
      const result = await renderComp(regions, takes, controller.signal);
      if (
        alive.current &&
        !controller.signal.aborted &&
        renderJob.current === controller
      )
        setPrepared({ ...result, url: rememberURL(result.blob) });
    } catch (e) {
      if (alive.current && !controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : 'The comp could not be prepared.',
        );
    } finally {
      if (alive.current && renderJob.current === controller) {
        renderJob.current = null;
        busyRef.current = false;
        setPreparing(false);
      }
    }
  }
  function another() {
    if (!allowed.current || !hasSpace || busyRef.current || added) return;
    stopPreview();
    capture.current?.cancel();
    pendingPunch.current = null;
    setPunch(null);
    setTaking(true);
    setError('');
    setSeconds(0);
    setClipped(false);
  }
  function punchIn(from: number, to: number) {
    if (!allowed.current || busyRef.current || added) return;
    try {
      const next = planPunch(regions, takes, from, to);
      stopPreview();
      capture.current?.cancel();
      pendingPunch.current = { ...next, regions: structuredClone(regions) };
      setPunch(next);
      setTaking(true);
      setError('');
      setSeconds(0);
      setClipped(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Choose a valid punch section.',
      );
    }
  }
  const active = [
    'opening',
    'preparing',
    'counting',
    'preroll',
    'recording',
    'draining',
    'finishing',
  ].includes(phase);
  const correctionValid =
    correction.trim() !== '' &&
    Number.isFinite(Number(correction)) &&
    Number(correction) >= 0 &&
    Number(correction) <= 500;
  const leadSeconds = Math.min(
    punch?.offset ?? offset,
    (Number(preRoll) * 4 * 60) / data.bpm,
  );
  return (
    <>
      <TakePanel
        inline={!!roomAudio}
        uploading={uploading || preparing}
        onClose={close}
      >
        <div className="record-position">
          <span>
            Starts at <strong>{(punch?.offset ?? offset).toFixed(2)}s</strong>
          </span>
          <span>{data.bpm} BPM · 4/4</span>
          <span>
            {punch
              ? `${(punch.frames / punch.sampleRate).toFixed(2)} second punch`
              : `Up to ${Math.max(0, takeLimit).toFixed(1)} seconds per next take`}
          </span>
        </div>
        {punch && (
          <p className="record-progress" role="status">
            Punch in: {(punch.start / punch.sampleRate).toFixed(2)}–
            {(punch.end / punch.sampleRate).toFixed(2)}s of your vocal.
            Recording stops automatically at the end. Stopping early keeps your
            current comp unchanged.
          </p>
        )}
        {seed && (
          <p className="record-note">
            Editing {seed.name}. Apply the finished comp to replace this clip;
            its original file and mixer settings are kept. Studio Undo can
            restore the original after closing the recorder.
          </p>
        )}
        {taking && (
          <>
            <fieldset disabled={active || !canEdit} className="record-settings">
              {roomAudio ? (
                <p className="record-note">
                  Using your room microphone. Call mute does not mute this
                  recording. The call’s echo and noise processing also applies
                  to the take.
                </p>
              ) : (
                <Pick
                  label="Microphone"
                  value={device}
                  onChange={(id) => {
                    setDevice(id);
                    setCorrection('0');
                    if (phase === 'ready') connect(id);
                  }}
                  options={[
                    { value: '', label: 'System default microphone' },
                    ...devices
                      .filter((d) => d.deviceId !== 'default')
                      .map((d, i) => ({
                        value: d.deviceId,
                        label: d.label || 'Microphone ' + (i + 1),
                      })),
                  ]}
                />
              )}
              <Pick
                label="Count-in"
                value={bars}
                onChange={setBars}
                options={[
                  { value: '0', label: 'None' },
                  { value: '1', label: '1 bar · 4 beats' },
                  { value: '2', label: '2 bars · 8 beats' },
                ]}
              />
              <Pick
                label="Musical pre-roll"
                value={preRoll}
                onChange={setPreRoll}
                options={[
                  { value: '0', label: 'Off' },
                  { value: '1', label: 'Up to 1 bar' },
                  { value: '2', label: 'Up to 2 bars' },
                ]}
              />
              <label className="field">
                <span>Recording delay correction (ms)</span>
                <input
                  type="number"
                  min={0}
                  max={500}
                  step={1}
                  value={correction}
                  aria-label="Recording delay correction (ms)"
                  aria-describedby="recording-delay-help"
                  aria-invalid={!correctionValid}
                  onChange={(e) => setCorrection(e.target.value)}
                />
              </label>
            </fieldset>
            <p className="record-note" role="status">
              {Number(preRoll)
                ? `After the count-in, hear ${leadSeconds.toFixed(2)} seconds before the recording point. Pre-roll stops at the start of the project.`
                : 'Recording begins after the count-in.'}
              {Number(preRoll) > 0 && !data.tracks.length
                ? ' Add backing tracks to hear music during the lead-in.'
                : ''}
              {Number(preRoll) > 0 && seed
                ? ' The selected vocal stays muted in the backing.'
                : ''}
            </p>
            <p className="record-note" id="recording-delay-help">
              Start at 0. If a test recording lands 80 ms late, try 80 here. A
              positive value corrects incoming delay for the next take; its
              start position and punch length stay the same. This is a manual
              setting, not an automatic measurement. Recheck after changing
              headphones, microphones or audio interfaces.
            </p>
            {!correctionValid && (
              <p className="form-error" role="alert">
                Enter a delay correction from 0 to 500 ms.
              </p>
            )}
            <div className="record-input">
              <div>
                <Mic size={18} />
                <strong>
                  {[
                    'ready',
                    'preparing',
                    'counting',
                    'preroll',
                    'recording',
                    'draining',
                  ].includes(phase)
                    ? roomAudio
                      ? 'Recording input is on'
                      : 'Microphone is on'
                    : roomAudio
                      ? 'Recording input is off'
                      : 'Microphone is off'}
                </strong>
                <span>
                  {level > 0
                    ? Math.max(-60, 20 * Math.log10(level)).toFixed(1) + ' dBFS'
                    : 'No input'}
                </span>
              </div>
              <meter
                min={0}
                max={1}
                value={Math.min(1, level)}
                aria-label="Microphone input level"
              />
              <p>
                {clipped
                  ? 'Input is near clipping. Lower the gain on your microphone or audio interface.'
                  : 'Speak or sing at your performance level. Leave space below the top of the meter.'}
              </p>
            </div>
            {active && (
              <div className="record-progress" role="status">
                {phase === 'counting' ? (
                  <>
                    <strong className="record-count">{beats || 'Ready'}</strong>
                    <span>
                      {Number(preRoll) && leadSeconds > 0
                        ? 'Count-in · music lead-in is next'
                        : 'Count-in · recording begins after the final beat'}
                    </span>
                  </>
                ) : phase === 'preroll' ? (
                  <>
                    <strong className="record-count">{beats || 'Ready'}</strong>
                    <span>Pre-roll · listen for your recording point</span>
                  </>
                ) : phase === 'draining' ? (
                  <>
                    <Loader2 className="spin" size={20} />
                    <span>Finishing the last moment of microphone audio…</span>
                  </>
                ) : phase === 'recording' ? (
                  <>
                    <span className="record-dot" />
                    <strong>{seconds.toFixed(1)}s</strong>
                    <span>Recording your microphone</span>
                  </>
                ) : (
                  <>
                    <Loader2 className="spin" size={20} />
                    <span>
                      {phase === 'opening'
                        ? 'Waiting for microphone access…'
                        : phase === 'preparing'
                          ? 'Preparing your backing tracks…'
                          : 'Preparing your take…'}
                    </span>
                  </>
                )}
              </div>
            )}
            <p className="record-note">
              Use headphones. Your microphone is measured without playing it
              through the speakers. The count-in and backing tracks are excluded
              from the recorded file; speaker sound can still bleed into the
              microphone.
            </p>
            <p className="record-note">
              {roomAudio
                ? 'Keep the room open and use headphones. Disconnecting the call stops an unfinished take. Your count-in and review playback are not sent through Share studio audio; your live voice still follows the call’s microphone control.'
                : 'Keep this tab open while recording. On some phones, starting the microphone here can interrupt a call in another tab.'}
            </p>
          </>
        )}
        {!taking && take && (
          <TakeWorkbench
            takes={takes}
            selected={take}
            onSelect={(id) => {
              stopPreview();
              setSelected(id);
            }}
            regions={regions}
            onWhole={() => changePlan(fullTake(take))}
            onPunch={punchIn}
            canPunch={hasSpace && !!regions.length}
            fixedLength={!!seed}
            onReplace={(from, to) => {
              try {
                changePlan(replaceCompRange(regions, takes, take.id, from, to));
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : 'Choose a valid section.',
                );
              }
            }}
            onUndo={() => {
              const previous = past.at(-1);
              if (!previous || busyRef.current) return;
              invalidate();
              setPast(past.slice(0, -1));
              setFuture([regions, ...future].slice(0, 20));
              setRegions(previous);
            }}
            onRedo={() => {
              const next = future[0];
              if (!next || busyRef.current) return;
              invalidate();
              setFuture(future.slice(1));
              setPast([...past, regions].slice(-20));
              setRegions(next);
            }}
            undo={!!past.length}
            redo={!!future.length}
            locked={uploading || preparing || added || !canEdit}
            prepared={prepared}
            preview={preview}
            compPreview={compPreview}
            onPreview={() => void buildPreview()}
            preparing={preparing || uploading}
            added={added}
          />
        )}
        <p className="record-note">
          Up to 8 takes and 4 minutes of recorded audio are kept in this
          recorder only. Browser recovery does not include these takes or your
          comp edits. Download any originals you want to keep before closing.
          Adding a comp uploads only the finished vocal; save the project to
          share it with authorized collaborators.
        </p>
        {uploadAttempted && !added && (
          <p className="record-note">
            A previous upload attempt may have saved the finished vocal in your
            files. Your original takes are still here.
          </p>
        )}
        {added && (
          <p className="record-progress" role="status">
            Comp added. Your original takes are still here to download. Close
            the recorder, then save your project.
          </p>
        )}
        {error && (
          <p className="record-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions record-actions">
          {!taking && take ? (
            <>
              {added ? (
                <button className="button primary" onClick={close}>
                  Done with takes
                </button>
              ) : (
                <>
                  <button
                    className="button secondary"
                    disabled={
                      uploading ||
                      preparing ||
                      (!!seed && take.id === 'original-clip')
                    }
                    onClick={() => setConfirmDiscard(true)}
                  >
                    Discard selected take
                  </button>
                  {!seed && (
                    <button
                      className="button secondary"
                      disabled={uploading || preparing || !canEdit || !hasSpace}
                      onClick={another}
                    >
                      Record another take
                    </button>
                  )}
                  <button
                    className="button primary"
                    disabled={
                      uploading || preparing || !canEdit || !regions.length
                    }
                    onClick={() => void keep()}
                  >
                    {uploading
                      ? preparing
                        ? 'Preparing comp…'
                        : 'Adding comp…'
                      : seed
                        ? 'Apply comp to selected clip'
                        : 'Add comp to project'}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button
                className="button secondary"
                onClick={() => {
                  capture.current?.cancel();
                  pendingPunch.current = null;
                  setPunch(null);
                  if (takes.length) setTaking(false);
                  else onClose();
                }}
              >
                {takes.length ? 'Back to takes' : 'Cancel'}
              </button>
              {phase === 'ready' ? (
                <>
                  <button
                    className="button secondary"
                    onClick={() => capture.current?.cancel()}
                  >
                    Turn microphone off
                  </button>
                  <button
                    className="button primary"
                    disabled={!canEdit || !hasSpace || !correctionValid}
                    onClick={() => {
                      setClipped(false);
                      setError('');
                      void capture.current?.start(
                        data,
                        punch?.offset ?? offset,
                        Number(bars),
                        punch ? punch.frames / punch.sampleRate : takeLimit,
                        punch ?? undefined,
                        {
                          preRollBars: Number(preRoll),
                          correctionMs: Number(correction),
                        },
                      );
                    }}
                  >
                    Start recording
                  </button>
                </>
              ) : phase === 'recording' ? (
                <button
                  className="button primary"
                  onClick={() => capture.current?.finish()}
                >
                  <Square size={16} />
                  Stop and review
                </button>
              ) : (
                !active && (
                  <button
                    className="button primary"
                    disabled={!canEdit || !hasSpace}
                    onClick={() => connect()}
                  >
                    <Mic size={16} />
                    Enable microphone
                  </button>
                )
              )}
            </>
          )}
          {uploading && (
            <button className="button secondary" onClick={cancelUpload}>
              Cancel upload
            </button>
          )}
          {preparing && !uploading && (
            <button
              className="button secondary"
              onClick={() => {
                renderJob.current?.abort();
                renderJob.current = null;
                busyRef.current = false;
                setPreparing(false);
              }}
            >
              Cancel preparation
            </button>
          )}
        </div>
        {!hasSpace && !added && (
          <p className="record-note">
            This take bank has reached its limit. Existing takes and comp edits
            are kept; download or discard a take to make room.
          </p>
        )}
        <p className="record-note">
          Delay correction applies only to newly recorded takes. Compare a short
          test against your backing before recording a full performance. Your
          timing settings remain while this recorder is open.
        </p>
      </TakePanel>
      <Confirm
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          discard();
          setConfirmDiscard(false);
        }}
        title="Discard selected take?"
        description="Download it first if you want to keep it. If this take is used in your comp, the comp resets to the first remaining full take, or clears if none remains. Comp undo history will be cleared."
        confirmLabel="Discard take"
      />
      <Confirm
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={onClose}
        title="Close and discard local originals?"
        description={
          added
            ? 'The finished comp is in your arrangement. Original takes and comp edit choices have not been uploaded. Download any originals you need before closing.'
            : 'Download your takes or add the finished comp before leaving. Closing discards all local takes and comp edit choices. An earlier upload attempt may have saved a finished vocal in your files.'
        }
        confirmLabel="Close recorder"
      />
    </>
  );
}
