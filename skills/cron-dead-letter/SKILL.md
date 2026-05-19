---
name: cron-dead-letter
description: >
  Detect cron jobs stuck in repeated failure loops. Identifies jobs producing
  the same error or outcome across consecutive runs, groups them by error pattern,
  and reports which jobs need human intervention versus transient failures.
  Complements cron-health (point-in-time status) and cron-trend-analyzer (broad
  trends) with targeted stuck-failure detection.
skill-type: standard
category: agent-ops
tags: [cron, monitoring, failures, dead-letter, stuck, loops, detection]
suggested-connectors: []
suggested-job-type: cron
suggested-schedule-frequency: on-demand
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: dead-letter.cjs
    description: Scan cron runs for jobs stuck in repeated same-outcome loops
---

# cron-dead-letter 📭

Detect cron jobs that are stuck in repeated failure or same-outcome loops. Instead of just knowing "a job failed," you get "this job has been failing the exact same way for 7 consecutive runs and needs human intervention."

## Why

`cron-health` gives you a point-in-time status. `cron-trend-analyzer` gives you broad trends. But neither specifically answers: **"Which jobs are stuck repeating the same failure and need someone to fix something?"**

This is the "dead letter queue" for your cron fleet — it catches jobs that are burning tokens on doomed runs because a credential expired, a service went down, or some other persistent issue is blocking progress.

Real-world example: a daily Gmail digest that's been hitting a broken OAuth token every morning for a week. Status shows "ok" (the pre-flight correctly bails), but it's been doing nothing useful for 7 consecutive runs.

## Script

`scripts/dead-letter.cjs` — Zero external dependencies. Node.js 18+.

## Usage

```bash
# Check all jobs — flag anything with 3+ consecutive same-result runs
node dead-letter.cjs

# Higher threshold — only flag 5+ streaks
node dead-letter.cjs --min-streak 5

# Filter by job name (substring match)
node dead-letter.cjs --name "gmail"

# Longer window
node dead-letter.cjs --days 14

# Only show stuck failures (not benign loops like NO_REPLY or weather reports)
node dead-letter.cjs --fail-only

# Include snooze suggestions
node dead-letter.cjs --suggest-snooze

# JSON for programmatic use
node dead-letter.cjs --json

# Quiet mode — only warnings
node dead-letter.cjs --quiet
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--min-streak <n>` | 3 | Minimum consecutive same-result runs to flag |
| `--name <pattern>` | *(all)* | Filter by job name (substring match) |
| `--days <n>` | 7 | Look back this many days |
| `--runs <n>` | 15 | Max runs to fetch per job |
| `--json` | false | Raw JSON output |
| `--fail-only` | false | Only show stuck-failure jobs |
| `--quiet` | false | Only show warnings |
| `--suggest-snooze` | false | Include snooze command suggestions |
| `--help` | | Show help |

## Output Example

```
📭 Dead Letter Report — 3 stuck job(s) found

🔴 Daily Gmail digest to...
   Pattern: STUCK FAILURE — 7 consecutive same-result runs (7 total in window)
   Fingerprint: preflight-check:gmail-file
   Since: 2026-05-12 08:00 → 2026-05-18 08:00
   Avg duration: 16.4s

🟡 Solar export WhatsApp...
   Pattern: STUCK LOOP — 15 consecutive same-result runs (15 total in window)
   Fingerprint: Check for live solar export and only message Don on WhatsApp when appropriate.|Workflow:
   Since: 2026-05-18 13:30 → 2026-05-18 20:30
   Avg duration: 21.2s

Checked 5 jobs | Min streak: 3 | Window: 7d
```

- 🔴 = STUCK FAILURE (credential fail, error pattern)
- 🟡 = STUCK LOOP (benign repetition — same instructions, possibly working fine)

## How It Works

1. Fetches all cron jobs via `openclaw cron list`
2. For each job, fetches recent runs via `openclaw cron runs`
3. Extracts a "fingerprint" from each run's summary — detecting credential failures, error patterns, NO_REPLY, or generic content
4. Groups consecutive runs with similar fingerprints into "streaks"
5. Flags the most recent streak if it meets the `--min-streak` threshold
6. Classifies as failure (🔴) or loop (🟡) based on the fingerprint type

### Fingerprint Types

| Fingerprint | Meaning | Type |
|-------------|---------|------|
| `preflight-fail:<service>:<detail>` | Credential pre-flight detected a failure | 🔴 Failure |
| `preflight-check:<check>` | Pre-flight payload repeating (credential likely broken) | 🔴 Failure |
| `credential-fail:<snippet>` | Generic credential failure | 🔴 Failure |
| `error:<snippet>` | Run output contains error keywords | 🔴 Failure |
| `NO_REPLY` | Job is consistently returning nothing | 🟡 Loop |
| *(content hash)* | Job instructions are identical across runs | 🟡 Loop |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No dead letters (or only informational) |
| 1 | Dead letters with failure patterns detected |
| 2 | Error running the check |

## Integration with Other Skills

```
cron-dead-letter (detect stuck jobs)
  → cron-snooze (temporarily pause the stuck job)
  → credential-remediation (get fix steps for credential failures)
  → credential-impact (full impact report for the broken credential)
```

### In Morning Briefing

```bash
# Add to morning-briefing or heartbeat checklist
node dead-letter.cjs --min-streak 3 --fail-only --quiet
```

### After Fixing a Credential

```bash
# Verify the dead letter cleared
node dead-letter.cjs --name "gmail" --json
```

## Complements

- **cron-health** — point-in-time status of all jobs
- **cron-trend-analyzer** — reliability, cost, and performance trends over time
- **cron-dead-letter** — specifically finds jobs stuck in failure loops
- **cron-snooze** — pause the stuck job while you fix the underlying issue

## Limitations

- Fingerprint matching is heuristic-based, not semantic — very different error messages from the same root cause may not be grouped together
- Only examines run summaries (not full transcripts) for efficiency
- Requires the `openclaw` CLI to be available and the gateway running
- Thread replies in Slack delivery are not expanded
