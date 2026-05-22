#!/usr/bin/env node
// outage-log — Track credential outage start/end times, downtime, and generate reports
// Part of the credential-outage-log skill. Zero dependencies. Node.js 18+.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const json = args.includes('--json');
const quiet = args.includes('--quiet') || args.includes('-q');

function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

const dataDir = getArg('--data-dir') || path.join(os.homedir(), '.openclaw', 'workspace', 'trackhub', 'data');
const outFile = getArg('--out-file') || path.join(dataDir, 'credential-outages.json');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`outage-log — Track credential outages with structured bookkeeping

Usage:
  node outage-log.cjs <command> [options]

Commands:
  record <service> <status>   Record a credential check result (up/down)
  resolve <service>           Manually resolve an active outage for a service
  current                     Show all currently active outages
  history [--service X]       Show outage history (optionally filtered by service)
  report                      Generate a summary report (outage counts, total downtime)
  clear-resolved              Remove resolved outages older than --days N (default 30)

Options:
  --detail <text>             Add detail text when recording an outage
  --data-dir <dir>            Directory for outage data file (default: trackhub/data)
  --out-file <path>           Override outage data file path
  --days <N>                  Days threshold for clear-resolved (default: 30)
  --service <name>            Filter by service name (for history/report)
  --json                      Output as JSON
  --quiet                     Suppress non-essential output
  --help, -h                  Show this help

Examples:
  # Record a credential failure
  node outage-log.cjs record gmail-file down --detail "Refresh token invalid"

  # Record a recovery
  node outage-log.cjs record gmail-file up

  # Show current outages
  node outage-log.cjs current

  # Generate a report
  node outage-log.cjs report

  # Clean up old resolved outages
  node outage-log.cjs clear-resolved --days 60
`);
  process.exit(0);
}

// ── Data helpers ──────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadData() {
  ensureDataDir();
  if (!fs.existsSync(outFile)) return { outages: [] };
  try {
    return JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch {
    return { outages: [] };
  }
}

function saveData(data) {
  ensureDataDir();
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8');
}

function findActiveOutage(data, service) {
  return data.outages.find(o => o.service === service && o.status === 'active');
}

// ── Commands ──────────────────────────────────────────────────────────────

function cmdRecord(service, status, detail) {
  if (!service || !status) {
    console.error('Usage: node outage-log.cjs record <service> <up|down> [--detail "text"]');
    process.exit(2);
  }
  status = status.toLowerCase();
  const data = loadData();
  const now = new Date().toISOString();
  let result;

  if (status === 'down') {
    // Check if there's already an active outage for this service
    const existing = findActiveOutage(data, service);
    if (existing) {
      // Update detail if provided, don't create duplicate
      if (detail) existing.lastDetail = detail;
      existing.lastChecked = now;
      saveData(data);
      result = { action: 'updated', service, outageId: existing.id, startedAt: existing.startedAt };
    } else {
      const outage = {
        id: `out-${Date.now()}`,
        service,
        status: 'active',
        startedAt: now,
        lastChecked: now,
        detail: detail || null,
        lastDetail: detail || null,
        resolvedAt: null,
        totalDowntimeMs: null,
      };
      data.outages.push(outage);
      saveData(data);
      result = { action: 'created', service, outageId: outage.id, startedAt: now };
    }
  } else if (status === 'up') {
    const active = findActiveOutage(data, service);
    if (active) {
      active.status = 'resolved';
      active.resolvedAt = now;
      active.totalDowntimeMs = new Date(now) - new Date(active.startedAt);
      saveData(data);
      result = { action: 'resolved', service, outageId: active.id, startedAt: active.startedAt, resolvedAt: now, downtimeMs: active.totalDowntimeMs };
    } else {
      result = { action: 'no-change', service, message: 'No active outage found' };
    }
  } else {
    console.error('Status must be "up" or "down"');
    process.exit(2);
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!quiet) {
    if (result.action === 'created') console.log(`🔴 Outage recorded: ${service} (started ${now})`);
    else if (result.action === 'updated') console.log(`🔴 Outage continues: ${service} (since ${result.startedAt})`);
    else if (result.action === 'resolved') console.log(`🟢 Outage resolved: ${service} (downtime: ${formatDuration(result.downtimeMs)})`);
    else console.log(`ℹ️ ${result.message}`);
  }
}

function cmdResolve(service) {
  if (!service) {
    console.error('Usage: node outage-log.cjs resolve <service>');
    process.exit(2);
  }
  const data = loadData();
  const active = findActiveOutage(data, service);
  if (!active) {
    if (json) console.log(JSON.stringify({ action: 'none', service, message: 'No active outage' }));
    else if (!quiet) console.log(`ℹ️ No active outage for ${service}`);
    return;
  }
  const now = new Date().toISOString();
  active.status = 'resolved';
  active.resolvedAt = now;
  active.totalDowntimeMs = new Date(now) - new Date(active.startedAt);
  saveData(data);
  const result = { action: 'resolved', service, startedAt: active.startedAt, resolvedAt: now, downtimeMs: active.totalDowntimeMs };
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (!quiet) console.log(`🟢 Resolved: ${service} (downtime: ${formatDuration(active.totalDowntimeMs)})`);
}

