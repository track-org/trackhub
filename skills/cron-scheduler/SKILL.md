---
name: cron-scheduler
description: >
  Analyze OpenClaw cron job schedules for timing conflicts, resource contention,
  and dependency ordering issues. Suggests optimal scheduling to spread load,
  stagger API-dependent jobs, and sequence dependent tasks correctly.
  Use when auditing cron timing, diagnosing rate-limit issues from concurrent jobs,
  planning new job schedules, or optimizing cron fleet performance.
skill-type: standard
category: agent-ops
tags: [cron, scheduling, optimization, conflicts, dependencies, timing, performance]
suggested-connectors: []
suggested-job-type: heartbeat
suggested-schedule-frequency: on-demand
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: cron-scheduler
    description: Analyze cron schedules for conflicts and suggest optimizations
---

# Cron Scheduler 🕐

Analyze OpenClaw cron job schedules for timing conflicts, resource contention, and dependency ordering issues.

## Why

You have N cron jobs all firing at various times. Some hit the same APIs, some depend on others, and occasionally multiple jobs overlap and cause rate limits or delivery bottlenecks. This skill spots those problems and suggests better timing.

This complements `cron-deps` (which maps *what* depends on *what*) by adding *when* — temporal analysis of the cron fleet.

## Script

`scripts/cron-scheduler.mjs` — Zero dependencies. Node.js 18+.

## Usage

```bash
# Full schedule analysis
node cron-scheduler.mjs

# Show only conflicts (jobs within N minutes of each other)
node cron-scheduler.mjs --conflict-window 5

# Analyze a specific time window (24h, 7d)
node cron-scheduler.mjs --window 24h

# Focus on jobs hitting specific resources
node cron-scheduler.mjs --resource slack
node cron-scheduler.mjs --resource attio

# Suggest optimal scheduling for all jobs
node cron-scheduler.mjs --suggest

# JSON output
node cron-scheduler.mjs --json

# Verbose mode (show reasoning for each suggestion)
node cron-scheduler.mjs --suggest --verbose
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--conflict-window` | `-w` | `10` | Minutes within which job overlaps are flagged |
| `--window` | | `24h` | Analysis window: `1h`, `6h`, `12h`, `24h`, `7d` |
| `--resource` | `-r` | *(all)* | Filter to jobs referencing a specific resource (channel, API, skill) |
| `--suggest` | | false | Generate scheduling optimization suggestions |
| `--verbose` | `-v` | false | Include reasoning for each suggestion |
| `--json` | | false | Structured JSON output |
| `--help` | | | Show usage |

## What It Analyzes

### 1. Overlap Detection
Finds jobs whose next scheduled runs fall within `--conflict-window` minutes of each other. Flags pairs that:
- Share the same delivery channel (Slack, WhatsApp)
- Hit the same external API (Attio, Gmail, Solis)
- Run in the same session target (both `main` or both `isolated`)

### 2. Resource Contention
Groups jobs by shared resources extracted from payload text:
- Credential references (env vars, token files)
- API endpoint patterns
- Skill script paths
- Delivery channels

Reports how many jobs depend on each resource and whether they cluster in time.

### 3. Dependency Ordering
Cross-references with `cron-deps` output (if available) to check:
- Whether dependent jobs are scheduled after their dependencies
- Whether job A's output feeds job B but B runs first
- Circular schedule dependencies

### 4. Stagger Suggestions
For conflicting jobs, suggests minimum stagger times based on:
- Historical run duration (`state.lastDurationMs`)
- API rate limit patterns
- Delivery channel capacity

## Output Format

```
📅 Cron Schedule Analysis — 24h window

## Overlapping Jobs (within 10 min)
⚠️  07:00  [gmail-digest, attio-stage-changes] → share: main session
⚠️  07:00  [solis-export-check, weather-daily] → share: slack delivery

## Resource Contention
🔑 Slack API: 4 jobs (07:00 cluster: 2, 09:00 cluster: 2)
🔑 Gmail: 2 jobs (both at 07:00)
🔑 Attio: 1 job (07:00)

## Suggested Optimizations
1. Stagger `solis-export-check` to 07:15 (avoids Slack delivery collision)
2. Move `gmail-digest` to 09:00 (spreads Gmail API load)
3. `attio-stage-changes` depends on `gmail-digest` — schedule gap OK (0 min overlap)
```

## Integration with Other Skills

- **cron-deps**: Use `--resource` output to identify shared dependencies
- **cron-health**: Cross-reference with recent error rates for conflicted jobs
- **cron-preflight**: Jobs flagged for staggering can have staggerMs applied
- **cron-cost-tracker**: Overlapping isolated sessions = concurrent token burn

## Examples

### Quick conflict check
```bash
node cron-scheduler.mjs --conflict-window 5
```

### Full optimization report
```bash
node cron-scheduler.mjs --suggest --verbose
```

### Audit Slack delivery load
```bash
node cron-scheduler.mjs --resource slack --suggest
```
