---
name: git-activity-summary
description: >
  Summarise git activity across one or more repos — commit frequency, author breakdown,
  active branches, file change stats, and trend analysis. Use when answering "what happened
  in this repo recently?", "who's been committing?", or generating standup/briefing notes
  from git history. Supports multiple repos, date ranges, author filtering, and multiple
  output formats including a standup-ready briefing mode.
skill-type: standard
category: dev-tools
tags: [git, activity, summary, standup, briefing, analytics, commits]
suggested-connectors: []
suggested-job-type: manual
available-scripts:
  - name: git-activity-summary
    description: Analyse git activity and output a formatted summary
---

# Git Activity Summary 📊

Summarise git activity across one or more repos with rich stats: commit frequency, author breakdown, commit type distribution, day-of-week patterns, active branches, and uncommitted work.

Designed for standup notes, daily briefings, heartbeat summaries, and "what's been happening?" queries.

## Why

`git log` gives raw commit data. `git-changelog` formats release notes. But neither answers questions like:

- "What was I working on this past week?"
- "Who's been committing most to this repo?"
- "Give me a standup briefing from git history."
- "How active has this project been lately?"

This skill fills that gap — it's a conversational git analytics tool, not a release notes formatter.

## Script

`scripts/git-activity-summary.cjs` — Zero dependencies. Node.js 18+. Uses `git` CLI.

## Usage

```bash
# Analyse current directory
node scripts/git-activity-summary.cjs .

# Analyse a specific repo
node scripts/git-activity-summary.cjs /path/to/repo

# Multiple repos at once
node scripts/git-activity-summary.cjs -r ./repo1 -r ./repo2

# Time range
node scripts/git-activity-summary.cjs . --since "1 week ago"
node scripts/git-activity-summary.cjs . --since "2026-04-01" --until "2026-04-15"

# Filter by author
node scripts/git-activity-summary.cjs . --author shelldon

# Output formats
node scripts/git-activity-summary.cjs . --format default    # Rich visual summary (default)
node scripts/git-activity-summary.cjs . --format compact    # One line per repo
node scripts/git-activity-summary.cjs . --format briefing   # Standup-ready briefing

# Include individual commits
node scripts/git-activity-summary.cjs . --verbose

# JSON for programmatic use
node scripts/git-activity-summary.cjs . --json
```

## Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--repo` | `-r` | cwd | Repo path(s) — can specify multiple times or as positional args |
| `--since` | `-s` | all history | Start of range (e.g. `"1 week ago"`, `"2026-04-01"`) |
| `--until` | `-u` | HEAD | End of range |
| `--author` | `-a` | all | Filter commits by author name |
| `--branch` | `-b` | default | Filter by branch |
| `--format` | `-f` | default | Output format: `default`, `compact`, `briefing` |
| `--top` | `-n` | 5 | Number of top authors to display |
| `--json` | | false | Output as JSON |
| `--verbose` | `-v` | false | Include individual commit details |
| `--help` | `-h` | | Show usage |

## Output Formats

### Default
Rich visual summary with bar charts, author breakdown, commit types, day-of-week patterns, and branch info.

```
📊 trackhub — 47 commits
  📅 10 Apr → 24 Apr
  📝 2.1k+ 800- across 120 files
  👥 Authors:
     shelldon         ████████████ 32
     colamari          ██████ 12
     don               ███ 3
  🏷️  Types:
     ✨ feat          18
     📝 docs          12
     🐛 fix           8
  📆 By day:
     Mon  ████████ 12
     Wed  ██████ 9
     Fri  ████ 6
  🌿 Branches: main, feature/new-skill, fix/cron-timing
```

### Compact
One line per repo. Good for quick heartbeat checks or combining into larger reports.

```
trackhub: 47 commits | 2.1k+ 800- | shelldon (32), colamari (12), don (3)
```

### Briefing
Human-readable standup format. Good for daily summaries or sharing with a team.

```
📋 Git Activity Briefing — Friday, 24 April 2026

**trackhub**
  Activity by: shelldon, colamari (47 commits)
  Latest:
  • feat(repo-watcher): monitor local repos for changes (Apr 24)
  • fix(cron-preflight): detect gmail-file credential type (Apr 23)
  • feat(cron-scheduler): analyse timing conflicts (Apr 22)
  Net: +1.3k lines across 120 files
```

## JSON Output Schema

```json
[
  {
    "repo": "trackhub",
    "path": "/home/user/trackhub",
    "totalCommits": 47,
    "totals": { "filesChanged": 120, "insertions": 2100, "deletions": 800 },
    "authors": [
      { "name": "shelldon", "count": 32, "insertions": 1800, "deletions": 600 },
      { "name": "colamari", "count": 12, "insertions": 250, "deletions": 150 }
    ],
    "days": { "Mon": 12, "Tue": 5, "Wed": 9, "Thu": 8, "Fri": 6 },
    "hours": { "00:00": 5, "07:00": 3, "12:00": 8, "23:00": 12 },
    "types": { "feat": 18, "docs": 12, "fix": 8 },
    "branches": ["main", "feature/new-skill", "fix/cron-timing"],
    "stashes": 0,
    "uncommitted": { "modified": 2, "untracked": 1 },
    "commits": []
  }
]
```

## Integration with Other Skills

- **git-changelog** — Use this for formatted release notes; use `git-activity-summary` for analytics/briefings.
- **git-diff-summary** — For detailed per-file change analysis; use this for aggregate stats.
- **git-repo-health** — For working tree status checks; this skill includes uncommitted work as a bonus.
- **session-digest** — Could feed JSON output into daily cron digest reports.
- **heartbeat-checklist** — Good for periodic "what's been happening?" checks during heartbeats.

## Dependencies

- `git` CLI (must be on PATH)
- Node.js 18+
- No npm dependencies

## Limitations

- Relies on `git log --shortstat` which may be slow on very large repos with long histories — use `--since` to limit range.
- Branch listing caps at 10 for readability.
- Author matching is exact string match on commit author field.
- Thread replies in commit messages are not parsed.
- Merge commits are excluded by default.
