---
name: cron-quick-add
description: >
  Generate a ready-to-register OpenClaw cron job JSON from a natural language description.
  Handles schedule parsing, sessionTarget selection, payload templating, and delivery config.
  Use when you need to create a cron job quickly without hand-writing JSON or going through
  the interactive `openclaw cron add` flow.
---

# Cron Quick-Add

Generate a complete OpenClaw cron job JSON from a short description. No interactive prompts, no hand-editing — just describe what you want and get a copy-paste-ready job definition.

## Why

`openclaw cron add` is interactive, which is great for humans but doesn't work well when:
- An agent needs to create a cron job programmatically
- You want to generate a job and review it before registering
- You're templating similar jobs with slight variations
- You need to document what a cron job should look like

This skill bridges the gap between "I want a job that does X" and a valid `openclaw cron edit` / direct JSON payload.

## Script

`scripts/cron-quick-add.mjs` — Zero dependencies. Node.js 18+.

## Requirements

- Node.js 18+

## Usage

```bash
# Generate a daily morning briefing job
node cron-quick-add.mjs \
  --name "morning-briefing" \
  --schedule "0 7 * * *" \
  --tz "Europe/Dublin" \
  --payload "Generate the morning briefing. Check weather, calendar, and emails." \
  --session isolated \
  --delivery slack:channel:C0A8BNZQ1DK

# One-shot reminder
node cron-quick-add.mjs \
  --name "dentist-reminder" \
  --at "2026-06-15T08:00:00.000Z" \
  --payload "Reminder: dentist appointment at 9am today." \
  --session main \
  --delete-after-run

# Every-hour check
node cron-quick-add.mjs \
  --name "stale-pr-check" \
  --every 3600 \
  --payload "Check for PRs older than 3 days. If found, list them." \
  --session isolated \
  --delivery slack:channel:C0A8BNZQ1DK

# Just output the payload template (no job wrapper)
node cron-quick-add.mjs \
  --payload "Check solar output" \
  --payload-only

# Pipe to openclaw cron edit
node cron-quick-add.mjs --name "test" --schedule "0 9 * * 1-5" --payload "hello" --session isolated | openclaw cron edit -
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--name` | `-n` | *(required)* | Job name |
| `--schedule` | `-s` | *(required\*)* | Cron expression (e.g. `0 7 * * *`) |
| `--at` | | *(required\*)* | ISO 8601 timestamp for one-shot jobs |
| `--every` | | *(required\*)* | Interval in seconds for recurring jobs |
| `--tz` | | `Europe/Dublin` | Timezone for cron schedule |
| `--payload` | `-p` | *(required)* | The prompt/instruction the LLM receives |
| `--session` | | `isolated` | `main` or `isolated` sessionTarget |
| `--delivery` | `-d` | *(none)* | Delivery target: `slack:channel:ID`, `slack:user:ID`, `whatsapp:user:ID`, `none` |
| `--stagger` | | `0` | Random stagger in seconds |
| `--description` | | *(none)* | Longer job description |
| `--delete-after-run` | | `false` | Auto-delete one-shot after firing |
| `--payload-only` | | `false` | Output only the payload object (no job wrapper) |
| `--json` | | `false` | Output JSON (default is pretty-printed) |
| `--dry-run` | | `false` | Show what would be generated without assumptions |
| `--help` | | | Show usage |

\* One of `--schedule`, `--at`, or `--every` is required.

## Output

By default, outputs a pretty-printed JSON job definition that can be:
1. Saved to a file and used with `openclaw cron edit`
2. Piped directly to OpenClaw
3. Reviewed and hand-tweaked before registration

### Example Output

```json
{
  "name": "morning-briefing",
  "description": "Generate the morning briefing",
  "enabled": true,
  "schedule": {
    "kind": "cron",
    "expr": "0 7 * * *",
    "tz": "Europe/Dublin"
  },
  "sessionTarget": "isolated",
  "wakeMode": "now",
  "payload": {
    "kind": "agentTurn",
    "message": "Generate the morning briefing. Check weather, calendar, and emails."
  },
  "delivery": {
    "mode": "announce",
    "channel": "slack",
    "to": "channel:C0A8BNZQ1DK"
  },
  "deleteAfterRun": false
}
```

## Smart Defaults

The script applies sensible defaults based on the session type:

| Setting | `isolated` | `main` |
|---------|-----------|--------|
| `payload.kind` | `agentTurn` | `systemEvent` |
| `payload field` | `message` | `text` |
| `wakeMode` | `now` | `now` |

## Delivery Parsing

The `--delivery` flag uses a colon-separated format:

| Format | Meaning |
|--------|---------|
| `slack:channel:C0A...` | Announce to Slack channel |
| `slack:user:U0A...` | DM via Slack |
| `whatsapp:user:+353...` | WhatsApp message |
| `none` | No delivery (fire-and-forget) |

If omitted, the job has no delivery config (result is discarded).

## Integration with Other Skills

- **cron-preflight** — add credential checks to generated payloads
- **cron-payload-lint** — validate the generated job before registering
- **cron-scheduler** — check for timing conflicts after generation
- **openclaw-cron** — full schema reference and registration commands
- **cron-retry** — add retry logic to the generated payload

## Limitations

- Generates the JSON definition only — does not register the job (use `openclaw cron edit` or `openclaw cron add`)
- Does not validate cron expressions (use `cron-payload-lint` for that)
- Does not verify channel IDs or delivery targets exist
- No interactive confirmation — outputs and exits
