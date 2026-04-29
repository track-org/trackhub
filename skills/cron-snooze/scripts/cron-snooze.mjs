#!/usr/bin/env node
// cron-snooze.mjs — Temporarily disable cron jobs and auto-re-enable them later
// Zero external dependencies. Node.js 18+. Uses openclaw CLI for enable/disable.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const STATE_DIR = join(homedir(), ".openclaw", "cron");
const STATE_FILE = join(STATE_DIR, "snoozed.json");

// --- State management ---

function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf8"));
    }
  } catch {}
  return { snoozed: {} };
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

// --- openclaw CLI wrappers ---

function ocDisable(id) {
  try {
    execSync(`openclaw cron disable "${id}" --timeout 15000`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 20000,
    });
    return true;
  } catch (e) {
    return false;
  }
}

function ocEnable(id) {
  try {
    execSync(`openclaw cron enable "${id}" --timeout 15000`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 20000,
    });
    return true;
  } catch (e) {
    return false;
  }
}

// --- Job matching ---

function loadJobs() {
  const jobsPath = join(homedir(), ".openclaw", "cron", "jobs.json");
  if (!existsSync(jobsPath)) return [];
  const data = JSON.parse(readFileSync(jobsPath, "utf8"));
  return data.jobs || [];
}

function findJob(nameOrId) {
  const jobs = loadJobs();
  // Try exact ID first
  const byId = jobs.find((j) => j.id === nameOrId || j.id.startsWith(nameOrId));
  if (byId) return byId;
  // Try name match (case-insensitive, substring)
  const lower = nameOrId.toLowerCase();
  const byName = jobs.find((j) => j.name.toLowerCase().includes(lower));
  if (byName) return byName;
  return null;
}

// --- Duration parsing ---

function parseDuration(str) {
  const s = str.trim().toLowerCase();
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(m|h|d|w)$/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  const unit = match[2];
  const multipliers = { m: 60_000, h: 3600_000, d: 86400_000, w: 604_800_000 };
  return Math.round(val * multipliers[unit]);
}

