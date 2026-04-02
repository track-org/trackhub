---
name: heartbeat-checklist
description: Efficiently manage recurring heartbeat tasks with state tracking, smart scheduling, and rotation. Use when an agent receives periodic heartbeat polls and needs to decide what to check, when to check it, and whether to stay quiet or alert. Replaces ad-hoc heartbeat logic with a structured, stateful checklist that avoids redundant checks and respects quiet hours.
skill-type: standard
category: agent-ops
tags: [heartbeat, cron, scheduling, proactive, monitoring, state-management]
suggested-connectors: []
suggested-job-type: heartbeat
suggested-schedule-frequency: continuous
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: heartbeat-state
    description: Read, update, and query heartbeat task state from a JSON file
---

# Heartbeat Checklist

Turn heartbeat polls into structured, stateful task execution instead of ad-hoc logic scattered across HEARTBEAT.md.

## Problem This Solves

Without this skill, agents tend to:
- Re-check the same things every heartbeat (wasting tokens)
- Lose track of what they already checked this session
- Hard-code check logic in HEARTBEAT.md that drifts over time
- Have no concept of "I already checked email 20 minutes ago"

## Core Concepts

### Task Types

| Type | Description | Example |
|------|-------------|---------|
| **scheduled** | Check at a specific time or interval | "Check Attio cron after 07:00" |
| **rotating** | Pick from a pool, check 1-2 per heartbeat | Email, calendar, mentions, weather |
| **windowed** | Only active during a time window | Nightly builds (00:00-03:00) |
| **reactive** | Check only when something changed | "Re-check Slack if last check found something" |
| **once** | One-time task, remove after completion | "Verify new cron job ran once" |

### State File

The heartbeat state is stored in a JSON file (default: `memory/heartbeat-state.json`). Each task tracks:

```json
{
  "lastChecks": {
    "attio-cron": 1775109638679,
    "email": 1775110000000,
    "slack-C0ANLG7P290": null
  },
  "lastResults": {
    "attio-cron": { "status": "ok", "summary": "No changes" }
  },
  "currentWindow": {
    "nightly-build": { "start": "00:00", "end": "03:00", "timezone": "Europe/Dublin" }
  }
}
```

### Quiet Hours

Respect quiet hours by default:
- **Late night**: 23:00–08:00 local time — only respond for urgent items
- **All-clear**: If nothing needs attention, reply `HEARTBEAT_OK` (or platform equivalent)

## Using the State Script

### Read state

```sh
node scripts/heartbeat-state.mjs read [--file <path>]
```

### Record a check

```sh
node scripts/heartbeat-state.mjs check <task-name> [--status ok|fail|warn] [--summary "text"] [--file <path>]
```

### Query: should I check this?

```sh
node scripts/heartbeat-state.mjs should-check <task-name> [--min-interval 3600] [--after HH:MM] [--before HH:MM] [--window-start HH:MM] [--window-end HH:MM] [--file <path>]
```

Exits 0 (yes, check it) or 1 (skip). Use `--min-interval` to avoid re-checking too frequently.

### List overdue tasks

```sh
node scripts/heartbeat-state.mjs overdue [--file <path>]
```

Returns JSON array of tasks past their `--min-interval`.

### Reset a task

```sh
node scripts/heartbeat-state.mjs reset <task-name> [--file <path>]
```

### Prune old results

```sh
node scripts/heartbeat-state.mjs prune [--max-age 86400] [--file <path>]
```

## Integration Pattern

### In HEARTBEAT.md

Keep HEARTBEAT.md as a **declarative checklist**, not procedural logic:

```markdown
# HEARTBEAT.md

Use the heartbeat-checklist skill for all task management.

## Tasks
- attio-cron: scheduled daily 07:00, check after 07:00
- slack-C0ANLG7P290: rotating, check every 2-4 hours
- nightly-build: windowed 00:00-03:00, once per night
- email: rotating, check every 3-4 hours during business hours

## Quiet hours: 23:00-08:00 (urgent only)
```

### In the agent's heartbeat handler

1. Read HEARTBEAT.md for the task list
2. For each task, run `should-check` to see if it's due
3. Execute only the tasks that are due
4. Record results with `check`
5. If nothing needed attention, reply `HEARTBEAT_OK`

## Decision Logic

### Should I check right now?

```
Is it quiet hours (23:00-08:00)?
  → Yes: Only check tasks marked urgent
  → No: Continue

Is the task scheduled (specific time)?
  → Yes: Has the scheduled time passed since last check?
    → Yes: Check it
    → No: Skip

Is the task windowed?
  → Yes: Are we inside the window?
    → Yes: Has it been done this window?
      → No: Do it
      → Yes: Skip
    → No: Skip

Is the task rotating?
  → Yes: Has min-interval elapsed since last check?
    → Yes: Check it
    → No: Skip

Is the task reactive?
  → Yes: Did last result indicate follow-up needed?
    → Yes: Check it
    → No: Skip
```

### When to alert vs stay quiet

**Alert when:**
- A scheduled check fails
- A reactive check finds something new
- An overdue task is significantly past due
- Something is time-sensitive (calendar event <2h away)

**Stay quiet when:**
- All checks passed
- Nothing changed since last check
- It's quiet hours and nothing is urgent
- The human is clearly busy (recent messages show activity)

## Anti-Patterns

- ❌ Checking everything every heartbeat — use intervals and rotation
- ❌ Recording "I checked and it was fine" in the chat — use state file, stay silent
- ❌ Growing HEARTBEAT.md into a procedural script — keep it declarative
- ❌ Ignoring quiet hours for non-urgent tasks
- ❌ Failing silently — if a check errors, record it as `fail` status

## References

- [task-types.md](references/task-types.md) — Detailed examples for each task type
- [state-schema.md](references/state-schema.md) — Full state file schema documentation
- [integration-patterns.md](references/integration-patterns.md) — Examples for different agent setups
