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
    description: Unified pipeline query with 7 modes, fuzzy matching, and JSON output
  - name: test-attio
    description: Connectivity and auth test
---

# Attio CRM Skill

Read-only integration with [Attio](https://www.attio.com/) CRM for querying deals, pipeline status, and company data.

## Overview

This skill provides `pipeline-query.mjs` — a unified script with 7 query modes, fuzzy matching against the ATTIO_SCHEMA env var, and structured JSON or Slack-formatted output. All operations are **read-only**.

## Connectors

This skill uses the `attio` connector, which provides `ATTIO_API_KEY` and `ATTIO_API_BASE_URL` as environment variables to scripts.

### Schema for Fuzzy Matching

The `pipeline-query.mjs` script uses the `ATTIO_SCHEMA` environment variable for fuzzy matching stage names and other filter values. This is provided by the Track server.

**Expected format:**
```json
{
  "stages": [
    { "title": "Lead", "id": "...", "is_archived": false },
    { "title": "Won 🎉", "id": "...", "is_archived": false }
  ],
  "companyStages": [
    { "title": "Seed", "id": "...", "is_archived": false }
  ]
}
```

If `ATTIO_SCHEMA` is **not set**, the script falls back to raw case-insensitive substring matching with a warning to stderr.

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

**Fuzzy matching:** Stage names and other filter values are automatically fuzzy-matched against ATTIO_SCHEMA. Typos and partial matches work — `"disqulified"` → `"Disqualified"`, `"won"` → `"Won 🎉"`.

## Commands

### Pipeline query

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

# Only won deals
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

### Test connectivity

```sh
node scripts/test-attio.mjs
```

Lists all accessible CRM objects with their API slugs.

## Cron Integration

The stage movements report can be scheduled as an OpenClaw cron job:

```
openclaw cron create \
  --name "Attio pipeline morning update" \
  --schedule "0 9 * * 1-5" \
  --channel "C0XXXX" \
  --message "Run: node scripts/pipeline-query.mjs --mode movements --days 24. Reply with only the script output, no preamble or commentary."
```

## Data Notes

- **Pagination**: All queries paginate at 100 records per batch using offset-based pagination.
- **Field accessors**: Deal fields are accessed via `record.values.<field>[0]` (Attio's multi-value array pattern). Common fields: `name`, `stage` (has `status.title` and `active_from`), `value` (has `currency_value` and `currency_code`), `associated_company` (has `target_record_id`).
- **Currency**: Defaults to EUR with Irish formatting.
- **Company resolution**: All modes join deals to companies via `associated_company.target_record_id`.
- **Forecast weights**: Lead = 10%, Live = 40%, other stages = 20%.

## Important

All operations are **read-only** per the TOOLS.md external API safety rule. Do not add write/update/delete capabilities without explicit approval.
