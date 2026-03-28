# Optional daytime breadcrumbs

This pattern is optional.

Use it when an agent notices promising ideas during the day and wants to make nightly selection easier without starting a heavy planning workflow.

## Principle

Capture tiny breadcrumbs, not full plans.

Good breadcrumb qualities:
- one line
- tied to a real pain point or repeated question
- easy to understand later at night
- safe to discard if it turns out to be weak

## Good examples

- Repeatedly explained how cron delivery differs from session delivery; likely skill/reference candidate.
- Built the same grep/json probe three times today; probably wants a helper script.
- Confusion around shared vs local config in skills; likely checklist/reference improvement.
- Repeated WhatsApp routing/debugging pain; maybe extract a reusable troubleshooting workflow.

## Bad examples

- giant speculative project ideas
- vague notes like "improve stuff"
- full implementation plans written too early
- personal/local secrets mixed into shared-build notes

## Suggested places to keep breadcrumbs

Use any lightweight local place the runtime already has:
- daily memory file
- a small "nightly build candidates" section in local notes
- heartbeat scratchpad if your local workflow already uses one

## Suggested format

```md
## Nightly build candidates
- Candidate: repeated confusion about X -> maybe skill/reference
- Candidate: repeated command sequence for Y -> maybe helper script
- Candidate: local workaround for Z -> extract generic version for shared repo
```

## Nighttime use

At night:
- treat breadcrumbs as a shortlist, not a mandate
- review them alongside recent conversation context
- choose at most one solid improvement
- ignore stale or weak breadcrumbs freely

## Important rule

The nightly workflow must still work without breadcrumbs.
They are a convenience, not a dependency.