function parseUntil(str) {
  // HH:MM format — assume today or tomorrow
  const match = str.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function formatDuration(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86400_000) return `${(ms / 3600_000).toFixed(1)}h`;
  return `${(ms / 86400_000).toFixed(1)}d`;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${(diff / 3600_000).toFixed(1)}h ago`;
  return `${(diff / 86400_000).toFixed(1)}d ago`;
}

function timeUntil(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return "now";
  if (diff < 60_000) return `in ${Math.round(diff / 1000)}s`;
  if (diff < 3600_000) return `in ${Math.round(diff / 60_000)}m`;
  if (diff < 86400_000) return `in ${(diff / 3600_000).toFixed(1)}h`;
  return `in ${(diff / 86400_000).toFixed(1)}d`;
}

// --- Commands ---

function cmdSnooze(nameOrId, { duration, until, reason }) {
  const job = findJob(nameOrId);
  if (!job) {
    console.error(`✗ Job not found: ${nameOrId}`);
    console.error("  Run 'openclaw cron list' to see available jobs.");
    process.exit(1);
  }

  if (!job.enabled) {
    // Already disabled — still snooze but warn
    console.warn(`⚠ Job "${job.name}" is already disabled. Snoozing anyway.`);
  }

  const now = Date.now();
  let reenableAt;
  let durationLabel;

  if (duration) {
    reenableAt = now + duration;
    durationLabel = formatDuration(duration);
  } else if (until) {
    reenableAt = until;
    durationLabel = timeUntil(until);
  } else {
    console.error("✗ Specify --for <duration> or --until <HH:MM>");
    process.exit(1);
  }

  // Disable the job
  if (!ocDisable(job.id)) {
    console.error(`✗ Failed to disable job "${job.name}"`);
    process.exit(1);
  }

  // Save snooze state
  const state = loadState();
  state.snoozed[job.id] = {
    id: job.id,
    name: job.name,
    snoozedAt: now,
    reenableAt,
    reason: reason || "",
    wasEnabled: job.enabled !== false,
  };
  saveState(state);

  console.log(`😴 Snoozed "${job.name}"`);
  console.log(`   Duration: ${durationLabel}`);
  console.log(`   Re-enable: ${new Date(reenableAt).toLocaleString()}`);
  if (reason) console.log(`   Reason: ${reason}`);
  console.log(`   Run 'cron-snooze --check' to re-enable when ready.`);
}

function cmdUnsnooze(nameOrId) {
  const state = loadState();

  if (nameOrId) {
    const job = findJob(nameOrId);
    if (!job) {
      console.error(`✗ Job not found: ${nameOrId}`);
      process.exit(1);
    }
    if (!state.snoozed[job.id]) {
      console.log(`ℹ Job "${job.name}" is not snoozed.`);
      return;
    }
    delete state.snoozed[job.id];
    saveState(state);
    if (!ocEnable(job.id)) {
      console.error(`⚠ Re-enabled in state but failed to enable via CLI. Run: openclaw cron enable "${job.id}"`);
    } else {
      console.log(`⏰ Unsnoozed "${job.name}" — re-enabled.`);
    }
  } else {
    // Unsnooze all
    const ids = Object.keys(state.snoozed);
    if (ids.length === 0) {
      console.log("ℹ No snoozed jobs.");
      return;
    }
    let ok = 0, fail = 0;
    for (const id of ids) {
      const entry = state.snoozed[id];
      if (!ocEnable(id)) {
        console.error(`⚠ Failed to re-enable "${entry.name}"`);
        fail++;
      } else {
        console.log(`⏰ Unsnoozed "${entry.name}"`);
        ok++;
      }
    }
    state.snoozed = {};
    saveState(state);
    console.log(`\n${ok} re-enabled, ${fail} failed.`);
  }
}

function cmdCheck({ reenable, quiet }) {
  const state = loadState();
  const entries = Object.values(state.snoozed);
  const now = Date.now();

  if (entries.length === 0) {
    if (!quiet) console.log("💤 No snoozed jobs.");
    return;
  }

  const due = entries.filter((e) => e.reenableAt <= now);
  const pending = entries.filter((e) => e.reenableAt > now);

  if (pending.length > 0) {
    if (!quiet) {
      console.log(`💤 ${pending.length} snoozed job(s):\n`);
      for (const e of pending) {
        const remaining = e.reenableAt - now;
        console.log(`   ⏳ ${e.name}`);
        console.log(`      Snoozed: ${timeAgo(e.snoozedAt)}`);
        console.log(`      Re-enable: ${timeUntil(e.reenableAt)} (${formatDuration(remaining)})`);
        if (e.reason) console.log(`      Reason: ${e.reason}`);
        console.log();
      }
    }
  }

  if (due.length > 0) {
    if (!quiet) {
      console.log(`⏰ ${due.length} job(s) ready to re-enable:\n`);
    }
    if (reenable) {
      let ok = 0, fail = 0;
      for (const e of due) {
        if (!ocEnable(e.id)) {
          if (!quiet) console.error(`   ✗ Failed: ${e.name}`);
          fail++;
        } else {
          if (!quiet) console.log(`   ✅ Re-enabled: ${e.name}`);
          ok++;
        }
        delete state.snoozed[e.id];
      }
      saveState(state);
      if (!quiet) console.log(`\n${ok} re-enabled, ${fail} failed.`);
    } else {
      for (const e of due) {
        console.log(`   ✅ Ready: ${e.name} (snoozed ${timeAgo(e.snoozedAt)})`);
      }
      console.log(`\n   Run with --reenable to re-enable them.`);
    }
  }

  if (quiet) {
    // Exit 0 if all due jobs handled, 1 if there are pending snoozes
    if (pending.length > 0) process.exit(0);
    process.exit(0);
  }
}

function cmdList({ json }) {
  const state = loadState();
  const entries = Object.values(state.snoozed);
  const now = Date.now();

  if (entries.length === 0) {
    if (json) console.log(JSON.stringify({ snoozed: [], count: 0 }));
    else console.log("💤 No snoozed jobs.");
    return;
  }

  if (json) {
    console.log(
      JSON.stringify({
        snoozed: entries.map((e) => ({
          ...e,
          status: e.reenableAt <= now ? "due" : "pending",
          remainingMs: Math.max(0, e.reenableAt - now),
        })),
        count: entries.length,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  console.log(`💤 ${entries.length} snoozed job(s):\n`);
  for (const e of entries) {
    const isDue = e.reenableAt <= now;
    const icon = isDue ? "✅" : "⏳";
    const status = isDue ? "READY" : `in ${timeUntil(e.reenableAt)}`;
    console.log(`   ${icon} ${e.name}`);
    console.log(`      ID: ${e.id}`);
    console.log(`      Status: ${status}`);
    console.log(`      Snoozed: ${timeAgo(e.snoozedAt)}`);
    console.log(`      Re-enable: ${new Date(e.reenableAt).toLocaleString()}`);
    if (e.reason) console.log(`      Reason: ${e.reason}`);
    console.log();
  }
}

// --- CLI ---

function usage() {
  console.log(`
cron-snooze — Temporarily disable cron jobs and auto-re-enable them

Usage:
  cron-snooze <job-name-or-id> --for <duration>  Snooze a job
  cron-snooze <job-name-or-id> --until <HH:MM>  Snooze until a time
  cron-snooze --check [--reenable]               Check/re-enable due jobs
  cron-snooze --unsnooze [job-name-or-id]        Manually re-enable
  cron-snooze --list                             List snoozed jobs
  cron-snooze --help                             Show this help

Snooze options:
  --for <duration>     Duration: 30m, 2h, 1d, 1w
  --until <HH:MM>      Time to re-enable (24h format)
  --reason <text>      Optional reason for the snooze

Check options:
  --check              Show snoozed jobs and which are due
  --reenable           Auto-re-enable jobs past their snooze time
  --quiet              Minimal output (for cron/script use)

Other:
  --list               List all snoozed jobs
  --json               JSON output
  --unsnooze [id]      Re-enable a specific job (or all if omitted)
  --help               Show help

Examples:
  # Snooze Gmail digest for 24 hours (credential issue)
  cron-snooze gmail --for 24h --reason "OAuth token revoked"

  # Snooze a job until 09:00 tomorrow
  cron-snooze "Attio stage changes" --until 09:00

  # Check which snoozed jobs are ready to re-enable
  cron-snooze --check

  # Re-enable all due jobs
  cron-snooze --check --reenable

  # List all snoozed jobs
  cron-snooze --list
`);
}

// Parse args
const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const hasFlag = (f) => args.includes(f);
const getArg = (f) => {
  const i = args.indexOf(f);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};

if (hasFlag("--check")) {
  cmdCheck({ reenable: hasFlag("--reenable"), quiet: hasFlag("--quiet") });
} else if (hasFlag("--unsnooze")) {
  const target = getArg("--unsnooze");
  cmdUnsnooze(target || null);
} else if (hasFlag("--list")) {
  cmdList({ json: hasFlag("--json") });
} else {
  // First positional arg is the job name/id
  const jobRef = args.find((a) => !a.startsWith("--"));
  if (!jobRef) {
    console.error("✗ Provide a job name/ID, or use --check/--list/--unsnooze");
    process.exit(1);
  }

  const durationStr = getArg("--for");
  const untilStr = getArg("--until");
  const reason = getArg("--reason");

  let duration = durationStr ? parseDuration(durationStr) : null;
  let until = untilStr ? parseUntil(untilStr) : null;

  if (!duration && !until) {
    console.error("✗ Specify --for <duration> or --until <HH:MM>");
    process.exit(1);
  }

  cmdSnooze(jobRef, { duration, until, reason });
}
