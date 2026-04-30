#!/usr/bin/env node

/**
 * cron-trend-analyzer.mjs — Trend analysis across cron job run history.
 *
 * Fetches run history for one or more cron jobs and computes reliability,
 * cost, and performance trends over configurable windows. Flags degrading
 * jobs, token cost creep, duration drift, and error patterns before they
 * become full breakages.
 *
 * Zero external dependencies. Node.js 18+ (built-in fetch).
 *
 * Usage:
 *   node cron-trend-analyzer.mjs                        # All jobs, last 7d
 *   node cron-trend-analyzer.mjs --job-id <id>          # Single job
 *   node cron-trend-analyzer.mjs --name "gmail"         # Fuzzy name match
 *   node cron-trend-analyzer.mjs --days 14              # 14-day window
 *   node cron-trend-analyzer.mjs --degrading-only       # Only show problem jobs
 *   node cron-trend-analyzer.mjs --json                 # Raw JSON output
 *   node cron-trend-analyzer.mjs --fail-only            # Only failed runs
 *
 * Flags:
 *   --job-id <id>         Cron job UUID
 *   --name <pattern>      Fuzzy match job name (substring)
 *   --days <n>            Analysis window in days (default: 7)
 *   --min-runs <n>        Minimum runs to include a job (default: 3)
 *   --degrading-only      Only show jobs with degrading trends
 *   --fail-only           Only include jobs with failures in the window
 *   --json                Raw JSON output
 *   --quiet               Only show warnings/degradations
 */

import { execSync } from "child_process";

// ── Helpers ──────────────────────────────────────────────────────────────────

