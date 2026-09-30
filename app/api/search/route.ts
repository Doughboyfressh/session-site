import { all, limit } from '@/lib/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';

export async function GET(req: Request) {
  try {
    // Authenticated members get their normal budget; guests share a
    // tightened per-IP bucket so the public endpoint can't be hammered.
    const user = await getChatGPTUser();
    if (user) await limit(user.userId, 'search', 240);
    else {
      const ip =
        req.headers.get('cf-connecting-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        'anonymous';
      await limit('search-ip:' + ip, 'search-ip', 60);
    }
    const url = new URL(req.url),
      q = (url.searchParams.get('q') || '').trim().slice(0, 80);
    if (q.length < 2) return Response.json({ tracks: [], profiles: [] });
    const like = '%' + q.toLowerCase().replace(/[%_]/g, '') + '%';
    const [tracks, profiles] = await Promise.all([
      all(
        `SELECT t.id,t.title,t.genre,t.bpm,t.kind,t.owner,t.plays,t.price,
                COALESCE(p.name,'Independent creator') AS creator
         FROM tracks t LEFT JOIN profiles p ON p.id=t.owner
         WHERE t.visibility='public'
           AND (LOWER(t.title) LIKE ?1 OR LOWER(t.genre) LIKE ?1 OR LOWER(COALESCE(p.name,'')) LIKE ?1)
         ORDER BY t.plays DESC, t.created DESC LIMIT 24`,
        like,
      ),
      all(
        `SELECT p.id,p.username,p.name,p.roles,p.bio,p.avatar,
                (SELECT COUNT(*) FROM follows f WHERE f.target=p.id) AS followers
         FROM profiles p
         WHERE p.visibility='public'
           AND (LOWER(p.name) LIKE ?1 OR LOWER(p.username) LIKE ?1 OR LOWER(p.bio) LIKE ?1)
         ORDER BY followers DESC LIMIT 16`,
        like,
      ),
    ]);
    return Response.json(
      { tracks, profiles },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'Search is unavailable right now.' },
      { status: 503 },
    );
  }
}
