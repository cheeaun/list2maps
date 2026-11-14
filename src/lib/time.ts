// Opening-hours evaluation in a place's own timezone.
// Client-safe (no server imports). Interval shape matches the proxy's
// parsed format: close_minutes is +1440 when the interval runs past
// midnight.

import type { OpeningHours } from './types';

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/** Weekday (monday..sunday) and minutes since midnight, in `tz`. */
export function partsInTz(
  tz: string,
  date: Date = new Date(),
): { weekday: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0; // Intl can report midnight as 24:00
  return {
    weekday: (parts.weekday ?? 'monday').toLowerCase(),
    minutes: hour * 60 + Number(parts.minute ?? 0),
  };
}

/**
 * Intervals covering `weekday`: today's intervals, plus yesterday's
 * overnight intervals shifted back a day (e.g. 11pm–3am covers 0–3am).
 */
export function effectiveIntervals(
  hours: OpeningHours,
  weekday: string,
): { open: number; close: number }[] {
  const idx = WEEKDAYS.indexOf(weekday);
  const prev = WEEKDAYS[(idx + 6) % 7];
  const out: { open: number; close: number }[] = [];
  for (const iv of hours.by_day[weekday] ?? []) {
    out.push({ open: iv.open_minutes, close: iv.close_minutes });
  }
  for (const iv of hours.by_day[prev] ?? []) {
    if (iv.overnight) {
      out.push({
        open: iv.open_minutes - 1440,
        close: iv.close_minutes - 1440,
      });
    }
  }
  return out;
}

/**
 * Is the place open at `minutes` on `weekday`, staying open for
 * `durationMinutes` (0 = just that instant)? Matches when the place is
 * open at any point in [minutes, minutes + duration).
 */
export function isOpenAt(
  hours: OpeningHours,
  weekday: string,
  minutes: number,
  durationMinutes = 0,
): boolean {
  const windowEnd = minutes + durationMinutes;
  return effectiveIntervals(hours, weekday).some(
    (iv) => iv.open < windowEnd && minutes < iv.close,
  );
}

/** 'open' | 'closed' | 'unknown' (no hours / no timezone). */
export function openStatusNow(
  hours: OpeningHours | null,
  tz: string | null,
  now: Date = new Date(),
): 'open' | 'closed' | 'unknown' {
  if (!hours || !tz) return 'unknown';
  const { weekday, minutes } = partsInTz(tz, now);
  return isOpenAt(hours, weekday, minutes) ? 'open' : 'closed';
}

export function minutesToHHMM(m: number): string {
  const hh = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
