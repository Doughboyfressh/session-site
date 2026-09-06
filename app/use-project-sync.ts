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
import {
  validCreation,
  creationHash,
  type ProjectCreation,
} from '@/lib/project-creation';

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
  prepareCreation?: (
    creation: ProjectCreation,
    baseline: Saved,
  ) => Promise<boolean>;
  adoptProject?: (id: string) => void;
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
  const [creation, setCreation] = useState<ProjectCreation | undefined>(
    options.initial?.creation,
  );
  const pendingCreation = useRef<{
    creation: ProjectCreation;
    snapshot: ProjectSnapshot;
  } | null>(
    !options.id && validCreation(options.initial?.creation)
      ? {
          creation: options.initial.creation,
          snapshot: structuredClone(cleanProject(baseline.current)),
        }
      : null,
  );
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
    whole?: boolean;
  } | null>(
    options.initial?.reviewFirstSave
      ? {
          remote: baseline.current,
          labels: ['Earlier first save and recovered edits'],
          details: [],
          overflow: false,
          whole: true,
        }
      : null,
  );
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
    if (conflictRef.current?.whole) {
      const next = { ...conflictRef.current, remote: p };
      conflictRef.current = next;
      setConflict(next);
      setStatus('Review the earlier first save before saving');
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
    let submitted = structuredClone(cleanProject(latest.current.snapshot));
    submitted.title = submitted.title.trim();
    const creating = !latest.current.id;
    if (creating && !pendingCreation.current) {
      const creation = { key: crypto.randomUUID(), checkpoint };
      pendingCreation.current = { creation, snapshot: submitted };
      baseline.current = { ...submitted, revision: 0 };
      setCreation(creation);
    }
    if (creating)
      submitted = structuredClone(pendingCreation.current!.snapshot);
    const timeout = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sent = false;
    function adoptForReview(p: any) {
      const saved = { title: p.title, data: p.data, revision: p.revision };
      baseline.current = saved;
      setRevision(p.revision);
      const next = {
        remote: saved,
        labels: ['Earlier first save and current edits'],
        details: [],
        overflow: false,
        whole: true,
      };
      conflictRef.current = next;
      setConflict(next);
      pendingCreation.current = null;
      setCreation(undefined);
      permissions(p);
      latest.current.adoptProject?.(p.id);
      latest.current.apply(latest.current.snapshot, true, false);
      setStatus('Review the earlier first save before saving');
      return {
        id: p.id,
        revision: p.revision,
        remainingChanges: true,
        needsReview: true,
      };
    }
    try {
      timer = setTimeout(() => timeout.abort(), 15000);
      if (creating && pendingCreation.current!.creation.retryCurrent) {
        const attempt = pendingCreation.current!;
        const resolved = await action(
          { action: 'projectCreation', key: attempt.creation.key },
          { signal: timeout.signal },
        );
        if (!mounted.current) throw new Error('This studio was closed.');
        if (resolved.found) {
          const hash = await creationHash(
            attempt.snapshot,
            attempt.creation.checkpoint,
          );
          if (!mounted.current) throw new Error('This studio was closed.');
          if (resolved.receipt.requestHash !== hash)
            return adoptForReview(resolved.project);
        } else {
          attempt.snapshot = structuredClone(
            cleanProject(latest.current.snapshot),
          );
          attempt.snapshot.title = attempt.snapshot.title.trim();
          attempt.creation = { ...attempt.creation, retryCurrent: false };
          baseline.current = { ...attempt.snapshot, revision: 0 };
          setCreation(attempt.creation);
        }
        submitted = structuredClone(attempt.snapshot);
      }
      if (creating)
        await latest.current.prepareCreation?.(
          pendingCreation.current!.creation,
          { ...submitted, revision: 0 },
        );
      if (!mounted.current)
        throw new Error('This studio was closed before the save was sent.');
      clearTimeout(timer);
      timer = setTimeout(() => timeout.abort(), 15000);
      sent = true;
      const r = await action(
        {
          action: 'project',
          id: latest.current.id || undefined,
          ...submitted,
          baseRevision: baseline.current.revision,
          checkpoint,
          ...(creating ? { creation: pendingCreation.current!.creation } : {}),
        },
        { signal: timeout.signal },
      );
      if (!mounted.current) return r;
      baseline.current = { ...submitted, revision: r.revision };
      setRevision(r.revision);
      if (creating) {
        pendingCreation.current = null;
        setCreation(undefined);
      }
      // A delayed save acknowledgement must never undo a later permission revocation.
      if (!latest.current.id) setCanManage(true);
      // Edits made while the request was in flight remain in the local draft.
      latest.current.apply(
        latest.current.snapshot,
        !sameProject(latest.current.snapshot, submitted),
        false,
      );
      return {
        ...r,
        remainingChanges: !sameProject(latest.current.snapshot, submitted),
      };
    } catch (e: any) {
      if (!mounted.current) throw e;
      // A rejected retry does not prove an earlier attempt failed. Keep its key.
      if (
        creating &&
        pendingCreation.current &&
        [400, 401, 403, 409, 413].includes(e.status)
      ) {
        pendingCreation.current.creation = {
          ...pendingCreation.current.creation,
          retryCurrent: true,
        };
        setCreation(pendingCreation.current.creation);
        if (e.status === 409) {
          const resolved = await action(
            {
              action: 'projectCreation',
              key: pendingCreation.current.creation.key,
            },
            { signal: timeout.signal },
          );
          if (mounted.current && resolved.found)
            return adoptForReview(resolved.project);
        }
      }
      if (creating && (!e.status || e.status >= 500) && sent)
        throw new Error(
          'The save could not be confirmed. Choose Save project again to check the same save. Keep this tab open if browser recovery is off.',
        );
      if (!creating && e.status === 403)
        permissions({ canEdit: false, canManage: false });
      if (e.status === 409 || e.status === 403) {
        saving.current = false;
        await refreshRef.current();
      }
      throw e;
    } finally {
      saving.current = false;
      clearTimeout(timer);
    }
  }
  function resolve(choice: MergeChoice) {
    if (latest.current.paused) return;
    const current = conflictRef.current;
    if (!current) return;
    if (current.whole) {
      baseline.current = current.remote;
      setRevision(current.remote.revision);
      const selected =
        choice === 'remote' ? current.remote : latest.current.snapshot;
      conflictRef.current = null;
      setConflict(null);
      latest.current.apply(selected, !sameProject(selected, current.remote));
      setStatus('Choice applied. Save to share any remaining edits.');
      return;
    }
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
    creation,
    reviewFirstSave: !!conflict?.whole,
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
