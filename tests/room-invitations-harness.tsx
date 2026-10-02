import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Room from '@/app/room';
import { ActivityView } from '@/app/social';
import '@/app/globals.css';

const room = {
  id: 'fixture-room',
  owner: 'host',
  title: 'In-session invitation review',
  invite: 'fixture-link',
  expires: Date.now() + 86400000,
  project: null,
};
const profiles = [
  {
    id: 'guest',
    name: 'Jordan Artist',
    username: 'jordan_artist',
    avatar: null,
  },
  {
    id: 'engineer',
    name: 'Morgan Engineer',
    username: 'morgan_engineer',
    avatar: null,
  },
];
let user = 'host',
  full = false,
  expired = false,
  failSend = false;
let members = [{ user: 'host', name: 'SESSION Host' }];
const invitations = new Map<
  string,
  { id: string; kind: string; recipient: string }
>();
let update = () => {};
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const current = new URL(url, window.location.origin);
  if (!current.pathname.startsWith('/api/')) return realFetch(input, init);
  if (current.pathname.startsWith('/api/room/'))
    return Response.json({
      room,
      members: full
        ? [
            ...members,
            { user: 'seat-3', name: 'Seat 3' },
            { user: 'seat-4', name: 'Seat 4' },
            { user: 'seat-5', name: 'Seat 5' },
          ].slice(0, 4)
        : members,
      sessions: [],
      events: [],
      cursor: 0,
      projectInfo: null,
      editors: [],
    });
  if (current.pathname === '/api/social' && !init?.method) {
    const items = [...invitations.values()]
      .filter((n) => n.recipient === user)
      .map((n) => ({
        id: n.id,
        kind: n.kind,
        actorName: 'SESSION Host',
        body: `invited you to join “${room.title}”`,
        resourceType: 'room_invite',
        resourceId: room.id,
        created: Date.now(),
        inviteExpires: room.expires,
        inviteStatus:
          n.kind === 'room_invite_declined'
            ? 'declined'
            : expired
              ? 'expired'
              : members.some((m) => m.user === user)
                ? 'joined'
                : full
                  ? 'full'
                  : 'pending',
      }));
    return Response.json({ items, unread: items.length });
  }
  const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
  if (body.action === 'roomInviteCandidates') {
    await new Promise((resolve) =>
      setTimeout(resolve, body.query === 'jordan' ? 450 : 30),
    );
    const query = String(body.query || '')
      .replace(/^@/, '')
      .toLowerCase();
    return Response.json({
      profiles: profiles
        .filter(
          (p) =>
            !members.some((m) => m.user === p.id) &&
            (p.name + p.username).toLowerCase().includes(query),
        )
        .map((p) => ({
          ...p,
          inviteStatus:
            invitations.get(p.id)?.kind === 'room_invite_declined'
              ? 'declined'
              : invitations.has(p.id)
                ? 'pending'
                : null,
        })),
      memberCount: full ? 4 : members.length,
      expires: expired ? 1 : room.expires,
      expired,
    });
  }
  if (body.action === 'inviteRoom') {
    if (failSend)
      return Response.json(
        { error: 'Could not send this invitation. Try again.' },
        { status: 503 },
      );
    invitations.set(body.recipient, {
      id: 'notice-' + body.recipient,
      kind: 'room_invite',
      recipient: body.recipient,
    });
    update();
    return Response.json({ status: 'pending' });
  }
  if (body.action === 'rotateInvite') {
    expired = false;
    invitations.clear();
    update();
    return Response.json({ ok: true });
  }
  if (body.action === 'notificationRead') return Response.json({ ok: true });
  if (body.action === 'respondRoomInvite') {
    const notice = [...invitations.values()].find((n) => n.id === body.id);
    if (!notice || notice.recipient !== user)
      return Response.json({ error: 'Unavailable' }, { status: 404 });
    notice.kind =
      body.response === 'declined'
        ? 'room_invite_declined'
        : 'room_invite_joined';
    if (body.response === 'accepted')
      members.push({
        user,
        name: profiles.find((p) => p.id === user)?.name || user,
      });
    update();
    return Response.json({ status: body.response, id: room.id });
  }
  return Response.json({ ok: true });
};
const drafts = new Map<string, unknown>();
function Harness() {
  const [actor, setActor] = useState('host');
  const [view, setView] = useState('room');
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0);
  const [, render] = useState(0);
  useEffect(() => {
    update = () => render((value) => value + 1);
    return () => {
      update = () => {};
    };
  }, []);
  const unread = useCallback(() => {}, []);
  const switchActor = (id: string) => {
    user = id;
    setActor(id);
    setView(id === 'host' ? 'room' : 'alerts');
  };
  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div className="actions" style={{ marginBottom: 20 }}>
        <button
          className="button secondary"
          onClick={() => switchActor('host')}
        >
          View as host
        </button>
        <button
          className="button secondary"
          onClick={() => switchActor('guest')}
        >
          View as Jordan
        </button>
        <button
          className="button secondary"
          onClick={() => switchActor('engineer')}
        >
          View as Morgan
        </button>
        <button
          className="button secondary"
          onClick={() => {
            invitations.clear();
            members = [members[0]];
            full = false;
            expired = false;
            failSend = false;
            setVersion((value) => value + 1);
          }}
        >
          Reset fixtures
        </button>
        <button
          className="button secondary"
          onClick={() => {
            full = !full;
            setVersion((value) => value + 1);
          }}
        >
          Toggle full session
        </button>
        <button
          className="button secondary"
          onClick={() => {
            expired = !expired;
            setVersion((value) => value + 1);
          }}
        >
          Toggle expired invites
        </button>
        <button
          className="button secondary"
          onClick={() => {
            failSend = !failSend;
            setVersion((value) => value + 1);
          }}
        >
          Toggle send error
        </button>
      </div>
      <output>
        Isolated UI fixture · no real invitations sent · {invitations.size}{' '}
        invitations
      </output>
      {notice && <output>{notice}</output>}
      {view === 'alerts' ? (
        <ActivityView
          key={actor + version}
          onUnreadChange={unread}
          onOpen={() => setView('room')}
        />
      ) : (
        <Room
          key={actor + version}
          id={room.id}
          user={{ id: actor }}
          onExit={() => setView('alerts')}
          projects={[]}
          onProjectsChanged={() => {}}
          notify={setNotice}
          drafts={drafts}
          onDraft={() => {}}
          onWorkspaceBusy={() => {}}
          catalog={[]}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
