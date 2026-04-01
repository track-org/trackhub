---
name: git-workflow
description: Standardized git operations and conventions for trackhub and other OpenClaw-managed repos. Covers commit messages, branch hygiene, conflict resolution, PR workflows, and multi-agent collaboration patterns. Use when committing, branching, merging, rebasing, or reviewing git history.
---

# Git Workflow

Consistent git practices for agent-managed repositories. Keeps history clean, collaboration safe, and rollbacks easy.

## Commit Message Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/) with agent context:

```
<type>(<scope>): <description>

[optional body]

Agent: <agent-name> | Trigger: <heartbeat/cron/manual/chat>
```

### Types

| Type | When |
|------|------|
| `feat` | New skill, script, or capability |
| `fix` | Bug fix or corrected behaviour |
| `refactor` | Code restructure without behaviour change |
| `docs` | Documentation only (SKILL.md, README, etc.) |
| `chore` | Maintenance (deps, config, cleanup) |
| `perf` | Performance improvement |

### Examples

```
feat(attio-crm): add list-deals.mjs with stage filtering
Agent: Shelldon | Trigger: heartbeat nightly build

docs(shared-channel-agent): clarify timing defaults
Agent: Shelldon | Trigger: manual

fix(cron-dashboard): handle missing jobs.json gracefully
Agent: Shelldon | Trigger: cron
```

## Pre-Commit Checklist

Before every commit:

1. **Stage only intentional changes** — `git diff --cached` to review
2. **No secrets** — check for API keys, tokens, passwords
3. **No workspace-only files** — don't commit `memory/`, `MEMORY.md`, or runtime state
4. **Test locally** — run scripts if possible
5. **Single concern** — one logical change per commit

## Branch Strategy

### trackhub (single-main workflow)

```
main ← always stable, always pushable
```

For trackhub specifically:
- Commit directly to `main` for skills and small improvements
- Use feature branches only for large breaking changes or experiments
- Tag releases with `v<semver>` when a skill reaches a stable milestone

### Feature branches (for other repos)

```
feat/<short-description>
fix/<short-description>
```

Keep branches short-lived (< 48h) and rebased on main.

## Conflict Resolution

When conflicts arise:

1. **Stop and assess** — don't blindly accept either side
2. **Understand both changes** — read both versions
3. **Preserve intent** — merge the logic, not just the text
4. **Test after resolving** — ensure nothing broke
5. **Document the conflict** — if non-obvious, note it in the commit body

### Agent-specific conflict patterns

When two agents edit the same file:
- **Same skill**: Coordinate via the shared channel — one agent should own the change
- **Different sections**: Safe to merge if sections are independent
- **SKILL.md conflicts**: Read both versions, combine the useful parts, prefer the more specific guidance

## Safety Rules

- **Never force-push to `main`** unless explicitly approved
- **Never `git push --force`** on shared branches
- **Always pull before push** — `git pull --rebase` to avoid unnecessary merge commits
- **Tag before destructive operations** — `git tag backup-<description>` before risky changes
- **Keep `.gitignore` current** — exclude runtime state, secrets, OS files

## Useful Patterns

### Quick sync
```bash
git pull --rebase origin main && git push origin main
```

### Check what changed since last tag
```bash
git log --oneline $(git describe --tags --abbrev=0)..HEAD
```

### Undo last commit (keep changes staged)
```bash
git reset --soft HEAD~1
```

### Find who changed a line
```bash
git log -p -- <file> | grep -B5 -A5 '<search-text>'
```

### Clean up stale branches
```bash
git branch --merged main | grep -v '^\*\|main' | xargs git branch -d
```

## Multi-Agent Collaboration

When multiple agents share a repo:

1. **Pull before starting** — always get latest state
2. **Communicate intent** — post in the shared channel before major changes
3. **Small commits** — reduces collision surface
4. **Resolve fast** — don't leave conflicts lingering
5. **Respect ownership** — if another agent is actively working on a skill, ask before editing it
