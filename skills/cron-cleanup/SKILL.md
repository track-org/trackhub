---
name: cron-cleanup
description: >
  Identify and safely remove stale, broken, or orphaned OpenClaw cron jobs.
  Flags disabled jobs, past one-shots, never-succeeded jobs, consecutive failures,
  and orphaned entries. Supports dry-run, risk-rated reports, and batch deletion
  with confirmation. Use when cleaning up the cron fleet, auditing which jobs
  to keep, or after a big reorg when old jobs pile up.
tags: [cron, maintenance, cleanup, hygiene, automation]
skill-type: standard
category: agent-ops
suggested-job-type: on-demand
suggested-schedule-frequency: weekly
available-scripts:
  - name: cron-cleanup
    description: Analyze cron jobs and flag cleanup candidates by risk level
---

# Cron Cleanup 🧹

Identify cron jobs that are candidates for cleanup — stale disabled jobs, expired one-shots, chronic failures, and orphaned entries.

## Why

Cron jobs accumulate over time. You disable one, forget about it, create a one-shot that fires and lingers, or a job keeps failing silently. `cron-cleanup` gives you a risk-rated report of what to clean up, with safe deletion (dry-run first, confirmation by default).

Pairs with:
- **cron-health** — detects current issues (is it broken right now?)
- **cron-first-aid** — diagnoses specific failures (why is it broken?)
- **cron-snooze** — temporarily disables jobs (vs permanent removal)
- **cron-cleanup** answers "what should I delete?"

## Script

`scripts/cron-cleanup.mjs` — Zero external dependencies. Node.js 18+. Uses the `openclaw` CLI.

## Requirements

- `openclaw` CLI available in PATH
- Permission to list and delete cron jobs

## Usage

```bash
# Report only — see what needs cleanup
node cron-cleanup.mjs

# JSON output for programmatic use
node cron-cleanup.mjs --json

# Dry run — show what would be deleted without acting
node cron-cleanup.mjs --dry-run

# Delete with interactive confirmation
node cron-cleanup.mjs --exec

# Delete without confirmation (careful!)
node cron-cleanup.mjs --exec --force

# Custom thresholds
node cron-cleanup.mjs --stale-days 30 --fail-count 10
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | false | JSON output instead of formatted report |
| `--dry-run` | false | Show deletions without executing |
| `--exec` | false | Perform deletions (requires `--force` or interactive confirm) |
| `--force` | false | Skip confirmation prompt |
| `--stale-days N` | 14 | Days before a disabled job is flagged |
| `--fail-count N` | 5 | Consecutive failures before flagging |
| `--max-age N` | 90 | Days before a past one-shot is flagged |

## Cleanup Categories

| Category | Emoji | Risk | Description |
|----------|-------|------|-------------|
| `stale-disabled` | 💤 | Low | Disabled for > N days, likely forgotten |
| `past-one-shot` | ⏰ | Low | One-shot ("at") schedule that fired long ago |
| `orphaned` | 👻 | Medium | Created but never ran (may be misconfigured) |
| `never-succeeded` | ❌ | Medium | Has attempted runs but zero successes |
| `consecutive-fail` | 🔥 | High | Last N runs all failed — actively broken |

## Output Example

```
🔍 Cron Cleanup Report
   4 of 18 jobs flagged

🔴 HIGH RISK (1)
  Daily email digest
    ID: abc-123...
    Status: enabled | Schedule: cron | Created: 2026-02-15
    Last run: 2026-05-06
    Flags: 🔥 consecutive-fail
      → last 5 runs all failed

🟢 LOW RISK (3)
  One-time deploy notification
    ID: def-456...
    Status: disabled | Schedule: at | Created: 2026-01-10
    Last run: 2026-01-10
    Flags: ⏰ past-one-shot  💤 stale-disabled
      → target was 117 days ago
      → disabled, last updated 87 days ago

To delete flagged jobs: node cron-cleanup.mjs --dry-run
To execute:             node cron-cleanup.mjs --exec [--force]
```

## Recommended Schedule

Run weekly as a cron job (report-only mode):

```bash
openclaw cron add \
  --name "Weekly cron cleanup report" \
  --description "Identify stale/broken cron jobs" \
  --cron "0 10 * * 1" \
  --tz "Europe/Dublin" \
  --session isolated \
  --message "Run: node /path/to/cron-cleanup.mjs --json. If any jobs are flagged at medium or high risk, send a summary to Slack. If all clean, reply NO_REPLY." \
  --timeout 60000
```

## Safety

- **Dry-run first**: Always run with `--dry-run` before `--exec`
- **Confirmation**: Interactive confirmation is on by default when using `--exec`
- **Risk ordering**: Deletions process high→medium→low risk so you see the important ones first
- **Read-only by default**: Running without `--exec` never modifies anything
