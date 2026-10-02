type ShortcutKey = Pick<
  KeyboardEvent,
  | 'key'
  | 'code'
  | 'defaultPrevented'
  | 'repeat'
  | 'altKey'
  | 'ctrlKey'
  | 'metaKey'
>;

// Studio shortcuts yield to controls, dialogs, and work already in progress.
export function studioShortcut(event: ShortcutKey, blocked: boolean) {
  if (
    blocked ||
    event.defaultPrevented ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return null;
  if (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar')
    return 'play';
  if (event.key.toLowerCase() === 'r') return 'record';
  if (event.key === '?') return 'help';
  return null;
}

export function loopStartRange(start: number, end: number, length: number) {
  const nextStart = Math.max(
    0,
    Math.min(length - 0.25, Number.isFinite(start) ? start : 0),
  );
  return {
    start: nextStart,
    end: Math.min(length, Math.max(nextStart + 0.25, end)),
  };
}
