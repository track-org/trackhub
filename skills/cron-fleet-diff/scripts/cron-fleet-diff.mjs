#!/usr/bin/env node
/**
 * Cron Fleet Diff — compare cron fleet snapshots over time.
 *
 * Captures a point-in-time snapshot of all cron jobs and compares
 * against a previous snapshot to detect:
 *   - New jobs added
 *   - Jobs removed
 *   - Schedule changes (expr, timezone)
 *   - Payload changes
 *   - Delivery config changes
 *   - Enabled/disabled toggles
 *   - Description changes
 *
 * Usage:
 *   node cron-fleet-diff.mjs [options]
 *
 * See SKILL.md for full documentation.
 */

import { parseArgs, showHelp } from '../../shared-lib/scripts/lib/args.mjs';
import { fmt } from '../../shared-lib/scripts/lib/fmt.mjs';
import { execSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// --- Config ---

const DEFAULT_SNAP_DIR = join(homedir(), '.openclaw', 'cron-fleet-diff');
const MAX_SNAPSHOTS = 50;

// --- Argument parsing ---

const args = parseArgs(process.argv.slice(2), {
  alias: { h: 'help', j: 'json', s: 'snapshot', c: 'compare', d: 'dir' },
  boolean: ['help', 'json', 'snapshot-only', 'list', 'show-removed', 'show-payload'],
  string: ['snapshot', 'compare', 'dir', 'job', 'label'],
  default: {
    json: false,
    'snapshot-only': false,
    list: false,
    'show-removed': false,
    'show-payload': false,
    dir: DEFAULT_SNAP_DIR,
  },
});

if (args.help) {
  showHelp('cron-fleet-diff', 'Compare cron fleet snapshots — detect added/removed/changed jobs over time.', {
    '--snapshot': 'Take a snapshot now (optionally with --label "description")',
    '--compare <file>': 'Compare current fleet against a specific snapshot file',
    '--snapshot-only': 'Take a snapshot and exit (no comparison)',
    '--list': 'List all saved snapshots',
    '--job <id|name>': 'Only show changes for a specific job',
    '--label <text>': 'Label for the new snapshot (e.g. "after solis update")',
    '--dir <path>': 'Snapshot directory (default: ~/.openclaw/cron-fleet-diff)',
    '--show-removed': 'Include full details of removed jobs (not just names)',
    '--show-payload': 'Include payload diffs (can be verbose)',
    '--json': 'JSON output',
  });
}

const snapDir = args.dir;

// --- Snapshot management ---

function snapPath(filename) {
  return join(snapDir, filename);
}

function snapFilename(ts, label) {
  const base = ts.replace(/[:.]/g, '-');
  return label ? `${base}_${label.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')}.json` : `${base}.json`;
}

function ensureDir() {
  if (!existsSync(snapDir)) {
    mkdir(snapDir, { recursive: true });
  }
}

async function listSnapshots() {
  ensureDir();
  const { readdir } = await import('node:fs/promises');
  try {
    const files = await readdir(snapDir);
    return files
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// --- Get current fleet ---

function getFleet() {
  try {
    const output = execSync('openclaw cron list --json', {
      timeout: 15000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const data = JSON.parse(output.trim());
    return data.jobs || data || [];
  } catch (err) {
    if (err.stdout) {
      try {
        const data = JSON.parse(err.stdout.trim());
        return data.jobs || data || [];
      } catch {
        // Fall through
      }
    }
    console.error(`Failed to get cron fleet: ${err.message}`);
    process.exit(2);
  }
}

// --- Normalise a job for comparison ---

function normaliseJob(job) {
  return {
    id: job.id,
    name: job.name || '',
    description: job.description || '',
    enabled: job.enabled,
    schedule: job.schedule ? {
      kind: job.schedule.kind,
      expr: job.schedule.expr || '',
      tz: job.schedule.tz || '',
    } : null,
    payload: job.payload ? {
      kind: job.payload.kind,
      // Use a stable subset for comparison — avoid ordering noise
      text: (job.payload.text || '').slice(0, 2000),
      message: (job.payload.message || '').slice(0, 2000),
    } : null,
    delivery: job.delivery ? {
      mode: job.delivery.mode || '',
      channel: job.delivery.channel || '',
      to: job.delivery.to || '',
    } : null,
    sessionTarget: job.sessionTarget || '',
    agentId: job.agentId || '',
  };
}

// --- Take snapshot ---

function takeSnapshot(label) {
  ensureDir();
  const fleet = getFleet();
  const ts = new Date().toISOString();
  const snapshot = {
    timestamp: ts,
    label: label || '',
    jobs: fleet.map(normaliseJob),
    meta: {
      totalJobs: fleet.length,
      enabled: fleet.filter(j => j.enabled).length,
      disabled: fleet.filter(j => !j.enabled).length,
    },
  };
  return snapshot;
}

async function saveSnapshot(snapshot) {
  ensureDir();
  const filename = snapFilename(snapshot.timestamp, snapshot.label);
  const filepath = snapPath(filename);
  await writeFile(filepath, JSON.stringify(snapshot, null, 2), 'utf-8');

  // Prune old snapshots
  const snaps = await listSnapshots();
  if (snaps.length > MAX_SNAPSHOTS) {
    const toRemove = snaps.slice(MAX_SNAPSHOTS);
    const { unlink } = await import('node:fs/promises');
    for (const f of toRemove) {
      try { await unlink(snapPath(f)); } catch { /* ignore */ }
    }
  }

  return filepath;
}

// --- Load snapshot ---

async function loadSnapshot(pathOrFile) {
  const filepath = existsSync(pathOrFile) ? pathOrFile : snapPath(pathOrFile);
  try {
    const raw = await readFile(filepath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to load snapshot: ${err.message}`);
    process.exit(2);
  }
}

// --- Diff two snapshots ---

function diffFleet(prev, curr, opts = {}) {
  const prevMap = new Map(prev.jobs.map(j => [j.id, j]));
  const currMap = new Map(curr.jobs.map(j => [j.id, j]));

  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  // Find added and changed
  for (const [id, job] of currMap) {
    if (!prevMap.has(id)) {
      added.push(job);
    } else {
      const prev = prevMap.get(id);
      const changes = diffJob(prev, job, opts);
      if (changes.length > 0) {
        changed.push({ id, name: job.name, changes });
      } else {
        unchanged.push(job);
      }
    }
  }

  // Find removed
  for (const [id, job] of prevMap) {
    if (!currMap.has(id)) {
      removed.push(job);
    }
  }

  return { added, removed, changed, unchanged };
}

function diffJob(prev, curr, opts = {}) {
  const changes = [];

  // Name
  if (prev.name !== curr.name) {
    changes.push({ field: 'name', from: prev.name, to: curr.name });
  }

  // Description
  if (prev.description !== curr.description) {
    changes.push({ field: 'description', from: prev.description, to: curr.description });
  }

  // Enabled toggle
  if (prev.enabled !== curr.enabled) {
    changes.push({
      field: 'enabled',
      from: prev.enabled ? 'enabled' : 'disabled',
      to: curr.enabled ? 'enabled' : 'disabled',
    });
  }

  // Schedule
  if (JSON.stringify(prev.schedule) !== JSON.stringify(curr.schedule)) {
    const scheduleChanges = [];
    if (prev.schedule && curr.schedule) {
      if (prev.schedule.expr !== curr.schedule.expr) {
        scheduleChanges.push(`expr: "${prev.schedule.expr}" → "${curr.schedule.expr}"`);
      }
      if (prev.schedule.tz !== curr.schedule.tz) {
        scheduleChanges.push(`tz: "${prev.schedule.tz}" → "${curr.schedule.tz}"`);
      }
      if (prev.schedule.kind !== curr.schedule.kind) {
        scheduleChanges.push(`kind: "${prev.schedule.kind}" → "${curr.schedule.kind}"`);
      }
    }
    changes.push({ field: 'schedule', detail: scheduleChanges.join(', ') || 'schedule object changed' });
  }

  // Delivery
  if (JSON.stringify(prev.delivery) !== JSON.stringify(curr.delivery)) {
    const delChanges = [];
    if (prev.delivery && curr.delivery) {
      if (prev.delivery.mode !== curr.delivery.mode) {
        delChanges.push(`mode: "${prev.delivery.mode}" → "${curr.delivery.mode}"`);
      }
      if (prev.delivery.channel !== curr.delivery.channel) {
        delChanges.push(`channel: "${prev.delivery.channel}" → "${curr.delivery.channel}"`);
      }
      if (prev.delivery.to !== curr.delivery.to) {
        delChanges.push(`to: "${prev.delivery.to}" → "${curr.delivery.to}"`);
      }
    }
    changes.push({ field: 'delivery', detail: delChanges.join(', ') || 'delivery object changed' });
  }

  // Session target
  if (prev.sessionTarget !== curr.sessionTarget) {
    changes.push({ field: 'sessionTarget', from: prev.sessionTarget, to: curr.sessionTarget });
  }

  // Payload (only if --show-payload or if kind changed)
  if (opts.showPayload || (prev.payload?.kind !== curr.payload?.kind)) {
    if (prev.payload?.kind !== curr.payload?.kind) {
      changes.push({ field: 'payload.kind', from: prev.payload?.kind, to: curr.payload?.kind });
    }
    if (opts.showPayload && prev.payload && curr.payload) {
      if (prev.payload.text !== curr.payload.text) {
        changes.push({ field: 'payload.text', detail: 'text content changed' });
      }
      if (prev.payload.message !== curr.payload.message) {
        changes.push({ field: 'payload.message', detail: 'message content changed' });
      }
    }
  }

  return changes;
}

// --- Render output ---

function renderDiff(diff, prevSnap, currSnap, opts = {}) {
  const lines = [];

  lines.push('Cron Fleet Diff');
  lines.push('─'.repeat(30));

  // Timestamps
  const prevTs = prevSnap.timestamp.replace('T', ' ').slice(0, 19) + ' UTC';
  const currTs = currSnap.timestamp.replace('T', ' ').slice(0, 19) + ' UTC';
  lines.push(`  Previous: ${prevTs}${prevSnap.label ? ` (${prevSnap.label})` : ''}`);
  lines.push(`  Current:  ${currTs}${currSnap.label ? ` (${currSnap.label})` : ''}`);
  lines.push('');

  // Summary
  const parts = [];
  if (diff.added.length) parts.push(`+${diff.added.length} added`);
  if (diff.removed.length) parts.push(`-${diff.removed.length} removed`);
  if (diff.changed.length) parts.push(`~${diff.changed.length} changed`);
  if (diff.unchanged.length) parts.push(`${diff.unchanged.length} unchanged`);
  lines.push(`Summary: ${parts.join(', ') || 'no changes'}`);

  // Filter by job if specified
  const filterJob = opts.job;

  // Added
  if (diff.added.length > 0) {
    const filtered = filterJob
      ? diff.added.filter(j => j.name.includes(filterJob) || j.id.includes(filterJob))
      : diff.added;

    if (filtered.length > 0) {
      lines.push('');
      lines.push(`🆕 Added (${filtered.length})`);
      for (const job of filtered) {
        lines.push(`  + ${job.name} (${job.id.slice(0, 8)})`);
        lines.push(`    schedule: ${job.schedule?.expr || 'N/A'} [${job.schedule?.tz || ''}]`);
        lines.push(`    enabled: ${job.enabled ? 'yes' : 'no'}`);
        if (job.delivery?.mode && job.delivery?.mode !== 'none') {
          lines.push(`    delivery: ${job.delivery.mode} → ${job.delivery.channel}:${job.delivery.to}`);
        }
      }
    }
  }

  // Removed
  if (diff.removed.length > 0) {
    const filtered = filterJob
      ? diff.removed.filter(j => j.name.includes(filterJob) || j.id.includes(filterJob))
      : diff.removed;

    if (filtered.length > 0) {
      lines.push('');
      lines.push(`🗑️  Removed (${filtered.length})`);
      for (const job of filtered) {
        lines.push(`  - ${job.name} (${job.id.slice(0, 8)})`);
        if (opts.showRemoved) {
          lines.push(`    was: ${job.schedule?.expr || 'N/A'} [${job.schedule?.tz || ''}]`);
          if (job.description) lines.push(`    desc: ${job.description}`);
        }
      }
    }
  }

  // Changed
  if (diff.changed.length > 0) {
    const filtered = filterJob
      ? diff.changed.filter(j => j.name.includes(filterJob) || j.id.includes(filterJob))
      : diff.changed;

    if (filtered.length > 0) {
      lines.push('');
      lines.push(`🔄 Changed (${filtered.length})`);
      for (const job of filtered) {
        lines.push(`  ~ ${job.name} (${job.id.slice(0, 8)})`);
        for (const change of job.changes) {
          if (change.detail) {
            lines.push(`    ${change.field}: ${change.detail}`);
          } else {
            lines.push(`    ${change.field}: "${change.from}" → "${change.to}"`);
          }
        }
      }
    }
  }

  // Unchanged count (no details)
  if (diff.unchanged.length > 0 && !filterJob) {
    lines.push('');
    lines.push(`✅ ${diff.unchanged.length} job${diff.unchanged.length > 1 ? 's' : ''} unchanged`);
  }

  return lines.join('\n');
}

function renderDiffJson(diff, prevSnap, currSnap) {
  return JSON.stringify({
    previous: { timestamp: prevSnap.timestamp, label: prevSnap.label, totalJobs: prevSnap.meta.totalJobs },
    current: { timestamp: currSnap.timestamp, label: currSnap.label, totalJobs: currSnap.meta.totalJobs },
    summary: {
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
      unchanged: diff.unchanged.length,
    },
    added: diff.added.map(j => ({ id: j.id, name: j.name, schedule: j.schedule, enabled: j.enabled })),
    removed: diff.removed.map(j => ({ id: j.id, name: j.name })),
    changed: diff.changed,
  }, null, 2);
}

function renderList(snapshots) {
  const lines = ['Cron Fleet Snapshots', '─'.repeat(30)];

  if (snapshots.length === 0) {
    lines.push('No snapshots saved yet.');
    lines.push('Run with --snapshot to take the first one.');
    return lines.join('\n');
  }

  for (const filename of snapshots) {
    // Parse timestamp from filename
    const ts = filename.replace('.json', '').replace(/_/g, ' ').slice(0, 19);
    lines.push(`  ${ts}  ${filename}`);
  }

  lines.push(`\nTotal: ${snapshots.length} snapshot${snapshots.length > 1 ? 's' : ''}`);
  return lines.join('\n');
}

// --- Main ---

async function main() {
  // List mode
  if (args.list) {
    const snaps = await listSnapshots();
    console.log(renderList(snaps));
    return;
  }

  // Snapshot-only mode
  if (args['snapshot-only']) {
    const snapshot = takeSnapshot(args.label);
    const filepath = await saveSnapshot(snapshot);
    if (!args.json) {
      fmt.ok(`Snapshot saved: ${filepath}`);
      fmt.info(`${snapshot.meta.totalJobs} jobs (${snapshot.meta.enabled} enabled, ${snapshot.meta.disabled} disabled)`);
    } else {
      console.log(JSON.stringify({ filepath, meta: snapshot.meta }, null, 2));
    }
    return;
  }

  // Compare against specific snapshot
  if (args.compare) {
    const prevSnap = await loadSnapshot(args.compare);
    const currSnap = takeSnapshot(args.label);
    const diff = diffFleet(prevSnap, currSnap, { showPayload: args['show-payload'] });

    if (args.json) {
      console.log(renderDiffJson(diff, prevSnap, currSnap));
    } else {
      console.log(renderDiff(diff, prevSnap, currSnap, { job: args.job, showRemoved: args['show-removed'], showPayload: args['show-payload'] }));
    }
    return;
  }

  // Default: take snapshot + compare against most recent previous
  const snaps = await listSnapshots();

  if (snaps.length === 0) {
    // No previous snapshot — take first one and inform
    const snapshot = takeSnapshot(args.label);
    const filepath = await saveSnapshot(snapshot);
    if (!args.json) {
      fmt.ok(`First snapshot saved: ${filepath}`);
      fmt.info(`${snapshot.meta.totalJobs} jobs captured. Run again later to see diffs.`);
    } else {
      console.log(JSON.stringify({ filepath, meta: snapshot.meta, note: 'First snapshot — no previous to compare against' }, null, 2));
    }
    return;
  }

  // Load most recent snapshot
  const prevSnap = await loadSnapshot(snapPath(snaps[0]));

  // Take current snapshot
  const currSnap = takeSnapshot(args.label);

  // Auto-save current snapshot
  const currFilepath = await saveSnapshot(currSnap);

  // Diff
  const diff = diffFleet(prevSnap, currSnap, { showPayload: args['show-payload'] });

  if (args.json) {
    console.log(renderDiffJson(diff, prevSnap, currSnap));
  } else {
    console.log(renderDiff(diff, prevSnap, currSnap, { job: args.job, showRemoved: args['show-removed'], showPayload: args['show-payload'] }));
    fmt.info(`Snapshot saved: ${currFilepath}`);
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(2);
});
