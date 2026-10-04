import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DeveloperDashboardClient from '@/app/developer/dashboard';
import type {
  DeveloperActivity,
  DeveloperDashboard,
  DeveloperProfile,
} from '@/lib/developer-types';
import '@/app/globals.css';
import '@/app/developer/developer.css';

// Synthetic rows only. Held responses intentionally survive cancellation so
// browser review can verify stale responses never restore another query's data.
const now = Date.UTC(2026, 9, 3, 18);
const creators: DeveloperProfile[] = Array.from({ length: 30 }, (_, index) => ({
  id: `fixture-${index + 1}`,
  username: `creator_${index + 1}`,
  name:
    index === 0
      ? 'Alpha Producer'
      : index === 1
        ? 'Beta Artist'
        : `Creator ${index + 1}`,
  visibility: index % 2 ? 'private' : 'public',
  created: now - index * 86400000,
  projects: index % 4,
  tracks: index % 3,
}));
type HeldRequest = {
  id: number;
  query: string;
  page: number;
  activityMode: string;
  aborted: boolean;
  completed: boolean;
  resolve: (response: Response) => void;
};
let mode = 'automatic';
let resultLimit = 30;
let requests: HeldRequest[] = [];
const changed = () =>
  window.dispatchEvent(new Event('developer-fixture-change'));

function fixtureActivity(responseMode: string): DeveloperActivity {
  if (
    responseMode === 'activity-not-configured' ||
    responseMode === 'activity-unavailable'
  )
    return {
      status:
        responseMode === 'activity-not-configured'
          ? 'not-configured'
          : 'unavailable',
      timezone: 'UTC',
      collectedSince: null,
      visitorsToday: null,
      dailyActiveUsersToday: null,
      days: [],
    };

  const empty = responseMode === 'activity-empty';
  const visitors = [31, 44, 58, 62, 87];
  const activeUsers = [9, 13, 12, 18, 24];
  const activity: DeveloperActivity = {
    status: 'ready',
    timezone: 'UTC',
    collectedSince: empty ? null : '2026-09-29',
    visitorsToday: empty ? 0 : 87,
    dailyActiveUsersToday: empty ? 0 : 24,
    days: Array.from({ length: 14 }, (_, index) => ({
      day: new Date(now - (13 - index) * 86400000).toISOString().slice(0, 10),
      visitors: empty
        ? index === 13
          ? 0
          : null
        : index < 9
          ? null
          : visitors[index - 9],
      activeUsers: empty
        ? index === 13
          ? 0
          : null
        : index < 9
          ? null
          : activeUsers[index - 9],
    })),
  };
  // Malformed payloads verify validation fails before any metrics render.
  if (responseMode === 'activity-invalid-day')
    activity.days[0].day = '2026-02-30';
  if (responseMode === 'activity-invalid-count')
    activity.days[13].visitors = 1.5;
  if (responseMode === 'activity-invalid-null') activity.days[0].visitors = 0;
  if (responseMode === 'activity-invalid-today') activity.visitorsToday = 88;
  if (responseMode === 'activity-invalid-status')
    activity.status = 'broken' as DeveloperActivity['status'];
  return activity;
}

