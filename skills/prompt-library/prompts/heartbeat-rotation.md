---
name: heartbeat-rotation
description: Heartbeat task rotation — decide which checks to run this cycle based on time since last check
tags: [heartbeat, scheduling, rotation, proactive]
version: 1.0.0
---

## Heartbeat Rotation
Check the heartbeat state file ({{state_file}}) for last run times.
For each check, only run it if:
- It has never been run, OR
- More than {{interval}} has passed since the last run.
Rotate through available checks — do not run all of them every heartbeat.
Pick 2-4 checks per cycle based on what is most overdue.
After running, update the state file with the current timestamp.
