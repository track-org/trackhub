---
name: Attio CRM
slug: attio-crm
description: Query Attio CRM data for deals, companies, and pipeline status. Read-only. Use when asked about deal pipeline, stage changes, stale deals, company data, or CRM reports. Scripts provide structured JSON or Slack-formatted output.
skill-type: standard
category: customer-success
tags: [crm, attio, pipeline, deals, stages, reporting]
suggested-connectors: [attio]
suggested-job-type: chat
suggested-schedule-frequency: daily
suggested-schedule-hour: 9
suggested-schedule-minute: 0
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: daily-stage-changes
    description: Report deals that changed stage in the last N hours
  - name: pipeline-summary
    description: Summarise current pipeline by stage
  - name: stale-deals
    description: Find deals with no activity in N days
  - name: test-attio
    description: Connectivity and auth test
---

# Attio CRM Skill

Read-only integration with [Attio](https://www.attio.com/) CRM for querying deals, pipeline status, and company data.

## Overview

This skill provides Node.js scripts that query the Attio REST API v2 to produce deal pipeline reports, stage change digests, and stale-deal alerts. All operations are **read-only** — no creates, updates, or deletes.

## Required Environment Variables

| Variable | Description | Location |
|---|---|---|
| `ATTIO_API_KEY` | Bearer token for Attio API | `workspace/.env` |
| `ATTIO_API_BASE_URL` | API base URL (optional, defaults to `https://api.attio.com`) | `workspace/.env` |

The scripts auto-load `workspace/.env` by resolving it relative to their own install location (`scripts/` → `attio-crm/` → `trackhub/` → `workspace/`). Override with `ATTIO_ENV_FILE` if needed.

## Local Data Convention

Workspace-specific schema and reference data lives at `workspace/data/attio-crm/`:

- `deals-object.json` — the deals object definition (attribute metadata)
- `deals-attributes.json` — all attribute definitions for the deals object

These files are **not** in trackhub — they contain workspace-specific schema and should not be shared.

## Commands

All scripts are at `{baseDir}/scripts/` where `{baseDir}` resolves to the skill's install location. To locate it at runtime:

```bash
# From within an OpenClaw runtime:
SKILL_DIR=$(find /home/delads/.openclaw/workspace/trackhub/skills/attio-crm -maxdepth 0 -type d 2>/dev/null)
```

### `daily-stage-changes.mjs`

Recent deal stage changes with Slack-formatted output.

```bash
node {baseDir}/scripts/daily-stage-changes.mjs [--hours=N] [--json]
```

- `--hours=N` — look-back window in hours (default: 24)
- `--json` — output structured JSON instead of Slack-formatted text

Output includes: deal name, company, new stage, value, time since change, and clickable Attio URLs.

### `pipeline-summary.mjs`

Full pipeline snapshot grouped by stage.

```bash
node {baseDir}/scripts/pipeline-summary.mjs [--json]
```

- `--json` — output structured JSON instead of human-readable text

Shows total deals, total value, and per-stage breakdowns sorted by value.

### `stale-deals.mjs`

Deals that haven't moved in a while.

```bash
node {baseDir}/scripts/stale-deals.mjs [--days=N] [--json]
```

- `--days=N` — minimum age threshold in days (default: 14)
- `--json` — output structured JSON

Excludes "Won 🎉" and "Disqualified" stages.

### `test-attio.mjs`

Connectivity and auth test.

```bash
node {baseDir}/scripts/test-attio.mjs
```

Lists all accessible CRM objects with their API slugs.

## Cron Integration

The daily stage changes report can be scheduled as an OpenClaw cron job. Example:

```
openclaw cron create \
  --name "Attio stage changes to #product" \
  --schedule "0 9 * * 1-5" \
  --channel "C0XXXX" \
  --message "Run: node /home/delads/.openclaw/workspace/trackhub/skills/attio-crm/scripts/daily-stage-changes.mjs. Reply with only the script output, no preamble or commentary."
```

## Data Notes

- **Pagination**: All scripts paginate at 100 records per batch using offset-based pagination.
- **Field accessors**: Deal fields are accessed via `record.values.<field>[0]` (Attio's multi-value array pattern). Common fields: `name`, `stage` (has `status.title` and `active_from`), `value` (has `currency_value` and `currency_code`), `associated_company` (has `target_record_id`).
- **Currency**: Defaults to EUR with Irish formatting.
- **Company resolution**: Stage changes script joins deals to companies via `associated_company.target_record_id`.

## Important

All operations are **read-only** per the TOOLS.md external API safety rule. Do not add write/update/delete capabilities without explicit approval.
