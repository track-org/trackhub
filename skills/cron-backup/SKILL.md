---
name: cron-backup
description: Export OpenClaw cron job configurations as restorable JSON snapshots and import them back. Supports full fleet export, single-job export, diff-based restore, and backup rotation. Use when backing up cron configs before changes, migrating jobs between instances, recovering deleted jobs, or scheduling periodic cron fleet backups.
---

# Cron Backup

Export and import OpenClaw cron job configurations as versioned JSON snapshots. Safe, idempotent, and designed for both manual and automated (heartbeat/cron) use.

## Why

Cron job configs represent significant investment — schedules, payloads, delivery targets, and preflight checks are all hand-tuned. A misconfigured `openclaw cron edit` or accidental delete can wipe that work. This skill provides a safety net: point-in-time snapshots you can restore from.

## Scripts

- `scripts/cron-backup.mjs` — Zero dependencies. Node.js 18+.

## Requirements

- Node.js 18+ (uses built-in `fetch`, `fs`, `path`)
- `openclaw` CLI available in PATH (for `openclaw cron list --json`)

## Usage

### Export (create a backup)

```bash
# Full fleet backup (all jobs)
node cron-backup.mjs export

# Single job by ID or name
node cron-backup.mjs export --job "Solar export WhatsApp nudge"
node cron-backup.mjs export --job 2e0eb8eb-2192-4966-b6cf-f3c0046f901b

# Custom output directory
node cron-backup.mjs export --dir /tmp/my-backups

# Limit number of rotated backups (default: 10)
node cron-backup.mjs export --max-backups 5
```

### Import (restore from backup)

```bash
# Show what would be restored (dry run)
node cron-backup.mjs import --dry-run

# Restore most recent backup
node cron-backup.mjs import

# Restore a specific backup file
node cron-backup.mjs import --file backups/cron-backup-2026-05-23T00-00-00.json

# Force restore even if current jobs match (overwrite)
node cron-backup.mjs import --force

# Restore a single job from backup
node cron-backup.mjs import --job "Solar export WhatsApp nudge"
```

### List backups

```bash
# Show all available backups
node cron-backup.mjs list

# JSON output
node cron-backup.mjs list --json
```

### Diff

```bash
# Compare current fleet vs most recent backup
node cron-backup.mjs diff

# Compare current fleet vs a specific backup
node cron-backup.mjs diff --file backups/cron-backup-2026-05-22T00-00-00.json
```

## Backup Format

Each backup is a JSON file:

```json
{
  "schema": "cron-backup-v1",
  "exportedAt": "2026-05-23T00:00:00.000Z",
  "hostname": "raspberrypi",
  "jobCount": 4,
  "jobs": [
    {
      "id": "2e0eb8eb-...",
      "name": "Solar export WhatsApp nudge",
      "description": "...",
      "enabled": true,
      "schedule": { "kind": "cron", "expr": "0,30 6-21 * * *", "tz": "Europe/Dublin" },
      "sessionTarget": "main",
      "payload": { ... },
      "delivery": { ... }
    }
  ]
}
```

Jobs are exported without runtime state (`state` is excluded) — backups capture config, not history.

## Import Behaviour

- **By default, import is non-destructive**: it only restores jobs that are missing from the current fleet (deleted jobs). Existing jobs are not modified unless `--force` is used.
- **`--force`**: overwrites existing jobs that differ from the backup. Shows a diff before proceeding.
- **`--dry-run`**: shows exactly what would be added/modified/deleted without making changes.
- Import creates jobs via `openclaw cron add` and updates via `openclaw cron edit`.

## Rotation

- Default: keeps the last 10 backups per output directory
- Older backups are automatically cleaned up on export
- Use `--max-backups` to adjust

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--dir` | `-d` | `./backups` | Backup directory path |
| `--file` | `-f` | *(latest)* | Specific backup file to import/diff |
| `--job` | `-j` | *(all)* | Single job name or ID |
| `--max-backups` | `-m` | 10 | Max rotated backups to keep |
| `--dry-run` | | false | Preview without changes |
| `--force` | | false | Overwrite existing on import |
| `--json` | | false | JSON output (list/diff) |
| `--help` | | | Show usage |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (missing args, file not found, etc.) |
| 2 | Dry-run showed changes that would be made |

## Integration

### Scheduled backup via cron

```json
{
  "name": "Weekly cron fleet backup",
  "schedule": { "kind": "cron", "expr": "0 3 * * 0", "tz": "Europe/Dublin" },
  "payload": {
    "kind": "agentTurn",
    "message": "Run: node /path/to/trackhub/skills/cron-backup/scripts/cron-backup.mjs export --max-backups 8\nReport the result briefly."
  }
}
```

### Pre-change safety net

Before editing a cron job manually:

```bash
node cron-backup.mjs export --job "my job name"
# ... make changes ...
# if something breaks:
node cron-backup.mjs import --force --job "my job name"
```
