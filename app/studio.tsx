'use client';
import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Play,
  Square,
  Mic,
  Plus,
  Download,
  Save,
  Disc3,
  Volume2,
  VolumeX,
  Trash2,
  Loader2,
  SlidersHorizontal,
  LockKeyhole,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PianoRoll, { AutomationEditor } from './piano-roll';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { defaultPattern, type Track } from '@/lib/catalog';
import {
  context,
  trackFrom,
  defaults,
  bufferFor,
  peaks,
  playMix,
  type MixerTrack,
  type Arrangement,
} from '@/lib/audio';
import { action, upload, Range, Confirm } from './helpers';
import { useProjectSync } from './use-project-sync';
import ConflictValues from './conflict-values';
import ExportAudio from './export-audio';
import RecordTake from './record-take';
import RecordMidi from './record-midi';
import ImportMidi from './import-midi';
import { appendMidi } from '@/lib/midi-import';
import { keepMidi, midiPlan } from '@/lib/midi-notes';
import type { RestoredBank } from '@/lib/take-bank';
import type { RecordedTake } from '@/lib/recording';
import {
  punchSeed,
  punchBacking,
  checkPunchTarget,
  applyPunchClip,
} from '@/lib/punch-clip';
import type { RoomAudio } from '@/lib/room-audio';
import ArrangementTimeline from './arrangement-timeline';
import MixerBoard from './mixer-board';
import { routingFor } from '@/lib/mixer-routing';
import {
  clipLength,
  duplicateClip,
  gridSeconds,
  moveClip,
  snapTime,
  splitClip,
  type ClipGrid,
} from '@/lib/clip-edit';
export default function Studio({
  initial,
  onDraft,
  onSaved,
  onBrowse,
  notify,
  roomAudio,
  roomAllowed = true,
  onActivity,
  onPrepareSave,
  catalog,
}: {
  initial: any;
  onDraft: (p: any) => void;
  onSaved: (p: any) => void;
  onBrowse: () => void;
  notify: (s: string) => void;
  roomAudio?: RoomAudio;
  roomAllowed?: boolean;
  onActivity?: (busy: boolean) => void;
  onPrepareSave?: (draft: any) => Promise<boolean>;
  catalog?: Track[];
}) {
  const [library, setLibrary] = useState(false);
  const recoveryId = useRef(initial?.recoveryId || crypto.randomUUID());
  const [grid, setGrid] = useState<ClipGrid>('quarter');
  const [zoom, setZoom] = useState(1);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [gesturing, setGesturing] = useState(false);
  const gesture = useRef<{ recorded: boolean } | null>(null);
  function beginGesture() {
    if (!gesture.current) {
      gesture.current = { recorded: false };
      setGesturing(true);
    }
  }
  function endGesture() {
    gesture.current = null;
    setGesturing(false);
  }
  const browse = () => (catalog ? setLibrary(true) : onBrowse());
  const [title, setTitle] = useState(initial?.title || 'Untitled session'),
    [id, setId] = useState(initial?.id || ''),
    [data, setData] = useState<Arrangement>(
      initial?.data || { bpm: 92, tracks: [] },
    ),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(''),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [recordSnapshot, setRecordSnapshot] = useState<{
      data: Arrangement;
      offset: number;
      projectId: string;
      target?: MixerTrack;
      seed?: RecordedTake & { name: string };
      restored?: RestoredBank;
      restoreWarning?: string;
    } | null>(() => {
      const bank = initial?.restoreBank as RestoredBank | undefined;
      return bank
        ? {
            data: bank.data.backing,
            offset: bank.data.offset,
            projectId: bank.data.projectId,
            target: bank.data.target,
            seed: bank.originals.find((t) => t.id === 'original-clip'),
            restored: bank,
            restoreWarning: initial.restoreWarning,
          }
        : null;
    }),
    [pattern, setPattern] = useState(defaultPattern.map((r) => [...r])),
    [tab, setTab] = useState('Arrangement'),
    [remove, setRemove] = useState(''),
    [dirty, setDirty] = useState(!!initial?.dirty),
    [loop, setLoop] = useState(false),
    [loopStart, setLoopStart] = useState(0),
    [loopEnd, setLoopEnd] = useState(8),
    [metronome, setMetronome] = useState(false),
    [level, setLevel] = useState(0),
    [autosave, setAutosave] = useState(false),
    [saveLabel, setSaveLabel] = useState(''),
    [versions, setVersions] = useState<any[] | null>(null),
    [historyTick, setHistoryTick] = useState(0),
    [exportSnapshot, setExportSnapshot] = useState<{
      title: string;
      data: Arrangement;
    } | null>(null);
  const past = useRef<Arrangement[]>([]),
    future = useRef<Arrangement[]>([]),
    generation = useRef(0),
    saving = useRef(false);
  const playback = useRef<any>(null),
    input = useRef<HTMLInputElement>(null),
    alive = useRef(true);
  const [midiSnapshot, setMidiSnapshot] = useState<{
    data: Arrangement;
    target: MixerTrack;
    start: number;
  } | null>(null);
  const [importSnapshot, setImportSnapshot] = useState<{
    data: Arrangement;
    start: number;
    projectId: string;
  } | null>(null);
  const recording = !!recordSnapshot || !!midiSnapshot || !!importSnapshot;
  const seedJob = useRef<AbortController | null>(null);
  const projectIdRef = useRef(id);
  projectIdRef.current = id;
  const editEpoch = useRef(0);
  const tracksRef = useRef(data);
  const titleRef = useRef(title);
  titleRef.current = title;
  tracksRef.current = data;
  const sync = useProjectSync({
    initial,
    id,
    snapshot: { title, data },
    paused: recording || playing || !!busy || !!exportSnapshot || gesturing,
    apply: (p, changed, resetHistory = true) => {
      setTitle(p.title);
      setData(p.data);
      setDirty(changed);
      titleRef.current = p.title;
      tracksRef.current = p.data;
      if (resetHistory) {
        past.current = [];
        future.current = [];
        setHistoryTick((x) => x + 1);
      }
    },
    permissionEnded: () => {
      editAllowed.current = false;
      setAutosave(false);
      stop();
      editEpoch.current++;
      seedJob.current?.abort();
      endGesture();
    },
    prepareCreation: async (creation, baseline) => {
      const p = {
        recoveryId: recoveryId.current,
        id: '',
        title: titleRef.current,
        data: tracksRef.current,
        dirty: true,
        baseline,
        creation,
        revision: 0,
        canEdit: true,
        canManage: true,
      };
      onDraft(p);
      return onPrepareSave ? onPrepareSave(p) : false;
    },
    adoptProject: setId,
  });
  const { revision } = sync;
  const canEdit = sync.canEdit && roomAllowed;
  const canManage = sync.canManage && roomAllowed;
  useEffect(() => {
    if (!roomAllowed || sync.accessEnded) setExportSnapshot(null);
  }, [roomAllowed, sync.accessEnded]);
  const editAllowed = useRef(canEdit);
  editAllowed.current = canEdit;
  useEffect(() => {
    if (!roomAllowed) {
      seedJob.current?.abort();
      endGesture();
      setAutosave(false);
      stop();
      editEpoch.current++;
    }
  }, [roomAllowed]);
  useEffect(() => {
    onActivity?.(
      recording || !!busy || !!exportSnapshot || library || gesturing,
    );
  }, [recording, busy, exportSnapshot, library, gesturing]);
  useEffect(() => () => onActivity?.(false), []);
  useEffect(() => {
    onDraft({
      recoveryId: recoveryId.current,
      id,
      title,
      data,
      revision,
      dirty: dirty || !!sync.creation,
      canEdit,
      canManage,
      baseline: sync.baseline.current,
      creation: sync.creation,
      reviewFirstSave: sync.reviewFirstSave,
      owner: initial?.owner,
    });
  }, [
    id,
    title,
    data,
    revision,
    dirty,
    canEdit,
    canManage,
    sync.creation,
    sync.reviewFirstSave,
  ]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      seedJob.current?.abort();
      generation.current++;
      playback.current?.stop();
      editEpoch.current++;
    };
  }, []);
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (dirty || recording) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, [dirty, recording]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setPosition(playback.current?.position?.() || 0);
      setLevel(playback.current?.level?.() || 0);
      setLevels(playback.current?.levels?.() || {});
    }, 70);
    return () => clearInterval(timer);
  }, [playing]);
  const mutate = (fn: (d: Arrangement) => Arrangement) => {
    const d = tracksRef.current;
    const next = fn(d);
    if (JSON.stringify(d) === JSON.stringify(next)) return;
    if (!gesture.current?.recorded) {
      past.current = [...past.current.slice(-49), structuredClone(d)];
      future.current = [];
      setHistoryTick((x) => x + 1);
      if (gesture.current) gesture.current.recorded = true;
    }
    tracksRef.current = next;
    setData(next);
    setDirty(true);
  };
  const patch = (tid: string, p: Partial<MixerTrack>) =>
    mutate((d) => ({
      ...d,
      tracks: d.tracks.map((t) =>
        t.id === tid
          ? {
              ...t,
              ...p,
              ...(['notes', 'sequence', 'sound', 'fileId'].some((k) => k in p)
                ? { peaks: undefined, duration: undefined }
                : {}),
            }
          : t,
      ),
    }));
  async function enrich(t: MixerTrack) {
    const b = await bufferFor(t, data.bpm);
    if (b.duration > 300)
      throw new Error('Use audio up to 5 minutes long in this studio.');
    return { ...t, duration: b.duration, peaks: peaks(b) };
  }
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      data.tracks
        .filter((t) => !t.peaks)
        .map(async (t) => {
          try {
            const next = await enrich(t);
            if (!cancelled)
              setData((d) => ({
                ...d,
                tracks: d.tracks.map((x) =>
                  x.id === t.id
                    ? { ...x, duration: next.duration, peaks: next.peaks }
                    : x,
                ),
              }));
          } catch (e: any) {
            notify(e.message);
          }
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [
    data.tracks
      .map(
        (t) =>
          t.id +
          JSON.stringify(t.notes || t.sequence || []) +
          (t.sound || '') +
          (t.fileId || '') +
          !!t.peaks,
      )
      .join(','),
    data.bpm,
  ]);
  useEffect(() => {
    playback.current?.update?.(data);
  }, [data]);
  useEffect(() => {
    if (
      !canEdit ||
      sync.conflict ||
      !autosave ||
      !id ||
      !dirty ||
      busy ||
      gesturing ||
      recording
    )
      return;
    const timer = setTimeout(() => save(true), 10000);
    return () => clearTimeout(timer);
  }, [
    autosave,
    id,
    dirty,
    data,
    title,
    busy,
    recording,
    canEdit,
    sync.conflict,
    gesturing,
  ]);
  function undo(redo = false) {
    if (playing || recording || busy || gesturing) return;
    const source = redo ? future : past,
      target = redo ? past : future;
    if (!source.current.length) return;
    target.current.push(structuredClone(data));
    setData(source.current.pop()!);
    setDirty(true);
    setHistoryTick((x) => x + 1);
  }
  function addInstrument() {
    if (data.tracks.length >= 32)
      return notify('This session has reached 32 tracks.');
    const t = {
      ...defaults(
        'Instrument ' + (data.tracks.filter((t) => t.notes).length + 1),
      ),
      sound: 'keys' as const,
      notes: [],
    };
    mutate((d) => ({ ...d, tracks: [...d.tracks, t] }));
    setSelected(t.id);
    setTab('Piano roll');
  }
  function duplicate() {
    if (!focus || !canEdit || structuralLocked) return;
    try {
      const newId = crypto.randomUUID();
      mutate((d) => duplicateClip(d, focus.id, newId));
      setSelected(newId);
    } catch (error: any) {
      notify(error.message);
    }
  }
  function split() {
    if (!focus || !canEdit || structuralLocked) return;
    try {
      const newId = crypto.randomUUID();
      mutate((d) => splitClip(d, focus.id, position, newId));
      setSelected(newId);
      notify(
        'Clip split. Both halves use the original audio and keep its fades.',
      );
    } catch (error: any) {
      notify(error.message);
    }
  }
  function moveSelected(offset: number) {
    if (!focus || !canEdit || structuralLocked) return;
    try {
      const next = moveClip(focus, offset);
      patch(focus.id, { offset: next.offset });
    } catch (error: any) {
      notify(error.message);
    }
  }
  function trimSelected(key: 'trimStart' | 'trimEnd', value: number) {
    if (!focus || !canEdit || structuralLocked) return;
    try {
      if (
        !Number.isFinite(focus.duration) ||
        !focus.duration ||
        focus.duration > 300
      )
        throw new Error('Wait for valid source audio to finish loading.');
      const other = key === 'trimStart' ? 'trimEnd' : 'trimStart';
      const min = Math.max(
        0,
        focus.duration! + focus.offset - focus[other] - 300,
      );
      const max = Math.max(min, focus.duration! - focus[other] - 0.01);
      const next = { ...focus, [key]: Math.max(min, Math.min(max, value)) };
      clipLength(next);
      patch(focus.id, { [key]: next[key] });
    } catch (error: any) {
      notify(error.message);
    }
  }
  async function checkpointList() {
    if (!canManage) return;
    try {
      setVersions(await action({ action: 'projectVersions', id }));
    } catch (e: any) {
      notify(e.message);
    }
  }
  function stop() {
    generation.current++;
    playback.current?.stop();
    playback.current = null;
    setPlaying(false);
    setPosition(0);
    setLevel(0);
    setLevels({});
  }
  async function play() {
    if (playing) {
      stop();
      return;
    }
    setBusy('Loading audio');
    try {
      const request = ++generation.current;
      const p = await playMix(
        data,
        () => {
          setPlaying(false);
          setPosition(0);
          setLevel(0);
          setLevels({});
        },
        {
          from: position,
          loop,
          loopStart,
          loopEnd,
          metronome,
          output: roomAudio?.output,
        },
      );
      if (request !== generation.current || !alive.current) {
        p.stop();
        return;
      }
      playback.current = p;
      setPlaying(true);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy('');
    }
  }
  async function save(automatic = false) {
    if (!canEdit || sync.conflict) return;
    if (saving.current) return;
    saving.current = true;
    const savedData = data;
    const savedTitle = title;
    if (!automatic) setBusy('Saving');
    setSaveLabel(automatic ? 'Autosaving…' : 'Saving…');
    try {
      const r = await sync.save(!automatic);
      setId(r.id);
      onSaved({
        id: r.id,
        title: savedTitle,
        data: savedData,
        revision: r.revision,
      });
      setSaveLabel(
        (r.needsReview
          ? 'Review the earlier save · '
          : r.remainingChanges
            ? 'Earlier save confirmed · newer edits unsaved · '
            : 'Saved ') +
          new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
      );
      if (!automatic)
        notify(
          r.needsReview
            ? 'An earlier save already created this project. Review it before saving your current edits.'
            : r.remainingChanges
              ? 'The earlier save is confirmed. Your newer edits are kept here; save again to share them.'
              : 'Project saved. Room members with access will receive your changes.',
        );
    } catch (e: any) {
      setSaveLabel('Save needs attention');
      if (automatic) setAutosave(false);
      notify(e.message);
    } finally {
      saving.current = false;
      setBusy('');
    }
  }
  async function addFile(file: File) {
    if (!editAllowed.current) return;
    if (data.tracks.length >= 32) {
      notify('This session has reached 32 tracks.');
      return;
    }
    setBusy('Importing audio');
    try {
      const b = await context().decodeAudioData(await file.arrayBuffer());
      if (b.duration > 300) throw new Error('Use audio up to 5 minutes long.');
      if (!alive.current || !editAllowed.current) return;
      const f = await upload(file);
      if (!alive.current || !editAllowed.current) return;
      const t: MixerTrack = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ''),
        fileId: f.id,
        volume: 0.8,
        pan: 0,
        muted: false,
        solo: false,
        offset: 0,
        trimStart: 0,
        trimEnd: 0,
        low: 0,
        mid: 0,
        high: 0,
        duration: b.duration,
        peaks: peaks(b),
      };
      mutate((d) => ({ ...d, tracks: [...d.tracks, t] }));
      setSelected(t.id);
      notify('Audio imported. Save the project to keep your arrangement.');
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy('');
    }
  }
  function record() {
    if (!canEdit || busy || recording) return;
    if (data.tracks.length >= 32)
      return notify('This session has reached 32 tracks.');
    const offset = Math.min(299, Math.max(0, position));
    stop();
    setRecordSnapshot(structuredClone({ data, offset, projectId: id }));
  }
  async function recordSelected() {
    if (!focus?.fileId || !canEdit || structuralLocked || seedJob.current)
      return;
    const target = structuredClone(focus),
      backing = structuredClone(data),
      projectId = id;
    const permission = editEpoch.current,
      controller = new AbortController();
    seedJob.current = controller;
    const check = () => {
      if (
        !alive.current ||
        !editAllowed.current ||
        permission !== editEpoch.current ||
        controller.signal.aborted ||
        projectIdRef.current !== projectId
      )
        throw new Error(
          'Punch preparation was cancelled or editing access ended.',
        );
      checkPunchTarget(tracksRef.current, target);
    };
    stop();
    setBusy('Preparing vocal');
    try {
      check();
      const audio = await bufferFor(target, backing.bpm, {
        sampleRate: 48000,
        signal: controller.signal,
        revalidate: true,
      });
      check();
      const seed = await punchSeed(target, audio, controller.signal);
      check();
      setRecordSnapshot({
        data: punchBacking(backing, target),
        offset: target.offset,
        projectId,
        target,
        seed,
      });
    } catch (e) {
      if (alive.current)
        notify(
          e instanceof Error ? e.message : 'The vocal could not be opened.',
        );
    } finally {
      if (seedJob.current === controller) seedJob.current = null;
      if (alive.current) setBusy('');
    }
  }
  async function keepTake(take: RecordedTake, signal: AbortSignal) {
    const permission = editEpoch.current;
    const snapshot = recordSnapshot;
    const check = () => {
      if (
        signal.aborted ||
        !alive.current ||
        !editAllowed.current ||
        permission !== editEpoch.current ||
        projectIdRef.current !== snapshot?.projectId
      )
        throw new Error(
          'Adding this take was cancelled or editing access ended. Your local take is still available to download.',
        );
      if (snapshot?.target && snapshot.seed)
        applyPunchClip(
          tracksRef.current,
          snapshot.target,
          snapshot.seed,
          take,
          snapshot.target.fileId!,
          [],
        );
      else if (tracksRef.current.tracks.length >= 32)
        throw new Error(
          'This session has reached 32 tracks. Download this take or remove a track before adding it.',
        );
    };
    check();
    const decoded = await context().decodeAudioData(
      await take.blob.arrayBuffer(),
    );
    check();
    const f = await upload(
      new File(
        [take.blob],
        (take.kind === 'comp' ? 'Vocal comp ' : 'Vocal take ') +
          (tracksRef.current.tracks.length + 1) +
          '.wav',
        { type: 'audio/wav' },
      ),
      'audio',
      { signal, projectId: recordSnapshot?.projectId },
    );
    check();
    if (snapshot?.target && snapshot.seed) {
      mutate((d) =>
        applyPunchClip(
          d,
          snapshot.target!,
          snapshot.seed!,
          take,
          f.id,
          peaks(decoded),
        ),
      );
      setSelected(snapshot.target.id);
      setTab('Arrangement');
      notify(
        'Vocal updated. Close the recorder to undo, or save the project to share your changes.',
      );
      return;
    }
    const t: MixerTrack = {
      ...defaults(
        (take.kind === 'comp' ? 'Vocal comp ' : 'Vocal take ') +
          (tracksRef.current.tracks.length + 1),
      ),
      fileId: f.id,
      offset: take.offset,
      duration: decoded.duration,
      peaks: peaks(decoded),
    };
    mutate((d) => ({ ...d, tracks: [...d.tracks, t] }));
    setSelected(t.id);
    setTab('Arrangement');
    notify('Take added. Save the project to keep your arrangement.');
  }
  function bounce() {
    stop();
    setExportSnapshot(structuredClone({ title, data }));
  }
  async function addSequence() {
    if (data.tracks.length >= 32)
      return notify('This session has reached 32 tracks.');
    setBusy('Building drums');
    try {
      const t = await enrich({
        id: crypto.randomUUID(),
        name: 'Drum pattern ' + (data.tracks.length + 1),
        sequence: pattern.map((r) => [...r]),
        volume: 0.8,
        pan: 0,
        muted: false,
        solo: false,
        offset: 0,
        trimStart: 0,
        trimEnd: 0,
        low: 0,
        mid: 0,
        high: 0,
      });
      mutate((d) => ({ ...d, tracks: [...d.tracks, t] }));
      setTab('Arrangement');
      setSelected(t.id);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy('');
    }
  }
  const focus = data.tracks.find((t) => t.id === selected) || data.tracks[0];
  const structuralLocked =
    playing || recording || !!busy || !!exportSnapshot || gesturing;
  const length = Math.max(
    30,
    ...data.tracks.map(
      (t) => (t.duration || 20) + t.offset - t.trimStart - t.trimEnd,
    ),
  );
  const recordDialog = recordSnapshot && (
    <RecordTake
      data={recordSnapshot.data}
      offset={recordSnapshot.offset}
      seed={recordSnapshot.seed}
      projectId={recordSnapshot.projectId}
      title={recordSnapshot.restored?.data.title || title}
      target={recordSnapshot.target}
      restored={recordSnapshot.restored}
      restoreWarning={recordSnapshot.restoreWarning}
      canEdit={canEdit && !sync.accessEnded && !recordSnapshot.restoreWarning}
      onKeep={keepTake}
      onClose={() => setRecordSnapshot(null)}
      roomAudio={roomAudio}
    />
  );
  return (
    <>
      {recordDialog}
      {importSnapshot && (
        <ImportMidi
          data={importSnapshot.data}
          start={importSnapshot.start}
          canEdit={canEdit && !sync.accessEnded}
          onClose={() => setImportSnapshot(null)}
          onAdd={(document, choices, offset, useFileTempo) => {
            if (
              !alive.current ||
              !editAllowed.current ||
              sync.accessEnded ||
              projectIdRef.current !== importSnapshot.projectId
            )
              throw Error(
                'Editing access or the project changed. Reopen MIDI import from the current project.',
              );
            const next = appendMidi(
              tracksRef.current,
              importSnapshot.data.bpm,
              document,
              choices,
              offset,
              useFileTempo,
              context().sampleRate,
            );
            mutate(() => next);
            setSelected(choices[0].id);
            setImportSnapshot(null);
            notify(
              'MIDI parts added. Save the project to keep these instruments.',
            );
          }}
        />
      )}
      {midiSnapshot && (
        <RecordMidi
          data={midiSnapshot.data}
          target={midiSnapshot.target}
          start={midiSnapshot.start}
          canEdit={canEdit && !sync.accessEnded}
          output={roomAudio?.output}
          onClose={() => setMidiSnapshot(null)}
          onKeep={(notes) => {
            if (!alive.current || !editAllowed.current || sync.accessEnded)
              throw Error(
                'Editing access ended. Download your MIDI take to keep a copy.',
              );
            const next = keepMidi(
              tracksRef.current,
              midiSnapshot.data,
              midiSnapshot.target,
              notes,
            );
            mutate(() => next);
            setSelected(midiSnapshot.target.id);
            setMidiSnapshot(null);
            notify(
              'MIDI notes added. Save the project to keep this performance.',
            );
          }}
        />
      )}
      <Dialog open={library} onOpenChange={setLibrary}>
        <DialogContent className="form-dialog">
          <DialogTitle>Add a beat to this room project</DialogTitle>
          <DialogDescription>
            Your call stays open. Choose a track available for collaboration.
          </DialogDescription>
          <div className="room-beat-picker">
            {(catalog || []).map((track) => (
              <button
                className="button secondary"
                key={track.id}
                disabled={!canEdit || !!busy}
                onClick={async () => {
                  if (
                    !editAllowed.current ||
                    tracksRef.current.tracks.length >= 32
                  )
                    return notify('This project cannot accept another track.');
                  const epoch = editEpoch.current;
                  setBusy('Loading beat');
                  try {
                    const added = await enrich(trackFrom(track));
                    if (
                      !alive.current ||
                      !editAllowed.current ||
                      epoch !== editEpoch.current
                    )
                      return;
                    mutate((d) => ({ ...d, tracks: [...d.tracks, added] }));
                    setSelected(added.id);
                    setLibrary(false);
                  } catch (e: any) {
                    notify(e.message);
                  } finally {
                    setBusy('');
                  }
                }}
              >
                <Disc3 size={18} />
                <span>
                  {track.title}
                  <small>
                    {track.creator} · {track.bpm} BPM
                  </small>
                </span>
                <Plus size={16} />
              </button>
            ))}
            {!catalog?.length && (
              <p>
                No collaborative beats are available yet. You can import your
                own audio.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {sync.accessEnded || !roomAllowed ? (
        <div className="studio-access-note" role="alert">
          <h2>
            {!roomAllowed
              ? 'This editor is paused'
              : 'Project access has ended'}
          </h2>
          <p>
            The room owner may have removed you or changed the shared project.
            Your unsaved draft is kept in this tab. Return to the room to check
            access.
          </p>
        </div>
      ) : (
        <div className="studio">
          <div className="studio-heading">
            <div>
              <span className="eyebrow">
                SESSION STUDIO <span className="studio-beta">EARLY ACCESS</span>
              </span>
              <input
                className="project-title"
                aria-label="Project title"
                readOnly={!canEdit}
                value={title}
                maxLength={120}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                }}
              />
              <span className="subtle">
                <LockKeyhole size={13} />
                {!canEdit
                  ? 'Room project · listening preview'
                  : dirty
                    ? 'Unsaved changes'
                    : 'Private project'}
              </span>
            </div>
            <div className="actions">
              <button
                className="button secondary"
                onClick={bounce}
                disabled={!!busy || recording || !data.tracks.length}
              >
                <Download size={16} /> Export audio
              </button>
              <button
                className="button primary"
                onClick={() => save()}
                disabled={!canEdit || !!sync.conflict || !!busy || recording}
              >
                <Save size={16} /> Save project
              </button>
            </div>
          </div>
          {!canEdit && (
            <p className="studio-access-note" role="status">
              Ask the project owner to allow editing in the room. Until then,
              you can listen and audition adjustments locally. Saved changes
              arrive automatically when playback stops.
            </p>
          )}
          {id && (
            <p className="studio-access-note" role="status">
              {sync.status || 'Checking for saved changes…'}
              {canEdit ? '. ' : ''}
              {canEdit &&
                ' Saving shares your arrangement and any added audio with members of rooms connected to this project.'}
            </p>
          )}
          {sync.conflict && (
            <section
              className="studio-conflict"
              role="alert"
              aria-label="Competing project changes"
            >
              <h3>Choose how to combine these changes</h3>
              <p>
                {sync.conflict.whole ? (
                  'An earlier first save contains different edits. Saving is paused. Choose your entire current draft or the saved project; this choice does not combine them automatically.'
                ) : (
                  <>
                    Saving is paused. Independent changes will be kept. Choose
                    which version to use for: {sync.conflict.labels.join(', ')}.
                  </>
                )}
              </p>
              <ConflictValues details={sync.conflict.details} />
              <div className="actions">
                <button
                  className="button secondary"
                  disabled={
                    sync.conflict.overflow || recording || playing || !!busy
                  }
                  onClick={() => sync.resolve('local')}
                >
                  {sync.conflict.whole
                    ? 'Keep my current draft'
                    : 'Use my competing changes'}
                </button>
                <button
                  className="button primary"
                  disabled={
                    sync.conflict.overflow || recording || playing || !!busy
                  }
                  onClick={() => sync.resolve('remote')}
                >
                  {sync.conflict.whole
                    ? 'Load the saved project'
                    : 'Use saved competing changes'}
                </button>
                {sync.conflict.overflow && (
                  <button
                    className="button secondary"
                    disabled={recording || playing || !!busy}
                    onClick={() => sync.loadSaved()}
                  >
                    Discard local changes and load saved project
                  </button>
                )}
              </div>
              {sync.conflict.overflow && (
                <p>
                  Reduce tracks or notes in your local draft until the combined
                  project fits the save limits, or discard your local changes
                  above.
                </p>
              )}
            </section>
          )}
          <div className="transport">
            <div className="actions">
              <button
                className={'transport-play ' + (playing ? 'active' : '')}
                onClick={play}
                disabled={!!busy || recording}
                aria-label={playing ? 'Stop playback' : 'Play arrangement'}
              >
                {playing ? (
                  <Square size={18} />
                ) : (
                  <Play size={19} fill="currentColor" />
                )}
              </button>
              <button onClick={stop} aria-label="Stop" disabled={recording}>
                <Square size={17} />
              </button>
              <button
                className={'record-button ' + (recording ? 'recording' : '')}
                onClick={record}
                disabled={!canEdit || !!busy}
                aria-label="Record microphone"
              >
                <span />
                Record
              </button>
            </div>
            <output className="time-display">
              {Math.floor(position / 60)
                .toString()
                .padStart(2, '0')}
              :
              {Math.floor(position % 60)
                .toString()
                .padStart(2, '0')}
              <span>
                .
                {Math.floor((position % 1) * 100)
                  .toString()
                  .padStart(2, '0')}
              </span>
            </output>
            <label className="tempo">
              <input
                type="number"
                min="40"
                max="240"
                value={data.bpm}
                onChange={(e) =>
                  mutate((d) => ({
                    ...d,
                    bpm: Math.max(
                      40,
                      Math.min(240, Number(e.target.value) || 92),
                    ),
                    tracks: d.tracks.map((t) =>
                      t.demo || t.sequence || t.notes
                        ? { ...t, peaks: undefined, duration: undefined }
                        : t,
                    ),
                  }))
                }
              />{' '}
              BPM
            </label>
            <span className="meter">4 / 4</span>
            <meter
              aria-label="Master peak level"
              min={0}
              max={1}
              value={Math.min(1, level)}
              className="master-meter"
            />
            <div className="save-state">
              {busy && (
                <>
                  <Loader2 className="spin" size={15} />
                  {busy}…
                </>
              )}
            </div>
          </div>
          <div className="studio-utilities">
            <div className="actions">
              <button
                className="button secondary"
                disabled={!past.current.length || structuralLocked}
                onClick={() => undo()}
              >
                Undo
              </button>
              <button
                className="button secondary"
                disabled={!future.current.length || structuralLocked}
                onClick={() => undo(true)}
              >
                Redo
              </button>
              <button
                className="button secondary"
                disabled={
                  !canEdit ||
                  !focus?.duration ||
                  data.tracks.length >= 32 ||
                  structuralLocked
                }
                onClick={duplicate}
              >
                Duplicate clip
              </button>
              <button
                className="button secondary"
                disabled={!canManage || !id}
                onClick={checkpointList}
              >
                Saved versions
              </button>
            </div>
            <label className="inline-switch">
              <Switch
                checked={autosave}
                onCheckedChange={setAutosave}
                disabled={!canEdit || !id}
                aria-label="Autosave"
              />{' '}
              Autosave
            </label>
            <span className="small-note">
              {!canEdit
                ? 'Local listening preview'
                : saveLabel ||
                  (id
                    ? autosave
                      ? 'Autosave after 10 seconds idle'
                      : 'Autosave is off'
                    : 'Save once to enable autosave')}
            </span>
          </div>
          <div className="loop-controls">
            <label className="inline-switch">
              <Switch
                checked={loop}
                onCheckedChange={setLoop}
                aria-label="Loop playback"
              />{' '}
              Loop
            </label>
            <label>
              In{' '}
              <input
                aria-label="Loop start seconds"
                type="number"
                min={0}
                max={Math.max(0, length - 0.25)}
                step={0.25}
                value={loopStart}
                onChange={(e) =>
                  setLoopStart(
                    Math.max(0, Math.min(length - 0.25, +e.target.value)),
                  )
                }
              />
            </label>
            <label>
              Out{' '}
              <input
                aria-label="Loop end seconds"
                type="number"
                min={loopStart + 0.25}
                max={length}
                step={0.25}
                value={loopEnd}
                onChange={(e) =>
                  setLoopEnd(
                    Math.max(
                      loopStart + 0.25,
                      Math.min(length, +e.target.value),
                    ),
                  )
                }
              />
            </label>
            <label className="inline-switch">
              <Switch
                checked={metronome}
                onCheckedChange={setMetronome}
                aria-label="Metronome"
              />{' '}
              Metronome
            </label>
            <label>
              Start at{' '}
              <input
                aria-label="Playback start seconds"
                type="number"
                min={0}
                max={length}
                step={0.001}
                disabled={playing || recording}
                value={Number(position.toFixed(3))}
                onChange={(e) =>
                  setPosition(Math.max(0, Math.min(length, +e.target.value)))
                }
              />
            </label>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
            <TabsList className="studio-tabs">
              <TabsTrigger value="Arrangement">
                <AudioLines size={15} /> Arrangement
              </TabsTrigger>
              <TabsTrigger value="Piano roll">Piano roll</TabsTrigger>
              <TabsTrigger value="Automation">Automation</TabsTrigger>
              <TabsTrigger value="Mixer">
                <SlidersHorizontal size={15} /> Mixer
              </TabsTrigger>
              <TabsTrigger value="Drum sequencer">
                <Disc3 size={15} /> Drum sequencer
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === 'Arrangement' && (
            <div className="clip-tools">
              <div className="clip-tool-actions">
                <button
                  className="button secondary"
                  disabled={!canEdit || !focus?.fileId || structuralLocked}
                  onClick={() => void recordSelected()}
                >
                  Punch in selected vocal
                </button>
                <label>
                  Grid{' '}
                  <select
                    aria-label="Timeline grid"
                    value={grid}
                    onChange={(e) => setGrid(e.target.value as ClipGrid)}
                  >
                    <option value="off">Off · 10 ms nudge</option>
                    <option value="bar">1 bar</option>
                    <option value="beat">1 beat</option>
                    <option value="half">½ beat</option>
                    <option value="quarter">¼ beat</option>
                  </select>
                </label>
                <label>
                  Zoom{' '}
                  <select
                    aria-label="Timeline zoom"
                    value={zoom}
                    onChange={(e) => setZoom(+e.target.value)}
                  >
                    <option value={1}>Fit</option>
                    <option value={2}>2×</option>
                    <option value={4}>4×</option>
                    <option value={8}>8×</option>
                  </select>
                </label>
                <button
                  className="button secondary"
                  disabled={!canEdit || !focus?.duration || structuralLocked}
                  onClick={() =>
                    moveSelected(
                      focus.offset - (gridSeconds(grid, data.bpm) || 0.01),
                    )
                  }
                >
                  ← Nudge
                </button>
                <button
                  className="button secondary"
                  disabled={!canEdit || !focus?.duration || structuralLocked}
                  onClick={() =>
                    moveSelected(
                      focus.offset + (gridSeconds(grid, data.bpm) || 0.01),
                    )
                  }
                >
                  Nudge →
                </button>
                <button
                  className="button primary"
                  disabled={
                    !canEdit ||
                    !focus?.duration ||
                    data.tracks.length >= 32 ||
                    structuralLocked
                  }
                  onClick={split}
                >
                  Split at playhead
                </button>
              </div>
              <p>
                Click the ruler or a track to place the playhead. Splitting
                creates separate channels; compression may change at the cut.
                Automation stays at its project times when clips move.
              </p>
            </div>
          )}
          {tab === 'Arrangement' ? (
            <div className="studio-workspace">
              <div className="arrangement">
                <ArrangementTimeline
                  tracks={data.tracks}
                  selected={focus?.id}
                  length={length}
                  position={position}
                  zoom={zoom}
                  canEdit={canEdit}
                  locked={structuralLocked}
                  onSelect={setSelected}
                  onSeek={(seconds) =>
                    setPosition(snapTime(seconds, grid, data.bpm))
                  }
                  onPatch={patch}
                  onRemove={setRemove}
                />
                {!data.tracks.length ? (
                  <div className="studio-empty">
                    <AudioLines size={46} />
                    <h2>Every great track starts somewhere.</h2>
                    <p>
                      {canEdit
                        ? 'Bring in a beat, record a vocal, or build your own drums.'
                        : 'The owner has not added tracks to this room project yet.'}
                    </p>
                    <button
                      className="button primary"
                      onClick={browse}
                      disabled={!canEdit}
                    >
                      <Disc3 size={17} /> Find a beat
                    </button>
                  </div>
                ) : null}
                <div className="add-track">
                  <button
                    disabled={!canEdit || structuralLocked}
                    onClick={() => {
                      if (!editAllowed.current || structuralLocked) return;
                      setImportSnapshot({
                        data: structuredClone(tracksRef.current),
                        start: position,
                        projectId: projectIdRef.current,
                      });
                    }}
                  >
                    <Plus size={16} /> Import MIDI file
                  </button>
                  <button
                    onClick={() => input.current?.click()}
                    disabled={!canEdit || !!busy}
                  >
                    <Plus size={16} /> Import audio
                  </button>
                  <button onClick={browse} disabled={!canEdit}>
                    <Disc3 size={16} /> Add from beat library
                  </button>
                </div>
                <input
                  ref={input}
                  type="file"
                  disabled={!canEdit}
                  accept="audio/*,.wav,.mp3,.flac,.m4a"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) addFile(f);
                    e.target.value = '';
                  }}
                />
              </div>
              <aside className="mixer">
                <div className="section-title">
                  <h2>
                    <SlidersHorizontal size={16} /> Channel strip
                  </h2>
                </div>
                {focus ? (
                  <>
                    <h3>{focus.name}</h3>
                    <Range
                      label={'Volume · ' + Math.round(focus.volume * 100) + '%'}
                      value={focus.volume}
                      min={0}
                      max={1.5}
                      onChange={(v) => patch(focus.id, { volume: v })}
                    />
                    <Range
                      label={
                        'Pan · ' +
                        (focus.pan === 0
                          ? 'Center'
                          : Math.round(Math.abs(focus.pan) * 100) +
                            (focus.pan < 0 ? ' L' : ' R'))
                      }
                      value={focus.pan}
                      min={-1}
                      max={1}
                      onChange={(v) => patch(focus.id, { pan: v })}
                    />
                    <div className="mixer-divider">3-BAND EQ</div>
                    {(['low', 'mid', 'high'] as const).map((b) => (
                      <Range
                        key={b}
                        label={b + ' · ' + focus[b] + ' dB'}
                        min={-12}
                        max={12}
                        step={1}
                        value={focus[b]}
                        onChange={(v) => patch(focus.id, { [b]: v })}
                      />
                    ))}
                    <div className="mixer-divider">LIVE EFFECTS</div>
                    {(['compression', 'reverb', 'delay'] as const).map((k) => (
                      <Range
                        key={k}
                        label={
                          k + ' · ' + Math.round((focus[k] || 0) * 100) + '%'
                        }
                        value={focus[k] || 0}
                        onChange={(v) => patch(focus.id, { [k]: v })}
                      />
                    ))}
                    <div className="mixer-divider">CLIP FADES</div>
                    {(['fadeIn', 'fadeOut'] as const).map((k) => (
                      <label className="field" key={k}>
                        <span>
                          {k === 'fadeIn' ? 'Fade in' : 'Fade out'} (seconds)
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={Math.min(30, focus.duration || 20)}
                          step={0.1}
                          value={focus[k] || 0}
                          disabled={
                            !canEdit || !focus.duration || structuralLocked
                          }
                          onChange={(e) =>
                            patch(focus.id, {
                              [k]: Math.max(0, Math.min(30, +e.target.value)),
                              [k === 'fadeIn' ? 'fadeStart' : 'fadeEnd']:
                                k === 'fadeIn'
                                  ? focus.trimStart
                                  : focus.duration! - focus.trimEnd,
                            })
                          }
                        />
                      </label>
                    ))}
                    <div className="mixer-divider">ARRANGEMENT</div>
                    <label className="field">
                      <span>Start position (seconds)</span>
                      <input
                        type="number"
                        min="0"
                        max={
                          300 -
                          ((focus.duration || 300) -
                            focus.trimStart -
                            focus.trimEnd)
                        }
                        step=".001"
                        disabled={
                          !canEdit || !focus.duration || structuralLocked
                        }
                        value={focus.offset}
                        onChange={(e) => moveSelected(+e.target.value)}
                      />
                    </label>
                    {(['trimStart', 'trimEnd'] as const).map((k) => (
                      <label className="field" key={k}>
                        <span>
                          {k === 'trimStart' ? 'Trim beginning' : 'Trim ending'}{' '}
                          (seconds)
                        </span>
                        <input
                          type="number"
                          min="0"
                          max={Math.max(
                            0,
                            (focus.duration || 20) -
                              0.01 -
                              focus[
                                k === 'trimStart' ? 'trimEnd' : 'trimStart'
                              ],
                          )}
                          step=".001"
                          value={focus[k]}
                          disabled={
                            !canEdit || !focus.duration || structuralLocked
                          }
                          onChange={(e) => trimSelected(k, +e.target.value)}
                        />
                      </label>
                    ))}
                  </>
                ) : (
                  <p>Select a track to adjust its sound.</p>
                )}
              </aside>
            </div>
          ) : tab === 'Mixer' ? (
            <MixerBoard
              tracks={data.tracks}
              levels={levels}
              disabled={!canEdit || recording || !!busy || !!exportSnapshot}
              routing={routingFor(data)}
              onRouting={(routing) => {
                if (
                  editAllowed.current &&
                  !recording &&
                  !busy &&
                  !exportSnapshot
                )
                  mutate((d) => ({ ...d, routing }));
              }}
              onPatch={patch}
              onSelect={(tid) => {
                endGesture();
                setSelected(tid);
                setTab('Arrangement');
              }}
              onGestureStart={beginGesture}
              onGestureEnd={endGesture}
            />
          ) : tab === 'Piano roll' ? (
            <PianoRoll
              track={focus}
              bpm={data.bpm}
              disabled={!canEdit || structuralLocked}
              onRecord={() => {
                if (!editAllowed.current || structuralLocked || !focus?.notes)
                  return;
                const start = Math.max(
                  0,
                  ((position - focus.offset) * data.bpm) / 60,
                );
                try {
                  midiPlan(
                    focus,
                    data.bpm,
                    start,
                    Math.min(
                      8,
                      256 - start,
                      ((300 - focus.offset) * data.bpm) / 60 - start,
                    ),
                  );
                  setMidiSnapshot(
                    structuredClone({ data, target: focus, start }),
                  );
                } catch (e) {
                  notify(
                    e instanceof Error
                      ? e.message
                      : 'Select an available instrument.',
                  );
                }
              }}
              onAdd={addInstrument}
              onChange={(p) => {
                if (editAllowed.current && !structuralLocked && focus)
                  patch(focus.id, p);
              }}
            />
          ) : tab === 'Automation' ? (
            <AutomationEditor
              track={focus}
              length={length}
              onChange={(p) => focus && patch(focus.id, p)}
            />
          ) : (
            <div className="sequencer">
              <div className="section-title">
                <div>
                  <h2>Make your own rhythm.</h2>
                  <p>
                    16 steps. Three sounds. Eight bars when added to your
                    arrangement.
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={addSequence}
                >
                  <Plus size={15} /> Add drum track
                </button>
              </div>
              <div className="step-ruler">
                <span />
                {Array.from({ length: 16 }, (_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
              {['Kick', 'Snare', 'Hi-hat'].map((name, r) => (
                <div className="step-row" key={name}>
                  <strong>{name}</strong>
                  {pattern[r].map((v, i) => (
                    <button
                      key={i}
                      className={
                        (v ? 'enabled ' : '') +
                        (i % 4 === 0 ? 'beat-start' : '')
                      }
                      aria-label={name + ' step ' + (i + 1)}
                      aria-pressed={!!v}
                      onClick={() =>
                        setPattern((p) =>
                          p.map((row, ri) =>
                            ri === r
                              ? row.map((x, xi) => (xi === i ? 1 - x : x))
                              : row,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              ))}
              <div className="actions">
                <button
                  className="button secondary"
                  disabled={!!busy || recording}
                  onClick={async () => {
                    stop();
                    const epoch = ++generation.current;
                    setBusy('Loading drums');
                    try {
                      const engine = await playMix(
                        {
                          bpm: data.bpm,
                          tracks: [
                            {
                              id: 'preview',
                              name: 'Drums',
                              sequence: pattern,
                              volume: 0.8,
                              pan: 0,
                              muted: false,
                              solo: false,
                              offset: 0,
                              trimStart: 0,
                              trimEnd: 0,
                              low: 0,
                              mid: 0,
                              high: 0,
                            },
                          ],
                        },
                        () => setPlaying(false),
                        { output: roomAudio?.output },
                      );
                      if (epoch !== generation.current || !alive.current) {
                        engine.stop();
                        return;
                      }
                      playback.current = engine;
                      setPlaying(true);
                    } catch (e: any) {
                      notify(e.message);
                    } finally {
                      if (alive.current) setBusy('');
                    }
                  }}
                >
                  <Play size={16} /> Audition pattern
                </button>
                <button
                  className="button secondary"
                  onClick={() => setPattern(pattern.map((r) => r.map(() => 0)))}
                >
                  Clear pattern
                </button>
              </div>
            </div>
          )}
          <div className="studio-footnote">
            <HeadphoneNote />
            <p>
              Browser recovery keeps arrangement edits, not takes waiting to be
              added. Keep or download each recording before closing the page.
              Use headphones while recording. Recording is limited to 2 minutes;
              the arrangement to 5 minutes. Exports can include extra time for
              effect tails. Groups, sends, shared returns, volume, pan, EQ,
              compression, reverb, and delay respond during playback. Note
              edits, fades, automation, and timing changes apply on the next
              playback. Tempo changes affect generated instruments and drums;
              imported audio keeps its original speed.
            </p>
          </div>
          <Dialog
            open={versions !== null}
            onOpenChange={(v) => !v && setVersions(null)}
          >
            <DialogContent className="form-dialog">
              <DialogTitle>Saved versions</DialogTitle>
              <DialogDescription>
                Manual saves keep up to 20 arrangement checkpoints. Audio files
                are referenced, not duplicated.
              </DialogDescription>
              {versions?.length ? (
                versions.map((v) => (
                  <button
                    key={v.id}
                    className="version-row"
                    onClick={() => {
                      mutate(() => JSON.parse(v.data));
                      setTitle(v.title);
                      setVersions(null);
                      notify(
                        'Version restored to the editor. Save to keep this change.',
                      );
                    }}
                  >
                    <strong>{v.title}</strong>
                    <span>{new Date(v.created).toLocaleString()}</span>
                    <span>Restore</span>
                  </button>
                ))
              ) : (
                <p>No checkpoints yet. Save the project to create one.</p>
              )}
            </DialogContent>
          </Dialog>
          {exportSnapshot && (
            <ExportAudio
              {...exportSnapshot}
              onClose={() => setExportSnapshot(null)}
            />
          )}
          <Confirm
            open={!!remove}
            onClose={() => setRemove('')}
            onConfirm={() =>
              mutate((d) => ({
                ...d,
                tracks: d.tracks.filter((t) => t.id !== remove),
              }))
            }
            title="Remove this track?"
            description="This removes it from the arrangement. Your original upload stays in your library."
          />
        </div>
      )}{' '}
    </>
  );
}
function HeadphoneNote() {
  return <Volume2 size={17} />;
}
