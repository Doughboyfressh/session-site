import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import FeedHero from '@/app/feed-hero';
import Scene3D from '@/app/scene-3d';
import '@/app/globals.css';

const params = new URLSearchParams(location.search);
const preference = Object.assign(new EventTarget(), {
  matches: params.get('motion') === 'reduce',
  media: '(prefers-reduced-motion: reduce)',
});
const nativeMatchMedia = window.matchMedia.bind(window);
window.matchMedia = (query) =>
  query === preference.media
    ? (preference as MediaQueryList)
    : nativeMatchMedia(query);
if (params.get('webgl') === 'off') {
  // oxlint-disable-next-line typescript/unbound-method -- The preserved method is invoked with its canvas via call().
  const nativeContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    kind: string,
    options?: unknown,
  ) {
    if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl')
      return null;
    return nativeContext.call(
      this,
      kind as '2d',
      options as CanvasRenderingContext2DSettings,
    );
  } as typeof nativeContext;
}

function Fixture() {
  const [reduced, setReduced] = useState(preference.matches);
  const [generation, setGeneration] = useState(0);
  const [shown, setShown] = useState(true);
  const [notice, setNotice] = useState('');
  return (
    <>
      <nav
        aria-label="Scene fixture controls"
        style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 12 }}
      >
        <label>
          <input
            type="checkbox"
            checked={reduced}
            onChange={(event) => {
              preference.matches = event.target.checked;
              setReduced(preference.matches);
              preference.dispatchEvent(new Event('change'));
            }}
          />{' '}
          Reduced motion
        </label>
        <button
          className="button secondary"
          onClick={() => setGeneration((value) => value + 1)}
        >
          Remount scenes
        </button>
        <button
          className="button secondary"
          onClick={() => setShown((value) => !value)}
        >
          {shown ? 'Unmount scenes' : 'Mount scenes'}
        </button>
        <button
          className="button secondary"
          onClick={() =>
            document
              .querySelectorAll('.scene-3d canvas')
              .forEach((canvas) =>
                canvas.dispatchEvent(
                  new Event('webglcontextlost', { cancelable: true }),
                ),
              )
          }
        >
          Simulate context loss
        </button>
      </nav>
      <output aria-label="Scene notice">{notice}</output>
      {shown && (
        <main key={generation}>
          <div className="feed">
            <FeedHero onStart={() => setNotice('Studio entry invoked')} />
          </div>
          <div
            className="studio-visualizer"
            style={{ maxWidth: 380, margin: '20px auto' }}
          >
            <Scene3D
              variant="visualizer"
              label="Fixture Studio spectrum"
              getSpectrum={() =>
                Array.from(
                  { length: 24 },
                  (_, i) => 0.5 + Math.sin(i * 0.5) * 0.45,
                )
              }
            />
          </div>
        </main>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
