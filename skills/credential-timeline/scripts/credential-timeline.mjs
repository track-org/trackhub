#!/usr/bin/env node
/**
 * Credential Timeline — track credential failure/recovery history.
 *
 * Records each credential-health check result, builds a timeline,
 * and surfaces patterns like recurring failures and MTTR.
 *
 * Usage:
 *   node credential-timeline.mjs [options]
 *
 * See SKILL.md for full documentation.
 */

import { parseArgs, showHelp } from '../../shared-lib/scripts/lib/args.mjs';
import { fmt } from '../../shared-lib/scripts/lib/fmt.mjs';
import { dates } from '../../shared-lib/scripts/lib/dates.mjs';
import { execSync } from 'node:child_process';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// --- Config ---

const STATE_VERSION = 1;
const DEFAULT_STATE_PATH = join(homedir(), '.openclaw', 'credentials', 'timeline.json');
const DEFAULT_KEEP_DAYS = 30;
const MAX_RECORDS = 2000; // Hard cap to prevent unbounded growth

// --- Argument parsing ---

const args = parseArgs(process.argv.slice(2), {
  alias: { h: 'help', j: 'json', c: 'check', f: 'fail-only', a: 'analyze', t: 'timeline', d: 'keep-days' },
  boolean: ['help', 'json', 'timeline', 'fail-only', 'analyze', 'prune', 'history-only', 'reset'],
  string: ['check', 'state', 'health-script', 'keep-days'],
  default: {
    json: false,
    timeline: false,
    'fail-only': false,
    analyze: false,
    prune: false,
    'history-only': false,
    reset: false,
    'keep-days': String(DEFAULT_KEEP_DAYS),
  },
});

if (args.help) {
  showHelp('credential-timeline', 'Track credential failure/recovery history over time.', {
    '--check <services>': 'Services to check (e.g. gmail-file slack)',
    '--timeline': 'Show full event timeline',
    '--fail-only': 'Show only currently-failing services',
    '--analyze': 'Show statistical analysis (MTTR, frequency, recurring)',
    '--json': 'JSON output',
    '--state <path>': 'State file path (default: ~/.openclaw/credentials/timeline.json)',
    '--health-script <path>': 'Path to credential-health.cjs (auto-detected)',
    '--prune': 'Prune old records',
    '--keep-days <N>': 'Days to keep when pruning (default: 30)',
    '--history-only': 'Show history without recording a new check',
    '--reset': 'Delete all history',
  });
}

const statePath = args.state || DEFAULT_STATE_PATH;
const keepDays = parseInt(args['keep-days'], 10) || DEFAULT_KEEP_DAYS;

// --- Auto-detect credential-health script ---

