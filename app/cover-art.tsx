'use client';

/**
 * Deterministic generated cover art for a track.
 * Concentric ring / disc composition in the red-pink-white family,
 * seeded by track id + title so every track gets its own stable look.
 * Pure DOM/CSS — no images.
 */

function seedFrom(text: string) {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++)
    seed = Math.imul(seed ^ text.charCodeAt(i), 16777619) >>> 0;
  return seed;
}

function random(seed: number) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const COVER_THEMES = [
  { core: '#ff2e43', ring: '#ff8091', wash: '#2b0d13' },
  { core: '#ff525f', ring: '#ffc2c9', wash: '#33121a' },
  { core: '#e7e2e4', ring: '#ff2e43', wash: '#241015' },
  { core: '#ff6d8c', ring: '#f4e9eb', wash: '#2d0f1c' },
  { core: '#d5223b', ring: '#ff9fae', wash: '#1f0b10' },
  { core: '#f4d7dc', ring: '#ff2e43', wash: '#2a1216' },
] as const;

export function coverTheme(seedText: string) {
  return COVER_THEMES[seedFrom(seedText) % COVER_THEMES.length];
}

export function coverWaveform(seedText: string, bars = 42) {
  const rng = random(seedFrom(seedText + '~wave')),
    values: number[] = [];
  for (let i = 0; i < bars; i++) {
    const swell = Math.sin((i / bars) * Math.PI * 2.2 + rng() * 0.6);
    values.push(
      Math.max(0.12, Math.min(1, 0.38 + 0.34 * swell + 0.34 * rng())),
    );
  }
  return values;
}

export default function CoverArt({
  seed,
  label,
  size = 160,
  spinning = false,
  className = '',
}: {
  seed: string;
  label?: string;
  size?: number;
  spinning?: boolean;
  className?: string;
}) {
  const rng = random(seedFrom(seed)),
    theme = coverTheme(seed),
    rings = 3 + Math.floor(rng() * 3),
    tilt = -8 + Math.floor(rng() * 16),
    cut = Math.floor(rng() * 4);
  const ringSizes = Array.from(
    { length: rings },
    (_, i) => 100 - i * (68 / Math.max(rings, 1)) - rng() * 8,
  );
  const words = (label || 'session').split(/\s+/).slice(0, 2);
  return (
    <div
      className={
        'cover-art' +
        (spinning ? ' spinning' : '') +
        (className ? ' ' + className : '')
      }
      style={
        {
          ...(size > 0 ? { '--cover-size': size + 'px' } : {}),
          '--cover-wash': theme.wash,
        } as React.CSSProperties
      }
      role="img"
      aria-label={label ? `Cover art for ${label}` : 'Cover art'}
    >
      <div
        className="cover-art-stage"
        style={{ transform: `rotate(${tilt}deg)` }}
      >
        {ringSizes.map((diameter, i) => (
          <span
            key={i}
            className="cover-art-ring"
            style={{
              width: diameter + '%',
              height: diameter + '%',
              borderColor:
                i === cut ? 'transparent' : i % 2 ? theme.ring : theme.core,
              opacity: 0.5 + (i / rings) * 0.5,
            }}
          />
        ))}
        <span className="cover-art-disc" style={{ background: theme.core }} />
        <span className="cover-art-gloss" />
      </div>
      {words.length > 0 && (
        <span className="cover-art-label">
          {words.map((w, i) => (
            <i key={i} style={{ fontStyle: i % 2 ? 'normal' : 'italic' }}>
              {w}
            </i>
          ))}
        </span>
      )}
    </div>
  );
}
