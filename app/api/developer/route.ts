import { readDeveloperDashboard } from '@/lib/developer-metrics';

export async function GET(req: Request) {
  const started = performance.now();
  let status = 200;
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  try {
    return Response.json(await readDeveloperDashboard(req.url), { headers });
  } catch (error) {
    const requestedStatus = (error as { status?: unknown })?.status;
    status =
      requestedStatus === 401 ||
      requestedStatus === 403 ||
      requestedStatus === 400
        ? requestedStatus
        : 503;
    const message =
      status === 401
        ? 'Sign in to continue.'
        : status === 403
          ? 'Developer access is required.'
          : status === 400
            ? 'Invalid dashboard filters.'
            : 'Developer metrics are unavailable right now.';
    return Response.json({ error: message }, { status, headers });
  } finally {
    console.info(
      JSON.stringify({
        route: '/api/developer',
        status,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
      }),
    );
  }
}
