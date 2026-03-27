---
name: trackhub-sync
description: Publish reusable AgentSkills and related helper code to the shared TrackHub git repository, and consume shared skills from that repository into a local runtime. Use when promoting a locally-developed skill into a generic shareable form, syncing a shared skill from TrackHub into local use, documenting runtime requirements, or separating reusable code from local identity, secrets, and machine-specific bindings.
---

# TrackHub Sync

Use this skill to move reusable skills between a local agent runtime and the shared TrackHub repository.

Treat TrackHub as the shared source of truth for generic, reusable agent skills.

Treat the local runtime as the place for identity, secrets, local paths, machine-specific wiring, and private context.

Read `references/runtime-contract.md` when you need to define or verify local bindings. Read `references/workflows.md` when you need concrete publish/consume examples.

## Core principles

- Publish only the reusable core.
- Keep secrets out of TrackHub.
- Keep local identity bindings out of shared skills.
- Keep machine-specific paths out of shared skills.
- Make runtime requirements explicit.
- Prefer boring, inspectable folder structure over clever automation.
- Do not overwrite local customisations blindly when consuming from TrackHub.

## Shared vs local boundary

### Shared in TrackHub

TrackHub may contain:

- generic `SKILL.md` files
- generic scripts and helper code
- reference docs
- examples
- reusable templates
- packaging artifacts if needed
- documentation for required runtime bindings

### Local only

Keep these out of TrackHub:

- secrets or tokens
- `.env` values
- private user context
- memory files
- local paths
- machine-specific commands unless clearly parameterised
- agent-specific identity bindings
- Slack IDs or environment-specific IDs unless explicitly meant as examples

## Standard repo structure

Prefer this structure inside TrackHub:

```text
skills/
  <skill-name>/
    SKILL.md
    references/
    scripts/
    assets/
```

Create only the resource directories actually needed.

Optional repo-level files:

```text
README.md
```

## Two workflows

Use one of two workflows:

1. publish local -> TrackHub
2. consume TrackHub -> local

## Workflow 1: publish local -> TrackHub

Use when a local skill or helper workflow has become useful enough to share.

### Step 1: inspect the local implementation

Identify:

- the skill folder or code bundle
- which parts are reusable
- which parts are local-only
- which secrets or environment assumptions exist
- whether the result is actually worth publishing

If the implementation is still highly experimental, say so.

### Step 2: extract the reusable core

Keep:

- the generic behaviour or policy
- generic scripts
- examples that teach usage
- references that explain workflow
- a clear description of what the skill does

Remove or refactor:

- local paths
- personal or private notes
- local usernames or machine assumptions
- agent-specific identity values
- hardcoded secrets
- environment-specific instructions that are not portable

### Step 3: define the runtime contract

Every published skill should make clear what must be provided locally.

Document things like:

- required environment variables
- required binaries
- expected local directories
- identity bindings
- peer agent names if configurable
- optional timing or config overrides

If a skill needs agent-specific bindings, describe the contract generically rather than hardcoding one agent's values.

### Step 4: validate structure and wording

Check that:

- the skill has a valid `SKILL.md`
- the description explains both what it does and when to use it
- resource folders are minimal and purposeful
- examples do not leak private data
- the skill can be understood by another agent without local chat history

### Step 5: write into TrackHub

Write the cleaned skill into the TrackHub repo under:

```text
skills/<skill-name>/
```

Prefer updating an existing shared skill over creating duplicate variants with slightly different names.

### Step 6: commit and optionally push

If git write access is available and allowed:

- review changes
- commit with a clear message
- push to the shared repo

If pushing is not available, leave the repo in a clean committed or ready-to-commit state and explain what remains.

## Workflow 2: consume TrackHub -> local

Use when a shared skill from TrackHub may be useful in the current local runtime.

### Step 1: inspect the shared skill

Read:

- `SKILL.md`
- any small relevant reference files
- any runtime-contract documentation
- scripts only if needed for understanding or adaptation

Identify:

- what the skill does
- what local bindings it expects
- what secrets or env vars it needs
- whether it is safe and appropriate for local use

### Step 2: separate shared files from local bindings

Bring the generic skill into local runtime.

Do not treat agent-local bindings as part of the shared artifact.

Local bindings may include:

- canonical self name
- aliases
- peer agents
- human participants
- environment variables
- local directory paths
- runtime-specific standing instructions

### Step 3: install or copy locally

Install or copy the skill into the local skills area.

If local adaptation is required:

- keep shared files as close to upstream as possible
- put local configuration in local notes, config files, or workspace instructions
- avoid editing the shared generic files unless the improvement should be published back upstream

### Step 4: document local adaptations

When a shared skill needs local glue, document:

- what was adapted
- where the local binding lives
- whether the generic skill should be improved upstream

### Step 5: feed improvements back

If local use reveals a generic improvement:

- update the local copy if needed
- then publish the generic improvement back to TrackHub
- do not publish purely local hacks as shared improvements

## Publishing checklist

Before publishing, ask:

- Is this genuinely reusable?
- Does it contain secrets?
- Does it contain private user context?
- Does it assume one machine or one directory layout?
- Does it hardcode one agent's identity?
- Would another agent understand how to use it?
- Is the runtime contract documented?
- Is the name clear and stable?

If the answer to the first is no, do not publish yet.

If the answer to any of the privacy or safety questions is yes, clean it first.

## Consumption checklist

Before consuming, ask:

- What problem does this skill solve?
- What local bindings are required?
- What env vars or credentials are needed?
- Is the code read-only or write-capable?
- Are write capabilities acceptable for local policy?
- What should stay upstream, and what should stay local?

For external APIs, default to read-only unless explicit approval exists.

## Naming and duplication rules

- Prefer one canonical shared skill per concept.
- Avoid multiple near-identical skill names.
- Use lowercase letters, digits, and hyphens only.
- When in doubt, update the existing shared skill instead of creating `-v2`, `-new`, `-final`, or similarly desperate names.

## TrackHub-specific guidance

Treat TrackHub as:

- a shared source of truth
- a reusable catalog
- a place for portable skills

Do not treat it as:

- a dump of local workspace state
- a backup of private memory
- a secrets store
- a place for one-off machine hacks

## Commit style

Use clear commit messages, for example:

- `feat(shared-channel-agent): publish first reusable version`
- `docs(trackhub-sync): clarify runtime contract`
- `fix(shared-channel-agent): remove local path assumptions`

## Final rule

The purpose of TrackHub is not merely to store files.

The purpose is to preserve the reusable part of agent work while keeping identity, secrets, and local runtime glue where they belong.

When in doubt:

- publish the generic core
- keep the local bindings local
