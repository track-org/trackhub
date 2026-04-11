---
name: time-aware
description: Make time-aware decisions for agent behaviour — quiet hours, business hours, notification timing, timezone conversions, and relative time calculations. Use when deciding whether to send a notification, checking if it's appropriate to be proactive, converting between timezones, calculating "in X hours" or "tomorrow morning", scheduling cron jobs at human-friendly times, or any logic that depends on time of day, day of week, or regional context.
---

# Time-Aware Agent Decisions

## Core Concept

Agents operate 24/7 but humans don't. This skill provides patterns for making contextually appropriate time-based decisions without hardcoding specific values everywhere.

## Timezone Handling

Always use IANA timezone identifiers (e.g. `Europe/Dublin`, `America/New_York`). Never abbreviate or guess.

**Get the human's local time:**

```bash
TZ=Europe/Dublin date '+%Y-%m-%d %H:%M %Z'
TZ=Europe/Dublin date '+%H:%M'          # just the hour:minute
TZ=Europe/Dublin date '+%u'             # day of week (1=Mon, 7=Sun)
TZ=Europe/Dublin date '+%s'             # epoch seconds
```

**Convert between zones:**

```bash
TZ='America/New_York' date -d '2026-04-11 09:00 Europe/Dublin' '+%H:%M %Z'
```

**Calculate relative times:**

```bash
date -d 'tomorrow 09:00' +%s           # epoch for tomorrow 9am
date -d '+2 hours' +%s                 # epoch for 2 hours from now
date -d 'next Monday 09:00' +%s        # epoch for next Monday 9am
```

## Quiet Hours Pattern

Define quiet hours per context. Default pattern:

| Window | Behaviour |
|--------|-----------|
| 23:00–08:00 | No proactive messages unless urgent |
| 08:00–09:00 | Digests OK, no interruptions |
| 09:00–17:00 | Business hours — full proactive behaviour |
| 17:00–23:00 | Casual — proactive but non-urgent only |

**Check programmatically:**

```bash
HOUR=$(TZ=Europe/Dublin date '+%H')
if [ "$HOUR" -ge 23 ] || [ "$HOUR" -lt 8 ]; then
  echo "quiet"
elif [ "$HOUR" -ge 9 ] && [ "$HOUR" -lt 17 ]; then
  echo "business"
else
  echo "casual"
fi
```

## Notification Timing Rules

### Should I send this now?

| Condition | Send? | Alternative |
|-----------|-------|-------------|
| Urgent (service down, security) | Yes, always | — |
| Important (meeting soon, action needed) | Yes outside quiet hours | Queue for morning if quiet |
| Informative (report, summary) | Business hours preferred | Digest at 09:00 if overnight |
| Ambient (FYI, nice-to-know) | Business or casual hours | Skip or batch with next heartbeat |
| Friday evening / weekend | Extra caution | Monday morning unless urgent |

### Delaying to next business window

When you need to schedule something for the next appropriate window:

```bash
# Next business morning
TZ=Europe/Dublin date -d 'tomorrow 09:00' '+%Y-%m-%dT%H:%M:%S%z'

# If before 09:00 today, use today
HOUR=$(TZ=Europe/Dublin date '+%H')
if [ "$HOUR" -lt 9 ]; then
  TZ=Europe/Dublin date -d 'today 09:00' '+%Y-%m-%dT%H:%M:%S%z'
else
  TZ=Europe/Dublin date -d 'tomorrow 09:00' '+%Y-%m-%dT%H:%M:%S%z'
fi
```

## Day of Week Logic

```bash
DOW=$(TZ=Europe/Dublin date '+%u')  # 1=Mon, 7=Sun

# Is it a weekday?
[ "$DOW" -le 5 ]

# Is it Friday?
[ "$DOW" -eq 5 ]

# Days until Monday (0 if today is Monday)
echo $(( (8 - DOW) % 7 ))
```

### Weekend consideration

- Friday afternoons: avoid scheduling one-shot tasks for Saturday/Sunday unless expected
- Saturday/Sunday: only urgent or explicitly requested tasks
- Sunday evening: OK to prepare Monday morning digests

## Cron Job Time Patterns

Common human-friendly schedules:

| Intent | Cron | Notes |
|--------|------|-------|
| Morning digest | `0 9 * * 1-5` | Weekdays only |
| End of day wrap-up | `0 18 * * *` | Daily |
| Weekend quiet | `0 10 * * 6,0` | Later start on weekends |
| Nightly build | `0 1 * * *` | 01:00 for overnight tasks |
| Hourly check (daytime) | `0 7-22 * * *` | Only waking hours |
| First Monday of month | `0 9 1-7 * 1` | `[1-7]` + day 1=Mon |

## Anti-Patterns

- ❌ Hardcoding timezone offsets (`+1`, `-5`) — use IANA names
- ❌ Assuming the agent's system time matches the human's — always set `TZ=`
- ❌ Sending non-urgent notifications at 02:00 "because the cron fired"
- ❌ Using `date` without explicit TZ when the human's timezone matters
- ❌ Scheduling tasks for times you haven't verified are appropriate for the day

## Quick Reference Script

For complex time decisions, see [`references/time-utilities.sh`](references/time-utilities.sh) — a sourceable shell script with reusable functions for quiet-hour checks, next-business-window calculation, and timezone-safe formatting.
