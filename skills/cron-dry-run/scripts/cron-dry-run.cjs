#!/usr/bin/env node
// cron-dry-run.cjs — Simulate a cron job execution without side effects.
// Parses payload, traces dependencies, validates prerequisites, reports what would happen.

"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag, short) {
  const idx = args.findIndex(a => a === flag || (short && a === short));
  return idx >= 0 && idx < args.length - 1 ? args[idx + 1] : null;
}
function hasFlag(flag, short) {
  return args.includes(flag) || (short && args.includes(short));
}
if (hasFlag("--help", "-h")) {
  console.log(`Usage: node cron-dry-run.cjs [options]

Simulate a cron job payload without side effects.

Options:
  --job <id|name>       Job ID or name from the live fleet
  --file <path>         Read job JSON from a file (openclaw cron export format)
  --stdin               Read job JSON from stdin
  --payload <text>      Analyse a raw payload string
  --verbose             Show detailed payload breakdown
  --json                Output as JSON
  -h, --help            Show this help

Examples:
  node cron-dry-run.cjs --job "Solar export WhatsApp nudge"
  node cron-dry-run.cjs --job abc-123-def --verbose
  node cron-dry-run.cjs --file backup.json
  echo '{"name":"test",...}' | node cron-dry-run.cjs --stdin
  node cron-dry-run.cjs --payload "Run credential-health --check gmail"
`);
  process.exit(0);
}

const jobIdOrName = getArg("--job");
const filePath = getArg("--file");
const useStdin = hasFlag("--stdin");
const rawPayload = getArg("--payload");
const verbose = hasFlag("--verbose");
const jsonOut = hasFlag("--json");

// ── Resolve job definition ───────────────────────────────────────────────
function resolveJob() {
  if (rawPayload) return { name: "(inline payload)", payload: { kind: "systemEvent", text: rawPayload } };
  if (filePath) {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const jobs = Array.isArray(raw) ? raw : raw.jobs || [raw];
    if (jobs.length === 0) throw new Error("No jobs found in file");
    return jobs[0];
  }
  if (useStdin) {
    const raw = JSON.parse(fs.readFileSync("/dev/stdin", "utf8"));
    const jobs = Array.isArray(raw) ? raw : raw.jobs || [raw];
    if (jobs.length === 0) throw new Error("No jobs found in stdin");
    return jobs[0];
  }
  if (jobIdOrName) {
    try {
      const out = execSync("openclaw cron list --json", { encoding: "utf8", timeout: 10000 });
      const data = JSON.parse(out);
      const jobs = data.jobs || [];
      const job = jobs.find(j => j.id === jobIdOrName || j.name === jobIdOrName || j.name.toLowerCase().includes(jobIdOrName.toLowerCase()));
      if (!job) throw new Error(`No job matching "${jobIdOrName}"`);
      return job;
    } catch (e) {
      throw new Error(`Could not resolve job "${jobIdOrName}": ${e.message}`);
    }
  }
  throw new Error("Provide --job, --file, --stdin, or --payload");
}

// ── Payload text extraction ──────────────────────────────────────────────
function getPayloadText(job) {
  const p = job.payload || {};
  const texts = [];
  if (p.text) texts.push(p.text);
  if (typeof p.message === "string") texts.push(p.message);
  // Some payloads nest deeper
  if (p.systemEvent && p.systemEvent.text) texts.push(p.systemEvent.text);
  if (p.agentTurn && typeof p.agentTurn.message === "string") texts.push(p.agentTurn.message);
  return texts.join("\n");
}

