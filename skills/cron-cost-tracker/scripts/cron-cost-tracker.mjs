#!/usr/bin/env node

// cron-cost-tracker.mjs — Aggregate token usage & cost across OpenClaw cron jobs.
// Usage:
//   node cron-cost-tracker.mjs                      # summary (last 7 days)
//   node cron-cost-tracker.mjs --days 30            # custom period
//   node cron-cost-tracker.mjs --top 3              # top N jobs by cost
//   node cron-cost-tracker.mjs --json               # raw JSON output
//   node cron-cost-tracker.mjs --per-run            # per-run breakdown
//   node cron-cost-tracker.mjs --job <id>           # single job detail

import { execSync } from "child_process";

// ── Config ──────────────────────────────────────────────────────────────
const DEFAULT_DAYS = 7;
const DEFAULT_TOP = 5;

// Rough per-1k-token pricing (update as models change).
// Format: "provider/model" or just "model" → { input, output } per 1k tokens in USD.
const PRICING = {
  "glm-5-turbo":       { input: 0.0004, output: 0.0015 },
  "glm-5":             { input: 0.002,  output: 0.008  },
  "gpt-4o-mini":       { input: 0.00015,output: 0.0006 },
  "gpt-4o":            { input: 0.0025, output: 0.01   },
  "claude-3-5-sonnet": { input: 0.003,  output: 0.015  },
  "claude-3-haiku":    { input: 0.00025,output: 0.00125},
};

// ── Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {
  days:  DEFAULT_DAYS,
  top:   DEFAULT_TOP,
  json:  false,
  perRun: false,
  jobId: null,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--days"  && args[i + 1]) { flags.days  = parseInt(args[++i], 10); }
  if (args[i] === "--top"   && args[i + 1]) { flags.top   = parseInt(args[++i], 10); }
  if (args[i] === "--json")                   { flags.json  = true; }
  if (args[i] === "--per-run")                { flags.perRun = true; }
  if (args[i] === "--job"  && args[i + 1])    { flags.jobId = args[++i]; }
  if (args[i] === "--help" || args[i] === "-h") {
    console.log("Usage: cron-cost-tracker.mjs [--days N] [--top N] [--json] [--per-run] [--job <id>]");
    process.exit(0);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────
function getPrice(model, provider) {
  const key = provider ? `${provider}/${model}` : model;
  return PRICING[key] || PRICING[model] || { input: 0.001, output: 0.003 };
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return "";
  }
}

// ── Collect runs ────────────────────────────────────────────────────────
// Get all jobs first
const jobsRaw = run("openclaw cron list --json");
let jobs;
try { jobs = JSON.parse(jobsRaw).jobs; } catch { jobs = []; }

const jobMap = {};
for (const j of jobs) {
  jobMap[j.id] = j.name || j.id.slice(0, 8);
}

// Filter to active (non-one-shot) jobs unless --job specified
const targetJobIds = flags.jobId
  ? [flags.jobId]
  : jobs.filter(j => !j.deleteAfterRun).map(j => j.id);

const cutoff = Date.now() - flags.days * 86400_000;
const allRuns = [];

for (const jobId of targetJobIds) {
  const raw = run(`openclaw cron runs --id ${jobId} --limit 100`);
  try {
    const data = JSON.parse(raw);
    if (data.entries) {
      for (const entry of data.entries) {
        if (entry.runAtMs >= cutoff) {
          allRuns.push({ ...entry, jobName: jobMap[jobId] || jobId.slice(0, 8) });
        }
      }
    }
  } catch { /* skip */ }
}

allRuns.sort((a, b) => b.runAtMs - a.runAtMs);

// ── Aggregate ───────────────────────────────────────────────────────────
const byJob = {};
let grandTotal = { input: 0, output: 0, cost: 0, runs: 0 };

for (const r of allRuns) {
  const usage = r.usage || {};
  const inp = usage.input_tokens || 0;
  const out = usage.output_tokens || 0;
  const prices = getPrice(r.model, r.provider);
  const cost = (inp / 1000) * prices.input + (out / 1000) * prices.output;

  if (!byJob[r.jobId]) {
    byJob[r.jobId] = { jobName: r.jobName, input: 0, output: 0, cost: 0, runs: 0, errors: 0, model: r.model };
  }
  byJob[r.jobId].input += inp;
  byJob[r.jobId].output += out;
  byJob[r.jobId].cost += cost;
  byJob[r.jobId].runs += 1;
  if (r.status === "error") byJob[r.jobId].errors += 1;

  grandTotal.input += inp;
  grandTotal.output += out;
  grandTotal.cost += cost;
  grandTotal.runs += 1;
}

