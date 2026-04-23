---
name: cron-preflight
description: >
  Reusable cron payload pattern that runs credential-health checks before the real
  cron task. If credentials are broken, it bails out gracefully with an alert instead
  of wasting LLM tokens on a doomed task. Use when creating or editing cron jobs that
  depend on external APIs (Gmail, Slack, Attio, Supabase, etc.), or when a cron job
  failed silently due to expired credentials. Also includes wire-preflight.mjs for
  auto-detecting API dependencies and injecting preflight checks into existing cron jobs.
---

# Cron Preflight 🛡️

Run credential-health checks before executing a cron task. Bail out gracefully if any required credential is broken.

## Why

Cron jobs that depend on external APIs (Gmail, Slack, Attio, Supabase) waste LLM tokens and produce misleading "success" results when the underlying credential has expired. This skill provides a reusable payload pattern that catches broken credentials **before** the real work starts.

It pairs with the `credential-health` skill (which does the actual checking) and the `graceful-degradation` skill (which handles alerting with cooldowns/dedup).

## The Pattern

### Option A: Pre-flight Check in Cron Payload

Add this to any cron payload that depends on external APIs. Insert it as step 1:

```
1. Run: node /path/to/credential-health.cjs --check <service> --fail-only --json
2. If the result contains any "fail" status entries:
   - Do NOT proceed with the main task.
   - Reply with a concise summary: "<service> credential check failed: <detail>. Skipping <task name>."
   - If the cron has delivery configured, the reply will be delivered as the cron output.
3. If all checks pass, proceed with the normal cron workflow.
```

**Example — Gmail digest cron payload:**

```
1. Run: node /home/user/.openclaw/workspace/trackhub/skills/credential-health/scripts/credential-health.cjs --check gmail --fail-only --json
2. If output contains "fail", reply: "Gmail credential check failed — skipping digest." Do NOT proceed.
3. Run: python3 /home/user/.openclaw/workspace/skills/gmail-checker/scripts/check_gmail.py --json
4. Parse the JSON result.
5. If no unread emails, reply NO_REPLY.
6. If unread emails, format a digest and reply.
```

### Option B: Standalone Pre-flight Cron Job

Create a dedicated credential-checking cron that runs before dependent jobs:

```json
{
  "name": "Credential pre-flight (daily)",
  "schedule": { "kind": "cron", "expr": "30 6 * * *", "tz": "Europe/Dublin" },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Run the credential-health script for all configured services. If anything failed, send a concise alert to WhatsApp listing which services are broken. If all OK, reply NO_REPLY.\n\nCommand: node /home/user/.openclaw/workspace/trackhub/skills/credential-health/scripts/credential-health.cjs --fail-only --json"
  },
  "delivery": { "mode": "announce", "channel": "whatsapp" }
}
```

Schedule this ~30 min before dependent cron jobs so there's time to alert.

## Which Services to Check

Match the pre-flight check to what the cron job actually uses:

| Cron job | Pre-flight `--check` |
|---|---|
| Gmail digest (env var token) | `gmail` |
| Gmail digest (file-based token) | `gmail-file` |
| Slack notifications | `slack` |
| Attio pipeline reports | `attio` |
| Supabase queries | `supabase` |
| Multiple services | `gmail-file slack attio` |

## Pairing with Graceful Degradation

The `graceful-degradation` skill handles:
- Alert deduplication (don't spam the same alert every 30 min)
- Cooldown periods (alert once, then go quiet)
- Auto-recovery detection (credential was fixed → send "all clear")

**Recommended flow:**

1. **`cron-preflight`** (this skill) → runs credential-health, decides whether to proceed
2. **`graceful-degradation`** → manages whether to alert, re-alert, or stay quiet

In the cron payload, after a credential failure:

```
1. Credential check failed.
2. Check graceful-degradation state for this service.
3. If cooldown is active (alerted recently), reply NO_REPLY.
4. If cooldown expired, send alert with failure details.
5. Record the alert timestamp in graceful-degradation state.
```

## Quick Reference: Cron Payload Template

Copy this template and customize for any API-dependent cron job:

```
## Pre-flight
Run: node <credential-health-path> --check <services> --fail-only --json
If any failures:
  - Check graceful-degradation cooldown for the failed service(s).
  - If within cooldown, reply NO_REPLY.
  - If cooldown expired, reply with alert: "<service> credential expired: <detail>. Cron task '<job name>' skipped."
  - Record alert in graceful-degradation state.
  - Do NOT proceed to main task.

## Main Task
<normal cron workflow here>
```

## Anti-Patterns

- ❌ Running pre-flight checks hours before the real task (tokens can expire in between)
- ❌ Alerting on every single failure without cooldown (noise)
- ❌ Checking services the cron job doesn't actually use (wasted API calls)
- ❌ Hardcoding credential paths in cron payloads (use a consistent path convention)
- ✅ Check immediately before the main task in the same payload
- ✅ Pair with graceful-degradation for alert management
- ✅ Use `--fail-only` to keep output clean for LLM parsing
- ✅ Use `--json` for structured output the agent can easily evaluate

## Auto-Wire Script: `wire-preflight.mjs`

`scripts/wire-preflight.mjs` — automatically detects which APIs a cron job uses and injects credential-health preflight checks into its payload. No more manually editing payloads.

### Usage

```bash
# Wire a specific job
node scripts/wire-preflight.mjs <job-id-or-name>

# Scan all enabled jobs and wire any that need it
node scripts/wire-preflight.mjs --all

# Preview without making changes
node scripts/wire-preflight.mjs --all --dry-run
```

### How It Works

1. Reads all cron jobs via `openclaw cron list --json`
2. Scans each job's payload text for API-related keywords (gmail, attio, supabase, openai, slack)
3. Ignores negative mentions (e.g. "Do not post to Slack") to avoid false positives
4. Skips jobs that already have preflight checks injected
5. Injects a preflight step at the top of the payload with the detected services
6. Updates the job via `openclaw cron edit`, using `--system-event` or `--message` based on payload kind

### Detection Rules

| Service | Detected by keywords |
|---|---|
| Gmail (env var) | `GMAIL_ACCESS_TOKEN`, `GOOGLE_OAUTH_TOKEN` |
| Gmail (file-based) | `check_gmail`, `gmail-checker`, `Gmail digest`, `gmail.json`, `credentials/gmail` |
| Attio | `attio`, `Attio`, `ATTIO`, `pipeline-query` |
| Supabase | `supabase`, `Supabase`, `SUPABASE` |
| OpenAI | `openai`, `OpenAI`, `OPENAI` |
| Slack | `SLACK_BOT_TOKEN`, `slack tool`, `slack reactions` |

Jobs mentioning Slack only in delivery context (e.g. "format for Slack") are correctly skipped.

**Note:** `gmail` (env var) and `gmail-file` are separate checks. Most cron jobs using the `gmail-checker` script store tokens in `~/.openclaw/credentials/gmail.json`, so `gmail-file` is the correct preflight. The `gmail` check only applies when the token is provided via `GMAIL_ACCESS_TOKEN` or `GOOGLE_OAUTH_TOKEN` environment variables.
