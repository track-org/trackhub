/**
 * Shared library modules for trackhub scripts.
 *
 * Import individual modules:
 *   import { parseArgs } from './lib/args.mjs';
 *   import { http } from './lib/http.mjs';
 *   import { loadEnv } from './lib/dotenv.mjs';
 *   import { dates } from './lib/dates.mjs';
 *   import { fmt } from './lib/fmt.mjs';
 *
 * Or import everything:
 *   import * as lib from './lib/index.mjs';
 *   lib.parseArgs(process.argv.slice(2));
 *   lib.http.get('https://...');
 *
 * All modules are zero-dependency (Node.js built-ins only).
 */

export { parseArgs, showHelp, requireArg } from './args.mjs';
export { http, fetchWithRetry, HttpError } from './http.mjs';
export { loadEnv, envVar, env } from './dotenv.mjs';
export { dates, toDate, iso, startOfDay, endOfDay, startOfWeek, startOfMonth, today, yesterday, daysAgo, range, formatDuration, formatHuman, isInRange } from './dates.mjs';
export { fmt, json, table, summary, ok, warn, error, info, bullet, section, truncate, number, currency, bytes } from './fmt.mjs';
