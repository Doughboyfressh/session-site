import { getChatGPTUser } from '@/app/chatgpt-auth';
import { all, one } from '@/lib/server';
import { stripeConfigured } from '@/lib/stripe-server';
export async function GET() {
  try {
    const user = await getChatGPTUser(),
      id = user?.userId || '';
    const [
      profile,
      tracks,
      profiles,
      projects,
      rooms,
      saved,
      follows,
      unreadNotifications,
      stripeAccount,
      orders,
    ] = await Promise.all([
      one('SELECT * FROM profiles WHERE id=?', id),
      all(
        "SELECT t.*,COALESCE(p.name,'Independent creator') AS creator,(SELECT COUNT(*) FROM saved s WHERE s.track=t.id) AS likes FROM tracks t LEFT JOIN profiles p ON p.id=t.owner AND (p.visibility='public' OR p.id=?) WHERE t.visibility='public' OR t.owner=? ORDER BY t.created DESC,t.id ASC LIMIT 200",
        id,
        id,
      ),
      all(
        "SELECT p.*,(SELECT COUNT(*) FROM follows f WHERE f.target=p.id) AS followers,(SELECT COALESCE(MAX(chargesEnabled),0) FROM stripe_accounts a WHERE a.user=p.id) AS chargesEnabled FROM profiles p WHERE p.visibility='public' ORDER BY p.created DESC LIMIT 100",
      ),
      all(
        "SELECT id,title,updated,revision,forkedFrom,json_extract(data,'$.bpm') AS bpm,json_array_length(data,'$.tracks') AS trackCount FROM projects WHERE owner=? ORDER BY updated DESC LIMIT 100",
        id,
      ),
      all(
        'SELECT r.id,r.owner,r.title,r.project,r.created,(SELECT COUNT(*) FROM members x WHERE x.room=r.id AND x.seen>?) AS active FROM rooms r JOIN members m ON m.room=r.id WHERE m.user=? ORDER BY r.created DESC LIMIT 50',
        Date.now() - 30000,
        id,
      ),
      all('SELECT track FROM saved WHERE user=?', id),
      all('SELECT target FROM follows WHERE user=?', id),
      one(
        'SELECT COUNT(*) AS count FROM notifications WHERE user=? AND readAt IS NULL',
        id,
      ),
      one(
        'SELECT accountId, chargesEnabled, payoutsEnabled FROM stripe_accounts WHERE user=?',
        id,
      ),
      all(
        'SELECT id,kind,track,seller,buyer,serviceSnapshot,amountCents,feeCents,currency,status,created FROM orders WHERE buyer=? OR seller=? ORDER BY created DESC LIMIT 60',
        id,
        id,
      ),
    ]);
    return Response.json(
      {
        profile,
        tracks,
        profiles,
        projects,
        rooms,
        saved: saved.map((s) => s.track),
        follows: follows.map((f) => f.target),
        unreadNotifications: Number(unreadNotifications?.count || 0),
        payments: {
          configured: stripeConfigured(),
          chargesEnabled: !!stripeAccount?.chargesEnabled,
          payoutsEnabled: !!stripeAccount?.payoutsEnabled,
        },
        orders,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    console.error('State load failed', e);
    return Response.json(
      { error: 'Your workspace could not load. Please try again.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
