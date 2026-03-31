# SKILL.md Format Specification

> Reference for authoring Track-compatible skills. Skills follow the [Agent Skills open standard](https://agentskills.io).

---

## Directory Structure

```
skill-name/
├── SKILL.md          # Required — YAML frontmatter + markdown instructions
├── scripts/          # Optional — executable scripts the agent can run
│   └── lib/          # Optional — shared modules for scripts
├── references/       # Optional — supporting docs loaded on demand
└── assets/           # Optional — additional resources
```

---

## Execution Model

Skills use **standalone scripts** as the primary execution mechanism. Scripts are self-contained programs in the `scripts/` directory that the LLM runs via `skill_exec`. The platform injects connector credentials as environment variables.

```
LLM reads SKILL.md instructions (auto-injected into system prompt)
  → LLM calls skill_exec(skill_slug, command)
    → Platform materialises scripts to temp dir
    → Platform injects connector env vars (ATTIO_API_KEY, etc.)
    → /bin/sh -c executes the command
    → stdout returned to LLM
```

This model is portable — skills authored for Track work on any [agentskills.io](https://agentskills.io)-compatible platform (Claude Code, OpenClaw, etc.) because the scripts are self-contained and the SKILL.md instructions reference them via standard shell commands.

For memory operations (reading/writing persistent state), skills use the platform's built-in `memory_read`, `memory_write`, and `memory_list` tools directly — no scripts needed.

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
suggested-connectors: [attio]
suggested-job-type: chat
suggested-schedule-frequency: daily
suggested-schedule-hour: 9
suggested-schedule-minute: 0
memory-paths-writes: [customers/*, activity-log/*]
memory-paths-reads: [customer-index.md]
depends-on-skills: [crm-enrichment]
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
| `available-scripts` | block sequence | Executable scripts bundled with this skill (see format below) |

### Memory Path Scoping

- Write paths use glob patterns: `customers/*` allows writing to any path under `customers/`.
- The `activity-log/*` scope is always granted automatically — skills don't need to declare it.
- Read paths are informational only; reads are unrestricted.

---

## Scripts

Scripts are the primary way skills interact with external APIs. They are self-contained programs in the `scripts/` directory that:

- Read connector credentials from environment variables (e.g. `ATTIO_API_KEY`)
- Accept arguments via CLI flags (e.g. `--object companies --json`)
- Output structured data (JSON) to stdout
- Output diagnostics/errors to stderr
- Have zero npm dependencies — use Node 18+ built-in `fetch`

### Declaring Scripts

List scripts in the `available-scripts` frontmatter field:

```yaml
available-scripts:
  - name: query-records
    description: Search, list, filter, or count Attio object records
  - name: pipeline-summary
    description: Summarise pipeline entries grouped by stage with counts
```

### Referencing Scripts in Instructions

The SKILL.md markdown body tells the LLM exactly what commands to run:

````markdown
### List all companies
```sh
node scripts/query-records.mjs --object companies --fetch-all --json
```

### Pipeline summary
```sh
node scripts/pipeline-summary.mjs --json
```
````

The LLM executes these via `skill_exec`:
```
skill_exec(skill_slug="attio-crm-scripts", command="node scripts/query-records.mjs --object companies --json")
```

### Script Design Guidelines

- **Include `--help`** — the LLM uses this to discover the script's interface
- **Accept `--json`** — always support structured JSON output
- **Use `--` flags for all inputs** — no positional arguments; flags are self-documenting
- **Write errors to stderr** — keep stdout clean for data
- **Exit 0 on success, 1 on error** — with a clear error message on stderr
- **Be idempotent** — agents may retry commands
- **Cap output size** — default to summaries; use `--limit` or `--offset` flags for pagination
- **Pin dependency versions** — if using inline deps (PEP 723, Deno `npm:`), pin them

### Shared Modules

For scripts within the same skill that share logic (fetch helpers, retry logic), use a `scripts/lib/` directory:

```
scripts/
├── lib/
│   └── attio-client.mjs    # Shared fetch + retry + rate limiting
├── query-records.mjs
├── pipeline-summary.mjs
└── stage-changes.mjs
```

Scripts import shared modules via relative paths:
```javascript
import { attioFetch, parseArgs } from './lib/attio-client.mjs';
```

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

## Platform Tools

In addition to scripts, the LLM has access to built-in platform tools for memory and skill management:

| Tool | Purpose |
|------|---------|
| `memory_read` | Read a file from the team's memory store |
| `memory_write` | Write/update a file in the team's memory store |
| `memory_list` | List files in memory by prefix |
| `skill_exec` | Execute a shell command in a skill's sandboxed directory |
| `skill_activate` | Load a skill's reference files (rarely needed — SKILL.md is auto-injected) |
| `skill_read_file` | Read a specific file from a skill's directory |
| `skill_list_files` | List files in a skill's directory |

Skills that only read/write memory (report skills, enrichment skills) may not need any scripts — they use `memory_read`/`memory_write` directly, guided by SKILL.md instructions.

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

### CRM query skill with scripts

```yaml
---
name: Attio CRM Scripts
slug: attio-crm-scripts
description: Query Attio CRM data using standalone scripts. Supports listing records, filtering, counting, and pipeline summaries.
skill-type: standard
category: customer-success
tags: [attio, crm, pipeline, deals, companies, query, scripts]
suggested-connectors: [attio]
suggested-job-type: chat
available-scripts:
  - name: query-records
    description: Search, list, filter, or count Attio object records
  - name: pipeline-summary
    description: Summarise pipeline entries grouped by stage with counts
  - name: get-record
    description: Fetch a single record by ID with optional change history
  - name: pipeline-velocity
    description: Analyse time-in-stage statistics across pipeline records
  - name: stage-changes
    description: Find records whose stage changed within a date range
---
```

### Scheduled report using memory tools

```yaml
---
name: Customer Status Report
slug: customer-status-report
description: Reads enriched customer data from memory and generates a summary report of customer status, recent activity, and key highlights.
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
---
```

### Enrichment skill with scripts and memory writes

```yaml
---
name: CRM Enrichment
slug: crm-enrichment
description: Enriches and maintains per-customer status files by correlating CRM records, meeting notes, and KB documents.
skill-type: standard
category: customer-success
tags: [customers, crm, meetings, enrichment]
suggested-connectors: [attio, hubspot, granola, slack]
suggested-job-type: background
suggested-schedule-frequency: daily
suggested-schedule-hour: 2
memory-paths-writes: [customers/*/status.md, customers/*/notes/*.md, customer-index.md, activity-log/*]
memory-paths-reads: [customers/*/status.md, customers/*/notes/*.md, customer-index.md]
---
```
