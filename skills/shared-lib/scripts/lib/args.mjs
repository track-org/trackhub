#!/usr/bin/env node
/**
 * Minimal CLI argument parser for trackhub scripts.
 *
 * Usage:
 *   import { parseArgs } from './lib/args.mjs';
 *
 *   const args = parseArgs(process.argv.slice(2), {
 *     alias: { h: 'help', v: 'verbose' },
 *     boolean: ['help', 'verbose', 'json'],
 *     default: { verbose: false, json: false },
 *   });
 *
 * Supports:
 *   --flag, -f          → boolean true
 *   --flag false        → boolean false
 *   --value foo         → string "foo"
 *   --value=foo         → string "foo"
 *   -abc                → boolean flags a, b, c
 *   positional args     → args._ array
 *
 * Returns { _: string[], [key]: string|boolean }
 */

/**
 * Parse CLI arguments.
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{ alias?: Record<string,string>, boolean?: string[], default?: Record<string,any>, string?: string[] }} opts
 * @returns {Record<string, any>}
 */
export function parseArgs(argv, opts = {}) {
  const { alias = {}, boolean: boolKeys = [], default: defaults = {}, string: strKeys = [] } = opts;
  const result = { _: [] };

  // Apply defaults
  for (const [key, val] of Object.entries(defaults)) {
    result[key] = val;
  }

  // Build reverse alias map
  const aliasOf = {};
  for (const [short, long] of Object.entries(alias)) {
    aliasOf[long] = short;
    aliasOf[short] = long;
  }

  function resolveKey(key) {
    return aliasOf[key] || key;
  }

  function isBool(key) {
    const resolved = resolveKey(key);
    return boolKeys.includes(resolved) || boolKeys.includes(key);
  }

  function isStr(key) {
    const resolved = resolveKey(key);
    return strKeys.includes(resolved) || strKeys.includes(key);
  }

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    // Short flags: -a, -abc (multiple booleans)
    if (arg.startsWith('-') && !arg.startsWith('--') && arg.length > 1) {
      const chars = arg.slice(1);
      for (const ch of chars) {
        const resolved = resolveKey(ch);
        result[resolved] = true;
      }
      i++;
      continue;
    }

    // Long flag: --flag
    if (arg.startsWith('--')) {
      let key, value;
      const eqIdx = arg.indexOf('=');

      if (eqIdx !== -1) {
        key = arg.slice(2, eqIdx);
        value = arg.slice(eqIdx + 1);
      } else {
        key = arg.slice(2);
      }

      const resolved = resolveKey(key);

      // Check if next arg is a value (not a flag)
      if (value === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-') && !isBool(key)) {
          value = next;
          i++; // consume next arg
        }
      }

      if (value === undefined) {
        result[resolved] = true;
      } else if (isBool(key)) {
        result[resolved] = value === 'true' || value === '1';
      } else if (isStr(key)) {
        result[resolved] = String(value);
      } else {
        result[resolved] = value;
      }

      i++;
      continue;
    }

    // Positional argument
    result._.push(arg);
    i++;
  }

  return result;
}

/**
 * Print usage and exit.
 *
 * @param {string} name - script name
 * @param {string} desc - one-line description
 * @param {{ [key]: string }} options - { '--flag': 'Description' }
 * @param {string} [examples] - usage examples string
 */
export function showHelp(name, desc, options = {}, examples = '') {
  const lines = [
    desc,
    '',
    `Usage: ${name} [options] [arguments]`,
    '',
  ];

  if (Object.keys(options).length > 0) {
    lines.push('Options:');
    for (const [flag, description] of Object.entries(options)) {
      lines.push(`  ${flag.padEnd(24)} ${description}`);
    }
    lines.push('');
  }

  if (examples) {
    lines.push('Examples:');
    lines.push(examples);
  }

  console.log(lines.join('\n'));
  process.exit(0);
}

/**
 * Require a positional argument or exit with error.
 *
 * @param {any[]} positional - the _ array from parseArgs
 * @param {number} index - which positional arg (0-based)
 * @param {string} label - human-readable label for error message
 * @returns {string}
 */
export function requireArg(positional, index, label) {
  const val = positional[index];
  if (!val) {
    console.error(`Missing required argument: ${label}`);
    process.exit(1);
  }
  return val;
}

// Test when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const test = ['--verbose', '--count', '5', '--flag', 'positional1', 'positional2'];
  const result = parseArgs(test, {
    alias: { v: 'verbose', c: 'count' },
    boolean: ['verbose', 'flag'],
    string: ['count'],
    default: { verbose: false },
  });
  console.log('Parsed:', JSON.stringify(result, null, 2));
  // Expected: { _: ['positional1', 'positional2'], verbose: true, count: '5', flag: true }
}
