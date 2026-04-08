#!/usr/bin/env node
/**
 * Smart Notifier — rate-limited, deduplicating alert manager.
 *
 * Usage:
 *   node smart-notifier.mjs check   --key <name> [options]
 *   node smart-notifier.mjs record  --key <name> --message <text> [options]
 *   node smart-notifier.mjs history [--key <name>] [options]
 *   node smart-notifier.mjs prune   --max-age <seconds>
 *   node smart-notifier.mjs reset   --key <name>
 *   node smart-notifier.mjs status
 *
 * See SKILL.md for full documentation.
 */

import { parseArgs, showHelp, requireArg } from '../../shared-lib/scripts/lib/args.mjs';
import { fmt } from '../../shared-lib/scripts/lib/fmt.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

// --- State management ---

const STATE_VERSION = 1;

function emptyAlertState() {
  return {
    lastSent: null,
    lastMessage: null,
    lastLevel: null,
    lastEscalatedAt: null,
    count: { hourly: 0, daily: 0, total: 0 },
    history: [],
  };
}

async function loadState(stateFile) {
  try {
    const dir = dirname(stateFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const raw = await readFile(stateFile, 'utf-8');
    const data = JSON.parse(raw);
    if (data.version !== STATE_VERSION) {
      // Version mismatch — start fresh
      return { version: STATE_VERSION, alerts: {} };
    }
    return data;
  } catch {
    return { version: STATE_VERSION, alerts: {} };
  }
}

async function saveState(stateFile, state) {
  const dir = dirname(stateFile);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

// --- Time helpers ---

function now() {
  return Date.now();
}

function secondsAgo(ts) {
  return Math.floor((now() - ts) / 1000);
}

function isSameHour(ts) {
  const then = new Date(ts);
  const n = new Date();
  return then.getFullYear() === n.getFullYear() &&
    then.getMonth() === n.getMonth() &&
    then.getDate() === n.getDate() &&
    then.getHours() === n.getHours();
}

function isSameDay(ts) {
  const then = new Date(ts);
  const n = new Date();
  return then.getFullYear() === n.getFullYear() &&
    then.getMonth() === n.getMonth() &&
    then.getDate() === n.getDate();
}

// --- Level helpers ---

const LEVELS = ['info', 'warn', 'error', 'critical'];
const LEVEL_PRIORITY = Object.fromEntries(LEVELS.map((l, i) => [l, i]));

function escalateLevel(level) {
  const idx = LEVEL_PRIORITY[level] ?? 0;
  const next = Math.min(idx + 1, LEVELS.length - 1);
  return LEVELS[next];
}

function recomputeCounts(history) {
  let hourly = 0;
  let daily = 0;
  for (const entry of history) {
    if (isSameHour(entry.timestamp)) hourly++;
    if (isSameDay(entry.timestamp)) daily++;
  }
  return { hourly, daily, total: history.length };
}

// --- Message dedup ---

function messageHash(message) {
  const normalized = (message || '').trim().toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

// --- Commands ---

async function cmdCheck(args) {
  const key = args.key || args._[0];
  if (!key) {
    fmt.error('Missing --key');
    process.exit(1);
  }

  const stateFile = args['state-file'] || './alert-state.json';
  const cooldown = parseInt(args.cooldown || '3600', 10);
  const dedupWindow = parseInt(args['dedup-window'] || '86400', 10);
  const maxDaily = parseInt(args['max-daily'] || '10', 10);
  const maxHourly = parseInt(args['max-hourly'] || '3', 10);
  const escalateAfter = args['escalate-after'] ? parseInt(args['escalate-after'], 10) : null;
  const dryRun = !!args['dry-run'];

  const state = await loadState(stateFile);
  const alert = state.alerts[key] || emptyAlertState();

  const result = {
    key,
    shouldNotify: true,
    reason: null,
    effectiveLevel: null,
    suppressed: false,
    escalation: null,
    stats: {
      lastSentAgo: alert.lastSent ? secondsAgo(alert.lastSent) : null,
      countToday: alert.count.daily,
      countThisHour: alert.count.hourly,
      totalCount: alert.count.total,
    },
  };

  // 1. Cooldown check
  if (alert.lastSent && secondsAgo(alert.lastSent) < cooldown) {
    result.shouldNotify = false;
    result.suppressed = true;
    result.reason = 'cooldown';
    result.reasonDetail = `Last sent ${secondsAgo(alert.lastSent)}s ago, cooldown is ${cooldown}s`;
    outputResult(args, result);
    process.exit(1);
  }

  // Recompute counts from history to ensure accuracy
  if (alert.history.length > 0) {
    alert.count = recomputeCounts(alert.history);
  }

  // 2. Daily limit
  if (alert.count.daily >= maxDaily) {
    result.shouldNotify = false;
    result.suppressed = true;
    result.reason = 'daily_limit';
    result.reasonDetail = `${alert.count.daily}/${maxDaily} alerts sent today`;
    outputResult(args, result);
    process.exit(1);
  }

  // 3. Hourly limit
  if (alert.count.hourly >= maxHourly) {
    result.shouldNotify = false;
    result.suppressed = true;
    result.reason = 'hourly_limit';
    result.reasonDetail = `${alert.count.hourly}/${maxHourly} alerts sent this hour`;
    outputResult(args, result);
    process.exit(1);
  }

  // 4. Dedup check (if there's a pending message)
  if (args.message && alert.lastMessage) {
    const newHash = messageHash(args.message);
    const oldHash = messageHash(alert.lastMessage);
    if (newHash === oldHash && alert.lastSent && secondsAgo(alert.lastSent) < dedupWindow) {
      result.shouldNotify = false;
      result.suppressed = true;
      result.reason = 'duplicate';
      result.reasonDetail = `Same message sent ${secondsAgo(alert.lastSent)}s ago (within ${dedupWindow}s dedup window)`;
      outputResult(args, result);
      process.exit(1);
    }
  }

  // 5. Escalation check
  let effectiveLevel = args.level || 'info';
  if (escalateAfter && alert.lastSent) {
    const elapsed = secondsAgo(alert.lastSent);
    // Check if this is a persistent condition (history shows recent alerts)
    const recentAlerts = alert.history.filter(
      (h) => h.timestamp > now() - escalateAfter * 1000
    );
    if (recentAlerts.length >= 2) {
      const escalatedLevel = escalateLevel(alert.lastLevel || 'info');
      if (LEVEL_PRIORITY[escalatedLevel] > LEVEL_PRIORITY[effectiveLevel]) {
        effectiveLevel = escalatedLevel;
        result.escalation = {
          from: alert.lastLevel || 'info',
          to: escalatedLevel,
          reason: `${recentAlerts.length} alerts in last ${escalateAfter}s`,
        };
      }
    }
  }

  result.effectiveLevel = effectiveLevel;
  outputResult(args, result);
  // Exit 0 = should notify
}

async function cmdRecord(args) {
  const key = args.key || args._[0];
  if (!key) {
    fmt.error('Missing --key');
    process.exit(1);
  }

  const stateFile = args['state-file'] || './alert-state.json';
  const message = args.message || '';
  const level = args.level || 'info';
  const tags = args.tags ? args.tags.split(',').map((t) => t.trim()) : [];
  const dryRun = !!args['dry-run'];
  const force = !!args.force;

  if (!force && !LEVELS.includes(level)) {
    fmt.error(`Invalid level: ${level}. Must be one of: ${LEVELS.join(', ')}`);
    process.exit(1);
  }

  const state = await loadState(stateFile);
  if (!state.alerts[key]) {
    state.alerts[key] = emptyAlertState();
  }

  const alert = state.alerts[key];
  const entry = {
    timestamp: now(),
    message,
    level,
    tags,
  };

  alert.lastSent = entry.timestamp;
  alert.lastMessage = message;
  alert.lastLevel = level;
  alert.history.push(entry);

  // Keep history bounded (last 100 entries per key)
  if (alert.history.length > 100) {
    alert.history = alert.history.slice(-100);
  }

  alert.count = recomputeCounts(alert.history);

  if (dryRun) {
    if (args.json) {
      fmt.json({ dryRun: true, key, entry, updatedCounts: alert.count });
    } else {
      fmt.info(`[DRY RUN] Would record alert: ${key}`);
      fmt.bullet(`Level: ${level}`);
      fmt.bullet(`Message: ${message || '(none)'}`);
      fmt.bullet(`Tags: ${tags.join(', ') || '(none)'}`);
    }
  } else {
    await saveState(stateFile, state);
    if (args.json) {
      fmt.json({ recorded: true, key, entry, counts: alert.count });
    } else {
      fmt.ok(`Alert recorded: ${key} [${level}]`);
      if (message) fmt.bullet(message);
    }
  }
}

async function cmdHistory(args) {
  const stateFile = args['state-file'] || './alert-state.json';
  const key = args.key;
  const limit = parseInt(args.limit || '10', 10);
  const showSummary = !!args.summary;

  const state = await loadState(stateFile);
  const keys = Object.keys(state.alerts);

  if (keys.length === 0) {
    fmt.info('No alert history.');
    return;
  }

  if (showSummary) {
    const summary = {};
    for (const k of keys) {
      const alert = state.alerts[k];
      summary[k] = {
        lastSent: alert.lastSent ? new Date(alert.lastSent).toISOString() : null,
        lastSentAgo: alert.lastSent ? `${secondsAgo(alert.lastSent)}s ago` : 'never',
        lastLevel: alert.lastLevel,
        totalAlerts: alert.count.total,
        alertsToday: alert.count.daily,
        alertsThisHour: alert.count.hourly,
        lastMessage: alert.lastMessage,
      };
    }
    if (args.json) {
      fmt.json(summary);
    } else {
      fmt.section('Alert Summary');
      for (const [k, info] of Object.entries(summary)) {
        console.log(`  ${k}:`);
        console.log(`    Last: ${info.lastSentAgo} (${info.lastLevel || 'none'})`);
        console.log(`    Today: ${info.alertsToday} | This hour: ${info.alertsThisHour} | Total: ${info.totalAlerts}`);
        if (info.lastMessage) {
          console.log(`    Message: ${info.lastMessage}`);
        }
      }
    }
    return;
  }

  // Per-key history
  if (key) {
    const alert = state.alerts[key];
    if (!alert || alert.history.length === 0) {
      fmt.info(`No history for: ${key}`);
      return;
    }

    const entries = alert.history.slice(-limit).reverse();
    if (args.json) {
      fmt.json({
        key,
        totalRecords: alert.history.length,
        showing: entries.length,
        entries,
      });
    } else {
      fmt.section(`Alert History: ${key} (${alert.history.length} total)`);
      for (const entry of entries) {
        const time = new Date(entry.timestamp).toISOString();
        const ago = secondsAgo(entry.timestamp);
        console.log(`  [${entry.level}] ${time} (${ago}s ago)`);
        if (entry.message) console.log(`    ${entry.message}`);
        if (entry.tags.length) console.log(`    Tags: ${entry.tags.join(', ')}`);
      }
    }
  } else {
    // Show recent across all keys
    const all = [];
    for (const [k, alert] of Object.entries(state.alerts)) {
      for (const entry of alert.history) {
        all.push({ ...entry, key: k });
      }
    }
    all.sort((a, b) => b.timestamp - a.timestamp);
    const recent = all.slice(0, limit);

    if (args.json) {
      fmt.json({ totalRecords: all.length, showing: recent.length, entries: recent });
    } else {
      fmt.section(`Recent Alerts (${all.length} total)`);
      for (const entry of recent) {
        const time = new Date(entry.timestamp).toISOString();
        console.log(`  [${entry.level}] ${entry.key} — ${time}`);
        if (entry.message) console.log(`    ${entry.message}`);
      }
    }
  }
}

async function cmdPrune(args) {
  const stateFile = args['state-file'] || './alert-state.json';
  const maxAge = parseInt(args['max-age'] || '604800', 10); // default 7 days
  const dryRun = !!args['dry-run'];

  const state = await loadState(stateFile);
  let pruned = 0;
  let removedKeys = 0;
  const cutoff = now() - maxAge * 1000;

  for (const [key, alert] of Object.entries(state.alerts)) {
    const before = alert.history.length;
    alert.history = alert.history.filter((entry) => entry.timestamp >= cutoff);
    pruned += before - alert.history.length;

    // Recompute counts
    alert.count = recomputeCounts(alert.history);

    // Update lastSent if we pruned the most recent entry
    if (alert.history.length > 0) {
      const latest = alert.history[alert.history.length - 1];
      alert.lastSent = latest.timestamp;
      alert.lastMessage = latest.message;
      alert.lastLevel = latest.level;
    } else {
      // No history left — remove the key entirely
      delete state.alerts[key];
      removedKeys++;
    }
  }

  if (dryRun) {
    if (args.json) {
      fmt.json({ dryRun: true, entriesPruned: pruned, keysRemoved: removedKeys });
    } else {
      fmt.info(`[DRY RUN] Would prune ${pruned} entries and remove ${removedKeys} empty keys`);
    }
  } else {
    await saveState(stateFile, state);
    if (args.json) {
      fmt.json({ pruned, keysRemoved: removedKeys });
    } else {
      fmt.ok(`Pruned ${pruned} entries, removed ${removedKeys} empty keys`);
    }
  }
}

async function cmdReset(args) {
  const key = args.key || args._[0];
  if (!key) {
    fmt.error('Missing --key');
    process.exit(1);
  }

  const stateFile = args['state-file'] || './alert-state.json';
  const dryRun = !!args['dry-run'];

  const state = await loadState(stateFile);

  if (!(key in state.alerts)) {
    fmt.info(`No state for key: ${key}`);
    return;
  }

  if (dryRun) {
    fmt.info(`[DRY RUN] Would reset: ${key}`);
  } else {
    delete state.alerts[key];
    await saveState(stateFile, state);
    fmt.ok(`Reset: ${key}`);
  }
}

async function cmdStatus(args) {
  const stateFile = args['state-file'] || './alert-state.json';
  const state = await loadState(stateFile);
  const keys = Object.keys(state.alerts);

  const totalEntries = keys.reduce((sum, k) => sum + state.alerts[k].history.length, 0);
  const alertsToday = keys.reduce((sum, k) => sum + state.alerts[k].count.daily, 0);

  if (args.json) {
    fmt.json({
      stateFile,
      version: state.version,
      trackedKeys: keys.length,
      totalEntries,
      alertsToday,
      keys,
    });
  } else {
    fmt.section('Notifier Status');
    fmt.bullet(`State file: ${stateFile}`);
    fmt.bullet(`Version: ${state.version}`);
    fmt.bullet(`Tracked keys: ${keys.length}`);
    fmt.bullet(`Total entries: ${totalEntries}`);
    fmt.bullet(`Alerts today: ${alertsToday}`);
    if (keys.length > 0) {
      console.log('');
      console.log('  Keys:');
      for (const k of keys) {
        const alert = state.alerts[k];
        const ago = alert.lastSent ? `${secondsAgo(alert.lastSent)}s ago` : 'never';
        console.log(`    ${k}: ${ago} (${alert.lastLevel || 'none'}, ${alert.count.daily} today)`);
      }
    }
  }
}

// --- Output helper ---

function outputResult(args, result) {
  if (args.json) {
    fmt.json(result);
  } else {
    if (result.shouldNotify) {
      let msg = `ALLOW: ${result.key}`;
      if (result.effectiveLevel) msg += ` [${result.effectiveLevel}]`;
      if (result.escalation) {
        msg += ` (escalated ${result.escalation.from} → ${result.escalation.to})`;
      }
      fmt.ok(msg);
    } else {
      let msg = `SUPPRESS: ${result.key} — ${result.reason}`;
      if (result.reasonDetail) msg += ` (${result.reasonDetail})`;
      fmt.warn(msg);
    }
  }
}

// --- Main ---

const args = parseArgs(process.argv.slice(2), {
  alias: { h: 'help', k: 'key', f: 'state-file', c: 'cooldown', m: 'message', l: 'level', n: 'limit' },
  boolean: ['help', 'json', 'dry-run', 'force', 'summary'],
  string: ['key', 'state-file', 'cooldown', 'dedup-window', 'max-daily', 'max-hourly', 'message', 'level', 'tags', 'escalate-after', 'max-age', 'limit'],
  default: { json: false, 'dry-run': false, force: false, summary: false },
});

const command = args._[0];

if (args.help || !command) {
  showHelp(
    'smart-notifier',
    'Rate-limited, deduplicating alert manager for cron jobs and heartbeats.',
    {
      'check': 'Check if an alert should fire (exit 0=yes, 1=no)',
      'record': 'Record that an alert was sent',
      'history': 'View alert history (--summary for all keys)',
      'prune': 'Remove old alert records (--max-age seconds)',
      'reset': 'Clear history for a key',
      'status': 'Show state file stats',
      '--key <name>': 'Alert key/identifier',
      '--state-file <path>': 'Path to state file (default: ./alert-state.json)',
      '--cooldown <seconds>': 'Min seconds between same-key alerts (default: 3600)',
      '--dedup-window <seconds>': 'Dedup window in seconds (default: 86400)',
      '--max-daily <n>': 'Max alerts per key per day (default: 10)',
      '--max-hourly <n>': 'Max alerts per key per hour (default: 3)',
      '--message <text>': 'Alert message text',
      '--level <level>': 'Alert level: info|warn|error|critical (default: info)',
      '--tags <tags>': 'Comma-separated tags',
      '--escalate-after <seconds>': 'Auto-escalate if condition persists',
      '--limit <n>': 'Max history entries (default: 10)',
      '--json': 'Output as JSON',
      '--dry-run': 'Show what would happen without writing',
      '--force': 'Bypass validation (for testing)',
    },
    `  # Check if we should alert
  node smart-notifier.mjs check --key solar-export --cooldown 1800

  # Record an alert
  node smart-notifier.mjs record --key solar-export --message "Exporting 3.2kW" --level info

  # View history
  node smart-notifier.mjs history --key solar-export --limit 5

  # Summary of all alerts
  node smart-notifier.mjs history --summary`
  );
  process.exit(0);
}

// Shift command out of positional args for sub-commands that use them
args._.shift();

try {
  switch (command) {
    case 'check':
      await cmdCheck(args);
      break;
    case 'record':
      await cmdRecord(args);
      break;
    case 'history':
      await cmdHistory(args);
      break;
    case 'prune':
      await cmdPrune(args);
      break;
    case 'reset':
      await cmdReset(args);
      break;
    case 'status':
      await cmdStatus(args);
      break;
    default:
      fmt.error(`Unknown command: ${command}`);
      fmt.info('Run with --help for usage.');
      process.exit(1);
  }
} catch (err) {
  fmt.error(`Fatal: ${err.message}`);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
}
