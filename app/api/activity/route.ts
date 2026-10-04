import { recordActivity } from '@/lib/activity-server';

function response(status: number, setCookie?: string | null) {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie, Origin',
      ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
    },
  });
}

export async function POST(request: Request) {
  // Bodyless, same-origin requests are the entire protocol. No caller-provided identity or content.
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return response(403);
  if (request.headers.has('content-type')) return response(415);
  const length = request.headers.get('content-length');
  if (length !== null && length !== '0') return response(400);
  const reader = request.body?.getReader();
  if (reader) {
    try {
      const { done, value } = await reader.read();
      if (!done || value?.byteLength) {
        await reader.cancel();
        return response(400);
      }
    } catch {
      return response(400);
    } finally {
      reader.releaseLock();
    }
  }
  try {
    return response(204, await recordActivity(request));
  } catch {
    return response(503);
  }
}
