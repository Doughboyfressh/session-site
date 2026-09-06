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
} from 'lucide-react';
import { action, Avatar, Confirm } from './helpers';
import { PeerLink } from '@/lib/peer';
import Diagnostics from './diagnostics';
import RoomStudio from './room-studio';
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
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return (
    <div className="video-tile">
      <video ref={ref} autoPlay playsInline muted={muted} controls={!muted} />
      <span>{label}</span>
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
}: {
  id: string;
  user: any;
  onExit: () => void;
  projects: { id: string; title: string }[];
  onProjectsChanged: () => unknown;
  notify: (m: string) => void;
}) {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(''),
    [callNotice, setCallNotice] = useState(''),
    [chat, setChat] = useState<any[]>([]),
    [message, setMessage] = useState(''),
    [local, setLocal] = useState<MediaStream | null>(null),
    [remote, setRemote] = useState<
      Record<string, { stream: MediaStream; peer: string }>
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
  const remoteShares = useRef(new Map<string, string>());
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
  function closePeer(key: string) {
    const p = peers.current.get(key);
    p?.close();
    peers.current.delete(key);
    remoteShares.current.delete(key);
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
    const previous = session.current;
    session.current = '';
    if (announce && previous)
      post({ kind: 'stopMedia', session: previous }).catch(() => {});
    for (const key of peers.current.keys()) closePeer(key);
    localRef.current?.getTracks().forEach((t) => t.stop());
    shareRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
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
                  ...(body.description
                    ? { shareStreamId: shareRef.current?.id || null }
                    : {}),
                  senderSession: ownSession,
                  recipientSession: target.session,
                },
              });
            },
            stream: (stream, remove) =>
              setRemote((r) => {
                const n = { ...r };
                if (remove) delete n[stream.id];
                else n[stream.id] = { stream, peer: key };
                return n;
              }),
            state: (v) =>
              setStats((x) => ({ ...x, [key]: { ...x[key], state: v } })),
          },
        );
        peers.current.set(key, link);
        link.setStreams(
          [localRef.current, shareRef.current].filter(Boolean) as MediaStream[],
        );
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
          if (r.status === 403) {
            disconnect(false);
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
              if (e.body.description) {
                const previous = remoteShares.current.get(key),
                  next =
                    typeof e.body.shareStreamId === 'string'
                      ? e.body.shareStreamId
                      : '';
                if (previous && previous !== next)
                  setRemote((r) => {
                    const n = { ...r };
                    delete n[previous];
                    return n;
                  });
                remoteShares.current.set(key, next);
              }
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
    };
  }, [id]);
  async function connect(video = true) {
    if (joining) return;
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
      localRef.current = stream;
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
    for (const p of peers.current.values())
      p.setStreams(localRef.current ? [localRef.current] : []);
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
        audio: true,
      });
      if (epoch !== generation.current || !session.current || !alive.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      shareRef.current = s;
      setSharing(s);
      s.getVideoTracks()[0].onended = stopShare;
      for (const p of peers.current.values())
        p.setStreams([localRef.current, s].filter(Boolean) as MediaStream[]);
      await post({ kind: 'sharing', session: session.current, value: true });
      if (!s.getAudioTracks().length)
        notify(
          'Your screen is shared without audio. Choose a browser tab and enable Share tab audio to include music.',
        );
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
      url.search = '?room=' + id;
      url.hash = 'invite=' + state.room.invite;
      await navigator.clipboard.writeText(url.href);
      notify('Invitation copied. It expires in 24 hours.');
    } catch {
      notify('Your browser blocked copying. Try from a full browser tab.');
    }
  }
  return (
    <div className="room-page">
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
              disconnect();
              onExit();
            }}
          >
            Back to rooms
          </button>
          {state?.room.owner === user.id && (
            <button className="button primary" onClick={copy}>
              <Copy size={16} /> Copy invite
            </button>
          )}
        </div>
      </div>
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
          onChanged={onProjectsChanged}
          notify={notify}
        />
      )}
      <div className="room-layout">
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
                    disabled={joining || checking}
                    onClick={() => connect(true)}
                  >
                    <Video size={16} />
                    {joining ? 'Connecting…' : 'Join with camera & mic'}
                  </button>
                  <button
                    className="button secondary"
                    disabled={joining || checking}
                    onClick={() => connect(false)}
                  >
                    Audio only
                  </button>
                </div>
              </div>
            )}
            {Object.values(remote).map(({ stream, peer }) => (
              <MediaTile
                key={stream.id}
                stream={stream}
                label={
                  state?.members.find((m: any) => peer.startsWith(m.user + ':'))
                    ?.name || 'Collaborator'
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
            <button
              className={!mic ? 'off' : ''}
              disabled={!local}
              aria-label={mic ? 'Mute microphone' : 'Unmute microphone'}
              onClick={() => {
                localRef.current
                  ?.getAudioTracks()
                  .forEach((t) => (t.enabled = !mic));
                setMic(!mic);
              }}
            >
              {mic ? <Mic size={19} /> : <MicOff size={19} />}
            </button>
            <button
              className={!cam ? 'off' : ''}
              disabled={!local?.getVideoTracks().length}
              aria-label={cam ? 'Turn camera off' : 'Turn camera on'}
              onClick={() => {
                localRef.current
                  ?.getVideoTracks()
                  .forEach((t) => (t.enabled = !cam));
                setCam(!cam);
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
              {sharing ? 'Stop sharing' : 'Share screen & audio'}
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
                Open your studio in another tab, then share that browser tab
                with audio enabled. One person drives the session while everyone
                listens and talks. Headphones help prevent echo.
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
      {state?.room.owner === user.id && (
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
          <button className="danger-text" onClick={() => setClose(true)}>
            Close room permanently
          </button>
        </div>
      )}
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
