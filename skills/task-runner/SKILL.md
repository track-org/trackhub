---
name: task-runner
description: Execute a batch of shell commands with per-task timeouts, parallel groups, and clean reporting. Use when an agent needs to run multiple quick checks in one turn (heartbeat batching, cron pre-flight, multi-source aggregation), when you want to maximise productivity within a time window, or when you need to compare results across several commands. Supports JSON manifest input, single-command quick mode, fail-fast, and quiet (exit-code only) mode.
skill-type: standard
category: agent-ops
tags: [task-runner, batching, heartbeat, cron, productivity, timeout, parallel]
suggested-connectors: []
suggested-job-type: heartbeat
available-scripts:
  - name: task-runner
    description: Run batch commands with timeouts and reporting
---

# Task Runner ⚡

Run multiple shell commands in one invocation with per-task timeouts, parallel groups, and structured reporting. Designed for agents that need to maximise productivity within heartbeat or cron windows.

## Why

Heartbeats and cron payloads often need to run several quick checks — credential validation, disk space, git status, etc. Running them one at a time burns tokens on back-and-forth. This script batches them into a single execution with proper timeout isolation so one hanging command doesn't block the rest.

## How to Run

```bash
# Single command (quick mode)
node scripts/task-runner.mjs --task "df -h /" --name "disk check"

# From a JSON manifest file
node scripts/task-runner.mjs --manifest ./tasks.json

# From stdin (pipe-friendly)
echo '[{"cmd":"uptime"},{"cmd":"df -h /"}]' | node scripts/task-runner.mjs --stdin

# JSON output for agent parsing
node scripts/task-runner.mjs --manifest ./tasks.json --json

# Fail on first error, quiet mode
node scripts/task-runner.mjs --manifest ./tasks.json --fail-fast --quiet
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--manifest, -m` | — | Path to JSON manifest file |
| `--stdin` | false | Read manifest from stdin |
| `--task, -T` | — | Single command (quick mode) |
| `--name` | inline | Name for single task |
| `--timeout, -t` | 30 | Default timeout per task (seconds) |
| `--parallel` | 1 | Max parallel tasks (or use groups) |
| `--fail-fast` | false | Stop on first failure |
| `--json` | false | Output as JSON |
| `--quiet` | false | No output, exit code only |

## Manifest Format

JSON array of task objects or plain command strings:

```json
[
  {
    "name": "Check disk space",
    "cmd": "df -h / | tail -1",
    "timeout": 5
  },
  {
    "name": "Validate Gmail token",
    "cmd": "node /path/to/credential-health.cjs --check gmail",
    "timeout": 10
  },
  {
    "name": "Ping API",
    "cmd": "curl -sf https://api.example.com/health",
    "group": "network",
    "timeout": 3
  },
  {
    "name": "DNS check",
    "cmd": "dig +short api.example.com",
    "group": "network",
    "timeout": 3
  },
  "echo simple string task"
]
```

### Task Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | no | Human-readable label (auto-generated if missing) |
| `cmd` | yes | Shell command to execute |
| `timeout` | no | Per-task timeout in seconds (overrides `--timeout`) |
| `group` | no | Tasks in the same group run in parallel |
| `continueOnError` | no | Don't trigger fail-fast for this task |

## Output

### Human-readable (default)

```
Task Results — 4 ok, 1 failed, 0 timed out (2.5s total)
───────────────────────────────────────────────────────
ℹ️  ✅ Check disk space [0.0s]
ℹ️  ❌ Validate Gmail token [0.3s] — Error: invalid_grant
ℹ️  ✅ Ping API [0.1s]
ℹ️  ✅ DNS check [0.0s]
ℹ️  ✅ simple string task [0.0s]
```

### JSON (--json)

```json
{
  "results": [...],
  "totalTimeMs": 2503,
  "summary": { "ok": 4, "failed": 1 }
}
```

Each result includes: `name`, `cmd`, `status` (ok/error/timeout), `exitCode`, `durationMs`, `stdout` (last 2KB), `stderr` (last 1KB).

## Parallel Execution

Two ways to run tasks in parallel:

1. **Group-based**: Tasks with the same `group` field run together
2. **Max-parallel**: Use `--parallel N` to chunk all tasks into batches of N

```bash
# Run up to 3 tasks at once
node scripts/task-runner.mjs --manifest tasks.json --parallel 3

# Run network checks in parallel, others sequential
node scripts/task-runner.mjs --manifest tasks.json
```

## Use Cases

### Heartbeat Batching

Combine multiple checks into one exec call during heartbeats:

```
1. Run: node task-runner.mjs --manifest /path/to/heartbeat-tasks.json --json --timeout 10
2. Parse JSON results.
3. If any task failed, investigate and alert.
4. If all ok, reply HEARTBEAT_OK.
```

### Cron Pre-flight

Validate all dependencies before a cron job's main logic:

```
1. Run: node task-runner.mjs --task "node credential-health.cjs --check gmail --quiet" --name "gmail-ok" --quiet
2. If exit code is 0, proceed with the Gmail digest.
3. If exit code is 1, reply NO_REPLY (credential broken, already alerted).
```

### Multi-source Aggregation

Gather data from multiple scripts and combine:

```
1. Run: node task-runner.mjs --manifest data-sources.json --json
2. Parse results. For each task with status "ok", extract stdout.
3. Combine into a summary message.
```

## Dependencies

- `shared-lib` — arg parsing (`lib/args.mjs`) and output formatting (`lib/fmt.mjs`)
- Node.js 18+
- `bash` (tasks run via bash -c)
