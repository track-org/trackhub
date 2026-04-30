---
name: cron-trend-analyzer
description: Analyze cron job run history for trends — reliability degradation, token cost creep, duration drift, delivery failures, and consecutive failure patterns. Flags degrading jobs before they become full breakages. Use when reviewing cron fleet health over time, spotting jobs that are getting worse, auditing cost trends, or getting a trend-aware overview of scheduled task reliability.
scripts:
  - scripts/cron-trend-analyzer.mjs
tags: [cron, monitoring, trends, health, cost]
---

# Cron Trend Analyzer

Analyze cron job run history across time windows to detect trends before they become breakages. Goes beyond point-in-time health checks by comparing first-half vs second-half performance within a configurable window.

## Why

Existing tools tell you if a job is healthy *right now*. This tells you if a job is *getting worse* — catching slow degradation that a single-run inspection would miss.

## Script

`scripts/cron-trend-analyzer.mjs` — Zero dependencies. Node.js 18+.

## Requirements

- OpenClaw CLI (`openclaw cron list`, `openclaw cron runs`)
- Shell access (runs `openclaw` commands)

## Usage

```bash
# Analyze all jobs, last 7 days
node cron-trend-analyzer.mjs

# Single job
node cron-trend-analyzer.mjs --job-id <uuid>

# Fuzzy name match
node cron-trend-analyzer.mjs --name "gmail"

# Custom window
node cron-trend-analyzer.mjs --days 14

# Only degrading/problem jobs
node cron-trend-analyzer.mjs --degrading-only

# Only jobs with failures
node cron-trend-analyzer.mjs --fail-only

# Quiet: warnings only
node cron-trend-analyzer.mjs --quiet

# JSON output
node cron-trend-analyzer.mjs --json
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--job-id <id>` | all | Analyze a specific cron job |
| `--name <pattern>` | all | Fuzzy match job name (substring) |
| `--days <n>` | 7 | Analysis window in days |
| `--min-runs <n>` | 3 | Minimum runs to include a job |
| `--degrading-only` | false | Only show jobs with degrading trends |
| `--fail-only` | false | Only include jobs with failures |
| `--json` | false | Raw JSON output |
| `--quiet` | false | Only show warnings/degradations |

## What It Detects

### Reliability Decline
Compares success rate in the first half vs second half of the window. Flags if reliability drops below 90% with a downward trend.

### Frequent Recent Failures
Counts failures in the last 5 runs. Flags if ≥2 recent runs failed.

### Token Cost Creep
Compares average tokens per run between halves. Flags if usage increased by >30%.

### Duration Drift
Compares average duration between halves. Flags if runtime increased by >50%.

### Delivery Failures
Counts runs where delivery failed (message didn't reach its destination).

### Consecutive Failures
Counts consecutive failures at the tail of the run history. Flags if ≥2 in a row.

## Trend Comparison Method

Jobs with ≥4 runs in the window are split into first half and second half. Metrics (reliability, tokens, duration) are compared across halves to detect directional trends. This avoids noise from single bad runs and focuses on sustained degradation.

## Output Format

```
📊 Cron Trend Analysis — last 7 days
═══════════════════════════════════════════════════

Jobs analyzed: 5 | Total runs: 84 | Failures: 3 | Degrading: 1

🟢 Gmail daily digest
   Schedule: 0 9 * * *
   Runs: 7 | ✅ 6 | ❌ 1 | Reliability: 85.7%
   Duration: 8.2s median (-5%)
   Tokens: 3.2k/run median | Total: 22.4k (+12%)
   📉 Reliability trend: 100% → 71.4%
   ⚠️ Reliability dropped from 100% → 71.4%

🔴 Attio stage changes
   Schedule: 0 7 * * *
   Runs: 7 | ✅ 3 | ❌ 4 | Reliability: 42.9%
   ...
```

Icons: 🟢 healthy | 🟡 has issues | 🔴 degrading

## Integration with Cron Health

Use alongside `cron-health` (point-in-time) and `cron-run-inspector` (single-run deep dive):
- **cron-health**: "Is it broken right now?"
- **cron-run-inspector**: "What happened in this specific run?"
- **cron-trend-analyzer**: "Is it getting worse over time?"

## Use Cases

- **Proactive monitoring**: Spot jobs degrading before they fully break
- **Cost audits**: Find jobs whose token usage is creeping up
- **Reliability reviews**: Get a trend-aware overview of the entire cron fleet
- **Post-incident analysis**: Understand if an issue was a one-off or part of a pattern
- **Quiet-hours reporting**: `--degrading-only --quiet` for heartbeat-friendly output
