---
name: credential-timeline
description: Track credential failure and recovery history over time. Records each credential-health check result, shows failure streaks, recovery detection, mean-time-to-recovery, and recurring failure patterns. Complements credential-health (point-in-time check) and graceful-degradation (alert response) with historical trend analysis. Use when investigating how long a credential has been broken, whether it keeps breaking, mean time to recovery, or the history of credential issues across your fleet.
---

# Credential Timeline

Track credential failure/recovery history over time. Records each `credential-health` check result, builds a timeline, and surfaces patterns like recurring failures and mean time to recovery.

## Why

`credential-health` tells you if a credential is broken *right now*. But it doesn't answer:
- How long has it been broken?
- Does it keep breaking every few weeks?
- How quickly do failures get fixed (MTTR)?
- Which credentials have the worst reliability?

This skill fills that gap by recording every check and analyzing the history.

## How It Works

1. Runs `credential-health` (same checks, same env vars)
2. Appends results to a local JSON state file
3. Compares against previous runs to detect failures, recoveries, and streaks
4. Outputs a human-readable timeline or structured JSON

## Script

`scripts/credential-timeline.mjs` — Node.js ESM, zero external dependencies.

## Requirements

- Node.js 18+
- `credential-health.cjs` on PATH or at a known location
- Environment variables for any credentials being checked (same as `credential-health`)

## Usage

```bash
# Record current check and show summary
node scripts/credential-timeline.mjs

# Check specific services
node scripts/credential-timeline.mjs --check gmail-file slack attio

# Record + show full timeline
node scripts/credential-timeline.mjs --timeline

# Show only services with current failures
node scripts/credential-timeline.mjs --fail-only

# Show pattern analysis (MTTR, failure frequency, recurring issues)
node scripts/credential-timeline.mjs --analyze

# JSON output
node scripts/credential-timeline.mjs --json

# Custom state file location
node scripts/credential-timeline.mjs --state /path/to/state.json

# Custom credential-health script location
node scripts/credential-timeline.mjs --health-script /path/to/credential-health.cjs

# Prune old records (keep last N days)
node scripts/credential-timeline.mjs --prune --keep-days 30

# Show history without recording a new check
node scripts/credential-timeline.mjs --history-only

# Reset all history
node scripts/credential-timeline.mjs --reset
```

## Output Modes

### Summary (default)

Shows current status, active failures, and recent recovery info:

```
Credential Timeline
───────────────────
Last check: 2026-05-07 00:13 UTC

✅ slack       OK (12 consecutive ok, last fail: 14 days ago)
❌ gmail-file  FAILING for 5 days 3h (6 consecutive fails)
               Detail: Refresh token invalid or revoked
               Last ok: 2026-05-01 09:00 UTC
✅ attio       OK (24 consecutive ok)

Records: 47 checks over 30 days
```

### Timeline (--timeline)

Full event history:

```
Credential Timeline
───────────────────
gmail-file  2026-05-01 09:00  ✅ ok
gmail-file  2026-05-02 00:28  ❌ fail — Refresh token invalid or revoked
gmail-file  2026-05-03 00:13  ❌ fail — Refresh token invalid or revoked
gmail-file  2026-05-04 00:45  ❌ fail — Refresh token invalid or revoked
gmail-file  2026-05-05 00:30  ❌ fail — Refresh token invalid or revoked
gmail-file  2026-05-06 14:45  ❌ fail — Refresh token invalid or revoked
gmail-file  2026-05-07 00:13  ❌ fail — Refresh token invalid or revoked
```

### Analysis (--analyze)

Statistical analysis:

```
Credential Analysis (last 30 days)
───────────────────────────────────

gmail-file
  Total checks:  30
  Failures:      6 (20%)
  Current streak: 6 fails (since 2026-05-02)
  MTTR:           N/A (still failing)
  Mean time between failures: 14 days
  ⚠️  RECURRING — has failed 2 times in 30 days

slack
  Total checks:  30
  Failures:      0 (0%)
  Uptime:        100%
  Current streak: 30 ok
```

### JSON (--json)

```json
{
  "timestamp": "2026-05-07T00:13:00.000Z",
  "current": {
    "gmail-file": { "status": "fail", "streak": 6, "since": "2026-05-02T00:28:00.000Z" },
    "slack": { "status": "ok", "streak": 30, "since": "2026-04-07T00:00:00.000Z" }
  },
  "analysis": {
    "gmail-file": {
      "totalChecks": 30,
      "failures": 6,
      "mttr": null,
      "failureCount": 2,
      "recurring": true
    }
  },
  "records": 30,
  "daysCovered": 30
}
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--check` | all | Services to check (passed to credential-health) |
| `--timeline` | false | Show full event timeline |
| `--fail-only` | false | Show only currently-failing services |
| `--analyze` | false | Show statistical analysis |
| `--json` | false | JSON output |
| `--state` | `~/.openclaw/credentials/timeline.json` | State file path |
| `--health-script` | auto-detected | Path to credential-health.cjs |
| `--prune` | false | Prune old records |
| `--keep-days` | 30 | Days to keep when pruning |
| `--history-only` | false | Show history without recording a new check |
| `--reset` | false | Delete all history |

## Integration with Cron

Create a cron job that records credential checks every few hours:

```json
{
  "name": "Credential timeline tracker",
  "schedule": { "kind": "cron", "expr": "0 */6 * * *", "tz": "Europe/Dublin" },
  "payload": {
    "kind": "agentTurn",
    "message": "Run credential-timeline with --fail-only. If any credentials are currently failing, send a brief WhatsApp alert with the service name and how long it's been failing. If all OK, reply NO_REPLY."
  }
}
```

Or combine with the daily credential watchdog:

```
1. Run: node credential-timeline.mjs --analyze --json
2. Parse the output. Flag any service with recurring: true or MTTR > 48h.
3. Include these in the daily health report.
```

## State File Format

```json
{
  "version": 1,
  "checks": [
    {
      "timestamp": "2026-05-07T00:13:00.000Z",
      "results": {
        "gmail-file": { "status": "fail", "detail": "Refresh token invalid or revoked" },
        "slack": { "status": "ok", "detail": "Bot token valid" }
      }
    }
  ]
}
```

## Anti-Patterns

- ❌ Running too frequently (every minute) — pollutes history with noise
- ❌ Not pruning — state file grows unbounded over time
- ✅ Run every 4-6 hours for good granularity without noise
- ✅ Prune to 30-90 days depending on how far back you want analysis
- ✅ Pair with `credential-health` — this skill wraps it, doesn't replace it
