# Emporia Energy Research Notes

## What looks viable

### 0. Hosted MCP server may be the best primary path

Don provided `https://mcp.emporiaenergy.com/streamable` as Emporia's remote MCP server.

Observed behavior from a direct probe:
- endpoint exists
- returns `401 Unauthorized: Missing or invalid Authorization header`

That is a good sign. It suggests the service is live and gated behind auth, rather than being a placeholder.

Implication:
- remote MCP is real and likely useful later
- but Emporia's own README indicates remote auth is OAuth-based
- if we only have Emporia email/password available, the **official local MCP server** is the practical preferred path for now
- the local PyEmVue workflow becomes the fallback / compatibility path rather than the default

Open question:
- exact OpenClaw-side remote MCP wiring and OAuth flow, if we want to use the hosted endpoint later

### 1. PyEmVue is the clearest working path right now

Important practical result from testing on this machine:
- the same Emporia credentials succeeded with PyEmVue
- device enumeration worked
- therefore the account is not broadly blocked from Emporia cloud access

This strongly suggests:
- PyEmVue should be the default operational path for now
- Emporia's official MCP/API authorization issue is likely account gating, beta rollout restriction, or a vendor-side bug

The most practical integration path is the open-source Python library **PyEmVue** by `magico13`.

Useful signals:
- Public repo: `magico13/PyEmVue`
- Public PyPI package: `pyemvue`
- Repo activity visible in 2025/2026 metadata
- Explicit support for reading Emporia Vue device lists and usage data

Documented capabilities include:
- Log in with Emporia account credentials or stored tokens
- List customer devices
- Fetch device usage by scale
- Read customer and device metadata

Supported scales observed in the library:
- minute
- 15 minutes
- hour
- day
- week
- month
- year

This is enough for natural-language questions like:
- "What used the most power today?"
- "How much did the dryer use this week?"
- "Show the top 10 circuits this month"
- "How does EV charging compare with the oven today?"

### 2. Home Assistant integration validates the model

The Home Assistant custom integration `magico13/ha-emporia-vue` is a good sign that the data model is stable enough for everyday monitoring.

That repo indicates the common pattern is:
- authenticate with Emporia cloud
- poll usage data regularly
- expose one sensor per device/channel

This suggests two good paths for OpenClaw:
1. **Direct OpenClaw skill** using PyEmVue
2. **Optional Home Assistant bridge** later if Don wants energy data combined with other home telemetry

## Constraints and risks

### No official public API guarantee

I did not find evidence here of a stable, officially supported public developer API intended for third-party apps. The practical path is therefore **unofficial / reverse-engineered but established**.

Implications:
- The integration may break if Emporia changes auth or endpoints
- The skill should be read-only by default
- The skill should fail gracefully and explain likely causes

### Cloud dependency

The discovered path is cloud-backed, not purely local.

Implications:
- Queries depend on Emporia service availability
- Credentials or refresh tokens are required
- Latency and outages are outside local control

### Account-security considerations

Because the common path uses Emporia credentials or saved tokens:
- prefer environment variables or a token file outside the skill folder
- never store credentials in the skill itself
- treat this as sensitive personal home telemetry

## Most useful first version

A strong V1 skill should focus on **read-only querying** and avoid overreaching.

Recommended V1 capabilities:
- List available devices/channels
- Query usage at common periods: today, yesterday, this week, this month
- Filter by device/channel name
- Rank top consumers
- Compare named devices/circuits
- Return JSON that the agent can summarize naturally

Recommended V2 capabilities:
- Time-window support with explicit start/end
- Cost estimation if tariff is provided locally
- Baseline/anomaly detection
- Daily summary cron job
- Cross-check against solar / battery / utility data if present elsewhere

## Suggested natural-language intents

### Ranking / discovery
- Which circuits are using the most energy today?
- What were the top 5 consumers this week?
- What is drawing power right now? *(only if minute-scale data is good enough for "now")*

### Single-device lookups
- How much power did the dishwasher use today?
- How much did the EV charger use this month?

### Comparison
- Compare the dryer and water heater today
- Which used more this week: oven or EV?

### Summaries
- Summarize home energy usage for today
- Give me a quick energy report for this week

## Good skill design choice

For OpenClaw, the cleanest design is:
- keep `SKILL.md` short and procedural
- put research/assumptions here
- use a script that outputs structured JSON
- let the agent translate natural language into a script invocation and then summarize the result

## Sources consulted

- PyPI package metadata for `pyemvue`
- GitHub repo metadata for `magico13/PyEmVue`
- `PyEmVue` `api_docs.md`
- GitHub repo metadata for `magico13/ha-emporia-vue`
- `ha-emporia-vue` README
