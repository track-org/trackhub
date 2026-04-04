---
name: cron-health
description: Monitor OpenClaw cron job health — check all jobs for errors, delivery failures, and stale runs. Use when diagnosing cron issues, proactive heartbeat checks, or generating a status overview of all scheduled tasks.
skill-type: standard
category: agent-ops
tags: [cron, monitoring, health-check, proactive, debugging]
suggested-connectors: []
suggested-job-type: heartbeat
available-scripts:
  - name: cron-health
    description: Generate a health report for all OpenClaw cron jobs
---

# Cron Health 🔍

Quick health check for all OpenClaw cron jobs. Catches errors, delivery failures, and stale runs at a glance.

## Why

When you have 5+ cron jobs, checking each one individually is tedious. This skill runs one command and tells you what's broken — perfect for heartbeat proactive checks.

## How to Run

```bash
node scripts/cron-health.mjs                 # Full report
node scripts/cron-health.mjs --fail-only      # Only show problems
node scripts/cron-health.mjs --json           # Machine-readable JSON
node scripts/cron-health.mjs --quiet          # Exit code only (0=healthy, 1=issues)
node scripts/cron-health.mjs --include-disabled
```

## Options

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--max-runs` | `-n` | 5 | Recent runs to inspect per job |
| `--json` | | false | Output raw JSON |
| `--fail-only` | | false | Only show jobs with issues |
| `--quiet` | | false | No output, exit code only |
| `--include-disabled` | | false | Include disabled jobs |

## What It Checks

- **Job status** — `ok`, `error`, `idle`, `disabled`
- **Consecutive errors** — 3+ consecutive failures → `error`, any failures → `warn`
- **Delivery status** — last run not delivered → `warn`
- **Never run** — idle job with no last run → `warn`

## Output Example

```
══ Cron Health Report ══
4 healthy · 1 warnings · 0 errors · 1 disabled — 6 total

✅ Solar export WhatsApp alert [ok]
   Schedule: cron 0,30 6-21 * * * @ Europe/Dublin · Target: main · Last: 17m ago · Next: in 12m

✅ Daily Gmail digest to Don [ok]
   Schedule: cron 0 9 * * * @ Europe/Dublin · Target: main · Last: 2h ago · Next: in 2h

⚠️ Attio stage changes to #product [ok] · 1 consecutive error
   Schedule: cron 0 7 * * * @ Europe/Dublin · Target: isolated · Last: 18m ago · Next: in 24h

⏸️ Old notification job [disabled]
   Schedule: cron 0 8 * * 1 · Target: isolated · Last: 3d ago · Next: -
```

## Use in Heartbeats

Add to HEARTBEAT.md or run during heartbeat checks:

```bash
node scripts/cron-health.mjs --fail-only --quiet
```

Exit code 1 means something needs attention. The agent can then run the full report to investigate.

## Dependencies

- `openclaw` CLI (must be on PATH)
- Node.js 18+
- Uses `shared-lib` for argument parsing and output formatting (installed in trackhub)

## JSON Output Schema

```json
{
  "jobs": [
    {
      "name": "Job name",
      "id": "uuid",
      "schedule": "cron expr",
      "status": "ok|error|idle|disabled",
      "target": "main|isolated",
      "last": "18m ago",
      "next": "in 12m",
      "severity": "ok|warn|error|disabled",
      "recentRuns": 5,
      "recentFailures": 0,
      "lastDeliveryStatus": "delivered",
      "consecutiveErrors": 0
    }
  ],
  "healthy": true,
  "timestamp": "2026-04-05T00:18:00.000Z"
}
```