// ── Dependency extraction ────────────────────────────────────────────────
function extractDeps(text) {
  const deps = { scripts: [], credentials: [], apis: [], channels: [], commands: [] };

  // Script paths
  const scriptRe = /(?:\/[\w./-]+\/(?:scripts|skill)\/[\w./-]+\.(?:cjs|mjs|js|py|sh))/gi;
  (text.match(scriptRe) || []).forEach(s => { if (!deps.scripts.includes(s)) deps.scripts.push(s); });

  // CLI commands (openclaw, node, python3, curl, etc.)
  const cmdRe = /(?:^|\n)\s*(openclaw|node|python3?|curl|bash|sh)\s+[^\n]+/gi;
  (text.match(cmdRe) || []).forEach(c => { if (!deps.commands.includes(c.trim())) deps.commands.push(c.trim()); });

  // Credential / service keywords
  const credKeywords = ["gmail", "slack", "attio", "supabase", "emporia", "solis", "google", "openai", "anthropic"];
  const lower = text.toLowerCase();
  credKeywords.forEach(kw => {
    if (lower.includes(kw) && !deps.credentials.includes(kw)) deps.credentials.push(kw);
  });

  // Preflight checks
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

  // Channel mentions
  const channelRe = /(?:slack|whatsapp|discord|telegram|signal)[\s-]?(?:channel|chat|dm|group)?/gi;
  (text.match(channelRe) || []).forEach(ch => {
    const normalized = ch.toLowerCase().trim();
    if (!deps.channels.includes(normalized)) deps.channels.push(normalized);
  });

  // Channel IDs
  const chanIdRe = /[CDFG]\d[A-Z0-9]{8,}/g;
  (text.match(chanIdRe) || []).forEach(id => {
    if (!deps.channels.includes(id)) deps.channels.push(id);
  });

  // WhatsApp targets
  const phoneRe = /\+\d{10,15}/g;
  (text.match(phoneRe) || []).forEach(ph => {
    if (!deps.channels.includes(`whatsapp:${ph}`)) deps.channels.push(`whatsapp:${ph}`);
  });

  return deps;
}

