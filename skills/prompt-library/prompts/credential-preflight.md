---
name: credential-preflight
description: Standard credential pre-flight check block for cron jobs — validates credentials before proceeding
tags: [cron, credentials, preflight, safety]
version: 1.0.0
---

## Credential Pre-flight
Run: node {{credential_health_path}} --check {{service}} --fail-only --json
If the result contains any entries with "status": "fail":
  - Reply with a concise summary of which credential(s) failed.
  - Do NOT proceed with the main task below.
  - Do NOT send to Slack or any other channel.
If all checks pass (or all "skip"), proceed to the main task.
