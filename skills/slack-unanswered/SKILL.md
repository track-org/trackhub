---
name: slack-unanswered
description: "Find unanswered Slack messages in shared channels — detects dropped questions, missed mentions, and messages with no replies or reactions within a configurable window. Use when auditing responsiveness, catching dropped questions, or checking if humans or agents missed something."
---

# slack-unanswered

Find messages in a Slack channel that got no response — no thread replies, no reactions.
Built for shared human+agent channels where dropped questions are a real risk.

## Why

In shared channels with multiple agents and humans, it's easy for questions to slip
through unnoticed. This skill scans recent messages and flags those with zero engagement,
helping you catch dropped questions, missed mentions, and orphaned requests.

It complements `slack-channel-reader` (reads messages) by adding the *answered vs unanswered*
analysis layer on top.

## Script

`scripts/slack-unanswered.mjs` — Zero external dependencies. Node.js 18+.

## Requirements

- **SLACK_BOT_TOKEN** env var (or `--token` flag)
- The bot must be a member of the target channel
- Node.js 18+

## Usage

```bash
# Basic: find unanswered messages from the last 8 hours
SLACK_BOT_TOKEN=xoxb-... node slack-unanswered.mjs --channel C0ANLG7P290

# Shorter window
node slack-unanswered.mjs --channel C0ANLG7P290 --since "2h"

# Only flag messages that look like questions
node slack-unanswered.mjs --channel C0ANLG7P290 --question

# Include bot messages in the scan
node slack-unanswered.mjs --channel C0ANLG7P290 --include-bots

# Verbose: show all messages with answered/unanswered status
node slack-unanswered.mjs --channel C0ANLG7P290 --verbose

# JSON output for programmatic use
node slack-unanswered.mjs --channel C0ANLG7P290 --json
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--channel` | `-c` | *(required)* | Slack channel ID |
| `--since` | `-s` | `8h` | How far back to scan |
| `--min-age` | | `30m` | Minimum message age before flagging (avoids flagging brand-new messages) |
| `--question` | | false | Only flag messages that look like questions |
| `--human-only` | | true | Only check human-sent messages |
| `--include-bots` | | false | Include bot messages (overrides --human-only) |
| `--json` | | false | Raw JSON output |
| `--limit` | `-l` | 50 | Max messages to scan |
| `--verbose` | | false | Show all messages with status, not just unanswered |
| `--token` | `-t` | `$SLACK_BOT_TOKEN` | Bot token override |
| `--help` | | | Show help |

## Output

### Default (unanswered only)

```
🔍 2 unanswered messages in C0ANLG7P290 (last 8h)

❓ 👤 [May 14, 09:30, 5h ago] don:
   Has anyone checked if the solar alerts are working?

💬 👤 [May 14, 11:15, 3h ago] don:
   The new cron job needs its schedule tweaked
```

- ❓ = looks like a question
- 💬 = doesn't look like a question
- 👤 = human, 🤖 = bot

### Verbose mode (`--verbose`)

Shows all messages with ✅ (answered) or ❌ (unanswered) status, plus reply counts and reactions.

### JSON (`--json`)

```json
{
  "channel": "C0ANLG7P290",
  "window": "8h",
  "minAge": "30m",
  "total": 12,
  "scanned": 8,
  "unanswered": [
    {
      "ts": "1747212600.000001",
      "sender": "don",
      "isBot": false,
      "text": "Has anyone checked if the solar alerts are working?",
      "question": true,
      "replies": 0,
      "reactions": null,
      "age": "5h ago",
      "time": "May 14, 09:30"
    }
  ]
}
```

## How It Detects "Unanswered"

A message is considered **answered** if any of these are true:

1. It has thread replies (`reply_count > 0`)
2. It has emoji reactions
3. For small result sets, it double-checks via `conversations.replies` API to catch stale data

A message is considered a **question** if it:

- Ends with `?`
- Starts with a question word (what, who, where, when, why, how, can, etc.)

## Integration with Heartbeat

Check for unanswered questions during heartbeat:

```bash
TOKEN=$(python3 -c "import json; print(json.load(open('$HOME/.openclaw/openclaw.json'))['channels']['slack']['botToken'])")
SLACK_BOT_TOKEN="$TOKEN" node slack-unanswered.mjs --channel C0ANLG7P290 --question --since "4h"
```

If the output contains unanswered questions, include them in the heartbeat alert.

## Limitations

- Read-only — cannot send messages or reactions
- Thread replies are checked via `reply_count` from history (may be slightly stale for very recent messages)
- Bot must be a member of the target channel
- For channels with many messages, the extra `conversations.replies` API calls are skipped (>30 candidates) to avoid rate limits
- Only top-level messages are scanned (not replies within threads)

## Anti-Patterns

- ❌ Running with a very large `--since` (e.g. `30d`) — too many messages, slow
- ❌ Setting `--min-age` too low — flags messages that are only minutes old
- ✅ Use `--question` to focus on actual questions vs statements
- ✅ Pair with `shared-channel-agent` for response decisions after detection
