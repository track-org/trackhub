#!/usr/bin/env node
// dead-letter.cjs — Detect cron jobs stuck in repeated failure loops
//
// Fetches recent runs for all cron jobs, groups consecutive runs with
// similar outcomes, and identifies jobs that are "dead letters" — stuck
// repeating the same error or pattern across multiple runs without recovery.
//
// Zero external dependencies. Node.js 18+.
//
// Usage:
//   node dead-letter.cjs                          # All jobs, last 10 runs each
//   node dead-letter.cjs --min-streak 3           # Only report if 3+ same-result streak
//   node dead-letter.cjs --name "gmail"           # Filter by job name (substring)
//   node dead-letter.cjs --days 14                # Look back 14 days
//   node dead-letter.cjs --json                   # Raw JSON output
//   node dead-letter.cjs --fail-only              # Only show stuck-failure jobs
//   node dead-letter.cjs --quiet                  # Warnings only
//   node dead-letter.cjs --suggest-snooze         # Include snooze command suggestions

'use strict';

const { execSync } = require('child_process');

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args[key] = argv[++i];
    } else {
      args[key] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.help || args.h) {
  console.log(`cron-dead-letter — Detect cron jobs stuck in repeated failure loops

Usage:
  node dead-letter.cjs [options]

Options:
  --min-streak <n>    Minimum consecutive same-result runs to flag (default: 3)
  --name <pattern>    Filter by job name (substring match)
  --days <n>          Look back this many days (default: 7)
  --runs <n>          Max runs to fetch per job (default: 15)
  --json              Raw JSON output
  --fail-only         Only show jobs stuck on failure/error outcomes
  --quiet             Only show warnings, suppress clean jobs
  --suggest-snooze    Include snooze command suggestions for stuck jobs
  --help              Show this help

Exit codes:
  0 — No dead letters found (or only informational)
  1 — Dead letters detected
  2 — Error running the check`);
  process.exit(0);
}

const MIN_STREAK = parseInt(args['min-streak'], 10) || 3;
const DAYS = parseInt(args.days, 10) || 7;
const MAX_RUNS = parseInt(args.runs, 10) || 15;
const JSON_OUT = !!args.json;
const FAIL_ONLY = !!args['fail-only'];
const QUIET = !!args.quiet;
const SUGGEST_SNOOZE = !!args['suggest-snooze'];
const NAME_FILTER = args.name ? args.name.toLowerCase() : null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function shell(cmd) {
  try {
    const out = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, data: out.trim() };
  } catch (e) {
    return { ok: false, data: e.stdout?.trim() || e.stderr?.trim() || e.message };
  }
}

/**
 * Parse openclaw cron list output using column-position detection.
 */
function parseCronList(raw) {
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0];
  const columns = ['ID', 'Name', 'Schedule', 'Next', 'Last', 'Status', 'Target', 'Agent ID', 'Model'];
  const positions = [];

  for (const col of columns) {
    const idx = header.indexOf(col);
    if (idx === -1) break;
    positions.push({ name: col, start: idx });
  }

  if (positions.length < 6) return [];

  const jobs = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const row = {};
    for (let c = 0; c < positions.length; c++) {
      const start = positions[c].start;
      const end = c + 1 < positions.length ? positions[c + 1].start : line.length;
      row[positions[c].name] = line.slice(start, end).trim();
    }

    jobs.push({
      id: row.ID,
      name: row.Name,
      schedule: row.Schedule,
      status: row.Status,
      target: row.Target,
    });
  }
  return jobs;
}

/**
 * Extract a short "fingerprint" from a run summary to group similar outcomes.
 * Focuses on key patterns: credential failures, error messages, NO_REPLY, etc.
 */