// ── Output ──────────────────────────────────────────────────────────────
if (flags.json) {
  const output = { period: `last ${flags.days} days`, grandTotal, byJob };
  if (flags.perRun) output.runs = allRuns;
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

// Single job detail
if (flags.jobId && byJob[flags.jobId]) {
  const j = byJob[flags.jobId];
  console.log(`\n📊 ${j.jobName}`);
  console.log(`   Model: ${j.model}`);
  console.log(`   Runs: ${j.runs} (${j.errors} errors)`);
  console.log(`   Tokens: ${j.input.toLocaleString()} in / ${j.output.toLocaleString()} out`);
  console.log(`   Est. cost: $${j.cost.toFixed(4)}`);
  console.log(`   Avg cost/run: $${(j.cost / j.runs).toFixed(4)}`);
  console.log(`   Avg tokens/run: ${Math.round((j.input + j.output) / j.runs).toLocaleString()}`);
  if (flags.perRun) {
    console.log(`\n   Recent runs:`);
    const jobRuns = allRuns.filter(r => r.jobId === flags.jobId).slice(0, 10);
    for (const r of jobRuns) {
      const d = new Date(r.runAtMs).toLocaleString();
      const u = r.usage || {};
      const p = getPrice(r.model, r.provider);
      const c = ((u.input_tokens || 0) / 1000) * p.input + ((u.output_tokens || 0) / 1000) * p.output;
      console.log(`   • ${d} | ${(u.input_tokens||0).toLocaleString()}in ${(u.output_tokens||0).toLocaleString()}out | $${c.toFixed(4)} | ${r.status}${r.delivered ? "" : " (not delivered)"}`);
    }
  }
  process.exit(0);
}

// Summary table
console.log(`\n💰 Cron Cost Tracker — last ${flags.days} days`);
console.log("─".repeat(65));
console.log(
  "Job".padEnd(30) +
  "Runs".padStart(5) +
  "Tokens".padStart(12) +
  "Cost".padStart(10) +
  "Avg".padStart(8)
);
console.log("─".repeat(65));

const sorted = Object.values(byJob).sort((a, b) => b.cost - a.cost);
const shown = sorted.slice(0, flags.top);

for (const j of shown) {
  const total = j.input + j.output;
  const avg = j.runs > 0 ? j.cost / j.runs : 0;
  const name = j.jobName.length > 28 ? j.jobName.slice(0, 27) + "…" : j.jobName;
  console.log(
    name.padEnd(30) +
    String(j.runs).padStart(5) +
    total.toLocaleString().padStart(12) +
    ("$" + j.cost.toFixed(2)).padStart(10) +
    ("$" + avg.toFixed(3)).padStart(8)
  );
}

console.log("─".repeat(65));
const gAvg = grandTotal.runs > 0 ? grandTotal.cost / grandTotal.runs : 0;
const gTotal = grandTotal.input + grandTotal.output;
console.log(
  "TOTAL".padEnd(30) +
  String(grandTotal.runs).padStart(5) +
  gTotal.toLocaleString().padStart(12) +
  ("$" + grandTotal.cost.toFixed(2)).padStart(10) +
  ("$" + gAvg.toFixed(3)).padStart(8)
);
console.log();

// Per-run breakdown if requested
if (flags.perRun && allRuns.length > 0) {
  console.log("\n📋 Recent runs (last 20):");
  console.log("─".repeat(90));
  for (const r of allRuns.slice(0, 20)) {
    const d = new Date(r.runAtMs).toLocaleString();
    const u = r.usage || {};
    const p = getPrice(r.model, r.provider);
    const c = ((u.input_tokens || 0) / 1000) * p.input + ((u.output_tokens || 0) / 1000) * p.output;
    const name = (r.jobName || r.jobId.slice(0, 8));
    const status = r.status === "error" ? "❌" : "✅";
    console.log(`  ${status} ${d} | ${(name + "                                ").slice(0, 28)} | ${(u.input_tokens||0).toLocaleString()}in ${(u.output_tokens||0).toLocaleString()}out | $${c.toFixed(4)}`);
  }
}

// Warnings
const expensive = sorted.filter(j => j.cost / j.runs > 0.10 && j.runs >= 3);
if (expensive.length > 0) {
  console.log("\n⚠️  High-cost jobs (avg >$0.10/run, ≥3 runs):");
  for (const j of expensive) {
    console.log(`   • ${j.jobName}: $${(j.cost / j.runs).toFixed(3)}/run (${j.runs} runs)`);
  }
}

const errorJobs = sorted.filter(j => j.errors > 0);
if (errorJobs.length > 0) {
  console.log("\n❌ Jobs with errors:");
  for (const j of errorJobs) {
    console.log(`   • ${j.jobName}: ${j.errors} error(s) out of ${j.runs} runs`);
  }
}
