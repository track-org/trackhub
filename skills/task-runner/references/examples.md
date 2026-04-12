# Task Runner — Example Manifests

## Heartbeat Batch

A set of quick health checks for a heartbeat session:

```json
[
  { "name": "Disk space", "cmd": "df -h / | tail -1", "timeout": 5 },
  { "name": "Memory", "cmd": "free -h | head -2", "timeout": 5 },
  { "name": "System load", "cmd": "cat /proc/loadavg", "timeout": 3 },
  { "name": "Git status", "cmd": "cd /path/to/repo && git status --short", "timeout": 10 }
]
```

## Credential Pre-flight

Validate all API credentials before running dependent cron jobs:

```json
[
  { "name": "Gmail", "cmd": "node /path/to/credential-health.cjs --check gmail --quiet", "timeout": 10 },
  { "name": "Slack", "cmd": "node /path/to/credential-health.cjs --check slack --quiet", "timeout": 10 },
  { "name": "Attio", "cmd": "node /path/to/credential-health.cjs --check attio --quiet", "timeout": 10 },
  { "name": "Supabase", "cmd": "node /path/to/credential-health.cjs --check supabase --quiet", "timeout": 10 }
]
```

## Multi-source Data Collection

Gather data from multiple sources, parallel where independent:

```json
[
  { "name": "Weather", "cmd": "curl -sf 'wttr.in/Dublin?format=%t+%C'", "timeout": 10 },
  { "name": "Solar output", "cmd": "node /path/to/solis-check.mjs --json", "timeout": 15 },
  { "name": "Grid usage", "cmd": "node /path/to/emporia-today.mjs --json", "timeout": 15, "group": "energy" },
  { "name": "Export status", "cmd": "node /path/to/solis-export.mjs --json", "timeout": 15, "group": "energy" }
]
```

## Quick One-liner

Single task without a manifest:

```bash
node task-runner.mjs --task "git status --short" --name "git" --json
```
