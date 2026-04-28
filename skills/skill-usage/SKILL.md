---
name: skill-usage
description: Scan cron jobs to discover which trackhub skills are actively used, referenced, or orphaned. Use when auditing skill adoption, finding unused skills, understanding which skills your cron fleet depends on, or cleaning up the catalogue.
skill-type: standard
category: agent-ops
tags: [usage, audit, cron, skills, catalogue, orphan-detection, hygiene]
suggested-connectors: []
suggested-job-type: manual
suggested-schedule-frequency: on-demand
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: skill-usage
    description: Scan cron jobs and skills directory to report active, referenced, and orphaned skills
---

# Skill Usage

Discover which trackhub skills are actively used by your cron jobs — and which ones are just sitting there.

## Problem This Solves

As a skill catalogue grows past 20-30 skills, it's easy to lose track of what's actually being used:

- "Which skills do my cron jobs depend on?"
- "Are there skills I built but never wired up?"
- "If I delete this skill, will anything break?"

`skill-discovery` finds skills by keyword. `skill-graph` maps inter-skill dependencies. But neither answers the question: **which skills does my cron fleet actually use?**

This skill does.

## Script

`scripts/skill-usage.mjs` — Zero dependencies. Node.js 18+.

## How It Works

1. Reads your OpenClaw cron jobs file (`~/.openclaw/cron/jobs.json`)
2. Discovers all skills in the trackhub `skills/` directory
3. Scans each enabled cron job's payload for skill references (directory names, script paths, skill names)
4. Classifies each skill as **active** (referenced by ≥1 enabled cron job) or **orphaned** (not referenced)
5. Reports which jobs use which skills

### Important Caveat

Most trackhub skills are designed for **on-demand agent use** (the agent reads SKILL.md when it needs the skill). Only skills explicitly referenced in cron job payloads show up as "active." An orphaned skill isn't necessarily useless — it just means no cron job directly references it. This is expected and correct.

## Usage

```bash
# Full report
node skill-usage.mjs

# Only active skills
node skill-usage.mjs --active-only

# Only orphaned skills (useful for cleanup decisions)
node skill-usage.mjs --orphans-only

# JSON output for programmatic use
node skill-usage.mjs --json

# Warnings only (exits 0 if no orphans)
node skill-usage.mjs --quiet

# Custom paths
node skill-usage.mjs --cron /path/to/jobs.json --skills /path/to/skills
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--cron <path>` | `~/.openclaw/cron/jobs.json` | Path to cron jobs file |
| `--skills <path>` | `../../` (trackhub/skills/) | Path to skills directory |
| `--json` | false | JSON output |
| `--quiet` | false | Warnings only (orphans + unused) |
| `--active-only` | false | Only show actively-used skills |
| `--orphans-only` | false | Only show orphaned skills |
| `--help` | | Show usage |

## Output Format

```
📊 Skill Usage Report
49 skills · 3 active · 46 orphaned · 5/12 jobs enabled

🟢 Active Skills (3):
   credential-health → Attio stage changes to #product, Daily Gmail digest
   attio-crm → Attio stage changes to #product
   solis-energy → Solar export WhatsApp nudge

⚪ Orphaned Skills (46 — not referenced by any cron job):
   energy-cost — Calculate energy costs from kWh readings...
   system-health — Check system health metrics...
```

## Integration Ideas

- **Nightly audit**: Run `--orphans-only --quiet` in a heartbeat or cron job to flag catalogue growth
- **Before deletion**: Run `--json` and check the `active` list before removing a skill
- **CI check**: Fail if the number of orphaned skills exceeds a threshold

## Complementary Skills

- **skill-discovery** — Find skills by keyword/intent
- **skill-graph** — Map inter-skill dependencies
- **skill-lint** — Check SKILL.md quality
- **skill-test** — Validate scripts run correctly
