---
name: emporia-energy
description: >
  Query Emporia Vue / Emporia Energy home electricity usage with natural language
  via a read-only workflow. Prefer Emporia's hosted MCP server when available; fall
  back to the unofficial local PyEmVue workflow when MCP access is unavailable. Use
  when asked to inspect home energy consumption, rank top-consuming circuits or
  devices, compare usage across named loads, summarize energy usage for periods like
  today/this week/this month, or work with Emporia account data.
---

# Emporia Energy

Answer natural-language questions about home electricity usage without embedding Emporia API details in every task.

## Why

Don has an Emporia Vue monitor tracking per-circuit energy use. Rather than scripting API calls from scratch each time, this skill provides a ready workflow: map the question → run the right script → summarize in plain language.

## When to Use

- "How much power is being used right now?"
- "What used the most electricity today?"
- "Top 5 circuits this week"
- "How much did the EV charger use this month?"
- "Compare the dryer vs the oven this week"

## Quick Start

1. Treat this as **read-only** unless Don explicitly asks for more.
2. Prefer `scripts/query_emporia_vendor.mjs` (vendor wrapper, uses `.env`).
3. Fall back to `scripts/query_emporia.py` (PyEmVue) if the vendor wrapper breaks.
4. Summarize results in plain language.
5. If asked about trustworthiness, read `references/research.md` and `references/openclaw-setup.md`.

## Integration Order

```
1. Local vendor wrapper  →  scripts/query_emporia_vendor.mjs
   Uses @emporiaenergy/emporia-mcp locally with .env credentials.
   Best fit: native Emporia account + .env + no MCP server registration.

2. Hosted MCP server  →  https://mcp.emporiaenergy.com/streamable
   OAuth-based remote auth. Only when runtime supports remote MCP + OAuth.

3. PyEmVue fallback  →  scripts/query_emporia.py
   Use when vendor wrapper is unavailable or broken.
```

Details on each integration path: see `references/integration.md`.

## Credentials

```
EMPORIA_USERNAME       Emporia account email
EMPORIA_PASSWORD       Emporia account password
EMPORIA_TOKEN_FILE     Optional; defaults to ~/.config/emporia/keys.json
```

All read from workspace `.env`. Never write credentials into skill files.

## Workflow

### 1. Map the request to a time scale

```
"right now", "current"  →  minute
"today", "yesterday"    →  day
"this week", "weekly"   →  week
"this month", "monthly" →  month
"this year"             →  year
```

For a named device or circuit, add `--device-filter`.

### 2. Run the script

**Vendor wrapper (preferred):**

```bash
node skills/emporia-energy/scripts/query_emporia_vendor.mjs overview
node skills/emporia-energy/scripts/query_emporia_vendor.mjs list-devices
node skills/emporia-energy/scripts/query_emporia_vendor.mjs list-channels
```

**PyEmVue fallback:**

```bash
bash skills/emporia-energy/scripts/run_pyemvue_query.sh --scale day --top 10
bash skills/emporia-energy/scripts/run_pyemvue_query.sh --scale week --device-filter dryer
bash skills/emporia-energy/scripts/run_pyemvue_query.sh --scale month --include-main --top 20
```

### 3. Summarize carefully

- State the period and unit (`kWh`).
- Call out top consumers first.
- Mention if results are filtered.
- Don't overclaim "real-time" — minute-scale data is still cloud-reported.

## Common Request Patterns

### Top consumers

"What used the most power today?" → matching scale + sensible `--top` value.

### Single device/circuit lookup

"How much did the EV charger use this month?" → `--device-filter <name>`.

### EV charging cost and savings

"How much did my car cost to charge last night and how much did I save?"

```
1. Get EV charger kWh via query_emporia.py or run_pyemvue_query.sh
2. Run scripts/ev_charge_savings.py <kwh> <petrol_price_per_litre_eur> [charge_cost_eur]
3. Returns: miles driven, equivalent petrol cost, savings
```

Config files: `config/tariff.json` (tariff bands), `config/vehicle.json` (vehicle efficiency).

### Comparison

Run separate filtered queries per named load, or run a broader query and compare relevant rows in the JSON output.

### Explain feasibility / setup

Read `references/research.md` and explain:
- the practical path is PyEmVue
- it appears active and widely used enough to be useful
- it is not an official public API commitment from Emporia

## Failure Handling

1. Check `pyemvue` is installed.
2. Check credentials / token file are available.
3. Diagnose: local setup, expired auth, or Emporia service change.
4. Read `references/research.md` if explaining ecosystem limitations.

## Script Output

`scripts/query_emporia.py` returns JSON:

```json
{
  "scale": "day",
  "unit": "kWh",
  "top_items": [...],
  "device_totals_kwh": {...},
  "notes": "..."
}
```

By default excludes synthetic `Balance` channels and `Main` / whole-home channels. Include them only when the question needs them.

## References

- `references/research.md` — ecosystem context, risk framing, PyEmVue rationale
- `references/openclaw-setup.md` — OpenClaw integration setup notes
- `references/integration.md` — detailed integration path comparison (new)
