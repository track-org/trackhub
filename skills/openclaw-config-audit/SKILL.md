---
name: openclaw-config-audit
description: >
  Audit an OpenClaw configuration file for common issues — missing credentials,
  invalid model references, channel misconfigurations, stale tokens, unused skills,
  and security concerns. Use when validating an OpenClaw setup, debugging config
  problems, onboarding a new installation, or during proactive health checks.
skill-type: standard
category: agent-ops
tags: [config, audit, validation, health-check, openclaw, setup]
suggested-connectors: []
suggested-job-type: heartbeat
available-scripts:
  - name: openclaw-config-audit
    description: Run a full audit of the OpenClaw config file
---

# OpenClaw Config Audit 🔍

One-command health check for your `openclaw.json` configuration. Catches common misconfigurations, missing credentials, invalid model references, and security concerns before they cause silent failures.

## Why

OpenClaw configs grow over time — channels get added, models change, tokens expire. A stale or misconfigured setting can cause silent failures that are hard to debug. This skill gives you a quick "config hygiene" report in one shot.

## What It Checks

### Credentials & Auth
- **Channel tokens** — Slack bot token present and valid format (`xoxb-`), WhatsApp config present
- **Auth profiles** — configured auth providers have required fields
- **Token freshness** — warns if `lastTouchedAt` is very old (may indicate stale setup)

### Models
- **Provider config** — at least one model provider configured
- **Default model** — default model reference resolves to a known provider entry
- **Model format** — model IDs follow expected format (`provider/model` or alias)
- **API keys** — providers with API key requirements have keys set (non-empty)

### Channels
- **Enabled channels** — at least one channel is enabled
- **Channel completeness** — enabled channels have required fields (tokens, webhook paths, etc.)
- **Group policy** — warns if group policy is very open on external channels
- **Stream config** — flags streaming enabled without native streaming support

### Gateway
- **Port** — reasonable port range
- **Auth** — gateway auth configured (not wide open)
- **Tailscale** — if enabled, checks for common issues
- **Nodes** — remote nodes have required connection fields

### Skills
- **Load paths** — skill load paths exist on disk
- **Skill entries** — declared skill entries have SKILL.md files
- **Duplicate skills** — flags skills loaded from multiple paths

### Security
- **Control UI** — warns if control UI is enabled without auth
- **Gateway bind** — warns if bound to 0.0.0.0 without auth
- **Trusted proxies** — flags overly permissive proxy settings
- **Tool profiles** — flags if all tools are unrestricted

### General
- **Config version** — `lastTouchedVersion` matches installed OpenClaw version (if detectable)
- **Unknown keys** — flags top-level keys not in the known schema (may be typos or deprecated)

## Script

`scripts/openclaw-config-audit.cjs` — Zero dependencies. Node.js 18+.

## Usage

```bash
# Full audit of default config location
node scripts/openclaw-config-audit.cjs

# Specify a config file
node scripts/openclaw-config-audit.cjs --config /path/to/openclaw.json

# JSON output for programmatic use
node scripts/openclaw-config-audit.cjs --json

# Only show warnings and errors (suppress info)
node scripts/openclaw-config-audit.cjs --fail-only

# Quiet mode: exit code only (0=clean, 1=warnings, 2=errors)
node scripts/openclaw-config-audit.cjs --quiet

# Check specific categories only
node scripts/openclaw-config-audit.cjs --check credentials
node scripts/openclaw-config-audit.cjs --check security,models
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--config` | `-c` | `~/.openclaw/openclaw.json` | Path to OpenClaw config file |
| `--check` | | *(all)* | Only check specific categories: `credentials`, `models`, `channels`, `gateway`, `skills`, `security`, `general` |
| `--json` | | false | Output as JSON |
| `--fail-only` | | false | Only show warnings and errors |
| `--quiet` | `-q` | false | No output, exit code only |
| `--help` | `-h` | | Show usage |

## Output Format (default)

```
══ OpenClaw Config Audit ══
~/.openclaw/openclaw.json
OpenClaw v0.x.x · Linux arm64

  ✅ Credentials — Slack bot token present, WhatsApp configured
  ⚠️ Models — No API key set for provider "openai"
  ✅ Channels — 2 channels configured, both enabled
  ⚠️ Gateway — Control UI enabled without auth
  ✅ Skills — 8 skill entries, all loadable
  ✅ Security — Gateway auth configured, reasonable tool profile
  ℹ️ General — Config last touched v0.42.0, 3 unknown top-level keys

Summary: 4 ok · 2 warnings · 0 errors
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All checks passed (or quiet mode with no warnings) |
| 1 | One or more warnings |
| 2 | One or more errors |

## Integration with Heartbeats

```bash
# Quick check — only alert if something's wrong
node scripts/openclaw-config-audit.cjs --quiet
# Exit 0 → fine, exit 1/2 → investigate
```

## Integration with Cron

```json
{
  "name": "Weekly config audit",
  "schedule": { "kind": "cron", "expr": "0 3 * * 1", "tz": "Europe/Dublin" },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Run the openclaw-config-audit skill. If warnings or errors found, send summary to Don via Slack."
  }
}
```

## Limitations

- Read-only — never modifies the config file
- Cannot validate API keys are *working* (only that they're present) — pair with `credential-health` for live checks
- Token format checks are heuristic (e.g., `xoxb-` prefix for Slack)
- Skill path checks use the local filesystem — may differ across nodes
- Does not validate cron job configurations (use `cron-health` for that)
