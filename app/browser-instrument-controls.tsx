'use client';

import { useId } from 'react';
import {
  BROWSER_INSTRUMENTS,
  BROWSER_INSTRUMENT_PRESETS,
  BROWSER_PARAMETER_RANGES,
  validateBrowserInstrument,
  type BrowserInstrument,
} from '../lib/browser-instruments';

type ParameterName = keyof typeof BROWSER_PARAMETER_RANGES;
const controls: Record<
  ParameterName,
  { label: string; step: number; display: (value: number) => string }
> = {
  morph: { label: 'Harmonic morph', step: 0.01, display: percent },
  unison: { label: 'Unison voices', step: 1, display: (v) => String(v) },
  detune: { label: 'Unison detune', step: 1, display: (v) => `${v} cents` },
  spread: { label: 'Stereo spread', step: 0.01, display: percent },
  ratio: { label: 'FM ratio', step: 0.25, display: (v) => `${v.toFixed(2)} ×` },
  depth: { label: 'FM depth', step: 0.05, display: (v) => v.toFixed(2) },
  cutoff: {
    label: 'Filter cutoff',
    step: 10,
    display: (v) => `${Math.round(v)} Hz`,
  },
  resonance: { label: 'Filter resonance', step: 0.01, display: percent },
  attack: { label: 'Attack', step: 0.001, display: milliseconds },
  decay: { label: 'Decay', step: 0.001, display: milliseconds },
  sustain: { label: 'Sustain', step: 0.01, display: percent },
  release: { label: 'Release', step: 0.005, display: milliseconds },
  modulation: { label: 'Movement', step: 0.01, display: percent },
  rate: {
    label: 'Movement rate',
    step: 0.1,
    display: (v) => `${v.toFixed(1)} Hz`,
  },
  drive: { label: 'Drive', step: 0.01, display: percent },
  level: { label: 'Instrument level', step: 0.01, display: percent },
};
function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}
function milliseconds(value: number) {
  return `${Math.round(value * 1000)} ms`;
}

export type BrowserInstrumentControlsProps = {
  instrument: BrowserInstrument;
  onChange: (instrument: BrowserInstrument) => void;
  disabled?: boolean;
};

export function BrowserInstrumentControls({
  instrument,
  onChange,
  disabled = false,
}: BrowserInstrumentControlsProps) {
  const prefix = useId();
  const entry = BROWSER_INSTRUMENTS.find((item) => item.id === instrument.id)!;
  const presets = BROWSER_INSTRUMENT_PRESETS[instrument.id];
  const selected =
    presets.find((item) =>
      Object.entries(item.instrument.parameters).every(
        ([key, value]) =>
          value ===
          instrument.parameters[key as keyof typeof instrument.parameters],
      ),
    )?.id ?? '';
  const keys: ParameterName[] = [
    ...(instrument.id === 'session-wavetable'
      ? (['morph', 'unison', 'detune', 'spread'] as const)
      : (['ratio', 'depth'] as const)),
    'cutoff',
    'resonance',
    'attack',
    'decay',
    'sustain',
    'release',
    'modulation',
    'rate',
    'drive',
    'level',
  ];
  return (
    <section className="sample-controls" aria-label={`${entry.name} settings`}>
      <div className="section-title">
        <div>
          <h3>{entry.name}</h3>
          <p>{entry.description}</p>
        </div>
      </div>
      <fieldset
        disabled={disabled}
        style={{ border: 0, padding: 0, minWidth: 0 }}
      >
        <legend className="small-note">Sound and envelope</legend>
        <label className="field" htmlFor={`${prefix}-preset`}>
          <span>Instrument preset</span>
          <select
            id={`${prefix}-preset`}
            value={selected}
            onChange={(event) => {
              if (disabled) return;
              const preset = presets.find(
                (item) => item.id === event.target.value,
              );
              if (preset)
                onChange(validateBrowserInstrument(preset.instrument));
            }}
          >
            <option value="">Custom sound</option>
            {presets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
            gap: 14,
            marginTop: 14,
          }}
        >
          {keys.map((key) => {
            const setting = controls[key],
              [min, max] = BROWSER_PARAMETER_RANGES[key];
            const value =
              instrument.parameters[key as keyof typeof instrument.parameters];
            return (
              <label className="field" htmlFor={`${prefix}-${key}`} key={key}>
                <span>
                  {setting.label}{' '}
                  <output aria-hidden="true">· {setting.display(value)}</output>
                </span>
                <input
                  id={`${prefix}-${key}`}
                  aria-label={setting.label}
                  aria-valuetext={setting.display(value)}
                  type="range"
                  min={min}
                  max={max}
                  step={setting.step}
                  value={value}
                  onChange={(event) => {
                    if (disabled) return;
                    const next = Number(event.target.value);
                    if (next !== value)
                      onChange(
                        validateBrowserInstrument({
                          ...instrument,
                          parameters: { ...instrument.parameters, [key]: next },
                        }),
                      );
                  }}
                />
              </label>
            );
          })}
        </div>
      </fieldset>
      <p className="small-note">
        {instrument.id === 'session-wavetable'
          ? 'Morph moves from a clear sine through rounded harmonics to a bright wave. Movement sweeps the filter.'
          : 'Ratio tunes the second operator. Depth adds sidebands; Movement varies their intensity.'}{' '}
        Changes affect the next notes you play. Settings save with this project.
      </p>
    </section>
  );
}
export default BrowserInstrumentControls;
