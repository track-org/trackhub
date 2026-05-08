---
name: cron-fleet-diff
description: "Compare cron fleet snapshots over time — detect new jobs, removed jobs, schedule changes, payload modifications, and delivery config drift. Use when auditing what changed in your cron fleet, investigating unexpected behaviour, or tracking fleet evolution across deployments."
---

# Cron Fleet Diff

Compare point-in-time snapshots of your OpenClaw cron fleet to see exactly what changed.

## Why

You've got a growing fleet of cron jobs. Someone (or something) adds, removes, or tweaks them. Without a diff tool, you're left wondering: "didn't that job used to run at a different time?" or "when did that job get added?"

This skill captures snapshots of your entire cron fleet and diffs them against each other. It catches:

- **New jobs** — appeared since last snapshot
- **Removed jobs** — disappeared since last snapshot
- **Schedule changes** — different cron expression, timezone, or schedule kind
- **Delivery changes** — mode, channel, or target changed
- **Enabled/disabled toggles** — job was turned on or off
- **Payload kind changes** — e.g. systemEvent → agentTurn
- **Full payload diffs** (opt-in with `--show-payload`)

## Script

`scripts/cron-fleet-diff.mjs` — Node.js ESM, zero external dependencies (uses shared-lib for arg parsing and formatting).

## Requirements

- Node.js 18+
- `openclaw` CLI available on PATH
- Access to `openclaw cron list --json`

## Usage

```bash
# First run: takes a snapshot, saves it, reports fleet size
node cron-fleet-diff.mjs

# Second run: takes a new snapshot, diffs against the previous one
node cron-fleet-diff.mjs

# Compare against a specific snapshot file
node cron-fleet-diff.mjs --compare 2026-05-08T01-15-00Z_before_cleanup.json

# Take a labelled snapshot (no comparison)
node cron-fleet-diff.mjs --snapshot-only --label "before solis update"

# List all saved snapshots
node cron-fleet-diff.mjs --list

# Only show changes for a specific job
node cron-fleet-diff.mjs --job "Solar export"

# Include full details of removed jobs
node cron-fleet-diff.mjs --show-removed

# Include payload content diffs (can be verbose)
node cron-fleet-diff.mjs --show-payload

# JSON output
node cron-fleet-diff.mjs --json

# Custom snapshot directory
node cron-fleet-diff.mjs --dir /tmp/my-snaps
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--snapshot` | | false | Take a snapshot now (with optional `--label`) |
| `--snapshot-only` | | false | Take a snapshot and exit without comparing |
| `--compare <file>` | | | Compare current fleet against a specific snapshot |
| `--list` | | false | List all saved snapshots |
| `--job <id\|name>` | | | Only show changes for a specific job |
| `--label <text>` | | | Label for the new snapshot |
| `--dir <path>` | | `~/.openclaw/cron-fleet-diff` | Snapshot directory |
| `--show-removed` | | false | Show full details of removed jobs |
| `--show-payload` | | false | Include payload diffs (verbose) |
| `--json` | | false | JSON output |

## Output Format

```
Cron Fleet Diff
──────────────────────
  Previous: 2026-05-08 01:15:00 UTC (before cleanup)
  Current:  2026-05-08 02:30:00 UTC (after cleanup)

Summary: -3 removed, ~1 changed, 4 unchanged

🗑️  Removed (3)
  - Slack announce helper (f50ae2ae)
  - Old notification job (abc12345)
  - Test skill notification (def67890)

🔄 Changed (1)
  ~ Solar export WhatsApp nudge (2e0eb8eb)
    schedule: "0,30 6-21 * * *" → "0,30 7-21 * * *"

✅ 4 jobs unchanged
```

## JSON Output

```json
{
  "previous": { "timestamp": "...", "label": "before cleanup", "totalJobs": 7 },
  "current": { "timestamp": "...", "label": "after cleanup", "totalJobs": 4 },
  "summary": { "added": 0, "removed": 3, "changed": 1, "unchanged": 4 },
  "added": [],
  "removed": [
    { "id": "f50ae2ae-...", "name": "Slack announce helper" }
  ],
  "changed": [
    {
      "id": "2e0eb8eb-...",
      "name": "Solar export WhatsApp nudge",
      "changes": [
        { "field": "schedule", "detail": "expr: \"0,30 6-21 * * *\" → \"0,30 7-21 * * *\"" }
      ]
    }
  ]
}
```

## Snapshot Storage

Snapshots are stored as JSON files in `~/.openclaw/cron-fleet-diff/` by default. Each file contains:

```json
{
  "timestamp": "2026-05-08T01:15:00.000Z",
  "label": "before cleanup",
  "meta": { "totalJobs": 7, "enabled": 5, "disabled": 2 },
  "jobs": [
    {
      "id": "...",
      "name": "...",
      "enabled": true,
      "schedule": { "kind": "cron", "expr": "0 7 * * *", "tz": "Europe/Dublin" },
      "payload": { "kind": "agentTurn", "text": "..." },
      "delivery": { "mode": "announce", "channel": "slack", "to": "channel:C0A8BNZQ1DK" },
      "sessionTarget": "isolated"
    }
  ]
}
```

Snapshots are automatically pruned to a max of 50 files.

## Integration with Cron

Take a daily snapshot to build a fleet history:

```json
{
  "name": "Daily cron fleet snapshot",
  "schedule": { "kind": "cron", "expr": "5 3 * * *", "tz": "Europe/Dublin" },
  "payload": {
    "kind": "agentTurn",
    "message": "Run: node /path/to/cron-fleet-diff.mjs --snapshot-only --label 'daily'. If the diff from the previous day shows any added/removed/changed jobs, include a brief summary in your daily report. Otherwise reply NO_REPLY."
  }
}
```

## Integration with Other Skills

- **cron-cleanup** — run fleet-diff before and after cleanup to see exactly what was removed
- **cron-health** — fleet-diff shows structural changes; cron-health shows runtime health
- **cron-dashboard** — combine fleet-diff snapshots with dashboard status for a full picture
- **git-workflow** — commit snapshot diffs to track cron fleet evolution in version control

## Anti-Patterns

- ❌ Running every minute — snapshots are point-in-time, not continuous
- ❌ Ignoring the output — the value is in reviewing diffs, not just taking snapshots
- ✅ Take snapshots before and after any cron fleet changes
- ✅ Label snapshots meaningfully for later reference
- ✅ Use `--job` to focus on a specific job when debugging

## Limitations

- Payload comparison is truncated to 2000 chars to avoid noise (use `--show-payload` for full diffs)
- Only compares the most recent snapshot by default (use `--compare` for specific files)
- Requires `openclaw` CLI — doesn't query the gateway directly
- Snapshot files are local only — not synced across machines
