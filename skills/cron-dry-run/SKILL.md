---
name: cron-dry-run
description: "Simulate executing a cron job payload without side effects. Parses the payload, traces what scripts/APIs/credentials it would use, validates prerequisites (script existence, preflight checks, delivery config, schedule sanity), and reports what would happen — all without actually running the job or sending any messages. Use when testing new payloads, verifying edits, debugging unexpected behaviour, or validating payloads before registration."
---

# cron-dry-run 🔍

Simulate a cron job execution: parse the payload, extract dependencies, validate
prerequisites, and report what would happen — without side effects.

## Why

Before registering a new cron job or editing an existing one, it's useful to know:
- Does the script it references actually exist?
- Are there credentials it needs but no preflight check?
- What APIs and services would it hit?
- Where would output be delivered?

Running the job to find out is risky and wastes tokens. `cron-dry-run` answers all
of these statically, from the payload text alone.

## Script

`scripts/cron-dry-run.cjs` — Zero dependencies. Node.js 18+. Requires `openclaw` CLI on PATH (only when using `--job`).

## Usage

```bash
# Dry-run a live job by name or ID
node cron-dry-run.cjs --job "Solar export WhatsApp nudge"
node cron-dry-run.cjs --job abc-123-def --verbose

# Dry-run from a backup file
node cron-dry-run.cjs --file backup.json

# Pipe a job definition via stdin
echo '{"name":"test",...}' | node cron-dry-run.cjs --stdin

# Analyse a raw payload string
node cron-dry-run.cjs --payload "Run credential-health --check gmail"

# JSON output for scripting
node cron-dry-run.cjs --job "Attio stage changes" --json
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--job <id\|name>` | _(none)_ | Job ID or fuzzy name from the live fleet |
| `--file <path>` | _(none)_ | Read job JSON from a file (cron-backup export format) |
| `--stdin` | false | Read job JSON from stdin |
| `--payload <text>` | _(none)_ | Analyse a raw payload string inline |
| `--verbose` | false | Show full payload preview and command details |
| `--json` | false | Output structured JSON |
| `-h, --help` | | Show usage |

## Output Sections

1. **Verdict** — `would-run-clean`, `would-run-with-warnings`, or `would-fail`
2. **Checks** — Each dependency and config point validated:
   - Script existence (does the file exist on disk?)
   - Preflight coverage (credentials used but no `--check`?)
   - Delivery config (configured or relies on agent?)
   - Schedule sanity (cron expression + timezone)
   - Job status (enabled or disabled?)
   - Payload content (non-empty?)
3. **Dependencies detected** — Scripts, credentials, APIs, channels
4. **Commands that would execute** — Extracted CLI commands from payload
5. **Payload preview** (verbose mode only)

## How It Works

1. Resolves the job definition from fleet, file, stdin, or raw payload
2. Extracts payload text from `systemEvent.text`, `agentTurn.message`, or inline
3. Pattern-matches to find: script paths, CLI commands, credential keywords, API domains, channel references
4. Validates: script files exist on disk, preflight checks cover referenced credentials, delivery is configured
5. Produces a simulation report with verdict and detailed checks

## Integration

Pairs well with:
- **cron-payload-lint** — Validate payload JSON structure before dry-running
- **cron-backup** — Export jobs to files, then dry-run from the backup
- **cron-quick-add** — Generate a payload, then dry-run it before registering
- **cron-first-aid** — For jobs that actually failed, use first-aid; for prevention, use dry-run

## Limitations

- Static analysis only — does not execute scripts or call APIs
- Pattern-based — may miss unusual dependency patterns
- Script existence check uses local filesystem — may differ from production
- Does not validate credential tokens themselves (use credential-health for that)
- No simulation of agent reasoning — only traces the payload's explicit instructions
