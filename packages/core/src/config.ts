/**
 * Parse a bounded integer environment setting without treating an absent or
 * whitespace-only value as zero. Unset/invalid values use the caller's default.
 */
export function boundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.floor(parsed), min), max)
    : fallback;
}
