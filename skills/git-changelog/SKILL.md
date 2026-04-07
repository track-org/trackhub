---
name: git-changelog
description: Generate a clean, platform-friendly changelog from git history. Use when you need to summarise recent commits, notify a channel about trackhub changes, or create release notes. Supports Slack, Discord, and compact formats with scope/type filtering.
skill-type: standard
category: dev-tools
tags: [git, changelog, release-notes, slack, discord, conventional-commits]
suggested-connectors: []
suggested-job-type: manual
available-scripts:
  - name: git-changelog
    description: Generate a formatted changelog from git history
---

# Git Changelog 📦

Generate clean, readable changelogs from git history. Optimised for sharing in Slack/Discord after pushing to trackhub or other repos.

## Why

After committing to trackhub, you need to tell Colamari (or Don) what changed. Instead of pasting raw `git log` output, this formats commits into a grouped, emoji-rich changelog that's ready to paste into any chat platform.

## How to Run

```bash
node scripts/git-changelog.mjs                          # Last 20 commits, grouped by type
node scripts/git-changelog.mjs --commits 10              # Last 10 commits
node scripts/git-changelog.mjs --since "3 days ago"      # Commits from last 3 days
node scripts/git-changelog.mjs --since v1.0.0            # Commits since a tag
node scripts/git-changelog.mjs --format slack            # Slack-formatted output
node scripts/git-changelog.mjs --format discord          # Discord-formatted output
node scripts/git-changelog.mjs --format compact          # One line per commit
node scripts/git-changelog.mjs --scope attio-crm         # Filter by conventional commit scope
node scripts/git-changelog.mjs --type feat               # Filter by type (feat, fix, docs, etc.)
node scripts/git-changelog.mjs --json                    # Raw JSON output
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--since <ref/date>` | all history | Start ref, tag, or date expression |
| `--until <ref/date>` | HEAD | End ref or date |
| `--commits <n>` | 20 | Max commits to include |
| `--scope <name>` | — | Filter by conventional commit scope |
| `--type <type>` | — | Filter by commit type (feat, fix, docs, refactor, ...) |
| `--format <fmt>` | default | Output format: `default`, `slack`, `discord`, `compact` |
| `--path <path>` | — | Only show changes touching this path |
| `--no-merges` | true | Exclude merge commits |
| `--json` | false | Output as JSON |

## Output Formats

### Default
Grouped by type with section headers. Good for terminal output and general use.

```
✨ Features
  • [workspace-pulse] add workspace health snapshot skill (f84ba08, 1d ago)

📝 Documentation
  • [emporia-energy] polish SKILL.md (70c05c1, 2d ago)
```

### Slack
Uses Slack's `*bold*` and `` `code` `` formatting. Ready to paste.

```
📦 *Changelog* — 3 commits

✨ *Features*
• `workspace-pulse` add workspace health snapshot skill — `f84ba08`
```

### Discord
Uses Discord's `**bold**` and `` `code` `` formatting.

### Compact
One line per commit with emoji type prefix. Good for quick scanning.

```
✨ feat(workspace-pulse): add workspace health snapshot skill [f84ba08]
```

## Type Emojis

| Type | Emoji | Label |
|------|-------|-------|
| feat | ✨ | Features |
| fix | 🐛 | Bug Fixes |
| docs | 📝 | Documentation |
| refactor | ♻️ | Refactoring |
| perf | ⚡ | Performance |
| chore | 🔧 | Maintenance |
| test | 🧪 | Tests |
| ci | 🔄 | CI/CD |
| other | 📌 | Other |

## Use After Pushing to TrackHub

After committing and pushing a trackhub change, generate a changelog to share:

```bash
# Get changes since last push
node scripts/git-changelog.mjs --since "2 hours ago" --format slack
```

Then paste the output into the shared channel when notifying Colamari.

## Dependencies

- `git` CLI (must be on PATH)
- Node.js 18+
- `shared-lib` for argument parsing and output formatting

## JSON Output Schema

```json
[
  {
    "hash": "f84ba082...",
    "shortHash": "f84ba08",
    "author": "shelldon",
    "date": "2026-04-07T00:22:35+01:00",
    "type": "feat",
    "scope": "workspace-pulse",
    "subject": "add workspace health snapshot skill"
  }
]
```
