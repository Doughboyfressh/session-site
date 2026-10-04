export const ACTIVITY_COOKIE = '__Host-session_activity';
export const ACTIVITY_DAY_MS = 86400000;
const encoder = new TextEncoder();
const cookiePattern =
  /^v1\.(\d{4}-\d{2}-\d{2})\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{64})$/;

export function activityDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function activitySecret(configuration: {
  SESSION_ACTIVITY_SECRET?: unknown;
  NEON_AUTH_COOKIE_SECRET?: unknown;
}): string | null {
  const secret =
    configuration.SESSION_ACTIVITY_SECRET === undefined ||
    configuration.SESSION_ACTIVITY_SECRET === ''
      ? configuration.NEON_AUTH_COOKIE_SECRET
      : configuration.SESSION_ACTIVITY_SECRET;
  return typeof secret === 'string' && secret.length >= 32 ? secret : null;
}

async function key(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

function message(
  domain: 'cookie' | 'visitor' | 'user',
  day: string,
  subject: string,
) {
  return encoder.encode(`SESSION:activity:v1:${domain}:${day}:${subject}`);
}

export async function activityHash(
  secret: string,
  kind: 'visitor' | 'user',
  day: string,
  subject: string,
) {
  return hex(
    await crypto.subtle.sign(
      'HMAC',
      await key(secret),
      message(kind, day, subject),
    ),
  );
}

export async function activityVisitor(
  secret: string,
  cookieHeader: string | null,
  now: number,
) {
  const day = activityDay(now);
  const cookies = (cookieHeader || '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(ACTIVITY_COOKIE + '='));
  const value =
    cookies.length === 1 ? cookies[0].slice(ACTIVITY_COOKIE.length + 1) : '';
  const parsed = cookiePattern.exec(value);
  if (parsed && parsed[1] === day) {
    const signature = Uint8Array.from(parsed[3].match(/../g)!, (byte) =>
      parseInt(byte, 16),
    );
    if (
      await crypto.subtle.verify(
        'HMAC',
        await key(secret),
        signature,
        message('cookie', day, parsed[2]),
      )
    )
      return { id: parsed[2], setCookie: null };
  }
  const id = crypto.randomUUID();
  const signature = hex(
    await crypto.subtle.sign(
      'HMAC',
      await key(secret),
      message('cookie', day, id),
    ),
  );
  const midnight = (Math.floor(now / ACTIVITY_DAY_MS) + 1) * ACTIVITY_DAY_MS;
  return {
    id,
    setCookie: `${ACTIVITY_COOKIE}=v1.${day}.${id}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.ceil((midnight - now) / 1000)}; Expires=${new Date(midnight).toUTCString()}`,
  };
}
