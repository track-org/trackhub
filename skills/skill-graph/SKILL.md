---
name: skill-graph
description: Map dependencies, relationships, and connections between skills in a trackhub catalogue. Use when an agent needs to understand which skills depend on each other, find orphan skills with no connections, trace the impact of changing a skill, or get a visual overview of the skill ecosystem. Complements skill-discovery (finds skills) with relationship context (how skills connect).
skill-type: standard
category: agent-ops
tags: [graph, dependencies, relationships, skills, catalogue, audit, impact-analysis, visualization]
suggested-connectors: []
suggested-job-type: manual
suggested-schedule-frequency: on-demand
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: skill-graph
    description: Scan skills directory, detect relationships, and output dependency graph in multiple formats
---

# Skill Graph

Map the web of dependencies, references, and relationships between skills.

## Problem This Solves

`skill-discovery` finds individual skills by keyword. But it doesn't answer:

- "If I change `credential-health`, what breaks?"
- "Which skills are completely standalone?"
- "What's the relationship between `cron-preflight`, `credential-health`, and `graceful-degradation`?"
- "Are there any skills that reference others but aren't referenced back?"

This skill answers those questions.

## How It Works

The script scans all `SKILL.md` files and detects four types of relationships:

| Type | Detection | Example |
|------|-----------|---------|
| **depends** | "pairs with", "depends on", "requires", "uses" | `cron-preflight` → `credential-health` |
| **references** | Named skill mentioned in body text | `nightly-skill-builder` mentions `trackhub-sync` |
| **extends** | "extends", "enhances", "builds on" | `cron-preflight` extends `credential-health` |
| **category-group** | Same `category` in frontmatter | All `agent-ops` skills |

## Script

`scripts/skill-graph.mjs` — Node.js, zero external dependencies.

### Commands

```bash
# Full dependency graph (text tree)
node scripts/skill-graph.mjs graph /path/to/skills

# List all detected relationships
node scripts/skill-graph.mjs relations /path/to/skills

# Find what depends on a specific skill
node scripts/skill-graph.mjs dependents /path/to/skills "credential-health"

# Find what a skill depends on
node scripts/skill-graph.mjs dependencies /path/to/skills "cron-preflight"

# Find orphan skills (no connections)
node scripts/skill-graph.mjs orphans /path/to/skills

# Impact analysis — what's affected if skill X changes
node scripts/skill-graph.mjs impact /path/to/skills "credential-health"

# Category groups
node scripts/skill-graph.mjs categories /path/to/skills

# Dot graph output (for Graphviz visualization)
node scripts/skill-graph.mjs dot /path/to/skills
```

### Output options

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--verbose` | Include detection source (which line triggered the relationship) |
| `--include-self` | Include self-references in output |

## Relationship Detection Rules

The script uses these heuristics to detect relationships from SKILL.md content:

1. **Frontmatter tags**: Skills sharing tags are grouped (weak signal)
2. **Body text patterns**:
   - "pairs with `<name>`" → depends
   - "depends on `<name>`" → depends
   - "requires `<name>`" → depends
   - "uses `<name>`" → depends
   - "extends `<name>`" → extends
   - "enhances `<name>`" → extends
   - "builds on `<name>`" → extends
   - "see `<name>`" → references
   - "refer to `<name>`" → references
3. **Known skill name mentions**: Any known skill name mentioned in the body is flagged as a reference

## Example Output

```
$ node scripts/skill-graph.mjs dependents ./skills "credential-health"

Skills that depend on credential-health (2):
  #1 cron-preflight
     Source: "Pairs with the credential-health skill (detection)"
     Type: depends
  #2 graceful-degradation
     Source: "Pairs with the credential-health skill (detection)"
     Type: depends

$ node scripts/skill-graph.mjs orphans ./skills

Orphan skills (no connections to/from other skills) (3):
  - weather (no references found)
  - slack (no references found)
  - healthcheck (no references found)
```

## Integration Patterns

### Before modifying a skill

```
1. Run: node scripts/skill-graph.mjs impact /path/to/skills "skill-name"
2. Review the affected skills list.
3. If multiple skills are impacted, plan changes carefully.
4. After making changes, re-run to verify relationships are still valid.
```

### Nightly build — audit for stale connections

```
1. Run: node scripts/skill-graph.mjs orphans /path/to/skills --json
2. Check for skills that should have connections but don't.
3. Run: node scripts/skill-graph.mjs graph /path/to/skills
4. Review for unexpected or missing relationships.
```

### Onboarding — understand the ecosystem

```bash
# Get the big picture
node scripts/skill-graph.mjs categories /path/to/skills

# Drill into agent-ops connections
node scripts/skill-graph.mjs relations /path/to/skills --json | jq '.[] | select(.category == "agent-ops")'
```

## Pairing with skill-discovery

- Use **skill-discovery** to find: "Which skill handles cron?"
- Use **skill-graph** to understand: "How do all the cron-related skills connect?"
