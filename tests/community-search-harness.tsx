import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SessionApp from '@/app/session-app';
import { demos } from '@/lib/catalog';
import { tourDone } from '@/app/onboarding';
import '@/app/globals.css';
import '@/app/advanced.css';

type SearchRequest = {
  id: number;
  query: string;
  aborted: boolean;
  settled: boolean;
  resolve: (response: Response) => void;
};
let mode = 'automatic';
let requests: SearchRequest[] = [];
const changed = () => window.dispatchEvent(new Event('fixture-search-change'));
const creator = {
  id: 'fixture-creator',
  name: 'Fixture Creator',
  username: 'fixture_creator',
  roles: JSON.stringify(['Engineer']),
  bio: 'Synthetic local search creator',
  avatar: null,
  followers: 1,
  location: 'Fixture City',
  rates: JSON.stringify([
    { service: 'Fixture mix review', role: 'Engineer', amountCents: 1000 },
  ]),
  chargesEnabled: true,
};
const archived = {
  id: 'fixture-archived-track',
  title: 'Archived community track',
  creator: 'Fixture Creator',
  genre: 'Electronic',
  bpm: 100,
  plays: 1000,
};
function complete(request: SearchRequest, failed = false) {
  if (request.settled) return;
  request.settled = true;
  const q = request.query.toLowerCase();
  const tracks =
    q === 'archived'
      ? [archived]
      : ['alpha', 'beta'].includes(q)
        ? [{ ...archived, id: 'fixture-' + q, title: q + ' response' }]
        : q === 'trap'
          ? [demos.find((track) => track.genre === 'Trap')!]
          : [];
  request.resolve(
    Response.json(
      failed
        ? { error: 'Synthetic search failure' }
        : { tracks, profiles: q.includes('creator') ? [creator] : [] },
      { status: failed ? 503 : 200 },
    ),
  );
  changed();
}
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
      profile: null,
      tracks: [],
      profiles: [creator],
      projects: [],
      rooms: [],
      saved: [],
      follows: [],
      posts: [],
      orders: [],
      trending: [archived],
      liveRooms: [],
      pulse: { tracks: 1, creators: 1, tracksToday: 0, publicRooms: 0 },
      payments: {
        configured: true,
        chargesEnabled: false,
        payoutsEnabled: false,
      },
      unreadNotifications: 0,
    });
  if (url.startsWith('/api/search?'))
    return new Promise<Response>((resolve) => {
      const request: SearchRequest = {
        id: requests.length + 1,
        query: new URL(url, window.location.origin).searchParams.get('q') || '',
        aborted: false,
        settled: false,
        resolve,
      };
      requests = [...requests, request];
      // Deliberately allow held responses after cancellation to verify ownership.
      init?.signal?.addEventListener(
        'abort',
        () => {
          request.aborted = true;
          changed();
        },
        { once: true },
      );
      if (mode !== 'hold')
        setTimeout(() => complete(request, mode === 'failure'), 60);
      changed();
    });
  if (url.startsWith('/api/'))
    return Response.json(
      { error: 'Synthetic fixture: action disabled.' },
      { status: 403 },
    );
  return nativeFetch(input, init);
};
tourDone();

function Fixture() {
  const [, setVersion] = useState(0);
  const [responseMode, setResponseMode] = useState(mode);
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    const listener = () => setVersion((value) => value + 1);
    window.addEventListener('fixture-search-change', listener);
    return () => window.removeEventListener('fixture-search-change', listener);
  }, []);
  return (
    <>
      <section aria-label="Search fixture controls" style={{ padding: 10 }}>
        <label>
          Search response mode{' '}
          <select
            value={responseMode}
            onChange={(event) => {
              mode = event.target.value;
              setResponseMode(mode);
            }}
          >
            <option value="automatic">Automatic responses</option>
            <option value="hold">Hold responses</option>
            <option value="failure">HTTP failure</option>
          </select>
        </label>{' '}
        <button
          className="button secondary"
          onClick={() => setMounted((value) => !value)}
        >
          {mounted ? 'Unmount workspace' : 'Mount workspace'}
        </button>
        <div aria-label="Fixture search requests">
          {requests.map((request) => (
            <div key={request.id}>
              Request {request.id}: {request.query} ·{' '}
              {request.aborted ? 'cancelled' : 'active'} ·{' '}
              {request.settled ? 'completed' : 'held'}{' '}
              <button
                disabled={request.settled}
                onClick={() => complete(request)}
              >
                Complete {request.query} request {request.id}
              </button>{' '}
              <button
                disabled={request.settled}
                onClick={() => complete(request, true)}
              >
                Fail {request.query} request {request.id}
              </button>
            </div>
          ))}
        </div>
      </section>
      {mounted && <SessionApp user={null} />}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
