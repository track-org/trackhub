#!/usr/bin/env node
// cron-orphan-detector.mjs — Find stale one-shot and orphaned OpenClaw cron jobs
// Usage: node cron-orphan-detector.mjs [options]
//
// Detects one-shot jobs that have fired but weren't deleted, disabled jobs
// that have sat unused for too long, and jobs that were created but never ran.
// Uses shared-lib for argument parsing and output formatting.

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libDir = join(__dirname, '..', '..', 'shared-lib', 'scripts', 'lib');
const { parseArgs } = await import(join(libDir, 'args.mjs'));
const { section, ok, warn, error: err, bullet } = await import(join(libDir, 'fmt.mjs'));

// --- CLI ---
const args = parseArgs(process.argv.slice(2), {
  boolean: ['json', 'dry-run', 'exec', 'force', 'fix'],
  string: ['stale-days', 'orphan-days', 'one-shot-days'],
  default: {
    json: false,
    'dry-run': false,
    exec: false,
    force: false,
    fix: false,
    'stale-days': '14',
    'orphan-days': '7',
    'one-shot-days': '1',
  },
});

// --- Helpers ---
function run(cmd, timeout = 15000) {
  try {
    const stdout = execSync(cmd, { timeout, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stdout: stdout.trim() };
  } catch (e) {
    return { ok: false, stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim(), code: e.status };
  }
}

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
      next: row.Next,
      last: row.Last,
      status: row.Status,
      target: row.Target,
    });
  }
  return jobs;
}

