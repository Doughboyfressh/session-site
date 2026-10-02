'use client';
import { WorkspaceSignInLink } from './workspace-sign-in-link';
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
  Handshake,
  CircleDollarSign,
  CreditCard,
  Plus,
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
import {
  Pick,
  Avatar,
  action,
  upload,
  Confirm,
  stripeAction,
  formatPrice,
} from './helpers';
import CoverArt from './cover-art';
import { genres, type Track } from '@/lib/catalog';
export function UploadForm({
  onDone,
  notify,
  tracks = [],
}: {
  onDone: () => void;
  notify: (s: string) => void;
  tracks?: Track[];
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
    [price, setPrice] = useState(''),
    [caption, setCaption] = useState(''),
    [attachedTrack, setAttachedTrack] = useState('none'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  function changeKind(next: string) {
    setKind(next);
    const acceptsFile =
      !file ||
      (next === 'photo'
        ? file.type.startsWith('image/')
        : next === 'video'
          ? file.type.startsWith('video/')
          : !file.type.startsWith('image/') && !file.type.startsWith('video/'));
    if (!acceptsFile) {
      setFile(null);
      if (input.current) input.current.value = '';
    }
    setError('');
  }
  function choose(f?: File) {
    if (!f) return;
    const isPhoto = f.type.startsWith('image/');
    const isVideo = f.type.startsWith('video/');
    if (isPhoto && f.size > 8 * 1024 * 1024) {
      setError('Choose a photo smaller than 8 MB.');
      return;
    }
    if (isVideo && f.size > 60 * 1024 * 1024) {
      setError('Choose a video smaller than 60 MB.');
      return;
    }
    if (!isPhoto && !isVideo && f.size > 25 * 1024 * 1024) {
      setError('Choose a file smaller than 25 MB.');
      return;
    }
    setFile(f);
    if (!isPhoto && !isVideo)
      setTitle((t) => t || f.name.replace(/\.[^.]+$/, ''));
    else setCaption((c) => c || f.name.replace(/\.[^.]+$/, '').slice(0, 200));
    setError('');
  }
  return (
    <form
      className="form-panel upload-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file)
          return setError(
            kind === 'photo'
              ? 'Choose a photo first.'
              : kind === 'video'
                ? 'Choose a video first.'
                : 'Choose your audio file first.',
          );
        setBusy(true);
        setError('');
        try {
          if (kind === 'photo' || kind === 'video') {
            const f = await upload(file, kind);
            await action({
              action: 'post',
              kind,
              fileId: f.id,
              caption,
              track: attachedTrack === 'none' ? null : attachedTrack,
              visibility,
            });
            notify(
              visibility === 'public'
                ? 'Shared with the community.'
                : 'Saved privately.',
            );
            onDone();
            return;
          }
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
            price: price
              ? Math.round(Math.max(0, Number(price) || 0) * 100)
              : null,
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
        <strong>
          {file
            ? file.name
            : kind === 'photo'
              ? 'Drop a photo here'
              : kind === 'video'
                ? 'Drop a video here'
                : 'Drop your track here'}
        </strong>
        <span>
          {file
            ? (file.size / 1024 / 1024).toFixed(1) + ' MB · Click to change'
            : 'or click to choose a file'}
        </span>
        <small>
          {kind === 'photo'
            ? 'PNG, JPEG, WebP, GIF · up to 8 MB'
            : kind === 'video'
              ? 'MP4 or WebM · up to 60 MB'
              : 'WAV, MP3, FLAC, M4A, OGG, WebM · up to 25 MB'}
        </small>
      </button>
      <input
        hidden
        ref={input}
        type="file"
        accept={
          kind === 'photo'
            ? 'image/png,image/jpeg,image/webp,image/gif'
            : kind === 'video'
              ? 'video/mp4,video/webm'
              : 'audio/*,.wav,.mp3,.flac,.m4a'
        }
        onChange={(e) => choose(e.target.files?.[0])}
      />
      <Pick
        label="I'm uploading"
        value={kind}
        onChange={changeKind}
        options={[
          { value: 'beat', label: 'A beat' },
          { value: 'song', label: 'A song' },
          { value: 'photo', label: 'A photo' },
          { value: 'video', label: 'A video' },
        ]}
      />
      {kind === 'photo' || kind === 'video' ? (
        <>
          <label className="field">
            <span>Caption</span>
            <input
              maxLength={200}
              placeholder="Say something about it…"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </label>
          {tracks.length > 0 && (
            <Pick
              label="Attach to one of your tracks (optional)"
              value={attachedTrack}
              onChange={setAttachedTrack}
              options={[
                { value: 'none', label: 'No track' },
                ...tracks.map((t) => ({ value: t.id, label: t.title })),
              ]}
            />
          )}
          <p className="small-note">
            {kind === 'video'
              ? 'Videos play right in the feed. Keep them under 60 MB (MP4 or WebM).'
              : 'Photos appear in the feed. Up to 8 MB.'}
          </p>
        </>
      ) : (
        <div className="form-grid">
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
      )}
      <div className="privacy-box">
        <div className="switch-row">
          <div>
            <Globe size={19} />
            <span>
              {kind === 'photo' || kind === 'video'
                ? 'Make this post public'
                : 'Make this track public'}
              <small>
                {visibility === 'public'
                  ? 'Visible and playable by everyone with site access.'
                  : 'Only you can see this upload.'}
              </small>
            </span>
          </div>
          <Switch
            aria-label={
              kind === 'photo' || kind === 'video'
                ? 'Make this post public'
                : 'Make this track public'
            }
            checked={visibility === 'public'}
            onCheckedChange={(v) => setVisibility(v ? 'public' : 'private')}
          />
        </div>
        {kind !== 'photo' && kind !== 'video' && (
          <>
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
            <label className="field sell-field">
              <span>
                Sell this {kind === 'beat' ? 'beat' : 'song'} (optional)
              </span>
              <div className="input-prefix">
                <CircleDollarSign size={16} />
                <input
                  aria-label="Track price in US dollars"
                  type="number"
                  min={1}
                  max={10000}
                  placeholder="50"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              <small className="small-note">
                US dollars, charged by card through Stripe. Buyers get a license
                receipt and a message thread with you. Leave empty to share
                freely.
              </small>
            </label>
            <p>
              Open collaboration allows artists and engineers to create private
              working versions. Sales and licenses are paid to you directly; you
              keep creative ownership. Existing working versions are not
              recalled by changing visibility.
            </p>
          </>
        )}
      </div>
      <label className="check-label">
        <Checkbox checked={rights} onCheckedChange={(v) => setRights(!!v)} />
        <span>
          I own this{' '}
          {kind === 'photo' || kind === 'video' ? 'content' : 'music'} or have
          permission to upload and share it with the settings above.
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
          ? kind === 'photo' || kind === 'video'
            ? 'Sharing…'
            : 'Uploading your music…'
          : kind === 'photo' || kind === 'video'
            ? visibility === 'public'
              ? 'Share to the feed'
              : 'Save privately'
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
  payments,
}: {
  profile: any;
  user: any;
  onDone: () => void;
  notify: (s: string) => void;
  payments?: { configured: boolean; chargesEnabled: boolean } | null;
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
    [rates, setRates] = useState<any[]>(
      profile?.rates ? JSON.parse(profile.rates) : [],
    ),
    [payBusy, setPayBusy] = useState(false),
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
            rates,
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
        {['Artist', 'Producer', 'Engineer', 'Videographer'].map((role) => (
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
      <div className="services-box">
        <div className="services-head">
          <CircleDollarSign size={20} />
          <span>
            Charge for your work
            <small>
              List up to 3 services. Buyers pay by card and reach you in a
              private thread.
            </small>
          </span>
        </div>
        {rates.map((rate, index) => (
          <div className="service-row" key={index}>
            <label className="field service-role">
              <span>Role</span>
              <select
                aria-label={'Service role ' + (index + 1)}
                value={rate.role || roles[0] || 'Producer'}
                onChange={(e) =>
                  setRates(
                    rates.map((r, i) =>
                      i === index ? { ...r, role: e.target.value } : r,
                    ),
                  )
                }
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label className="field service-name">
              <span>Service</span>
              <input
                aria-label={'Service name ' + (index + 1)}
                maxLength={60}
                placeholder="Custom beat, mix per song…"
                value={rate.service || ''}
                onChange={(e) =>
                  setRates(
                    rates.map((r, i) =>
                      i === index ? { ...r, service: e.target.value } : r,
                    ),
                  )
                }
              />
            </label>
            <label className="field service-price">
              <span>Price (USD)</span>
              <input
                aria-label={'Service price ' + (index + 1)}
                type="number"
                min={1}
                max={10000}
                placeholder="150"
                value={rate.amountCents ? rate.amountCents / 100 : ''}
                onChange={(e) =>
                  setRates(
                    rates.map((r, i) =>
                      i === index
                        ? {
                            ...r,
                            amountCents: Math.round(
                              Math.max(0, Number(e.target.value) || 0) * 100,
                            ),
                          }
                        : r,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label={'Remove service ' + (index + 1)}
              onClick={() => setRates(rates.filter((_, i) => i !== index))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {rates.length < 3 && (
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              setRates([
                ...rates,
                { role: roles[0] || 'Producer', service: '', amountCents: 0 },
              ])
            }
          >
            <Plus size={15} /> Add a service
          </button>
        )}
        {rates.length > 0 && (
          <p className="small-note">
            Bookings will show:{' '}
            {rates
              .filter((r) => r.service && r.amountCents >= 100)
              .map((r) => `${r.service} · ${formatPrice(r.amountCents)}`)
              .join('  ·  ') || 'finish naming and pricing your services'}
          </p>
        )}
      </div>
      <div className="privacy-box switch-row payouts-box">
        <div>
          <CreditCard size={22} />
          <span>
            Get paid
            <small>
              {payments?.chargesEnabled
                ? 'Your account can receive card payments. Buyers see Book & pay buttons.'
                : payments?.configured
                  ? 'Connect a Stripe account once to accept card payments for your services and tracks.'
                  : 'Card payments are coming soon — your prices will be listed for bookings meanwhile.'}
            </small>
          </span>
        </div>
        {payments?.configured && !payments?.chargesEnabled && (
          <button
            type="button"
            className="button secondary"
            disabled={payBusy}
            onClick={async () => {
              setPayBusy(true);
              try {
                const { url } = await stripeAction({ action: 'onboard' });
                window.location.href = url;
              } catch (e: any) {
                notify(e.message);
                setPayBusy(false);
              }
            }}
          >
            {payBusy ? 'Connecting…' : 'Connect payouts'}
          </button>
        )}
        {payments?.chargesEnabled && (
          <span className="pay-ok">
            <Check size={15} /> Ready
          </span>
        )}
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
  onRemix,
  onRequest,
  saved,
  onSave,
  user,
  onRefresh,
  notify,
  onBuy,
  sellerChargeable,
  payments,
}: {
  track: Track | null;
  onClose: () => void;
  onPlay: (t: Track) => void;
  onUse: (t: Track) => void;
  onRemix: (t: Track) => void;
  onRequest: (t: Track) => void;
  saved: boolean;
  onSave: (t: Track) => void;
  user: any;
  onRefresh: () => void;
  notify: (s: string) => void;
  onBuy?: (t: Track) => void;
  sellerChargeable?: boolean;
  payments?: { configured: boolean } | null;
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
  const isOwner =
    !!track &&
    !track.demo &&
    typeof user?.id === 'string' &&
    user.id.trim().length > 0 &&
    typeof track.owner === 'string' &&
    track.owner.trim().length > 0 &&
    track.owner === user.id;
  const ownerContext = isOwner ? JSON.stringify([track.id, user.id]) : null;
  const [dialogContext, setDialogContext] = useState(ownerContext);
  const dialogsCurrent = dialogContext === ownerContext;
  // Reset before effects so track switches and regained ownership cannot
  // inherit an open management dialog from the previous context.
  if (!dialogsCurrent) {
    setDialogContext(ownerContext);
    setPrivacy(false);
    setDeleting(false);
  }
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
                <CoverArt
                  seed={track.id + track.title}
                  label={track.title}
                  size={0}
                  className="cover-fill"
                />
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
                {!!track.price && !isOwner && payments?.configured && (
                  <button
                    className={
                      'button ' + (sellerChargeable ? 'primary' : 'secondary')
                    }
                    disabled={!sellerChargeable || !onBuy}
                    title={
                      sellerChargeable
                        ? 'Buy a license — card payment via Stripe'
                        : 'Card payments pending on this creator'
                    }
                    onClick={() => onBuy?.(track)}
                  >
                    <CircleDollarSign size={17} />
                    Buy · {formatPrice(track.price)}
                  </button>
                )}
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
              {(track.permission === 'collaborate' || isOwner) && (
                <button className="button primary" onClick={() => onUse(track)}>
                  {' '}
                  {track.kind === 'song'
                    ? 'Engineer this song'
                    : 'Record on this beat'}
                  <ArrowUpRight size={17} />
                </button>
              )}
              {!track.demo &&
                track.permission === 'collaborate' &&
                !isOwner && (
                  <button
                    className="button secondary"
                    onClick={() => onRequest(track)}
                  >
                    <Handshake size={16} /> Request collaboration
                  </button>
                )}
              {!track.demo &&
                track.kind === 'beat' &&
                track.permission === 'collaborate' &&
                !isOwner && (
                  <button
                    className="button secondary"
                    onClick={() => onRemix(track)}
                  >
                    Start a tracked remix
                  </button>
                )}
              {isOwner && (
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
                <WorkspaceSignInLink className="button secondary">
                  Sign in to join the conversation
                </WorkspaceSignInLink>
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
      {isOwner && (
        <Dialog open={dialogsCurrent && privacy} onOpenChange={setPrivacy}>
          <DialogContent className="form-dialog">
            <DialogTitle>Who can hear this track?</DialogTitle>
            <DialogDescription>
              Changing this does not recall existing working versions,
              downloads, or recordings.
            </DialogDescription>
            <Pick
              label="Visibility"
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: 'private', label: 'Private — only you' },
                {
                  value: 'public',
                  label: 'Public — everyone with site access',
                },
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
                if (!isOwner || !track) return;
                try {
                  await action({
                    action: 'visibility',
                    id: track.id,
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
      )}
      {isOwner && (
        <Confirm
          open={dialogsCurrent && deleting}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            if (!isOwner || !track) return;
            try {
              await action({ action: 'deleteTrack', id: track.id });
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
      )}
    </>
  );
}