function fingerprint(summary) {
  if (!summary) return '(empty)';

  // Detect common patterns
  const lines = summary.split('\n').filter(l => l.trim());

  // Check for credential pre-flight payload (cron instructions)
  if (summary.includes('Credential Pre-flight') && summary.includes('--check')) {
    // Check if it also contains actual JSON output with a service name
    const svcMatch = summary.match(/"service":\s*"([^"]+)"/);
    const checkMatch = summary.match(/--check\s+(\S+)/);
    const detailMatch = summary.match(/"detail":\s*"([^"]+)"/);

    if (svcMatch) {
      return `preflight-fail:${svcMatch[1]}:${detailMatch ? detailMatch[1].slice(0, 60) : ''}`;
    }
    return `preflight-check:${checkMatch ? checkMatch[1] : 'unknown'}`;
  }

  // Check for credential failure mention
  if (summary.toLowerCase().includes('credential') && summary.toLowerCase().includes('fail')) {
    return `credential-fail:${summary.slice(0, 80).replace(/\s+/g, ' ')}`;
  }

  // Check for NO_REPLY
  if (summary.trim() === 'NO_REPLY') return 'NO_REPLY';

  // Check for error keywords
  const errKeywords = ['error', 'failed', 'timeout', 'unauthorized', 'forbidden', 'rate limit'];
  for (const kw of errKeywords) {
    if (summary.toLowerCase().includes(kw)) {
      // Find the line with the keyword
      const errLine = lines.find(l => l.toLowerCase().includes(kw));
      return `error:${errLine ? errLine.slice(0, 80).replace(/\s+/g, ' ') : kw}`;
    }
  }

  // Generic: use first 2 meaningful lines
  const meaningful = lines.filter(l => !l.startsWith('#') && !l.startsWith('##')).slice(0, 2);
  return meaningful.join('|').slice(0, 120).replace(/\s+/g, ' ') || '(empty)';
}

/**
 * Detect whether a fingerprint represents a "failure" outcome.
 */
function isFailureFingerprint(fp) {
  return fp.startsWith('preflight-fail:') ||
         fp.startsWith('preflight-check:') ||
         fp.startsWith('credential-fail:') ||
         fp.startsWith('error:');
}

/**
 * Compute similarity between two fingerprints (simple string comparison).
 */
function similar(a, b) {
  if (a === b) return true;
  // Prefix match for preflight-fail patterns (same service)
  if (a.startsWith('preflight-fail:') && b.startsWith('preflight-fail:')) {
    const aParts = a.split(':');
    const bParts = b.split(':');
    return aParts[1] === bParts[1]; // same service
  }
  return false;
}

