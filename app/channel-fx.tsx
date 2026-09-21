'use client';
import { useState } from 'react';
import type { MixerTrack } from '@/lib/audio';
import {
  DRIVE_TYPES,
  MOD_TYPES,
  type DriveType,
  type ModType,
} from '@/lib/effects';
import { Range, Pick } from './helpers';

import {
  builtInPresets,
  loadUserPresets,
  saveUserPreset,
  deleteUserPreset,
  presetPatch,
  cleanFxSettings,
  type FxPreset,
} from '@/lib/presets';

const pct = (n?: number) => Math.round((n || 0) * 100) + '%';
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// Saturation, modulation, dynamics and the preset picker for one channel.
// Rendered inside the studio channel strip; isolated so its preset state and
// localStorage access stay out of the main studio component.
export default function ChannelFx({
  track,
  onPatch,
  disabled,
}: {
  track: MixerTrack;
  onPatch: (id: string, patch: Partial<MixerTrack>) => void;
  disabled?: boolean;
}) {
  const [user, setUser] = useState<FxPreset[]>(() => loadUserPresets());
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');
  const patch = (p: Partial<MixerTrack>) => {
    if (!disabled) onPatch(track.id, p);
  };
  return (
    <>
      <div className="mixer-divider">SATURATION</div>
      <Range
        label={'Drive · ' + pct(track.drive)}
        value={track.drive || 0}
        onChange={(v) => patch({ drive: v })}
      />
      <Pick
        label="Character"
        value={track.driveType || 'soft'}
        onChange={(v) => patch({ driveType: v as DriveType })}
        options={DRIVE_TYPES.map((t) => ({ value: t, label: cap(t) }))}
      />

      <div className="mixer-divider">MODULATION</div>
      <Pick
        label="Type"
        value={track.modType || 'chorus'}
        onChange={(v) => patch({ modType: v as ModType })}
        options={MOD_TYPES.map((t) => ({ value: t, label: cap(t) }))}
      />
      <Range
        label={'Depth · ' + pct(track.mod)}
        value={track.mod || 0}
        onChange={(v) => patch({ mod: v })}
      />
      <Range
        label={'Rate · ' + pct(track.modRate)}
        value={track.modRate || 0}
        onChange={(v) => patch({ modRate: v })}
      />

      <div className="mixer-divider">DYNAMICS</div>
      <Range
        label={'Limiter · ' + pct(track.limiter)}
        value={track.limiter || 0}
        onChange={(v) => patch({ limiter: v })}
      />
      <Range
        label={'Sidechain pump · ' + pct(track.pump)}
        value={track.pump || 0}
        onChange={(v) => patch({ pump: v })}
      />

      {track.fileId && !track.sample && (
        <>
          <div className="mixer-divider">VOCAL</div>
          <Range
            label={'Denoise · ' + pct(track.denoise)}
            value={track.denoise || 0}
            onChange={(v) => patch({ denoise: v })}
          />
          <p className="muted">
            AutoPitch is being improved and is currently unavailable.
          </p>
          {!!track.autoPitch && (
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() => patch({ autoPitch: 0 })}
            >
              Turn off AutoPitch to play this track
            </button>
          )}{' '}
          <div className="mixer-divider">TIME &amp; PITCH</div>
          <Range
            label={'Pitch shift · ' + (track.pitchShift || 0) + ' st'}
            value={track.pitchShift || 0}
            min={-12}
            max={12}
            step={1}
            onChange={(v) => patch({ pitchShift: v })}
          />
          <Range
            label={'Stretch · ' + Math.round((track.stretch || 1) * 100) + '%'}
            value={track.stretch || 1}
            min={0.5}
            max={2}
            step={0.01}
            onChange={(v) => patch({ stretch: v })}
          />
        </>
      )}
      <div className="mixer-divider">FX PRESETS</div>
      <Pick
        label="Apply a preset"
        value={choice}
        onChange={(v) => {
          setChoice(v);
          const p = v.startsWith('user:')
            ? user.find((x) => x.name === v.slice(5))
            : builtInPresets.find((x) => x.name === v.slice(8));
          if (p) patch(presetPatch(p.settings) as Partial<MixerTrack>);
        }}
        options={[
          { value: '', label: 'Choose a preset…' },
          ...builtInPresets.map((p) => ({
            value: 'builtin:' + p.name,
            label: p.name,
          })),
          ...user.map((p) => ({
            value: 'user:' + p.name,
            label: p.name + ' (yours)',
          })),
        ]}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={() => {
            const name = window.prompt('Name this preset')?.trim();
            if (!name) return;
            const trimmed = name.slice(0, 40);
            try {
              setUser(saveUserPreset(trimmed, cleanFxSettings(track)));
              setChoice('user:' + trimmed);
              setError('');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Save current FX
        </button>
        {choice.startsWith('user:') &&
          user.some((p) => p.name === choice.slice(5)) && (
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() => {
                try {
                  setUser(deleteUserPreset(choice.slice(5)));
                  setChoice('');
                  setError('');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Delete “{choice.slice(5)}”
            </button>
          )}
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
