# SKILL.md Format Specification

> Reference for authoring Track-compatible skills. Skills follow the [Agent Skills open standard](https://agentskills.io).

---

## Directory Structure

```
skill-name/
├── SKILL.md          # Required — YAML frontmatter + markdown instructions
├── scripts/          # Optional — executable scripts the agent can run
├── references/       # Optional — supporting docs loaded on demand
└── assets/           # Optional — additional resources
```

---

## SKILL.md Structure

A SKILL.md file has two parts: YAML frontmatter between `---` markers, followed by markdown instructions.

```markdown
---
name: Skill Name
slug: skill-name
description: One-line description of what this skill does and when to use it.
skill-type: standard
category: domain-category
tags: [tag1, tag2]
suggested-connectors: [attio, hubspot]
suggested-job-type: chat
suggested-schedule-frequency: daily
suggested-schedule-hour: 9
suggested-schedule-minute: 0
memory-paths-writes: [customers/*, activity-log/*]
memory-paths-reads: [customer-index.md]
depends-on-skills: [crm-enrichment]
skill-functions:
  - name: functionName
    description: What this function does
available-scripts:
  - name: script-name
    description: What this script does
---

# Skill Name

[Markdown instructions the agent follows when this skill is active]
```

---

## Frontmatter Fields

### Required

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable display name |
| `slug` | string | Machine identifier (lowercase, hyphens). Must match directory name |
| `description` | string | Determines whether the skill gets activated for a task. Be specific |
| `skill-type` | string | Always `standard` for now |
| `category` | string | Domain grouping (e.g. `customer-success`, `productivity`, `engineering`) |

### Optional

| Field | Type | Description |
|-------|------|-------------|
| `tags` | string[] | Discovery and filtering tags |
| `suggested-connectors` | string[] | Connectors this skill works with (see valid values below) |
| `suggested-job-type` | string | Execution context hint: `background`, `report`, or `chat` |
| `suggested-schedule-frequency` | string | Default schedule shown during install (e.g. `daily`, `hourly`) |
| `suggested-schedule-hour` | integer | Default hour (0-23) shown during install |
| `suggested-schedule-minute` | integer | Default minute (0-59) shown during install |
| `memory-paths-writes` | string[] | Paths this skill may write to. **Enforced** at the tool level |
| `memory-paths-reads` | string[] | Paths this skill reads from. Informational only, not enforced |
| `depends-on-skills` | string[] | Advisory. Shown as "For best results, also install X" |
| `skill-functions` | block sequence | Server-side functions this skill uses (see format below) |
| `available-scripts` | block sequence | Executable scripts bundled with this skill (see format below) |

### Memory Path Scoping

- Write paths use glob patterns: `customers/*` allows writing to any path under `customers/`.
- The `activity-log/*` scope is always granted automatically — skills don't need to declare it.
- Read paths are informational only; reads are unrestricted.

---

## Block Sequence Fields

`skill-functions` and `available-scripts` use YAML block sequence format. Each item has `name` and `description`:

```yaml
skill-functions:
  - name: attioQuery
    description: Query Attio CRM data (records, pipeline, velocity, stage changes)
  - name: hubspotQuery
    description: Query HubSpot CRM data (records, pipeline, velocity, stage changes)

available-scripts:
  - name: pipeline-summary
    description: Summarise current pipeline by stage
  - name: daily-stage-changes
    description: Report deals that changed stage in the last N hours
```

- `skill-functions` are server-side Node.js functions invoked via `skill_run_function`.
- `available-scripts` are standalone programs in the `scripts/` directory invoked via `skill_run_script`. Script files should be `.mjs`, `.js`, or `.sh`.

---

## Valid Connector Types

Use these values in `suggested-connectors`. Each maps to environment variables available to skill scripts:

| Connector | Env Vars Set |
|-----------|-------------|
| `attio` | `ATTIO_API_KEY`, `ATTIO_API_BASE_URL` |
| `hubspot` | `HUBSPOT_ACCESS_TOKEN` |
| `slack` | `SLACK_BOT_TOKEN` |
| `github` | `GITHUB_TOKEN` |
| `linear` | `LINEAR_API_KEY` |
| `google_drive` | `GOOGLE_ACCESS_TOKEN` |
| `google_groups` | `GOOGLE_ACCESS_TOKEN` |
| `notion` | `NOTION_TOKEN` |

Only connectors listed in `suggested-connectors` are resolved for script execution — scripts don't get access to all team connectors.

---

## Frontmatter Parser Notes

Track's parser is intentionally simple. Follow these rules:

- Top-level keys must start at column 0 with no leading whitespace.
- Inline arrays use brackets: `tags: [a, b, c]`
- Block sequences use `- key: value` indented under the parent key.
- Block sequences support one level of nesting only (no nested objects within items).
- No multi-line strings, anchors, or advanced YAML features.

---

## Examples

### Chat skill with CRM functions

```yaml
---
name: Pipeline Query
slug: pipeline-query
description: Answers questions about current pipeline state, stage counts, deal distribution, and stage changes by querying the CRM directly.
skill-type: standard
category: customer-success
tags: [pipeline, crm, stages, deals, query]
suggested-connectors: [attio, hubspot]
suggested-job-type: chat
skill-functions:
  - name: attioQuery
    description: Query Attio CRM data (records, pipeline, velocity, stage changes, record details)
  - name: hubspotQuery
    description: Query HubSpot CRM data (records, pipeline, velocity, stage changes, record details)
---
```

### Scheduled report with memory reads and dependencies

```yaml
---
name: Customer Status Report
slug: customer-status-report
description: Generates a summary report of customer status, recent activity, and key highlights from enriched CRM data.
skill-type: standard
category: customer-success
tags: [customers, crm, status, reporting]
suggested-connectors: []
suggested-job-type: report
suggested-schedule-frequency: daily
suggested-schedule-hour: 9
memory-paths-writes: []
memory-paths-reads: [customer-index.md, customers/*/status.md, activity-log/*]
depends-on-skills: [crm-enrichment]
skill-functions:
  - name: listTrackedCustomers
    description: List all tracked customers from the index
  - name: bulkReadCustomerStatuses
    description: Bulk read customer status files from memory
---
```

### Script-based skill

```yaml
---
name: Pipeline Scripts
slug: pipeline-scripts
description: Executable scripts for pipeline reporting and analysis.
skill-type: standard
category: customer-success
tags: [pipeline, scripts, reporting]
suggested-connectors: [attio]
available-scripts:
  - name: pipeline-summary
    description: Summarise current pipeline by stage
  - name: daily-stage-changes
    description: Report deals that changed stage in the last N hours
  - name: stale-deals
    description: Find deals with no activity in N days
---
```
