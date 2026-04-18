---
name: skill-lint
description: Lint SKILL.md files across a skill catalogue for quality and consistency. Checks frontmatter, description quality, script references, heading structure, and common issues. Use when auditing skills, cleaning up the catalogue, or catching problems before publishing
---

# Skill Lint

Validate SKILL.md files across an entire skill catalogue for quality and consistency. Catches common issues like missing frontmatter, overly long/short descriptions, broken script references, and structural problems — before they confuse agents or break discovery.

## Why

A skill catalogue grows organically. Over time, descriptions get too long, scripts get renamed without updating docs, frontmatter goes missing, and naming conventions drift. Running a lint pass before publishing or during nightly maintenance keeps the catalogue clean and searchable.

## Script

`scripts/skill-lint.cjs` — Node.js CJS, zero external dependencies (ES5 for arm64 compatibility).

## Rules

| Rule | Severity | What it checks |
|------|----------|----------------|
| `frontmatter` | error | YAML frontmatter exists with `name` and `description` fields; name matches directory |
| `has-content` | error | SKILL.md body is more than 50 chars (not just frontmatter) |
| `description-quality` | warn | Description is 20-300 chars, no trailing period |
| `no-todos` | warn | No TODO/FIXME/HACK markers left in the file |
| `script-exists` | info | Referenced scripts in backtick paths actually exist |
| `heading-structure` | info | H1 heading exists and loosely matches skill name |
| `section-order` | info | "Why" and "Script" sections appear before "Usage" |
| `references-valid` | info | Referenced skill names exist in the catalogue |

## Usage

```bash
# Lint all skills in the catalogue
node skill-lint.cjs

# Only errors and warnings (skip info)
node skill-lint.cjs --severity warn

# Lint a specific skill
node skill-lint.cjs credential-health

# Run only one rule
node skill-lint.cjs --rule frontmatter

# JSON output for pipelines
node skill-lint.cjs --json

# Only show skills with issues
node skill-lint.cjs --quiet

# Auto-fix (trailing periods on descriptions)
node skill-lint.cjs --fix

# Point to a different skills directory
node skill-lint.cjs --dir /path/to/skills

# List all available rules
node skill-lint.cjs --list-rules
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--dir <path>` | parent of `scripts/` | Skills directory to scan |
| `--rule <id>` | all rules | Only run a specific rule |
| `--severity <s>` | `info` | Min severity: `error`, `warn`, or `info` |
| `--json` | false | JSON output |
| `--quiet` | false | Only show skills with issues |
| `--fix` | false | Auto-fix trailing periods on descriptions |
| `--list-rules` | — | List all rules and exit |
| `--help` | — | Show usage |

## Exit Codes

- `0` — All skills pass
- `1` — One or more issues found

## Integration

### Nightly Maintenance

Run during a heartbeat or cron to catch catalogue drift:

```bash
node skill-lint.cjs --severity warn --quiet
```

### Pre-publish Check

Before pushing a new or edited skill:

```bash
node skill-lint.cjs my-new-skill
```

### CI Pipeline

```bash
node skill-lint.cjs --severity error --json > lint-report.json
```

## Limitations

- Only checks SKILL.md files — doesn't validate script syntax or test scripts
- Script reference detection uses regex patterns — may miss some reference styles
- Heading structure matching is fuzzy (strips non-alphanumeric) — intentionally lenient
- `--fix` only handles description trailing periods; other fixes are manual
- Doesn't check for broken external URLs or cross-references outside the catalogue
