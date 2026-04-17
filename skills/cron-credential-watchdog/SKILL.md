---
name: cron-credential-watchdog
description: "Proactive credential health monitoring as a cron job. Runs early morning, checks all API credentials, and alerts the human only once per failure with stateful deduplication and auto-recovery detection. Drop-in cron template using credential-health + graceful-degradation. Use when setting up daily credential monitoring, preventing cron jobs from failing silently on expired tokens, or when credentials expire and you want early detection."
---

# Cron Credential Watchdog

Stop discovering expired credentials when a cron job fails at 09:00. This skill gives you a **ready-to-deploy cron job** that checks all API credentials early each morning and alerts you exactly once per failure — then goes quiet until you fix it or the cooldown expires.

## Why

- Gmail token expires → email digest wastes tokens at 09:00 before anyone notices
- Slack bot token revoked → notifications silently fail for days
- Attio API key rotated → CRM reports go blank

The `credential-health` skill detects problems. The `graceful-degradation` skill manages alerting state. This skill **wires them together into a single cron job** you can deploy in 60 seconds.

## Dependencies

- **credential-health** (`trackhub/skills/credential-health`) — does the actual validation
- **graceful-degradation** (`trackhub/skills/graceful-degradation`) — provides `cred_state.sh` for stateful alerting

Both must be present in the same trackhub installation.

## Quick Deploy

Create a cron job with this payload:

```json
{
  "name": "Daily credential watchdog",
  "description": "Checks all API credentials at 06:00, alerts once per failure with cooldown",
  "enabled": true,
  "schedule": {
    "kind": "cron",
    "expr": "0 6 * * *",
    "tz": "Europe/Dublin"
  },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "You are the credential watchdog. Run credential health checks and alert if anything is broken.\n\n1. Run: node /home/delads/.openclaw/workspace/trackhub/skills/credential-health/scripts/credential-health.cjs --json --fail-only\n2. Parse the JSON output.\n3. If all credentials are OK (no 'fail' entries in results), reply exactly NO_REPLY.\n4. If any credentials failed:\n   a. For each failed service, check if we should alert:\n      Run: bash /home/delads/.openclaw/workspace/trackhub/skills/graceful-degradation/scripts/cred_state.sh <service> should-alert\n   b. Only include services where the output starts with 'yes'.\n   c. If none need alerting (all in cooldown), reply exactly NO_REPLY.\n   d. For services that need alerting, format a concise alert listing each broken credential and what to do about it.\n   e. After alerting, mark each service as alerted:\n      Run: bash /home/delads/.openclaw/workspace/trackhub/skills/graceful-degradation/scripts/cred_state.sh <service> mark-alerted\n5. If any previously-failing services are now OK, mark them as recovered:\n   Run: bash /home/delads/.openclaw/workspace/trackhub/skills/graceful-degradation/scripts/cred_state.sh <service> set-ok"
  },
  "delivery": {
    "mode": "announce",
    "channel": "whatsapp",
    "to": "+353868807853"
  }
}
```

## Wrapper Script

`scripts/watchdog.sh` — a convenience script that runs the full check + state management in one command:

```bash
# Full check (human-readable)
bash scripts/watchdog.sh

# JSON output (for cron payloads)
bash scripts/watchdog.sh --json

# Check specific services only
bash scripts/watchdog.sh --services gmail slack
```

### Exit Codes

| Code | Meaning |
|---|---|
| 0 | All credentials healthy (or all failures in cooldown) |
| 1 | New failures detected (should alert) |
| 2 | Script/config error |

### JSON Output

```json
{
  "timestamp": "2026-04-17T06:00:00+01:00",
  "results": [
    { "service": "gmail", "status": "fail", "detail": "Token expired or revoked", "shouldAlert": true },
    { "service": "slack", "status": "ok", "detail": "Bot token valid", "recovered": true }
  ],
  "summary": { "healthy": 1, "failing": 1, "newAlerts": 1, "recovered": 1 }
}
```

## Alert Message Format

When a failure is detected, the alert should include:

- **What's broken** — service name + error detail
- **What it affects** — which cron jobs depend on this credential
- **What to do** — brief fix instructions (re-auth, rotate key, etc.)

Example alert:

```
🦊 Credential Alert
───────────────────
⚠️ Gmail — Token expired or revoked
   Affects: Daily Gmail digest, email checks
   Fix: Re-authenticate via gcloud CLI or OAuth flow

⚠️ Slack — Bot token invalid
   Affects: All Slack notifications
   Fix: Regenerate bot token at api.slack.com/apps

Last checked: 06:00 Dublin time
```

## Cooldown Behaviour

- Default cooldown: **24 hours** (configurable via `CRED_COOLDOWN_HOURS` env var)
- First failure → alert immediately
- Subsequent runs → silent if within cooldown
- Credential recovers → mark as OK, next failure triggers fresh alert
- Cooldown resets on each failure detection (not on alert)

## Customization

### Change the check schedule

The default is 06:00 Dublin time — early enough to catch issues before morning digest jobs run. Adjust the cron expression as needed.

### Change delivery channel

Replace the delivery block to route alerts elsewhere:
- `"channel": "slack", "to": "channel:C0ANLG7P290"` — agent shared channel
- `"channel": "telegram", "to": "<chat_id>"` — Telegram
- `"sessionTarget": "main"` — deliver to main session instead of isolated

### Add credential-specific fix instructions

Edit the payload message to include service-specific remediation steps relevant to your setup.

## Anti-Patterns

- ❌ Running this *after* dependent jobs — defeats the purpose
- ❌ Setting cooldown too short (< 4h) — noisy alerts
- ❌ Setting cooldown too long (> 48h) — might forget about it
- ❌ Not pairing with `graceful-degradation` state — every run would alert
- ✅ Run 1-3 hours before your first credential-dependent cron job
- ✅ Use `--fail-only` to keep credential-health output clean
- ✅ Let the LLM format the alert — it can include contextual fix steps
