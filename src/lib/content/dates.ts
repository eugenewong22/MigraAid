/**
 * Strict calendar-date parsing for content governance metadata.
 *
 * Shared by the frontmatter verifier, the source registry, and the licence gate
 * so "is this a real date?" means exactly one thing across all three.
 */

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a `YYYY-MM-DD` string as a UTC date, or return null.
 *
 * Rejects anything that is not exactly that shape, and anything that JavaScript
 * would silently roll over (`2026-02-30` becomes 2 March, so the round-trip
 * comparison catches it).
 */
export function parseCalendarDate(value: string | undefined): Date | null {
  const normalized = value?.trim();
  if (!normalized || !CALENDAR_DATE.test(normalized)) return null;

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    return null;
  }
  return parsed;
}

/** Parse a calendar date that must not be in the future, or return null. */
export function parsePastCalendarDate(
  value: string | undefined,
  now: Date,
): Date | null {
  const parsed = parseCalendarDate(value);
  if (!parsed || parsed.getTime() > now.getTime()) return null;
  return parsed;
}
