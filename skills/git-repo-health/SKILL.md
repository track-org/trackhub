---
name: git-repo-health
description: Quick health check for git repositories — working tree status, unpushed commits, behind remote, detached HEAD, stashes, and untracked files. Use when checking if a repo is clean, verifying push status before a deploy, getting a summary of multiple repos, or during heartbeats to proactively spot repo issues. Supports single or multi-repo checks with human-readable or JSON output.
---

# Git Repo Health

Fast, zero-dependency health check for one or more git repositories.

## Script

`scripts/git-repo-health.sh` — Bash, requires only `git` (and `jq` for `--json`).

## Usage

```bash
# Check current directory
bash git-repo-health.sh

# Check specific repos
bash git-repo-health.sh ~/projects/app ~/projects/lib

# JSON output (for programmatic use, heartbeats, cron)
bash git-repo-health.sh --json ~/projects/app

# Quiet: only show repos with issues
bash git-repo-health.sh --quiet ~/projects/*

# Verbose: include last commit info
bash git-repo-health.sh --verbose ~/projects/app
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | false | JSON array output (requires `jq`) |
| `--quiet` | false | Only show repos with warnings or issues |
| `--verbose` | false | Include last commit hash, message, and relative time |
| `--help` | | Show usage |

## Checks Performed

- **Behind remote**: commits on upstream not in local branch (treated as issue)
- **Unpushed commits**: local commits not on upstream (warning)
- **No tracking branch**: branch has no upstream configured (warning)
- **Staged/unstaged changes**: dirty working tree (warning)
- **Untracked files**: informational only
- **Stashes**: informational only
- **Detached HEAD**: treated as issue
- **Not a git repo**: treated as issue

## Exit Codes

- `0` — all repos clean
- `1` — one or more repos have issues
- `2` — usage error

## JSON Output Format

```json
[
  {
    "repo": "my-project",
    "branch": "main",
    "status": "clean|warnings|issues",
    "issues": ["3 commit(s) behind remote"],
    "warnings": ["2 unpushed commit(s)", "1 staged file(s)"],
    "info": ["4 untracked file(s)", "1 stash(es)"]
  }
]
```

## Integration with Heartbeat

Useful during heartbeats to verify workspace repos are clean before nightly builds:

```bash
bash git-repo-health.sh --json --quiet ~/workspace/repo1 ~/workspace/repo2
```

Parse the JSON to decide whether to alert or proceed silently.
