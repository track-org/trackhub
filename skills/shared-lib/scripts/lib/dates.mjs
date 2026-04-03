#!/usr/bin/env node
/**
 * Date/time helpers for trackhub scripts.
 *
 * Usage:
 *   import { dates } from './lib/dates.mjs';
 *
 *   const today = dates.today();
 *   const range = dates.range('last7');
 *   const iso = dates.iso(new Date());
 *
 * All times are UTC by default. Accepts Date objects, ISO strings, or epoch ms.
 */

/**
 * Normalize any date input to a Date object.
 */
export function toDate(input) {
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  if (typeof input === 'string') return new Date(input);
  throw new Error(`Cannot convert to Date: ${typeof input}`);
}

/**
 * Format as ISO 8601 string.
 */
export function iso(input = new Date()) {
  return toDate(input).toISOString();
}

/**
 * Start of day (UTC) for a given date.
 */
export function startOfDay(input = new Date()) {
  const d = new Date(toDate(input));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * End of day (UTC) for a given date.
 */
export function endOfDay(input = new Date()) {
  const d = new Date(toDate(input));
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/**
 * Start of week (Monday, UTC).
 */
export function startOfWeek(input = new Date()) {
  const d = startOfDay(input);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

/**
 * Start of month (UTC).
 */
export function startOfMonth(input = new Date()) {
  const d = new Date(toDate(input));
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Start of previous month (UTC).
 */
export function startOfPrevMonth(input = new Date()) {
  const d = startOfMonth(input);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
}

/**
 * Today at midnight UTC.
 */
export function today() {
  return startOfDay();
}

/**
 * Yesterday at midnight UTC.
 */
export function yesterday() {
  const d = startOfDay();
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/**
 * N days ago at midnight UTC.
 */
export function daysAgo(n) {
  const d = startOfDay();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/**
 * Parse a human-readable range label into { start, end } ISO strings.
 *
 * Supported labels:
 *   today, yesterday, last7, last14, last30, this_week, last_week,
 *   this_month, last_month, last90, this_year
 *
 * Also supports 'YYYY-MM-DD..YYYY-MM-DD' explicit ranges.
 */
export function range(label) {
  const now = new Date();
  const lower = (label || 'today').toLowerCase().trim();

  // Explicit range: YYYY-MM-DD..YYYY-MM-DD
  if (lower.includes('..')) {
    const [s, e] = lower.split('..').map((d) => new Date(d).toISOString());
    return { start: s, end: e };
  }

  switch (lower) {
    case 'today':
      return { start: iso(startOfDay(now)), end: iso(endOfDay(now)) };
    case 'yesterday':
      return { start: iso(startOfDay(daysAgo(1))), end: iso(endOfDay(daysAgo(1))) };
    case 'last7':
    case 'last_7':
      return { start: iso(startOfDay(daysAgo(7))), end: iso(endOfDay(now)) };
    case 'last14':
    case 'last_14':
      return { start: iso(startOfDay(daysAgo(14))), end: iso(endOfDay(now)) };
    case 'last30':
    case 'last_30':
      return { start: iso(startOfDay(daysAgo(30))), end: iso(endOfDay(now)) };
    case 'last90':
    case 'last_90':
      return { start: iso(startOfDay(daysAgo(90))), end: iso(endOfDay(now)) };
    case 'this_week':
      return { start: iso(startOfWeek(now)), end: iso(endOfDay(now)) };
    case 'last_week':
      return {
        start: iso(startOfWeek(daysAgo(7))),
        end: iso(endOfDay(daysAgo(1))),
      };
    case 'this_month':
      return { start: iso(startOfMonth(now)), end: iso(endOfDay(now)) };
    case 'last_month':
      return {
        start: iso(startOfPrevMonth(now)),
        end: iso(new Date(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999)),
      };
    case 'this_year':
      return {
        start: iso(new Date(now.getUTCFullYear(), 0, 1)),
        end: iso(endOfDay(now)),
      };
    default:
      // Try parsing as a date
      const d = new Date(lower);
      if (!isNaN(d.getTime())) {
        return { start: iso(startOfDay(d)), end: iso(endOfDay(d)) };
      }
      throw new Error(`Unknown range label: "${label}". Supported: today, yesterday, last7, last14, last30, last90, this_week, last_week, this_month, last_month, this_year, YYYY-MM-DD..YYYY-MM-DD`);
  }
}

/**
 * Format a duration (ms) as human-readable string.
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.round((ms % 3600000) / 60000)}m`;
}

/**
 * Format a date for human-readable output.
 */
export function formatHuman(input) {
  const d = toDate(input);
  return d.toLocaleDateString('en-IE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Check if a date is within a range.
 */
export function isInRange(input, start, end) {
  const ts = toDate(input).getTime();
  return ts >= toDate(start).getTime() && ts <= toDate(end).getTime();
}

/**
 * Named export group for convenience: `import { dates } from './lib/dates.mjs'`
 */
export const dates = {
  toDate,
  iso,
  startOfDay,
  endOfDay,
  startOfWeek,
  startOfMonth,
  startOfPrevMonth,
  today,
  yesterday,
  daysAgo,
  range,
  formatDuration,
  formatHuman,
  isInRange,
};

// Test when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Today:', iso(today()));
  console.log('Yesterday:', iso(yesterday()));
  console.log('Last 7 days:', JSON.stringify(range('last7')));
  console.log('Last month:', JSON.stringify(range('last_month')));
  console.log('Duration:', formatDuration(90123));
  console.log('Human:', formatHuman(new Date()));
}
