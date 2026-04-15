---
name: cron-first-aid
description: >
  Diagnose broken OpenClaw cron jobs and suggest safe repairs. Detects missing scripts,
  credential errors, delivery failures, vague payloads, and other common failure patterns.
  Use when a cron job is failing, when cron-health reports problems, or during proactive
  heartbeat checks to catch issues early.
skill-type: standard
category: agent-ops
tags: [cron, debugging, repair, diagnosis, monitoring, self-heal, proactive]
suggested-connectors: []
suggested-job-type: heartbeat
suggested-schedule-frequency: on-demand
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: cron-first-aid
    description: Analyze cron job failures and suggest repairs
---

# Cron First Aid 🩹

Diagnose broken cron jobs and suggest safe repairs. Pairs with `cron-health` (which detects problems) to provide the "what do I do about it?" layer.

## Why

`cron-health` tells you something's wrong. `cron-first-aid` tells you *why* and *what to do about it*. It catches common failure patterns:

- **Missing scripts** — payload references a script that was deleted or renamed
- **Credential errors** — expired OAuth tokens, revoked API keys
- **Delivery failures** — output produced but not delivered to the channel
- **Vague payloads** — isolated sessions getting incomplete instructions
- **Missing NO_REPLY** — conditional jobs that waste tokens on empty results
- **Missing delivery channel** — announce mode without explicit channel (multi-channel setups)
- **Suspiciously short runs** — silent failures with minimal output

## How to Run

```bash
node scripts/cron-first-aid.mjs                    # Full diagnosis of all jobs
node scripts/cron-first-aid.mjs --fail-only         # Only show jobs with problems
node scripts/cron-first-aid.mjs --job <id>          # Diagnose a specific job
node scripts/cron-first-aid.mjs --json              # Machine-readable JSON output
node scripts/cron-first-aid.mjs --max-runs 10       # Check more history per job
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--job <id>` | all | Diagnose a specific job (by ID or partial name match) |
| `--fail-only` | false | Only show jobs with warnings or errors |
| `--json` | false | Output as JSON |
| `--max-runs <n>` | 5 | Number of recent runs to inspect per job |
| `-h`, `--help` | — | Show usage |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All jobs healthy |
| 1 | Warnings found |
| 2 | Errors found |

## Detection Patterns

### Missing Script
Parses payload text for script paths (`node /path/to/script.mjs`, `python3 script.py`) and checks if they exist on disk. If missing, suggests similar files in the same directory.

### Credential Error
Scans recent run summaries for patterns like `invalid_grant`, `token expired`, `unauthorized`, `401`, `403`. Suggests running `credential-health` to pinpoint the broken service.

### Delivery Failure
Detects when a run produced significant output (high token ratio) but wasn't delivered. Distinguishes from expected `NO_REPLY` responses (low output, intentionally not delivered).

### Vague Payload
Flags isolated-session payloads that lack numbered steps, script references, or explicit instructions. These tend to produce unreliable results because the LLM has to guess what to do.

### Missing NO_REPLY
Detects conditional payloads ("if empty, skip") that don't include an explicit `NO_REPLY` instruction. Without it, the LLM generates wasteful "nothing to report" messages.

## Use in Heartbeats

Add to your heartbeat rotation (every 6-12 hours):

```bash
node scripts/cron-first-aid.mjs --fail-only --json
```

If exit code is 2 (errors), run the full report and investigate. If exit code is 1 (warnings), note for later. If 0, all clear.

### Pairing with cron-health

The recommended flow:
1. **cron-health** (`--fail-only --quiet`) → exit code tells you if anything's wrong
2. **cron-first-aid** (`--fail-only`) → tells you *why* and *what to fix*

## Output Example

```
══ Cron First Aid Report ══
4 healthy · 1 warning(s) · 1 error(s) · 0 info · 6 total

❌ Attio stage changes to #product
   ID: 10782216-8d1b-4834-9d38-4732be0c5c88
   Schedule: 0 7 * * * @ Europe/Dublin

   🔴 [missing_script] Referenced script does not exist: /path/to/daily-stage-changes.mjs
      Script path in payload not found on disk

   🩹 Repairs:
      • Found similar script(s): /path/to/pipeline-query.mjs
        → Consider replacing "/path/to/daily-stage-changes.mjs" with "/path/to/pipeline-query.mjs" in the job payload
        Confidence: medium
────────────────────────────────────────────────────────────

⚠️ Daily Gmail digest
   ID: 87218ac1-9366-44e3-a018-723437395479
   Schedule: 0 9 * * * @ Europe/Dublin

   🟡 [credential_error] Credential/auth error detected in recent run
      Run summary: "OAuth token expired: invalid_grant"

   🩹 Repairs:
      • Run credential-health check for the affected service
        → Re-authenticate the affected credential and verify it works
        Confidence: high
────────────────────────────────────────────────────────────
```

## Dependencies

- `openclaw` CLI (must be on PATH)
- Node.js 18+
- No external packages

## Safety

- **Read-only by default.** The script only reads cron job state and checks file existence.
- Never modifies cron jobs automatically — it suggests repairs for human (or agent) review.
- Does not access external APIs — all diagnosis is local.
