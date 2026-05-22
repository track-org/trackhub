---
name: cron-credential-shield
description: >
  Detect cron jobs that depend on broken credentials and temporarily snooze them with
  a clear reason, then auto-resume when credentials recover. Pairs with credential-health
  (detection), cron-snooze (snooze action), and cron-failure-escalator (escalation).
skill-type: standard
category: agent-ops
tags: [cron, credentials, automation, remediation, shield, auto-snooze]
suggested-connectors: []
suggested-job-type: cron
suggested-schedule-frequency: on-demand
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: shield
    description: Scan credentials, find affected cron jobs, snooze or unsnooze them
---

# cron-credential-shield 🛡️

When a credential breaks, automatically snooze the cron jobs that depend on it — and unsnooze them when the credential recovers. No manual intervention needed.

## Why

A broken credential doesn't just fail one cron job — it can silently break several. Without a shield, jobs keep failing on every run, wasting tokens and generating noise. With this skill, the moment a credential fails, all dependent jobs are snoozed with a clear reason. When the credential comes back, they auto-resume.

This is the automation glue between:
- **credential-health** — detects what's broken
- **cron-snooze** — pauses the affected jobs
- **cron-failure-escalator** — escalates if it stays broken

## Script

`scripts/shield.cjs` — Zero dependencies. Node.js 18+.

## Requirements

- `openclaw` CLI on PATH
- `credential-health` skill installed (for `--check` mode)
- `cron-snooze` skill installed (for snooze/unsnooze operations)
- Node.js 18+

## Usage

### Shield mode: check credentials and snooze affected jobs

```bash
# Check all credentials and snooze jobs for any failures
node shield.cjs --shield --for 6h

# Dry run: show what would be snoozed without doing it
node shield.cjs --shield --for 6h --dry-run

# Check specific credential only
node shield.cjs --shield --credential gmail-file --for 12h
```

### Recover mode: check if credentials recovered and unsnooze jobs

```bash
# Check all broken credentials and unsnooze recovered ones
node shield.cjs --recover

# Dry run: show what would be unsnoozed
node shield.cjs --recover --dry-run
```

### Status: show current shield state

```bash
# Show which jobs are shielded (snoozed by this skill)
node shield.cjs --status

# JSON output
node shield.cjs --status --json
```

### Full cycle: check + shield + recover

```bash
# Recommended for periodic cron runs
node shield.cjs --cycle --for 6h
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--shield` | | | Check credentials and snooze affected jobs |
| `--recover` | | | Check if broken credentials recovered and unsnooze |
| `--cycle` | | | Run shield + recover in one pass |
| `--status` | | | Show current shield state |
| `--credential <name>` | `-c` | *(all)* | Only check a specific credential |
| `--for <duration>` | | `6h` | Snooze duration (e.g. `30m`, `2h`, `6h`, `1d`) |
| `--reason <text>` | | *(auto)* | Override reason for snooze |
| `--dry-run` | | false | Show what would happen without executing |
| `--json` | | false | JSON output |
| `--quiet` | `-q` | false | Minimal output |
| `--help` | `-h` | | Show usage |

## Credential → Job Mapping

The skill maps credentials to cron jobs using a config file at `~/.openclaw/cron/shield-map.json`:

```json
{
  "maps": {
    "gmail-file": {
      "jobs": ["gmail digest", "email summary"],
      "reason": "Gmail OAuth token invalid or revoked"
    },
    "slack-bot": {
      "jobs": ["slack digest", "channel monitor"],
      "reason": "Slack bot token invalid"
    },
    "attio-api": {
      "jobs": ["attio pipeline", "crm snapshot"],
      "reason": "Attio API key invalid"
    }
  }
}
```

If no map file exists, the script will auto-discover jobs by scanning cron payloads for credential-related keywords (e.g., "gmail", "slack", "attio").

## Shield State

Tracked at `~/.openclaw/cron/shield-state.json`:

```json
{
  "shielded": {
    "gmail-file": {
      "snoozedAt": "2026-05-21T08:00:00Z",
      "credentialStatus": "fail",
      "detail": "Refresh token invalid or revoked: Bad Request",
      "snoozedJobs": ["87218ac1", "a3f0c219"],
      "snoozeDuration": "6h",
      "reason": "Gmail OAuth token invalid or revoked"
    }
  }
}
```

## Typical Cron Setup

### 1. Shield cron (runs every 6 hours)

```bash
node shield.cjs --cycle --for 6h --quiet
```

This checks credentials, snoozes newly broken ones, and unsnoozes recovered ones.

### 2. Or: wire into existing credential watchdog

The agent can run `--shield` as part of a credential-health cron or heartbeat response.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (nothing to do, or all actions completed) |
| 1 | Error (script failure) |
| 2 | Validation error (bad arguments) |
| 10 | Credentials failing, jobs snoozed (for cron alerting) |

## Integration

- **credential-health** — detects broken credentials
- **cron-snooze** — the underlying snooze/unsnooze mechanism
- **cron-failure-escalator** — escalate if credentials stay broken
- **credential-outage-log** — record outage start/end times
- **graceful-degradation** — stateful alert tracking with cooldowns
- **cron-preflight** — individual job pre-flight before running

## Limitations

- Auto-discovery by keyword matching is best-effort; the shield-map.json is more reliable
- Only works with cron jobs managed by OpenClaw (via `openclaw cron` CLI)
- Does not fix credentials — only shields jobs from running when they'd fail anyway
- Requires `openclaw` CLI access for cron enable/disable
