---
name: cron-readiness
description: "Fleet-wide readiness scanner for OpenClaw cron jobs. Runs credential checks, validates script existence, verifies delivery configs, detects schedule collisions, and identifies snoozed jobs that should be awake — all in one pass. Answers 'is my fleet ready to run right now?' Use before deployments, during morning briefings, or as a pre-heartbeat gate."
skill-type: standard
category: agent-ops
tags: [cron, readiness, fleet, credentials, validation, pre-flight, monitoring]
suggested-connectors: [credential-health, cron-dashboard, cron-snooze, cron-dry-run]
suggested-job-type: heartbeat
available-scripts:
  - name: cron-readiness
    description: Fleet-wide readiness report combining credential, script, delivery, schedule, and snooze checks
---

# cron-readiness 🚦

Fleet-wide readiness scanner. One command answers: **"Is my cron fleet ready to run right now?"**

## Why

Existing tools cover individual slices:
- `cron-health` — did recent runs succeed? (post-hoc)
- `cron-dashboard` — visual status overview
- `cron-dry-run` — simulate a single job
- `credential-health` — check one credential
- `cron-snooze` — pause/resume jobs

But nothing combines them into a single **go/no-go gate**. When you want to know "will my fleet run cleanly over the next cycle?", you'd have to run 4-5 separate tools and mentally combine the results.

`cron-readiness` does it in one pass:
1. Checks all credentials referenced by jobs (via `credential-health` where available)
2. Validates script files exist on disk
3. Verifies delivery configs for jobs that need them
4. Detects schedule collisions (jobs about to fire simultaneously)
5. Identifies snoozed/disabled jobs that might be forgotten
6. Produces a single `READY` / `DEGRADED` / `NOT-READY` verdict

## Script

`scripts/cron-readiness.cjs` — Zero dependencies. Node.js 18+. Requires `openclaw` CLI on PATH.

## Usage

```bash
# Full fleet readiness check
node cron-readiness.cjs

# Only show problems
node cron-readiness.cjs --fail-only

# JSON output for scripting/automation
node cron-readiness.cjs --json

# Include disabled jobs in the scan
node cron-readiness.cjs --include-disabled

# Verbose: show per-job detail for passing checks too
node cron-readiness.cjs --verbose

# Quiet: exit code only (0=ready, 1=degraded, 2=not-ready)
node cron-readiness.cjs --quiet
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--fail-only` | false | Only show jobs with issues |
| `--json` | false | Output structured JSON |
| `--include-disabled` | false | Include disabled/snoozed jobs |
| `--verbose` | false | Show per-job detail for all checks |
| `--quiet` | false | No output, exit code only |
| `--skip-credentials` | false | Skip live credential checks (faster, static only) |
| `-h, --help` | | Show usage |

## Output Sections

1. **Fleet verdict** — `READY` ✅, `DEGRADED` ⚠️, or `NOT-READY` ❌
2. **Credential readiness** — Which credentials jobs need, and their status
3. **Script readiness** — Do referenced scripts exist on disk?
4. **Delivery readiness** — Are delivery configs in place for jobs that send output?
5. **Schedule collision detection** — Jobs about to fire in the same minute
6. **Snoozed/disabled audit** — Jobs that are paused and might be forgotten
7. **Per-job summary** — One-line verdict per job

## How It Works

1. Loads the full cron fleet via `openclaw cron list --json`
2. Extracts dependencies from each job's payload (scripts, credentials, channels)
3. For each credential: optionally runs `credential-health --check <service> --json` to get live status
4. Validates script file paths against the local filesystem
5. Checks delivery config presence and validity
6. Analyzes schedules for imminent collisions (jobs firing within the same minute)
7. Checks for snoozed/disabled jobs
8. Aggregates into a fleet-wide verdict

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Fleet is READY — all checks pass |
| 1 | DEGRADED — warnings but no hard blockers |
| 2 | NOT-READY — critical issues found |

## Integration

Pairs well with:
- **morning-briefing** — Include readiness as a section in the daily briefing
- **cron-dashboard** — Dashboard for status overview, readiness for pre-flight gate
- **cron-health** — Health checks recent history; readiness checks forward-looking prerequisites
- **cron-dry-run** — Dry-run for individual job simulation; readiness for fleet-wide check
- **cron-snooze** — Readiness identifies snoozed jobs; snooze manages them
- **heartbeat-checklist** — Add readiness as a periodic heartbeat check item

## Limitations

- Credential checks are live API calls (network dependent); use `--skip-credentials` for offline mode
- Schedule collision detection is approximate (checks next 60 minutes)
- Script existence checks use the local filesystem — may differ from production environments
- Does not execute scripts or validate their internal logic
- Snooze state is inferred from job enabled/disabled status and last activity

## Use in Heartbeats

```bash
# Quick check: any problems?
node cron-readiness.cjs --fail-only --quiet
# Exit 0 = all good, 1 = degraded, 2 = not-ready
```

Add to HEARTBEAT.md or heartbeat-checklist as a periodic gate.
