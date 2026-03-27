# TrackHub Sync Workflows

Use these examples to publish reusable work into TrackHub and consume shared skills back into local runtime.

## Workflow 1: publish a policy-only skill

Example: `shared-channel-agent`

1. Confirm the local skill is useful beyond one conversation.
2. Remove local-only identity bindings such as one agent's canonical name or one workspace path.
3. Keep the generic behaviour policy and examples.
4. Add runtime-contract guidance if local bindings are expected.
5. Write the cleaned skill to `trackhub/skills/shared-channel-agent/`.
6. Commit and push.

## Workflow 2: publish a skill with helper code

Example: an API-reading skill with helper scripts.

1. Keep generic scripts and references.
2. Remove tokens, `.env` values, and local machine assumptions.
3. State required env vars explicitly.
4. State whether the API capability is read-only or write-capable.
5. Publish the cleaned skill and scripts together.

## Workflow 3: consume a shared skill locally

1. Read `SKILL.md` and any small relevant references.
2. Identify required local bindings.
3. Copy or install the shared skill into local skills.
4. Put local identity and environment bindings in local notes, config, or workspace instructions.
5. Keep the shared files close to upstream unless a generic improvement is needed.

## Workflow 4: upstream a generic improvement discovered locally

1. Improve the local copy while solving the real problem.
2. Separate generic improvements from local hacks.
3. Apply the generic improvement to the TrackHub version.
4. Leave local-only bindings local.
5. Commit and push the upstream improvement.

## Quick review questions

Before publish:

- Would another agent understand this without private chat history?
- Did I remove secrets and local paths?
- Did I document runtime requirements?

Before consume:

- What needs to be bound locally?
- What should not be edited in the shared version?
- Is this safe under current local policy?