function fmtDate(ms) {
  if (!ms) return '?';
  const d = new Date(ms);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function fmtDuration(ms) {
  if (!ms) return '?';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  // 1. Get all cron jobs
  const listResult = shell('openclaw cron list');
  if (!listResult.ok) {
    if (JSON_OUT) {
      console.log(JSON.stringify({ error: 'Failed to list cron jobs', detail: listResult.data }));
    } else {
      console.error('❌ Failed to list cron jobs:', listResult.data);
    }
    process.exit(2);
  }

  const allJobs = parseCronList(listResult.data);
  if (allJobs.length === 0) {
    if (JSON_OUT) {
      console.log(JSON.stringify({ deadLetters: [], total: 0 }));
    } else if (!QUIET) {
      console.log('📭 No cron jobs found.');
    }
    process.exit(0);
  }

  // Filter by name if requested
  const jobs = NAME_FILTER
    ? allJobs.filter(j => j.name.toLowerCase().includes(NAME_FILTER))
    : allJobs;

  const cutoffMs = Date.now() - (DAYS * 24 * 60 * 60 * 1000);
  const deadLetters = [];

  // 2. For each job, fetch recent runs and detect streaks
  for (const job of jobs) {
    const runsResult = shell(`openclaw cron runs --id ${job.id} --limit ${MAX_RUNS}`);
    if (!runsResult.ok) continue;

    let entries;
    try {
      const parsed = JSON.parse(runsResult.data);
      entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      continue;
    }

    // Filter by date window
    const recentEntries = entries.filter(e => (e.runAtMs || e.ts || 0) > cutoffMs);
    if (recentEntries.length < MIN_STREAK) continue;

    // 3. Group consecutive runs by fingerprint
    const streaks = [];
    let currentStreak = { fingerprint: fingerprint(recentEntries[0].summary), runs: [recentEntries[0]] };

    for (let i = 1; i < recentEntries.length; i++) {
      const fp = fingerprint(recentEntries[i].summary);
      if (similar(fp, currentStreak.fingerprint)) {
        currentStreak.runs.push(recentEntries[i]);
      } else {
        streaks.push(currentStreak);
        currentStreak = { fingerprint: fp, runs: [recentEntries[i]] };
      }
    }
    streaks.push(currentStreak);

    // 4. Find the longest current streak (most recent)
    const latestStreak = streaks[streaks.length - 1];
    if (latestStreak.runs.length >= MIN_STREAK) {
      const isFail = isFailureFingerprint(latestStreak.fingerprint);
      if (FAIL_ONLY && !isFail) continue;

      deadLetters.push({
        jobId: job.id,
        jobName: job.name,
        schedule: job.schedule,
        fingerprint: latestStreak.fingerprint,
        isFailure: isFail,
        streakLength: latestStreak.runs.length,
        totalRunsInWindow: recentEntries.length,
        firstRunAt: latestStreak.runs[latestStreak.runs.length - 1].runAtMs || latestStreak.runs[latestStreak.runs.length - 1].ts,
        lastRunAt: latestStreak.runs[0].runAtMs || latestStreak.runs[0].ts,
        avgDurationMs: Math.round(latestStreak.runs.reduce((s, r) => s + (r.durationMs || 0), 0) / latestStreak.runs.length),
        sampleSummary: latestStreak.runs[0].summary?.slice(0, 200),
      });
    }
  }

  // 5. Sort: failures first, then by streak length descending
  deadLetters.sort((a, b) => {
    if (a.isFailure !== b.isFailure) return a.isFailure ? -1 : 1;
    return b.streakLength - a.streakLength;
  });

  // 6. Output
  if (JSON_OUT) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      windowDays: DAYS,
      minStreak: MIN_STREAK,
      totalJobsChecked: jobs.length,
      deadLetterCount: deadLetters.length,
      deadLetters,
    }, null, 2));
  } else {
    if (deadLetters.length === 0) {
      if (!QUIET) {
        console.log(`✅ No dead letters found (${jobs.length} jobs checked, streak ≥${MIN_STREAK} over ${DAYS}d)`);
      }
    } else {
      console.log(`📭 Dead Letter Report — ${deadLetters.length} stuck job(s) found\n`);

      for (const dl of deadLetters) {
        const icon = dl.isFailure ? '🔴' : '🟡';
        const label = dl.isFailure ? 'STUCK FAILURE' : 'STUCK LOOP';
        console.log(`${icon} ${dl.jobName}`);
        console.log(`   Pattern: ${label} — ${dl.streakLength} consecutive same-result runs (${dl.totalRunsInWindow} total in window)`);
        console.log(`   Fingerprint: ${dl.fingerprint}`);
        console.log(`   Since: ${fmtDate(dl.firstRunAt)} → ${fmtDate(dl.lastRunAt)}`);
        console.log(`   Avg duration: ${fmtDuration(dl.avgDurationMs)}`);

        if (SUGGEST_SNOOZE) {
          console.log(`   💤 Snooze: node ${__dirname}/../cron-snooze/scripts/cron-snooze.mjs snooze --job-id ${dl.jobId} --for "3d"`);
        }

        console.log();
      }

      console.log(`Checked ${jobs.length} jobs | Min streak: ${MIN_STREAK} | Window: ${DAYS}d`);
    }
  }

  process.exit(deadLetters.length > 0 && deadLetters.some(dl => dl.isFailure) ? 1 : 0);
}

try {
  main();
} catch (err) {
  if (JSON_OUT) {
    console.log(JSON.stringify({ error: err.message, stack: err.stack }));
  } else {
    console.error('❌ cron-dead-letter error:', err.message);
  }
  process.exit(2);
}
