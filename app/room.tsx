'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Copy,
  RefreshCw,
  Send,
  Headphones,
  LockKeyhole,
  Users,
  Music2,
  UserMinus,
  Activity,
  Settings2,
  UserPlus,
} from 'lucide-react';
import { action, Avatar, Confirm, Pick } from './helpers';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { PeerLink } from '@/lib/peer';
import Diagnostics from './diagnostics';
import RoomStudio from './room-studio';
import RoomInvitations from './room-invitations';
import Studio from './studio';
import { StudioBroadcast, RoomMicrophones } from '@/lib/room-audio';
import { RoomMediaControls } from '@/lib/room-media-controls';
import type { Track } from '@/lib/catalog';
function MediaTile({
  stream,
  muted,
  label,
}: {
  stream: MediaStream;
  muted?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => setBlocked(true));
    }
    const element = ref.current;
    return () => {
      if (element) {
        element.pause();
        element.srcObject = null;
      }
    };
  }, [stream]);
  return (
    <div
      className={
        'video-tile' + (!stream.getVideoTracks().length ? ' audio-tile' : '')
      }
    >
      <video ref={ref} autoPlay playsInline muted={muted} controls={!muted} />
      {!stream.getVideoTracks().length && (
        <Headphones className="audio-tile-icon" size={30} />
      )}
      <span>{label}</span>
      {blocked && !muted && (
        <button
          className="button secondary media-play"
          onClick={() =>
            ref.current
              ?.play()
              .then(() => setBlocked(false))
              .catch(() => setBlocked(true))
          }
        >
          Play collaborator audio
        </button>
      )}
    </div>
  );
}
export default function Room({
  id,
  user,
  onExit,
  projects,
  onProjectsChanged,
  notify,
  drafts,
  onDraft,
  onWorkspaceBusy,
  catalog,
}: {
  id: string;
  user: any;
  onExit: () => void;
  projects: { id: string; title: string }[];
  onProjectsChanged: () => unknown;
  notify: (m: string) => void;
  drafts: Map<string, any>;
  onDraft: (draft: any) => void;
  onWorkspaceBusy: (busy: boolean) => void;
  catalog: Track[];
}) {
  const [opened, setOpened] = useState<any>(null);
  const [opening, setOpening] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [invitePeople, setInvitePeople] = useState(false);
  const [available, setAvailable] = useState(true);
  const [music, setMusic] = useState<MediaStream | null>(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const studioBusy = useRef(false);
  const openingRef = useRef(false);
  const studioElement = useRef<HTMLElement | null>(null);
  const musicRef = useRef<MediaStream | null>(null);
  const musicRequest = useRef(0);
  const [broadcast] = useState(
    () =>
      new StudioBroadcast(undefined, () => {
        stopMusic();
        notify(
          'Studio audio sharing was interrupted. Press Share studio audio to resume it. Your call controls are unchanged.',
        );
      }),
  );
  const [microphones] = useState(() => new RoomMicrophones());
  const mediaControls = useRef(new RoomMediaControls());
  const [roomAudio] = useState(() => ({
    output: broadcast.output,
    acquire: microphones.acquire,
    acquireStudio: microphones.acquireStudio,
  }));

  const [state, setState] = useState<any>(null),
    [error, setError] = useState(''),
    [callNotice, setCallNotice] = useState(''),
    [chat, setChat] = useState<any[]>([]),
    [message, setMessage] = useState(''),
    [local, setLocal] = useState<MediaStream | null>(null),
    [mediaSettings, setMediaSettings] = useState(false),
    [mics, setMics] = useState<MediaDeviceInfo[]>([]),
    [cams, setCams] = useState<MediaDeviceInfo[]>([]),
    [chosenMic, setChosenMic] = useState(''),
    [chosenCam, setChosenCam] = useState(''),
    [camQuality, setCamQuality] = useState('360'),
    [remote, setRemote] = useState<
      Record<string, { stream: MediaStream; peer: string; role?: string }>
    >({}),
    [mic, setMic] = useState(true),
    [cam, setCam] = useState(true),
    [sharing, setSharing] = useState<MediaStream | null>(null),
    [joining, setJoining] = useState(false),
    [checking, setChecking] = useState(false),
    [close, setClose] = useState(false),
    [connected, setConnected] = useState(false),
    [relay, setRelay] = useState<boolean | null>(null),
    [stats, setStats] = useState<Record<string, any>>({});
  const peers = useRef(new Map<string, PeerLink>()),
    localRef = useRef<MediaStream | null>(null),
    shareRef = useRef<MediaStream | null>(null),
    stateRef = useRef<any>(null),
    cursor = useRef(0),
    session = useRef(''),
    generation = useRef(0),
    rtcConfig = useRef<RTCConfiguration>({ iceServers: [] }),
    configExpiry = useRef(0),
    controller = useRef(new AbortController()),
    alive = useRef(true);
  async function post(body: any) {
    const r = await fetch('/api/room/' + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.current.signal,
    });
    const j = (await r.json()) as any;
    if (!r.ok) throw new Error(j.error || 'Connection interrupted.');
    return j;
  }
  useEffect(() => {
    if (!mediaSettings) return;
    let active = true;
    const enumerate = () =>
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => {
          if (!active) return;
          setMics(list.filter((d) => d.kind === 'audioinput' && d.deviceId));
          setCams(list.filter((d) => d.kind === 'videoinput' && d.deviceId));
        })
        .catch(() => {});
    void enumerate();
    navigator.mediaDevices?.addEventListener('devicechange', enumerate);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener('devicechange', enumerate);
    };
  }, [mediaSettings]);
  async function switchMic(deviceId: string) {
    setChosenMic(deviceId);
    const epoch = generation.current;
    const active = session.current;
    const current = () =>
      alive.current &&
      !!active &&
      session.current === active &&
      generation.current === epoch;
    try {
      const switched = await mediaControls.current.switchTrack(
        'audio',
        () =>
          navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: deviceId ? { exact: deviceId } : undefined,
              echoCancellation: true,
              noiseSuppression: true,
            },
            video: false,
          }),
        {
          isCurrent: current,
          local: () => localRef.current,
          senders: () => links().flatMap((link) => link.pc.getSenders()),
          publish: (merged) => {
            localRef.current = merged;
            microphones.set(merged);
            setLocal(merged);
          },
        },
      );
      if (!switched || !current()) return;
      updateStreams();
      syncPeers(stateRef.current || { sessions: [] });
      setCallNotice('Microphone switched.');
    } catch (e: any) {
      if (current()) setCallNotice(e.message || 'Could not switch microphone.');
    }
  }
  async function switchCam(deviceId: string, quality = camQuality) {
    setChosenCam(deviceId);
    const epoch = generation.current;
    const active = session.current;
    const current = () =>
      alive.current &&
      !!active &&
      session.current === active &&
      generation.current === epoch;
    try {
      const hd = quality === '720';
      const switched = await mediaControls.current.switchTrack(
        'video',
        () =>
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: deviceId ? { exact: deviceId } : undefined,
              width: { ideal: hd ? 1280 : 640 },
              height: { ideal: hd ? 720 : 360 },
              frameRate: { ideal: hd ? 30 : 24, max: 30 },
            },
          }),
        {
          isCurrent: current,
          local: () => localRef.current,
          senders: () => links().flatMap((link) => link.pc.getSenders()),
          publish: (merged) => {
            localRef.current = merged;
            setLocal(merged);
          },
        },
      );
      if (!switched || !current()) return;
      updateStreams();
      syncPeers(stateRef.current || { sessions: [] });
      setCallNotice('Camera set to ' + (hd ? '720p' : '360p') + '.');
    } catch (e: any) {
      if (current()) setCallNotice(e.message || 'Could not switch camera.');
    }
  }
  function links() {
    return [...peers.current.values()];
  }

  function outgoingStreams() {
    return [localRef.current, shareRef.current, musicRef.current].filter(
      Boolean,
    ) as MediaStream[];
  }
  function updateStreams() {
    for (const peer of peers.current.values())
      peer.setStreams(outgoingStreams(), outgoingRoles());
  }
  function outgoingRoles() {
    return Object.fromEntries([
      ...(shareRef.current ? [[shareRef.current.id, 'screen']] : []),
      ...(musicRef.current ? [[musicRef.current.id, 'music']] : []),
    ]);
  }
  function stopMusic() {
    musicRequest.current++;
    musicRef.current = null;
    broadcast.disable();
    setMusic(null);
    setMusicBusy(false);
    updateStreams();
  }
  async function shareMusic() {
    if (musicRef.current) {
      stopMusic();
      return;
    }
    if (
      !session.current ||
      !available ||
      !opened ||
      opened.id !== stateRef.current?.room.project
    )
      return notify('Join the call and open its current studio project first.');
    const token = ++musicRequest.current;
    setMusicBusy(true);
    try {
      const stream = await broadcast.enable();
      if (token !== musicRequest.current) return;
      if (!session.current || !alive.current) {
        broadcast.disable();
        return;
      }
      musicRef.current = stream;
      setMusic(stream);
      updateStreams();
    } catch (e: any) {
      if (token === musicRequest.current && e.name !== 'AbortError')
        notify(e.message || 'Studio audio could not be shared.');
    } finally {
      if (token === musicRequest.current) setMusicBusy(false);
    }
  }
  async function openStudio() {
    const project = stateRef.current?.room.project;
    if (!available || !project || openingRef.current) return;
    if (studioBusy.current)
      return notify(
        'Finish or close the current studio dialog before switching projects.',
      );
    if (opened?.id === project) {
      studioElement.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      return;
    }
    openingRef.current = true;
    setOpening(true);
    try {
      const fresh = await action({ action: 'projectRead', id: project });
      if (!alive.current || stateRef.current?.room.project !== project) return;
      const draft = drafts.get(project);
      setOpened(
        draft
          ? {
              ...draft,
              canEdit: fresh.canEdit,
              canManage: fresh.canManage,
              owner: fresh.owner,
            }
          : fresh,
      );
    } catch (e: any) {
      if (alive.current) notify(e.message);
    } finally {
      openingRef.current = false;
      if (alive.current) setOpening(false);
    }
  }
  useEffect(() => {
    stopMusic();
  }, [state?.room.project, available]);
  function closePeer(key: string) {
    const p = peers.current.get(key);
    p?.close();
    peers.current.delete(key);
    setRemote((r) =>
      Object.fromEntries(Object.entries(r).filter(([_, v]) => v.peer !== key)),
    );
    setStats((s) => {
      const n = { ...s };
      delete n[key];
      return n;
    });
  }
  function disconnect(announce = true) {
    generation.current++;
    mediaControls.current.cancelPending();
    microphones.end();
    stopMusic();
    const previous = session.current;
    session.current = '';
    if (announce && previous)
      post({ kind: 'stopMedia', session: previous }).catch(() => {});
    for (const key of peers.current.keys()) closePeer(key);
    localRef.current?.getTracks().forEach((t) => t.stop());
    shareRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => {
        setMics(list.filter((d) => d.kind === 'audioinput' && d.deviceId));
        setCams(list.filter((d) => d.kind === 'videoinput' && d.deviceId));
      })
      .catch(() => {});
    shareRef.current = null;
    setLocal(null);
    setSharing(null);
    setRemote({});
    setConnected(false);
  }
  async function configuration() {
    const r = await fetch('/api/rtc?room=' + id, {
      signal: controller.current.signal,
    });
    const j = (await r.json()) as any;
    if (!r.ok) throw new Error(j.error);
    rtcConfig.current = { iceServers: j.iceServers };
    configExpiry.current = j.expires;
    setRelay(j.relay);
    return rtcConfig.current;
  }
  function syncPeers(s: any) {
    if (!session.current) return;
    const wanted = s.sessions.filter((p: any) => p.user !== user.id);
    const keys = wanted.map((p: any) => p.user + ':' + p.session);
    for (const key of peers.current.keys())
      if (!keys.includes(key)) closePeer(key);
    for (const target of wanted) {
      const key = target.user + ':' + target.session;
      if (!peers.current.has(key)) {
        const ownSession = session.current;
        const link = new PeerLink(
          user.id + ':' + ownSession,
          key,
          rtcConfig.current,
          {
            send: async (body) => {
              if (session.current !== ownSession)
                throw new Error('Session ended');
              const clientId =
                body.messageId || (body.messageId = crypto.randomUUID());
              await post({
                kind: 'signal',
                recipient: target.user,
                clientId,
                body: {
                  ...body,
                  senderSession: ownSession,
                  recipientSession: target.session,
                },
              });
            },
            stream: (stream, remove, role) =>
              setRemote((r) => {
                const n = { ...r };
                if (remove) delete n[stream.id];
                else n[stream.id] = { stream, peer: key, role };
                return n;
              }),
            state: (v) =>
              setStats((x) => ({ ...x, [key]: { ...x[key], state: v } })),
          },
        );
        peers.current.set(key, link);
        link.setStreams(outgoingStreams(), outgoingRoles());
      }
    }
  }
  useEffect(() => {
    let ended = false;
    let timer: any;
    alive.current = true;
    controller.current = new AbortController();
    cursor.current = 0;
    setCallNotice('');
    setChat([]);
    setRemote({});
    async function poll() {
      try {
        const active = session.current;
        const r = await fetch(
            '/api/room/' +
              id +
              '?since=' +
              cursor.current +
              (active ? '&session=' + active : ''),
            { signal: controller.current.signal },
          ),
          j = (await r.json()) as any;
        if (!r.ok) {
          if (r.status === 401 || r.status === 403) {
            disconnect(false);
            setAvailable(false);
            throw new Error(
              'Room access ended. Your microphone, camera, and media connections are off.',
            );
          }
          throw new Error(j.error);
        }
        if (ended) return;
        if (active !== session.current) {
          timer = setTimeout(poll, 0);
          return;
        }
        stateRef.current = j;
        setAvailable(true);
        setState(j);
        setError('');
        if (
          active &&
          session.current === active &&
          (j.mediaReplaced || j.mediaMissing)
        ) {
          disconnect(false);
          setCallNotice(
            j.mediaReplaced
              ? 'This account joined the call in another tab or device. Each participant needs a different account. Join here to move this account’s call back.'
              : 'Your call session ended. Your camera and microphone are off. Join again to reconnect.',
          );
        }
        if (session.current) syncPeers(j);
        for (const e of j.events) {
          if (e.kind === 'chat')
            setChat((c) => [...c.filter((x) => x.id !== e.id), e].slice(-100));
          if (
            e.kind === 'signal' &&
            session.current &&
            e.body.recipientSession === session.current
          ) {
            const key = e.sender + ':' + e.body.senderSession;
            if (
              j.sessions.some(
                (p: any) =>
                  p.user === e.sender && p.session === e.body.senderSession,
              )
            ) {
              await peers.current.get(key)?.receive(e.body);
            }
          }
        }
        cursor.current = Math.max(cursor.current, j.cursor || 0);
        if (session.current && configExpiry.current < Date.now() + 120000) {
          await configuration();
          for (const p of peers.current.values()) {
            p.pc.setConfiguration(rtcConfig.current);
            p.restart();
          }
        }
        timer = setTimeout(poll, j.more ? 0 : 1200);
      } catch (e: any) {
        if (!ended) {
          setError(e.message || 'Signaling interrupted. Retrying…');
          timer = setTimeout(poll, 2200);
        }
      }
    }
    poll();
    const st = setInterval(async () => {
      for (const [key, p] of peers.current)
        try {
          const result = await p.stats();
          if (!ended) setStats((s) => ({ ...s, [key]: result }));
        } catch {}
    }, 3000);
    return () => {
      ended = true;
      alive.current = false;
      generation.current++;
      mediaControls.current.cancelPending();
      clearTimeout(timer);
      clearInterval(st);
      const previous = session.current;
      session.current = '';
      controller.current.abort();
      if (previous)
        fetch('/api/room/' + id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'stopMedia', session: previous }),
          keepalive: true,
        }).catch(() => {});
      for (const p of peers.current.values()) p.close();
      peers.current.clear();
      localRef.current?.getTracks().forEach((t) => t.stop());
      shareRef.current?.getTracks().forEach((t) => t.stop());
      microphones.end();
      broadcast.dispose();
      musicRequest.current++;
      onWorkspaceBusy(false);
    };
  }, [id]);
  async function connect(video = true) {
    if (joining || !available) return;
    if (studioBusy.current)
      return notify('Finish the studio dialog before joining the call.');
    setJoining(true);
    const epoch = ++generation.current;
    let stream: MediaStream | null = null;
    try {
      await configuration();
      if (epoch !== generation.current) return;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: video
          ? {
              width: { ideal: 640 },
              height: { ideal: 360 },
              frameRate: { ideal: 24, max: 30 },
            }
          : false,
      });
      if (epoch !== generation.current || !alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const token = crypto.randomUUID();
      const result = await post({ kind: 'startMedia', session: token });
      if (epoch !== generation.current || !alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        post({ kind: 'stopMedia', session: token }).catch(() => {});
        return;
      }
      session.current = token;
      cursor.current = result.cursor;
      mediaControls.current.setEnabled('audio', true, stream);
      mediaControls.current.setEnabled('video', video, stream);
      localRef.current = stream;
      microphones.set(stream);
      setLocal(stream);
      setConnected(true);
      setMic(true);
      setCam(video);
      setError('');
      setCallNotice('');
      syncPeers(stateRef.current || { sessions: [] });
    } catch (e: any) {
      stream?.getTracks().forEach((t) => t.stop());
      notify(
        e.name === 'NotAllowedError'
          ? 'Camera or microphone permission was denied. Allow access in your browser or use room chat.'
          : e.message || 'Media could not start. Try audio only.',
      );
    } finally {
      if (alive.current) setJoining(false);
    }
  }
  function stopShare() {
    const s = shareRef.current;
    if (!s) return;
    shareRef.current = null;
    s.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    setSharing(null);
    updateStreams();
    post({ kind: 'sharing', session: session.current, value: false }).catch(
      () => {},
    );
  }
  async function share() {
    if (sharing) {
      stopShare();
      return;
    }
    if (!session.current)
      return notify('Join the call before sharing your studio.');
    const epoch = generation.current;
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
      if (epoch !== generation.current || !session.current || !alive.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      shareRef.current = s;
      setSharing(s);
      s.getVideoTracks()[0].onended = stopShare;
      // Some browsers can still supply an audio track; never relay the room
      // tab's received voices back to its participants.
      for (const track of s.getAudioTracks()) {
        s.removeTrack(track);
        track.stop();
      }
      updateStreams();
      await post({ kind: 'sharing', session: session.current, value: true });
      notify('Your screen is shared. Use Share studio audio for the music.');
    } catch (e: any) {
      notify(
        e.name === 'NotAllowedError'
          ? 'Screen sharing was canceled.'
          : e.message || 'Screen sharing is unavailable.',
      );
    }
  }
  async function reconnect() {
    if (!session.current) {
      await connect();
      return;
    }
    const previous = session.current;
    try {
      if (
        [...peers.current.values()].some(
          (p) => p.pc.signalingState !== 'stable',
        )
      ) {
        const epoch = ++generation.current;
        session.current = '';
        for (const key of peers.current.keys()) closePeer(key);
        await configuration();
        if (epoch !== generation.current || !alive.current) return;
        const token = crypto.randomUUID();
        const result = await post({ kind: 'startMedia', session: token });
        if (epoch !== generation.current || !alive.current) {
          post({ kind: 'stopMedia', session: token }).catch(() => {});
          return;
        }
        session.current = token;
        cursor.current = result.cursor;
        if (shareRef.current)
          await post({ kind: 'sharing', session: token, value: true });
        syncPeers(stateRef.current || { sessions: [] });
        notify(
          'Call negotiation restarted. Your microphone, camera, and screen-share choices are preserved.',
        );
        return;
      }
      await configuration();
      for (const p of peers.current.values()) {
        p.pc.setConfiguration(rtcConfig.current);
        p.restart();
      }
      notify(
        'Refreshing the media connection. Your mute and camera settings are preserved.',
      );
    } catch (e: any) {
      if (!session.current) {
        session.current = previous;
        disconnect();
      }
      notify(e.message);
    }
  }
  async function copy() {
    try {
      const url = new URL(window.location.href);
      url.pathname = '/app';
      url.search = '?room=' + id;
      url.hash = 'invite=' + state.room.invite;
      await navigator.clipboard.writeText(url.href);
      notify('Invitation copied. It expires in 24 hours.');
    } catch {
      notify('Your browser blocked copying. Try from a full browser tab.');
    }
  }
  return (
    <div className={'room-page' + (opened ? ' studio-open' : '')}>
      <div className="studio-heading">
        <div>
          <span className="eyebrow">PRIVATE STUDIO ROOM</span>
          <h1>{state?.room?.title || 'Connecting to your room…'}</h1>
          <p className="subtle">
            <LockKeyhole size={14} /> Invite only · up to 4 collaborators
          </p>
        </div>
        <div className="actions">
          <button
            className="button secondary"
            onClick={() => {
              onExit();
            }}
          >
            Back to rooms
          </button>
          {available && state?.room.owner === user.id && (
            <>
              <button
                className="button primary"
                onClick={() => setInvitePeople(true)}
              >
                <UserPlus size={16} /> Invite people
              </button>
              <button className="button secondary" onClick={copy}>
                <Copy size={16} /> Copy invite
              </button>
            </>
          )}
        </div>
      </div>
      {invitePeople && available && state?.room.owner === user.id && (
        <RoomInvitations
          key={id}
          roomId={id}
          memberCount={state.members?.length || 1}
          onClose={() => setInvitePeople(false)}
          notify={notify}
        />
      )}
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {callNotice && (
        <div role="status" className="error-banner">
          {callNotice}
        </div>
      )}
      <div className="relay-status">
        <Activity size={16} />
        {relay === true
          ? 'Cloudflare relay available'
          : relay === false
            ? 'Direct connections only · Cloudflare TURN credentials pending'
            : 'Check your relay connection before joining'}
        <span>
          Your camera and microphone start only when you join. Each participant
          needs a different account. Joining elsewhere with the same account
          moves your call there.
        </span>
        <button
          className="button secondary"
          disabled={joining || connected}
          onClick={() => setChecking(!checking)}
        >
          {checking ? 'Close connection check' : 'Check relay connection'}
        </button>
      </div>
      {checking && (
        <section className="room-relay-check" aria-label="Room relay check">
          <Diagnostics key={id} roomId={id} onRelay={setRelay} />
        </section>
      )}
      {state && (
        <RoomStudio
          room={state.room}
          projectInfo={state.projectInfo}
          userId={user.id}
          projects={projects}
          members={state.members || []}
          editors={state.editors || []}
          onChanged={onProjectsChanged}
          notify={notify}
          onOpen={openStudio}
          opening={opening}
          opened={opened?.id === state.room.project}
          available={available}
        />
      )}
      <div
        className={'room-layout' + (opened && !showChat ? ' chat-hidden' : '')}
      >
        <div>
          <div className="video-grid">
            {local ? (
              <MediaTile stream={local} muted label="You" />
            ) : (
              <div className="video-tile empty-video">
                <Headphones size={42} />
                <h3>Take your seat.</h3>
                <p>Your camera and mic stay off until you join.</p>
                <div className="actions">
                  <button
                    className="button primary"
                    disabled={joining || checking || !available}
                    onClick={() => connect(true)}
                  >
                    <Video size={16} />
                    {joining ? 'Connecting…' : 'Join with camera & mic'}
                  </button>
                  <button
                    className="button secondary"
                    disabled={joining || checking || !available}
                    onClick={() => connect(false)}
                  >
                    Audio only
                  </button>
                </div>
              </div>
            )}
            {Object.values(remote).map(({ stream, peer, role }) => (
              <MediaTile
                key={stream.id}
                stream={stream}
                label={
                  (state?.members.find((m: any) =>
                    peer.startsWith(m.user + ':'),
                  )?.name || 'Collaborator') +
                  (role === 'music'
                    ? ' · studio audio'
                    : role === 'screen'
                      ? ' · screen'
                      : '')
                }
              />
            ))}
            {sharing && (
              <MediaTile stream={sharing} muted label="Your shared screen" />
            )}
            {!Object.keys(remote).length && (
              <div className="video-tile waiting">
                <Users size={35} />
                <h3>Room for your people.</h3>
                <p>
                  Invite your artist, producer, or engineer.
                  <br />
                  Their video appears when both of you join.
                </p>
              </div>
            )}
          </div>
          <div className="call-controls">
            {opened && (
              <button
                onClick={() => setShowChat(!showChat)}
                aria-expanded={showChat}
              >
                <Send size={16} /> {showChat ? 'Hide chat' : 'Show chat'}
              </button>
            )}
            {connected && (
              <button
                onClick={() => setMediaSettings(true)}
                aria-label="Video and audio settings"
                title="Camera, microphone, and quality"
              >
                <Settings2 size={16} /> Settings
              </button>
            )}
            <button
              className={!mic ? 'off' : ''}
              disabled={!local}
              aria-label={mic ? 'Mute microphone' : 'Unmute microphone'}
              onClick={() => {
                const enabled = !mediaControls.current.isEnabled('audio');
                mediaControls.current.setEnabled(
                  'audio',
                  enabled,
                  localRef.current,
                );
                setMic(enabled);
              }}
            >
              {mic ? <Mic size={19} /> : <MicOff size={19} />}
            </button>
            <button
              className={!cam ? 'off' : ''}
              disabled={!local?.getVideoTracks().length}
              aria-label={cam ? 'Turn camera off' : 'Turn camera on'}
              onClick={() => {
                const enabled = !mediaControls.current.isEnabled('video');
                mediaControls.current.setEnabled(
                  'video',
                  enabled,
                  localRef.current,
                );
                setCam(enabled);
              }}
            >
              {cam ? <Video size={19} /> : <VideoOff size={19} />}
            </button>
            <button
              className={sharing ? 'active' : ''}
              disabled={!connected}
              onClick={share}
            >
              <MonitorUp size={18} />
              {sharing ? 'Stop sharing screen' : 'Share screen'}
            </button>
            <button
              className={music ? 'active' : ''}
              disabled={
                !connected ||
                musicBusy ||
                !available ||
                !opened ||
                opened.id !== state?.room.project
              }
              aria-pressed={!!music}
              onClick={shareMusic}
            >
              <Music2 size={18} />{' '}
              {musicBusy
                ? 'Starting audio…'
                : music
                  ? 'Stop studio audio'
                  : 'Share studio audio'}
            </button>
            <button onClick={reconnect} disabled={joining || !connected}>
              <RefreshCw size={16} /> Reconnect
            </button>
            <button
              className="off"
              disabled={!connected && !joining}
              onClick={() => disconnect()}
              aria-label="Disconnect media"
            >
              <PhoneOff size={18} />
            </button>
          </div>
          {music && (
            <p className="music-sharing-status" role="status">
              Studio audio is shared · playback, drums and recording backing
              tracks. Call mute only mutes your voice.
            </p>
          )}
          <div className="connection-stats">
            {Object.entries(stats).map(([key, s]) => (
              <div key={key}>
                <strong>
                  {state?.members.find((m: any) => key.startsWith(m.user + ':'))
                    ?.name || 'Collaborator'}
                </strong>
                <span>
                  {s.state} · {s.route || 'connecting'}
                </span>
                <span>
                  Round trip {s.rtt || 0} ms · jitter {s.jitter || 0} ms · loss{' '}
                  {s.loss || 0}%
                </span>
              </div>
            ))}
          </div>
          <div className="room-instructions">
            <Music2 size={22} />
            <div>
              <h3>Hear the same thing. Build on the same idea.</h3>
              <p>
                Open the room studio and turn on Share studio audio. One person
                plays the music while everyone listens and talks. Screen sharing
                shows your work without sending the call’s voices back into the
                room. Use headphones to keep speaker sound out of your
                microphone.
              </p>
            </div>
          </div>
          <p className="small-note">
            Connections may have delay. SESSION does not record room calls;
            other participants can still capture what they hear or see. A relay
            improves reachability and does not provide zero-latency ensemble
            performance.
          </p>
        </div>
        <aside className="room-chat">
          <div className="section-title">
            <h2>In the session</h2>
            <span className="tiny-label">{state?.members.length || 1} / 4</span>
          </div>
          <div className="member-list">
            {state?.members.map((m: any) => (
              <div key={m.user}>
                <Avatar profile={m} size={31} />
                <span>
                  {m.user === user.id ? 'You' : m.name}
                  <small>
                    {state.sessions.some((s: any) => s.user === m.user)
                      ? 'In call'
                      : 'In room'}
                    {m.user === state.room.owner ? ' · Host' : ''}
                  </small>
                </span>
                {user.id === state.room.owner && m.user !== user.id && (
                  <button
                    aria-label={'Remove ' + m.name}
                    onClick={async () => {
                      try {
                        await action({
                          action: 'removeMember',
                          id,
                          user: m.user,
                        });
                        notify(
                          'Collaborator removed and old invitation revoked.',
                        );
                      } catch (e: any) {
                        notify(e.message);
                      }
                    }}
                  >
                    <UserMinus size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <h3 className="chat-title">Session chat</h3>
          <div className="chat-messages" aria-live="polite">
            {chat.length ? (
              chat.map((m) => (
                <div
                  className={
                    m.sender === user.id ? 'own-message' : 'chat-message'
                  }
                  key={m.id}
                >
                  <span>
                    {state?.members.find((p: any) => p.user === m.sender)
                      ?.name || 'Creator'}
                  </span>
                  <p>{m.body.text}</p>
                </div>
              ))
            ) : (
              <p className="chat-empty">
                Share a reference, a direction,
                <br />
                or a little encouragement.
              </p>
            )}
          </div>
          <form
            className="chat-compose"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!message.trim()) return;
              try {
                await post({
                  kind: 'chat',
                  body: { text: message },
                  clientId: crypto.randomUUID(),
                });
                setMessage('');
              } catch (e: any) {
                notify(e.message);
              }
            }}
          >
            <input
              aria-label="Session message"
              placeholder="Say something…"
              maxLength={1000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button aria-label="Send message" disabled={!message.trim()}>
              <Send size={17} />
            </button>
          </form>
        </aside>
      </div>
      {opened && (
        <section
          ref={studioElement}
          className="embedded-studio"
          aria-label="Live room music studio"
        >
          <div className="embedded-studio-heading">
            <Music2 size={20} />
            <div>
              <h2>Your music. Your room.</h2>
              <p>
                Your call stays above the editor. Share studio audio when you
                want the room to hear playback. Take review stays local to this
                tab.
              </p>
            </div>
          </div>
          {opened.id !== state?.room.project && (
            <p className="error-banner" role="status">
              The room project changed. This draft stays in this tab. Open the
              current room studio above when ready.
            </p>
          )}
          <Studio
            key={opened.id}
            initial={opened}
            roomAudio={roomAudio}
            roomAllowed={available && opened.id === state?.room.project}
            onDraft={onDraft}
            onActivity={(busy) => {
              studioBusy.current = busy;
              onWorkspaceBusy(busy);
            }}
            onSaved={() => onProjectsChanged()}
            onBrowse={() => {}}
            catalog={catalog}
            notify={notify}
          />
        </section>
      )}
      {available && state?.room.owner === user.id && (
        <div className="room-admin">
          <button
            onClick={async () => {
              try {
                await action({ action: 'rotateInvite', id });
                notify(
                  'Old invitation revoked. Copy the new link after the room refreshes.',
                );
              } catch (e: any) {
                notify(e.message);
              }
            }}
          >
            Replace invitation
          </button>
          <button
            className="danger-text"
            onClick={() => {
              if (studioBusy.current)
                return notify(
                  'Finish the studio dialog before closing the room.',
                );
              setClose(true);
            }}
          >
            Close room permanently
          </button>
        </div>
      )}
      <Dialog open={mediaSettings} onOpenChange={setMediaSettings}>
        <DialogContent className="form-dialog">
          <DialogTitle>Video &amp; audio settings</DialogTitle>
          <DialogDescription>
            Switch devices live — the call continues without reconnecting.
          </DialogDescription>
          <Pick
            label="Microphone"
            value={chosenMic}
            onChange={(id) => void switchMic(id)}
            options={[
              { value: '', label: 'System default microphone' },
              ...mics
                .filter((d) => d.deviceId !== 'default')
                .map((d, i) => ({
                  value: d.deviceId,
                  label: d.label || 'Microphone ' + (i + 1),
                })),
            ]}
          />
          <Pick
            label="Camera"
            value={chosenCam}
            onChange={(id) => void switchCam(id)}
            options={[
              { value: '', label: 'System default camera' },
              ...cams
                .filter((d) => d.deviceId !== 'default')
                .map((d, i) => ({
                  value: d.deviceId,
                  label: d.label || 'Camera ' + (i + 1),
                })),
            ]}
          />
          <Pick
            label="Camera quality"
            value={camQuality}
            onChange={(q) => {
              setCamQuality(q);
              if (connected) void switchCam(chosenCam, q);
            }}
            options={[
              { value: '360', label: 'Standard · 360p (kind to data)' },
              { value: '720', label: 'High · 720p HD' },
            ]}
          />
          <p className="small-note">
            Echo and noise processing stay on for the call. The studio recorder
            opens its own clean path when you record a take.
          </p>
        </DialogContent>
      </Dialog>
      <Confirm
        open={close}
        onClose={() => setClose(false)}
        onConfirm={async () => {
          try {
            await action({ action: 'closeRoom', id });
            disconnect(false);
            onExit();
          } catch (e: any) {
            notify(e.message);
          }
        }}
        title="Close this studio room?"
        description="This ends room access for every collaborator and deletes room chat. Your project stays saved."
      />
    </div>
  );
}
