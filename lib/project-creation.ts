import type { ProjectSnapshot } from './project-merge';
export type ProjectCreation = {
  key: string;
  checkpoint: boolean;
  retryCurrent?: boolean;
};
export function validCreation(value: any): value is ProjectCreation {
  return (
    !!value &&
    typeof value.key === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.key,
    ) &&
    typeof value.checkpoint === 'boolean' &&
    (value.retryCurrent === undefined ||
      typeof value.retryCurrent === 'boolean')
  );
}
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export async function creationHash(
  snapshot: ProjectSnapshot,
  checkpoint: boolean,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(
      canonical({
        title: snapshot.title.trim(),
        data: snapshot.data,
        checkpoint,
      }),
    ),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
}
