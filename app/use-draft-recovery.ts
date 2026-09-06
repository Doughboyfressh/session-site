'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DraftStore,
  recoveryRecord,
  type RecoveryDraft,
  type RecoverySettings,
} from '@/lib/draft-recovery';

// Account-specific queues prevent old asynchronous work from consuming another account's edits.
export function useDraftRecovery(
  account: string | undefined,
  createStore = () => new DraftStore(),
) {
  const state = useMemo(
    () => ({
      store: createStore(),
      mounted: false,
      epoch: 0,
      read: 0,
      settings: null as RecoverySettings | null,
      pending: new Map<string, any>(),
      latest: new Map<string, any>(),
      signatures: new Map<string, string>(),
      failed: new Set<string>(),
      running: null as Promise<void> | null,
      channel: null as BroadcastChannel | null,
      paused: false,
    }),
    [account],
  );
  const active = useRef(state);
  active.current = state;
  const empty = {
    account,
    drafts: [] as RecoveryDraft[],
    ready: false,
    enabled: true,
    error: '',
    status: '',
    unreadable: 0,
  };
  const [view, setView] = useState(empty);
  const alive = (epoch = state.epoch) =>
    state.mounted && active.current === state && epoch === state.epoch;
  const update = (patch: Partial<typeof empty>) => {
    if (alive())
      setView((v) => ({ ...(v.account === account ? v : empty), ...patch }));
  };
  const requireActive = () => {
    if (!alive())
      throw new Error('Your account changed. Reopen browser recovery.');
  };
  const signal = () => state.channel?.postMessage({ account });
  async function read() {
    if (!account || !alive()) return;
    const epoch = state.epoch,
      serial = ++state.read;
    try {
      const result = await state.store.list(account);
      if (!alive(epoch) || serial !== state.read) return;
      if (
        state.settings &&
        state.settings.generation !== result.settings.generation
      ) {
        state.signatures.clear();
        state.pending.clear();
        state.failed.clear();
        if (result.settings.enabled) {
          for (const [key, draft] of state.latest)
            if (draft.dirty) state.pending.set(key, draft);
        } else update({ status: 'Browser recovery is off' });
      }
      state.settings = result.settings;
      update({
        enabled: result.settings.enabled,
        drafts: result.drafts,
        unreadable: result.unreadable,
        ready: true,
        ...(state.failed.size ? {} : { error: '' }),
      });
      return result;
    } catch (e: any) {
      if (alive(epoch) && serial === state.read)
        update({
          error:
            e.message || 'Browser recovery is unavailable. Save your project.',
          ready: false,
        });
    }
  }
  function drain(): Promise<void> {
    if (state.running) return state.running;
    if (!account || !state.settings || state.paused || !alive())
      return Promise.resolve();
    const epoch = state.epoch;
    const work = (async () => {
      while (state.pending.size && alive(epoch) && !state.paused) {
        const [key, draft] = state.pending.entries().next().value!;
        state.pending.delete(key);
        if (!state.settings?.enabled) continue;
        try {
          if (draft.dirty) {
            const record = recoveryRecord(account, draft);
            const signature = JSON.stringify({
              ...record,
              stamp: '',
              updated: 0,
            });
            if (state.signatures.get(key) !== signature) {
              update({ status: 'Saving recovery copy…' });
              const written = await state.store.put(
                record,
                state.settings.generation,
              );
              if (!alive(epoch)) return;
              if (!written) {
                state.signatures.delete(key);
                await read();
                continue;
              }
              state.signatures.set(key, signature);
            }
          } else {
            await state.store.remove(account, key);
            if (!alive(epoch)) return;
            state.signatures.delete(key);
          }
          state.failed.delete(key);
          if (!state.failed.size) update({ error: '' });
          update({
            status: state.pending.size
              ? 'Saving recovery copy…'
              : state.failed.size
                ? ''
                : draft.dirty
                  ? 'Arrangement saved in this browser'
                  : 'Project saved · recovery copy cleared',
          });
          signal();
        } catch (e: any) {
          if (!alive(epoch)) return;
          state.failed.add(key);
          update({
            error: e.message || 'Browser recovery failed. Save your project.',
            status: '',
          });
        }
      }
      if (alive(epoch)) await read();
    })();
    state.running = work.finally(() => {
      if (!alive(epoch)) return;
      state.running = null;
      if (state.pending.size && !state.paused) void drain();
    });
    return state.running;
  }
  async function settle() {
    do {
      await drain();
      requireActive();
    } while (state.pending.size && state.settings?.enabled && !state.paused);
  }
  function retryFailed() {
    for (const key of state.failed) {
      const draft = state.latest.get(key);
      if (draft) state.pending.set(key, draft);
    }
  }
  async function refresh() {
    const result = await read();
    if (!alive()) return;
    retryFailed();
    await settle();
    return result;
  }
  function capture(draft: any) {
    if (!account || !draft.recoveryId || active.current !== state) return;
    state.latest.set(draft.recoveryId, draft);
    state.pending.set(draft.recoveryId, draft);
    if (draft.dirty && state.settings?.enabled)
      update({ status: 'Saving recovery copy…' });
    void drain();
  }
  useEffect(() => {
    state.mounted = true;
    state.epoch++;
    setView(empty);
    if (account) {
      void read().then(() => drain());
      if (typeof BroadcastChannel !== 'undefined') {
        const c = new BroadcastChannel('session-draft-recovery');
        state.channel = c;
        c.onmessage = (event) => {
          if (event.data?.account === account) void read().then(() => drain());
        };
      }
    }
    const flush = () => {
      void drain();
    };
    const focus = () => {
      void refresh();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', flush);
    return () => {
      state.mounted = false;
      state.epoch++;
      state.read++;
      state.pending.clear();
      state.latest.clear();
      state.signatures.clear();
      state.failed.clear();
      state.settings = null;
      state.running = null;
      state.paused = false;
      state.channel?.close();
      state.channel = null;
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', flush);
      void state.store.close();
    };
  }, [state]);
  async function configure(value: boolean) {
    if (!account) return;
    requireActive();
    state.paused = true;
    try {
      await state.running;
      requireActive();
      state.pending.clear();
      const result = await state.store.configure(account, value);
      requireActive();
      state.settings = result;
      state.signatures.clear();
      state.failed.clear();
      update({
        enabled: value,
        error: '',
        status: value ? 'Browser recovery is ready' : 'Browser recovery is off',
      });
      signal();
      await read();
      requireActive();
      if (value)
        for (const [key, draft] of state.latest)
          if (draft.dirty) state.pending.set(key, draft);
    } finally {
      if (alive()) {
        state.paused = false;
        void drain();
      }
    }
  }
  async function remove(record: RecoveryDraft) {
    if (!account || record.account !== account) return;
    await settle();
    await state.store.remove(account, record.key, record.stamp);
    requireActive();
    state.pending.delete(record.key);
    state.latest.delete(record.key);
    state.failed.delete(record.key);
    signal();
    await refresh();
  }
  async function removeUnreadable() {
    if (!account) return;
    requireActive();
    await state.store.removeUnreadable(account);
    requireActive();
    signal();
    await refresh();
  }
  async function current(key: string) {
    await settle();
    if (state.failed.size)
      throw new Error(
        'Recent edits could not be kept in browser recovery. Save the open project or retry recovery storage before replacing this workspace.',
      );
    const result = await state.store.list(account!);
    requireActive();
    const record = result.drafts.find((d) => d.key === key);
    if (!record) throw new Error('This recovery copy is no longer available.');
    return record;
  }
  async function fork(record: RecoveryDraft) {
    requireActive();
    if (!account || record.account !== account || !state.settings)
      throw new Error('Sign in again to recover this draft.');
    const result = await state.store.fork(record, state.settings.generation);
    requireActive();
    state.latest.delete(record.key);
    state.pending.delete(record.key);
    state.signatures.delete(record.key);
    state.failed.delete(record.key);
    signal();
    await read();
    requireActive();
    return result;
  }
  async function deleteProject(projectId: string) {
    if (!account) return;
    requireActive();
    for (const [key, draft] of state.latest)
      if (draft.id === projectId) {
        state.latest.delete(key);
        state.pending.delete(key);
        state.signatures.delete(key);
        state.failed.delete(key);
      }
    await settle();
    await state.store.deleteProject(account, projectId);
    requireActive();
    signal();
    await read();
  }
  return {
    ...(view.account === account ? view : empty),
    capture,
    refresh,
    configure,
    remove,
    removeUnreadable,
    current,
    fork,
    deleteProject,
  };
}
