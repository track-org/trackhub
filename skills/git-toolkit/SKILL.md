---
name: git-toolkit
description: >
  Unified meta-skill that discovers and routes to all git-related skills in the
  trackhub catalogue. Use when the agent needs to do something git-related but
  isn't sure which skill to use, or wants a quick overview of available git tools.
  Provides smart routing based on natural language intent.
---

# Git Toolkit 🛠️

One command to discover and route to any git skill in the trackhub catalogue.
Instead of remembering six different skill names, describe what you need and
git-toolkit figures out the right one.

## Why

TrackHub has a rich set of git skills — activity summaries, changelogs, diffs,
file history, repo health, and workflow conventions. That's great when you know
exactly which one to use, but when you just need "something git-related", you
have to search through six SKILL.md files to figure it out.

git-toolkit solves that by being a single entry point with intent-based routing.
Say what you need in plain English and it tells you which skill handles it.

## How It Works

1. You describe what you need: `git-toolkit -- who changed this file`
2. It matches your intent against all registered git skills using keyword scoring
3. It returns the skill name, description, and (if available) the script path
4. You then invoke the specific skill normally

It does **not** execute the underlying skill — it routes you to it. This keeps
things simple and avoids double-wrapping.

## Script

`scripts/git-toolkit.cjs` — Zero dependencies. Node.js 18+.

## Usage

```bash
# List all git skills
node git-toolkit.cjs --list

# List as JSON
node git-toolkit.cjs --list --json

# Intent-based routing — describe what you need
node git-toolkit.cjs -- who changed src/index.js
node git-toolkit.cjs -- standup summary for trackhub
node git-toolkit.cjs -- is this repo clean
node git-toolkit.cjs -- what changed in HEAD~3
node git-toolkit.cjs -- release notes
node git-toolkit.cjs -- blame README.md

# Exact skill name
node git-toolkit.cjs -- git-file-history
node git-toolkit.cjs -- git-repo-health

# JSON output for programmatic use
node git-toolkit.cjs -- diff in ./repo --json
```

## Registered Skills

| Skill | Keywords | Has Script |
|-------|----------|------------|
| git-activity-summary | activity, standup, commits, author, trends | ✅ |
| git-changelog | changelog, release notes, recent commits | ✅ |
| git-diff-summary | diff, review, staged, unstaged, pr diff | ✅ |
| git-file-history | file history, blame, who changed, provenance | ✅ |
| git-repo-health | health, clean, status, unpushed, stashes | ✅ |
| git-workflow | workflow, conventions, commit message, branching | 📖 reference only |

## Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--list` | `-l` | List all registered git skills |
| `--json` | | Output as JSON |
| `--help` | `-h` | Show usage |
| `--` | | Separator before intent query |

## Integration with Agents

When an agent encounters a git-related request, it can use git-toolkit as a
quick discovery step:

```
1. Run: node git-toolkit.cjs -- <user's request> --json
2. Parse the JSON to get the matched skill name and script path.
3. Read that skill's SKILL.md for full documentation.
4. Execute the skill's script with the appropriate arguments.
```

This is especially useful in heartbeat and cron contexts where the agent needs
to act on git data but may not know the full skill catalogue.

## Adding New Git Skills

To register a new git skill with git-toolkit, add an entry to the `SKILLS`
array in `scripts/git-toolkit.cjs`:

```javascript
{
  name: 'git-branch-analyser',
  aliases: ['branch', 'branches', 'branching', 'branch info'],
  description: 'Analyse branch relationships and divergence',
  script: 'git-branch-analyser/scripts/git-branch-analyser.cjs',
  examples: ['git-toolkit -- branch info for trackhub'],
}
```

Set `script: null` for reference-only skills that have no executable script.

## Limitations

- Does not execute the matched skill — it only routes to it
- Intent matching is keyword-based, not semantic (intentionally simple)
- Requires git skills to be co-located in the same skills/ directory
- Does not discover skills outside the hardcoded registry
