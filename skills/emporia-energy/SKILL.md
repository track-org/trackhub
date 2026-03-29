---
name: emporia-energy
description: Query Emporia Vue / Emporia Energy home electricity usage with natural language via a read-only workflow. Prefer Emporia's hosted MCP server when available; fall back to the unofficial local PyEmVue workflow when MCP access is unavailable. Use when asked to inspect home energy consumption, rank top-consuming circuits or devices, compare usage across named loads, summarize energy usage for periods like today/this week/this month, or work with Emporia account data.
---

# Emporia Energy

Use this skill to answer natural-language questions about Emporia energy usage without embedding Emporia API details in every task.

## Quick start

1. Treat this as **read-only** unless Don explicitly asks for anything more.
2. Prefer the local wrapper `scripts/query_emporia_vendor.mjs`, which uses Emporia's official npm MCP package internals locally with the workspace `.env` file.
3. If the vendor wrapper is unavailable or breaks, use `scripts/query_emporia.py` as a PyEmVue fallback.
4. Summarize the result in plain language.
5. If the user asks whether this approach is trustworthy, read `references/research.md` and `references/openclaw-setup.md` and explain the vendor-wrapper-first / PyEmVue-fallback status.

## Preferred integration order

### 1. Local vendor wrapper over Emporia's official MCP package

Prefer `scripts/query_emporia_vendor.mjs`.

It uses Emporia's official npm package `@emporiaenergy/emporia-mcp` locally, reusing the vendor auth and API implementation without requiring OpenClaw to register arbitrary MCP servers natively.

This is the best fit when you have:
- a native Emporia email/password account
- the workspace `.env` file available
- an OpenClaw build without general MCP server registration in config

Benefits:
- still uses vendor-maintained auth/API logic
- uses username/password via `.env`
- avoids unsupported OpenClaw MCP config
- less brittle than reverse-engineered cloud calls

### 2. Hosted Emporia MCP server (later / optional)

Emporia also exposes remote MCP endpoints such as `https://mcp.emporiaenergy.com/streamable`, but their README indicates remote auth is OAuth-based.

Use this path only when the runtime has remote MCP support plus OAuth/token wiring in place.

### 3. Local PyEmVue fallback

Use the bundled Python script when the vendor wrapper is unavailable or temporarily broken.

## Inputs and secrets

Prefer credentials outside the skill directory.

Supported inputs:
- `EMPORIA_USERNAME`
- `EMPORIA_PASSWORD`
- `EMPORIA_TOKEN_FILE` (optional; defaults to `~/.config/emporia/keys.json`)

Do not write credentials into the skill files.

## Main workflow

### 1. Map the natural-language request to a scale

Use this rough mapping:
- "right now", "current", "currently" -> `minute`
- "today", "yesterday" -> `day`
- "this week", "weekly" -> `week`
- "this month", "monthly" -> `month`
- "this year" -> `year`

If the user asks for a named device or circuit, pass `--device-filter`.

### 2. Run the working PyEmVue path first

Examples:

```bash
bash skills/emporia-energy/scripts/run_pyemvue_query.sh --scale day --top 10
bash skills/emporia-energy/scripts/run_pyemvue_query.sh --scale week --device-filter dryer
bash skills/emporia-energy/scripts/run_pyemvue_query.sh --scale month --include-main --top 20
```

If you need to inspect the experimental vendor path:

```bash
node skills/emporia-energy/scripts/query_emporia_vendor.mjs overview
node skills/emporia-energy/scripts/query_emporia_vendor.mjs list-devices
node skills/emporia-energy/scripts/query_emporia_vendor.mjs list-channels
```

### 3. Summarize carefully

When summarizing:
- state the period and unit (`kWh`)
- call out the top consumers first
- mention if the result is filtered
- avoid overclaiming "real-time" precision; minute-scale data is still cloud-reported

## Common request patterns

### Top consumers
- "What used the most power today?"
- "Top 5 circuits this week"

Run the script with the matching scale and a sensible `--top` value.

### Single device/circuit lookup
- "How much did the EV charger use this month?"
- "What did the dishwasher use today?"

Run with `--device-filter <name>`.

### EV charging cost and savings
- "How much did my car cost to charge last night and how much did I save?"
- "How much money did I save charging instead of buying petrol?"

Use:
- `scripts/query_emporia.py` or `run_pyemvue_query.sh` to get the EV charger kWh / charge cost
- `scripts/ev_charge_savings.py <kwh> <petrol_price_per_litre_eur> [charge_cost_eur]` to estimate miles, equivalent petrol cost, and savings

Config files:
- `config/tariff.json` for electricity tariff bands
- `config/vehicle.json` for vehicle efficiency assumptions

### Comparison

For comparisons, either:
- run separate filtered queries for each named load, or
- run a broader query and compare the relevant rows in the JSON output.

### Explain feasibility / setup

If asked whether Emporia can be integrated at all, read `references/research.md` and explain:
- the practical path is PyEmVue
- it appears active and widely used enough to be useful
- it is not an official public API commitment from Emporia

## Script notes

`scripts/query_emporia.py` returns JSON with:
- `scale`
- `unit`
- `top_items`
- `device_totals_kwh`
- `notes`

By default it excludes:
- synthetic `Balance` channels
- `Main` / whole-home channels

Include them only when the question actually needs them.

## Failure handling

If the script fails:
1. Check whether `pyemvue` is installed.
2. Check whether credentials or token file are available.
3. Explain whether the likely problem is local setup, expired auth, or Emporia service/API change.
4. If needed, read `references/research.md` before explaining ecosystem limitations.

## References

Read `references/research.md` when you need:
- ecosystem/background context
- risk framing
- rationale for using PyEmVue
- ideas for future expansion
poria service/API change.
4. If needed, read `references/research.md` before explaining ecosystem limitations.

## References

Read `references/research.md` when you need:
- ecosystem/background context
- risk framing
- rationale for using PyEmVue
- ideas for future expansion
ue
- ideas for future expansion
