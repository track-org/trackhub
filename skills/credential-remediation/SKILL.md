---
name: credential-remediation
description: >
  Provide actionable remediation steps when credential-health detects a failure.
  Maps specific error messages to fix procedures for common services (Gmail OAuth,
  Slack tokens, API keys, Supabase, Emporia, Solis, and more). Pairs with
  credential-health (detection) and graceful-degradation (response).
---

# Credential Remediation 🔧

Get clear, actionable fix steps when a credential check fails. Instead of "something's broken," you get "here's exactly how to fix it."

## Why

`credential-health` tells you *what* broke. `graceful-degradation` tells you *what to do about it* at a system level (alert, retry, skip). But neither tells the human *how to actually fix the credential*. This skill bridges that gap.

## Script

`scripts/remediate.cjs` — Zero dependencies. Node.js 18+.

## Usage

```bash
# Direct: specify the service
node remediate.cjs --service gmail --detail "Refresh token invalid or revoked: Bad Request"

# Quick: just the service name
node remediate.cjs --service slack

# Pipe from credential-health
node credential-health.cjs --check gmail-file --fail-only --json | node remediate.cjs --stdin

# Quiet mode: only steps, no fluff
node remediate.cjs --service attio --detail "401 unauthorized" --quiet

# JSON for programmatic use
node remediate.cjs --service gmail --json

# Multiple failures from stdin
node credential-health.cjs --fail-only --json | node remediate.cjs --stdin --json
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--service` | `-s` | *(required unless --stdin)* | Service name (e.g. gmail, slack, attio) |
| `--detail` | `-d` | `""` | Error detail from credential-health (improves matching) |
| `--json` | | false | Output as JSON |
| `--quiet` | `-q` | false | Only show fix steps, no header/severity |
| `--stdin` | | false | Read failures from credential-health JSON via pipe |
| `--help` | `-h` | | Show usage |

## Supported Services

| Service | Covered Issues |
|---------|---------------|
| **Gmail** | OAuth refresh token invalid/revoked, credential file missing |
| **Slack** | Bot token invalid/expired, account inactive |
| **Attio** | API key invalid/forbidden |
| **Supabase** | Anon/service key invalid, JWT expired |
| **OpenAI** | API key incorrect/expired |
| **Emporia** | Login/auth failure |
| **Solis** | Token expired, auth failure |
| **Generic** | Network connectivity, DNS, timeout, proxy issues |
| **Fallback** | Any unknown service gets sensible default steps |

## Matching Logic

The script uses a three-pass matching system:

1. **Exact service + error pattern** — best match (e.g. "gmail" + "refresh token")
2. **Keyword-only match** — broader (e.g. "gmail" + "oauth" in any context)
3. **Generic network patterns** — catches connectivity issues regardless of service
4. **Fallback** — unknown services get a sensible generic remediation

## Integration with Other Skills

### Credential Health Pipeline

```
credential-health (detect) → credential-remediation (fix) → graceful-degradation (respond)
```

### In Cron Jobs

After a credential-health check fails, use remediation to include fix steps in the alert:

```
1. Run: node credential-health.cjs --check gmail --fail-only --json
2. If failures found, run: node credential-health.cjs --check gmail --fail-only --json | node remediate.cjs --stdin
3. Include the remediation steps in the alert message to Don.
```

### In Heartbeat Checks

When a credential-health check fails during a heartbeat, the agent can use this skill to give Don concrete next steps instead of just "your token is broken."

## Output Example

```
🔴 Gmail OAuth Refresh Token Invalid or Revoked
   Severity: HIGH
   Env vars to check: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN

   Steps to fix:
   1. Re-run the OAuth consent flow to get a fresh refresh token.
   2. If using a GCP service account, verify the JSON key file exists and is readable.
   3. Check that the OAuth client ID/secret in your config matches the GCP console.
   4. If the token was revoked, the user must re-authorize the app at: https://accounts.google.com/o/oauth2/v2/auth
   5. After re-auth, update the token file with the new credentials.
   6. Verify with: node credential-health.cjs --check gmail-file

   📖 Docs: https://developers.google.com/identity/protocols/oauth2
```

## Extending

To add a new service, append an entry to the `remediationDB` array in the script:

```js
{
  service: 'stripe',
  keywords: ['stripe', 'api key', 'authentication'],
  error_patterns: ['401', 'invalid_api_key', 'authentication_error'],
  severity: 'high',
  title: 'Stripe API Key Invalid',
  steps: [
    'Go to https://dashboard.stripe.com/apikeys to verify your keys.',
    '...',
  ],
  env_vars: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'],
  docs_url: 'https://docs.stripe.com/api/authentication',
}
```

## Limitations

- Read-only — provides guidance, does not automatically fix credentials
- Service coverage is limited to what's in the remediation database
- Cannot re-authenticate OAuth flows (requires human interaction)
- No integration with credential rotation APIs (future enhancement)
