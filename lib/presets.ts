// Channel FX presets: a saved snapshot of a channel's EQ, live effects and the
// insert-effects chain. Built-in presets ship with the app; user presets are
// kept per-browser in localStorage and can be exported/imported as JSON to
// share. Applying a preset replaces the whole FX state (fields it omits reset),
// so results are predictable rather than additive.
import type { InsertFxSettings } from './effects';

export type FxSettings = {
  low?: number;
  mid?: number;
  high?: number;
  compression?: number;
  reverb?: number;
  delay?: number;
} & InsertFxSettings;

export type FxPreset = {
  name: string;
  settings: FxSettings;
  builtin?: boolean;
};

export const FX_FIELDS: (keyof FxSettings)[] = [
  'low',
  'mid',
  'high',
  'compression',
  'reverb',
  'delay',
  'drive',
  'driveType',
  'mod',
  'modType',
  'modRate',
  'limiter',
  'pump',
];

export const builtInPresets: FxPreset[] = [
  { name: 'Clean', builtin: true, settings: {} },
  {
    name: 'Warm Vocal',
    builtin: true,
    settings: { low: 1, high: 2, compression: 0.35, reverb: 0.18, drive: 0.12 },
  },
  {
    name: 'Radio Vocal',
    builtin: true,
    settings: { mid: 2, high: 3, compression: 0.55, limiter: 0.4, drive: 0.18 },
  },
  {
    name: 'Lo-fi Tape',
    builtin: true,
    settings: {
      high: -4,
      drive: 0.4,
      driveType: 'fuzz',
      mod: 0.25,
      modType: 'chorus',
      modRate: 0.2,
    },
  },
  {
    name: 'Wide Synth',
    builtin: true,
    settings: { mod: 0.5, modType: 'chorus', modRate: 0.35, reverb: 0.3 },
  },
  {
    name: 'Phaser Sweep',
    builtin: true,
    settings: { mod: 0.6, modType: 'phaser', modRate: 0.25 },
  },
  {
    name: 'Punchy Drums',
    builtin: true,
    settings: {
      compression: 0.5,
      limiter: 0.45,
      drive: 0.15,
      driveType: 'hard',
    },
  },
  {
    name: 'Sidechain Pump',
    builtin: true,
    settings: { pump: 0.6, compression: 0.3 },
  },
  {
    name: 'Dub Delay',
    builtin: true,
    settings: { delay: 0.45, reverb: 0.25, high: -2 },
  },
];

const KEY = 'session:fx-presets:v1';

export function cleanFxSettings(source: Record<string, unknown>): FxSettings {
  const out: Record<string, unknown> = {};
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new Error('This preset has invalid settings.');
  for (const k of FX_FIELDS) {
    const value = source[k];
    if (value === undefined || value === null) continue;
    const choices =
      k === 'driveType'
        ? ['soft', 'hard', 'fuzz']
        : k === 'modType'
          ? ['chorus', 'flanger', 'phaser']
          : null;
    const eq = ['low', 'mid', 'high'].includes(k);
    if (
      choices
        ? !choices.includes(value as string)
        : typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < (eq ? -12 : 0) ||
          value > (eq ? 12 : 1)
    )
      throw new Error('This preset has an invalid ' + k + ' setting.');
    out[k] = value;
  }
  return out as FxSettings;
}

// A patch that sets every FX field, using undefined to reset the ones a preset
// doesn't specify.
export function presetPatch(settings: FxSettings): Record<string, unknown> {
  const clean = cleanFxSettings(settings);
  const patch: Record<string, unknown> = {};
  for (const k of FX_FIELDS)
    patch[k] = clean[k] ?? (['low', 'mid', 'high'].includes(k) ? 0 : undefined);
  return patch;
}

export function loadUserPresets(): FxPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p) =>
          p &&
          typeof p.name === 'string' &&
          p.settings &&
          typeof p.settings === 'object',
      )
      .flatMap((p) => {
        try {
          return [
            {
              name: String(p.name).slice(0, 40),
              settings: cleanFxSettings(p.settings),
            },
          ];
        } catch {
          return [];
        }
      })
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function saveUserPreset(name: string, settings: FxSettings): FxPreset[] {
  name = name.trim().slice(0, 40);
  if (
    !name ||
    builtInPresets.some((p) => p.name.toLowerCase() === name.toLowerCase())
  )
    throw new Error(
      'Choose a preset name different from the built-in presets.',
    );
  const next = [
    ...loadUserPresets().filter((p) => p.name !== name),
    { name, settings: cleanFxSettings(settings) },
  ].slice(-100);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    throw new Error(
      'Your browser could not save the preset. Check its storage settings.',
    );
  }
  return next;
}

export function deleteUserPreset(name: string): FxPreset[] {
  const next = loadUserPresets().filter((p) => p.name !== name);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    throw new Error(
      'Your browser could not remove the preset. Check its storage settings.',
    );
  }
  return next;
}

export function exportPreset(preset: FxPreset): string {
  return JSON.stringify({
    name: preset.name,
    settings: cleanFxSettings(preset.settings),
  });
}

export function importPreset(json: string): FxPreset | null {
  try {
    const p = JSON.parse(json);
    if (!p || typeof p.name !== 'string' || !p.settings) return null;
    return {
      name: String(p.name).slice(0, 40),
      settings: cleanFxSettings(p.settings),
    };
  } catch {
    return null;
  }
}
