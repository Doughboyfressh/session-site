'use client';
import { ArrowUpRight } from 'lucide-react';
import Scene3D from './scene-3d';

export default function FeedHero({ onStart }: { onStart: () => void }) {
  return (
    <section className="feed-hero">
      <div className="feed-hero-copy">
        <span className="pill">
          <span className="status-dot" /> THE MUSIC COMMUNITY
        </span>
        <h2>
          Your music world
          <br />
          <em>lives here.</em>
        </h2>
        <p>
          Sounds from people you follow, rooms happening now, and the next thing
          you&apos;ll wish you made.
        </p>
        <button className="button primary" onClick={onStart}>
          Start a session <ArrowUpRight size={17} />
        </button>
      </div>
      <Scene3D
        variant="hero"
        label="Animated 3D equalizer with glowing red pillars"
      />
    </section>
  );
}
