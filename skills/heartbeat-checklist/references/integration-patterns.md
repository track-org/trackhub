# Integration Patterns

## Pattern 1: Minimal HEARTBEAT.md + Script-Driven Checks

Keep HEARTBEAT.md short and declarative. Let the script do the scheduling logic.

**HEARTBEAT.md:**
```markdown
# HEARTBEAT.md

Use heartbeat-checklist skill. Check each task with `should-check` first.

Tasks:
- attio-cron: daily after 07:00
- slack-C0ANLG7P290: every 2-4h during business hours
- nightly-build: 00:00-03:00 window

Quiet hours: 23:00-08:00 (urgent only)
```

**Agent heartbeat handler (pseudocode):**
```
for each task in HEARTBEAT.md:
  if should-check(task) returns 0:
    result = execute(task)
    check(task, result.status, result.summary)

if nothing responded:
  reply HEARTBEAT_OK
```

## Pattern 2: Rotating Checks with Priority

For agents with many low-priority checks, rotate through them:

```
priority_order = [email, calendar, mentions, weather]
checks_done = 0
for task in priority_order:
  if should-check(task, min-interval=7200):
    execute(task)
    check(task)
    checks_done += 1
    if checks_done >= 2: break  # max 2 checks per heartbeat
```

## Pattern 3: Windowed Nightly Tasks

For tasks that should happen once during a specific window:

```
if should-check(nightly-build, window-start=00:00, window-end=03:00):
  # We're in the window and haven't done it yet
  build_skill()
  check(nightly-build, status=ok, summary="Built git-workflow skill")
```

The `window-start`/`window-end` flags automatically handle:
- Rejecting checks outside the window
- Allowing one check per window session (same calendar day)

## Pattern 4: Reactive Follow-Up

For tasks where a failed check should trigger sooner re-checking:

```
# Normal check: every 3 hours
if should-check(slack-channel, min-interval=10800):
  result = check_slack()
  
  if result.needs_follow_up:
    # Record with warn status, and next time use shorter interval
    check(slack-channel, status=warn, summary="Unread message needs response")
    # On next heartbeat, agent can inspect lastResults and use shorter interval
  else:
    check(slack-channel, status=ok)
```

## Pattern 5: Multi-Environment State

For agents that run on multiple machines or in different timezones:

```sh
# Specify timezone explicitly
node scripts/heartbeat-state.mjs should-check task --after 09:00 --timezone America/New_York
```

Each environment can use a different `--file` path or the same shared file with task-prefixed names.
