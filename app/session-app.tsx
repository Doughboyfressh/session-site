'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Compass,
  Disc3,
  Users,
  Radio,
  FolderClosed,
  Heart,
  ShieldCheck,
  ArrowUpRight,
  Plus,
  Search,
  Play,
  Pause,
  SlidersHorizontal,
  Headphones,
  Mic2,
  ArrowRight,
  LockKeyhole,
  ChevronRight,
  Trash2,
  Check,
  X,
  Loader2,
  Bell,
  MessagesSquare,
  Handshake,
  Home,
  Share2,
  MessageCircle,
  MoreHorizontal,
} from 'lucide-react';
import CoverArt, { coverWaveform } from './cover-art';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { demos, genres, type Track } from '@/lib/catalog';
import { context, trackFrom, bufferFor, playMix } from '@/lib/audio';
import { Pick, Avatar, Confirm, Range, action } from './helpers';
import { UploadForm, ProfileForm, TrackDetail } from './forms';
import LegalCenter from './legal-center';
import Diagnostics from './diagnostics';
import Studio from './studio';
import Scene3D from './scene-3d';
import Room from './room';
import { useDraftRecovery } from './use-draft-recovery';
import RecoveryPanel from './recovery-panel';
import SavedTakesPanel from './saved-takes-panel';
import { loadBank } from './take-bank-client';
import { bankProject } from '@/lib/take-bank';
import { recoveredProject, type RecoveryDraft } from '@/lib/draft-recovery';
import { creationHash } from '@/lib/project-creation';
import {
  ActivityView,
  CollaborationInbox,
  CollaborationRequestDialog,
  type CollaborationTarget,
} from './social';
const empty = {
  profile: null,
  tracks: [],
  profiles: [],
  projects: [],
  rooms: [],
  saved: [],
  follows: [],
  unreadNotifications: 0,
} as any;
const captions: Record<string, string> = {
  Discover:
    'A beat. A voice. A fresh pair of ears. It all comes together here.',
  'Beat library': 'Find a beat that feels like the beginning of something.',
  'Songs to engineer': 'Fresh ears. A better balance. Find your next mix.',
  'Find collaborators':
    'Find the artist, producer, or engineer who gets your sound.',
  'Studio rooms': 'Your creative circle, in the same room. Wherever you are.',
  'My projects': 'From a voice memo of an idea to the final bounce.',
  'Saved tracks': 'The sounds you want to come back to.',
  Activity: 'Follows, comments, requests, and messages in one place.',
  Collaborations: 'Private requests and conversations with your next team.',
  'My profile': 'Let the community meet the person behind the sound.',
  Upload: 'Give your next idea a place to land.',
  'Rights & privacy': 'Clear permissions. Room to create.',
  'Connection check': 'Check the studio engine and local media connection.',
};
export default function SessionApp({
  user,
}: {
  user: { id: string; name: string } | null;
}) {
  const [view, setView] = useState('Discover'),
    [genre, setGenre] = useState('All genres'),
    [role, setRole] = useState('Everyone'),
    [query, setQuery] = useState(''),
    [state, setState] = useState(empty),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [notice, setNotice] = useState(''),
    [playing, setPlaying] = useState<Track | null>(null),
    [isPlaying, setIsPlaying] = useState(false),
    [previewBusy, setPreviewBusy] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [duration, setDuration] = useState(0),
    [detail, setDetail] = useState<Track | null>(null),
    [roomId, setRoomId] = useState(''),
    [roomModal, setRoomModal] = useState(false),
    [roomTitle, setRoomTitle] = useState(''),
    [roomProject, setRoomProject] = useState('none'),
    [roomBusy, setRoomBusy] = useState(false),
    [selectedProfile, setSelectedProfile] = useState<any>(null),
    [feedMode, setFeedMode] = useState('For You'),
    [requestTarget, setRequestTarget] = useState<CollaborationTarget | null>(
      null,
    ),
    [requestTrack, setRequestTrack] = useState<{
      id: string;
      title: string;
    } | null>(null),
    [socialVersion, setSocialVersion] = useState(0),
    [deleteProject, setDeleteProject] = useState(''),
    [studioKey, setStudioKey] = useState(0);
  const recovery = useDraftRecovery(user?.id);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [takesOpen, setTakesOpen] = useState(false);
  const studioWorkspaceBusy = useRef(false);
  const workspaceRequest = useRef(0);
  const remixPending = useRef(false);
  const playback = useRef<any>(null),
    roomDrafts = useRef(new Map<string, any>()),
    roomWorkspaceBusy = useRef(false),
    previewSeq = useRef(0),
    noticeTimer = useRef<any>(null),
    draft = useRef<any>({
      title: 'Untitled session',
      data: { bpm: 92, tracks: [] },
    }),
    init = useRef(false),
    appendMode = useRef(false);
  const notify = (m: string) => {
    setNotice(m);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 7500);
  };
  const updateUnreadNotifications = useCallback((count: number) => {
    setState((current: typeof empty) => ({
      ...current,
      unreadNotifications: count,
    }));
  }, []);
  async function refresh() {
    try {
      const r = await fetch('/api/state');
      const j = (await r.json()) as any;
      if (!r.ok) throw new Error(j.error);
      setState(j);
      setLoadError('');
      return j;
    } catch (e: any) {
      setLoadError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }
  function stopPreview() {
    previewSeq.current++;
    playback.current?.stop();
    playback.current = null;
    setIsPlaying(false);
    setElapsed(0);
  }
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const currentDraft =
        roomDrafts.current.get(draft.current.id) || draft.current;
      if (
        currentDraft.dirty ||
        [...roomDrafts.current.values()].some((p) => p.dirty)
      ) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  function go(next: string) {
    if (
      (view === 'Room' && roomWorkspaceBusy.current) ||
      (view === 'Studio' && studioWorkspaceBusy.current)
    ) {
      notify(
        'Finish or close the studio dialog before leaving this workspace.',
      );
      return;
    }
    if (next === 'Studio' || next === 'Room') stopPreview();
    workspaceRequest.current++;
    setView(next);
    const url = new URL(window.location.href);
    url.search = next === 'Discover' ? '' : '?view=' + encodeURIComponent(next);
    url.hash = '';
    window.history.replaceState(null, '', url);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function showRecovery() {
    if (
      (view === 'Room' && roomWorkspaceBusy.current) ||
      (view === 'Studio' && studioWorkspaceBusy.current)
    )
      return notify(
        'Finish or close the studio dialog before reviewing recovery copies.',
      );
    workspaceRequest.current++;
    setRecoveryOpen(true);
    void recovery.refresh();
  }
  async function restoreDraft(record: RecoveryDraft) {
    const request = ++workspaceRequest.current;
    const checkRequest = () => {
      if (request !== workspaceRequest.current)
        throw new Error('The workspace changed. Reopen recovery to continue.');
    };
    let current = await recovery.current(record.key);
    checkRequest();
    let fresh;
    if (!current.projectId && current.creation) {
      const resolved = await action({
        action: 'projectCreation',
        key: current.creation.key,
      });
      checkRequest();
      if (resolved.found) {
        const matches =
          resolved.receipt.requestHash ===
          (await creationHash(current.baseline, current.creation.checkpoint));
        fresh = resolved.project;
        current = {
          ...current,
          projectId: fresh.id,
          baseline: {
            ...(matches
              ? current.baseline
              : { title: fresh.title, data: fresh.data }),
            revision: matches ? resolved.receipt.revision : fresh.revision,
          },
          creation: undefined,
          reviewFirstSave: !matches,
        };
      }
    }
    if (current.projectId && !fresh) {
      try {
        fresh = await action({ action: 'projectRead', id: current.projectId });
      } catch (error: any) {
        if ([401, 403, 404].includes(error.status))
          throw new Error(
            'This project is unavailable or your access has ended. The recovery copy is kept here; ask the owner to restore access.',
          );
        throw new Error(
          'Connect to SESSION so we can check project access before recovering. Your copy is kept here.',
        );
      }
    }
    recoveredProject(current, fresh);
    checkRequest();
    const claimed = await recovery.fork(current);
    checkRequest();
    const p = recoveredProject(
      {
        ...claimed,
        projectId: current.projectId,
        baseline: current.baseline,
        creation: current.creation,
        reviewFirstSave: current.reviewFirstSave,
      },
      fresh,
    );
    draft.current = p;
    if (p.id) roomDrafts.current.set(p.id, p);
    setStudioKey((k) => k + 1);
    appendMode.current = false;
    go('Studio');
    notify(
      'Working copy recovered. Review any newer collaborator changes, then save when ready.',
    );
  }
  async function restoreTakes(id: string, signal: AbortSignal) {
    if (draft.current.dirty && !draft.current.id)
      throw new Error(
        'Save your current new project in the studio before opening saved takes. Its unsaved arrangement is still here.',
      );
    const request = ++workspaceRequest.current;
    const check = () => {
      signal.throwIfAborted();
      if (request !== workspaceRequest.current)
        throw new Error(
          'The workspace changed. Reopen Saved takes to continue.',
        );
    };
    const bank = await loadBank(id, signal);
    check();
    let project: any;
    if (bank.data.projectId) {
      project = await action(
        { action: 'projectRead', id: bank.data.projectId },
        { signal },
      );
      if (!project.canEdit)
        throw new Error(
          'Project editing access ended. Your bank is kept private.',
        );
    }
    check();
    draft.current = bankProject(
      bank,
      project,
      roomDrafts.current.get(bank.data.projectId),
    );
    setStudioKey((k) => k + 1);
    appendMode.current = false;
    go('Studio');
  }
  useEffect(() => {
    if (init.current) return;
    init.current = true;
    const request = workspaceRequest.current;
    refresh().then(async (j) => {
      if (request !== workspaceRequest.current) return;
      const params = new URLSearchParams(window.location.search);
      const name = params.get('view');
      if (name && [...Object.keys(captions), 'Studio'].includes(name))
        setView(name);
      const rid = params.get('room');
      if (rid) {
        const invite = new URLSearchParams(window.location.hash.slice(1)).get(
          'invite',
        );
        try {
          if (invite) {
            await action({ action: 'joinRoom', id: rid, invite });
            if (request !== workspaceRequest.current) return;
            window.history.replaceState(null, '', '?room=' + rid);
          }
          setRoomId(rid);
          setView('Room');
        } catch (e: any) {
          notify(e.message);
        }
      }
      const pid = params.get('project');
      if (pid) {
        try {
          const p = await action({ action: 'projectRead', id: pid });
          if (request !== workspaceRequest.current) return;
          draft.current = p;
          setStudioKey((x) => x + 1);
          setView('Studio');
        } catch (e: any) {
          notify(e.message);
        }
      }
    });
    return () => {
      workspaceRequest.current++;
      playback.current?.stop();
      clearTimeout(noticeTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      if (playback.current)
        setElapsed(
          Math.min(
            duration,
            (performance.now() - playback.current.start) / 1000 +
              (playback.current.seek || 0),
          ),
        );
    }, 100);
    return () => clearInterval(timer);
  }, [isPlaying, duration]);
  async function playPreview(t: Track, seek = 0) {
    if (t.id === playing?.id && isPlaying && seek === 0) {
      stopPreview();
      return;
    }
    stopPreview();
    const seq = previewSeq.current;
    setPlaying(t);
    setPreviewBusy(true);
    try {
      await context().resume();
      const mt = trackFrom(t);
      const b = await bufferFor(mt, t.bpm);
      if (seq !== previewSeq.current) return;
      setDuration(b.duration);
      mt.trimStart = Math.min(seek, b.duration - 0.1);
      const p = await playMix({ bpm: t.bpm, tracks: [mt] }, () => {
        setIsPlaying(false);
        setElapsed(0);
      });
      if (seq !== previewSeq.current) {
        p.stop();
        return;
      }
      playback.current = { ...p, seek: mt.trimStart };
      setIsPlaying(true);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setPreviewBusy(false);
    }
  }
  function signIn() {
    if (user) return true;
    notify('Sign in to save, upload, and collaborate.');
    go('My profile');
    return false;
  }
  async function saveTrack(t: Track) {
    if (!signIn()) return;
    const value = !state.saved.includes(t.id);
    try {
      await action({ action: 'saved', id: t.id, value });
      setState((s: any) => ({
        ...s,
        saved: value
          ? [...s.saved, t.id]
          : s.saved.filter((id: string) => id !== t.id),
      }));
      notify(
        value ? 'Added to your saved tracks.' : 'Removed from saved tracks.',
      );
    } catch (e: any) {
      notify(e.message);
    }
  }
  function useTrack(t: Track) {
    if (t.permission !== 'collaborate' && t.owner !== user?.id)
      return notify('This track is available for listening only.');
    const mt = trackFrom(t);
    if (appendMode.current) {
      if (draft.current.data.tracks.length >= 48)
        return notify('This session has reached the track limit.');
      draft.current = {
        ...draft.current,
        dirty: true,
        data: {
          ...draft.current.data,
          tracks: [...draft.current.data.tracks, mt],
        },
      };
      appendMode.current = false;
    } else
      draft.current = {
        title: t.title + ' — working session',
        dirty: true,
        data: { bpm: t.bpm, tracks: [mt] },
      };
    setStudioKey((k) => k + 1);
    setDetail(null);
    go('Studio');
  }
  async function remix(t: Track) {
    if (!signIn() || remixPending.current) return;
    const request = ++workspaceRequest.current;
    remixPending.current = true;
    try {
      const created = await action({ action: 'remix', id: t.id });
      if (request !== workspaceRequest.current) return;
      const project = await action({ action: 'projectRead', id: created.id });
      if (request !== workspaceRequest.current) return;
      setDetail(null);
      await openProject(project);
      notify('Remix started — the beat is loaded. Add your parts and save.');
    } catch (e: any) {
      if (request === workspaceRequest.current) notify(e.message);
    } finally {
      remixPending.current = false;
    }
  }
  async function openProject(p: any) {
    const request = ++workspaceRequest.current;
    try {
      if (!p.data) p = await action({ action: 'projectRead', id: p.id });
      if (
        request !== workspaceRequest.current ||
        studioWorkspaceBusy.current ||
        roomWorkspaceBusy.current
      )
        return;
      const roomDraft = roomDrafts.current.get(p.id);
      draft.current = roomDraft?.dirty
        ? { ...roomDraft, canEdit: p.canEdit, canManage: p.canManage }
        : p;
      setStudioKey((k) => k + 1);
      go('Studio');
    } catch (e: any) {
      if (request === workspaceRequest.current) notify(e.message);
    }
  }
  function blankProject() {
    draft.current = {
      title: 'Untitled session',
      data: { bpm: 92, tracks: [] },
    };
    setStudioKey((k) => k + 1);
    go('Studio');
  }
  async function follow(p: any) {
    if (!signIn()) return;
    try {
      const value = !state.follows.includes(p.id);
      await action({ action: 'follow', id: p.id, value });
      await refresh();
      notify(
        value
          ? 'You’re now following ' + p.name + '.'
          : 'Unfollowed ' + p.name + '.',
      );
    } catch (e: any) {
      notify(e.message);
    }
  }
  function requestCollaboration(
    target: CollaborationTarget,
    track: Track | null = null,
  ) {
    if (!signIn()) return;
    if (!state.profile) {
      notify('Set up your creative profile before sending a request.');
      go('My profile');
      return;
    }
    setRequestTarget(target);
    setRequestTrack(track ? { id: track.id, title: track.title } : null);
  }
  function requestFromTrack(track: Track) {
    if (!track.owner) return notify('This starter is ready to use directly.');
    const profile = state.profiles.find((item: any) => item.id === track.owner);
    requestCollaboration(
      profile || {
        id: track.owner,
        name: track.creator,
        username: 'creator',
        roles: track.kind === 'song' ? ['Artist'] : ['Producer'],
      },
      track,
    );
  }
  function enterRoom(id: string) {
    if (!signIn()) return;
    setRoomId(id);
    go('Room');
    window.history.replaceState(null, '', '?room=' + id);
  }
  const allTracks: Track[] = [...state.tracks, ...demos];
  const savedGenres = useMemo(
    () =>
      new Set<string>(
        state.tracks
          .filter((track: Track) => state.saved.includes(track.id))
          .map((track: Track) => track.genre),
      ),
    [state.saved, state.tracks],
  );
  const baseFiltered = allTracks.filter(
    (t) =>
      (genre === 'All genres' || genre === t.genre) &&
      `${t.title} ${t.creator} ${t.genre}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (view === 'Saved tracks'
        ? state.saved.includes(t.id)
        : view === 'Songs to engineer'
          ? t.kind === 'song' && t.permission === 'collaborate'
          : view === 'Beat library'
            ? t.kind === 'beat'
            : true),
  );
  const usesDiscoveryFeed = [
    'Discover',
    'Beat library',
    'Songs to engineer',
  ].includes(view);
  const newestTrackCreated = Math.max(
    0,
    ...allTracks.map((track: Track) => track.created || 0),
  );
  const filtered = usesDiscoveryFeed
    ? baseFiltered
        .filter(
          (track) =>
            feedMode !== 'Following' ||
            (!!track.owner && state.follows.includes(track.owner)),
        )
        .slice()
        .sort((a, b) => {
          if (feedMode === 'New')
            return (
              (b.created || 0) - (a.created || 0) || a.id.localeCompare(b.id)
            );
          if (feedMode === 'Following')
            return (
              (b.created || 0) - (a.created || 0) || a.id.localeCompare(b.id)
            );
          const score = (track: Track) =>
            (track.owner && state.follows.includes(track.owner) ? 1000 : 0) +
            (savedGenres.has(track.genre) ? 400 : 0) +
            (track.permission === 'collaborate' ? 140 : 0) +
            Number(track.likes || 0) * 12 +
            (track.demo ? 0 : 35) +
            Math.max(
              0,
              120 -
                Math.floor(
                  (newestTrackCreated - (track.created || 0)) / 86400000,
                ) *
                  4,
            );
          return (
            score(b) - score(a) ||
            (b.created || 0) - (a.created || 0) ||
            a.id.localeCompare(b.id)
          );
        })
    : baseFiltered;
  function recommendationReason(track: Track) {
    if (track.visibility === 'private') return 'Your private upload';
    if (feedMode === 'Following') return 'From someone you follow';
    if (feedMode === 'New')
      return track.demo ? 'SESSION starter' : 'Recently shared';
    if (track.owner && state.follows.includes(track.owner))
      return 'From someone you follow';
    if (savedGenres.has(track.genre))
      return `Matches your saved ${track.genre}`;
    if (track.permission === 'collaborate') return 'Open to collaboration';
    if (track.likes) return 'Saved by SESSION creators';
    return track.demo ? 'SESSION starter' : 'New to the community';
  }
  function formatCount(n?: number) {
    if (!n) return 'Like';
    return n >= 1000
      ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
      : String(n);
  }
  async function shareTrack(t: Track) {
    try {
      await navigator.clipboard.writeText(
        window.location.origin + '/?track=' + t.id,
      );
      notify('Link to ' + t.title + ' copied.');
    } catch {
      notify('Could not copy the link on this browser.');
    }
  }
  function feedPost(t: Track) {
    const isSaved = state.saved.includes(t.id),
      active = playing?.id === t.id,
      isPlayingTrack = active && isPlaying,
      creatorProfile = state.profiles.find((item: any) => item.id === t.owner),
      wave = coverWaveform(t.id + t.title, 40),
      progress = active && duration ? Math.min(1, elapsed / duration) : 0,
      reason = recommendationReason(t),
      studioAllowed = t.permission === 'collaborate' || t.owner === user?.id;
    return (
      <article className="feed-post" key={t.id}>
        <header className="post-head">
          <button
            className="post-creator"
            onClick={() =>
              creatorProfile ? setSelectedProfile(creatorProfile) : setDetail(t)
            }
          >
            <Avatar profile={creatorProfile || { name: t.creator }} size={40} />
            <span>
              <strong>{t.creator}</strong>
              <small>
                {creatorProfile ? '@' + creatorProfile.username : t.kind}
                {t.owner && t.owner === user?.id ? ' · you' : ''}
              </small>
            </span>
          </button>
          <div className="post-head-actions">
            {t.owner &&
              !state.follows.includes(t.owner) &&
              t.owner !== user?.id && (
                <button
                  className="button secondary small"
                  onClick={() => follow({ id: t.owner, name: t.creator })}
                >
                  Follow
                </button>
              )}
            <button
              className="post-more"
              aria-label={'More about ' + t.title}
              onClick={() => setDetail(t)}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
        </header>
        <div className="post-media">
          <button
            className="post-cover"
            onClick={() => playPreview(t)}
            aria-label={(isPlayingTrack ? 'Pause ' : 'Play ') + t.title}
          >
            <CoverArt
              seed={t.id + t.title}
              label={t.title}
              size={0}
              className="cover-fill"
              spinning={!!isPlayingTrack}
            />
            <span className="post-play">
              {isPlayingTrack ? <Pause size={22} /> : <Play size={22} />}
            </span>
          </button>
        </div>
        <div className="post-wave" aria-hidden="true">
          {wave.map((v, i) => (
            <i
              key={i}
              style={{
                height: Math.round(v * 100) + '%',
                opacity: i / wave.length <= progress ? 1 : 0.35,
              }}
            />
          ))}
        </div>
        <div className="post-info">
          <strong>{t.title}</strong>
          <div className="post-chips">
            <span className="chip">{t.genre}</span>
            {t.bpm ? <span className="chip">{t.bpm} BPM</span> : null}
            {t.musicalKey ? <span className="chip">{t.musicalKey}</span> : null}
            <span className={'chip perm-' + t.permission}>
              {t.permission === 'collaborate'
                ? 'Open collab'
                : t.permission === 'listen'
                  ? 'Listen only'
                  : 'Private'}
            </span>
          </div>
          {reason && <span className="post-reason">{reason}</span>}
        </div>
        <footer className="post-actions">
          <button
            className={'post-act' + (isSaved ? ' liked' : '')}
            onClick={() => saveTrack(t)}
            aria-label={isSaved ? 'Unlike ' + t.title : 'Like ' + t.title}
          >
            <Heart size={17} /> {formatCount(t.likes)}
          </button>
          <button className="post-act" onClick={() => setDetail(t)}>
            <MessageCircle size={17} /> Comments
          </button>
          <button className="post-act" onClick={() => void shareTrack(t)}>
            <Share2 size={16} /> Share
          </button>
          <button
            className="post-act"
            disabled={!studioAllowed}
            onClick={() => useTrack(t)}
          >
            <SlidersHorizontal size={16} /> Studio
          </button>
        </footer>
      </article>
    );
  }
  function cards(tracks: Track[]) {
    return (
      <div className="beat-grid">
        {tracks.map((t) => (
          <article className="beat-card" key={t.id}>
            <div className={'cover cover-' + (t.color || 'lime')}>
              <button
                className="cover-detail"
                aria-label={'Details for ' + t.title}
                onClick={() => setDetail(t)}
              >
                <CoverArt
                  seed={t.id + t.title}
                  label={t.title}
                  size={0}
                  className="cover-fill"
                />
              </button>
              <span className="genre-label">{t.genre}</span>
              <button
                className="play-cover"
                aria-label={
                  (playing?.id === t.id && isPlaying ? 'Stop ' : 'Play ') +
                  t.title
                }
                onClick={() => playPreview(t)}
              >
                {playing?.id === t.id && isPlaying ? (
                  <Pause size={18} />
                ) : (
                  <Play size={19} fill="currentColor" />
                )}
              </button>
            </div>
            <div className="track-name">
              <button onClick={() => setDetail(t)}>
                <h3>{t.title}</h3>
              </button>
              <button
                className={state.saved.includes(t.id) ? 'green-text' : ''}
                aria-label={
                  (state.saved.includes(t.id) ? 'Unsave ' : 'Save ') + t.title
                }
                onClick={() => saveTrack(t)}
              >
                <Heart
                  size={17}
                  fill={state.saved.includes(t.id) ? 'currentColor' : 'none'}
                />
              </button>
            </div>
            <p>{t.creator}</p>
            {usesDiscoveryFeed && (
              <span className="discovery-reason">
                <span className="status-dot" /> {recommendationReason(t)}
              </span>
            )}
            <div className="track-meta">
              <span>
                {t.bpm} BPM <span>·</span> {t.musicalKey}
              </span>
              <span
                className={t.permission === 'collaborate' ? 'green-text' : ''}
              >
                {t.visibility === 'private'
                  ? 'Private'
                  : t.permission === 'collaborate'
                    ? 'Open collab'
                    : 'Listen only'}
              </span>
            </div>
          </article>
        ))}
      </div>
    );
  }
  function genreTabs() {
    return (
      <Tabs value={genre} onValueChange={(v) => setGenre(String(v))}>
        <TabsList className="genre-tabs">
          {genres.map((g) => (
            <TabsTrigger value={g} key={g}>
              {g}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    );
  }
  function discoveryTabs() {
    return (
      <div className="discovery-tabs">
        <span>YOUR MUSIC FEED</span>
        <Tabs
          value={feedMode}
          onValueChange={(value) => setFeedMode(String(value))}
        >
          <TabsList>
            {['For You', 'Following', 'New'].map((mode) => (
              <TabsTrigger value={mode} key={mode}>
                {mode}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    );
  }
  const signin = (
    <div className="empty-state">
      <Users size={38} />
      <h2>Your next chapter starts here.</h2>
      <p>
        Sign in to create your profile, keep your projects, and connect with
        collaborators.
      </p>
      <a
        className="button primary"
        href="/signin-with-chatgpt?return_to=/"
        target="_top"
      >
        Sign in with ChatGPT <ArrowUpRight size={16} />
      </a>
    </div>
  );
  return (
    <div className="social-app">
      <aside className="social-rail" aria-label="Primary">
        <button
          className="rail-brand"
          onClick={() => go('Discover')}
          aria-label="SESSION home"
        >
          <AudioLines />
        </button>
        <div className="rail-group">
          {(
            [
              [Home, 'Feed', 'Discover'],
              [Compass, 'Explore', 'Beat library'],
              [Users, 'People', 'Find collaborators'],
              [Radio, 'Rooms', 'Studio rooms'],
              [MessagesSquare, 'Messages', 'Collaborations'],
              [Bell, 'Alerts', 'Activity'],
            ] as const
          ).map(([Icon, label, target]) => (
            <button
              key={label}
              className={'rail-button' + (view === target ? ' active' : '')}
              onClick={() => go(target)}
              aria-label={label}
              aria-current={view === target ? 'page' : undefined}
            >
              <Icon size={20} />
              {target === 'Activity' && state.unreadNotifications > 0 && (
                <span className="rail-badge">
                  {state.unreadNotifications > 99
                    ? '99+'
                    : state.unreadNotifications}
                </span>
              )}
              <span className="rail-tip">{label}</span>
            </button>
          ))}
        </div>
        <button
          className={
            'rail-button rail-create' + (view === 'Studio' ? ' active' : '')
          }
          onClick={() => go('Studio')}
          aria-label="Create in the studio"
        >
          <SlidersHorizontal size={20} />
          <span className="rail-tip">Create</span>
        </button>
        <div className="rail-spacer" />
        <button
          className="rail-button"
          onClick={() => go('Rights & privacy')}
          aria-label="Rights and privacy"
        >
          <ShieldCheck size={20} />
          <span className="rail-tip">Rights</span>
        </button>
        <button
          className={'rail-avatar' + (view === 'My profile' ? ' active' : '')}
          onClick={() => go('My profile')}
          aria-label="Your profile"
        >
          <Avatar profile={state.profile || user} size={30} />
        </button>
      </aside>
      <div className="social-shell">
        <header className="social-top">
          <button className="social-brand" onClick={() => go('Discover')}>
            session<span className="brand-dot">.</span>
          </button>
          <div className="global-search">
            <Search size={17} />
            <input
              aria-label="Search music and creators"
              placeholder="Search beats, songs, creators…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (
                  ![
                    'Discover',
                    'Beat library',
                    'Songs to engineer',
                    'Saved tracks',
                    'Find collaborators',
                  ].includes(view)
                )
                  go('Discover');
              }}
            />
            <kbd>⌕</kbd>
          </div>
          <button
            className="button primary social-upload"
            onClick={() => go('Upload')}
          >
            <Plus size={17} /> Upload
          </button>
        </header>
        {notice && (
          <div className="notice" role="status">
            <Check size={16} />
            <span>{notice}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <main>
          {user && (recovery.error || recovery.drafts.length > 0) && (
            <div
              className={
                'recovery-bar' + (recovery.error ? ' recovery-warning' : '')
              }
              role="status"
            >
              <div>
                <strong>
                  {recovery.error
                    ? 'Browser recovery needs attention'
                    : view === 'Studio' || view === 'Room'
                      ? recovery.status || 'Recovery copies available'
                      : 'Unsaved work on this browser'}
                </strong>
                <p>
                  {recovery.error ||
                    `${recovery.drafts.length} recovery ${recovery.drafts.length === 1 ? 'copy' : 'copies'} · arrangement edits only`}
                </p>
              </div>
              <button className="button secondary" onClick={showRecovery}>
                Review drafts
              </button>
            </div>
          )}
          {!['Studio', 'Room', 'Discover'].includes(view) && (
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {view === 'Discover'
                    ? 'FIND YOUR NEXT SOUND'
                    : 'YOUR SOUND. YOUR PEOPLE.'}
                </div>
                <h1>
                  {view === 'Discover'
                    ? 'In good company.'
                    : view === 'Upload'
                      ? 'Upload music'
                      : view}
                </h1>
                <p>{captions[view]}</p>
              </div>
              <button className="button secondary" onClick={() => go('Studio')}>
                <AudioLines size={17} /> Open studio <ArrowUpRight size={15} />
              </button>
            </div>
          )}
          {loadError && (
            <div className="error-banner" role="alert">
              {loadError} <button onClick={refresh}>Try again</button>
            </div>
          )}
          {view === 'Discover' ? (
            <div className="feed">
              <section className="feed-hero">
                <div className="feed-hero-copy">
                  <span className="pill">
                    <span className="status-dot" /> THE MUSIC COMMUNITY
                  </span>
                  <h2>
                    Your music world
                    <br />
                    <em>lives here.</em>
                  </h2>
                  <p>
                    Sounds from people you follow, rooms happening now, and the
                    next thing you'll wish you made.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => go('Studio')}
                  >
                    Start a session <ArrowUpRight size={17} />
                  </button>
                </div>
                <Scene3D
                  variant="hero"
                  poster="/session-hero.png"
                  alt="3D equalizer pillars glowing red in a black mirror studio"
                  label="Interactive 3D equalizer canyon. Drag to orbit."
                />
              </section>
              <div className="stories-rail" aria-label="Rooms and creators">
                <button
                  className="story story-add"
                  onClick={() => {
                    if (signIn()) setRoomModal(true);
                  }}
                >
                  <span className="story-ring add">
                    <Plus size={16} />
                  </span>
                  <small>Create room</small>
                </button>
                {state.rooms.map((room: any) => (
                  <button
                    className="story"
                    key={room.id}
                    onClick={() => enterRoom(room.id)}
                  >
                    <span
                      className={
                        'story-ring' + (room.active > 0 ? ' live' : '')
                      }
                    >
                      <Radio size={15} />
                    </span>
                    <small>
                      {room.name}
                      {room.active > 0 ? ` · ${room.active} live` : ''}
                    </small>
                  </button>
                ))}
                {state.profiles
                  .filter((p: any) => state.follows.includes(p.id))
                  .slice(0, 9)
                  .map((p: any) => (
                    <button
                      className="story"
                      key={p.id}
                      onClick={() => setSelectedProfile(p)}
                    >
                      <span className="story-ring followed">
                        <Avatar profile={p} size={44} />
                      </span>
                      <small>{p.username || p.name}</small>
                    </button>
                  ))}
                {state.profiles
                  .filter(
                    (p: any) =>
                      !state.follows.includes(p.id) && p.id !== user?.id,
                  )
                  .sort(
                    (a: any, b: any) => (b.followers || 0) - (a.followers || 0),
                  )
                  .slice(0, 5)
                  .map((p: any) => (
                    <button
                      className="story"
                      key={p.id}
                      onClick={() => setSelectedProfile(p)}
                    >
                      <span className="story-ring">
                        <Avatar profile={p} size={44} />
                      </span>
                      <small>{p.username || p.name}</small>
                    </button>
                  ))}
              </div>
              {discoveryTabs()}
              {genreTabs()}
              <div className="feed-posts">
                {filtered.length ? (
                  filtered.slice(0, 12).map((track: Track) => feedPost(track))
                ) : (
                  <Empty
                    title="Nothing on this frequency yet."
                    text="Try another genre or clear your search."
                  />
                )}
              </div>
              <section className="workflow">
                <div className="section-title">
                  <h2>Different talents. Same wavelength.</h2>
                </div>
                <div className="role-grid">
                  {[
                    [
                      Disc3,
                      'For producers',
                      'Set the tone.',
                      'Upload a beat. Find the voice it needs.',
                    ],
                    [
                      Mic2,
                      'For artists',
                      'Make it yours.',
                      'Find your sound. Record your next track.',
                    ],
                    [
                      SlidersHorizontal,
                      'For engineers',
                      'Bring it to life.',
                      'Find a song. Shape the final sound.',
                    ],
                  ].map(([Icon, label, title, desc]: any) => (
                    <button
                      className="role-card"
                      key={label}
                      onClick={() =>
                        go(
                          label === 'For engineers'
                            ? 'Songs to engineer'
                            : label === 'For producers'
                              ? 'Upload'
                              : 'Beat library',
                        )
                      }
                    >
                      <Icon size={21} />
                      <span>{label}</span>
                      <h3>{title}</h3>
                      <p>{desc}</p>
                      <ArrowUpRight size={17} />
                    </button>
                  ))}
                </div>
              </section>
              <div className="feed-footnote">
                SESSION © 2026 · Independent sounds. Shared space. ·{' '}
                <button onClick={() => go('Rights & privacy')}>
                  Your rights
                </button>
              </div>
            </div>
          ) : ['Beat library', 'Songs to engineer', 'Saved tracks'].includes(
              view,
            ) ? (
            <>
              <div className="library-tabs">
                <Tabs
                  value={view === 'Songs to engineer' ? 'Songs' : 'Beats'}
                  onValueChange={(v) =>
                    go(v === 'Songs' ? 'Songs to engineer' : 'Beat library')
                  }
                >
                  <TabsList>
                    <TabsTrigger value="Beats">Beats</TabsTrigger>
                    <TabsTrigger value="Songs">Songs to engineer</TabsTrigger>
                  </TabsList>
                </Tabs>
                <span>{filtered.length} sounds</span>
              </div>
              {view !== 'Saved tracks' && discoveryTabs()}
              {genreTabs()}
              {filtered.length ? (
                cards(filtered)
              ) : (
                <Empty
                  title={
                    view === 'Saved tracks'
                      ? 'Keep the sounds that stay with you.'
                      : feedMode === 'Following'
                        ? 'Follow creators to tune this feed.'
                        : 'A fresh space for a fresh sound.'
                  }
                  text={
                    view === 'Saved tracks'
                      ? 'Tap the heart on any track to find it here.'
                      : feedMode === 'Following'
                        ? 'Find artists, producers, and engineers you want to hear from.'
                        : 'No matching uploads yet. Try another filter or upload the first track.'
                  }
                  actionLabel="Explore beats"
                  action={() => go('Beat library')}
                />
              )}
              <p className="small-note">
                SESSION Originals are synthesized starter loops you can use
                freely. Community uploads follow their creator’s permissions.
              </p>
            </>
          ) : view === 'Activity' ? (
            user ? (
              <ActivityView
                onUnreadChange={updateUnreadNotifications}
                onOpen={(item) => {
                  if (item.resourceType === 'collaboration')
                    go('Collaborations');
                  else if (item.resourceType === 'track') {
                    const track = allTracks.find(
                      (candidate) => candidate.id === item.resourceId,
                    );
                    if (track) setDetail(track);
                    else go('Discover');
                  } else {
                    const profile = state.profiles.find(
                      (candidate: any) => candidate.id === item.resourceId,
                    );
                    if (profile) setSelectedProfile(profile);
                    else go('Find collaborators');
                  }
                }}
              />
            ) : (
              signin
            )
          ) : view === 'Collaborations' ? (
            user ? (
              <CollaborationInbox
                key={socialVersion}
                userId={user.id}
                notify={notify}
                onChanged={() => void refresh()}
              />
            ) : (
              signin
            )
          ) : view === 'Upload' ? (
            user ? (
              <UploadForm
                notify={notify}
                onDone={() => {
                  refresh();
                  go('Discover');
                }}
              />
            ) : (
              signin
            )
          ) : view === 'My profile' ? (
            user ? (
              <ProfileForm
                key={state.profile?.id || 'new'}
                profile={state.profile}
                user={user}
                notify={notify}
                onDone={refresh}
              />
            ) : (
              signin
            )
          ) : view === 'Rights & privacy' ? (
            <LegalCenter user={user} notify={notify} />
          ) : view === 'Connection check' ? (
            <Diagnostics />
          ) : view === 'My projects' ? (
            <>
              <div className="section-title">
                <h2>
                  Your sessions{' '}
                  <span className="tiny-label">PRIVATE BY DEFAULT</span>
                </h2>
                <div className="actions">
                  <button
                    className="button secondary"
                    onClick={showRecovery}
                    disabled={!user}
                  >
                    Browser recovery
                  </button>
                  <button
                    className="button secondary"
                    disabled={!user}
                    onClick={() => setTakesOpen(true)}
                  >
                    Saved takes
                  </button>
                  <button className="button primary" onClick={blankProject}>
                    <Plus size={16} /> New project
                  </button>
                </div>
              </div>
              {loading ? (
                <p>Loading your projects…</p>
              ) : state.projects.length ? (
                <div className="project-grid">
                  {state.projects.map((p: any) => (
                    <article className="project-card" key={p.id}>
                      <div className="project-art">
                        <AudioLines size={44} />
                        <span>
                          <LockKeyhole size={13} /> Private
                        </span>
                      </div>
                      <h3>{p.title}</h3>
                      <p>
                        {p.trackCount ?? p.data?.tracks.length ?? 0} tracks ·{' '}
                        {p.bpm ?? p.data?.bpm} BPM
                      </p>
                      <small>
                        Updated {new Date(p.updated).toLocaleDateString()}
                      </small>
                      <div className="actions">
                        <button
                          className="button secondary"
                          onClick={() => openProject(p)}
                        >
                          Open session <ArrowUpRight size={16} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={'Delete ' + p.title}
                          onClick={() => setDeleteProject(p.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  title="Your next session is a blank canvas."
                  text="Choose a beat or open the studio. Save your arrangement and it will be here when you return."
                  actionLabel="Start creating"
                  action={blankProject}
                />
              )}
            </>
          ) : view === 'Find collaborators' ? (
            <>
              <Tabs value={role} onValueChange={(v) => setRole(String(v))}>
                <TabsList className="genre-tabs">
                  {['Everyone', 'Artist', 'Producer', 'Engineer'].map((r) => (
                    <TabsTrigger value={r} key={r}>
                      {r === 'Everyone' ? r : r + 's'}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              {state.profiles.filter(
                (p: any) =>
                  (role === 'Everyone' || JSON.parse(p.roles).includes(role)) &&
                  `${p.name} ${p.username} ${p.bio}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              ).length ? (
                <div className="profile-grid">
                  {state.profiles
                    .filter(
                      (p: any) =>
                        (role === 'Everyone' ||
                          JSON.parse(p.roles).includes(role)) &&
                        `${p.name} ${p.username} ${p.bio}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                    )
                    .map((p: any) => (
                      <article className="profile-card" key={p.id}>
                        <button
                          className="profile-person"
                          onClick={() => setSelectedProfile(p)}
                        >
                          <Avatar profile={p} size={62} />
                          <h3>{p.name}</h3>
                          <span>@{p.username}</span>
                        </button>
                        <div className="role-tags">
                          {JSON.parse(p.roles).map((r: string) => (
                            <span key={r}>{r}</span>
                          ))}
                        </div>
                        <p>{p.bio || 'Here to make something great.'}</p>
                        <small>
                          {p.location || 'Creating everywhere'} · {p.followers}{' '}
                          followers
                        </small>
                        {p.id !== user?.id && (
                          <button
                            className="button secondary"
                            onClick={() => follow(p)}
                          >
                            {state.follows.includes(p.id) ? (
                              <Check size={16} />
                            ) : (
                              <Plus size={16} />
                            )}{' '}
                            {state.follows.includes(p.id)
                              ? 'Following'
                              : 'Follow creator'}
                          </button>
                        )}
                      </article>
                    ))}
                </div>
              ) : (
                <Empty
                  title="Be the first on this wavelength."
                  text="Make your profile public to appear here. Artists, producers, and engineers with public profiles will join this community."
                  actionLabel="Set up your profile"
                  action={() => go('My profile')}
                />
              )}
            </>
          ) : view === 'Studio rooms' ? (
            <>
              <div className="section-title">
                <h2>Make room for a good session.</h2>
                <button
                  className="button secondary"
                  onClick={() => go('Connection check')}
                >
                  Check connection & audio engine
                </button>
              </div>
              <div className="room-intro">
                <div className="room-visual">
                  <Headphones size={42} />
                </div>
                <div>
                  <h2>Your studio has no postcode.</h2>
                  <p>
                    Create an invite-only space for up to four people. Bring
                    your sound, your camera, and your next idea.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => {
                    if (signIn()) setRoomModal(true);
                  }}
                >
                  <Plus size={16} /> Create a room
                </button>
              </div>
              {state.rooms.length ? (
                <div className="project-grid">
                  {state.rooms.map((r: any) => (
                    <article className="project-card room-card" key={r.id}>
                      <Radio size={30} className="green-text" />
                      <span className="room-badge">
                        <LockKeyhole size={12} /> Invite only
                      </span>
                      <h3>{r.title}</h3>
                      <p>{r.active} currently in room</p>
                      <button
                        className="button secondary"
                        onClick={() => enterRoom(r.id)}
                      >
                        Enter session <ArrowUpRight size={16} />
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  title="The room is yours to create."
                  text="Create a room, copy its invitation, and send it to your collaborators. Site access is also required during this private preview."
                />
              )}
            </>
          ) : view === 'Studio' ? (
            <Studio
              key={studioKey}
              initial={draft.current}
              onDraft={(p) => {
                workspaceRequest.current++;
                draft.current = p;
                if (p.id) roomDrafts.current.set(p.id, p);
                recovery.capture(p);
              }}
              onActivity={(busy) => {
                studioWorkspaceBusy.current = busy;
              }}
              onPrepareSave={recovery.prepareCreation}
              onSaved={(p) => {
                refresh();
              }}
              onBrowse={() => {
                appendMode.current = true;
                go('Beat library');
              }}
              notify={notify}
            />
          ) : view === 'Room' ? (
            user ? (
              <Room
                key={roomId}
                id={roomId}
                user={user}
                notify={notify}
                onExit={() => {
                  go('Studio rooms');
                  refresh();
                }}
                projects={state.projects}
                onProjectsChanged={refresh}
                drafts={roomDrafts.current}
                onDraft={(p) => {
                  roomDrafts.current.set(p.id, p);
                  if (draft.current.id === p.id) draft.current = p;
                  recovery.capture(p);
                }}
                onWorkspaceBusy={(busy) => {
                  roomWorkspaceBusy.current = busy;
                }}
                catalog={allTracks.filter(
                  (track) =>
                    track.permission === 'collaborate' ||
                    track.owner === user.id,
                )}
              />
            ) : (
              signin
            )
          ) : null}
        </main>
        <nav className="social-tabs" aria-label="Main navigation">
          {(
            [
              [Home, 'Home', 'Discover'],
              [Compass, 'Explore', 'Beat library'],
              [SlidersHorizontal, 'Create', 'Studio'],
              [Radio, 'Rooms', 'Studio rooms'],
              [Users, 'People', 'Find collaborators'],
            ] as const
          ).map(([Icon, label, target]) => (
            <button
              key={label}
              className={'tab' + (view === target ? ' active' : '')}
              onClick={() => go(target)}
              aria-label={label}
              aria-current={view === target ? 'page' : undefined}
            >
              <Icon size={20} />
              <small>{label}</small>
            </button>
          ))}
        </nav>
        <footer
          className="player"
          style={view === 'Room' ? { display: 'none' } : undefined}
        >
          <div className="now-playing">
            <CoverArt
              seed={(playing?.id || 'session') + (playing?.title || '')}
              label={playing?.title}
              size={46}
              spinning={!!playing && isPlaying}
            />
            <button
              className="now-playing-title"
              onClick={() => playing && setDetail(playing)}
            >
              <strong>
                {playing?.title || 'Find something that moves you'}
              </strong>
              <small>
                {playing?.creator || 'Press play on your next idea'}
              </small>
            </button>
            {playing && (
              <button
                aria-label="Save current track"
                onClick={() => saveTrack(playing)}
              >
                <Heart
                  size={17}
                  fill={
                    state.saved.includes(playing.id) ? 'currentColor' : 'none'
                  }
                />
              </button>
            )}
          </div>
          <div className="player-center">
            <button
              aria-label={isPlaying ? 'Stop preview' : 'Play preview'}
              disabled={previewBusy || view === 'Studio' || view === 'Room'}
              onClick={() => playPreview(playing || demos[0])}
            >
              {previewBusy ? (
                <Loader2 size={17} className="spin" />
              ) : isPlaying ? (
                <Pause size={19} />
              ) : (
                <Play size={19} fill="currentColor" />
              )}
            </button>
            <span>{time(elapsed)}</span>
            <div className="player-seek">
              <Range
                label="Preview position"
                value={elapsed}
                max={duration || 1}
                onChange={(v) => playing && playPreview(playing, v)}
              />
            </div>
            <span>{time(duration)}</span>
          </div>
          <div className="player-right">
            <Headphones size={17} />
            <span>Made to be heard.</span>
            <button
              className="button secondary"
              disabled={
                !!playing &&
                playing.permission !== 'collaborate' &&
                playing.owner !== user?.id
              }
              onClick={() => useTrack(playing || demos[0])}
            >
              Use in studio <ArrowUpRight size={16} />
            </button>
          </div>
        </footer>
      </div>
      <TrackDetail
        track={detail}
        user={user}
        saved={!!detail && state.saved.includes(detail.id)}
        onClose={() => setDetail(null)}
        onPlay={playPreview}
        onUse={useTrack}
        onRemix={remix}
        onRequest={requestFromTrack}
        onSave={saveTrack}
        onRefresh={refresh}
        notify={notify}
      />
      <Dialog open={roomModal} onOpenChange={setRoomModal}>
        <DialogContent className="form-dialog">
          <DialogTitle>Make room for a great session.</DialogTitle>
          <DialogDescription>
            Your room is private. Invite up to three collaborators.
          </DialogDescription>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setRoomBusy(true);
              try {
                const r = await action({
                  action: 'room',
                  title: roomTitle,
                  project: roomProject === 'none' ? null : roomProject,
                });
                setRoomModal(false);
                setRoomTitle('');
                await refresh();
                enterRoom(r.id);
              } catch (e: any) {
                notify(e.message);
              } finally {
                setRoomBusy(false);
              }
            }}
          >
            <label className="field">
              <span>Room name</span>
              <input
                required
                maxLength={100}
                placeholder="Late-night session"
                value={roomTitle}
                onChange={(e) => setRoomTitle(e.target.value)}
              />
            </label>
            <Pick
              label="Share a saved project (optional)"
              value={roomProject}
              onChange={setRoomProject}
              options={[
                { value: 'none', label: 'No project yet' },
                ...state.projects.map((p: any) => ({
                  value: p.id,
                  label: p.title,
                })),
              ]}
            />
            <p className="small-note">
              Room members can listen to the attached project and its private
              audio. The owner can allow room members to edit and save changes.
            </p>
            <button className="button primary wide" disabled={roomBusy}>
              {roomBusy ? 'Creating your room…' : 'Create private room'}
              <ArrowUpRight size={16} />
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selectedProfile}
        onOpenChange={(v) => !v && setSelectedProfile(null)}
      >
        <DialogContent className="form-dialog">
          {selectedProfile && (
            <>
              <Avatar profile={selectedProfile} size={76} />
              <DialogTitle>{selectedProfile.name}</DialogTitle>
              <DialogDescription>
                @{selectedProfile.username} ·{' '}
                {JSON.parse(selectedProfile.roles).join(' / ')}
              </DialogDescription>
              <p>{selectedProfile.bio}</p>
              <p>{selectedProfile.location}</p>
              {selectedProfile.id !== user?.id && (
                <div className="actions">
                  <button
                    className="button primary"
                    onClick={() => follow(selectedProfile)}
                  >
                    {state.follows.includes(selectedProfile.id)
                      ? 'Following'
                      : 'Follow creator'}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => {
                      const target = selectedProfile;
                      setSelectedProfile(null);
                      requestCollaboration(target);
                    }}
                  >
                    <Handshake size={16} /> Request collaboration
                  </button>
                </div>
              )}
              <h3>Public music</h3>
              {state.tracks
                .filter(
                  (t: Track) =>
                    t.owner === selectedProfile.id && t.visibility === 'public',
                )
                .map((t: Track) => (
                  <button
                    key={t.id}
                    className="profile-track"
                    onClick={() => {
                      setSelectedProfile(null);
                      setDetail(t);
                    }}
                  >
                    <Disc3 size={18} />
                    {t.title}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
            </>
          )}
        </DialogContent>
      </Dialog>
      <CollaborationRequestDialog
        key={`${requestTarget?.id || 'none'}:${requestTrack?.id || 'none'}`}
        open={!!requestTarget}
        target={requestTarget}
        track={requestTrack}
        onOpenChange={(open) => {
          if (!open) {
            setRequestTarget(null);
            setRequestTrack(null);
          }
        }}
        onSent={() => {
          setSocialVersion((version) => version + 1);
          void refresh();
          go('Collaborations');
        }}
        notify={notify}
      />
      <Confirm
        open={!!deleteProject}
        onClose={() => setDeleteProject('')}
        title="Delete this project?"
        description="Your arrangement will be removed and detached from its studio rooms. Recovery copies of this project for your account on this browser will also be removed. Original media remains in storage."
        onConfirm={async () => {
          try {
            await action({ action: 'deleteProject', id: deleteProject });
            roomDrafts.current.delete(deleteProject);
            if (draft.current.id === deleteProject)
              draft.current = {
                title: 'Untitled session',
                data: { bpm: 92, tracks: [] },
              };
            try {
              await recovery.deleteProject(deleteProject);
            } catch {
              notify(
                'Project deleted. Browser recovery cleanup failed; remove its local copies in Browser recovery.',
              );
              await refresh();
              return;
            }
            await refresh();
            notify('Project deleted.');
          } catch (e: any) {
            notify(e.message);
          }
        }}
      />
      <RecoveryPanel
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        recovery={recovery}
        onRecover={restoreDraft}
      />
      <SavedTakesPanel
        key={user?.id || 'signed-out'}
        open={takesOpen && !!user}
        onClose={() => setTakesOpen(false)}
        onOpen={restoreTakes}
      />
    </div>
  );
}
function Empty({
  title,
  text,
  actionLabel,
  action,
}: {
  title: string;
  text: string;
  actionLabel?: string;
  action?: () => void;
}) {
  return (
    <div className="empty-state">
      <AudioLines size={35} />
      <h2>{title}</h2>
      <p>{text}</p>
      {action && (
        <button className="button secondary" onClick={action}>
          {actionLabel}
          <ArrowUpRight size={16} />
        </button>
      )}
    </div>
  );
}
function time(n: number) {
  return (
    Math.floor(n / 60) +
    ':' +
    Math.floor(n % 60)
      .toString()
      .padStart(2, '0')
  );
}
