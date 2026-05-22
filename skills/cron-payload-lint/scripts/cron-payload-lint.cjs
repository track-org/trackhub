#!/usr/bin/env node
// cron-payload-lint.cjs — Validate cron job payloads and configurations
// Catches common mistakes before they become failed runs.

"use strict";

const fs = require("fs");
const path = require("path");

// ── CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {
  file: null,
  json: false,
  quiet: false,
  strict: false,
  skillDir: null,
  help: false,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--file":
    case "-f":
      opts.file = args[++i];
      break;
    case "--json":
      opts.json = true;
      break;
    case "--quiet":
    case "-q":
      opts.quiet = true;
      break;
    case "--strict":
      opts.strict = true;
      break;
    case "--skill-dir":
      opts.skillDir = args[++i];
      break;
    case "--help":
    case "-h":
      opts.help = true;
      break;
  }
}

if (opts.help) {
  console.log(`Usage: cron-payload-lint.cjs [options]

Validate cron job payloads and configurations before registration.

Options:
  --file, -f <path>     JSON file with cron job(s) to validate
                         (single object or array; defaults to stdin)
  --skill-dir <path>    Skill catalogue directory for skill-reference checks
  --strict              Treat warnings as errors
  --json                Output results as JSON
  --quiet, -q           Only show errors (no warnings or passes)
  --help, -h            Show this help

Exit codes:
  0  All checks pass (warnings ok in non-strict mode)
  1  One or more errors found
  2  Validation failure (bad input)

Examples:
  # Validate a single job file
  node cron-payload-lint.cjs --file ./my-job.json

  # Validate from pipe
  cat jobs.json | node cron-payload-lint.cjs

  # Strict mode with skill catalogue check
  node cron-payload-lint.cjs --file jobs.json --skill-dir ./skills --strict
`);
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────
const VALID_SCHEDULE_KINDS = ["cron", "interval", "once", "at"];
const VALID_WAKE_MODES = ["now", "queue"];
const VALID_SESSION_TARGETS = ["main", "isolated"];
const VALID_PAYLOAD_KINDS = ["systemEvent", "agentTurn"];
const VALID_DELIVERY_MODES = ["announce", "silent", "reply", "none"];
const VALID_CHANNEL_TYPES = ["slack", "whatsapp", "discord", "telegram", "signal", "last"];

// Regex for cron expressions (standard 5-field)
const CRON_EXPR_RE = /^(\*|[0-9,/|-]+)\s+(\*|[0-9,/|-]+)\s+(\*|[0-9,/|-]+)\s+(\*|[0-9,/|-]+)\s+(\*|[0-9,/|-]+)$/;

function readInput() {
  if (opts.file) {
    try {
      return fs.readFileSync(opts.file, "utf8");
    } catch (e) {
      return { _error: `Cannot read file: ${opts.file} — ${e.message}` };
    }
  }
  // Read from stdin if piped
  if (!process.stdin.isTTY) {
    return fs.readFileSync(0, "utf8");
  }
  return null;
}

function lintJob(job, index, knownSkills) {
  const issues = [];
  const label = job.name || `Job #${index}`;
  const prefix = `[${label}]`;

  // ── Required fields ─────────────────────────────────────────────
  if (!job.name || typeof job.name !== "string" || job.name.trim() === "") {
    issues.push({ level: "error", code: "MISSING_NAME", msg: `${prefix} Missing or empty "name" field` });
  }
  if (job.name && job.name.length > 120) {
    issues.push({ level: "warning", code: "LONG_NAME", msg: `${prefix} Name is very long (${job.name.length} chars). Consider shortening.` });
  }

  // ── Schedule ────────────────────────────────────────────────────
  if (!job.schedule) {
    issues.push({ level: "error", code: "MISSING_SCHEDULE", msg: `${prefix} Missing "schedule" object` });
  } else {
    if (!job.schedule.kind || !VALID_SCHEDULE_KINDS.includes(job.schedule.kind)) {
      issues.push({ level: "error", code: "INVALID_SCHEDULE_KIND", msg: `${prefix} Invalid schedule.kind "${job.schedule.kind}". Must be one of: ${VALID_SCHEDULE_KINDS.join(", ")}` });
    }

    if (job.schedule.kind === "cron") {
      if (!job.schedule.expr) {
        issues.push({ level: "error", code: "MISSING_CRON_EXPR", msg: `${prefix} Cron schedule missing "expr"` });
      } else if (!CRON_EXPR_RE.test(job.schedule.expr)) {
        issues.push({ level: "error", code: "INVALID_CRON_EXPR", msg: `${prefix} Invalid cron expression "${job.schedule.expr}". Expected 5-field standard cron.` });
      } else {
        // Extra cron field validation
        const fields = job.schedule.expr.split(/\s+/);
        const mins = fields[0];
        const hrs = fields[1];
        const dom = fields[2];
        const mon = fields[3];
        const dow = fields[4];

        if (dom !== "*" && dow !== "*") {
          issues.push({ level: "warning", code: "CRON_DOM_DOW_CONFLICT", msg: `${prefix} Cron specifies both day-of-month (${dom}) and day-of-week (${dow}). Most cron engines treat this as OR, which may not be intended.` });
        }

        // Validate numeric ranges
        function validateField(field, name, min, max) {
          if (field === "*") return;
          const parts = field.split(",");
          for (const part of parts) {
            const rangeParts = part.split("/");
            const base = rangeParts[0];
            if (base !== "*") {
              const nums = base.includes("-") ? base.split("-").map(Number) : [Number(base)];
              for (const n of nums) {
                if (isNaN(n) || n < min || n > max) {
                  issues.push({ level: "error", code: "CRON_FIELD_RANGE", msg: `${prefix} Cron ${name} value ${n} out of range (${min}-${max})` });
                }
              }
            }
          }
        }
        validateField(mins, "minute", 0, 59);
        validateField(hrs, "hour", 0, 23);
        validateField(dom, "day-of-month", 1, 31);
        validateField(mon, "month", 1, 12);
        validateField(dow, "day-of-week", 0, 6);
      }

      if (!job.schedule.tz) {
        issues.push({ level: "warning", code: "MISSING_TZ", msg: `${prefix} Cron schedule has no "tz" — will use system default, which may cause DST issues` });
      }
    }

    if (job.schedule.kind === "once" || job.schedule.kind === "at") {
      if (!job.schedule.at && !job.schedule.atMs) {
        issues.push({ level: "error", code: "MISSING_ONCE_AT", msg: `${prefix} "${job.schedule.kind}" schedule needs "at" or "atMs"` });
      }
    }

    if (job.schedule.kind === "interval") {
      if (!job.schedule.ms && !job.schedule.every) {
        issues.push({ level: "error", code: "MISSING_INTERVAL", msg: `${prefix} "interval" schedule needs "ms" or "every"` });
      }
    }
  }

  // ── Session target ──────────────────────────────────────────────
  if (job.sessionTarget && !VALID_SESSION_TARGETS.includes(job.sessionTarget)) {
    issues.push({ level: "error", code: "INVALID_SESSION_TARGET", msg: `${prefix} Invalid sessionTarget "${job.sessionTarget}". Must be one of: ${VALID_SESSION_TARGETS.join(", ")}` });
  }

  // ── Wake mode ───────────────────────────────────────────────────
  if (job.wakeMode && !VALID_WAKE_MODES.includes(job.wakeMode)) {
    issues.push({ level: "error", code: "INVALID_WAKE_MODE", msg: `${prefix} Invalid wakeMode "${job.wakeMode}". Must be one of: ${VALID_WAKE_MODES.join(", ")}` });
  }

  // ── Payload ─────────────────────────────────────────────────────
  if (!job.payload) {
    issues.push({ level: "error", code: "MISSING_PAYLOAD", msg: `${prefix} Missing "payload" object` });
  } else {
    if (!job.payload.kind || !VALID_PAYLOAD_KINDS.includes(job.payload.kind)) {
      issues.push({ level: "error", code: "INVALID_PAYLOAD_KIND", msg: `${prefix} Invalid payload.kind "${job.payload.kind}". Must be one of: ${VALID_PAYLOAD_KINDS.join(", ")}` });
    }

    if (job.payload.kind === "systemEvent" && (!job.payload.text || typeof job.payload.text !== "string")) {
      issues.push({ level: "error", code: "MISSING_PAYLOAD_TEXT", msg: `${prefix} systemEvent payload missing "text"` });
    }

    if (job.payload.kind === "agentTurn" && (!job.payload.message || typeof job.payload.message !== "string")) {
      issues.push({ level: "error", code: "MISSING_PAYLOAD_MESSAGE", msg: `${prefix} agentTurn payload missing "message"` });
    }

    // Check for very short payloads
    const payloadText = job.payload.text || job.payload.message || "";
    if (payloadText && payloadText.length < 20) {
      issues.push({ level: "warning", code: "SHORT_PAYLOAD", msg: `${prefix} Payload text is very short (${payloadText.length} chars). May be too vague for the agent.` });
    }

    // Check for skill references in payload
    const skillRefs = extractSkillReferences(payloadText);
    for (const ref of skillRefs) {
      if (knownSkills !== null && !knownSkills.has(ref)) {
        issues.push({ level: "warning", code: "UNKNOWN_SKILL_REF", msg: `${prefix} Payload references skill "${ref}" which was not found in the skill catalogue` });
      }
    }

    // Check for script paths that might not exist (if we can resolve them)
    const scriptPaths = extractScriptPaths(payloadText);
    for (const sp of scriptPaths) {
      if (sp.startsWith("/")) {
        try {
          fs.accessSync(sp, fs.constants.R_OK);
        } catch {
          issues.push({ level: "warning", code: "SCRIPT_NOT_FOUND", msg: `${prefix} Payload references script "${sp}" which does not exist (may be created at runtime)` });
        }
      }
    }
  }

  // ── Delivery ────────────────────────────────────────────────────
  if (job.delivery) {
    if (job.delivery.mode && !VALID_DELIVERY_MODES.includes(job.delivery.mode)) {
      issues.push({ level: "error", code: "INVALID_DELIVERY_MODE", msg: `${prefix} Invalid delivery.mode "${job.delivery.mode}". Must be one of: ${VALID_DELIVERY_MODES.join(", ")}` });
    }

    if (job.delivery.channel && !VALID_CHANNEL_TYPES.includes(job.delivery.channel)) {
      issues.push({ level: "error", code: "INVALID_DELIVERY_CHANNEL", msg: `${prefix} Invalid delivery.channel "${job.delivery.channel}". Must be one of: ${VALID_CHANNEL_TYPES.join(", ")}` });
    }

    if (job.delivery.mode === "announce" && !job.delivery.to && job.delivery.channel !== "last") {
      issues.push({ level: "error", code: "MISSING_DELIVERY_TO", msg: `${prefix} announce delivery mode requires a "to" field` });
    }

    if (job.delivery.to && typeof job.delivery.to === "string") {
      if (!job.delivery.to.match(/^(channel|user|dm):.+/)) {
        issues.push({ level: "error", code: "INVALID_DELIVERY_TO", msg: `${prefix} delivery.to "${job.delivery.to}" doesn't match expected format "channel:ID" or "user:ID"` });
      }
    }
  }

  // ── Common mistakes ─────────────────────────────────────────────
  // Check for enabled field being a string instead of boolean
  if ("enabled" in job && typeof job.enabled === "string") {
    issues.push({ level: "error", code: "ENABLED_NOT_BOOL", msg: `${prefix} "enabled" should be boolean, not string` });
  }

  // Check for duplicate-sensitive fields
  if (job.payload && job.payload.kind === "agentTurn" && job.delivery && job.delivery.mode === "announce" && job.sessionTarget === "main") {
    issues.push({ level: "warning", code: "MAIN_WITH_ANNOUNCE", msg: `${prefix} sessionTarget "main" with delivery mode "announce" — the agent will see the result in main session AND it will be announced. Make sure this is intentional.` });
  }

  return issues;
}

function extractSkillReferences(text) {
  if (!text) return [];
  const refs = [];
  // Match skill names in paths like skills/xyz/scripts/ or /trackhub/skills/xyz/
  const pathRe = /skills\/([a-z0-9-]+)\//g;
  let m;
  while ((m = pathRe.exec(text)) !== null) {
    refs.push(m[1]);
  }
  // Also match explicit skill name mentions like "use the cron-health skill"
  const mentionRe = /\b(?:use\s+(?:the\s+)?|run\s+(?:the\s+)?)?([a-z][a-z0-9-]*-[a-z0-9-]+)\s+skill\b/gi;
  while ((m = mentionRe.exec(text)) !== null) {
    refs.push(m[1].toLowerCase());
  }
  return [...new Set(refs)];
}

function extractScriptPaths(text) {
  if (!text) return [];
  const re = /[`"']?(\/[^\s`"']+\.(?:py|mjs|cjs|js|sh))[`"']?/g;
  const paths = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    paths.push(m[1]);
  }
  return [...new Set(paths)];
}

function loadKnownSkills(skillDir) {
  if (!skillDir) return null;
  try {
    const entries = fs.readdirSync(skillDir, { withFileTypes: true });
    return new Set(entries.filter(e => e.isDirectory()).map(e => e.name));
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────
const input = readInput();
if (input && typeof input === "object" && input._error) {
  console.error(input._error);
  process.exit(2);
}
if (!input) {
  console.error("No input provided. Use --file <path> or pipe JSON to stdin.");
  process.exit(2);
}

let jobs;
try {
  const parsed = JSON.parse(input);
  // Handle { jobs: [...] } envelope
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.jobs)) {
    jobs = parsed.jobs;
  } else if (Array.isArray(parsed)) {
    jobs = parsed;
  } else if (parsed && typeof parsed === "object") {
    jobs = [parsed];
  } else {
    console.error("Input must be a cron job object or array of jobs");
    process.exit(2);
  }
} catch (e) {
  console.error(`Invalid JSON: ${e.message}`);
  process.exit(2);
}

const knownSkills = loadKnownSkills(opts.skillDir);
const allIssues = [];
let errorCount = 0;
let warnCount = 0;

for (let i = 0; i < jobs.length; i++) {
  const issues = lintJob(jobs[i], i, knownSkills);
  allIssues.push(...issues);
  for (const issue of issues) {
    if (issue.level === "error") errorCount++;
    else warnCount++;
  }
}

// ── Output ────────────────────────────────────────────────────────────
if (opts.json) {
  console.log(JSON.stringify({
    totalJobs: jobs.length,
    errors: errorCount,
    warnings: warnCount,
    strict: opts.strict,
    issues: allIssues,
  }, null, 2));
} else {
  if (allIssues.length === 0) {
    if (!opts.quiet) {
      console.log(`✅ ${jobs.length} job(s) passed all checks`);
    }
  } else {
    const errors = allIssues.filter(i => i.level === "error");
    const warnings = allIssues.filter(i => i.level === "warning");

    if (errors.length > 0) {
      console.error(`❌ ${errors.length} error(s):`);
      for (const e of errors) {
        console.error(`   ${e.code}: ${e.msg}`);
      }
    }
    if (warnings.length > 0 && !opts.quiet) {
      console.warn(`⚠️  ${warnings.length} warning(s):`);
      for (const w of warnings) {
        console.warn(`   ${w.code}: ${w.msg}`);
      }
    }

    if (errors.length === 0) {
      console.log(`✅ No errors (${warnings.length} warning${warnings.length !== 1 ? "s" : ""})`);
    }
  }
}

const exitErrors = opts.strict ? errorCount + warnCount : errorCount;
process.exit(exitErrors > 0 ? 1 : 0);
