---
name: smart-notifier
description: Reusable alert notification manager with throttling, cooldowns, deduplication, and stateful tracking. Use when a cron job or heartbeat needs to send alerts but avoid spam — rate-limit repeated notifications, suppress duplicates, track alert history, and manage cooldown periods. Ideal for solar export alerts, monitoring checks, email digests, or any "check condition → notify if changed" workflow.
skill-type: standard
category: agent-ops
tags: [notifications, throttling, dedup, cooldown, alerts, cron, monitoring]
suggested-connectors: []
suggested-job-type: cron
suggested-schedule-frequency: periodic
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: smart-notifier
    description: Evaluate whether to send an alert based on throttling, cooldown, and dedup rules
---

# Smart Notifier

Rate-limited, deduplicating alert manager for cron jobs and heartbeats.

## Problem This Solves

Without this, every cron job reinvents its own notification logic:
- "Don't alert if we just alerted about this"
- "Only alert every N minutes for the same condition"
- "Track what we've already told the human about"
- "Escalate if a condition persists too long"

This skill centralises all of that into one reusable script.

## Script

`scripts/smart-notifier.mjs` — Node.js, zero external dependencies. Uses shared-lib for arg parsing and output formatting.

## Usage

### Check if an alert should fire

```bash
node scripts/smart-notifier.mjs check \
  --key "solar-export" \
  --state-file /path/to/alerts.json \
  --cooldown 3600 \
  --dedup-window 86400 \
  --max-daily 5
```

Exits 0 (should notify) or 1 (suppress). Outputs JSON with the decision and reason.

### Record a sent alert

```bash
node scripts/smart-notifier.mjs record \
  --key "solar-export" \
  --state-file /path/to/alerts.json \
  --message "Exporting 3.2kW to grid" \
  --level info \
  --tags "solar,export,high-rate"
```

### Get alert history

```bash
node scripts/smart-notifier.mjs history \
  --key "solar-export" \
  --state-file /path/to/alerts.json \
  --limit 10

# All alerts summary
node scripts/smart-notifier.mjs history \
  --state-file /path/to/alerts.json \
  --summary
```

### Prune old records

```bash
node scripts/smart-notifier.mjs prune \
  --state-file /path/to/alerts.json \
  --max-age 604800
```

### Reset a specific alert key

```bash
node scripts/smart-notifier.mjs reset \
  --key "solar-export" \
  --state-file /path/to/alerts.json
```

## Commands

| Command | Description |
|---------|-------------|
| `check` | Evaluate whether to fire an alert (exit code 0 = yes, 1 = no) |
| `record` | Record that an alert was sent |
| `history` | View alert history for a key or summary of all keys |
| `prune` | Remove old alert records |
| `reset` | Clear history for a specific key |
| `status` | Show current state file stats |

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--key <name>` | — | Alert key/identifier (required for most commands) |
| `--state-file <path>` | `./alert-state.json` | Path to state file |
| `--cooldown <seconds>` | `3600` | Minimum seconds between alerts for same key |
| `--dedup-window <seconds>` | `86400` | Window to check for duplicate messages |
| `--max-daily <n>` | `10` | Max alerts per key per day |
| `--max-hourly <n>` | `3` | Max alerts per key per hour |
| `--message <text>` | — | Alert message (for `record`) |
| `--level <level>` | `info` | Alert level: `info`, `warn`, `error`, `critical` |
| `--tags <tags>` | — | Comma-separated tags |
| `--escalate-after <seconds>` | — | Auto-escalate level if condition persists (e.g. 7200 = 2h) |
| `--limit <n>` | `10` | Max history entries to show |
| `--summary` | `false` | Show summary instead of per-key history |
| `--json` | `false` | Output as JSON |
| `--force` | `false` | Bypass all checks and record (for testing) |
| `--dry-run` | `false` | Show what would happen without writing state |

## How It Works

### Check Decision Logic

```
1. Has the key been alerted recently?
   → Within cooldown? → SUPPRESS (reason: "cooldown")
   
2. Within dedup window, is the message identical?
   → Same message hash? → SUPPRESS (reason: "duplicate")
   
3. Daily limit exceeded?
   → Over max-daily? → SUPPRESS (reason: "daily limit")
   
4. Hourly limit exceeded?
   → Over max-hourly? → SUPPRESS (reason: "hourly limit")
   
5. Escalation check:
   → First alert was > escalate-after seconds ago?
   → And no escalation sent yet?
   → BUMP level to next tier (info→warn→error→critical)
   
6. All checks passed → ALLOW
```

### State File Schema

```json
{
  "version": 1,
  "alerts": {
    "solar-export": {
      "lastSent": 1775109638679,
      "lastMessage": "Exporting 3.2kW to grid",
      "lastLevel": "info",
      "lastEscalatedAt": null,
      "count": {
        "hourly": 1,
        "daily": 3,
        "total": 15
      },
      "history": [
        {
          "timestamp": 1775109638679,
          "message": "Exporting 3.2kW to grid",
          "level": "info",
          "tags": ["solar", "export"]
        }
      ]
    }
  }
}
```

## Integration Patterns

### In a cron job payload

```
1. Run: node /path/to/smart-notifier.mjs check --key "solar-export" --state-file /path/to/alerts.json --cooldown 1800
2. If exit code is 1, reply exactly NO_REPLY.
3. If exit code is 0, send your alert message.
4. Then run: node /path/to/smart-notifier.mjs record --key "solar-export" --state-file /path/to/alerts.json --message "your alert text" --level info
```

### With escalation

```
1. Run: node /path/to/smart-notifier.mjs check --key "server-down" --state-file /path/to/alerts.json --cooldown 600 --escalate-after 3600
2. The script will auto-escalate if this has been firing for >1 hour.
3. Check the output JSON for the effective level and include it in your message.
```

### Quiet hours awareness

Combine with heartbeat-checklist's quiet hours:
```bash
# Only allow critical alerts during quiet hours
node smart-notifier.mjs check --key "low-battery" --cooldown 3600 --level-filter "critical"
```

## Levels

| Level | Priority | Use case |
|-------|----------|----------|
| `info` | 0 | Routine updates, FYI |
| `warn` | 1 | Something needs attention soon |
| `error` | 2 | Something is broken |
| `critical` | 3 | Immediate action required |

Escalation chain: info → warn → error → critical

## Dependencies

- `shared-lib` — arg parsing (`args.mjs`) and output formatting (`fmt.mjs`)
- Node.js 18+ (no external packages)
