---
name: prompt-library
description: Manage reusable prompt templates and snippets for cron jobs, heartbeats, and agent turns. Search, compose, validate, and version prompts. Use when building cron payloads, reducing token waste with battle-tested prompt fragments, or standardising agent behaviour across jobs
skill-type: standard
skill-type: standard
category: agent-ops
tags: [prompts, templates, snippets, composition, cron, tokens, standardisation]
suggested-connectors: []
suggested-job-type: manual
suggested-schedule-frequency: on-demand
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: prompt-library
    description: Manage, search, compose, and validate reusable prompt templates
---

# Prompt Library

A version-controlled collection of reusable prompt templates and snippets for agent turns, cron jobs, and heartbeats. Search, compose, validate, and manage prompts to reduce token waste and standardise agent behaviour.

## Why

Agents repeat the same patterns across cron payloads and heartbeats:

- Credential pre-flight blocks
- Output formatting instructions
- Error handling directives
- Quiet hours / time-awareness clauses
- Graceful degradation instructions

Copying these by hand wastes tokens, introduces inconsistencies, and makes maintenance painful when you need to update a pattern across 10 jobs. This skill gives you a single source of truth for prompt building blocks.

## How It Works

Prompt templates live as simple markdown files in a `prompts/` directory (configurable). Each file is a self-contained snippet with YAML frontmatter for metadata:

```markdown
---
name: credential-preflight
description: Standard credential pre-flight check block for cron jobs
tags: [cron, credentials, preflight, safety]
usage-count: 0
---

## Credential Pre-flight
Run: node /path/to/credential-health.cjs --check <service> --fail-only --json
If the result contains any entries with "status": "fail":
  - Reply with a concise summary of which credential(s) failed.
  - Do NOT proceed with the main task below.
  - Do NOT send to Slack or any other channel.
If all checks pass (or all "skip"), proceed to the main task.
```

The script provides commands to search, list, compose (merge multiple snippets), validate, and create new templates.

## Script

`scripts/prompt-library.cjs` — Zero dependencies. Node.js 18+.

## Usage

```bash
# List all templates
node prompt-library.cjs list

# List with full content
node prompt-library.cjs list --full

# Search by keyword or tag
node prompt-library.cjs search credential
node prompt-library.cjs search --tag cron

# Compose: merge multiple templates into one payload
node prompt-library.cjs compose credential-preflight,quiet-hours,output-format

# Validate: check templates for common anti-patterns
node prompt-library.cjs validate
node prompt-library.cjs validate --template credential-preflight

# Show a single template
node prompt-library.cjs show credential-preflight

# Create a new template from scratch
node prompt-library.cjs create my-template --desc "Description here"

# Stats: overview of the library
node prompt-library.cjs stats

# Diff: compare two template versions (if git-tracked)
node prompt-library.cjs diff credential-preflight

# JSON output for programmatic use
node prompt-library.cjs list --json
node prompt-library.cjs search --tag cron --json
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--prompts-dir` | `-p` | `./prompts/` | Directory containing prompt templates |
| `--json` | | false | JSON output for programmatic use |
| `--full` | | false | Include full template content in listings |
| `--tag` | `-t` | *(none)* | Filter by tag |
| `--template` | | *(none)* | Target a specific template by name |
| `--help` | `-h` | | Show usage |

## Subcommands

### `list`
List all templates with metadata. Use `--full` to include content, `--tag X` to filter.

### `search <query>`
Fuzzy search across template names, descriptions, and content. Use `--tag X` for exact tag match.

### `compose <template1,template2,...>`
Merge multiple templates into a single composed payload. Templates are joined with blank lines, in the order specified. Useful for building cron payloads from reusable blocks.

### `validate [options]`
Check templates for common anti-patterns:
- Missing frontmatter fields (name, description)
- Empty content
- Overly long templates (>2000 chars warning)
- Duplicate tags across templates
- Templates with no tags

Use `--template X` to validate a single template.

### `show <name>`
Display the full content of a specific template.

### `create <name>`
Create a new template skeleton with frontmatter. Use `--desc "..."` to set the description. Opens in your editor if `$EDITOR` is set, or outputs the path.

### `stats`
Show library statistics: total templates, average size, most-used tags, template age.

### `diff <name>`
Show git diff for a template file (if the prompts directory is git-tracked). Useful for reviewing changes before committing.

## Template Format

Each template is a `.md` file in the prompts directory. The filename (without extension) becomes the template name.

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Template identifier (kebab-case) |
| `description` | ✅ | What this template does |
| `tags` | ✅ | Array of tags for search/filter |
| `version` | | Semantic version (default: "1.0.0") |
| `author` | | Who created it |
| `usage-count` | | Manual counter for tracking adoption |

### Placeholders

Templates can include `{{placeholder}}` syntax for values that should be filled in at compose time:

```markdown
Run: node {{credential_health_path}} --check {{service}} --fail-only --json
```

The `compose` command will flag any unresolved placeholders in the output.

## Output Format

### List
```
📚 Prompt Library — 8 templates in ./prompts/

  credential-preflight   Standard credential pre-flight check block    [cron, safety]
  quiet-hours            Time-aware quiet hours directive               [time, heartbeat]
  output-format          Concise output formatting instructions        [formatting]
  error-handling         Standard error handling for cron jobs         [cron, errors]
```

### Compose
```
📋 Composed payload (3 templates):
   credential-preflight + quiet-hours + output-format

─────────────────────────────────────
## Credential Pre-flight
Run: node /path/to/credential-health.cjs ...

## Quiet Hours
Between 23:00 and 08:00, do not send notifications...

## Output Format
Keep responses under 500 characters...
─────────────────────────────────────

⚠️  1 unresolved placeholder: {{service}}
```

### Validate
```
✅ 7/8 templates valid
⚠️  error-handling: no tags defined
⚠️  old-template: content exceeds 2000 chars (3,241 chars)
```

## Integration Ideas

- **Cron payload builder**: Use `compose` to assemble cron job instructions from standard blocks
- **Skill documentation**: Reference prompt templates in SKILL.md files for consistency
- **Onboarding**: New agents can quickly discover available prompt patterns with `search`
- **Code review**: Use `diff` before committing template changes

## Complementary Skills

- **skill-scaffold** — Creates new skills (which may need prompt templates)
- **openclaw-cron** — Cron job management (natural consumer of composed prompts)
- **quick-reports** — Output formatting patterns (can be templatized)
- **skill-discovery** — Find skills by keyword (similar concept, different domain)

## Limitations

- Templates are static files — no runtime variable interpolation beyond placeholder detection
- No built-in template inheritance or includes (compose is the composition mechanism)
- Usage-count is manual — no automatic tracking of which cron jobs use which templates
- Fuzzy search is basic substring matching, not semantic search
