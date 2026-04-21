---
name: cron-deps
description: >
  Map dependencies and blast radius between cron jobs — shared credentials, APIs,
  channels, and skill scripts. Shows which jobs would be affected if a credential
  expires or a service goes down. Use when auditing cron job resilience, diagnosing
  cascading failures, understanding the impact of a credential expiry, or getting
  an overview of your scheduled task fleet's dependency graph.
---

# Cron Dependencies & Blast Radius 🗺️

Analyse all OpenClaw cron jobs to map shared resources and compute blast radius for any dependency.

## Why

When a credential expires or an API goes down, you need to know immediately which cron jobs are affected. This skill parses all cron job payloads to extract:

- **Credentials** — OAuth tokens, API keys, env vars referenced in payloads
- **API endpoints** — External services each job depends on
- **Skill scripts** — Which trackhub/workspace skills each job invokes
- **Delivery channels** — Where job output gets sent (Slack, WhatsApp, etc.)
- **Session targets** — Whether jobs run in main or isolated sessions

It then shows blast radius per resource and flags jobs missing preflight checks.

## Script

`scripts/cron-deps.cjs` — Zero external dependencies. Node.js 18+. Requires `openclaw` CLI on PATH.

## Usage

```bash
# Full dependency report (default)
node cron-deps.cjs

# Blast radius: what breaks if Gmail goes down?
node cron-deps.cjs --blast-radius gmail

# Blast radius: what breaks if credential-health script is deleted?
node cron-deps.cjs --blast-radius credential-health

# Group by a specific resource type
node cron-deps.cjs --resource credentials
node cron-deps.cjs --resource channels
node cron-deps.cjs --resource skills
node cron-deps.cjs --resource apis
node cron-deps.cjs --resource session-targets

# Machine-readable output
node cron-deps.cjs --json
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--blast-radius <resource>` | _(none)_ | Show jobs affected if a resource fails. Fuzzy-matches against credentials, APIs, skills, channels, and job names |
| `--resource <type>` | `all` | Group jobs by: `credentials`, `channels`, `skills`, `apis`, `session-targets`, or `all` (full report) |
| `--json` | false | Output structured JSON instead of human-readable report |
| `--help`, `-h` | | Show usage |

## Output Sections (default report)

1. **Summary** — Total jobs, enabled/disabled count
2. **Shared Credentials** — Which credentials are used and by how many jobs (⚠️ flags multi-job credentials)
3. **Shared APIs** — External API endpoints referenced in payloads
4. **Skill Scripts** — Which trackhub/workspace scripts each job calls
5. **Delivery Channels** — Where output gets delivered
6. **Session Targets** — Main vs isolated breakdown
7. **Per-Job Dependencies** — Full breakdown per job
8. **Risk Summary** — Multi-job credential blast radius + jobs missing preflight checks

## How It Works

1. Runs `openclaw cron list --json` to get all job definitions
2. Parses each job's payload text (both `systemEvent.text` and `agentTurn.message`)
3. Extracts dependencies via pattern matching:
   - Credential env vars (`ATTIO_API_KEY`, `GMAIL_ACCESS_TOKEN`, etc.)
   - Preflight `--check` arguments (e.g. `--check attio`)
   - Skill script paths (`trackhub/skills/.../scripts/...`)
   - API domains (`supabase.co`, `googleapis.com`, etc.)
   - Delivery channels from `job.delivery` config
   - Session target and session key hints
4. Builds a resource → jobs mapping
5. Flags jobs that use credentials but lack preflight checks

## Integration

Pairs well with:
- **credential-health** — Validate credentials before computing blast radius
- **cron-preflight** — The preflight pattern this skill checks for
- **cron-dashboard** — Health overview of all jobs
- **cron-first-aid** — Fix jobs flagged as risky

## Examples

### What happens if the Slack bot token expires?

```bash
$ node cron-deps.cjs --blast-radius slack

💥 Blast Radius: "slack"
══════════════════════════════════════

🚨 1 job(s) would be affected:

✅ Attio stage changes to #product
   Schedule: 0 7 * * * | Session: isolated
   Credentials: attio
   Delivers to: slack
```

### Which jobs are missing preflight checks?

The risk summary at the bottom of the default report flags any job that references credentials but doesn't have a `--check` preflight step.

### JSON for scripting

```bash
$ node cron-deps.cjs --json | jq '.resourceMap.credentials'
{
  "solis": ["Solar export WhatsApp nudge"],
  "attio": ["Attio stage changes to #product"],
  "gmail": ["Daily Gmail digest to WhatsApp"],
  "supabase": ["Daily Leaving Cert note"]
}
```

## Limitations

- Read-only — does not modify cron jobs
- Pattern-based detection — may miss custom or unusual credential patterns
- Does not resolve dynamic credential loading (e.g., scripts that read env vars internally)
- Blast radius uses fuzzy substring matching — may match unintended resources for short names (use specific names like "gmail-file" instead of "gmail" to narrow)
- Requires `openclaw` CLI accessible on PATH
