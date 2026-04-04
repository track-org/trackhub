#!/usr/bin/env node
// cron-health.mjs — OpenClaw cron job health checker
// Usage: node cron-health.mjs [options]
//
// Inspects all cron jobs and generates a structured health report.
// Uses shared-lib for argument parsing and output formatting.

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libDir = join(__dirname, '..', '..', 'shared-lib', 'scripts', 'lib');
const { parseArgs } = await import(join(libDir, 'args.mjs'));
const { section, ok, warn, error, bullet } = await import(join(libDir, 'fmt.mjs'));

// --- Config ---
const ERROR_THRESHOLD = 3;     // consecutive errors before alerting

// --- CLI ---
const args = parseArgs(process.argv.slice(2), {
  alias: { n: 'max-runs' },
  boolean: ['json', 'fail-only', 'quiet', 'include-disabled'],
  string: ['max-runs'],
  default: {
    'max-runs': '5',
    json: false,
    'fail-only': false,
    quiet: false,
    'include-disabled': false,
  },
});

const maxRuns = parseInt(args['max-runs'], 10) || 5;

// --- Helpers ---
function run(cmd) {
  try {
    const stdout = execSync(cmd, { timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stdout: stdout.trim() };
  } catch (e) {
    return { ok: false, stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim(), code: e.status };
  }
}

/**
 * Parse openclaw cron list output using column-position detection.
 * The header line has known column names — we find their start positions
 * and slice each data row at those positions.
 */
function parseCronList(raw) {
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0];
  // Known columns in order
  const columns = ['ID', 'Name', 'Schedule', 'Next', 'Last', 'Status', 'Target', 'Agent ID', 'Model'];
  const positions = [];

  for (const col of columns) {
    const idx = header.indexOf(col);
    if (idx === -1) break;
    positions.push({ name: col, start: idx });
  }

  if (positions.length < 6) return []; // need at least through Status

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
  if (!raw || typeof raw !== 'string') return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

function severityForJob(job, runs) {
  if (job.status === 'disabled') return 'disabled';

  let severity = 'ok';

  if (job.status === 'error' || job.status === 'fail') severity = 'error';
  else if (job.status === 'idle' && (!job.last || job.last === '-')) severity = 'warn';

  if (runs.length > 0) {
    let consecutiveErrors = 0;
    for (const r of runs) {
      if (r.status === 'error' || r.status === 'fail') consecutiveErrors++;
      else break;
    }

    if (consecutiveErrors >= ERROR_THRESHOLD) severity = 'error';
    else if (consecutiveErrors > 0 && severity === 'ok') severity = 'warn';

    // Only flag actual delivery failures, not jobs that don't request delivery
    const lastRun = runs[0];
    if (lastRun && lastRun.deliveryStatus === 'failed') {
      if (severity === 'ok') severity = 'warn';
    }
  }

  return severity;
}

function countConsecutiveErrors(runs) {
  let count = 0;
  for (const r of runs) {
    if (r.status === 'error' || r.status === 'fail') count++;
    else break;
  }
  return count;
}

// --- Main ---
const listResult = run('openclaw cron list');
if (!listResult.ok) {
  error('Failed to list cron jobs: ' + listResult.stderr);
  process.exit(2);
}

const jobs = parseCronList(listResult.stdout);
const report = [];
let hasIssues = false;

for (const job of jobs) {
  if (!args['include-disabled'] && job.status === 'disabled') continue;

  const runsResult = run(`openclaw cron runs --id ${job.id} --limit ${maxRuns}`);
  const runs = parseCronRuns(runsResult.ok ? runsResult.stdout : '');
  if (!Array.isArray(runs)) continue;

  const severity = severityForJob(job, runs);
  const consecutiveErrors = countConsecutiveErrors(runs);

  if (severity !== 'ok') hasIssues = true;

  report.push({
    name: job.name,
    id: job.id,
    schedule: job.schedule,
    status: job.status,
    target: job.target,
    last: job.last,
    next: job.next,
    severity,
    recentRuns: runs.length,
    recentFailures: runs.filter(r => r.status === 'error' || r.status === 'fail').length,
    lastDeliveryStatus: runs[0]?.deliveryStatus || null,
    consecutiveErrors,
  });
}

// --- Output ---
if (args.json) {
  process.stdout.write(JSON.stringify({ jobs: report, healthy: !hasIssues, timestamp: new Date().toISOString() }, null, 2) + '\n');
  process.exit(hasIssues ? 1 : 0);
}

if (args.quiet) {
  process.exit(hasIssues ? 1 : 0);
}

if (args['fail-only']) {
  const failing = report.filter(j => j.severity !== 'ok' && j.severity !== 'disabled');
  if (failing.length === 0) {
    ok('All cron jobs healthy');
    process.exit(0);
  }
}

// Formatted report
section('Cron Health Report');
const totalJobs = report.length;
const okCount = report.filter(j => j.severity === 'ok').length;
const warnCount = report.filter(j => j.severity === 'warn').length;
const errCount = report.filter(j => j.severity === 'error').length;
const disCount = report.filter(j => j.severity === 'disabled').length;

process.stdout.write(`${okCount} healthy · ${warnCount} warnings · ${errCount} errors · ${disCount} disabled — ${totalJobs} total\n`);

process.stdout.write('\n');

for (const job of report) {
  if (args['fail-only'] && job.severity === 'ok') continue;

  const icon = job.severity === 'ok' ? '✅' : job.severity === 'warn' ? '⚠️' : job.severity === 'error' ? '❌' : '⏸️';
  const statusDetail = job.consecutiveErrors > 0
    ? ` · ${job.consecutiveErrors} consecutive error${job.consecutiveErrors > 1 ? 's' : ''}`
    : '';
  const deliveryDetail = job.lastDeliveryStatus && job.lastDeliveryStatus !== 'delivered' && job.lastDeliveryStatus !== 'not-requested'
    ? ` · delivery: ${job.lastDeliveryStatus}`
    : '';

  bullet(`${icon} ${job.name} [${job.status}]${statusDetail}${deliveryDetail}`);
  process.stdout.write(`   Schedule: ${job.schedule} · Target: ${job.target} · Last: ${job.last} · Next: ${job.next}\n\n`);
}

process.exit(hasIssues ? 1 : 0);
