import { all, one } from './server';
import { requireDeveloper } from './developer-server';
import type { DeveloperDashboard, DeveloperProfile } from './developer-types';
import { readDeveloperActivity } from './activity-server';

const DAY = 86400000;
const PAGE_SIZE = 25;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function count(value: unknown): number {
  if (
    typeof value !== 'number' &&
    typeof value !== 'bigint' &&
    !(typeof value === 'string' && /^\d+$/.test(value))
  )
    throw new Error('Invalid database number.');
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0)
    throw new Error('Invalid database number.');
  return numeric;
}

function profile(row: Record<string, unknown>): DeveloperProfile {
  if (
    typeof row.id !== 'string' ||
    typeof row.username !== 'string' ||
    typeof row.name !== 'string' ||
    (row.visibility !== 'public' && row.visibility !== 'private')
  )
    throw new Error('Invalid profile metadata.');
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    visibility: row.visibility,
    created: count(row.created),
    projects: count(row.projects),
    tracks: count(row.tracks),
  };
}

function parameters(url: string) {
  const params = new URL(url).searchParams;
  const q = (params.get('q') || '').trim();
  const rawPage = params.get('page');
  const page = rawPage === null ? 1 : Number(rawPage);
  if (
    q.length > 80 ||
    hasControlCharacters(q) ||
    (rawPage !== null && !/^\d{1,7}$/.test(rawPage)) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000000
  )
    throw Object.assign(new Error('Invalid dashboard filters.'), {
      status: 400,
    });
  // Let the database fold both sides; SQLite LOWER only folds ASCII.
  const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  return { page, like };
}

// This is the only dashboard query entry point: authorization precedes parsing and SQL.
export async function readDeveloperDashboard(
  url: string,
): Promise<DeveloperDashboard> {
  await requireDeveloper();
  const { page, like } = parameters(url);
  const started = performance.now();
  const generatedAt = Date.now();
  const since = generatedAt - 7 * DAY;
  const today = Math.floor(generatedAt / DAY) * DAY;
  const firstDay = today - 13 * DAY;
  const recentPresence = generatedAt - 30000;
  const search =
    "(LOWER(p.username) LIKE LOWER(?) ESCAPE '\\' OR LOWER(p.name) LIKE LOWER(?) ESCAPE '\\')";
  const [
    profiles,
    projects,
    tracks,
    posts,
    rooms,
    presence,
    files,
    reports,
    active,
    daily,
    total,
    rows,
    activity,
  ] = await Promise.all([
    one(
      `SELECT COUNT(*) AS profiles,
        COALESCE(SUM(CASE WHEN created>=? AND created<=? THEN 1 ELSE 0 END),0) AS recent,
        COALESCE(SUM(CASE WHEN visibility='public' THEN 1 ELSE 0 END),0) AS public
        FROM profiles`,
      since,
      generatedAt,
    ),
    one('SELECT COUNT(*) AS count FROM projects'),
    one(`SELECT COALESCE(SUM(CASE WHEN visibility='public' THEN 1 ELSE 0 END),0) AS public,
        COALESCE(SUM(CASE WHEN visibility='private' THEN 1 ELSE 0 END),0) AS private FROM tracks`),
    one('SELECT COUNT(*) AS count FROM posts'),
    one('SELECT COUNT(*) AS count FROM rooms'),
    one(
      `SELECT COUNT(DISTINCT m.room) AS rooms, COUNT(DISTINCT m.user) AS participants
        FROM members m JOIN rooms r ON r.id=m.room
        WHERE m.seen>=? AND m.seen<=?`,
      recentPresence,
      generatedAt,
    ),
    one('SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM files'),
    one('SELECT COUNT(*) AS count FROM reports'),
    one(
      `SELECT COUNT(*) AS count FROM profiles p WHERE p.id IN (
        SELECT COALESCE(updatedBy,owner) FROM projects WHERE updated>=?1 AND updated<=?2
        UNION SELECT owner FROM tracks WHERE created>=?1 AND created<=?2
        UNION SELECT owner FROM posts WHERE created>=?1 AND created<=?2
        UNION SELECT user FROM comments WHERE created>=?1 AND created<=?2
        UNION SELECT owner FROM rooms WHERE created>=?1 AND created<=?2
        UNION SELECT id FROM profiles WHERE created>=?1 AND created<=?2
        UNION SELECT user FROM members WHERE seen>=?1 AND seen<=?2
      )`,
      since,
      generatedAt,
    ),
    all(
      `SELECT CAST((created-?1)/86400000 AS INTEGER) AS bucket, COUNT(*) AS count
        FROM profiles WHERE created>=?1 AND created<=?2
        GROUP BY CAST((created-?1)/86400000 AS INTEGER)`,
      firstDay,
      generatedAt,
    ),
    one('SELECT COUNT(*) AS count FROM profiles p WHERE ' + search, like, like),
    all(
      `SELECT p.id,p.username,p.name,p.visibility,p.created,
        (SELECT COUNT(*) FROM projects project WHERE project.owner=p.id) AS projects,
        (SELECT COUNT(*) FROM tracks track WHERE track.owner=p.id) AS tracks
        FROM profiles p WHERE ${search}
        ORDER BY p.created DESC,p.id ASC LIMIT ? OFFSET ?`,
      like,
      like,
      PAGE_SIZE,
      (page - 1) * PAGE_SIZE,
    ),
    readDeveloperActivity(generatedAt),
  ]);
  const signupDays = Array.from({ length: 14 }, (_, day) => ({
    day: new Date(firstDay + day * DAY).toISOString().slice(0, 10),
    count: 0,
  }));
  for (const row of daily) {
    const bucket = count(row.bucket);
    if (bucket >= signupDays.length) throw new Error('Invalid day bucket.');
    signupDays[bucket].count = count(row.count);
  }
  return {
    generatedAt,
    metrics: {
      profiles: count(profiles?.profiles),
      profiles7d: count(profiles?.recent),
      publicProfiles: count(profiles?.public),
      projects: count(projects?.count),
      publicTracks: count(tracks?.public),
      privateTracks: count(tracks?.private),
      posts: count(posts?.count),
      rooms: count(rooms?.count),
      liveRooms: count(presence?.rooms),
      liveParticipants: count(presence?.participants),
      files: count(files?.count),
      mediaBytes: count(files?.bytes),
      reports: count(reports?.count),
      recordedActiveCreators7d: count(active?.count),
    },
    signupDays,
    activity,
    users: {
      items: rows.map(profile),
      page,
      pageSize: PAGE_SIZE,
      total: count(total?.count),
    },
    health: {
      database: 'reachable',
      queryMs: Math.max(0, Math.round(performance.now() - started)),
    },
  };
}
