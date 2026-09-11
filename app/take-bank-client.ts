import { action, upload } from './helpers';
import {
  validateBank,
  type BankData,
  type RestoredBank,
} from '@/lib/take-bank';
import { takePCM, type LocalTake } from '@/lib/take-comp';
export type BankSnapshot = Omit<BankData, 'takes'> & { takes: LocalTake[] };
export function bankSignature(s: BankSnapshot) {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter(
                (k) =>
                  v[k] !== undefined &&
                  k !== 'url' &&
                  k !== 'peaks' &&
                  k !== 'duration',
              )
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return JSON.stringify(
    canonical({
      ...s,
      takes: s.takes.map(({ blob, url, ...t }) => ({ ...t, size: blob.size })),
    }),
  );
}
export class BankWriter {
  id: string;
  revision: number;
  saved = '';
  files = new Map<string, string>();
  pending: { body: any; signature: string } | null = null;
  constructor(restored?: RestoredBank) {
    this.id = restored?.id || crypto.randomUUID();
    this.revision = restored?.revision || 0;
    for (const t of restored?.data.takes || []) this.files.set(t.id, t.fileId);
    if (restored)
      this.saved = bankSignature({
        ...restored.data,
        takes: restored.originals,
      });
  }
  async save(snapshot: BankSnapshot, signal: AbortSignal) {
    const finish = async () => {
      if (!this.pending) return;
      const pending = this.pending;
      const result = await action(pending.body, { signal });
      this.revision = result.revision;
      this.saved = pending.signature;
      this.pending = null;
    };
    // Resolve a lost response with the exact same save token before later edits.
    await finish();
    signal.throwIfAborted();
    const signature = bankSignature(snapshot);
    if (this.saved === signature) return;
    const takes = [];
    for (const { blob, url, ...take } of snapshot.takes) {
      signal.throwIfAborted();
      let fileId = this.files.get(take.id);
      if (!fileId) {
        const result = await upload(
          new File([blob], take.name + '.wav', { type: 'audio/wav' }),
          'take',
          {
            signal,
            projectId: snapshot.projectId,
            bankId: this.id,
            takeId: take.id,
          },
        );
        fileId = result.id;
        this.files.set(take.id, fileId!);
      }
      takes.push({ ...take, fileId: fileId!, size: blob.size });
    }
    const data = validateBank({ ...snapshot, takes });
    this.pending = {
      body: {
        action: 'takeBankSave',
        id: this.id,
        baseRevision: this.revision,
        saveId: crypto.randomUUID(),
        data,
      },
      signature,
    };
    await finish();
  }
}
export async function loadBank(
  id: string,
  signal: AbortSignal,
): Promise<RestoredBank> {
  const record = await action({ action: 'takeBankRead', id }, { signal });
  const data = validateBank(record.data),
    originals: LocalTake[] = [];
  for (const { fileId, size, ...take } of data.takes) {
    signal.throwIfAborted();
    const response = await fetch('/api/file/' + encodeURIComponent(fileId), {
      signal,
      cache: 'no-store',
    });
    if (!response.ok)
      throw new Error(
        'An original recording is unavailable. Check your connection and project access.',
      );
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The original recording could not be read.');
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let length = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > size) {
        await reader.cancel();
        throw new Error('An original recording has an unexpected size.');
      }
      chunks.push(value as Uint8Array<ArrayBuffer>);
    }
    if (length !== size)
      throw new Error(
        'An original recording was incomplete. Retry opening the bank.',
      );
    const local = {
      ...take,
      blob: new Blob(chunks, { type: 'audio/wav' }),
      url: '',
    };
    await takePCM(local, signal);
    originals.push(local);
  }
  const latest = await action({ action: 'takeBankRead', id }, { signal });
  if (latest.revision !== record.revision)
    throw new Error(
      'The saved bank changed while opening. Refresh and try again.',
    );
  return { ...record, data, originals };
}