function complete(request: HeldRequest, status = 200) {
  if (request.completed) return;
  request.completed = true;
  const matched = creators
    .slice(0, resultLimit)
    .filter((user) =>
      `${user.name} ${user.username}`
        .toLowerCase()
        .includes(request.query.toLowerCase()),
    );
  const result: DeveloperDashboard = {
    generatedAt: now,
    metrics: {
      profiles: 30,
      profiles7d: 7,
      publicProfiles: 15,
      projects: 44,
      publicTracks: 12,
      privateTracks: 8,
      posts: 6,
      rooms: 4,
      liveRooms: 1,
      liveParticipants: 2,
      files: 34,
      mediaBytes: 48000000,
      reports: 2,
      recordedActiveCreators7d: 9,
    },
    signupDays: Array.from({ length: 14 }, (_, index) => ({
      day: new Date(now - (13 - index) * 86400000).toISOString().slice(0, 10),
      count: index % 4,
    })),
    activity: fixtureActivity(request.activityMode),
    users: {
      items: matched.slice((request.page - 1) * 25, request.page * 25),
      page: request.page,
      pageSize: 25,
      total: matched.length,
    },
    health: { database: 'reachable', queryMs: 18 },
  };
  request.resolve(
    status === 200
      ? Response.json(result)
      : Response.json(
          {
            error:
              status === 401
                ? 'Sign in to view the developer dashboard.'
                : status === 403
                  ? 'Developer access required.'
                  : 'Developer data could not load. Please try again.',
          },
          { status },
        ),
  );
  changed();
}
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const url = new URL(raw, window.location.origin);
  if (url.pathname !== '/api/developer') return originalFetch(input, init);
  return new Promise<Response>((resolve) => {
    const request: HeldRequest = {
      id: requests.length + 1,
      query: url.searchParams.get('q') || '',
      page: Number(url.searchParams.get('page') || 1),
      activityMode: mode,
      aborted: !!init?.signal?.aborted,
      completed: false,
      resolve,
    };
    requests = [...requests, request];
    init?.signal?.addEventListener(
      'abort',
      () => {
        request.aborted = true;
        changed();
      },
      { once: true },
    );
    const responseMode = mode;
    if (responseMode !== 'hold')
      setTimeout(
        () =>
          complete(
            request,
            responseMode === 'unauthorized'
              ? 401
              : responseMode === 'forbidden'
                ? 403
                : responseMode === 'failure'
                  ? 503
                  : 200,
          ),
        30,
      );
    changed();
  });
};

function Fixture() {
  const [, render] = useState(0);
  const [selection, setSelection] = useState(mode);
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    const listener = () => render((version) => version + 1);
    window.addEventListener('developer-fixture-change', listener);
    return () =>
      window.removeEventListener('developer-fixture-change', listener);
  }, []);
  return (
    <>
      <section
        aria-label="Synthetic developer fixture controls"
        style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 12 }}
      >
        <label>
          Fixture response mode{' '}
          <select
            aria-label="Fixture response mode"
            value={selection}
            onChange={(event) => {
              mode = event.target.value;
              setSelection(mode);
            }}
          >
            <option value="automatic">Automatic</option>
            <option value="hold">Hold responses</option>
            <option value="unauthorized">Signed out</option>
            <option value="forbidden">Access removed</option>
            <option value="failure">Database unavailable</option>
            <option value="activity-empty">
              Audience awaiting first visit
            </option>
            <option value="activity-not-configured">
              Audience not configured
            </option>
            <option value="activity-unavailable">Audience unavailable</option>
            <option value="activity-invalid-day">Audience invalid date</option>
            <option value="activity-invalid-count">
              Audience invalid count
            </option>
            <option value="activity-invalid-null">
              Audience invalid unknown day
            </option>
            <option value="activity-invalid-today">
              Audience mismatched today
            </option>
            <option value="activity-invalid-status">
              Audience invalid status
            </option>
          </select>
        </label>
        <button onClick={() => setMounted((value) => !value)}>
          {mounted ? 'Unmount dashboard' : 'Mount dashboard'}
        </button>
        <button
          onClick={() => {
            resultLimit = 25;
            changed();
          }}
        >
          Shrink to 25 profiles
        </button>
        <button
          onClick={() => {
            resultLimit = 30;
            changed();
          }}
        >
          Restore 30 profiles
        </button>
        <details>
          <summary>Fixture requests</summary>
          <div aria-label="Fixture developer requests">
            {requests.map((request) => (
              <div key={request.id}>
                Request {request.id}: {request.query || 'all'} / page{' '}
                {request.page} · {request.aborted ? 'cancelled' : 'active'} ·{' '}
                {request.completed ? 'complete' : 'held'}{' '}
                <button
                  disabled={request.completed}
                  onClick={() => complete(request)}
                >
                  Complete request {request.id}
                </button>{' '}
                <button
                  disabled={request.completed}
                  onClick={() => complete(request, 403)}
                >
                  Deny request {request.id}
                </button>
              </div>
            ))}
          </div>
        </details>
        <p>
          Synthetic profiles and metrics; no production data or account changes.
        </p>
      </section>
      {mounted && <DeveloperDashboardClient signInHref="/fixture-sign-in" />}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
