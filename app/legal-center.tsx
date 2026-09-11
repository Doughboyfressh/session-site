'use client';
import { useState } from 'react';
import {
  ShieldCheck,
  Download,
  FileText,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { action } from './helpers';
import { download } from '@/lib/audio';
import policies from '@/lib/policies.json';
function inline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https:\/\/[^)]+\))/g)
    .map((s, i) => {
      if (s.startsWith('**')) return <strong key={i}>{s.slice(2, -2)}</strong>;
      const m = s.match(/^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/);
      return m ? (
        <a key={i} href={m[2]} target="_blank" rel="noreferrer">
          {m[1]}
        </a>
      ) : (
        s
      );
    });
}
function Markdown({ text }: { text: string }) {
  const lines = text.split('\n'),
    out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line === '---') continue;
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        if (!/^\|[\s:|\-]+\|$/.test(lines[i]))
          rows.push(
            lines[i]
              .trim()
              .slice(1, -1)
              .split('|')
              .map((x) => x.trim()),
          );
        i++;
      }
      i--;
      out.push(
        <div className="policy-table" key={i}>
          <table>
            <thead>
              <tr>
                {rows[0]?.map((v, j) => (
                  <th key={j}>{inline(v)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(1).map((row, j) => (
                <tr key={j}>
                  {row.map((v, k) => (
                    <td key={k}>{inline(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,4}) (.*)/);
    if (heading) {
      out.push(
        heading[1].length === 1 ? (
          <h2 key={i}>{inline(heading[2])}</h2>
        ) : (
          <h3 key={i}>{inline(heading[2])}</h3>
        ),
      );
      continue;
    }
    if (/^[-*] /.test(line)) {
      const values = [];
      while (i < lines.length && /^[-*] /.test(lines[i]))
        values.push(lines[i++].slice(2));
      i--;
      out.push(
        <ul key={i}>
          {values.map((v, j) => (
            <li key={j}>{inline(v)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    out.push(<p key={i}>{inline(line)}</p>);
  }
  return <>{out}</>;
}
export default function LegalCenter({
  user,
  notify,
}: {
  user: any;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState('overview'),
    [files, setFiles] = useState<any[] | null>(null),
    [busy, setBusy] = useState(false),
    [erasing, setErasing] = useState<any>(null),
    [confirmation, setConfirmation] = useState('');
  async function load() {
    setBusy(true);
    try {
      setFiles(await action({ action: 'myFiles' }));
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function exportData() {
    setBusy(true);
    try {
      const data = await action({ action: 'exportData' });
      download(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        'SESSION-account-data.json',
      );
      notify(
        'Account data exported. Audio originals are downloaded separately below.',
      );
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="legal-center">
      <div className="legal-intro">
        <ShieldCheck size={35} />
        <div>
          <h2>Your sound. Your say.</h2>
          <p>
            Choose what people can hear, keep working projects private, and
            understand the permissions behind a collaboration.
          </p>
        </div>
        <a
          className="button secondary"
          href="/SESSION-Policies-DRAFT.md"
          download
        >
          <Download size={16} /> Download policy drafts
        </a>
      </div>
      <nav className="policy-nav" aria-label="Rights and privacy sections">
        <button
          className={tab === 'overview' ? 'selected' : ''}
          onClick={() => setTab('overview')}
        >
          Current controls
        </button>
        {policies.map((p) => (
          <button
            key={p.id}
            className={tab === p.id ? 'selected' : ''}
            onClick={() => setTab(p.id)}
          >
            {p.title}
          </button>
        ))}
        <button
          className={tab === 'data' ? 'selected' : ''}
          onClick={() => {
            setTab('data');
            if (user && !files) load();
          }}
        >
          My data & files
        </button>
      </nav>
      {tab === 'overview' ? (
        <>
          <div className="policy-draft-banner">
            <FileText size={21} />
            <div>
              <strong>
                Policy drafts · business details come after development
              </strong>
              <p>
                The full Terms, Privacy Notice, Copyright Policy, and
                Collaboration Permissions are ready for review. Operator
                identity, contacts, territory, retention decisions, and legal
                review remain open. These drafts are not active agreements and
                are not being accepted during development.
              </p>
            </div>
          </div>
          <div className="rights-grid">
            <section>
              <h3>Keep control of visibility</h3>
              <p>
                Profiles and audio can be public or private. Listen-only
                listings do not authorize a new saved collaboration.
                Open-collaboration listings let members make private working
                versions. A public listing is not a commercial release license.
              </p>
            </section>
            <section>
              <h3>Keep rights conversations explicit</h3>
              <p>
                Agree on composition and recording ownership, credits, samples,
                royalties, and release permission before distribution. Selecting
                Artist, Producer, or Engineer does not establish ownership or
                clear third-party rights.
              </p>
            </section>
            <section>
              <h3>Private rooms, deliberate media</h3>
              <p>
                Room invitations expire and hosts can replace them or remove
                members. The camera and microphone only start when you join a
                call. Screen and tab audio require a separate sharing choice.
                Other participants can capture what they receive.
              </p>
            </section>
            <section>
              <h3>Understand removal</h3>
              <p>
                Hiding or deleting a listing stops discovery. Existing saved
                collaborations may retain access. Permanent file erasure removes
                the hosted original and its links across projects; it cannot
                recall copies someone already received.
              </p>
            </section>
          </div>
          <p className="small-note">
            Rights reports are stored for review. An operational review team,
            verified contact channels, a registered DMCA agent where applicable,
            and account-deletion procedures must be established before public
            launch.
          </p>
        </>
      ) : tab === 'data' ? (
        <section className="data-panel">
          <h2>Your files and account data</h2>
          <p>
            Export your profile, listings, project arrangements, saved versions,
            private take-bank details, and account activity. The export contains
            file details; download audio originals separately.
          </p>
          {user ? (
            <>
              <div className="actions">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={exportData}
                >
                  <Download size={16} /> Export account data
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={load}
                >
                  <RefreshCw size={16} /> Refresh files
                </button>
              </div>
              <div className="file-list">
                {files?.length ? (
                  files.map((f) => (
                    <article key={f.id}>
                      <div>
                        <strong>{f.name}</strong>
                        <span>
                          {(f.size / 1024 / 1024).toFixed(2)} MB · {f.purpose} ·
                          linked to {f.projects} project
                          {f.projects === 1 ? '' : 's'}
                        </span>
                      </div>
                      <a
                        className="button secondary"
                        href={'/api/file/' + f.id}
                        download={f.name}
                      >
                        Download
                      </a>
                      <button
                        className="icon-button danger-text"
                        disabled={f.purpose === 'take'}
                        title={
                          f.purpose === 'take'
                            ? 'Delete this bank from My projects → Saved takes'
                            : undefined
                        }
                        aria-label={'Permanently erase ' + f.name}
                        onClick={() => {
                          setErasing(f);
                          setConfirmation('');
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    </article>
                  ))
                ) : (
                  <p>
                    {busy
                      ? 'Loading your files…'
                      : 'No uploaded files to display.'}
                  </p>
                )}
              </div>
              <p className="small-note">
                File erasure is separate from deleting your account.
                Account-deletion requests and contact channels will be added
                before launch. Keep a backup of any work you want to retain.
              </p>
            </>
          ) : (
            <p>Sign in to view your files and export your data.</p>
          )}
        </section>
      ) : (
        <article className="policy-document">
          <div className="policy-draft-label">DRAFT · NOT YET ACTIVE</div>
          <Markdown text={policies.find((p) => p.id === tab)?.text || ''} />
        </article>
      )}
      <Dialog open={!!erasing} onOpenChange={(v) => !v && setErasing(null)}>
        <DialogContent className="form-dialog">
          <DialogTitle>Permanently erase this file?</DialogTitle>
          <DialogDescription>
            This deletes the hosted original, listings using it, and access
            through saved projects. Other people's downloaded copies cannot be
            recalled. This cannot be undone.
          </DialogDescription>
          <strong>{erasing?.name}</strong>
          <label className="field">
            <span>Type ERASE to confirm</span>
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <div className="actions">
            <button
              className="button secondary"
              onClick={() => setErasing(null)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={confirmation !== 'ERASE' || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await action({
                    action: 'eraseFile',
                    id: erasing.id,
                    confirm: confirmation,
                  });
                  setErasing(null);
                  await load();
                  notify(
                    'The hosted file and its access links have been erased.',
                  );
                } catch (e: any) {
                  notify(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Permanently erase
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
