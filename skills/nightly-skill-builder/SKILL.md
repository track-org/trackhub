---
name: nightly-trackhub-builder
description: Turn a day's conversations, loose ideas, and repeated pain points into one meaningful nightly improvement, usually a reusable skill or workflow refinement. Use when an agent should do a quiet-hours build/polish pass, choose one worthwhile improvement from recent context, implement it safely, commit and push it, notify a peer if local config says to, and record success or blockers. Also use when wiring this behaviour into heartbeat or cron without hard-coding machine-specific channels, repos, or identities.
---

# Nightly Skill Builder

Do one meaningful nightly improvement. Prefer reusable skills, shared workflows, or tooling improvements that clearly came from the day's conversations.

## Core loop

1. Review the relevant recent conversation/day context.
2. Pick one worthwhile improvement.
3. Keep scope small enough to finish cleanly.
4. Implement and verify it.
5. Commit locally.
6. Push to the shared repo if local policy allows.
7. Notify a peer/channel if local config says to.
8. Record success or blocker in the daily memory file.

If the selected improvement is intended for the shared TrackHub repo and the runtime has the `trackhub-sync` skill available, prefer `trackhub-sync` for the publish/sync step instead of improvising the shared-repo workflow.

Do not count the task as complete until the local completion checklist is satisfied.

If the local runtime keeps lightweight notes during the day, use them as a shortlist. If not, reconstruct the shortlist from recent conversation and memory at night. Do not require elaborate daytime note-taking just to use this skill.

Read `references/daytime-breadcrumbs.md` for an optional lightweight pattern that helps the agent capture promising ideas during the day without turning the process into bureaucracy.

## Choose the nightly improvement

Prefer work that is:
- reusable across agents or sessions
- directly motivated by repeated questions, friction, or mistakes from that day
- small enough to finish in one sitting
- safer as shared guidance than as private workspace lore

Good candidates:
- a new skill extracted from repeated manual work
- a meaningful upgrade to an existing skill
- a helper script that removes repetitive, error-prone work
- a clearer workflow/checklist for a recurring task

Read `references/good-nightly-picks.md` if you need help deciding whether an idea is worth spending the nightly slot on.

Avoid:
- vague research with no shipped artifact
- giant refactors unlikely to finish tonight
- machine-specific hacks pretending to be generic
- third-party API write behaviour unless explicitly approved

## Keep shared vs local boundaries clean

Put in the shared skill/repo:
- reusable workflow
- generic scripts
- portable references
- example integration snippets

Keep local:
- channel IDs
- peer agent names
- repo paths/remotes unique to one machine
- secrets/tokens
- personal contact details
- local autonomy rules specific to one human

If the workflow needs local values, require them explicitly rather than hard-coding them.

Read `references/local-config.md` before relying on peer notifications, repo publishing, or memory logging. If required local values are missing, do not invent them.

## Completion standard

Treat the nightly task as complete only when all applicable items are true:
- code/content is finished to a reasonable standard
- any included script or example used for the task was tested enough to justify confidence
- changes are committed locally
- changes are pushed if local policy/config expects pushing
- peer notification was sent if configured and appropriate
- success or blocker was written to the daily memory file

If one of those cannot be completed, record a blocker instead of pretending the task is done.

## Heartbeat / cron integration

This skill does not require heartbeat, but it is designed to be easy to invoke from heartbeat or cron.

When a local runtime wants nightly automation:
- let heartbeat/cron decide **when** to run
- let this skill define **how** to select, build, publish, and report the improvement

For an example integration pattern, read `references/heartbeat-template.md`.

## Notification behaviour

If local config provides a peer agent or shared channel:
- send a concise heads-up only after the work is genuinely shareable or complete enough to be useful
- include what changed, why it matters, and where to look
- use the runtime's correct public-delivery path for peer/channel notifications
- if direct session messaging does not reliably create a public/shared-channel post, use a temporary one-shot job with native channel delivery instead
- clean up temporary notification jobs after success, or use automatic deletion if the runtime supports it
- if notification is required locally but unavailable from the runtime, record that as a blocker

Read `references/peer-notification-delivery.md` before implementing or judging the peer-notification step.

## Output discipline

When asked to perform the nightly work, finish with a concise summary covering:
- what was built or improved
- where it lives
- what was tested
- whether it was committed/pushed
- whether peer notification happened
- whether memory/logging was updated
- any remaining blocker
otification step.

## Output discipline

When asked to perform the nightly work, finish with a concise summary covering:
- what was built or improved
- where it lives
- what was tested
- whether it was committed/pushed
- whether peer notification happened
- whether memory/logging was updated
- any remaining blocker
