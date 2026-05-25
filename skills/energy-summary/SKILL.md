---
name: energy-summary
description: >
  Combined daily energy report pulling from Solis (solar generation/export) and Emporia
  (total consumption), applying time-of-use tariff rates to produce a single financial
  and energy-flow summary. Use when asked "how much energy did I use today?", "what did
  my electricity cost?", "solar vs grid breakdown", or when generating a daily/weekly
  energy briefing for WhatsApp/Slack delivery.
skill-type: standard
category: energy
tags: [energy, solar, consumption, cost, summary, daily-report, emporia, solis, tariff]
suggested-connectors: [emporia-energy, solis-energy, energy-cost, quick-reports]
suggested-job-type: cron
suggested-schedule-frequency: daily
memory-paths-writes: []
memory-paths-reads: []
available-scripts:
  - name: energy-summary.cjs
    description: >
      Generate a combined energy summary for a given date. Queries Solis for
      solar data, Emporia for total consumption, applies tariff rates, and
      outputs a human-readable or JSON report.
---

# Energy Summary ⚡

One-command combined daily energy report: solar generation, grid import/export, self-consumption, total consumption, and cost breakdown.

## Why

Don has three energy data sources — Solis (solar), Emporia (consumption), and tariff rates — but no single view that ties them together. Asking "how much did my electricity cost today?" currently requires querying Solis, querying Emporia, running the numbers manually, and formatting a message.

This skill closes that gap:

- **Solar generation** from Solis (kWh generated, exported, self-consumed)
- **Total consumption** from Emporia (whole-home kWh)
- **Cost calculation** using time-of-use tariff bands
- **Net cost** accounting for export credit (at the same band rates)
- **One-line summary** suitable for WhatsApp/Slack delivery

It pairs naturally with:
- `solis-energy` — raw solar data source
- `emporia-energy` — raw consumption data source
- `energy-cost` — tariff calculation engine (used internally)
- `quick-reports` — formatting for delivery channels

## Script

`scripts/energy-summary.cjs` — Zero dependencies. Node.js 18+.

Requires:
- Solis credentials in `.env` (used by `solis_status.py`)
- Emporia credentials in `.env` (used by `query_emporia_vendor.mjs`)
- Python 3 with `requests` (for Solis script)
- Emporia MCP vendor package (for Emporia script)

## Usage

```bash
# Today's summary (human-readable)
node scripts/energy-summary.cjs today

# Yesterday's summary
node scripts/energy-summary.cjs yesterday

# Specific date
node scripts/energy-summary.cjs --date 2026-05-24

# JSON output (for programmatic use)
node scripts/energy-summary.cjs today --json

# Compact summary (one-liner, good for WhatsApp)
node scripts/energy-summary.cjs today --compact

# Skip Emporia (solar-only report)
node scripts/energy-summary.cjs today --solar-only

# Custom export credit rate (default: uses import tariff band rates)
node scripts/energy-summary.cjs today --export-rate 0.18

# Quiet: only output the net cost figure
node scripts/energy-summary.cjs today --quiet
```

## Output Format

### Human-readable (default)

```
⚡ Energy Summary — Mon 25 May 2026

Solar
  Generated:      12.4 kWh
  Self-consumed:   8.2 kWh (66%)
  Exported:        4.2 kWh → €0.98 credit

Consumption
  Total:          15.8 kWh (Emporia)
  From solar:      8.2 kWh (52%)
  From grid:       7.6 kWh → €2.91

Net cost: €1.93
```

### Compact (--compact)

```
⚡ 25 May: Solar 12.4 kWh (66% self-used, 4.2 kWh exported). Used 15.8 kWh total. Grid cost €2.91 – export credit €0.98 = €1.93 net.
```

### JSON (--json)

```json
{
  "date": "2026-05-25",
  "solar": {
    "generated_kwh": 12.4,
    "self_consumed_kwh": 8.2,
    "exported_kwh": 4.2,
    "self_consumption_pct": 66
  },
  "consumption": {
    "total_kwh": 15.8,
    "from_solar_kwh": 8.2,
    "from_grid_kwh": 7.6,
    "solar_fraction_pct": 52
  },
  "cost": {
    "grid_import_eur": 2.91,
    "export_credit_eur": 0.98,
    "net_cost_eur": 1.93
  }
}
```

## How It Works

1. Runs `solis_status.py today|yesterday` to get solar generation, export, import, self-consumption
2. If not `--solar-only`, runs `query_emporia_vendor.mjs energy --range today|yesterday` for total consumption
3. Falls back to Solis `home_load_kwh` if Emporia data is unavailable
4. Applies tariff bands to grid import and export
5. Calculates net cost (import cost minus export credit)
6. Formats output

## Tariff Rates

Uses the same rates as `energy-cost` (from TOOLS.md):
- Night: 24.63 c/kWh (23:00–08:00)
- Day: 38.33 c/kWh (08:00–17:00, 19:00–23:00)
- Peak: 42.93 c/kWh (17:00–19:00)

Export credit defaults to the same band rate (import = export rate). Override with `--export-rate` for a fixed rate.

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `today` | | | Show today's summary |
| `yesterday` | | | Show yesterday's summary |
| `--date` | `-d` | today | Specific date (YYYY-MM-DD) |
| `--json` | `-j` | false | JSON output |
| `--compact` | `-c` | false | One-line compact summary |
| `--solar-only` | | false | Skip Emporia, solar-only report |
| `--export-rate` | | band rates | Fixed export credit rate (€/kWh) |
| `--quiet` | `-q` | false | Only output net cost |
| `--help` | `-h` | | Show help |
| `--no-emporia` | | false | Alias for --solar-only |

## Exit Codes

- 0: Success
- 1: Partial data (one source failed, using what's available)
- 2: All data sources failed

## Limitations

- Emporia query can take 5-10 seconds due to API latency
- Solis `home_load_kwh` is only recorded during production hours — Emporia is the accurate whole-home source
- Export credit rates vary by supplier; the default (same as import) is a simplification
- Date range limited to what Solis API returns (typically last 30 days)
