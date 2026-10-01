import { one } from '@/lib/server';

export const dynamic = 'force-dynamic';

type PageParams = { params: Promise<{ id: string }> | { id: string } };

async function resolveParams(params: PageParams['params']) {
  return typeof (params as Promise<{ id: string }>)?.then === 'function'
    ? await (params as Promise<{ id: string }>)
    : (params as { id: string });
}

async function load(id: string) {
  return one(
    `SELECT p.id,p.kind,p.fileId,p.caption,p.plays,p.created,
            COALESCE(pr.name,'Independent creator') AS creator,
            pr.username,
            (SELECT COUNT(*) FROM post_likes l WHERE l.post=p.id) AS likes,
            t.title AS trackTitle,t.id AS trackId
     FROM posts p LEFT JOIN profiles pr ON pr.id=p.owner
     LEFT JOIN tracks t ON t.id=p.track
     WHERE p.id=? AND p.visibility='public'`,
    id,
  );
}

export async function generateMetadata({ params }: PageParams) {
  const { id } = await resolveParams(params);
  const post = await load(String(id || ''));
  if (!post)
    return {
      title: 'Post · SESSION',
      description: 'Shared on SESSION — make something together.',
    };
  const title = `${post.creator} on SESSION`;
  const description = post.caption || `A ${post.kind} shared on SESSION.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      ...(post.kind === 'photo'
        ? { images: ['/api/file/' + post.fileId] }
        : {}),
    },
  };
}

export default async function PostPage({ params }: PageParams) {
  const { id } = await resolveParams(params);
  const post = await load(String(id || ''));
  if (!post)
    return (
      <main className="permalink">
        <div className="permalink-card">
          <h1>This post is private or unavailable.</h1>
          <p className="permalink-footnote">
            It may have been removed by its creator.
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
    <main className="permalink">
      <header className="permalink-top">
        <button
          className="permalink-brand"
          onClick={() => (window.location.href = '/')}
        >
          session<span>.</span>
        </button>
        <button
          className="button primary"
          onClick={() => (window.location.href = '/')}
        >
          Open in SESSION
        </button>
      </header>
      <article className="permalink-card">
        {post.kind === 'video' ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            className="permalink-video"
            controls
            playsInline
            preload="metadata"
            src={'/api/file/' + post.fileId}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="permalink-photo"
            src={'/api/file/' + post.fileId}
            alt={post.caption || 'Shared photo'}
          />
        )}
        <h1>
          {post.caption || (post.kind === 'video' ? 'A video' : 'A photo')}
        </h1>
        <p className="permalink-meta">
          by <strong>{post.creator}</strong>
          {post.username ? ` · @${post.username}` : ''}
        </p>
        <div className="permalink-stats">
          <span>♥ {post.likes}</span>
          {post.kind === 'video' && post.plays ? (
            <span>▶ {post.plays}</span>
          ) : null}
        </div>
        {post.trackTitle && (
          <p className="permalink-track">
            Made for <strong>{post.trackTitle}</strong>
          </p>
        )}
        <p className="permalink-footnote">
          SESSION connects artists, producers, engineers, and videographers —
          hear it, see it, then make something together.
        </p>
      </article>
    </main>
  );
}
