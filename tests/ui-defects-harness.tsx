import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import SessionApp from '@/app/session-app';
import Studio from '@/app/studio';
import ChannelFx from '@/app/channel-fx';
import { UploadForm } from '@/app/forms';
import { defaults } from '@/lib/audio';
import '@/app/globals.css';
import '@/app/advanced.css';

const creator = {
  id: 'fixture-creator',
  name: 'Fixture Creator',
  username: 'fixture_creator',
  roles: ['Producer'],
  bio: 'Synthetic local UI fixture',
  visibility: 'public',
  services: [],
  rates: JSON.stringify([
    { service: 'Fixture mix review', role: 'Engineer', amountCents: 1000 },
  ]),
  stats: {},
};
const member = {
  id: 'fixture-member',
  name: 'Fixture Member',
  username: 'fixture_member',
  roles: ['Artist'],
  visibility: 'private',
};
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url === '/api/state')
    return Response.json({
      profile: member,
      tracks: [],
      profiles: [creator],
      projects: [],
      rooms: [],
      saved: [],
      follows: [],
      posts: [],
      orders: [],
      trending: [],
      liveRooms: [],
      pulse: { tracks: 0, creators: 1, tracksToday: 0, publicRooms: 0 },
      payments: {},
      unreadNotifications: 2,
      unreadCollaborations: 1,
    });
  if (url.startsWith('/api/')) {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    if (body.action === 'socialInbox')
      return Response.json({
        collaborations: [],
        messages: [],
        notifications: [],
      });
    if (body.action === 'project')
      return Response.json({ id: 'fixture-project', revision: 1 });
    if (body.action === 'projectRead')
      return Response.json({
        id: 'fixture-project',
        owner: member.id,
        title: 'Fixture project',
        revision: 1,
        canEdit: true,
        canManage: true,
        data: { bpm: 92, tracks: [] },
      });
    return Response.json({
      items: [],
      unread: 0,
      blocks: [],
      requests: [],
      conversations: [],
      notifications: [],
      ok: true,
    });
  }
  return nativeFetch(input, init);
};

function Fixture() {
  const [mode, setMode] = useState('studio');
  const [notice, setNotice] = useState('');
  const [locked, setLocked] = useState(true);
  const [track, setTrack] = useState(() => ({
    ...defaults('Fixture instrument'),
    id: 'fixture-instrument',
    instrument: {
      kind: 'keys' as const,
      loopBeats: 4,
      notes: [{ midi: 60, beat: 0, duration: 1, velocity: 0.7 }],
    },
  }));
  return (
    <>
      <nav
        aria-label="Fixture modes"
        style={{ padding: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}
      >
        {['studio', 'upload', 'fx', 'guest', 'member'].map((value) => (
          <button
            className="button secondary"
            key={value}
            onClick={() => {
              setMode(value);
              setNotice('');
            }}
          >
            {value === 'guest'
              ? 'Guest workspace'
              : value === 'member'
                ? 'Member workspace'
                : value === 'fx'
                  ? 'FX controls fixture'
                  : value === 'upload'
                    ? 'Upload fixture'
                    : 'Studio fixture'}
          </button>
        ))}
      </nav>
      <output aria-label="Fixture notice">{notice}</output>
      {mode === 'studio' ? (
        <Studio
          initial={null}
          onDraft={() => {}}
          onSaved={() => setNotice('Saved fixture project')}
          onBrowse={() => setNotice('Browse fixture')}
          notify={setNotice}
          onPrepareSave={async () => true}
        />
      ) : mode === 'upload' ? (
        <UploadForm
          onDone={() => setNotice('Uploaded local fixture')}
          notify={setNotice}
        />
      ) : mode === 'fx' ? (
        <section
          className="mixer"
          style={{ maxWidth: 700, margin: '20px auto' }}
        >
          <label>
            <input
              type="checkbox"
              checked={locked}
              onChange={(event) => setLocked(event.target.checked)}
            />
            Lock FX controls
          </label>
          <output aria-label="Fixture drive">{track.drive || 0}</output>
          <ChannelFx
            track={track}
            disabled={locked}
            onPatch={(_id, patch) =>
              setTrack((current) => ({ ...current, ...patch }))
            }
          />
        </section>
      ) : (
        <SessionApp
          key={mode}
          user={mode === 'member' ? { id: member.id, name: member.name } : null}
        />
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