function shell(cmd) {
  try {
    const out = execSync(cmd, {
      encoding: "utf-8",
      timeout: 20000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, data: out.trim() };
  } catch (e) {
    return { ok: false, data: e.stderr?.trim() || e.message };
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      args[key] = argv[++i];
    } else {
      args[key] = true;
    }
  }
  return args;
}

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function fmtTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function pctChange(old, cur) {
  if (!old || old === 0) return null;
  return ((cur - old) / old) * 100;
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

// ── Data fetching ───────────────────────────────────────────────────────────

function listJobs() {
  const r = shell("openclaw cron list --json 2>/dev/null || openclaw cron list");
  if (!r.ok) return [];
  try {
    const data = JSON.parse(r.data);
    return Array.isArray(data) ? data : data.jobs || data.entries || [];
  } catch {
    // Fallback: parse text output
    return [];
  }
}

function getRuns(jobId, days) {
  // Fetch as many runs as we can; openclaw doesn't support date filtering
  const r = shell(`openclaw cron runs --id ${jobId} --limit 100 2>&1`);
  if (!r.ok) return [];

  try {
    const data = JSON.parse(r.data);
    const entries = data.entries || data.runs || [];
    const cutoff = Date.now() - days * 86400000;
    return entries.filter((e) => {
      const ts = e.ts || e.runAtMs || 0;
      return ts >= cutoff;
    });
  } catch {
    return [];
  }
}

// ── Analysis ────────────────────────────────────────────────────────────────

function formatSchedule(sched) {
  if (!sched) return "unknown";
  if (typeof sched === "string") return sched;
  if (sched.expr) return `${sched.expr} (${sched.tz || "UTC"})`;
  return JSON.stringify(sched);
}

function analyzeJob(job, runs) {
  if (!runs.length) return null;

  const successes = runs.filter((r) => r.status === "ok" || r.status === "success");
  const failures = runs.filter((r) => r.status === "error" || r.status === "fail");
  const reliability = runs.length ? (successes.length / runs.length) * 100 : 100;

  const durations = runs.map((r) => r.durationMs || 0).filter(Boolean);
  const tokens = runs.map((r) => r.usage?.total_tokens || 0).filter(Boolean);
  const inputTokens = runs.map((r) => r.usage?.input_tokens || 0).filter(Boolean);
  const outputTokens = runs.map((r) => r.usage?.output_tokens || 0).filter(Boolean);
  const deliveryFails = runs.filter(
    (r) => r.delivered === false || r.deliveryStatus === "failed" || r.deliveryStatus === "error"
  );

  // Split into first half / second half for trend comparison
  const mid = Math.floor(runs.length / 2);
  const firstHalf = runs.slice(0, mid || runs.length);
  const secondHalf = runs.slice(mid || runs.length);

  const firstReliability = firstHalf.length
    ? (firstHalf.filter((r) => r.status === "ok" || r.status === "success").length / firstHalf.length) * 100
    : 100;
  const secondReliability = secondHalf.length
    ? (secondHalf.filter((r) => r.status === "ok" || r.status === "success").length / secondHalf.length) * 100
    : 100;

  const firstDuration = mean(firstHalf.map((r) => r.durationMs || 0).filter(Boolean));
  const secondDuration = mean(secondHalf.map((r) => r.durationMs || 0).filter(Boolean));
  const firstTokens = mean(firstHalf.map((r) => r.usage?.total_tokens || 0).filter(Boolean));
  const secondTokens = mean(secondHalf.map((r) => r.usage?.total_tokens || 0).filter(Boolean));

  // Detect issues
  const issues = [];

  // Reliability degradation
  if (secondReliability < firstReliability && secondReliability < 90) {
    issues.push({
      type: "reliability-decline",
      severity: secondReliability < 50 ? "high" : "medium",
      detail: `Reliability dropped from ${firstReliability.toFixed(0)}% → ${secondReliability.toFixed(0)}%`,
    });
  }

  // Recent failures
  const last5 = runs.slice(-5);
  const recentFails = last5.filter(
    (r) => r.status !== "ok" && r.status !== "success"
  ).length;
  if (recentFails >= 3) {
    issues.push({
      type: "frequent-failures",
      severity: "high",
      detail: `${recentFails}/5 recent runs failed`,
    });
  } else if (recentFails >= 2) {
    issues.push({
      type: "frequent-failures",
      severity: "medium",
      detail: `${recentFails}/5 recent runs failed`,
    });
  }

  // Token cost creep (>30% increase)
  if (firstTokens > 0 && secondTokens > 0) {
    const tokenChange = pctChange(firstTokens, secondTokens);
    if (tokenChange !== null && tokenChange > 30) {
      issues.push({
        type: "token-creep",
        severity: tokenChange > 100 ? "high" : "medium",
        detail: `Avg tokens ${firstTokens.toFixed(0)} → ${secondTokens.toFixed(0)} (+${tokenChange.toFixed(0)}%)`,
      });
    }
  }

  // Duration drift (>50% increase)
  if (firstDuration > 0 && secondDuration > 0) {
    const durChange = pctChange(firstDuration, secondDuration);
    if (durChange !== null && durChange > 50) {
      issues.push({
        type: "duration-drift",
        severity: durChange > 100 ? "high" : "low",
        detail: `Avg duration ${fmtDuration(firstDuration)} → ${fmtDuration(secondDuration)} (+${durChange.toFixed(0)}%)`,
      });
    }
  }

  // Delivery failures
  if (deliveryFails.length > 0) {
    issues.push({
      type: "delivery-failures",
      severity: deliveryFails.length > 2 ? "high" : "medium",
      detail: `${deliveryFails.length} run(s) with failed delivery`,
    });
  }

  // Consecutive failures at end
  const tailFails = [];
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].status === "ok" || runs[i].status === "success") break;
    tailFails.push(runs[i]);
  }
  if (tailFails.length >= 2) {
    issues.push({
      type: "consecutive-failures",
      severity: "high",
      detail: `${tailFails.length} consecutive failure(s) at tail`,
    });
  }

  return {
    jobId: job.id || job.jobId || job.uuid || "unknown",
    name: job.name || job.label || "unnamed",
    schedule: formatSchedule(job.schedule || job.cron),
    enabled: job.enabled !== false && job.status !== "disabled",
    window: runs.length,
    totalRuns: runs.length,
    successes: successes.length,
    failures: failures.length,
    reliability: Math.round(reliability * 10) / 10,
    avgDuration: durations.length ? Math.round(median(durations)) : null,
    avgDurationStr: durations.length ? fmtDuration(median(durations)) : "N/A",
    totalTokens: tokens.reduce((a, b) => a + b, 0),
    avgTokens: tokens.length ? Math.round(median(tokens)) : null,
    avgTokensStr: tokens.length ? fmtTokens(Math.round(median(tokens))) : "N/A",
    deliveryFails: deliveryFails.length,
    firstHalfReliability: Math.round(firstReliability * 10) / 10,
    secondHalfReliability: Math.round(secondReliability * 10) / 10,
    tokenTrend: firstTokens > 0 && secondTokens > 0 ? Math.round(pctChange(firstTokens, secondTokens)) : null,
    durationTrend: firstDuration > 0 && secondDuration > 0 ? Math.round(pctChange(firstDuration, secondDuration)) : null,
    issues,
    degrading: issues.some((i) => i.severity === "high") || issues.length >= 2,
    lastRun: runs[runs.length - 1] || null,
    lastRunTs: runs[runs.length - 1]?.ts || runs[runs.length - 1]?.runAtMs || null,
  };
}

// ── Output ──────────────────────────────────────────────────────────────────