function cmdCurrent() {
  const data = loadData();
  const active = data.outages.filter(o => o.status === 'active');
  if (json) {
    console.log(JSON.stringify({ activeOutages: active, count: active.length }, null, 2));
    return;
  }
  if (active.length === 0) {
    if (!quiet) console.log('✅ No active outages');
    return;
  }
  console.log(`🔴 ${active.length} active outage(s):\n`);
  for (const o of active) {
    const duration = formatDuration(Date.now() - new Date(o.startedAt).getTime());
    console.log(`  ${o.service}`);
    console.log(`    Started: ${o.startedAt}`);
    console.log(`    Duration: ${duration}`);
    if (o.detail) console.log(`    Detail: ${o.detail}`);
    console.log(`    Last checked: ${o.lastChecked}`);
    console.log();
  }
}

function cmdHistory(serviceFilter) {
  const data = loadData();
  let outages = data.outages;
  if (serviceFilter) outages = outages.filter(o => o.service === serviceFilter);
  // Sort by startedAt descending
  outages.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  if (json) {
    console.log(JSON.stringify({ outages, count: outages.length }, null, 2));
    return;
  }
  if (outages.length === 0) {
    if (!quiet) console.log('ℹ️ No outage history found');
    return;
  }
  console.log(`📋 Outage history (${outages.length} events):\n`);
  for (const o of outages) {
    const icon = o.status === 'active' ? '🔴' : '🟢';
    const duration = o.totalDowntimeMs ? formatDuration(o.totalDowntimeMs) : 'ongoing';
    console.log(`  ${icon} ${o.service} — ${o.status}`);
    console.log(`    Started: ${o.startedAt}`);
    if (o.resolvedAt) console.log(`    Resolved: ${o.resolvedAt}`);
    console.log(`    Duration: ${duration}`);
    if (o.detail) console.log(`    Detail: ${o.detail}`);
    console.log();
  }
}

function cmdReport(serviceFilter) {
  const data = loadData();
  let outages = data.outages;
  if (serviceFilter) outages = outages.filter(o => o.service === serviceFilter);

  const total = outages.length;
  const active = outages.filter(o => o.status === 'active').length;
  const resolved = outages.filter(o => o.status === 'resolved').length;
  const totalDowntimeMs = outages
    .filter(o => o.totalDowntimeMs)
    .reduce((sum, o) => sum + o.totalDowntimeMs, 0);
  const activeDowntimeMs = outages
    .filter(o => o.status === 'active')
    .reduce((sum, o) => sum + (Date.now() - new Date(o.startedAt).getTime()), 0);

  // Per-service breakdown
  const byService = {};
  for (const o of outages) {
    if (!byService[o.service]) byService[o.service] = { total: 0, active: 0, resolved: 0, downtimeMs: 0 };
    byService[o.service].total++;
    if (o.status === 'active') byService[o.service].active++;
    else byService[o.service].resolved++;
    if (o.totalDowntimeMs) byService[o.service].downtimeMs += o.totalDowntimeMs;
    if (o.status === 'active') byService[o.service].downtimeMs += Date.now() - new Date(o.startedAt).getTime();
  }

  const report = {
    total,
    active,
    resolved,
    totalDowntimeResolved: totalDowntimeMs,
    totalDowntimeIncludingActive: totalDowntimeMs + activeDowntimeMs,
    byService,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('📊 Credential Outage Report\n');
  console.log(`  Total outages: ${total}`);
  console.log(`  Active: ${active} | Resolved: ${resolved}`);
  console.log(`  Resolved downtime: ${formatDuration(totalDowntimeMs)}`);
  if (active > 0) console.log(`  Active downtime: ${formatDuration(activeDowntimeMs)}`);
  console.log();
  if (Object.keys(byService).length > 0) {
    console.log('  Per-service breakdown:');
    for (const [svc, info] of Object.entries(byService)) {
      console.log(`    ${svc}: ${info.total} outages (${info.active} active, ${info.resolved} resolved) — ${formatDuration(info.downtimeMs)} downtime`);
    }
  }
}

function cmdClearResolved(days) {
  const data = loadData();
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const before = data.outages.length;
  data.outages = data.outages.filter(o => {
    if (o.status !== 'resolved') return true;
    return new Date(o.resolvedAt).getTime() > cutoff;
  });
  const removed = before - data.outages.length;
  saveData(data);
  if (json) {
    console.log(JSON.stringify({ removed, remaining: data.outages.length }));
  } else if (!quiet) {
    console.log(`🗑️ Cleared ${removed} resolved outage(s) older than ${days} days (${data.outages.length} remaining)`);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────

function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  const command = args[0];
  switch (command) {
    case 'record': {
      const service = args[1];
      const status = args[2];
      const detail = getArg('--detail');
      cmdRecord(service, status, detail);
      break;
    }
    case 'resolve':
      cmdResolve(args[1]);
      break;
    case 'current':
      cmdCurrent();
      break;
    case 'history': {
      const svc = getArg('--service');
      cmdHistory(svc);
      break;
    }
    case 'report': {
      const svc = getArg('--service');
      cmdReport(svc);
      break;
    }
    case 'clear-resolved': {
      const days = parseInt(getArg('--days') || '30', 10);
      cmdClearResolved(days);
      break;
    }
    default:
      console.error(`Unknown command: "${command}". Run with --help for usage.`);
      process.exit(2);
  }
}

try {
  main();
} catch (err) {
  if (json) {
    console.log(JSON.stringify({ status: 'error', error: err.message }));
  } else {
    console.error('❌ outage-log: ' + err.message);
  }
  process.exit(1);
}
