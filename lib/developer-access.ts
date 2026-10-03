// Compare immutable IDs only. A malformed or absent configuration grants nobody access.
export function isDeveloper(userId: string | null, rawIds: unknown): boolean {
  const validId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  if (typeof userId !== 'string' || !validId.test(userId)) return false;
  if (typeof rawIds !== 'string' || !rawIds || rawIds.length > 4096)
    return false;
  const ids = rawIds.split(',').map((id) => id.trim());
  if (ids.length > 32 || ids.some((id) => !validId.test(id))) return false;
  return ids.includes(userId);
}
