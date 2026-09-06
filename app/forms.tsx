'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Upload,
  Camera,
  ShieldCheck,
  LockKeyhole,
  Globe,
  Play,
  Heart,
  MessageCircle,
  Flag,
  ArrowUpRight,
  Check,
  Trash2,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Pick, Avatar, action, upload, Confirm } from './helpers';
import { genres, type Track } from '@/lib/catalog';
export function UploadForm({
  onDone,
  notify,
}: {
  onDone: () => void;
  notify: (s: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [title, setTitle] = useState(''),
    [kind, setKind] = useState('beat'),
    [genre, setGenre] = useState('Hip-hop'),
    [bpm, setBpm] = useState(92),
    [key, setKey] = useState('C minor'),
    [visibility, setVisibility] = useState('private'),
    [permission, setPermission] = useState('listen'),
    [rights, setRights] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  function choose(f?: File) {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) {
      setError('Choose a file smaller than 25 MB.');
      return;
    }
    setFile(f);
    setTitle((t) => t || f.name.replace(/\.[^.]+$/, ''));
    setError('');
  }
  return (
    <form
      className="form-panel upload-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return setError('Choose your audio file first.');
        setBusy(true);
        setError('');
        try {
          const f = await upload(file);
          await action({
            action: 'track',
            fileId: f.id,
            title,
            kind,
            genre,
            bpm,
            musicalKey: key,
            visibility,
            permission,
            rights,
          });
          notify(
            visibility === 'public'
              ? 'Your music is live in the community library.'
              : 'Your music was saved privately.',
          );
          onDone();
        } catch (e: any) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-heading">
        <Upload size={26} />
        <h2>Put your sound out there.</h2>
        <p>Or keep it between you and your next idea. You choose.</p>
      </div>
      <button
        type="button"
        className={'dropzone ' + (file ? 'has-file' : '')}
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          choose(e.dataTransfer.files[0]);
        }}
      >
        <Upload size={30} />
        <strong>{file ? file.name : 'Drop your track here'}</strong>
        <span>
          {file
            ? (file.size / 1024 / 1024).toFixed(1) + ' MB · Click to change'
            : 'or click to choose a file'}
        </span>
        <small>WAV, MP3, FLAC, M4A, OGG, WebM · up to 25 MB</small>
      </button>
      <input
        hidden
        ref={input}
        type="file"
        accept="audio/*,.wav,.mp3,.flac,.m4a"
        onChange={(e) => choose(e.target.files?.[0])}
      />
      <label className="field">
        <span>Track title</span>
        <input
          required
          value={title}
          maxLength={120}
          placeholder="Give your sound a name"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className="form-grid">
        <Pick
          label="I'm uploading"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'beat', label: 'A beat' },
            { value: 'song', label: 'A song' },
          ]}
        />
        <Pick
          label="Genre"
          value={genre}
          onChange={setGenre}
          options={genres.slice(1)}
        />
        <label className="field">
          <span>Tempo (BPM)</span>
          <input
            required
            type="number"
            min={40}
            max={240}
            value={bpm}
            onChange={(e) => setBpm(+e.target.value)}
          />
        </label>
        <Pick
          label="Musical key"
          value={key}
          onChange={setKey}
          options={[
            'C',
            'C#',
            'D',
            'D#',
            'E',
            'F',
            'F#',
            'G',
            'G#',
            'A',
            'A#',
            'B',
          ].flatMap((n) => [n + ' minor', n + ' major'])}
        />
      </div>
      <div className="privacy-box">
        <div className="switch-row">
          <div>
            <Globe size={19} />
            <span>
              Make this track public
              <small>
                {visibility === 'public'
                  ? 'Visible and playable by everyone with site access.'
                  : 'Only you can see this upload.'}
              </small>
            </span>
          </div>
          <Switch
            aria-label="Make this track public"
            checked={visibility === 'public'}
            onCheckedChange={(v) => setVisibility(v ? 'public' : 'private')}
          />
        </div>
        <Pick
          label="Creative permission"
          value={permission}
          onChange={setPermission}
          options={[
            { value: 'listen', label: 'Listen only — no reuse permission' },
            {
              value: 'collaborate',
              label: 'Open collaboration — make a private working version',
            },
          ]}
        />
        <p>
          Open collaboration allows artists and engineers to create private
          working versions. Commercial release, ownership, and revenue splits
          require a separate agreement. Existing working versions are not
          recalled by changing visibility.
        </p>
      </div>
      <label className="check-label">
        <Checkbox checked={rights} onCheckedChange={(v) => setRights(!!v)} />
        <span>
          I own this music or have permission to upload and share it with the
          settings above.
        </span>
      </label>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <button
        className="button primary wide"
        disabled={busy || !rights || !file}
      >
        {busy
          ? 'Uploading your music…'
          : visibility === 'public'
            ? 'Publish track'
            : 'Save private track'}
        <ArrowUpRight size={17} />
      </button>
    </form>
  );
}
export function ProfileForm({
  profile,
  user,
  onDone,
  notify,
}: {
  profile: any;
  user: any;
  onDone: () => void;
  notify: (s: string) => void;
}) {
  const [name, setName] = useState(profile?.name || user?.name || ''),
    [username, setUsername] = useState(profile?.username || ''),
    [roles, setRoles] = useState<string[]>(
      profile?.roles ? JSON.parse(profile.roles) : ['Artist'],
    ),
    [bio, setBio] = useState(profile?.bio || ''),
    [location, setLocation] = useState(profile?.location || ''),
    [visibility, setVisibility] = useState(profile?.visibility || 'private'),
    [avatar, setAvatar] = useState(profile?.avatar || null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className="form-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await action({
            action: 'profile',
            name,
            username,
            roles,
            bio,
            location,
            visibility,
            avatar,
          });
          notify('Your profile is saved.');
          onDone();
        } catch (e: any) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="profile-edit-header">
        <Avatar profile={{ name, avatar }} size={92} />
        <div>
          <h2>Make yourself known.</h2>
          <p>Your people start with your profile.</p>
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Camera size={15} /> Upload photo
          </button>
          <input
            ref={input}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              try {
                const r = await upload(f, 'avatar');
                setAvatar(r.id);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Display name</span>
          <input
            value={name}
            required
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Username</span>
          <div className="input-prefix">
            @
            <input
              value={username}
              required
              pattern="[a-z0-9_]{3,24}"
              minLength={3}
              maxLength={24}
              placeholder="your_sound"
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
            />
          </div>
        </label>
      </div>
      <fieldset className="role-options">
        <legend>Your creative roles</legend>
        {['Artist', 'Producer', 'Engineer'].map((role) => (
          <label className="check-label" key={role}>
            <Checkbox
              checked={roles.includes(role)}
              onCheckedChange={(v) =>
                setRoles((r) =>
                  v ? [...r, role] : r.filter((x) => x !== role),
                )
              }
            />
            <span>{role}</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Bio</span>
        <textarea
          value={bio}
          maxLength={600}
          rows={4}
          placeholder="Your sound, your influences, what you want to create…"
          onChange={(e) => setBio(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Location (optional)</span>
        <input
          value={location}
          maxLength={80}
          placeholder="City, country, or creating everywhere"
          onChange={(e) => setLocation(e.target.value)}
        />
      </label>
      <div className="privacy-box switch-row">
        <div>
          <Globe size={22} />
          <span>
            Appear in Find collaborators
            <small>
              Your name, photo, roles, bio, and location become visible.
            </small>
          </span>
        </div>
        <Switch
          aria-label="Make profile public"
          checked={visibility === 'public'}
          onCheckedChange={(v) => setVisibility(v ? 'public' : 'private')}
        />
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <button className="button primary wide" disabled={busy}>
        {busy ? 'Saving…' : 'Save profile'}
        <Check size={16} />
      </button>
    </form>
  );
}
export function TrackDetail({
  track,
  onClose,
  onPlay,
  onUse,
  saved,
  onSave,
  user,
  onRefresh,
  notify,
}: {
  track: Track | null;
  onClose: () => void;
  onPlay: (t: Track) => void;
  onUse: (t: Track) => void;
  saved: boolean;
  onSave: (t: Track) => void;
  user: any;
  onRefresh: () => void;
  notify: (s: string) => void;
}) {
  const [comments, setComments] = useState<any[]>([]),
    [text, setText] = useState(''),
    [report, setReport] = useState(false),
    [reportText, setReportText] = useState(''),
    [error, setError] = useState(''),
    [deleting, setDeleting] = useState(false),
    [privacy, setPrivacy] = useState(false),
    [permission, setPermission] = useState('listen'),
    [visibility, setVisibility] = useState('private');
  useEffect(() => {
    setComments([]);
    setError('');
    if (track && user)
      action({ action: 'comments', id: track.id })
        .then(setComments)
        .catch(() => {});
    if (track) {
      setVisibility(track.visibility);
      setPermission(track.permission);
    }
  }, [track?.id]);
  return (
    <>
      <Sheet open={!!track} onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="track-sheet">
          {track && (
            <>
              <span className="eyebrow">
                {track.demo
                  ? 'SESSION ORIGINAL · SYNTHESIZED STARTER'
                  : track.kind === 'song'
                    ? 'COMMUNITY SONG'
                    : 'COMMUNITY BEAT'}
              </span>
              <div
                className={
                  'cover detail-cover cover-' + (track.color || 'lime')
                }
              >
                <img src="/chrome-loop.png" alt="Abstract chrome artwork" />
              </div>
              <SheetTitle>{track.title}</SheetTitle>
              <SheetDescription>
                {track.creator} · {track.genre} · {track.bpm} BPM ·{' '}
                {track.musicalKey}
              </SheetDescription>
              <div className="actions">
                <button
                  className="button primary"
                  onClick={() => onPlay(track)}
                >
                  <Play size={17} /> Play
                </button>
                <button
                  className="button secondary"
                  onClick={() => onSave(track)}
                >
                  <Heart size={17} fill={saved ? 'currentColor' : 'none'} />
                  {saved ? 'Saved' : 'Save'}
                </button>
              </div>
              <div className="permission-note">
                <ShieldCheck size={20} />
                <div>
                  <strong>
                    {track.permission === 'collaborate'
                      ? 'Open to collaboration'
                      : 'Listen only'}
                  </strong>
                  <p>
                    {track.demo
                      ? 'An original synthesized starter loop. Use it freely in your projects.'
                      : track.permission === 'collaborate'
                        ? 'You can create a private working version. Agree on release rights and credits with the owner before distribution.'
                        : 'This upload does not grant permission to record, remix, or release it.'}
                  </p>
                </div>
              </div>
              {(track.permission === 'collaborate' ||
                track.owner === user?.id) && (
                <button className="button primary" onClick={() => onUse(track)}>
                  {' '}
                  {track.kind === 'song'
                    ? 'Engineer this song'
                    : 'Record on this beat'}
                  <ArrowUpRight size={17} />
                </button>
              )}
              {track.owner === user?.id && (
                <div className="actions">
                  <button
                    className="button secondary"
                    onClick={() => setPrivacy(true)}
                  >
                    <LockKeyhole size={15} /> Sharing settings
                  </button>
                  <button
                    className="icon-button danger-text"
                    onClick={() => setDeleting(true)}
                    aria-label="Delete track"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              )}
              <div className="section-title">
                <h2>
                  <MessageCircle size={18} /> The conversation
                </h2>
              </div>
              {user ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      setComments(
                        await action({
                          action: 'comments',
                          id: track.id,
                          body: text,
                        }),
                      );
                      setText('');
                    } catch (e: any) {
                      setError(e.message);
                    }
                  }}
                >
                  <textarea
                    aria-label="Write a comment"
                    rows={3}
                    maxLength={1000}
                    placeholder="What are you hearing in this?"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <button className="button secondary" disabled={!text.trim()}>
                    Post comment
                  </button>
                </form>
              ) : (
                <a
                  href="/signin-with-chatgpt?return_to=/"
                  target="_top"
                  className="button secondary"
                >
                  Sign in to join the conversation
                </a>
              )}
              {comments.map((c) => (
                <div className="comment" key={c.id}>
                  <strong>{c.name}</strong>
                  <p>{c.body}</p>
                </div>
              ))}
              {!comments.length && (
                <p className="small-note">Be the first to leave a note.</p>
              )}
              {error && (
                <div role="alert" className="error-banner">
                  {error}
                </div>
              )}
              {!track.demo && (
                <button className="report-link" onClick={() => setReport(true)}>
                  <Flag size={14} /> Report a copyright concern
                </button>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={report} onOpenChange={setReport}>
        <DialogContent className="form-dialog">
          <DialogTitle>Report a copyright concern</DialogTitle>
          <DialogDescription>
            Reports are stored for site-owner review. This preview has no
            designated DMCA agent or guaranteed review time.
          </DialogDescription>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await action({
                  action: 'report',
                  id: track?.id,
                  body: reportText,
                });
                setReport(false);
                setReportText('');
                notify('Report stored for the site owner.');
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            <label className="field">
              <span>Original work, source link, and concern</span>
              <textarea
                required
                value={reportText}
                rows={6}
                maxLength={3000}
                onChange={(e) => setReportText(e.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button className="button primary">Submit report</button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={privacy} onOpenChange={setPrivacy}>
        <DialogContent className="form-dialog">
          <DialogTitle>Who can hear this track?</DialogTitle>
          <DialogDescription>
            Changing this does not recall existing working versions, downloads,
            or recordings.
          </DialogDescription>
          <Pick
            label="Visibility"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'private', label: 'Private — only you' },
              { value: 'public', label: 'Public — everyone with site access' },
            ]}
          />
          <Pick
            label="Creative permission"
            value={permission}
            onChange={setPermission}
            options={[
              { value: 'listen', label: 'Listen only' },
              { value: 'collaborate', label: 'Open collaboration' },
            ]}
          />
          <button
            className="button primary"
            onClick={async () => {
              try {
                await action({
                  action: 'visibility',
                  id: track?.id,
                  visibility,
                  permission,
                });
                setPrivacy(false);
                onClose();
                onRefresh();
                notify('Sharing settings updated.');
              } catch (e: any) {
                notify(e.message);
              }
            }}
          >
            Save settings
          </button>
        </DialogContent>
      </Dialog>
      <Confirm
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          try {
            await action({ action: 'deleteTrack', id: track?.id });
            onClose();
            onRefresh();
            notify('Track removed from the library.');
          } catch (e: any) {
            notify(e.message);
          }
        }}
        title="Remove this track from your library?"
        description="The listing disappears. Audio used in existing projects remains available to those collaborators."
      />
    </>
  );
}
