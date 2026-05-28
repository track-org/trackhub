#!/usr/bin/env node

// cron-waste-detector.mjs — Find cron jobs wasting tokens on failures, no-delivery, and over-scheduling.
// Usage:
//   node cron-waste-detector.mjs                       # scan last 3 days
//   node cron-waste-detector.mjs --days 7              # wider window
//   node cron-waste-detector.mjs --json                # raw JSON output
//   node cron-waste-detector.mjs --recommendations     # only actionable items
//   node cron-waste-detector.mjs --job <id>            # single job deep-dive

import { execSync } from "child_process";

// ── Config ──────────────────────────────────────────────────────────────
const DEFAULT_DAYS = 3;
const OVERSCHEDULED_THRESHOLD = 24; // runs per day
const CONSECUTIVE_FAILURE_THRESHOLD = 5;
const MIN_RUNS_FOR_STATS = 3;

// Rough per-1k-token pricing (same as cron-cost-tracker for consistency)
const PRICING = {
  "glm-5-turbo":       { input: 0.0004, output: 0.0015 },
  "glm-5":             { input: 0.002,  output: 0.008  },
  "gpt-4o-mini":       { input: 0.00015,output: 0.0006 },
  "gpt-4o":            { input: 0.0025, output: 0.01   },
  "claude-3-5-sonnet": { input: 0.003,  output: 0.015  },
  "claude-3-haiku":    { input: 0.00025,output: 0.00125},
};

// Patterns indicating credential failures
const CRED_ERROR_PATTERNS = [
  /missing.*(?:api[_ ]?key|token|credential|secret|url)/i,
  /unauthorized|authentication failed|invalid api key/i,
  /supabase_url|supabase_anon_key|attio_api_key/i,
  /credentials?(?:\s+are)?\s+missing/i,
  /credential\s+check\s+failed/i,
  /401|403/,
];

// ── Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {
  days: DEFAULT_DAYS,
  json: false,
  recsOnly: false,
  jobId: null,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--days" && args[i + 1]) flags.days = parseInt(args[++i], 10);
  if (args[i] === "--json") flags.json = true;
  if (args[i] === "--recommendations") flags.recsOnly = true;
  if (args[i] === "--job" && args[i + 1]) flags.jobId = args[++i];
  if (args[i] === "--help" || args[i] === "-h") {
    console.log("Usage: cron-waste-detector.mjs [--days N] [--json] [--recommendations] [--job <id>]");
    process.exit(0);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────
function getPrice(model) {
  return PRICING[model] || { input: 0.001, output: 0.003 };
}

function calcCost(tokens_in, tokens_out, model) {
  const p = getPrice(model);
  return (tokens_in / 1000) * p.input + (tokens_out / 1000) * p.output;
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] });
  } catch { return ""; }
}

function isCredError(text) {
  if (!text) return false;
  return CRED_ERROR_PATTERNS.some(p => p.test(text));
}

// ── Collect data ────────────────────────────────────────────────────────
const jobsRaw = run("openclaw cron list --json");
let jobs;
try { jobs = JSON.parse(jobsRaw).jobs; } catch { jobs = []; }

const jobMap = {};
for (const j of jobs) jobMap[j.id] = j;

const cutoff = Date.now() - flags.days * 86400_000;
const periodMs = flags.days * 86400_000;
const targetJobIds = flags.jobId ? [flags.jobId] : jobs.map(j => j.id);

const jobStats = {};

