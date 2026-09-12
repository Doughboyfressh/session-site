import type { Arrangement } from './audio';
import { validateArrangement } from './arrangement-validation';
import { validCreation, type ProjectCreation } from './project-creation';
import { cleanRouting, validateRouting } from './mixer-routing';
import { sampleSettings } from './sample-instrument';

export const MAX_DRAFTS = 20;
export const MAX_DRAFT_BYTES = 600 * 1024;
export const MAX_ACCOUNT_BYTES = 12 * 1024 * 1024;
export type DraftSnapshot = { title: string; data: Arrangement };
export type RecoveryDraft = DraftSnapshot & {
  version: 1;
  account: string;
  key: string;
  projectId: string;
  stamp: string;
  updated: number;
  baseline: DraftSnapshot & { revision: number };
  creation?: ProjectCreation;
  reviewFirstSave?: boolean;
};
export type RecoverySettings = {
  account: string;
  enabled: boolean;
  generation: number;
};
const fields = [
  'id',
  'name',
  'fileId',
  'demo',
  'sequence',
  'notes',
  'sound',
  'sample',
  'volume',
  'pan',
  'muted',
  'solo',
  'offset',
  'trimStart',
  'trimEnd',
  'low',
  'mid',
  'high',
  'reverb',
  'delay',
  'compression',
  'fadeIn',
  'fadeOut',
  'fadeStart',
  'fadeEnd',
  'splitFrom',
  'automation',
  'groupId',
  'sendReverb',
  'sendDelay',
];
function identity(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
export function recoverySnapshot(value: any): DraftSnapshot {
  if (
    !value ||
    typeof value.title !== 'string' ||
    value.title.length > 120 ||
    !Array.isArray(value.data?.tracks) ||
    value.data.tracks.length > 32
  )
    throw new Error('This draft has invalid project details.');
  const data: Arrangement = {
    bpm: value.data.bpm,
    tracks: value.data.tracks.map((track: any) => {
      if (!track || !identity(track.id))
        throw new Error('This draft has an invalid track.');
      const t: any = Object.fromEntries(
        fields
          .filter((key) => track[key] !== undefined)
          .map((key) => [key, track[key]]),
      );
      if (t.fileId !== undefined && !identity(t.fileId))
        throw new Error('Invalid audio reference in draft.');
      if (t.demo !== undefined && !identity(t.demo))
        throw new Error('Invalid demonstration reference.');
      if (t.sound !== undefined && !['keys', 'bass', 'pad'].includes(t.sound))
        throw new Error('Invalid instrument in draft.');
      if (t.sample !== undefined) t.sample = sampleSettings(t.sample);
      if (t.sequence !== undefined) {
        if (!Array.isArray(t.sequence) || t.sequence.length !== 3)
          throw new Error('Invalid drum pattern.');
        t.sequence = Array.from(t.sequence, (row: any) => {
          if (!Array.isArray(row) || row.length !== 16)
            throw new Error('Invalid drum pattern.');
          return Array.from(row, (step: any) => {
            if (step !== 0 && step !== 1) throw new Error('Invalid drum step.');
            return step;
          });
        });
      }
      if (t.notes) {
        if (!Array.isArray(t.notes) || t.notes.length > 256)
          throw new Error('Too many notes in draft.');
        t.notes = t.notes.map((n: any) => {
          if (!n || !identity(n.id)) throw new Error('Invalid note identity.');
          return {
            id: n.id,
            pitch: n.pitch,
            start: n.start,
            length: n.length,
            velocity: n.velocity,
          };
        });
      }
      if (t.automation) {
        if (!Array.isArray(t.automation) || t.automation.length > 64)
          throw new Error('Too many automation points.');
        t.automation = t.automation.map((p: any) => ({
          time: p?.time,
          value: p?.value,
        }));
      }
      return t;
    }),
  };
  if (value.data.routing !== undefined) {
    validateRouting(value.data.routing, true);
    data.routing = cleanRouting(value.data.routing);
  }
  validateArrangement(data, true);
  return structuredClone({ title: value.title, data });
}
export function recoveryRecord(
  account: string,
  draft: any,
  stamp = crypto.randomUUID(),
  now = Date.now(),
): RecoveryDraft {
  if (
    !identity(account) ||
    !identity(draft.recoveryId) ||
    (draft.id && !identity(draft.id))
  )
    throw new Error('Invalid recovery identity.');
  const snapshot = recoverySnapshot(draft);
  const baseline =
    draft.baseline ||
    (!draft.id
      ? {
          title: 'Untitled session',
          data: { bpm: 92, tracks: [] },
          revision: 0,
        }
      : null);
  if (
    !baseline ||
    !Number.isSafeInteger(baseline.revision) ||
    baseline.revision < 0
  )
    throw new Error('This draft is missing its saved starting version.');
  const record: RecoveryDraft = {
    ...snapshot,
    version: 1,
    account,
    key: draft.recoveryId,
    projectId: draft.id || '',
    stamp,
    updated: now,
    baseline: { ...recoverySnapshot(baseline), revision: baseline.revision },
  };
  if (draft.creation !== undefined) {
    if (draft.id || baseline.revision !== 0 || !validCreation(draft.creation))
      throw new Error('Invalid first-save recovery details.');
    record.creation = {
      key: draft.creation.key,
      checkpoint: draft.creation.checkpoint,
      ...(draft.creation.retryCurrent === undefined
        ? {}
        : { retryCurrent: draft.creation.retryCurrent }),
    };
  }
  if (draft.reviewFirstSave === true) record.reviewFirstSave = true;
  if (bytes(record) > MAX_DRAFT_BYTES)
    throw new Error(
      'This arrangement is too large for browser recovery. Save the project to keep it.',
    );
  return record;
}
export function validateRecovery(value: any, account: string): RecoveryDraft {
  if (
    !value ||
    value.version !== 1 ||
    value.account !== account ||
    !identity(value.stamp) ||
    !Number.isFinite(value.updated) ||
    value.updated < 0 ||
    value.updated > 8640000000000000 ||
    typeof value.projectId !== 'string'
  )
    throw new Error('This recovery copy is unreadable.');
  return recoveryRecord(
    account,
    { ...value, id: value.projectId, recoveryId: value.key },
    value.stamp,
    value.updated,
  );
}
function bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
function recoverySettings(value: any, account: string): RecoverySettings {
  if (value === undefined) return { account, enabled: true, generation: 0 };
  if (
    value.account !== account ||
    typeof value.enabled !== 'boolean' ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0 ||
    value.generation >= Number.MAX_SAFE_INTEGER
  )
    throw new Error(
      'Browser recovery settings are unreadable. Save open projects, then clear this site’s browser storage to reset recovery. Clearing storage removes recovery copies.',
    );
  return value;
}
function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () =>
      reject(value.error || new Error('Browser storage failed.'));
  });
}

