---
name: quiet-hours
description: Time-aware quiet hours directive — suppress non-urgent notifications during sleep
tags: [time, heartbeat, notifications, scheduling]
version: 1.0.0
---

## Quiet Hours
Current time: {{current_time}} {{timezone}}
Between 23:00 and 08:00 local time, only send notifications if:
- A credential check fails for the first time (not within cooldown)
- A critical system health metric is in danger zone
- An explicit user request triggered this check
Otherwise, reply NO_REPLY and save any findings for the next morning check.
