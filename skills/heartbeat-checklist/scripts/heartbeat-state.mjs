#!/usr/bin/env node
// heartbeat-state.mjs — Read, update, and query heartbeat task state
// Usage: node heartbeat-state.mjs <command> [options]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { execSync } from 'child_process';

const DEFAULT_STATE_FILE = 'memory/heartbeat-state.json';

function resolveStateFile(fileArg) {
  if (fileArg) return resolve(fileArg);
  return DEFAULT_STATE_FILE;
}

const DEFAULT_STATE = { lastChecks: {}, lastResults: {}, windows: {} };

function loadState(filePath) {
  if (existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      // Merge with defaults to handle missing keys from older state files
      return { ...DEFAULT_STATE, ...parsed };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }
  return { ...DEFAULT_STATE };
}

function saveState(filePath, state) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
}

function now() {
  return Date.now();
}

function getLocalTime(tz) {
  const s = new Date().toLocaleString('en-US', { timeZone: tz, hour12: false });
  const [datePart, timePart] = s.split(', ');
  const [m, d, y] = datePart.split('/').map(Number);
  const [h, min, sec] = timePart.split(':').map(Number);
  return { year: y, month: m, day: d, hour: h, minute: min, second: sec };
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function timeSince(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const positional = [];
  const flags = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      flags[key] = val;
    } else {
      positional.push(args[i]);
    }
  }

  return { command, positional, flags };
}

// --- Credential Pre-flight ---

/**
 * Run credential-health checks and return parsed results.
 * Falls back gracefully if credential-health script is not found.
 */
