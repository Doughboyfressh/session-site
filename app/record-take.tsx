'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Mic, Square, Loader2, Download } from 'lucide-react';
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
}: {
  data: Arrangement;
  offset: number;
  canEdit: boolean;
  onKeep: (take: RecordedTake, signal: AbortSignal) => Promise<void>;
  onClose: () => void;
  createCapture?: (hooks: CaptureHooks) => TakeCapture;
  roomAudio?: RoomAudio;
}) {
  const [phase, setPhase] = useState<CapturePhase>('idle'),
    [level, setLevel] = useState(0),
    [clipped, setClipped] = useState(false),
    [seconds, setSeconds] = useState(0),
    [beats, setBeats] = useState(0),
    [bars, setBars] = useState('1'),
    [device, setDevice] = useState(''),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [error, setError] = useState(''),
    [take, setTake] = useState<(RecordedTake & { url: string }) | null>(null),
    [uploading, setUploading] = useState(false),
    [uploadAttempted, setUploadAttempted] = useState(false),
    [confirmClose, setConfirmClose] = useState(false);
  const capture = useRef<TakeCapture | null>(null),
    alive = useRef(false),
    upload = useRef<AbortController | null>(null),
    attempt = useRef(0),
    preview = useRef<HTMLAudioElement | null>(null),
    allowed = useRef(canEdit);
  allowed.current = canEdit;
  useEffect(() => {
    alive.current = true;
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
        if (alive.current) setTake({ ...t, url: URL.createObjectURL(t.blob) });
      },
    };
    capture.current = createCapture
      ? createCapture(hooks)
      : new TakeCapture(
          hooks,
          roomAudio
            ? {
                context: () =>
                  new AudioContext({
                    sampleRate: 48000,
                    latencyHint: 'interactive',
                  }),
                media: async () => {
                  throw new Error('Join the room call before recording.');
                },
                acquire: roomAudio.acquire,
                output: roomAudio.output,
              }
            : undefined,
        );
    return () => {
      alive.current = false;
      attempt.current++;
      upload.current?.abort();
      capture.current?.dispose();
      preview.current?.pause();
    };
  }, []);
  useEffect(
    () => () => {
      if (take) URL.revokeObjectURL(take.url);
    },
    [take],
  );
  useEffect(() => {
    if (!canEdit) {
      attempt.current++;
      upload.current?.abort();
      capture.current?.cancel();
      preview.current?.pause();
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
    if (!allowed.current) return;
    setError('');
    setClipped(false);
    void capture.current?.connect(id);
  }
  function discard() {
    preview.current?.pause();
    setTake(null);
    setUploadAttempted(false);
    setError('');
    capture.current?.cancel();
    setSeconds(0);
    setClipped(false);
  }
  function close() {
    if (take) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }
  async function keep() {
    if (!take || uploading || !allowed.current) return;
    const token = ++attempt.current,
      controller = new AbortController();
    upload.current = controller;
    preview.current?.pause();
    setUploading(true);
    setUploadAttempted(true);
    setError('');
    try {
      await onKeep(take, controller.signal);
      if (
        alive.current &&
        token === attempt.current &&
        !controller.signal.aborted
      )
        onClose();
    } catch (e) {
      if (alive.current && token === attempt.current)
        setError(
          e instanceof Error
            ? e.message
            : 'The take could not be added. Your local recording is still here.',
        );
    } finally {
      if (alive.current && token === attempt.current) setUploading(false);
    }
  }
  function cancelUpload() {
    attempt.current++;
    upload.current?.abort();
    setUploading(false);
    setError(
      'Upload cancelled. Your local take is still available. An upload already accepted by the server may remain in your files.',
    );
  }
  const active = [
    'opening',
    'preparing',
    'counting',
    'recording',
    'finishing',
  ].includes(phase);
  return (
    <>
      <TakePanel inline={!!roomAudio} uploading={uploading} onClose={close}>
        <div className="record-position">
          <span>
            Starts at <strong>{offset.toFixed(2)}s</strong>
          </span>
          <span>{data.bpm} BPM · 4/4</span>
          <span>Up to {Math.min(120, 300 - offset).toFixed(0)} seconds</span>
        </div>
        {!take && (
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
            </fieldset>
            <div className="record-input">
              <div>
                <Mic size={18} />
                <strong>
                  {['ready', 'preparing', 'counting', 'recording'].includes(
                    phase,
                  )
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
                      Count-in · recording begins after the final beat
                    </span>
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
        {take && (
          <section className="take-review" aria-label="Review your take">
            <strong>Your take is ready to review</strong>
            <p>
              {take.seconds.toFixed(2)} seconds · Mono {take.depth}-bit{' '}
              {take.depth === 32 ? 'float ' : ''}WAV · {take.sampleRate / 1000}{' '}
              kHz · {(take.blob.size / 1024 / 1024).toFixed(1)} MB
            </p>
            <audio
              ref={preview}
              src={take.url}
              controls
              preload="metadata"
              aria-label="Listen to your recorded take"
            />
            <p>
              {take.peak >= 0.98
                ? 'This take reached the top of the input range. Listen for distortion before keeping it.'
                : 'Listen to the take before adding it to your arrangement.'}
            </p>
            <p>
              {uploadAttempted
                ? 'A previous upload attempt may have saved a copy in your files. '
                : 'This take has not been uploaded. '}
              Add take uploads it to your files; saving the project shares it
              with authorized project collaborators. Preview playback may be
              heard if you are sharing this tab’s audio.
            </p>
            <a
              className="button secondary"
              href={take.url}
              download="SESSION vocal take.wav"
            >
              <Download size={16} />
              Download take
            </a>
          </section>
        )}
        {error && (
          <p className="record-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions record-actions">
          {take ? (
            <>
              <button
                className="button secondary"
                disabled={uploading}
                onClick={discard}
              >
                Discard take
              </button>
              <button
                className="button primary"
                disabled={uploading || !canEdit}
                onClick={() => void keep()}
              >
                {uploading ? 'Adding take…' : 'Add take to project'}
              </button>
              {uploading && (
                <button className="button secondary" onClick={cancelUpload}>
                  Cancel upload
                </button>
              )}
            </>
          ) : (
            <>
              <button className="button secondary" onClick={onClose}>
                Cancel
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
                    disabled={!canEdit}
                    onClick={() => {
                      setClipped(false);
                      setError('');
                      void capture.current?.start(data, offset, Number(bars));
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
                    disabled={!canEdit}
                    onClick={() => connect()}
                  >
                    <Mic size={16} />
                    Enable microphone
                  </button>
                )
              )}
            </>
          )}
        </div>
        <p className="record-note">
          Device latency can affect where a performance lands. Check the take
          against your backing and adjust its clip position if needed.
        </p>
      </TakePanel>
      <Confirm
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={onClose}
        title="Discard this local take?"
        description={
          uploadAttempted
            ? 'Download the local take before leaving if you need it. An earlier upload attempt may also have saved a copy in your files.'
            : 'Download or add the take before leaving if you want to keep it. This recording has not been uploaded.'
        }
        confirmLabel="Discard take"
      />
    </>
  );
}
