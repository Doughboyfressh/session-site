'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { action, Confirm } from './helpers';
export default function SavedTakesPanel({
  open,
  onClose,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: (id: string, signal: AbortSignal) => Promise<void>;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [remove, setRemove] = useState<any>(null);
  const controller = useRef<AbortController | null>(null),
    alive = useRef(false);
  async function refresh(signal: AbortSignal) {
    const list = await action({ action: 'takeBanks' }, { signal });
    if (!signal.aborted) setRows(list);
  }
  useEffect(() => {
    if (!open) return;
    alive.current = true;
    const c = new AbortController();
    controller.current = c;
    setRows([]);
    setError('');
    setBusy('Loading saved takes…');
    refresh(c.signal)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy('');
      });
    return () => {
      alive.current = false;
      c.abort();
      controller.current?.abort();
    };
  }, [open]);
  async function run(
    label: string,
    job: (signal: AbortSignal) => Promise<void>,
  ) {
    if (busy) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(label);
    setError('');
    try {
      await job(c.signal);
    } catch (e) {
      if (alive.current && controller.current === c && !c.signal.aborted)
        setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      if (alive.current && controller.current === c) setBusy('');
    }
  }
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            controller.current?.abort();
            onClose();
          }
        }}
      >
        <DialogContent className="form-dialog record-dialog">
          <DialogTitle>Saved takes</DialogTitle>
          <DialogDescription>
            Private originals and comp choices saved to your account. Open a
            bank to continue in the studio.
          </DialogDescription>
          <p className="record-note">
            Up to 20 banks. Each saved comp uses up to 8 takes and 4 minutes of
            audio. Previously uploaded and discarded takes count toward storage
            until you delete their bank. Deleting a bank keeps finished comps
            already added to projects.
          </p>
          {busy && <p role="status">{busy}</p>}
          {error && (
            <p role="alert" className="record-error">
              {error}
            </p>
          )}
          {!busy && !rows.length && (
            <p>
              No saved takes yet. In the studio recorder, choose Save takes
              &amp; comp before closing.
            </p>
          )}
          {rows.map((row) => (
            <article key={row.id} className="project-card">
              <strong>{row.title}</strong>
              <p>
                {row.deletedAt !== null
                  ? 'Deletion needs retry'
                  : row.revision === 0
                    ? 'Upload incomplete'
                    : `${row.takeCount} takes · Saved ${new Date(row.updated).toLocaleString()}`}{' '}
                · {(row.bytes / 1048576).toFixed(1)} MB
              </p>
              <div className="actions">
                <button
                  className="button primary"
                  disabled={!!busy || row.deletedAt !== null || !row.revision}
                  onClick={() =>
                    void run('Opening your originals…', async (signal) => {
                      await onOpen(row.id, signal);
                      onClose();
                    })
                  }
                >
                  Open takes
                </button>
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => setRemove(row)}
                >
                  {row.deletedAt !== null ? 'Retry deletion' : 'Delete bank'}
                </button>
              </div>
            </article>
          ))}
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={() => void run('Refreshing…', refresh)}
          >
            Refresh saved takes
          </button>
        </DialogContent>
      </Dialog>
      <Confirm
        open={!!remove}
        onClose={() => setRemove(null)}
        title="Delete this take bank?"
        description="This permanently erases every original uploaded to this bank and its comp choices. Finished comps in your projects remain. Download any originals you need first."
        confirmLabel="Delete bank"
        onConfirm={() => {
          const row = remove;
          setRemove(null);
          void run('Deleting saved takes…', async (signal) => {
            await action(
              {
                action: 'takeBankDelete',
                id: row.id,
                baseRevision: row.revision,
              },
              { signal },
            );
            await refresh(signal);
          });
        }}
      />
    </>
  );
}
