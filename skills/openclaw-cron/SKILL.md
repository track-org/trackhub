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

## Payload Design

A cron job has one payload, which means one LLM turn. But that doesn't limit you to one action — the LLM can chain multiple steps within that single turn.

### Core Principles

- **Be explicit.** Isolated sessions have zero prior context — the payload IS the entire world.
- **Number your steps.** LLMs follow numbered instructions more reliably than paragraphs.
- **Give output rules.** "Reply with only X" or "If Y, reply NO_REPLY" prevents rambling.
- **Use scripts as building blocks.** `Run: node /path/to/script.mjs` is cleaner than embedding logic in the prompt.
- **Handle errors inline.** Tell the LLM what to do on failure: "If it fails, send a brief failure notice."

### Payload Templates

#### 1. Script Runner + Conditional Reply

Good for: monitoring, checks, alerts.

```
Check for X condition.

Workflow:
1. Run: python3 /path/to/check.py
2. Parse the JSON result.
3. If should_alert is false, reply exactly NO_REPLY.
4. If should_alert is true, reply with the message field verbatim.
```

#### 2. Data Fetch + Transform + Deliver

Good for: reports, summaries, digests.

```
Generate the daily Y report.

1. Run: node /path/to/fetch.mjs — this outputs JSON with { items: [...] }
2. Summarise each item in one line: [category] description (value)
3. If items is empty, reply "No changes today."
4. Otherwise reply with the formatted summary. No preamble.
```

#### 3. Stateful Rotation (Multi-Day Cycle)

Good for: content generation, recurring tasks across topics.

```
You are a daily content generator.

1. Read /path/to/state.json for { index, usedTopics }
2. Pick next topic from rotation: [A, B, C, D, E, F] (use index % 6)
3. Increment index, pick a topic NOT in usedTopics[current]
4. Generate content for that topic.
5. Insert into DB via curl: POST to <url> with body { ... }
6. Update state.json: increment index, add topic to usedTopics, write back.
7. Reply with one-line summary: topic, record ID, next topic.
```

#### 4. Multi-Source Aggregation

Good for: combining data from multiple scripts into one message.

```
Generate the morning briefing.

1. Run: python3 /path/to/weather.py — save output as WEATHER
2. Run: node /path/to/calendar.js — save output as CALENDAR
3. Run: python3 /path/to/email_summary.py — save output as EMAILS
4. Combine into a short briefing:
   - 🌤 Weather: (from WEATHER)
   - 📅 Today: (from CALENDAR)
   - 📬 Unread: (from EMAILS)
5. If all three are empty/none, reply NO_REPLY.
6. Otherwise reply with the combined briefing. Keep it under 200 words.
```

#### 5. Main Session In-Place Action

Good for: replying directly in an ongoing WhatsApp/Signal chat.

```
Reminder: it is time to send the daily update.

1. Run: python3 /path/to/generate.py
2. Send the exact output as a reply here. No preamble.
3. If the script fails, send a brief failure notice instead.
```

### When to Split vs Combine

| Scenario | Approach |
|---|---|
| Independent tasks, different schedules | Separate cron jobs |
| Independent tasks, same schedule | Separate jobs (run in parallel) |
| Tasks that share data or context | Single job, multi-step payload |
| One task's output feeds another | Single job, sequential steps |
| Need different delivery targets | Separate jobs |
| One task is flaky and might block others | Separate jobs (isolation) |

### Prompt Anti-Patterns

- ❌ "Check the weather and let me know if it's nice" — vague, no script, no output format
- ❌ Embedding large data/logic directly in the prompt — use a script instead
- ❌ "Do A, B, C, D, E, F, G" with no error handling — one failure kills the whole chain
- ❌ Forgetting to specify NO_REPLY for silent conditions — LLM will ramble
- ✅ Numbered steps, clear script paths, explicit output rules, inline error handling

## Quick Decision Reference

For a flowchart-style guide when designing a new cron job — "what schedule? what sessionTarget? what payload? what delivery?" — see [`references/cron-decision-tree.md`](references/cron-decision-tree.md). Covers common copy-paste starting points too.

## Debugging Failed Runs

1. `openclaw cron runs --id <id> --limit 3` — check recent status and error messages
2. `openclaw cron run --id <id>` — fire manually and observe
3. Common failure causes:
   - `delivery.channel` missing when multiple channels configured (must specify explicitly)
   - Payload too vague — isolated sessions need complete instructions
   - Script path errors or missing dependencies
   - Rate limits on external APIs called within the payload
   - LLM ignored NO_REPLY instruction — make it more prominent ("reply exactly NO_REPLY")

## Multi-Job Patterns

- **Parallel independent tasks:** Separate cron jobs with the same schedule, each isolated
- **Sequential dependent steps:** Combine into a single job with multi-step payload
- **One-shot notifications:** Use `kind: "at"` with `deleteAfterRun: true`
- **Fan-out/fan-in:** Multiple jobs collect data, a final job reads all their outputs and aggregates
- **Cooldown patterns:** Track last-alert time in a state file, skip if within cooldown window
