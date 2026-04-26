---
name: system-health
description: >
  Check system health metrics — disk space, memory, CPU usage, temperature, uptime,
  load averages, OpenClaw gateway status, and Docker containers. Designed for Linux hosts
  including Raspberry Pi. Use when monitoring server health, checking resource usage
  during heartbeats, diagnosing performance issues, or getting a quick system overview.
  Supports JSON output, quiet mode (warnings-only), and configurable thresholds.
---

# System Health

Quick system health check for Linux hosts. Covers all the metrics you'd want during a heartbeat or proactive monitoring pass — disk, memory, CPU, temperature, uptime, load, OpenClaw gateway, and Docker containers.

## Why

You're running OpenClaw on a Raspberry Pi or Linux server. You want to know if the disk is filling up, memory is getting tight, or the Pi is overheating — without logging in and running a bunch of commands. This skill gives you a one-shot overview with configurable warning thresholds.

## Script

`scripts/system-health.cjs` — Zero dependencies. Node.js 18+. Linux only (reads `/proc` and `/sys`).

## Usage

```bash
# Full system health overview
node system-health.cjs

# JSON output for programmatic use
node system-health.cjs --json

# Quiet mode: only output if there are warnings (exit 1 = warning, 0 = ok)
node system-health.cjs --quiet

# Check a single metric
node system-health.cjs --check disk
node system-health.cjs --check memory --json
node system-health.cjs --check temp

# Custom warning thresholds
node system-health.cjs --warn-disk 90 --warn-temp 80
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--json` | | false | Output as JSON |
| `--quiet` | `-q` | false | Only output warnings (suppress normal output) |
| `--check` | | *(all)* | Only check one metric: `cpu`, `memory`, `disk`, `temp`, `uptime`, `load`, `openclaw`, `docker` |
| `--warn-disk` | | 80 | Disk usage warning threshold (percentage) |
| `--warn-mem` | | 85 | Memory usage warning threshold (percentage) |
| `--warn-cpu` | | 90 | CPU usage warning threshold (percentage) |
| `--warn-temp` | | 75 | Temperature warning threshold (°C) |
| `--help` | `-h` | | Show usage |

## Metrics Collected

| Metric | Source | Notes |
|--------|--------|-------|
| CPU usage | `/proc/stat` (two samples) | 500ms sampling interval |
| Load averages | `/proc/loadavg` | 1min, 5min, 15min |
| Memory | `/proc/meminfo` | Used vs total (MemAvailable-based) |
| Disk | `df` | Root, /home, /mnt mounts |
| Temperature | `/sys/class/thermal/` or `vcgencmd` | Pi-compatible |
| Uptime | `/proc/uptime` | Days, hours, minutes |
| OpenClaw gateway | `pgrep` + `ps` | PID and RSS memory |
| Docker containers | `docker ps` | Gracefully skips if Docker not installed |

## Output Format (default)

```
🖥️  System Health — raspberrypi
   Uptime: 14d 6h 23m
   CPU:    12.3%  (load: 0.8 / 0.6 / 0.5)
   Memory: 1.2 GB / 4.0 GB (30.1%)
   Temp:   52.1°C (125.8°F) [thermal_zone0]
   Disks:
     /  24.3 GB / 64.0 GB (38%)
     /boot  0.1 GB / 0.3 GB (33%)
   OpenClaw: Running (PID 12345, 312 MB RSS)
   Docker: 2 container(s)
     traefik: Up 14 days
     homeassistant: Up 14 days

✅ All checks passed
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All checks passed (or quiet mode with no warnings) |
| 1 | One or more warnings |
| 2 | Invalid arguments |

## Integration with Heartbeats

Use `--quiet` mode in heartbeats to only alert when something's wrong:

```
1. Run: node /path/to/system-health.cjs --quiet
2. If exit code is 0, reply HEARTBEAT_OK.
3. If exit code is 1, include the warning output in your response to Don.
```

For JSON-based heartbeat integration:

```
1. Run: node /path/to/system-health.cjs --json
2. Parse the warnings array.
3. If warnings is empty, no action needed.
4. If warnings has entries, format and send to Don.
```

## Integration with Cron

Pair with the [cron-preflight](../cron-preflight/SKILL.md) skill for scheduled system health monitoring:

```json
{
  "name": "Daily system health check",
  "schedule": { "kind": "cron", "expr": "0 8 * * *", "tz": "Europe/Dublin" },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Check system health. Run: node /path/to/system-health.cjs --quiet. If exit code 0, reply NO_REPLY. If exit code 1, send the warning output as a Slack message."
  }
}
```

## Limitations

- Linux only (relies on `/proc` and `/sys` filesystems)
- CPU usage requires a 500ms sampling delay
- Docker check requires Docker CLI and daemon
- Temperature detection varies by hardware (works on Pi and most Linux SBCs)
- Disk check filters out tmpfs, devtmpfs, and squashfs mounts
