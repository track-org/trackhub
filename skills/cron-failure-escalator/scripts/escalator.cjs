#!/usr/bin/env node
// cron-failure-escalator — Track failing cron jobs and credentials with escalating nudge intervals
// Tracks failure duration and determines if a nudge is due based on escalation tiers.

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// --- State file ---
const STATE_DIR = path.join(
  process.env.HOME || "/home/delads",
  ".openclaw",
  "workspace",
  "memory"
);
const STATE_FILE = path.join(STATE_DIR, "escalator-state.json");

// --- Escalation tiers ---
// Age thresholds (days) → minimum interval between nudges (days)
const TIERS = [
  { maxAge: 3, interval: 1, label: "new" },       // 0-3 days: daily
  { maxAge: 7, interval: 2, label: "aging" },      // 3-7 days: every 2 days
  { maxAge: 30, interval: 5, label: "persistent" }, // 7-30 days: every 5 days
  { maxAge: Infinity, interval: 14, label: "chronic" }, // 30+ days: every 14 days
];

// --- CLI args ---
function parseArgs(argv) {
  const args = {
    json: false,
    quiet: false,
    all: false,
    name: null,
    check: false, // just check if any nudge is due (exit 0 = yes, exit 3 = no)
    reset: null,  // reset a specific failure by name
    state: false, // dump raw state
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--json": args.json = true; break;
      case "--quiet": case "-q": args.quiet = true; break;
      case "--all": args.all = true; break;
      case "--check": args.check = true; break;
      case "--state": args.state = true; break;
      case "--name": case "-n": args.name = argv[++i]; break;
      case "--reset": args.reset = argv[++i]; break;
      case "--help": case "-h": args.help = true; break;
    }
  }
  return args;
}

function showHelp() {
  console.log(`Usage: escalator.cjs [options]

Options:
  --all          Show all tracked failures (not just due nudges)
  --check        Exit 0 if any nudge is due, exit 3 if not
  --name NAME    Filter to a specific failure
  --reset NAME   Remove a failure from tracking (mark as resolved)
  --state        Dump raw state JSON
  --json         JSON output
  --quiet, -q    Only show failures needing a nudge now
  --help, -h     Show this help

Escalation tiers:
  0-3 days:   alert every 1 day
  3-7 days:   alert every 2 days
  7-30 days:  alert every 5 days
  30+ days:   alert every 14 days`);
}

// --- State management ---
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
  } catch (e) { /* ignore */ }
  return { failures: {} };
}

function saveState(state) {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

// --- Detect current failures from cron-dead-letter or credential-health ---
function detectFailures() {
  const failures = [];
  const scriptDir = path.resolve(__dirname, "..");

  // Try credential-health first
  try {
    const chPath = path.join(scriptDir, "..", "credential-health", "scripts", "credential-health.cjs");
    if (fs.existsSync(chPath)) {
      const result = execSync(`node "${chPath}" --fail-only --json 2>/dev/null`, {
        timeout: 15000,
        encoding: "utf8",
      });
      const parsed = JSON.parse(result);
      if (parsed.results) {
        for (const r of parsed.results) {
          if (r.status === "fail") {
            failures.push({
              name: `credential:${r.service}`,
              type: "credential",
              detail: r.detail || "unknown error",
            });
          }
        }
      }
    }
  } catch (e) {
    // credential-health may exit non-zero on failures; try parsing stderr
    try {
      const output = (e.stdout || "") + (e.stderr || "");
      const match = output.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.results) {
          for (const r of parsed.results) {
            if (r.status === "fail") {
              failures.push({
                name: `credential:${r.service}`,
                type: "credential",
                detail: r.detail || "unknown error",
              });
            }
          }
        }
      }
    } catch (e2) { /* ignore */ }
  }

  // Try cron-dead-letter for stuck jobs
  try {
    const dlPath = path.join(scriptDir, "..", "cron-dead-letter", "scripts", "dead-letter.cjs");
    if (fs.existsSync(dlPath)) {
      const result = execSync(`node "${dlPath}" --json --min-streak 3 2>/dev/null`, {
        timeout: 30000,
        encoding: "utf8",
      });
      const parsed = JSON.parse(result);
      if (parsed.stuckJobs) {
        for (const job of parsed.stuckJobs) {
          // Only include actual failures (🔴), not benign loops
          if (job.severity === "failure" || job.severity === "high") {
            failures.push({
              name: `cron:${job.name}`,
              type: "cron",
              detail: `${job.streakCount} consecutive failures: ${(job.lastError || "unknown").substring(0, 80)}`,
            });
          }
        }
      }
    }
  } catch (e) { /* ignore */ }

  return failures;
}

