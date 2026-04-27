---
name: energy-cost
description: "Calculate energy costs from kWh readings using configurable time-of-use tariff bands. Use when estimating electricity costs, comparing day vs night rate charges, costing solar self-consumption, or answering 'how much did that cost?' for energy usage data."
scripts:
  - scripts/energy-cost.mjs
---

# Energy Cost Calculator 💡

Turn kWh readings into cost estimates using time-of-use tariff bands.

## Why

You have energy consumption data (from Emporia, Solis, or manual readings) and tariff rates. This script bridges the gap — feed it kWh values and a time window, get a cost breakdown by rate band.

## Script

`scripts/energy-cost.mjs` — Zero dependencies. Node.js 18+.

## Quick Start

```bash
# Current rate band (uses current hour)
node scripts/energy-cost.mjs 3.5

# Specific time range
node scripts/energy-cost.mjs 12.3 --from 23:00 --to 07:00

# Preset period
node scripts/energy-cost.mjs 8.2 --period night
node scripts/energy-cost.mjs 5.1 --period peak

# Multiple readings (summed)
node scripts/energy-cost.mjs 2.1 4.7 1.3 --from 09:00 --to 15:00

# Flat rate override
node scripts/energy-cost.mjs 10.0 --flat-rate 0.35

# Custom tariff file
node scripts/energy-cost.mjs 5.0 --tariff tariff-example.json --period day

# Show current tariff (no kWh needed)
node scripts/energy-cost.mjs

# JSON output
node scripts/energy-cost.mjs 3.5 --period night --json

# Quiet mode (just the cost)
node scripts/energy-cost.mjs 3.5 --quiet
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `kwh` | _(required unless showing tariff)_ | One or more kWh values |
| `--from HH:MM` | _(none)_ | Start time for time-of-use calc |
| `--to HH:MM` | _(none)_ | End time for time-of-use calc |
| `--period, -p` | _(none)_ | Preset: `day`, `night`, `morning`, `afternoon`, `peak`, `evening` |
| `--flat-rate, -f` | _(none)_ | Override all bands with single €/kWh rate |
| `--tariff, -t` | built-in | Load tariff from JSON file |
| `--json` | false | JSON output |
| `--quiet, -q` | false | Output only the total cost |
| `--help, -h` | | Show usage |

## Default Tariff

Built-in defaults (Irish residential-style, matching common TOU plans):

| Band | Rate | Hours |
|------|------|-------|
| Night | €0.2463/kWh | 23:00–08:00 |
| Day | €0.3833/kWh | 08:00–17:00, 19:00–23:00 |
| Peak | €0.4293/kWh | 17:00–19:00 |

Customise via `--tariff <file>` (see `tariff-example.json` in this skill directory).

## How Time-Of-Use Works

When you specify `--from` and `--to`, the script distributes the kWh evenly across each minute in the time range, applying the correct rate per minute. This gives accurate blended costs for periods that span multiple rate bands.

For example, `--from 16:00 --to 20:00` spans day (16:00–17:00), peak (17:00–19:00), and day (19:00–20:00). Each minute gets its correct rate.

## Examples

### Night rate charging

```bash
$ node scripts/energy-cost.mjs 40 --period night

⚡ Energy Cost (23:00 – 07:59)

  night         40.00 kWh     €9.85  (€0.25/kWh, 100%)

  total         40.00 kWh     €9.85
```

### EV charging over a specific window

```bash
$ node scripts/energy-cost.mjs 35 --from 00:30 --to 07:30

⚡ Energy Cost (00:30 – 07:30)

  night         35.00 kWh     €8.62  (€0.25/kWh, 100%)

  total         35.00 kWh     €8.62
```

### Afternoon usage spanning peak

```bash
$ node scripts/energy-cost.mjs 8 --from 15:00 --to 20:00

⚡ Energy Cost (15:00 – 20:00)

  day            4.00 kWh     €1.53  (€0.38/kWh, 50%)
  peak           2.00 kWh     €0.86  (€0.43/kWh, 25%)
  day            2.00 kWh     €0.77  (€0.38/kWh, 25%)

  total          8.00 kWh     €3.16
```

## Integration with Energy Skills

- **emporia-energy**: Get kWh consumption, pipe into energy-cost for cost estimates
- **solis-energy**: Get solar generation data, subtract from consumption, cost the net import

## Limitations

- Time-of-use distributes kWh evenly across minutes (doesn't account for actual load profile)
- Requires Node.js 18+ (uses built-in `fetch`-free APIs only)
- Currency formatting assumes European number conventions
