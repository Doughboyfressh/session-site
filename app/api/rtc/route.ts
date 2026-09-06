import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { roomAccess, fail, limit } from '@/lib/server';
export async function GET(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) fail('Sign in to check your connection.', 401);
    const id = new URL(req.url).searchParams.get('room');
    if (id) await roomAccess(id, user.userId);
    await limit(user.userId, 'turn', 12);
    const vars = env as unknown as Record<string, string>;
    const key = vars.CLOUDFLARE_TURN_KEY_ID,
      token = vars.CLOUDFLARE_TURN_API_TOKEN;
    if (!key || !token)
      return Response.json(
        {
          iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
          relay: false,
          expires: Date.now() + 3600000,
          message: 'Cloudflare TURN credentials have not been connected.',
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    if (!id)
      return Response.json(
        {
          relay: true,
          configured: true,
          iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
          message: 'Join a room to obtain temporary relay credentials.',
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    const r = await fetch(
      'https://rtc.live.cloudflare.com/v1/turn/keys/' +
        encodeURIComponent(key) +
        '/credentials/generate-ice-servers',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: 14400 }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!r.ok)
      fail(
        'Cloudflare relay credentials could not be issued. Try again shortly.',
        503,
      );
    const j = (await r.json()) as any;
    const iceServers = Array.isArray(j.iceServers)
      ? j.iceServers
      : j.iceServers
        ? [j.iceServers]
        : [];
    if (!iceServers.length)
      fail('Cloudflare did not return relay servers.', 503);
    return Response.json(
      { iceServers, relay: true, expires: Date.now() + 14000000 },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e: any) {
    return Response.json(
      { error: e.status ? e.message : 'Connection configuration unavailable.' },
      { status: e.status || 503 },
    );
  }
}
