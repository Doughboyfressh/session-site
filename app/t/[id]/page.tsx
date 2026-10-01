import { one, all } from '@/lib/server';
import TrackPermalink from '@/app/track-permalink';

export const dynamic = 'force-dynamic';

type PageParams = { params: Promise<{ id: string }> };

async function resolveParams(params: PageParams['params']) {
  return await params;
}

async function load(id: string) {
  const track = await one(
    `SELECT t.*,COALESCE(p.name,'Independent creator') AS creator,
            (SELECT COUNT(*) FROM saved s WHERE s.track=t.id) AS likes,
            (SELECT COUNT(*) FROM comments c WHERE c.track=t.id) AS comments
     FROM tracks t LEFT JOIN profiles p ON p.id=t.owner
     WHERE t.id=? AND t.visibility='public'`,
    id,
  );
  if (!track) return null;
  const [creator, comments] = await Promise.all([
    one('SELECT id,name,username,avatar FROM profiles WHERE id=?', track.owner),
    all(
      `SELECT c.id,c.body,COALESCE(p.name,'SESSION member') AS name
       FROM comments c LEFT JOIN profiles p ON p.id=c.user
       WHERE c.track=? ORDER BY c.created DESC LIMIT 20`,
      track.id,
    ),
  ]);
  return { track, creator, comments };
}

export async function generateMetadata({ params }: PageParams) {
  const { id } = await resolveParams(params);
  const data = await load(String(id || ''));
  if (!data)
    return {
      title: 'Track · SESSION',
      description: 'Music on SESSION — make something together.',
    };
  return {
    title: `${data.track.title} · SESSION`,
    description: `${data.track.title} by ${data.track.creator} — ${data.track.genre}. Listen, connect, and create on SESSION.`,
    openGraph: {
      title: `${data.track.title} · SESSION`,
      description: `${data.track.title} by ${data.track.creator}`,
      images: ['/session-hero.png'],
    },
  };
}

export default async function TrackPage({ params }: PageParams) {
  const { id } = await resolveParams(params);
  const data = await load(String(id || ''));
  if (!data)
    return (
      <main className="permalink">
        <div className="permalink-card">
          <h1>This track is private or unavailable.</h1>
          <p className="permalink-footnote">
            It may have been taken down or made private by its creator.
          </p>
          <form action="/" style={{ margin: 0 }}>
            <button className="button primary" type="submit">
              Explore SESSION
            </button>
          </form>
        </div>
      </main>
    );
  return (
    <TrackPermalink
      track={data.track}
      creator={data.creator}
      comments={data.comments}
      likes={Number(data.track.likes || 0)}
    />
  );
}
