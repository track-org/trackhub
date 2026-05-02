---
name: cron-history-search
description: Search across all OpenClaw cron run summaries and metadata for specific keywords or patterns. Use when answering "when did job X last mention Y?", "which jobs mentioned this error?", "find runs containing this keyword", or when debugging an issue that spans multiple cron jobs. Complements cron-run-inspector (single run deep-dive) with cross-job breadth.
---

# Cron History Search

Search across all cron run summaries, session keys, delivery statuses, and error messages for specific keywords or patterns. Think of it as `grep` for your entire cron run history.

## Why

You have `cron-run-inspector` for deep-diving into a single run, and `cron-health`/`cron-dashboard` for the current snapshot. But sometimes you need to answer cross-cutting questions:

- "When did the Attio job last mention 'Forte Healthcare'?"
- "Which jobs have had 'timeout' errors in the last week?"
- "Show me every run that mentioned 'credential' in the last 30 days"
- "What errors has the Gmail digest job been hitting?"

This skill answers those questions by scanning all cron run summaries and metadata.

## Script

`scripts/cron-history-search.mjs` — Zero dependencies. Node.js 18+.

## Usage

```bash
# Search all jobs for a keyword
node cron-history-search.mjs "credential"

# Search with a time window
node cron-history-search.mjs "timeout" --days 7

# Limit results
node cron-history-search.mjs "error" --limit 5

# Filter to a specific job (fuzzy match)
node cron-history-search.mjs "Gmail" --job "gmail-digest"

# Case-insensitive (default) vs case-sensitive
node cron-history-search.mjs "ERROR" --case-sensitive

# JSON output for programmatic use
node cron-history-search.mjs "fail" --json

# Search in delivery status field only
node cron-history-search.mjs "failed" --field delivery

# Search in agent summary only (the run's summary text)
node cron-history-search.mjs "stale" --field summary

# Invert match: show runs that DON'T contain the keyword
node cron-history-search.mjs "ok" --invert
```

## Search Fields

By default, searches across: summary, status, deliveryStatus, model, provider, and sessionKey.

Use `--field` to restrict:

| Field | Description |
|-------|-------------|
| `summary` | Agent's own summary of what it did |
| `status` | Run status (ok, error, etc.) |
| `delivery` | Delivery status (delivered, failed, etc.) |
| `model` | Model used (glm-5-turbo, etc.) |
| `all` | Default — searches all text fields |

## Output Format

```
🔍 Searching 12 jobs for "credential" (7-day window)

Found 4 matching runs:

1. [May 1 09:00] Gmail daily digest
   Status: ok · Delivered: no (not-requested)
   Model: glm-5-turbo · Tokens: 11,169 · Duration: 30.0s
   Match: "...credential pre-flight check for Gmail first..."
   
2. [Apr 30 09:00] Gmail daily digest
   Status: ok · Delivered: yes
   Model: glm-5-turbo · Tokens: 11,253 · Duration: 52.1s
   Match: "...credential-health checks before the real cron task..."

3. [Apr 30 07:00] Attio stage changes to #product
   Status: ok · Delivered: yes
   Model: glm-5-turbo · Tokens: 11,453 · Duration: 53.1s
   Match: "...credential-health check. Attio API responded..."

4. [Apr 29 09:00] Gmail daily digest
   Status: ok · Delivered: yes
   Model: glm-5-turbo · Tokens: 11,180 · Duration: 29.9s
   Match: "...credential pre-flight: all checks passed..."
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--days <n>` | `-d` | 7 | Time window in days |
| `--limit <n>` | `-l` | 20 | Max results to show |
| `--runs <n>` | `-r` | 30 | Max runs per job to scan |
| `--job <name>` | `-j` | *(all)* | Fuzzy filter to specific job(s) |
| `--field <f>` | `-f` | all | Restrict search field (summary/status/delivery/model/all) |
| `--case-sensitive` | | false | Case-sensitive matching |
| `--invert` | `-v` | false | Show runs that DON'T match |
| `--json` | | false | JSON output |
| `--include-disabled` | | false | Include disabled cron jobs |
| `--context <n>` | `-c` | 0 | Show N chars of context around match |

## How It Works

1. Lists all cron jobs via `openclaw cron list`
2. For each job (or filtered jobs), fetches recent runs via `openclaw cron runs --id <id> --limit N`
3. Searches run summaries and metadata fields for the keyword
4. Ranks results by recency (newest first)
5. Outputs matches with surrounding context

## Use Cases

- **Debugging**: "What errors has this job been hitting?"
- **Audit**: "Which jobs mentioned 'Attio' this week?"
- **Pattern detection**: "Show me every 'timeout' in the last 30 days"
- **Change tracking**: "When did this job start showing this warning?"
- **Cross-job correlation**: "Are multiple jobs hitting the same credential issue?"

## Complementary Skills

- **cron-run-inspector**: Deep-dive into a single run after finding it here
- **cron-health**: Overview of all jobs — use first to spot problems
- **cron-delivery-audit**: Focused on delivery failures
- **cron-trend-analyzer**: Spot trends over time
- **session-digest**: Daily activity summary

## Limitations

- Only searches run metadata (summary, status, delivery). Does NOT search full transcripts — use `cron-run-inspector` for that.
- Speed depends on number of jobs × runs per job. Use `--job` and `--runs` to limit scope.
- Requires `openclaw` CLI on PATH.
