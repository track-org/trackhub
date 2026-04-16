---
name: slack-channel-reader
description: Read recent messages from a Slack channel via the Slack Web API. Lightweight alternative for heartbeat and cron contexts where the agent slack tool isn't available. Supports time filtering, bot/human message filtering, and JSON output. Use when checking a Slack channel for recent activity from a cron job, heartbeat, or CLI context.
---

# Slack Channel Reader

Read recent messages from any Slack channel using just a bot token — no agent tool required. Designed for use in heartbeat checks, cron jobs, and CLI contexts where the `slack` agent tool isn't available.

## Why

The OpenClaw `slack` agent tool is great for interactive sessions, but it's not accessible from CLI or heartbeat contexts. This script fills that gap — it's a standalone Node.js script that reads channel history directly via the Slack Web API.

## Script

`scripts/slack-channel-reader.mjs` — Zero dependencies. Node.js 18+ (uses built-in `fetch`).

## Requirements

- **SLACK_BOT_TOKEN** env var (or `--token` flag)
- The bot must be a member of the target channel
- Node.js 18+

## Usage

```bash
# Basic: last 15 messages
SLACK_BOT_TOKEN=xoxb-... node slack-channel-reader.mjs --channel C0ANLG7P290

# Filter by time
node slack-channel-reader.mjs --channel C0ANLG7P290 --since "2h"

# Only bot messages (useful for agent channels)
node slack-channel-reader.mjs --channel C0ANLG7P290 --bot-only --since "1d"

# Only human messages
node slack-channel-reader.mjs --channel C0ANLG7P290 --human-only

# JSON output for programmatic use
node slack-channel-reader.mjs --channel C0ANLG7P290 --json --limit 5
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--channel` | `-c` | *(required)* | Slack channel ID |
| `--limit` | `-l` | 15 | Max messages to fetch |
| `--since` | `-s` | *(none)* | Time filter: `"30m"`, `"2h"`, `"1d"`, or ISO timestamp |
| `--bot-only` | | false | Only show bot/app messages |
| `--human-only` | | false | Only show human messages |
| `--json` | | false | Raw JSON output |
| `--token` | `-t` | `$SLACK_BOT_TOKEN` | Bot token override |
| `--help` | | | Show usage |

## Output Format (default)

```
📂 3 messages in C0ANLG7P290

🤖 [today 00:26] shelldon:
   Nightly build summary: enhanced cron-dashboard skill...

👤 [yesterday 14:30] don:
   Anyone checked the solar output today?
```

- 🤖 = bot message
- 👤 = human message
- Times shown as relative day + clock time

## Use Cases

- **Heartbeat channel checks**: Read a shared agent channel during heartbeat to look for unanswered questions
- **Cron job monitoring**: Verify a cron job's Slack delivery landed correctly
- **Quick CLI checks**: Scan a channel without opening Slack

## Integration with Heartbeat

In a heartbeat context, the Slack bot token can be read from OpenClaw's config:

```bash
TOKEN=$(python3 -c "import json; print(json.load(open('$HOME/.openclaw/openclaw.json'))['channels']['slack']['botToken'])")
SLACK_BOT_TOKEN="$TOKEN" node slack-channel-reader.mjs --channel C0ANLG7P290 --since "30m"
```

## Limitations

- Read-only — cannot send messages or reactions (use the agent `slack` tool for that)
- Thread replies are not expanded (shows top-level messages only)
- Bot must be invited to private channels before it can read them
