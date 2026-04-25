---
name: git-file-history
description: Trace the full history of a specific file across commits — who changed it, when, what lines changed, and a clean timeline. Use when answering "who broke this file?", "when was this line introduced?", "what's the change history of X?", or investigating file-level provenance across branches.
skill-type: standard
category: dev-tools
tags: [git, file-history, blame, provenance, debugging, audit]
suggested-connectors: []
suggested-job-type: manual
available-scripts:
  - name: git-file-history
    description: Trace the full change history of a file with clean timeline output
---

# Git File History 📜

Trace the complete lifecycle of a file: every commit that touched it, who changed what, and when. Like a supercharged `git log --follow` with clean, scannable output.

## Why

Ever asked "who introduced this bug?" or "when did this config change?" Raw `git log -- file` gives you commits, but it's noisy. `git blame` gives you line-level attribution but no timeline. This skill combines both into a clean history timeline.

## How to Run

```bash
# Full history of a file
node scripts/git-file-history.mjs path/to/file.js

# Relative to a specific repo
node scripts/git-file-history.mjs path/to/file.js --repo /path/to/repo

# Limit to last N commits
node scripts/git-file-history.mjs path/to/file.js --commits 10

# Only show summary (no diff excerpts)
node scripts/git-file-history.mjs path/to/file.js --summary

# Show blame (current line ownership)
node scripts/git-file-history.mjs path/to/file.js --blame

# Since a date
node scripts/git-file-history.mjs path/to/file.js --since "2 weeks ago"

# JSON output
node scripts/git-file-history.mjs path/to/file.js --json

# Include file stats (size changes, line count changes)
node scripts/git-file-history.mjs path/to/file.js --stats
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--repo <path>` | cwd | Path to git repo |
| `--commits <n>` | all | Limit to N most recent commits |
| `--since <date>` | all | Show commits since date expression |
| `--author <name>` | all | Filter by author |
| `--summary` | false | Summary only (no diff excerpts) |
| `--blame` | false | Show current line-level blame |
| `--stats` | false | Include file size/line changes |
| `--follow` | true | Follow renames |
| `--json` | false | Raw JSON output |
| `--diff-ctx <n>` | 3 | Lines of diff context |

## Output Formats

### Default (Full History)

```
📜 File History: src/config.ts — 8 commits

📊 Summary: 4 authors · 2 renames · 14 days span
   Created: 2026-04-10 by alice
   Last changed: 2026-04-24 by shelldon
   Current: 142 lines (+87/-23 net)

──────────────────────────────────────────────

1. [f8a2c1d] 2026-04-24 · shelldon (2h ago)
   feat: add retry logic for API calls
   +12 -3

     @@ -15,6 +15,15 @@
     +async function retryWithBackoff(fn, maxRetries = 3) {
     +  let attempt = 0;

──────────────────────────────────────────────

2. [b3e7f2a] 2026-04-22 · alice (2d ago)
   fix: correct timeout handling
   +5 -8

     @@ -20,10 +20,7 @@
     -const timeout = 5000;
     +const timeout = parseInt(process.env.TIMEOUT || '10000');

──────────────────────────────────────────────

3. [a1b2c3d] 2026-04-18 · bob (6d ago)
   refactor: extract config loader
   +45 -2

     (new file — full content)

──────────────────────────────────────────────

📌 Created in commit a1b2c3d (2026-04-18) by bob
```

### Summary Mode (`--summary`)

```
📜 src/config.ts — 8 commits over 14 days
   Authors: shelldon (3), alice (3), bob (2)
   Created: 2026-04-18 by bob
   Last:    2026-04-24 by shelldon
   Net:     +87 -23 lines
```

### Blame Mode (`--blame`)

```
📜 Blame: src/config.ts (142 lines)

  shelldon  [f8a2c1d]  2h ago    L1-15:   imports and constants
  alice     [b3e7f2a]  2d ago    L16-30:  config interface
  bob       [a1b2c3d]  6d ago    L31-55:  loader function
  shelldon  [e5d4c3b]  4d ago    L56-72:  validation logic
  alice     [9a8b7c6]  3d ago    L73-90:  defaults
  shelldon  [f8a2c1d]  2h ago    L91-142: retry logic (new)
```

## JSON Output Schema

```json
{
  "file": "src/config.ts",
  "totalCommits": 8,
  "authors": { "shelldon": 3, "alice": 3, "bob": 2 },
  "createdIn": { "hash": "a1b2c3d", "author": "bob", "date": "2026-04-18" },
  "lastChanged": { "hash": "f8a2c1d", "author": "shelldon", "date": "2026-04-24" },
  "netLines": { "added": 87, "deleted": 23 },
  "commits": [
    {
      "hash": "f8a2c1d",
      "shortHash": "f8a2c1d",
      "author": "shelldon",
      "date": "2026-04-24T14:30:00+01:00",
      "subject": "feat: add retry logic for API calls",
      "added": 12,
      "deleted": 3,
      "isNewFile": false,
      "isRename": false,
      "diffExcerpt": "..."
    }
  ]
}
```

## Use Cases

- **Debugging**: "Who changed this line and why?" — run `--blame` to see line ownership, then inspect the relevant commit
- **Onboarding**: "What's the history of this config file?" — full timeline with diff excerpts
- **Code review**: "What's changed in this file lately?" — `--since "1 week ago"` for recent changes
- **Audit**: "Who's been modifying our auth module?" — `--author` filter to track contributions

## Dependencies

- `git` CLI (must be on PATH)
- Node.js 18+
- `shared-lib` for argument parsing and output formatting