function findHealthScript() {
  if (args['health-script']) return args['health-script'];

  const candidates = [
    join(dirname(new URL(import.meta.url).pathname), '..', '..', 'credential-health', 'scripts', 'credential-health.cjs'),
    join(dirname(new URL(import.meta.url).pathname), '..', 'credential-health', 'scripts', 'credential-health.cjs'),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // Try to find via workspace
  const workspacePaths = [
    join(homedir(), '.openclaw', 'workspace', 'trackhub', 'skills', 'credential-health', 'scripts', 'credential-health.cjs'),
  ];

  for (const c of workspacePaths) {
    if (existsSync(c)) return c;
  }

  return null;
}

// --- State management ---

function emptyState() {
  return { version: STATE_VERSION, checks: [] };
}

async function loadState() {
  try {
    if (!existsSync(statePath)) return emptyState();
    const raw = await readFile(statePath, 'utf-8');
    const data = JSON.parse(raw);
    if (data.version !== STATE_VERSION) return emptyState();
    return data;
  } catch {
    return emptyState();
  }
}

async function saveState(state) {
  const dir = dirname(statePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

// --- Run credential-health ---

function runHealthCheck(services) {
  const script = findHealthScript();
  if (!script) {
    return { error: 'credential-health.cjs not found. Use --health-script to specify path.' };
  }

  let cmd = `node "${script}" --json`;
  if (services) {
    cmd += ` --check ${services}`;
  }

  try {
    const output = execSync(cmd, {
      timeout: 15000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    return JSON.parse(output.trim());
  } catch (err) {
    // credential-health exits with code 1 on failures but still outputs JSON
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout.trim());
      } catch {
        // Fall through
      }
    }
    return { error: `credential-health failed: ${err.message}`, results: [] };
  }
}

// --- Record a check ---

function recordCheck(state, healthResult) {
  if (!healthResult || !healthResult.results) return state;

  const check = {
    timestamp: healthResult.timestamp || new Date().toISOString(),
    results: {},
  };

  for (const r of healthResult.results) {
    check.results[r.service] = {
      status: r.status,
      detail: r.detail || '',
    };
  }

  // Only record if we have results
  if (Object.keys(check.results).length > 0) {
    state.checks.push(check);

    // Hard cap
    if (state.checks.length > MAX_RECORDS) {
      state.checks = state.checks.slice(-MAX_RECORDS);
    }
  }

  return state;
}

// --- Prune old records ---

function pruneState(state, maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  state.checks = state.checks.filter(c => new Date(c.timestamp).getTime() > cutoff);
  return state;
}

// --- Analysis ---

function analyzeService(checks, service) {
  const serviceChecks = checks
    .filter(c => service in c.results)
    .map(c => ({
      timestamp: new Date(c.timestamp).getTime(),
      status: c.results[service].status,
      detail: c.results[service].detail || '',
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (serviceChecks.length === 0) return null;

  const failures = serviceChecks.filter(c => c.status === 'fail');
  const okChecks = serviceChecks.filter(c => c.status === 'ok');

  // Current streak (from most recent)
  let currentStreak = 0;
  let currentStatus = null;
  for (let i = serviceChecks.length - 1; i >= 0; i--) {
    if (currentStatus === null) {
      currentStatus = serviceChecks[i].status;
      currentStreak = 1;
    } else if (serviceChecks[i].status === currentStatus) {
      currentStreak++;
    } else {
      break;
    }
  }

  const currentSince = currentStreak > 0
    ? serviceChecks[serviceChecks.length - currentStreak].timestamp
    : null;

  // Failure episodes (consecutive fail runs)
  const episodes = [];
  let inEpisode = false;
  let episodeStart = null;

  for (const check of serviceChecks) {
    if (check.status === 'fail') {
      if (!inEpisode) {
        inEpisode = true;
        episodeStart = check.timestamp;
      }
    } else {
      if (inEpisode) {
        episodes.push({
          start: episodeStart,
          end: check.timestamp, // first ok after failure
          count: 0,
        });
        inEpisode = false;
      }
    }
  }

  // Count checks per episode
  for (const episode of episodes) {
    episode.count = serviceChecks.filter(
      c => c.status === 'fail' && c.timestamp >= episode.start && c.timestamp < episode.end
    ).length;
  }

  // Handle ongoing episode
  if (inEpisode) {
    episodes.push({
      start: episodeStart,
      end: null, // still failing
      count: serviceChecks.filter(c => c.status === 'fail' && c.timestamp >= episodeStart).length,
    });
  }

  // MTTR (mean time to recovery)
  const recoveredEpisodes = episodes.filter(e => e.end !== null);
  let mttr = null;
  if (recoveredEpisodes.length > 0) {
    const totalRecoveryMs = recoveredEpisodes.reduce((sum, e) => sum + (e.end - e.start), 0);
    mttr = Math.round(totalRecoveryMs / recoveredEpisodes.length);
  }

  // Mean time between failures
  let mtbf = null;
  if (episodes.length > 1) {
    const intervals = [];
    for (let i = 1; i < episodes.length; i++) {
      const prevEnd = episodes[i - 1].end || episodes[i - 1].start;
      intervals.push(episodes[i].start - prevEnd);
    }
    if (intervals.length > 0) {
      mtbf = Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length);
    }
  }

  // Last ok timestamp
  const lastOk = okChecks.length > 0
    ? okChecks[okChecks.length - 1].timestamp
    : null;

  // First check timestamp
  const firstCheck = serviceChecks.length > 0 ? serviceChecks[0].timestamp : null;
  const lastCheck = serviceChecks.length > 0 ? serviceChecks[serviceChecks.length - 1].timestamp : null;

  return {
    totalChecks: serviceChecks.length,
    failures: failures.length,
    ok: okChecks.length,
    failureRate: serviceChecks.length > 0 ? (failures.length / serviceChecks.length * 100).toFixed(1) : '0',
    currentStatus,
    currentStreak,
    currentSince,
    lastOk,
    episodes,
    mttr,
    mtbf,
    failureCount: episodes.length,
    recurring: episodes.length >= 2,
    firstCheck,
    lastCheck,
    daysCovered: firstCheck && lastCheck
      ? ((lastCheck - firstCheck) / (1000 * 60 * 60 * 24)).toFixed(1)
      : '0',
  };
}

// --- Formatting helpers ---

function formatDuration(ms) {
  if (ms === null) return 'N/A';
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTimestamp(ts) {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function formatRelative(ts) {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours}h ago`;
  return 'just now';
}

// --- Output: Summary ---

function renderSummary(state, analysisMap) {
  const lines = ['Credential Timeline', '─'.repeat(25)];

  if (state.checks.length === 0) {
    lines.push('No checks recorded yet. Run without --history-only to record the first check.');
    return lines.join('\n');
  }

  const lastCheck = state.checks[state.checks.length - 1];
  lines.push(`Last check: ${formatTimestamp(lastCheck.timestamp)}`);
  lines.push('');

  // Sort: failing first, then alphabetically
  const services = Object.keys(analysisMap).sort((a, b) => {
    const aFail = analysisMap[a]?.currentStatus === 'fail' ? 0 : 1;
    const bFail = analysisMap[b]?.currentStatus === 'fail' ? 0 : 1;
    return aFail - bFail || a.localeCompare(b);
  });

  for (const service of services) {
    const analysis = analysisMap[service];
    if (!analysis) continue;

    if (args['fail-only'] && analysis.currentStatus !== 'fail') continue;

    const icon = analysis.currentStatus === 'fail' ? '❌' : '✅';
    const statusLabel = analysis.currentStatus === 'fail' ? 'FAILING' : 'OK';
    const streakInfo = analysis.currentStatus === 'fail'
      ? `for ${formatDuration(Date.now() - analysis.currentSince)} (${analysis.currentStreak} consecutive fails)`
      : `(${analysis.currentStreak} consecutive ok${analysis.lastOk === null ? '' : `, last fail: ${formatRelative(analysis.lastOk)}`})`;

    lines.push(`${icon} ${service.padEnd(14)} ${statusLabel.padEnd(8)} ${streakInfo}`);

    // Extra detail for failing services
    if (analysis.currentStatus === 'fail') {
      const lastFailDetail = state.checks
        .filter(c => service in c.results && c.results[service].status === 'fail')
        .pop();

      if (lastFailDetail) {
        lines.push(`   Detail: ${lastFailDetail.results[service].detail}`);
      }

      if (analysis.lastOk) {
        lines.push(`   Last ok: ${formatTimestamp(analysis.lastOk)}`);
      }

      if (analysis.recurring) {
        lines.push(`   ⚠️  RECURRING — has failed ${analysis.failureCount} time${analysis.failureCount > 1 ? 's' : ''} in ${analysis.daysCovered} days`);
      }
    }
  }

  lines.push('');
  const firstTs = new Date(state.checks[0].timestamp).getTime();
  const lastTs = new Date(lastCheck.timestamp).getTime();
  const daysCovered = ((lastTs - firstTs) / (1000 * 60 * 60 * 24)).toFixed(1);
  lines.push(`Records: ${state.checks.length} checks over ${daysCovered} days`);

  return lines.join('\n');
}

// --- Output: Timeline ---

function renderTimeline(state, analysisMap) {
  const lines = ['Credential Timeline', '─'.repeat(25)];

  if (state.checks.length === 0) {
    lines.push('No checks recorded yet.');
    return lines.join('\n');
  }

  // Get all services
  const allServices = new Set();
  for (const check of state.checks) {
    for (const service of Object.keys(check.results)) {
      allServices.add(service);
    }
  }

  // Filter to specific check services if requested
  const targetServices = args.check ? args.check.split(/\s+/) : [...allServices].sort();

  for (const service of targetServices) {
    const checks = state.checks.filter(c => service in c.results);
    if (checks.length === 0) continue;

    if (args['fail-only']) {
      const analysis = analysisMap[service];
      if (!analysis || analysis.currentStatus !== 'fail') continue;
    }

    lines.push(`${service}`);
    for (const check of checks) {
      const r = check.results[service];
      const icon = r.status === 'ok' ? '✅' : '❌';
      const detail = r.status === 'fail' ? ` — ${r.detail}` : '';
      lines.push(`  ${formatTimestamp(check.timestamp)}  ${icon} ${r.status}${detail}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- Output: Analysis ---

function renderAnalysis(state, analysisMap) {
  const lines = [`Credential Analysis (last ${keepDays} days)`, '─'.repeat(35)];

  if (Object.keys(analysisMap).length === 0) {
    lines.push('No data to analyze.');
    return lines.join('\n');
  }

  const services = Object.keys(analysisMap).sort();

  for (const service of services) {
    const a = analysisMap[service];
    if (!a) continue;

    lines.push('');
    lines.push(service);
    lines.push(`  Total checks:  ${a.totalChecks}`);
    lines.push(`  Failures:      ${a.failures} (${a.failureRate}%)`);

    if (a.currentStatus === 'fail') {
      lines.push(`  Current streak: ${a.currentStreak} fails (since ${formatTimestamp(a.currentSince)})`);
    } else {
      lines.push(`  Uptime:        ${a.ok > 0 ? ((a.ok / a.totalChecks) * 100).toFixed(1) : '0'}%`);
      lines.push(`  Current streak: ${a.currentStreak} ok`);
    }

    if (a.mttr !== null) {
      lines.push(`  MTTR:          ${formatDuration(a.mttr)}`);
    } else if (a.currentStatus === 'fail') {
      lines.push(`  MTTR:          N/A (still failing)`);
    }

    if (a.mtbf !== null) {
      lines.push(`  Mean time between failures: ${formatDuration(a.mtbf)}`);
    }

    if (a.recurring) {
      lines.push(`  ⚠️  RECURRING — ${a.failureCount} failure episode${a.failureCount > 1 ? 's' : ''} in ${a.daysCovered} days`);
    }
  }

  return lines.join('\n');
}

// --- Output: JSON ---

function renderJson(state, analysisMap) {
  const output = {
    timestamp: new Date().toISOString(),
    current: {},
    analysis: {},
    records: state.checks.length,
  };

  for (const [service, analysis] of Object.entries(analysisMap)) {
    if (!analysis) continue;

    output.current[service] = {
      status: analysis.currentStatus,
      streak: analysis.currentStreak,
      since: analysis.currentSince ? new Date(analysis.currentSince).toISOString() : null,
      detail: '',
    };

    // Get latest detail
    const lastCheck = [...state.checks].reverse().find(c => service in c.results);
    if (lastCheck) {
      output.current[service].detail = lastCheck.results[service].detail || '';
    }

    output.analysis[service] = {
      totalChecks: analysis.totalChecks,
      failures: analysis.failures,
      failureRate: parseFloat(analysis.failureRate),
      mttr: analysis.mttr,
      mtbf: analysis.mtbf,
      failureCount: analysis.failureCount,
      recurring: analysis.recurring,
      daysCovered: parseFloat(analysis.daysCovered),
    };
  }

  return JSON.stringify(output, null, 2);
}

// --- Main ---

async function main() {
  // Handle reset
  if (args.reset) {
    if (existsSync(statePath)) {
      await unlink(statePath);
      console.log('Credential timeline history cleared.');
    } else {
      console.log('No history to clear.');
    }
    return;
  }

  let state = await loadState();

  // Record a new check (unless --history-only)
  if (!args['history-only']) {
    const services = args.check || null;
    const healthResult = runHealthCheck(services);

    if (healthResult.error) {
      console.error(`Error: ${healthResult.error}`);
      process.exit(2);
    }

    state = recordCheck(state, healthResult);
  }

  // Prune if requested
  if (args.prune) {
    const maxAgeMs = keepDays * 24 * 60 * 60 * 1000;
    const before = state.checks.length;
    state = pruneState(state, maxAgeMs);
    const removed = before - state.checks.length;
    if (!args.json) {
      console.log(`Pruned ${removed} old records (kept ${state.checks.length}).`);
    }
  }

  // Save state
  await saveState(state);

  // Build analysis for all services
  const allServices = new Set();
  for (const check of state.checks) {
    for (const service of Object.keys(check.results)) {
      allServices.add(service);
    }
  }

  const analysisMap = {};
  for (const service of allServices) {
    analysisMap[service] = analyzeService(state.checks, service);
  }

  // Output
  if (args.json) {
    console.log(renderJson(state, analysisMap));
  } else if (args.timeline) {
    console.log(renderTimeline(state, analysisMap));
  } else if (args.analyze) {
    console.log(renderAnalysis(state, analysisMap));
  } else {
    console.log(renderSummary(state, analysisMap));
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(2);
});
