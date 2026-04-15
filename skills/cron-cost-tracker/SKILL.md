---
name: cron-cost-tracker
description: Track and report token usage and estimated costs across OpenClaw cron jobs. Aggregates per-job totals, averages, and flags high-cost or error-prone jobs. Use when asked about cron spending, token burn, most expensive jobs, cost optimization, or "how much are my cron jobs costing?"
---

# Cron Cost Tracker

Monitor token usage and estimated costs across all OpenClaw cron jobs.

## Quick Start

```bash
node scripts/cron-cost-tracker.mjs                  # 7-day summary, top 5 jobs
node scripts/cron-cost-tracker.mjs --days 30        # last 30 days
node scripts/cron-cost-tracker.mjs --top 10         # show top 10
node scripts/cron-cost-tracker.mjs --json           # raw JSON output
node scripts/cron-cost-tracker.mjs --per-run        # include per-run breakdown
node scripts/cron-cost-tracker.mjs --job <id>       # single job detail
```

## What It Does

1. Lists all active cron jobs via `openclaw cron list --json`
2. Fetches recent run history for each job via `openclaw cron runs`
3. Aggregates token usage (input + output) and estimates cost using built-in pricing
4. Sorts jobs by total cost and highlights expensive or error-prone ones

## Output Sections

- **Summary table**: job name, run count, total tokens, estimated cost, avg cost/run
- **Grand total**: aggregate across all jobs
- **⚠️ High-cost warnings**: jobs averaging >$0.10/run with ≥3 runs
- **❌ Error flags**: jobs with any failed runs
- **Per-run breakdown** (with `--per-run`): recent individual runs with timestamps

## Pricing

Built-in pricing table covers common models. Defaults to rough estimates for unknown models. Update the `PRICING` object in the script when model prices change — it's at the top of the file.

## Notes

- Jobs with zero token usage (e.g. `deleteAfterRun` one-shots, system events) show $0.00
- Cost is estimated from token counts, not from billing — actual costs may differ
- Runs are fetched with `--limit 100` per job; for jobs running more frequently, increase the limit in the script
- Read-only: never modifies cron jobs or run history
