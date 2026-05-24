#!/usr/bin/env node
// cron-readiness.cjs — Fleet-wide readiness scanner for OpenClaw cron jobs.
// Checks credentials, scripts, delivery, schedule collisions, and snoozed jobs in one pass.

"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function hasFlag(flag, short) {
  return args.includes(flag) || (short && args.includes(short));
}
if (hasFlag("--help", "-h")) {
  console.log(`Usage: node cron-readiness.cjs [options]

Fleet-wide readiness scanner for OpenClaw cron jobs.

Options:
  --fail-only          Only show jobs with issues
  --json               Output structured JSON
  --include-disabled   Include disabled/snoozed jobs
  --verbose            Show per-job detail for all checks
  --quiet              No output, exit code only (0=ready, 1=degraded, 2=not-ready)
  --skip-credentials   Skip live credential checks (static analysis only)
  -h, --help           Show this help

Exit codes: 0 = READY, 1 = DEGRADED, 2 = NOT-READY
`);
  process.exit(0);
}

const failOnly = hasFlag("--fail-only");
const jsonOut = hasFlag("--json");
const includeDisabled = hasFlag("--include-disabled");
const verbose = hasFlag("--verbose");
const quiet = hasFlag("--quiet");
const skipCredentials = hasFlag("--skip-credentials");

// ── Load fleet ───────────────────────────────────────────────────────────
function loadFleet() {
  try {
    const out = execSync("openclaw cron list --json", { encoding: "utf8", timeout: 10000 });
    const data = JSON.parse(out);
    return data.jobs || [];
  } catch (e) {
    throw new Error(`Could not load cron fleet: ${e.message}`);
  }
}

// ── Payload text extraction ──────────────────────────────────────────────
function getPayloadText(job) {
  const p = job.payload || {};
  const texts = [];
  if (typeof p === "string") texts.push(p);
  else {
    if (p.text) texts.push(p.text);
    if (typeof p.message === "string") texts.push(p.message);
    if (p.systemEvent && p.systemEvent.text) texts.push(p.systemEvent.text);
    if (p.agentTurn && typeof p.agentTurn.message === "string") texts.push(p.agentTurn.message);
  }
  return texts.join("\n");
}

// ── Dependency extraction ────────────────────────────────────────────────
function extractDeps(text) {
  const deps = { scripts: [], credentials: [], apis: [], channels: [], commands: [] };
  const lower = text.toLowerCase();

  // Script paths
  const scriptRe = /(?:\/[\w./-]+\/(?:scripts|skill)\/[\w./-]+\.(?:cjs|mjs|js|py|sh))/gi;
  (text.match(scriptRe) || []).forEach(s => { if (!deps.scripts.includes(s)) deps.scripts.push(s); });

  // Credential / service keywords
  const credKeywords = ["gmail", "slack", "attio", "supabase", "emporia", "solis", "google", "openai", "anthropic", "open-meteo"];
  credKeywords.forEach(kw => {
    if (lower.includes(kw) && !deps.credentials.includes(kw)) deps.credentials.push(kw);
  });

  // Preflight --check references
  const preflightRe = /--check\s+(\S+)/gi;
  let m;
  while ((m = preflightRe.exec(text)) !== null) {
    if (!deps.credentials.includes(m[1])) deps.credentials.push(m[1]);
  }

  // API domains
  const apiRe = /https?:\/\/([\w.-]+\.(com|io|co|dev|org|net|app)[/\w.-]*)/gi;
  while ((m = apiRe.exec(text)) !== null) {
    const domain = m[1].split("/")[0];
    if (!deps.apis.includes(domain)) deps.apis.push(domain);
  }

  // Channel IDs and phone numbers
  const chanIdRe = /[CDFG]\d[A-Z0-9]{8,}/g;
  (text.match(chanIdRe) || []).forEach(id => {
    if (!deps.channels.includes(id)) deps.channels.push(id);
  });
  const phoneRe = /\+\d{10,15}/g;
  (text.match(phoneRe) || []).forEach(ph => {
    if (!deps.channels.includes(`whatsapp:${ph}`)) deps.channels.push(`whatsapp:${ph}`);
  });

  return deps;
}

