#!/usr/bin/env node
/**
 * cron-retry.mjs — Automatically retry failed OpenClaw cron jobs
 * with exponential backoff and transient-error detection.
 *
 * Zero dependencies. Node.js 18+. Uses shared-lib.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── shared-lib import ──────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const sharedLib = resolve(__dirname, '..', '..', 'shared-lib', 'scripts', 'lib');

let parseArgs, fmt;
try {
  const argsMod = await import(resolve(sharedLib, 'args.mjs'));
  parseArgs = argsMod.parseArgs;
  const fmtMod = await import(resolve(sharedLib, 'fmt.mjs'));
  fmt = fmtMod.fmt;
} catch {
  // Fallback minimal implementations
  parseArgs = (argv) => {
    const result = { _: [] };
    for (let i = 0; i < argv.length; i++) {
      if (argv[i].startsWith('--')) {
        const [key, val] = argv[i].slice(2).split('=');
        if (val !== undefined) { result[key] = val; }
        else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { result[key] = argv[++i]; }
        else { result[key] = true; }
      } else { result._.push(argv[i]); }
    }
    return result;
  };
  fmt = {
    ok: (m) => console.log(`✅ ${m}`),
    warn: (m) => console.log(`⚠️  ${m}`),
    error: (m) => console.log(`❌ ${m}`),
    info: (m) => console.log(`ℹ️  ${m}`),
  };
}

// ── Config ─────────────────────────────────────────────────
const DEFAULTS = {
  maxAttempts: 3,
  baseDelay: 60,      // seconds
  maxDelay: 1800,     // 30 min
  window: 6,          // hours
  stateFile: 'memory/cron-retry-state.json',
};

// ── Error classification ───────────────────────────────────
const TRANSIENT_PATTERNS = [
  /ETIMEDOUT/i, /ECONNRESET/i, /ECONNREFUSED/i,
  /fetch failed/i, /network/i, /timeout/i,
  /rate.?limit/i, /too many requests/i, /429/,
  /50[0-3]/, /internal server error/i, /service unavailable/i,
  /bad gateway/i, /gateway timeout/i,
  /temporarily/i, /try again/i,
];

const PERMANENT_PATTERNS = [
  /revoked/i, /invalid_grant/i, /refresh token invalid/i,
  /not found/i, /ENOENT/i, /no such file/i,
  /parse error/i, /invalid config/i, /schema validation/i,
  /SyntaxError/i, /MODULE_NOT_FOUND/i, /permission denied/i,
  /EACCES/i, /unauthorized/i, /forbidden/i,
];

function classifyError(errorText) {
  if (!errorText) return { type: 'unknown', retryable: true };
  const lower = errorText.toLowerCase();
  for (const p of PERMANENT_PATTERNS) {
    if (p.test(lower)) return { type: 'permanent', retryable: false };
  }
  for (const p of TRANSIENT_PATTERNS) {
    if (p.test(lower)) return { type: 'transient', retryable: true };
  }
  return { type: 'unknown', retryable: true };
}

// ── Helpers ────────────────────────────────────────────────
function runCli(cmd) {
  try {
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return result;
  } catch (e) {
    // If we got partial stdout, use it
    if (e.stdout) return e.stdout.trim();
    return null;
  }
}

function parseJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function loadState(filePath) {
  try {
    return parseJson(readFileSync(filePath, 'utf-8')) || { retries: {} };
  } catch {
    return { retries: {} };
  }
}

function saveState(filePath, state) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  // Prune entries older than 24h
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const key of Object.keys(state.retries)) {
    if (state.retries[key].originalRunAt < cutoff) {
      delete state.retries[key];
    }
  }
  writeFileSync(filePath, JSON.stringify(state, null, 2));
}

function getBackoffDelay(attempt, baseDelay, maxDelay, noBackoff) {
  if (noBackoff) return baseDelay;
  const jitter = Math.random() * baseDelay * 0.25;
  const delay = Math.min(baseDelay * Math.pow(2, attempt) + jitter, maxDelay);
  return Math.round(delay);
}

function getJobName(jobs, jobId) {
  const job = jobs.find(j => j.id === jobId);
  return job ? job.name : jobId.slice(0, 8) + '…';
}

function matchJob(jobs, pattern) {
  // Match by ID
  const byId = jobs.find(j => j.id === pattern);
  if (byId) return [byId];
  // Fuzzy match by name
  const lower = pattern.toLowerCase();
  return jobs.filter(j => j.name.toLowerCase().includes(lower));
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2), {
    boolean: ['help', 'dry-run', 'list-only', 'json', 'no-backoff', 'quiet'],
    default: {
      'max-attempts': DEFAULTS.maxAttempts,
      'base-delay': DEFAULTS.baseDelay,
      'max-delay': DEFAULTS.maxDelay,
      window: DEFAULTS.window,
      'state-file': DEFAULTS.stateFile,
    },
  });

  if (args.help) {
    console.log(`
Usage: node cron-retry.mjs [options]

Options:
  --job <id|name>       Specific job to check (default: all)
  --max-attempts <n>    Max retry attempts (default: ${DEFAULTS.maxAttempts})
  --base-delay <sec>    Base delay for backoff (default: ${DEFAULTS.baseDelay}s)
  --max-delay <sec>     Max delay cap (default: ${DEFAULTS.maxDelay}s)
  --window <hours>      Only consider failures within this window (default: ${DEFAULTS.window}h)
  --dry-run             Show what would happen without retrying
  --list-only           Only list retryable failures
  --json                JSON output
  --state-file <path>   State file path (default: ${DEFAULTS.stateFile})
  --no-backoff          Fixed delay instead of exponential
  --quiet               Only warnings and errors
  --help                Show this help
`);
    process.exit(0);
  }

  const maxAttempts = Number(args['max-attempts']) || DEFAULTS.maxAttempts;
  const baseDelay = Number(args['base-delay']) || DEFAULTS.baseDelay;
  const maxDelay = Number(args['max-delay']) || DEFAULTS.maxDelay;
  const windowHours = Number(args.window) || DEFAULTS.window;
  const stateFile = resolve(args['state-file'] || DEFAULTS.stateFile);
  const dryRun = args['dry-run'];
  const listOnly = args['list-only'];
  const jsonOutput = args.json;
  const noBackoff = args['no-backoff'];
  const quiet = args.quiet;

  // Fetch all cron jobs
  const jobsRaw = runCli('openclaw cron list --json');
  const jobsData = parseJson(jobsRaw);
  if (!jobsData) {
    fmt.error('Failed to fetch cron job list. Is openclaw on PATH?');
    process.exit(1);
  }

  const allJobs = Array.isArray(jobsData) ? jobsData : (jobsData.jobs || []);
  if (allJobs.length === 0) {
    fmt.warn('No cron jobs found.');
    process.exit(0);
  }
  let targetJobs = allJobs;

  if (args.job) {
    targetJobs = matchJob(allJobs, args.job);
    if (targetJobs.length === 0) {
      fmt.error(`No job matching "${args.job}" found.`);
      process.exit(1);
    }
  }

  // Load retry state
  const state = loadState(stateFile);

  // Collect failed runs
  const cutoffMs = Date.now() - windowHours * 60 * 60 * 1000;
  const retryable = [];
  const permanent = [];

  for (const job of targetJobs) {
    const runsRaw = runCli(`openclaw cron runs --id ${job.id} --limit 5`);
    const runsData = parseJson(runsRaw);
    if (!runsData || !runsData.entries) continue;

    for (const run of runsData.entries) {
      if (run.status === 'ok') continue;
      if (run.runAtMs < cutoffMs) continue;

      // Get error context from summary or delivery status
      const errorText = [run.summary, run.deliveryStatus, run.error].filter(Boolean).join(' ');

      // Try to get transcript for better error classification
      let transcriptError = '';
      if (run.sessionKey) {
        const histRaw = runCli(`openclaw session history --key "${run.sessionKey}" --limit 3`);
        if (histRaw) transcriptError = histRaw;
      }

      const fullError = [errorText, transcriptError].join(' ');
      const classification = classifyError(fullError);

      const stateKey = `${job.id}:${run.runAtMs}`;
      const existingRetries = state.retries[stateKey];
      const attempts = existingRetries ? existingRetries.attempts : 0;

      if (!classification.retryable) {
        permanent.push({
          jobId: job.id,
          jobName: job.name,
          runAt: run.runAtMs,
          error: errorText.slice(0, 200),
          classification: classification.type,
        });
      } else if (attempts < maxAttempts) {
        const delay = getBackoffDelay(attempts, baseDelay, maxDelay, noBackoff);
        retryable.push({
          jobId: job.id,
          jobName: job.name,
          runAt: run.runAtMs,
          error: errorText.slice(0, 200),
          classification: classification.type,
          attempts,
          nextDelay: delay,
          stateKey,
        });
      }
    }
  }

  // Output
  if (jsonOutput) {
    console.log(JSON.stringify({ retryable, permanent, total: retryable.length + permanent.length }, null, 2));
    process.exit(0);
  }

  if (permanent.length > 0 && !quiet) {
    fmt.warn(`${permanent.length} permanent failure(s) — not retryable:`);
    for (const p of permanent) {
      console.log(`   ${p.jobName}: ${p.error.slice(0, 100) || '(no detail)'} [${p.classification}]`);
    }
  }

  if (retryable.length === 0) {
    if (!quiet) fmt.ok('No retryable failures found.');
    process.exit(0);
  }

  if (listOnly || dryRun) {
    fmt.info(`${retryable.length} retryable failure(s) detected:`);
    for (const r of retryable) {
      console.log(`   ${r.jobName} (attempt ${r.attempts + 1}/${maxAttempts}, delay ${r.nextDelay}s): ${r.error.slice(0, 100) || '(no detail)'} [${r.classification}]`);
    }
    if (dryRun) fmt.info('Dry run — no retries executed.');
    process.exit(0);
  }

  // Execute retries
  let retried = 0;
  let failed = 0;

  for (const r of retryable) {
    fmt.info(`Retrying "${r.jobName}" (attempt ${r.attempts + 1}/${maxAttempts}, waiting ${r.nextDelay}s)...`);

    // Wait with backoff
    await new Promise(resolve => setTimeout(resolve, r.nextDelay * 1000));

    // Trigger retry
    const result = runCli(`openclaw cron run --id ${r.jobId}`);

    // Update state
    state.retries[r.stateKey] = {
      jobId: r.jobId,
      originalRunAt: r.runAt,
      attempts: r.attempts + 1,
      lastAttemptAt: Date.now(),
      lastResult: result ? 'triggered' : 'trigger-failed',
      nextRetryAt: Date.now() + getBackoffDelay(r.attempts + 1, baseDelay, maxDelay, noBackoff) * 1000,
      errorSummary: r.error.slice(0, 200),
    };

    if (result) {
      retried++;
      fmt.ok(`Retry triggered for "${r.jobName}"`);
    } else {
      failed++;
      fmt.error(`Failed to trigger retry for "${r.jobName}"`);
    }
  }

  // Save state
  saveState(stateFile, state);

  if (!quiet) {
    fmt.summary({ retried, failed, total: retryable.length });
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  fmt?.error?.(`Unexpected error: ${e.message}`) ?? console.error(`Unexpected error: ${e.message}`);
  process.exit(1);
});
