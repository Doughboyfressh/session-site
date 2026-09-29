'use client';
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Heart, MessageCircle } from 'lucide-react';
import CoverArt from './cover-art';
import { context, trackFrom, bufferFor, playMix } from '@/lib/audio';

export default function TrackPermalink({
  track,
  creator,
  comments,
  likes,
}: {
  track: any;
  creator: any;
  comments: any[];
  likes: number;
}) {
  const [isPlaying, setIsPlaying] = useState(false),
    [busy, setBusy] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [duration, setDuration] = useState(0),
    playback = useRef<any>(null),
    seq = useRef(0);
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      const p = playback.current;
      if (p?.position) setElapsed(p.position() - (p.seek || 0));
    }, 70);
    return () => clearInterval(timer);
  }, [isPlaying]);
  useEffect(() => () => playback.current?.stop(), []);
  async function toggle() {
    if (isPlaying) {
      playback.current?.stop();
      playback.current = null;
      setIsPlaying(false);
      setElapsed(0);
      return;
    }
    const mySeq = ++seq.current;
    setBusy(true);
    try {
      await context().resume();
      const mt = trackFrom(track);
      const b = await bufferFor(mt, track.bpm);
      if (mySeq !== seq.current) return;
      setDuration(b.duration);
      const p = await playMix({ bpm: track.bpm, tracks: [mt] }, () => {
        setIsPlaying(false);
        setElapsed(0);
      });
      if (mySeq !== seq.current) {
        p.stop();
        return;
      }
      playback.current = { ...p, seek: 0 };
      setIsPlaying(true);
      void fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'play', id: track.id }),
      }).catch(() => {});
    } catch {
      window.location.href = '/?track=' + track.id;
    } finally {
      setBusy(false);
    }
  }
  const inApp = '/?track=' + track.id;
  return (
    <main className="permalink">
      <header className="permalink-top">
        <a href="/" className="permalink-brand">
          session<span>.</span>
        </a>
        <a className="button primary" href={inApp}>
          Open in SESSION
        </a>
      </header>
      <article className="permalink-card">
        <button
          className="permalink-cover"
          onClick={() => void toggle()}
          aria-label={(isPlaying ? 'Pause ' : 'Play ') + track.title}
        >
          <CoverArt
            seed={track.id + track.title}
            label={track.title}
            size={0}
            className="cover-fill"
            variant="sleeve"
            spinning={isPlaying}
          />
          <span className="permalink-play">
            {busy ? '…' : isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </span>
        </button>
        <h1>{track.title}</h1>
        <p className="permalink-meta">
          by <strong>{creator?.name || 'Independent creator'}</strong>
          {creator?.username ? ` · @${creator.username}` : ''} · {track.genre} ·{' '}
          {track.bpm} BPM
        </p>
        <div className="permalink-stats">
          <span>
            <Heart size={14} /> {likes}
          </span>
          <span>
            <MessageCircle size={14} /> {comments.length}
          </span>
          {track.plays ? <span>▶ {track.plays}</span> : null}
          {track.price ? (
            <span className="chip price-chip">${track.price / 100}</span>
          ) : null}
        </div>
        <button
          className="button primary permalink-cta"
          onClick={() => void toggle()}
          disabled={busy}
        >
          {isPlaying ? 'Pause' : 'Play this track'}
        </button>
        {comments.length > 0 && (
          <section className="permalink-comments">
            <h2>What people are saying</h2>
            {comments.map((c: any) => (
              <div className="permalink-comment" key={c.id}>
                <strong>{c.name || 'SESSION member'}</strong>
                <p>{c.body}</p>
              </div>
            ))}
          </section>
        )}
        <p className="permalink-footnote">
          SESSION connects artists, producers, and engineers — hear it, then
          make something together.
        </p>
      </article>
    </main>
  );
}
