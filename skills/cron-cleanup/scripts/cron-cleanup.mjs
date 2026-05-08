#!/usr/bin/env node

/**
 * cron-cleanup.mjs — Identify cron jobs that are candidates for cleanup.
 *
 * Analyzes all OpenClaw cron jobs and flags ones that are:
 *   - Disabled for > N days (stale disabled)
 *   - One-shot ("at" schedule) past their target date
 *   - Never ran successfully (no successful runs ever)
 *   - Consistently failing (last N runs all failed)
 *   - Orphaned (no matching run history / corrupted state)
 *
 * Outputs a report. With --exec, performs deletions (with --force to skip confirmation).
 *
 * Zero external dependencies. Node.js 18+.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// --- Shared lib imports ---
// Script: trackhub/skills/cron-cleanup/scripts/cron-cleanup.mjs
// Shared: trackhub/skills/shared-lib/scripts/lib/index.mjs
const SHARED_LIB = new URL('../../shared-lib/scripts/lib/index.mjs', import.meta.url);
let fmt;
try {
  ({ fmt } = await import(SHARED_LIB));
} catch {
  // Shared lib not available — provide minimal fallback
  fmt = {
    dim: (s) => s,
    bold: (s) => s,
    green: (s) => s,
    red: (s) => s,
    yellow: (s) => s,
  };
}

// --- Config ---
const DEFAULTS = {
  staleDisabledDays: 14,     // disabled longer than this → flag
  failingRunCount: 5,        // last N consecutive failures → flag
  maxAge: 90,                // one-shot jobs older than this → flag
};

// --- Args ---
const args = process.argv.slice(2);
const flags = {
  help: args.includes('--help') || args.includes('-h'),
  json: args.includes('--json'),
  exec: args.includes('--exec'),
  force: args.includes('--force'),
  dryRun: args.includes('--dry-run'),
  'stale-days': parseArg(args, '--stale-days', DEFAULTS.staleDisabledDays),
  'fail-count': parseArg(args, '--fail-count', DEFAULTS.failingRunCount),
  'max-age': parseArg(args, '--max-age', DEFAULTS.maxAge),
};

if (flags.help) {
  printUsage();
  process.exit(0);
}

function parseArg(argv, flag, fallback) {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return fallback;
  const val = parseInt(argv[idx + 1], 10);
  return isNaN(val) ? fallback : val;
}

function printUsage() {
  console.log(`
cron-cleanup.mjs — Identify cron jobs that are candidates for cleanup.

Usage:
  node cron-cleanup.mjs [options]

Options:
  --json              Output as JSON instead of formatted report
  --exec              Perform deletions (requires --force or interactive confirm)
  --force             Skip confirmation prompt (use with --exec)
  --dry-run           Show what would be deleted without actually deleting
  --stale-days N      Flag disabled jobs older than N days (default: ${DEFAULTS.staleDisabledDays})
  --fail-count N      Flag jobs with last N consecutive failures (default: ${DEFAULTS.failingRunCount})
  --max-age N         Flag one-shot jobs older than N days (default: ${DEFAULTS.maxAge})
  -h, --help          Show this help

Categories:
  stale-disabled      Disabled for > stale-disabled-days
  past-one-shot       One-shot ("at") schedule past target date by > max-age days
  never-succeeded     Has run entries but zero successful completions
  consecutive-fail    Last N runs all failed
  orphaned            Job exists but has no run history at all (may be new or broken)

Examples:
  node cron-cleanup.mjs                           # Report only
  node cron-cleanup.mjs --json                    # JSON report
  node cron-cleanup.mjs --dry-run                 # Show deletions without acting
  node cron-cleanup.mjs --exec --force             # Delete all flagged jobs
  node cron-cleanup.mjs --exec                     # Delete with interactive confirm
  node cron-cleanup.mjs --stale-days 30            # Longer stale threshold
`);
}

// --- Main ---
try {
  const jobs = getCronJobs();
  const results = [];

  for (const job of jobs) {
    const analysis = analyzeJob(job);
    if (analysis.categories.length > 0) {
      results.push(analysis);
    }
  }

  if (flags.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printReport(results, jobs.length);
  }

  // Deletion logic
  if ((flags.exec || flags.dryRun) && results.length > 0) {
    await handleDeletions(results);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  if (!flags.json) {
    console.error('Make sure the openclaw CLI is available and you have permission to manage cron jobs.');
  }
  process.exit(1);
}

// --- Functions ---

function getCronJobs() {
  const output = execSync('openclaw cron list --json', {
    encoding: 'utf-8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const data = JSON.parse(output);
  return data.jobs || data || [];
}

function analyzeJob(job) {
  const categories = [];
  const details = {};
  const now = Date.now();
  const DAY = 86400000;

  // 1. Stale disabled
  if (job.enabled === false && job.state?.lastRunAtMs) {
    const daysSinceRun = Math.floor((now - job.state.lastRunAtMs) / DAY);
    // Check updatedAtMs for when it was disabled
    const daysSinceUpdate = Math.floor((now - (job.updatedAtMs || job.createdAtMs)) / DAY);
    if (daysSinceUpdate > flags['stale-days']) {
      categories.push('stale-disabled');
      details['stale-disabled'] = `disabled, last updated ${daysSinceUpdate} days ago`;
    }
  } else if (job.enabled === false && !job.state?.lastRunAtMs) {
    const daysSinceCreate = Math.floor((now - job.createdAtMs) / DAY);
    if (daysSinceCreate > flags['stale-days']) {
      categories.push('stale-disabled');
      details['stale-disabled'] = `disabled, never ran, created ${daysSinceCreate} days ago`;
    }
  }

  // 2. Past one-shot
  if (job.schedule?.kind === 'at' && job.schedule?.at) {
    const targetTime = new Date(job.schedule.at).getTime();
    if (!isNaN(targetTime) && now - targetTime > flags['max-age'] * DAY) {
      categories.push('past-one-shot');
      const daysPast = Math.floor((now - targetTime) / DAY);
      details['past-one-shot'] = `target was ${daysPast} days ago`;
    }
  }

  // 3. Never succeeded
  if (job.state?.totalRuns > 0 && job.state?.successfulRuns === 0) {
    categories.push('never-succeeded');
    details['never-succeeded'] = `${job.state.totalRuns} runs, 0 successful`;
  }

  // 4. Consecutive failures — need run history
  const recentRuns = getRecentRuns(job.id, flags['fail-count']);
  if (recentRuns.length >= flags['fail-count']) {
    const allFailed = recentRuns.every(r => r.status !== 'ok');
    if (allFailed && recentRuns.length > 0) {
      categories.push('consecutive-fail');
      details['consecutive-fail'] = `last ${recentRuns.length} runs all failed`;
    }
  }

  // 5. Orphaned (created but never run, and old)
  if (!job.state?.lastRunAtMs && !job.state?.totalRuns) {
    const daysSinceCreate = Math.floor((now - job.createdAtMs) / DAY);
    if (daysSinceCreate > 3) { // Give new jobs 3 days before flagging
      categories.push('orphaned');
      details['orphaned'] = `created ${daysSinceCreate} days ago, never ran`;
    }
  }

  return {
    id: job.id,
    name: job.name,
    enabled: job.enabled,
    schedule: job.schedule?.kind || 'unknown',
    createdAt: new Date(job.createdAtMs).toISOString().split('T')[0],
    lastRun: job.state?.lastRunAtMs
      ? new Date(job.state.lastRunAtMs).toISOString().split('T')[0]
      : 'never',
    categories,
    details,
    risk: assessRisk(categories),
  };
}

function getRecentRuns(jobId, count) {
  try {
    const output = execSync(
      `openclaw cron runs --id ${jobId} --limit ${count} --json`,
      { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const data = JSON.parse(output);
    return data.entries || data || [];
  } catch {
    return [];
  }
}

function assessRisk(categories) {
  if (categories.includes('past-one-shot')) return 'low';      // Already fired, safe to remove
  if (categories.includes('stale-disabled')) return 'low';     // Disabled, was intentional
  if (categories.includes('orphaned')) return 'medium';        // Never ran — might be misconfigured
  if (categories.includes('never-succeeded')) return 'medium'; // Has tried but can't succeed
  if (categories.includes('consecutive-fail')) return 'high';  // Actively failing
  return 'low';
}

function printReport(results, totalJobs) {
  if (results.length === 0) {
    console.log(`✅ All ${totalJobs} cron jobs look clean. Nothing to clean up.`);
    return;
  }

  const byRisk = { low: [], medium: [], high: [] };
  for (const r of results) {
    byRisk[r.risk]?.push(r);
  }

  console.log('');
  console.log(`🔍 Cron Cleanup Report`);
  console.log(`   ${results.length} of ${totalJobs} jobs flagged`);
  console.log('');

  if (byRisk.high.length > 0) {
    console.log(`🔴 HIGH RISK (${byRisk.high.length})`);
    for (const r of byRisk.high) printJob(r);
    console.log('');
  }

  if (byRisk.medium.length > 0) {
    console.log(`🟡 MEDIUM RISK (${byRisk.medium.length})`);
    for (const r of byRisk.medium) printJob(r);
    console.log('');
  }

  if (byRisk.low.length > 0) {
    console.log(`🟢 LOW RISK (${byRisk.low.length})`);
    for (const r of byRisk.low) printJob(r);
    console.log('');
  }

  console.log(`To delete flagged jobs: node cron-cleanup.mjs --dry-run`);
  console.log(`To execute:             node cron-cleanup.mjs --exec [--force]`);
}

function printJob(r) {
  const catBadges = r.categories.map(c => {
    const emoji = {
      'stale-disabled': '💤',
      'past-one-shot': '⏰',
      'never-succeeded': '❌',
      'consecutive-fail': '🔥',
      'orphaned': '👻',
    }[c] || '❓';
    return `${emoji} ${c}`;
  }).join('  ');

  console.log(`  ${r.name}`);
  console.log(`    ID: ${r.id}`);
  console.log(`    Status: ${r.enabled ? 'enabled' : 'disabled'} | Schedule: ${r.schedule} | Created: ${r.createdAt}`);
  console.log(`    Last run: ${r.lastRun}`);
  console.log(`    Flags: ${catBadges}`);
  for (const [cat, detail] of Object.entries(r.details)) {
    console.log(`      → ${detail}`);
  }
  console.log('');
}

async function handleDeletions(results) {
  const sorted = [...results].sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 };
    return (riskOrder[a.risk] || 3) - (riskOrder[b.risk] || 3);
  });

  console.log('');
  console.log(flags.dryRun ? '🧪 DRY RUN — nothing will be deleted:' : '🗑️  Deletion plan:');

  for (const r of sorted) {
    const prefix = flags.dryRun ? '[would delete]' : '[will delete]';
    console.log(`  ${prefix} ${r.name} (${r.id}) [${r.risk}] — ${r.categories.join(', ')}`);
  }

  if (flags.dryRun) {
    console.log(`\nTotal: ${sorted.length} job(s) would be removed. Remove --dry-run to execute.`);
    return;
  }

  if (!flags.force) {
    console.log('');
    const answer = await prompt(`Delete ${sorted.length} job(s)? [y/N] `);
    if (answer.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }
  }

  let deleted = 0;
  let failed = 0;

  for (const r of sorted) {
    try {
      if (flags.force) {
        execSync(`openclaw cron rm ${r.id} --force`, {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        execSync(`openclaw cron rm ${r.id}`, {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }
      console.log(`  ✅ Deleted: ${r.name}`);
      deleted++;
    } catch (err) {
      console.log(`  ❌ Failed to delete ${r.name}: ${err.message.trim()}`);
      failed++;
    }
  }

  console.log(`\nDone: ${deleted} deleted, ${failed} failed.`);
}

function prompt(question) {
  process.stdout.write(question);
  return new Promise((resolve) => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once('data', (data) => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      resolve(data.toString().trim());
    });
  });
}
