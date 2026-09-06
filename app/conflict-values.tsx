import type { MergeDetail } from '@/lib/project-merge';

function describe(value: unknown): string {
  if (value === undefined || value === null) return 'Removed';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value))
    return value.length ? value.map(describe).join('\n') : 'Empty';
  const item = value as Record<string, unknown>;
  if (typeof item.pitch === 'number') {
    const note =
      ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][
        item.pitch % 12
      ] +
      (Math.floor(item.pitch / 12) - 1);
    return `${note} · beat ${Number(item.start) + 1} · ${item.length} beats · ${Math.round(Number(item.velocity) * 100)}% strength`;
  }
  if ('time' in item && 'value' in item)
    return `${item.time} seconds → ${Math.round(Number(item.value) * 100)}%`;
  return Object.entries(item)
    .filter(([key]) => !['id', 'fileId', 'demo'].includes(key))
    .map(([key, v]) => key + ': ' + describe(v))
    .join('\n');
}
export default function ConflictValues({
  details,
}: {
  details: MergeDetail[];
}) {
  if (!details.length) return null;
  return (
    <details className="conflict-values">
      <summary>Review the competing values</summary>
      {details.map((item, index) => (
        <div key={index}>
          <h4>{item.label}</h4>
          <div className="conflict-columns">
            <section>
              <strong>Your draft</strong>
              <pre>{describe(item.local)}</pre>
            </section>
            <section>
              <strong>Saved version</strong>
              <pre>{describe(item.remote)}</pre>
            </section>
          </div>
        </div>
      ))}
    </details>
  );
}
