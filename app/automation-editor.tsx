'use client';

import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ClipboardPaste, Copy, Plus, Trash2 } from 'lucide-react';
import { Pick } from './helpers';
import type { MixerTrack } from '@/lib/audio';
import {
  AUTOMATION_SPECS,
  AUTOMATION_TARGETS,
  MAX_AUTOMATION_POINTS_PER_LANE,
  MAX_AUTOMATION_POINTS_PER_TRACK,
  activeAutomationTargets,
  automationLane,
  automationPointCount,
  clampAutomationValue,
  formatAutomationValue,
  sortedAutomation,
  type AutomationCurve,
  type AutomationPoint,
  type AutomationTarget,
} from '@/lib/automation';

type DragState = {
  trackId: string;
  target: AutomationTarget;
  pointerId: number;
  sourceIndex: number;
  source: AutomationPoint[];
  points: AutomationPoint[];
};

export default function AutomationEditor({
  track,
  length,
  bpm,
  position,
  disabled = false,
  onGestureActivity,
  onChange,
}: {
  track?: MixerTrack;
  length: number;
  bpm: number;
  position: number;
  disabled?: boolean;
  onGestureActivity?: (active: boolean) => void;
  onChange: (patch: Partial<MixerTrack>) => void;
}) {
  const [target, setTarget] = useState<AutomationTarget>('volume');
  const [snap, setSnap] = useState('0.25');
  const [time, setTime] = useState(0);
  const [value, setValue] = useState(1);
  const [curve, setCurve] = useState<AutomationCurve>('linear');
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [clipboard, setClipboard] = useState<{
    target: AutomationTarget;
    points: AutomationPoint[];
  } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const graph = useRef<SVGSVGElement>(null);

  if (!track)
    return (
      <div className="empty-state">
        Add and select a track to build automation lanes.
      </div>
    );

  const currentTrack = track;
  const spec = AUTOMATION_SPECS[target];
  const savedPoints = sortedAutomation(automationLane(currentTrack, target));
  const points =
    drag?.trackId === currentTrack.id && drag.target === target
      ? drag.points
      : savedPoints;
  const active = activeAutomationTargets(currentTrack);
  const selectedIndex = points.findIndex(
    (point) => point.time === selectedTime,
  );
  const selected = selectedIndex >= 0 ? points[selectedIndex] : undefined;
  const plot = { left: 88, right: 780, top: 24, bottom: 190 };
  const safeLength = Math.max(0.01, length);

  function xFor(at: number) {
    return (
      plot.left +
      (Math.max(0, Math.min(safeLength, at)) / safeLength) *
        (plot.right - plot.left)
    );
  }

  function yFor(level: number) {
    return (
      plot.bottom -
      ((level - spec.min) / (spec.max - spec.min || 1)) *
        (plot.bottom - plot.top)
    );
  }

  function targetDefault(next: AutomationTarget) {
    return clampAutomationValue(
      next,
      next === 'volume' ? 1 : Number(currentTrack[next] || 0),
    );
  }

  function snappedTime(raw: number) {
    const limited = Math.max(0, Math.min(safeLength, raw));
    if (snap === 'off') return Number(limited.toFixed(4));
    const step = (60 / bpm) * Number(snap);
    return Number(
      Math.max(
        0,
        Math.min(safeLength, Math.round(limited / step) * step),
      ).toFixed(4),
    );
  }

  function graphPoint(clientX: number, clientY: number) {
    const bounds = graph.current!.getBoundingClientRect();
    const graphX = ((clientX - bounds.left) / bounds.width) * 800;
    const graphY = ((clientY - bounds.top) / bounds.height) * 230;
    return {
      time: snappedTime(
        ((graphX - plot.left) / (plot.right - plot.left)) * safeLength,
      ),
      value: clampAutomationValue(
        target,
        spec.max -
          ((graphY - plot.top) / (plot.bottom - plot.top)) *
            (spec.max - spec.min),
      ),
    };
  }

  function patchLane(next: AutomationPoint[]) {
    if (disabled) return false;
    try {
      onChange({
        ...(target === 'volume' ? { automation: undefined } : {}),
        automationLanes: {
          ...currentTrack.automationLanes,
          [target]: sortedAutomation(next),
        },
      });
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Automation could not be changed.',
      );
      return false;
    }
  }

  function selectPoint(point: AutomationPoint) {
    setSelectedTime(point.time);
    setTime(point.time);
    setValue(point.value);
    setCurve(point.curve || 'linear');
    setMessage('');
  }

  function upsertPoint(
    point: AutomationPoint,
    replacedTime: number | null = selectedTime,
  ) {
    const replacing =
      replacedTime !== null &&
      savedPoints.some((candidate) => candidate.time === replacedTime);
    const overwriting = savedPoints.some(
      (candidate) =>
        candidate.time === point.time && candidate.time !== replacedTime,
    );
    if (
      !replacing &&
      !overwriting &&
      (savedPoints.length >= MAX_AUTOMATION_POINTS_PER_LANE ||
        automationPointCount(currentTrack) >= MAX_AUTOMATION_POINTS_PER_TRACK)
    ) {
      setMessage('This track has reached its automation point limit.');
      return;
    }
    const next = savedPoints.filter(
      (candidate) =>
        candidate.time !== replacedTime && candidate.time !== point.time,
    );
    next.push(point);
    if (patchLane(next)) selectPoint(point);
  }

  function removePoint(point: AutomationPoint) {
    if (
      !patchLane(
        savedPoints.filter((candidate) => candidate.time !== point.time),
      )
    )
      return;
    if (selectedTime === point.time) setSelectedTime(null);
    setMessage('Point removed.');
  }

  function startDrag(
    event: ReactPointerEvent<SVGCircleElement>,
    point: AutomationPoint,
    index: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    graph.current?.setPointerCapture(event.pointerId);
    selectPoint(point);
    setDrag({
      trackId: currentTrack.id,
      target,
      pointerId: event.pointerId,
      sourceIndex: index,
      source: savedPoints,
      points: savedPoints,
    });
    onGestureActivity?.(true);
  }

  function moveDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (
      !drag ||
      event.pointerId !== drag.pointerId ||
      drag.trackId !== currentTrack.id ||
      drag.target !== target
    )
      return;
    event.preventDefault();
    const nextPoint = {
      ...drag.source[drag.sourceIndex],
      ...graphPoint(event.clientX, event.clientY),
    };
    const next = drag.source.filter(
      (point, index) =>
        index !== drag.sourceIndex && point.time !== nextPoint.time,
    );
    next.push(nextPoint);
    setDrag({ ...drag, points: sortedAutomation(next) });
    setSelectedTime(nextPoint.time);
    setTime(nextPoint.time);
    setValue(nextPoint.value);
    setCurve(nextPoint.curve || 'linear');
  }

  function finishDrag(
    event: ReactPointerEvent<SVGSVGElement>,
    commit: boolean,
  ) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (graph.current?.hasPointerCapture(event.pointerId))
      graph.current.releasePointerCapture(event.pointerId);
    const pending = drag;
    setDrag(null);
    onGestureActivity?.(false);
    if (!commit) {
      if (
        pending.trackId === currentTrack.id &&
        pending.target === target &&
        pending.source[pending.sourceIndex]
      ) {
        selectPoint(pending.source[pending.sourceIndex]);
        setMessage('Automation gesture canceled.');
      }
      return;
    }
    if (
      pending.trackId === currentTrack.id &&
      pending.target === target
    ) {
      if (patchLane(pending.points))
        setMessage('Automation gesture saved as one edit.');
    }
  }

  function changeTarget(next: string) {
    const lane = next as AutomationTarget;
    setTarget(lane);
    setSelectedTime(null);
    setValue(targetDefault(lane));
    setCurve('linear');
    setMessage('');
  }

  function pathFor(pointsToDraw: AutomationPoint[]) {
    if (!pointsToDraw.length) {
      const baseline = targetDefault(target);
      return `M ${xFor(0)} ${yFor(baseline)} L ${xFor(safeLength)} ${yFor(baseline)}`;
    }
    let path = `M ${xFor(0)} ${yFor(pointsToDraw[0].value)}`;
    if (pointsToDraw[0].time > 0)
      path += ` L ${xFor(pointsToDraw[0].time)} ${yFor(pointsToDraw[0].value)}`;
    for (let index = 1; index < pointsToDraw.length; index++) {
      const previous = pointsToDraw[index - 1];
      const point = pointsToDraw[index];
      path +=
        previous.curve === 'hold'
          ? ` H ${xFor(point.time)} V ${yFor(point.value)}`
          : ` L ${xFor(point.time)} ${yFor(point.value)}`;
    }
    return path + ` H ${xFor(safeLength)}`;
  }

  return (
    <section className="automation-editor">
      <div className="section-title automation-heading">
        <div>
          <span className="automation-kicker">MULTI-LANE AUTOMATION</span>
          <h2>
            {currentTrack.name} · {spec.label}
          </h2>
          <p>
            Click to add points, drag to shape the lane, and choose Linear or
            Hold for each outgoing segment.
          </p>
        </div>
        <div className="automation-actions">
          <button
            className="button secondary"
            disabled={!savedPoints.length}
            onClick={() => {
              setClipboard({ target, points: structuredClone(savedPoints) });
              setMessage(`${spec.label} lane copied.`);
            }}
          >
            <Copy size={14} /> Copy lane
          </button>
          <button
            className="button secondary"
            disabled={
              disabled ||
              clipboard?.target !== target ||
              !clipboard.points.length ||
              automationPointCount(currentTrack) -
                savedPoints.length +
                clipboard.points.length >
                MAX_AUTOMATION_POINTS_PER_TRACK
            }
            onClick={() => {
              if (!clipboard || clipboard.target !== target) return;
              if (patchLane(structuredClone(clipboard.points))) {
                setSelectedTime(null);
                setMessage(`${spec.label} lane pasted.`);
              }
            }}
          >
            <ClipboardPaste size={14} /> Paste lane
          </button>
          <button
            className="button secondary"
            disabled={disabled || !savedPoints.length}
            onClick={() => {
              if (patchLane([])) {
                setSelectedTime(null);
                setMessage(`${spec.label} lane cleared.`);
              }
            }}
          >
            <Trash2 size={14} /> Clear lane
          </button>
        </div>
      </div>

      <div className="automation-toolbar">
        <Pick
          label="Automation target"
          value={target}
          onChange={changeTarget}
          options={AUTOMATION_TARGETS.map((option) => ({
            value: option,
            label: AUTOMATION_SPECS[option].label,
          }))}
        />
        <Pick
          label="Beat snap"
          value={snap}
          onChange={setSnap}
          options={[
            { value: 'off', label: 'Off' },
            { value: '0.25', label: '1/16 note' },
            { value: '0.5', label: '1/8 note' },
            { value: '1', label: '1/4 note' },
            { value: '4', label: '1 bar' },
          ]}
        />
        <div className="automation-summary" aria-label="Automation summary">
          <strong>
            {active.length} active {active.length === 1 ? 'lane' : 'lanes'}
          </strong>
          <span>
            {automationPointCount(currentTrack)}/
            {MAX_AUTOMATION_POINTS_PER_TRACK} points
          </span>
        </div>
      </div>

      <div className="automation-lanes" aria-label="Automation lanes">
        {AUTOMATION_TARGETS.map((lane) => {
          const count = automationLane(currentTrack, lane).length;
          return (
            <button
              key={lane}
              className={lane === target ? 'selected' : ''}
              aria-pressed={lane === target}
              onClick={() => changeTarget(lane)}
            >
              <span>{AUTOMATION_SPECS[lane].shortLabel}</span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </div>

      <div className="automation-graph-scroll">
        <svg
          ref={graph}
          viewBox="0 0 800 230"
          aria-label={`${spec.label} automation curve. Click to add a point and drag points to edit.`}
          className="automation-graph"
          onPointerMove={moveDrag}
          onPointerUp={(event) => finishDrag(event, true)}
          onPointerCancel={(event) => finishDrag(event, false)}
        >
          <rect
            x={plot.left}
            y={plot.top}
            width={plot.right - plot.left}
            height={plot.bottom - plot.top}
            className="automation-hitbox"
            onClick={(event) => {
              if (disabled) return;
              const point = {
                ...graphPoint(event.clientX, event.clientY),
                curve: 'linear' as const,
              };
              upsertPoint(point, null);
            }}
          />
          {Array.from({ length: 9 }, (_, index) => index / 8).map((ratio) => (
            <g key={'x-' + ratio} className="automation-gridline">
              <line
                x1={plot.left + ratio * (plot.right - plot.left)}
                x2={plot.left + ratio * (plot.right - plot.left)}
                y1={plot.top}
                y2={plot.bottom}
              />
              <text
                x={plot.left + ratio * (plot.right - plot.left)}
                y="216"
                textAnchor={
                  ratio === 0 ? 'start' : ratio === 1 ? 'end' : 'middle'
                }
              >
                {(ratio * safeLength).toFixed(ratio === 0 ? 0 : 1)}s
              </text>
            </g>
          ))}
          {Array.from({ length: 5 }, (_, index) => index / 4).map((ratio) => {
            const level = spec.max - ratio * (spec.max - spec.min);
            return (
              <g key={'y-' + ratio} className="automation-gridline">
                <line
                  x1={plot.left}
                  x2={plot.right}
                  y1={plot.top + ratio * (plot.bottom - plot.top)}
                  y2={plot.top + ratio * (plot.bottom - plot.top)}
                />
                <text
                  x={plot.left - 8}
                  y={plot.top + ratio * (plot.bottom - plot.top) + 4}
                  textAnchor="end"
                >
                  {formatAutomationValue(target, level)}
                </text>
              </g>
            );
          })}
          <path d={pathFor(points)} className="automation-curve" />
          <line
            className="automation-playhead"
            x1={xFor(position)}
            x2={xFor(position)}
            y1={plot.top}
            y2={plot.bottom}
          />
          {points.map((point, index) => (
            <circle
              key={`${point.time}-${index}`}
              cx={xFor(point.time)}
              cy={yFor(point.value)}
              r={point.time === selectedTime ? 8 : 6}
              className={
                'automation-point ' +
                (point.time === selectedTime ? 'selected ' : '') +
                ((point.curve || 'linear') === 'hold' ? 'hold' : '')
              }
              aria-hidden="true"
              onPointerDown={(event) => startDrag(event, point, index)}
              onClick={(event) => {
                event.stopPropagation();
                selectPoint(point);
              }}
            >
              <title>
                {point.time.toFixed(2)}s ·{' '}
                {formatAutomationValue(target, point.value)} ·{' '}
                {point.curve || 'linear'}
              </title>
            </circle>
          ))}
        </svg>
      </div>

      <div className="automation-precision">
        <label className="field">
          <span>Time in seconds</span>
          <input
            type="number"
            min={0}
            max={safeLength}
            step={0.01}
            value={time}
            disabled={disabled}
            onChange={(event) =>
              setTime(snappedTime(Number(event.target.value) || 0))
            }
          />
        </label>
        <label className="field">
          <span>{spec.label} value</span>
          <input
            type="number"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={value}
            disabled={disabled}
            onChange={(event) =>
              setValue(clampAutomationValue(target, Number(event.target.value)))
            }
          />
          <small>{formatAutomationValue(target, value)}</small>
        </label>
        <label className="automation-slider">
          <span>Fine value</span>
          <input
            aria-label={`${spec.label} fine value`}
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={value}
            disabled={disabled}
            onChange={(event) => setValue(Number(event.target.value))}
          />
        </label>
        <Pick
          label="Curve to next point"
          value={curve}
          onChange={(next) => setCurve(next as AutomationCurve)}
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'hold', label: 'Hold / step' },
          ]}
        />
        <div className="automation-precision-actions">
          <button
            className="button primary"
            disabled={disabled}
            onClick={() =>
              upsertPoint(
                { time: snappedTime(time), value, curve },
                selected?.time ?? null,
              )
            }
          >
            <Plus size={15} /> {selected ? 'Update point' : 'Add point'}
          </button>
          <button
            className="button secondary"
            disabled={disabled || !selected}
            onClick={() => selected && removePoint(selected)}
          >
            <Trash2 size={14} /> Delete point
          </button>
        </div>
      </div>

      <div
        className="automation-point-list"
        aria-label={`${spec.label} points`}
      >
        {savedPoints.length ? (
          savedPoints.map((point, index) => (
            <div
              key={`${point.time}-${index}`}
              className={point.time === selectedTime ? 'selected' : ''}
            >
              <button onClick={() => selectPoint(point)}>
                <strong>{point.time.toFixed(2)}s</strong>
                <span>{formatAutomationValue(target, point.value)}</span>
                <small>{point.curve || 'linear'}</small>
              </button>
              <button
                aria-label={`Delete point at ${point.time.toFixed(2)} seconds`}
                disabled={disabled}
                onClick={() => removePoint(point)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        ) : (
          <p>
            Click the graph to add the first {spec.label.toLowerCase()} point.
          </p>
        )}
      </div>

      <div className="automation-footer">
        <output>{message}</output>
        <p>
          {savedPoints.length}/{MAX_AUTOMATION_POINTS_PER_LANE} points in this
          lane · {spec.mode === 'multiply' ? 'Multiplies' : 'Replaces'} the
          channel {spec.label.toLowerCase()} during playback and export.
        </p>
      </div>
    </section>
  );
}
