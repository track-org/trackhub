#!/usr/bin/env node
// system-health.cjs — Check system health metrics for Linux hosts (including Raspberry Pi)
// Zero dependencies. Node.js 18+.
// Part of the trackhub skill catalogue.

'use strict';

const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

// ─── Config ────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  diskWarnPct: 80,
  memWarnPct: 85,
  cpuWarnPct: 90,
  tempWarnC: 75,
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function safeExec(cmd, fallback = '') {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return fallback;
  }
}

function parseMeminfo() {
  const raw = safeExec('cat /proc/meminfo');
  if (!raw) return null;
  const map = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)\s+kB/);
    if (m) map[m[1]] = parseInt(m[2], 10) * 1024; // convert kB → bytes
  }
  const total = map.MemTotal || 0;
  const available = map.MemAvailable || map.MemFree || 0;
  const used = total - available;
  return { total, used, available, pct: total > 0 ? (used / total) * 100 : 0 };
}

function parseCpuTemp() {
  // Try thermal zone files (works on Pi and most Linux)
  const zones = safeExec('find /sys/class/thermal/thermal_zone* -maxdepth 1 -name temp -type f 2>/dev/null');
  if (zones) {
    for (const zone of zones.split('\n')) {
      const val = parseInt(fs.readFileSync(zone, 'utf8').trim(), 10);
      if (!isNaN(val) && val > 0) {
        const celsius = val / 1000;
        const label = safeExec(`cat ${zone.replace('/temp', '/type')}`, 'thermal_zone');
        return { celsius, fahrenheit: celsius * 9 / 5 + 32, label };
      }
    }
  }
  // Fallback: vcgencmd (Raspberry Pi specific)
  const vc = safeExec('vcgencmd measure_temp 2>/dev/null');
  if (vc) {
    const m = vc.match(/([\d.]+)'?C/);
    if (m) {
      const celsius = parseFloat(m[1]);
      return { celsius, fahrenheit: celsius * 9 / 5 + 32, label: 'vcgencmd' };
    }
  }
  return null;
}

function parseCpuUsage() {
  // Get two samples 500ms apart for accurate usage
  const sample1 = parseCpuStat();
  if (!sample1) return null;
  safeExec('sleep 0.5');
  const sample2 = parseCpuStat();
  if (!sample2) return null;
  const totalDiff = sample2.total - sample1.total;
  if (totalDiff === 0) return 0;
  const idleDiff = sample2.idle - sample1.idle;
  return Math.max(0, (1 - idleDiff / totalDiff) * 100);
}

function parseCpuStat() {
  const raw = safeExec('head -1 /proc/stat');
  if (!raw) return null;
  const parts = raw.split(/\s+/).slice(1).map(Number);
  const idle = parts[3];
  const iowait = parts[4] || 0;
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle: idle + iowait, total };
}

function parseDisk() {
  const raw = safeExec("df -B1 --output=source,target,size,used,avail,pcent -x tmpfs -x devtmpfs -x squashfs 2>/dev/null");
  if (!raw) return [];
  const lines = raw.trim().split('\n').slice(1);
  return lines.map(line => {
    const parts = line.trim().split(/\s+/);
    return {
      source: parts[0],
      mount: parts[1],
      size: parseInt(parts[2], 10),
      used: parseInt(parts[3], 10),
      avail: parseInt(parts[4], 10),
      pct: parseInt(parts[5], 10),
    };
  }).filter(d => d.mount === '/' || d.mount.startsWith('/home') || d.mount.startsWith('/mnt'));
}

function getUptime() {
  const raw = safeExec('cat /proc/uptime');
  if (!raw) return null;
  const secs = parseFloat(raw.split(' ')[0]);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  return { seconds: Math.round(secs), days, hours, mins, human: `${days}d ${hours}h ${mins}m` };
}

