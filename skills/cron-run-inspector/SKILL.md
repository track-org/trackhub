---
name: cron-run-inspector
description: Deep-dive inspection of a single OpenClaw cron run — metadata, token usage, tool call timeline, errors, and transcript analysis. Use when debugging a specific cron run, investigating why a job behaved unexpectedly, reviewing what tools an agent used during a run, or getting a structured debugging report for a failed run.
---

# Cron Run Inspector

Inspect a single cron run in detail — metadata, token usage, tool call timeline, errors, and transcript analysis.

## Why

`cron-health` and `cron-dashboard` give you the 10,000-foot view. `cron-first-aid` diagnoses patterns across jobs. But sometimes you need to **zoom into one specific run** and see exactly what the agent did: which tools it called, what errors it hit, how long each step took, and what it concluded.

This skill fills that gap — a focused debugging tool for individual cron runs.

## Script

`scripts/cron-run-inspector.mjs` — Zero dependencies. Node.js 18+.

## Usage

```bash
# Inspect the latest run of a cron job
node cron-run-inspector.mjs --job-id <job-uuid>

# Inspect a specific run (0 = latest, 1 = previous, etc.)
node cron-run-inspector.mjs --job-id <job-uuid> --run-index 1

# Inspect by session key directly
node cron-run-inspector.mjs --session-key "agent:main:cron:<job-id>:run:<session-id>"

# Metadata only (skip transcript fetch — faster)
node cron-run-inspector.mjs --job-id <job-uuid> --no-transcript

# Raw JSON output
node cron-run-inspector.mjs --job-id <job-uuid> --raw

# Only show tool calls from transcript
node cron-run-inspector.mjs --job-id <job-uuid> --tool-calls-only

# Only show errors
node cron-run-inspector.mjs --job-id <job-uuid> --errors-only
```

## How It Works

1. **Fetches run metadata** from `openclaw cron runs --id <job>` — status, duration, tokens, delivery, model, session key
2. **Pulls the session transcript** using the run's `sessionKey` — the full agent conversation during that run
3. **Analyzes the transcript** — counts turns, extracts tool calls with args, identifies errors, tracks timing
4. **Formats a structured report** — human-readable with sections for metadata, usage, tool timeline, and errors

## Report Sections

| Section | Content |
|---------|---------|
| **Run Metadata** | Job ID, run time, duration, status, delivery, model, session ID |
| **Token Usage** | Input/output/total tokens + estimated cost |
| **Agent Summary** | The agent's own summary of what it did |
| **Transcript Analysis** | Turn count, tool call count, errors, thinking usage |
| **Tool Call Timeline** | Chronological list of every tool call with args |
| **Errors / Failures** | Any tool results that returned errors |
| **Next Scheduled Run** | When the job runs next |

## Cost Estimation

Built-in rough per-million-token pricing (USD) for common models:
- glm-5-turbo: $0.30/MTok
- gpt-4o: $2.50/MTok
- claude-3.5-sonnet: $3.00/MTok
- Others: $1.00/MTok (fallback)

These are approximate — use `cron-cost-tracker` for accurate aggregation.

## Flags

| Flag | Description |
|------|-------------|
| `--job-id <id>` | Cron job UUID (fetches latest run) |
| `--run-index <n>` | Which run to inspect (0 = latest) |
| `--session-key <key>` | Direct session key (skip metadata lookup) |
| `--session-id <uuid>` | Session UUID (requires --job-id) |
| `--raw` / `--json` | Raw JSON output |
| `--no-transcript` | Metadata only, skip transcript |
| `--tool-calls-only` | Only show tool calls |
| `--errors-only` | Only show errors |

## Use Cases

- **Debugging a failed run**: See exactly which tool call errored and what the error was
- **Reviewing agent behaviour**: Did the agent call the right tools? Did it loop?
- **Token audit**: How much did a specific run cost? Was it efficient?
- **Delivery issues**: Confirm whether a run succeeded but delivery failed
- **Regression checking**: Compare today's run with yesterday's using `--run-index`

## Complementary Skills

- **cron-health**: Overview of all jobs — use this first to spot problems
- **cron-first-aid**: Diagnose common failure patterns
- **cron-cost-tracker**: Aggregate cost analysis across all jobs
- **cron-dashboard**: Quick health dashboard with dependency detection
- **cron-preflight**: Prevent credential-related failures before they happen

## Limitations

- Requires `openclaw` CLI to be available on PATH
- Session transcript availability depends on OpenClaw session retention
- Cost estimates are approximate — real costs vary by provider and plan
- `openclaw session history` may not be available in all OpenClaw versions
