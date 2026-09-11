'use client';
import type { InputHTMLAttributes } from 'react';
import type { MixerRouting, MixerGroup } from '@/lib/mixer-routing';

export default function GroupMixer({
  routing,
  levels,
  disabled,
  onChange,
  gesture,
  onGestureStart,
  onGestureEnd,
}: {
  routing: MixerRouting;
  levels: Record<string, number>;
  disabled: boolean;
  onChange: (next: MixerRouting) => void;
  gesture: InputHTMLAttributes<HTMLInputElement>;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  const patch = (id: string, values: Partial<MixerGroup>) =>
    onChange({
      ...routing,
      groups: routing.groups.map((g) =>
        g.id === id ? { ...g, ...values } : g,
      ),
    });
  return (
    <section className="group-mixer" aria-label="Groups and shared effects">
      <div className="section-title">
        <div>
          <h2>Shape the whole session.</h2>
          <p>Route channels into a group, then balance them together.</p>
        </div>
      </div>
      <div className="mixer-channels">
        {routing.groups.map((group, index) => (
          <section
            className={'mix-channel tint-' + index}
            key={group.id}
            aria-label={group.name + ' group'}
          >
            <span className="tiny-label">GROUP {index + 1}</span>
            <input
              className="group-name"
              aria-label={'Group ' + (index + 1) + ' name'}
              value={group.name}
              maxLength={40}
              disabled={disabled}
              onFocus={onGestureStart}
              onBlur={onGestureEnd}
              onChange={(e) => patch(group.id, { name: e.target.value })}
            />
            <div className="mix-switches">
              <button
                disabled={disabled}
                aria-label={'Mute ' + group.name + ' group'}
                aria-pressed={group.muted}
                onClick={() => patch(group.id, { muted: !group.muted })}
              >
                Mute
              </button>
              <button
                disabled={disabled}
                aria-label={'Solo ' + group.name + ' group'}
                aria-pressed={group.solo}
                onClick={() => patch(group.id, { solo: !group.solo })}
              >
                Solo
              </button>
            </div>
            <label className="mix-pan">
              Pan{' '}
              <output>
                {group.pan === 0
                  ? 'Center'
                  : `${Math.round(Math.abs(group.pan) * 100)}${group.pan < 0 ? 'L' : 'R'}`}
              </output>
              <input
                {...gesture}
                type="range"
                aria-label={group.name + ' group pan'}
                min={-1}
                max={1}
                step={0.01}
                value={group.pan}
                disabled={disabled}
                onChange={(e) => patch(group.id, { pan: +e.target.value })}
              />
            </label>
            <div className="mix-fader-row">
              <input
                {...gesture}
                type="range"
                className="mix-fader"
                aria-label={group.name + ' group volume'}
                min={0}
                max={1.5}
                step={0.01}
                value={group.volume}
                disabled={disabled}
                onChange={(e) => patch(group.id, { volume: +e.target.value })}
              />
              <meter
                className="channel-meter"
                aria-label={group.name + ' group peak'}
                min={0}
                max={1}
                value={Math.min(1, levels['group:' + group.id] || 0)}
              />
            </div>
            <output className="mix-volume">
              {Math.round(group.volume * 100)}%{' '}
              <span>
                {group.volume
                  ? (20 * Math.log10(group.volume)).toFixed(1) + ' dB'
                  : '−∞ dB'}
              </span>
            </output>
            <span className="small-note">To Main + channel sends</span>
          </section>
        ))}
      </div>
      <div className="shared-returns">
        {(['reverb', 'delay'] as const).map((key) => (
          <section key={key} aria-label={'Shared ' + key + ' return'}>
            <span className="tiny-label">SHARED EFFECT</span>
            <h3>{key === 'reverb' ? 'Room reverb' : 'Echo delay'}</h3>
            <p>
              {key === 'reverb'
                ? 'A 1.6-second room shared by your channels.'
                : 'A 250 ms echo shared by your channels.'}
            </p>
            <label className="mix-pan">
              Return level <output>{Math.round(routing[key] * 100)}%</output>
              <input
                {...gesture}
                type="range"
                aria-label={'Shared ' + key + ' level'}
                min={0}
                max={1.5}
                step={0.01}
                value={routing[key]}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...routing, [key]: +e.target.value })
                }
              />
            </label>
            <meter
              aria-label={'Shared ' + key + ' peak'}
              min={0}
              max={1}
              value={Math.min(1, levels['return:' + key] || 0)}
            />
          </section>
        ))}
      </div>
      <p className="small-note">
        Sends follow channel effects, automation, volume and group level/pan.
        Mute stops new sends; shared effect tails can finish. Set a return to 0%
        to silence that effect. Group meters show grouped channels before shared
        returns. Groups do not route into other groups.
      </p>
    </section>
  );
}
