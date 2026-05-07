---
name: session-profiler
description: >
  Analyze cron run and session performance — response latency, token efficiency,
  cost profiling, model comparison, and session health scoring. Use when asked about
  how fast cron jobs are, which model is cheapest per task, token burn rates,
  performance trends over time, or "what's my session/cron performance like?"
tags: [cron, performance, cost, monitoring, profiling]
---

# Session Profiler 📊

Analyze cron run and session performance metrics. Extracts latency, token efficiency,
cost profiles, and trends from OpenClaw cron run history.

## Why

Knowing *that* a cron job ran is one thing. Knowing *how well* it ran — response time,
token efficiency, cost per run, whether performance is degrading — is the difference
between "it works" and "it's healthy."

This skill pairs with:
- **cron-health** — is the job running at all?
- **cron-cost-tracker** — aggregate cost across jobs
- **cron-trend-analyzer** — long-term reliability trends
- **session-profiler** answers the "how fast / how expensive per run" question

## Scripts

### `scripts/session-profiler.cjs`

Zero dependencies. Node.js 18+ (ES5 CJS for arm64 safety).

Parses `openclaw cron runs` JSON output to compute performance metrics.

## Usage

```bash
# Profile all recent cron runs (last 50)
openclaw cron list --json | node session-profiler.cjs

# Profile a specific cron job
openclaw cron runs --id <job-id> --json | node session-profiler.cjs

# Human-readable report
openclaw cron runs --id <job-id> --json | node session-profiler.cjs --report

# JSON output for programmatic use
openclaw cron runs --id <job-id> --json | node session-profiler.cjs --json

# Compare models
openclaw cron runs --id <job-id> --json | node session-profiler.cjs --by-model

# Only failed/error runs
openclaw cron runs --id <job-id> --json | node session-profiler.cjs --failures-only

# Time-bounded analysis
openclaw cron runs --id <job-id> --json | node session-profiler.cjs --since "7d"

# Summary only (one line per job or aggregate)
openclaw cron runs --id <job-id> --json | node session-profiler.cjs --summary
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--report` | `-r` | false | Full human-readable report with sections |
| `--json` | `-j` | false | Output all metrics as JSON |
| `--by-model` | | false | Group metrics by model for comparison |
| `--failures-only` | | false | Only analyze failed/error runs |
| `--since` | `-s` | `all` | Time filter: `"1d"`, `"7d"`, `"30d"`, or ISO date |
| `--summary` | | false | One-line summary per job |
| `--top` | `-n` | 10 | Number of top items to show in rankings |
| `--help` | `-h` | | Show usage |

## Metrics Computed

### Per-Run
- **Duration** — wall-clock time (from `durationMs`)
- **Tokens** — input, output, total
- **Token rate** — tokens/second (throughput indicator)
- **Cost estimate** — based on provider/model pricing tables
- **Status** — ok, error, delivery status

### Aggregates
- **Mean / median / p95 duration** — latency profile
- **Mean / median tokens per run** — efficiency baseline
- **Total cost** — estimated spend
- **Success rate** — % of runs with status `ok`
- **Delivery rate** — % of delivered runs
- **Token efficiency** — output/input ratio (compression)

### Trends
- **Duration drift** — is the job getting slower over time?
- **Token creep** — is token usage growing run-over-run?
- **Cost trajectory** — projected monthly cost based on recent trend

## Cost Estimation

Built-in pricing table (approximate, update as needed):

| Provider/Model | Input (per 1M) | Output (per 1M) |
|---------------|----------------|-----------------|
| zai/glm-5-turbo | $0.50 | $1.50 |
| zai/glm-5 | $2.00 | $8.00 |
| openai/gpt-4o | $2.50 | $10.00 |
| openai/gpt-4o-mini | $0.15 | $0.60 |
| anthropic/claude-sonnet | $3.00 | $15.00 |

Custom pricing can be set via `--cost-input` and `--cost-output` flags (per 1M tokens, in USD).

## Report Sections (with `--report`)

```
━━━ Session Performance Report ━━━

📋 Overview
   Total runs analyzed: 45
   Date range: 2026-04-03 → 2026-05-07
   Models used: glm-5-turbo (45)
   Success rate: 95.6%

⏱️ Latency
   Mean: 12.4s | Median: 11.8s | P95: 18.2s
   Fastest: 6.2s | Slowest: 22.1s
   Trend: ↗ slightly increasing (+0.3s/run over 30 days)

🪙 Token Efficiency
   Mean input: 7,612 | Mean output: 342
   Output/Input ratio: 4.5% (concise outputs ✅)
   Total tokens: 357,735

💰 Cost Estimate
   Per run: $0.004 | Daily avg: $0.03
   Monthly projection: $0.89
   Total (period): $0.21

📊 Top 5 Slowest Runs
   1. 2026-05-05 07:00 — 22.1s (3,842 tokens)
   2. 2026-04-28 07:00 — 19.8s (4,211 tokens)
   ...

⚠️ Anomalies
   - 2 runs exceeded P95 duration (possible issues)
   - 1 run had 2x normal token usage on 2026-04-30
```

## Integration with Heartbeat

Use during heartbeats to check if any cron jobs are degrading:

```bash
# Quick health check — any jobs getting slower?
openclaw cron list --json | node session-profiler.cjs --summary | grep "↗"
```

## Integration with Cron

Can be used as a cron job itself for weekly performance reports:

```json
{
  "name": "Weekly performance digest",
  "schedule": { "kind": "cron", "expression": "0 9 * * 1" },
  "payload": {
    "kind": "agentTurn",
    "message": "Run session-profiler with --report across all cron jobs for the last 7 days. Summarise any jobs that are degrading or unusually expensive."
  }
}
```

## Limitations

- Cost estimates are approximate — actual billing depends on provider pricing tiers
- Duration includes network + gateway overhead, not just LLM inference
- No access to per-token timing (first token latency) — only total duration
- Relies on `openclaw cron runs` output format; may need updates if CLI changes
- Pricing table is hardcoded — update `PRICING` in the script as models/prices change
