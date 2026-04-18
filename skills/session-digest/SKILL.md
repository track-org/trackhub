---
name: session-digest
description: Summarise a day's OpenClaw cron activity into a concise report. Shows per-job run counts, token usage, estimated cost, duration, and delivery status. Flags errors and delivery issues. Use when reviewing daily agent activity, generating a morning briefing, or auditing cron job spending and health over a time period.
---

# Session Digest

Daily activity summary for all OpenClaw cron jobs.

## Overview

Reads cron run history from `~/.openclaw/cron/runs/` (JSONL files) and cross-references with `~/.openclaw/cron/jobs.json` to produce a formatted report. Shows per-job breakdowns of run counts, success/failure, token usage, estimated cost, runtime, and delivery status.

Useful for:
- Morning briefings — "what happened overnight?"
- Cost auditing — "how much did cron jobs cost this week?"
- Health checks — "did anything fail?"
- Activity reviews — "what was the agent up to?"

## Script

`scripts/session-digest.cjs` — Zero external dependencies. Node.js 18+. Arm64-safe (ES5 CJS).

## Usage

```bash
# Today's activity
node scripts/session-digest.cjs

# Last 7 days
node scripts/session-digest.cjs --days 7

# JSON output for programmatic use
node scripts/session-digest.cjs --days 3 --json

# Suppress errors (cron job friendly)
node scripts/session-digest.cjs --quiet
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--days <n>` | `1` | Number of days to cover |
| `--json` | false | JSON output |
| `--quiet` | false | Suppress warnings to stderr |

## Output Format (text)

```
Session Digest — 2026-04-16 to 2026-04-18

41 runs across 10 jobs — All healthy
Tokens: 103,130 ($0.10)
Total runtime: 13m 38s

✅ Attio stage changes to #product
   Runs: 1 (1 ok, 0 err) — 35s total
   Tokens: 11,118 ($0.01)
   Schedule: 0 7 * * * @ Europe/Dublin
   Delivery: announce → channel:C0A8BNZQ1DK
   Latest: No deal stage changes in the last 24 hours.

⚠️ Daily Gmail digest to WhatsApp
   Runs: 7 (5 ok, 2 err) — 2m 10s total
   Tokens: 78,234 ($0.08)
   Schedule: 0 9 * * * @ Europe/Dublin
   Delivery: announce → whatsapp:+353868807853
   Latest: 3 unread emails: 1 HIGH, 2 MEDIUM

Issues:
  - Daily Gmail digest to WhatsApp: 2 error(s) out of 7 run(s)
```

## Output Format (JSON)

```json
{
  "period": { "start": "...", "end": "..." },
  "summary": {
    "total_runs": 41,
    "ok": 39,
    "errors": 2,
    "total_tokens": 103130,
    "estimated_cost_usd": 0.10,
    "total_duration_ms": 818000,
    "delivery_ok": 38,
    "delivery_failed": 1,
    "unique_jobs": 10
  },
  "jobs": {
    "Attio stage changes to #product": {
      "id": "...",
      "runs": 1,
      "ok": 1,
      "errors": 0,
      "tokens": 11118,
      "duration_ms": 35017,
      "schedule": "0 7 * * * @ Europe/Dublin",
      "delivery": "announce → channel:C0A8BNZQ1DK",
      "latest_summary": "No deal stage changes..."
    }
  }
}
```

## Cost Estimation

Token costs use a blended rate of ~$1.00/1M tokens. This is a rough approximation for budgeting purposes — actual costs depend on the model and pricing tier. The estimate is clearly labelled and should not be used for precise billing.

## Integration

### Morning Briefing Cron Job

Create a cron job that runs the digest every morning and delivers it to Slack or WhatsApp:

```json
{
  "name": "Morning session digest",
  "schedule": { "kind": "cron", "cron": "0 7 * * *", "timezone": "Europe/Dublin" },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Run the session-digest skill for yesterday (--days 1) and send a concise summary to the morning channel. Highlight any errors or delivery failures."
  }
}
```

### Heartbeat Integration

During a heartbeat, run the digest to check overnight activity:

```bash
node /path/to/session-digest.cjs --days 1 --json
```

If `summary.errors > 0`, investigate and potentially alert.

## Limitations

- Only covers cron job activity, not interactive sessions or heartbeats
- Cost estimation is approximate (blended rate, not per-model)
- One-shot jobs show UUID names unless given a descriptive name in jobs.json
- Run data is stored per-job in JSONL files; very old runs may have been pruned
