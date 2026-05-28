---
name: cron-waste-detector
description: Identify cron jobs wasting tokens — all-fail runs, broken credentials, zero delivery, over-scheduling, and diminishing returns. Outputs actionable recommendations to fix, snooze, reschedule, or delete wasteful jobs. Use when auditing cron token efficiency, reducing waste, optimizing run frequency, or asking "which cron jobs should I fix or turn off?"
---

# Cron Waste Detector

Find cron jobs that are burning tokens without producing useful output. Goes beyond `cron-cost-tracker` (which reports what you spent) to flag *why* it was wasted and *what to do about it*.

## Quick Start

```bash
node scripts/cron-waste-detector.mjs                   # scan last 3 days
node scripts/cron-waste-detector.mjs --days 7          # wider window
node scripts/cron-waste-detector.mjs --json            # raw JSON
node scripts/cron-waste-detector.mjs --recommendations # only actionable items
node scripts/cron-waste-detector.mjs --job <id>        # single job deep-dive
```

## What It Detects

| Waste Signal | Threshold | Recommendation |
|---|---|---|
| **All-fail** | 100% error rate over ≥3 runs | Fix root cause or delete |
| **Broken credentials** | Error messages mention auth/API key/token | Shield + snooze via `cron-credential-shield` |
| **Zero delivery** | 0% delivery success over ≥3 runs | Check channel config |
| **Over-scheduled** | Runs >24/day with <50% producing output | Reduce frequency |
| **Consecutive failures** | ≥5 in a row | Likely stuck — diagnose with `cron-first-aid` |
| **High burn, low value** | Top 20% token cost, bottom 20% delivery rate | Consider if job is worth keeping |
| **Snoozed but still running** | Job appears snoozed but has recent runs | Check snooze state |
| **Stale one-shots** | `deleteAfterRun: true` but still registered after first run | Clean up |

## Output Format

### Default (human-readable)

```
🔍 Cron Waste Detector — last 3 days
═══════════════════════════════════════════════════════

Total runs scanned: 142
Total tokens burned: 1,842,000
Estimated waste: $0.47 (26% of total spend)

🔴 Critical (fix now):
   ❌ Daily Leaving Cert note — 3/3 runs failed (Supabase creds missing)
      → Waste: $0.12 (12,400 tokens × 3 runs)
      → Fix: Add SUPABASE_URL + SUPABASE_ANON_KEY, or snooze
   ❌ Attio stage changes — 2/2 runs failed (ATTIO_API_KEY missing)
      → Waste: $0.08 (9,200 tokens × 2 runs)

🟡 Warning (review soon):
   ⚡ Solar export alert — 18 runs, 0 alerts sent (no export today)
      → Burn: $0.15 for no output — consider reducing to hourly

🟢 Optimization opportunities:
   📊 Morning briefing — could merge energy check into single run

💡 Recommendations:
   1. Snooze "Daily Leaving Cert note" until Supabase creds are fixed
   2. Snooze "Attio stage changes" until ATTIO_API_KEY is added
   3. Reduce solar export alert to hourly when no export detected
```

### JSON

```json
{
  "period": "last 3 days",
  "summary": {
    "totalRuns": 142,
    "totalTokens": 1842000,
    "totalCost": 1.82,
    "wastedTokens": 480000,
    "wastedCost": 0.47,
    "wastePercent": 26
  },
  "critical": [...],
  "warnings": [...],
  "optimizations": [...],
  "recommendations": [...]
}
```

## How It Works

1. Fetches all cron jobs and their recent runs
2. For each job, calculates:
   - Error rate and patterns
   - Delivery success rate
   - Token cost per successful output
   - Run frequency vs output rate
3. Cross-references with `credential-health` patterns in error messages
4. Ranks waste severity (critical / warning / optimization)
5. Generates actionable recommendations

## Relationship to Other Skills

- **cron-cost-tracker**: Shows what you spent; this shows what you *wasted*
- **cron-first-aid**: Diagnoses a single broken job; this finds *which* jobs need diagnosis
- **cron-credential-shield**: Auto-snoozes on broken creds; this detects if shielding is missing
- **cron-dead-letter**: Finds stuck failure loops; this adds cost context to those failures
- **cron-snooze**: The recommended fix for many waste signals

## Notes

- Waste percentage is estimated — a run that produces no output (error or silent NO_REPLY with high tokens) is counted as waste
- "Over-scheduled" threshold is configurable (default: >24 runs/day)
- Cost estimates use the same pricing table as `cron-cost-tracker`
- Read-only: never modifies cron jobs
