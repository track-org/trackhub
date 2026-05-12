---
name: cron-retry
description: "Retry failed OpenClaw cron jobs with exponential backoff and transient-error detection. Catches network timeouts, rate limits, and temporary API errors. Use when a cron job failed and you want intelligent retry."
skill-type: standard
category: cron-ops
tags: [cron, retry, backoff, resilience, transient-error, recovery]
suggested-connectors: [cron-health, cron-first-aid, graceful-degradation]
available-scripts:
  - name: cron-retry.mjs
    description: Scan failed cron runs and retry them with exponential backoff and transient-error classification.
---

# Cron Retry

Automatically retry failed OpenClaw cron jobs with exponential backoff, max attempt limits, and smart error classification.

## Why

Cron jobs fail for many reasons — some permanent (bad config), some transient (network blip, rate limit, temporary API error). Currently, a failed cron run just sits there until the next scheduled run. This skill closes that gap:

- **Transient errors** (network timeout, 429 rate limit, temporary API 500) → retry with backoff
- **Permanent errors** (bad config, missing script, auth revoked) → don't retry, alert instead
- **Unknown errors** → retry once conservatively

This pairs naturally with `cron-health` (detection), `cron-first-aid` (diagnosis), and `graceful-degradation` (alert management).

## Script

`scripts/cron-retry.mjs` — Zero dependencies. Node.js 18+. Uses shared-lib.

## Usage

```bash
# Check for retryable failures across all jobs (dry run)
node cron-retry.mjs --dry-run

# Retry all retryable failed runs
node cron-retry.mjs

# Retry a specific job
node cron-retry.mjs --job "Gmail digest"

# Retry a specific job by ID
node cron-retry.mjs --job 10782216-8d1b-4834-9d38-4732be0c5c88

# Custom retry settings
node cron-retry.mjs --max-attempts 3 --base-delay 120 --max-delay 900

# JSON output
node cron-retry.mjs --json

# Only show what's retryable (don't actually retry)
node cron-retry.mjs --list-only
```

## How It Works

1. **Fetches recent cron run history** for all (or specified) jobs via `openclaw cron runs`
2. **Identifies failed runs** (status ≠ `ok`) from the last N hours (default: 6)
3. **Classifies errors** as transient or permanent based on run metadata and optional transcript analysis
4. **Checks retry state** in `memory/cron-retry-state.json` to respect max attempts
5. **Calculates backoff delay** based on attempt number
6. **Triggers a retry** via `openclaw cron run` after the delay
7. **Records the retry** in state for tracking

## Error Classification

### Transient (retryable)
| Pattern | Detection |
|---------|-----------|
| Network timeout | `ETIMEDOUT`, `ECONNRESET`, `fetch failed` |
| Rate limit | HTTP 429, `rate limit`, `too many requests` |
| Temporary API error | HTTP 5xx, `internal server error`, `service unavailable` |
| Credential temporarily invalid | `token expired` (not `revoked`) |
| Timeout | `durationMs` exceeds timeout threshold |

### Permanent (not retryable)
| Pattern | Detection |
|---------|-----------|
| Auth revoked | `revoked`, `invalid_grant`, `refresh token invalid` |
| Missing resource | `not found`, `ENOENT`, `no such file` |
| Bad config | `parse error`, `invalid config`, `schema validation` |
| Script error | `SyntaxError`, `MODULE_NOT_FOUND`, `permission denied` |

### Unknown
If the error doesn't match any pattern, classify as `unknown` and retry once conservatively.

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--job <id-or-name>` | all jobs | Specific job to check (ID or fuzzy name match) |
| `--max-attempts <n>` | 3 | Maximum retry attempts per failed run |
| `--base-delay <sec>` | 60 | Base delay in seconds for exponential backoff |
| `--max-delay <sec>` | 1800 | Maximum delay cap (30 min default) |
| `--window <hours>` | 6 | Only consider failures within this time window |
| `--dry-run` | false | Show what would happen without retrying |
| `--list-only` | false | Only list retryable failures, don't retry |
| `--json` | false | JSON output |
| `--state-file <path>` | `memory/cron-retry-state.json` | Retry state file path |
| `--no-backoff` | false | Use fixed delay instead of exponential backoff |
| `--quiet` | false | Only show warnings and errors |

## Retry State

Retry state is tracked in `memory/cron-retry-state.json`:

```json
{
  "retries": {
    "<job-id>:<run-timestamp>": {
      "jobId": "...",
      "originalRunAt": 1778565600000,
      "attempts": 2,
      "lastAttemptAt": 1778565900000,
      "lastResult": "transient",
      "nextRetryAt": 1778566200000,
      "errorSummary": "ETIMEDOUT fetching gmail API"
    }
  }
}
```

State is auto-pruned: entries older than 24 hours are cleaned up on each run.

## Backoff Strategy

Default: exponential with jitter.

```
delay = min(base_delay * 2^attempt + random_jitter, max_delay)
```

| Attempt | Base (60s) | Typical delay |
|---------|-----------|---------------|
| 1 | 60s | ~60-75s |
| 2 | 120s | ~120-150s |
| 3 | 240s | ~240-300s |

Use `--no-backoff` for fixed delays (useful when you know the service recovers in a predictable time).

## Integration Patterns

### As a heartbeat task

Add to HEARTBEAT.md:
```markdown
- Check for retryable cron failures and retry them (use cron-retry skill)
```

### As a standalone cron job

```bash
# Run every 30 minutes to catch and retry transient failures
openclaw cron add --name "Cron auto-retry" \
  --schedule "cron */30 * * * * @ Europe/Dublin" \
  --payload "Run the cron-retry skill to check for retryable failed cron jobs. Use node <path-to-script>/cron-retry.mjs --dry-run first, then retry any transient failures."
```

### Paired with graceful-degradation

After max retries are exhausted without recovery:
1. Record failure in graceful-degradation state
2. Alert the human once
3. Stop retrying until cooldown expires

## Complementary Skills

- **cron-health** — Spot failures first, then use cron-retry to recover
- **cron-first-aid** — When retry doesn't fix it, diagnose the root cause
- **graceful-degradation** — Manage alerting for permanently failed jobs
- **cron-snooze** — Pause a job entirely during an outage
- **credential-health** — Check if the failure was credential-related before retrying

## Anti-Patterns

- ❌ Retrying permanently failed jobs (wastes tokens)
- ❌ Retrying without backoff (hits rate limits harder)
- ❌ Retrying credential-revoked errors (needs human intervention)
- ❌ Infinite retries (always set a max)
- ✅ Classifying errors before deciding to retry
- ✅ Tracking state across attempts
- ✅ Pruning old state entries
- ✅ Using dry-run to preview before acting

## Limitations

- Cannot distinguish all error types from cron run metadata alone — transcript analysis is best-effort
- `openclaw cron run` triggers a new isolated run; the retry is not linked to the original run in OpenClaw's records
- State file is local to the workspace; not shared across hosts
- Requires `openclaw` CLI on PATH
- Delay is implemented as a simple setTimeout in the script; for long delays, consider using a cron job instead
