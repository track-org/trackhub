---
name: graceful-failure
description: Graceful error handling for cron jobs — fail safely without sending noise
tags: [cron, errors, safety, degradation]
version: 1.0.0
---

## Error Handling
If the main task fails:
1. Do NOT retry more than once.
2. Do NOT send error details to Slack/Discord/WhatsApp unless this is the first failure (not within 24h cooldown).
3. Record the failure in the local state file for trend tracking.
4. Reply NO_REPLY if already alerted within cooldown.
5. If this is a new failure, send a one-line summary: "❌ {{job_name}} failed: {{error_message}}"
