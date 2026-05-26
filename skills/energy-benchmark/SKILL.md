---
name: energy-benchmark
description: >
  Compare current energy usage against historical same-day-of-week baselines from Emporia.
  Answers questions like "is my usage normal for a Tuesday?", "am I using more than usual today?",
  or "how does this week compare to last week?". Builds on emporia-energy data. Use when asked
  about energy usage patterns, anomalies, whether consumption is high/low/normal, or for a
  contextual comparison against recent history.
---

# Energy Benchmark

Compare today's energy consumption against a historical same-day-of-week baseline.

## Why

Energy numbers in isolation aren't very useful — "18.4 kWh today" means nothing without context. This skill adds that context by comparing against the average of the same weekday over recent weeks. "23% above your typical Tuesday" is actionable.

## When to Use

- "Is my usage normal today?"
- "Am I using more than usual?"
- "How does today compare to last Tuesday?"
- "Weekly comparison — am I on track?"
- "Energy anomaly check"

## Quick Start

```bash
node skills/energy-benchmark/scripts/benchmark.mjs
```

Returns JSON with today's usage, the baseline average, and a verdict.

## Workflow

### 1. Run the benchmark script

```bash
# Default: compare today vs last 4 same-weekdays
node skills/energy-benchmark/scripts/benchmark.mjs

# Compare a specific date
node skills/energy-benchmark/scripts/benchmark.mjs --date 2026-05-20

# Use more historical weeks
node skills/energy-benchmark/scripts/benchmark.mjs --weeks 8

# Circuit-level benchmark (e.g. EV charger)
node skills/energy-benchmark/scripts/benchmark.mjs --filter "EV Charger"

# JSON output for scripting
node skills/energy-benchmark/scripts/benchmark.mjs --json
```

### 2. Interpret the result

The script outputs:

```
Energy Benchmark — Tuesday 2026-05-26
──────────────────────────────────────
Today so far:    12.4 kWh
Typical Tue:     15.2 kWh (avg of last 4 Tuesdays)
Delta:           -2.8 kWh (-18%)
Verdict:         ✅ BELOW NORMAL
Range:           11.8 – 19.3 kWh
```

### 3. Summarise for the human

- **ABOVE NORMAL** (>20% over) → flag as high, suggest checking what's running
- **NORMAL** (within ±20%) → all good
- **BELOW NORMAL** (>20% under) → note it, might be out of the house
- Include the range (min-max of historical data) for context

## Dependencies

- **emporia-energy** skill — uses `scripts/query_emporia_vendor.mjs` for data
- Credentials: `EMPORIA_USERNAME`, `EMPORIA_PASSWORD` in `.env`

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--date` | today | Date to benchmark (YYYY-MM-DD) |
| `--weeks` | 4 | Number of historical same-weekdays to average |
| `--filter` | (none) | Circuit name filter (e.g. "EV Charger") |
| `--env-file` | workspace `.env` | Path to env file |
| `--json` | false | Machine-readable JSON output |

## Output Format

### Human-readable (default)

```
Energy Benchmark — <Day> <Date>
────────────────────────────────
Today so far:    <X.X> kWh
Typical <Day>:   <Y.Y> kWh (avg of last N <Day>s)
Delta:           <+/-Z.Z> kWh (<+/-P>%)
Verdict:         <emoji> <VERDICT>
Range:           <min> – <max> kWh
```

### JSON (`--json`)

```json
{
  "date": "2026-05-26",
  "dayOfWeek": "Tuesday",
  "currentKwh": 12.4,
  "baselineKwh": 15.2,
  "baselineWeeks": 4,
  "deltaKwh": -2.8,
  "deltaPercent": -18.4,
  "verdict": "BELOW_NORMAL",
  "rangeMin": 11.8,
  "rangeMax": 19.3,
  "historicalDays": [
    { "date": "2026-05-19", "kwh": 16.1 },
    { "date": "2026-05-12", "kwh": 13.8 },
    { "date": "2026-05-05", "kwh": 19.3 },
    { "date": "2026-04-28", "kwh": 11.8 }
  ]
}
```

## Verdict Thresholds

- **ABOVE_NORMAL**: > +20% vs baseline
- **NORMAL**: within ±20% of baseline
- **BELOW_NORMAL**: < -20% vs baseline
- **INSUFFICIENT_DATA**: fewer than 2 historical days available

## Notes

- Today's reading is partial (up to the current hour). The script adjusts the baseline proportionally if the day isn't complete yet (scales historical same-day values to match elapsed hours).
- If Emporia returns no data for a historical day, that day is skipped.
- The script falls back gracefully if fewer than requested weeks are available.
