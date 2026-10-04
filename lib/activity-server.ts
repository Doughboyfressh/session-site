import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { all, database } from './server';
import {
  ACTIVITY_DAY_MS,
  activityDay,
  activityHash,
  activitySecret,
  activityVisitor,
} from './activity';
import type { DeveloperActivity } from './developer-types';

function configuredSecret() {
  return activitySecret(
    env as unknown as {
      SESSION_ACTIVITY_SECRET?: unknown;
      NEON_AUTH_COOKIE_SECRET?: unknown;
    },
  );
}

// Identity comes exclusively from the verified deployment auth adapter. No profile is required.
export async function recordActivity(
  request: Request,
  now = Date.now(),
): Promise<string | null> {
  const secret = configuredSecret();
  if (!secret) return null;
  const day = activityDay(now);
  const visitor = await activityVisitor(
    secret,
    request.headers.get('cookie'),
    now,
  );
  const user = await getChatGPTUser();
  const subjects: { kind: 'visitor' | 'user'; hash: string }[] = [
    {
      kind: 'visitor',
      hash: await activityHash(secret, 'visitor', day, visitor.id),
    },
  ];
  if (user?.userId)
    subjects.push({
      kind: 'user',
      hash: await activityHash(secret, 'user', day, user.userId),
    });
  const db = database();
  // D1 and the PostgreSQL adapter execute this batch atomically, including duplicate races.
  await db.batch(
    subjects.map((subject) =>
      db
        .prepare(
          'INSERT OR IGNORE INTO activity_daily(day,kind,subjectHash) VALUES (?,?,?)',
        )
        .bind(day, subject.kind, subject.hash),
    ),
  );
  return visitor.setCookie;
}

function unavailable(
  status: DeveloperActivity['status'],
  now: number,
): DeveloperActivity {
  const today = Math.floor(now / ACTIVITY_DAY_MS) * ACTIVITY_DAY_MS;
  return {
    status,
    timezone: 'UTC',
    collectedSince: null,
    visitorsToday: null,
    dailyActiveUsersToday: null,
    days:
      status === 'ready'
        ? Array.from({ length: 14 }, (_, index) => ({
            day: activityDay(today - (13 - index) * ACTIVITY_DAY_MS),
            visitors: null,
            activeUsers: null,
          }))
        : [],
  };
}

function count(value: unknown): number {
  if (
    typeof value !== 'number' &&
    typeof value !== 'bigint' &&
    !(typeof value === 'string' && /^\d+$/.test(value))
  )
    throw new Error('Invalid activity count.');
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0)
    throw new Error('Invalid activity count.');
  return numeric;
}

export async function readDeveloperActivity(
  now: number,
): Promise<DeveloperActivity> {
  if (!configuredSecret()) return unavailable('not-configured', now);
  try {
    const result = unavailable('ready', now);
    // A single snapshot: one indexed earliest-day lookup and an aggregate bounded to 14 days.
    const rows = await all(
      `SELECT
      (SELECT day FROM activity_daily WHERE day<=?1 ORDER BY day ASC LIMIT 1) AS collectedSince,
      counts.day,counts.kind,counts.count
      FROM (SELECT 1 AS singleton) singleton LEFT JOIN (
        SELECT day,kind,COUNT(*) AS count FROM activity_daily WHERE day>=?2 AND day<=?1 GROUP BY day,kind
      ) counts ON 1=1`,
      activityDay(now),
      result.days[0].day,
    );
    const earliest = rows[0]?.collectedSince;
    if (earliest === null) {
      const today = result.days[result.days.length - 1];
      today.visitors = today.activeUsers = 0;
      result.visitorsToday = result.dailyActiveUsersToday = 0;
      return result;
    }
    if (
      typeof earliest !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(earliest) ||
      activityDay(Date.parse(earliest + 'T00:00:00Z')) !== earliest ||
      earliest > activityDay(now)
    )
      throw new Error('Invalid collection day.');
    result.collectedSince = earliest;
    for (const day of result.days) {
      if (day.day >= earliest) {
        day.visitors = 0;
        day.activeUsers = 0;
      }
    }
    for (const row of rows) {
      if (row.day === null && row.kind === null && row.count === null) continue;
      const day = result.days.find((entry) => entry.day === row.day);
      if (!day || day.day < earliest || !['visitor', 'user'].includes(row.kind))
        throw new Error('Invalid activity day.');
      if (row.kind === 'visitor') day.visitors = count(row.count);
      else day.activeUsers = count(row.count);
    }
    const today = result.days[result.days.length - 1];
    result.visitorsToday = today.visitors;
    result.dailyActiveUsersToday = today.activeUsers;
    return result;
  } catch {
    return unavailable('unavailable', now);
  }
}
