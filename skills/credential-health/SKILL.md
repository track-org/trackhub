---
name: credential-health
description: Validate API credentials and tokens before cron jobs or agent turns try to use them. Catches expired OAuth tokens, invalid API keys, and unreachable auth endpoints early so downstream tasks can bail out gracefully instead of failing silently. Zero external dependencies.
---

# Credential Health Checker

Proactively verify that configured API credentials and tokens are still valid. Run before cron jobs or agent turns that depend on external APIs to catch expired/revoked credentials early.

## Why

A cron job that sends a Gmail digest is useless if the OAuth token expired yesterday — you just waste tokens running the LLM turn before discovering the failure. Same for Slack tokens, Attio API keys, Supabase JWTs, etc. This skill lets you validate credentials upfront and decide whether to proceed, retry, or alert.

## Script

`scripts/credential-health.cjs` — Node.js CJS, zero external dependencies (ES5 for arm64 memory safety).

## Supported Checks

| Check | Method | What it detects |
|---|---|---|
| **gmail** | OAuth2 token introspection via Google userinfo endpoint | Expired/revoked OAuth tokens (env var) |
| **gmail-file** | Reads OAuth credentials JSON file, validates access_token or refresh_token | Expired/revoked tokens stored in credential files |
| **slack** | `auth.test` API call | Invalid bot tokens |
| **attio** | GET to `/objects` with API key header | Invalid or missing API keys |
| **supabase** | GET to `/rest/v1/` with anon key | Invalid project URLs or anon keys |
| **openai** | GET to `/v1/models` with API key | Invalid or expired API keys |
| **generic** | HEAD request to a configurable URL with auth header | Any token-based API |

## Usage

```bash
# Check all configured credentials
node scripts/credential-health.cjs

# Check specific services
node scripts/credential-health.cjs --check gmail slack attio

# Check Gmail using credentials file (refresh_token-based)
node scripts/credential-health.cjs --check gmail-file

# Check Gmail using a custom credentials file path
node scripts/credential-health.cjs --check gmail-file --token-file /path/to/creds.json

# JSON output (for cron payloads)
node scripts/credential-health.cjs --json

# Fail-only mode (silent unless something is broken)
node scripts/credential-health.cjs --fail-only

# Custom timeout (default 5s)
node scripts/credential-health.cjs --timeout 10

# Add a generic check
node scripts/credential-health.cjs --generic "My API:https://api.example.com/health:Authorization:Bearer $MY_API_KEY"
```

## Environment Variables

Credentials are read from environment variables. The script does NOT read `.env` files automatically — it expects the caller to have them loaded (e.g. via OpenClaw's cron environment, or by sourcing a `.env` first).

| Service | Env var(s) |
|---|---|
| Gmail | `GMAIL_ACCESS_TOKEN` (or `GOOGLE_OAUTH_TOKEN`) |
| Gmail (file) | `~/.openclaw/credentials/gmail.json` (or `--token-file path`) |
| Slack | `SLACK_BOT_TOKEN` |
| Attio | `ATTIO_API_KEY` |
| Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| OpenAI | `OPENAI_API_KEY` |

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | All checked credentials are valid |
| 1 | One or more credentials failed validation |
| 2 | Script error (bad args, missing deps) |

## Output Formats

### Human-readable (default)

```
Credential Health Check
───────────────────────

✅ gmail       Token valid (expires in 58m)
✅ slack       Bot token valid (workspace: Acme)
✅ attio       API key valid

⚠️  supabase   Invalid anon key (401)

Result: 1 failure(s), 3 healthy, 1 untested
```

### JSON (--json)

```json
{
  "timestamp": "2026-04-12T00:53:00.000Z",
  "results": [
    { "service": "gmail", "status": "ok", "detail": "Token valid", "latencyMs": 342 },
    { "service": "supabase", "status": "fail", "detail": "Invalid anon key (401)", "latencyMs": 123 }
  ],
  "summary": { "ok": 3, "fail": 1, "skip": 1 }
}
```

## Integration Patterns

### In a cron payload

```
1. Run: node /path/to/credential-health.cjs --check gmail --fail-only --json
2. If the output contains "fail", reply with: "Gmail token expired — skipping digest."
3. Otherwise proceed with the normal Gmail check workflow.
```

### In HEARTBEAT.md

```
- Before running the Gmail digest, validate credentials:
  Run: node /path/to/credential-health.cjs --check gmail --fail-only
  If any failures, alert Don instead of running the digest.
```

### As a standalone cron job

Create a daily credential health check that alerts when tokens are about to expire:

```json
{
  "name": "Daily credential health",
  "schedule": { "kind": "cron", "expr": "0 6 * * *", "tz": "Europe/Dublin" },
  "payload": {
    "kind": "agentTurn",
    "message": "Run the credential-health script. If anything failed, send a concise alert to WhatsApp. If all OK, reply NO_REPLY."
  }
}
```

## Anti-Patterns

- ❌ Storing credentials in the script — always use env vars
- ❌ Caching validation results across runs — tokens can be revoked between checks
- ❌ Using very short timeouts (< 2s) — some auth endpoints are slow
- ✅ Run checks right before the dependent task, not hours in advance
- ✅ Use `--fail-only` in cron payloads to keep output clean
- ✅ Pair with `--json` for easy LLM parsing in isolated sessions