for (const jobId of targetJobIds) {
  const raw = run(`openclaw cron runs --id ${jobId} --limit 200`);
  const job = jobMap[jobId];
  const jobName = job?.name || job?.label || jobId.slice(0, 8);

  let entries = [];
  try {
    const data = JSON.parse(raw);
    if (data.entries) entries = data.entries.filter(e => e.runAtMs >= cutoff);
  } catch { /* skip */ }

  if (entries.length === 0) continue;

  const stats = {
    jobId,
    jobName,
    schedule: job?.schedule?.expr || (typeof job?.schedule === 'string' ? job.schedule : JSON.stringify(job?.schedule)) || "unknown",
    deleteAfterRun: job?.deleteAfterRun || false,
    totalRuns: entries.length,
    errors: 0,
    delivered: 0,
    notDelivered: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCost: 0,
    wastedCost: 0,
    wastedTokens: 0,
    errorMessages: [],
    credFailure: false,
    consecutiveFailures: 0,
    maxConsecutiveFailures: 0,
    runsPerDay: entries.length / flags.days,
    emptyOutput: 0,
    hasMixedDelivery: false,
  };

  // Track consecutive failures (from most recent backwards)
  let currentStreak = 0;
  for (const e of entries) {
    if (e.status === "error") {
      currentStreak++;
    } else {
      break;
    }
  }
  stats.maxConsecutiveFailures = currentStreak;

  for (const e of entries) {
    const usage = e.usage || {};
    const inp = usage.input_tokens || 0;
    const out = usage.output_tokens || 0;
    const cost = calcCost(inp, out, e.model);

    stats.totalInput += inp;
    stats.totalOutput += out;
    stats.totalCost += cost;

    if (e.status === "error") {
      stats.errors++;
      stats.wastedCost += cost;
      stats.wastedTokens += inp + out;

      // Capture error info
      const summary = e.summary || e.error || "";
      if (summary) stats.errorMessages.push(summary);
      if (isCredError(summary)) stats.credFailure = true;
    } else {
      // Check summary for credential bail-out messages even on "ok" status
      const summary = e.summary || "";
      if (isCredError(summary)) {
        stats.credFailure = true;
        stats.credBailouts = (stats.credBailouts || 0) + 1;
        // Treat credential bailout runs as partial waste (ran but bailed early)
        stats.wastedCost += cost * 0.7;
        stats.wastedTokens += Math.round((inp + out) * 0.7);
      }

      // Delivery status varies:
      //   "delivered" or delivered:true → success
      //   "not-requested" → agent handles own delivery (not waste)
      //   "not-delivered" or delivered:false → failed delivery
      //   "failed" / "bounced" → explicit failure
      const ds = e.deliveryStatus || "";
      const del = e.delivered;
      if (del === false && (ds === "not-delivered" || ds === "failed" || ds === "bounced")) {
        stats.notDelivered++;
        stats.wastedCost += cost * 0.5;
        stats.wastedTokens += Math.round((inp + out) * 0.5);
      } else if (del === true || ds === "delivered") {
        stats.delivered++;
        stats.hasMixedDelivery = stats.notDelivered > 0; // had failures before this success
      } else if (del === false && ds === "") {
        // No delivery info at all — could be ancient format, don't count as waste
        stats.delivered++;
      } else {
        stats.delivered++;
      }
    }

    // Check for empty/minimal output (high input, very low output = likely NO_REPLY or quick bailout)
    if (out < 50 && inp > 1000) {
      stats.emptyOutput++;
    }
  }

  // Deduplicate error messages (keep unique, top 3)
  const uniqueErrors = [...new Set(stats.errorMessages)];
  stats.errorMessages = uniqueErrors.slice(0, 3);

  // Detect stale one-shots
  if (stats.deleteAfterRun && stats.totalRuns > 1) {
    stats.staleOneShot = true;
  }

  jobStats[jobId] = stats;
}

// ── Analyze waste signals ───────────────────────────────────────────────
const critical = [];
const warnings = [];
const optimizations = [];
const recommendations = [];