// --- Tier logic ---
function getTier(ageDays) {
  for (const tier of TIERS) {
    if (ageDays <= tier.maxAge) return tier;
  }
  return TIERS[TIERS.length - 1];
}

function isNudgeDue(firstSeen, lastNudge) {
  const now = Date.now();
  const ageDays = (now - firstSeen) / (1000 * 60 * 60 * 24);
  const tier = getTier(ageDays);

  if (!lastNudge) return true; // never nudged
  const sinceNudge = (now - lastNudge) / (1000 * 60 * 60 * 24);
  return sinceNudge >= tier.interval;
}

// --- Main ---
function main() {
  const args = parseArgs(process.argv);
  if (args.help) { showHelp(); process.exit(0); }

  const state = loadState();

  // Reset mode
  if (args.reset) {
    if (state.failures[args.reset]) {
      delete state.failures[args.reset];
      saveState(state);
      console.log(`✅ Reset failure: ${args.reset}`);
    } else {
      console.log(`No tracked failure named "${args.reset}"`);
    }
    process.exit(0);
  }

  // State dump mode
  if (args.state) {
    console.log(JSON.stringify(state, null, 2));
    process.exit(0);
  }

  // Detect current failures
  const currentFailures = detectFailures();
  const currentNames = new Set(currentFailures.map((f) => f.name));
  const now = Date.now();

  // Update state: register new failures, keep existing timestamps
  for (const f of currentFailures) {
    if (!state.failures[f.name]) {
      state.failures[f.name] = {
        firstSeen: now,
        lastNudge: null,
        type: f.type,
        detail: f.detail,
      };
    } else {
      // Update detail
      state.failures[f.name].detail = f.detail;
      state.failures[f.name].type = f.type;
    }
  }

  // Remove resolved failures (no longer detected)
  for (const name of Object.keys(state.failures)) {
    if (!currentNames.has(name)) {
      delete state.failures[name];
    }
  }

  saveState(state);

  // Evaluate nudges
  const nudges = [];
  const allEntries = [];

  for (const [name, info] of Object.entries(state.failures)) {
    if (args.name && name !== args.name) continue;

    const ageDays = (now - info.firstSeen) / (1000 * 60 * 60 * 24);
    const tier = getTier(ageDays);
    const due = isNudgeDue(info.firstSeen, info.lastNudge);

    const entry = {
      name,
      type: info.type,
      detail: info.detail,
      ageDays: Math.round(ageDays * 10) / 10,
      tier: tier.label,
      nudgeInterval: tier.interval,
      nudgeDue: due,
      firstSeen: new Date(info.firstSeen).toISOString(),
      lastNudge: info.lastNudge ? new Date(info.lastNudge).toISOString() : null,
    };

    allEntries.push(entry);
    if (due) {
      nudges.push(entry);
    }
  }

  // --check mode
  if (args.check) {
    process.exit(nudges.length > 0 ? 0 : 3);
  }

  // --all mode
  const output = args.all ? allEntries : nudges;

  if (args.json) {
    console.log(JSON.stringify({ nudges: output, total: allEntries.length, due: nudges.length }, null, 2));
    if (output.length === 0 && !args.all) process.exit(3);
    process.exit(0);
  }

  // Human output
  if (allEntries.length === 0) {
    if (!args.quiet) console.log("✅ No active failures tracked.");
    process.exit(0);
  }

  if (!args.quiet || output.length > 0) {
    const label = args.all ? "All tracked failures" : "Failures needing a nudge";
    console.log(`\n📋 ${label} (${output.length}/${allEntries.length})\n`);

    for (const e of output) {
      const icon = e.nudgeDue ? "🔔" : "⏳";
      const ageStr = e.ageDays === 1 ? "1 day" : `${e.ageDays} days`;
      const nudgeStr = e.nudgeDue ? "NUDGE NOW" : `next in ${e.nudgeInterval}d`;
      console.log(`${icon} ${e.name}  [${e.tier}]  ${ageStr}  ${nudgeStr}`);
      console.log(`   ${e.detail}`);
      if (e.lastNudge) {
        console.log(`   last nudged: ${e.lastNudge}`);
      } else {
        console.log(`   never nudged`);
      }
      console.log();
    }
  }

  // Update lastNudge for entries we're reporting
  if (!args.all) {
    for (const n of nudges) {
      if (state.failures[n.name]) {
        state.failures[n.name].lastNudge = now;
      }
    }
    saveState(state);
  }

  process.exit(nudges.length > 0 ? 0 : 3);
}

main();
