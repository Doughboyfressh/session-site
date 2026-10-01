'use client';
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Heart, MessageCircle } from 'lucide-react';
import CoverArt from './cover-art';
import { context, trackFrom, bufferFor, playMix } from '@/lib/audio';
import {
  originalArrangement,
  originalFor,
  originalBars,
} from '@/lib/originals';

type PermalinkTrack = {
  id: string;
  title: string;
  bpm: number;
  genre?: string;
  musicalKey?: string;
  plays?: number;
  price?: number | null;
  [key: string]: unknown;
};
type PermalinkCreator = { name?: string; username?: string } | null;
type PermalinkComment = { id: string; body: string; name?: string };

export default function TrackPermalink({
  track,
  creator,
  comments,
  likes,
}: {
  track: PermalinkTrack;
  creator: PermalinkCreator;
  comments: PermalinkComment[];
  likes: number;
}) {
  const [isPlaying, setIsPlaying] = useState(false),
    [busy, setBusy] = useState(false),
    playback = useRef<{
      stop: () => void;
    } | null>(null),
    seq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      seq.current++;
      abort.current?.abort();
      playback.current?.stop();
    },
    [],
  );
  async function toggle() {
    if (isPlaying) {
      playback.current?.stop();
      playback.current = null;
      setIsPlaying(false);
      return;
    }
    const mySeq = ++seq.current;
    abort.current?.abort();
    playback.current?.stop();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      await context().resume();
      const score = originalArrangement(track.id, { preview: true });
      const mt = score ? null : trackFrom(track as never);
      if (mt) await bufferFor(mt, track.bpm, { signal: controller.signal });
      if (mySeq !== seq.current) return;
      const p = await playMix(
        score || { bpm: track.bpm, tracks: [mt!] },
        () => {
          setIsPlaying(false);
        },
        { signal: controller.signal },
      );
      if (mySeq !== seq.current) {
        p.stop();
        return;
      }
      playback.current = { stop: () => p.stop() };
      setIsPlaying(true);
      if (!track.demo)
        void fetch('/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'play', id: track.id }),
        }).catch(() => {});
    } catch {
      if (mySeq === seq.current && !controller.signal.aborted)
        window.location.href = '/?track=' + track.id;
    } finally {
      if (mySeq === seq.current) setBusy(false);
    }
  }
  const inApp = '/?track=' + track.id;
  const original = originalFor(track.id);
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
          onClick={() => (window.location.href = inApp)}
        >
          Open in SESSION
        </button>
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
          {track.musicalKey ? ` · ${track.musicalKey}` : ''}
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
        {original && (
          <>
            <p className="permalink-footnote">
              8-bar preview ·{' '}
              {Math.round((originalBars(original) * 4 * 60) / original.bpm)}{' '}
              second arrangement · editable drums and instruments
            </p>
            <a className="button secondary" href={inApp + '&view=Studio'}>
              Open full arrangement in Studio
            </a>
          </>
        )}
        {comments.length > 0 && (
          <section className="permalink-comments">
            <h2>What people are saying</h2>
            {comments.map((c) => (
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