function runCredentialHealth(checks, flags) {
  const credScript = flags['cred-script'] ||
    resolve(dirname(new URL(import.meta.url).pathname), '..', '..', 'credential-health', 'scripts', 'credential-health.cjs');

  if (!existsSync(credScript)) {
    return { available: false, reason: 'credential-health script not found', results: [] };
  }

  try {
    const checkArgs = checks.join(' ');
    const cmd = `node "${credScript}" --check ${checkArgs} --json ${flags['fail-only'] ? '--fail-only' : ''}`;
    const output = execSync(cmd, { timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const parsed = JSON.parse(output.trim());
    return { available: true, results: parsed.results || [], summary: parsed.summary || {} };
  } catch (err) {
    return { available: true, error: err.message, results: [] };
  }
}

// --- Commands ---

function cmdRead(filePath) {
  const state = loadState(filePath);
  process.stdout.write(JSON.stringify(state, null, 2) + '\n');
}

function cmdCheck(filePath, taskName, flags) {
  const state = loadState(filePath);
  const ts = now();
  state.lastChecks[taskName] = ts;
  state.lastResults[taskName] = {
    status: flags.status || 'ok',
    summary: flags.summary || null,
    timestamp: ts
  };
  saveState(filePath, state);
  process.stderr.write(`✓ Recorded check: ${taskName} → ${flags.status || 'ok'}\n`);
  process.stdout.write(JSON.stringify({ task: taskName, status: flags.status || 'ok', timestamp: ts }) + '\n');
}

/**
 * Batch-check: record multiple task results in a single call.
 * Accepts JSON via --json or positional argument.
 *
 * Input format: { "tasks": { "task-name": { "status": "ok", "summary": "..." }, ... } }
 */
function cmdBatchCheck(filePath, flags) {
  let input;
  const positionalJson = flags._ || [];

  if (flags.json) {
    try {
      input = JSON.parse(flags.json);
    } catch (e) {
      process.stderr.write(`Error: invalid JSON: ${e.message}\n`);
      process.exit(2);
    }
  } else if (positionalJson.length > 0) {
    // Try to parse the first positional arg as JSON
    try {
      input = JSON.parse(positionalJson[0]);
    } catch {
      // Treat as simple "task:status" pairs
      input = { tasks: {} };
      for (const pair of positionalJson) {
        const [name, status, ...summaryParts] = pair.split(':');
        if (name && status) {
          input.tasks[name] = { status, summary: summaryParts.join(':') || null };
        }
      }
    }
  } else {
    process.stderr.write('Error: batch-check requires --json <json> or positional task:status pairs\n');
    process.stderr.write('Example: --json \'{"tasks":{"email":{"status":"ok","summary":"3 unread"}}}\'\n');
    process.stderr.write('Example: email:ok:3 unread slack:warn:rate limited\n');
    process.exit(2);
  }

  const state = loadState(filePath);
  const ts = now();
  const results = {};

  const tasks = input.tasks || {};
  for (const [taskName, taskData] of Object.entries(tasks)) {
    const status = (taskData && taskData.status) || 'ok';
    const summary = (taskData && taskData.summary) || null;
    state.lastChecks[taskName] = ts;
    state.lastResults[taskName] = { status, summary, timestamp: ts };
    results[taskName] = { status, timestamp: ts };
  }

  saveState(filePath, state);
  const count = Object.keys(input.tasks || {}).length;
  process.stderr.write(`✓ Recorded ${count} checks\n`);
  process.stdout.write(JSON.stringify({ recorded: count, results, timestamp: ts }) + '\n');
}

function cmdShouldCheck(filePath, taskName, flags) {
  const state = loadState(filePath);
  const nowMs = now();
  const tz = flags.timezone || 'Europe/Dublin';
  const local = getLocalTime(tz);
  const nowMinutes = local.hour * 60 + local.minute;

  // Check after/before time constraints
  if (flags.after) {
    const afterMin = timeToMinutes(flags.after);
    if (nowMinutes < afterMin) {
      process.stderr.write(`⊘ ${taskName}: before ${flags.after}, skipping\n`);
      process.exit(1);
    }
  }
  if (flags.before) {
    const beforeMin = timeToMinutes(flags.before);
    if (nowMinutes >= beforeMin) {
      process.stderr.write(`⊘ ${taskName}: past ${flags.before}, skipping\n`);
      process.exit(1);
    }
  }

  // Check window constraints
  if (flags['window-start'] && flags['window-end']) {
    const startMin = timeToMinutes(flags['window-start']);
    const endMin = timeToMinutes(flags['window-end']);
    if (nowMinutes < startMin || nowMinutes >= endMin) {
      process.stderr.write(`⊘ ${taskName}: outside window ${flags['window-start']}-${flags['window-end']}, skipping\n`);
      process.exit(1);
    }
    // If already checked today within this window, skip
    const lastCheck = state.lastChecks[taskName];
    if (lastCheck) {
      const lastLocal = new Date(lastCheck).toLocaleString('en-US', {
        timeZone: tz, hour12: false
      });
      const lastDatePart = lastLocal.split(', ')[0];
      const currentDatePart = new Date().toLocaleString('en-US', {
        timeZone: tz, hour12: false
      }).split(', ')[0];
      if (lastDatePart === currentDatePart) {
        // Check if it was within the same window session
        const lastTimePart = lastLocal.split(', ')[1];
        const [lh] = lastTimePart.split(':').map(Number);
        if (lh >= startMin / 60) {
          process.stderr.write(`⊘ ${taskName}: already checked in this window, skipping\n`);
          process.exit(1);
        }
      }
    }
  }

  // Check min-interval
  const minInterval = parseInt(flags['min-interval'] || '0', 10) * 1000;
  if (minInterval > 0) {
    const lastCheck = state.lastChecks[taskName];
    if (lastCheck && (nowMs - lastCheck) < minInterval) {
      const elapsed = Math.round((nowMs - lastCheck) / 60000);
      const remaining = Math.round((minInterval - (nowMs - lastCheck)) / 60000);
      process.stderr.write(`⊘ ${taskName}: checked ${elapsed}m ago, ${remaining}m remaining, skipping\n`);
      process.exit(1);
    }
  }

  process.stderr.write(`✓ ${taskName}: due for check\n`);
  process.exit(0);
}

/**
 * Preflight: check if a task should run by combining schedule logic with credential health.
 *
 * Usage:
 *   node heartbeat-state.mjs preflight <task> --creds gmail,slack [--cred-script path]
 *
 * Exit codes:
 *   0  → Task should proceed (schedule due + all credentials ok)
 *   1  → Task should be skipped (schedule not due, or credentials failed)
 *   2  → Usage error
 *
 * Output (JSON to stdout):
 *   { "task": "...", "scheduleDue": true, "credentialsOk": true, "credResults": [...], "proceed": true }
 */
function cmdPreflight(filePath, taskName, flags) {
  const credList = flags.creds ? flags.creds.split(',').map(s => s.trim()) : [];
  const ts = now();

  // 1. Check schedule (reuse should-check logic internally)
  let scheduleDue = false;
  let scheduleReason = null;

  const state = loadState(filePath);
  const tz = flags.timezone || 'Europe/Dublin';
  const local = getLocalTime(tz);
  const nowMinutes = local.hour * 60 + local.minute;

  // Build schedule assessment
  if (flags.after) {
    const afterMin = timeToMinutes(flags.after);
    if (nowMinutes < afterMin) {
      scheduleReason = `before ${flags.after}`;
    }
  }
  if (!scheduleReason && flags.before) {
    const beforeMin = timeToMinutes(flags.before);
    if (nowMinutes >= beforeMin) {
      scheduleReason = `past ${flags.before}`;
    }
  }
  if (!scheduleReason && flags['window-start'] && flags['window-end']) {
    const startMin = timeToMinutes(flags['window-start']);
    const endMin = timeToMinutes(flags['window-end']);
    if (nowMinutes < startMin || nowMinutes >= endMin) {
      scheduleReason = `outside window ${flags['window-start']}-${flags['window-end']}`;
    } else {
      const lastCheck = state.lastChecks[taskName];
      if (lastCheck) {
        const lastLocal = new Date(lastCheck).toLocaleString('en-US', {
          timeZone: tz, hour12: false
        });
        const lastDatePart = lastLocal.split(', ')[0];
        const currentDatePart = new Date().toLocaleString('en-US', {
          timeZone: tz, hour12: false
        }).split(', ')[0];
        if (lastDatePart === currentDatePart) {
          const lastTimePart = lastLocal.split(', ')[1];
          const [lh] = lastTimePart.split(':').map(Number);
          if (lh >= startMin / 60) {
            scheduleReason = 'already checked in this window';
          }
        }
      }
    }
  }
  if (!scheduleReason) {
    const minInterval = parseInt(flags['min-interval'] || '0', 10) * 1000;
    if (minInterval > 0) {
      const lastCheck = state.lastChecks[taskName];
      if (lastCheck && (Date.now() - lastCheck) < minInterval) {
        const remaining = Math.round((minInterval - (Date.now() - lastCheck)) / 60000);
        scheduleReason = `checked ${remaining}m remaining`;
      }
    }
  }

  scheduleDue = !scheduleReason;

  // 2. Check credentials (if --creds was specified)
  let credentialsOk = true;
  let credResults = [];

  if (credList.length > 0) {
    const credHealth = runCredentialHealth(credList, flags);
    credResults = credHealth.results || [];

    if (credHealth.error) {
      credentialsOk = false;
      process.stderr.write(`⚠ Credential check errored: ${credHealth.error}\n`);
    } else {
      credentialsOk = credResults.every(r => r.status === 'ok' || r.status === 'skip');
    }
  }

  // 3. Decide
  const proceed = scheduleDue && credentialsOk;

  // 4. Auto-record skip if not proceeding
  if (!proceed && flags['auto-skip'] !== false) {
    let skipReason = null;
    if (!scheduleDue) skipReason = `schedule: ${scheduleReason}`;
    if (!credentialsOk) {
      const failedCreds = credResults.filter(r => r.status === 'fail').map(r => r.service).join(', ');
      skipReason = skipReason ? `${skipReason}; creds: ${failedCreds}` : `creds: ${failedCreds}`;
    }
    if (skipReason) {
      state.lastChecks[taskName] = ts;
      state.lastResults[taskName] = { status: 'skipped', summary: skipReason, timestamp: ts };
      saveState(filePath, state);
    }
  }

  const output = {
    task: taskName,
    scheduleDue,
    scheduleReason: scheduleReason || null,
    credentialsOk: credList.length > 0 ? credentialsOk : null,
    credResults: credResults.length > 0 ? credResults : null,
    proceed
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');

  if (!proceed) {
    process.exit(1);
  }
}

/**
 * Health-summary: one-shot heartbeat dashboard combining state + credential health + time context.
 *
 * Usage:
 *   node heartbeat-state.mjs health-summary [--creds gmail,slack,attio] [--timezone tz] [--file path]
 *
 * Outputs a JSON summary an agent can parse at the start of each heartbeat to decide what to do.
 */
function cmdHealthSummary(filePath, flags) {
  const state = loadState(filePath);
  const ts = now();
  const tz = flags.timezone || 'Europe/Dublin';
  const local = getLocalTime(tz);
  const nowMinutes = local.hour * 60 + local.minute;

  // Time context
  const quietStart = 23 * 60;
  const quietEnd = 8 * 60;
  const isQuietHours = nowMinutes >= quietStart || nowMinutes < quietEnd;
  const dayOfWeek = new Date().toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' });

  // Credential health
  const credList = flags.creds ? flags.creds.split(',').map(s => s.trim()) : [];
  let credHealth = null;
  if (credList.length > 0) {
    credHealth = runCredentialHealth(credList, flags);
  }

  // Recent check activity (last 24h)
  const oneDayAgo = ts - 86400000;
  const recentChecks = {};
  for (const [task, checkTs] of Object.entries(state.lastChecks)) {
    if (checkTs && checkTs >= oneDayAgo) {
      recentChecks[task] = {
        ...state.lastResults[task],
        checkedAt: checkTs,
        ago: timeSince(checkTs)
      };
    }
  }

  // Stale checks (not checked in >24h)
  const staleChecks = [];
  for (const [task, checkTs] of Object.entries(state.lastChecks)) {
    if (checkTs && checkTs < oneDayAgo) {
      staleChecks.push({
        task,
        lastCheck: checkTs,
        ago: timeSince(checkTs),
        lastResult: state.lastResults[task] || null
      });
    }
  }

  const summary = {
    timestamp: ts,
    time: {
      local: `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`,
      timezone: tz,
      dayOfWeek,
      quietHours: isQuietHours
    },
    tasks: {
      recent: recentChecks,
      stale: staleChecks,
      total: Object.keys(state.lastChecks).length
    },
    credentials: credHealth,
    quietHours: isQuietHours
  };

  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

function cmdOverdue(filePath, flags) {
  const state = loadState(filePath);
  const nowMs = now();
  const maxAge = parseInt(flags['max-age'] || '86400', 10) * 1000;
  const tz = flags.timezone || 'Europe/Dublin';
  const local = getLocalTime(tz);
  const nowMinutes = local.hour * 60 + local.minute;
  const quietStart = 23 * 60;
  const quietEnd = 8 * 60;
  const isQuiet = nowMinutes >= quietStart || nowMinutes < quietEnd;

  const overdue = [];

  for (const [task, lastTs] of Object.entries(state.lastChecks)) {
    if (lastTs && (nowMs - lastTs) > maxAge) {
      overdue.push({
        task,
        lastCheck: lastTs,
        ageHours: Math.round((nowMs - lastTs) / 3600000),
        lastResult: state.lastResults[task] || null
      });
    }
  }

  process.stdout.write(JSON.stringify({ overdue, quietHours: isQuiet, timestamp: nowMs }, null, 2) + '\n');
}

function cmdReset(filePath, taskName) {
  const state = loadState(filePath);
  delete state.lastChecks[taskName];
  delete state.lastResults[taskName];
  saveState(filePath, state);
  process.stderr.write(`✓ Reset: ${taskName}\n`);
}

function cmdPrune(filePath, flags) {
  const state = loadState(filePath);
  const maxAge = parseInt(flags['max-age'] || '86400', 10) * 1000;
  const nowMs = now();
  let pruned = 0;

  for (const [task, ts] of Object.entries(state.lastChecks)) {
    if (ts && (nowMs - ts) > maxAge) {
      delete state.lastChecks[task];
      delete state.lastResults[task];
      pruned++;
    }
  }

  saveState(filePath, state);
  process.stderr.write(`✓ Pruned ${pruned} stale entries\n`);
  process.stdout.write(JSON.stringify({ pruned, remaining: Object.keys(state.lastChecks).length }) + '\n');
}

function cmdHelp() {
  process.stdout.write(`
heartbeat-state.mjs — Heartbeat task state manager

Usage: node heartbeat-state.mjs <command> [options]

Commands:
  read                          Print current state JSON
  check <task>                  Record a check (marks as done now)
  batch-check                   Record multiple checks at once (--json or task:status pairs)
  should-check <task>           Exit 0 if task is due, 1 if not
  preflight <task>              Credential-aware gate: schedule + credential check combined
  health-summary                One-shot heartbeat dashboard (state + creds + time context)
  overdue                       List tasks past their interval
  reset <task>                  Clear check history for a task
  prune                         Remove entries older than --max-age
  help                          Show this help

Options (apply to relevant commands):
  --file <path>                 State file path (default: memory/heartbeat-state.json)
  --status <ok|fail|warn>       Status for 'check' command (default: ok)
  --summary <text>              Summary text for 'check' command
  --min-interval <seconds>      Minimum seconds between checks
  --after <HH:MM>               Only check after this time
  --before <HH:MM>              Only check before this time
  --window-start <HH:MM>        Window start time
  --window-end <HH:MM>          Window end time
  --timezone <tz>               Timezone (default: Europe/Dublin)
  --max-age <seconds>           Max age for overdue/prune (default: 86400)

Preflight options:
  --creds <svc1,svc2>           Credential services to check (e.g. gmail,slack,attio)
  --cred-script <path>          Path to credential-health.cjs (auto-detected)
  --fail-only                   Only report failing credentials
  --auto-skip <true|false>      Auto-record skipped tasks (default: true)

Batch-check options:
  --json <json>                 JSON object: {"tasks":{"name":{"status":"ok","summary":"..."}}}

Health-summary options:
  --creds <svc1,svc2>           Credential services to include in summary

Examples:
  # Check if email task is due (min 3h interval, business hours only)
  node heartbeat-state.mjs should-check email --min-interval 10800 --after 08:00 --before 23:00

  # Credential-aware preflight: check if email is due AND gmail creds are ok
  node heartbeat-state.mjs preflight email --creds gmail --min-interval 10800 --after 08:00

  # One-shot dashboard with credential health
  node heartbeat-state.mjs health-summary --creds gmail,slack,attio

  # Batch record results
  node heartbeat-state.mjs batch-check --json '{"tasks":{"email":{"status":"ok","summary":"2 unread"},"slack":{"status":"warn"}}}'

  # Record that a check passed
  node heartbeat-state.mjs check attio-cron --status ok --summary "No changes"

  # See what's overdue
  node heartbeat-state.mjs overdue --max-age 86400
\n`);
}

// --- Main ---

const { command, positional, flags } = parseArgs(process.argv);
const filePath = resolveStateFile(flags.file);

switch (command) {
  case 'read':
    cmdRead(filePath);
    break;
  case 'check':
    if (!positional[0]) { process.stderr.write('Error: check requires a task name\n'); process.exit(2); }
    cmdCheck(filePath, positional[0], flags);
    break;
  case 'batch-check':
    cmdBatchCheck(filePath, { ...flags, _ : positional });
    break;
  case 'should-check':
    if (!positional[0]) { process.stderr.write('Error: should-check requires a task name\n'); process.exit(2); }
    cmdShouldCheck(filePath, positional[0], flags);
    break;
  case 'preflight':
    if (!positional[0]) { process.stderr.write('Error: preflight requires a task name\n'); process.exit(2); }
    cmdPreflight(filePath, positional[0], flags);
    break;
  case 'health-summary':
    cmdHealthSummary(filePath, flags);
    break;
  case 'overdue':
    cmdOverdue(filePath, flags);
    break;
  case 'reset':
    if (!positional[0]) { process.stderr.write('Error: reset requires a task name\n'); process.exit(2); }
    cmdReset(filePath, positional[0]);
    break;
  case 'prune':
    cmdPrune(filePath, flags);
    break;
  case 'help':
  case '--help':
  case '-h':
    cmdHelp();
    break;
  default:
    process.stderr.write(`Unknown command: ${command || '(none)'}\nRun with 'help' for usage.\n`);
    process.exit(2);
}
