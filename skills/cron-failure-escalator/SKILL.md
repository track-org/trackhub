---
name: cron-failure-escalator
description: >
  Track how long cron jobs or credentials have been failing and escalate alert frequency
  over time. New failures alert daily; week-old failures nudge every few days; month-old
  failures weekly. Prevents long-running outages from fading into silence without spamming.
  Use when you want to surface stale failures that have been ignored, or when deciding
  whether to remind someone about a broken credential or cron job.
---

# Cron Failure Escalator 🔔

Long-running failures fade into background noise. This skill detects how long cron jobs or credentials have been failing and applies **escalating nudge intervals** so new failures get immediate attention while chronic issues get periodic reminders without spam.

## Why

When a credential breaks, you get an alert. But if nobody fixes it for 9 days, the alert just keeps repeating every day — or worse, gets silently ignored. This skill:

- **Tracks failure age** from first detection
- **Applies escalation tiers** — daily → every 2 days → every 5 days → every 14 days
- **Auto-resolves** when the failure disappears
- **Marks when nudged** so you don't double-alert

Pairs naturally with `credential-health` (detection) and `cron-dead-letter` (stuck loops).

## Script

`scripts/escalator.cjs` — Zero dependencies. Node.js 18+. Reads from `credential-health` and `cron-dead-letter` automatically.

## Escalation Tiers

| Age          | Interval   | Label        |
|--------------|------------|--------------|
| 0–3 days     | Every 1 day | 🟡 new      |
| 3–7 days     | Every 2 days | 🟠 aging    |
| 7–30 days    | Every 5 days | 🔴 persistent |
| 30+ days     | Every 14 days | 💀 chronic  |

## Usage

```bash
# Show failures needing a nudge right now
node escalator.cjs

# Show all tracked failures (including those not due yet)
node escalator.cjs --all

# Check mode: exit 0 if nudges due, exit 3 if not (useful in scripts)
node escalator.cjs --check

# Filter to a specific failure
node escalator.cjs --name "credential:gmail-file"

# Reset a failure (mark as resolved)
node escalator.cjs --reset "credential:gmail-file"

# JSON output
node escalator.cjs --json

# Dump raw state
node escalator.cjs --state

# Quiet mode: only output if nudges are due
node escalator.cjs --quiet
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--all` | | false | Show all tracked failures, not just due nudges |
| `--check` | | false | Exit 0 if any nudge due, exit 3 if none |
| `--name` | `-n` | *(all)* | Filter to a specific failure name |
| `--reset` | | *(none)* | Remove a failure from tracking (resolved) |
| `--state` | | false | Dump raw state JSON |
| `--json` | | false | JSON output |
| `--quiet` | `-q` | false | Only output if nudges are due |
| `--help` | `-h` | | Show help |

## How It Works

1. Runs `credential-health` and `cron-dead-letter` to detect current failures
2. Compares against persistent state (`memory/escalator-state.json`)
3. New failures get `firstSeen = now`, existing ones keep their original timestamp
4. Failures that disappeared are auto-removed from state
5. Applies tier logic to determine if a nudge is due
6. When outputting due nudges, marks `lastNudge = now` to track cooldown

## State File

`memory/escalator-state.json` — tracks each failure's first-seen time, last nudge time, type, and detail.

## Integration

- **credential-health** — provides current credential failure data
- **cron-dead-letter** — provides stuck cron job data
- **graceful-degradation** — use before sending alerts to check cooldowns
- **morning-briefing** — include escalation status in daily summaries

## Example Output

```
📋 Failures needing a nudge (1/2)

🔔 credential:gmail-file  [aging]  9.2 days  NUDGE NOW
   Refresh token invalid or revoked: Bad Request
   last nudged: 2026-05-19T01:30:00.000Z
```

## Limitations

- Only detects failures from `credential-health` and `cron-dead-letter` scripts
- State is local — no multi-host sync
- Auto-resolves failures on next detection (if the check passes, the entry is removed)
