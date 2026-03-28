# Example heartbeat integration

Use this as a local template, not as shared hard-coded policy.

## Example heartbeat wording

- Between 00:00 and 03:00 local time, use `nightly-skill-builder` to ship one meaningful reusable improvement based primarily on the previous local day's conversations, with any very recent post-midnight context treated only as spillover.
- Prefer a new skill or a meaningful upgrade to an existing one.
- Keep third-party API work read-only unless explicitly approved.
- Do not count the task as complete until code is committed, pushed if required locally, peer notification is sent if configured, and a short success/blocker note is written to the daily memory file.

## Example cron wording

- Run one nightly improvement pass.
- Use `nightly-skill-builder`.
- Review recent conversations and select one small but worthwhile reusable improvement.
- If the result belongs in TrackHub and `trackhub-sync` is available locally, use it for the publish/sync step.
- Follow the local completion checklist.
- If required local inputs are missing, record a blocker instead of guessing.

## Integration notes

Heartbeat/cron should only provide:
- timing
- local priorities
- any local completion requirements
- references to local config when needed

The skill should provide:
- selection logic
- execution workflow
- completion discipline
- fallback behaviour when breadcrumbs are absent
