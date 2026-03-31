---
name: cron-dashboard
description: Get a health overview of all OpenClaw cron jobs at a glance. Use when checking cron system health, debugging scheduled tasks, getting a quick status of all jobs, or when a heartbeat/proactive check needs to verify everything is running smoothly.
---

# Cron Dashboard

Single-command health check for all OpenClaw cron jobs.

## Overview

Reads `~/.openclaw/cron/jobs.json` and produces a formatted summary showing every job's schedule, last run status, duration, delivery state, and any problems. Useful for heartbeat checks, proactive monitoring, and quick debugging.

## Usage

```bash
python3 {baseDir}/scripts/cron-dashboard.py            # Full dashboard
python3 {baseDir}/scripts/cron-dashboard.py --json      # JSON output
python3 {baseDir}/scripts/cron-dashboard.py --problems-only  # Only show issues
```

### Finding the script at runtime

```bash
SKILL_DIR=$(find /home/delads/.openclaw/workspace/trackhub/skills/cron-dashboard -maxdepth 0 -type d 2>/dev/null)
python3 $SKILL_DIR/scripts/cron-dashboard.py
```

## Output

### Default (text)

```
📋 Cron Dashboard — 5 jobs
✅ All 5 jobs healthy

✅ **Attio stage changes to #product**
   Schedule: 0 7 * * * (Europe/Dublin)
   Last run: 17h ago — ok (14.4s)
   Delivery: slack → channel:C0A8BNZQ1DK ✅
```

### Problems detected

```
⚠️ **Notify Colamari: quick-reports**
   Schedule: once at 2026-03-31T03:20:00.000Z
   Last run: 2h ago — error (24.6s)
   Delivery: slack → channel:C0ANLG7P290 ⚠️ unknown
   Issues: 1 consecutive error, delivery: unknown
```

### JSON mode

`--json` outputs an array of objects, each with:
- `name`, `id`, `enabled`, `schedule`
- `session_target`, `last_run`, `last_status`, `duration`
- `delivery`, `consecutive_errors`
- `issues` (array of strings), `healthy` (boolean)

### Exit codes

- `0` — all jobs healthy
- `1` — one or more jobs have problems (or error loading data)

## What it checks

| Check | Condition |
|-------|-----------|
| Consecutive errors | `state.consecutiveErrors > 0` or `state.lastRunStatus == "error"` |
| Never run | `state.lastRunAtMs` is null |
| Delivery failure | delivery mode set but `lastDeliveryStatus` is not `delivered` or `not-requested` |
| Disabled | `enabled == false` |
| Stale one-shot | one-shot with `deleteAfterRun` that succeeded but still exists |

## Integration with heartbeat

Use during heartbeats to quickly verify all scheduled tasks are healthy:

```
1. Run: python3 /path/to/cron-dashboard.py --problems-only
2. If exit code 0, reply HEARTBEAT_OK.
3. If exit code 1, review the output and decide:
   - Stale one-shot jobs → can clean up: `openclaw cron rm <id>`
   - Transient errors → note in daily memory, check again next heartbeat
   - Repeated failures → alert Don with the job name and error count
```

## Cleanup patterns

After identifying stale one-shot jobs:

```bash
# List disabled or errored one-shots
openclaw cron list --json | python3 -c "
import json, sys
jobs = json.load(sys.stdin)['jobs']
for j in jobs:
    s = j.get('schedule', {})
    if s.get('kind') == 'at' and (not j.get('enabled') or j.get('state', {}).get('lastRunStatus') == 'error'):
        print(f\"{j['id']}  {j['name']}  enabled={j.get('enabled')}  status={j.get('state', {}).get('lastRunStatus')}\")
"
```
