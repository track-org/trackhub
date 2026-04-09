# env-validator

Validate required environment variables before skill scripts run.

## Description

Check that required environment variables are set, non-empty, and optionally match expected formats (URLs, email addresses, API keys, file paths, numeric ranges). Returns structured JSON or human-readable output with pass/fail per variable. Useful as a pre-flight check in cron jobs, heartbeat routines, or any skill that depends on external config.

Catches the class of bugs where a skill silently degrades because `ATTIO_API_KEY` or `SLACK_BOT_TOKEN` isn't set — the kind of thing that shows up as a vague warning deep in a cron run summary.

## Script

`scripts/env-validator.mjs` — Node.js, zero external dependencies. Uses shared-lib for arg parsing and output formatting.

## Usage

```bash
# Validate from a manifest file (recommended)
node scripts/env-validator.mjs --manifest ./env-check.json

# Validate specific vars inline
node scripts/env-validator.mjs --vars ATTIO_API_KEY,SLACK_BOT_TOKEN,SOLIS_INVERTER_SN

# Validate with format rules
node scripts/env-validator.mjs --vars SOLIS_API_URL --format SOLIS_API_URL:url

# Custom env file (e.g. .env)
node scripts/env-validator.mjs --vars DATABASE_URL --env-file .env

# JSON output for scripting
node scripts/env-validator.mjs --manifest ./env-check.json --json

# Quiet: only output failures
node scripts/env-validator.mjs --manifest ./env-check.json --quiet

# Exit code: 0 = all pass, 1 = any fail
```

## Manifest Format

A JSON file listing variables and optional validation rules:

```json
{
  "variables": {
    "ATTIO_API_KEY": {
      "description": "Attio CRM API key",
      "required": true
    },
    "ATTIO_SCHEMA": {
      "description": "Path to Attio schema JSON for fuzzy matching",
      "required": false,
      "warnIfMissing": true
    },
    "SOLIS_API_URL": {
      "description": "Solis Cloud API base URL",
      "required": true,
      "format": "url"
    },
    "SOLIS_INVERTER_SN": {
      "description": "Solis inverter serial number",
      "required": true,
      "minLength": 8
    },
    "SUPABASE_URL": {
      "description": "Supabase project URL",
      "required": true,
      "format": "url"
    },
    "SUPABASE_ANON_KEY": {
      "description": "Supabase anon/public key",
      "required": true,
      "minLength": 20
    },
    "SLACK_BOT_TOKEN": {
      "description": "Slack bot token (xoxb-...)",
      "required": false,
      "pattern": "^xoxb-"
    },
    "GMAIL_CLIENT_ID": {
      "description": "Google OAuth client ID",
      "required": false
    },
    "GMAIL_REFRESH_TOKEN": {
      "description": "Google OAuth refresh token",
      "required": false
    }
  }
}
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--manifest <path>` | — | Path to JSON manifest file |
| `--vars <list>` | — | Comma-separated list of env var names (no manifest needed) |
| `--format <var>:<type>` | — | Format rule for inline vars (`url`, `email`, `numeric`, `filepath`) |
| `--pattern <var>:<regex>` | — | Regex pattern the value must match |
| `--env-file <path>` | — | Load vars from a `.env` file instead of process.env |
| `--json` | `false` | Output as JSON |
| `--quiet` | `false` | Only show failures and warnings |
| `--strict` | `false` | Treat warnings as failures (exit 1) |

## Validation Rules

For each variable, the following checks apply in order:

1. **Required check**: If `required: true`, the variable must be set and non-empty
2. **Warn if missing**: If `warnIfMissing: true`, log a warning but don't fail
3. **Format check**: If `format` is set, validate against known patterns:
   - `url` — must start with `http://` or `https://`
   - `email` — basic email pattern
   - `numeric` — parseable as a number
   - `filepath` — file exists on disk (if absolute) or not empty (if relative)
4. **Pattern check**: If `pattern` is set, value must match the regex
5. **Min/Max length**: If `minLength` or `maxLength` set, enforce length bounds

## Output Examples

### Human-readable (default)

```
✅ ATTIO_API_KEY         present (44 chars)
⚠️  ATTIO_SCHEMA         not set (optional, but recommended)
✅ SOLIS_API_URL         present (valid url)
✅ SUPABASE_URL          present (valid url)
✅ SUPABASE_ANON_KEY     present (178 chars)
❌ GMAIL_CLIENT_ID       not set (required)
❌ GMAIL_REFRESH_TOKEN   not set (required)

Result: 4 passed, 2 failed, 1 warning
```

### JSON

```json
{
  "passed": ["ATTIO_API_KEY", "SOLIS_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"],
  "failed": ["GMAIL_CLIENT_ID", "GMAIL_REFRESH_TOKEN"],
  "warnings": ["ATTIO_SCHEMA"],
  "all": {
    "ATTIO_API_KEY": { "status": "pass", "present": true, "length": 44 },
    "ATTIO_SCHEMA": { "status": "warn", "present": false, "reason": "optional but recommended" },
    "SOLIS_API_URL": { "status": "pass", "present": true, "format": "url", "valid": true },
    "GMAIL_CLIENT_ID": { "status": "fail", "present": false, "reason": "required" }
  },
  "exit": 1
}
```

## Use in Cron Jobs

Add a pre-flight check to any cron payload that depends on env vars:

```json
{
  "payload": {
    "kind": "agentTurn",
    "message": "Run env-validator first: `node scripts/env-validator.mjs --manifest ./env-check.json --quiet`. If any failures, report them and stop. Otherwise proceed with the main task."
  }
}
```

## Dependencies

- `shared-lib` — arg parsing (`args.mjs`) and output formatting (`fmt.mjs`)
- Node.js 18+ (no external packages)
