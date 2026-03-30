---
name: openclaw-cron
description: Create, inspect, debug, and manage OpenClaw cron jobs. Use when setting up scheduled tasks, writing cron payloads, choosing sessionTarget or delivery mode, diagnosing failed cron runs, or understanding the cron job schema and storage format.
---

# OpenClaw Cron Jobs

Reference for creating and managing scheduled tasks in OpenClaw.

## CLI Commands

```bash
openclaw cron list                    # List all jobs
openclaw cron add                     # Interactive creation
openclaw cron edit <id>               # Patch a job
openclaw cron run --id <id>           # Fire immediately (debug)
openclaw cron runs --id <id> --limit 5  # Run history (JSONL)
openclaw cron enable <id>             # Enable
openclaw cron disable <id>            # Disable
openclaw cron rm <id>                 # Delete
openclaw cron status                  # Scheduler status + store path
```

## Storage

- **Jobs file:** `<openclaw-root>/cron/jobs.json` (typically `~/.openclaw/cron/jobs.json`)
- **Run history:** JSONL files alongside jobs.json, queryable via `openclaw cron runs`
- **Schema version:** 1

## Job Schema

```jsonc
{
  "id": "uuid",
  "name": "Human-readable name",
  "description": "Optional longer description",
  "enabled": true,
  "createdAtMs": 1700000000000,
  "updatedAtMs": 1700000000000,

  // Schedule
  "schedule": {
    "kind": "cron",           // "cron" | "at" | "every"
    "expr": "0 7 * * *",     // cron expression (kind=cron)
    "tz": "Europe/Dublin",   // timezone
    "staggerMs": 0           // optional random delay
  },
  // Or one-shot:
  // "schedule": { "kind": "at", "at": "2026-03-30T00:40:00.000Z" }

  // Execution target
  "sessionTarget": "main",    // "main" | "isolated"
  "wakeMode": "now",          // "now" | "next-heartbeat"

  // What the LLM receives
  "payload": {
    "kind": "systemEvent",    // or "agentTurn"
    "text": "..."             // systemEvent: injected into main session
    // "message": "..."       // agentTurn: sent to isolated session
  },

  // Optional delivery of results
  "delivery": {
    "mode": "announce",       // "announce" | "none" | "webhook"
    "channel": "slack",       // "slack" | "whatsapp" | "last"
    "to": "channel:C0A8BNZQ1DK"  // channel:<id> or user:<id>
  },

  // Optional pinning
  "agentId": "main",
  "sessionKey": "agent:main:whatsapp:direct:+1234",

  // One-shot cleanup
  "deleteAfterRun": false,

  // Runtime state (managed by scheduler)
  "state": {
    "nextRunAtMs": 1700000000000,
    "lastRunAtMs": 1700000000000,
    "lastRunStatus": "ok",
    "consecutiveErrors": 0,
    "lastDurationMs": 43000,
    "lastDelivered": true,
    "lastDeliveryStatus": "delivered"
  }
}
```

## Key Decisions

### sessionTarget

| Value | Behaviour |
|---|---|
| `main` | Injects payload into the agent's existing main session. Agent acts in-context. |
| `isolated` | Spawns a fresh one-shot session. Payload is the user message. Clean context each run. |

Use `main` when the agent needs session history or should respond in-place (e.g. WhatsApp weather reply). Use `isolated` for self-contained tasks (e.g. API polling, data generation).

### Payload Kind

| Kind | Field | Use case |
|---|---|---|
| `systemEvent` | `text` | Main session — injected as system message. Agent executes within existing conversation. |
| `agentTurn` | `message` | Isolated session — sent as user message. Agent sees this as the full prompt. |

### Delivery Mode

| Mode | Behaviour |
|---|---|
| `announce` | Post the agent's reply to the specified channel |
| `none` | Discard output (fire-and-forget) |
| `webhook` | POST result to a URL |

For `announce`, set `channel` to `"slack"`, `"whatsapp"`, or `"last"` (reuse the channel from the last interaction). Set `to` to `channel:<id>` or `user:<id>`.

### Schedule Kinds

| Kind | Fields | Example |
|---|---|---|
| `cron` | `expr`, `tz` | `"0 7 * * *"` daily at 7am |
| `at` | `at` (ISO 8601) | `"2026-04-01T09:00:00.000Z"` one-shot |
| `every` | `intervalMs` | `3600000` every hour |

## Prompt Design Tips

- Payload is a single LLM turn — pack multi-step workflows into one instruction
- For isolated jobs, the payload IS the entire context — be explicit
- Use `run: <command>` patterns to kick off scripts, then instruct what to do with output
- End with clear output instructions: "reply with only X", "if Y reply NO_REPLY"
- For stateful jobs, read/write a JSON state file between runs

## Debugging Failed Runs

1. `openclaw cron runs --id <id> --limit 3` — check recent status and error messages
2. `openclaw cron run --id <id>` — fire manually and observe
3. Common failure causes:
   - `delivery.channel` missing when multiple channels configured (must specify explicitly)
   - Payload too vague — isolated sessions need complete instructions
   - Script path errors or missing dependencies
   - Rate limits on external APIs called within the payload

## Multi-Job Patterns

- **Parallel independent tasks:** Separate cron jobs with the same schedule, each isolated
- **Sequential dependent steps:** Combine into a single job with multi-step payload
- **One-shot notifications:** Use `kind: "at"` with `deleteAfterRun: true`
