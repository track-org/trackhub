---
name: trackhub-sync
description: Manage skills in the TrackHub git repository — the shared source of truth for all reusable agent skills. Use when creating, editing, improving, or auditing skills in trackhub/skills/, or when setting up a new runtime to consume TrackHub skills.
---

# TrackHub Sync

TrackHub is where all reusable agent skills live and are developed directly. There is no separate local copy step.

This skill documents:
- The convention for building skills in TrackHub
- How to set up a runtime to consume them
- The shared vs local boundary

## Core convention

**Skills are built directly in `trackhub/skills/`.** No publish/consume copy dance.

- `trackhub/skills/` = the shared source of truth for all reusable skills
- `workspace/skills/` = reserved for clawhub-installed skills only (managed by the clawhub CLI)
- Runtime config (`openclaw.json`) points to `trackhub/skills/` via `skills.load.extraDirs`

## Setting up a new runtime to consume TrackHub skills

1. Clone the TrackHub repo
2. Add its `skills/` directory to `openclaw.json` under `skills.load.extraDirs`:

```json
"skills": {
  "load": {
    "extraDirs": ["/path/to/trackhub/skills"]
  }
}
```

3. Restart the agent — skills are now available

That's it. No copying.

## Shared vs local boundary

### Shared in TrackHub

- generic `SKILL.md` files
- generic scripts and helper code
- reference docs and examples
- reusable templates
- documentation for required runtime bindings

### Local only (never in TrackHub)

- secrets or tokens
- `.env` values
- private user context
- memory files
- local paths
- machine-specific commands unless clearly parameterised
- agent-specific identity bindings
- Slack IDs or environment-specific IDs unless explicitly meant as examples

Keep local bindings in workspace notes (`TOOLS.md`, `USER.md`, `.env`) — never in the shared skills.

## Standard repo structure

```text
skills/
  <skill-name>/
    SKILL.md
    references/
    scripts/
    assets/
```

Create only the resource directories actually needed.

## When adding or editing a skill in TrackHub

1. **Check for existing skills first.** Prefer updating an existing skill over creating duplicates.
2. **Follow the shared vs local boundary.** No secrets, no private context, no hardcoded paths.
3. **Write a clear `SKILL.md`.** The description should explain both what the skill does and when to use it. An agent reading it should understand how to use it without local chat history.
4. **Document runtime requirements.** If a skill needs env vars, binaries, or local directories, say so in the SKILL.md or a references doc.
5. **Commit with a clear message.** e.g. `feat(skill-name): add initial version`, `fix(skill-name): remove local path assumptions`.
6. **Push if write access is available.**

## Checklist before committing a skill

- Is this genuinely reusable?
- Does it contain secrets? → Remove them
- Does it contain private user context? → Strip it
- Does it assume one machine or directory layout? → Parameterise
- Does it hardcode one agent's identity? → Genericise
- Would another agent understand how to use it? → If not, clarify
- Is the runtime contract documented? → If not, add it

## Naming rules

- Use lowercase letters, digits, and hyphens only
- Prefer one canonical skill per concept
- Avoid `-v2`, `-new`, `-final` suffixes — update the existing one

## Final rule

The purpose of TrackHub is to preserve the reusable part of agent work while keeping identity, secrets, and local runtime glue where they belong.

Build in place. Share the generic core. Keep local bindings local.
