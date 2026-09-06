'use client';
import { useState } from 'react';
import { FolderClock, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Confirm } from './helpers';
import type { useDraftRecovery } from './use-draft-recovery';
import type { RecoveryDraft } from '@/lib/draft-recovery';

export default function RecoveryPanel({
  open,
  onClose,
  recovery,
  onRecover,
}: {
  open: boolean;
  onClose: () => void;
  recovery: ReturnType<typeof useDraftRecovery>;
  onRecover: (record: RecoveryDraft) => Promise<void>;
}) {
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [remove, setRemove] = useState<RecoveryDraft | null>(null),
    [disable, setDisable] = useState(false),
    [clearUnreadable, setClearUnreadable] = useState(false);
  async function perform(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || 'Could not complete recovery.');
    } finally {
      setBusy('');
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent className="recovery-dialog">
        <DialogTitle>
          <FolderClock size={22} /> Recover your work
        </DialogTitle>
        <DialogDescription>
          Arrangement edits kept on this browser. Recovering opens a working
          copy; Save project shares it with authorized collaborators.
        </DialogDescription>
        <div className="recovery-setting">
          <label htmlFor="browser-recovery">
            Keep recovery copies on this browser
          </label>
          <Switch
            id="browser-recovery"
            checked={recovery.enabled}
            disabled={!!busy || !recovery.ready}
            onCheckedChange={(value) =>
              value
                ? void perform('Turning on recovery', () =>
                    recovery.configure(true),
                  )
                : setDisable(true)
            }
          />
        </div>
        <p className="small-note">
          Use a trusted device. These copies are not encrypted by SESSION and
          may be accessible to someone using this browser. They include
          arrangement settings and audio references, not recorded audio or takes
          waiting to be added.
        </p>
        <p className="small-note">
          Up to 20 copies are kept until saved or deleted. Browser cleanup,
          private-window closure, or a crash before the recovery indicator
          finishes can remove recent work. Keep your shared project saved too.
        </p>
        {(error || recovery.error) && (
          <p className="error-banner" role="alert">
            {error || recovery.error}
          </p>
        )}
        {!!recovery.unreadable && (
          <div className="error-banner">
            {recovery.unreadable} recovery{' '}
            {recovery.unreadable === 1 ? 'copy cannot' : 'copies cannot'} be
            read. Your other copies are available below.
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => setClearUnreadable(true)}
            >
              Remove unreadable copies
            </button>
          </div>
        )}
        <div className="recovery-list">
          {recovery.drafts.map((record) => (
            <article key={record.key}>
              <div>
                <h3>{record.title || 'Untitled session'}</h3>
                <p>
                  {record.data.tracks.length} tracks · {record.data.bpm} BPM ·{' '}
                  {record.projectId
                    ? 'Saved project draft'
                    : 'New project draft'}
                </p>
                <time dateTime={new Date(record.updated).toISOString()}>
                  {new Date(record.updated).toLocaleString()}
                </time>
              </div>
              <div className="actions">
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() =>
                    void perform('Checking access and recovering', async () => {
                      await onRecover(record);
                      onClose();
                    })
                  }
                >
                  Recover
                </button>
                <button
                  className="button secondary"
                  aria-label={
                    'Delete recovery copy of ' +
                    (record.title || 'Untitled session')
                  }
                  disabled={!!busy}
                  onClick={() => setRemove(record)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
          {!recovery.drafts.length && (
            <p>
              {!recovery.ready
                ? 'Opening browser recovery…'
                : recovery.enabled
                  ? 'No recovery copies yet. Unsaved arrangement edits will appear here.'
                  : 'Recovery is off on this browser.'}
            </p>
          )}
        </div>
        <div className="actions">
          <span role="status">{busy}</span>
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={() =>
              void perform('Refreshing copies', () => recovery.refresh())
            }
          >
            Refresh list
          </button>
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <Confirm
          open={!!remove}
          onClose={() => setRemove(null)}
          title="Delete this recovery copy?"
          description="This removes only this browser copy. Your saved project and uploaded audio stay available. Continued editing can create another recovery copy."
          onConfirm={() => {
            if (remove)
              void perform('Deleting copy', () => recovery.remove(remove));
          }}
        />
        <Confirm
          open={clearUnreadable}
          onClose={() => setClearUnreadable(false)}
          title="Remove unreadable copies?"
          description="Only damaged recovery entries for this account on this browser will be removed. Readable recovery copies and saved projects stay available."
          onConfirm={() =>
            void perform('Removing unreadable copies', () =>
              recovery.removeUnreadable(),
            )
          }
        />
        <Confirm
          open={disable}
          onClose={() => setDisable(false)}
          title="Turn off browser recovery?"
          description="All recovery copies for your account on this browser will be removed. Saved projects and uploaded audio stay available. Unsaved work in the open editor stays there."
          confirmLabel="Turn off and clear copies"
          onConfirm={() =>
            void perform('Turning off recovery', () =>
              recovery.configure(false),
            )
          }
        />
      </DialogContent>
    </Dialog>
  );
}
