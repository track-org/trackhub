---
name: workspace-pulse
description: Quick workspace health snapshot — memory freshness, cron health, git status, and file inventory. Use when you want a fast "how's the workspace doing?" check during heartbeats, cron runs, or on demand.
---

# Workspace Pulse

Get a fast health snapshot of an OpenClaw workspace.

## What It Checks

1. **Memory freshness** — MEMORY.md age, daily notes staleness, missing recent days
2. **Cron health** — all cron jobs with status, errors, and warnings
3. **Git status** — trackhub (and workspace if git-tracked): dirty state, unpushed commits
4. **Workspace file inventory** — core files (AGENTS.md, SOUL.md, etc.), memory note count, skill count

## Usage

```bash
# Full report
node workspace-pulse.mjs

# JSON output
node workspace-pulse.mjs --json

# Only warnings/errors
node workspace-pulse.mjs --quiet

# Custom stale threshold (days before "warn")
node workspace-pulse.mjs --stale-days 7

# Skip sections
node workspace-pulse.mjs --no-cron --no-git
```

## Integration

Good fit for heartbeat or cron runs when you want a periodic workspace health check without running multiple commands manually.

## Severity Levels

| Level | Icon | Meaning |
|-------|------|---------|
| fresh | 🟢 | Updated today |
| recent | 🟢 | Updated yesterday |
| ok | 🟡 | Within stale threshold |
| warn | 🟠 | Past stale threshold |
| stale | 🔴 | Well past stale threshold |
| error | 🔴 | Cron job error state |
| disabled | ⚪ | Cron job disabled |

## Auto-Discovery

Automatically finds the workspace by checking `OPENCLAW_WORKSPACE`, `~/.openclaw/workspace`, and walking up from `cwd` looking for `AGENTS.md`.
