---
name: skill-test
description: Runtime validation for skill scripts — verify they exist, are declared in frontmatter, and execute without crashing. Use when testing the trackhub skill catalogue, CI checks on skill scripts, validating a new skill's scripts run correctly, or auditing which skills have runtime issues versus just documentation problems.
skill-type: standard
category: quality
tags: [testing, skills, ci, validation, scripts, runtime]
suggested-connectors: []
suggested-job-type: manual
suggested-schedule-frequency: on-demand
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: skill-test
    description: Run runtime validation across all (or a specific) skill's scripts
---

# Skill Test

Runtime validation for scripts across the trackhub skill catalogue. Goes beyond static analysis (skill-lint) by actually executing scripts to verify they don't crash.

## Why

`skill-lint` checks documentation quality — frontmatter, headings, descriptions. But it can't tell you if a script actually runs. `skill-test` fills that gap:

- Scripts declared in `available-scripts` but missing from `scripts/`
- Scripts that exist but aren't declared in frontmatter
- Scripts that crash when executed (syntax errors, missing deps, runtime failures)

Think of it as: skill-lint is the linter, skill-test is the test suite.

## Script

`scripts/skill-test.cjs` — Zero dependencies. Node.js 12+. CJS for arm64 compatibility.

## Requirements

- Node.js 12+
- Python 3 (for `.py` scripts)
- Bash (for `.sh` scripts)
- The skill catalogue directory with `SKILL.md` files and `scripts/` subdirectories

## Usage

```bash
# Test all skills in the catalogue
node skill-test.cjs

# Test a specific skill
node skill-test.cjs --skill skill-lint

# Use a custom skills directory
node skill-test.cjs --dir /path/to/skills

# Test with --dry-run instead of --help
node skill-test.cjs --dry-run

# JSON output (great for CI)
node skill-test.cjs --json

# Only show failures and warnings
node skill-test.cjs --quiet

# Verbose — show stderr on failures
node skill-test.cjs --verbose
```

## Flags

| Flag | Description |
|------|-------------|
| `--dir <path>` | Skills catalogue root (default: parent dir) |
| `--skill <name>` | Test only a specific skill |
| `--dry-run` | Test scripts with `--dry-run` flag instead of `--help` |
| `--json` | JSON output for CI/programmatic use |
| `--quiet` | Only show failures and warnings |
| `--verbose` | Show full stderr on failures |
| `--help` | Show usage |

## What It Checks

### 1. Exists — Declared scripts are present

Parses `available-scripts` from SKILL.md frontmatter and verifies each script file exists in `scripts/`.

### 2. Declared — Undeclared scripts are flagged

Finds scripts in `scripts/` that aren't listed in `available-scripts`. Warns only — some scripts (helpers, libs) may intentionally be unlisted.

### 3. Runs — Scripts execute without crash

Runs each script with `--help` (or `--dry-run` with the `--dry-run` flag) and checks the exit code. Passes if the script exits cleanly (0, 1, or 2 — all valid for help/error output).

Scripts are auto-detected by extension:
- `.py` → `python3`
- `.sh` → `bash`
- `.mjs` → `node`
- `.cjs` / `.js` → `node`

Each script has a 15-second timeout.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All checks passed |
| 1 | One or more failures |

## Integration with CI

Add to a CI pipeline to catch broken scripts before they land:

```bash
# Fail the build if any script is broken
node skill-test.cjs --json --quiet
```

## Pairing with skill-lint

Run both for complete coverage:

```bash
# Documentation quality
node skill-lint.cjs --quiet

# Runtime validation
node skill-test.cjs --quiet
```

Together they cover the full picture: "does the documentation look right?" and "does the code actually run?"

## Limitations

- Can't validate scripts that require external credentials (they may crash for valid reasons)
- Can't test scripts that need network access or specific runtime state
- `--dry-run` mode depends on scripts implementing a dry-run flag
- Scripts in subdirectories (e.g., `scripts/lib/`) are skipped
