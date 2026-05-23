#!/usr/bin/env node

/**
 * cron-backup.mjs — Export/import OpenClaw cron job configurations as versioned JSON snapshots.
 *
 * Zero dependencies. Node.js 18+.
 *
 * Usage:
 *   node cron-backup.mjs export [--dir DIR] [--max-backups N] [--job NAME_OR_ID] [--json]
 *   node cron-backup.mjs import [--dir DIR] [--file FILE] [--job NAME_OR_ID] [--dry-run] [--force] [--json]
 *   node cron-backup.mjs list  [--dir DIR] [--json]
 *   node cron-backup.mjs diff  [--dir DIR] [--file FILE] [--json]
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync, statSync } from "fs";
import { join, basename } from "path";

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _command: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir" || a === "-d") { args.dir = argv[++i]; continue; }
    if (a === "--file" || a === "-f") { args.file = argv[++i]; continue; }
    if (a === "--job" || a === "-j") { args.job = argv[++i]; continue; }
    if (a === "--max-backups" || a === "-m") { args.maxBackups = parseInt(argv[++i], 10); continue; }
    if (a === "--dry-run") { args.dryRun = true; continue; }
    if (a === "--force") { args.force = true; continue; }
    if (a === "--json") { args.json = true; continue; }
    if (a === "--help" || a === "-h") { args.help = true; continue; }
    console.error(`Unknown flag: ${a}`);
    process.exit(1);
  }
  return args;
}

function usage() {
  console.log(`Usage:
  cron-backup.mjs export [--dir DIR] [--max-backups N] [--job NAME_OR_ID] [--json]
  cron-backup.mjs import [--dir DIR] [--file FILE] [--job NAME_OR_ID] [--dry-run] [--force] [--json]
  cron-backup.mjs list   [--dir DIR] [--json]
  cron-backup.mjs diff   [--dir DIR] [--file FILE] [--json]`);
  process.exit(0);
}

function getCronJobs() {
  try {
    const raw = execSync("openclaw cron list --json", { encoding: "utf-8", timeout: 15000 });
    const parsed = JSON.parse(raw);
    return parsed.jobs || [];
  } catch (err) {
    console.error("Failed to list cron jobs:", err.message);
    process.exit(1);
  }
}

function stripState(job) {
  const { state, ...config } = job;
  return config;
}

function findJob(jobs, nameOrId) {
  return jobs.find(j => j.id === nameOrId || j.name === nameOrId);
}

function getLatestBackup(dir) {
  const files = listBackupFiles(dir);
  return files.length > 0 ? files[files.length - 1] : null;
}

function listBackupFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.startsWith("cron-backup-") && f.endsWith(".json"))
    .sort();
}

function loadBackup(filePath) {
  if (!existsSync(filePath)) {
    console.error(`Backup file not found: ${filePath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function hostname() {
  try { return execSync("hostname", { encoding: "utf-8" }).trim(); }
  catch { return "unknown"; }
}

function rotateBackups(dir, maxBackups) {
  const files = listBackupFiles(dir);
  while (files.length > maxBackups) {
    const oldest = files.shift();
    unlinkSync(join(dir, oldest));
  }
}

function deepDiff(a, b, prefix = "") {
  const changes = [];
  if (typeof a !== typeof b || a === null || b === null) {
    if (a !== b) changes.push({ path: prefix || ".", from: a, to: b });
    return changes;
  }
  if (typeof a !== "object") {
    if (a !== b) changes.push({ path: prefix || ".", from: a, to: b });
    return changes;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    changes.push({ path: prefix || ".", from: a, to: b });
    return changes;
  }
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of allKeys) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (!(k in a)) changes.push({ path: p, from: undefined, to: b[k] });
    else if (!(k in b)) changes.push({ path: p, from: a[k], to: undefined });
    else changes.push(...deepDiff(a[k], b[k], p));
  }
  return changes;
}

// ─── Commands ───────────────────────────────────────────────────────────────

function cmdExport(args) {
  const dir = args.dir || "./backups";
  const maxBackups = args.maxBackups || 10;

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let jobs = getCronJobs();

  if (args.job) {
    const job = findJob(jobs, args.job);
    if (!job) {
      console.error(`Job not found: ${args.job}`);
      process.exit(1);
    }
    jobs = [job];
  }

  const configs = jobs.map(stripState);

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-");
  const filename = `cron-backup-${ts}.json`;
  const filePath = join(dir, filename);

  const backup = {
    schema: "cron-backup-v1",
    exportedAt: now.toISOString(),
    hostname: hostname(),
    jobCount: configs.length,
    jobs: configs,
  };

  writeFileSync(filePath, JSON.stringify(backup, null, 2) + "\n");

  rotateBackups(dir, maxBackups);

  if (args.json) {
    console.log(JSON.stringify({ file: filePath, jobCount: backup.jobCount, exportedAt: backup.exportedAt }));
  } else {
    console.log(`✅ Backed up ${backup.jobCount} job(s) to ${filePath}`);
  }
}

function cmdList(args) {
  const dir = args.dir || "./backups";
  const files = listBackupFiles(dir);

  if (files.length === 0) {
    if (args.json) { console.log("[]"); }
    else { console.log("No backups found in " + dir); }
    return;
  }

  const entries = files.map(f => {
    const data = loadBackup(join(dir, f));
    return { file: f, jobCount: data.jobCount, exportedAt: data.exportedAt, hostname: data.hostname };
  });

  if (args.json) {
    console.log(JSON.stringify(entries));
  } else {
    console.log(`📂 ${entries.length} backup(s) in ${dir}\n`);
    for (const e of entries) {
      const size = statSync(join(dir, e.file)).size;
      console.log(`  ${e.file}  (${e.jobCount} jobs, ${(size / 1024).toFixed(1)} KB, ${e.exportedAt})`);
    }
  }
}

function cmdImport(args) {
  const dir = args.dir || "./backups";

  let backupFile;
  if (args.file) {
    backupFile = args.file;
  } else {
    const latest = getLatestBackup(dir);
    if (!latest) {
      console.error("No backups found to import from.");
      process.exit(1);
    }
    backupFile = join(dir, latest);
  }

  const backup = loadBackup(backupFile);
  const currentJobs = getCronJobs();
  const currentMap = new Map(currentJobs.map(j => [j.id, j]));

  let targetJobs = backup.jobs;
  if (args.job) {
    const match = targetJobs.find(j => j.id === args.job || j.name === args.job);
    if (!match) {
      console.error(`Job not found in backup: ${args.job}`);
      process.exit(1);
    }
    targetJobs = [match];
  }

  const toAdd = [];
  const toUpdate = [];
  const unchanged = [];

  for (const bj of targetJobs) {
    const current = currentMap.get(bj.id);
    if (!current) {
      toAdd.push(bj);
    } else {
      const currentConfig = stripState(current);
      const diff = deepDiff(currentConfig, bj);
      if (diff.length > 0) {
        toUpdate.push({ job: bj, diff });
      } else {
        unchanged.push(bj);
      }
    }
  }

  // Jobs in current but not in backup (would be deleted) — we don't delete by default
  const backupIds = new Set(targetJobs.map(j => j.id));
  const extraInCurrent = currentJobs.filter(j => !backupIds.has(j.id));

  if (args.dryRun || !args.json) {
    console.log(`Backup: ${backupFile} (${backup.exportedAt})`);
    console.log(`Target: ${targetJobs.length} job(s) from backup, ${currentJobs.length} current job(s)\n`);

    if (toAdd.length > 0) {
      console.log(`➕ ${toAdd.length} job(s) to add:`);
      for (const j of toAdd) console.log(`   - ${j.name} (${j.id})`);
      console.log();
    }
    if (toUpdate.length > 0) {
      console.log(`✏️  ${toUpdate.length} job(s) to update:`);
      for (const { job, diff } of toUpdate) {
        console.log(`   - ${job.name} (${job.id}): ${diff.length} field(s) changed`);
        for (const d of diff.slice(0, 5)) {
          console.log(`     ${d.path}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`);
        }
        if (diff.length > 5) console.log(`     ... and ${diff.length - 5} more`);
      }
      console.log();
    }
    if (unchanged.length > 0) {
      console.log(`✅ ${unchanged.length} job(s) unchanged`);
    }
  }

  if (toUpdate.length > 0 && !args.force) {
    console.log(`\n⚠️  ${toUpdate.length} job(s) have config drift. Use --force to overwrite, or remove --dry-run to only add missing jobs.`);
    if (!args.dryRun) {
      // Still add missing jobs even without --force
    }
  }

  if (args.dryRun) {
    const hasChanges = toAdd.length > 0 || (toUpdate.length > 0 && args.force);
    process.exit(hasChanges ? 2 : 0);
  }

  // Add missing jobs
  for (const bj of toAdd) {
    try {
      // Build openclaw cron add command
      const addArgs = buildAddArgs(bj);
      console.log(`Adding: ${bj.name}`);
      if (!args.json) console.log(`  → openclaw cron add ${addArgs.join(" ")}`);
      const result = execSync(`openclaw cron add ${addArgs.join(" ")}`, { encoding: "utf-8", timeout: 15000 });
      if (!args.json) console.log(`  ✅ ${result.trim()}`);
    } catch (err) {
      console.error(`  ❌ Failed to add ${bj.name}: ${err.message}`);
    }
  }

  // Update drifted jobs (only with --force)
  if (args.force) {
    for (const { job: bj } of toUpdate) {
      try {
        console.log(`Updating: ${bj.name}`);
        // Use openclaw cron edit for each field
        const edits = buildEditPayload(bj);
        const tmpFile = `/tmp/cron-restore-${bj.id}.json`;
        writeFileSync(tmpFile, JSON.stringify(edits));
        execSync(`openclaw cron edit ${bj.id} --payload-file ${tmpFile}`, { encoding: "utf-8", timeout: 15000 });
        if (!args.json) console.log(`  ✅ Updated`);
        try { unlinkSync(tmpFile); } catch {}
      } catch (err) {
        console.error(`  ❌ Failed to update ${bj.name}: ${err.message}`);
      }
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ added: toAdd.length, updated: args.force ? toUpdate.length : 0, unchanged: unchanged.length }));
  }
}

function buildAddArgs(job) {
  const args = [];
  args.push(`--name "${job.name.replace(/"/g, '\\"')}"`);
  if (job.description) args.push(`--description "${job.description.replace(/"/g, '\\"')}"`);
  if (job.schedule) {
    args.push(`--schedule '${JSON.stringify(job.schedule)}'`);
  }
  if (job.sessionTarget) args.push(`--session-target ${job.sessionTarget}`);
  if (job.enabled !== undefined) args.push(job.enabled ? "--enable" : "--disable");
  if (job.payload) {
    const tmpPayload = `/tmp/cron-restore-payload-${job.id}.json`;
    writeFileSync(tmpPayload, JSON.stringify(job.payload));
    args.push(`--payload-file ${tmpPayload}`);
  }
  if (job.delivery) {
    const tmpDel = `/tmp/cron-restore-delivery-${job.id}.json`;
    writeFileSync(tmpDel, JSON.stringify(job.delivery));
    args.push(`--delivery-file ${tmpDel}`);
  }
  return args;
}

function buildEditPayload(job) {
  const edits = {};
  if (job.name) edits.name = job.name;
  if (job.description) edits.description = job.description;
  if (job.schedule) edits.schedule = job.schedule;
  if (job.sessionTarget) edits.sessionTarget = job.sessionTarget;
  if (job.enabled !== undefined) edits.enabled = job.enabled;
  if (job.payload) edits.payload = job.payload;
  if (job.delivery) edits.delivery = job.delivery;
  return edits;
}

function cmdDiff(args) {
  const dir = args.dir || "./backups";

  let backupFile;
  if (args.file) {
    backupFile = args.file;
  } else {
    const latest = getLatestBackup(dir);
    if (!latest) {
      console.error("No backups found to diff against.");
      process.exit(1);
    }
    backupFile = join(dir, latest);
  }

  const backup = loadBackup(backupFile);
  const currentJobs = getCronJobs();
  const currentMap = new Map(currentJobs.map(j => [j.id, j]));
  const backupMap = new Map(backup.jobs.map(j => [j.id, j]));

  const results = [];

  // New jobs (in current, not in backup)
  for (const [id, job] of currentMap) {
    if (!backupMap.has(id)) {
      results.push({ status: "new", name: job.name, id });
    }
  }

  // Deleted jobs (in backup, not in current)
  for (const [id, job] of backupMap) {
    if (!currentMap.has(id)) {
      results.push({ status: "deleted", name: job.name, id });
    }
  }

  // Changed jobs
  for (const [id, backupJob] of backupMap) {
    const current = currentMap.get(id);
    if (!current) continue;
    const diff = deepDiff(stripState(current), backupJob);
    if (diff.length > 0) {
      results.push({ status: "changed", name: current.name, id, changes: diff.length, details: diff.slice(0, 10) });
    }
  }

  if (results.length === 0) {
    if (args.json) { console.log("[]"); }
    else { console.log("✅ Current fleet matches backup. No differences."); }
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(results));
  } else {
    console.log(`Comparing current fleet vs ${basename(backupFile)}\n`);
    for (const r of results) {
      if (r.status === "new") console.log(`🆕 New: ${r.name} (${r.id})`);
      else if (r.status === "deleted") console.log(`🗑️  Deleted: ${r.name} (${r.id})`);
      else if (r.status === "changed") {
        console.log(`✏️  Changed: ${r.name} (${r.changes} field(s))`);
        for (const d of r.details.slice(0, 5)) {
          console.log(`   ${d.path}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`);
        }
        if (r.changes > 5) console.log(`   ... and ${r.changes - 5} more`);
      }
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") usage();

const command = argv[0];
const args = parseArgs(argv);
if (args.help) usage();

switch (command) {
  case "export": cmdExport(args); break;
  case "import": cmdImport(args); break;
  case "list":   cmdList(args); break;
  case "diff":   cmdDiff(args); break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error("Valid commands: export, import, list, diff");
    process.exit(1);
}
