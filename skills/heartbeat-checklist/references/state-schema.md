# State Schema

## File Format

JSON file (default: `memory/heartbeat-state.json`).

```json
{
  "version": 1,
  "lastChecks": {
    "<task-name>": <unix-timestamp-ms>
  },
  "lastResults": {
    "<task-name>": {
      "status": "ok|fail|warn",
      "summary": "<human-readable summary or null>",
      "timestamp": <unix-timestamp-ms>
    }
  },
  "windows": {
    "<task-name>": {
      "start": "HH:MM",
      "end": "HH:MM",
      "timezone": "Europe/Dublin"
    }
  }
}
```

## Fields

### version
Schema version. Currently `1`. Allows future migrations.

### lastChecks
Map of task name → last check timestamp (Unix ms). Used by `should-check --min-interval` to decide if enough time has passed.

### lastResults
Map of task name → result object. Stores the outcome of the last check for reference and reactive task logic.

- `status`: One of `ok`, `fail`, `warn`
- `summary`: Free-text summary (null if not provided)
- `timestamp`: When the check was recorded

### windows
Optional. Map of task name → window config. Not directly used by the script (window params are passed via CLI flags), but can be stored here for reference by the agent.

## Lifecycle

- **Created** automatically on first `check` or `should-check` call
- **Updated** on every `check` command
- **Pruned** with the `prune` command (removes entries older than `--max-age`)
- **Reset** per-task with the `reset` command

## Concurrency

This is a simple file-based store. For agents that might have concurrent heartbeat sessions:
- File writes are atomic (write full JSON, no partial updates)
- Last-write-wins if two sessions write simultaneously
- This is acceptable for heartbeat state — a missed or duplicated check is not critical
