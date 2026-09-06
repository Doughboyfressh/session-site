'use client';
import { useEffect, useRef, useState } from 'react';
import { action } from './helpers';
import {
  mergeProject,
  cleanProject,
  sameProject,
  type ProjectSnapshot,
  type MergeChoice,
  type MergeDetail,
} from '@/lib/project-merge';

type Saved = ProjectSnapshot & { revision: number };
export function useProjectSync(options: {
  initial: any;
  id: string;
  snapshot: ProjectSnapshot;
  paused: boolean;
  apply: (
    snapshot: ProjectSnapshot,
    dirty: boolean,
    resetHistory?: boolean,
  ) => void;
  permissionEnded: () => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const baseline = useRef<Saved>(
    options.initial?.baseline || {
      title: options.initial?.title || 'Untitled session',
      data: options.initial?.data || { bpm: 92, tracks: [] },
      revision: options.initial?.revision || 0,
    },
  );
  const [revision, setRevision] = useState(baseline.current.revision);
  const [canEdit, setCanEdit] = useState(options.initial?.canEdit !== false);
  const [canManage, setCanManage] = useState(
    options.initial?.canManage ?? options.initial?.canEdit !== false,
  );
  const [accessEnded, setAccessEnded] = useState(false);
  const [status, setStatus] = useState('');
  const [conflict, setConflict] = useState<{
    remote: Saved;
    labels: string[];
    details: MergeDetail[];
    overflow: boolean;
  } | null>(null);
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;
  const editable = useRef(canEdit),
    saving = useRef(false),
    mounted = useRef(true),
    readSequence = useRef(0);
  function permissions(p: any) {
    if (editable.current && !p.canEdit) latest.current.permissionEnded();
    editable.current = !!p.canEdit;
    setCanEdit(!!p.canEdit);
    setCanManage(!!p.canManage);
  }
  function receive(p: any) {
    permissions(p);
    setAccessEnded(false);
    if (!p.data || p.revision <= baseline.current.revision) {
      if (!conflictRef.current) setStatus('Saved changes are up to date');
      return;
    }
    if (saving.current || latest.current.paused) {
      setStatus('New saved changes waiting until playback or recording stops');
      return;
    }
    const result = mergeProject(baseline.current, latest.current.snapshot, p);
    if (result.conflicts.length) {
      const next = {
        remote: p,
        labels: result.conflicts,
        details: result.details,
        overflow: result.overflow,
      };
      conflictRef.current = next;
      setConflict(next);
      setStatus('Review competing changes before saving');
      return;
    }
    baseline.current = { title: p.title, data: p.data, revision: p.revision };
    setRevision(p.revision);
    setConflict(null);
    conflictRef.current = null;
    latest.current.apply(result.project, !sameProject(result.project, p));
    setStatus('Saved changes received from ' + p.lastEditorName);
  }
  async function refresh(signal?: AbortSignal) {
    if (!latest.current.id) return;
    const sequence = ++readSequence.current;
    if (signal?.aborted) return;
    const request = new AbortController();
    const cancel = () => request.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 12000);
    try {
      const response = await fetch(
        '/api/project/' +
          encodeURIComponent(latest.current.id) +
          '?revision=' +
          baseline.current.revision,
        { cache: 'no-store', signal: request.signal },
      );
      const p = (await response.json()) as any;
      if (
        !mounted.current ||
        signal?.aborted ||
        sequence !== readSequence.current
      )
        return;
      if (response.status === 401 || response.status === 403) {
        permissions({ canEdit: false, canManage: false });
        latest.current.permissionEnded();
        setAccessEnded(true);
        setStatus('Project access has ended');
        return;
      }
      if (!response.ok) throw new Error(p.error);
      receive(p);
    } catch {
      if (
        mounted.current &&
        !signal?.aborted &&
        sequence === readSequence.current
      )
        setStatus(
          'Connection interrupted. Your local changes are kept; retrying…',
        );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  }
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refreshRef.current(abort.signal);
      if (!abort.signal.aborted) timer = setTimeout(poll, 4000);
    }
    if (options.id) void poll();
    return () => {
      mounted.current = false;
      abort.abort();
      clearTimeout(timer);
    };
  }, [options.id]);
  async function save(checkpoint: boolean) {
    if (!editable.current)
      throw new Error('Ask the project owner for editing access.');
    if (conflictRef.current)
      throw new Error('Review competing changes before saving.');
    if (saving.current) throw new Error('A save is already in progress.');
    saving.current = true;
    const submitted = structuredClone(cleanProject(latest.current.snapshot));
    try {
      const r = await action({
        action: 'project',
        id: latest.current.id || undefined,
        ...submitted,
        baseRevision: baseline.current.revision,
        checkpoint,
      });
      if (!mounted.current) return r;
      baseline.current = { ...submitted, revision: r.revision };
      setRevision(r.revision);
      // A delayed save acknowledgement must never undo a later permission revocation.
      if (!latest.current.id) setCanManage(true);
      // Edits made while the request was in flight remain in the local draft.
      latest.current.apply(
        latest.current.snapshot,
        !sameProject(latest.current.snapshot, submitted),
        false,
      );
      return r;
    } catch (e: any) {
      if (e.status === 403) permissions({ canEdit: false, canManage: false });
      if (e.status === 409 || e.status === 403) {
        saving.current = false;
        await refreshRef.current();
      }
      throw e;
    } finally {
      saving.current = false;
    }
  }
  function resolve(choice: MergeChoice) {
    if (latest.current.paused) return;
    const current = conflictRef.current;
    if (!current) return;
    const result = mergeProject(
      baseline.current,
      latest.current.snapshot,
      current.remote,
      choice,
    );
    if (result.overflow) return;
    baseline.current = {
      title: current.remote.title,
      data: current.remote.data,
      revision: current.remote.revision,
    };
    setRevision(current.remote.revision);
    conflictRef.current = null;
    setConflict(null);
    latest.current.apply(
      result.project,
      !sameProject(result.project, current.remote),
    );
    setStatus('Choice applied to your draft. Save to share it.');
  }
  function loadSaved() {
    if (latest.current.paused) return;
    if (!conflictRef.current) return;
    const p = conflictRef.current.remote;
    baseline.current = { title: p.title, data: p.data, revision: p.revision };
    setRevision(p.revision);
    conflictRef.current = null;
    setConflict(null);
    latest.current.apply(p, false);
    setStatus('Latest saved project loaded');
  }
  return {
    baseline,
    revision,
    canEdit,
    canManage,
    accessEnded,
    status,
    conflict,
    save,
    resolve,
    loadSaved,
  };
}
