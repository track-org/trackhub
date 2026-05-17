---
name: credential-impact
description: >
  One-shot credential failure impact report — chains credential-health detection,
  credential-remediation fix steps, and cron-deps blast radius into a single
  consolidated report. Use when a credential fails and you need a complete picture:
  what broke, what cron jobs are affected, and how to fix it.
---

# Credential Impact Report 💥

When a credential fails, you need three things fast: **what broke**, **what's affected**, and **how to fix it**. This skill chains three existing skills into one shot.

## Why

The credential pipeline is split across three skills:
- `credential-health` — detects failures
- `credential-remediation` — provides fix steps
- `cron-deps` — shows blast radius (which cron jobs are affected)

Running them separately means three commands and manual synthesis. `credential-impact` does it all in one call — perfect for cron job preflight failures, heartbeat alerts, and quick CLI diagnostics.

## Script

`scripts/credential-impact.cjs` — Zero dependencies. Node.js 18+. Requires sibling skills installed.

## Usage

```bash
# Full impact report for all credentials
node credential-impact.cjs

# Check a specific service
node credential-impact.cjs --check gmail-file

# JSON for scripting / piping
node credential-impact.cjs --json

# Quiet mode — failures and impact only
node credential-impact.cjs --quiet
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--check <service>` | | _(all)_ | Only check a specific service (passed to credential-health) |
| `--json` | | false | Output structured JSON |
| `--quiet` | `-q` | false | Only show failures and impact, no header/padding |
| `--help` | `-h` | | Show usage |

## Output Sections (per failure)

1. **🔴 Failure summary** — service name, error detail, severity emoji
2. **🔧 How to fix** — numbered remediation steps from credential-remediation
3. **💥 Blast radius** — affected cron jobs with schedules
4. **🔑 Env vars** — which environment variables to check
5. **📖 Docs link** — relevant documentation URL

## Example Output

```
🔴 Credential Impact Report
════════════════════════════════════════════════

🚨 GMAIL-FILE: Refresh token invalid or revoked: Bad Request
──────────────────────────────────────────────────

🔧 How to fix:
   1. Re-run the OAuth consent flow to get a fresh refresh token.
   2. Check that the OAuth client ID/secret matches the GCP console.
   3. After re-auth, update the token file.
   4. Verify with: node credential-health.cjs --check gmail-file

💥 1 cron job(s) affected:
   • Daily Gmail digest to WhatsApp — 0 9 * * *

🔑 Env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
📖 Docs: https://developers.google.com/identity/protocols/oauth2
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All credentials healthy |
| 1 | One or more failures detected |
| 2 | Invalid args or missing dependencies |

## Integration

This skill is the natural "consolidated report" step in the credential pipeline:

```
credential-health (detect) → credential-impact (consolidated report) → human action
```

Pairs well with:
- **cron-preflight** — use credential-impact instead of raw credential-health in preflight steps for richer failure reports
- **graceful-degradation** — use credential-impact to include fix steps and blast radius in alerts
- **morning-briefing** — include credential impact in daily status reports

## How It Works

1. Runs `credential-health --fail-only --json` to detect failures
2. For each failure, runs `credential-remediation --json` to get fix steps
3. For each failure, runs `cron-deps --blast-radius --json` to find affected cron jobs
4. Consolidates everything into a single report

## Limitations

- Requires sibling skills installed: `credential-health`, `credential-remediation`, `cron-deps`
- Read-only — provides diagnostics, does not fix credentials
- Blast radius is pattern-based — may miss unusual dependency patterns
- Runs three subprocesses per failure — may be slow with many failures
