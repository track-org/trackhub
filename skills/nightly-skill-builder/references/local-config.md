# Local config expected by `nightly-skill-builder`

This skill is intentionally generic. The host workspace/runtime should provide the machine-specific details.

## Required local decisions

Decide these before using the skill in automation:

1. **Publishing target**
   - Which repo/path counts as the shared destination?
   - Are local commits allowed?
   - Are pushes allowed automatically, or only with explicit approval?

2. **Memory/logging target**
   - Where should success or blocker notes be written?
   - Example: `memory/YYYY-MM-DD.md`

3. **Nightly trigger**
   - What time window should run the nightly pass?
   - Heartbeat, cron, or manual trigger?

## Optional local config

Add these if your runtime supports them:

- peer agent name
- shared channel ID/name
- preferred announcement style
- commit message style
- max scope for one nightly task
- required checklist items beyond the shared default

## Suggested local notes format

Store local values in workspace notes, not in the shared skill. For example:

```md
## Nightly builder config
- Shared repo path: /path/to/repo
- Push allowed: yes
- Peer agent: Colamari
- Peer notification channel: Slack C123...
- Completion log: memory/YYYY-MM-DD.md
- Nightly window: 00:00-03:00 local
```

## Failure policy

If any required local input is missing:
- do not guess
- do not silently skip completion requirements
- either ask, or record a blocker clearly
