---
name: git-diff-summary
description: Generate a clean, categorized summary of git diffs or file changes. Use when reviewing what changed in a commit, branch, PR, or working directory. Covers staged, unstaged, committed, and arbitrary ref ranges. Outputs grouped by category (added/modified/deleted/renamed) with file paths, stats, and optional content excerpts.
skill-type: standard
category: git
tags: [git, diff, summary, review, changelog, code-review]
suggested-connectors: []
suggested-job-type: manual
available-scripts:
  - name: git-diff-summary.cjs
    description: Generate a categorized summary of git changes
---

# Git Diff Summary 📋

Turn messy git diffs into clean, structured summaries.

## Why

Agents and humans need to quickly understand what changed — without reading raw diffs. This skill gives you a one-command summary grouped by change type, with file stats and optional content excerpts.

## How to Run

```bash
# Working directory changes (unstaged)
node scripts/git-diff-summary.cjs

# Staged changes
node scripts/git-diff-summary.cjs --staged

# Last commit
node scripts/git-diff-summary.cjs --last

# Commit range
node scripts/git-diff-summary.cjs --ref main..HEAD

# Specific commit
node scripts/git-diff-summary.cjs --ref abc123

# Only show file names (no excerpts)
node scripts/git-diff-summary.cjs --names-only

# Machine-readable JSON
node scripts/git-diff-summary.cjs --json
```

## Output Format

Groups changes by category:
- **Added** — new files
- **Modified** — changed files (with line stats)
- **Deleted** — removed files
- **Renamed** — files that moved (with old → new path)
- **Untracked** — new files not yet tracked by git

Each entry shows:
- File path (relative to repo root)
- Lines added/removed (for modifications)
- Brief excerpt of what changed (unless `--names-only`)

## When to Use This

- Cron job detected changes and needs to report them
- Reviewing a branch before merging
- Quick "what did I change?" check
- Feeding change context into another skill (changelog, PR description)
- Proactive monitoring (watch a repo and summarize new commits)

## Integration Tips

- Pipe into `quick-reports` skill for Slack/Discord delivery
- Combine with `git-changelog` for release notes
- Use `--json` for downstream processing in other scripts
- Use in cron payloads that monitor repo health