// ── Validation checks ────────────────────────────────────────────────────
function validate(job, payloadText, deps) {
  const checks = [];

  // 1. Scripts exist?
  const workspaceRoot = process.env.WORKSPACE_ROOT || path.resolve(process.cwd(), "../..");
  deps.scripts.forEach(script => {
    const resolved = script.startsWith("/") ? script : path.resolve(workspaceRoot, script.replace(/^\.\//, ""));
    const exists = fs.existsSync(resolved);
    checks.push({
      category: "script",
      item: script,
      status: exists ? "ok" : "missing",
      detail: exists ? `Found at ${resolved}` : `Not found at ${resolved}`
    });
  });

  // 2. Job has preflight if it uses credentials?
  const hasPreflight = /credential-health|--check|preflight/i.test(payloadText);
  if (deps.credentials.length > 0 && !hasPreflight) {
    checks.push({
      category: "preflight",
      item: "credential check",
      status: "warning",
      detail: `Payload references credentials (${deps.credentials.join(", ")}) but has no preflight check`
    });
  } else if (deps.credentials.length > 0 && hasPreflight) {
    checks.push({
      category: "preflight",
      item: "credential check",
      status: "ok",
      detail: "Payload includes credential preflight"
    });
  }

  // 3. Delivery config?
  const delivery = job.delivery;
  if (delivery && delivery.channel) {
    checks.push({
      category: "delivery",
      item: delivery.channel,
      status: "ok",
      detail: `Delivers to ${delivery.channel}${delivery.target ? ` → ${delivery.target}` : ""}`
    });
  } else if (!delivery) {
    const mentionsDelivery = /deliver|send|whatsapp|slack|message/i.test(payloadText);
    if (mentionsDelivery) {
      checks.push({
        category: "delivery",
        item: "delivery config",
        status: "warning",
        detail: "Payload mentions sending/delivery but no delivery config on the job — agent must send manually"
      });
    } else {
      checks.push({
        category: "delivery",
        item: "delivery config",
        status: "info",
        detail: "No delivery config (agent handles output inline)"
      });
    }
  }

  // 4. Schedule sanity
  const sched = job.schedule;
  if (sched) {
    if (sched.kind === "cron" && sched.expr) {
      checks.push({
        category: "schedule",
        item: sched.expr,
        status: "ok",
        detail: `Cron: ${sched.expr} (${sched.tz || "UTC"})`
      });
    } else if (sched.kind === "at") {
      checks.push({
        category: "schedule",
        item: "one-shot",
        status: "info",
        detail: `One-shot at ${sched.at}`
      });
    }
  }

  // 5. Enabled?
  checks.push({
    category: "status",
    item: "enabled",
    status: job.enabled !== false ? "ok" : "warning",
    detail: job.enabled !== false ? "Job is enabled" : "Job is DISABLED"
  });

  // 6. Payload not empty
  if (!payloadText.trim()) {
    checks.push({
      category: "payload",
      item: "content",
      status: "error",
      detail: "Payload text is empty"
    });
  } else {
    checks.push({
      category: "payload",
      item: "content",
      status: "ok",
      detail: `Payload is ${payloadText.length} chars`
    });
  }

  return checks;
}

// ── Simulation report ────────────────────────────────────────────────────
function simulate(job) {
  const payloadText = getPayloadText(job);
  const deps = extractDeps(payloadText);
  const checks = validate(job, payloadText, deps);

  const errors = checks.filter(c => c.status === "error");
  const warnings = checks.filter(c => c.status === "warning");
  const ok = checks.filter(c => c.status === "ok");
  const info = checks.filter(c => c.status === "info");

  return {
    job: { name: job.name || "(unnamed)", id: job.id || null, enabled: job.enabled !== false },
    summary: {
      totalChecks: checks.length,
      ok: ok.length,
      warnings: warnings.length,
      errors: errors.length,
      info: info.length,
      verdict: errors.length > 0 ? "would-fail" : warnings.length > 0 ? "would-run-with-warnings" : "would-run-clean"
    },
    dependencies: deps,
    checks,
    payloadPreview: verbose ? payloadText.slice(0, 2000) : payloadText.slice(0, 300) + (payloadText.length > 300 ? "..." : "")
  };
}

// ── Output ───────────────────────────────────────────────────────────────
function formatStatus(s) {
  return s === "ok" ? "✅" : s === "warning" ? "⚠️" : s === "error" ? "❌" : "ℹ️";
}

function formatReport(r) {
  const lines = [];
  lines.push(`🔍 Dry Run: ${r.job.name}${r.job.id ? ` (${r.job.id.slice(0, 8)}...)` : ""}`);
  lines.push("═".repeat(60));

  // Verdict
  const verdictEmoji = r.summary.verdict === "would-fail" ? "❌" : r.summary.verdict === "would-run-with-warnings" ? "⚠️" : "✅";
  lines.push(`Verdict: ${verdictEmoji} ${r.summary.verdict.replace(/-/g, " ")}`);
  lines.push("");

  // Checks
  lines.push("Checks:");
  for (const c of r.checks) {
    lines.push(`  ${formatStatus(c.status)} [${c.category}] ${c.detail}`);
  }
  lines.push("");

  // Dependencies
  const deps = r.dependencies;
  if (deps.scripts.length || deps.credentials.length || deps.apis.length || deps.channels.length) {
    lines.push("Dependencies detected:");
    if (deps.scripts.length) lines.push(`  📜 Scripts: ${deps.scripts.join(", ")}`);
    if (deps.credentials.length) lines.push(`  🔑 Credentials: ${deps.credentials.join(", ")}`);
    if (deps.apis.length) lines.push(`  🌐 APIs: ${deps.apis.join(", ")}`);
    if (deps.channels.length) lines.push(`  📢 Channels: ${deps.channels.join(", ")}`);
    lines.push("");
  }

  if (deps.commands.length) {
    lines.push("Commands that would execute:");
    for (const cmd of deps.commands) {
      lines.push(`  $ ${cmd.slice(0, 120)}`);
    }
    lines.push("");
  }

  // Payload preview
  if (verbose && r.payloadPreview) {
    lines.push("Payload preview:");
    lines.push("─".repeat(40));
    lines.push(r.payloadPreview);
    lines.push("─".repeat(40));
  }

  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────
try {
  const job = resolveJob();
  const result = simulate(job);

  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatReport(result));
  }

  process.exit(result.summary.errors.length > 0 ? 1 : 0);
} catch (e) {
  if (jsonOut) {
    console.log(JSON.stringify({ error: e.message }));
  } else {
    console.error(`❌ ${e.message}`);
  }
  process.exit(1);
}
