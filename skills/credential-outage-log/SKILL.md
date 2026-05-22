---
name: credential-outage-log
description: >
  Track credential outage start/end times, calculate total downtime, and generate
  human-readable outage reports. Records each outage event with timestamps, services
  affected, and resolution status. Complements credential-timeline (trend analysis)
  with structured outage bookkeeping. Use when asked "how long has X been broken?",
  "what's the outage history for Y?", or when generating credential reliability reports.
---

# Credential Outage Log

Structured bookkeeping for credential outages — when they started, when they ended, how long they lasted, and which services were affected.

## Why

Credential health checks tell you *right now* whether something is broken. But they don't answer "how long has Gmail been down?" or "how many times did Solis break this month?" This skill fills that gap with a simple persistent log that records each outage event, tracks resolution, and calculates downtime.

It complements:
- **credential-health** (point-in-time detection) — feeds outage events into this log
- **credential-timeline** (trend charts) — this provides the raw structured data
- **cron-failure-escalator** (escalation logic) — can query outage duration to decide escalation level
- **graceful-degradation** (alert decisions) — can check if an outage is already logged to avoid duplicate alerts

## Script

`scripts/outage-log.cjs` — Zero dependencies. Node.js 18+. Stores data in `trackhub/data/credential-outages.json`.

## Usage

```bash
# Record a credential failure (creates a new outage or updates existing)
node outage-log.cjs record gmail-file down --detail "Refresh token invalid"

# Record a recovery (resolves the active outage and calculates downtime)
node outage-log.cjs record gmail-file up

# Manually resolve an outage
node outage-log.cjs resolve gmail-file

# Show all currently active outages
node outage-log.cjs current

# Show outage history (optionally filtered by service)
node outage-log.cjs history
node outage-log.cjs history --service gmail-file

# Generate a summary report
node outage-log.cjs report

# Clean up old resolved outages (older than N days)
node outage-log.cjs clear-resolved --days 60
```

## Commands

| Command | Description |
|---------|-------------|
| `record <service> <up\|down>` | Record a check result; creates/resolves outages automatically |
| `resolve <service>` | Manually resolve an active outage |
| `current` | Show all currently active outages with duration |
| `history` | Show full outage history, sorted newest first |
| `report` | Summary: total outages, active count, per-service breakdown |
| `clear-resolved` | Remove resolved outage records older than N days |

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--detail <text>` | | | Add detail text when recording an outage |
| `--data-dir <dir>` | | `trackhub/data` | Directory for outage data file |
| `--out-file <path>` | | | Override outage data file path |
| `--days <N>` | | 30 | Days threshold for `clear-resolved` |
| `--service <name>` | | | Filter by service name (history/report) |
| `--json` | | false | Output as JSON |
| `--quiet` | `-q` | false | Suppress non-essential output |
| `--help` | `-h` | | Show help |

## Integration with Other Skills

### Paired with credential-health in cron/heartbeat

```bash
# In a cron preflight or heartbeat check:
RESULT=$(node credential-health.cjs --check gmail-file --fail-only --json)
if echo "$RESULT" | grep -q '"status": "fail"'; then
  node outage-log.cjs record gmail-file down --detail "$(echo "$RESULT" | jq -r '.results[0].detail')"
else
  node outage-log.cjs record gmail-file up
fi
```

### With graceful-degradation for deduplication

```bash
# Only alert if this is a new outage (not already logged)
ACTIVE=$(node outage-log.cjs current --json)
if echo "$ACTIVE" | jq -e '.activeOutages | map(select(.service=="gmail-file")) | length' | grep -q '0'; then
  # New outage — alert and log it
  node outage-log.cjs record gmail-file down --detail "Token expired"
  # ... send alert
fi
```

### With cron-failure-escalator

The escalator can query `current --json` to get outage duration and decide how aggressively to nudge.

## Output Format

### Current outages (plain text)
```
🔴 1 active outage(s):

  gmail-file
    Started: 2026-05-21T08:00:00.000Z
    Duration: 1d 4h
    Detail: Refresh token invalid or revoked
    Last checked: 2026-05-22T12:00:00.000Z
```

### Report (plain text)
```
📊 Credential Outage Report

  Total outages: 3
  Active: 1 | Resolved: 2
  Resolved downtime: 4h 32m
  Active downtime: 1d 4h

  Per-service breakdown:
    gmail-file: 2 outages (1 active, 1 resolved) — 1d 8h downtime
    solis-api: 1 outages (0 active, 1 resolved) — 4h 32m downtime
```

## Limitations

- Stores data locally in a JSON file — not suitable for multi-host setups without shared storage
- Thread-safe for single-process use only (no file locking)
- Does not perform health checks itself — pair with `credential-health` for detection
- `record down` on an already-active outage updates the last-checked timestamp but does not create duplicates
