---
name: quick-reports
description: Generate concise, well-formatted reports for messaging platforms (Slack, WhatsApp, Discord, Telegram). Use when an agent needs to turn data (API results, summaries, digests, alerts) into a clean, readable message that fits a specific platform's formatting constraints. Covers formatting rules, length discipline, section patterns, and copy-paste templates.
---

# Quick Reports

Turn data into clean, platform-appropriate messages.

## Core Principles

1. **Lead with the answer.** The first line should tell the reader what happened. Details follow.
2. **Use sections, not walls.** Break information into scannable chunks with headers or dividers.
3. **Respect platform limits.** Slack: 40k chars but keep under 2000 for readability. WhatsApp: no markdown tables, no headers. Discord: full markdown, tables OK.
4. **Numbers need context.** "€12,400" means nothing. "€12,400 (+€2,100 from last week)" means something.
5. **Empty = say so.** "No changes today" beats a blank message or a formatting skeleton with no data.

## Platform Formatting Rules

### Slack

- Full markdown supported (bold, italic, code, links, lists)
- Tables render well — use them for tabular data
- Wrap multiple links in `<https://url|text>` to suppress previews
- Use `>` for blockquotes (good for callouts or quotes)
- Channel links: `<#C12345|channel-name>`
- User mentions: `<@U12345>`
- Keep messages under ~2000 chars for comfortable reading
- Thread long reports; don't dump everything in the main channel

### WhatsApp

- **No markdown tables** — use bullet lists or aligned text
- **No headers** (# doesn't render) — use **bold** or ALL CAPS for section titles
- Bold: `*text*` — works
- Italic: `_text_` — works
- Code: `` `text` `` — works
- Links: plain URLs auto-preview; no link text support
- Keep messages short — WhatsApp truncates very long messages
- Use emoji as section dividers: 📊, 📅, 📬, ⚠️

### Discord

- Full markdown including tables
- Wrap links in `<>` to suppress embeds
- Supports spoilers (`||text||`), code blocks with syntax highlighting
- Keep under 2000 chars per message; split longer reports

### Telegram

- Basic markdown: bold, italic, code, links
- No tables — use lists
- Links: `[text](url)` — limited preview control
- Keep concise; mobile-first reading

## Report Templates

### 1. Status Update

Good for: cron job results, system health, daily summaries.

```
✅ {thing} — working normally

Last run: {time}
Duration: {seconds}s
Next run: {time}

No issues detected.
```

Failure variant:
```
⚠️ {thing} — needs attention

Error: {brief description}
Last successful run: {time}
Consecutive failures: {count}

Suggested action: {one line}
```

### 2. Data Digest

Good for: daily/weekly summaries, pipeline reports, activity logs.

```
📊 {Title} — {date range}

{emoji} Category 1
• Item A — {value} ({change})
• Item B — {value} ({change})

{emoji} Category 2
• Item C — {value}
• Item D — {value}

Summary: {one sentence takeaway}
```

### 3. Alert

Good for: thresholds exceeded, anomalies, time-sensitive items.

```
🚨 {Alert title}

{What happened}: {brief description}
{Impact}: {what this means}
{When}: {timestamp}

Action needed: {specific next step}
```

Low-severity variant:
```
ℹ️ {Title}

{one-line summary}

Details: {2-3 lines max}
```

### 4. Comparison Report

Good for: week-over-week, before/after, budget vs actual.

```
📊 {Title}

| Metric | Now | Before | Change |
|--------|-----|--------|--------|
| {m1}   | {v1} | {v2}   | {Δ1}   |
| {m2}   | {v1} | {v2}   | {Δ1}   |

{one-line takeaway}
```

WhatsApp variant (no tables):
```
📊 {Title}

{m1}: {v1} (was {v2}, {Δ1})
{m2}: {v1} (was {v2}, {Δ1})

{one-line takeaway}
```

### 5. List Report

Good for: to-dos, action items, inventory, check results.

```
📋 {Title} ({count} items)

✅ Done
• Item 1
• Item 2

⏳ In progress
• Item 3 — {status note}

❌ Blocked
• Item 4 — {reason}
```

### 6. Empty Report

Good for: scheduled checks that found nothing.

```
✅ {Check name} — all clear

No {items} found in the last {time period}.
```

Or even shorter for Slack:
```
📊 {Title} — nothing to report
```

## Length Discipline

| Context | Target |
|---------|--------|
| Alert | 3-5 lines |
| Status check | 5-10 lines |
| Daily digest | 10-20 lines |
| Weekly summary | 15-30 lines |
| Detailed report | Thread it; keep main message under 20 lines |

## Anti-Patterns

- ❌ Starting with "Here is the report you requested:" — just give the report
- ❌ Repeating the same data in prose and in a table — pick one format
- ❌ Including raw JSON or API output — transform it first
- ❌ Using "N/A" everywhere — just omit empty fields
- ❌ Timestamps without timezone — always include tz
- ❌ Sentences like "The report shows that there were 3 items" — "3 items" is enough

## Composing Multi-Source Reports

When combining data from multiple scripts or APIs:

1. Run all sources first, collect outputs
2. Check if everything is empty → use empty report template
3. Prioritise: put the most important/urgent section first
4. Keep each section to 3-5 bullet points max
5. End with a one-line summary or next-action

## Tone Guidelines

- **Factual, not dramatic.** "Revenue is €12,400" not "Revenue has skyrocketed to an incredible €12,400!"
- **Specific, not vague.** "3 deals moved to Discovery" not "some pipeline activity"
- **Quiet confidence on success.** "✅ All checks passed" not "Great news! Everything is working perfectly!"
- **Clear on failure.** State what broke, when it last worked, and what to do next
