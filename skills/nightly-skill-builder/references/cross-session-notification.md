# Cross-Session Notification Patterns

When an agent running in heartbeat or cron context needs to send a message to a Slack channel, Discord server, or other chat surface that isn't the current session's channel, the slack tool alone isn't enough — it may not be available or may not route to the right destination.

## Recommended: One-shot cron job with announce delivery

The cleanest pattern is a temporary cron job that runs once, delivers its output natively, and deletes itself.

### Example: Send a message to a Slack channel

```bash
openclaw cron add \
  --name "one-shot: notify shelldon" \
  --at "now" \
  --delete-after-run \
  --announce \
  --channel slack \
  --to "channel:C0ANLG7P290" \
  --message "Hey Shelldon — quick sync on the customer intelligence pilot. Plans are in plans/customer-intelligence-pilot.md and plans/design-partner-pitch.md. 4-week design partner pilot kicking off this week (discovery starts Mon Mar 31). Anything worth coordinating on your side?"
```

Key flags:
- `--at "now"` — run immediately (one-shot)
- `--delete-after-run` — clean up after success
- `--announce` — deliver the agent's response to the target
- `--channel slack` — delivery channel type
- `--to "channel:<ID>"` — Slack channel ID
- `--message "..."` — what to tell the agent

### Discord variant

```bash
openclaw cron add \
  --name "one-shot: notify discord" \
  --at "now" \
  --delete-after-run \
  --announce \
  --channel discord \
  --to "CHANNEL_ID" \
  --message "Your message here"
```

## Alternative: sessions_spawn with streamTo

If the agent has `sessions_spawn` available, spawning a sub-agent that has access to the target channel can work. This depends on runtime routing and is less predictable than cron delivery.

## When to use each pattern

| Situation | Recommended approach |
|---|---|
| Heartbeat needs to notify a Slack channel | One-shot cron with `--announce` |
| Cron job needs to send a summary | Use `--announce` on the job itself |
| Agent in a TUI session wants to post to Slack | Use the `slack` tool directly |
| Peer agent sync across runtimes | One-shot cron to the shared channel |

## Important: how --announce actually works

The `--announce` flag delivers the agent's **final response** to the target channel at the runtime level — the agent itself does NOT need access to the slack tool. The agent's job is simply to produce the right output text; the runtime handles delivery.

This means:
- The agent prompt should tell the agent to **reply with exactly the message** you want posted
- The agent will likely try (and fail) to use tools like `slack` or `sessions_send` — that's fine, as long as its final text output is the message
- For reliability, use `--light-context` and simple instructions like "Reply with exactly this text and nothing else: <message>"
- Check delivery status with `openclaw cron list --json` — look for `lastDeliveryStatus: "delivered"`

## Gotchas

- `--to` format varies by channel: Slack uses `channel:C123`, Discord uses the channel ID directly, Telegram uses the chat ID
- If the one-shot job fails, `--delete-after-run` won't trigger — the job stays and can be retried or cleaned up manually
- For messages that need to go out regardless of agent response, `--best-effort-deliver` prevents delivery failure from failing the whole job
- The `--announce` flag delivers the agent's **response** to the message, not the message itself — so the agent prompt should instruct it to output exactly what should be posted

---

*Created: 2026-03-30*
