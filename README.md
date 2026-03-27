# trackhub

Shared repository for reusable agent skills and helper code.

## Principles

- Keep shared skills generic and portable.
- Keep secrets, local paths, private memory, and agent-specific runtime bindings out of the repo.
- Keep agent identity, local config, and machine-specific glue in each agent's local runtime.

## Suggested structure

```text
skills/
  <skill-name>/
    SKILL.md
    references/
    scripts/
    assets/
```

Create only the directories a skill actually needs.

## Runtime bindings

Shared skills should document the local runtime bindings they expect, such as:

- agent identity
- peer names
- environment variables
- required binaries
- local policy constraints

Document the contract generically. Do not commit one machine's private values.
