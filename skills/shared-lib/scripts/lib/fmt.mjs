#!/usr/bin/env node
/**
 * Output formatting helpers for trackhub scripts.
 *
 * Usage:
 *   import { fmt } from './lib/fmt.mjs';
 *
 *   fmt.json(data);              // pretty-printed JSON
 *   fmt.table([{ name: 'foo', value: 1 }]);  // aligned table
 *   fmt.ok('All checks passed');
 *   fmt.warn('Something looks off');
 *   fmt.error('Failed to connect');
 *   fmt.summary({ total: 10, failed: 2 });
 */

/**
 * Pretty-print JSON to stdout.
 */
export function json(data, indent = 2) {
  console.log(JSON.stringify(data, null, indent));
}

/**
 * Print an aligned table from an array of objects.
 * Auto-detects column widths.
 *
 * @param {Record<string, any>[]} rows
 * @param {string[]} [columns] - specific columns to include (default: all keys from first row)
 */
export function table(rows, columns) {
  if (!rows.length) {
    console.log('(no data)');
    return;
  }

  const cols = columns || Object.keys(rows[0]);
  const widths = {};

  for (const col of cols) {
    widths[col] = String(col).length;
    for (const row of rows) {
      const val = String(row[col] ?? '');
      widths[col] = Math.max(widths[col], val.length);
    }
  }

  // Header
  const header = cols.map((c) => c.padEnd(widths[c])).join('  ');
  console.log(header);
  console.log(cols.map((c) => '─'.repeat(widths[c])).join('  '));

  // Rows
  for (const row of rows) {
    const line = cols.map((c) => String(row[c] ?? '').padEnd(widths[c])).join('  ');
    console.log(line);
  }
}

/**
 * Print a key-value summary block.
 */
export function summary(obj, prefix = '') {
  for (const [key, value] of Object.entries(obj)) {
    const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    console.log(`${prefix}${label}: ${value}`);
  }
}

/**
 * Status output with emoji prefixes.
 */
export function ok(msg) {
  console.log(`✅ ${msg}`);
}

export function warn(msg) {
  console.log(`⚠️  ${msg}`);
}

export function error(msg) {
  console.error(`❌ ${msg}`);
}

export function info(msg) {
  console.log(`ℹ️  ${msg}`);
}

export function bullet(msg, indent = 2) {
  console.log(`${' '.repeat(indent)}• ${msg}`);
}

/**
 * Section header.
 */
export function section(title) {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
}

/**
 * Truncate a string to a max length with ellipsis.
 */
export function truncate(str, maxLen = 80) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Format a number with commas.
 */
export function number(n, decimals = 0) {
  return Number(n).toLocaleString('en-IE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format currency (EUR by default).
 */
export function currency(amount, symbol = '€', decimals = 2) {
  return `${symbol}${Number(amount).toFixed(decimals)}`;
}

/**
 * Format bytes to human-readable.
 */
export function bytes(b) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Named export group.
 */
export const fmt = {
  json,
  table,
  summary,
  ok,
  warn,
  error,
  info,
  bullet,
  section,
  truncate,
  number,
  currency,
  bytes,
};

// Test when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  section('Test Output');
  ok('All good');
  warn('Heads up');
  bullet('Nested item');

  table([
    { name: 'Solar', value: 4.2, unit: 'kWh' },
    { name: 'Grid', value: 1.8, unit: 'kWh' },
  ]);

  summary({ total_kwh: 12.5, cost_eur: 4.79, date: '2026-04-03' });

  console.log('\n' + currency(4.79));
  console.log(bytes(1048576));
}
