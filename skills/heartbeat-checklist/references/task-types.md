# Task Types — Detailed Examples

## scheduled

Checks that happen at a specific time every day (or every N days).

**Use when:** A task must run at a particular time, like a cron job verification.

**Example:** Check if the Attio cron job ran successfully after 07:00 each day.

```sh
# Is it past 07:00 and not yet checked today?
node scripts/heartbeat-state.mjs should-check attio-cron \
  --after 07:00 --min-interval 82800  # 23h interval (once per day)
```

```sh
# Record the result
node scripts/heartbeat-state.mjs check attio-cron \
  --status ok --summary "Ran at 07:00, no stage changes"
```

## rotating

Pick from a pool of similar-priority tasks, check 1-2 per heartbeat instead of all of them.

**Use when:** You have several low-priority checks but don't want to burn tokens checking all of them every 30 minutes.

**Example:** Email, calendar, mentions, weather — check one or two per heartbeat.

```sh
# Each has a 2h minimum interval
node scripts/heartbeat-state.mjs should-check email --min-interval 7200 --after 08:00 --before 23:00
node scripts/heartbeat-state.mjs should-check calendar --min-interval 7200 --after 08:00 --before 23:00
node scripts/heartbeat-state.mjs should-check mentions --min-interval 10800 --after 08:00 --before 23:00
node scripts/heartbeat-state.mjs should-check weather --min-interval 28800  # 8h
```

The agent runs `should-check` for each in priority order and stops after 1-2 pass.

## windowed

Only active during a specific time window. Once done in that window, don't repeat.

**Use when:** A task should happen during a quiet period, like a nightly build.

**Example:** Build one skill between midnight and 03:00.

```sh
node scripts/heartbeat-state.mjs should-check nightly-build \
  --window-start 00:00 --window-end 03:00
```

The script checks:
1. Are we inside the window?
2. Has it already been checked during this window session?

If both pass → exit 0 (do it). Otherwise → exit 1 (skip).

## reactive

Check again only if the previous check indicated follow-up was needed.

**Use when:** Something might need attention but probably doesn't. Check once, then only re-check if the first check found something.

**Example:** Slack channel monitoring — check every few hours, but if a message needs a response, re-check sooner.

```sh
# First check (or re-check if last result was 'follow-up')
node scripts/heartbeat-state.mjs should-check slack-channel --min-interval 7200
```

The agent can inspect `lastResults[task].status` to decide if it needs a shorter follow-up interval next time.

## once

One-time task. Remove or reset after completion.

**Use when:** You need to verify something happened once, like a new cron job's first run.

**Example:** Confirm a new cron job fires at least once.

```sh
node scripts/heartbeat-state.mjs should-check verify-new-cron --min-interval 3600
# After confirmed:
node scripts/heartbeat-state.mjs reset verify-new-cron
# Then remove the task from HEARTBEAT.md
```
