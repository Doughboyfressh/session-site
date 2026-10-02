import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AutomationEditor from '@/app/automation-editor';
import type { MixerTrack } from '@/lib/audio';
import '@/app/globals.css';
import '@/app/advanced.css';

const original: MixerTrack = {
  id: 'fixture-automation',
  name: 'Fixture automation',
  volume: 0.8,
  pan: 0,
  muted: false,
  solo: false,
  offset: 0,
  trimStart: 0,
  trimEnd: 0,
  low: 0,
  mid: 0,
  high: 0,
  automationLanes: {
    volume: [
      { time: 1, value: 0.8 },
      { time: 6, value: 1.2 },
    ],
  },
};
type Interruption = 'none' | 'unmount' | 'disabled' | 'track' | 'capture';

function Fixture() {
  const [track, setTrack] = useState(original);
  const [shown, setShown] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [armed, setArmed] = useState<Interruption>('none');
  const [active, setActive] = useState(false);
  const [commits, setCommits] = useState(0);
  const [generation, setGeneration] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const pointer = useRef(0);
  return (
    <main style={{ padding: 20, maxWidth: 1080, margin: 'auto' }}>
      <h1>Automation gesture fixture</h1>
      <p>
        Arm an interruption, then press either automation point. These controls
        use synthetic local data.
      </p>
      <nav className="actions" aria-label="Automation fixture controls">
        <button
          className="button secondary"
          onClick={() => setArmed('unmount')}
        >
          Unmount during next gesture
        </button>
        <button
          className="button secondary"
          onClick={() => setArmed('disabled')}
        >
          Disable during next gesture
        </button>
        <button className="button secondary" onClick={() => setArmed('track')}>
          Replace track during next gesture
        </button>
        <button
          className="button secondary"
          onClick={() => setArmed('capture')}
        >
          Lose capture during next gesture
        </button>
        <button
          className="button primary"
          onClick={() => {
            setArmed('none');
            setTrack(structuredClone(original));
            setShown(true);
            setDisabled(false);
            setGeneration((current) => current + 1);
            setCommits(0);
          }}
        >
          Reset editor
        </button>
      </nav>
      <div className="actions" style={{ margin: '20px 0' }}>
        <output aria-label="Armed interruption">Armed: {armed}</output>
        <output aria-label="Gesture activity">
          Gesture: {active ? 'active' : 'inactive'}
        </output>
        <output aria-label="Automation commits">Commits: {commits}</output>
        <output aria-label="Editor state">
          Editor: {shown ? (disabled ? 'disabled' : 'ready') : 'unmounted'}
        </output>
        <output aria-label="Current track">Track: {track.id}</output>
      </div>
      <div
        ref={host}
        onPointerDownCapture={(event) => {
          pointer.current = event.pointerId;
        }}
      >
        {shown && (
          <AutomationEditor
            key={generation}
            track={track}
            length={8}
            bpm={120}
            position={0}
            disabled={disabled}
            onGestureActivity={(next) => {
              setActive(next);
              if (!next) return;
              setArmed('none');
              if (armed === 'unmount') setShown(false);
              if (armed === 'disabled') setDisabled(true);
              if (armed === 'track')
                setTrack({ ...original, id: 'replacement-automation' });
              if (armed === 'capture') {
                const graph =
                  host.current?.querySelector<SVGSVGElement>(
                    '.automation-graph',
                  );
                if (graph?.hasPointerCapture(pointer.current))
                  graph.releasePointerCapture(pointer.current);
              }
            }}
            onChange={(patch) => {
              setCommits((current) => current + 1);
              setTrack((current) => ({ ...current, ...patch }));
            }}
          />
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
