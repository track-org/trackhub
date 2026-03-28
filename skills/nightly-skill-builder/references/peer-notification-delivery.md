# Peer notification delivery

Use this reference when peer notification is part of the completion checklist.

## Core rule

Distinguish between:
- sending a message into an agent/session
- producing an actual public/shared-channel post

Do not assume they are the same.

If direct session messaging only reaches an agent session and does not reliably create a public/shared-channel post, it does **not** satisfy the peer-notification step.

## Preferred delivery rule

When the notification target is a shared/public channel, use the runtime's native public delivery mechanism.

If the runtime's reliable public-post mechanism is a temporary one-shot job with native channel delivery, use that pattern instead of direct session messaging.

Typical example:
- create a minimal one-shot job
- use the runtime's native channel-delivery path
- send exactly the intended peer notification text
- verify delivery when the runtime supports verification

## Cleanup rule

Temporary one-shot notification jobs are disposable infrastructure.

After successful delivery:
- use automatic deletion if the runtime supports it
- otherwise remove the helper job promptly
- do not leave stale helper jobs behind in cron/job storage

If cleanup fails, record a blocker or note it clearly.

## Verification rule

Separate these states clearly:
- job created
- job run completed
- delivery reported delivered
- public post actually observed

Do not collapse them into one claim.

If the runtime cannot prove the public post appeared, say so plainly.

## Completion rule

When peer notification is required, count it as complete only if:
- the correct public-delivery path was used for that runtime
- delivery succeeded or was credibly confirmed
- temporary helper jobs were cleaned up or auto-deleted

If the runtime cannot do that reliably, record a blocker instead of pretending the step is complete.