for (const [jobId, s] of Object.entries(jobStats)) {
  // All-fail
  if (s.totalRuns >= MIN_RUNS_FOR_STATS && s.errors === s.totalRuns) {
    const signal = {
      jobId,
      jobName: s.jobName,
      type: "all-fail",
      severity: "critical",
      detail: `${s.errors}/${s.totalRuns} runs failed`,
      waste: s.wastedCost,
      wasteTokens: s.wastedTokens,
      errors: s.errorMessages,
    };
    if (s.credFailure) {
      signal.type = "credential-failure";
      signal.detail += " (credential issue detected)";
      recommendations.push(`Snooze "${s.jobName}" until credentials are fixed — ${s.errorMessages[0] || "missing API key"}`);
    } else {
      recommendations.push(`Fix or delete "${s.jobName}" — failing 100% of the time`);
    }
    critical.push(signal);
    continue;
  }

  // High error rate (not all-fail but >50%)
  if (s.totalRuns >= MIN_RUNS_FOR_STATS && s.errors / s.totalRuns > 0.5) {
    const pct = Math.round((s.errors / s.totalRuns) * 100);
    critical.push({
      jobId,
      jobName: s.jobName,
      type: "high-error-rate",
      severity: "critical",
      detail: `${pct}% error rate (${s.errors}/${s.totalRuns})`,
      waste: s.wastedCost,
      wasteTokens: s.wastedTokens,
      errors: s.errorMessages,
    });
    recommendations.push(`Diagnose "${s.jobName}" with cron-first-aid — ${pct}% failure rate`);
    continue;
  }

  // Consecutive failures
  if (s.maxConsecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
    critical.push({
      jobId,
      jobName: s.jobName,
      type: "stuck-failure",
      severity: "critical",
      detail: `${s.maxConsecutiveFailures} consecutive failures`,
      waste: s.wastedCost,
      wasteTokens: s.wastedTokens,
    });
    recommendations.push(`"${s.jobName}" is stuck — ${s.maxConsecutiveFailures} failures in a row`);
    continue;
  }

  // Zero delivery — only flag if delivery was expected (mix of delivered/not-delivered, or explicit target)
  // Jobs that never deliver (e.g. write to a database) shouldn't be flagged
  if (s.totalRuns >= MIN_RUNS_FOR_STATS && s.notDelivered > 0 && s.notDelivered === s.totalRuns && s.errors === 0) {
    // Check if any runs ever had a different delivery status — if all are "not-delivered", this job
    // probably doesn't have a delivery target and shouldn't be flagged
    if (s.hasMixedDelivery) {
      warnings.push({
        jobId,
        jobName: s.jobName,
        type: "zero-delivery",
        severity: "warning",
        detail: `${s.totalRuns} runs, ${s.notDelivered} failed delivery`,
        waste: s.wastedCost,
        wasteTokens: s.wastedTokens,
      });
      recommendations.push(`Check delivery config for "${s.jobName}" — runs succeed but delivery fails`);
      continue;
    }
  }

  // Over-scheduled (high frequency, mostly empty output)
  if (s.runsPerDay > OVERSCHEDULED_THRESHOLD && s.emptyOutput / s.totalRuns > 0.8) {
    warnings.push({
      jobId,
      jobName: s.jobName,
      type: "over-scheduled",
      severity: "warning",
      detail: `${Math.round(s.runsPerDay)} runs/day, ${Math.round((s.emptyOutput / s.totalRuns) * 100)}% empty output`,
      waste: s.wastedCost,
      wasteTokens: s.wastedTokens,
      schedule: s.schedule,
    });
    recommendations.push(`Reduce frequency of "${s.jobName}" — ${Math.round(s.runsPerDay)} runs/day but mostly empty output`);
    continue;
  }

  // Stale one-shots
  if (s.staleOneShot) {
    warnings.push({
      jobId,
      jobName: s.jobName,
      type: "stale-one-shot",
      severity: "warning",
      detail: `One-shot still registered after ${s.totalRuns} runs`,
    });
    recommendations.push(`Clean up one-shot "${s.jobName}" — should have been deleted after first run`);
    continue;
  }

  // Credential bailouts (runs that "succeeded" but bailed on cred checks)
  if (s.credBailouts > 0 && s.credBailouts >= s.totalRuns * 0.5) {
    warnings.push({
      jobId,
      jobName: s.jobName,
      type: "credential-bailout",
      severity: "warning",
      detail: `${s.credBailouts}/${s.totalRuns} runs bailed on credential checks`,
      waste: s.wastedCost,
      wasteTokens: s.wastedTokens,
    });
    recommendations.push(`Consider shielding "${s.jobName}" with cron-credential-shield — ${s.credBailouts} runs wasted on failed cred checks`);
    continue;
  }

  // High burn but some value — optimization territory
  if (s.emptyOutput > s.totalRuns * 0.5 && s.totalRuns > 10) {
    optimizations.push({
      jobId,
      jobName: s.jobName,
      type: "high-empty-ratio",
      severity: "info",
      detail: `${Math.round((s.emptyOutput / s.totalRuns) * 100)}% of runs produce minimal output`,
      waste: s.totalCost * (s.emptyOutput / s.totalRuns),
    });
  }
}

