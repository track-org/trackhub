# Example Cron Payloads

Real-world examples from production OpenClaw cron jobs. These demonstrate the patterns described in SKILL.md.

## 1. Conditional Alert with Cooldown (Solar Export Nudge)

**Pattern:** Script Runner + Conditional Reply

```jsonc
{
  "sessionTarget": "main",
  "payload": {
    "kind": "systemEvent",
    "text": "Check for live solar export and only message Don on WhatsApp when appropriate.\n\nWorkflow:\n1. Run: EXPORT_ALERT_CRON_JOB_ID=2e0eb8eb-... python3 /path/to/export_alert_check.py\n2. Parse the JSON result.\n3. If should_alert is false, reply exactly NO_REPLY.\n4. If should_alert is true, reply with the message field verbatim.\n5. Do not post anything to Slack or any other channel.\n6. Do not send more than one WhatsApp message within any 4 hour period; the helper script already enforces that statefully."
  }
}
```

**Key takeaways:**
- Script handles state (cooldown tracking) so the payload stays simple
- Explicit NO_REPLY instruction prevents unnecessary messages
- Channel scoping ("Do not post to Slack") prevents cross-channel leakage

## 2. API Polling + Announcement (Attio Stage Changes)

**Pattern:** Data Fetch + Transform + Deliver

```jsonc
{
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Run: node /path/to/daily-stage-changes.mjs. Reply with only the script output, no preamble or commentary."
  },
  "delivery": {
    "mode": "announce",
    "channel": "slack",
    "to": "channel:C0A8BNZQ1DK"
  }
}
```

**Key takeaways:**
- Isolated session — no need for main session context
- Script does all the work; payload is minimal
- Delivery handles routing to Slack automatically
- "Reply with only the script output" prevents the LLM adding commentary

## 3. Stateful Content Generation (Leaving Cert Notes)

**Pattern:** Stateful Rotation

```jsonc
{
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "You are a daily Leaving Cert study note generator. Do the following:\n\n1. Read /path/to/daily-note-state.json to get the subject index and used topics.\n2. Pick the next subject in rotation: Maths, Business, History, Physics, Computer Science, Music (use subjectIndex % 6). Increment the subject index.\n3. Generate a fresh HL note for that subject:\n   - Pick a topic NOT used before (check usedTopics[subject])\n   - Write 4-6 concise bullet-point notes\n   - Write 5 exam-style questions\n4. Insert into Supabase via curl: POST to <url> with body {subject, topic, notes, created_at}\n5. Insert 5 questions: POST each to <url> with 200ms delay between inserts\n6. Update state.json: increment index, add topic to usedTopics, write back.\n7. Reply with one-line summary: subject, topic, note id, next subject."
  },
  "delivery": {
    "mode": "none"
  }
}
```

**Key takeaways:**
- LLM generates content (not just running a script) — payload must be detailed
- State file prevents topic repetition across days
- Numbered steps keep the LLM on track
- Fire-and-forget delivery (mode: none) — the value is in the DB insertion
- Rate limiting (200ms delay) between API calls

## 4. In-Session Reply (Weather Update)

**Pattern:** Main Session In-Place Action

```jsonc
{
  "sessionTarget": "main",
  "payload": {
    "kind": "systemEvent",
    "text": "Reminder: it is time to send Don the daily Dublin weather update in this WhatsApp chat. Run `python3 /path/to/weather_brief.py`, then send the exact output as a short WhatsApp reply here. If it fails, send a brief failure notice instead."
  }
}
```

**Key takeaways:**
- Main session — the reply goes directly into the existing WhatsApp conversation
- Minimal payload — script does the work, LLM just relays
- Error handling: "If it fails, send a brief failure notice" — don't silently fail
