---
name: repo-watcher
description: Monitor git repos for new commits, branch changes, and tag releases. Supports local repos with automatic fetch. Tracks state for incremental monitoring. Use when checking if a repo has changed, monitoring upstream updates, tracking collaborator pushes, or getting a quick "what changed?" summary across multiple repos.
scripts:
  - repo-watcher.cjs
tags: [git, monitoring, cron, heartbeat]
---

# Repo Watcher

Monitor one or more git repositories for recent activity — new commits, branch updates, and tag releases. Designed for heartbeat and cron use where you want a quick "did anything change?" check without manual git commands.

## Why

Heartbeats and cron jobs often need to check if repos have changed — has someone pushed? Are there new tags for a dependency? Did a collaborator merge something? Doing this ad-hoc with raw git commands in every prompt is wasteful. This skill provides a single command that gives you a structured summary.

## Script

`scripts/repo-watcher.cjs` — Zero dependencies. Node.js 18+. Works with local git repos only.

### How It Works

1. Runs `git fetch --quiet --all` on each repo to get latest remote state
2. Queries commits, branch updates, and new tags within the time window
3. Tracks last-seen state in a JSON file for incremental monitoring
4. Outputs a formatted summary (or raw JSON)

### Requirements

- Local git repos (no remote-only support yet)
- `git` CLI available
- Node.js 18+

### Usage

```bash
# Basic: check a repo for changes in the last 24 hours
node repo-watcher.cjs ~/projects/my-repo

# Multiple repos
node repo-watcher.cjs --repos ~/repo1,~/repo2

# Custom time window
node repo-watcher.cjs ~/trackhub --since 6h
node repo-watcher.cjs ~/trackhub --since 7d

# Filter by branch
node repo-watcher.cjs ~/trackhub --branch main

# Output modes
node repo-watcher.cjs ~/trackhub --mode summary   # one line per repo (default)
node repo-watcher.cjs ~/trackhub --mode detail    # full breakdown with commits
node repo-watcher.cjs ~/trackhub --mode commits   # flat commit list across repos

# JSON output
node repo-watcher.cjs ~/trackhub --json

# Don't update state file (dry run)
node repo-watcher.cjs ~/trackhub --no-update

# Custom state file
node repo-watcher.cjs ~/trackhub --state-file /tmp/watcher-state.json
```

### Flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--repos` | `-r` | Comma-separated repo paths (or pass as positional args) |
| `--since` | `-s` | Time window: `1h`, `6h`, `1d`, `7d`, or ISO date (default: `24h`) |
| `--branch` | `-b` | Filter commits to a specific branch |
| `--mode` | `-m` | `summary` \| `detail` \| `commits` (default: `summary`) |
| `--json` | | Raw JSON output |
| `--state-file` | | Path to state file (default: `~/.openclaw/workspace/memory/repo-watcher-state.json`) |
| `--no-update` | | Don't update the state file after checking |
| `--help` | `-h` | Show help |

### Output Modes

- **summary** — One line per repo: `✅ trackhub | 3 commits | 1 branch update | 1 new tag`
- **detail** — Per-repo section with commit list (hash, author, subject), branch updates, and new tags
- **commits** — Flat list of all commits across repos: `[repo] hash author date — subject`

### State File

Tracks the last-seen commit hash and check timestamp per repo. Stored at `~/.openclaw/workspace/memory/repo-watcher-state.json` by default. Useful for detecting changes between runs.

### Exit Codes

- `0` — All repos checked successfully
- `1` — One or more repos had errors (not found, not a git repo, etc.)

### Integration Tips

- **Heartbeat use:** Add to `HEARTBEAT.md` as a periodic check: `node repo-watcher.cjs ~/trackhub --since 30m --mode summary`
- **Cron use:** Wrap in a cron job for daily repo monitoring across all important repos
- **Alert on changes:** Combine with `smart-notifier` to only alert when new commits appear
- **Dependency tracking:** Watch dependency repos (e.g., `openclaw/openclaw`) to catch updates

### Limitations

- Local repos only (no remote-only clone-and-check support yet)
- `git fetch` requires network access and proper auth for private repos
- Large repos with many branches may be slow
- No webhook/push support — polling only