function parseCronRuns(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseRelativeTime(str) {
  if (!str || str === '-' || str === 'never') return null;

  const now = Date.now();

  // "Xm ago", "Xh ago", "Xd ago"
  const match = str.match(/^(\d+)(m|h|d)\s+ago$/i);
  if (match) {
    const num = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const ms = { m: 60000, h: 3600000, d: 86400000 }[unit] || 0;
    return now - (num * ms);
  }

  // "in Xd", "in Xh", "in Xm" (future)
  const futureMatch = str.match(/^in\s+(\d+)(m|h|d)$/i);
  if (futureMatch) return null; // future, not relevant

  // ISO-ish or date
  if (/^\d{4}/.test(str)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  return null;
}

function msToDays(ms) {
  return ms / 86400000;
}

function formatDuration(ms) {
  const days = Math.floor(msToDays(ms));
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours}h`;
  return `${Math.floor(ms / 60000)}m`;
}

function isOneShotSchedule(schedule) {
  if (!schedule) return false;
  const s = schedule.toLowerCase();
  // One-shot jobs show as "at <timestamp>" or "undefined (exact)" or similar
  return s.startsWith('at ') || s.includes('exact') || s === 'undefined' || s.includes('(exact)');
}

function hasCronExpression(schedule) {
  if (!schedule) return false;
  // A valid cron expr has 5 fields separated by spaces
  const parts = schedule.trim().split(/\s+/);
  return parts.length >= 5 && /^[0-9*,/-]+$/.test(parts[0]);
}

function isDeleteAfterRun(description) {
  // Check job description or name for delete-after-run indicators
  // We can't easily get this from cron list, but one-shot jobs without cron expr
  // that have fired are strong candidates
  return false;
}

// --- Main ---
const now = Date.now();

const allJobsResult = run('openclaw cron list --all 2>/dev/null');
if (!allJobsResult.ok) {
  console.error('Failed to list cron jobs:', allJobsResult.stderr || allJobsResult.stdout);
  process.exit(1);
}

const jobs = parseCronList(allJobsResult.stdout);

if (args.json) {
  // JSON mode — collect all flags
  const results = [];

  for (const job of jobs) {
    const flags = [];
    const lastMs = parseRelativeTime(job.last);

    // Category 1: Stale one-shot — one-shot schedule that has already fired
    if (isOneShotSchedule(job.schedule) && lastMs !== null) {
      const age = now - lastMs;
      const threshold = parseInt(args['one-shot-days'], 10) * 86400000;
      if (age > threshold) {
        flags.push({
          category: 'stale-one-shot',
          severity: 'medium',
          reason: `One-shot job fired ${formatDuration(age)} ago but still exists`,
          age_ms: age,
        });
      }
    }

    // Category 2: Disabled + stale — disabled for too long
    if (job.status === 'disabled' && lastMs !== null) {
      const age = now - lastMs;
      const threshold = parseInt(args['stale-days'], 10) * 86400000;
      if (age > threshold) {
        flags.push({
          category: 'stale-disabled',
          severity: 'low',
          reason: `Disabled for at least ${formatDuration(age)}`,
          age_ms: age,
        });
      }
    }

    // Category 3: Orphaned — never ran (last is "never" or similar)
    if ((job.last === '-' || job.last === 'never' || !lastMs) && job.schedule !== '-') {
      // Check if it has a valid schedule — if not, it's probably misconfigured
      if (!hasCronExpression(job.schedule) && !isOneShotSchedule(job.schedule)) {
        flags.push({
          category: 'misconfigured',
          severity: 'high',
          reason: 'No valid schedule and no runs recorded',
        });
      } else if (isOneShotSchedule(job.schedule)) {
        // One-shot with no runs — could be scheduled for the future
        const nextMs = parseRelativeTime(job.next);
        if (nextMs === null && job.next !== '-') {
          // No parseable next time — likely stale
          flags.push({
            category: 'orphaned-one-shot',
            severity: 'medium',
            reason: 'One-shot job with no runs and no parseable next run time',
          });
        }
      } else if (hasCronExpression(job.schedule)) {
        // Recurring job that's never run — give it a grace period
        // We'd need createdAt which isn't available from cron list
        // Skip for now — these might just be newly created
      }
    }

    // Category 4: Undefined/invalid schedule with past runs
    if (job.schedule === 'undefined' || (job.schedule.includes('undefined') && lastMs !== null)) {
      flags.push({
        category: 'broken-schedule',
        severity: 'high',
        reason: 'Schedule is undefined/invalid — job cannot run',
      });
    }

    // Category 5: Disabled with broken schedule (like the one that triggered this)
    if (job.status === 'disabled' && (job.schedule === 'undefined' || job.schedule.includes('undefined'))) {
      // Already flagged above if severity high, but add extra context
      if (!flags.some(f => f.category === 'broken-schedule')) {
        flags.push({
          category: 'broken-schedule',
          severity: 'high',
          reason: 'Disabled with undefined schedule — safe to remove',
        });
      }
    }

    if (flags.length > 0) {
      results.push({
        id: job.id,
        name: job.name,
        schedule: job.schedule,
        status: job.status,
        last_run: job.last,
        flags,
        max_severity: [...flags].sort((a, b) => {
          const order = { high: 0, medium: 1, low: 2 };
          return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
        })[0].severity,
      });
    }
  }

  // Sort by severity
  results.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.max_severity] ?? 3) - (order[b.max_severity] ?? 3);
  });

  console.log(JSON.stringify({ total_jobs: jobs.length, flagged: results.length, jobs: results }, null, 2));
  process.exit(0);
}

// --- Human-readable output ---
const staleDays = parseInt(args['stale-days'], 10);
const orphanDays = parseInt(args['orphan-days'], 10);
const oneShotDays = parseInt(args['one-shot-days'], 10);

const highRisk = [];
const medRisk = [];
const lowRisk = [];

for (const job of jobs) {
  const issues = [];
  const lastMs = parseRelativeTime(job.last);

  // Stale one-shot
  if (isOneShotSchedule(job.schedule) && lastMs !== null) {
    const age = now - lastMs;
    const threshold = oneShotDays * 86400000;
    if (age > threshold) {
      issues.push({ cat: 'stale-one-shot', sev: 'medium', msg: `Fired ${formatDuration(age)} ago` });
    }
  }

  // Stale disabled
  if (job.status === 'disabled' && lastMs !== null) {
    const age = now - lastMs;
    const threshold = staleDays * 86400000;
    if (age > threshold) {
      issues.push({ cat: 'stale-disabled', sev: 'low', msg: `Disabled, last ran ${formatDuration(age)} ago` });
    }
  }

  // Broken schedule
  if (job.schedule === 'undefined' || (typeof job.schedule === 'string' && job.schedule.includes('undefined'))) {
    const sev = job.status === 'disabled' ? 'medium' : 'high';
    issues.push({ cat: 'broken-schedule', sev, msg: 'Schedule is undefined/invalid' });
  }

  // Orphaned one-shot (no runs, no parseable next)
  if (isOneShotSchedule(job.schedule) && !lastMs) {
    const nextMs = parseRelativeTime(job.next);
    if (nextMs === null && job.next !== '-') {
      issues.push({ cat: 'orphaned-one-shot', sev: 'medium', msg: 'No runs, no parseable next run' });
    }
  }

  // Misconfigured (no valid schedule, no runs)
  if (!hasCronExpression(job.schedule) && !isOneShotSchedule(job.schedule) && !lastMs && job.schedule !== '-') {
    issues.push({ cat: 'misconfigured', sev: 'high', msg: 'No valid schedule, never ran' });
  }

  for (const issue of issues) {
    const entry = {
      id: job.id,
      name: job.name,
      schedule: job.schedule,
      status: job.status,
      last: job.last,
      category: issue.cat,
      message: issue.msg,
    };

    if (issue.sev === 'high') highRisk.push(entry);
    else if (issue.sev === 'medium') medRisk.push(entry);
    else lowRisk.push(entry);
  }
}

const totalFlagged = highRisk.length + medRisk.length + lowRisk.length;

if (totalFlagged === 0) {
  ok('✅ All clean — no orphaned or stale cron jobs found');
  process.exit(0);
}

section('🔍 Cron Orphan Detector');
console.log(`   ${totalFlagged} of ${jobs.length} jobs flagged\n`);

if (highRisk.length > 0) {
  console.log('🔴 HIGH RISK');
  for (const j of highRisk) {
    console.log(`  ${j.name}`);
    console.log(`    ID: ${j.id}`);
    console.log(`    Schedule: ${j.schedule} | Status: ${j.status}`);
    if (j.last && j.last !== '-') console.log(`    Last run: ${j.last}`);
    console.log(`    ⚠️  ${j.category}: ${j.message}`);
    console.log();
  }
}

if (medRisk.length > 0) {
  console.log('🟡 MEDIUM RISK');
  for (const j of medRisk) {
    console.log(`  ${j.name}`);
    console.log(`    ID: ${j.id}`);
    console.log(`    Schedule: ${j.schedule} | Status: ${j.status}`);
    if (j.last && j.last !== '-') console.log(`    Last run: ${j.last}`);
    console.log(`    ⚠️  ${j.category}: ${j.message}`);
    console.log();
  }
}

if (lowRisk.length > 0) {
  console.log('🟢 LOW RISK');
  for (const j of lowRisk) {
    console.log(`  ${j.name}`);
    console.log(`    ID: ${j.id}`);
    console.log(`    Schedule: ${j.schedule} | Status: ${j.status}`);
    if (j.last && j.last !== '-') console.log(`    Last run: ${j.last}`);
    console.log(`    ⚠️  ${j.category}: ${j.message}`);
    console.log();
  }
}

if (args.exec || args.fix) {
  const toDelete = [...highRisk, ...medRisk]; // Only auto-delete medium+ risk
  if (toDelete.length === 0) {
    ok('No medium or high risk jobs to delete');
    process.exit(0);
  }

  if (!args.force && !args['dry-run']) {
    console.log('Jobs to delete:');
    for (const j of toDelete) {
      console.log(`  • ${j.name} (${j.id}) — ${j.category}`);
    }
    console.log('\nPass --force to confirm, or --dry-run to preview.');
    process.exit(1);
  }

  if (args['dry-run']) {
    console.log('🔄 DRY RUN — would delete:');
    for (const j of toDelete) {
      console.log(`  • ${j.name} (${j.id})`);
    }
    process.exit(0);
  }

  let deleted = 0;
  let failed = 0;
  for (const j of toDelete) {
    const result = run(`openclaw cron rm ${j.id} 2>/dev/null`);
    if (result.ok) {
      console.log(`  ✅ Deleted: ${j.name}`);
      deleted++;
    } else {
      console.log(`  ❌ Failed: ${j.name} — ${result.stderr || result.stdout}`);
      failed++;
    }
  }
  console.log(`\nDone: ${deleted} deleted, ${failed} failed`);
} else {
  console.log('To delete flagged jobs: node cron-orphan-detector.mjs --dry-run');
  console.log('To execute:             node cron-orphan-detector.mjs --exec [--force]');
}

process.exit(0);
