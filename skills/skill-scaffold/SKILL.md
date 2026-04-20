---
name: skill-scaffold
description: >
  Generate boilerplate for new trackhub skills — directory structure, SKILL.md template,
  script stubs, and frontmatter. Ensures consistency with the existing catalogue and
  integrates with skill-lint and skill-test for validation. Use when creating a new skill
  from scratch, bootstrapping a skill idea into a working skeleton, or onboarding new
  contributors to the skill catalogue.
---

# Skill Scaffold 🏗️

Generate a new skill skeleton with one command. Produces a ready-to-customise directory
with SKILL.md, script stubs, and all the conventions baked in.

## Why

Building skills by hand every time means remembering frontmatter fields, directory layout,
script naming conventions, and lint rules. `skill-scaffold` eliminates that overhead and
ensures every new skill starts consistent with the catalogue standards.

It pairs with:
- **skill-lint** — validates the generated SKILL.md passes all quality checks
- **skill-test** — validates any script stubs are declared and executable

## Script

`scripts/skill-scaffold.cjs` — Zero dependencies. Node.js 18+.

## Usage

```bash
# Interactive: prompts for name, description, script type
node skill-scaffold.cjs --name my-new-skill

# One-shot with all options
node skill-scaffold.cjs --name my-new-skill \
  --desc "Does X and Y for Z" \
  --scripts "check.cjs,validate.sh" \
  --output /path/to/trackhub/skills/

# Dry run: shows what would be created without writing files
node skill-scaffold.cjs --name my-new-skill --dry-run

# Use a template
node skill-scaffold.cjs --name my-new-skill --template cron
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--name` | `-n` | *(required)* | Skill name (kebab-case, e.g. `my-skill`) |
| `--desc` | `-d` | `""` | Skill description for frontmatter |
| `--scripts` | `-s` | `[]` | Comma-separated list of script filenames to create |
| `--output` | `-o` | `./skills/` | Base directory for skill catalogues |
| `--template` | `-t` | `default` | Template: `default`, `cron`, `read-only-api`, `heartbeat` |
| `--dry-run` | | false | Show what would be created without writing |
| `--json` | | false | Output result as JSON |
| `--lint` | | false | Run skill-lint after creation (if available) |
| `--force` | | false | Overwrite existing skill directory if it exists |

## Templates

### default
Standard skill structure: SKILL.md + scripts/ + references/ directories.

### cron
Pre-wired for cron job skills. Includes preflight pattern in SKILL.md and a script stub
with credential-health integration. Useful for API-dependent scheduled tasks.

### read-only-api
Optimised for skills that query external APIs (Attio, Emporia, Solis, etc.).
Includes API key env var documentation, error handling patterns, and rate-limit awareness.

### heartbeat
Designed for skills triggered during heartbeat checks. Includes time-awareness
integration, quiet-hours handling, and stateful check tracking.

## Generated Structure

```
my-new-skill/
├── SKILL.md          # Full template with frontmatter, sections, usage examples
├── scripts/
│   └── my-new-skill.cjs  # Script stub with CLI arg parsing
└── references/       # Empty directory for supporting docs
```

## SKILL.md Template

The generated SKILL.md includes:
- Proper YAML frontmatter (name, description)
- "Why" section explaining the skill's purpose
- "Script" section pointing to the script
- "Usage" section with CLI examples
- "Flags" table
- "Integration" section for related skills
- "Limitations" section

## Script Stub

Generated scripts include:
- CLI argument parsing (`--json`, `--help`, `--quiet`)
- Proper exit codes (0 success, 1 error, 2 validation failure)
- Header comment with skill name and purpose
- Try/catch with friendly error messages

## Examples

### Create a cron monitoring skill

```bash
node skill-scaffold.cjs --name cron-anomaly-detector \
  --desc "Detect anomalous cron job behaviour — unusual token usage, timing drift, or repeated failures" \
  --scripts "detect.cjs" \
  --template cron \
  --output ./trackhub/skills/ \
  --lint
```

### Quick skeleton for a heartbeat skill

```bash
node skill-scaffold.cjs --name air-quality-checker \
  --template heartbeat \
  --output ./trackhub/skills/
```

### Dry run to preview

```bash
node skill-scaffold.cjs --name weather-alert --dry-run
```

## Integration

After scaffolding, run these to validate:
```bash
# Lint the SKILL.md
node skill-lint.cjs --skill my-new-skill

# Test the scripts
node skill-test.cjs --skill my-new-skill
```

## Limitations

- Does not write actual skill logic — you still need to implement the scripts
- Templates are starting points, not complete solutions
- Cannot modify existing skills (use `--force` only if you're sure)
- No Git integration — you'll need to `git add` and commit manually
