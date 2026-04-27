---
name: workspace-housekeeper
description: Keep the agent workspace and system tidy — clean old cron logs, prune stale temp files, rotate large memory files, and flag disk usage before it becomes a problem. Designed for always-on hosts like Raspberry Pi where disk space matters. Use when doing workspace maintenance, flagging disk warnings, cleaning up old artifacts, or proactively preventing disk full scenarios.
tags: [maintenance, workspace, disk, cron, housekeeping, pi]
scripts:
  - scripts/workspace-housekeeper.mjs
---

# Workspace Housekeeper

Lightweight workspace and system housekeeping for always-on agent hosts. Catches disk bloat before it becomes a problem.

## Why

Agents running 24/7 on Raspberry Pis and small VPSes accumulate cruft: cron run logs, temp files, stale downloads, growing memory files. This skill provides a safe, read-first cleanup workflow that reports what it *would* clean, then cleans with confirmation.

## Script

`scripts/workspace-housekeeper.mjs` — Node.js 18+, zero external dependencies.

## Usage

```bash
# Overview: show all categories and sizes
node scripts/workspace-housekeeper.mjs

# Check only (no changes, always safe)
node scripts/workspace-housekeeper.mjs --check

# Auto-clean categories with flags under threshold
node scripts/workspace-housekeeper.mjs --clean

# Clean specific categories
node scripts/workspace-housekeeper.mjs --clean --categories cron-logs,temp-files

# Set disk warning threshold (default 80%)
node scripts/workspace-housekeeper.mjs --threshold 90

# JSON output for programmatic use
node scripts/workspace-housekeeper.mjs --json

# Quiet: only show warnings and errors
node scripts/workspace-housekeeper.mjs --quiet
```

## What It Checks

| Category | What | Default Max Age |
|----------|------|-----------------|
| `disk` | Root partition usage % | — (threshold check) |
| `cron-logs` | OpenClaw cron run history JSONL files | 30 days |
| `temp-files` | `/tmp` and `~/tmp` files older than threshold | 7 days |
| `node-modules` | Unusually large node_modules dirs | — (size warning >500MB) |
| `memory-files` | Daily memory notes — flag files >50KB | — (size warning) |
| `old-logs` | Log files (*.log) older than threshold | 14 days |
| `trash` | Files in trash directories | 30 days |
| `docker` | Docker disk usage (images, volumes, build cache) | — (summary only) |

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--check` | `true` | Show report without making changes |
| `--clean` | `false` | Actually perform cleanup |
| `--categories` | all | Comma-separated list of categories to process |
| `--threshold` | `80` | Disk usage % warning threshold |
| `--dry-run` | — | Alias for `--check` (backwards compat) |
| `--max-age` | varies | Override max age for all categories (days) |
| `--json` | `false` | Output as JSON |
| `--quiet` | `false` | Only warnings and errors |
| `--workspace` | `~/.openclaw/workspace` | Workspace root path |
| `--openclaw-root` | `~/.openclaw` | OpenClaw root path |
| `--help` | | Show usage |

## Output Format

```
🏠 Workspace Housekeeper Report

💾 Disk: 42% used (16.2G / 38.5G) — OK
   ⚠️ /boot: 78% used — approaching threshold

📋 Cron Logs: 142 files, 23.4 MB (18 to clean)
   Would remove: 18 files older than 30 days (12.1 MB)

📂 Temp Files: 8 files, 156 KB (3 to clean)
   Would remove: 3 files older than 7 days (89 KB)

📦 Node Modules: 3 dirs, 890 MB total
   ⚠️ /home/user/project/node_modules — 620 MB (large)

📝 Memory Files: 12 files, 340 KB
   All files under 50 KB — OK

🗑️ Trash: 2 items, 4.2 MB (2 to clean)

🐳 Docker: 1.2 GB total (890 MB images, 210 MB volumes, 100 MB cache)

---
Summary: 23 items to clean (16.4 MB) | 1 warning
Run with --clean to perform cleanup
```

## Safety

- **Default mode is read-only** (`--check`). Nothing happens without `--clean`.
- Only cleans files matching known patterns in known locations.
- Never touches `MEMORY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`, or `.git/`.
- Reports sizes before cleaning so you know what's being removed.
- Uses `fs.unlink` for files, `fs.rm` for directories — no shell `rm -rf`.

## Integration with Heartbeats / Cron

Good as a weekly cron job or occasional heartbeat check:

```bash
# In a cron payload:
# 1. Run: node scripts/workspace-housekeeper.mjs --quiet
# 2. If output contains "warning" or "items to clean", send summary to Don
# 3. Otherwise reply NO_REPLY
```

Or in a heartbeat, run with `--check` and flag if disk is above threshold.
