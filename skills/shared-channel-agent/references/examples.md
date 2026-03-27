# Shared Channel Agent Examples

Use these examples to calibrate behaviour in shared human+agent channels.

## Good behaviours

### 1. Direct question to one agent

Human: `Shelldon, what do you think about this routing idea?`

Correct behaviour:
- Shelldon replies after a short human-like delay.
- Collaw stays quiet unless asked or unless an important correction is needed.

### 2. Direct question to multiple agents

Human: `Shelldon and Collaw, both of you weigh in on this.`

Correct behaviour:
- Both agents may reply.
- Responses should be staggered naturally.
- Each agent should add a different angle.
- If the first reply already covers one agent's point, the second agent should narrow its reply or cancel it.

### 3. FYI mention

Human: `Looping in Shelldon for awareness.`

Correct behaviour:
- No reply by default.
- A reaction may be enough if supported.

### 4. Agent asks another agent a concrete question

Agent: `Collaw, implementation-wise, do you think this should live in a skill or base instructions?`

Correct behaviour:
- Collaw may answer.
- Keep the answer concise and additive.
- Do not turn it into extended back-and-forth unless a human is actively benefiting.

### 5. New information arrives during the wait window

Human asks a question. Shelldon plans to reply in 12 seconds. At second 8, Collaw posts a partial answer.

Correct behaviour:
- Shelldon re-evaluates before sending.
- If Shelldon's planned message would duplicate Collaw, cancel or narrow it.
- If Shelldon still has distinct value, reply with only the missing delta.

## Bad behaviours

### 1. Agreement theatre

Bad:
- `Good point, Collaw.`
- `I agree.`
- `Exactly.`

Reason:
- Adds no value.
- Creates robotic clutter.

### 2. Mention reflex

Agent says: `Shelldon might know this.`

Bad behaviour:
- Shelldon immediately replies just because the name appeared.

Correct behaviour:
- Reply only if a real question, handoff, or useful contribution exists.

### 3. Simultaneous pile-on

Human asks a broad question. Every agent responds immediately with overlapping answers.

Why this is bad:
- Feels mechanical.
- Prevents agents from incorporating each other's context.
- Annoys humans rapidly.

Correct behaviour:
- Use the timing rules.
- Re-check before sending.
- Cancel duplicate replies.

### 4. Endless deferment

Bad behaviour:
- Wait 20 seconds.
- Notice a new message.
- Wait another 20 seconds.
- Repeat indefinitely.

Correct behaviour:
- Use at most two waits total.
- After that, either send or cancel.

### 5. Agent-only rabbit hole

Bad behaviour:
- Agent A asks Agent B something.
- Agent B replies.
- Agent A follows up.
- Agent B follows up.
- Humans are now watching a robot tennis match.

Correct behaviour:
- Stop after limited public exchange unless a human is clearly benefiting or re-engages.

## Quick edge-case rules

- If uncertain whether a mention is direct or incidental, prefer incidental.
- If someone already answered well, raise the bar for replying.
- If the conversation moved on during the wait, cancel.
- If a correction prevents confusion, reply faster.
- If your reply mainly signals social acknowledgment, prefer a reaction or silence.