export class DraftStore {
  name: string;
  opening: Promise<IDBDatabase> | null = null;
  constructor(name = 'session-arrangement-recovery-v1') {
    this.name = name;
  }
  async open() {
    if (this.opening) return this.opening;
    const opening: Promise<IDBDatabase> = new Promise<IDBDatabase>(
      (resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('This browser does not support draft recovery.'));
          return;
        }
        const r = indexedDB.open(this.name, 1);
        let failed = false;
        r.onupgradeneeded = () => {
          const db = r.result;
          const drafts = db.createObjectStore('drafts', {
            keyPath: ['account', 'key'],
          });
          drafts.createIndex('account', 'account');
          db.createObjectStore('settings', { keyPath: 'account' });
          db.createObjectStore('deleted', {
            keyPath: ['account', 'projectId'],
          });
        };
        r.onerror = () => {
          failed = true;
          reject(r.error || new Error('Browser storage could not open.'));
        };
        r.onblocked = () => {
          failed = true;
          reject(
            new Error('Close older SESSION tabs, then retry browser recovery.'),
          );
        };
        r.onsuccess = () => {
          const db = r.result;
          if (failed) {
            db.close();
            return;
          }
          db.onversionchange = () => {
            db.close();
            if (this.opening === opening) this.opening = null;
          };
          db.onclose = () => {
            if (this.opening === opening) this.opening = null;
          };
          resolve(db);
        };
      },
    ).catch((error) => {
      if (this.opening === opening) this.opening = null;
      throw error;
    });
    this.opening = opening;
    return opening;
  }
  async transaction<T>(
    names: string[],
    mode: IDBTransactionMode,
    operation: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.open(),
      tx = db.transaction(names, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(
          tx.error || new Error('The recovery copy could not be committed.'),
        );
      tx.onerror = () => {};
    });
    // Install rejection handling before any request can abort the transaction.
    void done.catch(() => {});
    try {
      const value = await operation(tx);
      await done;
      return value;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async list(account: string) {
    return this.transaction(['drafts', 'settings'], 'readonly', async (tx) => {
      const settings = (await request(
        tx.objectStore('settings').get(account),
      )) as RecoverySettings | undefined;
      const raw = await request(
        tx.objectStore('drafts').index('account').getAll(account),
      );
      const drafts: RecoveryDraft[] = [];
      let unreadable = 0;
      for (const value of raw)
        try {
          drafts.push(validateRecovery(value, account));
        } catch {
          unreadable++;
        }
      return {
        settings: recoverySettings(settings, account),
        drafts: drafts.sort((a, b) => b.updated - a.updated),
        unreadable,
      };
    });
  }
  async put(record: RecoveryDraft, generation: number) {
    const clean = validateRecovery(record, record.account);
    return this.transaction(
      ['drafts', 'settings', 'deleted'],
      'readwrite',
      async (tx) => {
        const settings = recoverySettings(
          await request(tx.objectStore('settings').get(clean.account)),
          clean.account,
        );
        if (
          settings &&
          (!settings.enabled || settings.generation !== generation)
        )
          return false;
        if (!settings && generation !== 0) return false;
        if (
          clean.projectId &&
          (await request(
            tx.objectStore('deleted').get([clean.account, clean.projectId]),
          ))
        )
          return false;
        const store = tx.objectStore('drafts'),
          all = await request(store.index('account').getAll(clean.account));
        const others: RecoveryDraft[] = [];
        for (const raw of all) {
          if (raw.key === clean.key) continue;
          try {
            others.push(validateRecovery(raw, clean.account));
          } catch {}
        }
        if (
          others.length >= MAX_DRAFTS ||
          others.reduce(
            (total: number, d: any) => total + bytes(d),
            bytes(clean),
          ) > MAX_ACCOUNT_BYTES
        )
          throw new Error(
            'Browser recovery is full. Delete an old recovery copy or save your project.',
          );
        await request(store.put(clean));
        return true;
      },
    );
  }
  async remove(account: string, key: string, stamp?: string) {
    return this.transaction(['drafts'], 'readwrite', async (tx) => {
      const store = tx.objectStore('drafts'),
        old = await request(store.get([account, key]));
      if (stamp && old?.stamp !== stamp)
        throw new Error(
          'This copy changed in another tab. Review the latest copy first.',
        );
      await request(store.delete([account, key]));
    });
  }
  async fork(record: RecoveryDraft, generation: number) {
    return this.transaction(
      ['drafts', 'settings', 'deleted'],
      'readwrite',
      async (tx) => {
        const settings = recoverySettings(
          await request(tx.objectStore('settings').get(record.account)),
          record.account,
        );
        if (
          settings &&
          (!settings.enabled || settings.generation !== generation)
        )
          throw new Error(
            'Recovery settings changed. Reopen the recovery panel.',
          );
        if (
          record.projectId &&
          (await request(
            tx.objectStore('deleted').get([record.account, record.projectId]),
          ))
        )
          throw new Error('This project was deleted.');
        const store = tx.objectStore('drafts'),
          old = await request(store.get([record.account, record.key]));
        if (!old || old.stamp !== record.stamp)
          throw new Error(
            'This copy changed or was already recovered. Refresh the list.',
          );
        const next = {
          ...validateRecovery(old, record.account),
          key: crypto.randomUUID(),
          stamp: crypto.randomUUID(),
          updated: Date.now(),
        };
        await request(store.put(next));
        await request(store.delete([record.account, record.key]));
        return next;
      },
    );
  }
  async configure(account: string, enabled: boolean) {
    return this.transaction(['drafts', 'settings'], 'readwrite', async (tx) => {
      const settings = tx.objectStore('settings'),
        old = recoverySettings(await request(settings.get(account)), account);
      const next = { account, enabled, generation: old.generation + 1 };
      await request(settings.put(next));
      if (!enabled) {
        const store = tx.objectStore('drafts'),
          all = await request(store.index('account').getAllKeys(account));
        for (const key of all) await request(store.delete(key));
      }
      return next;
    });
  }
  async deleteProject(account: string, projectId: string) {
    return this.transaction(['drafts', 'deleted'], 'readwrite', async (tx) => {
      await request(tx.objectStore('deleted').put({ account, projectId }));
      const store = tx.objectStore('drafts'),
        all = await request(store.index('account').getAll(account));
      for (const record of all)
        if (record.projectId === projectId)
          await request(store.delete([account, record.key]));
    });
  }
  async removeUnreadable(account: string) {
    return this.transaction(['drafts'], 'readwrite', async (tx) => {
      const store = tx.objectStore('drafts');
      const all = await request(store.index('account').getAll(account));
      for (const raw of all) {
        try {
          validateRecovery(raw, account);
        } catch {
          await request(store.delete([account, raw.key]));
        }
      }
    });
  }
  async close() {
    const opening = this.opening;
    this.opening = null;
    const db = await opening?.catch(() => null);
    db?.close();
  }
}

// Permissions are supplied only by a fresh server response, never by the device copy.
export function recoveredProject(record: RecoveryDraft, fresh?: any) {
  if (
    record.projectId &&
    (!fresh || fresh.id !== record.projectId || !fresh.canEdit)
  )
    throw new Error(
      'Editing access is unavailable. Ask the project owner to restore access; your recovery copy is kept here.',
    );
  if (
    record.projectId &&
    (!Number.isSafeInteger(fresh.revision) ||
      fresh.revision < record.baseline.revision)
  )
    throw new Error(
      'This project has an incompatible starting version. Your recovery copy is kept here; reload the saved project before trying again.',
    );
  return {
    id: record.projectId,
    title: record.title,
    data: structuredClone(record.data),
    baseline: structuredClone(record.baseline),
    revision: record.baseline.revision,
    dirty: true,
    recoveryId: record.key,
    creation: record.creation,
    reviewFirstSave: record.reviewFirstSave,
    canEdit: record.projectId ? fresh.canEdit : true,
    canManage: record.projectId ? fresh.canManage : true,
    owner: record.projectId ? fresh.owner : undefined,
  };
}