// ── Check: credentials ───────────────────────────────────────────────────
function checkCredentials(fleetDeps) {
  const results = [];
  if (skipCredentials || fleetDeps.size === 0) return results;

  for (const [cred, jobNames] of fleetDeps) {
    try {
      const out = execSync(
        `node ${path.resolve(__dirname, "../../credential-health/scripts/credential-health.cjs")} --check ${cred} --json 2>/dev/null`,
        { encoding: "utf8", timeout: 15000 }
      );
      const data = JSON.parse(out);
      const status = data.status || (data.healthy ? "ok" : "error");
      results.push({
        credential: cred,
        status: status === "ok" || status === "healthy" ? "ok" : "error",
        detail: data.message || data.error || (status === "ok" ? "Valid" : "Issue detected"),
        jobs: jobNames
      });
    } catch (e) {
      // credential-health script may not exist or credential unknown
      results.push({
        credential: cred,
        status: "warning",
        detail: `Could not verify (credential-health unavailable or error)`,
        jobs: jobNames
      });
    }
  }
  return results;
}

// ── Check: scripts ───────────────────────────────────────────────────────
function checkScripts(fleetScripts) {
  const results = [];
  const workspaceRoot = process.env.WORKSPACE_ROOT || path.resolve(process.cwd(), "../..");

  for (const [script, jobNames] of fleetScripts) {
    const resolved = script.startsWith("/") ? script : path.resolve(workspaceRoot, script.replace(/^\.\//, ""));
    const exists = fs.existsSync(resolved);
    results.push({
      script,
      status: exists ? "ok" : "error",
      detail: exists ? `Found` : `Not found at ${resolved}`,
      jobs: jobNames
    });
  }
  return results;
}

// ── Check: delivery ──────────────────────────────────────────────────────
function checkDelivery(jobs) {
  const results = [];
  for (const job of jobs) {
    const payloadText = getPayloadText(job);
    const mentionsSend = /deliver|send to|notify|alert|message|whatsapp|slack channel/i.test(payloadText);
    const delivery = job.delivery;

    if (delivery && delivery.channel) {
      results.push({
        job: job.name,
        status: "ok",
        detail: `Delivery: ${delivery.channel}${delivery.target ? ` → ${delivery.target}` : ""}`
      });
    } else if (mentionsSend && !delivery) {
      results.push({
        job: job.name,
        status: "warning",
        detail: "Payload mentions sending but no delivery config — agent must send manually"
      });
    }
    // If no mention of sending and no delivery config, that's fine — skip
  }
  return results;
}

// ── Check: schedule collisions ───────────────────────────────────────────
function parseCronFields(expr) {
  // Basic cron: min hour dom month dow
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return null;
  return { minute: parts[0], hour: parts[1], dom: parts[2], month: parts[3], dow: parts[4] };
}

function cronFieldsMatch(f, now) {
  // Very simplified — checks if the cron would fire at the given time
  // minute/hour match; dom/month/dow are wildcarded for simplicity
  const minMatch = f.minute === "*" || f.minute.split(",").map(Number).includes(now.getMinutes());
  const hourMatch = f.hour === "*" || f.hour.split(",").map(Number).includes(now.getHours());
  return minMatch && hourMatch;
}

function checkScheduleCollisions(jobs) {
  const results = [];
  const enabled = jobs.filter(j => j.enabled !== false && j.schedule);
  const cronJobs = enabled.filter(j => j.schedule.kind === "cron" && j.schedule.expr);
  const now = new Date();
  const next60 = new Date(now.getTime() + 60 * 60 * 1000);

  // Check each minute in the next 60 for collisions
  for (let t = new Date(now.getTime()); t < next60; t.setMinutes(t.getMinutes() + 1)) {
    const firing = [];
    for (const job of cronJobs) {
      const fields = parseCronFields(job.schedule.expr);
      if (fields && cronFieldsMatch(fields, t)) {
        firing.push(job.name);
      }
    }
    if (firing.length > 1) {
      const timeStr = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
      // Deduplicate by time
      const existing = results.find(r => r.time === timeStr);
      if (!existing) {
        results.push({
          time: timeStr,
          status: "warning",
          jobs: firing,
          detail: `${firing.length} jobs fire simultaneously at ${timeStr}: ${firing.join(", ")}`
        });
      }
    }
  }

  // Collapse consecutive collision minutes into one entry
  return results;
}

// ── Check: snoozed/disabled ──────────────────────────────────────────────
function checkSnoozed(jobs) {
  const results = [];
  for (const job of jobs) {
    if (job.enabled === false) {
      // Check if it was recently active
      const lastRun = job.state && job.state.lastRunAtMs;
      const lastStr = lastRun ? formatAgo(Date.now() - lastRun) : "never";
      results.push({
        job: job.name,
        status: "info",
        detail: `Disabled — last ran ${lastStr}`
      });
    }
  }
  return results;
}

// ── Per-job readiness ────────────────────────────────────────────────────
function perJobReadiness(jobs, credResults, scriptResults, deliveryResults) {
  const summaries = [];
  for (const job of jobs) {
    const issues = [];
    const warnings = [];

    // Credentials for this job
    const jobCreds = credResults.filter(c => c.jobs && c.jobs.includes(job.name));
    jobCreds.forEach(c => {
      if (c.status === "error") issues.push(`Credential ${c.credential}: ${c.detail}`);
      else if (c.status === "warning") warnings.push(`Credential ${c.credential}: ${c.detail}`);
    });

    // Scripts for this job
    const jobScripts = scriptResults.filter(s => s.jobs && s.jobs.includes(job.name));
    jobScripts.forEach(s => {
      if (s.status === "error") issues.push(`Script ${s.script}: ${s.detail}`);
    });

    // Delivery for this job
    const jobDelivery = deliveryResults.find(d => d.job === job.name);
    if (jobDelivery && jobDelivery.status === "warning") {
      warnings.push(jobDelivery.detail);
    }

    const verdict = issues.length > 0 ? "not-ready" : warnings.length > 0 ? "degraded" : "ready";
    summaries.push({
      name: job.name,
      verdict,
      issues,
      warnings,
      schedule: job.schedule ? formatSchedule(job.schedule) : "none"
    });
  }
  return summaries;
}

// ── Helpers ──────────────────────────────────────────────────────────────
function formatAgo(ms) {
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

function formatSchedule(s) {
  if (s.kind === "cron") return `cron ${s.expr}`;
  if (s.kind === "at") return `one-shot at ${s.at}`;
  if (s.kind === "every") return `every ${s.intervalMs / 60000}m`;
  return `${s.kind}`;
}

// ── Fleet-level verdict ──────────────────────────────────────────────────
function fleetVerdict(jobSummaries, credResults, scriptResults, collisionResults) {
  const hasErrors = jobSummaries.some(j => j.verdict === "not-ready")
    || credResults.some(c => c.status === "error")
    || scriptResults.some(s => s.status === "error");
  const hasWarnings = jobSummaries.some(j => j.verdict === "degraded")
    || credResults.some(c => c.status === "warning")
    || collisionResults.length > 0;

  if (hasErrors) return "NOT-READY";
  if (hasWarnings) return "DEGRADED";
  return "READY";
}

// ── Format output ────────────────────────────────────────────────────────
function formatReadinessReport(report) {
  const lines = [];
  const v = report.verdict;
  const emoji = v === "READY" ? "✅" : v === "DEGRADED" ? "⚠️" : "❌";

  lines.push(`🚦 Cron Fleet Readiness — ${emoji} ${v}`);
  lines.push(`   ${report.totalJobs} jobs · ${report.enabledJobs} enabled`);
  lines.push("═".repeat(60));
  lines.push("");

  // Credentials
  if (report.credentials.length > 0) {
    lines.push("🔑 Credentials:");
    for (const c of report.credentials) {
      const s = c.status === "ok" ? "✅" : c.status === "warning" ? "⚠️" : "❌";
      lines.push(`  ${s} ${c.credential} — ${c.detail}`);
      if (verbose || c.status !== "ok") {
        lines.push(`     Used by: ${c.jobs.join(", ")}`);
      }
    }
    lines.push("");
  }

  // Scripts
  if (report.scripts.length > 0) {
    lines.push("📜 Scripts:");
    for (const s of report.scripts) {
      const icon = s.status === "ok" ? "✅" : "❌";
      lines.push(`  ${icon} ${s.script} — ${s.detail}`);
      if (verbose || s.status !== "ok") {
        lines.push(`     Used by: ${s.jobs.join(", ")}`);
      }
    }
    lines.push("");
  }

  // Delivery
  if (report.delivery.length > 0 && (verbose || report.delivery.some(d => d.status !== "ok"))) {
    lines.push("📬 Delivery:");
    for (const d of report.delivery) {
      if (verbose || d.status !== "ok") {
        const icon = d.status === "ok" ? "✅" : "⚠️";
        lines.push(`  ${icon} ${d.job} — ${d.detail}`);
      }
    }
    lines.push("");
  }

  // Schedule collisions
  if (report.collisions.length > 0) {
    lines.push("⏰ Schedule Collisions (next 60 min):");
    for (const c of report.collisions) {
      lines.push(`  ⚠️ ${c.detail}`);
    }
    lines.push("");
  }

  // Snoozed/disabled
  if (report.snoozed.length > 0) {
    lines.push("⏸️  Snoozed/Disabled:");
    for (const s of report.snoozed) {
      lines.push(`  ℹ️ ${s.job} — ${s.detail}`);
    }
    lines.push("");
  }

  // Per-job summary
  lines.push("📋 Per-Job Summary:");
  const showAll = verbose || !failOnly;
  for (const j of report.jobSummaries) {
    if (!showAll && j.verdict === "ready") continue;
    const icon = j.verdict === "ready" ? "✅" : j.verdict === "degraded" ? "⚠️" : "❌";
    lines.push(`  ${icon} ${j.name} [${j.schedule}]`);
    for (const i of j.issues) lines.push(`     ❌ ${i}`);
    for (const w of j.warnings) lines.push(`     ⚠️  ${w}`);
  }

  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────
try {
  const allJobs = loadFleet();
  const jobs = includeDisabled ? allJobs : allJobs.filter(j => j.enabled !== false);

  // Collect fleet-wide deps
  const fleetCreds = new Map();   // credential → [jobNames]
  const fleetScripts = new Map(); // script → [jobNames]

  for (const job of jobs) {
    const text = getPayloadText(job);
    const deps = extractDeps(text);
    deps.credentials.forEach(c => {
      if (!fleetCreds.has(c)) fleetCreds.set(c, []);
      if (!fleetCreds.get(c).includes(job.name)) fleetCreds.get(c).push(job.name);
    });
    deps.scripts.forEach(s => {
      if (!fleetScripts.has(s)) fleetScripts.set(s, []);
      if (!fleetScripts.get(s).includes(job.name)) fleetScripts.get(s).push(job.name);
    });
  }

  // Run checks
  const credResults = checkCredentials(fleetCreds);
  const scriptResults = checkScripts(fleetScripts);
  const deliveryResults = checkDelivery(jobs);
  const collisionResults = checkScheduleCollisions(jobs);
  const snoozedResults = includeDisabled ? checkSnoozed(allJobs) : checkSnoozed(allJobs.filter(j => j.enabled === false));

  // Per-job summaries
  const jobSummaries = perJobReadiness(jobs, credResults, scriptResults, deliveryResults);

  // Fleet verdict
  const verdict = fleetVerdict(jobSummaries, credResults, scriptResults, collisionResults);

  const report = {
    verdict,
    timestamp: new Date().toISOString(),
    totalJobs: allJobs.length,
    enabledJobs: jobs.length,
    credentials: credResults,
    scripts: scriptResults,
    delivery: deliveryResults,
    collisions: collisionResults,
    snoozed: snoozedResults,
    jobSummaries
  };

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!quiet) {
    console.log(formatReadinessReport(report));
  }

  const exitCode = verdict === "READY" ? 0 : verdict === "DEGRADED" ? 1 : 2;
  process.exit(exitCode);

} catch (e) {
  if (jsonOut) {
    console.log(JSON.stringify({ error: e.message }));
  } else if (!quiet) {
    console.error(`❌ ${e.message}`);
  }
  process.exit(2);
}