function getLoad() {
  const raw = safeExec('cat /proc/loadavg');
  if (!raw) return null;
  const parts = raw.split(/\s+/);
  return {
    '1min': parseFloat(parts[0]),
    '5min': parseFloat(parts[1]),
    '15min': parseFloat(parts[2]),
    running: parseInt(parts[3].split('/')[0], 10),
    total: parseInt(parts[3].split('/')[1], 10),
  };
}

function getOpenClawStatus() {
  // Check if OpenClaw gateway is running
  const pid = safeExec('pgrep -f "openclaw.*gateway" || true');
  const running = pid.length > 0;
  // Get memory if running
  let mem = null;
  if (running) {
    const rss = safeExec(`ps -p ${pid.split('\n')[0]} -o rss= 2>/dev/null`);
    if (rss) mem = parseInt(rss.trim(), 10) * 1024; // KB → bytes
  }
  return { running, pid: pid.split('\n')[0] || null, memBytes: mem };
}

function getDockerContainers() {
  const raw = safeExec('docker ps --format "{{.Names}}\t{{.Status}}" 2>/dev/null');
  if (!raw || raw === '') return null; // null = docker not available
  return raw.split('\n').map(line => {
    const [name, status] = line.split('\t');
    return { name, status };
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function getWarnings(results) {
  const warnings = [];
  const { diskWarnPct, memWarnPct, cpuWarnPct, tempWarnC } = DEFAULTS;

  for (const d of results.disk) {
    if (d.pct >= diskWarnPct) warnings.push(`⚠️  Disk ${d.mount} at ${d.pct}% (threshold: ${diskWarnPct}%)`);
  }
  if (results.memory && results.memory.pct >= memWarnPct) {
    warnings.push(`⚠️  Memory at ${results.memory.pct.toFixed(1)}% (threshold: ${memWarnPct}%)`);
  }
  if (results.cpu !== null && results.cpu >= cpuWarnPct) {
    warnings.push(`⚠️  CPU at ${results.cpu.toFixed(1)}% (threshold: ${cpuWarnPct}%)`);
  }
  if (results.temperature && results.temperature.celsius >= tempWarnC) {
    warnings.push(`⚠️  Temperature at ${results.temperature.celsius.toFixed(1)}°C (threshold: ${tempWarnC}°C)`);
  }
  if (results.openclaw && !results.openclaw.running) {
    warnings.push(`⚠️  OpenClaw gateway is not running`);
  }
  return warnings;
}

function formatText(results) {
  const lines = [];
  lines.push(`🖥️  System Health — ${os.hostname()}`);
  lines.push(`   Uptime: ${results.uptime.human}`);

  if (results.cpu !== null) {
    lines.push(`   CPU:    ${results.cpu.toFixed(1)}%  (load: ${results.load['1min']} / ${results.load['5min']} / ${results.load['15min']})`);
  }

  if (results.memory) {
    lines.push(`   Memory: ${formatBytes(results.memory.used)} / ${formatBytes(results.memory.total)} (${results.memory.pct.toFixed(1)}%)`);
  }

  if (results.temperature) {
    lines.push(`   Temp:   ${results.temperature.celsius.toFixed(1)}°C (${results.temperature.fahrenheit.toFixed(1)}°F) [${results.temperature.label}]`);
  }

  lines.push(`   Disks:`);
  for (const d of results.disk) {
    const warn = d.pct >= DEFAULTS.diskWarnPct ? ' ⚠️' : '';
    lines.push(`     ${d.mount}  ${formatBytes(d.used)} / ${formatBytes(d.size)} (${d.pct}%)${warn}`);
  }

  if (results.openclaw) {
    const status = results.openclaw.running
      ? `Running (PID ${results.openclaw.pid}${results.openclaw.memBytes ? `, ${formatBytes(results.openclaw.memBytes)} RSS` : ''})`
      : 'Not running';
    lines.push(`   OpenClaw: ${status}`);
  }

  if (results.docker) {
    lines.push(`   Docker: ${results.docker.length} container(s)`);
    for (const c of results.docker) {
      lines.push(`     ${c.name}: ${c.status}`);
    }
  }

  const warnings = getWarnings(results);
  if (warnings.length > 0) {
    lines.push('');
    lines.push('⚠️  Warnings:');
    for (const w of warnings) lines.push(`   ${w}`);
  } else {
    lines.push('');
    lines.push('✅ All checks passed');
  }

  return lines.join('\n');
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { json: false, quiet: false, check: null };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--json': opts.json = true; break;
      case '--quiet': case '-q': opts.quiet = true; break;
      case '--check': opts.check = args[++i]; break;
      case '--warn-disk': DEFAULTS.diskWarnPct = parseInt(args[++i], 10); break;
      case '--warn-mem': DEFAULTS.memWarnPct = parseInt(args[++i], 10); break;
      case '--warn-cpu': DEFAULTS.cpuWarnPct = parseInt(args[++i], 10); break;
      case '--warn-temp': DEFAULTS.tempWarnC = parseInt(args[++i], 10); break;
      case '--help': case '-h':
        console.log(`system-health.cjs — System health checker for Linux hosts

Usage: node system-health.cjs [options]

Options:
  --json              Output as JSON
  --quiet, -q         Only output warnings (suppress normal output)
  --check <metric>    Only check one metric: cpu, memory, disk, temp, uptime, load, openclaw, docker
  --warn-disk <pct>   Disk warning threshold (default: ${DEFAULTS.diskWarnPct}%)
  --warn-mem <pct>    Memory warning threshold (default: ${DEFAULTS.memWarnPct}%)
  --warn-cpu <pct>    CPU warning threshold (default: ${DEFAULTS.cpuWarnPct}%)
  --warn-temp <c>     Temperature warning threshold in °C (default: ${DEFAULTS.tempWarnC}°C)
  --help, -h          Show this help

Examples:
  node system-health.cjs
  node system-health.cjs --json
  node system-health.cjs --check disk --json
  node system-health.cjs --quiet --warn-disk 90
`);
        process.exit(0);
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }
  return opts;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs();

  // If checking a single metric
  if (opts.check) {
    const check = opts.check.toLowerCase();
    let result;
    switch (check) {
      case 'cpu':
        result = { cpu: parseCpuUsage() };
        break;
      case 'memory':
      case 'mem':
        result = { memory: parseMeminfo() };
        break;
      case 'disk':
        result = { disk: parseDisk() };
        break;
      case 'temp':
      case 'temperature':
        result = { temperature: parseCpuTemp() };
        break;
      case 'uptime':
        result = { uptime: getUptime() };
        break;
      case 'load':
        result = { load: getLoad() };
        break;
      case 'openclaw':
        result = { openclaw: getOpenClawStatus() };
        break;
      case 'docker':
        result = { docker: getDockerContainers() };
        break;
      default:
        console.error(`Unknown check: "${check}". Valid: cpu, memory, disk, temp, uptime, load, openclaw, docker`);
        process.exit(1);
    }
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }

  // Collect all metrics
  const results = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpu: parseCpuUsage(),
    memory: parseMeminfo(),
    disk: parseDisk(),
    temperature: parseCpuTemp(),
    uptime: getUptime(),
    load: getLoad(),
    openclaw: getOpenClawStatus(),
    docker: getDockerContainers(),
    warnings: null, // populated below
    timestamp: new Date().toISOString(),
  };

  results.warnings = getWarnings(results);

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (opts.quiet) {
    if (results.warnings.length > 0) {
      console.log(results.warnings.join('\n'));
      process.exit(1);
    } else {
      process.exit(0);
    }
    return;
  }

  console.log(formatText(results));

  // Exit code: 1 if warnings, 0 if all good
  if (results.warnings.length > 0) process.exit(1);
}

main();
