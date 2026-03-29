---
name: daily-cron-content
description: Set up and manage daily LLM-generated content cron jobs that produce fresh content (notes, summaries, questions, etc.) and store it in a database or file. Use when an agent needs to create a recurring daily content pipeline where an LLM generates new material each run, tracks state (rotation, used topics, etc.), and persists output via REST API or file writes. Covers the full lifecycle: planning the content schema, writing the cron prompt, managing state files, and verifying runs.
---

# Daily Cron Content

Create and maintain daily content-generation cron jobs powered by an LLM agent.

## When to use

- A user wants fresh content generated daily and stored in a database or file
- A recurring pipeline where each run produces new material (not re-running the same data)
- Any "generate X per day" pattern that needs rotation, deduplication, and persistence

## Core pattern

Each daily content cron job follows this architecture:

1. **State file** (`daily-{name}-state.json`) — tracks rotation index, used topics/items, last run date
2. **Cron job** — isolated session agent that reads state, generates content, writes output, updates state
3. **Storage** — Supabase REST API, local file, or any write target the agent can reach

The agent in the cron job does all the thinking — no separate scripts needed unless the insert logic is complex.

## Setting up a new daily content cron job

### 1. Define the content schema

What gets generated each day? Example:
- 1 note (subject, topic, bullet points) + 5 questions
- 1 daily summary + 3 action items
- 1 vocabulary list (10 words + definitions)

### 2. Define rotation (if applicable)

If content cycles through categories:
- Store rotation index in the state file
- List categories in the cron prompt
- Agent increments the index after each run

### 3. Write the cron prompt

The prompt should instruct the agent to:

```
1. Read the state file at {path}
2. Pick the next item in rotation (using index % N)
3. Generate fresh content:
   - {content requirements}
   - {quality standards}
   - {format requirements}
4. Insert into {storage}:
   - POST to {url} with {headers} and {body structure}
   - Or write to {file path}
5. Update the state file:
   - Increment index
   - Record the topic/item used
   - Write state back
6. Reply with a one-line summary
```

### 4. Create the cron job

```bash
openclaw cron add \
  --name "Daily {Name}" \
  --description "{what it does}" \
  --cron "0 {HH} * * *" \
  --tz "{timezone}" \
  --session isolated \
  --message '{prompt}' \
  --no-deliver \
  --timeout 120000
```

Use `--session isolated` so each run gets a fresh context. Use `--no-deliver` for silent operation, or `--announce --to {channel}` for notifications.

### 5. Test with a manual run

```bash
openclaw cron run {job-id}
```

Verify the content landed correctly in the target storage.

## State file format

```json
{
  "subjectIndex": 3,
  "usedTopics": {
    "CategoryA": ["topic1", "topic2"],
    "CategoryB": ["topic3"]
  },
  "lastRunDate": "2026-03-30"
}
```

- `subjectIndex` or equivalent — rotation counter
- `usedTopics` — prevents the agent from regenerating the same content
- `lastRunDate` — optional, for deduplication or skip logic

## Cron prompt best practices

- **Be specific** about content format (bullet points vs paragraphs, question count, etc.)
- **List rotation categories** explicitly in the prompt so the agent doesn't invent new ones
- **Include storage details** — URL, headers, body structure, date format
- **Tell the agent to generate fresh** — explicitly say "do NOT use any pre-written file"
- **Add delay between inserts** — "200ms delay between each POST" to avoid rate limits
- **Request a summary** — one-line reply at the end for easy log checking

## Common pitfalls

- **Hard-coding content**: don't embed a huge data file of pre-written notes. Let the LLM generate fresh each time.
- **Missing state persistence**: the agent must read AND write the state file in every run, or it will repeat content.
- **Rate limits**: add delays between sequential API inserts.
- **Date format**: specify the exact format (`YYYY-MM-DD`) and remind the agent to use today's date.
- **Large prompts**: keep the cron prompt concise. Move reference material (category lists, format examples) into a separate file the agent can read.

## Monitoring

Check recent runs:
```bash
openclaw cron list --json | python3 -c "import json,sys; [print(j['name'], j['state'].get('lastRunStatus'), j['state'].get('lastDurationMs','?'),'ms') for j in json.load(sys.stdin)['jobs'] if '{name}' in j['name']]"
```

If a run fails, check the agent's session history for error details.
