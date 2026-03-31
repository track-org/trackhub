# Cron Job Decision Tree

Quick reference for designing a new cron job. Start at the top and follow the branches.

## 1. What kind of schedule?

```
Recurring on a time pattern?
├── Yes → kind: "cron"
│   Use standard cron expression (e.g. "0 7 * * *")
│   Always set tz explicitly (e.g. "Europe/Dublin")
│   Optional: staggerMs to randomise within a window
│
└── No → One-time only?
    ├── Yes → kind: "at"
    │   ISO 8601 timestamp (e.g. "2026-04-01T09:00:00.000Z")
    │   Set deleteAfterRun: true to auto-clean
    │
    └── No → Fixed interval?
        └── kind: "every"
            intervalMs: 3600000  (1 hour)
```

## 2. Where should the LLM run?

```
Does the job need existing session context?
├── Yes → sessionTarget: "main"
│   The payload is injected into your ongoing conversation.
│   Good for: replying in WhatsApp/Signal, acting on recent context.
│   Pin to a specific chat with sessionKey.
│
└── No → sessionTarget: "isolated"
    Fresh session every run. Clean context, no history leakage.
    Good for: API polling, data generation, reports, self-contained tasks.
```

## 3. What payload kind?

```
sessionTarget: "main"
└── payload.kind: "systemEvent"
    Use "text" field. Injected as a system message.

sessionTarget: "isolated"
└── payload.kind: "agentTurn"
    Use "message" field. This IS the entire prompt.
    The LLM sees nothing else — be explicit.
```

## 4. What happens to the result?

```
Do you need to see the output?
├── No → delivery.mode: "none"
│   Fire-and-forget. Good for: DB inserts, file writes, background tasks.
│
├── Yes, in a specific channel → delivery.mode: "announce"
│   Set channel: "slack" | "whatsapp" | "last"
│   Set to: "channel:<id>" | "user:<id>"
│   "last" reuses the channel from the most recent interaction.
│
└── Yes, via webhook → delivery.mode: "webhook"
    POST result to a URL.
```

## 5. How to wake the agent?

```
wakeMode: "now"       → Fire the job immediately when the schedule hits.
wakeMode: "next-heartbeat" → Wait for the next heartbeat poll to trigger.
                          Slightly less precise but batches with other checks.
```

## 6. Should multiple tasks share a job or be separate?

```
Do they share data or context?
├── Yes → Combine into ONE job.
│   Chain steps in the payload: "1. Run X. 2. Use output of X in Y."
│   The LLM can do multi-step work in a single turn.
│
├── No → Separate jobs.
│   Independent tasks run in parallel when on the same schedule.
│   Better isolation — one failure doesn't block the others.
│
└── Partially → Hybrid approach.
    Separate jobs for independent parts.
    One aggregation job that reads outputs of the others.
```

## 7. Debugging checklist

If a job fails:

```
1. openclaw cron runs --id <id> --limit 3
   → Check error messages and status history.

2. Is the payload explicit enough?
   → Isolated sessions have zero context.
   → Did you specify output format and NO_REPLY conditions?

3. Is the delivery config correct?
   → If multiple channels exist, you must set delivery.channel explicitly.
   → "last" can be ambiguous — prefer explicit channel IDs.

4. Did a script fail?
   → Check the script path, permissions, dependencies.
   → Run the script manually: openclaw cron run --id <id>

5. Is the LLM not following instructions?
   → Make NO_REPLY more prominent: "reply exactly NO_REPLY"
   → Number your steps. Be more explicit about output format.
   → Move complex logic into a script instead of embedding in the prompt.
```

## Quick config generator

Copy-paste starting points for common patterns:

### Daily report to Slack
```jsonc
{
  "name": "Daily X report",
  "schedule": { "kind": "cron", "expr": "0 7 * * *", "tz": "Europe/Dublin" },
  "sessionTarget": "isolated",
  "wakeMode": "now",
  "payload": { "kind": "agentTurn", "message": "Run: node /path/to/report.mjs\nReply with only the script output." },
  "delivery": { "mode": "announce", "channel": "slack", "to": "channel:CXXXXXXX" }
}
```

### Conditional alert in existing chat
```jsonc
{
  "name": "X alert",
  "schedule": { "kind": "cron", "expr": "0,30 * * * *", "tz": "Europe/Dublin" },
  "sessionTarget": "main",
  "sessionKey": "agent:main:whatsapp:direct:+1234",
  "wakeMode": "now",
  "payload": { "kind": "systemEvent", "text": "Run: python3 /path/to/check.py\nIf should_alert is false, reply exactly NO_REPLY.\nIf true, reply with the message verbatim." }
}
```

### Background data job (fire-and-forget)
```jsonc
{
  "name": "Daily X sync",
  "schedule": { "kind": "cron", "expr": "0 3 * * *", "tz": "Europe/Dublin" },
  "sessionTarget": "isolated",
  "wakeMode": "now",
  "payload": { "kind": "agentTurn", "message": "Run: node /path/to/sync.mjs\nReply with a one-line summary of what was done." },
  "delivery": { "mode": "none" }
}
```

### One-shot notification
```jsonc
{
  "name": "Send X notification",
  "schedule": { "kind": "at", "at": "2026-04-01T09:00:00.000Z" },
  "sessionTarget": "isolated",
  "deleteAfterRun": true,
  "payload": { "kind": "agentTurn", "message": "Send this message to Slack channel CXXXXXXX: [your message here]" },
  "delivery": { "mode": "announce", "channel": "slack", "to": "channel:CXXXXXXX" }
}
```
