# memory-maintainer

Scan daily notes and suggest MEMORY.md updates.

## Description

Periodically analyse a directory of daily markdown files (`memory/YYYY-MM-DD.md`), identify significant entries worth preserving long-term, and output suggested additions to `MEMORY.md`. Can also auto-merge suggestions and prune stale entries.

Useful during heartbeat sessions when doing periodic memory maintenance, or as a standalone cron job.

## Script

`scripts/memory-maintainer.mjs` — Node.js, zero external dependencies. Uses shared-lib for arg parsing and output formatting.

## Usage

```bash
# Basic scan (last 7 days, human-readable report)
node scripts/memory-maintainer.mjs --memory-dir ./memory --memory-file ./MEMORY.md

# Scan last 30 days
node scripts/memory-maintainer.mjs --memory-dir ./memory --memory-file ./MEMORY.md --days 30

# Auto-merge suggestions and prune entries older than 90 days
node scripts/memory-maintainer.mjs --memory-dir ./memory --memory-file ./MEMORY.md --merge

# Dry run (show what would merge without writing)
node scripts/memory-maintainer.mjs --memory-dir ./memory --memory-file ./MEMORY.md --merge --dry-run

# JSON output
node scripts/memory-maintainer.mjs --memory-dir ./memory --memory-file ./MEMORY.md --json
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--memory-dir` | `./memory` | Path to daily notes directory |
| `--memory-file` | `./MEMORY.md` | Path to MEMORY.md |
| `--days <n>` | `7` | Scan last N days of daily files |
| `--since <date>` | — | Scan from specific date (YYYY-MM-DD) |
| `--merge` | `false` | Auto-merge suggestions into MEMORY.md |
| `--dry-run` | `false` | Show suggestions without writing |
| `--max-age <days>` | `90` | Prune entries older than N days (with `--merge`) |
| `--json` | `false` | Output as JSON |
| `--quiet` | `false` | Only output errors |

## How It Works

1. **Scans** daily note files in the configured directory, filtered by date window
2. **Extracts** markdown sections from each file
3. **Scores** each section using keyword signals:
   - Decisions, agreements, choices (+3)
   - Lessons learned, bugs fixed (+2)
   - Preferences stated (+2)
   - Projects shipped/completed (+2)
   - Configuration changes (+1)
   - Content length bonus (+1–2)
   - Routine/checklist penalty (-2)
4. **Deduplicates** against existing MEMORY.md entries using normalized content comparison
5. **Suggests** one-line entries for sections scoring ≥ 3
6. **Optionally merges** suggestions and prunes stale entries

## Dependencies

- `shared-lib` — arg parsing (`args.mjs`) and output formatting (`fmt.mjs`)
- Node.js 18+ (no external packages)
