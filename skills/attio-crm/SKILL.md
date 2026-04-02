---
name: Attio CRM
slug: attio-crm
description: Query Attio CRM pipeline — snapshots, stale deals, forecasting, deal health, win/loss, hygiene checks, stage movements, and period comparisons. Read-only. Fuzzy-matched stage and field names. Use when asked anything about CRM pipeline, deal performance, forecast, deal risk, data quality, or stage changes.
skill-type: standard
category: customer-success
tags: [crm, attio, pipeline, deals, stages, forecasting, win-loss, hygiene, reporting]
suggested-connectors: [attio]
suggested-job-type: chat
suggested-schedule-frequency: daily
suggested-schedule-hour: 9
suggested-schedule-minute: 0
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: pipeline-query
    description: Unified pipeline query with 7 modes, fuzzy matching, and schema caching
  - name: daily-stage-changes
    description: Report deals that changed stage in the last N hours
  - name: list-deals
    description: Flexible deal listing with stage filtering, exclusion, and multiple output formats
  - name: pipeline-summary
    description: Summarise current pipeline by stage (legacy — use pipeline-query --mode snapshot)
  - name: stale-deals
    description: Find deals with no activity in N days (legacy — use pipeline-query --mode stale)
  - name: test-attio
    description: Connectivity and auth test
---

# Attio CRM Skill

Read-only integration with [Attio](https://www.attio.com/) CRM for querying deals, pipeline status, and company data.

## Overview

This skill provides Node.js scripts that query the Attio REST API v2 to produce deal pipeline reports, stage change digests, and stale-deal alerts. All operations are **read-only** — no creates, updates, or deletes.

The main tool is `pipeline-query.mjs` — a unified script with 7 query modes, fuzzy matching against cached schema, and structured output. Legacy scripts (`pipeline-summary.mjs`, `stale-deals.mjs`, `list-deals.mjs`, `daily-stage-changes.mjs`) still work but are superseded.

## Connectors

This skill uses the `attio` connector, which provides `ATTIO_API_KEY` and `ATTIO_API_BASE_URL` as environment variables to scripts.

### Schema for Fuzzy Matching

The unified `pipeline-query.mjs` script uses the `ATTIO_SCHEMA` environment variable for fuzzy matching stage names and other filter values. This is provided by the Track server — the skill does **not** fetch or cache schema itself.

**Expected format:**
```json
{
  "stages": [
    { "title": "Lead", "id": "...", "is_archived": false },
    { "title": "Live", "id": "...", "is_archived": false },
    { "title": "Won 🎉", "id": "...", "is_archived": false },
    { "title": "Disqualified", "id": "...", "is_archived": false }
  ],
  "companyStages": [
    { "title": "Seed", "id": "...", "is_archived": false }
  ]
}
```

If `ATTIO_SCHEMA` is **not set**, the script falls back to raw case-insensitive substring matching and prints a warning to stderr.

## Quick Reference — Intent → Command

| User is asking about…                    | Command                                             |
|------------------------------------------|-----------------------------------------------------|
| Pipeline overview / total value           | `--mode snapshot`                                   |
| Deals in a specific stage                 | `--mode snapshot --stage <name>`                    |
| Stuck or aging deals                      | `--mode stale [--days=N]`                           |
| Forecast / closing this month/quarter     | `--mode forecast [--period=month\|quarter]`         |
| Deals at risk / missing data              | `--mode health`                                     |
| Won/lost deals, win rate                  | `--mode win-loss [--period=month\|quarter]`         |
| Data quality / missing fields / zombies   | `--mode hygiene`                                    |
| Recent stage changes                      | `--mode movements [--days=N]`                       |

**Fuzzy matching:** Stage names and other filter values are automatically fuzzy-matched. Typos and partial matches work — `"disqulified"` matches `"Disqualified"`, `"won"` matches `"Won 🎉"`. The script resolves user input against the cached schema before querying.

## Commands

### Unified pipeline query

```sh
node scripts/pipeline-query.mjs --mode <mode> [options]
```

| Option                | Description                                      |
|-----------------------|--------------------------------------------------|
| `--mode <mode>`       | `snapshot`, `stale`, `forecast`, `health`, `win-loss`, `hygiene`, `movements` |
| `--stage <name>`      | Filter by stage (fuzzy-matched)                  |
| `--exclude <name>`    | Exclude stages (can repeat, fuzzy-matched)       |
| `--days=N`            | Days threshold for stale/movements modes         |
| `--period=week\|month\|quarter\|year` | Period for forecast/win-loss modes        |
| `--json`              | Output structured JSON                            |
| `--help`              | Show all modes, flags, and intent mapping (JSON) |

Examples:
```sh
# Pipeline overview
node scripts/pipeline-query.mjs --mode snapshot

# Only won deals (fuzzy match handles "won" → "Won 🎉")
node scripts/pipeline-query.mjs --mode snapshot --stage "won"

# Deals stuck for 30+ days
node scripts/pipeline-query.mjs --mode stale --days 30

# Monthly forecast
node scripts/pipeline-query.mjs --mode forecast --period month

# Deal health check
node scripts/pipeline-query.mjs --mode health

# Win/loss this quarter
node scripts/pipeline-query.mjs --mode win-loss --period quarter

# Data quality
node scripts/pipeline-query.mjs --mode hygiene

# Stage movements in last 7 days
node scripts/pipeline-query.mjs --mode movements --days 7

# JSON for programmatic use
node scripts/pipeline-query.mjs --mode snapshot --json

# Self-documenting help
node scripts/pipeline-query.mjs --help
```

### Legacy scripts (still functional)

#### Daily stage changes

```sh
node scripts/daily-stage-changes.mjs [--hours=N] [--json]
```

#### Pipeline summary

```sh
node scripts/pipeline-summary.mjs [--json]
```

#### Stale deals

```sh
node scripts/stale-deals.mjs [--days=N] [--json]
```

#### List / filter deals

```sh
node scripts/list-deals.mjs [--stage <name>] [--exclude <name>] [--format grouped|flat|names] [--min-age-hours <N>] [--json]
```

#### Test connectivity

```sh
node scripts/test-attio.mjs
```

## Schema Caching

On first run (or when cache is stale), `pipeline-query.mjs` automatically:

1. Fetches the deals object and attribute definitions from Attio API
2. Scans all deal records to discover stage names and company stage values
3. Saves everything to `workspace/data/attio-crm/`
4. Reuses the cache for 24 hours (TTL)

Use `--refresh-schema` to force a fresh pull at any time.

## Cron Integration

The daily stage changes report can be scheduled as an OpenClaw cron job. Example:

```
openclaw cron create \
  --name "Attio stage changes to #product" \
  --schedule "0 9 * * 1-5" \
  --channel "C0XXXX" \
  --message "Run: node scripts/daily-stage-changes.mjs. Reply with only the script output, no preamble or commentary."
```

## Data Notes

- **Pagination**: All scripts paginate at 100 records per batch using offset-based pagination.
- **Field accessors**: Deal fields are accessed via `record.values.<field>[0]` (Attio's multi-value array pattern). Common fields: `name`, `stage` (has `status.title` and `active_from`), `value` (has `currency_value` and `currency_code`), `associated_company` (has `target_record_id`).
- **Currency**: Defaults to EUR with Irish formatting.
- **Company resolution**: All modes join deals to companies via `associated_company.target_record_id`.

## Important

All operations are **read-only** per the TOOLS.md external API safety rule. Do not add write/update/delete capabilities without explicit approval.
