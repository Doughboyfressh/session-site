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
  CircleDollarSign,
  Flame,
  Video,
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
import { originalArrangement } from '@/lib/originals';
import { validateArrangement } from '@/lib/arrangement-validation';
import { playlistTrackEnd } from '@/lib/playlist-clips';
import {
  Pick,
  Avatar,
  Confirm,
  Range,
  action,
  stripeAction,
  formatPrice,
} from './helpers';
import { UploadForm, ProfileForm, TrackDetail } from './forms';
import LegalCenter from './legal-center';
import Diagnostics from './diagnostics';
import Studio from './studio';
import Scene3D from './scene-3d';
import Onboarding, { tourNeeded, tourDone } from './onboarding';
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
  payments: { configured: false, chargesEnabled: false, payoutsEnabled: false },
  orders: [],
  trending: [],
  liveRooms: [],
  posts: [],
  pulse: { tracks: 0, creators: 0, tracksToday: 0, publicRooms: 0 },
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
    [tourOpen, setTourOpen] = useState(false),
    [results, setResults] = useState<any>(null),
    [searching, setSearching] = useState(false),
    [roomDiscoverable, setRoomDiscoverable] = useState('invite'),
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
    previewAbort = useRef<AbortController | null>(null),
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
  useEffect(() => {
    if (loading || loadError) return;
    if (tourNeeded()) setTourOpen(true);
  }, [loading, loadError]);
  const playsCounted = useRef<Set<string>>(new Set()),
    watchedPosts = useRef<Set<string>>(new Set()),
    armedDelete = useRef(''),
    deepLinkHandled = useRef(false),
    lastUnread = useRef(0);
  useEffect(() => {
    if (deepLinkHandled.current || loading) return;
    const params = new URLSearchParams(window.location.search);
    const trackId = params.get('track');
    deepLinkHandled.current = true;
    if (!trackId) return;
    const track = [...state.tracks, ...demos].find(
      (t: Track) => t.id === trackId,
    );
    if (track) {
      if (params.get('view') === 'Studio') useTrack(track);
      else setDetail(track);
      window.history.replaceState(null, '', '/');
    }
  }, [loading, state.tracks]);
  useEffect(() => {
    if (
      state.unreadNotifications > lastUnread.current &&
      lastUnread.current > 0
    )
      notify('New activity — check your alerts.');
    lastUnread.current = state.unreadNotifications;
  }, [state.unreadNotifications]);
  useEffect(() => {
    const timer = setInterval(async () => {
      if (
        document.visibilityState !== 'visible' ||
        ['Studio', 'Room'].includes(view) ||
        !user
      )
        return;
      try {
        const r = await fetch('/api/state');
        if (!r.ok) return;
        setState(await r.json());
      } catch {}
    }, 90000);
    return () => clearInterval(timer);
  }, [view, user]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch('/api/search?q=' + encodeURIComponent(q));
        const j = (await r.json()) as any;
        if (r.ok) setResults(j);
      } catch {
        setResults(null);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);
  function stopPreview() {
    previewSeq.current++;
    previewAbort.current?.abort();
    playback.current?.stop();
    playback.current = null;
    setIsPlaying(false);
    setPreviewBusy(false);
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
      previewSeq.current++;
      previewAbort.current?.abort();
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
    if (!t.demo && !playsCounted.current.has(t.id)) {
      playsCounted.current.add(t.id);
      void action({ action: 'play', id: t.id }).catch(() => {});
    }
    if (t.id === playing?.id && isPlaying && seek === 0) {
      stopPreview();
      return;
    }
    stopPreview();
    const seq = previewSeq.current;
    const controller = new AbortController();
    previewAbort.current = controller;
    setPlaying(t);
    setPreviewBusy(true);
    try {
      await context().resume();
      const score = originalArrangement(t.id, { preview: true });
      const mt = score ? null : trackFrom(t);
      if (mt) await bufferFor(mt, t.bpm, { signal: controller.signal });
      if (seq !== previewSeq.current) return;
      const p = await playMix(
        score || { bpm: t.bpm, tracks: [mt!] },
        () => {
          setIsPlaying(false);
          setElapsed(0);
        },
        { from: seek, signal: controller.signal },
      );
      if (seq !== previewSeq.current) {
        p.stop();
        return;
      }
      setDuration(p.duration);
      playback.current = { ...p, seek: Math.min(seek, p.duration - 0.01) };
      setIsPlaying(true);
    } catch (e: any) {
      if (seq === previewSeq.current && e.name !== 'AbortError')
        notify(e.message);
    } finally {
      if (seq === previewSeq.current) setPreviewBusy(false);
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
    const score = originalArrangement(t.id, {
      bpm: appendMode.current ? draft.current.data.bpm : t.bpm,
    });
    const added = score?.tracks || [trackFrom(t)];
    if (appendMode.current) {
      if (draft.current.data.tracks.length + added.length > 48)
        return notify('This session has reached the track limit.');
      try {
        validateArrangement(
          {
            ...draft.current.data,
            tracks: [...draft.current.data.tracks, ...added],
          },
          true,
        );
        if (added.some((t) => playlistTrackEnd(t) > 300))
          throw new Error(
            'This arrangement exceeds the five-minute limit at this tempo.',
          );
      } catch (e: any) {
        return notify(e.message);
      }
      draft.current = {
        ...draft.current,
        dirty: true,
        data: {
          ...draft.current.data,
          tracks: [...draft.current.data.tracks, ...added],
        },
      };
      appendMode.current = false;
    } else
      draft.current = {
        title: t.title + ' — working session',
        dirty: true,
        data: score || { bpm: t.bpm, tracks: added },
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
  function fmtNum(n?: number) {
    return n
      ? n >= 1000
        ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
        : String(n)
      : '0';
  }
  function formatCount(n?: number) {
    if (!n) return 'Like';
    return n >= 1000
      ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
      : String(n);
  }
  const [payBusy, setPayBusy] = useState(false);
  async function payForService(profile: any, serviceIndex: number) {
    setPayBusy(true);
    try {
      const { url } = await stripeAction({
        action: 'checkout',
        kind: 'service',
        seller: profile.id,
        serviceIndex,
      });
      window.location.href = url;
    } catch (e: any) {
      notify(e.message);
      setPayBusy(false);
    }
  }
  async function payForTrack(track: Track) {
    setPayBusy(true);
    try {
      const { url } = await stripeAction({
        action: 'checkout',
        kind: 'track',
        track: track.id,
      });
      window.location.href = url;
    } catch (e: any) {
      notify(e.message);
      setPayBusy(false);
    }
  }
  async function enterPublicRoom(id: string) {
    try {
      await action({ action: 'joinPublicRoom', id });
      await refresh();
      enterRoom(id);
    } catch (e: any) {
      notify(e.message);
    }
  }
  async function shareTrack(t: Track) {
    try {
      await navigator.clipboard.writeText(
        window.location.origin + '/t/' + t.id,
      );
      notify('Link to ' + t.title + ' copied.');
    } catch {
      notify('Could not copy the link on this browser.');
    }
  }
  function ordersBy(orders: any[], side: 'seller' | 'buyer') {
    return orders.filter((o) => o[side] === user?.id);
  }
  function renderOrder(o: any) {
    let name = 'Order';
    try {
      name = JSON.parse(o.serviceSnapshot)?.name || 'Order';
    } catch {}
    return (
      <div className={'order-row ' + o.status} key={o.id}>
        <span>
          <strong>{name}</strong>
          <small>
            {o.status === 'paid' ? 'Paid' : o.status}
            {' · '}
            {o.kind === 'service' ? 'service' : 'track'}
          </small>
        </span>
        <span className="order-amount">{formatPrice(o.amountCents)}</span>
      </div>
    );
  }
  function mediaPost(p: any) {
    const ownerProfile = state.profiles.find((x: any) => x.id === p.owner),
      liked = !!p.likedByMe,
      own = p.owner === user?.id,
      attached = p.trackTitle
        ? state.tracks.find((t: Track) => t.id === p.track)
        : null;
    return (
      <article className="feed-post media-post" key={p.id}>
        <header className="post-head">
          <button
            className="post-creator"
            onClick={() =>
              ownerProfile ? setSelectedProfile(ownerProfile) : undefined
            }
          >
            <Avatar profile={ownerProfile || { name: p.creator }} size={40} />
            <span>
              <strong>{p.creator}</strong>
              <small>
                {ownerProfile ? '@' + ownerProfile.username : 'creator'} ·{' '}
                {p.kind === 'video' ? 'video' : 'photo'}
              </small>
            </span>
          </button>
          <div className="post-head-actions">
            {p.owner !== user?.id && ownerProfile && (
              <button
                className="button secondary small"
                onClick={() => follow(ownerProfile)}
              >
                Follow
              </button>
            )}
            {own && (
              <button
                className={
                  'button small ' +
                  (armedDelete.current === p.id ? 'danger' : 'secondary')
                }
                onClick={async () => {
                  if (armedDelete.current !== p.id) {
                    armedDelete.current = p.id;
                    notify('Tap delete again to remove this post.');
                    return;
                  }
                  armedDelete.current = '';
                  try {
                    await action({ action: 'deletePost', id: p.id });
                    await refresh();
                    notify('Post removed.');
                  } catch (e: any) {
                    notify(e.message);
                  }
                }}
              >
                {armedDelete.current === p.id ? 'Confirm' : 'Delete'}
              </button>
            )}
          </div>
        </header>
        <div className="post-media">
          {p.kind === 'video' ? (
            <video
              className="post-video"
              controls
              playsInline
              preload="metadata"
              src={'/api/file/' + p.fileId}
              onPlay={() => {
                if (watchedPosts.current.has(p.id)) return;
                watchedPosts.current.add(p.id);
                void action({ action: 'watch', id: p.id }).catch(() => {});
              }}
            />
          ) : (
            <img
              className="post-photo"
              src={'/api/file/' + p.fileId}
              alt={p.caption || 'Shared photo'}
            />
          )}
        </div>
        {p.caption && <p className="media-caption">{p.caption}</p>}
        <div className="post-info">
          <div className="post-chips">
            {p.trackTitle && (
              <button
                className="chip track-chip"
                onClick={() => attached && setDetail(attached)}
              >
                ♪ {p.trackTitle}
              </button>
            )}
            {p.kind === 'video' && (
              <span className="chip plays-chip">
                ▶ {p.plays ? fmtNum(p.plays) : 'New'}
              </span>
            )}
          </div>
        </div>
        <footer className="post-actions">
          <button
            className={'post-act' + (liked ? ' liked' : '')}
            onClick={async () => {
              if (!signIn()) return;
              try {
                const r = await action({ action: 'postLike', id: p.id });
                setState((st: any) => ({
                  ...st,
                  posts: st.posts.map((x: any) =>
                    x.id === p.id
                      ? { ...x, likedByMe: r.liked, likes: r.likes }
                      : x,
                  ),
                }));
              } catch (e: any) {
                notify(e.message);
              }
            }}
            aria-label={liked ? 'Unlike' : 'Like'}
          >
            <Heart size={17} /> {fmtNum(p.likes)}
          </button>
          <button
            className="post-act"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  window.location.origin + '/p/' + p.id,
                );
                notify('Link copied.');
              } catch {
                notify('Could not copy the link on this browser.');
              }
            }}
          >
            <Share2 size={16} /> Share
          </button>
          {attached && (
            <button
              className="post-act"
              disabled={
                attached.permission !== 'collaborate' &&
                attached.owner !== user?.id
              }
              onClick={() => useTrack(attached)}
            >
              <SlidersHorizontal size={16} /> Studio
            </button>
          )}
        </footer>
      </article>
    );
  }
  function feedCreators(): any[] {
    return state.profiles
      .filter(
        (p: any) =>
          p.visibility === 'public' &&
          p.id !== user?.id &&
          !state.follows.includes(p.id),
      )
      .sort((a: any, b: any) => (b.followers || 0) - (a.followers || 0))
      .slice(0, 3);
  }
  function creatorCard(p: any) {
    const roles = (() => {
      try {
        return JSON.parse(p.roles || '[]') as string[];
      } catch {
        return [];
      }
    })();
    return (
      <article className="feed-post creator-post" key={'creator-' + p.id}>
        <header className="post-head">
          <span className="post-creator">
            <Avatar profile={p} size={40} />
            <span>
              <strong>{p.name}</strong>
              <small>@{p.username} · joined the community</small>
            </span>
          </span>
          <button className="button secondary small" onClick={() => follow(p)}>
            {state.follows.includes(p.id) ? 'Following' : 'Follow'}
          </button>
        </header>
        <button
          className="creator-body"
          onClick={() => setSelectedProfile(p)}
          aria-label={'View ' + p.name + '’s profile'}
        >
          <div className="creator-roles">
            {roles.map((role) => (
              <span className="chip" key={role}>
                {role}
              </span>
            ))}
          </div>
          <p className="creator-bio">
            {p.bio || 'Here to make something great.'}
          </p>
          <span className="creator-meta">
            {p.location || 'Creating everywhere'} · {fmtNum(p.followers)}{' '}
            followers
          </span>
        </button>
        <footer className="post-actions">
          <button className="post-act" onClick={() => setSelectedProfile(p)}>
            View profile & music
          </button>
        </footer>
      </article>
    );
  }
  function feedPost(t: Track) {
    const isSaved = state.saved.includes(t.id),
      active = playing?.id === t.id,
      isPlayingTrack = active && isPlaying,
      creatorProfile = state.profiles.find((item: any) => item.id === t.owner),
      wave = coverWaveform(t.id + t.title, 40),
      progress = active && duration ? Math.min(1, elapsed / duration) : 0,
      reason = recommendationReason(t),
      studioAllowed = t.permission === 'collaborate' || t.owner === user?.id,
      sellerChargeable =
        !!t.price &&
        state.payments.configured &&
        !!creatorProfile?.chargesEnabled,
      canBuy = !!t.price && t.owner !== user?.id && state.payments.configured;
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
              variant="sleeve"
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
            {t.price ? (
              <span className="chip price-chip">{formatPrice(t.price)}</span>
            ) : null}
            <span className="chip plays-chip">
              ▶ {t.plays ? fmtNum(t.plays) : 'New'}
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
            <MessageCircle size={17} />{' '}
            {t.comments ? fmtNum(t.comments) : 'Comments'}
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
          {canBuy && (
            <button
              className={'post-act buy' + (sellerChargeable ? ' ready' : '')}
              disabled={payBusy || !sellerChargeable}
              title={
                sellerChargeable
                  ? 'Buy a license — card payment via Stripe'
                  : 'Card payments pending on this creator'
              }
              onClick={() => payForTrack(t)}
            >
              <CircleDollarSign size={16} />
              {sellerChargeable ? 'Buy' : 'Priced'}
            </button>
          )}
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
        {process.env.NEXT_PUBLIC_DEPLOYMENT_TARGET === 'vercel'
          ? 'Sign in to SESSION'
          : 'Sign in with ChatGPT'}{' '}
        <ArrowUpRight size={16} />
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
              <div className="pulse-strip" role="status">
                <span className="status-dot" />
                <b>{fmtNum(state.pulse.tracks)}</b> tracks ·{' '}
                <b>{fmtNum(state.pulse.creators)}</b> creators
                {state.pulse.tracksToday
                  ? ` · ${fmtNum(state.pulse.tracksToday)} shared today`
                  : ''}
                {state.liveRooms.length
                  ? ` · ${state.liveRooms.length} public room${
                      state.liveRooms.length === 1 ? '' : 's'
                    }`
                  : ''}
              </div>
              {state.trending.length > 0 && (
                <div className="trending-rail" aria-label="Trending worldwide">
                  <div className="trend-head">
                    <Flame size={15} /> Trending worldwide
                  </div>
                  <div className="trend-scroll">
                    {state.trending.map((tr: any) => (
                      <button
                        className="trend-tile"
                        key={tr.id}
                        onClick={() => {
                          const full = state.tracks.find(
                            (x: Track) => x.id === tr.id,
                          );
                          if (full) setDetail(full);
                        }}
                      >
                        <CoverArt
                          seed={tr.id + tr.title}
                          label={tr.title}
                          size={62}
                          spinning={playing?.id === tr.id && isPlaying}
                        />
                        <span>
                          <strong>{tr.title}</strong>
                          <small>
                            {tr.creator} · ▶ {fmtNum(tr.plays)}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {state.liveRooms.length > 0 && (
                <section className="live-rooms">
                  <div className="section-title">
                    <h2>
                      <Radio size={16} /> Live now
                    </h2>
                    <span className="tiny-label">PUBLIC ROOMS</span>
                  </div>
                  <div className="live-grid">
                    {state.liveRooms.map((r: any) => (
                      <div className="live-room" key={r.id}>
                        <span
                          className={'live-dot' + (r.active > 0 ? ' on' : '')}
                        />
                        <div>
                          <strong>{r.title}</strong>
                          <small>
                            {r.active > 0
                              ? `${r.active} in the room now`
                              : `${r.members} member${
                                  r.members === 1 ? '' : 's'
                                }`}
                          </small>
                        </div>
                        <button
                          className="button secondary small"
                          onClick={() => void enterPublicRoom(r.id)}
                        >
                          Join
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {discoveryTabs()}
              {genreTabs()}
              {results && query.trim().length >= 2 ? (
                <div className="search-results">
                  <div className="section-title">
                    <h2>
                      Results for “{query.trim()}”
                      <span className="tiny-label">
                        {searching ? 'SEARCHING…' : 'SERVER-SIDE'}
                      </span>
                    </h2>
                  </div>
                  {results.tracks?.length ? (
                    results.tracks.map((tr: any) => {
                      const full = state.tracks.find(
                        (x: Track) => x.id === tr.id,
                      );
                      return (
                        <button
                          className="search-row"
                          key={tr.id}
                          onClick={() =>
                            full
                              ? setDetail(full)
                              : notify('Open the app to hear this one.')
                          }
                        >
                          <CoverArt
                            seed={tr.id + tr.title}
                            label={tr.title}
                            size={44}
                          />
                          <span>
                            <strong>{tr.title}</strong>
                            <small>
                              {tr.creator} · {tr.genre}
                              {tr.plays ? ` · ▶ ${fmtNum(tr.plays)}` : ''}
                            </small>
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <p className="small-note">
                      No tracks matched. Try a genre, title, or creator name.
                    </p>
                  )}
                  {results.profiles?.length > 0 && (
                    <>
                      <h3 className="payments-sub">Creators</h3>
                      {results.profiles.map((pr: any) => (
                        <button
                          className="search-row"
                          key={pr.id}
                          onClick={() => setSelectedProfile(pr)}
                        >
                          <Avatar profile={pr} size={44} />
                          <span>
                            <strong>{pr.name}</strong>
                            <small>
                              @{pr.username} · {fmtNum(pr.followers)} followers
                            </small>
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              ) : null}
              {!results || query.trim().length < 2 ? (
                <div className="feed-posts">
                  {filtered.length || state.posts.length ? (
                    (() => {
                      const creators = feedCreators();
                      const posts = (state.posts || []).filter(
                        (p: any) =>
                          feedMode !== 'Following' ||
                          state.follows.includes(p.owner),
                      );
                      const merged = [
                        ...filtered.slice(0, 12).map((t: Track) => ({
                          created: t.created || 0,
                          render: () => feedPost(t),
                        })),
                        ...posts.map((p: any) => ({
                          created: p.created || 0,
                          render: () => mediaPost(p),
                        })),
                      ]
                        .sort((a, b) => b.created - a.created)
                        .slice(0, 14);
                      return merged.flatMap((item, index) => {
                        const card =
                          (index === 1 || index === 6) && creators.length
                            ? [creatorCard(creators.shift()!)]
                            : [];
                        return [item.render(), ...card];
                      });
                    })()
                  ) : (
                    <Empty
                      title="Nothing on this frequency yet."
                      text="Try another genre or clear your search."
                    />
                  )}
                </div>
              ) : null}
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
                    [
                      Video,
                      'For videographers',
                      'Give it a face.',
                      'Music videos, session films, and cover art that moves.',
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
                              : label === 'For videographers'
                                ? 'Find collaborators'
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
                        ? 'Find artists, producers, engineers, and videographers you want to hear from.'
                        : 'No matching uploads yet. Try another filter or upload the first track.'
                  }
                  actionLabel="Explore beats"
                  action={() => go('Beat library')}
                />
              )}
              <p className="small-note">
                48 new SESSION Originals across 24 genres: hear a preview, then
                open the full arrangement as editable Studio layers. The ten
                starter loops are still here. Community uploads follow their
                creator’s permissions.
              </p>
            </>
          ) : view === 'Activity' ? (
            user ? (
              <ActivityView
                onUnreadChange={updateUnreadNotifications}
                onOpen={(item) => {
                  if (item.resourceType === 'collaboration')
                    go('Collaborations');
                  else if (item.resourceType === 'room') {
                    setRoomId(item.resourceId);
                    go('Room');
                    window.history.replaceState(
                      null,
                      '',
                      '?room=' + encodeURIComponent(item.resourceId),
                    );
                    void refresh();
                  } else if (item.resourceType === 'track') {
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
                tracks={state.tracks.filter(
                  (t: Track) =>
                    t.owner === user?.id && t.visibility === 'public',
                )}
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
              <div className="profile-columns">
                <ProfileForm
                  key={state.profile?.id || 'new'}
                  profile={state.profile}
                  user={user}
                  notify={notify}
                  payments={state.payments}
                  onDone={refresh}
                />
                <aside className="payments-panel">
                  {(() => {
                    const steps = [
                      ['Add a profile photo', !!state.profile?.avatar],
                      ['Say something about yourself', !!state.profile?.bio],
                      [
                        'Share your first track',
                        state.tracks.some((t: Track) => t.owner === user?.id),
                      ],
                      ['Follow creators you like', state.follows.length > 0],
                      ['Start or join a room', state.rooms.length > 0],
                      ['Turn on payouts', state.payments.chargesEnabled],
                    ];
                    const done = steps.filter(([, ok]) => ok).length,
                      next = steps.find(([, ok]) => !ok);
                    return (
                      <div className="checklist">
                        <h3 className="payments-sub">
                          Your SESSION checklist · {done}/{steps.length}
                        </h3>
                        <div className="checklist-bar">
                          <i
                            style={{ width: (done / steps.length) * 100 + '%' }}
                          />
                        </div>
                        <ul>
                          {steps.map(([label, ok]) => (
                            <li
                              key={label as string}
                              className={ok ? 'ok' : ''}
                            >
                              {ok ? '✓' : '○'} {label as string}
                            </li>
                          ))}
                        </ul>
                        {next && (
                          <p className="small-note">
                            Next: {next[0] as string}
                          </p>
                        )}
                        <button
                          className="button secondary small checklist-tour"
                          onClick={() => {
                            tourDone();
                            setTourOpen(true);
                          }}
                        >
                          Take the tour again
                        </button>
                      </div>
                    );
                  })()}
                  <div className="section-title">
                    <h2>
                      <CircleDollarSign size={17} /> Payments
                    </h2>
                    {state.payments.chargesEnabled && (
                      <span className="pay-chip ok">
                        <Check size={12} /> Ready to sell
                      </span>
                    )}
                  </div>
                  <div className="payouts-status">
                    {state.payments.chargesEnabled ? (
                      <p>
                        Your Stripe account is connected. Card payments for your
                        services and tracks go straight to you.
                      </p>
                    ) : state.payments.configured ? (
                      <>
                        <p>
                          Connect a Stripe account to accept card payments for
                          your services and tracks.
                        </p>
                        <button
                          className="button primary"
                          disabled={payBusy}
                          onClick={async () => {
                            setPayBusy(true);
                            try {
                              const { url } = await stripeAction({
                                action: 'onboard',
                              });
                              window.location.href = url;
                            } catch (e: any) {
                              notify(e.message);
                              setPayBusy(false);
                            }
                          }}
                        >
                          {payBusy ? 'Connecting…' : 'Connect payouts'}
                        </button>
                      </>
                    ) : (
                      <p>
                        Card payments are coming soon to SESSION. Your prices
                        are listed, and collaborators can request bookings
                        today.
                      </p>
                    )}
                  </div>
                  <h3 className="payments-sub">Sales</h3>
                  {ordersBy(state.orders, 'seller').length ? (
                    ordersBy(state.orders, 'seller').map(renderOrder)
                  ) : (
                    <p className="small-note">No sales yet.</p>
                  )}
                  <h3 className="payments-sub">Purchases</h3>
                  {ordersBy(state.orders, 'buyer').length ? (
                    ordersBy(state.orders, 'buyer').map(renderOrder)
                  ) : (
                    <p className="small-note">No purchases yet.</p>
                  )}
                </aside>
              </div>
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
                  {[
                    'Everyone',
                    'Artist',
                    'Producer',
                    'Engineer',
                    'Videographer',
                  ].map((r) => (
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
                  text="Make your profile public to appear here. Artists, producers, engineers, and videographers with public profiles will join this community."
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
        onBuy={payForTrack}
        sellerChargeable={
          state.payments.configured &&
          !!state.profiles.find((p: any) => p.id === detail?.owner)
            ?.chargesEnabled
        }
        payments={state.payments}
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
      <Onboarding
        open={tourOpen}
        signedIn={!!user}
        onGo={go}
        onFinish={() => setTourOpen(false)}
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
                  visibility: roomDiscoverable,
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
            <Pick
              label="Who can find this room"
              value={roomDiscoverable}
              onChange={setRoomDiscoverable}
              options={[
                {
                  value: 'invite',
                  label: 'Invite only — just your circle',
                },
                {
                  value: 'public',
                  label: 'Discoverable — anyone can join while there is space',
                },
              ]}
            />
            <p className="small-note">
              Room members can listen to the attached project and its private
              audio. The owner can allow room members to edit and save changes.
            </p>
            <button className="button primary wide" disabled={roomBusy}>
              {roomBusy
                ? 'Creating your room…'
                : roomDiscoverable === 'public'
                  ? 'Create discoverable room'
                  : 'Create private room'}
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
              {(() => {
                const rates = (() => {
                  try {
                    return JSON.parse(selectedProfile.rates || '[]');
                  } catch {
                    return [];
                  }
                })();
                if (!rates.length) return null;
                const chargeable =
                  state.payments.configured && selectedProfile.chargesEnabled;
                return (
                  <div className="dialog-services">
                    <h3>Services</h3>
                    {rates.map((rate: any, index: number) => (
                      <div className="dialog-service" key={index}>
                        <span>
                          <strong>{rate.service}</strong>
                          <small>
                            {rate.role}
                            {rate.note ? ' · ' + rate.note : ''}
                          </small>
                        </span>
                        <span className="service-price-tag">
                          {formatPrice(rate.amountCents)}
                        </span>
                        {selectedProfile.id !== user?.id && (
                          <button
                            className={
                              'button ' +
                              (chargeable ? 'primary small' : 'secondary small')
                            }
                            disabled={payBusy}
                            title={
                              chargeable
                                ? 'Pay by card through Stripe'
                                : 'Send a booking request — card payments pending on this creator'
                            }
                            onClick={() =>
                              chargeable
                                ? payForService(selectedProfile, index)
                                : requestCollaboration(selectedProfile)
                            }
                          >
                            {chargeable ? 'Book & pay' : 'Request booking'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
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
