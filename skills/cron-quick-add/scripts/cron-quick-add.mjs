#!/usr/bin/env node
/**
 * cron-quick-add — Generate a ready-to-register OpenClaw cron job JSON
 * from a natural language description.
 *
 * Zero dependencies. Node.js 18+.
 */

import { parseArgs } from "node:util";

// ── CLI ────────────────────────────────────────────────────────────────
const { values: flags } = parseArgs({
  options: {
    name:            { type: "string", short: "n" },
    schedule:        { type: "string", short: "s" },
    at:              { type: "string" },
    every:           { type: "string" },
    tz:              { type: "string", default: "Europe/Dublin" },
    payload:         { type: "string", short: "p" },
    session:         { type: "string", default: "isolated" },
    delivery:        { type: "string", short: "d" },
    stagger:         { type: "string", default: "0" },
    description:     { type: "string" },
    "delete-after-run": { type: "boolean", default: false },
    "payload-only":  { type: "boolean", default: false },
    json:            { type: "boolean", default: false },
    "dry-run":       { type: "boolean", default: false },
    help:            { type: "boolean", default: false },
  },
  strict: true,
});

if (flags.help) {
  console.log(`Usage: cron-quick-add.mjs [options]

Required:
  -n, --name <string>         Job name
  -p, --payload <string>      Prompt/instruction for the LLM

Schedule (one required):
  -s, --schedule <cron>       Cron expression (e.g. "0 7 * * *")
      --at <ISO8601>          One-shot timestamp
      --every <seconds>       Interval in seconds

Options:
      --tz <tz>               Timezone (default: Europe/Dublin)
      --session <type>        "main" or "isolated" (default: isolated)
  -d, --delivery <target>     slack:channel:ID | slack:user:ID | whatsapp:user:ID | none
      --stagger <seconds>     Random stagger (default: 0)
      --description <text>    Longer job description
      --delete-after-run      Auto-delete after firing
      --payload-only          Output only the payload object
      --json                  Compact JSON output
      --dry-run               Show what would be generated
  -h, --help                  Show this help
`);
  process.exit(0);
}

// ── Validate ───────────────────────────────────────────────────────────
const errors = [];

if (!flags.name) errors.push("--name is required");
if (!flags.payload) errors.push("--payload is required");

const scheduleKinds = [flags.schedule, flags.at, flags.every].filter(Boolean);
if (scheduleKinds.length === 0) errors.push("One of --schedule, --at, or --every is required");
if (scheduleKinds.length > 1) errors.push("Only one of --schedule, --at, or --every allowed");

if (flags.session && !["main", "isolated"].includes(flags.session)) {
  errors.push('--session must be "main" or "isolated"');
}

if (errors.length) {
  console.error("Validation errors:\n  " + errors.join("\n  "));
  process.exit(2);
}

// ── Build schedule ─────────────────────────────────────────────────────
let schedule;
if (flags.schedule) {
  schedule = { kind: "cron", expr: flags.schedule, tz: flags.tz };
} else if (flags.at) {
  schedule = { kind: "at", at: flags.at };
} else if (flags.every) {
  schedule = { kind: "every", intervalMs: parseInt(flags.every, 10) * 1000 };
}

const staggerSec = parseInt(flags.stagger, 10) || 0;
if (staggerSec > 0 && schedule.kind === "cron") {
  schedule.staggerMs = staggerSec * 1000;
}

// ── Build payload ──────────────────────────────────────────────────────
const isMain = flags.session === "main";
const payload = isMain
  ? { kind: "systemEvent", text: flags.payload }
  : { kind: "agentTurn", message: flags.payload };

if (flags["payload-only"]) {
  const out = flags.json ? JSON.stringify(payload) : JSON.stringify(payload, null, 2);
  console.log(out);
  process.exit(0);
}

// ── Build delivery ─────────────────────────────────────────────────────
let delivery;
if (flags.delivery && flags.delivery !== "none") {
  const parts = flags.delivery.split(":");
  if (parts.length >= 3) {
    const [channel, targetType, ...idParts] = parts;
    const targetId = idParts.join(":"); // handle colons in IDs (e.g. whatsapp:+353...)
    const mode = "announce";
    delivery = { mode, channel, to: `${targetType}:${targetId}` };
  }
}

// ── Build job ──────────────────────────────────────────────────────────
const job = {
  name: flags.name,
  ...(flags.description ? { description: flags.description } : {}),
  enabled: true,
  schedule,
  sessionTarget: flags.session,
  wakeMode: "now",
  payload,
  ...(delivery ? { delivery } : {}),
  deleteAfterRun: flags["delete-after-run"],
};

// ── Output ─────────────────────────────────────────────────────────────
if (flags["dry-run"]) {
  console.log("Would generate the following job:");
}

const out = flags.json ? JSON.stringify(job) : JSON.stringify(job, null, 2);
console.log(out);
