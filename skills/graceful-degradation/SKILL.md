---
name: graceful-degradation
description: Handle expired or broken credentials gracefully in cron jobs, heartbeats, and agent turns. Provides stateful alert tracking with cooldowns, auto-recovery detection, and deduplication so the agent alerts once and goes quiet until the human fixes it or the cooldown expires. Use when a credential check fails and you need to decide whether to alert, retry, or skip silently. Pairs with the credential-health skill (detection) to add the response layer (what to do about it).
---

# Graceful Degradation for Broken Credentials

When an external credential (OAuth token, API key, etc.) is expired or revoked, the agent needs a structured response pattern: alert once, go quiet, and auto-detect recovery. This skill provides that pattern.

## Core Principle

**Alert once, track state, auto-recover.** Don't spam the human with the same "token expired" message every cron run. Don't silently fail forever either. The sweet spot: alert on first failure, respect a cooldown, and check for recovery on subsequent runs.

## Scripts

### cred_state.sh

Stateful failure tracking. Stores per-service status in `credential-state.json`.

```bash
# Mark a service as failing
cred_state.sh gmail set-failing "OAuth token expired or revoked"

# Check if we should alert (respects cooldown, default 24h)
cred_state.sh gmail should-alert
# Output: "yes" or "no (cooldown: 23h remaining)"

# After alerting, record the alert time
cred_state.sh gmail mark-alerted

# Read current state
cred_state.sh gmail status
# Output: "gmail: FAILING since 2026-04-12 09:00 — OAuth token expired"

# When the credential works again
cred_state.sh gmail set-ok
# Output: "gmail: ok"
```

**Configurable cooldown** via `CRED_COOLDOWN_HOURS` (default: 24):

```bash
CRED_COOLDOWN_HOURS=48 cred_state.sh gmail should-alert
```

### cred_health_with_state.sh

Combines credential-health.cjs detection with stateful tracking. Run health checks and automatically update state.

```bash
# Check specific services and update state
cred_health_with_state.sh --check gmail,slack --json
```

## Usage Patterns

### Pattern 1: Cron Job with Graceful Failure

In a cron payload that depends on a credential:

```
1. Run: bash /path/to/graceful-degradation/scripts/cred_state.sh <service> should-alert
2. If output is "yes":
   a. Run the actual credential-dependent task. If it fails with auth error:
      - Run: cred_state.sh <service> set-failing "<error message>"
      - Reply with: "<service> credential is broken: <error>. You'll need to re-auth."
   b. If the task succeeds:
      - Run: cred_state.sh <service> set-ok
      - Continue with normal output
3. If output is "no":
   - Run the actual task. If it succeeds:
     - Run: cred_state.sh <service> set-ok
     - Continue with normal output
   - If it fails with auth error:
     - Reply exactly NO_REPLY (already alerted, within cooldown)
```

### Pattern 2: Pre-flight Check in Heartbeats

```
Before running any credential-dependent check:
1. Run: cred_state.sh <service> status
2. If status shows "FAILING", skip the check and go quiet (NO_REPLY)
3. If status is "ok" or empty, proceed normally
```

### Pattern 3: Recovery Detection

After a human says they've re-authenticated:

```
1. Run: cred_state.sh <service> set-ok
2. Run the credential check to verify
3. If it works, confirm recovery. If not, mark as failing again.
```

## State File

Location: `<DATA_DIR>workspace/credential-state.json` (overridable via `STATE_DIR`).

```json
{
  "services": {
    "gmail": {
      "status": "failing",
      "reason": "invalid_grant: Token has been expired or revoked.",
      "since": "1776034703",
      "lastAlertAt": "1776034703"
    }
  }
}
```

## Pairing with credential-health

- **credential-health** = detection layer (is the token valid?)
- **graceful-degradation** = response layer (what do we do about it?)

Use them together: run credential-health first, then feed the result into graceful-degradation's state tracking.

## Requirements

- `jq` (JSON processor)
- `bash`
- Optional: `credential-health.cjs` for the combined `cred_health_with_state.sh` script
