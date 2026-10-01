import { createNeonAuth } from '@neondatabase/auth/next/server';
export function neonAuth() {
  if (!process.env.NEON_AUTH_BASE_URL || !process.env.NEON_AUTH_COOKIE_SECRET)
    throw new Error('Neon authentication is not configured.');
  return createNeonAuth({ baseUrl: process.env.NEON_AUTH_BASE_URL,
    cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET, sessionDataTtl: 1 } });
}