function formatReport(results, args) {
  if (!results.length) {
    return args["degrading-only"] || args["fail-only"]
      ? "✅ No jobs match the filter — everything looks healthy."
      : "⚠️  No runs found in the analysis window.";
  }

  const lines = [];
  const days = args.days || 7;

  lines.push(`📊 Cron Trend Analysis — last ${days} days`);
  lines.push(`═══════════════════════════════════════════════════`);
  lines.push("");

  // Summary
  const totalRuns = results.reduce((a, r) => a + r.totalRuns, 0);
  const totalFails = results.reduce((a, r) => a + r.failures, 0);
  const degrading = results.filter((r) => r.degrading);
  lines.push(`Jobs analyzed: ${results.length} | Total runs: ${totalRuns} | Failures: ${totalFails} | Degrading: ${degrading.length}`);
  lines.push("");

  for (const r of results) {
    const icon = r.degrading ? "🔴" : r.failures > 0 ? "🟡" : "🟢";
    const name = r.name.length > 40 ? r.name.slice(0, 37) + "..." : r.name;

    lines.push(`${icon} ${name}`);
    if (!r.enabled) lines.push(`   ⏸️  DISABLED`);
    lines.push(`   Schedule: ${r.schedule}`);
    lines.push(`   Runs: ${r.totalRuns} | ✅ ${r.successes} | ❌ ${r.failures} | Reliability: ${r.reliability}%`);

    if (r.avgDuration !== null) {
      const trend = r.durationTrend !== null ? ` (${r.durationTrend > 0 ? "+" : ""}${r.durationTrend}%)` : "";
      lines.push(`   Duration: ${r.avgDurationStr} median${trend}`);
    }

    if (r.avgTokens !== null) {
      const trend = r.tokenTrend !== null ? ` (${r.tokenTrend > 0 ? "+" : ""}${r.tokenTrend}%)` : "";
      lines.push(`   Tokens: ${r.avgTokensStr}/run median | Total: ${fmtTokens(r.totalTokens)}${trend}`);
    }

    if (r.deliveryFails > 0) {
      lines.push(`   ⚠️  ${r.deliveryFails} delivery failure(s)`);
    }

    // Reliability trend
    if (r.firstHalfReliability !== null && r.secondHalfReliability !== null && r.totalRuns >= 4) {
      const arrow =
        r.secondHalfReliability > r.firstHalfReliability
          ? "📈"
          : r.secondHalfReliability < r.firstHalfReliability
          ? "📉"
          : "➡️";
      lines.push(`   Reliability trend: ${arrow} ${r.firstHalfReliability}% → ${r.secondHalfReliability}%`);
    }

    // Issues
    for (const issue of r.issues) {
      const sev = issue.severity === "high" ? "‼️" : issue.severity === "medium" ? "⚠️" : "💡";
      lines.push(`   ${sev} ${issue.detail}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);
  const days = parseInt(args.days) || 7;
  const minRuns = parseInt(args["min-runs"]) || 3;

  let jobs = listJobs();

  // Filter by job ID
  if (args["job-id"]) {
    jobs = jobs.filter(
      (j) => (j.id || j.jobId || j.uuid) === args["job-id"]
    );
    if (!jobs.length) {
      console.error(`❌ Job not found: ${args["job-id"]}`);
      process.exit(1);
    }
  }

  // Filter by name (fuzzy substring)
  if (args.name) {
    const pattern = args.name.toLowerCase();
    jobs = jobs.filter((j) => {
      const name = (j.name || j.label || "").toLowerCase();
      return name.includes(pattern);
    });
    if (!jobs.length) {
      console.error(`❌ No jobs matching: ${args.name}`);
      process.exit(1);
    }
  }

  // Analyze each job
  const results = [];
  for (const job of jobs) {
    const id = job.id || job.jobId || job.uuid;
    if (!id) continue;

    const runs = getRuns(id, days);
    const analysis = analyzeJob(job, runs);

    if (!analysis) continue;
    if (analysis.totalRuns < minRuns) continue;
    if (args["fail-only"] && analysis.failures === 0) continue;

    results.push(analysis);
  }

  // Filter degrading only
  if (args["degrading-only"]) {
    const filtered = results.filter((r) => r.degrading);
    if (args.json) {
      console.log(JSON.stringify(filtered, null, 2));
    } else if (args.quiet) {
      // In quiet mode, only show issues from degrading jobs
      for (const r of filtered) {
        for (const issue of r.issues) {
          const sev = issue.severity === "high" ? "‼️" : "⚠️";
          console.log(`${sev} [${r.name}] ${issue.detail}`);
        }
      }
      if (!filtered.length) console.log("✅ No degrading jobs detected.");
    } else {
      console.log(formatReport(filtered, args));
    }
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else if (args.quiet) {
    // Only show jobs with issues
    const withIssues = results.filter((r) => r.issues.length > 0);
    for (const r of withIssues) {
      for (const issue of r.issues) {
        const sev = issue.severity === "high" ? "‼️" : issue.severity === "medium" ? "⚠️" : "💡";
        console.log(`${sev} [${r.name}] ${issue.detail}`);
      }
    }
    if (!withIssues.length) console.log("✅ All jobs healthy.");
  } else {
    console.log(formatReport(results, args));
  }
}

main();
