---
name: morning-briefing
description: "Aggregate system, credential, cron, and Slack status into one morning briefing. Combines multiple trackhub skills into a single report for heartbeat or cron delivery."
---

# morning-briefing

One-shot morning briefing that aggregates health and status from multiple trackhub skills into a single report. Designed for cron delivery or heartbeat use — gives Don a quick snapshot of what needs attention.

## Why

Checking system health, credentials, cron jobs, and Slack separately during a heartbeat wastes turns and tokens. This skill rolls all those checks into one script call, flags warnings, and produces a clean summary ready for WhatsApp/Slack delivery.

It calls:
- **system-health** — disk, memory, CPU temp, uptime
- **credential-health** — all configured credential checks
- **cron-dashboard** — cron fleet overview
- **slack-channel-reader** — recent messages in shared agent channel

## Script

`scripts/morning-briefing.cjs` — Zero dependencies. Node.js 18+.

## Usage

```bash
# Full human-readable briefing
node morning-briefing.cjs

# JSON output for programmatic use
node morning-briefing.cjs --json

# Brief mode: only show warnings
node morning-briefing.cjs --brief

# Quiet: exit code only (1 = warnings, 0 = clean)
node morning-briefing.cjs --quiet
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--json` | | false | JSON output |
| `--brief` | | false | Only show warnings/issues |
| `--quiet` | `-q` | false | Suppress stdout, exit code only |
| `--help` | `-h` | | Show help |

## Output

Human-readable example:

```
☀️ Morning Briefing
   Thursday 15 May

🖥️  System
   Uptime: 8d 8h 50m
   Memory: 35.6% used
   Disk: 8% used
   CPU temp: 49.4°C

🔑 Credentials
   OK: 1 | Failed: 1
   ⚠️  gmail-file: Refresh token invalid or revoked

⏰ Cron Jobs
   Total: 12 | Failed: 0 | Disabled: 1

💬 Slack (shared channel)
   Recent messages (12h): 0

⚠️  Warnings
   • Credential gmail-file: Refresh token invalid or revoked
```

JSON output includes full structured data from each source under `sections`, plus a flat `warnings` array for quick checks.

## Integration

- Use in a cron job with `--json` and parse warnings for WhatsApp delivery
- Use in heartbeat with `--quiet` and check exit code before deciding to alert
- Pairs with **quick-reports** for formatting the briefing for different platforms

## Limitations

- Depends on sibling skills being present in the same trackhub catalogue
- Slack reading requires `SLACK_BOT_TOKEN` (from env or openclaw config)
- Runs each check sequentially — total latency is the sum of all checks (~5-10s typical)
- Exit code 1 means warnings detected, 0 means clean, 2 means script error
