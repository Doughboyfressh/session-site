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
      trending,
      liveRooms,
      pulse,
      mediaPosts,
    ] = await Promise.all([
      one('SELECT * FROM profiles WHERE id=?', id),
      all(
        "SELECT t.*,COALESCE(p.name,'Independent creator') AS creator,(SELECT COUNT(*) FROM saved s WHERE s.track=t.id) AS likes,(SELECT COUNT(*) FROM comments c WHERE c.track=t.id) AS comments FROM tracks t LEFT JOIN profiles p ON p.id=t.owner AND (p.visibility='public' OR p.id=?) WHERE t.visibility='public' OR t.owner=? ORDER BY t.created DESC,t.id ASC LIMIT 200",
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
      all(
        "SELECT t.id,t.title,t.genre,t.bpm,t.plays,t.price,COALESCE(p.name,'Independent creator') AS creator FROM tracks t LEFT JOIN profiles p ON p.id=t.owner WHERE t.visibility='public' AND t.plays>0 ORDER BY t.plays DESC,t.created DESC LIMIT 8",
      ),
      all(
        "SELECT r.id,r.title,r.owner,(SELECT COUNT(*) FROM members x WHERE x.room=r.id AND x.seen>?) AS active,(SELECT COUNT(*) FROM members x WHERE x.room=r.id) AS members FROM rooms r WHERE r.visibility='public' ORDER BY active DESC,r.created DESC LIMIT 10",
        Date.now() - 30000,
      ),
      one(
        `SELECT
           (SELECT COUNT(*) FROM tracks WHERE visibility='public') AS tracks,
           (SELECT COUNT(*) FROM profiles WHERE visibility='public') AS creators,
           (SELECT COUNT(*) FROM tracks WHERE visibility='public' AND created>?) AS tracksToday,
           (SELECT COUNT(*) FROM rooms WHERE visibility='public') AS publicRooms`,
        Date.now() - 86400000,
      ),
      all(
        `SELECT p.id,p.owner,p.kind,p.fileId,p.track,p.caption,p.plays,p.created,
                COALESCE(pr.name,'Independent creator') AS creator,
                pr.username,pr.avatar,
                (SELECT COUNT(*) FROM post_likes l WHERE l.post=p.id) AS likes,
                EXISTS(SELECT 1 FROM post_likes l WHERE l.post=p.id AND l.user=?) AS likedByMe,
                (SELECT t.title FROM tracks t WHERE t.id=p.track) AS trackTitle
         FROM posts p LEFT JOIN profiles pr ON pr.id=p.owner
         WHERE p.visibility='public' OR p.owner=?
         ORDER BY p.created DESC LIMIT 40`,
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
        trending,
        liveRooms,
        posts: mediaPosts,
        pulse: {
          tracks: Number(pulse?.tracks || 0),
          creators: Number(pulse?.creators || 0),
          tracksToday: Number(pulse?.tracksToday || 0),
          publicRooms: Number(pulse?.publicRooms || 0),
        },
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
