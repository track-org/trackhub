---
name: cron-orphan-detector
description: >
  Find stale one-shot jobs, disabled jobs sitting unused, and misconfigured cron entries
  that should be cleaned up. Detects jobs with undefined schedules, one-shots that fired
  but were never deleted, and orphaned entries that were created but never ran. Use when
  investigating cron auto-disable errors, cleaning up after job reorgs, or proactively
  preventing stale job accumulation.
skill-type: standard
category: agent-ops
tags: [cron, cleanup, orphan, one-shot, maintenance, hygiene, monitoring]
suggested-connectors: []
suggested-job-type: heartbeat
suggested-schedule-frequency: weekly
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: cron-orphan-detector
    description: Detect stale, orphaned, and misconfigured cron jobs
---

# Cron Orphan Detector 👻

Find cron jobs that are lingering when they shouldn't be — one-shots that already fired, disabled jobs collecting dust, and entries with broken schedules.

## Why

One-shot cron jobs are supposed to fire once and disappear. But if `deleteAfterRun` isn't set, or a job gets disabled after errors, it sticks around. Over time these orphans accumulate, cause confusing error alerts, and make the cron fleet harder to manage.

This skill detects five categories of problem jobs:

| Category | Severity | Description |
|----------|----------|-------------|
| `broken-schedule` | 🔴 High | Schedule is `undefined` or invalid — job can never run |
| `misconfigured` | 🔴 High | No valid cron expression, no one-shot target, never ran |
| `stale-one-shot` | 🟡 Medium | One-shot job that already fired but wasn't deleted |
| `orphaned-one-shot` | 🟡 Medium | One-shot with no runs and no parseable next run time |
| `stale-disabled` | 🟢 Low | Disabled job that hasn't run in a long time |

## Script

`scripts/cron-orphan-detector.mjs` — Zero external dependencies. Node.js 18+. Uses `shared-lib` for args and formatting.

## Requirements

- `openclaw` CLI available in PATH
- Permission to list (and optionally delete) cron jobs

## Usage

```bash
# Report only — see what needs cleanup
node scripts/cron-orphan-detector.mjs

# JSON output for programmatic use
node scripts/cron-orphan-detector.mjs --json

# Dry run — show what would be deleted
node scripts/cron-orphan-detector.mjs --dry-run

# Delete medium+ risk jobs with confirmation
node scripts/cron-orphan-detector.mjs --exec

# Delete without confirmation (careful!)
node scripts/cron-orphan-detector.mjs --exec --force

# Custom thresholds
node scripts/cron-orphan-detector.mjs --stale-days 30 --one-shot-days 0
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | false | JSON output instead of formatted report |
| `--dry-run` | false | Show deletions without executing |
| `--exec` | false | Perform deletions (medium+ risk only) |
| `--force` | false | Skip confirmation prompt |
| `--stale-days N` | 14 | Days before a disabled job is flagged |
| `--orphan-days N` | 7 | (Reserved for future use) |
| `--one-shot-days N` | 1 | Days after a one-shot fires before flagging |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All clean (no orphans) or deletions succeeded |
| 1 | Orphans found (report mode) or confirmation needed |

## Output Example

```
🔍 Cron Orphan Detector
   2 of 18 jobs flagged

🔴 HIGH RISK
  Slack announce helper
    ID: f50ae2ae-...
    Schedule: undefined (exact) | Status: disabled
    ⚠️  broken-schedule: Schedule is undefined/invalid

🟡 MEDIUM RISK
  Deploy notification
    ID: abc-123...
    Schedule: at 2026-04-01T10:00Z | Status: disabled
    Last run: 37d ago
    ⚠️  stale-one-shot: Fired 37d ago

To delete flagged jobs: node cron-orphan-detector.mjs --dry-run
To execute:             node cron-orphan-detector.mjs --exec [--force]
```

## Pairing with Other Skills

- **cron-health** — detects current failures (is it broken *right now*?)
- **cron-first-aid** — diagnoses *why* a job is failing
- **cron-cleanup** — broader cleanup with batch deletion and risk scoring
- **cron-orphan-detector** — specifically targets one-shot/stale/orphaned jobs

The key difference from `cron-cleanup`: this skill focuses narrowly on **structural orphans** (jobs that can't or shouldn't exist anymore), while `cron-cleanup` covers the full lifecycle including chronic failures and success-rate analysis.

## Recommended Schedule

Run weekly as part of cron fleet maintenance, or on-demand after seeing auto-disable errors:

```bash
# In a heartbeat rotation
node /path/to/cron-orphan-detector.mjs --json
```

## Safety

- **Report-only by default** — running without `--exec` never modifies anything
- **Dry-run first** — `--dry-run` shows what would be deleted
- **Confirmation required** — `--exec` without `--force` prompts before deleting
- **Only deletes medium+ risk** — low-risk (stale-disabled) jobs are never auto-deleted
- **Read-only without exec** — all detection is passive
