'use client';

/**
 * Deterministic generated cover art for a track.
 * Two variants, both pure DOM/CSS:
 *  - 'disc'   a dimensional vinyl disc (grooves, sweeping specular, tilt)
 *  - 'sleeve' an album sleeve with the vinyl peeking out — used in the feed
 * Seeded by track id + title so every track gets its own stable look.
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
  { core: '#d11a33', ring: '#ffffff', wash: '#171416', deep: '#0f0e0f' },
  { core: '#e9e9ec', ring: '#d11a33', wash: '#141314', deep: '#0d0c0d' },
  { core: '#ffffff', ring: '#8e8e93', wash: '#181718', deep: '#101010' },
  { core: '#d11a33', ring: '#ffb3bb', wash: '#1a1416', deep: '#100c0d' },
  { core: '#b01528', ring: '#e7e2e4', wash: '#171314', deep: '#0e0c0d' },
  { core: '#c9c9cc', ring: '#d11a33', wash: '#161415', deep: '#0f0e0f' },
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
  size = 0,
  spinning = false,
  className = '',
  variant = 'disc',
}: {
  seed: string;
  label?: string;
  size?: number;
  spinning?: boolean;
  className?: string;
  variant?: 'disc' | 'sleeve';
}) {
  const rng = random(seedFrom(seed)),
    theme = coverTheme(seed),
    rings = 3 + Math.floor(rng() * 3),
    cut = Math.floor(rng() * rings),
    tilt = -10 + Math.floor(rng() * 20),
    sleeveAngle = Math.floor(rng() * 360),
    words = (label || 'session').split(/\s+/).slice(0, 2);
  const ringSizes = Array.from(
    { length: rings },
    (_, i) => 100 - i * (64 / Math.max(rings, 1)) - rng() * 7,
  );

  const disc = (
    <div className="cover-disc">
      <span
        className="cover-disc-grooves"
        style={
          {
            '--disc-core': theme.core,
            '--disc-ring': theme.ring,
            '--disc-deep': theme.deep,
          } as React.CSSProperties
        }
      >
        {ringSizes.map((diameter, i) => (
          <span
            key={i}
            className="cover-disc-ring"
            style={{
              width: diameter + '%',
              height: diameter + '%',
              borderColor:
                i === cut ? 'transparent' : i % 2 ? theme.ring : theme.core,
              opacity: 0.42 + (i / rings) * 0.5,
            }}
          />
        ))}
        <span className="cover-disc-shine" />
        <span className="cover-disc-label">
          <i>{words[0] || ''}</i>
          {words[1] && <i>{words[1]}</i>}
        </span>
      </span>
    </div>
  );

  return (
    <div
      className={
        'cover-art cover-' +
        variant +
        (spinning ? ' spinning' : '') +
        (className ? ' ' + className : '')
      }
      style={
        {
          ...(size > 0 ? { '--cover-size': size + 'px' } : {}),
          '--cover-wash': theme.wash,
          '--cover-deep': theme.deep,
          '--cover-core': theme.core,
          '--sleeve-angle': sleeveAngle + 'deg',
          '--cover-tilt': tilt + 'deg',
        } as React.CSSProperties
      }
      role="img"
      aria-label={label ? `Cover art for ${label}` : 'Cover art'}
    >
      {variant === 'sleeve' ? (
        <>
          <div className="cover-sleeve-panel">
            <span className="cover-sleeve-emblem">
              {(label || 's')[0]?.toUpperCase()}
            </span>
            <span className="cover-sleeve-title">
              {words.map((w, i) => (
                <i key={i}>{w}</i>
              ))}
            </span>
            <span className="cover-sleeve-hairline" />
          </div>
          <div className="cover-sleeve-disc">{disc}</div>
        </>
      ) : (
        <>
          <span className="cover-ground" />
          <div className="cover-tilt">{disc}</div>
          <span className="cover-gloss" />
        </>
      )}
    </div>
  );
}
