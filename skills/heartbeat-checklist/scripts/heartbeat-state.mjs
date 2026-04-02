#!/usr/bin/env node
// heartbeat-state.mjs — Read, update, and query heartbeat task state
// Usage: node heartbeat-state.mjs <command> [options]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const DEFAULT_STATE_FILE = 'memory/heartbeat-state.json';

function resolveStateFile(fileArg) {
  if (fileArg) return fileArg;
  // Walk up to find workspace root (look for trackhub repo or workspace)
  return DEFAULT_STATE_FILE;
}

function loadState(filePath) {
  if (existsSync(filePath)) {
    try {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      return { lastChecks: {}, lastResults: {}, windows: {} };
    }
  }
  return { lastChecks: {}, lastResults: {}, windows: {} };
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
  should-check <task>           Exit 0 if task is due, 1 if not
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

Examples:
  # Check if email task is due (min 3h interval, business hours only)
  node heartbeat-state.mjs should-check email --min-interval 10800 --after 08:00 --before 23:00

  # Check if we're in the nightly build window and haven't done it yet
  node heartbeat-state.mjs should-check nightly-build --window-start 00:00 --window-end 03:00

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
  case 'should-check':
    if (!positional[0]) { process.stderr.write('Error: should-check requires a task name\n'); process.exit(2); }
    cmdShouldCheck(filePath, positional[0], flags);
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
