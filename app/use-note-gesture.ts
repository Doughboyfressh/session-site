'use client';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { MixerTrack, Note } from '@/lib/audio';
import { editNotes } from '@/lib/note-edit';

type Point = { x: number; y: number };
type Box = { left: number; top: number; width: number; height: number };
type Gesture = {
  pointer: number;
  kind: 'drag' | 'resize' | 'box';
  origin: Point;
  width: number;
  threshold: number;
  moved: boolean;
  ids: string[];
  beforeSelection: string[];
  additive: boolean;
  next?: Note[];
  selected?: string[];
  error?: string;
  source: string;
  tapped?: string;
};

/** Drafts stay local: the parent receives at most one validated patch on release. */
export function useNoteGesture(options: {
  track?: MixerTrack;
  bpm: number;
  beats: number;
  top: number;
  grid: number;
  selected: string[];
  multiple: boolean;
  boxMode: boolean;
  disabled: boolean;
  onSelect: (ids: string[]) => void;
  onCommit: (notes: Note[]) => boolean;
  onError: (message: string) => void;
  onActivity?: (active: boolean) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const pending = useRef<Gesture | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState<Note[] | undefined>();
  const [box, setBox] = useState<Box | undefined>();
  const [previewSelection, setPreviewSelection] = useState<
    string[] | undefined
  >();
  const [status, setStatus] = useState('');
  const suppressClick = useRef(false);
  const t = options.track;
  // Waveform enrichment and unrelated mixer changes must not cancel a gesture.
  const source = JSON.stringify([
    t?.id,
    t?.notes,
    t?.noteLoopBeats,
    t?.sound,
    t?.sample,
    t?.offset,
    t?.trimStart,
    t?.trimEnd,
    t?.splitFrom,
    t?.fileId,
    t?.sequence,
    t?.demo,
    options.bpm,
    options.grid,
    options.top,
    options.beats,
  ]);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  function finish(commit = false, unmount = false) {
    const g = pending.current;
    if (!g) return;
    pending.current = null;
    // The click following a captured pointer must not add a note or collapse a chord.
    suppressClick.current = true;
    const current = latest.current;
    if (!unmount) {
      if (
        commit &&
        !current.disabled &&
        g.source === sourceRef.current &&
        g.moved
      ) {
        if (g.error) {
          current.onSelect(g.beforeSelection);
          current.onError(g.error);
        } else if (g.kind === 'box') current.onSelect(g.selected || []);
        else if (g.next && current.onCommit(g.next)) current.onSelect(g.ids);
      } else if (g.moved) current.onSelect(g.beforeSelection);
      setActive(false);
      setDraft(undefined);
      setBox(undefined);
      setPreviewSelection(undefined);
      setStatus('');
    }
    const el = gridRef.current;
    if (el?.hasPointerCapture(g.pointer)) el.releasePointerCapture(g.pointer);
    current.onActivity?.(false);
  }
  const cancel = () => finish();
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    if (options.disabled || pending.current?.source !== source)
      finishRef.current();
  }, [options.disabled, source]);
  useEffect(() => {
    const cancel = () => finishRef.current();
    const hidden = () => {
      if (document.hidden) cancel();
    };
    const key = (e: KeyboardEvent) => {
      if (!pending.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
      // Keep focus and unrelated edits stable while a pointer is captured.
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    window.addEventListener('keydown', key, true);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('visibilitychange', hidden);
      finishRef.current(false, true);
    };
  }, []);

  function point(e: ReactPointerEvent): Point {
    const rect = gridRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function begin(e: ReactPointerEvent, note?: Note) {
    if (
      pending.current ||
      options.disabled ||
      e.button !== 0 ||
      !e.isPrimary ||
      !t?.notes
    )
      return;
    suppressClick.current = false;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!note && !(options.boxMode || options.multiple || additive)) return;
    // Modifier/touch multi-select taps keep the existing toggle behavior.
    const kind = note
      ? (e.target as HTMLElement).closest('[data-note-resize]')
        ? 'resize'
        : 'drag'
      : 'box';
    const ids =
      note && options.selected.includes(note.id)
        ? options.selected
        : note
          ? [note.id]
          : [];
    const el = gridRef.current!;
    pending.current = {
      pointer: e.pointerId,
      kind,
      origin: point(e),
      width: el.getBoundingClientRect().width,
      threshold: e.pointerType === 'touch' ? 8 : 4,
      moved: false,
      ids,
      beforeSelection: options.selected,
      additive: additive || options.multiple,
      source,
      tapped: note?.id,
    };
    el.setPointerCapture(e.pointerId);
    (el.closest('.piano-editor') as HTMLElement)?.focus({
      preventScroll: true,
    });
    e.preventDefault();
    e.stopPropagation();
    setActive(true);
    options.onError('');
    options.onActivity?.(true);
  }
  function move(e: ReactPointerEvent) {
    const g = pending.current;
    if (!g || e.pointerId !== g.pointer || !t?.notes) return;
    if (options.disabled || source !== g.source) {
      cancel();
      return;
    }
    const p = point(e),
      dx = p.x - g.origin.x,
      dy = p.y - g.origin.y;
    if (!g.moved && Math.hypot(dx, dy) < g.threshold) return;
    g.moved = true;
    e.preventDefault();
    if (g.kind === 'box') {
      const left = Math.max(0, Math.min(g.origin.x, p.x));
      const right = Math.min(g.width, Math.max(g.origin.x, p.x));
      const top = Math.max(0, Math.min(g.origin.y, p.y));
      const bottom = Math.min(600, Math.max(g.origin.y, p.y));
      const ids = t.notes
        .filter((n) => {
          const x = (n.start / options.beats) * g.width,
            y = (options.top - n.pitch) * 24 + 2;
          return (
            n.pitch <= options.top &&
            n.pitch >= options.top - 24 &&
            x < right &&
            x + Math.max(5, (n.length / options.beats) * g.width) > left &&
            y < bottom &&
            y + 20 > top
          );
        })
        .map((n) => n.id);
      g.selected = [
        ...new Set([...(g.additive ? g.beforeSelection : []), ...ids]),
      ];
      setPreviewSelection(g.selected);
      setBox({
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      });
      setStatus(
        `${g.selected.length} notes in selection. Release to select; Escape cancels.`,
      );
      return;
    }
    const beats =
      Math.round(((dx / g.width) * options.beats) / options.grid) *
      options.grid;
    const semitones = -Math.round(dy / 24);
    try {
      const result = editNotes(
        t,
        options.bpm,
        g.ids,
        g.kind === 'resize'
          ? { kind: 'resize', beats }
          : { kind: 'drag', beats, semitones },
      );
      g.next = result.notes;
      g.error = undefined;
      setDraft(result.notes);
      setPreviewSelection(g.ids);
      setStatus(
        g.kind === 'resize'
          ? `Length change: ${beats > 0 ? '+' : ''}${beats} beats. Release to keep; Escape cancels.`
          : `Move: ${beats > 0 ? '+' : ''}${beats} beats, ${semitones > 0 ? '+' : ''}${semitones} semitones. Release to keep; Escape cancels.`,
      );
    } catch (error) {
      g.next = undefined;
      g.error =
        error instanceof Error
          ? error.message
          : 'These notes cannot move here.';
      setDraft(undefined);
      setStatus(g.error + ' Move back within the limits or release to cancel.');
    }
  }
  return {
    gridRef,
    active,
    draft,
    box,
    status,
    previewSelection,
    begin,
    move,
    cancel,
    end: (e: ReactPointerEvent) => {
      if (e.pointerId !== pending.current?.pointer) return;
      move(e);
      const g = pending.current;
      // Capture routes an ordinary tap to the grid. Handle its original note here.
      if (g && !g.moved && g.kind !== 'box') {
        const tapped = g.tapped!;
        options.onSelect(
          options.multiple || g.additive
            ? g.beforeSelection.includes(tapped)
              ? g.beforeSelection.filter((n) => n !== tapped)
              : [...g.beforeSelection, tapped]
            : [tapped],
        );
        finish(true);
        suppressClick.current = true;
      } else {
        if (g && !g.moved && !g.additive) options.onSelect([]);
        finish(true);
      }
    },
    lost: (e: ReactPointerEvent) => {
      if (e.pointerId === pending.current?.pointer) cancel();
    },
    consumeClick: (detail: number) => {
      if (!suppressClick.current || detail === 0) return false;
      suppressClick.current = false;
      return true;
    },
    freshPointer: () => {
      if (!pending.current) suppressClick.current = false;
    },
  };
}
