---
name: skill-discovery
description: Search and discover the right skill for a task by indexing skill metadata (name, description, tags) and matching against natural language queries. Use when an agent or human asks "which skill handles X?", "is there a skill for Y?", or needs to quickly find the best skill for a given workflow. Also useful during nightly builds or onboarding to audit the skill catalogue.
skill-type: standard
category: agent-ops
tags: [discovery, search, indexing, skills, catalogue, onboarding]
suggested-connectors: []
suggested-job-type: manual
suggested-schedule-frequency: on-demand
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: skill-discovery
    description: Index skills from a directory and search by keyword or natural language query
---

# Skill Discovery

Find the right skill for any task by searching an indexed catalogue of skill metadata.

## Problem This Solves

With 20+ skills in a trackhub, figuring out which one handles a specific need requires reading multiple SKILL.md files. This skill provides instant keyword and tag matching across the entire catalogue.

## Script

`scripts/skill-discovery.mjs` — Node.js, zero external dependencies.

## Usage

### Index and list all skills

```bash
node scripts/skill-discovery.mjs list /path/to/skills
```

### Search by keywords

```bash
node scripts/skill-discovery.mjs search /path/to/skills "solar energy"
node scripts/skill-discovery.mjs search /path/to/skills "cron job"
node scripts/skill-discovery.mjs search /path/to/skills "notification throttle"
```

### Search by tags

```bash
node scripts/skill-discovery.mjs tags /path/to/skills "monitoring"
node scripts/skill-discovery.mjs tags /path/to/skills "cron,alerts"
```

### Show full details for a skill

```bash
node scripts/skill-discovery.mjs show /path/to/skills "solis-energy"
```

### Category summary

```bash
node scripts/skill-discovery.mjs categories /path/to/skills
```

### Output options

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--limit <n>` | Max results (default: 10) |
| `--all` | Show all results (no limit) |
| `--verbose` | Include full description in search results |

## How It Works

1. Scans the skills directory for `*/SKILL.md` files
2. Parses YAML frontmatter to extract `name`, `description`, `tags`, `category`
3. Builds a lowercase keyword index from name + description + tags
4. Ranks results by match count (more keyword hits = higher relevance)

Search uses simple word-based matching — no NLP, no embeddings. Fast and reliable.

## Example Output

```
$ node scripts/skill-discovery.mjs search ./skills "cron health check"

Results for "cron health check" (2 matches):
  #1 smart-notifier [agent-ops]
     Alert notifications with throttling, cooldowns, dedup
     Tags: notifications, throttling, dedup, cooldown, alerts, cron, monitoring
     
  #2 cron-health [agent-ops]
     Monitor cron job health — errors, failures, stale runs
     Tags: cron, health, monitoring, debugging
```

## Integration Patterns

### In a heartbeat or cron job

```
1. Run: node scripts/skill-discovery.mjs search /path/to/skills "your query" --json
2. Parse the JSON to find the best matching skill name.
3. Read that skill's SKILL.md and follow its instructions.
```

### For onboarding a new runtime

```bash
# Quick overview of what's available
node scripts/skill-discovery.mjs categories /path/to/skills

# Find all monitoring-related skills
node scripts/skill-discovery.mjs tags /path/to/skills "monitoring"
```
