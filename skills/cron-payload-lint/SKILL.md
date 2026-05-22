---
name: cron-payload-lint
description: Validate cron job payloads before registration — catch missing skill references, invalid JSON, wrong channel IDs, invalid schedule expressions, missing required fields, and unknown skills. Prevents bad configs from becoming failed runs.
skill-type: standard
category: agent-ops
tags: [cron, validation, linting, config, quality]
suggested-connectors: []
suggested-job-type: manual
suggested-schedule-frequency: on-demand
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: cron-payload-lint
    description: Validate one or more cron job configurations against the expected schema
---

# Cron Payload Lint

Validate cron job configurations *before* they're registered. Catches common mistakes that would otherwise cause silent failures, wasted agent turns, or confusing errors.

## Why

OpenClaw cron jobs are flexible — payloads are free-form text passed to the agent, schedules use cron expressions, and delivery config varies by channel. That flexibility means it's easy to make mistakes: a malformed cron expression, a missing timezone, a typo in a skill reference, or a delivery target that doesn't match the expected format.

`cron-first-aid` diagnoses broken jobs *after* they fail. This skill catches problems *before* they run.

## What It Checks

### Schedule validation
- Missing or invalid `schedule.kind` (must be `cron`, `interval`, or `once`)
- Invalid cron expressions (5-field format, numeric range checks)
- Missing timezone on cron schedules (DST gotcha)
- Day-of-month + day-of-week conflict (usually unintended OR logic)
- Missing `at`/`atMs` on `once` schedules
- Missing `ms`/`every` on `interval` schedules

### Payload validation
- Missing or invalid `payload.kind` (`systemEvent` or `agentTurn`)
- Missing text/message in payload
- Very short payloads (<20 chars — likely too vague)
- References to skills not found in the catalogue
- References to scripts that don't exist on disk

### Delivery validation
- Invalid delivery mode, channel type, or target format
- Missing `to` field on `announce` mode
- `sessionTarget: "main"` combined with `announce` delivery (usually unintentional duplication)

### Schema sanity
- `enabled` field is a string instead of boolean
- Missing required fields (`name`, `schedule`, `payload`)

## Script

`scripts/cron-payload-lint.cjs` — Zero dependencies. Node.js 18+.

## Usage

```bash
# Validate a single job file
node cron-payload-lint.cjs --file ./my-job.json

# Validate from stdin (pipe)
cat jobs.json | node cron-payload-lint.cjs

# Validate with skill catalogue reference checking
node cron-payload-lint.cjs --file jobs.json --skill-dir /path/to/skills/

# Validate live cron jobs (pipe from openclaw)
openclaw cron list --json | node cron-payload-lint.cjs --skill-dir ./skills/

# Strict mode (warnings become errors)
node cron-payload-lint.cjs --file jobs.json --strict

# JSON output for programmatic use
node cron-payload-lint.cjs --file jobs.json --json

# Quiet mode (only errors)
node cron-payload-lint.cjs --file jobs.json --quiet
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--file` | `-f` | *(stdin)* | JSON file with cron job(s) to validate |
| `--skill-dir` | | *(none)* | Skill catalogue directory for reference checks |
| `--strict` | | false | Treat warnings as errors |
| `--json` | | false | Output results as JSON |
| `--quiet` | `-q` | false | Only show errors (no warnings) |
| `--help` | `-h` | | Show usage |

## Input Format

Accepts:
- Single cron job object
- Array of cron job objects
- Envelope format `{ "jobs": [...] }` (matches `openclaw cron list --json` output)

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All checks pass (warnings ok in non-strict mode) |
| 1 | One or more errors found |
| 2 | Validation failure (bad input, file not found) |

## Integration

### Before registering a new cron job
```bash
# Validate first, then register
node cron-payload-lint.cjs --file new-job.json --skill-dir ./skills/ && \
  openclaw cron add new-job.json
```

### Audit existing cron fleet
```bash
openclaw cron list --json | node cron-payload-lint.cjs --skill-dir ./skills/ --json
```

### CI/CD pipeline
```bash
# Strict mode — fail on any issue
node cron-payload-lint.cjs --file jobs/*.json --strict --quiet
```

## Related Skills

- **cron-first-aid** — Diagnoses broken cron jobs *after* failure
- **cron-health** — Runtime health monitoring for all cron jobs
- **cron-scheduler** — Analyzes timing and scheduling conflicts
- **cron-preflight** — Runtime credential pre-check pattern
- **openclaw-cron** — Cron job schema and management reference
