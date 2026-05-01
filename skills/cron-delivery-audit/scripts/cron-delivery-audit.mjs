#!/usr/bin/env node
// cron-delivery-audit.mjs — OpenClaw cron delivery reliability auditor
// Usage: node cron-delivery-audit.mjs [options]
//
// Focuses specifically on delivery outcomes: catches "silent failures"
// where a cron run succeeds but output never reaches its target.

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libDir = join(__dirname, '..', '..', 'shared-lib', 'scripts', 'lib');
const { parseArgs } = await import(join(libDir, 'args.mjs'));
const { section, ok, warn, error, bullet, dim } = await import(join(libDir, 'fmt.mjs'));

// --- CLI ---
const args = parseArgs(process.argv.slice(2), {
  alias: { d: 'days', n: 'runs' },
  boolean: ['json', 'fail-only', 'quiet', 'include-disabled'],
  string: ['days', 'runs', 'name'],
  default: {
    days: '3',
    runs: '20',
    json: false,
    'fail-only': false,
    quiet: false,
    name: '',
    'include-disabled': false,
  },
});

const days = parseInt(args.days, 10) || 3;
const maxRuns = parseInt(args.runs, 10) || 20;
const nameFilter = (args.name || '').toLowerCase();

// --- Helpers ---
function run(cmd) {
  try {
    const stdout = execSync(cmd, { timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
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
      status: row.Status,
      target: row.Target,
      last: row.Last,
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

function timeFilter(days) {
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  return (run) => run.runAtMs >= cutoff;
}

function fuzzyMatch(jobName, filter) {
  if (!filter) return true;
  return jobName.toLowerCase().includes(filter);
}

// --- Main ---
const listResult = run('openclaw cron list');
if (!listResult.ok) {
  error('Failed to list cron jobs: ' + listResult.stderr);
  process.exit(2);
}

const jobs = parseCronList(listResult.stdout);
const withinWindow = timeFilter(days);
const report = [];
let hasIssues = false;

for (const job of jobs) {
  if (!args['include-disabled'] && job.status === 'disabled') continue;
  if (!fuzzyMatch(job.name, nameFilter)) continue;

  const runsResult = run(`openclaw cron runs --id ${job.id} --limit ${maxRuns}`);
  const runs = parseCronRuns(runsResult.ok ? runsResult.stdout : '');
  if (!Array.isArray(runs)) continue;

  // Filter to runs within the time window
  const recentRuns = runs.filter(withinWindow);
  if (recentRuns.length === 0) continue;

  // Categorize delivery outcomes
  let delivered = 0;
  let failed = 0;
  let notRequested = 0;
  let silentFailures = 0; // status ok but delivery failed

  for (const run of recentRuns) {
    const ds = run.deliveryStatus || 'unknown';

    if (ds === 'delivered') {
      delivered++;
    } else if (ds === 'failed' || ds === 'not-delivered') {
      failed++;
      if (run.status === 'ok') silentFailures++;
    } else if (ds === 'not-requested') {
      notRequested++;
    }
    // else: unknown — count as neither pass nor fail
  }

  // Delivery rate: delivered / (total - notRequested)
  const attempted = delivered + failed;
  const deliveryRate = attempted > 0 ? delivered / attempted : null;

  const hasDeliveryIssue = failed > 0 || (deliveryRate !== null && deliveryRate < 1);
  const hasSilentFailure = silentFailures > 0;

  if (hasDeliveryIssue) hasIssues = true;

  report.push({
    name: job.name,
    id: job.id,
    schedule: job.schedule,
    status: job.status,
    target: job.target,
    runsInspected: recentRuns.length,
    delivered,
    failed,
    notRequested,
    silentFailures,
    deliveryRate: deliveryRate !== null ? Math.round(deliveryRate * 100) / 100 : null,
    deliveryRatePct: deliveryRate !== null ? Math.round(deliveryRate * 100) : null,
    severity: hasSilentFailure ? 'error' : hasDeliveryIssue ? 'warn' : 'ok',
  });
}

// Sort: worst severity first, then by delivery rate ascending
report.sort((a, b) => {
  const sev = { error: 0, warn: 1, ok: 2 };
  const diff = (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3);
  if (diff !== 0) return diff;
  return (a.deliveryRate ?? 1) - (b.deliveryRate ?? 1);
});

// --- Output ---
if (args.json) {
  process.stdout.write(JSON.stringify({ jobs: report, healthy: !hasIssues, daysWindow: days, timestamp: new Date().toISOString() }, null, 2) + '\n');
  process.exit(hasIssues ? 1 : 0);
}

if (args.quiet) {
  process.exit(hasIssues ? 1 : 0);
}

const filtered = args['fail-only']
  ? report.filter(j => j.severity !== 'ok')
  : report;

if (filtered.length === 0) {
  if (args['fail-only']) {
    ok('All cron deliveries healthy');
  } else {
    ok('No cron jobs found matching criteria');
  }
  process.exit(0);
}

// Formatted report
section(`Cron Delivery Audit (${days}-day window)`);
const okCount = filtered.filter(j => j.severity === 'ok').length;
const warnCount = filtered.filter(j => j.severity === 'warn').length;
const errCount = filtered.filter(j => j.severity === 'error').length;

if (errCount > 0 || warnCount > 0) {
  process.stdout.write(`${errCount} silent failures · ${warnCount} warnings · ${okCount} clean — ${filtered.length} jobs inspected\n\n`);
} else {
  process.stdout.write(`${okCount} clean — ${filtered.length} jobs inspected\n\n`);
}

for (const job of filtered) {
  const icon = job.severity === 'ok' ? '✅' : job.severity === 'warn' ? '⚠️' : '❌';

  const rateStr = job.deliveryRatePct !== null
    ? `${job.deliveryRatePct}% delivery rate`
    : 'no delivery configured';

  const silentStr = job.silentFailures > 0
    ? ` · ${job.silentFailures} silent failure${job.silentFailures > 1 ? 's' : ''}`
    : '';

  bullet(`${icon} ${job.name} — ${rateStr}${silentStr}`);

  const details = [
    `${job.runsInspected} runs`,
    `${job.delivered} delivered`,
    job.failed > 0 ? `${job.failed} failed` : null,
    job.notRequested > 0 ? `${job.notRequested} not requested` : null,
  ].filter(Boolean).join(' · ');

  process.stdout.write(`   ${details}\n\n`);
}

if (hasIssues) {
  warn('Tip: use `cron-run-inspector` on failed runs to diagnose root cause');
  warn('Tip: check delivery config (channel, token, permissions) for failing jobs');
}

process.exit(hasIssues ? 1 : 0);
