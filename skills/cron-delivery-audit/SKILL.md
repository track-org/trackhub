---
name: cron-delivery-audit
description: Audit cron job delivery reliability — detect runs that succeed but never reach their target. Catches "silent failures" where a job thinks it worked but the message was never delivered. Use when investigating why a cron job's output didn't appear in Slack/Discord/WhatsApp, checking delivery health across the fleet, or finding jobs that need delivery config fixes.
skill-type: standard
category: agent-ops
tags: [cron, monitoring, delivery, debugging, silent-failure, proactive]
suggested-connectors: []
suggested-job-type: heartbeat
available-scripts:
  - name: cron-delivery-audit
    description: Audit all cron jobs for delivery failures and silent drops
---

# Cron Delivery Audit 📬

Focused audit of cron job *delivery* reliability — the gap between "job ran successfully" and "output actually reached its target".

## Why

Cron jobs can report `status: ok` but fail to deliver their output to Slack, Discord, WhatsApp, or other channels. This creates **silent failures**: the job thinks it worked, but nobody sees the result. The cron-trend-analyzer skill catches this over time, but delivery-audit gives you an instant snapshot of which jobs have delivery problems right now.

Common causes:
- Slack/Discord bot token expired or bot removed from channel
- WhatsApp session disconnected
- Delivery mode set to `none` but payload generates output meant for a channel
- Channel ID typo or deleted channel
- Rate limiting from the target platform

## How to Run

```bash
node scripts/cron-delivery-audit.mjs              # Full delivery audit
node scripts/cron-delivery-audit.mjs --fail-only   # Only jobs with delivery issues
node scripts/cron-delivery-audit.mjs --json        # Machine-readable JSON
node scripts/cron-delivery-audit.mjs --quiet       # Exit code only (0=clean, 1=issues)
node scripts/cron-delivery-audit.mjs --days 7      # Look back 7 days instead of 3
node scripts/cron-delivery-audit.mjs --name "Gmail" # Fuzzy-match a specific job
```

## Options

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--days` | `-d` | `3` | How many days of run history to analyze |
| `--runs` | `-n` | `20` | Max recent runs to inspect per job |
| `--json` | | false | Output raw JSON |
| `--fail-only` | | false | Only show jobs with delivery issues |
| `--quiet` | | false | No output, exit code only |
| `--name` | | *(all)* | Fuzzy-match job name (partial match) |
| `--include-disabled` | | false | Include disabled jobs |

## Output Columns

| Column | Meaning |
|--------|---------|
| **Job** | Cron job name |
| **Runs** | Total runs inspected |
| **Delivered** | Runs with `deliveryStatus: "delivered"` |
| **Failed** | Runs with `deliveryStatus: "failed"` |
| **Not Req** | Runs with `deliveryStatus: "not-requested"` (no delivery configured) |
| **Silent** | Runs where status=ok but delivery=failed (the dangerous ones) |
| **Rate** | Delivery success rate (delivered / runs that requested delivery) |

## Exit Codes

- `0` — All deliveries healthy (or no issues found)
- `1` — One or more delivery issues detected

## Integration Tips

**Heartbeat:** Use `--fail-only --quiet` in heartbeat checks to get a boolean on delivery health without noise.

**After config changes:** Run a full audit after changing Slack tokens, channel IDs, or delivery modes to verify nothing broke silently.

**Pairing with other skills:**
- `cron-delivery-audit` → finds *which* jobs have delivery problems
- `cron-run-inspector` → deep-dives into a specific failed delivery run
- `cron-trend-analyzer` → tracks whether delivery is getting worse over time
- `cron-first-aid` → suggests fixes for common delivery issues

## Limitations

- Only inspects runs stored in the local cron history
- Cannot distinguish *why* delivery failed (token vs channel vs rate limit) — use `cron-run-inspector` for that
- Jobs with `delivery.mode: "none"` will show as "not-requested" which is expected, not a problem
