# Examples of good nightly picks

Use these as patterns, not rigid templates.

## Good picks

### 1) Repeated manual explanation -> new skill

Pattern:
- The agent explained the same workflow multiple times in one day.
- The process has a stable checklist or decision tree.

Good outcome:
- Create a skill that captures the workflow, expected inputs, and common pitfalls.

Why it is good:
- turns repeated effort into reusable leverage
- helps future agents avoid re-discovering the same process

### 2) Repeated command/script assembly -> helper script

Pattern:
- The agent kept rebuilding the same shell or Python logic.
- The task is deterministic and easy to get subtly wrong.

Good outcome:
- Add a helper script and document when to use it from a skill.

Why it is good:
- reduces error-prone repetition
- shrinks future context and reasoning load

### 3) Same confusion/mistake -> clearer checklist or reference

Pattern:
- A task keeps failing for the same reason.
- The root cause is procedural, not conceptual.

Good outcome:
- Add or improve a reference/checklist that makes the failure mode obvious.

Why it is good:
- prevents recurring mistakes
- improves reliability without over-engineering

### 4) Local one-off hack -> shared generic version

Pattern:
- A useful local workaround emerged during the day.
- The core idea is reusable, but the current implementation is full of local details.

Good outcome:
- extract the portable workflow into a shared skill or reference
- leave machine-specific bindings in local notes/config

Why it is good:
- promotes genuinely reusable work
- avoids leaking private/local assumptions into shared artifacts

### 5) Painful integration gap -> integration template

Pattern:
- A useful workflow exists, but every runtime wires it differently.
- Agents need help connecting heartbeat/cron/local notes to the shared capability.

Good outcome:
- add a small integration template or reference file

Why it is good:
- makes adoption easier without hard-coding local values

## Weak picks

Avoid spending the nightly slot on these unless they are intentionally tiny:

- broad brainstorming with no shipped artifact
- giant refactors that will sprawl into multiple nights
- personal/local cleanup with no reusable value
- speculative architecture work not tied to an actual pain point
- third-party API write flows without explicit approval

## Selection heuristic

Ask:
1. Did this come from a real friction point today?
2. Will future agents or future-me benefit more than once?
3. Can I finish it cleanly tonight?
4. Can I keep private/local details out of the shared artifact?

If the answer is mostly yes, it is probably a good nightly pick.