// ── Calculate totals ────────────────────────────────────────────────────
let totalTokens = 0, totalCost = 0, wastedTokens = 0, wastedCost = 0, totalRuns = 0;
for (const s of Object.values(jobStats)) {
  totalTokens += s.totalInput + s.totalOutput;
  totalCost += s.totalCost;
  wastedTokens += s.wastedTokens;
  wastedCost += s.wastedCost;
  totalRuns += s.totalRuns;
}
const wastePercent = totalCost > 0 ? Math.round((wastedCost / totalCost) * 100) : 0;

// ── Output ──────────────────────────────────────────────────────────────
const result = {
  period: `last ${flags.days} days`,
  summary: { totalRuns, totalTokens, totalCost, wastedTokens, wastedCost, wastePercent },
  critical,
  warnings,
  optimizations,
  recommendations,
};

if (flags.json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// Recommendations-only mode
if (flags.recsOnly) {
  if (recommendations.length === 0) {
    console.log("✅ No waste detected — fleet looks efficient.");
  } else {
    console.log("💡 Recommendations:\n");
    recommendations.forEach((r, i) => console.log(`   ${i + 1}. ${r}`));
  }
  process.exit(0);
}

// Single job deep-dive
if (flags.jobId && jobStats[flags.jobId]) {
  const s = jobStats[flags.jobId];
  console.log(`\n🔍 ${s.jobName}`);
  console.log(`   Schedule: ${s.schedule}`);
  console.log(`   Runs: ${s.totalRuns} (${s.errors} errors, ${s.delivered} delivered, ${s.notDelivered} not delivered)`);
  console.log(`   Tokens: ${s.totalInput.toLocaleString()} in / ${s.totalOutput.toLocaleString()} out`);
  console.log(`   Cost: $${s.totalCost.toFixed(4)} (waste: $${s.wastedCost.toFixed(4)})`);
  console.log(`   Runs/day: ${s.runsPerDay.toFixed(1)}`);
  console.log(`   Empty output: ${s.emptyOutput}/${s.totalRuns} (${Math.round((s.emptyOutput / s.totalRuns) * 100)}%)`);
  console.log(`   Consecutive failures: ${s.maxConsecutiveFailures}`);
  if (s.credFailure) console.log(`   🔑 Credential failure detected`);
  if (s.errorMessages.length > 0) {
    console.log(`   Recent errors:`);
    s.errorMessages.forEach(e => console.log(`     • ${e.slice(0, 120)}`));
  }
  process.exit(0);
}

// Full report
console.log(`\n🔍 Cron Waste Detector — last ${flags.days} days`);
console.log("═".repeat(60));
console.log(`\nTotal runs: ${totalRuns}`);
console.log(`Total tokens: ${totalTokens.toLocaleString()}`);
console.log(`Total cost: $${totalCost.toFixed(2)}`);
if (wastedCost > 0) {
  console.log(`Estimated waste: $${wastedCost.toFixed(2)} (${wastePercent}% of spend)`);
}
console.log();

if (critical.length > 0) {
  console.log("🔴 Critical (fix now):");
  for (const c of critical) {
    const icon = c.type === "credential-failure" ? "🔑" : "❌";
    console.log(`   ${icon} ${c.jobName} — ${c.detail}`);
    console.log(`      Waste: $${c.waste.toFixed(4)} (${c.wasteTokens.toLocaleString()} tokens)`);
    if (c.errors?.length) {
      console.log(`      Error: ${c.errors[0].slice(0, 100)}`);
    }
  }
  console.log();
}

if (warnings.length > 0) {
  console.log("🟡 Warning (review soon):");
  for (const w of warnings) {
    const icon = w.type === "over-scheduled" ? "⚡" : w.type === "zero-delivery" ? "📭" : "⚠️";
    console.log(`   ${icon} ${w.jobName} — ${w.detail}`);
    if (w.waste > 0) console.log(`      Waste: $${w.waste.toFixed(4)}`);
  }
  console.log();
}

if (optimizations.length > 0) {
  console.log("🟢 Optimization opportunities:");
  for (const o of optimizations) {
    console.log(`   💡 ${o.jobName} — ${o.detail}`);
  }
  console.log();
}

if (recommendations.length > 0) {
  console.log("💡 Recommendations:");
  recommendations.forEach((r, i) => console.log(`   ${i + 1}. ${r}`));
} else {
  console.log("✅ No waste detected — fleet looks efficient.");
}
console.log();
