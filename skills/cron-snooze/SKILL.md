---
name: cron-snooze
description: Temporarily disable OpenClaw cron jobs and auto-re-enable them after a duration or at a specific time. Tracks snoozed state so jobs aren't forgotten. Use when a cron job needs a temporary pause (broken credentials, service outage, maintenance window) and you want it to come back automatically.
skill-type: standard
category: agent-ops
tags: [cron, scheduling, maintenance, pause, disable, auto-enable]
suggested-connectors: []
suggested-job-type: cron
suggested-schedule-frequency: on-demand
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: cron-snooze
    description: Snooze, unsnooze, check, and list cron job snooze state
---

# Cron Snooze 😴

Temporarily disable cron jobs and have them auto-re-enable later. No more forgetting to re-enable a job after fixing credentials or waiting out a service outage.

## Why

When a cron job depends on a broken credential or a service is down, you want to **pause it temporarily** — not delete it, not edit the config manually, and not forget to re-enable it later. `cron-snooze` handles the full lifecycle: disable → track → auto-re-enable.

## Script

`scripts/cron-snooze.mjs` — Zero external dependencies. Node.js 18+. Uses the `openclaw` CLI for enable/disable operations.

## Requirements

- `openclaw` CLI on PATH
- Node.js 18+

## Usage

### Snooze a job for a duration

```bash
# Pause Gmail digest for 24 hours
node scripts/cron-snooze.mjs "gmail digest" --for 24h --reason "OAuth token revoked"

# Pause for 30 minutes
node scripts/cron-snooze.mjs "solar export" --for 30m --reason "Maintenance window"

# Pause for a week
node scripts/cron-snooze.mjs "attio stage" --for 1w
```

### Snooze until a specific time

```bash
# Snooze until 09:00 tomorrow (or today if it hasn't passed)
node scripts/cron-snooze.mjs "gmail digest" --until 09:00
```

### Check snooze status

```bash
# Show all snoozed jobs and which are due
node scripts/cron-snooze.mjs --check

# Auto-re-enable all jobs past their snooze time
node scripts/cron-snooze.mjs --check --reenable

# Quiet mode (for cron integration)
node scripts/cron-snooze.mjs --check --reenable --quiet
```

### Manually re-enable

```bash
# Re-enable a specific job
node scripts/cron-snooze.mjs --unsnooze "gmail digest"

# Re-enable all snoozed jobs
node scripts/cron-snooze.mjs --unsnooze
```

### List snoozed jobs

```bash
# Human-readable
node scripts/cron-snooze.mjs --list

# JSON output
node scripts/cron-snooze.mjs --list --json
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--for <duration>` | *(none)* | Snooze duration: `30m`, `2h`, `1d`, `1w` |
| `--until <HH:MM>` | *(none)* | Re-enable at 24h time (today or tomorrow) |
| `--reason <text>` | *(none)* | Optional reason for the snooze |
| `--check` | | Show snoozed jobs and due status |
| `--reenable` | | Used with `--check` to auto-re-enable due jobs |
| `--unsnooze [id]` | | Re-enable a specific job or all if omitted |
| `--list` | | List all snoozed jobs |
| `--json` | | JSON output (for `--list`) |
| `--quiet` | | Minimal output (for `--check` in cron) |
| `--help` | | Show usage |

## Job Matching

Jobs can be referenced by:
- **Full or partial UUID** (e.g., `87218ac1`)
- **Job name** (case-insensitive substring match, e.g., `gmail`, `attio stage`)

Run `openclaw cron list` to see available jobs and their IDs.

## State File

Snooze state is stored at `~/.openclaw/cron/snoozed.json`:

```json
{
  "snoozed": {
    "87218ac1-9366-44e3-a018-723437395479": {
      "id": "87218ac1-9366-44e3-a018-723437395479",
      "name": "Daily Gmail digest to WhatsApp",
      "snoozedAt": 1776748800000,
      "reenableAt": 1776835200000,
      "reason": "OAuth token revoked",
      "wasEnabled": true
    }
  }
}
```

The state file is independent of the main cron jobs config. Deleting it won't affect jobs, but you'll lose snooze tracking.

## Integration with Cron

To automatically re-enable snoozed jobs, create a cron job that periodically checks:

```bash
node scripts/cron-snooze.mjs --check --reenable --quiet
```

Recommended schedule: every 30–60 minutes. The command is cheap (just reads a JSON file and runs `openclaw cron enable` only for due jobs).

## Integration with Credential Health

Combine with `credential-health` and `graceful-degradation` for a full auto-remediation loop:

1. Cron job runs → credential pre-flight fails
2. Agent snoozes the job: `cron-snooze "gmail digest" --for 6h --reason "OAuth revoked"`
3. Periodic `--check --reenable` job tries to re-enable after 6h
4. If credentials are still bad, the re-enabled job will fail its own pre-flight and could snooze again

## Common Patterns

### Broken credential → snooze until morning

```bash
node scripts/cron-snooze.mjs "gmail digest" --until 09:00 --reason "OAuth revoked, Don will fix in morning"
```

### Service maintenance window

```bash
node scripts/cron-snooze.mjs "solar export" --for 2h --reason "Emporia API maintenance"
node scripts/cron-snooze.mjs "solis" --for 2h --reason "Solis API maintenance"
```

### Snooze everything for the weekend

```bash
node scripts/cron-snooze.mjs "gmail digest" --for 2d
node scripts/cron-snooze.mjs "attio stage" --for 2d
```

## Limitations

- Requires `openclaw` CLI and an active gateway connection to enable/disable jobs
- State file is local to one machine — won't sync across multiple OpenClaw instances
- `--until` uses local timezone (no explicit timezone support yet)
- If the state file is manually deleted while jobs are snoozed, the jobs will stay disabled until manually re-enabled or until `openclaw cron enable` is run

## Complements

- **cron-health** — check overall cron fleet health
- **cron-first-aid** — diagnose broken cron jobs
- **credential-health** — detect broken credentials that might trigger a snooze
- **graceful-degradation** — stateful alert tracking with cooldowns
- **openclaw-cron** — create and manage cron jobs
